# 등록 고객 SOLAPI 알림톡 미리보기·확인 발송 설계

**작성일:** 2026-08-05

**상태:** 사용자 구두 승인 반영 · 서면 검토 대기

**대상:** 등록 신청서, 등록 예약, 대기 안내, 입학신청서, SOLAPI 운영 연결

## 1. 목표

등록 신청서의 `레벨테스트`, `상담`, `대기`, `입학` 영역에서 운영자가 보호자에게 보낼 알림톡을 정확한 저장 데이터로 미리 본 뒤 명시적으로 확인하여 발송할 수 있게 한다.

지원하는 고객 메시지는 다섯 종류다.

1. 레벨테스트 예약 안내
2. 방문상담 예약 안내
3. 레벨테스트·방문상담 예약 리마인드
4. 대기·다음 개강 알림 신청 접수 안내
5. 입학신청서 작성 안내

예약 저장, 진행상태 변경, 대기 정보 저장, 입학 처리와 고객 알림톡 발송은 서로 다른 업무 행동이다. 어떤 저장이나 상태 변경도 고객 메시지를 자동으로 보내지 않는다. 운영자는 항상 `알림톡 보내기 → 미리보기 확인 → 확인 후 발송` 순서로 발송한다.

실제 운영 연결까지 완료 범위에 포함한다. SOLAPI 카카오 채널과 승인 템플릿, 전용 API Key, Vercel Production 환경 변수, 운영 DB 설치, Production 재배포, 합성 등록 건을 이용한 실제 수신 검증까지 각각 분리된 증거로 확인한다.

## 2. 확인된 현재 상태

### 2.1 이미 있는 기반

- 레벨테스트와 방문상담은 `ops_registration_appointments`를 권위 있는 예약 엔터티로 사용한다.
- 예약은 일시, 장소, 참여 과목, `notification_revision`을 가지며 저장·변경·취소와 충돌 감지가 구현돼 있다.
- 기존 등록 예약 리마인더는 전날 14:00, 당일 14:00, 1시간 전 규칙을 계산할 수 있다.
- 입학신청서 고객 메시지는 `/api/solapi/registration`과 `ops_registration_messages`의 claim/finalize/reconcile 계약을 통해 SOLAPI의 접수·실패·불확실 상태를 다룬다.
- SOLAPI에는 `tipsedu` 카카오 채널과 발송 가능한 `등록_입학신청서_작성안내` 템플릿이 있다.

### 2.2 현재 공백

- 기존 예약 리마인더 수신자는 관리팀·담당 원장용 in-app/Google Chat뿐이며 학생·보호자·SOLAPI는 명시적으로 제외돼 있다.
- 레벨테스트 예약, 방문상담 예약, 예약 리마인드, 대기 안내 고객 알림톡 경로가 없다.
- `ops_registration_messages.template_key`는 `admission_application`만 허용하고 예약·대기 원천을 식별할 열이 없다.
- 현재 canonical 등록 상세의 입학신청서 발송 버튼은 미리보기 없이 바로 provider 접수를 시도한다.
- 구형 등록 화면의 입학 미리보기는 정적 문자열이라 실제 승인된 SOLAPI 템플릿과 달라질 수 있다.
- SOLAPI API Key가 없고, 로컬·Vercel Production에 SOLAPI 환경 변수가 없으며, 고객 발송 runtime gate도 모두 꺼져 있다.
- 현재 예약 리마인더 worker/cron은 운영 고객 메시지 소유자가 아니다. 격리된 과거 cutover SQL은 실행 금지 참고 자료다.

## 3. 설계 원칙

1. **미리보기가 곧 발송 명세다.** 화면에 본문처럼 보이는 별도 설명 문자열을 만들지 않는다. provider에 넘길 동일 catalog와 renderer로 미리보기를 만든다.
2. **브라우저는 사실을 조립하지 않는다.** 브라우저는 메시지 종류와 canonical source ID만 보낸다. 전화번호, 템플릿 ID, 본문, 치환 변수, 버튼 URL을 보내지 않는다.
3. **저장과 발송을 분리한다.** 예약·상태·대기·입학 저장 RPC는 SOLAPI를 호출하거나 고객 메시지 outbox를 만들지 않는다.
4. **미리보기 뒤 변경은 발송을 막는다.** 예약, 참여 과목, 대기 종류, 학생명, 보호자 번호, 템플릿이 바뀌면 기존 미리보기는 만료된다.
5. **중복보다 보류를 선택한다.** provider 접수 여부가 불확실하면 자동 재발송하지 않고 `확인 필요`로 보류한다.
6. **한 업무 사실에는 한 고객 메시지 소유자만 둔다.** 기존 내부 알림과 새 고객 알림은 수신자·채널·행동이 다르며 서로의 delivery를 대신하지 않는다.
7. **기본값은 발송 불가다.** migration, 코드 배포, 환경 변수, 템플릿 승인 중 하나라도 부족하거나 종류별 activation gate가 `off`이면 미리보기 상태에서 정확한 사유를 보여 주고 provider를 호출하지 않는다.
8. **개인정보는 최소 노출한다.** UI·로그·감사 이력에는 수신번호 끝 4자리와 비가역 recipient hash만 남긴다. 전체 번호와 API Secret은 server runtime 밖으로 내보내지 않는다.
9. **실패한 알림은 원 업무를 되돌리지 않는다.** 이미 저장된 예약·대기·입학 정보는 provider 실패 때문에 rollback하지 않는다.
10. **자동 고객 리마인드는 이번 범위가 아니다.** 리마인드도 운영자가 미리보기 후 누르는 수동 발송 행동이다.

## 4. 검토한 접근법

### 4.1 접근법 A — 등록 고객 메시지 전용 preview/outbox 계약

다섯 고객 메시지 종류를 하나의 server catalog로 관리하고, 별도 preview 감사 테이블과 고객 message outbox를 둔다. 기존 입학 SOLAPI의 접수·불확실·조회·수동 조정 정책은 일반화해 재사용한다.

- 장점: 현재 canonical 등록 신청서와 정확히 맞고, 예약·대기·입학의 서로 다른 원천과 revision을 명확히 보존한다.
- 장점: 기존 내부 reminder worker를 활성화하지 않고도 사람이 확인하는 고객 발송을 완성할 수 있다.
- 장점: provider template drift, 수신자 변경, 중복 발송을 서버에서 일관되게 막을 수 있다.
- 단점: 신규 additive migration과 공통 미리보기 UI가 필요하다.
- 결정: **채택**

### 4.2 접근법 B — 기존 입학 전용 `ops_registration_messages`만 확장

현재 테이블의 `template_key` check를 넓히고 기존 route에 분기를 계속 추가한다.

- 장점: 초기 변경 파일이 적다.
- 단점: task 단위 입학 메시지 테이블에 appointment·track 원천을 억지로 섞게 된다.
- 단점: 정적 legacy 미리보기와 canonical UI가 다시 갈라질 가능성이 높다.
- 단점: preview 확인과 source revision 계약을 명확히 추가하기 어렵다.
- 결정: 채택하지 않는다.

### 4.3 접근법 C — 공통 notification worker에 보호자 SOLAPI 자동 발송 추가

기존 예약 리마인더 rule에 보호자 target과 SOLAPI channel을 추가하고 cron worker가 예약 시간에 자동 발송한다.

- 장점: 장기적으로 모든 채널을 한 control plane에서 운영할 수 있다.
- 단점: 이번 요청의 사람 확인 발송 원칙과 다르다.
- 단점: 현재 꺼져 있는 worker·cron·cutover·adapter ownership까지 동시에 바꿔야 한다.
- 단점: 잘못된 예약이나 보호자 번호가 자동 발송으로 이어질 위험이 크다.
- 결정: 이번 범위에서는 채택하지 않는다.

## 5. 메시지 종류와 원천

| `message_kind` | 화면 위치 | canonical source | 발송 단위 | 유효 조건 |
| --- | --- | --- | --- | --- |
| `level_test_booking` | 레벨테스트 | `ops_registration_appointments` | 예약 1건·보호자 1명 | `kind=level_test`, scheduled, 미래 일시, 참여 과목 존재 |
| `visit_consultation_booking` | 상담 | `ops_registration_appointments` | 예약 1건·보호자 1명 | `kind=visit_consultation`, scheduled, 미래 일시, 참여 과목 존재 |
| `appointment_reminder` | 레벨테스트·상담 | `ops_registration_appointments` | 예약 1건·보호자 1명 | 예약이 scheduled이고 현재 시각보다 뒤이며 아직 같은 appointment revision으로 발송하지 않음 |
| `waiting_notice` | 대기 | `ops_registration_subject_tracks`와 저장된 대기 상세 | 과목 트랙 1건·보호자 1명 | workflow가 세 대기 상태 중 하나이고 대기 종류별 필수 사실 존재 |
| `admission_application` | 입학 | 등록 신청 건과 대상 수강 계획 | 신청 건 1건·보호자 1명 | 발송 대상 과목이 하나 이상이고 기존 입학 메시지 claim 조건 충족 |

하나의 예약에 여러 과목이 참여해도 고객 메시지는 한 건이다. 과목은 중복 제거 후 `영어 · 수학 · 과학`처럼 안정 정렬해 렌더링한다. 대기 안내는 과목별 결정이므로 트랙마다 별도 미리보기와 발송 이력을 가진다. 입학신청서는 현재와 같이 신청 건 단위로 한 번 보내고 대상 과목 배지를 함께 보여 준다.

`appointment_reminder`는 레벨테스트와 방문상담에 공통으로 사용하되 `예약종류` 변수를 서버가 각각 `레벨테스트`, `방문상담`으로 제한한다. 임의의 안내 제목이나 자유 문구는 받지 않는다.

고객 리마인드는 현재 appointment revision마다 한 번만 보낸다. 같은 일정에 전날·당일·1시간 전처럼 여러 자동 회차를 만들지 않는다. 예약이 실제로 변경돼 `notification_revision`과 fingerprint가 달라지면 변경된 일정의 새 리마인드를 다시 미리볼 수 있다.

## 6. SOLAPI 템플릿 catalog

코드의 server-only catalog가 각 `message_kind`에 대해 다음을 하나로 소유한다.

- 환경 변수 이름
- 승인 템플릿 ID
- 논리 template revision
- 정확한 본문 패턴
- 허용 변수와 formatter
- 고정 버튼 목록
- SOLAPI `disableSms=true`
- 본문·버튼 checksum

신규 템플릿 네 개를 만들고 기존 입학 템플릿 하나를 재사용한다. 모든 메시지는 정보성 기본형이며 문자 대체발송을 사용하지 않는다.

### 6.1 레벨테스트 예약 안내

환경 변수: `SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID`

```text
[팁스영어수학학원] 레벨테스트 예약 안내

안녕하세요. #{학생명} 학생의 레벨테스트 예약을 안내드립니다.

일시: #{예약일시}
장소: #{장소}
과목: #{과목}

일정 변경이 필요하시면 학원으로 연락해 주세요.
```

허용 변수: `학생명`, `예약일시`, `장소`, `과목`

버튼: 없음

### 6.2 방문상담 예약 안내

환경 변수: `SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID`

```text
[팁스영어수학학원] 방문상담 예약 안내

안녕하세요. #{학생명} 학생의 방문상담 예약을 안내드립니다.

일시: #{예약일시}
장소: #{장소}
과목: #{과목}

일정 변경이 필요하시면 학원으로 연락해 주세요.
```

허용 변수: `학생명`, `예약일시`, `장소`, `과목`

버튼: 없음

### 6.3 예약 리마인드

환경 변수: `SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID`

```text
[팁스영어수학학원] 예약 리마인드

안녕하세요. #{학생명} 학생의 #{예약종류} 일정을 다시 안내드립니다.

일시: #{예약일시}
장소: #{장소}
과목: #{과목}

변경이 필요하시면 학원으로 연락해 주세요.
```

허용 변수: `학생명`, `예약종류`, `예약일시`, `장소`, `과목`

`예약종류` 허용 값: `레벨테스트`, `방문상담`

버튼: 없음

### 6.4 대기·개강 알림 신청 접수 안내

환경 변수: `SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID`

```text
[팁스영어수학학원] 대기 신청 접수 안내

안녕하세요. #{학생명} 학생의 #{과목} #{대기종류} 요청이 접수되었습니다.

대기 내용: #{대기내용}

변동 사항이 확인되는 대로 다시 안내드리겠습니다.
```

허용 변수: `학생명`, `과목`, `대기종류`, `대기내용`

`대기종류` 허용 값: `현재반 대기`, `신규반 대기`, `다음 개강 알림`

버튼: 없음

`대기내용`은 서버가 다음처럼 만든다.

- 현재반 대기: 저장된 수업명
- 신규반 대기: `신규반 개설 대기`
- 다음 개강 알림: `다음 개강 일정 알림 요청`

현재반 대기인데 유효한 수업명이 없으면 미리보기를 만들지 않는다.

### 6.5 입학신청서 작성 안내

환경 변수: `SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID`

현재 SOLAPI에서 발송 가능 상태인 `등록_입학신청서_작성안내` 템플릿과 고정 웹링크 버튼 `입학신청서 작성`을 재사용한다. 허용 변수는 `학생명` 하나다. 고정 모바일·PC 링크는 현재 승인된 `https://bit.ly/3rurm5t`와 catalog 값이 정확히 같아야 한다.

입학 미리보기와 provider 요청은 이 catalog의 동일 renderer를 사용한다. 구형 화면의 별도 `getRegistrationAdmissionSolapiMessage()` 문자열은 제거하거나 동일 catalog 소비자로 바꿔 두 문구 소유자를 하나로 만든다.

### 6.6 템플릿 drift preflight

운영 활성화 전에 read-only SOLAPI API로 다섯 템플릿의 다음 값을 catalog와 비교하는 preflight를 둔다.

- 승인 상태
- PF ID
- 본문
- 변수 이름
- 버튼 이름·종류·링크
- 문자 대체발송 비활성

하나라도 다르면 해당 `message_kind`를 `template_drift`로 막는다. runtime은 provider template을 브라우저가 선택하게 하지 않으며, 미리보기마다 SOLAPI API를 호출하지 않는다.

## 7. 데이터 모델

기존 테이블을 파괴적으로 바꾸지 않고 public audit 테이블 두 개와 private template receipt·activation gate 두 개를 additive migration으로 추가한다.

### 7.1 `ops_registration_customer_message_previews`

미리보기 당시의 권위 있는 사실과 확인 주체를 보존한다.

주요 열:

- `id uuid primary key`
- `task_id uuid not null`
- `track_id uuid null`
- `appointment_id uuid null`
- `message_kind text not null`
- `source_fingerprint text not null`
- `source_revision bigint null`
- `recipient_hash text not null`
- `recipient_last4 text not null`
- `template_key text not null`
- `template_revision integer not null`
- `template_checksum text not null`
- `rendered_variables_checksum text not null`
- `rendered_body_checksum text not null`
- `rendered_buttons_checksum text not null`
- `created_by uuid not null`
- `created_at timestamptz not null`
- `expires_at timestamptz not null`
- `consumed_at timestamptz null`

미리보기 유효시간은 15분이다. `created_by`와 현재 로그인 사용자가 같아야 발송할 수 있다. 전체 전화번호, 학생명, 렌더링 본문, 치환 변수 값은 저장하지 않는다. preview 응답은 메모리에서 렌더링하고 DB에는 세 checksum만 보존한다. 확인 발송 때 canonical source를 다시 렌더링해 세 checksum이 모두 같아야 진행한다. `recipient_hash`는 server-only pepper를 사용한 비가역 HMAC이며 화면에는 `recipient_last4`만 반환한다.

### 7.2 `ops_registration_customer_messages`

실제 발송 시도와 provider 상태의 권위 있는 outbox다.

주요 열:

- `id uuid primary key`
- `preview_id uuid not null unique`
- `task_id`, `track_id`, `appointment_id`
- `message_kind`
- `source_fingerprint`, `source_revision`
- `recipient_hash`, `recipient_last4`
- `template_key`, `template_revision`, `template_checksum`
- `rendered_variables_checksum`, `rendered_body_checksum`, `rendered_buttons_checksum`
- `dedupe_key text not null unique`
- `request_key text not null unique`
- `status text not null`
- `claim_active boolean not null`
- `provider_attempt_started_at timestamptz null`
- `provider_attempt_count integer not null default 0`
- `provider_message_id`, `provider_group_id`
- `provider_status_code`, `provider_status_message`
- `provider_evidence jsonb`
- `error_code text`
- `confirmed_by uuid not null`
- `confirmed_at`, `created_at`, `updated_at`

`status`는 기존 입학 메시지 안전 계약을 이어서 `pending`, `accepted`, `unknown`, `failed_hold`만 사용한다.

- `pending`: provider 시도 전 claim을 소유하거나 `pre_send_failed` 사유로 안전한 동일 요청 replay를 기다리는 상태
- `accepted`: provider가 정상 접수를 확인한 상태
- `unknown`: 네트워크 단절·timeout·worker 손실처럼 접수 여부를 단정할 수 없는 상태
- `failed_hold`: provider 증거로 미접수가 확인됐고 자동 재발송을 잠근 상태

`provider_evidence`는 provider message/group ID, 정규화된 상태 코드, 관찰 시각, request key 일치 여부만 허용하는 구조화된 JSON이다. provider 응답 원문, 전체 수신번호, Authorization, 렌더링 본문은 저장하지 않는다.

서버는 `message_kind + canonical source ID + source_fingerprint + recipient_hash`를 안정 직렬화해 `dedupe_key`를 만든다. unique index가 서로 다른 preview가 동시에 같은 사실을 발송하려는 경우에도 outbox 한 건만 허용한다. `pending`, `accepted`, `unknown`, `failed_hold` 어느 상태든 같은 `dedupe_key`는 새 발송을 영구 차단한다. 동일 사실을 임의로 재발송하는 기능은 이번 범위에 넣지 않는다. 원천 사실이 실제로 바뀌어 fingerprint가 달라지면 새 미리보기부터 다시 시작할 수 있다.

멱등 replay의 동일성은 `preview_id + request_key + confirmed_by` 세 값으로 정의한다. 세 값이 모두 같을 때만 기존 마스킹 결과를 반환한다. 이미 존재하는 `request_key`를 다른 preview 또는 사용자에게 재사용하거나, 이미 소비된 preview에 다른 request key를 사용하면 기존 행의 어떤 값도 노출하지 않고 각각 `request_key_conflict`, `preview_consumed` 409로 종료한다. unique 충돌을 받은 두 번째 transaction은 provider owner를 획득하지 않는다.

기존 `ops_registration_messages`는 과거 입학 메시지 조회용으로 유지한다. 신규 발송은 새 outbox만 사용하며 과거 행을 backfill하거나 삭제하지 않는다. live 행이 없더라도 destructive drop은 하지 않는다.

### 7.3 `dashboard_private.registration_customer_solapi_template_receipts`

read-only SOLAPI template drift preflight 결과를 보존하는 private receipt다.

주요 열:

- `message_kind text primary key`
- `template_id text not null`
- `pf_id text not null`
- `catalog_checksum text not null`
- `provider_checksum text not null`
- `provider_status text not null`
- `verified_by uuid not null`
- `verified_at timestamptz not null`

server-only preflight가 provider의 승인 템플릿을 읽고 catalog와 정확히 일치할 때만 receipt를 upsert한다. 종류별 activation RPC는 현재 env의 template ID·PF ID·catalog checksum과 일치하는 receipt가 없으면 `verification`과 `live` 전환을 거부한다. 공개 readiness는 secret이나 provider ID 없이 `templateVerified`와 `verifiedAt`만 반환한다.

승인 템플릿은 수정 불가이므로 매 미리보기마다 provider를 조회하지 않는다. template ID 또는 catalog checksum이 바뀌면 기존 receipt가 자동으로 무효가 되며 새 preflight 전까지 fail-closed다.

### 7.4 `dashboard_private.registration_customer_solapi_activation`

운영 실수신 검증 중 실제 등록 건이 발송 대상이 되지 않도록 종류별 server-only gate를 둔다.

주요 열:

- `message_kind text primary key`
- `mode text not null check (mode in ('off', 'verification', 'live'))`
- `verification_task_id uuid null`
- `verification_recipient_hash text null`
- `live_test_message_id uuid null references ops_registration_customer_messages(id)`
- `live_test_confirmed_at timestamptz null`
- `updated_by uuid null`
- `updated_at timestamptz not null`

migration은 다섯 행을 모두 `off`, `updated_by=null`로 만든다. CHECK constraint는 `verification`일 때 task ID·recipient hash·updated_by를 모두 요구하고, `live`일 때 accepted live-test message ID·실제 수신 확인 시각·updated_by를 모두 요구한다. `verification`은 admin이 지정한 `SOLAPI 테스트` task ID와 당시의 recipient hash가 모두 일치할 때만 preview/send를 허용한다. 다른 task는 admin/staff 모두 `verification_scope_mismatch`로 막힌다. `live` 전환은 해당 종류의 accepted message와 사용자의 실제 수신 확인 시각, 현재 template receipt가 모두 있어야 admin-only activation RPC가 허용한다. UI와 공개 readiness에는 `off`, `verification`, `live`만 보이고 allowlist 값은 노출하지 않는다.

### 7.5 canonical resolver와 source fingerprint

서버는 종류별 canonical fact를 안정 JSON으로 정규화한 뒤 SHA-256 fingerprint를 만든다.

- 공통 identity는 `ops_tasks.id/type/student_name`과 `ops_registration_details.task_id/parent_phone`만 읽는다. `type=registration`, 비어 있지 않은 학생명, 정규화된 국내 휴대전화 번호가 아니면 차단한다.
- 예약 source는 브라우저가 보낸 appointment ID로 `ops_registration_appointments`를 읽고 `task_id`, `kind`, `status`, `scheduled_at`, `place`, `notification_revision`을 고정한다. 참여 과목은 `level_test`면 해당 appointment의 유효한 `ops_registration_level_tests`, `visit_consultation`이면 해당 appointment의 유효한 visit `ops_registration_consultations`에서 track ID를 얻어 `ops_registration_subject_tracks.subject`와 조인한다. 브라우저가 보낸 과목은 사용하지 않는다.
- 대기 source는 track ID로 `workflow_status`, `workflow_revision`, `waiting_detail_kind`, `waiting_detail_class_id`를 읽는다. 세 대기 workflow status와 저장된 `waiting_detail_kind`가 일치해야 하며, 현재반 대기는 `waiting_detail_class_id`로 `classes.id/name`을 읽는다. legacy `pipeline_status`, `waiting_kind`와 새 detail이 충돌하거나 필수 detail이 없으면 어느 한쪽을 선택하지 않고 `waiting_source_inconsistent`로 차단한다.
- 입학 source는 기존 `getRegistrationAdmissionApplicationState`와 같은 서버 selector를 사용한다. 즉 track이 `workflow_status=enrollment_requested`, legacy `pipeline_status=enrollment_decided`, 또는 `status=planned`이면서 `admission_batch_id`가 없는 enrollment에 연결된 경우만 대상 track ID에 포함하고 중복 제거·안정 정렬한다. `ops_registration_details.admission_notice_sent=true`이거나 기존 입학 message가 accepted/active이면 이미 전달된 것으로 보고 새 outbox를 만들지 않는다. 입학신청서 링크는 DB나 브라우저 값이 아니라 catalog의 승인된 고정 링크다.

fingerprint 구성은 공통 task ID·학생 표시명·recipient hash·template revision에 위 canonical source의 ID, revision, 상태, 정렬된 track ID·과목, 예약 사실 또는 대기 detail, catalog 고정 링크를 더한 값이다.

미리보기 소비 시 같은 사실을 DB에서 다시 읽어 fingerprint와 recipient hash를 재계산한다. 다르면 `preview_stale`로 provider 호출 전에 종료한다.

## 8. 서버 API와 원자성

### 8.1 미리보기

`POST /api/solapi/registration/preview`

브라우저 입력:

```json
{
  "messageKind": "level_test_booking",
  "sourceId": "canonical-uuid"
}
```

`sourceId`는 예약 종류에서는 appointment ID, 대기에서는 track ID, 입학에서는 task ID다. 서버는 로그인, 역할, 신청 건 접근권한, 메시지 종류별 상태, 보호자 번호, template readiness를 검증한다.

성공 응답:

```json
{
  "previewId": "opaque-uuid",
  "expiresAt": "ISO-8601",
  "messageKind": "level_test_booking",
  "studentName": "표시명",
  "recipientLast4": "1234",
  "facts": {
    "subjectLabel": "영어 · 수학",
    "scheduleLabel": "2026년 8월 8일 토요일 오후 2:00",
    "placeLabel": "본관"
  },
  "body": "실제 provider와 같은 렌더링 본문",
  "buttons": []
}
```

응답에는 전체 수신번호, template ID, PF ID, source fingerprint, provider credential을 넣지 않는다.

### 8.2 확인 발송

`POST /api/solapi/registration/send`

브라우저 입력:

```json
{
  "previewId": "opaque-uuid",
  "requestKey": "client-generated-uuid"
}
```

서버는 다음 순서로 처리한다.

1. 로그인·admin/staff 역할과 preview 소유자를 확인한다.
2. 한 transaction에서 request key 충돌을 검사하고 preview를 `for update`로 잠가 만료·소비 여부를 확인한다.
3. canonical source와 보호자 번호를 다시 읽고 fingerprint, recipient hash, template checksum, 세 rendered checksum, 종류별 activation gate를 다시 검증한다.
4. `dedupe_key`를 만들고 unique insert로 같은 사실의 다른 preview와 직렬화한다.
5. provider 시도 전 상태인 `pending`, `provider_attempt_count=0` outbox와 claim을 만들고 preview를 소비한 뒤 commit한다.
6. commit 뒤 canonical source를 한 번 더 읽어 checksum을 비교하고, 메모리에서 provider body·수신번호·HMAC Authorization을 준비한다. 이 단계까지는 SOLAPI 네트워크 호출이 없다.
7. 준비가 끝나면 별도 `mark_attempt_started` transaction이 동일 claim token, `provider_attempt_count=0`, canonical fingerprint·recipient hash·세 checksum, activation gate를 다시 확인하고 `provider_attempt_started_at`, `provider_attempt_count=1`, exact dispatch token을 원자 기록한다.
8. marker commit이 성공한 owner만 SOLAPI ATA 요청을 정확히 한 번 수행하고 provider 응답을 `accepted`, `failed_hold`, `unknown` 중 하나로 원자 완료한다.

2단계는 exact replay 조회를 consumed-preview 거부보다 먼저 수행한다. 따라서 정확한 세 값 replay는 기존 마스킹 결과를 얻지만, 다른 request key나 사용자는 소비된 preview를 재사용할 수 없다.

첫 transaction이 실패하면 preview와 outbox가 함께 rollback된다. 6단계에서 오류가 나면 provider 시도가 없으므로 outbox는 `pending`을 유지하되 claim을 `pre_send_failed` 사유로 해제한다. 동일한 `previewId + requestKey + confirmedBy` replay만 canonical source와 checksum을 다시 확인한 뒤 `provider_attempt_count=0` claim을 재획득할 수 있다. 전체 수신번호나 frozen provider payload를 DB에 저장해 재사용하지 않는다.

7단계 marker가 기록된 뒤에는 실제 HTTP 호출 여부를 프로세스가 증명하지 못하더라도 재호출하지 않는다. 응답 전 process death 또는 replay가 `pending + provider_attempt_count=1`을 발견하면 먼저 `unknown`으로 원자 완료하고 조회·수동 조정만 허용한다. timeout, 연결 단절, 해석 불가 응답도 `unknown`이다. `customFields.registrationRequestKey`는 조회 증거일 뿐 SOLAPI idempotency를 가정하지 않는다. 이 계약은 외부 전달 exactly-once를 주장하지 않고, 우리 시스템의 provider 재호출을 보수적으로 한 번 이하로 제한한다.

### 8.3 조회·조정

- `GET /api/solapi/registration/messages?messageKind=...&sourceId=...`는 마스킹된 최근 발송 이력과 readiness만 반환한다.
- `POST /api/solapi/registration/check`는 admin/staff가 `unknown` 또는 오래 지속된 `pending + provider_attempt_count=1` 메시지만 provider message/group ID와 exact request key로 조회하고, 명시적 provider 증거가 있을 때만 상태를 확정한다.
- provider 시도 후 15분 이내에는 기존 정책처럼 성급한 상태 조회를 막는다.
- 자동 조회로 확정할 수 없으면 admin만 구조화된 provider evidence와 사유를 첨부해 `accepted` 또는 `failed_hold`로 수동 reconcile할 수 있다. staff는 임의 상태 확정이나 다른 사용자의 claim 해제를 할 수 없다.
- 만료된 pre-send claim은 `provider_attempt_count=0`과 attempt marker 부재가 함께 증명될 때만 원 확인 사용자의 exact replay 또는 admin의 사유 있는 release가 가능하다.
- `unknown`과 `failed_hold`에서 자동·수동 재발송하지 않는다. `failed_hold`도 같은 `dedupe_key`를 계속 소유한다.

기존 `/api/solapi/registration`의 입학 GET/POST 소비자는 새 API로 옮기고, 전환 기간에 호출되면 새 admission catalog와 outbox로 위임한다. 두 route가 같은 입학 메시지를 각각 발송하는 기간은 만들지 않는다.

## 9. 권한과 개인정보

- `admin`, `staff`: 미리보기, 확인 발송, 마스킹 상태 조회, exact provider `check` 가능
- `admin`만: verification/live/off gate 변경, 다른 사용자의 pre-send claim release, provider evidence 수동 reconcile 가능
- 담당 원장/선생님: 자신이 볼 수 있는 등록 신청서의 마스킹된 최근 발송 상태는 읽을 수 있지만 preview 생성·고객 발송·provider check/reconcile은 할 수 없음
- anon/PUBLIC: preview, outbox, RPC, API 모두 접근 불가
- service role: provider adapter와 server-side finalize에 필요한 최소 범위만 사용

두 public base table은 RLS만 믿지 않고 anon과 authenticated의 모든 direct table privilege를 revoke한다. authenticated에는 base table SELECT를 주지 않으며, API와 security-definer RPC가 역할·등록 건 접근권한을 재검사한 뒤 허용된 열만 projection한다. 원장/선생님 projection은 message kind, 상태, 시각만 포함하고 recipient hash/last4, checksum, provider evidence, confirmer ID를 반환하지 않는다. admin/staff projection도 끝 4자리와 정규화된 상태만 반환하며 raw provider evidence는 admin reconcile 경로 안에서만 읽는다.

학생명은 메시지에 필요한 표시명만 사용한다. 메모, 상담 결과, 건강 정보, 전체 전화번호, 내부 링크, provider 원문 오류는 알림톡이나 audit table에 넣지 않는다. 만료됐고 소비되지 않은 preview는 참조 outbox가 없을 때 정리할 수 있다. 소비된 preview와 outbox는 첫 릴리스에서 임의의 새 보존 기간을 도입하거나 삭제하지 않고 기존 notification audit 보존 정책을 따른다. 향후 service-role redaction이 승인돼도 `pending`, `unknown`처럼 미해결 상태는 제외한다.

서버 로그는 request key, message ID, message kind, 상태 코드만 구조화해 남긴다. Authorization header, API Secret, 전체 수신번호, rendered body, provider 원문 body를 로그에 쓰지 않는다.

## 10. canonical 등록 UI

공통 `RegistrationAlimtalkPreviewDialog`를 한 번 만들고 다섯 종류가 사용한다.

### 10.1 버튼 위치

- 레벨테스트 예약 저장 영역: 저장된 예약이 있을 때 `예약 안내 알림톡`과 `리마인드 알림톡`
- 방문상담 예약 저장 영역: 저장된 예약이 있을 때 `예약 안내 알림톡`과 `리마인드 알림톡`
- 대기 영역: 저장된 대기 상태·세부 정보가 완전할 때 과목별 `대기 안내 알림톡`
- 입학 영역: 현재 직접 발송 버튼을 `입학신청서 알림톡`으로 바꾸고 동일 preview dialog를 연다.

버튼은 진행상태를 바꾸지 않는다. 저장되지 않은 초안 값으로 미리보기를 만들지 않는다. 예약·대기 정보가 dirty하면 먼저 저장해야 한다는 짧은 안내를 보여 준다.

### 10.2 미리보기 구성

대화상자는 다음만 보여 준다.

1. 메시지 종류와 학생 표시명
2. `학부모 전화 · 끝 1234`
3. 예약·대기·대상 과목의 핵심 사실
4. 실제 승인 템플릿과 같은 본문
5. 실제 카카오 버튼이 있으면 버튼 이름과 목적지 host
6. template readiness와 최근 같은 사실의 발송 상태
7. `돌아가기`, `확인 후 발송`

별도 설명 카드나 provider 기술 용어를 늘어놓지 않는다. `확인 후 발송`은 미리보기 로딩이 끝났고, preview가 만료되지 않았고, 사용자가 발송 권한을 가지며, 같은 `dedupe_key`의 어떤 outbox도 없고, 현재 task가 activation gate 범위에 들어올 때만 활성화한다.

발송 성공 후 `SOLAPI 접수 완료 · 학부모 전화 끝 1234`를 표시하고 최근 발송 이력을 갱신한다. 접수 여부가 불확실하면 `발송 결과 확인 필요`를 보여 주고 발송 버튼을 잠근다. 실패 원문 대신 사용자가 할 수 있는 `상태 확인` 행동만 제공한다.

`failed_hold`는 `발송 실패 · 같은 내용 재발송 불가`로 표시하고 버튼을 계속 잠근다. 보호자 번호나 원천 업무 사실이 실제로 수정돼 fingerprint가 바뀐 경우에만 저장 후 새 미리보기로 시작한다.

### 10.3 반응형·접근성

- desktop과 390 CSS px에서 대화상자가 viewport를 벗어나지 않는다.
- 본문은 줄바꿈을 보존하고 긴 과목·수업명이 가로 overflow를 만들지 않는다.
- trigger, 닫기, 확인 버튼은 44×44 CSS px 이상이다.
- 대화상자 제목, 설명, focus trap, Escape, 취소 후 trigger focus 복귀를 검증한다.
- 오류는 `role=alert`, 접수 완료는 `role=status`로 알린다.
- 색상만으로 발송 가능·불확실·완료 상태를 구분하지 않는다.

## 11. runtime readiness와 activation gates

additive migration의 마지막 객체로 `public.registration_customer_solapi_runtime_version() returns integer`를 만들고 정확히 `1`을 반환한다.

DB에는 다섯 message kind의 activation row를 모두 `off`로 설치한다. boolean 하나로 검증과 운영을 섞지 않고 각 행은 `off → verification → live`만 admin-only RPC로 이동한다. `verification`에는 합성 task ID와 recipient hash가 반드시 필요하고, `live`에는 해당 종류의 실제 수신 확인 증거가 반드시 필요하다.

미리보기 readiness는 아래 조건을 모두 독립적으로 보여 준다.

- runtime marker = 1
- 종류별 activation mode가 현재 task에 유효함: 합성 건은 `verification`, 일반 운영 건은 `live`
- API Key/Secret 존재
- PF ID 존재
- 해당 template ID 존재
- 현재 env·catalog checksum과 일치하는 승인 템플릿 receipt 존재
- 보호자 번호와 source 상태 유효

설치·배포만으로 gate를 `verification`이나 `live`로 바꾸지 않는다. 기존 `notification_control_plane_dispatch_registration_enabled`, 내부 reminder rule, Google Chat, Web Push, quarantine worker/cron은 이번 활성화에서 변경하지 않는다.

## 12. SOLAPI·Vercel 운영 설정

### 12.1 SOLAPI

1. `tipsedu` 채널에 신규 템플릿 네 개를 등록한다.
2. 본문·변수·버튼·문자 대체발송 설정을 catalog와 대조한다.
3. 네 템플릿 모두 카카오 검수를 요청한다.
4. 모두 발송 가능 상태가 된 뒤 template ID를 기록한다.
5. `tips-dashboard-production-solapi` 전용 API Key를 새로 만든다.
6. API Secret은 생성 화면에서 한 번만 읽어 Vercel Production secret으로 바로 전달하며 파일·채팅·로그·clipboard history에 남기지 않는다.

Vercel serverless egress에 고정 IP가 보장되지 않으므로 임의의 IP allowlist를 설정하지 않는다. 전용 키, server-only secret, 종류별 activation gate, 즉시 폐기 가능한 rotation 절차로 범위를 제한한다.

### 12.2 Vercel Production

Production에만 다음 환경 변수를 설정한다.

- `SOLAPI_API_KEY`
- `SOLAPI_API_SECRET`
- `SOLAPI_KAKAO_PF_ID`
- `SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID`
- `SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID`
- `SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID`
- `SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID`
- `SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID`
- `REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER`

Preview와 로컬 `.env.local`에는 실제 provider credential을 복사하지 않는다. 로컬 QA는 provider-zero fake adapter만 사용한다. 환경 변수 변경 뒤 Production을 다시 배포하고 readiness endpoint가 secret 값 없이 `configured` 상태만 반환하는지 확인한다.

잔액 충전, 자동충전, 결제수단 등록은 이 설계의 권한에 포함하지 않는다. 실제 수신 검증에 필요한 최소 잔액이 부족하면 결제 단계에서 멈추고 별도 승인을 받는다.

## 13. 테스트 전략

### 13.1 순수 단위 테스트

- 다섯 message kind catalog와 환경 변수 mapping
- 허용 변수 외 값 거부
- KST 예약 일시 formatter와 과목 안정 정렬
- 세 대기 상태의 `대기종류`·`대기내용`
- exact template/body/button checksum
- 전체 전화번호·provider secret·내부 URL이 preview에 없음
- source fingerprint 결정성

### 13.2 route/core 테스트

- 브라우저가 phone, template ID, body, variables, PF ID를 보내면 400
- admin/staff와 미권한 역할 경계
- preview 만료, 다른 사용자의 preview, 소비된 preview 차단
- 예약 revision·보호자 번호·대기 상태·template checksum 변경 시 provider 0회
- exact tuple replay의 동일 결과와 request key/preview conflict 비노출 409
- 같은 dedupe key의 서로 다른 preview 동시 발송 차단
- provider attempt marker 전 실패만 동일 replay 가능, marker 후 crash/replay는 provider 재호출 0회와 `unknown`
- `failed_hold`가 같은 dedupe key를 계속 잠금
- provider 정상 접수, 명시적 reject, timeout, 5xx, 해석 불가 응답
- `unknown` 자동 재발송 0회와 exact lookup/reconcile
- 로그와 응답의 secret/전체 번호/provider body 비노출

### 13.3 DB·pgTAP

- additive schema와 모든 CHECK/FK/unique index
- preview create/consume/outbox claim transaction rollback
- 같은 사실의 서로 다른 preview를 쓰는 두 session 동시 확인 발송에서 dedupe owner 1개
- `provider_attempt_count`는 0 또는 1이며 marker 뒤 claim replay가 새 owner를 만들지 않음
- anon/PUBLIC/authenticated base table direct privilege 차단과 역할별 마스킹 projection
- source 종류별 canonical resolver와 RLS
- activation row default `off`, verification task/recipient mismatch 차단, live evidence 없는 전환 차단, runtime marker fail-closed
- 기존 입학 message/history 무변경

공유 production DB를 테스트에 사용하지 않는다. disposable local Supabase/Postgres에서 `--execute --approved-local-db`가 명시된 경우에만 pgTAP과 실제 RPC round-trip을 수행하고 정확히 정리한다.

### 13.4 브라우저 QA

flow under test:

```text
등록 상세 → 저장된 예약/대기/입학 알림톡 버튼 → 마스킹 수신자와 실제 본문 미리보기 → 확인 후 발송 → 접수 상태와 이력 갱신
```

provider-zero fixture로 다섯 종류를 desktop과 390 CSS px에서 확인한다. 네트워크는 `/api/solapi/**` fixture 외 `api.solapi.com` 요청을 차단한다. 페이지 identity, framework overlay, console error/warn, focus, Escape, dirty source 차단, duplicate 차단, screenshot을 확인한다.

### 13.5 빌드·회귀

- 관련 Node tests
- migration/schema source tests
- TypeScript
- 변경 파일 ESLint
- `next build --webpack`
- 기존 등록 예약, 대기, 입학, notification provider-zero 회귀

## 14. 운영 설치와 실제 수신 검증

운영 전환은 다음 순서를 바꾸지 않는다.

1. 코드와 additive migration을 종류별 activation mode `off` 상태로 완성한다.
2. provider-zero 단위·DB·브라우저·빌드 검증을 통과한다.
3. 최신 remote migration history와 DB health를 read-only로 확인한다.
4. forward migration을 적용하고 runtime marker·모든 gate `off`를 확인한다.
5. Production code를 배포하되 credential이 없으면 fail-closed인지 확인한다.
6. SOLAPI 신규 템플릿 네 개를 등록·검수 요청한다.
7. 모두 발송 가능 상태가 될 때까지 provider 상태만 확인한다.
8. 전용 API Key를 만들고 Production 환경 변수에 직접 저장한다.
9. Production을 재배포하고 template drift preflight와 readiness를 확인한다.
10. 사용자가 TIPS에 `SOLAPI 테스트` 가상 등록 건을 만들고 본인 번호를 직접 입력한다. 실제 학생 데이터를 사용하지 않는다.
11. admin-only RPC로 한 종류씩 합성 task ID와 recipient hash를 묶어 `verification`으로 전환한다. 다른 등록 건의 preview/send가 차단되는지 먼저 확인한다.
12. 해당 종류에서 미리보기 → 확인 후 발송 → SOLAPI accepted → 실제 카카오 수신 → 마스킹 이력을 확인하고 live-test 증거를 기록한다.
13. 같은 preview/request key 재시도와 같은 source 중복 클릭이 추가 provider 요청을 만들지 않는지 확인한 뒤 해당 종류를 다시 `off`로 돌린다.
14. 다섯 종류 검증이 모두 끝난 뒤 admin-only activation RPC로 다섯 gate를 최종 `live`로 전환한다.

실제 수신 확인은 다섯 종류 각각 한 건으로 제한한다. 전체 번호나 메시지 원문이 테스트 보고서에 남지 않게 하고, provider message ID도 필요한 최소 마스킹만 기록한다. 합성 등록 건 정리는 실제 수신·감사 이력 보존 기준을 확인한 뒤 별도 명시적 작업으로 수행한다.

템플릿 검수는 외부 비동기 단계다. 검수 대기 중에는 코드·DB·Production gate `off` 상태를 유지하고 발송 완료를 주장하지 않는다.

## 15. 실패·복구·rollback

### 15.1 즉시 차단

다음 상황에서는 해당 종류 activation mode를 `off`로 바꾸는 것이 첫 rollback이다.

- 잘못된 템플릿 또는 변수 치환
- 예상하지 못한 중복 요청
- recipient/source 재검증 실패
- provider 상태 조회 불일치
- 개인정보가 UI·로그에 과다 노출됨

gate `off`는 새 preview/send를 막지만 이미 `accepted`된 provider 메시지를 취소했다고 표시하지 않는다.

### 15.2 credential 사고

API Key/Secret 노출이 의심되면 SOLAPI에서 전용 키를 폐기하고 새 키를 만든 뒤 Vercel Production 환경 변수를 교체하고 재배포한다. 기존 key를 채팅·문서·git에 복사하지 않는다.

### 15.3 코드·DB rollback

- 코드 rollback은 직전 Production commit으로 재배포한다.
- migration은 additive이므로 운영 중 down migration으로 테이블·이력을 삭제하지 않는다.
- 새 route가 없어도 새 테이블과 `off` gate는 inert 상태로 남을 수 있다.
- 기존 내부 reminder rules와 기존 입학 history는 건드리지 않는다.
- `unknown` message는 rollback 과정에서도 실패로 추측하거나 재발송하지 않는다.

## 16. 범위 밖

- 보호자 예약 리마인드의 자동 예약 발송과 cron
- 고객별 자유문구 작성기
- 카카오 광고·브랜드 메시지
- SMS/LMS 대체발송
- SOLAPI 잔액 자동충전·결제수단 등록
- 기존 내부 in-app/Google Chat reminder rule 활성화
- Google Chat, Web Push 또는 MakeEdu 알림 계약 변경
- 입학신청서·수납·청구서 업무 순서 변경
- 실제 학생·보호자에 대한 일괄 발송 또는 백필
- 과거 `ops_registration_messages` 삭제·재작성
- 미등록·문의만·예약 취소 전용 고객 템플릿

## 17. 완료 기준

다음 증거가 모두 있어야 완료다.

1. 다섯 종류가 canonical 등록 신청서의 정확한 영역에 보인다.
2. 저장되지 않은 초안과 stale preview는 provider 0회다.
3. 모든 발송은 마스킹 수신자와 실제 provider 본문 확인을 거친다.
4. 중복 클릭·request replay·동시 발송이 provider 요청을 한 번만 만든다.
5. `unknown`은 자동 재발송되지 않고 조회·수동 조정 경로를 가진다.
6. 신규 네 템플릿과 기존 입학 템플릿이 catalog drift 없이 발송 가능 상태다.
7. Production에만 전용 API credential과 다섯 template ID가 설정돼 있다.
8. 운영 migration, Vercel Production 배포, DB activation gate, provider 상태가 각각 검증됐다.
9. `SOLAPI 테스트` 합성 등록 건으로 다섯 종류가 각각 한 번 실제 수신됐다.
10. 실제 학생 메시지, 자동 고객 reminder, 내부 알림 activation, 잔액 결제는 발생하지 않았다.
11. 테스트·TypeScript·ESLint·Webpack build·desktop/390px 브라우저 QA가 통과했다.
12. 사용자 소유 미추적 계획 파일과 관련 없는 작업 트리 변경을 커밋하지 않았다.
