import {z} from 'zod';
import {isIsoDay} from './iso-day.ts';

export const ORDER_RISK_KEYS=['brand','returns','selling'] as const;
export type OrderRiskKey=(typeof ORDER_RISK_KEYS)[number];
export const orderRiskStatusSchema=z.enum(['unknown','clear','risk']);
const check=z.object({status:orderRiskStatusSchema,source:z.string().trim().max(2000),observedOn:z.string().refine(isIsoDay).nullable()}).strict().refine(value=>value.status==='unknown'||(value.source.length>0&&value.observedOn!==null),{message:'A reviewed risk needs its source and date'});
const checks=z.object({brand:check,returns:check,selling:check}).strict();
export const orderRiskReviewSchema=z.object({kind:z.literal('operator_record'),scope:z.object({inputVersion:z.number().int().positive(),representativeAsin:z.string().regex(/^[A-Z0-9]{10}$/).nullable(),specId:z.string().uuid()}).strict(),checks,recordedOn:z.string().refine(isIsoDay)}).strict();
export type OrderRiskReview=z.infer<typeof orderRiskReviewSchema>;
export function assessOrderRiskReview(value:unknown):'GO'|'CAUTION'|'HOLD'{
 const parsed=orderRiskReviewSchema.safeParse(value);if(!parsed.success)return 'HOLD';
 const statuses=ORDER_RISK_KEYS.map(key=>parsed.data.checks[key].status);
 if(statuses.includes('unknown'))return 'HOLD';if(statuses.includes('risk'))return 'CAUTION';return 'GO';
}
