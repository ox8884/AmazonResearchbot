import { Summaries } from "./Summaries.tsx";
import { Connections } from "./Connections.tsx";
import { Security } from "./Security.tsx";
import { CustomAi } from "./CustomAi.tsx";
import { Inbox } from "./Inbox.tsx";
import { InboxDetail } from "./InboxDetail.tsx";
import { useQuery } from "@tanstack/react-query";
import { useEffect,useState,type ReactNode } from "react";
import { NavLink,Navigate,Route,Routes,useLocation } from "react-router";
import { getSession } from "./api.ts";
import { Login } from "./Auth.tsx";
import { MailProfile } from "./MailProfile.tsx";
import { Candidates } from "./Candidates.tsx";
import { Contact } from "./Contact.tsx";
import { Detail } from "./Detail.tsx";
import { Order } from "./Order.tsx";
import { Research } from "./Operations.tsx";
import { Settings } from "./Settings.tsx";
import { Setup2fa } from "./Setup2fa.tsx";
import { Sourcing } from "./Sourcing.tsx";
import { Today } from "./Today.tsx";
import {
Brand,
Icon,
LoadError,
Loading,
LocaleProvider,
useLocale,
type IconName,
} from "./ui.tsx";

export function App() {
  return (
    <LocaleProvider>
      <Workspace />
    </LocaleProvider>
  );
}
function Workspace() {
  const session = useQuery({
    queryKey: ["session"],
    queryFn: getSession,
    retry: false,
  });
  if (session.isPending)
    return (
      <main className="main">
        <Loading />
      </main>
    );
  if (session.isError)
    return (
      <main className="main">
        <LoadError retry={() => void session.refetch()} />
      </main>
    );
  return (
    <Routes>
      <Route
        path="/login"
        element={session.data ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/*"
        element={
          !session.data ? (
            <Navigate to="/login" replace />
          ) : !session.data.user.twoFactorEnabled ? (
            <Setup2fa />
          ) : (
            <Shell>
              <Routes>
                <Route path="/" element={<Today />} />
                <Route path="/candidates" element={<Candidates />} />
                <Route path="/candidates/:id" element={<Detail />} />
                <Route path="/candidates/:id/contact" element={<Contact />} />
                <Route path="/candidates/:id/orders" element={<Order />} />
                <Route path="/research" element={<Research />} />
                <Route path="/sourcing" element={<Sourcing />} />
                <Route path="/summaries" element={<Summaries />} />
                <Route path="/security" element={<Security />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/settings/connections" element={<Connections />} />
                <Route path="/settings/ai" element={<CustomAi />} />
                <Route path="/settings/mail" element={<MailProfile />} />
                <Route path="/inbox" element={<Inbox />} />
                <Route path="/inbox/:id" element={<InboxDetail />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Shell>
          )
        }
      />
    </Routes>
  );
}
const navigation: readonly {
  to: string;
  ko: string;
  en: string;
  icon: IconName;
}[] = [
  { to: "/", ko: "오늘", en: "Today", icon: "today" },
  { to: "/candidates", ko: "후보", en: "Candidates", icon: "candidate" },
  { to: "/research", ko: "가져오기", en: "Import", icon: "import" },
  { to: "/sourcing", ko: "견적", en: "Quotes", icon: "quote" },
  { to: "/settings", ko: "설정", en: "Settings", icon: "settings" },
];
function Nav({ mobile = false }: { mobile?: boolean }) {
  const { t } = useLocale();
  return (
    <nav
      className={mobile ? "tabs" : "nav"}
      aria-label={t("주요 화면", "Main navigation")}
    >
      {navigation
        .filter((n) => !mobile || n.to !== "/research")
        .map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}>
            <Icon name={n.icon} />
            {t(n.ko, n.en)}
          </NavLink>
        ))}
    </nav>
  );
}
function Shell({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const loc = useLocation();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  return (
    <div className="app">
      <a className="skip-link" href="#content">
        {t("본문으로", "Skip to content")}
      </a>
      <aside className="side">
        <Brand />
        <Nav />
        <div className="side-foot">
          <span>Amazon US · USD</span>
          <div className="account">
            <span className="avatar">J</span>
            <div>
              <strong>Jay</strong>
              <span>{t("개인 작업 공간", "Private workspace")}</span>
            </div>
            <Icon name="shield" />
          </div>
        </div>
      </aside>
      <header className="compact-header">
        <Brand />
        <Nav />
      </header>
      <main
        id="content"
        tabIndex={-1}
        className={loc.pathname === "/" ? "main today-main" : "main"}
      >
        {!online && (
          <p className="banner" role="status">
            {t(
              "연결이 끊겼어요. 이미 열린 내용은 그대로입니다",
              "You’re offline. What’s already open is still here",
            )}
          </p>
        )}
        {children}
      </main>
      <Nav mobile />
    </div>
  );
}
