import { useQuery } from '@tanstack/react-query';
import { LoadError, Loading, useLocale } from './ui.tsx';

type ResearchKind = 'product_database' | 'keyword_scout' | 'historical_data' | 'category_trends' | 'competitive_intelligence';
type PendingResearch = { readonly kind: ResearchKind; readonly state: 'not_collected' | 'stale' | 'waiting' | 'collecting' | 'unavailable' };
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
  return value.state === 'not_collected' || value.state === 'stale' || value.state === 'waiting' || value.state === 'collecting' || value.state === 'unavailable';
}

async function loadResearch(candidateId: string): Promise<readonly ResearchItem[]> {
  const response = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}/jungle-scout-research`, { credentials: 'include', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('JUNGLE_SCOUT_RESEARCH_UNAVAILABLE');
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.research) || !body.research.every(isResearchItem)) throw new Error('JUNGLE_SCOUT_RESEARCH_INVALID');
  return body.research;
}

function status(item: ResearchItem, t: (ko: string, en: string) => string) {
  switch (item.state) {
    case 'captured': return { label: t('수집됨', 'Captured'), style: 'ok' };
    case 'collecting': return { label: t('수집 중', 'Collecting'), style: 'stage' };
    case 'waiting': return { label: t('재연결 대기', 'Waiting to retry'), style: 'warn' };
    case 'stale': return { label: t('이전 입력', 'Previous input'), style: 'warn' };
    case 'unavailable': return { label: t('결과를 읽지 못함', 'Result unavailable'), style: 'unknown' };
    case 'not_collected': return { label: t('아직 수집 전', 'Not collected'), style: 'unknown' };
  }
}

function values(input: unknown): readonly string[] {
  return Array.isArray(input) ? input.filter((value): value is string => typeof value === 'string') : [];
}
function records(input: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(input) ? input.filter(isRecord) : [];
}
function display(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function Result({ item }: { readonly item: CapturedResearch }) {
  const { t } = useLocale();
  const missing = t('화면에서 확인된 값이 없습니다.', 'No values were visible in the captured page.');
  switch (item.kind) {
    case 'product_database': {
      const rows = records(item.result.records);
      return rows.length ? <details><summary>{t(`확인한 상품 ${rows.length}개`, `View ${rows.length} observed products`)}</summary><div className="evidence-list">{rows.map(row => <div className="evidence-row" key={display(row.asin, 'unknown')}><div><strong>{display(row.title, t('상품명 미확인', 'Title unknown'))}</strong><span className="muted">{display(row.asin, t('ASIN 미확인', 'ASIN unknown'))}</span></div></div>)}</div></details> : <p className="muted">{missing}</p>;
    }
    case 'keyword_scout': {
      const metrics = records(item.result.metrics);
      const related = values(item.result.relatedKeywords);
      const asins = values(item.result.asinRelations);
      return <details><summary>{t('확인한 키워드 자료 보기', 'View observed keyword research')}</summary>{metrics.length ? <div className="evidence-list">{metrics.map(row => <div className="evidence-row" key={display(row.label, 'unknown')}><div><strong>{display(row.label, t('항목 미확인', 'Metric unknown'))}</strong><span>{display(row.value, t('미확인', 'Unknown'))}</span></div></div>)}</div> : <p className="muted">{missing}</p>}{related.length ? <p className="muted">{t('연관 키워드', 'Related keywords')}: {related.join(' · ')}</p> : null}{asins.length ? <p className="muted">{t('연결된 ASIN', 'Observed ASINs')}: {asins.join(' · ')}</p> : null}</details>;
    }
    case 'historical_data': {
      const range = item.result.dateRange;
      const series = records(item.result.series);
      const rangeLabel = range && typeof range === 'object' && 'label' in range ? display(range.label, t('기간 미확인', 'Range unknown')) : null;
      return <details><summary>{t('확인한 추이 보기', 'View observed trend')}</summary>{rangeLabel ? <p className="muted">{t('관측 기간', 'Observed range')}: {rangeLabel}</p> : <p className="muted">{t('기간이 화면에 표시되지 않았습니다.', 'No date range was visible on the page.')}</p>}{series.length ? <div className="evidence-list">{series.map((row, index) => <div className="evidence-row" key={`${display(row.metric, 'metric')}-${index}`}><div><strong>{display(row.metric, t('지표 미확인', 'Metric unknown'))}</strong><span>{display(row.periodLabel, t('기간 미확인', 'Period unknown'))} · {display(row.value, t('미확인', 'Unknown'))}</span></div></div>)}</div> : <p className="muted">{missing}</p>}</details>;
    }
    case 'category_trends': {
      const categories = values(item.result.categories);
      const signals = records(item.result.signals);
      const confirmed = item.result.kitchenDiningConfirmation === 'confirmed';
      return <details><summary>{t('확인한 카테고리 자료 보기', 'View observed category research')}</summary><p>{t('Kitchen & Dining 분류', 'Kitchen & Dining classification')}: {confirmed ? t('확인됨', 'Confirmed') : t('미확인', 'Not confirmed')}</p>{categories.length ? <p className="muted">{t('표시된 카테고리', 'Observed categories')}: {categories.join(' · ')}</p> : <p className="muted">{t('카테고리가 화면에 표시되지 않았습니다.', 'No category was visible on the page.')}</p>}{signals.length ? <div className="evidence-list">{signals.map(row => <div className="evidence-row" key={display(row.label, 'unknown')}><div><strong>{display(row.label, t('신호 미확인', 'Signal unknown'))}</strong><span>{display(row.value, t('미확인', 'Unknown'))}</span></div></div>)}</div> : null}</details>;
    }
    case 'competitive_intelligence': {
      const competitors = records(item.result.competitors);
      const representative = display(item.result.representativeAsin, t('대표 ASIN 미확인', 'Representative ASIN unknown'));
      return <details><summary>{t('확인한 경쟁 상품 보기', 'View observed competitors')}</summary><p className="muted">{t('대표 ASIN', 'Representative ASIN')}: {representative}</p>{competitors.length ? <div className="evidence-list">{competitors.map(row => <div className="evidence-row" key={display(row.asin, 'unknown')}><div><strong>{display(row.asin, t('ASIN 미확인', 'ASIN unknown'))} · {display(row.brand, t('브랜드 미확인', 'Brand unknown'))}</strong><span>{t('가격', 'Price')}: {display(row.price, t('미확인', 'Unknown'))} · {t('리뷰', 'Reviews')}: {display(row.reviews, t('미확인', 'Unknown'))}</span><span className="muted">{t('판매량', 'Sales')}: {display(row.sales, t('미확인', 'Unknown'))} · {t('매출', 'Revenue')}: {display(row.revenue, t('미확인', 'Unknown'))}</span></div></div>)}</div> : <p className="muted">{missing}</p>}</details>;
    }
  }
}

export function JungleScoutResearch({ candidateId }: { readonly candidateId: string }) {
  const { t, language } = useLocale();
  const query = useQuery({ queryKey: ['jungle-scout-research', candidateId], queryFn: () => loadResearch(candidateId), retry: false, refetchInterval: 15_000 });
  return <section className="detail-section stack" aria-labelledby="jungle-scout-research-heading">
    <h2 id="jungle-scout-research-heading">{t('Jungle Scout 조사', 'Jungle Scout research')}</h2>
    <p className="muted">{t('각 항목은 ASIDE가 실제 화면에서 읽은 자료입니다. 미표시 값은 추정하거나 0으로 바꾸지 않습니다.', 'Each item comes from what ASIDE read on the actual page. Values not displayed remain unknown; they are never estimated or changed to zero.')}</p>
    {query.isPending ? <Loading /> : query.isError ? <LoadError retry={() => void query.refetch()} /> : <div className="evidence-list">{query.data?.map(item => {
      const current = status(item, t);
      return <div className="evidence-row" key={item.kind}><div>
        <strong>{labels[item.kind][language === 'ko' ? 0 : 1]}</strong>
        {item.state === 'captured' ? <><span className="muted">{t('출처', 'Source')}: {t('Jungle Scout 웹 화면', 'Jungle Scout web page')}</span><span className="muted">{t('관측 시각', 'Observed')}: {new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.observedAt))}</span><a className="text-btn" href={item.sourcePageUrl} target="_blank" rel="noopener noreferrer">{t('Jungle Scout 원본 보기', 'View Jungle Scout source')}</a><Result item={item} /></> : <span className="muted">{item.state === 'not_collected' ? t('현재 입력에 연결된 관측이 없습니다.', 'No observation is linked to the current input.') : item.state === 'stale' ? t('입력 또는 기준이 바뀌어 이전 결과를 현재 근거로 쓰지 않습니다.', 'Inputs or criteria changed, so the previous result is not used as current evidence.') : item.state === 'unavailable' ? t('저장된 결과를 안전하게 확인하지 못했습니다. 다시 수집해야 합니다.', 'The saved result could not be safely verified and needs a new collection.') : t('ASIDE 연결과 다음 작업을 기다리고 있습니다.', 'Waiting for ASIDE connection and the next task.')}</span>}
      </div><span className={`chip chip-${current.style}`}>{current.label}</span></div>;
    })}</div>}
  </section>;
}
