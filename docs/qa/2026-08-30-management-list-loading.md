# 관리 목록 로딩 슬라이스 로컬 QA 보고서

- 검증일: 2026-08-30 (Asia/Seoul)
- 작업공간: `/Users/hyunjun/Documents/Codex/tips_dashboard`
- 브랜치/검증 기준: `codex/loading-performance` / `07f1737d` 이후 최종 리뷰 보완 포함
- 로컬 프로덕션 서버: `http://localhost:3017` (`next start -p 3017`)
- 결론: 집중 회귀, TypeScript, lint, 프로덕션 빌드는 통과했다. 인증된 브라우저 세션이 없어 관리 목록 내부의 768/900/952px 동작은 관찰하지 못했다. 이 문서는 로컬 증거만 기록하며 원격 배포나 운영 성능을 주장하지 않는다.

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

인증된 admin 세션을 인앱 Browser 또는 Chrome에 준비한 뒤 같은 로컬 서버에서 두 경로를 각각 1440×768, 1440×900, 1440×952로 다시 검증해야 한다. 그 실행에서는 화면 표시 페이지 크기·실제 행 수·`scrollHeight/innerHeight`, 선택/해제 전후 측정 안정성, 필터/새로고침 중 행 유지, 오류 alert/console, 가능할 경우 네트워크의 `p_limit`을 한 표에 기록해야 한다.
