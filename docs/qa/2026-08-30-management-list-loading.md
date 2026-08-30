# 관리 목록 로딩 슬라이스 로컬 QA 보고서

- 검증일: 2026-08-30, 인증 후 재검증 2026-08-31 (Asia/Seoul)
- 작업공간: `/Users/hyunjun/Documents/Codex/tips_dashboard`
- 브랜치/검증 기준: `codex/loading-performance` / `07f1737d` 이후 최종 리뷰 보완 포함
- 로컬 프로덕션 서버: `http://localhost:3017` (`next start -p 3017`)
- 현재 결론: 인증 후 실제 화면에서 하단 높이 계산 누락을 찾아 수정했다. 학생 기본 목록은 768/900/952px에서 화면 안에 들어온다. 여러 줄 수업과 작은 화면의 선택 도구는 최소 10행 한계로 스크롤이 남아 전체 UX 게이트는 아직 통과하지 않았다. 네트워크의 실제 요청 한도·취소는 관찰 기능이 없어 자동 계약 테스트 증거와 구분한다. 원격 배포나 운영 성능을 주장하지 않는다.

## 1. 검증 대상

검증하려던 실제 흐름은 다음과 같다.

`/admin/students`·`/admin/classes` 로드 → 768/900/952px 높이에 맞는 자동 페이지 크기 렌더링 → 행 선택/해제로 레이아웃 이동 후 안정적인 재측정 → 빠른 필터/새로고침에서 기존 행 유지 및 대체된 목록 요청 취소

이번 슬라이스의 변경 파일은 관리 목록 서비스·요청 생명주기·요청 게이트·적응형 페이지 크기·테이블/페이지 컴포넌트와 관련 집중 테스트다. 최초 브라우저 QA에서는 인증 경계 이전의 구현 회귀가 재현되지 않았지만, 이후 최종 코드 리뷰에서 냉간 진입의 빈 상태 노출과 읽기 오류의 재시도 동작 부재를 찾아 보완했다.

## 2. 자동 테스트 증거

다음 집중 명령을 그대로 실행했다.

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/query-surface-budget.test.mjs tests/keyset-pagination.test.mjs tests/management-page-size.test.mjs tests/management-request-gate.test.mjs tests/management-request-lifecycle.test.mjs tests/management-progressive-loading.test.mjs tests/management-filter-transition.test.mjs tests/management-students-toolbar.test.mjs
```

- 결과: 종료 코드 0, 176/176 통과, 실패·취소·skip 0.
- 확인된 계약에는 10/15/20 적응형 페이지 크기, 뷰포트 용량 양자화, 크기 축소 시 페이지 clamp, 선택 기반 상세/관계 조회, 호출자별 취소, 오래된 응답 차단, 새 요청 중 기존 행 유지, 빠른 필터 전환의 URL 소유권이 포함된다.
- 위 항목은 소스/계약 회귀 증거이며 실제 인증 데이터 화면의 렌더링 증거로 해석하지 않는다.

최종 리뷰 보완은 다음 별도 상태 전이 회귀로 확인했다.

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/management-list-load-state.test.mjs
```

- 결과: 종료 코드 0, 3/3 통과.
- 확인된 계약은 환경설정 수화 전부터 첫 요청 성공·실패까지의 pending 표시, 빈 첫 로드 오류의 재시도, 기존 행을 보존한 새로고침 오류의 재시도, 재시도 중 비활성 상태다.

TypeScript는 다음 명령으로 별도 확인했다.

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit
```

- 결과: 종료 코드 0, 진단 없음.

## 3. lint 및 프로덕션 빌드 증거

저장소에는 `.tools/npm/package/bin/npm-cli.js`가 없고 `.codex-temp/tools/npm/bin/npm-cli.js`가 있어 확인된 경로를 사용했다. 최초 npm lint 실행은 코드 오류가 아니라 `node_modules/.bin/eslint`의 shebang이 PATH에서 `node`를 찾지 못해 종료 코드 127이었다. 같은 체크된 Node 런타임을 PATH에 명시해 다음과 같이 재실행했다.

```bash
/usr/bin/env PATH=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node .codex-temp/tools/npm/bin/npm-cli.js run lint
```

- 결과: 종료 코드 0, 오류 0, 경고 6.
- 기존 경고: `timetable-workspace.tsx` Hook 의존성 1개, `ops-task-service.ts` 미사용 심볼 3개, `public-classes-cache-invalidation.js` 미사용 인자 1개, `public-classes-cache.integration.test.mjs` 미사용 import 1개.
- 500KB를 넘는 `ops-task-workspace.tsx`, `textbook-operations-workspace.tsx`에 Babel deopt 안내가 있었다.

프로덕션 빌드는 다음 명령으로 실행했다.

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/next/dist/bin/next build --webpack
```

- 결과: 종료 코드 0, webpack compile 성공(9.4초), TypeScript 단계 통과, 정적 페이지 81/81 생성.
- `/admin/students`와 `/admin/classes`가 빌드 경로에 포함됐다.

빌드 결과는 사용 중이지 않은 3017 포트를 확인한 뒤 다음 명령으로 시작했다.

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/next/dist/bin/next start -p 3017
```

- 결과: `http://localhost:3017`, Ready 200ms.

## 4. 브라우저 증거와 인증 차단

Browser 플러그인을 사용해 인앱 Browser를 먼저 연결했고, 해당 세션에 인증이 없음을 확인한 뒤 지침에 따라 Chrome의 기존 세션도 확인했다. 쿠키, localStorage, 브라우저 프로필, 저장 자격 증명은 열람하지 않았다.

| 브라우저 | 진입 경로 | 관찰한 뷰포트 | 최종 URL | DOM/콘솔 |
|---|---|---:|---|---|
| 인앱 Browser | `/admin/students` | 기본 뷰포트 | `/sign-in?next=%2Fadmin%2Fstudents` | 로그인 폼 렌더링, error/warn 0 |
| Chrome | `/admin/students` | 1440×768 | `/sign-in?next=%2Fadmin%2Fstudents` | 로그인 폼 렌더링, error/warn 0 |
| 인앱 Browser | `/admin/classes` | 1440×952 | `/sign-in?next=%2Fadmin%2Fclasses` | `scrollHeight=952`, `innerHeight=952`, error/warn 0 |
| Chrome | `/admin/classes` | 1440×900 | `/sign-in?next=%2Fadmin%2Fclasses` | `scrollHeight=900`, `innerHeight=900`, error/warn 0 |

페이지 제목은 모두 `TIPS 로그인 | TIPS Dashboard`였고, 의미 있는 로그인 DOM이 렌더링됐으며 Next.js/Webpack 오류 오버레이는 없었다. 로그인 화면의 스크린샷을 Browser 런타임으로 캡처했으며 저장소에는 스크린샷·trace를 추가하지 않았다.

인증 경계 때문에 아래 목표 항목은 브라우저에서 관찰하지 못했다.

- 768/900/952px 각각의 학생·수업 자동 페이지 크기와 렌더링 행 수
- 행 선택/해제 뒤 레이아웃 이동과 안정적인 재측정
- 빠른 필터/새로고침 중 이전 행 유지 여부와 오류 alert 부재
- 대체된 목록 요청의 실제 취소 여부
- 실제 목록 RPC의 `p_limit`
- 관리 목록 내부의 목표 상호작용

Browser API가 이 실행에서 별도 네트워크 요청 검사 기능을 노출하지 않았고, 로그인 리디렉션으로 목록 RPC 자체도 발생하지 않았다. 따라서 `p_limit`은 자동 계약 테스트에서만 검증됐으며 브라우저 관찰값은 `unavailable`이다. 로그인 화면에 자격 증명을 입력하거나 인증을 우회하지 않았고, 관찰하지 못한 행 수나 요청값을 추정하지 않았다.

## 5. 증거 경계

- Supabase migration을 추가하지 않았고 적용하지 않았다.
- 원격 push를 실행하지 않았다.
- Vercel Preview 또는 Production 배포를 실행하지 않았다.
- 운영 데이터베이스 쿼리, `EXPLAIN`, provider 호출을 실행하지 않았다.
- 운영 p50/p95 성능을 측정하거나 주장하지 않는다.
- 자동 테스트/빌드 통과와 인증된 브라우저 렌더링은 별개다. 후자는 이번 실행에서 미검증 상태다.

## 6. 남은 검증 게이트

2026-08-30 당시에는 인증이 필요했다. 2026-08-31 사용자가 준비한 기존 관리자 세션으로 아래 재검증을 수행했다. 현재 남은 게이트는 여러 줄 수업/선택 도구에 대한 최소 페이지 크기 결정과 실제 네트워크 관측이다.

## 7. 2026-08-31 인증 후 재검증

### 환경과 수정

- 동일한 `http://localhost:3017`의 로컬 프로덕션 빌드, Browser 플러그인 사용. 외부 브라우저나 별도 Playwright로 전환하지 않았다.
- 사용자 로그인 세션을 사용했고 쿠키·localStorage·프로필·자격 증명은 읽지 않았다. 원격 데이터 수정·알림 발송은 없었다.
- 기준 HEAD `be31352d`에서 재현한 문제: 자동 크기는 내부 pager와 16px만 빼고, 외부 `py-4`의 `다음 N건` 영역 및 실제 shell 하단 32px를 빠뜨렸다.
- 수정: 추가 로드/끝 상태를 기존 pager 행 안으로 옮겼다. 실제 body→pager 간격, 전체 pager 높이, 조상 하단 여백을 측정한다. `body.top + scrollY`로 문서 기준 위치를 사용해 스크롤 자체가 자동 크기를 늘리지 않도록 했다.
- 시각 QA에서 `자동 (10개)` 선택기 라벨이 38px 공간에 63px 텍스트를 넣어 잘리는 것도 확인했다. 선택기 너비를 88→128px로 넓힌 뒤 실제 라벨 `clientWidth=scrollWidth=63`으로 잘림 해소를 확인했다.
- 10/15/20 한도와 기존 여러 줄 수업 정보는 유지했다. 최소 5행 자동 fallback은 사용자 선택을 기다리며 적용하지 않았다.

### 기본 목록 높이 매트릭스

전체 문서 높이는 `document.documentElement.scrollHeight`, 뷰포트 높이는 `innerHeight`로 측정했다. 수업은 기본 학기·전체 과목·빈 검색어, 학생은 기본 필터다. 표의 실제 데이터 행만 센다.

| 화면 | 뷰포트 | 자동/실제 행 | 수정 전 문서 높이 | 수정 후 문서 높이 | 화면 내 수용 |
|---|---:|---:|---:|---:|---|
| 학생 | 1440×768 | 10 / 10 | 821 | 768 | 통과 |
| 학생 | 1440×900 | 10 / 10 | 900 | 900 | 통과 |
| 학생 | 1440×952 | 15 / 15 | 1006 | 952 | 통과 |
| 수업 | 1440×768 | 10 / 10 | 1065 | 997 | 미통과 |
| 수업 | 1440×900 | 10 / 10 | 1065 | 997 | 미통과 |
| 수업 | 1440×952 | 10 / 10 | 1065 | 997 | 미통과 |

학생 행은 약 37px, 수업 행은 실제로 37~81px였다. 수업의 일정/선생님/강의실 여러 줄을 숨기지 않았으므로 단순 `34px × 행 수` 가정은 성립하지 않는다. 최소 10행보다 작은 자동 크기를 허용해야 하는 근거다. 첫 행 한 개의 측정만으로 이질적인 모든 수업 행의 수용을 보장할 수 없다는 제약도 남는다.

### 상호작용과 화면 상태

| 검사 | 결과/증거 |
|---|---|
| 페이지 식별·빈 화면·프레임워크 overlay | 학생/수업 제목·실제 목록 DOM 확인, 빈 화면 및 오류 overlay 없음 |
| 콘솔 | 이번 세션 error/warn 0 |
| 학생 선택/해제 | 선택 도구 표시 및 해제 작동. 768px 선택 시 문서 871px로 증가하여 no-scroll은 미통과. 해제하면 768px로 복귀 |
| 수업 빠른 검색 | `고1`→`고2` 입력 직후 기존 행 유지, 최종 URL/행은 최신 검색어와 일치. 실제 네트워크 취소를 뜻하지 않음 |
| 검색 초기화 | 키보드 전체 선택→Backspace 후 빈 검색어와 기본 목록 복원 |
| 추가 로드 | 통합 footer의 `다음 10건` 클릭 후 `페이지 1 / 2`, 현재 표시 행은 10 유지 |
| 페이지 이동 | `다음` 클릭 후 `페이지 2 / 2 · 표시 범위 11–20` |
| 수동 크기·복원 | 2페이지에서 15행 선택 시 1페이지로 복귀. reload 후 수동 15 유지. UI로 자동 복원 후 768px에서 10행으로 복귀 |
| 스크롤 안정성 | 수업 952px에서 scrollY 0→45 후 자동 10·문서 높이 997 유지 |
| 모바일 | 390×844 학생 카드 렌더링, 데스크톱 표 숨김, 문서 가로폭 390으로 수평 overflow 없음. 카드 세로 스크롤은 기존 동작 |
| 스크린샷 | Browser 런타임으로 모바일/하단 화면 확인. 학생 개인정보가 포함된 스크린샷 파일은 저장소에 저장하지 않음 |

### 수정 후 자동 검증

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/query-surface-budget.test.mjs tests/keyset-pagination.test.mjs tests/management-page-size.test.mjs tests/management-request-gate.test.mjs tests/management-request-lifecycle.test.mjs tests/management-list-load-state.test.mjs tests/management-progressive-loading.test.mjs tests/management-filter-transition.test.mjs tests/management-students-toolbar.test.mjs
```

- 181/181 통과, 실패·취소·skip 0 (22.1초).
- 전체 lint exit 0: 오류 0, 동일한 기존 경고 6개.
- 수정 파일 TypeScript/ESLint 및 독립 코드 리뷰 통과.
- 최종 `next build --webpack` exit 0: compile 4.1초, TypeScript 통과, 정적 페이지 81/81.

### 아직 주장하지 않는 항목

- Browser의 현재 지원 API에는 네트워크 요청 본문/취소 검사가 없어 실제 `p_limit`, boundary row, transport/server query abort는 관측하지 못했다. 서비스의 signal/limit 계약 테스트와 혼동하지 않는다.
- 장애를 강제로 주입하지 않아 실제 브라우저 오류 후 재시도 복구는 자동 테스트 근거만 있다.
- 여러 줄 수업 및 작은 화면 선택 도구의 완전한 no-scroll은 미완료다. 자동 5행 fallback/더 견고한 행 높이 정책 검토가 필요하다.
- push·배포·DB migration 적용·운영 p50/p95 측정은 하지 않았다.
