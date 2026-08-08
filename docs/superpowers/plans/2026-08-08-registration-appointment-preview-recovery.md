# Registration Appointment Preview Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and superpowers:verification-before-completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 예약 저장 확인을 최소화하고 실제 저장 상태를 정확히 표시하며, 중첩된 알림톡 미리보기가 모바일 등록 상세 화면 위에 정상 노출되게 한다.

**Architecture:** 예약 확인은 네트워크 없는 인라인 상태로 단순화하고 실제 mutation만 `saving`으로 감싼다. 중첩 Dialog는 공통 overlay 확장점을 통해 content와 overlay를 동일한 상위 레이어에 배치한다. 발송 경계와 서버 계약은 그대로 유지한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Radix Dialog, Node test runner, ESLint, Vercel Git deployment

### Task 1: 예약 저장 확인과 상태 수명주기

**Files:**
- Modify: `src/features/tasks/registration-appointment-editor.tsx`
- Modify: `src/features/tasks/registration-appointment-draft.ts`
- Modify: `tests/registration-appointment-draft.test.mjs`
- Modify: `tests/registration-consultation-notification.test.mjs`
- Modify: `tests/registration-track-workspace.test.mjs`

- [x] RED: 질문과 두 동작만 남고 요약·사전 preview RPC·선행 saving 상태가 없다는 회귀 테스트를 작성한다.
- [x] GREEN: 확인 상태를 단순화하고 실제 저장 mutation만 `try/finally`로 `saving` 처리한다.
- [x] 집중 테스트와 diff를 검증한다.

### Task 2: 알림톡 미리보기 모달 레이어

**Files:**
- Modify: `src/components/ui/dialog.tsx`
- Modify: `src/features/tasks/registration-alimtalk-preview-dialog.tsx`
- Modify: `tests/registration-alimtalk-preview-dialog.test.mjs`

- [x] RED: 상세 모달보다 높은 overlay/content 레이어 계약을 테스트한다.
- [x] GREEN: 공통 Dialog overlay class 확장점과 미리보기 `z-[90]`을 구현한다.
- [x] 집중 테스트와 diff를 검증한다.

### Task 3: 통합 검증과 운영 배포

- [x] 독립 코드 리뷰 결과를 반영한다.
- [x] 관련 전체 테스트, targeted ESLint, TypeScript, `next build --webpack`, `git diff --check`를 통과한다.
- [ ] 최신 `origin/main`을 확인한 뒤 커밋을 GitHub main에 반영한다.
- [ ] Vercel Production READY와 정확한 커밋 SHA를 확인한다.
- [ ] 모바일 운영 등록 상세에서 저장 확인과 알림톡 미리보기를 실제 발송 없이 검증한다.
