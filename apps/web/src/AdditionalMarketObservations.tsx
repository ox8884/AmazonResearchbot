import type {Evidence} from './api.ts';
import {EvidenceList} from './EvidenceList.tsx';
import {useLocale} from './ui.tsx';

export function AdditionalMarketObservations({items}:{readonly items:readonly Evidence[]}){
 const {t}=useLocale();
 const asins=[...new Set(items.flatMap(row=>{
  const match=/^api_catalog_(?:reviews|reported_variants):([A-Z0-9]{10})$/.exec(row.field);
  return match?.[1]?[match[1]]:[];
 }))].sort();
 const checks=[
  [t('저리뷰 판매 기회','Sales opportunity with fewer reviews'),t('리뷰 수와 매출 관측값을 비교할 수 있습니다. 자동 판정 기준은 아직 확정되지 않았습니다.','Review counts and sales observations can be compared. Automatic decision thresholds are not yet established.')],
  [t('변형 과다','Excessive variants'),t('API가 나열한 변형 수입니다. 전체 변형 수나 위험 없음의 증거가 아니며 자동 판정 기준은 미확정입니다.','The count covers variants listed by the API. It does not prove total coverage or absence of risk; the decision threshold is unresolved.')],
  [t('Amazon 자체 브랜드','Amazon-owned brand'),t('브랜드 소유 주체를 확인할 근거가 없습니다. 판매자가 Amazon이라는 이유만으로 자체 브랜드로 판정하지 않습니다.','Brand ownership evidence is missing. Amazon as the seller does not establish brand ownership.')],
  [t('실제 반품률','Observed return rate'),t('기간과 판매·반품 수가 연결된 통계가 없습니다. 낮은 별점이나 반품 비용 예상값을 반품률로 바꾸지 않습니다.','No return statistics tied to sales and a defined period are available. Ratings and modeled return costs are not return rates.')],
  [t('판매 제한','Selling restrictions'),t('이 판매자 계정이 해당 상품을 판매할 수 있는지 확인한 근거가 없습니다. 카테고리 분류만으로 허용을 확정하지 않습니다.','Eligibility evidence for this seller account and product is missing. Category classification does not establish selling permission.')],
 ];
 return <section className="detail-section stack" aria-label={t('기회·추가 위험 확인','Opportunity and additional risk checks')}>
  <h2>{t('기회·추가 위험 확인','Opportunity and additional risk checks')}</h2>
  <p className="muted">{t('미확인은 위험이 없다는 뜻이 아닙니다. 기존 니치 5개 규칙과 별도로 확인합니다.','Unknown does not mean risk-free. These checks are separate from the five niche rules.')}</p>
  <div className="evidence-list">{checks.map(([label,reason])=><div className="evidence-row market-risk-row" key={label}>
   <div className="stack"><strong>{label}</strong><p className="muted">{reason}</p></div><span className="chip chip-unknown">{t('미확인','Unknown')}</span>
  </div>)}</div>
  <details><summary>{t('상품별 리뷰·판매·변형 관측값','Product review, sales and variant observations')}</summary>
   <p className="muted">{t('Jungle Scout 상품 DB의 조회된 ASIN 기준입니다. Amazon 첫 페이지 모집단이 아닙니다. 매출은 해당 ASIN의 API 응답 추정값이며 상품군 귀속과 함께 확인해야 합니다.','These are ASINs returned by the Jungle Scout Product Database, not the Amazon first-page population. Revenue is the estimate returned for that ASIN and must be read alongside family attribution.')}</p>
   {asins.length?asins.map(asin=><div className="quiet stack" key={asin}><h3>{asin}</h3><EvidenceList items={items.filter(row=>[
    'api_catalog_reviews:'+asin,'api_catalog_reported_variants:'+asin,'api_sales_units:'+asin,'api_sales_revenue:'+asin,'api_sales_family:'+asin,
   ].includes(row.field))}/></div>):<p>{t('현재 입력·기준에 연결된 상품별 관측값이 없습니다.','No product observations are linked to the current input and criteria.')}</p>}
  </details>
 </section>;
}
