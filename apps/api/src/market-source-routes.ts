import type {FastifyInstance} from 'fastify';
import type {Pool} from '@forge-ops/db';
import {z} from 'zod';
import {observedListingPrice} from '@forge-ops/domain';
import {readMarketSource} from './market-source-store.ts';

export function registerMarketSourceRoutes(app:FastifyInstance,pool:Pool,key:Buffer){
 app.get('/api/candidates/:id/market-source',async(request,reply)=>{
  const parsed=z.object({id:z.uuid()}).safeParse(request.params);
  if(!parsed.success)return reply.status(400).send({code:'INVALID_CANDIDATE'});
  if(!(await pool.query('SELECT id FROM candidates WHERE id=$1',[parsed.data.id])).rowCount)return reply.status(404).send({code:'NOT_FOUND'});
  const source=await readMarketSource(pool,parsed.data.id,key);
  if(source.state!=='captured')return source;
  const {observation}=source;
  return {state:source.state,inputVersion:source.inputVersion,settingsVersion:source.settingsVersion,observedAt:observation.observedAt,
   query:observation.query,sourcePageUrl:observation.sourcePageUrl,coverage:observation.coverage,rangeText:observation.rangeText,
   slots:observation.slots.map(row=>({position:row.position,asin:row.asin,title:row.title,productUrl:row.productUrl,adStatus:row.adStatus,
    priceTexts:row.priceTexts,price:observedListingPrice(row.priceTexts,{sourceId:'browser-task-result:'+source.receiptId,observedAt:observation.observedAt})}))};
 });
}
