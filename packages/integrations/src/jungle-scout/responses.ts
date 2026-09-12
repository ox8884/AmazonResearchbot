import type {
  CatalogDimensions,
  CatalogWeight,
  Source,
  ParseResult,
  ProductObservation,
} from "./response-types.ts";
import {
  dataRows,
  responseError,
  attributes,
  productAsin,
  measuredNumber,
  measuredInteger,
  measuredText,
  estimatedNumber,
  measuredUpdatedAt,
  family,
} from "./response-values.ts";
import { measured, unknown } from "@forge-ops/domain";
export type * from "./response-types.ts";
export {
  parseHistoricalSearchVolumeResponse,
  parseSalesEstimateResponse,
  parseShareOfVoiceResponse,
  parseKeywordResponse,
} from "./auxiliary-responses.ts";

function positiveMeasurement(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
export function parseProductDatabaseResponse(
  raw: unknown,
  source: Source,
): ParseResult<readonly ProductObservation[]> {
  const data = dataRows(raw);
  if (data === null) return responseError();
  const value: ProductObservation[] = [];
  for (const row of data) {
    const attrs = attributes(row, "product_database_result");
    if (attrs === null || typeof row["id"] !== "string") return responseError();
    const asin = productAsin(row["id"], source);
    const length=attrs["length_value"],width=attrs["width_value"],height=attrs["height_value"],dimensionUnit=attrs["dimensions_unit"];
    const weight=attrs["weight_value"],weightUnit=attrs["weight_unit"];
    value.push({
      asin,
      price: measuredNumber(attrs["price"], source, "PRICE_UNKNOWN"),
      reviews: measuredInteger(attrs["reviews"], source, "REVIEWS_UNKNOWN"),
      category: measuredText(attrs["category"], source, "CATEGORY_UNKNOWN"),
      catalogDimensions: positiveMeasurement(length) && positiveMeasurement(width) && positiveMeasurement(height) && dimensionUnit === "inches"
        ? measured<CatalogDimensions>({length,width,height,unit:dimensionUnit},source.sourceId,source.observedAt)
        : unknown("CATALOG_DIMENSIONS_UNKNOWN",source.sourceId),
      catalogWeight: positiveMeasurement(weight) && weightUnit === "pounds"
        ? measured<CatalogWeight>({value:weight,unit:weightUnit},source.sourceId,source.observedAt)
        : unknown("CATALOG_WEIGHT_UNKNOWN",source.sourceId),
      approximate30DayUnitsSold: estimatedNumber(
        attrs["approximate_30_day_units_sold"],
        source,
        "UNITS_SOLD_UNKNOWN",
      ),
      approximate30DayRevenue: estimatedNumber(
        attrs["approximate_30_day_revenue"],
        source,
        "REVENUE_UNKNOWN",
      ),
      updatedAt: measuredUpdatedAt(attrs["updated_at"], source),
      family: family(attrs, asin, source),
    });
  }
  return { ok: true, value };
}

export { normalizeKeyword } from "./response-values.ts";
