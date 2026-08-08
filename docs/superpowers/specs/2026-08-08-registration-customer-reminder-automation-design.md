# 등록 고객 예약 리마인드 자동 발송 설계

## 목표

- 알림 설정에서 고객 예약 리마인드를 `자동 발송 ON/OFF`와 `예약 몇 시간 전` 두 값으로 관리한다.
- 기본값은 OFF, 기본 발송 시각은 예약 3시간 전이다.
- 같은 예약의 리마인드 알림톡은 수동·자동을 합쳐 평생 한 번만 발송 요청한다.
- 예약 변경 전 아직 발송하지 않았다면 새 예약 시각을 기준으로 예정 시각을 다시 계산한다.
- 운영자가 확인할 수 있는 이력에는 `자동 발송 · 발송 시각`을 남긴다.

## 안전 경계

자동 발송은 저장이나 진행상태 변경 요청 안에서 직접 실행하지 않는다. 예약 저장은 예약 원장만 갱신하고, 별도 큐가 예약 상태를 읽어 발송 예정 시각을 계산한다. 다음 조건 중 하나라도 만족하지 않으면 SOLAPI 호출은 0회다.

- 설정이 OFF다.
- 예약이 취소됐거나 미래의 `scheduled` 상태가 아니다.
- 보호자 전화번호가 유효하지 않다.
- SOLAPI 활성화 모드가 `live`가 아니다.
- 현재 카탈로그 체크섬과 승인 영수증이 다르다.
- 같은 예약의 수동 또는 자동 리마인드 발송 이력이 이미 있다.
- 작업의 잠금·시도 마커·원본 revision 검증이 일치하지 않는다.

첫 운영 배포는 반드시 OFF 상태다. 코드 배포, DB 반영, 워커 비밀키 설치, SOLAPI 템플릿 재승인과 사전 검증, 안전한 테스트 수신 확인을 각각 분리한다.

## 데이터 모델

### 설정

`dashboard_private.registration_customer_reminder_settings`는 단일 행으로 유지한다.

- `enabled boolean not null default false`
- `lead_hours smallint not null default 3`
- `updated_by`, `updated_at`

직접 테이블 권한은 제거한다. 관리자용 get/set RPC만 노출하고, ON 전환은 현재 리마인드 템플릿의 활성화·승인 영수증·워커 스케줄 상태가 모두 준비됐을 때만 허용한다.

### 예약 큐

`dashboard_private.registration_customer_reminder_jobs`는 `appointment_id`를 기본키로 사용한다. 한 예약에 한 행만 존재한다.

- 예약·할 일 식별자와 원본 revision
- `scheduled_for`, `due_at`
- `pending`, `claimed`, `dispatching`, `completed`, `canceled`, `held` 상태
- 잠금 토큰과 임대 만료 시각
- 연결된 고객 메시지 ID와 마지막 안전 오류

아직 발송 전인 `pending` 행만 예약 변경에 따라 다시 계산한다. `dispatching` 또는 `completed` 행은 예약 변경으로 되살리지 않는다. 취소 예약은 `canceled`로 닫는다.

### 기존 고객 메시지 원장 통합

자동 발송도 `ops_registration_customer_messages`를 사용한다.

- `delivery_origin`: `manual` 또는 `scheduled`
- 수동 행은 기존 `preview_id`, `confirmed_by`를 유지한다.
- 자동 행은 미리보기·운영자 확인 대신 큐 작업과 `scheduled_for`를 가진다.
- `appointment_reminder`에 대해 `(appointment_id, message_kind)` 부분 유니크 인덱스를 두어 수동·자동 합계 1회를 보장한다.

provider 호출 전 기존과 동일하게 `provider_attempt_count = 1`을 먼저 기록한다. 이 마커 이후 프로세스가 중단되면 결과를 `unknown`으로 보존하고 자동 재발송하지 않는다.

## 워커 흐름

Vercel Hobby 요금제의 Cron 최소 주기로는 예약 몇 시간 전 정시 처리가 불가능하므로 Supabase `pg_cron`과 `pg_net`이 1분마다 전용 Vercel Route를 호출한다.

1. 전용 Route가 Bearer 비밀키를 상수시간 비교로 검증한다.
2. service role RPC가 미래 예약을 동기화하고 도래한 작업 하나를 임대 잠금한다.
3. 서버가 canonical 예약 원장과 현재 템플릿을 다시 해석한다.
4. DB RPC가 설정, 예약 상태, 원본 revision, 중복, 활성화 영수증을 원자적으로 재검증하고 provider 시도 마커를 기록한다.
5. SOLAPI를 정확히 한 번 호출한다.
6. 기존 finalize 계약으로 `accepted`, `unknown`, `failed_hold`를 기록하고 큐를 닫는다.

사전 검증 실패는 provider 호출 없이 `pending` 재계산 또는 `held`로 남긴다. provider 시도 마커 이후의 불확실성은 절대 자동 재시도하지 않는다.

## 설정 화면

등록 알림 설정의 기존 내부 운영자용 예약 알림 규칙 9개는 고객 리마인드 설정과 혼동되지 않게 숨긴다. 대신 다음 한 카드만 제공한다.

- `자동 발송` 스위치
- `예약 3시간 전` 형태의 시간 선택
- 변경사항 저장 동작과 현재 준비 상태

ON 전환이 불가능한 경우에는 내부 오류 코드를 노출하지 않고 `SOLAPI 승인 또는 자동 발송 준비가 완료되지 않았습니다.`라고 안내한다. OFF 전환은 항상 허용하며 즉시 새 작업 claim을 막는다.

## 감사와 운영

- 미리보기 이력은 수동 발송자 이름 또는 `자동 발송`을 동일한 위치에 표시한다.
- 수신 전화번호, 본문, API 키, Bearer 비밀키는 큐·Cron·로그에 저장하지 않는다.
- 워커는 실행 횟수, provider 호출 여부, 안전 오류 코드만 구조화 로그로 남긴다.
- Cron 설치·해제는 `cron.schedule`, `cron.alter_job`, `cron.unschedule` 함수만 사용한다.
- 자동 발송은 배포만으로 켜지지 않는다. 승인 영수증 검증과 실제 테스트 수신 후 관리자가 ON으로 저장해야 한다.

## 검증 기준

- OFF, 미승인, template drift, 취소, 중복, 잘못된 전화번호에서 provider 호출 0회
- 예약 변경 시 미발송 작업의 `due_at`만 재계산
- 수동 발송 후 자동 작업이 종료되고 자동 발송 후 수동 버튼이 잠김
- 시도 마커 뒤 중단 시 `unknown`이고 두 번째 provider 호출 없음
- 설정 API는 관리자만 변경 가능하며 lead time 범위를 검증
- Cron 비밀키가 없거나 다르면 401이며 DB claim·provider 호출 0회
- 운영 이력에 `자동 발송 · 한국 시각` 표시
