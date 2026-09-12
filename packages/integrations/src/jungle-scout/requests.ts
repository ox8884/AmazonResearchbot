export const JUNGLE_SCOUT_HEADER_CONTRACT = {
  authorization: "KEY_NAME:API_KEY",
  xApiType: "junglescout",
  accept: "application/vnd.junglescout.v1+json",
  contentType: "application/vnd.api+json",
} as const;

export type JungleScoutEndpoint =
  | "product_database_query"
  | "keywords_by_keyword_query"
  | "historical_search_volume"
  | "sales_estimates_query"
  | "share_of_voice";

export type JsonApiRequestBody = { readonly data: { readonly type: string; readonly attributes: Readonly<Record<string, unknown>> } };

export type JungleScoutRequest = {
  readonly endpoint: JungleScoutEndpoint;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly body: JsonApiRequestBody | null;
  readonly headers: typeof JUNGLE_SCOUT_HEADER_CONTRACT;
};

export type ContractResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string };

type CursorInput = { readonly cursor?: string };
type KeywordInput = CursorInput & { readonly keyword: string };

function failure<T>(code: string): ContractResult<T> {
  return { ok: false, code };
}

function text(value: string, code: string): ContractResult<string> {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 500
    ? { ok: true, value: trimmed }
    : failure(code);
}

function cursor(input: CursorInput): ContractResult<string | null> {
  if (input.cursor === undefined) return { ok: true, value: null };
  const checked = text(input.cursor, "INVALID_CURSOR");
  return checked.ok && checked.value.length <= 2000
    ? checked
    : failure("INVALID_CURSOR");
}

function post(
  endpoint: "product_database_query" | "keywords_by_keyword_query",
  path: string,
  body: JsonApiRequestBody,
  input: CursorInput,
): ContractResult<JungleScoutRequest> {
  const checked = cursor(input);
  if (!checked.ok) return checked;
  const query: Record<string, string> = {
    marketplace: "us",
    "page[size]": "100",
  };
  if (checked.value !== null) query["page[cursor]"] = checked.value;
  return {
    ok: true,
    value: {
      endpoint,
      method: "POST",
      path,
      query,
      body,
      headers: JUNGLE_SCOUT_HEADER_CONTRACT,
    },
  };
}

function utcDate(now: Date, daysBeforeYesterday: number): string | null {
  if (!Number.isFinite(now.getTime())) return null;
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  date.setUTCDate(date.getUTCDate() - 1 - daysBeforeYesterday);
  return date.toISOString().slice(0, 10);
}

function period(now: Date, lengthDays: number): ContractResult<{
  readonly startDate: string;
  readonly endDate: string;
}> {
  const endDate = utcDate(now, 0);
  const startDate = utcDate(now, lengthDays - 1);
  return startDate && endDate
    ? { ok: true, value: { startDate, endDate } }
    : failure("INVALID_CLOCK");
}

export function buildProductDatabaseRequest(
  input: KeywordInput,
): ContractResult<JungleScoutRequest> {
  const keyword = text(input.keyword, "INVALID_KEYWORD");
  if (!keyword.ok) return keyword;
  return post(
    "product_database_query",
    "/api/product_database_query",
    {
      data: {
        type: "product_database_query",
        attributes: {
          categories: ["Kitchen & Dining"],
          include_keywords: [keyword.value],
        },
      },
    },
    input,
  );
}

export function buildKeywordRequest(
  input: KeywordInput,
): ContractResult<JungleScoutRequest> {
  const keyword = text(input.keyword, "INVALID_KEYWORD");
  if (!keyword.ok) return keyword;
  return post(
    "keywords_by_keyword_query",
    "/api/keywords/keywords_by_keyword_query",
    {
      data: {
        type: "keywords_by_keyword_query",
        attributes: { search_terms: [keyword.value] },
      },
    },
    input,
  );
}

export function buildHistoricalSearchVolumeRequest(
  input: { readonly keyword: string; readonly now: Date },
): ContractResult<JungleScoutRequest> {
  const keyword = text(input.keyword, "INVALID_KEYWORD");
  const dates = period(input.now, 365);
  if (!keyword.ok) return keyword;
  if (!dates.ok) return dates;
  return {
    ok: true,
    value: {
      endpoint: "historical_search_volume",
      method: "GET",
      path: "/api/keywords/historical_search_volume",
      query: { marketplace: "us", keyword: keyword.value, start_date: dates.value.startDate, end_date: dates.value.endDate },
      body: null,
      headers: JUNGLE_SCOUT_HEADER_CONTRACT,
    },
  };
}

export function buildSalesEstimateRequest(
  input: { readonly asin: string; readonly now: Date },
): ContractResult<JungleScoutRequest> {
  const asin = input.asin.trim();
  const dates = period(input.now, 30);
  if (!/^[A-Z0-9]{10}$/.test(asin)) return failure("INVALID_ASIN");
  if (!dates.ok) return dates;
  return {
    ok: true,
    value: {
      endpoint: "sales_estimates_query",
      method: "GET",
      path: "/api/sales_estimates_query",
      query: { marketplace: "us", asin, start_date: dates.value.startDate, end_date: dates.value.endDate },
      body: null,
      headers: JUNGLE_SCOUT_HEADER_CONTRACT,
    },
  };
}

export function buildShareOfVoiceRequest(
  input: { readonly keyword: string },
): ContractResult<JungleScoutRequest> {
  const keyword = text(input.keyword, "INVALID_KEYWORD");
  if (!keyword.ok) return keyword;
  return {
    ok: true,
    value: {
      endpoint: "share_of_voice",
      method: "GET",
      path: "/api/share_of_voice",
      query: { marketplace: "us", keyword: keyword.value },
      body: null,
      headers: JUNGLE_SCOUT_HEADER_CONTRACT,
    },
  };
}
