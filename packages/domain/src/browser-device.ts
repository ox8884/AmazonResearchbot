import { z } from "zod";

export const bridgeCapabilitySchema = z.enum(["supplier_search", "supplier_detail", "amazon_package", "saved_search_export", "amazon_search"]);

export const bridgeConnectionStateSchema = z.enum(["unreported", "ready", "offline", "stale", "unsupported", "key_mismatch", "revoked"]);
export const bridgeDeviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
  checkedAt: z.string().datetime({ offset: true }).nullable(),
  connectionState: bridgeConnectionStateSchema,
  browserAvailable: z.boolean(),
  capabilities: z.array(bridgeCapabilitySchema),
});
export const bridgeDevicesSchema = z.object({ devices: z.array(bridgeDeviceSchema) });
export const bridgePairingSchema = z.object({ id: z.string().uuid(), pairingCode: z.string().regex(/^fbp_[a-f0-9]{64}$/), expiresAt: z.string().datetime({ offset: true }) });
export const bridgeSigningIdentitySchema = z.object({ signingKey: z.object({ publicKey: z.string().max(16384), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).nullable() });
export type BridgeDevice = z.infer<typeof bridgeDeviceSchema>;
export type BridgeConnectionState = z.infer<typeof bridgeConnectionStateSchema>;
export type BridgePairing = z.infer<typeof bridgePairingSchema>;

export const bridgePairingStatusSchema=z.object({state:z.enum(["pending","consumed","cancelled","expired"]),expiresAt:z.string().datetime({offset:true})});
