# 조교 영어 단어 재시험·휴보강 권한 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 조교 계정이 영어 단어 재시험 공동 큐에서 접수·시험 시작·점수 저장·결과 보고까지 수행하게 하고, 담당선생님 단계와 휴보강은 앱과 데이터베이스 모두에서 차단한다.

**Architecture:** 재시험은 기존 `조교팀` 팀 배정을 유지하고 실제 조교 컨텍스트에 teacher catalog에서 계산한 팀을 주입한다. UI는 조교를 assistant 탭에 고정하며, 신규 DB 트리거가 SECURITY DEFINER RPC를 포함한 상태 전이를 조교 단계에 한정한다. 휴보강은 내비게이션·라우트·RLS·테이블 트리거·서비스 역할 승인 API를 함께 막아 우회 경로를 없앤다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, Supabase/PostgreSQL RLS·PL/pgSQL, pgTAP.

## Global Constraints

- `assistant`는 영어 단어 재시험 공동 큐 전체를 조회한다.
- `assistant`는 재시험 접수 추가, 시험 시작, 점수 입력·저장, 미응시 처리, 합격·불합격 결과 보고까지 수행한다.
- 최종 확인, 재재시험 추가, 수정 요청은 담당선생님·관리자·관리팀 단계로 유지한다.
- `/admin/tasks`의 기존 조교 권한은 변경하지 않는다.
- `assistant`는 휴보강 메뉴·검색·직접 URL·데이터 조회·변경 권한이 없다.
- Google Chat, Web Push, SOLAPI 설정과 알림 기능 플래그를 변경하지 않는다.
- 적용된 기존 migration은 수정하지 않는다.

---

## File Structure

- Modify: `src/features/tasks/ops-task-model.js` — 실제 역할과 모드에 따라 재시험 큐 컨텍스트를 계산하는 순수 함수.
- Modify: `src/features/tasks/ops-task-workspace.tsx` — 조교팀 공동 큐, assistant 탭 고정, 기존 조교 단계 액션 연결.
- Modify: `src/components/auth/auth-guard.tsx` — 조교 휴보강 직접 URL 차단.
- Modify: `src/lib/navigation.ts` — 조교 사이드바와 command search에서 휴보강 제거.
- Modify: `src/app/api/makeup-requests/approve/route.ts` — service-role 승인 전에 실제 프로필 역할을 검사.
- Create: `supabase/migrations/20260721093604_assistant_word_retest_makeup_permissions.sql` — 재시험 단계 가드와 휴보강 RLS·mutation 가드.
- Modify: `tests/ops-task-model.test.mjs` — 조교팀 공동 큐 컨텍스트 단위 테스트.
- Modify: `tests/ops-task-workspace.test.mjs` — 실제 조교 탭·URL·액션 계약 테스트.
- Modify: `tests/auth-login.test.mjs` — 휴보강 메뉴·직접 URL 차단 테스트.
- Modify: `tests/notification-makeup-adapter.test.mjs` — 신규 migration과 승인 API 방어선 계약 테스트.
- Modify: `tests/notification-ops-task-producers.test.mjs` — 조교 단계 DB 가드 계약 테스트.
- Modify: `supabase/tests/notification_ops_task_adapters_test.sql` — 조교 재시험 성공·담당선생님 단계 거절 pgTAP.
- Modify: `supabase/tests/notification_makeup_adapter_test.sql` — 조교 휴보강 조회·mutation 거절 pgTAP.

### Task 1: Reproduce the real assistant queue and lock the UI role

**Interfaces:**

- Consumes: `currentUserContext`, `currentUserTaskTeam`, `wordRetestMode`, authenticated `isAssistant`.
- Produces: `getWordRetestRoleContext(input)` returning `{}` for manager access, a team-aware assistant context only in assistant mode, or the original personal context for teacher mode.

- [ ] **Step 1: Write the failing model tests**

Add this import and test to `tests/ops-task-model.test.mjs`:

```js
import { getWordRetestRoleContext, isWordRetestInAssistantQueue } from "../src/features/tasks/ops-task-model.js";

test("actual assistants receive the shared assistant-team word retest queue only in assistant mode", () => {
  const personal = { currentUserId: "assistant-2", currentUserLabel: "김조교", currentUserTeam: "" };
  const assistantContext = getWordRetestRoleContext({
    mode: "assistant",
    isAssistant: true,
    hasTeamWideAccess: false,
    currentUserContext: personal,
    currentUserTaskTeam: "조교팀",
  });
  const task = {
    type: "word_retest",
    status: "requested",
    assigneeId: "",
    assigneeTeam: "조교팀",
  };

  assert.equal(isWordRetestInAssistantQueue(task, assistantContext), true);
  assert.deepEqual(getWordRetestRoleContext({
    mode: "teacher",
    isAssistant: true,
    hasTeamWideAccess: false,
    currentUserContext: personal,
    currentUserTaskTeam: "조교팀",
  }), personal);
});
```

- [ ] **Step 2: Run the model test and verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/ops-task-model.test.mjs
```

Expected: FAIL because `getWordRetestRoleContext` is not exported.

- [ ] **Step 3: Implement the pure queue-context helper**

Add to `src/features/tasks/ops-task-model.js`:

```js
export function getWordRetestRoleContext({
  mode = "assistant",
  isAssistant = false,
  hasTeamWideAccess = false,
  currentUserContext = {},
  currentUserTaskTeam = "",
} = {}) {
  if (hasTeamWideAccess) return {};
  if (isAssistant && mode === "assistant") {
    return { ...currentUserContext, currentUserTeam: text(currentUserTaskTeam) };
  }
  return currentUserContext;
}
```

- [ ] **Step 4: Add failing workspace source-contract assertions**

In `tests/ops-task-workspace.test.mjs`, assert all of the following:

```js
assert.match(source, /const \{ user, session, canManageAll, isAdmin, isStaff, isTeacher, isAssistant \} = useAuth\(\)/);
assert.match(source, /getWordRetestRoleContext\(\{[\s\S]*mode: wordRetestMode[\s\S]*currentUserTaskTeam/);
assert.match(source, /const visibleWordRetestRoleTabs = isAssistant[\s\S]*tab\.key === "assistant"/);
assert.match(source, /if \(isAssistant\) \{[\s\S]*setWordRetestMode\("assistant"\)/);
assert.match(source, /if \(isAssistant && nextMode !== "assistant"\) return/);
```

Expected first run: FAIL because the workspace does not use `isAssistant`, displays both tabs, and accepts `?role=teacher`.

- [ ] **Step 5: Connect the helper and clamp assistant mode**

Modify `src/features/tasks/ops-task-workspace.tsx`:

```tsx
const { user, session, canManageAll, isAdmin, isStaff, isTeacher, isAssistant } = useAuth()

const wordRetestRoleContext = useMemo(() => getWordRetestRoleContext({
  mode: wordRetestMode,
  isAssistant,
  hasTeamWideAccess: canManageAll || isStaff,
  currentUserContext,
  currentUserTaskTeam,
}), [canManageAll, currentUserContext, currentUserTaskTeam, isAssistant, isStaff, wordRetestMode])

const visibleWordRetestRoleTabs = isAssistant
  ? WORD_RETEST_ROLE_TABS.filter((tab) => tab.key === "assistant")
  : WORD_RETEST_ROLE_TABS
```

In the query synchronization effect, handle `isAssistant` first and set `assistant`. In the tab-change handler, return when an assistant requests any mode other than `assistant`. Render `visibleWordRetestRoleTabs` instead of the unconditional constant.

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/ops-task-model.test.mjs tests/ops-task-workspace.test.mjs
```

Expected: PASS.

### Task 2: Enforce the assistant/teacher word-retest boundary in PostgreSQL

**Interfaces:**

- Consumes: `public.current_dashboard_role()`, `auth.uid()`, old/new `ops_tasks` and `ops_word_retests` rows.
- Produces: `dashboard_private.guard_assistant_word_retest_task_v1()` and `dashboard_private.guard_assistant_word_retest_detail_v1()` triggers raising SQLSTATE `42501` with `word_retest_assistant_stage_forbidden`.

- [ ] **Step 1: Add failing migration contract tests**

In `tests/notification-ops-task-producers.test.mjs`, read `supabase/migrations/20260721093604_assistant_word_retest_makeup_permissions.sql` and assert:

```js
assert.match(sql, /guard_assistant_word_retest_task_v1/);
assert.match(sql, /guard_assistant_word_retest_detail_v1/);
assert.match(sql, /current_dashboard_role\(\)[\s\S]*'assistant'/);
assert.match(sql, /old\.status = 'in_progress'[\s\S]*new\.status in \('in_progress', 'review_requested'\)/);
assert.match(sql, /raise exception 'word_retest_assistant_stage_forbidden'[\s\S]*errcode = '42501'/);
assert.doesNotMatch(sql, /drop function dashboard_private\.assert_ops_task_actor_v2/);
```

Expected first run: FAIL with `ENOENT` for the new migration.

- [ ] **Step 2: Add pgTAP assistant-stage scenarios**

Extend `supabase/tests/notification_ops_task_adapters_test.sql` with an assistant profile and teacher-linked task. Assert:

```sql
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000003',
  true
);
select lives_ok($$ select public.transition_ops_task_status_v2(
  (select task_id from ops_task_adapter_fixtures where fixture_key='word'),
  'in_progress',
  (select updated_at from public.ops_tasks where id=(select task_id from ops_task_adapter_fixtures where fixture_key='word')),
  '71000000-0000-4000-8000-000000000061'::uuid
) $$,
  'assistant can start the test');
select lives_ok($$ select public.update_ops_task_v2(
  (select task_id from ops_task_adapter_fixtures where fixture_key='word'),
  '{"word_retest":{"first_score":5,"retest_status":"in_progress"}}'::jsonb,
  (select updated_at from public.ops_tasks where id=(select task_id from ops_task_adapter_fixtures where fixture_key='word')),
  '71000000-0000-4000-8000-000000000062'::uuid
) $$,
  'assistant can save scores');
select lives_ok($$ select public.report_word_retest_result_v1(
  (select task_id from ops_task_adapter_fixtures where fixture_key='word'),
  '{"first_score":5}'::jsonb,
  '71000000-0000-4000-8000-000000000063'::uuid
) $$,
  'assistant can report to the teacher');
select throws_ok($$ select public.transition_ops_task_status_v2(
  (select task_id from ops_task_adapter_fixtures where fixture_key='word'),
  'done',
  (select updated_at from public.ops_tasks where id=(select task_id from ops_task_adapter_fixtures where fixture_key='word')),
  '71000000-0000-4000-8000-000000000064'::uuid
) $$,
  '42501', 'word_retest_assistant_stage_forbidden', 'assistant cannot confirm teacher-stage completion');
```

Keep the existing general-task assistant test unchanged.

- [ ] **Step 3: Create the migration with two restrictive triggers**

Create `supabase/migrations/20260721093604_assistant_word_retest_makeup_permissions.sql` with a transaction, `lock_timeout = '5s'`, prerequisite checks, and these rules:

```sql
if public.current_dashboard_role() = 'assistant' and new.type = 'word_retest' then
  if tg_op = 'INSERT' and new.status <> 'requested' then
    raise exception 'word_retest_assistant_stage_forbidden' using errcode = '42501';
  elsif tg_op = 'UPDATE' and not (
    (old.status in ('requested', 'confirmed', 'on_hold') and new.status in (old.status, 'in_progress', 'review_requested'))
    or (old.status = 'in_progress' and new.status in ('in_progress', 'review_requested'))
  ) then
    raise exception 'word_retest_assistant_stage_forbidden' using errcode = '42501';
  end if;
end if;
```

The detail trigger allows assistant inserts for a requested parent and updates only while the parent is in `requested`, `confirmed`, `on_hold`, or `in_progress`. Define triggers before insert/update on both tables. Revoke all access to both private functions from `public, anon, authenticated, service_role`.

- [ ] **Step 4: Run SQL contract tests**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/notification-ops-task-producers.test.mjs
```

Expected: PASS. Run pgTAP when a linked local database is available:

```bash
supabase test db supabase/tests/notification_ops_task_adapters_test.sql
```

Expected: all assertions pass.

### Task 3: Remove assistant makeup access at every boundary

**Interfaces:**

- Consumes: authenticated dashboard role from `profiles`/`current_dashboard_role()`.
- Produces: no assistant nav/route, zero RLS-visible makeup rows, SQLSTATE `42501` for assistant mutations, HTTP 403 for service-role approval path.

- [ ] **Step 1: Write failing auth/navigation tests**

In `tests/auth-login.test.mjs`, extend the assistant-role test:

```js
const assistantAllowlist = authGuardSource.slice(
  authGuardSource.indexOf("const ASSISTANT_ALLOWED_ADMIN_PATHS"),
  authGuardSource.indexOf("function normalizeAdminPath"),
);
const assistantNav = sidebarSource.includes("buildAdminNavGroups")
  ? await readSource("src/lib/navigation.ts")
  : "";
const assistantItems = assistantNav.slice(
  assistantNav.indexOf("const assistantOverviewItems"),
  assistantNav.indexOf("const fullOverviewItems"),
);

assert.doesNotMatch(assistantAllowlist, /\/admin\/makeup-requests/);
assert.doesNotMatch(assistantItems, /\/admin\/makeup-requests/);
assert.match(assistantAllowlist, /\/admin\/word-retests/);
```

Expected: FAIL because both blocks currently include makeup.

- [ ] **Step 2: Remove makeup from the assistant shell**

Delete only `"/admin/makeup-requests"` from `ASSISTANT_ALLOWED_ADMIN_PATHS` and only the assistant `휴보강` item from `assistantOverviewItems`. Keep the full-role nav item. Command search will inherit the restricted nav automatically.

- [ ] **Step 3: Write failing DB and API contract tests**

In `tests/notification-makeup-adapter.test.mjs`, assert the new migration includes:

```js
assert.match(permissionSql, /makeup_requests_select_involved_or_manager[\s\S]*current_dashboard_role\(\) <> 'assistant'/);
assert.match(permissionSql, /guard_assistant_makeup_mutation_v1/);
assert.match(permissionSql, /makeup_request_assistant_forbidden[\s\S]*errcode = '42501'/);
assert.match(approveRoute, /select\("role"\)[\s\S]*role\) === "assistant"[\s\S]*status[^\n]*403/);
```

Expected: FAIL because neither migration nor route role check exists.

- [ ] **Step 4: Add the hard-deny RLS and table trigger**

In the same new migration, recreate the makeup SELECT/INSERT/UPDATE policies with a leading role predicate:

```sql
public.current_dashboard_role() <> 'assistant'
and (
  public.current_dashboard_role() in ('admin', 'staff')
  or requester_id = auth.uid()
  or teacher_profile_id = auth.uid()
  or approver_profile_id = auth.uid()
)
```

Create `dashboard_private.guard_assistant_makeup_mutation_v1()` as a `SECURITY DEFINER` trigger function. For non-service-role requests, raise `makeup_request_assistant_forbidden`/`42501` whenever `public.current_dashboard_role() = 'assistant'`. Attach it before insert/update/delete on `public.makeup_requests`; revoke execute from all API roles.

- [ ] **Step 5: Reject assistant approval before service-role reads/writes**

After `actorClient.auth.getUser()` succeeds in `src/app/api/makeup-requests/approve/route.ts`, read the actor profile with `serverClient`:

```ts
const { data: actorProfile, error: actorProfileError } = await serverClient
  .from("profiles")
  .select("role")
  .eq("id", actor.user.id)
  .single()
if (actorProfileError) return response({ ok: false, error: "권한을 확인하지 못했습니다." }, 503)
if (text(actorProfile?.role) === "assistant") {
  return response({ ok: false, error: "휴보강 접근 권한이 없습니다." }, 403)
}
```

Place this check before replay and before loading any makeup row.

- [ ] **Step 6: Add pgTAP hard-deny cases**

Extend `supabase/tests/notification_makeup_adapter_test.sql` with an assistant profile. Authenticate as that profile and assert:

```sql
select results_eq($$ select count(*) from public.makeup_requests $$, array[0::bigint],
  'assistant sees no makeup rows');
select throws_ok($$ select public.create_makeup_request_v2(
  jsonb_build_object(
    'request_kind', 'cancel_only',
    'subject', 'english',
    'approval_group', 'english',
    'requester_id', '92000000-0000-4000-8000-000000000004',
    'teacher_catalog_id', '92000000-0000-4000-8000-000000000904',
    'teacher_profile_id', '92000000-0000-4000-8000-000000000004',
    'class_id', '92000000-0000-4000-8000-000000000804',
    'class_name', '조교 차단 fixture',
    'reason', '권한 테스트',
    'cancel_date', '2026-07-28',
    'makeup_slots', '[]'::jsonb,
    'approver_teacher_catalog_id', '92000000-0000-4000-8000-000000000902',
    'approver_profile_id', '92000000-0000-4000-8000-000000000002'
  ),
  '92000000-0000-4000-8000-000000000204'::uuid
) $$,
  '42501', 'makeup_request_assistant_forbidden', 'assistant cannot create makeup');
select throws_ok($$ select public.transition_makeup_request_v2(
  '92000000-0000-4000-8000-000000000101'::uuid,
  'resubmit',
  '{}'::jsonb,
  'revision_requested',
  '92000000-0000-4000-8000-000000000205'::uuid
) $$,
  '42501', 'makeup_request_assistant_forbidden', 'assistant cannot transition makeup');
```

- [ ] **Step 7: Run focused permission tests**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/auth-login.test.mjs tests/notification-makeup-adapter.test.mjs tests/notification-ops-task-producers.test.mjs tests/ops-task-model.test.mjs tests/ops-task-workspace.test.mjs
```

Expected: PASS.

### Task 4: Verify the permission release

- [ ] **Step 1: Run all automated checks**

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/*.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm lint
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm exec tsc --noEmit
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm build
```

Expected: all tests, lint, typecheck, and Webpack build pass.

- [ ] **Step 2: Run database advisors and production-safe verification queries**

Use Supabase advisors after applying the migration. Verify policy expressions from `pg_policies`, verify the three guard triggers from `pg_trigger`, and verify no notification provider flags changed.

- [ ] **Step 3: Browser verification**

Verify an actual assistant account can open `/admin/word-retests`, sees `조교팀` rows, can open/create a retest, start it, save scores, and reach the report action without sending a production report during QA. Confirm only the `조교선생님` tab is visible. Confirm the sidebar and command search omit 휴보강 and `/admin/makeup-requests` redirects to `/admin/tasks`.

- [ ] **Step 4: Commit the independently reviewable permission change**

```bash
git add src/features/tasks/ops-task-model.js src/features/tasks/ops-task-workspace.tsx src/components/auth/auth-guard.tsx src/lib/navigation.ts src/app/api/makeup-requests/approve/route.ts supabase/migrations/20260721093604_assistant_word_retest_makeup_permissions.sql tests/ops-task-model.test.mjs tests/ops-task-workspace.test.mjs tests/auth-login.test.mjs tests/notification-makeup-adapter.test.mjs tests/notification-ops-task-producers.test.mjs supabase/tests/notification_ops_task_adapters_test.sql supabase/tests/notification_makeup_adapter_test.sql
git commit -m "fix: restore assistant word retest operations"
```
