import assert from 'node:assert/strict';
import {selectFirstPageLeader,selectMarketLeader,withFamilyTotals} from '../apps/worker/src/market-leader.ts';
import {parseProductDatabaseResponse} from '../packages/integrations/src/jungle-scout/responses.ts';
const source={sourceId:'synthetic-source',observedAt:'2026-09-09T00:00:00.000Z'};
const scope={complete:true,period:{startDate:'2026-08-10',endDate:'2026-09-08'}};
function row(asin,revenue,price=25,extra={}){
 const parsed=parseProductDatabaseResponse({data:[{id:'us/'+asin,type:'product_database_result',attributes:{price,reviews:100,category:'Kitchen & Dining',parent_asin:null,is_variant:false,is_parent:false,variants:[],approximate_30_day_units_sold:100,approximate_30_day_revenue:revenue,updated_at:source.observedAt,...extra}}]},source);
 assert.equal(parsed.ok,true);return parsed.value[0];
}
const a=row('B0QA000001',10000,25),b=row('B0QA000002',20000,35);
const result=selectMarketLeader([a,b],scope);
assert.equal(result.price.kind,'estimate');assert.equal(result.price.value,'35.00');assert.equal(result.family.value,'B0QA000002');
assert.equal(selectMarketLeader([b,a],scope).price.value,'35.00');
assert.equal(selectMarketLeader([a,b,b],scope).price.value,'35.00','Duplicate ASIN rows cannot change the leader');
assert.equal(selectMarketLeader([a,b],{...scope,complete:false}).price.kind,'unknown');
assert.equal(selectMarketLeader([a,b],{...scope,period:null}).price.kind,'unknown');
assert.equal(selectMarketLeader([a,row('B0QA000002',10000)],scope).price.kind,'unknown','A tie is not an arbitrary winner');
assert.equal(selectMarketLeader([row('B0QA000001',0)],scope).price.kind,'unknown');
for(const price of [null,0,-1,12.345])assert.equal(selectMarketLeader([row('B0QA000001',10000,price)],scope).price.kind,'unknown');
assert.equal(selectMarketLeader([a,row('B0QA000002',null)],scope).price.kind,'unknown','Unknown competing sales cannot be ignored');
assert.equal(selectMarketLeader([a,row('B0QA000002',20000,35,{category:'Office Products'})],scope).price.kind,'unknown');
const parent='B0QA999999';
const child1=row('B0QA000003',30000,27,{is_variant:true,parent_asin:parent});
const child2=row('B0QA000004',30000,27,{is_variant:true,parent_asin:parent});
assert.equal(selectMarketLeader([a,child1,child2],scope).family.value,parent);
assert.equal(selectMarketLeader([a,child1,child2],scope).price.value,'27.00');
const ambiguous=selectMarketLeader([a,child1,row('B0QA000004',30000,29,{is_variant:true,parent_asin:parent})],scope);
assert.equal(ambiguous.family.value,parent);assert.equal(ambiguous.price.kind,'unknown');
assert.equal(selectMarketLeader([child1,row('B0QA000004',20000,27,{is_variant:true,parent_asin:parent})],scope).price.kind,'unknown','Conflicting family sales cannot be summed or picked');
// First-page lookups: Product Database estimates each variant separately, so a family sums its listed variants
// and is priced at its best-selling variant.
const v1=row('B0QA000005',6000,19,{is_variant:true,parent_asin:'B0QA888888'}),v2=row('B0QA000006',9000,24,{is_variant:true,parent_asin:'B0QA888888'});
assert.deepEqual(withFamilyTotals([v1,v2,a]).map(p=>p.approximate30DayRevenue.value),[15000,15000,10000],'Variant revenues add up per family');
assert.equal(selectMarketLeader([a,v1,v2],scope).price.kind,'unknown','The family-level rule still rejects per-variant estimates');
const firstPage=selectFirstPageLeader([a,v1,v2],scope);
assert.equal(firstPage.family.value,'B0QA888888','The family with the larger summed revenue leads');assert.equal(firstPage.price.value,'24.00','Priced at its best-selling variant');
assert.equal(selectFirstPageLeader([a,v1,row('B0QA000006',null,24,{is_variant:true,parent_asin:'B0QA888888'})],scope).price.kind,'unknown','An unknown variant revenue leaves the family unknown');
assert.equal(selectFirstPageLeader([row('B0QA000007',15000),v1,v2],scope).price.kind,'unknown','Tied family totals stay unknown');
console.log(JSON.stringify({scenario:'market-leader',result:'PASS',completeScope:true,tiesUnknown:true,familyDedup:true,priceConflictsUnknown:true,externalCalls:0}));
