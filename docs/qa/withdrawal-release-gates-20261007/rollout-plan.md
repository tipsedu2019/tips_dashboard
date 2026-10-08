# PR115 단계 적용 검토안 — 실행하지 않은 운영 계획

**2026-10-08 갱신: 운영 적용 보류.** 실제 격리 background-worker cron에서 30초 timeout이 작동하지 않았다. 아래 단계안은 실행 승인이 아니며 새 결함을 해결한 뒤 다시 검토해야 한다. 최신 기준 main은 `31a893c4bf1a41ae03301f3ddd9a9ddbed1db709`, 검증한 퇴원 파일은 `53605f580196413241b592a8d7dd1d40f71629a8`과 바이트가 같다. 아래 네 SQL의 SHA·ACL·비자동 cron 설치·rollback 범위는 그대로이며 AI9 migration은 설치 대상에 추가하지 않는다. 최신 [검증 기록](../withdrawal-release-gates-20261008/README.md)을 함께 확인한다.

검토 기준: PR115 `240eff71fe5a997dc641eafadeb701f88d1fd925`에 아래 manager 권한 수정과 합성 fixture 수정을 더한 후보, main `58cefbf4761ede0d3b7f4cf588e2a4daea05b458`. 이번 추가 작업은 격리 합성 검증이다. 이 문서 작성은 운영 SQL, 학생 완료, 발송, 배포, scheduler 활성화의 실행 기록이나 승인으로 해석하지 않는다. AI DB 설치 담당 `01a116c5`와 부모 작업의 설치 순서 확인 전 운영 쓰기는 시작하지 않는다.

## 권고

이미 검증한 PR115의 네 SQL과 앱을 적용하되 **새 cron 작업의 설치·활성화는 별도 단계**로 둔다. 이 단계는 이미 명단에서 제외된 요청과 기준일이 지난 요청의 완료 차단, 완료 후 비용 확인, 중립 Chat 문구를 제공한다. 명단이 남아 있는 오늘·미래 요청은 scheduler 준비 전 `55000 / withdrawal_release_scheduler_not_ready`로 차단한다. 미래 요청을 조기에 완료할 수 있는 전체 기능은 두 번째 단계에서 제공한다.

이는 런타임 활성화를 나눈 방안이다. 첫 단계에도 queue, worker, 미래 조회 함수와 신규 RPC 권한이 설치되므로 DB 스키마가 작은 문구 전용 변경이라고 설명하면 안 된다. 이미 선택한 “기준일까지 명단 유지” 정책은 두 단계 모두 보존한다.

queue·worker가 아예 없는 별도 완료 수정도 작성할 수 있으나, 오늘·미래 완료를 별도 business guard로 제한해야 한다. 또한 PR115의 함수 생성 및 기존 함수 anchor와 충돌하여 이후 예약 기능을 다른 migration으로 다시 검증해야 한다. 별도 3파일 문구 patch는 기존 main `58cefbf4` 기준 산출물이며 최신 main `31a893c4` 적용 가능성을 재검증하지 않았다. 이를 최신 통합 후보의 대체 설치안으로 사용하지 않는다. 문구만의 변경으로는 완료 차단이 해결되지 않는다.

## 단계별 동작

| 현재 선택 수업 관계 | 기준일 | DB+앱, cron 미준비 | cron 준비 후 |
| --- | --- | --- | --- |
| 양방향 명단 없음, 해당 활성 claim 없음 | 과거·오늘·미래 | 재추가 없이 완료, queue 없음 | 동일 |
| 양방향 명단 있음 | 서울 기준 오늘 이전 | 기존 원자적 제외 후 완료 | 동일 |
| 양방향 명단 있음 | 서울 기준 오늘·미래 | 오류, 완료·명단·예약 변화 없음 | 완료+예약, 기준일 당일까지 명단·claim 유지 |
| 명단/claim 불일치·대기 관계·재등록 충돌 | 모두 | 기존 정합성 오류 | 동일 |

어느 성공 경로도 수업료·교재비 확인 여부로 완료를 막지 않는다. MakeEdu 확인과 정확한 학생·수업 ID, 권한 및 등록 정합성 검증은 유지한다. 금액·미수금·결제 이력·교재 청구는 완료나 확인칩 변경으로 정산·취소하지 않는다. 실제 완료 호출은 기존 canonical 완료 알림을 만들 수 있으므로 운영 점검용으로 호출하지 않는다.

## 설치 대상과 선행 순서

기존 PR97 DB를 다시 설치하지 않는다. 현재 운영 ledger와 실제 최종 함수 정의는 담당자 확인 대상이며 로컬 main과 같다고 추정하지 않는다. 다른 릴리스의 미적용 migration까지 함께 실행하는 일괄 push는 사용하지 않는다. 아래 네 파일의 필요 여부·순서·SHA를 승인된 운영 담당자가 확인한다.

| 순서 | 파일 | SHA-256 |
| --- | --- | --- |
| 1 | `20261006080000_withdrawal_chat_last_lesson_wording.sql` | `7b6907586c58aa2e29396cead1830cfe4167f610250e8bf0184c48cbba3785ca` |
| 2 | `20261006090000_withdrawal_last_lesson_release.sql` | `b1060906d750280cacb3ff78d043ad5a5cd551c30638f8121920e40226f3733e` |
| 3 | `20261006091000_withdrawal_future_roster_boundary.sql` | `59b76d0271adacbddb49896adc272a889314766caa58f61534f7dc45ab71c009` |
| 4 | `20261007141548_withdrawal_completion_without_settlement.sql` | `221a7f214457ea6f02e86b5e2775b749cbfe2dce64708fce3c3e262b202e74fe` |

90000의 이번 수정은 아직 배포하지 않은 후보 파일에 한정된다. 운영에 이전 90000 SHA가 이미 기록됐다면 수정 파일을 재실행하거나 ledger hash를 맞추지 않는다. 기존 적용 여부와 정의를 확인하고 별도로 검토한 후속 migration이 필요하다.

각 SQL은 독립 transaction이며 lock timeout은 5초, statement timeout은 120초다. 중간 실패 시 실제 완료 지점과 정의를 확인하고 blind retry, migration repair, 옛 함수로의 복원을 하지 않는다.

DB를 먼저 적용하는 동안 90000이 기존 공통 core에도 오늘·미래 readiness guard를 추가한다. 마지막 41548까지 성공한 후 새 앱을 반영한다. 중간 DB runtime은 새 앱의 capability와 일치하지 않아 새 앱은 완료/비용 확인을 거부한다. 기존 앱에는 비용·명단 UI blocker가 남아 있으므로 DB만으로 화면의 문제가 해결되었다고 보지 않는다.

## 정확한 DB 진입점과 신규 권한

| 대상 | 역할·변경 |
| --- | --- |
| `dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid,text)` | 최종 공통 core를 anchor 검증 후 갱신. 기존 owner/ACL 유지 |
| `public.complete_ops_withdrawal_roster_transition_v3(uuid,uuid)` | 신규. 기존 V2 canonical wrapper에 위임. authenticated만 EXECUTE |
| `public.withdrawal_last_lesson_release_runtime_version()` | 신규 capability. 최종 값 `withdrawal_completion_without_settlement_v2`. authenticated만 EXECUTE |
| `public.update_ops_withdrawal_settlement_check_v1(uuid,text,boolean,boolean,uuid)` | 신규. authenticated만 EXECUTE, 함수 내부에서 활성 관리자/직원과 완료된 퇴원 업무를 재검증 |
| `public.manage_withdrawal_roster_release_scheduler_v1(text)` | 신규. service_role만 EXECUTE, postgres 소유 SECURITY DEFINER. `inspect/install/disable/remove` |
| `dashboard_private.process_due_withdrawal_roster_releases_v1(integer)` | 신규. API 각 role의 EXECUTE 없음. postgres worker 전용, 최대 100건, lock timeout 5초 |
| `dashboard_private.withdrawal_roster_release_queue_v1` | 신규 private 표. RLS, API 각 role의 직접 권한 없음. 불변 snapshot과 등록 세대 검증 |
| `public.get_dashboard_statistics_sources_v1(text,text,text,date,date)` / `public.get_dashboard_conflict_sources_v1(date,date)` | 최종 정의를 patch하여 보류 예약의 기준일을 미래 통계/충돌 조회에 반영. 기존 owner/ACL 유지 |

추가로 private 날짜 조회 helper 3개에 authenticated EXECUTE를 부여한다. `auth.uid()`와 authenticated role을 검증하고, 공개 DTO는 학생 ID·수업 ID·마지막 수업일만 포함한다. queue/task/claim/actor ID나 변경 진입점은 공개하지 않는다. service_role에 queue 직접 조작 권한이나 worker 직접 EXECUTE를 주지 않는다.

새 cron job은 기존 job 설정 변경과 별개다. 정확한 이름은 `tips-withdrawal-roster-release-v1`, 주기는 매분 `* * * * *`, 실행자는 postgres, DB는 현재 DB다. 명령은 `set statement_timeout = '30s'; select dashboard_private.process_due_withdrawal_roster_releases_v1();`다. migration 적용만으로 job을 만들거나 활성화하지 않는다. manager의 `install`은 기존 동명 job의 내용 차이나 중복을 거부한다. 일치하는 활성 job은 유지하고 비활성 job은 제거 후 재생성한다. `disable`과 `remove`는 모두 해당 job을 unschedule하며 queue는 보존한다. 재설치 시 job ID는 바뀔 수 있다. 새 role이나 HTTP 서비스는 만들지 않지만, service_role이 postgres 소유 scheduler 관리 함수를 호출할 권한은 신설한다.

실제 Supabase 이미지의 확장 소유자는 supabase_admin, manager 소유자인 postgres는 비 superuser다. 이 구성에서는 cron.job 직접 UPDATE뿐 아니라 cron.alter_job EXECUTE도 거부됐다. 권한을 확장하지 않고 기존에 허용된 schedule/unschedule을 사용하도록 후보를 수정했다. named schedule 재호출은 기존 active=false를 유지한다는 실제 결과에 따라 비활성 job은 제거 후 재생성한다. [pg_cron 공식 관리 API 문서](https://github.com/citusdata/pg_cron#managing-and-creating-jobs)와 실제 확장 ACL·실행 결과를 함께 대조했다. 기존 240eff71의 manager는 이 구성에서 중지에 실패하므로 수정 전 후보를 설치 대상으로 사용하지 않는다.

## 운영 담당자가 별도로 수행할 확인

1. AI DB 담당과 배타적인 적용 순서를 확정하고 PR115의 실제 merge SHA/DB 4파일 SHA, 기존 ledger, core와 reader 2개의 최종 정의를 대조한다. 기존 job과 알림 설정을 읽어 기록한다. queue나 같은 이름의 job이 이미 존재하면 신규 설치로 추정하지 말고 pending 건수·실제 정의·활성 상태를 먼저 대조한다. 실제 학생의 완료 호출을 사전 점검에 사용하지 않는다.
2. 각 transaction 적용 후 최종 capability, public/private ACL, core에 있는 실제 동시성 충돌 `40001` guard 2개, template version과 active pointer, cron 미생성/미활성화를 읽기 전용으로 확인한다. 템플릿은 일치하는 system 행만 새 version으로 갱신하며 custom·과거 delivery snapshot·알림 활성화 플래그는 바꾸지 않는다.
3. 새 앱을 반영하고 권한별 화면 표시와 capability 읽기를 확인한다. 실제 학생 저장·완료·재송신은 수행하지 않는다. 최초 실제 완료는 일상 업무 권한과 발송 조건에 따른 별도 조작이다.
4. 미래 요청의 조기 완료를 활성화할 때 pg_cron 실행 방식/DB/worker 수/timeout과 새 job 설치를 개별 확인한다. manager `install` 후 readiness와 실행 이력을 읽는다. 기존 job, 전역 cron 설정, 알림 활성화 플래그는 변경하지 않는다. 격리 fixture에서 쓴 전역 launch 설정은 운영 작업에 사용하지 않는다. job 자체가 오류 없이 실행된 것과 각 예약이 성공한 것은 따로 확인한다.
5. 초기 모니터링은 새 job의 최근 실행 결과, 기한이 지난 pending 건수, 최대 지연, attempt_count/last_error_code, 공개 명단 cache 갱신을 최소 집계로 확인한다. worker는 개별 오류를 포착하므로 cron 이력의 succeeded만으로 각 예약의 성공을 알 수 없다. 30초 timeout으로 전체 transaction이 rollback되면 attempt_count도 남지 않을 수 있다.

## 중지·rollback

- **cron 미설치인 1단계:** 앱 문제는 이전 앱으로 되돌릴 수 있다. 이 경우 옛 화면의 비용/명단 blocker가 복구된다. 새 DB 정의는 유지하고 기존 V2/legacy 진입점에도 공통 core의 기준일 guard를 남긴다. 옛 앱과의 실행 계약은 추가 SQL 검증 결과와 대조한다.
- **cron 설치 후:** 새 job을 manager `disable`로 중지하고 readiness=false를 확인한다. 이 동작은 이미 실행 중인 worker를 취소하지 않는다. 실행 중 transaction의 종료와 최종 queue 상태를 확인하기 전에는 중지 완료로 취급하지 않는다. `disable`과 `remove`는 모두 허용된 `cron.unschedule`을 통해 job 메타데이터를 제거하며 예약을 취소하지 않는다. job ID를 유지하는 active=false 방식은 사용하지 않는다.
- **기존 pending 있음:** pending 예약·claim·receipt·audit을 보존한다. 중지 중에는 오늘/미래의 새 예약 완료가 거부되며 기존 명단 제외가 늦어진다. 중지·재개 사이에도 모니터링과 담당자 대응이 필요하다. job을 재개하면 같은 불변 snapshot/등록 세대 검증을 사용한다.
- **학생 변경이 이미 commit됨:** migration이나 앱을 되돌려도 업무 완료·실제 명단 제외·알림 snapshot은 복원되지 않는다. queue 삭제, 명단 재추가, 청구/미수금 변경, 알림 재발송을 rollback에 포함하지 않는다. 개별 업무 정정은 별도 확인한다.
- 공통 core를 옛 즉시 제외 정의로 되돌리면 기준일 당일/미래의 명단을 조기에 제거할 수 있으므로 수행하지 않는다. 부분 적용에서의 복구는 검증된 후속 수정으로 한다. 공통 등록 runtime을 0으로 바꾸는 방법은 등록·수업 이동에도 영향을 주므로 퇴원 전용 중지 스위치로 취급하지 않는다.
- 문구만 문제라면 보존된 옛 template의 active pointer로 되돌리는 제한된 조작을 따로 검토할 수 있다. 기존 version이나 delivery snapshot을 삭제하지 않는다. 자동 rollback이나 이번에 수행한 조작이 아니다.

## 검증 결과 추기

추가 실제 pg_cron tick과 실제 화면→service→SQL→read refresh 결과는 별도 증거에 기록하고 완료 후 본 문서에서 연결한다. 합성 환경의 결과로 운영 DB·실제 학생·provider의 동작을 확인했다고 추정하지 않는다.
