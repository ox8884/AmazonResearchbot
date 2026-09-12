import {lockSearchExportContext,type QueryConnection} from '@forge-ops/db';
import {browserTaskSchema} from '@forge-ops/domain';
import type {BrowserTaskRow} from './browser-task-store.ts';

export async function lockSearchTaskSource(db:QueryConnection,task:BrowserTaskRow){
 if(task.search_run_id===null||task.task_kind!=='saved_search_export')return null;
 const run=await lockSearchExportContext(db,task.search_run_id,task.device_id);
 if(!run)return null;
 const payload=browserTaskSchema.parse(JSON.parse(Buffer.from(task.envelope.payload,'base64url').toString('utf8'))),request=payload.request;
 if(request.kind!=='saved_search_export'||payload.id!==task.id||payload.deviceId!==task.device_id||request.searchRunId!==run.id||request.searchId!==run.snapshot.id||request.revision!==run.snapshot.revision)return null;
 for(const key of ['priceMinUsd','priceMaxUsd','monthlySearchMin','competition','seasonality','competitionMax','seasonalityMax'] as const){
  if(request.filters[key]!==run.snapshot.filters[key])return null;
 }
 return {run,payload,request};
}
