import {searchRunSnapshotSchema} from '@forge-ops/domain';
import type {QueryConnection} from './rfq-state.ts';
export async function lockSearchExportContext(db:QueryConnection,runId:string,deviceId:string){
 const run=(await db.query<{id:string;saved_search_id:string;search_revision:number;snapshot:unknown;state:string;import_id:string|null}>(`
  SELECT r.id,r.saved_search_id,r.search_revision,r.snapshot,r.state,r.import_id
  FROM saved_search_runs r JOIN bridge_devices d ON d.owner_user_id=r.created_by
  WHERE r.id=$1 AND d.id=$2 FOR UPDATE OF r`,[runId,deviceId])).rows[0];
 if(!run||run.state!=='awaiting_csv'||run.import_id!==null)return null;
 const snapshot=searchRunSnapshotSchema.safeParse(run.snapshot);
 if(!snapshot.success||snapshot.data.id!==run.saved_search_id||snapshot.data.revision!==run.search_revision)return null;
 if(snapshot.data.filters.competition!==undefined||snapshot.data.filters.seasonality!==undefined)return null;
 return {id:run.id,snapshot:snapshot.data};
}
