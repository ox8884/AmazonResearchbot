import { measured, estimate, unknown, type Evidence } from "@forge-ops/domain";
import type {
  Source,
  ParseResult,
  KeywordObservation,
  HistoricalSearchVolume,
  SalesEstimate,
  ShareOfVoice,
  QueryPeriod,
} from "./response-types.ts";
import {
  isRecord,
  rows,
  dataRows,
  attributes,
  responseError,
  productAsin,
  family,
  measuredNumber,
  measuredInteger,
  estimatedInteger,
  estimatedTrend,
  isoDay,
  normalizeKeyword,
  keywordIdentity,
} from "./response-values.ts";
export function parseKeywordResponse(
  raw: unknown,
  source: Source,
): ParseResult<readonly KeywordObservation[]> {
  const data = dataRows(raw);
  if (data === null) return responseError();
  const value: KeywordObservation[] = [];
  for (const row of data) {
    const attrs = attributes(row, "keywords_by_keyword_result");
    if (
      !attrs ||
      attrs.country !== "us" ||
      typeof attrs.name !== "string" ||
      !keywordIdentity(row.id, attrs.name)
    )
      return responseError();
    value.push({
      keyword: attrs.name,
      exact30DaySearchVolume: estimatedInteger(
        attrs.monthly_search_volume_exact,
        source,
        "EXACT_VOLUME_UNKNOWN",
      ),
      broad30DaySearchVolume: estimatedInteger(
        attrs.monthly_search_volume_broad,
        source,
        "BROAD_VOLUME_UNKNOWN",
      ),
      monthlyTrend: estimatedTrend(attrs.monthly_trend, source),
      quarterlyTrend: estimatedTrend(attrs.quarterly_trend, source),
      organicProductCount: estimatedInteger(
        attrs.organic_product_count,
        source,
        "ORGANIC_COUNT_UNKNOWN",
      ),
    });
  }
  return { ok: true, value };
}
export function parseHistoricalSearchVolumeResponse(
  raw: unknown,
  source: Source,
  expected?: QueryPeriod & { keyword: string },
): ParseResult<readonly HistoricalSearchVolume[]> {
  const data = dataRows(raw);
  if (data === null) return responseError();
  const value: HistoricalSearchVolume[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    const attrs = attributes(row, "historical_keyword_search_volume");
    if (
      !attrs ||
      !isoDay(attrs.estimate_start_date) ||
      !isoDay(attrs.estimate_end_date) ||
      typeof row.id !== "string"
    )
      return responseError();
    const start = attrs.estimate_start_date,
      end = attrs.estimate_end_date;
    const suffix = "/" + start + "/" + end;
    if (
      !row.id.endsWith(suffix) ||
      !keywordIdentity(row.id.slice(0, -suffix.length), expected?.keyword) ||
      start > end ||
      seen.has(start)
    )
      return responseError();
    if (new Date(end).getTime() - new Date(start).getTime() > 6 * 86400000)
      return responseError();
    if (expected && (start < expected.startDate || end > expected.endDate))
      return responseError();
    if (value.some((point) => start <= point.endDate && end >= point.startDate))
      return responseError();
    seen.add(start);
    value.push({
      startDate: start,
      endDate: end,
      estimatedExactSearchVolume: estimatedInteger(
        attrs.estimated_exact_search_volume,
        source,
        "SEARCH_VOLUME_UNKNOWN",
      ),
    });
  }
  return { ok: true, value };
}
export function parseSalesEstimateResponse(
  raw: unknown,
  source: Source,
  expected?: QueryPeriod & { asin: string },
): ParseResult<readonly SalesEstimate[]> {
  const data = dataRows(raw);
  if (data === null) return responseError();
  const value: SalesEstimate[] = [];
  const seenAsins = new Set<string>();
  for (const row of data) {
    const attrs = attributes(row, "sales_estimate_result"),
      daily = attrs ? rows(attrs.data) : null;
    const asin = productAsin(row.id, source);
    if (
      !attrs ||
      !daily ||
      asin.kind === "unknown" ||
      seenAsins.has(asin.value) ||
      (expected && asin.value !== expected.asin) ||
      (attrs.asin !== undefined && attrs.asin !== asin.value)
    )
      return responseError();
    seenAsins.add(asin.value);
    const seenDays = new Set<string>();
    const points: {
      date: string;
      estimatedUnitsSold: Evidence<number>;
      lastKnownPrice: Evidence<number>;
    }[] = [];
    for (const point of daily) {
      if (
        !isoDay(point.date) ||
        seenDays.has(point.date) ||
        (expected &&
          (point.date < expected.startDate || point.date > expected.endDate))
      )
        return responseError();
      seenDays.add(point.date);
      points.push({
        date: point.date,
        estimatedUnitsSold: estimatedInteger(
          point.estimated_units_sold,
          source,
          "ESTIMATED_UNITS_UNKNOWN",
        ),
        lastKnownPrice: measuredNumber(
          point.last_known_price,
          source,
          "DAILY_PRICE_UNKNOWN",
        ),
      });
    }
    const flags = [attrs.is_parent, attrs.is_variant, attrs.is_standalone];
    const resolved =
      flags.every((flag) => typeof flag === "boolean") &&
      flags.filter((flag) => flag === true).length === 1;
    value.push({
      asin,
      family: resolved
        ? family(attrs, asin, source)
        : { kind: "unknown", reason: "FAMILY_UNRESOLVED" },
      daily: points,
    });
  }
  return { ok: true, value };
}
export function parseShareOfVoiceResponse(
  raw: unknown,
  source: Source,
  expectedKeyword?: string,
): ParseResult<ShareOfVoice> {
  if (
    !isRecord(raw) ||
    !isRecord(raw.data) ||
    !keywordIdentity(raw.data.id, expectedKeyword)
  )
    return responseError();
  const attrs = attributes(raw.data, "share_of_voice"),
    brands = attrs ? rows(attrs.brands) : null;
  if (!attrs || !brands) return responseError();
  const names = new Set<string>();
  for (const brand of brands) {
    if (typeof brand.brand !== "string" || !brand.brand.trim())
      return responseError();
    names.add(normalizeKeyword(brand.brand));
  }
  const exposures = brands.map((brand) => brand.combined_basic_sov);
  const maximumBrandExposurePct =
    exposures.length > 0 &&
    names.size === brands.length &&
    exposures.every(
      (value) =>
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1,
    )
      ? estimate(
          Number(
            (
              Math.max(
                ...exposures.filter(
                  (value): value is number => typeof value === "number",
                ),
              ) * 100
            ).toFixed(2),
          ),
          source.sourceId,
          source.observedAt,
        )
      : unknown("BRAND_EXPOSURE_UNKNOWN", source.sourceId);
  return {
    ok: true,
    value: {
      maximumBrandExposurePct,
      estimated30DaySearchVolume: estimatedInteger(
        attrs.estimated_30_day_search_volume,
        source,
        "SEARCH_VOLUME_UNKNOWN",
      ),
      productCount: measuredInteger(
        attrs.product_count,
        source,
        "PRODUCT_COUNT_UNKNOWN",
      ),
      brandCount: measured(names.size, source.sourceId, source.observedAt),
    },
  };
}
