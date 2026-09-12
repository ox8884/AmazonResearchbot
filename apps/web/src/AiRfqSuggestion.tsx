import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRfqAiSuggestion,type RfqAiSuggestion } from "./contact-api.ts";
import { useLocale } from "./ui.tsx";
export function AiRfqSuggestion({candidateId,specId,quantity,autoApply,disabled,onApply}:{candidateId:string;specId:string;quantity:number;autoApply:boolean;disabled:boolean;onApply:(source:RfqAiSuggestion)=>void}){
 const {t}=useLocale();
 const valid=Boolean(specId)&&Number.isInteger(quantity)&&quantity>0&&quantity<=10000000;
 const query=useQuery({queryKey:['rfq-ai',candidateId,specId,quantity],queryFn:()=>getRfqAiSuggestion(candidateId,specId,quantity),enabled:valid});
 const suggestion=query.data?.suggestion;
 useEffect(()=>{if(autoApply&&!disabled&&!query.isFetching&&!query.isError&&suggestion)onApply(suggestion);},[autoApply,disabled,query.isFetching,query.isError,suggestion,onApply]);
 if(!valid)return null;
 if(query.isError)return <p className="muted">{t('AI 문안을 불러오지 못했습니다. 기본 문안으로 작성할 수 있습니다.','AI wording is unavailable. You can continue with the standard template.')}</p>;
 if(!suggestion)return null;
 return <details className="official-evidence contact-form-wide">
  <summary>{t('현재 사양의 AI 문안 미리보기','Preview AI wording for this specification')}</summary>
  <p className="muted">{t('문안과 저장된 사양·견적 필수 항목을 함께 검토하세요. 전송은 별도 승인이 필요합니다.','Review the wording with the saved specification and required quotation fields. Sending requires separate approval.')}</p>
  <div className="source-text">{suggestion.body}</div>
  <button type="button" className="btn btn-secondary" disabled={disabled||query.isFetching} onClick={()=>onApply(suggestion)}>{t('AI 문안으로 본문 바꾸기','Replace message with AI wording')}</button>
 </details>;
}
