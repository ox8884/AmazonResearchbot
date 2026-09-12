import { randomUUID } from "node:crypto";
import { type Pool, buildDailySummary } from "@forge-ops/db";
import { dueDailySchedules, type DailyScheduleKind } from "@forge-ops/domain";
import type { PgBoss } from "pg-boss";
export type DailyRunResult = {
  localDate: string;
  created: DailyScheduleKind[];
  unconfigured: DailyScheduleKind[];
  queued: number;
  summaryId: string | null;
};
export async function runDailyPlanner(
  pool: Pool,
  boss: PgBoss,
  options: { now?: Date; apiAvailable: boolean },
): Promise<DailyRunResult> {
  const db = await pool.connect();
  let locked = false,
    transaction = false,
    discard = false;
  try {
    await db.query("SELECT pg_advisory_lock(hashtext('forge.settings'))");
    locked = true;
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    transaction = true;
    const setting = (
      await db.query<{ version: number; snapshot: Record<string, unknown> }>(
        "SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1",
      )
    ).rows[0];
    if (!setting) throw new Error("Approved schedule settings missing");
    const now =
      options.now ??
      (await db.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]
        ?.now;
    const schedule = now ? dueDailySchedules(now, setting.snapshot) : null;
    if (!schedule || !now) throw new Error("Schedule settings unavailable");
    const result: DailyRunResult = {
      localDate: schedule.localDate,
      created: [],
      unconfigured: schedule.unconfigured,
      queued: 0,
      summaryId: null,
    };
    for (const kind of schedule.due) {
      const existing = (
        await db.query<{ id: string }>(
          "SELECT id FROM daily_runs WHERE schedule=$1 AND local_date=$2",
          [kind, schedule.localDate],
        )
      ).rows[0];
      if (existing) continue;
      const runId = randomUUID();
      if (kind === "research") {
        const cap = setting.snapshot.jsDailyWireCap;
        const budget = (
          await db.query<{ spent: number }>(
            "SELECT reserved+consumed AS spent FROM budget_days WHERE day_utc=$1",
            [now.toISOString().slice(0, 10)],
          )
        ).rows[0];
        const apiReady =
          options.apiAvailable &&
          typeof cap === "number" &&
          Number.isSafeInteger(cap) &&
          cap > 0 &&
          (budget?.spent ?? 0) < cap;
        const candidates = (
          await db.query<{ id: string; stage: string; input_version: number }>(
            `SELECT c.id,c.stage,c.input_version FROM candidates c
     WHERE (c.stage IN ('imported','screening') OR ($1 AND c.stage='api_validation'))
       AND (c.blocked_reason IS NULL OR c.blocked_reason NOT IN ('web_session','external_outcome_unknown'))
       AND NOT EXISTS(SELECT 1 FROM pgboss.job j WHERE j.name='candidate.advance' AND j.state IN ('created','retry','active') AND j.data->>'candidateId'=c.id::text AND j.data->>'inputVersion'=c.input_version::text AND j.data->>'stage'=c.stage)
     ORDER BY c.last_progress_at NULLS FIRST,c.id FOR UPDATE OF c`,
            [apiReady],
          )
        ).rows;
        await db.query(
          "INSERT INTO daily_runs(id,schedule,local_date,timezone,settings_version,generated_at,result) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
          [
            runId,
            kind,
            schedule.localDate,
            schedule.timezone,
            setting.version,
            now,
            JSON.stringify({
              queued: candidates.length,
              apiAvailable: options.apiAvailable,
              apiBudgetAvailable: apiReady,
            }),
          ],
        );
        for (const [index, candidate] of candidates.entries()) {
          const jobId = await boss.send(
            "candidate.advance",
            {
              candidateId: candidate.id,
              stage: candidate.stage,
              inputVersion: candidate.input_version,
            },
            {
              priority: candidates.length - index,
              db: { executeSql: (text, values) => db.query(text, values) },
            },
          );
          if (!jobId) throw new Error("Daily candidate job not created");
          await db.query(
            "INSERT INTO daily_planner_items(run_id,candidate_id,input_version,stage,ordinal,job_id) VALUES($1,$2,$3,$4,$5,$6)",
            [
              runId,
              candidate.id,
              candidate.input_version,
              candidate.stage,
              index + 1,
              jobId,
            ],
          );
        }
        result.queued = candidates.length;
      } else {
        const payload = await buildDailySummary(db, now, setting.snapshot),
          summaryId = randomUUID();
        await db.query(
          "INSERT INTO daily_runs(id,schedule,local_date,timezone,settings_version,generated_at,result) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
          [
            runId,
            kind,
            schedule.localDate,
            schedule.timezone,
            setting.version,
            now,
            JSON.stringify({ summaryId, delivery: "not_sent" }),
          ],
        );
        await db.query(
          "INSERT INTO daily_summaries(id,run_id,local_date,timezone,settings_version,generated_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
          [
            summaryId,
            runId,
            schedule.localDate,
            schedule.timezone,
            setting.version,
            now,
            JSON.stringify(payload),
          ],
        );
        result.summaryId = summaryId;
      }
      result.created.push(kind);
    }
    await db.query("COMMIT");
    transaction = false;
    return result;
  } catch (error) {
    if (transaction) {
      try {
        await db.query("ROLLBACK");
      } catch {
        discard = true;
      }
    } else if (!locked) discard = true;
    throw error;
  } finally {
    if (locked && !discard) {
      try {
        await db.query("SELECT pg_advisory_unlock(hashtext('forge.settings'))");
      } catch {
        discard = true;
      }
    }
    db.release(discard);
  }
}
