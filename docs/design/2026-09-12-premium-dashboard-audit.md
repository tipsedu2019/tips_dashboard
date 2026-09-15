# TIPS Dashboard — 현재 운영 화면 감사

검토일: 2026-09-12. 목적: 프리미엄 운영 제품 계획의 실제 화면 근거 확보.

화면은 로그인된 Chrome의 별도 감사 탭에서 읽기/탐색만 수행했다. 기존 사용자의 작업 탭은 변경하지 않았다. 임시390×844 viewport는 확인 후 원복했다. 데이터 저장, 신청, 상태 변경, 주문/입고/출고/반품, 고객 발송은 수행하지 않았다.

최신 원격 main `bf504a7a0b336becec182b8f396b463056e6f204`를 GitHub API로 확인하고 소스를 읽었다. 작업 폴더 HEAD `57963652`는 더 오래된 checkout이다. 운영 배포 SHA와 원격 main의 일치는 이번 감사의 검증 대상에 포함하지 않았다.

모든 이미지는 이번 세션에서 캡처 후 파일을 다시 열어 화면 일치를 확인했다. screenshot의 운영 레코드는 문서/fixture의 예시 데이터로 전사하지 않았다. 이미지 파일은 Git에서 무시되는 로컬 `output/`의 내부 검수 자료다.

## 1. 수업일정 — 정보 위계 개선 필요

- 경로: `/admin/class-schedule`.
- 조작: 로그인된 운영 경로 진입, 로딩 완료 후 관찰.
- 상태: 기본 목록 정상 렌더. 표와 필터·페이지 탐색을 확인했다.
- 좋은 점: 수업/일정/진도/동기/상태/작업이 한 표에 연결되어 있고 관련 경로 링크가 있다.
- 문제 F03: 계획0회차, 실제0회차, 기록 없음, 업데이트 대기 없음,0/0회,0%,정상이 한 행에서 반복된다. 실제 예외와 다음 작업의 중요도가 약해진다.
- 문제 F02: 학생관리와 다른 로고·셸·헤더 규격이 보인다.
- 접근성 위험: 행 전체와 내부 여러 링크가 함께 노출된다. 실제 DOM 중첩 및 keyboard behavior는 추가 확인이 필요하며 AX만으로 위반 확정하지 않는다.
- 연결 작업: T05/T15.

기존 검수 이미지: 01 수업일정 현재 화면 (당시 로컬 검수 자료; 저장소 배포 이미지에는 포함하지 않음).

## 2. 대시보드 — 첫 화면 우선 개선

- 경로: `/admin/dashboard`.
- 조작: sidebar ‘대시보드’ 이동; 최초 `-` 상태 후 정상 숫자 수락 확인.
- 상태: 세 일정 유형이 모두0인 성공 화면. 일정 영역이 없어지고 바로가기만 남는다.
- 좋은 점: 지표 종류가 적고 의미 없는 차트나 수치를 추가하지 않았다.
- 문제 F01/F06: 날짜·집계 범위·갱신 시각·정상 빈 일정 상태가 드러나지 않는다. 화면 대부분이 비어 있어 업무 대표 화면의 역할이 약하다.
- 소스 근거: `dashboard-daily-brief.tsx`가 loading/localDate/generatedAt을 소비하지 않고, `use-dashboard-daily-brief.ts`는 재조회 실패 시 brief를 비운다.
- 접근성 위험: loading/empty/error 의미를 전달하는 구성이 부족하다. live region/스크린리더 전체 검수는 하지 않았다.
- 연결 작업: T02/T03.

기존 검수 이미지: 02 대시보드 현재 빈 일정 화면 (당시 로컬 검수 자료; 저장소 배포 이미지에는 포함하지 않음).

## 3. 학생관리 — 공통 기준으로 삼을 기반 확보

- 경로: `/admin/students`.
- 조작: sidebar ‘학생관리’ 이동; 목록 로딩 완료 후 관찰.
- 상태: 검색,4필터,등록,표설정,열정렬/너비조절,행선택,번호페이지 제공.
- 좋은 점: 이름 중심의 정돈된 표, 한 작업면 안의 검색/추가/필터, 충분한 표 너비.
- 문제 F02: 다른 메뉴와 달리 로고/메뉴/헤더 높이가 바뀐다. source의 student/class 한정 셸 override와 대응된다.
- 추가 관찰: 연락처의 하이픈 표시가 혼재한다. 원본값 변경 없이 표시 형식을 통일할 여지가 있다.
- 접근성 위험: 좁은 체크박스와 열 크기 조절 제어는 hit area/focus를 수치와 키보드로 추가 검수해야 한다. 이번에는 클릭·저장하지 않았다.
- 연결 작업: T05/T10/T11.

기존 검수 이미지: 03 학생관리 현재 화면 (당시 로컬 검수 자료; 저장소 배포 이미지에는 포함하지 않음).

## 4. 등록 상담 목록 — 과목 표식 중복 개선 필요

- 경로: `/admin/registration`.
- 조작: ‘등록’ 이동 → ‘상담 신청’ 단계 → ‘전체’ 범위.
- 상태: 현재 목록·범위·단계가 정상 전환됐다. 신청 상세를 열거나 진행상태를 변경하지 않았다.
- 좋은 점: 단계와 건수, 내 담당/전체, 다음 단계 조작이 업무 문맥 안에 있다.
- 문제 F04: 단일 과목 학생의 과목 배지가 빠른 처리/상담 방식/책임자/예약 일시 열에 반복된다. 핵심 일정/담당자보다 반복 장식이 눈에 들어온다.
- 주의: 다중 과목에서 각 셀의 트랙 대응을 보장하는 표시일 수 있으므로 일괄 삭제하면 안 된다. 단일/다중 과목의 정렬 계약을 유지하며 줄인다.
- 접근성 위험: row 열기와 내부 상태 combobox의 keyboard/event propagation은 별도 행동 검수 필요.
- 연결 작업: T13/T14.

기존 검수 이미지: 04 등록 상담 목록 현재 화면 (당시 로컬 검수 자료; 저장소 배포 이미지에는 포함하지 않음).

## 5. 교재 재고 desktop — 기존 개선 보존

- 경로: `/admin/textbooks`.
- 조작: sidebar ‘교재관리’ 이동; 재고 기본 탭 관찰.
- 상태:5탭·검색·분류필터·수량표·번호페이지 정상 렌더.
- 좋은 점: 교재명이 주요 열이며 본관/별관/합계/판매가가 우측에 정렬된다. 교재 재고/요청/주문·입고/출고/재고 실사로 이미 정리돼 있다.
- 개선: 현재 기능을 다시 설계하기보다 공통 셸·숫자/빈값 형식·탭별 action·feedback를 정교화한다.
- 접근성 위험: 넓은 표의 내부 scroll과 page scroll, 긴 제목 전체 읽기를 keyboard/zoom 상태에서 추가 검수한다.
- 연결 작업: T05/T08/T16.

기존 검수 이미지: 05 교재 재고 desktop 현재 화면 (당시 로컬 검수 자료; 저장소 배포 이미지에는 포함하지 않음).

## 6. 교재 재고 mobile — reflow 양호, 첫 내용 접근 개선 필요

- 경로: `/admin/textbooks`,390×844 CSS viewport.
- 조작: 같은 탭에서 viewport만390×844로 설정, DOM과 screenshot 확인, 이후 원복.
- 상태: 모바일 article 목록으로 전환되며 교재명·수량·편집에 접근 가능한 구조.
- 직접 측정: innerWidth390, documentElement.scrollWidth375, body.scrollWidth375. 문서 가로 넘침은 관찰되지 않았다. 스크롤바 영역 때문에 콘텐츠 폭은375였다.
- 검색 input: x29/y214/w317/h44 CSS px.
- 문제 F05: header의 두 번째 검색 행, 두 줄 업무탭, 검색/추가,4분류필터가 쌓여 첫 재고 항목은 화면 중간 이후에서 시작한다.
- 추천: header quick search 축약, 교재 재고4분류만 접힌 필터로 전환. 다른 탭/검색/미사용/리셋의 의미는 보존.
- 접근성 한계: 실제 스마트폰 touch/가상키보드/스크린리더를 검수한 것이 아니다.
- 연결 작업: T05/T09.

기존 검수 이미지: 06 교재 재고 mobile 현재 화면 (당시 로컬 검수 자료; 저장소 배포 이미지에는 포함하지 않음).

## 최신 소스에서 확인한 추가 근거

소스 경로는 아래 고정 SHA 기준이다. 오래된 작업 폴더 파일의 현재 행 번호와 혼동하지 않는다.

| 파일 | 확인 내용 |
|---|---|
| `src/features/dashboard/dashboard-daily-brief.tsx:33–81` |3수치/조건부 일정/3바로가기, 날짜·loading 미노출 |
| `src/features/dashboard/use-dashboard-daily-brief.ts:45–48` |조회 실패 때 기존 brief null 처리 |
| `src/features/dashboard/daily-brief-contract.ts:19–29` |localDate/generatedAt/upcoming 구조 |
| `supabase/migrations/20260813192115_dashboard_daily_brief.sql` |오늘 scheduled 일정의 시간순 첫5개; 현재 이후 조건 없음 |
| `src/features/management/student-workspace.css:112–143` |student/class 한정 전역 셸 override |
| `src/components/data-table/data-table-surface.tsx` |공유 표/toolbar/44px header/48px row 존재 |
| `src/components/ui/form-dialog.tsx` |폼/상세/확인/문서 공통 규격 존재 |
| `src/app/globals.css:83`, `src/lib/fonts.ts` |Pretendard 스택; 조사한 소스에서 폰트 파일 공급 설정 확인 안 됨 |
| `src/features/dashboard/statistics-workspace.tsx:63–65` |갱신 시 전체 content 대체 |
| `src/features/dashboard/statistics-workspace.tsx:104–127` |분포를 중첩 카드/명단 버튼으로 표현 |
| `src/components/command-search.tsx:132–178` |현재 메뉴 검색; entity 검색은 후순위 확장 아이디어 |

[고정 SHA의 소스 보기](https://github.com/tipsedu2019/tips_dashboard/tree/bf504a7a0b336becec182b8f396b463056e6f204)

## 이번 결과의 한계

- 6개 화면 상태의 읽기/탐색 감사이며 모든 역할·경로·상세·저장 workflow를 승인한 결과가 아니다.
- 통계/폰트/비동기 실패는 코드로 확인한 설계 과제이며, 이번 운영 화면에서 실패를 재현한 것으로 쓰지 않는다.
- 대비값·실제 렌더 font·성능 LCP/INP/CLS·전체 WCAG 적합은 미측정.
- 보고서의 이미지는 현재 상태이며 추천 디자인의 완성 시안이 아니다.
- 구현 기준을 만들기 위해 [마스터 설계서](2026-09-12-premium-dashboard-master-plan.md)와 [작업 카드](2026-09-12-premium-dashboard-task-cards.md)를 함께 사용한다. 2026-09-15 정정으로 실제 출품 준비 T24는 취소했다.
