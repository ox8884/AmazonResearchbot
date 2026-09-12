import type { InboxQuotePreview } from "../../../packages/domain/src/quote-preview.ts";
import { ReplyQuoteContext } from "./ReplyQuoteContext.tsx";
import type { SourcingView } from "../../../packages/domain/src/sourcing.ts";
import {
  SourcingToolbar,
  SourcingSpecSummary,
  SourcingQuoteResults,
  SourcingActions,
  SourcingPageHeader,
} from "./SourcingContext.tsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, useSearchParams } from "react-router";
import { useCandidates } from "./Candidates.tsx";
import { getSourcing, getInboxQuotePreview } from "./quote-api.ts";
import { QuoteForm } from "./QuoteForm.tsx";
import { SpecForm } from "./SpecForm.tsx";
import { Empty, Icon, LoadError, Loading, useLocale } from "./ui.tsx";
export function Sourcing() {
  const [params] = useSearchParams();
  return (
    <SourcingWorkspace
      key={JSON.stringify([
        params.get("candidate"),
        params.get("spec"),
        params.get("reply"),
      ])}
    />
  );
}
function SourcingWorkspace() {
  const { t } = useLocale();
  const candidates = useCandidates();
  const [params, setParams] = useSearchParams();
  const replyId = params.get("reply");
  const reply = useQuery({
    queryKey: ["quote-reply", replyId],
    queryFn: () => getInboxQuotePreview(replyId ?? ""),
    enabled: Boolean(replyId),
  });
  const candidateId =
    params.get("candidate") ??
    reply.data?.candidateId ??
    (replyId ? "" : (candidates.data?.[0]?.id ?? ""));
  const candidate = candidates.data?.find((c) => c.id === candidateId);
  const q = useQuery({
    queryKey: ["sourcing", candidateId],
    queryFn: () => getSourcing(candidateId),
    enabled: !!candidate,
  });
  const qc = useQueryClient();
  const [form, setForm] = useState<"spec" | "quote" | null>(null);
  const [notice, setNotice] = useState(false);
  const [formSource, setFormSource] = useState<InboxQuotePreview | undefined>(
    undefined,
  );
  const spec =
    q.data?.specs.find(
      (s) =>
        s.id ===
        (params.get("spec") ??
          (reply.data?.candidateId === candidateId ? reply.data.specId : null)),
    ) ?? q.data?.specs[0];
  const quotes =
    q.data?.quotes.filter((quote) => quote.specId === spec?.id) ?? [];
  const mismatch = Boolean(
    reply.data?.bound &&
    (reply.data.candidateId !== candidateId ||
      (spec && reply.data.specId !== spec.id)),
  );
  const sourceCoreReady = reply.data?.complete;
  const prefill =
    reply.data?.bound && sourceCoreReady && !mismatch ? reply.data : undefined;
  const replyUnavailable = Boolean(
    replyId &&
    (!reply.data ||
      reply.isError ||
      mismatch ||
      (reply.data.bound && !sourceCoreReady)),
  );
  const sourceChanged =
    form === "quote" &&
    Boolean(replyId) &&
    Boolean(prefill) !== Boolean(formSource);
  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["sourcing", candidateId] });
  }
  return (
    <>
      <SourcingPageHeader />
      {replyId && (
        <ReplyQuoteContext
          id={replyId}
          preview={reply.data}
          pending={reply.isPending}
          error={reply.isError}
          mismatch={mismatch}
          retry={() => void reply.refetch()}
        />
      )}
      {candidates.isPending ? (
        <Loading />
      ) : candidates.isError && !candidates.data ? (
        <LoadError retry={() => void candidates.refetch()} />
      ) : !candidates.data?.length ? (
        <Empty
          icon="candidate"
          title={t("먼저 후보를 가져와 주세요", "Import a candidate first")}
          description={t(
            "후보를 선택하면 같은 사양의 견적을 기록할 수 있어요.",
            "Select a candidate to record comparable quotes.",
          )}
          to="/research"
          action={t("제품 가져오기", "Import products")}
        />
      ) : (
        <>
          {candidates.isError && (
            <LoadError retry={() => void candidates.refetch()} />
          )}
          <SourcingToolbar
            candidates={candidates.data}
            specs={q.data?.specs ?? []}
            candidateId={candidateId}
            specId={spec?.id ?? ""}
            editing={form !== null}
            onCandidate={(id) => {
              setParams({
                candidate: id,
                ...(replyId ? { reply: replyId } : {}),
              });
              setNotice(false);
            }}
            onSpec={(id) => {
              setParams({
                candidate: candidateId,
                spec: id,
                ...(replyId ? { reply: replyId } : {}),
              });
              setNotice(false);
            }}
          />
          {!candidate ? (
            <Empty
              title={t("후보를 찾을 수 없어요", "Candidate not found")}
              description={t(
                "위 목록에서 후보를 다시 선택해 주세요.",
                "Choose a candidate from the list above.",
              )}
            />
          ) : q.isPending ? (
            <Loading />
          ) : q.isError && !q.data ? (
            <LoadError retry={() => void q.refetch()} />
          ) : (
            <>
              {q.isError && <LoadError retry={() => void q.refetch()} />}
              {notice && (
                <p className="save-notice" role="status">
                  <Icon name="check" />
                  {t(
                    "저장했습니다. 현재 기준으로 계산한 결과입니다.",
                    "Saved. Results use the currently approved criteria.",
                  )}
                </p>
              )}
              {spec && <SourcingSpecSummary spec={spec} />}
              {sourceChanged && (
                <p className="banner" role="alert">
                  {t(
                    "회신 연결이 바뀌었습니다. 입력은 유지되며, 취소한 뒤 다시 열어 최신 조건을 확인할 수 있어요.",
                    "The reply link changed. Your entries are preserved; cancel and reopen to review the current conditions.",
                  )}
                </p>
              )}
              {form === "spec" ? (
                <SpecForm
                  key={candidateId}
                  candidateId={candidateId}
                  onCancel={() => setForm(null)}
                  onSaved={(saved) => {
                    setForm(null);
                    setParams({ candidate: candidateId, spec: saved.id });
                    void refresh();
                  }}
                />
              ) : form === "quote" && spec ? (
                <QuoteForm
                  key={`${spec.id}:${replyId ?? "manual"}`}
                  prefill={formSource}
                  blocked={replyUnavailable || sourceChanged}
                  candidateId={candidateId}
                  specId={spec.id}
                  onCancel={() => setForm(null)}
                  onSaved={(saved) => {
                    qc.setQueryData<SourcingView>(
                      ["sourcing", candidateId],
                      (current) =>
                        current
                          ? {
                              ...current,
                              quotes: current.quotes.some(
                                (item) => item.id === saved.id,
                              )
                                ? current.quotes.map((item) =>
                                    item.id === saved.id ? saved : item,
                                  )
                                : [...current.quotes, saved],
                            }
                          : current,
                    );
                    if (replyId) void reply.refetch();
                    void qc.invalidateQueries({ queryKey: ["candidates"] });
                    setForm(null);
                    setNotice(true);
                    void refresh();
                  }}
                />
              ) : (
                <SourcingActions
                  hasSpec={Boolean(spec)}
                  disabled={
                    replyUnavailable || Boolean(replyId && reply.isFetching)
                  }
                  onQuote={() => {
                    setFormSource(prefill);
                    setForm("quote");
                    setNotice(false);
                  }}
                  onSpec={() => {
                    setForm("spec");
                    setNotice(false);
                  }}
                />
              )}
              <SourcingQuoteResults
                quotes={quotes}
                hasSpec={Boolean(spec)}
                showEmpty={form === null}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
