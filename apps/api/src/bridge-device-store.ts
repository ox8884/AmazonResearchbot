import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "@forge-ops/db";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

export async function issueBridgePairing(pool: Pool, owner: { readonly userId: string; readonly sessionId: string }) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["bridge-pairing:" + owner.userId]);
    await db.query("UPDATE bridge_pairings SET cancelled_at=now() WHERE owner_user_id=$1 AND consumed_at IS NULL AND cancelled_at IS NULL", [owner.userId]);
    const pairingCode = "fbp_" + randomBytes(32).toString("hex"), id = randomUUID();
    const row = (await db.query<{expires_at: Date}>(
      "INSERT INTO bridge_pairings(id,owner_user_id,issuer_session_id,code_sha256,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes') RETURNING expires_at",
      [id, owner.userId, owner.sessionId, digest(pairingCode)],
    )).rows[0];
    if (!row) throw new Error("Pairing issuance failed");
    await db.query("INSERT INTO audit_events(actor,action,target) VALUES($1,'bridge_pairing_issued',$2)", [owner.userId,id]);
    await db.query("COMMIT");
    return { id, pairingCode, expiresAt: row.expires_at.toISOString() };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}

export async function redeemBridgePairing(pool: Pool, input: { readonly pairingCode: string; readonly name: string }) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const pairing = (await db.query<{id: string; owner_user_id: string}>(
      'UPDATE bridge_pairings p SET consumed_at=now() FROM session s,"user" u WHERE p.code_sha256=$1 AND p.consumed_at IS NULL AND p.cancelled_at IS NULL AND p.expires_at>clock_timestamp() AND s.id=p.issuer_session_id AND s.user_id=p.owner_user_id AND s.expires_at>clock_timestamp() AND u.id=p.owner_user_id AND u.two_factor_enabled=true RETURNING p.id,p.owner_user_id',
      [digest(input.pairingCode)],
    )).rows[0];
    if (!pairing) {
      await db.query("COMMIT");
      return null;
    }
    const id = randomUUID(), credential = "fbd_" + randomBytes(32).toString("hex");
    await db.query(
      "INSERT INTO bridge_devices(id,owner_user_id,pairing_id,name,credential_sha256) VALUES($1,$2,$3,$4,$5)",
      [id, pairing.owner_user_id, pairing.id, input.name, digest(credential)],
    );
    await db.query("INSERT INTO audit_events(actor,action,target) VALUES($1,'bridge_device_registered',$2)", [pairing.owner_user_id,id]);
    await db.query("COMMIT");
    return { id, credential };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}

export async function readBridgeIdentity(pool: Pool, credential: string) {
  const result = await pool.query<{id: string; name: string}>(
    'SELECT d.id,d.name FROM bridge_devices d JOIN "user" u ON u.id=d.owner_user_id WHERE d.credential_sha256=$1 AND d.revoked_at IS NULL AND u.two_factor_enabled=true',
    [digest(credential)],
  );
  return result.rows[0] ?? null;
}

export async function revokeBridgeDevice(pool: Pool, input: { readonly ownerId: string; readonly deviceId: string }): Promise<boolean> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const row = (await db.query<{revoked_at: Date | null}>(
      "SELECT revoked_at FROM bridge_devices WHERE id=$1 AND owner_user_id=$2 FOR UPDATE", [input.deviceId,input.ownerId],
    )).rows[0];
    if (!row) { await db.query("COMMIT"); return false; }
    if (!row.revoked_at) {
      await db.query("UPDATE bridge_devices SET revoked_at=now() WHERE id=$1", [input.deviceId]);
      await db.query("INSERT INTO audit_events(actor,action,target) VALUES($1,'bridge_device_revoked',$2)", [input.ownerId,input.deviceId]);
    }
    await db.query("COMMIT");
    return true;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}
