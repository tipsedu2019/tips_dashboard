# Internal Chat thread replies — activation pending

This change supports more than one reply to an existing human message (for example, an acknowledgement followed by a result). It does not activate sending. Approved preparation is code, isolated synthetic verification, independent review and a draft PR. Installing this SQL, merging/releasing the app, issuing keys/grants, changing runtime configuration and sending require the separate execution packet below.

## Caller contract

Use a central **Chat 답글 전용** key with exactly `chat:outbox:read` and `chat:send`, `purposes: ["bridge_reply"]`, explicit `spaceKeys`, and a stable server-granted `bridgeSourceId`. This preset has no employee request read/claim/update scopes, queues/actions, personal dashboard read, or completion notification purpose. It does not grant access to Google Chat memberships, messages, attachments or arbitrary rooms. A key rotation must preserve the same source UUID. A caller cannot select a source UUID in the send body.

For each distinct logical reply, create and durably retain one UUID `clientMessageId` **before** the first send. Retries of that reply retain the same UUID, event, space, thread and text. A subsequent reply uses a new UUID only after the prior effect is resolved.

```http
POST /api/chat/send
Authorization: Bearer <securely supplied Chat-only key>
Idempotency-Key: <UUID for this HTTP operation>
X-Bridge-Event-ID: spaces/APPROVED_SPACE/messages/REAL_SOURCE_MESSAGE
Content-Type: application/json

{
  "space": "space_2",
  "thread": "spaces/APPROVED_SPACE/threads/REAL_EXISTING_THREAD",
  "text": "Reviewed reply text",
  "clientMessageId": "a0800000-0000-4000-8000-000000000001"
}
```

The example resource names are placeholders, not approved real targets. Never infer a thread ID from a message ID. Exactly one origin header is required: `X-Bridge-Event-ID` for bridge creation or `X-Chat-Intent-ID` for a stored intent. No root-message fallback, new-thread mode or alternate room/auth method is available. Provider transport preserves `REPLY_MESSAGE_OR_FAIL`.

`(bridgeSourceId, clientMessageId)` identifies one immutable outbox across credential rotation. Reusing it with different event/room/thread/text conflicts. The original source event is pinned to its room/thread after its first observation. Omitting `clientMessageId` retains the legacy single-reply source/event identity and JSON shape; explicit null is invalid. The RPC marks duplicate creation `created:false`; HTTP returns the existing outbox in `data.outbox` without another dispatch.

A pending, retry_wait, sending, delivery_unknown or incident sibling for the same source/event prevents creation of another logical reply. Dispatch preparation checks this again. Creation, preparation and recording late results serialize on that event. A late incident that commits first blocks the following permit. A permit already committed before contradictory evidence is not retroactively recalled; it may already be in flight. Exactly-once delivery is not promised.

Recover a lost creation response without resending:

```http
GET /api/chat/outbox?clientMessageId=<original UUID>
GET /api/chat/outbox?id=<known outbox UUID>
```

Use one identity, without list filters. Normal status/limit/cursor list queries remain unchanged. Exact lookup returns the normal `{data,error}` envelope with `data: {outbox, delivery}`. `delivery` is either null or `{messageName, threadName}` from the active confirmed sent attempt matching the stored space/thread. It never exposes the raw attempt list or attempt credential IDs. Client lookup is scoped to the currently authenticated grant's source; ID lookup still requires current intent authorization. Revoked grants and personal completion keys cannot recover bridge replies. Unknown/incident state is not a reason to create a new UUID. Preserve the evidence and stop for reconciliation. Definite due 429 retry uses the existing immutable intent and the existing retry protocol in [AI activation](ai-agent-activation.md).

## Exact activation packet

User-confirmed scope is all seven **currently joined TIPS internal work rooms**, replying to existing ordinary work conversations. Personal DMs, parent rooms, external rooms and new conversations are excluded. Slot labels alone are not proof of room type or membership; do not auto-include a later room or remap an approved slot silently.

| Slot | Label | Real resource evidence |
| --- | --- | --- |
| space_1 | 경영팀 | Unverified |
| space_2 | 관리팀 | `spaces/AAQAsD_g4DM`, bot self-report relayed by parent; membership/type still needs independent read |
| space_3 | 조교팀 | Unverified |
| space_4 | 영어팀 | Unverified |
| space_5 | 전체공지 | Unverified |
| space_6 | 수학팀 | Unverified |
| space_7 | 과학팀 | Unverified |

One source message was reported: `spaces/AAQAsD_g4DM/messages/EERr3Qa7b9I.Rv5lydXv0S8`. **Its actual thread is unverified.** The other six room IDs require the pending Muse `chat.google.com` read permission. No approval or membership was inferred. A bot statement about not having a webhook record is not evidence that no webhook exists, and no conclusion about DM webhook support is needed for the exclusion.

Before any activation, record all seven exact IDs, current bot membership, internal-room classification, actual original message/thread relationship and the approved test text/dispatch limit. The server checks allowlists, syntax and observed identity consistency, but does not query Google to prove that a source message really belongs to a thread. The trusted bridge must supply that evidence. This feature does not classify sensitive text or automatically redact personal/student information. Muse operating policy and its own send approvals remain separate from the dashboard grant.

Supply each webhook URL directly through a user/approved operator's secure settings interface, with exact resource mapping. Supply the issued raw Chat key directly to the approved Muse secret store. **Never put a real webhook, raw key or service-role key in chat, PR, report, fixture or local file.** Do not give the Supabase service-role key to Muse. Record only presence, target mapping and redacted verification outcome.

The current connector's Vercel environment metadata request returned 404. No CLI, other team/account or alternate-auth workaround is authorized. The secure input path and access resolution remain blocked. Use the normal GitHub reviewed merge→Vercel deploy route when separately approved, then verify the public alias contract hash against the approved commit. The target is `tipsedu-projects/tips_dashboard`; Supabase is exactly `slnjqlzzhewblvttiidk`.

The observed production settings remain issuance OFF, real keys/grants zero, seven Chat slots unconfigured, origin NULL and notification/business actions OFF. These are timestamped prior observations, not a continuing guarantee: re-read service health, migration history, active migrations, counts and exact settings immediately before installation. The latest main integrated here is `3ad5a6f032dba817cca35afb8b5142b7331d3f23` (PR121/122/123 preserved).

## Installation and recovery

Migration `20261008140556_ai_agent_thread_replies.sql` adds one nullable column, three partial indexes, one CHECK and replaces two existing function bodies. It adds no RPC signature, role privilege, RLS policy, key, grant, space configuration or notification switch. Existing nine API ACLs and private table RLS remain in place.

The SQL takes the exclusive lock required for ALTER, then refuses a nonempty outbox with `55000 chat_thread_reply_install_requires_empty_outbox` **before DDL**. It has a 5-second lock-wait timeout and 120-second per-statement timeout; 5 seconds is not a bound on the whole transaction's lock holding time. CHECK validation and three index builds have narrowly documented Squawk exceptions because the table is proved empty under the same lock and uniqueness changes must be atomic. Populated delivery history requires a separately reviewed online migration; never delete history to pass this precondition.

Keep activation OFF while installing. On any error or lost response, inspect migration history and the actual catalog before considering a retry. Independently verify column/check/index definitions, active function bodies, ACL/RLS, settings and ledger. Deploy the compatible app and verify its actual source and affected reads **before** enabling creation of client-ID rows. The previous strict app parser does not accept those rows.

For a stop, disable the Chat runtime switch and stop the Muse dispatcher, revoke the exact newly issued central key with the existing admin `ai_agent_credential_api_v1('revoke', {id, idempotencyKey})`, and independently confirm both credential/grant revocation and denied read/send. Preserve attempts, receipts and outbox history. Issuance OFF alone does not disable existing credentials. App rollback alone does not remove DB code or privileges and may break reads of new-format rows. Do not drop the column/indexes or reinstall the old source/event uniqueness once multiple replies exist. Prefer a reviewed forward fix with dispatch disabled; any schema reversion requires a data-aware plan and separate execution authorization.
