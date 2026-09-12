import { unknown } from "@forge-ops/domain";
import {
  buildKeywordRequest,
  type JungleScoutRequest,
} from "@forge-ops/integrations/jungle-scout/requests";
import {
  parseKeywordResponse,
  normalizeKeyword,
} from "@forge-ops/integrations/jungle-scout/responses";
import { nextPostPage } from "@forge-ops/integrations/jungle-scout/pagination";
import {
  readOfficialSource,
  type ApiReaderContext,
  type ApiReadResult,
} from "./api-reader.ts";
import type { ApiFact } from "./api-facts-store.ts";
export const KEYWORD_FIELDS = [
  "api_keyword_exact_30d",
  "api_keyword_broad_30d",
  "api_keyword_monthly_trend",
  "api_keyword_quarterly_trend",
] as const;
export type KeywordCollection =
  | { kind: "complete"; facts: ApiFact[]; sourceIds: string[] }
  | { kind: "invalid"; sourceIds: string[] }
  | Exclude<ApiReadResult, { kind: "source" }>;
export async function collectKeywordFacts(
  reader: ApiReaderContext,
): Promise<KeywordCollection> {
  const built = buildKeywordRequest({ keyword: reader.context.keyword });
  if (!built.ok) return { kind: "invalid", sourceIds: [] };
  let request: JungleScoutRequest = built.value;
  const sources: string[] = [],
    seen = new Set<string>();
  for (let page = 1; ; page++) {
    const read = await readOfficialSource(reader, request);
    if (read.kind !== "source") return read;
    sources.push(read.source.sourceId);
    if (!read.source.observedAt) return { kind: "invalid", sourceIds: sources };
    const parsed = parseKeywordResponse(read.body, {
      sourceId: read.source.sourceId,
      observedAt: read.source.observedAt,
    });
    if (!parsed.ok) return { kind: "invalid", sourceIds: sources };
    const exact = parsed.value.filter(
      (item) =>
        normalizeKeyword(item.keyword) ===
        normalizeKeyword(reader.context.keyword),
    );
    if (exact.length === 1 && exact[0])
      return {
        kind: "complete",
        sourceIds: sources,
        facts: [
          {
            field: KEYWORD_FIELDS[0],
            evidence: exact[0].exact30DaySearchVolume,
          },
          {
            field: KEYWORD_FIELDS[1],
            evidence: exact[0].broad30DaySearchVolume,
          },
          { field: KEYWORD_FIELDS[2], evidence: exact[0].monthlyTrend },
          { field: KEYWORD_FIELDS[3], evidence: exact[0].quarterlyTrend },
        ],
      };
    if (exact.length > 1) return { kind: "invalid", sourceIds: sources };
    const raw = read.body,
      links =
        typeof raw === "object" && raw !== null && "links" in raw
          ? raw.links
          : null;
    const next =
      typeof links === "object" && links !== null && "next" in links
        ? links.next
        : undefined;
    const missing = (): KeywordCollection => ({
      kind: "complete",
      sourceIds: sources,
      facts: KEYWORD_FIELDS.map((field) => ({
        field,
        evidence: unknown("EXACT_KEYWORD_MISSING", read.source.sourceId),
      })),
    });
    if (next === null || next === undefined) return missing();
    if (typeof next !== "string")
      return { kind: "invalid", sourceIds: sources };
    const following = nextPostPage({
      next,
      endpoint: "keywords_by_keyword_query",
      body: request.body,
      pagesFetched: page,
      maxPages: reader.context.snapshot.productDatabaseMaxPages,
    });
    if (following.kind === "incomplete") return missing();
    if (following.kind !== "next")
      return { kind: "invalid", sourceIds: sources };
    const cursor = new URL(following.url).searchParams.get("page[cursor]");
    if (!cursor || seen.has(cursor))
      return { kind: "invalid", sourceIds: sources };
    seen.add(cursor);
    request = {
      ...request,
      query: { marketplace: "us", "page[size]": "100", "page[cursor]": cursor },
    };
  }
}
