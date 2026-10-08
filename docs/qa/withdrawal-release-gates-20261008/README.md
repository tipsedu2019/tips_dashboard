# 퇴원 최종 격리 검증 — P1으로 릴리스 보류

사용자가 직접 승인한 범위는 “운영 데이터는 변경하지 말고 격리 합성 cron·30초 timeout·브라우저 저장 E2E 검증”이다. 운영 SQL, 실제 학생 변경·완료, 알림 발송·재발송, 배포는 수행하지 않았다.

검증한 퇴원 소스는 `53605f580196413241b592a8d7dd1d40f71629a8`이다. 최신 main `31a893c4bf1a41ae03301f3ddd9a9ddbed1db709`을 별도 feature worktree에 충돌 없이 통합했다. 통합 후 퇴원 SQL 네 파일과 앱 변경 파일은 원 검증 소스와 같다. 이번 검증에서 제품 로직이나 전역 운영 timeout·권한을 변경하지 않았다.

## P1: 실제 cron에서 30초 제한이 작동하지 않음

Supabase PostgreSQL 17.6.1.159 / pg_cron 1.6.4, `cron.use_background_workers=on`인 네트워크 격리 fixture에서 실제 named job의 매분 tick을 실행했다. 일곱 합성 학생 행에 별도 transaction으로 잠금을 잡고 정확한 제품 명령을 실행했다.

```sql
set statement_timeout = '30s'; select dashboard_private.process_due_withdrawal_roster_releases_v1();
```

job 13 / run 8 / PID 2778의 worker가 종료한 최종 기록은 **35,081.304ms, succeeded, SELECT 1**이다. `57014` 취소나 전체 transaction rollback이 일어나지 않았고, 일곱 `55P03` 잠금 실패와 attempt_count=1이 commit됐다. 명단·금액·비용 체크·기존 알림/발송 기록은 이 실패 구간에서 유지됐다. 잠금을 풀고 별도 job 14 / run 9의 실제 다음 분 tick으로 일곱 예약의 자연 재시도는 통과했으나, 이는 30초 제한 실패를 해소하지 않는다.

[pg_cron 1.6.4 소스](https://github.com/citusdata/pg_cron/blob/v1.6.4/src/pg_cron.c)는 background worker가 SQL 문자열을 실행하기 전에 기존 StatementTimeout으로 타이머를 설정함을 보여준다. SET이 타이머 설정보다 늦게 실행되는 구조가 원인일 수 있다는 설명은 소스에 근거한 추론이며 원인을 유일하게 확정하는 계측은 하지 않았다. CommandComplete의 중간 SET 성공을 최종 성공으로 취급하지 않도록 실제 PID 종료까지 대조했다. 최초 중간 상태 오판은 별도 실패 attempt로 보존했다.

운영의 pg_cron 실행 방식은 조회하지 않았다. 운영에서도 동일 설정이라고 단정하지 않으며, 현재 후보가 요구하는 30초 실행·rollback 보장을 입증하지 못했으므로 **릴리스 보류**다. readiness=true나 cron 이력의 succeeded는 이 보장을 대신하지 않는다.

## 실제 검증 범위

| 검증 | 결과 |
| --- | --- |
| 빈 격리 DB, 전체 순차 적용 | 퇴원 소스 기준 151 migration, 기준 스키마·선행 파일 포함 158/158 통과 |
| 최종 함수 pgTAP | 완료 96/96, 마지막 수업일·예약 경계 123/123 통과 |
| 실제 자동 cron | 24/24 통과. D 당일·미래 유지, D 이후 제외, 잠금 실패·저장된 backoff·자연 재시도, 중복 worker 방지 |
| 실제 native scheduler 관리 | 18/18 통과. install/disable/remove, 비활성 job 재생성, pending 보존, 새 확장 권한 0 |
| 30초 실제 취소·전체 rollback | **실패**, 위 P1 |
| 실제 브라우저 저장 | 데스크톱 1440px·모바일 390px의 9개 논리 사례 통과. 아래 실패 attempt와 복구 실행을 구분 |
| 최신 main 통합 검사 | 관련 9개 파일 135/135 통과, 실패·스킵 0. 타입·migration layout 통과. lint 오류 0, 경고 7 |

브라우저는 원본 앱의 화면과 서비스에서 고정된 SQL bridge를 거쳐 실제 함수·RLS·receipt·COMMIT·재조회를 실행했다. 합성 인증 context를 사용했으므로 JWT 서명 검증, Supabase Auth 서비스, PostgREST HTTP transport의 검증은 아니다. 새 앱 코드가 없는 화면 모사나 응답만 고정한 저장 테스트로 세지 않는다. 실제 provider 요청은 차단되어 외부 발송 0이다.

관리자·직원 비용 확인 저장과 재조회, 다른 관리자가 먼저 같은 값으로 저장한 경우의 no-op, 이미 명단에 없는 미래 요청 완료, 명단이 있는 미래 요청의 완료·예약, 재등록 충돌 `23514`, 교사에게 실제 배정된 행의 읽기 전용 표시(1440/390), 응답 유실 후 동일 요청 ID 재시도를 확인했다. 별도 교사 RPC 호출도 `42501`로 거부됐다.

최초 중복 재시도는 실제 첫 저장 후 503 응답을 받았으나 테스트의 alert locator가 중복 요소를 선택해 중단됐다. 최초 receipt를 삭제하지 않고 합법적인 비용 확인 RPC로 새 baseline을 만든 뒤 새 실행에서 같은 열린 화면·같은 UUID로 503→200 재시도를 검증했다. 모바일 명단 없음 사례도 필터 sheet의 이중 닫기 때문에 저장 전에 멈춘 최초 attempt를 보존하고 정상 click/visible 확인으로 harness만 수정하여 재실행했다. 제품 코드를 바꾸거나 실패 로그를 성공으로 덮지 않았다.

최종 DB 대조에서 새 중복 요청의 실제 SQL 호출은 두 번이지만 receipt와 비용 확인 audit 증가는 각각 한 건이었다. audit의 request_id는 NULL이므로 독점 실행 구간의 해당 업무 delta로 대조했다. 7개 판매·7개 상세·14개 수납/미납 import의 전체 JSON과 기존 등록 parent/batch/claim은 보존됐다. 미래 명단 있음 사례는 완료 후 pending 1건과 양방향 명단·활성 claim을 유지했고, 이미 명단 없음 사례는 예약·재추가 0이었다. 정상 완료 두 건만 notification event/fanout을 각각 55→57로 늘렸으며 delivery·HTTP 요청·응답은 0이다.

최신 main의 AI9 migration은 별도 담당자의 기존 운영 적용 범위이며 이번에 다시 설치하지 않았다. 9개 신규 SQL의 정적 조사에서 기존 퇴원 함수·ACL·ops 알림 source trigger를 재정의하는 충돌은 없었다. 다만 profiles FK/행 잠금, classes/schedule SHARE 잠금 등 공유 상호작용이 있으므로 통합 runtime PASS로 확대하지 않는다. 이 격리 DB는 AI9을 합친 160개 migration replay의 증거가 아니다. 새 main 기준 필수 CI 세 검사의 성공도 이 보고서에서 주장하지 않는다.

## 변경과 운영 경계

Chat 시스템 템플릿의 일정은 `퇴원기준일(마지막 수업일): 날짜 · 회차`로 바꾼다. 미래 예약은 서울 날짜 D까지 실제 명단을 유지하고 D 이후 처리한다. 이미 제외된 학생은 재추가하지 않으며, 비용 확인 미완료 상태에서도 권한·MakeEdu·명단 정합성 guard를 통과하면 완료한다. 완료 후 비용 확인 RPC는 확인 flag만 변경하고 금액·미수금·결제·교재 청구를 변경하지 않는다.

최신 main 대비 SQL 설치 후보는 아래 **네 파일뿐**이다. PR97 및 AI9을 재설치하거나 운영 ledger를 추정하지 않는다.

| 파일 | SHA-256 |
| --- | --- |
| `20261006080000_withdrawal_chat_last_lesson_wording.sql` | `7b6907586c58aa2e29396cead1830cfe4167f610250e8bf0184c48cbba3785ca` |
| `20261006090000_withdrawal_last_lesson_release.sql` | `b1060906d750280cacb3ff78d043ad5a5cd551c30638f8121920e40226f3733e` |
| `20261006091000_withdrawal_future_roster_boundary.sql` | `59b76d0271adacbddb49896adc272a889314766caa58f61534f7dc45ab71c009` |
| `20261007141548_withdrawal_completion_without_settlement.sql` | `221a7f214457ea6f02e86b5e2775b749cbfe2dce64708fce3c3e262b202e74fe` |

신규 public V3/capability/비용 확인 RPC는 authenticated EXECUTE이고 내부 사용자 권한을 검사한다. service_role 전용 scheduler manager는 postgres 소유 SECURITY DEFINER이며 cron.schedule/unschedule만 사용한다. private queue·worker에는 API role 직접 권한을 주지 않는다. private 날짜 조회 helper 3개는 인증 검증 후 제한된 날짜 DTO를 제공한다. 기존 core·reader의 owner/ACL은 유지한다. 상세 signature는 [권한·단계·rollback 검토안](../withdrawal-release-gates-20261007/rollout-plan.md)에 있다.

Migration 적용은 cron을 자동 설치·활성화하지 않는다. 실제 운영 설치·활성화는 승인하지 않았고 실행하지 않았다. rollback 검토안은 해당 job unschedule 후 실행 중 worker 종료를 확인하고 pending·claim·receipt·audit을 보존하는 것이다. 명단 재추가·금액 변경·알림 재발송·옛 즉시 제외 core 복원은 포함하지 않는다. 이전 90000 파일이 이미 운영에 기록돼 있다면 수정 파일 재실행이나 ledger repair 대신 별도 후속 migration이 필요하다.

## 증거와 한계

원본 실행 로그·실패 attempt·SQL trace·합성 screenshots는 외부 QA 산출물 `withdrawal-release-gates-20261008-approved`, `withdrawal-e2e-20261008-approved`, `withdrawal-main-integration-20261008`에 보존한다. 최종 JSON은 확인한 통과와 실패를 별도로 기록한다.

[검증 요약과 증거 SHA-256](verification.json)에 실제 결과를 고정했다. 기존 읽기 전용 21개 업무의 전체 snapshot과 금액·예약도 비교 구간에서 동일했다. 이 baseline은 초기 비용 저장 이후, 두 완료 이전에 수집됐으므로 모든 UI 쓰기 이전 snapshot이라고 주장하지 않는다. 모든 변경 진입점의 write allowlist는 별도의 합성 업무 7개로 한정됐다. 최종 cron 제거 후 readiness=false·대기 예약 3건 보존을 확인했고, 소유한 브라우저·앱·client·DB 컨테이너·socket volume을 종료·제거했다. DB PID 0과 컨테이너/volume 부재를 확인했으며 다른 작업의 탭이나 프로세스는 건드리지 않았다.

원본 JPEG `libfile_ec89813b7bfc8191abd64e21fd5e4f19`는 Library의 지원 materialization 경로와 한 번의 bounded retry가 실패해 Mac 로컬 픽셀을 확보하지 못했다. 이번 합성 화면 캡처는 첨부 이미지 확인의 대체 증거가 아니다. 자연 자정 경과, 운영 실제 cron 설정·데이터·Auth/전송 서비스, 운영 배포 결과는 미검증이다.
