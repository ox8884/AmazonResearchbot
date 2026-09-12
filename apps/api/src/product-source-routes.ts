import type {FastifyInstance} from 'fastify';
import type {Pool} from '@forge-ops/db';
import {readProductSource} from '@forge-ops/integrations/amazon/product-source';
import {z} from 'zod';

export function registerProductSourceRoutes(app:FastifyInstance,pool:Pool,key:Buffer){
 app.get('/api/candidates/:id/product-source',async(request,reply)=>{
  const params=z.object({id:z.uuid()}).safeParse(request.params);
  if(!params.success)return reply.status(400).send({code:'INVALID_CANDIDATE'});
  const source=await readProductSource(pool,params.data.id,key);
  if(source.state==='not_found')return reply.status(404).send({code:'NOT_FOUND'});
  if(source.state==='unavailable')return reply.status(500).send({code:'PRODUCT_SOURCE_UNAVAILABLE'});
  return source.state==='captured'?source.view:{state:source.state};
 });
}
