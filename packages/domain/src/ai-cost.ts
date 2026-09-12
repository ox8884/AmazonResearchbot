import { Decimal } from "decimal.js";
import type { CustomAiProviderConfig } from "./ai-provider.ts";
type AiCostBasis = Pick<CustomAiProviderConfig,
  "inputUsdPerMillion" | "outputUsdPerMillion" | "maxInputTokens" | "maxOutputTokens"
>;
export function maximumAiRequestCostUsd(basis: AiCostBasis): string | null {
  if (basis.inputUsdPerMillion == null || basis.outputUsdPerMillion == null) return null;
  if (!Number.isSafeInteger(basis.maxInputTokens) || basis.maxInputTokens <= 0 ||
      !Number.isSafeInteger(basis.maxOutputTokens) || basis.maxOutputTokens <= 0) return null;
  const cost = new Decimal(basis.inputUsdPerMillion).times(basis.maxInputTokens)
    .plus(new Decimal(basis.outputUsdPerMillion).times(basis.maxOutputTokens))
    .dividedBy(1_000_000);
  if (!cost.isFinite() || cost.isNegative()) return null;
  return cost.toDecimalPlaces(6, Decimal.ROUND_CEIL).toFixed(6);
}
