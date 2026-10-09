# 등록 연락 목적과 발송 종결 정책

기준 소스는 main `6a6d7abe4f45e366beccc14efbbcce0534f0370f`이다. 사용자가 승인한 연락처 용도는 등록 단계의 레벨테스트 안내, 청강 안내, 등록 안내다. 모든 현재 등록 단계가 종결되면 대시보드의 실제 연락처를 제거하고 등록 후 연락은 MakeEdu에서 처리한다. 이 정책은 보관기간을 추가하지 않는다.

`registration-contact-message-policy.ts`는 독립 순수 판단 모듈이다. 기존 route, SQL, 종류 정의와 UI는 이 변경에서 수정하지 않는다. 이 모듈의 시험 통과는 운영 DB 적용, 공급자 활성화, 연락처 제거 완료를 의미하지 않는다.

## 기존 7개 종류의 목적 매핑

표시명은 `registration-customer-message-labels.ts`의 기존 명칭을 유지한다. 후보는 기능 삭제를 의미하지 않으며 해당 후보에 대시보드 연락처 사용 권한을 부여하지 않는다.

| 기존 ID | 현재 한국 이름 | 허용 목적 | 정책 판단 |
|---|---|---|---|
| `level_test_booking` | 레벨테스트 예약 | `level_test` | 해당 원본 단계가 열려 있는 동안 허용 |
| `visit_consultation_booking` | 방문상담 예약 | 없음 | 세 목적 밖 후보. 연락 기능 별도 중단 또는 외부 이관 검토 |
| `appointment_reminder` | 예약 리마인드 | `level_test` 조건부 | 서버의 실제 appointment kind가 `level_test`이고 원본 단계가 열려 있을 때만 허용. 방문상담은 목적 밖, 종류 불명은 차단 |
| `waiting_notice` | 대기 안내 | 없음 | 세 목적 밖 후보. 연락 기능 별도 중단 또는 외부 이관 검토 |
| `admission_application` | 입학신청서 | `registration` 후보 | 등록 안내와의 의미 매핑이 미확정이므로 자동 허용하지 않음 |
| `observation_booking` | 청강 예약 | `observation` | 해당 원본 청강 단계가 열려 있는 동안 허용 |
| `observation_reminder` | 청강 리마인드 | `observation` | 같은 원본 청강 단계가 열려 있는 동안 허용. 다른 열린 과목으로 권한을 대신하지 않음 |

`admission_application`의 등록 목적 고정 매핑이 이후 확정되면 서버 소비 코드와 정책 버전을 함께 검토한다. HTTP 요청 또는 브라우저의 승인 플래그로 후보를 허용하면 안 된다. 알려지지 않은 종류와 bundle 종류는 이 모듈에서 차단하며 기존 bundle 기능 자체를 제거하지 않는다.

## 종결과 generation 경계

현재 단계 종결 판단은 별도 lifecycle helper가 담당한다. 이 모듈은 해당 helper와 DB의 canonical `contactPhase`, `allPhasesClosed`, 원본 단계의 `sourcePhaseOpen`, 양수 bigint 범위의 10진 generation 문자열을 소비한다. 화면 배열, workflow 표시명, 요청 플래그로 이를 결정하면 안 된다.

현재 과목이 0개라는 이유만으로 자동 종결하지 않는다. 반대로 명시적 전체 취소나 guarded 마지막 과목 제외로 저장된 `contactPhase='closed'`는 현재 과목 재계산 결과가 비어 있더라도 종결 상태다. 새 발송은 저장된 closed phase 또는 모든 현재 단계 종결 중 하나만 확인돼도 차단한다.

소비 어댑터는 preview, claim, attempt 시작 및 retry 경계마다 최신 서버 사실을 읽어 판단해야 한다. 종결과 attempt marker의 최종 판단은 같은 DB 잠금/트랜잭션 경계에서 수행해야 한다. 이 순수 함수는 동시성 잠금이나 트랜잭션을 대신하지 않는다. 종결 또는 재개로 generation이 바뀌면 오래된 요청은 새 발송을 시작할 수 없다.

| 작업 상태 | 종결 판단 결과 | 소비 어댑터의 처리 요구 |
|---|---|---|
| 미리보기만 존재 | `invalidate_preparation` | 해당 준비를 무효화하고 새 claim/attempt 차단 |
| pending, 미claim 또는 claimed, marker 없음 | `cancel_before_attempt` | 발송 전 작업을 최종 미발송 처리. claim 해제만으로 pending을 재발송 가능하게 남기지 않음 |
| pending, marker 시작됨 | `record_inflight_without_retry` | 이미 시작된 호출은 되돌릴 수 없음. 불확실성과 결과를 기록하고 추가 발송 차단 |
| accepted/unknown/failed_hold | `leave_result_only` | 실제 연락처 제거와 별개로 승인된 최소 결과만 남기고 재발송 차단 |

이 값들은 어댑터에 전달하는 **처리 의도**이며 현재 customer-message DB status enum이 아니다. `canceled` 등 존재하지 않는 enum 값을 임의로 저장해서는 안 된다. `accepted`는 초기 SOLAPI 접수이며 배달 완료를 뜻하지 않는다. `unknown`을 이유로 실제 연락처 보관을 연장하지 않는다.

## 요청 재사용과 최소 기록

재사용 조회는 원래 actor-scoped request key, 서버에서 계산한 canonical 요청 digest `{version: 1, digest: <64 hex>}`, 원래 contact generation이 모두 일치해야 한다. 요청 digest는 신뢰하는 서버 controller가 키를 가진 HMAC으로 계산하고 task/source/message kind/actor/원래 generation을 묶어야 한다. 단순 전화번호 hash 또는 클라이언트 digest를 권위로 사용하면 안 된다.

정확한 재사용은 종결 또는 generation 변경 뒤에도 기존 결과를 읽어 반환할 수 있다. 이때 `canStartProviderAttempt=false`이며 새 저장·claim·공급자 호출 권한을 주지 않는다. 다른 key/digest/원래 generation을 같은 요청으로 취급하지 않는다. 재사용 결과가 pending이면 그것을 발송 재개 허가로 사용하면 안 된다.

정책 receipt의 허용 필드는 버전, request key, canonical request digest, 원래 generation, 결과의 message ID/status/attempt 시작 여부뿐이다. 실제 번호, 수신자 HMAC, last4, 이름, actor 표시명, 자유문구, timestamp와 공급자 원문은 허용하지 않는다. 추가 필드는 함수에서 차단하고 오류 결과로 반사하지 않는다. 이 모듈은 receipt를 저장하지 않는다.

기존 공급자 ID/request key 등 결과 정합성에 필요한 기록의 저장 범위는 root SQL 계약에서 별도로 확정한다. 과거 recipient hash/last4는 정책 receipt로 복사하지 않는다. event payload·rendered body·재사용 응답 등 기존 사본의 제거는 별도 승인과 SQL 검증이 필요하다. 직원 채널 알림이나 미납·전반·퇴원·휴보강을 실제 연락처 보관 연장의 근거로 사용하지 않는다.

## 검증 범위

새 합성 시험은 목적 매핑과 기존 종류/표시명 일치, 종결 전후 no-send, 같은 원본 단계 제한, 큰 generation 정밀도, claim/attempt 구분, pending/claimed 취소 의도, marker 이후의 불확실 결과, 재사용 결과 보존, raw-contact 필드 차단, 지연된 발송 직전의 사실 재검증을 검사한다. 시험의 공급자는 로컬 카운터이며 네트워크, DB 또는 실제 학생 데이터가 없다.
