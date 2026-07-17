# Registration Appointments, History, Calendar, and Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish registration intake and appointment operations on canonical subject tracks, add trustworthy automatic history and a list/calendar workspace, and materialize durable appointment reminders through the common notification control plane.

**Architecture:** Keep `ops_tasks`/`ops_registration_details` as the parent case, `ops_registration_subject_tracks` as per-subject state, and `ops_registration_appointments` plus canonical children as the only scheduled source. Focused registration models project history and calendar items without writing `academic_events`. Appointment mutations synchronously record immutable reminder events and common fan-out jobs; shared workers and delivery tables remain owned by the common control-plane plan, while one registration adapter implements source/recipient revalidation.

**Tech Stack:** Next.js 16.1.1, React 19.2.3, TypeScript 5.9, Supabase/PostgreSQL 17, date-fns 4, shadcn/Radix UI, Node.js built-in test runner, Playwright.

## Global Constraints

- Execution order is fixed: common notification control plane first, this registration plan second, seven workflow adapters third.
- Do not begin Task 5 until `public.common_notification_control_plane_runtime_version() = 1` and the common migration/tests are present.
- Consume, never redefine, `get_notification_control_plane_v1`, `save_notification_control_plane_v1`, `claim_notification_fanout_jobs_v1`, `claim_notification_rule_reconciliation_jobs_v1`, `claim_notification_target_reconciliation_jobs_v1`, `finish_notification_orchestration_job_v1`, `claim_notification_deliveries_v1`, `begin_notification_delivery_send_v1`, `finalize_notification_delivery_v1`, `reap_notification_leases_v1`, and `reconcile_notification_delivery_v1`.
- Registration processing status/retry consumes exactly `public.get_notification_orchestration_job_status_v1(p_job_kind text, p_job_id uuid) returns jsonb` and `public.retry_notification_orchestration_job_v1(p_job_kind text, p_job_id uuid, p_expected_attempt_count integer, p_request_id uuid) returns jsonb`; no registration code reads or updates common job tables directly.
- Consume `dashboard_private.record_notification_event_v1(p_scope_key text, p_workflow_key text, p_event_key text, p_source_type text, p_source_id text, p_source_revision bigint, p_occurrence_key text, p_actor_profile_id uuid, p_occurred_at timestamptz, p_payload_schema_version integer, p_payload jsonb, p_materialized_rule_id uuid default null, p_materialized_rule_revision bigint default null) returns jsonb` with exact safe result `{event_id, fanout_job_id}`, and `dashboard_private.enqueue_notification_target_reconciliation_job_v1(p_workflow_key text, p_source_type text, p_source_id text, p_source_revision bigint, p_source_event_id uuid, p_reconciliation_kind text, p_target_generation bigint, p_previous_target_set_hash text, p_current_target_set_hash text) returns uuid`; do not recreate common event, rule, template, delivery, job, audit, lease, ownership, or request-ledger tables.
- One case owns common inquiry data once; English and mathematics advance through separate tracks; shared appointments remain one row with per-subject child rows.
- Phone consultation is a per-subject queue activity with no appointment or editable date/time. `ready_at` appears only in queue/history metadata and is never labeled `예약일시`.
- `누가 → 언제 → 어디서 → 무엇을 → 어떻게` is the product-wide ordering rule for every newly created or touched form unless a documented domain rule overrides it. This plan physically reorders only the registration surfaces it changes. The per-subject plan selector is the documented conditional-branch exception because it determines which downstream fields exist; inside every revealed branch, editable fields still follow the product-wide order.
- Consultation editable DOM order is exactly responsible directors, visit date/time, visit room. Level-test scheduling contains only date/time, place, and participating subjects; result URL belongs only to completion.
- New process events use payload version 2 and explicit `actor_kind = user | system | migration`; version-1 null actors render `알 수 없음` without inference.
- Registration calendar reads only canonical `ops_registration_appointments`; it never writes `academic_events`, reduces timestamps to date-only values, or offers drag/resize editing.
- Reminder event key is exactly `registration.appointment_reminder_due`; occurrence identity contains appointment ID, source revision, stable rule ID, and rule revision, never `scheduled_for`.
- The three fixed variants are `previous_day_at` at previous KST day 14:00, `same_day_at` at KST day 14:00, and `offset_before` at 60 minutes. Every seeded cell is disabled.
- Applicability is fixed: level test → `management_team/in_app` and `management_team/google_chat`; visit → `track_director/in_app` and `management_team/google_chat`.
- Creation starts `notification_revision = 1`; this PostgreSQL `integer` remains a JSON/TypeScript `number`. Schedule, place, participation, replacement, or cancellation increments it once; completion and director reassignment do not increment it.
- Creation also starts `recipient_revision = 1`; this PostgreSQL `bigint` crosses JSON/TypeScript boundaries as a decimal string. Only a real normalized distinct reminder-recipient-set change increments it once under the appointment lock, and it maps without numeric conversion to common `target_generation`, independently of numeric schedule `notification_revision` and dispatch `owner_generation`.
- Canonical data, process event, required notification event/fan-out job, and required target job commit atomically. Post-commit fan-out, reconciliation, rendering, delivery, and provider failure never rolls back an appointment.
- Preserve current immediate visit, phone-queue, and SOLAPI semantics and flags; this plan does not cut those adapters over.
- All approved feature flags default false. Enabling registration dispatch never enables phone, visit-immediate, or SOLAPI adapter flags.
- The exact flags are `notification_control_plane_settings_ui_enabled`, `notification_control_plane_shadow_write_enabled`, `notification_control_plane_dispatch_registration_enabled`, `notification_control_plane_registration_phone_adapter_enabled`, `notification_control_plane_registration_visit_adapter_enabled`, and `notification_control_plane_registration_solapi_adapter_enabled`.
- Current measured Node baseline is **1011 tests passing**. Any unrelated baseline change stops execution for investigation.
- Never apply a migration to the linked Supabase project, send an external notification, push, or deploy without separate authorization.
- SQL/RPC/HTTP wire values remain snake_case; the service/adapter maps once to camelCase. Every bigint revision/generation stays a decimal string in TypeScript, while integer appointment `notification_revision` stays a `number`.

---

## File Structure

- `src/features/tasks/registration-initial-plan-control.tsx`: canonical per-subject intake plans and conditional shared appointment inputs.
- `src/features/tasks/registration-track-service.ts`: canonical event decoding, calendar reads, reminder preview/retry calls, and mutation response types.
- `src/features/tasks/registration-track-history.js`: milestone grouping and honest migration fallback.
- `src/features/tasks/registration-history-timeline.tsx`: read-only, filterable timeline.
- `src/features/tasks/registration-appointment-calendar-model.ts`: stable canonical calendar projection and filtering.
- `src/features/tasks/registration-appointment-calendar.tsx`: desktop month/week and mobile agenda, with no gesture mutation.
- `src/features/tasks/registration-appointment-draft.ts`: conflict comparison, rebase, confirmation summary, and reminder preview state.
- `src/features/notifications/server/adapters/registration-notification-adapter.ts`: common-worker registration resolver/revalidator; registry wiring belongs to the later adapters plan.
- `supabase/migrations/20260715100000_registration_history_v2.sql`: forward-only event writer upgrade.
- `supabase/migrations/20260715101500_registration_appointment_calendar.sql`: security-invoker canonical calendar view.
- `supabase/migrations/20260715103000_registration_appointment_reminder_producer.sql`: disabled seeds, KST evaluator, atomic producer/cancellation/target-job integration, and readiness marker.

### Task 1: Canonical Intake Form and Atomic Initial Workflow

**Files:**
- Create: `src/features/tasks/registration-initial-plan-control.tsx`
- Modify: `src/features/tasks/registration-intake-workflow.ts`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `src/features/tasks/registration-track-fixtures.ts`
- Test: `tests/registration-intake-workflow.test.mjs`
- Test: `tests/registration-track-fixtures.test.mjs`
- Test: `tests/ops-task-workspace.test.mjs`

**Interfaces:**
- Consumes: `probeRegistrationIntakeWorkflowRuntime()`, `normalizeRegistrationInitialWorkflow(draft, subjects)`, `createRegistrationCaseWithInitialWorkflow(input)`.
- Produces: `RegistrationInitialPlanControl({ subjects, draft, resolvedDirectorIds, directorOptionsBySubject, disabled, onChange })` and a ready-mode submit path using `RegistrationCaseCreateWithInitialWorkflowInput`.

- [ ] **Step 1: Write failing model and source-contract tests**

Assert that `normalizeRegistrationInitialWorkflow` has no phone timestamp or result URL, that direct-phone has `levelTestAppointment === null` and `visitAppointment === null`, and that workspace source orders `과목별 상담 책임자` before `방문상담 예약일시` before `방문상담실`. Assert absence of `전화상담 예약일시`, `phoneConsultationAt`, and scheduling-time `시험지·결과지 URL` inside the registration create/edit branch.

Run:

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --experimental-strip-types --test tests/registration-intake-workflow.test.mjs tests/ops-task-workspace.test.mjs
```

Expected: FAIL on the legacy phone picker/result URL and missing `RegistrationInitialPlanControl`.

- [ ] **Step 2: Implement the focused control and normalized payload boundary**

Use this exact public boundary:

```ts
export type RegistrationInitialPlanControlProps = {
  subjects: RegistrationSubject[]
  draft: RegistrationInitialWorkflowDraft
  resolvedDirectorIds: Partial<Record<RegistrationSubject, string>>
  directorOptionsBySubject: Record<RegistrationSubject, Array<{ value: string; label: string }>>
  disabled: boolean
  onChange: (draft: RegistrationInitialWorkflowDraft) => void
}
```

Render the prerequisite per-subject plan selectors first. When any subject chooses consultation, the revealed editable block starts with director selectors in subject order; when any chooses visit, follow them with one visit datetime and then one room input. When any chooses level test, render one datetime, then place, then read-only subject badges. Do not render a phone date/time or result-link input.

- [ ] **Step 3: Wire runtime gating and the one atomic create call**

In `submitForm`, when runtime version is 1, compute blockers, normalize once, and call:

```ts
await createRegistrationCaseWithInitialWorkflow({
  studentName, schoolGrade, schoolName, parentPhone, studentPhone,
  campus: normalizeRegistrationCampus(registration.campus),
  inquiryAt: registration.inquiryAt,
  subjects, requestNote: registration.requestNote || "",
  priority: form.priority, requestKey, ...initialWorkflow,
})
```

Remove the follow-up `persistCreatedRegistrationDirectorDefaults` call from this ready path. If runtime is absent, show only the persistable inquiry flow; never show downstream controls and then save them through `createRegistrationCase`.

- [ ] **Step 4: Extend the deterministic fixture and pass focused tests**

Record the exact normalized payload in the fixture receipt and cover English direct-phone plus mathematics visit with separate directors, one visit appointment, and no phone appointment.

Run the Step 1 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/registration-initial-plan-control.tsx src/features/tasks/registration-intake-workflow.ts src/features/tasks/ops-task-workspace.tsx src/features/tasks/registration-track-fixtures.ts tests/registration-intake-workflow.test.mjs tests/registration-track-fixtures.test.mjs tests/ops-task-workspace.test.mjs
git commit -m "feat: finish canonical registration intake form"
```

### 작업 2: Version-2 등록 이력과 서비스 해석

**파일:**
- 생성: `supabase/migrations/20260716114000_registration_history_v2.sql`
- 수정: `src/features/tasks/registration-track-service.ts`
- 수정: `src/features/tasks/registration-track-fixtures.ts`
- 테스트: `tests/registration-track-schema.test.mjs`
- 테스트: `tests/registration-track-service.test.mjs`
- 테스트: `supabase/tests/registration_subject_tracks_runtime_test.sql`
- 테스트: `supabase/tests/registration_intake_workflow_runtime_test.sql`

**인터페이스:**
- `OpsRegistrationTrackEvent.actorKind`, `systemSource`, `reasonCode`, `payloadVersion`을 제공합니다.
- 비공개 `write_registration_track_event_v2(p_task_id uuid, p_track_id uuid, p_event_type text, p_source text, p_destination text, p_reason_code text, p_metadata jsonb, p_actor_kind text, p_system_source text) returns uuid`와 기존 7개 인자 void wrapper를 제공합니다.
- version-1 해석과 기존 공개 등록 mutation 서명은 모두 유지합니다.

- [x] **1단계: 실패하는 v2 파서·마이그레이션 소스 계약 테스트 작성**

`actorKind: "user"`, `"system"`, `"migration"` fixture를 사용하고 version-1 null 행위자가 종류 추측 없이 null로 유지되는지 검증합니다. 마이그레이션이 기존 작성기 서명을 유지하고 비공개 호출자만 사용할 수 있도록 끝나는지 검증합니다.

실행:

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --experimental-strip-types --test tests/registration-track-schema.test.mjs tests/registration-track-service.test.mjs
```

예상 결과: v2 필드와 함수가 없으므로 실패합니다.

- [x] **2단계: 앞으로 기록되는 이력을 위한 v2 작성기 추가**

서버가 다음 v2 payload를 작성해야 합니다.

```sql
jsonb_build_object(
  'version', 2, 'event_type', p_event_type,
  'actor_profile_id', case when p_actor_kind = 'user' then auth.uid() else null end,
  'actor_kind', p_actor_kind, 'system_source', nullif(btrim(p_system_source), ''),
  'track_id', p_track_id, 'subject', v_subject,
  'source', p_source, 'destination', p_destination,
  'reason_code', nullif(btrim(p_reason_code), ''),
  'metadata', coalesce(p_metadata, '{}'::jsonb), 'occurred_at', v_occurred_at
)
```

닫힌 집합 밖의 행위자 종류는 거절하고, 사용자 이벤트에는 `auth.uid()`를, 시스템 이벤트에는 안정된 `systemSource`를 요구하며, 마이그레이션 행의 프로필 ID는 null로 고정합니다. 기존 7개 인자 작성기 본문은 인증 mutation에 대해 `user`로 v2를 한 번 호출하는 wrapper로 교체합니다. 자동화와 마이그레이션 코드는 v2를 명시적으로 호출합니다.

- [x] **3단계: 추측 없이 두 payload 버전 해석**

다음을 추가합니다.

```ts
actorKind: "user" | "system" | "migration" | null
systemSource: string | null
reasonCode: string | null
payloadVersion: 1 | 2 | null
```

v2 snake_case payload를 camelCase 서비스 DTO로 한 번만 직접 매핑합니다. v1의 `reason`은 표시 호환을 위해 `reasonCode`로 매핑하지만, v1 행위자가 null이면 `actorKind = null`을 유지합니다.

- [x] **4단계: 소스 계약과 임시 SQL 테스트 실행**

1단계 명령을 실행한 뒤, 별도로 승인된 로컬 또는 미리보기 DB에서 다음을 실행합니다.

```bash
pnpm dlx supabase@2.109.1 test db
```

예상 결과: Node 테스트가 통과하고, pgTAP이 데이터와 이벤트의 동시 롤백 및 사용자·시스템·마이그레이션 행위자 검증을 증명합니다.

- [x] **5단계: 커밋**

```bash
git add supabase/migrations/20260716114000_registration_history_v2.sql src/features/tasks/registration-track-service.ts src/features/tasks/registration-track-fixtures.ts tests/registration-track-schema.test.mjs tests/registration-track-service.test.mjs supabase/tests/registration_subject_tracks_runtime_test.sql supabase/tests/registration_intake_workflow_runtime_test.sql
git commit -m "feat: record registration history actors explicitly"
```

완료 근거: 구현 커밋 `e505d3a`. 최종 집중 Node 테스트 `60/60`, TypeScript, 대상 ESLint, 변경 공백 검사를 통과했고 독립 검토 결과 P0/P1/P2는 `0/0/0`입니다. pgTAP 소스 패킷은 `160/160` 항목을 정적으로 검증했으며, 승인된 로컬 또는 미리보기 DB가 없어 SQL 자체는 실행하지 않았습니다.

### 작업 3: 정직한 읽기 전용 등록 이력

**파일:**
- 생성: `src/features/tasks/registration-history-timeline.tsx`
- 수정: `src/features/tasks/registration-track-history.js`
- 수정: `src/features/tasks/registration-track-history.d.ts`
- 수정: `src/features/tasks/registration-track-editor.tsx`
- 수정: `src/features/tasks/ops-task-workspace.tsx`
- 테스트: `tests/registration-track-history.test.mjs`
- 테스트: `tests/ops-task-workspace.test.mjs`

**인터페이스:**
- `buildRegistrationSubjectHistory(detail)`은 `actorKind`, `actorId`, `systemSource`, null을 허용하는 `occurredAt`, `timeKind: exact | unavailable`, `origin: canonical | migration`을 포함한 항목을 만듭니다.
- `RegistrationHistoryTimeline({ detail, profiles })`은 과목·단계 필터만 제공하며 변경 콜백은 받지 않습니다.

- [x] **1단계: 실패하는 이력 진실성 테스트 작성**

공유 예약 이벤트가 두 과목 배지를 가진 한 행으로 묶이는지, 최신순인지, 기본 행이 주요 단계만 포함하는지, 알림 내부 이벤트를 제외하는지, version-1의 null 행위자를 `알 수 없음`으로 표시하는지 검증합니다. 이전 자료 행은 `origin: "migration"`, `timeKind: "unavailable"`을 사용하고 관계없는 `updatedAt`을 사건 시각으로 가장하지 않아야 합니다.

실행:

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --experimental-strip-types --test tests/registration-track-history.test.mjs tests/ops-task-workspace.test.mjs
```

초기 예상 결과: 변경 가능한 스냅숏 시각을 사용하고 이력 구성요소가 없어 실패합니다.

- [x] **2단계: 주요 단계와 이전 자료의 정직성 정규화**

다음 닫힌 기본 단계 매핑을 사용합니다.

```js
const DEFAULT_STAGE_BY_EVENT = {
  case_created: "inquiry", inquiry_routed: "inquiry",
  director_default_resolved: "responsibility", director_manual_override: "responsibility",
  level_test_scheduled: "level_test", level_test_started: "level_test", level_test_completed: "level_test",
  consultation_waiting: "consultation", visit_consultation_scheduled: "consultation", consultation_completed: "consultation",
  waiting_started: "waiting", enrollment_decided: "admission", admission_completed: "admission",
  registration_completed: "registration", track_closed: "closure", track_reopened: "reopening",
}
```

세부 예약 변경은 묶인 주요 단계의 상세 메타데이터가 됩니다. `notification_*`, 분배, 전달, 재시도, 공급자 이벤트는 절대 포함하지 않습니다.

- [x] **3단계: 이력 표시와 현재 상태 분리**

`RegistrationTrackEditor`에 이력을 연결하고 사용자 표시용 프로필 목록을 전달합니다. 현재 담당자는 별도로 보여 주고 이력에는 과목·단계 필터와 상세 펼치기만 둡니다. `담당자 및 일시 이력`을 제거하며, 담당자·처리 예정 시각이 필요하면 작업 버튼 가까운 `현재 업무`에 배치합니다. 이력 행에는 입력·수정·삭제 버튼을 두지 않습니다.

- [x] **4단계: 집중 검증과 커밋**

1단계 명령을 실행하며 예상 결과는 통과입니다.

```bash
git add src/features/tasks/registration-history-timeline.tsx src/features/tasks/registration-track-history.js src/features/tasks/registration-track-history.d.ts src/features/tasks/registration-track-editor.tsx src/features/tasks/ops-task-workspace.tsx tests/registration-track-history.test.mjs tests/ops-task-workspace.test.mjs
git commit -m "feat: show automatic registration history"
```

완료 근거: 구현 커밋 `5667ad4`. 최종 집중 테스트 `87/87`, 전체 Node 테스트 `1213/1213`, TypeScript, 대상·전체 ESLint 오류 0건, 변경 공백 검사, 별도 임시 복사본 프로덕션 빌드의 정적 페이지 `75/75` 생성을 통과했습니다. 브라우저에서 읽기 전용 필터·상세, 원시 영문 상태값 미노출, 가로 넘침 없음을 확인했고 독립 검토 결과 P0/P1/P2는 `0/0/0`입니다. 실제 공급자 호출과 원격 변경은 없었습니다.

### 작업 4: 정규 예약 달력과 딥 링크

**파일:**
- 생성: `supabase/migrations/20260716120000_registration_appointment_calendar.sql`
- 생성: `src/features/tasks/registration-appointment-calendar-model.ts`
- 생성: `src/features/tasks/registration-appointment-calendar.tsx`
- 수정: `src/features/tasks/registration-track-service.ts`
- 수정: `src/features/tasks/registration-track-fixture-runtime.ts`
- 수정: `src/features/tasks/registration-track-fixtures.ts`
- 수정: `src/features/tasks/registration-track-editor.tsx`
- 수정: `src/features/tasks/ops-task-workspace.tsx`
- 테스트: `tests/registration-appointment-calendar.test.mjs`
- 테스트: `tests/ops-task-workspace.test.mjs`
- 테스트: `supabase/tests/registration_subject_tracks_runtime_test.sql`

**인터페이스:**
- 생성: 예약마다 한 행을 반환하는 `security_invoker` 뷰 `public.ops_registration_appointment_calendar`.
- 제공: `loadRegistrationAppointmentCalendar({ rangeStart, rangeEnd, statuses })`와 `buildRegistrationAppointmentCalendarItems(rows)`.
- 제공: `getSeoulRegistrationDateKey(value)`와 `getRegistrationAppointmentCalendarRange(view, anchorDateKey)`.
- 확장: `RegistrationTrackEditorProps.initialAppointmentId?: string | null`.

- [x] **1단계: 실패하는 투영 테스트 작성**

안정 ID `registration-appointment:${appointmentId}`, 원본 ISO 시각, 같은 날의 서로 다른 ID, 정규 과목 배지, 기본 예약 상태 필터, 딥 링크 `/admin/registration?taskId=...&appointmentId=...&view=calendar`, 전화상담·이전 자료 시각 제외를 테스트로 고정했습니다. 잘못된 종류·상태·정수 리비전·시각과 중복 예약은 명시적으로 거절합니다.

실행:

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --experimental-strip-types --test tests/registration-appointment-calendar.test.mjs tests/ops-task-workspace.test.mjs
```

초기 예상 결과대로 모델·뷰·전환 UI가 없는 상태에서 실패를 확인한 뒤 최소 구현을 추가했습니다.

- [x] **2단계: 보안 호출자 방식의 정규 뷰 추가**

레벨테스트와 방문 방식 상담 하위 기록만 집계하고 트랙 과목을 영어→수학 순으로 정렬했습니다. `appointment_id`, `task_id`, `student_name`, `kind`, `scheduled_at`, `place`, `status`, 텍스트 변환 없는 정수형 `notification_revision`, `track_ids`, `subjects` 정확히 10개 열을 노출합니다. `security_invoker = true`, PUBLIC·anon 권한 차단, authenticated 읽기 전용 권한을 적용하고 기존 등록 RLS를 따릅니다. `academic_events`는 조회하거나 쓰지 않습니다.

- [x] **3단계: 타입 투영과 fixture 조회 구현**

사용한 공개 타입:

```ts
export type RegistrationAppointmentCalendarItem = {
  id: `registration-appointment:${string}`
  appointmentId: string; taskId: string; studentName: string
  kind: "level_test" | "visit_consultation"
  scheduledAt: string; place: string
  status: "scheduled" | "completed" | "canceled"
  notificationRevision: number; trackIds: string[]
  subjects: RegistrationSubject[]; href: string
}
```

snake_case 뷰를 이 camelCase DTO로 한 번만 변환하고 정수형 `notification_revision`을 문자열로 바꾸지 않고 `number`로 유지했습니다. 별도의 bigint `recipient_revision`/`target_generation` 계약만 10진 문자열을 사용합니다. fixture 행은 매 조회마다 현재 `caseDetails`에서 계산하고 예약 ID 중복을 만들지 않으며 전화상담 항목을 파생하지 않습니다.

- [x] **4단계: 데스크톱 월/주 보기와 모바일 시간순 목록 구현**

기존 단계 탭의 `flow=`를 유지하면서 작업 공간 모드 `list | calendar`를 추가했습니다. 달력은 기본적으로 예약 상태만 표시하고 완료·취소를 명시적으로 포함할 수 있으며, 서울 시간 기준 날짜 키와 반개방 월/주 범위를 사용합니다. 카드는 버튼뿐이며 `draggable`, `onDrop`, 범위 선택, 크기 조절, 저장, 삭제 처리기가 없습니다.

`appointmentId`와 `taskId`를 함께 해석하고 참여 하위 기록을 찾아 해당 트랙을 선택한 뒤 `initialAppointmentId`를 전달해 공유 편집기를 한 번만 엽니다. 새로고침은 예약을 복원하고 사용자가 닫으면 다시 열지 않으며, `trackId`를 바꿀 때도 `view=calendar`를 유지합니다.

- [x] **5단계: 집중·pgTAP 소스·브라우저 검증과 커밋 범위 확정**

1단계 명령과 전체 회귀를 실행해 통과를 확인했습니다. pgTAP 소스 계획값과 assertion 수는 `168/168`로 일치하고 anon/PUBLIC 차단 및 authenticated 읽기 전용 계약을 포함합니다. 승인된 임시 DB가 없어 pgTAP SQL 자체는 실행하지 않았습니다.

```bash
git add supabase/migrations/20260716120000_registration_appointment_calendar.sql src/features/tasks/registration-appointment-calendar-model.ts src/features/tasks/registration-appointment-calendar.tsx src/features/tasks/registration-track-service.ts src/features/tasks/registration-track-fixture-runtime.ts src/features/tasks/registration-track-fixtures.ts src/features/tasks/registration-track-editor.tsx src/features/tasks/ops-task-workspace.tsx tests/registration-appointment-calendar.test.mjs tests/ops-task-workspace.test.mjs supabase/tests/registration_subject_tracks_runtime_test.sql
git commit -m "feat: add canonical registration calendar"
```

완료 근거: 전체 Node 테스트 `1231/1231`, TypeScript, 변경 공백 검사, 별도 임시 복사본 프로덕션 빌드의 정적 페이지 `75/75` 생성을 통과했습니다. 전체 ESLint는 오류 `0건`이며 기존 생성 스크립트 경고 `1건`만 남았습니다. 브라우저에서 월/주 보기, 정규 딥 링크, 새로고침 복원, 닫은 뒤 재개방 방지, 공유 예약 과목 전환을 확인했고 독립 검토 P0/P1/P2는 `0/0/0`입니다. 원격 변경과 실제 공급자 호출은 없었습니다.

### Task 5: Atomic Reminder Materialization and Reconciliation Producer

**Files:**
- Create: `supabase/migrations/20260715103000_registration_appointment_reminder_producer.sql`
- Create: `tests/registration-appointment-reminders.test.mjs`
- Modify: `tests/registration-track-schema.test.mjs`
- Modify: `supabase/tests/registration_subject_tracks_runtime_test.sql`

**Interfaces:**
- Consumes exact common producer signatures supplied by the common plan.
- Produces appointment `recipient_revision`; private `calculate_registration_reminder_schedule_v1`, `materialize_registration_appointment_reminders_v1`, `cancel_registration_appointment_reminders_v1`; public `preview_registration_appointment_reminders_v1`; and, as the migration's final object, `public.registration_appointment_reminders_runtime_version() returns integer` with value `1`.

- [ ] **Step 1: Write failing schedule and atomicity tests**

Cover KST 00:00, 00:30, 13:59, 14:00, 14:01, 23:59; month/year/leap boundaries; non-KST host timezone; no same-day 14:00 round at/before 14:00; no past backfill; exact occurrence identity; all nine applicable rule rows disabled; duplicate materialization; numeric integer `notification_revision`; decimal-string bigint `recipient_revision = 1` on create; no increment for the same normalized target set; one increment and one target job for a real change; A→B→A generations 1/2/3; previous/current set-hash determinism; one raw director event whose returned UUID equals the target job's `source_event_id`; no wrapper-created duplicate raw event; final-marker source order; both-marker fail-closed behavior; and rollback when common event/job or target job insertion fails.

Run:

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --experimental-strip-types --test tests/registration-appointment-reminders.test.mjs tests/registration-track-schema.test.mjs
```

Expected: FAIL because the registration producer does not exist.

- [ ] **Step 2: Seed fixed disabled cells and templates**

Seed only the three variants across `management_team/in_app`, `management_team/google_chat`, and `track_director/in_app`; use the server applicability registry to reject the invalid kind/cell pairings. Store exact configs:

```json
{"anchor_key":"appointment_scheduled_at","local_time":"14:00","timezone":"Asia/Seoul"}
{"anchor_key":"appointment_scheduled_at","lead_minutes":60,"timezone":"Asia/Seoul"}
```

Each stable rule gets an immutable initial template, revision 1, and `enabled = false`. The closed registration rule/applicability rows, Korean preset labels, and all-disabled warning state are this plan's entire settings contribution; the common plan owns the page, component, and every launcher mount. Deployment must generate zero reminder deliveries.

- [ ] **Step 3: Implement one KST evaluator and atomic event recording**

For every enabled, applicable rule with `now < scheduled_for < appointment.scheduled_at`, construct:

```text
registration:registration_appointment:{appointmentId}:source_revision:{notificationRevision}:rule:{ruleId}:rule_revision:{ruleRevision}
```

Call `dashboard_private.record_notification_event_v1('global','registration','registration.appointment_reminder_due','registration_appointment',appointment_id::text,notification_revision,occurrence_key,null,now(),2,payload,rule_id,rule_revision)` and capture its exact `{event_id, fanout_job_id}` result; an idempotent occurrence replay returns the same pair. Its common implementation inserts the immutable event and unique fan-out job. Payload includes `actor_kind = 'system'`, `system_source = 'registration_reminder_materializer'`, task, kind, scheduled time, place, track IDs, and subjects only. Audit `not_before_appointment`; do not create an event for disabled, non-applicable, passed, or not-before rounds. Append each returned `fanout_job_id` to the backward-compatible mutation response as opaque `{job_kind: 'fanout', job_id}` only, so the browser can use the common operator RPCs without reading common job tables or receiving event payloads/private job fields.

- [ ] **Step 4: Wrap every current appointment mutation in the shared lock/order**

Forward-replace the current implementations of `create_registration_case_with_initial_workflow_v1`, `save_registration_shared_appointment`, `cancel_registration_appointment`, `complete_registration_level_test_attempt`, `complete_registration_consultation`, and director assignment. Acquire the common registration workflow advisory transaction lock before appointment/track rows. Create appointments with `recipient_revision = 1`. Apply notification-revision rules exactly; cancel old `pending`/`retry_wait`, mark old pre-send `claimed` as `cancel_requested`, and preserve `sending`, `sent`, `delivery_unknown`, and terminal history.

For visit director reassignment, lock the appointment, compute sorted distinct previous/current valid director profile IDs and their hashes, and keep numeric `notification_revision` unchanged. The command already owes one raw domain-history event with `v_event_type` equal to `director_default_resolved`, `director_manual_override`, or `director_default_cleared`: call `dashboard_private.write_registration_track_event_v2(...)` exactly once, capture its returned UUID in `director_assignment_source_event_id`, and do not also call the seven-argument wrapper for that logical reassignment. Never insert a raw row whose event type is `registration.director_assigned`. The later workflow-adapters migration maps this same raw UUID exactly once to canonical `registration.director_assigned` without creating another raw row.

If the normalized recipient sets differ, increment bigint `recipient_revision` exactly once and enqueue exactly one job in the same transaction, using the captured raw source UUID:

```sql
dashboard_private.enqueue_notification_target_reconciliation_job_v1(
  'registration',
  'registration_appointment',
  appointment_id::text,
  notification_revision,
  director_assignment_source_event_id,
  'recipient_set_changed',
  recipient_revision,
  previous_target_set_hash,
  current_target_set_hash
)
```

Do not enqueue once per rule. A semantically unchanged assignment still records exactly the one raw domain-history event required by that command and creates no recipient generation/job. Add the target job's `{job_kind: 'target_reconciliation', job_id}` reference to the mutation result. The common target apply path cancels old-generation unattempted deliveries, marks claimed work for cancellation, revokes only unread sent inbox projections, and preserves sent delivery audit.

- [ ] **Step 5: Add preview/readiness RPCs and the final runtime marker, run tests, commit**

`preview_registration_appointment_reminders_v1(p_kind text, p_scheduled_at timestamptz, p_track_ids uuid[])` returns snake_case wire rows only for enabled/applicable future rounds as `{rule_id, rule_revision, variant_key, scheduled_for, audience_key, channel_key}` with `rule_revision` serialized as a decimal string. The service maps these once to camelCase. Restrict it to authorized admin/staff and expose no template body or recipient data.

Create `public.registration_appointment_reminders_runtime_version()` last, returning integer `1`, only after the column, registry seeds, evaluator/materialize/cancel/preview functions, all mutation replacements, and single-source-event director job wiring exist. Registration-scoped registry exposure, registration reminder production/shadow/dispatch, and visit target reconciliation require both this marker and `public.common_notification_control_plane_runtime_version() = 1`; missing/wrong versions fail closed. The later workflow-adapters runtime marker cannot substitute for either prerequisite.

Run the Step 1 command and authorized pgTAP suite. Expected: PASS, including two-session lock ordering and exact rollback behavior.

```bash
git add supabase/migrations/20260715103000_registration_appointment_reminder_producer.sql tests/registration-appointment-reminders.test.mjs tests/registration-track-schema.test.mjs supabase/tests/registration_subject_tracks_runtime_test.sql
git commit -m "feat: materialize registration appointment reminders"
```

### Task 6: Appointment Conflict, Confirmation, and Reminder Processing State

**Files:**
- Create: `src/features/tasks/registration-appointment-draft.ts`
- Modify: `src/features/tasks/registration-appointment-editor.tsx`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/registration-track-fixtures.ts`
- Test: `tests/registration-appointment-draft.test.mjs`
- Test: `tests/registration-consultation-notification.test.mjs`

**Interfaces:**
- Consumes `public.get_notification_orchestration_job_status_v1(p_job_kind text, p_job_id uuid) returns jsonb` and `public.retry_notification_orchestration_job_v1(p_job_kind text, p_job_id uuid, p_expected_attempt_count integer, p_request_id uuid) returns jsonb` from the common plan.
- Produces `compareRegistrationAppointmentDraft`, `rebaseRegistrationAppointmentDraft`, `buildRegistrationAppointmentConfirmation`, `previewRegistrationAppointmentReminders`, `getRegistrationNotificationJobStatus`, and `retryRegistrationNotificationJob` service calls.
- Does not import, mount, or replace `NotificationControlPanel`; the common plan owns `ops-task-workspace.tsx` launcher wiring, while registration contributes only the Task 5 registry rows and appointment-specific processing references/state.

- [ ] **Step 1: Write failing pure-model and source-contract tests**

Assert a 409 retains the local scheduled time/place/track IDs, comparison distinguishes server and local values, rebase occurs only on explicit `다시 적용`, confirmation includes old/new values and reminder-round counts, cancellation has confirmation but no mandatory reason, mutation responses retain opaque common job references, status uses the exact common getter, and retry uses the exact common attempt-checked RPC without replaying save/cancel.

Run:

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --experimental-strip-types --test tests/registration-appointment-draft.test.mjs tests/registration-consultation-notification.test.mjs
```

Expected: FAIL because `handleRevisionConflict` currently resets the authoritative draft and cancellation requires text.

- [ ] **Step 2: Implement stable draft/compare/rebase helpers**

Use immutable values:

```ts
export type RegistrationAppointmentDraft = {
  scheduledAt: string; place: string; trackIds: string[]; replaceRemaining: boolean
}
export type RegistrationAppointmentConflict = {
  local: RegistrationAppointmentDraft; server: OpsRegistrationAppointment
  serverTrackIds: string[]
}
```

On conflict, reload into `server` without mutating `local`; expose `최신 예약 비교`, `다시 적용`, and `계속 편집`. A new request key is generated only after reviewed rebase or a logical draft change.

- [ ] **Step 3: Separate canonical save from notification processing**

Before save/cancel, show appointment diffs and current preview rounds. After save, retain each returned `{job_kind, job_id}` reference and show `예약 저장됨 · 알림 재계산 중`. Poll each reference through `get_notification_orchestration_job_status_v1`; map only the safe response fields `job_kind`, `job_id`, `workflow_key`, `status`, `attempt_count`, `next_attempt_at`, `last_error_code`, `created_at`, and `completed_at` once into camelCase. Aggregate all succeeded jobs as `알림 재계산 완료`; if any job is failed, show `알림 재계산 실패 · 다시 시도`.

On a logical retry click, generate one `p_request_id` and retain it across transport retries, pass the latest status response's integer `attempt_count` as `p_expected_attempt_count`, and call `retry_notification_orchestration_job_v1` for that failed `fanout`, `rule_reconciliation`, or `target_reconciliation` row. The common RPC resumes the same row and preserves job ID, source-event ID, captured rule/source/target revisions, target generation, occurrence keys, cursor, and attempt count. Stale attempt, non-failed, claimed, succeeded, and nonretryable responses remain errors; registration never inserts/requeues a job locally or replays the appointment RPC. Keep existing immediate visit failed-target retry distinct.

Remove the cancellation textarea and pass `reason: ""` to the unchanged RPC until its forward replacement makes the parameter nullable internally.

- [ ] **Step 4: Preserve common launcher ownership and registration-only state**

Do not edit `ops-task-workspace.tsx`, add a registration launcher, or import/mount `NotificationControlPanel` in any Task 6 file. Task 5's closed registry rows, preset labels, and `현재 예약 알림이 발송되지 않습니다` state are the registration settings contribution; the common-owned launcher and panel render them through the shared get/save flow. Task 6 renders only appointment preview plus common job status/retry state inside the canonical appointment editor. The common panel continues to own settings draft conflicts and settings-save reconciliation UI.

- [ ] **Step 5: Run focused tests and commit**

Run the Step 1 command. Expected: PASS and existing immediate visit tests unchanged.

```bash
git add src/features/tasks/registration-appointment-draft.ts src/features/tasks/registration-appointment-editor.tsx src/features/tasks/registration-track-service.ts src/features/tasks/registration-track-fixtures.ts tests/registration-appointment-draft.test.mjs tests/registration-consultation-notification.test.mjs
git commit -m "feat: harden registration appointment editing"
```

### Task 7: Registration Common-Worker Adapter

**Files:**
- Create: `src/features/notifications/server/adapters/registration-notification-adapter.ts`
- Create: `tests/registration-notification-adapter.test.mjs`

**Interfaces:**
- Consumes: `DbBigInt`, `NotificationWorkflowAdapter`, `NotificationResolveInput`, `NotificationTargetSet`, `NotificationRevalidationInput`, `NotificationRevalidationResult`, `RuleReconciliationInput/Batch`, and `TargetReconciliationInput/Batch` from `src/features/notifications/server/notification-workflow-adapter.ts`.
- Produces: `registrationNotificationAdapter: NotificationWorkflowAdapter` for later registration by `notification-workflow-registry.ts`; this task must not edit that registry.

- [ ] **Step 1: Write failing direct adapter tests**

Cover one-rule-at-a-time level-test management targets, visit current-director target-set sorting/hash, decimal-string recipient generation, immutable target snapshots, missing/non-scheduled source, source revision mismatch, rule revision mismatch, recipient revoked, appointment reached, schedule invalid, and unsupported payload. Add paged rule-reconciliation drafts for KST occurrences and paged target-reconciliation batches for unchanged, A→B, and superseded B→A jobs. Assert adapter rejection/supersession performs no provider/apply call and never returns generic `stale`; common worker tests, not this adapter, own template rendering failures.

Run:

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --experimental-strip-types --test tests/registration-notification-adapter.test.mjs
```

Expected: FAIL on missing adapter.

- [ ] **Step 2: Implement target resolution and exact revalidation outcomes**

Export exactly:

```ts
export const registrationNotificationAdapter: NotificationWorkflowAdapter = {
  workflowKey: "registration",
  resolveTargets,
  revalidateBeforeSend,
  reconcileScheduledRules,
  reconcileTargets,
}
```

`resolveTargets` receives exactly one rule, maps appointment `recipient_revision` to `targetGeneration` without numeric conversion, and returns the normalized full-set hash. Return the common discriminated result exactly: `{ ok: false, status: "canceled", reason }` for `source_status_changed`, `source_schedule_changed`, `source_revision_changed`, `rule_revision_changed`, or `recipient_revoked`; `{ ok: false, status: "failed", reason }` for `retry_window_closed`, `schedule_validation_failed`, or `payload_schema_unsupported`. Only a fully current scheduled appointment yields `{ ok: true }`; the common renderer may independently close `render_validation_failed`.

`reconcileScheduledRules` pages canonical scheduled appointments in stable `(scheduled_at,id)` order and returns only source descriptors plus future `ScheduledOccurrenceDraft`s for the captured rule-revision map; it never writes an event/delivery. `reconcileTargets` rereads the live appointment/participants/directors and returns existing future event/rule items with the live recipient generation/hash. It does not force the job's captured generation onto current targets. The common apply RPC compares the returned set with the claimed job: a newer generation/hash makes the older job a successful superseded no-op, while a matching job cancels/revokes the prior generation and inserts exactly one current-generation set.

- [ ] **Step 3: Verify it compiles independently and commit**

Run the Step 1 command plus:

```bash
pnpm exec tsc --noEmit
```

Expected: PASS. Registry wiring intentionally waits for the later workflow-adapters plan.

```bash
git add src/features/notifications/server/adapters/registration-notification-adapter.ts tests/registration-notification-adapter.test.mjs
git commit -m "feat: add registration notification adapter"
```

### Task 8: Full Verification, Browser QA, and Controlled Cutover

**Files:**
- Modify: `scripts/verify-ops-task-browser-workflow.mjs`
- Modify: `scripts/verify-registration-subject-track-concurrency.mjs`
- Modify: `src/features/tasks/registration-track-fixtures.ts`
- Test: all registration Node and pgTAP suites.

**Interfaces:**
- Consumes: `?fixture=registration-subject-tracks`, Playwright desktop/mobile runners, and the common worker fixture adapters.
- Produces: deterministic no-provider QA for intake, history, calendar, conflicts, materialization, reconciliation, and delivery ambiguity.

- [ ] **Step 1: Add deterministic browser scenarios**

Extend the fixture with: split direct-phone/visit directors; a two-subject shared visit; same-day same-kind distinct appointments; all reminder cells disabled; enabled fixture cells; a stale-revision response; A→B→A recipient generations and hashes; an out-of-order superseded target job; a superseded rule-revision job; definite provider rejection; ambiguous timeout; failed rule and target reconciliation jobs. Keep the existing real-network `externalCallLedger` empty for every fixture run; record simulated provider acceptance, rejection, and timeout only in a separate in-memory fixture ledger.

- [ ] **Step 2: Run focused, full, lint, type, and build gates**

```bash
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE" --experimental-strip-types --test tests/registration*.test.mjs tests/ops-task-workspace.test.mjs
"$NODE" --experimental-strip-types --test tests/*.test.mjs
pnpm run lint
pnpm exec tsc --noEmit
pnpm run build
```

Expected: focused PASS; full suite exceeds the measured 1011-pass baseline with zero failures; lint, typecheck, and build PASS.

- [ ] **Step 3: Run local browser QA at desktop and mobile sizes**

```bash
OPS_BROWSER_WORKFLOW=1 OPS_BROWSER_BASE_URL=http://localhost:3000 pnpm run verify:ops-browser
```

Verify owner→visit time→room order, no phone picker, completion-only result URL, read-only actor/owner history, list/month/week/mobile agenda, deep-link restore, preserved conflict draft, disabled warning, exact future rounds, and reschedule/cancel/completion reconciliation. Require no console error, horizontal overflow, accessibility warning, or external call.

- [ ] **Step 4: Validate ephemeral database concurrency and worker behavior**

On an authorized preview database, run pgTAP plus the two-session concurrency script. Exercise common fan-out/rule/target claims, integer-number `notification_revision`, decimal-string `recipient_revision`/target-generation mapping, compare-and-swap reconciliation cursors, out-of-order supersession, target generation distinct from owner generation, atomic in-app projection/push children, delivery claim/begin/finalize, common operator status plus attempt-checked retry, lease reaping, exact cancellation reasons, one-minute/five-minute retry bounds, and `delivery_unknown` no-auto-resend behavior. Cron/pg_net must target a fixture endpoint and never a real provider.

- [ ] **Step 5: Prepare the later cutover handoff without enabling dispatch**

Deploy schema/code with every new flag false and verify both `public.common_notification_control_plane_runtime_version() = 1` and `public.registration_appointment_reminders_runtime_version() = 1`, deterministic materialization, adapter unit tests, exact single-raw-event director mapping, common status/retry behavior, and zero sends. Prove missing/wrong registration marker rejects registration registry exposure and shadow/dispatch/visit-target enablement even if the later adapter marker is present. Do not enable shadow or `notification_control_plane_dispatch_registration_enabled` yet because the worker composition route and ownership closure arrive in the following workflow-adapters plan. Hand off the exact registration fixture checks and flag matrix; leave core, phone, visit-immediate, and SOLAPI flags false until that plan completes its shadow comparison and same-release owner transfer.

- [ ] **Step 6: Commit verification support**

```bash
git add scripts/verify-ops-task-browser-workflow.mjs scripts/verify-registration-subject-track-concurrency.mjs src/features/tasks/registration-track-fixtures.ts
git commit -m "test: verify registration reminders end to end"
```

## Final Acceptance Gate

- Canonical create/edit contains no phone date/time and follows owner→time→place ordering.
- Every authoritative mutation produces same-transaction v2 history; automatic timeline is read-only and fallback is honestly labeled.
- One shared appointment becomes one exact calendar item; phone and legacy timestamps never appear; deep links restore the appointment.
- All reminder seeds are off; explicit settings save materializes only enabled, applicable, future KST rounds with stable occurrence identity.
- Reschedule/cancel/completion/director reassignment preserve revisions and delivery history exactly as specified.
- Integer `notification_revision` remains a TypeScript `number`; bigint `recipient_revision` alone is the appointment-side decimal-string revision/generation.
- Director reassignment captures one raw version-2 event UUID, reuses it for target reconciliation and canonical `registration.director_assigned` mapping, and never writes a duplicate raw event.
- Registration reminders remain closed unless both common and registration-reminder runtime markers equal `1`; adapter readiness alone is insufficient.
- Registration owns no common settings launcher, and appointment retry uses only the common status/retry RPCs without replaying canonical mutations.
- A→B→A director changes create monotonic recipient generations, supersede stale jobs, and never reopen a terminal A delivery.
- Common workers preserve claims, leases, retries, unknown outcomes, manual reconciliation, security, and ownership guarantees.
- Immediate visit, phone, and SOLAPI behavior remains unchanged until their separately flagged adapter cutovers.
