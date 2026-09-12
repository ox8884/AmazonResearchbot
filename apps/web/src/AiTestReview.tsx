import { useMutation } from "@tanstack/react-query";
import { approve } from "./api.ts";
import { rejectSettings } from "./settings-api.ts";
import { runAiTest, type AiTestRecord } from "./ai-test-api.ts";
import { aiRoleLabels } from "./AiRoutingFields.tsx";
import { useLocale } from "./ui.tsx";
export function AiTestReview({record,currentVersion,onRefresh}:{record:AiTestRecord;currentVersion:number;onRefresh:()=>Promise<void>}){
  const {t,language}=useLocale();
  const grant=record.payload;
  const stale=currentVersion!==grant.version||record.status==='stale';
  const action=useMutation({mutationFn:async(decision:'approve'|'reject'|'run')=>{if(decision==='run')await runAiTest(record);else if(decision==='approve')await approve(record.id);else await rejectSettings(record.id);},onSuccess:onRefresh});
  const execution=record.execution?.state;
  const canRun=record.status==='approved'&&!stale&&(!execution||['budget_blocked','price_unknown','no_provider'].includes(execution));
  const resultLabel:Record<string,readonly[string,string]>={succeeded:['정해진 테스트 응답을 확인했습니다.','Expected test response verified.'],dispatching:['실행 결과를 기다리고 있습니다.','Waiting for the execution result.'],outcome_unknown:['전송 결과가 미확인입니다. 중복 실행하지 않습니다.','The outcome is unknown. This request will not be repeated.'],failed_dispatched:['요청이 끝났지만 유효한 테스트 응답을 확인하지 못했습니다.','The request ended without a valid test response.'],failed_non_dispatch:['전송 전에 중단됐습니다. 새 테스트 승인을 요청하세요.','Stopped before sending. Request a new test approval.'],budget_blocked:['남은 예산이 부족해 실행하지 않았습니다.','Not executed: insufficient remaining budget.'],price_unknown:['단가가 미확인이라 실행하지 않았습니다.','Not executed: prices are unconfirmed.'],no_provider:['승인과 현재 설정을 다시 확인해 주세요.','Review the approval and current configuration.']};
  const status=stale?t('설정이 바뀌어 다시 검토해야 합니다','Settings changed; review again'):{pending:t('테스트 승인 대기','Awaiting test approval'),approved:t('테스트 1회 승인됨','One test approved'),rejected:t('테스트 거절됨','Test rejected'),stale:t('승인 만료','Approval stale')}[record.status];
  return <section className="quiet stack">
    <h4>{status}</h4>
    <dl className="settings-values">
      <div><dt>{t('대상 모델 · 설정','Model · configuration')}</dt><dd>{grant.displayedConfig.model} · v{grant.version}</dd></div>
      <div><dt>{t('전송 대상','Destination')}</dt><dd>{grant.displayedConfig.baseUrl}</dd></div>
      <div><dt>{t('확인할 역할','Role to test')}</dt><dd>{aiRoleLabels[grant.role][language==='ko'?0:1]}</dd></div>
      <div><dt>{t('입력 / 출력 토큰 상한','Input / output token caps')}</dt><dd>{grant.displayedConfig.maxInputTokens} / {grant.displayedConfig.maxOutputTokens}</dd></div>
      <div><dt>{t('예상 최대 비용','Estimated maximum cost')}</dt><dd>{grant.maxCostUsd} USD</dd></div>
    </dl>
    <p className="muted">{t('전송할 합성 문장','Synthetic message to send')}</p><blockquote>{grant.prompt}</blockquote>
    <p className="muted">{t('이 승인은 위 테스트 한 건에만 적용됩니다. 일반 AI 사용은 별도 승인이 필요합니다.','This approval applies only to this test. Normal AI use requires separate activation approval.')}</p>
    {record.status==='approved'&&!stale&&<p className="banner" role="status">{execution?t(...(resultLabel[execution]??['실행 상태 확인 중','Checking execution status'])):t('승인된 테스트를 한 번 실행할 수 있습니다.','The approved test can be run once.')}</p>}
    {canRun&&<button className="btn btn-primary" disabled={action.isPending} onClick={()=>action.mutate('run')}>{t('승인한 테스트 실행','Run approved test')}</button>}
    {action.isError&&<p role="alert" className="banner">{t('처리하지 못했습니다. 실행 연결이 비활성이거나 설정이 바뀌었을 수 있습니다.','Could not complete the action. Execution may be disabled or settings may have changed.')}</p>}
    {record.status==='pending'&&!stale&&<div className="btn-row"><button className="btn btn-primary" disabled={action.isPending} onClick={()=>action.mutate('approve')}>{t('이 테스트 1회 승인','Approve this single test')}</button><button className="btn btn-secondary" disabled={action.isPending} onClick={()=>action.mutate('reject')}>{t('테스트 거절','Reject test')}</button></div>}
  </section>;
}
