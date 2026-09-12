import type {QueryConnection} from './rfq-state.ts';

export type MarketContext={
 readonly id:string;readonly stage:'api_validation';readonly input_version:number;readonly settings_version:number;
 readonly market_query:string;readonly spec_id:null;readonly asin:null;
};
export async function lockMarketContext(db:QueryConnection,candidateId:string):Promise<MarketContext|null>{
 const row=(await db.query<MarketContext>(`
  SELECT c.id,c.stage,c.input_version,v.version AS settings_version,c.normalized_keyword AS market_query,NULL::uuid AS spec_id,NULL::text AS asin
  FROM candidates c JOIN LATERAL(SELECT version FROM settings_versions ORDER BY version DESC LIMIT 1) v ON true
  WHERE c.id=$1 AND c.marketplace='us' AND c.stage='api_validation'
   AND length(c.normalized_keyword) BETWEEN 1 AND 500 FOR UPDATE OF c`,[candidateId])).rows[0];
 return row??null;
}
