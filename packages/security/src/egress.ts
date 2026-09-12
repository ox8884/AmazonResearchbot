import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { isAllowedAddress } from './ip-policy.ts';
export type EgressDecision={ok:true;url:URL;hostname:string}|{ok:false;code:string};
export type HostResolver=(hostname:string)=>Promise<readonly {address:string;family:number}[]>;
export type ResolvedTarget={hostname:string;address:string;family:4|6;path:string;origin:string};
export type ResolvedDecision={ok:true;target:Readonly<ResolvedTarget>}|{ok:false;code:string};
export function authorizeUrl(raw:string,allowedHosts:Readonly<Record<string,true>>):EgressDecision {
  let url:URL;try{url=new URL(raw);}catch{return {ok:false,code:'URL_INVALID'};}
  if(url.protocol!=='https:')return {ok:false,code:'HTTPS_ONLY'};
  if(url.username||url.password)return {ok:false,code:'USERINFO_FORBIDDEN'};
  if(url.port&&url.port!=='443')return {ok:false,code:'PORT_FORBIDDEN'};
  if(url.hash)return {ok:false,code:'FRAGMENT_FORBIDDEN'};
  const hostname=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();
  const family=isIP(hostname);
  if(family){if(!isAllowedAddress(hostname))return {ok:false,code:'NON_PUBLIC_ADDRESS'};}
  else {
    if(hostname.length>253||!hostname.includes('.')||!hostname.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))return {ok:false,code:'HOST_INVALID'};
    if(['localhost','local','internal','lan','home'].some(suffix=>hostname===suffix||hostname.endsWith('.'+suffix)))return {ok:false,code:'PRIVATE_HOST'};
  }
  if(!((Object.hasOwn(allowedHosts,hostname)&&allowedHosts[hostname]===true)||(Object.hasOwn(allowedHosts,url.hostname)&&allowedHosts[url.hostname]===true)))return {ok:false,code:'HOST_NOT_ALLOWED'};
  url.hostname=family===6?'['+hostname+']':hostname;
  return {ok:true,url,hostname};
}
export async function resolveApprovedTarget(raw:string,allowedHosts:Readonly<Record<string,true>>,resolver:HostResolver=host=>lookup(host,{all:true,verbatim:true})):Promise<ResolvedDecision> {
  const decision=authorizeUrl(raw,allowedHosts);if(!decision.ok)return decision;
  const family=isIP(decision.hostname);
  let addresses:readonly {address:string;family:number}[];
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{addresses=family?[{address:decision.hostname,family}]:await Promise.race([resolver(decision.hostname),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS timeout')),5000);})]);}catch{return {ok:false,code:'DNS_FAILED'};}finally{if(timer)clearTimeout(timer);}
  if(addresses.length===0||addresses.some(item=>!isAllowedAddress(item.address)||isIP(item.address)!==item.family))return {ok:false,code:'DNS_NON_PUBLIC'};
  const selected=addresses[0];if(!selected||(selected.family!==4&&selected.family!==6))return {ok:false,code:'DNS_FAILED'};
  return {ok:true,target:Object.freeze({hostname:decision.hostname,address:selected.address,family:selected.family,path:decision.url.pathname+decision.url.search,origin:decision.url.origin})};
}
