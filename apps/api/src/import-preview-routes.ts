import type { FastifyInstance } from 'fastify';
import { ImportInputError, readImportUpload } from './import-input.ts';

export function registerImportPreviewRoutes(app:FastifyInstance){
  app.post('/api/imports/preview',async(request,reply)=>{
    try{
      const {parsed}=await readImportUpload(request);
      return {sha256:parsed.sha256,headers:parsed.headers,mapping:parsed.mapping,validCount:parsed.validCount,totalRows:parsed.rows.length,
        headerError:parsed.headerError,samples:parsed.rows.slice(0,5).map(({rowNumber,raw,values,error})=>({rowNumber,raw,values,error})),
        issues:parsed.rows.filter(row=>row.error!==null).slice(0,10).map(row=>({rowNumber:row.rowNumber,error:row.error}))};
    }catch(error){if(error instanceof ImportInputError)return reply.status(error.status).send({code:error.code});throw error;}
  });
}
