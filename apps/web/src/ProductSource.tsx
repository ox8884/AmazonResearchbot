import {useQuery} from '@tanstack/react-query';
import {productSourceViewSchema} from '../../../packages/domain/src/amazon-product-evidence.ts';
import {Loading,LoadError,useLocale} from './ui.tsx';

async function loadSource(candidateId:string){
 const response=await fetch(`/api/candidates/${encodeURIComponent(candidateId)}/product-source`,{
  credentials:'include',signal:AbortSignal.timeout(15000),
 });
 if(!response.ok)throw Error('PRODUCT_SOURCE_UNAVAILABLE');
 return productSourceViewSchema.parse(await response.json());
}
export function ProductSource({candidateId}:{candidateId:string}){
 const {t,language}=useLocale();
 const q=useQuery({queryKey:['product-source',candidateId],queryFn:()=>loadSource(candidateId),retry:false,refetchInterval:15000});
 const view=q.data;
 if(view?.state==='not_selected'&&!q.isError)return null;
 return <section className="detail-section stack" aria-labelledby="product-source-heading">
  <h2 id="product-source-heading">{t('상품 기능·리뷰 근거','Product claims & review evidence')}</h2>
  <p className="muted">{t('판매자 설명과 일부 리뷰를 보존한 자료입니다. 검증된 성능이나 차별화 합격을 뜻하지 않습니다.','These are seller claims and sampled reviews, not verified performance or a differentiation pass.')}</p>
  {q.isPending?<Loading/>:q.isError?<LoadError retry={()=>void q.refetch()}/>:view?.state==='captured'?<>
   <p><strong>{view.productEvidence.title??t('상품명 미확인','Title unknown')}</strong> · {view.asin}</p>
   <p className="muted">{t('관측 시각','Observed')}: {new Intl.DateTimeFormat(language==='ko'?'ko-KR':'en-US',{dateStyle:'medium',timeStyle:'short'}).format(new Date(view.observedAt))}</p>
   <a className="text-btn" href={view.sourcePageUrl} target="_blank" rel="noopener noreferrer">{t('Amazon 원본 상품 보기','View original Amazon product')}</a>
   {view.productEvidence.claims.length?<details><summary>{t('판매자 기능 설명 보기','View seller feature claims')}</summary>
    <ul className="stack">{view.productEvidence.claims.map((claim,index)=><li id={'product-source-claim-'+index} key={index}>{claim}</li>)}</ul>
   </details>:<p>{t('기능 설명은 수집되지 않았습니다.','No feature claims were captured.')}</p>}
   {view.productEvidence.reviews.length?<details><summary>{t(`리뷰 발췌 ${view.productEvidence.reviews.length}개 보기`,`View ${view.productEvidence.reviews.length} review excerpts`)}</summary>
    <p className="muted">{t('상품 페이지에 보인 일부 리뷰입니다. 전체 불만 빈도를 뜻하지 않으며 다른 구성의 리뷰가 포함될 수 있습니다.','These are sampled product-page reviews, not complaint frequencies. They may include other variants.')}</p>
    <div className="evidence-list">{view.productEvidence.reviews.map(review=><article id={'product-source-review-'+review.id} className="evidence-row" key={review.id}><div className="stack">
     <strong>{review.title}</strong>
     <p className="muted">{review.reviewedAsin===null?t('리뷰 상품 구성 미확인','Review variant unconfirmed'):review.reviewedAsin===view.asin?t('대표 ASIN과 동일한 구성','Same ASIN as the representative product'):t('다른 상품 구성','Different product variant')+' · '+review.reviewedAsin}</p>
     {review.variantLabel&&<p className="muted">{review.variantLabel}</p>}
     <p className="muted">{t('표시 별점','Displayed rating')}: {review.ratingText??t('미확인','Unknown')}</p>
     <p>{review.bodyExcerpt}</p>
    </div></article>)}</div>
   </details>:<p>{t('리뷰 발췌는 수집되지 않았습니다. 불만이 없다는 뜻은 아닙니다.','No review excerpts were captured. This does not mean there are no complaints.')}</p>}
  </>:<p>{view?.state==='stale'?t('입력·기준 또는 대표 상품이 바뀌어 이전 자료를 현재 근거로 사용하지 않습니다.','Inputs, criteria or the representative product changed; earlier material is not current evidence.'):
   view?.state==='legacy'?t('이전 규격 자료에는 기능·리뷰가 포함되지 않았습니다.','The earlier measurement record does not include product claims or reviews.'):
   view?.state==='collecting'?t('ASIDE에서 대표 상품의 자료를 읽고 있습니다.','ASIDE is reading the representative product.'):
   t('아직 현재 대표 상품에 연결된 자료가 없습니다.','No material is linked to the current representative product yet.')}</p>}
 </section>;
}
