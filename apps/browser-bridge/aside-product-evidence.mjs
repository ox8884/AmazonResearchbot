/** Runs in the owned product tab; excludes reviewer profiles and unrelated page panels. */
export function readAmazonProductEvidence(root){
 const clean=value=>(value??'').replace(/[\u200e\u200f\u202a-\u202e]/g,'').replace(/\s+/g,' ').trim();
 const visible=el=>el&&el.getClientRects().length>0&&getComputedStyle(el).visibility==='visible';
 const text=el=>visible(el)?clean(el.innerText):'';
 const attrText=(selector,attribute)=>{const element=root.querySelector(selector);if(!visible(element))return '';return clean(element.getAttribute(attribute)||text(element));};
 const title=text(root.querySelector('#productTitle'))||null;
 const bodyText=text(root.querySelector('body'));
 const detailsMatch=/PRODUCT DETAILS\s+No\. of Sellers:\s*(\d+)\s+Fulfillment:\s*([^\n]+)\s+Dimensions:\s*([^\n]+)\s+Weight:\s*([^\n]+)\s+Product Tier:\s*([^\n]+)/i.exec(bodyText);
 const productDetails=detailsMatch?{sellers:Number(detailsMatch[1]),fulfillment:clean(detailsMatch[2]),dimensions:clean(detailsMatch[3]),weight:clean(detailsMatch[4]),productTier:clean(detailsMatch[5])}:null;
 const claims=[...root.querySelectorAll('#feature-bullets li .a-list-item')].map(text).filter(Boolean);
 const reviews=[];
 for(const row of root.querySelectorAll('#localTopReviewsList [data-hook="review"]')){
  if(!visible(row))continue;
  const title=text(row.querySelector('[data-hook="reviewTitle"]'));
  const bodyExcerpt=text(row.querySelector('[data-hook="reviewText"]'));
  if(!title||!bodyExcerpt)continue;
  const variant=row.querySelector('[data-hook="format-strip"]');
  const variantLabel=text(variant)||null;
  const href=visible(variant)?variant.getAttribute('href'):null;
  const reviewedAsin=/^\/portal\/customer-reviews\/([A-Z0-9]{10})(?:\/ref=[^\s?#]*)?(?:\?[^\s#]*)?$/.exec(href??'')?.[1]??null;
  const rating=row.querySelector('[data-hook="review-star-rating"]');
  const ratingText=visible(rating)?clean(rating.textContent):'';
  reviews.push({id:row.id,title,bodyExcerpt,ratingText:/^[1-5](?:\.0)? out of 5 stars$/.test(ratingText)?ratingText:null,
   variantLabel,variantPath:reviewedAsin?'/portal/customer-reviews/'+reviewedAsin:null,reviewedAsin});
 }
 const catalogFacts=[];
 const addFact=(kind,label,value,sourceText)=>{
  const fact={kind,label:clean(label),value:clean(value),sourceText:clean(sourceText)};
  if(!fact.label||!fact.value||!fact.sourceText||!fact.sourceText.includes(fact.value))return;
  if(!catalogFacts.some(prior=>prior.kind===fact.kind&&prior.label===fact.label&&prior.value===fact.value))catalogFacts.push(fact);
 };
 const breadcrumb=text(root.querySelector('#wayfinding-breadcrumbs_container, #wayfinding-breadcrumbs_feature_div'));
 if(breadcrumb)addFact('category_breadcrumb','Category breadcrumb',breadcrumb,breadcrumb);
 const aggregateRating=attrText('#acrPopover','title');
 if(aggregateRating)addFact('aggregate_rating','Aggregate rating',aggregateRating,aggregateRating);
 const aggregateReviewCount=text(root.querySelector('#acrCustomerReviewText'));
 if(aggregateReviewCount)addFact('aggregate_review_count','Aggregate review count',aggregateReviewCount,aggregateReviewCount);
 const rowSelectors='#productDetails_feature_div table tr, #prodDetails table tr, #detailBullets_feature_div li';
 for(const row of root.querySelectorAll(rowSelectors)){
  if(!visible(row))continue;
  const cells=[...row.children].filter(cell=>cell.tagName==='TH'||cell.tagName==='TD');
  if(cells.length!==2)continue;
  const label=clean(cells[0].innerText),value=clean(cells[1].innerText),sourceText=clean(row.innerText);
  if(!label||!value||!sourceText)continue;
  if(label==='Best Sellers Rank')addFact('best_sellers_rank',label,value,sourceText);
  else if(/^(?:Material|Material Type|Included Components)$/.test(label))addFact('composition',label,value,sourceText);
  else if(/^(?:Number of Pieces|Item Package Quantity|Package Quantity|Unit Count|Number of Items)$/.test(label))addFact('quantity',label,value,sourceText);
 }
 return {basis:'listing_claims_and_review_excerpts',title,claims,reviews,...(productDetails?{productDetails}: {}),...(catalogFacts.length?{catalogFacts}: {})};
}
