import { aiBusinessInputSchema, parseAiBusinessOutput } from "@forge-ops/domain";
import { finishCandidateAiTask, lockSourcingCandidate, type Pool } from "@forge-ops/db";

export async function materializeProposedSpec(pool: Pool, taskId: string) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
    const task = (await db.query<{ candidate_id: string; input_version: number; settings_version: number; input_payload: unknown; result_payload: unknown }>(
      "SELECT t.candidate_id,t.input_version,t.settings_version,t.input_payload,o.result_payload FROM ai_business_tasks t JOIN ai_execution_operations o ON o.id=t.id WHERE t.id=$1 AND t.role IN ('niche_analysis','sourcing_analysis') AND t.spec_id IS NULL AND t.state='succeeded' AND o.state='succeeded'", [taskId],
    )).rows[0];
    const candidate = task ? await lockSourcingCandidate(db, task.candidate_id) : null;
    if (!task || !candidate || candidate.stage !== "sourcing" || candidate.input_version !== task.input_version || candidate.settings_version !== task.settings_version) {
      await db.query("COMMIT"); return { kind: "not_ready" as const };
    }
    const existing = (await db.query<{ id: string; ai_task_id: string | null }>("SELECT id,ai_task_id FROM spec_revisions WHERE candidate_id=$1 ORDER BY revision DESC LIMIT 1", [candidate.id])).rows[0];
    if (existing) { await db.query("COMMIT"); return { kind: "existing" as const, specId: existing.id }; }
    const input = aiBusinessInputSchema.parse(task.input_payload), output = parseAiBusinessOutput(task.result_payload, input);
    if (input.spec || !output || (output.role !== 'sourcing_analysis' && output.role !== 'niche_analysis') || !output.targetSpecification) { await db.query("COMMIT"); return { kind: "no_proposal" as const }; }
    const target = output.targetSpecification;
    const row = (await db.query<{ id: string }>(
      "INSERT INTO spec_revisions(candidate_id,revision,material,dimensions,packaging,requirements,requested_quantity,source,ai_task_id) VALUES($1,1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [candidate.id, target.material, target.dimensions, target.packaging, target.requirements, target.requestedQuantity, "자동 사양 제안 · 실물 미확인\n" + target.rationale, taskId],
    )).rows[0];
    if (!row) throw new Error("PROPOSED_SPEC_NOT_STORED");
    await db.query("INSERT INTO audit_events(actor,action,target,meta) VALUES('worker','specification_proposed',$1,$2::jsonb)", [row.id, JSON.stringify({ aiTaskId: taskId, inputVersion: task.input_version, settingsVersion: task.settings_version })]);
    await db.query("UPDATE candidates SET last_progress_at=now() WHERE id=$1", [candidate.id]);
    await db.query("COMMIT"); return { kind: "created" as const, specId: row.id };
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

export async function reuseDifferentiationProposal(pool:Pool,candidateId:string){
  const task=(await pool.query<{id:string}>(`SELECT t.id FROM ai_business_tasks t
    JOIN candidates c ON c.id=t.candidate_id JOIN ai_execution_operations o ON o.id=t.id
    WHERE c.id=$1 AND t.role='niche_analysis' AND t.spec_id IS NULL AND o.state='succeeded'
      AND t.input_version=c.input_version AND t.settings_version=(SELECT max(version) FROM settings_versions)
      AND o.result_payload->'differentiationProposal' IS NOT NULL AND o.result_payload->'differentiationProposal'<>'null'::jsonb
      AND (NOT EXISTS(SELECT 1 FROM spec_revisions WHERE candidate_id=c.id)
        OR t.id=(SELECT ai_task_id FROM spec_revisions WHERE candidate_id=c.id ORDER BY revision DESC LIMIT 1))
    ORDER BY t.created_at DESC,t.id DESC LIMIT 1`,[candidateId])).rows[0];
  if(!task)return null;
  await finishCandidateAiTask(pool,task.id);
  const result=await materializeProposedSpec(pool,task.id);
  return result.kind==='created'||result.kind==='existing'?{kind:'proposal_reused' as const,taskId:task.id,specId:result.specId}:null;
}

export async function recoverProposedSpecs(pool: Pool): Promise<void> {
  const tasks = (await pool.query<{ id: string }>(`
    SELECT t.id FROM ai_business_tasks t JOIN ai_execution_operations o ON o.id=t.id JOIN candidates c ON c.id=t.candidate_id
    JOIN LATERAL (SELECT outcome,stale FROM evaluations WHERE candidate_id=c.id AND kind='api_validation' AND settings_version=t.settings_version AND payload->>'inputVersion'=t.input_version::text ORDER BY created_at DESC,id DESC LIMIT 1) e ON e.outcome='pass' AND NOT e.stale
    WHERE t.role IN ('niche_analysis','sourcing_analysis') AND t.spec_id IS NULL AND o.state='succeeded'
      AND o.result_payload->'targetSpecification' IS NOT NULL AND o.result_payload->'targetSpecification'<>'null'::jsonb
      AND c.stage='sourcing' AND (c.blocked_reason IS NULL OR c.blocked_reason='web_session')
      AND t.input_version=c.input_version AND t.settings_version=(SELECT max(version) FROM settings_versions)
      AND NOT EXISTS(SELECT 1 FROM spec_revisions s WHERE s.candidate_id=c.id)
    ORDER BY (t.role='niche_analysis') DESC,t.created_at,t.id LIMIT 20`)).rows;
  for (const task of tasks) { await finishCandidateAiTask(pool, task.id); await materializeProposedSpec(pool, task.id); }
}
