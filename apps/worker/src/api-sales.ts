import {
  estimate,
  measured,
  unknown,
  estimateThirtyDaySales,
  type Evidence,
} from "@forge-ops/domain";
import { buildSalesEstimateRequest } from "@forge-ops/integrations/jungle-scout/requests";
import {
  parseSalesEstimateResponse,
  type ProductObservation,
  type ProductFamily,
  type QueryPeriod,
} from "@forge-ops/integrations/jungle-scout/responses";
import {
  readOfficialSource,
  type ApiReaderContext,
  type ApiReadResult,
} from "./api-reader.ts";
import { storeApiFacts, type ApiFact } from "./api-facts-store.ts";
export type SupplementResult =
  | {
      kind: "complete";
      observations: readonly ProductObservation[];
      sourceIds: string[];
      period: QueryPeriod | null;
    }
  | { kind: "invalid"; sourceIds: string[] }
  | { kind: "stale" }
  | Exclude<ApiReadResult, { kind: "source" }>;
type SalesRead={readonly kind:'sales';readonly family:ProductFamily;readonly window:{readonly units30d:Evidence<number>;readonly revenue30d:Evidence<string>}};
export async function collectSalesFacts(
  reader: ApiReaderContext,
  products: readonly ProductObservation[],
  anchor: Date,
): Promise<SupplementResult> {
  const sources: string[] = [];
  const save = (facts: readonly ApiFact[]) =>
    storeApiFacts(reader.pool, reader.context, facts);
  const enriched = [...products];
  const targets = new Set(
    products.flatMap((p) => (p.asin.kind === "unknown" ? [] : [p.asin.value])),
  );
  const captured=new Map<string,SalesRead>();
  let comparisonPeriod:QueryPeriod|null=null;
  const readSales=async(asin:string):Promise<SalesRead|Exclude<SupplementResult,{kind:'complete'}>>=>{
    const prior=captured.get(asin);if(prior)return prior;
    const request = buildSalesEstimateRequest({ asin, now: anchor });
    if (!request.ok) return { kind: "invalid", sourceIds: sources };
    const read = await readOfficialSource(reader, request.value);
    if (read.kind !== "source") return read;
    sources.push(read.source.sourceId);
    if (!read.source.observedAt) return { kind: "invalid", sourceIds: sources };
    const source = {
      sourceId: read.source.sourceId,
      observedAt: read.source.observedAt,
    };
    const period = {
      startDate: request.value.query.start_date ?? "",
      endDate: request.value.query.end_date ?? "",
    };
    comparisonPeriod=period;
    const parsed = parseSalesEstimateResponse(read.body, source, {
      asin,
      ...period,
    });
    if (!parsed.ok) return { kind: "invalid", sourceIds: sources };
    const sale = parsed.value[0];
    const window = sale
      ? estimateThirtyDaySales(sale.daily, period, source)
      : {
          units30d: unknown("SALES_PERIOD_INCOMPLETE", source.sourceId),
          revenue30d: unknown("SALES_PERIOD_INCOMPLETE", source.sourceId),
        };
    const family: ProductFamily = sale?.family ?? {
      kind: "unknown",
      reason: "FAMILY_UNRESOLVED",
    };
    if (
      !(await save([
        { field: "api_sales_units:" + asin, evidence: window.units30d },
        { field: "api_sales_revenue:" + asin, evidence: window.revenue30d },
        {
          field: "api_sales_days:" + asin,
          evidence: measured(
            sale?.daily.length ?? 0,
            source.sourceId,
            source.observedAt,
          ),
        },
        {
          field: "api_sales_family:" + asin,
          evidence:
            family.kind === "known"
              ? family.key
              : unknown("FAMILY_UNRESOLVED", source.sourceId),
        },
      ]))
    )
      return { kind: "stale" };
    const result:SalesRead={kind:'sales',family,window};captured.set(asin,result);return result;
  };
  for (const asin of [...targets].sort()) {
    const result=await readSales(asin);if(result.kind!=='sales')return result;
    const {family,window}=result;
    for (let index = 0; index < enriched.length; index++) {
      const product = enriched[index];
      if (
        !product ||
        product.asin.kind === "unknown" ||
        product.asin.value !== asin
      )
        continue;
      const conflict =
        product.family.kind === "known" &&
        family.kind === "known" &&
        product.family.key.kind !== "unknown" &&
        family.key.kind !== "unknown" &&
        product.family.key.value !== family.key.value;
      enriched[index] = {
        ...product,
        family: conflict
          ? { kind: "unknown", reason: "FAMILY_UNRESOLVED" }
          : family,
        approximate30DayUnitsSold: window.units30d,
        approximate30DayRevenue:
          window.revenue30d.kind === "unknown"
            ? window.revenue30d
            : estimate(
                Number(window.revenue30d.value),
                window.revenue30d.sourceId,
                window.revenue30d.observedAt,
              ),
      };
    }
  }
  const parents=new Set(enriched.flatMap(product=>product.family.kind==='known'&&product.family.isVariant.kind!=='unknown'&&product.family.isVariant.value&&product.family.key.kind!=='unknown'?[product.family.key.value]:[]));
  for(const parentAsin of [...parents].sort()){
    const parent=await readSales(parentAsin);if(parent.kind!=='sales')return parent;
    for(let index=0;index<enriched.length;index++){
      const product=enriched[index];
      if(!product||product.asin.kind==='unknown'||product.family.kind!=='known'||product.family.key.kind==='unknown'||product.family.key.value!==parentAsin||product.family.isVariant.kind==='unknown'||!product.family.isVariant.value)continue;
      const confirmed=parent.family.kind==='known'&&parent.family.key.kind!=='unknown'&&parent.family.key.value===parentAsin
        &&parent.family.isParent.kind!=='unknown'&&parent.family.isParent.value
        &&parent.family.isVariant.kind!=='unknown'&&!parent.family.isVariant.value
        &&parent.family.variants.kind!=='unknown'&&parent.family.variants.value.includes(product.asin.value);
      const units=confirmed?parent.window.units30d:unknown('PARENT_SALES_UNCONFIRMED',parent.window.units30d.sourceId);
      const revenue=confirmed?parent.window.revenue30d:unknown('PARENT_SALES_UNCONFIRMED',parent.window.revenue30d.sourceId);
      enriched[index]={...product,approximate30DayUnitsSold:units,approximate30DayRevenue:revenue.kind==='unknown'?revenue:estimate(Number(revenue.value),revenue.sourceId,revenue.observedAt)};
    }
  }
  return { kind: "complete", observations: enriched, sourceIds: sources,period:comparisonPeriod };
}
