# Registration Result Link and Consultation Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 레벨테스트 결과 URL을 안전한 링크로 열고, 한국어 알림 변수 때문에 롤백되는 전화상담 저장을 복구한다.

**Architecture:** URL 안전성은 기존 순수 appointment draft 모델에서 판정하고 편집 UI는 그 결과만 링크로 렌더링한다. DB는 등록 전용 renderer의 시그니처를 유지하면서 한국어 `token`을 내부 payload `key`에 매핑해 기존 notification state machine과 저장 RPC를 보존한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, Supabase PostgreSQL, Vercel

## Global Constraints

- 실제 Google Chat·SOLAPI provider 호출, dispatch 플래그 변경, 과거 이벤트 backfill을 하지 않는다.
- URL은 절대 `http:` 또는 `https:`만 링크로 만든다.
- DB renderer는 한국어 토큰과 기존 영문 key 템플릿을 모두 지원한다.
- 각 동작은 실패 테스트를 먼저 확인한 뒤 최소 구현으로 통과시킨다.

---

### Task 1: 레벨테스트 결과 링크

**Files:**

- Modify: `src/features/tasks/registration-appointment-draft.ts`
- Modify: `src/features/tasks/registration-appointment-editor.tsx`
- Modify: `tests/registration-appointment-draft.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`

**Interfaces:**

- Produces: `getRegistrationResultLinkHref(value: string): string | null`
- Consumes: 레벨테스트 결과 draft의 현재 `materialLink`

- [ ] **Step 1: 안전한 URL 실패 테스트 작성**

```js
assert.equal(getRegistrationResultLinkHref("https://chat.google.com/result"), "https://chat.google.com/result")
assert.equal(getRegistrationResultLinkHref("http://example.test/result"), "http://example.test/result")
assert.equal(getRegistrationResultLinkHref("javascript:alert(1)"), null)
assert.equal(getRegistrationResultLinkHref("/admin/registration"), null)
assert.equal(getRegistrationResultLinkHref("not a url"), null)
```

- [ ] **Step 2: RED 확인**

Run:

```bash
node --test --experimental-strip-types tests/registration-appointment-draft.test.mjs
```

Expected: `getRegistrationResultLinkHref`가 없어 FAIL.

- [ ] **Step 3: URL helper 최소 구현**

```ts
export function getRegistrationResultLinkHref(value: string) {
  try {
    const url = new URL(String(value || "").trim())
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: 편집 UI에 링크 연결**

`materialLink`마다 helper 결과를 계산하고, 값이 있을 때만 `결과 열기` 링크를 저장 버튼 앞에 렌더링한다. 링크는 `target="_blank"`, `rel="noopener noreferrer"`, `aria-label="${과목} 레벨테스트 결과 링크 열기"`를 가진다.

- [ ] **Step 5: GREEN 확인**

Run:

```bash
node --test --experimental-strip-types tests/registration-appointment-draft.test.mjs tests/registration-track-workspace.test.mjs
```

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/features/tasks/registration-appointment-draft.ts src/features/tasks/registration-appointment-editor.tsx tests/registration-appointment-draft.test.mjs tests/registration-track-workspace.test.mjs
git commit -m "feat: open registration result links"
```

### Task 2: 한국어 등록 템플릿 renderer

**Files:**

- Modify: `supabase/migrations/20260807025103_registration_korean_template_renderer.sql`
- Create: `supabase/tests/registration_korean_template_renderer_test.sql`
- Modify: `tests/notification-registration-handoffs.test.mjs`
- Modify: `tests/registration-consultation-notification.test.mjs`

**Interfaces:**

- Preserves: `dashboard_private.registration_render_fixed_template_v2(text, jsonb, jsonb) returns text`
- Consumes: `allowed_variables`의 `{ key, token }`와 영문 key 기반 payload
- Produces: 한국어 token 또는 legacy key가 안전하게 치환된 text

- [ ] **Step 1: renderer 회귀 테스트 작성**

pgTAP fixture는 다음 계약을 검증한다.

```sql
select is(
  dashboard_private.registration_render_fixed_template_v2(
    '[학생] {학생} / [과목] {과목}',
    '{"student_name":"김민서 학생","subjects":["영어","수학"]}'::jsonb,
    '[{"key":"student_name","token":"학생"},{"key":"subjects","token":"과목"}]'::jsonb
  ),
  '[학생] 김민서 학생 / [과목] 영어 · 수학'
);
```

과거 `{student_name}`도 같은 값을 렌더링하고 `{허용안됨}`은 예외가 나야 한다.

- [ ] **Step 2: RED 확인**

현재 운영 함수에 read-only SELECT를 실행해 한국어 allowlist가 `registration_notification_template_allowlist_invalid`로 실패함을 확인한다. 실제 상담·알림 행은 만들지 않는다.

- [ ] **Step 3: migration 구현**

`registration_render_fixed_template_v2`를 교체한다.

- `key`는 `^[a-z][a-z0-9_]{0,63}$`
- `token`은 비어 있지 않고 `{}`, 제어문자를 포함하지 않아야 함
- key와 token의 중복·교차 충돌은 차단
- placeholder는 같은 변수의 `key` 또는 `token`과 일치해야 함
- 배열은 ` · `로 합치고 나머지는 `payload ->> key`로 읽음
- `{key}`와 `{token}`을 모두 같은 값으로 치환

- [ ] **Step 4: transaction GREEN 확인**

운영 DB에 `BEGIN;`으로 migration 함수 정의를 임시 적용하고 위 렌더링 SELECT와 예외 테스트를 실행한 뒤 `ROLLBACK;`한다. 영구 schema 변경과 provider 호출은 없어야 한다.

- [ ] **Step 5: 집중 테스트 실행**

Run:

```bash
node --test --experimental-strip-types tests/notification-registration-handoffs.test.mjs tests/registration-consultation-notification.test.mjs
```

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations/20260807025103_registration_korean_template_renderer.sql supabase/tests/registration_korean_template_renderer_test.sql tests/notification-registration-handoffs.test.mjs tests/registration-consultation-notification.test.mjs
git commit -m "fix: render Korean registration template tokens"
```

### Task 3: 전체 검증과 운영 릴리스

**Files:**

- Verify only: all modified files

- [ ] **Step 1: 전체 집중 검증**

```bash
node --test --experimental-strip-types tests/registration-appointment-draft.test.mjs tests/registration-track-workspace.test.mjs tests/registration-track-service.test.mjs tests/notification-registration-handoffs.test.mjs tests/registration-consultation-notification.test.mjs
pnpm exec eslint src/features/tasks/registration-appointment-draft.ts src/features/tasks/registration-appointment-editor.tsx tests/registration-appointment-draft.test.mjs tests/registration-track-workspace.test.mjs tests/notification-registration-handoffs.test.mjs tests/registration-consultation-notification.test.mjs
pnpm exec next build --webpack
```

Expected: 테스트 0 실패, ESLint 오류 0, build exit 0.

- [ ] **Step 2: diff와 migration 안전성 검토**

고객 발송·dispatch flag·provider URL·기존 템플릿 데이터 변경이 없는지 확인한다.

- [ ] **Step 3: 운영 DB migration 적용**

Supabase migration history에 `registration_korean_template_renderer`를 적용하고 동일 렌더링 SELECT가 한국어 값을 반환하는지 확인한다.

- [ ] **Step 4: main push와 Vercel Production READY 확인**

기능 커밋을 `main`에 반영·push하고 새 Production deployment가 READY인지 확인한다.

- [ ] **Step 5: 운영 브라우저 검증**

동일 task/track에서:

1. `결과 열기` 링크가 존재하고 새 탭 대상의 기존 URL을 가진다.
2. `상담 정보 저장` 클릭 후 경고가 사라지고 버튼이 `저장됨`으로 바뀐다.
3. 새로고침 후에도 전화상담 저장 상태가 유지된다.
4. provider 발송이나 고객 알림톡 전송은 발생하지 않는다.

