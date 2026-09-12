import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PgBoss} from 'pg-boss';
import {createPool} from '../../packages/db/src/index.ts';

const text = await readFile(new URL('../../.env', import.meta.url), 'utf8');
const env = Object.fromEntries(
  text.split(/
/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
assert.notEqual(env.APP_ENV, 'production');
const url = new URL(env.DATABASE_URL);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
const pool = createPool(env.DATABASE_URL);
const boss = new PgBoss({ connectionString: env.DATABASE_URL, migrate: false, supervise: false, schedule: false });
await boss.start();
try {
  const rows = (await pool.query("SELECT id,stage,input_version FROM candidates WHERE stage='api_validation' AND blocked_reason='credential' ORDER BY last_progress_at NULLS FIRST,id LIMIT 20")).rows;
  let queued = 0;
  for (const row of rows) {
    const id = await boss.send('candidate.advance', { candidateId: row.id, stage: row.stage, inputVersion: row.input_version });
    if (id) queued++;
  }
  console.log(JSON.stringify({ queued, candidates: rows.length }));
} finally {
  await boss.stop({ graceful: false, timeout: 2000 });
  await pool.end();
}
