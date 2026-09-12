# AI business input identity

Business analyses are reusable only for the same sanitized AI input within the same candidate, input version, settings version, role and specification scope. New usable evidence can arrive without incrementing the candidate input version; that creates a distinct analysis operation instead of returning an older result as already handled.

Migration0042 derives an immutable SHA-256 fingerprint from canonical PostgreSQL JSONB input. Existing payloads are preserved. JSON object-key order does not create another operation. Private fields excluded from candidateAiInput do not affect identity. A prior identical input can reuse its earlier operation if the evidence returns to that state.

Preparing a new input marks older analyses in that scope stale. Finishing also rebuilds the sanitized input, so evidence that changes during execution makes the result stale. Stale analyses are excluded from the current candidate analysis view. The original task that produced an existing automatic specification remains its provenance source; its existence does not generate another model request or overwrite the specification.

Provider activation, roles, budgets, transport policy and retry/outcome handling are unchanged. This change does not send product review text to a provider, create a differentiation pass, change criteria or enable a provider. Grounded review inputs and concrete specification-change assessment remain separate work.

Verification: `node --import tsx scripts/verify-ai-business.mjs` exercises actual local DB/API and loopback provider paths, including preserved migration data, canonical-input deduplication, evidence updates, private-field exclusion, prior-input reuse, midflight changes and automatic-spec recovery. No real provider request is needed.
