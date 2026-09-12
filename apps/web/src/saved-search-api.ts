import type {
  SavedSearch,
  SavedSearchInput,
} from "../../../packages/domain/src/saved-search.ts";
export class SavedSearchRequestError extends Error {
  constructor(readonly status: number) {
    super("Saved search request failed");
  }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) throw new SavedSearchRequestError(response.status);
  return response.json();
}
export const listSavedSearches = () =>
  request<{ searches: SavedSearch[] }>("/api/saved-searches");
export const saveSearch = (input: SavedSearchInput) =>
  request<{ id: string }>("/api/saved-searches", input);
export type SearchRunSelection = {
  id: string;
  snapshot: SavedSearch;
  state: "awaiting_csv" | "imported";
  mode?: "manual" | "browser";
};
export type SearchRun = SearchRunSelection & {
  createdAt: string;
  completedAt: string | null;
  filename: string | null;
  linkedCandidates: number | null;
  importId: string | null;
  filterVerification: "unverified" | "applied";
};
export const listSearchRuns = () =>
  request<{ runs: SearchRun[] }>("/api/saved-search-runs");
export const checkSearchConnection = (id: string) =>
  request<{
    run: SearchRunSelection;
    nextAction: { kind: string; target: string };
  }>(`/api/saved-searches/${encodeURIComponent(id)}/run`, {});
