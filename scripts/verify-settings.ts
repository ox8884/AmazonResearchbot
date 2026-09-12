import { INITIAL_SETTINGS } from "@forge-ops/domain";
import {
  parseSettingsChange,
  settingsPatchSchema,
  settingsSnapshotSchema,
} from "../apps/api/src/settings-schema.ts";
import {
  changedSettings,
  draftFromSnapshot,
  editableSettingsKeys,
  patchFromDraft,
  validateSettingsDraft,
} from "../apps/web/src/settings-fields.tsx";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectInvalid(
  raw: unknown,
  expected: string,
  scenario: string,
): void {
  const result = parseSettingsChange(raw, INITIAL_SETTINGS);
  assert(result.kind === "invalid", `${scenario}: expected invalid`);
  assert(result.errors.includes(expected as never), `${scenario}: expected ${expected}`);
}

// Given a persisted settings snapshot, when every field satisfies its contract, then full validation succeeds.
const full = settingsSnapshotSchema.safeParse(INITIAL_SETTINGS);
assert(full.success, "initial snapshot must validate");

// Given an editable patch, when it changes a money string and summary time, then it returns a merged after snapshot.
const validPartial = parseSettingsChange(
  { launchBudgetUsd: "2500.50", summaryLocalTime: "09:15" },
  INITIAL_SETTINGS,
);
assert(validPartial.kind === "valid", "partial change must validate");
assert(validPartial.patch.launchBudgetUsd === "2500.50", "partial patch keeps money as a string");
assert(validPartial.after.launchBudgetUsd === "2500.50", "after applies launch budget");
assert(validPartial.after.summaryLocalTime === "09:15", "after applies summary time");
assert(validPartial.after.marketplace === "us", "after preserves marketplace");

// Given a strict patch boundary, when an unknown field or an immutable field arrives, then it is rejected.
expectInvalid({ launchBudgetUsd: "2500", unexpected: true }, "unknown_field", "extra key");
expectInvalid({ marketplace: "ca" }, "protected_field", "protected marketplace");
expectInvalid({ currency: "CAD" }, "protected_field", "protected currency");
assert(!settingsPatchSchema.safeParse({ timezone: "UTC" }).success, "patch schema rejects immutable timezone");

// Given bounded numerical criteria, when values are negative, out of range, or non-integers, then they are rejected.
expectInvalid({ launchBudgetUsd: "-1" }, "invalid_patch", "negative launch budget");
expectInvalid({ marginAfterAdsPct: "101" }, "invalid_patch", "margin over 100");
expectInvalid({ shareTop1MustBeBelowPct: "101" }, "invalid_patch", "share over 100");
expectInvalid({ roiPct: "-0.1" }, "invalid_patch", "negative roi");
expectInvalid({ jsDailyWireCap: -1 }, "invalid_patch", "negative wire cap");
expectInvalid({ productDatabaseMaxPages: 1.5 }, "invalid_patch", "fractional pages");
expectInvalid({ passRulesRequired: 6 }, "invalid_patch", "pass rule upper bound");
expectInvalid({ review2000HardFailCount: 0 }, "invalid_patch", "hard fail count lower bound");
expectInvalid({ summaryLocalTime: "24:00" }, "invalid_patch", "summary time range");

// Given a price range patch, when min price exceeds max price after merge, then it is rejected.
expectInvalid({ topPriceMinUsd: "81" }, "invalid_after_settings", "cross-field price range");

const uiCurrent = draftFromSnapshot(INITIAL_SETTINGS);
const uiDraft = { ...uiCurrent, launchBudgetUsd: "2500.50", summaryLocalTime: "09:15" };
const expectedEditableKeys = Object.keys(settingsPatchSchema.shape);
assert(
  JSON.stringify(editableSettingsKeys) === JSON.stringify(expectedEditableKeys),
  "UI metadata must cover every and only field accepted by the settings patch API",
);
assert(changedSettings(uiDraft, uiCurrent).length === 2, "UI tracks two changed fields");
assert(
  JSON.stringify(patchFromDraft(uiDraft, uiCurrent)) ===
    JSON.stringify({ launchBudgetUsd: "2500.50", summaryLocalTime: "09:15" }),
  "UI patch preserves money and time strings",
);
assert(
  validateSettingsDraft({ ...uiCurrent, topPriceMinUsd: "81" }).topPriceMinUsd === "priceRange",
  "UI blocks an invalid price range before proposal",
);

const fullUiDraft = {
  ...uiCurrent,
  launchBudgetUsd: "2500.50",
  marginBeforeAdsPct: "36",
  marginAfterAdsPct: "34",
  roiPct: "151",
  summaryLocalTime: "09:15",
  summaryEmail: "jay@fixture.invalid",
  summaryEmailEnabled: "true",
  review700Max: "4",
  review2000HardFailCount: "3",
  topPriceMinUsd: "18",
  topPriceMaxUsd: "81",
  monthlyRevenueMinUsd: "9000",
  monthlyRevenueCompetitorCount: "6",
  passRulesRequired: "5",
  jsDailyWireCap: "1",
  productDatabaseMaxPages: "4",
  shareTop1MustBeBelowPct: "34",
  shareTop3MustBeBelowPct: "54",
  firstPageSalesMinUsd: "400000",
};
const fullUiPatch = patchFromDraft(fullUiDraft, uiCurrent);
const fullUiChange = parseSettingsChange(fullUiPatch, INITIAL_SETTINGS);
assert(validateSettingsDraft(fullUiDraft) && Object.keys(validateSettingsDraft(fullUiDraft)).length === 0, "full UI draft is valid");
assert(
  JSON.stringify(Object.keys(fullUiPatch)) === JSON.stringify(editableSettingsKeys),
  "full UI patch contains every editable field",
);
assert(typeof fullUiPatch.review700Max === "number", "UI serializes count fields as integers");
assert(fullUiChange.kind === "valid", "full UI patch must validate at the API boundary");
assert(fullUiChange.after.firstPageSalesMinUsd === "400000", "full UI after snapshot keeps money strings");

const { shareTop1MustBeBelowPct,shareTop3MustBeBelowPct,firstPageSalesMinUsd,...legacy } = INITIAL_SETTINGS;
const legacyNoRepair=parseSettingsChange({roiPct:"175"},legacy);
assert(legacyNoRepair.kind==="invalid","Missing criteria must not silently receive defaults");
const legacyRepair=parseSettingsChange({shareTop1MustBeBelowPct,shareTop3MustBeBelowPct,firstPageSalesMinUsd},legacy);
assert(legacyRepair.kind==="valid","Explicit missing criteria proposal must be possible");
assert(!('shareTop1MustBeBelowPct' in legacy),"Original legacy snapshot must remain unchanged");

console.log(
  JSON.stringify(
    {
      scenario: "settings-schema",
      fullSnapshot: full.success,
      partialChange: validPartial.kind,
      editableUiFields: editableSettingsKeys.length,
      fullUiPatch: Object.keys(fullUiPatch).length,
      uiDraftValidation: true,
      rejectionGates: [
        "extra-key",
        "protected-field",
        "negative",
        "range",
        "cross-field",
      ],
      networkCalls: 0,
      databaseWrites: 0,
    },
    null,
    2,
  ),
);


const texas = {...INITIAL_SETTINGS, timezone:'America/Chicago', researchStartLocalTime:'03:00', summaryLocalTime:'07:30', summaryEmail:'operator@fixture.invalid', supplierContactMode:'website'};
const texasChange = parseSettingsChange({jsDailyWireCap:20},texas);
assert(texasChange.kind==='valid','Texas settings accept a daily cap change');
assert(texasChange.after.jsDailyWireCap===20&&texasChange.after.timezone==='America/Chicago','Cap changes preserve Texas time zone');
assert(texasChange.after.researchStartLocalTime==='03:00'&&texasChange.after.summaryEmail==='operator@fixture.invalid','Schedule and recipient survive other settings edits');
assert(!settingsSnapshotSchema.safeParse({...texas,researchStartLocalTime:'25:00'}).success,'Reject invalid research start time');
console.log('PASS: Texas schedule and recipient preserved through cap changes.');

const summaryDraft = draftFromSnapshot(INITIAL_SETTINGS);
assert(summaryDraft.summaryEmailEnabled === 'false', 'Missing consent is visibly disabled');
const mailDraft = {...summaryDraft, summaryEmail:'jay@fixture.invalid',summaryEmailEnabled:'true'};
assert(Object.keys(validateSettingsDraft(mailDraft)).length===0,'Valid summary mail settings must pass');
const mailPatch=patchFromDraft(mailDraft,summaryDraft);
assert(mailPatch.summaryEmailEnabled===true && mailPatch.summaryEmail==='jay@fixture.invalid','Mail consent uses a boolean and exact recipient');
assert(validateSettingsDraft({...mailDraft,summaryEmail:''}).summaryEmail==='value','Enabled summary requires a recipient');
assert(patchFromDraft({...mailDraft,summaryEmail:'',summaryEmailEnabled:'false'},mailDraft).summaryEmail===null,'Clearing the recipient is explicit');
