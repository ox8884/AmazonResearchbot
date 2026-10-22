import {StringDecoder} from 'node:string_decoder';
import {launchAside} from './aside-cli.mjs';
import {protectAsideSession} from './aside-daemon-session.mjs';
import {alibabaNegotiationDecisionSchema} from '../../packages/domain/src/alibaba.ts';

function parseDecisionText(text){
 try{return JSON.parse(text);}catch{}
 let quoted=false,escaped=false,normalized='';
 for(const character of text){
  if(quoted&&['\n','\r','\t'].includes(character)){
   if(escaped)throw Error('AI_RESPONSE_INVALID');
   normalized+=JSON.stringify(character).slice(1,-1);
   continue;
  }
  normalized+=character;
  if(escaped){escaped=false;continue;}
  if(quoted&&character==='\\'){escaped=true;continue;}
  if(character==='"')quoted=!quoted;
 }
 try{return JSON.parse(normalized);}catch{throw Error('AI_RESPONSE_INVALID');}
}

export function readAsideDecision(messages,session,expected,prompt){
 if(!Array.isArray(messages)||session?.status!=='idle'||
  !['provider','modelId','thinkingLevel','fastMode'].every(key=>session.model?.[key]===expected[key]))throw Error('AI_RESPONSE_INVALID');
 const users=messages.filter(message=>message.role==='user');
 if(users.length!==1||users[0].content?.length!==1||users[0].content[0].type!=='text'||users[0].content[0].text!==prompt)throw Error('AI_RESPONSE_INVALID');
 if(messages.some(message=>!message||!['user','assistant','system-message','turn-lifecycle'].includes(message.role)||message.errorMessage||message.isError||
  (message.role==='assistant'&&['error','aborted'].includes(message.stopReason))||
  (Array.isArray(message.content)&&message.content.some(part=>part.type==='toolCall'))))throw Error('AI_RESPONSE_INVALID');
 const final=messages.findLast(message=>message.role==='assistant');
 if(!final||final.stopReason!=='stop'||final.provider!==expected.provider||final.model!==expected.modelId||
  !Array.isArray(final.content)||final.content.some(part=>!['text','thinking'].includes(part.type)))throw Error('AI_RESPONSE_INVALID');
 let text=final.content.filter(part=>part.type==='text').map(part=>part.text).join('\n').trim();
 if(Buffer.byteLength(text,'utf8')>32768)throw Error('AI_RESPONSE_INVALID');
 const fence=/^\x60{3}(?:json)?\s*\n([\s\S]*?)\n\x60{3}$/.exec(text);
 if(fence)text=fence[1];
 const value=parseDecisionText(text);
 const decision=alibabaNegotiationDecisionSchema.safeParse(value);
 if(!decision.success)throw Error('AI_RESPONSE_INVALID');
 return {decision:decision.data,execution:{sessionId:session.id,provider:final.provider,model:final.model}};
}

export function createdAsideSession(stderr){
 return /created new session: ([A-Za-z0-9_-]{1,100})(?:\x1b|\r|\n)/.exec(stderr)?.[1];
}

async function stopOwnedSession(configuration,sessionId,deadline){
 if(!sessionId)return;
 const remaining=deadline-Date.now();
 if(remaining<=0)return;
 await new Promise(resolve=>{
  const child=launchAside(configuration,['session','stop','--account',configuration.accountId,sessionId],['ignore','ignore','ignore']);
  const timer=setTimeout(()=>{child.kill();resolve();},Math.min(5000,remaining));
  child.once('error',()=>{clearTimeout(timer);resolve();});
  child.once('close',()=>{clearTimeout(timer);resolve();});
 });
}

export function createAsideModelRunner(configuration){
 return async(prompt,{deadline})=>{
  if(!Number.isFinite(deadline)||deadline-Date.now()<=6000)throw Error('AI_UNAVAILABLE');
  const workDeadline=deadline-5000;
  const child=launchAside(configuration,['exec','--account',configuration.accountId,'--host','local'],['pipe','pipe','pipe']);
  let sessionId,stderr='',bytes=0,settled=false,resolveCreated,rejectFailure;
  const created=new Promise(resolve=>{resolveCreated=resolve;});
  const failed=new Promise((_,reject)=>{rejectFailure=reject;});
  const fail=()=>{if(!settled)rejectFailure(Error('AI_UNAVAILABLE'));};
  const exited=new Promise(resolve=>{child.once('close',code=>{resolve(code);if(!sessionId)fail();});});
  const timer=setTimeout(fail,Math.max(1,workDeadline-Date.now())),decoder=new StringDecoder('utf8');
  child.once('error',fail);child.stdin.on('error',fail);
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024)fail();});
  child.stderr.on('data',chunk=>{
   stderr+=decoder.write(chunk);
   if(stderr.length>65536){fail();return;}
   const id=createdAsideSession(stderr);
   if(id&&!sessionId){sessionId=id;resolveCreated(sessionId);}
  });
  try{
   const work=async()=>{
    await created;
    const isolated=await protectAsideSession(configuration,sessionId,workDeadline);
    if(settled||Date.now()>=workDeadline)throw Error('AI_UNAVAILABLE');
    // EOF starts generation only after runtime policy readback succeeds.
    child.stdin.end(prompt);
    if(await exited!==0)throw Error('AI_UNAVAILABLE');
    const {messages,session}=await isolated.read();
    return readAsideDecision(messages,session,isolated.model,prompt);
   };
   return await Promise.race([work(),failed]);
  }catch(error){
   settled=true;child.stdin.destroy();
   try{await stopOwnedSession(configuration,sessionId,deadline);}catch{}
   throw Error(error?.message==='AI_RESPONSE_INVALID'?'AI_RESPONSE_INVALID':'AI_UNAVAILABLE');
  }finally{settled=true;clearTimeout(timer);child.kill();}
 };
}
