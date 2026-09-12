import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { aiRoles, CustomAiError, type AiRole, type CustomAiProfile } from "./custom-ai-api.ts";
import { getAiTests, proposeAiTest } from "./ai-test-api.ts";
import { AiTestReview } from "./AiTestReview.tsx";
import { aiRoleLabels } from "./AiRoutingFields.tsx";
import { LoadError, Loading, useLocale } from "./ui.tsx";
export function AiTestPanel({profile}:{profile:CustomAiProfile}){
  const {t,language}=useLocale();
  const [open,setOpen]=useState(false);
  const [role,setRole]=useState<AiRole|null>(profile.roles?.[0]??null);
  const query=useQuery({queryKey:['ai-tests',profile.id],queryFn:()=>getAiTests(profile.id),enabled:open,refetchInterval:open?3000:false});
  const refresh=async()=>{await query.refetch();};
  const proposal=useMutation({mutationFn:async()=>{if(!role)throw new CustomAiError('PROVIDER_CONFIG_REQUIRED');await proposeAiTest(profile,role);},onSuccess:refresh});
  return <details className="official-evidence" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>{t('연결 테스트 · 1회 승인','Connection test · single-use approval')}</summary>
    {open&&<div className="stack">
      <p className="muted">{t('테스트할 역할을 고르면 실제 전송 전에 대상·합성 문장·예상 비용을 검토할 수 있습니다.','Choose a role to review the destination, synthetic prompt, and estimated cost before sending.')}</p>
      <div className="field"><label htmlFor={`ai-test-role-${profile.id}`}>{t('테스트 역할','Test role')}</label>
        <select id={`ai-test-role-${profile.id}`} value={role??''} disabled={proposal.isPending} onChange={event=>setRole(aiRoles.find(value=>value===event.target.value)??null)}>
          <option value="" disabled>{t('역할 선택','Choose a role')}</option>
          {(profile.roles??[]).map(value=><option key={value} value={value}>{aiRoleLabels[value][language==='ko'?0:1]}</option>)}
        </select>
      </div>
      <button className="btn btn-secondary" disabled={!role||proposal.isPending} onClick={()=>proposal.mutate()}>{t('테스트 승인안 만들기','Prepare test approval')}</button>
      {proposal.isError&&<p className="banner" role="alert">{proposal.error instanceof CustomAiError&&proposal.error.code==='PROVIDER_CONFIG_REQUIRED'?t('키·역할·단가·일일 한도를 먼저 저장해 주세요.','Save a key, roles, prices, and daily limit first.'):t('승인안을 만들지 못했습니다. 현재 설정을 다시 확인해 주세요.','Could not prepare approval. Check the current configuration.')}</p>}
      {query.isPending?<Loading/>:query.isError?<LoadError retry={()=>void query.refetch()}/>:query.data.length===0?<p className="muted">{t('아직 테스트 승인안이 없습니다.','No test approvals yet.')}</p>:query.data.map(record=><AiTestReview key={record.id+record.status} record={record} currentVersion={profile.version} onRefresh={refresh}/>)}
    </div>}
  </details>;
}
