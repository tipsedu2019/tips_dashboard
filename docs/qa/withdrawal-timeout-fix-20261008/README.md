# 퇴원 cron 제한 수정과 릴리스 검증

최종 기준 main은 `b7f2a7c0bb2b814e7746b3df6ba16e6be8015ef5`이다. 최초 검증의 main `31a893c4bf1a41ae03301f3ddd9a9ddbed1db709` 이후 PR117의 agent API 응답 계약 변경을 통합했다. 이 추가 변경에는 SQL이나 퇴원 UI·서비스 변경이 없어 160개 SQL의 바이트·실제 cron 검증은 그대로 유효하다. 사용자의 “이상 없으면 운영배포까지” 요청에 따라 기존 P1을 수정하고 릴리스 검증을 진행한다. 이전 실패·브라우저 실행 기록은 [기존 보고서](../withdrawal-release-gates-20261008/README.md)에 보존한다.

## 변경

- cron 세션에서 `transaction_timeout`을 0 → 30초로 다시 설정한다. PostgreSQL 17의 transaction timeout이 없는 환경과 이전 statement-timeout-only 명령은 readiness를 충족하지 않는다.
- 완료·실제 제외 처리 함수와 UI·권한은 이전 후보와 같다. 기준일 당일까지 명단을 유지하고, 서울 날짜가 기준일을 지난 뒤 예약을 처리한다.
- 서비스의 capability 읽기에 8초 AbortSignal과 자동 재시도 금지를 추가했다. 인자 없이 상수 TEXT 하나를 반환하는 이 RPC만 정확한 scalar 계약에 등록했으며 다른 RPC와 요청 제한 검사는 유지한다.
- cron 중지는 고정된 퇴원 작업 이름의 API만 사용한다. 같은 이름의 작업이 여러 개이거나 소유자·DB가 다르면 거부한다. 같은 소유자·DB의 명령 drift는 복구를 위해 중지할 수 있고, 작업이 없어도 반복 중지가 가능하다.
- 신규 private queue의 시도 횟수는 bigint를 사용한다. 기존 학생별 이력 인덱스를 이용하므로 live 이력 테이블에 선택적 복합 인덱스를 만드는 작업은 제외한다. 기존 인덱스를 삭제하거나 검사 예외를 추가하지 않는다.
- 구 timeout 명령을 준비 완료로 오인하지 않는 두 pgTAP 검사를 추가한다.
- 최종 독립 검토에서 마지막 수업일 표시만으로는 다음 회차 제외 안내가 빠졌음을 발견했다. 일정 아래에 명단이 남아 있으면 기준일까지 수업 후 다음 회차부터 제외 예정이며, 이미 제외된 학생은 기존 상태를 유지한다는 조건부 안내를 추가했다. 새 토큰·학생 조회·알림 발송은 추가하지 않는다.

## 로컬 검증

| 확인 | 결과 |
| --- | --- |
| 최신 main 통합 Node 테스트 | 220/220, 실패·스킵 0 |
| migration layout / domain SQLSTATE | 통과 |
| workflow 해시·격리 검증 회귀 테스트 | 48/48 통과, 기존 변조 거부 검사 유지 |
| SQL lint | SHA 검증한 Squawk 2.63.0, PostgreSQL 17, 네 migration 모두 경고·오류 0 |
| 프로덕션 빌드 | 합성 loopback 설정으로 성공. 타입 검사 포함 |
| 최신 main 타입·ESLint | 빌드 타입 검사 통과, ESLint 오류 0·기존 경고 7 |
| 이전 브라우저 저장 9개 논리 사례 | frozen536의 실제 저장 증거. 최종 서비스에는 capability 요청 제한이 추가됐으며 전체 병합 앱을 다시 실행한 증거가 아님 |
| capability·query budget 회귀 | 170/170 통과, 오류·스킵 0. 8초·재시도 금지와 오류 시 후속 저장 0 확인 |
| 운영 guard 회귀 | 17/17 통과. 기존 광범위 cron 삭제 거부 유지 |
| 최종 문구·adapter | 18/18 통과, 다음 회차 안내와 기존 제외 상태 보존 문장을 실제 Chat 카드까지 확인, 외부 요청 0 |
| 실제 브라우저·설치 SDK capability 취소 | 8,008.6ms 종료, POST 1회, 추가 2초 관측 동안 재시도·후속 저장 0, 소유 브라우저·서버 정리 완료 |
| 독립 소스 검토 | 통과. worker/core/비용 확인 함수 변경 0, ACL/역할/전역 설정 변경 0 |
| 최종 소스의 fresh replay | 160 migration + 선행 7파일, 167/167 통과 |
| 최종 pgTAP | 완료 96/96, 날짜·예약 경계 125/125 |
| 최종 문구 SQL | 52/52 통과, 시스템 Chat 6개 전환·기존 snapshot/사용자 편집 보존·재적용 no-op·발송 0 |
| 실제 DB 정의 비교 | 기존 6e3 대비 함수 1,112개 중 manager 정의만 변경. 다른 1,111개의 정의·owner·ACL·설정 동일 |
| 기존 관련 SQL 6개 suite | 총 772개 통과: 기존 5개 717개 + 인증 준비 수정 통계 55개 |
| 3초 native cron 타이머 진단 | 기본 0초와 상속 60초 모두 실제 25P04 종료·INSERT rollback 확인 |
| 실제 매분 cron | 19개 원 실행 + 이력 범위 정정 후 checkpoint 5개, 총 24개 확인 통과 |
| native scheduler 관리 | 18/18 통과, 권한 변화 없음 |
| 최종 고정 이름 native manager | 75/75 통과: 반복 중지·비활성 재설치·명령 drift 중지·다른 DB/owner/중복 55000·API 역할 42501·pending/명단/권한 보존 |
| 제품 30초 제한, 초기값 0초 | 30,012.624ms / 실제 25P04 / 7개 예약 전체 rollback / 다음 분 자연 재시도 통과, 28/28 |
| 제품 30초 제한, 상속값 60초 | 30,007.467ms / 실제 25P04 / 7개 예약 전체 rollback / 다음 분 자연 재시도 통과, 28/28 |
| 최종 불변식·정리 | 함수 1,112개·트리거 183개 및 권한·설정 동일, 금액·발송 상태 보존, 소유 DB 컨테이너·볼륨 제거 확인 |

실제 매분 검증의 최초 실행은 앞선 타이머 진단 job까지 실행 이력에 포함해 20번째 집계에서 실패했다. 실제 대상 job의 제외·보존·잠금 후 자연 재시도 19개 검사는 통과했다. 원본 실패를 보존한 뒤 정확한 두 job ID의 기존 이력을 대조하고, 남은 중지·삭제·pending 보존 검사를 별도 checkpoint에서 수행했다. 제품이나 테스트 DB 이력을 성공에 맞추어 삭제·변경하지 않았다.

최종 free-tier 검사는 처음 네 위반을 발견했다. capability 요청 제한과 정확한 scalar 계약, 고정 이름 cron API로 보완했다. 이때 함수 존재 확인용 문자열도 cron 호출로 인식하는 검사에 걸려, API 존재 확인을 namespace·함수 이름·입력 text 한 개의 정확한 catalog 조회로 명확히 했다. 검사 코드와 기존 실패 assertion을 완화하지 않았고 두 실패 로그를 보존했다. 수정 후 worktree 전체 free-tier 검사, 타입, 관련 ESLint, 네 SQL Squawk, migration layout과 domain SQLSTATE는 통과했다.

위 30초 실행 두 건과 기존 native 검증은 migration SHA `6e3cbd2c86cc93dcfc284d9815426807f9f90ea3b879fbb3dde92c300963d05d`에서 수행했다. 새 manager의 고정 이름 중지 변경은 별도 fresh 검증으로 구분한다. 30초 증거 재사용 범위는 바이트가 같은 worker·실제 제외 처리·정확한 cron 명령이며 최종 migration 전체를 재실행한 30초 증거로 확대하지 않는다.

합성 빌드의 public-data 조회는 연결되지 않은 loopback endpoint에서 실패했다. 빌드 성공을 운영 데이터·인증·provider 검증으로 확대하지 않는다. 이전 브라우저의 실제 SQL 저장 검증도 합성 인증 context를 사용했으며 Supabase Auth/JWT/PostgREST HTTP 검증은 아니다. 원본 첨부 JPEG는 허용된 materialization 재시도 후에도 확보하지 못했으므로 픽셀 확인은 미완료다.

최종 서비스에서 추출한 실제 capability helper·비용 확인 caller와 설치된 Supabase SDK 2.108.2를 Chromium 148에서 실행해 native AbortSignal 취소를 확인했다. loopback 응답만 지연했으며 SQL·인증 서버·운영 서비스는 사용하지 않았다. 전체 화면 저장 E2E의 재실행이 아니다. 첫 실행은 기본 sandbox의 loopback listen EPERM으로 브라우저 시작 전에 실패했고 원본을 보존했다. 같은 제한된 runner를 정상 권한 승인 경로로 실행한 두 번째 시도가 통과했다.

최신 main은 CI에 agent 응답 계약 테스트 한 줄을 추가했지만 허용 workflow 해시를 갱신하지 않아 layout 검사에 실패했다. 독립 검토 후 verifier와 그 회귀 테스트의 해시 두 상수만 실제 workflow SHA로 동기화했다. 기존 검사·변조 거부 assertion은 유지했다.

기존 통계 SQL 테스트는 인증 role로 조회하면서 JWT context를 뒤늦게 설정하여 새 권한 검사에서 `42501`로 실패했다. 원래의 합성 사용자·profile·JWT 준비 블록을 첫 인증 조회 앞으로 이동했다. 이 첫 수정도 fixture의 auth.role()이 JSON 대신 단일 role 설정을 읽어 42501로 실패했다. 실제 helper 정의와 읽기 전용 진단으로 원인을 확인한 뒤 같은 사용자·역할의 단일 설정도 추가했다. 최종 55개 검사가 통과했고, 두 실패 attempt와 정확한 실행 소스를 별도 보존했다. 제품 권한 검사와 모든 테스트 assertion은 유지했다.

## 설치 후보와 운영 경계

운영 Vercel `tips_dashboard` 프로젝트의 확인된 기존 배포는 `dpl_2Z12fAP4JRQWcR1JtbEhKFPwVoXM`, source `b7f2a7c0bb2b814e7746b3df6ba16e6be8015ef5`, 상태 READY다. 운영 migration 목록에서 아래 네 withdrawal migration은 없다. 목록만으로 out-of-band 설치나 실제 함수 정의가 없다고 단정하지 않는다.

운영 SQL 읽기 전용 설정 조회는 자동 승인 검토가 이전 운영 SQL 금지를 적용하여 거절했다. 해당 쿼리는 실행되지 않았으며, 이를 우회하거나 재시도하지 않고 범위를 명시한 사용자 답변을 기다린다. 운영 DB 변경·cron 활성화·앱 배포는 아직 수행하지 않았다.

| 적용 순서 | 파일 | SHA-256 |
| --- | --- | --- |
| 1 | `20261006080000_withdrawal_chat_last_lesson_wording.sql` | `b33601339abe5ef2f96d553ce0dc1423981225f308be45394a2b81206ce6a30d` |
| 2 | `20261006090000_withdrawal_last_lesson_release.sql` | `4f73f75bbf0aa8f457eb3b1c070281ae3f94dcbf79e20b119f8fb79f0de3e921` |
| 3 | `20261006091000_withdrawal_future_roster_boundary.sql` | `59b76d0271adacbddb49896adc272a889314766caa58f61534f7dc45ab71c009` |
| 4 | `20261007141548_withdrawal_completion_without_settlement.sql` | `221a7f214457ea6f02e86b5e2775b749cbfe2dce64708fce3c3e262b202e74fe` |

PR97와 AI9의 SQL을 다시 적용하거나 전체 migration push/ledger repair를 하지 않는다. 최종 검증·필수 CI·검토 후 승인된 네 파일만 적용한다. 동일 queue·함수·job이나 다른 SHA가 이미 설치되어 있으면 중단하고 추가 migration을 검토한다.

각 SQL transaction은 lock timeout 5초·statement timeout 120초를 가진다. 마지막 SQL까지 성공한 뒤 capability와 ACL, 템플릿 전환, queue 초기 상태를 읽어 확인한다. 실제 학생 완료·비용 체크 저장·알림 발송은 운영 점검에 사용하지 않는다.

새 cron 설치는 별도 명시적 단계다. `manage_withdrawal_roster_release_scheduler_v1('install')`은 service_role 전용이며, 현재 DB의 postgres 실행자·매분 schedule·아래 명령이 정확히 일치해야 한다. 기존 job과 전역 cron 설정은 유지한다.

```sql
set transaction_timeout = '0'; set transaction_timeout = '30s'; set statement_timeout = '30s'; select dashboard_private.process_due_withdrawal_roster_releases_v1();
```

설치 뒤 준비 상태와 실제 worker 종료·최종 cron 이력을 확인한다. `succeeded` 하나만으로 각 예약 성공이나 30초 중단을 증명하지 않는다. 초기 점검은 기한이 지난 pending 수, 지연·재시도·오류의 최소 집계로 한정한다.

문제가 있으면 manager `disable`로 새 job만 unschedule하고 진행 중 worker가 종료할 때까지 확인한다. queue·claim·receipt·audit은 보존한다. 앱은 위 이전 배포로 되돌릴 수 있지만 공통 core를 예전 즉시 제외 로직으로 되돌리지 않는다. 명단 재추가·금액 변경·알림 재발송은 rollback에 포함하지 않는다.
