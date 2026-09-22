# 휴보강 반영·청강 회차 점검

2026-09-22, 기준 코드 `b0f16bf5` (`origin/main`). 운영 Supabase와 `tipsedu.co.kr`의 인증된 화면을 읽기 전용으로 확인했다. 기존 작업 폴더는 뒤처져 있어 별도 worktree에서 수정했다.

## 1. 9/26 보강

- 중2B+2의 10/10 휴강 → 9/26 11:00–13:00 본관 3강 보강은 승인되어 `classes.schedule_plan`에 생성되어 있었다. 승인 시각은 9/22 17:08 KST다.
- 같은 날짜에는 추석 휴강으로 지정된 기존 회차와 10월 회차에서 이동한 보강이 함께 있다. 두 회차는 서로 다른 업무 사실이며 중복 보강이 아니다.
- 운영 수업계획 달력의 실제 표시는 `2026-09-26 휴강`, 본문은 `휴강 / 추가 1건`이었다. 달력이 보강 이외의 회차를 대표로 고르고 나머지 상태를 숨기고 있었다.
- 비교한 중2A의 10/5 → 9/26 15:30–17:30 본관 10강 보강도 저장되어 있다.

수정: 대표 회차와 달력 클릭·저장 동작을 유지하면서, 추가 회차의 번호와 상태를 표시한다. 접근 가능한 날짜 이름에도 모든 상태를 포함한다. 일정 데이터 재생성이나 재승인은 필요하지 않다.

## 2. 준우의 초6 청강

- 준우의 수학 등록 건은 상담 완료 상태이며 청강 예약 편집이 가능했다.
- `초6 중등과정반`은 `status='종강'`, `closed_at=null`, 저장된 회차 0개였다. 이 반이 청강 반 선택 목록에 노출되어 선택하면 회차 메뉴가 빈 상태가 되는 것을 운영 화면에서 재현했다.
- `초6 중등과정반1`은 운영 중인 반이다. 실제 화면에서 `9월 23일 (수) 오후 03:30 · 강정은 · 본관 10강`을 선택하고 예약 저장 버튼이 활성화되는 것까지 확인했다. 저장하지 않았다.
- 읽기 전용 트랜잭션에서 해당 상담 담당자의 인증 역할로 운영 RPC를 호출했을 때에도 초6 1반과 초6 중등과정반1의 미래 회차가 정상 반환됐다.
- 제보 당시 어느 반을 선택했는지에 대한 기록은 없으므로, 종강반 선택이 제보의 원인이었는지는 추정이다. 종강반 노출 결함과 그 선택 시 빈 목록은 직접 확인했다.

수정: `closed_at`에 더해 기존 `academic_class_status_v1`의 종강 판정을 적용한다. 관리 상세의 반 선택지, 회차 목록, 신규 예약의 회차 해석 함수에 같은 조건을 적용한다. 종강반의 이전 청강 이력·출결·피드백 조회를 변경하지 않는다. 오래된 종료일보다 명시적인 수강 상태가 우선하는 기존 기준도 유지한다.

## 검증

- 실제 운영 데이터·화면: 위 두 증상 재현 및 정상 청강 반 선택 확인. 실제 승인·예약·알림 발송은 수행하지 않았다.
- 달력 회귀 테스트: 수정 전 `26휴강휴강추가 1건`으로 실패, 수정 후 휴강·보강 이름과 접근성 이름을 모두 확인. 두 일정 유지, 저장 요청 0건, 미저장 변경 없음도 검증했다.
- Node 관련 테스트 78/78 통과: `class-schedule-draft-navigation`, `class-schedule-planner-calendar-toggle`, `makeup-continuous-class-schedule`, `registration-observation-service`, `registration-observation-workspace`.
- 격리 Supabase: 검토된 baseline과 정렬된 최신 migration 전체를 적용한 뒤 pgTAP 82개 통과. 신규 lifecycle 8개, 기존 booking 47개, status independence 27개다. 수정 전 lifecycle 테스트는 4/8 실패했다. 종강반의 목록·예약 해석 거부 SQLSTATE는 `P0002 / registration_observation_not_found`로 검증했다.
- `tsc --noEmit --incremental false` 통과.
- 브라우저 시각 비교: 실제 컴포넌트를 회귀 테스트의 합성 데이터로 렌더링한 DOM과 실제 공통 CSS를 사용해 같은 데스크톱 조건의 수정 전후를 비교했다. 390px에서는 기존 모바일 목록이 휴강과 보강을 각각 표시하며 넘침이 없음을 확인했다. 이는 로컬 렌더링 증거이며 배포 증거가 아니다.

## 기존 검증 실패

`tests/lesson-design-page.test.mjs`는 이번 수정 전 `b0f16bf5`에서도 동일한 12개가 실패했다. 두 버전 모두 해당 파일은 16개 통과·12개 실패다. 최근 일정 편성 전용 화면 변경과 예전 소스 형태를 검사하는 테스트 사이의 불일치이며 이번 점검에서는 관련 없는 화면·테스트를 변경하지 않았다.

실패 이름:

- lesson design page keeps schedule controls direct and non-duplicative
- lesson design session timeline connects through centered markers
- lesson design keeps every generated month visible while focusing one month
- lesson design connects textbooks before assigning session ranges
- lesson textbook UI limits both candidates and filter options to the class subject
- lesson design ranks class-fit textbooks and keeps session range entry manual
- lesson design keeps return action reachable in the bottom save bar
- lesson design keeps textbook finder filters separate from explicit connected-book ranges
- lesson design splits schedule generation from progress generation
- lesson design keeps navigation, recovery, and save actions stable
- lesson design opens progress from the selected session without a secondary editor
- lesson design presents compact filters, selected rows, and mobile-safe sessions

기존 `registration_observation_legacy_schedule_slots_test.sql`도 새 migration이 비어 있던 최초 baseline 실행에서 4개 검사 후 `22023 / registration_observation_session_time_ambiguous`로 중단됐다. 이 테스트 원본은 그대로 두고, 슬롯 계산과 독립적인 lifecycle 회귀 테스트를 추가했다. 위 82개 통과가 이 기존 테스트의 통과를 의미하지는 않는다.

## 반영 범위

로컬 수정과 검증까지 완료했다. 운영 DB에 migration을 적용하거나 코드를 배포하지 않았다. 운영 반영에는 프런트엔드 배포와 `20260922095634_exclude_closed_observation_classes.sql` 적용이 필요하다. 실제 청강 예약·안내 발송은 담당자가 별도로 수행해야 한다.

Vercel MCP의 배포 목록 조회는 403으로 거절되어 이번 작업에서 운영 배포 SHA는 확정하지 않았다. 운영 증상은 실제 브라우저 및 DB 결과로 확인했다.
