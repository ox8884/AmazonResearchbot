import assert from "node:assert/strict";
import {
  buildHistoricalSearchVolumeRequest,
  buildKeywordRequest,
  buildProductDatabaseRequest,
  buildSalesEstimateRequest,
  buildShareOfVoiceRequest,
} from "../packages/integrations/src/jungle-scout/requests.ts";
import {
  parseKeywordResponse,
  parseHistoricalSearchVolumeResponse,
  parseProductDatabaseResponse,
  parseSalesEstimateResponse,
  parseShareOfVoiceResponse,
} from "../packages/integrations/src/jungle-scout/responses.ts";
import { nextPostPage } from "../packages/integrations/src/jungle-scout/pagination.ts";
import { createOfficialTransport } from "../packages/integrations/src/jungle-scout/official-transport.ts";
import { resolveTransport } from "../packages/integrations/src/jungle-scout/transport.ts";
import type { JsonRequest } from "../packages/security/src/pinned-http.ts";
import type { ResolvedTarget } from "../packages/security/src/egress.ts";

const source = { sourceId: "fixture:official-js", observedAt: "2026-09-06T12:00:00.000Z" };
const now = new Date("2026-09-06T12:00:00.000Z");

const product = buildProductDatabaseRequest({ keyword: "sentinel product keyword" });
assert.equal(product.ok, true);
if (product.ok) {
  assert.deepEqual(product.value.query, { marketplace: "us", "page[size]": "100" });
  assert.deepEqual(product.value.headers, {
    authorization: "KEY_NAME:API_KEY", xApiType: "junglescout",
    accept: "application/vnd.junglescout.v1+json", contentType: "application/vnd.api+json",
  });
  assert.deepEqual(product.value.body, {
    data: {
      type: "product_database_query",
      attributes: { categories: ["Kitchen & Dining"], include_keywords: ["sentinel product keyword"] },
    },
  });
}

const keywords = buildKeywordRequest({ keyword: "sentinel keyword" });
assert.equal(keywords.ok, true);
if (keywords.ok)
  assert.deepEqual(keywords.value.body.data.attributes.search_terms, ["sentinel keyword"]);

const hsv = buildHistoricalSearchVolumeRequest({ keyword: "sentinel hsv", now });
assert.equal(hsv.ok, true);
if (hsv.ok)
  assert.deepEqual(hsv.value.query, {
    marketplace: "us", keyword: "sentinel hsv", start_date: "2025-09-06", end_date: "2026-09-05",
  });

const sales = buildSalesEstimateRequest({ asin: "B0ABC12345", now });
assert.equal(sales.ok, true);
if (sales.ok)
  assert.deepEqual(sales.value.query, {
    marketplace: "us", asin: "B0ABC12345", start_date: "2026-08-07", end_date: "2026-09-05",
  });
const secondAsin = buildSalesEstimateRequest({ asin: "B0DEF67890", now });
assert.equal(secondAsin.ok, true);

const sov = buildShareOfVoiceRequest({ keyword: "sentinel sov" });
assert.equal(sov.ok, true);
if (sov.ok) assert.deepEqual(sov.value.query, { marketplace: "us", keyword: "sentinel sov" });

const body = { data: { type: "keywords_by_keyword_query", attributes: { search_terms: ["sentinel"] } } };
const page = nextPostPage({
  next: "https://developer.junglescout.com/api/keywords/keywords_by_keyword_query?marketplace=us&page%5Bcursor%5D=sentinel",
  endpoint: "keywords_by_keyword_query",
  body,
  pagesFetched: 1,
  maxPages: 3,
});
assert.equal(page.kind, "next");
if (page.kind === "next") assert.equal(page.body, body);
for (const next of [
  "http://127.0.0.1/api/keywords/keywords_by_keyword_query?marketplace=us&page[cursor]=x",
  "https://developer.junglescout.com/api/keywords/keywords_by_keyword_query?marketplace=ca&page[cursor]=x",
  "https://developer.junglescout.com/api/share_of_voice?marketplace=us&page[cursor]=x",
]) {
  assert.equal(nextPostPage({ next, endpoint: "keywords_by_keyword_query", body, pagesFetched: 1, maxPages: 3 }).kind, "invalid_next");
}
assert.equal(nextPostPage({ next: page.kind === "next" ? page.url : null, endpoint: "keywords_by_keyword_query", body, pagesFetched: 3, maxPages: 3 }).kind, "incomplete");

const productResponse = parseProductDatabaseResponse({
  data: [{ id: "us/B0ABC12345", type: "product_database_result", attributes: { approximate_30_day_units_sold: 42, approximate_30_day_revenue: null, parent_asin: null, is_variant: null } }],
}, source);
assert.equal(productResponse.ok, true);
if (productResponse.ok) {
  assert.equal(productResponse.value[0]?.approximate30DayUnitsSold.kind, "estimate");
  assert.equal(productResponse.value[0]?.approximate30DayRevenue.kind, "unknown");
  assert.equal(productResponse.value[0]?.family.kind, "unknown");
  assert.equal("firstPageSales" in (productResponse.value[0] ?? {}), false);
}
const missingProductMetric = parseProductDatabaseResponse({
  data: [{ id: "us/B0DEF67890", type: "product_database_result", attributes: { parent_asin: "B0PARENT01", is_variant: false } }],
}, source);
assert.equal(missingProductMetric.ok, true);
if (missingProductMetric.ok)
  assert.equal(missingProductMetric.value[0]?.approximate30DayUnitsSold.kind, "unknown");

const physicalAttributes = { length_value: 3.5, width_value: 7.9, height_value: 9.2, dimensions_unit: "inches", weight_value: 2.2906, weight_unit: "pounds" };
function catalog(attrs: Record<string, unknown>) {
  const parsed = parseProductDatabaseResponse({data:[{id:"us/B0ABC12345",type:"product_database_result",attributes:attrs}]}, source);
  assert.ok(parsed.ok); const row = parsed.value[0]; assert.ok(row); return row;
}
const physical = catalog(physicalAttributes);
assert.deepEqual(physical.catalogDimensions, {kind:"measured",value:{length:3.5,width:7.9,height:9.2,unit:"inches"},...source});
assert.deepEqual(physical.catalogWeight, {kind:"measured",value:{value:2.2906,unit:"pounds"},...source});
for (const changed of [{length_value:0},{width_value:-1},{height_value:"9.2"},{dimensions_unit:null},{dimensions_unit:"unsupported"}])
  assert.equal(catalog({...physicalAttributes,...changed}).catalogDimensions.kind,"unknown");
for (const changed of [{weight_value:0},{weight_value:-1},{weight_value:"2.2906"},{weight_unit:null},{weight_unit:"unsupported"}])
  assert.equal(catalog({...physicalAttributes,...changed}).catalogWeight.kind,"unknown");
assert.equal(catalog({}).catalogDimensions.kind,"unknown");
assert.equal(catalog({}).catalogWeight.kind,"unknown");
assert.equal("standardSize" in physical,false,"An ASIN measurement is not a niche-level Standard decision");

const historical = parseHistoricalSearchVolumeResponse({
  data: [{ id: "us/sentinel/2026-08-30/2026-09-05", type: "historical_keyword_search_volume", attributes: { estimate_start_date: "2026-08-30", estimate_end_date: "2026-09-05", estimated_exact_search_volume: 99 } }],
}, source);
assert.equal(historical.ok, true);
if (historical.ok) assert.equal(historical.value[0]?.estimatedExactSearchVolume.kind, "estimate");

const saleResponse = parseSalesEstimateResponse({
  data: [{ id: "us/B0ABC12345", type: "sales_estimate_result", attributes: { is_parent: false, is_variant: true, is_standalone: false, parent_asin: "B0PARENT01", data: [{ date: "2026-09-05", estimated_units_sold: 7 }] } }],
}, source);
assert.equal(saleResponse.ok, true);
if (saleResponse.ok) assert.equal(saleResponse.value[0]?.daily[0]?.estimatedUnitsSold.kind, "estimate");
const missingSaleMetric = parseSalesEstimateResponse({
  data: [{ id: "us/B0DEF67890", type: "sales_estimate_result", attributes: { is_parent: false, is_variant: false, is_standalone: true, data: [{ date: "2026-09-05" }] } }],
}, source);
assert.equal(missingSaleMetric.ok, true);
if (missingSaleMetric.ok) assert.equal(missingSaleMetric.value[0]?.daily[0]?.estimatedUnitsSold.kind, "unknown");

const sovResponse = parseShareOfVoiceResponse({
  data: { id: "us/sentinel", type: "share_of_voice", attributes: { estimated_30_day_search_volume: 10, product_count: 2, brands: [], updated_at: "2026-09-06T00:00:00.000Z", exact_suggested_bid_median: null, top_asins_model_start_date: "2026-09-01", top_asins_model_end_date: "2026-09-05", top_asins: [] } },
}, source);
assert.equal(sovResponse.ok, true);
if (sovResponse.ok) {
  assert.equal(sovResponse.value.estimated30DaySearchVolume.kind, "estimate");
  assert.equal("sales" in sovResponse.value, false);
}

assert.equal(parseHistoricalSearchVolumeResponse({ data: "bad" }, source).ok, false);
const sent: {target: Readonly<ResolvedTarget>; request: JsonRequest}[] = [];
const credentials = {keyName:"fixture-key-name",apiKey:"fixture-secret",accountScope:"fixture-account"};
const official = createOfficialTransport(credentials, {
  resolver: async () => [{address:"9.9.9.9",family:4}],
  request: async (target, request) => {
    sent.push({target,request});
    return {status:200,body:{fixture:true},retryAfter:null};
  },
});
assert.equal(official.kind,"ready");
if(official.kind === "ready") {
  for(const built of [product,keywords,hsv,buildSalesEstimateRequest({asin:"B0ABC12345",now}),buildShareOfVoiceRequest({keyword:"fixture"})]) {
    assert.ok(built.ok);
    await official.send({path:built.value.path+"?"+new URLSearchParams(built.value.query),method:built.value.method,...(built.value.body?{body:built.value.body}:{})});
  }
  assert.equal(sent.length,5);
  for(const call of sent) {
    assert.equal(call.target.hostname,"developer.junglescout.com");
    assert.equal(call.target.address,"9.9.9.9");
    assert.equal(call.request.headers.authorization,"fixture-key-name:fixture-secret");
    assert.equal(call.request.headers["x-api-type"],"junglescout");
    assert.equal(call.request.headers.accept,"application/vnd.junglescout.v1+json");
  }
  for(const path of ["https://other.invalid/api/share_of_voice?marketplace=us","//other.invalid/api/share_of_voice?marketplace=us","/api/not_allowed?marketplace=us","/api/share_of_voice?marketplace=ca","/api/share_of_voice?marketplace=us&marketplace=ca","/api/share_of_voice?marketplace=us#fragment"]) {
    await assert.rejects(official.send({path,method:"GET"}));
  }
  await assert.rejects(official.send({path:"/api/share_of_voice?marketplace=us",method:"POST"}));
  await assert.rejects(official.send({path:"/api/product_database_query?marketplace=us",method:"POST",body:{data:{type:"unexpected",attributes:{}}}}));
  assert.equal(sent.length,5,"Rejected requests must not reach HTTP");
}
const privateDns = createOfficialTransport(credentials, {
  resolver: async () => [{address:"9.9.9.9",family:4},{address:"127.0.0.1",family:4}],
  request: async () => {throw new Error("Private DNS must not reach HTTP");},
});
assert.equal(privateDns.kind,"ready");
if(privateDns.kind === "ready") await assert.rejects(privateDns.send({path:"/api/share_of_voice?marketplace=us&keyword=fixture",method:"GET"}),/DNS_NON_PUBLIC/);
assert.equal(createOfficialTransport({...credentials,apiKey:"bad\r\nheader"}).kind,"disabled");
assert.equal(createOfficialTransport({...credentials,apiKey:"invalid-☃"}).kind,"disabled");
assert.equal(createOfficialTransport({...credentials,accountScope:""}).kind,"disabled");
assert.equal(resolveTransport({APP_ENV:"development",JS_API_KEY_NAME:credentials.keyName,JS_API_KEY:credentials.apiKey,JS_ACCOUNT_SCOPE:credentials.accountScope}).kind,"disabled","Keys alone cannot activate paid calls");
assert.equal(resolveTransport({APP_ENV:"development",JS_TRANSPORT:"official",JS_API_KEY_NAME:credentials.keyName,JS_API_KEY:credentials.apiKey,JS_ACCOUNT_SCOPE:credentials.accountScope}).kind,"ready","Explicit official configuration constructs a transport without sending a request");
assert.equal(resolveTransport({APP_ENV:"production",JS_TRANSPORT:"official",JS_API_KEY_NAME:credentials.keyName,JS_API_KEY:credentials.apiKey,JS_ACCOUNT_SCOPE:credentials.accountScope}).kind,"disabled");
assert.equal(resolveTransport({APP_ENV:"development",JS_TRANSPORT:"disabled",JS_SIMULATOR_ORIGIN:"http://127.0.0.1:1"}).kind,"disabled");
assert.equal(resolveTransport({APP_ENV:"development",JS_TRANSPORT:"official",JS_SIMULATOR_ORIGIN:"http://127.0.0.1:1",JS_API_KEY_NAME:credentials.keyName,JS_API_KEY:credentials.apiKey,JS_ACCOUNT_SCOPE:credentials.accountScope}).kind,"disabled");
const keywordData={data:[{id:'us/related keyword',type:'keywords_by_keyword_result',attributes:{country:'us',name:'related keyword',monthly_search_volume_exact:null,monthly_search_volume_broad:100,monthly_trend:-25,quarterly_trend:null,organic_product_count:null}}]};
const keywordFacts=parseKeywordResponse(keywordData,source);assert.ok(keywordFacts.ok);
assert.equal(keywordFacts.value[0]?.exact30DaySearchVolume.kind,'unknown');assert.equal(keywordFacts.value[0]?.monthlyTrend.value,-25);
assert.equal(parseKeywordResponse({data:[{...keywordData.data[0],id:'ca/related keyword'}]},source).ok,false);
const historyData={data:[{id:'us/fixture/2026-08-30/2026-09-05',type:'historical_keyword_search_volume',attributes:{estimate_start_date:'2026-08-30',estimate_end_date:'2026-09-05',estimated_exact_search_volume:null}}]};
assert.equal(parseHistoricalSearchVolumeResponse(historyData,source,{keyword:'other',startDate:'2026-08-01',endDate:'2026-09-05'}).ok,false);
assert.equal(parseHistoricalSearchVolumeResponse({data:[...historyData.data,...historyData.data]},source).ok,false);
assert.equal(parseHistoricalSearchVolumeResponse(historyData,source,{keyword:'fixture',startDate:'2026-08-31',endDate:'2026-09-05'}).ok,false);
const saleData={data:[{id:'us/B0ABC12345',type:'sales_estimate_result',attributes:{is_parent:false,is_variant:false,is_standalone:true,parent_asin:null,variants:[],data:[{date:'2026-09-05',estimated_units_sold:null}]}}]};
assert.equal(parseSalesEstimateResponse({...saleData,data:[{...saleData.data[0],id:'ca/B0ABC12345'}]},source).ok,false);
assert.equal(parseSalesEstimateResponse(saleData,source,{asin:'B0DEF67890',startDate:'2026-08-07',endDate:'2026-09-05'}).ok,false);
const saleFacts=parseSalesEstimateResponse(saleData,source);assert.ok(saleFacts.ok);assert.equal(saleFacts.value[0]?.daily[0]?.lastKnownPrice.kind,'unknown');
const badFamily=parseSalesEstimateResponse({data:[{...saleData.data[0],attributes:{...saleData.data[0].attributes,is_variant:true,is_standalone:false,parent_asin:'invalid-parent'}}]},source);assert.ok(badFamily.ok);assert.equal(badFamily.value[0]?.family.kind,'unknown');
assert.equal(parseShareOfVoiceResponse({data:{id:'us/other',type:'share_of_voice',attributes:{brands:[],product_count:1}}},source,'fixture').ok,false);
const invalidCount=parseShareOfVoiceResponse({data:{id:'us/fixture',type:'share_of_voice',attributes:{brands:[],product_count:-1}}},source,'fixture');assert.ok(invalidCount.ok);assert.equal(invalidCount.value.productCount.kind,'unknown');
console.log(JSON.stringify({ scenario: "jungle-scout-contracts", result: "PASS", officialEndpoints:sent.length, paidCalls: 0 }));
