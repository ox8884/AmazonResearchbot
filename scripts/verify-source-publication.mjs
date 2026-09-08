import {execFileSync} from 'node:child_process';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import path from 'node:path';
import {inspectSource,redactPublicationText} from './support/publication-policy.mjs';
async function main(){
const args=process.argv.slice(2);if(args.length>1||(args[0]&&!['--index','--worktree'].includes(args[0])))throw new Error('Unsupported scan mode');
const mode=process.argv.includes('--worktree')?'worktree':'index';
const git=(args,input)=>execFileSync('git',args,{input,maxBuffer:64*1024*1024,windowsHide:true});
const root=git(['rev-parse','--show-toplevel']).toString().trim();
const protectedValues=[];
for(const name of await readdir(root)){
 if(!/^\.env(?:\.|$)/i.test(name)||name.toLowerCase()==='.env.example')continue;
 const values=parseEnv(await readFile(path.join(root,name),'utf8'));
 for(const [key,value] of Object.entries(values)){
  if(/(?:PASSWORD|TOKEN|SECRET|API_KEY|API_KEY_NAME|ENCRYPTION_KEY)$/i.test(key)&&value.length>=8)protectedValues.push(value);
  const domain=value.includes('@')?value.split('@').at(-1).toLowerCase():'';
  if(/^[^\s@:/]+@[^\s@:/]+\.[^\s@:/]+$/.test(value)&&!['example.com','example.org','example.net'].includes(domain)&&!/(?:\.invalid|\.test|\.example|\.local)$/.test(domain))protectedValues.push(value);
  if(key==='DATABASE_URL'){try{const password=decodeURIComponent(new URL(value).password);if(password.length>=8)protectedValues.push(password);}catch{throw new Error('Local secret inventory could not be parsed');}}
 }
}
let entries=[],baseline;
if(mode==='index'){
 baseline=git(['ls-files','--stage','-z']);
 const records=baseline.toString().split('\0').filter(Boolean).map(line=>{const match=/^(\d+) ([a-f0-9]+) ([0-3])\t([\s\S]+)$/.exec(line);if(!match||match[3]!=='0')throw new Error('Unmerged index cannot be published');return {mode:match[1],oid:match[2],path:match[4]};});
 const objects=git(['cat-file','--batch'],records.map(r=>r.oid).join('\n')+'\n');let offset=0;
 for(const record of records){const end=objects.indexOf(10,offset);const header=objects.subarray(offset,end).toString();const match=/^[a-f0-9]+ blob (\d+)$/.exec(header);if(!match)throw new Error('Index object could not be read');const size=Number(match[1]);offset=end+1;entries.push({...record,content:objects.subarray(offset,offset+size)});offset+=size+1;}
}else{
 const names=[...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean))];
 for(const name of names){try{const info=await lstat(path.join(root,name));entries.push({path:name,mode:info.isSymbolicLink()?'120000':'100644',content:info.isSymbolicLink()?Buffer.alloc(0):await readFile(path.join(root,name))});}catch(error){if(error.code!=='ENOENT')throw error;}}
}
const findings=entries.flatMap(entry=>inspectSource(entry,protectedValues)).map(finding=>({...finding,path:redactPublicationText(finding.path,protectedValues)}));
if(mode==='index'&&!baseline.equals(git(['ls-files','--stage','-z'])))throw new Error('Index changed during inspection');
console.log(JSON.stringify({scenario:'source-publication',scope:'private paths and known credentials only',mode,result:findings.length?'FAIL':'PASS',filesChecked:entries.length,findings},null,2));
if(findings.length)process.exitCode=1;

}
main().catch(()=>{console.error("Source publication check could not complete. Check repository access, local credential inventory and index state.");process.exitCode=2;});
