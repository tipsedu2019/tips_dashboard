# 등록 연락처 발송 경계 통합 후보

기준은 `f2d308a0e2999a80f37f77f53341286561b92d51`이며, 이 문서와 SQL은 2026-10-09 로컬 검토 후보다. 운영 DB, 공급자, 설정, 연락처 값에 접근하지 않았다. DB 준비 작업은 자동 승인 심사에서 거부되어 실제 SQL 실행·pgTAP·동시성 시험은 0건이다. **운영 적용 준비 완료가 아니다.**

## 허용 목적과 기존 기능

| 기존 ID | 현재 이름 | 연락처 사용 판정 |
| --- | --- | --- |
| `level_test_booking` | 레벨테스트 예약 | 현재 레벨테스트 단계만 허용 |
| `appointment_reminder` | 예약 리마인드 | 서버의 canonical kind가 `level_test`인 경우만 허용 |
| `observation_booking` | 청강 예약 | 현재 동일 청강 단계만 허용 |
| `observation_reminder` | 청강 리마인드 | 현재 동일 청강 단계만 허용 |
| `admission_application` | 입학신청서 | 등록 안내 목적 후보. 의미 매핑이 별도 승인되기 전 차단 |
| `visit_consultation_booking` | 방문상담 예약 | 세 목적 밖 연락처 사용 후보, 차단 |
| `waiting_notice` | 대기 안내 | 세 목적 밖 연락처 사용 후보, 차단 |

기존 기능 ID·업무 편집 기능은 보존한다. 브라우저 승인 플래그, 새 HTTP 권한, 임의 보관 연장을 추가하지 않는다. 등록 안내의 의미 매핑이 아직 승인되지 않았으므로 세 번째 목적의 실제 발송 완료를 주장하지 않는다. 방문상담·대기 등 목적 밖 연락은 별도 중단 또는 외부 업무 시스템 이관 검토가 필요하다. 직원 GoogleChat·in_app·WebPush 알림을 학부모 전화 발송으로 간주하여 중단하지 않았다.

## 실제 소비 경계

`server/registration-customer-message-contact-fence.ts`는 서버 메타데이터만 받아 정확한 task/source/kind, persisted phase, canonical generation, 현재 단계와 목적을 검증한다. generation은 PostgreSQL bigint 최대값 이하의 양의 10진 문자열이며 Number로 바꾸지 않는다. 배열만 보고 종결을 추정하거나 zero-track 상태를 재개하지 않는다.

단건 경로는 `registration-customer-message-route.ts`에서 미리보기 전에 메타데이터를 확인한다. 새 claim 전과 attempt 전에도 처음 준비한 generation을 유지한다. mark RPC의 단순 `allowed:true`는 발송 허가가 아니다. 실제 DB 잠금 경계가 반환하는 정확한 다음 응답이 필요하다.

```text
contactGrant = {
  version: 1, action: "attempt",
  linearization: "registration_contact_case_lock_v1",
  messageId, dispatchToken, contactFence
}
```

모듈의 응답 검증은 SQL이 실제 잠금을 획득했다는 증명이 아니다. SQL 초안은 부모 업무 → ID 순서의 현재 track → details → preview/message/job 순서를 요구하고, 같은 트랜잭션에서 generation·목적 검증과 기존 attempt marker를 처리한 후 위 응답을 반환한다. 새로운 업무 충돌은 `23514`, 입력 오류는 `22023`, 정의/소유자 불일치는 `55000`이다. 기존 delegate의 과거 `40001` 사용을 새 동시성 검증 성과로 해석하지 않는다.

actor/preview/request key/원래 generation과 HMAC이 동일한 저장 결과는 종결 뒤에도 결과만 반환한다. 현재 연락처·원문을 다시 읽지 않고 provider 재시도나 재저장을 하지 않는다. provider 접수·불명확 결과, marker 이후 불확실성은 기존 결과 확인 흐름으로 남는다. 이미 시작한 발송을 취소 완료로 바꾸지 않는다.

새 RPC contract에는 전화 원문·학생 이름·본문을 넣지 않는다. 기존 서버 recipient HMAC과 last4, checksum, domain-separated request HMAC만 포함한다. 기존 `REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER` 이름을 재사용하며 값은 읽지 않았다. SQL은 잠금 아래 canonical phone을 기존 owner-only 함수의 일시 입력으로만 복원한다. 공급자 응답의 임의 본문·오류 문장은 저장 evidence에 복사하지 않고, 제한된 ID/코드와 고정 상태 문구만 전달한다. 외부 공급자에는 허용된 열린 단계의 실제 발송을 위해 수신 전화번호가 필요하다.

## 종결과 폐기된 producer

`sql/registration-contact-message-fence-draft.sql`의 `dashboard_private.retire_registration_contact_dispatch_v1(uuid,bigint)`는 lifecycle이 이미 확보한 부모/track/details 잠금과 newly-closed generation 아래 호출한다. owner-only capability이며, lifecycle의 authenticated actor JWT를 service_role JWT로 바꾸도록 요구하지 않는다.

미사용 preview를 consume하고 단건 pending·attempt 0 claim을 해제한다. 단건 enum에는 canceled가 없어 pending 결과를 유지한다. reminder/bundle의 pending·claimed·미시작 작업은 기존 canceled 상태를 사용한다. 시작됨·accepted·unknown 기록은 변경하지 않는다. 원문 삭제 자체는 lifecycle 담당의 draft이며 이 문서는 과거 개인정보 삭제를 실행하지 않았다.

최종 ordered migration `20260901111200_registration_flat_fact_runtime_finalization.sql:2673`의 reminder claim producer는 service-role 검사 뒤 `null`을 반환하도록 폐기되어 있다. sync/materialize도 이 정의에서 no-op이다. 이전 August 활성 큐는 운영 근거가 아니다. 초안은 이 폐기 정의의 정확한 body/owner를 preflight하고 그대로 보존하며 새 reconciliation RPC도 no-op이다. reminder worker의 strict fence/attempt 소비는 합성 계약 검증이며 현재 활성 자동 발송 증거가 아니다. 새 producer를 구현하려면 동일 잠금 경계의 `{claim,contactFence}` 응답과 별도 최종 정의 검증이 필요하다.

bundle은 기준 소스에서 preview-only/runtime 0이며 실제 claim/begin DB adapter가 없다. generic worker는 fence/grant 없이는 발송하지 않는다. 존재하지 않는 실제 번들 dispatcher가 연결됐다고 주장하지 않는다.

## 검증과 남은 적용 조건

관련 Node 회귀 206건과 새 final-ordered-source 시험 2건이 통과했다. 이 중 새 mocked dispatch 시험 19건은 종결·모든 단계 종료·generation 변경·목적 밖 메시지·허가 응답 scope 변조·불확실한 marker/provider/finalize·저장 결과 replay·원문 없는 저장 evidence를 검증한다. 네트워크 transport는 전부 mock이다. ES2017 strict TypeScript로 변경 서버 파일 7개를 검사했으며 `git diff --check`가 통과했다. SQL 텍스트 검사와 pgTAP 파일 존재 검사는 DB 실행 통과를 의미하지 않는다.

bundle preview의 실제 query를 typed client helper로 분리하여 receiver/control-flow unresolved를 해결했다. 8초 abort와 retry(false)를 유지했다. 하지만 `read_registration_contact_message_fence_v1`, `resolve_registration_customer_message_bundle_source_v1`은 검증 완료된 nonpageable registry에 없으므로 free-tier 검사에서 **`rpc_page_limit_missing` 2건이 남는다.** 가짜 `p_limit`, 검사기/manifest 변경, 동적 호출 우회를 추가하지 않았다.

새 RPC ACL은 초안에서 모두 철회 상태로 남겼으며 capability grant를 실행하거나 추가하지 않았다. existing 함수는 CREATE OR REPLACE와 postgres owner preflight로 기존 OID/owner/ACL을 보존하는 후보이다. 적용 전에는 승인된 DB 환경에서 최종 전체 ordered 정의·권한·RLS·SQLSTATE pgTAP·종결/claim/marker 경쟁·accepted/unknown 정합성·콜백/재시도 시험, 새 RPC capability 검토, 실제 bounded/nonpageable 계약 승인이 필요하다. DB 검증과 이 두 free-tier 차단이 해소되기 전 배포/활성화하면 안 된다.
