# 수업계획 목록 정돈 검수

2026-09-10 · `codex/dashboard-apple-design-20260909` · 로컬 `127.0.0.1:3137/admin/curriculum`

## 변경

- 검색·직접 필터·작업 분류·목록·페이지 탐색을 공통 데이터테이블 프레임으로 통합했다. 반복 요약, 별도 목록 제목/합계, 모바일 보기 팝오버를 제거했다.
- 작업 분류 5개와 서버의 분류별 건수를 한 번만 표시한다. 분류 조건은 서로 겹칠 수 있어 `aria-pressed` 필터 버튼 그룹으로 유지한다.
- 수업명을 먼저, 과목·학년·담당자를 보조 정보로 배치한다. 상태 배지는 하나만 두고 완료 상태는 중립색으로 낮췄다. 수업명·교재명·담당자·다음 작업 사유는 줄바꿈한다. 없는 영역의 '영역 미정' 표시는 없앴다.
- 진도는 기존 교재 대상 회차 분모와 배정 회차를 그대로 사용한다. 중복 퍼센트/배정 합계를 줄이고 다음 작업 사유와 링크를 유지했다. 공통 Progress가 실제 값을 Radix에 전달하도록 고쳐 시각적 비율과 접근성 값이 일치한다. 범위를 벗어난 값, 사용자 지정 최대값, 미확정 값도 검증했다.
- 표는 내용 높이에 맞추고 최대608px에서 내부 스크롤한다. 헤더는 고정하고 페이지 탐색은 스크롤 밖에 둔다. 새 페이지가 수락되면 첫 행부터 보이며 로딩·실패 동안에는 기존 위치를 유지한다. 상세 복귀용 필터/페이지 URL·스크롤 저장은 보존한다.
- 행 안 링크의 키보드 이벤트가 행 이동을 중복 호출하거나 기본 링크 동작을 취소하지 않도록 했다. 데스크톱 행은 표의 row 의미를 유지한다.
- 데이터 없음과 검색 결과 없음을 구분하고 수업 관리 또는 모든 수강 수업 보기로 연결한다. 초기 조회 실패는 빈 목록으로 표시하지 않으며, 내부 예외 대신 재시도 안내를 표시한다. 실패 시 필터 선택을 보존하고 모르는 건수는 대시로 표시한다.

## 자동 검사

최종 소스에서 다음4개 파일의 **102/102 검사 통과**:

- `tests/curriculum-filter-panel.test.mjs`
- `tests/academic-operations-numbered-pagination.test.mjs`
- `tests/data-table-surface.test.mjs`
- `tests/lesson-design-page.test.mjs`

실제 React workspace + 실제 scoped read service/controller 경로에서 기존 페이지·필터·URL·뒤로 가기·인증 역할 경계·지연 응답을 검증한다. 추가 검사는 행/중첩 링크 키보드, 대상 회차 분모, 상세 복귀 URL와 스크롤 저장, 분류 전환 중 포커스/실패/재시도, 초기 오류와 빈 상태 구분, Progress 값의 의미를 다룬다. 기존 화면의 제거된 표현만 source assertion에서 갱신했다.

최종 대상 ESLint, TypeScript no-emit, Next production build, `git diff --check` 통과. 이 결과는 CI 또는 배포 검증이 아니다.

## 실제 브라우저

제품 `AcademicCurriculumWorkspace`를 사용하고 조회 hook만 로컬 합성 fixture로 대체했다. 기본3개 수업 및 장문 수업명·교재명·공동 담당자를 가진24개 수업으로 검수했다.

- 1357×987: 기본3행의 표 높이340px. 이전 고정608px 공간을 제거해 페이지 탐색이 목록 바로 아래 보인다.
- 390×844: 분류5개를 팝오버 없이2줄로 표시한다. 기본/장문 카드에 페이지 가로 넘침이 없다. 기본 문서 폭375px는 브라우저 세로 스크롤바를 제외한 폭이며 viewport390px 이내다.
- 장문24개: 데스크톱10행의 콘텐츠1231px/표 viewport608px, 텍스트 가로 넘침0건. 표를588px 스크롤해도 viewport와 헤더의 화면 시작점이270px로 일치하며 페이지 탐색은 밖에 유지된다.
- 20개씩 보기: 1페이지로 복귀하고20행 표시, 표 스크롤0, 포커스는 페이지당 행 수 선택에 복귀한다. 스크롤 후 다음 페이지 이동 시21번째 수업부터4행이 표시되고 표 스크롤0으로 시작한다.
- 모바일 진도 미배정 클릭→1개 수업과 `view=update`; 계획 완료를 Enter로 선택→1개와 `view=done`, 선택 버튼 포커스 유지; 초기화→3개와 기본 URL로 복귀를 확인했다.
- 검색 결과 없음→모든 수강 수업 보기로 복귀, 초기 빈 상태의 수업 관리 링크, 로딩/오류 화면의 데스크톱·모바일 배치, 오류 URL의 과목·수강 선택값 보존, 모바일 다크 테마를 확인했다.
- 최종 진입 구간(UTC16:47:28.889 이후) 브라우저 오류0개. 수정 중 useEffect dependency 개수가 바뀐 HMR 경고1건은 최종 새 진입에서 재현되지 않았다.

공통 Progress는 transform만200ms 전환하고 reduced-motion에서는 전환하지 않는다. 분류/행은 기존 포커스 표시 및 reduced-motion 전환 제거를 따른다. OS reduced-motion 설정을 이번 단계에서 실제 전환해 측정하지는 않았다.

## 보존과 검증 한계

이 단계에서 조회/저장 service, 도메인 모델, API, 인증·권한, DB migration 및 출력 코드는 변경하지 않았다. 공통 Progress 수정은 이를 사용하는 승인 화면에도 적용되며 컴포넌트 값/표시 테스트로 검증했다. 승인 업무 전체 브라우저 흐름은 이번 범위에 포함하지 않았다.

합성 fixture는 수업 설계 상세 편집기를 연결하지 않는다. 상세 목적지·section·session·returnTo 및 키보드 경계는 실제 서비스/React 테스트와 렌더링된 링크로 확인했다. 실제 상세 편집→저장→복귀 전체 흐름의 브라우저 완료를 주장하지 않는다. fixture의 재시도는 무해한 mock이며 실패→재시도→정상 응답 회복은 실제 controller 테스트에서 검증했다. 운영 데이터 조회/수정, 고객 발송, 운영 DB 적용, 푸시·배포는 하지 않았다.

## 증거

`.codex-artifacts/curriculum-workspace-20260910/`:

- `before-desktop.png`, `after-desktop.png`, `after-mobile.png`
- `long-desktop.png`, `long-desktop-scrolled.png`, `long-desktop-last-page.png`, `long-mobile.png`
- `empty-filtered.png`, `empty-mobile.png`, `error-desktop.png`, `error-mobile.png`, `loading-desktop.png`, `loading-mobile.png`, `dark-mobile.png`
- `browser-checks.json`, `browser-logs.json`, `tests.log`, `typecheck.log`, `eslint.log`, `build.log`

판단 기준은 저장소 DESIGN.md와 공통 표 계약을 우선하고, 키보드·포커스·비동기 상태는 [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md)를2026-09-10에 재확인했다. 새 시각 방향이나 별도 디자인 시스템을 추가하지 않았다.
