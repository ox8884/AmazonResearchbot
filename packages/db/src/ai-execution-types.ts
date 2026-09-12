import type { CustomAiProviderConfig } from "@forge-ops/domain";

export type AiExecutionRole = CustomAiProviderConfig["roles"][number];
export type AiExecutionMode = "activation-approved-only" | "test";

export type AiApprovedProfile = {
  readonly id: string;
  readonly version: number;
  readonly keyRevision: number;
  readonly configFingerprint: string;
  readonly apiKeyCiphertext: string;
  readonly config: CustomAiProviderConfig;
};

export type AiExecutionPreparation =
  | {
      readonly kind: "dispatch_ready";
      readonly attemptId: string;
      readonly operationId: string;
      readonly profile: AiApprovedProfile;
      readonly reservedUsd: string;
      readonly budgetDay: string;
    }
  | { readonly kind: "already_handled"; readonly operationId: string }
  | { readonly kind: "no_provider"; readonly operationId: string }
  | { readonly kind: "price_unknown"; readonly operationId: string }
  | { readonly kind: "budget_blocked"; readonly operationId: string };

export type AiTestGrantCandidate = {
  readonly approvalId: string;
  readonly payload: unknown;
  readonly payloadHash: string;
  readonly profile: AiApprovedProfile;
};

export type AiReportedUsage =
  | { readonly known: false }
  | {
      readonly known: true;
      readonly inputTokens: number;
      readonly outputTokens: number;
    };

export type AiAttemptFinalState =
  | "succeeded"
  | "failed_dispatched"
  | "failed_non_dispatch"
  | "outcome_unknown";
