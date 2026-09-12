import type { Evidence } from "@forge-ops/domain";
export type Source = { readonly sourceId: string; readonly observedAt: string };
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: "UNEXPECTED_SCHEMA" };

export type ProductFamily =
  | {
      readonly kind: "known";
      readonly key: Evidence<string>;
      readonly parentAsin: Evidence<string>;
      readonly isVariant: Evidence<boolean>;
      readonly isParent: Evidence<boolean>;
      readonly variants: Evidence<readonly string[]>;
    }
  | { readonly kind: "unknown"; readonly reason: "FAMILY_UNRESOLVED" };

export type CatalogDimensions = { readonly length: number; readonly width: number; readonly height: number; readonly unit: "inches" };
export type CatalogWeight = { readonly value: number; readonly unit: "pounds" };
export type ProductObservation = {
  readonly asin: Evidence<string>;
  readonly price: Evidence<number>;
  readonly reviews: Evidence<number>;
  readonly category: Evidence<string>;
  readonly catalogDimensions: Evidence<CatalogDimensions>;
  readonly catalogWeight: Evidence<CatalogWeight>;
  readonly approximate30DayUnitsSold: Evidence<number>;
  readonly approximate30DayRevenue: Evidence<number>;
  readonly updatedAt: Evidence<string>;
  readonly family: ProductFamily;
};

export type HistoricalSearchVolume = {
  readonly startDate: string;
  readonly endDate: string;
  readonly estimatedExactSearchVolume: Evidence<number>;
};

export type SalesEstimate = {
  readonly asin: Evidence<string>;
  readonly family: ProductFamily;
  readonly daily: readonly {
    readonly date: string;
    readonly estimatedUnitsSold: Evidence<number>;
    readonly lastKnownPrice: Evidence<number>;
  }[];
};

export type ShareOfVoice = {
  readonly maximumBrandExposurePct: Evidence<number>;
  readonly estimated30DaySearchVolume: Evidence<number>;
  readonly productCount: Evidence<number>;
  readonly brandCount: Evidence<number>;
};

export type KeywordObservation = {
  readonly keyword: string;
  readonly exact30DaySearchVolume: Evidence<number>;
  readonly broad30DaySearchVolume: Evidence<number>;
  readonly monthlyTrend: Evidence<number>;
  readonly quarterlyTrend: Evidence<number>;
  readonly organicProductCount: Evidence<number>;
};
export type QueryPeriod = {
  readonly startDate: string;
  readonly endDate: string;
};
