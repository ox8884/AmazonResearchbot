import {readFile} from "node:fs/promises";
import {openAcceptance} from "./support/acceptance.mjs";
import {importCsv} from "./support/import-csv.mjs";
import {
  INITIAL_SETTINGS,
  evaluateNiche,
  evaluateShare,
  foldParentRevenue,
  measured,
  parseNumericCell,
  unknown,
  assessStandardSize,
  parseAmazonPackageMeasurements,
} from "@forge-ops/domain";
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const missing = parseNumericCell(null, "s", "t");
assert(missing.kind === "unknown" && missing.value === null, "null became a number");
const empty = parseNumericCell("", "s", "t");
assert(empty.kind === "unknown", "empty became a number");
const lt = parseNumericCell("< 450", "s", "t");
assert(lt.kind === "unknown" && lt.reason.includes("450"), "< 450 must stay unknown");
assert(lt.reason.includes("inequality"), "< 450 reason");
const ok = parseNumericCell("12", "s", "t");
assert(ok.kind === "measured" && ok.value === "12", "12 should be measured");

const representativeAsin = 'B0QA000001';
const packaged = {asin:representativeAsin,marketplace:'us',basis:'packaged_unit',dimensions:{length:18,width:14,height:8,unit:'inches'},weight:{value:20,unit:'pounds'}};
const sizeEvidence = (value:unknown) => measured(value,'synthetic:packaged-product','2026-09-09T00:00:00.000Z');
const size = (value:unknown) => assessStandardSize(representativeAsin,sizeEvidence(value));
const boundary = size(packaged);
assert(boundary.kind==='measured'&&boundary.value===true,'Standard boundary is inclusive');
const rotated = size({...packaged,dimensions:{...packaged.dimensions,length:8,width:18,height:14}});
assert(rotated.kind==='measured'&&rotated.value===true,'Package orientation cannot change Standard eligibility');
for(const field of ['length','width','height'] as const){
 const exceeded=size({...packaged,dimensions:{...packaged.dimensions,[field]:packaged.dimensions[field]+0.0001}});
 assert(exceeded.kind==='measured'&&exceeded.value===false,field+' above maximum is nonstandard');
}
const heavy=size({...packaged,weight:{...packaged.weight,value:20.0001}});
assert(heavy.kind==='measured'&&heavy.value===false,'Weight above20lb is nonstandard');
for(const value of [
 {...packaged,asin:'B0QA000002'}, {...packaged,marketplace:'ca'}, {...packaged,basis:'product_only'},
 {...packaged,dimensions:{...packaged.dimensions,unit:'cm'}},
 {...packaged,weight:{...packaged.weight,value:0}}, {...packaged,weight:{...packaged.weight,value:'20'}},
 {...packaged,dimensions:{...packaged.dimensions,length:Infinity}}, {...packaged,weight:null},
])assert(size(value).kind==='unknown','Unconfirmed packaged measurements must stay unknown');
assert(assessStandardSize(null,sizeEvidence(packaged)).kind==='unknown','Representative selection is required');
assert(assessStandardSize(representativeAsin,unknown('missing')).kind==='unknown','Missing package evidence cannot pass');
assert(assessStandardSize(representativeAsin,{...sizeEvidence(packaged),kind:'estimate'}).kind==='unknown','Estimated packaging is not a measurement');
assert(assessStandardSize(representativeAsin,measured(packaged,'','not-a-date')).kind==='unknown','Source provenance is required');

const packageSource={sourcePageUrl:'https://www.amazon.com/dp/'+representativeAsin,observedAt:'2026-09-09T00:00:00.000Z',rows:[{label:'ASIN',value:representativeAsin},{label:'Package Dimensions',value:'18 x 14 x 8 inches; 16 ounces'}]};
const parsePackage=(value:unknown)=>parseAmazonPackageMeasurements(representativeAsin,value);
const packageResult=parsePackage(packageSource);
assert(packageResult.kind==='measured'&&packageResult.value.weight.value===1,'Explicit package ounces convert to pounds');
const packageStandard=assessStandardSize(representativeAsin,packageResult);
assert(packageStandard.kind==='measured'&&packageStandard.value,'Parsed package source must reach the Standard predicate');
const separatePackage=parsePackage({...packageSource,rows:[packageSource.rows[0],{label:'Package Dimensions',value:'18 x 14 x 8 inches'},{label:'Package Weight',value:'20 pounds'}]});
assert(separatePackage.kind==='measured'&&separatePackage.value.weight.value===20,'Explicit separate package weight is accepted');
for(const source of [
 {...packageSource,sourcePageUrl:'https://www.amazon.ca/dp/'+representativeAsin},
 {...packageSource,sourcePageUrl:'https://www.amazon.com.evil.invalid/dp/'+representativeAsin},
 {...packageSource,sourcePageUrl:'https://user@www.amazon.com/dp/'+representativeAsin},
 {...packageSource,sourcePageUrl:'https://www.amazon.com/dp/'+representativeAsin+'/../B0QA000002'},
 {...packageSource,sourcePageUrl:'https://www.amazon.com/dp/B0QA000002'},
 {...packageSource,rows:[{label:'ASIN',value:'B0QA000002'},packageSource.rows[1]]},
 {...packageSource,rows:[packageSource.rows[0],{label:'Item Dimensions L x W x Thickness',value:'10"L x 2.5"W x 2.5"Th'},{label:'Item Weight',value:'4.8 ounces'}]},
 {...packageSource,rows:[packageSource.rows[0],{label:'Package Dimensions',value:'18 x 14 x 8 inches'},{label:'Item Weight',value:'1 pound'}]},
 {...packageSource,rows:[...packageSource.rows,{label:'Package Weight',value:'2 pounds'}]},
 {...packageSource,rows:[...packageSource.rows,{label:'Package Dimensions',value:'19 x 14 x 8 inches; 16 ounces'}]},
])assert(parsePackage(source).kind==='unknown','Missing, mismatched or conflicting package sources cannot become measurements');

const hardFail = evaluateNiche(
  {
    review700Count: measured(1, "s", "t"),
    review2000Count: measured(2, "s", "t"),
    topPriceUsd: measured("20", "s", "t"),
    monthlyRevenueCompetitorCount: measured(5, "s", "t"),
    standardSize: measured(true, "s", "t"),
    differentiation: measured(true, "s", "t"),
  },
  INITIAL_SETTINGS,
);
assert(hardFail.hardFail && hardFail.outcome === "reject", "2x 2000+ must hard-fail");

const oneHigh = evaluateNiche(
  {
    review700Count: measured(1, "s", "t"),
    review2000Count: measured(1, "s", "t"),
    topPriceUsd: measured("20", "s", "t"),
    monthlyRevenueCompetitorCount: measured(5, "s", "t"),
    standardSize: measured(true, "s", "t"),
    differentiation: measured(true, "s", "t"),
  },
  INITIAL_SETTINGS,
);
assert(!oneHigh.hardFail, "1x 2000+ is not hard-fail");

const hold = evaluateNiche(
  {
    review700Count: measured(1, "s", "t"),
    review2000Count: measured(0, "s", "t"),
    topPriceUsd: measured("20", "s", "t"),
    monthlyRevenueCompetitorCount: unknown("missing"),
    standardSize: unknown("missing"),
    differentiation: measured(true, "s", "t"),
  },
  INITIAL_SETTINGS,
);
assert(hold.outcome === "hold", `pass3/unknown2 should hold, got ${hold.outcome}`);

const edgeLow = evaluateNiche(
  {
    review700Count: measured(0, "s", "t"),
    review2000Count: measured(0, "s", "t"),
    topPriceUsd: measured("17", "s", "t"),
    monthlyRevenueCompetitorCount: measured(5, "s", "t"),
    standardSize: measured(true, "s", "t"),
    differentiation: measured(true, "s", "t"),
  },
  INITIAL_SETTINGS,
);
assert(edgeLow.outcome === "pass", "price 17 inclusive");
const edgeHigh = evaluateNiche(
  {
    review700Count: measured(0, "s", "t"),
    review2000Count: measured(0, "s", "t"),
    topPriceUsd: measured("80", "s", "t"),
    monthlyRevenueCompetitorCount: measured(5, "s", "t"),
    standardSize: measured(true, "s", "t"),
    differentiation: measured(true, "s", "t"),
  },
  INITIAL_SETTINGS,
);
assert(edgeHigh.outcome === "pass", "price 80 inclusive");

const share = evaluateShare(
  {
    top1Pct: measured("35", "s", "t"),
    top3Pct: measured("55", "s", "t"),
    firstPageSalesUsd: measured("350000", "s", "t"),
  },
  {
    top1MustBeBelowPct: "35",
    top3MustBeBelowPct: "55",
    firstPageSalesMinUsd: "350000",
  },
);
assert(share.top1 === "fail", "share 35 is not < 35");
assert(share.top3 === "fail", "share 55 is not < 55");
assert(share.firstPageSales === "pass", "350000 meets min");

const folded = foldParentRevenue([
  { asin: "B1", parentAsin: "P", isVariant: true, revenue: "100" },
  { asin: "B2", parentAsin: "P", isVariant: true, revenue: "100" },
  { asin: "B3", parentAsin: "P", isVariant: true, revenue: "100" },
]);
assert(folded.kind === "known" && folded.total === "100" && folded.families === 1, "variants must not triple-count");

const test=await openAcceptance({databaseKey:'evidence-'+Date.now()});
try {
 const bytes=await readFile(new URL('../tests/fixtures/evidence-cells.csv',import.meta.url));
 const uploaded=await importCsv(test,'evidence-cells.csv',bytes);
 assert(uploaded.status===200,'Evidence CSV must import through the authenticated API');
 const rows=await test.pool.query<{keyword_raw:string;field:string;kind:string;value_text:string|null;reason:string|null}>(
  `SELECT ir.keyword_raw,e.field,e.kind,e.value_text,e.reason FROM import_rows ir
   JOIN candidate_import_rows cir ON cir.import_row_id=ir.id JOIN evidence e ON e.candidate_id=cir.candidate_id
   WHERE ir.import_id=$1 AND e.field='reviews'`,[uploaded.body.importId]);
const byKw: Record<string, { kind: string; value_text: string | null; reason: string | null }> = {};
for (const row of rows.rows) byKw[row.keyword_raw] = row;
assert(byKw["lt-reviews"]?.kind === "unknown", "CSV < 450 stored unknown");
assert(byKw["lt-reviews"]?.value_text == null, "CSV < 450 must not store 450");
assert(byKw["empty-reviews"]?.kind === "unknown", "empty reviews unknown");
assert(byKw["ok-reviews"]?.kind === "measured" && byKw["ok-reviews"]?.value_text === "12", "12 measured");
console.log(
  JSON.stringify(
    {
      scenario: "evidence",
      unknownPreserved: true,
      hardFail2: true,
      inclusivePrice: true,
      shareStrictLess: true,
      parentDedupe: folded.kind === "known" ? folded.total : "unknown",
    },
    null,
    2,
  ),
);

} finally {await test.close();}
