import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dispatch = await readFile(new URL("../apps/worker/src/browser-dispatch.ts", import.meta.url), "utf8");
const producer = await readFile(new URL("../apps/worker/src/browser-task-producer.ts", import.meta.url), "utf8");
const chain = [
  ["keyword_scout", "product_database"],
  ["historical_data", "keyword_scout"],
  ["category_trends", "historical_data"],
  ["competitive_intelligence", "category_trends"],
];

for (const [next, prerequisite] of chain) {
  assert.match(dispatch, new RegExp(`task_kind='${prerequisite}'[\\s\\S]{0,260}state='completed'`), `${next} dispatch must wait for ${prerequisite}`);
  assert.match(producer, new RegExp(`${next}: "${prerequisite}"`), `${next} producer must wait for ${prerequisite}`);
}

assert.match(dispatch, /AND EXISTS\(SELECT 1 FROM browser_tasks prerequisite WHERE prerequisite\.candidate_id=c\.id/);
assert.match(producer, /WHERE candidate_id=\$1 AND task_kind=\$2 AND input_version=\$3 AND settings_version=\$4/);
console.log(JSON.stringify({ scenario: "jungle_scout_pipeline_order", result: "PASS", chain, candidateScoped: true, terminalState: "completed", paidApiCalls: 0, externalActions: 0 }));
