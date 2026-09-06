export const JS_BASE = "https://developer.junglescout.com";

export const JS_ENDPOINTS = {
  product_database_query: {
    method: "POST",
    path: "/api/product_database_query",
    type: "product_database_query",
  },
  keywords_by_keyword_query: {
    method: "POST",
    path: "/api/keywords/keywords_by_keyword_query",
    type: "keywords_by_keyword_query",
  },
  historical_search_volume: {
    method: "GET",
    path: "/api/keywords/historical_search_volume",
    type: null,
  },
  sales_estimates_query: {
    method: "GET",
    path: "/api/sales_estimates_query",
    type: null,
  },
  share_of_voice: {
    method: "GET",
    path: "/api/share_of_voice",
    type: null,
  },
} as const;

export type JsEndpointName = keyof typeof JS_ENDPOINTS;
