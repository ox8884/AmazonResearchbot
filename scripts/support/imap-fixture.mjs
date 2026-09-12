import tls from 'node:tls';
import {mkdtemp,readFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function localImapFixture({rejectAuthentication=false,denySearch=false,supplierAddress="supplier@example.net",uidValidity=7,uidNext=2,withAttachments=false,withTerms=false}={}){
 const directory=await mkdtemp(join(tmpdir(),'forge-imap-'));
 const keyPath=join(directory,'fixture.key'),certPath=join(directory,'fixture.crt');
 const executable=process.platform==='win32'?'C:/Program Files/Git/mingw64/bin/openssl.exe':'openssl';
 let server;
 const sockets=new Set(),commands=[];
 let credentialsMatched=false,allFetchesPeek=true,unsupportedPartFetches=0;
 const password='synthetic-imap-password';
 const body=Buffer.from(withTerms?['합성 공급처 회신','Quantity: 300','MOQ: 100','Incoterm: DDP','Product unit price (USD): 5.00','Valid until: 2030-01-01',''].join(String.fromCharCode(13,10)):'견적 본문 <b>문자 그대로</b>'+String.fromCharCode(13,10)+'Unit price: USD 5.00'+String.fromCharCode(13,10));
 const lineCount=body.toString('utf8').split(String.fromCharCode(10)).length-1;
 const threadHeaders=Buffer.from('Message-ID: <reply-fixture@example.net>\r\nIn-Reply-To: <forge-rfq-fixture@example.com>\r\nReferences: <forge-rfq-fixture@example.com>\r\n\r\n');
 const subjectHeader='=?UTF-8?B?'+Buffer.from('합성 견적').toString('base64')+'?=';
 const rawHeaders=['From: Supplier <'+supplierAddress+'>','To: buyer@example.com','Subject: '+subjectHeader,'Date: Sun, 06 Sep 2026 12:00:00 +0000','Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: 8bit',''].join(String.fromCharCode(13,10));
 const csvBytes=Buffer.from('unit_price,5'),csvWire=Buffer.from(csvBytes.toString('base64'));
 const eol=String.fromCharCode(13,10);
 const multipart=Buffer.concat([Buffer.from('--fixture-boundary'+eol+'Content-Type: text/plain; charset=utf-8'+eol+'Content-Transfer-Encoding: 8bit'+eol+eol),body,Buffer.from(eol+'--fixture-boundary'+eol+'Content-Type: text/csv; charset=utf-8'+eol+'Content-Disposition: attachment; filename="quote.csv"'+eol+'Content-Transfer-Encoding: base64'+eol+eol),csvWire,Buffer.from(eol+'--fixture-boundary'+eol+'Content-Type: application/octet-stream'+eol+'Content-Disposition: attachment; filename="quote.exe"'+eol+eol+'not executable fixture'+eol+'--fixture-boundary--'+eol)]);
 const sourceHeaders=withAttachments?rawHeaders.replace('Content-Type: text/plain; charset=utf-8','Content-Type: multipart/mixed; boundary="fixture-boundary"').replace('Content-Transfer-Encoding: 8bit'+eol,''):rawHeaders;
 const raw=Buffer.concat([Buffer.from(sourceHeaders),threadHeaders,withAttachments?multipart:body]);
 try{
  await exec(executable,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',keyPath,'-out',certPath,'-subj','/CN=imap.example.com','-addext','subjectAltName=DNS:imap.example.com']);
  const key=await readFile(keyPath),certificate=await readFile(certPath);
  server=tls.createServer({key,cert:certificate,minVersion:'TLSv1.2'},socket=>{
   sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>socket.destroy());
   socket.write('* OK [CAPABILITY IMAP4rev1] Synthetic fixture ready\r\n');
   let buffer='';
   socket.on('data',chunk=>{
    buffer+=chunk.toString('utf8');
    for(;;){
     const end=buffer.indexOf('\r\n');if(end<0)break;
     const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
     const match=/^(\S+) (.*)$/.exec(line);if(!match)continue;
     const [,tag,request]=match,upper=request.toUpperCase();
     const name=upper.startsWith('UID ')?upper.split(' ').slice(0,2).join(' '):upper.split(' ')[0];
     commands.push(name);
     const ok=()=>socket.write(tag+' OK completed\r\n');
     const literal=(prefix,bytes)=>socket.write(Buffer.concat([Buffer.from('* 1 FETCH (UID 1 '+prefix+' {'+bytes.length+'}\r\n'),bytes,Buffer.from(')\r\n'+tag+' OK FETCH completed\r\n')]));
     if(name==='CAPABILITY'){socket.write('* CAPABILITY IMAP4rev1\r\n');ok();}
     else if(name==='LOGIN'){
      credentialsMatched=request.includes('buyer@example.com')&&request.includes(password);
      if(rejectAuthentication)socket.write(tag+' NO [AUTHENTICATIONFAILED] PRIVATE_FIXTURE_REJECTION\r\n');else ok();
     }
     else if(name==='LIST'||name==='LSUB'){socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n');ok();}
     else if(name==='EXAMINE'){
      socket.write('* FLAGS (\\Seen \\Answered)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY '+uidValidity+'] valid\r\n* OK [UIDNEXT '+uidNext+'] next\r\n'+tag+' OK [READ-ONLY] examined\r\n');
     }
     else if(name==='UID SEARCH'){
      if(denySearch)socket.write(tag+' NO [UNAVAILABLE] PRIVATE_SEARCH_ERROR\r\n');else{socket.write('* SEARCH 1\r\n');ok();}
     }
     else if(name==='UID FETCH'){
      allFetchesPeek=allFetchesPeek&&upper.includes('BODY.PEEK[');
      if(upper.includes('HEADER.FIELDS')){
       const subject='=?UTF-8?B?'+Buffer.from('합성 견적').toString('base64')+'?=';
       const envelope='("Sun, 06 Sep 2026 12:00:00 +0000" "'+subject+'" (("Supplier" NIL "'+supplierAddress.split('@')[0]+'" "'+supplierAddress.split('@')[1]+'")) NIL NIL (("Buyer" NIL "buyer" "example.com")) NIL NIL "<forge-rfq-fixture@example.com>" "<reply-fixture@example.net>")';
       const textStructure='("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "8BIT" '+body.length+' '+lineCount+' NIL NIL NIL NIL)';
       const structure=withAttachments?'('+textStructure+' ("TEXT" "CSV" ("CHARSET" "UTF-8" "NAME" "quote.csv") NIL NIL "BASE64" '+csvWire.length+' 1 NIL ("ATTACHMENT" ("FILENAME" "quote.csv")) NIL NIL) ("APPLICATION" "OCTET-STREAM" NIL NIL NIL "7BIT" 22 NIL ("ATTACHMENT" ("FILENAME" "quote.exe")) NIL NIL) "MIXED" ("BOUNDARY" "fixture-boundary") NIL NIL NIL)':textStructure;
       literal('RFC822.SIZE '+raw.length+' INTERNALDATE "06-Sep-2026 12:00:00 +0000" ENVELOPE '+envelope+' BODYSTRUCTURE '+structure+' BODY[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES)]',threadHeaders);
      }else if(upper.includes('BODY.PEEK[]'))literal('BODY[]<0>',raw);
      else if(upper.includes('BODY.PEEK[TEXT]'))literal('BODY[TEXT]<0>',body);
      else if(upper.includes('BODY.PEEK[1]'))literal('BODY[1]<0>',body);
      else if(upper.includes('BODY.PEEK[2]'))literal('BODY[2]<0>',csvWire);
      else if(upper.includes('BODY.PEEK[3]')){unsupportedPartFetches++;literal('BODY[3]<0>',Buffer.from('not executable fixture'));}
      else socket.write(tag+' BAD Unsupported fixture fetch\r\n');
     }
     else if(name==='LOGOUT'){socket.end('* BYE fixture closed\r\n'+tag+' OK LOGOUT completed\r\n');}
     else if(name==='NOOP'||name==='CLOSE'||name==='UNSELECT')ok();
     else socket.write(tag+' BAD Unsupported fixture command\r\n');
    }
   });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();if(!address||typeof address==='string')throw new Error('Fixture TCP port missing');
  return {port:address.port,certificate,password,body,raw,csvBytes,commands,observations:()=>({credentialsMatched,allFetchesPeek,unsupportedPartFetches}),close:async()=>{
   for(const socket of sockets)socket.destroy();
   await new Promise(resolve=>server.close(resolve));
   await unlink(keyPath);await unlink(certPath);await rmdir(directory);
  }};
 }catch(error){
  for(const socket of sockets)socket.destroy();
  if(server)await new Promise(resolve=>server.close(resolve));
  for(const file of [keyPath,certPath])await unlink(file).catch(cleanup=>{if(cleanup.code!=='ENOENT')throw cleanup;});
  await rmdir(directory);throw error;
 }
}
