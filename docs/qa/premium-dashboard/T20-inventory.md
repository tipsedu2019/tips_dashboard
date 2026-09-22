# T20 — 잔여 경로의 적용 및 검수 기록

2026-09-15 현재 worktree 소스 기준. 이번 범위는 각 실제 경로의 공통 셸·주 행동·필터·빈 상태 확인과 발견한 표현 문제의 수정이다. 고밀도·상태 전이·실제 저장 전체 검증으로 확대해 해석하지 않는다.

## 적용

최상위 feature/page 소유자에서 `px-4 sm:px-5 lg:px-6`로 모바일16/중간20/desktop24를 맞췄다. 전역 선택자나 중복 wrapper를 추가하지 않았다. 대상은 dashboard, academic-calendar, annual-board, timetable, OpsTask의 최상위 WorkspaceTabs만, makeup, recruiting/CMS 및 권한 확인 placeholder다. settings는 기존 SettingsWorkspaceShell이 이미 동일한 기준이므로 중복 여백을 추가하지 않았다.

브라우저에서 휴보강 신청창을 Escape로 닫으면 포커스가 사라지는 문제를 재현했다. 실제 opener를 기억하고 Dialog의 onCloseAutoFocus로 복원하며, 재상신 등에서 원래 opener가 사라지거나 숨겨졌으면 `휴보강 신청` 버튼으로 복귀한다. 기존 draft 확인·saving 차단·상신 경로는 유지했다.

## 경로별 증거

합성 데이터, 로컬 dev3216, Chromium,1440×900/390×844. 모든 API/Supabase 요청은 fixture 처리, 그 외 외부 요청과 WebSocket은 차단했다. 실제 쓰기·provider 발송 없음.

기본 screenshot/상호작용 manifest: `/tmp/tips-premium-dashboard-20260915/remaining-verified/manifest.json`. 파일은 `A-academic-calendar-1440.png`, `A-academic-calendar-390.png` 형식이며 하위 경로의 `/`는 `-`로 바꾼다; 키보드 조작 후 파일은 `-interaction.png`. 재현 스크립트 `/tmp/tips-premium-remaining-browser.mjs`는 root QA 스크립트의 임시 복사본에 계약별 빈 응답과 identity-only 수업1개를 더했다. 원본 fixture 파일은 변경하지 않았다.

| 경로 | 주 행동 및 확인 상태 | 실제 조작 | 적용/검증 범위 |
|---|---|---|---|
| /admin/academic-calendar | 월간/목록, 일정 없음 | 목록 버튼 Enter | 날짜/오늘/이전·다음 기존 위치 유지; 목록 pagination 미추가 |
| /admin/academic-calendar/annual-board | 연도·학교 분류, 조건에 맞는 일정 없음 | 중등 버튼 Enter | 연간 일정표 고유 구조·내보내기 유지; 인쇄 스타일 변경 없음 |
| /admin/timetable | 담당·강의실 보기, 기간 없음 | 강의실 주간 Enter | 기존 보기/필터 구조 재사용; 날짜 계산 변경 없음 |
| /admin/transfer | 전반 신청, 전반 없음 | 오늘 기간 버튼 Enter | shared OpsTask의 outer wrapper만 변경 |
| /admin/withdrawal | 퇴원 신청, 퇴원 없음 | 오늘 기간 버튼 Enter | deep link/전이/날짜 계산 보존 |
| /admin/word-retests | 대상 추가, 재시험 없음 | 별관 버튼 Enter | role/branch/period URL 및 기존 추가 동작 보존 |
| /admin/makeup-requests | 휴보강 신청, 신청 없음 | 신청창 열기→Escape→opener 복원 | 포커스 보정 후 별도1440/390 재검증 통과 |
| /admin/recruiting | 새로고침, 지원서 없음+retention 경고 | 새로고침 Enter | 합성 retentionLastSucceededAt=null로 경고 확인; 실제 운영 자동파기 상태 증거 아님 |
| /admin/public-content | 선생님 추가, 자료 없음 | 추가→Escape→opener 복원 | 기존 CMS draft/공개/업로드 경로 보존; 실제 자료 가져오기 미실행 |
| /admin/class-schedule | identity-only 수업, 진도 미조회 | 상세 href·키보드 focus·중첩 anchor0 | T15 source/표현 경계는 T15.md 참고 |
| /admin/dashboard | 합성 오늘 일정3종 | 경로 렌더 smoke | 별도 remaining-shared/manifest.json1440/390 |
| /admin/tasks | 기존 todo 업무, 빈 목록 | 경로 렌더 smoke | shared OpsTask 적용 영향; 별도 remaining-shared/manifest.json1440/390 |

위11경로22캡처는 unhandled fixture0, pageerror0, console error0, document overflow0. dashboard/tasks4캡처도 동일. 휴보강 최종 포커스 재검증은 `/tmp/tips-premium-dashboard-20260915/remaining-focus/manifest.json`: 양쪽 너비에서 openedDialog/escapeClosed/focusRestored 모두true. 앞선 remaining-verified의 휴보강 focusRestored=false는 수정 전 재현이며 최종 결과가 아니다.

최초 `remaining/manifest.json`의 science subject/classroom/academic-event501은 fixture 누락이었다. 실제 계약대로 빈 응답을 추가한 재검증에서 해소했다. 제품 장애로 집계하지 않는다.

## 실제 활성 경로와 redirect 분리

현재 `src/app/admin/**/page.tsx`44개 중 render25개, redirect19개다. 과거 inventory의 users/terms/connections/manual은 활성 화면이 아니므로 복원하지 않았다.

활성25개 (2026-09-22 전자결재·수업그룹 폐기 반영):

- 운영: dashboard, statistics, tasks, registration, transfer, withdrawal, word-retests, makeup-requests.
- 학사: academic-calendar, academic-calendar/annual-board, timetable, class-schedule, curriculum, curriculum/lesson-design.
- 관리: students, classes, textbooks, recruiting, public-content.
- 설정: settings/schools, settings/classrooms, settings/teachers, settings/subjects, settings/textbook-suppliers, settings/notifications.

모든 이름의 prefix는 `/admin/`. 설정6경로는 관리/통합 검수 소유이며 이번11경로 evidence로 대신하지 않는다. students/classes/textbooks/statistics/registration/curriculum도 각 카드 evidence를 사용한다.

redirect19개: `/admin`, `/admin/settings`, 그리고 `/admin/` 아래 calendar, chat, class-schedule/lesson-design, classrooms, dashboard-2, faqs, mail, manual, pricing, schools, settings/account, settings/appearance, settings/billing, settings/connections, settings/user, teachers, users. `/admin/settings/users`는 존재하지 않는다.

## 검사와 남은 경계

- calendar/timetable/class-group/approval/makeup/recruiting/public-content 관련 집중 테스트134건 통과. makeup의 old gutter source assertion은16/20/24 계약으로 수정했다.
- 수정 파일 ESLint0 errors. timetable257의 불필요한 useMemo dependency 경고1건은 수정 전에도 존재하며 이번 데이터/성능 범위 밖이다.
- actual route 빈 상태·공통 제어와 대표 읽기 동작은 확인했다. 데이터가 많은 표·각 업무의 전체 전이·실패/재시도 matrix·설정6경로 독립 증거는 이 기록의 완료 주장에 포함하지 않는다. UI 회귀 evidence와 실제 운영 데이터/배포 evidence는 별도다.
