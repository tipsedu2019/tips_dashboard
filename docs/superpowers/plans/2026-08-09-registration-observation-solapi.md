# Registration Observation SOLAPI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 청강 예약 안내를 미리보기·명시 확인 후 회차 revision당 한 번 발송하고, 청강 3시간 전 리마인드를 자동으로 한 번 발송하되 source drift·중복·provider 불확실성·승인 전 발송을 fail closed한다.

**Architecture:** core 청강 도메인이 같은 transaction에서 기록하는 `dashboard_private.registration_observation_domain_events`를 유일한 producer seam으로 소비하며 core booking/lifecycle RPC는 다시 정의하지 않는다. 기존 등록 고객 SOLAPI preview/outbox/activation/receipt/worker 경계를 `observation_booking | observation_reminder`로 닫힌 확장하고, 자동 작업은 UUID `job_id`와 `observation_id + notification_revision + message_kind` identity를 사용한다. 코드·DB는 provider OFF로 배포하고, 정확한 템플릿 승인 receipt와 한 종류당 한 번의 실수신을 확인한 뒤 종류별로 `off → verification → live`를 진행한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase Postgres/PostgREST/RLS/pgTAP/pg_cron/pg_net/Vault, SOLAPI AlimTalk, Node test runner, ESLint, Vercel

## Global Constraints

- 제품 계약의 권위는 `docs/superpowers/specs/2026-08-09-registration-observation-workflow-design.md`다. 이 계획이 설계를 바꾸지 않는다.
- 이 계획의 고객 메시지 kind는 정확히 `observation_booking | observation_reminder`다. 기존 다섯 kind의 의미·receipt·activation·전송 이력은 바꾸지 않는다. 신규 runtime guard는 함수 전체가 아니라 observation branch 안에만 두며, runtime `0`에서도 기존 다섯 manual kind와 legacy `appointment_reminder`의 입력·응답·marker·provider 순서는 byte-compatible해야 한다.
- core dependency는 `dashboard_private.registration_observation_domain_events`뿐이다. SOLAPI migration은 core booking/attendance/feedback RPC를 `CREATE OR REPLACE`하지 않는다.
- 공용 Google Chat profile identity/mention foundation과 Google Chat rule·card·delivery는 범위 밖이다. 동일 domain event outbox를 별도 consumer가 읽고, 선행 `104500`/`105000` migration이 SOLAPI migration보다 먼저 적용된다는 dependency만 유지한다. SOLAPI source/recipient/template에는 Chat ID·mention setting을 넣지 않는다.
- browser가 보낸 학생명, 전화번호, 과목, 반, 일시, 장소, 선생님, campus, 버튼 URL을 신뢰하지 않는다. `sourceId = observationId`만 받고 서버가 canonical source를 다시 읽는다.
- 본문 변수는 정확히 `학생명, 과목, 수업명, 예약일시, 장소, 담당선생님` 여섯 개다. 버튼 전용 `학원위치URL`은 campus canonical fact에서 서버가 만들며 source/browser 입력을 금지하고 checksum·provider preflight exact-key에는 포함한다.
- 같은 `observation_id + appointment.notification_revision + message_kind`는 평생 한 번만 provider boundary를 넘을 수 있다.
- provider attempt marker 뒤 timeout 또는 응답 불확실성은 `unknown` message와 `delivery_unknown` job으로 terminal 처리하고 자동 재시도하지 않는다.
- 취소·참석·노쇼·피드백 제출은 provider marker 전 `pending | claimed` 자동 작업만 취소한다. `dispatching | completed | delivery_unknown` 이력은 되살리거나 삭제하지 않는다.
- claim은 현재 `booking_fact_hash`가 job snapshot과 다르면 그 job을 즉시 `source_dirty`로 terminal 처리하고 provider 호출을 0회로 유지한다. session revision/hash만 달라지고 recomputed booking hash가 같으면 claim은 job을 더럽히지 않는다. begin은 이 revision-only drift를 durable `refresh_required`로 한 번만 허용하고, worker는 같은 claim으로 정확히 한 번 reread/re-render/rebegin한다. 두 번째 revision drift는 `source_revision_unstable`/`source_dirty`, provider 호출 0회다.
- claim과 provider marker 직전에 appointment status, observation status, notification revision, session source revision/hash, `booking_fact_hash`, recipient, template receipt를 다시 검증한다. 핵심 사실 drift는 `source_dirty`, provider 호출 0회다.
- application runtime probe는 provider 권한 증거가 아니다. 자동 observation claim/read/begin과 수동 observation readiness/claim/attempt-marker는 각각 자기 DB transaction에서 runtime `1`을 다시 확인한다. readiness와 mixed-kind claim은 `public.registration_observation_runtime_version()`을 읽고, provider-capable observation read/begin/manual claim/manual marker는 기존 `dashboard_private.assert_registration_observation_runtime_v1()`을 호출한다. Gate B-R이 `1 → 0`으로 바뀐 뒤에는 이미 읽은 readiness나 claim을 재사용해도 새 provider marker를 만들 수 없고 SOLAPI 호출은 0회다.
- 자동 리마인드는 현재 고객 reminder 설정이 ON이고 시작까지 설정 lead time 이상 남았을 때만 생성한다. 최초 운영·실수신 검증 값은 `leadHours = 3`이다. leadHours 변경은 marker 없는 observation `pending` job만 즉시 새 due로 재계산한다. 이미 `claimed`인 job은 settings RPC가 건드리지 않고, begin의 job lock 안에서 새 설정을 감지해 marker 없이 pending으로 되돌린 뒤 다음 claim에서 재평가한다. 새 lead time을 이미 충족하지 못한 job은 늦게 즉시 발송하지 않고 `canceled/lead_time_changed_insufficient`로 닫는다.
- legacy `appointment_reminder` 자동 발송은 activation `live`에서만 가능하다. 신규 `observation_reminder`만 exact verification task/event/hash fence에서 `verification` 또는 cutoff 이후 `live`가 가능하다. shared settings가 legacy appointment verification 발송을 열어서는 안 된다.
- 신규 activation row는 `off`, 신규 template receipt는 없음, 신규 env key는 미설정 상태로 migration한다. 코드/DB 배포가 provider를 활성화하지 않는다.
- Gate B의 DB-before-code 인과는 같은 push에서 Supabase와 Vercel 완료를 기다리는 방식으로 증명하지 않는다. reviewed feature ref의 exact `TIPS_RELEASE_SHA`로 `Push Supabase Migrations`를 `workflow_dispatch`하고 remote ledger/headSha 성공을 먼저 고정한 뒤에만 그 동일 SHA를 `main`으로 fast-forward한다. main-trigger DB workflow는 ledger-identical no-op이어야 하고 그 뒤 exact-SHA Vercel Production `READY`를 고정한다. 운영자 로컬에서 `supabase db push --linked`를 직접 실행하지 않는다.
- DB closed status는 customer message `pending | accepted | unknown | failed_hold`, activation `off | verification | live`, template receipt `sendable`, reminder job `pending | claimed | dispatching | completed | canceled | source_dirty | delivery_unknown`뿐이다. 임의 text fallback을 추가하지 않는다.
- 문자 대체발송은 `disableSms: true`로 고정한다.
- 실제 발송 전에는 미리보기 또는 자동 작업 준비 상태와 masked 끝 4자리만 노출한다. 전체 번호·provider secret·webhook URL을 로그, 테스트 fixture, rollout report에 기록하지 않는다.
- DB task는 누적 focus를 사용한다: Task 1은 `solapi-contract`/ceiling `20260809106000`/contract pgTAP, Task 2는 `solapi-queue`/ceiling `20260809106100`/contract+queue pgTAP, Task 3 이후는 `solapi`/ceiling `20260809106200`/3개 pgTAP이다. 모든 GREEN DB 실행은 exact bundled Node와 `--execute --approved-local-db`를 모두 사용하며, 둘 중 하나라도 없는 dry-run은 GREEN 증거가 아니다.
- 신규 migration 파일은 정확히 pinned CLI `/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go`를 사용하고, 첫 명령에서 출력이 정확히 `2.103.0`인지 검사한다. 각 exact slug로 `migration new`를 실행하기 전에 frozen target 부재를 확인하고, 생성된 같은 slug 파일이 정확히 하나인지 확인한다. CLI가 만든 파일은 untracked이므로 내용을 쓰기 전에 그 exact generated path만 `git add -- "$generated"`로 index에 올린 뒤 reviewed timestamp/path로 `git mv -- "$generated" "$target"`한다. move 실패 시 `git status --short`와 두 path의 `git diff --cached --name-status`로 staged orphan을 표시하고 즉시 중단하며, 이를 해결하기 전에는 target을 만들거나 SQL을 쓰지 않는다. 성공 뒤에는 cached path가 frozen target 하나뿐이고 generated path가 사라졌음을 검사한다. target 충돌, CLI version drift, 생성 파일 0개/2개 이상이면 중단한다. SQL 작성 전후 `git status --short`를 확인하고, 작성 후 exact frozen target에 `test -s`를 실행해 빈 generated 파일이나 별도 timestamp 파일이 남지 않았음을 증명한다. 직접 빈 migration 파일을 만들지 않는다.
- 모든 신규 private/outbox/job table은 RLS를 켜고 `public,anon,authenticated,service_role` 직접 DML을 revoke한다. 모든 `SECURITY DEFINER` 함수는 `set search_path=''`, schema-qualified relation/function, 함수 내부 explicit actor/role/access 검증, exact signature의 PUBLIC/anon 및 불필요한 authenticated/service_role EXECUTE revoke, 필요한 역할에만 최소 grant를 갖는다. pgTAP은 `prosecdef`, `proconfig`, ACL, wrong-role rejection을 모든 신규/replaced definer에 대해 검사한다. 행의 `NEW`만 정규화하는 trigger는 definer가 아니라 invoker로 만든다.
- SOLAPI migration과 settings code는 `public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid)` 및 override v2를 재정의하거나 우회하지 않는다. customer reminder settings v1은 별도 경계이며 Gate A에서 기존 notification-control-plane v2 tests를 함께 보존한다.
- default-OFF provider-zero GREEN은 mock lifecycle counter만으로 성립하지 않는다. Task 9의 production reminder assembly가 실제 catalog/source/worker/route/SOLAPI adapter를 조립한 상태에서 주입된 fake fetch가 `SOLAPI_SEND_MANY_URL` 호출을 count/throw하고, 모든 automatic OFF·runtime·cancel·drift fence가 그 adapter 경계까지 도달하기 전에 send count 0임을 증명해야 한다. 수동 preview/confirm의 masked·duplicate·runtime-race provider-zero는 Task 6의 별도 production manual-handler factory test가 소유하며 Task 9 automatic factory에 섞지 않는다.
- Task 1–9는 RED를 실제 관찰하고 최소 GREEN, focused test, lint/typecheck 또는 pgTAP, `git diff --check`, commit을 완료한 뒤 다음 task로 이동한다. 외부 상태를 다루는 Task 10–15는 각 task의 fail-closed 사전 gate를 RED 경계로, 요구 증거가 모두 일치한 상태를 GREEN 경계로 취급하고, 그 task가 소유한 redacted rollout-report diff만 `git diff --check` 후 별도 docs commit한다. Task 10–14의 docs commits는 고정된 application `TIPS_RELEASE_SHA`를 바꾸거나 임의 redeploy 권한을 만들지 않는다. Task 15만 누적된 report-only diff를 별도 `TIPS_REPORT_SHA`로 `main`에 push하고 그 docs-only SHA의 Production `READY`를 확인한다; 최종 보고는 immutable application `TIPS_RELEASE_SHA`와 evidence `TIPS_REPORT_SHA`를 분리한다.

---

## Dependency Interface

이 계획은 core plan이 다음 relation과 exact event allowlist를 먼저 제공했다고 가정한다.

Execution dependency paths are exact: master gate `docs/superpowers/plans/2026-08-09-registration-observation-workflow.md`, core schema/booking/UI `docs/superpowers/plans/2026-08-09-registration-observation-core.md`, feedback/enrollment terminal events `docs/superpowers/plans/2026-08-09-registration-observation-feedback-enrollment.md`, profile mention foundation `docs/superpowers/plans/2026-08-10-dashboard-google-chat-profile-mentions.md`, and observation Chat consumer `docs/superpowers/plans/2026-08-09-registration-observation-google-chat.md`. At the reviewed baseline, `scripts/run-registration-observation-local-db-qa.mjs` and `src/features/tasks/registration-observation-editor.tsx` are intentionally absent because core Task 1 and core Task 6 create them. SOLAPI Task 1 must stop if the runner is still absent, and SOLAPI Task 6 must stop if the editor is still absent; this plan never substitutes a similarly named file or creates either dependency itself. The mention/Google Chat plans are prior release-order siblings rather than SOLAPI implementation surfaces; SOLAPI must not redefine or call their identity/resolver/provider functions.

```sql
dashboard_private.registration_observation_domain_events(
  event_id uuid primary key,
  observation_id uuid not null references public.ops_registration_observations(id) on delete restrict,
  appointment_id uuid not null references public.ops_registration_appointments(id) on delete restrict,
  notification_revision integer not null check (notification_revision > 0),
  event_kind text not null check (event_kind in (
    'observation_scheduled',
    'observation_rescheduled',
    'observation_canceled',
    'observation_attendance_recorded',
    'observation_no_show',
    'observation_feedback_submitted'
  )),
  booking_fact_hash text not null,
  source_revision jsonb not null check (
    (
      source_revision = jsonb_build_object(
        'authority', 'normalized',
        'sessionId', source_revision->>'sessionId',
        'revision', (source_revision->>'revision')::bigint
      )
      and source_revision->>'authority' = 'normalized'
      and (source_revision->>'sessionId')::uuid is not null
      and (source_revision->>'revision')::bigint >= 0
    )
    or (
      source_revision = jsonb_build_object(
        'authority', 'legacy',
        'sessionKey', source_revision->>'sessionKey',
        'contentHash', source_revision->>'contentHash'
      )
      and source_revision->>'authority' = 'legacy'
      and nullif(btrim(source_revision->>'sessionKey'), '') is not null
      and nullif(btrim(source_revision->>'contentHash'), '') is not null
    )
  ),
  occurred_at timestamptz not null default now(),
  unique (observation_id, notification_revision, event_kind)
)
```

`appointment_id`는 항상 `ops_registration_appointments(id)`를 `ON DELETE RESTRICT`로 참조하지만 event identity에는 넣지 않는다. identity는 정확히 `unique (observation_id, notification_revision, event_kind)`다. `source_revision`은 다른 key를 허용하지 않는 위 tagged union이다.

SOLAPI consumer는 다음 mapping만 사용한다.

```ts
export const OBSERVATION_SOLAPI_EVENT_ACTION = Object.freeze({
  observation_scheduled: "upsert_reminder",
  observation_rescheduled: "replace_reminder",
  observation_canceled: "cancel_pre_marker",
  observation_attendance_recorded: "cancel_pre_marker",
  observation_no_show: "cancel_pre_marker",
  observation_feedback_submitted: "cancel_pre_marker",
} as const)
```

`registration_observation_domain_events`가 없거나 event check가 위 여섯 literal과 다르면 첫 SOLAPI migration은 `registration_observation_solapi_dependency_missing`으로 전체 rollback한다.

---

## File Responsibility Map

| File | Responsibility |
|---|---|
| `supabase/migrations/20260809106000_registration_observation_solapi_contract.sql` | 두 message kind, observation source columns/shapes, receipt/activation rows, revision당 unique, live cutoff |
| `supabase/migrations/20260809106100_registration_observation_solapi_queue.sql` | 기존 reminder queue의 UUID job migration, message↔job composite integrity, domain event consumption, create/replace/cancel materialization |
| `supabase/migrations/20260809106200_registration_observation_solapi_dispatch.sql` | job-locked canonical source read RPC, activation-aware claim/begin/finalize/recovery/settings/readiness |
| `supabase/tests/registration_observation_solapi_contract_test.sql` | closed allowlist, shape, unique, grants, default OFF pgTAP |
| `supabase/tests/registration_observation_solapi_queue_test.sql` | lossless backfill, producer event mapping, lead time, cancel semantics pgTAP |
| `supabase/tests/registration_observation_solapi_dispatch_test.sql` | source drift, claim lease, marker, unknown, cutoff, no-retry pgTAP |
| `tests/registration-observation-solapi-db.test.mjs` | migration order/signature/static safety contract |
| `src/features/tasks/registration-customer-message-contract.ts` | exhaustive public kinds, statuses, readiness DTOs and parsers |
| `src/features/tasks/server/registration-customer-message-catalog.ts` | exact Korean templates, transport variable, buttons, env keys, checksums |
| `src/features/tasks/server/registration-customer-message-source.ts` | strict observation source normalizer and public/private split |
| `src/features/tasks/server/registration-customer-message-route.ts` | manual booking preview/confirm/history/admin activation orchestration |
| `src/features/tasks/server/registration-customer-reminder-worker.ts` | kind-aware one-attempt automatic worker state machine |
| `src/features/tasks/server/registration-customer-reminder-route.ts` | service-role job RPC orchestration and production env wiring |
| `src/features/tasks/registration-observation-editor.tsx` | saved reservation message button and send/history state |
| `src/features/tasks/registration-alimtalk-preview-dialog.tsx` | observation facts/buttons/explicit confirmation/locked history UI |
| `src/features/tasks/registration-track-fixtures.ts` | exhaustive fixture sources and provider-zero observation history |
| `src/features/tasks/registration-customer-message-rollout-panel.tsx` | two new activation/preflight/receipt rows |
| `src/features/notifications/registration-customer-reminder-service.ts` | exact 3-hour settings DTO and active automatic kind readiness |
| `src/features/notifications/registration-customer-reminder-settings.tsx` | ON/OFF + lead-hours UI and automatic-kind status |
| `tests/registration-observation-customer-message-contract.test.mjs` | exhaustive TS kind/map/parser contract |
| `tests/registration-observation-customer-message-catalog.test.mjs` | exact content/variables/buttons/checksums/env contract |
| `tests/fixtures/registration-customer-message-checksums.json` | 코드 변경 전에 고정한 기존 다섯 kind의 literal checksum 기준선 |
| `tests/registration-observation-customer-message-source.test.mjs` | source exact-shape/privacy/drift normalizer |
| `tests/registration-observation-customer-message-route.test.mjs` | preview-confirm-once and activation gate |
| `tests/registration-observation-customer-reminder-worker.test.mjs` | claim/cancel/source_dirty/delivery_unknown state machine |
| `tests/registration-observation-customer-message-ui.test.mjs` | editor/dialog/maps/fixtures/rollout/settings source contract |
| `tests/registration-observation-solapi-provider-zero.test.mjs` | end-to-end intents/messages/jobs with provider call count zero |
| `scripts/run-registration-observation-local-db-qa.mjs` | Core-plan dependency; 수정 없이 누적 `solapi-contract(106000) | solapi-queue(106100) | solapi(106200)` ceiling과 각 focused pgTAP file set을 소비 |
| `docs/superpowers/reports/2026-08-09-registration-observation-solapi-rollout.md` | separate code/DB/Vercel/provider/receipt/rollback evidence |

---

### Task 1: Extend the Closed DB Message Contract

**Files:**
- Create: `supabase/migrations/20260809106000_registration_observation_solapi_contract.sql`
- Create: `supabase/tests/registration_observation_solapi_contract_test.sql`
- Create: `tests/registration-observation-solapi-db.test.mjs`

**Interfaces:**
- Consumes: dependency relation above; existing five customer message kinds; `ops_registration_observations`; appointment `notification_revision`
- Produces: two closed kinds; nullable `observation_id` on preview/message rows; `automatic_delivery_cutoff_at`; unique observation revision locks; two activation rows in `off`

- [ ] **Step 1: Write the migration contract RED test**

```js
test("observation customer kinds are closed and revision scoped", async () => {
  const sql = normalizeSql(await readFile(contractMigrationUrl, "utf8"))
  assert.match(sql, /'observation_booking'.*'observation_reminder'/s)
  assert.match(sql, /add column observation_id uuid/)
  assert.match(sql, /unique.*observation_id.*message_kind.*source_revision/s)
  assert.match(sql, /automatic_delivery_cutoff_at timestamptz/)
  assert.match(sql, /\('observation_booking', 'off'\).*\('observation_reminder', 'off'\)/s)
  const cutoff = functionBlock(sql, "dashboard_private.set_registration_customer_solapi_cutoff_v1")
  assert.match(cutoff, /security invoker/)
  assert.doesNotMatch(cutoff, /security definer/)
  assert.doesNotMatch(sql, /update .* mode = 'live'|provider_attempt_count = 1/)
})
```

- [ ] **Step 2: Run the RED test**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-solapi-db.test.mjs
```

Expected: `ENOENT ...20260809106000_registration_observation_solapi_contract.sql`.

- [ ] **Step 3: Add the closed allowlists and observation source columns**

Run the frozen migration contract before writing SQL:

```bash
TIPS_SUPABASE_CLI=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go
test "$("${TIPS_SUPABASE_CLI}" --version)" = "2.103.0"
test ! -e supabase/migrations/20260809106000_registration_observation_solapi_contract.sql
"${TIPS_SUPABASE_CLI}" migration new registration_observation_solapi_contract
TIPS_GENERATED=(supabase/migrations/*_registration_observation_solapi_contract.sql)
test "${#TIPS_GENERATED[@]}" -eq 1
TIPS_GENERATED_PATH="${TIPS_GENERATED[1]}"
TIPS_FROZEN_PATH=supabase/migrations/20260809106000_registration_observation_solapi_contract.sql
git add -- "${TIPS_GENERATED_PATH}"
if ! git mv -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}"; then
  git status --short -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}"
  git diff --cached --name-status -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}"
  exit 1
fi
test ! -e "${TIPS_GENERATED_PATH}"
test "$(git diff --cached --name-only -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}")" = "${TIPS_FROZEN_PATH}"
git status --short -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}"
```

Only then write SQL. After writing, require `test -s supabase/migrations/20260809106000_registration_observation_solapi_contract.sql`, the generated-path glob to resolve only to the frozen target, and `git status --short` to show no extra timestamp file.

Use this exact source-shape branch in both preview and message checks:

```sql
or (
  message_kind in ('observation_booking', 'observation_reminder')
  and observation_id is not null
  and appointment_id is not null
  and track_id is not null
  and source_revision is not null
)
```

The migration must add and constrain the columns with the following statements:

```sql
alter table public.ops_registration_customer_message_previews
  add column observation_id uuid
    references public.ops_registration_observations(id) on delete restrict;

alter table public.ops_registration_customer_messages
  add column observation_id uuid
    references public.ops_registration_observations(id) on delete restrict;

create index ops_reg_customer_preview_observation_idx
  on public.ops_registration_customer_message_previews(
    observation_id, message_kind, source_revision, created_at desc
  ) where observation_id is not null;

create index ops_reg_customer_message_observation_idx
  on public.ops_registration_customer_messages(
    observation_id, message_kind, source_revision, created_at desc
  ) where observation_id is not null;
```

Drop and recreate the four existing message-kind/source-shape checks so their closed list is exactly the following literal set. Do not use `LIKE`, prefix matching, or an open text fallback.

```sql
message_kind in (
  'level_test_booking',
  'visit_consultation_booking',
  'appointment_reminder',
  'waiting_notice',
  'admission_application',
  'observation_booking',
  'observation_reminder'
)
```

Preserve the customer-message status check exactly as `status in ('pending','accepted','unknown','failed_hold')`, the activation mode check exactly as `mode in ('off','verification','live')`, and the receipt invariant `provider_status = 'sendable'`. Only the message-kind allowlists expand.

- [ ] **Step 4: Add revision-scoped lifetime locks**

```sql
create unique index ops_reg_customer_msg_observation_revision_once_idx
  on public.ops_registration_customer_messages(
    observation_id, message_kind, source_revision
  )
  where message_kind in ('observation_booking', 'observation_reminder');
```

`source_revision` for both kinds is the appointment `notification_revision`; observation domain/feedback revision is never used as send permission. Preview rows are intentionally not lifetime-unique because an expired preview must be recreatable; only the durable message row is the provider-boundary lock.

- [ ] **Step 5: Add fail-closed receipt, activation, and cutoff rows**

```sql
alter table dashboard_private.registration_customer_solapi_activation
  add column automatic_delivery_cutoff_at timestamptz;

insert into dashboard_private.registration_customer_solapi_activation(message_kind, mode)
values ('observation_booking', 'off'), ('observation_reminder', 'off')
on conflict (message_kind) do nothing;

create or replace function dashboard_private.set_registration_customer_solapi_cutoff_v1()
returns trigger language plpgsql volatile security invoker set search_path = '' as $$
begin
  if new.message_kind = 'observation_reminder' then
    if new.mode = 'live' and old.mode is distinct from 'live' then
      new.automatic_delivery_cutoff_at := pg_catalog.clock_timestamp();
    elsif new.mode <> 'live' then
      new.automatic_delivery_cutoff_at := null;
    end if;
  else
    new.automatic_delivery_cutoff_at := null;
  end if;
  return new;
end;
$$;
```

This trigger only normalizes `NEW`, so it must remain invoker. Set owner to `postgres`, revoke its exact signature from `PUBLIC, anon, authenticated, service_role`, and install it as a `BEFORE UPDATE OF mode` trigger; no direct RPC grant is needed. Recreate receipt/activation constraints with the exact seven-kind allowlist. Replace the pure `dashboard_private.registration_customer_solapi_assert_kind_v1(text)` helper as `SECURITY INVOKER` with the same exact revoke/no-direct-grant because it only validates a literal and needs no elevated access. If an activation/receipt RPC itself must be replaced to carry the new cutoff/closed kind, retain `set search_path=''`, schema qualification, explicit `auth.role()='service_role'` plus existing admin actor check and exact service-role grant; do not weaken it merely to add the two kinds. No receipt row is seeded.

- [ ] **Step 6: Write focused pgTAP contract tests**

```sql
begin;
select plan(16);
select has_column('public', 'ops_registration_customer_messages', 'observation_id');
select has_column('dashboard_private', 'registration_customer_solapi_activation', 'automatic_delivery_cutoff_at');
select results_eq(
  $$select message_kind || ':' || mode from dashboard_private.registration_customer_solapi_activation where message_kind like 'observation_%' order by message_kind$$,
  $$values ('observation_booking:off'::text), ('observation_reminder:off'::text)$$
);
select is_empty($$select 1 from dashboard_private.registration_customer_solapi_template_receipts where message_kind like 'observation_%'$$);
select throws_ok(
  $$insert into dashboard_private.registration_customer_solapi_activation(message_kind, mode) values ('observation_unknown', 'off')$$,
  '23514'
);
select has_index('public', 'ops_registration_customer_messages', 'ops_reg_customer_msg_observation_revision_once_idx');
select is_empty($$select 1 from public.ops_registration_customer_messages where message_kind like 'observation_%'$$);
select is(
  (select prosecdef from pg_proc where oid = 'dashboard_private.set_registration_customer_solapi_cutoff_v1()'::regprocedure),
  false,
  'cutoff trigger is security invoker'
);
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'dashboard_private.set_registration_customer_solapi_cutoff_v1()'::regprocedure),
  'cutoff trigger fixes an empty search_path'
);
select is_empty(
  $$select 1 from information_schema.routine_privileges where specific_schema = 'dashboard_private' and routine_name = 'set_registration_customer_solapi_cutoff_v1' and grantee in ('PUBLIC','anon','authenticated','service_role')$$,
  'cutoff trigger has no direct execute grant'
);
select is_empty(
  $$select 1 from pg_proc p where p.oid = 'dashboard_private.registration_customer_solapi_assert_kind_v1(text)'::regprocedure and (p.prosecdef or not (p.proconfig @> array['search_path=""']) or has_function_privilege('anon',p.oid,'EXECUTE'))$$,
  'pure kind assertion is invoker with fixed search_path and no anon execute'
);
select finish();
rollback;
```

Complete the 16-test plan with these five exact assertions:

```sql
select matches(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'ops_registration_customer_message_previews_source_shape_check'),
  'observation_booking.*observation_reminder.*observation_id IS NOT NULL.*appointment_id IS NOT NULL.*track_id IS NOT NULL.*source_revision IS NOT NULL',
  'preview observation source shape is closed'
);
select matches(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'ops_registration_customer_messages_source_shape_check'),
  'observation_booking.*observation_reminder.*observation_id IS NOT NULL.*appointment_id IS NOT NULL.*track_id IS NOT NULL.*source_revision IS NOT NULL',
  'message observation source shape is closed'
);
select is_empty(
  $$select 1 from information_schema.role_table_grants where grantee = 'authenticated' and table_schema in ('public','dashboard_private') and table_name in ('ops_registration_customer_message_previews','ops_registration_customer_messages','registration_customer_solapi_activation') and privilege_type in ('INSERT','UPDATE','DELETE')$$,
  'authenticated has no direct customer-message writes'
);
select is_empty(
  $$select 1 from dashboard_private.registration_customer_solapi_activation where message_kind not in ('observation_booking','observation_reminder') and automatic_delivery_cutoff_at is not null$$,
  'existing kinds never receive the observation cutoff'
);
select is_empty(
  $$select 1 from dashboard_private.registration_customer_solapi_activation where message_kind in ('observation_booking','observation_reminder') and (mode <> 'off' or automatic_delivery_cutoff_at is not null)$$,
  'new kinds remain OFF with no cutoff'
);
```

- [ ] **Step 7: Clean-apply and run focused pgTAP**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus solapi-contract
```

Expected: clean database migration apply stops exactly at `20260809106000`; only `registration_observation_solapi_contract_test.sql` runs; TAP reports `1..16`, zero failed tests; provider attempts remain `0`. Dry-run output is not acceptable. Before commit, run `test -s` on the frozen migration, verify no second `*_registration_observation_solapi_contract.sql` exists, and run `git diff --check`.

- [ ] **Step 8: Commit Task 1**

```bash
git add supabase/migrations/20260809106000_registration_observation_solapi_contract.sql supabase/tests/registration_observation_solapi_contract_test.sql tests/registration-observation-solapi-db.test.mjs
git commit -m "feat: add observation solapi db contract"
```

---

### Task 2: Generalize the Reminder Queue and Consume Domain Events

**Files:**
- Create: `supabase/migrations/20260809106100_registration_observation_solapi_queue.sql`
- Create: `supabase/tests/registration_observation_solapi_queue_test.sql`
- Modify: `tests/registration-observation-solapi-db.test.mjs`

**Interfaces:**
- Consumes: Task 1 schema; core domain events; private reminder settings
- Produces: UUID `job_id`; job kinds `appointment_reminder | observation_reminder`; generated source identities/composite scheduled-message FK; durable `source_refresh_count`; event consumption ledger; `materialize_registration_observation_solapi_events_v1(integer) returns integer`

- [ ] **Step 1: Write lossless queue-migration RED assertions**

```js
test("queue migration preserves old jobs before adding observation jobs", async () => {
  const sql = normalizeSql(await readFile(queueMigrationUrl, "utf8"))
  const add = sql.indexOf("add column job_id uuid")
  const backfill = sql.indexOf("set job_id = appointment_id")
  const dropInbound = sql.indexOf("drop constraint ops_registration_customer_messages_scheduled_job_id_fkey")
  const dropPk = sql.indexOf("drop constraint registration_customer_reminder_jobs_pkey")
  const addPk = sql.indexOf("primary key (job_id)")
  assert.ok(add < backfill && backfill < dropInbound && dropInbound < dropPk && dropPk < addPk)
  assert.match(sql, /materialize_registration_observation_solapi_events_v1\(p_limit integer\)/)
  assert.match(sql, /create or replace function dashboard_private\.sync_registration_customer_reminder_jobs_v1\(\)/)
  assert.match(sql, /create or replace function public\.claim_registration_customer_reminder_job_v1\(\)/)
  assert.match(sql, /create or replace function public\.read_registration_customer_reminder_source_v1\(p_job_id uuid,\s*p_claim_token uuid\)/)
  assert.match(sql, /create or replace function public\.release_registration_customer_reminder_job_v1\(p_job_id uuid,\s*p_claim_token uuid,\s*p_error_code text\)/)
  assert.match(sql, /create or replace function public\.begin_registration_customer_reminder_dispatch_v1\(p_job_id uuid,\s*p_claim_token uuid,\s*p_contract jsonb,\s*p_readiness_contract jsonb\)/)
  assert.match(sql, /create or replace function public\.finalize_registration_customer_reminder_dispatch_v1\(p_message_id uuid,\s*p_dispatch_token uuid,\s*p_result text,\s*p_provider_result jsonb\)/)
  assert.match(sql, /on conflict \(appointment_id,\s*source_revision,\s*message_kind\)\s*where message_kind\s*=\s*'appointment_reminder'/)
  assert.match(sql, /primary key \(job_id\)/)
  assert.match(sql, /scheduled_source_identity uuid generated always as/)
  assert.match(sql, /foreign key \(scheduled_job_id,\s*appointment_id,\s*message_kind,\s*source_revision,\s*scheduled_source_identity\)/)
  assert.match(sql, /references dashboard_private\.registration_customer_reminder_jobs\(job_id,\s*appointment_id,\s*message_kind,\s*source_revision,\s*source_identity\)/)
  assert.match(sql, /status = 'pending'.*octet_length\(last_error_code\) <= 120/s)
  const claimStart = sql.indexOf("create or replace function public.claim_registration_customer_reminder_job_v1()")
  const claimEnd = sql.indexOf("alter function public.claim_registration_customer_reminder_job_v1()", claimStart)
  assert.ok(claimStart >= 0 && claimEnd > claimStart)
  assert.doesNotMatch(sql.slice(claimStart, claimEnd), /where job\.appointment_id = p_job_id/)
})
```

- [ ] **Step 2: Run the queue RED test**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-solapi-db.test.mjs
```

Expected: `ENOENT ...20260809106100_registration_observation_solapi_queue.sql`.

- [ ] **Step 3: Migrate the queue identity without data loss**

Run the exact frozen-file creation before writing SQL:

```bash
TIPS_SUPABASE_CLI=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go
test "$("${TIPS_SUPABASE_CLI}" --version)" = "2.103.0"
test ! -e supabase/migrations/20260809106100_registration_observation_solapi_queue.sql
"${TIPS_SUPABASE_CLI}" migration new registration_observation_solapi_queue
TIPS_GENERATED=(supabase/migrations/*_registration_observation_solapi_queue.sql)
test "${#TIPS_GENERATED[@]}" -eq 1
TIPS_GENERATED_PATH="${TIPS_GENERATED[1]}"
TIPS_FROZEN_PATH=supabase/migrations/20260809106100_registration_observation_solapi_queue.sql
git add -- "${TIPS_GENERATED_PATH}"
if ! git mv -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}"; then
  git status --short -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}"
  git diff --cached --name-status -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}"
  exit 1
fi
test ! -e "${TIPS_GENERATED_PATH}"
test "$(git diff --cached --name-only -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}")" = "${TIPS_FROZEN_PATH}"
git status --short -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}"
```

After writing, require `test -s supabase/migrations/20260809106100_registration_observation_solapi_queue.sql`, exactly one slug path and no extra generated timestamp before GREEN/commit.

Apply these operations in this order inside one transaction:

```sql
alter table dashboard_private.registration_customer_reminder_jobs
  add column job_id uuid,
  add column message_kind text,
  add column observation_id uuid references public.ops_registration_observations(id) on delete restrict,
  add column source_event_id uuid references dashboard_private.registration_observation_domain_events(event_id) on delete restrict,
  add column booking_fact_hash text,
  add column session_source_revision jsonb,
  add column source_refresh_count smallint not null default 0,
  add column activation_mode_snapshot text,
  add column verification_started_at timestamptz,
  add column verification_recipient_hash text;

update dashboard_private.registration_customer_reminder_jobs
set job_id = appointment_id,
    message_kind = 'appointment_reminder'
where job_id is null;

do $$ begin
  if exists (select 1 from dashboard_private.registration_customer_reminder_jobs where job_id is null or message_kind is null)
     or exists (select job_id from dashboard_private.registration_customer_reminder_jobs group by job_id having count(*) > 1) then
    raise exception 'registration_customer_reminder_job_backfill_invalid' using errcode = '23505';
  end if;
end $$;

alter table dashboard_private.registration_customer_reminder_jobs
  add column source_identity uuid generated always as (
    coalesce(observation_id, appointment_id)
  ) stored;

alter table public.ops_registration_customer_messages
  add column scheduled_source_identity uuid generated always as (
    case when delivery_origin = 'scheduled'
      then coalesce(observation_id, appointment_id)
    end
  ) stored;
```

Then drop the inbound scheduled-message FK, old appointment PK, old scheduled-origin shape check, and the existing job status/claim/message checks. Set `job_id` and `message_kind` NOT NULL, add `primary key(job_id)`, add partial unique indexes `(appointment_id,source_revision,message_kind) where message_kind='appointment_reminder'` and `(observation_id,source_revision,message_kind) where message_kind='observation_reminder'`, and add an exact unique constraint on `(job_id,appointment_id,message_kind,source_revision,source_identity)`. Reconnect scheduled messages with a composite FK, not a job-ID-only FK:

```sql
alter table public.ops_registration_customer_messages
  add constraint ops_registration_customer_messages_scheduled_job_source_fkey
  foreign key (
    scheduled_job_id, appointment_id, message_kind,
    source_revision, scheduled_source_identity
  ) references dashboard_private.registration_customer_reminder_jobs(
    job_id, appointment_id, message_kind, source_revision, source_identity
  ) on delete restrict;
```

The generated `source_identity` is observation ID for observation jobs and appointment ID for legacy appointment jobs. Therefore a scheduled row with the wrong appointment, kind, source revision, missing/wrong observation ID, or unrelated job ID cannot commit. Manual rows have null `scheduled_job_id`/`scheduled_source_identity` and remain outside this FK. Recreate the job constraints exactly as follows:

```sql
check (message_kind in ('appointment_reminder', 'observation_reminder'));

check (
  (
    message_kind = 'appointment_reminder'
    and observation_id is null
    and source_event_id is null
    and booking_fact_hash is null
    and session_source_revision is null
    and source_refresh_count = 0
    and activation_mode_snapshot is null
    and verification_started_at is null
    and verification_recipient_hash is null
  )
  or
  (
    message_kind = 'observation_reminder'
    and observation_id is not null
    and source_event_id is not null
    and nullif(btrim(booking_fact_hash), '') is not null
    and session_source_revision is not null
    and source_refresh_count between 0 and 1
    and activation_mode_snapshot in ('verification', 'live')
    and (
      (
        activation_mode_snapshot = 'verification'
        and verification_started_at is not null
        and verification_recipient_hash ~ '^[a-f0-9]{64}$'
      )
      or (
        activation_mode_snapshot = 'live'
        and verification_started_at is null
        and verification_recipient_hash is null
      )
    )
  )
);

check (status in (
  'pending', 'claimed', 'dispatching', 'completed', 'canceled',
  'source_dirty', 'delivery_unknown'
));

check (
  (status = 'claimed' and claim_token is not null and claim_expires_at is not null and message_id is null)
  or
  (status <> 'claimed' and claim_token is null and claim_expires_at is null)
);

check (
  (status in ('dispatching', 'completed', 'delivery_unknown') and message_id is not null)
  or
  (status not in ('dispatching', 'completed', 'delivery_unknown') and message_id is null)
);

check (
  (status = 'pending' and (
    last_error_code is null
    or (
      nullif(btrim(last_error_code), '') is not null
      and pg_catalog.octet_length(last_error_code) <= 120
    )
  ))
  or (status in ('claimed', 'dispatching') and last_error_code is null)
  or (status = 'completed' and (last_error_code is null or last_error_code in ('provider_rejected', 'duplicate_locked')))
  or (status = 'canceled' and nullif(btrim(last_error_code), '') is not null)
  or (status = 'source_dirty' and last_error_code in ('booking_fact_changed', 'source_revision_unstable'))
  or (status = 'delivery_unknown' and last_error_code = 'provider_dispatch_uncertain')
);
```

For `session_source_revision`, reuse the exact normalized/legacy tagged-union check from the dependency interface; the appointment reminder branch must keep it null. The new scheduled message shape is:

```sql
delivery_origin = 'scheduled'
and message_kind in ('appointment_reminder', 'observation_reminder')
and preview_id is null
and confirmed_by is null
and scheduled_job_id is not null
and scheduled_source_identity is not null
and scheduled_for is not null
```

Preserve the existing manual-origin branch, require `scheduled_source_identity is null`, and add `message_kind <> 'observation_reminder'`; observation reminders may be rendered for readiness inspection but can cross the provider boundary only with `delivery_origin = 'scheduled'` and a locked job.

The identity migration must leave the existing appointment reminder executable at this task boundary. In the same migration, `CREATE OR REPLACE` the existing `dashboard_private.sync_registration_customer_reminder_jobs_v1()`, `public.claim_registration_customer_reminder_job_v1()`, `public.read_registration_customer_reminder_source_v1(uuid,uuid)`, `public.release_registration_customer_reminder_job_v1(uuid,uuid,text)`, `public.begin_registration_customer_reminder_dispatch_v1(uuid,uuid,jsonb,jsonb)`, and `public.finalize_registration_customer_reminder_dispatch_v1(uuid,uuid,text,jsonb)` without changing positional signatures or grants. Every one remains `SECURITY DEFINER set search_path=''`, uses schema-qualified objects, and has `(select auth.role()) = 'service_role'` as its first executable access fence; the private sync function stays ungranted, while each public worker RPC is revoked from `PUBLIC,anon,authenticated,service_role` and then granted only to `service_role`. The finalize named signature remains exactly `p_message_id uuid,p_dispatch_token uuid,p_result text,p_provider_result jsonb` because PostgREST callers use that name; it locks the message then updates the job through `message.scheduled_job_id = jobs.job_id` and the full composite identity. Claim/read/release/begin `p_job_id` lookups use `jobs.job_id`, never `jobs.appointment_id`. The compatibility claim filters `message_kind='appointment_reminder'`; observation jobs created in this task remain pending and provider-ineligible until Task 3 installs their canonical dispatch branch. Its raw DB result remains the exact legacy six-key object, in this order: `jobId,appointmentId,claimToken,sourceRevision,scheduledFor,requestKey`; it does not add `messageKind` or `observationId`. Task 7 alone normalizes that raw legacy branch in TypeScript by synthesizing `messageKind:'appointment_reminder'` and `observationId:null`. `sync_registration_customer_reminder_jobs_v1` must cancel older pending/claimed appointment-reminder revisions, create/update the current revision with a UUID `job_id`, and use `ON CONFLICT (appointment_id,source_revision,message_kind) WHERE message_kind='appointment_reminder'`. Preserve the current retry release contract: `source_ineligible` becomes `canceled` with no retry, while `source_read_failed`, `pre_send_preparation_failed`, `claim_lease_expired`, `automation_disabled` and other bounded nonblank retry codes may remain `pending` with delayed `available_at` and `last_error_code`; a later claim clears that error. The queue pgTAP executes one complete legacy claim→begin→finalize cycle after the PK change and proves that no query updates multiple revision rows.

- [ ] **Step 4: Add the event consumption ledger**

```sql
create table dashboard_private.registration_observation_solapi_event_consumptions(
  event_id uuid primary key references dashboard_private.registration_observation_domain_events(event_id) on delete restrict,
  action text not null check (action in ('created', 'replaced', 'canceled', 'skipped_off', 'skipped_scope', 'skipped_lead_time', 'already_terminal')),
  job_id uuid references dashboard_private.registration_customer_reminder_jobs(job_id) on delete restrict,
  consumed_at timestamptz not null default pg_catalog.clock_timestamp()
);
```

Enable RLS and revoke all table privileges from `public, anon, authenticated, service_role`.

- [ ] **Step 5: Implement the bounded materializer**

Use the exact signature and branch mapping:

```sql
create function dashboard_private.materialize_registration_observation_solapi_events_v1(
  p_limit integer
) returns integer
language plpgsql volatile security definer set search_path = '' as $$
```

- Its first executable statement rejects `(select auth.role()) <> 'service_role'` with SQLSTATE `42501`; every relation/function is schema-qualified. Revoke the exact signature from `PUBLIC,anon,authenticated,service_role`, then grant only `service_role`. The definer is never granted directly to browser roles.
- Reject limits outside `1..100`.
- Select unconsumed events ordered by `occurred_at,event_id`, `FOR UPDATE SKIP LOCKED LIMIT p_limit`.
- For `observation_scheduled`, create a UUID observation-reminder job only when settings are enabled, source starts at least `lead_hours` ahead, and activation is either exact verification task with `event.occurred_at >= activation.updated_at`, or live with `event.occurred_at >= automatic_delivery_cutoff_at`.
- For `observation_rescheduled`, cancel older-revision `pending | claimed` jobs, then create the new-revision job under the same gates.
- For the four terminal events, cancel only same observation `pending | claimed` jobs and clear claim fields.
- Insert exactly one consumption row in every branch.

The insert identity is fixed:

```sql
insert into dashboard_private.registration_customer_reminder_jobs(
  job_id, appointment_id, observation_id, source_event_id, task_id, message_kind,
  source_revision, session_source_revision, booking_fact_hash,
  activation_mode_snapshot, verification_started_at, verification_recipient_hash,
  scheduled_for, due_at, available_at, request_key, status
) values (
  gen_random_uuid(), v_event.appointment_id, v_event.observation_id, v_event.event_id, v_task_id,
  'observation_reminder', v_event.notification_revision,
  v_event.source_revision, v_event.booking_fact_hash,
  v_activation.mode,
  case when v_activation.mode = 'verification' then v_activation.updated_at end,
  case when v_activation.mode = 'verification' then v_activation.verification_recipient_hash end,
  v_starts_at, v_starts_at - pg_catalog.make_interval(hours => v_settings.lead_hours),
  pg_catalog.clock_timestamp(), gen_random_uuid(), 'pending'
)
on conflict (observation_id, source_revision, message_kind)
  where message_kind = 'observation_reminder'
do nothing;
```

- [ ] **Step 6: Write focused producer pgTAP**

Create fixtures for each of the six event kinds and assert:

```sql
select is(
  dashboard_private.materialize_registration_observation_solapi_events_v1(100),
  6,
  'each domain event is consumed once'
);
select is(
  (select count(*) from dashboard_private.registration_customer_reminder_jobs where message_kind = 'observation_reminder'),
  1::bigint,
  'only the current eligible revision has a job'
);
select is_empty($$select 1 from dashboard_private.registration_customer_reminder_jobs where status = 'claimed' and claim_token is null$$);
```

Also assert OFF, verification scope mismatch, event predating `verification_started_at`, changed verification hash, lead-time short, repeated materialization, reschedule, cancellation, attendance, no-show, and feedback-submitted outcomes. The status-shape pgTAP must attempt one invalid row for every status and prove the database rejects missing/stale claim fields, terminal rows without their message, a verification row without event/start/hash snapshots, refresh counts outside `0..1`, and terminal error-code mismatches. Insert one retryable release fixture and require exactly `pending:source_read_failed:retry`, then claim it and require the error to clear. Insert scheduled-message fixtures whose job ID is valid but appointment, kind, source revision, or observation source identity is wrong; every insert must fail with FK SQLSTATE `23503`. A correct legacy and correct observation tuple must commit.

Execute the legacy appointment reminder compatibility cycle in the same pgTAP: sync creates one UUID-keyed appointment job; raw claim is `jsonb_build_object('jobId',...,'appointmentId',...,'claimToken',...,'sourceRevision',...,'scheduledFor',...,'requestKey',...)` with exactly those six keys and no `messageKind`/`observationId`; read/release/begin/finalize target only that exact returned `jobId`; the route-compatible finalize call uses named `p_message_id`; and a reschedule cancels the older revision before inserting the new one. An observation job must not be returned by the compatibility claim before Task 3. For every new/replaced definer, assert `prosecdef=true`, `proconfig` contains empty search path, wrong-role invocation raises `42501`, PUBLIC/anon have no EXECUTE and only service_role has the intended worker grant.

- [ ] **Step 7: Clean-apply and run focused pgTAP**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus solapi-queue
```

Expected: clean database migration apply stops exactly at `20260809106100`; only the contract and queue SOLAPI pgTAP files run and pass; legacy job and scheduled-message row counts are unchanged, the old one-column FK is replaced by one composite FK, the legacy retry test still passes, and no provider row is inserted. Dry-run output is not acceptable. Before commit, require frozen migration `test -s`, one slug path only and `git diff --check`.

- [ ] **Step 8: Commit Task 2**

```bash
git add supabase/migrations/20260809106100_registration_observation_solapi_queue.sql supabase/tests/registration_observation_solapi_queue_test.sql tests/registration-observation-solapi-db.test.mjs
git commit -m "feat: materialize observation reminder jobs"
```

---

### Task 3: Add Canonical Source, Claim, Dispatch, and Uncertainty Semantics

**Files:**
- Create: `supabase/migrations/20260809106200_registration_observation_solapi_dispatch.sql`
- Create: `supabase/tests/registration_observation_solapi_dispatch_test.sql`
- Modify: `tests/registration-observation-solapi-db.test.mjs`

**Interfaces:**
- Consumes: Task 2 queue; core observation/session facts; `dashboard_private.assert_registration_observation_runtime_v1()` and `public.registration_observation_runtime_version()`; existing customer message RPCs
- Produces: observation branches in private `resolve_registration_customer_message_source_v1_impl(text,uuid)` and public `resolve_registration_customer_message_source_v1(uuid,text,uuid)`; job-ID-locked `read_registration_customer_reminder_source_v1(uuid,uuid)`; generalized claim/begin/release/finalize; exact heartbeat-bearing `inspect_registration_observation_solapi_readiness_v1() returns jsonb`

- [ ] **Step 1: Write dispatch SQL RED assertions**

```js
test("dispatch rechecks source before the provider marker", async () => {
  const sql = normalizeSql(await readFile(dispatchMigrationUrl, "utf8"))
  const currentHash = sql.indexOf("booking_fact_hash is distinct from")
  const marker = sql.indexOf("provider_attempt_started_at")
  assert.ok(currentHash >= 0 && marker > currentHash)
  assert.match(sql, /status = 'source_dirty'/)
  assert.match(sql, /status = 'delivery_unknown'/)
  assert.match(sql, /materialize_registration_observation_solapi_events_v1\(100\)/)
  const readSource = functionBlock(sql, "public.read_registration_customer_reminder_source_v1")
  assert.match(readSource, /where job\.job_id = p_job_id/)
  assert.match(readSource, /for update/)
  assert.match(readSource, /message_kind = 'observation_reminder'/)
  assert.match(readSource, /resolve_registration_customer_message_source_v1_impl\('observation_reminder',\s*v_job\.observation_id\)/)
  assert.doesNotMatch(readSource, /where job\.appointment_id = p_job_id/)
  const publicResolve = functionBlock(sql, "public.resolve_registration_customer_message_source_v1")
  const publicResolveRoleFence = publicResolve.indexOf("auth.role()")
  const publicResolveFirstRead = publicResolve.indexOf("registration_customer_message_source_task_v1")
  assert.ok(publicResolveRoleFence >= 0 && publicResolveFirstRead > publicResolveRoleFence)
  assert.match(publicResolve, /registration_customer_message_assert_actor_v1/)
  assert.match(publicResolve, /resolve_registration_customer_message_source_v1_impl/)
  assert.match(sql, /revoke all on function public\.resolve_registration_customer_message_source_v1\(uuid,\s*text,\s*uuid\).*public,\s*anon,\s*authenticated,\s*service_role/s)
  assert.match(sql, /grant execute on function public\.resolve_registration_customer_message_source_v1\(uuid,\s*text,\s*uuid\).*to service_role/s)
  const finalize = functionBlock(sql, "public.finalize_registration_customer_reminder_dispatch_v1")
  assert.match(finalize, /p_message_id uuid/)
  assert.doesNotMatch(finalize, /p_job_id uuid/)
})

test("every observation provider-capable DB stage owns a runtime fence", async () => {
  const sql = normalizeSql(await readFile(dispatchMigrationUrl, "utf8"))
  for (const name of [
    "public.claim_registration_customer_reminder_job_v1",
    "public.get_registration_customer_solapi_readiness_v1",
  ]) {
    const block = functionBlock(sql, name)
    assert.match(block, /registration_observation_runtime_version\(\)/)
    assert.match(block, /observation_(?:booking|reminder)/)
  }
  for (const name of [
    "public.read_registration_customer_reminder_source_v1",
    "public.begin_registration_customer_reminder_dispatch_v1",
    "public.claim_registration_customer_message_v1",
    "public.mark_registration_customer_message_attempt_started_v1",
  ]) {
    const block = functionBlock(sql, name)
    assert.match(block, /assert_registration_observation_runtime_v1\(\)/)
    assert.match(block, /observation_(?:booking|reminder)/)
  }
  const marker = functionBlock(sql, "public.mark_registration_customer_message_attempt_started_v1")
  assert.match(
    marker,
    /assert_registration_observation_runtime_v1\(\)[\s\S]*set\s+provider_attempt_count/i,
  )
  assert.match(sql, /registration_observation_runtime_inactive/)
})
```

- [ ] **Step 2: Run the dispatch RED test**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-solapi-db.test.mjs
```

Expected: `ENOENT ...20260809106200_registration_observation_solapi_dispatch.sql`.

- [ ] **Step 3: Define the exact canonical observation source**

Run the exact frozen-file creation before writing SQL:

```bash
TIPS_SUPABASE_CLI=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go
test "$("${TIPS_SUPABASE_CLI}" --version)" = "2.103.0"
test ! -e supabase/migrations/20260809106200_registration_observation_solapi_dispatch.sql
"${TIPS_SUPABASE_CLI}" migration new registration_observation_solapi_dispatch
TIPS_GENERATED=(supabase/migrations/*_registration_observation_solapi_dispatch.sql)
test "${#TIPS_GENERATED[@]}" -eq 1
TIPS_GENERATED_PATH="${TIPS_GENERATED[1]}"
TIPS_FROZEN_PATH=supabase/migrations/20260809106200_registration_observation_solapi_dispatch.sql
git add -- "${TIPS_GENERATED_PATH}"
if ! git mv -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}"; then
  git status --short -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}"
  git diff --cached --name-status -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}"
  exit 1
fi
test ! -e "${TIPS_GENERATED_PATH}"
test "$(git diff --cached --name-only -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}")" = "${TIPS_FROZEN_PATH}"
git status --short -- "${TIPS_GENERATED_PATH}" "${TIPS_FROZEN_PATH}"
```

After writing, require `test -s supabase/migrations/20260809106200_registration_observation_solapi_dispatch.sql`, exactly one slug path and no extra generated timestamp before GREEN/commit.

Extend `dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)` by resolving the observation's stored track/class/authority/session identifiers through core exact `dashboard_private.resolve_registration_observation_session_v1(uuid,uuid,text,uuid,text)`; do not duplicate schedule JSON parsing. It returns exactly:

```json
{
  "messageKind": "observation_booking",
  "sourceId": "observation-uuid",
  "taskId": "task-uuid",
  "trackId": "track-uuid",
  "observationId": "observation-uuid",
  "appointmentId": "appointment-uuid",
  "sourceRevision": 4,
  "sessionSourceRevision": {
    "authority": "normalized",
    "sessionId": "session-uuid",
    "revision": 7
  },
  "bookingFactHash": "64-lowercase-hex",
  "studentName": "SOLAPI 테스트",
  "parentPhoneDigits": "01000000000",
  "subject": "영어",
  "className": "중2 영어 A반",
  "scheduledAt": "2026-08-17T09:00:00Z",
  "place": "본관 301호",
  "campus": "본관",
  "teacherName": "홍길동"
}
```

The resolver must reject unknown keys, multi-subject aggregation, non-scheduled appointment, observation not `scheduled`, appointment/observation campus mismatch, notification revision mismatch, and observation snapshot/current session `booking_fact_hash` mismatch. That last mismatch uses the stable `registration_customer_reminder_booking_fact_changed` code so the automatic route can terminalize rather than retry it; other ineligible status uses `registration_customer_message_source_ineligible`. `place` is the customer-facing canonical classroom label; `campus` is independently read from `classroom_catalog.campus` and is the only location-button selector. It never returns a button URL.

This generic resolver has no job identity and never updates the queue. If the current normalized revision or legacy content hash differs but the recomputed `booking_fact_hash` is unchanged, it returns the latest canonical `sessionSourceRevision`; the job-locked read/begin path below owns comparison and the one bounded refresh. This is not `source_dirty`; textbook/progress-only edits must not suppress a valid reminder. Only a changed `booking_fact_hash` makes the job `source_dirty`.

- [ ] **Step 3A: Replace the complete manual source pipeline for observation identity**

The dispatch migration must replace every existing SQL stage that derives or persists a manual source, while preserving signatures, grants, and the five existing branches byte-for-byte in behavior:

```text
dashboard_private.registration_customer_message_source_task_v1(text,uuid)
dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)
dashboard_private.registration_customer_message_assert_current_v1(ops_registration_customer_messages,jsonb)
dashboard_private.registration_customer_message_result_v1(uuid,boolean,boolean,boolean)
public.resolve_registration_customer_message_source_v1(uuid,text,uuid)
public.create_registration_customer_message_preview_v1(uuid,text,uuid,jsonb)
public.claim_registration_customer_message_v1(uuid,uuid,text,jsonb)
public.get_registration_customer_solapi_readiness_v1(uuid,text,uuid,jsonb)
public.release_registration_customer_message_pre_send_claim_v1(uuid,uuid,text)
public.release_registration_customer_message_pre_send_claim_admin_v1(uuid,uuid,text,text)
public.mark_registration_customer_message_attempt_started_v1(uuid,uuid,uuid,jsonb)
public.finalize_registration_customer_message_v1(uuid,uuid,text,jsonb)
public.read_registration_customer_message_preview_target_v1(uuid,uuid)
public.list_registration_customer_messages_v1(uuid,text,uuid,integer)
public.record_registration_customer_message_provider_check_v1(uuid,uuid,text,jsonb,text)
public.reconcile_registration_customer_message_v1(uuid,uuid,text,jsonb,text,text)
```

For the two observation kinds, `p_source_id` is always the observation ID. `source_task` resolves task through observation; preview INSERT persists `observation_id`, `track_id`, and `appointment_id`; claim chooses source identity in exact priority `observation_id → appointment_id → track_id → task_id`, copies `observation_id` into the durable message, and builds dedupe/current checks from `observation_id + appointment notification revision + message_kind`. Manual claim accepts `observation_booking` only; a manually created `observation_reminder` preview is view-only readiness evidence and claim fails with `registration_customer_message_delivery_origin_invalid` before inserting a message. Preview-target and history return `sourceId=observation_id` and `observationId` for these kinds. `assert_current`, replay, release, reconcile, and result paths must re-resolve the stored observation source rather than silently falling back to appointment.

`public.resolve_registration_customer_message_source_v1(uuid,text,uuid)` is part of this complete replacement, not an untouched wrapper. Preserve its exact named parameters `p_actor_profile_id uuid,p_message_kind text,p_source_id uuid` and JSON result. Its first executable statement checks `(select auth.role()) = 'service_role'` and raises SQLSTATE `42501` before calling `source_task` or reading any source row; only then may it derive `task_id`, run the existing `registration_customer_message_assert_actor_v1(...,'send')`, and call the private resolver. Set owner `postgres`, keep `SECURITY DEFINER set search_path=''` with schema-qualified calls, revoke the exact signature from `PUBLIC,anon,authenticated,service_role`, and grant only `service_role`. Existing five-kind source outputs remain byte-compatible, while the two observation kinds use observation identity.

The manual provider-capable stages add an observation-only runtime fence; do not put this predicate in a shared prologue used by the existing five kinds:

```text
get_registration_customer_solapi_readiness_v1
  observation kind → read current DB runtime in this call; runtime != 1 returns
  runtimeReady=false, sendAllowed=false and blocker runtime_not_ready

claim_registration_customer_message_v1
  after locking the observation preview/source and before inserting the durable message,
  call dashboard_private.assert_registration_observation_runtime_v1(); runtime != 1 raises
  registration_observation_runtime_inactive (SQLSTATE 55000)

mark_registration_customer_message_attempt_started_v1
  after locking the observation message + exact claim/dispatch tokens and immediately before
  provider_attempt_count/started_at mutation, call the same assert helper; runtime != 1 raises;
  the transaction writes no marker
```

The route may have observed runtime `1` during preview/readiness and claim, but only the marker transaction authorizes the later provider call. A Gate B-R `1 → 0` between manual claim and marker must therefore release the pre-send claim through the existing release RPC, return the stable public pre-send failure, and keep marker/provider deltas `0`. Existing five kinds keep their current source identity and exact public/manual-readiness/manual-claim/marker result shapes; `observationId` is emitted only by the two observation-kind manual branches. All five bypass the new runtime branch and retain their exact existing readiness/claim/marker behavior even when observation runtime is `0`.

Preserve the internal-capability boundary exactly. `dashboard_private.registration_customer_message_source_task_v1(text,uuid)`, `dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)`, `dashboard_private.registration_customer_message_assert_current_v1(ops_registration_customer_messages,jsonb)`, and `dashboard_private.registration_customer_message_result_v1(uuid,boolean,boolean,boolean)` remain the sole signatures; each is owned by `postgres`, has empty fixed `search_path`, uses schema-qualified objects and an explicit service-role actor fence before protected reads, and is revoked from `PUBLIC,anon,authenticated,service_role` with **no direct EXECUTE grant**, including no grant to `service_role`. They are invoked only from the outer public capability; creating any second overload is forbidden. Each listed public privileged RPC keeps its exact current signature, is revoked from `PUBLIC,anon,authenticated,service_role`, then granted only to `service_role`, and repeats the explicit role/actor check inside its own definer body; ACL alone is never the authorization fence.

Add executable pgTAP for readiness, public source resolve, preview insert, target read, claim, same-key replay, pre-send release, marker, finalize, provider check, admin reconcile, list history, assert-current after reschedule, and canceled observation. Every observation row must retain the same source ID through the full resolve→preview→claim→history pipeline; preview/message source-shape checks must pass and provider attempt remains zero until the explicit marker case. The public resolver pgTAP calls wrong role, service-role/non-operator actor, each existing kind and both observation kinds; it proves role rejection occurs before any protected source read, actor authorization remains required, exact result keys are preserved, and ACL is service-only. Add the manual Gate B-R interleaving explicitly: readiness and claim succeed at runtime `1`, a second local test connection commits runtime `0`, marker then raises `registration_observation_runtime_inactive`, release succeeds, and message marker count stays `0`. Manual readiness at runtime `0` must return the already-supported public blocker `runtime_not_ready`; route parsing must accept it without adding a readiness enum, while `runtime_inactive` remains only the internal automatic begin/current-status code. Run the five existing-kind readiness→claim→marker fixtures with runtime `0` and require their exact pre-migration result shapes and marker counts unchanged. Centralize stored-source selection in one private exact helper returning `observation_id → appointment_id → track_id → task_id`; every listed function either invokes that helper or has an executable branch test proving it cannot fall back to appointment identity. A static Node test extracts each listed function body—including the public resolver—and requires the helper/observation branch, proves the public resolver's role fence precedes `source_task`/all protected reads, proves the runtime call is inside only the observation branch of readiness/claim/marker, checks exact revoke/regrant statements, and prevents a resolver-only false GREEN. For every private capability above, pgTAP asserts exact identity arguments, `prosecdef=true`, `proconfig @> array['search_path=""']`, wrong-role SQLSTATE `42501`, zero EXECUTE for `PUBLIC,anon,authenticated,service_role`, and `count(*)=1` by `pronamespace/proname`. For the result capability, resolve `to_regprocedure('dashboard_private.registration_customer_message_result_v1(uuid,boolean,boolean,boolean)')`, require it non-null, and require `pg_catalog.oidvectortypes(pg_proc.proargtypes) = 'uuid, boolean, boolean, boolean'`; combined with the namespace/name `count(*)=1`, this proves the exact identity and overload count zero without falsely comparing named identity text to a types-only string. For each public definer it separately asserts the exact signature, same definer/search-path/role checks, no PUBLIC/anon/authenticated EXECUTE, and only the intended service-role grant.

- [ ] **Step 3B: Replace the automatic job-locked source read RPC**

Recreate the existing exact signature and grant:

```sql
create or replace function public.read_registration_customer_reminder_source_v1(
  p_job_id uuid,
  p_claim_token uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
```

The first executable guard requires `(select auth.role()) = 'service_role'` or raises SQLSTATE `42501`. Lock exactly one `dashboard_private.registration_customer_reminder_jobs` row with `job.job_id = p_job_id`, `status='claimed'`, matching unexpired claim token, and `FOR UPDATE`; never interpret `p_job_id` as an appointment ID. After that lock and before resolving any observation customer facts, the `observation_reminder` branch calls `dashboard_private.assert_registration_observation_runtime_v1()`; runtime `0` therefore raises `registration_observation_runtime_inactive` with SQLSTATE `55000` and returns no facts. The appointment branch does not call this helper. Branch only as follows:

```text
appointment_reminder → resolve_registration_customer_message_source_v1_impl('appointment_reminder', job.appointment_id)
observation_reminder → resolve_registration_customer_message_source_v1_impl('observation_reminder', job.observation_id)
```

For observation, require returned `appointmentId`, `observationId`, `sourceRevision` and `bookingFactHash` to match the locked job and current observation/appointment. A booking hash mismatch raises the stable `registration_customer_reminder_booking_fact_changed` error without returning customer facts; the route maps it to `release(...,'booking_fact_changed')`, which terminalizes the same locked identity as `source_dirty`. An ineligible/canceled source maps to `source_ineligible`. A `sessionSourceRevision` difference with the same booking hash is returned as the latest exact 17-key source and is not written here; begin owns the durable refresh counter. Revoke the exact signature from `PUBLIC,anon,authenticated,service_role`, grant only `service_role`, and retain `set search_path=''` with schema-qualified calls.

Add pgTAP proving wrong role `42501`, appointment compatibility, observation source keyed by observation ID, unrelated job ID/claim rejection, booking-hash error, revision-only latest-source return, runtime `1 → 0` after claim rejects the observation read with no marker, and no queue mutation by the generic resolver. Add a static test that extracts this function separately from the manual pipeline and requires both kind branches, `job.job_id`, `FOR UPDATE`, observation-only runtime check, explicit role guard and exact ACL.

- [ ] **Step 4: Generalize the claim result and activation gates**

`claim_registration_customer_reminder_job_v1()` must call the materializer, recover expired pre-marker leases, terminalize old marker rows and cancel pre-cutoff backlog, then inspect bounded due candidates with `FOR UPDATE SKIP LOCKED ORDER BY due_at,job_id`. Each observation candidate rechecks current DB runtime inside the claim transaction before any claim mutation; runtime other than `1` leaves that observation row pending/unclaimed and continues the bounded scan so a due legacy appointment job can still be returned. For a runtime-ready observation candidate it recomputes current `booking_fact_hash` before returning: a hash mismatch atomically sets `source_dirty/booking_fact_changed`, clears claim fields, writes no message/marker and continues to the next bounded candidate. A session revision/hash difference with the same recomputed booking hash is deliberately not terminal at claim; it is claimed so begin can issue the one durable `refresh_required`. It does not prefer one kind over the other, so existing appointment reminders cannot be starved by observation jobs. It returns:

```json
{
  "jobId": "job-uuid",
  "messageKind": "observation_reminder",
  "appointmentId": "appointment-uuid",
  "observationId": "observation-uuid",
  "claimToken": "claim-uuid",
  "sourceRevision": 4,
  "scheduledFor": "2026-08-17T09:00:00Z",
  "requestKey": "request-uuid"
}
```

The raw DB `appointment_reminder` branch remains byte-identical to the existing six-key result `jobId,appointmentId,claimToken,sourceRevision,scheduledFor,requestKey`; it must not emit `messageKind` or `observationId`. Only the new observation branch returns the eight-key JSON above. Its claim eligibility remains **activation `live` only** and retains the legacy accepted-live-test gates without reading observation runtime. `observation_reminder` requires runtime `1` and is eligible in `verification` for its exact task or in `live`; observation live additionally requires job/event time at or after `automatic_delivery_cutoff_at`. A verification observation job is claimable only when all four snapshots still match the locked activation row: `activation_mode_snapshot='verification'`, `verification_started_at=activation.updated_at`, `verification_recipient_hash=activation.verification_recipient_hash`, and `source_event.occurred_at >= verification_started_at`. A task mismatch, activation restart, or changed recipient hash cancels the pre-marker job with provider delta zero. Extend the existing activation mutation so switching only `observation_reminder` to `off` cancels its `pending | claimed` jobs and clears claim fields in the same transaction; it must not change the shared setting, cron, or any `appointment_reminder` job. A static test extracts claim/begin and rejects any predicate that permits `appointment_reminder` when activation mode is `verification`, applies the observation runtime predicate to the appointment branch, or adds either observation-only key to the raw legacy result.

The replaced `public.set_registration_customer_solapi_activation_v1(uuid,text,text,jsonb)` keeps its exact PostgREST parameter names and service-role grant. Its first access fence requires `auth.role()='service_role'`, then invokes the existing admin actor assertion before reading/updating activation; PUBLIC/anon/authenticated remain revoked. pgTAP calls it as anon/authenticated/service_role-with-non-admin/admin and proves only the final case may mutate. The private kind/cutoff helpers remain invoker or ungranted as specified in Task 1.

- [ ] **Step 5: Make begin/finalize terminal and kind aware**

Use these exact return shapes:

```sql
-- source drift before marker
jsonb_build_object(
  'allowed', false, 'messageId', null, 'dispatchToken', null,
  'currentStatus', 'source_dirty'
)

-- source revision changed but booking facts are identical; marker is not written
jsonb_build_object(
  'allowed', false, 'messageId', null, 'dispatchToken', null,
  'currentStatus', 'refresh_required'
)

-- lead-hours changed while this job was claimed; marker is not written
jsonb_build_object(
  'allowed', false, 'messageId', null, 'dispatchToken', null,
  'currentStatus', 'settings_refresh_required'
)

-- observation runtime changed to 0 after claim/read; marker is not written
jsonb_build_object(
  'allowed', false, 'messageId', null, 'dispatchToken', null,
  'currentStatus', 'runtime_inactive'
)

-- marker committed
jsonb_build_object(
  'allowed', true, 'messageId', v_message.id,
  'dispatchToken', v_message.dispatch_token,
  'currentStatus', 'pending'
)
```

`begin_registration_customer_reminder_dispatch_v1(job_id,claim_token,contract,readiness_contract)` locks by `job_id`, re-resolves source, compares appointment `notification_revision`, recomputed `bookingFactHash`, phone hash, template/PF/checksum, then inserts one scheduled message. For `observation_reminder`, after locking the job/source/activation rows and immediately before message/attempt-marker insert, it calls `dashboard_private.assert_registration_observation_runtime_v1()` inside a narrow exception block. If Gate B-R has committed `0`, that branch catches only exact `registration_observation_runtime_inactive`, clears the claim, terminalizes the job as `canceled/runtime_inactive`, returns the exact `runtime_inactive` shape above, and writes no message or marker; every other exception propagates. This check is observation-only; the legacy appointment branch keeps its previous live-only begin behavior. Before insert it requires the exact cross-row tuple `(job_id,appointment_id,message_kind,source_revision,source_identity)` to match the message tuple; the composite FK is a second non-bypassable guard. In observation verification mode the server route computes the current canonical phone HMAC with `REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER` and places it in the private `readiness_contract`; begin requires it to equal both the job snapshot and the current activation `verification_recipient_hash`. DB never receives the pepper or raw phone as rollout evidence.

When only `sessionSourceRevision` differs and `bookingFactHash` is unchanged, begin examines `source_refresh_count` under the same job lock. At `0`, it updates `session_source_revision`, sets `source_refresh_count=1`, leaves the claim/lease intact, writes no provider marker, and returns `refresh_required`. The worker must bounded-reread and re-render once, then call begin once more. If the second begin sees another revision difference while the counter is `1`, it atomically sets `source_dirty/source_revision_unstable`, clears claim fields and returns `source_dirty`; it must not rely on an unbounded application loop. Booking-hash drift at read or begin immediately maps to `source_dirty/booking_fact_changed`. Neither path calls SOLAPI. A unique message conflict returns `duplicate_locked` with `allowed=false` and never creates a second marker.

Begin also compares an observation job's `due_at` with `scheduled_for - current settings.lead_hours`. If a claimed job was skipped by the settings mutation and the value changed, begin writes no marker. If the new due is still in the future and the appointment remains at least the new lead time away, it clears the claim, updates due/available time, preserves a bounded `settings_changed` pending error and returns `settings_refresh_required`; the worker exits provider-zero and a later cron claim handles it. If the new lead time is already insufficient, begin clears the claim and terminalizes `canceled/lead_time_changed_insufficient`. The settings RPC never edits a currently claimed row behind this lock.

Generalize `release_registration_customer_reminder_job_v1` without losing the legacy retry contract: `source_ineligible → canceled/no retry`, `runtime_inactive → canceled/runtime_inactive`, `booking_fact_changed → source_dirty/booking_fact_changed`, `source_revision_unstable → source_dirty/source_revision_unstable`; every other validated nonblank error up to 120 bytes remains `pending` with a five-minute delayed retry and its `last_error_code`, and the next successful claim clears it. Release locks and updates by `job_id + claim_token` only. The worker maps only the stable observation read error `registration_observation_runtime_inactive` to `runtime_inactive`; it never maps an appointment error to this code. Add exact tests for all five branches, including the existing `source_read_failed` pending retry fixture.

Verification dispatch is intentionally supported before live activation **only for `observation_reminder`**. Begin permits that observation verification only for runtime `1`, the exact task, fresh event, unchanged activation start/hash snapshots, accepted template receipt, and current canonical recipient HMAC. Observation live keeps the runtime, accepted-live-test and cutoff gates. The legacy `appointment_reminder` branch remains live-only and behavior-compatible.

`finalize_registration_customer_reminder_dispatch_v1(p_message_id,p_dispatch_token,p_result,p_provider_result)` keeps the existing PostgREST named argument `p_message_id`. It locks that scheduled message, checks its composite job identity, and updates `jobs.job_id = message.scheduled_job_id`; it never treats the first argument as a job ID. It maps provider outcomes exactly:

```ts
const JOB_OUTCOME = {
  accepted: "completed",
  failed_hold: "completed",
  unknown: "delivery_unknown",
} as const
```

Recovery of a marker older than 15 minutes sets message `unknown`, job `delivery_unknown`, and never returns it to `pending`.

- [ ] **Step 6: Replace settings readiness without coupling automatic kinds**

Recreate these existing signatures without changing their parameters or service-role-only grants. Both begin with explicit `auth.role()='service_role'` enforcement, then invoke the existing operator/admin actor assertion for `p_actor_profile_id`; wrong service role, non-admin mutation and unrelated actor tests remain fail closed:

```sql
public.get_registration_customer_reminder_settings_v1(p_actor_profile_id uuid) returns jsonb

public.set_registration_customer_reminder_settings_v1(
  p_actor_profile_id uuid,
  p_enabled boolean,
  p_lead_hours smallint,
  p_expected_revision bigint,
  p_template_contract jsonb
) returns jsonb
```

When enabling, `p_template_contract` has one of two exact shapes. Preserve the legacy three-key object only while `observation_reminder` is OFF:

```json
{
  "templateId": "legacy-appointment-template-id",
  "pfId": "canonical-pf-id",
  "catalogChecksum": "64-lowercase-hex"
}
```

When observation reminder is `verification | live`, require the expanded object below. An active automatic kind means exactly `appointment_reminder` with activation `live`, or `observation_reminder` with activation `verification | live`. `templates` must contain every currently active automatic kind exactly once, no inactive/unknown/duplicate kind, and each tuple must match its sendable receipt exactly:

```json
{
  "templates": [
    {
      "messageKind": "appointment_reminder",
      "templateId": "appointment-template-id",
      "pfId": "canonical-pf-id",
      "catalogChecksum": "64-lowercase-hex"
    },
    {
      "messageKind": "observation_reminder",
      "templateId": "observation-template-id",
      "pfId": "canonical-pf-id",
      "catalogChecksum": "64-lowercase-hex"
    }
  ]
}
```

The settings RPC may enable the shared cron when at least one active automatic kind exists under the exact kind predicates above and has a sendable receipt; every such active kind must appear in the supplied contract. It must not require both kinds live, and appointment verification never counts as active. Preserve the existing positional signature, actor/admin checks, optimistic settings revision and exact grants. It must not call or replace `save_notification_control_plane_v2`.

When `p_lead_hours` changes while `p_enabled` is unchanged, lock the settings singleton first and update only observation jobs with `status='pending'`, `message_id is null` and no claim token. For each, recompute `due_at = scheduled_for - make_interval(hours => p_lead_hours)`: retain pending with `available_at = greatest(clock_timestamp(), due_at)` and bounded `last_error_code='settings_changed'` only when `scheduled_for >= clock_timestamp() + make_interval(hours => p_lead_hours)`; otherwise set `canceled/lead_time_changed_insufficient`, clear availability and never send late. Do not update `claimed`, `dispatching` or terminal rows for a lead-only change. A claimed observation row is handled only by the begin lock contract in Step 5 and becomes either pending for a later claim or terminal canceled, with provider delta zero. Shared ON→OFF retains the existing emergency pre-marker claim-release behavior for both automatic kinds and cannot write a marker. Add concurrency pgTAP with one pending row, one claimed row and one marker row while changing 3h→6h and 6h→3h; only the safe pending row changes inside settings, claimed changes only on begin, marker history never changes.

GET readiness returns:

```json
{
  "enabled": true,
  "leadHours": 3,
  "revision": "2",
  "updatedAt": "2026-08-09T00:00:00Z",
  "ready": true,
  "status": "ready",
  "editable": true,
  "activeKinds": ["observation_reminder"]
}
```

- [ ] **Step 7: Add a service-role readiness RPC**

```sql
create function public.inspect_registration_observation_solapi_readiness_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_schedule_base jsonb;
  v_last_succeeded_at timestamptz;
  v_result jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'registration_observation_solapi_readiness_unauthorized'
      using errcode = '42501';
  end if;

  v_schedule_base := dashboard_private.inspect_registration_customer_reminder_schedule_v1();
  select heartbeat.succeeded_at into v_last_succeeded_at
  from dashboard_private.registration_customer_reminder_worker_heartbeats heartbeat
  where heartbeat.singleton;

  select pg_catalog.jsonb_build_object(
    'runtimeReady', public.registration_observation_runtime_version() = 1,
    'settingsEnabled', settings.enabled,
    'leadHours', settings.lead_hours,
    'schedule', pg_catalog.jsonb_build_object(
      'installed', coalesce((v_schedule_base ->> 'installed')::boolean, false),
      'active', coalesce((v_schedule_base ->> 'active')::boolean, false),
      'contractReady', coalesce((v_schedule_base ->> 'contractReady')::boolean, false),
      'vaultReady', coalesce((v_schedule_base ->> 'vaultReady')::boolean, false),
      'heartbeatCurrent', v_last_succeeded_at is not null
        and v_last_succeeded_at >= pg_catalog.clock_timestamp() - interval '5 minutes',
      'lastSucceededAt', v_last_succeeded_at
    ),
    'bookingMode', booking.mode,
    'reminderMode', reminder.mode,
    'bookingReceipt', exists(select 1 from dashboard_private.registration_customer_solapi_template_receipts receipt where receipt.message_kind = 'observation_booking' and receipt.provider_status = 'sendable'),
    'reminderReceipt', exists(select 1 from dashboard_private.registration_customer_solapi_template_receipts receipt where receipt.message_kind = 'observation_reminder' and receipt.provider_status = 'sendable'),
    'reminderCutoffAt', reminder.automatic_delivery_cutoff_at,
    'observationMessages', (select count(*) from public.ops_registration_customer_messages message where message.message_kind in ('observation_booking','observation_reminder')),
    'providerAttemptMarkers', (select count(*) from public.ops_registration_customer_messages message where message.message_kind in ('observation_booking','observation_reminder') and message.provider_attempt_count = 1),
    'pending', (select count(*) from dashboard_private.registration_customer_reminder_jobs job where job.message_kind = 'observation_reminder' and job.status = 'pending'),
    'sourceDirty', (select count(*) from dashboard_private.registration_customer_reminder_jobs job where job.message_kind = 'observation_reminder' and job.status = 'source_dirty'),
    'deliveryUnknown', (select count(*) from dashboard_private.registration_customer_reminder_jobs job where job.message_kind = 'observation_reminder' and job.status = 'delivery_unknown')
  ) into v_result
  from dashboard_private.registration_customer_reminder_settings settings
  join dashboard_private.registration_customer_solapi_activation booking on booking.message_kind = 'observation_booking'
  join dashboard_private.registration_customer_solapi_activation reminder on reminder.message_kind = 'observation_reminder'
  where settings.singleton;
  return v_result;
end;
$$;
```

Set owner to `postgres`; revoke the exact signature from `PUBLIC,anon,authenticated,service_role`, then grant only `service_role`. The response never includes Vault URL/secret, recipient hash, task ID, template ID or phone. `heartbeatCurrent=false,lastSucceededAt=null` is valid while settings/cron are OFF; it becomes a readiness blocker only when automatic reminder activation is being verified/live. Preserve the existing worker freshness window exactly: `heartbeatCurrent` is true at `succeeded_at >= clock_timestamp() - interval '5 minutes'`. pgTAP must cover missing, stale (>5 minutes), the exact 5-minute boundary, and current heartbeat, exact six-key nested schedule JSON, wrong-role `42501`, `prosecdef=true`, empty `search_path`, and exact ACL.

`runtimeReady` is computed from `public.registration_observation_runtime_version()` inside this readiness RPC on every invocation; no application probe/cache value may be passed into or override it. It is operational evidence only: claim/read/begin and the manual marker transaction still repeat their own DB runtime checks.

End the dispatch migration with an inert bootstrap fence. It raises `registration_observation_solapi_inert_bootstrap_failed` and rolls back the entire migration unless `registration_observation_runtime_version() = 0`, the observation domain-event outbox/consumer ledger/observation reminder-job counts are all `0`, both observation activation rows exist in `off`, observation template receipt count is `0`, observation message count is `0`, and observation `provider_attempt_count=1` count is `0`. This fence is intentionally evaluated only at the Gate B default-OFF install boundary; later forward migrations must not copy it after live data exists.

- [ ] **Step 8: Write focused dispatch pgTAP**

Cover valid claim, wrong role, stale appointment revision, claim-time booking-hash mismatch becoming `source_dirty`, source-revision-only drift with unchanged booking hash returning `refresh_required`, `source_refresh_count 0→1`, one successful reread/rebegin, a second drift becoming terminal `source_dirty/source_revision_unstable`, read/begin booking hash drift becoming `source_dirty/booking_fact_changed`, phone drift, activation off, appointment verification rejected, observation verification scope mismatch, verification event before activation, verification activation restart, verification phone change, cutoff backlog, lead-hours pending recalculation, claimed `settings_refresh_required`, lead-time-insufficient cancellation, duplicate begin, cross-row tuple mismatch/FK failure, cancel before marker, cancel after marker, accepted, failed_hold, unknown, 15-minute recovery, and second-claim provider delta zero. Add two exact Gate B-R interleavings with local committed runtime changes: claim at `1` then set `0` before read, and claim+read at `1` then set `0` before begin; both end with message/marker/provider-ledger delta `0`, and begin returns/cancels with `runtime_inactive`. At runtime `0`, observation claim leaves its row unclaimed while a due legacy appointment fixture remains claimable with the exact old result. The source-revision-only case must assert marker count remains zero until the refreshed contract is used; every failed runtime/verification/settings case must assert provider delta zero. Re-run all five existing manual-kind marker fixtures, the legacy `pending:source_read_failed:retry` fixture and exact `p_message_id` finalize call after the full dispatch migration.

- [ ] **Step 9: Clean-apply and run focused pgTAP**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus solapi
```

Expected: clean database migration apply through the exact SOLAPI ceiling `20260809106200` succeeds; all three SOLAPI pgTAP files pass; runtime `1 → 0` interleavings create no observation marker, legacy reminder remains readable/live-only and all five manual kinds remain byte-compatible; current heartbeat fixture is true and stale/missing fixtures are false; `source_dirty`, `runtime_inactive` and `delivery_unknown` terminal fixtures are exact; provider call ledger remains empty. Dry-run output is not acceptable. Before commit, require frozen migration `test -s`, one slug path only, `git diff --check`, and a static scan showing every replaced definer has role guard/search_path/revoke/grant.

- [ ] **Step 10: Commit Task 3**

```bash
git add supabase/migrations/20260809106200_registration_observation_solapi_dispatch.sql supabase/tests/registration_observation_solapi_dispatch_test.sql tests/registration-observation-solapi-db.test.mjs
git commit -m "feat: harden observation solapi dispatch"
```

---

### Task 4: Extend the TypeScript Kind, Catalog, and Provider Contract

**Files:**
- Modify: `src/features/tasks/registration-customer-message-contract.ts`
- Modify: `src/features/tasks/server/registration-customer-message-catalog.ts`
- Modify: `src/features/tasks/server/registration-customer-message-solapi.ts`
- Create: `tests/fixtures/registration-customer-message-checksums.json`
- Create: `tests/registration-observation-customer-message-contract.test.mjs`
- Create: `tests/registration-observation-customer-message-catalog.test.mjs`
- Modify: `tests/registration-customer-message-solapi.test.mjs`

**Interfaces:**
- Consumes: Task 1 kinds; canonical campus
- Produces: exhaustive seven-kind maps; two exact templates; two env keys; transport-only location URL; exact checksums

- [ ] **Step 1: Freeze the existing five checksum contracts, then write exhaustive kind/map RED tests**

Before editing the catalog implementation, create the fixture with these literal values captured from catalog revision 4. The test imports this JSON and compares each existing entry directly; it must not recompute the expected value from the modified catalog.

```json
{
  "level_test_booking": {"template":"1728dd8275bec239e5a06f720958d4e201a6e056be4489754f1430c9ea56b4b8","content":"f8504742e86e0260027a503d68ed4e5c8a92ae1385de3848f1060805e28f0ed8","variables":"9a93b1d40c4b8607684e339d5179262c99233b638dd8d78ebbd725073ea1b123","buttons":"4132db4a607e8fb47399736430fe368e88d4b8d62dad33aa222d254815e0ebf8"},
  "visit_consultation_booking": {"template":"c756982402dfef3584bbe6a9073fcd194d932d6f4341c4d22b62ee8e5d2a2d4a","content":"9b563dc0cea1785a919593607c53e375e68d73d08a44cecb74e9fca4d1cdc099","variables":"9a93b1d40c4b8607684e339d5179262c99233b638dd8d78ebbd725073ea1b123","buttons":"4132db4a607e8fb47399736430fe368e88d4b8d62dad33aa222d254815e0ebf8"},
  "appointment_reminder": {"template":"3713cd207605f5c8357639b1cd3074aa7fc67216582df206c051f952ac015570","content":"f6f7e0b738a1cb9d785b740554bb1da6a5dacba32fb02eae59cf3eccb0cbbabe","variables":"d1dd14e70cce5d4e4025f3a3db31c992837fb4a889862080febe178396dd4886","buttons":"4132db4a607e8fb47399736430fe368e88d4b8d62dad33aa222d254815e0ebf8"},
  "waiting_notice": {"template":"a61668ff8904430c68c23cbe3ce0eaf52cfdeb56f822ef987061ebca1d93c8b5","content":"38f2fc84833d3a6865e4bb0915e1bbaf39308db55477443dcd09d4714fb8c477","variables":"f5f806d900cb27fad21389d08cacfde7dd19e4c62bd35b31acef3eac6b151c71","buttons":"30ec5a9057ec5d1a9af267e572a8163ba4dddc02b18eca7c7c7d5c553e2210a0"},
  "admission_application": {"template":"86001198056534035f96290060112abb5ae92c8ac9e4d95d9f145e69e8e9daa3","content":"83eeb5c4c33ad9e246888fa60ce13722e20d0f14884b4491756f606affaf9a08","variables":"d61e2409097e24b9629fd0593f24c749c9eec0ff5933b34152140b1ff60b99e7","buttons":"678e07dbf3595fd3da9aeacf73dbbf315d12d07b39abc490f9ced230e507156b"}
}
```

```js
assert.deepEqual(REGISTRATION_CUSTOMER_MESSAGE_KINDS, [
  "level_test_booking", "visit_consultation_booking", "appointment_reminder",
  "waiting_notice", "admission_application",
  "observation_booking", "observation_reminder",
])
assert.equal(
  REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_ENV_KEYS.observation_booking,
  "SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID",
)
assert.equal(
  REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_ENV_KEYS.observation_reminder,
  "SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID",
)
```

- [ ] **Step 2: Run the contract/catalog RED tests**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-customer-message-contract.test.mjs tests/registration-observation-customer-message-catalog.test.mjs tests/registration-customer-message-solapi.test.mjs
```

Expected: new kind and env-key assertions fail.

- [ ] **Step 3: Extend exact unions and environment maps**

```ts
export type RegistrationCustomerMessageTemplateEnvKey =
  | "SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID"

export type RegistrationCustomerMessageVariableName =
  | "학생명"
  | "예약종류"
  | "예약일시"
  | "장소"
  | "장소ID"
  | "과목"
  | "대기종류"
  | "대기내용"
  | "등록수업안내"
  | "수업명"
  | "담당선생님"

export type RegistrationCustomerMessageTransportVariableName = "학원위치URL"

export const REGISTRATION_CUSTOMER_MESSAGE_CATALOG_REVISION = 5 as const

export type RegistrationCustomerMessageTemplate = Readonly<{
  content: string
  variables: ReadonlyArray<RegistrationCustomerMessageVariableName>
  transportVariables?: ReadonlyArray<RegistrationCustomerMessageTransportVariableName>
  buttons: ReadonlyArray<RegistrationCustomerMessageButton>
}>
```

Add both env keys to `RegistrationCustomerMessageServerEnv`, production route env construction, template revision map with revision `1`, and every `Record<RegistrationCustomerMessageKind,...>` without casts that hide missing keys. Preserve every existing kind's definition and checksum byte-for-byte: absent `transportVariables` means the legacy checksum path, while the two observation kinds require exactly `['학원위치URL']`.

Use this conditional checksum payload so adding the transport contract cannot invalidate any existing receipt:

```ts
function templateChecksumPayload(template: RegistrationCustomerMessageTemplate) {
  const legacy = {
    content: template.content,
    variables: [...template.variables],
    buttons: normalizedButtons(template.buttons),
  }
  return template.transportVariables
    ? { ...legacy, transportVariables: [...template.transportVariables] }
    : legacy
}

function variableChecksumPayload(template: RegistrationCustomerMessageTemplate) {
  return template.transportVariables
    ? { body: [...template.variables], transport: [...template.transportVariables] }
    : [...template.variables]
}
```

`checksumRegistrationCustomerMessageTemplate` hashes `templateChecksumPayload(template)` and `checksums.variables` hashes `variableChecksumPayload(template)`. Assert all five pre-change template/content/variables/buttons checksums equal frozen fixture values before accepting the catalog revision bump.

- [ ] **Step 4: Add the exact booking template**

```ts
observation_booking: Object.freeze({
  kind: "observation_booking",
  content: `[팁스영어수학학원] 청강 예약 안내

안녕하세요. #{학생명} 학생의 #{과목} 청강 예약을 안내드립니다.

수업: #{수업명}
일시: #{예약일시}
장소: #{장소}
담당 선생님: #{담당선생님}

수업 준비를 위해 예약 시간에 맞춰 방문해 주세요.
일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.`,
  variables: Object.freeze(["학생명", "과목", "수업명", "예약일시", "장소", "담당선생님"] as const),
  transportVariables: Object.freeze(["학원위치URL"] as const),
  buttons: OBSERVATION_BUTTONS,
}),
```

- [ ] **Step 5: Add the exact reminder template**

```ts
observation_reminder: Object.freeze({
  kind: "observation_reminder",
  content: `[팁스영어수학학원] 청강 일정 안내

안녕하세요. #{학생명} 학생의 #{과목} 청강 일정을 다시 안내드립니다.

수업: #{수업명}
일시: #{예약일시}
장소: #{장소}
담당 선생님: #{담당선생님}

예약 시간에 맞춰 방문해 주세요.
변동사항 및 문의는 아래 문의하기 버튼을 이용해 주세요.`,
  variables: Object.freeze(["학생명", "과목", "수업명", "예약일시", "장소", "담당선생님"] as const),
  transportVariables: Object.freeze(["학원위치URL"] as const),
  buttons: OBSERVATION_BUTTONS,
}),
```

- [ ] **Step 6: Add canonical location and Channel Works buttons**

```ts
export const OBSERVATION_LOCATION_URLS = Object.freeze({
  본관: "https://map.naver.com/p/entry/place/1218797840?placePath=%3Fentry%3Dpll%26from%3Dnx%26fromNxList%3Dtrue&placeSearchOption=entry%3Dpll%26fromNxList%3Dtrue&searchType=place&c=15.00,0,0,0,dh",
  별관: "https://map.naver.com/p/search/%EC%A0%9C%EC%A3%BC%EC%88%98%ED%95%99%ED%95%99%EC%9B%90/place/1962638110?c=10.00,0,0,0,dh&placePath=%3Fentry%253Dbmp",
} as const)

const OBSERVATION_BUTTONS = Object.freeze([
  { name: "학원 위치 보기", type: "WL", linkMobile: "#{학원위치URL}", linkPc: "#{학원위치URL}" },
  { name: "문의하기", type: "WL", linkMobile: "https://tipsedu.channel.io", linkPc: "https://tipsedu.channel.io" },
] as const)
```

Renderer derives `학원위치URL` only from canonical `campus`; input containing `campus` or `학원위치URL` from a browser fails exact-key validation. Template checksum includes content, six body variables, one transport variable, and both button patterns. Rendered-button checksum includes the selected final Naver URL. Public preview/readiness/history JSON contains only button `name`, `type`, and parsed `host`; it must never contain `campus`, `학원위치URL`, `linkMobile`, or `linkPc`.

- [ ] **Step 7: Verify provider preflight and send exact keys**

The SOLAPI adapter must compare provider variables against six body variables plus `학원위치URL`, compare both buttons and URLs, and still send `disableSms: true`. Normalize provider variables with this closed algorithm: strip one optional `#{...}` wrapper; reject blank, duplicate, unknown, or missing names; validate set equality against `entry.variables + entry.transportVariables`; then reconstruct the canonical checksum input in catalog order as `{variables: entry.variables, transportVariables: entry.transportVariables}`. Provider array order alone is not drift, but duplicate or unknown keys are. Existing five kinds keep the legacy ordered-array algorithm and checksum path. Add this exact drift matrix to `tests/registration-customer-message-solapi.test.mjs`:

```js
const observationEntry = createRegistrationCustomerMessageCatalog({
  ...ENV,
  SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID: "template-observation-booking",
}).templates.observation_booking
const exactObservationTemplate = {
  templateId: observationEntry.templateId,
  channelId: PF_ID,
  status: "APPROVED",
  content: observationEntry.content,
  variables: [...observationEntry.variables, ...observationEntry.transportVariables]
    .map((name) => `#{${name}}`),
  buttons: observationEntry.buttons.map((button) => ({
    buttonName: button.name,
    buttonType: button.type,
    linkMo: button.linkMobile,
    linkPc: button.linkPc,
  })),
}
const observationDriftCases = [
  { ...exactObservationTemplate, variables: exactObservationTemplate.variables.slice(0, -1) },
  { ...exactObservationTemplate, variables: [...exactObservationTemplate.variables, "#{임의변수}"] },
  { ...exactObservationTemplate, variables: [...exactObservationTemplate.variables.slice(0, -1), exactObservationTemplate.variables[0]] },
  { ...exactObservationTemplate, buttons: [
    { ...exactObservationTemplate.buttons[0], linkMo: "https://bit.ly/tips", linkPc: "https://bit.ly/tips" },
    exactObservationTemplate.buttons[1],
  ] },
  { ...exactObservationTemplate, buttons: exactObservationTemplate.buttons.slice(0, 1) },
]
for (const changed of observationDriftCases) {
  const drift = await makeAdapter(async () => response({ templateList: [changed] }))
    .preflight({ entry: observationEntry })
  assert.deepEqual(drift, { matched: false, code: "template_drift" })
}
const reordered = { ...exactObservationTemplate, variables: [...exactObservationTemplate.variables].reverse() }
assert.equal((await makeAdapter(async () => response({ templateList: [reordered] }))
  .preflight({ entry: observationEntry })).matched, true)
```

These calls inspect provider template metadata only; the send endpoint call count remains zero. Do not claim that preflight proves the provider-side SMS fallback switch: the current template-list response does not expose that field. Automated tests separately prove every outbound request contains `kakaoOptions.disableSms === true`; Task 11 records the SOLAPI console's SMS fallback-disabled setting as manual provider evidence. Both proofs are required, and neither substitutes for the other.

- [ ] **Step 8: Run GREEN, lint, and typecheck**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-customer-message-contract.test.mjs tests/registration-observation-customer-message-catalog.test.mjs tests/registration-customer-message-solapi.test.mjs tests/registration-customer-message-contract.test.mjs tests/registration-customer-message-catalog.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/tasks/registration-customer-message-contract.ts src/features/tasks/server/registration-customer-message-catalog.ts src/features/tasks/server/registration-customer-message-solapi.ts tests/registration-observation-customer-message-contract.test.mjs tests/registration-observation-customer-message-catalog.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
```

Expected: all tests pass; TypeScript reports zero missing map keys.

- [ ] **Step 9: Commit Task 4**

```bash
git add src/features/tasks/registration-customer-message-contract.ts src/features/tasks/server/registration-customer-message-catalog.ts src/features/tasks/server/registration-customer-message-solapi.ts tests/fixtures/registration-customer-message-checksums.json tests/registration-observation-customer-message-contract.test.mjs tests/registration-observation-customer-message-catalog.test.mjs tests/registration-customer-message-solapi.test.mjs tests/registration-customer-message-contract.test.mjs tests/registration-customer-message-catalog.test.mjs
git commit -m "feat: add observation alimtalk catalog"
```

---

### Task 5: Add Strict Observation Source Normalization

**Files:**
- Modify: `src/features/tasks/server/registration-customer-message-source.ts`
- Create: `tests/registration-observation-customer-message-source.test.mjs`
- Modify: `tests/registration-customer-message-source.test.mjs`

**Interfaces:**
- Consumes: Task 3 exact DB JSON; Task 4 catalog
- Produces: `RegistrationObservationCustomerMessageFacts`; public/private source contracts; source/readiness checksums

- [ ] **Step 1: Write exact-shape and privacy RED tests**

```js
const source = await resolver.resolve({
  actorProfileId: ACTOR_ID,
  messageKind: "observation_booking",
  sourceId: OBSERVATION_ID,
})
assert.deepEqual(source.facts, {
  subjectLabel: "영어",
  className: "중2 영어 A반",
  scheduleLabel: "2026년 8월 17일 월요일 오후 6:00",
  placeLabel: "본관 301호",
  teacherLabel: "홍길동",
})
assert.equal(JSON.stringify(source).includes("01012345678"), false)
assert.equal(Object.keys(RAW).length, 17)
await assert.rejects(() => resolveRaw({ ...RAW, school: "학교" }), /source_invalid/)
await assert.rejects(() => resolveRaw({ ...RAW, subjects: ["영어", "수학"] }), /source_invalid/)
await assert.rejects(() => resolveRaw({ ...RAW, status: "scheduled" }), /source_invalid/)
```

- [ ] **Step 2: Run source RED tests**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-customer-message-contract.test.mjs tests/registration-observation-customer-message-catalog.test.mjs tests/registration-customer-message-solapi.test.mjs tests/registration-observation-customer-message-source.test.mjs
```

Expected: `registration-observation-customer-message-source.test.mjs` fails because the observation source branch is missing while the Task 4 contract/catalog tests pass.

- [ ] **Step 3: Define the exact observation facts type**

```ts
export type RegistrationObservationCustomerMessageFacts = Readonly<{
  studentName: string
  subject: RegistrationCustomerMessageSubject
  className: string
  scheduledAt: string
  place: string
  campus: "본관" | "별관"
  teacherName: string
}>
```

The raw normalizer accepts only the 17 DB keys listed in Task 3: `messageKind,sourceId,taskId,trackId,observationId,appointmentId,sourceRevision,sessionSourceRevision,bookingFactHash,studentName,parentPhoneDigits,subject,className,scheduledAt,place,campus,teacherName`. It validates UUID/RFC3339/hash/revision, the exact normalized/legacy `sessionSourceRevision` union and campus, requires `sourceId === observationId`, and requires one canonical subject string. `status` is deliberately **not** an eighteenth transport key: the DB resolver/read RPC validates scheduled appointment/observation status before returning the exact source, and the TypeScript normalizer rejects any injected `status` key.

- [ ] **Step 4: Derive private transport facts and checksums**

```ts
const transportVariables = Object.freeze({
  학원위치URL: OBSERVATION_LOCATION_URLS[facts.campus],
})
```

Include raw canonical JSON, body variables, transport variables, final body, final buttons, appointment notification revision, booking hash, recipient HMAC in `sourceFingerprint`. Return only button hosts and masked suffix publicly.

- [ ] **Step 5: Run GREEN and commit**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-customer-message-source.test.mjs tests/registration-customer-message-source.test.mjs tests/registration-observation-customer-message-catalog.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/tasks/server/registration-customer-message-source.ts tests/registration-observation-customer-message-source.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
git add src/features/tasks/server/registration-customer-message-source.ts tests/registration-observation-customer-message-source.test.mjs tests/registration-customer-message-source.test.mjs
git commit -m "feat: resolve observation customer source"
```

---

### Task 6: Connect Booking Preview, Explicit Confirmation, and Revision Lock

**Files:**
- Modify: `src/features/tasks/server/registration-customer-message-route.ts`
- Modify: `src/features/tasks/registration-observation-editor.tsx`
- Modify: `src/features/tasks/registration-alimtalk-preview-dialog.tsx`
- Create: `tests/registration-observation-customer-message-route.test.mjs`
- Modify: `tests/registration-alimtalk-preview-dialog.test.mjs`
- Modify: `tests/registration-customer-message-route.test.mjs`

**Interfaces:**
- Consumes: `{ messageKind: "observation_booking", sourceId: observationId }`; Task 5 source
- Produces: preview receipt; explicit send; sent-by/time display; revision-scoped disabled state; injectable production manual-handler factory used only by route integration tests

- [ ] **Step 1: Write manual-send RED tests**

```js
assert.deepEqual(await previewRequest.json(), {
  messageKind: "observation_booking",
  sourceId: OBSERVATION_ID,
})
assert.equal(providerCalls, 0)
assert.equal(preview.readiness.sendAllowed, false)

await confirmApprovedPreview()
assert.equal(providerCalls, 1)
await replayConfirm()
assert.equal(providerCalls, 1)
assert.equal(secondResult.idempotent, true)

const manualProduction = createProductionRegistrationCustomerMessageRouteHandlers({
  auth: fakeProductionAuth,
  environment: FIXED_VERIFICATION_ENV,
  providerFetch: countingFakeFetch,
})
const runtimeRacePreview = await manualProduction.preview(
  operatorRequest("/preview", OBSERVATION_BOOKING_TARGET),
)
assert.equal(runtimeRacePreview.status, 200)
const runtimeRacePreviewBody = await runtimeRacePreview.json()
fakeServiceDb.commitRuntimeBeforeNextMarker(0)
const runtimeRaceSend = await manualProduction.send(
  operatorRequest("/send", {
    previewId: runtimeRacePreviewBody.previewId,
    requestKey: RUNTIME_RACE_REQUEST_KEY,
  }),
)
assert.equal(runtimeRaceSend.status, 503)
assert.equal(fakeServiceDb.preSendReleaseCount, 1)
assert.equal(fakeServiceDb.observationMarkerCount, 0)
assert.equal(providerCalls, 0)
```

Add stale preview, canceled source, changed notification revision, changed booking hash, activation OFF, verification mismatch, template drift, unknown provider result, and second-click tests. Add one Gate B-R route interleaving: readiness and claim return runtime `1`, the injected service client commits runtime `0` before `mark_registration_customer_message_attempt_started_v1`, marker returns the stable runtime-inactive error, pre-send release runs once, and marker/provider counters remain `0`.

- [ ] **Step 2: Run route/dialog RED tests**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-customer-message-route.test.mjs tests/registration-alimtalk-preview-dialog.test.mjs
```

Expected: observation kind is rejected or UI action missing.

- [ ] **Step 3: Extend the production route env and source branch**

```ts
const catalog = createRegistrationCustomerMessageCatalog({
  ...existingEnv,
  SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID:
    process.env.SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID,
  SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID:
    process.env.SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID,
})
```

Preview remains creatable with `activation_off`; confirm remains disabled until runtime, activation, credentials, PF, template ID, exact receipt, source and duplicate locks all pass.

The route's task/source lookup must treat `{messageKind:"observation_booking",sourceId:observationId}` as an observation source. Replace the current appointment/track/task-only `resolveTaskId` branch with a bounded server source lookup that returns the canonical observation task ID; never reinterpret the observation UUID as an appointment UUID. Preview/history/read-target calls must preserve `sourceId === observationId` end to end. Add a route test where observation, appointment, track, and task use four distinct UUIDs and assert the task authorization check receives only the canonical task ID.

- [ ] **Step 3A: Add a manual production-handler factory test seam**

Preserve the zero-argument call used by every App Router manual endpoint, but make the existing factory accept only server/test-owned overrides:

```ts
type RegistrationCustomerMessageProductionOverrides = Readonly<{
  auth?: ReturnType<typeof createProductionRegistrationCustomerMessageAuth>
  environment?: NodeJS.ProcessEnv
  providerFetch?: typeof globalThis.fetch
}>

export function createProductionRegistrationCustomerMessageRouteHandlers(
  overrides: RegistrationCustomerMessageProductionOverrides = {},
) {
  const environment = overrides.environment ?? process.env
  const providerFetch = overrides.providerFetch ?? globalThis.fetch.bind(globalThis)
  const catalog = createRegistrationCustomerMessageCatalog({
    SOLAPI_API_KEY: environment.SOLAPI_API_KEY,
    SOLAPI_API_SECRET: environment.SOLAPI_API_SECRET,
    SOLAPI_KAKAO_PF_ID: environment.SOLAPI_KAKAO_PF_ID,
    SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID:
      environment.SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID,
    SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID:
      environment.SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID,
    SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID:
      environment.SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID,
    SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID:
      environment.SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID,
    SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID:
      environment.SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID,
    SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID:
      environment.SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID,
    SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID:
      environment.SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID,
    REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER:
      environment.REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER,
  })
  const provider = createRegistrationCustomerMessageSolapi({
    apiKey: environment.SOLAPI_API_KEY?.trim() ?? "",
    apiSecret: environment.SOLAPI_API_SECRET?.trim() ?? "",
    pfId: environment.SOLAPI_KAKAO_PF_ID?.trim() ?? "",
    fetch: providerFetch,
  })
  let defaultAuth: ReturnType<typeof createProductionRegistrationCustomerMessageAuth> | null = null
  const productionAuth = () => (
    overrides.auth
    ?? (defaultAuth ??= createProductionRegistrationCustomerMessageAuth())
  )
}
```

Use `environment` for the recipient pepper as well, and pass this exact `catalog`, `productionAuth()` and `provider.send/provider.lookup/provider.preflight` through the existing dependency object without changing handler order or public DTOs.

The injected auth supplies the fake actor/service clients through the same authenticated context shape as production; do not add a browser field, alternate send function or test-only route. `tests/registration-observation-customer-message-route.test.mjs` must call this production factory and the real `preview`/`send` handlers. With a counting fake fetch at exact `SOLAPI_SEND_MANY_URL`, prove separately:

1. runtime `0`/OFF preview returns masked suffix and approved public keys only, with raw phone/HMAC/transport URL absent and send calls `0`;
2. two same-source preview reads create no provider call, and an exact confirmation replay after one accepted synthetic response does not make a second call;
3. runtime `1` readiness+claim followed by committed runtime `0` before the marker releases pre-send state and leaves marker/send counts `0`;
4. each existing kind still produces its frozen public payload and original provider sequence without consulting observation runtime.

These are the only production-manual masked/duplicate-preview assertions. Task 9 must not import this factory or try to drive manual preview through the automatic reminder factory.

- [ ] **Step 4: Connect the saved-reservation UI**

```tsx
onOpenCustomerMessage?.({
  messageKind: "observation_booking",
  sourceId: observation.id,
})
```

Enable the button only after booking save returned the canonical observation ID/revision. Display student, masked suffix, one subject, class, KST date/time, place, teacher, exact body, two button labels/hosts and blockers. Do not serialize the campus or final button URL to the browser. `확인 후 발송` is the only provider action.

- [ ] **Step 5: Lock the same revision after send**

After an accepted/unknown/failed_hold history exists for the same observation revision, show `발송자 · 발송시각` and disable confirmation. A reschedule-created notification revision may open a new preview; feedback/domain revision changes may not.

- [ ] **Step 6: Run GREEN and commit**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-customer-message-route.test.mjs tests/registration-alimtalk-preview-dialog.test.mjs tests/registration-customer-message-route.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/tasks/server/registration-customer-message-route.ts src/features/tasks/registration-observation-editor.tsx src/features/tasks/registration-alimtalk-preview-dialog.tsx tests/registration-observation-customer-message-route.test.mjs tests/registration-customer-message-route.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
git add src/features/tasks/server/registration-customer-message-route.ts src/features/tasks/registration-observation-editor.tsx src/features/tasks/registration-alimtalk-preview-dialog.tsx tests/registration-observation-customer-message-route.test.mjs tests/registration-alimtalk-preview-dialog.test.mjs tests/registration-customer-message-route.test.mjs
git commit -m "feat: add observation booking alimtalk preview"
```

---

### Task 7: Generalize the Automatic Reminder Worker

**Files:**
- Modify: `src/features/tasks/server/registration-customer-reminder-worker.ts`
- Modify: `src/features/tasks/server/registration-customer-reminder-route.ts`
- Create: `tests/registration-observation-customer-reminder-worker.test.mjs`
- Modify: `tests/registration-customer-reminder-route.test.mjs`
- Modify: `tests/registration-customer-reminder-worker.test.mjs`

**Interfaces:**
- Consumes: Task 3 generalized claim; Task 4 catalog; Task 5 private source
- Produces: kind-aware prepare/begin/send/finalize with exactly one provider attempt

- [ ] **Step 1: Write worker transition RED tests**

```js
assert.deepEqual(claim, {
  jobId: JOB_ID,
  messageKind: "observation_reminder",
  appointmentId: APPOINTMENT_ID,
  observationId: OBSERVATION_ID,
  claimToken: CLAIM_TOKEN,
  sourceRevision: 4,
  scheduledFor: "2026-08-17T09:00:00Z",
  requestKey: REQUEST_KEY,
})
assert.deepEqual(await worker.runOnce(), {
  ok: true, processed: true, providerAttempted: true, outcome: "unknown",
})
assert.equal(sendCalls, 1)
assert.equal(finalizeCalls[0].jobStatus, "delivery_unknown")
```

Add provider-zero cases for canceled, completed, no-show, runtime `0` at claim, runtime `1 → 0` between claim/read and between read/begin, claim/read/begin booking-hash `source_dirty`, activation off, appointment verification, observation receipt drift, cutoff backlog, `settings_refresh_required`, second revision drift, and a second worker invocation after unknown. Every runtime case asserts both provider and marker deltas `0`; the same runtime fixture must not change a due legacy appointment reminder result.

- [ ] **Step 2: Run worker RED tests**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-customer-reminder-worker.test.mjs tests/registration-customer-reminder-worker.test.mjs tests/registration-customer-reminder-route.test.mjs
```

Expected: claim parser rejects `messageKind`/`observationId`.

- [ ] **Step 3: Extend exact claim and begin types**

```ts
export type RegistrationCustomerReminderClaim = Readonly<{
  jobId: string
  messageKind: "appointment_reminder" | "observation_reminder"
  appointmentId: string
  observationId: string | null
  claimToken: string
  sourceRevision: number
  scheduledFor: string
  requestKey: string
}>

export type RegistrationCustomerReminderBegin = Readonly<{
  allowed: boolean
  messageId: string | null
  dispatchToken: string | null
  currentStatus: RegistrationCustomerMessageStatus
    | "refresh_required"
    | "settings_refresh_required"
    | "runtime_inactive"
    | "source_dirty"
    | "duplicate_locked"
}>
```

`RegistrationCustomerReminderClaim` is the application-normalized union, not a promise that both raw DB branches share one JSON shape. The parser first exact-validates either the legacy six-key appointment object or the observation eight-key object; only after that validation does it synthesize `messageKind:"appointment_reminder"` and `observationId:null` for the legacy branch. Unknown/additional keys fail closed, and tests deep-equal the raw appointment fixture before asserting the normalized TypeScript value.

- [ ] **Step 4: Prepare by kind and preserve one-way marker semantics**

Use `sourceId = claim.observationId` for observation reminder and appointment ID for the legacy reminder. The production route calls the Task 3 job-locked read RPC with `claim.jobId`, never appointment ID. It maps `registration_customer_reminder_booking_fact_changed` to release code `booking_fact_changed` and `registration_customer_message_source_ineligible` to `source_ineligible`; both exit provider-zero. The private route hashes the freshly resolved canonical recipient with the server-only pepper and includes only that HMAC in begin readiness. Never log the raw phone, HMAC, or pepper.

Add `RegistrationCustomerReminderBookingFactChangedError` and `RegistrationObservationRuntimeInactiveError` beside the existing source-ineligible error. `serviceRpc(...read_registration_customer_reminder_source_v1...)` normalizes only the stable DB booking-hash code and exact `registration_observation_runtime_inactive` code into their dedicated classes. The worker catches them before generic preparation failure, calls release once with `booking_fact_changed` or `runtime_inactive`, and returns `skipped/providerAttempted=false`. Do not collapse either into retryable `pre_send_preparation_failed`.

The exact sequence is `read source → prepare → begin`. If the first begin returns `refresh_required`, perform exactly one more `read source → prepare → begin` while retaining the same claim token. The DB owns the durable `source_refresh_count`; a further drift is returned as `source_dirty`, so the worker must not start a third read or requeue it. `runtime_inactive`, `settings_refresh_required`, `source_dirty`, `duplicate_locked` or any other `allowed=false` returns without provider call. After `allowed=true`, call SOLAPI exactly once and always call finalize once; exceptions after marker finalize as `unknown` rather than release/requeue. Tests use deferred runtime/source mutations to prove a Gate B-R flip before read/begin sends nothing, the first prepared payload is never sent, the refreshed payload is sent once, double drift sends zero times, and a claimed job affected by leadHours change exits zero and is only claimable again at its recomputed due.

- [ ] **Step 5: Keep the same protected worker endpoint**

Reuse `/api/solapi/registration/reminders/worker`, `REGISTRATION_CUSTOMER_REMINDER_WORKER_SECRET`, `registration_customer_reminder_worker_url`, and `registration_customer_reminder_worker_bearer_secret`. Do not add another cron or Vault secret. Route production env adds only the two template ID keys.

Keep the zero-argument production call used by the App Router, but expose a narrow test seam on the same assembly:

```ts
type RegistrationCustomerReminderProductionOverrides = Readonly<{
  client?: SupabaseClient
  environment?: NodeJS.ProcessEnv
  providerFetch?: typeof globalThis.fetch
}>

export function createProductionRegistrationCustomerReminderRouteHandlers(
  overrides: RegistrationCustomerReminderProductionOverrides = {},
) {
  const client = overrides.client ?? serviceClient()
  const environment = overrides.environment ?? process.env
  const providerFetch = overrides.providerFetch ?? globalThis.fetch.bind(globalThis)
  // The existing catalog → source RPC → worker → SOLAPI adapter assembly uses only these locals.
}
```

The API route continues to call this with no arguments. Tests inject a fake Supabase client, exact env and counting/throwing `providerFetch`; no browser request can supply these overrides. This is the production-assembly seam consumed by Task 9, not a second mock worker.

The settings handler in the same server route derives the Task 3 RPC contract from server-only catalog entries and DB-returned `activeKinds`, never from browser template fields:

```ts
export function reminderTemplateContract(
  catalog: RegistrationCustomerMessageCatalog,
  activeKinds: ReadonlyArray<"appointment_reminder" | "observation_reminder">,
) {
  const uniqueKinds = [...new Set(activeKinds)]
  if (
    uniqueKinds.length !== activeKinds.length
    || uniqueKinds.length === 0
    || uniqueKinds.some((kind) => !["appointment_reminder", "observation_reminder"].includes(kind))
  ) {
    throw new Error("registration_customer_reminder_template_contract_invalid")
  }
  const templates = uniqueKinds.map((messageKind) => {
    const entry = catalog.templates[messageKind]
    if (!entry.templateId || !catalog.pfId) {
      throw new Error("registration_customer_reminder_not_ready")
    }
    return Object.freeze({
      messageKind,
      templateId: entry.templateId,
      pfId: catalog.pfId,
      catalogChecksum: entry.checksums.template,
    })
  })
  if (uniqueKinds.length === 1 && uniqueKinds[0] === "appointment_reminder") {
    const legacy = templates[0]
    return Object.freeze({
      templateId: legacy.templateId,
      pfId: legacy.pfId,
      catalogChecksum: legacy.catalogChecksum,
    })
  }
  return Object.freeze({ templates: Object.freeze(templates) })
}
```

Use these exact route assertions:

```js
const appointment = CATALOG.templates.appointment_reminder
const observation = CATALOG.templates.observation_reminder
assert.deepEqual(reminderTemplateContract(CATALOG, ["appointment_reminder"]), {
  templateId: appointment.templateId,
  pfId: CATALOG.pfId,
  catalogChecksum: appointment.checksums.template,
})
assert.deepEqual(reminderTemplateContract(CATALOG, ["observation_reminder"]), {
  templates: [{
    messageKind: "observation_reminder",
    templateId: observation.templateId,
    pfId: CATALOG.pfId,
    catalogChecksum: observation.checksums.template,
  }],
})
assert.equal(
  reminderTemplateContract(CATALOG, ["appointment_reminder", "observation_reminder"])
    .templates.length,
  2,
)
assert.throws(() => reminderTemplateContract(CATALOG, []), /template_contract_invalid/)
assert.throws(
  () => reminderTemplateContract(CATALOG, ["observation_reminder", "observation_reminder"]),
  /template_contract_invalid/,
)
assert.throws(
  () => reminderTemplateContract(CATALOG, ["unknown_reminder"]),
  /template_contract_invalid|not_ready/,
)
assert.equal(settingsRpcCalls, 0)
```

- [ ] **Step 6: Run GREEN and commit**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-customer-reminder-worker.test.mjs tests/registration-customer-reminder-worker.test.mjs tests/registration-customer-reminder-route.test.mjs tests/registration-customer-reminder-scheduler.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/tasks/server/registration-customer-reminder-worker.ts src/features/tasks/server/registration-customer-reminder-route.ts tests/registration-observation-customer-reminder-worker.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
git add src/features/tasks/server/registration-customer-reminder-worker.ts src/features/tasks/server/registration-customer-reminder-route.ts tests/registration-observation-customer-reminder-worker.test.mjs tests/registration-customer-reminder-route.test.mjs tests/registration-customer-reminder-worker.test.mjs
git commit -m "feat: dispatch observation reminders"
```

Expected: appointment activation `verification` is rejected, observation verification is accepted only inside its runtime/task/hash/event fence, exactly one revision refresh can precede a send, runtime/settings/source-dirty branches call the injected provider zero times, and legacy appointment worker tests remain unchanged.

---

### Task 8: Complete Exhaustive Maps, Fixtures, Settings, and Rollout UI

**Files:**
- Modify: `src/features/tasks/registration-track-fixtures.ts`
- Modify: `src/features/tasks/registration-customer-message-contract.ts`
- Modify: `src/features/tasks/registration-customer-message-service.ts`
- Modify: `src/features/tasks/server/registration-customer-message-route.ts`
- Modify: `src/features/tasks/registration-customer-message-rollout-panel.tsx`
- Modify: `src/features/notifications/registration-customer-reminder-service.ts`
- Modify: `src/features/notifications/registration-customer-reminder-settings.tsx`
- Create: `tests/registration-observation-customer-message-ui.test.mjs`
- Modify: `tests/registration-track-fixtures.test.mjs`
- Modify: `tests/registration-customer-reminder-settings.test.mjs`
- Modify: `tests/registration-customer-message-route.test.mjs`

**Interfaces:**
- Consumes: Tasks 4–7 public DTOs
- Produces: exhaustive fixture/provider-zero sources; two rollout rows; ON/OFF + 3-hour operating state

- [ ] **Step 1: Write exhaustive UI/map RED tests**

```js
assert.deepEqual(Object.keys(MESSAGE_KIND_LABELS), REGISTRATION_CUSTOMER_MESSAGE_KINDS)
assert.equal(MESSAGE_KIND_LABELS.observation_booking, "청강 예약 안내")
assert.equal(MESSAGE_KIND_LABELS.observation_reminder, "청강 리마인드")
assert.deepEqual(settings.activeKinds, ["observation_reminder"])
assert.equal(settings.leadHours, 3)
```

Assert fixture source maps contain both kinds and that the observation editor passes only observation ID.

- [ ] **Step 2: Run UI/map RED tests**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-customer-message-ui.test.mjs tests/registration-track-fixtures.test.mjs tests/registration-customer-reminder-settings.test.mjs
```

Expected: exhaustive maps or `activeKinds` parser fail.

- [ ] **Step 3: Extend rollout labels and fixture sources**

```ts
const MESSAGE_KIND_LABELS: Readonly<Record<RegistrationCustomerMessageKind, string>> = Object.freeze({
  level_test_booking: "레벨테스트 예약 안내",
  visit_consultation_booking: "방문상담 예약 안내",
  appointment_reminder: "예약 리마인드",
  waiting_notice: "대기 안내",
  admission_application: "입학신청서 안내",
  observation_booking: "청강 예약 안내",
  observation_reminder: "청강 리마인드",
})
```

Fixture sources use a single English observation, masked test number, scheduled future session, revision 1, and both modes OFF. Fixture send records never call a real provider.

Add one read-only admin action with exact input `{ "action": "inspect_observation_readiness" }`. The authenticated `POST /api/solapi/registration/admin` handler requires `admin`, calls only `inspect_registration_observation_solapi_readiness_v1()`, and returns this exact secret-free DTO:

```ts
export type RegistrationObservationSolapiScheduleReadiness = Readonly<{
  installed: boolean
  active: boolean
  contractReady: boolean
  vaultReady: boolean
  heartbeatCurrent: boolean
  lastSucceededAt: string | null
}>

export type RegistrationObservationSolapiReadiness = Readonly<{
  runtimeReady: boolean
  settingsEnabled: boolean
  leadHours: number
  schedule: RegistrationObservationSolapiScheduleReadiness
  bookingMode: "off" | "verification" | "live"
  reminderMode: "off" | "verification" | "live"
  bookingReceipt: boolean
  reminderReceipt: boolean
  reminderCutoffAt: string | null
  observationMessages: number
  providerAttemptMarkers: number
  pending: number
  sourceDirty: number
  deliveryUnknown: number
}>
```

The parser rejects extra/missing top-level **and nested schedule** keys, negative counts, invalid/non-RFC3339 `lastSucceededAt`, inconsistent `heartbeatCurrent=true` with null timestamp, raw recipient hashes, task IDs, template IDs, provider secrets and phone fields. The rollout panel has a single `상태 새로고침` action and renders installed/active/contract/Vault/heartbeat as separate aggregate facts; it never infers a receipt from an installed env name. Route tests prove a non-admin gets `403`, malformed DB output gets `500`, missing/stale/current heartbeat parses to the exact state, and the returned JSON contains no secret/private identifier keys.

- [ ] **Step 4: Extend the exact settings response**

```ts
export type RegistrationCustomerReminderSettings = Readonly<{
  enabled: boolean
  leadHours: number
  revision: string
  updatedAt: string
  ready: boolean
  status: "ready" | "approval_pending" | "scheduler_pending"
  editable: boolean
  activeKinds: ReadonlyArray<"appointment_reminder" | "observation_reminder">
}>
```

The UI shows only `자동 발송 ON/OFF`, `몇 시간 전`, readiness and active automatic kinds. Set the verification fixture to 3 hours; do not hardcode a second observation-only setting. The parser permits `appointment_reminder` in `activeKinds` only when the server has evaluated it as live, while `observation_reminder` may appear in verification or live; browser code never derives this list from activation rows itself.

When saving ON, the browser service continues to send exactly `{ enabled, leadHours, expectedRevision }`; it never receives or sends template ID, PF ID, checksum, or `templates`. The Task 7 server route owns the RPC contract derivation. Add this exact client assertion to `tests/registration-customer-reminder-settings.test.mjs`:

```js
assert.deepEqual(JSON.parse(updateRequest.body), {
  enabled: true,
  leadHours: 3,
  expectedRevision: "2",
})
assert.equal(updateRequest.body.includes("templateId"), false)
assert.equal(updateRequest.body.includes("catalogChecksum"), false)
assert.equal(updateRequest.body.includes("pfId"), false)
```

- [ ] **Step 5: Run GREEN and commit**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-customer-message-ui.test.mjs tests/registration-track-fixtures.test.mjs tests/registration-customer-reminder-settings.test.mjs tests/registration-customer-message-contract.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/tasks/registration-track-fixtures.ts src/features/tasks/registration-customer-message-rollout-panel.tsx src/features/notifications/registration-customer-reminder-service.ts src/features/notifications/registration-customer-reminder-settings.tsx tests/registration-observation-customer-message-ui.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
git add src/features/tasks/registration-track-fixtures.ts src/features/tasks/registration-customer-message-contract.ts src/features/tasks/registration-customer-message-service.ts src/features/tasks/server/registration-customer-message-route.ts src/features/tasks/registration-customer-message-rollout-panel.tsx src/features/notifications/registration-customer-reminder-service.ts src/features/notifications/registration-customer-reminder-settings.tsx tests/registration-observation-customer-message-ui.test.mjs tests/registration-track-fixtures.test.mjs tests/registration-customer-reminder-settings.test.mjs tests/registration-customer-message-route.test.mjs
git commit -m "feat: add observation solapi operations ui"
```

---

### Task 9: Prove Provider-Zero Integration and Build Readiness

**Files:**
- Create: `tests/registration-observation-solapi-provider-zero.test.mjs`
- Modify: `tests/registration-observation-solapi-db.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Tasks 1–8; core runner closed focuses `solapi-contract | solapi-queue | solapi`
- Produces: `verify:registration-observation:solapi:plan`; clean DB, provider-zero, browser-contract and build evidence

- [ ] **Step 1: Write provider-zero RED integration**

```js
import {
  createProductionRegistrationCustomerReminderRouteHandlers,
} from "../src/features/tasks/server/registration-customer-reminder-route.ts"
import { SOLAPI_SEND_MANY_URL } from "../src/features/tasks/server/registration-customer-message-solapi.ts"

let solapiSendCalls = 0
const providerFetch = async (url) => {
  if (String(url) === SOLAPI_SEND_MANY_URL) {
    solapiSendCalls += 1
    throw new Error("provider_boundary_must_remain_zero")
  }
  throw new Error(`unexpected_provider_url:${new URL(url).host}`)
}
const production = createProductionRegistrationCustomerReminderRouteHandlers({
  client: db.fakeSupabaseClient(),
  environment: FIXED_OFF_ENV,
  providerFetch,
})

await lifecycle.schedule()
await lifecycle.reschedule()
await lifecycle.cancel()
await lifecycle.scheduleAgain()
await lifecycle.attendance()
await production.worker(new Request("http://localhost/api/solapi/registration/reminders/worker", {
  method: "POST",
  headers: { Authorization: `Bearer ${FIXED_OFF_ENV.REGISTRATION_CUSTOMER_REMINDER_WORKER_SECRET}` },
}))
assert.equal(solapiSendCalls, 0)
assert.equal(await db.countMessages("observation_reminder"), 0)
assert.equal(await db.countProviderAttempts("observation_reminder"), 0)
assert.equal(await db.countConsumedDomainEvents(), 5)
```

The fake Supabase client implements the real production automatic RPC call order and exact `.abortSignal(...).retry(false)` chain; it is not a second worker implementation. This test imports only `createProductionRegistrationCustomerReminderRouteHandlers`; it does not import the manual message factory or execute preview/confirm. Run the same automatic production assembly for OFF, canceled/no-show/completed, runtime `0` at claim, Gate B-R `1 → 0` after claim and after read, appointment verification, observation activation/receipt/cutoff mismatch, claim/read/begin booking-hash drift, double revision drift, leadHours claimed refresh/cancel, verification event predating activation, verification task/hash restart, and canonical phone change. Every negative case reaches the real reminder catalog/source/worker/route/SOLAPI adapter assembly with the injected fetch available but finishes with `solapiSendCalls === 0` and observation marker delta `0`. Add one separate positive **fake-provider** refresh fixture: first begin returns `refresh_required`, second begin allows, fake fetch returns an accepted synthetic Response exactly once, and the assertion is `solapiSendCalls === 1`; it proves the refreshed reminder payload crosses the adapter once without external network. Unknown-no-retry likewise uses one synthetic fake-fetch response/throw and proves the second invocation adds zero calls. Masked manual payload, duplicate preview/replay and manual runtime-before-marker coverage live only in Task 6's production manual-handler factory test.

- [ ] **Step 2: Run provider-zero RED**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-solapi-provider-zero.test.mjs
```

Expected: orchestration script or fixture contract missing.

- [ ] **Step 3: Add the exact verification script**

```json
{
  "scripts": {
    "verify:registration-observation:solapi:plan": "node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --focus solapi"
  }
}
```

The package script intentionally remains dry-run because it omits `--execute --approved-local-db`. Add this exact runner contract assertion to `tests/registration-observation-solapi-db.test.mjs`; do not modify the core runner:

```js
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

test("core runner exposes the final cumulative SOLAPI focus", () => {
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "scripts/run-registration-observation-local-db-qa.mjs",
    "--focus",
    "solapi",
  ], { cwd: repoRoot, encoding: "utf8" })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /20260809106200/)
  assert.match(result.stdout, /registration_observation_solapi_contract_test\.sql/)
  assert.match(result.stdout, /registration_observation_solapi_queue_test\.sql/)
  assert.match(result.stdout, /registration_observation_solapi_dispatch_test\.sql/)
  assert.match(result.stdout, /dry[- ]run/i)
})
```

The runner prints only counts, fixed migration/test names, and masked IDs. It must fail if any un-injected network fetch or unexpected SOLAPI URL occurs. Add static assertions that the production assembly passes `providerFetch` to `createRegistrationCustomerMessageSolapi`, the provider adapter still targets exact `SOLAPI_SEND_MANY_URL`, and none of the three SOLAPI migrations contains `create or replace function public.save_notification_control_plane_v2` or its override-v2 signature.

- [ ] **Step 4: Run the complete GREEN boundary**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus solapi
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-*.test.mjs tests/registration-customer-message-*.test.mjs tests/registration-customer-reminder-*.test.mjs tests/notification-control-plane-api.test.mjs tests/notification-content-contract-db.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run lint
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run build
git diff --check
```

Expected: the executed local DB run stops exactly at `20260809106200`, all three SOLAPI pgTAP files pass, every negative automatic production-assembly case reports send-many calls and marker deltas `0`, the single explicitly allowed synthetic reminder case reports `1`, Task 6 separately keeps its manual production-factory masked/duplicate/runtime-race tests GREEN, notification-control-plane save-v2 tests still pass, and Next webpack build exits `0`. Output from `pnpm run verify:registration-observation:solapi:plan` alone is dry-run evidence and cannot satisfy this gate.

- [ ] **Step 5: Commit Task 9**

```bash
git add tests/registration-observation-solapi-provider-zero.test.mjs tests/registration-observation-solapi-db.test.mjs package.json
git commit -m "test: verify observation solapi provider zero"
```

---

## Rollout Admin API Contract

All rollout reads/mutations use the logged-in admin UI and `POST /api/solapi/registration/admin`; no shell command copies a browser bearer token. The implementation and route tests freeze these exact JSON shapes. UUIDs below are valid examples; the UI substitutes the selected task/message IDs and a fresh `crypto.randomUUID()` request key for every distinct mutation.

```json
{"action":"inspect_observation_readiness"}
{"action":"preflight_template","messageKind":"observation_booking"}
{"action":"set_activation","messageKind":"observation_booking","mode":"verification","verificationTaskId":"11111111-1111-4111-8111-111111111111","requestKey":"22222222-2222-4222-8222-222222222222"}
{"action":"record_live_test_receipt","messageKind":"observation_booking","messageId":"33333333-3333-4333-8333-333333333333","receivedAt":"2026-08-09T12:00:00.000Z","requestKey":"44444444-4444-4444-8444-444444444444"}
{"action":"set_activation","messageKind":"observation_booking","mode":"live","requestKey":"55555555-5555-4555-8555-555555555555"}
{"action":"set_activation","messageKind":"observation_booking","mode":"off","requestKey":"66666666-6666-4666-8666-666666666666"}
```

The reminder kind uses identical shapes with only `messageKind="observation_reminder"` and fresh UUIDs changed. `verificationTaskId` is present only for `mode="verification"`; `preflight_template` and readiness are read/provider-inspection actions without request keys; receipt/live/off each use a distinct request key. Route tests assert an extra/missing key fails before any RPC/provider call.

---

### Task 10: Apply the Reviewed DB SHA, Then Deploy the Same Code SHA with Both Kinds OFF

**Files:**
- Create: `docs/superpowers/reports/2026-08-09-registration-observation-solapi-rollout.md`

**Interfaces:**
- Consumes: reviewed Tasks 1–9; master rollout Gate B activation contract; healthy Supabase; reviewed feature-branch SHA
- Produces: workflow-dispatched DB-before-code receipt; identical SHA on `main`; main-trigger no-op ledger receipt; later Production READY exact SHA; two OFF rows; provider attempts zero

- [ ] **Step 1: Record the reviewed release SHA**

```bash
git status --short --branch
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
git log --oneline origin/main..HEAD
```

Expected: clean non-`main` feature branch and only reviewed Task 1–9 plus their reviewed core/feedback/Google Chat dependencies ahead. Set `TIPS_RELEASE_SHA` to this exact reviewed head and `TIPS_FEATURE_REF` to the current branch name. If `origin/main` moved, integrate it, rerun Task 9, and choose a new reviewed SHA before any DB dispatch. After this release's code/DB are READY, run the master Gate B sequence in exact order: explicit classroom campus backfill, schema/SOLAPI readiness, runtime-0 smoke, runtime activation, then browser mutation smoke. It must complete before Task 11 touches SOLAPI; provider work is blocked while runtime is `0`.

- [ ] **Step 2: Publish only the reviewed feature ref, not `main`**

```bash
TIPS_RELEASE_SHA="$(git rev-parse HEAD)"
TIPS_FEATURE_REF="$(git branch --show-current)"
test -n "${TIPS_FEATURE_REF}"
test "${TIPS_FEATURE_REF}" != "main"
git push origin "${TIPS_RELEASE_SHA}:refs/heads/${TIPS_FEATURE_REF}"
test "$(git ls-remote origin "refs/heads/${TIPS_FEATURE_REF}" | cut -f1)" = "${TIPS_RELEASE_SHA}"
test "$(git ls-remote origin refs/heads/main | cut -f1)" != "${TIPS_RELEASE_SHA}"
```

Expected: the reviewed commit exists at one remote feature ref while `main` still points to the pre-release SHA. This push must not be interpreted as an application Production release.

- [ ] **Step 3: Consume the master Gate B preflight, dispatch the exact feature ref, and diff the full ledger**

This subordinate plan does not redefine Gate B. For this first installation, the only valid pre-dispatch installation baseline is the exact token `not_installed`; do not require runtime `0` before the runtime relation exists. A trusted read-only catalog receipt earns `not_installed` only when `dashboard_private.registration_observation_runtime_settings`, `dashboard_private.registration_observation_domain_events`, `dashboard_private.google_chat_profile_identities`, `dashboard_private.registration_observation_chat_jobs`, and `dashboard_private.registration_observation_solapi_event_consumptions` are all absent, no observation provider attempt exists, the complete remote-only migration set is empty (`remote-only=0`), and the linked ledger shows all seventeen reviewed migrations below as local-only pending in this exact order, including profile mention foundation `20260809104500` before Google Chat `20260809105000`, with unreviewed pending count exactly `0`. The added `20260809102200`, `20260809102400`, and `20260809102450` rows are reviewed prerequisites, while `20260812002019` and `20260812003000` are reviewed follow-up fixes; none is an unreviewed extra. A partial object set, any remote-only version, any one remote version from this set, an unreadable catalog/ledger, or any attempt count makes the baseline `drifted`, not `not_installed`, and blocks dispatch. If a future rollout starts from an already installed schema, it must use the master's separate exact-token `installed_runtime0` preflight; the first-install exception cannot be reused. Freeze this receipt and `TIPS_RELEASE_SHA` before the first `gh workflow run`.

Before `not_installed` is accepted, the migration-layout verifier must also prove that these nine remote-history-aligned source identities are present locally with their exact SHA-256 values; they are already represented in the remote ledger and are not additions to the seventeen local-only pending rows:

- `20260807030434`: `53e0d49c96c9ea38418e082370755a071ab75d3d44fe7b12c6240eb44fd6945e`
- `20260807111442`: `e367278104df0fad8d74e17cafd7eb0fd24baa90e32efb1cdec18e0cb8ac6b5b`
- `20260807125038`: `3cb54293dbef73b0eccbc92e14bda2e7f51d2c51e0a55d927daa8192ce720f37`
- `20260808044202`: `06f57db749b84e41d4647ce44d231633a1ad2f54da9b2149cd93bd33349990bb`
- `20260808050410`: `068349ad45c5c230a45c789d70fab3ce7b1c19e69ea6f958c68f921941048004`
- `20260808124315`: `c75e570cb032c5d4d7ec266b2128d103618a0490e293255aab6f688d71574ef0`
- `20260811142055`: `340b7d2c8d53ade12c7a2f9df98669218826d56a8b6e02f920e897788378d547`
- `20260811142152`: `e5abe58f49fe926eb3e35a4471cd9adb49c052f0d677453ffd0f48d80a88c491`
- `20260811142353`: `aa177ab5d3151d7f2fa55883f7efc8526999828ee5cbd210693f5ddafc09fc30`

```bash
TIPS_SUPABASE_CLI=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go
test "$("${TIPS_SUPABASE_CLI}" --version)" = "2.103.0"
TIPS_LEDGER_BEFORE_DISPATCH="$(mktemp)"
"${TIPS_SUPABASE_CLI}" migration list --linked > "${TIPS_LEDGER_BEFORE_DISPATCH}"
TIPS_REMOTE_ONLY_BEFORE_DISPATCH="$(mktemp)"
awk -F '|' '{
  local_version=$1
  remote_version=$2
  gsub(/[[:space:]]/, "", local_version)
  gsub(/[[:space:]]/, "", remote_version)
  if (local_version == "" && remote_version ~ /^[0-9]+$/ && length(remote_version) == 14) print remote_version
}' "${TIPS_LEDGER_BEFORE_DISPATCH}" > "${TIPS_REMOTE_ONLY_BEFORE_DISPATCH}"
test ! -s "${TIPS_REMOTE_ONLY_BEFORE_DISPATCH}"
TIPS_PENDING_BEFORE_DISPATCH="$(mktemp)"
awk -F '|' '{
  local_version=$1
  remote_version=$2
  gsub(/[[:space:]]/, "", local_version)
  gsub(/[[:space:]]/, "", remote_version)
  if (local_version ~ /^[0-9]+$/ && length(local_version) == 14 && remote_version == "") print local_version
}' "${TIPS_LEDGER_BEFORE_DISPATCH}" > "${TIPS_PENDING_BEFORE_DISPATCH}"
TIPS_EXPECTED_PENDING="$(mktemp)"
printf '%s\n' \
  20260809100000 \
  20260809101000 \
  20260809102000 \
  20260809102200 \
  20260809102400 \
  20260809102450 \
  20260809102500 \
  20260809103000 \
  20260809103500 \
  20260809104000 \
  20260809104500 \
  20260809105000 \
  20260809106000 \
  20260809106100 \
  20260809106200 \
  20260812002019 \
  20260812003000 > "${TIPS_EXPECTED_PENDING}"
cmp -s "${TIPS_EXPECTED_PENDING}" "${TIPS_PENDING_BEFORE_DISPATCH}"
TIPS_DB_DISPATCHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
gh workflow run supabase-db-push.yml --ref "${TIPS_FEATURE_REF}"
TIPS_DB_RUN_ID="$(gh run list --workflow supabase-db-push.yml --event workflow_dispatch --branch "${TIPS_FEATURE_REF}" --commit "${TIPS_RELEASE_SHA}" --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "${TIPS_DB_RUN_ID}"
gh run watch "${TIPS_DB_RUN_ID}" --exit-status
gh run view "${TIPS_DB_RUN_ID}" --json databaseId,event,headBranch,headSha,createdAt,updatedAt,status,conclusion,jobs
TIPS_DB_COMPLETED_AT="$(gh run view "${TIPS_DB_RUN_ID}" --json updatedAt --jq '.updatedAt')"
TIPS_LEDGER_AFTER_DISPATCH="$(mktemp)"
"${TIPS_SUPABASE_CLI}" migration list --linked > "${TIPS_LEDGER_AFTER_DISPATCH}"
TIPS_PENDING_AFTER_DISPATCH="$(mktemp)"
awk -F '|' '{
  local_version=$1
  remote_version=$2
  gsub(/[[:space:]]/, "", local_version)
  gsub(/[[:space:]]/, "", remote_version)
  if (local_version ~ /^[0-9]+$/ && length(local_version) == 14 && remote_version == "") print local_version
}' "${TIPS_LEDGER_AFTER_DISPATCH}" > "${TIPS_PENDING_AFTER_DISPATCH}"
test ! -s "${TIPS_PENDING_AFTER_DISPATCH}"
TIPS_REMOTE_BEFORE_DISPATCH="$(mktemp)"
TIPS_REMOTE_AFTER_DISPATCH="$(mktemp)"
awk -F '|' '{
  remote_version=$2
  gsub(/[[:space:]]/, "", remote_version)
  if (remote_version ~ /^[0-9]+$/ && length(remote_version) == 14) print remote_version
}' "${TIPS_LEDGER_BEFORE_DISPATCH}" | LC_ALL=C sort > "${TIPS_REMOTE_BEFORE_DISPATCH}"
awk -F '|' '{
  remote_version=$2
  gsub(/[[:space:]]/, "", remote_version)
  if (remote_version ~ /^[0-9]+$/ && length(remote_version) == 14) print remote_version
}' "${TIPS_LEDGER_AFTER_DISPATCH}" | LC_ALL=C sort > "${TIPS_REMOTE_AFTER_DISPATCH}"
TIPS_APPLIED_BY_DISPATCH="$(mktemp)"
TIPS_REMOVED_BY_DISPATCH="$(mktemp)"
comm -13 "${TIPS_REMOTE_BEFORE_DISPATCH}" "${TIPS_REMOTE_AFTER_DISPATCH}" > "${TIPS_APPLIED_BY_DISPATCH}"
comm -23 "${TIPS_REMOTE_BEFORE_DISPATCH}" "${TIPS_REMOTE_AFTER_DISPATCH}" > "${TIPS_REMOVED_BY_DISPATCH}"
cmp -s "${TIPS_EXPECTED_PENDING}" "${TIPS_APPLIED_BY_DISPATCH}"
test ! -s "${TIPS_REMOVED_BY_DISPATCH}"
TIPS_LEDGER_DISPATCH_DIFF="$(mktemp)"
diff -u "${TIPS_LEDGER_BEFORE_DISPATCH}" "${TIPS_LEDGER_AFTER_DISPATCH}" > "${TIPS_LEDGER_DISPATCH_DIFF}" || test "$?" -eq 1
test -s "${TIPS_LEDGER_DISPATCH_DIFF}"
shasum -a 256 "${TIPS_LEDGER_BEFORE_DISPATCH}" "${TIPS_LEDGER_AFTER_DISPATCH}" "${TIPS_LEDGER_DISPATCH_DIFF}"
```

Require the selected run to have `event=workflow_dispatch`, `headBranch=TIPS_FEATURE_REF`, `headSha=TIPS_RELEASE_SHA`, `createdAt >= TIPS_DB_DISPATCHED_AT`, `conclusion=success`. The pre-dispatch empty remote-only file assertion and `cmp` against the seventeen explicit full 14-digit versions above are the machine gates for `remote-only=0` and the exact reviewed pending set; shorthand versions are not accepted. Together they prove no remote-only drift, inclusion and order of profile mention `20260809104500`, Google Chat `20260809105000`, the five reviewed prerequisite/follow-up rows, and unreviewed pending count `0`. After dispatch, inspect and retain the **complete** before/after ledgers, unified diff, three hashes, exact applied-version delta and empty removed-version set; checking only the three SOLAPI rows is forbidden. Each expected version must occur once remotely and no other ledger row may change.

Before `main` changes, replace—not compare byte-for-byte with—the `not_installed` receipt by an exact trusted read-only `installed_inert` receipt from the just-installed schema. It must prove `public.registration_observation_runtime_version()=0`; all eight registration-observation destination rules exist and `enabled` count is `0`; exactly seven adopted Google Chat mention-setting rows exist with the approved six ON/one OFF defaults but cannot send while rules are OFF; SOLAPI `observation_booking` and `observation_reminder` modes are both `off`; `registration_observation_domain_events`, `registration_observation_chat_jobs`, `registration_observation_solapi_event_consumptions`, and observation-reminder job counts are each `0`; `count(*)` from `dashboard_private.registration_customer_solapi_template_receipts` where `message_kind='observation_booking'` is exactly `0`; the same count where `message_kind='observation_reminder'` is exactly `0`; and observation customer-message, delivery-attempt marker, notification external-attempt audit, and actual provider-call deltas are each `0`. A combined template count or readiness booleans such as `bookingReceipt=false` / `reminderReceipt=false` are not substitutes for the two separate exact counts.

The same trusted read-only collector must export a secret-free, machine-owned receipt file after the workflow transaction with each of these three lines exactly once; a hand-authored file or operator estimate is invalid. Retain its SHA-256 and run this check before any `main` update:

```bash
test -n "${TIPS_INSTALLED_INERT_RECEIPT:-}"
test -s "${TIPS_INSTALLED_INERT_RECEIPT}"
test "$(grep -c '^installation_state=installed_inert$' "${TIPS_INSTALLED_INERT_RECEIPT}")" -eq 1
test "$(grep -c '^observation_booking_template_receipt_count=0$' "${TIPS_INSTALLED_INERT_RECEIPT}")" -eq 1
test "$(grep -c '^observation_reminder_template_receipt_count=0$' "${TIPS_INSTALLED_INERT_RECEIPT}")" -eq 1
test "$(grep -c '^observation_booking_template_receipt_count=' "${TIPS_INSTALLED_INERT_RECEIPT}")" -eq 1
test "$(grep -c '^observation_reminder_template_receipt_count=' "${TIPS_INSTALLED_INERT_RECEIPT}")" -eq 1
TIPS_INSTALLED_INERT_RECEIPT_SHA="$(shasum -a 256 "${TIPS_INSTALLED_INERT_RECEIPT}" | cut -d ' ' -f 1)"
test -n "${TIPS_INSTALLED_INERT_RECEIPT_SHA}"
```

The Task 3 inert bootstrap fence is necessary but not sufficient evidence: this post-workflow receipt must fail closed on a missing object, wrong rule count, non-OFF mode, either missing/nonzero per-kind template receipt count, or any nonzero outbox/consumer/job/provider value. Do not activate runtime or either provider kind. No operator command in this plan may run `supabase db push --linked`; only this reviewed GitHub workflow writes the linked DB.

- [ ] **Step 4: Fast-forward the exact DB-applied SHA to `main`**

```bash
test "$(gh run view "${TIPS_DB_RUN_ID}" --json headSha --jq '.headSha')" = "${TIPS_RELEASE_SHA}"
test "$(gh run view "${TIPS_DB_RUN_ID}" --json conclusion --jq '.conclusion')" = "success"
test "$(git ls-remote origin "refs/heads/${TIPS_FEATURE_REF}" | cut -f1)" = "${TIPS_RELEASE_SHA}"
TIPS_LEDGER_BEFORE_MAIN="$(mktemp)"
"${TIPS_SUPABASE_CLI}" migration list --linked > "${TIPS_LEDGER_BEFORE_MAIN}"
cmp -s "${TIPS_LEDGER_AFTER_DISPATCH}" "${TIPS_LEDGER_BEFORE_MAIN}"
git push origin "${TIPS_RELEASE_SHA}:refs/heads/main"
test "$(git ls-remote origin refs/heads/main | cut -f1)" = "${TIPS_RELEASE_SHA}"
```

Expected: `main` now points to the exact SHA whose DB workflow and ledger already succeeded. If branch protection requires a PR, only an exact fast-forward/rebase result with `main == TIPS_RELEASE_SHA` satisfies this step. A merge-generated different SHA invalidates the DB receipt: stop, rerun Task 9 for the new SHA, publish that SHA on a feature ref, and repeat Step 3 before updating `main`.

- [ ] **Step 5: Prove the main-trigger DB workflow was a ledger-identical no-op**

```bash
TIPS_MAIN_DB_RUN_ID="$(gh run list --workflow supabase-db-push.yml --event push --branch main --commit "${TIPS_RELEASE_SHA}" --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "${TIPS_MAIN_DB_RUN_ID}"
gh run watch "${TIPS_MAIN_DB_RUN_ID}" --exit-status
gh run view "${TIPS_MAIN_DB_RUN_ID}" --json databaseId,event,headBranch,headSha,createdAt,updatedAt,status,conclusion,jobs
test "$(gh run view "${TIPS_MAIN_DB_RUN_ID}" --json event --jq '.event')" = "push"
test "$(gh run view "${TIPS_MAIN_DB_RUN_ID}" --json headBranch --jq '.headBranch')" = "main"
test "$(gh run view "${TIPS_MAIN_DB_RUN_ID}" --json headSha --jq '.headSha')" = "${TIPS_RELEASE_SHA}"
test "$(gh run view "${TIPS_MAIN_DB_RUN_ID}" --json conclusion --jq '.conclusion')" = "success"
TIPS_MAIN_DB_COMPLETED_AT="$(gh run view "${TIPS_MAIN_DB_RUN_ID}" --json updatedAt --jq '.updatedAt')"
TIPS_MAIN_DB_LOG="$(mktemp)"
TIPS_MAIN_DB_NOOP_LINE="$(mktemp)"
gh run view "${TIPS_MAIN_DB_RUN_ID}" --log > "${TIPS_MAIN_DB_LOG}"
rg -n 'Remote database is up to date|No migrations to apply' "${TIPS_MAIN_DB_LOG}" > "${TIPS_MAIN_DB_NOOP_LINE}"
test -s "${TIPS_MAIN_DB_NOOP_LINE}"
TIPS_LEDGER_AFTER_MAIN="$(mktemp)"
"${TIPS_SUPABASE_CLI}" migration list --linked > "${TIPS_LEDGER_AFTER_MAIN}"
cmp -s "${TIPS_LEDGER_BEFORE_MAIN}" "${TIPS_LEDGER_AFTER_MAIN}"
cmp -s "${TIPS_LEDGER_AFTER_DISPATCH}" "${TIPS_LEDGER_AFTER_MAIN}"
shasum -a 256 "${TIPS_MAIN_DB_LOG}" "${TIPS_MAIN_DB_NOOP_LINE}" "${TIPS_LEDGER_BEFORE_MAIN}" "${TIPS_LEDGER_AFTER_MAIN}"
```

Expected: the push-trigger run has `event=push`, `headBranch=main`, `headSha=TIPS_RELEASE_SHA`, conclusion `success`; its captured full log contains at least one exact master-approved no-op line, `Remote database is up to date` or `No migrations to apply`; and the complete read-only ledger immediately before the main push is byte-identical to the ledger after that workflow as well as the feature-dispatch receipt. Preserve both ledger files, the full log, the extracted exact line, hashes and both successful `cmp` results. A second applied row, drift, empty/missing exact no-op line, or unequal ledger stops before Vercel/activation.

Do not run pgTAP or synthetic mutations against Production.

- [ ] **Step 6: Accept only a later matching Vercel Production READY receipt**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js ls --prod
read -r -p "Exact TIPS_RELEASE_SHA Production deployment URL: " TIPS_RELEASE_DEPLOYMENT_URL
test -n "${TIPS_RELEASE_DEPLOYMENT_URL}"
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js inspect "${TIPS_RELEASE_DEPLOYMENT_URL}"
git ls-remote origin refs/heads/main
```

Expected: the inspected deployment has Git SHA `TIPS_RELEASE_SHA`, becomes `READY` only after the Step 3 DB success and Step 5 main no-op receipt, and owns the `tipsedu.co.kr` alias. If the automatic Production deployment became READY before `TIPS_MAIN_DB_COMPLETED_AT`, redeploy that exact immutable deployment only after Step 5, inspect the new URL/SHA/READY timestamp, and use that later URL as the release receipt. Merely waiting for DB and Vercel jobs from the same `main` push is not acceptable DB-before-code evidence.

- [ ] **Step 7: Complete the master Gate B before any provider work**

First, complete the master Gate B campus step in the deployed classroom-management UI: explicitly set `본관 | 별관` for every in-use classroom whose campus is null, without inferring from its name, and preserve the backfill receipt. Second, call `public.registration_observation_schema_readiness_v1()` and require exact `{schemaReady:true,missingObjects:[],runtimeVersion:0}`. Only after both campus and schema readiness are GREEN, invoke exact `{ "action": "inspect_observation_readiness" }` in the newly deployed logged-in admin rollout panel and record this secret-free pre-activation projection:

```json
{
  "runtimeReady": false,
  "bookingMode": "off",
  "reminderMode": "off",
  "bookingReceipt": false,
  "reminderReceipt": false,
  "observationMessages": 0,
  "providerAttemptMarkers": 0
}
```

Third, run the master admin/staff/teacher reads, runtime-0 mutation rejection, calendar runtime-0 payload/deep-link rejection, and Google Chat/SOLAPI default-OFF source/provider-zero smoke. Only after all of those pass, call the master's atomic activation RPC and verify runtime probe `1`; do not update the singleton directly. Reinvoke readiness and require the same OFF/zero values with only `runtimeReady:true`, then run one authenticated non-provider observation mutation/browser smoke and require provider-attempt delta zero. The consumed master order is exact: matching Vercel READY → explicit campus backfill → schema/SOLAPI readiness at runtime `0` and OFF/zero → runtime-0 read/mutation/provider-zero smoke → atomic activation → runtimeReady true. Readiness may not precede campus backfill, and no SOLAPI provider work occurs inside Gate B.

If any Gate B check fails before activation, keep runtime `0`, declare the failed gate and stop before Task 11. If a check fails after activation, **do not execute an immediate rollback and do not assume a rollback artifact already exists**. Enter the master plan's Gate B-R incident procedure: declare the incident; freeze activation calls, observation releases and unrelated migrations; capture the production project ref, deployed SHA, current migration head, runtime probe `1`, provider family modes/attempt counts, open-observation report and protected table count/hash evidence; then obtain the first explicit approval to generate the forward deactivation migration. Generate it only with the master's pinned-CLI path, preserve its incident timestamp, prove the reviewed SQL touches only the runtime singleton, run both isolated paths and body-hash/pgTAP checks, and obtain independent SPEC and QUALITY review. Only after that evidence is GREEN and the exact target/hash is fixed may the operator request the second explicit production-apply approval and use the existing GitHub workflow at the exact incident feature ref. Any missing first approval, independent review, or second approval blocks apply; Task 11 remains stopped throughout Gate B-R.

- [ ] **Step 8: Verify fail-closed Production**

With both new env keys absent from Preview and Production, preview may show `template_missing`; confirm send is disabled. Worker without Bearer returns `401`. Existing registration/customer messages remain operational. Observation provider attempts and receipts remain zero.

- [ ] **Step 9: Write and commit the inert rollout report**

Record separate rows for tests/build, immutable `TIPS_RELEASE_SHA`, feature-ref workflow-dispatch run/headSha/ledger receipt, main-trigger no-op run/identical ledger, later Vercel URL/SHA/READY timestamp, runtime, booking activation, reminder activation, cron/vault readiness, SOLAPI receipts and provider attempts.

```bash
git add docs/superpowers/reports/2026-08-09-registration-observation-solapi-rollout.md
git commit -m "docs: record observation solapi inert rollout"
```

This documentation commit is not `TIPS_RELEASE_SHA`. The report must retain the exact tested/deployed release SHA and its Production deployment URL for Task 12; never substitute the later docs-only `HEAD`.

---

### Task 11: Create and Submit the Two Exact SOLAPI Templates

**Files:**
- Modify: `docs/superpowers/reports/2026-08-09-registration-observation-solapi-rollout.md`

**External state:** Existing SOLAPI account/channel only; activation rows remain OFF; no send.

- [ ] **Step 1: Reconfirm the inert gate**

Read both activation rows, provider-attempt count, and Vercel env names. Expected: `off/off`, attempts `0`, both env keys absent from Preview and Production.

- [ ] **Step 2: Create `observation_booking` template**

Use Task 4 exact body, six body variables, transport-only `학원위치URL`, two buttons, information/basic category, and SMS fallback disabled. Button 1 uses `#{학원위치URL}`; button 2 is fixed `https://tipsedu.channel.io`. Capture a redacted SOLAPI console screenshot showing this template's SMS fallback switch disabled; template-list preflight cannot prove this provider-side setting.

- [ ] **Step 3: Create `observation_reminder` template**

Use Task 4 exact reminder body and the identical variable/button/fallback contract. Capture the separate redacted SMS fallback-disabled console evidence for this template too.

- [ ] **Step 4: Submit both for review and stop**

Record only template name, non-secret template ID, submission timestamp, provider status, and the redacted fallback-disabled evidence reference in the report. Do not add Vercel env or change activation while either status is pending/rejected.

- [ ] **Step 5: Commit the submission checkpoint**

The fail-closed RED boundary is a missing/rejected/pending exact template, either observation activation not OFF, an installed observation env key, or a nonzero observation provider-attempt delta. GREEN is both exact submissions recorded with fallback-disabled evidence while OFF/env-absent/provider-zero remain true; approval is not claimed yet.

```bash
git diff --check
git add docs/superpowers/reports/2026-08-09-registration-observation-solapi-rollout.md
git commit -m "docs: record observation solapi submissions"
```

This docs-only commit is not `TIPS_RELEASE_SHA`; keep it local at this checkpoint. It is pushed only as part of Task 15's cumulative `TIPS_REPORT_SHA` and is never treated as a new tested application release.

---

### Task 12: Install Each Approved Template ID, Redeploy the Exact SHA, and Record Its Receipt

**Files:**
- Modify: `docs/superpowers/reports/2026-08-09-registration-observation-solapi-rollout.md`

**External state:** Process each kind independently only when that template is provider-sendable/approved. No send; both activation rows stay OFF. A pending reminder must not block booking verification, and a pending booking template must not activate reminder.

- [ ] **Step 1: Add each approved value to Preview and Production interactively**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js env add SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID production
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js env add SOLAPI_REGISTRATION_OBSERVATION_BOOKING_TEMPLATE_ID preview
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js env add SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID production
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js env add SOLAPI_REGISTRATION_OBSERVATION_REMINDER_TEMPLATE_ID preview
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js env ls production
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js env ls preview
```

Run the Production+Preview pair only after recording that exact kind's approved/sendable provider status. Enter the value only at each CLI hidden interactive prompt; never place it in argv, shell history, command output, report, or screenshot. Expected: every approved kind's name appears in both Production and Preview with the same redacted configuration source; a pending kind's name remains absent from both. `env ls` verifies names/scopes only. Development remains absent.

- [ ] **Step 2: Verify existing worker secrets without exposing values**

Require Production names `REGISTRATION_CUSTOMER_REMINDER_WORKER_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_KAKAO_PF_ID`, `REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER`. Readiness SQL must show one canonical Vault URL and one Bearer secret, cron installed once and inactive while settings OFF.

- [ ] **Step 3: Redeploy the same tested SHA after each env addition**

```bash
read -r -p "Task 10 report release SHA: " TIPS_RELEASE_SHA
read -r -p "Task 10 exact Production deployment URL: " TIPS_TESTED_DEPLOYMENT_URL
read -r -p "Exact-SHA Preview deployment URL: " TIPS_TESTED_PREVIEW_URL
test -n "${TIPS_RELEASE_SHA}"
test -n "${TIPS_TESTED_DEPLOYMENT_URL}"
test -n "${TIPS_TESTED_PREVIEW_URL}"
test "$(git ls-remote origin refs/heads/main | cut -f1)" = "${TIPS_RELEASE_SHA}"
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js inspect "${TIPS_TESTED_DEPLOYMENT_URL}"
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js inspect "${TIPS_TESTED_PREVIEW_URL}"
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js redeploy "${TIPS_TESTED_PREVIEW_URL}" --yes
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js redeploy "${TIPS_TESTED_DEPLOYMENT_URL}" --target production --yes
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js ls --prod
git ls-remote origin refs/heads/main
```

The Preview URL must already identify the exact `TIPS_RELEASE_SHA`; if no such Preview exists, create it from that exact reviewed checkout through the existing Vercel Preview workflow and inspect its Git SHA before redeploying. Expected: Preview and Production are both `READY`; both deployment Git SHAs and remote main equal `TIPS_RELEASE_SHA`; Production aliases point to the Production deployment. Neither environment deployment changes activation from OFF.

- [ ] **Step 4: Run the authenticated template preflight for each installed kind**

Use rollout admin UI `preflight_template` for the installed kind. Require exact PF ID, template ID, approved/sendable status, body, six body variables, transport key, both buttons and checksum. Each successful preflight writes one private receipt; it must not create the other kind's receipt. Task 13 requires only the booking receipt. Task 14 requires only the reminder receipt.

- [ ] **Step 5: Prove env-ready but send-off**

Expected per installed kind: credentials/PF/template/receipt true; modes remain `off/off`; `sendAllowed=false`; previews/messages/provider attempts unchanged; outbound adapter contract has `disableSms=true`; redacted provider-console fallback-disabled evidence is attached. The uninstalled kind remains `template_missing`, receipt false, and OFF.

- [ ] **Step 6: Commit each independently approved receipt checkpoint**

For the processed kind, the RED boundary is any provider/preflight/checksum/button/env-scope/SHA mismatch or a nonzero send delta; keep that kind OFF and do not commit a GREEN claim. GREEN requires its exact Preview+Production env names, exact-SHA READY deployments, sendable receipt, OFF mode and zero-send delta, while a pending sibling remains absent/OFF. Update only redacted evidence.

```bash
git diff --check
git add docs/superpowers/reports/2026-08-09-registration-observation-solapi-rollout.md
git commit -m "docs: record observation solapi template receipt"
```

If kinds become approved at different times, run and commit this checkpoint once per kind. These docs-only commits never replace the report's immutable `TIPS_RELEASE_SHA`.

---

### Task 13: Verify One Booking Message and Activate Booking Live

**Files:**
- Modify: `docs/superpowers/reports/2026-08-09-registration-observation-solapi-rollout.md`

**Allowed provider action:** exactly one `observation_booking` send to a test registration and user-approved test number.

- [ ] **Step 1: Create one canonical test observation**

Use a marked `SOLAPI 청강 테스트` registration, one subject, one actual future class session, canonical teacher/classroom/campus, and the user-entered test number. Save and reload; record observation ID, appointment notification revision, booking hash, and masked suffix only.

- [ ] **Step 2: Enter booking verification mode**

Set only `observation_booking` to `verification` scoped to the test task. Require reminder remains OFF and provider-attempt total unchanged.

- [ ] **Step 3: Preview and explicitly confirm once**

Verify masked suffix, one subject, class, KST schedule, place, teacher, exact body, and the two button labels/hosts (`map.naver.com`, `tipsedu.channel.io`) without exposing the transport URL. Click `확인 후 발송` once.

- [ ] **Step 4: Confirm accepted and user receipt**

Require one provider attempt and one `accepted` message. Ask the user to confirm actual Kakao receipt and that the received `학원 위치 보기` button opens the canonical Naver place directly while `문의하기` opens Channel Works. If not confirmed, set booking OFF and do not resend.

- [ ] **Step 5: Record receipt and prove revision lock**

Record the accepted message with user-confirmed timestamp. Replay the request key and reopen the same revision; provider-attempt delta must remain zero and button stays locked.

- [ ] **Step 6: Transition booking from verification to live without another send**

From the current verification state, set booking directly to live using the retained accepted receipt. Require the state history `off → verification → accepted receipt → live` and provider-attempt delta zero during activation.

- [ ] **Step 7: Record evidence**

Report masked suffix, message kind, source revision, accepted provider receipt ID, user receipt timestamp, duplicate count zero, booking mode live. Do not record the full number or body with substituted personal data.

- [ ] **Step 8: Commit the booking verification checkpoint**

Any missing user receipt, non-accepted result, wrong button destination, recipient/hash drift, duplicate or provider-attempt delta other than exactly one is the RED boundary: set booking OFF and stop. GREEN is one accepted/user-confirmed booking receipt, revision replay delta zero and legal `verification → live` activation with no activation-time send.

```bash
git diff --check
git add docs/superpowers/reports/2026-08-09-registration-observation-solapi-rollout.md
git commit -m "docs: record observation booking verification"
```

This is redacted evidence only and does not change or redeploy `TIPS_RELEASE_SHA`.

---

### Task 14: Verify One Automatic 3-Hour Reminder and Activate Reminder Live

**Files:**
- Modify: `docs/superpowers/reports/2026-08-09-registration-observation-solapi-rollout.md`

**Allowed provider action:** exactly one automatic `observation_reminder` send to the same approved test number.

- [ ] **Step 1: Enter reminder verification before creating the event**

Set `observation_reminder` to verification for the test task. In reminder settings select ON and `3시간 전`; require cron active, Vault ready, heartbeat current, activeKinds contains observation reminder, and provider attempts unchanged.

- [ ] **Step 2: Create a fresh eligible revision**

Save or reschedule the test observation to an actual class session at least 3 hours ahead. The new domain event must occur after verification begins. Require one pending UUID job with due time exactly `starts_at - interval '3 hours'`.

- [ ] **Step 3: Prove pre-due and drift gates**

Before due: provider attempt zero. A separate source-dirty fixture must terminalize as `source_dirty` with zero provider calls; a later terminal/cancel domain event for that same fixture records consumption action `already_terminal` and must leave the job `source_dirty`, never rewrite it to `canceled`. Use a different still-`pending` fixture to prove cancel-before-marker transitions to `canceled`. In another provider-zero fixture, create an event before verification start and another whose canonical phone changes after job creation; both must be skipped/canceled before marker with zero provider calls. Do not alter the real test revision or test recipient.

- [ ] **Step 4: Observe the automatic due send once**

After due, require exactly one claim, one provider marker, one provider call, message `accepted`, job `completed`, and no second claim.

- [ ] **Step 5: Confirm user receipt and record it**

Ask the user to confirm the Kakao reminder. If not confirmed, set only observation reminder OFF; keep shared cron/settings unchanged for existing appointment reminders; do not resend. On confirmation, record the live-test receipt.

- [ ] **Step 6: Activate from verification with cutoff and clear pre-live backlog**

From the current verification state, set reminder directly to live using the retained accepted receipt. Require the state history `off → verification → accepted receipt → live` and non-null `automatic_delivery_cutoff_at`. Run one materializer/claim cycle and require every older pending observation job canceled as cutoff backlog with provider delta zero.

- [ ] **Step 7: Verify final live state**

Require booking live, reminder live, reminder setting ON/3h, cron one active job, Vault ready, current heartbeat, two accepted real-test messages total, duplicate zero, unknown zero, wrong-recipient zero, outbound `disableSms` violations zero, and both provider-console fallback-disabled evidence references present.

- [ ] **Step 8: Commit the reminder verification checkpoint**

Any premature/duplicate/wrong-recipient send, missing current heartbeat, non-accepted or unconfirmed receipt, stale event/hash/cutoff escape, or provider-attempt delta other than exactly one is the RED boundary: set only observation reminder OFF and stop. GREEN is one due-time accepted/user-confirmed reminder, no second claim, legal `verification → live` cutoff and old-backlog provider delta zero.

```bash
git diff --check
git add docs/superpowers/reports/2026-08-09-registration-observation-solapi-rollout.md
git commit -m "docs: record observation reminder verification"
```

This docs-only evidence commit does not change the tested/deployed release SHA.

---

### Task 15: Verify Kind-Specific Rollback and Close the Report

**Files:**
- Modify: `docs/superpowers/reports/2026-08-09-registration-observation-solapi-rollout.md`

**Interfaces:**
- Consumes: Tasks 10–14 evidence
- Produces: tested rollback actions and final separated completion evidence

- [ ] **Step 1: Verify booking-only rollback**

Set `observation_booking` from live to OFF with a fresh request key and prove manual confirm is blocked while automatic reminder readiness is unchanged. Direct `off → live` is invalid and must fail. Restore through the only legal path with two additional fresh request keys: `off → verification` using the same retained approved test task/current recipient hash, then `verification → live` using the retained accepted message/user receipt and unchanged sendable template receipt. Require provider-attempt delta zero across both restore mutations.

- [ ] **Step 2: Verify reminder-only rollback**

Set `observation_reminder` from live to OFF with a fresh request key and prove pending/claimed-before-marker observation jobs cancel, observation booking remains live, existing appointment reminder kind and shared cron are unchanged. Direct `off → live` must fail. Restore with fresh keys through `off → verification → live`, reusing the same approved test task/current recipient hash, retained accepted reminder/user receipt and unchanged sendable template receipt. The new verification start fences old events; the live transition writes a strictly newer `automatic_delivery_cutoff_at`. Run one materializer/claim cycle and require old backlog/provider delta zero and no extra customer send.

- [ ] **Step 3: Verify escalation rollback order**

Document the exact order without executing healthy destructive actions:

```text
1. affected observation kind → off
2. observation_reminder pending/claimed jobs → canceled
3. shared reminder setting → off only if the common worker itself is unsafe
4. revoke dedicated SOLAPI credential only for credential compromise
5. follow-up forward migration for DB defect; never delete audit/message rows
```

- [ ] **Step 4: Observe 24 hours**

Check Auth/API/Postgres/Vercel errors, worker heartbeat, due backlog, source_dirty, delivery_unknown, duplicates, recipient mismatch, and receipt drift. Do not treat an unchanged OFF kind as a blocker.

- [ ] **Step 5: Update and commit the final report**

The report has separate rows for:

```text
Tests/build
GitHub main SHA
Immutable application TIPS_RELEASE_SHA
Supabase migration ledger
Feature-ref DB workflow_dispatch run/headSha and main-trigger no-op ledger receipt
Vercel Preview+Production env scopes and application SHA/READY; Production aliases
Booking template receipt/activation/real receipt
Reminder template receipt/activation/real receipt
Outbound disableSms test + per-template provider-console fallback-disabled evidence
3-hour settings/cron/Vault/heartbeat
Duplicate/source_dirty/delivery_unknown counts
Kind-specific rollback proof
```

```bash
git diff --check
git add docs/superpowers/reports/2026-08-09-registration-observation-solapi-rollout.md
git commit -m "docs: record observation solapi activation"
```

- [ ] **Step 6: Publish the docs-only evidence SHA and verify its separate Production READY receipt**

The final docs commit is intentionally distinct from the tested application release. It may be pushed only after the report is complete and the 24-hour observation is GREEN:

```bash
read -r -p "Immutable application release SHA from the report: " TIPS_RELEASE_SHA
test -n "${TIPS_RELEASE_SHA}"
TIPS_REPORT_SHA="$(git rev-parse HEAD)"
test -n "${TIPS_REPORT_SHA}"
test "${TIPS_REPORT_SHA}" != "${TIPS_RELEASE_SHA}"
test "$(git diff --name-only "${TIPS_RELEASE_SHA}..${TIPS_REPORT_SHA}")" = "docs/superpowers/reports/2026-08-09-registration-observation-solapi-rollout.md"
git fetch origin main
test "$(git rev-parse origin/main)" = "${TIPS_RELEASE_SHA}"
TIPS_SUPABASE_CLI=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go
test "$("${TIPS_SUPABASE_CLI}" --version)" = "2.103.0"
TIPS_REPORT_LEDGER_BEFORE="$(mktemp)"
"${TIPS_SUPABASE_CLI}" migration list --linked > "${TIPS_REPORT_LEDGER_BEFORE}"
read -r -p "Task 10 TIPS_LEDGER_AFTER_MAIN SHA-256 from the frozen report: " TIPS_GATE_B_LEDGER_SHA256
test -n "${TIPS_GATE_B_LEDGER_SHA256}"
test "$(shasum -a 256 "${TIPS_REPORT_LEDGER_BEFORE}" | awk '{print $1}')" = "${TIPS_GATE_B_LEDGER_SHA256}"
git push origin "${TIPS_REPORT_SHA}:refs/heads/main"
test "$(git ls-remote origin refs/heads/main | cut -f1)" = "${TIPS_REPORT_SHA}"
```

This is a fast-forward of report-only commits; it does not rename `TIPS_REPORT_SHA` to `TIPS_RELEASE_SHA`, rerun provider sends, alter template env, or authorize a new DB/provider mutation. Capture the push-triggered `Push Supabase Migrations` run for `TIPS_REPORT_SHA`, require success with the same remote ledger as Task 10 and no applied migration, then require a docs-only Production deployment for exact Git SHA `TIPS_REPORT_SHA`:

```bash
TIPS_REPORT_DB_RUN_ID="$(gh run list --workflow supabase-db-push.yml --event push --branch main --commit "${TIPS_REPORT_SHA}" --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "${TIPS_REPORT_DB_RUN_ID}"
gh run watch "${TIPS_REPORT_DB_RUN_ID}" --exit-status
gh run view "${TIPS_REPORT_DB_RUN_ID}" --json event,headBranch,headSha,status,conclusion,jobs
test "$(gh run view "${TIPS_REPORT_DB_RUN_ID}" --json event --jq '.event')" = "push"
test "$(gh run view "${TIPS_REPORT_DB_RUN_ID}" --json headBranch --jq '.headBranch')" = "main"
test "$(gh run view "${TIPS_REPORT_DB_RUN_ID}" --json headSha --jq '.headSha')" = "${TIPS_REPORT_SHA}"
test "$(gh run view "${TIPS_REPORT_DB_RUN_ID}" --json conclusion --jq '.conclusion')" = "success"
TIPS_REPORT_DB_LOG="$(mktemp)"
TIPS_REPORT_DB_NOOP_LINE="$(mktemp)"
gh run view "${TIPS_REPORT_DB_RUN_ID}" --log > "${TIPS_REPORT_DB_LOG}"
rg -n 'Remote database is up to date|No migrations to apply' "${TIPS_REPORT_DB_LOG}" > "${TIPS_REPORT_DB_NOOP_LINE}"
test -s "${TIPS_REPORT_DB_NOOP_LINE}"
TIPS_REPORT_LEDGER_AFTER="$(mktemp)"
"${TIPS_SUPABASE_CLI}" migration list --linked > "${TIPS_REPORT_LEDGER_AFTER}"
cmp -s "${TIPS_REPORT_LEDGER_BEFORE}" "${TIPS_REPORT_LEDGER_AFTER}"
shasum -a 256 "${TIPS_REPORT_DB_LOG}" "${TIPS_REPORT_DB_NOOP_LINE}" "${TIPS_REPORT_LEDGER_BEFORE}" "${TIPS_REPORT_LEDGER_AFTER}"
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js ls --prod
read -r -p "Exact TIPS_REPORT_SHA Production deployment URL: " TIPS_REPORT_DEPLOYMENT_URL
test -n "${TIPS_REPORT_DEPLOYMENT_URL}"
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.local/share/npm-global/lib/node_modules/vercel/dist/vc.js inspect "${TIPS_REPORT_DEPLOYMENT_URL}"
```

Expected: report DB run `event=push`, `headBranch=main`, `headSha=TIPS_REPORT_SHA`, conclusion `success`; its captured full log contains exact no-op wording `Remote database is up to date` or `No migrations to apply`; the pre-push full ledger hash equals Task 10's frozen `TIPS_LEDGER_AFTER_MAIN` hash; and the complete read-only linked ledgers captured immediately before the report push and after the workflow are byte-identical. Preserve both ledgers, the full log, extracted line, hashes and successful `cmp`. The inspected docs-only deployment has Git SHA `TIPS_REPORT_SHA`, is `READY`, and owns the Production alias. Any missing no-op line, Gate B baseline-hash mismatch or ledger drift blocks Production/final acceptance. The final operator response reports both immutable application `TIPS_RELEASE_SHA` and evidence/deployment `TIPS_REPORT_SHA`, both Production URLs, and explicitly states that only the latter contains the final report. Do not amend the report commit to self-insert its own hash; `TIPS_REPORT_SHA` is recorded in the external final receipt after commit.

---

## Final Verification Matrix

| Boundary | Required evidence | Failure action |
|---|---|---|
| DB contract | clean apply + three focused pgTAP files PASS | keep both kinds OFF |
| Queue | lossless legacy backfill/retry, UUID job, composite message↔job identity, revision unique, event consumed once | stop migration |
| Source | exact 17-key one-subject source, job-ID-locked read, current hash/revision, bounded one refresh, no browser facts | provider call 0 |
| Booking | preview + explicit confirmation + accepted receipt + revision lock | booking OFF |
| Reminder | ON/3h, due once, accepted receipt, unknown no-retry | reminder OFF |
| Worker | cron one, Vault exact, exact heartbeat DTO/current heartbeat, leadHours reschedule fence, marker before send | common setting OFF only if shared worker unsafe |
| Vercel | Preview+Production template env scopes; application `TIPS_RELEASE_SHA` READY after DB receipt; final docs-only `TIPS_REPORT_SHA` READY and separately identified | both kinds OFF |
| SOLAPI | approved exact checksum, two buttons, `disableSms=true` | affected kind OFF |
| Privacy | masked suffix only, no full phone/secret in payload/report | stop rollout |
| Completion | two user-confirmed receipts, duplicate 0, 24h clean observation | do not claim live completion |

Completion reporting must keep code/tests, immutable application `TIPS_RELEASE_SHA`, final evidence `TIPS_REPORT_SHA`, GitHub main, DB migrations/no-op receipts, both Vercel deployment identities, template approval, booking receipt, reminder receipt, activation state, and 24-hour observation as separate facts.
