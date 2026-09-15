# T20 — 남은 경로별 적용 카드

현재 소스 기준 inventory. 브라우저 검증 결과는 후속 통합 검수에서 각 행에 연결한다. 아직 확인하지 않은 화면은 합격으로 표시하지 않는다.

| 화면 | 경로 | 소유 파일 | 주 행동 | 복잡한 상태 | 제약 |
|---|---|---|---|---|---|
| 학사일정 | /admin/academic-calendar | src/features/operations/academic-calendar-workspace.tsx | 일정 선택·추가 | 기간조회 실패의 이전달력 유지 | 달력 고유 구조; 목록 페이지 규칙 미적용 |
| 시간표 | /admin/timetable | src/features/academic/timetable-workspace.tsx | 시간표 편집 | 요일별 담당·강의실과 편집 초안 | 시간표 고유 구조; 기존 날짜 제어 점검 |
| 전반 | /admin/transfer | src/features/tasks/ops-task-workspace.tsx | 전반 신청 | 과목·일정·상태 전이 | shared OpsTask; 등록과 동시 파일 수정 금지 |
| 퇴원 | /admin/withdrawal | src/features/tasks/ops-task-workspace.tsx | 퇴원 신청 | 학생 deep link·날짜 선택 | shared OpsTask; 도메인 계산 보존 |
| 휴보강 | /admin/makeup-requests | src/features/makeup-requests/makeup-request-workspace.tsx | 휴보강 신청 | 확정·실패·필터 적용 | WorkspaceTabs/공통 Dialog 유지 |
| 전자결재 | /admin/approvals | src/features/approvals/approval-workspace.tsx | 문서 작성 | 초안/반려/회수 | 현재 문서 workflow 유지 |
| 단어 재시험 | /admin/word-retests | src/features/tasks/ops-task-workspace.tsx | 대상 확인·결과 처리 | 조교 역할과 기간 | role/branch/period/from/to URL 보존 |
| 설정 | /admin/settings/schools | src/features/management/management-page.tsx | 항목 수정 | 저장 실패 및 재조회 실패 | 공통 관리 화면; 관리 agent와 소유권 조율 |

## 경로별 구현 순서

1. 각 실제 경로를 합성 fixture로 1440/390 렌더하고 주 행동 위치와 복잡한 상태를 확인한다.
2. 공통 셸 적용 결과로 이미 해소된 부분은 재구현하지 않는다. 모바일 페이지 gutter16, 중간20, desktop24를 실제 최상위 소유자에서 맞춘다.
3. 각 화면의 날짜·검색·주 행동·탭·표 및 상세에서 남는 차이만 해당 파일에 작은 변경으로 적용한다. 설명/보조 카드나 새 요약을 추가하지 않는다.
4. 순수 표현 외 변경이 필요하면 이유를 이 문서에 남기고 기존 상태·저장·권한 보호를 테스트한다.
5. 설정의 실제 활성 경로는 schools/classrooms/class-groups/teachers/subjects/terms/textbook-suppliers/users 및 notifications/connections 등 현재 navigation을 기준으로 한다. `/settings/account`, `/settings/appearance` 등 redirect-only 템플릿을 새 제품 화면으로 되살리지 않는다.

별도 페이지 inventory에서 recruiting, manual, homepage management 등 유지되는 활성 화면도 smoke coverage에 포함한다. redirect와 실제 렌더 페이지를 분리해 집계한다.
