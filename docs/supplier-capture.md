# Supplier capture intake

The authenticated API accepts source-backed supplier observations at POST /api/candidates/:id/supplier-captures and returns bounded source metadata at GET on the same path. Existing session, two-factor and origin checks apply.

This is a user-declared intake path. It does not fetch URLs, connect to BrowserOS, prove the page was visited, or mark data browser-verified. A real registered bridge and capability negotiation remain required for automatic collection. No browser cookies or machine credentials are accepted in the payload.

The capture contains candidateId, specId, inputVersion, settingsVersion, searchQuery, companyUrl, productUrl, observedAt, pageText, companyName, nullable email, and observedSpec. URLs are currently limited to HTTPS Alibaba hosts. An observedSpec field is null or an object with value and excerpt; its fields are material, dimensions, packaging and requirements. Email must appear as a complete token in pageText and each excerpt/value must have source text.

An automatic exact match requires all four values to equal the current requested specification and the page to contain explicit lines Material: value, Dimensions: value, Packaging: value and Requirements: value. An extractor must not manufacture these lines. Missing or differently worded evidence remains unknown and needs review; this narrow equality check does not claim semantic understanding.

Only the latest specification and input/settings version with an active official-validation pass can create a supplier. Captures are encrypted with record-bound authenticated encryption, immutable and atomically deduplicated. The original validated text, source URLs, search query, observation time and hash remain linked to the supplier. A replay after a specification change is rejected as stale.

Recorded matching suppliers use the existing automatic RFQ preparation flow, which creates approval requests. Source ingestion itself never sends messages or approves contact. Listings are not treated as price quotations.

Verification:
- pnpm exec tsx scripts/verify-supplier-capture.mjs
- pnpm typecheck

The test uses an isolated development database and synthetic page content, exercises authenticated API intake plus readback, encryption, concurrent replay, stale inputs and capture-to-RFQ approval. It performs no real supplier lookup or transmission. The main database must receive migration 0031 before enabling the new route in a restarted local service.
