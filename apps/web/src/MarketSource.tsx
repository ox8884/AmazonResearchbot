import {useQuery} from '@tanstack/react-query';
import type {Evidence} from '../../../packages/domain/src/evidence.ts';
import {Loading,LoadError,useLocale} from './ui.tsx';

type MarketView={state:'not_collected'|'stale'|'waiting'|'collecting'}|{
 state:'captured';query:string;observedAt:string;sourcePageUrl:string;coverage:'complete'|'partial';rangeText:string;
 slots:readonly {position:number;asin:string|null;title:string|null;productUrl:string|null;adStatus:'sponsored'|'not_marked'|'unknown';priceTexts:readonly string[];price:Evidence<string>}[];
};
async function loadMarket(id:string):Promise<MarketView>{
 const response=await fetch(`/api/candidates/${encodeURIComponent(id)}/market-source`,{credentials:'include'});
 if(!response.ok)throw Error('MARKET_SOURCE_UNAVAILABLE');return response.json();
}
export function MarketSource({candidateId}:{candidateId:string}){
 const {t,language}=useLocale();
 const query=useQuery({queryKey:['market-source',candidateId],queryFn:()=>loadMarket(candidateId),retry:false,refetchInterval:5000});
 const view=query.data;
 return <section className="detail-section stack">
  <h2>{t('Amazon 첫 페이지 관측','Amazon first-page observations')}</h2>
  <p className="muted">{t('시장 1위 판단에는 동일 상품 검토와 같은 기간의 매출 근거가 더 필요합니다. 여기의 표시 순서와 가격은 관측 자료로 보존합니다.','A market leader requires comparable products and revenue for the same period. Display order and prices here are observations.')}</p>
  {query.isPending?<Loading/>:query.isError?<LoadError retry={()=>void query.refetch()}/>:view?.state==='captured'?<>
   <p>{view.rangeText}</p>
   <p className="muted">{t('관측 시각','Observed')}: {new Intl.DateTimeFormat(language==='ko'?'ko-KR':'en-US',{dateStyle:'medium',timeStyle:'short'}).format(new Date(view.observedAt))}</p>
   <p>{view.coverage==='complete'?t('화면의 표시 범위를 수집했습니다. 동일 상품 여부와 매출 대조는 아직 별도입니다.','The displayed result range was collected. Product comparability and revenue matching are separate checks.'):t('일부 항목의 식별 또는 광고 표시가 미확인입니다. 전체 모집단으로 판단하지 않습니다.','Some identities or advertising labels are unconfirmed. This is not treated as a complete population.')}</p>
   <details><summary>{t(`관측 항목 ${view.slots.length}개 보기`,`View ${view.slots.length} observed slots`)}</summary>
    <div className="evidence-list">{view.slots.map(row=><div className="evidence-row" key={row.position}>
     <div className="stack">
      <strong>{row.title??t('상품명 미확인','Title unknown')}</strong>
      <p className="muted">{t('표시 위치','Display slot')} {row.position} · {row.asin??t('ASIN 미확인','ASIN unknown')} · {row.adStatus==='sponsored'?t('광고 표시','Sponsored'):row.adStatus==='not_marked'?t('광고 표시 없음','Not marked as sponsored'):t('광고 여부 미확인','Advertising status unknown')}</p>
      <p>{t('표시 가격','Displayed price')}: {row.price.kind==='unknown'?t('미확인','Unknown'):'$'+row.price.value}</p>
      {row.price.kind==='unknown'&&row.priceTexts.length>0&&<p className="muted">{t('관측된 가격 후보','Observed price candidates')}: {row.priceTexts.join(' / ')}</p>}
      {row.productUrl&&<a className="text-btn" href={row.productUrl} target="_blank" rel="noopener noreferrer">{t('Amazon 원본 상품 보기','View original Amazon product')}</a>}
     </div>
    </div>)}</div>
   </details>
  </>:<p>{view?.state==='collecting'?t('ASIDE에서 첫 페이지를 확인하고 있습니다.','ASIDE is checking the first results page.'):view?.state==='stale'?t('입력이나 기준이 바뀌어 이전 관측은 현재 판단에 사용하지 않습니다.','Inputs or criteria changed; the earlier observation is not used for the current decision.'):t('아직 현재 입력에 연결된 관측이 없습니다. 읽기 가능한 ASIDE와 웹 화면을 기다립니다.','No observation is linked to the current input yet. Waiting for a supported ASIDE connection and accessible page.')}</p>}
 </section>;
}
