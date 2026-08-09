# Registration Observation Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 등록의 `등록 신청` 직전에 과목별 청강 예약·고객 안내·3시간 전 리마인드·과목방 준비 알림·담당 교사 피드백·원장 최종 결정·청강일 기반 첫 수업일 제안을 추가한다.

**Architecture:** 기존 `ops_registration_appointments`를 예약 권위로 확장하고, 시도별 `ops_registration_observations` 원장과 due-time 작업 큐를 연결한다. 모든 도메인 변경은 revision·request key를 검증하는 전용 SECURITY DEFINER RPC가 원자 처리하고, 외부 전송은 저장 이후 notification control plane과 SOLAPI worker가 별도로 수행한다. 첫 화면은 고정 크기 summary만 읽고 observation 상세·수업 회차·피드백은 상세 화면에서 제한시간이 있는 지연 조회로 불러온다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase Postgres/PostgREST/RLS, SOLAPI AlimTalk, Google Chat webhook, Node test runner, pgTAP, ESLint, Vercel

## Global Constraints

- 승인된 설계 문서 `docs/superpowers/specs/2026-08-09-registration-observation-workflow-design.md`가 제품 계약의 권위다. 구현 중 계약 변경이 필요하면 코드를 진행하지 않고 설계 문서를 먼저 다시 승인받는다.
- 청강은 과목 track 단위이며 `등록 신청` 직전의 선택 경로다. 상담 완료에서 등록 신청으로 직접 가는 기존 경로를 제거하지 않는다.
- `ops_registration_appointments`는 예약 사실, `ops_registration_observations`는 반·회차·참석·평가·결정 사실을 소유한다. terminal appointment를 다시 scheduled로 되돌리지 않는다.
- appointment `notification_revision`, observation `revision`, observation `feedback_revision`, track `workflow_revision`의 책임을 합치지 않는다.
- 브라우저가 보낸 학생·과목·반·선생님·강의실·campus·전화번호·수업 회차 문구를 신뢰하지 않는다. 서버가 canonical 관계와 현재 session 권위를 다시 resolve한다.
- 청강 진입·예약·취소·참석·피드백·결정·철회 RPC는 request key와 해당 expected revision을 검사하고 같은 key 재호출에는 같은 결과를 반환한다.
- domain transaction 안에서 Google Chat 또는 SOLAPI를 호출하지 않는다. 외부 전송 실패가 예약·피드백·결정을 rollback하지 않는다.
- 미등록 결정과 청강 flow는 enrollment, admission, payment 행을 생성·수정·삭제하지 않는다. 기존 독립 draft도 건드리지 않는다.
- assigned teacher에게 전체 `ops_tasks` 읽기 권한을 추가하지 않는다. 전용 feedback RPC는 최소 projection만 반환하고 unrelated teacher에게는 not-found로 닫는다.
- Google Chat 본문에는 전화번호, 적합/부적합 결과, 피드백 사유, 내부 UUID를 넣지 않는다. UUID는 인증된 Dashboard 버튼 target에만 포함한다.
- 등록 첫 화면에서 `classes.select('*')`, 전체 `schedule_plan`, 전체 observation 또는 feedback scan을 금지한다. 상세 조회는 12초 AbortSignal과 `.retry(false)`를 적용한다.
- 고객 리마인드 최초 운영값은 3시간이다. lead time 미만 예약은 리마인드 작업을 만들지 않고 즉시 대체 발송도 하지 않는다.
- 신규 Google Chat workflow rule과 observation runtime은 기본 OFF다. 코드 배포·DB migration만으로 외부 provider를 활성화하지 않는다.
- SOLAPI `observation_booking`, `observation_reminder`는 승인 checksum·sender/channel·변수·버튼·no-SMS-fallback preflight가 모두 통과하기 전 provider 호출을 0회로 유지한다.
- 기존 migration은 수정하지 않는다. 모든 DB 변경은 아래 새 forward-only migration으로 추가한다.
- 각 Task는 RED를 실제로 관찰하고 최소 GREEN을 만든 뒤 focused test, lint/typecheck 또는 SQL 검증, `git diff --check`, 커밋을 완료하고 다음 Task로 이동한다.
- 공유 worktree의 사용자 변경이나 다른 브랜치 커밋을 섞지 않는다. 각 Task 시작 전 `git status --short`와 `git diff --stat`으로 경계를 확인한다.

---

### Task 1: 청강 스키마, workflow 상태, 비활성 runtime gate

**Files:**
- Create: `supabase/migrations/20260809100000_registration_observation_schema.sql`
- Create: `tests/registration-observation-schema.test.mjs`
- Create: `tests/registration-observation-model.test.mjs`
- Modify: `src/features/tasks/registration-workflow-status.js`
- Modify: `src/features/tasks/registration-workflow-status.d.ts`
- Modify: `src/features/tasks/registration-track-model.js`
- Modify: `src/features/tasks/registration-track-model.d.ts`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `tests/registration-workflow-status.test.mjs`
- Modify: `tests/registration-workflow.test.mjs`
- Modify: `tests/registration-track-model.test.mjs`
- Create: `supabase/tests/registration_observation_workflow_test.sql`

**Interfaces:**
- Consumes: `ops_registration_subject_tracks`, `ops_registration_appointments`, `ops_registration_enrollments`, `classes`, `class_lesson_sessions`, `teacher_catalogs`, `classroom_catalogs`, `profiles`
- Produces: workflow statuses `observation_requested | observation_feedback_pending | observation_completed`; appointment kind `observation_class`; tables `public.ops_registration_observations`, `dashboard_private.registration_observation_mutation_requests`, `dashboard_private.registration_observation_due_jobs`, `dashboard_private.registration_observation_runtime_settings`; `public.registration_observation_runtime_version()`
- Produces: `OpsRegistrationObservation`, `OpsRegistrationObservationStatus`, `OpsRegistrationObservationDecisionKind`, `OpsRegistrationSessionAuthority`

- [ ] **Step 1: workflow와 schema 계약 RED 테스트 작성**

  `tests/registration-observation-schema.test.mjs`에서 새 migration을 읽어 다음 계약을 검증한다.

  ```js
  test("observation schema keeps attempts, revisions, finance, and runtime isolated", async () => {
    const sql = normalizeSql(await readFile(observationSchemaUrl, "utf8"))
    assert.match(sql, /create table public\.ops_registration_observations/)
    assert.match(sql, /appointment_id uuid not null unique/)
    assert.match(sql, /feedback_revision bigint not null default 0/)
    assert.match(sql, /class_start_source_observation_id uuid/)
    assert.match(sql, /create unique index .*open.* on public\.ops_registration_observations\(track_id\).*decision_kind is null/)
    assert.match(sql, /insert into dashboard_private\.registration_observation_runtime_settings.*0/)
    assert.doesNotMatch(sql, /insert into .*payment|update .*payment|delete from .*payment/)
  })
  ```

  `tests/registration-workflow-status.test.mjs`는 view 순서가 `waiting → observation → enrollment`이고 세 observation 상태가 `observation` view에 묶이는지 검증한다. `tests/registration-observation-model.test.mjs`는 status, decision, session authority의 허용값과 알 수 없는 값 fail-closed를 요구한다.

- [ ] **Step 2: Task 1 RED 확인**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-schema.test.mjs tests/registration-observation-model.test.mjs tests/registration-workflow-status.test.mjs tests/registration-workflow.test.mjs tests/registration-track-model.test.mjs
  ```
  Expected: 새 migration과 observation exports가 없어 FAIL하고, 기존 workflow view 순서 assertion도 FAIL.

- [ ] **Step 3: forward-only schema migration 구현**

  migration은 다음 순서로 작성한다.

  1. `classroom_catalogs.campus text null`과 `본관 | 별관` check를 추가한다. 이름으로 자동 backfill하지 않는다.
  2. track에 `observation_return_workflow_status text null`을 추가하고 workflow check를 세 observation 상태까지 확장한다. observation flow 안에서는 return 값이 반드시 non-null이고 밖에서는 반드시 null인 양방향 check를 둔다.
  3. appointment kind check에 `observation_class`를 추가한다.
  4. observation 원장, mutation request 원장, due job 원장과 audit-friendly revision·actor·timestamp 컬럼을 생성한다.
  5. `appointment_id` unique, track의 열린 attempt partial unique, `track_id/decision_kind/status`, `teacher_profile_id/status`, `due_at/status`, `appointment_id` 인덱스를 만든다.
  6. enrollment에 `class_start_source_observation_id` FK를 nullable로 추가한다.
  7. runtime singleton을 `runtime_version = 0`으로 seed하고 `registration_observation_runtime_version()`은 authenticated에만 EXECUTE를 허용한다.
  8. observation 직접 INSERT/UPDATE/DELETE와 private tables는 authenticated에게 허용하지 않는다.

  핵심 check 형태는 다음과 같이 고정한다.

  ```sql
  constraint ops_registration_observations_session_source_check check (
    (session_authority = 'normalized' and class_lesson_session_id is not null and legacy_session_key is null)
    or
    (session_authority = 'legacy' and class_lesson_session_id is null and legacy_session_key is not null)
  ),
  constraint ops_registration_observations_feedback_check check (
    (suitability_result is null and feedback_reason is null)
    or
    (suitability_result in ('fit', 'unfit') and nullif(btrim(feedback_reason), '') is not null)
  )
  ```

- [ ] **Step 4: TypeScript와 workflow 상수 최소 구현**

  `registration-track-service.ts`의 union과 row mapper에 세 상태, observation summary scalar, `observationReturnWorkflowStatus`를 추가한다. 목록 view는 다음 literal 순서를 사용한다.

  ```js
  export const REGISTRATION_WORKFLOW_VIEWS = Object.freeze([
    ["inquiry", "문의"],
    ["level_test", "레벨테스트 신청"],
    ["consultation_requested", "상담 신청"],
    ["consultation_completed", "상담 완료"],
    ["waiting", "대기 신청"],
    ["observation", "청강 신청"],
    ["enrollment", "등록 신청"],
    ["admission", "입학 진행"],
    ["completed", "완료"],
  ])
  ```

  `registration-track-model`은 세 observation 상태를 `observation`으로 분류하고 직접 등록 가능성은 `consultation_completed`에서 계속 true로 유지한다.

- [ ] **Step 5: pgTAP schema 불변식 추가**

  `supabase/tests/registration_observation_workflow_test.sql` 첫 section에 table, column, FK, check, partial unique, RLS, runtime default 0, authenticated direct-write denial을 넣는다. 서로 다른 track에는 열린 observation을 만들 수 있고 같은 track 두 번째 열린 observation은 실패하는 transaction fixture를 추가한다.

- [ ] **Step 6: Task 1 GREEN 및 커밋**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-schema.test.mjs tests/registration-observation-model.test.mjs tests/registration-workflow-status.test.mjs tests/registration-workflow.test.mjs tests/registration-track-model.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/tasks/registration-workflow-status.js src/features/tasks/registration-track-model.js src/features/tasks/registration-track-service.ts tests/registration-observation-schema.test.mjs tests/registration-observation-model.test.mjs
  git diff --check
  ```

  Commit:
  ```bash
  git add supabase/migrations/20260809100000_registration_observation_schema.sql supabase/tests/registration_observation_workflow_test.sql src/features/tasks/registration-workflow-status.js src/features/tasks/registration-workflow-status.d.ts src/features/tasks/registration-track-model.js src/features/tasks/registration-track-model.d.ts src/features/tasks/registration-track-service.ts tests/registration-observation-schema.test.mjs tests/registration-observation-model.test.mjs tests/registration-workflow-status.test.mjs tests/registration-workflow.test.mjs tests/registration-track-model.test.mjs
  git commit -m "feat: add registration observation domain"
  ```

---

### Task 2: canonical 회차 resolver와 예약 생성·변경·취소·철회 RPC

**Files:**
- Create: `supabase/migrations/20260809101000_registration_observation_booking_mutations.sql`
- Create: `tests/registration-observation-booking.test.mjs`
- Modify: `supabase/tests/registration_observation_workflow_test.sql`
- Modify: `tests/registration-observation-schema.test.mjs`

**Interfaces:**
- Consumes: track workflow revision, class/session authority, normalized session ID 또는 legacy session key, appointment notification revision, observation revision, request key
- Produces: `public.enter_registration_observation_v1`, `public.list_registration_observation_sessions_v1`, `public.save_registration_observation_booking_v1`, `public.cancel_registration_observation_v1`, `public.withdraw_registration_observation_v1`
- Produces: private helpers `dashboard_private.resolve_registration_observation_session_v1`, `dashboard_private.registration_observation_booking_fact_hash_v1`, `dashboard_private.assert_registration_observation_manager_access_v1`

- [ ] **Step 1: canonical resolver RED 테스트 작성**

  `tests/registration-observation-booking.test.mjs`는 SQL 계약에서 browser-provided subject/teacher/campus를 함수 인자로 받지 않고 class·session 관계로 resolve하는지 확인한다.

  ```js
  test("booking mutations resolve canonical session facts and reject stale screens", async () => {
    const sql = normalizeSql(await readFile(bookingMigrationUrl, "utf8"))
    assert.match(sql, /create function dashboard_private\.resolve_registration_observation_session_v1/)
    assert.match(sql, /notification_profile_is_active_v1/)
    assert.match(sql, /registration_observation_booking_fact_hash_v1/)
    assert.match(sql, /p_expected_workflow_revision bigint/)
    assert.match(sql, /p_expected_notification_revision bigint/)
    assert.match(sql, /p_expected_observation_revision bigint/)
    assert.doesNotMatch(sql, /p_subject text|p_teacher_name text|p_campus text/)
  })
  ```

  pgTAP에는 normalized session 성공, legacy session 성공, subject mismatch, 비활성·중복 teacher profile, campus 누락, ambiguous legacy time, stale session revision/hash, 같은 request key replay를 각각 독립 transaction으로 작성한다.

- [ ] **Step 2: Task 2 RED 확인**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-booking.test.mjs tests/registration-observation-schema.test.mjs
  ```
  Expected: booking migration과 함수가 없어 FAIL.

- [ ] **Step 3: bounded session 목록과 canonical resolver 구현**

  `list_registration_observation_sessions_v1(p_track_id, p_class_id, p_date_from, p_date_to)`는 actor access, same-task, same-subject를 먼저 검사한다. normalized는 `class_lesson_sessions`의 `active | makeup`만 날짜 index로 읽고, legacy는 선택한 class 한 행의 `schedule_plan`만 파싱한다. 기간은 오늘부터 최대 120일로 제한하고 반환 필드는 다음으로 고정한다.

  ```ts
  type RegistrationObservationSessionOption = {
    authority: "normalized" | "legacy"
    classId: string
    classLessonSessionId: string | null
    legacySessionKey: string | null
    sessionDate: string
    startsAt: string
    endsAt: string
    teacherName: string
    classroomName: string
    campus: "본관" | "별관"
    sourceRevision: number | null
    sourceHash: string | null
  }
  ```

  resolver는 class subject, session status, teacher catalog/profile, classroom catalog/campus, canonical KST start/end를 확정하고 stable JSON canonicalization 후 SHA-256 `booking_fact_hash`를 만든다. legacy time 후보가 0개 또는 2개 이상이면 `registration_observation_schedule_requires_fix`로 종료한다.

- [ ] **Step 4: 진입·신규 예약·변경·취소 구현**

  `enter_registration_observation_v1`은 track row lock, allowed source, expected workflow revision을 검사하고 return status를 보존한 뒤 상태만 `observation_requested`로 바꾼다.

  `save_registration_observation_booking_v1`은 `p_observation_id is null`일 때 신규 attempt, non-null일 때 reschedule로 분기한다.

  - 신규: track revision + no-open-attempt를 확인하고 새 appointment와 observation을 한 transaction에서 만든다.
  - 변경: 기존 appointment/observation을 row lock하고 expected notification/domain revision을 모두 확인한 뒤 snapshot과 hash를 갱신한다.
  - 일정 핵심 사실이 달라질 때만 appointment notification revision을 증가시킨다.
  - normalized source revision 또는 legacy content hash는 항상 현재 값으로 저장한다.
  - event audit에는 이전/이후 canonical facts를 저장하되 외부 provider 호출은 하지 않는다.

  `cancel_registration_observation_v1`은 두 revision을 확인하고 appointment/observation을 terminal로 닫으며 notification revision을 한 번 올린다. track은 `observation_requested`에 남긴다.

- [ ] **Step 5: 철회·진로변경 구현**

  `withdraw_registration_observation_v1`은 `p_exit_kind`에 따라 다음을 정확히 수행한다.

  - `return_to_previous`: track revision만 요구하고 보존 상태로 복귀한다.
  - observation 행이 없는 `director_decision`: track revision만 요구하고 enrollment/waiting/not_registered로 이동한다.
  - 최신 `re_observation` 결정 correction: 지정 observation의 revision·feedback revision도 확인하고 뒤에 decision 없는 canceled 이력만 허용한다.
  - 모든 성공 경로에서 `observation_return_workflow_status = null`로 지운다.
  - enrollment/admission/payment table에는 SQL write를 수행하지 않는다.

- [ ] **Step 6: 범용 workflow RPC 우회 차단**

  migration에서 `dashboard_private.set_registration_workflow_status_v1_impl`과 public wrapper를 `create or replace`해 observation source/target 및 열린 attempt 이탈을 `registration_observation_transition_requires_action`으로 차단한다. observation이 없는 `consultation_completed → enrollment_requested`는 기존 테스트와 함께 유지한다.

- [ ] **Step 7: Task 2 GREEN 및 커밋**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-booking.test.mjs tests/registration-observation-schema.test.mjs tests/registration-workflow-status.test.mjs tests/registration-track-service.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint tests/registration-observation-booking.test.mjs tests/registration-observation-schema.test.mjs
  git diff --check
  ```

  Commit:
  ```bash
  git add supabase/migrations/20260809101000_registration_observation_booking_mutations.sql supabase/tests/registration_observation_workflow_test.sql tests/registration-observation-booking.test.mjs tests/registration-observation-schema.test.mjs
  git commit -m "feat: add observation booking mutations"
  ```

---

### Task 3: 참석·피드백·원장 결정 RPC와 행 단위 권한

**Files:**
- Create: `supabase/migrations/20260809102000_registration_observation_feedback_decisions.sql`
- Create: `tests/registration-observation-feedback.test.mjs`
- Modify: `supabase/tests/registration_observation_workflow_test.sql`
- Modify: `tests/registration-observation-schema.test.mjs`

**Interfaces:**
- Consumes: observation ID, attendance, suitability, reason, correction reason, expected domain/feedback/appointment/track revisions, actor identity
- Produces: `public.get_registration_observation_feedback_v1`, `public.record_registration_observation_attendance_v1`, `public.submit_registration_observation_feedback_v1`, `public.correct_registration_observation_feedback_v1`, `public.decide_registration_observation_v1`
- Produces: private access helpers for assigned teacher, admin/staff, track director and minimal feedback JSON projection

- [ ] **Step 1: lifecycle와 권한 RED 테스트 작성**

  Node SQL contract test는 함수 signature, fixed search path, revoke/grant, server-time boundary, audit event를 요구한다. pgTAP은 다음 actor matrix를 fixture로 만든다.

  | 동작 | assigned teacher | admin/staff | track director | unrelated teacher |
  |---|---:|---:|---:|---:|
  | observation 최소 조회 | 허용 | 허용 | 허용 | not found |
  | 참석+평가·노쇼 | 허용 | 허용 | 거부 | not found |
  | 참석만 | 거부 | 허용 | 거부 | not found |
  | 결정 전 correction | 허용 | 허용 | 거부 | not found |
  | 결정 후 사유만 correction | 거부 | 허용 | 거부 | not found |
  | 최종 결정 | 거부 | 허용 | 허용 | not found |
  | 예약 취소 | 거부 | 허용 | 허용 | not found |

- [ ] **Step 2: Task 3 RED 확인**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-feedback.test.mjs tests/registration-observation-schema.test.mjs
  ```
  Expected: feedback/decision migration과 RPC가 없어 FAIL.

- [ ] **Step 3: 최소 projection read RPC와 RLS 구현**

  `get_registration_observation_feedback_v1`은 student name/grade, subject/class, startsAt/endsAt, classroom, assigned teacher, attendance/status, current feedback, revisions만 반환한다. 전화번호, 학교, inquiry, sibling track, 다른 observation은 SELECT projection에 포함하지 않는다. actor가 관계없으면 `registration_observation_not_found`를 반환해 존재 여부를 숨긴다.

  SECURITY DEFINER 함수는 모두 `set search_path = ''`, 내부 `auth.uid()`와 active-profile 검사, explicit schema qualification, authenticated 최소 EXECUTE를 사용한다.

- [ ] **Step 4: 참석·최초 피드백·노쇼 구현**

  `record_registration_observation_attendance_v1`은 admin/staff의 참석만 입력을 소유한다. canonical 시작 전에는 거부하고 appointment `completed`, observation `attended_feedback_pending`, track `observation_feedback_pending`을 함께 저장한다.

  `submit_registration_observation_feedback_v1`은 다음 두 입력만 허용한다.

  ```ts
  type RegistrationObservationFeedbackSubmission =
    | { attendance: "attended"; suitability: "fit" | "unfit"; reason: string }
    | { attendance: "no_show"; suitability: null; reason: null }
  ```

  scheduled+attended는 시작·종료 경계를 모두 확인한 뒤 attendance와 feedback을 원자 저장한다. attended_feedback_pending은 종료 경계와 feedback revisions를 확인한다. no-show는 시작 이후에만 허용하고 suitability를 null로 강제한다. 완료 시 track은 `observation_completed`다.

- [ ] **Step 5: correction과 원장 결정 구현**

  correction은 결정 전에는 결과+사유 변경, 결정 후에는 admin/staff의 동일 결과 사유 변경만 허용한다. 모든 correction은 필수 수정 사유와 before/after actor/time audit를 남기고 `feedback_revision`만 증가시킨다.

  `decide_registration_observation_v1`은 completed 또는 no_show에서 enrollment, 세 waiting, not_registered, re_observation을 명시 매핑한다. observation과 track revision을 함께 검사하고 `decision_kind`를 최초 한 번만 기록한다. re_observation만 return status를 보존하고 나머지는 null로 지운다. 어떤 decision도 enrollment/admission/payment row를 만들지 않는다.

- [ ] **Step 6: due 작업 취소 규칙을 transaction에 연결**

  - 참석만: customer reminder와 3시간 전 internal 준비 job만 cancel하고 feedback due는 유지한다.
  - 참석+평가 또는 no-show: 모든 pending due job을 cancel한다.
  - cancel: 모든 pending due job을 cancel한다.
  - feedback correction·director decision: appointment notification revision이나 고객 message 권한을 바꾸지 않는다.

- [ ] **Step 7: pgTAP lifecycle·finance·concurrency GREEN**

  동일 request key replay, stale domain/feedback/appointment revision, 수업 시작 전 attendance, 종료 전 suitability, decision 이후 teacher correction, re-observation 뒤 새 attempt, 미등록 전후 enrollment/admission/payment 행 수 불변을 검증한다.

- [ ] **Step 8: Task 3 검증 및 커밋**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-feedback.test.mjs tests/registration-observation-booking.test.mjs tests/registration-observation-schema.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint tests/registration-observation-feedback.test.mjs
  git diff --check
  ```

  Commit:
  ```bash
  git add supabase/migrations/20260809102000_registration_observation_feedback_decisions.sql supabase/tests/registration_observation_workflow_test.sql tests/registration-observation-feedback.test.mjs tests/registration-observation-schema.test.mjs
  git commit -m "feat: add observation feedback decisions"
  ```

---

### Task 4: bounded observation client model, service, runtime probe

**Files:**
- Create: `src/features/tasks/registration-observation-model.ts`
- Create: `src/features/tasks/registration-observation-service.ts`
- Create: `src/features/tasks/registration-observation-runtime-probe.ts`
- Create: `tests/registration-observation-service.test.mjs`
- Create: `tests/registration-observation-runtime-probe.test.mjs`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/registration-track-fixtures.ts`
- Modify: `src/features/tasks/registration-track-fixture-runtime.ts`
- Modify: `tests/registration-track-fixtures.test.mjs`
- Modify: `tests/registration-track-service.test.mjs`

**Interfaces:**
- Consumes: Task 1–3 RPC JSON, Supabase client, 12-second deadline, current authenticated profile
- Produces: `RegistrationObservationDetail`, `RegistrationObservationSessionOption`, `RegistrationObservationFeedbackDetail`, `RegistrationObservationRuntimeState`
- Produces: `probeRegistrationObservationRuntime`, `loadRegistrationObservationDetail`, `loadRegistrationObservationSessions`, `enterRegistrationObservation`, `saveRegistrationObservationBooking`, `cancelRegistrationObservation`, `withdrawRegistrationObservation`, `submitRegistrationObservationFeedback`, `correctRegistrationObservationFeedback`, `decideRegistrationObservation`

- [ ] **Step 1: strict normalizer와 deadline RED 테스트 작성**

  테스트는 malformed UUID/status/campus/revision/date를 fail closed하고, stalled PostgREST request가 test timeout 5ms 후 종료되며 `.retry(false)`와 abort signal을 받는지 확인한다.

  ```js
  test("observation reads abort, disable PostgREST retry, and release in-flight state", async () => {
    const client = createStalledObservationClient()
    await assert.rejects(
      loadRegistrationObservationDetail(client, "obs-1", { timeoutMs: 5 }),
      /registration_observation_request_timeout/,
    )
    assert.equal(client.retryArguments.at(-1), false)
    assert.equal(client.abortCount, 1)
  })
  ```

- [ ] **Step 2: Task 4 RED 확인**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-service.test.mjs tests/registration-observation-runtime-probe.test.mjs tests/registration-track-service.test.mjs tests/registration-track-fixtures.test.mjs
  ```
  Expected: 새 model/service/probe modules가 없어 FAIL.

- [ ] **Step 3: model과 error normalization 구현**

  `registration-observation-model.ts`는 raw JSON을 exact-key로 정규화하고 다음 사용자 오류를 한곳에서 매핑한다.

  ```ts
  export const REGISTRATION_OBSERVATION_RETRYABLE_ERROR =
    "서버 응답이 지연되었습니다. 잠시 후 다시 시도해 주세요."
  export const REGISTRATION_OBSERVATION_STALE_ERROR =
    "청강 정보가 변경되었습니다. 다시 확인해 주세요."
  ```

  AbortError, timeout, Failed to fetch, SQLSTATE 57014만 retryable 문구로 바꾸고 domain error code는 안정된 한국어 문구로 매핑한다. SQL/HTML/provider 원문은 UI에 반환하지 않는다.

- [ ] **Step 4: service와 generation-aware cache 구현**

  모든 read는 `AbortSignal.timeout(12_000)`과 `.retry(false)`를 적용한다. 선택한 class session 목록만 `(trackId,classId,dateRange)` key로 in-flight dedupe하고 성공·실패를 refresh 전까지 settled 처리한다. refresh는 generation을 올려 이전 success/failure consumer가 현재 UI에 적용되지 않게 한다.

  mutation은 Supabase 자동 재시도를 사용하지 않고 호출자가 만든 request key와 현재 revision을 그대로 RPC에 전달한다. 성공 응답 normalizer가 revision과 canonical snapshot을 반환해야만 UI state를 갱신한다.

- [ ] **Step 5: case detail 최소 projection 통합**

  `loadRegistrationCaseDetail`에는 선택 task의 observation summary와 최근 attempt scalar만 추가하고 feedback reason, 교재 snapshot, schedule_plan은 포함하지 않는다. observation detail은 별도 RPC에서만 불러온다. fixture runtime도 동일 shape와 request-key replay를 구현한다.

- [ ] **Step 6: Task 4 GREEN 및 커밋**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-service.test.mjs tests/registration-observation-runtime-probe.test.mjs tests/registration-track-service.test.mjs tests/registration-track-fixtures.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/tasks/registration-observation-model.ts src/features/tasks/registration-observation-service.ts src/features/tasks/registration-observation-runtime-probe.ts src/features/tasks/registration-track-service.ts src/features/tasks/registration-track-fixtures.ts tests/registration-observation-service.test.mjs tests/registration-observation-runtime-probe.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
  git diff --check
  ```

  Commit:
  ```bash
  git add src/features/tasks/registration-observation-model.ts src/features/tasks/registration-observation-service.ts src/features/tasks/registration-observation-runtime-probe.ts src/features/tasks/registration-track-service.ts src/features/tasks/registration-track-fixtures.ts src/features/tasks/registration-track-fixture-runtime.ts tests/registration-observation-service.test.mjs tests/registration-observation-runtime-probe.test.mjs tests/registration-track-fixtures.test.mjs tests/registration-track-service.test.mjs
  git commit -m "feat: add observation client service"
  ```

---

### Task 5: 등록 목록과 상세의 청강 예약 운영 UI

**Files:**
- Create: `src/features/tasks/registration-observation-editor.tsx`
- Create: `tests/registration-observation-workspace.test.mjs`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/registration-application-model.ts`
- Modify: `src/features/tasks/registration-application-subject-tabs.tsx`
- Modify: `src/features/tasks/registration-application-progress-stepper.tsx`
- Modify: `src/features/tasks/registration-application-track-actions.tsx`
- Modify: `src/features/tasks/registration-case-list.tsx`
- Modify: `src/features/tasks/registration-case-list-model.ts`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/registration-application-model.test.mjs`
- Modify: `tests/registration-case-list-model.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`

**Interfaces:**
- Consumes: Task 4 service, active track, viewer permissions, selected class/session, current revisions
- Produces: `RegistrationObservationEditor`; list view `observation`; actions `청강 진행`, `예약 저장`, `일정 변경`, `예약 취소`, `청강 진행 철회`, `등록 신청`, `대기`, `미등록`, `재청강`

- [ ] **Step 1: UI state machine RED 테스트 작성**

  source contract와 executable model 테스트는 다음을 요구한다.

  - `청강 신청` tab이 `대기 신청`과 `등록 신청` 사이에 있다.
  - 상담 완료·대기에서는 `청강 진행`과 기존 직접 등록을 모두 제공한다.
  - 반을 선택하기 전 session query를 하지 않는다.
  - session load pending/error 동안 예약 저장을 막고 `다시 불러오기`를 제공한다.
  - campus/teacher/session mismatch는 필드 바로 아래에 한 문장으로 표시한다.
  - 예약 저장 상태와 고객 알림 상태를 합치지 않는다.
  - 모바일에서 핵심 동작 순서는 `반 → 회차 → 예약 저장 → 예약 안내 알림톡`이다.

- [ ] **Step 2: Task 5 RED 확인**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-workspace.test.mjs tests/registration-track-workspace.test.mjs tests/registration-application-model.test.mjs tests/registration-case-list-model.test.mjs tests/ops-task-workspace.test.mjs
  ```
  Expected: editor와 observation view/action 계약이 없어 FAIL.

- [ ] **Step 3: 목록·상태 동선 구현**

  `registration-case-list-model`은 세 observation workflow status를 한 view로 분류하고, row summary는 `예약 필요 | 청강 예약 | 교사 피드백 대기 | 청강 완료`와 가장 가까운 청강 일시만 표시한다. canceled/no-show 이력은 count를 부풀리지 않고 상세에서 본다.

  상태 select로 observation lifecycle을 직접 변경하지 않는다. observation 상태 항목을 선택하면 전용 action UI를 열고 범용 `setRegistrationWorkflowStatus` 호출을 만들지 않는다.

- [ ] **Step 4: 예약 editor 구현**

  editor는 선택한 과목 track에 한정해 반과 회차를 로드한다. 회차 선택 후 canonical teacher, classroom, campus, textbook, progress를 읽기 전용으로 표시한다. campus와 teacher 필수 연결이 없으면 해당 수업일정 수정 경로를 안내하고 저장을 막는다.

  저장 확인은 바로 위 입력을 재요약하지 않고 `청강 예약을 저장할까요?`만 묻는다. 확인 전에는 `saving`을 켜지 않고, 최종 확인 뒤 mutation 구간만 try/finally로 잠근다.

  성공 후 상태 라벨은 다음처럼 분리한다.

  ```text
  예약 저장됨 · 예약 안내 미발송
  예약 저장됨 · 과목방 알림 대기
  수업일정 변경됨 · 청강 예약 재확인 필요
  ```

- [ ] **Step 5: 참석·결정 action surface 연결**

  admin/staff의 참석만 기록, admin/staff 대리 피드백, director의 등록/대기/미등록/재청강 결정을 editor에 연결한다. 미등록 확인 문구에는 수납·환불 필드를 만들지 않는다. 재청강은 새 빈 attempt를 만들지 않고 `예약 필요`로만 이동한다.

- [ ] **Step 6: 접근성·모바일 회귀 구현**

  nested dialog z-index, focus return, ESC/닫기, 200%–400% zoom, 320px viewport에서 horizontal overflow가 없도록 기존 Dialog/AlertDialog primitives를 사용한다. async failure는 입력을 유지하고 버튼을 다시 활성화한다.

- [ ] **Step 7: Task 5 GREEN 및 커밋**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-workspace.test.mjs tests/registration-track-workspace.test.mjs tests/registration-application-model.test.mjs tests/registration-case-list-model.test.mjs tests/ops-task-workspace.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/tasks/registration-observation-editor.tsx src/features/tasks/registration-track-editor.tsx src/features/tasks/registration-application-model.ts src/features/tasks/registration-application-subject-tabs.tsx src/features/tasks/registration-application-progress-stepper.tsx src/features/tasks/registration-application-track-actions.tsx src/features/tasks/registration-case-list.tsx src/features/tasks/registration-case-list-model.ts src/features/tasks/ops-task-workspace.tsx tests/registration-observation-workspace.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
  git diff --check
  ```

  Commit:
  ```bash
  git add src/features/tasks/registration-observation-editor.tsx src/features/tasks/registration-track-editor.tsx src/features/tasks/registration-application-model.ts src/features/tasks/registration-application-subject-tabs.tsx src/features/tasks/registration-application-progress-stepper.tsx src/features/tasks/registration-application-track-actions.tsx src/features/tasks/registration-case-list.tsx src/features/tasks/registration-case-list-model.ts src/features/tasks/ops-task-workspace.tsx tests/registration-observation-workspace.test.mjs tests/registration-track-workspace.test.mjs tests/registration-application-model.test.mjs tests/registration-case-list-model.test.mjs tests/ops-task-workspace.test.mjs
  git commit -m "feat: add observation registration workspace"
  ```

---

### Task 6: 담당 교사 전용 피드백 route와 원장 inbox

**Files:**
- Create: `src/app/admin/registration/observations/[observationId]/feedback/page.tsx`
- Create: `src/features/tasks/registration-observation-feedback-workspace.tsx`
- Create: `tests/registration-observation-feedback-route.test.mjs`
- Modify: `src/features/notifications/server/providers/google-chat-provider.ts`
- Modify: `tests/notification-google-chat-content.test.mjs`
- Modify: `tests/registration-observation-feedback.test.mjs`

**Interfaces:**
- Consumes: URL path observation UUID, `get_registration_observation_feedback_v1`, feedback submission/correction mutations, authenticated profile
- Produces: `/admin/registration/observations/{observationId}/feedback`; strict Google Chat app-link validator for that path; teacher feedback form and director read-only result view

- [ ] **Step 1: route privacy와 link allowlist RED 테스트 작성**

  테스트는 exact UUID path만 허용하고 query/hash/arbitrary host/path를 거부한다.

  ```js
  assert.equal(
    isAllowedGoogleChatAppPath("/admin/registration/observations/11111111-1111-4111-8111-111111111111/feedback"),
    true,
  )
  assert.equal(
    isAllowedGoogleChatAppPath("/admin/registration/observations/not-a-uuid/feedback"),
    false,
  )
  ```

  feedback route source test는 보호자 전화, 학교, inquiry, sibling tracks를 request/props에 포함하지 않음을 검증한다.

- [ ] **Step 2: Task 6 RED 확인**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-feedback-route.test.mjs tests/notification-google-chat-content.test.mjs tests/registration-observation-feedback.test.mjs
  ```
  Expected: route/workspace와 dynamic allowlist가 없어 FAIL.

- [ ] **Step 3: 전용 feedback page와 최소 UI 구현**

  page는 Admin AuthGuard 아래에서 observation ID를 UUID로 검증하고 전용 service만 호출한다. unrelated teacher not-found와 일시적 timeout을 구분하되 row 존재 여부를 노출하지 않는다.

  assigned teacher UI는 `참석 + 적합/부적합 + 필수 사유` 또는 `노쇼`를 한 번 제출한다. admin/staff는 참석만 기록과 대리 입력이 가능하고 대리 표지를 보여준다. 수업 종료 전 평가 버튼은 disabled이며 서버 검증을 대체하지 않는다.

- [ ] **Step 4: correction·director 결과 읽기 연결**

  결정 전 correction은 expected feedback revision과 수정 사유를 요구한다. 원장 결정 뒤 teacher는 읽기 전용이고 admin/staff는 결과를 유지한 사유 문구만 수정할 수 있다. director에게는 결과, 사유, 제출자, 제출시각, 대리 입력 여부를 표시하되 Google Chat에는 이 값들을 보내지 않는다.

- [ ] **Step 5: Google Chat dynamic path validation 구현**

  기존 static allowlist를 유지하고 다음 regex를 별도 branch로 추가한다.

  ```ts
  const REGISTRATION_OBSERVATION_FEEDBACK_PATH =
    /^\/admin\/registration\/observations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/feedback$/iu
  ```

  URL은 application origin만 허용하고 feedback path에는 query와 hash를 허용하지 않는다.

- [ ] **Step 6: Task 6 GREEN 및 커밋**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-feedback-route.test.mjs tests/notification-google-chat-content.test.mjs tests/registration-observation-feedback.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint 'src/app/admin/registration/observations/[observationId]/feedback/page.tsx' src/features/tasks/registration-observation-feedback-workspace.tsx src/features/notifications/server/providers/google-chat-provider.ts tests/registration-observation-feedback-route.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
  git diff --check
  ```

  Commit:
  ```bash
  git add 'src/app/admin/registration/observations/[observationId]/feedback/page.tsx' src/features/tasks/registration-observation-feedback-workspace.tsx src/features/notifications/server/providers/google-chat-provider.ts tests/registration-observation-feedback-route.test.mjs tests/notification-google-chat-content.test.mjs tests/registration-observation-feedback.test.mjs
  git commit -m "feat: add observation teacher feedback route"
  ```

---

### Task 7: 등록 달력과 청강일 첫 수업일 기본값

**Files:**
- Create: `supabase/migrations/20260809102500_registration_observation_calendar_enrollment.sql`
- Create: `tests/registration-observation-calendar-enrollment.test.mjs`
- Modify: `src/features/tasks/registration-appointment-calendar-model.ts`
- Modify: `src/features/tasks/registration-appointment-calendar.tsx`
- Modify: `src/features/tasks/registration-enrollment-editor.tsx`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `tests/registration-appointment-calendar.test.mjs`
- Modify: `tests/registration-continuous-class-schedule.test.mjs`
- Modify: `tests/registration-track-service.test.mjs`
- Modify: `supabase/tests/registration_observation_workflow_test.sql`

**Interfaces:**
- Consumes: observation appointment summary, selected final class, completed fit observation with enrollment decision, existing future class session options
- Produces: calendar kind/filter `observation_class | 청강`; deep link with `taskId`, `trackId`, `observationId`, `appointmentId`; `RegistrationObservationStartCandidate`; validated `class_start_source_observation_id`

- [ ] **Step 1: calendar와 enrollment RED 테스트 작성**

  달력 테스트는 appointment 한 건이 participant join 수와 무관하게 한 번만 나타나고 `청강` filter count가 정확한지 검증한다. enrollment 테스트는 등록 결정일 이전의 completed+fit+same-class observation 한 건만 특별 후보로 주입하고, 다른 class/unfit/no-show/canceled는 제외한다.

  ```js
  assert.deepEqual(candidate, {
    kind: "observation",
    observationId: "obs-fit",
    classId: "class-a",
    date: "2026-08-17",
    label: "청강 회차 · 8월 17일 월요일 오후 6:00–8:00",
  })
  ```

- [ ] **Step 2: Task 7 RED 확인**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-calendar-enrollment.test.mjs tests/registration-appointment-calendar.test.mjs tests/registration-continuous-class-schedule.test.mjs tests/registration-track-service.test.mjs
  ```
  Expected: observation calendar kind와 special enrollment candidate가 없어 FAIL.

- [ ] **Step 3: bounded calendar projection과 UI 구현**

  migration은 기존 calendar RPC/view를 `create or replace`해 observation scalar fields만 추가한다. feedback reason, textbook list, progress, schedule_plan은 포함하지 않는다. client mapper와 filter UI는 `observation_class`를 `청강`으로 표시하고 상태별 색상보다 텍스트 상태를 우선한다.

- [ ] **Step 4: 특별 첫 수업일 candidate resolver 구현**

  server helper는 `completed + fit + decision_kind = enrollment + same task/track/class`를 검사한 정확한 session snapshot 한 건만 반환한다. enrollment editor는 일반 `registrationDecisionDate` 이후 후보와 별도로 이 한 건을 prepend하고 기본 선택한다.

  화면 문구는 다음으로 고정한다.

  ```text
  최근 적합 청강
  8월 17일 · 중2 영어 A반 · 참석 · 적합
  첫 수업일 기본값에 반영했습니다.
  ```

  사용자가 다른 정상 회차를 선택하면 `class_start_source_observation_id = null`을 저장한다.

- [ ] **Step 5: enrollment save server validation 구현**

  기존 enrollment save RPC를 follow-up `create or replace`해 observation source가 있으면 exact task/track/class/session/date 조건을 다시 검증한다. source가 null이면 기존 미래 회차 규칙을 그대로 적용한다. 부적합·노쇼·취소·다른 반·stale revision은 fail closed한다.

- [ ] **Step 6: Task 7 GREEN 및 커밋**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-calendar-enrollment.test.mjs tests/registration-appointment-calendar.test.mjs tests/registration-continuous-class-schedule.test.mjs tests/registration-track-service.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/tasks/registration-appointment-calendar-model.ts src/features/tasks/registration-appointment-calendar.tsx src/features/tasks/registration-enrollment-editor.tsx src/features/tasks/registration-track-service.ts tests/registration-observation-calendar-enrollment.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
  git diff --check
  ```

  Commit:
  ```bash
  git add supabase/migrations/20260809102500_registration_observation_calendar_enrollment.sql supabase/tests/registration_observation_workflow_test.sql src/features/tasks/registration-appointment-calendar-model.ts src/features/tasks/registration-appointment-calendar.tsx src/features/tasks/registration-enrollment-editor.tsx src/features/tasks/registration-track-service.ts tests/registration-observation-calendar-enrollment.test.mjs tests/registration-appointment-calendar.test.mjs tests/registration-continuous-class-schedule.test.mjs tests/registration-track-service.test.mjs
  git commit -m "feat: connect observation calendar enrollment"
  ```

---

### Task 8: Google Chat 예약·3시간 전·피드백 due·제출 알림

**Files:**
- Create: `supabase/migrations/20260809103000_registration_observation_google_chat.sql`
- Create: `tests/notification-registration-observation.test.mjs`
- Modify: `src/features/notifications/notification-control-plane-types.ts`
- Modify: `src/features/notifications/server/adapters/registration-notification-adapter.ts`
- Modify: `src/features/notifications/server/presentation/registration-notification-presentation.ts`
- Modify: `src/features/notifications/server/notification-workflow-registry.ts`
- Modify: `src/features/notifications/notification-google-chat-catalog.ts`
- Modify: `src/features/notifications/notification-content-contract-registry.ts`
- Modify: `src/features/notifications/notification-content-manifest.ts`
- Modify: `tests/notification-registration-handoffs.test.mjs`
- Modify: `tests/notification-registration-presentation.test.mjs`
- Modify: `tests/registration-notification-adapter.test.mjs`
- Modify: `tests/notification-workflow-registry.test.mjs`
- Modify: `tests/fixtures/notification-content-contracts.json`
- Modify: `tests/fixtures/notification-content-coverage-manifest.json`
- Modify: `tests/fixtures/notification-content-golden.json`
- Modify: `supabase/tests/notification_registration_handoffs_test.sql`
- Modify: `supabase/tests/notification_content_contract_test.sql`

**Interfaces:**
- Consumes: canonical observation audit/due rows, exact track subject, current session facts, same-session textbook/progress resolver
- Produces: event keys `registration.observation_scheduled`, `registration.observation_rescheduled`, `registration.observation_canceled`, `registration.observation_reminder_due`, `registration.observation_feedback_due`, `registration.observation_feedback_submitted`
- Produces: subject-team Google Chat cards, executive-team feedback-submitted card, director Dashboard inbox item

- [ ] **Step 1: event contract와 개인정보 RED 테스트 작성**

  신규 test는 여섯 event key의 destination, required facts, buttons, dedupe key, privacy를 검증한다.

  ```js
  for (const forbidden of ["phone", "전화", "fit", "unfit", "적합", "부적합", "feedback_reason"]) {
    assert.doesNotMatch(renderedGoogleChatText, new RegExp(forbidden, "iu"))
  }
  assert.match(renderedGoogleChatText, /교재 복사 등 청강 준비가 필요합니다/)
  assert.equal(card.buttons[0].text, "청강 상세 보기")
  ```

  feedback submitted executive card는 학생·과목·수업·제출자·제출시각만 허용하고 결과/사유는 거부한다.

- [ ] **Step 2: Task 8 RED 확인**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/notification-registration-observation.test.mjs tests/notification-registration-handoffs.test.mjs tests/notification-registration-presentation.test.mjs tests/registration-notification-adapter.test.mjs tests/notification-workflow-registry.test.mjs
  ```
  Expected: 신규 event registry, adapter, presentation, fixtures가 없어 FAIL.

- [ ] **Step 3: due producer와 claim 계약 구현**

  migration은 예약 저장 때 다음 due를 생성한다.

  - 시작까지 정확히 3시간 이상: `observation_reminder_due`를 startsAt-3h에 생성
  - 항상: `observation_feedback_due`를 endsAt+30m에 생성
  - lead time 미만이면 과거 due 또는 즉시 대체 작업을 생성하지 않음

  identity는 `observation_id + appointment_notification_revision + event_kind` unique다. worker는 bounded batch와 `FOR UPDATE SKIP LOCKED`를 사용하고 claim 및 dispatch 직전 source revision/hash와 booking fact hash를 재검증한다.

- [ ] **Step 4: lifecycle immediate event와 subject routing 구현**

  예약/변경/취소 mutation의 audit fact로 세 immediate event를 정확히 한 번 만든다. subject routing은 track canonical subject에서 `english | math | science` connection을 선택한다. browser payload destination은 무시한다.

  reminder due는 dispatch 시 같은 회차의 현재 교재·진도를 resolve한다. booking fact가 같고 교재·진도만 달라졌으면 최신 내부 내용을 발송한다. 핵심 hash가 다르면 `source_dirty`, provider 호출 0회다.

- [ ] **Step 5: feedback due와 submitted notification 구현**

  feedback due는 `scheduled | attended_feedback_pending`이고 피드백 미제출일 때 한 번만 보낸다. completed/no_show/canceled에는 provider 호출 0회다. 버튼은 teacher feedback route로 연결한다.

  feedback submitted는 director inbox와 executive_team에 한 번 만든다. 단체방 text는 결과와 사유를 포함하지 않는다.

- [ ] **Step 6: content registry와 default-OFF rules 구현**

  content contract, manifest, golden fixtures, DB system template을 여섯 event에 맞춰 갱신한다. 신규 Google Chat rules는 모두 disabled로 seed하고 기존 rules의 enabled 상태를 바꾸지 않는다.

- [ ] **Step 7: Task 8 GREEN 및 커밋**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/notification-registration-observation.test.mjs tests/notification-registration-handoffs.test.mjs tests/notification-registration-presentation.test.mjs tests/registration-notification-adapter.test.mjs tests/notification-workflow-registry.test.mjs tests/notification-content-contract.test.mjs tests/notification-content-manifest.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/notifications/notification-control-plane-types.ts src/features/notifications/server/adapters/registration-notification-adapter.ts src/features/notifications/server/presentation/registration-notification-presentation.ts src/features/notifications/server/notification-workflow-registry.ts src/features/notifications/notification-google-chat-catalog.ts src/features/notifications/notification-content-contract-registry.ts src/features/notifications/notification-content-manifest.ts tests/notification-registration-observation.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
  git diff --check
  ```

  Commit:
  ```bash
  git add supabase/migrations/20260809103000_registration_observation_google_chat.sql supabase/tests/notification_registration_handoffs_test.sql supabase/tests/notification_content_contract_test.sql src/features/notifications/notification-control-plane-types.ts src/features/notifications/server/adapters/registration-notification-adapter.ts src/features/notifications/server/presentation/registration-notification-presentation.ts src/features/notifications/server/notification-workflow-registry.ts src/features/notifications/notification-google-chat-catalog.ts src/features/notifications/notification-content-contract-registry.ts src/features/notifications/notification-content-manifest.ts tests/notification-registration-observation.test.mjs tests/notification-registration-handoffs.test.mjs tests/notification-registration-presentation.test.mjs tests/registration-notification-adapter.test.mjs tests/notification-workflow-registry.test.mjs tests/fixtures/notification-content-contracts.json tests/fixtures/notification-content-coverage-manifest.json tests/fixtures/notification-content-golden.json
  git commit -m "feat: add observation team notifications"
  ```

---

### Task 9: SOLAPI 청강 예약 안내와 3시간 전 고객 리마인드

**Files:**
- Create: `supabase/migrations/20260809104000_registration_observation_customer_messages.sql`
- Create: `tests/registration-observation-customer-messages.test.mjs`
- Modify: `src/features/tasks/registration-customer-message-contract.ts`
- Modify: `src/features/tasks/registration-customer-message-service.ts`
- Modify: `src/features/tasks/registration-alimtalk-preview-dialog.tsx`
- Modify: `src/features/tasks/registration-observation-editor.tsx`
- Modify: `src/features/tasks/server/registration-customer-message-source.ts`
- Modify: `src/features/tasks/server/registration-customer-message-catalog.ts`
- Modify: `src/features/tasks/server/registration-customer-message-route.ts`
- Modify: `src/features/tasks/server/registration-customer-reminder-route.ts`
- Modify: `src/features/tasks/server/registration-customer-reminder-worker.ts`
- Modify: `src/features/notifications/registration-customer-reminder-service.ts`
- Modify: `src/features/notifications/registration-customer-reminder-settings.tsx`
- Modify: `tests/registration-customer-message-contract.test.mjs`
- Modify: `tests/registration-customer-message-catalog.test.mjs`
- Modify: `tests/registration-customer-message-source.test.mjs`
- Modify: `tests/registration-customer-message-route.test.mjs`
- Modify: `tests/registration-customer-reminder-route.test.mjs`
- Modify: `tests/registration-customer-reminder-scheduler.test.mjs`
- Modify: `tests/registration-customer-reminder-worker.test.mjs`
- Modify: `tests/registration-alimtalk-preview-dialog.test.mjs`
- Modify: `supabase/tests/registration_customer_solapi_messages_test.sql`

**Interfaces:**
- Consumes: canonical observation source, appointment notification revision, customer reminder lead-hours/ON-OFF, provider template receipts
- Produces: message kinds `observation_booking | observation_reminder`; templates with variables `학생명, 과목, 수업명, 예약일시, 장소, 담당선생님`; reminder job `job_id` UUID identity
- Produces: preview/confirm target `{ messageKind, sourceId: observationId }`; scheduled origin keyed by `jobId`

- [ ] **Step 1: queue migration과 message exact-shape RED 테스트 작성**

  SQL test는 다음 무손실 migration 순서를 검증한다.

  1. nullable `job_id`, `message_kind` 추가
  2. 기존 `job_id = appointment_id`, `message_kind = appointment_reminder` backfill
  3. null/duplicate audit
  4. inbound FK 제거
  5. appointment PK 제거
  6. job_id PK와 `(appointment_id, source_revision, message_kind)` unique 추가
  7. scheduled message FK 재연결
  8. shape constraint를 job ID와 message kind 기준으로 교체

  계약 test는 observation source가 한 과목만 반환하고 browser subjects를 받지 않으며 booking/reminder의 exact 변수와 두 버튼을 검증한다.

- [ ] **Step 2: Task 9 RED 확인**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-customer-messages.test.mjs tests/registration-customer-message-contract.test.mjs tests/registration-customer-message-catalog.test.mjs tests/registration-customer-message-source.test.mjs tests/registration-customer-message-route.test.mjs tests/registration-customer-reminder-route.test.mjs tests/registration-customer-reminder-scheduler.test.mjs tests/registration-customer-reminder-worker.test.mjs tests/registration-alimtalk-preview-dialog.test.mjs
  ```
  Expected: observation kinds와 generalized job ID contract가 없어 FAIL.

- [ ] **Step 3: reminder job UUID migration 구현**

  migration은 기존 완료 history를 재개방하지 않는다. producer는 각 새 source revision마다 UUID job을 insert하고 unique conflict 시 기존 행을 반환한다. claim, create scheduled message, finalize, reconcile은 모두 job ID를 사용하며 message의 appointment/revision/kind가 locked job과 일치해야 한다.

  reschedule은 이전 pending job만 canceled로 바꾸고 새 revision job을 만든다. provider attempt가 시작된 `sending | unknown | sent | failed` 행은 자동 재시도하지 않는다.

- [ ] **Step 4: observation canonical source와 catalog 구현**

  source resolver는 observation ID로 task/track/appointment/class/session/teacher/campus/recipient를 서버에서 resolve하고 다음 exact facts를 만든다.

  ```ts
  type ObservationCustomerMessageFacts = {
    studentName: string
    subject: string
    className: string
    scheduledAt: string
    place: "본관" | "별관"
    teacherName: string
  }
  ```

  catalog는 승인 설계의 두 한국어 본문과 다음 버튼을 정확히 렌더한다.

  - `학원 위치 보기`: campus별 canonical Naver Place URL
  - `문의하기`: `https://tipsedu.channel.io`

  허용 변수 외 raw object key가 있으면 preview/create를 거부한다. SMS fallback은 false로 고정한다.

- [ ] **Step 5: preview·확인 발송과 UI 연결**

  청강 예약 저장 성공 뒤에만 `예약 안내 알림톡` 버튼을 활성화한다. dialog는 학생, masked phone suffix, 과목, 수업, 일시, 장소, 담당 선생님, 본문, 두 버튼, 준비 상태를 보여준다. `확인 후 발송`은 template receipt/checksum/activation이 모두 ready일 때만 활성화한다.

  같은 observation+notification revision booking을 한 번 발송하면 발송자·발송시각을 표시하고 버튼을 잠근다. 일정 변경으로 notification revision이 증가한 경우에만 새 안내를 별도 preview 후 보낼 수 있다.

- [ ] **Step 6: 자동 3시간 리마인드 구현**

  observation booking/reschedule 시 lead-hours가 3이고 ON이며 시작까지 3시간 이상일 때만 `observation_reminder` job을 만든다. worker는 claim과 provider 직전에 status, revision, booking hash, phone, template receipt를 재검증한다. completed/no_show/canceled/source_dirty/template_drift에서는 provider 호출 0회다.

- [ ] **Step 7: provider uncertainty와 dedupe 회귀 구현**

  external attempt marker 뒤 timeout/unknown이면 같은 job을 자동 재호출하지 않는다. reconcile은 provider message ID가 있는 행만 finalize하고 operator 확인 없이 second attempt를 만들지 않는다. booking과 reminder는 서로 다른 kind이므로 각각 한 번만 허용한다.

- [ ] **Step 8: Task 9 GREEN 및 커밋**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-customer-messages.test.mjs tests/registration-customer-message-contract.test.mjs tests/registration-customer-message-catalog.test.mjs tests/registration-customer-message-source.test.mjs tests/registration-customer-message-route.test.mjs tests/registration-customer-reminder-route.test.mjs tests/registration-customer-reminder-scheduler.test.mjs tests/registration-customer-reminder-worker.test.mjs tests/registration-alimtalk-preview-dialog.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/tasks/registration-customer-message-contract.ts src/features/tasks/registration-customer-message-service.ts src/features/tasks/registration-alimtalk-preview-dialog.tsx src/features/tasks/registration-observation-editor.tsx src/features/tasks/server/registration-customer-message-source.ts src/features/tasks/server/registration-customer-message-catalog.ts src/features/tasks/server/registration-customer-message-route.ts src/features/tasks/server/registration-customer-reminder-route.ts src/features/tasks/server/registration-customer-reminder-worker.ts src/features/notifications/registration-customer-reminder-service.ts src/features/notifications/registration-customer-reminder-settings.tsx tests/registration-observation-customer-messages.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
  git diff --check
  ```

  Commit:
  ```bash
  git add supabase/migrations/20260809104000_registration_observation_customer_messages.sql supabase/tests/registration_customer_solapi_messages_test.sql src/features/tasks/registration-customer-message-contract.ts src/features/tasks/registration-customer-message-service.ts src/features/tasks/registration-alimtalk-preview-dialog.tsx src/features/tasks/registration-observation-editor.tsx src/features/tasks/server/registration-customer-message-source.ts src/features/tasks/server/registration-customer-message-catalog.ts src/features/tasks/server/registration-customer-message-route.ts src/features/tasks/server/registration-customer-reminder-route.ts src/features/tasks/server/registration-customer-reminder-worker.ts src/features/notifications/registration-customer-reminder-service.ts src/features/notifications/registration-customer-reminder-settings.tsx tests/registration-observation-customer-messages.test.mjs tests/registration-customer-message-contract.test.mjs tests/registration-customer-message-catalog.test.mjs tests/registration-customer-message-source.test.mjs tests/registration-customer-message-route.test.mjs tests/registration-customer-reminder-route.test.mjs tests/registration-customer-reminder-scheduler.test.mjs tests/registration-customer-reminder-worker.test.mjs tests/registration-alimtalk-preview-dialog.test.mjs
  git commit -m "feat: add observation customer messages"
  ```

---

### Task 10: 통합 성능·provider-zero·브라우저 계약과 runtime readiness

**Files:**
- Create: `supabase/migrations/20260809105000_registration_observation_runtime_readiness.sql`
- Create: `tests/registration-observation-performance.test.mjs`
- Create: `tests/registration-observation-provider-zero.test.mjs`
- Create: `tests/registration-observation-browser-verifier.test.mjs`
- Modify: `tests/registration-customer-solapi-local-db-qa.test.mjs`
- Modify: `tests/notification-isolated-db-qa.test.mjs`
- Modify: `tests/registration-browser-verifier-contract.test.mjs`
- Modify: `package.json`
- Modify: `supabase/tests/fixtures/notification_content_local_qa_fixture.sql`

**Interfaces:**
- Consumes: Tasks 1–9 complete schema/functions/UI, large registration fixture, isolated Supabase, local browser verifier
- Produces: `registration_observation_runtime_version() = 1` only when all required relations/functions/contracts exist and singleton activation is 1; scripts `verify:registration-observation:no-send`, `verify:registration-observation:isolated-db`, `verify:registration-observation:browser`

- [ ] **Step 1: readiness·performance·provider-zero RED 테스트 작성**

  readiness test는 required table/function/index/content contract가 하나라도 없으면 runtime version이 0이어야 함을 검증한다. performance test는 summary SQL에 whole observation scan, feedback reason, schedule_plan, classes `*`가 없고 due claim이 indexed bounded batch인지 검사한다.

  provider-zero fixture는 booking/reschedule/cancel/3h reminder/feedback due/submitted 전체 intent를 만들되 mock SOLAPI와 Google Chat provider call count를 0으로 유지한다.

- [ ] **Step 2: Task 10 RED 확인**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-observation-performance.test.mjs tests/registration-observation-provider-zero.test.mjs tests/registration-observation-browser-verifier.test.mjs tests/registration-customer-solapi-local-db-qa.test.mjs tests/notification-isolated-db-qa.test.mjs tests/registration-browser-verifier-contract.test.mjs
  ```
  Expected: readiness migration, QA scripts, browser contract가 없어 FAIL.

- [ ] **Step 3: runtime readiness migration 구현**

  `registration_observation_runtime_version()`은 singleton activation이 1이고 required objects가 모두 존재할 때만 1을 반환한다. schema cache mismatch 또는 required function 누락은 0으로 fail closed한다. activation row는 여전히 0으로 유지한다.

  관리자 수동 SQL로만 activation 값을 바꿀 수 있고 Data API authenticated role에는 update/execute 권한을 주지 않는다.

- [ ] **Step 4: large fixture와 EXPLAIN 검증 구현**

  fixture는 최소 1,000 tasks, 3,000 tracks, 2,000 terminal observations, 300 open observations, due jobs를 만든다. 다음을 증명한다.

  - registration summary는 fixed scalar projection이고 response row size가 observation history 수에 비례하지 않는다.
  - detail read는 한 task/track/observation index 범위다.
  - session read는 한 class와 120일 범위다.
  - due claim은 `(status,due_at)` index와 bounded limit을 사용한다.
  - first screen에 feedback reason, textbook snapshot JSON, schedule_plan이 없다.

- [ ] **Step 5: isolated DB provider-zero와 no-send script 구현**

  `verify:registration-observation:no-send`는 실제 provider adapter를 spy로 막고 intent, message, due rows, duplicate, privacy를 검증한다. `verify:registration-observation:isolated-db`는 migration 전체를 clean local DB에 적용하고 pgTAP, content contract, queue backfill, RLS actor matrix를 실행한다.

- [ ] **Step 6: browser verifier 구현**

  fixture mode에서 desktop/mobile 두 viewport로 다음을 검증한다.

  - list tab 순서와 과목별 상태
  - 반·회차 지연 조회와 저장 확인
  - 알림톡 nested preview가 상세 modal 위에 보이고 닫힌 뒤 focus가 돌아옴
  - teacher feedback direct route와 unrelated teacher not-found
  - calendar 청강 filter/deep link
  - enrollment 특별 첫 수업일 기본값과 다른 회차 선택
  - 400% zoom에서 핵심 버튼 접근 가능

- [ ] **Step 7: 전체 회귀·build GREEN**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test tests/registration-*.test.mjs tests/notification-registration-*.test.mjs tests/notification-google-chat-content.test.mjs tests/notification-content-contract.test.mjs tests/notification-content-manifest.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run verify:registration-observation:no-send
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run verify:registration-observation:isolated-db
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run lint
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm tsc --noEmit --pretty false
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm run build
  git diff --check
  ```

- [ ] **Step 8: Task 10 커밋**

  Commit:
  ```bash
  git add supabase/migrations/20260809105000_registration_observation_runtime_readiness.sql supabase/tests/fixtures/notification_content_local_qa_fixture.sql tests/registration-observation-performance.test.mjs tests/registration-observation-provider-zero.test.mjs tests/registration-observation-browser-verifier.test.mjs tests/registration-customer-solapi-local-db-qa.test.mjs tests/notification-isolated-db-qa.test.mjs tests/registration-browser-verifier-contract.test.mjs package.json
  git commit -m "test: verify observation workflow readiness"
  ```

---

### Task 11: 코드 리뷰, forward migration, Production 배포, provider-zero 운영 검증

**Files:**
- Create: `docs/superpowers/reports/2026-08-09-registration-observation-rollout.md`
- Modify only if review finds a defect: files owned by Tasks 1–10 and their focused tests

**Interfaces:**
- Consumes: clean feature branch, independent code review, Supabase project health, Vercel Git integration, runtime activation singleton still 0
- Produces: reviewed commits, GitHub `main` push, applied forward migrations, Vercel Production `READY` at exact main SHA, provider-zero production evidence report

- [ ] **Step 1: independent review 요청과 수정 경계 확정**

  `superpowers:requesting-code-review`를 사용해 spec compliance, DB privilege/RLS, concurrency, queue migration, privacy, performance를 검토한다. finding은 재현 테스트를 RED로 추가한 뒤 해당 Task의 최소 코드만 고치고 focused suite와 전체 회귀를 다시 실행한다.

- [ ] **Step 2: pre-deploy health와 release boundary 확인**

  Supabase control plane, read-only SQL, Auth/API/Postgres 최근 오류, lock wait, Vercel current Production SHA를 읽기 전용으로 확인한다. project unhealthy, Auth/REST 5xx 재발, statement timeout 또는 lock waiter가 있으면 migration과 push를 중단한다.

  다음을 별도 evidence로 기록한다.

  ```text
  Tests/build:
  Git push:
  Supabase migration:
  Runtime activation:
  Vercel Production:
  Google Chat provider:
  SOLAPI provider:
  ```

- [ ] **Step 3: production migration preflight**

  migration filenames/order, remote migration ledger, destructive statements 부재, reminder job backfill audit, classroom campus null count를 확인한다. 사용 중인 classroom 중 campus 미설정이 1건이라도 있으면 runtime activation만 차단하고 migration 자체는 적용할 수 있다.

- [ ] **Step 4: forward migrations 적용**

  Task 1–10의 새 migration만 순서대로 적용한다. 적용 직후 runtime singleton이 0, 신규 Google Chat rule이 disabled, observation SOLAPI template activation이 false, provider attempts가 0인지 SQL로 확인한다.

- [ ] **Step 5: main push와 Vercel Production 검증**

  최신 `origin/main` 이동 여부를 다시 확인하고 충돌이 없을 때 feature branch를 main에 반영한다. GitHub remote SHA, Vercel deployment meta SHA, `READY`, `tipsedu.co.kr` alias를 각각 확인한다. HTML 200만으로 배포 완료를 주장하지 않는다.

- [ ] **Step 6: runtime OFF 상태 production smoke**

  admin/staff/teacher 세 권한으로 로그인, 기존 등록 direct path, 기존 레벨테스트/상담/대기/등록, 기존 SOLAPI/Google Chat regression을 확인한다. runtime 0에서는 청강 진입이 보이지 않고 기존 기능은 정상이어야 한다.

- [ ] **Step 7: classroom campus 운영 backfill과 runtime ON**

  운영자가 실제 본관/별관을 확인한 classroom만 명시적으로 backfill한다. 사용 중인 강의실의 campus null/ambiguous가 0이고 required runtime probe가 1-ready임을 확인한 뒤 singleton activation을 1로 바꾼다. 이 변경은 SOLAPI/Google Chat 활성화를 포함하지 않는다.

- [ ] **Step 8: production provider-zero 청강 smoke**

  테스트 학생과 한 과목으로 청강 진입→예약→변경→취소, 재예약→참석/피드백→원장 결정, calendar, teacher direct route, enrollment 기본값을 검증한다. 신규 provider rules는 OFF 상태로 두고 provider attempts가 계속 0인지 확인한다. 테스트 데이터는 명시적 테스트 표지를 사용하고 운영 이력 정책에 따라 보존한다.

- [ ] **Step 9: Task 11 GREEN 판정**

  exact main SHA의 Production이 READY이고, forward migration ledger가 일치하며, observation runtime은 ON이지만 신규 Google Chat/SOLAPI provider attempt는 0이어야 한다. admin/staff/teacher smoke, provider-zero 청강 lifecycle, 기존 등록 회귀가 모두 통과한 경우에만 Task 11을 GREEN으로 판정한다.

- [ ] **Step 10: rollout report 작성·검증·커밋**

  report에는 exact SHA, migration ledger, runtime 값, role smoke, payload/EXPLAIN, provider-zero counts, 미활성 항목을 기록한다. 비밀, webhook URL, 전체 전화번호, template secret을 기록하지 않는다.

  Run:
  ```bash
  git diff --check
  git status --short --branch
  ```

  Commit:
  ```bash
  git add docs/superpowers/reports/2026-08-09-registration-observation-rollout.md
  git commit -m "docs: record observation rollout evidence"
  ```

---

### Task 12: Google Chat 단계 활성화와 SOLAPI 별도 승인·실수신

**Files:**
- Modify: `docs/superpowers/reports/2026-08-09-registration-observation-rollout.md`
- No source or migration file changes unless a reproduced defect requires a new reviewed commit or follow-up migration

**Interfaces:**
- Consumes: runtime ON, provider-zero production smoke, configured subject-team/executive-team connections, SOLAPI template approval receipts
- Produces: staged Google Chat activation receipts; approved SOLAPI observation templates; one test booking receipt and one automatic 3-hour reminder receipt; duplicate count 0

- [ ] **Step 1: 외부 활성화 gate RED 확인**

  신규 Google Chat rules가 OFF이고 SOLAPI 두 템플릿 activation이 false인 상태에서 테스트 청강을 예약한다. notification intent와 due row는 생성되지만 두 provider call count가 0인지 확인한다. 미승인 template으로 preview를 만들 수 있어도 confirm send는 `template_drift` 또는 `activation_off`로 거부되어야 한다. 이 실패가 관찰되지 않으면 활성화를 중단한다.

- [ ] **Step 2: Google Chat lifecycle event를 한 family씩 활성화**

  다음 순서를 고정한다.

  1. scheduled/rescheduled/canceled
  2. observation_reminder_due
  3. observation_feedback_due
  4. observation_feedback_submitted와 director inbox

  각 단계마다 정확한 subject destination, 카드 본문, Dashboard 버튼, delivery receipt 한 건, duplicate 0, 개인정보 0을 확인한 뒤 다음 rule을 활성화한다. 실패하면 해당 rule만 OFF로 되돌리고 domain runtime은 유지한다.

- [ ] **Step 3: SOLAPI 두 템플릿 승인 요청**

  승인 설계 본문, 여섯 변수, campus별 `학원 위치 보기`, Channel Works `문의하기`, no-SMS-fallback으로 `observation_booking`과 `observation_reminder`를 제출한다. 승인 대기 중에는 두 activation을 false로 유지한다.

- [ ] **Step 4: 승인 receipt preflight**

  provider template ID, Kakao channel/sender, normalized body checksum, 변수명, 버튼 label/URL, 승인 상태를 server-only receipt와 대조한다. 하나라도 다르면 `template_drift`로 닫고 실제 발송하지 않는다.

- [ ] **Step 5: 예약 안내 실수신 한 번 검증**

  승인된 테스트 번호로 실제 청강 예약을 저장하고 미리보기에서 학생, 끝 4자리, 과목, 반, 일시, 장소, 담당 선생님을 확인한 뒤 명시적으로 발송한다. provider attempt, SOLAPI receipt, 휴대폰 실수신, 발송자·발송시각 표시, 두 번째 버튼 잠금, SMS 대체 0을 각각 확인한다.

- [ ] **Step 6: 자동 3시간 리마인드 실수신 한 번 검증**

  3시간 이상 남은 별도 테스트 예약을 사용하고 reminder ON/lead=3을 확인한다. due 전 provider call 0, due 후 정확히 한 attempt, receipt, 휴대폰 수신, duplicate 0을 확인한다. lead 미만 fixture에는 job/provider call이 모두 0이어야 한다.

- [ ] **Step 7: 24시간 관찰과 rollback 검증**

  Auth/API/Postgres/Vercel runtime errors, observation due backlog, `source_dirty`, `unknown`, duplicate, wrong-destination을 관찰한다. 종료 30분 후 feedback due가 조기 제출·취소·노쇼에서는 0건이고 미제출 참석 건에서만 한 번인지 확인한다. 이상이 있으면 customer reminder OFF, observation template activation OFF, 해당 Google Chat rule OFF 순서로 외부 전송을 멈춘다. 데이터 행은 삭제하지 않는다.

- [ ] **Step 8: Task 12 GREEN 판정**

  Google Chat 여섯 event의 올바른 destination·receipt·duplicate 0, SOLAPI 예약 안내와 3시간 리마인드의 승인 receipt·실수신·duplicate 0, 개인정보·SMS fallback 0, 24시간 오류 재발 없음이 모두 확인된 경우에만 Task 12를 GREEN으로 판정한다.

- [ ] **Step 9: 최종 evidence report 갱신·커밋**

  provider 승인과 실수신은 timestamp, masked recipient suffix, provider receipt ID, message kind, source revision, duplicate count만 기록한다. 테스트/DB/push/Vercel/Google Chat/SOLAPI 상태를 한 문장으로 합치지 않고 별도 표로 남긴다.

  Run:
  ```bash
  git diff --check
  git status --short --branch
  ```

  Commit:
  ```bash
  git add docs/superpowers/reports/2026-08-09-registration-observation-rollout.md
  git commit -m "docs: record observation provider activation"
  ```

---

## Final Verification Matrix

| 경계 | 필수 증거 | 실패 시 처리 |
|---|---|---|
| 도메인 | pgTAP actor/concurrency/finance 전부 PASS | runtime 0 유지 |
| 클라이언트 | focused tests, ESLint, TypeScript, webpack build PASS | push 중단 |
| 성능 | bounded summary/detail/session/due EXPLAIN과 payload 기준 PASS | migration 또는 activation 중단 |
| DB | forward migration ledger 일치, runtime/settings/rules default OFF | main cutover 중단 |
| Vercel | Production `READY`, exact main SHA, custom alias | runtime 0 유지 |
| Dashboard | admin/staff/teacher 실제 권한과 mobile/zoom smoke | runtime 0 또는 follow-up fix |
| Google Chat | event family별 올바른 방·receipt 1·duplicate 0·privacy 0 | 해당 rule OFF |
| SOLAPI | 승인 checksum·두 버튼·no fallback·실수신·duplicate 0 | template activation/reminder OFF |

완료 보고에서는 다음 상태를 반드시 분리한다.

1. 코드와 테스트 완료
2. GitHub main 반영
3. Supabase migration 적용
4. observation runtime 활성화
5. Vercel Production READY
6. Google Chat event family 활성화와 receipt
7. SOLAPI 템플릿 승인, activation, 예약 안내 실수신
8. SOLAPI 3시간 리마인드 실수신
