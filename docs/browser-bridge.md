# Browser bridge enrollment

Current browser target: ASIDE, explicitly selected by Jay in place of BrowserOS neo. Authentication, vault storage and signed task validation are browser-independent. The adapter supports supplier search, supplier details, representative-product packaging, saved-search CSV export and Amazon first-page observations. Configured local clients run under the development supervisor; production service installation remains separate.

Server enrollment and a Windows client with native Credential Manager storage are implemented. The worker schedules eligible reads only when enabled and a fresh authenticated report includes the required capability. Registration alone does not prove browser availability. Unreported, stale, offline, unsupported, mismatched-key and revoked states never show available. Device-scoped task endpoints deliver assigned work and retain results. The adapter cannot run arbitrary commands. Authorized Alibaba inquiries use the separately signed supplier_send task and the one-time server dispatch gate described below.

## Enrollment contract

A signed-in account with verified two-factor authentication can POST /api/bridge/pairings. The response is a five-minute, 256-bit single-use pairing code. A replacement cancels the previous pending code for that owner. The issuing session must still exist and be unexpired when the code is redeemed.

A client redeems the code and an 80-character-or-shorter device name through POST /api/bridge/pair. The response contains the device ID, one-time machine credential and current public signing identity (or null before signing setup). The code and credential are stored only as SHA-256 hashes. Responses are no-store. Never place either value in a URL, a command-line argument, a log, source code or browser localStorage.

POST /api/bridge/pair uses its unexpired single-use code. GET /api/bridge/device, POST /api/bridge/tasks/claim, GET /api/bridge/tasks/:id POST /api/bridge/tasks/:id/results and POST /api/bridge/tasks/:id/dispatch require the machine credential in Authorization: Bearer. These are exact route/method exceptions to browser-session authentication. A supplied browser Origin on redemption must match the configured web origin. Machine credentials grant only identity and their assigned task operations, not unrestricted business APIs or account/device management.

GET /api/bridge/devices and POST /api/bridge/devices/:id/revoke require the owner's session, 2FA and the existing mutation-origin check. Another account cannot list or revoke that owner's devices. Revocation is idempotent. Password/2FA changes also permanently revoke bridge credentials and cancel pending codes through the existing credential-invalidation audit boundary.

If redemption succeeds but its response is lost, the same code cannot recover the credential. The owner must revoke that incomplete registration and issue a new code. The Windows client stores the credential in the OS credential vault before returning credentialStored:true. A storage failure identifies the incomplete device registration for owner revocation and does not automatically retry pairing.

## Still required

Production client configuration, deployment and reboot acceptance remain separate requirements. Local signing-key provisioning, encrypted backup/restore, public-key bootstrap, client startup and authenticated capability reporting have been verified. Site login and permissions are still prerequisites for each read. Browser profile/cookie/password/TOTP export, general shell tasks and unapproved supplier contact remain prohibited.

Local verification: pnpm exec tsx scripts/verify-bridge-pairing.mjs. It uses an isolated development database and real loopback HTTP for redemption/status, including concurrent redemption, expiry, account isolation, 2FA/reset revocation and denial of business access. The enrollment test is separate from the live ASIDE adapter checks.

## Windows client

apps/browser-bridge/enrollment.mjs creates a client once with createBridgeClient({origin}) from trusted local configuration. Its enrollBrowserDevice and checkDeviceRegistration methods accept pairing/device input in memory and reject a per-request origin override; credentials are never part of the successful return object. Requests use fixed API paths, no redirects or retries, a 15-second deadline and bounded responses.

apps/browser-bridge/device-vault.mjs calls the trusted local windows-vault.ps1 helper through private pipes. Secrets are not placed in argv or application files. It uses the current Windows user's native credential store, namespaces entries by origin hash and device ID, refuses overwrites under a user-scoped mutex across sessions, and requires the matching key for removal. It never enumerates other credentials. It does not bypass PowerShell execution policy or install dependencies; unavailable storage fails closed.

The implementation follows Microsoft's [CredWriteW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew), [CredReadW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credreadw) and [CREDENTIALW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw) contracts.

Additional local checks:
- node scripts/verify-bridge-vault.mjs
- pnpm exec tsx scripts/verify-bridge-enrollment.mjs

These checks create unique synthetic vault entries, exercise real HTTP registration and native storage/readback, observe server revocation, and remove their own entries. They do not enroll a real browser, test a reboot, or claim capability negotiation.

## Signed task verification

The worker signBrowserTask helper and createBrowserTaskVerifier client use Ed25519 with an application/version-specific message prefix. A verifier captures one trusted server origin, device ID and PEM public key at startup; task messages cannot provide or replace that key. The private key belongs on the authorized worker and is not part of the browser payload.

Version 1 accepts structured supplier_search, supplier_detail, supplier_thread, supplier_send, Amazon observations and Jungle Scout research/export requests. Candidate reads carry their candidate/specification/input/settings provenance as applicable; exports carry their saved-search run/revision/filter provenance. Requests contain no free-form script, shell command or browser profile. supplier_send binds one immutable action and exact nonbinding message body to a company, product, buyer account and provider thread. Adapter code chooses the allowed site and controls; request values remain data.

Envelopes are capped at 8 KiB decoded payload, require canonical base64url and valid UTF-8, and are verified before JSON task acceptance. Tasks must be for the pinned origin/device, already issued and not expired, with at most a five-minute lifetime. The client must have a correct clock.

This verifier is pure: it authenticates and validates a task but does not execute it, track completion/replay, check current server-side revocation or poll a queue. Execution uses the durable claim/completion ledger, authorized producer, pinned signing identity and authenticated capability reporting described below. A signature alone never authorizes contact: the adapter requires a durable local write record and a successful current server dispatch check before clicking Send.

Verification: pnpm exec tsx scripts/verify-browser-task-signatures.mjs. The test uses in-memory synthetic Ed25519 keys and fake time and proves rejection of tampered, expired, wrong-key/device/origin and validly signed disallowed tasks. Node's [sign/verify API](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptosignalgorithm-data-key-callback) is used without newer Ed25519 context options.

## Durable client task records

openBrowserTaskLedger stores task IDs, signed-payload hashes, state and server receipt references in a per-origin/device SQLite file under a trusted configured directory. It stores no plaintext task body, page content or credential. Version 2 can retain an encrypted pending observation until a matching server receipt is confirmed. Node's built-in SQLite provides transactional claims and completion with WAL and full synchronization.

A valid signature is required before a task claim. Concurrent processes cannot both claim the same task. A claimed task that has not received a confirmed completion remains pending_reconciliation after process exit/restart; it is not automatically run again. An identical completed task returns its saved receipt. Reusing an ID with another payload, completing an unclaimed task or replacing a receipt is rejected.

The complete method is for the trusted client controller after the pinned server confirms durable result acceptance. This local module does not itself obtain or authenticate a server receipt. The client recovery controller connects this ledger to authenticated polling/result intake and the ASIDE adapter.

Verification: pnpm exec tsx scripts/verify-browser-task-ledger.mjs. Independent processes test simultaneous claims and exit before completion, then reopen the same database. The temporary metadata directory is removed after the test.

## ASIDE supplier-search adapter

createAsideAdapter pins the installed CLI path, account ID and local host in trusted startup configuration. It passes an allowlisted environment, launches the pinned executable through Git Bash with positional arguments, runs only trusted REPL scripts, and accepts a nonce-tagged bounded JSON response. CLI exit code alone is not trusted because a REPL error may still exit zero.

collect verifies the signed task, checks the installed handler, probes the live browser connection, then durably claims it before execution. Existing claims are returned without another search. Supplier search uses only the observed Alibaba search controls and first-page product/company cards. It validates the applied query and source URLs, returns raw observations and source text, and closes the owned tab before emitting its result. Unconfirmed execution remains pending reconciliation.

These observations are not quotes, specification matches, email addresses or approved candidates. The 60-record live smoke test used a synthetic signed task and made no main-data changes or supplier contact. The adapter-only test uses a synthetic completion receipt; the separate task-delivery integration below obtains a real server receipt.

Runtime details verified locally: ASIDE one-shot REPL must explicitly await asynchronous work; it closes owned tabs when the call ends. The REPL does not currently expose the URL global, so URL handling stays in host Node code or uses observed DOM href values.

The saved-search collector uses the observed https://members.junglescout.com/#/opportunity-finder route in a task-owned tab. Actual filtered searches and CSV downloads have been verified through this route; it validates the route and current US marketplace rather than assuming login from registration.

Checks: node scripts/verify-aside-script.mjs; with trusted FORGE_ASIDE_CLI_PATH and FORGE_ASIDE_ACCOUNT set, pnpm exec tsx scripts/verify-aside-adapter.mjs. The --live option performs a real public Alibaba search and stores its raw output only in ignored local evidence.

## Server task delivery and result receipts

queueSupplierSearch requires an active registered device and current input/settings. Website contact mode requires the exact current GO decision and permits a missing specification; legacy sourcing retains its specification and validation gates. It stores an immutable signed envelope and hash. Package reads have a representative-ASIN context before specification creation. Search exports use the owner's pending saved-search run and do not invent a candidate or specification to obtain a task.

Device claim/status/result endpoints never use a caller-supplied candidate or specification scope. Claims are serialized per device, repeat the same outstanding delivery, cancel stale/expired tasks, and check expiry atomically again at delivery. Results must match the stored task hash, assigned query, source URL query, time window and current source versions.

Result acceptance, encrypted raw observation, linked source captures, the immutable receipt and the next candidate.advance queue job commit together. Duplicate result submission does not enqueue another continuation. Search-result captures use aside_search_result provenance, retain the actual search-page URL, and always keep specification match unknown and email null. Existing manual capture uses the same insertion implementation while retaining its prior behavior.

A repeated identical submission returns the existing receipt even after later settings changes. A different body for the same completed task is rejected. A revoked or different device cannot access the task. The Windows client provides claimTask, readTask and submitObservation using the pinned origin and its vault credential. The result receipt can then complete the matching local ledger entry.

Verification: pnpm exec tsx scripts/verify-browser-task-delivery.mjs. It tests real loopback HTTP, Windows vault client access, stale scopes, concurrent retry, expiry during a source-lock wait, revocation and injected failure after source inserts. Optional --live with the existing ASIDE CLI configuration additionally performs a real public Alibaba read, stores its observations encrypted in the isolated DB, and completes the local ledger using the genuine server receipt. Its niche eligibility is synthetic and is not proof of a real business candidate passing validation. No main import or supplier contact occurs.

## Client execution and recovery

node apps/browser-bridge/run-client.mjs --config <trusted-json> starts the sequential client loop; --once runs one cycle and exits. The configuration contains only origin, deviceId, publicKey, directory, cliPath and accountId. It must not contain a device credential or private signing key. The key is read from Windows Credential Manager.

Captured observations are normalized and encrypted with a task-scoped HKDF/AES-GCM key derived from the device credential, then saved before submission. The version-2 ledger migration preserves old IDs, hashes and receipts. The client checks server receipt and result hashes first when restarting. A committed result with a lost response can therefore finish locally without another browser action; an unsubmitted staged result can be retried without rereading the site.

Matching acknowledged results clear the local ciphertext while retaining the receipt/hash metadata. Cancellation, a missing server task, or a conflicting accepted body preserves the encrypted observation in a terminal attention state rather than overwriting it or retrying it forever. Expired staged read results are not resubmitted; the subsequent server claim resolves expiry. Staged supplier_send receipts remain eligible for submission after expiry, while the send itself is never repeated. A read that ended before staging remains unconfirmed and is not silently repeated.

The loop logs status changes only, reports conflicts/cancellations, and exits on a missing/rejected device credential or rejected origin. It never starts a paid ASIDE agent. Production activation and any actual supplier deliveries require their own runtime evidence.

Recovery verification uses actual loopback HTTP/Postgres/Windows vault with a synthetic browser read callback so that failure before submission and after server commit can be injected without repeated vendor queries. The executable --once path is also verified against the isolated server.

## Signing identity and automatic dispatch

Browser dispatch is disabled unless BROWSER_TASKS_ENABLED=true. In development the worker reads an Ed25519 PKCS8 key from BROWSER_SIGNING_KEY_FILE; production reads the separate browser-signing-key service credential after runtime authority validation. It never uses the data-encryption key for signing. The local initializer scripts/init-browser-signing-key.mjs --output <private-path> refuses existing files and prints only the public identity. Encrypted backup/restore now preserves and verifies the optional signing key through the local backup CLI and scheduler. Before activating a real key, create and verify its actual protected backup; synthetic acceptance alone does not protect a real key. The optional production credential must be supplied only when this feature is enabled; no service installation is performed by the initializer.

The authorized worker publishes only the public key and its SHA-256 SPKI fingerprint. A different private key is rejected at startup; identity replacement is never implicit. Authenticated GET /api/bridge/signing-key and successful pairing expose the public identity. The enrollment client validates the response public key and fingerprint before returning it for trusted startup configuration; tasks cannot change this pin.

Before claiming a new task, run-client probes the pinned local ASIDE CLI and reports connected, supportedTasks and the configured public-key fingerprint to POST /api/bridge/capabilities using its vault credential. A wrong fingerprint, revoked registration or unsupported task declaration is rejected. Pending result reconciliation runs even when the browser is unavailable. Stopping during a probe does not start another task.

The worker runs a bounded sequential dispatch every five seconds with no overlapping cycle and drains the active cycle at shutdown. A fresh report means within 90 seconds, connected, the required task capability supported and the current signing fingerprint. Producers recheck these conditions while locking their source. Supplier selection requires the latest matching validation pass before its batch limit. Search exports select pending runs owned by the device owner. Current completed or unexpired work is deduplicated for the corresponding candidate scope or search run.

Verification: pnpm exec tsx scripts/verify-browser-dispatch.mjs runs isolated PostgreSQL/API checks and separate actual worker processes in disabled/enabled modes. pnpm exec tsx scripts/verify-browser-task-delivery.mjs --client-smoke additionally executes the installed ASIDE CLI probe and authenticated report through the real client process when FORGE_ASIDE_CLI_PATH and FORGE_ASIDE_ACCOUNT are supplied. No vendor search, paid agent, supplier contact or main-data change occurs in these checks.

## ASIDE connection page and local configuration

The account-connections page includes ASIDE registration, last reported status and owner revocation. A missing public signing identity leaves code creation disabled. Pairing codes remain only in component memory, are masked by default, and can be copied explicitly. GET /api/bridge/pairings/:id returns only the issuing owner's pending/consumed/cancelled/expired state. The screen removes a used, cancelled or expired code; the code itself is never put in a URL or query cache.

`configure-client.mjs` takes nonsecret startup settings as flags: `--config`, `--origin`, `--name`, `--directory`, `--aside-cli` and `--account`. The one-time pairing code is accepted on stdin only. In an interactive terminal it prompts with hidden input; automation must supply it through a private pipe. Never include that code in a shell command or argument. State directory and installed ASIDE CLI paths must be absolute.

The setup command validates the authenticated Ed25519 public key/fingerprint, stores the machine credential in Windows Credential Manager and creates the public startup configuration without overwriting an existing file. If registration succeeds but configuration cannot finish, the reported device ID identifies the registration to review/revoke in the app. It does not silently replace a configuration or signing key. Setup completion alone remains connection-unverified until `run-client.mjs --config <file>` probes and reports ASIDE availability.

Verification uses isolated local HTTP/Postgres, a synthetic verified-2FA session and the real ASIDE browser. UI-generated code -> explicit clipboard copy -> private stdin setup -> native vault/config -> actual client probe -> updated UI status is exercised without printing or writing the code/credential. The screenshot harness renders the actual app in 375/768/1280 CSS-pixel frames and captures each frame with ASIDE's screenshot clip option; this avoids unsupported setViewportSize and defective full-page stitching. Native browser-window resizing and Lighthouse scores are not claimed. No main registration or production installation is performed by this verification.

## Saved-search export

After login, pairing and saving conditions, one research-start click requests ASIDE collection. The adapter resets and verifies controls, selects Home & Kitchen in the US marketplace, applies monthly average price/search-volume bounds and explicit competitionMax/seasonalityMax limits, then exports the first results page. Legacy competition/seasonality strings remain manual review notes, even if they say Low; they are never silently interpreted as executable limits.

The collector checks numeric field labels/order as well as values, category exclusivity, the absence of extra keyword filters, and both slider ranges. Result intake independently checks the CSV rows against requested bounds. Missing or range-valued numbers cannot prove a requested limit. With no corresponding filter, those raw values remain preserved rather than becoming zero.

The observed export layout starts with a report title and generation text before its ten-column header. Original bytes, hash, filename and raw data rows are retained. Data row numbering starts at1 after that header; the complete preamble stays in the original blob. The generation text is not guessed into an observation timestamp. Only Keyword is imported as a candidate field; average price, scores and other columns are not substituted for top-product price or niche-rule evidence. A manually supplied file with the same banner remains user_declared. Different headers under that report preamble can be mapped manually, but do not qualify as the verified automatic-export layout.

Search run, owner, revision, filters, time window and visible keyword rows are bound to the signed task and encrypted result. The common importer, run attachment, applied-filter status, immutable receipt and candidate jobs commit together. A matching receipt is reused without a second import or browser read; a conflicting file interpretation is rejected. Automatic CSV payloads are bounded to2MiB and at most200 observed first-page rows; manual uploads retain their existing10MiB/10,000-row limit.

Home & Kitchen discovery does not prove Kitchen & Dining membership. Official validation requires confirmed Kitchen & Dining categories before moving to sourcing; other or unconfirmed categories remain on hold. Applied search filters are displayed separately from product-category verification.

Checks: node --import tsx scripts/verify-search-export.mjs; node --import tsx scripts/verify-search-export-task.mjs; optional --live uses the authenticated ASIDE browser with isolated runs/devices and actual loopback result delivery. The isolated UI fixture's --search-export option connects the normal recovery cycle and native credential vault to the real app for the one-click check. This does not claim paid-API, supplier-contact, overnight or production acceptance.

## Amazon first-page observations

The amazon_search task reads the candidate's normalized query on Amazon US with Featured sorting. It preserves rendered direct result slots in display order, including separate sponsored and unmarked occurrences of one ASIN. Hidden templates are excluded by layout/visibility checks. Product title links are distinct from sponsored-info links. Account/address headers and reviewer profiles are not part of the source snapshot.

Only visibly backed, non-struck price candidates are captured. A single valid displayed USD price is an observation; multiple coupon/regular prices or missing prices remain unknown. Bought badges are retained only as source text, never exact sales or revenue. Neither a displayed price nor the first displayed slot becomes canonical top_price or differentiation evidence.

Task kind is immutable and included in deduplication, allowing a package read and search observation to coexist for one candidate/version. Receipt and queue writes are atomic. The candidate API exposes a minimized current-version projection; raw source text/snapshots remain encrypted. Current unmarked observed ASINs can be selected as the representative without fabricated API catalog measurements. Product names aid selection; conflicting names are omitted rather than chosen arbitrarily.

An evidence-held candidate included in today's daily research run can refresh an older completed Amazon first-page read. The current input/settings and run's local date must match, and the prior receipt must have been accepted before the run began. An in-flight task or a receipt accepted during this run suppresses another refresh. Prior tasks and receipts remain immutable; only active Amazon-search tasks retain the database uniqueness constraint. Worker queue completion stores whether validation was evaluated, deferred, skipped or advanced; completion alone is not proof of new research. Summary evidence text identifies collection within the summary window, and numeric candidate totals explicitly describe accumulated records.

Claims serve the candidate/task scope with the oldest last delivery, or its first creation time when never delivered. Re-signing an expired task preserves that waiting position. Conversation priority only breaks ties, so repeated supplier work cannot indefinitely displace research. Existing source checks, leases, daily caps and started-send exclusions still apply.

All Aside REPL scripts use the existing JSON-encoded stdin transport so Windows CLI argument decoding cannot alter JavaScript backslashes. Read-only results close that session after a valid nonce/protocol result; send tasks still pause at the same one-time dispatch authorization gate. Aside model settings are inherited.

Pending results still reconcile through the existing encrypted ledger, and signature, expiry and duplicate-receipt checks remain enforced. The20candidate regression in verify-market-task.mjs preserves one unavailable candidate while completing the other19.

Jay selected the complete Jungle Scout Product Database query result as the market-leader price comparison population on2026-09-09. Amazon first-page observations remain a separate source. Complete pagination, aligned revenue periods, family deduplication and price ambiguity still require implementation before canonical leader pricing. Complete display coverage alone does not establish market share or differentiation.

Checks: node --import tsx scripts/verify-amazon-market.mjs; node --import tsx scripts/verify-market-task.mjs. Their --live options use actual ASIDE with an isolated task; no paid API or supplier message is sent. The UI fixture supports --market with its normal dispatcher, recovery cycle and native credential vault.

## Representative-product source material

New package reads also preserve listing feature statements and sampled product-page review text in optional `productEvidence` inside the encrypted receipt. These are listing claims and review excerpts, not verified performance or a representative sample of all reviews. The collector reads the product title, feature bullets and local top-review containers; it omits reviewer profiles and unrelated panels.

A review's product identity comes only from its observed variant link. Other variants retain their own ASIN; missing or unsupported links retain null identity. The page's representative ASIN never fills that gap. Reviews are not filtered by star rating: useful criticism can occur in a four-star review. Query parameters from variant links are not retained.

The optional field preserves already-stored v1 receipt shapes. Receipt ownership, version validation, encryption, rollback and duplicate handling remain on the existing package-task path. This source extension does not write canonical differentiation, infer missing package measurements, refresh completed tasks, or call an AI provider. Connecting these materials to a concrete specification change and an assessment remains a separate implementation step.

The authenticated candidate product-source endpoint exposes only current input/settings material for the selected ASIN. Earlier settings or a different selected ASIN produce a stale state. Old receipts without productEvidence explicitly report that the earlier record lacks these materials. Candidate detail offers separate seller-claim and review disclosures, with original product links, observation time, and same/other/unknown review-variant labels. Raw snapshots, ciphertext and internal receipt identifiers are not returned.

Checks: `node --import tsx scripts/verify-product-evidence.mjs`, `node --import tsx scripts/verify-aside-script.mjs`, `node --import tsx scripts/verify-package-task.mjs --live` with the existing installed ASIDE account configuration.

## Development supervisor

On the next `pnpm dev`, a configured browser client starts alongside the core app. The config path is `BROWSER_BRIDGE_CONFIG` or, by default, `data/browser-bridge/client.json`. A missing file leaves the optional client unconfigured. The development supervisor accepts only the same loopback origin as WEB_ORIGIN; remote-origin configurations are not launched from this path.

The child receives only OS/runtime environment variables, not database/auth/provider secrets or NODE_OPTIONS. Its exit is excluded from the core-service failure race: a rejected credential or unavailable browser client reports attention while the web/API/worker remain usable. Normal dev shutdown also stops the optional client. This is development-supervisor integration, not Windows-login or production-service installation; a newly created config is picked up on the next dev start.

## Alibaba automatic contact

Website mode searches current GO candidates, including those without a specification, and keeps at most three active supplier conversations per candidate. Existing completed search receipts can seed conversations for the same current scope. No specification or specification match is fabricated. Supplier contact mode blocks both email preparation and actual email preflight/claim.

An untouched THREAD_OWNERSHIP_CONFLICT conversation can be retired only while in attention with no bound account/thread, actions or messages. Its original row and source stay immutable as paused history. Only this exact retired case is excluded from the active three-company cap and active status aggregates; the detail view retains it. Current GO and matching input/settings/specification are still required. The scheduler reuses that conversation's original authenticated completed search receipt to fill a vacancy, skipping every already-used company across candidates. Other paused/attention conversations still count. Retired history cannot be reactivated, receive messages/actions or accept queued/late browser work; started and uncertain sends are not eligible for this replacement.

The initial inquiry asks for provisional USD quotes at 100/300/500 sale units, MOQ, packaging, lead time, freight, duties and DDP availability; the final US destination remains TBD. Each body has a unique inquiry reference and explicitly excludes orders, payments, sample purchases, contracts and quantity commitments. New replies may create at most three nonbinding follow-ups. Binding requests pause the conversation for review. Raw text stays encrypted and is rendered as text.

Follow-up wording comes from Aside AI after a new inbound reply. A signed thread request contains the current product/specification, the last confirmed outbound message identity/hash and the follow-up round. The bridge sends only the verified conversation after that outbound to a fresh Aside session; no new reply means no model call. Missing or oversized context and binding requests pause for review. Technical AI_UNAVAILABLE/AI_RESPONSE_INVALID failures may recover twice per inbound message, after 15 minutes, with persistent audit counts and the current GO/source and sent-action checks. Exhaustion remains attention; no fixed-template fallback is used. The API rechecks current GO/source, latest messages, prior actions and the three-follow-up limit in the same transaction before creating an encrypted immutable send action.

Jay's project-level GPT-6 Astra/xhigh requirement applies only to Codex development subagents. Aside is excluded: any Aside agent invocation must inherit Aside's own selected model and effort without project overrides. Both the model runner and REPL runner pass no model/provider/effort/speed override. The model result records the actual Aside provider, model and session ID; no global Aside settings are changed.

For model execution, the bridge reuses the official installed Aside native signer and its loopback daemon authentication. It keeps the fresh exec prompt on stdin until authenticated `sessions.update` reloads a deny-all tool policy and the updated session is read back. Auth tokens stay in memory, redirects are rejected, memory extraction is disabled for that session, and timeouts stop only the owned session. The final assistant text is parsed as a strict reply/review decision; tool attempts or malformed output are rejected. This integration depends on the installed Aside daemon protocol and fails visibly if that protocol changes.

Before sending, the trusted Aside script verifies the company, buyer account, provider thread and exact composer body. Follow-ups also carry the inbound provider ID, time and body hash: changed/new inbound or a newer buyer reply stops the click, including after dispatch authorization. The same interactive REPL pauses for POST /api/bridge/tasks/:id/dispatch. This endpoint checks current GO, device, input/settings/specification and immutable body before atomically starting the action once. A lost response, timeout or restart never retries the click. Uncertain outcomes are reconciled with read-only thread tasks; factual receipts from a started send survive task expiry or changed source eligibility.

Each Alibaba task opens and closes its own tabs. When a signed thread is absent from recent chats, company contact search may recover it only through one exact normalized company-name match, followed by the same thread/account/profile checks. An unknown thread may be discovered through that path, but existing outbound history still requires review. Similar company names, ambiguous exact matches and changed identities cannot authorize a send. Complete unconditional sample or production/shipping prohibitions are accepted by the shared reply guard; positive or conditional commitments remain blocked.

Conversations at the three-follow-up limit continue read-only polling. A started initial action blocked with SEND_NOT_CONFIRMED also remains readable for evidence collection. These attention reads have no AI context and never rearm a blocked action; the attention reason remains visible and successful reads schedule the next check 15 minutes later.

Provider message IDs deduplicate observations; repeated polls do not advance last-activity timestamps. A provider thread cannot belong to two candidate conversations. Normal reply checks are due every 15 minutes. Paused/attention conversations are read only for unresolved started-send reconciliation or the attention cases listed above. The website shows conversations, source links, exact messages, send state and browser availability.

An explicit operator recovery command can rearm only a never-started action blocked by NEGOTIATION_CONTEXT_CHANGED. It requires the original authenticated not_sent receipt plus a fresh signed read receipt observed and accepted after that failure, matching the same latest inbound with no later outbound. Current GO/source, device and competing actions are rechecked under the transaction lock. The original action/body/round, completed task and receipt remain unchanged; recovery creates one new signed task. The normal scheduler does not invoke recovery or retry completed sends.

Run `node --import tsx scripts/recover-alibaba-unsent.ts read --device <uuid> --action <uuid>` to queue the prerequisite read, then `node --import tsx scripts/recover-alibaba-unsent.ts rearm --device <uuid> --action <uuid> --not-sent-receipt <uuid> --read-receipt <uuid>` after its receipt is accepted. The CLI uses normal worker runtime/database authority and the worker advisory lock. In production it must execute within the genuine worker service context with its existing credentials; a temporary ExecStartPre can provide that context and must be removed afterward. Started, sent or uncertain sends are ineligible.

Checks: `node --import tsx scripts/verify-alibaba-server.mjs`, the existing signature/ledger/adapter/delivery/contact checks, and `scripts/support/serve-bridge-ui.mjs --alibaba` for isolated website QA. Synthetic checks do not prove real supplier delivery or future replies.
