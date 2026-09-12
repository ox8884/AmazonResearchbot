import assert from "node:assert/strict";
import { createPool } from "../../packages/db/src/client.ts";
export async function removeTestRestore(test, name) {
  assert.match(name, /^forge_ops_restore_[a-f0-9]{32}$/);
  assert.match(test.authFixture.email, /^qa-[a-f0-9]+@fixture\.invalid$/);
  const url = new URL(test.databaseUrl);
  url.pathname = "/" + name;
  const pool = createPool(url.toString());
  try {
    const owners = (
      await pool.query(
        'SELECT count(*)::int AS total,count(*) FILTER (WHERE email=$1)::int AS matched FROM "user"',
        [test.authFixture.email],
      )
    ).rows[0];
    assert.equal(
      owners.total,
      1,
      "Cleanup only accepts the single synthetic fixture user",
    );
    assert.equal(
      owners.matched,
      1,
      "Restore does not belong to this verification run",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM deployment_identity WHERE environment='restore_quarantine'",
        )
      ).rows[0].n,
      1,
      "Only a quarantined restore can be cleaned",
    );
  } finally {
    await pool.end();
  }
  await test.pool.query(`DROP DATABASE "${name}"`);
}
