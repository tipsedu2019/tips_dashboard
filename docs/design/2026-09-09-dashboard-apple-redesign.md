# TIPS Dashboard Apple 계열 리디자인 · 대표 화면 구현

## 목표·진행 상태

TIPS의 학원 운영 기능을 유지하면서 업무 구조, 탐색, 목록·상세·편집, 상태 표현을 하나의 기준으로 정리한다. 사용자가 표시 순서 3번(넓은 표와 편집 시트)을 선택했다. 대표 화면 구현 후 학생정보 관계·이력 너비 보완과 재사용 가능한 공통 데이터테이블 재설계를 요청해, 관리 목록과 설정의 공통 표까지 확장했다.

- 조사일: 2026-09-09, Asia/Seoul.
- 기준 main: 5052ef069f692317ca8fdd64dc0011b60ffeb3fb. GitHub API와 origin/main 일치 확인.
- 별도 브랜치: codex/dashboard-apple-design-20260909.
- 기존 checkout, 운영 데이터, 설정, 발송·배포 상태를 변경하지 않았다.
- 저장소 AGENTS.md, DESIGN.md, tips-quality 스킬을 읽고 기존 Pretendard/한글 폴백, semantic CSS 변수, Lucide와 공통 UI 구조를 확인했다.

| 단계 | 완료 기준 | 상태 |
| --- | --- | --- |
| 1. 기준 확보·시안 | 현재 화면·필드·행동, 기능 보존 계약, 공식 자료·버전, 같은 업무의 독립 시안 3개 | 완료 |
| 2. 방향 선택 | 사용자가 표시된 시안 중 선택 | 완료: 3번 |
| 3. 대표 흐름 | 학생 검색→선택→수정→저장→재진입과 실제 인터랙션·모션 검수 | 구현·로컬 검수 완료. 후속 사용자 요청에 따라 확장 진행 |
| 4. UI 확장 | 공통 기준을 등록, 수업·일정, 교재, 설정에 적용하고 모듈별 보존 검사 | 관리 3종 목록·설정 공통 표, 학생·수업 상세/등록 완료. 등록 업무·전용 일정·교재 운영 화면은 미적용 |
| 5. 검증·인계 | 기능 테스트, 브라우저, 시각·모션, 출력·내보내기 결과를 각각 보고 | 공통 표와 학생·수업 상세 범위 로컬 검수 완료. 출력·운영 환경 검증은 해당 변경 범위에 포함되지 않음 |

1단계 완료는 리디자인 구현 완료를 뜻하지 않는다. 선택 이후 단계는 새로운 목표로 이어서 관리한다. 푸시·병합·배포는 별도 사용자 요청 때 진행한다.

## 업무 구조 제안

| 표시 묶음 | 보존할 기존 업무 |
| --- | --- |
| 학생 | 학생관리, 등록, 전반, 퇴원 |
| 수업·일정 | 수업관리, 수업계획, 시간표, 학사일정, 학교 연간 일정표, 휴보강 |
| 교재관리 | 마스터, 요청, 주문·입고, 출고, 재고, 정산 |
| 독립 진입 | 대시보드, 통계, 전자결재, 영어 단어 재시험 |
| 환경 설정 | 학교, 과목, 선생님, 강의실, 기간, 교재, 알림 |

이는 메뉴 표시 묶음 제안이며 API·권한·데이터 모델 통합이 아니다. 기존 경로·딥링크를 보존한다. 폐지한 할 일·재시험 알림이나 새 작업함·리마인더를 만들지 않는다.

## 같은 업무로 비교하는 세 시안

현재 학생관리의 필드와 조작을 바탕으로 ‘김학생의 기본 정보 수정’을 세 방향 모두에 사용했다. 실제 인적 정보 대신 가상 이름·학교·번호를 사용했다. 표시 순서는 이미지가 채팅에 나타난 순서로 확정했다.

| 표시 순서 | 구조 | 이미지 파일 |
| --- | --- | --- |
| 1 | 표와 오른쪽 정보 편집 패널 | option-1.png |
| 2 | 학생 목록과 넓은 편집 영역 | option-2.png |
| 3 | 넓은 표와 편집 시트 | option-3.png |

동일 필드: 학생명, 재원 상태, 메이크에듀 원생고유번호, 학교 구분, 학교, 학년, 학생 연락처, 학부모 연락처, 등록일. 동일 대상: 김학생, 제주중, 중2, 재원, S-001, 등록일 2026-09-01. 연락처는 010-0000-0000 예시다. 세 이미지 모두 저장·취소의 명시적 편집 상태다.

이미지는 정보 배치 선택을 위한 정적 시안이다. 선택/벌크 체크의 분리, 숫자·문구·필터 의미, 키보드, 모바일, 저장·복구, 모션은 구현 때 실제 컴포넌트로 검증한다. 특히 2번 검색창에 원본 캡처의 ‘디자인 시안 기준’ 문구가 남아 있어 제품 반영 때 ‘학생 검색’으로 바로잡아야 한다. 그림 속 검색 결과는 실제 API 결과가 아니다.

## 화면 규칙

- 검색·필터·목록·선택·현재 행동의 위치와 의미를 통일한다. 편집 영역의 주 행동은 저장, 취소는 인접 배치한다.
- 표는 하나의 데이터 표면으로 읽히게 하고, 행마다 카드·그림자·강한 테두리를 반복하지 않는다.
- 필수 필드를 단계를 늘리거나 접는 방식으로 숨기지 않는다. 기본 정보·학교·연락처는 간격과 정렬로 구분한다.
- 기존 자동 저장/명시적 저장 계약을 스타일 때문에 바꾸지 않는다. 입력 변경·저장 중·저장 결과를 구별한다.
- 본문은 불투명하게 유지하고 반투명 효과는 탐색·도구 영역에 한정한다.
- 관리 목록의 10/15/20행, 번호 페이지 10개 묶음, 첫·이전·다음·마지막, 전체 건수와 행 범위, 필터/URL 복원을 보존한다.
- 모바일은 탐색→목록→상세의 순차 화면으로 변형할 수 있으나 선택·조건·미저장 입력을 보존한다.

## 공식 레퍼런스

다음 자료를 2026-09-09 확인했다. 문서에 없는 앱 빌드번호·업데이트일은 추정하지 않았다.

| 출처 | 확인한 버전·내용 | 용도 |
| --- | --- | --- |
| [Apple Design Resources](https://developer.apple.com/design/resources/) | 현재 macOS 27 UI Kit 표시, 공식 미리보기 확보 | 최신 자료의 세대 기록. 아래 macOS 26 앱과 동일 버전으로 취급하지 않음 |
| [Numbers User Guide](https://support.apple.com/guide/numbers/welcome/mac) | Numbers 15.3, Format 패널 공식 이미지 | 본문과 상황별 편집 패널의 구분 |
| [Mail User Guide](https://support.apple.com/guide/mail/welcome/mac) | macOS Tahoe 26, Primary 목록과 본문 공식 이미지 | 선택 항목 유지, 목록과 넓은 내용 영역 |
| [Finder sidebar](https://support.apple.com/guide/mac-help/customize-the-finder-sidebar-on-mac-mchl83c9e8b8/mac) | macOS Tahoe 26 가이드 | 낮은 깊이와 접을 수 있는 탐색 |
| [Calendar User Guide](https://support.apple.com/guide/calendar/welcome/mac) | macOS Tahoe 26 가이드 | 기간·선택 정보 배치. 할 일 기능은 도입하지 않음 |
| [HIG Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars), [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables), [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars), [Panels](https://developer.apple.com/design/human-interface-guidelines/panels) | 현재 웹 문서 | 탐색·목록·선택·상황별 조작 관계 |
| [HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | 변경 이력 2025-09-09 | Glass를 조작/탐색 계층에 제한 |
| [Typography](https://developer.apple.com/design/human-interface-guidelines/typography), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Typography 2025-12-16, Motion 2025-09-09 변경 이력 | 가독성·상태 식별·reduced motion |

Apple 생산성 앱의 구조를 웹 업무에 맞춰 해석한다. Apple 로고·OS 창 제어·차트·메일·사진·문서 캔버스를 TIPS 기능으로 복제하지 않는다. 기존 글꼴·아이콘을 기반으로 하고 Apple 전용 자산을 무조건 배포 패키지에 추가하지 않는다.

## 시각·모션 시작값

다음 숫자는 Apple 공식 수치가 아닌 **TIPS 제안값**이다. Apple의 실제 모션을 측정한 결과가 아니다. 선택된 시안의 구현에서 비교·조정한다.

| 요소 | 제안 |
| --- | --- |
| 글자·간격 | 본문 15–16px, 보조 12–13px, 제목 22–24px. 기존 4px 기반에 그룹 16/24px |
| hover·pressed | 100–120ms, 이동 0px, 색/명도 중심 |
| focus | 즉시 보이는 ring, 애니메이션 뒤로 지연하지 않음 |
| 선택 | 즉시 상태 확정, 색 전환 최대 120ms, 레이아웃 이동 없음 |
| 패널·시트 | 진입 180ms/최대 8px, 종료 120ms/최대 4px, cubic-bezier(0.2, 0, 0, 1) 시작값 |
| 로딩·결과 | 작업 이름과 배치 유지, 결과는 실제 반환·재조회 근거, 오류 시 입력 유지 |
| reduced motion | 이동·확대·스프링 없음. 즉시 전환 또는 최대 80ms opacity |

빠른 연속 조작·키보드·메뉴 재개방·응답 역전·중복 저장을 검사한다. 정적 이미지로 모션·접근성 구현 완료를 판정하지 않는다.

## 보존 계약과 검사 위치

| 영역 | 반드시 유지 | 대표 근거·검사 |
| --- | --- | --- |
| 학생·수업 | 기본정보, 재원/퇴원, 수강·대기 명단과 이력, 학생↔수업 왕복/returnTo. 퇴원은 기존 업무로 전달. 예상 이전 상태를 쓰는 원자 roster RPC | management-page.tsx, management-service.js; management-class-student-roster.test.mjs, management-student-lifecycle-history.test.mjs, management-numbered-pagination.test.mjs |
| 등록 | 과목별 사실·진행상태·명단·알림의 독립 경계. workflowRevision/충돌 초안 복구. 체크리스트는 수동 사실. 입학 알림톡 미리보기→확인→발송 | registration-track-editor.tsx, registration-enrollment-editor.tsx, registration-track-service.ts; registration-track-workspace.test.mjs, registration-subject-completion-dispatch.test.mjs, probe-registration-management-recovery-concurrency.mjs |
| 교재 | 6개 업무, 출고/반품·실사 원자 RPC, request ID 재시도, stale 선택/actor 검사, 역할 변경 시 진행 중 조회·복사 중단 | textbook-operations-workspace.tsx, textbook-service.ts; textbook-sale-transition.test.mjs, textbook-stock-count.test.mjs, textbook-numbered-renderers.test.mjs, 관련 concurrency probes |
| 교재 출력 | 주문·반품 전달문 전체/개별 복사와 PNG/PDF 다운로드, 정산 전체 상세 복사. 동일 fixture로 전후 비교 | textbook-handoff-model.ts 및 위 교재 renderer 검사 |
| 수업계획·일정 | URL·스크롤 복원, 수업/회차/기간/강사/강의실/휴강/보강, 공개·교사용 메모. 오래된 응답의 초안 덮어쓰기 방지. 캐시 갱신 pending 영수증 | class-schedule-workspace.tsx, use-operations-workspace-data.ts; class-schedule-release2-content-save.test.mjs, class-schedule-release2-generation.test.mjs, public-classes-cache-mutation-boundaries.test.mjs |
| 인증·역할 | 서버/클라이언트/RLS 경계, 권한 확인 전 보호 화면 마운트 금지, 같은 사용자의 토큰 갱신 때 초안·포커스·선택 보존 | auth-utils.ts, auth-guard.tsx, navigation.ts; auth-guard-loading.test.mjs, auth-session-refresh.test.mjs |

상세 코드는 src/features/ 아래 해당 feature, 검사는 tests/ 아래 위치한다. 학생·수업·수업계획에서 별도 내보내기 UI를 발견하지 못했으며, English Studio의 PDF/DOCX 기능을 대시보드 기능으로 임의 추가하지 않는다.

관리자/직원은 전체 관리, 교사는 수업계획·교재 요청 중심, 조교는 재시험·일정·시간표 중심의 기존 접근을 유지한다. 실제 행위별 권한은 최종 코드와 API/RLS를 기준으로 검증하고 화면 노출만으로 보안 완료를 판단하지 않는다.

최신 운영 정책은 docs/qa/2026-09-09-operations-automation-simplification.md 기준이다. 할 일·단어 재시험 알림은 폐지 상태를 유지하고, 등록·전반·퇴원 과목팀 알림 및 입학 알림톡의 기존 경로를 유지한다. 오래된 문서·검사에서 할 일 메뉴를 요구하더라도 복원 근거로 사용하지 않는다.

주의: 독립 조사에서 tests/admin-shell.test.mjs의 과거 todo navigation 기대치가 최신 메뉴 제거와 다를 가능성이 발견됐다. 테스트를 실행해 재현한 결과가 아니므로 구현 단계에서 최신 기준으로 확인한다.

## 기준 자료·검증 한계

이미지와 프롬프트는 .codex-artifacts/apple-design-phase1/에 로컬 보관한다. 운영 학생 목록의 private 원본은 이미지 생성에 전달하지 않았고 Git에 포함하지 않는다. 생성에는 개인정보 없는 실제 빈 검색 화면/입력 폼, 공식 Apple 이미지, 저장소 TIPS 로고만 전달했다.

현재 브라우저의 데스크톱 화면, 빈 검색 상태, 학생 입력 폼의 필드와 저장·취소, 취소 후 목록 복귀를 확인했다. 실제 저장/수량/정산/메시지 발송은 실행하지 않았다. 기능 보존 계약은 코드 조사 결과이며 회귀 테스트를 실행했다는 뜻이 아니다.

Browser viewport 도구에 390×844를 요청했으나 DOM은 1690×876으로 유지되어 모바일 증거로 채택하지 않았다. 도구 크기 요청은 원복했다. 이는 브라우저 제어 제한이며 앱 반응형 결함으로 판정하지 않는다. 실제 390px 검증은 구현 단계에 남아 있다. 이미지 생성의 요청 목표는 1440×1024이며 실제 생성 파일 크기는 출력 manifest에 기록한다.

## 도구·모델

Product Design get-context/ideate, 기본 image_gen, 기존 Browser/CUA, Git/GitHub 읽기와 저장소 도구를 사용했다. 필요한 기능은 이미 있어 새 플러그인은 설치하지 않았다. 기능 보존 계약과 공식 Apple 자료는 각각 gpt-5.6-sol / high 서브에이전트가 조사했고 주 에이전트가 소스·화면과 대조했다. 주 에이전트 설정을 도구로 변경하지는 않았다.

선택 후 대표 흐름을 구현하고 기능 테스트, 실제 브라우저, 시각·모션, 출력/내보내기 비교를 각각 보고한다.

## 3단계 결과 · 학생관리 대표 화면

- 기존 큰 구조를 유지하며 표·도구·입력 필드·상세 시트의 크기, 간격, 테두리와 행동 위계를 통일했다. 학적 기본 정보, 학교, 연락처를 정렬과 간격으로 묶었다.
- 상세 8필드 / 신규 등록 9필드, 수강·대기·이력의 연속 접근, 기존 저장·권한·퇴원 경로를 보존했다. 상세에서 등록일 편집을 임의 추가하지 않았다.
- 로컬 검수: http://127.0.0.1:3137/admin/students?studentId=student-001
- 비교 자료: http://127.0.0.1:3138/compare.html
- 실제 UI 컴포넌트에 합성 서비스만 연결한 격리 fixture다. 외부 인증·DB·알림 transport는 차단했다.
- 학생 검색, 수정·실패 후 입력 유지·재시도·목록 반영·재진입, 지연 저장 더블클릭의 단일 요청, 키보드 포커스 복귀를 확인했다.
- 1487×1058/DPR1 전체 및 필드 1:1 비교, 실제 390×844 및 320×720 모바일, 다크 모드, 빈 목록·로딩·오류·읽기 전용을 확인했다. 1단계의 모바일 제어 한계는 이 실제 DOM 크기 확인으로 해소했다.
- 일반 시트 180ms/8px, 메뉴120ms. Chrome Rendering의 실제 reduced-motion 설정에서 시트 animation none/0s 및 Escape·포커스 복귀를 확인했다. 메뉴의 reduced CSS 활성은 확인했으나 해당 상태 메뉴 Computed 값은 도구 시간 초과로 미확인이다. Apple의 실제 프레임 타이밍을 측정했다는 뜻은 아니다.
- 기존 대상 회귀 검사136개 통과, TypeScript·ESLint·Next production build 통과. 후속 CSS와 포커스 보완은 대상 검사 및 브라우저로 재검증했다.
- 시각 판정과 정확한 증거/한계: 루트 `design-qa.md`.

위 내용은 3단계 당시의 검수 결과다. 이후 사용자가 요청한 공통 표 확장 결과는 다음과 같다.

## 4단계 후속 결과 · 관계 너비와 공통 표

- 학생정보 최대 폭을 650px에서 920px로 확대했다. 수강·대기와 수업·교재 이력을 각각 전체 폭으로 배치하고 긴 제목·부가 정보·선택된 수업명을 줄바꿈한다. 모바일은 행동 버튼을 제목 아래에 배치한다.
- 공통 toolbar/viewport/header/row/cell/sort 및 pager 스타일을 `src/components/data-table/data-table-surface.tsx`로 추출했다. 사용법과 적용 경계는 같은 디렉터리의 README에 있다.
- 학생·수업·교재 ManagementDataTable에 하나의 외곽 틀, 44px 헤더, 최소 48px 행, 12px 좌우 간격과 긴 제목 줄바꿈을 적용했다. 선택·정렬·필터·열 설정·10/15/20행과 번호 탐색은 기존 상태/서비스를 유지한다.
- 학교·강사·강의실·수업그룹·기간·강사 Chat 계정·교재 공급처의 기존 SettingsTableFrame과 관련 공통 도구 막대가 같은 토큰을 사용한다. 과목 설정은 공통 도구 막대만 적용한다. 전용 달력·시간표·교재 운영 행렬과 출력 레이아웃은 별도다.
- 실제 브라우저: 1487×1058 및 1082×987 데스크톱, 390×844 모바일, 긴 관계·이력·교재명, 검색·정렬·페이지 이동·열 크기·그룹 펼치기·고정 열·설정 입력·다크 테마를 확인했다.
- 관련 검사 167개 통과(표99 + 관계/설정68), 제품 TypeScript/ESLint/Next production build 통과. 독립 검토에서 P1/P2 미발견. 중복 실행한 63개 리뷰 검사는 총계에 더하지 않았다.
- 현재 검수: http://127.0.0.1:3137/admin/students 및 http://127.0.0.1:3137/admin/table-preview?kind=classes . 합성 데이터 검수 환경이며 운영 DB·실제 전송 검증이 아니다.
- 이번 요청 범위는 구현·검수 완료. 배포·푸시는 수행하지 않았다. 전체 리디자인의 나머지 전용 업무 화면까지 완료했다는 뜻은 아니다.

## 후속 요청 · 표 설정 정돈

그룹화·정렬·컬럼 구성 패널을 공통 DataTableSettings로 분리해 학생·수업·교재에 적용했다. 넓어진 패널, 일관된 행 배치와 얇은 구분선, 전체 설정 복원·완료 고정 footer, 화면 높이에 맞춘 내부 스크롤을 사용한다. 기존 설정은 즉시 적용·저장하며 완료는 패널 닫기만 수행한다.

그룹2개/정렬2개, 컬럼 표시·순서·너비·검색·초기화 계약을 유지했다. 실제 새로고침 후 설정 유지와 키보드 focus,390px 모바일, 다크 테마, 수업 toolbar 접근을 검수했다. 대상82개 검사·TypeScript·ESLint·production build 통과, 독립 검토 새 P1/P2 없음. 자세한 증거와 마지막 CSS 검증 범위는 루트 design-qa.md의5단계 기록에 있다. 배포는 하지 않았다.


## 후속 요청 · 네 가지 UI 정돈 완료

학생 행의 퇴원 처리를 더보기 메뉴로 정리하고, 학생정보 기본 필드는 자연스러운 DOM 순서로 3/2/1열 반응형을 적용했다. 학생·수업·교재 검색/필터/등록/표 설정 위치를 통일하고 학교 필터 폭을 줄였다. 공통 선택 체크박스는16px 표시/40px 클릭 영역을 사용하며 학생의 일반 재원·수강 상태 강조를 낮췄다.

상세8필드·등록9필드, 권한, 퇴원 신청 경로, URL·선택 상태·저장된 표 설정을 보존했다. 관련141개 검사·제품 TypeScript·ESLint·production build 통과, 데스크톱/중간 폭/390px 모바일과 다크 테마를 실제 로컬 브라우저로 검수했다. 마지막 메뉴 CSS와 퇴원 fixture 경로 제한을 포함한 정확한 검사 범위는 `design-qa.md` 6단계에 기록했다. 별도 작업 브랜치에 반영했으며 푸시·배포는 하지 않았다.

## 후속 확장 · 수업정보 상세·등록 완료

수업 기본 정보·시간표 입력을 학생관리의 공통 높이와 간격으로 맞추고, 모든 화면 크기에서 같은 고정 하단 닫기·저장 영역을 사용한다. 기본 시간표 저장은 기존 별도 계약을 유지한다. 긴 제목과 연결 교재명을 줄바꿈하고, 수강·대기 명단의 열과 모바일 배치를 맞췄다. 긴 헤더 아래 명단 이동과 닫기 후 행 포커스 복귀도 보완했다.

관련153개 검사·제품 TypeScript·ESLint·최종 production build가 통과했다. 동일 합성 데이터의 데스크톱/390px 변경 전후 비교,790px 중간 폭, 다크 모드, 키보드 시간 선택, 저장 실패 후 재시도·재진입, 수업 등록과 읽기 전용을 실제 브라우저에서 확인했다. 기존 테마 초기화의 fixture hydration 경고와 reduced-motion 실측 제한을 포함한 정확한 결과는 `design-qa.md` 7단계에 기록했다.

검수 주소: http://127.0.0.1:3137/admin/classes?classId=class-en-2-a&tab=basic . 운영 DB·권한/RLS·실제 수강 변경·전송의 종단간 검증을 뜻하지 않는다. API·서비스·데이터·출력 코드를 변경하거나 배포하지 않았다.

## 후속 요청 · 수업 기간 제거 완료

2026-09-10 사용자 요청으로 7월28일 연속 운영 수업 설계의 보류 항목을 진행했다. 수업관리·수업계획 필터, 수업 정보·등록, 환경 설정에서 기간 입력·기본 기간 의미를 제거했다. 과거 학기와 독립 그룹·시간표 기능을 유지하며, 신규 수업은 그룹 없이 등록할 수 있다.

이 후속 단계는 앞선 UI 보존 범위에 대한 명시적 변경이며, 수업 생성 조건과 수업계획 기본 조회를 수정하는 migration 2개를 준비했다. 격리 DB 및 로컬 브라우저 검수를 완료했으며 운영 DB 적용·푸시·배포는 하지 않았다. 근거와 검증 경계는 [기간 제거 검수 기록](../qa/2026-09-10-class-period-removal.md)을 따른다.
