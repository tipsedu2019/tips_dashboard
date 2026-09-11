# TIPS Dashboard 이동·초안·역할 UI 후속 검증

2026-09-11. `codex/dashboard-apple-design-20260909` 작업 폴더의 후속 코드 수정과 로컬 검증 기록이다. 이전 전역 보고서의 남은 항목 중 관리 화면 이동, 저장 중 새 초안, 역할별 클라이언트 UI, Docker 차단 검사를 보강했다. 전역 업무·실인증·배포 완료를 뜻하지 않는다.

작업 폴더: `/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/dashboard-apple-design-20260909`.
증거 폴더: `/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa`.

## 전역 분모와 이번 적용 범위

전역 분모는 **67개 page**로 유지한다. [전수표 원본](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/qa/coverage.json)의 실제 page·인벤토리 행이 각각 67개이며, 누락·중복·잘못된 route 매핑은 0개다.

| 구분 | page 수 | 이번 후속 검증의 의미 |
| --- | ---: | --- |
| 운영 | 25 | 5역할의 클라이언트 직접 진입·메뉴·허용 콘텐츠 마운트 125개 조합 확인 |
| 인증 | 4 | 기존 렌더 근거 유지. 실제 로그인·복구는 이번에 추가 검증하지 않음 |
| 오류 | 5 | 기존 렌더 근거 유지. 실제 장애 유발·복구 연동은 별도 |
| 공개 | 4 | 기존 렌더 근거 유지. 실제 공개 API·콘텐츠 검증은 별도 |
| page redirect | 29 | 기존 목적지 근거 유지. 실제 역할별 인증 세션 이동은 별도 |
| 합계 | 67 | 역할 조합·테스트 개수는 page 분모에 더하지 않음 |

38개 렌더 page와 29개 page redirect의 전역 목록은 [coverage.md](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/qa/coverage.md)를 따른다. page가 없는 `/login`, `/register`, `/home` 설정 경로는 그 목록에서 별도로 추적한다. 이번 관리 이동 구현을 모든 업무 모달의 미저장 보호 완료로 확대하지 않는다.

## 관리 화면 이동과 저장 중 초안

공통 [use-unsaved-navigation-guard.ts](/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/dashboard-apple-design-20260909/src/hooks/use-unsaved-navigation-guard.ts)와 [ManagementPage](/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/dashboard-apple-design-20260909/src/features/management/management-page.tsx)에 다음 동작을 적용했다.

| 문제 | 최종 동작과 보존 경계 |
| --- | --- |
| 상세에서 다른 화면으로 이동하면 미저장 입력 소실 | 관리 화면의 명시적 이동, 동일 origin 일반 링크, 관리 Dialog 닫기·Escape·바깥 클릭을 같은 계속 편집/변경사항 버리기 확인으로 연결 |
| Back/Forward가 먼저 URL·화면을 바꿈 | 지원 브라우저는 cancelable same-document Navigation traverse를 취소하고 승인한 destination key로 한 번 재개. 반복 시도는 처음 확인 중인 의도를 바꾸지 않음 |
| 상세 URL 작성이 비동기 라우터 교체와 엇갈림 | 상세 열기·닫기와 탭 정규화는 기존 공통 native URL writer를 사용. 현재 검색·페이지 조건을 함께 보존 |
| 전역 saving 플래그가 새 상세의 초안도 보호에서 제외 | 전역 동기 mutation 잠금은 유지하고, 실제 제출한 canonical form/시간표와 `detailRequestId`가 같은 경우에만 진행 중 저장의 이탈 예외 인정 |
| 같은 상세에서 저장 후 추가 입력·원복한 값 소실 | 이전 저장값으로 되돌렸더라도 진행 중 제출값과 다르면 새 초안으로 보호. 늦은 응답은 새 초안을 바꾸지 않음 |
| 관계 변경·시간표만 저장해도 일반 필드 보호가 꺼짐 | 관계 mutation은 form을 제출한 것으로 취급하지 않음. normalized 시간표 저장은 해당 수업·상세 lifetime의 제출 시간표만 처리. 일반 필드와 시간표를 각각 제출했다면 둘을 함께 판정 |
| 등록 요청 뒤 추가 입력이 성공 시 자동 닫힘으로 사라짐 | 학생·수업·교재 등록 입력과 Select 등을 저장 중 잠금. 실패하면 입력을 유지하고 잠금 해제. 제출한 등록 화면의 X/Escape 이탈과 늦은 응답 소유권은 유지 |
| 수업 등록의 직접 입력 시간표가 dirty 계산에서 빠짐 | 정규화 전 자유 입력을 포함한 실제 등록 form 전체를 trim 기준으로 비교. 상세의 legacy 시간표는 canonical slot 기준 유지 |
| 상세 선택만으로 table actions가 달라짐 | 명시적 이동 handler는 최신 guard를 ref로 읽고 함수 identity를 유지. 성능 결과는 아래 최종 측정란에서 별도 판정 |

일반 mutation 동기 잠금, 일괄 처리의 모든 요청 종료 후 잠금 해제, 수업별 시간표 잠금, 권한 검사, 저장 서비스 인자, 실패 재시도 키와 실제 저장·목록 재조회 계약을 유지했다. DB 함수·마이그레이션·provider 발송 설정은 변경하지 않았다.

### 자동 동작 회귀

실제 production ManagementPage와 공통 Dialog를 렌더하고 서비스 응답만 지연시키는 DOM 테스트를 사용했다. fixture adapter 자체가 초안 보호를 구현하지 않는다.

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 저장 중 초안 경계 최초 재현 | 최초 12개 중 11개 실패 | [pending-draft-red.log](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/pending-draft-red.log) |
| 등록 입력 잠금·수업시간 자유 입력 누락 재현 | 각각 수정 전 실패 | [create-freeze-red.log](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/create-freeze-red.log), [create-schedule-red.log](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/create-schedule-red.log) |
| 신규 pending/create 동작 | 15/15 통과 | [pending-draft-green.log](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/pending-draft-green.log) |
| 관리 도메인·fallback·shell·공통 제어·공개 캐시 mutation 경계 등 관련 회귀 | 350/350 통과, 실패·건너뜀·취소 0 | [pending-draft-regression.log](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/pending-draft-regression.log) |

350개는 해당 수정 완료 시점의 관련 회귀 집합이다. 아래 프로젝트 전체 최종 실행과 합산하거나, 이후 빠른 이동 변경까지 검증했다고 표현하지 않는다. 두 수정 파일의 ESLint와 `git diff --check`도 통과했다.

### 실제 브라우저 fixture

Chrome `152.0.7977.83`, 로컬 `127.0.0.1:3137`, reduced-motion에서 실행했다. 외부 origin 요청은 차단했다.

| 흐름 | 환경·결과 | 근거 |
| --- | --- | --- |
| 학생 → 수업 → Back 취소·승인 → Forward 취소·승인 → 명시적 학생 복귀 → 새 초안 | native 1280/390px 2개 환경 통과. 편집으로 history 추가 없음, Back 취소 후 추가 요청 0, 저장 시도 0, pageerror·외부 요청 0 | [navigation/browser.json](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/browser.json) |
| 같은 흐름의 구형 API fallback | Navigation API를 숨긴 Chrome 1280/390px 2개 환경에서 Back·명시적 복귀·새 초안·포커스 통과. 편집 시 sentinel 1개 추가. native Forward 보존은 검증 대상에서 제외 | 같은 [원본과 실행 스크립트](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/browser.mjs) |
| 1.8초 학생 저장 중 다른 상세의 새 초안·같은 상세 추가 입력·원래 값으로 되돌리기 | 3개 시나리오 × 1280px light/390px dark = 6/6. 진행 요청 1개인 시점의 이탈 확인, 계속 편집 후 포커스·입력, 저장 완료 후 새 초안 유지 확인. 시나리오별 합성 저장 1회, pageerror·외부 요청 0 | [pending-draft-browser.json](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/pending-draft-browser.json), [실행 스크립트](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/pending-draft-browser.mjs) |

저장 1회는 **브라우저 → 메모리 fixture 서비스** 호출이다. 실제 인증 DB 저장·재조회 증거가 아니다. normalized 시간표의 같은 수업 재열기·각 제출분 판정과 등록 입력 잠금은 위 production DOM 회귀로 검증했으며, 이 6개 브라우저 시나리오가 그 조합을 모두 실행한 것은 아니다.

## History API 제한과 Chrome 격리 재현

Native 방식은 history entry를 추가하지 않는다. [legacy fallback](/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/dashboard-apple-design-20260909/src/lib/unsaved-history-fallback.ts)은 소유 marker와 waiting/armed/restoring/releasing/released 단계로 관리한다. capture popstate에서 임시 이탈을 Next에 전달하지 않고 원래 sentinel로 복원한 뒤 확인을 요청한다. 해제는 현재 URL과 opaque Next state를 보존한 후 승인된 의도를 한 번 실행한다. 반복 Back의 첫 의도, dirty 재활성화, 복원 중 해제, 다중 entry Back, unrelated push 뒤 cleanup, primitive/null state를 포함한 [14개 behavior 검사](/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/dashboard-apple-design-20260909/tests/unsaved-history-fallback.test.mjs)가 관련 회귀에서 통과했다.

**구형 fallback의 구조적 제한:** sentinel을 push할 때 기존 Forward branch가 잘린다. History API에는 entry 하나를 삭제하는 기능이 없어 해제 뒤 현재와 같은 URL/state의 비활성 Forward 복제 entry가 남을 수 있다. 최신 Navigation API와 같은 history 보존 수준으로 보고하지 않는다. API 미지원 검증은 Chrome에서 기능을 숨긴 방식이며 Safari·Firefox의 구버전 실기기 검증은 아니다.

Native QA 최초 실행에서 `history.forward()` 첫 취소 뒤 재시도가 navigate 이벤트를 내지 않았다. Next/React가 없는 정적 페이지에서도 Chrome 152의 A→push B→Back 후 Forward 취소로 재현했고, 100/1000ms 대기와 새 사용자 클릭으로도 해결되지 않았다. 3-entry 조건에서는 재시도가 발생했다. 앱 로그에는 첫 취소 이후 추가 replace/push가 없었고 Navigation current index와 CDP current index도 일치했다. 따라서 Next의 늦은 URL 작성으로 단정하지 않으며, Chromium 내부 원인까지 규명했다고 주장하지 않는다. [격리 재현](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/native-forward-isolation.json)

`navigation.forward()`와 새 사용자 클릭 후 CDP `Page.navigateToHistoryEntry`는 같은 위치에서 매번 새 traverse를 발생시켰다. CDP 2-entry/3-entry 각각 3회가 userInitiated·cancelable로 취소됨을 확인한 뒤 native 실제 브라우저 QA를 CDP history entry 이동으로 실행했다. 새 클릭 없이 반복하는 CDP 이동은 두 번째에 cancelable=false가 될 수 있어, 실제 사용자의 계속 편집 클릭을 생략하지 않았다. [활성화 포함 비교 원본](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/native-forward-matrix-activated.json)

이 현상을 감추기 위해 앱의 History API를 바꾸거나 추가 history entry를 넣지 않았다. native 브라우저 이동 통과와 Chrome의 script `history.forward()` 재시도 제한은 별개 기록으로 남긴다.

## 중첩 확인 Dialog

공통 [DialogContent](/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/dashboard-apple-design-20260909/src/components/ui/dialog.tsx)의 `layer="nested"`는 overlay 85/content 90을 함께 지정한다. 상위 관리 상세 80 위에서 미저장 확인·수업에서 학생 상세 이동 확인·수강 관계 확인 3개에 적용했다. 이전에는 content만 90이고 overlay가 50이라 상세가 어두워지지 않았다.

공통 닫기 위임·폼 소유권·Escape·포커스 복귀를 포함한 [overlay 회귀 10/10](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/overlay-regression.log)이 통과했다. [390px dark 확인 화면](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/pending-new-lifetime-390.png)에서 상위 상세 dim 처리와 계속 편집 focus ring을 확인했다. 학생·수업 이동의 계속 편집 포커스는 위 browser.json에, 저장 중 새 초안의 포커스는 pending-draft-browser 스크립트에 각각 assertion이 있다.

## 역할별 클라이언트 UI와 모바일 포커스

실제 AuthGuard·AppSidebar·NavMain·getRoleCapabilities에 합성 identity/session/data를 연결했다. 기본 관리자 fixture 하나를 모든 역할의 근거로 사용하지 않았다. 실제 AuthProvider 로그인과 서버 데이터 권한 검증은 별도다. [검증 조건·소스 지문](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/roles/source-snapshot-final.json)

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 25개 운영 경로 × admin/staff/teacher/assistant/viewer, 1280px | 125/125. 직접 URL·메뉴·프로필 flag·허용 콘텐츠 마운트·문서 폭 | [role-browser-verified.json](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/roles/role-browser-verified.json) |
| 390px 역할별 펼친 메뉴·닫기·문서 폭 | 5/5 | 같은 원본의 mobile 항목 |
| 수업그룹·강의실·선생님 설정 × 5역할 | 15/15: 편집 가능 초안 확인 8, 읽기 전용 4, assistant redirect·원본 미마운트 3. 저장 클릭·합성 쓰기 0 | [role-settings-verified.json](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/roles/role-settings-verified.json) |
| 390px 5역할 + 기본 fixture, Enter·Escape·바깥 클릭·메뉴 이동 | 6/6: focus trap·동일 화면 원점 복귀·이동 후 이전 trigger 비참조 | [role-focus-default.json](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/roles/role-focus-default.json) |
| Sidebar 실제 Radix DOM 6개 + shell/brand 회귀 32개 | 38/38 | [sidebar-regression-after.log](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/roles/sidebar-regression-after.log) |
| 설정 역할 관련 회귀 | 82/82 | [settings-role-final-regression.log](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/roles/settings-role-final-regression.log) |

125개는 한 번의 무중단 실행이 아니다. 최초 최종 실행의 118개와 `ERR_NETWORK_IO_SUSPENDED`·연결 거절·timeout 구간 7개를 새 context에서 재검증한 결과를 합쳤다. 각 행의 `evidenceFile`로 최초/재검증 원본을 추적할 수 있다. admin의 `isStaff=true`를 실제 AuthProvider와 맞춘 최종 근거이며, 초기에 false였던 결과는 대체했다. [역할 검증 상세](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/roles/verification.md)

admin/staff/teacher/viewer는 현행 AuthGuard에서 25개 직접 진입이 허용되고, assistant는 5개 허용·20개 word-retests 이동이다. 고유 메뉴 URL은 각각 22/22/13/4/11개다. 메뉴 미노출과 직접 URL 거부, 데이터 읽기·쓰기 권한은 서로 다른 계약으로 기록한다.

수업그룹은 admin/staff, 강의실·선생님 catalog는 admin/staff/teacher 편집을 허용하는 저장소 최종 정책과 UI를 맞췄다. viewer의 강의실·선생님 편집과 teacher/viewer의 수업그룹 편집을 막고, 학교의 기존 authenticated-wide 쓰기 정책은 보존했다. 교사의 선생님 catalog 편집을 계정/역할 관리 권한으로 확대하지 않았다. 이는 활성 repository baseline/catalog와 migration chain의 읽기 대조 결과이며 운영 DB 역할별 저장 실행 결과가 아니다. [정책 근거와 예외](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/roles/settings-role-policy-review.md)

Sidebar는 같은 pathname에서 닫히면 연결·가시·enabled인 실제 원점에 포커스를 돌리고, 다른 pathname이면 새 화면 포커스를 보존한다. 브라우저 fixture의 경로 이동은 shell을 재마운트하므로 이전 trigger 분리와 BODY 활성까지만 관찰됐다. 이를 모든 실제 앱 경로의 heading 자동 초점으로 확대하지 않는다. 역할 브라우저는 light·reduced-motion의 읽기/빈/불가 fixture이며, 전체 dark·업무 상태 조합을 실행한 것은 아니다. 성공 행 pageerror·수집된 console warning/error와 외부·non-GET/HEAD·API 요청은 0이다. 초기 모바일 메뉴 4개에 별도 console 수집이 없었던 점은 6개 mobile-focus run의 수집 결과와 구분한다.

## 이전 Docker 차단 검사 13개

이전 전체 회귀 4,950개 중 Docker daemon 미실행으로 실패한 정확한 이름 13개를 추출해 **로컬 격리 DB에서 13/13 재실행 통과**했다. 실패·건너뜀·취소 0이고 실제 실행 이름이 원래 대상과 일치한다. [completion.json](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/db/completion.json)

| 선별 검사 | 통과 |
| --- | ---: |
| PostgreSQL 17 트리거 순서·제한 catalog reader·전제조건·함수 ACL·차이 감지 | 9/9 |
| 알림 adapter forward migration 충돌 시 플래그·규칙 보존 | 1/1 |
| 최초 대기 알림 재시도 시각 제약, 로컬 pgTAP assertion 4개 포함 | 1/1 |
| 외부 provider 없이 준비·활성화·예약·피드백·내부 알림 저장 | 2/2 |

기존 Docker Desktop과 pinned Supabase CLI를 사용했다. 고유 임시 컨테이너·프로젝트만 만들고 기존 컨테이너 10개·볼륨 20개·네트워크 19개의 ID/이름 집합을 보존했으며 테스트 리소스 잔류는 0이다. 실행한 테스트 소스 4개의 전후 SHA-256도 일치했다. 운영 URL·실인증값·provider secret·linked remote DB 명령을 사용하지 않았다. 마지막 2개 로컬 DB 흐름은 fetch/http/https/directory/provider/external-attempt audit 0을 assertion으로 확인했다. [격리 및 실행 상세](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/db/verification.md), [정확한 실행 인자·로그](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/db/rerun-summary.json)

이 13개는 기존 테스트별 기준 migration과 지정 forward migration으로 구성한 선별 DB 검증이다. **최신 전체 migration chain의 전체 pgTAP, 실제 인증 브라우저 저장, 운영 RLS/ACL 검증이 아니다.** 실행 시간은 DB 생성·migration 재구성 비용을 포함하므로 제품 성능으로 쓰지 않는다. 이 선별 재검증의 환경 차단은 해소됐다.

## 성능 전후 비교

1차 검증 소스(3138)와 이 후속 묶음(3137)을 같은 Chrome, 데이터, dev 모드에서 번갈아 5회 측정했다. 학생 상세 클릭→입력 DOM 감지 중앙값은 **153.1→115.2ms**, URL 반영은 **194.7→1.0ms**였다. 상세 열기에 발생하는 RSC 요청은 **1→0회**, 해당 encoded 응답은 **3,283→0B**였다. 실제 업무 API 요청은 양쪽 0회다. DOM 감지는 화면 paint/FCP가 아니며 운영 환경 수치로 일반화하지 않는다.

동기 URL 반영 중간 구현에서 발생한 약 46ms 추가 JS 실행을 CPU/Timeline으로 조사해, 상세 query 때문에 테이블 전체가 다시 렌더되는 경계를 분리했다. 목록에 필요한 query만 memoized table에 전달하면서 최신 URL의 다른 매개변수는 필터 쓰기에 보존한다. 실제 PC/모바일에서 테이블 스크롤·선택 유지, query 보존, 가로 넘침 0을 확인했다. 동시에 실행된 부하 있는 중간 측정은 비교에서 제외했다. [최종 5회 원본](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/detail-performance-table-boundary.json), [병목 조사](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/detail-performance-investigation.md), [테이블 브라우저](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/table-route-browser.json).

초기 목록·검색의 1차 전후 비교와 입력 저장 횟수 21→1은 이전 전역 보고서에 별도로 기록한다. 이 상세 성능 측정을 초기 로딩 개선으로 재사용하지 않는다.

## 프로젝트 전체 최종 회귀·타입·린트·빌드

이 묶음 전체 실행은 **5,105개 중 5,104개 통과, 1개 실패, 취소·건너뜀 0**이었다. 남은 1개는 preview overlay의 JSX 모양을 고정한 기존 단언이었다. 실제 Radix DOM에서 overlay/content의 명시적 z-index가 유지되는 회귀로 보완해 집중 재검사를 통과했다. 전체 실행과 그 후 교정 재검사를 구분하며, 한 번의 전체 실행이 5,105/5,105였다고 표현하지 않는다. 이전에 Docker로 차단됐던 13개 검사도 이 전체 실행에서 통과했다. [전체 원본](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/full-tests-final.log), [overlay 교정 재검사](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/preview-overlay-final.log).

격리된 소스 snapshot에서 production build 및 포함된 TypeScript 검사가 통과했다. 전체 ESLint는 오류 0, 기존 경고 5개(timetable 불필요 dependency 1, ops service 미사용 함수 3, cache 테스트 미사용 import 1)였다. 마지막 Sidebar/Ops 확인창 수정 뒤 build·lint를 다시 실행했다. [build](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/build-final.log), [lint](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/eslint-final.log). 이후 남은 편집 화면 8경로 확장은 별도 후속 보고서와 최종 snapshot 기준으로 판정한다. 개별 회귀 수는 겹치므로 합산하지 않는다.

## 빠른 이동과 공통 이탈 확인

QuickSearch는 관리 상세 위의 nested layer로 열린다. 선택할 때 palette를 먼저 닫고 실제 열었던 입력/버튼으로 포커스를 복귀한 다음 `requestAppNavigation`으로 이동을 요청한다. 같은 경로를 고르면 현재 상세·query를 유지하고 검색만 닫는다. 선택 중복과 반복 열기, 키보드 선택을 별도로 검증했다. [빠른 이동 근거](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/quick-search/verification.md)

공통 broker는 dirty 편집자가 있는지 동기 확인한다. clean listener가 먼저 등록되어 있어도 다른 dirty 편집자의 확인을 건너뛰지 않는다. 해제 중인 구형 history fallback 정리는 승인한 intent가 실제 실행될 때만 수행한다. 공통 broker/실제 QuickSearch DOM 회귀 9/9를 확인했다. [다중 편집기 검사](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/broker-multiple-editors.log)

`useDraftNavigation`은 dirty 판단을 화면에 두고 확인 UI와 포커스 복귀만 공유한다. 설정·휴보강 확장도 같은 계속 편집/변경사항 버리기 문구와 nested Dialog를 사용한다. 여러 독립 dirty 편집기의 결정을 자동 병합하는 저장 시스템은 아니므로 한 화면의 업무 소유자가 관련 초안들을 함께 판단해야 한다.

휴보강은 신청/보완의 원본 입력·과목·선생님을 baseline으로 두고 승인·반려·환불·최종취소 의견도 이탈 확인에 포함했다. 닫기·Escape와 앱 이동은 같은 확인을 거친다. 변경 없는 새 신청은 확인 없이 닫히며, 승인된 버리기만 입력을 초기화한다. 기존 권한, 충돌 판정, 상신/승인/환불 서비스와 발송 경계는 변경하지 않았다. 수정 전 4개 중 3개 실패를 재현했고 관련 98/98을 통과했다. Chrome 1280 light/390 dark에서 Escape 취소, 실제 QuickSearch 취소→재선택→버리기, 입력·포커스 복귀를 확인했다. 쓰기·외부 요청·pageerror 0이다. [회귀](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/makeup-draft-regression.log), [브라우저](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/makeup-browser.json)

설정 5개와 QuickSearch 관련 80/80, Sidebar/shell 40/40이 통과했다. 학교·과목 PC/모바일 4환경에서 확인 취소·폐기·재시도·포커스를 검증했다. expanded/mobile 상태의 숨은 툴팁이 첫 Escape를 소비하던 문제는 툴팁의 실제 open 상태를 collapsed PC에만 허용하여 해결했다. [설정/Sidebar 보고](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/settings-navigation/verification.md).

Ops와 알림의 기존 guard에도 app intent를 연결했고, 알림 저장 성공의 dirty 해제가 대기 중인 이동 의도를 지우던 문제를 동기 ref로 보존했다. 실제 DOM의 신규 7개가 통과했다. Ops 등록 fixture 1280/390에서 QuickSearch→기존 확인창→취소/폐기와 z-index(배경85/내용90)를 확인했다. 알림의 편집 화면 브라우저는 현재 fixture의 초기 데이터 준비 부족으로 미검증이며, DOM 합성 저장 회귀와 구분한다. [Ops 브라우저](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/existing-editors-browser.json).

## 테마 첫 진입과 시스템 설정

저장된 dark 테마로 처음 진입하면 서버의 light 버튼과 클라이언트의 dark 버튼이 달라 hydration 오류가 발생했다. ThemeProvider는 서버와 첫 hydration 값을 일치시킨 뒤 저장된 유효한 테마를 사용한다. 차단되거나 잘못된 localStorage에도 세션 전환은 동작하며, system 모드는 OS 변경을 표면과 버튼에 함께 반영한다. system-dark에서 토글하면 light로 전환한다. Toast도 같은 application theme context를 구독한다.

reduced-motion에서는 View Transition을 시작하지 않으며, 일반 전환의 finished promise 실패로 잠금이 남거나 미처리 rejection이 생기지 않게 했다. 테마 신규 6개와 shell 30개, 총 36/36을 통과했다. Chrome 1280/390 × saved dark/system 4환경에서 첫 진입, OS 변경, 키보드 전환과 포커스, reduced-motion 전환 호출 0을 확인했다. [테마 회귀](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/theme-tests.log), [브라우저](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/theme-browser.json)

## 계정 수명 이후 후속 요청

수업 등록 RPC를 기다리는 동안 계정·역할 변경, 로그아웃 또는 unmount가 발생하면, 이전 호출이 완료된 뒤 새 세션으로 시간표 defaults 조회/초기화를 시작할 수 있었다. 활성 페이지 수명 ref를 create/defaults await 뒤에 확인하여 새 후속 RPC를 막았다. 같은 actor가 상세만 바꾼 경우의 정상 초기화와 재시도는 계속된다. 8개 RED→GREEN과 기존 같은 actor 사례 2개, detail/history 집중 94/94를 확인했다. [독립 검토와 수정 근거](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/next-qa/navigation/final-independent-review.md)

## 남은 검증과 배포 상태

- 전역 67개 목록에 설명되지 않은 누락은 없지만 모든 역할·탭·상세·오류·대량 데이터의 업무 조합 완료는 주장하지 않는다.
- 실제 AuthProvider 로그인·계정별 세션, 운영 DashboardLayout의 전체 역할 안내와 실제 데이터 소유 범위는 미검증이다.
- 실제 인증 브라우저에서 테스트 DB 저장 → 재조회 → 목록 복귀, 운영 DB의 RLS/ACL·동시성·멱등성, 최신 전체 migration pgTAP는 미검증이다. 메모리 fixture 저장과 13개 격리 DB 테스트를 구분한다.
- 구형 Safari/Firefox 실기기 history 동작, legacy Forward branch 보존, 모든 업무 모달의 전역 미저장 보호는 미검증 또는 위 명시한 제한이 있다. 비취소 가능한 브라우저 강제 이동까지 막는다는 보장은 하지 않는다.
- 실제 provider·고객 발송, 메일·외부 인증, 운영 데이터 변경은 실행하지 않았다.
- 커밋·푸시·배포하지 않았다. 배포 검증은 미실행이다.

이 문서는 확인한 코드·fixture·자동 회귀·선별 DB 증거만 완료로 기록한다. 후속 편집 화면 확장의 집계는 [전역 편집 흐름 보고서](./2026-09-11-draft-workflow-polish.md)에서 별도로 기록한다.
