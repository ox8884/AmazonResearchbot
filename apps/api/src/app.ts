import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { fromNodeHeaders } from "better-auth/node";
import { createHash, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { createDb, type Pool } from "@forge-ops/db";
import {
  INITIAL_SETTINGS,
  nextAction,
  parseNumericCell,
  stageLabel,
  type SettingsSnapshot,
  type Stage,
} from "@forge-ops/domain";
import { parseCsv, SYNTHETIC_SCHEMA } from "@forge-ops/integrations/jungle-scout/csv";
import { encryptSecret, parseKey } from "@forge-ops/security";
import { createAuth } from "./auth.ts";
import type { ApiEnv } from "./env.ts";
import { isLocked, recordAttempt } from "./lockout.ts";
import { createProducer, JOB_ADVANCE, txAdapter, type AdvanceJob } from "./queue.ts";

type SettingsRow = { version: number; snapshot: SettingsSnapshot };

export async function buildApp(env: ApiEnv, pool: Pool) {
  const db = createDb(pool);
  const auth = createAuth(db, env);
  const boss = await createProducer(env.databaseUrl);
  const encKey = parseKey(env.encryptionKeyHex);

  const app = Fastify({
    logger: {
      level: "info",
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
        censor: "[redacted]",
      },
    },
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: env.webOrigin,
    credentials: true,
    maxAge: 86400,
  });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (request.method === "POST" && url.pathname.endsWith("/sign-in/email")) {
        const body = request.body as { email?: string; password?: string };
        const email = body.email ?? "";
        const ip = request.ip;
        if (await isLocked(pool, email, ip)) {
          return reply.status(423).send({
            code: "LOCKED",
            message: "Too many failed sign-ins. Try again in 15 minutes.",
          });
        }
      }
      const headers = fromNodeHeaders(request.headers);
      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await auth.handler(req);
      if (request.method === "POST" && url.pathname.endsWith("/sign-in/email")) {
        const body = request.body as { email?: string };
        const email = body.email ?? "";
        await recordAttempt(pool, email, request.ip, response.status < 400);
      }
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        reply.header(key, value);
      });
      return reply.send(response.body ? await response.text() : null);
    },
  });


  app.get("/api/health", async () => ({ ok: true, env: env.appEnv }));

  app.get("/api/session", async (request, reply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) return reply.status(401).send({ code: "UNAUTHENTICATED", message: "Sign in required" });
    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        twoFactorEnabled: session.user.twoFactorEnabled === true,
      },
    };
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    if (request.url.startsWith("/api/auth") || request.url === "/api/health" || request.url === "/api/session") {
      return;
    }
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
      return reply.status(401).send({ code: "UNAUTHENTICATED", message: "Sign in required" });
    }
    if (session.user.twoFactorEnabled !== true) {
      return reply.status(403).send({ code: "TWO_FACTOR_REQUIRED", message: "Turn on two-factor before using the workspace" });
    }
    (request as { userId?: string }).userId = session.user.id;
  });

  async function currentSettings(): Promise<SettingsRow> {
    const row = await pool.query<SettingsRow>(
      `SELECT version, snapshot FROM settings_versions ORDER BY version DESC LIMIT 1`,
    );
    const first = row.rows[0];
    if (!first) return { version: 1, snapshot: INITIAL_SETTINGS };
    return first;
  }

  app.get("/api/settings", async () => {
    const current = await currentSettings();
    return current;
  });

  app.post("/api/settings/proposals", async (request, reply) => {
    const body = request.body as Partial<SettingsSnapshot>;
    const current = await currentSettings();
    const after = { ...current.snapshot, ...body, marketplace: "us" as const, currency: "USD" as const, timezone: "Asia/Seoul" as const };
    const payload = { before: current.snapshot, after, settingsVersion: current.version };
    const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const userId = (request as { userId?: string }).userId ?? "unknown";
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO settings_proposals (proposed_by, before_snapshot, after_snapshot, status)
       VALUES ($1, $2::jsonb, $3::jsonb, 'pending') RETURNING id`,
      [userId, JSON.stringify(current.snapshot), JSON.stringify(after)],
    );
    const proposalId = inserted.rows[0]?.id;
    const approval = await pool.query<{ id: string }>(
      `INSERT INTO approvals (kind, payload_hash, payload, status)
       VALUES ('budget_or_criteria_change', $1, $2::jsonb, 'pending') RETURNING id`,
      [payloadHash, JSON.stringify({ ...payload, proposalId })],
    );
    return reply.status(201).send({
      proposalId,
      approvalId: approval.rows[0]?.id,
      before: current.snapshot,
      after,
    });
  });

  app.post("/api/approvals/:id/approve", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const userId = (request as { userId?: string }).userId ?? "unknown";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{
        id: string;
        kind: string;
        status: string;
        payload_hash: string;
        payload: { after?: SettingsSnapshot; proposalId?: string; settingsVersion?: number };
      }>(`SELECT id, kind, status, payload_hash, payload FROM approvals WHERE id = $1 FOR UPDATE`, [id]);
      const row = found.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return reply.status(404).send({ code: "NOT_FOUND", message: "Approval missing" });
      }
      if (row.status === "approved") {
        await client.query("COMMIT");
        return { id: row.id, status: "approved" };
      }
      if (row.status !== "pending") {
        await client.query("ROLLBACK");
        return reply.status(409).send({ code: "APPROVAL_STALE", message: "This approval is no longer valid" });
      }
      await client.query(
        `UPDATE approvals SET status = 'approved', decided_at = now(), decided_by = $2 WHERE id = $1`,
        [id, userId],
      );
      if (row.kind === "budget_or_criteria_change" && row.payload.after) {
        const ver = await client.query<{ v: number }>(`SELECT coalesce(max(version), 0) + 1 AS v FROM settings_versions`);
        const nextVer = ver.rows[0]?.v ?? 1;
        await client.query(
          `INSERT INTO settings_versions (version, effective_at, approved_by, snapshot)
           VALUES ($1, now(), $2, $3::jsonb)`,
          [nextVer, userId, JSON.stringify(row.payload.after)],
        );
        await client.query(`UPDATE evaluations SET stale = true`);
        if (row.payload.proposalId) {
          await client.query(`UPDATE settings_proposals SET status = 'approved' WHERE id = $1`, [row.payload.proposalId]);
        }
      }
      await client.query(
        `INSERT INTO audit_events (actor, action, target, approval_hash) VALUES ($1, 'approve', $2, $3)`,
        [userId, id, row.payload_hash],
      );
      await client.query("COMMIT");
      return { id, status: "approved" };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  app.post("/api/approvals/:id/reject", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const userId = (request as { userId?: string }).userId ?? "unknown";
    const result = await pool.query(
      `UPDATE approvals SET status = 'rejected', decided_at = now(), decided_by = $2
       WHERE id = $1 AND status = 'pending'`,
      [id, userId],
    );
    if ((result.rowCount ?? 0) === 0) {
      return reply.status(409).send({ code: "APPROVAL_STALE", message: "This approval is no longer valid" });
    }
    return { id, status: "rejected" };
  });

  app.post("/api/imports", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.status(400).send({ code: "NO_FILE", message: "Choose a CSV file" });
    const bytes = await file.toBuffer();
    const parsed = await parseCsv(bytes);
    if (parsed.validCount === 0 || parsed.rows.some((r) => r.error)) {
      return reply.status(422).send({
        code: "ROW_ERRORS",
        message: "Fix the highlighted rows before creating candidates",
        rows: parsed.rows.map((r) => ({ rowNumber: r.rowNumber, keyword: r.keywordRaw, error: r.error })),
      });
    }
    const marketplace = "us";
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM imports WHERE sha256 = $1 AND marketplace = $2`,
      [parsed.sha256, marketplace],
    );
    if (existing.rows[0]) {
      const list = await loadCandidates(pool, "ko");
      return { importId: existing.rows[0].id, reused: true, candidates: list };
    }

    const sourceType = parsed.rows[0] && "keyword" in (parsed.rows[0].raw) ? SYNTHETIC_SCHEMA : "user_declared";
    const ciphertext = encryptSecret(bytes, encKey, `import:${file.filename}:bytes`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const imp = await client.query<{ id: string }>(
        `INSERT INTO imports (filename, byte_size, sha256, source_type, schema_version, marketplace, blob_ciphertext)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [file.filename, parsed.byteSize, parsed.sha256, sourceType, SYNTHETIC_SCHEMA, marketplace, ciphertext],
      );
      const importId = imp.rows[0]?.id;
      if (!importId) throw new Error("import insert failed");
      const source = await client.query<{ id: string }>(
        `INSERT INTO sources (kind, label) VALUES ('csv', $1) RETURNING id`,
        [file.filename],
      );
      const sourceId = source.rows[0]?.id ?? randomUUID();
      const observedAt = new Date().toISOString();
      const created: string[] = [];
      for (const row of parsed.rows) {
        const rowIns = await client.query<{ id: string }>(
          `INSERT INTO import_rows (import_id, row_number, raw_json, keyword_raw, normalized_keyword)
           VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING id`,
          [importId, row.rowNumber, JSON.stringify(row.raw), row.keywordRaw, row.normalizedKeyword],
        );
        const rowId = rowIns.rows[0]?.id;
        const found = await client.query<{ id: string; input_version: number }>(
          `SELECT id, input_version FROM candidates WHERE marketplace = $1 AND normalized_keyword = $2`,
          [marketplace, row.normalizedKeyword],
        );
        let candidateId = found.rows[0]?.id;
        let inputVersion = found.rows[0]?.input_version ?? 1;
        if (!candidateId) {
          const c = await client.query<{ id: string }>(
            `INSERT INTO candidates (marketplace, normalized_keyword, keyword_display, stage, input_version)
             VALUES ($1,$2,$3,'imported',1) RETURNING id`,
            [marketplace, row.normalizedKeyword, row.keywordRaw],
          );
          candidateId = c.rows[0]?.id;
          inputVersion = 1;
        } else {
          inputVersion += 1;
          await client.query(
            `UPDATE candidates SET input_version = $2, keyword_display = $3, last_progress_at = now() WHERE id = $1`,
            [candidateId, inputVersion, row.keywordRaw],
          );
        }
        if (!candidateId || !rowId) throw new Error("candidate insert failed");
        await client.query(
          `INSERT INTO candidate_import_rows (candidate_id, import_row_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [candidateId, rowId],
        );
        await client.query(
          `INSERT INTO evidence (candidate_id, field, kind, value_text, source_id, observed_at)
           VALUES ($1,'keyword','measured',$2,$3,$4)`,
          [candidateId, row.keywordRaw, sourceId, observedAt],
        );
        const extra = [
          ["reviews", row.raw.reviews ?? row.raw.Reviews, "reviews" in row.raw || "Reviews" in row.raw],
          ["review_700_count", row.raw.review_700_count, "review_700_count" in row.raw],
          ["review_2000_count", row.raw.review_2000_count, "review_2000_count" in row.raw],
          ["top_price", row.raw.top_price, "top_price" in row.raw],
          ["monthly_revenue_competitors", row.raw.monthly_revenue_competitors, "monthly_revenue_competitors" in row.raw],
        ] as const;
        for (const [field, value, present] of extra) {
          if (!present) continue;
          await insertCellEvidence(client, candidateId, sourceId, observedAt, field, value);
        }
        await client.query(
          `INSERT INTO candidate_events (candidate_id, stage, input_version, detail)
           VALUES ($1,'imported',$2,$3::jsonb)
           ON CONFLICT (candidate_id, stage, input_version) DO NOTHING`,
          [candidateId, inputVersion, JSON.stringify({ importId, rowNumber: row.rowNumber })],
        );
        const job: AdvanceJob = { candidateId, stage: "imported", inputVersion };
        await boss.send(JOB_ADVANCE, job, { db: txAdapter(client) });
        created.push(candidateId);
      }
      await client.query("COMMIT");
      const list = await loadCandidates(pool, "ko");
      return { importId, reused: false, created: created.length, candidates: list };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  app.get("/api/candidates", async (request) => {
    const locale = (request.headers["accept-language"] ?? "ko").toString().startsWith("en") ? "en" : "ko";
    return { candidates: await loadCandidates(pool, locale) };
  });

  app.get("/api/candidates/:id", async (request, reply) => {
    const locale = (request.headers["accept-language"] ?? "ko").toString().startsWith("en") ? "en" : "ko";
    const id = (request.params as { id: string }).id;
    const all = await loadCandidates(pool, locale);
    const found = all.find((c) => c.id === id);
    if (!found) return reply.status(404).send({ code: "NOT_FOUND", message: "Candidate missing" });
    const ev = await pool.query(
      `SELECT field, kind, value_numeric, value_text, reason, source_id, observed_at
       FROM evidence WHERE candidate_id = $1 ORDER BY created_at`,
      [id],
    );
    return { candidate: found, evidence: ev.rows };
  });

  app.get("/api/saved-searches", async () => {
    const rows = await pool.query(`SELECT id, name, marketplace, category, filters, revision FROM saved_searches ORDER BY created_at`);
    return { searches: rows.rows };
  });

  app.post("/api/saved-searches", async (request, reply) => {
    const body = request.body as { name?: string; category?: string; filters?: unknown };
    if (!body.name) return reply.status(400).send({ code: "INVALID", message: "name required" });
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO saved_searches (name, marketplace, category, filters) VALUES ($1,'us',$2,$3::jsonb) RETURNING id`,
      [body.name, body.category ?? "Kitchen & Dining", JSON.stringify(body.filters ?? {})],
    );
    return reply.status(201).send({ id: inserted.rows[0]?.id });
  });

  app.post("/api/saved-searches/:id/run", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const found = await pool.query(`SELECT id FROM saved_searches WHERE id = $1`, [id]);
    if ((found.rowCount ?? 0) === 0) return reply.status(404).send({ code: "NOT_FOUND", message: "Search missing" });
    return reply.status(202).send({
      id,
      nextAction: { kind: "waiting", label: "웹 연결을 기다리고 있어요", target: "web_session" },
    });
  });

  app.addHook("onClose", async () => {
    await boss.stop({ graceful: false, timeout: 5000 });
  });

  return { app, auth, boss };
}

async function loadCandidates(pool: Pool, locale: "ko" | "en") {
  const result = await pool.query<{
    id: string;
    keyword_display: string;
    stage: Stage;
    blocked_reason: string | null;
  }>(`SELECT id, keyword_display, stage, blocked_reason FROM candidates ORDER BY created_at`);
  const out = [];
  for (const row of result.rows) {
    const ev = await pool.query<{ field: string; kind: string; value_text: string | null; reason: string | null }>(
      `SELECT field, kind, value_text, reason FROM evidence WHERE candidate_id = $1`,
      [row.id],
    );
    const unknowns = ev.rows.filter((e) => e.kind === "unknown").map((e) => e.reason ?? e.field);
    const known = ev.rows.filter((e) => e.kind !== "unknown").map((e) => `${e.field}: ${e.value_text ?? ""}`);
    out.push({
      id: row.id,
      keyword: row.keyword_display,
      stage: row.stage,
      stageLabel: stageLabel(row.stage, locale),
      evidenceSummary: known.join(" · ") || (locale === "ko" ? "아직 측정된 근거가 적습니다" : "Little measured evidence yet"),
      unknowns: unknowns.length > 0 ? unknowns : [locale === "ko" ? "지금 모르는 것은 없습니다" : "None right now"],
      nextAction: nextAction({
        stage: row.stage,
        blockedReason: (row.blocked_reason as never) ?? null,
        locale,
      }),
      blockedReason: row.blocked_reason,
    });
  }
  return out;
}

async function insertCellEvidence(
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  candidateId: string,
  sourceId: string,
  observedAt: string,
  field: string,
  raw: string | undefined,
): Promise<void> {
  const cell = parseNumericCell(raw, sourceId, observedAt);
  if (cell.kind === "unknown") {
    await client.query(
      `INSERT INTO evidence (candidate_id, field, kind, reason, source_id)
       VALUES ($1,$2,'unknown',$3,$4)`,
      [candidateId, field, cell.reason, sourceId],
    );
    return;
  }
  await client.query(
    `INSERT INTO evidence (candidate_id, field, kind, value_text, source_id, observed_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [candidateId, field, cell.kind, cell.value, sourceId, observedAt],
  );
}
