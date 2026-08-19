# 등록 예약 알림톡 다과목 묶음 및 당일 리마인드 설계

**작성일:** 2026-08-19

**상태:** 사용자 문서 승인 · 구현 계획 작성 대상

**대상:** 레벨테스트, 방문상담, 청강 예약 안내 알림톡과 자동 리마인드 알림톡

## 1. 목표

1. 한 학생이 같은 예약 유형에서 여러 과목을 예약하면 예약 안내 알림톡을 한 건으로 보낸다.
2. 레벨테스트, 방문상담, 청강 리마인드는 모두 각 일정 당일 오전 10시(KST)에 자동 발송한다.
3. 예약 안내 알림톡 발송 여부와 무관하게 유효한 예약은 자동 리마인드 대상이 된다.
4. 같은 학생, 같은 예약 유형, 같은 서비스 날짜의 다과목 리마인드는 한 건으로 보낸다.
5. 원본 예약 저장과 고객 메시지 전달을 분리해 SOLAPI 실패가 예약을 되돌리지 않게 한다.
6. 미리보기, 중복 방지, 공급자 시도 마커, 불명 결과 보존 등 기존 안전 경계를 묶음 단위로 유지한다.

여기서 `서비스 날짜`는 예약을 생성한 날짜가 아니라 실제 레벨테스트, 방문상담 또는 청강이 진행되는 KST 달력일이다.

## 2. 확정된 운영 규칙

### 2.1 유형 경계

- 예약 유형은 `level_test`, `visit_consultation`, `observation` 세 가지다.
- 서로 다른 예약 유형은 한 메시지에 섞지 않는다.
- 레벨테스트, 방문상담, 청강은 각각 독립된 예약 안내와 리마인드 이력을 가진다.

### 2.2 예약 안내 묶음

- 운영자가 유형별 `예약 안내 알림톡` 버튼을 누르면 같은 학생 등록 건과 같은 유형에 속한 모든 유효한 미래 예약을 조회한다.
- 예약 날짜가 서로 달라도 한 예약 안내 메시지에 모두 포함한다.
- 과목별 날짜, 시간, 장소를 각각 독립된 항목으로 표시한다.
- 취소되었거나 종료된 예약은 포함하지 않는다.
- 이미 안내한 뒤 예약이 추가되거나 일정이 변경되면 다음 미리보기에는 변경분만이 아니라 현재 유효한 전체 예약을 다시 담는다.
- 이전에 발송 완료된 snapshot과 현재 snapshot이 같으면 같은 안내를 중복 발송하지 않는다.

### 2.3 자동 리마인드 묶음

- 크론은 `0 1 * * *` UTC, 즉 매일 오전 10시 KST를 유지한다.
- 실행일과 서비스 날짜가 같은 유효한 미래 예약만 대상으로 삼는다.
- 같은 학생 등록 건, 같은 예약 유형, 같은 서비스 날짜의 예약을 한 메시지로 묶는다.
- 예약 안내 알림톡의 미리보기, 발송, 성공 여부는 리마인드 대상 조건이 아니다.
- 일부 과목만 취소되면 나머지 과목만 포함한다.
- 모든 과목이 취소되면 묶음과 공급자 호출을 만들지 않는다.
- 오전 10시 이후 예외적으로 예약이 추가되거나 변경되면 자동 리마인드를 다시 보내지 않는다. 운영자는 예약 안내 미리보기에서 변경된 전체 일정을 확인한 뒤 필요할 때 발송한다.
- 학원 영업시간 전인 오전 10시 이전에는 당일 신규 예약이나 당일 일정 변경이 발생하지 않는다는 운영 전제를 사용한다. 시스템은 이 전제와 무관하게 공급자 호출 직전 현재 상태를 재검증한다.
- 오전 10시 실행 시 이미 시작했거나 종료된 일정은 잘못된 데이터로 간주해 대상에서 제외한다.

### 2.4 화면 경계

- 레벨테스트, 방문상담, 청강 화면에는 유형별 예약 안내 버튼을 하나만 둔다.
- 과목 탭마다 별도의 고객 예약 안내 버튼을 만들지 않는다.
- 미리보기에는 묶음에 포함될 모든 과목, 날짜, 시간, 장소를 정렬해 표시한다.
- 수동 리마인드 버튼은 두지 않는다.
- 예약 화면에는 유형과 날짜별로 `발송 예정`, `발송 처리 중`, `발송 완료`, `결과 확인 필요`, `발송 안 됨` 상태만 읽기 전용으로 표시한다.

## 3. 현재 구조와 원인

- 레벨테스트와 방문상담 메시지 source는 하나의 공유 appointment에 여러 과목 activity가 연결되면 과목 목록을 집계할 수 있다.
- 현재 등록 UI는 예약 내부 과목 선택기를 제거하고 활성 과목 하나로 새 예약을 시작한다. 따라서 같은 학생, 같은 시각, 같은 장소여도 과목별 appointment ID가 생길 수 있다.
- 청강 source와 리마인드 작업은 observation ID 하나와 단일 과목을 기준으로 한다. 여러 청강 예약을 한 메시지로 표현할 수 없다.
- 레벨테스트와 방문상담은 당일 오전 10시 규칙을 사용하지만 청강은 `lead_hours` 기반 규칙을 사용한다.
- 메시지 렌더러만 수정해서는 분리된 appointment와 observation을 한 번의 중복 잠금, 한 번의 공급자 호출, 한 개의 감사 이력으로 만들 수 없다.

따라서 원본 예약을 강제로 병합하지 않고 메시지에만 별도의 묶음 계층을 추가한다.

## 4. 검토한 방식

### 4.1 채택: 원본 예약 유지 + 메시지 묶음 manifest

원본 appointment와 observation은 그대로 두고, 발송 시 포함할 원본과 revision을 묶음 manifest로 고정한다.

장점:

- 날짜와 시간이 다른 여러 과목을 한 예약 안내에 담을 수 있다.
- 과목별 수업, 출결, 취소 이력이 독립적인 청강 구조를 훼손하지 않는다.
- 이미 분리된 운영 데이터도 별도 데이터 보정 없이 묶을 수 있다.
- 미리보기와 실제 발송의 동일성, 묶음 단위 중복 잠금, 감사 이력을 명시할 수 있다.

### 4.2 기각: 원본 예약을 하나의 appointment로 병합

같은 시각의 레벨테스트와 방문상담에는 적용할 수 있지만 날짜와 수업이 다른 청강에는 맞지 않는다. 메시지 편의를 위해 예약 수정, 취소, 출결까지 불필요하게 결합하게 된다.

### 4.3 기각: 공급자 호출 직전에만 문자열 결합

별도 manifest 없이 실시간 조회 결과만 합치면 미리보기 이후 변경, 동시 실행, 중복 발송, 과거 메시지 판독을 안정적으로 처리할 수 없다.

## 5. 아키텍처

### 5.1 묶음 식별

묶음은 다음 필드를 가진 private 데이터다.

- `task_id`: 한 학생의 등록 건
- `reservation_kind`: `level_test`, `visit_consultation`, `observation`
- `delivery_kind`: `booking`, `reminder`
- `service_date`: 예약 안내는 `null`, 리마인드는 KST 서비스 날짜
- `bundle_revision`: 동일한 논리 묶음의 증가하는 revision
- `source_fingerprint`: 정렬된 항목과 수신 대상 revision을 포함한 해시
- `status`: `pending`, `claimed`, `dispatching`, `accepted`, `unknown`, `failed_hold`, `canceled`
- 생성·claim·공급자 시도·완료 시각과 감사 필드

예약 안내 중복 잠금은 `task_id + reservation_kind + delivery_kind + source_fingerprint`로 판정한다. 리마인드의 논리적 중복 잠금은 `task_id + reservation_kind + service_date`당 한 개의 현재 묶음으로 판정하고, 실제 공급자 호출은 고정된 `bundle_revision`과 fingerprint로 보호한다.

### 5.2 묶음 항목

각 묶음 항목은 다음 source snapshot을 가진다.

- 원본 종류와 원본 ID
- 원본 notification 또는 booking revision
- 과목
- 예약 일시와 KST 서비스 날짜
- 장소
- 정렬 순서
- 항목 사실 해시

레벨테스트와 방문상담은 분리된 appointment ID도 같은 `task_id + reservation_kind` 범위에서 수집한다. 청강은 observation ID별 source를 수집한다. 항목은 날짜, 시각, 과목 표준 순서로 정렬한다.

유효한 source는 원본의 현재 상태까지 함께 판정한다.

- 레벨테스트: appointment가 `scheduled`이고 연결된 level-test attempt가 `scheduled`
- 방문상담: appointment가 `scheduled`이고 연결된 consultation이 `mode = 'visit'`, `status = 'scheduled'`
- 청강: observation이 `status = 'scheduled'`
- 세 유형 공통: 시작 시각이 현재보다 뒤이며 필수 일정·장소·수신 대상 사실이 유효함

상위 task나 과목 track이 종료 상태로 전환되는 기존 업무 규칙이 source를 취소하는 경우에는 해당 항목도 제외한다. 예약 안내는 위 조건을 만족하는 모든 미래 source를, 리마인드는 위 조건에 더해 KST 서비스 날짜가 실행일과 같은 source만 수집한다.

같은 유형에서 동일한 과목의 유효한 예약이 둘 이상 발견되면 임의로 고르지 않고 `source_ambiguous`로 중지한다. 현재 제품 범위는 영어, 수학, 과학 과목별로 유효한 예약 한 건씩, 묶음당 최대 세 항목이다.

### 5.3 기존 메시지 시스템과의 연결

- 기존 preview-before-send와 고객 메시지 감사 테이블을 재사용한다.
- preview와 customer message는 단일 appointment 또는 observation 대신 `bundle_id`를 참조할 수 있게 확장한다.
- rendered body, variables, buttons의 checksum과 source fingerprint를 계속 기록한다.
- 전체 전화번호, 공급자 비밀정보, claim token은 브라우저 응답과 묶음 항목에 저장하지 않는다.
- 기존 개별 메시지는 수정하거나 삭제하지 않고 역사 기록으로 보존한다.
- UI 조회는 권한이 확인된 task에 대해 비밀정보 없는 묶음 요약만 반환한다.

### 5.4 메시지 렌더링과 SOLAPI 템플릿

각 유형과 전달 목적별로 다과목 묶음용 승인 템플릿을 사용한다.

- 레벨테스트 예약 안내
- 방문상담 예약 안내
- 청강 예약 안내
- 레벨테스트 당일 리마인드
- 방문상담 당일 리마인드
- 청강 당일 리마인드

각 템플릿은 최소 `학생명`과 서버가 생성한 여러 줄 `예약목록` 변수를 가진다. `예약목록`은 최대 세 항목으로 제한하고, 각 항목에는 과목, 날짜, 시간, 장소를 포함한다. 청강 항목에는 수업명과 담당 선생님도 포함한다. 메시지 본문만 읽어도 예약 사실을 이해할 수 있어야 하며 위치·문의 링크는 보조 버튼으로 둔다.

새 템플릿의 SOLAPI/Kakao 승인과 실제 template ID 설정은 코드 배포와 별도 공급자 게이트다. 승인·checksum·활성화 증거가 없으면 새 경로는 공급자를 호출하지 않는다.

## 6. 데이터 흐름

### 6.1 수동 예약 안내

1. 운영자가 유형별 예약 안내 버튼을 누른다.
2. 서버가 같은 task와 reservation kind의 모든 유효한 미래 예약을 읽는다.
3. 서버가 항목을 검증·정렬하고 source fingerprint를 만든다.
4. preview에는 전체 예약 목록, 수신번호 끝 네 자리, 템플릿 상태만 반환한다.
5. 사용자가 확인하면 서버가 같은 원본 revision인지 다시 검사한다.
6. 일치하면 manifest를 잠그고 provider attempt marker를 기록한 뒤 한 번 호출한다.
7. 원본이 바뀌었으면 발송을 차단하고 최신 전체 예약으로 새 미리보기를 요구한다.

### 6.2 자동 당일 리마인드

1. 매일 오전 10시 KST 크론이 worker를 한 번 호출한다.
2. producer가 오늘이 서비스 날짜이며 아직 시작하지 않은 유효한 예약을 조회한다.
3. `task_id + reservation_kind + service_date`로 그룹화한다.
4. 각 그룹의 항목 snapshot과 bundle revision을 저장한다.
5. bounded worker가 묶음을 하나씩 claim한다.
6. 공급자 호출 직전에 모든 항목의 상태, revision, 수신 대상, 템플릿 활성화를 다시 검사한다.
7. 항목이 달라졌으면 공급자 시도 전에 오래된 묶음을 취소하고, 같은 오전 10시 크론 실행의 제한된 처리 시간 안에서만 최신 유효 항목으로 한 번 다시 계산한다.
8. 항목이 없으면 공급자를 호출하지 않는다.
9. 일치하면 provider attempt marker를 기록한 뒤 정확히 한 번 호출한다.

예약 안내 발송 이력은 2단계 대상 조회와 6단계 적격성 검사에 포함하지 않는다.
7단계의 재계산은 오전 10시 실행 중 동시 변경을 방어하기 위한 것이며, 크론 실행이 끝난 뒤 새 리마인드를 생성하거나 오전 10시 이후 변경에 자동 재발송하는 경로가 아니다.

## 7. 상태와 오류 처리

### 7.1 상태 전이

```text
pending -> claimed -> dispatching -> accepted
                                -> unknown
                                -> failed_hold
pending/claimed -> canceled
```

- `accepted`: 공급자 접수가 확인된 terminal 상태
- `unknown`: 공급자 호출 결과가 불명확한 terminal 상태
- `failed_hold`: 공급자가 거절했거나 안전 조건이 충족되지 않은 terminal 상태
- `canceled`: 원본 변경, 전환, 대상 없음 등으로 공급자 호출 전에 종료된 상태

### 7.2 안전 규칙

- 예약 저장, 변경, 취소는 묶음 생성이나 SOLAPI 실패 때문에 rollback하지 않는다.
- 한 묶음은 전체 항목을 한 메시지로 보내거나 전혀 보내지 않는다. 부분 발송은 없다.
- 공급자 호출 전에 시도 마커를 원자적으로 기록한다.
- `dispatching`, `accepted`, `unknown`, `failed_hold` 묶음은 자동 재발송하지 않는다.
- 공급자 timeout이나 finalize 실패는 `unknown`으로 보수적으로 마감한다.
- 크론 재실행, worker 재시작, 동시 claim은 동일한 묶음의 두 번째 공급자 호출을 만들지 않는다.
- 오전 10시 이후 원본 변경은 이미 시도된 리마인드를 대체하거나 추가 발송하지 않는다.
- 관리자 화면은 상태, 실제 시각, 마지막 갱신 시각만 노출한다. provider ID, 전체 전화번호, 내부 fingerprint와 token은 노출하지 않는다.

## 8. 전환

### 8.1 스키마와 코드 설치

- Supabase CLI로 생성한 forward migration만 사용한다.
- 묶음 manifest, 항목, private producer/claim/finalize 함수와 authorized summary RPC를 추가한다.
- 새 runtime은 기본 비활성 상태로 설치한다.
- 기존 크론 표현식 `0 1 * * *`는 유지한다.
- 애플리케이션은 묶음 preview와 상태 읽기를 지원하되 공급자 전환 전에는 기존 활성 경로를 변경하지 않는다.

### 8.2 원자적 cutover

- production migration, `main`, Vercel Production, 인증된 UI, provider-zero runtime을 먼저 검증한다.
- 공급자 호출 전인 기존 개별 appointment/observation reminder 작업은 `bundle_cutover` 사유로 취소한다.
- 이미 공급자 시도가 시작됐거나 `accepted`, `unknown`, `failed_hold`인 메시지와 작업은 보존한다.
- DB의 단일 runtime version 또는 activation 상태를 사용해 기존 개별 producer를 끄고 묶음 producer를 동시에 켠다.
- 기존 producer와 새 producer가 동시에 고객 발송 가능한 상태는 허용하지 않는다.
- 기존 원본 예약 행을 병합하거나 과거 메시지를 새 묶음으로 소급 변환하지 않는다.

### 8.3 공급자 활성화

새 Kakao 템플릿 승인, 카탈로그 checksum, 환경변수, sendable receipt를 별도로 검증한다. 실제 고객 발송 활성화와 수신 확인은 코드 배포 완료와 별도의 사용자 승인 단계다.

## 9. UI

### 9.1 예약 안내

- 각 예약 유형 섹션에 하나의 `예약 안내 알림톡` 버튼을 둔다.
- 버튼은 현재 선택된 과목이 아니라 학생의 같은 유형 전체 예약을 대상으로 한다.
- 미리보기는 `과목`, `날짜`, `시간`, `장소` 순서로 각 항목을 보여 준다.
- 청강은 항목별 수업명과 담당 선생님을 추가한다.
- 저장되지 않은 변경, source ambiguity, 템플릿 미승인, 잘못된 수신 대상이 있으면 발송 버튼을 비활성화하고 해당 원인을 표시한다.

### 9.2 리마인드 상태

- 수동 리마인드 버튼은 없다.
- 유형별 오늘 리마인드에 포함되는 과목을 한 줄로 표시한다.
- 예: `8월 21일 오전 10시 발송 예정 · 영어·수학`
- 완료, 불명, 실패는 묶음 전체의 상태로 한 번만 표시한다.

별도 묶음 관리 화면이나 설명용 카드는 만들지 않는다.

## 10. 테스트

### 10.1 DB/pgTAP

- 분리된 appointment ID의 영어·수학 레벨테스트를 한 묶음으로 생성
- 분리된 방문상담과 observation source를 유형별 한 묶음으로 생성
- 같은 유형, 서로 다른 날짜의 예약 안내는 한 묶음
- 같은 유형, 서로 다른 날짜의 리마인드는 날짜별 별도 묶음
- 서로 다른 유형은 별도 묶음
- 한 과목 취소, 전체 취소, 종료된 예약 제외
- 같은 과목의 유효한 source가 둘 이상이면 `source_ambiguous`
- 예약 안내 이력이 없어도 리마인드 생성
- KST 날짜 경계와 정확한 오전 10시 due time
- 오전 10시 기준 이미 시작한 일정 제외
- source revision 변경 시 stale 묶음 취소
- 동시 claim과 크론 중복 실행에서 unique bundle 및 단일 provider attempt marker
- RLS/ACL, SECURITY DEFINER search path, service-role 전용 worker 함수, authorized summary RPC

### 10.2 서버와 렌더링

- 세 유형의 최대 세 항목 정렬과 self-contained 한국어 본문
- preview fingerprint와 send fingerprint 일치
- preview 후 항목 하나가 변경되면 발송 차단
- 현재 snapshot이 이미 accepted면 중복 안내 차단
- provider accepted, rejected, timeout, finalize 실패 상태 전이
- `unknown`과 `failed_hold` 자동 재시도 없음
- 전화번호, provider ID, 내부 hash/token 비노출

### 10.3 UI

- 유형별 예약 안내 버튼 하나만 렌더
- 과목별 중복 고객 메시지 버튼 없음
- 여러 날짜와 여러 과목을 한 미리보기에서 표시
- 수동 리마인드 버튼 없음
- 묶음 상태와 과목 요약 한 줄 표시
- stale preview, source ambiguity, 템플릿 미승인 상태에서 발송 차단

### 10.4 핵심 인수 시나리오

1. 같은 날 영어·수학 레벨테스트: 예약 안내 1건, 리마인드 1건
2. 서로 다른 날 영어·수학 레벨테스트: 예약 안내 1건, 각 날짜 리마인드 1건
3. 영어 방문상담과 수학 청강: 유형별 예약 안내와 리마인드 각각 별도
4. 예약 안내 미발송: 당일 오전 10시 리마인드 정상 생성
5. 기존 과목별 분리 예약: 원본 보정 없이 한 메시지로 묶음
6. 크론 재실행과 worker 재시작: 공급자 호출 정확히 한 번

## 11. 검증 및 출시 게이트

다음 게이트를 합치지 않고 각각 보고한다.

1. **Source/tests:** 정적 계약, Node 테스트, lint, TypeScript, build
2. **Isolated DB:** clean apply, pgTAP, fresh assertion, provider-zero
3. **Production migration:** 적용된 migration, runtime 기본 비활성, exact cron
4. **`main`/Vercel:** GitHub `main` SHA와 Vercel Production `READY`
5. **Authenticated UI:** 유형별 단일 버튼, 묶음 미리보기, 리마인드 상태
6. **Runtime:** 오전 10시 producer/worker heartbeat와 묶음 payload, provider-zero
7. **Provider:** 승인 템플릿, checksum, activation, provider accepted
8. **Recipient:** 별도 승인된 통제 대상의 실제 수신 확인

외부 전달은 앞 게이트가 완료됐다는 이유만으로 자동 활성화하지 않는다.

## 12. 비목표

- 원본 appointment 또는 observation 병합
- 과거 고객 메시지 삭제 또는 소급 재작성
- 레벨테스트, 방문상담, 청강 간 교차 묶음
- 수동 리마인드 발송 기능
- Google Chat 알림 규칙 변경
- 등록 업무 저장과 고객 메시지 전달의 트랜잭션 결합
- 공급자 불명 결과의 자동 재발송
