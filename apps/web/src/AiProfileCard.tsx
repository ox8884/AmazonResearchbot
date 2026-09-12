import { AiTestPanel } from "./AiTestPanel.tsx";
import { maximumAiRequestCostUsd } from "../../../packages/domain/src/ai-cost.ts";
import { useMutation } from "@tanstack/react-query";
import {useState} from 'react';
import { approve } from "./api.ts";
import { rejectSettings } from "./settings-api.ts";
import {
  CustomAiError,
  disableAi,
  requestAiActivation,
  type CustomAiProfile,
} from "./custom-ai-api.ts";
import { aiRoleLabels } from "./AiRoutingFields.tsx";
import { useLocale } from "./ui.tsx";
export function AiProfileCard({
  profile: p,
  onEdit,
  onRefresh,
}: {
  profile: CustomAiProfile;
  onEdit: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { t, language } = useLocale();
  const requestCost = maximumAiRequestCostUsd(p);
  const [includeProductExcerpts,setIncludeProductExcerpts]=useState(false);
  const productRole=p.roles.some(role=>role==='niche_analysis'||role==='sourcing_analysis');
  const action = useMutation({
    mutationFn: async (kind: "request" | "approve" | "reject" | "disable") => {
      switch (kind) {
        case "request":
          return requestAiActivation(p,productRole&&includeProductExcerpts);
        case "disable":
          return disableAi(p);
        case "approve":
          if (!p.approvalId) throw new CustomAiError("PROFILE_CHANGED");
          await approve(p.approvalId);
          return;
        case "reject":
          if (!p.approvalId) throw new CustomAiError("PROFILE_CHANGED");
          await rejectSettings(p.approvalId);
          return;
      }
    },
    onSuccess: onRefresh,
  });
  const status = {
    draft: t("초안 · 비활성", "Draft · inactive"),
    pending_approval: t("사용 승인 대기", "Awaiting activation approval"),
    active: t(
      "사용 승인됨 · 연결 미확인",
      "Activation approved · connection unverified",
    ),
    disabled: t("사용 중지", "Disabled"),
  }[p.status];
  return (
    <section className="detail-section stack">
      <div className="connection-row">
        <div>
          <h3>{p.name}</h3>
          <p className="muted">
            {p.model} · v{p.version}
          </p>
        </div>
        <span
          className={`chip chip-${p.status === "pending_approval" ? "warn" : "unknown"}`}
        >
          {status}
        </span>
      </div>
      <dl className="settings-values">
        <div>
          <dt>{t("전송 대상", "Destination")}</dt>
          <dd>{p.baseUrl}</dd>
        </div>
        <div>
          <dt>{t("역할 · 우선순위", "Roles · priority")}</dt>
          <dd>
            {p.roles?.length
              ? p.roles
                  .map((r) => aiRoleLabels[r][language === "ko" ? 0 : 1])
                  .join(" · ")
              : t("역할 미지정", "No roles assigned")}{" "}
            · {p.priority ?? t("미확인", "Unknown")}
          </dd>
        </div>
        <div>
          <dt>{t("일일 한도", "Daily limit")}</dt>
          <dd>{p.dailyBudgetUsd} USD</dd>
        </div>
        <div>
          <dt>
            {t(
              "100만 토큰 단가 · 입력 / 출력",
              "Per million tokens · input / output",
            )}
          </dt>
          <dd>
            {p.inputUsdPerMillion ?? t("미확인", "Unknown")} /{" "}
            {p.outputUsdPerMillion ?? t("미확인", "Unknown")} USD
          </dd>
        </div>
        <div>
          <dt>
            {t(
              "요청당 토큰 상한 · 입력 / 출력",
              "Per-request token caps · input / output",
            )}
          </dt>
          <dd>
            {p.maxInputTokens ?? t("미확인", "Unknown")} /{" "}
            {p.maxOutputTokens ?? t("미확인", "Unknown")}
          </dd>
        </div>
        <div>
          <dt>{t("요청당 예상 최대 비용", "Estimated maximum cost per request")}</dt>
          <dd>{requestCost == null ? t("미확인", "Unknown") : `${requestCost} USD`}</dd>
        </div>
        <div>
          <dt>{t("API 키", "API key")}</dt>
          <dd>
            {p.hasKey
              ? `••••${p.keyLast4 ?? ""}`
              : t("미설정", "Not configured")}
          </dd>
        </div>
        <div>
          <dt>{t("데이터 보관 정책", "Data retention policy")}</dt>
          <dd>
            {p.retentionPolicyUrl ? (
              <>
                <a href={p.retentionPolicyUrl} target="_blank" rel="noreferrer">
                  {t("입력한 정책 주소 보기", "View entered policy URL")}
                </a>{" "}
                · {t("정책 내용 미검증", "Policy not verified")}
              </>
            ) : (
              t("미확인", "Unknown")
            )}
          </dd>
        </div>
      </dl>
      <p className="muted">
        {t(
          "전달 범위: 역할에 필요한 수치·비식별 사양·근거 참조. 연락처·브라우저 쿠키·전체 원문은 보내지 않습니다.",
          "Data scope: role-specific metrics, non-identifying specifications, and evidence references. Contacts, browser cookies, and complete source documents are excluded.",
        )}
      </p>
      {p.status === "pending_approval" && (
        <p className="banner">
          {t(
            "위 주소·모델·역할·비용 한도를 확인하고 사용 여부를 결정하세요. 설정을 수정하면 이 승인은 무효가 됩니다.",
            "Review the destination, model, roles, and spending limits before approval. Editing the settings invalidates this approval.",
          )}
        </p>
      )}
      {(p.status==='draft'||p.status==='disabled')&&productRole&&(
        <label className="check-label">
          <input type="checkbox" checked={includeProductExcerpts} disabled={action.isPending}
            onChange={event=>setIncludeProductExcerpts(event.target.checked)} />
          <span>{t('대표 상품 기능과 짧은 리뷰 발췌도 이 제공자에게 전달하도록 승인 요청','Request permission to send representative product features and short review excerpts to this provider')}</span>
        </label>
      )}
      {(p.status==='pending_approval'||p.status==='active')&&(
        <p className="banner">{p.productEvidenceScope==='short-excerpts-v1'
          ?t('추가 전달 범위: 대표 ASIN의 기능 문장 최대 6개와 귀속이 확인된 리뷰 최대 4개, 각각 최대 25단어. 작성자·프로필·전체 페이지와 연락처가 탐지된 문장은 제외합니다.','Additional data scope: up to 6 feature excerpts and 4 reviews tied to the representative ASIN, each limited to 25 words. Authors, profiles, full pages and sentences with detected contact details are excluded.')
          :t('상품 기능·리뷰 원문 발췌는 이 승인 범위에 포함되지 않습니다.','Product feature and review excerpts are outside this approval scope.')}</p>
      )}
      {action.isError && (
        <p className="banner" role="alert">
          {action.error instanceof CustomAiError &&
          action.error.code === "PROVIDER_CONFIG_REQUIRED"
            ? t(
                "역할·키·단가·일일 한도를 입력한 뒤 저장해 주세요.",
                "Save roles, a key, verified prices, and a daily budget first.",
              )
            : t(
                "처리하지 못했습니다. 현재 설정을 다시 불러와 확인해 주세요.",
                "Could not complete the action. Reload the current settings and review again.",
              )}
        </p>
      )}
      <div className="btn-row">
        <button
          className="btn btn-secondary"
          onClick={onEdit}
          disabled={action.isPending}
        >
          {t("편집", "Edit")}
        </button>
        {(p.status === "draft" || p.status === "disabled") && (
          <button
            className="btn btn-primary"
            disabled={action.isPending}
            onClick={() => action.mutate("request")}
          >
            {t("사용 승인 요청", "Request activation approval")}
          </button>
        )}
        {p.status === "pending_approval" && (
          <>
            <button
              className="btn btn-primary"
              disabled={action.isPending || !p.approvalId}
              onClick={() => action.mutate("approve")}
            >
              {t("이 설정 사용 승인", "Approve these settings")}
            </button>
            <button
              className="btn btn-secondary"
              disabled={action.isPending || !p.approvalId}
              onClick={() => action.mutate("reject")}
            >
              {t("거절", "Reject")}
            </button>
          </>
        )}
        {(p.status === "active" || p.status === "pending_approval") && (
          <button
            className="btn btn-secondary"
            disabled={action.isPending}
            onClick={() => action.mutate("disable")}
          >
            {t("사용 중지", "Disable")}
          </button>
        )}
        {action.isError && (
          <button
            className="text-btn"
            disabled={action.isPending}
            onClick={() => void onRefresh()}
          >
            {t("현재 설정 다시 불러오기", "Reload current settings")}
          </button>
        )}
      </div>
      <AiTestPanel profile={p} />
    </section>
  );
}
