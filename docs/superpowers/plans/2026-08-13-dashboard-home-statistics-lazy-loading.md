# Dashboard Home and Statistics Lazy Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 홈은 오늘 일정과 오늘 할 일만 한 번 조회하고, 현재의 풍부한 통계 UI는 별도 `통계` 메뉴에서 활성 탭을 열 때만 조회하도록 분리한다.

**Architecture:** 홈은 KST 오늘 범위만 계산하는 `get_dashboard_daily_brief_v1()` RPC를 사용한다. 통계 화면은 현재 계산 규칙과 UI를 보존하면서 `운영 현황`, `학생·수업`, `일정·충돌`, `교재` 탭별 집계 RPC를 private server route를 통해 호출한다. route는 인증 사용자의 RLS-visible 결과만 private DB cache에 10분 저장하므로 별도 브라우저에서도 같은 사용자·같은 탭 cache를 재사용한다. client memory cache는 추가 dedupe일 뿐 권위 있는 10분 cache가 아니다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase JS 2.103, PostgreSQL 17/PostgREST, Node test runner, pgTAP, ESLint.

## Global Constraints

- 승인 기준은 `docs/superpowers/specs/2026-08-13-supabase-free-tier-dashboard-notification-optimization-design.md`다.
- 구현은 현재 checkout이 아니라 최신 `origin/main`에서 만든 새 `codex/` branch/worktree에서 시작한다. 계획 작성 시 확인한 기준은 `origin/main` `fad56ae5`이며, 실행 시 다시 fetch하여 최신 SHA를 기록한다.
- 현재 checkout의 문서 commit `98856b6e`와 이 계획 문서 commit만 새 branch에 cherry-pick한다. 현재 checkout은 `origin/main`보다 223 commits 뒤이므로 여기서 애플리케이션 코드를 구현하지 않는다.
- 이미 적용된 `20260808172543_dashboard_class_session_dates.sql`과 `20260809021903_dashboard_snapshot_sources.sql`은 수정하지 않는다. 새 migration만 추가한다.
- 홈은 정확히 daily-brief RPC 하나만 호출한다. `useTipsDashboardMetrics`, 기존 summary/conflict RPC, 전체 classes/students 배열은 홈에서 호출하지 않는다.
- 통계의 기존 수치 의미와 subject/division 필터를 먼저 보존한 뒤 query 경계를 바꾼다. 수치 의미 변경은 이 계획 범위 밖이다.
- 탭은 `overview | students_classes | schedule_conflicts | textbooks`로 고정한다. 통계 접근 권한은 현재 `/admin/dashboard` 접근 권한과 같고 assistant 권한은 넓히지 않는다.
- 10분 server cache는 사용자 ID, 역할, contract version, 탭, subject, division, 기간으로 분리한다. cache payload는 집계값과 표시용 conflict rows만 허용하며 원본 학생 row를 저장하지 않는다. client memory cache는 진행 중 요청 dedupe만 하고 localStorage/IndexedDB에는 아무것도 저장하지 않는다.
- 업무 저장마다 모든 사용자 통계 cache row를 갱신/무효화하는 write fan-out은 만들지 않는다. 통계는 최대 10분의 명시적 staleness를 허용하고 `generatedAt`을 표시하며, 즉시 확인이 필요한 사용자는 현재 actor/key의 수동 새로고침을 사용한다. roster/class drilldown은 cache하지 않아 열 때 최신 RLS-visible 값을 읽는다.
- `schedule_conflicts`는 학원 전체의 교사·강의실 교차 충돌을 계산하므로 subject/division filter를 받지 않는다. 다른 탭 filter가 conflict query를 좁히지 않는다.
- 기간 기본값은 `schedule_conflicts=KST 오늘~+90일`, `textbooks=최근 90일`이다. conflict는 90/180/400일, 교재 진도는 30/90/180/365일로만 넓힐 수 있다. `overview`와 `students_classes`는 현재 상태 snapshot이며 날짜 parameter를 받지 않는다.
- 이 계획을 먼저 완료한 뒤 `2026-08-13-dashboard-query-surface-optimization.md`를 최신 결과 위에 rebase하여 순차 실행한다. 두 계획을 별도 stale worktree에서 병렬 구현하지 않는다.
- 모든 신규 읽기는 명시적 projection, filter, order, limit 또는 집계만 사용한다. 신규 `select('*')`를 금지한다.
- 코드 구현, 로컬 migration 검증, 운영 migration, GitHub `main`, Vercel Production은 별도 단계다. 이 계획을 실행한다고 운영 DB 적용이나 배포가 자동 승인되지 않는다.
- 이 계획과 뒤 세 계획의 모든 신규 migration은 공용 `dashboard-free-tier-v1.manifest.json`에서 `draft -> candidate -> final` lifecycle과 exact SHA-256을 가져야 한다. unmanifested/draft/null/hash-drift migration은 격리 DB와 CI에서 실행하지 않는다.

## Fixed Runtime Commands

```bash
export TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
export TASK_PNPM=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
export TASK_SUPABASE=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase
export TASK_REQUEST_ID=$(/usr/bin/uuidgen | /usr/bin/tr '[:upper:]' '[:lower:]')
export TASK_ORIGIN_MAIN_SHA=$(git rev-parse origin/main)
```

각 task를 시작할 때 같은 shell에서 위 다섯 줄을 실행하고 모든 `Run:` block을 그 shell에서 실행한다. 새 shell이면 다섯 줄을 모두 다시 실행한다. 문서의 local-only 승인 명령은 반드시 `--request-id "$TASK_REQUEST_ID"`를 사용하며 literal placeholder를 실행하지 않는다.

## File and Responsibility Map

### New files

- `supabase migration new dashboard_daily_brief`가 생성한 exact migration path
  - KST 오늘의 레벨테스트·방문상담·청강·업무 수와 가장 가까운 일정 5건을 반환한다.
- `supabase migration new dashboard_statistics_sources`가 생성한 exact migration path
  - 네 통계 탭 집계 RPC와 사용자 행동 기반 roster/class drilldown RPC를 설치한다.
- `supabase migration new dashboard_statistics_cache`가 생성한 exact migration path
  - private 10분 cache table과 service-role-only public cache wrappers를 설치한다.
- `supabase/tests/dashboard_daily_brief_test.sql`
  - RLS, KST 날짜 경계, 최대 5건, daily-brief payload shape를 실제 DB에서 검증한다.
- `supabase/tests/dashboard_statistics_sources_test.sql`
  - 네 탭 enum/filter/range, rich aggregate parity, drilldown cursor/ACL을 실제 DB에서 검증한다.
- `supabase/tests/dashboard_statistics_cache_test.sql`
  - cache claim/lease/generation/ACL/cleanup을 실제 DB에서 검증한다.
- `src/features/dashboard/daily-brief-contract.ts`
- `src/features/dashboard/daily-brief-service.ts`
- `src/features/dashboard/use-dashboard-daily-brief.ts`
- `src/features/dashboard/dashboard-daily-brief.tsx`
- `src/features/dashboard/statistics-contract.ts`
- `src/features/dashboard/statistics-cache.ts`
- `src/features/dashboard/use-statistics-snapshot.ts`
- `src/features/dashboard/statistics-workspace.tsx`
- `src/features/dashboard/statistics-drilldown.tsx`
- `src/app/admin/statistics/page.tsx`
- `src/features/dashboard/server/statistics-route.ts`
- `src/app/api/dashboard/statistics/route.ts`
- `src/app/api/dashboard/statistics/drilldown/route.ts`
- `scripts/run-isolated-supabase-db-tests.mjs`
- `scripts/capture-dashboard-free-tier-catalog.mjs`
- `scripts/fixtures/dashboard-free-tier-baseline-scope.json`
- `scripts/fixtures/supabase-management-read-only-query-contract.json`
- `supabase/test-baselines/dashboard-free-tier-v1.sql`
- `supabase/test-baselines/dashboard-free-tier-v1.manifest.json`
- `supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json`
- `supabase/tests/dashboard_free_tier_catalog_parity_test.sql`
- `supabase/tests/dashboard_free_tier_baseline_smoke_test.sql`
- `tests/isolated-supabase-db-tests.test.mjs`
- `tests/dashboard-daily-brief.test.mjs`
- `tests/statistics-snapshot-cache.test.mjs`
- `tests/statistics-resource-pressure.test.mjs`
- `tests/statistics-workspace.test.mjs`

### Existing files to modify

- `src/app/admin/dashboard/page.tsx`
  - `useTipsDashboardMetrics()`와 `SectionCards`를 제거하고 daily brief만 렌더링한다.
- `src/app/admin/dashboard/components/section-cards.tsx`
  - 통계 presentation과 conflict presentation을 feature-level component로 분리한다.
- `src/features/dashboard/metrics.js`
  - 요청한 통계 slice만 계산하는 builder를 추가하고 기존 `buildDashboardMetrics()`를 호환 wrapper로 남긴다.
- `src/hooks/use-tips-dashboard-metrics.ts`
  - 생산 route import를 모두 제거한 뒤 기존 regression fixture를 위한 deprecated compatibility hook으로만 남긴다. 새 통계 route는 이 hook을 사용하지 않는다.
- `src/lib/navigation.ts`
  - 기존 dashboard와 같은 role group에 `/admin/statistics`를 추가한다.
- `tests/dashboard-metrics.test.mjs`
- `tests/admin-shell.test.mjs`
- `tests/continuous-class-schedule-consumer-parity.test.mjs`
- `tests/ops-browser-dashboard-word-retest-contract.test.mjs`
  - 기존 계산, navigation, 일정 충돌 호환성을 검증한다.

## Public Contracts

```ts
export type DashboardDailyBriefItem = {
  sourceKind: "level_test" | "visit_consultation" | "observation_class"
  sourceId: string
  scheduledAt: string | null
  title: string
  subjectLabels: string[]
  placeLabel: string | null
  href: string
}

export type DashboardDailyBrief = {
  localDate: string
  generatedAt: string
  counts: {
    levelTests: number
    visitConsultations: number
    observationClasses: number
    openTasks: number
  }
  upcoming: DashboardDailyBriefItem[]
}

export type DashboardStatisticsTab =
  | "overview"
  | "students_classes"
  | "schedule_conflicts"
  | "textbooks"

export type DashboardOverviewRequest = {
  tab: "overview"
  subject: "all" | "english" | "math" | "science"
  division: "all" | "middle" | "high"
}

export type DashboardStudentsClassesRequest = {
  tab: "students_classes"
  subject: "all" | "english" | "math" | "science"
  division: "all" | "middle" | "high"
}

export type DashboardScheduleConflictsRequest = {
  tab: "schedule_conflicts"
  dateFrom: string
  dateTo: string
}

export type DashboardTextbooksRequest = {
  tab: "textbooks"
  subject: "all" | "english" | "math" | "science"
  dateFrom: string
  dateTo: string
}

export type DashboardStatisticsRequest =
  | DashboardOverviewRequest
  | DashboardStudentsClassesRequest
  | DashboardScheduleConflictsRequest
  | DashboardTextbooksRequest

type StatisticsEnvelope<Tab extends DashboardStatisticsTab, Data> = {
  tab: Tab
  generatedAt: string
  expiresAt: string
  cacheStatus: "hit" | "miss" | "refresh"
  data: Data
}

export type DashboardBucketSummary = {
  activeClassesCount: number
  registeredEnrollmentCount: number
  waitlistEnrollmentCount: number
  uniqueRegisteredStudentCount: number
  uniqueWaitlistStudentCount: number
  schoolCount: number
  gradeCount: number
  weeklyMinutes: number
  weeklyHoursLabel: string
}

export type DashboardBreakdownRow = {
  key: string
  label: string
  enrollmentCount: number
  studentCount: number
  children: Array<{
    key: string
    label: string
    enrollmentCount: number
    studentCount: number
  }>
}

export type DashboardClassGroupRow = {
  key: string
  label: string
  classCount: number
  studentCount: number
  enrollmentCount: number
  weeklyMinutes: number
  weeklyHoursLabel: string
}

export type DashboardStudentRef = {
  id: string
  name: string
  school: string
  grade: string
}

export type DashboardClassSummaryRow = {
  id: string
  title: string
  subject: string
  scheduleLabel: string
  teacherLabel: string
  classroomLabel: string
  studentCount: number
  enrollmentCount: number
  weeklyMinutes: number
  weeklyHoursLabel: string
}

export type DashboardDrilldownPage<Row> = {
  rows: Row[]
  nextCursor: { sortValue: string; id: string } | null
  hasMore: boolean
}

export type DashboardStatisticsDrilldownResponse =
  | { kind: "student_roster"; page: DashboardDrilldownPage<DashboardStudentRef> }
  | { kind: "class_group"; page: DashboardDrilldownPage<DashboardClassSummaryRow> }
  | { kind: "class_roster"; page: DashboardDrilldownPage<DashboardStudentRef> }

export type DashboardOverviewResponse = StatisticsEnvelope<"overview", {
  summary: DashboardBucketSummary
}>

export type DashboardStudentsClassesResponse = StatisticsEnvelope<"students_classes", {
  summary: DashboardBucketSummary
  studentBreakdowns: {
    byGrade: DashboardBreakdownRow[]
    bySchool: DashboardBreakdownRow[]
  }
  classGroups: {
    byGrade: DashboardClassGroupRow[]
    byTeacher: DashboardClassGroupRow[]
    byClassroom: DashboardClassGroupRow[]
  }
}>

export type DashboardScheduleConflictsResponse = StatisticsEnvelope<"schedule_conflicts", {
  range: { dateFrom: string; dateTo: string }
  teacherConflicts: DashboardConflictRow[]
  classroomConflicts: DashboardConflictRow[]
  examConflicts: DashboardConflictRow[]
}>

export type DashboardTextbooksResponse = StatisticsEnvelope<"textbooks", {
  range: { dateFrom: string; dateTo: string }
  activeTitles: number
  activeClassesWithTextbook: number
  activeClassesWithoutTextbook: number
  progressSessions: { pending: number; partial: number; done: number }
  updatedProgressSessions: number
}>

export type DashboardStatisticsResponse =
  | DashboardOverviewResponse
  | DashboardStudentsClassesResponse
  | DashboardScheduleConflictsResponse
  | DashboardTextbooksResponse

export type DashboardStatisticsDrilldownRequest =
  | {
      kind: "student_roster"
      subject: DashboardOverviewRequest["subject"]
      division: DashboardOverviewRequest["division"]
      axis: "grade" | "school" | "grade_school" | "school_grade"
      key: string
      parentKey: string | null
      cursor: { sortValue: string; id: string } | null
    }
  | {
      kind: "class_group"
      subject: DashboardOverviewRequest["subject"]
      division: DashboardOverviewRequest["division"]
      axis: "grade" | "teacher" | "classroom"
      key: string
      cursor: { sortValue: string; id: string } | null
    }
  | {
      kind: "class_roster"
      classId: string
      cursor: { sortValue: string; id: string } | null
    }
```

`upcoming`에는 예약 일정만 넣고 task는 `openTasks` count로만 표시한다. open task는 KST 오늘 `due_at`이고 status가 `requested | confirmed | in_progress | on_hold`인 row다. `upcoming`에는 학생 전화번호, 상담 내용, 메시지 본문을 넣지 않는다.

기존 rich UI의 학생 명단과 수업 목록은 aggregate cache에 넣지 않는다. 사용자가 분포 row나 수업 group을 펼칠 때만 `student_roster`, `class_group`, `class_roster` drilldown을 각각 30건 keyset page로 읽고 같은 popover/expand UI에 `다음 30명/개`를 제공한다. 따라서 학교·학년 nested counts, 교사/강의실 group, 주간 시수, 수업 요약은 그대로 보이고 개인 roster만 행동 시 lazy-load된다.

---

### Task 1: 최신 main 기준선과 기존 통계 의미 고정

**Files:**
- Test: `tests/dashboard-metrics.test.mjs`
- Test: `tests/dashboard-resource-pressure.test.mjs`
- Test: `tests/admin-shell.test.mjs`
- Create: `scripts/run-isolated-supabase-db-tests.mjs`
- Create: `scripts/capture-dashboard-free-tier-catalog.mjs`
- Create: `scripts/fixtures/dashboard-free-tier-baseline-scope.json`
- Create: `scripts/fixtures/supabase-management-read-only-query-contract.json`
- Create: `supabase/test-baselines/dashboard-free-tier-v1.sql`
- Create: `supabase/test-baselines/dashboard-free-tier-v1.manifest.json`
- Create: `supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json`
- Create: `supabase/tests/dashboard_free_tier_catalog_parity_test.sql`
- Create: `supabase/tests/dashboard_free_tier_baseline_smoke_test.sql`
- Create: `tests/isolated-supabase-db-tests.test.mjs`

- [ ] **Step 1: 새 worktree를 최신 main에서 만든다**

  `superpowers:using-git-worktrees`를 먼저 읽고, latest `origin/main`에서 `codex/dashboard-free-tier-optimization` worktree를 만든다. `git rev-list --left-right --count HEAD...origin/main`이 `0 0`인지 확인한 뒤 문서 commits만 cherry-pick한다.

- [ ] **Step 2: source-controlled baseline과 isolated local DB harness를 RED/GREEN으로 만든다**

  이 저장소의 active migration history는 최초 product schema 생성 이전의 remote baseline을 전제로 하므로 blank `supabase init`에 전체 history나 일부 target migration만 replay하지 않는다. `scripts/fixtures/dashboard-free-tier-baseline-scope.json`은 새 네 계획이 참조하는 schema/relation/type/collation/function/role/policy/trigger identity를 wildcard 없이 literal allowlist로 소유한다. 운영 row, UUID, 학생 정보, secret, Vault/cron/webhook value는 scope와 출력에서 금지한다.

  authoritative producer는 `scripts/capture-dashboard-free-tier-catalog.mjs` 하나로 고정한다. `scripts/fixtures/supabase-management-read-only-query-contract.json`은 구현 당일 다시 검토한 [official Supabase Management API reference](https://supabase.com/docs/reference/api/introduction)의 method `POST`, path template `/v1/projects/{ref}/database/query/read-only`, OAuth scope `database:read`, fine-grained permission `database_read`, JSON request required `query:string`/optional `parameters:unknown[]`, success status `201`, schema-qualified entity requirement와 error statuses `401|403|429|500`을 literal로 pin한다. endpoint는 Beta이므로 fixture와 공식 문서가 달라지면 코드를 자동 보정하지 않고 DB lane을 blocked로 둔다. producer는 env `SUPABASE_DATABASE_READ_TOKEN`, `SUPABASE_PROJECT_REF`, `TASK_ORIGIN_MAIN_SHA`와 다음 exact invocation만 받는다. token은 해당 project로 제한된 fine-grained token이고 `database_read`만 부여한다. broad legacy PAT, service-role key, database password, `database_write` permission token을 승인 input으로 사용하지 않는다.

  ```bash
  "$TASK_NODE" scripts/capture-dashboard-free-tier-catalog.mjs \
    --mode execute \
    --authorized \
    --request-id "$TASK_REQUEST_ID" \
    --origin-main-sha "$TASK_ORIGIN_MAIN_SHA" \
    --scope scripts/fixtures/dashboard-free-tier-baseline-scope.json \
    --catalog supabase/test-baselines/dashboard-free-tier-origin-main-catalog.json \
    --baseline supabase/test-baselines/dashboard-free-tier-v1.sql \
    --parity-test supabase/tests/dashboard_free_tier_catalog_parity_test.sql
  ```

  script는 `git rev-parse origin/main`과 argument SHA가 다르거나 token/project ref가 argv에 있으면 거부한다. 첫 HTTP 전에 fixed read-only statement IDs/checksums만 출력하고, `Authorization: Bearer <SUPABASE_DATABASE_READ_TOKEN>`와 `Content-Type: application/json`, body `{ "query": <schema-qualified fixed statement>, "parameters": [] }`로 pinned endpoint 한 곳만 호출한다. status 201과 JSON object만 success이며 200/204/redirect/non-JSON/unknown keys needed by parser는 `management_api_contract_drift`다. 401은 `credential_invalid`, 403은 `database_read_permission_missing`, 429는 `rate_limited_no_output`, 404/405는 `endpoint_contract_drift`, 500은 `provider_unavailable_no_output`으로 fail-closed한다. test fixture는 각 status, redirect, write endpoint fallback 0, token/header/stdout redaction을 고정한다. 한 MVCC statement에서 `supabase_migrations.schema_migrations`의 sorted `(version,name,statements_sha256)` ledger와 scoped catalog를 함께 읽어 `migrationLedgerCount`, `migrationLedgerMaxVersion`, `migrationLedgerSha256`, `originMainSha`, server major를 고정한다. write-capable `/database/query`, `read_only:true` compatibility endpoint, DB password fallback은 없다. endpoint/permission/snapshot drift면 output 세 파일을 atomic rename하지 않고 실패한다.

  normalization은 UTF-8 NFC, object key lexicographic order, arrays `(objectKind,schema,identity)` order, bigint decimal string, absent value null로 고정한다. catalog JSON에는 relation row types/columns/default hashes/constraints, policies/RLS, schema/table/function/sequence/default ACLs, function signatures/owners/security/search-path/body hash, 그리고 audit 대상 일곱 table의 BEFORE/AFTER trigger 이름/function/order만 저장하고 raw SQL/row/secret은 넣지 않는다. baseline SQL은 same snapshot의 allowlisted definitions만 `role/schema/type/collation/sequence/table/default/constraint/index/function/RLS/policy/grant/trigger` 순서로 emit하고 FK는 모든 table 뒤에 둔다. dependency가 scope 밖이거나 cycle/secret-like literal/Vault/cron/webhook definition을 만나면 fail-closed한다. parity pgTAP은 catalog의 literal identities와 normalized SHA-256을 source-controlled expectations로 emit한다. 세 artifacts와 scope diff는 사람이 검토하고 `originMainSha` 및 migration-ledger identifiers가 latest-main review 기록과 일치해야만 commit한다. 사용자 승인 없는 production read-only access가 필요하거나 reviewed artifacts를 만들 수 없으면 DB runtime lane은 blocked이며 Node/source tests만으로 pgTAP PASS를 주장하지 않는다.

  `dashboard-free-tier-v1.manifest.json`은 `baselineVersion`, 기준 `originMainSha`, baseline/catalog SHA-256, required object signature 목록과 `orderedNewMigrations: []`를 처음부터 유효한 JSON으로 소유한다. migration은 CLI로 이름을 만든 직후 filename만 manifest에 `status:"draft",sha256:null`로 추가한다. SQL body와 RED source tests가 준비되면 DB test 실행 직전에 current SHA-256을 기록하고 `status:"candidate"`로 바꾼다. harness는 candidate를 exact hash가 일치할 때만 격리 DB에서 실행한다. 실패 후 SQL을 한 byte라도 수정하면 hash mismatch로 다음 실행이 막히므로 새 candidate hash를 명시적으로 기록한다. 모든 pgTAP/probe가 GREEN이고 commit 직전 동일 hash일 때만 `status:"final"`로 승격한다. CI와 전체 완료 gate는 final만 허용하고 candidate/draft/null/hash drift가 하나라도 있으면 실패한다. baseline DDL을 temp DB에 적용한 뒤 normalized catalog를 다시 추출하여 authoritative catalog JSON의 모든 scoped definition/ACL/trigger order와 exact parity인지 확인한다. parity drift는 자동 생성으로 덮지 않고 review에서 fail-closed한다.

  CLI는 `--test <repo-relative-sql>`과 `--probe <repo-relative-node-script>`를 반복해서 받고 `--execute --authorized --request-id "$TASK_REQUEST_ID"`가 없으면 plan만 출력한다. execute는 validated `/private/tmp/tips-supabase-db-qa-$TASK_REQUEST_ID`의 빈 directory를 만든다. 아래 commands는 harness가 `cwd="$TASK_TEMP_WORKDIR"` child process로 exact order 실행하며 어느 단계든 non-zero면 target test를 건너뛰고 `finally`로 간다.

  ```bash
  "$TASK_SUPABASE" init --workdir "$TASK_TEMP_WORKDIR" --yes
  # harness atomically replaces generated config with its sanitized unique config
  "$TASK_SUPABASE" db start --workdir "$TASK_TEMP_WORKDIR" --yes
  "$TASK_SUPABASE" test db --local --workdir "$TASK_TEMP_WORKDIR" \
    supabase/tests/dashboard_free_tier_catalog_parity_test.sql \
    supabase/tests/dashboard_free_tier_baseline_smoke_test.sql
  # only after both prerequisite tests pass, copy manifest-ordered candidate/final migrations
  "$TASK_SUPABASE" migration up --local --workdir "$TASK_TEMP_WORKDIR" --include-all
  "$TASK_SUPABASE" test db --local --workdir "$TASK_TEMP_WORKDIR" "${TASK_TEST_PATHS[@]}"
  # run each requested probe only after target pgTAP passes
  "$TASK_SUPABASE" stop --workdir "$TASK_TEMP_WORKDIR" \
    --project-id "$TASK_TEMP_PROJECT_ID" --no-backup --yes
  ```

  `init` 직후 harness가 generated unique `project_id`, reserved loopback ports, analytics/studio/inbucket off를 가진 sanitized temp `supabase/config.toml`을 원자적으로 쓴다. repository config나 production project ID/ref/ports를 복사하지 않는다. temp config에는 generated ID/ports만 있고 production ref와 linked metadata가 0이어야 한다. `db start` 전에는 baseline만 `supabase/migrations/00000000000000_dashboard_free_tier_test_baseline.sql`로, parity/smoke files만 tests dir로 복사한다. prerequisite GREEN 뒤에만 manifest ordered candidate-or-final migrations와 requested exact target tests/probes를 복사한다.

  local URL은 `"$TASK_SUPABASE" status --workdir "$TASK_TEMP_WORKDIR" --output json`의 stdout을 parent memory로 capture하여 exact `DB_URL` key 하나만 parse한다. host가 `127.0.0.1|localhost`, port가 generated config 값, database가 `postgres`가 아니면 거부한다. URL은 argv/stdout/file에 쓰지 않고 probe child env `TASK_LOCAL_DB_URL`로만 전달하며, probe는 이 env와 one-time `TASK_LOCAL_DB_NONCE`가 없으면 실행을 거부한다. target test path array는 repo-relative `.sql` only, probe array는 repo-relative `.mjs` only로 validate하고 shell interpolation을 하지 않는다. `finally`는 start 시도 후 항상 위 exact `stop --project-id ... --no-backup --yes`를 한 번 실행한 다음 validated temp prefix만 제거한다. linked flag, production ref/token/password, unmanifested/draft migration을 거부하고 repository의 다른 local instance를 reset/stop하지 않는다. fixture는 exact command order/arguments, child exit/stdout redaction, catalog/baseline/hash/migration-ledger drift, missing dependency, temp-config isolation, probe env isolation, target array validation, 실패 시 teardown을 검증한다.

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/isolated-supabase-db-tests.test.mjs`

- [ ] **Step 3: 현재 집중 회귀 기준선을 실행한다**

  Run:
  ```bash
  "$TASK_NODE" --test --experimental-strip-types \
    tests/dashboard-snapshot-cache.test.mjs \
    tests/dashboard-resource-pressure.test.mjs \
    tests/dashboard-metrics.test.mjs \
    tests/admin-shell.test.mjs \
    tests/continuous-class-schedule-consumer-parity.test.mjs \
    tests/ops-browser-dashboard-word-retest-contract.test.mjs
  ```
  Expected: 구현 시작 SHA에서 모두 PASS. 실패하면 새 기능을 작성하지 않고 baseline drift를 먼저 분리한다.

- [ ] **Step 4: SQL aggregate의 JS parity oracle RED 테스트를 추가한다**

  runtime authority는 Task 4의 SQL aggregate 하나로 고정한다. `buildDashboardMetricsSlice(input, { tab, subject, division, dateFrom, dateTo })`는 production workspace에서 import하지 않는 순수 parity oracle로만 추출한다. 기존 `buildDashboardMetrics()` fixture와 SQL aggregate fixture가 overview/students/classes/conflict에서 같은 수치를 반환하는지 검증한다. 교재 탭은 기존 UI 보존 대상이 아니라 승인 설계의 신규 경량 집계이므로 `activeTitles`, 수업 교재 배정/미배정, 지정 기간 progress 상태 수치를 별도 literal SQL fixture로 고정한다.

- [ ] **Step 5: 최소 호환 parity builder를 구현한다**

  `buildDashboardMetrics()`는 모든 기존 fixture를 통과하게 남기고 slice builder도 test/parity에서만 사용한다. 새 workspace는 JS builder를 호출하지 않고 SQL aggregate response만 렌더링한다. 계산 함수의 이름·단위·분모를 바꾸지 않는다.

- [ ] **Step 6: 검증하고 커밋한다**

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/dashboard-metrics.test.mjs tests/continuous-class-schedule-consumer-parity.test.mjs`

  Run: `git diff --check`

  Commit: `refactor: isolate dashboard statistic slices`

---

### Task 2: 홈 daily brief DB 계약

**Files:**
- Create via CLI: generated `dashboard_daily_brief` migration
- Create: `supabase/tests/dashboard_daily_brief_test.sql`
- Create: `tests/dashboard-daily-brief.test.mjs`

- [ ] **Step 1: SQL/source 계약 RED 테스트를 작성한다**

  먼저 `"$TASK_SUPABASE" migration new dashboard_daily_brief`를 실행하고 생성된 exact path를 task log/test constant와 공용 manifest의 `orderedNewMigrations`에 `draft`/null hash로 기록한다. SQL+RED test 뒤 DB test 직전에 current SHA-256의 `candidate`, pgTAP GREEN 뒤 commit 직전에 동일 hash의 `final`로 승격하며 이후 steps는 그 path만 수정한다.

  다음 불변조건을 검사한다.

  - `get_dashboard_daily_brief_v1()`는 `stable security invoker set search_path = ''`다.
  - `Asia/Seoul`의 현재 날짜를 한 번 계산한다.
  - `status='scheduled'` 예약만 집계하고 취소·완료를 제외한다.
  - `upcoming`은 `scheduled_at, source_id` 순서와 `limit 5`를 가진다.
  - open task는 KST 오늘 `due_at`이며 status가 `requested`, `confirmed`, `in_progress`, `on_hold` 중 하나다.
  - 함수는 `public, anon`에서 revoke하고 `authenticated`에만 grant한다.
  - `select *`, 전화번호, 상담 내용, 전체 row JSON을 포함하지 않는다.

- [ ] **Step 2: RED를 확인한다**

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/dashboard-daily-brief.test.mjs`

  Expected: migration/contract가 없어 FAIL.

- [ ] **Step 3: 한 statement snapshot으로 RPC를 구현한다**

  핵심 날짜 경계는 다음과 같이 고정한다.

  ```sql
  with bounds as (
    select
      (pg_catalog.statement_timestamp() at time zone 'Asia/Seoul')::date as local_date,
      ((pg_catalog.statement_timestamp() at time zone 'Asia/Seoul')::date::timestamp
        at time zone 'Asia/Seoul') as starts_at,
      (((pg_catalog.statement_timestamp() at time zone 'Asia/Seoul')::date + 1)::timestamp
        at time zone 'Asia/Seoul') as ends_at
  )
  ```

  레벨테스트·방문상담·청강은 최신 `public.ops_registration_appointment_calendar`의 canonical row를 사용하고, 업무는 `public.ops_tasks`의 기존 RLS 가시 범위를 사용한다. 반환 JSON은 count 4개와 예약 일정 5개만 만든다. task `due_at`은 count에는 포함하지만 upcoming 배열에는 섞지 않는다.

- [ ] **Step 4: pgTAP으로 날짜/권한을 검증한다**

  KST 00:00/23:59, canceled/completed, 동일 시각 tie-breaker, 6건 입력 시 5건, 권한 없는 task 제외를 검증한다. fixture transaction은 rollback한다.

- [ ] **Step 5: 검증하고 커밋한다**

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/dashboard-daily-brief.test.mjs`

  Run: `"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/dashboard_daily_brief_test.sql`

  Commit: `feat: add dashboard daily brief contract`

---

### Task 3: 홈을 daily brief 한 요청으로 교체

**Files:**
- Create: `src/features/dashboard/daily-brief-contract.ts`
- Create: `src/features/dashboard/daily-brief-service.ts`
- Create: `src/features/dashboard/use-dashboard-daily-brief.ts`
- Create: `src/features/dashboard/dashboard-daily-brief.tsx`
- Modify: `src/app/admin/dashboard/page.tsx`
- Modify: `tests/dashboard-daily-brief.test.mjs`
- Modify: `tests/admin-shell.test.mjs`

- [ ] **Step 1: 홈 zero-statistics RED 테스트를 작성한다**

  `dashboard/page.tsx`가 `useTipsDashboardMetrics`, `SectionCards`, `get_dashboard_summary_sources_v1`, `get_dashboard_conflict_sources_v1`를 참조하지 않고 daily brief hook만 렌더링해야 한다. service fake는 RPC 한 번을 기록해야 한다.

- [ ] **Step 2: strict normalizer와 service를 구현한다**

  ```ts
  const result = await supabase
    .rpc("get_dashboard_daily_brief_v1")
    .abortSignal(AbortSignal.timeout(8_000))
    .retry(false)
  ```

  배열 길이 5 이하와 알려진 source kind를 검증한다. 오류는 홈 navigation을 막지 않고 compact retry 상태만 표시한다.

- [ ] **Step 3: 설명 없이 바로 행동 가능한 홈을 구현한다**

  오늘 네 count, 가장 가까운 일정 5개, 등록/업무/학사/통계 바로가기만 남긴다. rich 통계, conflict 계산, 교재 source는 import하지 않는다.

- [ ] **Step 4: GREEN과 회귀를 확인한다**

  Run:
  ```bash
  "$TASK_NODE" --test --experimental-strip-types \
    tests/dashboard-daily-brief.test.mjs \
    tests/admin-shell.test.mjs \
    tests/ops-browser-dashboard-word-retest-contract.test.mjs
  ```

- [ ] **Step 5: 커밋한다**

  Commit: `perf: replace dashboard home with daily brief`

---

### Task 4: 통계 탭별 DB source 계약

**Files:**
- Create via CLI: generated `dashboard_statistics_sources` migration
- Create: `supabase/tests/dashboard_statistics_sources_test.sql`
- Create: `tests/statistics-resource-pressure.test.mjs`

- [ ] **Step 1: 탭 계약 RED 테스트를 작성한다**

  먼저 `"$TASK_SUPABASE" migration new dashboard_statistics_sources`를 실행하고 exact path를 공용 manifest에 `draft`/null hash로 기록한다. SQL+RED test 뒤 DB test 직전에 current SHA-256의 `candidate`, pgTAP GREEN 뒤 commit 직전에 동일 hash의 `final`로 승격한다. `get_dashboard_statistics_sources_v1(p_tab text, p_subject text default null, p_division text default null, p_date_from date default null, p_date_to date default null)`가 탭별 allowed parameter 조합과 최대 기간을 검증하고 위 discriminated response의 `data` key만 반환하는지 검사한다. `select *`, 전체 audit/message content, schedule_plan 전체 JSON을 금지한다. `students_classes` aggregate는 nested counts/group counts만 반환하며 student name/ID와 class summaries를 포함하지 않는다.

  같은 migration이 shared `dashboard_private.ko_numeric` ICU collation을 `locale='ko-u-kn-true'`, deterministic으로 `create ... if not exists` 설치하고 catalog definition이 다르면 fail-closed한다. 뒤 query-surface 계획은 이 collation을 재생성하지 않고 존재/정의만 검사한다. 따라서 이 계획의 drilldown RPC가 뒤 migration에 의존하지 않는다.

- [ ] **Step 2: RED를 확인한다**

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/statistics-resource-pressure.test.mjs`

- [ ] **Step 3: 탭별 branch를 명시적으로 구현한다**

  - `overview`: classes/students의 기존 KPI 필드만
  - `students_classes`: 학생 분포·수업 운영 계산에 필요한 필드만
  - `schedule_conflicts`: 기존 `list_dashboard_class_session_dates_v1`와 conflict source의 지정 기간을 학원 전체로 계산하고 subject/division parameter는 null만 허용
  - `textbooks`: active textbook 수, active class의 textbook 배정/미배정, 지정 기간 progress status/update count만 집계

  overview/students_classes/textbooks에만 subject filter를 적용하고 overview/students_classes에만 division filter를 적용한다. 빈 문자열/unknown enum/탭에 금지된 parameter를 거부한다. 400일 conflict 선택에서 기존 academy-wide conflict fixture와 exact parity를 검증한다.

- [ ] **Step 4: 행동 기반 drilldown RPC를 구현한다**

  `list_dashboard_statistics_student_roster_v1(...)`와 `list_dashboard_statistics_class_group_v1(...)`는 위 request enum만 허용하고 `(normalized_name,id)` keyset으로 server 31/read 30을 반환한다. normalized name은 query-surface 계획의 `btrim -> internal whitespace collapse -> null sentinel -> dashboard_private.ko_numeric` expression을 predicate/order/returned cursor에 동일하게 적용한다. class group row에는 roster를 포함하지 않는다. `list_dashboard_statistics_class_roster_v1(p_class_id,p_cursor_name,p_cursor_id,p_limit)`도 30명 page다. route는 request `kind`와 같은 `DashboardStatisticsDrilldownResponse` branch만 반환한다. 모두 security invoker/fixed search_path/authenticated-only이며 현재 dashboard role/RLS 범위를 보존한다. aggregate 화면을 열 때 이 세 RPC query count는 0이다.

- [ ] **Step 5: ACL, shape, payload budget을 pgTAP으로 검증한다**

  모든 탭은 RLS 가시 범위를 유지한다. 각 탭 fixture payload는 200KiB 이하를 목표로 하고, 초과하면 UI 구현 전에 projection을 다시 줄인다.

- [ ] **Step 6: 검증하고 커밋한다**

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/statistics-resource-pressure.test.mjs tests/dashboard-metrics.test.mjs`

  Run: `"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/dashboard_statistics_sources_test.sql`

  Commit: `feat: add lazy dashboard statistics sources`

---

### Task 5: private server 10분 cache와 활성 탭 hook

**Files:**
- Create via CLI: generated `dashboard_statistics_cache` migration
- Create: `supabase/tests/dashboard_statistics_cache_test.sql`
- Create: `src/features/dashboard/statistics-contract.ts`
- Create: `src/features/dashboard/statistics-cache.ts`
- Create: `src/features/dashboard/use-statistics-snapshot.ts`
- Create: `src/features/dashboard/server/statistics-route.ts`
- Create: `src/app/api/dashboard/statistics/route.ts`
- Create: `tests/statistics-snapshot-cache.test.mjs`
- Modify: `tests/statistics-resource-pressure.test.mjs`

- [ ] **Step 1: server cache RED 테스트를 작성한다**

  먼저 `"$TASK_SUPABASE" migration new dashboard_statistics_cache`를 실행하고 exact path를 공용 manifest에 `draft`/null hash로 기록한다. SQL+RED test 뒤 DB test 직전에 current SHA-256의 `candidate`, pgTAP GREEN 뒤 commit 직전에 동일 hash의 `final`로 승격한다. 별도 route handler/client 두 개가 같은 사용자·role·tab/filter로 요청할 때 첫 요청만 statistics RPC를 계산하고 다음 요청은 private DB cache hit인지 검증한다. 정확히 599,999ms까지 hit, 600,001ms에서 miss, concurrent claim dedupe, 실패 미저장, 사용자/역할/탭/filter 격리, force refresh, invalidation 후 느린 응답 폐기를 검증한다. 24시간 지난 expired rows 25개 fixture에서는 한 claim이 정확히 20개만 지우고 다른 actor row는 건드리지 않아야 한다.

- [ ] **Step 2: 선택 탭만 호출하는 RED 테스트를 작성한다**

  초기 `overview` 한 번, 탭 변경 때 새 탭 한 번, 이미 본 탭 10분 내 재진입 0회, inactive tab 0회를 fake RPC로 검증한다.

- [ ] **Step 3: exact private DB cache CAS RPC를 구현한다**

  migration의 `dashboard_private.dashboard_statistics_cache`는 `actor_profile_id`, role, contract_version, request_hash, tab, generation, status(computing|ready), claim_token, lease_expires_at, generated_at, expires_at, payload만 저장하고 raw source row를 금지한다. `(actor_profile_id,role,contract_version,request_hash)`는 unique다. PostgREST wrappers는 아래 signature/result를 고정한다.

  ```sql
  public.read_dashboard_statistics_cache_v1(p_actor_profile_id uuid,p_role text,p_request_hash text,p_contract_version text)
    -> {status:'ready',generation,payload,generated_at,expires_at} | {status:'miss'}
  public.claim_dashboard_statistics_cache_v1(p_actor_profile_id uuid,p_role text,p_request_hash text,p_contract_version text,p_tab text,p_force boolean)
    -> {status:'acquired',generation,claim_token,lease_expires_at}
     | {status:'ready',generation,payload,generated_at,expires_at}
     | {status:'wait',generation,lease_expires_at}
  public.finalize_dashboard_statistics_cache_v1(p_actor_profile_id uuid,p_role text,p_request_hash text,p_contract_version text,p_generation bigint,p_claim_token uuid,p_payload jsonb)
    -> {status:'stored',generated_at,expires_at} | {status:'superseded'}
  public.invalidate_dashboard_statistics_cache_v1(p_actor_profile_id uuid,p_role text,p_request_hash text,p_contract_version text,p_expected_generation bigint)
    -> {status:'invalidated',generation} | {status:'stale'}
  ```

  wrappers는 SECURITY DEFINER/fixed empty search_path/service-role-only다. private helpers/table과 public wrappers 모두 PUBLIC/anon/authenticated execute/access를 revoke한다. claim lease는 15초다. lease가 만료된 `computing` row는 다음 claimant가 generation을 증가시키고 takeover할 수 있다. force refresh/invalidation도 generation을 증가시킨다. finalize는 matching claim token/generation만 허용해 느린 이전 응답을 버린다. claim은 같은 actor의 `expires_at < now()-24h` row를 deterministic order로 최대 20개만 opportunistic delete하며 별도 cron을 만들지 않는다. route는 bearer session을 검증한 뒤 actor-scoped cache를 읽고, miss에서 acquired claimant만 그 사용자의 JWT client로 security-invoker statistics RPC를 계산한다. `wait`를 받은 loser는 100ms, 250ms, 500ms에 read를 최대 세 번 다시 하고 ready면 hit를 반환한다. 여전히 computing이면 `503 statistics_cache_busy`와 `Retry-After: 1`을 반환하며 자체 계산이나 lease 탈취를 하지 않는다. 다른 actor cache는 읽을 수 없다.

- [ ] **Step 4: server route와 client in-flight cache를 구현한다**

  cache key는 다음 순서를 고정한다.

  ```ts
  [userId, role, "dashboard-statistics-v1", tab, subject, division, dateFrom, dateTo].join(":")
  ```

  browser는 `GET /api/dashboard/statistics`에 bearer와 validated query만 보낸다. route의 Supabase RPC는 8초 timeout과 `.retry(false)`를 사용한다. `refresh=1`은 exact actor/request key만 invalidate한 뒤 다시 계산한다. server가 반환한 `generatedAt`, `expiresAt`, `cacheStatus`를 UI에 표시하고 cache key/payload에는 access token을 저장하지 않는다.

- [ ] **Step 5: 기간 preset과 cancellation을 구현한다**

  conflict 기본은 오늘~+90일이며 90/180/400일, textbooks 기본 최근 90일이며 30/90/180/365일 button만 제공한다. preset 변경은 이전 request를 abort하고 새 cache key를 호출한다. URL query `range`는 allowlist 값만 복원한다.

- [ ] **Step 6: GREEN과 lint를 확인한다**

  Run: `"$TASK_NODE" --test --experimental-strip-types tests/statistics-snapshot-cache.test.mjs tests/statistics-resource-pressure.test.mjs`

  Run: `"$TASK_PNPM" eslint src/features/dashboard/statistics-cache.ts src/features/dashboard/use-statistics-snapshot.ts src/features/dashboard/server/statistics-route.ts src/app/api/dashboard/statistics/route.ts tests/statistics-snapshot-cache.test.mjs`

  Run: `"$TASK_NODE" scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/dashboard_statistics_cache_test.sql`

- [ ] **Step 7: 커밋한다**

  Commit: `perf: cache active statistics tab`

---

### Task 6: 기존 통계 UI를 별도 route로 이동

**Files:**
- Create: `src/features/dashboard/statistics-workspace.tsx`
- Create: `src/features/dashboard/statistics-drilldown.tsx`
- Create: `src/app/admin/statistics/page.tsx`
- Create: `src/app/api/dashboard/statistics/drilldown/route.ts`
- Modify: `src/app/admin/dashboard/components/section-cards.tsx`
- Modify: `src/lib/navigation.ts`
- Create: `tests/statistics-workspace.test.mjs`
- Create: `tests/statistics-drilldown.test.mjs`
- Modify: `tests/admin-shell.test.mjs`

- [ ] **Step 1: route/navigation RED 테스트를 작성한다**

  `/admin/statistics`가 기존 dashboard role group과 command search에 나타나고, 홈에서 통계 component가 사라졌으며, inactive 탭 panel이 mount되지 않는지 검사한다.

- [ ] **Step 2: presentation component를 추출한다**

  `DashboardHeader`, `KpiStrip`, `StudentDistributionPanel`, `ClassOperationsPanel`, `ConflictWarning`의 계산 의존성을 feature-level로 옮긴다. 기존 presentation의 모양과 지표 label, 학교/학년 nested counts, 교사/강의실 grouping, 주간 시수는 동일하게 유지한다. `ConflictWarning`은 academy-wide `schedule_conflicts` 탭에서만 mount한다. 신규 `TextbookStatisticsPanel`은 위 response의 다섯 수치, 기간 preset, empty/error state만 보여 준다.

- [ ] **Step 3: 네 탭 workspace를 구현한다**

  tab selection을 먼저 바꾸고 해당 panel만 mount한다. 탭 실패는 해당 panel에서만 retry하고 다른 탭과 navigation을 막지 않는다. 마지막 갱신 시각과 수동 새로고침 한 개만 둔다.

- [ ] **Step 4: rich drilldown을 행동 시점에 연결한다**

  분포 row를 펼칠 때만 student-roster route, 수업 group을 펼칠 때만 class-group route, class popover를 열 때만 class-roster route를 호출한다. 각 결과는 30건 append/dedupe와 `다음 30명/개`, loading/retry/end state를 제공한다. 화면/탭 최초 mount에서 drilldown RPC는 0이고, 한 group 실패가 aggregate나 다른 group을 막지 않는다. route는 bearer session을 검증하고 사용자 JWT client로 security-invoker RPC를 호출하며 service role을 사용하지 않는다.

- [ ] **Step 5: navigation과 접근 권한을 연결한다**

  `resolveAdminWorkspaceMeta()`와 `fullOverviewItems`에 통계를 추가한다. 기존 dashboard가 보이지 않는 assistant에게 통계를 새로 노출하지 않는다.

- [ ] **Step 6: GREEN, typecheck, lint를 확인한다**

  Run:
  ```bash
  "$TASK_NODE" --test --experimental-strip-types \
    tests/statistics-workspace.test.mjs \
    tests/statistics-drilldown.test.mjs \
    tests/statistics-resource-pressure.test.mjs \
    tests/admin-shell.test.mjs \
    tests/dashboard-metrics.test.mjs \
    tests/continuous-class-schedule-consumer-parity.test.mjs
  "$TASK_PNPM" exec tsc --noEmit --pretty false
  "$TASK_PNPM" eslint src tests middleware.ts next.config.ts
  ```

- [ ] **Step 7: 커밋한다**

  Commit: `feat: move dashboard analytics to statistics`

---

### Task 7: 전체 로컬 검증과 구현 완료 경계

**Files:**
- Verify: all files changed by Tasks 1–6

- [ ] **Step 1: 전체 검증을 실행한다**

  ```bash
  "$TASK_NODE" --test --experimental-strip-types tests/*.test.mjs tests/*.node.ts
  "$TASK_PNPM" exec tsc --noEmit --pretty false
  "$TASK_PNPM" eslint src tests middleware.ts next.config.ts
  "$TASK_PNPM" build
  git diff --check
  git status --short
  ```

- [ ] **Step 2: query invariant를 확인한다**

  source test 또는 local browser fixture에서 다음을 기록한다.

  - `/admin/dashboard`: daily-brief RPC 1, statistics RPC 0, conflict RPC 0
  - `/admin/statistics` 초기: active tab RPC 1
  - 다른 탭을 열기 전: 그 탭 RPC 0
  - 같은 탭 10분 내 재진입: RPC 0
  - 별도 browser client의 같은 actor/key 재요청: statistics 계산 RPC 0, server cache hit 1
  - conflict range 400일: 기존 academy-wide fixture exact parity

- [ ] **Step 3: 구현 phase를 커밋하고 멈춘다**

  Commit: `test: verify lazy dashboard query boundaries`

  여기서 source 구현 완료를 보고하고 멈춘다. 운영 migration, `main` push, Vercel Production은 별도 사용자 승인 단계다.

## Separately Authorized Rollout Gates

다음은 구현 Task가 아니며 각각 별도 승인과 증거가 필요하다.

1. 운영 전 read-only DB baseline과 EXPLAIN/BUFFERS
2. 세 신규 migration을 하나씩 운영 적용하고 ACL/result 검증
3. 최신 `main` 통합과 GitHub push
4. Vercel Production `READY`와 deployment SHA 확인
5. 실제 브라우저에서 홈 1-query와 통계 lazy-load 확인
6. Supabase Disk I/O/API/Auth/Postgres 로그 30분 관찰
