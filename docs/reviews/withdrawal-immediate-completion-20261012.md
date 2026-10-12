# 수업 종료 후 퇴원 완료와 기존 예약 전환

최초 기준 main은 `372c6a9930f0fe673433cbce90bb586ff9b33ead`이며, 성능 통합 #137이 반영된 최신 main `5dbce0da9cb325d57d2ef7d464de21020b6c0867`을 정상 merge했다. 해당 성능 변경을 보존하며 운영자/API #133 등과 별도 브랜치다. 병합·운영배포는 부모가 조율한다.

사용자가 확인한 업무 계약은 **마지막 수업 당일까지 수업을 마친 뒤 퇴원서를 제출**하는 것이다. 제출과 관리자의 완료는 별개다. 제출 시 명부를 제외하지 않는다. 완료는 서울 날짜 기준 당일 또는 과거일에만 가능하며, 해당 수업의 명부와 정확한 활성 등록 소유권을 같은 트랜잭션에서 제외한다. 이미 제외된 학생은 다시 추가하지 않고 완료하며 수업료·교재비 확인/실제 회계는 독립적으로 보존한다. 미래 날짜 완료는 `23514 / withdrawal_last_lesson_date_in_future`로 거부하고 데이터와 receipt를 전부 보존한다. 수업 종료 시각 자체는 저장하지 않으므로 당일 수업을 마쳤다는 운영자의 완료 동작을 전제로 한다.

기존 최종 core는 `20261006090000` 예약 patch와 `20261007141548` 완료 patch에 의해 명부가 있는 당일/미래 건을 예약했다. 새 migration `20261012102015_withdrawal_immediate_completion.sql`은 그 branch만 제거한다. 기존 인증·권한·부모→track→학생→batch→claim→class 잠금, reciprocal 배열 검사, 등록 세대 보호, wrapper/notification source, request/mutation receipt replay, 두 실제 동시성 `40001`은 유지한다. public runtime은 `withdrawal_immediate_completion_v3`로 변경된다. 새 앱은 이전 runtime에서 완료를 거부한다. 이전 앱은 새 runtime에서 완료를 거부하므로 **SQL 설치와 앱 배포 사이 완료·비용확인 편집을 정지하고 stale 탭을 새로고침**한다.

## 보존과 cron 전환

- 새 완료는 queue를 INSERT하지 않는다. 신규 BEFORE INSERT trigger가 새 예약을 `23514 / withdrawal_release_new_reservation_retired`로 차단한다. CREATE TRIGGER의 관계 잠금은 이미 미커밋인 기존 INSERT가 끝날 때까지 기다리며, 설치 뒤에 INSERT하는 실행 중 구형 완료는 전체 rollback된다. 기존 table/index/immutable snapshot trigger/readers/worker/receipt/학생/등록/회계 이력을 삭제하지 않는다.
- installer는 worker를 실행하지 않으며 pending 또는 학생을 일괄 처리하지 않는다. pending이 0이면 해당 cron만 제거한다. pending이 있으면 byte-for-byte 그대로 두고 현재 cron을 유지한다.
- 기존 worker는 오직 `pending`, `last_lesson_date < 서울 오늘`, `next_attempt_at <= 현재`만 처리한다. 미래/당일 pending은 조기 제외하지 않으며 실패/backoff/세대 변경 처리는 기존 계약을 유지한다. 일반 명부 누락 복구 기능이 아니다.
- worker가 마지막 pending을 안전하게 `applied` 또는 `superseded`로 만든 뒤 cron 제거를 시도한다. 실패/미래 pending이 남으면 cron이 유지된다. 이 때문에 제거 시각을 임의로 확정할 수 없다.
- 신규 private retire helper는 browser/service_role에 실행권한을 부여하지 않는다. worker advisory lock과 scheduler-name lock을 얻고, pending이 0이며 정확한 jobname/매분 schedule/`postgres` owner/current database/명령이 일치하는 단일 job에만 `cron.unschedule(text)`을 사용한다. `busy`/`drifted`/`unavailable`이면 보존한다. job ID 9를 하드코딩하지 않는다. 다른 cron과 job_run_details는 삭제하지 않는다.
- cron unschedule은 실행 중 transaction을 강제 종료하지 않는다. 공통 worker lock으로 migration/다른 worker와 retirement를 직렬화한다. 새 요청은 예약 receipt를 만들지 않지만 기존 완료 요청의 **동일 request ID 재시도는 원래 예약 receipt**를 그대로 돌려준다.

## 부모에게 명시하는 운영 SELECT 범위 — 실행하지 않음

이전 Supabase SQL 조회가 `user cancelled`였으므로 이 작업에서는 해당 조회를 재시도하거나 CLI/다른 연결로 우회하지 않았다. 운영 SQL과 실제 pending 일괄 처리는 부모의 배포 순서 조율 전까지 보류한다. 필요 최소 읽기는 아래와 같다. **조회 자체도 부모가 범위를 먼저 확인한 뒤 기존 승인된 연결에서 수행**한다.

1. 관련 runtime/core/worker/retire/manager의 `pg_proc` signature, owner, ACL, definition hash 및 대상 migration 설치 version/name만 조회한다. 설치 함수 정의 비교가 필요하면 해당 함수만 읽으며 전체 catalog/schema dump를 하지 않는다.
2. queue의 status별 count와 pending의 due/today/future/backoff/error-code별 count, min/max last_lesson_date, expected claim 유무/원본 task 존재 여부별 count만 조회한다. 학생 이름·연락처·명부 또는 실제 queue row를 가져오지 않는다.
3. `cron.job`은 `jobname='tips-withdrawal-roster-release-v1'` 행의 jobid/name/owner/database/schedule/active/command만 조회한다. 알려진 job9와 일치 여부를 확인한다. 해당 worker 실행 세션은 `pg_stat_activity`의 pid/state/xact_start만 좁혀 읽는다. 다른 cron 삭제/변경은 허용하지 않는다.

pending>0이면 기존 exact cron이 실제 active/ready인지 먼저 확인한다. scheduler가 없거나 drifted/disabled인 상태에서 pending을 자동 수리하거나 삭제하지 않는다. 부모에게 blocker를 보고하고 복구 범위를 정한다. 기존 cron이 정상이라면 설치 후 이전 D+1 규칙대로 legacy pending의 처리가 이어질 수 있다는 **정확한 영향**을 전달한다. 실제 pending을 수동 `process_due...` 일괄 처리하는 행위는 이 PR의 작성/검증 승인에 포함되지 않으며 개별 영향과 회복 계획을 별도로 확인한다.

## 적용·복구 제안 — 실행하지 않음

운영자가 마지막 수업을 마쳤는지 확인하고 완료 편집을 정지한다. 직전 main/검증된 운영 release SHA, 관련 함수 정의·owner/ACL, 해당 cron metadata, pending 집계/target migration 미설치 상태를 rollback anchor로 기록한다. 새 migration 한 파일을 기존 검토된 transport에서 원자적으로 설치한다. pending0이면 cron 제거, pending>0이면 queue/cron 보존을 확인하고 runtime/ACL·함수 계약을 검증한다. 부모가 최신 main과 다른 PR의 순서를 확정하고 로컬/필수 검사 근거를 갱신한 뒤 앱 배포·새로고침·실제 허가된 업무 acceptance를 조율한다. 이 PR은 merge/deploy/실학생 완료를 수행하지 않는다.

- 설치 트랜잭션 실패: core/worker/runtime/새 private helper/cron 제거가 모두 rollback된다. pending과 학생은 installer가 변경하지 않는다. 상태부터 다시 읽고 맹목 재실행하지 않는다.
- 설치 후 앱 문제: 완료 편집을 멈추고 앱을 이전 검증 release로 되돌린다. old 앱+new SQL의 완료는 capability mismatch로 멈추므로 자동 명부 제거 fallback이 없다.
- 이전 DB 동작도 필요한 경우: 검토된 [rollback SQL](../../supabase/rollbacks/20261012102015_withdrawal_immediate_completion.sql)을 별도 조율된 운영 실행으로 사용한다. worker lock을 얻고 이전 core/worker/runtime과 정확한 cron을 같은 transaction에서 복원한다. 함수/ACL과 데이터 digest 보존을 합성 DB에서 검증한다. drifted cron이면 기존 manager가 안전하게 전체 rollback시킨다. migration ledger는 이 스크립트가 수정하지 않으며 실제 ledger 기록 방식은 부모가 별도 결정한다.
- **완료 후 제외된 학생을 rollback이 재추가하지 않는다.** 이미 생성된 완료·제외·정산·통지 이력은 유지한다. 데이터 교정이 필요한 실제 학생은 새 등록 또는 검토된 개별 업무로 다루며 일괄 원복하지 않는다. 영구 table/history/student 삭제, 새 키·권한·비용, 다른 cron 변경은 없다.

## 검증 기록

검증 소스는 `84e5bee57093bdcfa9c5bca8b299a56a5ee0ae02` / tree `94bee091a7f4695403b138e8bd2273ba9a6b08e5` / base `5dbce0da9cb325d57d2ef7d464de21020b6c0867`이다. 후속 문서 기록은 제품·SQL·테스트를 변경하지 않는다.

- 새 migration SHA256: `4283c5a46522d473a710913ffe564bb2796ebc80a200210055165cc88abc8eac`; rollback: `e68ccffa8c538ca187b1666e20354da99e0f84d0cce9c75b5dd553f19c791d2d`.
- 격리 PostgreSQL 17.11, 실제 pgTAP 1.3.3/pg_cron 1.6.5/pg_net 0.19.5, socket 전용, TCP·cron 자동 실행·pg_net 발송 worker 차단. immutable baseline과 합성 prerequisite 뒤 166 migration 순서대로 재생했다.
- 최종 SQL 566/566 통과: 당일/과거/미래/이미 제외/비용 조합/실제 authenticated 역할/중복/취소/late failure/완료 rollback/기존 pending/INSERT fence/cron command·schedule drift/다른 cron 불변을 포함한 퇴원 372개, 기존 transfer 194개.
- checked-in rollback→재적용 실제 실행, 이전 165 migration 전체 chain과 core/worker/runtime definition·owner·ACL·config byte-identical 비교 통과. 합성 학생 4/기존 due·future·backoff pending 3/새 완료 1과 관련 12 table digest가 전후 동일하다. installer가 실제 due pending도 실행하지 않으며, pending이 있으면 cron 전체 metadata를 보존한다. 새로 완료한 학생은 rollback에도 재추가하지 않는다.
- 실제 두 세션 worker lock 및 scheduler-name lock 경쟁에서 retire=`busy`, cron·전체 데이터 보존 통과. 구형 public V3→cached old core의 뒤늦은 INSERT가 `23514`로 거부되고 전체 업무 데이터가 보존됨을 실제 두 세션/pgTAP 11개로 확인했다. 구형 미커밋 INSERT가 CREATE TRIGGER의 ShareRowExclusiveLock을 실제로 대기시키고 5.012초 뒤 `55P03`으로 installer 전체 rollback된 뒤, 원래 INSERT commit 후 재설치 시 pending·오류·backoff·cron이 보존됨을 pgTAP 10개로 확인했다.
- 최신 main 기준 관련 Node 94/94 및 타입 검사 통과. 변경 파일 ESLint 0 error/기존 warning 3. SQLSTATE/layout/immutable-final manifest/query-surface diff 검사 통과. 이전 기준의 확장 Node 134/134(layout mutation 검증 포함)도 통과했으며 최신 검증과 구분한다.
- 기존 `withdrawal-completion-without-settlement` Node fixture는 현재 main에서 이미 허용된 transfer의 제외 명부를 여전히 차단한다고 기대해 원본 main과 변경본 모두 실패했다. 실제 제품 transfer를 변경하지 않고 fixture의 기대만 현재 계약에 맞췄으며 별도 기존 transfer SQL 194개를 통과했다. 초기 SQL alias/중간 timezone 변경 fixture 실패는 수정 후 전체 대상 suite를 재실행했다. timezone 변경은 기존 audit hash 규칙에 영향을 주므로 최종 suite는 처음부터 Pacific/Kiritimati를 유지해 서울 날짜 계산을 검증했다.

공식 Supabase provider image를 로컬 Docker에 준비하는 시도는 공개 다운로드 제한/daemon 디스크 부족으로 실패했다. 무료 native PG로 대체하여 제품 객체를 검증했지만 최소 합성 Auth/Storage adapter와 실제 Supabase ledger 부재로 baseline catalog parity 27/1,923 및 baseline smoke 1/14 차이가 남았다. 이를 공식 `supabase-schema-contract` 전체 통과나 운영 호환성 증거로 계산하지 않는다. 원래 checker/assertion, CI workflow, ACL/RLS 또는 timeout을 약화하지 않았다. GitHub 추가 유료 실행이나 결제 변경을 요청하지 않으며 `[skip ci]`는 hosted required checks 통과를 의미하지 않는다.

합성 증거는 운영 권한·실제 학생 처리·실제 발송·운영 적용 성공을 대신하지 않는다. 운영 DB 조회·migration·pending batch 실행·main merge·manual deploy는 수행하지 않는다. 독립 reviewer는 위 exact HEAD/tree와 실제 경합·rollback 원자료를 검토하고 이전 전환 경합/cron schedule 지적의 해소 및 blocking finding 0을 확인했다. 별도 독립 Node 35/35 통과. 나머지 local static gates 결과와 최종 문서 commit의 제품·SQL·테스트 동일성은 인계 문서/PR에 기록한다.
