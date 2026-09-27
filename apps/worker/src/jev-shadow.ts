import type { Pool } from "@forge-ops/db";
import { inboxCaptureOwner, type AiProductExcerpt, type SupplierCapture } from "@forge-ops/domain";
import { readProductSource } from "@forge-ops/integrations/amazon/product-source";
import { askJev, JevError, type JevRequest } from "@forge-ops/integrations/jev";
import { decryptSecret } from "@forge-ops/security";

// Shadow mode: Jev judges items the exact-match code left open and we only record the answer.
// Nothing here changes a supplier, candidate or inbox message.

type Spec = { readonly material: string; readonly dimensions: string; readonly packaging: string; readonly requirements: string };
export type RfqOption = { readonly id: string; readonly supplier: string; readonly recipient: string; readonly subject: string; readonly keyword: string };

const SPEC_FIELDS = ["material", "dimensions", "packaging", "requirements"] as const;
const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) + " …[truncated]" : text);

export function specMatchRequest(spec: Spec, capture: Pick<SupplierCapture, "companyName" | "pageText" | "observedSpec">): JevRequest {
  const observed = Object.fromEntries(SPEC_FIELDS.map((f) => [f, capture.observedSpec[f]?.excerpt ?? null]));
  return {
    state: { requested_specification: spec, supplier: capture.companyName, supplier_listing_lines: observed, supplier_page_text: clip(capture.pageText, 6000) },
    questions: Object.fromEntries(SPEC_FIELDS.map((f) => [f, {
      type: "choice",
      instructions: `Does the supplier's Alibaba listing offer the requested ${f} for this kitchen product? Compare meaning, not wording: units, synonyms and ordering differences still match.`,
      criteria: {
        match: `The listing clearly states a ${f} equivalent to the requested one, or says it can be customised to it. Offering extra items beyond the request (e.g. more certificates) still counts as a match.`,
        mismatch: `The listing clearly states a different ${f} that does not meet the request.`,
        unclear: `The listing does not mention ${f}, or is too vague to tell.`,
      },
    }])),
  };
}

export function differentiationRequest(keyword: string, excerpts: readonly AiProductExcerpt[]): JevRequest {
  return {
    state: {
      product_keyword: keyword,
      customer_reviews: excerpts.filter((e) => e.kind === "review").map((e) => clip(e.text, 800)),
      seller_claims: excerpts.filter((e) => e.kind === "claim").map((e) => clip(e.text, 300)),
    },
    questions: {
      differentiation: {
        type: "noul",
        instructions: "Based on the customer reviews (seller claims alone do not count), is there a specific complaint shared by several customers that a new version of this kitchen product could fix by changing its material, dimensions, packaging or quality requirements?",
      },
    },
  };
}

export function inboxRfqRequest(message: { readonly from: string; readonly subject: string | null; readonly body: string }, rfqs: readonly RfqOption[]): { readonly request: JevRequest; readonly options: Readonly<Record<string, string>> } {
  const options: Record<string, string> = {}, criteria: Record<string, string> = {};
  rfqs.forEach((r, i) => {
    options["rfq_" + (i + 1)] = r.id;
    criteria["rfq_" + (i + 1)] = `Reply from ${r.supplier} <${r.recipient}> about our quote request "${r.subject}" for ${r.keyword}.`;
  });
  criteria.none = "Not a reply to any of these quote requests (newsletter, spam, a different supplier or topic).";
  return {
    options,
    request: {
      state: { email_from: message.from, email_subject: message.subject ?? "", email_body: clip(message.body, 4000) },
      questions: { rfq: { type: "choice", instructions: "Which of our sent quote requests (RFQs) is this email a supplier reply to?", criteria } },
    },
  };
}

async function record(pool: Pool, kind: string, subjectId: string, baseline: string, run: () => Promise<{ request: JevRequest; extra?: object } | string>, apiKey: string): Promise<void> {
  let row: { answers: object | null; error: string | null; model?: string; latency?: number; tokens?: number };
  try {
    const prepared = await run();
    if (typeof prepared === "string") row = { answers: null, error: prepared };
    else {
      const result = await askJev(apiKey, prepared.request);
      row = { answers: { ...result.answers, ...prepared.extra }, error: null, model: result.model, latency: result.latencyMs, tokens: result.inputTokens };
    }
  } catch (error) {
    if (error instanceof JevError && error.transient) throw error; // leave unrecorded; next tick retries
    row = { answers: null, error: error instanceof JevError ? error.code : "PREPARE_FAILED" };
  }
  await pool.query(
    `INSERT INTO jev_decisions(kind,subject_id,baseline,answers,error,model,latency_ms,input_tokens) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT(kind,subject_id) DO NOTHING`,
    [kind, subjectId, baseline, row.answers, row.error, row.model ?? null, row.latency ?? null, row.tokens ?? null],
  );
}

async function judgeSpecMatches(pool: Pool, key: Buffer, apiKey: string) {
  const rows = (await pool.query<Spec & { id: string; capture_id: string; body_ciphertext: string }>(
    `SELECT s.id,sc.id AS capture_id,sc.body_ciphertext,sp.material,sp.dimensions,sp.packaging,sp.requirements
       FROM sourcing_suppliers s JOIN supplier_captures sc ON sc.supplier_id=s.id JOIN spec_revisions sp ON sp.id=sc.spec_id
      WHERE s.match_status='unknown' AND NOT EXISTS(SELECT 1 FROM jev_decisions j WHERE j.kind='spec_match' AND j.subject_id=s.id)
      ORDER BY s.created_at DESC LIMIT 5`)).rows;
  for (const row of rows)
    await record(pool, "spec_match", row.id, "unknown", async () => {
      const capture = JSON.parse(decryptSecret(row.body_ciphertext, key, "supplier-capture:" + row.capture_id).toString("utf8")) as SupplierCapture;
      return { request: specMatchRequest(row, capture) };
    }, apiKey);
}

async function judgeDifferentiation(pool: Pool, key: Buffer, apiKey: string) {
  const rows = (await pool.query<{ id: string; candidate_id: string; keyword: string; proposal: { status?: unknown; reviewRefs?: unknown } | null }>(
    `SELECT * FROM (SELECT DISTINCT ON (t.candidate_id) t.id,t.candidate_id,c.keyword_display AS keyword,o.result_payload->'differentiationProposal' AS proposal
       FROM ai_business_tasks t JOIN ai_execution_operations o ON o.id=t.id JOIN candidates c ON c.id=t.candidate_id
      WHERE t.role='niche_analysis' AND o.state='succeeded' ORDER BY t.candidate_id,t.created_at DESC) latest
      WHERE NOT EXISTS(SELECT 1 FROM jev_decisions j WHERE j.kind='differentiation' AND j.subject_id=latest.id) LIMIT 5`)).rows;
  for (const row of rows) {
    const refs = row.proposal?.reviewRefs;
    const baseline = row.proposal?.status === "proposed" && Array.isArray(refs) && refs.length > 0 ? "true" : "false";
    await record(pool, "differentiation", row.id, baseline, async () => {
      const source = await readProductSource(pool, row.candidate_id, key);
      if (source.state !== "captured") return "SOURCE_" + source.state.toUpperCase();
      if (!source.excerpts.some((e) => e.kind === "review")) return "NO_REVIEWS";
      return { request: differentiationRequest(row.keyword, source.excerpts) };
    }, apiKey);
  }
}

async function judgeInboxReplies(pool: Pool, key: Buffer, apiKey: string) {
  const rows = (await pool.query<{ id: string; profile_id: string; mailbox_key: string; uid_validity: string; uid: string; from_addresses: string[]; subject: string | null; body_ciphertext: string; created_at: Date }>(
    `SELECT m.id,m.profile_id,b.mailbox_key,b.uid_validity,m.uid::text,m.from_addresses,m.subject,m.body_ciphertext,m.created_at
       FROM inbox_messages m JOIN inbox_mailboxes b ON b.id=m.mailbox_id
      WHERE m.classification='unclassified' AND m.body_state='text' AND m.body_ciphertext IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM jev_decisions j WHERE j.kind='inbox_rfq' AND j.subject_id=m.id)
      ORDER BY m.created_at DESC LIMIT 5`)).rows;
  for (const row of rows)
    await record(pool, "inbox_rfq", row.id, "unclassified", async () => {
      // RFQs already sent when the email arrived; ponytail: newest 40 only, page if one inbox ever exceeds that.
      const rfqs = (await pool.query<RfqOption>(
        `SELECT r.id,s.name AS supplier,r.recipient,r.subject,c.keyword_display AS keyword
           FROM rfq_drafts r JOIN sourcing_suppliers s ON s.id=r.supplier_id JOIN candidates c ON c.id=r.candidate_id
          WHERE EXISTS(SELECT 1 FROM external_actions a WHERE a.rfq_id=r.id AND a.state='sent' AND a.created_at<=$1)
          ORDER BY r.created_at DESC LIMIT 40`, [row.created_at])).rows;
      if (!rfqs.length) return "NO_SENT_RFQ";
      const body = decryptSecret(row.body_ciphertext, key, inboxCaptureOwner(
        { profileId: row.profile_id, mailboxKey: row.mailbox_key, uidValidity: row.uid_validity, uid: row.uid }, "body")).toString("utf8");
      const { request, options } = inboxRfqRequest({ from: row.from_addresses.join(", "), subject: row.subject, body }, rfqs);
      return { request, extra: { options } };
    }, apiKey);
}

export async function runJevShadowCycle(pool: Pool, key: Buffer, apiKey: string): Promise<void> {
  await judgeSpecMatches(pool, key, apiKey);
  await judgeDifferentiation(pool, key, apiKey);
  await judgeInboxReplies(pool, key, apiKey);
}
