export function alibabaSessionScript(request,marker) {
 async function prepare(request,marker) {
  const owned=[];
  let p,identity,productUrl=request.productUrl,finished=false,clicked=false,filled=false,historicalRead=false;
  const initialRead=request.kind==='supplier_thread'&&request.threadId===null&&request.accountId===null&&!request.negotiation;
  const companyKey=value=>/^https:\/\/([a-z0-9-]+)\.(?:m\.)?(en|trustpass)\.alibaba\.com(?:[/?#]|$)/i.exec(value)?.slice(1).join('.').toLowerCase();
  const expectedCompany=companyKey(request.companyUrl),messenger='https://message.alibaba.com/message/messenger.htm';
  const emit=value=>console.log(marker+JSON.stringify(value));
  async function open(url){
   const page=await openTab(url);owned.push(page);return page;
  }
  async function cleanup(){
   if(filled&&!clicked&&p){
    const composer=p.locator('textarea.send-textarea');
    if(await composer.evaluate(el=>el.value)===request.body){
     await composer.fill('');await composer.press('End');await snapshot(p,{interactive:true});
     if(await composer.evaluate(el=>el.value)!=='')throw new Error('ALIBABA_DRAFT_CLEAR_UNCONFIRMED');
    }
   }
   for(const tab of [...owned].reverse())await closeTab(tab);
  }
  async function selected(page){
   const selection=page.locator('.contact-item-container.selected'),count=await selection.count();
   if(page===p&&initialRead&&count===0){
    historicalRead=true;return historicalIdentity(page);
   }
   if(count!==1)throw new Error('ALIBABA_THREAD_UNCONFIRMED');
   return selection.evaluate(el=>({
    threadId:el.getAttribute('data-cid'),sellerId:el.getAttribute('data-ali-id'),
    companyName:el.querySelector('.contact-company')?.innerText.trim(),
   }));
  }
  async function historicalIdentity(page){
   const records=await page.locator('body').evaluate(body=>Array.from(body.querySelectorAll('.message-item-wrapper')).flatMap(el=>{
    const raw=el.getAttribute('data-expinfo');if(!raw)return [];
    const meta=JSON.parse(raw);return meta.messageType===1?[{senderId:meta.senderId,receiverId:meta.receiverId,extBizId:meta.extBizId,outbound:el.classList.contains('item-right')}]:[];
   }));
   const inbound=records.find(record=>!record.outbound),outbound=records.find(record=>record.outbound);
   const sellerId=inbound?.senderId,accountId=inbound?.receiverId,threadId=sellerId+'-'+accountId+'#11011@icbu';
   if(!inbound||!outbound||typeof sellerId!=='string'||typeof accountId!=='string'||!/^\d{1,30}$/.test(sellerId)||!/^\d{1,30}$/.test(accountId)||sellerId===accountId||
      records.some(record=>(record.outbound?(record.senderId!==accountId||(record.receiverId!==undefined&&record.receiverId!==''&&record.receiverId!==sellerId)):(record.senderId!==sellerId||record.receiverId!==accountId))||
       (record.extBizId!==undefined&&record.extBizId!==''&&record.extBizId!==threadId)))throw new Error('ALIBABA_THREAD_UNCONFIRMED');
   return {threadId,sellerId};
  }
  async function findContact(page){
   await page.locator('.conv-list-header__search').click();
   const search=page.getByRole('textbox',{name:'Search',exact:true});
   await search.fill(request.companyName);await search.press('Enter');await snapshot(page,{interactive:true});
   const contacts=page.locator('li.contact-list-item').filter({hasText:request.companyName});
   try{await contacts.first().waitFor({state:'visible',timeout:15000});}catch{return null;}
   const normalize=value=>value?.trim().replace(/\s+/g,' ').toLowerCase();
   const matches=await page.locator('body').evaluate((body,name)=>Array.from(body.querySelectorAll('li.contact-list-item')).flatMap((el,index)=>el.querySelector('.company-name')?.innerText.trim().replace(/\s+/g,' ').toLowerCase()===name?[index]:[]),normalize(request.companyName));
   if(matches.length===0)return null;
   if(matches.length!==1)throw new Error('ALIBABA_THREAD_UNCONFIRMED');
   const contact=page.locator('li.contact-list-item').nth(matches[0]);
   const company=await contact.evaluate(el=>el.querySelector('.company-name')?.innerText);
   if(normalize(company)!==normalize(request.companyName))throw new Error('ALIBABA_COMPANY_UNCONFIRMED');
   await contact.click();await snapshot(page,{interactive:true});
   return selected(page);
  }
  async function revealThread(page,threadId){
   const row=page.locator('.contact-item-container[data-cid="'+threadId+'"]'),list=page.locator('.normal-list-container');
   const scroll=(root,move)=>{
    const boxes=Array.from(root.querySelectorAll('div')).filter(el=>getComputedStyle(el).overflowY==='auto'&&el.clientHeight>0&&el.scrollHeight>el.clientHeight);
    if(boxes.length!==1)return null;
    const box=boxes[0],before=box.scrollTop;
    if(move)box.scrollTop=Math.min(box.scrollHeight-box.clientHeight,before+box.clientHeight);
    return {before,after:box.scrollTop,total:box.scrollHeight};
   };
   for(let step=0;step<20;step++){
    const count=await row.count();if(count)return count===1;
    if(await list.count()!==1)return false;
    const moved=await list.evaluate(scroll,true);if(!moved)return false;
    await snapshot(page,{interactive:true});
    if(moved.before===moved.after){
     try{await row.waitFor({state:'visible',timeout:1500});}catch{}
     if(await row.count()===1)return true;
     const current=await list.evaluate(scroll,false);
     if(!current||current.total<=moved.total)return false;
    }
   }
   return await row.count()===1;
  }
  async function checkIdentity(){
   if(!/^https:\/\/message\.alibaba\.com\/message\/messenger\.htm(?:[?#].*)?$/.test(p.url()))throw new Error('ALIBABA_THREAD_CHANGED');
   const current=await selected(p);
   if(current.threadId!==identity.threadId||current.sellerId!==identity.sellerId)throw new Error('ALIBABA_THREAD_CHANGED');
   const currentBuyer=/^\d+-(\d+)#11011@icbu$/.exec(current.threadId)?.[1];
   if(currentBuyer!==identity.accountId||(request.accountId!==null&&currentBuyer!==request.accountId))throw new Error('ALIBABA_ACCOUNT_UNCONFIRMED');
   if(await p.locator('.assets-group-im-contact-profile').count()!==1||!await p.locator('.assets-group-im-contact-profile').isVisible())throw new Error('ALIBABA_COMPANY_UNCONFIRMED');
   const links=await p.locator('body').evaluate(body=>Array.from(body.querySelectorAll('.assets-group-im-contact-profile .company-name a[href]'),a=>({name:a.innerText.trim(),url:a.href})));
   const profile=links.filter(link=>companyKey(link.url)===expectedCompany);
   if(profile.length!==1||!profile[0].name)throw new Error('ALIBABA_COMPANY_UNCONFIRMED');
   return profile[0];
  }
  async function messages(){
   return p.locator('body').evaluate((body,ids)=>Array.from(body.querySelectorAll('.message-item-wrapper')).flatMap(el=>{
    const raw=el.getAttribute('data-expinfo');
    if(!raw)return [];
    const meta=JSON.parse(raw);
    if(meta.messageType!==1)return [];
    // data-original may contain translation HTML; read only the original rendered content.
    const originals=Array.from(el.querySelectorAll('.session-rich-content.text')).filter(node=>!node.closest('.session-translate'));
    if(originals.length===0&&el.getAttribute('data-original')===''&&el.querySelector('.revert-msg'))return [];
    if(originals.length!==1)throw new Error('ALIBABA_MESSAGE_BODY_UNCONFIRMED');
    const content=node=>node.nodeType===3?node.nodeValue:node.nodeType!==1?'':node.tagName==='BR'?'\n':Array.from(node.childNodes).map(content).join('');
    let text=content(originals[0]);
    // Preserve existing text hashes; image-only provider emoticons previously blocked the whole capture.
    if(!text){
     text=Array.from(originals[0].querySelectorAll('img'),image=>{
      const emoticon=/^https:\/\/atmgateway-client\.alibaba\.com\/smily-big\/(smile_\d+\.png)$/.exec(image.src);
      if(!emoticon)throw new Error('ALIBABA_MESSAGE_BODY_UNCONFIRMED');
      return '[Alibaba emoticon: '+emoticon[1]+']';
     }).join('');
    }
    if(!text)throw new Error('ALIBABA_MESSAGE_BODY_UNCONFIRMED');
    const outbound=el.classList.contains('item-right');
    // Alibaba may omit or leave extBizId empty; selected thread and sender/receiver still bind every inbound.
    if(typeof meta.messageId!=='string'||!/^\d+$/.test(meta.messageId)||!Number.isFinite(meta.sendTime)||
       (outbound?meta.senderId!==ids.accountId:meta.senderId!==ids.sellerId)||
       (!outbound&&(meta.receiverId!==ids.accountId||(meta.extBizId!==undefined&&meta.extBizId!==''&&meta.extBizId!==ids.threadId))))throw new Error('ALIBABA_MESSAGE_IDENTITY_UNCONFIRMED');
    return [{id:meta.messageId,direction:outbound?'outbound':'inbound',body:text,sentAt:new Date(meta.sendTime).toISOString()}];
   }),identity);
  }
  async function checkInbound(){
   if(!request.basedOnInbound)return;
   const records=await messages();
   const inbound=records.filter(message=>message.direction==='inbound').sort((a,b)=>Date.parse(b.sentAt)-Date.parse(a.sentAt)||(a.id>b.id?-1:1))[0];
   const basis=request.basedOnInbound;
   if(!inbound||inbound.id!==basis.providerMessageId||inbound.sentAt!==basis.sentAt)throw new Error('NEGOTIATION_CONTEXT_CHANGED');
   const hash=await p.evaluate(async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join(''),inbound.body);
   if(hash!==basis.bodySha256||records.some(message=>message.direction==='outbound'&&(Date.parse(message.sentAt)>Date.parse(inbound.sentAt)||(message.sentAt===inbound.sentAt&&message.id>inbound.id))))throw new Error('NEGOTIATION_CONTEXT_CHANGED');
  }
  async function observe(sendStatus,reason=null){
   const profile=await checkIdentity(),records=await messages(),snap=await snapshot(p,{interactive:true});
   if(historicalRead){
    if(!records.some(record=>record.direction==='inbound')||!records.some(record=>record.direction==='outbound'))throw new Error('ALIBABA_THREAD_UNCONFIRMED');
    await checkIdentity();
   }
   return {protocol:1,kind:'captured',scope:'alibaba_thread',conversationId:request.conversationId,
    actionId:request.kind==='supplier_send'?request.actionId:null,companyName:profile.name,companyUrl:profile.url,
    productUrl,threadId:identity.threadId,accountId:identity.accountId,sourcePageUrl:messenger,
    observedAt:new Date().toISOString(),snapshot:snap.tree.replace(/https:\/\/message\.alibaba\.com\/message\/messenger\.htm[^\s\]]*/g,messenger),messages:records,sendStatus,reason};
  }
  async function readySendButton(){
   const send=p.locator('button.send-tool-button');
   if(await send.count()!==1||await send.evaluate(el=>el.classList.contains('gray')||el.disabled))throw new Error('ALIBABA_SEND_UNAVAILABLE');
   return send;
  }
  async function finish(authorization){
   if(finished)throw new Error('ALIBABA_SESSION_ALREADY_FINISHED');
   finished=true;
   let result;
   try{
    await checkIdentity();
    if(!authorization.allowed){result=await observe('not_sent',authorization.reason);return;}
    if(request.kind!=='supplier_send')throw new Error('ALIBABA_SEND_NOT_REQUESTED');
    const composer=p.locator('textarea.send-textarea');
    if(await composer.evaluate(el=>el.value)!==request.body)throw new Error('ALIBABA_COMPOSER_CHANGED');
    if(await p.locator('.dx-refer-container').isVisible())throw new Error('ALIBABA_REFERENCE_UNCONFIRMED');
    const current=await messages();
    if(current.some(message=>message.direction==='outbound'&&message.body===request.body)){result=await observe('sent');return;}
    const before=new Set(current.map(message=>message.id)),send=await readySendButton();
    await checkInbound();
    clicked=true;
    await send.click();
    await p.locator('.message-item-wrapper.item-right').filter({hasText:request.body}).first().waitFor({state:'visible',timeout:15000});
    result=await observe('unknown','ALIBABA_RECEIPT_UNCONFIRMED');
    if(result.messages.some(message=>message.direction==='outbound'&&message.body===request.body&&!before.has(message.id))){
     result.sendStatus='sent';result.reason=null;
    }
   }catch(error){
    const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'ALIBABA_SEND_UNCONFIRMED';
    try{result=await observe(clicked?'unknown':'not_sent',reason);}catch{result={protocol:1,kind:'unavailable',reason};}
   }finally{await cleanup();emit(result);}
  }
  try{
   let threadId=request.threadId;
   p=await open(messenger);await p.locator('.conv-list-header__search').waitFor({state:'visible',timeout:15000});await snapshot(p,{interactive:true});
   if(!threadId||!await revealThread(p,threadId)){
    const contact=await findContact(p);
    if(contact){
     if(threadId&&contact.threadId!==threadId)throw new Error('ALIBABA_THREAD_CHANGED');
     threadId=contact.threadId;
    }else p=null;
   }
   if(!p){
    const product=await open(request.productUrl);
    if(product.url().split(/[?#]/)[0]!==request.productUrl.split(/[?#]/)[0])throw new Error('ALIBABA_PRODUCT_CHANGED');
    await product.locator('h1').waitFor({state:'visible',timeout:15000});
    await snapshot(product,{interactive:true});
    const links=await product.locator('body').evaluate(body=>Array.from(body.querySelectorAll('a[href]'),a=>a.href));
    if(!links.some(link=>companyKey(link)===expectedCompany))throw new Error('ALIBABA_COMPANY_UNCONFIRMED');
    productUrl=product.url();
    await product.locator('[data-testid="pc-purchase-action"][data-action-id="chat"]').first().click();
    await snapshot(product,{interactive:true});
    await product.frameLocator('iframe[src="https://onetalk.alibaba.com/message/weblite.htm"]').locator('.jump-icon-wrapper').waitFor({state:'visible',timeout:15000});
    const lite=product.frames().find(frame=>frame.url()==='https://onetalk.alibaba.com/message/weblite.htm');
    // Only an initial read can recover historical text without a mounted list row.
    if(!initialRead||await lite.locator('.contact-item-container.selected').count()!==0){
     const temporary=(await selected(lite)).threadId;
     if(threadId&&temporary!==threadId)throw new Error('ALIBABA_THREAD_CHANGED');
     threadId=temporary;
    }
    const before=new Set((await listBrowserTabs()).map(tab=>tab.targetId));
    await lite.locator('.jump-icon-wrapper').click();await snapshot(product,{interactive:true});
    const launched=(await listBrowserTabs()).filter(tab=>!before.has(tab.targetId)&&/^https:\/\/message\.alibaba\.com\/message\/messenger\.htm(?:[?#].*)?$/.test(tab.url));
    if(launched.length!==1)throw new Error('ALIBABA_THREAD_UNCONFIRMED');
    p=await attachBrowserTab(launched[0].targetId);owned.push(p);await snapshot(p,{interactive:true});
    await p.locator('.content-header .click-area').waitFor({state:'visible',timeout:15000});
    if(!threadId)threadId=(await selected(p)).threadId;
   }
   if(!/^\d{1,30}-\d{1,30}#11011@icbu$/.test(threadId))throw new Error('ALIBABA_THREAD_UNCONFIRMED');
   const row=p.locator('.contact-item-container[data-cid="'+threadId+'"]');
   if(!historicalRead){
    await row.waitFor({state:'visible',timeout:15000});
    if(await row.count()!==1)throw new Error('ALIBABA_THREAD_UNCONFIRMED');
    // Pointer navigation can miss virtualized rows; activate the exact verified conversation element.
    await row.evaluate(el=>el.click());await snapshot(p,{interactive:true});
    await p.locator('.contact-item-container.selected[data-cid="'+threadId+'"]').waitFor({state:'visible',timeout:15000});
   }
   identity=await selected(p);
   const parts=threadId.match(/^(\d+)-(\d+)#11011@icbu$/);
   if(identity.threadId!==threadId||identity.sellerId!==parts[1])throw new Error('ALIBABA_ACCOUNT_UNCONFIRMED');
   identity.accountId=parts[2];
   if(request.accountId!==null&&identity.accountId!==request.accountId)throw new Error('ALIBABA_ACCOUNT_UNCONFIRMED');
   await p.locator('.content-header .click-area').click();await snapshot(p,{interactive:true});
   const observation=await observe(request.kind==='supplier_send'?'not_sent':'read');
   if(request.kind==='supplier_thread'||observation.messages.some(message=>message.direction==='outbound'&&message.body===request.body)){
    if(request.kind==='supplier_send')observation.sendStatus='sent';
    finished=true;await cleanup();emit(observation);return null;
   }
   const composer=p.locator('textarea.send-textarea');
   if(await composer.count()!==1||await composer.evaluate(el=>el.value)!=='')throw new Error('ALIBABA_COMPOSER_OCCUPIED');
   const reference=p.locator('.dx-refer-container');
   if(await reference.isVisible()){
    if(!owned.includes(p))throw new Error('ALIBABA_COMPOSER_OCCUPIED');
    await p.locator('.dx-refer-container .close').click();await snapshot(p,{interactive:true});
    await reference.waitFor({state:'hidden',timeout:15000});
   }
   try{await checkInbound();}catch{const result=await observe('not_sent','NEGOTIATION_CONTEXT_CHANGED');finished=true;await cleanup();emit(result);return null;}
   filled=true;await composer.fill(request.body);
   // Alibaba updates Send readiness on keyup; End leaves the signed body unchanged.
   await composer.press('End');await snapshot(p,{interactive:true});
   if(await composer.evaluate(el=>el.value)!==request.body)throw new Error('ALIBABA_COMPOSER_CHANGED');
   await readySendButton();
   emit({protocol:1,kind:'ready',observation});
   return {finish};
  }catch(error){
   finished=true;
   const reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'ALIBABA_SITE_UNAVAILABLE';
   await cleanup();emit({protocol:1,kind:'unavailable',reason});return null;
  }
 }
 return 'globalThis.forgeAlibabaSession=await ('+prepare.toString()+')('+JSON.stringify(request)+','+JSON.stringify(marker)+');';
}
export function alibabaFinishScript(authorization) {
 return 'await globalThis.forgeAlibabaSession.finish('+JSON.stringify(authorization)+');globalThis.forgeAlibabaSession=null;';
}
