# Class Date Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영의 잘못된 수업 시작일 52건을 안전하게 정규화하고 재발을 DB에서 차단하며, 시간표·수업계획 RPC와 화면 오류 표시를 복구한다.

**Architecture:** `classes` 날짜 컬럼의 기존 text 호환성은 유지하되 private immutable validator와 CHECK 제약으로 저장 경계를 강화한다. 새 migration은 승인된 네 값과 예상 건수를 정확히 검증한 뒤에만 변경한다. pgTAP은 저장 제약과 두 academic RPC의 실제 동작을 검증하고, 작은 TypeScript 유틸리티가 Supabase 구조화 오류에서 안전한 사용자 메시지를 추출한다.

**Tech Stack:** Next.js 16, TypeScript, Node test runner, Supabase Postgres/PLpgSQL/pgTAP, Vercel.

## Global Constraints

- 작업은 `/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/fix-class-date-normalization`의 `codex/fix-class-date-normalization`에서만 한다.
- 적용 완료된 기존 migration은 수정하지 않는다.
- migration 파일은 Supabase CLI `migration new normalize_class_dates`로 생성한다.
- RED 확인 후 최소 구현, GREEN 확인, 커밋 순서를 지킨다.
- 운영 데이터 수정은 로컬 테스트와 migration 검토가 끝난 뒤에만 한다.
- 외부 고객/교사 메시지와 공급자 설정은 범위 밖이다.

---

### Task 1: 승인된 설계와 현재 기준선을 고정한다

**Files:**

- Create: `docs/superpowers/specs/2026-08-16-class-date-normalization-design.md`
- Create: `docs/superpowers/plans/2026-08-16-class-date-normalization.md`

- [ ] **Step 1:** 브랜치와 worktree가 `origin/main` 기준이며 깨끗한지 확인한다.
- [ ] **Step 2:** 설계와 본 실행 계획에서 데이터 매핑, 예상 건수, 저장 제약, 검증 게이트를 기록한다.
- [ ] **Step 3:** `TBD`, 임의 placeholder, 범위 밖 메시징 변경이 없는지 점검한다.
- [ ] **Step 4:** 문서만 커밋한다: `git commit -m "docs: plan class date normalization"`.

### Task 2: 구조화된 Supabase 오류 메시지 회귀 테스트와 구현

**Files:**

- Create: `src/lib/error-message.ts`
- Create: `tests/error-message.test.mjs`
- Modify: `src/features/academic/use-academic-workspace-data.ts`
- Modify: `src/features/operations/use-operations-workspace-data.ts`

- [ ] **Step 1:** `Error`, `{ message }`, `{ details }`, 빈 값, 민감한 객체 fallback을 다루는 실패 테스트를 작성한다.
- [ ] **Step 2:** `node --test --experimental-strip-types tests/error-message.test.mjs`로 RED를 확인한다.
- [ ] **Step 3:** 비어 있지 않은 안전한 문자열만 반환하는 `getErrorMessage(error, fallback)`을 최소 구현한다.
- [ ] **Step 4:** academic/operations 훅의 모든 `Unknown error` fallback을 공용 함수로 교체한다.
- [ ] **Step 5:** 새 테스트와 관련 기존 academic/operations 테스트를 실행해 GREEN을 확인한다.
- [ ] **Step 6:** 커밋한다: `git commit -m "fix: surface structured workspace errors"`.

### Task 3: 날짜 저장 계약의 실패 테스트 작성

**Files:**

- Modify: `supabase/tests/academic_scoped_reads_test.sql`
- Modify as required: isolated DB baseline manifest/capture files

- [ ] **Step 1:** pgTAP fixture에 정규화된 과거 날짜가 있는 class를 추가하고 시간표 RPC와 수업계획 RPC가 모두 오류 없이 반환하는 assertion을 쓴다.
- [ ] **Step 2:** `start_date`와 `end_date` 각각에서 compact/한글/슬래시/불가능한 ISO 날짜 insert 또는 update가 실패하는 assertion을 쓴다.
- [ ] **Step 3:** `NULL`, 공백, leap-day를 포함한 유효 ISO 날짜는 허용되는지 assertion을 쓴다.
- [ ] **Step 4:** 현재 migration baseline으로 isolated DB test를 실행해 날짜 제약 assertion이 실패하는 RED를 확인한다.
- [ ] **Step 5:** 테스트 변경만 커밋한다: `git commit -m "test: cover canonical class dates"`.

### Task 4: 정확한 정규화 migration 구현

**Files:**

- Create via Supabase CLI: `supabase/migrations/*_normalize_class_dates.sql`
- Modify as required: isolated DB baseline manifest/capture files

- [ ] **Step 1:** 저장소 Supabase CLI로 `supabase migration new normalize_class_dates`를 실행한다.
- [ ] **Step 2:** private immutable validator를 추가한다. null/blank 또는 실제 달력에서 유효한 canonical `YYYY-MM-DD`만 true를 반환해야 한다.
- [ ] **Step 3:** DO block에서 대상 값이 하나라도 있으면 네 기존 값의 개별 건수(2/47/1/2)와 총 52건을 먼저 검증하고 불일치 시 exception으로 중단한다. 네 값이 모두 0건인 신규/테스트 DB만 무변경 경로로 허용한다.
- [ ] **Step 4:** 명시적 CASE 매핑으로 52건만 update하고 실제 수정 행 수를 재검증한다.
- [ ] **Step 5:** start/end 날짜의 남은 비정식 값을 확인한 뒤 두 CHECK constraint를 추가한다.
- [ ] **Step 6:** fixture를 migration 전에 구성하는 isolated migration test 또는 별도 data-contract test에서 정확한 52건 성공 경로, 0건 무변경 경로, 부분 건수 abort 경로를 실제 검증한다.
- [ ] **Step 7:** 전체 pgTAP과 migration 테스트를 실행해 GREEN을 확인한다.
- [ ] **Step 8:** 커밋한다: `git commit -m "fix: normalize and constrain class dates"`.

### Task 5: 소스 및 로컬 회귀 검증

**Files:**

- Verify only unless failures require scoped fixes.

- [ ] **Step 1:** 새 오류 유틸 테스트와 academic/operations 단위 테스트를 실행한다.
- [ ] **Step 2:** isolated Supabase DB에서 `academic_scoped_reads_test.sql`을 실행한다.
- [ ] **Step 3:** `pnpm lint`와 `pnpm build`를 실행한다.
- [ ] **Step 4:** migration diff와 git diff를 검토해 52건 외 포괄 update, 외부 메시징 변경, 비밀정보가 없는지 확인한다.
- [ ] **Step 5:** 실패가 있으면 같은 범위에서 수정하고 관련 RED/GREEN 근거를 보존한다.

### Task 6: 운영 Supabase migration과 RPC 검증

**Files:**

- Apply the finalized `*_normalize_class_dates.sql` through Supabase migration tooling.

- [ ] **Step 1:** 운영에서 네 값의 개별 건수와 총 52건이 여전히 일치하는지 read-only SQL로 재확인한다.
- [ ] **Step 2:** migration ledger를 확인하고 새 migration을 한 번 적용한다.
- [ ] **Step 3:** 네 legacy 값이 0건이며 정규화 결과 건수가 예상과 맞는지 확인한다.
- [ ] **Step 4:** CHECK constraints와 validator가 존재하고 비정식 날짜 쓰기를 rollback 가능한 transaction에서 거부하는지 확인한다.
- [ ] **Step 5:** `get_academic_timetable_range_v1`과 `get_academic_curriculum_page_v1`을 read-only 호출하여 성공 응답을 확인한다.

### Task 7: GitHub main, Vercel, 운영 UI 검증

**Files:**

- No additional source files unless a verified release-only issue is found.

- [ ] **Step 1:** 전체 검증 결과와 브랜치 상태를 재확인한다.
- [ ] **Step 2:** finishing-development-branch 절차에 따라 변경을 `main`에 반영하고 GitHub에 push한다.
- [ ] **Step 3:** GitHub `main` SHA와 Vercel Production deployment SHA가 일치하고 상태가 `READY`인지 확인한다.
- [ ] **Step 4:** 로그인된 운영 사이트에서 시간표와 수업계획 메뉴를 각각 열어 데이터 표시와 오류 부재를 확인한다.
- [ ] **Step 5:** source/tests, migration, runtime RPC, main/Vercel, UI 결과를 분리해 보고한다. 복구 stash는 사용자가 별도로 삭제 요청하기 전까지 유지한다.
