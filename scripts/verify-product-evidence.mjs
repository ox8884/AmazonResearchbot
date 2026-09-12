import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readAmazonProductEvidence} from '../apps/browser-bridge/aside-product-evidence.mjs';
import {amazonProductEvidenceSchema} from '../packages/domain/src/amazon-product-evidence.ts';
import * as productEvidence from '../packages/domain/src/amazon-product-evidence.ts';
import {amazonPackageObservationSchema} from '../packages/domain/src/amazon-package.ts';

const element=(text,options={})=>({innerText:text,textContent:text,...options,
 getClientRects:()=>options.hidden?[]:[{}],getAttribute:name=>name==='href'?options.href:null});
function review(id,variant){
 const fields={
  '[data-hook="reviewTitle"]':element('Thick edge'),
  '[data-hook="reviewText"]':element('Too thick for eggs.\n Sturdy handle.'),
  '[data-hook="review-star-rating"]':element('4 out of 5 stars'),
  '[data-hook="format-strip"]':variant,
 };
 return element('PRIVATE REVIEWER PROFILE SHOULD NOT BE READ',{id,querySelector:selector=>fields[selector]??null});
}
const otherVariant=review('RTEST0001',element('Size: 4 pieces',{href:'/portal/customer-reviews/B0QA000002/ref=cm_cr_dp_d_rvw_fmt?_encoding=UTF8&formatType=current_format'}));
const missingVariant=review('RTEST0002',null);
const hostileVariant=review('RTEST0003',element('Size: 5 pieces',{href:'https://evil.invalid/portal/customer-reviews/B0QA000001'}));
const hiddenReview={...review('RTEST0004',null),getClientRects:()=>[]};
const root={querySelector:selector=>selector==='#productTitle'?element(' Synthetic spatula '):null,
 querySelectorAll:selector=>selector==='#feature-bullets li .a-list-item'
  ?[element('Silicone\n blade'),element('Hidden marketing',{hidden:true})]
  :selector==='#localTopReviewsList [data-hook="review"]'?[otherVariant,missingVariant,hostileVariant,hiddenReview]:[]};
const captured=vm.runInNewContext('('+readAmazonProductEvidence.toString()+')(root)',{root,getComputedStyle:()=>({visibility:'visible'})});
const result=amazonProductEvidenceSchema.parse(JSON.parse(JSON.stringify(captured)));
assert.equal(result.title,'Synthetic spatula');
assert.deepEqual(result.claims,['Silicone blade']);
assert.equal(result.reviews.length,3);
assert.equal(result.reviews[0].bodyExcerpt,'Too thick for eggs. Sturdy handle.');
assert.equal(result.reviews[0].reviewedAsin,'B0QA000002');
assert.equal(result.reviews[0].variantPath,'/portal/customer-reviews/B0QA000002');
assert.equal(result.reviews[1].reviewedAsin,null);
assert.equal(result.reviews[2].reviewedAsin,null);
assert.equal(JSON.stringify(result).includes('PRIVATE REVIEWER'),false);
for(const bad of [
 {...result,reviews:[result.reviews[0],result.reviews[0]]},
 {...result,reviews:[{...result.reviews[0],reviewedAsin:'B0QA000001'}]},
 {...result,reviews:[{...result.reviews[0],ratingText:'7 out of 5 stars'}]},
 {...result,reviews:[{...result.reviews[0],author:'Unexpected personal field'}]},
 {...result,claims:['x'.repeat(4001)]},
])assert.equal(amazonProductEvidenceSchema.safeParse(bad).success,false);
const asin='B0QA000001',rows=[{label:'ASIN',value:asin,excerpt:'ASIN '+asin}];
const legacy={protocol:1,kind:'captured',scope:'amazon_product_page',asin,sourcePageUrl:'https://www.amazon.com/dp/'+asin,observedAt:'2026-09-09T00:00:00.000Z',snapshot:'Synthetic source',pageText:rows[0].excerpt,rows};
assert.deepEqual(amazonPackageObservationSchema.parse(legacy),legacy,'Previously stored receipt payloads must retain their exact shape');
assert.equal(amazonPackageObservationSchema.safeParse({...legacy,productEvidence:result}).success,true);
const ownReview={...result.reviews[0],reviewedAsin:asin,variantPath:'/portal/customer-reviews/'+asin};
const inputEvidence={...result,claims:['Silicone blade','Contact me at person@example.invalid'],reviews:[
 ownReview,result.reviews[0],result.reviews[1],
 {...ownReview,id:'RPRIVATE1',bodyExcerpt:'Call me at +1 (212) 555-0123 about the handle.'},
 {...ownReview,id:'RLONG001',bodyExcerpt:Array.from({length:60},(_,index)=>'word'+index).join(' ')},
]};
const snippets=productEvidence.selectAiProductExcerpts(asin,inputEvidence);
assert.deepEqual(snippets.map(row=>row.ref),['claim:0','review:RTEST0001','review:RLONG001']);
assert.equal(snippets[0].text,'Silicone blade');
assert.equal(snippets[1].text,ownReview.bodyExcerpt);
assert.equal(snippets[2].text.split(/\s+/).length,25,'Only a short retained excerpt may be selected');
assert.equal(JSON.stringify(snippets).includes('person@example.invalid'),false);
assert.equal(JSON.stringify(snippets).includes('212'),false);
assert.ok(snippets.every(row=>Object.keys(row).sort().join(',')==='kind,ref,text'),'Reviewer titles, profiles and metadata must not enter the AI excerpts');
console.log(JSON.stringify({scenario:'product-evidence',result:'PASS',otherVariantPreserved:true,unconfirmedVariantNotBorrowed:true,hiddenContentExcluded:true,profilesExcluded:true,legacyReceiptPreserved:true}));
