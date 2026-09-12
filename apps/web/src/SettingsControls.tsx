import {
  settingField,
  settingLabel,
  settingValue,
  settingsFields,
  type EditableSettingsKey,
  type SettingsDraft,
} from "./settings-fields.tsx";
import { useLocale } from "./ui.tsx";

export function SettingsFields({
  group,
  current,
  draft,
  errors,
  disabled,
  onChange,
}: {
  group: "criteria" | "niche" | "opportunity" | "operations";
  current: Record<string, unknown>;
  draft: SettingsDraft;
  errors: Partial<Record<EditableSettingsKey, "value" | "priceRange">>;
  disabled: boolean;
  onChange: (key: EditableSettingsKey, value: string) => void;
}) {
  const { t, language } = useLocale();
  return (
    <div className="settings-fields stack">
      {settingsFields
        .filter((field) => field.group === group)
        .map((field) => {
          const error = errors[field.key];
          const input = settingField(field.key);
          const id = `settings-${field.key}`;
          const errorId = `${id}-error`;
          return (
            <div className="field" key={field.key}>
              <label htmlFor={id}>{settingLabel(field.key, language)}</label>
              {input.kind === "boolean" ? (
                <select
                  id={id}
                  value={draft[field.key]}
                  onChange={(event) => onChange(field.key, event.target.value)}
                  disabled={disabled}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                >
                  <option value="false">{t("발송 안 함", "Disabled")}</option>
                  <option value="true">
                    {t("매일 아침 요약 발송", "Send each morning")}
                  </option>
                </select>
              ) : (
                <input
                  id={id}
                  type={
                    input.kind === "time"
                      ? "time"
                      : input.kind === "email"
                        ? "email"
                        : "text"
                  }
                  inputMode={
                    input.kind === "email"
                      ? "email"
                      : input.kind === "integer"
                        ? "numeric"
                        : "decimal"
                  }
                  value={draft[field.key]}
                  onChange={(event) => onChange(field.key, event.target.value)}
                  disabled={disabled}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                />
              )}
              {field.key === "summaryEmailEnabled" && (
                <p className="muted">
                  {t(
                    "승인하면 다음 요약부터 후보·근거·탈락 사유·승인 대기를 이 주소로 보냅니다. 승인된 업무 메일 연결이 필요합니다.",
                    "After approval, new summaries send candidates, evidence, rejection reasons and pending approvals to this address. An approved work mailbox is required.",
                  )}
                </p>
              )}
              {String(
                current[field.key] ?? (input.kind === "boolean" ? false : ""),
              ) !== draft[field.key] && (
                <p className="muted">
                  {t("현재 적용", "Currently applied")}:{" "}
                  {input.kind === "boolean" ? settingValue(current[field.key] === true ? "true" : "false",field.key,language) : current[field.key] == null
                    ? t("미확인", "Unknown")
                    : settingValue(String(current[field.key]), field.key)}
                </p>
              )}
              {error && (
                <p className="muted" id={errorId} role="alert">
                  {error === "priceRange"
                    ? t(
                        "최저 가격은 최고 가격보다 클 수 없습니다.",
                        "Minimum price cannot exceed maximum price.",
                      )
                    : input.kind === "email"
                      ? t(
                          "유효한 이메일 주소를 입력해 주세요. 발송을 켜려면 주소가 필요합니다.",
                          "Enter a valid email address. Enabling delivery requires a recipient.",
                        )
                      : t(
                          "허용된 숫자 범위 또는 시간 형식을 입력해 주세요.",
                          "Enter a value in the allowed range or time format.",
                        )}
                </p>
              )}
            </div>
          );
        })}
    </div>
  );
}

export function SettingsDiff({
  before,
  after,
}: {
  before: SettingsDraft;
  after: SettingsDraft;
}) {
  const { t, language } = useLocale();
  const changed = settingsFields.filter(
    (field) => before[field.key] !== after[field.key],
  );
  return (
    <div
      className="settings-diff stack"
      aria-label={t("변경 내용", "Proposed changes")}
    >
      <strong>{t("변경 내용", "Proposed changes")}</strong>
      <dl className="settings-values">
        {changed.map((field) => (
          <div key={field.key}>
            <dt>{settingLabel(field.key, language)}</dt>
            <dd>
              {settingValue(before[field.key], field.key, language)} →{" "}
              {settingValue(after[field.key], field.key, language)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
