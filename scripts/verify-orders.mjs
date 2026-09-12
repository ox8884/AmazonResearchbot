import {orderSourceSnapshot as sourceSnapshot} from "../packages/domain/src/order.ts";
import {orderMarketFixture} from './support/order-market-fixture.mjs';
import assert from "node:assert/strict";
import { exactPayloadHash } from "../packages/security/src/approval-hash.ts";
import { randomUUID } from "node:crypto";
import { reserveCash } from "../packages/domain/src/economics.ts";

const observedAt = "2026-09-06T12:00:00.000Z";
const syntheticRiskReview = specId => {
  const day = observedAt.slice(0, 10);
  const check = () => ({status: "clear", source: "synthetic order risk fixture", observedOn: day});
  return {
    kind: "operator_record",
    scope: {inputVersion: 1, representativeAsin: null, specId},
    checks: {brand: check(), returns: check(), selling: check()},
    recordedOn: day,
  };
};
const known = (value) => ({
  value,
  kind: "quote",
  source: "synthetic local verification",
  observedAt,
});

const quote = {
  quantity: 300,
  risksConfirmed: true,
  validUntil: "2030-01-01",
  costs: {
    salePrice: known("30"),
    productUnitPrice: known("5.000003"),
    unitFreight: known("1"),
    unitDuty: known("0"),
    unitPrepInspection: known("0"),
    otherLandedUnitCost: known("0"),
    fbaFee: known("4.5"),
    referralFee: known("4.5"),
    adsPerUnit: known("2"),
    expectedReturnLoss: known("0.5"),
    otherVariableCost: known("0.5"),
    separateUpfrontCosts: known("200"),
    initialAdCash: known("300"),
    contingencyCash: known("300"),
  },
};

const legacySpec={id:'00000000-0000-4000-8000-000000000001',candidateId:'00000000-0000-4000-8000-000000000002',revision:1,material:'Fixture',dimensions:'30 cm',packaging:'Box',requirements:'Fixture',requestedQuantity:300,source:'Operator fixture',createdAt:observedAt};
const legacySnapshot=legacySpec;
assert.deepEqual(sourceSnapshot(legacySpec,quote).spec,legacySnapshot);
assert.equal(exactPayloadHash(sourceSnapshot({...legacySpec,aiTaskId:null},quote).spec),"2eac5f3a221efcb49169a6f22821d57a572acba42f4bd6dca0576118117c27fa","Stored legacy manual specification hash must remain unchanged");
assert.deepEqual(sourceSnapshot({...legacySpec,aiTaskId:null},quote).spec,legacySnapshot,'Legacy manual snapshot bytes must not gain a null provenance field');
const provenanceId=randomUUID();assert.equal(sourceSnapshot({...legacySpec,aiTaskId:provenanceId},quote).spec.aiTaskId,provenanceId);
const roundedReservation = reserveCash(quote);
assert.deepEqual(roundedReservation, {
  rawUsd: "2600.0009",
  reservedUsd: "2600.01",
});

if (!process.argv.includes("--acceptance")) {
  console.log(
    JSON.stringify({
      scenario: "order-reservation-rounding",
      result: "PASS",
      reservation: roundedReservation,
    }),
  );
} else {
  const [{ openAcceptance }, { applyOrderApproval }, { cancelOrderPacket }] =
    await Promise.all([
      import("./support/acceptance.mjs"),
      import("../apps/api/src/order-service.ts"),
      import("../apps/api/src/order-cancel.ts"),
    ]);
  const test = await openAcceptance();
  try {
    const userId = (await test.call("/api/session")).body.user.id;
    const currentSettings = async () => {
      const result = await test.pool.query(
        "SELECT version,snapshot FROM settings_versions ORDER BY version DESC LIMIT 1",
      );
      return result.rows[0];
    };
    const costs = (freight = known("1")) => ({
      salePrice: known("30"), productUnitPrice: known("5"), unitFreight: freight,
      unitDuty: known("0"), unitPrepInspection: known("0"), otherLandedUnitCost: known("0"),
      fbaFee: known("4.5"), referralFee: known("4.5"), adsPerUnit: known("2"),
      expectedReturnLoss: known("0.5"), otherVariableCost: known("0.5"),
      separateUpfrontCosts: known("200"), initialAdCash: known("300"), contingencyCash: known("300"),
    });
    async function candidate(label, options = {}) {
      const settings = await currentSettings();
      const inserted = await test.pool.query(
        "INSERT INTO candidates(marketplace,normalized_keyword,keyword_display,stage) VALUES('us',$1,$1,'economics_review') RETURNING id",
        [`QA order ${label} ${test.runId}`],
      );
      const candidateId = inserted.rows[0].id;
      if (options.official !== false) {
        await test.pool.query(
          "INSERT INTO evaluations(candidate_id,settings_version,kind,outcome,payload,stale) VALUES($1,$2,'api_validation','pass',$3::jsonb,false)",
          [candidateId, settings.version, JSON.stringify({ synthetic: true, inputVersion: 1, firstPageSales:orderMarketFixture(settings.snapshot) })],
        );
      }
      const spec = await test.call(`/api/candidates/${candidateId}/specs`, {
        material: "synthetic", dimensions: "30 cm", packaging: "synthetic", requirements: "local only",
        requestedQuantity: 300, source: `synthetic order ${label}`,
      });
      assert.equal(spec.status, 201);
      const quoteResult = await test.call(`/api/candidates/${candidateId}/quotes`, {
        specId: spec.body.id, supplierName: `Synthetic ${label}`, supplierSource: "local fixture",
        sourceText: `synthetic order fixture ${label}`, receivedAt: observedAt,
        validUntil: options.validUntil ?? "2030-01-01", incoterm: "DDP", quantity: 300, moq: 300,
        risksConfirmed: true, riskSource: "synthetic local fixture", costs: costs(options.freight),
      });
      assert.equal(quoteResult.status, 201);
      return { candidateId, spec: spec.body, quote: quoteResult.body };
    }
    async function packet(subject, decision = "go") {
      const settings = await currentSettings();
      const packetId = randomUUID(), approvalId = randomUUID();
      const cash = decision === "go" ? reserveCash(subject.quote) : null;
      // Build the pre-provenance stored JSON independently of the current snapshot function.
      const s = subject.spec, q = subject.quote;
      const source = {
        spec: {id:s.id,candidateId:s.candidateId,revision:s.revision,material:s.material,
          dimensions:s.dimensions,packaging:s.packaging,requirements:s.requirements,
          requestedQuantity:s.requestedQuantity,source:s.source,createdAt:s.createdAt},
        quote: {id:q.id,candidateId:q.candidateId,specId:q.specId,supplierName:q.supplierName,
          supplierSource:q.supplierSource,sourceText:q.sourceText,receivedAt:q.receivedAt,
          validUntil:q.validUntil,incoterm:q.incoterm,quantity:q.quantity,moq:q.moq,
          risksConfirmed:q.risksConfirmed,riskSource:q.riskSource,costs:q.costs,createdAt:q.createdAt},
      };
      const payload = {
        payloadVersion: 1, packetId, candidateId: subject.candidateId, decision,
        note: "synthetic acceptance decision", settings: { version: settings.version, snapshot: settings.snapshot },
        source, sourceHash: exactPayloadHash(source), assessment: subject.quote.assessment, reservation: cash,
        ...(decision === "go" ? {riskReview: syntheticRiskReview(subject.spec.id)} : {}),
      };
      const hash = exactPayloadHash(payload);
      await test.pool.query(
        "INSERT INTO approvals(id,kind,candidate_id,payload_hash,payload,status) VALUES($1,'order_decision',$2,$3,$4::jsonb,'pending')",
        [approvalId, subject.candidateId, hash, JSON.stringify(payload)],
      );
      await test.pool.query(
        `INSERT INTO order_packets(id,candidate_id,quote_id,spec_id,settings_version,decision,note,payload,payload_hash,approval_id,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
        [packetId, subject.candidateId, subject.quote.id, subject.spec.id, settings.version, decision,
          payload.note, JSON.stringify(payload), hash, approvalId, userId],
      );
      return { packetId, approvalId };
    }
    async function apply(approvalId) {
      const client = await test.pool.connect();
      try {
        await client.query("BEGIN");
        const selected = await client.query("SELECT * FROM approvals WHERE id=$1 FOR UPDATE", [approvalId]);
        const result = await applyOrderApproval(client, selected.rows[0], userId);
        if (result.applied) await client.query("UPDATE approvals SET status='approved' WHERE id=$1", [approvalId]);
        if (!result.applied && result.code === "APPROVAL_STALE")
          await client.query("UPDATE approvals SET status='stale' WHERE id=$1", [approvalId]);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    async function release(packetId) {
      const client = await test.pool.connect();
      try {
        await client.query("BEGIN");
        const result = await cancelOrderPacket(client, packetId, userId, "synthetic release");
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    const firstSubject = await candidate("first");
    const first = await packet(firstSubject);
    assert.deepEqual(await apply(first.approvalId), { applied: true });
    const second = await packet(await candidate("second"));
    assert.deepEqual(await apply(second.approvalId), { applied: false, code: "INSUFFICIENT_LAUNCH_CASH" });
    assert.deepEqual(await apply(first.approvalId), { applied: true });
    const duplicateCandidate = await packet(firstSubject);
    assert.deepEqual(await apply(duplicateCandidate.approvalId), { applied: false, code: "APPROVAL_STALE" });
    assert.equal((await release(first.packetId)).released, true);
    const freshAfterRelease = await packet(firstSubject);
    assert.deepEqual(await apply(freshAfterRelease.approvalId), { applied: true });
    assert.equal((await release(freshAfterRelease.packetId)).released, true);
    const budget = await currentSettings();
    const available = await test.pool.query(
      "SELECT greatest($1::numeric-coalesce(sum(reserved_usd) FILTER (WHERE state='active'),0),0)::text AS available FROM launch_cash_reservations",
      [budget.snapshot.launchBudgetUsd],
    );
    assert.equal(available.rows[0].available, "3000.00");

    const concurrentA = await packet(await candidate("concurrent-a"));
    const concurrentB = await packet(await candidate("concurrent-b"));
    const concurrent = await Promise.all([apply(concurrentA.approvalId), apply(concurrentB.approvalId)]);
    assert.deepEqual(concurrent.map((result) => result.applied).sort(), [false, true]);
    const winner = concurrent[0].applied ? concurrentA : concurrentB;
    assert.equal((await release(winner.packetId)).released, true);

    const old = await packet(await candidate("old-settings"));
    const priorSettings = await currentSettings();
    await test.pool.query(
      "INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),'acceptance',$2::jsonb)",
      [priorSettings.version + 1, JSON.stringify(priorSettings.snapshot)],
    );
    assert.deepEqual(await apply(old.approvalId), { applied: false, code: "APPROVAL_STALE" });
    const expired = await packet(await candidate("expired", { validUntil: "2000-01-01" }));
    const unknown = await packet(await candidate("unknown", { freight: { value: null, kind: "unknown", source: null, observedAt: null, reason: "pending" } }));
    const unvalidated = await packet(await candidate("unvalidated", { official: false }));
    assert.deepEqual(await apply(expired.approvalId), { applied: false, code: "APPROVAL_STALE" });
    assert.deepEqual(await apply(unknown.approvalId), { applied: false, code: "APPROVAL_STALE" });
    assert.deepEqual(await apply(unvalidated.approvalId), { applied: false, code: "APPROVAL_STALE" });
    assert.equal((await test.pool.query("SELECT count(*)::int AS n FROM launch_cash_reservations WHERE state='active'")).rows[0].n, 0);
    const complete = await currentSettings();
    const { shareTop1MustBeBelowPct, shareTop3MustBeBelowPct, firstPageSalesMinUsd, ...incomplete } = complete.snapshot;
    assert.ok(shareTop1MustBeBelowPct && shareTop3MustBeBelowPct && firstPageSalesMinUsd);
    await test.pool.query(
      "INSERT INTO settings_versions(version,effective_at,approved_by,snapshot) VALUES($1,now(),'acceptance-incomplete',$2::jsonb)",
      [complete.version + 1, JSON.stringify(incomplete)],
    );
    const incompleteCandidate = await candidate("settings-required");
    const settingsRequired = await test.call(
      `/api/candidates/${incompleteCandidate.candidateId}/order-packets`,
      { quoteId: incompleteCandidate.quote.id, decision: "hold", note: "synthetic incomplete settings" },
    );
    assert.equal(settingsRequired.status, 409);
    assert.equal(settingsRequired.body.code, "SETTINGS_REQUIRED");
    console.log(JSON.stringify({
      scenario: "order-decisions", result: "PASS", database: test.database, runId: test.runId,
      cap: "3000", reservation: "2600", secondReservation: "blocked", concurrent: "one approved",
      legacyStoredSnapshotApproval: true, replay: "idempotent", stale: ["settings", "expired", "unknown", "validation"],
      release: "available restored", incompleteSettings: "409 SETTINGS_REQUIRED", externalActions: 0,
    }));
  } finally {
    await test.close();
  }
}
