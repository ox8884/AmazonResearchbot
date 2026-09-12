import type {QueryConnection} from '@forge-ops/db';
import {marketRiskOutcome,marketRiskMatchesSettings,readMarketRiskView,type SettingsSnapshot} from '@forge-ops/domain';

export async function currentOrderGoReady(db:QueryConnection,candidateId:string,settings:{readonly version:number;readonly snapshot:SettingsSnapshot}):Promise<boolean>{
 const result=await db.query<{passed:boolean;payload:unknown}>(`
  SELECT e.outcome='pass' AND NOT e.stale AS passed,e.payload
  FROM candidates c JOIN LATERAL (
   SELECT outcome,stale,payload FROM evaluations WHERE candidate_id=c.id AND kind='api_validation'
    AND settings_version=$2 AND payload->>'inputVersion'=c.input_version::text
   ORDER BY created_at DESC,id DESC LIMIT 1) e ON true
  WHERE c.id=$1 AND (SELECT max(version) FROM settings_versions)=$2`,[candidateId,settings.version]);
 const row=result.rows[0];if(row?.passed!==true)return false;
 const market=readMarketRiskView(row.payload);
 if(!market||marketRiskOutcome(market)!=='GO')return false;
 return marketRiskMatchesSettings(market,settings.snapshot);
}
