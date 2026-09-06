import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from "react-router";
import {
  approve,
  enableTotp,
  getCandidate,
  getSession,
  getSettings,
  listCandidates,
  proposeSettings,
  signIn,
  signUp,
  uploadCsv,
  verifyTotp,
  type CandidateView,
} from "./api.ts";

function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: getSession, retry: false });
}

export function App() {
  const session = useSession();
  if (session.isLoading) return <p className="main muted">불러오는 중</p>;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
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
                <Route path="/research" element={<Research />} />
                <Route path="/candidates" element={<Candidates />} />
                <Route path="/candidates/:id" element={<Detail />} />
                <Route path="/sourcing" element={<Sourcing />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </Shell>
          )
        }
      />
    </Routes>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <aside className="side">
        <div className="wordmark">
          Forge Kitchen Ops
          <span>오늘 처리할 승인함</span>
        </div>
        <Nav />
      </aside>
      <div className="topnav">
        <Nav />
      </div>
      <div className="topbar">
        <strong>Forge Kitchen Ops</strong>
      </div>
      <main className="main">{children}</main>
      <nav className="tabs" aria-label="주요 화면">
        <NavLink to="/" end>
          오늘
        </NavLink>
        <NavLink to="/candidates">후보</NavLink>
        <NavLink to="/sourcing">견적</NavLink>
        <NavLink to="/settings">설정</NavLink>
      </nav>
    </div>
  );
}

function Nav() {
  return (
    <nav className="nav">
      <NavLink to="/" end>
        오늘
      </NavLink>
      <NavLink to="/research">가져오기</NavLink>
      <NavLink to="/candidates">후보</NavLink>
      <NavLink to="/sourcing">견적</NavLink>
      <NavLink to="/settings">설정</NavLink>
    </nav>
  );
}

function Login() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [email, setEmail] = useState("jay@local.test");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("Jay");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const result = mode === "in" ? await signIn(email, password) : await signUp(email, password, name);
    const body = result as { message?: string; twoFactorRedirect?: boolean; code?: string };
    if (body.code === "LOCKED") {
      setError("실패한 로그인이 너무 많아요. 15분 뒤에 다시 시도해 주세요.");
      return;
    }
    if (body.message && !body.twoFactorRedirect && body.code) {
      setError(body.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["session"] });
    nav("/");
  }

  return (
    <main className="main">
      <h1 className="page-title">Forge Kitchen Ops</h1>
      <p className="muted">운영자 로그인. 서버나 코드를 보여 주지 않습니다.</p>
      <form className="narrow card" onSubmit={onSubmit}>
        {mode === "up" ? (
          <div className="field">
            <label htmlFor="name">이름</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="email">이메일</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="password">비밀번호</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {error ? <p className="banner">{error}</p> : null}
        <button className="btn btn-primary" type="submit">
          {mode === "in" ? "로그인" : "첫 계정 만들기"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "첫 계정 만들기" : "이미 계정이 있어요"}
        </button>
      </form>
    </main>
  );
}

function Setup2fa() {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function enable(e: FormEvent) {
    e.preventDefault();
    const data = await enableTotp(password);
    if (!data.totpURI) {
      setError("앱 인증을 켜지 못했어요.");
      return;
    }
    setUri(data.totpURI);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    await verifyTotp(code);
    await qc.invalidateQueries({ queryKey: ["session"] });
  }

  return (
    <main className="main">
      <h1 className="page-title">2단계 인증</h1>
      <p className="muted">업무를 보려면 인증 앱을 연결해야 합니다.</p>
      {!uri ? (
        <form className="narrow card" onSubmit={enable}>
          <div className="field">
            <label htmlFor="pw">비밀번호</label>
            <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error ? <p className="banner">{error}</p> : null}
          <button className="btn btn-primary" type="submit">
            인증 앱 연결
          </button>
        </form>
      ) : (
        <form className="narrow card" onSubmit={verify}>
          <p className="muted">인증 앱에 이 키를 넣으세요. QR은 앱이 나중에 보여 줍니다.</p>
          <p className="tabular">{uri}</p>
          <div className="field">
            <label htmlFor="code">6자리 코드</label>
            <input id="code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit">
            확인
          </button>
        </form>
      )}
    </main>
  );
}

function useCandidates() {
  return useQuery({ queryKey: ["candidates"], queryFn: listCandidates, refetchInterval: 2000 });
}

function Today() {
  const q = useCandidates();
  const list = q.data ?? [];
  const approvals = list.filter((c) => c.nextAction.kind === "approval");
  const waiting = list.filter((c) => c.nextAction.kind === "waiting");
  const automatic = list.filter((c) => c.nextAction.kind === "automatic");

  if (q.isLoading) return <p className="muted">불러오는 중</p>;
  if (list.length === 0) {
    return (
      <>
        <h1 className="page-title hero">오늘 처리할 일</h1>
        <div className="card">
          <h2>아직 가져온 제품이 없어요</h2>
          <p className="muted">저장 검색을 실행하거나 CSV를 올리면 후보가 만들어집니다. 한 파일의 서로 다른 키워드 20행은 후보 20개가 됩니다.</p>
          <NavLink className="btn btn-primary" to="/research">
            제품 가져오기
          </NavLink>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title hero">오늘 처리할 일</h1>
      <p className="muted tabular">
        진행 {automatic.length} · 승인 대기 {approvals.length} · 대기 {waiting.length}
      </p>
      {approvals.length === 0 ? <p>지금 승인할 일이 없어요</p> : null}
      <div className="stack">
        {approvals.map((c) => (
          <CandidateCard key={c.id} c={c} />
        ))}
      </div>
      {waiting.length > 0 ? (
        <div>
          <p className="muted">기다리는 중 — 승인 버튼 없음</p>
          {waiting.map((c) => (
            <p key={c.id}>
              <strong>{c.keyword}</strong>
              <span className="muted"> {c.nextAction.label}</span>
            </p>
          ))}
        </div>
      ) : null}
      {automatic.length > 0 ? <p className="muted">나머지 후보는 자동 확인 중입니다.</p> : null}
    </>
  );
}

function CandidateCard({ c }: { c: CandidateView }) {
  return (
    <article className="card">
      <div className="btn-row">
        <span className="chip chip-stage">{c.stageLabel}</span>
        <span className={`chip ${c.nextAction.kind === "waiting" ? "chip-unknown" : "chip-quote"}`}>{c.nextAction.kind}</span>
      </div>
      <h3>{c.keyword}</h3>
      <p>{c.evidenceSummary}</p>
      <p className="muted">모르는 것: {c.unknowns.join(", ")}</p>
      {c.nextAction.kind === "approval" ? (
        <NavLink className="btn btn-primary" to={`/candidates/${c.id}`}>
          {c.nextAction.label}
        </NavLink>
      ) : null}
    </article>
  );
}

function Candidates() {
  const q = useCandidates();
  if (q.isLoading) return <p className="muted">불러오는 중</p>;
  return (
    <>
      <h1 className="page-title">후보</h1>
      <div className="stack">
        {(q.data ?? []).map((c) => (
          <CandidateCard key={c.id} c={c} />
        ))}
      </div>
    </>
  );
}

function Detail() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ["candidate", id],
    queryFn: () => getCandidate(id ?? ""),
    enabled: Boolean(id),
  });
  if (q.isLoading) return <p className="muted">불러오는 중</p>;
  const c = q.data?.candidate;
  if (!c) return <p>후보를 찾을 수 없어요</p>;
  return (
    <>
      <p className="muted">{c.keyword}</p>
      <h1 className="page-title">후보 상세</h1>
      <div className="card" style={{ height: 120, justifyContent: "center", alignItems: "center", color: "var(--muted)" }}>
        이미지 없음
      </div>
      <section className="stack">
        <h2>다음 행동</h2>
        <article className="card">
          <span className="chip chip-stage">{c.stageLabel}</span>
          <p>{c.nextAction.label}</p>
        </article>
      </section>
      <section className="stack">
        <h2>모르는 것</h2>
        <div className="btn-row">
          {c.unknowns.map((u) => (
            <span key={u} className="chip chip-unknown">
              {u}
            </span>
          ))}
        </div>
      </section>
      <section className="stack">
        <h2>근거</h2>
        <p>{c.evidenceSummary}</p>
      </section>
    </>
  );
}

function Research() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const result = (await uploadCsv(file)) as { status: number; body: { message?: string; created?: number; reused?: boolean; code?: string } };
    if (result.status === 422) {
      setMsg(result.body.message ?? "행을 고쳐 주세요");
      return;
    }
    if (result.body.reused) setMsg("같은 파일이라 기존 20개 후보를 보여 줍니다.");
    else setMsg(`후보 ${result.body.created ?? 0}개를 만들었습니다.`);
    await qc.invalidateQueries({ queryKey: ["candidates"] });
  }

  return (
    <>
      <h1 className="page-title">가져오기</h1>
      <article className="card">
        <h3>저장 검색 · Kitchen & Dining</h3>
        <p className="muted">웹 연결을 기다리고 있어요. 지금은 CSV를 직접 고를 수 있습니다.</p>
        <div className="field">
          <label htmlFor="csv">CSV 파일</label>
          <input id="csv" type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        {msg ? <p className="banner">{msg}</p> : null}
      </article>
    </>
  );
}

function Sourcing() {
  return (
    <>
      <h1 className="page-title">견적 비교</h1>
      <p className="muted">견적이 아직 없으면 탈락이 아니라 견적 대기입니다. 통화 USD.</p>
      <div className="quotes">
        <article className="card">
          <h2>견적 없음</h2>
          <p className="muted">아직 견적이 없어요. 탈락이 아닙니다.</p>
        </article>
      </div>
    </>
  );
}

function Settings() {
  const q = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const [cap, setCap] = useState("");
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const propose = useMutation({
    mutationFn: () => proposeSettings({ launchBudgetUsd: cap || undefined }),
    onSuccess: (r) => setApprovalId(r.approvalId),
  });
  const doApprove = useMutation({
    mutationFn: (id: string) => approve(id),
    onSuccess: () => q.refetch(),
  });
  const snap = q.data?.snapshot;
  return (
    <>
      <h1 className="page-title">설정</h1>
      <p className="muted">지금 적용 중 · 버전 {q.data?.version}. 저장이 아니라 변경 승인입니다.</p>
      <div className="card" style={{ maxWidth: 720 }}>
        <h2>판매 기준</h2>
        <p>시장 Amazon US · USD</p>
        <p>ROI {String(snap?.roiPct ?? "")}</p>
        <div className="field">
          <label htmlFor="cap">출시 현금 한도 (USD)</label>
          <input id="cap" className="tabular" value={cap} placeholder={String(snap?.launchBudgetUsd ?? "")} onChange={(e) => setCap(e.target.value)} />
        </div>
        <button className="btn btn-primary" type="button" onClick={() => propose.mutate()} style={{ alignSelf: "flex-start" }}>
          변경 승인 요청
        </button>
        {approvalId ? (
          <button className="btn btn-secondary" type="button" onClick={() => doApprove.mutate(approvalId)}>
            이 변경 승인
          </button>
        ) : null}
        <h2>연결</h2>
        <p>
          정글스카웃 확인 <span className="chip chip-unknown">한도 없음 · 호출 안 함</span>
        </p>
        <p>
          ChatGPT 구독 <span className="chip chip-danger">사용 불가</span>
        </p>
      </div>
    </>
  );
}
