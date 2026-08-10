# Dashboard Google Chat Profile Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 프로필과 검증된 Google Workspace 사용자 ID를 연결하고, 규칙별 설정과 현재 담당 사실을 이용해 Google Chat 메시지에서 필요한 사람만 안전하게 멘션하는 공용 기반을 만든다.

**Architecture:** Google Directory 조회는 공식 `@googleapis/admin` 클라이언트를 사용하는 설정 전용 서버 경계에만 둔다. DB는 프로필 identity, 규칙별 멘션 설정, provider-neutral 담당자 변경 사실, delivery별 불변 멘션 snapshot을 소유한다. 기존 notification control plane의 rule save, claim, generic prepare, provider ownership은 재정의하지 않고, 채택한 workflow의 전용 final-prepare가 공용 resolver/snapshot helper를 호출한 뒤 기존 Google Chat begin 결과에 검증된 `mention_user_names`만 더한다. provider는 그 값만 canonical `<users/ID>` markup으로 만들고 기존 `cardsV2`를 유지한다. 속성 자체가 없는 legacy delivery는 기존 cards-only payload를 byte-compatible하게 유지하고, 채택된 rule만 빈 배열 또는 실제 names로 top-level text 경계를 사용한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase Postgres/PostgREST/RLS/pgTAP, `@googleapis/admin` 31.0.0, Google Chat incoming webhooks, Node test runner, ESLint, Vercel

## Global Constraints

- 제품 권위는 `docs/superpowers/specs/2026-08-10-dashboard-google-chat-profile-mentions-design.md`와 `docs/superpowers/specs/2026-08-09-registration-observation-workflow-design.md`다. 이 계획은 승인된 설계를 바꾸지 않는다.
- 실행 순서는 청강 feedback/enrollment 계획 완료 → 이 공용 기반 → 청강 Google Chat 계획 → 청강 SOLAPI 계획이다. 공용 기반 때문에 청강 attendance, feedback, decision, enrollment date, calendar 작업을 건너뛰지 않는다.
- identity 소유자는 `public.profiles.id`다. `teacher_catalogs.id`, 이메일, 표시명은 Chat mention identity가 아니다.
- Directory 호출은 선생님 설정의 명시적 자동 조회 또는 수동 ID 확인에서만 실행한다. worker, materializer, final-prepare, retry hot path의 Directory 호출 수는 항상 0이다.
- 공식 패키지는 exact `@googleapis/admin@31.0.0`만 추가한다. Google 샘플 repository 전체, 외부 Chat bot framework, 별도 queue/cron은 도입하지 않는다.
- server credential 이름은 정확히 `GOOGLE_WORKSPACE_DIRECTORY_CLIENT_EMAIL`, `GOOGLE_WORKSPACE_DIRECTORY_PRIVATE_KEY`, `GOOGLE_WORKSPACE_DIRECTORY_SUBJECT`다. scope는 정확히 `https://www.googleapis.com/auth/admin.directory.user.readonly`다. credential/token 원문은 DB, browser response, audit, test fixture, log에 남기지 않는다.
- Preview와 local에는 실제 Directory credential을 설치하지 않는다. credential 부재는 설정 UI의 `not_configured` readiness일 뿐 기존 업무나 Google Chat 메시지를 실패시키지 않는다.
- identity mutation은 browser가 이메일, verification status, provider outcome을 선택하게 하지 않는다. route가 현재 DB 이메일을 읽고 Directory 결과를 검증한 뒤 service-role RPC에 닫힌 outcome을 전달한다.
- `public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid)`와 override v2는 수정·대체·우회하지 않는다. 멘션 토글은 별도 table/RPC/API와 독립 revision을 사용한다.
- 규칙 행이 `notification_rule_mention_settings`에 있을 때만 UI에 멘션 스위치를 노출한다. 기반 migration은 기존 workflow 행을 seed하지 않는다. 청강 `105000`만 최초 채택 규칙을 seed하며 다른 workflow의 기존 routing/enabled/runtime을 바꾸지 않는다.
- action-required 규칙의 채택 기본값은 ON, informational 규칙은 OFF다. OFF는 멘션만 끄며 메시지 rule enabled 상태를 바꾸지 않는다.
- adapter/final-prepare는 프로필 ID 의미만 제공한다. raw Chat ID, `<users/...>`, `@all`, 임의 그룹, browser 대상은 받지 않는다.
- current direct assignee가 여러 명이면 모두 포함한다. 변경 이벤트는 이전+신규를 역할 우선순위와 profile UUID 안정 정렬로 중복 제거한다.
- active+verified identity만 mention 대상이다. missing/unverified/inactive는 `identity_missing | identity_unverified | profile_inactive` code로 snapshot audit에 남기고 메시지는 자연스러운 무멘션 text+card로 계속 보낸다.
- 첫 provider marker 전에는 source, rule setting revision, profile activity, identity revision을 같은 final-prepare 잠금 경계에서 재검증한다. marker 뒤 retry는 최초 `notification_delivery_mention_snapshots`을 그대로 사용하고 mention 대상이나 render를 바꾸지 않는다.
- 핵심 업무 저장과 provider를 분리한다. Directory, mention, webhook 실패가 청강 예약·출결·피드백·원장 결정·등록 신청을 rollback하지 않는다.
- 신규 table은 RLS를 켜고 `PUBLIC, anon, authenticated, service_role` direct table privilege를 모두 revoke한다. 모든 SECURITY DEFINER는 `SET search_path = ''`, schema-qualified relation/function, exact actor/role guard, exact signature revoke/grant를 갖는다.
- 기존 migration은 byte-identical로 유지한다. DB 변경은 pinned Supabase CLI 2.103.0으로 만든 단일 forward migration `20260809104500_dashboard_google_chat_profile_mentions.sql`만 소유한다.
- 구현/test, clean local DB, Git push, Supabase apply, Vercel READY, Directory readiness, mention rule activation, provider receipt, 실제 방 수신은 각각 별도 증거다. 이 계획은 provider activation·실제 전송·Production credential 설치를 실행하지 않는다.

## Exact File Responsibility Map

| File | Responsibility |
|---|---|
| `package.json` | exact official Directory dependency |
| `pnpm-lock.yaml` | exact transitive resolution and integrity |
| `supabase/migrations/20260809104500_dashboard_google_chat_profile_mentions.sql` | identity ledger/audit/request receipts, rule mention settings, assignment change facts, delivery mention snapshots, read/mutation/resolver/helper RPCs, triggers, ACL |
| `supabase/tests/dashboard_google_chat_profile_mentions_test.sql` | identity transitions, actor matrix, rule toggle, assignment facts, resolver/snapshot/retry, ACL pgTAP |
| `scripts/run-registration-observation-local-db-qa.mjs` | `chat-mentions` focus at ceiling `20260809104500`, no remote/provider capability |
| `tests/registration-observation-local-db-runner.test.mjs` | exact focus order, ceiling, test file, provider-zero stage |
| `src/features/management/google-chat-profile-identity-types.ts` | strict wire/domain identity DTO and parser |
| `src/features/management/google-chat-profile-identity-service.ts` | authenticated GET/POST client with 12s abort and exact response parsing |
| `src/features/management/server/google-workspace-directory-client.ts` | official Admin SDK assembly and injected lookup boundary |
| `src/features/management/server/google-chat-profile-identity-route.ts` | admin/staff auth, current-email source read, Directory verification, service-role persistence |
| `src/app/api/admin/google-chat-identities/route.ts` | Node runtime GET/POST route export |
| `src/features/management/teacher-google-chat-identity-panel.tsx` | unique profile identity rows, auto lookup/manual verify/status/warning UI |
| `src/features/management/teacher-master-workspace.tsx` | mount the shared profile panel without coupling it to teacher catalog save |
| `src/features/notifications/notification-mention-settings-types.ts` | strict adopted-rule mention DTO/parser |
| `src/features/notifications/notification-mention-settings-service.ts` | authenticated GET/PATCH service |
| `src/features/notifications/server/notification-mention-settings-route.ts` | admin/staff exact route/RPC boundary |
| `src/app/api/notifications/mention-settings/route.ts` | Node runtime GET/PATCH route export |
| `src/features/notifications/notification-mention-settings.tsx` | per-rule independent switch state and conflict handling |
| `src/features/notifications/notification-control-panel.tsx` | render switches only for adopted Google Chat rules; preserve v2 draft save |
| `src/features/notifications/server/providers/google-chat-provider.ts` | validated optional user names, top-level text + existing cardsV2, size/markup guard |
| `src/features/notifications/server/notification-worker.ts` | exact optional begun-context array validation; no Directory import |
| `tests/dashboard-google-chat-profile-identities.test.mjs` | Directory/result/route/service strict behavior |
| `tests/teacher-google-chat-profile-identities.test.mjs` | desktop/mobile/admin-staff settings UX contract |
| `tests/notification-mention-settings.test.mjs` | separate DTO/service/route/UI toggle contract |
| `tests/notification-control-plane-worker.test.mjs` | top-level text, canonical mention, malformed input, existing payload regression |
| `tests/dashboard-google-chat-profile-mentions-provider-zero.test.mjs` | production assembly with fake Directory/fetch and provider count 0 |
| `docs/superpowers/reports/2026-08-10-dashboard-google-chat-profile-mentions-report.md` | code/DB/build/default-OFF evidence; no provider-live claim |

## Exported DB and Type Contracts

### Identity read and sync

```sql
public.list_google_chat_profile_identities_v1() returns jsonb
-- active authenticated admin/staff only

public.read_google_chat_profile_identity_sync_source_v1(
  p_actor_profile_id uuid,
  p_profile_id uuid
) returns jsonb
-- service_role only; revalidates active admin/staff actor

public.apply_google_chat_profile_identity_sync_v1(
  p_actor_profile_id uuid,
  p_profile_id uuid,
  p_account_email_snapshot text,
  p_lookup_mode text,
  p_candidate_chat_user_id text,
  p_sync_outcome text,
  p_expected_identity_revision bigint,
  p_request_id uuid
) returns jsonb
-- service_role only; lookup_mode auto|manual
-- sync_outcome verified|not_found|email_mismatch|provider_error
```

```ts
export type GoogleChatProfileIdentity = Readonly<{
  profileId: string
  profileName: string
  accountEmail: string
  dashboardRole: "admin" | "staff" | "teacher" | "assistant" | "viewer"
  chatUserId: string | null
  resourceName: string | null
  source: "directory" | "manual" | null
  verificationStatus: "verified" | "unverified" | "not_found"
  verifiedAt: string | null
  lastSyncStatus: "ok" | "not_found" | "email_mismatch" | "provider_error" | null
  lastSyncAt: string | null
  identityRevision: string
  eligible: boolean
}>

export type GoogleChatProfileIdentitySnapshot = Readonly<{
  identities: ReadonlyArray<GoogleChatProfileIdentity>
  directory: Readonly<{
    status: "ready" | "not_configured"
    configured: boolean
  }>
  editable: boolean
}>
```

### Rule setting

```sql
public.list_notification_rule_mention_settings_v1(
  p_workflow_key text
) returns jsonb

public.save_notification_rule_mention_setting_v1(
  p_rule_id uuid,
  p_mention_enabled boolean,
  p_expected_revision bigint,
  p_request_id uuid
) returns jsonb
```

```ts
export type NotificationMentionSetting = Readonly<{
  ruleId: string
  workflowKey: string
  eventKey: string
  channelKey: "google_chat"
  mentionEnabled: boolean
  revision: string
  updatedAt: string | null
  editable: boolean
}>
```

### Semantic change facts and resolver

```sql
dashboard_private.notification_assignment_change_facts(
  fact_id uuid primary key,
  workflow_key text not null,
  source_type text not null,
  source_id text not null,
  source_revision bigint check (source_revision is null or source_revision >= 0),
  context_entity_id uuid not null,
  role_key text not null check (role_key in ('subject_teacher','track_director')),
  previous_profile_ids uuid[] not null,
  current_profile_ids uuid[] not null,
  occurred_at timestamptz not null
)

create unique index notification_assignment_change_facts_identity_idx
  on dashboard_private.notification_assignment_change_facts(
    workflow_key,
    source_type,
    source_id,
    coalesce(source_revision, -1),
    role_key
  );

public.resolve_google_chat_profile_mentions_v1(
  p_profile_ids uuid[]
) returns jsonb
-- service_role only
```

Resolver wire response is exact:

```json
{
  "profile_ids": [],
  "user_names": [],
  "omitted": [],
  "identity_revision_fingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

Each omitted row has exact keys `profile_id,reason`; reason is exactly `identity_missing | identity_unverified | profile_inactive`. Input is deduplicated by first role-priority occurrence, then stable UUID order within the same role. `user_names` contains only canonical `users/[1-9][0-9]{0,31}` values.

### Delivery snapshot seam

```sql
dashboard_private.prepare_google_chat_delivery_mention_snapshot_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_rule_id uuid,
  p_profile_ids uuid[],
  p_retry_frozen boolean
) returns jsonb
```

First attempt reads the current adopted setting and identities, inserts exactly one immutable snapshot and returns its `user_names`. Retry requires the existing snapshot and returns it unchanged. The helper never calls a provider, never changes rule enabled state, and has no API-role EXECUTE grant; only reviewed owner-definer final-prepare functions may call it.

---

### Task 1: Freeze the Migration and Add the Isolated DB Focus

**Files:**
- Create: `supabase/migrations/20260809104500_dashboard_google_chat_profile_mentions.sql`
- Create: `supabase/tests/dashboard_google_chat_profile_mentions_test.sql`
- Modify: `scripts/run-registration-observation-local-db-qa.mjs`
- Modify: `tests/registration-observation-local-db-runner.test.mjs`

**Interfaces:**
- Produces: exact `chat-mentions` focus with ceiling `20260809104500`
- Preserves: existing focus names/order, dynamic loopback ports, provider/outbox zero receipts and cleanup evidence

- [ ] **Step 1: Generate and freeze the one migration before writing SQL**

```bash
cd /Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/registration-observation-workflow
TIPS_OBSERVATION_CLI=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go
test "$($TIPS_OBSERVATION_CLI --version)" = "2.103.0"
target="supabase/migrations/20260809104500_dashboard_google_chat_profile_mentions.sql"
test ! -e "$target"
$TIPS_OBSERVATION_CLI migration new dashboard_google_chat_profile_mentions
generated="$(rg --files supabase/migrations | rg '/[0-9]{14}_dashboard_google_chat_profile_mentions\.sql$')"
test "$(printf '%s\n' "$generated" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
git add -- "$generated"
git mv -- "$generated" "$target"
test "$(git diff --cached --name-only --diff-filter=ACMR | rg 'dashboard_google_chat_profile_mentions\.sql$')" = "$target"
test -z "$(git diff --cached --name-only --diff-filter=D | rg 'dashboard_google_chat_profile_mentions')"
```

Expected: exact target is staged `A`, generated timestamp path is absent, staged delete count is zero.

- [ ] **Step 2: Write the runner RED**

Add an exact contract assertion:

```js
assert.deepEqual(runner.getRegistrationObservationFocusContract("chat-mentions"), {
  ceiling: "20260809104500",
  tests: ["supabase/tests/dashboard_google_chat_profile_mentions_test.sql"],
})
assert.equal(
  runner.listRegistrationObservationFocusNames().indexOf("chat-mentions")
    < runner.listRegistrationObservationFocusNames().indexOf("google-chat"),
  true,
)
```

- [ ] **Step 3: Run RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-local-db-runner.test.mjs
```

Expected: `chat-mentions` focus is missing.

- [ ] **Step 4: Add the focus and minimal dependency-gate GREEN**

The registry entry is exact:

```js
[
  "chat-mentions",
  {
    ceiling: "20260809104500",
    migrations: ["20260809104500_dashboard_google_chat_profile_mentions.sql"],
    tests: ["supabase/tests/dashboard_google_chat_profile_mentions_test.sql"],
    fixture: "noop",
    providerOutboxStage: "core",
  },
]
```

Make the frozen migration non-empty with `begin`/`commit` and one fail-closed dependency DO block that asserts the exact existing profile, notification rule/delivery, active-profile helper, and runtime-readiness signatures required by Task 2. The first pgTAP plan asserts only those real dependencies, runtime `0`, and API-role inability to execute the future private seam; do not use placeholder passes or claim the identity schema exists yet.

- [ ] **Step 5: Run focused GREEN and commit the safe runner/dependency seam**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-local-db-runner.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus chat-mentions
```

Expected: Node runner contract and dependency pgTAP pass; clean DB applies the non-empty guarded migration with runtime `0`, provider/outbox delta `0`, cleanup passed. This intermediate commit is safe but incomplete; Task 2 expands the same not-yet-deployed frozen migration and replaces the narrow pgTAP plan with the full behavioral contract.

```bash
git add scripts/run-registration-observation-local-db-qa.mjs tests/registration-observation-local-db-runner.test.mjs supabase/tests/dashboard_google_chat_profile_mentions_test.sql "$target"
test -s "$target"
git diff --cached --check
git commit -m "test: add Google Chat mention DB focus"
```

---

### Task 2: Implement the Identity Ledger, Rule Settings, Change Facts, and Snapshot Helper

**Files:**
- Modify: `supabase/migrations/20260809104500_dashboard_google_chat_profile_mentions.sql`
- Modify: `supabase/tests/dashboard_google_chat_profile_mentions_test.sql`

**Interfaces:**
- Produces: all exported SQL contracts in this plan
- Consumes: `profiles`, `notification_rules`, `notification_deliveries`, `notification_profile_is_active_v1`, observation/appointment tables and canonical v2 registration track events

- [ ] **Step 1: Add behavioral RED matrices**

The pgTAP must cover:

1. active admin and staff list/sync; teacher/assistant/viewer/anon/inactive/deleted/banned denied;
2. verified auto/manual transition with numeric ID and normalized current email;
3. stale revision and request-key fingerprint conflict;
4. same request replay returns byte-equal response with audit/revision delta 0;
5. not-found/email-mismatch removes eligibility;
6. provider-error preserves a prior verified ID only when current email equals the verified snapshot;
7. rule setting accepts only adopted `google_chat` rule rows and saves independently of rule revision/v2 save;
8. teacher `A→B` observation update writes one `subject_teacher` fact keyed by the appointment notification revision;
9. v2 registration director event writes one `track_director` fact using metadata previous/current IDs; malformed/other events write zero;
10. resolver preserves first semantic occurrence, deduplicates one person across roles, omits missing/unverified/inactive with exact reason;
11. mention OFF returns empty names; first prepare freezes; identity/setting drift after a registered attempt does not alter retry snapshot;
12. direct table DML and ungranted EXECUTE fail for all API roles.

- [ ] **Step 2: Run DB RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus chat-mentions
```

Expected: missing relations/functions and transition assertions fail; provider/outbox delta remains 0.

- [ ] **Step 3: Implement exact tables and invariants**

Use private tables:

```text
google_chat_profile_identities
google_chat_profile_identity_audits
google_chat_profile_identity_requests
notification_rule_mention_settings
notification_rule_mention_setting_audits
notification_rule_mention_setting_requests
notification_assignment_change_facts
notification_delivery_mention_snapshots
```

Important invariants:

- `chat_user_id ~ '^[1-9][0-9]{0,31}$'` and unique when non-null;
- verified requires ID, email snapshot, verified_at and last_sync_status `ok`;
- unverified/not_found cannot be eligible;
- audit rows are insert-only and contain no credential/token/webhook;
- mention setting FK targets one Google Chat rule; foundation seeds zero rows;
- snapshot `user_names` and omitted JSON are immutable after INSERT;
- assignment arrays are canonical distinct UUID arrays with at least one old/new difference.

- [ ] **Step 4: Implement actor-guarded RPCs and triggers**

The admin/staff read RPC uses the authenticated caller. Service-role sync functions accept `p_actor_profile_id` and re-read that actor's current active admin/staff profile before reading or writing another profile.

Teacher fact trigger ordering is observation update → read already-incremented appointment notification revision → insert fact. Director fact trigger safely parses only canonical outer `registration_track_event`, top-level `version=2`, inner `director_default_resolved|director_manual_override|director_default_cleared` and exact metadata. Invalid text/data exception is ignored rather than aborting the underlying registration mutation.

The resolver uses `WITH ORDINALITY`, exact active-profile helper, first-occurrence dedupe and a canonical SHA-256 fingerprint. The snapshot helper requires service role, exact claim token/rule/delivery, adopted setting and retry mode; it never calls begin/finalize/provider.

- [ ] **Step 5: Seal owner/ACL and run GREEN**

Every definer gets owner `postgres`, empty search path and exact ACL. Trigger/private helpers have no direct API EXECUTE. Public list/settings mutation get only `authenticated` where the function itself checks role; sync/resolver get only `service_role`.

```bash
git add supabase/migrations/20260809104500_dashboard_google_chat_profile_mentions.sql supabase/tests/dashboard_google_chat_profile_mentions_test.sql
test -s supabase/migrations/20260809104500_dashboard_google_chat_profile_mentions.sql
git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/20260809104500_dashboard_google_chat_profile_mentions\.sql$'
test -z "$(git diff --cached --name-only --diff-filter=D | rg 'dashboard_google_chat_profile_mentions')"
git diff --cached --check
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus chat-mentions
```

Expected: all pgTAP pass, runtime `0`, provider/outbox delta `0`, cleanup passed.

```bash
git commit -m "feat: add Google Chat mention ledger"
```

---

### Task 3: Add the Official Directory Client and Strict Identity API

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/features/management/google-chat-profile-identity-types.ts`
- Create: `src/features/management/google-chat-profile-identity-service.ts`
- Create: `src/features/management/server/google-workspace-directory-client.ts`
- Create: `src/features/management/server/google-chat-profile-identity-route.ts`
- Create: `src/app/api/admin/google-chat-identities/route.ts`
- Create: `tests/dashboard-google-chat-profile-identities.test.mjs`

**Interfaces:**
- GET `/api/admin/google-chat-identities` with no query
- POST exact body `{profile_id,lookup_mode,chat_user_id,expected_identity_revision,request_id}`
- `lookup_mode='auto'` requires `chat_user_id=null`; `manual` requires numeric ID

- [ ] **Step 1: Write strict RED tests**

Test exact-key response parsing, UUID/revision/timestamp/enum validation, 12s abort, bearer auth, admin/staff allow and all other role denial. Directory cases are:

```ts
auto email -> users.get({ userKey: normalizedEmail, projection: "basic", viewType: "admin_view" })
manual ID -> users.get({ userKey: numericId, projection: "basic", viewType: "admin_view" })
```

Verify returned ID is numeric, `suspended !== true`, and current dashboard email equals primaryEmail or aliases case-insensitively. Add not found, email mismatch, 429/5xx/network provider error, missing env and malformed SDK response cases. Assert response/log never contains private key, access token or raw SDK error text.

- [ ] **Step 2: Run RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/dashboard-google-chat-profile-identities.test.mjs
```

Expected: modules/routes do not exist.

- [ ] **Step 3: Install the one exact dependency**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm add --save-exact @googleapis/admin@31.0.0
```

Check package/lock contain `31.0.0`; no broad `googleapis` package is added.

- [ ] **Step 4: Implement the injected Directory boundary**

Production assembly uses:

```ts
import { admin, auth } from "@googleapis/admin"

const jwt = new auth.JWT({
  email: clientEmail,
  key: privateKey.replace(/\\n/gu, "\n"),
  scopes: ["https://www.googleapis.com/auth/admin.directory.user.readonly"],
  subject,
})
const directory = admin({ version: "directory_v1", auth: jwt })
```

Expose an injected `getUser(userKey)` seam for tests. Do not export credentials or SDK response objects.

- [ ] **Step 5: Implement route orchestration**

GET authenticates admin/staff, loads identities through the caller-scoped list RPC, and adds only credential configured/not-configured readiness. POST authenticates admin/staff, exact-parses input, service-role reads the fresh current-email sync source, calls Directory, classifies one closed outcome, then calls the service-role apply RPC with actor ID and expected revision.

Do not persist anything when credential is missing. For an actual provider error, persist only the closed `provider_error` outcome using the DB transition contract.

- [ ] **Step 6: Run GREEN and commit**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/dashboard-google-chat-profile-identities.test.mjs tests/teacher-account-linking.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/management/google-chat-profile-identity-types.ts src/features/management/google-chat-profile-identity-service.ts src/features/management/server/google-workspace-directory-client.ts src/features/management/server/google-chat-profile-identity-route.ts src/app/api/admin/google-chat-identities/route.ts tests/dashboard-google-chat-profile-identities.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
```

```bash
git add package.json pnpm-lock.yaml src/features/management/google-chat-profile-identity-types.ts src/features/management/google-chat-profile-identity-service.ts src/features/management/server/google-workspace-directory-client.ts src/features/management/server/google-chat-profile-identity-route.ts src/app/api/admin/google-chat-identities/route.ts tests/dashboard-google-chat-profile-identities.test.mjs
git commit -m "feat: verify Google Chat profile identities"
```

---

### Task 4: Add the Teacher Settings Identity Panel

**Files:**
- Create: `src/features/management/teacher-google-chat-identity-panel.tsx`
- Modify: `src/features/management/teacher-master-workspace.tsx`
- Create: `tests/teacher-google-chat-profile-identities.test.mjs`
- Modify: `tests/teacher-account-linking.test.mjs`

**Interfaces:**
- Consumes: Task 3 browser service and unique `profiles.id` rows
- Produces: independent identity save state; never marks teacher catalog rows dirty

- [ ] **Step 1: Write UI RED**

Require one row per unique profile, not one per teacher catalog. Assert desktop and mobile surfaces show account email, numeric Chat ID or `미설정`, status `확인됨 | 미설정 | 재확인 필요 | 조회 실패`, last sync time, `자동 조회`, manual input and `확인`.

Assert admin/staff response `editable=true` enables controls, not-configured disables sync with a clear settings warning, identity save does not call `upsertTeacherCatalogs`, and keyboard labels include the profile name.

- [ ] **Step 2: Run RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/teacher-google-chat-profile-identities.test.mjs tests/teacher-account-linking.test.mjs
```

Expected: panel module/mount is missing.

- [ ] **Step 3: Implement minimal panel**

Mount a separate `Google Chat 계정` section after the organization tree and before recent audit. Load with its own AbortController, keep per-profile pending/error state, generate a fresh request UUID per explicit sync, send the row's current revision, replace only that returned identity, and surface 409 as `다른 관리자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.`

Never expose Directory raw error, email aliases, credential readiness details or internal UUID beyond the existing account row identity.

- [ ] **Step 4: Run GREEN and commit**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/teacher-google-chat-profile-identities.test.mjs tests/teacher-account-linking.test.mjs tests/common-controls-ui.test.mjs tests/subject-settings-workspace.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/management/teacher-google-chat-identity-panel.tsx src/features/management/teacher-master-workspace.tsx tests/teacher-google-chat-profile-identities.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
```

```bash
git add src/features/management/teacher-google-chat-identity-panel.tsx src/features/management/teacher-master-workspace.tsx tests/teacher-google-chat-profile-identities.test.mjs tests/teacher-account-linking.test.mjs
git commit -m "feat: manage Google Chat identities in teacher settings"
```

---

### Task 5: Add Independent Per-Rule Mention Toggles

**Files:**
- Create: `src/features/notifications/notification-mention-settings-types.ts`
- Create: `src/features/notifications/notification-mention-settings-service.ts`
- Create: `src/features/notifications/server/notification-mention-settings-route.ts`
- Create: `src/app/api/notifications/mention-settings/route.ts`
- Create: `src/features/notifications/notification-mention-settings.tsx`
- Modify: `src/features/notifications/notification-control-panel.tsx`
- Create: `tests/notification-mention-settings.test.mjs`
- Modify: `tests/notification-control-plane-ui.test.mjs`
- Modify: `tests/notification-control-plane-api.test.mjs`

**Interfaces:**
- GET `/api/notifications/mention-settings?workflow_key=registration`
- PATCH exact body `{rule_id,mention_enabled,expected_revision,request_id}`
- Preserves: existing NotificationDraft and v2 save payload exactly

- [ ] **Step 1: Write separation RED**

Assert the mention endpoint exact-parses adopted rows, admin/staff can toggle, other roles fail, stale revision is 409, replay is equal, unsupported/non-Google rule is 400. UI renders no switch when the GET result has no row.

Add a source assertion that `NotificationDraft`, `toWirePatch`, `save_notification_control_plane_v2` patch keys and conflict fields still contain no `mentionEnabled`/`mention_enabled`.

- [ ] **Step 2: Run RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/notification-mention-settings.test.mjs tests/notification-control-plane-ui.test.mjs tests/notification-control-plane-api.test.mjs
```

Expected: new endpoint/service/component missing.

- [ ] **Step 3: Implement route/service/component**

The control panel loads mention settings in parallel with, but independently from, the existing control-plane snapshot. A mention switch saves immediately using its own expected revision/request ID and refreshes only the returned row. Existing unsaved title/body/rule-enabled draft stays intact across mention saves and conflicts.

Label exact behavior: `담당자 멘션` and helper text `확인된 Google Chat 계정만 멘션합니다.`. Do not provide role or user pickers.

- [ ] **Step 4: Run GREEN and commit**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/notification-mention-settings.test.mjs tests/notification-control-plane-ui.test.mjs tests/notification-control-plane-api.test.mjs tests/notification-control-plane-model.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/notifications/notification-mention-settings-types.ts src/features/notifications/notification-mention-settings-service.ts src/features/notifications/server/notification-mention-settings-route.ts src/app/api/notifications/mention-settings/route.ts src/features/notifications/notification-mention-settings.tsx src/features/notifications/notification-control-panel.tsx tests/notification-mention-settings.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
```

```bash
git add src/features/notifications/notification-mention-settings-types.ts src/features/notifications/notification-mention-settings-service.ts src/features/notifications/server/notification-mention-settings-route.ts src/app/api/notifications/mention-settings/route.ts src/features/notifications/notification-mention-settings.tsx src/features/notifications/notification-control-panel.tsx tests/notification-mention-settings.test.mjs tests/notification-control-plane-ui.test.mjs tests/notification-control-plane-api.test.mjs
git commit -m "feat: add per-rule Google Chat mention settings"
```

---

### Task 6: Extend the Existing Google Chat Provider with Safe Mentions

**Files:**
- Modify: `src/features/notifications/server/providers/google-chat-provider.ts`
- Modify: `src/features/notifications/server/notification-worker.ts`
- Modify: `tests/notification-control-plane-worker.test.mjs`

**Interfaces:**
- Adds tri-state optional `mention_user_names?: ReadonlyArray<string>` to begun context
- Produces legacy exact `{cardsV2}` when absent and adopted-rule `{text,cardsV2}` when present, including an empty array
- Preserves provider classification, one-argument send, URL allowlist, existing card/button

- [ ] **Step 1: Write provider RED**

Add cases for legacy absent, adopted zero, one, multiple, duplicate, malformed and more than 20 resource names. Expected canonical text for a valid pair is:

```text
<users/123456789> <users/987654321> 새 할 일 — 확인할 할 일이 있습니다.
```

An adopted rule with zero eligible targets is exactly:

```text
새 할 일 — 확인할 할 일이 있습니다.
```

Assert a legacy context with the property absent has no top-level `text` and its cardsV2 payload is byte-compatible. An adopted context with `[]` has the natural no-mention top-level text above and the same card. Title/body containing raw `<users/`, `@all`, control/bidi or external URL fails before fetch, total JSON remains at most 32,000 bytes, and malformed mention arrays fail before attempt transport.

- [ ] **Step 2: Run RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test --test-name-pattern='Google Chat' tests/notification-control-plane-worker.test.mjs
```

Expected: payload lacks `text` and mention validation.

- [ ] **Step 3: Implement canonical text builder**

Use exact `/^users\/[1-9]\d{0,31}$/u`, first-occurrence dedupe, maximum 20, flattened Unicode-whitespace title/body and server-generated markup only. Property absence is the legacy byte-compatible lane; property presence with `[]` is an adopted no-mention lane and must not collapse to absence. Do not escape a caller-supplied mention string because no such string is accepted.

The worker accepts only `undefined` or an exact array of canonical names in a `sending/google_chat` begun response. It must not import the Directory module or call any identity API.

- [ ] **Step 4: Run GREEN and commit**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/notification-control-plane-worker.test.mjs tests/notification-control-plane-model.test.mjs tests/notification-operations.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/notifications/server/providers/google-chat-provider.ts src/features/notifications/server/notification-worker.ts tests/notification-control-plane-worker.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
```

```bash
git add src/features/notifications/server/providers/google-chat-provider.ts src/features/notifications/server/notification-worker.ts tests/notification-control-plane-worker.test.mjs
git commit -m "feat: render verified Google Chat mentions"
```

---

### Task 7: Prove the Shared Foundation Is Provider-Zero and Ready for Observation

**Files:**
- Create: `tests/dashboard-google-chat-profile-mentions-provider-zero.test.mjs`
- Modify: `tests/dashboard-google-chat-profile-identities.test.mjs`
- Modify: `tests/notification-mention-settings.test.mjs`
- Modify: `supabase/tests/dashboard_google_chat_profile_mentions_test.sql`
- Create: `docs/superpowers/reports/2026-08-10-dashboard-google-chat-profile-mentions-report.md`

**Interfaces:**
- Produces: shared-foundation completion evidence consumed by observation Google Chat plan
- Does not: seed observation rules, activate rule/runtime, call Directory/webhook, install Production env

- [ ] **Step 1: Write provider-zero integration RED**

Assemble the production identity route with injected fake Directory and service RPCs, and the production Google Chat provider with a fetch that increments and throws. Prove:

- GET and missing-credential paths call Directory 0 and fetch 0;
- one explicit identity sync calls Directory exactly 1 and fetch 0;
- identity/rule setting DB transitions call fetch 0;
- resolver/snapshot first/retry call Directory 0 and fetch 0;
- no adopted mention rows means existing workflow rules and enabled states are unchanged;
- worker source contains no import path to management Directory modules.

- [ ] **Step 2: Run RED then minimal GREEN**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/dashboard-google-chat-profile-mentions-provider-zero.test.mjs
```

Expected before integration fixture: missing production assembly hooks/receipts. Add only test injection seams required to execute the real route/provider boundaries; do not add provider capability to the DB runner.

- [ ] **Step 3: Run the complete local matrix**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/dashboard-google-chat-profile-identities.test.mjs tests/teacher-google-chat-profile-identities.test.mjs tests/notification-mention-settings.test.mjs tests/dashboard-google-chat-profile-mentions-provider-zero.test.mjs tests/notification-control-plane-worker.test.mjs tests/notification-control-plane-api.test.mjs tests/notification-control-plane-ui.test.mjs tests/teacher-account-linking.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus chat-mentions
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/verify-supabase-migration-layout.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/management/google-chat-profile-identity-*.ts src/features/management/server/google-*.ts src/features/management/server/google-chat-*.ts src/features/management/teacher-google-chat-identity-panel.tsx src/features/management/teacher-master-workspace.tsx src/features/notifications/notification-mention-*.ts src/features/notifications/notification-mention-*.tsx src/features/notifications/server/notification-mention-settings-route.ts src/features/notifications/server/providers/google-chat-provider.ts src/features/notifications/server/notification-worker.ts tests/dashboard-google-chat-profile-*.test.mjs tests/teacher-google-chat-profile-identities.test.mjs tests/notification-mention-settings.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/next/dist/bin/next build --webpack
git diff --check
```

Expected: all tests pass; clean DB runtime `0`, provider/outbox delta `0`, cleanup passed; layout verifier, ESLint, tsc, webpack build and diff pass. Do not freeze a page-count assertion because unrelated routes may change before execution.

- [ ] **Step 4: Write the evidence report and commit**

The report records exact HEAD, migration hash, test counts, DB focus receipt, provider calls 0, Directory calls only in explicit sync fixture, no mention setting seed, no env/provider activation, and the next consumer migration `105000`.

```bash
shasum -a 256 supabase/migrations/20260809104500_dashboard_google_chat_profile_mentions.sql src/features/notifications/server/providers/google-chat-provider.ts tests/dashboard-google-chat-profile-mentions-provider-zero.test.mjs
git add docs/superpowers/reports/2026-08-10-dashboard-google-chat-profile-mentions-report.md tests/dashboard-google-chat-profile-mentions-provider-zero.test.mjs tests/dashboard-google-chat-profile-identities.test.mjs tests/notification-mention-settings.test.mjs supabase/tests/dashboard_google_chat_profile_mentions_test.sql
git diff --cached --check
git commit -m "test: verify Google Chat mention foundation"
```

---

## Observation Consumer Handoff

The following is implemented only in `2026-08-09-registration-observation-google-chat.md` after this plan passes:

1. `105000` seeds seven Google Chat mention settings: scheduled ON, rescheduled ON, canceled OFF, 3-hour reminder ON, feedback-due ON, feedback-submitted management ON, director-reassigned management ON. The paired in-app rule has no Chat mention row.
2. Subject events pass current teacher profile IDs. Rescheduled reads the `subject_teacher` assignment fact for the same observation+notification revision; when it exists, semantic profiles are previous+current, otherwise current only.
3. Feedback-submitted routes to `google_chat.management`, not executive, and passes current track director.
4. The `105000` trigger consumes canonical `track_director` assignment facts only while the track has an undecided current observation and creates `registration.observation_director_reassigned`; its semantic profiles are previous+current.
5. Observation final-prepare calls the shared snapshot helper before existing `begin_notification_delivery_send_v1`, adds only returned `mention_user_names` to the begun JSON, and freezes it after the first external-attempt marker.
6. Missing/unverified identities produce the same message without a mention; they never reroute to executive, management-wide fallback or `@all`.

## Future Workflow Adoption Gate

This plan intentionally builds the shared wheel once and adopts only observation in `105000`. 일반 할 일, 일반 등록, 전반·퇴원, 휴보강, 전자결재에서는 같은 profile identity, rule-setting, assignment-fact, snapshot, worker context, provider renderer를 재사용한다. Each future workflow still needs its own reviewed adoption migration/plan that fixes:

1. exact action-required versus informational rule classification and default mention toggle;
2. canonical semantic role and source revision used to derive profile IDs;
3. subject-room teacher versus management-room director destination matrix;
4. previous+current behavior for reassignment and stable role/UUID ordering;
5. provider-zero, missing-identity no-mention, retry-frozen and real-room receipt tests.

No future adopter may add a second Directory client, store a Chat ID on a teacher catalog, accept raw markup, query Directory from a worker, or seed a management-wide/`@all` fallback. If a workflow cannot prove its canonical assignee facts, it sends the existing message without a mention until that workflow has a reviewed semantic resolver.

## Plan Completion Gate

- [ ] Exact official `@googleapis/admin@31.0.0` is installed; broad `googleapis` and external bot frameworks are absent.
- [ ] Directory credentials are server-only, read-only scope, Production-only, and never appear in DB/browser/log/audit.
- [ ] Admin/staff can list and verify; other/inactive accounts cannot. Browser cannot forge email/status/provider outcome.
- [ ] Identity transitions, revision conflicts, replay, audit, missing/mismatch/provider-error semantics pass clean pgTAP.
- [ ] Mention settings use a separate revision/API/UI and existing v2 rule save has no mention field.
- [ ] Foundation seeds zero adopted workflow rows and changes no rule enabled/runtime/provider state.
- [ ] Teacher/director assignment change facts preserve exact previous/current profiles without provider calls.
- [ ] Resolver returns only active verified canonical user names and exact omission reasons.
- [ ] First attempt snapshots current setting/identity; retry uses the immutable snapshot.
- [ ] Provider accepts only optional canonical user-name arrays, preserves property absence as exact legacy `{cardsV2}`, and emits adopted-rule `{text,cardsV2}` for present empty/nonempty arrays; malformed/raw/all mentions fail before fetch.
- [ ] Existing Google Chat card, button, URL allowlist, HTTP result classification and non-observation messages regressions pass.
- [ ] Worker imports/calls Directory zero times.
- [ ] `chat-mentions` clean DB focus, pgTAP, Node tests, ESLint, tsc, webpack build, migration layout and diff pass.
- [ ] Runtime is 0, provider/outbox delta is 0, no actual Directory credential/provider activation/real send occurred.
- [ ] Evidence report distinguishes code, local DB, Git, Production DB, Vercel, Directory readiness, rule activation and actual room receipt.
