# 등록 청강 예약·피드백 워크플로 설계

**작성일:** 2026-08-09

**상태:** 대화 설계 승인 · 문서 검토 대기 · 구현 계획 작성 전

**기준 브랜치:** `origin/main@150cbed0`

**관련 기존 설계:**

- `2026-08-05-registration-solapi-customer-messages-design.md`
- `2026-08-08-registration-customer-reminder-automation-design.md`
- `2026-08-08-registration-message-subject-admission-details-design.md`
- `2026-08-09-supabase-recurrence-prevention-design.md`

## 1. 목표

등록의 `등록 신청` 직전에 선택적 `청강 신청` 과정을 추가한다. 상담 완료 뒤 원장이 반 배정을 확신하기 어려울 때 실제 정규 수업 회차에 학생을 청강시키고, 고객 안내, 과목팀 준비, 담당 선생님 평가, 원장 최종 결정을 하나의 과목별 이력으로 연결한다.

1. 청강 예약·변경·취소를 레벨테스트·방문상담과 같은 예약 품질로 관리한다.
2. 고객에게 청강 예약 안내를 미리보기·확인 후 한 번 발송하고, 청강 3시간 전에 리마인드를 자동 발송한다.
3. 해당 과목 Google Chat 방에 예약 직후, 시작 3시간 전, 종료 30분 후 필요한 알림을 보낸다.
4. 담당 선생님은 참석 여부와 `적합/부적합 + 사유`를 제출하고, 원장은 이를 확인한 뒤 등록·대기·미등록·재청강을 결정한다.
5. 청강 후 등록으로 이어지면 적합 청강일을 첫 수업일 기본값으로 제안하되, 원장이 최종 날짜를 직접 선택한다.
6. 미등록 청강은 수납·선납·환불 데이터를 전혀 만들지 않는다.
7. 달력과 목록에서 청강을 독립적으로 찾되, 첫 화면의 Supabase 부하를 늘리지 않는다.

## 2. 범위와 비범위

### 2.1 포함

- 과목별 청강 상태와 여러 차례의 청강 이력
- 정규 수업 반·정확한 수업 회차·담당 선생님 연결
- 등록 목록의 `청강 신청` 보기와 등록 달력의 `청강` 필터
- 고객용 청강 예약 안내와 3시간 전 자동 리마인드
- 과목방 Google Chat 준비·당일·피드백 요청 알림
- 담당 선생님 평가와 원장 최종 결정
- 등록 신청 시 청강일 기반 첫 수업일 제안과 원장 최종 선택
- 저장, 발송, 평가, 최종 결정의 감사 이력과 중복 방지

### 2.2 제외

- 청강비 또는 별도의 결제·수납 원장
- 청강 후 미등록 건의 선납·환불 기록
- MakeEdu 학생·반·등록 상태 대조 또는 자동 동기화
- MakeEdu 결제·환불 자동화
- Google Chat 안에서 평가 사유를 입력하거나 표시하는 기능
- 교사 평가만으로 등록 상태를 자동 결정하는 기능
- 과거 청강 기록의 일괄 backfill

등록·전반·퇴원은 Dashboard에서 시작하고 완료 전에 관리팀이 기존 MakeEdu 체크리스트를 확인하는 현재 경계를 유지한다. 별도 대조 기능은 만들지 않는다.

## 3. 검토한 접근법

### 3.1 기존 예약 구조 확장 + 청강 전용 원장 — 채택

`ops_registration_appointments`에 청강 종류를 추가하고, 반·수업 회차·출석·피드백을 보유하는 청강 전용 행을 연결한다.

- 장점: 예약, 변경, 취소, 달력, revision, 리마인드, 감사 패턴을 재사용할 수 있다.
- 장점: 청강을 enrollment로 가장하지 않아 입학·반 명단이 조기에 생성되지 않는다.
- 장점: 한 학생의 재청강과 과목별 상태를 정확히 분리한다.
- 단점: 기존 예약·고객 메시지·내부 알림 계약을 함께 확장해야 한다.

### 3.2 청강 독립 예약 시스템 — 미채택

청강 일정부터 알림까지 별도 테이블과 워커로 만든다.

- 장점: 도메인 경계가 가장 독립적이다.
- 단점: 예약·달력·취소·리마인드·감사 로직을 중복 구현해 장애 지점과 운영 비용이 늘어난다.

### 3.3 기존 상태·댓글·체크리스트만 활용 — 미채택

- 장점: 구현량이 작다.
- 단점: 실제 수업 회차, 담당 교사 권한, 재청강, 예약 변경, 중복 알림, 구조화된 적합성 결과를 보장할 수 없다.

## 4. 사용자 흐름

### 4.1 목록 순서

등록 목록의 보기는 다음 순서를 사용한다.

`문의 → 레벨테스트 신청 → 상담 신청 → 상담 완료 → 대기 신청 → 청강 신청 → 등록 신청 → 입학 진행 → 완료`

`청강 신청` 보기는 다음 내부 상태를 한곳에 모은다.

- 예약 필요
- 청강 예약
- 교사 피드백 대기
- 청강 완료
- 취소·노쇼 이력

### 4.2 진입과 종료

- 원장은 상담 완료 또는 대기 상태의 과목에서 `청강 진행`을 선택할 수 있다.
- 청강은 선택 과정이다. 상담 완료에서 등록 신청으로 직접 가는 기존 경로를 유지한다.
- 한 청강은 학생 전체가 아니라 하나의 `subject track`에 속한다.
- 영어와 수학 청강은 각각 독립한 예약, 메시지, 피드백, 결과를 가진다.
- 같은 과목에서 여러 차례 청강할 수 있으며 시도별 이력을 삭제하지 않는다.
- 피드백 제출은 `observation_completed`까지만 이동한다. 등록 신청, 대기, 미등록, 재청강 중 다음 단계는 원장이 직접 선택한다.

### 4.3 상태 전이

과목 workflow에 다음 상태를 추가한다.

- `observation_requested`: 청강 결정, 예약 필요 또는 예약 완료
- `observation_feedback_pending`: 실제 참석 후 담당 선생님 평가 대기
- `observation_completed`: 평가 제출 또는 노쇼 처리 후 원장 결정 대기

전이는 다음 원칙을 따른다.

1. `consultation_completed | waiting_* → observation_requested`
2. 예약 저장은 상태를 유지하고 예약 원장을 추가한다.
3. admin/staff가 참석만 먼저 확인하면 `observation_feedback_pending`으로 이동한다. 담당 교사 또는 admin/staff 대리 입력자가 평가까지 함께 제출하면 이 중간 상태를 건너뛸 수 있다.
4. 참석과 피드백의 원자 제출 또는 이미 참석 처리된 건의 피드백 제출은 `observation_completed`로 이동한다.
5. 노쇼는 교사 적합성 평가 없이 `observation_completed`로 이동한다.
6. 예약 취소는 기존 observation과 appointment를 terminal 상태로 닫고 track을 `observation_requested`의 `예약 필요`로 둔다. 이후 다시 예약하면 기존 행을 되살리지 않고 새 observation과 appointment를 만든다.
7. 원장 결정은 `enrollment_requested | waiting_* | not_registered | observation_requested` 중 하나로 이동한다.
8. 재청강 결정은 기존 시도에 `decision_kind = re_observation`을 기록해 닫고 track을 `observation_requested · 예약 필요`로 이동시킨다. 다음 반·회차를 실제 저장할 때 새 observation과 appointment를 원자적으로 만든다.

appointment와 observation 상태는 한 mutation에서 함께 바뀐다.

- 예약 생성·변경: appointment `scheduled`, observation `scheduled`
- 참석만 먼저 확인: appointment `completed`, observation `attended_feedback_pending`
- 참석+평가 원자 제출: appointment `completed`, observation `completed`
- 노쇼: appointment `completed`, observation `no_show`
- 예약 취소: appointment `canceled`, observation `canceled`

appointment가 `completed | canceled`가 된 뒤에는 같은 행을 다시 예약 상태로 되돌리지 않는다. 새 청강은 새 observation과 appointment를 만든다. 이 매핑으로 고객 리마인드와 달력은 참석·노쇼·취소 즉시 scheduled 대상에서 빠진다.

상태 선택만으로 예약, 메시지, 피드백, 등록 행을 암묵 생성하지 않는다. 각 실제 행동은 별도 저장 동작을 사용한다.

기존 범용 workflow status mutation은 observation lifecycle의 입구·내부·출구를 소유하지 않는다.

- `set_registration_workflow_status_v1` 계열은 observation 상태를 source 또는 target으로 받거나, `decision_kind is null`인 열린 observation이 연결된 track을 다른 상태로 옮기려 하면 `registration_observation_transition_requires_action`으로 거부한다.
- 청강 진입, 예약 저장·변경·취소, 참석, 피드백, 원장 결정은 각각 전용 RPC만 수행한다. 전용 RPC가 track·observation·appointment·audit·due 작업을 같은 transaction에서 바꾼다.
- 열린 observation이 없는 `consultation_completed → enrollment_requested` 직접 경로는 기존처럼 허용한다.
- 초기 청강 진입 RPC는 출발 상태를 `observation_return_workflow_status`로 보존한다. 예약 전 또는 취소·재청강 결정 후 재예약하지 않기로 한 경우에는 전용 `withdraw_registration_observation_v1`만 탈출을 소유한다.
- 철회 RPC는 track을 row lock하고 expected `workflow_revision`을 재검증한 뒤, track이 `observation_requested`이고 active observation·scheduled appointment가 없을 때만 허용한다. `p_exit_kind`는 `return_to_previous | director_decision`으로 구분한다. `return_to_previous`는 정확히 보존된 출발 상태만 target으로 허용하고, `director_decision`은 `enrollment_requested`, 세 waiting 상태 또는 `not_registered` 중 하나를 허용한다. 같은 waiting 상태로 돌아가더라도 두 의미를 이 값으로 구분한다.
- 최초 진입 뒤 아직 예약하지 않았거나 단순히 예약을 취소한 뒤 철회하는 경우에는 observation 행을 수정하지 않는다. 따라서 track expected `workflow_revision`만 요구하고 존재하지 않거나 terminal인 observation의 `revision`·`feedback_revision`은 요구하지 않는다. 모든 기존 attempt가 terminal인지 서버가 다시 확인하고, canceled 이력은 그대로 보존한다.
- 최신 decision-bearing 완료 시도의 `decision_kind`가 `re_observation`인 상태에서 `director_decision`으로 최종 진로를 바꾸려면 `p_decision_observation_id`, 해당 observation expected `revision`·`feedback_revision`을 추가로 요구한다. 대상은 그 track의 가장 최근 decision-bearing observation이어야 하고, 그 뒤 attempt는 모두 decision이 없는 `canceled` terminal 행이어야 하며 active·scheduled·attended·completed·no-show attempt가 하나라도 있으면 거부한다. `enrollment_requested → enrollment`, 세 waiting target → 각각 같은 이름의 decision kind, `not_registered → not_registered`로 명시 매핑해 기존 `re_observation` 결정을 correction하고 이전·새 결정, 사유, actor, 시각을 audit에 남긴다. 원장의 등록 선택 자체는 청강 적합성 결과와 무관하게 허용한다. `completed + fit` 및 최종 등록 반 일치는 청강일을 첫 수업일 특별 후보와 `class_start_source_observation_id`로 사용할 때만 별도로 검증한다.
- `return_to_previous`에는 대응 `decision_kind`를 만들지 않는다. 특히 보존된 `consultation_completed`로 돌아갈 때 기존 `re_observation` 결정은 과거 사실로 보존하고 `observation_flow_withdrawn` audit만 추가한다. 최신 `re_observation` 결정이 없는 최초 진입·단순 취소 뒤 `director_decision`도 observation decision을 새로 만들지 않고 track 전이 audit만 남긴다.
- 철회가 끝나면 `observation_return_workflow_status`를 지운다. 이 경로도 enrollment/admission/payment 행을 만들거나 수정하지 않으며, 등록을 선택하면 근거가 검증된 적합 observation이 있을 때만 첫 수업일 제안에 사용한다.

## 5. 데이터 모델

### 5.1 예약 확장

`ops_registration_subject_tracks.workflow_status` check에 세 observation 상태를 추가하고, nullable `observation_return_workflow_status`를 추가한다. return 값은 `consultation_completed | waiting_current_class | waiting_new_class | waiting_next_opening`만 허용한다. `workflow_status in (observation_requested, observation_feedback_pending, observation_completed)`와 return 값 non-null은 양방향 check로 묶고, observation flow를 나가면 반드시 null이다.

`ops_registration_appointments.kind`에 `observation_class`를 추가한다. 기존 `level_test`, `visit_consultation` 의미는 변경하지 않는다.

청강 예약은 다음 기존 사실을 사용한다.

- `task_id`
- 시작 시각, 장소, 상태, `notification_revision`
- 예약 생성자·수정자·생성시각·수정시각
- 예약 메시지에 영향을 주는 일정·장소·반·회차·담당 선생님이 바뀌거나 예약을 취소할 때 증가하는 `notification_revision`과 감사 이력

청강의 세 revision은 서로 다른 책임을 가진다.

- appointment `notification_revision`: 현재 예약 mutation의 optimistic concurrency와 예약·리마인드 canonical source identity를 함께 담당한다. 일정·장소·반·회차·담당 선생님 변경과 취소에서만 증가하고, 피드백이나 원장 결정만 바뀌어서는 증가하지 않는다.
- observation `revision`: 참석 상태와 원장 결정 등 청강 lifecycle의 optimistic concurrency에 사용한다.
- observation `feedback_revision`: 참석·평가 내용의 동시 수정 방지와 correction 이력에만 사용한다.

### 5.2 청강 원장

새 `public.ops_registration_observations`는 시도 한 번당 한 행을 가진다.

- `id`, `task_id`, `track_id`
- `appointment_id` — 한 청강 행과 한 예약의 1:1 연결
- `class_id`
- `session_authority`: `normalized | legacy`
- nullable `class_lesson_session_id`
- nullable `legacy_session_key`
- 수업 날짜·시작·종료 snapshot, 원본 `class_lesson_sessions.revision` 또는 legacy session content hash, 예약 핵심 사실만 정규화한 `booking_fact_hash`
- `teacher_catalog_id`, `teacher_profile_id`
- `campus`: `본관 | 별관`
- 반명, 과목, 수업 시작·종료, 선생님, 강의실과 정렬된 교재 목록·진도 표시용 revision snapshot
- `status`: `scheduled | attended_feedback_pending | completed | no_show | canceled`
- `suitability_result`: `fit | unfit | null`
- `feedback_reason`
- `feedback_submitted_by`, `feedback_submitted_at`, `feedback_revision`
- `attendance_recorded_by`, `attendance_recorded_at`
- `decision_kind`: `enrollment | waiting_current_class | waiting_new_class | waiting_next_opening | not_registered | re_observation | null`
- `decided_by`, `decided_at`
- `created_by`, `created_at`, `updated_at`, `revision`

불변식은 다음과 같다.

- 청강은 같은 task의 정확한 track과 class에 연결된다.
- class subject와 track subject가 일치해야 한다.
- 정규화 수업은 해당 class의 `active | makeup` `class_lesson_sessions` 한 행을 정확히 참조한다.
- 레거시·shadow 수업은 `classes.schedule_plan`의 정확한 session key와 날짜를 참조한다.
- 정규화 session ID와 legacy session key 중 현재 권위에 맞는 하나만 존재해야 한다.
- 선택한 회차는 유효한 시작·종료 시각을 가져야 한다. 레거시 session에 시간이 없으면 같은 요일의 반복 slot 후보가 정확히 하나일 때만 시간을 유도하고, 없거나 둘 이상이면 먼저 수업일정을 고치도록 예약을 차단한다.
- 예약 시각은 선택한 session 시작 시각과 일치한다.
- 담당 선생님은 session snapshot의 teacher를 기본값으로 사용한다.
- 선택한 session의 담당 선생님은 `teacher_catalogs.is_visible = true`이고 기존 `notification_profile_is_active_v1(profile_id)`를 통과하는 계정에 유일하게 연결되어야 한다. normalized session의 link를 우선하고, legacy는 canonical teacher name이 정확히 한 catalog/profile에 매칭될 때만 허용한다. 누락·비활성·중복이면 예약을 차단하고 수업일정의 담당 선생님 연결을 먼저 고치게 한다.
- `classroom_catalogs`에 nullable `campus`(`본관 | 별관`)를 추가하고, 청강 활성화 전에 사용 중인 강의실을 운영자가 명시적으로 backfill한다. 이름 문자열로 자동 확정하지 않는다.
- normalized session은 `classroom_catalog_id`의 campus를, legacy session은 강의실 이름이 정확히 하나의 catalog에 매칭될 때 그 campus를 권위로 사용한다. 누락·중복이면 예약을 차단한다.
- observation campus는 권위 강의실의 campus snapshot이며 예약 화면에 읽기 전용으로 표시한다. 등록 task campus와 다르면 경고하되 실제 선택 회차의 강의실 campus가 우선한다.
- 서버는 `appointment.place`와 `observation.campus`에 같은 canonical campus를 저장하고 둘이 다르면 mutation을 거부한다. 고객 위치 버튼은 현재 강의실 catalog campus 재검증까지 통과했을 때만 만든다.
- 최초 `fit | unfit` 제출은 이미 참석 처리된 `attended_feedback_pending`에서 가능하다. 아직 `scheduled`이면 동일 RPC가 참석과 평가를 한 트랜잭션으로 기록해 중간 상태를 외부에 노출하지 않고 `completed`로 전이한다.
- 원장 결정 전의 `completed` 행은 기존 non-null 피드백에 한해서 assigned teacher 또는 admin/staff가 expected `feedback_revision`과 수정 사유를 제출해 correction할 수 있다. 최초 피드백을 새로 만드는 경로로 사용할 수 없다.
- `fit | unfit`에는 비어 있지 않은 사유가 반드시 존재한다.
- `no_show | canceled`에는 적합성 결과가 존재할 수 없다.
- 과거 예약을 직접 수정하지 않고 reschedule mutation으로 appointment `notification_revision`, session source revision/hash, `booking_fact_hash`와 snapshot을 함께 갱신한다.
- `appointment_id`는 unique여서 한 appointment가 둘 이상의 observation에 연결될 수 없다.
- 한 track에는 `decision_kind is null and status in ('scheduled', 'attended_feedback_pending', 'completed', 'no_show')`인 열린 observation이 최대 한 개다. partial unique index와 track row lock을 함께 사용해 동시 생성 경합을 차단한다.

### 5.3 등록 첫 수업일 근거

`ops_registration_enrollments`에 nullable `class_start_source_observation_id`를 추가한다.

- 원장이 `decision_kind = enrollment`로 결정했고 최종 등록 반과 일치하는 `completed + fit` 청강을 첫 수업일 근거로 사용한다.
- 원장은 등록 신청 화면에서 실제 유효한 수업 회차 중 최종 첫 수업일을 선택한다.
- 기존 enrollment editor의 `등록 결정일 이후` 일반 후보 필터와 별도로, 해당 enrollment 결정을 만든 `completed + fit` observation 회차 한 건은 과거 날짜여도 검증된 특별 후보로 주입한다.
- 원장이 제안된 청강 회차를 그대로 선택하면 `class_start_source_observation_id`를 함께 저장한다.
- 다른 날짜를 선택하면 이 필드는 `null`이고 원장이 선택한 기존 정규화 session ID 또는 legacy session key·`class_start_date`가 권위다.
- 서버는 청강 근거, 등록 반, 수업 회차, 선택 날짜가 일치하는지 원자적으로 검증한다.
- 부적합·노쇼·취소 청강은 후보가 될 수 없다.

이 필드는 날짜 결정 근거이지 수납 행이 아니다. 청강 또는 `not_registered` 결정 mutation은 enrollment/admission/payment 행을 새로 만들거나 수정·삭제하지 않는다. 이미 독립적으로 존재하던 draft가 있더라도 청강 flow가 정리 명목으로 건드리지 않으며, payment 관련 신규 행은 항상 0건이다.

### 5.4 알림 작업

지연 알림은 전체 청강 원장을 반복 조회하지 않고 due-time 인덱스가 있는 전용 작업을 사용한다.

- 고객 3시간 전 리마인드는 기존 고객 예약 리마인드 큐를 청강 source identity까지 확장한다.
- 과목방 3시간 전 준비 알림과 종료 30분 후 피드백 알림은 notification control plane의 예약 producer가 전용 due row를 만든다.
- 예약·리마인드·준비·피드백 요청 작업의 일정 identity는 `observation_id + appointment.notification_revision + event_kind`다. observation 일반 revision이나 `feedback_revision`을 사용하지 않는다.
- reschedule은 아직 발송하지 않은 이전 `notification_revision` 작업을 취소하고 새 작업을 만든다. 참석·피드백 correction은 고객 예약 안내나 리마인드 재발송 권한을 만들지 않는다.
- due row는 normalized session revision 또는 legacy session content hash, `booking_fact_hash`, 예약 snapshot hash를 함께 보관한다.
- `booking_fact_hash`에는 class·subject·session authority/ID/key·session `schedule_state`·날짜·시작·종료·담당 선생님·강의실·campus만 포함한다. observation·appointment workflow 상태와 교재·진도·메모는 포함하지 않는다.
- worker가 작업을 claim할 때와 외부 provider 호출 직전에 현재 runtime 권위와 source revision/hash를 다시 읽고 `booking_fact_hash`를 재계산한다. source revision만 바뀌었지만 핵심 hash가 같으면 같은 회차의 최신 교재·진도를 사용해 진행할 수 있다. 핵심 hash가 다르면 `source_dirty`로 보류하고 provider 호출은 0회다.
- 최초 예약은 `registration.observation_scheduled`, 일정 변경은 `registration.observation_rescheduled`, 취소는 `registration.observation_canceled`라는 서로 다른 event kind를 사용한다. 취소 mutation은 `notification_revision`을 올리고 이전 due 작업을 취소한 뒤 취소 event 한 건을 만든다.
- 참석만 먼저 기록하면 `notification_revision`은 올리지 않고 appointment를 `completed`로 바꾸며 고객 리마인드·3시간 전 준비 작업만 취소한다. 종료 30분 후 피드백 작업은 유지한다.
- 참석+평가 원자 제출 또는 노쇼는 `notification_revision`을 올리지 않고 appointment를 `completed`로 바꾸며 피드백 요청을 포함한 남은 due 작업을 모두 취소한다.
- 피드백 due worker는 appointment `scheduled` 여부만 보지 않고 observation이 `scheduled | attended_feedback_pending`, 피드백 미제출, 취소·노쇼 아님인지 재검증한다.
- `source_dirty`는 운영자가 현재 수업 회차를 확인해 명시적으로 재예약·재확정하기 전에는 자동 해제하지 않는다.
- provider 시도 뒤 결과가 불명확한 작업은 `unknown`으로 닫고 자동 재발송하지 않는다.

기존 `registration_customer_reminder_jobs`의 appointment 단일 PK 구조는 revision별 이력을 보존할 수 없으므로 forward migration에서 다음처럼 확장한다.

- nullable `job_id uuid`, `message_kind text`를 먼저 추가하고 기존 행은 `job_id = appointment_id`, `message_kind = 'appointment_reminder'`로 backfill한다. 중복·null audit가 0건일 때만 두 컬럼을 NOT NULL로 바꾼다.
- 기존 `scheduled_job_id → appointment_id` inbound FK와 `appointment_id` PK를 이 순서로 제거하고 `job_id` PK, `unique(appointment_id, source_revision, message_kind)`를 만든다. 그다음 `ops_registration_customer_messages.scheduled_job_id → registration_customer_reminder_jobs.job_id` FK를 추가한다. 기존 message 값은 `job_id = appointment_id` backfill 덕분에 보존된다.
- 현재 `scheduled_job_id = appointment_id`를 요구하는 scheduled message shape constraint를 제거하고 `scheduled_job_id is not null` 및 `message_kind in ('appointment_reminder', 'observation_reminder')`를 허용하도록 교체한다. scheduled message 생성 RPC는 job을 잠근 뒤 message의 appointment·source revision·kind가 job과 일치하는지 검증한다.
- customer message source/preview/create/claim/finalize/reconcile, template receipt, activation, content-contract allowlist에 `observation_booking`, `observation_reminder`를 추가한다. 기존 level-test·visit reminder는 `appointment_reminder`로 유지하고 새 observation job만 `observation_reminder`를 사용한다.
- producer·claim·dispatch·finalize·reconcile은 모두 `job_id`를 사용하고, reschedule은 새 source revision 행을 insert하며 이전 완료 이력을 재개방하지 않는다.

## 6. 예약 화면과 달력

### 6.1 청강 상세

청강 섹션은 다음 핵심 필드만 한 화면에 표시한다.

- 청강 반
- 청강 수업일·시간 — 실제 수업 회차 선택
- 담당 선생님
- 강의실
- 교재 — 여러 권이면 class `textbook_ids` 순서, 그다음 제목·ID 순으로 안정 정렬
- 해당 회차 진도
- 예약 저장 상태
- 고객 예약 안내 발송 상태
- 참석·노쇼·취소
- 적합·부적합과 사유
- 원장 최종 결정

반을 선택하면 해당 반의 유효한 미래 수업 회차만 불러온다. runtime 1의 normalized 수업은 `class_lesson_sessions`, legacy·shadow 수업은 선택한 반 한 행의 `schedule_plan`을 지연 조회한다. 수업 회차를 선택하면 선생님·강의실·교재·진도 snapshot을 채운다.

campus는 선택한 강의실 catalog의 canonical 값을 읽기 전용으로 표시한다. 등록 task campus와 다르면 경고하고, catalog campus가 비어 있거나 legacy 강의실이 유일하게 매칭되지 않으면 수업일정의 강의실을 먼저 고치도록 예약을 막는다.

내부 Google Chat의 회차 진도는 선택한 회차에 한정한 기존 수업일정 resolver를 재사용한다. 우선순위는 다음과 같다.

1. 선택한 schedule session의 `textbookEntries[].plan` 범위와 메모
2. 같은 `class_id`와 정확한 session ID 또는 session order가 일치하는 `progress_logs`의 `range_label`, `public_note`
3. 선택한 session 자체의 `memo`, `public_note`
4. 모두 없으면 `진도: 미입력`

다른 회차나 반 전체의 최신 progress를 fallback으로 사용하지 않는다. 진도 미입력은 예약을 막지 않는다. 수업 일정이 바뀌어 저장된 snapshot과 현재 원장이 달라지면 조용히 덮어쓰지 않고 재예약이 필요하다고 알린다.

예약 직후 과목방 알림은 저장된 교재·진도 snapshot을 사용하고, 3시간 전 준비 알림은 dispatch 시점에 같은 회차의 현재 교재 목록과 진도를 다시 resolve한다. 교재·진도는 내부 준비 콘텐츠이며 변경만으로 예약을 `source_dirty`로 만들거나 고객 `notification_revision`을 올리지 않는다. 고객 알림톡에는 교재·진도를 넣지 않는다. 반·회차 상태, 날짜·시각, 담당 선생님, 강의실, campus 같은 예약 핵심 사실의 drift만 발송을 차단한다.

### 6.2 등록 신청의 첫 수업일 제안

첫 수업일 선택 바로 위에 다음 정보를 표시한다.

```text
최근 적합 청강
8월 17일 · 중2 영어 A반 · 참석 · 적합
첫 수업일 기본값에 반영했습니다.
```

- 같은 반의 유효한 적합 청강이 있으면 청강 회차를 기본 선택한다.
- 이 한 건은 등록 결정일보다 과거여도 일반 session 후보와 별도의 `청강 회차` option으로 주입한다. client가 임의 과거 날짜를 추가할 수는 없다.
- 원장은 다른 유효한 정규 수업 회차로 자유롭게 변경할 수 있다.
- 저장되는 최종값은 화면의 최종 선택값이다.
- 적합 청강이 없거나 등록 반이 다르면 기존 첫 수업일 선택 방식을 사용한다.

서버는 특별 후보 저장 시 observation이 같은 task·track·class의 `completed + fit + decision_kind enrollment`, 결정 전후 correction으로 무효화되지 않음, snapshot의 session authority·ID/key·날짜가 저장 근거와 일치함을 다시 검증한다. 일반 대안은 기존처럼 등록 결정일 이후의 유효한 미래 회차만 허용한다.

### 6.3 달력

등록 달력에 `청강` 필터와 건수를 추가한다.

- 공유 예약은 한 청강당 한 일정으로 표시한다.
- 항목에는 학생, 과목, 반, 시작·종료, 선생님, 장소, 상태를 표시한다.
- 클릭하면 `taskId`, `trackId`, `observationId`, `appointmentId`가 포함된 상세 링크로 이동한다.
- 목록과 달력 건수는 appointment 단위로 계산해 과목 또는 participant join으로 부풀리지 않는다.

### 6.4 교사 전용 피드백 화면

과목방의 `피드백 입력` 버튼은 전체 등록 상세가 아니라 `/admin/registration/observations/{observationId}/feedback`으로 이동한다. 이 route는 전용 read RPC를 사용해 다음 최소 정보만 반환한다.

- 학생명, 학년
- 과목, 수업명, 청강 일시, 강의실
- 담당 선생님, 참석·평가 상태
- 해당 observation의 현재 피드백과 revision

보호자·학생 전화번호, 학교, 문의 메모, 다른 과목 track, 다른 observation은 반환하지 않는다. RPC는 `auth.uid()`가 observation의 `teacher_profile_id`, admin/staff 또는 track director인지 서버에서 검사하고 unrelated teacher에게는 존재 여부도 드러내지 않는 `not found` 응답을 준다. 기존 `ops_tasks` 전체 SELECT 정책은 넓히지 않는다.

Google Chat Dashboard URL allowlist에는 서버가 만든 정확한 feedback route pattern만 추가한다. `observationId` UUID는 카드 본문에 표시하지 않고 인증이 필요한 버튼 target 내부에서만 허용하며, 임의 host·query parameter·다른 등록 경로는 계속 거부한다.

## 7. 고객 알림톡

### 7.1 발송 단위와 안전 경계

청강 고객 메시지는 하나의 과목·반·수업 회차를 대상으로 한다.

- `observation_booking`: 예약 저장 뒤 관리팀이 미리보기와 수신번호 끝자리를 확인하고 발송
- `observation_reminder`: 기존 고객 리마인드 설정의 발송 시간 전에 자동 발송하며 최초 운영값은 3시간
- 예약 안내는 동일 `observation_id + appointment.notification_revision`당 한 번만 발송한다.
- 리마인드는 동일 `observation_id + appointment.notification_revision`당 한 번만 발송한다.
- 예약 또는 변경 시점이 현재 설정된 lead time 미만이면 예약 안내만 허용하고 자동 리마인드는 만들지 않는다.
- 정확히 lead time 이상 남은 예약만 리마인드 큐에 들어간다.
- 취소·노쇼·완료, 잘못된 전화번호, template drift, appointment notification revision 또는 `booking_fact_hash` 불일치에서는 provider 호출이 0회다.
- 고객 메시지 저장, 미리보기, 확인 발송, provider 시도 마커, finalize, reconcile은 기존 canonical 경계를 재사용한다.
- 문자 대체발송은 계속 비활성화한다.

### 7.2 청강 예약 안내 본문

허용 변수는 `학생명`, `과목`, `수업명`, `예약일시`, `장소`, `담당선생님`뿐이다. 값은 browser 요청이 아니라 canonical observation source에서 만든다.

```text
[팁스영어수학학원] 청강 예약 안내

안녕하세요. #{학생명} 학생의 #{과목} 청강 예약을 안내드립니다.

수업: #{수업명}
일시: #{예약일시}
장소: #{장소}
담당 선생님: #{담당선생님}

수업 준비를 위해 예약 시간에 맞춰 방문해 주세요.
일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.
```

### 7.3 청강 리마인드 본문

허용 변수는 예약 안내와 같은 여섯 값뿐이다. worker 지연이 있어도 남은 시간을 과장하지 않도록 본문은 정확한 예약 일시를 중심으로 표시한다.

```text
[팁스영어수학학원] 청강 일정 안내

안녕하세요. #{학생명} 학생의 #{과목} 청강 일정을 다시 안내드립니다.

수업: #{수업명}
일시: #{예약일시}
장소: #{장소}
담당 선생님: #{담당선생님}

예약 시간에 맞춰 방문해 주세요.
변동사항 및 문의는 아래 문의하기 버튼을 이용해 주세요.
```

두 템플릿은 정확히 다음 버튼을 사용한다.

1. 장소에 따른 `학원 위치 보기`
   - 본관: `https://map.naver.com/p/entry/place/1218797840?placePath=%3Fentry%3Dpll%26from%3Dnx%26fromNxList%3Dtrue&placeSearchOption=entry%3Dpll%26fromNxList%3Dtrue&searchType=place&c=15.00,0,0,0,dh`
   - 별관: `https://map.naver.com/p/search/%EC%A0%9C%EC%A3%BC%EC%88%98%ED%95%99%ED%95%99%EC%9B%90/place/1962638110?c=10.00,0,0,0,dh&placePath=%3Fentry%253Dbmp`
2. `문의하기` — `https://tipsedu.channel.io`

새 템플릿의 승인 영수증과 server-only checksum이 일치하기 전에는 실제 SOLAPI 발송을 차단한다. 승인 전에도 예약, 달력, 피드백, Google Chat은 운영할 수 있다.

## 8. Google Chat과 Dashboard 알림

과목방 routing은 browser가 전달한 문자열이 아니라 canonical track subject에서 `english | math | science` connection을 결정한다. 모든 Google Chat 카드는 본문만 읽어도 업무 내용을 이해할 수 있고 raw URL 대신 `청강 상세 보기` 버튼을 사용한다.

### 8.1 예약 직후

`registration.observation_scheduled`를 해당 과목방에 즉시 보낸다.

- 학생, 과목·수업, 일시
- 담당 선생님, 강의실, 교재
- 해당 수업 회차 진도
- `교재 복사 등 청강 준비가 필요합니다.`
- Dashboard 상세 버튼

변경·취소도 같은 canonical source에서 이전·변경 일정과 상태를 명확히 표시한다.

### 8.2 시작 3시간 전

`registration.observation_reminder_due`를 해당 과목방에 한 번 보낸다.

- `오늘 청강이 예정되어 있습니다.`
- 수업·시간·선생님·강의실·교재·진도
- 준비 확인 안내와 Dashboard 상세 버튼

고객 SOLAPI 리마인드 ON/OFF와 내부 과목방 알림은 별도 제어다. 과목방 알림은 해당 Google Chat workflow rule이 활성화됐을 때 동작한다.

예약 또는 변경 시점에 시작까지 3시간 미만이면 과거 시각의 준비 작업을 만들거나 즉시 대체 발송하지 않는다. 예약 직후 준비 알림 한 건으로 운영자가 확인한다.

### 8.3 종료 30분 후

선택한 수업 회차의 canonical 종료시각 30분 후 `registration.observation_feedback_due`를 해당 과목방에 한 번 보낸다.

- 피드백이 아직 없을 때만 발송한다.
- 이미 제출, 취소, 노쇼이면 발송하지 않는다.
- `청강은 어땠나요? 적합 여부와 사유를 입력해 주세요.`
- Dashboard 피드백 화면 버튼
- 미제출 상태가 계속돼도 반복 독촉하지 않는다.

### 8.4 피드백 제출 후

- `registration.observation_feedback_submitted`를 한 번 만든다.
- track director에게 Dashboard inbox 알림을 보낸다.
- `executive_team` Google Chat에는 `청강 피드백이 등록되었습니다.`와 학생·과목·수업·제출자·제출시각·상세 버튼만 표시한다.
- `fit | unfit` 결과와 사유는 단체방에 표시하지 않는다.

## 9. 참석과 교사 피드백

### 9.1 입력 규칙

- 참석 결과는 `참석 | 노쇼`다. `취소`는 예약 권한자가 별도 예약 취소 동작으로 처리한다.
- 참석한 경우에만 `적합 | 부적합`과 사유를 입력한다.
- 적합과 부적합 모두 사유가 필수다.
- 피드백은 해당 observation의 담당 선생님 계정이 제출한다.
- admin/staff는 운영상 대리 입력할 수 있지만 `대리 입력` 표지, 원 담당 선생님, 대리 입력자와 시각을 별도로 기록·표시한다.
- track director는 모든 피드백을 읽고 다음 상태를 결정할 수 있다.

담당 교사 또는 admin/staff 대리 입력자의 최초 제출은 하나의 원자 mutation이다. `scheduled`에서 `참석`이면 참석과 `적합 | 부적합 + 필수 사유`를 함께 저장하고 `completed`로 전이한다. admin/staff가 참석만 먼저 기록한 `attended_feedback_pending`에서는 평가를 저장하고 `completed`로 전이한다. `노쇼`이면 평가 없이 `no_show`로 전이한다. 담당 교사는 예약 취소 권한을 갖지 않는다.

참석·노쇼는 canonical 수업 시작시각 전에는 제출할 수 없고, `fit | unfit` 평가는 수업 종료시각 전에는 제출할 수 없다. admin/staff도 같은 시간 경계를 우회하지 않는다. 시각 검증은 browser 시간이 아니라 서버 시간과 현재 session source를 사용한다.

피드백은 조용히 덮어쓰지 않는다. 원장 결정 전에는 `completed`인 기존 피드백만 assigned teacher 또는 admin/staff가 expected `feedback_revision`과 필수 수정 사유로 correction할 수 있다. 이전 값, 새 값, 수정자, 수정시각을 audit event로 보존한다. correction은 `feedback_revision`만 증가시키고 appointment `notification_revision`을 바꾸지 않는다.

원장 결정 뒤에는 담당 교사 수정이 잠긴다. admin/staff도 attendance 또는 `fit | unfit` 결과를 바꿀 수 없고, 기존 결과를 유지한 사유 문구 correction만 필수 수정 사유와 함께 허용한다. 결과 자체가 잘못됐다면 별도의 원장 결정 취소·등록 근거 재검토 기능이 필요하므로 이 범위에서는 fail closed한다. 따라서 이미 enrollment의 `class_start_source_observation_id`가 된 적합 청강을 사후 부적합으로 바꾸는 경로는 없다.

### 9.2 원장 결정

피드백 제출이나 노쇼 처리는 등록을 자동 생성하지 않는다. 원장은 다음 중 하나를 선택한다.

- 등록 신청
- 현재 반·신규 반·다음 개강 대기
- 미등록
- 재청강

결정 mutation은 observation domain revision과 feedback revision을 다시 확인하고 `decision_kind`, 결정자·결정시각, track workflow 변경, 감사 event를 한 트랜잭션으로 기록한다. 같은 observation의 최초 결정은 한 번만 만든다. 유일한 예외는 새 active attempt가 없고 뒤에 decision 없는 canceled attempt만 있는 `re_observation` 결정을 전용 철회/진로변경 RPC로 교정하는 경우이며 원래 결정은 audit에 보존한다. 재청강 결정은 새 행을 미리 만들지 않고 track만 예약 필요로 전환하며, 다음 예약 저장 mutation이 필수 class/session/teacher/campus와 함께 새 observation+appointment를 만든다.

`enrollment`, 세 waiting 결정 또는 `not_registered`로 observation flow를 나가면 같은 transaction에서 `observation_return_workflow_status = null`로 지운다. `re_observation`은 track이 계속 `observation_requested`에 있으므로 보존하고, 이후 새 예약 또는 철회 경로에서 사용한다.

## 10. 권한과 개인정보

- 예약·변경·취소: 기존 등록 관리 권한이 있는 admin/staff와 track director
- 청강 진행 철회·진로변경: admin/staff와 track director
- 참석만 먼저 기록: admin/staff
- 최초 참석+적합성 피드백 또는 노쇼 원자 제출: assigned teacher, admin/staff
- 원장 결정 전 기존 피드백 correction: assigned teacher, admin/staff
- 피드백 대리 입력·결정 후 사유 문구 correction: admin/staff
- 피드백 전체 조회와 최종 결정: track director와 admin/staff
- assigned teacher는 청강 예약을 취소할 수 없다.
- 다른 선생님은 해당 observation의 사유를 조회하거나 수정할 수 없다.
- RLS는 task visibility만으로 교사 피드백 사유를 넓게 공개하지 않고 assigned teacher, track director, admin/staff를 행 단위로 검사한다.
- Google Chat 카드 본문에는 전화번호, 평가 결과, 평가 사유, 내부 UUID를 넣지 않는다. 인증이 필요한 서버 생성 Dashboard 버튼 target의 observation UUID는 예외로 허용한다.
- 고객 메시지 이력에는 전체 전화번호 대신 기존 masked suffix만 노출한다.
- SECURITY DEFINER RPC가 필요하면 비공개 schema, 고정 `search_path`, 내부 actor/role 검증, 최소 EXECUTE 권한을 사용한다.

## 11. 저장·오류·동시성

### 11.1 원자 저장

- 청강 예약 mutation은 appointment·observation, appointment notification revision, observation domain/feedback revision, session source revision/hash, booking fact hash, audit event, 내부 notification intent를 함께 기록한다.
- domain 저장이 실패하면 어느 행도 남지 않는다.
- 외부 Google Chat·SOLAPI 호출은 DB transaction 안에서 실행하지 않는다.
- 외부 전송 실패는 저장된 예약을 되돌리지 않는다.

### 11.2 멱등성과 오래된 화면

- 모든 mutation은 request key와 그 mutation이 소유한 expected revision을 받는다.
  - 청강 진입: track `workflow_revision`을 row lock 뒤 재검증하고 observation/appointment 행을 만들지 않는다.
  - 신규 attempt 예약 생성: track `workflow_revision`을 row lock 뒤 재검증하고, track이 `observation_requested`이며 active observation·scheduled observation appointment가 없음을 같은 lock 경계에서 확인한다. 아직 존재하지 않는 appointment/observation revision은 요구하지 않고 두 행을 원자 생성한다.
  - 기존 예약 변경·취소: appointment `notification_revision`과 observation `revision`을 모두 row lock 뒤 재검증한다.
  - 참석만 기록·노쇼: observation `revision`, 현재 appointment `notification_revision`과 status를 재검증
  - 최초 참석+평가 또는 참석 후 평가: observation `revision`, `feedback_revision`, 현재 appointment `notification_revision`과 status를 재검증
  - 결정 전 피드백 correction: observation `revision`과 `feedback_revision`, `decision_kind is null`을 재검증
  - 결정 후 사유 문구 admin correction: observation `revision`과 `feedback_revision`, 기존 `decision_kind`와 suitability 결과 불변을 재검증
  - 원장 결정: observation `revision`과 `feedback_revision`, track `workflow_revision`을 재검증한다.
  - 청강 철회/진로변경: 모든 경우 track `workflow_revision`을 재검증한다. 최초 예약 전 또는 단순 canceled attempt 뒤 observation을 수정하지 않는 철회는 observation revision을 요구하지 않는다. 가장 최근 decision-bearing `re_observation` 결정을 final decision으로 교정할 때만 명시한 `observation_id`의 `revision`·`feedback_revision`을 추가로 재검증하고, 그 뒤에는 decision 없는 canceled 이력만 있으며 active attempt가 없음을 확인한다.
- 동일 request key 재실행은 기존 결과를 반환한다.
- revision이 다르면 `청강 정보가 변경되었습니다. 다시 확인해 주세요.`로 종료한다.
- provider 시도 마커 뒤에는 같은 메시지를 자동 재시도하지 않는다.
- reschedule은 이전 appointment `notification_revision`의 미발송 작업만 취소한다. 이미 발송된 안내는 역사로 보존한다.
- 비동기 작업은 claim과 dispatch 직전에 session source, booking fact hash와 appointment notification revision을 재검증한다. 예약 핵심 사실이 stale이면 `source_dirty`로 종료하고 자동 발송·자동 재시도하지 않는다.

### 11.3 사용자 오류 표시

예약 저장, 고객 발송, 과목방 알림, 피드백 저장 상태를 분리해 표시한다.

- `예약 저장됨 · 예약 안내 미발송`
- `예약 저장됨 · 과목방 알림 재시도 필요`
- `수업일정 변경됨 · 청강 예약 재확인 필요`
- `피드백 저장 실패 · 입력 내용 유지`

timeout, abort, network, PostgreSQL `57014`는 재시도 가능한 한국어 안내로 정규화하고 내부 HTML, SQL, provider 응답 원문을 노출하지 않는다.

## 12. 성능과 장애 재발 방지

- 등록 첫 화면은 기존 summary projection에 청강 view count와 최소 최근 일정만 추가한다.
- observation 상세, feedback reason, class session 후보는 상세 또는 반 선택 시 지연 조회한다.
- `classes.select('*')`, 전체 `schedule_plan`, 전체 observation scan을 추가하지 않는다.
- 반 선택 시 session query는 선택한 `class_id`와 제한된 미래 기간으로 한정한다.
- observation에는 `track_id + decision_kind + status`, `teacher_profile_id + status`, `appointment_id` 조회 인덱스를 둔다. summary는 count와 가장 가까운 일정의 scalar field만 반환하고 feedback·교재·진도 JSON을 포함하지 않는다.
- 대규모 fixture에서 summary `EXPLAIN (ANALYZE, BUFFERS)`가 bounded index scan을 사용하고 observation 전체 seq scan·N+1 query가 없음을 확인한다. 기존 등록 summary 응답 크기와 시간을 전후 비교해 새 projection의 행당 payload가 고정 크기인지 검증한다.
- due worker는 `due_at`, `status` 인덱스와 bounded batch, `FOR UPDATE SKIP LOCKED`를 사용한다.
- Supabase GET/RPC에는 실제 AbortSignal 제한시간과 `.retry(false)`를 적용한다.
- mutation과 provider 발송에는 자동 네트워크 재시도를 추가하지 않는다.
- customer reminder OFF이면 SOLAPI cron은 현재 설계처럼 완전히 비활성 상태를 유지한다.
- 피드백 Google Chat 작업은 customer SOLAPI cron과 분리해 provider 장애가 서로 전파되지 않게 한다.

## 13. 테스트 전략

### 13.1 도메인·UI

- workflow 상태 순서와 `청강 신청` 보기 grouping
- 상담 완료·대기에서 청강 진입, 기존 직접 등록 유지
- 과목별 독립 상태와 여러 번 청강
- 초기 진입·취소·재청강 결정 뒤 예약 전 철회/진로변경과 return status 정리
- normalized·legacy 각각의 반·session·teacher·room·subject 일치 검증, 필수 campus 확인, ambiguous legacy time 차단
- 정확한 회차의 계획·progress만 사용하고 다른 회차 최신 진도를 fallback하지 않음
- 예약 변경·취소·노쇼·참석+피드백 원자 제출·참석 후 피드백·결정 전 correction·재청강
- 모바일, 200%~400% 확대, 키보드, focus, 직접 링크
- 달력 필터·건수·shared appointment 중복 방지
- 등록 결정일 이전의 정확한 청강 회차 특별 option, 등록 시작일 기본값, 원장 변경, observation 근거 저장·제거
- teacher 전용 feedback route 최소 projection, 허용 URL과 unrelated teacher not-found
- 청강·미등록 mutation이 기존 enrollment/admission/payment 행을 생성·변경·삭제하지 않고 payment 신규 행 0건

### 13.2 권한·DB

- assigned teacher의 참석+평가 또는 노쇼 제출과 예약 취소 차단
- admin/staff 대리 입력 audit
- track director 조회·결정과 unrelated teacher 차단
- 결정 전 correction과 결정 후 teacher 잠금, admin correction 사유·audit
- 시작 전 참석·노쇼와 종료 전 평가 차단
- domain/notification/feedback revision 독립 증가, expected revision, request key replay, 동시 mutation rollback
- 예약·취소·참석·노쇼·최초 평가·correction·결정별 정확한 expected revision 조합과 stale action 차단
- appointment 1:1, track당 열린 observation 한 건, 취소 뒤 새 attempt 생성
- observation/appointment 상태 원자 매핑과 terminal appointment 재활성화 차단
- 범용 workflow status RPC의 observation 상태·열린 시도 우회 차단과 기존 직접 등록 경로 유지
- RLS, 함수 EXECUTE, search path, Data API grant 계약
- PostgreSQL pgTAP 실제 transaction 검증

### 13.3 알림

- 예약 직후 과목방 한 번
- 최초 운영값 3시간 전 고객·과목방 각각 한 번
- 현재 lead time 미만 예약에서 고객 리마인드 0회
- 종료 30분 후 미제출 피드백 알림 한 번
- 참석만 먼저 기록하면 고객·준비 due는 취소되고 종료 후 피드백 due는 유지
- 조기 제출·취소·노쇼에서 종료 후 알림 0회
- reschedule stale job 취소와 새 notification revision 작업
- 피드백 correction 뒤 고객 예약·리마인드 재발송 권한 0건
- normalized/legacy source revision drift를 claim 전·dispatch 전 각각 탐지하고, 예약 핵심 hash drift면 `source_dirty`·provider 호출 0회, 교재·진도만 바뀌면 최신 내부 콘텐츠로 한 번 발송
- 교재·진도 변경은 고객 revision을 바꾸지 않고 3시간 전 내부 카드에 같은 회차 최신값 반영
- 시작 3시간 미만 신규 예약에서 과거 due 과목방 알림 0건
- subject team routing과 Google Chat 개인정보 차단
- scheduled/rescheduled/canceled event kind별 한 번과 취소 후 pending due 0건
- 고객 preview, confirm, masked phone, template drift, dedupe
- `observation_booking | observation_reminder` 전 customer-message/template/activation/content allowlist와 scheduled origin shape
- reminder job UUID와 appointment+source revision+kind unique, 기존 job/message kind/FK/PK/shape constraint 무손실 backfill
- provider marker 이후 unknown에서 두 번째 provider 호출 0회
- SOLAPI·Google Chat provider-zero 테스트와 isolated DB round-trip
- 신규 Google Chat rule default OFF와 activation receipt 전 delivery 0건

### 13.4 회귀·빌드

- 등록 workflow, track, calendar, customer message, reminder, notification focused tests
- targeted ESLint와 전체 TypeScript
- `next build --webpack`
- migration layout, advisor, `git diff --check`
- 운영 적용 뒤 admin/staff/teacher 실제 권한과 모바일 등록 화면 검증

## 14. 배포와 활성화

1. 최신 `origin/main` 기반 격리 worktree에서 태스크별 TDD와 review를 수행한다.
2. forward-only migration으로 schema, RPC, RLS, index, event, due job을 추가한다.
3. migration 적용 뒤 runtime probe와 실제 admin/staff/teacher 권한을 확인한다.
4. code를 `main`에 반영하고 Vercel Production `READY`, alias, commit SHA를 확인한다.
5. 예약·달력·피드백 UI와 notification intent 생성까지 실제 테스트 청강으로 검증하되 외부 provider 호출은 0회로 유지한다.
6. 신규 청강 Google Chat rule은 모두 default OFF로 migration하고 provider-zero DB round-trip, 정확한 과목 routing, 허용 URL, 개인정보 차단을 먼저 확인한다.
7. 예약 lifecycle → 3시간 전 준비 → 종료 30분 후 피드백 요청 → 피드백 제출 순서로 event family를 하나씩 활성화한다. `scheduled`, `rescheduled`, `canceled`, 3시간 전 준비, feedback due, feedback submitted 각각에 대해 정확한 대상 channel과 delivery receipt 한 건을 확인한다.
8. SOLAPI `청강 예약 안내`, `청강 리마인드` 템플릿을 승인 요청한다.
9. 승인 checksum, sender/channel, 변수, 두 버튼, no-SMS-fallback을 preflight한다.
10. 승인된 테스트 번호로 예약 안내와 자동 리마인드 각각 한 번의 실제 수신을 확인한다.
11. 고객 자동 리마인드 설정을 최초 운영값 3시간·ON으로 확인하고 provider attempt, receipt, duplicate 0건을 관찰한다.

코드 배포나 DB migration만으로 고객 발송을 자동 활성화하지 않는다. SOLAPI 승인 전에는 고객 발송만 fail closed이고 청강 운영 기능과 Google Chat은 사용할 수 있다.

## 15. 롤백

- 고객 알림 롤백: customer reminder OFF와 신규 청강 template activation OFF
- Google Chat 롤백: 청강 workflow rule 비활성화
- UI 롤백: observation runtime probe를 비활성 상태로 반환해 청강 진입을 숨기고 기존 등록 경로를 유지
- DB 롤백: 적용된 migration을 수정·삭제하지 않고 follow-up migration으로 새 mutation 실행만 차단한다.
- 데이터는 삭제하지 않는다. 이미 저장된 예약, 피드백, 감사 이력은 읽기 전용으로 보존한다.

## 16. 완료 기준

- `청강 신청`이 등록 신청 바로 앞에 보이고 과목별로 독립 동작한다.
- 등록 달력에서 청강을 보고 정확한 상세 화면으로 이동할 수 있다.
- 예약 직후와 시작 3시간 전 과목방 알림, 종료 30분 후 조건부 피드백 알림이 중복 없이 동작한다.
- 고객 예약 안내는 미리보기·확인 후 한 번, 리마인드는 3시간 전에 한 번만 발송된다.
- 담당 선생님 평가가 원장에게 안전하게 전달되고 단체방에 사유가 노출되지 않는다.
- 등록 신청 시 적합 청강일이 기본값으로 제안되고 원장이 최종 날짜를 바꿀 수 있다.
- 미등록 청강에서 수납 관련 데이터가 생성되지 않는다.
- 새 기능이 첫 화면 payload, 자동 재시도, 전체 table scan을 늘리지 않는다.
- main push, Supabase migration, Vercel Production, Google Chat 실전 검증, SOLAPI 승인·테스트 수신을 각각 분리해 증명한다.
