const fieldNames: Readonly<Record<string, readonly [string, string]>> = {
  keyword: ["키워드", "Keyword"],
  standard_size: ["Standard 규격 확인", "Standard-size confirmation"],
  differentiation: ["차별화 근거", "Differentiation evidence"],
  api_keyword_exact_30d: ["정확 검색량 · 30일", "Exact search volume · 30 days"],
  api_keyword_broad_30d: ["확장 검색량 · 30일", "Broad search volume · 30 days"],
  api_keyword_monthly_trend: ["월간 검색 변화 지표", "Monthly search trend"],
  api_keyword_quarterly_trend: ["분기 검색 변화 지표", "Quarterly search trend"],
  api_history_periods: ["검색 추이 응답 구간 수", "Returned search-history intervals"],
  api_history_peak: ["수집 구간의 최대 검색량", "Peak volume within returned intervals"],
  api_history_range: ["검색 추이 관찰 기간 · UTC", "Search-history coverage · UTC"],
  api_sov_search_30d: ["노출 자료의 검색량 · 30일", "Search volume in exposure data · 30 days"],
  api_sov_products: ["노출 자료의 상품 수", "Products returned in exposure data"],
  api_sov_brands: ["노출 자료의 브랜드 수", "Brands returned in exposure data"],
  api_sov_exposure_pct: ["반환 브랜드 최대 노출 점유율 · 첫 3페이지 (%)", "Largest returned brand exposure share · first 3 pages (%)"],

  reviews: ["리뷰", "Reviews"],
  review_700_count: ["리뷰 700개 이상 상품 수", "Products with 700+ reviews"],
  review_2000_count: [
    "리뷰 2,000개 이상 상품 수",
    "Products with 2,000+ reviews",
  ],
  top_price: ["1위 가격", "Top product price"],
  api_market_leader_family: ['매출 1위 상품군 ASIN','Leading revenue family ASIN'],
  api_market_leader_asins: ['가격 비교 ASIN','Price comparison ASINs'],
  api_market_leader_period: ['매출 비교 기간 · UTC','Revenue comparison period · UTC'],
  monthly_revenue_competitors: [
    "월 매출 기준 경쟁 상품 수",
    "Competitors meeting monthly revenue criteria",
  ],
};
export function fieldLabel(field: string, language: string) {
  const observation=/^api_catalog_(reviews|reported_variants):([A-Z0-9]{10})$/.exec(field);
  if(observation)return `${observation[2]} · ${observation[1]==='reviews'?(language==='ko'?'상품 리뷰 수':'Product review count'):(language==='ko'?'API에 나열된 변형 ASIN 수':'Variant ASINs listed by API')}`;
  const catalog=/^api_catalog_(dimensions|weight):([A-Z0-9]{10})$/.exec(field);
  if(catalog){const label=catalog[1]==='dimensions'?(language==='ko'?'카탈로그 등록 치수':'Catalog dimensions'):(language==='ko'?'카탈로그 등록 무게':'Catalog weight');return `${catalog[2]} · ${label}`;}
  const sale=/^api_sales_(units|revenue|days|family):([A-Z0-9]{10})$/.exec(field);
  if(sale){const labels:Record<string,readonly [string,string]>={units:["30일 판매량 추정","30-day estimated units"],revenue:["30일 매출 추정 (USD)","30-day estimated revenue (USD)"],days:["판매량 응답 일수","Returned sales days"],family:["패밀리 기준 ASIN","Family ASIN"]};return `${sale[2]} · ${labels[sale[1]??'']?.[language==='ko'?0:1]??''}`;}

  return (
    fieldNames[field]?.[language === "ko" ? 0 : 1] ??
    (language === "ko" ? "추가 근거" : "Additional evidence")
  );
}
export function evidenceText(text: string, language = "ko") {
  return text
    .replace(
      /\b(keyword|reviews|review_700_count|review_2000_count|top_price|monthly_revenue_competitors):\s*([^·]*)/g,
      (_match, key: string, value: string) =>
        `${fieldLabel(key, language)}: ${value.trim() || (language === "ko" ? "미확인" : "Unknown")} `,
    )
    .trim();
}
export function unknownLabel(value: string, language: string) {
  if(value==='PACKAGED_MEASUREMENTS_UNCONFIRMED')return language==='ko'?'Amazon 페이지에서 포장 치수와 포장 중량을 함께 확인하지 못했어요':'Amazon did not confirm both package dimensions and package weight';
  if(value==='PACKAGE_DIMENSIONS_UNKNOWN')return language==='ko'?'포장 치수(Package Dimensions)가 없어 Standard를 판정하지 않아요':'Package dimensions are missing, so Standard size is not assessed';
  if(value==='PACKAGE_WEIGHT_UNKNOWN')return language==='ko'?'포장 중량(Package Weight)이 없어 Standard를 판정하지 않아요':'Package weight is missing, so Standard size is not assessed';
  if(value==='REPRESENTATIVE_ASIN_REQUIRED')return language==='ko'?'실제 소싱할 대표 ASIN을 먼저 선택해야 해요':'Choose the representative ASIN before assessing size';
  if(value==='MARKET_LEADER_UNCONFIRMED')return language==='ko'?'단독 매출 1위를 확인할 수 없습니다':'A single revenue leader is not confirmed';
  if(value==='LEADER_PRICE_AMBIGUOUS')return language==='ko'?'1위 상품군의 가격이 서로 다릅니다':'Prices within the leading family differ';
  if(value==='PARENT_SALES_UNCONFIRMED')return language==='ko'?'부모 상품군의 매출 근거가 미확인입니다':'Parent-family sales are not confirmed';
  if(value==='Representative product evidence needs confirmation')return language==='ko'?'대표 상품의 근거를 다시 확인해야 합니다':value;
  if(value==='CONFLICTING_CATALOG_OBSERVATIONS')return language==='ko'?'같은 ASIN의 등록 정보가 불완전하거나 상충합니다':'Catalog observations for this ASIN are incomplete or conflicting';
  if(value==='CATALOG_DIMENSIONS_UNKNOWN')return language==='ko'?'등록 치수 또는 지원 단위 미확인':'Catalog dimensions or supported unit not confirmed';
  if(value==='CATALOG_WEIGHT_UNKNOWN')return language==='ko'?'등록 무게 또는 지원 단위 미확인':'Catalog weight or supported unit not confirmed';
  if(value==='API_NOT_COLLECTED')return language==='ko'?'아직 공식 자료를 조회하지 않았어요':'Official data has not been collected';
  if(value==='EXACT_KEYWORD_MISSING')return language==='ko'?'이 키워드 자체의 값이 응답에 없어요':'The exact keyword was not found in the response';
  if(value==='SALES_PERIOD_INCOMPLETE')return language==='ko'?'30일 전체 판매량이 확인되지 않았어요':'The full 30-day sales window is not confirmed';
  if(/^[A-Z][A-Z0-9_]*$/.test(value))return language==='ko'?'공식 자료의 값이 미확인입니다':'Value not confirmed in official data';

  if (value === "count_not_integer") return language === "ko" ? "정확한 상품 수를 확인해야 합니다" : "A valid whole count is required";
  if (value === "number_out_of_range") return language === "ko" ? "확인 가능한 숫자 범위를 벗어났습니다" : "The number is outside the supported range";
  if (language !== "ko") return value;
  if (value === "missing") return "값이 제공되지 않음";
  if (value === "empty") return "입력값 없음";
  const bound = /^inequality (.+); bound/.exec(value)?.[1];
  if (bound) return `${bound} · 범위만 확인, 정확한 값은 미확인`;
  if (value.startsWith("not numeric:")) return "숫자로 확인할 수 없는 입력값";
  return value;
}
