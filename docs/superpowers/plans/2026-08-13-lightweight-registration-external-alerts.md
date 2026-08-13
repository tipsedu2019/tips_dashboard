# Lightweight Registration External Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 레벨테스트·방문상담·청강의 예약 완료 알림은 사건 발생 때만 보내고, 당일 리마인드는 매일 오전 10시(KST) 한 번만 보내는 경량 알림 경로로 교체한다.

**Architecture:** 정식 예약 저장 transaction은 gate가 허용한 PII-free delivery intent만 원자적으로 만든다. commit 뒤 Supabase Database Webhook이 exact delivery ID를 private Vercel dispatcher로 전달한다. dispatcher는 canonical source를 다시 읽고 SOLAPI 또는 Google Chat 한 채널만 처리한다. 당일 리마인드는 `0 1 * * *` UTC cron 하나가 후보 snapshot/claim RPC와 같은 dispatcher를 한 번 호출한다. 상세 receipt는 7일만 보존하고 durable compact state가 장기 dedupe를 소유한다.

**Tech Stack:** Next.js 16 server-only App Router routes, TypeScript 5.9, Supabase/PostgreSQL 17, Database Webhooks, pg_cron/pg_net, SOLAPI Kakao AlimTalk, Google Chat incoming webhooks/cardsV2, Node test runner, pgTAP.

## Global Constraints

- 승인 기준은 `docs/superpowers/specs/2026-08-13-supabase-free-tier-dashboard-notification-optimization-design.md`다.
- 실행은 최신 `origin/main` 기반 새 worktree에서 한다. 계획 작성 기준 `fad56ae5`에는 최신 청강·SOLAPI·Google Chat 구현이 있으므로 현재 223-commit-behind checkout에서 구현하지 않는다.
- 홈/통계와 query-surface 계획을 먼저 같은 최신-main branch에서 완료한 뒤 이 계획을 rebase하여 실행한다. `ops-task-service.ts`와 등록 workspace 경계가 겹치므로 별도 stale worktree에서 병렬 구현하지 않는다. 이 계획 뒤에 free-tier operations 계획을 실행한다.
- 기존 worker/watchdog와 기존 customer reminder cron은 계속 inactive로 둔다. source 구현이나 migration 적용은 그 job들을 재활성화할 권한이 아니다.
- exact matrix는 다음과 같다.

  | source | booking customer | booking Chat | 10:00 customer | 10:00 Chat |
  | --- | --- | --- | --- | --- |
  | level test | 1 | 0 | 1 | 0 |
  | visit consultation | 1 | management room + distinct stored directors | 1 | same mentions + 상담 준비 |
  | observation class | 1 | subject room + actual booked teacher | 1 | same mention + 청강 준비 |

- 방문상담이 여러 과목 track을 가질 때 관리팀방 메시지는 한 건만 보내고 저장된 `director_profile_id`들을 distinct mention한다. 검증된 identity가 하나도 없거나 일부 누락이면 broad fallback 없이 멘션 0건으로 보내고 `mention_unresolved`를 기록한다.
- 청강 mention은 예약 snapshot의 실제 `teacher_profile_id`만 사용한다. teacher/team/admin 전체 mention과 `@all`을 금지한다.
- 예약 변경은 booking alert를 다시 만들지 않는다. same-day reminder는 local date당 source/channel 한 번이며, 10:00 이후 생성한 당일 예약에는 catch-up을 만들지 않는다.
- 리마인드 eligibility cutoff는 실행 시각이 아니라 해당 KST 날짜의 정확한 `10:00:00`이다. 10:15 지연 실행이어도 10:05 예약은 제외하고, 10:00 이전 실행은 state/delivery를 하나도 만들지 않는다.
- provider HTTP는 예약 transaction 안에서 호출하지 않는다. provider 실패는 예약이나 다른 채널 상태를 rollback/재전송하지 않는다.
- Database Webhook은 at-least-once/out-of-order로 취급한다. exact claim과 provider 직전 `unknown` marker 없이는 호출하지 않는다.
- timeout, connection loss, 접수 여부가 모호한 5xx는 `unknown`이며 자동 재발송하지 않는다. provider가 요청 미접수를 명확히 보장하는 429/5xx만 동일 invocation에서 최대 2회 retry한다.
- provider 전 source/connection/identity/render preflight가 모두 끝나야 attempt marker를 쓸 수 있다. marker는 각 실제 HTTP call 직전에 한 번만 기록하고 attempt count도 실제 call 수와 같아야 한다. Google Chat 5xx는 명시적 비접수 증거가 없으므로 항상 `unknown`이다.
- receipt/state/UI/log에 전화번호, 학생명, 메시지 전문, template/PF ID, webhook URL, access key/secret, raw provider body를 저장하거나 반환하지 않는다.
- 모든 runtime gate는 `off`로 설치한다. migration, Vercel deploy, webhook 설치, cron 설치/활성화, SOLAPI template 승인, Chat connection/identity, provider request, 실제 수신은 각각 별도 단계다.
- 구형 inbox/web push/UI 제거는 새 경로의 provider request와 실제 수신을 종류·채널별로 검증한 뒤 별도 승인을 받아 수행한다.
- Database Webhook은 `booking_confirmed` delivery insert만 호출한다. immediate route는 `same_day_reminder`를 거부하고, reminder route는 run snapshot에 속하지 않은 delivery를 거부한다.
- delivery state key는 재예약에도 고정하지만, 각 intent에는 정식 저장 요청 key와 예약 revision을 포함한 immutable SHA-256 hash를 저장한다. 동일 state key에 다른 intent hash가 오면 재발송하지 않고 audit conflict로 남긴다.
- 이 계획의 다섯 migration은 홈/통계 계획의 `supabase/test-baselines/dashboard-free-tier-v1.manifest.json`에 생성 직후 `draft`/null hash로 등록하고, SQL+RED test 완료 뒤 DB test 직전에 current SHA-256의 `candidate`, 모든 pgTAP/probe GREEN 뒤 commit 직전에 같은 hash의 `final`로 승격한다. SQL이 한 byte라도 바뀌면 candidate hash를 다시 기록하고 해당 DB test를 다시 실행한다.

## Fixed Runtime Commands

```bash
export TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
export TASK_PNPM=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
export TASK_SUPABASE=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase
export TASK_REQUEST_ID=$(/usr/bin/uuidgen | /usr/bin/tr '[:upper:]' '[:lower:]')
```

각 task를 시작할 때 같은 shell에서 위 네 줄을 실행하고 모든 `Run:` block을 그 shell에서 실행한다. 새 shell이면 네 줄을 모두 다시 실행한다. local DB command는 `--request-id "$TASK_REQUEST_ID"`를 사용한다. bare `node`, `npm`, `npx`를 사용하지 않는다.

## Reused Assets

- Customer catalog/rendering: `src/features/tasks/server/registration-customer-message-catalog.ts`
- Canonical customer source/phone privacy: `src/features/tasks/server/registration-customer-message-source.ts`
- SOLAPI HMAC/provider adapter: `src/features/tasks/server/registration-customer-message-solapi.ts`
- Google Chat provider and broad-mention guard: `src/features/notifications/server/providers/google-chat-provider.ts`
- Encrypted Chat connection repository: `src/features/notifications/server/notification-connection-repository.ts`
- Verified profile mention resolver: `public.resolve_google_chat_profile_mentions_v1`
- Room key catalog: `src/features/notifications/notification-google-chat-catalog.ts`

기존 `notification_deliveries`, fanout/reconciliation queue, heartbeat, watchdog, inbox projection은 재사용하지 않는다.

## New Files

- `supabase migration new lightweight_external_alert_storage`가 생성한 exact migration path
- `supabase migration new lightweight_external_alert_producers`가 생성한 exact migration path
- `supabase migration new lightweight_external_alert_reminders`가 생성한 exact migration path
- `supabase migration new lightweight_external_alert_operations`가 생성한 exact migration path
- `supabase migration new lightweight_external_alert_cutover_fences`가 생성한 exact migration path
- `supabase/tests/lightweight_external_alert_storage_test.sql`
- `supabase/tests/lightweight_external_alert_producers_test.sql`
- `supabase/tests/lightweight_external_alert_reminders_test.sql`
- `supabase/tests/lightweight_external_alert_operations_test.sql`
- `supabase/tests/lightweight_external_alert_cutover_test.sql`
- `src/features/notifications/lightweight-external-alert-contract.ts`
- `src/features/notifications/server/lightweight-external-alert-repository.ts`
- `src/features/notifications/server/lightweight-external-alert-source.ts`
- `src/features/notifications/server/lightweight-external-alert-presentation.ts`
- `src/features/notifications/server/lightweight-external-alert-dispatcher.ts`
- `src/features/notifications/server/lightweight-external-alert-reminder-route.ts`
- `src/app/api/notifications/external/dispatch/route.ts`
- `src/app/api/notifications/external/reminders/route.ts`
- `src/app/api/admin/notifications/external-deliveries/route.ts`
- `src/app/api/admin/notifications/external-deliveries/recovery/route.ts`
- `src/features/notifications/external-delivery-history-service.ts`
- `src/features/notifications/external-delivery-history.tsx`
- `src/app/admin/settings/notifications/external-deliveries/page.tsx`
- `scripts/manage-lightweight-external-alert-schedule.mjs`
- `scripts/manage-lightweight-external-alert-gates.mjs`
- `scripts/verify-lightweight-external-alert-provider-zero.mjs`
- `docs/runbooks/lightweight-external-alert-database-webhook.md`
- `docs/operations/manifests/lightweight-external-alert-database-webhook.json`
- `tests/notification-lightweight-*.test.mjs`

## Core Contracts

```ts
export type LightweightAlertSourceKind =
  | "level_test"
  | "visit_consultation"
  | "observation_class"

export type LightweightAlertEventKind =
  | "booking_confirmed"
  | "same_day_reminder"

export type LightweightAlertChannel =
  | "customer_alimtalk"
  | "google_chat"

export type LightweightAlertResult =
  | "pending"
  | "accepted"
  | "unknown"
  | "failed_hold"

export type MentionResolution =
  | "not_applicable"
  | "resolved"
  | "mention_unresolved"
```

Provider adapter result는 다음 세 값만 허용한다.

```ts
export type ProviderAcceptance =
  | { kind: "accepted"; httpStatus: number; safeReference: string | null }
  | { kind: "definitely_not_accepted"; httpStatus: number | null; retryable: boolean }
  | { kind: "acceptance_unknown"; httpStatus: number | null }
```

Durable state key:

```text
source_kind + source_id + event_kind + channel + event_key

booking event_key  = "booking"
reminder event_key = KST YYYY-MM-DD
```

Immutable intent hash input은 key 순서를 고정한 다음 PII-free tuple이다.

```text
contract_version + source_kind + source_id + formal_request_key_hash
+ reservation_revision + event_kind + channel + event_key
```

Receipt를 지워도 이 state key와 terminal result는 남는다. reschedule revision이 바뀌어도 같은 날짜 reminder key는 다시 발송되지 않는다.

Storage ownership은 다음과 같이 고정한다.

| table | key/purpose | retention |
| --- | --- | --- |
| `dashboard_private.lightweight_external_alert_runtime_state` | singleton full ten-row gate-set version/hash, reminder five-row version/hash, transport version/fingerprint CAS owner | current durable |
| `dashboard_private.lightweight_external_alert_gates` | matrix row current mode/version/cutoff/verification scope | current durable |
| `dashboard_private.lightweight_external_alert_booking_facts` | source/revision별 formal request hash, confirmed/scheduled facts, responsible profile UUID/room snapshot | terminal source 뒤 30일 |
| `dashboard_private.lightweight_external_alert_states` | durable state key와 terminal dedupe | durable |
| `dashboard_private.lightweight_external_alert_deliveries` | generation, immutable intent hash, responsible/room/schedule snapshot, attempt/result receipt | terminal 뒤 7일 |
| `dashboard_private.lightweight_external_alert_management_requests` | gate/schedule/recovery approval before/after/reason | 30일 |
| `dashboard_private.lightweight_external_alert_audits` | intent conflict/preflight/reconciliation reason code | 30일 |
| `dashboard_private.lightweight_external_alert_run_ledger` | daily run counts/cutoff/status | 7일 |
| `dashboard_private.lightweight_external_alert_run_items` | run별 exact delivery ID/ordinal snapshot | 7일 |
| `dashboard_private.lightweight_external_alert_receipt_attestations` | external provider-request/actual-receipt manual attestation metadata | 30일 |

`booking_facts`와 delivery snapshot은 이름/전화번호/message를 저장하지 않고 UUID, enum, timestamps, room key만 가진다. 모든 private table은 direct PUBLIC/anon/authenticated access를 revoke하고 exact RPC로만 접근한다.

---

### Task 1: exact matrix와 보안 계약을 RED로 고정

**Files:**
- Create: `tests/notification-lightweight-contract.test.mjs`
- Create: `tests/notification-lightweight-security.test.mjs`
- Create: `src/features/notifications/lightweight-external-alert-contract.ts`

- [ ] **Step 1: 6개 event cell의 channel count RED 테스트를 작성한다**

  level test Chat 0, visit/observation Chat 1, 모든 customer 1을 literal matrix로 검증한다. reschedule/cancel/feedback event는 matrix parser가 거부해야 한다.

- [ ] **Step 2: mention policy RED 테스트를 작성한다**

  distinct director profiles, exact teacher profile, `@all`/broad mention 거부, partial/unresolved identity 때 mentionNames `[]`와 `mention_unresolved`를 검증한다.

- [ ] **Step 3: browser-safe DTO PII denylist를 고정한다**

  recursive key scan이 `phone`, `studentName`, `body`, `templateId`, `pfId`, `webhook`, `secret`, `authorization`, `rawResponse`를 거부하도록 만든다.

- [ ] **Step 4: contract parser를 최소 구현한다**

  unknown enum, malformed UUID/date, attemptCount > 3, receipt older than 7-day response window를 거부한다. gate wire contract는 다음 필드를 exact하게 검증한다.

  ```text
  source_kind, event_kind, channel, mode(off|verification|live),
  activated_at, eligibility_cutoff_at, verification_source_ids,
  verification_expires_at, version
  ```

  `verification`은 non-empty synthetic source UUID allowlist와 미래 expiry가 없으면 거부한다. `off|live`는 `verification_source_ids=[]`, `verification_expires_at=null`만 허용한다. `live` 전환은 별도 management request가 필요하다.

- [ ] **Step 5: GREEN과 커밋을 실행한다**

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/notification-lightweight-contract.test.mjs tests/notification-lightweight-security.test.mjs`

  Commit: `test: define lightweight external alert contract`

---

### Task 2: PII-free compact state, 7-day receipt, passive gates

**Files:**
- Create via CLI: generated `lightweight_external_alert_storage` migration
- Create: `supabase/tests/lightweight_external_alert_storage_test.sql`
- Create: `tests/notification-lightweight-storage.test.mjs`

- [ ] **Step 1: schema/ACL/idempotency RED 테스트를 작성한다**

  먼저 `"$TASK_SUPABASE" migration new lightweight_external_alert_storage`를 실행하고 exact path를 공용 manifest에 `draft`/null hash로 기록한다. SQL+RED test 뒤 DB test 직전에 current SHA-256의 `candidate`, pgTAP GREEN 뒤 commit 직전에 동일 hash의 `final`로 승격한다.

  다음 private tables를 요구한다.

  - `dashboard_private.lightweight_external_alert_runtime_state`
  - `dashboard_private.lightweight_external_alert_gates`
  - `dashboard_private.lightweight_external_alert_booking_facts`
  - `dashboard_private.lightweight_external_alert_states`
  - `dashboard_private.lightweight_external_alert_deliveries`
  - `dashboard_private.lightweight_external_alert_management_requests`
  - `dashboard_private.lightweight_external_alert_audits`
  - `dashboard_private.lightweight_external_alert_run_ledger`
  - `dashboard_private.lightweight_external_alert_run_items`
  - `dashboard_private.lightweight_external_alert_receipt_attestations`

  runtime state는 singleton key `registration_external_alerts`, full ten-row matrix용 `gate_set_version bigint`/`gate_set_hash text`, exact reminder five-row용 `reminder_gate_set_version bigint`/`reminder_gate_set_hash text`, `transport_version bigint`, `transport_fingerprint text`, timestamps를 durable하게 소유하고 migration에서 version 1/off-matrix hashes로 seed한다. request ledger 30일 row가 current CAS owner가 되어서는 안 된다. gates는 exact ten matrix rows를 모두 `off`로 seed한다. gate mutation은 target row version과 full gate-set version/hash를 같은 transaction에서 갱신하고, target이 five reminder rows 중 하나면 reminder version/hash도 같은 transaction에서 갱신한다. delivery state는 `(source_kind,source_id,event_kind,channel,event_key)` unique, delivery는 `(state_id,generation)` unique다.
  gate 변경 요청 ledger는 request UUID, actor profile, exact before/after, reason, requested/decided timestamp만 보관하고 PII를 금지한다. admin server route가 signed-in 사용자의 JWT로 호출하는 exact RPC는 다음이다.

  ```sql
  public.manage_lightweight_external_alert_gate_v1(
    p_request_id uuid,
    p_expected_version bigint,
    p_source_kind text,
    p_event_kind text,
    p_channel text,
    p_action text,                 -- set_verification | set_live | emergency_off
    p_verification_source_ids uuid[],
    p_verification_expires_at timestamptz,
    p_reason text
  )
  ```

  이 human mutation RPC는 service-role attribution을 사용하지 않는다. authenticated JWT로 호출하고 `auth.uid()`가 active admin profile인지 DB에서 재검증해 그 UUID만 actor로 기록한다. server route도 signed-in 사용자의 JWT client로 호출하며 CLI mutation은 env `SUPABASE_USER_ACCESS_TOKEN`을 요구하고 arbitrary actor UUID를 받지 않는다. requested/decided/activated timestamps와 eligibility cutoff는 caller input을 받지 않고 같은 DB `statement_timestamp()` 값으로 만든다. 따라서 과거 cutoff로 pre-activation fact를 backfill할 수 없다. compare-and-set, `off -> verification -> live`, verification expiry/synthetic scope, readiness proof를 강제한다. `emergency_off`는 verification/live에서 즉시 off로 갈 수 있고 provider call을 추가하지 않는다. off에서 재활성화할 때는 DB가 새 eligibility cutoff를 만들고 새 request UUID가 필수다. PUBLIC/anon direct table/RPC access와 staff/teacher execute는 모두 거부하고 authenticated grant는 function 내부 active-admin check와 함께만 둔다.

- [ ] **Step 2: claim/marker/finalize RED 테스트를 작성한다**

  service role exact delivery만 claim한다. source/connection/mention/render preflight 전에는 marker가 없어야 한다. `mark...attempt`는 실제 HTTP call 직전에 delivery/state를 `unknown`으로 바꾸고 attempt count를 정확히 1 증가시킨 뒤 one-time attempt token/number를 반환한다. provider finalize는 그 attempt token/number를 모두 요구한다. HTTP 전 preflight 실패는 attempt 0 전용 RPC로 `failed_hold` 처리한다. 다른 channel row를 update하지 않아야 한다.

- [ ] **Step 3: migration을 구현한다**

  SQL function 경계는 다음과 같다.

  ```sql
  public.claim_lightweight_external_alert_v1(p_delivery_id uuid, p_request_id uuid)
  public.mark_lightweight_external_alert_attempt_v1(p_delivery_id uuid, p_claim_token uuid)
  public.finalize_lightweight_external_alert_v1(
    p_delivery_id uuid,
    p_claim_token uuid,
    p_attempt_token uuid,
    p_attempt_number integer,
    p_result text,
    p_http_status integer,
    p_provider_reference text,
    p_mention_resolution text
  )
  public.fail_lightweight_external_alert_preflight_v1(
    p_delivery_id uuid,
    p_claim_token uuid,
    p_reason_code text
  )
  public.list_recent_lightweight_external_alerts_v1(
    p_cursor_updated_at timestamptz default null,
    p_cursor_id uuid default null,
    p_limit integer default 30
  )
  ```

  claim은 claim token을 반환한다. mark는 각 실제 HTTP call과 retry 직전에 한 번 실행하며 같은 transaction에서 current gate mode/verification expiry+scope/global gate-set version, source active status/revision/scheduled time/responsible profile IDs/room key를 delivery snapshot과 재검증한다. 모두 같을 때만 attempt count를 증가시키고 `{status:'marked',attempt_token,attempt_number,gate_set_version}`를 반환한다. emergency-off, gate drift, cancel/reschedule/reassignment/routing drift면 marker와 attempt 증가 없이 `{status:'held',reason_code}`로 delivery를 `failed_hold` terminalize한다. dispatcher는 `marked` 외 result에서 provider를 호출할 수 없다. delivery list는 `updated_at desc,id desc` keyset과 server 31/read 30을 사용한다. recent-run list는 run ledger를 만드는 Task 6 reminder migration만 소유한다.

  모든 function은 fixed `search_path`다. claim/mark/finalize/prune runtime RPC는 PUBLIC/anon/authenticated revoke와 service-role-only execute다. list 및 human management/recovery/attestation RPC는 PUBLIC/anon revoke, authenticated execute를 두되 body 첫 줄에서 `auth.uid()` active-admin을 fail-closed 검증한다. safe provider reference는 길이/문자 제한을 둔다.

- [ ] **Step 4: retention function을 구현한다**

  production RPC `public.prune_lightweight_external_alert_receipts_v1(p_limit integer default 100)`는 caller clock을 받지 않고 DB `statement_timestamp()`만 사용하며 limit 1..500만 허용한다. private test helper에만 explicit clock을 주입할 수 있고 PUBLIC/runtime execute를 revoke한다. 최대 limit개의 24시간 이상 stuck `pending|claimed` 중 `attempt_count=0`은 provider에 도달할 수 없었으므로 state/delivery를 `failed_hold` + `stale_unattempted`로 terminalize한다. attempt marker가 존재해 `attempt_count>0`인 stuck row만 `unknown`으로 terminalize한다. 그 뒤 최대 limit개의 `terminalized_at <= statement_timestamp() - interval '7 days'` receipt를 삭제한다. state와 intent hash는 삭제하지 않는다. 같은 bounded cleanup family가 7일 run items/ledger, terminal source의 30일 booking facts, 30일 management/audit/attestation rows를 각각 최대 limit개 정리한다. cleanup은 reminder run의 dispatch가 모두 끝난 뒤 마지막 단계에서만 호출한다.

- [ ] **Step 5: pgTAP으로 PII 부재와 channel independence를 검증한다**

  information_schema column name과 실제 fixture payload 모두 denylist를 통과해야 한다. receipt delete 후 같은 state key insert는 duplicate로 막혀야 한다. admin은 recent-list/management RPC를 사용할 수 있지만 staff/teacher/anon은 거부되고, direct table access는 service role을 포함한 runtime RPC 밖에서 필요 최소 권한만 갖는지 검증한다.

- [ ] **Step 6: local pgTAP을 실행한다**

  Run: `"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/lightweight_external_alert_storage_test.sql`

- [ ] **Step 7: 커밋한다**

  Commit: `feat: add compact external alert storage`

---

### Task 3: 세 정식 예약 저장 경계에 event producer 연결

**Files:**
- Create via CLI: generated `lightweight_external_alert_producers` migration
- Create: `supabase/tests/lightweight_external_alert_producers_test.sql`
- Reference, copy, and forward-replace in the new migration only:
  - `dashboard_private.create_registration_case_with_initial_workflow_v1_impl` from `supabase/migrations/20260722100000_registration_science_subject.sql`
  - `dashboard_private.save_registration_appointment_details_impl` from `supabase/migrations/20260801091000_registration_status_independent_appointments.sql`
  - `dashboard_private.save_registration_observation_booking_v1_impl` from `supabase/migrations/20260809102000_registration_observation_booking.sql`
- Modify: `tests/registration-observation-booking.test.mjs`
- Modify: `supabase/tests/registration_observation_booking_test.sql`
- Create: `tests/notification-lightweight-producers.test.mjs`

- [ ] **Step 1: first-booking-only RED 테스트를 작성한다**

  먼저 `"$TASK_SUPABASE" migration new lightweight_external_alert_producers`를 실행하고 exact path를 공용 manifest에 `draft`/null hash로 기록한다. SQL+RED test 뒤 DB test 직전에 current SHA-256의 `candidate`, pgTAP GREEN 뒤 commit 직전에 동일 hash의 `final`로 승격한다.

  신규 level/visit/observation booking은 gate mode와 무관하게 PII-free booking fact 한 건을 append한다. gate가 eligible하면 matrix대로 intent를 만들고, 동일 예약 RPC replay는 fact/intent 추가 0, reschedule은 새 revision fact 1과 booking intent 0이어야 한다. gate off는 fact 1/intent 0이다. delivery insert failure와 provider failure를 혼동하지 않는다: provider는 이 transaction에서 호출될 수 없다.

- [ ] **Step 2: activation cutoff RED 테스트를 작성한다**

  gate를 켠 시각 이전 source를 producer가 backfill하지 않고, gate 전환 뒤 발생한 정식 예약 event만 eligible해야 한다. verification gate는 지정 synthetic scope 외 source를 거부한다.

- [ ] **Step 3: private enqueue helper를 구현한다**

  `dashboard_private.record_lightweight_external_alert_booking_fact_v1(...)`는 authoritative source kind/ID, raw formal request key, reservation revision, `booking_confirmed_at`, scheduled timestamp, visit의 distinct stored director profile UUIDs 또는 observation booking row의 teacher profile UUID, exact room key를 받는다. raw request key는 즉시 SHA-256하고 저장하지 않는다. source-specific forbidden profile/room fields를 거부한다. 이 helper는 gate off여도 idempotent fact를 기록한다.

  `dashboard_private.enqueue_lightweight_external_alert_booking_v1(p_booking_fact_id uuid)`는 fact만 받아 level test AlimTalk 하나, visit/observation 채널별 state/delivery 하나를 만든다. intent hash는 raw key를 다시 요구하지 않고 fact에 저장된 `formal_request_key_hash`를 위 canonical tuple에 넣어 계산한다. responsible profile UUIDs, room key, source revision, scheduled timestamp를 delivery에 immutable copy한다. state key는 고정하되 immutable intent hash가 앞선 intent와 다르면 duplicate delivery 대신 PII-free conflict audit를 만든다.

- [ ] **Step 4: 최신 세 impl을 forward migration에서 replace한다**

  기존 권한·return shape·locking·request-key semantics를 byte-for-byte 보존한다. initial booking과 모든 정식 reschedule 확정 지점에서 `record_lightweight_external_alert_booking_fact_v1(...)`를 호출해 revision fact를 남긴다. `enqueue_lightweight_external_alert_booking_v1(...)`는 source의 첫 booking 확정일 때만 호출하고 reschedule에서는 호출하지 않는다. request replay는 두 helper 모두 idempotent다. 과거 migration 파일을 수정하지 않는다.

- [ ] **Step 5: provider-zero/atomicity pgTAP을 실행한다**

  booking commit 전에는 HTTP가 없고, booking row와 intent가 같은 DB transaction에 있음을 검증한다. 이후 provider route failure fixture가 이미 commit된 예약을 바꾸지 못함을 Node test에서 검증한다.

  Run: `"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/lightweight_external_alert_producers_test.sql`

- [ ] **Step 6: 커밋한다**

  Commit: `feat: enqueue lightweight booking alerts`

---

### Task 4: canonical source, Chat routing, message presentation

**Files:**
- Create: `src/features/notifications/server/lightweight-external-alert-source.ts`
- Create: `src/features/notifications/server/lightweight-external-alert-presentation.ts`
- Modify: `src/features/notifications/server/notification-connection-repository.ts`
- Create: `tests/notification-lightweight-source.test.mjs`
- Create: `tests/notification-lightweight-presentation.test.mjs`

- [ ] **Step 1: canonical source RED fixture를 작성한다**

  dispatcher는 delivery가 고정한 `source_revision`, scheduled timestamp, responsible profile UUIDs, room key를 하나의 immutable revision snapshot으로 취급한다. appointment/observation canonical source는 provider marker 직전 같은 transaction-consistent read에서 current revision, active status, scheduled timestamp, room, responsible profile IDs를 모두 비교한다. 하나라도 snapshot과 다르면 old mention과 current content를 섞지 않고 `failed_hold/source_revision_changed`로 끝낸다. revision 전체가 일치할 때만 그 revision의 task/subjects/place/session/class와 private customer phone을 읽어 렌더링하고 snapshot mention을 사용한다. canceled/completed/missing/date-changed도 preflight hold다.

- [ ] **Step 2: exact Chat content RED fixture를 작성한다**

  링크 없이도 학생 표시명, 업무 종류, 과목, 일정, 장소/수업, 담당자, `상담 준비` 또는 `청강 준비` 행동을 이해할 수 있어야 한다. level test Chat renderer는 호출 자체를 거부한다.

- [ ] **Step 3: existing provider assets를 narrow adapter로 감싼다**

  customer message kind mapping은 다음을 사용한다.

  ```text
  level booking       -> level_test_booking
  visit booking       -> visit_consultation_booking
  level/visit reminder-> appointment_reminder
  observation booking -> observation_booking
  observation reminder-> observation_reminder
  ```

  Google Chat connection resolver는 management/subject key의 decrypted webhook을 server memory에서만 반환한다.
  SOLAPI와 Google Chat adapter는 `ProviderAcceptance`만 반환하고 raw body를 상위 계층에 넘기지 않는다. Chat 5xx/timeout/connection loss는 `acceptance_unknown`, 명시적 validation reject만 `definitely_not_accepted`다.

- [ ] **Step 4: mention resolution fallback을 구현한다**

  required profile set 전체가 verified일 때만 mention names를 넣는다. 하나라도 unresolved이면 names `[]`; message content는 담당자 이름 text를 유지하되 actual mention markup은 넣지 않는다.

- [ ] **Step 5: GREEN과 커밋을 실행한다**

  Commit: `feat: render lightweight registration alerts`

---

### Task 5: exact-delivery immediate dispatcher와 Database Webhook contract

**Files:**
- Create: `src/features/notifications/server/lightweight-external-alert-repository.ts`
- Create: `src/features/notifications/server/lightweight-external-alert-dispatcher.ts`
- Create: `src/app/api/notifications/external/dispatch/route.ts`
- Create: `tests/notification-lightweight-dispatcher.test.mjs`
- Create: `tests/notification-lightweight-dispatch-route.test.mjs`
- Create: `docs/runbooks/lightweight-external-alert-database-webhook.md`
- Create: `docs/operations/manifests/lightweight-external-alert-database-webhook.json`

- [ ] **Step 1: at-least-once/ambiguous RED 테스트를 작성한다**

  동일 webhook payload 두 번은 provider call 1회, stale claim 0회, marker 뒤 process crash는 state `unknown`, other channel untouched를 검증한다.

- [ ] **Step 2: private webhook parser/auth를 구현한다**

  route는 exact delivery UUID와 `booking_confirmed` event type만 받고 fixed bearer/signature를 timing-safe compare한다. `same_day_reminder`는 400으로 거부한다. Supabase webhook record의 그 외 field는 무시한다. secret은 env에만 둔다.

- [ ] **Step 3: dispatcher pipeline을 구현한다**

  ```text
  parse/auth -> claim exact ID -> reread canonical source
  -> resolve route/connection/mention -> render and validate
  -> mark unknown immediately before one provider call
  -> call one provider -> finalize one delivery
  ```

  preflight의 source/connection/render가 실패하면 HTTP/attempt marker 없이 `fail_lightweight_external_alert_preflight_v1`로 `failed_hold`와 allowlisted PII-free reason code를 terminalize한다. provider 응답 뒤에는 이 RPC를 사용할 수 없다.

- [ ] **Step 4: bounded retry policy를 구현한다**

  retry predicate는 provider adapter가 `definitely_not_accepted`와 `retryable=true`를 반환한 경우만 허용한다. 각 재시도도 새 marker/attempt number를 실제 HTTP 직전에 쓴다. 최대 총 3 attempts, 짧은 capped delay, 같은 invocation 안에서만 실행한다. timeout/connection loss/Chat 5xx/general ambiguous 5xx는 즉시 `unknown`이다.

- [ ] **Step 5: Database Webhook manifest/runbook를 source-only로 추가한다**

  `docs/operations/manifests/lightweight-external-alert-database-webhook.json`에 exact table insert filter `event_kind=booking_confirmed`, route, header name, expected payload keys, idempotency check를 고정한다. runbook에는 install/inspect/disable/rollback 및 duplicate/out-of-order synthetic test를 적는다. code에는 URL/secret을 넣지 않는다. 실제 webhook 생성은 rollout gate다.

- [ ] **Step 6: provider-zero GREEN과 커밋을 실행한다**

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/notification-lightweight-dispatcher.test.mjs tests/notification-lightweight-dispatch-route.test.mjs`

  Commit: `feat: dispatch exact external alert deliveries`

---

### Task 6: 오전 10시 snapshot/claim과 단일 inactive cron manager

**Files:**
- Create via CLI: generated `lightweight_external_alert_reminders` migration
- Create: `supabase/tests/lightweight_external_alert_reminders_test.sql`
- Create: `src/features/notifications/server/lightweight-external-alert-reminder-route.ts`
- Create: `src/app/api/notifications/external/reminders/route.ts`
- Create: `scripts/manage-lightweight-external-alert-schedule.mjs`
- Create: `tests/notification-lightweight-reminders.test.mjs`
- Create: `tests/notification-lightweight-schedule.test.mjs`

- [ ] **Step 1: KST boundary RED 테스트를 작성한다**

  먼저 `"$TASK_SUPABASE" migration new lightweight_external_alert_reminders`를 실행하고 exact path를 공용 manifest에 `draft`/null hash로 기록한다. SQL+RED test 뒤 DB test 직전에 current SHA-256의 `candidate`, pgTAP GREEN 뒤 commit 직전에 동일 hash의 `final`로 승격한다. booking-fact 09:59:59 포함, 10:00:00 정확한 cutoff, 10:05 fact 제외, 10:15 지연 run에서도 10:05 제외, gate live cutoff 이전 fact 제외, 09:59 run 전체 reject/zero-write, canceled/completed 제외, cutoff 전 latest eligible revision의 display/routing snapshot 고정, provider 직전 current revision 불일치 hold, same local date replay 0을 검증한다.

- [ ] **Step 2: candidate snapshot/claim CAS RPC를 구현한다**

  service-role-only public boundary를 다음 signature로 고정한다. 모든 timestamps/date/cutoff는 caller input이 아니라 DB `statement_timestamp()`에서 계산한다.

  ```sql
  public.create_lightweight_external_alert_reminder_run_v1(p_request_id uuid)
    -> {status:'created',run_id,generation,kst_date,cutoff_at,reminder_gate_set_version,reminder_gate_set_hash,snapshot_count}
     | {status:'already_exists',run_id,generation}
     | {status:'too_early'}
     | {status:'overflow',run_id,generation,snapshot_count}
  public.claim_lightweight_external_alert_reminder_items_v1(p_run_id uuid,p_generation bigint,p_limit integer default 25)
    -> {status:'claimed',claim_token,lease_expires_at,items:[{run_item_id,ordinal,delivery_id,source_revision,responsible_profile_ids,room_key,scheduled_at}]}
     | {status:'empty'} | {status:'stale_generation'}
  public.complete_lightweight_external_alert_reminder_claim_v1(p_run_id uuid,p_generation bigint,p_claim_token uuid,p_delivery_ids uuid[])
    -> {status:'recorded',remaining_count} | {status:'stale_claim'}
  public.finalize_lightweight_external_alert_reminder_run_v1(p_run_id uuid,p_generation bigint)
    -> {status:'completed',counts:{snapshot,claimed,accepted,unknown,failed_hold,mention_unresolved}}
     | {status:'incomplete',remaining_count} | {status:'stale_generation'}
  public.resume_lightweight_external_alert_reminder_run_v1(p_run_id uuid,p_expected_generation bigint,p_request_id uuid)
    -> {status:'resumed',generation} | {status:'not_resumable'} | {status:'stale'}
  ```

  같은 reminder migration이 human admin read boundary도 소유한다.

  ```sql
  public.list_recent_lightweight_external_alert_runs_v1(
    p_cursor_started_at timestamptz default null,
    p_cursor_run_id uuid default null,
    p_limit integer default 30
  )
  ```

  run list는 `started_at desc,run_id desc` keyset과 server 31/read 30을 사용하고 PII 없이 status/cutoff/counts/overflow/error code만 반환한다. PUBLIC/anon execute를 revoke하고 authenticated caller의 `auth.uid()` active-admin을 함수 첫 줄에서 재검증한다.

  create RPC는 caller가 한 gate version을 제출하지 않는다. singleton runtime-state row와 reminder에 실제 적용되는 다음 다섯 gate rows를 이 순서로 `FOR UPDATE` 잠근다: `(level_test,same_day_reminder,customer_alimtalk)`, `(visit_consultation,same_day_reminder,customer_alimtalk)`, `(visit_consultation,same_day_reminder,google_chat)`, `(observation_class,same_day_reminder,customer_alimtalk)`, `(observation_class,same_day_reminder,google_chat)`. booking rows나 존재하지 않는 level-test Chat row는 snapshot에 넣지 않는다. 이 exact five-row canonical sorted JSON의 `gate_set_version`/SHA-256을 계산해 ledger에 immutable snapshot하고, singleton에는 full ten-row booking+reminder matrix hash/version과 reminder five-row hash/version을 별도 필드로 소유한다. stored reminder hash와 계산 hash가 다르면 zero-write/fail-closed한다. 그 same transaction에서 DB `statement_timestamp()`로 KST run date와 그 날짜의 exact `10:00:00 Asia/Seoul` cutoff를 정한다. cutoff 전이면 `too_early`와 zero-write다. eligibility는 각 snapped gate와 latest booking fact의 `confirmed_at >= gate.eligibility_cutoff_at` 및 `< daily cutoff`로 strict하게 비교한다. 세 source/channel matrix를 먼저 expand해 exact delivery-unit count를 구하고 500 초과면 delivery/state/run-item을 만들지 않고 run ledger만 `overflow`로 끝낸다. 500 이하이면 delivery unit별 immutable run item `(run_id,ordinal,delivery_id,source_revision,responsible_profile_ids,room_key,scheduled_at,gate_row_version)`을 한 transaction에 만들고 expected count/generation을 고정한다. claim은 pending 또는 만료 lease item만 `FOR UPDATE SKIP LOCKED`로 가져오며 token/lease를 원자 기록한다. complete는 claim token 소유 item과 실제 terminal delivery ID exact set만 완료한다. finalize는 ledger counts를 DB에서 다시 계산하며 incomplete를 성공으로 바꾸지 않는다. resume은 같은 immutable snapshot만 새 generation으로 열고 새 candidate를 추가하지 않는다. create/claim/complete/finalize는 service role only; human resume은 authenticated JWT + `auth.uid()` active-admin check다. pgTAP은 exact five-row cardinality/order, booking-row exclusion, gate row 중간 변경/hashed-set mismatch, stale generation/token, expired lease reclaim, crash-resume, overflow zero-delivery, replay를 검증한다.

- [ ] **Step 3: 한 invocation dispatcher를 구현한다**

  route는 create RPC 뒤 run ledger의 immutable snapshot을 최대 25개씩 claim하여 최대 20 page까지 drain한다. 각 page dispatch 뒤 exact delivery IDs로 complete RPC를 호출하고 마지막에 finalize RPC를 호출한다. 다음 page나 unexpired claim이 남으면 성공으로 기록하지 않고 ledger를 `incomplete`로 유지하며 재개 가능한 generation/counts를 남긴다. candidate를 provider/channel별로 순차 또는 concurrency 2 이하로 처리한다. 각 delivery failure를 독립 결과로 기록하고 전체 batch를 rollback하지 않는다. route crash는 snapshot을 재생성하지 않으며 expired item lease 또는 audited resume RPC로 같은 run만 계속한다.

- [ ] **Step 4: 7-day exact cleanup을 같은 run 끝에 구현한다**

  snapshot drain과 delivery finalize가 끝난 뒤 cleanup을 `finally`의 마지막 단계에서 실행한다. 이 시스템의 terminalized receipt, run items, exact `tips-lightweight-registration-reminder-v1` job ID의 7일 초과 run ledger/detail과 terminal source의 30일 초과 booking-fact revisions만 bounded batch로 정리한다. state는 지우지 않고 다른 cron name/ID를 pattern delete하지 않는다.

- [ ] **Step 5: schedule manager를 passive로 구현한다**

  human mutation public RPC는 `configure_lightweight_external_alert_reminder_transport_v1(p_request_id,p_worker_url,p_bearer_secret,p_expected_version)`, `inspect_lightweight_external_alert_reminder_schedule_v1()`, `manage_lightweight_external_alert_reminder_schedule_v1(p_action,p_request_id,p_expected_version)`로 고정한다. configure/manage는 authenticated JWT의 `auth.uid()`가 active admin인지 재검증하고, singleton runtime state의 durable `transport_version` CAS를 사용한다. configure 성공은 URL host/header contract와 secret presence만 canonicalize한 PII-free `transport_fingerprint`를 계산하고 version+1과 함께 current state에 저장한다. request ledger가 CAS owner가 되어서는 안 된다. audit timestamp는 DB `statement_timestamp()`다. configure는 Vault의 `lightweight_external_alert_reminder_url`과 `lightweight_external_alert_reminder_bearer_secret`을 create-or-rotate하며 secret을 fingerprint/result/request ledger에 저장하지 않는다. actions는 `install_inactive | activate | disable | remove`다. exact schedule은 `0 1 * * *`, command는 private invocation function 하나다. Vault 값 둘 중 하나라도 없거나 HTTPS/approved production host/header contract가 다르면 readiness false다. invocation은 `net.http_post` 한 번과 exact bearer header만 사용한다. migration은 RPC만 설치하고 job/Vault value를 만들거나 활성화하지 않는다. script CLI는 `inspect | configure | install_inactive | activate | disable | remove`; mutation은 env `SUPABASE_USER_ACCESS_TOKEN`, `LIGHTWEIGHT_ALERT_EXPECTED_VERSION`과 `--execute --authorized --request-id "$TASK_REQUEST_ID" --expected-version "$LIGHTWEIGHT_ALERT_EXPECTED_VERSION"`을 요구하고 configure만 URL/secret env도 요구한다. arbitrary actor UUID를 받지 않고 user token/secret을 argv/stdout에 금지한다. run ledger는 run ID, KST date, exact cutoff, reminder gate-set version/hash, started/finished, snapshot/claimed/accepted/unknown/failed/mention-unresolved counts, overflow/error code만 7일 보관한다.

- [ ] **Step 6: GREEN과 커밋을 실행한다**

  Run: `"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/lightweight_external_alert_reminders_test.sql`

  Commit: `feat: add one daily registration reminder run`

---

### Task 7: 요청 시에만 여는 최근 외부 발송 이력

**Files:**
- Create via CLI: generated `lightweight_external_alert_operations` migration
- Create: `supabase/tests/lightweight_external_alert_operations_test.sql`
- Create: `src/features/notifications/external-delivery-history-service.ts`
- Create: `src/features/notifications/external-delivery-history.tsx`
- Create: `src/app/admin/settings/notifications/external-deliveries/page.tsx`
- Create: `src/app/api/admin/notifications/external-deliveries/route.ts`
- Create: `src/app/api/admin/notifications/external-deliveries/recovery/route.ts`
- Create: `tests/notification-lightweight-history.test.mjs`
- Modify: `src/lib/navigation.ts`

- [ ] **Step 1: operations migration과 no-poll/no-PII RED 테스트를 작성한다**

  먼저 `"$TASK_SUPABASE" migration new lightweight_external_alert_operations`를 실행하고 exact path를 공용 manifest에 `draft`/null hash로 기록한다. SQL+RED test 뒤 DB test 직전에 current SHA-256의 `candidate`, pgTAP GREEN 뒤 commit 직전에 동일 hash의 `final`로 승격한다. 이 migration이 Task 2 storage를 참조해 reconciliation, recovery-generation, attestation RPC를 설치하는 유일한 owner다. recent-run list RPC는 run ledger가 생기는 Task 6 reminder migration이 소유한다. `supabase/tests/lightweight_external_alert_operations_test.sql`은 signatures/ACL/admin actor/CAS/DB timestamps/channel isolation/PII를 검증한다. `GET /api/admin/notifications/external-deliveries?limit=30&cursor=<opaque>`는 admin session만 허용한다. response는 delivery page와 최근 7일 `run_ledger`의 `incomplete|overflow|error` rows 최대 30건을 별도 `runAlerts` array로 반환한다. snapshot 500 초과로 delivery 0건이어도 overflow run이 보이고 route-level failure도 error code/counts와 함께 보여야 한다. 첫 mount 때 한 번, 다음 cursor button, badge/unread/timer 0, manual refresh만 허용한다. staff/teacher/assistant/anon은 403/401이고 두 array 모두 DTO denylist를 다시 적용한다.

- [ ] **Step 2: service와 UI를 구현한다**

  `accepted`, `unknown`, `failed_hold`, `mention_unresolved`, time/channel/source kind만 표시한다. accepted resend 없음. unknown은 provider dashboard/reference를 독립 확인한 뒤 아래 reconciliation RPC로 accepted 또는 definitely-not-accepted hold만 기록한다. failed_hold의 재발송은 아래 recovery-generation RPC로 새 generation을 만들며 admin request UUID, reason, prior result를 audit한다. 두 RPC는 expected attempt/state generation CAS, authenticated `auth.uid()` active-admin 재검증, DB timestamp, PII-free reason allowlist를 강제한다. PUBLIC/anon execute를 revoke하고 authenticated execute는 internal admin check와 함께만 허용한다. server route/CLI는 user JWT를 사용하고 arbitrary actor UUID를 받지 않는다.

  ```sql
  public.reconcile_lightweight_external_alert_unknown_v1(p_delivery_id uuid,p_expected_attempt_number integer,p_resolution text,p_provider_reference text,p_request_id uuid)
    -> {status:'reconciled',result:'accepted'|'failed_hold'} | {status:'stale'}
  public.create_lightweight_external_alert_recovery_generation_v1(p_delivery_id uuid,p_expected_state_generation bigint,p_reason_code text,p_request_id uuid)
    -> {status:'created',delivery_id,generation} | {status:'not_eligible'} | {status:'stale'}
  ```

  recovery는 채널별 독립이며 다른 customer/Chat state를 바꾸지 않는다. booking recovery generation은 exact dispatcher를 직접 호출한다. reminder recovery는 event key가 현재 KST date이고 current source revision/date/routing snapshot이 delivery와 모두 같은 경우에만 recovery route가 shared `dispatchExactDelivery()`를 직접 호출하며 immediate webhook route나 old run snapshot을 사용하지 않는다.

  admin server가 user JWT로 호출하는 `public.record_lightweight_external_alert_receipt_attestation_v1(p_request_id,p_source_kind,p_event_kind,p_channel,p_provider_requested,p_received,p_provider_evidence_reference)`는 exact matrix, `auth.uid()` active admin, safe reference length/charset를 검증하고 `verified_at`은 DB `statement_timestamp()`로 만들어 30일 보관한다. caller actor/timestamp를 받지 않는다. 이 수동 attestation이 없으면 received 기본값은 false이며 source/DB/provider result로 추론하지 않는다.

- [ ] **Step 3: admin-only navigation을 연결한다**

  기존 notification control panel과 분리하고 settings 메뉴를 열기 전 query가 없어야 한다.

- [ ] **Step 4: recovery RED/GREEN을 검증한다**

  accepted/unknown 자동 resend 0, unknown reconcile 전 generation 생성 거부, failed_hold는 audited admin approval 후 generation +1, stale expected attempt/generation 거부, admin actor 위조 거부, DB-generated audit time, 다른 channel 불변을 검증한다. reminder recovery는 같은 KST date와 exact source revision/routing snapshot만 provider call 1이고 지난 날짜/변경된 일정/담당 변경은 0이다. delivery 0인 overflow/error ledger도 UI에서 보여야 한다.

- [ ] **Step 5: GREEN과 커밋을 실행한다**

  Run: `"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/lightweight_external_alert_operations_test.sql`

  Commit: `feat: show recent external delivery receipts on demand`

---

### Task 8: cutover fence를 provider-off 상태로 준비

**Files:**
- Create via CLI: generated `lightweight_external_alert_cutover_fences` migration
- Modify: `src/app/api/registration/consultation-notification/route.ts`
- Modify: `src/app/api/solapi/registration/send/route.ts`
- Modify: `src/app/api/solapi/registration/route.ts`
- Modify: `src/features/tasks/server/registration-customer-message-route.ts`
- Modify: `src/features/tasks/registration-appointment-editor.tsx`
- Modify: `src/features/tasks/registration-observation-editor.tsx`
- Create: `tests/notification-lightweight-cutover.test.mjs`
- Create: `src/app/api/admin/notifications/external-gates/route.ts`
- Create: `scripts/manage-lightweight-external-alert-gates.mjs`
- Modify: `src/features/notifications/registration-customer-reminder-service.ts`
- Modify: `src/features/notifications/registration-customer-reminder-settings.tsx`
- Modify: `src/features/tasks/server/registration-customer-reminder-route.ts`
- Modify: `src/features/tasks/server/registration-customer-reminder-worker.ts`

- [ ] **Step 1: simultaneous-send RED 테스트를 작성한다**

  먼저 `"$TASK_SUPABASE" migration new lightweight_external_alert_cutover_fences`를 실행하고 exact path를 공용 manifest에 `draft`/null hash로 기록한다. SQL+RED test 뒤 DB test 직전에 current SHA-256의 `candidate`, pgTAP GREEN 뒤 commit 직전에 동일 hash의 `final`로 승격한다. new gate가 off면 legacy manual path 유지한다. verification은 exact allowlisted synthetic source만, live는 booking fact가 eligibility cutoff 이후인 source만 해당 external legacy channel을 차단한다. 다른 real source와 cutoff 이전 source는 아직 legacy path를 유지한다. 해당 source에서는 legacy manual begin/route, old settings enable, sync/claim/read/begin/release/finalize RPC가 모두 fail-closed해야 한다. stale browser와 이미 열린 old worker invocation도 provider를 부르지 못해야 한다.

- [ ] **Step 2: channel별 cutover fence를 구현한다**

  DB/runtime 읽기 함수는 source ID/event/channel을 받아 verification allowlist 또는 live cutoff eligibility까지 판정한다. UI는 현재 source에 fence가 적용될 때만 booking/reminder manual external button과 old reminder settings를 숨기고 settings mutation도 서버에서 거부한다. 방문상담 `/api/registration/consultation-notification`의 기존 in-app branch는 conditional removal 전까지 유지하고 Google Chat branch만 fence한다. observation heavy control-plane booking/reminder rules는 new gate와 동시에 켤 수 없게 DB constraint/RPC preflight를 둔다. 새 gate activation은 old setting `enabled=false`, old jobs pending/claimed 0, old schedule inactive를 transaction 안에서 확인한다.

- [ ] **Step 3: legacy cron preflight를 구현한다**

  activation은 exact old jobs `tips-notification-worker-v1`, `tips-notification-cutover-watchdog-v1`, `tips-registration-customer-reminder-v1`의 active count가 0일 때만 허용한다. forward-replace한 `public.manage_notification_worker_schedule_v1(text,uuid)`, `public.manage_registration_customer_reminder_schedule_v1(text)`, `public.save_notification_control_plane_v1(text,jsonb,jsonb,uuid)`의 relevant rule mutation, 새 daily manager `activate`, old reminder settings enable은 매 호출마다 같은 bidirectional readiness function을 실행한다. 즉 gate 활성화 후 old install/activate/rule-enable도 거부된다. 이 migration은 그 job들을 활성화/삭제하지 않는다.

- [ ] **Step 4: bidirectional fence pgTAP과 route 회귀를 실행한다**

  old-to-new와 new-to-old 동시 activation 모두 거부되고, 이미 claim된 old reminder가 new activation 뒤 `begin_registration_customer_reminder_dispatch_v1`에서 중지되는지 검증한다. 기존 `get/set/sync/claim/read/begin/release/finalize/manage/invoke` RPC의 exact fence를 source contract로 검사한다.

  Run: `"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/lightweight_external_alert_cutover_test.sql`

- [ ] **Step 5: admin gate route와 passive CLI를 구현한다**

  `POST /api/admin/notifications/external-gates`는 admin session, expected version, exact matrix row/action/scope/expiry/reason/request UUID를 검증하고 signed-in user JWT client로 management RPC를 호출한다. caller cutoff는 받거나 전달하지 않으며 activation/eligibility cutoff는 RPC의 DB `statement_timestamp()` 결과만 응답·audit에 사용한다. RPC가 `auth.uid()` active admin을 다시 검증하고 audit time도 DB에서 만든다. `scripts/manage-lightweight-external-alert-gates.mjs` actions는 `inspect | verification | live | off`이며 mutation은 `--execute --authorized --request-id "$TASK_REQUEST_ID" --expected-version "$LIGHTWEIGHT_ALERT_EXPECTED_VERSION"`과 env `SUPABASE_USER_ACCESS_TOKEN`, `LIGHTWEIGHT_ALERT_EXPECTED_VERSION`을 모두 요구한다. arbitrary actor UUID를 받지 않는다. 기본은 plan/inspect이고 provider/cron 호출은 하지 않는다.

- [ ] **Step 6: provider-zero cutover GREEN과 커밋을 실행한다**

  Commit: `fix: fence legacy registration notification sends`

---

### Task 9: source 전체 검증 후 passive 완료 선언

**Files:**
- Create: `scripts/verify-lightweight-external-alert-provider-zero.mjs`
- Modify: `package.json`

- [ ] **Step 1: focused test matrix를 실행한다**

  ```bash
  "$TASK_NODE" --test --experimental-strip-types \
    tests/notification-lightweight-*.test.mjs \
    tests/registration-observation-booking.test.mjs \
    tests/registration-customer-message-catalog.test.mjs \
    tests/registration-customer-message-source.test.mjs \
    tests/registration-customer-message-solapi.test.mjs \
    tests/registration-customer-message-route.test.mjs \
    tests/registration-consultation-notification.test.mjs \
    tests/registration-customer-reminder-route.test.mjs \
    tests/registration-customer-reminder-worker.test.mjs \
    tests/registration-customer-reminder-scheduler.test.mjs \
    tests/registration-customer-reminder-settings.test.mjs \
    tests/registration-observation-customer-message-route.test.mjs \
    tests/registration-observation-customer-reminder-worker.test.mjs \
    tests/registration-observation-google-chat-db.test.mjs \
    tests/registration-observation-google-chat-provider-zero.test.mjs \
    tests/registration-observation-google-chat-provider-zero-runner.test.mjs \
    tests/notification-worker-production-schedule.test.mjs \
    tests/dashboard-google-chat-profile-mentions-provider-zero.test.mjs \
    tests/notification-google-chat-content.test.mjs
  ```

- [ ] **Step 2: isolated local DB/provider-zero를 실행한다**

  Run:

  ```bash
  "$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs \
    --execute --authorized --request-id "$TASK_REQUEST_ID" \
    --test supabase/tests/lightweight_external_alert_storage_test.sql \
    --test supabase/tests/lightweight_external_alert_producers_test.sql \
    --test supabase/tests/lightweight_external_alert_reminders_test.sql \
    --test supabase/tests/lightweight_external_alert_operations_test.sql \
    --test supabase/tests/lightweight_external_alert_cutover_test.sql
  ```

  harness가 새 migrations를 temp DB에 apply한 뒤 pgTAP을 실행하고 exact temp project를 finally teardown해야 한다. HTTP adapter fake count가 0인 passive gate와 exact synthetic dispatch를 모두 검증한다.

- [ ] **Step 3: 전체 정적 검증을 실행한다**

  ```bash
  "$TASK_PNPM" eslint src tests middleware.ts next.config.ts
  "$TASK_PNPM" exec tsc --noEmit --pretty false
  "$TASK_PNPM" build
  git diff --check
  git status --short
  ```

- [ ] **Step 4: passive source 완료를 커밋하고 멈춘다**

  Commit: `test: verify passive lightweight alerts`

  이 시점에는 운영 DB, Database Webhook, cron, provider request가 모두 미변경이어야 한다.

## Separately Authorized Runtime Gates

아래는 한 번에 하나씩 승인·실행·증거 확인한다.

1. 운영 migration 5개 적용, 모든 gate `off`, active legacy jobs 0 확인
2. 최신 `main` push와 Vercel Production `READY`
3. Database Webhook secret/route 설치, provider-off delivery 0 확인
4. SOLAPI 다섯 기존 message-kind template 승인/ID/drift preflight
5. Chat management/subject connection과 director/teacher identity preflight
6. synthetic verification scope에서 source-kind/channel 하나씩 gate 활성화
7. booking provider request와 실제 고객/Chat 수신
8. 오전 10시 route 수동 dry-run, date boundary/zero-duplicate 확인
9. exact daily job `install_inactive`, 별도 승인 후 `activate`
10. 첫 자동 10:00 provider request와 실제 수신 확인
11. 모든 신규 경로 안정화 뒤 legacy inbox/web-push removal 승인

각 runtime 전환 요청은 `request_id`, 요청자, exact gate before/after, synthetic scope 또는 live cutoff, readiness 결과를 management ledger에 남긴다. provider request 증거는 Vercel/request ledger, 실제 수신 증거는 cryptographic signature가 아닌 개인정보 제거 수동 attestation(`verifiedBy`, `verifiedAt`, `sourceKind`, `channel`, `eventKind`, `received=true|false`, safe evidence reference)으로 별도 입력한다. 입력이 없으면 기본값은 `received=false`이며 source/DB 성공으로 추론하지 않는다.

## Conditional Legacy Removal Phase

종류·채널별 실제 수신과 최소 한 번의 10:00 run이 확인되기 전에는 시작하지 않는다.

- `src/components/site-header.tsx`의 `DashboardNotificationPopover` 제거
- `src/components/dashboard-notification-popover.tsx` 제거
- `src/lib/dashboard-inbox-state.ts`, `src/lib/dashboard-push-client.ts` 제거
- push subscription/web-push/push-readiness routes 제거
- `web-push`, `@types/web-push` dependency 제거
- approval/makeup/task workspace의 `NotificationControlPanel` import 제거 또는 external history link로 축소
- old queue/fanout/reconciliation/heartbeat 쓰기 0을 관찰
- old table/function/index drop은 다시 별도 destructive migration 승인
