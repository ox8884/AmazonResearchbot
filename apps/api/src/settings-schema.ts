import { z } from "zod";
import type { SettingsSnapshot } from "@forge-ops/domain";

const immutableSettingsKeys = ["marketplace", "currency", "timezone"] as const;
const editableSettingsKeys = [
  "launchBudgetUsd",
  "marginBeforeAdsPct",
  "marginAfterAdsPct",
  "roiPct",
  "summaryLocalTime",
  "summaryEmail",
  "summaryEmailEnabled",
  "review700Max",
  "review2000HardFailCount",
  "topPriceMinUsd",
  "topPriceMaxUsd",
  "monthlyRevenueMinUsd",
  "monthlyRevenueCompetitorCount",
  "passRulesRequired",
  "jsDailyWireCap",
  "productDatabaseMaxPages",
  "shareTop1MustBeBelowPct",
  "shareTop3MustBeBelowPct",
  "firstPageSalesMinUsd",
] as const;

function decimalString(min: number, max: number) {
  return z
    .string()
    .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/)
    .refine((value) => {
      const number = Number(value);
      return Number.isFinite(number) && number >= min && number <= max;
    });
}

function integer(min: number, max: number) {
  return z.number().int().min(min).max(max).finite();
}

const editableSettingsShape = {
  launchBudgetUsd: decimalString(0.01, 10_000_000),
  marginBeforeAdsPct: decimalString(0, 100),
  marginAfterAdsPct: decimalString(0, 100),
  roiPct: decimalString(0, 100_000),
  summaryLocalTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  summaryEmail: z.email().max(320).nullable().optional(),
  summaryEmailEnabled: z.boolean().optional(),
  review700Max: integer(0, 1_000_000),
  review2000HardFailCount: integer(1, 1_000_000),
  topPriceMinUsd: decimalString(0, 1_000_000),
  topPriceMaxUsd: decimalString(0, 1_000_000),
  monthlyRevenueMinUsd: decimalString(0, 1_000_000_000),
  monthlyRevenueCompetitorCount: integer(0, 1_000_000),
  passRulesRequired: integer(1, 5),
  jsDailyWireCap: integer(0, 100_000),
  productDatabaseMaxPages: integer(1, 10_000),
  shareTop1MustBeBelowPct: decimalString(0, 100),
  shareTop3MustBeBelowPct: decimalString(0, 100),
  firstPageSalesMinUsd: decimalString(0, 1_000_000_000),
};

const editableSettingsSchema = z.object(editableSettingsShape).strict();

export const settingsPatchSchema = editableSettingsSchema.partial().strict();

export const settingsBaselineSchema = z
  .object({
    marketplace: z.literal("us"),
    currency: z.literal("USD"),
    timezone: z.enum(["Asia/Seoul", "America/Chicago"]),
    researchStartLocalTime: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    supplierContactMode: z.literal("website").optional(),
    ...editableSettingsSchema.partial().shape,
  })
  .strict();

export const settingsSnapshotSchema = z
  .object({
    marketplace: z.literal("us"),
    currency: z.literal("USD"),
    timezone: z.enum(["Asia/Seoul", "America/Chicago"]),
    researchStartLocalTime: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    supplierContactMode: z.literal("website").optional(),
    ...editableSettingsShape,
  })
  .strict()
  .superRefine((settings, context) => {
    if(settings.summaryEmailEnabled === true && !settings.summaryEmail){
      context.addIssue({code:"custom",path:["summaryEmail"],message:"SUMMARY_RECIPIENT_REQUIRED"});
    }
    if (Number(settings.topPriceMinUsd) > Number(settings.topPriceMaxUsd)) {
      context.addIssue({
        code: "custom",
        path: ["topPriceMinUsd"],
        message: "TOP_PRICE_RANGE",
      });
    }
  });

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export type SettingsValidationCode =
  | "empty_patch"
  | "invalid_patch"
  | "invalid_after_settings"
  | "invalid_current_settings"
  | "protected_field"
  | "unknown_field";

export type SettingsChangeParseResult =
  | { kind: "valid"; patch: SettingsPatch; after: SettingsSnapshot }
  | { kind: "invalid"; errors: readonly SettingsValidationCode[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(
  ...errors: SettingsValidationCode[]
): SettingsChangeParseResult {
  return { kind: "invalid", errors: [...new Set(errors)] };
}

export function parseSettingsChange(
  raw: unknown,
  current: unknown,
): SettingsChangeParseResult {
  const parsedCurrent = settingsBaselineSchema.safeParse(current);
  if (!parsedCurrent.success) return invalid("invalid_current_settings");
  if (!isRecord(raw)) return invalid("invalid_patch");

  const keys = Object.keys(raw);
  if (
    keys.some((key) =>
      immutableSettingsKeys.includes(
        key as (typeof immutableSettingsKeys)[number],
      ),
    )
  ) {
    return invalid("protected_field");
  }
  if (
    keys.some(
      (key) =>
        !editableSettingsKeys.includes(
          key as (typeof editableSettingsKeys)[number],
        ),
    )
  ) {
    return invalid("unknown_field");
  }
  if (keys.length === 0) return invalid("empty_patch");

  const parsedPatch = settingsPatchSchema.safeParse(raw);
  if (!parsedPatch.success) return invalid("invalid_patch");

  const after = { ...parsedCurrent.data, ...parsedPatch.data };
  const parsedAfter = settingsSnapshotSchema.safeParse(after);
  if (!parsedAfter.success) return invalid("invalid_after_settings");

  return { kind: "valid", patch: parsedPatch.data, after: parsedAfter.data };
}
