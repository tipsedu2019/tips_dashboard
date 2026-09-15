# TIPS Dashboard — AI 실행 카드

기준: 2026-09-12 원격 main `bf504a7a0b336becec182b8f396b463056e6f204`.

이 문서는 [전체 명세](2026-09-12-premium-dashboard-master-plan.md)의 구현 지시서다. **현재는 T00–T23 미착수, T24 취소**다. 2026-09-15 사용자 정정에 따라 실제 출품 준비는 제외한다. GitHub에 이미 존재하는 Issue와 중복 여부를 확인할 수 있지만, 이 문서 작성으로 Issue 발행·구현·배포를 실행한 것은 아니다.

2026-09-15 추가 범위: 커스텀 단축키와 힌트는 제거한다. 공개 UI는 `tips_dashboard_public`에서 운영하며 이 프로젝트에 다시 구현하지 않는다. 내부 홈페이지 관리, 공개 데이터 API와 캐시 무효화는 사용자 선택에 따라 유지한다. 이 범위 정리 구현은 `codex/internal-dashboard-only-20260915`의 별도 변경이며 기존 디자인 카드 완료를 뜻하지 않는다.

## 실행 방식

카드 하나를 완료한 다음 그 카드의 증거와 최신 HEAD를 다음 카드에 전달한다. 아래 ‘수정’ 파일만 바꾼다. 다른 파일을 수정해야 하면 먼저 왜 필요한지 변경 계획에 기록하고 독립 카드로 나눈다. `tests/`의 해당 행동 테스트와 같은 카드의 검수 기록은 허용한다.

‘낮음’은 스타일·순수 표시 위주의 구현 난도다. 낮은 추론 모델이 맡아도 되는 후보라는 뜻이며 자동 무검수 병합을 뜻하지 않는다. ‘중간’은 비동기·URL·focus·draft가 있어 별도 코드 리뷰가 필요하다. ‘설계’는 실행 모델에 모호한 요구를 넘기지 않기 위한 선행 계약 작업이다.

### GPT-6 Astra 실행 추론 권장값 — 2026-09-15

표의 구현 난도와 Codex의 추론 설정은 서로 다른 값이다. 이 계획을 카드별로 실행할 때는 Medium으로 시작하고 아래 경우에 조정한다. 설정 하나로 전체 작업을 맡기려면 High를 사용한다.

| 실제 작업 | 권장 추론 | 적용 조건 |
|---|---|---|
| 문구·간격·색 등 작은 수정 | Low | 명세가 확정되어 있고 상태나 공통 동작에 영향이 없을 때 |
| 명세가 확정된 순수 표시 및 컴포넌트 구현 | Medium | 한 카드씩 구현하고 실제 브라우저 검수까지 수행 |
| 비동기·URL 복원·focus·draft·저장 경계 또는 넓은 공통 변경 | High | 예: T02, T05, T09, T11–T17, T19. 도메인 동작을 새로 설계할 권한을 뜻하지 않음 |
| 어려운 회귀 결함, 명세와 현재 코드의 구조적 충돌, 복잡한 통합 검토 | XHigh | 원인이나 해결 기준이 불명확한 구간에 한정 |
| 큰 제품 방향·아키텍처를 다시 정해야 하는 경우 | Ultra | 일상적인 카드 실행의 기본값으로 사용하지 않음 |

권장값은 이 작업에 대한 실무 판단이며 공식 성능 비교 결과가 아니다. 첫 표시 카드와 첫 상태 카드를 완료한 뒤 실제 소요 시간, 재수정, 검수 누락을 비교해 조정한다. 추론 수준을 낮추어도 카드의 완료 기준은 유지한다. 문서나 프롬프트에 수준을 적는 것만으로 실제 설정이 바뀌지 않으므로 Codex의 모델/추론 선택을 확인한다.

실행 시 전체 명세를 매번 다시 읽히지 말고 해당 카드, 연결된 명세 절, 수정에 필요한 코드와 직전 검수 결과를 전달한다. 승인된 범위의 구현·화면 확인·발견된 결함 수정까지를 완료 조건으로 둔다. 참고: [OpenAI의 Astra 지침 정리 가이드](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra).

### 모든 카드의 보호 경계

1. 인증/역할/RLS/ACL/tenant/actor를 디자인 목적에 맞춰 느슨하게 만들지 않는다.
2. migration, RPC 이름/인자, API 응답, provider/발송, 재고/등록 계산을 UI 카드에서 수정하지 않는다.
3. 기존 페이지 크기10/15/20·기본10·10페이지 묶음·URL 복원·deep link 유지.
4. 저장 requestId, draft revision, stale response, 초안 이탈 보호, 부분 실패 복구 유지.
5. 기존 라이브러리 재사용. package/lockfile 변경은 폰트·QA처럼 카드가 명시한 경우만 별도 검토.
6. 합성 fixture만 편집. 운영 화면에서는 읽기/탐색만 검수. 실제 발송/출고/반품/실사는 별도 승인 범위.
7. ‘수치가 있어 보이게’ 매출·추세·성장률·점수·목표 달성률 생성 금지.
8. 광범위 정규식 교체, giant workspace 전면 분해, 코드 전체 포맷팅 금지.
9. 기존 local 작업·다른 에이전트 변경을 reset/checkout/clean으로 지우지 않는다.

### 표준 완료 산출물

각 카드에 `docs/qa/premium-dashboard/TNN.md`를 작성한다. 새 검수 문서 이름이며 현재 존재한다고 가정하지 않는다.

```text
카드 / 시작 SHA / 종료 SHA 또는 uncommitted
변경: 사용자에게 달라지는 동작 1–3개
변경 파일: 실제 목록
검사: 명령, exit code, 실제 결과; 미실행 구분
브라우저: 경로, fixture, viewport, 행동, 기대값, 실제값, 캡처 경로
보존 확인: 영향을 받는 기존 계약
남은 사항: 오류/환경 차이/승인 필요 여부
다음 카드: 의존성 충족 여부
```

### 검증 명령의 사용 원칙

새 worktree에서 Node/pnpm 경로를 확인한다. 시스템 PATH에 없으면 다음 기존 런타임 경로의 존재를 확인한 뒤 사용한다.

```sh
export PATH="/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
pnpm exec tsc --noEmit
pnpm exec eslint <이번에 변경한 실제 소스와 테스트 파일>
node --test --experimental-strip-types <카드에 해당하는 실제 테스트 파일>
pnpm build
```

꺾쇠 부분은 설명용이며 명령에 그대로 붙이지 않는다. 이 저장소에는 일반 `pnpm test` 스크립트가 확인되지 않았다. 테스트를 지어내거나 안 돌린 명령을 ‘통과’로 쓰지 않는다. 사소한 스타일마다 전체 suite를 돌리지 않고 관련 테스트+브라우저를 우선한다. 공통 기반 변경과 릴리스 단계에서 필요한 넓은 검사를 수행한다.

## 작업 순서표

| 카드 | 결과 | 의존 | 난도 | 예상 집중 작업* |
|---|---|---|---|---|
| T00 | 최신 기준·변경 경계 | 없음 | 낮음 | 0.5–1h |
| T01 | 합성 fixture·before/target manifest | T00 | 설계 | 3–6h |
| T02 | 대시보드 비동기 상태 | T01 | 중간 | 2–4h |
| T03 | 날짜·일정 중심 첫 화면 | T02 | 낮음 | 2–4h |
| T04 | 토큰·제어 수치 기준 | T01 | 낮음 | 2–4h |
| T05 | 전역 셸 통일 | T04 | 중간 | 3–5h |
| T06 | 폰트 공급 고정 | T04 | 중간 | 2–4h |
| T07 | 실제 컴포넌트 gallery | T04–06 | 낮음 | 2–4h |
| T08 | 공통 표/도구 밀도 정렬 | T07 | 낮음 | 3–5h |
| T09 | 모바일 필터 패턴 | T08 | 중간 | 3–5h |
| T10 | 학생 표·표시 형식 | T08 | 낮음 | 2–4h |
| T11 | 학생 상세 집중도 | T10 | 중간 | 3–5h |
| T12 | 수업 목록·상세 일관성 | T11 | 중간 | 3–5h |
| T13 | 등록 목록의 반복 표식 정리 | T08 | 중간 | 3–5h |
| T14 | 등록 상세의 이동·편집 | T13 | 중간 | 4–6h |
| T15 | 수업일정 상태·다음 작업 | T08 | 중간 | 3–5h |
| T16 | 교재5탭 수량·피드백 | T09 | 중간 | 4–8h |
| T17 | 통계 갱신 상태 | T02, T07 | 중간 | 2–4h |
| T18 | 통계 비교·단위 | T17 | 낮음 | 3–5h |
| T19 | 통계 URL 복원 | T17 | 중간 | 3–5h |
| T20 | 나머지 화면 적용 목록 | T05, T08 | 설계+낮음 | 4–8h |
| T21 | 개체 검색/일정 진입 계약 | T03, T13 | 설계 | 3–5h |
| T22 | 사용성·접근성·성능 통합 검수 | 릴리스 포함 카드 | 중간 | 6–12h |
| T23 | 릴리스 검토 패키지 | T22 | 중간 | 2–4h |
| T24 | 취소 — 실제 출품 준비 제외 | — | — | — |

*숙련 구현자+AI의 예상 집중 시간이며 벤치마크가 아니다. 리뷰 대기, 환경 준비, 사용성 참여자 모집, 추가 수정은 제외. T20은 필요 시 하위 카드로 나누며 실제 전체 일정은 첫 대표 구현 후 재산정. 취소된 T24는 작업량에 포함하지 않는다.

## T00 — 최신 기준과 작업 경계를 확정한다

- 목적: 오래된 루트 코드에 최신 UI를 중복 구현하는 실수 방지.
- 읽기: root AGENTS, 최신 DESIGN, ui README, git status/worktree/remote main.
- 수정: 새 계획/검수 파일만. 앱 소스 수정 없음.
- 순서: `git status --short` → `git worktree list` → 원격 main SHA 읽기 → 기존 작업과 충돌 없는 `codex/` 새 branch/worktree 구성 → 새 worktree SHA 재확인 → 이 계획 문서 복사 또는 경로 연결.
- 기존 worktree가 dirty면 덮거나 reset하지 않는다. 원격이 문서 SHA 이후라면 차이를 먼저 읽고 새 baseline을 기록한다.
- 완료: baseline SHA, 실행 경로, runtime, port, 관련 미완료 Issue/PR, 보호 파일 범위를 manifest에 기록.
- 검수: 현재 root HEAD가 최신이라고 가정하지 않았는지, 사용자 미커밋 변경이 그대로인지 확인.

## T01 — before와 대표 target을 재현 가능하게 만든다

- 목적: AI가 ‘고급스럽게’를 매번 새로 해석하지 않도록 비교 대상 고정.
- 읽기: master §5–9, 최신 `docs/qa/2026-09-11-global-apple-polish.md`, 기존 fixture 관련 script.
- 수정: `tests/fixtures/` 내 작은 합성 fixture, `scripts/qa/` 내 필요한 harness, `docs/qa/premium-dashboard/baseline.md`.
- 순서: 기존 fixture를 찾아 실제 component를 렌더 → 개인정보 없는 A–G 데이터 → 1440/390 동일 viewport screenshot → 화면명/role/data/state/route/SHA manifest 작성.
- target 결정: master 수치로 대시보드와 학생 표/상세의 대표 구성안을 준비하고 브라우저 시안으로 시각 검토한다. 이미 유효한 승인 시안이 있으면 재선택 과정을 만들지 않는다. 미세한 줄바꿈/넓이를 정한 target 이미지를 기록한다.
- 운영 화면 캡처를 fixture로 복제하지 않는다. 서버 handler/보호 로직을 모조 화면으로 바꾸지 않는다.
- 완료: 다른 AI가 문서대로 동일 상태를 띄울 수 있음. 최초/빈/성공/실패/긴 이름은 별개 fixture ID.
- 테스트: fixture 생성 정규식 test 금지; 실제 접근·렌더·로딩 완료 확인.

## T02 — 대시보드의 초기/갱신/실패 상태를 정확히 처리한다

- 읽기/수정: `src/features/dashboard/use-dashboard-daily-brief.ts`; 필요한 경우 같은 폴더의 순수 상태 helper 신규 추가.
- 읽기만: `daily-brief-contract.ts`, `daily-brief-service.ts`, Supabase auth lifecycle.
- 입력: 현재 `brief/loading/error/retry`, requestRevision, user/session identity.
- 출력: 기존 interface 우선 유지. consumer가 구분해야 하면 `isInitialLoading/isRefreshing`은 현재 값으로 파생하고 중복 state 저장을 피한다.
- 순서: 최초 null+loading → 성공 brief 수락 → 동일 identity/날짜 retry에서는 brief 유지 → 실패는 error만 갱신 → 늦은 응답 무시 → signout/role change/다른 날짜는 보호 데이터 제거.
- 새 polling/자동 retry 추가 없음. 기존8초 timeout와 retry(false) 유지.
- Given/When/Then: 성공 fixture A 후 동일 요청500 → A와 이전 조회시각 유지 + 실패 표시 가능; 다른 사용자 전환 → A 제거; B가 A보다 늦게 시작해 먼저 끝나면 A가 B 덮지 않음.
- 검증: 기존 `tests/dashboard-daily-brief.test.mjs`와 비동기 hook/상태의 행동 테스트. mocked auth/date boundary 포함. 수치 CSS test 금지.
- 완료 증거: 최초/동일 재조회 실패/재시도 성공/identity 변경4개 결과.

## T03 — 대시보드를 날짜와 일정 중심으로 완성한다

- 수정: `src/features/dashboard/dashboard-daily-brief.tsx`; 필요할 때 같은 feature의 순수 표시 component.
- 읽기만: `daily-brief-contract.ts`, `daily-brief-service.ts`, 기존 링크 계약.
- 사용: Button, 공통 상태/표면 token; 새로운 차트 없음.
- 명세: master S01. h1은 셸; content h2 ‘오늘의 일정’, KST 날짜, 실제 generatedAt, 세 지표 단위건, 시간64px(모바일48px), 일정행64px min.
- 최초 로딩: 지표와3일정행 skeleton. 정상0건: 좁은 빈 일정면과 등록 일정 링크. 실패: 재시도 가능,0건으로 대체 금지.
- 일정 href는 제공값 사용. 오늘 scheduled 시간순 첫5개이며 지난 시각도 임의 제외하지 않는다. 세 유형 counts 합계가5 초과면 전체 등록 일정 링크 제공. 카운트의 유형별 deep link는 T21 계약 전까지 만들지 않는다.
- Given 날짜 `2026-09-12`, 일정0 → ‘9월12일 토요일’과 정확한 범위 빈 문구; Given5일정 → 시간/제목/과목/장소와 실제 링크5개.
- 검증: 기존 daily-brief test;1440/390,5개·0개·loading·error screenshot. 날짜 자정/UTC parsing 경계.
- 완료: 첫 화면만으로 무엇의 몇 건인지 확인; 화면 대부분을 무의미 카드로 채우지 않음.

## T04 — 공통 토큰과 수치의 유일한 기준을 만든다

- 수정: `src/app/globals.css`, `src/components/ui/README.md`, `DESIGN.md`의 시각 수치 관련 부분.
- 읽기만: `ui/button.tsx`, `ui/form-dialog.tsx`, `data-table-surface.tsx`, student/class CSS.
- 순서: 현재값 inventory → master §6의 roles로 대응 → 기존 semantic 변수 재사용 → light/dark 색 대비 측정 → 부족한 조합만 중앙에서 보정 → token표 기록.
- desktop36, field42, mobile 주 행동44, 표44/48, radius6, control150/dialog200ms를 역할로 구분한다. 모든 control을44로 바꾸지 않는다.
- 색 보정은 hue 보존·본문4.5:1 목표. 상태 컬러는 텍스트로도 구분. disabled는 명도만으로 enabled처럼 보이지 않게 한다.
- 완료: 새로운 raw 색/모션/간격이 feature별 중복되지 않음. 기존 소비자와 별개 테마 시스템을 만들지 않음.
- 검증: button/input/select/tab/row의 정상·hover·selected·focus·disabled·error를 light/dark에서 실제 렌더. 정규식으로 색 문자열만 검사하지 않음.

## T05 — 학생 pilot 셸을 전 화면으로 정렬한다

- 수정: `src/components/site-header.tsx`, `app-sidebar.tsx`, `nav-main.tsx`, 필요시 `ui/sidebar.tsx`, `src/app/admin/layout.tsx`, `src/features/management/student-workspace.css`의 셸 부분만.
- 명세: master §7.1. desktop header64/mobile56 기본, sidebar256, 같은 logo36, 같은 menu40, 모바일 quick search 아이콘.
- 순서: 셸 component에 공통 class/속성 적용 → 학생 CSS의 global body:has 셸 selector만 삭제 → 학생 시트 전용 selector 유지 → 학생/홈/등록/교재 비교.
- header section/title 동일 문자열이면 section 생략. URL/meta의 의미 변경 없음.
- 금지: 메뉴 이름/그룹/권한/순서 변경, sidebar preferred side/mode 삭제, 모든 header 태그 전역 덮기.
- Given 학생→등록→교재 이동 → logo/header/menu 크기와 본문 시작선 동일; mobile390 → 제목·메뉴·검색 접근 가능.
- 검증: `tests/sidebar-focus-return.test.mjs`, `tests/command-search-navigation.test.mjs`, `tests/guarded-navigation.test.mjs`; keyboard/left/right/collapsed/hidden smoke.

## T06 — 실제 렌더되는 글꼴을 고정한다

- 읽기: `src/lib/fonts.ts`, `src/app/layout.tsx`, globals, 공식 Pretendard 배포/라이선스.
- 수정: 위 폰트 연결 파일, 필요한 자체 호스팅 asset·license. 범용 dependency upgrade 없음.
- 순서: desktop에서 실제 폰트 공급 확인 → 공식 정적/동적 subset 중 적합한 배포 검토 → 한 가지 선택 기록 → self-host → 기존 스택 fallback 유지 → 네트워크/줄바꿈 비교.
- 변수 굵기650 지원 없으면600으로 정규화. 헤더·표·dialog에서 다른 font-family를 쓰지 않는다.
- Given 폰트 다운로드 실패 → 시스템 fallback으로 입력/읽기 가능; Given 긴 한글 → baseline 대비 clipping0.
- 검증: 전송량·LCP/CLS·font load, Windows/macOS 가능한 환경 구분. 미보유 환경은 미검증으로 기록.
- 완료: 글꼴 파일 출처/라이선스/크기·로드 전략·사용 weight 기록. 전체 한글 preload 강제 금지.

## T07 — 실제 공통 컴포넌트의 상태 gallery를 만든다

- 수정: 기존 fixture 안의 gallery route/component, `src/components/ui/README.md`의 사용예. production nav에 gallery 노출 없음.
- 대상: Button/Input/Select/Checkbox/Tabs/DataTableToolbar/DataTableSurface/각 dialog/empty-error-loading.
- 순서: 실제 import로 렌더 → variant/size/state matrix → 긴 한글+숫자 → light/dark/mobile → target 캡처.
- 허용: 발견한 공통 component 결함은 작은 별도 카드 또는 이 카드 명시 범위로 수정. feature callback/state 이동 없음.
- 완료: 이후 AI가 `컴포넌트명 / variant / size / state`만 골라 같은 모양을 구현할 수 있음.
- 검증: 키보드 접근·focus·disabled 클릭 방지·dialog 복귀. gallery 자체를 흉내 낸 static HTML은 기준으로 인정하지 않음.

## T08 — 공통 표와 toolbar의 밀도를 정렬한다

- 수정: `src/components/data-table/data-table-surface.tsx`, 필요한 shared row-actions/filter 컴포넌트.
- 명세: master §7.2–7.3. 기존 header44/row48/padding12 유지, 이름 우선, 하나의 surface, 안정된 toolbar slots.
- 제어 종류·callback·pagination props는 그대로. 표 설정/초기화/필터가 다른 위치로 점프하지 않도록 슬롯을 고정한다.
- 선택/hover/focus는 서로 다르게 확인. 상태 비활성 사유는 실제 업무 의미가 있을 때만 제공.
- Given 긴 이름+20행 → 내부 스크롤 가능; filter loading/error → search/action의 y변화2px 이내 목표; 선택→더보기→Escape → focus 보존.
- 검증: `tests/data-table-surface.test.mjs`, `tests/data-table-pagination.test.mjs`, `tests/numbered-pagination.test.mjs`, `tests/management-filter-transition.test.mjs`.
- 완료: 학생/교재/수업계획에서 동작 불변, 포커스/로딩/오류 실제 렌더 확인.

## T09 — 교재 모바일 필터를 접힌 작업형으로 바꾼다

- 수정: `src/features/textbooks/textbook-operations-workspace.tsx`의 재고 분류 filter view; 필요시 새 `textbook-mobile-filters.tsx` 순수 view; `src/components/ui/README.md`의 이 명시적 예외.
- 읽기: shared filter/dialog/workspace tabs, 기존 applied filter owner와 reset logic.
- 범위: 교재 재고 탭의 과목/세부과목/학교/학년 4개만. 다른 탭·검색·미사용 교재·기존 reset 동작 유지. 현재 직접 필터/즉시 반영 규칙을 의도적으로 바꾸는 상호작용 카드임을 기록한다.
- 입력/출력: 적용된 filter값, 선택 options, onApply(nextFilters), onClose. 조회/서비스는 기존 workspace가 소유.
- 순서: <768px에서 검색 노출→필터N/주 action 행→trigger로 filter panel→현재값 draft 복사→선택→적용으로 한 번 전달→닫기/초기화→페이지1.
- desktop ≥768은 현재 직접 필터 유지. cancel은 draft 폐기, applied filter 불변. 적용 중에도 trigger/action 위치 유지.
- Given 과목 영어·학년고1 draft 후 Escape → 기존 전체 필터 유지; 적용 → 두 조건 표시/개수2/1페이지; 재개방 → applied값.
- 검증: `tests/textbook-filter-controls.test.mjs`, `tests/textbook-workspace.test.mjs`, 관련 filter-transition;390/768/1440, keyboard와 empty/error.
- 완료:390 기본 첫 재고 항목 y≤360px 목표, body overflow0; 기존5tab/검색/리셋 의미 유지.

## T10 — 학생 표의 이름·연락처·단위를 정리한다

- 수정: `src/features/management/management-data-table.tsx`의 학생 renderer, 기존 formatter가 있으면 재사용 또는 `src/lib/`의 좁은 표시 helper.
- 읽기만: 학생 service, 저장 모델, column preference code.
- 명세: master S02의 초기 열 폭·글꼴. 사용자 저장 너비 우선. 학교/학년/재원 상태를 불필요 pill로 만들지 않음.
- 표시 포맷: 유효11자리010 전화는 하이픈 표시; missing은 ‘—’; 국제번호/예외값은 원문. DB값 수정 없음.
- Given `01012345678` → 화면 `010-1234-5678`; Given 국제번호 → 원문; Given null → missing표시. clipboard/tel은 기존 정책 확인.
- 검증: 표 pagination/filter 기존 tests + 포맷 helper의 행동 case,1440/390·20행·긴 학교명.
- 완료: 학생명·학교·학년·연락처·상태 읽기 순서 명확, 열 설정 복구·정렬·선택 불변.

## T11 — 학생 상세의 정보/수업연결/이력을 정렬한다

- 수정: `src/features/management/management-page.tsx`의 학생 상세 view, `student-workspace.css`의 학생 상세 범위.
- 사용: 기존 FormDialog/DetailDialog 및 현재 sheet behavior. header/footer를 새로 중복 만들지 않음.
- 순서: 기존 state/callback 파악 → 표현 섹션만 필요시 추출 → 기본정보/수업연결/이력 순서 유지 → label/gap/너비/오류 정렬 → footer 상태확인.
- 수업연결·교재이력은 한 줄 전체 너비; 긴 수업명은 전체 줄바꿈과 행 자동 확장, action 뒤쪽 정렬. 기존 넓은 sheet를 공통 wrapper로 자동 치환하지 않는다. 불필요한 설명 카드 추가 없음.
- Given 변경 후 저장500 → 값 유지; 닫기/Escape → 기존 이탈 확인; 성공 → 반환된 값 반영/목록 복귀시 원래 query.
- 검증: `tests/management-student-detail-selects.test.mjs`, `tests/management-student-lifecycle-history.test.mjs`, `tests/guarded-navigation.test.mjs`와 최신 관련 draft tests.
- 완료:1440/390에서 header/footer 안정, error/focus 보임, 이력 폭 충분. 운영 실저장 검증은 별도.

## T12 — 수업 목록과 상세에 동일 기준을 적용한다

- 수정: management table/page의 수업 view, `src/features/management/class-workspace.css`의 스타일.
- 읽기만: class membership/create service, roster confirmation, schedule slot helpers.
- 순서: 목록 이름/슬롯 표시 정리 → 요일별 teacher/place 차이 유지 → 상세의 기존 정보/시간표/교재/학생 hierarchy 정렬.
- 수업 학생명 이동 전 현재 확인 dialog는 기존 test 계약이다. 제거가 필요하면 별도 행동 변경 카드로 분리한다.
- Given 월/수 다른 teacher → 두 슬롯 각각 표시; student roster에서 detail 이동 → 기존 confirmation과 초안 guard; back → 이전 수업/목록 필터 유지.
- 검증: `tests/management-class-student-roster.test.mjs`, `tests/management-numbered-pagination.test.mjs`, 관련 schedule/class UI 테스트.
- 완료: 원자적 생성/그룹 연결/폐강 조건 불변; 학생 기준과 같은 시각 규칙.

## T13 — 등록 목록의 트랙 대응을 유지하며 반복 배지를 줄인다

- 수정: `src/features/tasks/registration-case-list.tsx`; 필요시 순수 `registration-case-list-view.tsx` 새 파일.
- 읽기만: `registration-case-list-model.ts`, registration status/select/permissions.
- 순서: 단계별 실제 column 계약 목록화 → 단일 과목행 기준 이름/학교 plain text → subject를 트랙 anchor에 배치 → 각 열 subrow 순서/높이 동일 → shared surface/row token 적용.
- 다과목은 각 subject의 status/teacher/time 대응을 유지한다. 빈 cell 때문에 다음 track의 값이 위로 이동하지 않도록 placeholder 공간을 유지한다.
- Given3과목·담당3명·상태3개 → 각 과목과 올바른 값 대응; select 조작 → row 상세 동시 열림0; row Enter → 상세1회.
- 검증: `tests/registration-case-list-model.test.mjs`, 최신 status/observation 관련 test, keyboard/390/1440.
- 완료: 동일 과목을 무조건4회 배지로 반복하지 않음; 정리 전과 진행 변경 권한/선택지 같음.

## T14 — 등록 상세에서 현재 단계와 편집 위치를 유지한다

- 수정: `registration-application-shell.tsx`, `registration-application-progress-stepper.tsx`, 단계별 presentation section, `registration-save-button.tsx` 중 필요한 소수.
- 읽기만: `registration-application-model.ts`, track service, notification policy, shared-event guard.
- 순서: 현재 학생/과목/단계 header → stepper가 실제 section으로 이동 → heading focus/scroll margin → current action/footer의 정렬.
- 완료 단계 요약/접기는 기존 field state를 unmount/초기화하지 않는 경우에만 도입. 편집 중 section 자동 접기 금지.
- Given 다른 과목 전환+수정 초안 → 기존 guard; 입력 오류 → 해당 section 펼침+error에 도달; mobile keyboard → 저장 버튼 접근.
- 검증: `tests/registration-application-model.test.mjs`, `tests/registration-create-form-layout.test.mjs`, `tests/registration-track-workspace.test.mjs`, 최신 observation draft test.
- 완료: 주 행동1개가 분명하되 이전 단계 열기/수정 가능 조건을 손상하지 않음.

## T15 — 수업일정의 숫자와 다음 작업 표시를 명확히 한다

- 수정: `src/features/operations/class-schedule-workspace.tsx`의 표현, 필요한 순수 formatter.
- 읽기만: `continuous-class-schedule-model/service/contract`, curriculum 기존 status model.
- 순서: row fields의 정확한 원천 확인 → 분모0을 `계획 없음`으로 표시 → 중복 문구 동일 의미 조건에서 축소 → 정상은 중성 텍스트 → 실제 경고/action 명확화.
- 업무 상태 enum/정렬/필터/동기 그룹 계산 변경 없음.
- Given 관련 조회성공+현재 수업/기간 수락 plan0 actual0 →0% 제거/계획 없음; Given plan10 actual5 →실제 계약의5/10·50%; Given loading/missing/error/no-permission/no-period →0과 구별. 상태를 수치만으로 재판정하지 않음.
- 검증: 최신 class-schedule/continuous-class/curriculum tests 검색 후 실제 해당 파일 집중 실행; fixtures0/partial/error, rowlink/button keyboard 검사.
- 완료: 반복 숫자와 문장이 줄고 다음 작업이 눈에 들어옴. ‘기록 없음’을 ‘정상’으로 자동 판정하지 않음.

## T16 — 교재 수량·작업·피드백의 표현을 5탭에서 맞춘다

- 수정: `src/features/textbooks/textbook-operations-workspace.tsx`의 탭별 순수 표현 블록; 필요한 로컬 view 추출.
- 읽기만: textbook-service/ledger, return/stock-count transitions, draft guards.
- 단위: 재고 본관/별관/합계, 주문 주문/입고/남음, 출고 출고/반품, 실사 장부/실사/차이를 실제 필드에 대응.
- 순서: 첫 탭 재고→주문·입고→출고→실사→요청. 하나를 마칠 때마다 상태 fixture를 확인하고 다음으로 이동.
- 다음 유효 action만 primary. edit/return/delete 등의 기존 menu 접근은 보존.0재고 자체를 danger로 표시하지 않음.
- Given 부분 성공/실패 → 완료 행 보존·실패 행 재시도; Given 응답 유실 → 기존 idempotent retry; Given 실사 중 새 입력 → 이전 응답으로 draft 소실0.
- 검증: `tests/textbook-workspace.test.mjs`, `tests/textbook-filter-controls.test.mjs`, 실제 존재하는 sale/stock-count/busy/draft 관련 tests를 최신 목록 확인 후 실행.
- 완료:5탭 desktop/mobile, 상태별 수량/작업/결과 일치. 재고 계산/실제 mutation 증거는 UI 검수와 구분.

## T17 — 통계의 갱신을 안정화한다

- 수정: `src/features/dashboard/statistics-workspace.tsx`의 PanelState, 필요시 `use-statistics-snapshot.ts`의 표현용 상태 interface.
- 읽기만: statistics-cache/contract, auth key, query key logic.
- 순서: 최초 loading과 data+refresh 분리 → 동일 key accepted snapshot 표시 → 작은 busy feedback → 동일 key 오류는 이전값+시각+실패 → 다른 key/role이면 이전값 제거.
- 완료를 위한 상태 matrix: first load/first failure/success/refresh/refresh failure/query change/identity change.
- Given 영어 조회 후 수학 선택 → 영어 수치를 수학 라벨 아래 표시하지 않음. Given 동일 영어 refresh500 → 이전 영어값과 갱신 실패 표시.
- 검증: `tests/statistics-snapshot-cache.test.mjs`, `tests/statistics-workspace-interaction.test.mjs`, `tests/statistics-resource-pressure.test.mjs`.
- 완료: 갱신 때문에 content 전체가 사라지지 않고 query/auth 격리 유지.

## T18 — 통계의 숫자를 비교와 명단 탐색으로 연결한다

- 수정: statistics-workspace의 SummaryCards/StudentBreakdowns/ClassGroups/TextbookStatisticsPanel; 새 순수 distribution component 허용.
- 읽기만: metrics/statistics-contract/drilldown.
- 명세: master S07. 지표 단위 검증; 학교 내림차순·동률 가나다, 학년 교육 순서;0 baseline 수평 비교+텍스트값.
- 표시 대상은 서버가 현재 반환한 값. 새 trend/증가율 없음. 필요하면 기존 Recharts 사용, 라이브러리 추가 없음.
- Given0/동률/50학교/긴 라벨 →0 division 없음·키 보존·모두보기; 막대 Enter → 기존 명단 query 일치.
- 검증: `tests/statistics-workspace.test.mjs`, `tests/statistics-drilldown.test.mjs`, `tests/dashboard-metrics.test.mjs`; 순수 정렬/비율 helper case.
- 완료: 정확한 단위·척도·전체값으로 분포 비교 가능; 명단보기 기능 유지.

## T19 — 통계 탭과 필터의 URL 상태를 정의하고 보존한다

- 수정: statistics-workspace, 새 `src/features/dashboard/statistics-route-state.ts` 제안.
- 읽기만: `statistics-contract.ts`, `use-statistics-snapshot.ts`, 기존 navigation helpers.
- 계약: `tab=overview|students_classes|schedule_conflicts|textbooks`; `subject=all|english|math|science`; `division=all|middle|high`; range는 현재 탭의 presets만. 기본값 URL에서 생략.
- 교재/충돌에 학생 필터가 유입되지 않게 normalize. parser는 unknown/invalid값을 기본으로 정리. raw query string을 여러 component에서 합치지 않음.
- History 규칙: 사용자의 탭 전환 push; 같은 탭의 필터 조정 replace; 뒤로가기는 이전 탭 문맥. 제품 기존 규칙과 충돌하면 먼저 기록하고 하나를 고정.
- Given URL학생·수업/영어/고등부 → refresh/새 탭 동일; invalidrange → preset기본; back-forward → 일관. 동시에4탭 fetch 금지.
- 검증: 새 normalizer 행동 tests, `tests/statistics-snapshot-cache.test.mjs`, `tests/statistics-workspace-interaction.test.mjs`.
- 완료: 공유/복귀/reload 상태 보존, user/role cache boundary 불변.

## T20 — 남은 화면에 기준을 적용할 작은 카드를 만든다

- 대상: 학사일정, 시간표, 전반, 퇴원, 휴보강, 전자결재, 단어 재시험, 설정.
- 첫 산출: 경로별 실제 screenshot, 주요 행동1개, 복잡한 상태1개, shared component 적용 차이표.
- 그다음: 경로당 카드1개로 title/actions/filters/table/dialog token 정렬. 한 번에 모든 ops-task-workspace를 수정하지 않음.
- 캘린더에는 목록 pagination을 추가하지 않는다. 동일 기능의 오늘/이전/다음 날짜 제어 위치를 정렬.
- 상태가 변경되는 행위와 고객/provider 발송은 기존 경계를 유지한다.
- 완료: 각 경로에 별도 합격 증거가 있다. 안 본 화면을 일괄 ‘완료’로 표시하지 않는다.

## T21 — 새 탐색 기능은 계약부터 확정한다

- 상태: **후순위 설계 카드. UI 구현을 자동 시작하지 않는다.**
- A안: 대시보드 count → 해당 유형+오늘 등록 일정. 기존 registration route가 지원하는 query를 먼저 확인하고 parser/builder·예외·청강 capability를 고정한다.
- B안: 기존 ‘빠른 이동’ 버튼의 클릭 검색에 학생·수업 결과를 추가할 필요가 있는지 검토한다. 커스텀 단축키는 사용하지 않는다. 현재 메뉴 검색은 정상 기능이며 검색 범위 확장은 사용성 근거가 있을 때만 별도 설계한다.
- 필수 설계: 결과종류/id/표시이름/학교·학년 등 중복이름 문맥/href, 권한·tenant scope, limit, 최소 입력, IME composition, abort/stale, empty/error, 개인정보 로그 배제.
- 기본 추천: query2자 이상,250ms debounce,종류별5결과/전체15상한. 초성지원은 기존 검색계약과 index의 비용을 확인한 뒤 결정. 이 수치는 제안값이며 API ticket에서 확정.
- 계측: 직원5명의 학생찾기 동선·시간을 확인해 비용 대비 효과가 있을 때 구현 카드로 발행한다.
- 완료: 실제 existing route/RPC 사용 가능 여부와 독립 read API 필요 여부까지 문서화. 전수 학생 catalog를 header에 preload하는 설계는 제외.

## T22 — 통합 사용성·접근성·성능을 검증한다

- 수정: 재현 가능한 QA scripts/fixtures와 결과 문서. 발견된 제품 수정은 해당 카드로 귀속.
- 순서: 대표5업무 baseline/after 측정 → 모든 릴리스 경로1440/390 → 공통 shell1280/1024/768/320 → keyboard/zoom/dark/reduced → 지연/error/identity → 성능 cold/warm.
- 자동 검사만으로 접근성 전체 통과를 선언하지 않는다. touch는 실제 기기와 pointer simulation을 구분.
- 단위와 상태 사실: 성공toast/DB행/발송receipt를 서로 대체하지 않는다.
- 집계: 업무완료시간 중앙값, 잘못 누름/되돌아감 횟수, top critical task 성공률, 화면별 결함수. 5명은 초기 formative 검수이며 통계적 대표성을 주장하지 않음.
- 완료: P0/P1 결함0, 나머지는 영향/담당/처리시점 기록; master §4 목표 달성 여부와 미측정 구분.

## T23 — 검토 가능한 릴리스 패키지를 만든다

- 산출: diff 범위, 대표 before/after, focused 검사, type/lint/build, 위험/rollback, 미완료 목록.
- 실행: 현재 승인 범위에서 로컬 검토까지. 이 계획 요청만으로 push/merge/deploy하지 않는다.
- 스타일 rollback은 해당 commit revert가 가능하게 분리. DB migration 포함 여부를 명확히 기록.
- 향후 배포 승인 시: PR CI → main CI → sourceSHA → Vercel READY/alias → 로그인 운영 읽기 검수. 새 코드에서 바뀐 기능을 직접 확인.
- DB 변경 별도 카드가 있으면 최종 migration 정의·SQLSTATE·pgTAP·RLS/ACL/lock/idempotency와 no-send 확인을 추가.
- 완료: 사용자가 구체적인 변경과 검수 결과를 보고 배포 여부를 판단할 수 있다.

## T24 — 취소: 실제 출품 준비 제외

- 2026-09-15 사용자 정정: 어워즈는 목표 완성도를 표현한 것이며 실제 출품하지 않는다.
- 출품 요건 조사, 심사용 독립 데모, 소개 영상, 출품 사례집은 구현 대상에서 제외한다.
- 기존 번호 참조를 보존하기 위해 취소 기록만 남긴다. 후속 AI는 이 카드를 실행하지 않는다.
- 제품 검수에 필요한 합성 fixture, T22의 검증, T23의 릴리스 검토는 유지한다.

## 다음 AI에게 복사할 실행 프롬프트

```text
TIPS Dashboard의 프리미엄 품질 계획 중 [TNN] 한 카드만 구현하라.

먼저 최신 AGENTS.md, DESIGN.md, docs/design/2026-09-12-premium-dashboard-master-plan.md의 해당 절,
docs/design/2026-09-12-premium-dashboard-task-cards.md의 [TNN], 직전 카드 검수 기록을 읽어라.
기준 SHA/현재 worktree/미커밋 변경을 확인하고, 문서와 현재 소스가 다르면 차이를 먼저 적어라.

카드의 수정 허용 파일과 기존 공통 컴포넌트를 사용하라.
화면 위치·크기·상태는 명세대로 구현하라. 다른 디자인 방향을 탐색하거나 기능을 추가하지 마라.
state/service/RPC/권한/발송/DB는 명시된 범위 밖이면 수정하지 마라.
대형 workspace는 필요한 순수 view만 얕게 분리하고 기존 callback과 state owner를 유지하라.
기존 기능이 이미 요구를 충족하면 재구현하지 말고 검증 결과를 기록하라.

fixture의 Given/When/Then을 실행하고,1440/390 및 영향받은 경계에서 실제 화면을 확인하라.
관련 행동 테스트와 변경 파일 lint/typecheck를 실행하고 공통/릴리스 변경이면 필요한 build를 수행하라.
정규식으로 구현 문자열을 그대로 확인하는 새 테스트는 만들지 마라.
실제 운영 쓰기·고객 발송·push·merge·deploy는 별도 승인 없이 실행하지 마라.

완료 시 변경 동작, 실제 변경 파일, 검사 결과, 캡처, 미확인 영역,
후속 의존성이 충족됐는지를 docs/qa/premium-dashboard/[TNN].md에 남겨라.
검수 실패는 수정하고 재검증하되 카드 밖 작업을 조용히 확대하지 마라.
```

위 프롬프트의 `[TNN]`은 실제 카드ID로 바꾼다. 여러 카드를 병렬 실행할 때는 **수정 파일이 겹치지 않는 카드만** 지정하고, 공통 tokens/header/table은 한 명이 소유한다.
