import type { JungleScoutEndpoint } from "./requests.ts";

type PaginatedEndpoint = "product_database_query" | "keywords_by_keyword_query";

export type NextPostPage =
  | { readonly kind: "complete" }
  | { readonly kind: "next"; readonly url: string; readonly body: unknown }
  | { readonly kind: "incomplete"; readonly reason: "MAX_PAGES_REACHED" }
  | { readonly kind: "invalid_next"; readonly code: string };

export type JsonApiNext =
  | { readonly kind: "complete" }
  | { readonly kind: "next"; readonly value: string }
  | { readonly kind: "invalid"; readonly code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readJsonApiNext(body: unknown, pageCount: number, pageSize: number): JsonApiNext {
  if (!isRecord(body)) return { kind: "invalid", code: "MISSING_NEXT_LINK" };
  if (isRecord(body.links) && "next" in body.links) {
    const next = body.links.next;
    if (next === null) return { kind: "complete" };
    return typeof next === "string" ? { kind: "next", value: next } : { kind: "invalid", code: "MALFORMED_NEXT_LINK" };
  }
  if (Number.isSafeInteger(pageCount) && Number.isSafeInteger(pageSize) && pageSize > 0 && pageCount < pageSize) {
    return { kind: "complete" };
  }
  return { kind: "invalid", code: "MISSING_NEXT_LINK" };
}

const PATHS: Readonly<Record<PaginatedEndpoint, string>> = {
  product_database_query: "/api/product_database_query",
  keywords_by_keyword_query: "/api/keywords/keywords_by_keyword_query",
};

function isPaginated(endpoint: JungleScoutEndpoint): endpoint is PaginatedEndpoint {
  return endpoint === "product_database_query" || endpoint === "keywords_by_keyword_query";
}

function validNext(next: string, endpoint: PaginatedEndpoint): string | null {
  try {
    const url = new URL(next);
    if (
      url.protocol !== "https:" ||
      url.origin !== "https://developer.junglescout.com" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.pathname !== PATHS[endpoint] ||
      url.searchParams.getAll("marketplace").length !== 1 ||
      url.searchParams.get("marketplace") !== "us" ||
      url.searchParams.getAll("page[cursor]").length !== 1 ||
      url.searchParams.get("page[cursor]") === ""
    )
      return null;
    return url.toString();
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export function nextPostPage(input: {
  readonly next: string | null;
  readonly endpoint: JungleScoutEndpoint;
  readonly body: unknown;
  readonly pagesFetched: number;
  readonly maxPages: number;
}): NextPostPage {
  if (input.next === null) return { kind: "complete" };
  if (!isPaginated(input.endpoint)) return { kind: "invalid_next", code: "UNPAGINATED_ENDPOINT" };
  const url = validNext(input.next, input.endpoint);
  if (url === null) return { kind: "invalid_next", code: "NEXT_URL_REJECTED" };
  if (!Number.isSafeInteger(input.pagesFetched) || !Number.isSafeInteger(input.maxPages) || input.maxPages < 1)
    return { kind: "invalid_next", code: "INVALID_PAGE_LIMIT" };
  if (input.pagesFetched >= input.maxPages)
    return { kind: "incomplete", reason: "MAX_PAGES_REACHED" };
  return { kind: "next", url, body: input.body };
}
