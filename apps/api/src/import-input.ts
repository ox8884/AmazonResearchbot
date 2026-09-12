import type { FastifyRequest } from 'fastify';
import { csvMappingSchema } from '@forge-ops/domain';
import { parseCsv } from '@forge-ops/integrations/jungle-scout/csv';

export class ImportInputError extends Error {
  constructor(readonly status:400|409|422,readonly code:string){super(code);}
}
export async function readImportUpload(request:FastifyRequest, requireReview=false) {
  const file=await request.file();
  if(!file)throw new ImportInputError(400,'NO_FILE');
  const bytes=await file.toBuffer();
  const field=(name:string)=>{
    const value=file.fields[name];
    if(value===undefined)return undefined;
    if(Array.isArray(value)||value.type!=='field'||typeof value.value!=='string')throw new ImportInputError(400,'INVALID_MAPPING');
    return value.value;
  };
  const rawMapping=field('mapping'),expected=field('expectedSha256');
  if(requireReview&&rawMapping!==undefined&&expected===undefined)throw new ImportInputError(400,'PREVIEW_REQUIRED');
  let mapping;
  if(rawMapping!==undefined){
    let value:unknown;try{value=JSON.parse(rawMapping);}catch{throw new ImportInputError(400,'INVALID_MAPPING');}
    const parsed=csvMappingSchema.safeParse(value);
    if(!parsed.success)throw new ImportInputError(400,'INVALID_MAPPING');
    mapping=parsed.data;
  }
  if(expected!==undefined&&!/^[a-f0-9]{64}$/.test(expected))throw new ImportInputError(400,'INVALID_PREVIEW');
  let parsed;
  try{parsed=await parseCsv(bytes,mapping);}catch{throw new ImportInputError(422,'INVALID_CSV');}
  if(expected!==undefined&&expected!==parsed.sha256)throw new ImportInputError(409,'FILE_CHANGED');
  return {file,bytes,parsed,mapped:rawMapping!==undefined};
}
