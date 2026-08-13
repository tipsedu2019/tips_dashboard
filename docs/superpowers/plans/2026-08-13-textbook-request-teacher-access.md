# 교재관리 요청 탭 선생님 전체 열람·등록 권한 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 선생님이 전체 교재 요청을 보고 자신의 이름으로 새 요청을 등록하되, 주문·입고 이후 운영 권한은 관리자·스태프로 유지한다.

**Architecture:** 기존 `request` 읽기 범위는 그대로 유지한다. 새 요청 저장은 RLS를 우회하는 직접 테이블 쓰기 대신 역할·작성자·상태를 서버에서 고정하는 `create_textbook_request_v1` RPC로 통합한다. 화면은 선생님에게 요청 목록과 새 요청 폼만 열고, 기존 요청의 상세·이동·삭제 동작은 관리자·스태프에게만 전달한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase Postgres/RLS/RPC, Node built-in test runner.

## Global Constraints

- 선생님은 전체 요청을 읽을 수 있지만 새 `requested` 요청만 생성할 수 있다.
- 새 요청의 `created_by`와 `requested_by`는 서버에서 현재 `auth.uid()`로 결정하며 클라이언트가 지정할 수 없다.
- 주문·입고·재고·출고·정산과 기존 요청 update/delete 권한은 관리자·스태프 전용으로 유지한다.
- 교재명, 수업, 위치, 학생용·교사용 요청 수량, 메모만 요청 생성 입력으로 허용한다.
- 모든 동작 변경은 테스트를 먼저 추가하고, 실패를 확인한 뒤 최소 구현으로 통과시킨다.

---

## File structure

- `supabase/migrations/20260813053000_textbook_teacher_request_access.sql` — 선생님 안전 요청 생성 RPC와 실행 권한을 정의한다.
- `src/features/textbooks/textbook-service.ts` — RPC 호출만 담당하는 `createTextbookRequest` 서비스 함수를 추가한다.
- `src/features/textbooks/textbook-operations-workspace.tsx` — 선생님 요청 생성 UI, 현재 요청자 표시, 관리 동작 차단을 담당한다.
- `tests/textbook-management-schema.test.mjs` — 마이그레이션 RPC의 역할·데이터 제한 계약을 잠근다.
- `tests/textbook-workspace.test.mjs` — 서비스 RPC 호출과 화면 권한 경계를 잠근다.

### Task 1: 서버에서 선생님 요청 생성 권한을 한정한다

**Files:**

- Create: `supabase/migrations/20260813053000_textbook_teacher_request_access.sql`
- Modify: `tests/textbook-management-schema.test.mjs`

**Interfaces:**

- Produces: `public.create_textbook_request_v1(p_textbook_id uuid, p_requested_textbook_title text, p_class_id uuid, p_location_id uuid, p_student_requested_quantity integer, p_teacher_requested_quantity integer, p_memo text) returns jsonb`
- Produces: JSON object `{ order, lines }` where `order` is a `textbook_purchase_orders` row and `lines` contains the newly created student/teacher scope rows.

- [ ] **Step 1: Write the failing migration contract test**

Add a test named `textbook teacher request migration creates only server-owned requested rows` to `tests/textbook-management-schema.test.mjs`. Read the new migration by its exact file name and assert all of the following source contracts:

```js
assert.match(sql, /^begin;/)
assert.match(sql, /create or replace function public\.create_textbook_request_v1\(/)
assert.match(sql, /v_actor_id uuid := auth\.uid\(\)/)
assert.match(sql, /v_role text := coalesce\(public\.current_dashboard_role\(\), ''\)/)
assert.match(sql, /v_role not in \('admin', 'staff', 'teacher'\)/)
assert.match(sql, /status, requested_by, created_by[\s\S]*'requested', v_requester_name, v_actor_id/)
assert.match(sql, /ordered_quantity, received_quantity[\s\S]*0, 0/)
assert.match(sql, /copy_scope[\s\S]*'student'/)
assert.match(sql, /copy_scope[\s\S]*'teacher'/)
assert.match(sql, /revoke all on function public\.create_textbook_request_v1[\s\S]*from public, anon/)
assert.match(sql, /grant execute on function public\.create_textbook_request_v1[\s\S]*to authenticated/)
```

- [ ] **Step 2: Run the migration contract test and verify it fails**

Run: `node --test --experimental-strip-types tests/textbook-management-schema.test.mjs`

Expected: FAIL because `20260813053000_textbook_teacher_request_access.sql` does not exist.

- [ ] **Step 3: Add the minimal RPC migration**

Create the migration as one transaction. Define `public.create_textbook_request_v1` as `security definer`, owned by `postgres`, with `set search_path = public, pg_temp`. The function must:

```sql
if v_actor_id is null or v_role not in ('admin', 'staff', 'teacher') then
  raise exception 'textbook_request_access_denied' using errcode = '42501';
end if;
if nullif(btrim(p_requested_textbook_title), '') is null then
  raise exception 'textbook_request_title_required' using errcode = '22023';
end if;
if greatest(coalesce(p_student_requested_quantity, 0), 0)
 + greatest(coalesce(p_teacher_requested_quantity, 0), 0) <= 0 then
  raise exception 'textbook_request_quantity_required' using errcode = '22023';
end if;
```

Resolve `v_requester_name` in this order: linked visible `teacher_catalogs.name` for the actor, `profiles.name`, JWT email, actor UUID. Insert exactly one `textbook_purchase_orders` row with `status = 'requested'`, `created_by = v_actor_id`, the resolved requester name, no supplier, and no statement. Insert one line per positive scope quantity with `requested_quantity` set, `ordered_quantity = 0`, `received_quantity = 0`, the supplied class/location/memo, and `copy_scope` equal to `'student'` or `'teacher'`. Do not insert a stock move. Return the order and inserted lines through `jsonb_build_object`.

End with `revoke all ... from public, anon; grant execute ... to authenticated; commit;`.

- [ ] **Step 4: Run the migration contract test and verify it passes**

Run: `node --test --experimental-strip-types tests/textbook-management-schema.test.mjs`

Expected: PASS with the new RPC contracts and existing schema contracts intact.

- [ ] **Step 5: Commit the server contract**

```bash
git add supabase/migrations/20260813053000_textbook_teacher_request_access.sql tests/textbook-management-schema.test.mjs
git commit -m "feat: allow teachers to create textbook requests"
```

### Task 2: Route request-stage creation through the constrained RPC

**Files:**

- Modify: `src/features/textbooks/textbook-service.ts:288-348,1234-1250`
- Modify: `tests/textbook-workspace.test.mjs`

**Interfaces:**

- Consumes: `public.create_textbook_request_v1` from Task 1.
- Produces: `textbookService.createTextbookRequest(record, clientInput?)`.
- Signature: accepts a `Row` containing `textbookId`, `requestedTextbookTitle`, `classId`, `locationId`, `studentRequestedQuantity`, `teacherRequestedQuantity`, and `memo`; resolves to the RPC result.

- [ ] **Step 1: Write the failing service test**

Add a test named `textbook request creation uses the constrained request RPC` to `tests/textbook-workspace.test.mjs`. Use a fake client with only `rpc(name, parameters)` and assert the service calls exactly:

```js
assert.deepEqual(calls, [{
  name: "create_textbook_request_v1",
  parameters: {
    p_textbook_id: "10000000-0000-4000-8000-000000000001",
    p_requested_textbook_title: "개념원리",
    p_class_id: "20000000-0000-4000-8000-000000000001",
    p_location_id: "30000000-0000-4000-8000-000000000001",
    p_student_requested_quantity: 12,
    p_teacher_requested_quantity: 1,
    p_memo: "수업 시작 전 필요",
  },
}])
```

The fake RPC returns `{ data: { order: { id: "order-1" }, lines: [] }, error: null }`; assert that the service returns that data. Add a second fake response with `error: new Error("denied")` and assert `createTextbookRequest` rejects with `denied`.

- [ ] **Step 2: Run the focused service test and verify it fails**

Run: `node --test --experimental-strip-types --test-name-pattern="constrained request RPC" tests/textbook-workspace.test.mjs`

Expected: FAIL because `textbookService.createTextbookRequest` does not exist.

- [ ] **Step 3: Add the minimal service method**

In `textbook-service.ts`, add a small `createTextbookRequest` beside `createPurchaseReceipt`. Normalize UUID values with existing `normalizeOptionalUuid`, normalize quantities with `Math.max(0, Math.floor(numberValue(...)))`, and call:

```ts
const { data, error } = await client.rpc("create_textbook_request_v1", {
  p_textbook_id: normalizeOptionalUuid(record.textbookId || record.textbook_id),
  p_requested_textbook_title: text(record.requestedTextbookTitle || record.requested_textbook_title),
  p_class_id: normalizeOptionalUuid(record.classId || record.class_id),
  p_location_id: normalizeOptionalUuid(record.locationId || record.location_id),
  p_student_requested_quantity: Math.max(0, Math.floor(numberValue(record.studentRequestedQuantity || record.student_requested_quantity))),
  p_teacher_requested_quantity: Math.max(0, Math.floor(numberValue(record.teacherRequestedQuantity || record.teacher_requested_quantity))),
  p_memo: text(record.memo),
});
if (error) throw error;
return data as Row;
```

Export it through the `textbookService` object. Do not change `createPurchaseReceipt`; it remains the manager-only order/receipt lifecycle writer.

- [ ] **Step 4: Run the focused service test and verify it passes**

Run: `node --test --experimental-strip-types --test-name-pattern="constrained request RPC" tests/textbook-workspace.test.mjs`

Expected: PASS, including the provider error propagation assertion.

- [ ] **Step 5: Commit the client service boundary**

```bash
git add src/features/textbooks/textbook-service.ts tests/textbook-workspace.test.mjs
git commit -m "feat: route textbook requests through RPC"
```

### Task 3: Expose request registration to teachers without exposing management actions

**Files:**

- Modify: `src/features/textbooks/textbook-operations-workspace.tsx:2548-2565,2712-2795,3758-3765,4520-4645,5580-5875,6598-6625,9893-11100`
- Modify: `tests/textbook-workspace.test.mjs`

**Interfaces:**

- Consumes: `textbookService.createTextbookRequest` from Task 2.
- Produces: `canCreateTextbookRequest` and a `canManageRequestLines` prop passed to `PurchaseProcessTable`.
- Invariant: a teacher sees all `request` rows and can trigger only `onAddLine`; a manager retains `onSelectLine`, `onMoveLine`, `onDeleteLine`, and `onReturnLine`.

- [ ] **Step 1: Write the failing workspace contract test**

Add a test named `teachers can add requests but cannot manage existing textbook requests` to `tests/textbook-workspace.test.mjs`. It must assert the workspace source contains each boundary:

```js
assert.match(workspaceSource, /const \{ role, canManageAll, isAdmin, isStaff, isTeacher \} = useAuth\(\)/)
assert.match(workspaceSource, /const canCreateTextbookRequest = isTeacher \|\| canManageTextbookOperations/)
assert.match(workspaceSource, /requestBy: currentUserLabel/)
assert.match(workspaceSource, /purchaseForm\.requestStage === "request"[\s\S]*textbookService\.createTextbookRequest/)
assert.match(workspaceSource, /canManageRequestLines=\{canManageTextbookOperations\}/)
assert.match(workspaceSource, /canManageRequestLines && onSelectLine/)
assert.match(workspaceSource, /canManageRequestLines && isCancelablePurchaseLine/)
assert.match(workspaceSource, /canManageRequestLines && nextStatus/)
```

Also assert the request-stage dialog renders a read-only current requester label for a non-manager rather than `TeacherSelect`:

```js
assert.match(requestDialogSource, /canManageTextbookOperations \? \([\s\S]*<TeacherSelect[\s\S]*\) : \([\s\S]*currentUserLabel/)
```

- [ ] **Step 2: Run the focused workspace test and verify it fails**

Run: `node --test --experimental-strip-types --test-name-pattern="teachers can add requests" tests/textbook-workspace.test.mjs`

Expected: FAIL because the current workspace lacks the teacher creation and action-gating contracts.

- [ ] **Step 3: Implement the minimum UI permission boundary**

Update both `useAuth()` destructures to include `isTeacher`. Define:

```ts
const canCreateTextbookRequest = isTeacher || canManageTextbookOperations;
```

Set `requestBy: currentUserLabel` when opening a new request. In `submitPurchase`, branch before the existing lifecycle writer: a new `request` with no selected line calls `textbookService.createTextbookRequest` with the request title, selected class/location, student/teacher requested quantities, and memo. Leave every existing-line update and non-request stage on the manager lifecycle path; reject any non-manager attempt before it reaches that path.

Pass `canManageRequestLines={canManageTextbookOperations}` to the request table. In `PurchaseProcessTable`, use that prop to: keep `onAddLine` available, render textbook detail buttons and lifecycle actions only to managers, and omit deletion/return/move controls for teachers. In the request dialog, only managers receive `TeacherSelect`; teachers see `currentUserLabel` as the non-editable requester. Do not change the existing `request` data load scope or tabs.

- [ ] **Step 4: Run focused and full textbook tests and verify they pass**

Run:

```bash
node --test --experimental-strip-types --test-name-pattern="teachers can add requests" tests/textbook-workspace.test.mjs
node --test --experimental-strip-types tests/textbook-workspace.test.mjs tests/textbook-management-schema.test.mjs
```

Expected: both commands PASS, including the existing teacher request read-scope test.

- [ ] **Step 5: Run lint for changed production files**

Run: `npx eslint src/features/textbooks/textbook-service.ts src/features/textbooks/textbook-operations-workspace.tsx`

Expected: exit code 0 with no lint errors.

- [ ] **Step 6: Commit the workspace permission boundary**

```bash
git add src/features/textbooks/textbook-operations-workspace.tsx tests/textbook-workspace.test.mjs
git commit -m "feat: let teachers register textbook requests"
```

## Plan self-review

- Spec coverage: Tasks 1–2 enforce server-owned actor and `requested`-only writes; Task 3 preserves whole-request visibility while exposing only new-request creation; Task 3 retains every manager operation; its focused/full tests cover each boundary.
- Placeholder scan: no unfinished markers or deferred implementation wording remains.
- Type consistency: Task 1 defines `create_textbook_request_v1`; Task 2 consumes it as `textbookService.createTextbookRequest`; Task 3 consumes that exact service method and uses the existing `Row` record shape.
