import type {NicheInput,RuleId,RuleResult} from './niche.ts';
import type {MarketRiskView} from './market-risk-view.ts';
export const NICHE_RULE_LABELS: Readonly<Record<RuleId,readonly [string,string]>> = {
  review_barrier:['리뷰 장벽','Review competition'],
  top_price:['1위 가격','Top product price'],
  monthly_revenue_competitors:['매출 조건','Revenue requirement'],
  standard_size:['규격 확인','Standard size'],
  differentiation:['차별화 근거','Differentiation evidence'],
};
export type CandidateValidationView = {
  readonly phase:'screening'|'api_validation'|null;
  readonly status:'unconfirmed'|'pass'|'reject'|'hold'|'stale';
  readonly settingsVersion:number|null;
  readonly evaluatedAt:string|null;
  readonly input:NicheInput|null;
  readonly rules:readonly RuleResult[];
  readonly sourceCount:number|null;
  readonly evidenceBlock:string|null;
  readonly marketRisk?:MarketRiskView|null;
};
