import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {createPool} from '../../packages/db/src/client.ts';
const mode=process.argv[2];assert.ok(['before','after','runtime'].includes(mode));
const root=new URL('../../',import.meta.url),envBytes=await readFile(new URL('.env',root));
const env=parseEnv(envBytes.toString('utf8')),url=new URL(env.DATABASE_URL);
assert.ok(env.APP_ENV==='development'&&['127.0.0.1','localhost'].includes(url.hostname)&&url.port==='5433'&&url.pathname==='/forge_ops');
const pool=createPool(url.toString());
const file=new URL('.omo/evidence/bridge-main-activation/main-state-before.json',root);
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 const identity=(await pool.query('SELECT environment FROM deployment_identity')).rows;assert.equal(identity.length,1);assert.equal(identity[0].environment,'development');
 const prior=mode==='before'?null:JSON.parse(await readFile(file,'utf8'));
 const columns=prior?.columns??(await pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name<>'schema_migrations' ORDER BY table_name,ordinal_position")).rows;
 const tables=[...new Set(columns.map(row=>row.table_name))],fingerprints={};
 for(const table of tables){
  const projection=columns.filter(row=>row.table_name===table).map(row=>quote(row.column_name)).join(',');
  fingerprints[table]=(await pool.query(`SELECT count(*)::int AS count,encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') AS sha256 FROM (SELECT ${projection} FROM public.${quote(table)}) t`)).rows[0];
 }
 const counts=(await pool.query('SELECT (SELECT count(*)::int FROM candidates) AS candidates,(SELECT count(*)::int FROM supplier_quotes) AS quotes,(SELECT count(*)::int FROM rfq_drafts) AS rfqs,(SELECT count(*)::int FROM bridge_devices) AS bridge_devices,(SELECT count(*)::int FROM external_actions) AS external_actions')).rows[0];
 const latest=(await pool.query('SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1')).rows[0].id;
 if(mode==='before'){
  await writeFile(file,JSON.stringify({columns,fingerprints,counts,latest,envBytes:envBytes.length,envSha256:hash(envBytes)},null,2),{flag:'wx'});
  console.log(JSON.stringify({mode,latest,counts,tables:tables.length}));
 }else{
  const changed=tables.filter(table=>JSON.stringify(fingerprints[table])!==JSON.stringify(prior.fingerprints[table]));
  const allowed=mode==='runtime'?['audit_events']:[];
  const unexpected=changed.filter(table=>!allowed.includes(table));
  assert.equal(hash(envBytes.subarray(0,prior.envBytes)),prior.envSha256,'Existing environment bytes must be preserved');
  assert.equal(unexpected.length,0,'Unexpected changed tables: '+unexpected.join(','));
  assert.deepEqual(counts,prior.counts);
  const proof={mode,latest,counts,oldColumnsPreserved:true,oldEnvironmentPrefixPreserved:true,changedTables:changed,tables:tables.length};
  await writeFile(new URL('.omo/evidence/bridge-main-activation/main-state-'+mode+'.json',root),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
 }
}finally{await pool.end();}
