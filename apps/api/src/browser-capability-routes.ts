import type { FastifyInstance } from "fastify";
import type { Pool } from "@forge-ops/db";
import { z } from "zod";
import { bridgeCapabilitySchema } from "@forge-ops/domain";
import { readBridgeIdentity } from "./bridge-device-store.ts";

const reportSchema=z.object({connected:z.boolean(),supportedTasks:z.array(bridgeCapabilitySchema).max(bridgeCapabilitySchema.options.length),keyFingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export async function readBrowserSigningIdentity(pool:Pool) {
 const row=(await pool.query<{public_key:string;fingerprint:string}>("SELECT public_key,fingerprint FROM browser_signing_identity WHERE singleton=1")).rows[0];
 return row?{publicKey:row.public_key,fingerprint:row.fingerprint}:null;
}
export function registerBrowserCapabilityRoutes(app:FastifyInstance,pool:Pool,webOrigin:string) {
 app.get("/api/bridge/signing-key",async()=>({signingKey:await readBrowserSigningIdentity(pool)}));
 app.post("/api/bridge/capabilities",async(request,reply)=>{
  if(request.headers.origin&&request.headers.origin!==webOrigin)return reply.status(403).send({code:"ORIGIN_REJECTED"});
  const token=/^Bearer (fbd_[a-f0-9]{64})$/.exec(request.headers.authorization??"")?.[1];
  const device=token?await readBridgeIdentity(pool,token):null;
  if(!device)return reply.status(401).send({code:"DEVICE_REJECTED"});
  const parsed=reportSchema.safeParse(request.body);
  if(!parsed.success)return reply.status(400).send({code:"INVALID_CAPABILITIES"});
  const identity=await readBrowserSigningIdentity(pool);
  if(!identity||identity.fingerprint!==parsed.data.keyFingerprint)return reply.status(409).send({code:"SIGNING_KEY_MISMATCH"});
  const result=await pool.query(
   'UPDATE bridge_devices d SET reported_connected=$2,reported_tasks=$3,reported_key_fingerprint=$4,reported_at=now() FROM "user" u WHERE d.id=$1 AND d.revoked_at IS NULL AND u.id=d.owner_user_id AND u.two_factor_enabled=true RETURNING d.id',
   [device.id,parsed.data.connected,parsed.data.connected?parsed.data.supportedTasks:[],parsed.data.keyFingerprint]);
  return result.rowCount?{reported:true}:reply.status(401).send({code:"DEVICE_REJECTED"});
 });
}
