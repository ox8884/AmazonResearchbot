import type { QueryConnection } from "./rfq-state.ts";
export async function lockActiveBridgeDevice(db: QueryConnection, deviceId: string) {
 const rows=await db.query<{id:string;owner_user_id:string}>(
  'SELECT d.id,d.owner_user_id FROM bridge_devices d JOIN "user" u ON u.id=d.owner_user_id WHERE d.id=$1 AND d.revoked_at IS NULL AND u.two_factor_enabled=true FOR UPDATE OF d',[deviceId]);
 return rows.rows[0]??null;
}
