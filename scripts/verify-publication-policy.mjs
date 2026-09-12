import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectSource,privateSourcePath} from './support/publication-policy.mjs';
for(const name of ['apps/edge/.dev.vars','.dev.vars.production','.env','.ENV.junglescout','ops/runtime.env','.omo/evidence/a.json','apps/web/qa/a.png','data/backup.fops','worker-authority.json','docs/verification-quotes-state.json'])assert.ok(privateSourcePath(name),name);
for(const name of ['apps/edge/.dev.vars.example','.env.example','ops/runtime.env.example','ops/worker-authority.example.json','packages/db/sql/0030_summary_deliveries.sql'])assert.equal(privateSourcePath(name),null,name);
const privateHeader='-----BEGIN '+'PRIVATE KEY-----';assert.equal(inspectSource({path:'src/key.ts',mode:'100644',content:Buffer.from(privateHeader)}).length,1);
for(const token of ['fbd_'+'a'.repeat(64),'fbp_'+'b'.repeat(64),'cfast_'+'c'.repeat(48),'ghp_'+'a'.repeat(36),'sk-proj-'+'b'.repeat(40)])assert.equal(inspectSource({path:'src/token.ts',mode:'100644',content:Buffer.from(token)}).length,1);
const secret='SYNTHETIC_PUBLICATION_PRIVATE_7392';assert.equal(inspectSource({path:'src/config.ts',mode:'100644',content:Buffer.from(secret)},[secret]).length,1);
assert.equal(inspectSource({path:secret+'.txt',mode:'100644',content:Buffer.from('Public')},[secret]).length,1);
const folder=await mkdtemp(path.join(tmpdir(),'forge-publication-'));
const command=fileURLToPath(new URL('./verify-source-publication.mjs',import.meta.url));
const git=(args)=>execFileSync('git',args,{cwd:folder,windowsHide:true,stdio:'pipe'});
const check=()=>spawnSync(process.execPath,[command],{cwd:folder,encoding:'utf8',windowsHide:true});
try{
 git(['init','-q']);await writeFile(path.join(folder,'.env'),'PRIVATE_TOKEN='+secret+String.fromCharCode(10)+'DATABASE_URL=postgres://forge:forge@127.0.0.1:5433/forge_ops');await writeFile(path.join(folder,'.gitignore'),'.env\n');await writeFile(path.join(folder,'safe.txt'),'Public source postgres://forge:forge@127.0.0.1:5433/forge_ops');git(['add','safe.txt','.gitignore']);assert.equal(check().status,0);
 git(['add','-f','.env']);let result=check();assert.equal(result.status,1);assert.ok(!result.stdout.includes(secret));git(['rm','--cached','.env']);
 const privateName='.env.'+secret;await writeFile(path.join(folder,privateName),'PRIVATE_TOKEN='+secret);git(['add','-f',privateName]);result=check();assert.equal(result.status,1);assert.ok(!result.stdout.includes(secret));git(['rm','--cached',privateName]);
 await writeFile(path.join(folder,'safe.txt'),secret);git(['add','safe.txt']);result=check();assert.equal(result.status,1);assert.ok(!result.stdout.includes(secret));
 await writeFile(path.join(folder,'safe.txt'),'Changed working file after staging');assert.equal(check().status,1,'Scanner must inspect staged bytes, not working-file replacements');
 await mkdir(path.join(folder,'apps/edge'),{recursive:true});
 const binding='SYNTHETIC_EDGE_BINDING_4281';
 await writeFile(path.join(folder,'apps/edge/.dev.vars'),'ACCESS_CLIENT_SECRET='+binding);
 await writeFile(path.join(folder,'safe.txt'),binding);git(['add','safe.txt']);result=check();assert.equal(result.status,1);assert.ok(!result.stdout.includes(binding));
 console.log(JSON.stringify({scenario:'publication-policy',result:'PASS',ignoredFileForceAddBlocked:true,knownSecretBlocked:true,stagedBytesChecked:true,secretValuesNotPrinted:true}));
}finally{if(path.dirname(path.resolve(folder))!==path.resolve(tmpdir())||!path.basename(folder).startsWith('forge-publication-'))throw new Error('Unsafe fixture cleanup path');await rm(folder,{recursive:true,force:true});}
