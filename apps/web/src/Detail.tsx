import { CandidateAiAnalysis } from "./CandidateAiAnalysis.tsx";
import { RepresentativeProduct } from "./RepresentativeProduct.tsx";
import {MarketSource} from './MarketSource.tsx';
import {ProductSource} from './ProductSource.tsx';
import {MarketRisk} from './MarketRisk.tsx';
import {AdditionalMarketObservations} from './AdditionalMarketObservations.tsx';
import { candidateApprovalPath } from "./candidate-links.ts";
import { CandidateValidation } from "./CandidateValidation.tsx";
import { useQuery } from "@tanstack/react-query";
import { NavLink, useParams } from "react-router";
import { getCandidate } from "./api.ts";
import { evidenceText } from "./evidence.ts";
import {EvidenceList,OfficialEvidence} from "./EvidenceList.tsx";
import {
  Empty,
  LoadError,
  Loading,
  PageHeader,
  Stage,
  Unknowns,
  useLocale,
} from "./ui.tsx";

export function Detail() {
  const { id } = useParams();
  const { t, language } = useLocale();
  const q = useQuery({
    queryKey: ["candidate", id, language],
    queryFn: () => getCandidate(id ?? "", language),
    enabled: Boolean(id),
  });
  const c = q.data?.candidate;
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError retry={() => void q.refetch()} />;
  if (!c)
    return (
      <Empty
        title={t("후보를 찾을 수 없어요", "Candidate not found")}
        description={t(
          "후보 목록에서 다시 선택해 주세요.",
          "Select a candidate from the list.",
        )}
        to="/candidates"
        action={t("후보 보기", "View candidates")}
      />
    );
  const approvalPath = candidateApprovalPath(c);
  return (
    <>
      <NavLink className="back-link" to="/candidates">
        {t("후보 목록으로", "Back to candidates")}
      </NavLink>
      <PageHeader
        eyebrow={t("후보 상세", "Candidate detail")}
        title={c.keyword}
      />
      <section className="stack">
        <h2>{t("다음 행동", "Next action")}</h2>
        <article className="card stack">
          <Stage>{c.stageLabel}</Stage>
          <p>{c.nextAction.label}</p>
          {approvalPath && (
            <NavLink className="btn btn-primary" to={approvalPath}>
              {c.nextAction.label}
            </NavLink>
          )}
        </article>
      </section>
      <section className="detail-section">
        <h2>{t("모르는 것", "Unknown")}</h2>
        <Unknowns values={c.unknowns} />
      </section>
      <section className="detail-section">
        <h2>{t("근거", "Evidence")}</h2>
        <div className="ph-image">{t("이미지 없음", "No image")}</div>
        <p>{evidenceText(c.evidenceSummary, language)}</p>
        <CandidateValidation view={q.data.validation} />
        <EvidenceList items={q.data.evidence.filter(e=>!e.field.startsWith("api_"))}/>
        <OfficialEvidence items={q.data.evidence.filter(e=>e.field.startsWith("api_"))}/>
      </section>
      <MarketRisk view={q.data.validation}/>
      <AdditionalMarketObservations items={q.data.evidence}/>
      <RepresentativeProduct key={c.id} candidateId={c.id} evidence={q.data.evidence} />
      <ProductSource key={'product-'+c.id} candidateId={c.id}/>
      <MarketSource key={'market-'+c.id} candidateId={c.id}/>
      <CandidateAiAnalysis candidateId={c.id} />
      <nav className="btn-row" aria-label={t("관련 작업", "Related work")}>
        <NavLink
          className="btn btn-secondary"
          to={`/sourcing?candidate=${encodeURIComponent(c.id)}`}
        >
          {t("견적 기록·비교", "Record & compare quotes")}
        </NavLink>
        <NavLink
          className="btn btn-secondary"
          to={`/candidates/${encodeURIComponent(c.id)}/contact`}
        >
          {t("공급처 연락 준비", "Prepare supplier contact")}
        </NavLink>
        <NavLink
          className="btn btn-secondary"
          to={`/candidates/${encodeURIComponent(c.id)}/orders`}
        >
          {t("발주 판단 보기", "Review order decision")}
        </NavLink>
      </nav>
    </>
  );
}
