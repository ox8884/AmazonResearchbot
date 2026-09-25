import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {sendViaCodex} from '../packages/integrations/src/ai/codex-cli.ts';
import {createAiTransport} from '../packages/integrations/src/ai/transport.ts';

const input={protocol:'codex_cli',baseUrl:'https://chatgpt.com/',model:'default',apiKey:'codex-cli-login',maxInputTokens:20000,maxOutputTokens:4000,
 messages:[{role:'system',content:'Return JSON only.'},{role:'user',content:'{"subject":"tray"}'}]};
const fake=(content,code=0)=>{const calls=[];const run=async(args,stdin,env)=>{calls.push({args,stdin,env});
 if(content!==null)await writeFile(args[args.indexOf('-o')+1],content);return code;};return {run,calls};};
const env={PATH:'/usr/bin',HOME:'/var/lib/w',CODEX_HOME:'/var/lib/w/codex',CREDENTIALS_DIRECTORY:'/run/credentials/w',ENCRYPTION_KEY:'secret'};

const ok=fake('```json\n{"role":"niche_analysis"}\n```');
const result=await sendViaCodex(input,ok.run,env);
assert.deepEqual(result,{kind:'response',status:200,body:{choices:[{message:{content:'{"role":"niche_analysis"}'}}]}},'A fenced final message is unwrapped into a chat-completions body');
const {args,stdin,env:childEnv}=ok.calls[0];
for(const feature of ['shell_tool','unified_exec','apps','plugins','hooks','browser_use','computer_use','in_app_browser'])
 assert.ok(args.some((arg,i)=>arg==='--disable'&&args[i+1]===feature),'Codex runs without '+feature);
assert.equal(args[args.indexOf('--sandbox')+1],'read-only');assert.ok(args.includes('--ephemeral'));assert.equal(args.at(-1),'-');
assert.ok(!args.includes('-m'),'The "default" model leaves the CLI default');
assert.equal(path.basename(args[args.indexOf('-C')+1]).startsWith('forge-codex-'),true,'Runs in an empty temporary directory');
assert.equal(stdin,'Instructions:\nReturn JSON only.\n\nData:\n{"subject":"tray"}');
assert.deepEqual(Object.keys(childEnv).filter(k=>childEnv[k]!==undefined).sort(),['CODEX_HOME','HOME','PATH'],'Credentials and keys never reach the agent environment');

assert.deepEqual((await sendViaCodex({...input,model:'gpt-5.5'},fake('{}').run,env)),{kind:'response',status:200,body:{choices:[{message:{content:'{}'}}]}});
const named=fake('{}');await sendViaCodex({...input,model:'gpt-5.5'},named.run,env);assert.equal(named.calls[0].args[named.calls[0].args.indexOf('-m')+1],'gpt-5.5');
assert.deepEqual(await sendViaCodex(input,fake(null,1).run,env),{kind:'response',status:502,body:null},'A failed run (plan limit, signed out) is a dispatched failure');
assert.deepEqual(await sendViaCodex(input,fake(null,null).run,env),{kind:'unknown',code:'PROVIDER_OUTCOME_UNKNOWN'},'A timeout or spawn failure has an unknown outcome');
assert.deepEqual(await sendViaCodex({...input,maxInputTokens:10},fake('{}').run,env),{kind:'not_sent',code:'PROVIDER_INPUT_TOO_LARGE'});

let routed=null;const transport=createAiTransport(true,{codex:async value=>{routed=value;return {kind:'response',status:200,body:null};}});
await transport.send(input);assert.equal(routed?.protocol,'codex_cli','codex_cli profiles route to the CLI, not HTTP');
console.log(JSON.stringify({scenario:'ai-codex-cli',result:'PASS',toolsDisabled:true,minimalEnv:true,fenceUnwrapped:true,failureMapped:true}));
