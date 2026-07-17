# 작업 10 구현 결과 보고서

상태: 정규 등록 예약을 DB 예약 한 건당 달력 항목 한 건으로 보여 주는 읽기 전용 월/주 달력과 정규 딥 링크를 구현하고, 코드·빌드·브라우저 검증을 완료했습니다.

코드 커밋: `4f04dc9` (`feat: add canonical registration calendar`)

## 정규 데이터 계약

- `public.ops_registration_appointment_calendar` 뷰는 `security_invoker = true`로 동작하며 `appointment_id`, `task_id`, `student_name`, `kind`, `scheduled_at`, `place`, `status`, `notification_revision`, `track_ids`, `subjects` 정확히 10개 열만 노출합니다.
- 레벨테스트와 방문상담 하위 기록만 정규 참여자로 사용합니다. 전화상담·이전 자료·`academic_events`는 달력 원본에 포함하지 않습니다.
- 동일 예약의 참여 트랙을 중복 제거하고 영어→수학 순으로 `track_ids`와 `subjects`를 함께 집계합니다. 공유 예약은 참여 과목 수와 관계없이 한 행입니다.
- `notification_revision`은 PostgreSQL `integer`와 TypeScript `number`를 그대로 유지합니다.
- PUBLIC·anon의 뷰 권한을 회수하고 authenticated에 읽기 권한만 부여했습니다. `(status, scheduled_at, id)` 조회 인덱스를 추가했습니다.

## 조회·순수 모델·fixture

- `loadRegistrationAppointmentCalendar({ rangeStart, rangeEnd, statuses })`는 `[rangeStart, rangeEnd)` 반개방 범위로 조회하고 예약 시각 다음 예약 ID 순으로 정렬합니다. 상태를 생략하면 예약만 조회하고, 명시한 빈 상태 목록은 DB를 조회하지 않고 빈 결과를 반환합니다.
- `buildRegistrationAppointmentCalendarItems`는 snake_case 뷰 행을 camelCase DTO로 한 번만 바꾸고 원본 ISO 시각을 보존합니다. 안정 ID는 `registration-appointment:{appointmentId}`입니다.
- 잘못된 예약 종류·상태·정수 리비전·시각·참여 배열과 중복 예약 ID는 조용히 누락하거나 합치지 않고 명시적으로 거절합니다. ISO 오프셋은 PostgreSQL 허용 범위인 최대 `±15:59`까지만 받습니다.
- `getSeoulRegistrationDateKey`와 `getRegistrationAppointmentCalendarRange`로 서울 자정, 월말·연말, 윤일, 월요일 시작 주간을 순수 함수로 고정했습니다.
- fixture는 매 조회마다 현재 `caseDetails`에서 정규 하위 기록을 다시 계산합니다. 같은 날의 공유 영어·수학 예약과 단일 영어 예약을 별개 항목으로 만들고 전화상담·이전 자료·정규 하위 기록 없는 예약은 제외합니다.

## 화면과 딥 링크

- 등록 작업 공간에 기존 단계별 목록과 분리된 `목록 | 달력` 모드를 추가했습니다.
- 달력은 월/주 보기를 제공하며 예약 상태를 기본으로 표시하고 완료·취소 상태를 선택적으로 포함합니다.
- 예약 카드는 정규 상세를 여는 버튼만 제공합니다. 드래그·놓기·크기 조절·범위 생성·직접 저장·직접 삭제 경로는 없습니다.
- 딥 링크는 `/admin/registration?taskId={taskId}&appointmentId={appointmentId}&view=calendar` 순서를 유지합니다.
- 참여 트랙을 찾아 공유 편집기를 정확히 한 번 열고, 새로고침하면 같은 예약을 복원합니다. 사용자가 상세를 닫은 뒤에는 자동으로 다시 열지 않으며, 공유 예약에서 과목을 전환해도 달력 문맥을 유지합니다.

## 검증 결과

- 전체 Node 회귀: `1231/1231` 통과
- TypeScript: 통과
- 전체 ESLint: 오류 `0건`, 기존 생성 스크립트 경고 `1건`
- `git diff --check`: 통과
- 별도 임시 복사본 Next.js 프로덕션 빌드: 통과, 정적 페이지 `75/75` 생성
- pgTAP 소스 패킷: 계획값과 assertion 수 `168/168` 일치
- 독립 코드·SQL·UI 검토: P0/P1/P2 `0/0/0`
- 로컬 브라우저: 월/주 전환, 같은 날의 서로 다른 예약, 공유 예약 한 행, 정규 딥 링크, 새로고침 복원, 닫은 뒤 재개방 방지, 과목 전환 확인

## 현재 실행 상태와 외부 상태

- 작업 트리 개발 서버는 `http://localhost:3001`에서 계속 실행 중입니다.
- Supabase 플러그인은 읽기 확인에만 사용했고 Docker는 요구하거나 실행하지 않았습니다.
- 원격 마이그레이션·데이터·플래그 변경, 배포, 실제 Google Chat·Web Push·SOLAPI 공급자 호출은 수행하지 않았습니다.
- 실제 DB pgTAP은 마이그레이션이 적용된 승인된 로컬 또는 미리보기 DB가 없어 실행하지 않았습니다. 이번 완료 근거의 `168/168`은 pgTAP 소스 계획과 assertion 수의 일치 검증입니다.
