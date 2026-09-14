import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon, LoadError, Loading, useLocale } from './ui.tsx';

type ResearchKind = 'product_database' | 'keyword_scout' | 'historical_data' | 'category_trends' | 'competitive_intelligence';
type PendingResearch = {
  readonly kind: ResearchKind;
  readonly state: 'not_collected' | 'stale' | 'waiting' | 'collecting' | 'unavailable';
  readonly reason?: string;
};
type CapturedResearch = {
  readonly kind: ResearchKind;
  readonly state: 'captured';
  readonly sourcePageUrl: string;
  readonly observedAt: string;
  readonly provenance: { readonly source: 'jungle_scout_web'; readonly receiptId: string; readonly resultHash: string };
  readonly result: Record<string, unknown>;
};
type ResearchItem = PendingResearch | CapturedResearch;

const labels: Record<ResearchKind, readonly [string, string]> = {
  product_database: ['상품 DB', 'Product Database'],
  keyword_scout: ['키워드 Scout', 'Keyword Scout'],
  historical_data: ['Historical Data', 'Historical Data'],
  category_trends: ['카테고리 트렌드', 'Category Trends'],
  competitive_intelligence: ['경쟁 분석', 'Competitive Intelligence'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isResearchKind(value: unknown): value is ResearchKind {
  return value === 'product_database' || value === 'keyword_scout' || value === 'historical_data' || value === 'category_trends' || value === 'competitive_intelligence';
}

function isResearchItem(value: unknown): value is ResearchItem {
  if (!isRecord(value) || !isResearchKind(value.kind) || typeof value.state !== 'string') return false;
  if (value.state === 'captured') return typeof value.sourcePageUrl === 'string' && typeof value.observedAt === 'string' && isRecord(value.provenance) && isRecord(value.result);
  return (value.reason === undefined || typeof value.reason === 'string') && (value.state === 'not_collected' || value.state === 'stale' || value.state === 'waiting' || value.state === 'collecting' || value.state === 'unavailable');
}

async function loadResearch(candidateId: string): Promise<readonly ResearchItem[]> {
  const response = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}/jungle-scout-research`, { credentials: 'include', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('JUNGLE_SCOUT_RESEARCH_UNAVAILABLE');
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.research) || !body.research.every(isResearchItem)) throw new Error('JUNGLE_SCOUT_RESEARCH_INVALID');
  return body.research;
}

async function retryResearch(candidateId: string, kind: ResearchKind): Promise<void> {
  const response = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}/jungle-scout-research/${kind}/retry`, { method: 'POST', credentials: 'include', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(response.status === 409 ? 'JUNGLE_SCOUT_DAILY_LIMIT_DISABLED' : 'JUNGLE_SCOUT_RETRY_FAILED');
}

function status(item: ResearchItem, t: (ko: string, en: string) => string) {
  switch (item.state) {
    case 'captured': return { label: t('수집됨', 'Captured'), style: 'ok' as const, icon: 'check' as const };
    case 'collecting': return { label: t('수집 중', 'Collecting'), style: 'stage' as const, icon: 'clock' as const };
    case 'waiting': return { label: t('재연결 대기', 'Waiting to retry'), style: 'warn' as const, icon: 'clock' as const };
    case 'stale': return { label: t('이전 입력', 'Previous input'), style: 'warn' as const, icon: 'warning' as const };
    case 'unavailable': return { label: t('결과를 읽지 못함', 'Result unavailable'), style: 'unknown' as const, icon: 'unknown' as const };
    case 'not_collected': return { label: t('아직 수집 전', 'Not collected'), style: 'unknown' as const, icon: 'unknown' as const };
  }
}

function records(input: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(input) ? input.filter(isRecord) : [];
}

function values(input: unknown): readonly string[] {
  return Array.isArray(input) ? input.filter((value): value is string => typeof value === 'string' && value.trim().length > 0) : [];
}

function valueText(value: unknown, unknownText: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return unknownText;
}

function ObservedField({ label, value, unknownText }: { readonly label: string; readonly value: unknown; readonly unknownText: string }) {
  const rendered = valueText(value, unknownText);
  return <div className={rendered === unknownText ? 'jungle-scout-field is-unknown' : 'jungle-scout-field'}><dt>{label}</dt><dd>{rendered}</dd></div>;
}

function ObservedFields({ fields }: { readonly fields: readonly { readonly label: string; readonly value: unknown }[] }) {
  const { t } = useLocale();
  const unknownText = t('미확인', 'Unknown');
  return <dl className="jungle-scout-fields">{fields.map(field => <ObservedField key={field.label} label={field.label} value={field.value} unknownText={unknownText} />)}</dl>;
}

function ProductRecords({ rows }: { readonly rows: readonly Record<string, unknown>[] }) {
  const { t } = useLocale();
  if (!rows.length) return <p className="muted">{t('화면에서 확인된 상품이 없습니다.', 'No products were visible in the captured page.')}</p>;
  const field = (row: Record<string, unknown>, key: string) => row[key];
  return <div className="jungle-scout-record-list">{rows.map((row, index) => <article className="jungle-scout-record" key={valueText(row.asin, `product-${index}`)}>
    <ObservedFields fields={[
      { label: t('ASIN', 'ASIN'), value: field(row, 'asin') },
      { label: t('상품명', 'Title'), value: field(row, 'title') },
      { label: t('브랜드', 'Brand'), value: field(row, 'brand') },
      { label: t('카테고리', 'Category'), value: field(row, 'categoryPath') },
      { label: t('BSR', 'BSR'), value: field(row, 'bsr') },
      { label: t('월 판매량', 'Monthly units'), value: field(row, 'unitsSoldMonthly') },
      { label: t('월 매출', 'Monthly revenue'), value: field(row, 'revenueMonthly') },
      { label: t('가격', 'Price'), value: field(row, 'price') },
      { label: t('리뷰', 'Reviews'), value: field(row, 'reviews') },
      { label: t('별점', 'Rating'), value: field(row, 'starRating') },
      { label: t('판매자 수', 'Sellers'), value: field(row, 'sellers') },
      { label: t('치수', 'Dimensions'), value: field(row, 'dimensions') },
      { label: t('무게', 'Weight'), value: field(row, 'weight') },
    ]} />
  </article>)}</div>;
}

function KeywordRecords({ rows }: { readonly rows: readonly Record<string, unknown>[] }) {
  const { t } = useLocale();
  if (!rows.length) return null;
  const field = (row: Record<string, unknown>, key: string) => row[key];
  return <div className="jungle-scout-record-list">{rows.map((row, index) => <article className="jungle-scout-record" key={`${valueText(row.keyword, 'keyword')}-${index}`}>
    <ObservedFields fields={[
      { label: t('키워드', 'Keyword'), value: field(row, 'keyword') },
      { label: t('30일 검색 추이', '30-day search trend'), value: field(row, 'searchTrend30Day') },
      { label: t('30일 정확 검색량', '30-day exact search volume'), value: field(row, 'exactSearchVolume30Day') },
      { label: t('카테고리', 'Category'), value: field(row, 'category') },
      { label: t('PPC 입찰가 · Exact', 'PPC bid · Exact'), value: field(row, 'ppcBidExact') },
      { label: t('PPC 입찰가 · Broad', 'PPC bid · Broad'), value: field(row, 'ppcBidBroad') },
      { label: t('순위 난이도', 'Ease to rank'), value: field(row, 'easeToRank') },
      { label: t('관련성 점수', 'Relevancy score'), value: field(row, 'relevancyScore') },
    ]} />
  </article>)}</div>;
}

function Result({ item }: { readonly item: CapturedResearch }) {
  const { t } = useLocale();
  switch (item.kind) {
    case 'product_database': {
      const rows = records(item.result.records);
      const complete = item.result.coverage === 'complete';
      return <details className="jungle-scout-results"><summary>{t(`확인한 상품 ${rows.length}개`, `View ${rows.length} observed products`)}</summary>
        <p className="muted">{t('조회 범위', 'Result coverage')}: {complete ? t(`전체 ${valueText(item.result.totalCount, '미확인')}건`, `All ${valueText(item.result.totalCount, 'unknown')} results`) : t('전체 범위 미확인', 'Full result coverage unknown')}</p>
        <ProductRecords rows={rows} />
      </details>;
    }
    case 'keyword_scout': {
      const keywordRows = records(item.result.keywordRecords);
      const metrics = records(item.result.metrics);
      const related = values(item.result.relatedKeywords);
      const asins = values(item.result.asinRelations);
      return <details className="jungle-scout-results"><summary>{t(`확인한 키워드 ${keywordRows.length || metrics.length}개`, `View ${keywordRows.length || metrics.length} observed keyword rows`)}</summary>
        {keywordRows.length ? <KeywordRecords rows={keywordRows} /> : metrics.length ? <div className="jungle-scout-legacy-list">{metrics.map((row, index) => <div className="jungle-scout-legacy-row" key={`${valueText(row.label, 'metric')}-${index}`}><strong>{valueText(row.label, t('항목 미확인', 'Metric unknown'))}</strong><span>{valueText(row.value, t('미확인', 'Unknown'))}</span></div>)}</div> : <p className="muted">{t('화면에서 확인된 키워드가 없습니다.', 'No keyword rows were visible in the captured page.')}</p>}
        {related.length ? <p className="muted">{t('연관 키워드', 'Related keywords')}: {related.join(' · ')}</p> : null}
        {asins.length ? <p className="muted">{t('연결된 ASIN', 'Observed ASINs')}: {asins.join(' · ')}</p> : null}
      </details>;
    }
    case 'historical_data': {
      const range = isRecord(item.result.dateRange) ? item.result.dateRange : null;
      const series = records(item.result.series);
      return <details className="jungle-scout-results"><summary>{t('확인한 추이 보기', 'View observed trend')}</summary>
        <p className="muted">{t('관측 기간', 'Observed range')}: {valueText(range?.label, t('기간 미확인', 'Range unknown'))}</p>
        {series.length ? <div className="jungle-scout-record-list">{series.map((row, index) => <article className="jungle-scout-record" key={`${valueText(row.metric, 'metric')}-${index}`}><ObservedFields fields={[{ label: t('지표', 'Metric'), value: row.metric }, { label: t('기간', 'Period'), value: row.periodLabel }, { label: t('값', 'Value'), value: row.value }]} /></article>)}</div> : <p className="muted">{t('화면에서 확인된 추이 값이 없습니다.', 'No trend values were visible in the captured page.')}</p>}
      </details>;
    }
    case 'category_trends': {
      const categories = values(item.result.categories);
      const signals = records(item.result.signals);
      const products = records(item.result.products);
      const dateColumns = records(item.result.dateColumns);
      const confirmed = item.result.kitchenDiningConfirmation === 'confirmed';
      return <details className="jungle-scout-results"><summary>{t('확인한 카테고리 자료 보기', 'View observed category research')}</summary>
        <p>{t('Kitchen & Dining 분류', 'Kitchen & Dining classification')}: {confirmed ? t('확인됨', 'Confirmed') : t('미확인', 'Not confirmed')}</p>
        <p className="muted">{t('표시된 카테고리', 'Observed categories')}: {categories.length ? categories.join(' · ') : t('미확인', 'Unknown')}</p>
        <p className="muted">{t('관측 날짜', 'Observed dates')}: {dateColumns.length ? dateColumns.map(column => valueText(column.dateLabel, t('미확인', 'Unknown'))).join(' · ') : t('미확인', 'Unknown')}</p>
        {products.length ? <div className="jungle-scout-record-list">{products.map((row, index) => <article className="jungle-scout-record" key={`${valueText(row.asin, 'category-product')}-${valueText(row.dateLabel, String(index))}`}><ObservedFields fields={[{ label: t('날짜', 'Date'), value: row.dateLabel }, { label: t('순위', 'Rank'), value: row.rank }, { label: t('ASIN', 'ASIN'), value: row.asin }, { label: t('상품명', 'Product'), value: row.productName }, { label: t('가격', 'Price'), value: row.price }, { label: t('리뷰', 'Reviews'), value: row.reviews }, { label: t('별점', 'Rating'), value: row.rating }]} /></article>)}</div> : null}
        {signals.length ? <div className="jungle-scout-record-list">{signals.map((row, index) => <article className="jungle-scout-record" key={`${valueText(row.label, 'signal')}-${index}`}><ObservedFields fields={[{ label: t('신호', 'Signal'), value: row.label }, { label: t('값', 'Value'), value: row.value }]} /></article>)}</div> : null}
      </details>;
    }
    case 'competitive_intelligence': {
      const competitors = records(item.result.competitors);
      const entitlement = isRecord(item.result.entitlement) ? item.result.entitlement : null;
      const upgradeRequired = entitlement?.status === 'upgrade_required';
      return <details className="jungle-scout-results"><summary>{t(`확인한 경쟁 상품 ${competitors.length}개`, `View ${competitors.length} observed competitors`)}</summary>
        {upgradeRequired ? <p className="banner">{t('현재 구독에서는 Competitive Intelligence 실데이터가 잠겨 있어 Product Database 전체 조회 결과로 비교했습니다.', 'Competitive Intelligence data is locked on the current subscription, so this comparison uses the full Product Database result.')}</p> : null}
        <ObservedFields fields={[
          { label: t('비교 근거', 'Comparison basis'), value: item.result.comparisonBasis === 'product_database' ? 'Product Database' : 'Competitive Intelligence' },
          { label: t('조회 범위', 'Result coverage'), value: item.result.coverage === 'complete' ? t(`전체 ${valueText(item.result.totalCount, '미확인')}건`, `All ${valueText(item.result.totalCount, 'unknown')} results`) : t('전체 범위 미확인', 'Full result coverage unknown') },
          { label: t('현재 플랜', 'Current plan'), value: entitlement?.currentPlan },
          { label: t('필요 플랜', 'Required plan'), value: entitlement?.requiredPlan },
        ]} />
        <p className="muted">{t('대표 ASIN', 'Representative ASIN')}: {valueText(item.result.representativeAsin, t('미확인', 'Unknown'))}</p>
        {competitors.length ? <div className="jungle-scout-record-list">{competitors.map((row, index) => <article className="jungle-scout-record" key={`${valueText(row.asin, 'competitor')}-${index}`}><ObservedFields fields={[{ label: t('ASIN', 'ASIN'), value: row.asin }, { label: t('브랜드', 'Brand'), value: row.brand }, { label: t('가격', 'Price'), value: row.price }, { label: t('리뷰', 'Reviews'), value: row.reviews }, { label: t('판매량', 'Sales'), value: row.sales }, { label: t('매출', 'Revenue'), value: row.revenue }]} /></article>)}</div> : <p className="muted">{t('화면에서 확인된 경쟁 상품이 없습니다.', 'No competitors were visible in the captured page.')}</p>}
      </details>;
    }
  }
}

function pendingMessage(item: PendingResearch, t: (ko: string, en: string) => string): string {
  switch (item.state) {
    case 'not_collected': return t('현재 입력에 연결된 관측이 없습니다.', 'No observation is linked to the current input.');
    case 'stale': return t('입력 또는 기준이 바뀌어 이전 결과를 현재 근거로 쓰지 않습니다.', 'Inputs or criteria changed, so the previous result is not used as current evidence.');
    case 'unavailable': return t('저장된 결과를 안전하게 확인하지 못했습니다. 새 관측이 필요합니다.', 'The saved result could not be safely verified. A new observation is needed.');
    case 'collecting': return t('ASIDE가 실제 화면을 확인하고 있습니다.', 'ASIDE is reading the live page.');
    case 'waiting': return t('ASIDE 연결과 다음 작업을 기다리고 있습니다.', 'Waiting for the ASIDE connection and the next task.');
  }
}

function reasonMessage(reason: string, t: (ko: string, en: string) => string): string {
  switch (reason) {
    case 'RESULT_RECEIPT_MISSING': return t('저장된 관측 영수증이 없습니다.', 'The saved observation receipt is missing.');
    case 'RESULT_HASH_MISMATCH': return t('저장된 관측의 무결성을 확인하지 못했습니다.', 'The saved observation integrity could not be verified.');
    case 'OBSERVATION_INVALID': return t('관측 형식이 맞지 않아 표시하지 않습니다.', 'The observation format is invalid, so it is not shown.');
    case 'RESULT_DECRYPTION_FAILED': return t('보호된 관측을 확인하지 못했습니다.', 'The protected observation could not be read.');
    case 'INPUT_OR_SETTINGS_CHANGED': return t('후보 입력 또는 승인 기준이 바뀌었습니다.', 'The candidate input or approved settings changed.');
    case 'BROWSER_TASK_EXPIRED': return t('브라우저 작업이 끝나기 전에 만료되었습니다. 연결되면 다시 진행합니다.', 'The browser task expired before completion and will resume when connected.');
    default: return t('추가 확인이 필요한 상태입니다.', 'Further verification is needed.');
  }
}

function PendingResearchView({ item, retry, retrying, retryError }: { readonly item: PendingResearch; readonly retry: () => void; readonly retrying: boolean; readonly retryError: boolean }) {
  const { t } = useLocale();
  const refreshable = item.state === 'waiting' || item.state === 'unavailable';
  return <div className="jungle-scout-pending"><span className="muted">{pendingMessage(item, t)}</span>{item.reason ? <span className="muted">{reasonMessage(item.reason, t)}</span> : null}{retryError ? <span className="banner">{t('일일 호출 한도가 0이거나 재시도 요청을 저장하지 못했습니다. 설정을 확인해 주세요.', 'The daily limit is zero or the retry request could not be saved. Check settings.')}</span> : null}{refreshable ? <button type="button" className="text-btn" onClick={retry} disabled={retrying}>{retrying ? t('재시도 요청 중', 'Requesting retry') : t('이 단계 재시도', 'Retry this step')}</button> : null}</div>;
}

export function JungleScoutResearch({ candidateId }: { readonly candidateId: string }) {
  const { t, language } = useLocale();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['jungle-scout-research', candidateId], queryFn: () => loadResearch(candidateId), retry: false, refetchInterval: 15_000 });
  const retry = useMutation({ mutationFn: (kind: ResearchKind) => retryResearch(candidateId, kind), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jungle-scout-research', candidateId] }) });
  return <section className="detail-section stack" aria-labelledby="jungle-scout-research-heading">
    <h2 id="jungle-scout-research-heading">{t('Jungle Scout 조사', 'Jungle Scout research')}</h2>
    <p className="muted">{t('각 항목은 ASIDE가 실제 화면에서 읽은 자료입니다. 미표시 값은 추정하거나 0으로 바꾸지 않습니다.', 'Each item comes from what ASIDE read on the actual page. Values not displayed remain unknown; they are never estimated or changed to zero.')}</p>
    {query.isPending ? <Loading /> : query.isError ? <LoadError retry={() => void query.refetch()} /> : <div className="evidence-list jungle-scout-evidence">{query.data?.map(item => {
      const current = status(item, t);
      return <article className="evidence-row jungle-scout-item" key={item.kind}><div className="jungle-scout-item-body">
        <div className="section-label"><h3>{labels[item.kind][language === 'ko' ? 0 : 1]}</h3><span className={`chip chip-${current.style}`}><Icon name={current.icon} />{current.label}</span></div>
        {item.state === 'captured' ? <><span className="muted">{t('출처', 'Source')}: {t('Jungle Scout 웹 화면', 'Jungle Scout web page')}</span><span className="muted">{t('관측 시각', 'Observed')}: {new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.observedAt))}</span><a className="text-btn" href={item.sourcePageUrl} target="_blank" rel="noopener noreferrer">{t('Jungle Scout 원본 보기', 'View Jungle Scout source')}</a><Result item={item} /></> : <PendingResearchView item={item} retry={() => retry.mutate(item.kind)} retrying={retry.isPending && retry.variables === item.kind} retryError={retry.isError && retry.variables === item.kind} />}
      </div></article>;
    })}</div>}
  </section>;
}
