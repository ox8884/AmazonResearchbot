import {useQuery} from '@tanstack/react-query';
import type {SubscriptionCapability} from '../../../packages/integrations/src/subscriptions/capabilities.ts';
import {useLocale} from './ui.tsx';
export function SubscriptionConnections(){
  const {t}=useLocale();
  const query=useQuery({queryKey:['subscription-capabilities'],queryFn:async()=>{
    const response=await fetch('/api/subscriptions',{credentials:'include'});
    if(!response.ok)throw new Error('Subscription status unavailable');
    const data:{capabilities:SubscriptionCapability[]}=await response.json();
    return data.capabilities;
  }});
  if(query.isPending)return <p className="muted">{t('구독 연동 상태 확인 중','Checking subscription availability')}</p>;
  if(query.isError)return <div className="stack"><p role="alert">{t('구독 연동 상태를 확인하지 못했어요.','Could not check subscription availability.')}</p><button className="text-btn" type="button" onClick={()=>void query.refetch()}>{t('다시 확인','Check again')}</button></div>;
  return <>{query.data.map(capability=><div className="connection-row" key={capability.provider}>
    <div><strong>{capability.provider==='chatgpt'?'ChatGPT':'Grok'} {t('구독','subscription')}</strong><p className="muted">{t('공식 연동 확인 전','Official integration not verified')}</p></div>
    <span className="chip chip-danger">{t('사용 불가','Unavailable')}</span>
  </div>)}</>;
}
