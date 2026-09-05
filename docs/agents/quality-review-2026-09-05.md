# 지속 품질 개선: 2026-09-05 검토표

## 범위와 기준점

- 기준: `origin/main`의 `839a3e92`. 원래 checkout의 `codex/registration-postdeploy-receipt-compat` 및 사용자 변경을 보존하고 `codex/quality-foundation-20260905` worktree에서 작업한다.
- 실제 로컬 설치본: Next 16.1.1, React 19.2.3, Tailwind 4.1.18, Radix Tabs 1.1.13, Supabase JS 2.108.2, TypeScript 5.9.3, JSDOM 29.1.1. `package.json` Supabase 선언 `^2.103.1`과 설치 버전은 구분한다. 새 의존성은 추가하지 않았다.
- GitHub open Issues 조회 결과 0개. 이 문서는 전체 점검 영역과 발견 사항의 로컬 대장이다. Issues 생성·외부 게시·운영 반영은 수행하지 않았다.
- 전체 코드를 분류했으며 아래의 **미검토** 영역은 검증 완료를 뜻하지 않는다. 첫 회차는 기준 정비와 대시보드→통계 흐름의 세 수정이다.
- 브라우저 근거는 기존 운영 화면의 읽기 전용 재현과 수정한 로컬 화면 검증을 구분한다. 운영에서 업무 저장·예약·알림 발송은 실행하지 않는다.
- 인증/권한/데이터 손상/업무 차단을 우선한다. 현재 선별 범위에서 새로 재현된 해당 결함은 없으며, 앱 전체가 안전하다는 판정은 아니다.

## 전체 점검 영역

| 영역 | 확인한 범위 | 아직 필요한 검토 |
| --- | --- | --- |
| 인증·역할·관리자 진입 | 로그인/guard 기존 47개 기준 테스트 묶음에 포함; route 경계 코드 표본 | 역할별 실제 로그인, 세션 만료 중 저장, 각 API/RLS 전체 경로 |
| 대시보드 | 바로가기 DOM·소스, daily brief service의 8초 timeout/retry 제한 확인 | 빈 업무/오류/기간 경계, KPI의 최종 DB 정의 및 운영 측정 |
| 통계 | 네 탭 및 조회 hook/cache/cancellation 코드; 운영 재현과 현재 계정의 로컬 desktop/mobile/keyboard 검증 | 일정 충돌 업무 연결 조회 오류 Q-09, 대규모 drilldown·다른 역할별 흐름 |
| 등록·전반·퇴원 | 최신 main의 안정화/receipt/퇴원 수정 보존; route·테스트 목록화 | 실제 상태 전이/수정 충돌/예약·알림 분리 전 과정, 최종 RPC/pgTAP |
| 업무·결재·보강 | route·기능 디렉터리·테스트 목록화 | 생성→배정→완료/재시도, 중복 실행·역할·취소/저장 경쟁 |
| 학생·수업·설정 목록 | 관리 목록 10/15/20행·10페이지 탐색·loading 경계 기준 테스트 | 각 목록 CRUD/필터/정렬/내보내기·상세 catalog 역할 검증 |
| 학사일정·시간표·수업계획 | route·기능 디렉터리 목록화 | 모바일/키보드 이동, 주간 경계/충돌·강의실·선생님 전체 목록 |
| 교재·재고·정산 | route·기능 디렉터리 목록화 | 요청→주문→입고→출고, 수량 정합성·정산·실패 복구 |
| 알림·외부 연동 | API role/auth 코드 표본 및 테스트 분류; no-send 유지 | control plane/worker/실수신 evidence를 분리한 별도 감사 |
| 공개 페이지·공개 수업 API | route·cache 경계 및 기존 테스트 목록화 | 허용 필드/캐시 무효화·모바일 실제 사용·응답량 측정 |
| 공통 UI·디자인 | semantic tokens/기존 Radix 컴포넌트, 탭·필터·pagination 확인 | dialog/focus return/폼 오류/빈 화면·다크 모드 전 화면 |
| 배포·DB·관측성 | 최신 origin/main과 격리 브랜치 기준점 확인 | CI·production readiness·migration ledger·로그·provider별 운영 검증 |

## 발견 사항과 개선 후보

P2는 현재 업무를 불편하게 하거나 잘못된 화면으로 유도하는 재현된 결함이다. 후속 후보는 추가 재현/측정 뒤 순위를 확정한다.

| ID | 우선순위·상태 | 적용 기준과 코드·브라우저 근거 | 사용자 영향·개선안 |
| --- | --- | --- | --- |
| Q-01 | P2 · 로컬 수정 | 다음 행동과 목적지 일치. [dashboard-daily-brief.tsx](../../src/features/dashboard/dashboard-daily-brief.tsx)의 통계 href와 운영 바로가기 DOM이 `/admin/classes`; sidebar 통계는 `/admin/statistics` | 통계를 눌러 수업관리로 이동하던 경로를 `/admin/statistics`로 수정. 실제 렌더된 링크 회귀 검사 통과 |
| Q-02 | P2 · 로컬 수정 | WAI-ARIA Tabs + 기존 Radix. [statistics-workspace.tsx](../../src/features/dashboard/statistics-workspace.tsx)의 기존 Button role=tab는 방향키 처리/tabpanel/aria-controls 없음. 운영 ArrowRight 후 기존 탭에 포커스 잔류 | 공통 Tabs와 수동 활성화로 이동과 조회를 분리. 로컬 DOM 검사·브라우저에서 방향키는 focus만 이동하고 샘플 추가 조회 0회, Enter는 활성화함을 확인 |
| Q-03 | P2 · 로컬 수정 | 로딩·오류에서도 조건과 조작 위치 유지. `PanelState`가 children 전체를 loading/error에 숨기며 필터가 그 안에 있음. 운영 영어 클릭 직후 버튼 없음·focus BODY 재현 | controls를 결과와 분리. 브라우저에서 과목·일정/교재 기간이 pending/error에도 남고 선택·포커스 유지. 새 조건 대기 중 낡은 결과는 숨김 |
| Q-04 | 후속 · 추가 재현 | `command-search.tsx`의 Ctrl+K 고정 표기와 `site-header.tsx`의 key 비교 | macOS 안내 및 한국어 입력 상태 단축키를 실제로 확인한 뒤 플랫폼 표기/코드 기반 키 처리 검토 |
| Q-05 | 후속 · 측정 필요 | `use-statistics-snapshot.ts`의 cache key·AbortController는 이미 존재 | DB 응답/전송량/요청 수와 drilldown 비용 측정 후 병목만 수정. 기존 취소/권한 구현을 불필요하게 교체하지 않음 |
| Q-06 | 후속 · 검증 필요 | 등록·알림 관련 기존 최종 migration/상태 독립성/발송 통제 테스트 다수 | 최신 main에서 최종 SQL 정의와 실제 SQLSTATE·pgTAP부터 확인. 과거 사고를 현존 버그로 간주하지 않음 |
| Q-07 | 후속 · 검증 필요 | 공통 dialog/form/table/모바일 흐름 | 저장·취소 후 focus return, 오류 시 입력 보존, 빈 상태 다음 행동, 좁은 화면 overflow 순서로 확대 |
| Q-08 | 후속 · 기존 lint 경고 | 전체 lint: timetable-workspace useMemo 불필요 의존성 1, ops-task-service 미사용 함수 3, public-classes-cache-invalidation 미사용 인자 1, 공개 수업 integration test 미사용 import 1 | 이번 변경 파일 밖의 경고 6개. 각 업무 검토 시 사용 경로를 확인하고 정리. 파일 크기 500KB 초과 Babel 안내 2건은 런타임 성능 결함으로 단정하지 않음 |
| Q-09 | P2 · 추가 발견, 미수정 | 실제 계정에서 일정 충돌 집계는 성공했으나 업무 연결 영역에 `dashboard_conflict_input_invalid` 표시. [section-cards.tsx](../../src/app/admin/dashboard/components/section-cards.tsx)의 조회 effect가 `listDashboardConflictTaskLinks(currentRows.map(projectDashboardConflictRpcInput))`를 호출하며 실패 상태를 표시 | 연결된 업무를 확인할 수 없음. 클라이언트 projection과 최종 RPC 입력 계약·SQLSTATE·pgTAP을 다음 묶음에서 대조해야 함. 업무 등록/재시도 버튼은 누르지 않았으며 실제 원인은 아직 확정하지 않음 |

## 방법의 효과를 판단하는 파일럿

| 방법 | 채택 조건 | 측정/실패 조건 |
| --- | --- | --- |
| 공식 기준 → TIPS DESIGN.md → 짧은 task skill | 기존 용어·토큰·권한을 보존하고 출처/버전/라이선스를 추적 | 지침 때문에 무관한 재설계·패키지 중복·추가 승인이 생기면 규칙 축소 |
| 설치된 Radix Tabs 재사용 | 실제 keyboard/ARIA 행동 회귀 검사가 통과하고 활성 패널만 조회 | 화살표만으로 RPC 증가, 숨겨진 패널 mount/fetch, 모바일 overflow면 보류/수정 |
| loading 결과와 controls 분리 | 초기/조건 변경/오류에서 필터·선택·focus 유지 | 낡은 조건 데이터 표시, 오류 retry 손상, 불필요한 컴포넌트 계층이면 수정 |
| 실제 React DOM 회귀 검사 + 브라우저 | 기존 코드에서 예상 원인으로 실패하고 수정 후 통과 | 소스 문자열만 맞거나 브라우저 결과와 다르면 검사 재작성 |

탭 검토는 2026-09-05에 직접 읽은 [WAI-ARIA Tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)과 [Radix Tabs API](https://www.radix-ui.com/primitives/docs/components/tabs)를 적용한다. Radix 문서는 1.1.18을 표시하지만 앱 설치본은 1.1.13이므로 API 예제를 무조건 복사하지 않고 설치본의 manual activation과 ARIA 동작을 실제 테스트한다. 신호가 늦게 오는 패널에서 키 이동만으로 자동 조회하지 않는 판단은 APG의 latency 조건에 따른 것이다.

시간 절약·응답속도 개선 수치는 측정 전에는 주장하지 않는다. 이번 UI 실험은 목적지, 키보드 이동, 포커스 유지, 불필요한 탭 활성화 여부로 효과를 판정한다.

조사 단서로 X의 [스킬 기반 재현·리뷰·브라우저 검증 경험담](https://x.com/heynavtoor/status/2036861280859124100)을 2026-09-05 검색했다. 게시물의 생산성 배수와 모든 도구 연결 주장은 TIPS에서 검증되지 않았으며 채택 근거로 쓰지 않는다. 실제 채택 조건과 제작자 원문은 [출처 대장](quality-sources.md)에 기록했다. 이번에는 기존 도구만으로 검증 가능하므로 추가 MCP·스킬 관리 앱 도입은 보류한다.

## 검증 기록

- 변경 전: auth-login/auth-guard-loading/data-table-pagination/management-page-size/management-list-load-state/numbered-pagination **47/47 통과**.
- 경계 표본: statistics-aggregate-auth/registration-observation-status-independence/registration-observation-stale-revision-hotfix/notification-external-attempt-gate/management-operational-rls **12/12 통과**. 코드·기존 마이그레이션 계약/모의 provider 차단 검사이며, 운영 DB의 최종 함수 실행이나 실제 역할별 브라우저 검증을 대신하지 않는다.
- 변경 전 운영 브라우저: Q-01 href, Q-02 ArrowRight와 tab/panel ARIA, Q-03 영어 클릭 중 버튼 unmount와 BODY focus 직접 재현.
- 미인증 로컬 HTTP: `GET /api/dashboard/statistics?tab=overview` → **401**, `Cache-Control: private, no-store`. 운영 사용자 데이터나 발송 동작 없이 진입 차단을 확인했다.
- 변경 후 회귀: 실제 React DOM 검사 **4개가 기존 코드에서 예상 원인으로 실패**한 뒤 수정 후 통과. 통계 workspace/snapshot-cache/drilldown/aggregate-auth/resource-pressure와 dashboard daily-brief/snapshot-cache를 합친 **60/60 통과**, 경고/skip 없음. 검사 실행 묶음 간 공통 테스트는 중복 집계하지 않는다.
- 전체 lint: **오류 0 / 기존 경고 6**. `next build --webpack` 통과(81개 정적 페이지 생성), 이후 `tsc --noEmit` 통과. 로그는 로컬 `/tmp/tips-quality-{lint,build,types}-20260905.log`에 보관.
- 앱/회귀 로컬 커밋: `a6b4add1` (`fix statistics workspace interactions`), 소스 2개·테스트 2개. DB/권한/cache hook/발송 구현·의존성은 변경하지 않았다.
- 브라우저 오류/지연 조건을 결정적으로 검증하기 위해 `/tmp/tips-quality-browser-20260905`의 독립 Next fixture를 사용한다(`http://localhost:3026`). 실제 dashboard/statistics/common UI와 globals.css를 import하고 데이터 hook·drilldown·충돌 업무 액션만 샘플로 대체한다. `.env`/실제 계정/API/provider를 연결하지 않으며 배포하지 않는다. 인위적인 1.5초 지연은 재현 조건이며 성능 수치가 아니다. 로컬 실제 관리자 앱은 `http://localhost:3025`, 로그인 검증과 구분한다.
- 변경 후 브라우저: 실제 바로가기 클릭 → `/admin/statistics` 도착. 방향키/End로 focus만 이동하고 Enter로 활성화. 과목·일정 180/400일·교재 365일 선택이 loading/error에서 남으며 focus 유지. 성공 응답에서 선택 과목의 샘플 재원 7명으로 갱신. 분포/수업 목록이 빈 경우의 표시, 다크 모드, 390px·1440px에서 문서 가로 넘침 없음 확인.
- 브라우저 fixture의 런타임 error는 없었다. 개발 도중 Fast Refresh full reload와 기존 smooth-scroll CSS에 대한 Next 안내 warning은 기록됐으며, 프로덕션 오류나 새 UI 변경의 경고로 집계하지 않는다. 인증된 실제 앱의 콘솔 무오류를 뜻하지 않는다.
- 독립 작업 리뷰: 지침 및 세 UI 변경 모두 차단할 발견 사항 없음. 최종 전체 diff `839a3e92..98762553`도 별도 reviewer가 검토해 **차단할 결함 없음, 로컬 브랜치 준비 완료**로 판정했다. 이는 실제 계정 검증·병합·배포 완료를 뜻하지 않는다.
- **로그인 후 추가 검증 완료 (2026-09-05):** 사용자 로그인 후 동일 계정 세션으로 `localhost:3025`의 대시보드→통계 실제 이동, 방향키 focus-only/Enter 활성화 및 ARIA 연결, 과목·일정 180일·교재 365일 조회 중 선택/포커스 유지와 실제 응답 완료를 확인했다. 390px와 1440px에서 가로 넘침이 없고 라이트/다크 모드 표시를 확인했다. 원래 다크 테마와 기본 viewport로 복원했다. 현재 계정의 세 UI 수정 통합 검증을 완료했으며 다른 역할·저장·발송·전체 업무 흐름 검증을 뜻하지 않는다.
- 일정 충돌 집계와 기간 조회는 정상 완료했지만 별도 업무 연결 조회 오류 Q-09가 드러났다. 따라서 통계 전체 업무 흐름이 무오류라고 판정하지 않는다. 실제 API 장애를 유도하지 않았으므로 강제 오류/빈 데이터 회귀 검증 근거는 앞선 fixture와 동작 테스트로 유지한다.
- 로컬 환경 복구: 기존 webpack dev 프로세스가 약 2시간 경과 상태에서 HTTP 요청에 10초 동안 응답하지 않았고 CPU 119%, 메모리 14.6%가 관찰됐다. 해당 worktree/3025 프로세스만 종료하고 검증된 기존 build를 `next start`로 실행해 HTTP 200과 로그인 세션 복구를 확인했다. dev 정지의 내부 원인은 미확정이며 앱 성능 개선으로 주장하지 않는다. 운영 main/배포/DB 적용/실제 발송은 수행하지 않았다.

## 파일럿 판정

| 기준 | 수정 전 | 수정 후 | 판정 |
| --- | --- | --- | --- |
| 바로가기 목적지 | 수업관리 `/admin/classes` | 통계 `/admin/statistics` | 오류 해결 |
| 탭 키보드·ARIA | 방향키 미동작, panel 연결 없음 | roving focus, linked panel, manual activation | 기존 공통 컴포넌트 채택 효과 확인 |
| 조회 중/오류 후 필터 | 버튼 사라짐, BODY focus | 버튼·선택·focus 유지 | controls/result 분리 채택 |
| 키 탐색의 부수 조회 | 기존 탭은 키 탐색 자체 불가 | 화살표 이동 시 샘플 추가 조회 **0회** | 원격 API의 실제 지연 개선 수치는 미측정 |
| 회귀 검사의 결함 검출 | 새 행동 검사 **4/4 실패** | 동일 결함 검사 **4/4 통과**, 관련 묶음 **60/60** | 행동 검사 유지, 기존 구현 문자열 검사 일부 대체 |

브랜드 MD를 통째로 복제하거나 새 UI 라이브러리·MCP를 설치할 필요는 없었다. 수정한 부분에 한해 문서 기준→기존 공통 원시→행동 검사→브라우저 확인 연결의 효과가 확인됐다. 작업 시간 절약이나 서버 성능 개선은 이번 회차에서 측정하지 않았다.

## 다음 회차

다음 묶음은 실제 계정 검증에서 발견한 일정 충돌 업무 연결 조회 Q-09의 입력 계약 확인이며, 이어 등록 상태 전이·동시성·no-send 경계를 검토한다. 실제 저장이 필요한 검증은 로컬 fixture/격리 DB의 해당 업무 시나리오부터 재현하고 운영 조작과 구분한다. 위 표를 갱신하며 한 번에 관련된 작은 변경만 수행한다.

매 회차 현재 문제에 도움이 되는 방법 1–3개만 비교한다. 같은 접근으로 두 번 실패하면 기존 가설·재현·로그를 다시 확인하고 관련 공식 문서·GitHub 이슈를 추가 조사한다. 채택한 기준이 결함 재발/검증 품질/유지보수 부담에 효과가 없으면 수정하거나 제거한다. 원인 확인→작은 구현→변경에 맞는 검증→diff 검토→로컬 커밋을 끝낸 뒤 다음 묶음으로 이동한다. main 반영·운영 배포·DB 적용·실제 발송은 해당 회차의 별도 지시를 따른다.
