import { AI_TEST_PROMPT } from "../packages/domain/src/ai-test.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { executeApprovedSyntheticAiTest } from "../packages/integrations/src/ai/execute.ts";
import { openAcceptance } from "./support/acceptance.mjs";

const encryptionKeyHex = "11".repeat(32);
const encryptionKey = Buffer.from(encryptionKeyHex, "hex");
let apiWires=0;
const test = await openAcceptance({
  databaseKey: `ai-execution-${Date.now()}`,
  encryptionKeyHex,
  aiTransport:{kind:"ready",send:async()=>{apiWires++;return {kind:"response",status:200,body:{choices:[{message:{content:'{"forge_test":"ok"}'}}],usage:{prompt_tokens:9,completion_tokens:4}}};}},
});

const at = new Date("2120-01-02T03:04:05.000Z");
const fixedPrompt = AI_TEST_PROMPT;

function profile(name, model, priority, apiKey) {
  return {
    name,
    model,
    baseUrl: `https://${model}.fixture.invalid/v1`,
    apiKey,
    dailyBudgetUsd: "0.02",
    roles: ["normalize"],
    priority,
    inputUsdPerMillion: "1.000000",
    outputUsdPerMillion: "2.000000",
    maxInputTokens: 1024,
    maxOutputTokens: 256,
    retentionPolicyUrl: null,
    version: 0,
  };
}

async function activeProfile(input) {
  const saved = await test.call("/api/custom-ai", input);
  assert.equal(saved.status, 201);
  const proposal = await test.call(
    `/api/custom-ai/${saved.body.profile.id}/activation-proposals`,
    { version: 1 },
  );
  assert.equal(proposal.status, 201);
  const approved = await test.call(`/api/approvals/${proposal.body.approvalId}/approve`, {});
  assert.equal(approved.status, 200);
  return saved.body.profile;
}

let primaryCalls = 0;
let secondaryCalls = 0;
let factories = 0;

function transportFor(kind) {
  return () => {
    factories += 1;
    return {
      kind: "ready",
      send: async (input) => {
        assert.deepEqual(input.messages, [{ role: "user", content: fixedPrompt }]);
        assert.equal(input.maxInputTokens, 1024);
        assert.equal(input.maxOutputTokens, 256);
        if (input.model === "primary-model") primaryCalls += 1;
        if (input.model === "secondary-model") secondaryCalls += 1;
        if (kind === "not_sent" && input.model === "primary-model")
          return { kind: "not_sent", code: "SYNTHETIC_NOT_SENT" };
        if (kind === "unknown") return { kind: "unknown", code: "SYNTHETIC_UNKNOWN" };
        return {
          kind: "response",
          status: 200,
          body: {
            choices: [{ message: { content: '{"forge_test":"ok"}' } }],
            usage: { prompt_tokens: 9, completion_tokens: 4 },
          },
        };
      },
    };
  };
}

try {
  const primary = await activeProfile(profile("Primary", "primary-model", 1, "SYNTHETIC_PRIMARY_KEY"));
  const secondary = await activeProfile(profile("Secondary", "secondary-model", 2, "SYNTHETIC_SECONDARY_KEY"));

  const first = await executeApprovedSyntheticAiTest(test.pool, {
    operationId: randomUUID(), role: "normalize", mode: "activation-approved-only",
    encryptionKey, createTransport: transportFor("success"), now: at,
  });
  assert.equal(first.kind, "succeeded");
  assert.equal(first.profileId, primary.id);
  assert.equal(primaryCalls, 1);
  assert.equal(secondaryCalls, 0);

  const fallback = await executeApprovedSyntheticAiTest(test.pool, {
    operationId: randomUUID(), role: "normalize", mode: "activation-approved-only",
    encryptionKey, createTransport: transportFor("not_sent"), now: at,
  });
  assert.equal(fallback.kind, "succeeded");
  assert.equal(fallback.profileId, secondary.id);
  assert.equal(primaryCalls, 2);
  assert.equal(secondaryCalls, 1);

  const disabled = await test.call(`/api/custom-ai/${primary.id}/disable`, { version: 1 });
  assert.equal(disabled.status, 200);
  const beforeInactive = primaryCalls;
  const inactive = await executeApprovedSyntheticAiTest(test.pool, {
    operationId: randomUUID(), role: "normalize", mode: "activation-approved-only",
    encryptionKey, createTransport: transportFor("success"), now: at,
  });
  assert.equal(inactive.kind, "succeeded");
  assert.equal(primaryCalls, beforeInactive);
  assert.equal(secondaryCalls, 2);

  const budgetAt = new Date("2120-01-03T03:04:05.000Z");
  await test.pool.query(
    "INSERT INTO ai_provider_day_costs(profile_id,day_utc,reserved_usd,consumed_usd) VALUES($1,$2::date,0,0.02)",
    [secondary.id, budgetAt.toISOString().slice(0, 10)],
  );
  const beforeBudget = secondaryCalls;
  const budget = await executeApprovedSyntheticAiTest(test.pool, {
    operationId: randomUUID(), role: "normalize", mode: "activation-approved-only",
    encryptionKey, createTransport: transportFor("success"), now: budgetAt,
  });
  assert.equal(budget.kind, "budget_blocked");
  assert.equal(secondaryCalls, beforeBudget);

  const unknownOperationId = randomUUID();
  const unknown = await executeApprovedSyntheticAiTest(test.pool, {
    operationId: unknownOperationId, role: "normalize", mode: "activation-approved-only",
    encryptionKey, createTransport: transportFor("unknown"), now: at,
  });
  assert.equal(unknown.kind, "outcome_unknown");
  const beforeUnknownRepeat = secondaryCalls;
  const unknownRepeat = await executeApprovedSyntheticAiTest(test.pool, {
    operationId: unknownOperationId, role: "normalize", mode: "activation-approved-only",
    encryptionKey, createTransport: transportFor("success"), now: at,
  });
  assert.equal(unknownRepeat.kind, "already_handled");
  assert.equal(secondaryCalls, beforeUnknownRepeat);
  assert.deepEqual(
    (await test.pool.query("SELECT reserved_usd,consumed_usd FROM ai_provider_day_costs WHERE profile_id=$1 AND day_utc=$2::date", [secondary.id, at.toISOString().slice(0, 10)])).rows[0],
    { reserved_usd: "0.001536", consumed_usd: "0.003072" },
  );

  const repeatedOperationId = randomUUID();
  const repeated = await executeApprovedSyntheticAiTest(test.pool, {
    operationId: repeatedOperationId, role: "normalize", mode: "activation-approved-only",
    encryptionKey, createTransport: transportFor("success"), now: at,
  });
  assert.equal(repeated.kind, "succeeded");
  const beforeRepeated = secondaryCalls;
  const duplicate = await executeApprovedSyntheticAiTest(test.pool, {
    operationId: repeatedOperationId, role: "normalize", mode: "activation-approved-only",
    encryptionKey, createTransport: transportFor("success"), now: at,
  });
  assert.equal(duplicate.kind, "already_handled");
  assert.equal(secondaryCalls, beforeRepeated);
  assert.ok(!JSON.stringify([first, fallback, inactive, budget, unknown, repeated, duplicate]).includes("SYNTHETIC_"));

  const grant=await test.call(`/api/custom-ai/${primary.id}/test-proposals`,{version:2,role:'normalize'});assert.equal(grant.status,201);
  assert.equal((await test.call(`/api/approvals/${grant.body.approvalId}/approve`,{})).status,200);
  const grantInput={operationId:grant.body.payload.operationId,grantApprovalId:grant.body.approvalId,role:'normalize',mode:'test',encryptionKey,createTransport:transportFor('success'),now:at};
  const beforeGrant=primaryCalls;
  const grantRun=await executeApprovedSyntheticAiTest(test.pool,grantInput);assert.equal(grantRun.kind,'succeeded');assert.equal(grantRun.profileId,primary.id);
  assert.equal((await executeApprovedSyntheticAiTest(test.pool,grantInput)).kind,'already_handled');assert.equal(primaryCalls,beforeGrant+1);
  assert.equal((await test.call('/api/custom-ai')).body.profiles.find(p=>p.id===primary.id).status,'disabled','Test grant must not enable normal routing');
  const wrongOperation=await executeApprovedSyntheticAiTest(test.pool,{...grantInput,operationId:randomUUID()});assert.equal(wrongOperation.kind,'no_provider');assert.equal(primaryCalls,beforeGrant+1);
  const forged=await test.call(`/api/custom-ai/${primary.id}/test-proposals`,{version:2,role:'normalize'});assert.equal(forged.status,201);
  await test.call(`/api/approvals/${forged.body.approvalId}/approve`,{});
  await test.pool.query("UPDATE approvals SET payload_hash=repeat('0',64) WHERE id=$1",[forged.body.approvalId]);
  assert.equal((await executeApprovedSyntheticAiTest(test.pool,{...grantInput,operationId:forged.body.payload.operationId,grantApprovalId:forged.body.approvalId})).kind,'no_provider');assert.equal(primaryCalls,beforeGrant+1);
  const raceInput={operationId:randomUUID(),role:'normalize',mode:'activation-approved-only',encryptionKey,createTransport:transportFor('success'),now:at};
  const beforeRace=secondaryCalls;const raced=await Promise.all([executeApprovedSyntheticAiTest(test.pool,raceInput),executeApprovedSyntheticAiTest(test.pool,raceInput)]);
  assert.deepEqual(raced.map(r=>r.kind).sort(),['already_handled','succeeded']);assert.equal(secondaryCalls,beforeRace+1);

  const apiGrant=await test.call(`/api/custom-ai/${primary.id}/test-proposals`,{version:2,role:'normalize'});assert.equal(apiGrant.status,201);
  const runPath=`/api/custom-ai/${primary.id}/tests/${apiGrant.body.approvalId}/run`;
  assert.equal((await test.call(runPath,{})).status,409);assert.equal(apiWires,0);
  await test.call(`/api/approvals/${apiGrant.body.approvalId}/approve`,{});
  const apiRun=await test.call(runPath,{});assert.equal(apiRun.status,200);assert.equal(apiRun.body.result.kind,'succeeded');
  assert.equal((await test.call(runPath,{})).body.result.kind,'already_handled');assert.equal(apiWires,1);
  const apiHistory=await test.call(`/api/custom-ai/${primary.id}/tests`);assert.equal(apiHistory.status,200);assert.equal(apiHistory.body.tests.find(row=>row.id===apiGrant.body.approvalId).execution.state,'succeeded');

  const utcGrant=await test.call(`/api/custom-ai/${primary.id}/test-proposals`,{version:2,role:'normalize'});
  await test.call(`/api/approvals/${utcGrant.body.approvalId}/approve`,{});
  let ticks=0;const beforeUtc=primaryCalls;
  const utcResult=await executeApprovedSyntheticAiTest(test.pool,{...grantInput,operationId:utcGrant.body.payload.operationId,grantApprovalId:utcGrant.body.approvalId,clock:()=>new Date(++ticks===1?'2120-01-04T23:59:59Z':'2120-01-05T00:00:00Z')});
  assert.equal(utcResult.kind,'failed_non_dispatch');assert.equal(primaryCalls,beforeUtc);
  const slowId=randomUUID();let startedResolve,finishResolve;const started=new Promise(resolve=>{startedResolve=resolve;});const finished=new Promise(resolve=>{finishResolve=resolve;});
  const slow=executeApprovedSyntheticAiTest(test.pool,{...raceInput,operationId:slowId,createTransport:()=>({kind:'ready',send:async input=>{startedResolve();await finished;return transportFor('success')().send(input);}})});
  await started;
  const heldBefore=(await test.pool.query('SELECT reserved_usd FROM ai_provider_day_costs WHERE profile_id=$1 AND day_utc=$2',[secondary.id,at.toISOString().slice(0,10)])).rows[0].reserved_usd;
  await test.pool.query("UPDATE ai_execution_attempts SET created_at=now()-interval '10 minutes' WHERE operation_id=$1",[slowId]);
  await test.call(`/api/custom-ai/${secondary.id}/tests`);
  assert.equal((await test.pool.query('SELECT state FROM ai_execution_operations WHERE id=$1',[slowId])).rows[0].state,'outcome_unknown');
  assert.equal((await test.pool.query('SELECT reserved_usd FROM ai_provider_day_costs WHERE profile_id=$1 AND day_utc=$2',[secondary.id,at.toISOString().slice(0,10)])).rows[0].reserved_usd,heldBefore);
  finishResolve();assert.equal((await slow).kind,'outcome_unknown','Late response cannot report unrecorded success');
  assert.equal((await executeApprovedSyntheticAiTest(test.pool,{...raceInput,operationId:slowId})).kind,'already_handled');

  const atomicId=randomUUID(), triggerName=`ai_atomic_${test.runId}`;
  await test.pool.query(`CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_id='${atomicId}'::uuid AND NEW.state='dispatching' THEN RAISE EXCEPTION 'synthetic dispatch transition failure'; END IF; RETURN NEW; END $$`);
  await test.pool.query(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON ai_execution_attempts FOR EACH ROW EXECUTE FUNCTION ${triggerName}()`);
  const beforeAtomicCalls=secondaryCalls;
  const beforeAtomicBudget=(await test.pool.query('SELECT reserved_usd FROM ai_provider_day_costs WHERE profile_id=$1 AND day_utc=$2',[secondary.id,at.toISOString().slice(0,10)])).rows[0].reserved_usd;
  try{await assert.rejects(executeApprovedSyntheticAiTest(test.pool,{...raceInput,operationId:atomicId}),/synthetic dispatch transition failure/);}
  finally{await test.pool.query(`DROP TRIGGER ${triggerName} ON ai_execution_attempts`);await test.pool.query(`DROP FUNCTION ${triggerName}()`);}
  assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM ai_execution_operations WHERE id=$1',[atomicId])).rows[0].n,0,'Reservation and dispatch transition must commit atomically');
  assert.equal((await test.pool.query('SELECT count(*)::int AS n FROM ai_execution_attempts WHERE operation_id=$1',[atomicId])).rows[0].n,0);
  assert.equal((await test.pool.query('SELECT reserved_usd FROM ai_provider_day_costs WHERE profile_id=$1 AND day_utc=$2',[secondary.id,at.toISOString().slice(0,10)])).rows[0].reserved_usd,beforeAtomicBudget);
  assert.equal(secondaryCalls,beforeAtomicCalls);

  console.log(JSON.stringify({
    scenario: "ai-execution", result: "PASS", twoProvidersPrioritySelected: true,
    inactiveCalls: 0, budgetCalls: 0, unknownRepeatCalls: 0,
    repeatedOperationCalls: 0, strictSyntheticResponse: true, oneTimeGrant:true,authorizationDispatchAtomic:true,utcRolloverBlocked:true,overdueReservationHeld:true,lateSuccessNotMisreported:true,apiExecutionIdempotent:true, forgedGrantBlocked:true, concurrentDuplicateBlocked:true, realProviderCalls: 0,
    factories,
  }));
} finally {
  await test.close();
}
