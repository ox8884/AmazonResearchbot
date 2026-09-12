import type { Pool } from "pg";
export async function recoverOverdueAiExecutions(pool: Pool): Promise<number> {
  const result = await pool.query(`
    WITH candidates AS MATERIALIZED (
      SELECT DISTINCT operation_id FROM ai_execution_attempts
      WHERE state='dispatching' AND created_at < clock_timestamp()-interval '5 minutes'
    ), locked AS MATERIALIZED (
      SELECT operation_id FROM candidates
      WHERE pg_try_advisory_xact_lock(hashtextextended('ai_execution:' || operation_id::text,0))
    ), expired AS (
      UPDATE ai_execution_attempts SET state='outcome_unknown',finished_at=clock_timestamp()
      WHERE state='dispatching' AND created_at < clock_timestamp()-interval '5 minutes'
        AND operation_id IN (SELECT operation_id FROM locked)
      RETURNING operation_id
    )
    UPDATE ai_execution_operations SET state='outcome_unknown',updated_at=clock_timestamp()
    WHERE id IN (SELECT operation_id FROM expired) AND state='dispatching'
    RETURNING id
  `);
  return result.rowCount ?? 0;
}
