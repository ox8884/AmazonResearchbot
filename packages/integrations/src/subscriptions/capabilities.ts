export const SUBSCRIPTION_PROVIDERS = ['chatgpt','grok'] as const;
export type SubscriptionProvider = typeof SUBSCRIPTION_PROVIDERS[number];
export type SubscriptionCapability = {
  readonly provider: SubscriptionProvider;
  readonly clientId: null;
  readonly allowedUse: null;
  readonly scopes: readonly string[];
  readonly officialEvidenceUrl: null;
  readonly verifiedAt: null;
  readonly status: 'not_authorized';
};
export const subscriptionCapabilities: readonly SubscriptionCapability[] = Object.freeze(
  SUBSCRIPTION_PROVIDERS.map(provider => Object.freeze({
    provider, clientId:null, allowedUse:null, scopes:Object.freeze([]),
    officialEvidenceUrl:null, verifiedAt:null, status:'not_authorized' as const,
  })),
);
export class SubscriptionNotAuthorized extends Error {
  readonly code='SUBSCRIPTION_NOT_AUTHORIZED';
  constructor(){super('Subscription use is not authorized for this application');}
}
export function requireSubscriptionAuthorization(_provider: SubscriptionProvider): never {
  throw new SubscriptionNotAuthorized();
}
