import type { Pool } from "@forge-ops/db";
import type { BridgeDevice } from "@forge-ops/domain";

type DeviceRow = {
  readonly id: string; readonly name: string; readonly created_at: Date; readonly revoked_at: Date | null;
  readonly reported_at: Date | null; readonly reported_connected: boolean | null; readonly reported_tasks: readonly string[];
  readonly fresh: boolean | null; readonly key_matches: boolean | null; readonly two_factor_enabled: boolean;
};
const statusQuery = `SELECT d.id,d.name,d.created_at,d.revoked_at,d.reported_at,d.reported_connected,d.reported_tasks,
  d.reported_at>clock_timestamp()-interval '90 seconds' AS fresh,
  d.reported_key_fingerprint=k.fingerprint AS key_matches,u.two_factor_enabled
  FROM bridge_devices d JOIN "user" u ON u.id=d.owner_user_id
  LEFT JOIN browser_signing_identity k ON k.singleton=1`;
function status(row: DeviceRow): BridgeDevice {
  const capabilities = [...new Set(row.reported_tasks)].filter((kind): kind is BridgeDevice["capabilities"][number] => kind === "supplier_search" || kind === "supplier_detail" || kind === "amazon_package" || kind === "saved_search_export" || kind === "amazon_search");
  const connectionState = row.revoked_at || !row.two_factor_enabled ? "revoked"
    : !row.reported_at ? "unreported"
    : !row.key_matches ? "key_mismatch"
    : !row.fresh ? "stale"
    : !row.reported_connected ? "offline"
    : capabilities.length > 0 ? "ready" : "unsupported";
  return { id: row.id, name: row.name, createdAt: row.created_at.toISOString(), revokedAt: row.revoked_at?.toISOString() ?? null,
    checkedAt: row.reported_at?.toISOString() ?? null, connectionState, browserAvailable: connectionState === "ready",
    capabilities: connectionState === "ready" ? capabilities : [],
  };
}
export async function readBridgeDeviceStatus(pool: Pool, deviceId: string) {
  const row = (await pool.query<DeviceRow>(statusQuery + " WHERE d.id=$1", [deviceId])).rows[0];
  return row ? status(row) : null;
}
export async function listBridgeDeviceStatuses(pool: Pool, ownerId: string) {
  const rows = await pool.query<DeviceRow>(statusQuery + " WHERE d.owner_user_id=$1 ORDER BY d.created_at,d.id", [ownerId]);
  return rows.rows.map(status);
}
