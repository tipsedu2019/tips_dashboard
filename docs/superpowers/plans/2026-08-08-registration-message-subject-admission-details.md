# Registration Message Subject Scope and Admission Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 등록 고객 알림톡이 현재 단계에 실제 참여하는 과목만 표시하고, 입학 알림에 권위 있는 정규 수업 정보와 강조된 첫 수업일을 안내하며, 모든 템플릿 마지막에 ChannelTalk 문의 버튼을 제공하도록 만든다.

**Architecture:** 브라우저는 계속 `{ messageKind, sourceId }`만 보내고, service-role 전용 Supabase canonical resolver가 workflow·예약·등록·수업 일정 원본을 매 요청마다 다시 판정한다. TypeScript source normalizer가 DB JSON을 엄격히 검증해 renderer 한 곳에 전달하고, renderer가 실제 SOLAPI 변수·본문·버튼과 운영자용 안전한 미리보기 facts를 동시에 만든다. 미리보기와 발송 사이에는 기존 fingerprint·one-time lock·provider attempt marker를 유지하며, 자동 리마인드에서 대상 과목이 사라진 경우에만 provider 0회 terminal `source_ineligible`로 종료한다.

**Tech Stack:** Next.js App Router, React, TypeScript, Node test runner, Supabase Postgres/PLpgSQL/pgTAP, `@supabase/supabase-js`, SOLAPI AlimTalk, Vercel Git integration

## Global Constraints

- 예약 안내와 리마인드의 발송 identity는 기존 `appointment_id` 한 건을 유지한다. 과목별 메시지로 분리하지 않는다.
- 레벨테스트 과목은 `workflow_status = 'level_test_requested'`이면서 같은 예약에 `scheduled|in_progress` 레벨테스트 activity가 있는 track만 포함한다.
- 방문상담 과목은 `workflow_status = 'consultation_requested'`이면서 같은 예약에 `mode = 'visit'`, `status = 'scheduled'` consultation이 있는 track만 포함한다.
- 레벨테스트·방문상담·리마인드에서 조건을 만족하는 과목이 여러 개면 `영어 · 수학 · 과학` 순서로 한 메시지에 묶고, 조건을 만족하지 않는 형제 과목은 제외한다.
- 대기 안내는 기존 `track_id` 한 건과 단일 과목 계약을 유지한다.
- 입학 안내는 기존 `task_id` 한 건당 한 번을 유지하며, `workflow_status = 'enrollment_requested'`, enrollment `status = 'planned'`, `admission_batch_id IS NULL`인 실제 등록 예정 수업만 포함한다.
- 정규화 일정은 `public.continuous_class_schedule_runtime_version() = 1`이고 해당 반의 `schedule_storage_mode = 'normalized'`일 때만 권위가 있다. 나머지는 모두 legacy 권위를 사용한다.
- normalized 첫 수업은 동일 class의 `class_start_lesson_session_id`, `schedule_state IN ('active','makeup')`, 유효한 시작·종료 시간쌍을 모두 만족해야 한다.
- legacy 첫 수업은 저장된 날짜·session key와 정확히 일치하는 schedule-plan session을 사용한다. session 시간이 없을 때만 예외·보강이 아니고 같은 요일의 반복 slot 후보가 정확히 한 개일 경우 그 시간을 사용한다.
- 반명, 반복 요일·시간, 선생님, 강의실, 첫 수업일이 하나라도 없거나 모호하면 미리보기와 provider 호출을 차단한다.
- `textbook_id IS NULL`은 차단하지 않고 `선택 안 함(이미 보유)`로 표시한다.
- 입학 수업 블록 순서는 과목 → `enrollment.sort_order` → 반명 → enrollment UUID이며, 각 블록은 `과목/수업`, `교재`, `요일/시간`, `선생님`, `강의실`, 빈 줄, `첫 수업일` 순서다.
- 본문에는 `자세한 수업 일정은 학원 홈페이지에서 확인해 주세요.`를 포함하고 별도 홈페이지 버튼은 만들지 않는다.
- 다섯 템플릿의 마지막 버튼은 `문의하기`, `WL`, mobile/PC 모두 `https://tipsedu.channel.io`다.
- 버튼 순서는 예약 3종 `학원 위치 보기` → `문의하기`, 대기 `문의하기`, 입학 `입학신청서 작성` → `문의하기`다.
- 치환 완료 본문은 공백과 줄바꿈을 포함해 Unicode code point 1,000자를 넘을 수 없다. 초과 시 자르지 않고 차단한다.
- 다섯 템플릿의 revision을 모두 올리고 기존 승인 템플릿을 수정하지 않는다. 새 템플릿 5종을 등록해 재승인받는다.
- raw source와 canonical source에 workflow revision, appointment notification revision, enrollment/class/textbook/session/slot material facts, runtime version, storage mode, authority, revision/hash를 포함한다.
- 미리보기 뒤 위 material fact가 하나라도 바뀌면 readiness/attempt 경계에서 `source_dirty` 또는 동등한 preview-stale conflict로 차단하고 provider 호출은 0회다.
- 기존 `미리보기 → 확인 후 발송`, 문자 대체발송 금지(`disableSms = true`), 한 번 발송 잠금, provider 불확실 상태 자동 재전송 금지를 유지한다.
- 새 템플릿 승인과 exact preflight가 끝나기 전 provider 호출은 0회다.
- 실제 고객 발송과 자동 리마인드 ON은 이 구현·배포 승인에 포함하지 않는다. 별도 명시적 사용자 승인 전에는 실행하지 않는다.
- 새 DB 객체는 forward-only migration으로만 추가·교체한다. 기존 migration 파일은 수정하지 않는다.
- `security definer` 함수는 `set search_path = ''`, 완전 수식 relation, 기본 PUBLIC execute 회수, 필요한 `service_role` grant만 사용한다.
- public DTO에는 전체 전화번호, enrollment/track/class/session/slot UUID, source fingerprint, provider ID, credential을 노출하지 않는다.

---

## File Responsibility Map

- `src/features/tasks/server/registration-customer-message-catalog.ts`: 다섯 템플릿의 exact body/variables/buttons/revisions, 입학 수업 블록 포맷, KST 날짜·시간 포맷, 본문 1,000자 검증의 단일 권위.
- `src/features/tasks/server/registration-customer-message-source.ts`: DB raw source exact-shape 검증, appointment participant와 admission enrollment plan 정규화, private canonical source/fingerprint, public safe facts 생성.
- `src/features/tasks/registration-customer-message-contract.ts`: 브라우저에 허용되는 입학 미리보기 facts 타입과 exact public key allowlist.
- `src/features/tasks/registration-customer-message-errors.ts`: API·source·template 오류 코드를 운영자가 이해할 수 있는 한국어 행동 문구로 바꾸는 browser-safe 순수 함수.
- `src/features/tasks/registration-customer-message-service.ts`: 기존 strict request DTO를 유지하며 HTTP 오류 code를 보존한다.
- `src/features/tasks/registration-alimtalk-preview-dialog.tsx`: 실제 본문과 별도로 수업별 검증 facts를 같은 순서로 표시하고 각 `첫 수업일` 행을 마지막에 강조한다.
- `src/features/tasks/registration-track-fixtures.ts`: fixture mode 입학 미리보기에도 새 public facts shape를 제공한다.
- `src/features/tasks/server/registration-customer-message-route.ts`: DB/normalizer의 안전한 source 오류를 구분해 public code로 반환하고, send 직전 변경은 안전한 conflict로 유지한다.
- `src/features/tasks/server/registration-customer-reminder-worker.ts`: 대상 과목 없음만 terminal skip으로 분리하고 나머지 pre-send 장애는 기존 hold/retry 정책을 유지한다.
- `src/features/tasks/server/registration-customer-reminder-route.ts`: reminder source RPC의 exact ineligible 오류를 typed terminal error로 변환한다.
- CLI가 생성하는 `supabase/migrations/*_registration_customer_message_subject_admission_details.sql`: private source helper/resolver 교체와 reminder `source_ineligible` terminal release를 담는 유일한 forward migration.
- `supabase/tests/registration_customer_solapi_messages_test.sql`: workflow 교집합, normalized/legacy 수업 권위, stale fingerprint, 권한, terminal reminder 상태를 실제 DB에서 검증한다.
- `scripts/run-registration-customer-solapi-local-db-qa.mjs`: disposable DB seed를 새 admission source 필수 사실에 맞추고 provider-zero concurrency QA를 유지한다.
- `tests/registration-customer-message-catalog.test.mjs`: exact 템플릿 copy/버튼/revision/입학 포맷/길이 제한.
- `tests/registration-customer-message-source.test.mjs`: raw exact shape, 정렬, private/public 경계, material-fact fingerprint.
- `tests/registration-customer-message-contract.test.mjs`: 새 public facts 허용과 private ID 거절.
- `tests/registration-customer-message-route.test.mjs`: source 오류 code, source-dirty send 차단, provider 0회.
- `tests/registration-customer-message-service.test.mjs`: HTTP code 보존과 browser-owned payload 금지.
- `tests/registration-alimtalk-preview-dialog.test.mjs`: 수업 facts 순서, 첫 수업일 강조, 한국어 오류, 중첩 dialog z-index.
- `tests/registration-customer-reminder-worker.test.mjs`: source ineligible terminal skip과 provider 0회.
- `tests/registration-customer-reminder-route.test.mjs`: production source RPC 오류 분류와 기존 bounded `.retry(false)` 호출.
- `tests/registration-customer-message-solapi.test.mjs`: 새 버튼 배열을 provider payload에 exact 전달하고 `disableSms = true` 유지.
- `tests/registration-customer-solapi-db.test.mjs`: 새 migration 구조·grant·SQL behavior packet 존재를 정적 검증.

---

### Task 1: Canonical Template Catalog and Admission Formatter

**Files:**
- Modify: `src/features/tasks/server/registration-customer-message-catalog.ts:9-253,470-580`
- Modify: `tests/registration-customer-message-catalog.test.mjs:19-440`
- Modify: `tests/registration-customer-message-solapi.test.mjs:80-170`

**Interfaces:**
- Consumes: 기존 `RegistrationCustomerMessageKind`, 기존 place-aware Naver button, MakeEdu 원본 입학신청서 URL.
- Produces: `RegistrationCustomerMessageAdmissionPlan`, `RegistrationCustomerMessageAdmissionScheduleSlot`, `RegistrationCustomerMessageFirstLesson`, `formatRegistrationCustomerMessageAdmissionPlans(plans)`, `renderRegistrationCustomerMessage(...)`의 `facts.admissionPlans`와 새 template checksums.

- [ ] **Step 1: exact 템플릿·입학 포맷 RED 테스트를 작성한다**

`tests/registration-customer-message-catalog.test.mjs`의 기존 body 상수를 승인 copy로 교체하고 다음 fixture와 assertion을 추가한다.

```js
const ENGLISH_PLAN = Object.freeze({
  enrollmentId: "00000000-0000-4000-8000-000000000101",
  subject: "영어",
  sortOrder: 0,
  className: "중2 영어 A반",
  textbookName: "능률 VOCA",
  slots: Object.freeze([
    Object.freeze({ weekday: 1, startTime: "18:00", endTime: "20:00", teacherName: "홍길동", classroomName: "본관 301호" }),
    Object.freeze({ weekday: 3, startTime: "18:00", endTime: "20:00", teacherName: "홍길동", classroomName: "본관 301호" }),
  ]),
  firstLesson: Object.freeze({ sessionDate: "2026-08-17", startTime: "18:00", endTime: "20:00" }),
})

const admission = renderRegistrationCustomerMessage({
  kind: "admission_application",
  facts: { studentName: "김팁스", subjects: ["영어"], enrollmentPlans: [ENGLISH_PLAN] },
})

assert.equal(admission.variables["#{등록수업안내}"], `과목/수업: [영어] 중2 영어 A반
교재: 능률 VOCA
요일/시간: 월·수 오후 6:00–8:00
선생님: 홍길동
강의실: 본관 301호

첫 수업일: 8월 17일 월요일 오후 6:00–8:00`)
assert.match(admission.body, /\[등록 수업 정보\]\n과목\/수업: \[영어\] 중2 영어 A반/u)
assert.match(admission.body, /자세한 수업 일정은 학원 홈페이지에서 확인해 주세요\./u)
assert.deepEqual(admission.buttons.map(({ name }) => name), ["입학신청서 작성", "문의하기"])
```

같은 테스트에 다음 exact 계약을 추가한다.

```js
assert.equal(REGISTRATION_CUSTOMER_MESSAGE_CATALOG_REVISION, 4)
assert.deepEqual(REGISTRATION_CUSTOMER_MESSAGE_TEMPLATE_REVISIONS, {
  level_test_booking: 3,
  visit_consultation_booking: 3,
  appointment_reminder: 3,
  waiting_notice: 2,
  admission_application: 3,
})
for (const entry of Object.values(catalog.templates)) {
  assert.equal(entry.buttons.at(-1)?.name, "문의하기")
  assert.equal(entry.buttons.at(-1)?.linkMobile, "https://tipsedu.channel.io")
  assert.equal(entry.buttons.at(-1)?.linkPc, "https://tipsedu.channel.io")
}
```

복수 수업 정렬, `textbookName: null`, 서로 다른 요일별 teacher/classroom, 1,001자 초과도 별도 test case로 추가한다.

```js
assert.throws(
  () => renderRegistrationCustomerMessage({
    kind: "admission_application",
    facts: { studentName: "김팁스", subjects: ["영어"], enrollmentPlans: [{ ...ENGLISH_PLAN, className: "가".repeat(1001) }] },
  }),
  { message: "registration_customer_message_body_too_long" },
)
```

- [ ] **Step 2: catalog 테스트가 의도한 이유로 실패하는지 확인한다**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test \
  tests/registration-customer-message-catalog.test.mjs \
  tests/registration-customer-message-solapi.test.mjs
```

Expected: catalog revision/body/button assertions와 `등록수업안내` formatter 부재 assertion만 FAIL하고 기존 no-SMS/provider tests는 PASS.

- [ ] **Step 3: canonical admission 타입과 순수 formatter를 구현한다**

`registration-customer-message-catalog.ts`에 다음 exact 타입을 추가한다.

```ts
export type RegistrationCustomerMessageAdmissionScheduleSlot = Readonly<{
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6
  startTime: string
  endTime: string
  teacherName: string
  classroomName: string
}>

export type RegistrationCustomerMessageFirstLesson = Readonly<{
  sessionDate: string
  startTime: string
  endTime: string
}>

export type RegistrationCustomerMessageAdmissionPlan = Readonly<{
  enrollmentId: string
  subject: RegistrationCustomerMessageSubject
  sortOrder: number
  className: string
  textbookName: string | null
  slots: ReadonlyArray<RegistrationCustomerMessageAdmissionScheduleSlot>
  firstLesson: RegistrationCustomerMessageFirstLesson
}>
```

`RegistrationCustomerMessageCanonicalFacts`에 `enrollmentPlans?: ReadonlyArray<RegistrationCustomerMessageAdmissionPlan>`을, 변수 union에 `"등록수업안내"`를 추가한다. 시간은 `HH:MM` strict parser로 검증하고 `오전/오후 h:mm`으로 표시한다. weekday 정렬은 `[1,2,3,4,5,6,0]`을 사용한다.

요일/시간은 같은 시작·종료 시간의 요일을 묶는다. teacher/classroom이 전 slot에서 같으면 한 번만 쓰고, 다르면 같은 값의 요일을 묶어 `월 홍길동 · 수 김길동` 형태로 만든다. 입학 plan은 다음 comparator로 복사 정렬한다.

```ts
const compareCodePointText = (left: string, right: string) => (
  left < right ? -1 : left > right ? 1 : 0
)
const sorted = [...plans].sort((left, right) => (
  SUBJECT_ORDER.indexOf(left.subject) - SUBJECT_ORDER.indexOf(right.subject)
  || left.sortOrder - right.sortOrder
  || compareCodePointText(left.className, right.className)
  || compareCodePointText(left.enrollmentId, right.enrollmentId)
))
```

각 block은 다음 코드로 만들고 `\n\n`으로 연결한다.

```ts
return [
  `과목/수업: [${plan.subject}] ${className}`,
  `교재: ${plan.textbookName ? requiredText(plan.textbookName, "registration_customer_message_textbook_invalid") : "선택 안 함(이미 보유)"}`,
  `요일/시간: ${formatRecurringSchedule(plan.slots)}`,
  `선생님: ${formatSlotAssignment(plan.slots, "teacherName")}`,
  `강의실: ${formatSlotAssignment(plan.slots, "classroomName")}`,
  "",
  `첫 수업일: ${formatFirstLesson(plan.firstLesson)}`,
].join("\n")
```

- [ ] **Step 4: 다섯 새 템플릿과 버튼을 exact catalog에 고정한다**

catalog revision은 `4`, template revisions는 `3/3/3/2/3`으로 올린다. 고정 문의 버튼을 한 객체로 만들고 모든 배열의 마지막에 넣는다.

```ts
const CONTACT_BUTTON = Object.freeze({
  name: "문의하기",
  type: "WL" as const,
  linkMobile: "https://tipsedu.channel.io",
  linkPc: "https://tipsedu.channel.io",
})
```

입학 템플릿 변수는 정확히 `학생명`, `등록수업안내` 두 개다. 예약 3종의 마지막 문구는 `일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.`이고, 대기/입학 마지막 문의 문구는 `변동사항 및 문의는 아래 문의하기 버튼을 이용해 주세요.`다. rendered body 생성 직후 다음 guard를 둔다.

```ts
if (Array.from(body).length > 1_000) {
  catalogError("registration_customer_message_body_too_long")
}
```

- [ ] **Step 5: catalog/SOLAPI 테스트를 GREEN으로 만든다**

Run: Step 2와 동일.

Expected: 모든 test PASS. SOLAPI adapter request는 `disableSms: true`이고 새 buttons 배열 순서를 그대로 보존한다.

- [ ] **Step 6: Task 1을 커밋한다**

```bash
git add \
  src/features/tasks/server/registration-customer-message-catalog.ts \
  tests/registration-customer-message-catalog.test.mjs \
  tests/registration-customer-message-solapi.test.mjs
git diff --cached --check
git commit -m "feat: render scoped admission message details"
```

---

### Task 2: Strict Canonical Source and Public Contract

**Files:**
- Modify: `src/features/tasks/server/registration-customer-message-source.ts:16-490`
- Modify: `src/features/tasks/registration-customer-message-contract.ts:81-99,214-258`
- Modify: `tests/registration-customer-message-source.test.mjs:12-352`
- Modify: `tests/registration-customer-message-contract.test.mjs:213-304`

**Interfaces:**
- Consumes: Task 1의 `RegistrationCustomerMessageAdmissionPlan`과 renderer.
- Produces: strict raw `participants`, `tracks`, `enrollmentPlans` parser; public `RegistrationCustomerMessageAdmissionPreviewPlan`; private canonical source에 모든 material facts; public preview에는 label만 남긴다.

- [ ] **Step 1: appointment participant와 admission source RED fixture를 작성한다**

기존 `appointmentSource()`의 subjects를 `subjects: ["수학", "영어", "영어"]`로 바꾸고 다음 exact participant를 넣는다. 별도 variant에 과학 subject만 추가해 `subjects`와 participant subject가 불일치하면 reject하는 test를 추가한다.

```js
participants: [
  {
    trackId: IDS.englishTrack,
    subject: "영어",
    workflowStatus: "level_test_requested",
    workflowRevision: 7,
    activityId: "00000000-0000-4000-8000-000000000110",
    activityStatus: "scheduled",
  },
  {
    trackId: IDS.mathTrack,
    subject: "수학",
    workflowStatus: "level_test_requested",
    workflowRevision: 8,
    activityId: "00000000-0000-4000-8000-000000000111",
    activityStatus: "in_progress",
  },
],
```

기존 `admissionSource()`는 다음 exact track과 raw plan을 갖도록 교체한다.

```js
tracks: [{
  trackId: IDS.englishTrack,
  subject: "영어",
  workflowStatus: "enrollment_requested",
  workflowRevision: 3,
  pipelineStatus: "enrollment_decided",
}],
```

```js
enrollmentPlans: [{
  enrollmentId: "00000000-0000-4000-8000-000000000120",
  trackId: IDS.englishTrack,
  subject: "영어",
  sortOrder: 0,
  workflowStatus: "enrollment_requested",
  workflowRevision: 3,
  enrollmentUpdatedAt: "2026-08-08T00:00:00.000000Z",
  classId: IDS.class,
  classSubject: "영어",
  className: "중2 영어 A반",
  classUpdatedAt: "2026-08-08T00:00:01.000000Z",
  textbookId: null,
  textbookName: null,
  textbookUpdatedAt: null,
  runtimeVersion: 0,
  storageMode: "legacy",
  authority: "legacy",
  scheduleRevision: 4,
  scheduleHash: "a".repeat(64),
  slots: [
    { slotId: null, weekday: 1, startTime: "18:00", endTime: "20:00", teacherName: "홍길동", classroomName: "본관 301호", sortOrder: 0, updatedAt: null },
    { slotId: null, weekday: 3, startTime: "18:00", endTime: "20:00", teacherName: "홍길동", classroomName: "본관 301호", sortOrder: 1, updatedAt: null },
  ],
  firstLesson: {
    sessionId: null,
    sessionKey: "2026-08-17:1",
    sessionDate: "2026-08-17",
    scheduleState: "active",
    startTime: "18:00",
    endTime: "20:00",
    revision: null,
    updatedAt: null,
  },
}],
```

다음 변경마다 `sourceFingerprint`와 `sourceFactsChecksum`이 달라지는 assertion을 추가한다: participant workflow revision, enrollment sort order, class name, textbook name/null, runtime version, storage mode, authority, schedule revision/hash, slot weekday/time/teacher/classroom, first lesson date/time/revision.

- [ ] **Step 2: public DTO privacy RED 테스트를 작성한다**

`RegistrationCustomerMessagePreviewResponse["facts"]`에 다음 browser-safe 배열만 허용한다.

```ts
export type RegistrationCustomerMessageAdmissionPreviewPlan = Readonly<{
  subjectLabel: string
  className: string
  textbookLabel: string
  scheduleLabel: string
  teacherLabel: string
  classroomLabel: string
  firstLessonLabel: string
}>
```

테스트 payload에는 `admissionPlans`를 추가해 guard가 허용함을 확인하고, 다음 모든 key를 각각 주입해 guard가 거절하는지 확인한다.

```js
for (const forbiddenField of [
  "enrollmentId", "trackId", "classId", "textbookId", "sessionId", "slotId",
  "workflowRevision", "scheduleRevision", "scheduleHash", "sourceFingerprint",
]) {
  assert.throws(
    () => contract.assertRegistrationCustomerMessagePublicPayload({ ...preview, [forbiddenField]: "private" }),
    /registration_customer_message_public_payload_forbidden_field/,
  )
}
```

- [ ] **Step 3: source/contract RED를 확인한다**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test \
  tests/registration-customer-message-source.test.mjs \
  tests/registration-customer-message-contract.test.mjs
```

Expected: participant/enrollment parser와 새 public key가 없어 FAIL. 기존 phone/HMAC/private-source tests는 PASS.

- [ ] **Step 4: nested exact-shape parser를 구현한다**

`registration-customer-message-source.ts`에 `hasExactKeys`, strict date/time/hash/timestamp/nonnegative integer parser를 추가한다. appointment participant는 exact key 6개만 허용하고 kind별 expected workflow/activity status를 검증한다. 정렬된 participant subjects와 top-level `subjects`가 exact equality가 아니면 `registration_customer_message_subject_invalid`로 차단한다.

admission plan은 위 raw shape의 key만 허용한다. `classSubject`는 plan/track subject와 exact match해야 한다. 다음 불변식을 모두 확인한다.

```ts
if (plan.workflowStatus !== "enrollment_requested" || plan.classSubject !== plan.subject) sourceError("registration_customer_message_admission_plan_invalid")
if (plan.authority === "normalized" && !(plan.runtimeVersion === 1 && plan.storageMode === "normalized")) sourceError("registration_customer_message_admission_plan_invalid")
if (plan.authority === "legacy" && plan.runtimeVersion === 1 && plan.storageMode === "normalized") sourceError("registration_customer_message_admission_plan_invalid")
if (plan.slots.length === 0) sourceError("registration_customer_message_admission_schedule_incomplete")
if (plan.authority === "normalized" && (!plan.firstLesson.sessionId || plan.firstLesson.revision === null)) sourceError("registration_customer_message_admission_plan_invalid")
if (plan.authority === "legacy" && (plan.firstLesson.sessionId !== null || plan.firstLesson.revision !== null)) sourceError("registration_customer_message_admission_plan_invalid")
```

top-level `tracks`는 `enrollment_requested` track만 허용하고, `subjects`는 enrollment plan의 unique subject와 exact match여야 한다. enrollment plan의 `trackId`, `subject`, `workflowRevision`은 대응 track과 exact match여야 한다. canonical facts에는 Task 1 renderer에 필요한 display data만 넣고, canonical source에는 normalized private plan 전체를 넣는다.

- [ ] **Step 5: public contract allowlist를 최소 확장한다**

`facts`에 `admissionPlans?: ReadonlyArray<RegistrationCustomerMessageAdmissionPreviewPlan>`을 추가하고 global public key set에는 다음 이름만 추가한다.

```ts
"admissionPlans",
"className",
"classroomLabel",
"firstLessonLabel",
"teacherLabel",
"textbookLabel",
```

`subjectLabel`과 `scheduleLabel`은 기존 key를 재사용한다. source resolver는 rendered `facts.admissionPlans`만 public source에 복사한다. 전체 raw plan과 UUID는 `PRIVATE_SOURCES` WeakMap 밖으로 내보내지 않는다.

- [ ] **Step 6: source/contract 테스트를 GREEN으로 만든다**

Run: Step 3과 동일.

Expected: 모든 test PASS. `JSON.stringify(publicSource)`에서 phone, hash, provider/template IDs와 모든 enrollment/track/class/session/slot ID가 검색되지 않는다.

- [ ] **Step 7: Task 2를 커밋한다**

```bash
git add \
  src/features/tasks/server/registration-customer-message-source.ts \
  src/features/tasks/registration-customer-message-contract.ts \
  tests/registration-customer-message-source.test.mjs \
  tests/registration-customer-message-contract.test.mjs
git diff --cached --check
git commit -m "feat: validate registration message source facts"
```

---

### Task 3: Forward-Only Canonical Resolver Migration and Disposable DB Proof

**Files:**
- Create via Supabase CLI: `supabase/migrations/*_registration_customer_message_subject_admission_details.sql`
- Modify: `supabase/tests/registration_customer_solapi_messages_test.sql:643-979,1016-1122,1531-1579`
- Modify: `scripts/run-registration-customer-solapi-local-db-qa.mjs:688-760`
- Modify: `tests/registration-customer-solapi-db.test.mjs:1-45,840-940,1130-1226`

**Interfaces:**
- Consumes: Task 2 raw source exact shape and existing public RPC signature `resolve_registration_customer_message_source_v1(uuid,text,uuid)`.
- Produces: replacement `dashboard_private.resolve_registration_customer_message_source_v1_impl(text,uuid)`, helpers `registration_customer_message_legacy_slots_v1(text,text,text)` and `registration_customer_message_admission_plan_v1(uuid,integer)`, terminal semantics in existing `release_registration_customer_reminder_job_v1(uuid,uuid,text)`.

- [ ] **Step 1: 새 migration 파일을 CLI로 생성한다**

Supabase CLI command를 추측하지 말고 먼저 help/version을 확인한다.

```bash
supabase --version
supabase migration new --help
supabase migration new registration_customer_message_subject_admission_details
MIGRATION_PATH="$(rg --files supabase/migrations | rg '_registration_customer_message_subject_admission_details\.sql$' | sort | tail -1)"
test -n "$MIGRATION_PATH"
```

이 migration 이외의 기존 migration SQL은 수정하지 않는다.

- [ ] **Step 2: DB 구조 RED 테스트를 먼저 작성한다**

`tests/registration-customer-solapi-db.test.mjs`가 suffix로 새 migration을 정확히 한 개 찾고 다음을 검증하게 한다.

```js
assert.match(normalized, /create or replace function dashboard_private\.resolve_registration_customer_message_source_v1_impl\(p_message_kind text, p_source_id uuid\)/)
assert.match(normalized, /track\.workflow_status = 'level_test_requested'/)
assert.match(normalized, /track\.workflow_status = 'consultation_requested'/)
assert.match(normalized, /public\.continuous_class_schedule_runtime_version\(\) = 1[^;]+schedule_storage_mode = 'normalized'/)
assert.match(normalized, /registration_customer_message_source_ineligible/)
assert.match(normalized, /registration_customer_message_admission_schedule_incomplete/)
assert.match(normalized, /when v_error_code = 'source_ineligible' then 'canceled'/)
assert.doesNotMatch(normalized, /\bdrop\s+(?:table|column|constraint)\b|\btruncate\b/)
```

- [ ] **Step 3: DB 정적 테스트가 migration body 부재로 실패하는지 확인한다**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test \
  tests/registration-customer-solapi-db.test.mjs
```

Expected: 새 helper/resolver/workflow/release assertions만 FAIL.

- [ ] **Step 4: legacy slot helper를 구현한다**

`dashboard_private.registration_customer_message_legacy_slots_v1(p_schedule,p_teacher,p_room)`는 `월화수목금토일`, `HH:MM-HH:MM` 형식만 받아 weekday별 row로 확장한다. teacher/room이 비어 있거나 schedule을 전부 해석하지 못하거나 `start_time >= end_time`이면 `registration_customer_message_admission_schedule_incomplete`를 `22023`으로 발생시킨다. 결과는 다음 shape로 weekday/start time 정렬한다.

```sql
pg_catalog.jsonb_build_object(
  'slotId', null,
  'weekday', v_weekday,
  'startTime', v_start_time,
  'endTime', v_end_time,
  'teacherName', pg_catalog.btrim(p_teacher),
  'classroomName', pg_catalog.btrim(p_room),
  'sortOrder', v_sort_order,
  'updatedAt', null
)
```

- [ ] **Step 5: enrollment 한 행의 권위 facts helper를 구현한다**

`dashboard_private.registration_customer_message_admission_plan_v1(p_enrollment_id,p_runtime_version)`는 enrollment/track/class/textbook을 한 번 읽고 `FOR SHARE`로 잠근다. 공통 조건은 `track.workflow_status = 'enrollment_requested'`, enrollment `planned`, unbatched, class name과 start date/session key 존재다.

normalized 분기는 runtime 1 + storage normalized일 때만 선택한다.

```sql
select session.* into v_session
from public.class_lesson_sessions session
where session.id = v_enrollment.class_start_lesson_session_id
  and session.class_id = v_enrollment.class_id
  and session.session_date = v_enrollment.class_start_date
  and session.session_key = v_enrollment.class_start_session_key
  and session.schedule_state in ('active', 'makeup')
  and session.start_time is not null
  and session.end_time is not null
  and session.start_time < session.end_time
for share;
```

반복 slot은 `class_schedule_slots`에서 class별로 읽고 nonblank teacher/classroom과 valid time을 요구한다. legacy 분기는 normalized table을 읽지 않고 `classes.schedule`, `classes.teacher`, `classes.room`, `classes.schedule_plan`만 사용한다. exact legacy session에 valid explicit time이 있으면 사용하고, 시간이 없으면 state가 `active|normal`이고 해당 weekday의 parsed recurring slot이 정확히 한 개일 때만 유도한다. `exception|makeup`이면서 explicit time이 없거나 후보가 0/2개 이상이면 차단한다.

최종 JSON은 Task 2 raw plan key를 모두 exact하게 만들고, `scheduleHash`는 권위 원본만 canonical JSON으로 해시한다.

```sql
dashboard_private.notification_sha256_hex_v1(
  dashboard_private.notification_canonical_json_v1(
    case when v_authority = 'normalized'
      then pg_catalog.jsonb_build_object('slots', v_slots, 'firstLesson', v_first_lesson)
      else pg_catalog.jsonb_build_object('schedule', v_class.schedule, 'schedulePlan', v_class.schedule_plan, 'teacher', v_class.teacher, 'room', v_class.room)
    end
  )
)
```

- [ ] **Step 6: private canonical resolver를 교체한다**

appointment branch는 activity와 track의 교집합으로 `participants`와 `subjects`를 동시에 만든다. level-test는 `track.workflow_status = 'level_test_requested'`, visit은 `track.workflow_status = 'consultation_requested'`를 SQL predicate에 포함한다. participant JSON에는 track/activity IDs, subject, workflow status/revision, activity status만 넣고 stable subject/UUID 순으로 정렬한다. 결과가 0개면 `registration_customer_message_source_ineligible`을 `22023`으로 발생시킨다.

admission branch는 다음 eligibility query로 enrollment IDs를 고정한 뒤 helper 결과를 aggregate한다.

```sql
where track.task_id = v_task_id
  and track.workflow_status = 'enrollment_requested'
  and enrollment.status = 'planned'
  and enrollment.admission_batch_id is null
order by
  case track.subject when '영어' then 1 when '수학' then 2 when '과학' then 3 end,
  enrollment.sort_order,
  class.name collate "C",
  enrollment.id
```

한 행도 없거나 권위 facts가 불완전하면 `registration_customer_message_admission_schedule_incomplete`로 차단한다. `registration_customer_message_source_ineligible`은 예약/리마인드에서 현재 단계의 참여 과목이 0개인 경우에만 사용한다. public wrapper signature/권한은 유지한다.

- [ ] **Step 7: reminder terminal release를 같은 forward migration에 구현한다**

기존 RPC signature를 `create or replace`하고 `p_error_code = 'source_ineligible'`일 때만 claimed job을 terminal `canceled`, `available_at = NULL`, `last_error_code = 'source_ineligible'`로 바꾼다. 다른 오류는 기존대로 `pending`, 5분 뒤 재시도다. `message_id IS NULL`, claim token, claim state guard는 그대로 유지한다.

- [ ] **Step 8: pgTAP fixture를 새 규칙에 맞추고 RED behavior를 추가한다**

기존 waiting class는 그대로 둔다. `enrollment_requested` 수학 track 전용 class `95000000-0000-4000-8000-000000000021`을 별도로 만들고 enrollment를 그 class로 옮긴다. 새 class는 기존 fixture class의 필수 column 값을 복제하되 `name = '중2 수학 A반'`, `subject = '수학'`, `grade = '중2'`로 저장한다. 다음 legacy 권위 facts를 새 class에 저장한다.

```sql
update public.classes
set schedule = '월수 18:00-20:00',
    teacher = '홍길동',
    room = '본관 301호',
    schedule_plan = '{"sessions":[{"date":"2026-08-17","sessionNumber":1,"scheduleState":"active","startTime":"18:00","endTime":"20:00"}]}'::jsonb,
    schedule_storage_mode = 'legacy',
    schedule_revision = 4
where id = '95000000-0000-4000-8000-000000000021';
```

enrollment의 `track_id`는 `95000000-0000-4000-8000-000000000541`, `class_id`는 `95000000-0000-4000-8000-000000000021`로 바꾸고 `class_start_date = '2026-08-17'`, `class_start_session_key = '2026-08-17:1'`, `class_start_session = '1회차'`를 저장한다. 다음 behavior를 pgTAP으로 추가한다.

- 두 level-test track이 모두 level stage면 subjects 두 개.
- sibling track을 consultation stage로 바꾸면 level source에서 즉시 제외되고 기존 preview가 stale.
- visit도 동일한 workflow 교집합.
- admission source의 `enrollmentPlans` exact key와 stable order.
- runtime 1 + normalized에서 slot/session snapshot 사용.
- runtime 0 또는 legacy/shadow에서 normalized row가 있어도 legacy facts 사용.
- normalized invalid session, legacy ambiguous/makeup inference, 필수 반/시간/teacher/room/start 누락은 차단.
- textbook null은 허용하고 name은 null.
- class/textbook/session/slot 한 값 변경마다 source checksum 변화와 attempt marker stale.
- `release_registration_customer_reminder_job_v1(...,'source_ineligible')` 후 job status canceled, provider message row 0.
- helper/public RPC는 `service_role` 외 EXECUTE 없음.

- [ ] **Step 9: disposable runner seed를 보완한다**

`probeSeedSql()`에 synthetic legacy class, 시작일이 있는 planned enrollment를 넣어 admission resolver가 성공하도록 만든다. fixture는 실제 연락처 대신 `.invalid` email과 synthetic phone만 사용하고 외부 provider 호출 경로는 계속 주입하지 않는다.

- [ ] **Step 10: 정적 DB test와 isolated DB QA를 GREEN으로 만든다**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test \
  tests/registration-customer-solapi-db.test.mjs

/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  verify:registration-customer-message:isolated-db
```

Expected: Node DB contract PASS, disposable Supabase migration/reset/pgTAP PASS, provider attempt count는 synthetic DB 내부 상태만 바뀌고 외부 HTTP call 0.

- [ ] **Step 11: Task 3을 커밋한다**

```bash
MIGRATION_PATH="$(rg --files supabase/migrations | rg '_registration_customer_message_subject_admission_details\.sql$' | sort | tail -1)"
git add \
  "$MIGRATION_PATH" \
  supabase/tests/registration_customer_solapi_messages_test.sql \
  scripts/run-registration-customer-solapi-local-db-qa.mjs \
  tests/registration-customer-solapi-db.test.mjs
git diff --cached --check
git commit -m "feat: resolve scoped registration message sources"
```

---

### Task 4: Safe Operator Errors and Admission Preview UI

**Files:**
- Create: `src/features/tasks/registration-customer-message-errors.ts`
- Modify: `src/features/tasks/registration-customer-message-service.ts:21-43`
- Modify: `src/features/tasks/server/registration-customer-message-route.ts:216-255,575-648,957-973`
- Modify: `src/features/tasks/registration-alimtalk-preview-dialog.tsx:16-22,120-156,199-224,320-349`
- Modify: `src/features/tasks/registration-track-fixtures.ts:300-306`
- Modify: `tests/registration-customer-message-route.test.mjs`
- Modify: `tests/registration-customer-message-service.test.mjs`
- Modify: `tests/registration-alimtalk-preview-dialog.test.mjs:114-212`

**Interfaces:**
- Consumes: Task 2 public `facts.admissionPlans`; Task 3 DB error messages.
- Produces: `getRegistrationCustomerMessageErrorMessage(cause,fallback)`, distinct safe public codes, ordered admission verification UI.

- [ ] **Step 1: 한국어 오류와 미리보기 순서 RED tests를 작성한다**

errors 순수 함수 테스트는 다음 exact mapping을 요구한다.

```js
assert.equal(getRegistrationCustomerMessageErrorMessage(
  new Error("registration_customer_message_source_ineligible"), "fallback",
), "현재 이 예약을 진행하는 과목이 없습니다. 과목별 진행상태를 확인해 주세요.")
assert.equal(getRegistrationCustomerMessageErrorMessage(
  new Error("registration_customer_message_admission_schedule_incomplete"), "fallback",
), "수업의 요일·시간, 선생님, 강의실, 첫 수업일을 모두 저장한 뒤 다시 시도해 주세요.")
assert.equal(getRegistrationCustomerMessageErrorMessage(
  new Error("registration_customer_message_confirmation_conflict"), "fallback",
), "등록 수업 정보가 변경되었습니다. 새 미리보기를 확인해 주세요.")
assert.equal(getRegistrationCustomerMessageErrorMessage(
  new Error("registration_customer_message_template_drift"), "fallback",
), "새 알림톡 템플릿 승인 후 발송할 수 있습니다.")
assert.equal(getRegistrationCustomerMessageErrorMessage(
  new Error("registration_customer_message_body_too_long"), "fallback",
), "등록 수업 정보가 길어 알림톡을 만들 수 없습니다. 수업 정보를 확인해 주세요.")
```

dialog source contract는 admission plan 내부 라벨이 `과목/수업 → 교재 → 요일/시간 → 선생님 → 강의실 → 첫 수업일` 순서이며, first lesson container에 `font-semibold`과 `border-t`가 있고 실제 body는 `whitespace-pre-wrap`로 유지됨을 검증한다.

- [ ] **Step 2: route/service/dialog tests가 실패하는지 확인한다**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test \
  tests/registration-customer-message-route.test.mjs \
  tests/registration-customer-message-service.test.mjs \
  tests/registration-alimtalk-preview-dialog.test.mjs
```

Expected: safe code propagation, mapper, admission UI assertions만 FAIL.

- [ ] **Step 3: safe source code를 route에서 보존한다**

route server에 allowlist를 둔다.

```ts
const SAFE_SOURCE_ERROR_CODES = new Set([
  "registration_customer_message_source_ineligible",
  "registration_customer_message_admission_schedule_incomplete",
  "registration_customer_message_body_too_long",
])
```

`sourceRpc`는 Postgres `22023`의 message에서 allowlisted exact code만 복원하고, 나머지는 기존 `registration_customer_message_source_invalid`로 축약한다. `resolvePreviewSource`는 allowlisted code를 HTTP 422의 same code로 반환한다. DB error detail, SQL, raw message는 public JSON에 넣지 않는다. send 직전 재해석 또는 attempt marker가 stale이면 기존 claim release와 provider 0회를 유지하고 public conflict/pre-send code로 끝낸다.

- [ ] **Step 4: browser-safe 오류 mapper를 구현하고 모든 dialog catch에서 사용한다**

`registration-customer-message-errors.ts`는 `cause instanceof Error ? cause.message : ""`만 읽고 exact/substring code map을 적용한다. preview/send/check/reconcile/release catch는 각각 기존 fallback을 넘기되 raw code를 직접 렌더하지 않는다.

`requestJson`은 non-2xx JSON의 `code`를 `new Error(code)`로 보존하고, response body가 JSON이 아니거나 code가 없으면 `registration_customer_message_request_failed`를 사용한다. browser request body는 계속 target/send DTO만 포함한다.

- [ ] **Step 5: admission plan 검증 UI를 추가한다**

`preview.facts.admissionPlans?.map(...)`을 body 위에 렌더한다. 카드 내부는 다음 semantic layout을 사용한다.

```tsx
<section key={`${plan.subjectLabel}:${plan.className}:${index}`} className="rounded-md border p-3">
  <dl className="grid gap-1">
    <div><dt className="inline text-muted-foreground">과목/수업 · </dt><dd className="inline">[{plan.subjectLabel}] {plan.className}</dd></div>
    <div><dt className="inline text-muted-foreground">교재 · </dt><dd className="inline">{plan.textbookLabel}</dd></div>
    <div><dt className="inline text-muted-foreground">요일/시간 · </dt><dd className="inline">{plan.scheduleLabel}</dd></div>
    <div><dt className="inline text-muted-foreground">선생님 · </dt><dd className="inline">{plan.teacherLabel}</dd></div>
    <div><dt className="inline text-muted-foreground">강의실 · </dt><dd className="inline">{plan.classroomLabel}</dd></div>
    <div className="mt-2 border-t pt-2 font-semibold"><dt className="inline">첫 수업일 · </dt><dd className="inline">{plan.firstLessonLabel}</dd></div>
  </dl>
</section>
```

fixture preview도 같은 shape와 ChannelTalk button host `tipsedu.channel.io`를 제공한다. z-[90], focus return, confirm lock은 변경하지 않는다.

- [ ] **Step 6: Task 4 tests와 typecheck를 GREEN으로 만든다**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test \
  tests/registration-customer-message-route.test.mjs \
  tests/registration-customer-message-service.test.mjs \
  tests/registration-alimtalk-preview-dialog.test.mjs

/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm exec tsc --noEmit --pretty false
```

Expected: tests/typecheck PASS, preview UI에 raw `registration_customer_message_*` 문자열이 보이지 않는다.

- [ ] **Step 7: Task 4를 커밋한다**

```bash
git add \
  src/features/tasks/registration-customer-message-errors.ts \
  src/features/tasks/registration-customer-message-service.ts \
  src/features/tasks/server/registration-customer-message-route.ts \
  src/features/tasks/registration-alimtalk-preview-dialog.tsx \
  src/features/tasks/registration-track-fixtures.ts \
  tests/registration-customer-message-route.test.mjs \
  tests/registration-customer-message-service.test.mjs \
  tests/registration-alimtalk-preview-dialog.test.mjs
git diff --cached --check
git commit -m "feat: preview admission details safely"
```

---

### Task 5: Automatic Reminder Terminal Source Ineligibility

**Files:**
- Modify: `src/features/tasks/server/registration-customer-reminder-worker.ts:8-61,86-134`
- Modify: `src/features/tasks/server/registration-customer-reminder-route.ts:287-306,389-420`
- Modify: `tests/registration-customer-reminder-worker.test.mjs:34-123`
- Modify: `tests/registration-customer-reminder-route.test.mjs:179-208`

**Interfaces:**
- Consumes: Task 3 DB resolver error `registration_customer_message_source_ineligible` and release RPC terminal behavior.
- Produces: `RegistrationCustomerReminderSourceIneligibleError`, provider-zero worker outcome `skipped`, release `errorCode: "source_ineligible"`.

- [ ] **Step 1: terminal/generic prepare error RED tests를 작성한다**

```js
test("대상 과목이 사라진 자동 리마인드는 terminal 취소되고 provider를 호출하지 않는다", async () => {
  let releaseInput
  const { calls, worker } = makeDependencies({
    prepare: async () => { throw new RegistrationCustomerReminderSourceIneligibleError() },
    async release(input) { calls.release += 1; releaseInput = input },
  })
  const result = await worker.runOnce()
  assert.deepEqual(result, { ok: true, processed: true, providerAttempted: false, outcome: "skipped" })
  assert.equal(releaseInput.errorCode, "source_ineligible")
  assert.equal(calls.send, 0)
  assert.equal(calls.finalize, 0)
})
```

기존 generic prepare error test는 계속 `pre_send_preparation_failed`, outcome `held`를 기대한다.

- [ ] **Step 2: reminder tests가 typed terminal class 부재로 실패하는지 확인한다**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test \
  tests/registration-customer-reminder-worker.test.mjs \
  tests/registration-customer-reminder-route.test.mjs
```

Expected: 새 exported error와 terminal branch assertion만 FAIL.

- [ ] **Step 3: worker의 terminal branch를 최소 구현한다**

```ts
export class RegistrationCustomerReminderSourceIneligibleError extends Error {
  constructor() {
    super("registration_customer_message_source_ineligible")
    this.name = "RegistrationCustomerReminderSourceIneligibleError"
  }
}
```

prepare/begin catch를 분리한다. typed error이면 release `source_ineligible` 후 `skipped`; release 자체가 실패해도 provider boundary를 넘지 않고 `held`로 반환해 lease가 만료되게 한다. generic error는 기존 behavior 그대로다.

- [ ] **Step 4: production source RPC 오류를 typed error로 바꾼다**

`serviceRpc`에 source 전용 option을 추가한다.

```ts
type ServiceRpcOptions = Readonly<{ sourceIneligibleIsTerminal?: boolean }>
```

`result.error.message`가 exact `registration_customer_message_source_ineligible`을 포함하고 option이 true일 때만 typed error를 던진다. timeout/network/template drift/schedule incomplete는 generic hold 경로다. `read_registration_customer_reminder_source_v1` 호출에만 option을 켠다. `.abortSignal(...).retry(false)`는 유지한다.

- [ ] **Step 5: reminder tests를 GREEN으로 만든다**

Run: Step 2와 동일.

Expected: typed source ineligible provider 0/terminal release PASS, generic hold/provider uncertainty tests도 PASS.

- [ ] **Step 6: Task 5를 커밋한다**

```bash
git add \
  src/features/tasks/server/registration-customer-reminder-worker.ts \
  src/features/tasks/server/registration-customer-reminder-route.ts \
  tests/registration-customer-reminder-worker.test.mjs \
  tests/registration-customer-reminder-route.test.mjs
git diff --cached --check
git commit -m "fix: stop ineligible reminder retries"
```

---

### Task 6: Full Regression, Build, and Security Review Gate

**Files:**
- Verify: all files changed in Tasks 1-5
- Verify: `package.json`
- Verify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Tasks 1-5 completed commits.
- Produces: a clean, reproducible release candidate with no production mutation.

- [ ] **Step 1: focused customer-message suite를 실행한다**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types --test \
  tests/registration-customer-message-catalog.test.mjs \
  tests/registration-customer-message-source.test.mjs \
  tests/registration-customer-message-contract.test.mjs \
  tests/registration-customer-message-solapi.test.mjs \
  tests/registration-customer-message-route.test.mjs \
  tests/registration-customer-message-service.test.mjs \
  tests/registration-customer-message-rollout.test.mjs \
  tests/registration-alimtalk-preview-dialog.test.mjs \
  tests/registration-customer-reminder-worker.test.mjs \
  tests/registration-customer-reminder-route.test.mjs \
  tests/registration-customer-reminder-scheduler.test.mjs \
  tests/registration-customer-reminder-settings.test.mjs \
  tests/registration-customer-solapi-db.test.mjs
```

Expected: all PASS; no test calls a real SOLAPI endpoint.

- [ ] **Step 2: disposable isolated DB QA를 다시 실행한다**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  verify:registration-customer-message:isolated-db
```

Expected: migration order, pgTAP, concurrency/dedupe, cleanup all PASS. Docker resources are exact-owned disposable resources only.

- [ ] **Step 3: targeted lint, full typecheck, production build를 실행한다**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm exec eslint \
  src/features/tasks/server/registration-customer-message-catalog.ts \
  src/features/tasks/server/registration-customer-message-source.ts \
  src/features/tasks/registration-customer-message-contract.ts \
  src/features/tasks/registration-customer-message-errors.ts \
  src/features/tasks/registration-customer-message-service.ts \
  src/features/tasks/server/registration-customer-message-route.ts \
  src/features/tasks/registration-alimtalk-preview-dialog.tsx \
  src/features/tasks/registration-track-fixtures.ts \
  src/features/tasks/server/registration-customer-reminder-worker.ts \
  src/features/tasks/server/registration-customer-reminder-route.ts

/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm exec tsc --noEmit --pretty false
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm build
```

Expected: ESLint/typecheck PASS; Next production build (`next build --webpack`) PASS.

- [ ] **Step 4: diff와 보안 경계를 직접 검토한다**

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git status --short
rg -n "SOLAPI_API_SECRET|SUPABASE_SERVICE_ROLE_KEY|parentPhoneDigits" \
  src/features/tasks/registration-customer-message-contract.ts \
  src/features/tasks/registration-alimtalk-preview-dialog.tsx \
  src/features/tasks/registration-track-fixtures.ts
```

Expected: diff check clean; worktree clean; browser-facing files에 secret/full phone field 없음. `parentPhoneDigits`는 server-private source/contract에서만 존재한다.

- [ ] **Step 5: 설계 완료 기준을 수동 대조한다**

다음 각 항목을 테스트 이름 또는 diff line에 연결해 기록한다: 같은 단계 복수 과목 그룹, 다른 단계 형제 제외, waiting single-track, admission actual planned only, exact block order, first lesson last, all contact buttons last, source-dirty, 1,000자, template drift, no-SMS, one-time lock, unknown hold, automatic source-ineligible provider zero.

검증에서 파일 수정이 필요하면 빈 검증 커밋을 만들지 않는다. 원인을 소유한 Task의 RED test를 먼저 추가하고 해당 Task 성격의 별도 fix commit으로 남긴 뒤 Step 1부터 다시 실행한다.

---

### Task 7: Production Migration, Git/Vercel Release, and SOLAPI Reapproval Boundary

**Files:**
- Deploy: committed migration and application changes only
- External configuration after approval: five existing Vercel server-only template ID environment variables
- External provider: existing SOLAPI account and Kakao channel, five newly created templates

**Interfaces:**
- Consumes: Task 6 clean release candidate.
- Produces: DB migration applied, `main`/Vercel Production exact SHA deployed, five SOLAPI templates submitted for approval; actual customer send remains disabled until separate authorization.

- [ ] **Step 1: Supabase/Vercel predeploy health와 exact release delta를 확인한다**

```bash
git fetch origin main
git rev-parse origin/main
git rev-parse HEAD
git log --oneline --decorate origin/main..HEAD
git diff --check origin/main...HEAD
git status --short
```

Supabase는 `ACTIVE_HEALTHY`, `select 1`, `pg_is_in_recovery() = false`, waiting lock 0, 최근 Auth/API/Postgres 5xx·statement timeout 재발 없음인지 read-only로 확인한다. Vercel 현재 Production READY commit도 기록한다. health가 불안정하면 schema/deploy를 중첩하지 않고 중단한다.

- [ ] **Step 2: production DB에 committed migration을 정확히 한 번 적용한다**

Supabase MCP `apply_migration`을 사용해 Task 3에서 생성한 migration의 exact SQL만 적용한다. 다른 pending migration을 묶지 않는다. 적용 직후 다음 read-only verification을 실행한다. query는 이 스레드에서 사용자가 실제 발송 테스트용으로 만든 SOLAPI 테스트 등록 task `a54ebdc2-0af2-4aed-a5ba-9835a855f033`만 대상으로 삼고, 결과에서 학생명과 전화번호를 제거한다. 이 task가 없거나 완전한 입학 안내 source를 만들 수 없으면 다른 운영 고객을 대신 고르거나 production synthetic row를 만들지 않고 `authorized live test source 없음`으로 보고한다.

```sql
with actor as (
  select profile.id
  from public.profiles profile
  where profile.role = 'admin'
  order by profile.id
  limit 1
), candidate as (
  select task.id
  from public.ops_tasks task
  where task.id = 'a54ebdc2-0af2-4aed-a5ba-9835a855f033'::uuid
    and task.type = 'registration'
)
select public.resolve_registration_customer_message_source_v1(
  actor.id,
  'admission_application',
  candidate.id
) - 'studentName' - 'parentPhoneDigits'
from actor cross join candidate;
```

실행 시에는 위 exact authorized test registration UUID만 사용하고 결과에서 전화번호/개인정보를 출력하지 않는다. task가 없거나 source가 incomplete이면 그 결과 자체를 안전한 검증 한계로 기록한다. 함수 owner/grants, migration history, resolver source shape, reminder release semantics을 확인하고 Supabase security/performance advisors를 실행한다. advisor finding이 새 migration 때문이면 앱 배포 전에 수정 migration으로 해결한다.

- [ ] **Step 3: branch를 최신 main 위에서 검증하고 GitHub main에 반영한다**

원격 main이 Task 1 시작 이후 이동했으면 clean worktree에서 rebase/merge conflict를 해소하고 Task 6 전체 검증을 다시 수행한다. 이후 프로젝트의 main-push 배포 관례로 반영한다.

```bash
git push origin HEAD:main
```

Expected: remote `main` SHA가 local HEAD와 exact match. force push는 사용하지 않는다.

- [ ] **Step 4: Git 연동 Vercel Production을 검증한다**

새 main push가 만든 Production deployment가 `READY`가 될 때까지 확인한다. deployment metadata commit SHA, `tipsedu.co.kr` alias, `tipsdashboard.vercel.app` alias가 모두 새 main SHA를 가리키는지 확인한다. `/admin/registration`과 reminder API route가 200/인증 기대 상태인지 확인하고 runtime error log를 스캔한다.

보고에는 실제 deployment metadata에서 읽은 URL, target `production`, status `READY`, deployed short SHA, framework `Next.js`, post-deploy error scan 결과를 각각 별도 항목으로 적는다. 추정값이나 이전 deployment 값을 재사용하지 않는다.

- [ ] **Step 5: 코드 배포 상태에서 provider call 0을 확인한다**

새 catalog checksum 때문에 기존 template receipt는 exact match하지 않아 다섯 종류가 `templateVerified = false` 또는 `template_drift` blocker여야 한다. 실제 운영 registration 미리보기에서 본문은 새 내용으로 보이되 `확인 후 발송`은 disabled여야 한다. provider delivery/attempt count가 늘지 않았음을 DB와 SOLAPI 발송 이력 양쪽에서 확인한다.

- [ ] **Step 6: 기존 SOLAPI 계정에 새 템플릿 5종을 등록하고 검수를 요청한다**

각 template은 catalog의 content, variable names, button order/URL, 기존 PF ID와 exact match시킨다.

1. level-test booking revision 3
2. visit-consultation booking revision 3
3. appointment reminder revision 3
4. waiting notice revision 2
5. admission application revision 3

승인된 기존 template은 수정하지 않는다. 새 template ID와 검수 상태를 종류별로 기록하되 source control이나 채팅에 secret/API key를 남기지 않는다.

- [ ] **Step 7: 승인 대기 상태를 명확히 보고하고 멈춘다**

이 시점 완료 증거를 다음처럼 분리한다.

- code/tests/build: 완료 또는 실패 근거
- DB migration: applied migration name과 verification
- GitHub main: exact SHA
- Vercel Production: READY deployment와 alias
- SOLAPI: 5종 각각 `검수중|승인|반려`
- provider call: 0
- actual customer receipt: 실행 안 함
- automatic reminder: 기존 OFF 유지

SOLAPI 승인 전에는 template ID env를 바꾸거나 activation을 live로 바꾸지 않는다.

- [ ] **Step 8: 다섯 템플릿 승인 후에만 environment 연결과 재배포를 수행한다**

사용자가 승인 완료를 알린 뒤 provider read-only preflight로 PF ID, template ID, approval/sendable status, body, variables, buttons를 catalog checksum과 exact 비교한다. 일치할 때만 Vercel Production server-only env의 다섯 template ID를 새 ID로 교체하고 재배포한다. 새 deployment READY와 exact SHA/env generation을 확인한 뒤 read-only preflight를 다시 실행한다.

실제 고객 발송 테스트와 automatic reminder ON은 여전히 별도 명시적 승인 대상이다. 승인받기 전에는 테스트 번호를 포함한 어떤 수신자에게도 `확인 후 발송`을 누르지 않는다.

---

## Final Verification Matrix

| Boundary | Required evidence | Not equivalent to |
| --- | --- | --- |
| TypeScript behavior | focused Node tests + lint + typecheck | DB source behavior |
| DB canonical source | disposable pgTAP + production read-only probe | SOLAPI delivery |
| Provider safety | template exact preflight + provider attempt 0 before approval | template visible in console |
| Git release | remote `main` exact SHA | local commit only |
| Vercel release | Production `READY`, exact SHA, aliases, route/error scan | Git push only |
| Customer receipt | explicit test send + provider receipt + handset receipt | preview or provider accepted status only |
| Automatic reminder | explicit ON authorization + scheduler/worker observation | approved reminder template |

## Rollback Boundaries

- 앱 회귀: 이전 Vercel Production deployment로 alias rollback한다. DB migration은 destructive rollback하지 않는다.
- resolver 회귀: 새 forward-only corrective migration으로 이전 safe resolver behavior를 복구한다.
- template drift/반려: activation OFF와 기존/new template IDs를 그대로 보존하고 provider 호출 0을 유지한다.
- provider 불확실 결과: 기존 message row를 `unknown` hold로 유지하고 자동 재전송하지 않는다.
- 자동 리마인드: 별도 승인 전 OFF이므로 이 릴리스에서 ON rollback 작업은 발생하지 않는다.
