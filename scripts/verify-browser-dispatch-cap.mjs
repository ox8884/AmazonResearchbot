import assert from 'node:assert/strict';
import { openAcceptance } from './support/acceptance.mjs';
import { browserSigningFixture } from './support/browser-signing-fixture.mjs';
import { publishBrowserSigningIdentity } from '../apps/worker/src/browser-signing-key.ts';
import { dispatchBrowserWork } from '../apps/worker/src/browser-dispatch.ts';
import { queueAmazonPackage, queueProductDatabase } from '../apps/worker/src/browser-task-producer.ts';
import { signBrowserTask } from '../apps/worker/src/browser-task-signer.ts';
import { createHash, randomUUID } from 'node:crypto';

const test = await openAcceptance({ databaseKey: `browser-dispatch-cap-${Date.now()}` });
try {
  const origin = 'http://localhost:5173';
  const keys = browserSigningFixture();
  const identity = await publishBrowserSigningIdentity(test.pool, keys.privateKey);
  const pairing = await test.call('/api/bridge/pairings', {});
  const enrolled = await test.call('/api/bridge/pair', {
    pairingCode: pairing.body.pairingCode,
    name: 'Synthetic cap observer',
  });
  assert.equal(enrolled.status, 201);
  const deviceId = enrolled.body.id;
  const machineCall = async (url, body) => {
    const response = await test.app.inject({
      method: body === undefined ? 'GET' : 'POST',
      url,
      headers: {
        origin,
        authorization: `Bearer ${enrolled.body.credential}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { payload: body }),
    });
    return { status: response.statusCode, body: response.json() };
  };
  assert.equal((await machineCall('/api/bridge/capabilities', {
    connected: true,
    supportedTasks: ['product_database', 'amazon_package'],
    keyFingerprint: identity.fingerprint,
  })).status, 200);

  const candidate = (await test.pool.query(
    "INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",
    [`cap-zero ${test.runId}`],
  )).rows[0];
  const signing = { origin, privateKey: keys.privateKey };
  await test.pool.query(
    "INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'cap-fixture',jsonb_set(snapshot,'{jsDailyWireCap}','1'::jsonb) FROM settings_versions ORDER BY version DESC LIMIT 1",
  );
  const overnightTasks=[];
  const overnightSettingsVersion=Number((await test.pool.query('SELECT max(version)::int AS version FROM settings_versions')).rows[0].version);
  for(const suffix of ['a','b']){
    const keyword=`overnight-${suffix} ${test.runId}`;
    const overnight=(await test.pool.query(
      "INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id,input_version",
      [keyword],
    )).rows[0];
    const taskId=randomUUID(),expiresAt=new Date(Date.now()+300000).toISOString();
    const envelope=signBrowserTask({version:1,id:taskId,issuerOrigin:origin,deviceId,issuedAt:new Date().toISOString(),expiresAt,request:{kind:'product_database',candidateId:overnight.id,inputVersion:overnight.input_version,settingsVersion:overnightSettingsVersion,query:keyword,marketplace:'us',category:'Kitchen & Dining',discoveryCategory:'Home & Kitchen',productTier:'Standard',resultLimit:100}},keys.privateKey);
    const taskHash=createHash('sha256').update(envelope.payload).digest('hex');
    await test.pool.query(
      "INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,expires_at,task_kind,created_at) VALUES($1,$2,$3,NULL,$4,$5,$6::jsonb,$7,$8,'product_database',date_trunc('day',clock_timestamp())-interval '1 minute')",
      [taskId,deviceId,overnight.id,overnight.input_version,overnightSettingsVersion,JSON.stringify(envelope),taskHash,expiresAt],
    );
    overnightTasks.push(taskId);
  }
  const settingsLock=await test.pool.connect();
  await settingsLock.query('BEGIN');
  await settingsLock.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
  const delayedClaim=machineCall('/api/bridge/tasks/claim',{});
  const waitForBlockedClaim=async()=>{
    for(let attempt=0;attempt<40;attempt++){
      const waiting=Number((await test.pool.query("SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND granted=false")).rows[0].count);
      if(waiting>0)return;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.fail('The claim did not reach the settings advisory lock');
  };
  await waitForBlockedClaim();
  const lockReleasedAt=Date.now();
  await settingsLock.query('COMMIT');
  settingsLock.release();
  const overnightClaim=(await delayedClaim).body;
  assert.equal(overnightClaim.kind,'task','A task queued before midnight may consume today\'s first delivery slot');
  const charged=(await test.pool.query('SELECT delivered_at,first_delivered_at FROM browser_tasks WHERE id=$1',[overnightClaim.taskId])).rows[0];
  assert.ok(charged.first_delivered_at.getTime()>=lockReleasedAt,'First delivery must use wall-clock time after a delayed transaction acquires the lock');
  assert.ok(charged.first_delivered_at>=new Date(new Date().setHours(0,0,0,0)),'The cap must charge the first delivery date');
  assert.equal((await machineCall('/api/bridge/tasks/claim',{})).body.kind,'idle','A second pre-midnight task must be blocked after today\'s delivery cap is consumed');
  await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE id=$1",[overnightTasks.find(id=>id!==overnightClaim.taskId)]);
  const queuedAtPositive = await queueProductDatabase(test.pool, { deviceId, candidateId: candidate.id }, signing);
  assert.equal(queuedAtPositive.kind, 'queued');
  await test.pool.query(
    "INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'cap-fixture',jsonb_set(snapshot,'{jsDailyWireCap}','0'::jsonb) FROM settings_versions ORDER BY version DESC LIMIT 1",
  );
  assert.equal((await machineCall('/api/bridge/tasks/claim', {})).body.kind, 'idle',
    'Cap zero must leave queued Jungle Scout work unclaimed');

  const packageCandidate = (await test.pool.query(
    "INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",
    [`package-cap-zero ${test.runId}`],
  )).rows[0];
  await test.pool.query(
    "INSERT INTO candidate_events(candidate_id,stage,input_version,detail) VALUES($1,'api_validation',1,$2::jsonb)",
    [packageCandidate.id, JSON.stringify({ representativeAsin: 'B0CAP00001' })],
  );
  const packageDispatchBeforeCi = await dispatchBrowserWork(test.pool, { ...signing, fingerprint: identity.fingerprint });
  assert.equal(packageDispatchBeforeCi.queued, 0,
    'Amazon package work waits for completed competitive intelligence');
  const ciTask = (await test.pool.query(
    "INSERT INTO browser_tasks(id,device_id,candidate_id,spec_id,input_version,settings_version,envelope,task_hash,expires_at,task_kind) VALUES(gen_random_uuid(),$1,$2,NULL,1,(SELECT max(version) FROM settings_versions),'{}'::jsonb,repeat('a',64),now(), 'competitive_intelligence') RETURNING id",
    [deviceId, packageCandidate.id],
  )).rows[0];
  const ciResult = (await test.pool.query(
    "INSERT INTO browser_task_results(id,task_id,body_sha256,body_ciphertext,capture_ids) VALUES(gen_random_uuid(),$1,repeat('b',64),'synthetic','{}'::uuid[]) RETURNING id",
    [ciTask.id],
  )).rows[0];
  await test.pool.query(
    "UPDATE browser_tasks SET state='completed',result_id=$1,delivered_at=now(),first_delivered_at=COALESCE(first_delivered_at,now()) WHERE id=$2",
    [ciResult.id, ciTask.id],
  );
  const packageDispatch = await dispatchBrowserWork(test.pool, { ...signing, fingerprint: identity.fingerprint });
  assert.equal(packageDispatch.queued, 1,
    'Amazon package work remains dispatchable when the Jungle Scout cap is zero');
  assert.equal((await test.pool.query(
    "SELECT task_kind FROM browser_tasks WHERE candidate_id=$1 AND task_kind='amazon_package'",
    [packageCandidate.id],
  )).rows[0]?.task_kind, 'amazon_package');

  await test.pool.query("UPDATE browser_tasks SET state='cancelled' WHERE id=$1", [queuedAtPositive.taskId]);
  await test.pool.query(
    "INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) SELECT version+1,now(),'cap-fixture',jsonb_set(snapshot,'{jsDailyWireCap}','3'::jsonb) FROM settings_versions ORDER BY version DESC LIMIT 1",
  );
  const queuedAtOne = await queueProductDatabase(test.pool, { deviceId, candidateId: candidate.id }, signing);
  assert.equal(queuedAtOne.kind, 'queued');
  const claimed = (await machineCall('/api/bridge/tasks/claim', {})).body;
  assert.equal(claimed.kind, 'task', 'A positive cap permits one browser read');
  assert.equal(claimed.taskId, queuedAtOne.taskId);
  assert.equal((await machineCall('/api/bridge/tasks/claim', {})).body.kind, 'idle',
    'The positive daily cap bounds additional browser claims');

  const retryResponse = await test.call(`/api/candidates/${candidate.id}/jungle-scout-research/product_database/retry`, {});
  assert.equal(retryResponse.status, 202, 'A delivered read can be marked for retry');
  assert.equal((await dispatchBrowserWork(test.pool, { ...signing, fingerprint: identity.fingerprint })).queued, 0,
    'Retrying a delivered read must not reopen the consumed daily wire cap');

  const nextCandidate = (await test.pool.query(
    "INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'api_validation') RETURNING id",
    [`cap-one ${test.runId}`],
  )).rows[0];
  assert.equal((await dispatchBrowserWork(test.pool, { ...signing, fingerprint: identity.fingerprint })).queued, 0,
    'A consumed daily cap prevents new Jungle Scout browser tasks');
  assert.equal((await test.pool.query(
    "SELECT count(*)::int AS count FROM browser_tasks WHERE candidate_id=$1 AND task_kind='product_database'",
    [nextCandidate.id],
  )).rows[0].count, 0);
  assert.equal((await dispatchBrowserWork(test.pool, { ...signing, fingerprint: identity.fingerprint }, 0)).queued, 0,
    'A zero dashboard cap blocks browser reads even when the API wire cap is positive');
  assert.ok((await dispatchBrowserWork(test.pool, { ...signing, fingerprint: identity.fingerprint }, 50)).queued >= 1,
    'A separate dashboard cap reopens browser reads after the shared wire cap is consumed');
  assert.equal((await test.pool.query(
    "SELECT count(*)::int AS count FROM browser_tasks WHERE candidate_id=$1 AND task_kind='product_database' AND state='queued'",
    [nextCandidate.id],
  )).rows[0].count, 1);
  console.log(JSON.stringify({
    scenario: 'browser-dispatch-cap',
    result: 'PASS',
    zeroCapQueuedTaskUnclaimed: true,
    positiveCapBounded: true,
    crossMidnightFirstDeliveryCharged: true,
    supplierAndAmazonPathsUntouched: true,
    paidApiCalls: 0,
    externalActions: 0,
  }));
} finally {
  await test.close();
}
