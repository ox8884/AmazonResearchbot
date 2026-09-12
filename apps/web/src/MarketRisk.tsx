import type {CandidateValidationView} from '../../../packages/domain/src/validation-view.ts';
import type {Evidence} from '../../../packages/domain/src/evidence.ts';
import {Icon,useLocale} from './ui.tsx';

export function MarketRisk({view}:{view:CandidateValidationView|undefined}){
 const {t,language}=useLocale(),risk=view?.marketRisk;
 const number=new Intl.NumberFormat(language==='ko'?'ko-KR':'en-US',{maximumFractionDigits:2});
 const kinds={measured:t('측정','Measured'),estimate:t('추정','Estimate'),quote:t('견적','Quote')};
 const value=(evidence:Evidence<string>,unit:string)=>evidence.kind==='unknown'?t('미확인','Unknown'):`${number.format(Number(evidence.value))}${unit} · ${kinds[evidence.kind]}`;
 if(!risk)return <section className="detail-section"><h2>{t('추가 시장 확인','Additional market checks')}</h2><p className="muted">{t('첫 페이지의 비교 범위와 같은 기간의 매출 자료가 아직 확인되지 않았습니다.','First-page comparison coverage and sales for a common period are not yet confirmed.')}</p></section>;
 const old=view?.status==='stale';
 const {concentration:c,criteria}=risk;
 const rows=[
  {label:t('1위 상품군 점유율','Leading family revenue share'),value:c.top1Pct,unit:'%',status:c.assessment.top1,criterion:t(`${criteria.shareTop1MustBeBelowPct}% 미만`,`Below ${criteria.shareTop1MustBeBelowPct}%`)},
  {label:t('상위 3개 상품군 점유율',"Top three families' revenue share"),value:c.top3Pct,unit:'%',status:c.assessment.top3,criterion:t(`${criteria.shareTop3MustBeBelowPct}% 미만`,`Below ${criteria.shareTop3MustBeBelowPct}%`)},
  {label:t('첫 페이지 총매출','First-page total revenue'),value:c.firstPageSalesUsd,unit:' USD',status:c.assessment.firstPageSales,criterion:t(`${number.format(Number(criteria.firstPageSalesMinUsd))} USD 이상`,`At least ${number.format(Number(criteria.firstPageSalesMinUsd))} USD`)},
 ];
 return <section className="detail-section" aria-label={t('추가 시장 확인','Additional market checks')}>
  <h2>{t('추가 시장 확인','Additional market checks')}</h2>
  <p className="muted">{t('Amazon 첫 페이지 · 부모 상품군 중복 제외','Amazon first page · parent families counted once')} · {risk.asinCount} ASIN{c.families.kind!=='unknown'&&` · ${c.families.value} ${t('상품군','families')}`}</p>
  <p className="muted">{risk.period.startDate} ~ {risk.period.endDate} · UTC · {t('적용 기준','Criteria')} v{view?.settingsVersion}</p>
  {old&&<p className="banner">{t('이전 자료입니다. 현재 판단에는 새 평가가 필요합니다.','These are previous results. A new assessment is required for the current decision.')}</p>}
  <div className="evidence-list">{rows.map(row=>{
   const status=old||row.value.kind==='unknown'?'unknown':row.status;
   return <div className="evidence-row market-risk-row" key={row.label}>
    <div className="stack"><strong>{row.label}</strong><p className="muted">{value(row.value,row.unit)}</p><p className="muted">{t('기준','Criterion')}: {row.criterion}</p></div>
    <span className={`chip chip-${status==='pass'?'ok':status==='fail'?'warn':'unknown'}`}><Icon name={status==='pass'?'check':status==='fail'?'warning':'unknown'}/>{old?t('이전 값','Previous'):status==='pass'?t('충족','Met'):status==='fail'?t('주의','Caution'):t('미확인','Unknown')}</span>
   </div>;
  })}</div>
  <p className="muted">{t('표시값은 반올림하며 판정에는 반올림 전 수치를 사용합니다. 이 세 조건은 니치 선별과 별도로 확인합니다.','Displayed values are rounded; checks use unrounded values. These three checks are assessed separately from niche screening.')}</p>
 </section>;
}
