# 시간표 원자 저장: 구현·검증·인계

기준 main은 `fe872141dc0904660bd7398d6e15d6c9e2788796`이다. 프리셋 삭제·복구 커밋 `45bccaa16c65a505986e0ac122dbae5e46e8d211`은 별도로 유지한다. `6d73fad3`의 순차 저장 준비본은 출시 후보가 아니며 이 변경이 원자 저장 경로로 대체한다. PR139/140과 종강 담당의 reader·validator 정의를 보존한다.

## 결과와 변경 범위

기존 코드의 실제 grid 이동 12회는 단건 저장 RPC 12개를 발생시켰다. pointermove는 로컬 preview였고 pointerup마다 저장했다. 저장된 상대 수업의 이전 배치를 기준으로 단건 검증하므로, 최종 상태가 유효한 두 수업 맞교환도 첫 호출에서 `23P01/timetable_resource_conflict`로 실패했다. 이는 격리 재현 결과이며 운영 과부하·DB 실행시간에 대한 인과 증거는 아니다.

새 프런트 경로는 같은 수업의 반복 편집을 마지막 초안으로 합치고 네 보기에서 같은 상태를 보여 준다. 상단 저장은 모든 변경 수업을 하나의 `save_batch` 요청으로 제출한다. 중복 저장·재확인은 같은 진행 중 Promise와 원래 body/key를 사용한다. 취소·로컬 undo는 미제출 변경만 다룬다. 타임아웃·잘못된 응답 뒤에는 입력과 전체 요청을 보존하고 편집·취소를 막아 결과 확인을 먼저 진행한다. 다른 편집자의 새 snapshot은 예전 receipt의 snapshot으로 되돌리지 않는다. 구 자동 저장 버전의 불확정 요청은 원래 단건 body/key로 먼저 확인하고 남은 미제출 초안만 batch로 보낸다. 단건 순차 fallback은 없다.

서버 변경은 `20261013051620_timetable_plan_atomic_batch_save.sql`에서 기존 `public.mutate_timetable_plan_item_v1(jsonb)` 한 함수의 batch 분기만 추가한다. 이전 save/delete 분기는 유지한다. 기존 admin 권한 확인, 운영 자원 잠금, plan 잠금과 재인증, actor/operation/requestKey receipt를 보존하며 batch 항목을 ID 순으로 잠근다. receipt 재확인은 버전 검사보다 먼저 이뤄진다.

요청의 meta/change sequence·각 수업 revision·운영 참조 fingerprint가 모두 맞아야 한다. 쓰기 전 원본 슬롯과 전체 최종 후보를 별도로 구성해 provenance, 용량, 주간·날짜별 운영 점유와 수업 간 최종 충돌을 검증한다. 이전 슬롯을 먼저 삭제하거나 쓰고 나서 validator를 호출하지 않는다. 변경 없는 기존 자원의 허용과 scoped V2의 부분 점유 계약을 유지한다. 모든 검증 후 수업·배치·revision·한 번의 change sequence와 receipt를 같은 거래에서 확정한다. 실패는 전체 rollback이다. 기존 reader/validator·table·role·ACL·security 설정은 재정의하지 않는다.

응답은 `BatchSaveResult` 하나로 고정한다. 모든 save/delete 대상의 acknowledgement와 해당 commit의 전체 snapshot을 포함한다. 소비자는 대상 누락·중복·operation/revision/plan/key/version 불일치, 부분 snapshot, 다른 최종 슬롯을 거부한다. PostgreSQL jsonb 키 순서와 JSON의 `-0`→`0` 변환은 정상적으로 처리한다.

프런트 batch 요청의 UUID 식별자는 기존 UI가 만드는 소문자 정규 형식으로 제한하고 다른 표기는 RPC 전에 거부한다. 서버가 UUID를 정규화해 성공한 뒤 queue/receipt가 원래 문자열과 달라지는 일을 막기 위한 입력 계약이다. 원래 body/key를 재작성하지 않으며 표시 문자열·fingerprint·requestKey를 정규화하지 않는다. 서버의 기존 UUID 허용 범위와 단건 복구 경로는 바꾸지 않는다.

## 검증 경계

로컬 서비스·controller 회귀, 실제 production 컴포넌트의 loopback UI 합성 검사, SQL grammar/static 검사, 독립 전체 원본 리뷰를 각각 구분한다. 합성 receipt나 SQL parser가 실제 PostgreSQL의 원자성·동시성 검증을 대신하지 않는다.

필수 DB 검증에는 `timetable_plan_batch_save_test.sql`, 실제 RPC 응답을 실제 소비자에 넣는 `probe-timetable-batch-save-dto.mjs`, 두 세션의 실제 잠금 대기와 stale/동일 요청 replay를 검증하는 `probe-timetable-batch-save-concurrency.mjs`를 추가한다. 원래 전체 schema job의 모든 SQL/probe와 transactional preflight·ledger·AI parity·cached fixture 검사를 유지한다. workflow 변경은 세 rollback-only 격리 검사 대상의 추가뿐이며 jobs·권한·secrets·기존 검사·배포 동작을 변경하지 않는다. 고정 inventory와 파일 hash도 이 정확한 추가에 맞춰 갱신한다.

현재 환경에는 고정 PostgreSQL/PostgREST 이미지가 없고 native PostgreSQL도 없어 실제 DB gate가 차단돼 있다. 이전 접근 제한은 재시도하거나 우회하지 않는다. 검증 가능한 환경에서 정확한 최종 소스로 전체 DB gate를 완료하기 전에는 병합·운영 SQL·배포 준비 완료로 판정하지 않는다.

## 호환성과 복구

기존 앱의 save/delete는 새 SQL에서 호환된다. 새 앱에 기존 SQL을 연결하면 새 operation이 실패하고 초안을 유지한다. 운영 순서는 전체 검증 후 SQL→앱이며 부모가 별도로 조율한다. 이번 작업은 운영 SQL 적용·push·merge·배포·실제 프리셋 삭제를 수행하지 않는다.

앱 복구 anchor는 검증된 직전 main이다. SQL 복구 anchor는 `20260923081138_timetable_plan_storage.sql`의 기존 item RPC 정의와 owner/ACL/config다. 함수를 기존 정의로 돌리더라도 저장된 수업·receipt·history를 삭제하거나 되돌리지 않는다. SQL rollback 전 새 앱을 되돌려 새 batch 요청을 차단한다. 이미 저장된 초안은 구 앱에서도 같은 테이블을 읽는다. 삭제한 프리셋은 archive를 restore하여 복구하며 운영 참조를 보존한다.

최종 head/base/tree, 검증 로그, 독립 리뷰, 실제 차단 결과와 전달 명령은 workspace의 최종 검증 packet에 기록한다. 다중 batch 저장 후의 저장된 상태 undo는 제공하지 않으며 저장 전 로컬 undo와 명시적 변경 취소를 제공한다.
