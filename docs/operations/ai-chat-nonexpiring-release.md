# Explicit non-expiring Chat reply credentials

Candidate base: `6a6d7abe4f45e366beccc14efbbcce0534f0370f` (PR125).
This document is a release plan, not an installation or issuance receipt.

## Contract

- Existing omitted/NULL `expiresAt` without `nonExpiring:true` still means one day. Finite expiry remains future-only and at most 30 days. Existing keys are not rewritten.
- Only the admin central `ai_agent_credential_api_v1('create', ...)` gateway accepts the new explicit boolean `nonExpiring:true` with explicit JSON `expiresAt:null`.
- NULL expiry requires exactly `chat:outbox:read` and `chat:send`, explicit existing space keys, only `bridge_reply`, and a stable `bridgeSourceId`. No employee request, personal, domain-action, completion-notification or wildcard grant is introduced.
- The existing issuer validates and inserts the new key under the existing admin lock. The gateway clears expiry only on that newly inserted key and its Chat grant in the same transaction, before storing the immutable receipt. Failure rolls back the whole creation. Receipt replay returns metadata and `token:null`.
- Credential and Chat-grant expiry columns become nullable with narrow CHECK constraints. AI request grants stay NOT NULL. Authentication rejects a finite credential paired with a NULL Chat grant. Existing role, revocation, lock ordering and final deadline checks remain in force. A central in-flight attempt can still record its provider result after grant revocation; it cannot obtain a new dispatch permit.
- Both central and personal issuers count non-expiring active keys toward the shared limit of 20. Turning issuance OFF blocks new issuance; it does not revoke an existing key.
- The UI adds `무기한` only under `Chat 답글 전용`. Leaving that preset restores the one-day choice. Existing configured-space restrictions, first-display-only raw key, account-boundary clearing and exact uncertain-request recovery remain.

## Authorized intended key, not yet created

The user approved one non-expiring key for all seven existing Chat slots on 2026-10-09 at 06:49 UTC. It supersedes the unissued one-day management-room pilot. Grant only explicit `space_1` through `space_7`, purpose `bridge_reply`, scopes above, and source `6bca3a30-1254-4617-90d3-7ddb34d02033`. Existing-thread replies and result reads only; no DMs, arbitrary root announcements, student/employee writes or external student-data access.

## Before production application

1. Review the exact candidate commit/migration hash, current base and isolated evidence, including concurrent revocation and capacity/idempotency tests. Use free local Linux verification and independent review; do not buy Actions minutes, spoof checks, or change branch protection.
2. Confirm a healthy project `slnjqlzzhewblvttiidk`, no concurrent migration, current issuance OFF, total credential/Chat-grant row counts zero (including revoked/expired rows), and current configuration metadata. Stop and re-plan if populated; the approved installation window is empty/inactive. Preserve pre-application function bodies, ACL/RLS/defaults and ledger. Apply the new migration once only after action-time confirmation; on uncertainty inspect durable ledger before any retry.
3. Verify the exact five function definitions, two column changes/two new constraints, unchanged ACL/RLS, and one new migration receipt. No RPC signature, grantee, role or schema grant changes are needed.
4. Deploy the NULL-aware application through a reviewed main merge and verify actual public manifest build/project/deployment identity. Do not issue the first NULL-expiry key while the previous UI is active.
5. The user/UI operator enters the other six webhook Secrets directly. Agents never read or copy them. Obtain the seven exact nonsecret space mappings, deploy their configuration, then sync those mappings/origin using a fresh revision while issuance remains OFF. Never guess resource names or broaden a grant to wildcard.
6. At the one authorized user's ready-to-paste window, open the existing issuance gate, serialize one browser issuance with the fixed approved fields, have the user paste the first-only key directly into the existing Muse secure card, and close the gate using a new fixed sync UUID and a freshly read revision. Preserve all seven mappings/origin. Verify current state and the exact nonsecret key/grant metadata. Do not expose a key in a tool log, screenshot, file or message.
7. Do not send until the separate action-time scope and fixed test message/thread are confirmed. Unknown provider outcome permits read/reconciliation only, not another POST under a new identity.

## Stop and recovery

- Stop dispatch and use the existing issuing administrator's `ai_agent_credential_api_v1('revoke', {id,idempotencyKey})` path for the exact key. It marks the credential and related grants revoked and preserves audit history. Verify subsequent new authorized reads/sends are rejected. A provider call already dispatched cannot be recalled by later revocation.
- Close issuance with `ai_agent_chat_configuration_api_v1('sync', ...)`: fresh revision, new stable UUID, `issuanceEnabled:false`, and the unchanged current seven-space/origin mapping. Read current state independently. Do not reuse the earlier management-only payload.
- Keep the NULL-aware UI and DB contract while NULL-expiry rows or historical NULL receipts exist. A previous app rollback can break list/recovery rendering even after revocation. Do not restore NOT NULL or rewrite historical receipts as an automatic rollback. Prefer a forward compatibility fix; any expiry-data conversion requires a separate reviewed migration and authorization.
- Do not delete keys, grants, outboxes, attempts or receipts to make rollback easier. No original migration is rerun.

All test keys and provider responses in local evidence are synthetic. Local evidence does not establish real webhook validity, a live key connection, or a successful Chat delivery.
