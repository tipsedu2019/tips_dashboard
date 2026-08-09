# Registration Observation Google Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 청강 예약·변경·취소, 시작 3시간 전 준비, 종료 30분 후 피드백 요청, 피드백 제출을 정확한 과목방·원장방·원장 inbox에 한 번씩 전달하되 예약 저장과 provider를 분리하고 source drift·중복·개인정보·과거 backlog를 fail closed한다.

**Architecture:** core 청강 도메인이 같은 transaction에서 INSERT하는 `dashboard_private.registration_observation_domain_events`만 stable producer seam으로 소비한다. Google Chat migration은 core booking/lifecycle RPC를 재정의하지 않고 outbox의 `AFTER INSERT` trigger로 provider-neutral Chat job만 원자 생성·취소한다. 기존 notification worker가 due job을 claim하고 canonical source를 두 번 재검증한 뒤 기존 notification control plane event/fanout/delivery에 넘긴다. observation delivery는 layout verifier가 보호하는 generic claim/prepare/revalidate RPC를 byte-identical로 보존하고, claim-token으로 잠그는 observation 전용 frozen-state read RPC와 channel-aware final-prepare RPC만 사용한다. final-prepare는 공통 source/rule/frozen-render를 재검증한 뒤 Google Chat은 canonical connection만 검증해 기존 `begin_notification_delivery_send_v1`로 provider ownership을 얻고, in-app만 current director eligibility를 검증해 기존 `commit_notification_in_app_delivery_v1`로 원자 완료한다. Google Chat rule은 전부 OFF로 Gate B의 runtime-0 migration/code bundle에 포함하고, 기존 customer/SOLAPI queue·worker·template·cron과 별도로 한 family씩 실제 receipt를 확인한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase Postgres/PostgREST/RLS/pgTAP, existing notification control plane worker, Google Chat cards/webhooks, Node test runner, ESLint, Vercel

## Global Constraints

- 제품 계약의 권위는 `docs/superpowers/specs/2026-08-09-registration-observation-workflow-design.md`다. 이 계획이 설계를 바꾸지 않는다.
- 선행 구현은 `docs/superpowers/plans/2026-08-09-registration-observation-core.md`와 `docs/superpowers/plans/2026-08-09-registration-observation-feedback-enrollment.md`다. 특히 core outbox, observation/appointment 상태 매핑, 담당 교사 feedback route가 먼저 존재해야 한다.
- 이 계획은 `enter_registration_observation_v1`, `list_registration_observation_sessions_v1`, `save_registration_observation_booking_v1`, `cancel_registration_observation_v1`, `withdraw_registration_observation_v1`, 참석·피드백·결정 RPC 또는 그 private impl을 `CREATE OR REPLACE`하지 않는다. 신규와 기존 예약 변경은 모두 core `save_registration_observation_booking_v1`가 소유한다.
- core mutation은 domain event INSERT까지만 소유한다. Google Chat trigger는 같은 transaction에서 내부 job intent만 만들며 webhook, `net.http`, `fetch`, provider attempt를 실행하지 않는다.
- 고객/SOLAPI 경계는 완전히 별도다. `registration_customer_reminder_jobs`, `ops_registration_customer_messages`, customer-message template/receipt/activation, SOLAPI worker/API/cron과 관련 source를 이 계획에서 수정하거나 호출하지 않는다.
- output event key는 정확히 여섯 개다: `registration.observation_scheduled`, `registration.observation_rescheduled`, `registration.observation_canceled`, `registration.observation_reminder_due`, `registration.observation_feedback_due`, `registration.observation_feedback_submitted`.
- `observation_attendance_recorded`는 고객 reminder와 내부 `observation_reminder_due`를 취소하고 `observation_feedback_due`는 유지한다. `observation_no_show`와 `observation_feedback_submitted`는 남은 내부 due를 모두 취소한다.
- 예약·변경·취소·due identity는 `observation_id + appointment.notification_revision + output event key`다. observation `revision`과 `feedback_revision`은 notification identity가 아니다.
- 시작 3시간 전과 종료 30분 후는 고정 운영값이다. settings UI, browser payload, environment variable로 변경하지 않는다. 시작까지 3시간 미만이면 reminder job을 만들지 않고 즉시 대체 발송도 하지 않는다.
- 예약 핵심 drift는 class, subject, session authority/ID/key, session `schedule_state`, date/start/end, teacher, classroom, campus의 `booking_fact_hash`로 판단한다. 교재·진도·메모·workflow 상태는 hash에 넣지 않는다.
- claim, materialization, provider 직전은 각각 현재 appointment `notification_revision`, observation/appointment lifecycle, tagged `source_revision`, `booking_fact_hash`를 다시 읽는다. 승인 설계 §6.1의 저장/현재 분리(`docs/superpowers/specs/2026-08-09-registration-observation-workflow-design.md:282`)대로 source revision만 바뀌고 booking hash가 같을 때 scheduled/rescheduled는 job에 저장된 immutable `preparation_snapshot`을 유지하고, reminder_due만 동일 회차의 최신 교재·진도를 다시 resolve한다. booking hash가 다르면 `source_dirty`, provider attempt 0이다.
- `source_dirty`, `canceled`, `suppressed`, `failed`, `materialized`는 terminal이다. 자동으로 pending으로 되돌리지 않는다. observation Production Google Chat은 기존 production classifier를 그대로 쓴다. HTTP 429는 `retry_wait/provider_rate_limited`, HTTP 425는 `retry_wait/transient_pre_dispatch_failure`로 provider 미수락이 확정된 경우에만 자동 retry한다. Production worker는 항상 `http408Disposition:'delivery_unknown'`을 명시하므로 HTTP 408은 `delivery_unknown/provider_ambiguous_response`, timeout/reset/5xx도 `delivery_unknown` terminal이며 두 번째 provider call이 없다. option 없는 legacy 408 retry 기본값은 보존하지만 observation Production 계약으로 사용하지 않는다. retry부터는 첫 attempt 전에 저장한 render fingerprint/title/body/href를 동결하고 현재 eligibility만 read-only로 다시 확인한다.
- 신규 rule 7개는 모두 `enabled=false`, `delivery_mode='immediate'`, `rule_variant_key='immediate'`로 seed한다. due 시각은 rule scheduler가 아니라 전용 job이 소유한다. 기존 runtime flag, 기존 rule enabled 값, 기존 schedule을 변경하지 않는다.
- scheduled/rescheduled/canceled/reminder_due/feedback_due Google Chat은 canonical track subject에서 `google_chat.english | google_chat.math | google_chat.science`를 결정한다. feedback_submitted Google Chat은 `google_chat.executive`, paired in-app은 current track director 한 명이다.
- feedback 결과(`fit|unfit`)와 사유, 전화번호, 학교, 문의 메모, sibling track, 내부 UUID는 카드 본문에 넣지 않는다. 인증된 Dashboard button target의 observation UUID만 예외다.
- 모든 DB assertion은 새 migration까지 clean apply한 뒤 `scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus google-chat` focused pgTAP으로 검증한다.
- 기존 migration은 수정하지 않는다. Google Chat DB 변경은 core plan이 예약한 단일 forward migration `20260809105000_registration_observation_google_chat.sql` 안에서 완결하며, `105000`은 frozen common runner의 hard ceiling이다. 이 계획은 두 번째 migration이나 `105000`보다 늦은 파일을 만들지 않는다. 파일은 pinned supabase-go CLI `2.103.0`의 `supabase migration new registration_observation_google_chat`로 먼저 만든 뒤 생성 파일이 정확히 하나이고 frozen target이 비어 있음을 확인해 reviewed `git mv`한다. target collision, 둘 이상의 generated file, 최종 빈 파일, generated orphan은 즉시 중단한다.
- `scripts/verify-supabase-migration-layout.mjs`가 보호하는 `claim_notification_deliveries_v1`, `prepare_notification_immediate_delivery_v1`, `revalidate_immediate_notification_delivery_v1`는 migration에서 호출·교체·주석 참조하지 않는다. observation 전용 claim-token frozen-state read/final-prepare만 추가하고 기존 generic behavior/hash를 보존한다. worker는 generic claim DTO에 없는 expiry/frozen render 값을 추측하거나 delivery table에서 직접 읽지 않는다.
- 신규 private job table은 RLS를 켜고 `PUBLIC, anon, authenticated, service_role`의 직접 table privilege를 모두 revoke한다. 신규 `SECURITY DEFINER` public RPC는 `set search_path=''`, 함수 내부 exact caller-role check, exact-signature PUBLIC/role revoke, 필요한 역할에만 최소 grant를 갖는다. private helper와 outbox trigger는 가능한 한 `SECURITY INVOKER`로 두며 모든 relation을 schema-qualified한다.
- provider-zero, Git SHA, Supabase migration, Vercel Production `READY`, rule activation, Google Chat provider receipt, 실제 채팅방 수신은 서로 다른 증거로 기록한다.

## Frozen Dependency Interface

```sql
dashboard_private.registration_observation_domain_events(
  event_id uuid primary key,
  observation_id uuid not null,
  appointment_id uuid not null,
  notification_revision integer not null,
  event_kind text not null check (event_kind in (
    'observation_scheduled',
    'observation_rescheduled',
    'observation_canceled',
    'observation_attendance_recorded',
    'observation_no_show',
    'observation_feedback_submitted'
  )),
  booking_fact_hash text not null,
  source_revision jsonb not null,
  occurred_at timestamptz not null,
  unique (observation_id, notification_revision, event_kind)
)
```

`source_revision`은 다음 exact tagged union이다.

```ts
export type RegistrationObservationSessionSourceRevision =
  | Readonly<{
      authority: "normalized"
      sessionId: string
      revision: number
    }>
  | Readonly<{
      authority: "legacy"
      sessionKey: string
      contentHash: string
    }>
```

Google Chat consumer mapping은 다음처럼 닫는다.

```ts
export const OBSERVATION_CHAT_DOMAIN_ACTION = Object.freeze({
  observation_scheduled: Object.freeze({
    immediate: "registration.observation_scheduled",
    createDue: Object.freeze([
      "registration.observation_reminder_due",
      "registration.observation_feedback_due",
    ]),
    cancelDue: Object.freeze([]),
  }),
  observation_rescheduled: Object.freeze({
    immediate: "registration.observation_rescheduled",
    createDue: Object.freeze([
      "registration.observation_reminder_due",
      "registration.observation_feedback_due",
    ]),
    cancelDue: Object.freeze([
      "registration.observation_reminder_due",
      "registration.observation_feedback_due",
    ]),
  }),
  observation_canceled: Object.freeze({
    immediate: "registration.observation_canceled",
    createDue: Object.freeze([]),
    cancelDue: Object.freeze([
      "registration.observation_reminder_due",
      "registration.observation_feedback_due",
    ]),
  }),
  observation_attendance_recorded: Object.freeze({
    immediate: null,
    createDue: Object.freeze([]),
    cancelDue: Object.freeze(["registration.observation_reminder_due"]),
  }),
  observation_no_show: Object.freeze({
    immediate: null,
    createDue: Object.freeze([]),
    cancelDue: Object.freeze([
      "registration.observation_reminder_due",
      "registration.observation_feedback_due",
    ]),
  }),
  observation_feedback_submitted: Object.freeze({
    immediate: "registration.observation_feedback_submitted",
    createDue: Object.freeze([]),
    cancelDue: Object.freeze([
      "registration.observation_reminder_due",
      "registration.observation_feedback_due",
    ]),
  }),
} as const)
```

## Exact Source and Payload Contract

DB source RPC는 service-role 전용이다.

```sql
public.get_registration_observation_notification_source_v1(
  p_observation_id uuid
) returns jsonb
```

반환 top-level key set은 정확히 다음과 같다.

```ts
export type RegistrationObservationNotificationSource = Readonly<{
  observationId: string
  appointmentId: string
  taskId: string
  trackId: string
  notificationRevision: number
  observationStatus: "scheduled" | "attended_feedback_pending" | "completed" | "no_show" | "canceled"
  appointmentStatus: "scheduled" | "completed" | "canceled"
  hasFeedback: boolean
  studentName: string
  subject: "영어" | "수학" | "과학"
  classId: string
  className: string
  sessionAuthority: "normalized" | "legacy"
  classLessonSessionId: string | null
  legacySessionKey: string | null
  scheduleState: "active" | "makeup"
  startsAt: string
  endsAt: string
  teacherCatalogId: string
  teacherName: string
  classroomCatalogId: string
  classroomName: string
  campus: "본관" | "별관"
  sourceRevision: RegistrationObservationSessionSourceRevision
  bookingFactHash: string
  directorProfileId: string | null
}>
```

`hasFeedback`는 발송 eligibility용 boolean일 뿐 결과·사유를 반환하지 않는다. RPC와 TypeScript source reader는 parent/student phone, school, inquiry, suitability, feedback reason, sibling track, 전체 `schedule_plan`을 반환하지 않는다.

payload schema version은 `3`이며 event별 exact union을 사용한다.

```ts
type ObservationBookingPresentationFact = Readonly<{
  class_id: string
  class_name: string
  session_authority: "normalized" | "legacy"
  class_lesson_session_id: string | null
  legacy_session_key: string | null
  schedule_state: "active" | "makeup"
  starts_at: string
  ends_at: string
  teacher_name: string
  classroom_name: string
  campus: "본관" | "별관"
}>

type ObservationChatPayloadBase = Readonly<{
  task_id: string
  track_id: string
  observation_id: string
  appointment_id: string
  appointment_notification_revision: number
  student_name: string
  subject: "영어" | "수학" | "과학"
  source_revision: RegistrationObservationSessionSourceRevision
  booking_fact_hash: string
  occurred_at: string
  delivery_expires_at: string
}>

export type RegistrationObservationChatPayloadV3 =
  | (ObservationChatPayloadBase & Readonly<{
      event_kind: "registration.observation_scheduled"
      booking: ObservationBookingPresentationFact
      textbook_names: ReadonlyArray<string>
      progress_summary: string
    }>)
  | (ObservationChatPayloadBase & Readonly<{
      event_kind: "registration.observation_rescheduled"
      previous_booking: ObservationBookingPresentationFact
      booking: ObservationBookingPresentationFact
      textbook_names: ReadonlyArray<string>
      progress_summary: string
    }>)
  | (ObservationChatPayloadBase & Readonly<{
      event_kind: "registration.observation_canceled"
      canceled_booking: ObservationBookingPresentationFact
    }>)
  | (ObservationChatPayloadBase & Readonly<{
      event_kind: "registration.observation_reminder_due"
      booking: ObservationBookingPresentationFact
      textbook_names: ReadonlyArray<string>
      progress_summary: string
    }>)
  | (ObservationChatPayloadBase & Readonly<{
      event_kind: "registration.observation_feedback_due"
      booking: ObservationBookingPresentationFact
    }>)
  | (ObservationChatPayloadBase & Readonly<{
      event_kind: "registration.observation_feedback_submitted"
      booking: ObservationBookingPresentationFact
      submitted_by_name: string
      submitted_at: string
    }>)
```

Job/NCP identity는 다음 문자열을 정확히 사용한다.

```sql
source_type := 'registration_observation';
source_id := observation_id::text;
notification_events.source_revision := notification_revision::bigint;
job_and_payload_source_revision := domain_event.source_revision;
occurrence_key := 'registration:observation:' || observation_id::text
  || ':notification_revision:' || notification_revision::text
  || ':event:' || event_key_suffix;
```

`event key suffix`는 `scheduled | rescheduled | canceled | reminder_due | feedback_due | feedback_submitted` 중 하나다. `dashboard_private.notification_events`의 기존 unique `(scope_key, workflow_key, source_type, source_id, event_key, occurrence_key)`와 Chat job의 unique `(observation_id, notification_revision, event_key)`가 중복을 이중 차단한다.

## Timing, Cutoff, and Backlog Contract

| Family | `due_at` | `delivery_expires_at` | Late behavior |
|---|---|---|---|
| scheduled/rescheduled/canceled | domain `occurred_at` | `occurred_at + 24 hours` | expired terminal `canceled/notification_window_closed` |
| reminder_due | `starts_at - interval '3 hours'` | `starts_at` | 시작 후 provider 0 |
| feedback_due | `ends_at + interval '30 minutes'` | `ends_at + interval '24 hours'` | expired terminal `canceled/notification_window_closed` |
| feedback_submitted | domain `occurred_at` | `occurred_at + 24 hours` | expired terminal `canceled/notification_window_closed` |

- rule disabled 시 job identity와 rule snapshot은 `suppressed/rule_disabled_at_source`로 보존하지만 claim 대상이 아니다.
- rule을 나중에 ON으로 바꿔도 기존 `suppressed`, `canceled`, `source_dirty`, `failed`, `materialized` job은 재개방하지 않는다.
- rule activation 시 generic rule reconciliation은 observation immediate rule의 과거 domain event를 backfill하지 않는다. 활성화 뒤 새 청강 action으로 만든 domain event만 provider 후보가 된다.
- rule이 ON인 동안 worker outage로 생긴 pending backlog만 위 delivery window 안에서 처리한다. window 밖이면 provider 0으로 terminal 처리한다.
- rollback은 observation rule만 OFF로 바꾸고 domain runtime, 기존 notification rules, existing schedule, customer/SOLAPI activation을 건드리지 않는다.
- Gate B의 audited `google_chat_installed_at`은 master plan이 소유하는 exact Gate B 순서에서 Google Chat migration/default-OFF code가 runtime `0`으로 설치된 시각이며 `0 → 1` runtime activation receipt보다 빠르다. 이 subordinate plan은 Gate B를 재정의하거나 재정렬하지 않고 master receipt만 소비한다. 각 rule의 별도 audited `activated_at`은 Gate B runtime `1`/Production READY 검증 뒤 v2 save가 성공한 시각이고, 실제 발송을 증명할 fresh domain event의 `occurred_at`은 반드시 그 rule `activated_at`보다 늦다.

## File Responsibility Map

| File | Responsibility |
|---|---|
| `supabase/migrations/20260809105000_registration_observation_google_chat.sql` | dependency gate, delivery status-reason CHECK forward extension, source RPC, Chat job/outbox trigger, UI registry/rule/template/content-contract seed, claim/reap/materialize/claim-token frozen-state read/first-attempt refresh/channel-aware observation final-prepare/readiness, heartbeat additive constraint, shared delivery/ownership least-privilege ACL |
| `supabase/tests/registration_observation_google_chat_test.sql` | actual trigger mapping, lifecycle cancellation, timing, concurrency, source drift, default-OFF, ACL, provider-zero pgTAP |
| `tests/registration-observation-google-chat-db.test.mjs` | migration signature/order/static provider-zero contract, protected generic-name absence and layout-verifier GREEN |
| `scripts/run-registration-observation-local-db-qa.mjs` | consume frozen `--focus google-chat` ceiling/test; no remote/provider capability |
| `tests/registration-observation-local-db-runner.test.mjs` | google-chat focus ceiling and exact pgTAP routing |
| `src/features/notifications/server/adapters/registration-observation-notification-source.ts` | strict source RPC parser, bounded selected-session content reads, exact progress priority, no sibling fallback |
| `src/features/notifications/server/adapters/registration-notification-adapter.ts` | observation target resolution, payload parsing, pre-send revalidation/refresh, exact deep links |
| `src/features/notifications/server/presentation/registration-notification-presentation.ts` | six event copy, destination matrix, privacy and exact schema validation |
| `src/features/notifications/server/notification-workflow-adapter.ts` | optional refreshed payload result for pre-send render refresh |
| `src/features/notifications/server/notification-worker.ts` | Chat job claim/materialization stage, observation frozen-state read on first/retry, first-attempt refresh, retry frozen-payload/render preflight, channel-aware observation final-prepare seam, provider workflow key, heartbeat count |
| `src/app/api/notifications/worker/route.ts` | additive worker count response; same authenticated route and schedule contract |
| `src/features/notifications/server/notification-app-deep-link.ts` | shared exact static/dynamic route/query allowlist and button label policy |
| `src/features/notifications/server/providers/google-chat-provider.ts` | shared app-link validator, observation button labels, unchanged webhook transport safety |
| `src/features/notifications/notification-control-plane-types.ts` | six registration event literals and destination types |
| `src/features/notifications/server/notification-workflow-registry.ts` | observation event adapter registration and no-backfill reconciliation boundary |
| `src/features/notifications/notification-google-chat-catalog.ts` | canonical subject/executive connection contract |
| `src/features/notifications/notification-content-contract-registry.ts` | payload v3 content contracts and privacy classes |
| `src/features/notifications/notification-content-manifest.ts` | seven rule identities and content coverage |
| `tests/notification-registration-observation.test.mjs` | exact source/payload/dedupe/routing/content/privacy tests |
| `tests/registration-notification-adapter.test.mjs` | source drift, target resolution, stored immediate/latest reminder preparation split, no backfill |
| `tests/notification-registration-presentation.test.mjs` | Korean copy and destination/privacy fail-closed tests |
| `tests/notification-control-plane-worker.test.mjs` | due stage, retry/expiry, refresh and heartbeat tests |
| `tests/notification-google-chat-content.test.mjs` | static/dynamic URL allowlist, observation buttons, no raw URL/UUID body |
| `tests/notification-workflow-registry.test.mjs` | registry and target connection coverage |
| `tests/notification-operations.test.mjs` | unchanged one-minute existing schedule and no second cron |
| `tests/notification-content-contract.test.mjs` | content key/token/privacy contract |
| `tests/notification-content-manifest.test.mjs` | DB/TS/fixture identity parity |
| `tests/fixtures/notification-content-contracts.json` | seven exact rule contracts |
| `tests/fixtures/notification-content-coverage-manifest.json` | observation destination/renderer/fixture coverage |
| `tests/fixtures/notification-content-golden.json` | deterministic Korean output and link metadata |
| `tests/registration-observation-google-chat-provider-zero.test.mjs` | full lifecycle with fetch/provider/external-attempt count zero |
| `scripts/run-registration-observation-google-chat-provider-zero.mjs` | 별도 isolated DB lifecycle/provider-zero harness; frozen common runner를 수정하지 않음 |
| `tests/registration-observation-google-chat-provider-zero-runner.test.mjs` | 별도 harness의 double gate, loopback/provider-env guard와 cleanup contract |
| `scripts/verify-word-retest-expected-at-concurrency.mjs` | shared delivery/ownership direct-DML 제거; unexpected canonical artifacts를 fail closed하고 disposable local reset을 요구하는 legacy QA |
| `tests/word-retest-expected-at.test.mjs` | legacy verifier가 shared delivery/ownership table을 직접 INSERT/UPDATE/DELETE하지 않음을 고정 |
| `package.json` | separate provider-zero harness verification command only |
| `docs/superpowers/reports/2026-08-09-registration-observation-google-chat-rollout.md` | code/DB/Vercel/rule/provider receipt/rollback evidence without secrets |

---

### Task 1: Build the Atomic Google Chat Job Contract

**Files:**
- Create: `supabase/migrations/20260809105000_registration_observation_google_chat.sql`
- Create: `supabase/tests/registration_observation_google_chat_test.sql`
- Create: `tests/registration-observation-google-chat-db.test.mjs`
- Modify: `scripts/verify-word-retest-expected-at-concurrency.mjs`
- Modify: `tests/word-retest-expected-at.test.mjs`

**Interfaces:**
- Consumes: core `registration_observation_domain_events`, observation/appointment/track/task/class/session/profile/catalog facts, notification control plane rule/event/job/delivery tables
- Produces: one internal Chat job ledger; atomic `AFTER INSERT` materializer; service-only source, claim, finish, reap, materialize, claim-token frozen-state read, first-attempt delivery-refresh, channel-aware observation final-prepare and readiness RPCs; seven disabled UI-registry/rule/template/content-contract identities
- Does not produce: webhook call, external attempt, customer message, SOLAPI job, cron job

- [ ] **Step 1: Write the Node migration-contract RED test**

```js
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import test from "node:test"

const migrationUrl = new URL(
  "../supabase/migrations/20260809105000_registration_observation_google_chat.sql",
  import.meta.url,
)

test("observation Chat consumes the stable domain outbox without replacing core mutations", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  assert.match(sql, /after insert on dashboard_private\.registration_observation_domain_events/i)
  assert.match(sql, /unique\s*\(observation_id,\s*notification_revision,\s*event_key\)/i)
  assert.match(sql, /registration\.observation_reminder_due/i)
  assert.match(sql, /registration\.observation_feedback_due/i)
  assert.doesNotMatch(sql, /create or replace function public\.(?:enter|save|reschedule|cancel|withdraw)_registration_observation_v1/i)
  assert.doesNotMatch(sql, /registration_customer_reminder_jobs|ops_registration_customer_messages|solapi|net\.http|cron\.schedule/i)
  assert.match(sql, /notification_audit_logs/i)
  assert.match(sql, /notification_dispatch_ownership_claims/i)
})

test("all observation rules are immediate and default OFF", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const seededEvents = [...sql.matchAll(/registration\.observation_(scheduled|rescheduled|canceled|reminder_due|feedback_due|feedback_submitted)/g)]
  assert.equal(new Set(seededEvents.map((match) => match[0])).size, 6)
  assert.match(sql, /delivery_mode[\s\S]*'immediate'/i)
  assert.match(sql, /rule_variant_key[\s\S]*'immediate'/i)
  assert.match(sql, /enabled[\s\S]*false/i)
  assert.match(sql, /notification_settings_ui_registry/i)
  assert.match(sql, /notification_rule_content_contracts/i)
})

test("observation Chat leaves protected generic functions byte-identical", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  assert.doesNotMatch(sql, /\bclaim_notification_deliveries_v1\b/i)
  assert.doesNotMatch(sql, /\bprepare_notification_immediate_delivery_v1\b/i)
  assert.doesNotMatch(sql, /\brevalidate_immediate_notification_delivery_v1\b/i)
  assert.match(sql, /read_registration_observation_notification_delivery_frozen_state_v1/i)
  assert.match(sql, /prepare_registration_observation_notification_delivery_v1/i)
  assert.match(sql, /commit_notification_in_app_delivery_v1/i)
  assert.match(sql, /begin_notification_delivery_send_v1/i)

  const result = spawnSync(
    process.execPath,
    ["scripts/verify-supabase-migration-layout.mjs"],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
  )
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test("forward migration preserves the reason registry and narrows the new expiry reason to canceled", async () => {
  const sql = (await readFile(migrationUrl, "utf8")).replace(/\s+/g, " ")
  const count = (pattern) => [...sql.matchAll(pattern)].length
  const statement = (constraintName) => {
    const marker = `add constraint ${constraintName}`
    const start = sql.toLowerCase().indexOf(marker)
    assert.notEqual(start, -1, `${constraintName} add missing`)
    const end = sql.indexOf(";", start)
    assert.notEqual(end, -1, `${constraintName} terminator missing`)
    return sql.slice(start, end + 1)
  }
  const literals = (source) => [...source.matchAll(/'([^']+)'/g)].map((match) => match[1])

  assert.equal(count(/drop constraint notification_deliveries_status_reason_check/gi), 1)
  assert.equal(count(/add constraint notification_deliveries_status_reason_check/gi), 1)
  assert.equal(count(/drop constraint notification_deliveries_status_reason_mapping_check/gi), 1)
  assert.equal(count(/add constraint notification_deliveries_status_reason_mapping_check/gi), 1)

  const registryLiterals = literals(statement("notification_deliveries_status_reason_check"))
  assert.equal(registryLiterals.length, 29)
  assert.equal(registryLiterals.filter((reason) => reason === "notification_window_closed").length, 1)
  assert.deepEqual(
    new Set(registryLiterals),
    new Set([
      "provider_rate_limited", "provider_definite_rejection", "transient_pre_dispatch_failure",
      "connection_restored_manual_retry", "manual_retry_approved", "provider_timeout_after_dispatch",
      "connection_reset_after_dispatch", "worker_lost_after_send_start", "provider_ambiguous_response",
      "connection_missing", "render_validation_failed", "schedule_validation_failed",
      "payload_schema_unsupported", "max_attempts_exhausted", "retry_window_closed", "shadow_mode",
      "no_recipient", "workflow_scope_mismatch", "not_applicable", "legacy_skipped", "legacy_deduped",
      "rule_disabled", "source_status_changed", "source_schedule_changed", "source_revision_changed",
      "rule_revision_changed", "recipient_revoked", "cutover_rollback", "notification_window_closed",
    ]),
  )

  const mapping = statement("notification_deliveries_status_reason_mapping_check")
  const live = mapping.match(/status in \(([^)]*)\) and status_reason is null/i)
  assert.ok(live)
  assert.deepEqual(new Set(literals(live[1])), new Set(["pending", "claimed", "sending", "sent"]))
  const expectedFamilies = new Map([
    ["retry_wait", ["provider_rate_limited", "provider_definite_rejection", "transient_pre_dispatch_failure", "connection_restored_manual_retry", "manual_retry_approved"]],
    ["delivery_unknown", ["provider_timeout_after_dispatch", "connection_reset_after_dispatch", "worker_lost_after_send_start", "provider_ambiguous_response"]],
    ["failed", ["connection_missing", "provider_definite_rejection", "render_validation_failed", "schedule_validation_failed", "payload_schema_unsupported", "max_attempts_exhausted", "retry_window_closed"]],
    ["skipped", ["shadow_mode", "no_recipient", "workflow_scope_mismatch", "not_applicable", "legacy_skipped", "legacy_deduped"]],
  ])
  for (const [status, expected] of expectedFamilies) {
    const family = mapping.match(new RegExp(`status = '${status}' and status_reason in \\(([^)]*)\\)`, "i"))
    assert.ok(family, `${status} mapping missing`)
    assert.equal(literals(family[1]).length, expected.length)
    assert.deepEqual(new Set(literals(family[1])), new Set(expected))
  }
  assert.match(mapping, /status = 'disabled' and status_reason = 'rule_disabled'/i)
  const canceled = mapping.match(/status = 'canceled' and status_reason in \(([^)]*)\)/i)
  assert.ok(canceled)
  const canceledLiterals = literals(canceled[1])
  assert.equal(canceledLiterals.length, 7)
  assert.deepEqual(new Set(canceledLiterals), new Set([
    "source_status_changed", "source_schedule_changed", "source_revision_changed",
    "rule_revision_changed", "recipient_revoked", "cutover_rollback", "notification_window_closed",
  ]))
  assert.equal(literals(mapping).filter((reason) => reason === "notification_window_closed").length, 1)
  assert.equal([...mapping.matchAll(/status = '/gi)].length, 6)
})

test("service worker uses RPCs and legacy QA performs no shared delivery or ownership DML", async () => {
  const repoUrl = new URL("..", import.meta.url)
  const worker = await readFile(new URL("src/features/notifications/server/notification-worker.ts", repoUrl), "utf8")
  const legacyQa = await readFile(new URL("scripts/verify-word-retest-expected-at-concurrency.mjs", repoUrl), "utf8")
  const collectCode = async (directoryUrl) => {
    const files = []
    for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl)
      if (entry.isDirectory()) files.push(...await collectCode(child))
      else if (/\.(?:cjs|js|mjs|ts|tsx)$/.test(entry.name)) files.push(child)
    }
    return files
  }

  assert.doesNotMatch(worker, /\.schema\(["']dashboard_private["']\)\s*\.from\(["']notification_(?:deliveries|dispatch_ownership_claims)["']\)/)
  assert.doesNotMatch(legacyQa, /\.from\(["']notification_(?:deliveries|dispatch_ownership_claims)["']\)[\s\S]{0,160}\.(?:insert|update|delete)\s*\(/)
  assert.match(worker, /claim_notification_deliveries_v1/)
  assert.match(worker, /begin_notification_delivery_send_v1|prepare_registration_observation_notification_delivery_v1/)

  for (const fileUrl of [
    ...await collectCode(new URL("src/", repoUrl)),
    ...await collectCode(new URL("scripts/", repoUrl)),
  ]) {
    const source = (await readFile(fileUrl, "utf8")).replace(/\s+/g, " ")
    assert.doesNotMatch(
      source,
      /\.from\(["']notification_(?:deliveries|dispatch_ownership_claims)["']\).{0,240}\.(?:insert|update|delete)\s*\(/,
      `shared table DML must go through RPC: ${fileURLToPath(fileUrl)}`,
    )
  }
})

test("observation final prepare keeps executive connection and director eligibility channel-local", async () => {
  const sql = await readFile(migrationUrl, "utf8")
  const segment = (startMarker, endMarker) => {
    const start = sql.indexOf(startMarker)
    const end = sql.indexOf(endMarker)
    assert.notEqual(start, -1, `${startMarker} missing`)
    assert.ok(end > start, `${endMarker} missing or out of order`)
    return sql.slice(start, end)
  }
  const google = segment(
    "registration_observation_final_prepare_google_chat_target_begin",
    "registration_observation_final_prepare_google_chat_target_end",
  )
  const inApp = segment(
    "registration_observation_final_prepare_in_app_target_begin",
    "registration_observation_final_prepare_in_app_target_end",
  )

  assert.match(google, /begin_notification_delivery_send_v1/i)
  assert.match(google, /google_chat\.executive/i)
  assert.match(google, /connection:google_chat\.executive/i)
  assert.doesNotMatch(google, /public\.google_chat_webhook_settings|public\.profiles|auth\.users|notification_profile_is_active_v1|is_active_subject_director|director_profile_id/i)
  assert.match(inApp, /public\.profiles[\s\S]*auth\.users/i)
  assert.match(inApp, /is_active_subject_director[\s\S]*notification_profile_is_active_v1/i)
  assert.match(inApp, /recipient_revoked/i)
  assert.doesNotMatch(inApp, /google_chat_webhook_settings|google_chat\.management/i)
})
```

- [ ] **Step 2: Write the first pgTAP RED assertions**

```sql
begin;
select no_plan();

select has_table('dashboard_private', 'registration_observation_chat_jobs');
select has_function(
  'public',
  'get_registration_observation_notification_source_v1',
  array['uuid']
);
select has_function(
  'public',
  'claim_registration_observation_chat_jobs_v1',
  array['text','integer','integer']
);
select has_function(
  'public',
  'materialize_registration_observation_chat_job_v1',
  array['uuid','uuid','integer','jsonb']
);
select has_function(
  'public',
  'read_registration_observation_notification_delivery_frozen_state_v1',
  array['uuid','uuid']
);
select has_function(
  'public',
  'prepare_registration_observation_notification_delivery_v1',
  array['uuid','uuid','uuid','uuid','bigint','text','text']
);
select has_function(
  'public',
  'get_registration_observation_google_chat_readiness_v1',
  array[]::text[]
);
select has_trigger(
  'dashboard_private',
  'registration_observation_domain_events',
  'registration_observation_google_chat_materializer'
);

select * from finish();
rollback;
```

The focused file deliberately uses pgTAP `no_plan()` so every executable assertion printed before `finish()` is authoritative and later parity assertions cannot drift from a hand-maintained count. A missing assertion still fails through the named Node/static contract and the required behavior matrix in Step 10; do not replace `no_plan()` with an estimated fixed count.

- [ ] **Step 3: Run RED and record the real failure**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-google-chat-db.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus google-chat
```

Expected: the Node test reports `ENOENT` for `20260809105000_registration_observation_google_chat.sql`; the already-frozen common runner reports `registration_observation_local_db_focus_unavailable:google-chat` because the required migration/pgTAP pair is absent. This task consumes the core-owned focus mapping and does not edit the runner or its test. No provider request is possible in either command.

- [ ] **Step 4: Generate the migration through the pinned CLI and freeze its reviewed name**

Run before writing any SQL:

```bash
TIPS_CHAT_SUPABASE_CLI="/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go"
TIPS_CHAT_MIGRATION_DIR="supabase/migrations"
TIPS_CHAT_MIGRATION_TARGET="$TIPS_CHAT_MIGRATION_DIR/20260809105000_registration_observation_google_chat.sql"
TIPS_CHAT_BEFORE="$(mktemp)"
TIPS_CHAT_AFTER="$(mktemp)"

test "$("$TIPS_CHAT_SUPABASE_CLI" --version)" = "2.103.0"
"$TIPS_CHAT_SUPABASE_CLI" migration new --help
test ! -e "$TIPS_CHAT_MIGRATION_TARGET"
find "$TIPS_CHAT_MIGRATION_DIR" -maxdepth 1 -type f -name '*.sql' -print | sort > "$TIPS_CHAT_BEFORE"
"$TIPS_CHAT_SUPABASE_CLI" migration new registration_observation_google_chat
find "$TIPS_CHAT_MIGRATION_DIR" -maxdepth 1 -type f -name '*.sql' -print | sort > "$TIPS_CHAT_AFTER"
TIPS_CHAT_GENERATED="$(comm -13 "$TIPS_CHAT_BEFORE" "$TIPS_CHAT_AFTER")"
test "$(printf '%s\n' "$TIPS_CHAT_GENERATED" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
test -f "$TIPS_CHAT_GENERATED"
test ! -s "$TIPS_CHAT_GENERATED"
test "$TIPS_CHAT_GENERATED" != "$TIPS_CHAT_MIGRATION_TARGET"
git add "$TIPS_CHAT_GENERATED"
git mv "$TIPS_CHAT_GENERATED" "$TIPS_CHAT_MIGRATION_TARGET"
test -f "$TIPS_CHAT_MIGRATION_TARGET"
test ! -e "$TIPS_CHAT_GENERATED"
```

Expected: pinned CLI/help both succeed; exactly one CLI-generated empty source is staged and moved to the collision-free reviewed target. If any assertion fails, stop before SQL editing. After SQL is written, Step 13 requires `test -s "$TIPS_CHAT_MIGRATION_TARGET"`, no generated orphan, and the exact `20260809105000` runner/layout contract. Never create the frozen target directly.

- [ ] **Step 5: Add a strict dependency gate and source projection**

At migration start, acquire a transaction advisory lock and fail the whole migration with `registration_observation_google_chat_dependency_missing` unless all of the following are present:

```text
to_regprocedure('public.registration_observation_runtime_version()') is not null
public.registration_observation_runtime_version() = 0
dashboard_private.registration_observation_domain_events exists
dashboard_private.registration_observation_domain_events has zero rows
to_regprocedure('dashboard_private.record_notification_event_v1(text,text,text,text,text,bigint,text,uuid,timestamptz,integer,jsonb,uuid,bigint)') is not null
to_regprocedure('public.begin_notification_delivery_send_v1(uuid,uuid)') is not null
to_regprocedure('public.commit_notification_in_app_delivery_v1(uuid,uuid)') is not null
to_regprocedure('dashboard_private.notification_canonical_json_v1(jsonb)') is not null
to_regprocedure('dashboard_private.notification_sha256_hex_v1(text)') is not null
dashboard_private.notification_rules exists
dashboard_private.notification_templates exists
dashboard_private.notification_settings_ui_registry exists
dashboard_private.notification_rule_content_contracts exists
dashboard_private.notification_events exists
dashboard_private.notification_deliveries exists
dashboard_private.notification_dispatch_ownership_claims exists
dashboard_private.notification_audit_logs exists
notification_deliveries_status_reason_check exists on dashboard_private.notification_deliveries and its normalized pg_get_constraintdef equals the frozen 28-reason baseline below
notification_deliveries_status_reason_mapping_check exists on dashboard_private.notification_deliveries and its normalized pg_get_constraintdef equals the frozen baseline mapping below
```

The runtime-zero and empty-outbox checks are a one-time cutover fence: core, feedback/enrollment and this migration must all land before the admin activates observation runtime. A nonzero runtime raises `registration_observation_google_chat_runtime_already_active`; a pre-existing domain row raises `registration_observation_google_chat_preexisting_domain_events`. Before either named delivery reason constraint is dropped, read both definitions from `pg_constraint`, normalize only whitespace and outer `CHECK` parentheses, and exact-compare the complete frozen definitions represented by the existing 28-reason registry and complete status mapping copied in Step 10. Missing, duplicated, differently owned, or definition-drifted constraints raise `registration_observation_notification_reason_constraint_drift`; no DDL has run at that point. The migration does not backfill or silently discard any failed fence.

Create private implementation plus service-only public wrapper:

```sql
dashboard_private.get_registration_observation_notification_source_impl_v1(
  p_observation_id uuid
) returns jsonb

public.get_registration_observation_notification_source_v1(
  p_observation_id uuid
) returns jsonb
```

The private implementation is `security invoker set search_path=''`. The public wrapper alone is `security definer set search_path=''`; its first executable statement, before any read, is `if pg_catalog.coalesce((select auth.role()), '') <> 'service_role' then raise exception 'registration_observation_notification_source_forbidden' using errcode='42501'; end if;`. It contains no dynamic SQL and delegates only to the fixed private signature. Revoke the private implementation and public wrapper exact signatures from `PUBLIC, anon, authenticated, service_role`, then grant only the public wrapper to `service_role`. It must:

```sql
revoke all on function dashboard_private.get_registration_observation_notification_source_impl_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_registration_observation_notification_source_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_registration_observation_notification_source_v1(uuid)
  to service_role;
```

1. read exactly one observation, linked appointment, exact track/task, exact class, current normalized session or exact legacy session key, teacher/profile, classroom/campus and current track director;
2. rebuild the exact tagged `sourceRevision` and `bookingFactHash` with `dashboard_private.registration_observation_booking_fact_hash_v1`;
3. return the exact `RegistrationObservationNotificationSource` key set;
4. return `hasFeedback` boolean only, never suitability/result/reason;
5. raise `registration_observation_notification_source_missing` for missing/inconsistent links and `registration_observation_notification_source_dirty` when stored/current booking hash differs.

`directorProfileId` is deliberately nullable channel-routing metadata, not part of `sourceRevision` or `bookingFactHash`. The source RPC/reader must not turn a null director, missing profile, deleted account, or banned account into `registration_observation_notification_source_missing`; it returns the nullable current track value and leaves profile/account eligibility exclusively to the final-prepare in-app branch. This is what allows the same valid feedback-submitted source to retain its executive Google Chat delivery when its director inbox is unavailable.

The function performs no `classes.select('*')`, full observation scan, sibling track read or unbounded `schedule_plan` projection. Add an observation PK lookup, appointment PK lookup and exact class/session lookup to the pgTAP `EXPLAIN` assertions.

- [ ] **Step 6: Create the closed Chat job ledger**

First create immutable, security-invoker private validators `dashboard_private.registration_observation_chat_source_revision_valid_v1(jsonb) returns boolean`, `dashboard_private.registration_observation_chat_job_snapshots_valid_v1(text,jsonb,jsonb,jsonb,jsonb) returns boolean`, and `dashboard_private.registration_observation_chat_reservation_snapshot_hash_v1(text,jsonb,jsonb) returns text`. The first accepts only the frozen normalized/legacy tagged union, with no extra/null keys; the second enforces exact event-specific object/null shapes. The hash helper returns `notification_sha256_hex_v1(notification_canonical_json_v1(jsonb_build_object('eventKey',...,'currentBooking',...,'previousBooking',...)))`, preserving explicit JSON nulls. Do not invent a second serializer. Cross-language tests compare this output with the worker's existing sorted-key `canonicalJson` SHA-256 for reordered object keys and nested arrays. Create this exact relation in `dashboard_private`:

```sql
create table dashboard_private.registration_observation_chat_jobs (
  job_id uuid primary key default gen_random_uuid(),
  domain_event_id uuid not null references dashboard_private.registration_observation_domain_events(event_id) on delete restrict,
  observation_id uuid not null references public.ops_registration_observations(id) on delete restrict,
  appointment_id uuid not null references public.ops_registration_appointments(id) on delete restrict,
  notification_revision integer not null check (notification_revision > 0),
  event_key text not null check (event_key in (
    'registration.observation_scheduled',
    'registration.observation_rescheduled',
    'registration.observation_canceled',
    'registration.observation_reminder_due',
    'registration.observation_feedback_due',
    'registration.observation_feedback_submitted'
  )),
  source_revision jsonb not null,
  booking_fact_hash text not null check (booking_fact_hash ~ '^[a-f0-9]{64}$'),
  reservation_snapshot_hash text not null check (reservation_snapshot_hash ~ '^[a-f0-9]{64}$'),
  current_booking_snapshot jsonb,
  previous_booking_snapshot jsonb,
  preparation_snapshot jsonb,
  submission_snapshot jsonb,
  rule_snapshot jsonb not null check (jsonb_typeof(rule_snapshot) = 'array'),
  due_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > due_at),
  status text not null check (status in (
    'pending','claimed','materialized','suppressed','canceled','source_dirty','failed'
  )),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz,
  claimed_by text,
  claim_token uuid,
  lease_expires_at timestamptz,
  materialized_event_id uuid references dashboard_private.notification_events(id) on delete restrict,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (observation_id, notification_revision, event_key),
  check (
    source_revision = jsonb_strip_nulls(source_revision)
    and dashboard_private.registration_observation_chat_source_revision_valid_v1(source_revision)
  ),
  check (current_booking_snapshot is null or jsonb_typeof(current_booking_snapshot) = 'object'),
  check (previous_booking_snapshot is null or jsonb_typeof(previous_booking_snapshot) = 'object'),
  check (preparation_snapshot is null or jsonb_typeof(preparation_snapshot) = 'object'),
  check (submission_snapshot is null or jsonb_typeof(submission_snapshot) = 'object'),
  check (dashboard_private.registration_observation_chat_job_snapshots_valid_v1(
    event_key,
    current_booking_snapshot,
    previous_booking_snapshot,
    preparation_snapshot,
    submission_snapshot
  )),
  check (
    reservation_snapshot_hash = dashboard_private.registration_observation_chat_reservation_snapshot_hash_v1(
      event_key,
      current_booking_snapshot,
      previous_booking_snapshot
    )
  ),
  check (
    (status = 'pending'
      and next_attempt_at is not null
      and claim_token is null and claimed_by is null and lease_expires_at is null
      and materialized_event_id is null and last_error_code is null and completed_at is null)
    or (status = 'claimed'
      and next_attempt_at is null
      and claim_token is not null and claimed_by is not null and lease_expires_at is not null
      and materialized_event_id is null and last_error_code is null and completed_at is null)
    or (status = 'materialized'
      and next_attempt_at is null
      and claim_token is null and claimed_by is null and lease_expires_at is null
      and materialized_event_id is not null and last_error_code is null and completed_at is not null)
    or (status in ('suppressed','canceled','source_dirty','failed')
      and next_attempt_at is null
      and claim_token is null and claimed_by is null and lease_expires_at is null
      and materialized_event_id is null and last_error_code is not null and completed_at is not null)
  )
);
```

Every transition writes this shape atomically. Claim clears `next_attempt_at`; retry clears all claim/lease fields and restores a non-null bounded `next_attempt_at`; materialize and every terminal finish/reap disposition clear all claim/lease/next-attempt fields. pgTAP attempts one invalid insert/update for each branch so a pending row cannot become unschedulable and a terminal row cannot retain a live lease.

The snapshot validator admits exactly these combinations and exact key sets:

| Event key | Current booking | Previous booking | Preparation | Submission |
|---|---:|---:|---:|---:|
| scheduled | required | null | required | null |
| rescheduled | required | required | required | null |
| canceled | required canceled-booking fact | null | null | null |
| reminder_due | required | null | required | null |
| feedback_due | required | null | null | null |
| feedback_submitted | required | null | null | required `{submittedByName,submittedAt}` |

Booking snapshots contain only the frozen booking presentation keys; preparation contains exactly `{textbookNames,progressSummary}`. No validator accepts phone, school, feedback result/reason, sibling content or an extra key. pgTAP exercises every accepted row and one rejection for each wrong/mixed/extra-key shape, then proves that changing one current/previous booking byte without recomputing `reservation_snapshot_hash` fails `23514` and that deterministic replay produces the same hash.

Add exact indexes:

```sql
create index registration_observation_chat_jobs_due_claim_idx
  on dashboard_private.registration_observation_chat_jobs(status, next_attempt_at, due_at, job_id)
  where status = 'pending';
create index registration_observation_chat_jobs_lease_idx
  on dashboard_private.registration_observation_chat_jobs(lease_expires_at, job_id)
  where status = 'claimed';
create index registration_observation_chat_jobs_observation_revision_idx
  on dashboard_private.registration_observation_chat_jobs(observation_id, notification_revision desc, created_at desc);
create index registration_observation_chat_jobs_terminal_idx
  on dashboard_private.registration_observation_chat_jobs(status, completed_at desc)
  where status in ('suppressed','canceled','source_dirty','failed');
```

Enable RLS and apply the exact direct-access fence:

```sql
alter table dashboard_private.registration_observation_chat_jobs enable row level security;
revoke all on table dashboard_private.registration_observation_chat_jobs
  from public, anon, authenticated, service_role;
```

No policy grants direct Data API access and the worker receives no direct table DML. Only the exact service-role public RPC wrappers below may mutate/read the ledger. Revoke every private helper exact signature from `PUBLIC, anon, authenticated, service_role`; do not grant it back.

- [ ] **Step 7: Seed exact default-OFF UI registry, rules, templates, and DB content contracts**

Replace `notification_rules_workflow_audience_check` forward-only so registration also allows `executive_team`; preserve every existing workflow/audience pair byte-for-byte otherwise. Seed seven deterministic system rules:

| Event | Channel | Audience | Destination |
|---|---|---|---|
| scheduled | google_chat | subject_team | canonical subject connection |
| rescheduled | google_chat | subject_team | canonical subject connection |
| canceled | google_chat | subject_team | canonical subject connection |
| reminder_due | google_chat | subject_team | canonical subject connection |
| feedback_due | google_chat | subject_team | canonical subject connection |
| feedback_submitted | google_chat | executive_team | `google_chat.executive` |
| feedback_submitted | in_app | track_director | current director profile |

All seven rows use `enabled=false`, `delivery_mode='immediate'`, `rule_variant_key='immediate'`, `schedule_key=null`, `schedule_config=null`, revision `1`, system actor. Each has one immutable version-1 template, payload schema version `3`, SHA-256 checksum and exact allowed-variable list. Use these deterministic UUID literals in both migration and content fixtures so repeated clean apply is identical:

| Identity | Rule UUID | Template UUID |
|---|---|---|
| scheduled subject Chat | `81000000-0000-4000-8000-000000000001` | `82000000-0000-4000-8000-000000000001` |
| rescheduled subject Chat | `81000000-0000-4000-8000-000000000002` | `82000000-0000-4000-8000-000000000002` |
| canceled subject Chat | `81000000-0000-4000-8000-000000000003` | `82000000-0000-4000-8000-000000000003` |
| reminder_due subject Chat | `81000000-0000-4000-8000-000000000004` | `82000000-0000-4000-8000-000000000004` |
| feedback_due subject Chat | `81000000-0000-4000-8000-000000000005` | `82000000-0000-4000-8000-000000000005` |
| feedback_submitted executive Chat | `81000000-0000-4000-8000-000000000006` | `82000000-0000-4000-8000-000000000006` |
| feedback_submitted director inbox | `81000000-0000-4000-8000-000000000007` | `82000000-0000-4000-8000-000000000007` |

Before inserting a rule, insert its matching `dashboard_private.notification_settings_ui_registry` row with the same identity/UUID. Use `workflow_label='등록'`, `workflow_sort=3`, `group_label='청강'`, stable event sort `201..206`, descriptive Korean event/audience/channel labels, `cell_sort=1`, `initial_enabled=false`, `source_trigger_kind='registration_observation_domain_event'`, `configuration_kind='editable_rule'`, and `activation_locked=false`. The in-app/Chat rows for feedback submitted use distinct cell sort `1/2` so UI order is deterministic. The migration asserts seven registry rows, seven rules, seven active templates, and zero enabled rows before continuing.

Each template sets `content_contract_version='1'`. Insert a matching `dashboard_private.notification_rule_content_contracts` row with the current repository shape and no invented keys:

```ts
type ObservationContentContractV1 = Readonly<{
  contractVersion: "1"
  availableVariables: ReadonlyArray<{
    key: string
    token: string
    piiClass: string
  }>
  requiredTokens: ReadonlyArray<string>
  optionalLineTokens: ReadonlyArray<string>
  mustHaveFacts: ReadonlyArray<
    "target" | "event" | "current_state" | "before_after" |
    "result" | "progress_actor" | "schedule" | "location"
  >
  supportedPayloadVersions: readonly [3]
  destinationPolicy: Readonly<{
    allowedConnectionKeys: ReadonlyArray<
      "google_chat.english" | "google_chat.math" |
      "google_chat.science" | "google_chat.executive"
    >
    subjectScoped: boolean
  }>
  freeTextVisibility: Readonly<Record<string, "show" | "omit">>
  freeTextPriority: ReadonlyArray<string>
  fieldPresence: Readonly<Record<string, {
    required: boolean
    nullBehavior: "reject" | "display" | "omit"
    nullDisplay: string | null
    emptyArrayBehavior: "reject" | "allow" | "omit"
  }>>
}>
```

The five subject Chat contracts use all three subject connection keys and `subjectScoped=true`; executive Chat uses only `google_chat.executive`; the director in-app contract uses an empty connection list. Both non-subject contracts use `subjectScoped=false`. `availableVariables` and `fieldPresence` cover exactly the template variables. Because none of the observation templates exposes an approved free-text field, `freeTextVisibility={}` and `freeTextPriority=[]`; phone, school, inquiry, suitability, result, feedback reason, URL and UUID never appear. Seed `contract_version='1'`, update only the same deterministic identity on conflict, and assert the registry/rule/contract foreign-key identity is exact.

The event-spec arrays are deterministic; `optionalLineTokens=[]` for all seven identities:

| Event | `requiredTokens` | `mustHaveFacts` |
|---|---|---|
| scheduled | 학생, 과목, 수업, 일정, 담당선생님, 강의실, 교재, 진도 | target, event, schedule, location |
| rescheduled | 학생, 과목, 수업, 기존일정, 일정, 담당선생님, 강의실, 교재, 진도 | target, event, before_after, schedule, location |
| canceled | 학생, 과목, 수업, 일정 | target, event, current_state, schedule |
| reminder_due | 학생, 과목, 수업, 일정, 담당선생님, 강의실, 교재, 진도 | target, event, schedule, location |
| feedback_due | 학생, 과목, 수업, 일정, 담당선생님, 강의실 | target, event, schedule, location |
| feedback_submitted executive Chat | 학생, 과목, 수업, 제출자, 제출시각 | target, event, progress_actor, schedule |
| feedback_submitted director inbox | 학생, 과목, 수업, 제출자, 제출시각 | target, event, progress_actor, schedule |

The canonical Korean templates use the same intuitive Korean tokens exposed by notification settings. Add only the missing entries to `VARIABLE_BY_TOKEN`; reuse existing entries byte-for-byte:

```text
학생 -> student_name (existing)
과목 -> subjects (existing; presentation supplies the one canonical observation subject)
수업 -> class_name (existing)
일정 -> scheduled_at (existing)
기존일정 -> before_schedule (existing)
담당선생님 -> teacher_name (existing)
강의실 -> classroom (new, location)
교재 -> textbooks (new, none)
진도 -> progress (new, none)
제출자 -> submitted_by_name (new, staff_name)
제출시각 -> submitted_at (new, schedule)
```

The canonical Korean templates are:

```text
[청강 예약] {학생}
학생: {학생}
과목/수업: [{과목}] {수업}
일시: {일정}
담당 선생님: {담당선생님}
강의실: {강의실}
교재: {교재}
진도: {진도}
교재 복사 등 청강 준비가 필요합니다.
```

```text
[청강 일정 변경] {학생}
학생: {학생}
과목/수업: [{과목}] {수업}
이전 일정: {기존일정}
변경 일정: {일정}
담당 선생님: {담당선생님}
강의실: {강의실}
교재: {교재}
진도: {진도}
변경된 일정에 맞춰 청강 준비가 필요합니다.
```

```text
[청강 취소] {학생}
학생: {학생}
과목/수업: [{과목}] {수업}
취소 일정: {일정}
청강 예약이 취소되었습니다.
```

```text
[오늘 청강 준비] {학생}
오늘 청강이 예정되어 있습니다.
학생: {학생}
과목/수업: [{과목}] {수업}
일시: {일정}
담당 선생님: {담당선생님}
강의실: {강의실}
교재: {교재}
진도: {진도}
교재 복사 등 준비 내용을 확인해 주세요.
```

```text
[청강 피드백 요청] {학생}
청강은 어땠나요? 적합 여부와 사유를 입력해 주세요.
학생: {학생}
과목/수업: [{과목}] {수업}
수업 일시: {일정}
담당 선생님: {담당선생님}
강의실: {강의실}
```

```text
[청강 피드백 등록] {학생}
청강 피드백이 등록되었습니다.
학생: {학생}
과목/수업: [{과목}] {수업}
제출자: {제출자}
제출시각: {제출시각}
```

The executive Google Chat and director inbox share the last body. Neither template has a result/reason token.

- [ ] **Step 8: Materialize domain events into jobs atomically**

Create private helpers and trigger:

```sql
dashboard_private.registration_observation_chat_rule_snapshot_v1(
  p_event_key text
) returns jsonb

dashboard_private.registration_observation_chat_booking_snapshot_v1(
  p_observation_id uuid
) returns jsonb

dashboard_private.materialize_registration_observation_chat_from_domain_event_v1()
returns trigger

create trigger registration_observation_google_chat_materializer
after insert on dashboard_private.registration_observation_domain_events
for each row execute function dashboard_private.materialize_registration_observation_chat_from_domain_event_v1();
```

The two read helpers and trigger function are `security invoker set search_path=''`; revoke their exact signatures from `PUBLIC, anon, authenticated, service_role`. The trigger gains privileges only through the already-authorized core SECURITY DEFINER mutation that inserts the domain event, and it validates `TG_OP='INSERT'`, `TG_TABLE_SCHEMA='dashboard_private'`, `TG_TABLE_NAME='registration_observation_domain_events'` before touching a job.

The trigger locks the observation's Chat jobs by `(observation_id, notification_revision, event_key)` order, then selects every matching notification rule in ascending `rule_id` order `FOR SHARE` and holds those locks through the job inserts. It validates `NEW.appointment_id`, `NEW.notification_revision`, `NEW.source_revision` and `NEW.booking_fact_hash` against the current canonical source, then applies the frozen mapping. The saved `rule_snapshot` is built only from the locked rows, so concurrent `save_notification_control_plane_v2` either finishes before the snapshot or waits until every job identity is committed. The trigger must not accept a destination from the domain row or browser.

- scheduled: insert immediate scheduled with the observation's stored, stably sorted textbook/progress `preparation_snapshot`; insert reminder only when `starts_at - NEW.occurred_at >= interval '3 hours'`; always insert feedback due.
- rescheduled: terminalize older unmaterialized reminder/feedback rows, obtain `previous_booking_snapshot` from the latest lower notification revision, store the newly saved textbook/progress snapshot, insert immediate rescheduled and the new revision due rows. Missing previous snapshot raises `registration_observation_chat_previous_snapshot_missing` and rolls back the reschedule rather than emitting ambiguous copy.
- canceled: terminalize older unmaterialized due rows and insert one canceled immediate job with the prior booking snapshot.
- attendance_recorded: terminalize the current revision reminder only; leave feedback due unchanged; insert no Chat event.
- no_show: terminalize current revision reminder and feedback due; insert no Chat event.
- feedback_submitted: terminalize current revision reminder and feedback due; insert one feedback-submitted immediate job. Store `submission_snapshot` with exact keys `submittedByName,submittedAt` from the current observation/profile; never result or reason.

For every output event, capture the exact current rule IDs/revisions/template IDs/enabled values. If every matching rule is disabled, create the identity as terminal `suppressed/rule_disabled_at_source`. If at least one is enabled, create `pending` with `next_attempt_at=due_at`. A later rule update never mutates this snapshot or reopens a terminal row.

Every trigger-side cancellation sets the allowlisted lifecycle error code, `completed_at=clock_timestamp()`, and clears `next_attempt_at/claimed_by/claim_token/lease_expires_at` in the same statement so it satisfies the exact terminal shape even when it cancels a previously claimed-before-marker row.

- [ ] **Step 9: Implement bounded claim, finish, reap and materialization RPCs**

Exact public signatures:

```sql
public.claim_registration_observation_chat_jobs_v1(
  p_worker_id text,
  p_batch_size integer,
  p_lease_seconds integer
) returns setof jsonb

public.finish_registration_observation_chat_job_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_disposition text,
  p_error_code text,
  p_next_attempt_at timestamptz
) returns jsonb

public.reap_registration_observation_chat_job_leases_v1(
  p_worker_id text,
  p_batch_size integer
) returns jsonb

public.materialize_registration_observation_chat_job_v1(
  p_job_id uuid,
  p_claim_token uuid,
  p_payload_schema_version integer,
  p_payload jsonb
) returns jsonb
```

Each public wrapper is `security definer set search_path=''` and begins with an exact actor fence, before reading or mutating any row:

```sql
if pg_catalog.coalesce((select auth.role()), '') <> 'service_role' then
  raise exception 'registration_observation_chat_worker_forbidden'
    using errcode = '42501';
end if;
```

Revoke each exact public signature from `PUBLIC, anon, authenticated, service_role`, then grant that exact signature to `service_role` only. Do not use a broad `GRANT ... ALL FUNCTIONS IN SCHEMA`. Any private implementation remains `security invoker set search_path=''`, is revoked from all four roles, and is never granted back. Worker ID is 1..128 safe characters, batch 1..100, and lease 30..300 seconds. Claim uses `FOR UPDATE SKIP LOCKED`, `(next_attempt_at,due_at,job_id)` order and increments attempt count once. Before returning a claim it re-reads canonical source and current rule rows:

```sql
revoke all on function public.claim_registration_observation_chat_jobs_v1(text,integer,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.finish_registration_observation_chat_job_v1(uuid,uuid,text,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.reap_registration_observation_chat_job_leases_v1(text,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.materialize_registration_observation_chat_job_v1(uuid,uuid,integer,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_registration_observation_chat_jobs_v1(text,integer,integer)
  to service_role;
grant execute on function public.finish_registration_observation_chat_job_v1(uuid,uuid,text,text,timestamptz)
  to service_role;
grant execute on function public.reap_registration_observation_chat_job_leases_v1(text,integer)
  to service_role;
grant execute on function public.materialize_registration_observation_chat_job_v1(uuid,uuid,integer,jsonb)
  to service_role;
```

- status or eligibility changed: terminal `canceled/source_status_changed`;
- notification revision changed: terminal `canceled/source_revision_changed`;
- booking hash changed: terminal `source_dirty/source_schedule_changed`;
- exact rule snapshot/revision/enabled state changed: terminal `suppressed/rule_revision_changed`;
- `expires_at <= clock_timestamp()`: terminal `canceled/notification_window_closed`;
- transient DB error: transaction fails, no state change, lease is not acquired.

Claim JSON exact keys are:

```text
job_id, claim_token, observation_id, appointment_id, notification_revision,
event_key, due_at, expires_at, attempt_count, source_revision,
booking_fact_hash, reservation_snapshot_hash,
current_booking_snapshot, previous_booking_snapshot,
preparation_snapshot, submission_snapshot, rule_snapshot
```

`finish` only accepts `retry | failed | canceled | source_dirty | suppressed`. Retry requires a future `p_next_attempt_at < expires_at`, a transient allowlisted code and `attempt_count < 5`; it clears claim fields and does not persist the transient error as `last_error_code`. Every other disposition is terminal, stores its allowlisted non-null terminal error code and clears claim/lease/next-attempt fields. Reap returns expired claimed rows to the exact pending shape only while the same retry bounds hold; otherwise it closes them in the exact failed shape. Its response is exact `{reaped_count, failed_count}`.

Materialize re-locks the claimed job, revalidates source/rule/hash a second time, checks payload schema `3` and the exact event-specific key set/type/size, and calls the existing function:

```sql
dashboard_private.record_notification_event_v1(
  'global',
  'registration',
  v_job.event_key,
  'registration_observation',
  v_job.observation_id::text,
  v_job.notification_revision::bigint,
  'registration:observation:' || v_job.observation_id::text ||
    ':notification_revision:' || v_job.notification_revision::text ||
    ':event:' || replace(v_job.event_key, 'registration.observation_', ''),
  null,
  v_job.due_at,
  3,
  p_payload,
  null,
  null
)
```

Before calling it, reacquire the exact rule IDs in ascending order `FOR SHARE`, compare those locked rows with `rule_snapshot`, and hold the locks through `record_notification_event_v1`. Read the inserted/existing `dashboard_private.notification_events.rule_snapshot` and compare it byte-for-byte with the job snapshot before marking the job materialized. A pre-call mismatch suppresses the job with no NCP event; a post-insert mismatch raises and rolls the transaction back, so neither the NCP event nor the job transition can commit. This closes the concurrent rule-save window without changing the existing recorder. On success set `materialized_event_id`, `status='materialized'`, `completed_at`, clear `next_attempt_at/claimed_by/claim_token/lease_expires_at`, and keep `last_error_code=null`; exact replay returns the same event ID.

- [ ] **Step 10: Add first-attempt refresh, observation final-prepare, heartbeat and readiness DB contracts**

Before any observation function can write `canceled/notification_window_closed`, forward-replace the two existing named delivery reason CHECKs. Preserve every existing literal and mapping; add `notification_window_closed` exactly once to the global registry and only to the `canceled` family. For the pre-DDL dependency comparison, the expected current definitions are exactly the two final definitions below with the two `notification_window_closed` entries removed—one from the global list and one from the canceled list—and no other textual or semantic change after the stated normalization. Do not modify `tests/notification-control-plane-schema.test.mjs`, which intentionally verifies the historical creation migration rather than the forward schema. The new migration-contract test and focused pgTAP own this final schema.

```sql
alter table dashboard_private.notification_deliveries
  drop constraint notification_deliveries_status_reason_check;
alter table dashboard_private.notification_deliveries
  add constraint notification_deliveries_status_reason_check
  check (status_reason is null or status_reason in (
    'provider_rate_limited',
    'provider_definite_rejection',
    'transient_pre_dispatch_failure',
    'connection_restored_manual_retry',
    'manual_retry_approved',
    'provider_timeout_after_dispatch',
    'connection_reset_after_dispatch',
    'worker_lost_after_send_start',
    'provider_ambiguous_response',
    'connection_missing',
    'render_validation_failed',
    'schedule_validation_failed',
    'payload_schema_unsupported',
    'max_attempts_exhausted',
    'retry_window_closed',
    'shadow_mode',
    'no_recipient',
    'workflow_scope_mismatch',
    'not_applicable',
    'legacy_skipped',
    'legacy_deduped',
    'rule_disabled',
    'source_status_changed',
    'source_schedule_changed',
    'source_revision_changed',
    'rule_revision_changed',
    'recipient_revoked',
    'cutover_rollback',
    'notification_window_closed'
  ));

alter table dashboard_private.notification_deliveries
  drop constraint notification_deliveries_status_reason_mapping_check;
alter table dashboard_private.notification_deliveries
  add constraint notification_deliveries_status_reason_mapping_check
  check (
    (status in ('pending', 'claimed', 'sending', 'sent') and status_reason is null)
    or (status = 'retry_wait' and status_reason in (
      'provider_rate_limited',
      'provider_definite_rejection',
      'transient_pre_dispatch_failure',
      'connection_restored_manual_retry',
      'manual_retry_approved'
    ))
    or (status = 'delivery_unknown' and status_reason in (
      'provider_timeout_after_dispatch',
      'connection_reset_after_dispatch',
      'worker_lost_after_send_start',
      'provider_ambiguous_response'
    ))
    or (status = 'failed' and status_reason in (
      'connection_missing',
      'provider_definite_rejection',
      'render_validation_failed',
      'schedule_validation_failed',
      'payload_schema_unsupported',
      'max_attempts_exhausted',
      'retry_window_closed'
    ))
    or (status = 'skipped' and status_reason in (
      'shadow_mode',
      'no_recipient',
      'workflow_scope_mismatch',
      'not_applicable',
      'legacy_skipped',
      'legacy_deduped'
    ))
    or (status = 'disabled' and status_reason = 'rule_disabled')
    or (status = 'canceled' and status_reason in (
      'source_status_changed',
      'source_schedule_changed',
      'source_revision_changed',
      'rule_revision_changed',
      'recipient_revoked',
      'cutover_rollback',
      'notification_window_closed'
    ))
  );
```

Add nullable `observation_payload_snapshot jsonb`, `observation_payload_fingerprint text`, and `observation_render_fingerprint text` columns to `dashboard_private.notification_deliveries`. The snapshot is null or a JSON object; both fingerprints are null or lower-case 64-hex; all three values must be null together or non-null together. Only the observation RPCs below may set them, and those RPCs require `event_row.source_type='registration_observation'`. Existing delivery rows and every non-observation worker path remain unchanged.

Leave `public.claim_notification_deliveries_v1(text,integer,integer)` byte-identical, including its response keys and hash checked by `scripts/verify-supabase-migration-layout.mjs`. Add this separate service-only locked read:

```sql
public.read_registration_observation_notification_delivery_frozen_state_v1(
  p_delivery_id uuid,
  p_claim_token uuid
) returns jsonb
```

It selects the exact delivery by `p_delivery_id FOR UPDATE`, then requires `status='claimed'`, the exact non-null claim token, an unexpired lease, a canonical reserved ownership row for the same event/rule/channel/target/generation, workflow `registration`, source type `registration_observation`, and payload schema `3`. It first selects the effective snapshot by the first/retry rules below, then reads and ISO/timestamptz-validates `delivery_expires_at` from that exact snapshot inside this RPC; the protected generic claim is never extended and the worker never reads the delivery/event tables directly. It returns exactly these camelCase keys and no others:

```ts
export type RegistrationObservationDeliveryFrozenState = Readonly<{
  expiresAt: string
  snapshot: Readonly<Record<string, unknown>>
  payloadFingerprint: string | null
  renderFingerprint: string | null
  title: string
  body: string
  href: string
  lastAttemptStartedAt: string | null
  attemptCount: number
}>
```

For the first claimed attempt, `attemptCount===0`, `lastAttemptStartedAt===null`, all three observation frozen columns are null, and `snapshot` is the linked immutable schema-3 event payload. For a post-refresh first attempt or retry, `snapshot` is exactly `observation_payload_snapshot`; both fingerprints must be non-null lower-case 64-hex and match server recomputation over that snapshot and `{title,body,href}`. A retry additionally requires `attemptCount>0`, non-null `lastAttemptStartedAt`, and at least one ownership-scoped registered-attempt audit. Any mixed null state, claim/lease/ownership mismatch, malformed expiry, or first/retry invariant fails closed. Both first-attempt and retry worker branches source every field in this DTO only through this RPC. The first branch may separately call `get_notification_render_snapshot_v1` only for the immutable template/rule metadata it does not return; it must not use that generic snapshot or the generic claim as a substitute source for expiry, frozen payload/render fields, or attempt state.

Add the first-attempt-only service RPC:

```sql
public.refresh_registration_observation_notification_delivery_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_expected_event_id uuid,
  p_expected_rule_id uuid,
  p_expected_rule_revision bigint,
  p_rendered_title text,
  p_rendered_body text,
  p_href text,
  p_payload jsonb,
  p_payload_fingerprint text,
  p_render_fingerprint text
) returns jsonb
```

It permits only a claimed `registration_observation` delivery with `attempt_count=0`, `last_attempt_started_at is null`, and no registered attempt in `dashboard_private.notification_audit_logs` for the delivery's exact `notification_dispatch_ownership_claims.id` (`entity_kind='notification_external_attempt'`, `action='external_attempt_registered'`, `entity_id` prefixed by `ownership.id || ':'`). It repeats current source/rule/hash eligibility validation, exact-validates payload schema 3, validates both lower-case 64-hex fingerprints and the existing title/body/href size policy, and independently recomputes both hashes with the existing `notification_canonical_json_v1` + `notification_sha256_hex_v1`: payload over `p_payload`, render over exact JSON `{title,body,href}`. It atomically stores the payload snapshot, rendered title/body/href, and both fingerprints, returns exact `{outcome:'refreshed',delivery_id,payload_fingerprint,render_fingerprint}`, and never changes `notification_events.payload` or ownership. The worker must re-read and exact-parse the frozen-state RPC after this write before final-prepare; it never trusts its submitted refresh arguments as committed state.

Add an observation-only final boundary; do not call, replace, or copy any protected generic prepare/revalidate function:

```sql
public.prepare_registration_observation_notification_delivery_v1(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_expected_event_id uuid,
  p_expected_rule_id uuid,
  p_expected_rule_revision bigint,
  p_expected_payload_fingerprint text,
  p_expected_render_fingerprint text
) returns jsonb
```

The function may first do one bounded **non-authoritative, non-locking ID discovery** by exact delivery/event/source identity solely to obtain the IDs needed for ordered locks, including a candidate delivery channel/connection key. No discovered value may decide eligibility, target, payload, or return state. It first locks and re-reads only the channel-independent source rows in this exact common order:

```text
public.ops_registration_subject_tracks FOR SHARE
→ public.ops_registration_observations FOR SHARE
→ public.ops_registration_appointments FOR SHARE
→ public.classes FOR SHARE
→ public.class_lesson_sessions FOR SHARE, normalized authority only
→ public.teacher_catalogs then public.classroom_catalogs FOR SHARE, each in table-name then UUID order
```

From the locked track, retain `director_profile_id` as a nullable source fact only; do not make it a common prerequisite. The candidate only determines whether the earlier in-app director dependencies must be locked before the dispatch suffix:

```text
candidate in_app
  → current-director public.teacher_catalogs rows FOR SHARE in UUID order
  → public.academic_subject_settings FOR SHARE for science, when applicable
  → public.profiles FOR SHARE for the locked track's non-null current director
  → matching auth.users FOR SHARE

candidate google_chat
  → no director/profile/account/connection pre-lock

then, for either candidate
→ dashboard_private.notification_deliveries FOR UPDATE
→ dashboard_private.notification_events FOR SHARE
→ dashboard_private.notification_rules FOR SHARE
→ dashboard_private.notification_dispatch_ownership_claims FOR UPDATE

locked google_chat branch only
→ existing begin_notification_delivery_send_v1 owns the canonical
  public.google_chat_webhook_settings FOR SHARE lock/validation
```

If the locked track director is null, the in-app candidate acquires no director dependency row and later closes fail-closed; the Google Chat candidate never reads or locks `public.profiles`, `auth.users`, director-candidate catalogs, or subject-director settings. If the candidate channel differs from the later locked delivery/event/rule identity, raise `registration_observation_notification_target_lock_mismatch` with SQLSTATE `40001` and do not acquire a second branch lock out of order. The class lock intentionally precedes the normalized session lock: the real `save_class_lesson_session_v1` path first acquires its class mutation lock and only then locks `class_lesson_sessions`, so reversing that pair would introduce a deadlock. Legacy authority has no separate session row; its selected exact session is re-derived from the already locked `classes.schedule_plan`. Missing class/session/catalog facts fail the common source contract, but missing/inactive director is only an in-app target failure. This order preserves the master `track → observation → appointment` mutation order and the existing generic `delivery → event → rule → ownership → Google connection` order. In particular, final-prepare must not pre-lock `google_chat_webhook_settings`: the unchanged real begin locks delivery and ownership before that connection, so connection-first would invert the production order. No branch may lock delivery first relative to the common source rows or call a helper that silently acquires an earlier row out of order.

Under those locks, ignore every pre-read value and rebuild the current tagged `sourceRevision`, `bookingFactHash`, lifecycle/status/notification revision, selected normalized session or exact priority-normalized legacy session key, class/date/time, teacher/classroom/campus catalog facts, and nullable current track `director_profile_id`. The common source result remains valid when that director is null, missing, deleted, or banned; common validation must not call `notification_profile_is_active_v1`. Require the exact claim token and live lease; workflow `registration`; source type `registration_observation`; expected event/rule/revision; `pg_catalog.clock_timestamp()` strictly before the exact payload `delivery_expires_at`; a current enabled matching rule; current source status/revision/booking hash eligibility; a stored schema-3 observation payload whose server-recomputed canonical hash equals both stored/expected payload fingerprints; and stored title/body/href whose server-recomputed canonical render hash equals both stored/expected render fingerprints. An expiry reached under this lock closes terminal `canceled/notification_window_closed` before either channel primitive. For a first attempt it additionally requires `attempt_count=0`, `last_attempt_started_at is null`, payload snapshot plus both fingerprints present, and no ownership-scoped external-attempt audit. For a retry it requires `attempt_count>0`, non-null `last_attempt_started_at`, the same frozen payload/render fingerprints, and at least one ownership-scoped registered-attempt audit; it performs only locked read-only current eligibility checks and never refreshes payload or render content.

After the common source and dispatch locks/checks, apply target eligibility only inside the verified locked delivery channel:

- `google_chat`: before begin, require the locked rule/event/delivery tuple to have `target_kind='connection'`, `target_profile_id is null`, and exact `target_key='connection:' || connection_key`. Subject events require the canonical subject mapping. `registration.observation_feedback_submitted` requires the complete exact tuple `audience_key='executive_team'`, `channel_key='google_chat'`, `target_kind='connection'`, `target_key='connection:google_chat.executive'`, `target_profile_id is null`, `connection_key='google_chat.executive'`, and `target_snapshot={'connection_key':'google_chat.executive'}` with no extra key. `destinationTeam='executive'` is presentation metadata derived separately from `notification-google-chat-catalog.ts`, never a target-snapshot field. Do **not** evaluate or dereference the common nullable director ID, profile, account, or active predicate in this branch. Call unchanged `public.begin_notification_delivery_send_v1(p_delivery_id,p_claim_token)` while the common source and dispatch locks remain held; that primitive alone acquires and validates `public.google_chat_webhook_settings(channel='executive') FOR SHARE` in its existing delivery→ownership→connection order, including active connection state and exact webhook form. Exact-key/type validate the same delivery/claim identity and return its result with `prepared=true`. Only `status='sending'`, `channel_key='google_chat'`, and a valid dispatch token may cross to external-attempt registration. Existing `failed/connection_missing` and every `failed|canceled|skipped` result are normalized to exact `{prepared:false,delivery_id,status,status_reason}` and return terminal/provider-zero.
- `in_app`: require `target_kind='profile'`, `connection_key is null`, exact `target_snapshot={'profile_id':<locked director UUID>}` with no extra key, a non-null locked current director, and the exact current-subject predicates `dashboard_private.is_active_subject_director(<locked director>,<locked track subject>)=true` plus `dashboard_private.notification_profile_is_active_v1(<locked director>)=true` over the locked director-candidate catalog/settings, `public.profiles`, and `auth.users` facts. Target identity must equal `target_profile_id=<locked director>` plus `target_key='profile:<locked director UUID>'`. Missing/null/inactive/non-candidate/current-director mismatch closes delivery and reserved ownership atomically as exact `{prepared:false,delivery_id,status:'canceled',status_reason:'recipient_revoked'}`; never retarget in place. Additionally require first-attempt state (`attempt_count=0`, null `last_attempt_started_at`, no ownership-scoped external-attempt audit); a retry-shaped in-app claim fails closed. While the same source/rule/ownership and director eligibility facts remain locked, call existing `public.commit_notification_in_app_delivery_v1(p_delivery_id,p_claim_token)`. Exact-validate its four-key result `{delivery_id,notification_id,push_children_created,status}` and return it plus `{prepared:true,channel_key:'in_app'}` only for `status='sent'`; normalize `canceled|skipped` to the same terminal envelope. This branch returns to the worker immediately and must never call `begin_notification_delivery_send_v1`, register an external attempt, resolve a provider, or invoke transport. The existing commit primitive remains unchanged; the zero-provider fixture uses a director with no push subscriptions and requires `push_children_created=0`.
- reject every other channel for an observation source before either primitive.

The new wrapper changes neither existing primitive. Reminder payload construction sets `delivery_expires_at` to the frozen `booking.starts_at`; all other event builders set their approved delivery window. The worker compares the `expiresAt` returned by the locked read RPC with its injected clock and closes an expired delivery before refresh/final-prepare.

Before replacing the check, backfill every existing heartbeat with `counts = jsonb_build_object('observation_due',0) || counts` and assert the rewritten row count equals the prior count. Then drop/recreate the heartbeat `counts` check and forward-replace `public.record_notification_worker_heartbeat_v1` to require exactly these six keys:

```text
observation_due, fanout, rule_reconciliation, target_reconciliation, deliveries, reaped
```

Do not add a runtime flag. Existing `notification_control_plane_dispatch_registration_enabled` remains the shared notification control plane gate; observation rule enabled state is the family cutoff.

Create service-only readiness RPC:

```sql
public.get_registration_observation_google_chat_readiness_v1() returns jsonb
```

Exact top-level keys:

```text
schemaVersion, triggerInstalled, ruleCount, enabledRuleCount,
pendingCount, claimedCount, materializedCount, suppressedCount,
sourceDirtyCount, failedCount, oldestPendingAt,
latestObservationHeartbeatAt, recentObservationHeartbeat
```

The exact response parser types the last two fields as `latestObservationHeartbeatAt: string | null` and `recentObservationHeartbeat: boolean`. The RPC reads one latest `notification_worker_heartbeats` row for `worker_id='notification-worker-route-v1'` ordered by `created_at desc, id desc`; it never searches backward for an older success. `latestObservationHeartbeatAt` is that row's RFC3339 `created_at`, or null when missing. `recentObservationHeartbeat` is true only when that same latest row has `phase='succeeded'`, its counts exact-key validate the six-key shape above, and `created_at >= pg_catalog.clock_timestamp() - interval '5 minutes'`; a newer `started`/`failed` row makes it false even if an older success is current. It returns counts/timestamps only, never rendered text, student data, webhook URL, target snapshot or secret.

The frozen-state read, refresh, observation final-prepare, heartbeat, and readiness public wrappers use `security definer set search_path=''` and the exact `coalesce(auth.role(),'')='service_role'` first executable statement actor fence above. Apply these exact ACLs after every definition/redefinition:

```sql
revoke all on function public.read_registration_observation_notification_delivery_frozen_state_v1(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.refresh_registration_observation_notification_delivery_v1(uuid,uuid,uuid,uuid,bigint,text,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_registration_observation_notification_delivery_v1(uuid,uuid,uuid,uuid,bigint,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_registration_observation_google_chat_readiness_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.record_notification_worker_heartbeat_v1(text,uuid,text,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function public.read_registration_observation_notification_delivery_frozen_state_v1(uuid,uuid)
  to service_role;
grant execute on function public.refresh_registration_observation_notification_delivery_v1(uuid,uuid,uuid,uuid,bigint,text,text,text,jsonb,text,text)
  to service_role;
grant execute on function public.prepare_registration_observation_notification_delivery_v1(uuid,uuid,uuid,uuid,bigint,text,text)
  to service_role;
grant execute on function public.get_registration_observation_google_chat_readiness_v1()
  to service_role;
grant execute on function public.record_notification_worker_heartbeat_v1(text,uuid,text,jsonb,text)
  to service_role;
```

Private helpers are SECURITY INVOKER and receive no direct grant. The initial control-plane migration granted `service_role` `ALL` on both shared tables even though the production worker uses the public SECURITY DEFINER claim/begin/commit/finalize RPCs and has no direct `.schema('dashboard_private').from('notification_deliveries'|'notification_dispatch_ownership_claims')` access. Forward-reduce those inherited privileges to read-only inspection; do not grant a sequence or any direct write path:

```sql
revoke all on table dashboard_private.notification_deliveries
  from service_role;
revoke all on table dashboard_private.notification_dispatch_ownership_claims
  from service_role;
grant select on table dashboard_private.notification_deliveries
  to service_role;
grant select on table dashboard_private.notification_dispatch_ownership_claims
  to service_role;
```

Keep `PUBLIC`, `anon`, and `authenticated` at zero table privileges. Preserve the existing exact EXECUTE ACLs and byte-identical bodies of `public.claim_notification_deliveries_v1(text,integer,integer)`, `public.begin_notification_delivery_send_v1(uuid,uuid)`, `public.commit_notification_in_app_delivery_v1(uuid,uuid)`, `public.finalize_notification_delivery_v1(uuid,uuid,text,text,text,text,text,text,timestamptz)`, and `public.register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)`. Their owner-mediated DML remains the only generic production write path, so this ACL reduction must not break claim, begin, commit, retry/finalize, or ownership audit behavior. Do not add a broad cleanup RPC. Modify `scripts/verify-word-retest-expected-at-concurrency.mjs` to remove its local/preview direct delete of `notification_deliveries`: its retained SELECT may prove the expected canonical delivery count is zero, but any unexpected delivery/ownership artifact prints the exact IDs and fails closed, requiring disposal/reset of that isolated QA database. `tests/word-retest-expected-at.test.mjs` statically rejects direct INSERT/UPDATE/DELETE against either shared table.

- [ ] **Step 11: Complete pgTAP behavior and security coverage**

The Task 1 `no_plan()` assertion set must prove at least:

1. exact table/function/trigger/check/index/ACL shape;
2. all seven rules disabled and no existing rule changed;
3. scheduled at `starts_at - 3h` creates reminder, scheduled at `starts_at - 2h59m59s` creates no reminder;
4. feedback due is exactly `ends_at + 30m`;
5. duplicate domain event replay yields one job identity;
6. reschedule cancels old due and creates new revision jobs with previous/current snapshot;
7. cancel creates one canceled event and no new due;
8. attendance cancels reminder only;
9. no-show and feedback submission cancel all remaining due;
10. claim concurrency returns disjoint rows and respects batch/lease bounds;
11. claim/materialize booking drift closes `source_dirty` with zero NCP event;
12. rule disabled at source stays suppressed after later enable;
13. materialization creates one NCP event/fanout and exact replay returns the same ID;
14. stale claim token and payload key injection are rejected;
15. the frozen-state read rejects stale/expired claim or non-canonical ownership, returns only the nine exact camelCase keys, exposes event payload plus null fingerprints only on a valid first claim, and exposes the persisted frozen snapshot/fingerprints on a post-refresh first claim and retry;
16. delivery refresh is impossible after ownership-scoped external-attempt audit registration, while retry final-prepare preserves the frozen fingerprints;
17. the Google Chat final-prepare locks and validates only its exact canonical subject/executive connection target, reaches the real begin primitive and returns only a matching `sending` provider-ready result; one-at-a-time wrong `audience_key`, `connection_key`, `target_key`, non-null `target_profile_id`, wrong snapshot value, and snapshot extra-key fixtures each fail before begin with zero external-attempt audit, while the valid executive branch performs no director profile/account read;
18. the in-app final-prepare alone locks the current director profile/account, revalidates the active/current target plus the same common source/rule/ownership contract, reaches the real atomic commit primitive only when valid, creates exactly one dashboard notification, returns parent `sent` with zero push children in the no-subscription fixture, and creates no begin/external-attempt/provider evidence;
19. all source/result/reason/phone fields are absent from public source JSON;
20. customer/SOLAPI queue row counts remain exactly unchanged;
21. no `notification_audit_logs` row with `entity_kind='notification_external_attempt'` and `action='external_attempt_registered'` appears during provider-zero DB tests for either channel;
22. readiness returns only its exact aggregate keys and exact types; missing, stale succeeded, current succeeded, and a newer current failed/started heartbeat respectively yield `null/false`, timestamp/false, timestamp/true, and newest timestamp/false;
23. `EXPLAIN` uses due/lease/observation indexes with no full observation/job scan;
24. the final reason registry is the exact prior 28-reason set plus `notification_window_closed`, and the final mapping accepts `canceled/notification_window_closed` while rejecting `failed/notification_window_closed`, `retry_wait/notification_window_closed`, `canceled/retry_window_closed`, and every live `pending|claimed|sending|sent` row with a non-null reason as SQLSTATE `23514`;
25. a real expired Google Chat and a real expired in-app final-prepare each return terminal `canceled/notification_window_closed`, persist `status='canceled'`, clear `claimed_by`, `claim_token`, `lease_expires_at`, and `next_attempt_at`, and leave begin/sending, dashboard notification, ownership-scoped external-attempt audit, and provider evidence deltas exactly zero;
26. `service_role` has SELECT but no INSERT/UPDATE/DELETE privilege on each shared delivery/ownership table, and attempted direct INSERT, UPDATE, and DELETE against both tables each fail as SQLSTATE `42501`; `PUBLIC`, `anon`, and `authenticated` retain no direct privilege;
27. after that revoke/regrant, exact fixtures for `claim_notification_deliveries_v1(text,integer,integer)`, `begin_notification_delivery_send_v1(uuid,uuid)`, `commit_notification_in_app_delivery_v1(uuid,uuid)`, `finalize_notification_delivery_v1(uuid,uuid,text,text,text,text,text,text,timestamptz)`, and `register_notification_external_attempt_v1(uuid,uuid,bigint,uuid,uuid,uuid)` plus every new observation wrapper still execute successfully as `service_role` without any direct table DML;
28. dblink/two-session director and selected-session races obey the ordered lock contract and produce no deadlock, mixed source, stale target, duplicate notification, or provider attempt;
29. paired deliveries from the same `registration.observation_feedback_submitted` event prove both missing and inactive-current-director cases: in-app is absent before fanout or closes exact `canceled/recipient_revoked` at final-prepare, while the healthy locked `google_chat.executive` delivery independently reaches `sending` through the real begin primitive with external-attempt/provider count zero.

The readiness pgTAP fixture deletes only its transaction-local synthetic heartbeat rows, then covers no row, a succeeded row at `clock_timestamp()-interval '5 minutes 1 second'`, a succeeded row at `clock_timestamp()-interval '4 minutes 59 seconds'`, and finally a newer failed row over that current success. Each call exact-compares all top-level keys, `latestObservationHeartbeatAt` to the latest inserted `created_at`, and `recentObservationHeartbeat` to `false,false,true,false`; `ROLLBACK` removes the fixture.

After the named lifecycle fixtures have produced at least one enabled pending reminder and the duplicate replay lane, include these executable representative DB assertions rather than relying on the prose matrix alone:

```sql
select is_empty(
  $$
    select observation_id, notification_revision, event_key
    from dashboard_private.registration_observation_chat_jobs
    group by observation_id, notification_revision, event_key
    having count(*) <> 1
  $$,
  'every Chat job identity is unique after domain replay'
);

select throws_ok(
  $$
    update dashboard_private.registration_observation_chat_jobs
    set next_attempt_at = null
    where job_id = (
      select job_id
      from dashboard_private.registration_observation_chat_jobs
      where status = 'pending'
      order by job_id
      limit 1
    )
  $$,
  '23514',
  null,
  'pending cannot lose next_attempt_at'
);

select is(
  (select count(*)
   from dashboard_private.notification_audit_logs audit
   where audit.entity_kind = 'notification_external_attempt'
     and audit.action = 'external_attempt_registered'),
  0::bigint,
  'DB contract tests never register an external attempt'
);
```

The lifecycle section also uses `is(...)` directly after each action to assert attendance leaves exactly one current feedback_due row while cancel/no-show/feedback submission leave zero current pending/claimed due rows. Claim concurrency asserts the two returned job-ID arrays have an empty intersection; source-dirty asserts the job terminal code and zero `notification_events` delta in the same transaction. A two-session concurrency test holds a rule save against trigger/materialization, proves one transaction waits, and then proves the committed job and inserted event carry exactly one revision/template snapshot rather than a mixed revision.

Add two named `dblink` final-prepare race matrices using bounded `lock_timeout`/`statement_timeout` and explicit barrier receipts:

1. **current director A→B:** use the actual `public.assign_registration_track_director(uuid,uuid,text,text,integer,text)` path. When final-prepare locks the track first, the reassignment transaction waits; prepare may commit only the coherent A target, then B commits, yielding exactly one A inbox row and no B/mixed row. When B commits before final-prepare takes the track lock, prepare must re-read B under lock and terminal-close the stale A-target delivery as exact `canceled/recipient_revoked` with no A or B inbox, begin, or external attempt. It must never silently retarget the already materialized delivery to B.
2. **normalized selected session A→B:** B changes at least one hash-covered booking fact (schedule state, date/time, teacher, or classroom), not revision-only lesson content. When final-prepare obtains class then session locks first, `save_class_lesson_session_v1` waits and prepare may use only the complete A booking before B commits. When B commits first, final-prepare must rebuild the locked source/hash and close `canceled/source_schedule_changed` with no begin, inbox, or external attempt. The parallel legacy fixture changes the same hash-covered fact only in the selected `classes.schedule_plan` entry and proves the class lock provides the same complete-before/complete-after outcome without a phantom session lock.

Each schedule records which transaction acquired each barrier, asserts the waiter truly waited, joins both sessions, and proves zero `40P01`/timeout, no mixed A/B payload or target, one allowed terminal-or-commit outcome, and no duplicate notification. ACL tests execute every public wrapper as `anon` and `authenticated` (both `42501`), prove `service_role` execute succeeds, assert `has_table_privilege` SELECT true and INSERT/UPDATE/DELETE false for the two shared tables, and execute all six negative direct-DML cases in transaction-local exception subblocks. New job/audit tables retain their stricter no-direct-access policy; shared delivery/ownership direct SELECT is the only exception explicitly granted above.

Add a real channel-independence pgTAP matrix, not a mocked wrapper test. With one healthy locked `public.google_chat_webhook_settings(channel='executive')` row, create each fixture from one exact feedback-submitted domain event and assert the executive/in-app rows share `event_id`, source observation, occurrence, notification revision, and payload fingerprint:

1. Director null before target resolution: materialization produces the executive connection delivery only; the in-app target is unavailable rather than replaced by an arbitrary profile. Real executive final-prepare returns `prepared=true`, `channel_key='google_chat'`, `connection_key='google_chat.executive'`, `status='sending'`, the exact locked webhook, and ownership `dispatch_started`.
2. Director present/active during paired fanout, then current track director becomes null before final-prepare: in-app returns exact `{prepared:false,delivery_id,status:'canceled',status_reason:'recipient_revoked'}`, clears claim/lease, closes reserved ownership, and creates zero dashboard notification. Its paired executive delivery still returns the successful real-begin receipt above.
3. Director present/active during paired fanout, then the matching synthetic `auth.users` row becomes inactive through future `banned_until` before final-prepare: the same in-app close/executive proceed split is required. Repeat with `deleted_at` in a savepoint if the fixture factory supports it; either active predicate component must never affect executive Chat.

For every row, assert the final-prepare lock trace is common source rows → optional in-app director dependencies → delivery/event/rule/ownership → existing begin-owned Google connection lock. Put stable SQL comments `registration_observation_final_prepare_google_chat_target_begin/end` and `registration_observation_final_prepare_in_app_target_begin/end` around the two target-validation blocks; the Node migration-contract test extracts those exact segments and proves the Google block contains the exact executive tuple plus `begin_notification_delivery_send_v1` but no direct `google_chat_webhook_settings`, `public.profiles`, `auth.users`, director helper, or `director_profile_id` reference. The in-app block contains `is_active_subject_director`, `notification_profile_is_active_v1`, exact profile snapshot/current-director predicates, and no connection fallback. In-app pgTAP asserts the locked eligibility IDs equal the current track director. Across the matrix, `register_notification_external_attempt_v1`, provider/fetch, and customer/SOLAPI deltas remain zero. Roll back all synthetic account/track changes.

- [ ] **Step 12: Run clean-apply GREEN and review the isolated boundary**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-google-chat-db.test.mjs tests/registration-observation-local-db-runner.test.mjs tests/word-retest-expected-at.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus google-chat
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint scripts/run-registration-observation-local-db-qa.mjs scripts/verify-word-retest-expected-at-concurrency.mjs tests/registration-observation-google-chat-db.test.mjs tests/registration-observation-local-db-runner.test.mjs tests/word-retest-expected-at.test.mjs
node scripts/verify-supabase-migration-layout.mjs
test -s supabase/migrations/20260809105000_registration_observation_google_chat.sql
test "$(find supabase/migrations -maxdepth 1 -type f -name '*_registration_observation_google_chat.sql' | wc -l | tr -d ' ')" = "1"
git diff --check
```

Expected: isolated reset applies through `20260809105000`; `registration_observation_google_chat_test.sql` reports its emitted assertion count with 0 failed under `no_plan()`; runner reports provider capability absent and external-attempt audit count 0; Node tests and lint exit 0. The protected migration layout verifier is explicitly GREEN: no later migration references or replaces the protected generic claim/prepare/revalidate names, the reviewed target is non-empty, and no generated-name orphan remains.

- [ ] **Step 13: Inspect the exact diff and commit**

```bash
git diff -- supabase/migrations/20260809105000_registration_observation_google_chat.sql supabase/tests/registration_observation_google_chat_test.sql tests/registration-observation-google-chat-db.test.mjs scripts/verify-word-retest-expected-at-concurrency.mjs tests/word-retest-expected-at.test.mjs
git status --short
git add supabase/migrations/20260809105000_registration_observation_google_chat.sql supabase/tests/registration_observation_google_chat_test.sql tests/registration-observation-google-chat-db.test.mjs scripts/verify-word-retest-expected-at-concurrency.mjs tests/word-retest-expected-at.test.mjs
git commit -m "feat: add observation chat job contract"
```

---
### Task 2: Build the Canonical Source Reader, Payload, Routing, and Copy

**Files:**
- Create: `src/features/notifications/server/adapters/registration-observation-notification-source.ts`
- Create: `tests/notification-registration-observation.test.mjs`
- Modify: `src/features/notifications/notification-control-plane-types.ts`
- Modify: `src/features/notifications/server/adapters/registration-notification-adapter.ts`
- Modify: `src/features/notifications/server/presentation/registration-notification-presentation.ts`
- Modify: `src/features/notifications/server/notification-workflow-adapter.ts`
- Modify: `src/features/notifications/server/notification-workflow-registry.ts`
- Modify: `src/features/notifications/notification-google-chat-catalog.ts`
- Modify: `tests/registration-notification-adapter.test.mjs`
- Modify: `tests/notification-registration-presentation.test.mjs`
- Modify: `tests/notification-workflow-registry.test.mjs`

**Interfaces:**
- Consumes: service-only source RPC, claimed Chat job snapshot, exact selected session tables, existing registration notification adapter
- Produces: strict source/content reader, payload-v3 builder/parser, six-event destination matrix and Korean presentation
- Does not consume: browser destination, customer phone, sibling tracks, latest class-wide progress

- [ ] **Step 1: Write source-resolution and privacy RED tests**

```js
import assert from "node:assert/strict"
import test from "node:test"

import {
  resolveRegistrationObservationPreparation,
} from "../src/features/notifications/server/adapters/registration-observation-notification-source.ts"

test("selected session plan wins and sibling/latest sessions never leak", () => {
  const result = resolveRegistrationObservationPreparation({
    source: {
      sessionAuthority: "normalized",
      classLessonSessionId: "11111111-1111-4111-8111-111111111111",
      legacySessionKey: null,
    },
    selectedSession: {
      id: "11111111-1111-4111-8111-111111111111",
      sessionOrder: 4,
      textbookEntries: [{ textbookId: "book-1", title: "능률 VOCA", plan: "42~49쪽", memo: "단어 시험" }],
      memo: "선택 회차 메모",
      publicNote: "",
    },
    exactProgressLogs: [{ sessionId: "11111111-1111-4111-8111-111111111111", rangeLabel: "40~45쪽", publicNote: "복습" }],
    rejectedProgressLogs: [{ sessionId: "22222222-2222-4222-8222-222222222222", rangeLabel: "90~99쪽", publicNote: "다른 회차" }],
    classTextbooks: [{ id: "book-1", title: "능률 VOCA" }],
  })
  assert.deepEqual(result.textbookNames, ["능률 VOCA"])
  assert.equal(result.progressSummary, "42~49쪽 · 단어 시험")
  assert.doesNotMatch(result.progressSummary, /90~99쪽|다른 회차/)
})

test("missing exact content has one explicit fallback", () => {
  const result = resolveRegistrationObservationPreparation({
    source: { sessionAuthority: "legacy", classLessonSessionId: null, legacySessionKey: "2026-08-17|18:00" },
    selectedSession: { sessionKey: "2026-08-17|18:00", sessionOrder: 7, textbookEntries: [], memo: "", publicNote: "" },
    exactProgressLogs: [],
    rejectedProgressLogs: [],
    classTextbooks: [],
  })
  assert.deepEqual(result, { textbookNames: ["미지정"], progressSummary: "미입력" })
})
```

Export and test the exact parser used by materialization and pre-send:

```ts
export function parseRegistrationObservationChatPayloadV3(
  value: unknown,
): RegistrationObservationChatPayloadV3
```

The RED test defines one complete valid scheduled payload and executable mutations for the high-risk rejection lanes:

```js
const validScheduledPayload = Object.freeze({
  task_id: "10000000-0000-4000-8000-000000000001",
  track_id: "10000000-0000-4000-8000-000000000002",
  observation_id: "10000000-0000-4000-8000-000000000003",
  appointment_id: "10000000-0000-4000-8000-000000000004",
  appointment_notification_revision: 1,
  student_name: "청강 검증",
  subject: "영어",
  source_revision: Object.freeze({
    authority: "normalized",
    sessionId: "10000000-0000-4000-8000-000000000005",
    revision: 7,
  }),
  booking_fact_hash: "a".repeat(64),
  occurred_at: "2026-08-17T08:00:00.000Z",
  delivery_expires_at: "2026-08-18T08:00:00.000Z",
  event_kind: "registration.observation_scheduled",
  booking: Object.freeze({
    class_id: "10000000-0000-4000-8000-000000000006",
    class_name: "중2 영어 A반",
    session_authority: "normalized",
    class_lesson_session_id: "10000000-0000-4000-8000-000000000005",
    legacy_session_key: null,
    schedule_state: "active",
    starts_at: "2026-08-17T09:00:00.000Z",
    ends_at: "2026-08-17T11:00:00.000Z",
    teacher_name: "홍길동",
    classroom_name: "301호",
    campus: "본관",
  }),
  textbook_names: Object.freeze(["능률 VOCA"]),
  progress_summary: "42~49쪽 · 단어 시험",
})

assert.deepEqual(parseRegistrationObservationChatPayloadV3(validScheduledPayload), validScheduledPayload)
for (const [name, invalid] of [
  ["extra phone", { ...validScheduledPayload, phone: "01000000000" }],
  ["extra result", { ...validScheduledPayload, result: "fit" }],
  ["extra reason", { ...validScheduledPayload, reason: "private" }],
  ["missing subject", (({ subject, ...rest }) => rest)(validScheduledPayload)],
  ["malformed observation uuid", { ...validScheduledPayload, observation_id: "bad" }],
  ["malformed occurred date", { ...validScheduledPayload, occurred_at: "not-a-date" }],
  ["malformed hash", { ...validScheduledPayload, booking_fact_hash: "ABC" }],
  ["mismatched event kind", { ...validScheduledPayload, event_kind: "registration.observation_feedback_due" }],
  ["mixed session authority", {
    ...validScheduledPayload,
    booking: { ...validScheduledPayload.booking, legacy_session_key: "2026-08-17|18:00" },
  }],
  ["unsupported subject", { ...validScheduledPayload, subject: "미술" }],
]) {
  assert.throws(
    () => parseRegistrationObservationChatPayloadV3(invalid),
    /notification_registration_observation_payload_invalid/,
    name,
  )
}
```

The test file defines one valid fixture for each remaining union member and runs the same extra-key/missing-key loop over every fixture; the scheduled mutation table above is the executable representative for UUID/date/hash/event/session/subject boundaries.

- [ ] **Step 2: Write destination and copy RED tests**

```js
const subjectCases = [
  ["영어", "google_chat.english", "english"],
  ["수학", "google_chat.math", "math"],
  ["과학", "google_chat.science", "science"],
]

for (const [subject, connectionKey, destinationTeam] of subjectCases) {
  const targetSet = await adapter.resolveTargets(observationInput({
    eventKey: "registration.observation_scheduled",
    subject,
  }))
  assert.deepEqual(targetSet.targets.map((target) => ({
    targetKind: target.targetKind,
    targetKey: target.targetKey,
    targetProfileId: target.targetProfileId,
    connectionKey: target.connectionKey,
    targetSnapshot: target.targetSnapshot,
  })), [{
    targetKind: "connection",
    targetKey: `connection:${connectionKey}`,
    targetProfileId: null,
    connectionKey,
    targetSnapshot: { connection_key: connectionKey },
  }])
  assert.equal(renderObservationDestinationTeam(connectionKey), destinationTeam)
}

const executive = await adapter.resolveTargets(observationInput({
  eventKey: "registration.observation_feedback_submitted",
  subject: "영어",
  audienceKey: "executive_team",
}))
assert.deepEqual(executive.targets.map((target) => ({
  targetKind: target.targetKind,
  targetKey: target.targetKey,
  targetProfileId: target.targetProfileId,
  connectionKey: target.connectionKey,
  targetSnapshot: target.targetSnapshot,
})), [{
  targetKind: "connection",
  targetKey: "connection:google_chat.executive",
  targetProfileId: null,
  connectionKey: "google_chat.executive",
  targetSnapshot: { connection_key: "google_chat.executive" },
}])
assert.equal(renderObservationDestinationTeam("google_chat.executive"), "executive")
```

`renderObservationDestinationTeam` is a test-only read of the checked-in Google Chat catalog/presentation mapping. `destinationTeam` is never written into `target_snapshot` and never participates in target identity or its hash.

Presentation assertions:

```js
assert.match(scheduled.body, /교재 복사 등 청강 준비가 필요합니다/)
assert.match(reminder.body, /오늘 청강이 예정되어 있습니다/)
assert.match(feedbackDue.body, /청강은 어땠나요\? 적합 여부와 사유를 입력해 주세요/)
assert.match(feedbackSubmitted.body, /청강 피드백이 등록되었습니다/)
for (const forbidden of [
  "010-", "전화", "fit", "unfit", "적합", "부적합", "feedback_reason",
  "11111111-1111-4111-8111-111111111111", "https://", "/admin/",
]) assert.doesNotMatch(feedbackSubmitted.body, new RegExp(forbidden, "iu"))
```

- [ ] **Step 3: Run Task 2 RED**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/notification-registration-observation.test.mjs tests/registration-notification-adapter.test.mjs tests/notification-registration-presentation.test.mjs tests/notification-workflow-registry.test.mjs
```

Expected: source module is missing and event registry/presentation assertions fail with `ERR_MODULE_NOT_FOUND` and unsupported event errors.

- [ ] **Step 4: Implement the bounded source reader and selected-session resolver**

Export these exact interfaces:

```ts
export type RegistrationObservationPreparation = Readonly<{
  textbookNames: ReadonlyArray<string>
  progressSummary: string
}>

export type RegistrationObservationNotificationSourceReader = Readonly<{
  readSource(observationId: string): Promise<RegistrationObservationNotificationSource>
  readCurrentPreparation(source: RegistrationObservationNotificationSource): Promise<RegistrationObservationPreparation>
}>

export function resolveRegistrationObservationPreparation(
  input: RegistrationObservationPreparationInput,
): RegistrationObservationPreparation

export function createRegistrationObservationNotificationSourceReader(
  dependencies: RegistrationObservationNotificationSourceDependencies,
): RegistrationObservationNotificationSourceReader
```

`readSource` calls only `get_registration_observation_notification_source_v1` with a 5-second AbortSignal and `.retry(false)`, then exact-key parses the DTO. `readCurrentPreparation` performs bounded reads for one selected class/session only:

- normalized: exact `class_lesson_sessions.id = classLessonSessionId` and `class_id = classId`; exact session ID/order progress logs;
- legacy: one `classes.id = classId` row and only `schedule_plan.sessions[legacySessionKey]`; exact stable key/order progress logs;
- textbook catalog: only referenced IDs, stable order from selected session entries, then title and ID;
- never query another class/session and never choose the latest progress row without exact ID/order equality.

Resolver priority is exact:

1. selected session `textbookEntries[].plan` range and memo;
2. same class plus exact session ID or session order `progress_logs.range_label,public_note`;
3. selected session `memo,public_note`;
4. `미입력`.

The stored `preparation_snapshot` is the immutable presentation authority for scheduled and rescheduled. Those immediate events exact-validate and render that stored snapshot at claim/materialization and immediately before their first external attempt; a later textbook/progress edit must not rewrite their preparation copy. Reminder_due alone calls `readCurrentPreparation` for the same selected session at job claim/materialization and immediately before its first external attempt. This is the approved design §6.1 rule at line 282: immediate uses the stored snapshot, while the 3-hour reminder uses current same-session content. If the exact selected session for reminder_due is no longer readable, fail closed; never substitute its stored audit snapshot, another session or another class. Canceled, feedback_due and feedback_submitted do not read preparation content.

- [ ] **Step 5: Extend registration adapter with exact payload-v3 handling**

Add the six event keys to closed sets and route `sourceType === 'registration_observation'` through a separate branch. Export one pure builder for worker tests:

```ts
export function buildRegistrationObservationChatPayloadV3(input: Readonly<{
  job: RegistrationObservationChatJobClaim
  source: RegistrationObservationNotificationSource
  preparation: RegistrationObservationPreparation | null
}>): RegistrationObservationChatPayloadV3
```

Builder rules:

- compare job observation/appointment/revision/source/hash with source before building;
- scheduled/rescheduled require the exact stored `preparation_snapshot`; reminder_due requires a live exact-selected-session preparation read and validates its stored audit snapshot shape without using it as content fallback;
- rescheduled requires both previous/current booking snapshots;
- canceled requires canceled snapshot and lifecycle `canceled`;
- feedback_due requires `scheduled | attended_feedback_pending` and `hasFeedback=false`;
- feedback_submitted requires completed lifecycle plus exact `submission_snapshot`; never copy suitability/reason;
- every timestamp is valid ISO with `starts_at < ends_at`; hashes are lowercase SHA-256; every UUID is v1-v5 canonical.

`resolveTargets` ignores browser payload destination. Subject events map canonical payload subject to one connection target and stable target-set hash. feedback_submitted accepts only:

```text
google_chat + executive_team -> connection:google_chat.executive
in_app + track_director -> `profile:${currentDirectorProfileId}`
```

Missing/inactive director makes only the in-app target unavailable; it must not reroute the executive Chat or pick an arbitrary manager.

- [ ] **Step 6: Implement pre-send source revalidation and refresh result**

Extend `NotificationRevalidationInput` additively without changing existing adapters:

```ts
export type NotificationRevalidationEventSnapshot = Readonly<{
  payloadSchemaVersion: number
  payload: Readonly<Record<string, unknown>>
}>

export type NotificationRevalidationInput = Readonly<{
  eventId: string
  deliveryId: string
  eventKey: string
  sourceType: string
  sourceId: string
  sourceRevision: DbBigInt | null
  ruleId: string
  ruleRevision: DbBigInt
  targetGeneration: DbBigInt
  scheduledFor: string
  attemptCount: number
  target: NotificationTarget
  eventSnapshot?: NotificationRevalidationEventSnapshot
}>
```

For an observation first attempt, the worker supplies `eventSnapshot` only after it has called `read_registration_observation_notification_delivery_frozen_state_v1`, exact-validated that RPC's nine-key DTO, and matched its `snapshot` to the event payload from the existing `get_notification_render_snapshot_v1` response. The generic render snapshot is used only for immutable template/rule metadata; expiry, attempt state, payload/render fingerprints and stored title/body/href come exclusively from the locked observation read. `sourceType === "registration_observation"` requires schema version `3` and an exact payload union; every existing adapter may continue receiving/ignoring `undefined`.

Extend `NotificationRevalidationResult` additively:

```ts
| Readonly<{
    ok: true
    refreshedPayload: Readonly<Record<string, unknown>>
    payloadSchemaVersion: 3
    payloadFingerprint: string
  }>
```

Existing adapters continue returning `{ok:true}`. The worker supplies the exact `attemptCount` returned by the locked observation frozen-state RPC before the channel-aware final-prepare; observation rejects a negative/non-integer count and any disagreement with first/retry invariants. Observation `revalidateBeforeSend` calls `readSource` again and enforces:

| Event | Required current state |
|---|---|
| scheduled/rescheduled/reminder_due | observation `scheduled`, appointment `scheduled` |
| canceled | observation `canceled`, appointment `canceled` |
| feedback_due | observation `scheduled|attended_feedback_pending`, appointment `scheduled|completed`, `hasFeedback=false` |
| feedback_submitted | observation `completed`, appointment `completed`, `hasFeedback=true` |

Notification revision mismatch returns `canceled/source_revision_changed`; lifecycle mismatch returns `canceled/source_status_changed`; booking hash mismatch returns `canceled/source_schedule_changed`; rule revision/target mismatch uses existing reasons. Revalidation compares both `input.sourceRevision` (appointment notification revision) and the event payload's tagged `source_revision`/`booking_fact_hash`; it never confuses the bigint and JSON revisions. A tagged source revision change with equal booking hash is allowed. Target revalidation is channel-local: executive `connection:google_chat.executive` never tests `directorProfileId` or profile/account activity, while in-app requires the current non-null active director and returns `canceled/recipient_revoked` otherwise. Processing one paired target must not mutate or short-circuit the other.

For `attemptCount === 0`, scheduled/rescheduled rebuild with their immutable stored preparation, reminder_due resolves current exact-session preparation, and the other three events do not read preparation. All six rebuild the exact schema-3 payload with the current tagged source revision and **always** return `refreshedPayload`, `payloadSchemaVersion:3`, and the deterministic canonical payload fingerprint even if the JSON bytes did not change. This mandatory first-attempt result lets the worker persist both payload/render fingerprints before the final prepare boundary.

For `attemptCount > 0`, revalidation reads only current lifecycle/revision/hash/rule/target eligibility and returns plain `{ok:true}`. It must not call `readCurrentPreparation`, rebuild payload, return `refreshedPayload`, or change title/body/href. The worker reuses the stored schema-3 payload, title/body/href, and fingerprints from the first attempt. RED tests prove that a progress edit between a retryable 429 or 425 and the retry changes neither body nor fingerprint, while cancellation still prevents the retry. Production 408 is never a retry fixture.

Set reminder retry window to the exact `booking.starts_at`; no provider retry can cross class start.

- [ ] **Step 7: Implement strict presentation and destination validation**

Payload schema version `3` is accepted only for the six observation keys. Each union member gets exact key validation before rendering. Add presentation context keys; these are the payload-to-template boundary, so `subjects` intentionally contains the one canonical observation subject:

```text
student_name, subjects, class_name, scheduled_at, before_schedule,
teacher_name, classroom, textbooks, progress,
submitted_by_name, submitted_at
```

`scheduled_at` and `before_schedule` format one KST date and start/end time without showing raw ISO. `classroom` is the already validated `campus + " " + classroom_name`; `textbooks` joins stable names with ` · ` and displays `미지정` only for the exact empty fallback. Structured-text validators continue rejecting UUID, URL, HTML, mentions, bidi/control characters.

Destination validation is exact:

```text
scheduled/rescheduled/canceled/reminder_due/feedback_due:
  audience=subject_team, channel=google_chat,
  connection=subject-derived, destinationTeam=english|math|science

feedback_submitted Chat:
  audience=executive_team, channel=google_chat,
  connection=google_chat.executive, destinationTeam=executive

feedback_submitted inbox:
  audience=track_director, channel=in_app,
  connection=null, destinationTeam=null
```

Any cross-room combination throws `notification_registration_destination_unsupported`; it does not fall back to management.

- [ ] **Step 8: Preserve the no-backfill rule-reconciliation boundary**

The observation rules are `delivery_mode='immediate'` even for due events. `reconcileScheduledRules` must not enumerate `registration_observation` domain events or jobs. Add a test that enabling or editing an observation rule returns zero observation sources/occurrences and leaves pre-cutoff suppressed jobs terminal. Only a new domain event after enable can create a pending Chat job.

- [ ] **Step 9: Run Task 2 GREEN and commit**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/notification-registration-observation.test.mjs tests/registration-notification-adapter.test.mjs tests/notification-registration-presentation.test.mjs tests/notification-workflow-registry.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/notifications/server/adapters/registration-observation-notification-source.ts src/features/notifications/server/adapters/registration-notification-adapter.ts src/features/notifications/server/presentation/registration-notification-presentation.ts src/features/notifications/server/notification-workflow-adapter.ts src/features/notifications/server/notification-workflow-registry.ts src/features/notifications/notification-control-plane-types.ts src/features/notifications/notification-google-chat-catalog.ts tests/notification-registration-observation.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
```

Expected: all focused Node tests pass; TypeScript and ESLint exit 0; the privacy tests find zero phone/result/reason/raw-UUID body values.

```bash
git diff -- src/features/notifications/server/adapters/registration-observation-notification-source.ts src/features/notifications/server/adapters/registration-notification-adapter.ts src/features/notifications/server/presentation/registration-notification-presentation.ts src/features/notifications/server/notification-workflow-adapter.ts src/features/notifications/server/notification-workflow-registry.ts src/features/notifications/notification-control-plane-types.ts src/features/notifications/notification-google-chat-catalog.ts tests/notification-registration-observation.test.mjs tests/registration-notification-adapter.test.mjs tests/notification-registration-presentation.test.mjs tests/notification-workflow-registry.test.mjs
git add src/features/notifications/server/adapters/registration-observation-notification-source.ts src/features/notifications/server/adapters/registration-notification-adapter.ts src/features/notifications/server/presentation/registration-notification-presentation.ts src/features/notifications/server/notification-workflow-adapter.ts src/features/notifications/server/notification-workflow-registry.ts src/features/notifications/notification-control-plane-types.ts src/features/notifications/notification-google-chat-catalog.ts tests/notification-registration-observation.test.mjs tests/registration-notification-adapter.test.mjs tests/notification-registration-presentation.test.mjs tests/notification-workflow-registry.test.mjs
git commit -m "feat: render observation team notifications"
```

---

### Task 3: Close the Static and Dynamic Dashboard Link Boundary

**Files:**
- Create: `src/features/notifications/server/notification-app-deep-link.ts`
- Modify: `src/features/notifications/server/notification-worker.ts`
- Modify: `src/features/notifications/server/providers/google-chat-provider.ts`
- Modify: `src/features/notifications/server/adapters/registration-notification-adapter.ts`
- Modify: `tests/notification-google-chat-content.test.mjs`
- Modify: `tests/notification-control-plane-worker.test.mjs`
- Modify: `tests/registration-observation-teacher-route.test.mjs`

**Interfaces:**
- Produces: one shared allowlist for relative render links and absolute Google Chat buttons
- Allows: observation detail static query and assigned-teacher dynamic feedback route
- Rejects: arbitrary `/admin` descendants, external/protocol-relative URLs, malformed UUIDs, duplicate/unknown query keys, query/hash on feedback route, encoded traversal

- [ ] **Step 1: Write the exact allowlist RED matrix**

```js
const observationId = "11111111-1111-4111-8111-111111111111"
const taskId = "22222222-2222-4222-8222-222222222222"
const trackId = "33333333-3333-4333-8333-333333333333"
const appointmentId = "44444444-4444-4444-8444-444444444444"
const observationDetailUrl =
  `/admin/registration?taskId=${taskId}&trackId=${trackId}&appointmentId=${appointmentId}&observationId=${observationId}&view=calendar`

assert.equal(validateNotificationAppDeepLink(
  observationDetailUrl,
  "registration",
), observationDetailUrl)

assert.equal(validateNotificationAppDeepLink(
  `/admin/registration/observations/${observationId}/feedback`,
  "registration",
), `/admin/registration/observations/${observationId}/feedback`)

for (const rejected of [
  `/admin/registration?taskId=${taskId}&trackId=${trackId}&observationId=${observationId}&view=calendar`,
  `/admin/registration?taskId=${taskId}&appointmentId=${appointmentId}&observationId=${observationId}&view=calendar`,
  `/admin/registration?trackId=${trackId}&appointmentId=${appointmentId}&observationId=${observationId}&view=calendar`,
  `/admin/registration?taskId=${taskId}&trackId=${trackId}&appointmentId=${appointmentId}&observationId=${observationId}`,
  `/admin/registration?taskId=${taskId}&trackId=${trackId}&appointmentId=${appointmentId}&observationId=${observationId}&view=list`,
  `/admin/registration?taskId=${taskId}&trackId=${trackId}&appointmentId=${appointmentId}&observationId=${observationId}&view=`,
  `/admin/registration?taskId=${taskId}&trackId=${trackId}&appointmentId=${appointmentId}&observationId=${observationId}&view=calendar&extra=1`,
  `/admin/registration?taskId=${taskId}&taskId=${taskId}&trackId=${trackId}&appointmentId=${appointmentId}&observationId=${observationId}&view=calendar`,
  `/admin/registration?taskId=${taskId}&trackId=${trackId}&trackId=${trackId}&appointmentId=${appointmentId}&observationId=${observationId}&view=calendar`,
  `/admin/registration?taskId=${taskId}&trackId=${trackId}&appointmentId=${appointmentId}&appointmentId=${appointmentId}&observationId=${observationId}&view=calendar`,
  `/admin/registration?taskId=${taskId}&trackId=${trackId}&appointmentId=${appointmentId}&observationId=${observationId}&observationId=${observationId}&view=calendar`,
  `/admin/registration?taskId=${taskId}&trackId=${trackId}&appointmentId=${appointmentId}&observationId=${observationId}&view=calendar&view=calendar`,
  `/admin/registration?taskId=not-a-uuid&trackId=${trackId}&appointmentId=${appointmentId}&observationId=${observationId}&view=calendar`,
  `/admin/registration?taskId=${taskId}&trackId=not-a-uuid&appointmentId=${appointmentId}&observationId=${observationId}&view=calendar`,
  `/admin/registration?taskId=${taskId}&trackId=${trackId}&appointmentId=not-a-uuid&observationId=${observationId}&view=calendar`,
  `/admin/registration?taskId=${taskId}&trackId=${trackId}&appointmentId=${appointmentId}&observationId=not-a-uuid&view=calendar`,
  `${observationDetailUrl}#calendar`,
  `/admin/registration/observations/${observationId}/feedback?taskId=${taskId}`,
  `/admin/registration/observations/${observationId}/feedback#result`,
  "/admin/registration/observations/not-a-uuid/feedback",
  "/admin/registration/%2e%2e/tasks",
  "https://evil.example/admin/registration",
  "//evil.example/admin/registration",
]) assert.throws(() => validateNotificationAppDeepLink(rejected, "registration"))
```

Card button assertions:

```js
assert.equal(observationDetailCard.cardsV2[0].card.sections[0].widgets[1].buttonList.buttons[0].text, "청강 상세 보기")
assert.equal(feedbackCard.cardsV2[0].card.sections[0].widgets[1].buttonList.buttons[0].text, "피드백 입력")
assert.equal(taskCard.cardsV2[0].card.sections[0].widgets[1].buttonList.buttons[0].text, "대시보드에서 보기")
```

- [ ] **Step 2: Run Task 3 RED**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/notification-google-chat-content.test.mjs tests/notification-control-plane-worker.test.mjs tests/registration-observation-teacher-route.test.mjs
```

Expected: shared module import fails or the exact five-key observation tuple/dynamic feedback route is rejected; button text remains `대시보드에서 보기`.

- [ ] **Step 3: Implement one shared deep-link policy**

Export exact functions:

```ts
export type NotificationAppLink = Readonly<{
  relativeUrl: string
  absoluteUrl: string
  buttonText: "대시보드에서 보기" | "청강 상세 보기" | "피드백 입력"
}>

export function validateNotificationAppDeepLink(
  value: unknown,
  workflowKey: NotificationWorkflowKey,
): string

export function buildNotificationAppLink(
  value: unknown,
  workflowKey: NotificationWorkflowKey,
): NotificationAppLink
```

Retain every existing static path/query policy, then extend only registration:

```ts
const STATIC_QUERY_KEYS = Object.freeze({
  "/admin/tasks": new Set(["taskId", "focus"]),
  "/admin/word-retests": new Set(["taskId"]),
  "/admin/registration": new Set(["taskId", "trackId", "appointmentId", "observationId", "view"]),
  "/admin/transfer": new Set(["flow", "taskId"]),
  "/admin/withdrawal": new Set(["flow", "taskId"]),
  "/admin/makeup-requests": new Set(["request"]),
  "/admin/approvals": new Set(["approvalId"]),
})

const REGISTRATION_OBSERVATION_FEEDBACK_PATH =
  /^\/admin\/registration\/observations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/feedback$/iu
```

To avoid breaking existing appointment notification links, a registration static URL without `observationId` retains its current route-specific checks and generic button. Once `observationId` is present, however, validation is fail-closed: the query must contain exactly one each of `taskId`, `trackId`, `appointmentId`, `observationId`, and `view`, no other key; all four ID values must be canonical UUIDs; and `view` must equal the literal `calendar`. Missing, duplicate, empty, malformed, or extra tuple members, any other `view`, and a fragment are rejected without downgrading to the generic registration page or an appointment-only fallback. Adapter output preserves the approved key order `taskId,trackId,appointmentId,observationId,view=calendar`; validator acceptance is order-independent. Existing non-observation static keys retain their current nonempty/control-free route-specific checks. Control/bidi, username/password, encoded separator/traversal are rejected. Dynamic feedback route permits no search/hash.

Button text derives only from the validated route:

```text
registration static route + exact five-key observation tuple -> 청강 상세 보기
registration observation feedback dynamic route -> 피드백 입력
everything else -> 대시보드에서 보기
```

The provider imports this module; it no longer maintains a second allowlist. Extend the current `GoogleChatBegunDeliveryContext` with `workflow_key: NotificationWorkflowKey`. The existing `begin_notification_delivery_send_v1` response stays byte-for-byte unchanged. For **every** Google Chat delivery, the worker uses one helper to synthesize provider context as `{...begun, workflow_key: requiredWorkflowKey(claim.workflow_key)}`; the observation final-prepare lane uses that same helper rather than a special provider shape. The provider passes that value to `buildNotificationAppLink` and rejects a missing/mismatched workflow key. RED/GREEN worker/provider tests cover one existing non-observation workflow plus `registration`, and prove a forged `task` workflow cannot approve an observation route. `buildGoogleChatCardPayload` still rejects any URL in title/body, escapes card text, enforces 32KB, and sends only the validated button URL.

- [ ] **Step 4: Build exact observation links in the adapter**

For scheduled/rescheduled/canceled/reminder_due and both feedback_submitted targets:

```ts
`/admin/registration?taskId=${taskId}&trackId=${trackId}&appointmentId=${appointmentId}&observationId=${observationId}&view=calendar`
```

For feedback_due:

```ts
`/admin/registration/observations/${observationId}/feedback`
```

The adapter builds the exact four IDs from strict payload facts, never from browser `href`; no target may omit or substitute the event's canonical `appointmentId`. The generic worker uses the same shared validator before storing rendered delivery; provider validates again before webhook transport. RED/GREEN assertions cover the exact approved five-key tuple for every observation-detail event and prove every missing/duplicate/invalid member, non-`calendar` view, extra key, and fallback attempt fails before storage or transport.

- [ ] **Step 5: Run Task 3 GREEN and commit**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/notification-google-chat-content.test.mjs tests/notification-control-plane-worker.test.mjs tests/registration-observation-teacher-route.test.mjs tests/notification-registration-observation.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/notifications/server/notification-app-deep-link.ts src/features/notifications/server/notification-worker.ts src/features/notifications/server/providers/google-chat-provider.ts src/features/notifications/server/adapters/registration-notification-adapter.ts tests/notification-google-chat-content.test.mjs tests/registration-observation-teacher-route.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
```

Expected: every allow/reject case passes; all three button labels match; raw URL and UUID remain absent from rendered bodies.

```bash
git add src/features/notifications/server/notification-app-deep-link.ts src/features/notifications/server/notification-worker.ts src/features/notifications/server/providers/google-chat-provider.ts src/features/notifications/server/adapters/registration-notification-adapter.ts tests/notification-google-chat-content.test.mjs tests/notification-control-plane-worker.test.mjs tests/registration-observation-teacher-route.test.mjs
git commit -m "feat: secure observation chat links"
```

---

### Task 4: Register Seven Content Identities and Golden Cards

**Files:**
- Modify: `src/features/notifications/notification-content-contract-registry.ts`
- Modify: `src/features/notifications/notification-content-manifest.ts`
- Modify: `tests/notification-content-contract.test.mjs`
- Modify: `tests/notification-content-contract-db.test.mjs`
- Modify: `tests/notification-content-manifest.test.mjs`
- Modify: `tests/fixtures/notification-content-contracts.json`
- Modify: `tests/fixtures/notification-content-coverage-manifest.json`
- Modify: `tests/fixtures/notification-content-golden.json`
- Modify: `supabase/tests/registration_observation_google_chat_test.sql`

**Interfaces:**
- Consumes: seven migration-seeded rule/template identities and payload schema version 3
- Produces: TS/DB/fixture parity against the current `NotificationContentContract`, deterministic Korean golden output, and separate executable PII/link assertions

- [ ] **Step 1: Add manifest parity RED assertions**

```js
const expected = [
  "registration.observation_scheduled|subject_team|google_chat",
  "registration.observation_rescheduled|subject_team|google_chat",
  "registration.observation_canceled|subject_team|google_chat",
  "registration.observation_reminder_due|subject_team|google_chat",
  "registration.observation_feedback_due|subject_team|google_chat",
  "registration.observation_feedback_submitted|executive_team|google_chat",
  "registration.observation_feedback_submitted|track_director|in_app",
]

for (const identity of expected) {
  assert.equal(contractIdentities.has(identity), true, `missing contract ${identity}`)
  assert.equal(manifestIdentities.has(identity), true, `missing manifest ${identity}`)
  assert.equal(goldenIdentities.has(identity), true, `missing golden ${identity}`)
}
```

For all seven contracts assert only fields that exist in the current repository `NotificationContentContract`:

```js
assert.equal(contract.contractVersion, "1")
assert.deepEqual(contract.supportedPayloadVersions, [3])
assert.deepEqual(contract.destinationPolicy.allowedConnectionKeys, expectedConnectionKeys)
assert.equal(contract.destinationPolicy.subjectScoped, expectedSubjectScoped)
assert.equal(contract.availableVariables.some(({ key }) => [
  "phone", "school", "inquiry", "suitability", "feedback_result",
  "feedback_reason", "url", "uuid",
].includes(key)), false)
assert.equal(Array.isArray(contract.requiredTokens), true)
assert.equal(Array.isArray(contract.optionalLineTokens), true)
assert.equal(Array.isArray(contract.mustHaveFacts), true)
assert.equal(typeof contract.freeTextVisibility, "object")
assert.equal(Array.isArray(contract.freeTextPriority), true)
assert.equal(typeof contract.fieldPresence, "object")
```

Keep the contract exact to the current interface above: payload version support is represented by `supportedPayloadVersions`, while raw-link and private-field prohibitions stay executable in the shared deep-link tests and golden body assertions rather than invented contract fields.

- [ ] **Step 2: Run Task 4 RED**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/notification-content-contract.test.mjs tests/notification-content-contract-db.test.mjs tests/notification-content-manifest.test.mjs
```

Expected: the first missing observation identity fails; DB migration/template counts and fixture identities differ.

- [ ] **Step 3: Add exact contract entries**

Each entry declares:

- workflow `registration`, contract version `1`, `supportedPayloadVersions:[3]`, renderer `registration` in the surrounding registry/manifest identity;
- exact event/audience/channel/rule variant identity;
- allowed destination: subject connection set for five subject events, executive only for feedback Chat, profile target only for director inbox;
- required/optional presentation-variable key set matching the Korean token mapping and event union;
- button policy: `청강 상세 보기` only for the exact `taskId,trackId,appointmentId,observationId,view=calendar` tuple, except feedback_due `피드백 입력`; in-app uses the same validated detail href without a Google Chat button;
- forbidden body classes: phone, school, inquiry, suitability, feedback reason, UUID, URL, mention, HTML/control/bidi;
- deterministic fixture IDs and KST clock.

Golden fixtures use these stable values:

```json
{
  "student_name": "청강 테스트",
  "subject": "영어",
  "class_name": "중2 영어 A반",
  "starts_at": "2026-08-17T09:00:00.000Z",
  "ends_at": "2026-08-17T11:00:00.000Z",
  "teacher_name": "홍길동",
  "classroom_name": "301호",
  "campus": "본관",
  "textbook_names": ["능률 VOCA"],
  "progress_summary": "42~49쪽 · 단어 시험",
  "submitted_by_name": "홍길동",
  "submitted_at": "2026-08-17T11:05:00.000Z"
}
```

Expected KST display is `2026년 8월 17일 월요일 오후 6:00–8:00`. Fixtures may contain UUIDs only in private payload/deep-link metadata; title/body golden strings cannot contain them.

- [ ] **Step 4: Add DB/TS exact parity pgTAP**

Keep the focused pgTAP on `select no_plan()` and add the executable DB-side parity assertions comparing seven `(event_key,audience_key,channel_key,rule_variant_key,payload_schema_version,checksum)` rows with fixture identities and validating the Korean token map. At minimum include these representative assertions in addition to one exact row assertion for each of the seven identities:

```sql
select is(
  (
    select count(*)
    from dashboard_private.notification_rules rule_row
    where rule_row.workflow_key = 'registration'
      and rule_row.event_key like 'registration.observation_%'
  ),
  7::bigint,
  'exactly seven observation destination rules are installed'
);

select is_empty(
  $$
    select variable.item ->> 'key'
    from dashboard_private.notification_templates template_row
    join dashboard_private.notification_rules rule_row
      on rule_row.id = template_row.rule_id
    cross join lateral pg_catalog.jsonb_array_elements(template_row.allowed_variables) variable(item)
    where rule_row.workflow_key = 'registration'
      and rule_row.event_key like 'registration.observation_%'
      and variable.item ->> 'key' in ('phone','school','suitability','feedback_reason','url','uuid')
  $$,
  'observation templates expose no forbidden variable key'
);

select is_empty(
  $$
    select variable.item ->> 'key'
    from dashboard_private.notification_templates template_row
    join dashboard_private.notification_rules rule_row
      on rule_row.id = template_row.rule_id
    cross join lateral pg_catalog.jsonb_array_elements(template_row.allowed_variables) variable(item)
    where rule_row.workflow_key = 'registration'
      and rule_row.event_key = 'registration.observation_feedback_submitted'
      and variable.item ->> 'key' in ('suitability','feedback_reason','result','reason')
  $$,
  'feedback submitted exposes no result or reason token'
);
```

`finish()` reports the actual count; no fixed total is maintained.

- [ ] **Step 5: Run Task 4 GREEN, clean DB parity and commit**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/notification-content-contract.test.mjs tests/notification-content-contract-db.test.mjs tests/notification-content-manifest.test.mjs tests/notification-registration-observation.test.mjs tests/notification-registration-presentation.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus google-chat
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/notifications/notification-content-contract-registry.ts src/features/notifications/notification-content-manifest.ts tests/notification-content-contract.test.mjs tests/notification-content-manifest.test.mjs
git diff --check
```

Expected: seven-way TS/DB/manifest/golden parity passes; focused pgTAP has zero failed assertions; provider attempts remain 0.

```bash
git add src/features/notifications/notification-content-contract-registry.ts src/features/notifications/notification-content-manifest.ts tests/notification-content-contract.test.mjs tests/notification-content-contract-db.test.mjs tests/notification-content-manifest.test.mjs tests/fixtures/notification-content-contracts.json tests/fixtures/notification-content-coverage-manifest.json tests/fixtures/notification-content-golden.json supabase/tests/registration_observation_google_chat_test.sql
git commit -m "test: register observation chat content"
```

---

### Task 5: Integrate Due Jobs into the Existing Worker and Scheduler

**Files:**
- Modify: `src/features/notifications/server/notification-worker.ts`
- Modify: `src/features/notifications/server/notification-workflow-adapter.ts`
- Modify: `src/app/api/notifications/worker/route.ts`
- Modify: `tests/notification-control-plane-worker.test.mjs`
- Modify: `tests/notification-operations.test.mjs`

**Interfaces:**
- Consumes: Task 1 claim/finish/reap/materialize/claim-token frozen-state read/first-attempt-refresh/channel-aware observation-final-prepare RPCs, Task 2 source/payload builder, Task 3 shared links and Task 4 content identities
- Produces: one additive `observationDue` worker stage/count; an exported production seam that stops after observation final-prepare; first-attempt refresh plus retry-frozen rendering; an in-app completion branch that never enters external dispatch
- Reuses unchanged: `POST /api/notifications/worker`, bearer secret, worker ID, one-minute `tips-notification-worker-v1` schedule, existing Google Chat provider transport

- [ ] **Step 1: Write the worker-order RED test**

```js
const calls = []
const worker = createNotificationWorkerRuntime({
  createRunId: () => "11111111-1111-4111-8111-111111111111",
  getAdapter: () => observationAdapter,
  getProvider: () => fakeProvider,
  rpc: async (name, parameters) => {
    calls.push([name, parameters])
    if (name === "reap_registration_observation_chat_job_leases_v1") return { reaped_count: 0, failed_count: 0 }
    if (name === "claim_registration_observation_chat_jobs_v1") return [observationReminderClaim]
    if (name === "materialize_registration_observation_chat_job_v1") return { outcome: "materialized", event_id: observationEventId }
    return notificationControlPlaneRpcFixture(name, parameters)
  },
})

const counts = await worker.runBatch({ workerId: "notification-worker-route-v1", batchSize: 50, leaseSeconds: 60 })
assert.equal(counts.observationDue, 1)
assert.ok(calls.findIndex(([name]) => name === "claim_registration_observation_chat_jobs_v1") < calls.findIndex(([name]) => name === "claim_notification_fanout_jobs_v1"))
assert.equal(providerCalls.length, 1)
```

The test-local `runObservationWorkerLane` helper constructs the same `createNotificationWorkerRuntime` fixture above and returns exact `{finishDispositions,ncpEventCount,providerCalls}`. Add these executable representative assertions so every important terminal/retry lane is observable:

```js
for (const lane of [
  {
    name: "source reader transient",
    input: { sourceReadError: new Error("registration_observation_source_timeout") },
    finish: ["retry"],
  },
  {
    name: "payload invalid",
    input: { claim: { ...observationReminderClaim, event_key: "invalid" } },
    finish: ["failed"],
  },
  {
    name: "materialize source dirty",
    input: { materializeResult: { outcome: "source_dirty", error_code: "source_schedule_changed" } },
    finish: [],
  },
  {
    name: "expired reminder",
    input: { now: "2026-08-17T09:00:00.000Z", expiresAt: "2026-08-17T09:00:00.000Z" },
    finish: ["canceled"],
  },
  {
    name: "rule snapshot changed",
    input: { materializeResult: { outcome: "suppressed", error_code: "rule_revision_changed" } },
    finish: [],
  },
]) {
  const result = await runObservationWorkerLane(lane.input)
  assert.deepEqual(result.finishDispositions, lane.finish, lane.name)
  assert.equal(result.ncpEventCount, 0, lane.name)
  assert.equal(result.providerCalls, 0, lane.name)
}

const replay = await runObservationWorkerLane({ runCount: 2, materializeReplay: true })
assert.equal(replay.ncpEventCount, 1)
assert.equal(replay.providerCalls, 1)
```

- [ ] **Step 2: Write refresh-before-provider RED**

Fixture the session source revision changing from normalized revision `7` to `8` while booking hash stays equal and progress changes from `42~49쪽` to `50~57쪽`.

```js
assert.deepEqual(revalidation, {
  ok: true,
  refreshedPayload,
  payloadSchemaVersion: 3,
  payloadFingerprint: createHash("sha256").update(canonicalJson(refreshedPayload)).digest("hex"),
})
assert.match(refreshedDelivery.rendered_body, /50~57쪽/)
assert.doesNotMatch(refreshedDelivery.rendered_body, /42~49쪽/)
assert.ok(calls.findIndex(([name]) => name === "read_registration_observation_notification_delivery_frozen_state_v1") < calls.findIndex(([name]) => name === "get_notification_render_snapshot_v1"))
assert.ok(calls.findIndex(([name]) => name === "get_notification_render_snapshot_v1") < calls.findIndex(([name]) => name === "refresh_registration_observation_notification_delivery_v1"))
assert.equal(calls.filter(([name]) => name === "read_registration_observation_notification_delivery_frozen_state_v1").length, 2)
assert.ok(calls.findLastIndex(([name]) => name === "read_registration_observation_notification_delivery_frozen_state_v1") < calls.findIndex(([name]) => name === "prepare_registration_observation_notification_delivery_v1"))
assert.ok(calls.findIndex(([name]) => name === "prepare_registration_observation_notification_delivery_v1") < calls.findIndex(([name]) => name === "register_notification_external_attempt_v1"))
```

Use the same fixture with `event_key="registration.observation_scheduled"`, stored preparation `42~49쪽`, and current exact-session progress `50~57쪽`; the immediate event must retain the stored snapshot and make no preparation resolver call:

```js
const scheduledResult = await runObservationWorkerLane({
  eventKey: "registration.observation_scheduled",
  storedPreparation: { textbookNames: ["능률 VOCA"], progressSummary: "42~49쪽 · 단어 시험" },
  currentPreparation: { textbookNames: ["능률 VOCA"], progressSummary: "50~57쪽" },
})
assert.match(scheduledResult.renderedBody, /42~49쪽/)
assert.doesNotMatch(scheduledResult.renderedBody, /50~57쪽/)
assert.equal(scheduledResult.preparationReadCalls, 0)
```

A changed booking hash must return `canceled/source_schedule_changed` after the locked frozen-state read, call neither refresh nor final-prepare, and keep provider count 0. Preserve and assert the production provider construction with exact `createGoogleChatProvider({fetch,http408Disposition:'delivery_unknown'})`; an observation production fixture may never omit that option. Add this explicit two-run matrix:

| First provider result | First persisted result | Second run | Frozen retry proof |
|---|---|---|---|
| HTTP 429 | `retry_wait/provider_rate_limited`, bounded non-null `nextAttemptAt` | exactly one retry and total provider calls `2`, then `200/sent` | second run frozen-state read `1`; generic render snapshot, refresh, render and preparation reads `0`; payload/render fingerprints and title/body/href byte-identical |
| HTTP 425 | `retry_wait/transient_pre_dispatch_failure`, bounded non-null `nextAttemptAt` | exactly one retry and total provider calls `2`, then `200/sent` | same frozen-only assertions as 429 |
| canonical HTTP 408 | `delivery_unknown/provider_ambiguous_response`, response code exactly `"408"`, `nextAttemptAt:null` | total provider calls remains `1`; retry claim and observation final-prepare calls `0` | no retry snapshot exists or is consumed |
| timeout, reset, or 5xx | existing terminal `delivery_unknown` reason, `nextAttemptAt:null` | total provider calls remains `1`; retry claim and final-prepare calls `0` | no automatic second send |

Run the 429 and 425 cases with a progress edit between attempts and assert the exact first-attempt frozen payload/render still sends. Keep the existing optionless legacy Google Chat 408-retry unit test unchanged, but label it non-observation/non-production so it cannot satisfy this matrix. The production observation 408 test must use the explicit option and fail if a second provider call occurs.

Add a paired `registration.observation_feedback_submitted` in-app fixture whose final-prepare mock returns exact `{prepared:true,channel_key:'in_app',delivery_id,notification_id,push_children_created:0,status:'sent'}`. It must call the frozen-state read twice around first-attempt refresh and final-prepare once, then return immediately with `register_notification_external_attempt_v1` calls `0`, provider resolution calls `0`, and provider sends `0`. A separate Google Chat fixture still proves the provider-ready branch alone registers one attempt and calls the injected fake provider once. Task 1 pgTAP—not a worker mock—proves that these final-prepare branches reach the real begin/commit primitives.

Add a second paired worker fixture whose two claims share the exact feedback-submitted event/source/revision/fingerprint and whose source reader returns the same nullable director fact for both. Run it once with `directorProfileId:null` and once with the former director marked inactive after fanout. The in-app final-prepare result is exact `{prepared:false,delivery_id,status:'canceled',status_reason:'recipient_revoked'}` and that lane performs zero commit, provider resolution, attempt registration, or send. The executive claim must still pass common source revalidation, final-prepare as exact `connection:google_chat.executive`, and become provider-ready; only that executive lane may register one attempt and invoke the injected fake provider once. Assert the in-app outcome cannot short-circuit, cancel, or mutate the executive claim, and assert no fallback profile/management connection is resolved. The provider-zero integration below repeats this split against the real DB boundary while stopping the executive lane before attempt registration.

- [ ] **Step 3: Run Task 5 RED**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/notification-control-plane-worker.test.mjs tests/notification-operations.test.mjs tests/notification-registration-observation.test.mjs
```

Expected: `observationDue` is missing; Chat claim/reap/materialize RPCs are never called; locked-read/refresh ordering and in-app no-provider assertions fail.

- [ ] **Step 4: Add the Chat job stage before generic fanout**

Extend worker counts additively:

```ts
export type NotificationWorkerCounts = Readonly<{
  observationDue: number
  fanout: number
  ruleReconciliation: number
  targetReconciliation: number
  deliveries: number
  reaped: number
}>
```

`countsForRpc` maps it to `observation_due`. The exact batch order is:

```text
1. record started heartbeat
2. reap expired observation Chat leases
3. claim/materialize due observation Chat jobs
4. claim/process generic event fanout
5. claim/process rule reconciliation
6. claim/process target reconciliation
7. reap generic notification leases
8. claim/revalidate/dispatch deliveries
9. record succeeded heartbeat
```

`counts.reaped` is the sum of Chat `reaped_count + failed_count` and generic `reaped_count`; `counts.observationDue` increments once per claimed Chat job regardless of terminal outcome.

Implement `processRegistrationObservationChatJob`:

1. exact-validate claim envelope;
2. call source reader;
3. for scheduled/rescheduled use the exact stored `preparation_snapshot`; for reminder_due read the latest exact selected-session preparation; for canceled/feedback_due/feedback_submitted pass null;
4. build payload v3;
5. call `materialize_registration_observation_chat_job_v1`;
6. on transient source/RPC error call `finish... retry` with bounded exponential 30s, 60s, 120s, 240s, 480s and never past `expires_at`;
7. on payload/render contract error call `finish... failed/payload_schema_unsupported`;
8. never call a provider from this method.

One worker batch can materialize, fanout and deliver the new event, but each stage remains a separate DB receipt.

- [ ] **Step 5: Export the real observation pre-dispatch seam and freeze retries**

Export the production function used by `processDelivery`; the provider-zero harness imports this function rather than a test-local imitation:

```ts
export async function prepareRegistrationObservationDeliveryForDispatch(
  input: RegistrationObservationDeliveryPrepareInput,
): Promise<RegistrationObservationDeliveryPrepareResult>
```

Its closed result union is provider-ready Google Chat, atomically committed in-app, or terminal. A provider-ready result is the exact begun delivery returned by `prepare_registration_observation_notification_delivery_v1`, augmented only in the worker with `workflow_key: requiredWorkflowKey(claim.workflow_key)`. An in-app result exact-validates its notification ID/status and contains no dispatch token/provider context. A terminal result carries the DB outcome/reason. The function never calls `register_notification_external_attempt_v1` or a provider; `processDelivery` owns those later steps only for the provider-ready Google Chat variant. Existing non-observation deliveries preserve their current query count and flow.

For every `source_type='registration_observation'` claim, ignore generic-claim fields as a source of expiry/frozen render state and first call `read_registration_observation_notification_delivery_frozen_state_v1(deliveryId,claimToken)`. Exact-key parse the nine-key DTO, require its `attemptCount` agrees with the claim only as an integrity check, and branch exclusively on the DTO's `attemptCount/lastAttemptStartedAt` pair.

For a first attempt (`attemptCount===0`, `lastAttemptStartedAt===null`), the seam:

1. require `expiresAt` is still in the future and both fingerprints are null; close expired deliveries before any render/refresh/final-prepare;
2. call existing `get_notification_render_snapshot_v1(eventId,ruleId,ruleRevision)` once only to obtain immutable event/template/rule metadata;
3. exact-validate event ID/key/source/revision and rule ID/revision against the claim, schema version `3`, the event-specific payload union, and byte-for-byte equality between its payload and the locked DTO `snapshot`;
4. retain the immutable template and pass only `{payloadSchemaVersion,payload: frozenState.snapshot}` as `eventSnapshot` to the adapter;
5. call `revalidateBeforeSend` with `attemptCount:0`; it always returns a schema-3 payload/fingerprint, retaining stored preparation for scheduled/rescheduled and reading current exact-session content only for reminder_due;
6. use the retained immutable template and current claimed target, substituting only the adapter-returned schema-3 payload;
7. run the same requested-key filter, presentation, shared deep-link validation and render limits; compute canonical payload SHA-256 and canonical `{title,body,href}` SHA-256;
8. persist the exact schema-3 payload snapshot, render, and both fingerprints through `refresh_registration_observation_notification_delivery_v1` even when payload bytes are unchanged;
9. call the frozen-state read a second time and require its exact snapshot/fingerprints/title/body/href equal the just-rendered values while expiry/attempt state remain valid;
10. call `prepare_registration_observation_notification_delivery_v1`, which repeats common locks/checks and dispatches by locked channel;
11. if it returns provider-ready Google Chat, exact-validate the begun result, synthesize its `workflow_key` from the already validated claim, and return without attempt registration/provider transport; if it returns in-app `sent`, exact-validate `notification_id`, require no dispatch token, and return the committed variant; otherwise return terminal.

For a retry (`attemptCount>0`, non-null `lastAttemptStartedAt`), the seam exact-parses `snapshot`, fingerprints, title/body/href and expiry only from the single locked frozen-state RPC result. It calls `revalidateBeforeSend` with that frozen snapshot and exact attempt count for read-only eligibility and requires plain `{ok:true}`. It makes no current-preparation read, generic render-snapshot call, render, or refresh RPC; it passes the DTO's two frozen fingerprints to observation final-prepare. Only HTTP 429 (`provider_rate_limited`) and HTTP 425 (`transient_pre_dispatch_failure`) unambiguously establish non-acceptance and may create observation retry state. Because Production constructs the provider with `http408Disposition:'delivery_unknown'`, HTTP 408 is terminal `delivery_unknown/provider_ambiguous_response`; timeout, reset, and 5xx are likewise terminal unknown and never receive a second provider attempt. Preserve the optionless legacy 408 retry default without using it in this observation path.

If frozen read, refresh, or final-prepare says source/rule/target changed, finalize the claimed delivery without attempt registration and keep provider count 0. Never mutate `notification_events.payload`. After a provider-ready Google Chat return, and only then, `processDelivery` registers the attempt through `register_notification_external_attempt_v1` (which writes the ownership-scoped `notification_audit_logs` contract) and invokes the provider. An in-app committed/terminal return exits before provider lookup, attempt registration and transport, so this branch's external attempt/provider count is exactly zero.

- [ ] **Step 6: Preserve the API and scheduler boundary**

`POST /api/notifications/worker` keeps:

```text
runtime=nodejs
dynamic=force-dynamic
Authorization is `Bearer ` followed by the value read from `NOTIFICATION_WORKER_SECRET`.
workerId=notification-worker-route-v1
batch 1..100 default 50
lease 30..300 default 60
X-Notification-Contract-Version=2
```

This is an additive count field and keeps contract version 2 so the already installed scheduler/Vault invocation remains compatible. The JSON response adds `counts.observationDue`; authorization/error status behavior is unchanged.

No new Vercel cron, pg_cron job, secret or route is created. `tests/notification-operations.test.mjs` must assert:

```js
assert.deepEqual(NOTIFICATION_SCHEDULE_NAMES, [
  "tips-notification-worker-v1",
  "tips-notification-cutover-watchdog-v1",
])
assert.match(workerSchedule, /\* \* \* \* \*/)
assert.equal(source.includes("tips-registration-observation-worker"), false)
assert.equal(vercelJson.crons?.length || 0, 0)
```

The existing schedule is an activation prerequisite, not something this feature silently installs. Operational inspect uses the existing guarded tool:

```bash
node --experimental-strip-types scripts/manage-notification-worker-schedule.mjs --mode inspect
```

Expected dry-run output: `실행:false`, schedule names exactly the existing two, and SQL only `dashboard_private.inspect_notification_schedules_v1()`; no mutation occurs. Production activation separately runs the authorized read-only inspect RPC and requires one active one-minute worker plus a successful heartbeat containing `observation_due` within 5 minutes. Missing schedule/heartbeat blocks activation; it does not authorize install/disable/remove.

- [ ] **Step 7: Run Task 5 GREEN, focused DB regression and commit**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/notification-control-plane-worker.test.mjs tests/notification-operations.test.mjs tests/notification-registration-observation.test.mjs tests/registration-notification-adapter.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus google-chat
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/notifications/server/notification-worker.ts src/features/notifications/server/notification-workflow-adapter.ts src/app/api/notifications/worker/route.ts tests/notification-control-plane-worker.test.mjs tests/notification-operations.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
```

Expected: exact stage ordering, first read/refresh/second read before channel-aware final-prepare, retry's single frozen read, in-app atomic commit/provider-zero, heartbeat six-key shape, unchanged scheduler contract and focused pgTAP all pass; unknown/timeout is terminal with no automatic second provider call.

```bash
git add src/features/notifications/server/notification-worker.ts src/features/notifications/server/notification-workflow-adapter.ts src/app/api/notifications/worker/route.ts tests/notification-control-plane-worker.test.mjs tests/notification-operations.test.mjs
git commit -m "feat: process observation chat due jobs"
```

---

### Task 6: Prove Provider-Zero, Deploy OFF, and Activate by Receipt

#### Phase 6A: Complete provider-zero verification

**Files:**
- Create: `tests/registration-observation-google-chat-provider-zero.test.mjs`
- Create: `scripts/run-registration-observation-google-chat-provider-zero.mjs`
- Create: `tests/registration-observation-google-chat-provider-zero-runner.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: the frozen common runner only through the already-required Task 1/4/5 `--focus google-chat` commands; it does not import or modify that runner
- Produces: `runRegistrationObservationGoogleChatProviderZero(options)` and `verify:registration-observation:google-chat`; a separate guarded harness for clean DB, full lifecycle, render/link/privacy and build-independent provider-zero evidence
- Guarantees: the clean committed database first proves core readiness, activates through the production core RPC, records the current six-key worker heartbeat, and enables the two shared control-plane flags through their production service-role setter in dependency order. Only then may the authenticated v2 rule save precede every committed lifecycle. Committed Google Chat and in-app rules create real NCP deliveries; both reach claim → locked frozen-state read → first-attempt refresh → locked re-read → observation final-prepare. Google Chat reaches the real `begin_notification_delivery_send_v1` and stops before attempt registration; in-app reaches the real atomic `commit_notification_in_app_delivery_v1` and stops completed. Both have no external request/provider send/attempt audit and no customer/SOLAPI mutation

- [ ] **Step 1: Write the provider-zero RED integration**

The test installs complete CommonJS/ESM transport traps before importing any runtime code. Loopback is permitted only for the disposable Supabase ports recorded in the owned manifest; every other target is recorded and throws. Patch `fetch`, `node:http.request/get`, and `node:https.request/get`, call `syncBuiltinESMExports()` after install and restore, and restore all originals in `finally`:

```js
import { createRequire, syncBuiltinESMExports } from "node:module"

const require = createRequire(import.meta.url)
const http = require("node:http")
const https = require("node:https")
let fetchCalls = 0
let providerCalls = 0
const externalRequests = []
const originalFetch = globalThis.fetch
const originalHttpRequest = http.request
const originalHttpGet = http.get
const originalHttpsRequest = https.request
const originalHttpsGet = https.get
globalThis.fetch = async (input, init) => {
  if (isOwnedLoopback(input, ownedManifest)) return originalFetch(input, init)
  fetchCalls += 1
  externalRequests.push(requestSummary("fetch", input))
  throw new Error("provider_zero_external_fetch_forbidden")
}
http.request = trapUnlessOwnedLoopback("http.request", originalHttpRequest, ownedManifest, externalRequests)
http.get = trapUnlessOwnedLoopback("http.get", originalHttpGet, ownedManifest, externalRequests)
https.request = trapUnlessOwnedLoopback("https.request", originalHttpsRequest, ownedManifest, externalRequests)
https.get = trapUnlessOwnedLoopback("https.get", originalHttpsGet, ownedManifest, externalRequests)
syncBuiltinESMExports()

const provider = {
  async send() {
    providerCalls += 1
    throw new Error("provider_zero_send_forbidden")
  },
}
```

The `finally` block restores all five functions, calls `syncBuiltinESMExports()` again, and then destroys the disposable project's manifest-owned database/container/network/temp-root resources. The runner test dynamically imports `node:http`/`node:https` after trap installation to prove the ESM bindings are trapped too, and proves every manifest entry is absent after cleanup.

The focused pgTAP run immediately before the Node integration owns the seven-rules-OFF scheduled/rescheduled/canceled, attendance, no-show, feedback-submitted suppression/cancellation matrix in rollback. The committed Node database is therefore still clean, runtime `0`, both shared flags false, all seven rules false, and has no observation/domain/delivery row when its bootstrap starts. Seed only the synthetic Auth/profile/catalog/class/session/connection prerequisites (including explicit valid campus) before readiness; no observation booking or lifecycle mutation is permitted yet.

Against that committed clean database, execute this exact bootstrap and require every receipt before continuing. No `enter/save/cancel/attendance/feedback/decision` observation RPC, Chat job materialization, v2 rule save, generic claim, begin, or in-app commit may run before its numbered predecessor:

1. Through the synthetic authenticated admin client call `public.registration_observation_schema_readiness_v1()` and exact-compare `{schemaReady:true,missingObjects:[],runtimeVersion:0}`.
2. Through the production `activateRegistrationObservationRuntime` seam call `public.activate_registration_observation_runtime_v1(integer,text)` with `{p_expected_current_version:0,p_request_key:'provider-zero-google-chat-activate-v1'}`. Exact-compare `{operation:'activate',requestKey:'provider-zero-google-chat-activate-v1',previousVersion:0,runtimeVersion:1,readiness:{schemaReady:true,missingObjects:[],runtimeVersion:0}}`; replay the same request once and require byte/deep equality, then require `public.registration_observation_runtime_version() = 1`.
3. Through the service-role client call `public.record_notification_worker_heartbeat_v1(text,uuid,text,jsonb,text)` first with `phase='started'` and then the same `worker_id='notification-worker-route-v1'`, `run_id`, counts and `phase='succeeded'`. Both void RPC responses must be SQL `null`; counts must have exactly the six nonnegative-integer keys `{observation_due:0,fanout:0,rule_reconciliation:0,target_reconciliation:0,deliveries:0,reaped:0}` and `p_error_code=null`. Read back the latest `(created_at desc,id desc)` row and exact-compare worker/run/phase/counts/error, then require it is current under the setter's three-minute dependency gate and the observation readiness five-minute gate.
4. Read only the two current private flag rows through service role and require both are `{enabled:false,revision:'1'}`. Call `public.set_notification_runtime_flag_v1(text,boolean,bigint,uuid)` with fresh request IDs in the fixed order `notification_control_plane_settings_ui_enabled` then `notification_control_plane_dispatch_registration_enabled`, always passing that row's current decimal revision as `p_expected_revision`. Exact-compare each response key set and value: `{flag_key:<exact key>,enabled:true,revision:'2',canceled_count:0,claim_cancel_requested_count:0,reserved_ownership_claims:[]}`; same-request replay must be deep-equal. Finally exact-compare `public.get_notification_runtime_flags_v1().flags` for those two keys as `{enabled:true,revision:'2'}` through the authenticated admin client. Direct `UPDATE notification_runtime_flags` is forbidden.
5. Fetch one fresh authenticated `get_notification_control_plane_v1('registration')` snapshot. Call the production `saveNotificationControlPlaneViaRpc` path, hence exact SQL signature `public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid)`, to enable the scheduled Google Chat rule plus both feedback-submitted rules (executive Google Chat and current-director in-app) in one committed patch. `expected_rule_revisions`, `expected_contract_versions`, and `patch.rules` must have exactly the same three rule UUID keys—no whole-workflow map—and carry the snapshot's current decimal revision/contract values. Exact-parse the DB wire response with top-level keys only `{scope_key,workflow_key,rules,connections,delivery_summary,loaded_at,reconciliation_job}` and reconciliation value `{job_kind:'rule_reconciliation',job_id:<uuid>,status:'pending',attempt_count:0}`; require all three target rows enabled with their revisions advanced exactly once and unchanged content-contract versions, save audit/request-ledger rows for the fresh request ID, and a same-request replay that is deep-equal. Drain that exact reconciliation job before the first domain action.
6. Only now create and commit one fresh scheduled action, materialize/fan out a real Google Chat NCP delivery, and claim it through the byte-identical real generic claim RPC. Invoke exported production `prepareRegistrationObservationDeliveryForDispatch`, assert its first read has null fingerprints, refresh returns exact `{outcome:'refreshed',delivery_id,payload_fingerprint,render_fingerprint}`, its second read returns those exact committed values, and final-prepare returns the exact key set `{prepared:true,delivery_id,claim_token,dispatch_token,status:'sending',channel_key:'google_chat',connection_key,webhook_url,rendered_title,rendered_body,href}` produced around the unchanged successful `begin_notification_delivery_send_v1(uuid,uuid)`. Stop before `register_notification_external_attempt_v1`, never call the injected provider, and exact-compare the deterministic title/body/target and five-key link.
7. Create a separate fresh observation lifecycle through feedback submission while its director is active, materialize/fan out and real-claim both deliveries from that same event. Exact-compare their event/source/occurrence/revision/fingerprint identity. Invoke the same production seam for executive Chat and stop its exact successful `{prepared:true,...,status:'sending',channel_key:'google_chat',connection_key:'google_chat.executive'}` receipt before attempt registration/provider; invoke it for in-app and require exact `{prepared:true,channel_key:'in_app',delivery_id,notification_id,push_children_created:0,status:'sent'}` from real `commit_notification_in_app_delivery_v1(uuid,uuid)`, exactly one dashboard notification, parent delivery `sent`, ownership `closed`, and no begin/attempt/provider path for that in-app delivery.
8. Repeat two fresh paired feedback-submitted lifecycles. In each, materialize/fanout/claim both deliveries while director A is active, then—after the pairs exist but before either final-prepare—use test-only privileged fixture mutation to (a) set the locked track's `director_profile_id` null and (b) in a separate lifecycle set A's synthetic `auth.users.banned_until` to `clock_timestamp()+interval '1 day'`. For each same-event pair, real in-app final-prepare must return exact `{prepared:false,delivery_id,status:'canceled',status_reason:'recipient_revoked'}`, close ownership, clear claim/lease, and create zero dashboard notification/commit/begin. Real executive final-prepare must ignore the director defect, validate the exact `google_chat.executive` target tuple after the shared dispatch suffix, delegate the sole `channel='executive'` row lock/readiness check to unchanged begin, and reach exact `sending/google_chat/google_chat.executive`. Stop both executive results before attempt registration, restore nothing outside the owned disposable database, and require fetch/provider/external-attempt totals remain zero. A third target-resolution-only subcase makes the director null before fanout and proves executive delivery `1`, in-app delivery `0`, with no fallback target.
9. After the boundary receipts, run fresh scheduled → attendance, scheduled → no-show, and scheduled → feedback-submitted lifecycles; assert reminder/feedback due cancellation/retention semantics without allowing a second begin/commit for the already-proven identities.
10. Source revision changes with equal booking hash: scheduled/rescheduled payloads retain their stored snapshot while reminder payload refreshes latest same-session progress before its first attempt. Booking-hash drift produces `source_dirty` with delivery/provider/external-attempt audit 0.
11. For old-suppressed immutability, use a still-disabled rule to commit the old event, exact-compare its terminal suppression, then perform a separate correctly keyed v2 enable receipt before a fresh matching lifecycle; the old job remains terminal and only the fresh event becomes pending.

This ordering is executable, not documentary: the integration records an ordered call trace and asserts exactly `readiness → activate → heartbeat.started → heartbeat.succeeded → flag.settings-ui → flag.registration-dispatch → v2-save → lifecycle → claim/read/refresh/read/final-prepare → begin|commit`. The invalid-director subtrace is exact `paired lifecycle → paired fanout/claim → null|ban fixture mutation → in-app final-prepare/recipient_revoked → executive final-prepare/begin`, with the reverse final-prepare call order repeated once to prove channel independence. Any rejection, missing/extra call, executive cancellation caused by director state, or begin/commit before its v2 save fails the provider-zero run.

The v2 save is committed—not wrapped in a transaction-local rollback—because `record_notification_event_v1` must observe the enabled rule and content contract through its real registry joins. The database is disposable, so cleanup destroys the whole owned project after assertions.

Final assertions are exact:

```js
assert.deepEqual(coreReadinessReceipt, {
  schemaReady: true,
  missingObjects: [],
  runtimeVersion: 0,
})
assert.deepEqual(coreActivationReceipt, {
  operation: "activate",
  requestKey: "provider-zero-google-chat-activate-v1",
  previousVersion: 0,
  runtimeVersion: 1,
  readiness: coreReadinessReceipt,
})
assert.deepEqual(heartbeatReceipt.counts, {
  observation_due: 0,
  fanout: 0,
  rule_reconciliation: 0,
  target_reconciliation: 0,
  deliveries: 0,
  reaped: 0,
})
assert.deepEqual(settingsUiFlagReceipt, {
  flag_key: "notification_control_plane_settings_ui_enabled",
  enabled: true,
  revision: "2",
  canceled_count: 0,
  claim_cancel_requested_count: 0,
  reserved_ownership_claims: [],
})
assert.deepEqual(registrationDispatchFlagReceipt, {
  flag_key: "notification_control_plane_dispatch_registration_enabled",
  enabled: true,
  revision: "2",
  canceled_count: 0,
  claim_cancel_requested_count: 0,
  reserved_ownership_claims: [],
})
assert.deepEqual(callTrace.slice(0, 8), [
  "readiness", "activate", "heartbeat.started", "heartbeat.succeeded",
  "flag.settings-ui", "flag.registration-dispatch", "v2-save", "lifecycle",
])
assert.equal(fetchCalls, 0)
assert.equal(providerCalls, 0)
assert.deepEqual(externalRequests, [])
assert.equal(await countRowsWhere("dashboard_private.notification_audit_logs", {
  entity_kind: "notification_external_attempt",
  action: "external_attempt_registered",
}), 0)
assert.equal(await deliveryStatus(preparedDeliveryId), "sending")
assert.equal(await ownershipState(preparedDeliveryId), "dispatch_started")
assert.equal(await deliveryStatus(committedInAppDeliveryId), "sent")
assert.equal(await ownershipState(committedInAppDeliveryId), "closed")
assert.equal(await dashboardNotificationCountForDelivery(committedInAppDeliveryId), 1)
assert.equal(await pushChildCount(committedInAppDeliveryId), 0)
for (const pair of [missingDirectorPair, inactiveDirectorPair]) {
  assert.equal(pair.executive.eventId, pair.inApp.eventId)
  assert.equal(pair.executive.sourceId, pair.inApp.sourceId)
  assert.equal(pair.executive.occurrenceKey, pair.inApp.occurrenceKey)
  assert.equal(pair.executive.notificationRevision, pair.inApp.notificationRevision)
  assert.equal(pair.executive.payloadFingerprint, pair.inApp.payloadFingerprint)
  assert.equal(await deliveryStatus(pair.executive.deliveryId), "sending")
  assert.equal(await ownershipState(pair.executive.deliveryId), "dispatch_started")
  assert.equal(await deliveryConnectionKey(pair.executive.deliveryId), "google_chat.executive")
  assert.equal(await deliveryStatus(pair.inApp.deliveryId), "canceled")
  assert.equal(await deliveryStatusReason(pair.inApp.deliveryId), "recipient_revoked")
  assert.equal(await ownershipState(pair.inApp.deliveryId), "closed")
  assert.equal(await dashboardNotificationCountForDelivery(pair.inApp.deliveryId), 0)
}
assert.equal(missingBeforeFanout.executiveDeliveryCount, 1)
assert.equal(missingBeforeFanout.inAppDeliveryCount, 0)
assert.equal((await storedObservationPayload(preparedDeliveryId)).event_kind, "registration.observation_scheduled")
assert.match(await storedPayloadFingerprint(preparedDeliveryId), /^[0-9a-f]{64}$/)
assert.match(await storedRenderFingerprint(preparedDeliveryId), /^[0-9a-f]{64}$/)
assert.equal(await customerQueueFingerprint(), beforeCustomerQueueFingerprint)
assert.equal(await solapiMessageFingerprint(), beforeSolapiMessageFingerprint)
```

- [ ] **Step 2: Run Task 6 RED**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-google-chat-provider-zero-runner.test.mjs tests/registration-observation-google-chat-provider-zero.test.mjs
```

Expected: `ENOENT` for the separate harness/test or missing `runRegistrationObservationGoogleChatProviderZero` export fails before any network call. The common runner and its tests are unchanged.

- [ ] **Step 3: Implement the separate isolated provider-zero harness**

Create this exact exported seam in `scripts/run-registration-observation-google-chat-provider-zero.mjs`:

```js
export async function runRegistrationObservationGoogleChatProviderZero({
  argv,
  env,
  spawnImpl,
  makeTempRoot,
} = {}) {
  const config = parseProviderZeroArguments(argv ?? process.argv.slice(2))
  const safeEnv = assertProviderZeroEnvironment(env ?? process.env)
  const project = await createOwnedProviderZeroProject({
    config,
    safeEnv,
    spawnImpl,
    makeTempRoot,
  })
  let evidence
  try {
    await project.applyMigrationsThrough("20260809105000")
    await project.runPgTap("supabase/tests/registration_observation_google_chat_test.sql")
    evidence = await project.runNodeTest(
      "tests/registration-observation-google-chat-provider-zero.test.mjs",
    )
  } finally {
    await project.cleanupOwnedResources()
  }
  return assertProviderZeroEvidence({
    ...evidence,
    cleanupComplete: await project.verifyOwnedResourcesAbsent(),
  })
}
```

The four private helpers above are local to this script. `parseProviderZeroArguments` accepts only the exact double gate. `assertProviderZeroEnvironment` returns a copied provider-secret-free child environment, deletes every inherited Supabase URL/key/reference, and allows `createOwnedProviderZeroProject` to inject only its manifest-owned loopback URL plus disposable anon/service credentials after the ports exist. `createOwnedProviderZeroProject` records every created project/container/network/port/temp path in the temp manifest before use. `assertProviderZeroEvidence` exact-validates and returns the following closed public receipt (dynamic UUIDs/timestamps stay in the private test artifact):

```js
{
  coreReadiness: { schemaReady: true, missingObjects: [], runtimeVersion: 0 },
  coreActivation: { previousVersion: 0, runtimeVersion: 1, replayEqual: true },
  heartbeat: {
    workerId: "notification-worker-route-v1",
    phase: "succeeded",
    countKeys: [
      "observation_due", "fanout", "rule_reconciliation",
      "target_reconciliation", "deliveries", "reaped",
    ],
    allZero: true,
  },
  sharedFlags: {
    notification_control_plane_settings_ui_enabled: { enabled: true, revision: "2" },
    notification_control_plane_dispatch_registration_enabled: { enabled: true, revision: "2" },
  },
  v2RuleSaveReceiptExact: true,
  orderedCallTraceExact: true,
  fetch: 0,
  http: 0,
  https: 0,
  provider: 0,
  externalAttemptAudit: 0,
  googleChatPrepareBoundaryReached: true,
  googleChatDeliveryStatus: "sending",
  inAppCommitBoundaryReached: true,
  inAppDeliveryStatus: "sent",
  inAppDashboardNotificationCount: 1,
  inAppPushChildrenCreated: 0,
  missingDirectorPair: {
    executiveStatus: "sending",
    executiveConnectionKey: "google_chat.executive",
    inAppStatus: "canceled",
    inAppStatusReason: "recipient_revoked",
  },
  inactiveDirectorPair: {
    executiveStatus: "sending",
    executiveConnectionKey: "google_chat.executive",
    inAppStatus: "canceled",
    inAppStatusReason: "recipient_revoked",
  },
  missingDirectorBeforeFanout: {
    executiveDeliveryCount: 1,
    inAppDeliveryCount: 0,
  },
  customerQueueUnchanged: true,
  solapiMessagesUnchanged: true,
  cleanupComplete: true,
}
```

The CLI passes `process.argv.slice(2)`, a copied/filtered `process.env`, `spawnSync`, and `mkdtempSync`. It uses the pinned supabase-go binary at `/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go`, asserts `--version` is exactly `2.103.0`, independently creates one temporary local Supabase project, copies repository migrations only through `20260809105000`, runs the focused pgTAP plus `tests/registration-observation-google-chat-provider-zero.test.mjs` against that loopback database, and removes only the project/container/network/temp IDs recorded in its own manifest in `finally`. It seeds a synthetic local Auth user/admin profile used by the production readiness/activation and v2 save helpers, synthetic UUIDs/names, all seven initially disabled rules and their content contracts, normalized and legacy exact sessions, assigned teacher/director with zero push subscriptions, existing customer queue sentinel rows, and a syntactically valid deterministic **fake** Chat webhook row used only so the begin primitive can reach `sending`; it never supplies a real webhook/provider credential and the transport traps make the fake URL unreachable. It never imports, patches or writes `scripts/run-registration-observation-local-db-qa.mjs` or `tests/registration-observation-local-db-runner.test.mjs`.

The separate runner test injects `spawnImpl`/`makeTempRoot` fakes and has these executable guard assertions:

```js
assert.rejects(
  runRegistrationObservationGoogleChatProviderZero({ argv: [], env: {}, spawnImpl, makeTempRoot }),
  /registration_observation_google_chat_provider_zero_execute_required/,
)
assert.rejects(
  runRegistrationObservationGoogleChatProviderZero({
    argv: ["--execute", "--approved-local-db"],
    env: { GOOGLE_CHAT_WEBHOOK_URL: "must-not-be-present" },
    spawnImpl,
    makeTempRoot,
  }),
  /registration_observation_google_chat_provider_zero_provider_env_forbidden/,
)
assert.equal(spawnCalls.length, 0)
```

The real execution retains these guards:

```text
--execute and --approved-local-db both required
loopback database only
unique temporary Supabase project and ports
linked/remote/production flags rejected
provider env/credential rejected
inherited Supabase URL/key/reference stripped; injected Supabase URL is manifest-owned loopback only
only self-created Docker resources cleaned
owned manifest empty and temp root absent after finally
```

Do not seed a real phone, webhook URL, provider secret or production ID. The separate harness must fail before spawn if any of `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `GOOGLE_CHAT_WEBHOOK_URL`, `NOTIFICATION_WORKER_SECRET` is nonblank in its isolated child environment.

- [ ] **Step 4: Add the package verification command**

```json
{
  "verify:registration-observation:google-chat": "node --experimental-strip-types scripts/run-registration-observation-google-chat-provider-zero.mjs --execute --approved-local-db"
}
```

The separate harness executes the focused pgTAP and provider-zero Node test; it never starts a cron/worker loop or edits the frozen common runner.

- [ ] **Step 5: Run Task 6 GREEN with the complete no-send verification**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run verify:registration-observation:google-chat
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-google-chat-provider-zero.test.mjs tests/notification-registration-observation.test.mjs tests/notification-google-chat-content.test.mjs tests/notification-control-plane-worker.test.mjs tests/notification-content-contract.test.mjs tests/notification-content-manifest.test.mjs tests/notification-operations.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm lint
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm build
git diff --check
```

Expected: clean DB/pgTAP/provider-zero/tests/typecheck/lint/webpack build all exit 0. The explicit summary separately reports exact core readiness `0`, activation `0→1` plus replay, current six-key succeeded heartbeat, settings-UI `false/1→true/2`, registration-dispatch `false/1→true/2`, exact v2 save receipt and ordered trace before any lifecycle; then `fetch/http/https=0`, `provider=0`, `external_attempt_audit=0`, Google Chat prepare boundary and `sending/dispatch_started`, in-app commit boundary and `sent/closed` with one dashboard notification/zero push children, cleanup complete, and customer/SOLAPI fingerprints unchanged.

- [ ] **Step 6: Audit scope and commit**

```bash
git diff --name-only
rg -n "registration_customer_reminder_jobs|ops_registration_customer_messages|solapi|cron\.schedule|net\.http" supabase/migrations/20260809105000_registration_observation_google_chat.sql src/features/notifications/server/adapters/registration-observation-notification-source.ts src/features/notifications/server/notification-worker.ts
git add scripts/run-registration-observation-google-chat-provider-zero.mjs tests/registration-observation-google-chat-provider-zero-runner.test.mjs tests/registration-observation-google-chat-provider-zero.test.mjs package.json
git commit -m "test: prove observation chat provider zero"
```

Expected `rg`: zero matches except an explicit SQL comment asserting customer/SOLAPI tables are not touched. No production DB/shared-flag/provider activation occurs in this task; the only core/runtime-flag activation is the exact receipt-checked state inside the manifest-owned disposable loopback database, which is destroyed in `finally`.

---

#### Phase 6B: Consume the Completed Master Gate B Receipt, Then Verify Runtime 1 with Every New Rule OFF

**Files:**
- Create: `docs/superpowers/reports/2026-08-09-registration-observation-google-chat-rollout.md`
- No notification/provider source changes unless a reproduced defect requires a separately reviewed commit or forward migration

**Interfaces:**
- Consumes: completed master Gate B receipt for the Phase 6A-reviewed exact code SHA and every reviewed migration through `20260809106200`; reviewed Google Chat migration/default-OFF code
- Produces: verified Git/DB/Vercel identity, active existing worker heartbeat, provider-zero production observation event, default-OFF evidence
- Does not produce: enabled observation rule, Google Chat provider attempt, customer/SOLAPI mutation, new schedule

**Mandatory Gate B ownership fence:** `docs/superpowers/plans/2026-08-09-registration-observation-workflow.md` Gate B is the sole executable authority. This subordinate plan does not restate, execute, reorder, or partially replay deployment/migration/activation steps. It may enter Phase 6B only by consuming one master receipt proving the exact master order: reviewed feature branch exact `release_sha` pushed to its origin feature ref while runtime is committed `0` and the observation outbox/provider-attempt delta is zero; existing `Push Supabase Migrations` `workflow_dispatch` executed on that exact feature ref with successful checkout/job `headSha=release_sha`; frozen linked ledger containing only the reviewed inert/default-OFF prefix through `20260809106200` (including `20260809105000`); only then the identical SHA fast-forwarded to `main`; the resulting `push: main` DB workflow proving `headSha=release_sha`, pending `0`/already-up-to-date, and a byte-equal ledger; Vercel Production `READY` on that same SHA; explicit classroom campus completion; schema readiness true; admin/staff/teacher reads plus runtime-0 mutation rejection and Google Chat/SOLAPI provider-zero smoke; atomic activation; then post-activation mutation/browser provider-zero smoke. No operator-side linked push is valid evidence. Missing, reordered, split-SHA, non-no-op main DB run, unequal ledger, or subordinate-generated evidence is invalid and stops here.

- [ ] **Step 1: Record the post-Gate-B health and drift baseline**

After master Gate B and before any Google Chat rule activation, capture separately:

```text
master Gate B receipt contains exact Task 1-6A SHA and matching Plans 1-4 code SHA
pre-activation runtime = 0 and observation outbox empty
exact feature ref contains release_sha and was pushed before DB dispatch
feature-ref Push Supabase Migrations workflow_dispatch succeeded with headSha = release_sha
first frozen ledger applied every reviewed migration in order through 20260809106200 while runtime = 0
identical release_sha was then fast-forwarded to main
push:main DB workflow has headSha = release_sha, pending = 0/already-up-to-date, and byte-equal second ledger
Vercel Production READY receipt is for that identical release_sha
explicit in-use classroom campus receipt follows matching deploy
schemaReady = true and missingObjects = []
runtime-0 admin/staff/teacher read, mutation rejection, Google Chat/SOLAPI source smoke and provider-attempt delta = 0
master atomic Gate B 0→1 activation receipt follows every precondition above
post-activation admin/staff/teacher mutation/browser smoke provider-attempt delta = 0
Supabase project status ACTIVE_HEALTHY
SQL select 1 succeeds
pg_is_in_recovery() = false
no blocking lock/statement timeout/connection exhaustion
current remote migration ledger includes the complete reviewed prefix through 20260809106200
registration_observation_runtime_version() = 1
current origin/main SHA and Vercel Production READY SHA
existing notification worker schedule/heartbeat state
seven observation rule count = 7 and every row enabled = false
observation ownership-scoped external-attempt audit count = 0
customer/SOLAPI queue fingerprints
```

Any missing/reordered master receipt step, feature-dispatch/main-trigger `headSha` mismatch, non-no-op main DB run, unequal ledgers, migration/code/Vercel SHA mismatch, missing Gate B activation receipt, runtime value other than `1`, unhealthy/timeout or migration drift stops this phase. Do not apply a migration, push/deploy code, perform campus changes, or call activation from this subordinate phase; those actions belong only to the already-completed master Gate B.

- [ ] **Step 2: Re-run the release gate on the exact Gate B SHA**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run verify:registration-observation:google-chat
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm test:notifications
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm lint
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm build
node scripts/verify-supabase-migration-layout.mjs
git diff --check
git status --short --branch
```

Expected: all verification passes, only intentional feature/report changes exist, migration layout reports no active/pending collision, provider-zero counts are all zero.

- [ ] **Step 3: Verify the reviewed branch is already contained in the Gate B main SHA**

Master Gate B owns the reviewed merge/push. This phase performs no second merge or feature push. From the feature worktree, verify containment:

```bash
git fetch origin
TIPS_OBSERVATION_CHAT_RELEASE_SHA="$(git rev-parse origin/main)"
test -n "$TIPS_OBSERVATION_CHAT_RELEASE_SHA"
git merge-base --is-ancestor "$(git rev-parse HEAD)" "$TIPS_OBSERVATION_CHAT_RELEASE_SHA"
```

The final command proves the reviewed tip is contained in the already-released Gate B SHA without trying to check out a branch owned by another worktree. Do not merge, rebase, push or force-push in this step. Record `TIPS_OBSERVATION_CHAT_RELEASE_SHA` and the Gate B activation receipt ID in the report.

- [ ] **Step 4: Verify the complete reviewed migration prefix and master ordering receipts**

Run the repository migration-layout verifier read-only. Confirm the first frozen remote ledger already contains the exact reviewed repository prefix in order through `20260809106200`, including exactly one `20260809105000_registration_observation_google_chat.sql`, from the successful feature-ref workflow dispatch whose `headSha` equals `release_sha`. Confirm the master receipt then puts the identical SHA on `main`, records a `push: main` migration no-op with pending `0` and a byte-equal second ledger, and only afterward accepts Vercel Production/campus/readiness/runtime-0 smoke/activation evidence. Do not run a linked migration command here, edit applied files or import pending notification-cutover files. A missing/extra ledger row, non-no-op main run, unequal ledger, or reordered receipt is a hard stop requiring a reviewed recovery plan; never lower runtime or bypass the migration fence ad hoc.

Read-only evidence must show:

```sql
select public.get_registration_observation_google_chat_readiness_v1();

select event_key, channel_key, audience_key, enabled, revision
from dashboard_private.notification_rules
where workflow_key = 'registration'
  and event_key like 'registration.observation_%'
order by event_key, channel_key, audience_key;
```

Expected: readiness schema/trigger/rule count correct; seven rows, all `enabled=false`; pending/claimed/sourceDirty/failed counts zero; no existing rule revision changed.

- [ ] **Step 5: Require Vercel Production READY on the same SHA**

Do not trigger a second push or deployment. Verify the existing Gate B Production deployment is `READY`, then verify both `tipsedu.co.kr` and the Vercel production alias resolve to the deployment whose Git SHA equals `TIPS_OBSERVATION_CHAT_RELEASE_SHA`. Check `/api/notifications/worker` returns the expected 401 without a bearer token and the registration/auth routes have their expected authenticated boundary. Scan runtime logs for 5xx, timeout, source/payload schema errors.

Use the existing deployment receipt collector after environment preflight:

```bash
node --experimental-strip-types scripts/record-notification-deployment-receipt.mjs
```

Expected: receipt records contract version 2, Production `READY` inventory and build revision hash without printing tokens/URLs.

- [ ] **Step 6: Verify the existing scheduler and additive heartbeat**

First print the non-mutating plan:

```bash
node --experimental-strip-types scripts/manage-notification-worker-schedule.mjs --mode inspect
```

Then run the existing guarded read-only inspect execution:

```bash
node --experimental-strip-types scripts/manage-notification-worker-schedule.mjs --mode inspect --execute --authorized --request-id 44444444-4444-4444-8444-444444444444
```

Require exactly one active `tips-notification-worker-v1` at `* * * * *`, one active watchdog, matching command, and no new observation cron. Exact-parse readiness fields as `latestObservationHeartbeatAt:string|null` and `recentObservationHeartbeat:boolean`; require the single latest heartbeat row ordered `created_at desc,id desc` to be `phase='succeeded'`, have the six exact counts keys, satisfy `created_at >= clock_timestamp() - interval '5 minutes'`, and match `latestObservationHeartbeatAt`, so `recentObservationHeartbeat===true`. A missing/stale/latest-started/latest-failed row is not healthy even when an older success is recent. Do not run schedule `install`, `disable`, or `remove`.

- [ ] **Step 7: Perform one production provider-zero lifecycle**

In the Dashboard create a clearly labeled synthetic task/student `청강 CHAT 검증`, one subject track and a future exact class session. Save one observation booking while all seven rules are OFF. Do not enable a rule and do not call a webhook manually.

Read-only evidence after two worker intervals:

```sql
select event_key, status, last_error_code
from dashboard_private.registration_observation_chat_jobs
where observation_id = (
  select observation.id
  from public.ops_registration_observations observation
  join public.ops_tasks task on task.id = observation.task_id
  where task.student_name = '청강 CHAT 검증'
  order by observation.created_at desc, observation.id desc
  limit 1
)
order by event_key;

select count(*)
from dashboard_private.notification_audit_logs audit
join dashboard_private.notification_dispatch_ownership_claims ownership
  on audit.entity_id like ownership.id::text || ':%'
join dashboard_private.notification_events event_row
  on event_row.workflow_key = ownership.workflow_key
 and event_row.occurrence_key = ownership.occurrence_key
join dashboard_private.notification_deliveries delivery
  on delivery.event_id = event_row.id
 and delivery.rule_id = ownership.rule_id
 and delivery.channel_key = ownership.channel_key
 and delivery.target_key = ownership.target_key
 and delivery.target_generation = ownership.target_generation
where audit.entity_kind = 'notification_external_attempt'
  and audit.action = 'external_attempt_registered'
  and event_row.source_type = 'registration_observation';
```

Expected: output identities are `suppressed/rule_disabled_at_source`; ownership-scoped observation external-attempt audits exactly 0; existing notification worker continues other work; customer/SOLAPI fingerprints are unchanged. Preserve the synthetic history with its test label; do not delete material operational records.

- [ ] **Step 8: Write and commit the default-OFF rollout report**

The report has separate sections:

```text
code tests/build
local clean DB/pgTAP
local provider-zero
Git main exact SHA
Supabase health/migration/readiness
Vercel Production SHA/READY/aliases/routes/logs
existing schedule/heartbeat
production default-OFF provider-zero
customer/SOLAPI unchanged evidence
not activated: seven observation rules
```

Do not include student phone, webhook URL, provider secret, rendered target snapshot or provider response body.

```bash
# Run only in the existing main-owner worktree; never check out main here.
test "$(git branch --show-current)" = "main"
git fetch origin
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git diff --check
git add docs/superpowers/reports/2026-08-09-registration-observation-google-chat-rollout.md
git commit -m "docs: record observation chat rollout"
git push origin HEAD:main
```

The feature worktree hands the reviewed report diff to the already-existing main-owner worktree; it never checks out or force-updates main. After the report commit, verify the final main SHA and its Production deployment separately. A report commit does not retroactively change the feature deployment evidence; record both SHAs explicitly.

---

#### Phase 6C: Activate one event family at a time and capture real receipts

**Files:**
- Modify: `docs/superpowers/reports/2026-08-09-registration-observation-google-chat-rollout.md`
- No source/migration changes unless a defect is reproduced and fixed through a new reviewed commit/forward migration followed by Phase 6A–6B verification again

**Interfaces:**
- Consumes: Phase 6B healthy default-OFF deployment, current subject/executive connections, fresh synthetic observation actions
- Produces: staged rule activation, one real delivery receipt per required event, exact room/privacy/duplicate evidence, tested per-rule rollback

- [ ] **Step 1: Reconfirm activation gates and cutoff behavior**

Require all of:

```text
main and Vercel Production exact SHA READY
Supabase ACTIVE_HEALTHY and migration ledger current
triggerInstalled=true, sourceDirtyCount=0, failedCount=0
registration_observation_runtime_version() = 1
notification_control_plane_settings_ui_enabled = true with a current decimal revision
notification_control_plane_dispatch_registration_enabled = true with a current decimal revision
one active minute worker and latest succeeded heartbeat has exactly observation_due, fanout, rule_reconciliation, target_reconciliation, deliveries, reaped
google_chat.english/math/science/executive connection readiness true
seven observation rules OFF
old provider-zero jobs terminal suppressed
observation provider attempts 0 before activation
```

Exact-parse `public.get_notification_runtime_flags_v1()` and require its closed `flags` object contains both `notification_control_plane_settings_ui_enabled` and `notification_control_plane_dispatch_registration_enabled` as `{enabled:true,revision:<decimal string>}`. Cross-check their latest `runtime_flag_changed` service-role receipts and fixed settings-UI-before-registration-dispatch order. Phase 6C does not own a shared-flag change: if either is false, missing, stale, or lacks its audited setter receipt, stop and return to the separately authorized shared notification-control-plane activation runbook; never compensate with a direct table update or by enabling an observation rule first. Exact-parse the latest worker heartbeat using the six-key/current-row rule from Phase 6B and require `recentObservationHeartbeat=true` before every family save.

Here and throughout Phase 6C, "provider attempt" means an exact `notification_audit_logs` row with `entity_kind='notification_external_attempt'` and `action='external_attempt_registered'`, joined through `notification_dispatch_ownership_claims` to the delivery/event identity. If any shared flag, heartbeat, connection, or webhook verification is missing/ambiguous/stale, stop. Never print/decrypt a webhook URL into the report.

- [ ] **Step 2: Activate and receipt scheduled, then rescheduled, then canceled**

Use the authenticated notification settings control-plane PATCH route/UI, never direct table UPDATE and never the legacy v1 save. Before **each** mutation fetch the current snapshot and submit the exact current request shape:

```json
{
  "workflow_key": "registration",
  "expected_rule_revisions": { "<one target rule UUID>": "<current revision>" },
  "expected_contract_versions": { "<one target rule UUID>": "<current contract version>" },
  "patch": { "rules": { "<one target rule UUID>": { "enabled": true } } },
  "request_id": "<fresh UUID>"
}
```

The route must call `public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid)`. For every v2 request, `Object.keys(expected_rule_revisions)`, `Object.keys(expected_contract_versions)`, and `Object.keys(patch.rules)` are the same exact target UUID set; the current implementation rejects whole-workflow keys that are absent from `patch.rules`. On `notification_revision_conflict`, fetch the snapshot and target-keyed maps again and require a new human-reviewed request; never reuse/stomp revisions. Exact-parse the DB wire response with top-level keys only `{scope_key,workflow_key,rules,connections,delivery_summary,loaded_at,reconciliation_job}` and reconciliation value `{job_kind:'rule_reconciliation',job_id:<uuid>,status:'pending',attempt_count:0}`, require only the target revision advances once while its content-contract version stays unchanged, and match the fresh request-ledger/audit receipt. Drain that reconciliation job before creating a domain action.

Activation order:

```text
registration.observation_scheduled
registration.observation_rescheduled
registration.observation_canceled
```

Run an absolute fence between families: enable **scheduled only** → verify old suppressed jobs and zero attempt-audit delta → create a fresh English scheduled action → capture the real room/provider receipt. Only after that receipt passes, enable **rescheduled only** → fresh Math booking then reschedule → receipt. Only after that passes, enable **canceled only** → fresh Science booking then cancel → receipt. Do not enable the next family in advance.

```text
영어 -> new scheduled observation
수학 -> new scheduled observation then reschedule
과학 -> new scheduled observation then cancel
```

Require for each actual Chat receipt:

```text
exact subject room
friendly Korean title/body contains student, subject/class, schedule and required preparation/status
raw URL absent
청강 상세 보기 button URL is exactly taskId,trackId,appointmentId,observationId,view=calendar
phone/result/reason/UUID absent from body
one external attempt, one sent delivery, duplicate count 0
```

If one fails, turn only that event rule OFF through a fresh v2 snapshot/two-map request; leave previously proven families and all existing notification rules unchanged. Do not proceed to the next family.

- [ ] **Step 3: Activate and prove the fixed 3-hour reminder**

After all Step 2 receipts pass, fetch a fresh snapshot and the reminder rule's exact one-key revision/contract maps, then enable only `registration.observation_reminder_due` through the same v2 route. Verify its exact save/reconciliation receipt, then create a fresh synthetic booking whose start is more than 3 hours away and whose test clock/selected session allows observing exact due. Do not enable feedback families until this receipt passes. Verify:

```text
job due_at = starts_at - 3 hours
provider attempts before due = 0
at/after due within worker interval = exactly 1
card uses current selected-session textbook/progress
button URL is exactly taskId,trackId,appointmentId,observationId,view=calendar
retry_window_ends_at = starts_at
second worker run duplicate = 0
```

Create a separate lead-time fixture at `2:59:59`; it must have no reminder job and no substitute immediate message. Attendance before due cancels reminder with provider 0. A source revision-only content update with equal booking hash refreshes the card; booking hash drift produces `source_dirty` and provider 0.

- [ ] **Step 4: Activate and prove the fixed +30-minute feedback request**

After the reminder receipt passes, fetch a fresh snapshot and the feedback-due rule's exact one-key revision/contract maps, then enable only `registration.observation_feedback_due` through v2. Verify its exact save/reconciliation receipt, then create a fresh synthetic observation and verify job due is exactly canonical `ends_at + 30 minutes`. At due, only `scheduled|attended_feedback_pending` and no feedback may send. Do not enable feedback-submitted until this family receipt passes.

Require one subject-room receipt with:

```text
청강은 어땠나요? 적합 여부와 사유를 입력해 주세요.
student, subject/class, session, assigned teacher, classroom
피드백 입력 button
exact assigned-teacher feedback route
result/reason/phone/raw URL absent
duplicate count 0
```

Run three negative fresh fixtures: submitted before due, no-show, canceled. Each must produce provider attempt 0 for feedback_due. Attendance-only must retain one feedback_due job.

- [ ] **Step 5: Activate feedback-submitted executive Chat and director inbox together**

After feedback-due passes, fetch a fresh snapshot and exact two-key revision/contract maps, then enable both `registration.observation_feedback_submitted` rules in one audited v2 control-plane save: executive Google Chat and track-director in-app. Verify the exact save/reconciliation receipt, the two returned rule revisions advanced once, and both content-contract versions unchanged before submitting one fresh synthetic feedback after the canonical end time.

Require:

```text
executive room: one sent delivery
current track director: one in-app delivery
student, subject/class, submitter, submitted time present
fit/unfit result and reason absent from Chat
청강 상세 보기 URL is exactly taskId,trackId,appointmentId,observationId,view=calendar
no subject-room feedback-submitted delivery
duplicate count 0 on worker replay
```

If the director is missing/inactive, in-app must fail closed without rerouting; executive Chat behavior remains independently auditable.

- [ ] **Step 6: Confirm unknown/no-retry and targeted rollback**

In an isolated provider simulation, prove timeout/reset after attempt marker ends `delivery_unknown` and a second worker run makes no provider call. Do not intentionally create an ambiguous real production webhook call.

Then test rollback with the least disruptive live rule: fetch a fresh snapshot and the feedback-due rule's exact one-key revision/contract maps and turn only `registration.observation_feedback_due` OFF via the authenticated v2 control plane, create a fresh feedback-due source, and require suppressed/provider 0 while all existing non-observation notifications continue. Re-enable it only through another fresh one-target/two-map v2 request after the rollback evidence passes. Never disable either shared control-plane flag or the worker schedule for a single observation defect.

- [ ] **Step 7: Observe for 24 hours**

Monitor aggregate-only evidence:

```text
Auth/API/Postgres/Vercel 5xx and timeouts
observation pending/claimed backlog age
source_dirty, failed, delivery_unknown counts
duplicate ownership/delivery count
wrong destination count
worker heartbeat observation_due
existing registration/customer/SOLAPI notification health
```

Alert conditions are any wrong room, duplicate >0, PII/body UUID, stale pending beyond its delivery window, sourceDirty/failed without explained test fixture, or heartbeat older than 5 minutes. Containment order is affected observation rule OFF, verify no new provider delta, diagnose source/connection, and only then consider a reviewed code/DB fix. Preserve job/event/delivery/audit rows.

- [ ] **Step 8: Finalize receipt and rollback evidence**

Append one row per family/subject destination with event key, source revision, rule revision, target connection key, delivery status, provider attempt count, receipt timestamp, duplicate count, privacy result and button result. Hash or omit provider message IDs; never record webhook URLs or response bodies.

Final report must state separately:

```text
seven rule enabled states
Google Chat real receipt totals by event and destination
director inbox receipt
duplicate total = 0
wrong-destination total = 0
PII finding total = 0
source_dirty/unknown operational totals and explained test rows
tested per-rule rollback result
unchanged existing notification rules/schedule
unchanged customer/SOLAPI queue and activation
```

```bash
# Run only in the existing main-owner worktree after the report diff is reviewed.
test "$(git branch --show-current)" = "main"
git fetch origin
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git diff --check
shasum -a 256 supabase/migrations/20260809105000_registration_observation_google_chat.sql src/features/notifications/server/notification-worker.ts tests/registration-observation-google-chat-provider-zero.test.mjs
git add docs/superpowers/reports/2026-08-09-registration-observation-google-chat-rollout.md
git commit -m "docs: record observation chat receipts"
git push origin HEAD:main
```

Record those final SHA-256 values beside the exact Git feature/release/report SHAs, verify the final report SHA on remote main, and rerun the hashes after checkout from `origin/main`; any mismatch is a hard stop. Report completion only after both provider delivery receipt and actual destination-room observation exist; `accepted` or a visible card preview alone is not send proof.

---

## Final Verification Checklist

- [ ] Core booking/lifecycle RPC definitions are unchanged; only domain outbox trigger consumption was added.
- [ ] Protected generic claim/prepare/revalidate definitions remain byte-identical and `verify-supabase-migration-layout.mjs` is GREEN; first/retry source expiry/frozen state comes only from the claim-token locked observation read RPC, and observation uses only its channel-aware final-prepare before existing begin/commit primitives.
- [ ] The pinned supabase-go 2.103.0 `migration new` produced exactly one empty generated file, reviewed `git mv` froze it at `20260809105000`, and final gates prove one non-empty target with no collision/orphan.
- [ ] New tables/helpers/RPCs have RLS/minimal exact grants, revoked direct DML, fixed empty search paths, exact service-role actor checks, and negative anon/authenticated ACL tests.
- [ ] Six output event keys and seven destination rules have exact DB/TS/fixture parity.
- [ ] Seven settings UI registry rows and DB content-contract rows exist before the v2-only save path; every activation/rollback uses identical exact target UUID key sets across patch, current rule-revision map, and current content-contract-version map, then verifies the exact save/reconciliation receipt before lifecycle creation.
- [ ] Internal due values are fixed at 3 hours before and 30 minutes after; no settings/browser override exists.
- [ ] attendance/no-show/feedback lifecycle cancellation matches the frozen mapping under race and replay.
- [ ] Reservation snapshot SHA-256 is deterministic over the exact canonical tuple, rejects tampering, and stable rule locks plus post-insert event snapshot comparison close concurrent saves.
- [ ] The `105000` migration gates and forward-replaces both named delivery reason CHECKs exactly once, preserves the complete old registry/mapping, adds `notification_window_closed` only to global+canceled, and real expired Google/in-app final-prepare persists exact `canceled/notification_window_closed` with cleared claim state and zero begin/commit/external-attempt side effects.
- [ ] claim, materialize and observation final-prepare each revalidate current lifecycle/revision/hash/target; final-prepare locks exact common track→observation→appointment→class→normalized-session→catalog facts, locks the in-app-only current-director catalog/profile/account dependencies when that is the candidate, and then locks delivery→event→rule→ownership. The Google branch validates the exact canonical connection tuple only after that suffix and delegates the sole webhook connection lock/readiness check to unchanged begin in its production delivery→ownership→connection order. It passes both A→B director/session races, closes only in-app for null/inactive/stale director, lets the same-source healthy executive Chat reach begin without any director predicate, and changes no protected generic RPC.
- [ ] Before the first external attempt, source revision-only drift preserves scheduled/rescheduled stored preparation and refreshes only reminder_due current exact-session preparation per approved design §6.1 line 282; retry freezes payload/render fingerprints and performs eligibility-only reads; booking drift is source_dirty/provider-zero.
- [ ] Missing progress renders the value `미입력` exactly; the template alone supplies the `진도:` label.
- [ ] External attempts are measured only by `notification_audit_logs` (`notification_external_attempt`/`external_attempt_registered`) joined through delivery ownership; no nonexistent attempt table is referenced.
- [ ] Disposable provider-zero exact-orders readiness `0` → production core activation `0→1` → current six-key started/succeeded heartbeat → service-role settings-UI then registration-dispatch setters → exact target-keyed v2 save → lifecycle; it real-claims paired feedback-submitted deliveries and proves both null-director and inactive-account variants close in-app `recipient_revoked` while the same event's locked executive connection still reaches Google begin. Normal Google/in-app receipts, locked read→refresh→locked read→final-prepare, fetch/http/https/ESM traps, zero external attempts/provider calls, and destruction of every manifest-owned resource remain required.
- [ ] Worker synthesizes validated `workflow_key` into Google Chat provider context; DB begin response is unchanged and the shared link policy receives the correct workflow.
- [ ] Observation Production always constructs Google Chat with `http408Disposition:'delivery_unknown'`; 429 and 425 alone retry with an identical frozen second send, while canonical 408, timeout, reset, and 5xx stay terminal unknown with total provider calls `1` across two worker runs.
- [ ] old default-OFF jobs never backfill after activation; only fresh actions send.
- [ ] subject/executive/director destinations are canonical and wrong-room fallback is impossible.
- [ ] Static `청강 상세 보기` links use exactly `taskId,trackId,appointmentId,observationId,view=calendar`; shared validator/adapter/worker/provider tests reject every incomplete, malformed, duplicate, extra or non-calendar observation tuple without breaking legacy appointment links, while the dynamic teacher feedback route remains query/hash-free.
- [ ] card bodies contain no phone, result, reason, raw URL or UUID.
- [ ] existing worker route/schedule is reused; no second cron, provider worker or secret was added.
- [ ] Repo-wide service-role usage audit found no production direct shared-table DML; legacy word-retest QA no longer deletes shared deliveries; `service_role` has SELECT-only on delivery/ownership, direct I/U/D negative pgTAP passes, and generic SECURITY DEFINER worker RPC compatibility remains GREEN.
- [ ] Readiness returns exact `latestObservationHeartbeatAt:string|null` and `recentObservationHeartbeat:boolean`; missing/stale/current/latest-failed fixtures enforce latest-row `succeeded` plus `clock_timestamp()-5m` semantics.
- [ ] Phase 6C exact-parses both shared runtime flags as enabled with decimal revisions and audited settings-UI-before-registration-dispatch receipts, plus the latest current six-key succeeded heartbeat, before every family save; missing shared readiness stops activation rather than changing flags in this plan.
- [ ] customer/SOLAPI queue, templates, activation, cron and receipts are unchanged.
- [ ] clean DB/pgTAP, focused Node, typecheck, lint, webpack build and provider-zero all pass.
- [ ] This plan only consumes the master Gate B receipt: runtime-0/empty-outbox → exact feature-ref push → `Push Supabase Migrations` workflow_dispatch with matching `headSha` and frozen ledger through `20260809106200` → identical SHA main push → main-trigger pending-0/equal-ledger no-op → same-SHA Vercel READY → campus → readiness → runtime-0 provider-zero smoke → atomic activation → post-activation smoke; no direct linked push occurs, subordinate steps never redefine/reorder it, and every family follows enable → fresh action → real receipt → next.
- [ ] Git main, Supabase migration, Vercel READY, rule activation and real room receipts are reported as separate evidence.
- [ ] rollback disables only affected observation rules and preserves existing notification delivery.
