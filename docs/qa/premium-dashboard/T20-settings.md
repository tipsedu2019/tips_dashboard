# T20 — 설정·커리큘럼 실제 경로 검증

2026-09-15 최종 로컬 production 서버 `http://127.0.0.1:3215`(빌드 source `1d231495`, 마지막 UI 변경 `fdb05f66`)에서9경로 ×1440/390 =18회 모두 통과했다. `scripts/qa/premium-settings-browser.mjs` 재실행 가능. 이번 커밋은 QA 문서·스크립트만 추가하며 제품 소스를 변경하지 않는다.

## 소스 및 fixture 계약

| 실제 경로 (/admin prefix) | 실제 owner | 합성 내용·조회 계약 |
| --- | --- | --- |
| settings/schools | management/school-master-workspace.tsx | academic_schools 전체 목록, 학교1개 |
| settings/classrooms | management/classroom-master-workspace.tsx | classroom_catalogs 전체 목록, 강의실1개 |
| settings/class-groups | management/class-group-master-workspace.tsx | class_schedule_sync_groups bounded 목록, 그룹1개 |
| settings/teachers | management/teacher-master-workspace.tsx | teacher_catalogs1명, profiles/audit_logs 빈 결과, Google Chat identity snapshot의 명시 not_configured 상태 |
| settings/subjects | management/subject-master-workspace.tsx | strict `list_registration_subject_capabilities_v1` 영어/수학/과학3개, 유효 timestamp·학년 포함 |
| settings/textbook-suppliers | textbooks/textbook-supplier-settings-workspace.tsx | strict publisher/supplier numbered page, 각각1개; 기본 출판사 → 총판 탭 전환 후 합성 총판 확인 |
| settings/notifications | notifications/notification-settings-workspace.tsx | runtime version1, settings UI flag=false의 명시 준비 전 안내 |
| curriculum | academic/curriculum-workspace.tsx | strict curriculum numbered DTO1개, 교재 미연결/회차 미생성 class·counts·facets 일치 |
| curriculum/lesson-design?classId=… | operations/class-schedule-workspace.tsx | purpose-specific lesson detail의 실제 classItem1개, runtime1, bounded class schedule sessions=[], textbook candidates=[] |

owner 경로의 prefix는 `src/features/`. curriculum fixture는 `tests/academic-operations-numbered-service.test.mjs`의 DTO 계약을 따르되 수업1개·진도0·교재 미연결로 구성했다. lesson-design의 수업 없는 bare route를 비어 있지 않은 상세 화면 증거로 대신하지 않았다.

## 확인 결과

-18회 모두 기대한 이름/입력값 또는 명시 준비 전 안내가 렌더됐다. document 가로 넘침0, page runtime error0, 미정의 API 요청0.
- 학교/강의실/그룹/선생님 추가 버튼은1440/390에서 enabled 상태·직접 keyboard focus를 확인했다. 버튼 실행이나 저장은 하지 않았다. 교재 설정은 출판사에서 총판으로 탭을 실제 전환했다.
- 학교390, 수업설계390, 총판1440 screenshot을 직접 검토했다. 모바일 학교 카드와 버튼의 focus ring, 수업 설계의 제목·탭·교재 연결 필요 상태, 총판 표·페이지 제어가 확인됐다.
- 모든 인증·조회는 합성 응답이다. 외부 URL/미정의 API는 차단하고 앱 서버로는 GET/HEAD만 통과시킨다. provider 활성화·고객 발송·실제 DB 변경은 없다.
- 최초 fixture 누락(teacher identity API, 기본 publisher 탭, lesson classId/runtime/schedule RPC)을 실제 계약에 맞게 보완한 뒤 전체18개를 재실행했다. 초기 실패는 제품 장애로 집계하지 않았다.

## 증거와 범위

- 결과: `/tmp/tips-premium-dashboard-20260915/settings/results.json`.
- 이미지: 같은 폴더의 `settings-schools-390.png`, `settings-textbook-suppliers-1440.png`, `curriculum-lesson-design-390.png` 등을 포함한18개.
- route rendering·일부 대표 제어의 포커스·tab 이동·명시 unavailable/empty subordinate state를 확인한 증거다. 전체 CRUD/재정렬/설정 저장, 알림 enabled 규칙 편집, 수업 생성·진도 저장, 각 경로500/재시도/focus matrix는 수행하지 않았다. 기존 domain tests·운영 데이터·배포 증거와 구분한다.
