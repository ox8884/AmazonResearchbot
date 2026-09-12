import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Evidence } from './api.ts';
import { EvidenceList } from './EvidenceList.tsx';
import { getRepresentative, saveRepresentative, RepresentativeError } from './representative-api.ts';
import { useLocale } from './ui.tsx';

export function RepresentativeProduct({ candidateId, evidence }: { candidateId: string; evidence: readonly Evidence[] }) {
  const { t } = useLocale();
  const client = useQueryClient();
  const q = useQuery({ queryKey: ['representative', candidateId], queryFn: () => getRepresentative(candidateId), retry: false,refetchInterval:current=>current.state.data?.editable?15000:false });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<'saved' | 'changed' | 'failed' | null>(null);
  const view = q.data;
  const selected = draft || view?.selectedAsin || '';
  const facts = evidence.filter(e => e.field === `api_catalog_dimensions:${selected}` || e.field === `api_catalog_weight:${selected}`);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!view || busy || !view.editable || !view.availableAsins.includes(selected) || selected === view.selectedAsin) return;
    setBusy(true); setMessage(null);
    try {
      await saveRepresentative(candidateId, { asin: selected, inputVersion: view.inputVersion });
      setMessage('saved');
    } catch (error) {
      setMessage(error instanceof RepresentativeError && error.code === 'CHANGED' ? 'changed' : 'failed');
    } finally {
      setDraft('');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['representative', candidateId] }),
        client.invalidateQueries({ queryKey: ['candidate', candidateId] }),
        client.invalidateQueries({ queryKey: ['candidates'] }),
        client.invalidateQueries({ queryKey: ['market-source',candidateId] }),
        client.invalidateQueries({ queryKey: ['product-source',candidateId] }),
      ]);
      setBusy(false);
    }
  }
  return <section className="detail-section stack" aria-labelledby="representative-heading">
    <h2 id="representative-heading">{t('실제 소싱할 상품', 'Product to source')}</h2>
    <p className="muted">{t('규격을 확인할 대표 ASIN을 선택하세요. 다른 상품의 치수로 대신 판정하지 않습니다.', 'Choose the representative ASIN for size checks. Measurements from another product do not apply.')}</p>
    {q.isPending ? <p role="status">{t('상품 목록 확인 중', 'Loading products')}</p> : q.isError ?
      <div className="stack"><p role="alert">{t('상품 목록을 불러오지 못했어요.', 'Could not load products.')}</p><button className="btn btn-secondary" onClick={() => void q.refetch()}>{t('다시 확인', 'Retry')}</button></div> : view && <>
      <p>{t('저장된 대표 ASIN', 'Saved representative ASIN')}: <strong>{view.selectedAsin ?? t('아직 선택하지 않음', 'Not selected')}</strong></p>
      {!view.editable ? <p className="muted">{t('현재 단계 또는 저장된 비교 사양 때문에 대표 상품을 변경할 수 없어요.', 'The current stage or a saved specification prevents changing the product.')}</p> : !view.availableAsins.length ?
        <p className="muted">{t('상품 DB 또는 Amazon 첫 페이지에서 현재 후보의 ASIN을 확인하면 선택할 수 있어요.', 'Selection becomes available when Product Database or current Amazon first-page observations identify the candidate’s ASINs.')}</p> :
        <form className="stack" onSubmit={submit}>
          <div className="field"><label htmlFor="representative-asin">{t('대표 ASIN', 'Representative ASIN')}</label>
            <select id="representative-asin" value={selected} disabled={busy || q.isFetching} onChange={e => { setDraft(e.target.value); setMessage(null); }}>
              <option value="">{t('상품 선택', 'Select a product')}</option>
              {view.selectedAsin && !view.availableAsins.includes(view.selectedAsin) && <option value={view.selectedAsin}>{view.selectedAsin}</option>}
              {view.availableAsins.map(asin => <option key={asin} value={asin}>{asin}{view.titles?.[asin]?' · '+view.titles[asin]:''}</option>)}
            </select>
          </div>
          <p className="muted">{t('변경하면 이전 판정은 다시 확인합니다. 상품 선택만으로 Standard 규격이 확정되지는 않습니다.', 'Changing the product requires reassessment. Selecting it does not confirm Standard size.')}</p>
          <div className="btn-row"><button className="btn btn-primary" disabled={busy || q.isFetching || !view.availableAsins.includes(selected) || selected === view.selectedAsin}>{busy ? t('저장 중', 'Saving') : t('대표 상품 저장', 'Save representative product')}</button></div>
        </form>}
      {selected && (facts.length ? <EvidenceList items={facts} /> : <p className="muted">{t('이 상품의 현재 치수·무게 근거를 기다리고 있어요.', 'Waiting for current dimensions and weight for this product.')}</p>)}
    </>}
    {message === 'saved' && <p role="status">{t('대표 상품을 저장했습니다. 근거를 다시 확인합니다.', 'Representative product saved. Evidence will be checked again.')}</p>}
    {(message === 'changed' || message === 'failed') && <p className="banner" role="alert">{message === 'changed' ? t('후보 상태나 상품 목록이 바뀌었어요. 새 목록을 확인하고 다시 선택해 주세요.', 'The candidate or product list changed. Review the refreshed list and select again.') : t('저장 결과를 확인하지 못했어요. 저장된 대표 ASIN을 확인한 뒤 다시 시도해 주세요.', 'Could not confirm the save. Check the saved representative ASIN before retrying.')}</p>}
  </section>;
}
