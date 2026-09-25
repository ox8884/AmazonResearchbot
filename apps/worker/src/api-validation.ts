import { collectSupplementary } from "./api-supplementary.ts";
import {selectFirstPageLeader,selectMarketLeader,topOrganicSlots,withFamilyTotals,withPageRankedRepresentative} from './market-leader.ts';
import {collectFirstPageSales,type FirstPageSales} from './first-page-sales.ts';
import { storeApiFacts, type ApiFact } from "./api-facts-store.ts";
import { readOfficialSource } from "./api-reader.ts";
import { assessMarketConcentration, evaluateNiche, isKnown, marketRevenueRows, measured, unknown, type NicheAssessment, type NicheInput } from "@forge-ops/domain";
import type { Pool } from "@forge-ops/db";
import { nextPostPage, readJsonApiNext } from "@forge-ops/integrations/jungle-scout/pagination";
import { buildProductDatabaseRequest, type JsonApiRequestBody, type JungleScoutRequest } from "@forge-ops/integrations/jungle-scout/requests";
import { parseProductDatabaseResponse, type ProductObservation } from "@forge-ops/integrations/jungle-scout/responses";
import { aggregateProductDatabase } from "@forge-ops/integrations/jungle-scout/validation";
import type { JsTransport } from "@forge-ops/integrations/jungle-scout/transport";
import {
  applyApiValidationDecision,
  applyApiValidationWait,
  loadCanonicalNicheEvidence,
  type ApiValidationContext,
} from "./api-validation-store.ts";

export type ApiValidationResult = "pass" | "reject" | "hold" | "blocked" | "stale";

const REVIEW_TOP_SLOTS = 10;

type ProductCollection =
  | { readonly kind: "collected"; readonly observations: readonly ProductObservation[]; readonly complete: boolean; readonly block: string | null; readonly sourceIds: readonly string[] }
  | { readonly kind: "deferred"; readonly retryAt: Date }
  | { readonly kind: "wait"; readonly blockedReason: "budget" | "credential" | "external_outcome_unknown" | "provider_unavailable" };

type ProductDatabaseRequest = Omit<JungleScoutRequest, "body"> & { readonly body: JsonApiRequestBody };

function nextParameters(url: string): Readonly<Record<string, string>> | null {
  const cursor = new URL(url).searchParams.get("page[cursor]");
  return cursor === null || cursor.length === 0
    ? null
    : { marketplace: "us", "page[size]": "100", "page[cursor]": cursor };
}

function withParameters(request: ProductDatabaseRequest, parameters: Readonly<Record<string, string>>): ProductDatabaseRequest {
  return { ...request, query: parameters };
}

async function collectProductDatabase(
  pool: Pool,
  transport: JsTransport,
  context: ApiValidationContext,
  asins?: readonly string[],
): Promise<ProductCollection> {
  const built = buildProductDatabaseRequest({ keyword: context.keyword, ...(asins ? { asins } : {}) });
  if (!built.ok || built.value.body === null) return { kind: "collected", observations: [], complete: false, block: "PRODUCT_DATABASE_REQUEST_INVALID", sourceIds: [] };
  const body = built.value.body;
  let request: ProductDatabaseRequest = { ...built.value, body };
  const observations: ProductObservation[] = [];
  const sourceIds = new Set<string>();
  const seenCursors = new Set<string>();
  let pagesFetched = 0;
  while (true) {
    const result=await readOfficialSource({pool,transport,context},request);
    if(result.kind!=="source"){
      if(result.kind==='wait'&&result.blockedReason==='budget'&&context.callBudget?.remaining===0)
        return { kind: "collected", observations, complete: false, block: "CANDIDATE_CALL_LIMIT", sourceIds: [...sourceIds] };
      return result;
    }
    const source=result.source;
    sourceIds.add(source.sourceId);
    if (source.observedAt === null) return { kind: "collected", observations, complete: false, block: "CACHE_OBSERVED_AT_MISSING", sourceIds: [...sourceIds] };
    const parsed = parseProductDatabaseResponse(result.body, { sourceId: source.sourceId, observedAt: source.observedAt });
    if (!parsed.ok) return { kind: "collected", observations, complete: false, block: parsed.code, sourceIds: [...sourceIds] };
    observations.push(...parsed.value);
    pagesFetched += 1;
    const link = readJsonApiNext(result.body, parsed.value.length, 100);
    if (link.kind === "complete") return { kind: "collected", observations, complete: true, block: null, sourceIds: [...sourceIds] };
    if (link.kind === "invalid") return { kind: "collected", observations, complete: false, block: link.code, sourceIds: [...sourceIds] };
    const page = nextPostPage({ next: link.value, endpoint: request.endpoint, body: request.body, pagesFetched, maxPages: context.snapshot.productDatabaseMaxPages });
    if (page.kind === "incomplete") return { kind: "collected", observations, complete: false, block: page.reason, sourceIds: [...sourceIds] };
    if (page.kind === "invalid_next") return { kind: "collected", observations, complete: false, block: page.code, sourceIds: [...sourceIds] };
    if (page.kind === "complete") return { kind: "collected", observations, complete: true, block: null, sourceIds: [...sourceIds] };
    const parameters = nextParameters(page.url);
    const cursor = parameters?.["page[cursor]"];
    if (parameters === null || cursor === undefined || seenCursors.has(cursor)) return { kind: "collected", observations, complete: false, block: "REPEATED_OR_MISSING_CURSOR", sourceIds: [...sourceIds] };
    seenCursors.add(cursor);
    request = withParameters(request, parameters);
  }
}

// Product Database's 30-day estimates trail each product's update date; use the latest one as the window.
function trailingPeriod(products: readonly ProductObservation[]): { readonly startDate: string; readonly endDate: string } | null {
  const updated = products.flatMap((product) => product.updatedAt.kind === "unknown" ? [] : [Date.parse(product.updatedAt.value)]).filter(Number.isFinite);
  if (!updated.length) return null;
  const end = new Date(Math.max(...updated));
  const start = new Date(end.getTime() - 29 * 86_400_000);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

function finalOutcome(input: { readonly assessment: NicheAssessment; readonly complete: boolean; readonly block: string | null; readonly reviewKnown: boolean }): "pass" | "reject" | "hold" {
  if (input.assessment.hardFail) return "reject";
  if (!input.complete || input.block !== null || !input.reviewKnown) return "hold";
  return input.assessment.outcome;
}

export async function consumeOfficialValidation(
  pool: Pool,
  transport: JsTransport,
  context: ApiValidationContext,
  onDeferred?: (retryAt: Date) => Promise<void>,
): Promise<ApiValidationResult> {
  const readContext = context.candidateCallLimit === undefined
    ? context
    : { ...context, callBudget: context.callBudget ?? { remaining: context.candidateCallLimit } };
  // With a captured Amazon first page, the market is its non-sponsored products, looked up in one call.
  // Product Database's keyword search returns products unrelated to the first page, so it is only the fallback.
  const firstPageAsins = context.firstPageSource
    ? [...new Set(context.firstPageSource.observation.slots.flatMap(slot => slot.adStatus === "not_marked" && slot.asin !== null ? [slot.asin] : []))].sort().slice(0, 100)
    : [];
  const firstPageMode = firstPageAsins.length > 0;
  const collection = await collectProductDatabase(pool, transport, readContext, firstPageMode ? firstPageAsins : undefined);
  if (collection.kind === "deferred") {
    if (onDeferred !== undefined) await onDeferred(collection.retryAt);
    return applyApiValidationWait({ pool, context, blockedReason: "provider_unavailable" });
  }
  if (collection.kind === "wait") return applyApiValidationWait({ pool, context, blockedReason: collection.blockedReason });
  const kitchen=collection.observations.filter(product=>product.category.kind!=='unknown'&&product.category.value==='Kitchen & Dining');
  const categoryConfirmed=firstPageMode?kitchen.length>0:collection.observations.length>0&&kitchen.length===collection.observations.length;
  const catalogFacts=new Map<string,ApiFact["evidence"]>();
  for(const product of collection.observations){
    if(product.asin.kind === "unknown")continue;
    const dimensions=product.catalogDimensions,weight=product.catalogWeight;
    const variants=product.family.kind==='known'?product.family.variants:unknown('FAMILY_UNRESOLVED',product.asin.sourceId);
    const asin=product.asin.value;
    const facts:ApiFact[]=[
      {field:'api_catalog_price:'+asin,evidence:product.price},
      {field:'api_catalog_reviews:'+asin,evidence:product.reviews},
      {field:'api_catalog_units_30d:'+asin,evidence:product.approximate30DayUnitsSold},
      {field:'api_catalog_revenue_30d:'+asin,evidence:product.approximate30DayRevenue},
      {field:'api_catalog_category:'+asin,evidence:product.category},
      {field:'api_catalog_rank:'+asin,evidence:product.productRank},
      {field:'api_catalog_fba_fee:'+asin,evidence:product.fbaFee},
      {field:'api_catalog_reported_variants:'+asin,evidence:variants.kind==='unknown'?variants:{...variants,value:new Set(variants.value).size}},
      {field:"api_catalog_dimensions:"+asin,evidence:dimensions.kind === "unknown" ? dimensions : {...dimensions,value:`${dimensions.value.length} × ${dimensions.value.width} × ${dimensions.value.height} ${dimensions.value.unit}`}},
      {field:"api_catalog_weight:"+asin,evidence:weight.kind === "unknown" ? weight : {...weight,value:`${weight.value.value} ${weight.value.unit}`}},
    ];
    for(const fact of facts){
      const previous=catalogFacts.get(fact.field);
      if(!previous)catalogFacts.set(fact.field,fact.evidence);
      else if(previous.kind !== "unknown" && (fact.evidence.kind === "unknown" || previous.value !== fact.evidence.value))
        catalogFacts.set(fact.field,unknown("CONFLICTING_CATALOG_OBSERVATIONS",fact.evidence.sourceId));
    }
  }
  if(!await storeApiFacts(pool,context,[...catalogFacts].map(([field,evidence])=>({field,evidence}))))return "stale";
  const canonical = await loadCanonicalNicheEvidence(pool, context.candidateId);
  // First-page mode: the population is complete only when every requested ASIN came back; rules count
  // its Kitchen & Dining products, and the leader uses Product Database's trailing 30-day estimates.
  const returned=new Set(collection.observations.flatMap(product=>product.asin.kind==='unknown'?[]:[product.asin.value]));
  const firstPageComplete=firstPageMode&&context.firstPageSource?.observation.coverage==='complete'&&collection.complete&&
    collection.block===null&&firstPageAsins.every(asin=>returned.has(asin));
  let marketLeader=firstPageMode
    ? selectFirstPageLeader(kitchen,{complete:firstPageComplete,period:trailingPeriod(kitchen)})
    : selectMarketLeader([],{complete:false,period:null});
  if(firstPageMode&&context.firstPageSource)marketLeader=withPageRankedRepresentative(marketLeader,context.firstPageSource.observation.slots);
  let aggregate = aggregateProductDatabase({
    observations: firstPageMode ? withFamilyTotals(kitchen) : collection.observations,
    populationComplete: firstPageMode ? firstPageComplete : collection.complete,
    review2000HardFailCount: context.snapshot.review2000HardFailCount,
    monthlyRevenueMinUsd: context.snapshot.monthlyRevenueMinUsd,
  });
  // The review barrier counts the first organic Kitchen & Dining slots in page order, where a shopper decides.
  let reviewAggregate = aggregate;
  if(firstPageMode&&context.firstPageSource){
    const top=topOrganicSlots(context.firstPageSource.observation.slots,kitchen,returned,REVIEW_TOP_SLOTS);
    reviewAggregate=aggregateProductDatabase({observations:top.products,
      populationComplete:top.complete&&context.firstPageSource.observation.coverage==='complete'&&collection.complete&&collection.block===null,
      review2000HardFailCount:context.snapshot.review2000HardFailCount,monthlyRevenueMinUsd:context.snapshot.monthlyRevenueMinUsd});
  }
  let nicheInput: NicheInput = {
    review700Count: reviewAggregate.review700Count,
    review2000Count: reviewAggregate.review2000Count,
    monthlyRevenueCompetitorCount: aggregate.monthlyRevenueCompetitorCount,
    ...canonical,
    topPriceUsd:marketLeader.price,
  };
  let assessment = evaluateNiche(nicheInput, context.snapshot);
  let supplementBlock:string|null=null;
  let firstPageSales:FirstPageSales|undefined;
  if(firstPageMode&&context.firstPageSource){
    // First-page sales and share come from the same lookup's 30-day estimates; no extra calls.
    const period=trailingPeriod(collection.observations);
    const {receiptId,observation}=context.firstPageSource;
    const {shareTop1MustBeBelowPct,shareTop3MustBeBelowPct,firstPageSalesMinUsd}=context.snapshot;
    // Market identity comes from the first-page receipt; revenue and family come from the lookup.
    const pageSourceId='browser-task-result:'+receiptId;
    const pageRows=withFamilyTotals(collection.observations).flatMap(product=>product.asin.kind==='unknown'||!firstPageAsins.includes(product.asin.value)?[]
      :[{...product,asin:measured(product.asin.value,pageSourceId,observation.observedAt)}]);
    const concentration=assessMarketConcentration({rows:marketRevenueRows(pageRows),expectedAsins:firstPageAsins,period,
      sourceId:pageSourceId,observedAt:observation.observedAt},context.snapshot);
    if(firstPageComplete)firstPageSales={kind:'complete',observations:pageRows,sourceIds:[...collection.sourceIds],period,
      marketReceiptId:receiptId,marketAsins:firstPageAsins,concentration,criteria:{shareTop1MustBeBelowPct,shareTop3MustBeBelowPct,firstPageSalesMinUsd}};
  }
  const sourceIds=new Set(collection.sourceIds);
  // The per-ASIN sales follow-ups cost one call per product; first-page mode stays at one call.
  if(!firstPageMode&&categoryConfirmed&&!assessment.hardFail&&collection.complete&&collection.block===null){
    const anchor=(await pool.query<{anchor:Date|null}>("SELECT min(observed_at) AS anchor FROM api_validation_sources WHERE id=ANY($1::uuid[])",[collection.sourceIds.map(id=>id.slice('api-validation-source:'.length))])).rows[0]?.anchor;
    if(!anchor)supplementBlock='API_SOURCE_TIME_UNKNOWN';
    else{
      const extra=await collectSupplementary({pool,transport,context:readContext},collection.observations,anchor);
      if(extra.kind==='stale')return 'stale';
      if(extra.kind==='wait')return applyApiValidationWait({pool,context,blockedReason:extra.blockedReason});
      if(extra.kind==='deferred'){if(onDeferred)await onDeferred(extra.retryAt);return applyApiValidationWait({pool,context,blockedReason:'provider_unavailable'});}
      extra.sourceIds.forEach(id=>sourceIds.add(id));
      if(extra.kind==='invalid')supplementBlock='ADDITIONAL_API_SCHEMA_UNCONFIRMED';
      else{
        marketLeader=selectMarketLeader(extra.observations,{complete:collection.complete,period:extra.period});
        aggregate=aggregateProductDatabase({observations:extra.observations,populationComplete:collection.complete,review2000HardFailCount:context.snapshot.review2000HardFailCount,monthlyRevenueMinUsd:context.snapshot.monthlyRevenueMinUsd});
        reviewAggregate=aggregate;
        nicheInput={review700Count:aggregate.review700Count,review2000Count:aggregate.review2000Count,monthlyRevenueCompetitorCount:aggregate.monthlyRevenueCompetitorCount,...canonical,topPriceUsd:marketLeader.price};
        assessment=evaluateNiche(nicheInput,context.snapshot);
        if(context.firstPageSource){
          const page=await collectFirstPageSales({pool,transport,context:readContext},context.firstPageSource);
          if(page.kind==='stale')return 'stale';
          if(page.kind==='wait')return applyApiValidationWait({pool,context,blockedReason:page.blockedReason});
          if(page.kind==='deferred'){if(onDeferred)await onDeferred(page.retryAt);return applyApiValidationWait({pool,context,blockedReason:'provider_unavailable'});}
          if(page.kind==='complete'){firstPageSales=page;page.sourceIds.forEach(id=>sourceIds.add(id));}
        }
      }
    }
  }
  const evidenceBlock = collection.block ?? (!categoryConfirmed?'CATEGORY_MEMBERSHIP_UNCONFIRMED':supplementBlock) ?? (aggregate.complete ? null : "PRODUCT_DATABASE_METRICS_INCOMPLETE");
  return applyApiValidationDecision({
    pool,
    context,
    decision: {
      assessment,
      input: nicheInput,
      outcome: categoryConfirmed?finalOutcome({ assessment, complete: aggregate.complete, block: evidenceBlock, reviewKnown: isKnown(reviewAggregate.review700Count) && isKnown(reviewAggregate.review2000Count) }):'hold',
      evidenceBlock,
      sourceIds: [...sourceIds],
      marketLeader,
      ...(firstPageSales?{firstPageSales}:{}),
    },
  });
}
