import { type ReactNode } from "react";
import { Brand,Icon,useLocale } from "./ui.tsx";

export function AuthFrame({
  children,
  second = false,
}: {
  children: ReactNode;
  second?: boolean;
}) {
  const { t } = useLocale();
  const steps = [
    [
      "후보 확인",
      "Review candidates",
      "근거와 모르는 것을 함께 확인",
      "Evidence and unknowns, together",
    ],
    [
      "견적 비교",
      "Compare quotes",
      "같은 사양, 같은 기준으로 비교",
      "One specification, consistent criteria",
    ],
    [
      "내 결정",
      "Your decision",
      "보내기 전에 한 번 더 확인",
      "Review before anything is sent",
    ],
  ];
  return (
    <main className="login">
      <section className="login-workbench">
        <Brand />
        <div className="bench-intro">
          <p className="eyebrow">FORGE KITCHEN OPS</p>
          <h1>
            {t("근거는 한눈에.", "Evidence at a glance.")}
            <br />
            {t("결정은 차분하게.", "Decisions with clarity.")}
          </h1>
          <p>
            {t(
              "후보를 살피고, 견적을 비교하고, 오늘 필요한 승인만 처리하세요.",
              "Review candidates, compare quotes, and make today’s decisions.",
            )}
          </p>
        </div>
        <div className="bench-agenda">
          <div className="bench-heading">
            <Icon name="today" />
            <h2>{t("오늘 처리할 승인함", "Today’s approval inbox")}</h2>
          </div>
          {steps.map(([ko, en, desc, descEn], i) => (
            <div className="agenda-row" key={ko}>
              <span className="agenda-number">0{i + 1}</span>
              <div>
                <strong>{t(ko ?? "", en ?? "")}</strong>
                <p className="muted">{t(desc ?? "", descEn ?? "")}</p>
              </div>
              <Icon name="arrow" />
            </div>
          ))}
        </div>
        <p className="muted bench-footer">Amazon US · Kitchen & Dining · USD</p>
      </section>
      <section className="login-pane">
        <div className="auth-content">
          <div
            className="auth-steps"
            aria-label={t("로그인 단계", "Sign-in steps")}
          >
            <span className={!second ? "current" : ""}>
              01 {t("비밀번호", "Password")}
            </span>
            <span className="step-rule" />
            <span className={second ? "current" : ""}>
              02 {t("인증 코드", "Verification")}
            </span>
          </div>
          {children}
          <p className="auth-foot">
            <Icon name="shield" />
            {t(
              "Jay의 개인 작업 공간 · 2단계 인증",
              "Jay’s private workspace · Two-step verification",
            )}
          </p>
        </div>
      </section>
    </main>
  );
}
