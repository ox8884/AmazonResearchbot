import {NavLink} from 'react-router';
import type {MailProfileApproval} from './mail-profile-api.ts';
import {Icon,Stage,useLocale} from './ui.tsx';
export function MailApprovalCard({request}:{request:MailProfileApproval}){
  const {t}=useLocale();
  return <article className="card stack">
    <Stage>{t('업무 메일 사용 승인 대기','Work mailbox awaiting approval')}</Stage>
    <h3>{request.payload.config.name}</h3>
    <p className="source-text">{request.payload.config.sender} · v{request.payload.version}</p>
    <p className="muted">{t('승인된 견적 요청에 사용할 발송 계정을 검토하세요.','Review the mailbox that will send approved quote requests.')}</p>
    <NavLink className="btn btn-primary" to="/settings/mail">{t('메일 설정 검토','Review mail settings')}<Icon name="arrow"/></NavLink>
  </article>;
}
