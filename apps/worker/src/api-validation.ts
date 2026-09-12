import { collectSupplementary } from "./api-supplementary.ts";
import {selectMarketLeader} from './market-leader.ts';
import {collectFirstPageSales,type FirstPageSales} from './first-page-sales.ts';
import { storeApiFacts, type ApiFact } from "./api-facts-store.ts";
import { readOfficialSource } from "./api-reader.ts";
import { evaluateNiche, isKnown, unknown, type NicheAssessment, type NicheInput } from "@forge-ops/domain";
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
): Promise<ProductCollection> {
  const built = buildProductDatabaseRequest({ keyword: context.keyword });
  if (!built.ok || built.value.body === null) return { kind: "collected", observations: [], complete: false, block: "PRODUCT_DATABASE_REQUEST_INVALID", sourceIds: [] };
  const body = built.value.body;
  let request: ProductDatabaseRequest = { ...built.value, body };
  const observations: ProductObservation[] = [];
  const sourceIds = new Set<string>();
  const seenCursors = new Set<string>();
  let pagesFetched = 0;
  while (true) {
    const result=await readOfficialSource({pool,transport,context},request);
    if(result.kind!=="source")return result;
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
  const collection = await collectProductDatabase(pool, transport, context);
  if (collection.kind === "deferred") {
    if (onDeferred !== undefined) await onDeferred(collection.retryAt);
    return applyApiValidationWait({ pool, context, blockedReason: "provider_unavailable" });
  }
  if (collection.kind === "wait") return applyApiValidationWait({ pool, context, blockedReason: collection.blockedReason });
  const categoryConfirmed=collection.observations.length>0&&collection.observations.every(product=>product.category.kind!=='unknown'&&product.category.value==='Kitchen & Dining');
  const catalogFacts=new Map<string,ApiFact["evidence"]>();
  for(const product of collection.observations){
    if(product.asin.kind === "unknown")continue;
    const dimensions=product.catalogDimensions,weight=product.catalogWeight;
    const variants=product.family.kind==='known'?product.family.variants:unknown('FAMILY_UNRESOLVED',product.asin.sourceId);
    const facts:ApiFact[]=[
      {field:'api_catalog_reviews:'+product.asin.value,evidence:product.reviews},
      {field:'api_catalog_reported_variants:'+product.asin.value,evidence:variants.kind==='unknown'?variants:{...variants,value:new Set(variants.value).size}},
      {field:"api_catalog_dimensions:"+product.asin.value,evidence:dimensions.kind === "unknown" ? dimensions : {...dimensions,value:`${dimensions.value.length} × ${dimensions.value.width} × ${dimensions.value.height} ${dimensions.value.unit}`}},
      {field:"api_catalog_weight:"+product.asin.value,evidence:weight.kind === "unknown" ? weight : {...weight,value:`${weight.value.value} ${weight.value.unit}`}},
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
  let marketLeader=selectMarketLeader([],{complete:false,period:null});
  let aggregate = aggregateProductDatabase({
    observations: collection.observations,
    populationComplete: collection.complete,
    review2000HardFailCount: context.snapshot.review2000HardFailCount,
    monthlyRevenueMinUsd: context.snapshot.monthlyRevenueMinUsd,
  });
  let nicheInput: NicheInput = {
    review700Count: aggregate.review700Count,
    review2000Count: aggregate.review2000Count,
    monthlyRevenueCompetitorCount: aggregate.monthlyRevenueCompetitorCount,
    ...canonical,
    topPriceUsd:marketLeader.price,
  };
  let assessment = evaluateNiche(nicheInput, context.snapshot);
  let supplementBlock:string|null=null;
  let firstPageSales:FirstPageSales|undefined;
  const sourceIds=new Set(collection.sourceIds);
  if(categoryConfirmed&&!assessment.hardFail&&collection.complete&&collection.block===null){
    const anchor=(await pool.query<{anchor:Date|null}>("SELECT min(observed_at) AS anchor FROM api_validation_sources WHERE id=ANY($1::uuid[])",[collection.sourceIds.map(id=>id.slice('api-validation-source:'.length))])).rows[0]?.anchor;
    if(!anchor)supplementBlock='API_SOURCE_TIME_UNKNOWN';
    else{
      const extra=await collectSupplementary({pool,transport,context},collection.observations,anchor);
      if(extra.kind==='stale')return 'stale';
      if(extra.kind==='wait')return applyApiValidationWait({pool,context,blockedReason:extra.blockedReason});
      if(extra.kind==='deferred'){if(onDeferred)await onDeferred(extra.retryAt);return applyApiValidationWait({pool,context,blockedReason:'provider_unavailable'});}
      extra.sourceIds.forEach(id=>sourceIds.add(id));
      if(extra.kind==='invalid')supplementBlock='ADDITIONAL_API_SCHEMA_UNCONFIRMED';
      else{
        marketLeader=selectMarketLeader(extra.observations,{complete:collection.complete,period:extra.period});
        aggregate=aggregateProductDatabase({observations:extra.observations,populationComplete:collection.complete,review2000HardFailCount:context.snapshot.review2000HardFailCount,monthlyRevenueMinUsd:context.snapshot.monthlyRevenueMinUsd});
        nicheInput={review700Count:aggregate.review700Count,review2000Count:aggregate.review2000Count,monthlyRevenueCompetitorCount:aggregate.monthlyRevenueCompetitorCount,...canonical,topPriceUsd:marketLeader.price};
        assessment=evaluateNiche(nicheInput,context.snapshot);
        if(context.firstPageSource){
          const page=await collectFirstPageSales({pool,transport,context},context.firstPageSource);
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
      outcome: categoryConfirmed?finalOutcome({ assessment, complete: aggregate.complete, block: evidenceBlock, reviewKnown: isKnown(aggregate.review700Count) && isKnown(aggregate.review2000Count) }):'hold',
      evidenceBlock,
      sourceIds: [...sourceIds],
      marketLeader,
      ...(firstPageSales?{firstPageSales}:{}),
    },
  });
}
