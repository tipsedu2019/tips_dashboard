# 전반 사전 명단 제외 완료 수정 — 2026-10-09

**Draft / 운영 미적용.** 기준 main `6a6d7abe4f45e366beccc14efbbcce0534f0370f`.
전달받은 마지막 운영 배포 기준은 PR125, 06:45 UTC이며 이 작업에서 운영 SQL·학생 상태·완료/승인·발송·Chat 설정/API/키를 변경하지 않았다. 공유 Mac Chrome도 사용하지 않았다.

## 원인과 변경

화면 `getRosterCompletionBlockers`, 서비스 `assertManagementSyncRecordsReady`, 최종 DB `complete_ops_transfer_roster_transition_impl`이 모두 원반 재원 명단을 요구했다. DB는 목적반 기등록과 학생 상태 `퇴원`도 거절했다. 수정 전 합성 재현 5개가 기존 `40001` 차단을 확인했다.

- 전반의 UI/서비스 사전 명단 조건만 제거했다. 학생/원반/목적반 실재, 서로 다른 반, 날짜와 업무 체크리스트 조건은 유지한다.
- DB는 원반이 이미 양쪽 명단에서 빠졌거나 목적반에 이미 양쪽 등록된 상태를 수용한다. 바뀐 명단만 이력을 생성하고 목적반 claim은 재사용한다. 원반 claim은 기존 방식으로 해제한다. 대기명단·비대칭/잘못된 명단·중복 claim·취소 상태·미완료 체크리스트는 허용하지 않는다.
- 부모→track→identity→학생→claim→반 잠금 순서, 인증/권한, 요청 영수증과 트랜잭션 원자성을 보존했다. 실제 잠금 후 재조회 충돌 3곳만 `40001`; 도메인 조건은 `23514`다.
- 학원비, 시수/수업계획, 등록 batch 정산, 최초 등록 일정을 다시 계산하거나 변경하지 않는다. 현재 반 이름으로 신청 상세 이름을 덮어쓰지 않는다.
- 최초 `transfer.submitted`에 실제 저장된 날짜·회차·반정보만 `requested_transfer_snapshot`으로 보존한다. 구버전 `before_end_date`/`after_start_date`도 동일 최초 payload에서 읽는다. `requested_effective_date` 역시 최초 기록만 사용한다. 완료에 적용한 저장 상세는 `applied_transfer_snapshot`으로 구분한다. 최초 이벤트나 회차가 없으면 missing/incomplete로 남기며 현재 상세/오늘 날짜/현재 반 수업계획으로 추정하지 않는다. 과거 이벤트를 수정하지 않는다.
- notification source producer의 transfer payload만 보완했다. 전달 규칙, provider, Chat API/설정/권한/키는 변경하지 않았다.

## 검증과 한계

| 검사 | 결과 |
|---|---|
| 수정 전 합성 차단 재현 | 5/5 |
| 새 전반 pgTAP, 실제 public v2와 최종 함수 | 220/220 |
| 기존 과목 완료/알림 도메인 pgTAP | 39/39 |
| 기존 퇴원 신청 snapshot pgTAP | 83/83 |
| 서비스/화면/알림/등록 Node 검사 | 203/203 |
| 최종 SQL 두 세션 동시성 | 7/7 |
| 격리 실제 앱 + DB UI | 관리자 1440px / 직원 1440·390px, 6/6 |
| 타입 검사 / production build | 통과 |
| 전체 ESLint | 오류 0, 기존 경고 7 |
| 기본 Supabase `db lint --fail-on error` | exit 0 |
| Squawk 2.63.0, PG17 | 0 issues |
| migration layout / SQLSTATE / free-tier worktree 검사 | 통과 |
| 함수 catalog | 1,108개 중 2개 정의만 변경, owner/ACL/search_path 불변 |
| 보충 `notification_transfer_withdrawal_adapters_test.sql` | **실패 — 아래 차단사항** |

새 pgTAP은 정상/사전 제외/퇴원 상태/목적반 기등록/기존 claim/회차 누락/최초 이벤트 누락·수정·legacy alias, 같은 요청 재시도·다른 요청 반복, 중간 오류 전체 rollback과 재시도, 취소/되돌림, 잘못된 대상, 관리자/직원/교사/차단 계정/익명, 날짜·정산·시수·과거 이력·알림 중복을 확인한다. 실제 동시성 검사는 동일·다른 요청 완료, 목적반 동시 등록, 원반 claim 동시 변경을 포함한다.

UI는 수정된 Next 앱과 허용된 SQL만 실행하는 로컬 typed bridge를 사용했다. 실제 public RPC, authenticated 역할, JSON JWT claim, 실제 RLS/트리거/데이터를 사용했다. 외부 HTTP는 차단했다. 이는 Supabase PostgREST JWT 서명 검증이나 운영 provider 전달 검증을 뜻하지 않는다. 합성 Postgres는 internal network, 외부 포트 없음, cron 실행 off였으며 UI 후 DB audit에서 provider delivery/HTTP queue/cron run은 모두 0이었다. 시나리오별 명단·이력·완료 source·canonical notification 수와 날짜/회차 보존도 재조회했다.

추가 지시에 따라 변경 전 main과 후보를 **동일한 새 격리 DB·동일 입력**으로 대조했다. 원본 suite는 양쪽 모두 assertion 20까지 실행하고 #14 초기 완료 SQLSTATE 기대, #17 퇴원 필수 연결 fixture에서 실패한 뒤 private canonical 조회 권한 오류로 중단했다. 원본 입력 SHA256은 `15e952c263a5caf7ca69fd1f7dd5e013b72f68e801f55577b2b3083715803588`이다.

독립 리뷰에 따라 테스트만 별도로 보완했다: 실제 Auth/학생/수업 fixture, 가장 먼저 실행되는 우회 방지 trigger의 `42501`, 검증용 private 조회만 test-owner 역할로 실행, service_role의 임시 fixture SELECT, 비어 있지 않은 합성 규칙/템플릿 계획, 실제 `?flow=applicant&taskId=` 링크, 브라우저 private 조회 거절 assertion을 추가했다. 제품 ACL·역할·함수·Chat 키/설정은 변경하지 않았으며 모든 fixture는 rollback된다. 호출 RPC는 기존 authenticated 역할을 유지한다.

보완된 동일 테스트는 main과 후보 모두 **47개 중 46개 통과, 1개 실패**다. 남은 “무관한 사용자 발송 계획 조회 거절”은 테스트 오류가 아니라 실제 기존 제품 결함으로 독립 확인됐다. `get_ops_task_legacy_dispatch_before_subject_completion_v1`의 `IF NOT(nullable OR …)`는 담당자 NULL이면 전체 조건도 NULL이 되어 거부 분기를 실행하지 않는다. 이 함수는 **service_role 전용**이므로 브라우저 직접 실행이나 실제 운영 발송 성공으로 과장하지 않는다. 서버가 전달하는 actor의 업무 권한 확인이 누락되는 문제다. 기대를 낮추거나 담당자를 임의로 채워서 숨기지 않았다. [동일 환경 대조 결과](adapter-main-comparison.json)를 참고한다.

권한 조건을 NULL-safe하게 만드는 제품 수정은 원 요청의 Chat/API/권한 변경 금지와 충돌하여 별도 범위 승인을 요청했다. 승인 전에는 제품 권한 함수를 변경하지 않는다. 최소 제안은 기존 허용 조건을 `IF NOT coalesce((기존 OR 조건), false)`로 바꿔 NULL을 거절하는 것이다. 새로운 권한을 부여하거나 기존 ACL을 넓히지 않는다.

앞서 실패 이후 대조 검사를 통과 대체로 해석할 수 있는 묶음 명령은 자동 승인 검토에서 거절됐다. 이후 사용자의 명시적 대조 지시에 따라 진단을 별도로 실행했고, 모든 실패 exit code/TAP를 그대로 보존했다. 이 문서는 merge gate 통과 증거가 아니다.

## SQL 적용·복구 조율

- 적용 파일: `supabase/migrations/20261009065550_transfer_completion_preexcluded_rosters.sql`
- SHA256: `59ca0b65f1d0873b29040afb34551e1d58071291e222e9cc51cd4fbd6ce38099`
- 변경 함수: `dashboard_private.complete_ops_transfer_roster_transition_impl(uuid,text)`, `dashboard_private.record_ops_transition_notification_source_v1(public.ops_tasks,text,uuid)`.
- 데이터 backfill/테이블 DDL/ACL/소유자/스케줄러/설정/키 변경 없음. 기존 함수 md5와 각 anchor가 다르면 전체 transaction을 중단한다. lock timeout 5초, statement timeout 30초.
- SQL을 먼저 적용해도 기존 RPC 응답/호출 방식은 호환된다. 기존 UI는 사전 제외를 계속 막을 수 있으므로 앱 배포까지 필요하다.
- 복구 참조: [rollback-reference.sql](rollback-reference.sql), SHA256 `ad34bfb0fe26b48da975935bdab5b4b1e2ced2683da9bd1130c4d5837a8749db`. 최종 함수 md5가 일치할 때만 원본 2개 정의를 복구한다. 격리 catalog 검사에서 원본 복구→재적용의 exact equality를 확인했다.
- 복구는 코드/함수 복원이며 이미 완료된 학생 명단·이력·정산을 되돌리지 않는다. 적용 이후 완료가 발생했다면 완료 요청/이력/claim/notification을 대조하고 별도 업무 복구를 조율해야 한다. 완료·명단 변경을 일시 정지한 구간에서 정확한 운영 catalog를 확인한 뒤에만 적용/복구한다. 정의 drift가 있으면 파일을 억지로 적용하지 않는다.

## 남은 단계

1. 보충 adapter suite가 검출한 기존 actor 권한 결함의 수정 범위 승인·수정·재검증 및 필수 체크 차단 해소. 사용자 지시는 추가 결제 없이 로컬 검사/독립 리뷰였지만 AGENTS는 필수 `free-tier-guardrails`, `supabase-sql-review`, `supabase-schema-contract` 성공을 요구하고 실패/미실행을 허용하지 않는다. 보호설정/검사 완화 없이 부모 조율을 기다린다.
2. 정확한 PR head/base와 merge SHA의 독립 리뷰 및 필수 검사 확인. 새 base/코드에는 새 증거가 필요하다.
3. 부모가 운영 SQL 적용을 별도 조율한 뒤 reviewed PR merge/app 배포. 이전 main/release를 롤백 기준으로 유지한다.
4. 실제 배포 SHA/schema와 운영 전반 UI를 독립 검증한다. 운영 학생 실제 완료는 별도 승인 범위다. 구현/draft PR만으로 사용자 요청 전체 완료를 선언하지 않는다.

재현 명령과 원시 결과는 [validation.json](validation.json), [adapter-failure.tap](adapter-failure.tap), [adapter-failure.stderr](adapter-failure.stderr)를 참고한다. 신규 검사는 `node --test --experimental-strip-types tests/transfer-preexcluded-completion.test.mjs` 및 격리 DB에서 `supabase/tests/transfer_preexcluded_completion_test.sql`을 실행한다. 기존 workflow 핀/필수 gate 설정은 변경하지 않았다.
