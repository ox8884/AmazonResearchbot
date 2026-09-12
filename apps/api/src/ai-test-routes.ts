import { recoverOverdueAiExecutions } from "@forge-ops/db";
import { executeApprovedSyntheticAiTest } from "@forge-ops/integrations/ai/execute";
import type { AiTransport } from "@forge-ops/integrations/ai/transport";
import type { FastifyInstance } from "fastify";
import type { Pool } from "@forge-ops/db";
import { z } from "zod";
import { aiTestApprovalSchema,aiTestRequestSchema } from "@forge-ops/domain";
import { proposeAiTest } from "./ai-test-service.ts";
const paramsSchema=z.object({id:z.uuid()}).strict();
export function registerAiTestRoutes(app:FastifyInstance,pool:Pool,options:{transport:AiTransport;encryptionKey:Buffer}){
  app.post('/api/custom-ai/:id/test-proposals',async(request,reply)=>{
    const params=paramsSchema.safeParse(request.params),input=aiTestRequestSchema.safeParse(request.body);
    if(!params.success||!input.success)return reply.status(400).send({code:'INVALID_AI_TEST'});
    if(!('userId' in request)||typeof request.userId!=='string')return reply.status(401).send({code:'UNAUTHENTICATED'});
    const db=await pool.connect();
    try{
      await db.query('BEGIN');
      const result=await proposeAiTest(db,request.userId,params.data.id,input.data.version,input.data.role);
      await db.query('COMMIT');
      if(result.kind==='blocked')return reply.status(result.code==='NOT_FOUND'?404:result.code==='PROFILE_CHANGED'?409:400).send({code:result.code});
      return reply.status(result.kind==='created'?201:200).send({approvalId:result.approvalId,payload:result.payload});
    }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  });
  app.get('/api/custom-ai/:id/tests',async(request,reply)=>{
    await recoverOverdueAiExecutions(pool);
    const params=paramsSchema.safeParse(request.params);if(!params.success)return reply.status(400).send({code:'INVALID_AI_TEST'});
    const rows=await pool.query<{id:string;status:string;payload:unknown;created_at:Date}>("SELECT id,status,payload,created_at FROM approvals WHERE kind='provider_activation' AND payload->>'providerType'='custom_ai' AND payload->>'purpose'='test' AND payload->>'profileId'=$1 ORDER BY created_at DESC LIMIT 20",[params.data.id]);
    const operations=await pool.query<{id:string;state:string}>("SELECT id,state FROM ai_execution_operations WHERE grant_approval_id=ANY($1::uuid[])",[rows.rows.map(row=>row.id)]);
    return {tests:rows.rows.flatMap(row=>{const parsed=aiTestApprovalSchema.safeParse(row.payload);return parsed.success?[{id:row.id,status:row.status,payload:parsed.data,createdAt:row.created_at.toISOString(),execution:operations.rows.find(operation=>operation.id===parsed.data.operationId)??null}]:[];})};
  });
  app.post('/api/custom-ai/:id/tests/:approvalId/run',async(request,reply)=>{
    const params=z.object({id:z.uuid(),approvalId:z.uuid()}).strict().safeParse(request.params);
    if(!params.success||!z.object({}).strict().safeParse(request.body??{}).success)return reply.status(400).send({code:'INVALID_AI_TEST'});
    if(options.transport.kind==='disabled')return reply.status(409).send({code:'AI_TRANSPORT_DISABLED'});
    const found=await pool.query<{payload:unknown}>("SELECT payload FROM approvals WHERE id=$1 AND kind='provider_activation' AND status='approved'",[params.data.approvalId]);
    const grant=aiTestApprovalSchema.safeParse(found.rows[0]?.payload);
    if(!grant.success||grant.data.profileId!==params.data.id)return reply.status(409).send({code:'AI_TEST_NOT_APPROVED'});
    const result=await executeApprovedSyntheticAiTest(pool,{operationId:grant.data.operationId,grantApprovalId:params.data.approvalId,role:grant.data.role,mode:'test',encryptionKey:options.encryptionKey,createTransport:()=>options.transport});
    return {result};
  });

}
