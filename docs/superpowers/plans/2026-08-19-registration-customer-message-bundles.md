# Registration Customer Message Bundles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 레벨테스트·방문상담·청강의 여러 과목 예약을 유형별 한 건의 예약 안내로 묶고, 예약 안내 발송 여부와 무관하게 서비스 당일 오전 10시 KST에 유형·날짜별 한 건의 자동 리마인드를 안전하게 발송한다.

**Architecture:** 기존 appointment와 observation은 수정하거나 병합하지 않고 private bundle manifest와 immutable bundle item snapshot을 추가한다. 기존 단건 메시지 종류와 템플릿은 역사 기록 및 전환 전 runtime으로 보존하고, 묶음 전용 메시지 종류 6개를 모두 `off`로 설치한 뒤 단일 DB runtime version으로 producer·preview·worker·UI를 함께 전환한다. 수동 예약 안내는 task 단위 preview-before-send를 유지하고, 자동 리마인드는 당일 오전 10시 producer가 만든 날짜별 snapshot만 worker가 claim한다.

**Tech Stack:** PostgreSQL 15/Supabase, pg_cron, pg_net, pgTAP, Next.js 16 App Router, React 19, TypeScript 5.9, Node test runner, 기존 SOLAPI ATA provider adapter.

**Spec:** `docs/superpowers/specs/2026-08-19-registration-customer-message-bundles-design.md`

## Global Constraints

- 예약 유형은 `level_test`, `visit_consultation`, `observation`이며 서로 섞지 않는다.
- 예약 안내는 같은 `task_id + reservation_kind`의 모든 유효한 미래 예약을 날짜가 달라도 한 건에 담는다.
- 리마인드는 같은 `task_id + reservation_kind + KST service_date`의 예약을 한 건에 담는다.
- 세 유형 리마인드는 모두 exact cron `0 1 * * *` UTC, 즉 서비스 당일 오전 10시 KST에만 생성한다.
- 예약 안내 preview·발송·성공 이력은 리마인드 적격성에 사용하지 않는다.
- 오전 10시 이후 변경은 새 자동 리마인드나 자동 재발송을 만들지 않는다.
- 레벨테스트 source는 scheduled appointment와 scheduled level-test attempt, 방문상담 source는 scheduled appointment와 `mode = 'visit'`인 scheduled consultation, 청강 source는 scheduled observation이어야 한다.
- 시작 시각이 현재보다 뒤이고 일정·장소·수신 대상이 모두 유효한 source만 포함한다.
- 같은 유형·과목의 유효한 source가 둘 이상이면 `source_ambiguous`로 전체 묶음을 막는다.
- 묶음은 영어·수학·과학 과목별 최대 한 항목, 전체 최대 세 항목이다.
- 원본 예약 저장과 고객 메시지 전달을 결합하지 않는다. SOLAPI 실패로 예약을 rollback하지 않는다.
- provider attempt marker 이전 실패는 공급자를 호출하지 않는다. marker 이후 timeout·finalize 실패는 `unknown`이며 자동 재시도하지 않는다.
- `accepted`, `unknown`, `failed_hold`는 terminal이다. 한 묶음의 일부 항목만 발송하지 않는다.
- 기존 migration, 기존 예약 행, 기존 고객 메시지, provider-attempted 작업은 수정·삭제·소급 변환하지 않는다.
- 새 schema·RPC·catalog·UI는 runtime `0` 및 신규 activation `off`로 먼저 설치한다.
- 기존 단건 producer와 새 묶음 producer가 동시에 고객 발송 가능한 상태를 허용하지 않는다.
- 실제 고객 발송, SOLAPI/Kakao template 승인, Vercel 환경변수, provider activation, recipient receipt는 각각 별도 승인·증거 게이트다.
- 전체 전화번호, provider ID, PF/template ID, recipient hash, source fingerprint, claim/dispatch token, API key·secret을 브라우저 payload·DOM·공개 로그에 노출하지 않는다.
- 새 public table을 만들지 않는다. bundle storage는 `dashboard_private`에 두고 RLS를 켠 뒤 모든 일반 role 권한을 revoke한다.
- 새 `SECURITY DEFINER` 함수는 `set search_path = ''`, 명시적 actor/service-role 검사, `PUBLIC`/`anon`/불필요 role의 execute revoke를 갖는다.
- schema 변경은 `supabase migration new registration_customer_message_bundles`로 생성한 단일 forward migration에만 작성한다.
- 구현 시작 시 `supabase --version`, `supabase --help`, `supabase migration new --help`, Supabase changelog의 관련 breaking change를 확인한다.
- 검증 결과는 source/tests → isolated DB → production migration → `main`/Vercel → authenticated UI → runtime → provider → recipient 순서로 분리해 보고한다.

## Fixed Internal Message Kinds

기존 종류는 역사 판독과 runtime `0`을 위해 그대로 둔다. 새 묶음 경로만 다음 6개를 사용한다.

```ts
export const REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_KINDS = Object.freeze([
  "level_test_booking_bundle",
  "visit_consultation_booking_bundle",
  "observation_booking_bundle",
  "level_test_reminder_bundle",
  "visit_consultation_reminder_bundle",
  "observation_reminder_bundle",
] as const)

export const REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_KIND_PARTS = Object.freeze({
  level_test_booking_bundle: { reservationKind: "level_test", deliveryKind: "booking" },
  visit_consultation_booking_bundle: { reservationKind: "visit_consultation", deliveryKind: "booking" },
  observation_booking_bundle: { reservationKind: "observation", deliveryKind: "booking" },
  level_test_reminder_bundle: { reservationKind: "level_test", deliveryKind: "reminder" },
  visit_consultation_reminder_bundle: { reservationKind: "visit_consultation", deliveryKind: "reminder" },
  observation_reminder_bundle: { reservationKind: "observation", deliveryKind: "reminder" },
} as const)
```

## File and Responsibility Map

### New files

- `supabase/migrations/*_registration_customer_message_bundles.sql` — CLI가 생성하는 유일한 forward migration. bundle/run/item storage, source materialization, preview/message linkage, reminder producer·claim·begin·finalize, summary RPC, runtime cutover를 소유한다.
- `supabase/tests/registration_customer_message_bundles_test.sql` — 실제 PostgreSQL의 grouping, KST 10시, 중복 잠금, 상태 전이, ACL, cutover를 pgTAP으로 검증한다.
- `tests/registration-customer-message-bundles-db.test.mjs` — migration의 closed kind list, private schema, exact cron, provider-zero install, legacy preservation을 정적으로 고정한다.
- `src/features/tasks/server/registration-customer-message-bundle-catalog.ts` — 묶음 전용 6개 template, env key, checksum, 여러 줄 `예약목록` 렌더링을 소유한다.
- `src/features/tasks/server/registration-customer-message-bundle-source.ts` — DB bundle JSON을 strict parse하고 정렬·fingerprint·public/private source를 만든다.
- `src/features/tasks/server/registration-customer-message-bundle-worker.ts` — reminder bundle의 claim→prepare→attempt marker→provider→finalize를 실행한다.
- `src/features/tasks/registration-customer-message-bundle-actions.tsx` — 유형별 예약 안내 버튼 하나와 날짜별 읽기 전용 리마인드 상태를 렌더링한다.
- `tests/registration-customer-message-bundle-contract.test.mjs` — 새 kind/type/DTO exact-key 계약을 검증한다.
- `tests/registration-customer-message-bundle-catalog.test.mjs` — 6개 본문, 최대 3개 항목 정렬, checksum, 서버 전용 env를 검증한다.
- `tests/registration-customer-message-bundle-source.test.mjs` — strict source parser와 fingerprint/stale/ambiguity 계약을 검증한다.
- `tests/registration-customer-message-bundle-route.test.mjs` — task 단위 preview/history/send와 runtime fail-closed를 검증한다.
- `tests/registration-customer-message-bundle-worker.test.mjs` — provider 경계와 같은 10시 run 안의 한 번 refresh를 검증한다.
- `tests/registration-customer-message-bundle-ui.test.mjs` — 유형별 버튼 1개, 다과목 preview, 읽기 전용 상태, dirty 차단을 검증한다.
- `scripts/run-registration-customer-message-bundles-local-db-qa.mjs` — clean isolated DB apply와 bundle pgTAP를 provider-zero로 실행한다.

### Existing files to modify

- `src/features/tasks/registration-customer-message-contract.ts` — 기존 single-source kind와 신규 bundle kind를 합친 browser-safe union, reservation list facts, bundle summary DTO를 정의한다.
- `src/features/tasks/server/registration-customer-message-catalog.ts` — 기존 7개 single-source catalog의 입력 type을 좁혀 신규 bundle catalog와 혼동하지 않게 한다. 기존 content/checksum/env는 변경하지 않는다.
- `src/features/tasks/server/registration-customer-message-source.ts` — 기존 resolver를 single-source kind 전용으로 좁힌다. 기존 source 동작은 변경하지 않는다.
- `src/features/tasks/server/registration-customer-message-route.ts` — runtime과 kind에 따라 기존 resolver 또는 bundle resolver를 선택하고 bundle preview/list/claim/finalize RPC를 연결한다.
- `src/features/tasks/server/registration-customer-reminder-route.ts` — runtime `0`에서는 기존 worker, runtime `1`에서는 당일 producer와 bundle worker를 선택한다.
- `src/features/tasks/registration-customer-message-service.ts` — target는 계속 `{ messageKind, sourceId }`; bundle kind에서 `sourceId`가 task ID라는 계약을 유지한다.
- `src/features/tasks/registration-alimtalk-preview-dialog.tsx` — `facts.reservations`를 과목·날짜·시간·장소 목록으로 표시한다.
- `src/features/tasks/registration-track-service.ts` — appointment 단위 reminder summary를 제거하고 task 단위 bundle summary를 strict parse한다.
- `src/features/tasks/registration-track-editor.tsx` — 세 유형 섹션에 task 단위 action을 한 번씩 배치하고 bundle dialog target를 검증한다.
- `src/features/tasks/registration-appointment-editor.tsx` — runtime `0`의 기존 과목별 예약 안내를 보존하고 runtime `1`에서는 해당 버튼과 appointment 단위 reminder 문구를 숨긴다.
- `src/features/tasks/registration-observation-editor.tsx` — runtime `0`의 observation ID target를 보존하고 runtime `1`에서는 해당 버튼을 숨긴다.
- `src/features/tasks/registration-customer-message-errors.ts` — `source_ambiguous`, `bundle_stale`, `bundle_runtime_inactive`의 운영자 문구를 추가한다.
- `src/features/tasks/registration-track-fixtures.ts` — task 단위 다과목 bundle preview/history/provider-zero fixture를 추가한다.
- `src/features/tasks/registration-track-fixture-runtime.ts` — fixture의 bundle runtime version과 상태 projection을 제공한다.
- `tests/fixtures/registration-customer-message-checksums.json` — 신규 6개 template checksum만 추가하고 기존 값을 유지한다.
- `tests/registration-customer-message-contract.test.mjs` — 기존 single-source 7종이 보존됨을 검증한다.
- `tests/registration-customer-message-catalog.test.mjs` — 기존 catalog가 신규 종류를 암묵적으로 받지 않음을 검증한다.
- `tests/registration-customer-message-route.test.mjs` — runtime `0`의 기존 route 회귀를 유지한다.
- `tests/registration-customer-reminder-route.test.mjs` — runtime switch와 producer 호출 순서를 검증한다.
- `tests/registration-track-service.test.mjs` — case-level bundle summary strict mapping을 검증한다.
- `tests/registration-alimtalk-preview-dialog.test.mjs` — 여러 예약 목록의 접근 가능한 렌더링을 검증한다.
- `tests/registration-reminder-status-ui.test.mjs` — runtime `1`에서 same-day-created/changed 문구 대신 유형·날짜 상태를 사용하고 runtime `0` legacy 표시를 보존한다.
- `tests/registration-observation-customer-message-ui.test.mjs` — 과목별 청강 버튼이 사라졌음을 검증한다.
- `tests/registration-track-workspace.test.mjs` — task 단위 bundle target와 reload 동작을 검증한다.
- `scripts/verify-registration-customer-message-browser.mjs` — provider-zero browser flow를 신규 task 단위 target와 다과목 preview로 확장한다.
- `package.json` — `verify:registration-customer-message:bundles:isolated-db` script를 추가한다.

---

### Task 1: Browser Contract and Bundle Catalog

**Files:**
- Create: `src/features/tasks/server/registration-customer-message-bundle-catalog.ts`
- Create: `tests/registration-customer-message-bundle-contract.test.mjs`
- Create: `tests/registration-customer-message-bundle-catalog.test.mjs`
- Modify: `src/features/tasks/registration-customer-message-contract.ts`
- Modify: `src/features/tasks/server/registration-customer-message-catalog.ts`
- Modify: `src/features/tasks/server/registration-customer-message-source.ts`
- Modify: `tests/registration-customer-message-contract.test.mjs`
- Modify: `tests/registration-customer-message-catalog.test.mjs`
- Modify: `tests/fixtures/registration-customer-message-checksums.json`

**Interfaces:**
- Consumes: 기존 `RegistrationCustomerMessageKind`, `RegistrationCustomerMessagePreviewResponse`, template checksum helpers.
- Produces: `RegistrationCustomerMessageBundleKind`, `RegistrationCustomerMessageBundleReservationKind`, `RegistrationCustomerMessageBundleDeliveryKind`, `RegistrationCustomerMessageBundleItem`, `RegistrationCustomerMessageBundleSummary`, `createRegistrationCustomerMessageBundleCatalog()`, `renderRegistrationCustomerMessageBundle()`.

- [ ] **Step 1: Write the RED contract tests**

`tests/registration-customer-message-bundle-contract.test.mjs`에 다음 exact union과 public shape를 검증한다.

```js
assert.deepEqual(contract.REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_KINDS, [
  "level_test_booking_bundle",
  "visit_consultation_booking_bundle",
  "observation_booking_bundle",
  "level_test_reminder_bundle",
  "visit_consultation_reminder_bundle",
  "observation_reminder_bundle",
])
assert.deepEqual(contract.REGISTRATION_CUSTOMER_MESSAGE_BUNDLE_STATES, [
  "scheduled", "processing", "sent", "unknown", "failed_hold", "not_sent", "canceled",
])
assert.equal(contract.parseRegistrationCustomerMessageTarget({
  messageKind: "level_test_booking_bundle",
  sourceId: TASK_ID,
})?.sourceId, TASK_ID)
```

Preview facts의 `reservations` 항목은 exact keys `subjectLabel`, `scheduleLabel`, `placeLabel`, `className`, `teacherLabel`만 허용하고 source ID/revision/hash/phone이 들어오면 parser가 거절하게 한다.

- [ ] **Step 2: Run contract tests and verify RED**

```bash
node --test --experimental-strip-types \
  tests/registration-customer-message-bundle-contract.test.mjs \
  tests/registration-customer-message-contract.test.mjs
```

Expected: 신규 constant와 DTO가 없어 FAIL, 기존 7개 kind 보존 assertion은 PASS.

- [ ] **Step 3: Add the closed browser-safe types**

`registration-customer-message-contract.ts`에 다음 타입을 추가하고 기존 7종은 `REGISTRATION_CUSTOMER_MESSAGE_SINGLE_SOURCE_KINDS`로 보존한다.

```ts
export type RegistrationCustomerMessageBundleItem = Readonly<{
  subjectLabel: "영어" | "수학" | "과학"
  scheduleLabel: string
  placeLabel: string
  className: string | null
  teacherLabel: string | null
}>

export type RegistrationCustomerMessageBundleState =
  | "scheduled" | "processing" | "sent" | "unknown"
  | "failed_hold" | "not_sent" | "canceled"

export type RegistrationCustomerMessageBundleSummary = Readonly<{
  reservationKind: "level_test" | "visit_consultation" | "observation"
  serviceDate: string
  state: RegistrationCustomerMessageBundleState
  scheduledFor: string | null
  sentAt: string | null
  updatedAt: string
  subjects: ReadonlyArray<"영어" | "수학" | "과학">
}>
```

`RegistrationCustomerMessagePreviewResponse.facts`에는 `reservations?: ReadonlyArray<RegistrationCustomerMessageBundleItem>`을 추가한다. `REGISTRATION_CUSTOMER_MESSAGE_KINDS`는 single-source 7종 뒤에 bundle 6종을 붙인 frozen array여야 한다.

- [ ] **Step 4: Write the six bundle catalog RED tests**

각 template가 변수 `학생명`, `예약목록`만 사용하고 server-only env key가 아래와 정확히 일치하는지 검증한다.

```ts
type RegistrationCustomerMessageBundleTemplateEnvKey =
  | "SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_BUNDLE_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_VISIT_BOOKING_BUNDLE_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_OBSERVATION_BOOKING_BUNDLE_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_LEVEL_TEST_REMINDER_BUNDLE_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_VISIT_REMINDER_BUNDLE_TEMPLATE_ID"
  | "SOLAPI_REGISTRATION_OBSERVATION_REMINDER_BUNDLE_TEMPLATE_ID"
```

영어 8월 21일 14:00 본관, 수학 8월 23일 16:00 별관 입력이 다음 순서로 렌더링되는지 검증한다.

```text
1. 영어 · 2026년 8월 21일 금요일 오후 2:00 · 본관
2. 수학 · 2026년 8월 23일 일요일 오후 4:00 · 별관
```

청강 항목은 같은 첫 줄 뒤에 `수업: 중2 영어 A반 · 담당: 홍길동 선생님`을 한 줄 더 포함해야 한다. 0개, 4개, 중복 과목, 잘못된 장소, 종료 시각, 임의 과목은 throw해야 한다.

- [ ] **Step 5: Implement the isolated bundle catalog**

기존 7종 catalog content/checksum/env를 바꾸지 않는다. 신규 파일에서 다음 입력과 출력을 구현한다.

```ts
export type RegistrationCustomerMessageBundleCanonicalItem = Readonly<{
  subject: "영어" | "수학" | "과학"
  scheduledAt: string
  place: string
  className: string | null
  teacherName: string | null
}>

export function renderRegistrationCustomerMessageBundle(input: Readonly<{
  kind: RegistrationCustomerMessageBundleKind
  studentName: string
  items: ReadonlyArray<RegistrationCustomerMessageBundleCanonicalItem>
}>): RegistrationCustomerMessageBundleRendered
```

예약목록 정렬은 `scheduledAt → 영어/수학/과학 → source ID와 무관한 안정 문자열` 순서다. 6개 본문은 각각 예약 안내/당일 리마인드 목적을 제목과 첫 문장에 명시한다. 버튼은 고정된 `본관 위치`, `별관 위치`, `문의하기` 3개만 사용하며 모든 URL은 catalog 상수다. `disableSms`는 항상 `true`다.

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
node --test --experimental-strip-types \
  tests/registration-customer-message-bundle-contract.test.mjs \
  tests/registration-customer-message-bundle-catalog.test.mjs \
  tests/registration-customer-message-contract.test.mjs \
  tests/registration-customer-message-catalog.test.mjs
```

Expected: zero failures; 기존 7종 checksum fixture도 변하지 않는다.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/features/tasks/registration-customer-message-contract.ts \
  src/features/tasks/server/registration-customer-message-catalog.ts \
  src/features/tasks/server/registration-customer-message-source.ts \
  src/features/tasks/server/registration-customer-message-bundle-catalog.ts \
  tests/registration-customer-message-bundle-contract.test.mjs \
  tests/registration-customer-message-bundle-catalog.test.mjs \
  tests/registration-customer-message-contract.test.mjs \
  tests/registration-customer-message-catalog.test.mjs \
  tests/fixtures/registration-customer-message-checksums.json
git commit -m "feat: define registration message bundles"
```

---

### Task 2: Private Bundle Manifest and Source Materialization

**Files:**
- Create via Supabase CLI: `supabase/migrations/*_registration_customer_message_bundles.sql`
- Create: `supabase/tests/registration_customer_message_bundles_test.sql`
- Create: `tests/registration-customer-message-bundles-db.test.mjs`

**Interfaces:**
- Consumes: `ops_tasks`, `ops_registration_details.parent_phone`, appointments, level-test attempts, visit consultations, observations, existing preview/message/activation tables.
- Produces: private bundle/run/item tables, `materialize_registration_customer_message_bundle_v1()`, `resolve_registration_customer_message_bundle_source_v1()`, runtime version `0`, six activation rows in `off`.

- [ ] **Step 1: Verify Supabase tooling and create the migration**

```bash
supabase --version
supabase --help
supabase migration new --help
supabase migration new registration_customer_message_bundles
BUNDLE_MIGRATION="$(find supabase/migrations -maxdepth 1 -type f -name '*_registration_customer_message_bundles.sql' -print)"
test -n "$BUNDLE_MIGRATION"
test "$(printf '%s\n' "$BUNDLE_MIGRATION" | wc -l | tr -d ' ')" = "1"
```

Expected: CLI가 생성한 migration 한 개만 발견된다. 파일명을 수동으로 만들지 않는다.

- [ ] **Step 2: Write migration contract RED tests**

`tests/registration-customer-message-bundles-db.test.mjs`에서 다음을 요구한다.

```js
assert.match(sql, /create table dashboard_private\.registration_customer_message_bundles/u)
assert.match(sql, /create table dashboard_private\.registration_customer_message_bundle_items/u)
assert.match(sql, /create table dashboard_private\.registration_customer_message_bundle_runs/u)
assert.match(sql, /active_version integer not null default 0/u)
assert.match(sql, /'0 1 \* \* \*'/u)
assert.doesNotMatch(sql, /update[\s\S]+provider_attempt_count\s*=\s*1/iu)
assert.match(sql, /values[\s\S]+'level_test_booking_bundle'[\s\S]+'off'/u)
```

또한 기존 7종 kind literal, 기존 message row, 기존 reminder terminal status를 delete/update하지 않는지 정적으로 검사한다.

- [ ] **Step 3: Run migration contract and verify RED**

```bash
node --test --experimental-strip-types tests/registration-customer-message-bundles-db.test.mjs
```

Expected: 빈 migration이므로 FAIL.

- [ ] **Step 4: Add private runtime, run, manifest, and item tables**

먼저 수신 대상 변경만 추적하는 revision을 추가한다. 다른 공통 정보 수정은 bundle fingerprint를 불필요하게 바꾸지 않아야 한다.

```sql
alter table public.ops_registration_details
  add column customer_message_recipient_revision bigint not null default 1
  check (customer_message_recipient_revision > 0);

create function dashboard_private.bump_registration_customer_message_recipient_revision_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_catalog.regexp_replace(coalesce(new.parent_phone, ''), '[^0-9]', '', 'g')
    is distinct from
    pg_catalog.regexp_replace(coalesce(old.parent_phone, ''), '[^0-9]', '', 'g') then
    new.customer_message_recipient_revision := old.customer_message_recipient_revision + 1;
  else
    new.customer_message_recipient_revision := old.customer_message_recipient_revision;
  end if;
  return new;
end;
$$;
```

이 함수를 `before update of parent_phone` trigger로 연결하고 일반 role의 execute를 revoke한다. 이어서 다음 핵심 column과 check를 설치한다.

```sql
create table dashboard_private.registration_customer_message_bundle_runtime (
  singleton boolean primary key default true check (singleton),
  installed_version integer not null default 1 check (installed_version = 1),
  active_version integer not null default 0 check (active_version in (0, 1)),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table dashboard_private.registration_customer_message_bundle_runs (
  id uuid primary key default gen_random_uuid(),
  service_date date not null unique,
  scheduled_for timestamptz not null,
  started_at timestamptz not null,
  status text not null check (status in ('producing', 'ready', 'completed', 'failed_hold')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (scheduled_for = (service_date + time '10:00') at time zone 'Asia/Seoul')
);

create table dashboard_private.registration_customer_message_bundles (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references dashboard_private.registration_customer_message_bundle_runs(id) on delete restrict,
  task_id uuid not null references public.ops_tasks(id) on delete restrict,
  reservation_kind text not null check (reservation_kind in ('level_test','visit_consultation','observation')),
  delivery_kind text not null check (delivery_kind in ('booking','reminder')),
  service_date date,
  bundle_revision bigint not null default 1 check (bundle_revision > 0),
  replaces_bundle_id uuid references dashboard_private.registration_customer_message_bundles(id) on delete restrict,
  recipient_revision bigint not null check (recipient_revision >= 0),
  source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in (
    'pending','claimed','dispatching','accepted','unknown','failed_hold','canceled'
  )),
  scheduled_for timestamptz,
  request_key uuid not null unique default gen_random_uuid(),
  claim_token uuid,
  claim_expires_at timestamptz,
  message_id uuid,
  refresh_count smallint not null default 0 check (refresh_count between 0 and 1),
  last_error_code text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check ((delivery_kind = 'booking' and service_date is null and run_id is null and scheduled_for is null)
      or (delivery_kind = 'reminder' and service_date is not null and run_id is not null and scheduled_for is not null))
);
```

`registration_customer_message_bundle_items`는 `bundle_id uuid`, `sort_order smallint`, `source_kind text check (source_kind in ('level_test','visit_consultation','observation'))`, `source_id uuid`, `source_revision jsonb`, `track_id uuid`, nullable `activity_id uuid`, `subject text`, `scheduled_at timestamptz`, `service_date date`, `place text`, nullable `class_name text`, nullable `teacher_name text`, `source_fact_hash text`를 가진다. Appointment item의 revision JSON은 `appointmentNotificationRevision`을, observation item은 `appointmentNotificationRevision`, `observationRevision`, `bookingFactHash`를 정확히 포함한다. `(bundle_id, sort_order)`, `(bundle_id, source_kind, source_id, track_id)`, `(bundle_id, subject)`를 unique로 만들고 최대 3개는 materializer와 pgTAP에서 함께 강제한다. 하나의 shared appointment에 여러 과목 activity가 연결된 기존 정상 구조는 track ID로 구분한다.

각 manifest row와 item은 생성 후 immutable이다. 공급자 시도 전 source가 바뀌면 기존 row를 `canceled`로 마감하고 `replaces_bundle_id = old.id`, `bundle_revision = old.bundle_revision + 1`인 새 row와 새 item snapshot을 만든다. 다음 index와 advisory lock을 함께 사용해 동시 materialization을 직렬화한다.

```sql
create unique index registration_customer_message_booking_bundle_revision_idx
  on dashboard_private.registration_customer_message_bundles(
    task_id, reservation_kind, delivery_kind, source_fingerprint, bundle_revision
  ) where delivery_kind = 'booking';

create unique index registration_customer_message_reminder_bundle_revision_idx
  on dashboard_private.registration_customer_message_bundles(
    task_id, reservation_kind, delivery_kind, service_date, bundle_revision
  ) where delivery_kind = 'reminder';
```

Materializer는 같은 booking fingerprint의 `accepted`, `unknown`, `failed_hold` row를 발견하면 새 row를 만들지 않는다. Reminder는 같은 task/type/date에 terminal 또는 provider-attempted revision이 있으면 새 revision을 만들지 않는다.

`before update or delete` trigger로 bundle item 변경·삭제를 항상 거절한다. Manifest trigger는 task/type/delivery/date/revision/replacement/recipient/fingerprint/scheduled/request key 변경을 거절하고 다음 상태 전이만 허용한다.

```text
pending -> claimed | dispatching | failed_hold | canceled
claimed -> pending | dispatching | failed_hold | canceled
dispatching -> accepted | unknown | failed_hold
accepted | unknown | failed_hold | canceled -> terminal, no transition
```

`claimed -> pending`은 provider marker가 없고 claim lease가 만료된 경우에만 허용한다. Status/claim/message/error/timestamp 이외의 snapshot column은 업데이트할 수 없다.

모든 private table에 RLS를 enable하고 `public, anon, authenticated, service_role`의 table 권한을 revoke한다.

- [ ] **Step 5: Add source collectors and deterministic fingerprinting**

private collector는 다음 predicate를 그대로 사용한다.

```sql
-- level_test
appointment.task_id = p_task_id
and appointment.kind = 'level_test'
and appointment.status = 'scheduled'
and appointment.scheduled_at > p_now
and level_test.status = 'scheduled'

-- visit_consultation
appointment.task_id = p_task_id
and appointment.kind = 'visit_consultation'
and appointment.status = 'scheduled'
and appointment.scheduled_at > p_now
and consultation.mode = 'visit'
and consultation.status = 'scheduled'

-- observation
observation.task_id = p_task_id
and observation.status = 'scheduled'
and observation.starts_at > p_now
```

리마인드는 추가로 `(scheduled_at at time zone 'Asia/Seoul')::date = p_service_date` 또는 `observation.session_date = p_service_date`를 요구한다. fingerprint는 과목 표준 순서로 정렬한 item JSON과 `ops_registration_details.customer_message_recipient_revision`을 `extensions.digest(..., 'sha256')`로 해시한다. 동일 과목이 2개이거나 item 수가 0 또는 4 이상이면 각각 `registration_customer_message_bundle_source_ambiguous`, `registration_customer_message_bundle_source_ineligible`를 발생시킨다.

- [ ] **Step 6: Add materialize and source-read RPCs**

정확한 signature를 사용한다.

```sql
dashboard_private.materialize_registration_customer_message_bundle_v1(
  p_task_id uuid,
  p_reservation_kind text,
  p_delivery_kind text,
  p_service_date date,
  p_now timestamptz
) returns uuid

public.resolve_registration_customer_message_bundle_source_v1(
  p_message_kind text,
  p_task_id uuid,
  p_service_date date default null
) returns jsonb
```

public RPC는 service-role JWT만 허용한다. 반환 JSON의 exact keys는 다음과 같다.

```json
{
  "messageKind": "level_test_booking_bundle",
  "sourceId": "task uuid",
  "bundleId": "bundle uuid",
  "bundleRevision": 1,
  "taskId": "task uuid",
  "reservationKind": "level_test",
  "deliveryKind": "booking",
  "serviceDate": null,
  "recipientRevision": 4,
  "sourceFingerprint": "64 lowercase hex",
  "studentName": "학생명",
  "parentPhoneDigits": "normalized phone",
  "items": [
    {
      "sourceKind": "level_test",
      "sourceId": "appointment uuid",
      "sourceRevision": {"appointmentNotificationRevision": 3},
      "trackId": "track uuid",
      "activityId": "level-test attempt uuid",
      "subject": "영어",
      "scheduledAt": "2026-08-21T05:00:00.000Z",
      "serviceDate": "2026-08-21",
      "place": "본관",
      "className": null,
      "teacherName": null,
      "sourceFactHash": "64 lowercase hex"
    }
  ]
}
```

item에는 내부 RPC에서만 source ID/revision이 포함된다. 브라우저 응답에는 포함하지 않는다.

- [ ] **Step 7: Extend preview/message storage without changing legacy rows**

두 public audit table에 nullable `bundle_id` FK를 추가한다. closed message-kind check에는 신규 6종을 추가하되 기존 literal을 제거하지 않는다. 신규 kind의 source shape는 `bundle_id is not null`, `task_id is not null`, `appointment_id/observation_id/track_id is null`로 고정한다.

Booking provider-attempt lock:

```sql
create unique index ops_reg_customer_msg_booking_bundle_once_idx
  on public.ops_registration_customer_messages(bundle_id, message_kind, source_fingerprint)
  where message_kind in (
    'level_test_booking_bundle','visit_consultation_booking_bundle','observation_booking_bundle'
  );
```

Booking logical dedupe와 reminder logical dedupe는 Step 4의 revision index, advisory lock, materializer의 terminal-row 검사로 소유한다. Provider attempt는 `message.bundle_id` unique index가 소유한다.

- [ ] **Step 8: Seed fail-closed activation and runtime**

기존 activation constraint에 신규 6종을 추가하고 모두 `off`로 insert한다. migration은 `active_version = 0`을 유지하며 cron job, provider attempt marker, 기존 activation mode를 바꾸지 않는다.

`registration_customer_solapi_template_receipts`, activation table, preview/message table의 closed kind check와 `registration_customer_solapi_assert_kind_v1`, template preflight/readiness, set-activation, live-test-receipt RPC의 closed allowlist에도 같은 6종을 추가한다. 신규 kind는 기존 observation cutoff 규칙을 상속하지 않고 bundle runtime과 Task 4 daily run으로만 자동 적격성을 판정한다. 기존 7종 분기는 그대로 보존한다.

다음 runtime RPC를 같은 migration에 설치한다.

```sql
public.get_registration_customer_message_bundle_runtime_v1()
returns jsonb

public.activate_registration_customer_message_bundle_runtime_v1(
  p_actor_profile_id uuid,
  p_request_key uuid
) returns jsonb
```

read RPC는 authenticated `admin`/`staff` profile 또는 service-role을 요구하고 `{installedVersion:1, activeVersion:0|1}`만 반환한다. Activation RPC는 `p_actor_profile_id = auth.uid()`인 admin actor, six current template receipts, six activation evidence, exact cron, current runtime `0`을 검사하며 Task 11의 한 transaction cutover만 수행한다. Migration 적용 자체는 이 RPC를 호출하지 않는다.

- [ ] **Step 9: Write and run pgTAP**

`supabase/tests/registration_customer_message_bundles_test.sql`은 최소 30개 assertion으로 다음을 증명한다: 분리 appointment 묶음, 다른 날짜 booking 묶음, 날짜별 reminder 분리, 유형 분리, observation snapshot, 취소 제외, 동일 과목 ambiguity, max 3, deterministic ordering/fingerprint, ACL/RLS, exact JSON keys, 신규 activation off, legacy row 불변, runtime 0, provider-attempt 0.

```bash
node scripts/run-isolated-supabase-db-tests.mjs \
  supabase/tests/registration_customer_message_bundles_test.sql
```

Expected: planned assertion 수와 실행 수가 같고 zero failures. Docker가 없으면 DB gate를 open으로 보고하고 source test로 대체 완료를 주장하지 않는다.

- [ ] **Step 10: Commit Task 2**

```bash
git add supabase/migrations supabase/tests/registration_customer_message_bundles_test.sql \
  tests/registration-customer-message-bundles-db.test.mjs
git commit -m "feat: add registration message bundle storage"
```

---

### Task 3: Task-Scoped Booking Preview and Send

**Files:**
- Create: `src/features/tasks/server/registration-customer-message-bundle-source.ts`
- Create: `tests/registration-customer-message-bundle-source.test.mjs`
- Create: `tests/registration-customer-message-bundle-route.test.mjs`
- Modify: `src/features/tasks/server/registration-customer-message-route.ts`
- Modify: `src/features/tasks/registration-customer-message-service.ts`
- Modify: `src/features/tasks/registration-customer-message-errors.ts`
- Modify: `tests/registration-customer-message-route.test.mjs`
- Modify: Task 2 migration and pgTAP file

**Interfaces:**
- Consumes: Task 1 bundle catalog, Task 2 source JSON and manifest ID, existing auth/SOLAPI/provider state machine.
- Produces: `createRegistrationCustomerMessageBundleSourceResolver()`, task-scoped preview/history/send RPC branches, preview/send fingerprint equality.

- [ ] **Step 1: Write strict bundle source RED tests**

테스트 fixture는 영어와 수학 item을 서로 다른 appointment ID·날짜·장소로 제공한다. parser는 DB order와 무관하게 날짜·시간·과목으로 정렬하고 다음 private contract를 생성해야 한다.

```ts
type RegistrationCustomerMessageBundlePrivateSource = Readonly<{
  bundleId: string
  bundleRevision: number
  parentPhoneDigits: string
  recipientHash: string
  sourceFingerprint: string
  rendered: RegistrationCustomerMessageBundleRendered
  previewContract: RegistrationCustomerMessagePreviewContract
  readinessContract: RegistrationCustomerMessageReadinessContract
}>
```

bundle ID/revision mismatch, 4개 item, 중복 과목, service-date mismatch, appointment type mismatch, stale fingerprint, 잘못된 전화번호를 각각 고유 error로 거절한다.

- [ ] **Step 2: Run source tests and verify RED**

```bash
node --test --experimental-strip-types tests/registration-customer-message-bundle-source.test.mjs
```

Expected: resolver 파일이 없어 FAIL.

- [ ] **Step 3: Implement the bundle source resolver**

```ts
export function createRegistrationCustomerMessageBundleSourceResolver(
  dependencies: Readonly<{
    catalog: RegistrationCustomerMessageBundleCatalog
    recipientHashPepper: string
    resolveSource(input: RegistrationCustomerMessageSourceRequest): Promise<unknown>
  }>,
): RegistrationCustomerMessageBundleSourceResolver
```

public source의 `sourceId`는 항상 task ID다. `facts.reservations`와 body/buttons만 반환한다. phone, bundle ID, revisions, hashes는 WeakMap private source에만 둔다. server HMAC recipient hash와 DB source fingerprint, template checksum을 preview/readiness contract에 묶는다.

- [ ] **Step 4: Write route RED tests**

다음을 검증한다.

- runtime `0`: 기존 single-source route만 동작하고 bundle target는 `bundle_runtime_inactive`로 차단
- runtime `1`: bundle booking target의 source ID는 task ID여야 함
- preview는 전체 현재 snapshot을 반환
- send 전에 같은 task/kind를 다시 resolve하고 fingerprint가 다르면 `409 bundle_stale`
- accepted/unknown/failed_hold인 같은 fingerprint는 duplicate lock
- history는 같은 task/kind의 기존 단건 역사와 신규 bundle 역사를 시간순으로 반환하되 공개 필드만 포함
- provider 호출은 attempt marker 뒤 정확히 한 번

- [ ] **Step 5: Add bundle branches to DB preview/list/claim/finalize RPCs**

기존 함수는 rename한 legacy 구현으로 보존하고 신규 kind일 때만 bundle branch를 실행한다. Preview row와 message row는 `bundle_id`, task ID, bundle revision/fingerprint를 고정한다. Claim 시 최신 source를 다시 materialize하지 않고 현재 원본을 resolve하여 preview fingerprint와 비교한다. 다르면 provider marker 전에 old manifest를 `canceled`로 만들고 새 preview를 요구한다.

`finalize_registration_customer_message_v1()` bundle branch는 message terminal status와 bundle terminal status를 같은 transaction에서 갱신한다. provider result가 불명확하거나 finalize recovery가 필요하면 둘 다 `unknown`으로 보수적으로 마감한다.

- [ ] **Step 6: Wire the production route by runtime and kind**

`createProductionRegistrationCustomerMessageRouteHandlers()`는 server env로 기존 catalog와 bundle catalog를 각각 생성한다. bundle kind면 `resolve_registration_customer_message_bundle_source_v1(messageKind, taskId, null)`을 호출하고, single-source kind면 기존 resolver/RPC를 그대로 사용한다. Browser request는 계속 `{ messageKind, sourceId }`만 받는다.

- [ ] **Step 7: Run focused server tests**

```bash
node --test --experimental-strip-types \
  tests/registration-customer-message-bundle-source.test.mjs \
  tests/registration-customer-message-bundle-route.test.mjs \
  tests/registration-customer-message-route.test.mjs \
  tests/registration-customer-message-service.test.mjs \
  tests/registration-customer-message-solapi.test.mjs
```

Expected: zero failures and provider mock call count 0 before marker, 1 after marker.

- [ ] **Step 8: Run bundle pgTAP and commit Task 3**

```bash
node scripts/run-isolated-supabase-db-tests.mjs \
  supabase/tests/registration_customer_message_bundles_test.sql
git add src/features/tasks/server/registration-customer-message-bundle-source.ts \
  src/features/tasks/server/registration-customer-message-route.ts \
  src/features/tasks/registration-customer-message-service.ts \
  src/features/tasks/registration-customer-message-errors.ts \
  supabase/migrations supabase/tests/registration_customer_message_bundles_test.sql \
  tests/registration-customer-message-bundle-source.test.mjs \
  tests/registration-customer-message-bundle-route.test.mjs \
  tests/registration-customer-message-route.test.mjs
git commit -m "feat: preview bundled registration bookings"
```

---

### Task 4: Exact 10 AM KST Reminder Producer

**Files:**
- Modify: Task 2 migration and pgTAP file
- Modify: `tests/registration-customer-message-bundles-db.test.mjs`
- Modify: `tests/registration-customer-reminder-scheduler.test.mjs`
- Modify: `tests/registration-same-day-customer-reminder.test.mjs`
- Modify: `tests/registration-observation-customer-reminder-worker.test.mjs`

**Interfaces:**
- Consumes: bundle runtime, source collector, existing exact cron `0 1 * * *`.
- Produces: `produce_registration_customer_message_bundle_run_v1()`, `claim_registration_customer_message_bundle_v1()`, backlog/continuation functions, one bundle per task/type/date.

- [ ] **Step 1: Write producer RED tests**

pgTAP clock cases는 KST `09:59:59`, `10:00:00`, `10:04:59`, `10:05:00`을 고정한다. runtime `0`은 항상 0개, runtime `1`은 10:00 이상 10:05 미만에서만 그날 run을 한 번 생성한다. 같은 날짜 두 번째 호출은 item을 추가·변경하지 않고 기존 run ID를 반환한다.

기존 same-day-created/changed exclusion assertion은 제거한다. 예약 생성 시각과 안내 발송 이력에 관계없이 10시 snapshot의 유효 source를 포함해야 한다.

- [ ] **Step 2: Run scheduler tests and verify RED**

```bash
node --test --experimental-strip-types \
  tests/registration-customer-message-bundles-db.test.mjs \
  tests/registration-customer-reminder-scheduler.test.mjs \
  tests/registration-same-day-customer-reminder.test.mjs \
  tests/registration-observation-customer-reminder-worker.test.mjs
```

Expected: bundle producer와 corrected observation timing이 없어 FAIL.

- [ ] **Step 3: Implement one immutable daily run**

```sql
public.produce_registration_customer_message_bundle_run_v1()
returns jsonb
```

service-role JWT만 허용한다. `v_service_date := (clock_timestamp() at time zone 'Asia/Seoul')::date`, `v_scheduled_for := (v_service_date + time '10:00') at time zone 'Asia/Seoul'`로 계산한다. `clock_timestamp()`가 `[v_scheduled_for, v_scheduled_for + interval '5 minutes')` 밖이면 새 run을 만들지 않고 `{created:false, reason:'outside_production_window'}`를 반환한다.

advisory transaction lock과 `service_date unique`로 run을 한 번만 만든 뒤, 세 reservation kind를 task/type/date로 그룹화해 reminder manifest를 생성한다. booking message table은 조회하지 않는다. 모든 과목 취소 시 manifest를 만들지 않는다.

- [ ] **Step 4: Add claim/release/begin/finalize RPCs**

```sql
public.claim_registration_customer_message_bundle_v1() returns jsonb
public.read_registration_customer_message_bundle_source_v1(uuid, uuid) returns jsonb
public.release_registration_customer_message_bundle_v1(uuid, uuid, text) returns void
public.begin_registration_customer_message_bundle_dispatch_v1(uuid, uuid, jsonb, jsonb) returns jsonb
public.finalize_registration_customer_message_bundle_dispatch_v1(uuid, uuid, text, jsonb, text) returns void
public.has_registration_customer_message_bundle_backlog_v1() returns boolean
public.continue_registration_customer_message_bundle_worker_v1() returns bigint
```

Claim은 `delivery_kind='reminder'`, `status='pending'`, `scheduled_for <= now`, 해당 run이 `ready`인 row만 `FOR UPDATE SKIP LOCKED`로 가져온다. Begin은 source/item/revision/recipient/template를 다시 검사한다. 공급자 시도 전 변경이 있으면 같은 run 안에서만 `refresh_count=0`인 bundle을 한 번 새 revision으로 교체하며, 5분 window 밖이거나 두 번째 변경이면 `failed_hold`로 종료한다. marker 이후에는 refresh하지 않는다.

- [ ] **Step 5: Retire observation lead-hours only in runtime 1**

runtime `0`의 기존 `lead_hours` path는 배포 중 동작을 위해 보존한다. runtime `1` producer는 observation도 `service_date + 10 hours`만 사용하며 `lead_hours`를 읽지 않는다. 신규 reminder kinds는 level/visit/observation 각각 분리한다.

- [ ] **Step 6: Verify DB behavior**

```bash
node scripts/run-isolated-supabase-db-tests.mjs \
  supabase/tests/registration_customer_message_bundles_test.sql
node --test --experimental-strip-types \
  tests/registration-customer-reminder-scheduler.test.mjs \
  tests/registration-same-day-customer-reminder.test.mjs \
  tests/registration-observation-customer-reminder-worker.test.mjs
```

Expected: 예약 안내 미발송, 서로 다른 appointment ID, 서로 다른 observation ID가 올바르게 묶이고 provider attempt는 여전히 0.

- [ ] **Step 7: Commit Task 4**

```bash
git add supabase/migrations supabase/tests/registration_customer_message_bundles_test.sql \
  tests/registration-customer-message-bundles-db.test.mjs \
  tests/registration-customer-reminder-scheduler.test.mjs \
  tests/registration-same-day-customer-reminder.test.mjs \
  tests/registration-observation-customer-reminder-worker.test.mjs
git commit -m "feat: produce same-day reminder bundles"
```

---

### Task 5: Bundle Reminder Worker and Runtime Switch

**Files:**
- Create: `src/features/tasks/server/registration-customer-message-bundle-worker.ts`
- Create: `tests/registration-customer-message-bundle-worker.test.mjs`
- Modify: `src/features/tasks/server/registration-customer-reminder-route.ts`
- Modify: `tests/registration-customer-reminder-route.test.mjs`
- Modify: `tests/registration-customer-reminder-worker.test.mjs`

**Interfaces:**
- Consumes: Task 4 RPCs, bundle catalog/source, existing SOLAPI provider.
- Produces: `createRegistrationCustomerMessageBundleWorker()`, runtime-aware worker endpoint, bounded batch and continuation.

- [ ] **Step 1: Write worker RED tests**

Claim type를 고정한다.

```ts
export type RegistrationCustomerMessageBundleClaim = Readonly<{
  bundleId: string
  bundleRevision: number
  messageKind: RegistrationCustomerMessageBundleKind
  claimToken: string
  scheduledFor: string
  requestKey: string
}>
```

idle, preparation failure, source ineligible, one refresh, second refresh hold, marker denied, provider accepted/rejected/timeout, finalize failure, max 25 jobs, 20초 duration, continuation coalescing을 검증한다.

- [ ] **Step 2: Run worker tests and verify RED**

```bash
node --test --experimental-strip-types \
  tests/registration-customer-message-bundle-worker.test.mjs \
  tests/registration-customer-reminder-route.test.mjs
```

Expected: bundle worker와 runtime branch가 없어 FAIL.

- [ ] **Step 3: Implement the provider boundary**

`runOnce()` 순서는 반드시 다음과 같다.

```text
claim -> read/prepare -> begin attempt marker -> provider send once -> finalize
```

`begin.currentStatus === 'refresh_required'`이면 같은 claim에서 prepare/begin을 한 번만 반복한다. provider exception은 `unknown`, provider 호출 뒤 finalize exception도 `unknown` result로 끝낸다. `accepted`, `unknown`, `failed_hold` claim을 두 번째 호출하지 않는다.

- [ ] **Step 4: Add runtime-aware production dependencies**

worker route 시작 시 `get_registration_customer_message_bundle_runtime_v1()`을 한 번 읽는다.

```ts
if (runtime.activeVersion === 1) {
  await dependencies.produceBundleRun()
  return dependencies.bundleWorker.runBatch({ maxJobs: 25, maxDurationMs: 20_000 })
}
return dependencies.legacyWorker.runBatch({ maxJobs: 25, maxDurationMs: 20_000 })
```

runtime `1` continuation은 bundle backlog/RPC만, runtime `0` continuation은 기존 backlog/RPC만 사용한다. 한 request 안에서 runtime이 바뀌면 fail closed하고 provider를 호출하지 않는다.

- [ ] **Step 5: Run focused tests**

```bash
node --test --experimental-strip-types \
  tests/registration-customer-message-bundle-worker.test.mjs \
  tests/registration-customer-reminder-worker.test.mjs \
  tests/registration-customer-reminder-route.test.mjs \
  tests/registration-customer-message-solapi.test.mjs
```

Expected: legacy regression과 bundle worker 모두 PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/features/tasks/server/registration-customer-message-bundle-worker.ts \
  src/features/tasks/server/registration-customer-reminder-route.ts \
  tests/registration-customer-message-bundle-worker.test.mjs \
  tests/registration-customer-reminder-route.test.mjs \
  tests/registration-customer-reminder-worker.test.mjs
git commit -m "feat: dispatch bundled registration reminders"
```

---

### Task 6: Authorized Bundle Summary Projection

**Files:**
- Modify: Task 2 migration and pgTAP file
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `tests/registration-track-service.test.mjs`

**Interfaces:**
- Consumes: current valid source groups, bundle manifest/message terminal state, `can_read_ops_task_v1()`.
- Produces: `get_registration_customer_message_bundle_summaries_v1(uuid)`, runtime read, `OpsRegistrationCaseDetail.customerMessageBundleRuntimeVersion`, `OpsRegistrationCaseDetail.customerMessageBundles`.

- [ ] **Step 1: Write strict service RED tests**

RPC row exact keys:

```text
reservation_kind, service_date, state, scheduled_for, sent_at, updated_at, subjects
```

`subjects`는 영어·수학·과학 중복 없는 표준 순서 array다. duplicate `(reservationKind, serviceDate)`, foreign kind, 잘못된 날짜/timestamp/state, extra phone/provider/hash/token key는 전체 detail load를 거절해야 한다.

- [ ] **Step 2: Run parser tests and verify RED**

```bash
node --test --experimental-strip-types \
  --test-name-pattern='bundle summary' tests/registration-track-service.test.mjs
```

Expected: case-level bundle summary가 없어 FAIL.

- [ ] **Step 3: Add the authorized summary RPC**

```sql
public.get_registration_customer_message_bundle_summaries_v1(p_task_id uuid)
returns table(
  reservation_kind text,
  service_date date,
  state text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  updated_at timestamptz,
  subjects jsonb
)
```

`auth.uid()`와 `dashboard_private.can_read_ops_task_v1(p_task_id)`를 모두 검사한다. State precedence는 `sent → unknown → failed_hold → processing → canceled → scheduled → not_sent`다. 서비스 날짜 전 또는 당일 10시 전 유효 source는 `scheduled`; 당일 10시 이후 유효 source인데 bundle이 없으면 `not_sent`; source가 모두 취소되었고 기존 bundle이 있으면 `canceled`다. provider ID·phone·hash·token은 반환하지 않는다.

- [ ] **Step 4: Replace appointment summary mapping**

Dual-runtime 배포를 위해 `OpsRegistrationAppointment.customerReminder`와 legacy `not_applicable_same_day_created/changed` type은 유지한다. `OpsRegistrationCaseDetailFields`에 다음을 추가한다.

```ts
customerMessageBundleRuntimeVersion: 0 | 1
customerMessageBundles: RegistrationCustomerMessageBundleSummary[]
```

`loadOpsRegistrationCaseDetail()`은 runtime read와 bundle summary RPC를 기존 phase-one `Promise.all`에 포함하고 strict map 결과를 case-level field로 반환한다. runtime `0`에서는 기존 appointment summary도 계속 읽어 legacy UI에 제공하고, runtime `1`에서만 `customerMessageBundles`를 canonical 상태로 사용한다.

- [ ] **Step 5: Run service and DB tests**

```bash
node --test --experimental-strip-types tests/registration-track-service.test.mjs
node scripts/run-isolated-supabase-db-tests.mjs \
  supabase/tests/registration_customer_message_bundles_test.sql
```

Expected: authorized/unauthorized, exact state precedence, no-secret projection 모두 PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add supabase/migrations supabase/tests/registration_customer_message_bundles_test.sql \
  src/features/tasks/registration-track-service.ts tests/registration-track-service.test.mjs
git commit -m "feat: expose registration bundle status"
```

---

### Task 7: One Booking Action per Type and Multi-Item Preview UI

**Files:**
- Create: `src/features/tasks/registration-customer-message-bundle-actions.tsx`
- Create: `tests/registration-customer-message-bundle-ui.test.mjs`
- Modify: `src/features/tasks/registration-alimtalk-preview-dialog.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/registration-appointment-editor.tsx`
- Modify: `src/features/tasks/registration-observation-editor.tsx`
- Modify: `tests/registration-alimtalk-preview-dialog.test.mjs`
- Modify: `tests/registration-reminder-status-ui.test.mjs`
- Modify: `tests/registration-observation-customer-message-ui.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Consumes: task ID, reservation kind, case-level bundle summaries, existing dialog/client.
- Produces: `RegistrationCustomerMessageBundleActions` and task-scoped dialog targets.

- [ ] **Step 1: Write UI RED tests**

다음 DOM 계약을 검증한다.

- 레벨테스트·방문상담·청강 섹션마다 `예약 안내 알림톡` 버튼 최대 1개
- runtime `1`의 subject appointment/observation editor에는 고객 메시지 버튼 0개, runtime `0`에는 기존 버튼 유지
- 버튼 target source ID는 appointment/observation ID가 아니라 task ID
- preview는 `role="list"`와 항목별 과목·날짜·시간·장소를 표시
- 청강 항목은 수업명·선생님 표시
- 수동 리마인드 버튼 0개
- 날짜별 한 줄 상태 예시 `8월 21일 오전 10시 발송 예정 · 영어·수학`
- dirty state, source ambiguity, template 미승인에서는 send disabled와 원인 표시

- [ ] **Step 2: Run UI tests and verify RED**

```bash
node --test --experimental-strip-types \
  tests/registration-customer-message-bundle-ui.test.mjs \
  tests/registration-alimtalk-preview-dialog.test.mjs \
  tests/registration-reminder-status-ui.test.mjs \
  tests/registration-observation-customer-message-ui.test.mjs
```

Expected: 과목별 버튼과 단일 schedule facts 때문에 FAIL.

- [ ] **Step 3: Implement the shared type-level action**

```ts
type RegistrationCustomerMessageBundleActionsProps = Readonly<{
  taskId: string
  runtimeVersion: 0 | 1
  reservationKind: "level_test" | "visit_consultation" | "observation"
  summaries: ReadonlyArray<RegistrationCustomerMessageBundleSummary>
  canManage: boolean
  dirty: boolean
  hasEligibleSource: boolean
  onOpenCustomerMessage(target: RegistrationCustomerMessageTarget): void
}>
```

예약 종류를 bundle booking kind로 매핑하고 `sourceId: taskId`를 전달한다. 상태는 날짜·과목을 한 줄로 표시하고 관리 버튼이나 설명 카드를 추가하지 않는다.

- [ ] **Step 4: Move buttons out of subject editors**

`RegistrationAppointmentEditor`의 `canOpenCustomerMessage`, `onOpenCustomerMessage`, per-appointment reminder label은 dual-runtime 배포를 위해 남긴다. `RegistrationObservationEditor`의 saved/current customer target와 `onOpenCustomerMessage`도 runtime `0`에서만 사용한다. 두 editor 모두 `customerMessageBundleRuntimeVersion` prop을 받아 runtime `1`이면 legacy 버튼/문구를 렌더링하지 않는다.

`RegistrationApplication`은 dirty-key set 크기를 state로 반영하고 runtime `1`일 때만 각 섹션의 editor 아래에 공통 action을 한 번 렌더링한다. Runtime `0`에서는 공통 action을 숨기고 기존 per-source 버튼과 appointment reminder 상태를 그대로 유지한다. 이 조건으로 inactive production 설치 중 현재 발송 동작이 바뀌지 않게 한다.

`activeCustomerMessageTarget` 검증은 runtime `1`의 bundle kind일 때 `target.sourceId === detail.task.id`만 허용한다. waiting/admission은 두 runtime에서 유지하고, single-source booking/observation target는 runtime `0`에서만 허용한다.

- [ ] **Step 5: Render reservation arrays in the existing dialog**

`facts.reservations`가 있으면 scheduleLabel 하나를 표시하는 기존 branch 대신 semantic list를 사용한다.

```tsx
<ul role="list" className="grid gap-2">
  {preview.facts.reservations.map((item) => (
    <li key={`${item.subjectLabel}:${item.scheduleLabel}:${item.placeLabel}`}>
      <p>{item.subjectLabel}</p>
      <p>{item.scheduleLabel} · {item.placeLabel}</p>
      {item.className ? <p>{item.className} · {item.teacherLabel}</p> : null}
    </li>
  ))}
</ul>
```

기존 preview-before-send, expiry, recovery, focus-return 동작은 유지한다.

- [ ] **Step 6: Run UI and workspace regressions**

```bash
node --test --experimental-strip-types \
  tests/registration-customer-message-bundle-ui.test.mjs \
  tests/registration-alimtalk-preview-dialog.test.mjs \
  tests/registration-reminder-status-ui.test.mjs \
  tests/registration-observation-customer-message-ui.test.mjs \
  tests/registration-track-workspace.test.mjs
```

Expected: zero failures.

- [ ] **Step 7: Commit Task 7**

```bash
git add src/features/tasks/registration-customer-message-bundle-actions.tsx \
  src/features/tasks/registration-alimtalk-preview-dialog.tsx \
  src/features/tasks/registration-track-editor.tsx \
  src/features/tasks/registration-appointment-editor.tsx \
  src/features/tasks/registration-observation-editor.tsx \
  tests/registration-customer-message-bundle-ui.test.mjs \
  tests/registration-alimtalk-preview-dialog.test.mjs \
  tests/registration-reminder-status-ui.test.mjs \
  tests/registration-observation-customer-message-ui.test.mjs \
  tests/registration-track-workspace.test.mjs
git commit -m "feat: show task-level booking messages"
```

---

### Task 8: Fixtures, Isolated DB Runner, and Provider-Zero Full Verification

**Files:**
- Create: `scripts/run-registration-customer-message-bundles-local-db-qa.mjs`
- Modify: `src/features/tasks/registration-track-fixtures.ts`
- Modify: `src/features/tasks/registration-track-fixture-runtime.ts`
- Modify: `scripts/verify-registration-customer-message-browser.mjs`
- Modify: `package.json`
- Modify: `tests/registration-track-fixtures.test.mjs`
- Modify: `tests/registration-browser-verifier-contract.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–7 complete feature.
- Produces: clean isolated DB proof, provider-zero browser fixture, repository verification command.

- [ ] **Step 1: Write fixture and runner RED tests**

Fixture는 한 학생에게 영어·수학 레벨테스트가 서로 다른 appointment ID로 있고, 영어·수학 청강이 서로 다른 날짜로 있어야 한다. Booking preview counts는 유형별 1, reminder summary는 날짜별 1이어야 한다. Browser verifier는 `api.solapi.com` request count가 0인지 assert한다.

- [ ] **Step 2: Implement the isolated runner**

새 runner는 임시 work directory와 isolated Supabase instance를 사용해 전체 migration을 clean apply하고 bundle pgTAP만 실행한다. 현재 workspace DB나 linked production을 변경하지 않는다. 종료 시 provider credential env가 비어 있었는지와 provider attempt row 수 0을 확인한다.

`package.json`:

```json
"verify:registration-customer-message:bundles:isolated-db": "node --experimental-strip-types scripts/run-registration-customer-message-bundles-local-db-qa.mjs"
```

- [ ] **Step 3: Implement fixture and browser flow**

fixture client는 task ID target로 전체 예약 목록을 반환하고 send는 in-memory outbox만 갱신한다. Browser verifier는 desktop과 390px에서 세 유형 버튼 수, 다과목 preview, dirty 차단, 상태 한 줄, keyboard focus return을 검증한다.

- [ ] **Step 4: Run source/test gate**

```bash
node --test --experimental-strip-types \
  tests/registration-customer-message-bundle-*.test.mjs \
  tests/registration-customer-message-*.test.mjs \
  tests/registration-customer-reminder-*.test.mjs \
  tests/registration-observation-customer-message-*.test.mjs \
  tests/registration-observation-customer-reminder-worker.test.mjs \
  tests/registration-reminder-status-ui.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-workspace.test.mjs
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

Expected: zero failures. `pnpm build`는 repository script가 이미 webpack을 지정하므로 추가 `-- --webpack`을 붙이지 않는다.

- [ ] **Step 5: Run isolated DB and provider-zero browser gates**

```bash
pnpm verify:registration-customer-message:bundles:isolated-db
pnpm verify:registration-customer-message:browser
```

Expected: clean migration apply, pgTAP zero failures, provider attempt 0, external SOLAPI network 0.

- [ ] **Step 6: Commit Task 8**

```bash
git add scripts/run-registration-customer-message-bundles-local-db-qa.mjs \
  scripts/verify-registration-customer-message-browser.mjs package.json \
  src/features/tasks/registration-track-fixtures.ts \
  src/features/tasks/registration-track-fixture-runtime.ts \
  tests/registration-track-fixtures.test.mjs \
  tests/registration-browser-verifier-contract.test.mjs
git commit -m "test: verify registration message bundles"
```

---

### Task 9: Inactive Production Installation

**Files:**
- No new source files
- Evidence output only; do not store secrets or student data

**Interfaces:**
- Consumes: Tasks 1–8 commits and passing local gates.
- Produces: production schema installed with runtime `0`, new activation all `off`, deployed code capable of both runtimes, zero new provider attempts.

- [ ] **Step 1: Stop for explicit production authorization**

Report local source/tests and isolated DB evidence. Do not apply migration, push `main`, deploy, or change env until the user explicitly authorizes those production actions.

- [ ] **Step 2: Re-discover CLI commands and inspect drift**

```bash
supabase db --help
supabase db push --help
supabase migration list --help
supabase migration list --linked
git status --short --branch
```

Expected: only the planned migration is pending, worktree clean, no unexpected remote migration.

- [ ] **Step 3: Apply the forward migration with runtime inactive**

Use the verified CLI syntax from Step 2. Immediately read back:

```sql
select installed_version, active_version
from dashboard_private.registration_customer_message_bundle_runtime
where singleton;

select message_kind, mode
from dashboard_private.registration_customer_solapi_activation
where message_kind like '%_bundle'
order by message_kind;
```

Expected: `installed_version=1`, `active_version=0`, six rows all `off`. Verify exact cron remains `0 1 * * *`. Verify no bundle customer message has `provider_attempt_count > 0`.

- [ ] **Step 4: Push and verify Vercel Production separately**

Push the reviewed commits to GitHub `main`, then verify GitHub `main` SHA equals the local SHA and Vercel Production for that SHA is `READY`. A successful deploy does not prove migration, runtime, provider, or recipient gates.

- [ ] **Step 5: Run authenticated provider-zero UI/runtime checks**

With runtime `0`, verify current production path still works and 신규 bundle path is hidden/fail-closed. Read bundle runtime, activation, cron, heartbeat, and provider-attempt counts. Expected new provider attempt delta: 0.

- [ ] **Step 6: Report and stop**

Report production migration, `main`/Vercel, authenticated UI, runtime, provider-zero as separate rows. Do not proceed to templates or activation without new approval.

---

### Task 10: Six Template Approval and Controlled Verification

**Files:**
- Vercel server-only environment configuration for six bundle template IDs
- SOLAPI/Kakao template catalog outside git

**Interfaces:**
- Consumes: inactive production installation and exact Task 1 checksums.
- Produces: six approved template receipts, server-only IDs, verification-mode evidence scoped to one synthetic task.

- [ ] **Step 1: Stop for provider authorization**

Show the six exact rendered templates, variables, buttons, checksums, and intended environment keys. Provider template creation/approval and environment changes require explicit user approval.

- [ ] **Step 2: Create and approve six templates**

Create only the six bundle templates from Task 1. Verify provider approval status, Kakao channel, content, variables `#{학생명}`/`#{예약목록}`, three fixed buttons, and `disableSms=true` send contract. Do not reuse an old single-source template ID.

- [ ] **Step 3: Configure server-only template IDs**

Set the six `SOLAPI_REGISTRATION_*_BUNDLE_TEMPLATE_ID` values only in server-side Vercel Production environment. Never use `NEXT_PUBLIC_`. Redeploy and verify `READY`; provider activation remains `off`.

- [ ] **Step 4: Record preflight receipts**

Run admin preflight for all six kinds and store provider status/checksum receipt through the existing private receipt mechanism. Expected: six template receipts match catalog checksum, activation remains `off`, provider sends remain 0.

- [ ] **Step 5: Controlled verification mode**

After separate approval, select one synthetic registration task owned by the user and a user-controlled recipient number. Set one bundle kind at a time to `verification`, preview the full bundle, send once, verify provider accepted, verify recipient receipt, then return the kind to `off`. Repeat only for the kinds explicitly approved for testing. Never use a real student as the verification target.

- [ ] **Step 6: Report provider and recipient separately**

For each kind, report template approved/checksum, provider accepted, and recipient received as independent evidence. `accepted` without recipient confirmation does not close recipient gate.

---

### Task 11: Atomic Cutover and Post-Cutover Observation

**Files:**
- Modify only operational DB activation/runtime rows through the approved RPC
- No source edit during cutover

**Interfaces:**
- Consumes: six approved receipts, required controlled receipts, deployed dual-runtime code, exact cron.
- Produces: runtime `1`, legacy pending jobs canceled before provider, bundle producer active, legacy and bundle send paths never concurrently active.

- [ ] **Step 1: Stop for cutover authorization**

Present all gates through provider/controlled recipient. The cutover transaction and live customer activation require explicit approval.

- [ ] **Step 2: Run pre-cutover read-only checks**

Verify current active runtime, six template receipts, activation modes, exact cron, heartbeat freshness, old pending/claimed/dispatching counts, bundle pending/terminal counts, and provider-attempt counts. Abort if any old `dispatching` message lacks a terminal provider state or any new template receipt drifts.

- [ ] **Step 3: Execute one cutover transaction**

Call an admin-only `activate_registration_customer_message_bundle_runtime_v1(actor, request_key)` RPC implemented in Task 2 migration. It must:

```text
1. advisory-lock the runtime;
2. require active_version = 0 and all six receipts/current activation evidence;
3. cancel only legacy pending/claimed jobs with reason bundle_cutover;
4. preserve legacy dispatching/completed/delivery_unknown and all customer messages;
5. turn legacy booking/reminder automatic paths off;
6. set approved bundle kinds to live;
7. set active_version = 1;
8. commit atomically.
```

If any invariant fails, the whole transaction rolls back. Do not update original appointments/observations.

- [ ] **Step 4: Verify immediate cutover state**

Read back runtime `1`, legacy producer disabled, bundle producer enabled, exact cron unchanged, no simultaneously sendable legacy/new kinds, canceled legacy counts, preserved attempted/terminal counts, and provider attempt delta 0 immediately after cutover.

- [ ] **Step 5: Observe the next 10 AM run**

At the next service day 10:00 KST, verify one run row, grouped bundle/item counts, worker heartbeat, no duplicate bundle per task/type/date, terminal distribution, and provider-attempt count. Inspect only masked/aggregate evidence; do not output student name, phone, body, or provider ID.

- [ ] **Step 6: Verify controlled real behavior**

For an explicitly approved user-controlled case, verify:

```text
same-day English+Math level test -> booking 1, reminder 1
different-day English+Math observation -> booking 1, reminder 1 per date
booking not sent -> reminder still produced at 10 AM
```

Provider accepted and recipient receipt remain separate gates.

- [ ] **Step 7: Final report**

Report source/tests, isolated DB, production migration, `main`/Vercel, authenticated UI, runtime/worker, provider, and recipient evidence separately. State any still-open gate explicitly and do not summarize the whole rollout as complete while one is open.

---

## Final Acceptance Matrix

| Scenario | Booking | Reminder |
|---|---:|---:|
| 같은 날 영어·수학 레벨테스트 | 유형별 1건 | 당일 오전 10시 1건 |
| 서로 다른 날 영어·수학 레벨테스트 | 유형별 1건 | 각 날짜 오전 10시 1건 |
| 같은 날 영어·수학 방문상담 | 유형별 1건 | 당일 오전 10시 1건 |
| 서로 다른 날 영어·수학 청강 | 유형별 1건 | 각 날짜 오전 10시 1건 |
| 레벨테스트와 청강이 함께 존재 | 서로 다른 2건 | 유형별 별도 |
| 예약 안내를 보내지 않음 | 0건 | 정상 생성 |
| 한 과목 취소 | 남은 전체 snapshot | 남은 과목만 |
| 모든 과목 취소 | 발송 차단 | 생성 안 함 |
| 동일 유형·과목 source 2개 | `source_ambiguous` | `source_ambiguous` |
| 오전 10시 이후 일정 변경 | 필요 시 수동 예약 안내 | 자동 재발송 없음 |
| provider timeout/finalize 실패 | `unknown` | `unknown`, 자동 재시도 없음 |
