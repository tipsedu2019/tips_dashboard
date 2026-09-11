# TIPS Dashboard 전역 편집 흐름 후속 검증

2026-09-11. 승인된 `codex/dashboard-apple-design-20260909` 작업 폴더에서 진행한 세 번째 묶음이다. [공통 UI 최초 검증](./2026-09-11-global-apple-polish.md), [이동·역할·테마 검증](./2026-09-11-navigation-role-polish.md) 이후 남은 편집 화면을 확장했다. 실제 운영 데이터와 발송 설정은 변경하지 않았다.

증거 폴더: `/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/final-qa`.

## 적용 분모와 보존 범위

전역 page 67개는 렌더 38개와 page redirect 29개다. 38개 중 운영 25개를 편집 흐름 기준으로 다시 분류했다. 실제 page·라우트 누락은 없으며, 탭·다이얼로그와 query 분기는 별도로 기록한다.

| 편집 흐름 | 운영 page 수 | 공통 동작 연결 |
| --- | ---: | --- |
| 학생·수업 관리 | 2 | 기존 상세 form/시간표 guard, 저장 lifetime, 검색·선택·스크롤 유지 |
| 학교·강의실·수업그룹·선생님·과목 설정 | 5 | 제출·조회 baseline, 원복, 실패·재시도, 공통 이탈 확인 |
| 업무·등록·전반·퇴원·단어 재시험 | 5 | 본체·청강 예약·원장 결정·목록 점수의 dirty/부분 폐기와 공통 이동 |
| 알림 설정 | 1 | 기존 guard와 app intent, 저장 완료 뒤 대기 이동 의도 보존 |
| 휴보강 | 1 | 신청·보완·의견 draft, 공통 이탈 확인, 제출 중 잠금 |
| 전자결재 | 1 | 본문·미반영 점검 항목·서식명·문서별 댓글의 독립 dirty |
| 수업계획 | 3 | `/admin/class-schedule`, `/admin/curriculum/lesson-design`, `/admin/curriculum?lessonDesign=1`의 계획·차시·진도 draft |
| 학사일정·연간보드 | 2 | 공통 EventForm과 실제 두 부모의 저장 lifetime |
| 교재 운영 | 1 | 교재·요청/주문·출고·일괄 처리·실사 draft |
| 교재 기준 설정 | 1 | publisher/supplier/subsubject 편집 journal과 navigation baseline |
| 편집 경로 합계 | 22 | 경로 연결 수이며 모든 업무 상태 조합의 실서버 검증 수가 아님 |
| 대시보드·통계·시간표 | 3 | 읽기·필터·비교·이미지 내보내기. 업무 저장 초안 없음 |
| 운영 합계 | 25 | 나머지 인증 4·오류 5·공개 4의 별도 상태는 전수표를 따름 |

`/admin/curriculum`의 기본 AcademicCurriculumWorkspace는 조회·상세 진입 branch이고, 편집 branch만 위 수업계획 분모에 포함한다. 같은 page의 두 branch를 page 수에 중복 가산하지 않는다. 등록 발송·권한 변경·재고/정산·수업 lifecycle의 기존 업무 규칙과 API/RPC 계약은 유지한다. DB 함수·migration은 변경하지 않았다.

## 공통 이동 처리

`useDraftNavigation`의 계속 편집/변경사항 버리기 확인을 재사용한다. 외부 route 이동과 같은 페이지의 부분 폐기를 구분했다. 한 초안만 버리더라도 다른 초안이 남으면 기존 뒤로가기 보호가 유지된다. 마지막 초안이 clean이 된 직후 local 이동은 legacy history 정리가 끝난 후 실행한다. 반복 이동·중복 클릭은 처음 대기 중인 의도를 한 번만 처리한다.

구형 Navigation API fallback에서 초안이 남아 있는 동안 내부 탭이 `pushState`로 sentinel 소유권을 벗어나는 문제를 실제 Chrome 강제 fallback에서 재현했다. 공통 `pushLocalHistoryState`는 소유 sentinel이 있을 때만 내부 query를 tracked replace로 반영한다. 최신 브라우저와 보호가 없는 상태의 push는 유지한다. 교재의 합성 popstate는 직접 query adoption으로 대체하여 실제 Back과 혼동하지 않게 했다.

실제 Chrome에서 첫 Back 취소 → 내부 과목 탭 변경 → 두 번째 Back을 실행하자 Next의 먼저 등록된 Window listener가 임시 base 주소를 반영하고 편집기 guard를 정리하는 결함을 재현했다. Window의 뒤늦은 capture listener는 등록 순서를 앞당기지 않는다. `src/instrumentation-client.ts`가 React hydration 전에 공통 dispatcher를 동기 설치하고, dirty lifetime만 구독하게 수정했다. 기존 fake browser도 capture 우선 정렬을 제거하고 실제 등록 순서로 바꾸었다. 최초 회귀 실패 원본과 수정 후 반복 Back·로컬 주소 변경·허용 이동 1회·비활성 통과 18/18을 구분해 남겼다. 설치된 Next 16.1.1의 bootstrap 순서와 [공식 초기화 규약](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client)을 확인했다. 실제 브라우저 후속 결과는 아래 최종 검증을 따른다.

예외: legacy 방식은 기존 Forward branch를 보존하지 못하고, 작성 중 내부 query 이동의 history 항목을 하나로 합친다. 이는 최신 브라우저 동작이 아니다. 구형 Safari/Firefox 실기기 검증은 하지 않았다. 비취소 가능한 브라우저 강제 이동까지 보호한다고 주장하지 않는다.

## 전자결재·휴보강

전자결재는 템플릿을 처음 열거나 기본 결재자가 자동 채워진 상태를 사용자 편집으로 오인하지 않는다. 원복은 clean이며, 실제 제출한 입력과 현재 입력을 비교하므로 저장 중 추가한 내용은 계속 보호한다. 다른 서식/문서로 바꾼 뒤 도착한 이전 저장 응답은 새 편집 lifetime을 닫거나 clean으로 만들지 않는다. 댓글은 문서별로 유지하고 본문을 버려도 함께 지우지 않는다. 모든 기존 mutation 진입에 동기 저장 잠금을 적용했다.

미반영 점검 항목을 취소하거나 초기화할 때도 실제로 없어지는 입력만 확인한다. 서식을 기존 문서에 불러오는 동작은 문서 저장이 필요한 변경으로 남긴다. 서비스의 저장 인자, 권한·전이·멱등성·발송 계약은 유지했다. 신규 문서 저장 중 이어 쓴 내용의 다음 저장이 또 다른 CREATE를 실행하던 결함도 실제 DOM에서 재현했다. 생성 서비스는 기존 성공 경계 뒤에 생성된 ID만 반환하고, 같은 편집 lifetime에 남은 입력을 해당 ID의 수정으로 연결한다. 이후 저장은 동일 ID에 UPDATE 1회이며 새 CREATE는 없다. 생성 응답 중 대기한 서식 교체도 최신 문서 ID·승인 baseline을 기준으로 계속 미저장으로 판정한다. 이 두 반례를 포함한 결재·알림 adapter 회귀 78/78이 통과했고 독립 읽기 검토에서 추가 높은 위험 회귀를 확인하지 못했다.

휴보강은 저장 중 수정 가능한 필드가 성공 시 초기화되던 문제를 재현했다. 제출 동안 form fieldset과 처리 의견을 잠그고 실패하면 작성값과 조작을 복원한다. 동일 tick 저장은 한 번만 시작한다. UI/실제 service를 사용한 합성 transport 회귀 100/100이 통과했다. 전자결재 PC light/모바일 dark에서는 서식 변경 취소, QuickSearch 취소·재선택·폐기와 실제 포커스, 문서 가로 넘침 0을 확인했다. 브라우저 쓰기·외부 요청·pageerror는 0이며 본문의 접근성 이름도 입력 후 `본문`으로 유지됐다.

- `navigation/approval-makeup-regression.log`: 100/100. 이후 공통 local query 후속 검사는 별도이며 개수 합산 금지.
- `navigation/approval-browser.json`: PC/모바일 2환경.
- `navigation/approval-label-probe.log`: 실제 접근성 tree의 본문 이름.
- `navigation/clean-local-after.log`: 공통 history/결재/휴보강/설정 69/69.
- `navigation/approval-template-after.log`: 저장 대기 중 서식 교체의 최신 accepted baseline 반례를 포함한 결재 54/54.
- `navigation/approval-identity-final.log`: 생성 ID 후속 저장·생성 대기 중 서식 교체를 포함한 최종 결재/adapter 78/78. 이전 실행 수와 합산하지 않는다.
- `navigation/root-regression-final.log`: ID 후속 수정 직전 결재·휴보강·관리·공통의 집중 회귀 307/307. ID 후속 수정은 위 78개와 최종 전체 회귀로 별도 확인한다.

## 교재·학사일정

교재 운영의 마스터·요청/주문·출고·일괄 속성·일괄 주문·실사 6계열을 구분했다. 자동 기본값과 초기 조회는 clean이고, 원복한 폼도 확인 없이 닫힌다. 실사 수량 `0`과 메모도 보호하며 다른 탭·위치·페이지에서는 기존 초안을 유지한다. 부분 폐기 때 다른 계열의 초안과 필요한 선택은 보존한다. 기존 service 호출 25개의 AST 인자 코드는 HEAD와 동일하다. 관련 206/206, PC/모바일 × native/legacy 4환경에서 각 12단계가 통과했다. 최종 실행의 Fast Refresh, console 오류·경고, 외부 요청, 네트워크 쓰기는 모두 0이다.

이전 개발 fixture에서 필드 소실 1회와 확인창 클릭 timeout 1회가 있었으나 당시 동시 HMR 여부를 기록하지 않아 원인을 단정하지 않는다. 후속 PC 반복과 소스 고정 4환경에서는 통과했다. 실패 원본도 남겼다. [교재 검증 원본](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/final-qa/textbooks/verification.md).

학사일정과 연간보드는 EventForm의 동기 저장 잠금, 실패 복구, 편집 lifetime을 공유한다. A 저장 중 새 B를 열었을 때 A의 늦은 응답이 B를 닫거나 초기화하던 문제는 실제 부모 컴포넌트의 cleanup을 현재 EventForm에 귀속시켜 해결했다. 늦게 도착한 일정 유형 목록의 기본값 변경이 이미 작성한 제목을 초기화하거나 저장 응답을 다른 lifetime으로 오인하던 반례 2개도 재현했다. 실제 편집 대상의 소유권과 카탈로그 기본값의 변경을 분리해 해결했으며 관련 25/25가 통과했다(`calendar-settings/late-catalog-after.log`). EventForm의 교재명·출판사·범위는 행별 접근성 이름을 제공하고, 달력 메뉴·이전 달·다음 달 아이콘에도 이름을 부여했다.

교재 기준 설정은 저장 operation journal을 변경하지 않고 별도의 navigation baseline만 비교한다. 이미 조회한 행의 원래 값으로 돌아오면 확인을 생략하지만, 총판 순서는 첫 항목이 primary인 실제 저장 계약이므로 순서를 유지해 비교한다. 제출 prefix만 baseline에 반영하며 후속 입력은 계속 dirty다. 전체 원복을 판단할 데이터가 없는 추가·삭제·순서 작업은 추가 전체조회 없이 보수적으로 확인한다. 세 화면의 관련 고유 회귀 196개 범위가 통과했고, PC/모바일 6환경에서 취소·포커스·원복·QuickSearch와 화면/편집창 넘침 0을 확인했다. 브라우저의 실제 저장은 수행하지 않았다. [브라우저 원본](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/final-qa/calendar-settings/browser.json).

## 수업계획 3개 진입 경로

같은 수업의 재조회가 작성 중인 내용을 덮어쓰던 문제를 수정하고, 실제 제출 snapshot·서버 승인 revision·추가 입력을 구분했다. normalized 차시를 읽는 중에는 legacy 저장으로 우회하지 않는다. 저장 성공 뒤 재조회 실패는 저장 실패와 구분하며 읽기만 재시도한다.

normalized 달력은 실제 읽어온 차시의 일정 편집으로 연결한다. 저장되지 않던 legacy 월·빈 날짜·drag 조작을 그대로 노출하는 대신 기존 미리보기→일정 생성 RPC를 선택한 월에 연결했다. 기존 legacy 저장 방식의 수업은 원래 기능을 유지했다. 실제 날짜가 요일 규칙에서 벗어나거나 같은 날 차시가 두 개여도 각 차시의 내용이 저장된다. 교재 진도 범위 계산은 기존 순수 함수의 export만 추가해 재사용했다.

긴 한글 교재명은 모바일 내부 영역보다 123px 넓어지고 포커스 복귀 때 scrollLeft가 68px 생겼다. grid의 최소 폭을 수정한 뒤 두 값 모두 0임을 실제 DOM 치수와 스크린샷으로 확인했다. 관련 회귀 159/159, 실제 컴포넌트·합성 서비스 브라우저 10/10(PC light/모바일 dark, reduced-motion)이 통과했다. 저장 실패·재시도·추가 입력·기존 차시 날짜 변경·새 월 생성·차시 메모/진도 저장까지 payload와 재조회를 확인했다. 외부 요청·네트워크 쓰기·pageerror는 0이다. 운영 DB 저장 증거는 아니다. [수업계획 검증 원본](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/final-qa/curriculum/report.md).

## 알림 미반영 입력과 저장 후 이동

내용 편집창의 제목·본문·시간과 수신 채팅방의 미제출 Webhook URL을 부모의 미저장 판정에 포함했다. 로컬 닫기/부분 폐기와 전역 이동을 구분해 다른 규칙·멘션 초안을 남긴다. 아직 `변경사항에 반영`하지 않은 내용이나 `연결 교체`하지 않은 Webhook은 일반 설정 저장으로 제출하지 않는다. 이 입력이 남아 있으면 확인창의 `저장하고 이동`은 제공하지 않고 계속 편집/변경사항 버리기로 처리한다.

원복 직후 비동기 history 정리가 끝나기 전에 app 이동이 먼저 실행되는 반례를 실제 DOM 2개로 확인했다. clean listener도 공통 broker의 이동 전 정리에 참여하며, 다른 편집기가 먼저 확인을 요청했다면 승인 이후에만 정리를 실행한다. 알림 섹션은 자신이 정리하는 popstate를 사용자 Back으로 재해석하지 않고, Next와 다른 전역 listener에는 이벤트를 그대로 전달한다. 저장 실패 메시지는 확인창 안의 alert로 제공하고 버리기 이름은 공통 표현으로 통일했다.

- 알림 도메인 단일 최종 회귀 **728/728**: `notification-navigation/final-notification-regression.log`.
- 기존 Ops 2개와 알림 11개 실제 편집기 DOM **13/13**. 최종 전체 회귀와 개수 합산하지 않는다.
- PC/모바일 브라우저 **8/8**: 부모 저장/실패/재시도 2개, 내용/Webhook 자식 4개, clean history→빠른 이동 2개. 지연 중 두 번 저장 시 진행 요청은 1개, 실패 후 입력 유지·재시도·이동 뒤 Back 재조회까지 확인했다.
- `notification-navigation/browser.json`, `children-browser.json`, `clean-broker-browser.json`. nested overlay 85/content 90, 포커스·취소·원복 직후 닫힘 유지 확인. 실제 외부/쓰기 요청·pageerror·provider 호출은 0이다.

브라우저는 합성 상태와 요청 transport를 사용했다. 실제 설정 DB 저장, Webhook 연결 교체, provider 활성화/발송은 하지 않았다.

## 활성 자식 편집기 재감사

25개 운영 route와 실제 자식 mount를 별도로 대조한 [읽기 감사](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/final-qa/final-scope-audit.md)에서 등록 청강 예약·원장 결정, 목록의 단어 재시험 점수, 알림의 미반영 내용·Webhook 입력 5계열을 추가로 발견했다. 부모 page의 guard 연결만으로 이 자식 입력을 보호하지 못했다. 5계열 모두 실제 mount까지 다시 연결했다.

청강 예약·원장 결정은 사용자 입력과 canonical baseline을 비교해 같은 신청서의 과목 탭을 바꿀 때 없어지는 자식 입력만 확인한다. 부모 신청서나 다른 초안이 남아 있으면 그 보호는 유지한다. 늦은 자식 저장 결과는 다른 편집 대상을 닫거나 덮어쓰지 않는다. 단어 재시험 점수는 동일 tick 저장을 한 번만 시작하고, 실패하면 값을 유지하며, 성공한 snapshot과 같은 입력만 정리한다. clean 상태에서 재조회한 최신 점수를 다음 편집 baseline으로 사용하여 수정하지 않은 다른 점수를 과거 값으로 덮어쓰던 결함도 재현·수정했다. 실제 service payload/권한/발송 경계는 유지했다. 마지막 점수 baseline 수정 이후 집중 회귀 401/401이 통과했다. 최종 bootstrap 변경 이후 실제 native/강제 legacy 브라우저 증거는 별도로 기록한다.

## 최종 검증 상태

전역 [적용·검증 목록](/Users/hyunjun/.codex/visualizations/2026/09/11/01a08e26-3ea6-72c2-828c-bbe46e1b7ba3/final-qa/coverage.md)은 **67개 page 전체**를 포함한다. 렌더 38개와 redirect 29개이며, 운영 25개 중 편집 진입 22개·조회 3개다. 실제 파일과 대조한 누락·중복·퇴역 파일 잔존은 각각 0이다. 현재 단계에서 완료한 것은 이 목록의 코드 수정과 명시된 로컬 검증 범위이며, 아래 실환경 잔여를 포함한 전역 운영 완료를 뜻하지 않는다.

| 최종 검사 | 결과와 근거 |
| --- | --- |
| 전체 자동 회귀와 보정 | 최종 제품 소스 snapshot `enrz9_z9`에서 5,192개 실행: 5,190 통과, 검사 2개 실패, skip/cancel 0. 이전 알림 variant 단언과 실제 초기화를 빠뜨린 Ops DOM harness를 교정한 뒤 두 파일 전체와 공통 history 회귀 123/123 통과. 제품 소스는 변경하지 않았다. `tests-bootstrap-final.log`, `bootstrap-harness-regression.log` |
| 최종 제품 소스 Next build·TypeScript | 통과, `build-bootstrap-final.log`. snapshot `enrz9_z9` |
| 전체 ESLint | 오류 0, 기존 경고 5. `lint-bootstrap-final.log` |
| 전역 실제 브라우저 렌더 | 38화면 × PC 1280 light/모바일 390 dark = 76/76. reduced-motion, 긴 학생·수업명, 문서 가로 넘침·pageerror·console 경고/오류·외부 요청·HTTP 쓰기 모두 0. `route-browser-bootstrap.json` |
| 역할별 진입·설정 | 앞선 동일 권한 코드의 운영 25 × 5역할 125개, 설정 15개 조합 근거 유지. 실제 AuthGuard/capability와 합성 identity이며 실인증 증거 아님 |
| 등록 자식·점수 | 예약/결정 × native/legacy × PC/모바일 8/8, 각 8단계. 점수 PC/모바일 2/2. `registration-drafts/browser-final.json`, `word-browser-final.json`. beforeunload 취소·부분 폐기 후 남은 초안의 반복 Back 포함, HMR/오류/외부/쓰기 0 |
| 교재 최종 공통 guard | native/legacy × PC/모바일 4/4, 각 12단계. `bootstrap-textbooks/browser.json`. 초안·선택 보존, 여러 편집기 부분 폐기, 실패, reload 취소, 반복 Back, clean 이동. HMR/오류/외부/쓰기 0 |
| 다른 공통 guard 사용처 | 학교 설정·결재·휴보강·학생 상세 × native/legacy × PC/모바일 16개 조합에서 최종 통과 근거 확보. 최초 결재 timeout의 예외는 아래에 별도 기록. `navigation/bootstrap-regression.md` |
| 알림 최종 확인창 | 부모 저장 실패/재시도 2 + 내용/Webhook 자식 4 = 6/6. 계속 편집 outline, 저장이 있는 3버튼의 폐기 destructive-outline, 2버튼 폐기 destructive. `notification-navigation/final-confirmation/` |
| 초기 dispatcher 독립 재검증 | 실제 앱 legacy 4/4에서 dispatcher가 Next보다 먼저 설치됨. static 반복 Back 18회도 통과. `registration-drafts/legacy-isolation-conclusion.md` |

교재 재검증 최초 실행은 dev compilation의 Fast Refresh가 섞인 실패 3개와 성공 1개가 있었으며 `bootstrap-textbooks/initial-browser.*`로 보존했다. 예열 helper가 합성 역할을 빠뜨린 실행도 `warmup-missing-role.log`로 분리했다. 합성 관리자 역할과 소스 고정을 맞춘 최종 4환경에서는 HMR 0으로 모든 흐름이 통과했다. 초기 실패가 모두 제품 결함이 아니었다고 단정하지 않는다.

전자결재 native PC에서는 Back 승인 후 재진입해 새 초안을 QuickSearch로 버리는 마지막 이동에 15초 timeout이 한 번 있었다. 최초 실행에는 인과 trace가 없었다. 코드·fixture 변경 없이 이후 3회 및 계측 6회, 총 9회 같은 흐름이 통과했다. 계측 때 승인 intent는 매번 한 번 실행됐고, 주소 되돌림·탐색 오류·문서 교체·HMR는 없었다. 최초 원인은 미확정이며 해결한 제품 결함으로 계산하지 않는다. `navigation/bootstrap-regression.md`에 원본과 재검증을 모두 남겼다.

각 개별 묶음의 완료 수를 전체 test 수로 합산하지 않는다. 초기/최종 snapshot과 테스트 환경 보정 이후 결과는 `verification-bounds.json`으로 구분한다.

보정 snapshot `mlpl0t1d`는 전체 실행·빌드 snapshot과 테스트 파일 2개만 다르다. 해당 두 테스트 파일 lint도 오류/경고 0이다. 전체 5,192개가 한 번에 모두 통과했다고 표현하지 않는다. 이전 전체 통과 5,189개 실행 및 중간 401개 실행도 각각 별도 snapshot 증거다. 최종 소스·테스트·검증 스크립트의 snapshot 대비 차이 0을 확인했다.

## 동일 조건 최종 성능 비교

1차 검증 소스 `tips-apple-final-check-xzzvmh6t`의 3138과 최종 제품 소스 3137을 비교했다. 동일 Chrome 152·Next 16.1.1 dev webpack·합성 학생 8명·1280px·컴파일 예열 뒤 매번 새 context에서 순서를 번갈아 각 5회 측정했다. 전체 검사와 다른 QA 브라우저가 끝난 뒤 실행했다. 실제 운영/API 데이터의 지연이나 production bundle 측정은 아니다.

| 지표 | 1차 검증 소스 | 최종 소스 | 해석 |
| --- | ---: | ---: | --- |
| 초기 첫 학생 표시 중앙값 | 654.28ms | 656.20ms | 범위 622.16–900.17 / 645.24–1,255.98ms. 속도 개선 주장 안 함 |
| 검색 입력→기존 행 제거 DOM 감지 | 393.5ms | 409.9ms | 범위 361.1–458.5 / 363.6–434.9ms. 검색 요청은 양쪽 0 |
| 초기 리소스 요청 | 11 | 11 | HTML·개발 자산 포함 |
| 초기 encoded 리소스 합계 | 4,623,318B | 4,635,070B | 11,752B 증가. API 응답 크기가 아님 |
| 상세 클릭→입력 DOM 감지 중앙값 | 160.1ms | 127.7ms | paint/FCP 지표 아님 |
| 상세 URL 반영 중앙값 | 203.2ms | 2.0ms | 같은 화면의 상세 선택을 즉시 history에 반영 |
| 상세 열기 RSC 요청 / encoded 응답 | 1회 / 3,285B | 0회 / 0B | 확인된 불필요한 route round trip 제거 |
| 실제 업무 API 요청 | 0 | 0 | 합성 fixture이며 업무 API 성능 근거 아님 |

원본은 `initial-performance-final.json`, `initial-performance-summary-final.json`, `detail-performance-final.json`이다. 초기 로딩·검색이 빨라졌다고 주장하지 않는다. 1차의 동일 열 설정 쓰기 21→1, 동일 tick 중복 저장 진입 2→1은 별도 동작 횟수 검증이며 위 시간 수치와 합산하지 않는다. 대량 실데이터·네트워크 환경에서의 성능과 p95는 미검증이다.

## 잔여 범위와 배포

- 설명되지 않은 page 누락 0, 재현 후 수정하지 않은 UI 결함 0. 전자결재 단발 QA timeout 1건은 위와 같이 원인 미확정 관찰로 남는다.
- legacy History 방식의 Forward branch 단절·비활성 복제 entry와 내부 query history 합침은 명시한 호환 한계다. 실제 구형 Safari/Firefox·모바일 touch 기기는 검증하지 않았다.
- 실제 AuthProvider 로그인과 연결된 안전한 테스트 DB에서 저장→재조회→목록 복귀, 실환경 RLS/ACL·동시성·멱등성, 최신 전체 migration chain의 전체 pgTAP는 미검증이다. 로컬 fixture 저장, 실제 production 컴포넌트 DOM 검사, 격리 Postgres 회귀를 같은 증거로 취급하지 않는다.
- 실제 데이터 규모의 초기 로딩·검색·API 요청/응답 성능과 운영 배포 검증은 미실행이다. 업무 정책을 변경하거나 새로운 정책 결정을 추가로 요구한 항목은 없다.
- 커밋·푸시·배포하지 않았다. 운영 데이터 변경, Webhook 제출, provider 활성화·실제 고객 발송을 수행하지 않았다.
