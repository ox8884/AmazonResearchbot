import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {SUBSCRIPTION_PROVIDERS,subscriptionCapabilities,requireSubscriptionAuthorization,SubscriptionNotAuthorized} from '@forge-ops/integrations/subscriptions/capabilities';
export function registerSubscriptionRoutes(app:FastifyInstance) {
  app.get('/api/subscriptions',async()=>({capabilities:subscriptionCapabilities}));
  app.post('/api/subscriptions/:provider/authorize',async(request,reply)=>{
    const parsed=z.object({provider:z.enum(SUBSCRIPTION_PROVIDERS)}).strict().safeParse(request.params);
    if(!parsed.success||!z.object({}).strict().safeParse(request.body??{}).success)
      return reply.status(400).send({code:'INVALID',message:'Invalid subscription request'});
    try{requireSubscriptionAuthorization(parsed.data.provider);}
    catch(error){
      if(error instanceof SubscriptionNotAuthorized)
        return reply.status(403).send({code:error.code,message:'Official authorization for this application is required'});
      throw error;
    }
  });
}
