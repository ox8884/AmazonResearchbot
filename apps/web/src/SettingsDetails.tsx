import { SubscriptionConnections } from "./SubscriptionConnections.tsx";
import { WorkMailSettingsRow } from "./MailProfile.tsx";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import {
  type EditableSettingsKey,
  type SettingsDraft,
} from "./settings-fields.tsx";
import { SettingsFields } from "./SettingsControls.tsx";
import { Icon, useLocale } from "./ui.tsx";

export function Group({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <header>
        <h2>{title}</h2>
        <p className="muted">{description}</p>
      </header>
      <div className="settings-content">{children}</div>
    </section>
  );
}
export function SettingsDetails({
  snapshot,
  draft,
  errors,
  disabled,
  onChange,
}: {
  snapshot: Record<string, unknown>;
  draft: SettingsDraft;
  errors: Partial<Record<EditableSettingsKey, "value" | "priceRange">>;
  disabled: boolean;
  onChange: (key: EditableSettingsKey, value: string) => void;
}) {
  const { t, language, setLanguage } = useLocale();
  const researchTime = snapshot.researchStartLocalTime;
  const appliedCallCap = snapshot.jsDailyWireCap;
  const knownCallCap =
    typeof appliedCallCap === "number" &&
    Number.isSafeInteger(appliedCallCap) &&
    appliedCallCap >= 0;
  return (
    <>
      <Group
        title={t("판매 기준", "Selling criteria")}
        description={t(
          "모든 후보에 적용하는 기준",
          "Applies to every candidate",
        )}
      >
        <dl className="settings-values">
          <div>
            <dt>{t("시장 · 통화", "Market · currency")}</dt>
            <dd>Amazon US · USD</dd>
          </div>
        </dl>
        <SettingsFields
          group="criteria"
          current={snapshot}
          draft={draft}
          errors={errors}
          disabled={disabled}
          onChange={onChange}
        />
      </Group>
      <Group
        title={t("니치 규칙", "Niche rules")}
        description={t("확인된 근거로만 판단", "Decisions based on evidence")}
      >
        <SettingsFields
          group="niche"
          current={snapshot}
          draft={draft}
          errors={errors}
          disabled={disabled}
          onChange={onChange}
        />
        <p className="muted">
          {t(
            "미확인은 통과로 세지 않습니다.",
            "Unknowns do not count as passes.",
          )}
        </p>
      </Group>
      <Group
        title={t("시장 기회", "Market opportunity")}
        description={t(
          "매출과 점유율은 확인된 동일 모집단 근거로 판단",
          "Revenue and share require evidence from the same population",
        )}
      >
        <SettingsFields
          group="opportunity"
          current={snapshot}
          draft={draft}
          errors={errors}
          disabled={disabled}
          onChange={onChange}
        />
      </Group>
      <Group
        title={t("실행 한도·요약", "Execution limits & summary")}
        description={t(
          "새 승인 버전부터 다음 작업에 적용",
          "Applies to the next work after approval",
        )}
      >
        <dl className="settings-values">
          <div>
            <dt>{t("시간대", "Time zone")}</dt>
            <dd>{String(snapshot.timezone ?? t("미확인", "Unknown"))}</dd>
          </div>
          <div>
            <dt>{t("리서치 시작 · 현재 적용", "Research start · currently applied")}</dt>
            <dd>
              {typeof researchTime === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(researchTime)
                ? researchTime
                : t("미확인", "Unknown")}
            </dd>
          </div>
        </dl>
        <p className="muted">
          {t("아래 요약 시간은 위 시간대 기준입니다. 검색 페이지 한도는 상품·연관 키워드 검색에 각각 적용합니다.", "The summary time uses the time zone above. The page cap applies separately to product and related-keyword searches.")}
        </p>
        <SettingsFields
          group="operations"
          current={snapshot}
          draft={draft}
          errors={errors}
          disabled={disabled}
          onChange={onChange}
        />
        <NavLink className="text-btn" to="/summaries">
          {t("앱 내부 아침 요약 보기", "View morning summaries in the app")}
        </NavLink>
      </Group>
      <Group
        title={t("연결", "Connections")}
        description={t(
          "연결과 사용 가능 여부",
          "Availability and connection status",
        )}
      >
        <div className="connection-row">
          <div>
            <strong>{t("정글스카웃 웹", "Jungle Scout web")}</strong>
            <p className="muted">
              {t(
                "ASIDE에서 저장검색 CSV를 수집합니다. 사이트 로그인은 실행할 때 확인합니다.",
                "ASIDE collects saved-search CSVs. Site sign-in is checked when a search runs.",
              )}
            </p>
          </div>
          <span className="chip chip-unknown">{t("실행 시 확인", "Checked when run")}</span>
        </div>
        <div className="connection-row">
          <div>
            <strong>
              {t("정글스카웃 확인 (API)", "Jungle Scout verification (API)")}
            </strong>
            <p className="muted">
              {t("현재 적용된 일일 호출 한도", "Applied daily call limit")}: {knownCallCap ? appliedCallCap : t("미확인", "Unknown")}
            </p>
          </div>
          <span className="chip chip-unknown">
            {knownCallCap && appliedCallCap === 0
              ? t("호출 안 함", "No calls")
              : t("연결 상태 미확인", "Connection unknown")}
          </span>
        </div>
        <NavLink className="btn btn-secondary" to="/settings/connections">{t("ASIDE · 계정 연결", "ASIDE · Account connections")}</NavLink>
        <WorkMailSettingsRow />
        <SubscriptionConnections />
        <NavLink className="text-btn" to="/settings/ai">{t("커스텀 AI 설정", "Custom AI settings")}</NavLink>
        <NavLink className="text-btn" to="/research">
          <Icon name="import" />
          {t("CSV로 제품 가져오기", "Import products from CSV")}
        </NavLink>
      </Group>
      <Group
        title={t("언어·알림", "Language & notifications")}
        description={t(
          "이 화면의 언어와 요약 시간",
          "Display language and summary schedule",
        )}
      >
        <div className="field">
          <label htmlFor="language">{t("화면 언어", "Display language")}</label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="ko">한국어</option>
            <option value="en">English</option>
          </select>
        </div>
        <p className="muted">
          {t(
            "언어는 현재 열린 화면에 적용됩니다.",
            "Language applies to this open workspace.",
          )}
        </p>
        <p className="muted">
          {t(
            "메일 발송 여부는 연결 상태를 확인해야 합니다.",
            "Email delivery depends on the mail connection.",
          )}
        </p>
      </Group>
      <Group
        title={t("보안", "Security")}
        description={t("내 작업 공간 보호", "Protect your workspace")}
      >
        <p>
          <Icon name="shield" />{" "}
          {t("2단계 인증 사용 중", "Two-step verification enabled")}
        </p>
        <NavLink className="text-btn" to="/security">{t("로그인한 기기 관리", "Manage signed-in devices")}</NavLink>
        <p className="muted">
          {t(
            "로그인할 때 비밀번호 다음에 인증 앱의 6자리 코드를 확인합니다.",
            "Sign-in requires your password and a six-digit authenticator code.",
          )}
        </p>
      </Group>
    </>
  );
}
