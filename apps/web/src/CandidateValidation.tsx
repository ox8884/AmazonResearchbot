import {NICHE_RULE_LABELS,type CandidateValidationView} from '../../../packages/domain/src/validation-view.ts';
import type {Evidence} from '../../../packages/domain/src/evidence.ts';
import type {RuleId} from '../../../packages/domain/src/niche.ts';
import {unknownLabel} from './evidence.ts';
import {Icon,useLocale} from './ui.tsx';
function valueText(value:Evidence<string|number|boolean>,language:string):string {
  if(value.kind==='unknown')return unknownLabel(value.reason??'미확인',language);
  const displayed=typeof value.value==='boolean'?(value.value?(language==='ko'?'예':'Yes'):(language==='ko'?'아니요':'No')):String(value.value);
  const kind=value.kind==='measured'?(language==='ko'?'측정':'Measured'):value.kind==='estimate'?(language==='ko'?'추정':'Estimate'):(language==='ko'?'견적':'Quote');
  return `${displayed} · ${kind}`;
}
export function CandidateValidation({view}:{view:CandidateValidationView|undefined}){
  const {t,language}=useLocale();
  if(!view||view.status==='unconfirmed')return <p className="muted">{t('아직 기록된 평가가 없습니다. 필요한 근거를 확인하는 단계입니다.','No assessment is recorded yet. The required evidence is still being checked.')}</p>;
  const values:Partial<Record<RuleId,readonly [string,Evidence<string|number|boolean>][]>>=view.input?{
    review_barrier:[[t('리뷰 700+ 상품','Products with 700+ reviews'),view.input.review700Count],[t('리뷰 2,000+ 상품','Products with 2,000+ reviews'),view.input.review2000Count]],
    top_price:[['USD',view.input.topPriceUsd]],
    monthly_revenue_competitors:[[t('조건 충족 상품 수','Qualifying products'),view.input.monthlyRevenueCompetitorCount]],
    standard_size:[['',view.input.standardSize]],differentiation:[['',view.input.differentiation]],
  }:{};
  const status=view.status==='pass'?t('기준 충족','Criteria met'):view.status==='reject'?t('탈락 기준 확인','Rejection criteria met'):view.status==='stale'?t('이전 평가','Outdated assessment'):t('확인 보류','Needs evidence');
  return <div className="stack">
    <div className="section-label"><h3>{view.phase==='api_validation'?t('공식 자료 확인','Official data assessment'):t('1차 선별','Initial screening')}</h3><span className={`chip chip-${view.status==='pass'?'ok':view.status==='reject'?'danger':'unknown'}`}><Icon name={view.status==='pass'?'check':view.status==='reject'?'warning':'unknown'}/>{status}</span></div>
    <p className="muted">{t('적용 기준','Criteria')} v{view.settingsVersion}{view.evaluatedAt&&` · ${new Intl.DateTimeFormat(language==='ko'?'ko-KR':'en-US',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(view.evaluatedAt))}`} · {t('서울 기준','Seoul time')}</p>
    {view.status==='stale'&&<p className="banner">{t('입력이나 기준이 바뀌었습니다. 이 결과를 현재 판단에 사용하지 않습니다.','Inputs or criteria changed. This result is not used for the current decision.')}</p>}
    {view.evidenceBlock&&<p className="banner">{view.evidenceBlock==='CATEGORY_MEMBERSHIP_UNCONFIRMED'?t('Kitchen & Dining 분류가 아직 확인되지 않았습니다. 분류 확인 전에는 공급처 찾기로 진행하지 않습니다.','Kitchen & Dining membership is not confirmed. Supplier sourcing waits for category verification.'):t('수집 범위나 필수 근거가 충분하지 않습니다. 확인되지 않은 항목은 통과로 세지 않습니다.','The collection scope or required evidence is incomplete. Unconfirmed items do not count as passes.')}</p>}
    <div className="evidence-list">{view.rules.map(rule=><div className="evidence-row" key={rule.id}>
      <div className="stack"><strong>{NICHE_RULE_LABELS[rule.id][language==='ko'?0:1]}</strong>{values[rule.id]?.map(([label,value])=><p className="muted source-text" key={label}>{label&&`${label}: `}{valueText(value,language)}</p>)}</div>
      <span className={`chip chip-${rule.status==='pass'?'ok':rule.status==='fail'?'warn':'unknown'}`}><Icon name={rule.status==='pass'?'check':rule.status==='fail'?'warning':'unknown'}/>{rule.status==='pass'?t('충족','Met'):rule.status==='fail'?t('미충족','Not met'):t('미확인','Unknown')}</span>
    </div>)}</div>
    {view.sourceCount!==null&&<p className="muted">{view.phase==='api_validation'?t('공식 수집 자료','Official source captures'):t('기초 자료','Screening sources')}: {view.sourceCount}</p>}
    {view.phase==='api_validation'&&<p className="muted">{view.marketRisk?t('상품 DB와 기록한 근거를 함께 평가합니다. 첫 페이지 범위와 추가 조건은 아래 시장 확인에서 볼 수 있습니다.','This combines Product Database results with recorded evidence. First-page coverage and additional conditions are shown in the market checks below.'):t('상품 DB와 기록한 근거를 함께 평가합니다. Amazon 첫 페이지·매출 점유율은 별도 확인이 필요합니다.','This combines Product Database results with recorded evidence. Amazon first-page sales and revenue share require separate checks.')}</p>}
  </div>;
}
