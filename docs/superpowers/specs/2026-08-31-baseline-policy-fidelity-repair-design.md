# Local baseline policy-mode fidelity repair

The user approved correcting the local verification environment and reading only schema/permission definitions through the existing Supabase connection on2026-08-31. This does not authorize production DDL, business-row reads, deployment, provider activity or sends.

## Evidence and scope

The active immutable capture is `47838c718a358344`. Its original migration replay creates seven restrictive policies, but final reconciliation omits `AS RESTRICTIVE`. Extraction, role normalization and parity fingerprinting also omit `polpermissive`. Production metadata confirms all seven remain restrictive. A metadata-only preflight of201 historical policy identities returned199, with198 old fingerprints matching; the three different/missing worksheet policies are unrelated and must not be overwritten or silently described as a fresh whole-schema capture.

Repair only these seven policies in a new derived immutable capture, after a fresh exact-scope read and hash comparison of every old policy attribute:

```text
public.dashboard_notifications.dashboard_notifications_assistant_makeup_hard_deny
public.makeup_notification_deliveries.makeup_notification_deliveries_assistant_hard_deny
public.makeup_notification_settings.makeup_notification_settings_assistant_hard_deny
public.makeup_request_events.makeup_request_events_assistant_hard_deny
public.makeup_requests.makeup_requests_assistant_hard_deny
public.science_consultation_rate_limits.No direct client access
public.science_consultation_requests.No direct client access
```

Retain all old capture directories and the original baseline bytes as the prefix of the repaired baseline. Keep the migration ledger, originMainSha, every non-target catalog entry, policy predicate/roles/command, all finalized migration bytes and ordered entries unchanged. Add explicit provenance identifying this as a policy-mode-only repair, not a current complete production snapshot. Fix the normal future capture producer too.

## Capture and compatibility contract

New policy fingerprints include boolean `permissive`. Missing/string/null values are rejected when a replay fingerprint is present; never default a missing field to true. Preserve it through role normalization and emit explicit `AS PERMISSIVE` or `AS RESTRICTIVE`. New policy catalog entries use `policyFingerprintVersion:2`; historical entries without the version use the exact legacy fingerprint SQL so existing immutable parity files remain reproducible. Invalid explicit versions fail closed. Non-policy entries are unchanged.

The repair uses a separate, explicitly authorized schema-only MCP export/import path; it does not impersonate the existing Management read-only endpoint or supply dummy credentials. The existing token-based capture path and its guards remain unchanged. Export one fixed query via `dashboardFreeTierPolicyModeStatement()`: BEGIN READ ONLY, local8s statement timeout, catalog-only SELECT of the seven exact policies (command, semantic roles, predicates and polpermissive), server major, read-only status and capture time, then ROLLBACK. No business relation SELECT, mutation function, arbitrary query argument, token/password extraction, remote DDL or endpoint fallback.

An offline envelope contains `{version:1,transport:'supabase-mcp',statementSha256,result}`. `result` has `{version:1,transactionReadOnly:true,serverMajor:17,capturedAt,policies}`; each policy has `{objectKind:'policy',schema:'public',identity,fingerprint}` using PostgreSQL JSONB text. The importer requires explicit authorization/request ID, expected source capture ID and matching statement hash. It checks exact target identities once each, boolean false modes, valid field shapes, and exact SHA256 equality between the mode-free normalized fingerprint and the corresponding immutable source catalog hash. Any missing/extra/duplicate target, role/predicate/command drift, source/hash drift or malformed envelope rejects before publication. Errors/logs do not echo raw payloads or secrets.

The repaired catalog replaces only the seven target fingerprints and their version markers, and records source capture/hash, statement/snapshot hashes and observation time as `policyModeRepair` provenance. Its baseline appends only their generated policy reconciliation. Its parity SQL includes mode in those seven fingerprints. Publication creates a new content-addressed capture and canonical copies atomically using the existing publisher. The top-level manifest changes baseline/catalog hashes only; every migration entry remains unchanged. Require an all-final source manifest for publication; the unrelated makeup draft stays preserved in the user's worktree and is not admitted by the repair.

## Proof and execution boundaries

TDD must show the old producer losing `permissive:false`, fingerprints failing to distinguish modes, and rejected malformed/unapproved/drifted repair inputs causing no publication. Actual generated SQL must execute in an isolated local Docker DB, with old captures immutable and real baseline parity passing. A synthetic pgTAP authorization fixture must distinguish permissive OR from restrictive AND, confirm seven final restrictive policies, and preserve involved/unrelated/assistant behavior for makeup with no outbound effects. Compare actual catalog fingerprints, not only policy existence.

Use a clean never-served temporary copy of committed files for the repair SQL gate because the current worktree contains an unrelated unverified makeup migration. Do not change the runner's final/hash/manifest/security gates to admit it. Keep the live `.next` and the pre-existing `supabase_db_tips_obs_provider_zero_a1a462eb8257` DB untouched. Root integrates manifest metadata with a path/patch-scoped index operation that leaves the makeup draft uncommitted. Independent review precedes resuming makeup SQL. No browser-policy workaround or production-speed claim.
