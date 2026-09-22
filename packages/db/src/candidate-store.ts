import {candidateDecision,NICHE_RULE_LABELS,nextAction,readNicheEvidence,stageLabel,type BlockedReason,type CandidateDecisionBasis,type CandidateValidationView,type CandidateView,type EvidencePlanItem,type NicheInput,type Stage,type StoredEvidence} from '@forge-ops/domain';
import type {Pool} from './client.ts';
import {validationView,marketRiskMatchesSettings,type ValidationRow,type SettingsSnapshot} from '@forge-ops/domain';
type Db=Pick<Pool,'query'>;
type Row={id:string;keyword_display:string;stage:Stage;blocked_reason:BlockedReason;input_version:number};
type EvidenceRow=StoredEvidence&{candidate_id:string};
export type CandidateDetails={candidate:CandidateView;evidence:readonly StoredEvidence[];validation:CandidateValidationView};
function missing(input:NicheInput,locale:'ko'|'en'):string[]{
  const checks=[
    ['review_barrier',input.review700Count.kind==='unknown'||input.review2000Count.kind==='unknown'],
    ['top_price',input.topPriceUsd.kind==='unknown'],
    ['monthly_revenue_competitors',input.monthlyRevenueCompetitorCount.kind==='unknown'],
    ['standard_size',input.standardSize.kind==='unknown'],
    ['differentiation',input.differentiation.kind==='unknown'],
  ] as const;
  return checks.filter(([,unknown])=>unknown).map(([id])=>NICHE_RULE_LABELS[id][locale==='ko'?0:1]);
}
function catalogEvidenceSummary(rows:readonly StoredEvidence[],locale:'ko'|'en'):string{
 const ko=locale==='ko';
 const productIds=new Set<string>();
 const numbers=(prefix:string)=>rows.flatMap(row=>{
   if(!row.field.startsWith(prefix)||row.kind==='unknown'||row.value_numeric===null)return [];
   const value=Number(row.value_numeric);return Number.isFinite(value)?[value]:[];
 });
 for(const row of rows){const match=/^api_catalog_[^:]+:(.+)$/.exec(row.field);if(match?.[1])productIds.add(match[1]);}
 const prices=numbers('api_catalog_price:'),reviews=numbers('api_catalog_reviews:'),revenues=numbers('api_catalog_revenue_30d:'),ranks=numbers('api_catalog_rank:'),fees=numbers('api_catalog_fba_fee:');
 const categories=[...new Set(rows.filter(row=>row.field.startsWith('api_catalog_category:')&&row.kind!=='unknown'&&row.value_text).map(row=>row.value_text as string))];
 const number=(value:number)=>value.toLocaleString('en-US',{maximumFractionDigits:2});
 const usd=(value:number)=>`$${value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
 const facts:string[]=[];
 if(productIds.size)facts.push(`${productIds.size}${ko?'개 상품':' products'}`);
 if(prices.length)facts.push(`${ko?'가격':'price'} ${usd(Math.min(...prices))}–${usd(Math.max(...prices))}`);
 if(reviews.length)facts.push(`${ko?'리뷰 최대':'max reviews'} ${number(Math.max(...reviews))}`);
 if(revenues.length)facts.push(`${ko?'30일 매출 추정 최대':'max estimated 30-day revenue'} ${usd(Math.max(...revenues))}`);
 if(ranks.length)facts.push(`${ko?'BSR 최상위':'best BSR'} ${number(Math.min(...ranks))}`);
 if(fees.length)facts.push(`${ko?'FBA 수수료':'FBA fee'} ${usd(Math.min(...fees))}–${usd(Math.max(...fees))}`);
 if(categories.length)facts.push(`${ko?'카테고리':'categories'} ${categories.slice(0,3).join(', ')}${categories.length>3?' …':''}`);
 return facts.length?`${ko?'공식 카탈로그':'Official catalog'}: ${facts.join(' · ')}`:'';
}
function summary(input:NicheInput,validation:CandidateValidationView,locale:'ko'|'en'):string{
  const ko=locale==='ko';
  if(validation.status==='stale')return ko?'이전 평가입니다. 현재 기준으로 다시 확인해야 합니다.':'Previous assessment; the current criteria need review.';
  if(validation.status!=='unconfirmed'){
    const phase=validation.phase==='api_validation'?(ko?'공식 자료':'Official data'):(ko?'기초 자료 선별':'Initial screening');
    const result=validation.status==='pass'?(ko?'기준 충족':'Criteria met'):validation.status==='reject'?(ko?'탈락 기준 확인':'Rejection criteria met'):(ko?'근거 추가 확인':'More evidence needed');
    return `${phase} · ${result}`;
  }
  const facts=[
    [ko?'1위 가격':'Top product price',input.topPriceUsd],
    [ko?'리뷰 2,000개 이상 상품 수':'Products with 2,000+ reviews',input.review2000Count],
    [ko?'매출 조건 상품 수':'Products meeting revenue criteria',input.monthlyRevenueCompetitorCount],
  ] as const;
  const known=facts.flatMap(([label,evidence])=>evidence.kind==='unknown'?[]:[`${label}: ${evidence.value}`]);
  return known.join(' · ')||(ko?'시장 근거 확인 전':'Market evidence has not been confirmed');
}
function evidencePlan(input:NicheInput,validation:CandidateValidationView,rows:readonly StoredEvidence[],locale:'ko'|'en'):readonly EvidencePlanItem[]{
  const ko=locale==='ko';
  const items:EvidencePlanItem[]=[];
  const add=(item:EvidencePlanItem)=>{if(!items.some(existing=>existing.id===item.id))items.push(item);};
  if(input.review700Count.kind==='unknown'||input.review2000Count.kind==='unknown')add({id:'review_barrier',label:ko?'리뷰 장벽':'Review barrier',source:'jungle_scout_api',sourceLabel:ko?'Jungle Scout API':'Jungle Scout API',action:ko?'API의 리뷰 700·2,000 기준을 먼저 조회하고, API 값이 없으면 대시보드 Product Database로 보완합니다.':'Query the 700/2,000-review thresholds by API first; use Product Database on the dashboard when the API value is missing.'});
  if(input.topPriceUsd.kind==='unknown'||input.monthlyRevenueCompetitorCount.kind==='unknown')add({id:'market_numbers',label:ko?'1위 가격·매출 조건':'Leader price and revenue threshold',source:'jungle_scout_api',sourceLabel:ko?'Jungle Scout API → 대시보드 fallback':'Jungle Scout API → dashboard fallback',action:ko?'상품 DB·매출 추정 API를 먼저 사용하고, 기간·family가 불완전하면 대시보드 Product Database/Competitive Intelligence를 다시 읽습니다.':'Use Product Database and sales-estimate APIs first; fall back to Product Database/Competitive Intelligence when period or family data is incomplete.'});
  if(input.standardSize.kind==='unknown')add({id:'standard_size',label:ko?'규격 확인':'Package size',source:'amazon_product_page',sourceLabel:ko?'Amazon 상품 페이지':'Amazon product page',action:ko?'대표 ASIN의 포장 치수·중량을 자동 확인합니다. Seller Central은 계정별 판매 가능 여부·FBA 수수료를 별도 수동 확인하는 보조 경로입니다.':'Read packaged dimensions and weight for the representative ASIN. Seller Central is a separate manual check for account eligibility and FBA fees.'});
  if(input.differentiation.kind==='unknown')add({id:'differentiation',label:ko?'차별화 근거':'Differentiation evidence',source:'jungle_scout_dashboard',sourceLabel:ko?'Jungle Scout 대시보드':'Jungle Scout dashboard',action:ko?'Competitive Intelligence와 Amazon 첫 페이지를 함께 확인합니다. 판매자 문구만으로 차별화를 통과시키지 않습니다.':'Use Competitive Intelligence together with the Amazon first page; seller copy alone cannot pass differentiation.'});
  const market=validation.marketRisk?.concentration;
  if(!market||[market.top1Pct,market.top3Pct,market.firstPageSalesUsd].some(value=>value.kind==='unknown'))add({id:'market_risk',label:ko?'첫 페이지·매출 점유율':'First-page sales and share',source:'amazon_first_page',sourceLabel:ko?'Amazon 첫 페이지 + Jungle Scout':'Amazon first page + Jungle Scout',action:ko?'Amazon 첫 페이지를 수집해 30일 매출·상위 1/3개 점유율을 계산하고, 누락된 경쟁 지표는 대시보드로 보완합니다.':'Collect the Amazon first page to calculate 30-day sales and top-1/top-3 share; fill missing competitor signals from the dashboard.'});
  if(validation.phase!=='api_validation'||validation.status==='unconfirmed')add({id:'official_validation',label:ko?'공식 확인 전':'Official validation pending',source:'jungle_scout_api',sourceLabel:ko?'Jungle Scout API':'Jungle Scout API',action:ko?'현재 승인 기준으로 공식 API 검증을 실행합니다.':'Run official API validation against the approved criteria.'});
  if(validation.evidenceBlock||rows.some(row=>row.field.startsWith('api_')&&row.kind==='unknown'))add({id:'api_unknown',label:ko?'추가 공식 자료':'Additional official data',source:'jungle_scout_dashboard',sourceLabel:ko?'Jungle Scout 대시보드 fallback':'Jungle Scout dashboard fallback',action:ko?'API가 반환하지 않은 값만 대시보드의 실제 화면에서 다시 확인하고, 확인 불가 값은 계속 unknown으로 남깁니다.':'Re-read only API-missing values from the live dashboard; values that cannot be confirmed remain unknown.'});
  return items;
}
export async function loadCandidateDetails(db:Db,locale:'ko'|'en',id:string|null=null):Promise<CandidateDetails[]>{
  const candidates=await db.query<Row>('SELECT id,keyword_display,stage,blocked_reason,input_version FROM candidates WHERE ($1::uuid IS NULL OR id=$1) ORDER BY created_at',[id]);
  const evidence=await db.query<EvidenceRow>(`SELECT DISTINCT ON(e.candidate_id,e.field) e.candidate_id,e.field,e.kind,e.value_numeric::text,e.value_text,e.reason,e.source_id,e.observed_at
      FROM evidence e JOIN candidates c ON c.id=e.candidate_id WHERE ($1::uuid IS NULL OR e.candidate_id=$1)
      AND (e.input_version IS NULL OR (e.input_version=c.input_version AND e.settings_version=(SELECT max(version) FROM settings_versions)))
      ORDER BY e.candidate_id,e.field,e.created_at DESC,e.id DESC`,[id]);
  const evaluations=await db.query<ValidationRow>(`SELECT DISTINCT ON(candidate_id) candidate_id,settings_version,kind,outcome,payload,stale,created_at
      FROM evaluations WHERE kind IN ('niche','api_validation') AND ($1::uuid IS NULL OR candidate_id=$1) ORDER BY candidate_id,created_at DESC,id DESC`,[id]);
  const settings=await db.query<{version:number;snapshot:SettingsSnapshot}>('SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1');
  const evidenceByCandidate=new Map<string,StoredEvidence[]>();
  for(const row of evidence.rows){const rows=evidenceByCandidate.get(row.candidate_id)??[];rows.push(row);evidenceByCandidate.set(row.candidate_id,rows);}
  const evaluationByCandidate=new Map(evaluations.rows.map(row=>[row.candidate_id,row]));
  return candidates.rows.map(row=>{
    const rows=evidenceByCandidate.get(row.id)??[];
    const input=readNicheEvidence(rows);
    let validation=validationView(evaluationByCandidate.get(row.id),row.input_version,settings.rows[0]?.version??null);
    const activeSettings=settings.rows[0];
    if(validation.status!=='stale'&&validation.marketRisk&&activeSettings&&!marketRiskMatchesSettings(validation.marketRisk,activeSettings.snapshot))validation={...validation,marketRisk:null};
    const current=validation.status!=='stale'&&validation.status!=='unconfirmed';
    const unknowns=current
      ? validation.rules.filter(rule=>rule.status==='unknown').map(rule=>NICHE_RULE_LABELS[rule.id][locale==='ko'?0:1])
      : missing(input,locale);
    if(validation.phase!=='api_validation'||!current)unknowns.push(locale==='ko'?'공식 확인 전':'Official validation pending');
    if(validation.evidenceBlock)unknowns.push(locale==='ko'?'공식 자료 추가 확인 필요':'Additional official evidence needed');
    if(rows.some(e=>e.field.startsWith('api_')&&e.kind==='unknown'))unknowns.push(locale==='ko'?'추가 공식 자료에 미확인 값이 있어요':'Additional official data contains unknown values');
    const market=validation.marketRisk?.concentration;
    if(!current||!market||[market.top1Pct,market.top3Pct,market.firstPageSalesUsd].some(value=>value.kind==='unknown'))
      unknowns.push(locale==='ko'?'첫 페이지·매출 점유율 미확인':'First-page sales and revenue share unconfirmed');
    const evidenceSummary=[summary(input,validation,locale),catalogEvidenceSummary(rows,locale)].filter(Boolean).join(' · ');
    const projectedDecision=candidateDecision({phase:validation.phase,status:validation.status,marketRisk:validation.marketRisk,settings:activeSettings?.snapshot});
    const provisionalNoGo=projectedDecision==='waiting'&&(row.blocked_reason==='evidence'||validation.status==='hold');
    const decisionBasis:CandidateDecisionBasis=provisionalNoGo?'insufficient_evidence':projectedDecision==='go'?'confirmed_go':projectedDecision==='caution'?'market_caution':projectedDecision==='no_go'?'confirmed_rejection':'waiting';
    return {candidate:{id:row.id,keyword:row.keyword_display,stage:row.stage,stageLabel:stageLabel(row.stage,locale),blockedReason:row.blocked_reason,
      evidenceSummary,unknowns:[...new Set(unknowns)],nextAction:nextAction({stage:row.stage,blockedReason:row.blocked_reason,locale}),
      decision:provisionalNoGo?'no_go':projectedDecision,decisionBasis,evidencePlan:evidencePlan(input,validation,rows,locale)},evidence:rows,validation};
  });
}
export async function loadCandidates(db:Db,locale:'ko'|'en'):Promise<CandidateView[]>{return (await loadCandidateDetails(db,locale,null)).map(row=>row.candidate);}
export async function readCandidateDetails(db:Db,id:string,locale:'ko'|'en'):Promise<CandidateDetails|undefined>{return (await loadCandidateDetails(db,locale,id))[0];}
