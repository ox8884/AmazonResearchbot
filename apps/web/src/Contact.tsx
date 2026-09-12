import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useParams } from "react-router";
import { getCandidate } from "./api.ts";
import { getContactWorkspace } from "./contact-api.ts";
import {
  contactDate,
  contactReason,
  supplierMatchLabel,
} from "./contact-labels.ts";
import { ContactRfqForm, ContactSupplierForm } from "./ContactForms.tsx";
import { ContactRfqCard } from "./ContactRfqCard.tsx";
import { getSourcing } from "./quote-api.ts";
import { Empty, LoadError, Loading, PageHeader, useLocale } from "./ui.tsx";

export function Contact() {
  const { id } = useParams();
  const candidateId = id ?? "";
  const { t, language } = useLocale();
  const client = useQueryClient();
  const candidate = useQuery({
    queryKey: ["candidate", candidateId, language],
    queryFn: () => getCandidate(candidateId, language),
    enabled: Boolean(id),
  });
  const workspace = useQuery({
    queryKey: ["contact", candidateId],
    queryFn: () => getContactWorkspace(candidateId),
    refetchInterval: 5000,
    enabled: Boolean(id),
  });
  const sourcing = useQuery({
    queryKey: ["sourcing", candidateId],
    queryFn: () => getSourcing(candidateId),
    enabled: Boolean(id),
  });

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["candidate", candidateId] }),
      client.invalidateQueries({ queryKey: ["candidates"] }),
      client.invalidateQueries({ queryKey: ["contact", candidateId] }),
      client.invalidateQueries({ queryKey: ["sourcing", candidateId] }),
    ]);
  }

  if (!id)
    return (
      <Empty
        title={t("후보를 찾을 수 없어요", "Candidate not found")}
        description={t(
          "후보 목록에서 연락 대상을 다시 선택해 주세요.",
          "Select a candidate from the list before contacting suppliers.",
        )}
        to="/candidates"
        action={t("후보 보기", "View candidates")}
      />
    );
  if (candidate.isPending || workspace.isPending || sourcing.isPending)
    return <Loading />;
  if (
    (candidate.isError && !candidate.data) ||
    (workspace.isError && !workspace.data) ||
    (sourcing.isError && !sourcing.data)
  )
    return (
      <LoadError
        retry={() => {
          void Promise.all([
            candidate.refetch(),
            workspace.refetch(),
            sourcing.refetch(),
          ]);
        }}
      />
    );
  if (!candidate.data || !workspace.data || !sourcing.data)
    return (
      <Empty
        title={t("연락 정보를 찾을 수 없어요", "Contact data not found")}
        description={t(
          "후보와 사양 정보를 다시 확인해 주세요.",
          "Check the candidate and specification data, then try again.",
        )}
        to={`/candidates/${encodeURIComponent(candidateId)}`}
        action={t("후보 상세로", "Back to candidate")}
      />
    );

  const contact = workspace.data;
  return (
    <div className="contact-page stack">
      <NavLink
        className="back-link"
        to={`/candidates/${encodeURIComponent(candidateId)}`}
      >
        {t("후보 상세로", "Back to candidate")}
      </NavLink>
      <PageHeader
        eyebrow={t("공급처 연락 준비", "Supplier contact preparation")}
        title={candidate.data.candidate.keyword}
        description={t(
          "공급처 근거와 견적 요청 내용을 확인하고, 보내기 전에 승인하세요.",
          "Review supplier evidence and the quote request before approving contact.",
        )}
      />
      {(candidate.isError || workspace.isError || sourcing.isError) && (
        <p className="banner" role="status">
          {t(
            "최신 상태를 불러오지 못했어요. 마지막으로 열린 내용을 보여드립니다.",
            "Couldn’t refresh the status. Showing the last loaded content.",
          )}
        </p>
      )}
      <section className="contact-connection" role="status">
        <h2>{t("전송 연결", "Delivery connection")}</h2>
        <p>
          {contact.deliveryMode === "mailpit"
            ? t(
                "Mailpit 로컬 캡처만 사용합니다. 외부 이메일은 전송되지 않습니다.",
                "Mailpit is local capture only. No external email is delivered.",
              )
            : contact.deliveryMode === "smtp"
              ? t("승인된 업무 메일 계정을 사용합니다. 견적 요청별로 승인한 뒤 발송합니다.", "Uses the approved work mailbox. Each quote request is sent only after its own approval.")
            : t(
                "전송 연결이 비활성화되어 있습니다. 저장·승인은 이메일을 보내지 않습니다.",
                "Delivery is disabled. Saving and approving do not send email.",
              )}
        </p>
      </section>
      {!contact.contactReady && (
        <p className="banner" role="status">
          {contactReason(contact.blockedReason, language)}
        </p>
      )}
      <section className="contact-section stack">
        <header className="section-label">
          <h2>{t("저장된 견적 요청", "Saved RFQs")}</h2>
          <p className="muted">{contact.drafts.length}</p>
        </header>
        {contact.drafts.length ? (
          <div className="rfq-list">
            {contact.drafts.map((rfq) => {
              const spec = sourcing.data.specs.find(item => item.id === rfq.specId);
              return (
              <ContactRfqCard
                candidateId={candidateId}
                contactReady={contact.contactReady}
                deliveryMode={contact.deliveryMode}
                key={rfq.id}
                onChanged={refresh}
                rfq={rfq}
                specLabel={
                  spec ? `${spec.aiTaskId ? t("AI 제안 · ", "AI proposal · ") : ""}r${spec.revision} · ${spec.material}`
                    : t("사양 미확인", "Specification unknown")
                }
              />
              );
            })}
          </div>
        ) : (
          <p className="muted">
            {t(
              "저장된 견적 요청이 없어요.",
              "No RFQ drafts have been saved yet.",
            )}
          </p>
        )}
      </section>
      <details
        className="contact-preparation"
        open={contact.drafts.length === 0}
      >
        <summary>
          {t(
            "공급처 추가·새 요청 작성",
            "Add suppliers or compose a new request",
          )}
        </summary>
        <div className="contact-grid">
          <ContactSupplierForm candidateId={candidateId} specs={sourcing.data.specs} onSaved={refresh} />
          <ContactRfqForm
            candidateId={candidateId}
            product={candidate.data.candidate.keyword}
            suppliers={contact.suppliers}
            specs={sourcing.data.specs}
            onSaved={refresh}
          />
        </div>
        <section className="contact-section stack">
          <header className="section-label">
            <h2>{t("등록된 공급처", "Registered suppliers")}</h2>
            <p className="muted">{contact.suppliers.length}</p>
          </header>
          {contact.suppliers.length ? (
            <div className="supplier-list">
              {contact.suppliers.map((supplier) => (
                <article className="card supplier-card" key={supplier.id}>
                  <header className="rfq-heading">
                    <h3>{supplier.name}</h3>
                    <span
                      className={`chip chip-${supplier.matchStatus === "matches" && supplier.specId ? "ok" : supplier.matchStatus === "mismatch" ? "warn" : "unknown"}`}
                    >
                      {supplierMatchLabel(supplier, language)}
                    </span>
                  </header>
                  <dl className="supplier-details">
                    <div>
                      <dt>{t("확인한 사양", "Reviewed specification")}</dt>
                      <dd>{sourcing.data.specs.find(spec => spec.id === supplier.specId)?.revision ? `r${sourcing.data.specs.find(spec => spec.id === supplier.specId)?.revision}` : t("미확인 · 자동 초안 제외", "Unknown · no automatic draft")}</dd>
                    </div>
                    <div>
                      <dt>{t("이메일", "Email")}</dt>
                      <dd>{supplier.email ?? t("미확인", "Unknown")}</dd>
                    </div>
                    <div>
                      <dt>{t("확인 시점", "Observed at")}</dt>
                      <dd>{contactDate(supplier.observedAt, language)}</dd>
                    </div>
                  </dl>
                  <details>
                    <summary>
                      {t("출처·일치 근거 보기", "View source & match notes")}
                    </summary>
                    <p className="source-text">{supplier.source}</p>
                    <p className="source-text">
                      {supplier.matchNotes ||
                        t("일치 근거 미입력", "No match notes recorded.")}
                    </p>
                  </details>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">
              {t(
                "아직 등록한 공급처가 없어요.",
                "No suppliers have been registered yet.",
              )}
            </p>
          )}
        </section>
      </details>
    </div>
  );
}
