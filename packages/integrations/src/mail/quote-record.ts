import { automaticInput, manualInput } from "./quote-input.ts";
import {
  recordSupplierQuote,
  readApprovedSettings,
  quoteRecordView,
  type Pool,
  type SupplierQuoteRow,
} from "@forge-ops/db";
import {
  quoteInputSchema,
  type QuoteInput,
  type QuoteRecord,
} from "@forge-ops/domain";
import { exactPayloadHash } from "@forge-ops/security";
import {
  MAIL_QUOTE_PARSER_VERSION,
  readMailQuoteContext,
} from "./quote-source.ts";

type Command =
  | { readonly mode: "parsed"; readonly messageId: string }
  | {
      readonly mode: "manual";
      readonly messageId: string;
      readonly input: QuoteInput;
      readonly actor: string;
      readonly operatorEvidence?: string;
    };
export type MailQuoteRecordResult =
  | {
      readonly kind: "recorded";
      readonly quote: QuoteRecord;
      readonly reused: boolean;
    }
  | { readonly kind: "incomplete" }
  | {
      readonly kind: "blocked";
      readonly code:
        | "NOT_FOUND"
        | "SOURCE_UNAVAILABLE"
        | "SOURCE_MISMATCH"
        | "SOURCE_TERMS_CHANGED"
        | "INVALID";
    };

export async function recordMailQuote(
  pool: Pool,
  key: Buffer,
  command: Command,
): Promise<MailQuoteRecordResult> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('forge.settings'))");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "inbox-quote:" + command.messageId,
    ]);
    const context = await readMailQuoteContext(db, key, command.messageId);
    if (!context) {
      await db.query("ROLLBACK");
      return { kind: "blocked", code: "NOT_FOUND" };
    }
    if (
      !context.preview.bound ||
      context.source.body_state !== "text" ||
      !context.body?.trim()
    ) {
      await db.query("ROLLBACK");
      return { kind: "blocked", code: "SOURCE_UNAVAILABLE" };
    }
    let operatorEvidence = "";
    let input: QuoteInput | null, actor: string, recordKey: string;
    switch (command.mode) {
      case "parsed":
        if (
          context.source.stage === "decision_recorded" ||
          context.source.stage === "rejected"
        ) {
          await db.query("ROLLBACK");
          return { kind: "blocked", code: "SOURCE_UNAVAILABLE" };
        }
        if (context.preview.quote) {
          await db.query("COMMIT");
          return {
            kind: "recorded",
            quote: context.preview.quote,
            reused: true,
          };
        }
        input = automaticInput(context);
        actor = "worker";
        recordKey = input
          ? MAIL_QUOTE_PARSER_VERSION + ":" + exactPayloadHash(input)
          : MAIL_QUOTE_PARSER_VERSION;
        break;
      case "manual":
        if (command.input.specId !== context.source.spec_id) {
          await db.query("ROLLBACK");
          return { kind: "blocked", code: "SOURCE_MISMATCH" };
        }
        input = manualInput(context, command.input);
        if (!input) {
          await db.query("ROLLBACK");
          return { kind: "blocked", code: "SOURCE_TERMS_CHANGED" };
        }
        actor = command.actor;
        operatorEvidence = command.operatorEvidence?.trim() ?? "";
        recordKey = exactPayloadHash(
          operatorEvidence ? { input, operatorEvidence } : input,
        );
        break;
      default: {
        const unsupported: never = command;
        void unsupported;
        throw new Error("Unsupported quote recording mode");
      }
    }
    const prior = await db.query<{ quote_id: string | null }>(
      "SELECT quote_id FROM inbox_quote_records WHERE inbox_message_id=$1 AND ((mode=$2 AND record_key=$3) OR (quote_id IS NOT NULL AND right(record_key,64)=$4)) ORDER BY record_order LIMIT 1",
      [
        command.messageId,
        command.mode,
        recordKey,
        input
          ? command.mode === "manual"
            ? recordKey
            : exactPayloadHash(input)
          : null,
      ],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].quote_id === null) {
        await db.query("COMMIT");
        return { kind: "incomplete" };
      }
      const existing = await db.query<SupplierQuoteRow>(
        "SELECT *,valid_until::text AS valid_until FROM supplier_quotes WHERE id=$1",
        [prior.rows[0].quote_id],
      );
      const row = existing.rows[0];
      if (!row) throw new Error("Recorded inbox quote missing");
      const quote = quoteRecordView(
        { ...row, source_inbox_id: command.messageId },
        await readApprovedSettings(db),
      );
      await db.query("COMMIT");
      return { kind: "recorded", quote, reused: true };
    }
    if (!input) {
      await db.query(
        "INSERT INTO inbox_quote_records(inbox_message_id,mode,record_key,extraction,created_by) VALUES($1,'parsed',$2,$3::jsonb,'worker')",
        [
          command.messageId,
          recordKey,
          JSON.stringify({
            ...context.extraction,
            ...(operatorEvidence ? { operatorEvidence } : {}),
          }),
        ],
      );
      await db.query("COMMIT");
      return { kind: "incomplete" };
    }
    const parsed = quoteInputSchema.safeParse(input);
    if (!parsed.success || context.source.candidate_id === null) {
      await db.query("ROLLBACK");
      return { kind: "blocked", code: "INVALID" };
    }
    const saved = await recordSupplierQuote(db, {
      candidateId: context.source.candidate_id,
      input: {
        ...parsed.data,
        sourceText: context.preview.sourceText,
        supplierSource: context.preview.supplierSource,
      },
      actor,
    });
    await db.query(
      "INSERT INTO inbox_quote_records(inbox_message_id,mode,record_key,quote_id,extraction,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
      [
        command.messageId,
        command.mode,
        recordKey,
        saved.row.id,
        JSON.stringify({
          ...context.extraction,
          ...(operatorEvidence ? { operatorEvidence } : {}),
        }),
        actor,
      ],
    );
    const quote = quoteRecordView(
      { ...saved.row, source_inbox_id: command.messageId },
      saved.settings,
    );
    await db.query("COMMIT");
    return { kind: "recorded", quote, reused: false };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
