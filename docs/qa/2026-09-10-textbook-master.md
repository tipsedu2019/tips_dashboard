# 교재관리 마스터 목록 정돈 검수

2026-09-10 · `codex/dashboard-apple-design-20260909` · 로컬 `127.0.0.1:3137/admin/textbooks`

## 변경 범위

- 교재관리 업무 탭을 중립적인 선택 표면으로 통일했다. 탭의 명칭·순서·집계는 유지하고 모바일에서는 3열로 배치한다. 방향키는 초점만 옮기며 Enter/Space로 업무를 활성화한다. 초기 조회 중에도 연결된 tabpanel이 존재한다.
- 마스터 검색·필터·목록·페이지 탐색에 공통 데이터테이블 프레임과 간격을 적용했다. 반복 표시 건수/선택 배지를 없애고 새로고침을 검색 옆에 배치했다.
- 재고 상태와 정리 상태를 직접 선택하도록 노출했다. 미사용 보관함도 정리 상태에서 선택한다. 기존 비우기·삭제 확인·전체 대상 재조회 계약은 유지한다. 분류 필터의 기존 순서와 종속 선택은 보존한다. 재고 탭이 공유하는 검색/필터 도구막대에도 직접 선택을 적용했다.
- 과목은 그룹 제목에서 한 번 표시하고 학교·학년·세부과목을 분류 열로 묶었다. 교재명·출판사·분류는 줄바꿈한다. 위치별 재고·합계·판매가·편집 기능을 유지한다.
- 모바일의 중첩 테두리·수량 카드 장식을 줄였다. 공통 선택 체크박스는 16px 시각 크기와 40×40px 클릭 영역을 사용한다. 선택 행과 일괄 작업 영역을 같은 프레임 안에 표시한다.
- 표 높이는 내용에 맞추되 viewport에 따른 최대 높이를 사용한다. 표의 고정 헤더와 페이지 탐색을 분리한다. 페이지·필터·행 수의 기존 controller/URL 계약은 변경하지 않았다.
- 초기 조회 실패를 빈 데이터와 구분하고 목록 안의 잘못된 신규 등록 유도를 제거했다. 상단 오류의 기존 재시도와 알 수 없는 건수 표시는 유지한다.
- 서버 순서에서 같은 과목이 다시 나올 수 있으므로 연속 그룹의 React key를 과목명이 아닌 첫 행의 고유 ID로 정했다. 서버 순서를 다시 정렬하지 않는다.

## 자동 검사

최종 소스의 다음 4개 파일에서 **175/175 통과**:

- `tests/textbook-workspace.test.mjs`
- `tests/textbook-numbered-renderers.test.mjs`
- `tests/textbook-numbered-pagination.test.mjs`
- `tests/textbook-reference-ui.test.mjs`

실제 React workspace와 실제 번호 페이지 controller/read service를 사용하는 harness다. 업무별 준비된 행·정확한 상세·페이지 10/15/20·URL 복원·선택·인증/역할 경계·늦은 응답·삭제 확인 및 전체 대상 집합·쓰기 수명 보존 검사를 유지했다. 이동한 UI를 찾는 테스트만 직접 Select 선택으로 변경했다. 새 검사는 탭 탐색 중 추가 조회 방지, 상태 선택의 페이지 초기화와 다른 조건 보존, 지연 중 초점, 초기 실패 표현, 반복 과목 그룹의 페이지 교체와 고유 행 ID를 검증한다.

최종 대상 ESLint, TypeScript no-emit, Next production build, `git diff --check` 통과. CI/배포 결과는 아니다.

## 실제 브라우저

제품 `TextbookOperationsWorkspace`, hook, controller, read service를 그대로 사용하고 Supabase 읽기 transport만 합성 fixture로 대체했다. 쓰기 transport는 연결하지 않았다. 기본 24개 교재 중 사용중 23개/미사용 1개, 긴 교재명, 3과목, 2재고 위치를 사용했다. 변경 전 기준은 이번 단계 시작의 HEAD 파일을 fixture 안에서 별도 컴포넌트로 렌더링했으며 제품 파일을 되돌리지 않았다.

- 1357×987: 같은 데이터/10행에서 교재명 버튼 폭 약 208px → 364px. 열은 11개 → 8개이며 표시 정보는 유지한다. 변경 전 페이지 가로폭 1362px, 변경 후 1342px로 viewport 이내다. 후자의 15px 차이는 세로 스크롤바다. 표 viewport는 635px이며 페이지 탐색은 표 바깥에 있다.
- 390×844: 문서 가로폭 375px로 가로 넘침이 없다. 필터는 2열이고 긴 이름은 생략 없이 줄바꿈한다. 로딩·실패·필터 결과 없음도 같은 너비에서 확인했다.
- 전체 선택 시 10개 선택과 10개 행 강조를 확인했다. 선택 해제로 작업 영역이 사라진다. 실제 수정/삭제는 실행하지 않았다.
- 2페이지에서 11–20번째/10행 표시, 20개씩 보기에서 1–20번째/20행과 1페이지 복귀를 확인했다. 영어 그룹 접기 시 해당 11행만 숨고 Enter로 다시 펼쳐졌다.
- 긴 이름의 교재 상세를 직접 조회해 교재 수정 창과 정확한 제목/학교/학년/출판사/판매가를 확인한 뒤 취소했다. 저장은 검증 범위가 아니다.
- 재고 없음 선택 → 0건/조건에 맞는 교재 없음 → 조건 초기화, 없는 교재명 검색 → 결과 없음 → 초기화를 확인했다. 지연 조회 중 재고 상태는 부족으로 유지되고 aria-busy=true, 초점은 재고 상태 선택에 남는다.
- 요청 탭에서 ArrowRight 후 초점은 주문·입고, 활성 탭은 요청으로 유지된다. Enter 활성화와 요청 화면의 tabpanel 연결도 확인했다.
- 과목이 여러 번 교차하는 추가 fixture에서 두 페이지의 데스크톱/모바일 행 ID를 대조했다. 두 번째 페이지는 111–120번 10개가 중복·누락 없이 동일 순서로 표시된다.
- 라이트/다크 표면을 확인했다. 이 단계에서는 새로운 이동 모션을 추가하지 않았으며 공통 포커스와 reduced-motion 규칙을 사용한다. OS reduced-motion 전환의 실제 측정은 수행하지 않았다.
- 최종 확인 구간(UTC 17:31:13.568 이후)의 추가 브라우저 오류 0개. 이전 구간의 반복 과목 key 오류는 이번 단계에서 수정했다. fixture HTML의 기존 smooth-scroll 속성 안내는 경고로 별도 기록했다.

## 보존과 한계

이번 단계는 교재관리의 업무 탐색과 마스터 목록이 대상이다. 요청·주문/입고·출고·실사·정산 전체 화면을 새로 설계한 결과가 아니다. 재고 공유 필터는 React 검사로 확인했으며 재고 업무 전체 브라우저 흐름은 이 fixture에 연결하지 않았다.

조회/저장 service, 데이터 모델, API, 인증·권한, DB migration, 알림, 출력 코드는 변경하지 않았다. 운영 DB 조회/수정, 고객 발송, 실제 재고 이동/정산/삭제, 운영 저장·배포 검증을 하지 않았다. 기존 수업계획/학생/수업/기간 제거의 누적 변경을 보존했고 이번 UI 단계로 재검증했다고 주장하지 않는다. 푸시·배포하지 않았다.

## 증거

`.codex-artifacts/textbook-master-20260910/`:

- `before-desktop.png`, `after-desktop.png`, `before-mobile.png`, `after-mobile.png`, `comparison.html`
- `desktop-selection.png`, `desktop-detail.png`, `requests-navigation.png`, `dark-desktop.png`
- `mobile-filter-empty.png`, `mobile-filter-transition.png`, `empty-search.png`
- `loading-desktop.png`, `loading-mobile.png`, `error-desktop.png`, `error-mobile.png`
- `interleaved-check.json`, `browser-checks.json`, `browser-logs.json`
- `tests.log`, `group-test.log`, `typecheck.log`, `eslint.log`, `build.log`

기준은 저장소 DESIGN.md 및 기존 학생관리/공통 표 규칙이다. 새 디자인 방향이나 별도 디자인 시스템을 도입하지 않았다.
