import { INITIAL_SETTINGS } from "@forge-ops/domain";
import type { Pool } from "./client.ts";

export async function seedInitialSettings(pool: Pool): Promise<void> {
  const existing = await pool.query("SELECT 1 FROM settings_versions WHERE version = 1");
  if ((existing.rowCount ?? 0) > 0) return;
  await pool.query(
    `INSERT INTO settings_versions (version, effective_at, approved_by, snapshot)
     VALUES (1, now(), 'system', $1::jsonb)`,
    [JSON.stringify(INITIAL_SETTINGS)],
  );
}
