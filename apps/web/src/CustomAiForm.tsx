import { useState, type FormEvent } from "react";
import {
  aiRoles,
  CustomAiError,
  saveCustomAi,
  type CustomAiProfile,
} from "./custom-ai-api.ts";
import { AiRoutingFields } from "./AiRoutingFields.tsx";
import { useLocale } from "./ui.tsx";
export function CustomAiForm({
  profile,
  onSaved,
  onNew,
}: {
  profile: CustomAiProfile | null;
  onSaved: (p: CustomAiProfile) => void;
  onNew: () => void;
}) {
  const { t } = useLocale(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget),
      value = (k: string) => String(f.get(k) ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      const r = await saveCustomAi({
        ...(profile ? { id: profile.id } : {}),
        version: profile?.version ?? 0,
        name: value("name"),
        baseUrl: value("baseUrl"),
        model: value("model"),
        dailyBudgetUsd: value("dailyBudgetUsd"),
        apiKey: value("apiKey"),
        roles: aiRoles.filter((role) => f.getAll("roles").includes(role)),
        priority: Number(value("priority")),
        inputUsdPerMillion: value("inputUsdPerMillion") || null,
        outputUsdPerMillion: value("outputUsdPerMillion") || null,
        maxInputTokens: Number(value("maxInputTokens")),
        maxOutputTokens: Number(value("maxOutputTokens")),
        retentionPolicyUrl: value("retentionPolicyUrl") || null,
      });
      onSaved(r.profile);
    } catch (e) {
      setError(
        e instanceof CustomAiError && e.code === "PROFILE_CHANGED"
          ? t(
              "다른 화면에서 설정이 바뀌었습니다. 페이지를 새로고친 뒤 다시 편집해 주세요.",
              "Settings changed elsewhere. Reload the page before editing again.",
            )
          : t(
              "저장하지 못했어요. 주소·모델·금액을 확인해 주세요. 입력은 유지됩니다.",
              "Could not save. Check the address, model, and budget. Your entries are preserved.",
            ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="sourcing-form stack" onSubmit={submit}>
      <h2>
        {profile
          ? t("AI 연결 편집", "Edit AI connection")
          : t("AI 연결 추가", "Add AI connection")}
      </h2>
      <fieldset className="form-grid" disabled={busy}>
        <div className="field">
          <label htmlFor="ai-name">{t("표시 이름", "Display name")}</label>
          <input
            id="ai-name"
            name="name"
            defaultValue={profile?.name ?? ""}
            required
            maxLength={120}
          />
        </div>
        <div className="field">
          <label htmlFor="ai-model">{t("모델 이름", "Model name")}</label>
          <input
            id="ai-model"
            name="model"
            defaultValue={profile?.model ?? ""}
            required
            maxLength={200}
          />
        </div>
        <div className="field full-width">
          <label htmlFor="ai-url">
            {t("OpenAI 호환 API 기본 주소", "OpenAI-compatible API base URL")}
          </label>
          <input
            id="ai-url"
            name="baseUrl"
            type="url"
            placeholder="https://provider.example/v1"
            defaultValue={profile?.baseUrl ?? ""}
            required
            maxLength={2000}
          />
          <p className="muted">
            {t(
              "HTTPS 주소만 저장할 수 있어요. 로그인 정보나 키를 주소에 넣지 마세요.",
              "Use an HTTPS address without credentials or API keys in the URL.",
            )}
          </p>
        </div>
        <div className="field">
          <label htmlFor="ai-key">{t("API 키", "API key")}</label>
          <input
            id="ai-key"
            name="apiKey"
            type="password"
            autoComplete="new-password"
            maxLength={8000}
          />
          <p className="muted">
            {profile?.hasKey
              ? t(
                  `키 설정됨 · ••••${profile.keyLast4 ?? ""}. 비우면 기존 키를 유지합니다.`,
                  `Key saved · ••••${profile.keyLast4 ?? ""}. Leave blank to keep it.`,
                )
              : t(
                  "키는 암호화해 저장하며 다시 표시하지 않습니다. 나중에 입력해도 됩니다.",
                  "Keys are encrypted and never shown again. You can add one later.",
                )}
          </p>
        </div>
        <div className="field">
          <label htmlFor="ai-budget">
            {t("일일 비용 상한 (USD)", "Daily spending cap (USD)")}
          </label>
          <input
            id="ai-budget"
            name="dailyBudgetUsd"
            inputMode="decimal"
            pattern="(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,2})?"
            defaultValue={profile?.dailyBudgetUsd ?? "0.00"}
            required
          />
          <p className="muted">
            {t(
              "사용 승인 전에는 금액과 관계없이 호출하지 않습니다.",
              "No calls are made before activation approval, regardless of this value.",
            )}
          </p>
        </div>
        <AiRoutingFields profile={profile} />
      </fieldset>
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        <button className="btn btn-primary" disabled={busy}>
          {busy
            ? t("저장 중", "Saving")
            : t("연결 설정 저장", "Save connection settings")}
        </button>
        {profile && (
          <button
            className="btn btn-secondary"
            type="button"
            disabled={busy}
            onClick={onNew}
          >
            {t("다른 AI 추가", "Add another AI")}
          </button>
        )}
      </div>
    </form>
  );
}
