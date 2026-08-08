# Supabase 반복 장애 재발 방지 설계

## 목표

무료 Nano 프로젝트의 Disk I/O 버스트가 소진되며 Auth, REST, SQL이 함께 멈추는 반복 장애의 확인된 부하 원인을 제거한다. 장애가 다시 발생해도 요청이 무한 대기하거나 자동 재시도로 부하를 증폭하지 않게 하고, 운영 배포 뒤 같은 사용자 권한과 업무 결과를 유지한다.

## 확인된 원인과 기준선

- 장애 시 Supabase 화면에서 Disk I/O 100%, CPU 84%가 확인됐고 Auth `/user`, `/token`은 504/522, SQL은 연결 시간 초과로 함께 실패했다.
- `classes`는 72행뿐이지만 `schedule_plan`의 4,816개 레거시 회차가 펼쳐지면서 `select=*` 응답이 약 5.4MB가 된다. 대시보드가 실제로 필요한 수업 기본 정보와 기간 내 회차 날짜만 반환하면 약 324KB로 줄일 수 있다.
- `pg_stat_statements`에는 authenticated `classes.*` 전체 조회가 수만 회 누적돼 있고, 운영 장애 로그에서도 `classes`, `textbooks`, `progress_logs` 전체 조회가 동시에 반복됐다.
- 자동 리마인드 설정은 OFF지만 cron이 매분 Vercel worker를 호출했다. 최근 24시간에 512회 실행되고 86회 실패했으며, claim 함수는 OFF 확인 전에 heartbeat를 기록했다.
- `profiles`, `classes`, `textbooks`에는 같은 역할을 겹쳐 허용하는 permissive 정책이 여러 개 있고, `current_dashboard_role()`과 `auth.uid()`가 행마다 반복 평가된다. 등록 하위 테이블은 다시 `ops_tasks` RLS를 거치는 상관 서브쿼리를 사용해 작은 테이블에서도 과도한 누적 scan을 만들었다.

## 채택한 접근

비용 없는 구조 개선을 먼저 적용한다. 유료 컴퓨트 상향은 이 변경 뒤 실제 피크 부하와 Disk I/O 버스트 사용량을 측정한 후 별도 승인으로 판단한다.

## 1. 대시보드와 공개 API 부하 차단

### 대시보드 수업 조회

`classes.select("*")`를 수업 수, 학생 배정, 시간표 충돌에 필요한 명시적 필드로 바꾼다. `schedule_plan` 전체는 읽지 않는다.

새 RPC `public.list_dashboard_class_session_dates_v1(p_date_from, p_date_to)`는 다음 계약을 가진다.

- 조회 범위는 과거 30일에서 미래 365일까지이며 최대 400일을 넘을 수 없다.
- 레거시 수업은 `schedule_plan.sessions`에서 `date`와 `state`/`scheduleState`만 추출한다.
- 정규화 수업은 `class_lesson_sessions`에서 `session_date`와 `schedule_state`만 읽는다.
- 시험 충돌에 필요한 `active`, `makeup` 회차만 반환하고 수업별·날짜별 중복을 제거한다.
- authenticated 전용이고 데이터 변경 권한은 주지 않는다.

클라이언트는 RPC 결과를 기존 metric 입력 형태인 레거시 `schedule_plan.sessions` 또는 정규화 `lessonSessions`로 조립한다. 따라서 충돌 계산 로직 자체는 바꾸지 않는다. 모든 Supabase GET/RPC에는 AbortSignal 제한시간과 `.retry(false)`를 적용해 장애 중 자동 재시도가 부하를 늘리지 않게 한다.

### 공개 수업 API

`/api/public-classes`의 기본 응답을 이미 홈페이지가 사용하는 summary 모드로 통일한다. 전체 호환 payload builder는 명시적으로 호출하는 내부 도구를 위해 유지하지만 공개 route에서는 호출하지 않는다. 요청은 8초 안에 종료하고 네트워크·게이트웨이 HTML 오류를 응답 `reason`에 그대로 노출하지 않는다.

### 넓은 운영 데이터 로더

학사·운영 작업공간의 기존 필드 계약은 이번 릴리스에서 바꾸지 않는다. 대신 각 GET을 실제 취소 가능한 제한시간과 `.retry(false)`로 감싸 장애 시 무한 대기와 GET 재시도 증폭을 막는다. `schedule_plan` 지연 로딩 같은 큰 화면 재설계는 별도 측정 근거 없이 이번 변경에 섞지 않는다.

## 2. OFF 리마인드 cron 완전 정지

리마인드 설정과 cron 활성 상태를 하나의 트랜잭션 경계로 맞춘다.

- OFF이면 설치된 cron은 `active=false`이고 Vercel, Vault, claim RPC를 호출하지 않는다.
- ON 변경은 템플릿, 활성화, Vault, cron 구조를 검증한 뒤 설정 저장과 cron 활성화를 함께 수행한다.
- readiness는 `설치된 job의 이름·주기·명령이 정확한가`를 뜻한다. OFF 상태의 heartbeat나 active 여부를 요구하지 않는다.
- invoke 함수는 Vault를 읽기 전에 OFF를 확인하고 즉시 `null`을 반환한다.
- claim 함수는 OFF를 확인한 뒤에만 heartbeat를 갱신한다.
- install은 현재 설정값에 맞춰 active 상태를 정하고, follow-up migration은 기존 운영 cron도 즉시 설정값과 일치시킨다.
- provider 발송, 예약 job, 평생 1회 dedupe 계약은 변경하지 않는다.

## 3. RLS 평가 비용 축소

권한 범위를 넓히지 않고 같은 허용식을 더 적은 평가로 표현한다.

- `classes`, `textbooks`: 공개된 authenticated SELECT 정책은 하나만 남기고, 겹치는 ALL 정책을 INSERT/UPDATE/DELETE 정책으로 분리한다. 기존 최대 쓰기 권한인 admin/staff/teacher를 그대로 유지한다.
- `profiles`: 자기 자신, JWT 이메일 기반 identity lookup, admin/staff 전체 조회를 하나의 SELECT 정책으로 통합한다. 자기 수정, viewer 자기 생성, admin/staff 쓰기 권한도 명령별 한 정책으로 통합한다.
- `ops_tasks`: `auth.uid()`와 `current_dashboard_role()`을 `(select ...)` initplan 형태로 바꾸고 기존 요청자·담당자·단어재시험 선생님 조건을 그대로 유지한다.
- 등록 하위 SELECT 정책은 security-definer helper로 동일한 `ops_tasks` 가시성 판단을 수행한다. helper는 고정 `search_path`, 최소 execute 권한, PK/FK 인덱스 조회를 사용해 중첩 RLS 재평가를 피한다.
- UPDATE/DELETE 업무 제약, 등록 subject-track 직접 변경 차단, 감사 trigger는 변경하지 않는다.

배포 전후 실제 admin/staff 계정의 보이는 task/track/detail 개수를 비교하고, Supabase security/performance advisor를 다시 실행한다.

## 4. 실패 안전성과 관측

- timeout, abort, 57014, network failure는 사용자에게 재시도 가능한 한국어 메시지로 정규화하되 내부 HTML과 토큰을 노출하지 않는다.
- mutation과 provider 전송에는 자동 재시도를 추가하지 않는다.
- 배포 전 `pg_stat_statements`, 테이블 scan, cron run, API/Auth/Postgres 오류 기준선을 저장한다.
- 배포 후 로그인, 대시보드, 등록, 휴보강, 학사일정, 공개 수업 API를 확인하고 최소 30분 동안 5xx, statement timeout, cron 오실행, Disk I/O 상태를 관찰한다.

## 테스트 전략

1. 대시보드가 `classes.*`를 읽지 않고 경량 RPC 결과로 레거시·정규화 충돌 날짜를 동일하게 만드는 테스트
2. 공개 API가 summary 모드만 호출하고 8초 제한·오류 정규화를 지키는 테스트
3. 학사·운영 로더가 abort와 `.retry(false)`를 연결하는 테스트
4. OFF cron, ON 활성화, invoke fail-fast, heartbeat 순서를 검증하는 migration 계약 테스트
5. RLS 정책 수와 식, helper 보안 속성, 역할별 허용 범위를 검증하는 SQL/source 계약 테스트
6. 관련 Node 테스트, ESLint, TypeScript, `next build --webpack`, `git diff --check`
7. 운영 migration 후 advisor, EXPLAIN, 권한 결과 개수, cron active 상태, 실제 브라우저와 Vercel Production 검증

## 배포와 롤백

최신 `origin/main`에서 만든 `codex/supabase-recurrence-prevention` 격리 worktree에서 구현한다. 데이터 삭제나 backfill은 없다.

- 코드 롤백: 이전 `main` 커밋으로 되돌린다.
- RPC/RLS 롤백: 새 migration의 이전 정책 계약을 복원하는 follow-up migration만 사용한다. 적용된 migration 파일을 수정하거나 삭제하지 않는다.
- cron 롤백: 서비스 역할 전용 manager로 disable할 수 있으며, customer provider 발송을 복구 수단으로 사용하지 않는다.
- 유료 플랜 변경은 이번 배포에 포함하지 않는다.
