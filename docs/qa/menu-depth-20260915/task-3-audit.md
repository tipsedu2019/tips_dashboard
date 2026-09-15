# Task 3 학사 메뉴 현재 동작 감사 — 2026-09-15

판정: **캘린더 2개만 수정 대상으로 권고한다.** 나머지 메뉴에서 이번 합성 브라우저 검증으로 확정한 추가 결함은 없다. 미실행 분기는 아래에 명시하며 전체 업무 완료로 간주하지 않는다. 소스 변경/commit/build/server restart/외부 API 실제 쓰기는 하지 않았다.

## 실행과 증거

- 대상 checkout: `.worktrees/internal-dashboard-only-20260915`, 실제 Next 개발 서버 `http://127.0.0.1:3216`.
- Chromium Playwright, 고정 날짜 2026-09-15, 한국 locale/timezone, desktop 1440×900 / mobile 390×844.
- API 및 Supabase는 모두 합성 transport. 미정의 API는 HTTP 501 실패, 다른 외부 origin은 abort, WebSocket은 close, service workers block. 앱 서버에는 GET/HEAD만 허용.
- 공통 실행기: `/tmp/tips-academic-audit.mjs` (export `setup(route,width)` + `page/snap/close/fail/log`). 이 파일의 합성 row는 검증 중 확장되었다. 잘못된 초기 fixture/미정의 candidate RPC 결과를 제품 결함으로 채택하지 않았다.
- **캘린더 확정 결함 재현기:** `/tmp/tips-academic-calendar-repro.mjs`.
- 실행 Node: `/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`.
- 증거 폴더: `/tmp/tips-menu-review-20260915/academic/`. PNG와 대응 JSON에 DOM text, inputs/buttons, URL, requests, unhandled, runtime errors, overflow가 기록된다. 같은 route+width JSON은 마지막 실행으로 교체된다. 이전 상태 PNG는 유지된다.
- iframe/실제 모바일 기기/운영 사용자/운영 DB/저장 재조회/배포 검증은 아님. 일부 최초 route compile/auth 진입이 30초 timeout 발생하여 재시도했다. 이를 제품 성능 결함으로 분류하지 않았다.

## A1. [P2] 목록 일정의 상세 수정이 키보드로 열리지 않음

소유 파일/호출:

- `src/app/admin/academic-calendar/page.tsx` → `AcademicCalendarWorkspace`.
- `src/features/operations/academic-calendar-workspace.tsx:491` 이후 `<Calendar>` 호출.
- `src/app/admin/calendar/components/calendar.tsx:290` `handleEditEvent` → exact detail loader.
- **`src/app/admin/calendar/components/calendar-main.tsx:877-881`**: 목록 `Card`는 `onClick`만 있고 native button, role, tabIndex, keyboard activation이 없음.
- 같은 파일 `:910-916`: 카드 안의 별도 연간 보드 링크는 올바른 링크이므로 보존해야 한다.

재현:

1. 합성 9월 15–17일 시험기간 1건으로 캘린더 진입.
2. `목록` 클릭.
3. 일정 제목을 가진 `data-slot=card` DOM 검사: `DIV`, `role=null`, `tabIndex=-1`.
4. 카드 focus 시도 후 Enter → dialog 0개. 목록의 일정 상세를 여는 native button도 없음.
5. 같은 일정 제목을 pointer click → `학사 일정 수정` dialog와 제목/날짜/학교 데이터 표시.
6. Escape로 dialog 닫힘.

증거: `academic-calendar-1440-keyboard-before.png`, `academic-calendar-1440-pointer-detail.png`, JSON의 `keyboard-proof`. 이전 확인 이미지 `academic-calendar-1440-list.png`, `academic-calendar-1440-detail.png`도 있음.

최소 수정: 목록 카드는 시각적 컨테이너로 두고 제목/주 내용에 native `button type=button`을 제공한다. 연간 보드 링크와 버튼을 형제로 유지하여 interactive nesting을 만들지 않는다. 기존 exact detail loader 및 click 동작 재사용. Enter/Space가 pointer와 같은 상세를 열고 Escape 후 호출 버튼으로 focus가 복귀하는지 확인한다. custom hotkey 추가 금지. 이미 native button인 mobile 월간 목록(`calendar-main.tsx:525`)은 보존.

After: 아직 구현하지 않음. 위 재현기는 before 결함을 assert하므로 수정 후에는 keyboard open/focus-return assertion으로 전환해야 한다.

## A2. [P2] 달 이동 조회 실패 후 선택한 달과 남은 일정이 일치하지 않고 재시도 경로가 없음

소유 파일/호출:

- **`src/features/operations/academic-calendar-workspace.tsx:125-155`**: range 성공 여부 검사 후 `lastMonthRowsRef` 보존 데이터 반환.
- **같은 파일 `:419-425`**: 조회 오류 Alert에는 오류 텍스트만 있고 `refresh` 호출 버튼이 없음.
- `src/app/admin/calendar/components/calendar-main.tsx:282`: 로컬 `currentDate`.
- **같은 파일 `:413-415`**: `navigateMonth`가 즉시 currentDate 변경.
- 같은 파일 `:346-369`, `:855-863`: listEventGroups와 목록 표시.
- **같은 파일 `:957`**: 요청이 성공했는지와 독립적으로 currentDate를 제목에 표시.

재현:

1. A1과 같은 9월의 비어 있지 않은 목록 상태.
2. `get_operations_calendar_range_v1`만 합성 HTTP 503으로 전환.
3. `다음 달` 클릭.
4. 오류 Alert가 표시된 뒤 헤더는 `2026년 10월`, 목록은 `9월 15일 화요일`, `9월 16일`, `9월 17일` 그대로 남음. 사이드 미니 달력도 9월.
5. 화면의 `다시/재시도` 버튼 0개. 오류에서 같은 요청을 직접 다시 실행할 방법이 없다.

증거: `academic-calendar-1440-range-error-confirmed.png`, 이전 `academic-calendar-1440-range-error.png`, JSON range-error 상태. 실제 screenshot을 열어 제목/목록/오류/버튼 부재를 시각적으로 재확인함.

최소 수정: 마지막 성공한 표시 범위와 요청 범위를 분리하여 실패/갱신 중에도 제목과 일정이 같은 범위라는 점을 명확하게 유지한다. 오류 Alert에 조회 범위가 드러나는 복구 문구와 기존 `refresh()`를 호출하는 `다시 불러오기` 버튼을 둔다. 보존 데이터 삭제나 전체 화면 초기화는 피한다. 외부 캘린더 호출자 호환성을 유지하도록 controlled displayed-range의 optional prop 또는 실패 시 확인된 날짜 동기화를 좁게 도입한다. 캘린더 자체 월간/목록, 미니 달력, selectedDate, recovery 7일 범위까지 함께 검증한다.

After: 아직 구현하지 않음. 후속 검증은 9월 성공→10월 지연→실패→동일 범위 retry 성공, reverse responses, Escape/focus, 390px을 포함한다. 단순히 목록에서 오래된 날짜를 필터로 숨기면 실제 조회 실패를 빈 달로 오인하므로 충분한 해결이 아니다.

## 메뉴별 실행 건강도와 남은 범위

| 메뉴 | 이번 실행한 실제 단계 | 판정 / 보존 | 미실행 또는 증거 한계 |
|---|---|---|---|
| 학사일정 캘린더 | 1440px 비어 있지 않은 월간→목록, 검색 `zzzz`→0건→검색 비우기 복구, exact detail 열기→Escape, 새 일정→빈 제목 제출 validation, 다음 달 조회 failure | A1/A2만 수정. 검색 지우기와 validation은 동작함 | 달력 390px 실행, 저장 실패 draft 보존, 저장 성공 재조회, 7일 density recovery는 미실행 |
| 학교 연간 일정표 | 390px 9/15~9/17 셀→상세 hover, 중등→0건, 고등 복구, 2학기 필터. 1440px 같은 셀→수정→exact detail dialog→Escape | 이번 범위 추가 결함 없음. 셀의 명시적인 수정 경로와 필터 유지 보존 | 학교 다중 선택/연도 RPC failure/retry, 실제 export, 저장/삭제 미실행. fixture summary를 생략한 `첫 일정 추가` 문구는 실제 결함 아님 |
| 시간표 | 390px 교사 1명/90분 긴 수업명 실제 grid, 선생님 주간→강의실 주간→일별 선생님, 개강 준비→0건, reset 클릭 | 추가 결함 **확정하지 않음**. 내부 grid 스크롤 및 0px 문서 overflow 확인 | reset 이후 0건 유지 관찰이 있으나 fixture의 classGroup/academicYear 관계가 producer와 충분히 일치하지 않으므로 결함으로 채택 금지. producer-complete fixture로 재검증 필요. desktop run은 auth 준비 화면 timeout; 오류/retry·이미지 export 미실행 |
| 수업계획 (`curriculum`) | 1440px 실제 2행, 390px 실제 2카드, 검색→0건→`모든 수강 수업 보기` 복구, 첫 수업 action→query 기반 lesson-design modal | 검색/복구와 다음 작업 링크 정상. 보존 | 수업 상태의 모든 탭/RPC error/retry/pagination beyond 1 미실행. 가공 진도 숫자는 fixture값이므로 business invariant 검증 아님 |
| 수업 설계 (`curriculum/lesson-design`) | 390px 전용 route, 9월 13회차 생성/교재 1권/저장 범위 1회차. 진도 생성 view. 첫 회차 클릭→`1회차 진도 입력` dialog (시작1/종료2/저장 범위)→Escape | 중첩 회차 편집 진입과 cancel 정상. 긴 13회차에서 document overflow 0. 추가 결함 없음 | 입력 변경 후 적용/취소 비교, dirty return guard, 저장 실패/재시도 미실행. return 클릭 직후 600ms screenshot은 navigation 완료 증거가 아니므로 복귀 성공으로 판정하지 않음 |
| 수업일정 (`class-schedule`) | 390px 합성 1개 목록/진도 미조회 표시. `수업 설계` native link→실제 `/admin/curriculum/lesson-design?...returnTo=/admin/class-schedule` 전용 route, 9월 13회차 표시 | 링크의 실제 목적지 일치. 별도 추가 결함 없음 | class search/filter/zero/reset 및 selected official detail, saves/failure 미실행. 초기 900ms screenshot 이전 route 상태는 늦은 route 전환이며 결함 아님 |

## 나머지 메뉴 소유 코드

- 연간 보드: `src/app/admin/academic-calendar/annual-board/page.tsx` → `src/features/operations/academic-annual-board-workspace.tsx`; cell `:643`, model `:1105`, exact entry edit `:1320` 부근, filters `:1630` 이후, EventForm 공유.
- 시간표: `src/app/admin/timetable/page.tsx` → `src/features/academic/timetable-workspace.tsx`; data/model `:191-269`, local filters `:283-332`, reset `:375-382`, error/retry `:415-423`, controls `:445-602`, zero/grid `:606` 이후. `src/features/academic/records.js:1347` 실제 precomputed row consumer.
- 수업계획: `src/app/admin/curriculum/page.tsx` → `src/features/academic/curriculum-workspace.tsx`; query/return href `:99-174`, workspace `:276`, row action `:583`, error/retry `:607`, zero/reset `:656-665`, mobile/desktop row actions `:679/:724`.
- 수업일정/수업 설계: `src/app/admin/class-schedule/page.tsx`, `src/app/admin/curriculum/lesson-design/page.tsx:3-11`이 동일 `src/features/operations/class-schedule-workspace.tsx` 사용. exact detail read `:2849-2860`, owner/draft `:3150-3305`, save `:4499-4561`, list `:6730-6782`, page/modal `:6950` 이후, 회차 progress dialog `:7074` 부근.

## 후속 구현 전 제한

이번 감사에서 채택 가능한 결함은 A1/A2 두 개다. 나머지 관찰은 개선 할당량을 채우기 위한 수정 근거가 아니다. 특히 시간표의 합성 group mismatch, 교재 후보의 초기 미정의 501, 늦은 dev route 전환을 실서비스 UX 결함으로 혼동하지 않는다. 실제 저장·data calculation·auth/RLS/ACL·no-send는 변경하지 않는다.
