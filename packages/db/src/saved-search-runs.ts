import type { QueryConnection } from "./rfq-state.ts";
export class SearchRunError extends Error {
  constructor(
    readonly code: "SEARCH_RUN_NOT_FOUND" | "SEARCH_RUN_ALREADY_IMPORTED",
  ) {
    super(code);
  }
}
export type LockedSearchRun = { id: string; import_id: string | null };
export async function lockSearchRun(
  db: QueryConnection,
  id: string,
  actor: string,
): Promise<LockedSearchRun> {
  const row = (
    await db.query<LockedSearchRun>(
      "SELECT id,import_id FROM saved_search_runs WHERE id=$1 AND created_by=$2 FOR UPDATE",
      [id, actor],
    )
  ).rows[0];
  if (!row) throw new SearchRunError("SEARCH_RUN_NOT_FOUND");
  return row;
}
export async function attachSearchRunImport(
  db: QueryConnection,
  run: LockedSearchRun,
  importId: string,
) {
  if (run.import_id && run.import_id !== importId)
    throw new SearchRunError("SEARCH_RUN_ALREADY_IMPORTED");
  if (run.import_id) return;
  await db.query(
    "UPDATE saved_search_runs SET state='imported',import_id=$2,completed_at=now() WHERE id=$1",
    [run.id, importId],
  );
}
