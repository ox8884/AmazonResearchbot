import https from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { isIP } from 'node:net';
import type { ResolvedTarget } from './egress.ts';
import { isAllowedAddress } from './ip-policy.ts';
export class HttpBoundaryError extends Error {constructor(readonly code:string){super(code);}}
export type HttpJsonResponse={status:number;body:unknown;retryAfter:string|null;mcpSessionId?:string};
export type JsonRequest={method:'GET'|'POST';headers:Readonly<Record<string,string>>;body?:string};
export async function pinnedJsonRequest(target:Readonly<ResolvedTarget>,input:JsonRequest):Promise<HttpJsonResponse> {
  const origin=new URL(target.origin);
  if(origin.protocol!=='https:'||origin.username||origin.password||(origin.port&&origin.port!=='443')||origin.hostname.replace(/^\[|\]$/g,'')!==target.hostname||!isAllowedAddress(target.address)||isIP(target.address)!==target.family||!target.path.startsWith('/')||/[\r\n]/.test(target.path))throw new HttpBoundaryError('TARGET_REJECTED');
  const headers:Record<string,string>={};
  for(const [name,value] of Object.entries(input.headers)){
    const key=name.toLowerCase();
    if(!/^[a-z0-9-]+$/.test(key)||['host','connection','cookie','proxy-authorization','transfer-encoding','content-length','upgrade'].includes(key)||/[\r\n\0]/.test(value))throw new HttpBoundaryError('HEADER_REJECTED');
    headers[key]=value;
  }
  headers.host=origin.host;headers["accept-encoding"]="identity";if(input.body!==undefined)headers['content-length']=String(Buffer.byteLength(input.body));
  return new Promise((resolve,reject)=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    const fail=(code:string)=>{if(timer)clearTimeout(timer);reject(new HttpBoundaryError(code));};
    try {
      const req=https.request({hostname:target.address,family:target.family,port:443,path:target.path,method:input.method,headers,agent:false,rejectUnauthorized:true,...(isIP(target.hostname)?{}:{servername:target.hostname}),checkServerIdentity:(_host,cert)=>checkServerIdentity(target.hostname,cert)},response=>{
        const chunks:Buffer[]=[];let size=0;
        response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>4*1024*1024){fail('RESPONSE_TOO_LARGE');response.destroy();req.destroy();return;}chunks.push(chunk);});
        response.on('aborted',()=>fail('NETWORK_OUTCOME_UNKNOWN'));response.on('error',()=>fail('NETWORK_OUTCOME_UNKNOWN'));
        response.on('end',()=>{if(timer)clearTimeout(timer);if(typeof response.statusCode!=="number"){fail('INVALID_HTTP_RESPONSE');return;}const text=Buffer.concat(chunks).toString('utf8');let body:unknown=null;try{body=text?JSON.parse(text):null;}catch{body=text;}resolve({status:response.statusCode,body,...(typeof response.headers['mcp-session-id']==='string'?{mcpSessionId:response.headers['mcp-session-id']}:{}),retryAfter:typeof response.headers['retry-after']==='string'?response.headers['retry-after']:null});});
      });
      req.on('error',()=>fail('NETWORK_OUTCOME_UNKNOWN'));timer=setTimeout(()=>{fail('REQUEST_TIMEOUT');req.destroy();},30000);
      req.end(input.body);
    }catch{fail('REQUEST_SETUP_FAILED');}
  });
}
