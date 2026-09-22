# 시간표 리뉴얼 · 수업그룹/기간 필터 종료

기준: origin/main `5d84b87b991b749bb2ab990c6a6325b536747f0e`. 수업관리의 공용 Button/Select, WorkspaceTabs, DataTableFilterPanel을 재사용했다. 공유 토큰을 새로 정의하지 않았다. 기존 시간표 색상과 행렬 예외를 유지한다.

## 동작

- 수업그룹 설정, `/admin/settings/class-groups`, `/admin/settings/terms`, `/admin/terms`, 전용 편집기·저장 서비스와 기본 학기 localStorage 리더를 제거했다.
- 수업관리/수업계획은 이미 기간 없는 조회를 사용한다. 시간표도 저장된 기간과 기본 그룹을 무시하며 `수강 · 개강 준비 · 종강`으로 조회한다. 이력 날짜 검색 및 회차/정산 기간은 별개다.
- 최종 timetable RPC에서 기본 그룹 선택, 그룹 조건 및 수업 시작/종료일과 현재 주의 교차 조건을 제거했다. 날짜 인자와 검증은 API 호환성을 위해 유지한다. 따라서 미래 개강·과거 종강 수업의 주간 시간표도 상태로 선택할 수 있다.
- 오래된 그룹 메타데이터는 빈 배열로 반환한다. DB의 원본 그룹·관계와 다른 업무의 역사 데이터/API는 보존한다. RPC의 invoker/RLS, ACL, 명시적 scalar projection, 2,000행/500개 지원 항목 제한은 유지한다. 외부 발송 없음.
- 모바일 단일 열, 데스크톱 1/2단 비교, 네 가지 보기, 검색/다중 선택, 공통 시간축, 전체 수업명 키보드/터치 확인, 이미지 내보내기를 유지한다.

## 검증

- 관련 Node 테스트 127개 통과; 마지막 UI 정리 후 시간표 집중 테스트 24개 재통과.
- 공유 UI, 학사 페이지 전환, 기존 운영 화면, query budget 회귀 387개 통과.
- 독립 DB에서 `timetable_continuous_class_scope_test.sql` 12개와 `academic_scoped_reads_test.sql` 44개 통과, DB lint 통과. fixture 기본 그룹 충돌과 종강 seed guard를 수정한 뒤 세 번째 실행으로 통과했으며 final-only manifest로 재실행해 통과했다. `42501`, `22023` 오류 코드를 최종 함수에서 확인했다.
- TypeScript, Next webpack production build, 변경 소스 ESLint, migration layout 검증 통과.
- 브라우저: 1440×964 / 390×844, 합성 데이터와 가짜 로컬 인증 사용. 실제 앱을 렌더링하고 fixture 서버가 모든 데이터 호출을 로컬 처리하며 외부로 전달하지 않는다.
- 네 가지 보기, 세 상태 선택, 대상 다중 선택, 모바일 패널/팝오버 중첩, Escape 닫기와 trigger 포커스 복귀, 빈 결과, 조회 실패/이전 결과 표시/재시도 확인.
- 이미지 내보내기: 모바일에서 실제 생성된 `김선생-시간표 (1).png`(1773×1737)를 확인했다. 전체 7요일과 마지막 수업까지 포함되며 `export-mobile.png`에 보관했다. 브라우저 download 이벤트 대기는 시간 초과였으나 실제 파일 생성과 내용을 별도로 검증했다.
- `/admin/settings/class-groups` 직접 진입 시 404를 확인했다.
- 모바일 body/document 폭 모두 390px. 내부 시간표만 가로 스크롤한다. 변경 전후 스크린샷은 동일 fixture와 뷰포트를 사용한다.

## 범위

로컬 구현 및 검증이다. 운영 DB에 migration을 적용하거나 운영 사이트를 배포하지 않았다. 전자결재 삭제(PR #59)와 업무 병목 대시보드(PR #58)는 별도 변경이며 본 브랜치의 기준 main에는 아직 포함되지 않았다.
