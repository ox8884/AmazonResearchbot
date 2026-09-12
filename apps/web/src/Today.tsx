import { getCustomAi } from "./custom-ai-api.ts";
import { getSettings } from "./api.ts";
import { pendingMailProfileApprovals } from "./mail-profile-api.ts";
import { MailApprovalCard } from "./MailApprovalCard.tsx";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink } from "react-router";
import { CandidateCard, useCandidates } from "./Candidates.tsx";
import { evidenceText } from "./evidence.ts";
import { pendingSettings } from "./settings-api.ts";
import { SettingsApprovalCard } from "./SettingsApprovalCard.tsx";
import {
  Empty,
  Icon,
  LoadError,
  Loading,
  PageHeader,
  Stage,
  Unknowns,
  useLocale,
} from "./ui.tsx";

export function Today() {
  const q = useCandidates();
  const currentSettings = useQuery({queryKey:["settings"],queryFn:getSettings});
  const settings = useQuery({
    queryKey: ["settings-pending"],
    queryFn: pendingSettings,
    refetchInterval: 10000,
  });
  const mail = useQuery({ queryKey: ["mail-profile-approvals"], queryFn: pendingMailProfileApprovals, refetchInterval: 10000 });
  const ai = useQuery({queryKey:["custom-ai"],queryFn:getCustomAi,refetchInterval:10000});
  const aiRequests = ai.data?.profiles.filter(profile => profile.status === "pending_approval") ?? [];
  const mailRequests = mail.data ?? [];
  const settingsRequests =
    settings.data?.filter((item) => item.payload !== null) ?? [];
  const { t, language } = useLocale();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = q.data ?? [];
  const approvals = list.filter((c) => c.nextAction.kind === "approval");
  const waiting = list.filter(
    (c) => c.nextAction.kind === "waiting" && c.nextAction.target !== "done",
  );
  const active = list.filter((c) => c.nextAction.target !== "done");
  const selected =
    list.find((c) => c.id === selectedId) ??
    approvals[0] ??
    waiting[0] ??
    active[0];
  const zone = currentSettings.data?.snapshot.timezone;
  let date = t("시간대 확인 중", "Checking time zone");
  if (typeof zone === "string") {
    try { date = new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {timeZone:zone,month:"long",day:"numeric",weekday:"long"}).format(new Date()) + " · " + zone; }
    catch { date = t("시간대 미확인", "Time zone unknown"); }
  }
  return (
    <>
      <PageHeader
        eyebrow={date}
        title={t("오늘 처리할 일", "Today’s approvals")}
        description={
          q.data && settings.data && mail.data && ai.data
            ? t(
                `진행 ${active.length} · 승인 대기 ${approvals.length + settingsRequests.length + mailRequests.length + aiRequests.length} · 연결·근거 대기 ${waiting.length}`,
                `In progress ${active.length} · Waiting on you ${approvals.length + settingsRequests.length + mailRequests.length + aiRequests.length} · Waiting ${waiting.length}`,
              )
            : t(
                "오늘 필요한 결정과 그 근거를 확인하세요.",
                "Review today’s decisions and their evidence.",
              )
        }
      />
      <NavLink className="text-btn" to="/summaries">{t("앱 내부 아침 요약 보기", "View saved morning summaries")}</NavLink>
      {q.isPending ? (
        <Loading />
      ) : q.isError && !q.data ? (
        <LoadError retry={() => void q.refetch()} />
      ) : (
        <div className="today">
          <div className="stack work-list">
            {q.isError && <LoadError retry={() => void q.refetch()} />}
            <div className="section-label">
              <h2>{t("내 승인함", "Your inbox")}</h2>
              <span className="muted">
                {t("직접 결정할 일", "Decisions for you")}
              </span>
            </div>
            {settings.isPending && (
              <p className="muted">
                {t("변경 승인 요청 확인 중", "Checking change requests")}
              </p>
            )}
            {settings.isError && (
              <LoadError retry={() => void settings.refetch()} />
            )}
            {ai.isPending && <p className="muted">{t("AI 사용 승인 확인 중", "Checking AI activation approvals")}</p>}
            {ai.isError && <LoadError retry={() => void ai.refetch()} />}
            {aiRequests.map(profile => <article className="card stack" key={profile.id}>
              <Stage>{t("AI 사용 승인 대기", "AI activation awaiting approval")}</Stage>
              <h3>{profile.name}</h3>
              <p className="source-text">{profile.model} · v{profile.version}</p>
              <p className="muted">{t("전송 대상·역할·비용 한도를 확인하고 사용 여부를 결정하세요.", "Review the destination, roles, and spending limits before activation.")}</p>
              <NavLink className="btn btn-primary" to="/settings/ai">{t("AI 설정 검토", "Review AI settings")}<Icon name="arrow" /></NavLink>
            </article>)}
            {mail.isPending && <p className="muted">{t("연결 승인 요청 확인 중", "Checking connection approvals")}</p>}
            {mail.isError && <LoadError retry={() => void mail.refetch()} />}
            {mailRequests.map(request => <MailApprovalCard key={request.id} request={request} />)}
            {settingsRequests.map(request => <SettingsApprovalCard key={request.id} request={request} />)}
            {!list.length ? (
              <Empty
                title={t(
                  "아직 가져온 제품이 없어요",
                  "No products imported yet",
                )}
                description={t(
                  "CSV를 가져오면 후보별 근거와 다음 행동이 이곳에 모입니다.",
                  "Import a CSV to gather candidates, evidence, and next actions here.",
                )}
                to="/research"
                action={t("제품 가져오기", "Import products")}
                icon="import"
              />
            ) : approvals.length ? (
              approvals.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidate={c}
                  selected={selected?.id === c.id}
                  onSelect={() => setSelectedId(c.id)}
                />
              ))
            ) : settings.isSuccess && mail.isSuccess && ai.isSuccess && settingsRequests.length === 0 && mailRequests.length === 0 && aiRequests.length === 0 ? (
              <Empty
                title={t(
                  "지금 승인할 일이 없어요",
                  "Nothing to approve right now",
                )}
                description={t(
                  "후보별 대기 사유를 아래에서 확인하세요.",
                  "Review why candidates are waiting below.",
                )}
              />
            ) : null}
            {waiting.length > 0 && (
              <section className="quiet">
                <h2>{t("기다리는 중", "Waiting")}</h2>
                <ul>
                  {waiting.slice(0, 5).map((c) => (
                    <li key={c.id}>
                      <NavLink
                        className="keyword-link"
                        to={`/candidates/${c.id}`}
                      >
                        {c.keyword}
                        <Icon name="arrow" />
                      </NavLink>
                      <p className="muted">{c.nextAction.label}</p>
                    </li>
                  ))}
                </ul>
                {waiting.length > 5 && (
                  <NavLink className="text-btn" to="/candidates">
                    {t("전체 후보 보기", "View all candidates")}
                    <Icon name="arrow" />
                  </NavLink>
                )}
              </section>
            )}
            {list.some((c) => c.nextAction.kind === "automatic") && (
              <p className="muted">
                {t(
                  "나머지 후보는 자동 확인 중입니다.",
                  "The other candidates are being checked automatically.",
                )}
              </p>
            )}
          </div>
          <aside
            className="today-panel"
            aria-label={t("고른 후보의 근거", "Selected candidate evidence")}
          >
            <p className="eyebrow">{t("결정을 위한 근거", "DECISION NOTES")}</p>
            {selected ? (
              <>
                <h2>{selected.keyword}</h2>
                <Stage>{selected.stageLabel}</Stage>
                <section>
                  <h3>{t("확인한 것", "Evidence")}</h3>
                  <p>{evidenceText(selected.evidenceSummary, language)}</p>
                </section>
                <section>
                  <h3>{t("모르는 것", "Unknown")}</h3>
                  <Unknowns values={selected.unknowns} />
                </section>
                <section>
                  <h3>{t("다음 행동", "Next action")}</h3>
                  <p>{selected.nextAction.label}</p>
                </section>
                <NavLink className="text-btn" to={`/candidates/${selected.id}`}>
                  {t("후보 상세 보기", "Open candidate")}
                  <Icon name="arrow" />
                </NavLink>
              </>
            ) : (
              <>
                <h2>
                  {t("결정 전에, 근거부터", "Evidence before a decision")}
                </h2>
                <p className="muted">
                  {t(
                    "후보가 생기면 확인한 내용과 아직 모르는 것을 나란히 보여드릴게요.",
                    "When candidates arrive, you’ll see the evidence alongside what is still unknown.",
                  )}
                </p>
                <dl className="guide-list">
                  <dt>{t("확인한 것", "Evidence")}</dt>
                  <dd>
                    {t(
                      "측정 · 추정 · 견적을 구분",
                      "Measured, estimated, or quoted",
                    )}
                  </dd>
                  <dt>{t("모르는 것", "Unknown")}</dt>
                  <dd>
                    {t(
                      "빈 값은 미확인으로 유지",
                      "Missing values stay unknown",
                    )}
                  </dd>
                  <dt>{t("다음 행동", "Next action")}</dt>
                  <dd>{t("한 번에 한 가지 결정", "One decision at a time")}</dd>
                </dl>
              </>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
