import { BrowserConnection } from "./BrowserConnection.tsx";
import { NavLink } from "react-router";
import { GmailConnection } from "./GmailConnection.tsx";
import { PageHeader, useLocale } from "./ui.tsx";
export function SiteShortcuts() {
  const { t } = useLocale();
  return (
    <section className="detail-section stack">
      <h2>{t("리서치 사이트 바로가기", "Research site shortcuts")}</h2>
      <p className="muted">
        {t(
          "평소 쓰는 같은 브라우저의 일반 창에서 로그인하세요. 로그인 쿠키는 그 브라우저가 보관하며, 시크릿 창이나 다른 프로필에서는 공유되지 않습니다.",
          "Sign in in a regular window of your usual browser. That browser retains site cookies; private windows and different profiles do not share them.",
        )}
      </p>
      <div className="connection-row">
        <div>
          <strong>Amazon</strong>
          <p className="muted">
            {t(
              "US 검색 첫 페이지와 대표 상품 포장 정보를 ASIDE가 읽을 수 있게 로그인",
              "Sign in so ASIDE can read US search first pages and representative package details",
            )}
          </p>
        </div>
        <a
          className="btn btn-secondary"
          href="https://www.amazon.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("Amazon 열기", "Open Amazon")}
        </a>
      </div>
      <div className="connection-row">
        <div>
          <strong>Jungle Scout</strong>
          <p className="muted">
            {t(
              "로그인 후 Opportunity Finder에서 검색·CSV 다운로드",
              "Sign in for Opportunity Finder research and CSV downloads",
            )}
          </p>
        </div>
        <a
          className="btn btn-secondary"
          href="https://members.junglescout.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("Jungle Scout 열기", "Open Jungle Scout")}
        </a>
      </div>
      <div className="connection-row">
        <div>
          <strong>Product Database</strong>
          <p className="muted">{t("ASIN·리뷰·가격·판매량과 상품군을 확인", "Review ASIN, reviews, price, sales, and product families")}</p>
        </div>
        <a className="btn btn-secondary" href="https://members.junglescout.com/#/database" target="_blank" rel="noopener noreferrer">
          {t("Product Database 열기", "Open Product Database")}
        </a>
      </div>
      <div className="connection-row">
        <div>
          <strong>Keyword Scout</strong>
          <p className="muted">{t("검색량·키워드 확장·추세를 확인", "Review search volume, keyword expansion, and trends")}</p>
        </div>
        <a className="btn btn-secondary" href="https://members.junglescout.com/#/keyword" target="_blank" rel="noopener noreferrer">
          {t("Keyword Scout 열기", "Open Keyword Scout")}
        </a>
      </div>
      <div className="connection-row">
        <div><strong>Historical Data</strong><p className="muted">{t("별도 화면 없이 Keyword Scout의 30일 지표를 확인", "Review Keyword Scout's 30-day metrics; no separate screen is exposed")}</p></div>
        <a className="btn btn-secondary" href="https://members.junglescout.com/#/keyword" target="_blank" rel="noopener noreferrer">{t("Historical Data 열기", "Open Historical Data")}</a>
      </div>
      <div className="connection-row">
        <div><strong>Category Trends</strong><p className="muted">{t("날짜별 상품 순위·가격·리뷰를 확인", "Review dated product rank, price, and review observations")}</p></div>
        <a className="btn btn-secondary" href="https://members.junglescout.com/#/category-trends" target="_blank" rel="noopener noreferrer">{t("Category Trends 열기", "Open Category Trends")}</a>
      </div>
      <div className="connection-row">
        <div><strong>Competitive Intelligence</strong><p className="muted">{t("현재 계정의 권한 게이트와 경쟁 근거를 확인", "Review the current entitlement gate and competitor evidence")}</p></div>
        <a className="btn btn-secondary" href="https://members.junglescout.com/#/competitive-intelligence" target="_blank" rel="noopener noreferrer">{t("Competitive Intelligence 열기", "Open Competitive Intelligence")}</a>
      </div>
      <div className="connection-row">
        <div>
          <strong>Alibaba</strong>
          <p className="muted">
            {t(
              "로그인한 사이트에서 공급처를 확인하고 직접 연락",
              "Review suppliers and contact them directly on the signed-in site",
            )}
          </p>
        </div>
        <a
          className="btn btn-secondary"
          href="https://www.alibaba.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("Alibaba 열기", "Open Alibaba")}
        </a>
      </div>
      <p className="muted">
        {t(
          "바로가기는 현재 브라우저에서 열립니다. 바탕화면 바로가기는 Windows 기본 브라우저에서 열립니다. 앱은 다른 사이트의 쿠키를 복사하거나, 바로가기를 눌렀다는 이유로 로그인 완료를 표시하지 않습니다. 세션 만료 시 재로그인하세요.",
          "In-app shortcuts use this browser; desktop shortcuts use the Windows default browser. Forge does not copy site cookies or infer sign-in from a click. Sign in again if the session expires.",
        )}
      </p>
      <p className="muted">
        {t(
          "웹 자동화 연결은 별도입니다. 사이트 로그인만으로 야간 자동 검색이 시작되지는 않습니다.",
          "Browser automation is a separate connection. Signing in alone does not start overnight searches.",
        )}
      </p>
    </section>
  );
}
export function Connections() {
  const { t } = useLocale();
  return (
    <>
      <NavLink className="text-btn" to="/settings">
        {t("설정으로", "Back to settings")}
      </NavLink>
      <PageHeader
        title={t("계정 연결·바로가기", "Account connections & shortcuts")}
        description={t(
          "ASIDE와 업무 계정을 연결하고 리서치 사이트 로그인을 준비하세요.",
          "Connect ASIDE and work accounts, then prepare research site sign-ins.",
        )}
      />
      <BrowserConnection />
      <GmailConnection />
      <SiteShortcuts />
    </>
  );
}
