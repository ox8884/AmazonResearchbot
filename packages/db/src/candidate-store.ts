import {NICHE_RULE_LABELS,nextAction,readNicheEvidence,stageLabel,type BlockedReason,type CandidateValidationView,type CandidateView,type NicheInput,type Stage,type StoredEvidence} from '@forge-ops/domain';
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
    return {candidate:{id:row.id,keyword:row.keyword_display,stage:row.stage,stageLabel:stageLabel(row.stage,locale),blockedReason:row.blocked_reason,
      evidenceSummary:summary(input,validation,locale),unknowns:[...new Set(unknowns)],nextAction:nextAction({stage:row.stage,blockedReason:row.blocked_reason,locale})},evidence:rows,validation};
  });
}
export async function loadCandidates(db:Db,locale:'ko'|'en'):Promise<CandidateView[]>{return (await loadCandidateDetails(db,locale,null)).map(row=>row.candidate);}
export async function readCandidateDetails(db:Db,id:string,locale:'ko'|'en'):Promise<CandidateDetails|undefined>{return (await loadCandidateDetails(db,locale,id))[0];}
