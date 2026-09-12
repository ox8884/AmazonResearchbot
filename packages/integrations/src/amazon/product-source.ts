import type {Pool} from '@forge-ops/db';
import {amazonPackageObservationSchema,aiProductSourceReferenceSchema,selectAiProductExcerpts,type AiProductSourceReference,type AiProductExcerpt,type ProductSourceView} from '@forge-ops/domain';
import {decryptSecret,exactPayloadHash} from '@forge-ops/security';

type SourceRow={readonly selected_asin:string|null;readonly current_input:number;readonly current_settings:number;
 readonly task_id:string|null;readonly state:string|null;readonly input_version:number|null;readonly settings_version:number|null;
 readonly expires_at:Date|null;readonly receipt_id:string|null;readonly body_ciphertext:string|null;readonly body_sha256:string|null;};
type CapturedView=Extract<ProductSourceView,{state:'captured'}>;
export type ProductSourceRead =
 | {readonly state:Exclude<ProductSourceView['state'],'captured'>|'not_found'|'unavailable'}
 | {readonly state:'captured';readonly view:CapturedView;readonly reference:AiProductSourceReference;readonly excerpts:readonly AiProductExcerpt[]};

export async function readProductSource(pool:Pick<Pool,'query'>,candidateId:string,key:Buffer):Promise<ProductSourceRead>{
 const row=(await pool.query<SourceRow>(`
  SELECT c.input_version AS current_input,(SELECT max(version) FROM settings_versions) AS current_settings,
   (SELECT detail->>'representativeAsin' FROM candidate_events WHERE candidate_id=c.id
     AND input_version=c.input_version AND stage='api_validation') AS selected_asin,
   t.id AS task_id,t.state,t.input_version,t.settings_version,t.expires_at,
   r.id AS receipt_id,r.body_ciphertext,r.body_sha256
  FROM candidates c LEFT JOIN LATERAL (SELECT * FROM browser_tasks WHERE candidate_id=c.id AND task_kind='amazon_package'
   ORDER BY created_at DESC,id DESC LIMIT 1) t ON true
  LEFT JOIN browser_task_results r ON r.id=t.result_id WHERE c.id=$1`,[candidateId])).rows[0];
 if(!row)return {state:'not_found'};
 if(!row.selected_asin)return {state:'not_selected'};
 if(!row.task_id)return {state:'not_collected'};
 if(row.input_version!==row.current_input||row.settings_version!==row.current_settings)return {state:'stale'};
 if(row.state!=='completed')return {state:row.state==='cancelled'||!row.expires_at||row.expires_at.getTime()<=Date.now()?'waiting':'collecting'};
 if(!row.receipt_id||!row.body_ciphertext||!row.body_sha256)return {state:'unavailable'};
 const raw:unknown=JSON.parse(decryptSecret(row.body_ciphertext,key,'browser-task-result:'+row.receipt_id).toString('utf8'));
 if(exactPayloadHash(raw)!==row.body_sha256)return {state:'unavailable'};
 const parsed=amazonPackageObservationSchema.safeParse(raw);
 if(!parsed.success)return {state:'unavailable'};
 const source=parsed.data;
 if(source.asin!==row.selected_asin)return {state:'stale'};
 if(!source.productEvidence)return {state:'legacy'};
 const excerpts=selectAiProductExcerpts(source.asin,source.productEvidence);
 const reference=aiProductSourceReferenceSchema.parse({version:1,receiptId:row.receipt_id,bodySha256:row.body_sha256,
  asin:source.asin,inputVersion:row.current_input,settingsVersion:row.current_settings,
  fragments:excerpts.map(({ref,kind,text})=>({ref,kind,sha256:exactPayloadHash({ref,kind,text})})),
 });
 return {state:'captured',reference,excerpts,view:{state:'captured',asin:source.asin,observedAt:source.observedAt,
  sourcePageUrl:'https://www.amazon.com/dp/'+source.asin,productEvidence:source.productEvidence}};
}

export async function resolveAiProductSource(pool:Pick<Pool,'query'>,candidateId:string,reference:AiProductSourceReference,key:Buffer):Promise<readonly AiProductExcerpt[]|null>{
 const current=await readProductSource(pool,candidateId,key);
 return current.state==='captured'&&exactPayloadHash(current.reference)===exactPayloadHash(reference)?current.excerpts:null;
}
