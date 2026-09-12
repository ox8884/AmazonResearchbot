import assert from 'node:assert/strict';
import {createElement} from '../apps/web/node_modules/react/index.js';
import {renderToStaticMarkup} from '../apps/web/node_modules/react-dom/server.node.js';
import {QueryClient,QueryClientProvider} from '../apps/web/node_modules/@tanstack/react-query/build/modern/index.js';
import {MailProfileActionPanel} from '../apps/web/src/MailProfileReview.tsx';
const config={name:'Synthetic mailbox',smtpHost:'smtp.fixture.invalid',smtpPort:465,imapHost:'imap.fixture.invalid',imapPort:993,sender:'buyer@fixture.invalid',username:'buyer',sentMailbox:'Sent',inboxMailbox:'INBOX'};
const base={profileId:'synthetic-profile',version:1,status:'active',configuredFields:config,secretConfigured:true,last4:'TEST',connectionStatus:'unverified'};
const approval={id:'synthetic-approval',payload:{profileId:base.profileId,version:1,config}};
for(const state of ['active','pending','request']){
  for(const reviewBlocked of [true,false]){
    const client=new QueryClient();
    try{
      const markup=renderToStaticMarkup(createElement(QueryClientProvider,{client},createElement(MailProfileActionPanel,{profile:{...base,status:state==='active'?'active':'pending_approval'},approvals:state==='pending'?[approval]:[],approvalsUnavailable:false,reviewBlocked,onProfileChanged:async()=>{}})));
      const buttons=[...markup.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)];
      assert.equal(buttons.length,state==='pending'?2:1);
      for(const [,attributes,label] of buttons)assert.equal(/\bdisabled(?:=|\s|$)/.test(attributes),reviewBlocked,`${state}: ${label} must follow the reload busy state`);
    }finally{client.clear();}
  }
}
console.log('PASS: all rendered mail review actions wait during reload and become available afterward.');
