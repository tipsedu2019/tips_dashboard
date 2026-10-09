# Personal read connection candidate

Local candidate only; no production SQL, provider call, real key operation, merge or deployment is authorized.

## Chosen flow and approval scope

Keep administrator-issued credentials and their existing live administrator-issuer checks unchanged. Add `issuer_kind=self_teacher` only for keys whose issuer and owner both equal the authenticated actor. The existing administrator default and immutable identity trigger prevent converting old keys. A verified teacher uses Settings → API → Connection keys to select explicit current classes and shared academic schools, review expiry, issue once, then enter the secret into their own agent's secure input. The UI never copies, sends, stores or logs that secret. All current owner, assignment, school, expiry and rate checks still run on the three existing GETs.

An administrator-only alternative would require an administrator provisioning and handing a teacher a key; it would not provide self-service issuance, and keys would continue to stop if that administrator loses eligibility. This candidate deliberately implements one complete self-service teacher flow. Staff/viewer/assistant and fallback roles receive no new UI or issuance permission. Loss of teacher role blocks both lifecycle and reads; administrator recovery of old records remains an operational task outside this UI. Shared school selection does not imply student-school membership; the underlying teacher calendar read is already shared, and the key narrows it to explicit school UUIDs.

Production approval must name: one issuer-kind column/check plus updated identity trigger on the private credential table; a private RLS operation ledger/index; two private helpers; the strictly anchored issuer branch update to the service-only read function; and execute permission on `agent_personal_connection_v1(text,jsonb)` solely for `authenticated`. There is no new table read grant, service-role issuance, business write scope, auth-provider change, Chat/MakeEdu integration or migration of old keys. Source SQL is `personal-connection-lifecycle.sql`, intentionally outside ordered migrations until separately approved and finalized for installation.

## Lifecycle contracts

- `snapshot` returns only the caller's credential metadata and 10/15/20-row pagination. Pending request reconciliation uses the same per-owner advisory lock as mutations. An absent request is closed with a failed tombstone, so a delayed original request cannot mint a key afterward.
- `targets` performs literal name search with 10/15/20-row pagination and total from one statement snapshot. Selections persist across pages and are capped at 50 per resource type; no first-50 catalog truncation exists.
- `issue` derives scopes from explicit grants; it never accepts owner, issuer or arbitrary scopes. It locks current account/profile/catalog/class/assignment/school authority, limits five active keys and ten issues/day, and stores only a SHA-256 digest. A retry with the same ID and input returns metadata plus null secret; changed intent conflicts. No automatic transport retry occurs.
- `revoke` locks the exact own credential. The existing read function holds that row through authorization/projection; whichever transaction acquires it first completes first, and a later read fails after revocation. A currently running authorized read can complete before a waiting revoke commits.
- Only `{requestId, kind}` persists in sessionStorage. Account switch/unmount discards the in-memory secret and late replies. Loss of sessionStorage causes fail-closed errors; recovery of a completed issue returns its exact metadata and a revoke action, never its secret.
- One-day default, 1/7/30-day UI choices, 30-day server maximum, explicit confirmation, and no empty-as-all grants. No secret renewal/edit-in-place.

## Installation and recovery boundary

This is a transaction-wrapped one-time proposal. It has a five-second lock timeout and strict source anchor: unknown read-function source aborts installation. It is not an automatically rerunnable migration. Before an approved rollout, capture the then-current main/read-function source, promote through the repository migration/preflight process, install SQL first, verify ACL and all three GETs with a separately approved test key, then release the UI. Do not deploy UI alone or merge while SQL is absent. Repeating the exact proposal must fail atomically without changing the installed state.

Emergency containment requires separate production approval: revoke execute on the new lifecycle RPC to stop issuance, revoke only self_teacher rows to stop those reads, and revert teacher UI navigation. Existing administrator rows are not modified by that containment. Do not drop credential history/operation tombstones while delayed requests or audit needs remain. Restoring the old read-function issuer branch rejects self keys; preserve their rows and hashes for audit. No rollback SQL is executed by this candidate.

## Verification

See the task evidence report for exact source SHA, individual test results and limitations. Targeted lifecycle pgTAP, existing personal-read regression, controlled two-session tests, SQL-to-parser fixtures, UI interactions, desktop/390px screenshots, TypeScript, lint, Linux build and independent review are distinct evidence. No result here represents production installation or full canonical schema-suite execution.
