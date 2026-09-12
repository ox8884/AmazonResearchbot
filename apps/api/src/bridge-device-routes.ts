import {readBridgeDeviceStatus,listBridgeDeviceStatuses} from "./bridge-device-status.ts";
import { readBrowserSigningIdentity } from "./browser-capability-routes.ts";
import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import type { Pool } from "@forge-ops/db";
import type { createAuth } from "./auth.ts";
import { issueBridgePairing, redeemBridgePairing, readBridgeIdentity, revokeBridgeDevice } from "./bridge-device-store.ts";

const pairingInput = z.object({
  pairingCode: z.string().regex(/^fbp_[a-f0-9]{64}$/),
  name: z.string().trim().min(1).max(80).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
}).strict();

export function registerBridgeDeviceRoutes(
  app: FastifyInstance,
  pool: Pool,
  options: { readonly auth: ReturnType<typeof createAuth>; readonly webOrigin: string },
): void {
  app.post("/api/bridge/pairings", async (request, reply) => {
    const session = await options.auth.api.getSession({headers:fromNodeHeaders(request.headers)});
    if (!session || session.user.twoFactorEnabled !== true) return reply.status(401).send({code:"UNAUTHENTICATED"});
    return reply.status(201).header("cache-control","no-store").send(await issueBridgePairing(pool,{userId:session.user.id,sessionId:session.session.id}));
  });
  app.get("/api/bridge/pairings/:id", async (request, reply) => {
    const params=z.object({id:z.string().uuid()}).safeParse(request.params);
    if(!params.success)return reply.status(400).send({code:"INVALID"});
    if(!("userId" in request)||typeof request.userId!=="string")return reply.status(401).send({code:"UNAUTHENTICATED"});
    const row=(await pool.query<{state:string;expires_at:Date}>("SELECT CASE WHEN consumed_at IS NOT NULL THEN 'consumed' WHEN cancelled_at IS NOT NULL THEN 'cancelled' WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE 'pending' END AS state,expires_at FROM bridge_pairings WHERE id=$1 AND owner_user_id=$2",[params.data.id,request.userId])).rows[0];
    return row?{state:row.state,expiresAt:row.expires_at.toISOString()}:reply.status(404).send({code:"NOT_FOUND"});
  });
  app.post("/api/bridge/pair", async (request, reply) => {
    if (request.headers.origin && request.headers.origin !== options.webOrigin) return reply.status(403).send({code:"ORIGIN_REJECTED"});
    const parsed = pairingInput.safeParse(request.body);
    if (!parsed.success) return reply.status(401).send({code:"PAIRING_REJECTED"});
    const device = await redeemBridgePairing(pool,parsed.data);
    if (!device) return reply.status(401).send({code:"PAIRING_REJECTED"});
    return reply.status(201).header("cache-control","no-store").send({...device,browserAvailable:false,capabilities:[],signingKey:await readBrowserSigningIdentity(pool)});
  });
  app.get("/api/bridge/device", async (request, reply) => {
    const match = /^Bearer (fbd_[a-f0-9]{64})$/.exec(request.headers.authorization ?? "");
    if (!match?.[1]) return reply.status(401).send({code:"DEVICE_REJECTED"});
    const device = await readBridgeIdentity(pool,match[1]);
    if (!device) return reply.status(401).send({code:"DEVICE_REJECTED"});
    const status=await readBridgeDeviceStatus(pool,device.id);
    if(!status || status.connectionState==="revoked")return reply.status(401).send({code:"DEVICE_REJECTED"});
    return reply.header("cache-control","no-store").send(status);
  });
  app.get("/api/bridge/devices", async (request, reply) => {
    if (!("userId" in request) || typeof request.userId !== "string") return reply.status(401).send({code:"UNAUTHENTICATED"});
    return {devices:await listBridgeDeviceStatuses(pool,request.userId)};
  });
  app.post("/api/bridge/devices/:id/revoke", async (request, reply) => {
    const params = z.object({id:z.string().uuid()}).safeParse(request.params);
    if (!params.success) return reply.status(400).send({code:"INVALID"});
    if (!("userId" in request) || typeof request.userId !== "string") return reply.status(401).send({code:"UNAUTHENTICATED"});
    const found = await revokeBridgeDevice(pool,{ownerId:request.userId,deviceId:params.data.id});
    return found ? {revoked:true} : reply.status(404).send({code:"NOT_FOUND"});
  });
}
