# Dashboard Load Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 첫 화면의 데이터 요청을 12개 직접 조회에서 2개 제한시간 RPC로 줄이고, 기본 통계를 일정 충돌 원본과 독립적으로 먼저 표시한다.

**Architecture:** 읽기 전용 `security invoker` RPC가 기본 요약과 충돌 원본을 각각 JSONB 스냅샷으로 반환한다. 클라이언트는 사용자·역할·버전별 30초 메모리 캐시로 진행 중 요청과 완료 값을 dedupe하고, 기본 요약 성공 후 충돌 스냅샷을 별도 effect에서 불러와 기존 `buildDashboardMetrics()`에 합친다.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Supabase Postgres/PostgREST, Node test runner, ESLint, Vercel

## Global Constraints

- 기본 통계와 일정 충돌 기능 및 현재 계산 규칙을 모두 유지한다.
- 신규 RPC는 `stable`, `security invoker`, `set search_path = ''`, `authenticated` 전용으로 만든다.
- 신규 RPC와 충돌 할 일 연결 RPC의 클라이언트 제한시간은 정확히 8초이고 `.retry(false)`를 적용한다.
- 충돌 날짜 범위는 기존과 동일하게 최대 400일이다.
- 캐시 TTL은 30초이며 키는 `사용자 ID + 현재 역할 + dashboard-snapshot-v1`이다.
- 실패 값은 캐시하지 않고, 사용자·역할 변경과 명시적 재시도에서 현재 범위 캐시를 무효화한다.
- `academic_events.select("*")`를 사용하지 않는다.
- 서비스 역할 키, 고객 알림, SOLAPI, Google Chat, 유료 플랜 변경, 레거시 수업 정규화는 범위 밖이다.
- 전체 원본 payload는 600KiB 이하, 기본 요약 payload는 200KiB 이하를 성공 기준으로 삼는다.

---

### Task 1: 사용자 범위 스냅샷 캐시와 응답 정규화

**Files:**
- Create: `src/features/dashboard/snapshot-cache.js`
- Create: `src/features/dashboard/snapshot-cache.d.ts`
- Create: `src/features/dashboard/snapshot-sources.js`
- Create: `src/features/dashboard/snapshot-sources.d.ts`
- Create: `tests/dashboard-snapshot-cache.test.mjs`

**Interfaces:**
- Consumes: 브라우저 시간 함수와 RPC가 반환한 `unknown` JSON 값
- Produces: `DASHBOARD_SNAPSHOT_VERSION`, `dashboardSnapshotCache.load(scope, kind, loader, options)`, `dashboardSnapshotCache.invalidate(scope, kind?)`, `normalizeDashboardSummarySources(value)`, `normalizeDashboardConflictSources(value)`

- [ ] **Step 1: 캐시 행동의 실패 테스트 작성**

  `tests/dashboard-snapshot-cache.test.mjs`에서 실제 캐시 factory를 import하고 다음 독립 사례를 literal fixture로 검증한다.

  ```js
  test("dashboard snapshot cache deduplicates in-flight and fresh values", async () => {
    let calls = 0
    let now = 1_000
    const cache = createDashboardSnapshotCache({ now: () => now, ttlMs: 30_000 })
    const loader = async () => ({ call: ++calls })

    const [first, second] = await Promise.all([
      cache.load("user-1:admin:v1", "summary", loader),
      cache.load("user-1:admin:v1", "summary", loader),
    ])
    assert.deepEqual(first, { call: 1 })
    assert.deepEqual(second, { call: 1 })
    assert.equal(calls, 1)

    now += 29_999
    assert.deepEqual(await cache.load("user-1:admin:v1", "summary", loader), { call: 1 })
    now += 2
    assert.deepEqual(await cache.load("user-1:admin:v1", "summary", loader), { call: 2 })
  })
  ```

  같은 파일에 실패 미캐시, `force: true`, 종류별 무효화, 무효화 전에 시작한 느린 응답이 캐시에 기록되지 않는 사례를 추가한다.

- [ ] **Step 2: 캐시 테스트 RED 확인**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/dashboard-snapshot-cache.test.mjs
  ```
  Expected: `snapshot-cache.js` 모듈을 찾지 못해 FAIL.

- [ ] **Step 3: 최소 캐시 구현**

  `snapshot-cache.js`는 `Map`에 `{ value, expiresAt, inFlight, generation }`을 저장한다. `load()`는 같은 키의 유효 값이나 진행 중 Promise를 반환하고, `force` 또는 `invalidate()`는 generation을 증가시킨다. Promise가 끝날 때 캡처한 generation이 현재와 같을 때만 값을 저장하며 reject는 저장하지 않는다.

  ```js
  export const DASHBOARD_SNAPSHOT_VERSION = "dashboard-snapshot-v1"

  export function createDashboardSnapshotCache({ ttlMs = 30_000, now = Date.now } = {}) {
    const entries = new Map()
    const generations = new Map()
    const keyOf = (scope, kind) => `${scope}:${kind}`

    return {
      async load(scope, kind, loader, { force = false } = {}) {
        const key = keyOf(scope, kind)
        if (force) this.invalidate(scope, kind)
        const generation = generations.get(key) || 0
        const current = entries.get(key)
        if (current?.value !== undefined && current.expiresAt > now()) return current.value
        if (current?.inFlight) return current.inFlight

        const inFlight = Promise.resolve().then(loader)
        entries.set(key, { inFlight, generation })
        try {
          const value = await inFlight
          if ((generations.get(key) || 0) === generation) {
            entries.set(key, { value, expiresAt: now() + ttlMs, generation })
          }
          return value
        } catch (error) {
          if (entries.get(key)?.inFlight === inFlight) entries.delete(key)
          throw error
        }
      },
      invalidate(scope, kind) {
        for (const key of [...entries.keys(), ...generations.keys()]) {
          if (key === `${scope}:${kind || ""}` || (!kind && key.startsWith(`${scope}:`))) {
            generations.set(key, (generations.get(key) || 0) + 1)
            entries.delete(key)
          }
        }
      },
    }
  }
  ```

  실제 구현에서는 종류가 아직 로드되지 않은 경우에도 무효화 generation을 보존하도록 exact key를 먼저 갱신하고, 테스트 전용 `clear()`를 production API에 추가하지 않는다.

- [ ] **Step 4: 정규화 실패 테스트 작성**

  summary의 `classes`/`students`와 conflict의 9개 배열 키가 모두 배열일 때만 값을 반환하고, 누락·문자열·null이면 `대시보드 데이터 형식을 확인하지 못했습니다.`를 throw하는 실제 정규화 함수 테스트를 추가한다.

- [ ] **Step 5: 정규화 최소 구현 및 GREEN 확인**

  `snapshot-sources.js`에서 입력이 plain object인지 검사하고 명시한 배열 키만 새 객체로 반환한다. Task 1 테스트를 다시 실행해 전체 PASS를 확인한다.

- [ ] **Step 6: Task 1 검증 및 커밋**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/dashboard-snapshot-cache.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/features/dashboard/snapshot-cache.js src/features/dashboard/snapshot-sources.js tests/dashboard-snapshot-cache.test.mjs
  git diff --check
  ```

  Commit:
  ```bash
  git add src/features/dashboard/snapshot-cache.js src/features/dashboard/snapshot-cache.d.ts src/features/dashboard/snapshot-sources.js src/features/dashboard/snapshot-sources.d.ts tests/dashboard-snapshot-cache.test.mjs
  git commit -m "feat: add dashboard snapshot cache"
  ```

---

### Task 2: 인증 범위를 보존하는 두 개의 읽기 전용 RPC

**Files:**
- Modify: `supabase/migrations/20260809015836_dashboard_snapshot_sources.sql`
- Modify: `tests/dashboard-resource-pressure.test.mjs`

**Interfaces:**
- Consumes: 현재 인증 사용자의 RLS 가시 범위와 `p_date_from date`, `p_date_to date`
- Produces: `public.get_dashboard_summary_sources_v1() returns jsonb`, `public.get_dashboard_conflict_sources_v1(date, date) returns jsonb`

- [ ] **Step 1: SQL 계약 RED 테스트 작성**

  migration 파일을 실제로 읽어 다음을 검증한다.

  ```js
  test("dashboard snapshot RPCs are bounded authenticated security-invoker reads", async () => {
    const sql = (await readFile(snapshotMigrationUrl, "utf8")).toLowerCase().replace(/\s+/gu, " ")
    assert.match(sql, /create or replace function public\.get_dashboard_summary_sources_v1\(\)/)
    assert.match(sql, /create or replace function public\.get_dashboard_conflict_sources_v1\( p_date_from date, p_date_to date \)/)
    assert.match(sql, /security invoker/)
    assert.match(sql, /set search_path = ''/)
    assert.match(sql, /p_date_to - p_date_from\) > 400/)
    assert.doesNotMatch(sql, /select \*/)
    assert.match(sql, /revoke all on function public\.get_dashboard_summary_sources_v1\(\) from public, anon/)
    assert.match(sql, /grant execute on function public\.get_dashboard_conflict_sources_v1\(date, date\) to authenticated/)
  })
  ```

  명시 필드 목록에 `classes.schedule_plan`과 `academic_events.content/created_at`이 없고, `academic_events`에는 `id,title,date,type,school_id,grade,note`만 있는지도 검증한다.

- [ ] **Step 2: SQL 계약 RED 확인**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/dashboard-resource-pressure.test.mjs
  ```
  Expected: 빈 migration에 RPC 정의가 없어 FAIL.

- [ ] **Step 3: summary RPC 구현**

  `jsonb_build_object`와 명시적 subquery projection으로 다음 shape을 반환한다.

  ```sql
  create or replace function public.get_dashboard_summary_sources_v1()
  returns jsonb
  language sql
  stable
  security invoker
  set search_path = ''
  as $$
    select pg_catalog.jsonb_build_object(
      'classes', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data) order by row_data.id) from (
        select id, name, subject, grade, teacher, room, schedule, status,
          start_date, end_date, student_ids, waitlist_ids, schedule_storage_mode
        from public.classes
      ) row_data), '[]'::jsonb),
      'students', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data) order by row_data.id) from (
        select id, name, school, grade, status, class_ids, waitlist_class_ids
        from public.students
      ) row_data), '[]'::jsonb)
    );
  $$;
  ```

- [ ] **Step 4: conflict RPC 구현**

  날짜 검증은 `plpgsql` wrapper에서 수행하고, legacy/normalized 회차 CTE와 현재 9개 보조 테이블의 명시 필드를 JSON 배열로 조립한다. 반환 키는 정확히 `sessionDates`, `classTerms`, `classGroups`, `classGroupMembers`, `teacherCatalogs`, `classroomCatalogs`, `academicSchools`, `academicExamDays`, `academicEventExamDetails`, `academicEvents`로 한다. 각 row key는 기존 mapper가 소비하는 snake_case를 유지한다.

- [ ] **Step 5: 권한과 설명문 추가**

  두 함수의 owner를 postgres로 고정하고 `public, anon`의 모든 권한을 revoke한 뒤 `authenticated`에 execute만 grant한다. transaction은 `begin; ... commit;`으로 감싼다.

- [ ] **Step 6: Task 2 GREEN·정적 검증·커밋**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/dashboard-resource-pressure.test.mjs
  git diff --check
  ```

  SQL을 별도 임시 DB에 적용할 수 없으면 운영 적용 전 `supabase db lint` 대신 Supabase `apply_migration`의 transaction parser와 read-only preflight로 검증한다.

  Commit:
  ```bash
  git add supabase/migrations/20260809015836_dashboard_snapshot_sources.sql tests/dashboard-resource-pressure.test.mjs
  git commit -m "feat: add dashboard snapshot RPCs"
  ```

---

### Task 3: 기본 요약 우선 렌더와 충돌 원본 지연 로드

**Files:**
- Modify: `src/hooks/use-tips-dashboard-metrics.ts`
- Modify: `tests/admin-shell.test.mjs`
- Modify: `tests/dashboard-resource-pressure.test.mjs`

**Interfaces:**
- Consumes: Task 1 cache/normalizer, Task 2 RPCs, `useAuth().user.id`, `useAuth().role`
- Produces: `useTipsDashboardMetrics()` 결과의 `retryCoreSources()`와 `retryConflictSources()`

- [ ] **Step 1: 훅 동작 RED 테스트 작성**

  기존 12개 `.from()` 호출 계약을 제거하고 다음 사용자 관찰 계약을 검증한다.

  - summary RPC는 `get_dashboard_summary_sources_v1` 한 번만 호출한다.
  - conflict RPC는 `get_dashboard_conflict_sources_v1` 한 번만 호출한다.
  - 두 builder 모두 `AbortSignal.timeout(8000)`과 `.retry(false)`를 사용한다.
  - summary 성공 상태는 conflict가 loading/error여도 `isConnected: true`, `error: null`, `isLoading: false`다.
  - 모든 직접 `.from("classes")`, `.from("students")` 및 9개 enrichment table read가 훅에서 사라진다.
  - 캐시 scope는 `${userId}:${role}:${DASHBOARD_SNAPSHOT_VERSION}`이다.

- [ ] **Step 2: 훅 테스트 RED 확인**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/admin-shell.test.mjs tests/dashboard-resource-pressure.test.mjs tests/dashboard-snapshot-cache.test.mjs
  ```
  Expected: 기존 직접 테이블 조회와 `retryExamSources` 계약 때문에 새 assertion이 FAIL.

- [ ] **Step 3: RPC loader와 오류 정규화 구현**

  훅 안에 두 loader를 만들고, timeout/abort/network/`57014`는 `서버 응답이 지연되었습니다. 잠시 후 다시 시도해 주세요.`로 변환한다. Supabase 미설정은 기존 한국어 안내를 유지한다.

  ```ts
  const DASHBOARD_SNAPSHOT_TIMEOUT_MS = 8_000

  async function readDashboardSummarySources() {
    const { data, error } = await supabase!
      .rpc("get_dashboard_summary_sources_v1")
      .abortSignal(AbortSignal.timeout(DASHBOARD_SNAPSHOT_TIMEOUT_MS))
      .retry(false)
    if (error) throw error
    return normalizeDashboardSummarySources(data)
  }
  ```

- [ ] **Step 4: summary effect 구현**

  `useAuth()`의 primitive `user?.id`와 `role`로 scope를 만들고 summary cache를 읽는다. 성공하면 `buildMetrics({ classes, students })`를 즉시 렌더하고 conflict 두 종류를 loading으로 둔다. effect cleanup flag로 이전 사용자의 결과가 현재 상태에 반영되지 않게 한다.

- [ ] **Step 5: conflict effect 구현**

  `coreData`가 준비된 뒤 독립 effect가 conflict cache를 읽는다. session dates를 `attachDashboardClassSessionDates()`로 classes에 붙이고 나머지 원본과 함께 `buildMetrics()`를 다시 호출한다. 실패하면 core metrics를 보존하고 schedule/exam만 error로 바꾼다.

- [ ] **Step 6: 명시적 재시도 구현**

  `retryCoreSources()`는 현재 scope의 summary와 conflict cache를 무효화하고 summary revision을 올린다. `retryConflictSources()`는 conflict 캐시만 무효화하고 conflict revision을 올린다. `useMemo` 반환값과 dependency는 두 callback을 포함한다.

- [ ] **Step 7: Task 3 GREEN·회귀 검증·커밋**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/admin-shell.test.mjs tests/dashboard-resource-pressure.test.mjs tests/dashboard-snapshot-cache.test.mjs tests/dashboard-metrics.test.mjs tests/continuous-class-schedule-consumer-parity.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/hooks/use-tips-dashboard-metrics.ts src/features/dashboard/snapshot-cache.js src/features/dashboard/snapshot-sources.js tests/admin-shell.test.mjs tests/dashboard-resource-pressure.test.mjs tests/dashboard-snapshot-cache.test.mjs
  git diff --check
  ```

  Commit:
  ```bash
  git add src/hooks/use-tips-dashboard-metrics.ts tests/admin-shell.test.mjs tests/dashboard-resource-pressure.test.mjs
  git commit -m "perf: load dashboard summaries before conflicts"
  ```

---

### Task 4: 실패 복구 UI와 충돌 할 일 조회 제한시간

**Files:**
- Modify: `src/app/admin/dashboard/components/section-cards.tsx`
- Modify: `src/features/tasks/ops-task-service.ts`
- Modify: `tests/admin-shell.test.mjs`
- Modify: `tests/ops-task-service-loading.test.mjs`

**Interfaces:**
- Consumes: Task 3의 `retryCoreSources()`와 `retryConflictSources()`
- Produces: 기본 통계 연결 실패와 충돌 원본 실패의 독립 재시도 UI, bounded `listDashboardConflictTaskLinks()`

- [ ] **Step 1: UI와 요청 안전성 RED 테스트 작성**

  `DashboardHeader`는 연결 실패일 때 `다시 시도` 버튼을 보여 `retryCoreSources`를 호출해야 한다. `ConflictWarning`은 schedule 또는 exam이 error이면 한 개의 `retryConflictSources` 버튼을 보여야 한다. ops task service 테스트는 `list_dashboard_conflict_task_links_v1` RPC builder가 8초 AbortSignal과 `.retry(false)`를 받는 실제 fake builder 행동을 검증한다.

- [ ] **Step 2: RED 확인**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/admin-shell.test.mjs tests/ops-task-service-loading.test.mjs
  ```
  Expected: 새 retry callback과 bounded builder가 없어 FAIL.

- [ ] **Step 3: 최소 복구 UI 구현**

  연결 상태 영역은 설명 카드 없이 기존 badge 옆에 compact outline 버튼만 추가한다. 충돌 영역은 schedule/exam error를 하나의 문장과 버튼으로 합쳐 중복 행동을 없앤다. loading과 이미 계산된 rows는 그대로 유지한다.

- [ ] **Step 4: 충돌 할 일 링크 조회에 제한시간 적용**

  ```ts
  const DASHBOARD_CONFLICT_TASK_LINK_TIMEOUT_MS = 8_000

  const { data, error } = await supabase
    .rpc("list_dashboard_conflict_task_links_v1", { p_conflicts: normalized })
    .abortSignal(AbortSignal.timeout(DASHBOARD_CONFLICT_TASK_LINK_TIMEOUT_MS))
    .retry(false)
  ```

  timeout/network 오류는 UI의 기존 action error 경계에서 처리하며 자동 재전송을 추가하지 않는다.

- [ ] **Step 5: Task 4 GREEN·커밋**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/admin-shell.test.mjs tests/ops-task-service-loading.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm eslint src/app/admin/dashboard/components/section-cards.tsx src/features/tasks/ops-task-service.ts tests/admin-shell.test.mjs tests/ops-task-service-loading.test.mjs
  git diff --check
  ```

  Commit:
  ```bash
  git add src/app/admin/dashboard/components/section-cards.tsx src/features/tasks/ops-task-service.ts tests/admin-shell.test.mjs tests/ops-task-service-loading.test.mjs
  git commit -m "fix: make dashboard failures recoverable"
  ```

---

### Task 5: 전체 검증, 운영 migration, 배포와 관찰

**Files:**
- Verify: all changed files
- Apply: `supabase/migrations/20260809015836_dashboard_snapshot_sources.sql`

**Interfaces:**
- Consumes: Tasks 1–4의 커밋과 운영 Supabase project `slnjqlzzhewblvttiidk`
- Produces: 운영 DB RPC, GitHub `main`, Vercel Production, 브라우저·로그 검증 증거

- [ ] **Step 1: 전체 로컬 검증**

  Run:
  ```bash
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/*.test.mjs
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm lint
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm exec tsc --noEmit --pretty false
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm build
  git diff --check
  git status --short
  ```
  Expected: 모든 명령 exit 0, 의도한 migration·소스·테스트·문서만 변경.

- [ ] **Step 2: migration 독립 검토와 운영 전 read-only 기준선**

  migration diff를 다시 읽고 `security definer`, service-role 우회, wildcard projection, mutation이 없는지 확인한다. 운영 DB에서 기존 admin/staff 가시 row count, 현재 payload, lock/session, 최근 API/Auth/Postgres 5xx·statement timeout 기준선을 기록한다.

- [ ] **Step 3: 운영 migration 적용**

  Supabase `apply_migration`에 name `dashboard_snapshot_sources`와 파일 SQL 전체를 전달한다. 적용 후 함수 정의, execute 권한, anon 접근 거부, authenticated 결과 shape를 확인한다.

- [ ] **Step 4: 운영 DB 성능·보안 검증**

  두 RPC의 `EXPLAIN (ANALYZE, BUFFERS)`, JSON byte size, row count를 확인한다. summary ≤200KiB, total ≤600KiB인지 검증하고 security/performance advisor를 확인한다. 관리자/직원 결과 범위가 기존 RLS와 동일한지 비교한다.

- [ ] **Step 5: main 통합과 Vercel 배포**

  원격 main이 기준 커밋에서 이동했는지 fetch 후 확인한다. 이동했다면 feature branch를 최신 origin/main에 rebase/merge하고 전체 검증을 다시 실행한다. 검증된 HEAD를 `origin/main`에 non-force push하고 Vercel Production deployment의 Git SHA, `READY`, custom domain alias를 확인한다.

- [ ] **Step 6: 실제 브라우저 QA**

  로그인된 Chrome에서 `/admin/dashboard`를 새로 열어 기본 통계가 먼저 표시되고 충돌 영역이 뒤이어 완성되는지 확인한다. 30초 내 재진입에서 두 RPC가 반복되지 않는지, 명시적 재시도가 한 RPC만 다시 호출하는지 확인한다. `/admin/registration`, `/admin/makeup-requests`, `/admin/academic-calendar`도 로딩·로그인 회귀가 없는지 확인한다.

- [ ] **Step 7: 운영 로그 30분 관찰**

  배포 직후와 30분 후 Supabase project 상태, API/Auth/Postgres 5xx, statement timeout, lock wait를 비교한다. 신규 대시보드 RPC의 요청 수·지연과 충돌 개수를 기록한다. Vercel runtime log 접근이 불가하면 route 응답·deployment metadata와 Supabase 로그를 분리해 보고한다.

- [ ] **Step 8: 최종 증거 정리**

  코드/test, DB migration, Git push, Vercel READY, 브라우저 관찰, 로그 soak를 각각 별도 항목으로 보고한다. 실제 확인하지 못한 단계는 완료로 표현하지 않는다.
