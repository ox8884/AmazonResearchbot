import type { FastifyInstance } from "fastify";
import type { Pool } from "@forge-ops/db";
import { z } from "zod";
import { savedSearchInput,searchRunSnapshotSchema } from "@forge-ops/domain";
export function registerSavedSearchRoutes(app: FastifyInstance, pool: Pool) {
  app.get("/api/saved-searches", async () => {
    const rows = await pool.query(
      "SELECT id,name,marketplace,category,filters,revision FROM saved_searches ORDER BY created_at,id",
    );
    return { searches: rows.rows };
  });
  app.post("/api/saved-searches", async (request, reply) => {
    const parsed = savedSearchInput.safeParse(request.body);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ code: "INVALID", message: "Check search name and conditions" });
    const { name, category, filters } = parsed.data;
    const inserted = await pool.query<{ id: string }>(
      "INSERT INTO saved_searches(name,marketplace,category,filters) VALUES($1,'us',$2,$3::jsonb) RETURNING id",
      [name, category, JSON.stringify(filters)],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error("Saved search insert failed");
    return reply.status(201).send({ id });
  });
  app.post("/api/saved-searches/:id/run", async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (
      !params.success ||
      !z
        .object({})
        .strict()
        .safeParse(request.body ?? {}).success
    )
      return reply.status(400).send({ code: "INVALID" });
    if (!("userId" in request) || typeof request.userId !== "string")
      return reply.status(401).send({ code: "UNAUTHENTICATED" });
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "search-run:" + request.userId + ":" + params.data.id,
      ]);
      const search = (
        await db.query<{
          id: string;
          revision: number;
          name: string;
          category: string;
          filters: unknown;
          marketplace: string;
        }>(
          "SELECT id,revision,name,category,filters,marketplace FROM saved_searches WHERE id=$1",
          [params.data.id],
        )
      ).rows[0];
      if (!search) {
        await db.query("ROLLBACK");
        return reply.status(404).send({ code: "NOT_FOUND" });
      }
      const pending = (
        await db.query(
          "SELECT id,snapshot,state,mode FROM saved_search_runs WHERE saved_search_id=$1 AND created_by=$2 AND state='awaiting_csv'",
          [search.id, request.userId],
        )
      ).rows[0];
      const run =
        pending ??
        (
          await db.query(
            "INSERT INTO saved_search_runs(saved_search_id,created_by,search_revision,snapshot) VALUES($1,$2,$3,$4::jsonb) RETURNING id,snapshot,state,mode",
            [
              search.id,
              request.userId,
              search.revision,
              JSON.stringify(search),
            ],
          )
        ).rows[0];
      const snapshot=searchRunSnapshotSchema.safeParse(run.snapshot);
      const structured=snapshot.success&&snapshot.data.filters.competition===undefined&&snapshot.data.filters.seasonality===undefined;
      const ready=structured?(await db.query(`SELECT d.id FROM bridge_devices d JOIN browser_signing_identity k ON k.fingerprint=d.reported_key_fingerprint
        WHERE d.owner_user_id=$1 AND d.revoked_at IS NULL AND d.reported_connected=true
          AND d.reported_at>clock_timestamp()-interval '90 seconds' AND 'saved_search_export'=ANY(d.reported_tasks) LIMIT 1`,[request.userId])).rowCount:0;
      if(ready){await db.query("UPDATE saved_search_runs SET mode='browser' WHERE id=$1",[run.id]);run.mode='browser';}
      await db.query("COMMIT");
      return reply
        .status(202)
        .send({
          id: search.id,
          run,
          mode: run.mode,
          filterVerification: "unverified",
          nextAction: {
            kind: run.mode==='browser'?"automatic":"waiting",
            label: run.mode==='browser'?"ASIDE 자동 수집을 기다리고 있어요":"웹 연결 또는 조건 확인을 기다리고 있어요",
            target: run.mode==='browser'?"browser_export":structured?"web_session":"manual_filters",
          },
        });
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  });
  app.get("/api/saved-search-runs", async (request, reply) => {
    if (!("userId" in request) || typeof request.userId !== "string")
      return reply.status(401).send({ code: "UNAUTHENTICATED" });
    const runs = await pool.query(
      `SELECT r.id,r.saved_search_id AS "savedSearchId",r.snapshot,r.state,r.mode,r.filter_verification AS "filterVerification",r.import_id AS "importId",r.created_at AS "createdAt",r.completed_at AS "completedAt",i.filename,i.sha256,
      CASE WHEN r.import_id IS NULL THEN NULL ELSE (SELECT count(DISTINCT c.candidate_id)::int FROM candidate_import_rows c JOIN import_rows ir ON ir.id=c.import_row_id WHERE ir.import_id=r.import_id) END AS "linkedCandidates"
      FROM saved_search_runs r LEFT JOIN imports i ON i.id=r.import_id WHERE r.created_by=$1 ORDER BY r.created_at DESC,r.id LIMIT 30`,
      [request.userId],
    );
    return { runs: runs.rows };
  });
}
