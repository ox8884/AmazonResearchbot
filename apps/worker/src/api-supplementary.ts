import { collectSalesFacts, type SupplementResult } from "./api-sales.ts";
import { estimate, measured, unknown, type Evidence } from "@forge-ops/domain";
import {
  buildHistoricalSearchVolumeRequest,
  buildShareOfVoiceRequest,
} from "@forge-ops/integrations/jungle-scout/requests";
import {
  parseHistoricalSearchVolumeResponse,
  parseShareOfVoiceResponse,
  type ProductObservation,
} from "@forge-ops/integrations/jungle-scout/responses";
import {
  readOfficialSource,
  type ApiReaderContext,
  type ApiReadResult,
} from "./api-reader.ts";
import { collectKeywordFacts, KEYWORD_FIELDS } from "./api-keywords.ts";
import { storeApiFacts, type ApiFact } from "./api-facts-store.ts";
const FIELDS = [
  ...KEYWORD_FIELDS,
  "api_history_periods",
  "api_history_peak",
  "api_history_range",
  "api_sov_search_30d",
  "api_sov_products",
  "api_sov_brands",
  "api_sov_exposure_pct",
];
export async function collectSupplementary(
  reader: ApiReaderContext,
  products: readonly ProductObservation[],
  anchor: Date,
): Promise<SupplementResult> {
  const sources: string[] = [];
  const save = (facts: readonly ApiFact[]) =>
    storeApiFacts(reader.pool, reader.context, facts);
  if (
    !(await save(
      FIELDS.map((field) => ({
        field,
        evidence: unknown(
          "API_NOT_COLLECTED",
          "api-window:" + anchor.toISOString().slice(0, 10),
        ),
      })),
    ))
  )
    return { kind: "stale" };
  const keywords = await collectKeywordFacts(reader);
  if (keywords.kind !== "complete") return keywords;
  sources.push(...keywords.sourceIds);
  if (!(await save(keywords.facts))) return { kind: "stale" };
  const historyRequest = buildHistoricalSearchVolumeRequest({
    keyword: reader.context.keyword,
    now: anchor,
  });
  if (!historyRequest.ok) return { kind: "invalid", sourceIds: sources };
  const historical = await readOfficialSource(reader, historyRequest.value);
  if (historical.kind !== "source") return historical;
  sources.push(historical.source.sourceId);
  if (!historical.source.observedAt)
    return { kind: "invalid", sourceIds: sources };
  const history = parseHistoricalSearchVolumeResponse(
    historical.body,
    {
      sourceId: historical.source.sourceId,
      observedAt: historical.source.observedAt,
    },
    {
      keyword: reader.context.keyword,
      startDate: historyRequest.value.query.start_date ?? "",
      endDate: historyRequest.value.query.end_date ?? "",
    },
  );
  if (!history.ok) return { kind: "invalid", sourceIds: sources };
  const origin = {
    sourceId: historical.source.sourceId,
    observedAt: historical.source.observedAt,
  };
  const points = history.value,
    values = points.map((p) => p.estimatedExactSearchVolume);
  const peak: Evidence<number> =
    values.length && values.every((v) => v.kind !== "unknown")
      ? estimate(
          Math.max(...values.map((v) => v.value)),
          origin.sourceId,
          origin.observedAt,
        )
      : unknown("HISTORY_VOLUME_UNKNOWN", origin.sourceId);
  const dates = points.flatMap((p) => [p.startDate, p.endDate]).sort();
  if (
    !(await save([
      {
        field: "api_history_periods",
        evidence: measured(points.length, origin.sourceId, origin.observedAt),
      },
      { field: "api_history_peak", evidence: peak },
      {
        field: "api_history_range",
        evidence: dates.length
          ? measured(
              dates[0] + " ~ " + dates[dates.length - 1],
              origin.sourceId,
              origin.observedAt,
            )
          : unknown("HISTORY_EMPTY", origin.sourceId),
      },
    ]))
  )
    return { kind: "stale" };
  const sovRequest = buildShareOfVoiceRequest({
    keyword: reader.context.keyword,
  });
  if (!sovRequest.ok) return { kind: "invalid", sourceIds: sources };
  const voiced = await readOfficialSource(reader, sovRequest.value);
  if (voiced.kind !== "source") return voiced;
  sources.push(voiced.source.sourceId);
  if (!voiced.source.observedAt) return { kind: "invalid", sourceIds: sources };
  const voice = parseShareOfVoiceResponse(
    voiced.body,
    { sourceId: voiced.source.sourceId, observedAt: voiced.source.observedAt },
    reader.context.keyword,
  );
  if (!voice.ok) return { kind: "invalid", sourceIds: sources };
  if (
    !(await save([
      {
        field: "api_sov_search_30d",
        evidence: voice.value.estimated30DaySearchVolume,
      },
      { field: "api_sov_products", evidence: voice.value.productCount },
      { field: "api_sov_brands", evidence: voice.value.brandCount },
      {
        field: "api_sov_exposure_pct",
        evidence: voice.value.maximumBrandExposurePct,
      },
    ]))
  )
    return { kind: "stale" };
  const sales = await collectSalesFacts(reader, products, anchor);
  return sales.kind === "complete" || sales.kind === "invalid"
    ? { ...sales, sourceIds: [...sources, ...sales.sourceIds] }
    : sales;
}
