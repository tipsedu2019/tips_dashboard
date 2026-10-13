# 시간표 수동 저장·프리셋 삭제: 조사와 원자 저장 계약 제안

기준 main은 `fe872141dc0904660bd7398d6e15d6c9e2788796`이다. 이미 반영된 PR139/PR140 및 종강 backend 담당의 변경을 보존한다. 이번 작성 시점에 SQL/migration/역할/권한/실제 프리셋 변경은 없다. push·병합·배포는 하지 않는다.

## 확인한 현재 호출 경로

실제 production grid의 pointermove는 로컬 preview 계산만 한다. pointerup의 이동·resize·drop은 controller.dispatch→runQueue→mutate_timetable_plan_item_v1을 즉시 실행한다. 같은 항목의 중간 수정도 각각 전송된다. 보이는 동안 revision polling과 focus/visibility/realtime 신호는 전체 운영 참조를 읽는 상세/revision RPC를 추가 호출할 수 있다.

설치된 실제 Supabase client+service+controller 합성 계측에서 preview90회는 추가RPC0, 같은 수업12회 이동은 mutation12+최초detail1+revision3이었다. 저장마다 합성 invalidation을 더하면 detail13이었다. Chromium의 실제 /admin/timetable과 grid handle12회 이동에서도 저장RPC12회를 확인했다. 모든 provider/auth/data는 격리 합성 fixture이며 운영 서버 부하나 DB 실행시간 측정이 아니다. gesture protocol 시간도 렌더링 성능 개선으로 주장하지 않는다.

## 현재 구현 범위와 한계

편집 중에는 항목별 마지막 미제출 초안만 유지하고 네 보기에서 같은 초안을 읽도록 준비한다. 적용은 로컬 편집이며 상단 저장만 서버 요청을 시작한다. 초안은 actor/plan별 같은 탭에 보존된다. 미저장 상태의 보기·프리셋·뒤로가기·페이지 이탈은 경고한다. 적용되지 않은 열린 폼은 별도 경고로 보호한다. 취소/undo는 미제출 변경만 되돌리고, 제출했으나 응답을 확인하지 못한 원래 요청은 body/requestKey를 보존한다. 권한 회수·actor 변경·로그아웃은 기존 민감 상태 정리를 따른다.

프리셋 삭제는 기존 archive/restore를 이용한다. 대상 이름/id/metaRevision을 확인창에서 고정하고 확정 성공 뒤 운영 시간표를 선택한다. 수업·배치·적용 이력·운영 참조를 삭제하지 않으며 마지막 프리셋 삭제도 운영 보기로 복귀할 수 있다. 복구는 사용자가 진입할 때 목록을 조회하고 archived만 표시한다. 실패/미확정은 기존 요청과 선택을 유지하고, stale 뒤 새 revision으로 자동 재시도하지 않는다.

**기존 항목별 RPC를 순서대로 호출하는 것은 전체 원자 저장이 아니다.** 서로 시간을 교환하는 두 수업의 최종 상태가 유효해도 첫 저장이 상대의 이전 저장 배치와 충돌한다. 또한 뒤 항목에서 실패하면 앞 항목은 이미 저장된다. 이 경로를 완성된 일괄 저장으로 출시할 수 없다. 현재 로컬 staging/순차 writer는 이 한계를 증명하기 위한 준비 상태이다.

## 기존 원자 경로 확인

현재 mutate_timetable_plan_item_v1은 한 수업 item과 그 수업의 slots[] 또는 item.delete만 받는다. meta RPC는 생성/이름/복제/archive/restore이며 임의 최종 item/slots를 함께 저장하지 않는다. transfer API는 저장된 항목을 적용·복사·이동하는 별도 업무이므로 미저장 시간표 전체를 원자적으로 편집하는 대체 경로가 아니다. 운영 수업 적용으로 우회하지 않는다. 단건 RPC를 transaction wrapper에서 반복하는 것도 각 검증기가 상대 항목의 이전 상태를 읽으면 교환 문제를 해결하지 못한다.

## 최소 원자 batch 제안 — SQL 구현 전 부모 조율 필요

기존 `public.mutate_timetable_plan_item_v1(jsonb)`에 `operation:'save_batch'` 분기를 추가하는 방안을 제안한다. public signature/owner/security-definer/search_path와 ACL은 그대로 두고 테이블·키·역할·권한을 추가하지 않는다. 동일 signature의 CREATE OR REPLACE는 owner/권한을 유지하지만 나머지 속성은 선언값에 따르므로 모두 명시해 보존해야 한다([PostgreSQL17 문서](https://www.postgresql.org/docs/17/sql-createfunction.html)). 기존 save/delete 분기는 호환 유지한다. 새 operation을 한 파일의 append-only migration으로 제공하고 SQL 수정 범위는 이 RPC로 제한한다.

요청은 planId, expectedMetaRevision, expectedChangeSequence, expectedShadowFingerprint, 하나의 requestKey, 변경 수업별 최종 edit와 expectedItemRevision 목록이다. save edit는 기존 PlanItemDraft와 slots[]를 사용하고 delete edit는 itemId를 사용한다. 동일 항목 중복, 다른 plan UUID, 타 항목 slot UUID 재사용, applied 항목 변경, 필드 위조 및 용량/시간/자원 오류를 거부한다. 변경 항목 수≤500, 최종 전체 수업≤500/배치≤2000을 유지한다.

1. 기존 admin 권한 확인 → 운영 자원 advisory lock → plan/항목의 결정적 행 잠금 → 권한 재확인을 유지한다.
2. actor/operation/requestKey와 전체 immutable command hash에 묶인 receipt를 먼저 확인한다. 동일 요청 재시도는 기존 receipt만 반환한다. body가 바뀐 같은 key는 거부한다.
3. plan meta/change sequence와 각 항목 revision, 운영 reference fingerprint를 검증한다. 다른 편집·운영 변경은 기존 `P0001/timetable_stale`로 전체 rollback한다. 실제 DB 동시성 충돌에만40001을 사용한다.
4. 잠금 안에서 **쓰기 전 원본 baseline과 전체 최종 후보를 별도로 구성**한다. 변경의 자원·운영 충돌 검증은 원래 slot과 최종 slot을 비교하고, 수업 간 충돌은 변경 대상의 이전 슬롯을 최종 후보로 대체한 전체 상태끼리 검사한다. 기존 검증 의미를 batch 분기에서 baseline-aware하게 적용해야 한다. 최종 validate_timetable_item_slots_v1(20260927071716:195–199)은 table old row와 후보가 같으면 catalog/운영 충돌 검사를 skip하므로 먼저 행을 저장한 뒤 기존 함수를 호출하면 검증을 우회할 수 있다. 이전 행을 먼저 삭제하는 방식도 sourceSlotId provenance·tombstone의 기존 자원 허용을 깨뜨린다. 변경 슬롯/메타데이터를 별도 baseline으로 비교하고 unchanged grandfathering을 그대로 유지한다. 현재 한 항목씩 기존 함수를 반복하는 wrapper로는 충분하지 않다.
5. 같은 transaction에서 최종 행을 검증·저장한다. 오류가 발생하면 수업/슬롯/revision/receipt/signal을 모두 rollback한다. 운영 수업·적용 이력·applied 항목은 변경하지 않는다. 성공에 대해서만 plan change sequence/신호와 receipt를 확정한다.
6. 응답은 하나의 wire schema로 고정한다. `BatchSaveResult = { planId, requestKey, committedMetaRevision, committedChangeSequence, acknowledgements: [{ itemId, operation: 'save' | 'delete', itemRevision: number | null }], snapshot: PlanSnapshot }`로 제안한다. acknowledgements는 요청한 모든 대상과 operation을 정확히 한 번씩 포함해야 하며 delete의 itemRevision은 null이다. 기존 단건 SavePlanItemCommand/result에 전체 snapshot을 끼워 넣지 않고 batch command/result union과 전용 mapper를 추가한다. 응답 오류를 commit 성공으로 추정하지 않는다. 프런트는 하나의 immutable batch를 제출·복구하며 receipt replay의 commit 확인과 최신 snapshot 채택을 구분한다. 예전 receipt snapshot은 이미 확인한 더 높은 change sequence를 되돌리지 못하고 최신 상세 조회로 조정한다. 미확정 batch를 새 key로 다시 제출하거나 취소하지 않는다.

`read_timetable_operating_reference_v1`, `read_timetable_weekly_reference_v1`, `legacy_effective_context_v1`, `read_timetable_class_weekly_v2`는 이번 batch 제안에서 재정의하지 않는다. 이 함수들은 종강 backend 담당의 범위와 겹친다. 기존 final reader를 호출하는 경계만 유지하므로 담당과 source/base 및 설치 순서를 조율한 뒤 결정한다.

## 필수 회귀와 출시 증거

최소 pgTAP는 두 수업의 시간·강의실 교환, 여러 수업 순환 교환, 저장/생성/삭제 혼합, applied/다른 plan/slot 소유권 거부, 마지막 항목 실패 전체 rollback, meta/item/reference stale, 실제 두 session lock 경쟁, 같은 key replay/body 변경, 권한 회수 후 receipt 거부, slot/catalog tombstone·nullable 진단 계약·용량 제한, 운영/학생/직원/발송 불변을 포함해야 한다. 최종 ordered function 정의에서 정확한 SQLSTATE와 owner/ACL/proconfig 보존을 검사한다.

프런트 실제 UI는12회 이동 전 쓰기0, 저장1개의 batch 요청, 네 보기 최종 상태 일치, 중복 클릭1회, 실패 입력/불확정 body 유지, partial commit0, view/preset/back/unload 경고, 취소/undo0RPC, 마지막 프리셋 삭제/복구와 target/focus를1440/390에서 검증해야 한다. 원자 batch 미구현 상태는 이 gate를 통과했다고 기록하지 않는다.

최종 정확한 source/base/tree에 원본 free-tier-guardrails/supabase-sql-review/supabase-schema-contract 전체 명령, 독립 리뷰와 rollback packet이 필요하다. 현재 환경의 pinned DB image 캐시는0이고 이전 접근 거부를 반복/우회하지 않는다. 전체 DB gate를 수행할 수 없다면 준비된 담당 환경으로 인계하며 diagnostic 결과를 PASS로 바꾸지 않는다.

## 호환성과 rollback

현재 계획상 기존 앱의 save/delete는 새 SQL에서도 유지된다. batch를 모르는 기존 SQL은 새 앱 요청을 실패시키고 입력을 유지해야 하며 단건 순차 fallback으로 원자성 문제를 숨기면 안 된다. 해당 호환성을 합성 DB에서 검증한 뒤 부모가 SQL→앱 순서를 결정한다.

rollback은 직전 검증된 app/main source와 기존 최종 mutate_timetable_plan_item_v1 정의·owner/ACL/config hash를 anchor로 둔다. 함수만 원래 정의로 복원하며 데이터/receipt/history/실제 학생을 삭제하거나 원복하지 않는다. 복구형 프리셋 삭제의 archive 행은 restore로 복구 가능하며 운영 참조는 보존된다. 이번 문서는 실행 승인이 아니고 실제 SQL 설치·운영 적용·배포를 수행하지 않는다.
