import { SpecProvenance } from "./SpecProvenance.tsx";
import type { OrderPacketPayload } from '../../../packages/domain/src/order.ts';
import { COST_FIELDS } from '../../../packages/domain/src/sourcing.ts';
import { costLabels, quoteReason } from './quote-fields.ts';
import { useLocale } from './ui.tsx';
export function OrderEvidence({snapshot}:{snapshot:OrderPacketPayload}) {
  const {t,language}=useLocale();
  const {spec,quote}=snapshot.source;
  const totals=snapshot.assessment.totals;
  const unknown=t('미확인','Unknown');
  const values=[
    [t('공급처','Supplier'),quote.supplierName],
    [t('사양','Specification'),`r${spec.revision} · ${spec.material}`],
    [t('치수·단위','Dimensions and units'),spec.dimensions],
    [t('포장','Packaging'),spec.packaging],
    [t('품질·인증 요구','Quality and certification'),spec.requirements],
    [t('수량 / MOQ','Quantity / MOQ'),`${quote.quantity} / ${quote.moq}`],
    [t('거래 조건','Incoterm'),quote.incoterm],
    [t('견적 유효일','Quote valid until'),quote.validUntil??unknown],
    [t('적용 기준','Applied criteria'),`v${snapshot.settings.version}`],
    [t('출시 현금','Launch cash'),totals?`USD ${totals.launchCash}`:unknown],
    [t('광고 후 마진','Margin after ads'),totals?`${totals.marginAfterAdsPct}%`:unknown],
    ['ROI',totals?`${totals.roiPct}%`:unknown],
    [t('승인 시 예약 금액','Cash reserved on approval'),snapshot.reservation?`USD ${snapshot.reservation.reservedUsd}`:t('예약 없음','No reservation')],
    [t('필수 위험 확인','Required risk checks'),quote.risksConfirmed?t('확인됨','Checked'):unknown],
  ];
  return <div className="order-snapshot-grid">
    <SpecProvenance aiTaskId={spec.aiTaskId} />
    <dl className="order-values">{values.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {snapshot.assessment.reasons.length>0&&<ul>{snapshot.assessment.reasons.map(reason=><li key={reason}>{quoteReason(reason,language)}</li>)}</ul>}
    <details>
      <summary>{t('비용별 금액과 근거','Amounts and evidence for each cost')}</summary>
      <dl className="order-values">{COST_FIELDS.map(field=>{
        const cost=quote.costs[field];
        const kind=cost.kind==='unknown'?unknown:cost.kind==='quote'?t('견적','Quote'):cost.kind==='estimate'?t('추정','Estimate'):t('측정','Measured');
        return <div key={field}><dt>{costLabels[field][language==='ko'?0:1]}</dt><dd>{cost.value===null?unknown:`USD ${cost.value}`} · {kind}</dd><dd className="source-text">{cost.source??cost.reason??unknown}</dd></div>;
      })}</dl>
    </details>
    <details>
      <summary>{t('사양·견적 원문과 위험 근거','Specification, quote and risk evidence')}</summary>
      <p className="source-text">{t('사양 출처','Specification source')}: {spec.source}</p>
      <p className="source-text">{t('공급처 출처','Supplier source')}: {quote.supplierSource}</p>
      <p className="source-text">{quote.sourceText}</p>
      <p className="source-text">{t('위험 확인 근거','Risk evidence')}: {quote.riskSource||unknown}</p>
    </details>
  </div>;
}
