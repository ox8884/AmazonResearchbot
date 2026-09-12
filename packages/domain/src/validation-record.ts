import {z} from 'zod';
import type {CandidateValidationView} from './validation-view.ts';
import {readMarketRiskView} from './market-risk-view.ts';
const unknownEvidence=z.object({kind:z.literal('unknown'),value:z.null(),sourceId:z.string().nullable(),observedAt:z.string().nullable(),reason:z.string()});
const origin={sourceId:z.string().min(1),observedAt:z.iso.datetime({offset:true})};
const evidence=<S extends z.ZodType>(value:S)=>z.union([z.object({kind:z.enum(['measured','estimate','quote']),value,...origin}),unknownEvidence]);
const inputSchema=z.object({
  review700Count:evidence(z.number().int().nonnegative()),review2000Count:evidence(z.number().int().nonnegative()),
  topPriceUsd:evidence(z.string()),monthlyRevenueCompetitorCount:evidence(z.number().int().nonnegative()),
  standardSize:evidence(z.boolean()),differentiation:evidence(z.boolean()),
});
const assessmentSchema=z.object({
  rules:z.array(z.object({id:z.enum(['review_barrier','top_price','monthly_revenue_competitors','standard_size','differentiation']),status:z.enum(['pass','fail','unknown']),sourceId:z.string().nullable(),detail:z.string()})).length(5).refine(rows=>new Set(rows.map(r=>r.id)).size===5),
  hardFail:z.boolean(),outcome:z.enum(['pass','reject','hold']),
});
const payloadSchema=z.object({inputVersion:z.number().int().positive().optional(),assessment:assessmentSchema,input:inputSchema.optional(),sourceIds:z.array(z.string()).optional(),evidenceBlock:z.string().nullable().optional()});
export type ValidationRow={candidate_id:string;settings_version:number;kind:'niche'|'api_validation';outcome:string;payload:unknown;stale:boolean;created_at:Date};
export function validationView(row:ValidationRow|undefined,inputVersion:number,currentVersion:number|null):CandidateValidationView {
  const empty:CandidateValidationView={phase:null,status:'unconfirmed',settingsVersion:null,evaluatedAt:null,input:null,rules:[],sourceCount:null,evidenceBlock:null};
  if(!row)return empty;
  const legacy=assessmentSchema.safeParse(row.payload);
  const parsed=payloadSchema.safeParse(legacy.success?{assessment:legacy.data}:row.payload);
  const outcome=z.enum(['pass','reject','hold']).safeParse(row.outcome);
  if(!parsed.success||!outcome.success)return empty;
  const stale=row.stale||row.settings_version!==currentVersion||(parsed.data.inputVersion??1)!==inputVersion;
  return {phase:row.kind==='niche'?'screening':'api_validation',status:stale?'stale':outcome.data,settingsVersion:row.settings_version,evaluatedAt:row.created_at.toISOString(),input:parsed.data.input??null,rules:parsed.data.assessment.rules,sourceCount:parsed.data.sourceIds?.length??null,evidenceBlock:parsed.data.evidenceBlock??null,marketRisk:row.kind==='api_validation'?readMarketRiskView(row.payload):null};
}
