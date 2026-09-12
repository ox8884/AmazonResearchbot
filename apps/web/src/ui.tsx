import {
createContext,
useContext,
useEffect,
useState,
type ReactNode,
} from "react";
import { NavLink } from "react-router";
import { unknownLabel } from "./evidence.ts";

const Locale = createContext({
  language: "ko",
  setLanguage: (_value: string) => {},
  t: (ko: string, _en: string) => ko,
});
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState("ko");
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return (
    <Locale.Provider
      value={{
        language,
        setLanguage,
        t: (ko, en) => (language === "ko" ? ko : en),
      }}
    >
      {children}
    </Locale.Provider>
  );
}
export const useLocale = () => useContext(Locale);

export type IconName =
  | "today"
  | "candidate"
  | "import"
  | "quote"
  | "settings"
  | "arrow"
  | "clock"
  | "shield"
  | "check"
  | "unknown"
  | "warning";
const paths: Record<IconName, ReactNode> = {
  today: (
    <>
      <path d="M4 5h16v15H4zM4 10h16M8 3v4M16 3v4M8 14h3M8 17h6" />
    </>
  ),
  candidate: (
    <>
      <path d="M8 4h12v16H8zM4 8v12M12 9h4M12 13h4" />
    </>
  ),
  import: (
    <>
      <path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5" />
    </>
  ),
  quote: (
    <>
      <path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM9 8h6M9 12h6" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </>
  ),
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6" />
    </>
  ),
  warning: <path d="M12 3 2 21h20L12 3ZM12 9v5m0 3v1" />,
  check: <path d="m5 12 4 4L19 6" />,
  unknown: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 16v1" />
    </>
  ),
};
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <svg className="mark" viewBox="0 0 48 48" aria-hidden="true">
        <rect
          x="5"
          y="27"
          width="38"
          height="13"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path d="M7 13h11v9H7zM18 13h23l-5 5 5 4H18z" fill="currentColor" />
      </svg>
      <div className="wordmark">
        Forge Kitchen
        <span>
          Ops · {useLocale().t("오늘 처리할 승인함", "Approval inbox")}
        </span>
      </div>
    </div>
  );
}
export function PageHeader({
  title,
  description,
  eyebrow,
  children,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="stack">
        {eyebrow && <p className="muted">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {children}
    </header>
  );
}
export function Stage({ children }: { children: ReactNode }) {
  return (
    <span className="chip chip-stage">
      <Icon name="clock" />
      {children}
    </span>
  );
}
export function Empty({
  title,
  description,
  to,
  action,
  icon = "today",
}: {
  title: string;
  description: string;
  to?: string;
  action?: string;
  icon?: IconName;
}) {
  return (
    <section className="empty">
      <div className="empty-symbol">
        <Icon name={icon} />
      </div>
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      {to && action && (
        <NavLink className="btn btn-primary" to={to}>
          {action}
          <Icon name="arrow" />
        </NavLink>
      )}
    </section>
  );
}
export function Loading() {
  return (
    <div className="loading stack" role="status">
      <p className="muted">{useLocale().t("불러오는 중", "Loading")}</p>
      <div />
      <div />
      <div />
    </div>
  );
}
export function LoadError({ retry }: { retry: () => void }) {
  const { t } = useLocale();
  return (
    <div className="error-state" role="alert">
      <h2>{t("내용을 불러오지 못했어요", "Couldn’t load this view")}</h2>
      <p>
        {t(
          "연결을 확인하고 다시 시도해 주세요.",
          "Check your connection and try again.",
        )}
      </p>
      <button className="btn btn-secondary" onClick={retry}>
        {t("다시 시도", "Try again")}
      </button>
    </div>
  );
}
export function Unknowns({ values }: { values: readonly string[] }) {
  const { t, language } = useLocale();
  const known = values.filter(
    (v) => v !== "지금 모르는 것은 없습니다" && v !== "None right now",
  );
  return known.length ? (
    <div className="chips">
      {known.map((v) => (
        <span className="chip chip-unknown" key={v}>
          <Icon name="unknown" />
          {unknownLabel(v, language)}
        </span>
      ))}
    </div>
  ) : (
    <p className="muted">{t("지금 모르는 것은 없습니다", "None right now")}</p>
  );
}
