import { createPool } from "@forge-ops/db";
import { evaluateNiche, unknown, type NicheInput, type SettingsSnapshot, type Stage } from "@forge-ops/domain";
import { authorizeUrl, M1_ALLOWED_HOSTS } from "@forge-ops/security";
import { PgBoss, type Job } from "pg-boss";

const JOB_ADVANCE = "candidate.advance";

type AdvanceJob = { candidateId: string; stage: string; inputVersion: number };

const appEnv = process.env.APP_ENV === "production" ? "production" : "development";
if (appEnv === "production") {
  throw new Error("This worker binary refuses production. Oracle systemd worker only.");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL missing");

const pool = createPool(databaseUrl);
const identity = await pool.query(
  `SELECT environment FROM deployment_identity WHERE environment = 'development'`,
);
if ((identity.rowCount ?? 0) === 0) {
  throw new Error("development identity missing");
}

const boss = new PgBoss({
  connectionString: databaseUrl,
  supervise: true,
  schedule: false,
  migrate: false,
});
await boss.start();
await boss.createQueue(JOB_ADVANCE);

await boss.work<AdvanceJob>(JOB_ADVANCE, { localConcurrency: 4, batchSize: 1 }, async (jobs: Job<AdvanceJob>[]) => {
  const job = jobs[0];
  if (!job) return;
  await advance(job.data);
});

async function currentSettings(): Promise<SettingsSnapshot> {
  const row = await pool.query<{ snapshot: SettingsSnapshot }>(
    `SELECT snapshot FROM settings_versions ORDER BY version DESC LIMIT 1`,
  );
  const snapshot = row.rows[0]?.snapshot;
  if (!snapshot) throw new Error("settings missing");
  return snapshot;
}

async function advance(data: AdvanceJob): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{
      id: string;
      stage: Stage;
      blocked_reason: string | null;
      input_version: number;
    }>(`SELECT id, stage, blocked_reason, input_version FROM candidates WHERE id = $1 FOR UPDATE`, [
      data.candidateId,
    ]);
    const candidate = found.rows[0];
    if (!candidate) {
      await client.query("COMMIT");
      return;
    }
    if (candidate.blocked_reason === "web_session") {
      await client.query("COMMIT");
      return;
    }
    const settings = await currentSettings();
    if (candidate.stage === "imported" || data.stage === "imported") {
      await client.query(`UPDATE candidates SET stage = 'screening', last_progress_at = now() WHERE id = $1`, [
        candidate.id,
      ]);
      await client.query(
        `INSERT INTO candidate_events (candidate_id, stage, input_version, detail)
         VALUES ($1,'screening',$2,'{}'::jsonb)
         ON CONFLICT (candidate_id, stage, input_version) DO NOTHING`,
        [candidate.id, candidate.input_version],
      );
      const nicheInput: NicheInput = {
        review700Count: unknown("not collected from this file"),
        review2000Count: unknown("not collected from this file"),
        topPriceUsd: unknown("not collected from this file"),
        monthlyRevenueCompetitorCount: unknown("not collected from this file"),
        standardSize: unknown("not collected from this file"),
        differentiation: unknown("not collected from this file"),
      };
      const assessment = evaluateNiche(nicheInput, settings);
      await client.query(
        `INSERT INTO evaluations (candidate_id, settings_version, kind, outcome, payload)
         VALUES ($1, (SELECT max(version) FROM settings_versions), 'niche', $2, $3::jsonb)`,
        [candidate.id, assessment.outcome, JSON.stringify(assessment)],
      );
      if (assessment.outcome === "reject") {
        await client.query(`UPDATE candidates SET stage = 'rejected', last_progress_at = now() WHERE id = $1`, [
          candidate.id,
        ]);
      } else {
        await client.query(
          `UPDATE candidates SET stage = 'api_validation', last_progress_at = now() WHERE id = $1`,
          [candidate.id],
        );
        await client.query(
          `INSERT INTO candidate_events (candidate_id, stage, input_version, detail)
           VALUES ($1,'api_validation',$2,'{}'::jsonb)
           ON CONFLICT DO NOTHING`,
          [candidate.id, candidate.input_version],
        );
      }
    }

    const after = await client.query<{ stage: Stage }>(`SELECT stage FROM candidates WHERE id = $1`, [candidate.id]);
    if (after.rows[0]?.stage === "api_validation") {
      const denied = authorizeUrl("https://developer.junglescout.com/api/product_database_query", M1_ALLOWED_HOSTS);
      if (!denied.ok) {
        // fall through to budget lock — do not send HTTP
      }
      const cap = settings.jsDailyWireCap;
      const day = new Date().toISOString().slice(0, 10);
      await client.query(
        `INSERT INTO budget_days (day_utc, wire_limit) VALUES ($1::date, $2)
         ON CONFLICT (day_utc) DO NOTHING`,
        [day, cap],
      );
      const budget = await client.query<{ reserved: number; consumed: number; wire_limit: number }>(
        `SELECT reserved, consumed, wire_limit FROM budget_days WHERE day_utc = $1::date FOR UPDATE`,
        [day],
      );
      const b = budget.rows[0];
      const remaining = (b?.wire_limit ?? 0) - (b?.reserved ?? 0) - (b?.consumed ?? 0);
      if (remaining <= 0) {
        await client.query(
          `UPDATE candidates SET blocked_reason = 'budget', last_progress_at = now() WHERE id = $1`,
          [candidate.id],
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

console.log("worker listening for candidate.advance");

process.on("SIGTERM", async () => {
  await boss.stop({ graceful: true, timeout: 20000 });
  await pool.end();
  process.exit(0);
});
