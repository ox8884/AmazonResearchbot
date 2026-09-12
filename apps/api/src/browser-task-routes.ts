import type { PgBoss } from "pg-boss";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "@forge-ops/db";
import { z } from "zod";
import { readBridgeIdentity } from "./bridge-device-store.ts";
import { claimBrowserTask, readBrowserTask } from "./browser-task-store.ts";
import { acceptBrowserTaskResult } from "./browser-task-result.ts";
const idParams=z.object({id:z.string().uuid()});
const resultBody=z.object({taskHash:z.string().regex(/^[a-f0-9]{64}$/),observation:z.unknown()}).strict();

export function registerBrowserTaskRoutes(app:FastifyInstance,pool:Pool,options:{readonly boss:PgBoss;readonly encryptionKey:Buffer;readonly webOrigin:string}) {
 const identity=async(request:FastifyRequest)=>{
  const match=/^Bearer (fbd_[a-f0-9]{64})$/.exec(request.headers.authorization??"");
  return match?.[1]?readBridgeIdentity(pool,match[1]):null;
 };
 const originAllowed=(request:FastifyRequest)=>!request.headers.origin||request.headers.origin===options.webOrigin;
 app.post("/api/bridge/tasks/claim",async(request,reply)=>{
  if(!originAllowed(request))return reply.status(403).send({code:"ORIGIN_REJECTED"});
  const device=await identity(request);
  if(!device)return reply.status(401).send({code:"DEVICE_REJECTED"});
  const result=await claimBrowserTask(pool,device.id);
  return result.kind==="rejected"?reply.status(401).send({code:"DEVICE_REJECTED"}):result;
 });
 app.get("/api/bridge/tasks/:id",async(request,reply)=>{
  const device=await identity(request),params=idParams.safeParse(request.params);
  if(!device)return reply.status(401).send({code:"DEVICE_REJECTED"});
  if(!params.success)return reply.status(400).send({code:"INVALID_TASK"});
  const result=await readBrowserTask(pool,device.id,params.data.id);
  return result??reply.status(404).send({code:"NOT_FOUND"});
 });
 app.post("/api/bridge/tasks/:id/results",{bodyLimit:5*1024*1024},async(request,reply)=>{
  if(!originAllowed(request))return reply.status(403).send({code:"ORIGIN_REJECTED"});
  const device=await identity(request);
  if(!device)return reply.status(401).send({code:"DEVICE_REJECTED"});
  const params=idParams.safeParse(request.params),body=resultBody.safeParse(request.body);
  if(!params.success||!body.success)return reply.status(400).send({code:"INVALID_RESULT"});
  const result=await acceptBrowserTaskResult(pool,{deviceId:device.id,taskId:params.data.id,taskHash:body.data.taskHash,observation:body.data.observation,encryptionKey:options.encryptionKey},options.boss);
  switch(result.kind){
   case "invalid":return reply.status(400).send({code:"INVALID_RESULT"});
   case "not_found":return reply.status(404).send({code:"NOT_FOUND"});
   case "conflict":return reply.status(409).send({code:"RESULT_CONFLICT"});
   case "stale":return reply.status(409).send({code:"TASK_STALE"});
   case "accepted":return reply.status(201).send(result);
   case "duplicate":return result;
   default:{const exhaustive:never=result;return exhaustive;}
  }
 });
}
