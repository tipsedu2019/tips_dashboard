# Registration Observation Feedback and Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 담당 교사의 최소권한 청강 피드백, 원장의 최종 결정, 적합 청강 회차를 이용한 등록 첫 수업일 제안을 구현한다.

**Architecture:** 핵심 예약 계획이 제공하는 observation·appointment·track 원장과 공통 domain outbox를 그대로 사용한다. 피드백·결정은 별도 SECURITY DEFINER 구현 함수와 SECURITY INVOKER 공개 wrapper가 정해진 revision과 행 잠금 순서를 검증하고, 교사는 전체 등록 task를 읽지 않는 최소 projection RPC와 전용 route만 사용한다. 등록 첫 수업일은 기존 SECURITY DEFINER enrollment 공개 wrapper 경계를 보존한 forward-only migration으로 확장해 서버가 `completed + fit + enrollment 결정 + 같은 최종 반`을 다시 검증한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase Postgres/PostgREST/RLS, Node test runner, pgTAP, ESLint

## Global Constraints

- 제품 계약의 권위는 `docs/superpowers/specs/2026-08-09-registration-observation-workflow-design.md`다.
- 이 계획은 `2026-08-09-registration-observation-core.md`가 제공하는 schema, booking RPC, runtime/readiness, 공통 client model, `dashboard_private.registration_observation_domain_events`를 선행 조건으로 한다.
- 이 계획의 completion gate가 공용 멘션 계획 `docs/superpowers/plans/2026-08-10-dashboard-google-chat-profile-mentions.md`보다 먼저 통과해야 한다. 담당 교사·원장 profile ID는 기존 canonical observation/track 사실로만 제공하며 이 계획은 Chat identity, mention setting, provider 또는 Directory를 호출하지 않는다.
- 원장 결정은 교사 피드백만으로 자동 실행하지 않는다. 담당 교사·admin/staff가 피드백을 저장한 뒤 원장 또는 admin/staff가 별도 동작으로 결정한다.
- assigned teacher에게 `ops_tasks` 또는 sibling subject track 전체 SELECT 권한을 추가하지 않는다.
- teacher 전용 read RPC에는 학생명·학년·과목·수업·일시·강의실·담당 교사·현재 피드백·revision만 포함한다. 전화번호, 학교, 문의 메모, 다른 과목과 다른 observation은 반환하지 않는다.
- 피드백 correction은 appointment `notification_revision`을 증가시키지 않는다. 원장 결정은 observation `revision`, `feedback_revision`, track `workflow_revision`을 모두 검사한다.
- 참석·피드백·결정 mutation은 공통 잠금 순서 `track → observation → appointment → domain event → mutation request`를 지킨다. request-key advisory lock은 행 잠금 전에 한 번만 획득한다.
- 참석만 기록하면 고객 reminder와 내부 3시간 준비 작업은 더 이상 발송할 수 없지만 종료 30분 후 feedback due는 유지한다. no-show 또는 feedback 제출은 남은 due를 모두 무효화한다. 실제 취소·materialization은 후속 알림 계획이 공통 outbox를 소비하며, worker는 현재 source 상태를 다시 확인한다.
- 미등록·대기·재청강 결정은 enrollment, admission, payment 행을 생성·변경·삭제하지 않는다.
- 적합 청강 회차는 첫 수업일의 제안일 뿐이다. 원장은 기존 미래 정규 회차를 선택할 수 있고 최종 저장값은 화면의 최종 선택값이다.
- 모든 DB task는 Node contract RED뿐 아니라 clean local migration apply와 focused pgTAP을 같은 task 안에서 통과해야 GREEN이다.
- 기존 migration을 수정하지 않는다. 아래 forward-only migration만 추가한다.
- 신규 `SECURITY DEFINER` 함수와 기존 definer enrollment wrapper의 replacement는 모두 `SET search_path = ''`, schema-qualified relation/function, `auth.uid()` non-null과 exact active actor/role/access 검증을 함수 본문 안에 둔다. exact signature EXECUTE는 `PUBLIC`, `anon`, `service_role`에서 revoke한다. SECURITY INVOKER public SQL wrapper가 호출하는 private impl에만 내부 chain용 `authenticated` EXECUTE를 허용하고, SECURITY DEFINER public enrollment wrapper가 owner 권한으로 호출하는 legacy/private 함수는 `authenticated`에서도 revoke한다. 외부 호출 surface는 public wrapper의 `authenticated` 최소 grant뿐이다. pgTAP은 `prosecdef`, `proconfig`, `has_function_privilege` actor matrix를 검사한다.
- enrollment canonical DML helper는 receipt/advisory/request key를 소유하지 않는다. Public rows save와 details save가 각각 기존 `(actor_id,request_key)` ledger namespace에서 자기 operation의 receipt 하나만 소유하고 replay는 DML/audit/recompute/details update를 0회 수행한다. Public rows save의 기존 `enrollment_decided|registered` source-state gate는 유지하며, details save만 기존 transaction-local `dashboard.registration_status_independent_enrollment=on` bypass를 설정할 수 있다.

### Frozen migration creation gate

각 DB task는 RED 전에 아래 자기 행의 slug로 pinned Supabase CLI `/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go` `2.103.0`의 `migration new`를 실행한다. exact frozen target이 이미 있으면 collision으로 중단한다. 생성 뒤 해당 task Step 0에 적힌 literal slug regex 결과가 한 파일인지 확인하고, exact generated path에 먼저 `git add -- "$..._generated"`한 뒤에만 `git mv --`로 exact target에 옮긴다. SQL은 그 뒤 `apply_patch`로 쓰고 target을 다시 stage한다. 동일 slug staged `ACMR` 경로가 frozen target 하나뿐이고 staged `D` source/orphan이 0개이며 `test -s`와 `git diff --cached --check`가 PASS해야 다음 단계로 간다.

| Task | exact command | immediate frozen target |
|---:|---|---|
| 1 | `supabase-go migration new registration_observation_feedback_access` | `supabase/migrations/20260809102500_registration_observation_feedback_access.sql` |
| 2 | `supabase-go migration new registration_observation_feedback_mutations` | `supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql` |
| 3 | `supabase-go migration new registration_observation_feedback_decisions` | `supabase/migrations/20260809103500_registration_observation_feedback_decisions.sql` |
| 6 | `supabase-go migration new registration_observation_enrollment_source` | `supabase/migrations/20260809104000_registration_observation_enrollment_source.sql` |

각 task의 Step 0은 위 표의 exact pair와 staged orphan gate를 완전한 command block으로 고정한다. 어떤 실패에서도 새 timestamp를 채택하거나 target을 덮어쓰지 않으며, 빈 generated file·staged source deletion·별도 timestamp orphan을 남긴 채 RED/GREEN/commit하지 않는다.

## File Responsibility Map

| File | Responsibility |
|---|---|
| `supabase/migrations/20260809102500_registration_observation_feedback_access.sql` | 최소 projection read RPC, actor access helper, explicit ACL |
| `supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql` | 참석·최초 피드백·노쇼 mutation과 audit/outbox |
| `supabase/migrations/20260809103500_registration_observation_feedback_decisions.sql` | correction·원장 결정 mutation과 audit |
| `supabase/migrations/20260809104000_registration_observation_enrollment_source.sql` | enrollment source FK/index, canonical definer bridge/trigger chain, calendar security-invoker view와 exact track-id helper forward replacement |
| `supabase/tests/registration_observation_feedback_access_test.sql` | 최소 projection actor matrix pgTAP |
| `supabase/tests/registration_observation_feedback_submit_test.sql` | 시간 경계·참석·최초 피드백·노쇼·submit revision pgTAP |
| `supabase/tests/registration_observation_feedback_decisions_test.sql` | correction·decision revision·finance-zero pgTAP |
| `supabase/tests/registration_observation_enrollment_test.sql` | 첫 수업일 observation source pgTAP |
| `src/features/tasks/registration-observation-model.ts` | feedback/detail/decision exact-key normalizer와 안정된 오류 문구 |
| `src/features/tasks/registration-observation-service.ts` | bounded read와 exact mutation RPC client |
| `src/features/tasks/registration-observation-feedback-panel.tsx` | admin/staff·원장용 피드백 확인, 대리입력, 최종 결정 UI |
| `src/features/tasks/registration-observation-editor.tsx` | core 예약 상세 안의 feedback panel slot |
| `src/features/tasks/registration-track-editor.tsx` | feedback detail load/refresh orchestration |
| `src/features/tasks/registration-track-fixtures.ts` | feedback/detail fixture shape |
| `src/features/tasks/registration-track-fixture-runtime.ts` | feedback read/mutation fixture parity |
| `src/app/admin/registration/observations/[observationId]/feedback/page.tsx` | 인증된 교사 전용 route entry |
| `src/features/tasks/registration-observation-teacher-feedback.tsx` | 담당 교사 최소 정보·참석/노쇼·적합성 제출 UI |
| `src/features/tasks/registration-track-model.js` | observation 특별 회차를 포함한 enrollment draft serialization |
| `src/features/tasks/registration-track-model.d.ts` | enrollment row/start option exact public types |
| `src/features/tasks/registration-track-service.ts` | enrollment source field mapping 및 canonical save client |
| `src/features/tasks/registration-enrollment-editor.tsx` | 최근 적합 청강 안내, 기본 선택, 원장 override |
| `src/features/tasks/registration-appointment-calendar-model.ts` | observation appointment calendar item/필터/중복 방지 |
| `src/features/tasks/registration-appointment-calendar.tsx` | 청강 필터와 정확한 detail navigation |
| `src/features/tasks/registration-workspace-route.ts` | 기존 registration query allowlist와 direct target에 observation branch 추가 |
| `src/features/tasks/ops-task-workspace.tsx` | exact single-attempt RPC 기반 observation calendar deep-link 관계 확인과 detail selection |
| `tests/registration-observation-feedback-access.test.mjs` | access migration signature/projection/ACL source contract |
| `tests/registration-observation-feedback-mutations.test.mjs` | submit/correction/decision signature·revision source contract |
| `tests/registration-observation-feedback-ui.test.mjs` | manager proxy/decision UI state contract |
| `tests/registration-observation-teacher-route.test.mjs` | dedicated route/privacy/mobile guard |
| `tests/registration-observation-enrollment-source.test.mjs` | enrollment wrapper/validator/trigger chain source contract |
| `tests/registration-observation-calendar.test.mjs` | Task 6 DB view/helper/ACL RED·GREEN, Task 8 appointment-deduped DTO/runtime/deep-link contract |
| `tests/registration-workspace-route.test.mjs` | 기존 route 회귀와 observation deep-link selection·stale query cleanup 계약 |
| `tests/registration-observation-schema.test.mjs` | readiness signature handoff regression |
| `tests/registration-observation-service.test.mjs` | feedback client exact mapping/cache/error contract |
| `tests/registration-observation-workspace.test.mjs` | manager panel integration regression |
| `tests/registration-track-fixtures.test.mjs` | feedback fixture parity regression |
| `tests/registration-track-schema.test.mjs` | enrollment source schema/wrapper regression |
| `tests/registration-track-model.test.mjs` | special start option serialization |
| `tests/registration-track-service.test.mjs` | enrollment source request/response mapping |
| `tests/registration-track-workspace.test.mjs` | first-session default/override behavior |
| `tests/registration-appointment-calendar.test.mjs` | existing calendar-kind/count regression |
| `tests/ops-task-workspace.test.mjs` | calendar deep-link workspace selection regression |
| `scripts/run-registration-observation-local-db-qa.mjs` | 선행 계획이 제공하는 clean DB runner; 이 계획은 `--focus feedback-access|feedback-submit|feedback|enrollment`를 소비 |

## Current enrollment compatibility anchors

- current public rows wrapper is `LANGUAGE plpgsql SECURITY DEFINER` in `supabase/migrations/20260729013858_continuous_class_schedule_release2_consumers.sql:119-160`;
- current public rows implementation preserves the source-state gate and details-only GUC exception in `supabase/migrations/20260803120000_registration_workflow_data_integrity.sql:149-166`;
- current details implementation sets transaction-local `dashboard.registration_status_independent_enrollment='on'` before the rows save at `supabase/migrations/20260803123000_registration_enrollment_details_canonical_bridge.sql:62-70`;
- current rows save emits `enrollment_rows_saved` and calls `recompute_registration_parent` at `supabase/migrations/20260712182834_registration_subject_track_mutations.sql:8255-8268`; current details save emits `registration_enrollment_details_saved` at `supabase/migrations/20260803123000_registration_enrollment_details_canonical_bridge.sql:78-89`;
- current mutation ledger primary key is only `(actor_id,request_key)` at `supabase/migrations/20260712172644_registration_subject_tracks_schema.sql:1437-1447`, so a receipt-free inner helper is required rather than a derived key in the same namespace.

## Consumed Core Interfaces

```sql
public.registration_observation_runtime_version() returns integer
public.registration_observation_schema_readiness_v1() returns jsonb
public.get_registration_observation_manager_detail_v1(p_track_id uuid,p_attempt_limit integer) returns jsonb
public.get_registration_observation_manager_attempt_v1(p_track_id uuid,p_observation_id uuid) returns jsonb
```

Core client also exports `loadRegistrationObservationManagerAttempt(client,{trackId,observationId})` returning exact `{trackId,taskId,observation:RegistrationObservationAttempt}`. Calendar deep-link resolution consumes this single-row RPC and never searches only the recent manager-detail attempts array.

```ts
export type RegistrationObservationDomainEventKind =
  | "observation_scheduled"
  | "observation_rescheduled"
  | "observation_canceled"
  | "observation_attendance_recorded"
  | "observation_no_show"
  | "observation_feedback_submitted"

export type RegistrationObservationFeedbackSessionSource =
  | Readonly<{
      sessionAuthority: "normalized"
      sessionKey: string
      classLessonSessionId: string
      legacySessionKey: null
      sourceRevision: Readonly<{ authority: "normalized"; sessionId: string; revision: number }>
    }>
  | Readonly<{
      sessionAuthority: "legacy"
      sessionKey: string
      classLessonSessionId: null
      legacySessionKey: string
      sourceRevision: Readonly<{ authority: "legacy"; sessionKey: string; contentHash: string }>
    }>

export type RegistrationObservationFeedbackDetail = Readonly<{
  observationId: string
  taskId: string
  trackId: string
  appointmentId: string
  studentName: string
  studentGrade: string
  subject: "영어" | "수학" | "과학"
  classId: string
  className: string
  sessionDate: string
  startsAt: string
  endsAt: string
  classroomName: string
  teacherName: string
  status: "scheduled" | "attended_feedback_pending" | "completed" | "no_show" | "canceled"
  attendance: "attended" | "no_show" | null
  suitabilityResult: "fit" | "unfit" | null
  feedbackReason: string | null
  proxySubmitted: boolean
  feedbackSubmittedByName: string | null
  feedbackSubmittedAt: string | null
  revision: number
  feedbackRevision: number
  appointmentNotificationRevision: number
  trackWorkflowRevision: number
  decisionKind: "enrollment" | "waiting_current_class" | "waiting_new_class" | "waiting_next_opening" | "not_registered" | "re_observation" | null
}> & RegistrationObservationFeedbackSessionSource
```

---

### Task 1: 최소 projection feedback read RPC와 행 단위 접근

**Files:**
- Create: `supabase/migrations/20260809102500_registration_observation_feedback_access.sql`
- Create: `tests/registration-observation-feedback-access.test.mjs`
- Create: `supabase/tests/registration_observation_feedback_access_test.sql`
- Modify: `tests/registration-observation-schema.test.mjs`

**Interfaces:**
- Consumes: `ops_registration_observations`, linked appointment/track/task/class/teacher/profile, `auth.uid()`
- Produces: `dashboard_private.assert_registration_observation_feedback_access_v1(uuid,text) returns jsonb`
- Produces: `dashboard_private.get_registration_observation_feedback_impl_v1(uuid) returns jsonb`
- Produces: `public.get_registration_observation_feedback_v1(uuid) returns jsonb`

- [ ] **Step 0: pinned CLI로 access migration을 만들고 frozen target으로 즉시 이동**

```bash
test ! -e supabase/migrations/20260809102500_registration_observation_feedback_access.sql
test "$(/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go --version)" = "2.103.0"
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go migration new registration_observation_feedback_access
registration_observation_feedback_access_generated="$(rg --files supabase/migrations | rg '/[0-9]{14}_registration_observation_feedback_access\.sql$')"
test "$(printf '%s\n' "$registration_observation_feedback_access_generated" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
git add -- "$registration_observation_feedback_access_generated"
git mv -- "$registration_observation_feedback_access_generated" supabase/migrations/20260809102500_registration_observation_feedback_access.sql
test "$(rg --files supabase/migrations | rg '/[0-9]{14}_registration_observation_feedback_access\.sql$')" = "supabase/migrations/20260809102500_registration_observation_feedback_access.sql"
test "$(git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/[0-9]{14}_registration_observation_feedback_access\.sql$')" = "supabase/migrations/20260809102500_registration_observation_feedback_access.sql"
test -z "$(git diff --cached --name-only --diff-filter=D | rg 'registration_observation_feedback_access\.sql$')"
```

이후 SQL을 `apply_patch`로 작성하고 `git add -- supabase/migrations/20260809102500_registration_observation_feedback_access.sql` 뒤 위 staged exact-one/D-zero assertions, `test -s`, `git diff --cached --check`를 재실행한다. collision/version/count/move/staged-orphan 실패는 즉시 task 중단이다.

- [ ] **Step 1: exact signature·projection·ACL RED 작성**

```js
test("feedback read exposes one observation and no contact fields", async () => {
  const sql = normalizeSql(await readFile(migrationUrl, "utf8"))
  assert.match(sql, /create function public\.get_registration_observation_feedback_v1\(p_observation_id uuid\)/)
  assert.match(sql, /studentName[\s\S]*?studentGrade[\s\S]*?subject[\s\S]*?className[\s\S]*?sessionAuthority[\s\S]*?sessionDate[\s\S]*?sourceRevision/)
  assert.doesNotMatch(sql, /parent_phone|student_phone|school_name|inquiry_note/)
  assert.match(sql, /registration_observation_not_found/)
  assert.match(sql, /revoke all on function public\.get_registration_observation_feedback_v1\(uuid\)/)
  assert.match(sql, /grant execute on function public\.get_registration_observation_feedback_v1\(uuid\) to authenticated/)
})
```

- [ ] **Step 2: RED 실행**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-feedback-access.test.mjs
```
Expected: migration이 없어 `ENOENT` 또는 public function assertion FAIL.

- [ ] **Step 3: actor helper와 read RPC 구현**

`assert_registration_observation_feedback_access_v1`은 observation 한 행을 기준으로 다음만 허용한다.

```text
assigned_teacher: auth.uid() = teacher_profile_id
manager: active admin/staff profile
director: active profile이며 track owner/director
unrelated: registration_observation_not_found (SQLSTATE P0002)
```

공개 함수는 `language sql security invoker set search_path=''` wrapper로 두고 private 구현만 `security definer set search_path=''`를 사용한다. private 구현은 첫 동작으로 `auth.uid()` non-null과 active actor를 검사한 뒤 access helper를 호출하며 모든 relation/function을 schema-qualified 한다. private/public exact signature 모두 `PUBLIC`, `anon`, `service_role`에서 revoke하고, invoker wrapper 실행에 필요한 private impl과 public wrapper exact signature만 `authenticated`에 최소 grant한다.

- [ ] **Step 4: pgTAP actor matrix 작성**

`assigned teacher`, `admin`, `staff`, `track director`, `unrelated teacher` 세션으로 읽기를 실행하고 unrelated actor는 row count 차이를 추론할 수 없는 동일 `P0002`를 받는지 검사한다. JSON key set은 다음과 정확히 같아야 한다.

```sql
array['observationId','taskId','trackId','appointmentId','studentName','studentGrade',
      'subject','classId','className','sessionAuthority','sessionDate','sessionKey',
      'classLessonSessionId','legacySessionKey','sourceRevision','startsAt','endsAt',
      'classroomName','teacherName','status','attendance','suitabilityResult','feedbackReason',
      'proxySubmitted','feedbackSubmittedByName','feedbackSubmittedAt','revision',
      'feedbackRevision','appointmentNotificationRevision','trackWorkflowRevision','decisionKind']
```

normalized branch는 `classLessonSessionId` non-null, `legacySessionKey` null, `sessionKey` nonblank, `sourceRevision.sessionId = classLessonSessionId`; legacy branch는 inverse nullability와 `sessionKey = legacySessionKey = sourceRevision.sessionKey`를 강제한다. feedback이 없으면 submitted name/time은 둘 다 null이고, 있으면 실제 제출 actor의 active profile 이름과 server `occurred_at`이 둘 다 non-null이다. `proxySubmitted`는 실제 actor가 assigned `teacher_profile_id`와 다를 때만 true다. pgTAP은 공개 wrapper invoker, private impl definer/fixed search path, PUBLIC/anon/service-role revoke, invoker chain에 필요한 private+public authenticated grant를 exact signature로 검사한다.

- [ ] **Step 5: clean DB GREEN과 커밋**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-feedback-access.test.mjs tests/registration-observation-schema.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus feedback-access
git add -- supabase/migrations/20260809102500_registration_observation_feedback_access.sql
test "$(git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/[0-9]{14}_registration_observation_feedback_access\.sql$')" = "supabase/migrations/20260809102500_registration_observation_feedback_access.sql"
test -z "$(git diff --cached --name-only --diff-filter=D | rg 'registration_observation_feedback_access\.sql$')"
test -s supabase/migrations/20260809102500_registration_observation_feedback_access.sql
git diff --cached --check
git diff --check
```
Expected: Node tests PASS; clean migration apply PASS; focused pgTAP PASS with 0 failed assertions.

Commit:
```bash
git add supabase/migrations/20260809102500_registration_observation_feedback_access.sql supabase/tests/registration_observation_feedback_access_test.sql tests/registration-observation-feedback-access.test.mjs tests/registration-observation-schema.test.mjs
git commit -m "feat: add observation feedback access"
```

---

### Task 2: 참석·최초 피드백·노쇼 원자 mutation

**Files:**
- Create: `supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql`
- Create: `tests/registration-observation-feedback-mutations.test.mjs`
- Create: `supabase/tests/registration_observation_feedback_submit_test.sql`
- Modify: `scripts/run-registration-observation-local-db-qa.mjs`
- Modify: `tests/registration-observation-local-db-runner.test.mjs`

**Interfaces:**
- Produces:

```sql
public.record_registration_observation_attendance_v1(
  p_observation_id uuid,
  p_expected_observation_revision bigint,
  p_expected_appointment_notification_revision integer,
  p_request_key text
) returns jsonb

public.submit_registration_observation_feedback_v1(
  p_observation_id uuid,
  p_attendance text,
  p_suitability_result text,
  p_feedback_reason text,
  p_expected_observation_revision bigint,
  p_expected_feedback_revision bigint,
  p_expected_appointment_notification_revision integer,
  p_request_key text
) returns jsonb
```

- [ ] **Step 0: pinned CLI로 mutation migration을 만들고 frozen target으로 즉시 이동**

```bash
test ! -e supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql
test "$(/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go --version)" = "2.103.0"
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go migration new registration_observation_feedback_mutations
registration_observation_feedback_mutations_generated="$(rg --files supabase/migrations | rg '/[0-9]{14}_registration_observation_feedback_mutations\.sql$')"
test "$(printf '%s\n' "$registration_observation_feedback_mutations_generated" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
git add -- "$registration_observation_feedback_mutations_generated"
git mv -- "$registration_observation_feedback_mutations_generated" supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql
test "$(rg --files supabase/migrations | rg '/[0-9]{14}_registration_observation_feedback_mutations\.sql$')" = "supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql"
test "$(git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/[0-9]{14}_registration_observation_feedback_mutations\.sql$')" = "supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql"
test -z "$(git diff --cached --name-only --diff-filter=D | rg 'registration_observation_feedback_mutations\.sql$')"
```

이후 SQL을 `apply_patch`로 작성하고 `git add -- supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql` 뒤 위 staged exact-one/D-zero assertions, `test -s`, `git diff --cached --check`를 재실행한다. collision/version/count/move/staged-orphan 실패는 즉시 task 중단이다.

- [ ] **Step 1: lifecycle·time boundary RED 작성**

```js
test("attendance and feedback require every approved revision", async () => {
  const sql = normalizeSql(await readFile(migrationUrl, "utf8"))
  for (const token of [
    "p_expected_observation_revision bigint",
    "p_expected_feedback_revision bigint",
    "p_expected_appointment_notification_revision integer",
  ]) assert.match(sql, new RegExp(token))
  assert.match(sql, /observation_attendance_recorded/)
  assert.match(sql, /observation_no_show|observation_feedback_submitted/)
  assert.doesNotMatch(sql, /insert into public\.ops_registration_enrollments|payment/)
})
```

같은 RED에서 runner registry의 `feedback-submit.fixture.kind === 'committed'`, exact setup/cleanup/fresh SQL manifest, `start→reset→setup→access+submit pgTAP→cleanup→fresh→stop` argv 순서와 setup/pgTAP/cleanup 실패 뒤 정리 순서를 요구한다. Task 1의 generic no-op이면 이 assertion은 반드시 FAIL한다.

- [ ] **Step 2: RED 실행**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-feedback-mutations.test.mjs
```
Expected: mutation 함수가 없어 FAIL.

- [ ] **Step 3: 공통 mutation ledger와 잠금 순서 구현**

두 mutation 모두 `(actor_id, request_key)` advisory lock 후 기존 mutation request의 fingerprint/replay를 확인한다. operation은 참석만 `record_attendance`, 참석+평가·노쇼 `submit_feedback`으로 고정한다. 신규 실행은 `track → observation → appointment` 순서로 `FOR UPDATE`하고, runtime 1, actor 권한, expected revisions, current status와 canonical server time을 검증한다. 같은 key와 같은 fingerprint는 기존 response를 반환하고 다른 fingerprint는 core와 같은 `registration_observation_request_key_conflict`를 반환한다. enrollment ceiling 전에는 full readiness가 false이므로 single-session pgTAP만 outer transaction의 local superuser fixture로 runtime singleton을 `1`로 설정하고 `ROLLBACK`한다. application/production migration에는 우회 helper나 direct UPDATE 권한을 만들지 않는다.

- [ ] **Step 4: 참석만 mutation 구현**

`record_registration_observation_attendance_v1`은 admin/staff만 호출할 수 있고 canonical 시작시각 전에는 거부한다. 성공 시 appointment=`completed`, observation=`attended_feedback_pending`, track=`observation_feedback_pending`, observation revision +1, attendance audit와 다음 outbox 한 건을 같은 transaction에 기록한다.

```json
{
  "eventKind": "observation_attendance_recorded",
  "observationId": "uuid",
  "appointmentId": "uuid",
  "notificationRevision": 3,
  "bookingFactHash": "sha256",
  "sourceRevision": {"authority":"normalized","sessionId":"uuid","revision":7}
}
```

no-show와 feedback-submitted event도 같은 observation의 exact tagged `source_revision`을 복사하며 browser 값을 받지 않는다.

성공 mutation의 revision 결과는 다음 행렬과 정확히 같다. pgTAP은 각 old/new 값을 직접 비교하고 response revision도 동일한지 검사한다.

| operation | appointment `notification_revision` | observation `revision` | observation `feedback_revision` | track `workflow_revision` |
|---|---:|---:|---:|---:|
| `record_attendance` | unchanged | `+1` | unchanged | `+1` |
| `submit_feedback` attended | unchanged | `+1` | `+1` | `+1` |
| `submit_feedback` no_show | unchanged | `+1` | unchanged | `+1` |

- [ ] **Step 5: 참석+평가·노쇼 mutation 구현**

허용 입력은 다음 두 형태뿐이다.

```ts
type FeedbackSubmission =
  | { attendance: "attended"; suitabilityResult: "fit" | "unfit"; feedbackReason: string }
  | { attendance: "no_show"; suitabilityResult: null; feedbackReason: null }
```

scheduled→attended는 시작·종료 모두 지난 뒤에만 허용하고, attended_feedback_pending→attended는 종료가 지난 뒤 허용한다. no_show는 시작 이후만 허용한다. 성공 시 appointment=`completed`, observation=`completed|no_show`, track=`observation_completed`; proxy 입력이면 원 담당자와 실제 actor를 별도 저장한다. outbox는 각각 `observation_feedback_submitted` 또는 `observation_no_show` 한 건이다.

- [ ] **Step 6: 실제 pgTAP lifecycle·race GREEN**

`registration_observation_feedback_submit_test.sql`은 시작 전 attendance/no-show, 종료 전 fit/unfit, stale observation/feedback/appointment revision, assigned teacher의 attendance-only RPC 거부와 atomic 참석+평가·노쇼 허용, unrelated teacher 거부, duplicate request replay, 같은 observation 동시 제출 하나만 성공을 검증한다. outbox unique, 위 revision 행렬, appointment/observation/track 상태가 한 transaction에서 일치하는지도 검사한다. 동시 제출은 uncommitted outer fixture를 쓰지 않는다. 이 Task가 shared runner의 `feedback-submit` registry entry를 concrete committed setup/cleanup/fresh hook으로 교체하고 그 exact argv/failure cleanup test도 추가한다. 별도 setup connection이 unique fixture IDs와 runtime `1`을 commit한 뒤 worker를 열고, 종료 시 worker disconnect → domain event/receipt/observation/appointment/track/task/profile exact IDs 역 FK delete → runtime `0`, `updated_by=null` restore → cleanup commit → fresh connection에서 runtime0와 fixture 0건 assert를 수행한다. cleanup failure도 test failure이며 remote commit을 outer rollback이 지운다고 가정하지 않는다.

- [ ] **Step 7: 검증·커밋**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-feedback-mutations.test.mjs tests/registration-observation-feedback-access.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus feedback-submit
git add -- supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql
test "$(git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/[0-9]{14}_registration_observation_feedback_mutations\.sql$')" = "supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql"
test -z "$(git diff --cached --name-only --diff-filter=D | rg 'registration_observation_feedback_mutations\.sql$')"
test -s supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql
git diff --cached --check
git diff --check
```
Expected: Node PASS; clean DB apply PASS; pgTAP PASS; provider 호출 0.

Commit:
```bash
git add supabase/migrations/20260809103000_registration_observation_feedback_mutations.sql supabase/tests/registration_observation_feedback_submit_test.sql scripts/run-registration-observation-local-db-qa.mjs tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-feedback-mutations.test.mjs
git commit -m "feat: record observation feedback"
```

---

### Task 3: 피드백 correction과 원장 최종 결정

**Files:**
- Create: `supabase/migrations/20260809103500_registration_observation_feedback_decisions.sql`
- Modify: `tests/registration-observation-feedback-mutations.test.mjs`
- Create: `supabase/tests/registration_observation_feedback_decisions_test.sql`
- Modify: `scripts/run-registration-observation-local-db-qa.mjs`
- Modify: `tests/registration-observation-local-db-runner.test.mjs`

**Interfaces:**
- Produces:

```sql
public.correct_registration_observation_feedback_v1(
  p_observation_id uuid,
  p_suitability_result text,
  p_feedback_reason text,
  p_correction_reason text,
  p_expected_observation_revision bigint,
  p_expected_feedback_revision bigint,
  p_expected_decision_kind text,
  p_request_key text
) returns jsonb

public.decide_registration_observation_v1(
  p_observation_id uuid,
  p_decision_kind text,
  p_waiting_class_id uuid,
  p_expected_observation_revision bigint,
  p_expected_feedback_revision bigint,
  p_expected_track_workflow_revision integer,
  p_request_key text
) returns jsonb
```

- [ ] **Step 0: pinned CLI로 decision migration을 만들고 frozen target으로 즉시 이동**

```bash
test ! -e supabase/migrations/20260809103500_registration_observation_feedback_decisions.sql
test "$(/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go --version)" = "2.103.0"
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go migration new registration_observation_feedback_decisions
registration_observation_feedback_decisions_generated="$(rg --files supabase/migrations | rg '/[0-9]{14}_registration_observation_feedback_decisions\.sql$')"
test "$(printf '%s\n' "$registration_observation_feedback_decisions_generated" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
git add -- "$registration_observation_feedback_decisions_generated"
git mv -- "$registration_observation_feedback_decisions_generated" supabase/migrations/20260809103500_registration_observation_feedback_decisions.sql
test "$(rg --files supabase/migrations | rg '/[0-9]{14}_registration_observation_feedback_decisions\.sql$')" = "supabase/migrations/20260809103500_registration_observation_feedback_decisions.sql"
test "$(git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/[0-9]{14}_registration_observation_feedback_decisions\.sql$')" = "supabase/migrations/20260809103500_registration_observation_feedback_decisions.sql"
test -z "$(git diff --cached --name-only --diff-filter=D | rg 'registration_observation_feedback_decisions\.sql$')"
```

이후 SQL을 `apply_patch`로 작성하고 `git add -- supabase/migrations/20260809103500_registration_observation_feedback_decisions.sql` 뒤 위 staged exact-one/D-zero assertions, `test -s`, `git diff --cached --check`를 재실행한다. collision/version/count/move/staged-orphan 실패는 즉시 task 중단이다. 이 focus도 enrollment readiness 이전이므로 single-session pgTAP만 outer transaction의 local superuser runtime fixture를 사용하고 rollback한다. decision 동시성은 Task 2와 동일한 committed setup/worker/explicit cleanup/fresh runtime0 assertion을 사용하며 remote commit을 outer rollback에 맡기지 않는다. application/production에는 runtime bypass를 추가하지 않는다.

- [ ] **Step 1: correction·decision RED 작성**

```js
test("director decision checks domain, feedback, and track revisions", async () => {
  const sql = normalizeSql(await readFile(migrationUrl, "utf8"))
  const body = functionBody(sql, "decide_registration_observation_v1")
  assert.match(body, /p_expected_observation_revision/)
  assert.match(body, /p_expected_feedback_revision/)
  assert.match(body, /p_expected_track_workflow_revision/)
  assert.match(body, /observation_return_workflow_status = null/)
  assert.doesNotMatch(body, /insert into public\.ops_registration_enrollments|ops_registration_admission|payment/)
})
```

같은 RED에서 runner registry의 `feedback.fixture.kind === 'committed'`, Task 2 manifest reuse+decision worker IDs, access→submit→decisions exact pgTAP directory contents, cleanup/fresh runtime0와 실패 정리 argv를 요구한다. `feedback-submit` hook을 이름만 재사용하거나 `feedback`이 no-op이면 FAIL한다.

- [ ] **Step 2: RED 실행**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-local-db-runner.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test --test-name-pattern="correction|director" tests/registration-observation-feedback-mutations.test.mjs
```
Expected: 두 함수가 없어 FAIL.

- [ ] **Step 3: correction 구현**

결정 전에는 assigned teacher/admin/staff가 기존 non-null 피드백만 expected revisions와 필수 correction reason으로 수정할 수 있다. 결정 뒤에는 admin/staff만 기존 suitability를 그대로 유지한 사유 문구 correction을 할 수 있다. ledger operation은 `correct_feedback`으로 고정한다. before/after, correction reason, actor, occurred_at을 audit에 남기고 `feedback_revision`만 +1 한다. observation revision과 appointment notification revision은 바꾸지 않는다.

- [ ] **Step 4: decision mapping 구현**

```text
enrollment             -> enrollment_requested, waiting_class_id must be null
waiting_current_class  -> waiting_current_class, waiting_class_id required and same subject
waiting_new_class      -> waiting_new_class, waiting_class_id must be null
waiting_next_opening   -> waiting_next_opening, waiting_class_id must be null
not_registered         -> not_registered, waiting_class_id must be null
re_observation         -> observation_requested, waiting_class_id must be null
```

`completed|no_show`만 최초 결정을 허용한다. ledger operation은 `decide`로 고정한다. 세 revision을 검증하고 decision/audit/track workflow를 원자 저장한다. `re_observation`만 return status를 보존하며 나머지는 null로 지운다. 등록 결정은 suitability와 무관하게 허용하고 enrollment row는 만들지 않는다.

Task 3의 revision 행렬은 다음으로 고정한다.

| operation | appointment `notification_revision` | observation `revision` | observation `feedback_revision` | track `workflow_revision` |
|---|---:|---:|---:|---:|
| `correct_feedback` | unchanged | unchanged | `+1` | unchanged |
| `decide` | unchanged | `+1` | unchanged | `+1` |

- [ ] **Step 5: decision 후 correction·finance-zero pgTAP**

`registration_observation_feedback_decisions_test.sql`은 결정 후 교사 수정 거부, admin 동일-result 사유 수정 허용, stale feedback revision 거부, 두 director 동시 결정 하나만 성공, re-observation 이후 새 active attempt가 있는 correction 거부, waiting class subject mismatch 거부와 위 revision 행렬을 검사한다. 각 decision 전후 enrollment/admission/payment 관련 행 수와 기존 독립 draft fingerprint가 동일해야 한다. 이 Task가 shared runner의 `feedback` registry entry를 Task 2 fixture manifest와 decision worker case를 포함하는 concrete committed setup/cleanup/fresh hook으로 교체하고 exact argv/failure-order Node assertion을 추가한다. `--focus feedback`은 access → submit → decisions pgTAP을 이 순서로 실행하지만 각 파일은 자기 transaction/plan count를 소유한다.

- [ ] **Step 6: 검증·커밋**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-feedback-mutations.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus feedback
git add -- supabase/migrations/20260809103500_registration_observation_feedback_decisions.sql
test "$(git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/[0-9]{14}_registration_observation_feedback_decisions\.sql$')" = "supabase/migrations/20260809103500_registration_observation_feedback_decisions.sql"
test -z "$(git diff --cached --name-only --diff-filter=D | rg 'registration_observation_feedback_decisions\.sql$')"
test -s supabase/migrations/20260809103500_registration_observation_feedback_decisions.sql
git diff --cached --check
git diff --check
```
Expected: correction/decision Node와 pgTAP 전부 PASS.

Commit:
```bash
git add supabase/migrations/20260809103500_registration_observation_feedback_decisions.sql supabase/tests/registration_observation_feedback_decisions_test.sql scripts/run-registration-observation-local-db-qa.mjs tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-feedback-mutations.test.mjs
git commit -m "feat: decide observation outcomes"
```

---

### Task 4: bounded feedback client와 관리자 피드백·결정 UI

**Files:**
- Modify: `src/features/tasks/registration-observation-model.ts`
- Modify: `src/features/tasks/registration-observation-service.ts`
- Create: `src/features/tasks/registration-observation-feedback-panel.tsx`
- Modify: `src/features/tasks/registration-observation-editor.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/registration-track-fixtures.ts`
- Modify: `src/features/tasks/registration-track-fixture-runtime.ts`
- Create: `tests/registration-observation-feedback-ui.test.mjs`
- Modify: `tests/registration-observation-service.test.mjs`
- Modify: `tests/registration-observation-workspace.test.mjs`
- Modify: `tests/registration-track-fixtures.test.mjs`

**Interfaces:**
- Produces:

```ts
loadRegistrationObservationFeedback(
  observationId: string,
  options?: { timeoutMs?: number; force?: boolean },
): Promise<RegistrationObservationFeedbackDetail>

recordRegistrationObservationAttendance(input: {
  observationId: string
  expectedObservationRevision: number
  expectedAppointmentNotificationRevision: number
  requestKey: string
}): Promise<RegistrationObservationFeedbackDetail>

submitRegistrationObservationFeedback(input: {
  observationId: string
  attendance: "attended" | "no_show"
  suitabilityResult: "fit" | "unfit" | null
  feedbackReason: string | null
  expectedObservationRevision: number
  expectedFeedbackRevision: number
  expectedAppointmentNotificationRevision: number
  requestKey: string
}): Promise<RegistrationObservationFeedbackDetail>

correctRegistrationObservationFeedback(input: {
  observationId: string
  suitabilityResult: "fit" | "unfit"
  feedbackReason: string
  correctionReason: string
  expectedObservationRevision: number
  expectedFeedbackRevision: number
  expectedDecisionKind: RegistrationObservationFeedbackDetail["decisionKind"]
  requestKey: string
}): Promise<RegistrationObservationFeedbackDetail>

decideRegistrationObservation(input: {
  observationId: string
  decisionKind: Exclude<RegistrationObservationFeedbackDetail["decisionKind"], null>
  waitingClassId: string | null
  expectedObservationRevision: number
  expectedFeedbackRevision: number
  expectedTrackWorkflowRevision: number
  requestKey: string
}): Promise<RegistrationObservationFeedbackDetail>
```

- [ ] **Step 1: normalizer·client RED 작성**

Malformed key/status/revision은 fail closed, read는 `AbortSignal.timeout(12_000)`과 `.retry(false)`, mutation은 자동 retry 0을 요구한다. 다음 테스트는 service가 누락한 attendance client를 직접 잡는다.

```js
assert.match(serviceSource, /async function recordRegistrationObservationAttendance/)
assert.match(serviceSource, /p_expected_feedback_revision/)
assert.match(serviceSource, /p_expected_track_workflow_revision/)
assert.match(modelSource, /sessionKey/)
assert.match(modelSource, /feedbackSubmittedByName/)
assert.match(modelSource, /feedbackSubmittedAt/)
```

- [ ] **Step 2: RED 실행**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-service.test.mjs tests/registration-observation-feedback-ui.test.mjs
```
Expected: client/panel exports가 없어 FAIL.

- [ ] **Step 3: model·service GREEN 구현**

read는 observation ID별 generation-aware in-flight/settled cache를 사용한다. refresh는 generation을 증가시켜 이전 success/failure consumer를 무효화한다. timeout/network/Abort/57014만 `서버 응답이 지연되었습니다. 잠시 후 다시 시도해 주세요.`로 매핑하고 stale revision은 `청강 정보가 변경되었습니다. 다시 확인해 주세요.`로 매핑한다. correction form의 빈 decision UI state는 service boundary에서 DB의 nullable `p_expected_decision_kind = null`로 명시 변환하고 나머지 literal만 그대로 보낸다. Task 1의 전체 exact key set과 normalized/legacy discriminated source를 검증하고, `feedbackSubmittedAt`은 valid ISO timestamp여야 하며 proxy boolean·actual submitter name·server timestamp의 nullability 조합이 어긋나면 UI state를 갱신하지 않는다.

- [ ] **Step 4: 관리자 피드백·결정 panel 구현**

운영 상세에는 현재 상태, 실제 참석, 적합/부적합, 사유, 담당 교사를 보인다. 실제 actor가 담당 교사와 다르면 `대리 입력 · {feedbackSubmittedByName} · {feedbackSubmittedAt의 KST 표시}`를 함께 보여 original `teacherName`과 대리 actor를 혼동하지 않는다. 실제 actor/time 둘 중 하나가 없으면 proxy 표시를 추측하지 않는다. 저장 버튼은 preview가 아니라 즉시 domain mutation을 호출하되 중복 클릭을 막고 request key를 성공 refresh 전까지 유지한다. 원장 결정 버튼은 등록·세 대기·미등록·재청강을 명시적으로 선택한 뒤 저장하며 자동 선택하지 않는다.

- [ ] **Step 5: UI 상태 보존 테스트**

피드백 저장 실패 시 입력값 유지, stale revision 시 reload button, 성공 저장 뒤 exact refreshed revision, unrelated read 오류 원문 미노출, decision 중복 클릭 1 RPC, 미등록 결정에서 enrollment editor mutation 0회, assigned teacher 입력에는 proxy label 없음, admin/staff 입력에는 actual actor name과 server KST time이 함께 표시됨을 검사한다.

- [ ] **Step 6: 검증·커밋**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-service.test.mjs tests/registration-observation-feedback-ui.test.mjs tests/registration-observation-workspace.test.mjs tests/registration-track-fixtures.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/tasks/registration-observation-model.ts src/features/tasks/registration-observation-service.ts src/features/tasks/registration-observation-feedback-panel.tsx src/features/tasks/registration-observation-editor.tsx tests/registration-observation-feedback-ui.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
```
Expected: focused tests, ESLint, tsc, diff PASS.

Commit:
```bash
git add src/features/tasks/registration-observation-model.ts src/features/tasks/registration-observation-service.ts src/features/tasks/registration-observation-feedback-panel.tsx src/features/tasks/registration-observation-editor.tsx src/features/tasks/registration-track-editor.tsx src/features/tasks/registration-track-fixtures.ts src/features/tasks/registration-track-fixture-runtime.ts tests/registration-observation-service.test.mjs tests/registration-observation-feedback-ui.test.mjs tests/registration-observation-workspace.test.mjs tests/registration-track-fixtures.test.mjs
git commit -m "feat: add observation feedback decisions ui"
```

---

### Task 5: 담당 교사 전용 feedback route

**Files:**
- Create: `src/app/admin/registration/observations/[observationId]/feedback/page.tsx`
- Create: `src/features/tasks/registration-observation-teacher-feedback.tsx`
- Create: `tests/registration-observation-teacher-route.test.mjs`

**Interfaces:**
- Consumes: Task 4 feedback read/submission client
- Produces: authenticated route `/admin/registration/observations/{observationId}/feedback`

- [ ] **Step 1: route 최소 projection·guard RED 작성**

```js
test("teacher feedback route uses the dedicated RPC and never loads the registration case", async () => {
  assert.match(pageSource, /RegistrationObservationTeacherFeedback/)
  assert.match(panelSource, /loadRegistrationObservationFeedback/)
  assert.doesNotMatch(panelSource, /loadRegistrationCaseDetail|ops_tasks|parentPhone|schoolName/)
})
```

- [ ] **Step 2: RED 실행**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-teacher-route.test.mjs
```
Expected: route와 component가 없어 FAIL.

- [ ] **Step 3: route와 UI 구현**

페이지는 기존 admin auth guard 아래에서 UUID segment를 검증하고 전용 client만 호출한다. scheduled에서는 `참석 + 적합/부적합 + 필수 사유` 또는 `노쇼`를 제출한다. attended_feedback_pending에서는 적합/부적합과 사유만 제출한다. `노쇼`는 canonical 시작시각 전, `참석 + 적합/부적합`과 참석 후 평가는 canonical 종료시각 전까지 각각 별도로 disabled한다. browser clock은 안내용일 뿐이고 서버가 동일 경계를 다시 검증한다.

- [ ] **Step 4: 권한·모바일·접근성 테스트**

assigned teacher 성공, unrelated teacher 동일 not-found, admin proxy label, 390px/200% zoom에서 horizontal overflow 없음, 첫 오류 focus, loading/disabled, keyboard submit을 검사한다.

- [ ] **Step 5: 검증·커밋**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-teacher-route.test.mjs tests/registration-observation-service.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint 'src/app/admin/registration/observations/[observationId]/feedback/page.tsx' src/features/tasks/registration-observation-teacher-feedback.tsx tests/registration-observation-teacher-route.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
```
Expected: focused tests, ESLint, tsc, diff PASS.

Commit:
```bash
git add 'src/app/admin/registration/observations/[observationId]/feedback/page.tsx' src/features/tasks/registration-observation-teacher-feedback.tsx tests/registration-observation-teacher-route.test.mjs
git commit -m "feat: add teacher observation feedback route"
```

---

### Task 6: 적합 청강 첫 수업일 source와 calendar DB 계약

**Files:**
- Create: `supabase/migrations/20260809104000_registration_observation_enrollment_source.sql`
- Create: `tests/registration-observation-enrollment-source.test.mjs`
- Create: `supabase/tests/registration_observation_enrollment_test.sql`
- Create: `tests/registration-observation-calendar.test.mjs`
- Modify: `scripts/run-registration-observation-local-db-qa.mjs`
- Modify: `tests/registration-observation-local-db-runner.test.mjs`
- Modify: `tests/registration-track-schema.test.mjs`

**Interfaces:**
- Produces: `ops_registration_enrollments.class_start_source_observation_id uuid null`
- Produces:

```sql
dashboard_private.validate_registration_observation_class_start_source_v1(
  p_track_id uuid,
  p_observation_id uuid,
  p_class_id uuid,
  p_class_start_date date,
  p_class_start_session_key text,
  p_class_start_lesson_session_id uuid
) returns jsonb

dashboard_private.normalize_registration_enrollment_rows_request_v1(
  p_rows jsonb
) returns jsonb

dashboard_private.save_registration_enrollment_rows_canonical_v1(
  p_track_id uuid,
  p_canonical_rows jsonb,
  p_actor_id uuid
) returns jsonb
```
- Replaces without renaming:

```sql
public.save_registration_enrollment_rows(uuid,jsonb,text) returns jsonb
public.save_registration_enrollment_details_v1(uuid,jsonb,text) returns jsonb
dashboard_private.save_registration_enrollment_details_impl(uuid,jsonb,text) returns jsonb
dashboard_private.sync_registration_enrollment_lesson_session_v1() returns trigger
dashboard_private.registration_appointment_track_ids_v1(uuid) returns uuid[]
```

- Forward-replaces existing `public.ops_registration_appointment_calendar` with `security_invoker=true`, preserves its first ten columns in exact order/type, and appends `observation_id uuid`, `observation_track_id uuid`, `observation_class_id uuid`, `observation_class_name text`, `observation_ends_at timestamptz`, `observation_teacher_name text`, `observation_classroom_name text`, each nullable for non-observation rows. The current repository has no public calendar read RPC; do not invent one. The current read surface is direct view SELECT via `src/features/tasks/registration-track-service.ts`, and the current exact private participant helper is `dashboard_private.registration_appointment_track_ids_v1(uuid)`.

Input row exact keys become:

```json
{
  "id": null,
  "classId": "uuid",
  "textbookId": null,
  "classStartDate": "2026-08-17",
  "classStartSessionKey": "session-key",
  "classStartLessonSessionId": "uuid-or-null",
  "classStartSession": "월요일 오후 6:00–8:00",
  "classStartSourceObservationId": "uuid-or-null",
  "sortOrder": 0
}
```

- [ ] **Step 0: pinned CLI로 enrollment source migration을 만들고 frozen target으로 즉시 이동**

```bash
test ! -e supabase/migrations/20260809104000_registration_observation_enrollment_source.sql
test "$(/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go --version)" = "2.103.0"
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go migration new registration_observation_enrollment_source
registration_observation_enrollment_source_generated="$(rg --files supabase/migrations | rg '/[0-9]{14}_registration_observation_enrollment_source\.sql$')"
test "$(printf '%s\n' "$registration_observation_enrollment_source_generated" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
git add -- "$registration_observation_enrollment_source_generated"
git mv -- "$registration_observation_enrollment_source_generated" supabase/migrations/20260809104000_registration_observation_enrollment_source.sql
test "$(rg --files supabase/migrations | rg '/[0-9]{14}_registration_observation_enrollment_source\.sql$')" = "supabase/migrations/20260809104000_registration_observation_enrollment_source.sql"
test "$(git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/[0-9]{14}_registration_observation_enrollment_source\.sql$')" = "supabase/migrations/20260809104000_registration_observation_enrollment_source.sql"
test -z "$(git diff --cached --name-only --diff-filter=D | rg 'registration_observation_enrollment_source\.sql$')"
```

이후 SQL을 `apply_patch`로 작성하고 `git add -- supabase/migrations/20260809104000_registration_observation_enrollment_source.sql`을 다시 실행한다. 위 staged exact-one/D-zero assertions, `test -s`, `git diff --cached --check`를 모두 재실행한다. collision/version/count/move/staged-orphan 실패는 즉시 task 중단이다.

- [ ] **Step 1: wrapper-chain RED 작성**

```js
test("canonical enrollment save carries and validates observation source", async () => {
  const sql = normalizeSql(await readFile(migrationUrl, "utf8"))
  const wrapper = extractFunctionBody(sql, "public.save_registration_enrollment_rows")
  const normalizer = extractFunctionBody(sql, "dashboard_private.normalize_registration_enrollment_rows_request_v1")
  const canonicalDml = extractFunctionBody(sql, "dashboard_private.save_registration_enrollment_rows_canonical_v1")
  const details = extractFunctionBody(sql, "dashboard_private.save_registration_enrollment_details_impl")
  assert.match(sql, /class_start_source_observation_id uuid/)
  assert.match(sql, /validate_registration_observation_class_start_source_v1/)
  assert.match(sql, /classStartSourceObservationId/)
  assert.match(sql, /save_registration_enrollment_rows\(uuid, jsonb, text\)/)
  assert.match(sql, /normalize_registration_enrollment_rows_request_v1\(jsonb\)/)
  assert.match(sql, /save_registration_enrollment_rows_canonical_v1\(uuid, jsonb, uuid\)/)
  assert.match(sql, /save_registration_enrollment_details_impl\(uuid, jsonb, text\)/)
  assert.doesNotMatch(wrapper, /save_registration_enrollment_rows_legacy_v1\s*\(/)
  assert.doesNotMatch(normalizer, /insert|update|delete|ops_registration_mutations|pg_advisory_xact_lock/)
  assert.match(sql, /normalize_registration_enrollment_rows_request_v1[\s\S]*immutable[\s\S]*security invoker[\s\S]*set search_path = ''/)
  assert.doesNotMatch(canonicalDml, /save_registration_enrollment_rows_legacy_v1\s*\(/)
  assert.doesNotMatch(canonicalDml, /ops_registration_mutations|p_request_key|pg_advisory_xact_lock/)
  assert.doesNotMatch(details, /:canonical-rows/)
  assert.match(wrapper, /ops_registration_mutations[\s\S]*mutation_type\s*=\s*'save_enrollment_rows'/)
  assert.match(details, /ops_registration_mutations[\s\S]*save_registration_enrollment_details/)
  assert.match(wrapper, /assert_registration_mutation_access\([\s\S]*save_enrollment_rows/)
  assert.match(canonicalDml, /assert_registration_mutation_access\([\s\S]*save_enrollment_rows/)
  assert.match(details, /assert_registration_mutation_access\([\s\S]*save_enrollment_rows/)
  assert.match(canonicalDml, /class_start_source_observation_id[\s\S]*class_start_date[\s\S]*class_start_session_key[\s\S]*class_start_lesson_session_id/)
  assert.match(canonicalDml, /pipeline_status[\s\S]*enrollment_decided[\s\S]*registered[\s\S]*dashboard\.registration_status_independent_enrollment/)
  assert.doesNotMatch(wrapper, /set_config\([\s\S]*dashboard\.registration_status_independent_enrollment/)
  assert.doesNotMatch(canonicalDml, /set_config\([\s\S]*dashboard\.registration_status_independent_enrollment/)
  assert.match(details, /set_config\([\s\S]*dashboard\.registration_status_independent_enrollment[\s\S]*on[\s\S]*true/)
  assert.match(canonicalDml, /enrollment_rows_saved[\s\S]*recompute_registration_parent/)
  assert.match(details, /registration_enrollment_details_saved/)
  assert.match(sql, /security definer set search_path = ''/)
  assert.match(sql, /revoke all on function public\.save_registration_enrollment_rows\(uuid,jsonb,text\)/)
  assert.match(sql, /grant execute on function public\.save_registration_enrollment_rows\(uuid,jsonb,text\) to authenticated/)
})

test("each public enrollment operation owns one receipt and no derived key", async () => {
  const sql = normalizeSql(await readFile(migrationUrl, "utf8"))
  const wrapper = extractFunctionBody(sql, "public.save_registration_enrollment_rows")
  const canonicalDml = extractFunctionBody(sql, "dashboard_private.save_registration_enrollment_rows_canonical_v1")
  const details = extractFunctionBody(sql, "dashboard_private.save_registration_enrollment_details_impl")
  assert.equal(countMatches(wrapper, /insert into dashboard_private\.ops_registration_mutations/g), 1)
  assert.equal(countMatches(details, /insert into dashboard_private\.ops_registration_mutations/g), 1)
  assert.equal(countMatches(canonicalDml, /ops_registration_mutations/g), 0)
  assert.equal(countMatches(wrapper, /save_registration_enrollment_rows_canonical_v1\s*\(/g), 1)
  assert.equal(countMatches(details, /save_registration_enrollment_rows_canonical_v1\s*\(/g), 1)
  assert.doesNotMatch(sql, /p_request_key\s*\|\|\s*':canonical-rows'/)
})

test("104000 forward replaces the exact existing calendar surfaces", async () => {
  const sql = normalizeSql(await readFile(migrationUrl, "utf8"))
  const calendarHelper = extractFunctionBody(sql, "dashboard_private.registration_appointment_track_ids_v1")
  assert.match(sql, /create or replace view public\.ops_registration_appointment_calendar with \(security_invoker = true\)/)
  assert.match(sql, /dashboard_private\.registration_appointment_track_ids_v1\(p_appointment_id uuid\)/)
  assert.match(sql, /observation_id[\s\S]*observation_track_id[\s\S]*observation_class_id[\s\S]*observation_class_name[\s\S]*observation_ends_at[\s\S]*observation_teacher_name[\s\S]*observation_classroom_name/)
  assert.match(calendarHelper, /ops_registration_observations/)
  assert.match(calendarHelper, /observation_class/)
  assert.match(sql, /revoke all on table public\.ops_registration_appointment_calendar from public, anon, authenticated, service_role/)
  assert.match(sql, /grant select on table public\.ops_registration_appointment_calendar to authenticated/)
})
```

- [ ] **Step 2: RED 실행**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-enrollment-source.test.mjs tests/registration-observation-calendar.test.mjs tests/registration-track-schema.test.mjs
```
Expected: migration·column·receipt-free canonical DML·operation receipt/state/side-effect contract·calendar observation branch·enrollment focus fixture hook이 없어 FAIL.

- [ ] **Step 3: column/index/validator 구현**

FK는 `ops_registration_observations(id)`를 참조하고 `ON DELETE RESTRICT`; `class_start_source_observation_id` partial index를 추가한다. validator는 같은 task/track/class, observation `status='completed'`, attendance=`attended`, suitability=`fit`, decision_kind=`enrollment`, session authority/ID 또는 legacy key/date가 enrollment 선택값과 일치함을 row lock 아래 확인한다. normalized source는 lesson-session ID가 non-null이고 해당 observation ID/date와 일치해야 하며, legacy source는 lesson-session ID가 null이고 nonblank session key/date가 observation과 일치해야 한다. 모든 인자 순서와 null 의미는 위 signature로 고정한다. 성공 JSON exact keys는 `{observationId,classId,classStartDate,classStartSessionKey,classStartLessonSessionId,classStartSession}`이며 마지막 label은 browser 값을 복사하지 않고 저장된 observation `starts_at/ends_at` snapshot으로 서버가 만든 KST 값이다.

같은 104000 migration은 현행 `supabase/migrations/20260722100000_registration_science_subject.sql`의 view/helper를 forward-replace한다. `public.ops_registration_appointment_calendar`는 기존 첫 열 `appointment_id,task_id,student_name,kind,scheduled_at,place,status,notification_revision,track_ids,subjects`의 이름·타입·순서를 그대로 두고 위 일곱 nullable observation 열만 끝에 붙인다. `canonical_participants`에 `ops_registration_observations → ops_registration_appointments(kind='observation_class') → exact track` union을 추가하고 observation의 unique `appointment_id`를 이용해 appointment 한 건당 view 한 행만 만든다. observation 열은 observation row의 `id,track_id,class_id,class_name_snapshot,ends_at,teacher_name_snapshot,classroom_name_snapshot`에서만 채우고 level-test/visit row에서는 전부 SQL null이다. feedback reason, phone, school, inquiry, textbook/progress는 view에 넣지 않는다. raw `kind`는 DB authority인 `observation_class`를 유지하고 Task 8 model만 filter kind `observation`으로 정규화한다.

동시에 current exact helper `dashboard_private.registration_appointment_track_ids_v1(uuid)`를 `LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''`로 교체해 기존 scheduled/in-progress level-test와 scheduled visit branch를 byte-for-byte 보존하고, `ops_registration_observations`를 appointment에 join해 `appointment.kind='observation_class'`인 linked observation의 exact `track_id` branch를 union한다. 새 public calendar read RPC는 만들지 않는다. view owner는 postgres, `REVOKE ALL ON TABLE ... FROM PUBLIC, anon, authenticated, service_role` 뒤 `GRANT SELECT ... TO authenticated`; helper owner는 postgres이고 exact signature EXECUTE는 네 role 모두 revoke한다. view의 `security_invoker=true`와 underlying observation RLS 때문에 manager/admin/staff/exact director만 observation row를 보고 teacher/unrelated actor는 이 view로 observation 존재를 우회할 수 없다.

이 migration이 readiness를 true로 만드는 exact dependency set은 다음 `to_regprocedure` 결과가 모두 non-null인 경우뿐이다: `public.get_registration_observation_manager_attempt_v1(uuid,uuid)`, `public.get_registration_observation_feedback_v1(uuid)`, `public.record_registration_observation_attendance_v1(uuid,bigint,integer,text)`, `public.submit_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,integer,text)`, `public.correct_registration_observation_feedback_v1(uuid,text,text,text,bigint,bigint,text,text)`, `public.decide_registration_observation_v1(uuid,text,uuid,bigint,bigint,integer,text)`, `dashboard_private.validate_registration_observation_class_start_source_v1(uuid,uuid,uuid,date,text,uuid)`, `dashboard_private.normalize_registration_enrollment_rows_request_v1(jsonb)`, `dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)`, `dashboard_private.registration_appointment_track_ids_v1(uuid)`. Core readiness의 calendar tokens `public.ops_registration_appointment_calendar.observation_id|observation_track_id|observation_class_id|observation_class_name|observation_ends_at|observation_teacher_name|observation_classroom_name`도 모두 존재해야 한다. 이미 존재하던 helper는 signature non-null만으로 통과시키지 않고 normalized `pg_get_functiondef`에 기존 level-test/visit branch와 신규 `ops_registration_observations` + `observation_class` branch가 모두 있어야 하며, view reloptions의 `security_invoker=true`도 필수다. 빠진 경우 exact helper signature 또는 `public.ops_registration_appointment_calendar.security_invoker`가 `missingObjects`에 남는다. pgTAP은 각 exact regprocedure, view column/type/order, security-invoker option, ACL/helper body와 readiness token 소멸을 별도 assertion으로 고정한다.

- [ ] **Step 4: 정확한 wrapper chain 교체**

`public.save_registration_enrollment_rows(uuid,jsonb,text)`는 현재와 같은 `LANGUAGE plpgsql SECURITY DEFINER SET search_path=''` public signature/boundary를 보존하지만 신규 경로에서 `public.save_registration_enrollment_rows_legacy_v1` 또는 `dashboard_private.save_registration_enrollment_rows_impl`을 호출하지 않는다. `dashboard_private.normalize_registration_enrollment_rows_request_v1(jsonb)`는 `LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=''`이고 DB write, receipt, advisory lock 없이 request shape만 canonicalize한다. `dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)`는 active actor/access/state를 재검증하는 `LANGUAGE plpgsql SECURITY DEFINER SET search_path=''` receipt-free DML helper다. 두 private exact signatures는 owner postgres이며 모든 API role에서 revoke하고 public wrapper/details definer만 owner 권한으로 호출한다.

Public rows operation sequence is exact:

1. Require non-null `auth.uid()` and nonblank request key. Normalize `p_rows` with the pure helper: `classId` and `sortOrder` are required; `id,textbookId,classStartDate,classStartSessionKey,classStartLessonSessionId,classStartSession,classStartSourceObservationId` may be absent or JSON null; unknown keys are rejected. Build `v_canonical_request_rows` with all nine keys in that exact order and every absent optional as JSON null. Reject duplicate class IDs and malformed UUID/date/integer values.
2. Read the exact task ID without a domain row lock, then call the repository's existing `dashboard_private.assert_registration_mutation_access(v_task_id,p_track_id,'save_enrollment_rows')` before receipt lookup. This preserves the current admin/staff and exact task/track action contract, including its active-role semantics, rather than introducing a parallel role predicate. Acquire the existing `(actor_id,p_request_key)` advisory lock, compute the existing public rows fingerprint `{taskId,trackId,rows:v_canonical_request_rows}`, then inspect `dashboard_private.ops_registration_mutations` for exact task and `mutation_type='save_enrollment_rows'`. Same fingerprint returns the stored final response before runtime, pipeline-state, row lock, DML, audit or recompute. Different task/type/fingerprint returns the existing request-key conflict. This preserves the ledger's global `(actor_id,request_key)` namespace rather than deriving another key.
3. For a new receipt only, call `dashboard_private.save_registration_enrollment_rows_canonical_v1(p_track_id,v_canonical_request_rows,v_actor_id)`. After its final response and side effects succeed, insert exactly one `save_enrollment_rows` receipt under the caller's original key and return it. Receipt insert failure rolls the helper's DML/audit/recompute back. The public operation never inserts or calls a second/nested receipt.

The receipt-free canonical DML helper sequence is exact:

1. Recheck `p_actor_id=auth.uid()`, resolve the task/track relation, call `dashboard_private.assert_registration_mutation_access(task_id,p_track_id,'save_enrollment_rows')` again, then lock the exact track. Preserve the current public source-state contract: unless `track.pipeline_status IN ('enrollment_decided','registered')`, require transaction-local `current_setting('dashboard.registration_status_independent_enrollment',true)='on'`; otherwise raise `registration_invalid_source_state` before enrollment row locks or writes. The public rows wrapper never sets this GUC.
2. Only when canonical rows contain at least one non-null `classStartSourceObservationId`, call `dashboard_private.assert_registration_observation_runtime_v1()`. An all-null regular/blank request, including changing an existing historical-source draft back to regular or clearing all start fields, remains available at runtime 0. Runtime 0 never permits creation/change to a non-null observation source. Replay never reaches this helper.
3. Resolve and lock every editable enrollment row in deterministic `classId,id` order. A supplied `id` must be the same-track row satisfying all current editable predicates: `status='planned'`, `admission_batch_id/student_id IS NULL`, `roster_active=false`, and every release field null. For an id-less row, first select that same predicate plus exact `track_id,class_id` `FOR UPDATE`; 0 rows allocates one UUID, 1 row binds its ID, and 2+ rows fails. This binding happens before class-conflict detection, so a preexisting id-less draft is excluded by its bound ID rather than conflicting with itself. Lock classes/textbooks next, then reject any other planned or roster-active same-track/class row.
4. Build one `v_final_rows` set before DML. A null source with all three start values null produces final null date/key/label/lesson/source. A null source with a regular session calls existing exact `dashboard_private.validate_registration_class_session(uuid,date,text)`, requires its canonical active/makeup result and requested lesson-session identity, and uses the returned date/key/label/lesson ID. A non-null source calls `dashboard_private.validate_registration_observation_class_start_source_v1(uuid,uuid,uuid,date,text,uuid)` and uses only its returned historical date/key/server label/lesson ID plus the validated observation ID. Browser `classStartSession`, arbitrary date, and current-plan fallback never become the final source branch values.
5. Persist the whole set with one `INSERT ... SELECT FROM v_final_rows ON CONFLICT (id) DO UPDATE SET class_id=excluded.class_id,textbook_id=excluded.textbook_id,class_start_date=excluded.class_start_date,class_start_session_key=excluded.class_start_session_key,class_start_session=excluded.class_start_session,class_start_lesson_session_id=excluded.class_start_lesson_session_id,class_start_source_observation_id=excluded.class_start_source_observation_id,sort_order=excluded.sort_order,updated_at=now()` statement. Its conflict update has the full editable-row predicate and the returned-row count must equal input count. There is no preliminary legacy INSERT/UPDATE, sanitized legacy receipt, source-clear patch, or post-save correction. Thus the BEFORE trigger sees final class/date/key/lesson/source together on its first and only write.
6. Re-read only the returned IDs and build exact response `{trackId,rows}`. Each row retains the current response keys `id,trackId,studentId,admissionBatchId,classId,textbookId,classStartDate,classStartSessionKey,classStartSession,status,makeeduRegistered,rosterActive,rosterReleasedAt,rosterReleaseReason,rosterReleaseSourceTaskId,rosterReleaseKind,sortOrder` and appends `classStartLessonSessionId,classStartSourceObservationId`.
7. Before returning, call existing `dashboard_private.write_registration_track_event_v2(uuid,uuid,text,text,text,text,jsonb,text,text)` exactly once with event `enrollment_rows_saved`, the locked track's before/after pipeline status, `actor_kind='user'`, `system_source=null`, and metadata `{rowIds,rowCount,rows}` from the final reread. Then call `dashboard_private.recompute_registration_parent(task_id)` exactly once. The helper contains no `ops_registration_mutations` reference, request key or advisory lock. Audit/recompute failure rolls back the one DML statement; outer receipt failure rolls all of them back.

Forward-replace `dashboard_private.sync_registration_enrollment_lesson_session_v1()` and recreate existing trigger `ops_registration_enrollments_sync_lesson_session` as `BEFORE INSERT OR UPDATE OF class_id,class_start_date,class_start_session_key,class_start_lesson_session_id,class_start_source_observation_id`. Trigger first requires `auth.uid()` non-null, active actor, and exact track enrollment-write access. If `NEW.class_start_source_observation_id IS NULL`, preserve the current regular normalized/legacy validator semantics: blank triple clears lesson ID, normalized requires its active/makeup exact session, legacy produces null lesson ID. If source is non-null, call the historical validator with final `NEW` values; require exact equality and set normalized lesson ID or legacy null. This historical branch never consults current schedule state/plan as history authority.

`dashboard_private.save_registration_enrollment_details_impl(uuid,jsonb,text)` keeps its exact signature/access and existing outer fingerprint `{trackId,rows:p_rows}`. Before even a replay result can be returned, it requires non-null `auth.uid()`, resolves the exact task ID, and restores the canonical access call that existed in `20260801100000_registration_status_independent_enrollment_details.sql`: `dashboard_private.assert_registration_mutation_access(task_id,p_track_id,'save_enrollment_rows')`. (The current 123000 forward replacement omitted that call.) It then acquires the original `(actor_id,p_request_key)` advisory lock and checks the sole outer `save_registration_enrollment_details` receipt. This prevents an inactive or newly unrelated actor from using an old receipt as an authorization oracle. Same fingerprint returns the stored final response before GUC, normalization, DML, audit, recompute or detail update; different task/type/fingerprint conflicts. Only a new details request sets transaction-local `dashboard.registration_status_independent_enrollment='on'`, canonicalizes `p_rows`, and calls the receipt-free DML helper directly with no derived request key. This is the only call path allowed to set the bypass, so details save remains status-independent while direct public rows save still rejects a track outside `enrollment_decided|registered`.

After the helper returns, details impl persists `enrollment_detail_rows = v_response->'rows'`, never raw `p_rows`, calls `write_registration_track_event_v2` exactly once with `registration_enrollment_details_saved`, before/after pipeline status, `actor_kind='user'`, `system_source=null`, metadata `{rowCount,canonical:true}`, then inserts exactly one outer `save_registration_enrollment_details` receipt under the original key. A new details operation therefore performs row audit 1, parent recompute 1, details audit 1, outer receipt 1; its replay performs all four 0 times. Direct public rows new/replay performs row audit/recompute/row receipt `1/1/1` then `0/0/0`. There is no `:canonical-rows` concatenation or inner receipt anywhere. A caller key literally ending `:canonical-rows` is just its one original key; details key `K` and direct rows key `K:canonical-rows` do not collide, while reusing exact key `K` across two public operations retains the existing intentional global conflict.

Revoke exact EXECUTE on `public.save_registration_enrollment_rows_legacy_v1(uuid,jsonb,text)`, `dashboard_private.save_registration_enrollment_rows_impl(uuid,jsonb,text)`, the pure normalizer, receipt-free DML helper, validator, and trigger function from `PUBLIC,anon,authenticated,service_role`. Only the public canonical wrapper gets authenticated EXECUTE; keep authenticated EXECUTE on `dashboard_private.save_registration_enrollment_details_impl(uuid,jsonb,text)` solely because the existing public details SECURITY INVOKER wrapper requires that exact chain. pgTAP must prove no other API role path reaches the private writes or set the details-only GUC through this API surface.

- [ ] **Step 5: pgTAP 특별 후보·override·finance 회귀**

Enrollment pgTAP covers the full branch/revision matrix:

- eligible completed+attended+fit+enrollment+same-track/class historical source succeeds even when its normalized session is no longer active/makeup; unfit, no-show, canceled, wrong task/track/class, or missing decision fails with zero writes;
- regular future normalized/legacy and blank rows still behave as before; regular invalid state fails; historical A→regular/blank removes source; historical A→B changes source; each success is one final write whose trigger observes matching source/date/key/lesson values;
- an id-less input binds and updates a preexisting exact editable draft rather than raising self-conflict or inserting a second row; 2+ candidates, active/rostered/admission-linked rows, and batch duplicate class IDs fail closed;
- runtime 0 rejects only a new request with any non-null observation source. A same-fingerprint historical-source receipt replay returns the identical final JSON, regular save stays available, and historical-source removal stays available. Same key/different source conflicts before runtime logic and mutates zero rows;
- direct public rows save at `pipeline_status='consultation_completed'` fails `registration_invalid_source_state` with DML/audit/recompute/receipt delta 0, while the existing public details wrapper on the same state succeeds only through transaction-local `dashboard.registration_status_independent_enrollment='on'`. The GUC is local to that details transaction; a following direct rows save on a fresh connection still fails. Both paths succeed normally at `enrollment_decided|registered`;
- direct rows new execution has exactly one caller-key `save_enrollment_rows` receipt and `enrollment_rows_saved` audit +1; a transaction-local pgTAP counter trigger on the exact fixture `ops_tasks` row proves parent recompute updates that task exactly once. Same-fingerprint replay has receipt/audit/task-update/DML delta 0. Details new execution has exactly one caller-key `save_registration_enrollment_details` receipt, row audit +1, exact fixture task-update +1, details audit +1 and canonical detail update +1; replay has all deltas 0. Injected failure at row audit, recompute, details audit, or outer receipt leaves row/detail/event/parent state unchanged;
- response and the operation-owned row/detail receipt use the final canonical table rows only; stored `enrollment_detail_rows` is exactly final `response.rows`, server label wins over browser text, and source/date/key/lesson cannot be partially updated. Receipt-free canonical DML has no mutation-ledger row;
- use direct rows request key `K:canonical-rows` followed by details key `K` and prove both independent original-key receipts succeed without collision or nested row receipt. Reusing exact key `K` across direct rows and details still conflicts by the pre-existing global `(actor_id,request_key)` contract before DML;
- public wrapper/bridge/details/trigger `prosecdef`, empty search path, exact actor checks and all ACLs match the contract. Public/anon/service_role/unrelated actor cannot reach the bridge, legacy impl, trigger, or other-track rows; the existing details invoker chain is the only stated private authenticated grant.

Failure injection is concrete and rollback-only: inside the pgTAP transaction, install uniquely named guard triggers scoped to the exact synthetic track/task/actor/request key. Because `write_registration_track_event_v2` stores both audits as `ops_task_events.event_type='registration_track_event'`, the guard function first checks exact task/event/`field_name='registration_track:'||track_id` in an outer `IF`, then and only then casts `after_value::jsonb` in a nested `IF`. The row-audit payload event is `enrollment_rows_saved`; the details-audit payload event is `registration_enrollment_details_saved`. The recompute guard raises on UPDATE of the exact fixture `ops_tasks.id`, and the receipt guard raises on INSERT of the exact `(actor_id,request_key,mutation_type)` in `dashboard_private.ops_registration_mutations`. Run one failure case per fresh subtransaction, assert the distinct guard error and zero deltas, then drop each guard trigger/function before the next case; outer pgTAP rollback is a final safety net, not the cleanup mechanism.

Capture before/after row counts and row-JSON hashes for enrollments, admission batches, observations, appointments, tracks, and any payment/import table named by the source-contract denylist. Every validation/replay/conflict test asserts admission/payment/import rows unchanged and no workflow path writes payment.

The same focus pgTAP forward-tests calendar security and cardinality. Level-test/visit rows preserve the original ten columns with appended nulls; one observation appointment yields exactly one row with exact one-element track/subject arrays and canonical class/end/teacher/classroom snapshots. Two views of the same appointment do not duplicate it. Manager/admin/staff/exact director matrix follows underlying RLS, teacher/unrelated sees no observation row, PUBLIC/anon/service_role lack SELECT, and helper EXECUTE is revoked from all API roles. Private callers of `dashboard_private.registration_appointment_track_ids_v1(uuid)` receive the observation track without losing either old branch. Readiness becomes `schemaReady=true,missingObjects=[]` only after these view columns, helper/bridge, feedback signatures and enrollment source all exist.

Actual admin activation `0→1`, same request replay, different-request second activation rejection and concurrent single winner are owned by this focus. This task adds the enrollment focus's exact committed-fixture setup/cleanup/fresh-assert hooks to the shared runner and adds their argv/failure-order Node assertions. The runner setup phase commits runtime 0 with unique admin/receipt/open-observation fixtures before pgTAP, worker connections invoke the real activation RPC, and cleanup uses the roadmap's exact marked `registration_observation_runtime_deactivate_v1` SQL body for committed `1→0` rather than inventing a deactivation RPC. Inside rollback-only pgTAP, execute the same body twice and assert `1→0`, replay-safe `0→0`, `updated_by IS NULL`, unchanged hashes/counts/revisions for observation/track/appointment/enrollment/admission, preserved open-observation IDs, and zero new domain/provider rows. The runner disconnects workers, removes only exact activation receipt/test fixtures in reverse FK order, commits, and verifies runtime0/fixture-zero from a fresh connection before stop. Remote commit is never attributed to an outer rollback; cleanup failure still runs fresh assertion and stop, then fails the focus. This is the pre-Gate-B rehearsal only—no runtime rollback migration is a normal 104000 artifact.

- [ ] **Step 6: clean DB GREEN과 커밋**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-enrollment-source.test.mjs tests/registration-observation-calendar.test.mjs tests/registration-track-schema.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus enrollment
git add -- supabase/migrations/20260809104000_registration_observation_enrollment_source.sql
test "$(git diff --cached --name-only --diff-filter=ACMR | rg '^supabase/migrations/[0-9]{14}_registration_observation_enrollment_source\.sql$')" = "supabase/migrations/20260809104000_registration_observation_enrollment_source.sql"
test -z "$(git diff --cached --name-only --diff-filter=D | rg 'registration_observation_enrollment_source\.sql$')"
test -s supabase/migrations/20260809104000_registration_observation_enrollment_source.sql
git diff --cached --check
git diff --check
```
Expected: clean apply가 exact enrollment ceiling `20260809104000`에서 끝나고 enrollment+calendar+runtime-rollback-rehearsal pgTAP 0 failures. 104000보다 뒤 migration은 이 focus에 들어오지 않는다.

Commit:
```bash
git add supabase/migrations/20260809104000_registration_observation_enrollment_source.sql supabase/tests/registration_observation_enrollment_test.sql scripts/run-registration-observation-local-db-qa.mjs tests/registration-observation-local-db-runner.test.mjs tests/registration-observation-enrollment-source.test.mjs tests/registration-observation-calendar.test.mjs tests/registration-track-schema.test.mjs
git commit -m "feat: link observation to enrollment start"
```

---

### Task 7: 등록 첫 수업일 제안·원장 override UI

**Files:**
- Modify: `src/features/tasks/registration-track-model.js`
- Modify: `src/features/tasks/registration-track-model.d.ts`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/registration-enrollment-editor.tsx`
- Modify: `tests/registration-track-model.test.mjs`
- Modify: `tests/registration-track-service.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Produces:

```ts
export type RegistrationEnrollmentRowInput = Readonly<{
  id?: string
  classId: string
  textbookId?: string | null
  classStartDate?: string | null
  classStartSessionKey?: string | null
  classStartLessonSessionId?: string | null
  classStartSession?: string | null
  classStartSourceObservationId?: string | null
  sortOrder: number
}>

export type RegistrationScheduleSession = Readonly<{
  value: string
  lessonSessionId?: string
  dateKey: string
  sessionNumber: number
  sessionLabel: string
  state: "active" | "normal" | "makeup"
}>

export type RegistrationObservationEnrollmentStartSource =
  | Readonly<{
      sessionAuthority: "normalized"
      classStartSessionKey: string
      classStartLessonSessionId: string
      legacySessionKey: null
      sourceRevision: Readonly<{ authority: "normalized"; sessionId: string; revision: number }>
    }>
  | Readonly<{
      sessionAuthority: "legacy"
      classStartSessionKey: string
      classStartLessonSessionId: null
      legacySessionKey: string
      sourceRevision: Readonly<{ authority: "legacy"; sessionKey: string; contentHash: string }>
    }>

export type RegistrationEnrollmentStartOption =
  | Readonly<{
      source: "regular"
      sourceObservationId: ""
      trackId: string
      classId: string
      classStartSessionKey: string
      classStartLessonSessionId: string | null
      sessionDate: string
      label: string
    }>
  | (Readonly<{
      source: "observation"
      sourceObservationId: string
      trackId: string
      classId: string
      sessionDate: string
      startsAt: string
      endsAt: string
      label: string
    }> & RegistrationObservationEnrollmentStartSource)

export function getRegistrationEnrollmentStartOptions(input: {
  regularSessions: readonly RegistrationScheduleSession[]
  matchingObservation: RegistrationObservationFeedbackDetail | null
  finalClassId: string
}): readonly RegistrationEnrollmentStartOption[]
```

- [ ] **Step 1: 과거 특별 option RED 작성**

```js
test("matching fit observation is injected before future sessions and remains overridable", () => {
  const options = getRegistrationEnrollmentStartOptions({
    regularSessions: [futureSession],
    matchingObservation: fitPastObservation,
    finalClassId: fitPastObservation.classId,
  })
  assert.equal(options[0].sourceObservationId, fitPastObservation.observationId)
  assert.equal(options[1].sourceObservationId, "")
})
```

- [ ] **Step 2: RED 실행**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test --test-name-pattern="observation|first lesson|시작일" tests/registration-track-model.test.mjs tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs
```
Expected: option helper·source field·copy가 없어 FAIL.

- [ ] **Step 3: model/service serialization 구현**

특별 option은 manager detail의 bounded scalar `latestEnrollmentDecisionObservationId`만 후보 ID로 사용한다. non-null일 때 dedicated `get_registration_observation_feedback_v1`을 정확히 한 번 bounded load하고, attempts 배열을 최신 결정 source 탐색에 사용하지 않는다. 반환 detail의 `observationId`가 scalar와, `trackId`가 현재 track과 같지 않으면 fail closed한다. client eligibility는 `status=completed + attendance=attended + suitabilityResult=fit + decisionKind=enrollment + same track + same final class`를 모두 만족해야 한다. source detail의 `sessionDate`, `sessionKey`, `classLessonSessionId | legacySessionKey`, `sourceRevision`, start/end를 observation branch exact union으로 그대로 사용하며 arbitrary 과거 날짜를 만들지 않는다. 현재 `getSelectableRegistrationScheduleSessions`는 source revision/start/end를 제공하지 않으므로 regular branch에는 이를 발명하지 않는다; `value → classStartSessionKey`, optional `lessonSessionId → classStartLessonSessionId|null`, `dateKey → sessionDate`만 매핑하고 기존 서버 validator에 맡긴다. final class가 달라지면 observation option과 기존 selection source를 즉시 제거한다. regular session을 선택하면 `sourceObservationId` draft sentinel은 빈 문자열로 두되 RPC serializer는 `classStartSourceObservationId`를 `null`로 보낸다. service는 `classStartSourceObservationId`를 payload와 response 모두 exact-key로 매핑한다.

- [ ] **Step 4: enrollment editor UI 구현**

첫 수업일 선택 바로 위에 다음 한 블록만 표시한다.

```text
최근 적합 청강
8월 17일 · 중2 영어 A반 · 참석 · 적합
첫 수업일 기본값에 반영했습니다.
```

동일 final class의 가장 최근 eligible observation을 기본 선택한다. 원장이 다른 미래 회차를 선택하면 그 값을 유지하고 refresh가 다시 청강일로 덮어쓰지 않는다. source가 stale이면 저장 전 서버 오류를 한국어로 보여주고 입력값을 유지한다.

- [ ] **Step 5: 회귀 테스트**

등록 결정일 이전 청강 회차 노출, completed+attended+fit+enrollment-decision+same-track/class 기본값, 결정 없는 fit과 unfit/no-show/canceled/different-track/class 제외, 원장 override, class 변경 시 source 제거, reload 후 persisted source 표시, 기존 일반 미래 회차만 있는 흐름 무변경을 검사한다.

- [ ] **Step 6: 검증·커밋**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-track-model.test.mjs tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/tasks/registration-track-service.ts src/features/tasks/registration-enrollment-editor.tsx tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
git diff --check
```
Expected: focused tests, ESLint, tsc, diff PASS.

Commit:
```bash
git add src/features/tasks/registration-track-model.js src/features/tasks/registration-track-model.d.ts src/features/tasks/registration-track-service.ts src/features/tasks/registration-enrollment-editor.tsx tests/registration-track-model.test.mjs tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs
git commit -m "feat: suggest observation as first lesson"
```

---

### Task 8: 청강 달력·전체 회귀 검증

**Files:**
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/registration-appointment-calendar-model.ts`
- Modify: `src/features/tasks/registration-appointment-calendar.tsx`
- Modify: `src/features/tasks/registration-observation-editor.tsx`
- Modify: `src/features/tasks/registration-workspace-route.ts`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `tests/registration-observation-calendar.test.mjs`
- Modify: `tests/registration-track-service.test.mjs`
- Modify: `tests/registration-workspace-route.test.mjs`
- Modify: `tests/registration-appointment-calendar.test.mjs`
- Modify: `tests/registration-observation-workspace.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`

**Interfaces:**
- Produces: calendar filter key `observation`; exact navigation `/admin/registration?taskId={taskId}&trackId={trackId}&appointmentId={appointmentId}&observationId={observationId}&view=calendar`
- Consumes: core `loadRegistrationObservationManagerAttempt(client,{trackId,observationId})` exact one-row read; `RegistrationObservationEditor` receives optional `deepLinkedAttempt: RegistrationObservationAttempt | null` and deduplicates it by observation ID against the recent manager detail.
- Provider-consumer contract: the calendar builder and the Google Chat/in-app registration adapter emit the same canonical key order `taskId,trackId,appointmentId,observationId,view`; the shared provider validator accepts only one of each exact key, no extra key, four valid UUID values and literal `view=calendar`, while remaining order-independent when validating an otherwise exact tuple. No consumer may emit or bless any alternate ordering.
- Extends the current direct-view projection in `src/features/tasks/registration-track-service.ts` exactly:

```ts
const REGISTRATION_APPOINTMENT_CALENDAR_COLUMNS = [
  "appointment_id", "task_id", "student_name", "kind", "scheduled_at",
  "place", "status", "notification_revision", "track_ids", "subjects",
  "observation_id", "observation_track_id", "observation_class_id",
  "observation_class_name", "observation_ends_at",
  "observation_teacher_name", "observation_classroom_name",
].join(",")

export type RegistrationAppointmentCalendarDatabaseKind =
  | "level_test" | "visit_consultation" | "observation_class"
export type RegistrationAppointmentCalendarKind =
  | "level_test" | "visit_consultation" | "observation"

export type RegistrationAppointmentCalendarRow = Readonly<{
  appointment_id: string
  task_id: string
  student_name: string
  kind: RegistrationAppointmentCalendarDatabaseKind
  scheduled_at: string
  place: string
  status: "scheduled" | "completed" | "canceled"
  notification_revision: number
  track_ids: string[]
  subjects: RegistrationSubject[]
  observation_id: string | null
  observation_track_id: string | null
  observation_class_id: string | null
  observation_class_name: string | null
  observation_ends_at: string | null
  observation_teacher_name: string | null
  observation_classroom_name: string | null
}>

type RegistrationAppointmentCalendarItemBase = Readonly<{
  id: `registration-appointment:${string}`
  appointmentId: string
  taskId: string
  studentName: string
  scheduledAt: string
  place: string
  status: "scheduled" | "completed" | "canceled"
  notificationRevision: number
  trackIds: string[]
  subjects: RegistrationSubject[]
  href: string
}>

export type RegistrationAppointmentCalendarItem =
  | (RegistrationAppointmentCalendarItemBase & Readonly<{
      kind: "level_test" | "visit_consultation"
      observationId: null
      observationTrackId: null
      observationClassId: null
      observationClassName: null
      observationEndsAt: null
      observationTeacherName: null
      observationClassroomName: null
    }>)
  | (RegistrationAppointmentCalendarItemBase & Readonly<{
      kind: "observation"
      observationId: string
      observationTrackId: string
      observationClassId: string
      observationClassName: string
      observationEndsAt: string
      observationTeacherName: string
      observationClassroomName: string
    }>)

export type RegistrationAppointmentCalendarBuildOptions = Readonly<{
  statuses?: readonly ("scheduled" | "completed" | "canceled")[]
  observationRuntimeVersion: 0 | 1
}>

export type RegistrationAppointmentCalendarLoadInput = Readonly<{
  rangeStart: string
  rangeEnd: string
  statuses?: readonly ("scheduled" | "completed" | "canceled")[]
  observationRuntimeVersion: 0 | 1
}>

export function buildRegistrationAppointmentHref(
  taskId: string,
  appointmentId: string,
  observation: Readonly<{ trackId: string; observationId: string }> | null = null,
): string
```

The builder keeps the existing two-argument output byte-for-byte, but its observation branch validates all four IDs with the same UUID shape as the Google shared validator and inserts the query entries in this exact order:

```ts
const query = new URLSearchParams()
query.set("taskId", normalizedTaskId)
if (observation) query.set("trackId", normalizedObservationTrackId)
query.set("appointmentId", normalizedAppointmentId)
if (observation) query.set("observationId", normalizedObservationId)
query.set("view", "calendar")
return `/admin/registration?${query.toString()}`
```

Only the observation branch requires canonical UUIDs for `taskId`, `trackId`, `appointmentId`, and `observationId`; the existing two-argument legacy builder continues its current nonempty-string validation and encoding behavior.

- Produces exact route contract:

```ts
export const REGISTRATION_WORKSPACE_DETAIL_KEYS = [
  "taskId", "trackId", "appointmentId", "observationId", "view",
] as const

export type RegistrationDirectDeepLinkTarget =
  | { kind: "track"; taskId: string; trackId: string }
  | { kind: "case"; taskId: string }
  | { kind: "appointment"; taskId: string; trackId: string | null; appointmentId: string }
  | {
      kind: "observation"
      taskId: string
      trackId: string
      appointmentId: string
      observationId: string
      view: "calendar"
    }

export function getRegistrationDirectDeepLinkTarget(input: {
  viewerId: string
  searchParams: URLSearchParams
  observationRuntimeVersion: 0 | 1
  workspaceReady: boolean
  currentSelectionKey: string
  currentAppointmentId?: string
  currentObservationId?: string
}): RegistrationDirectDeepLinkTarget | null
```

기존 `getRegistrationDirectDeepLinkTarget`은 browser가 이미 보유한 raw `URLSearchParams`를 받아 내부에서 값을 읽도록 바꾼다. `observationId` key 자체가 없으면 현재 case/track/appointment branch 동작을 그대로 보존한다. key가 하나라도 있으면 observation branch로 fail closed하고, runtime 1이며 query가 `taskId,trackId,appointmentId,observationId,view`를 각각 정확히 한 번만 포함하고 다른 key가 없으며 네 ID가 Google shared validator와 같은 UUID shape이고 `view === "calendar"`인 경우에만 target을 반환한다. 생성 순서는 canonical tuple로 고정하지만 validator는 otherwise-exact tuple의 입력 순서에는 의존하지 않는다. Missing/empty/duplicate/extra/malformed member, runtime 0 또는 invalid relation input은 null이며 존재 여부를 드러내는 appointment fallback으로 낮추지 않는다. 함수는 전달받은 `URLSearchParams`를 mutate하지 않는다.

- [ ] **Step 1: appointment 단위 count·link RED 작성**

```js
test("observation calendar counts one appointment once", () => {
  const items = buildRegistrationAppointmentCalendarItems(sharedObservationFixture, {
    observationRuntimeVersion: 1,
  })
  const observationItem = items.find((item) => item.kind === "observation")
  assert.ok(observationItem)
  assert.equal(items.filter((item) => item.kind === "observation").length, 1)
  const orderedTuple = [
    ["taskId", observationItem.taskId],
    ["trackId", observationItem.observationTrackId],
    ["appointmentId", observationItem.appointmentId],
    ["observationId", observationItem.observationId],
    ["view", "calendar"],
  ]
  const expectedHref = `/admin/registration?${new URLSearchParams(orderedTuple).toString()}`
  assert.equal(observationItem.href, expectedHref)
  assert.deepEqual(
    [...new URL(observationItem.href, "https://tips.invalid").searchParams.entries()],
    orderedTuple,
  )
})

test("observation calendar consumer requires one exact five-key tuple", () => {
  const orderedTuple = [
    ["taskId", taskId],
    ["trackId", trackId],
    ["appointmentId", appointmentId],
    ["observationId", observationId],
    ["view", "calendar"],
  ]
  const targetFor = (entries) => getRegistrationDirectDeepLinkTarget({
    ...directTargetState,
    searchParams: new URLSearchParams(entries),
    observationRuntimeVersion: 1,
  })
  assert.deepEqual(targetFor(orderedTuple), {
    kind: "observation",
    taskId,
    trackId,
    appointmentId,
    observationId,
    view: "calendar",
  })
  assert.deepEqual(targetFor([...orderedTuple].reverse()), exactTarget)

  for (const [key, value] of orderedTuple) {
    const missing = orderedTuple.filter(([candidate]) => candidate !== key)
    const duplicate = [...orderedTuple, [key, value]]
    const empty = orderedTuple.map(([candidate, candidateValue]) => (
      candidate === key ? [candidate, ""] : [candidate, candidateValue]
    ))
    assert.equal(targetFor(missing), null)
    assert.equal(targetFor(duplicate), null)
    assert.equal(targetFor(empty), null)
  }

  assert.equal(targetFor([...orderedTuple, ["extra", "1"]]), null)
  assert.equal(targetFor(orderedTuple.map(([key, value]) => (
    key === "appointmentId" ? ["appointmentID", value] : [key, value]
  ))), null)
  for (const idKey of ["taskId", "trackId", "appointmentId", "observationId"]) {
    assert.equal(targetFor(orderedTuple.map(([key, value]) => (
      key === idKey ? [key, "not-a-uuid"] : [key, value]
    ))), null)
  }
  assert.equal(targetFor(orderedTuple.map(([key, value]) => (
    key === "view" ? [key, "list"] : [key, value]
  ))), null)
})

test("runtime zero hides observation rows, filter, and deep links", () => {
  const items = buildRegistrationAppointmentCalendarItems(sharedObservationFixture, {
    observationRuntimeVersion: 0,
  })
  assert.equal(items.some((item) => item.kind === "observation"), false)
  assert.equal(normalizeRegistrationWorkspaceCalendarKind("observation", 0), "all")
  assert.equal(getRegistrationDirectDeepLinkTarget({
    ...validObservationInput,
    observationRuntimeVersion: 0,
  }), null)
})

test("calendar deep link requires exact view and clears stale detail keys", () => {
  assert.deepEqual(getRegistrationDirectDeepLinkTarget(validObservationInput), exactTarget)
  const listQuery = new URLSearchParams(validObservationInput.searchParams)
  listQuery.set("view", "list")
  assert.equal(getRegistrationDirectDeepLinkTarget({
    ...validObservationInput,
    searchParams: listQuery,
  }), null)
  assert.equal(getRegistrationDirectDeepLinkTarget({
    ...validObservationInput,
    searchParams: invalidRelationParams,
  }), null)
  const next = buildRegistrationWorkspaceSearchParams(queryAfterTrackChange, listTarget)
  for (const key of REGISTRATION_WORKSPACE_DETAIL_KEYS) assert.equal(next.has(key), false)
})

test("calendar service selects the exact appended DTO fields", () => {
  assert.deepEqual(readCalendarColumns(serviceSource), [
    "appointment_id", "task_id", "student_name", "kind", "scheduled_at",
    "place", "status", "notification_revision", "track_ids", "subjects",
    "observation_id", "observation_track_id", "observation_class_id",
    "observation_class_name", "observation_ends_at",
    "observation_teacher_name", "observation_classroom_name",
  ])
  assert.deepEqual(runtimeZeroCalendarQuery.notEquals, [
    ["kind", "observation_class"],
  ])
})

test("calendar opens an exact observation older than the manager-detail limit", async () => {
  assert.equal(recentManagerDetail.attempts.length, 50)
  assert.equal(
    recentManagerDetail.attempts.some(
      (attempt) => attempt.observationId === oldestCalendarAttempt.observationId,
    ),
    false,
  )
  const workspace = renderOpsTaskWorkspace({
    routeTarget: oldestCalendarTarget,
    managerDetail: recentManagerDetail,
    loadRegistrationObservationManagerAttempt: fakeSingleAttemptLoader({
      trackId: oldestCalendarTarget.trackId,
      taskId: oldestCalendarTarget.taskId,
      observation: oldestCalendarAttempt,
    }),
  })
  await workspace.settle()
  assert.deepEqual(workspace.singleAttemptCalls, [{
    trackId: oldestCalendarTarget.trackId,
    observationId: oldestCalendarTarget.observationId,
  }])
  assert.equal(workspace.openObservationId, oldestCalendarTarget.observationId)
  assert.equal(workspace.visibleAttemptIds[0], oldestCalendarTarget.observationId)
  assert.equal(workspace.appointmentFallbackCalls, 0)
})

test("calendar exact lookup fails closed on every URL-to-row mismatch", async () => {
  for (const returned of [
    { ...validSingleAttempt, taskId: otherTaskId },
    { ...validSingleAttempt, trackId: otherTrackId },
    { ...validSingleAttempt, observation: { ...validSingleAttempt.observation, observationId: otherObservationId } },
    { ...validSingleAttempt, observation: { ...validSingleAttempt.observation, appointmentId: otherAppointmentId } },
  ]) {
    const workspace = renderOpsTaskWorkspace({
      routeTarget: validObservationTarget,
      loadRegistrationObservationManagerAttempt: fakeSingleAttemptLoader(returned),
    })
    await workspace.settle()
    assert.equal(workspace.openObservationId, null)
    assert.equal(workspace.appointmentFallbackCalls, 0)
    assert.equal(workspace.existenceToastCount, 0)
  }
})
```

- [ ] **Step 2: RED 실행**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-calendar.test.mjs tests/registration-observation-workspace.test.mjs tests/registration-workspace-route.test.mjs tests/registration-appointment-calendar.test.mjs tests/registration-track-service.test.mjs tests/ops-task-workspace.test.mjs
```
Expected: appended select/DTO, runtime gate, canonical builder golden, raw `URLSearchParams` exact-key/multiplicity/UUID 검증, single-attempt loader consumption과 >50 deep-link editor merge가 없어 FAIL.

- [ ] **Step 3: 달력 mapping과 UI 구현**

`registration-track-service.ts`의 existing direct `.from("ops_registration_appointment_calendar").select(REGISTRATION_APPOINTMENT_CALENDAR_COLUMNS)` path를 유지하고 위 일곱 fields를 constant 끝에 추가한다. 새 RPC/fetch path는 만들지 않는다. load input은 exact `observationRuntimeVersion`을 받고 runtime0 query에 `.neq("kind","observation_class")`를 적용해 observation rows가 browser payload에 들어오기 전에 차단한다. `buildRegistrationAppointmentCalendarItems`도 defense-in-depth로 runtime0 observation rows를 버리고, runtime1에서는 raw `observation_class`를 item/filter `observation`으로 바꿔 appointment ID당 한 번만 산출한다. Observation row는 appended fields 전부 non-null UUID/text/timestamp, `observation_track_id`가 `track_ids` exact one member, subject exact one member, `scheduled_at < observation_ends_at`이어야 한다. Old kinds는 appended fields 전부 null이어야 한다. Invalid cross-shape는 fail closed한다.

학생·과목·반·시작/종료·선생님·장소·상태만 표시하고 feedback 사유, phone, school, inquiry, textbook/progress는 포함하지 않는다. Existing two-argument `buildRegistrationAppointmentHref(taskId,appointmentId)` behavior는 optional observation 인자를 null로 두어 byte-for-byte 보존하고, observation item만 `{trackId,observationId}`를 넘겨 `taskId,trackId,appointmentId,observationId,view=calendar` 순서의 exact URL을 만든다. 이 golden은 Google Chat adapter가 만들고 shared provider validator가 소비하는 static observation detail tuple과 동일하며, UI 또는 provider 어느 쪽도 다른 순서를 생성하지 않는다. `observationRuntimeVersion===0`이면 model이 raw observation row를 item으로 만들지 않고, filter/count/button을 렌더하지 않으며, route normalizer가 `observation`을 `all`로 닫고 workspace가 observation detail을 fetch/open하지 않는다. Existing level-test/visit calendar remains available. Runtime 1에서만 exact observation URL을 만든다.

기존 private `DETAIL_KEYS`를 exported `REGISTRATION_WORKSPACE_DETAIL_KEYS`로 rename/확장해 canonical `taskId,trackId,appointmentId,observationId,view` 다섯 query key만 지운다. calendar kind normalizer의 기존 `level_test|visit_consultation`에 runtime-gated `observation`을 추가하되 unknown은 계속 `all`이다. observation link는 raw `URLSearchParams`를 복제해 exact-key/multiplicity/value 검사를 통과한 runtime1, literal `view=calendar`, 네 UUID 조합만 observation target으로 정규화한다. Extra/duplicate/missing/empty/malformed query는 appointment branch로 downgrade하지 않는다.

`ops-task-workspace`는 current `window.location.search`의 raw `URLSearchParams`를 scalar로 분해하지 않고 route helper에 전달하고, helper가 승인한 URL의 exact task를 선택한 뒤 manager detail `attempts` membership을 권위로 사용하지 않고 `loadRegistrationObservationManagerAttempt({trackId,observationId})`를 정확히 한 번 호출한다. 반환 three-key DTO의 `taskId === URL taskId`, `trackId === URL trackId`, `observation.appointmentId === URL appointmentId`, `observation.observationId === URL observationId` 네 관계를 canonical tuple 순서로 모두 검사한 뒤에만 `RegistrationObservationEditor`에 `deepLinkedAttempt`로 전달한다. RPC의 `P0002`, malformed DTO 또는 한 관계라도 불일치하면 not-found-equivalent로 selection을 fail closed하고 appointment fallback, 일반 appointment loader, 존재 toast를 호출하지 않는다. 이 단건 read는 manager detail의 최근 50개 배열이나 cache에 target을 삽입하지 않는다.

Editor는 manager detail attempts 앞에 valid `deepLinkedAttempt`를 표시하되 같은 observation ID가 이미 최근 배열에 있으면 deep-equal을 요구하고 한 번만 표시한다; 같은 ID payload가 다르면 fail closed한다. Valid calendar target이면 merged 배열의 첫 항목 여부와 무관하게 URL의 exact observation ID를 selected attempt로 설정하므로 51번째 이전의 완료/취소 attempt도 단건 DTO로 바로 열린다. Editor close/track change/runtime0에서는 DTO state를 폐기한다. mutation 뒤 URL target이 유지되면 단건 RPC와 manager detail을 각각 한 번 refresh하고 다시 관계를 검증한다. 사용자가 task/track을 바꾸거나 detail을 닫거나 runtime이 0으로 바뀌면 `appointmentId`, `observationId`, stale `view`를 URL에서 함께 제거한다. calendar list의 malformed item에는 link를 만들지 않는다.

- [ ] **Step 4: 전체 focused·build 검증**

Run:
```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-*.test.mjs tests/registration-workspace-route.test.mjs tests/registration-track-model.test.mjs tests/registration-track-service.test.mjs tests/registration-track-workspace.test.mjs tests/registration-appointment-calendar.test.mjs tests/ops-task-workspace.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus feedback
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/run-registration-observation-local-db-qa.mjs --execute --approved-local-db --focus enrollment
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint 'src/app/admin/registration/observations/[observationId]/feedback/page.tsx' src/features/tasks/registration-observation-*.ts src/features/tasks/registration-observation-*.tsx src/features/tasks/registration-enrollment-editor.tsx src/features/tasks/registration-track-service.ts src/features/tasks/registration-appointment-calendar-model.ts src/features/tasks/registration-appointment-calendar.tsx src/features/tasks/registration-workspace-route.ts
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/next/dist/bin/next build --webpack
git diff --check
```
Expected: feedback focus independently ends at `20260809103500`, enrollment focus independently ends at `20260809104000`; both clean apply/pgTAP plus all focused tests, ESLint, tsc, production build and diff PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/features/tasks/registration-track-service.ts src/features/tasks/registration-appointment-calendar-model.ts src/features/tasks/registration-appointment-calendar.tsx src/features/tasks/registration-observation-editor.tsx src/features/tasks/registration-workspace-route.ts src/features/tasks/ops-task-workspace.tsx tests/registration-observation-calendar.test.mjs tests/registration-observation-workspace.test.mjs tests/registration-track-service.test.mjs tests/registration-workspace-route.test.mjs tests/registration-appointment-calendar.test.mjs tests/ops-task-workspace.test.mjs
git commit -m "feat: show observations on registration calendar"
```

## Plan Completion Gate

- [ ] assigned teacher/admin/staff/director/unrelated actor matrix가 clean pgTAP에서 통과한다.
- [ ] 시작 전 attendance/no-show, 종료 전 fit/unfit, stale revision, 중복 request가 모두 fail closed한다.
- [ ] decision은 observation+feedback+track 세 revision을 검사하고 enrollment/payment를 만들지 않는다.
- [ ] teacher route는 최소 projection만 사용하고 전체 registration case를 읽지 않는다.
- [ ] 적합·같은 반 청강만 과거 특별 option이 되며 원장 override가 저장된다.
- [ ] feedback-submit, feedback, enrollment focus는 각각 concrete committed fixture hook으로 exact `start→reset→setup COMMIT→pgTAP→cleanup COMMIT→fresh runtime0/fixture-zero→stop`을 수행하고 primary/cleanup 오류를 보존한다.
- [ ] enrollment save는 id-less preexisting draft를 먼저 결속하고 final date/key/lesson/source를 receipt-free canonical DML helper의 단일 set-based write로 저장한다. legacy save 후 source clear/update, raw detail JSON, sanitized/nested/derived-key receipt는 없고 public rows/details operation은 original caller key receipt를 각각 하나만 소유한다.
- [ ] 신규 direct/details save의 row audit·parent recompute·details audit은 계약대로 정확히 한 번이고 replay는 모두 0회다. Direct rows의 `enrollment_decided|registered` gate와 details-only transaction-local GUC bypass가 기존처럼 분리된다.
- [ ] runtime0은 새 non-null observation source만 거부하고 same-fingerprint replay, regular save, source removal을 보존한다.
- [ ] 104000 calendar view/helper forward replacement과 Task 8 exact service DTO/select가 일치하며, 달력은 appointment 단위 한 건이고 runtime0에서 observation filter/row/deep-link/detail을 모두 숨긴다. Runtime1에서는 calendar builder와 Google Chat/in-app provider consumer가 `taskId,trackId,appointmentId,observationId,view=calendar` golden을 공유하고, extra/duplicate/missing/malformed tuple은 fallback 없이 닫히며, 최근 manager detail 50개 밖의 observation도 exact single-attempt RPC로 열리고 네 URL 관계가 모두 재검증된다.
- [ ] enrollment focus는 roadmap의 exact rollback SQL을 migration artifact 없이 rehearsal해 1→0/0→0와 open observation/data preservation을 증명한다.
- [ ] focused test, clean DB/pgTAP, ESLint, tsc, `next build --webpack`, `git diff --check`가 모두 PASS한다.
- [ ] downstream profile-mention/Google Chat 계획이 소비할 feedback/domain event와 current teacher/director facts는 저장됐지만, 이 계획 자체의 Directory/webhook/provider call은 0이다.
