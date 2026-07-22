# Registration Science Selection Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 등록 화면에서 학년을 고르기 전에도 과학을 선택할 수 있게 한다.

**Architecture:** 과목 활성화 여부는 즉시 검사하되 학년 지원 여부는 학년 값이 있을 때만 `RegistrationSubjectCapability.gradeLevels`로 검사한다. 학년 변경 정합성과 저장 단계의 필수 학년 및 DB 검증은 그대로 유지한다.

**Tech Stack:** Next.js App Router, React, TypeScript, Node test runner, Playwright browser verifier, ESLint, Vercel

## Global Constraints

- 과학 선택 전에 학년을 먼저 선택하도록 막지 않는다.
- 현재 운영 가능 학년 검증은 `RegistrationSubjectCapability.gradeLevels`를 사용한다.
- 과학을 고등부로 고정하는 UI 문구를 남기지 않는다.
- 현재 과학의 고1~고3 capability 및 DB 제한은 유지한다.
- 실제 초중등 과학 개방은 과목 설정 파서·수업 분류·DB 검증을 함께 변경하는 별도 작업이다.
- 통계, 전반, 퇴원, 휴보강 과목 목록은 수정하지 않는다.
- DB와 알림 발송 설정은 변경하지 않는다.

---

## File Structure

- `src/features/tasks/registration-intake-workflow.ts`: 등록 과목 선택 가능 여부와 학년 변경 정합성.
- `tests/registration-science-subject.test.mjs`: 선택 순서와 설정 기반 학년 제한 회귀 테스트.
- `scripts/verify-ops-task-browser-workflow.mjs`: 실제 등록 화면의 과학 선택 순서 검증.
- `tests/registration-browser-verifier-contract.test.mjs`: 브라우저 검증 스크립트 계약.
- `tests/ops-task-verification-safety.test.mjs`: 운영 검증 스크립트 안전 계약.

### Task 1: 학년 미선택 과학 선택 회귀 테스트

**Files:**
- Modify: `tests/registration-science-subject.test.mjs`
- Modify: `tests/registration-browser-verifier-contract.test.mjs`
- Modify: `tests/ops-task-verification-safety.test.mjs`

**Interfaces:**
- Consumes: `getRegistrationSubjectPickerAvailability()` and `reconcileRegistrationSubjectsForGrade()`.
- Produces: 빈 학년에서는 과학이 활성이고 기존 과학 계획이 보존된다는 테스트 계약.

- [ ] **Step 1: Write the failing unit assertions**

```js
assert.equal(beforeGrade.disabledReasonBySubject.과학, undefined)

const beforeGradeReconciliation = intakeWorkflow.reconcileRegistrationSubjectsForGrade({
  capabilities: scienceCapabilities,
  grade: "",
  subjects: ["영어", "과학"],
  draft,
})
assert.deepEqual(beforeGradeReconciliation.subjects, ["영어", "과학"])
assert.equal(beforeGradeReconciliation.draft.subjectPlans.과학, "visit")
assert.equal(beforeGradeReconciliation.draft.directorOverrides.과학, "science-director")
```

- [ ] **Step 2: Update browser verifier contracts**

Require the verifier script to click the 과학 subject button before choosing 고1 and assert `aria-pressed="true"`. Require the old `과학 선택 전에 학년을 먼저 선택하세요.` copy to be absent.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test --experimental-strip-types tests/registration-science-subject.test.mjs tests/registration-browser-verifier-contract.test.mjs tests/ops-task-verification-safety.test.mjs`

Expected: FAIL because the current UI model disables 과학 before grade selection and the verifier does not exercise the new order.

### Task 2: 등록 과목 게이트 최소 수정

**Files:**
- Modify: `src/features/tasks/registration-intake-workflow.ts`
- Modify: `scripts/verify-ops-task-browser-workflow.mjs`

**Interfaces:**
- Consumes: `RegistrationSubjectCapability.gradeLevels: string[]`.
- Produces: 빈 학년에서 빈 disabled reason, 채워진 학년에서 설정 기반 disabled reason.

- [ ] **Step 1: Implement the minimal availability change**

```ts
const normalizedGrade = trimmed(grade)
if (!normalizedGrade) return ""
if (!capability.gradeLevels.includes(normalizedGrade)) {
  return `${capability.subject}은(는) 현재 선택한 학년에서 신규 등록할 수 없습니다.`
}
```

- [ ] **Step 2: Exercise the order in the browser verifier**

Find the 과학 subject button, click it before selecting the grade, assert it becomes pressed, then continue the existing 고1 flow. Do not add any provider send action.

- [ ] **Step 3: Run focused tests and verify GREEN**

Run: `node --test --experimental-strip-types tests/registration-science-subject.test.mjs tests/registration-browser-verifier-contract.test.mjs tests/ops-task-verification-safety.test.mjs`

Expected: PASS.

### Task 3: 통합 검증과 운영 배포

**Files:**
- Verify all modified source, test, spec, and plan files.

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: 검증된 `main` 커밋과 READY 상태의 Vercel production 배포.

- [ ] **Step 1: Run registration regression tests**

Run: `node --test --experimental-strip-types tests/registration-*.test.mjs tests/ops-task-verification-safety.test.mjs`

Expected: PASS.

- [ ] **Step 2: Run static checks**

Run: `pnpm exec tsc --noEmit` and `pnpm lint`.

Expected: both commands exit 0.

- [ ] **Step 3: Run production build**

Run: `pnpm build`.

Expected: `next build --webpack` exits 0 and emits `/admin/registration`.

- [ ] **Step 4: Verify the rendered registration workflow**

Open `/admin/registration`, click 과학 before selecting a grade, confirm the selected state, then select 고1 and confirm 과학 remains selected. Confirm no real notification delivery occurs.

- [ ] **Step 5: Review and commit explicit files**

Run: `git diff --check`, inspect `git diff --stat` and `git diff`, then stage only the files listed in Tasks 1-2 plus this spec and plan.

Expected: no whitespace errors and no dashboard, transfer, withdrawal, makeup, notification, or migration files in the diff.

- [ ] **Step 6: Push and verify production**

Run: `git push origin main`, then verify the production deployment is READY, its commit SHA equals local and remote `main`, and `/admin/registration` responds successfully.

Expected: official `main`, local release checkout, and production deployment point to the same commit.
