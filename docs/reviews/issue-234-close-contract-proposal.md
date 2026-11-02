# #234 종강일부터 운영 점유 해제

기준 main: `7e0ae88b3b1367c931433f10337c9e5134344802`. 브랜치: `fix/234-class-close-occupancy`. Related to #234. PR235의 충돌 상세 표시 변경은 포함하지 않는다.

## 확정된 정책과 구현

사용자가 모든 미래 회차의 점유를 **종강 당일부터**, 이미 종강된 수업에도 해제하도록 선택했다. 이 변경은 RED이며 운영 적용·병합 승인이 아니다.

새 forward migration `20261031120000_class_close_occupancy_release.sql`은 전체 일정 reader와 14일 보강 reader의 마지막 운영 projection에 같은 private helper를 적용한다. 기존 weekly reader가 사용하는 lifecycle 판정과 정렬하며, `closed_at`의 한국 날짜 이상인 dated session과 날짜가 확정된 blocker를 제외한다. 상속·수동·보강·normalized와 모든 state에 동일하게 적용한다. `schedule_plan`, normalized lesson, 출결·수강 이력·audit를 수정하거나 삭제하지 않는다.

- 과거 dated 행의 내용·순서·중복 수는 유지한다. 날짜나 class를 알 수 없는 blocker는 해제 대상으로 추정하지 않는다.
- 기존 raw-source fingerprint를 해시 입력으로 보존하며, 달라진 projection의 fingerprint/datedComplete를 함께 갱신한다. 기존 DTO shape/version 2와 public RPC/권한은 그대로다.
- helper는 postgres 소유·empty search_path이며 API 역할에 EXECUTE를 주지 않는다. 두 reader와 helper는 한 migration transaction으로 설치된다. 테이블·인덱스·RLS·grant 확대·backfill은 없다.
- `closed_by`는 프로필 삭제 시 NULL일 수 있으므로 판정에 사용하지 않는다.

### 종강일이 없는 기존 행

기존 schema는 `status='종강', closed_at=NULL`을 허용하며 migration은 종강일을 backfill하지 않았다. `end_date`, `updated_at`, 일반 receipt 생성 시각을 실제 종강일로 사용할 근거도 없다. 이 행은 현재 한국 날짜부터 점유를 해제하고 과거 projection을 보존한다. **과거 실제 종강일 복원이 아니다.** 날짜가 흐르면 이전에 제외된 회차가 과거 projection에 포함될 수 있지만 현재·미래 점유에는 복귀하지 않는다. 원본 날짜를 추정하거나 운영 데이터를 정정하지 않는다.

## 검증과 저장 계약의 경계

`update_class_operational_v1`, `close_class_atomic_v1`, validator/assert/finalizer, private reuse proof, actor/lock/hash/replay/CAS와 직접 재개강 금지 guard는 변경하지 않았다. 검증을 건너뛰는 flag나 target 전체 제외 예외를 추가하지 않는다. 원래 global baseline과 fresh finalizer가 남아 있는 점유를 비교한다.

종강과 실제 일정 변경을 같이 보내도 해당 수업의 종강일 이후 일정은 선택된 정책에 따라 비점유다. 종강일 전 새 점유와 다른 active 수업의 새 충돌은 계속 검증한다. 일반 active 일정 입력의 기존 계약도 그대로다. 다만 기존 gateway의 교사/강의실 catalog 및 일정 형식 검사는 `closure IS NULL` 분기 안에 있다. 혼합 종강 입력에 대해 그 검사가 새로 실행된다고 주장하지 않는다. 미래 target의 unresolved blocker에 의존하던 거절 역시 점유 해제 정책에 따라 사라질 수 있다. typed/CAS/trigger 검증과 active 일정 경로는 유지하며 새 혼합 입력 거절 정책을 만들지 않았다.

현재 public metadata writer를 통한 재개강은 기존 `42501 / class_close_requires_rpc`로 거절된다. 새 재개강 권한/RPC는 만들지 않았다. 합성 owner fixture로 active 상태를 복원하면 점유가 돌아오고 충돌을 다시 거절하는지를 pgTAP에 넣었다.

## 불확실 쓰기·확인 결과

기존 진단 12+2개 합성 검사 결과를 재사용한다. `class-close-confirmation.ts`, service, page는 수정하지 않았다. 성공 확인에는 같은 수업·종강 상태·numeric 등록/대기 인원 0·비어 있는 두 관계 페이지·전송 patch와 값/타입 일치가 모두 필요하다. 등록 학생 0명만으로 성공 처리하지 않는다.

명시적 RPC 거절은 실패로 남고, 불확실 transport/receipt 결과 뒤 조회 실패나 불일치는 미확정으로 남는다. 재확인은 읽기만 하며 자동 재저장하지 않는다. 조회 실패 뒤 rollback 또는 수강 재쓰기 경로는 없다. 기존 보고 건의 원래 writer commit/rollback과 원인은 확인하지 못했다. 저장소에서 당시 trace를 가져올 정상 경로를 찾지 못했으며 새 운영 조회·재현은 하지 않았다.

## 회귀와 증거

- 새 Node 회귀: migration 미작성 상태에서 static 2 FAIL / consumer 3 PASS → 변경 후 5 PASS. SQL 실행 red→green을 뜻하지 않는다.
- 시간표 CI 범위 Node/TypeScript 테스트 321 PASS. 실제 consumer에 합성 projected DTO를 전달해 당일·미래 해제, 과거 보존, 재활성화·다른 수업 충돌, 날짜 미상 blocker를 검사했다. 이 DTO는 실행된 SQL 결과가 아니다.
- pgTAP 소스: 실제 full/windowed reader, stamped/unstamped close, KST/UTC, 모든 normalized state, legacy manual/makeup, 원본 보존, mixed 미래/과거, 재개 상태와 충돌, private ACL을 추가했다.
- 기존 gateway pgTAP의 실패·취소·동일 key replay·권한 해제·같은 transaction의 다른 수업 충돌·fresh finalizer 검사는 보존했다.
- `timetable_shared_validation_workset_test.sql`의 기존 미래 inherited `23P01` 기대는 사용자 정책에 따라 `00000`/종강/두 receipt로 명시 변경했다. 과거·active peer 음성 통제는 삭제하지 않았다. 현재·미래 bucket이 달라져 비교 생략 최적화가 적용되지 않는 경우에는 기존 oracle 전체 비교 횟수를 기대한다.
- closed future projection을 유지하던 performance fixture 기대와 최종 reader body hash도 새 계약으로 갱신했다. 원본 lesson 보존·메타데이터 parity·ACL 검사는 남겼다.

## 미충족 gate와 통합 한계

SQL/pgTAP runtime은 기존 Supabase 이미지 Forbidden 때문에 **미실행**이다. 재시도·다른 registry/호스트/계정/runtime 우회는 하지 않는다. 정적 검사·mock·읽기 리뷰는 SQL 실행을 대체하지 않는다. full CI, 독립 exact-source 리뷰, 인증 preview smoke, 24시간 조건을 유지한다. 원격 Codex quota 재요청은 하지 않는다.

PR235와 source UI 충돌은 없지만, 배포된 종강 여정에 대한 Monitor 확인은 별도다. 본 변경이나 draft PR/자동 preview는 운영 종강 성공 또는 #234 전체 fixed 선언이 아니다. 실제 운영 SQL·데이터·QA·배포·병합·자기 승인·이슈 종료는 하지 않았다.
