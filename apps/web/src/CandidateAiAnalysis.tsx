import { useQuery } from "@tanstack/react-query";
import {NavLink} from 'react-router';
import type { AiBusinessInput,AiBusinessOutput } from "../../../packages/domain/src/ai-business.ts";
import { aiRoleLabels } from "./AiRoutingFields.tsx";
import { fieldLabel } from "./evidence.ts";
import { LoadError,Loading,useLocale } from "./ui.tsx";
type Analysis={id:string;role:AiBusinessInput['role'];state:string;executionState:string;input:AiBusinessInput;result:AiBusinessOutput|null;updatedAt:string};
async function loadAnalysis(id:string):Promise<Analysis[]>{const response=await fetch(`/api/candidates/${id}/ai-analysis`,{credentials:'include',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('AI_ANALYSIS_UNAVAILABLE');const body:{tasks:Analysis[]}=await response.json();return body.tasks;}
export function CandidateAiAnalysis({candidateId}:{candidateId:string}){
 const {t,language}=useLocale();
 const referenceLabel=(input:AiBusinessInput,ref:string)=>{
  if(ref==='subject')return t('제품 키워드','Product keyword');
  if(ref==='spec')return t('저장된 제품 사양','Saved product specification');
  const fragment=input.productSource?.fragments.find(row=>row.ref===ref);
  if(fragment)return fragment.kind==='claim'?t('대표 상품 기능 설명','Representative product feature'):t('대표 상품과 동일한 ASIN의 리뷰','Review for the representative ASIN');
  const source=input.evidence.find(row=>row.ref===ref);
  return source?`${fieldLabel(source.field,language)} · ${source.value??t('미확인','Unknown')} · ${{measured:t('측정','Measured'),estimate:t('추정','Estimated'),quote:t('견적','Quoted'),unknown:t('미확인','Unknown')}[source.kind]}`:t('참조 미확인','Reference unknown');
 };
 const referenceLink=(input:AiBusinessInput,ref:string)=>{
  const fragment=input.productSource?.fragments.find(row=>row.ref===ref);
  if(!fragment)return <span key={ref}>{referenceLabel(input,ref)}</span>;
  const ordinal=(input.productSource?.fragments.filter(row=>row.kind===fragment.kind).findIndex(row=>row.ref===ref)??0)+1;
  const target='product-source-'+ref.replace(':','-');
  return <a key={ref} className="text-btn" href={'#'+target} onClick={()=>{
   const element=document.getElementById(target),details=element?.closest('details');
   if(details)details.open=true;
  }}>{referenceLabel(input,ref)} {ordinal}</a>;
 };
 const query=useQuery({queryKey:['candidate-ai',candidateId],queryFn:()=>loadAnalysis(candidateId)});
 return <section className="detail-section stack">
  <h2>{t('AI 작업 메모','AI working notes')}</h2>
  <p className="muted">{t('현재 입력·기준에 대한 AI 제안입니다. 확인된 사실이나 통과 판정을 대신하지 않습니다.','Suggestions for the current input and criteria. They do not replace verified evidence or pass decisions.')}</p>
  {query.isPending?<Loading/>:query.isError?<LoadError retry={()=>void query.refetch()}/>:query.data.length===0?<p className="muted">{t('아직 AI 작업 메모가 없습니다. 승인된 제공자와 실행 연결이 준비되면 자동 작업에서 생성합니다.','No AI notes yet. Scheduled work creates them when an approved provider and execution connection are available.')}</p>:query.data.map(task=><article className="quiet stack" key={task.id}>
    <h3>{aiRoleLabels[task.role][language==='ko'?0:1]} <span className="chip chip-warn">{t('AI 제안','AI suggestion')}</span></h3>
    {task.result?<>
      <p>{task.result.summary}</p>
      <ul>{task.result.suggestions.map((item,index)=><li key={index}><p>{item.text}</p><p className="muted">{t('참조한 입력','Referenced input')}: {item.sourceRefs.map(ref=>referenceLabel(task.input,ref)).join(' / ')}</p></li>)}</ul>
      {(task.result.role==='niche_analysis'||task.result.role==='sourcing_analysis')&&task.result.differentiationProposal&&task.result.targetSpecification&&<div className="stack">
       <h4>{t('차별화 변경 제안','Proposed differentiation')}</h4>
       <p className="banner">{t('근거를 바탕으로 제안한 비교 사양입니다. 제조 가능성·실물 성능·차별화 통과는 미확인입니다.','A proposed comparison target based on source material. Manufacturability, performance and differentiation qualification remain unverified.')}</p>
       <dl className="settings-values">
        <div><dt>{t('고객 불만 해석','Interpretation of the customer complaint')}</dt><dd>{task.result.differentiationProposal.customerProblem}</dd></div>
        <div><dt>{t('변경할 항목','Proposed change')}</dt><dd>{{material:t('재질','Material'),dimensions:t('치수','Dimensions'),packaging:t('포장','Packaging'),requirements:t('요구 사항','Requirements')}[task.result.differentiationProposal.change.field]} · {task.result.differentiationProposal.change.proposedValue}</dd></div>
        <div><dt>{t('재질 목표','Material target')}</dt><dd>{task.result.targetSpecification.material}</dd></div>
        <div><dt>{t('치수 목표','Dimensions target')}</dt><dd>{task.result.targetSpecification.dimensions}</dd></div>
        <div><dt>{t('포장 목표','Packaging target')}</dt><dd>{task.result.targetSpecification.packaging}</dd></div>
        <div><dt>{t('견적 요청 수량','Quantity for quotation')}</dt><dd>{task.result.targetSpecification.requestedQuantity}</dd></div>
       </dl>
       <p className="muted">{t('제안 이유','Proposal rationale')}: {task.result.targetSpecification.rationale}</p>
       <div className="stack"><strong>{t('변경의 기능 근거','Feature evidence for the change')}</strong>{task.result.differentiationProposal.featureRefs.map(ref=>referenceLink(task.input,ref))}</div>
       <div className="stack"><strong>{t('고객 불만의 리뷰 근거','Review evidence for the customer problem')}</strong>{task.result.differentiationProposal.reviewRefs.map(ref=>referenceLink(task.input,ref))}</div>
       <div className="stack"><strong>{t('목표 사양이 참조한 근거','Evidence used by the target specification')}</strong>{task.result.targetSpecification.sourceRefs.map(ref=>referenceLink(task.input,ref))}</div>
       <NavLink className="text-btn" to={`/sourcing?candidate=${encodeURIComponent(candidateId)}`}>{t('소싱 사양·견적 연결 확인','Review sourcing specification and quotes')}</NavLink>
      </div>}
      {task.result.role==='normalize'&&<p>{t('정리한 키워드 제안','Suggested normalized keyword')}: {task.result.normalizedKeyword}</p>}
      {task.result.role==='sourcing_analysis'&&<p>{t('공급처 검색어 제안','Suggested supplier searches')}: {task.result.searchQueries.join(' · ')}</p>}
      {task.result.role==='rfq_draft'&&<><h4>{t('검토용 견적 요청 문안 · 미전송','RFQ wording for review · not sent')}</h4><div className="source-text">{task.result.draftText}</div></>}
    </>:<p className="muted">{task.executionState==='outcome_unknown'?t('실행 결과 미확인입니다. 같은 요청을 다시 보내지 않습니다.','Execution outcome unknown. The same request is not repeated.'):task.executionState==='budget_blocked'?t('AI 실행 예산을 기다립니다.','Waiting for AI budget.'):t('승인된 제공자 또는 유효한 응답을 기다립니다.','Waiting for an approved provider or valid response.')}</p>}
  </article>)}
 </section>;
}
