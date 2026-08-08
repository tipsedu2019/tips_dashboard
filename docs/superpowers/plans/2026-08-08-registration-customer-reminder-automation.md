# Registration Customer Reminder Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and superpowers:verification-before-completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 등록 예약 리마인드 알림톡을 ON/OFF와 발송 몇 시간 전만으로 설정하고, 수동·자동 합계 예약당 1회로 안전하게 예약 발송한다.

**Architecture:** private singleton 설정과 appointment 단위 큐를 추가하고, 기존 고객 메시지 outbox의 claim/attempt/finalize 안전 경계를 자동 발송에도 재사용한다. Supabase pg_cron/pg_net이 Bearer 보호된 Vercel Route를 1분마다 호출하며, 기본 OFF와 템플릿 영수증 fail-closed를 유지한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase Postgres/RPC/pg_cron/pg_net/Vault, SOLAPI, Node test runner, ESLint, Vercel

### Task 1: 자동 리마인드 계약과 순수 워커 상태 기계

**Files:**
- Create: `src/features/tasks/server/registration-customer-reminder-worker.ts`
- Create: `tests/registration-customer-reminder-worker.test.mjs`
- Modify: `src/features/tasks/server/registration-customer-message-route.ts`
- Modify: `src/features/tasks/registration-customer-message-contract.ts`

- [x] RED: 인증 실패, 사전 차단, 정확히 1회 provider 호출, 시도 후 불확실성 계약 테스트를 작성한다.
- [x] GREEN: 기존 SOLAPI adapter를 주입받는 자동 워커 상태 기계를 최소 구현한다.
- [x] 집중 테스트와 diff를 검증한다.

### Task 2: DB 설정·큐·수동/자동 합산 1회 잠금

**Files:**
- Create: `supabase/migrations/*_registration_customer_reminder_automation.sql`
- Modify: `tests/registration-customer-solapi-db.test.mjs`
- Create: `tests/registration-customer-reminder-scheduler.test.mjs`

- [x] `supabase migration new`으로 새 migration을 생성한다.
- [x] RED: 기본 OFF/3시간, 관리자 RPC, appointment lifetime unique lock, queue lease, attempt-before-dispatch, cron 함수 사용 계약을 작성한다.
- [x] GREEN: private settings/jobs, RPC, RLS/grants, outbox origin, 감사 projection, scheduler 관리 함수를 구현한다.
- [x] SQL 정적 계약과 운영 트랜잭션 적용·읽기 검증을 통과한다.

### Task 3: 전용 worker/settings API

**Files:**
- Create: `src/app/api/solapi/registration/reminders/worker/route.ts`
- Create: `src/app/api/solapi/registration/reminders/settings/route.ts`
- Create: `src/features/tasks/server/registration-customer-reminder-route.ts`
- Create: `tests/registration-customer-reminder-route.test.mjs`

- [x] RED: worker secret 401, 관리자 설정 권한, OFF/준비 미완료 차단, provider 결과 finalize 테스트를 작성한다.
- [x] GREEN: 상수시간 비밀키 검증, service RPC orchestration, 설정 read/write route를 구현한다.
- [x] route 테스트·타입·lint를 검증한다.

### Task 4: 알림 설정 UI와 자동 감사 표시

**Files:**
- Create: `src/features/notifications/registration-customer-reminder-settings.tsx`
- Create: `src/features/notifications/registration-customer-reminder-service.ts`
- Modify: `src/features/notifications/notification-control-panel.tsx`
- Modify: `src/features/tasks/registration-alimtalk-preview-dialog.tsx`
- Modify: `tests/notification-control-plane-ui.test.mjs`
- Modify: `tests/registration-alimtalk-preview-dialog.test.mjs`

- [x] RED: 등록 화면에는 고객 자동 발송/몇 시간 전만 보이고 내부 예약 규칙은 숨겨진다는 테스트를 작성한다.
- [x] GREEN: 최소 설정 카드와 안전 상태, `자동 발송 · 시각` 감사 문구를 구현한다.
- [x] 모바일/데스크톱 source 계약과 접근성을 검증한다.

### Task 5: 통합 검증·migration·운영 배포

- [x] 로컬 diff 코드 리뷰와 Supabase 보안·성능 자문 결과를 반영한다.
- [ ] 관련 전체 테스트, ESLint, TypeScript, `next build --webpack`, `git diff --check`를 통과한다.
- [x] migration을 운영 Supabase에 적용하고 기본 OFF·무발송·중복 잠금을 읽기 검증한다.
- [ ] 최신 `origin/main`을 확인하고 커밋을 GitHub main에 반영한다.
- [ ] Vercel Production READY와 정확한 Git SHA, endpoint 200/401 경계를 확인한다.
- [ ] worker secret을 Vercel과 Vault에 노출 없이 설치하고 Cron을 활성화하되 설정은 OFF로 유지한다.
- [ ] SOLAPI 승인 영수증·템플릿 checksum·버튼 URL을 사전 검증한다.
- [ ] 사용자가 명시적으로 승인한 테스트 수신 후에만 자동 발송을 ON으로 전환한다.
