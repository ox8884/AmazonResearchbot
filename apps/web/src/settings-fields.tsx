import { summaryMailConsentSchema } from "../../../packages/domain/src/summary-mail.ts";
export const editableSettingsKeys = [
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

export type EditableSettingsKey = (typeof editableSettingsKeys)[number];
export type SettingsDraft = Record<EditableSettingsKey, string>;
type FieldKind = "money" | "percent" | "integer" | "time" | "email" | "boolean";
type FieldGroup = "criteria" | "niche" | "opportunity" | "operations";
type SettingField = {
  key: EditableSettingsKey;
  group: FieldGroup;
  kind: FieldKind;
  min: number;
  max: number;
  label: { ko: string; en: string };
};

export const settingsFields = [
  { key: "summaryEmail", group: "operations", kind: "email", min: 0, max: 0, label: { ko: "아침 요약 받을 이메일", en: "Morning summary recipient" } },
  { key: "summaryEmailEnabled", group: "operations", kind: "boolean", min: 0, max: 0, label: { ko: "아침 요약 이메일 발송", en: "Email morning summaries" } },
  { key: "launchBudgetUsd", group: "criteria", kind: "money", min: 0.01, max: 10_000_000, label: { ko: "출시 현금 한도 (USD)", en: "Launch cash limit (USD)" } },
  { key: "marginBeforeAdsPct", group: "criteria", kind: "percent", min: 0, max: 100, label: { ko: "광고 전 마진 (%)", en: "Margin before ads (%)" } },
  { key: "marginAfterAdsPct", group: "criteria", kind: "percent", min: 0, max: 100, label: { ko: "광고 후 마진 (%)", en: "Margin after ads (%)" } },
  { key: "roiPct", group: "criteria", kind: "percent", min: 0, max: 100_000, label: { ko: "ROI (%)", en: "ROI (%)" } },
  { key: "topPriceMinUsd", group: "niche", kind: "money", min: 0, max: 1_000_000, label: { ko: "1위 가격 최저 (USD)", en: "Top price minimum (USD)" } },
  { key: "topPriceMaxUsd", group: "niche", kind: "money", min: 0, max: 1_000_000, label: { ko: "1위 가격 최고 (USD)", en: "Top price maximum (USD)" } },
  { key: "review700Max", group: "niche", kind: "integer", min: 0, max: 1_000_000, label: { ko: "리뷰 700+ 상품 최대", en: "Maximum 700+ review products" } },
  { key: "review2000HardFailCount", group: "niche", kind: "integer", min: 1, max: 1_000_000, label: { ko: "리뷰 2,000+ 탈락 수", en: "2,000+ review hard-fail count" } },
  { key: "passRulesRequired", group: "niche", kind: "integer", min: 1, max: 5, label: { ko: "필요한 통과 규칙", en: "Required rule passes" } },
  { key: "monthlyRevenueMinUsd", group: "opportunity", kind: "money", min: 0, max: 1_000_000_000, label: { ko: "월 매출 최소 (USD)", en: "Monthly revenue minimum (USD)" } },
  { key: "monthlyRevenueCompetitorCount", group: "opportunity", kind: "integer", min: 0, max: 1_000_000, label: { ko: "월 매출 기준 경쟁 상품 수", en: "Competitors meeting monthly revenue" } },
  { key: "shareTop1MustBeBelowPct", group: "opportunity", kind: "percent", min: 0, max: 100, label: { ko: "1위 점유율 상한 (%)", en: "Top-1 share ceiling (%)" } },
  { key: "shareTop3MustBeBelowPct", group: "opportunity", kind: "percent", min: 0, max: 100, label: { ko: "상위 3 점유율 상한 (%)", en: "Top-3 share ceiling (%)" } },
  { key: "firstPageSalesMinUsd", group: "opportunity", kind: "money", min: 0, max: 1_000_000_000, label: { ko: "첫 페이지 매출 최소 (USD)", en: "First-page sales minimum (USD)" } },
  { key: "summaryLocalTime", group: "operations", kind: "time", min: 0, max: 0, label: { ko: "아침 요약 시간", en: "Morning summary time" } },
  { key: "jsDailyWireCap", group: "operations", kind: "integer", min: 0, max: 100_000, label: { ko: "Jungle Scout 일일 호출 한도", en: "Jungle Scout daily call cap" } },
  { key: "productDatabaseMaxPages", group: "operations", kind: "integer", min: 1, max: 10_000, label: { ko: "공식 검색 최대 페이지", en: "Official search maximum pages" } },
] as const satisfies readonly SettingField[];

const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const integerPattern = /^(?:0|[1-9]\d*)$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function draftFromSnapshot(snapshot: Record<string, unknown>): SettingsDraft {
  const draft = {} as SettingsDraft;
  for (const key of editableSettingsKeys) {
    const value = snapshot[key];
    if(key === "summaryEmailEnabled"){draft[key] = value === true ? "true" : "false";continue;}
    draft[key] = typeof value === "string" || typeof value === "number" ? String(value) : "";
  }
  return draft;
}

export function changedSettings(draft: SettingsDraft, current: SettingsDraft): EditableSettingsKey[] {
  return editableSettingsKeys.filter((key) => draft[key] !== current[key]);
}

export function patchFromDraft(
  draft: SettingsDraft,
  current: SettingsDraft,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    changedSettings(draft, current).map((key) => {
      const value = draft[key];
      const kind=settingField(key).kind;
      return [key, kind === "boolean" ? value === "true" : kind === "email" ? value || null : kind === "integer" ? Number(value) : value];
    }),
  );
}

export function validateSettingsDraft(draft: SettingsDraft, current?: SettingsDraft): Partial<Record<EditableSettingsKey, "value" | "priceRange">> {
  const errors: Partial<Record<EditableSettingsKey, "value" | "priceRange">> = {};
  for (const field of settingsFields) {
    const value = draft[field.key];
    if (current && value === current[field.key]) continue;
    if(field.kind === "boolean") {if(!["true","false"].includes(value))errors[field.key]="value";continue;}
    if(field.kind === "email") {if((value!=="" || draft.summaryEmailEnabled === "true") && !summaryMailConsentSchema.shape.summaryEmail.safeParse(value).success)errors[field.key]="value";continue;}
    if (field.kind === "time") {
      if (!timePattern.test(value)) errors[field.key] = "value";
      continue;
    }
    const pattern = field.kind === "integer" ? integerPattern : decimalPattern;
    const number = Number(value);
    if (!pattern.test(value) || !Number.isFinite(number) || number < field.min || number > field.max) {
      errors[field.key] = "value";
    }
  }
  if (
    !errors.topPriceMinUsd &&
    !errors.topPriceMaxUsd &&
    Number(draft.topPriceMinUsd) > Number(draft.topPriceMaxUsd)
  ) {
    errors.topPriceMinUsd = "priceRange";
    errors.topPriceMaxUsd = "priceRange";
  }
  return errors;
}

export function settingField(key: EditableSettingsKey): SettingField {
  const field = settingsFields.find((candidate) => candidate.key === key);
  if (!field) throw new Error(`Unknown settings field: ${key}`);
  return field;
}

export function settingLabel(key: EditableSettingsKey, language: string): string {
  const label = settingField(key).label;
  return language === "ko" ? label.ko : label.en;
}

export function settingValue(value: string, key: EditableSettingsKey, language = "ko"): string {
  if(value.trim()==="")return language === "ko" ? "미확인" : "Unknown";
  const kind = settingField(key).kind;
  if (kind === "boolean") return value === "true" ? (language === "ko" ? "발송 사용" : "Enabled") : (language === "ko" ? "발송 안 함" : "Disabled");
  if (kind === "money") return `${value} USD`;
  if (kind === "percent") return `${value}%`;
  return value;
}
