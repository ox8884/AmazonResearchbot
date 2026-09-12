import {amazonMarketObservationSchema} from '@forge-ops/domain';
import type {QueryConnection} from '@forge-ops/db';

export function parseAmazonMarketSource(input:unknown,query:string){
 const parsed=amazonMarketObservationSchema.safeParse(input);
 if(!parsed.success||parsed.data.query!==query)return null;
 const url=new URL(parsed.data.sourcePageUrl);
 const terms=[...url.searchParams.getAll('k'),...url.searchParams.getAll('field-keywords')];
 if(terms.length!==1||terms[0]!==query)return null;
 for(const [key,allowed] of [['page','1'],['s','relevanceblender'],['i','aps'],['url','search-alias=aps']] as const){
  const values=url.searchParams.getAll(key);
  if(values.length>1||values.some(value=>value!==allowed))return null;
 }
 if(url.searchParams.has('rh'))return null;
 return parsed.data;
}

export async function readMarketSource(db:QueryConnection,candidateId:string,key:Buffer){
 const row=(await db.query<{state:string;input_version:number;settings_version:number;current_input:number;current_settings:number;query:string;receipt_id:string|null;body_ciphertext:string|null;expires_at:Date}>(`
  SELECT t.state,t.input_version,t.settings_version,c.input_version AS current_input,
   (SELECT max(version) FROM settings_versions) AS current_settings,c.normalized_keyword AS query,
   r.id AS receipt_id,r.body_ciphertext,t.expires_at
  FROM browser_tasks t JOIN candidates c ON c.id=t.candidate_id
  LEFT JOIN browser_task_results r ON r.id=t.result_id AND r.task_id=t.id
  WHERE t.candidate_id=$1 AND t.task_kind='amazon_search' ORDER BY t.created_at DESC,t.id DESC LIMIT 1`,[candidateId])).rows[0];
 if(!row)return {state:'not_collected' as const};
 if(row.input_version!==row.current_input||row.settings_version!==row.current_settings)return {state:'stale' as const};
 if(row.state!=='completed')return {state:row.state==='cancelled'||row.expires_at.getTime()<=Date.now()?'waiting' as const:'collecting' as const};
 if(!row.receipt_id||!row.body_ciphertext)throw Error('MARKET_SOURCE_MISSING');
 // The browser adapter imports the parser under native Node without a TypeScript loader.
 const {decryptSecret}=await import('@forge-ops/security');
 const data=JSON.parse(decryptSecret(row.body_ciphertext,key,'browser-task-result:'+row.receipt_id).toString('utf8'));
 const observation=parseAmazonMarketSource(data,row.query);
 if(!observation)throw Error('MARKET_SOURCE_INVALID');
 return {state:'captured' as const,receiptId:row.receipt_id,inputVersion:row.input_version,settingsVersion:row.settings_version,observation};
}
