import { aiRoles, type AiRole, type CustomAiProfile } from "./custom-ai-api.ts";
import { useLocale } from "./ui.tsx";
export const aiRoleLabels: Record<AiRole, readonly [string, string]> = {
  normalize: ["입력 정리", "Normalize inputs"],
  niche_analysis: ["니치 근거 분석", "Analyze niche evidence"],
  sourcing_analysis: ["소싱 근거 분석", "Analyze sourcing evidence"],
  rfq_draft: ["견적 요청 문장 작성", "Draft RFQ wording"],
};
export function AiRoutingFields({
  profile,
}: {
  profile: CustomAiProfile | null;
}) {
  const { t, language } = useLocale();
  return (
    <>
      <fieldset className="stack full-width">
        <legend>{t("담당 역할", "Assigned roles")}</legend>
        {aiRoles.map((role) => (
          <label className="check-label" key={role}>
            <input
              type="checkbox"
              name="roles"
              value={role}
              defaultChecked={profile?.roles?.includes(role) ?? false}
            />
            {aiRoleLabels[role][language === "ko" ? 0 : 1]}
          </label>
        ))}
        <p className="muted">
          {t(
            "AI는 근거 정리와 문장 작성을 돕습니다. 비용 계산·기준 변경·외부 연락은 맡기지 않습니다.",
            "AI helps organize evidence and draft wording. It does not calculate costs, change criteria, or send contacts.",
          )}
        </p>
      </fieldset>
      <div className="field full-width">
        <label htmlFor="ai-priority">
          {t("선택 우선순위 · 작은 숫자 우선", "Priority · lower number first")}
        </label>
        <input
          id="ai-priority"
          name="priority"
          type="number"
          min={0}
          max={100}
          step={1}
          defaultValue={profile?.priority ?? 0}
          required
        />
      </div>
      {(
        [
          [
            "inputUsdPerMillion",
            "입력 100만 토큰 단가 (USD)",
            "Input price per million tokens (USD)",
          ],
          [
            "outputUsdPerMillion",
            "출력 100만 토큰 단가 (USD)",
            "Output price per million tokens (USD)",
          ],
        ] as const
      ).map(([name, ko, en]) => (
        <div className="field" key={name}>
          <label htmlFor={`ai-${name}`}>{t(ko, en)}</label>
          <input
            id={`ai-${name}`}
            name={name}
            inputMode="decimal"
            defaultValue={profile?.[name] ?? ""}
            placeholder={t("미확인", "Unknown")}
          />
          <p className="muted">
            {t(
              "공식 단가를 확인해 입력하세요. 비워 두면 활성화할 수 없습니다.",
              "Enter the verified provider price. Leave unknown prices blank; activation will be blocked.",
            )}
          </p>
        </div>
      ))}
      {(
        [
          [
            "maxInputTokens",
            "요청당 최대 입력 토큰",
            "Maximum input tokens per request",
            1024,
          ],
          [
            "maxOutputTokens",
            "요청당 최대 출력 토큰",
            "Maximum output tokens per request",
            256,
          ],
        ] as const
      ).map(([name, ko, en, fallback]) => (
        <div className="field" key={name}>
          <label htmlFor={`ai-${name}`}>{t(ko, en)}</label>
          <input
            id={`ai-${name}`}
            name={name}
            type="number"
            min={1}
            max={name === "maxInputTokens" ? 131072 : 16384}
            step={1}
            defaultValue={profile?.[name] ?? fallback}
            required
          />
        </div>
      ))}
      <div className="field full-width">
        <label htmlFor="ai-retention">
          {t(
            "제공자 데이터 보관 정책 주소",
            "Provider data retention policy URL",
          )}
        </label>
        <input
          id="ai-retention"
          name="retentionPolicyUrl"
          type="url"
          maxLength={2000}
          defaultValue={profile?.retentionPolicyUrl ?? ""}
          placeholder="https://provider.example/privacy"
        />
        <p className="muted">
          {t(
            "주소를 저장해도 정책을 검증한 것은 아닙니다. 미입력 시 보관 정책 미확인으로 표시합니다.",
            "Saving a URL does not verify the policy. A missing URL is shown as unconfirmed.",
          )}
        </p>
      </div>
    </>
  );
}
