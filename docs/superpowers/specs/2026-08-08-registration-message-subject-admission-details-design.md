# 등록 알림톡 과목 범위·입학 수업 안내·공통 문의 버튼 설계

**작성일:** 2026-08-08

**상태:** 사용자 승인 완료 · 구현 계획 작성 전

**기준 브랜치:** `origin/main@5b9e6d6e`

**관련 기존 설계:** `2026-08-05-registration-solapi-customer-messages-design.md`

## 1. 목표

등록 프로세스의 고객 알림톡이 현재 과목별 진행상태와 실제 저장된 수업 정보를 정확히 반영하도록 한다.

1. 레벨테스트·방문상담·예약 리마인드는 같은 예약에서 **현재 해당 단계를 진행하는 과목만** 한 메시지에 묶는다.
2. 해당 단계를 진행하지 않는 형제 과목은 본문과 미리보기의 과목 명단에서 제외한다.
3. 입학신청서 알림톡에는 실제 등록 예정 수업의 반, 교재, 반복 요일·시간, 선생님, 강의실을 먼저 표시한다.
4. 입학 알림의 마지막에는 첫 수업일을 별도 줄로 분리해 기억하기 쉽게 강조한다.
5. 모든 고객 알림톡 마지막에 ChannelTalk 문의 버튼을 제공한다.

기존 `미리보기 → 명시적 확인 → 한 번 발송`, 문자 대체발송 금지, provider 불확실 상태 자동 재발송 금지 원칙은 유지한다.

## 2. 사용자 승인 규칙

### 2.1 과목 묶음

- 같은 예약에서 레벨테스트를 진행하는 과목이 영어·수학이면 `영어 · 수학` 한 건으로 보낸다.
- 영어만 레벨테스트를 진행하고 수학은 다른 단계이면 `영어`만 표시한다.
- 과목별로 메시지를 쪼개지 않는다.
- 대기 안내는 기존처럼 해당 대기 과목 한 개만 표시한다.
- 입학신청서는 학생의 입학 신청 건당 한 번 보내되, 실제 등록 예정 수업이 있는 과목과 수업만 담는다.

### 2.2 입학 수업 정보 순서

등록 수업 한 건은 다음 순서와 라벨을 사용한다.

```text
과목/수업: [영어] 중2 영어 A반
교재: 능률 VOCA
요일/시간: 월·수 오후 6:00–8:00
선생님: 홍길동
강의실: 본관 301호

첫 수업일: 8월 17일 월요일 오후 6:00–8:00
```

- 정규 수업 정보를 먼저 표시한다.
- `첫 수업일`은 마지막에 빈 줄로 분리해 고객 메시지 안에서 강조한다.
- 알림톡 본문은 굵은 글꼴을 지원하지 않는 기본 텍스트형이므로 별도 기호를 추가하지 않고, 마지막 배치와 공백으로 강조한다.
- 운영자 미리보기 화면에서는 `첫 수업일` 라벨을 시각적으로 강조해 발송 전 확인하기 쉽게 한다.
- 수업이 여러 개면 이 블록을 과목 순서 → `enrollment.sort_order` → 반명 → enrollment UUID 순서로 반복한다.
- 상세 전체 회차는 나열하지 않고 `자세한 수업 일정은 학원 홈페이지에서 확인해 주세요.`라고 안내한다.

### 2.3 공통 문의 버튼

모든 템플릿에 다음 고정 웹링크 버튼을 마지막 버튼으로 추가한다.

- 이름: `문의하기`
- 종류: `WL`
- 모바일: `https://tipsedu.channel.io`
- PC: `https://tipsedu.channel.io`

기존 업무 버튼 순서는 유지한다.

- 레벨테스트·방문상담·리마인드: `학원 위치 보기` → `문의하기`
- 대기: `문의하기`
- 입학: `입학신청서 작성` → `문의하기`

홈페이지 안내는 본문 문구로만 제공한다. 별도 홈페이지 버튼을 추가하지 않아 핵심 행동인 입학신청서 작성과 문의를 흐리지 않는다.

## 3. 검토한 접근법

### 3.1 서버 canonical source 필터링·확장 — 채택

예약과 입학의 현재 발송 단위는 유지하고, DB resolver가 현재 workflow와 저장된 등록 수업을 다시 읽어 canonical facts를 만든다.

- 장점: 같은 단계의 복수 과목을 한 메시지로 유지한다.
- 장점: 브라우저가 과목, 본문, 수업 정보를 조립하거나 조작할 수 없다.
- 장점: 기존 appointment/task 단위 중복 방지와 발송 감사를 유지한다.
- 장점: 미리보기 뒤 상태·수업 변경을 fingerprint로 감지할 수 있다.
- 단점: forward-only DB migration과 다섯 템플릿의 신규 승인이 필요하다.

### 3.2 과목별 개별 메시지 — 미채택

`appointment_id + track_id`마다 알림톡을 분리한다.

- 장점: 과목별 감사 단위가 가장 명확하다.
- 단점: 같은 보호자에게 같은 일정의 메시지가 여러 건 도착한다.
- 단점: 사용자가 승인한 “같은 단계의 과목은 한 메시지” 규칙과 다르다.

### 3.3 브라우저 화면값으로 본문 조립 — 미채택

현재 탭의 과목과 수업 정보를 API 요청에 그대로 담는다.

- 장점: DB 변경이 작다.
- 단점: 오래된 화면, 변조된 요청, 저장되지 않은 값이 고객 메시지에 포함될 수 있다.
- 단점: 미리보기와 실제 발송 사이의 원본 변경을 안전하게 검증하기 어렵다.

## 4. 메시지별 canonical 과목 범위

### 4.1 레벨테스트 예약 안내

발송 단위는 기존처럼 `appointment_id` 한 건이다. 과목은 다음 조건의 교집합으로 만든다.

1. 같은 task의 subject track이다.
2. 해당 appointment에 연결된 level-test activity가 `scheduled` 또는 `in_progress`다.
3. appointment가 `kind=level_test`, `status=scheduled`, 미래 일정이다.
4. track의 현재 `workflow_status=level_test_requested`다.

조건을 만족하는 과목이 여러 개면 `영어 · 수학 · 과학` 순서로 한 번만 표시한다. 하나도 없으면 미리보기와 발송을 막는다.

### 4.2 방문상담 예약 안내

발송 단위는 기존처럼 `appointment_id` 한 건이다. 과목은 다음 조건의 교집합으로 만든다.

1. 같은 task의 subject track이다.
2. 해당 appointment에 연결된 consultation이 `mode=visit`, `status=scheduled`다.
3. appointment가 `kind=visit_consultation`, `status=scheduled`, 미래 일정이다.
4. track의 현재 `workflow_status=consultation_requested`다.

`consultation_completed`, 대기, 등록 신청 등 다른 단계로 이동한 과목은 제외한다.

### 4.3 예약 리마인드

수동·자동 리마인드는 예약 안내와 동일한 canonical subject resolver를 사용한다.

- 레벨테스트 리마인드: 4.1의 과목 집합
- 방문상담 리마인드: 4.2의 과목 집합
- 예약 변경뿐 아니라 과목 workflow 변경도 source facts와 fingerprint를 바꾼다.
- worker가 실행될 때 다시 원본을 해석한다. 대상 과목이 없으면 provider를 호출하지 않고 재시도하지 않는 terminal `source_ineligible` 결과로 종료한다.
- appointment당 한 번이라는 기존 수동·자동 합산 잠금은 유지한다.

### 4.4 대기 안내

현재 `source_id=track_id` 계약을 유지한다. 형제 track은 어떤 경우에도 과목 명단에 포함하지 않는다.

### 4.5 입학신청서 안내

현재 `source_id=task_id`, 신청 건당 한 번 계약을 유지한다. 대상 과목과 수업은 다음을 모두 만족하는 `ops_registration_enrollments` 행에서만 만든다.

1. 같은 task의 subject track에 속한다.
2. track의 현재 `workflow_status=enrollment_requested`다.
3. enrollment가 `status=planned`다.
4. `admission_batch_id IS NULL`이다.

workflow 상태만 등록 신청이고 실제 저장된 planned enrollment가 없는 과목은 본문에 넣지 않는다. 유효한 등록 수업이 하나도 없으면 발송을 막는다.

## 5. 입학 수업 사실의 권위

브라우저의 class option이나 `enrollment_detail_rows` projection이 아니라 서버가 판정한 권위 원본을 사용한다.

정규화 일정은 `public.continuous_class_schedule_runtime_version() = 1`이고 해당 반의 `classes.schedule_storage_mode = 'normalized'`인 경우에만 권위가 있다. 둘 중 하나라도 만족하지 않으면 `class_schedule_slots`와 `class_lesson_sessions`를 고객 메시지 원본으로 사용하지 않고 legacy 권위 경로로 처리한다.

| 사실 | 우선 권위 | 호환 fallback |
| --- | --- | --- |
| 과목 | `ops_registration_subject_tracks.subject` | 없음 |
| 반 | `ops_registration_enrollments.class_id → classes` | 없음 |
| 교재 | `ops_registration_enrollments.textbook_id → textbooks` | `null`은 이미 보유/선택 안 함 |
| 첫 수업 회차 | runtime 1 + normalized일 때 `class_start_lesson_session_id → class_lesson_sessions` | 저장된 start date/session key와 legacy schedule plan |
| 반복 요일·시간 | runtime 1 + normalized일 때 `class_schedule_slots` | legacy 권위의 `classes.schedule`·`schedule_plan` |
| 선생님 | runtime 1 + normalized일 때 반복 schedule slot의 teacher | legacy 권위의 `classes.teacher` |
| 강의실 | runtime 1 + normalized일 때 반복 schedule slot의 classroom | legacy 권위의 `classes.room` |

### 5.1 runtime 1 + normalized 수업

- 첫 수업일은 등록 행이 가리키는 정확한 `class_lesson_sessions` snapshot을 사용한다.
- 첫 수업 session은 선택한 반과 일치하고 `schedule_state in ('active', 'makeup')`이며 `start_time`, `end_time`이 모두 있고 시작이 종료보다 빨라야 한다.
- 반복 일정은 `class_schedule_slots`를 요일·시작시간 순으로 정렬한다.
- 첫 수업이 보강 회차여도 반복 일정으로 덮어쓰지 않는다.

### 5.2 legacy 권위 수업

- runtime이 1이 아니거나 storage mode가 `legacy|shadow`이면 이 경로를 사용한다.
- 등록 행의 시작일·세션 키를 `classes.schedule_plan`에서 검증한다.
- 반복 요일·시간은 저장된 `classes.schedule`과 schedule plan을 사용한다.
- 선생님·강의실은 `classes.teacher`, `classes.room`을 fallback으로 사용한다.
- 정확히 일치하는 legacy schedule session에 유효한 시작·종료 시간이 있으면 그 값을 첫 수업 시간으로 사용한다.
- 일치 session에 시간이 없으면 같은 날짜·요일의 반복 slot 후보가 정확히 하나일 때만 그 시간을 유도한다.
- 예외·보강 회차이거나 반복 slot 후보가 없거나 둘 이상이면 반복 시간을 첫 수업 시간으로 추정하지 않고 발송을 차단한다.

### 5.3 권위 변경 감지

- runtime version, storage mode, 선택된 authority(`normalized|legacy`)를 private source에 포함한다.
- normalized 경로는 참조 session과 schedule slot의 material facts·revision/hash를 포함한다.
- legacy 경로는 schedule, schedule plan, teacher, room의 material facts·hash를 포함한다.
- runtime 전환 또는 storage mode 변경 뒤에는 기존 미리보기를 `source_dirty`로 거절한다.

### 5.4 서로 다른 담당자·강의실

요일별 schedule slot의 선생님이나 강의실이 다르면 한 값으로 합치지 않는다.

```text
선생님: 월 홍길동 · 수 김길동
강의실: 월 본관 301호 · 수 별관 201호
```

동일하면 사용자 승인 예시처럼 한 번만 표시한다.

### 5.5 교재 미선택

`textbook_id=null`은 오류가 아니라 `교재: 선택 안 함(이미 보유)`로 표시한다. 반의 `textbook_ids`는 선택 가능 목록일 뿐 실제 등록 교재로 추론하지 않는다.

## 6. 템플릿과 렌더링

### 6.1 입학 템플릿 변수

입학 템플릿은 다음 두 변수만 허용한다.

- `학생명`
- `등록수업안내`

`등록수업안내`는 수업 블록을 줄바꿈으로 연결한 하나의 canonical 변수다. SOLAPI가 변수값의 개행을 지원하므로 수업 수에 따라 변수 이름이나 template 구조를 늘리지 않는다.

### 6.2 입학 본문 초안

```text
[팁스영어수학학원] 입학신청서 작성 안내

안녕하세요. #{학생명} 학생의 입학 절차를 안내드립니다.

[등록 수업 정보]
#{등록수업안내}

자세한 수업 일정은 학원 홈페이지에서 확인해 주세요.

최종 원생 등록 및 교육비 납부 안내를 위해 입학신청서를 제출해 주세요.

입학신청서에는 원내 수강 규정, 원생의 건강·정서 상태 고지 의무, CCTV 활용 등 학원 생활에 필요한 중요 약관이 포함되어 있습니다. 내용을 확인하신 후 서명을 완료해 주세요.

아래 버튼에서 입학신청서를 작성할 수 있습니다.
변동사항 및 문의는 아래 문의하기 버튼을 이용해 주세요.
```

### 6.3 다른 네 템플릿의 공통 문구

- 예약 안내·리마인드의 기존 `학원으로 연락해 주세요` 문구는 `일정 변경 및 문의는 아래 문의하기 버튼을 이용해 주세요.`로 바꾼다.
- 대기 안내 마지막에 `변동사항 및 문의는 아래 문의하기 버튼을 이용해 주세요.`를 추가한다.
- 모든 버튼 정의는 server-only catalog의 고정값이며 브라우저 입력을 받지 않는다.

### 6.4 길이 제한

변수 치환이 끝난 실제 알림톡 본문이 공백·줄바꿈을 포함해 1,000자를 넘으면 미리보기를 만들지 않는다. 버튼 URL은 본문 길이에 더하지 않고 별도 버튼 계약과 URL 길이 제한으로 검증한다.

- 조용히 자르지 않는다.
- 수업 정보를 임의로 생략하지 않는다.
- 운영자에게 `등록 수업 정보가 길어 알림톡을 만들 수 없습니다. 수업 정보를 확인해 주세요.`를 표시한다.

### 6.5 template revision과 drift

본문 또는 버튼이 바뀌는 다섯 종류 모두 논리 template revision을 올린다.

- level-test booking
- visit-consultation booking
- appointment reminder
- waiting notice
- admission application

승인된 SOLAPI 템플릿은 수정하지 않고 새 템플릿을 만든다. 새 템플릿 ID·본문·변수·버튼·PF ID·승인 상태가 catalog와 정확히 일치할 때만 해당 종류를 활성화할 수 있다.

## 7. DB와 서버 변경 경계

기존 migration 파일은 수정하지 않고 새 forward-only migration을 만든다.

### 7.1 DB resolver

- 기존 public RPC의 브라우저 입력 계약은 유지한다.
- private canonical source resolver를 후속 migration에서 교체 또는 버전업한다.
- 예약 subject 집계에 workflow 조건을 추가한다.
- 예약 참여 track의 `workflow_revision`을 private source에 포함한다.
- 입학 source에 안정 정렬된 `enrollmentPlans`를 추가한다.
- enrollment, class, textbook, session, schedule slot의 material facts를 source JSON에 포함한다.
- continuous schedule runtime version, storage mode, authoritative source와 원본 hash/revision을 source JSON에 포함한다.
- `security definer`, 빈 `search_path`, 완전 수식 schema, 최소 execute grant를 유지한다.

### 7.2 server normalizer

- `enrollmentPlans`의 exact shape, UUID, enum, 날짜, 시간, 정렬을 검증한다.
- raw source 전체와 normalized canonical source 모두 fingerprint/checksum에 포함한다.
- 전화번호, 내부 provider ID, service credential은 public DTO에 넣지 않는다.

### 7.3 renderer와 미리보기

- catalog renderer 한 곳이 변수, 본문, 버튼, checksum을 만든다.
- 미리보기에는 고객에게 갈 동일 본문과 버튼 host를 표시한다.
- 별도 검증 정보에서 수업별 과목/반, 교재, 요일/시간, 선생님, 강의실, 첫 수업일을 확인할 수 있게 한다.
- `첫 수업일` 검증 행은 마지막에 배치하고 강조 스타일을 사용한다.

## 8. 실패와 안전 동작

다음 상태에서는 provider 호출을 0회로 유지한다.

- 해당 단계에 맞는 예약 참여 과목이 없음
- 입학 대상 planned enrollment가 없음
- 반명, 반복 요일·시간, 선생님, 강의실, 첫 수업일 중 필수 사실 누락
- first lesson이 선택한 수업과 일치하지 않음
- normalized session의 상태·시작/종료 시간이 유효하지 않음
- legacy 첫 수업 시간의 정확한 회차 또는 유일한 반복 시간 후보를 찾을 수 없음
- rendered body가 1,000자를 초과
- 미리보기 뒤 과목 workflow 또는 수업 사실 변경
- template 본문·변수·버튼 drift
- 템플릿 미승인, PF 불일치, credential 미설정
- 이미 같은 업무 사실의 메시지를 발송했거나 발송 결과가 불확실함

교재만 미선택인 경우에는 차단하지 않고 `선택 안 함(이미 보유)`로 표시한다.

운영자 오류 문구는 내부 코드를 노출하지 않고 다음 행동을 말한다.

- `현재 이 예약을 진행하는 과목이 없습니다. 과목별 진행상태를 확인해 주세요.`
- `수업의 요일·시간, 선생님, 강의실, 첫 수업일을 모두 저장한 뒤 다시 시도해 주세요.`
- `등록 수업 정보가 변경되었습니다. 새 미리보기를 확인해 주세요.`
- `새 알림톡 템플릿 승인 후 발송할 수 있습니다.`

## 9. 중복 방지와 변경 감지

- 예약 안내와 리마인드의 identity는 기존 appointment 단위를 유지한다.
- 같은 예약에 영어·수학이 포함돼도 메시지와 provider attempt는 한 번이다.
- 대기 안내는 track 단위를 유지한다.
- 입학신청서는 task 단위 한 번을 유지한다.
- 미리보기 당시의 workflow revision, appointment notification revision, enrollment/class/textbook/session/slot facts를 fingerprint에 포함한다.
- send 직전에 DB resolver를 다시 실행하고 preview의 fingerprint와 다르면 `source_dirty`로 거절한다.
- provider attempt marker 뒤 불확실한 결과는 자동 재전송하지 않는다.

## 10. 테스트 설계

### 10.1 과목 범위

- 영어·수학이 같은 레벨테스트 예약이며 둘 다 `level_test_requested`면 한 메시지에 `영어 · 수학` 표시
- 영어는 `level_test_requested`, 수학은 `consultation_requested`면 영어만 표시
- 연결 activity가 남아 있어도 workflow가 다른 과목은 제외
- 방문상담도 동일한 격리 보장
- 잘못된 task, 취소된 activity, 과거 appointment는 fail closed
- 미리보기 뒤 workflow 변경 시 send 거절

### 10.2 입학 수업 정보

- 단일 과목·단일 반의 exact 한국어 출력
- 복수 과목·복수 반의 안정 정렬
- 정규 정보가 먼저, `첫 수업일`이 마지막 줄에 위치
- normalized schedule/session 원본 사용
- legacy/shadow fallback 사용
- runtime 0 또는 storage mode 변경에서 legacy 권위 사용
- runtime 전환 뒤 기존 preview가 `source_dirty`로 거절됨
- normalized session의 허용 상태와 start/end 시간쌍 검증
- legacy session에 정확한 시간이 있는 경우와 유일한 반복 slot로 유도하는 경우
- legacy 예외·보강 또는 복수 반복 후보에서 발송 차단
- 요일별 선생님·강의실이 다른 경우 정확한 요일 접두어
- `textbook_id=null`의 이미 보유 문구
- 필수 사실 누락과 1,000자 초과 차단
- 수업 사실 하나만 변경해도 fingerprint 변화

### 10.3 버튼과 SOLAPI 계약

- 다섯 템플릿 모두 마지막 버튼이 `문의하기`
- ChannelTalk 모바일·PC URL exact match
- 위치·입학신청서 기존 버튼 순서 보존
- provider payload는 `disableSms=true`
- 승인 template body/variables/buttons의 exact preflight
- template drift에서 provider call 0

### 10.4 DB·보안·UI

- pgTAP 또는 isolated DB QA로 resolver 권한·RLS·source shape 검증
- public DTO에 전체 전화번호, 내부 UUID 목록, provider ID, secret이 노출되지 않음
- 모바일 미리보기의 긴 본문 스크롤과 첫 수업일 강조
- 명시적 `확인 후 발송` 전 provider call 0
- 같은 appointment/task의 중복 provider attempt 0

## 11. 배포와 SOLAPI 재승인 순서

1. TDD로 catalog/source/contract/DB migration/UI를 구현한다.
2. 관련 Node 테스트, isolated DB QA, lint, typecheck, production build를 통과한다.
3. DB migration을 적용하고 security/performance advisor를 확인한다.
4. GitHub `main`에 반영하고 Vercel Production `READY`와 정확한 commit SHA를 확인한다.
5. SOLAPI 기존 계정·기존 채널에 새 템플릿 5종을 등록하고 검수를 요청한다.
6. 승인 전에는 새 revision을 `template_drift`/비활성 상태로 유지한다.
7. 승인 후 Production 환경의 template ID를 교체하고 재배포한다.
8. read-only preflight로 PF ID, 승인 상태, 본문, 변수, 버튼을 확인한다.
9. 실제 고객 발송과 자동 리마인드 ON은 별도 명시적 승인 없이는 실행하지 않는다.

코드 배포, DB 적용, Vercel READY, SOLAPI 승인, template ID 연결, 실제 수신은 서로 다른 완료 증거로 보고한다.

## 12. 비범위

- 입학신청서를 과목별로 여러 번 발송하는 구조
- 전체 학기 수업 날짜를 알림톡에 나열하는 기능
- 고객 메시지 자동 발송 범위 확대
- ChannelTalk 상담톡 전환 버튼 사용
- 홈페이지 전용 버튼 추가
- 이미 발송된 입학신청서 뒤 수업 추가 시 두 번째 입학 알림 허용

## 13. 완료 기준

다음이 모두 충족돼야 구현 완료다.

1. 같은 단계의 실제 참여 과목만 한 알림톡에 표시된다.
2. 다른 진행상태의 형제 과목은 표시되지 않는다.
3. 입학 알림이 승인된 순서·라벨로 모든 등록 예정 수업을 표시한다.
4. `첫 수업일`이 각 수업 블록의 마지막에 분리돼 있다.
5. 모든 알림톡의 마지막 버튼이 ChannelTalk `문의하기`다.
6. 미리보기 뒤 원본 변경, 필수 정보 누락, 길이 초과, template drift에서 발송이 차단된다.
7. 기존 preview/confirm, one-time lock, no-SMS-fallback, uncertain hold 안전장치가 유지된다.
8. 새 템플릿 승인 전 코드가 provider를 호출하지 않는다.

## 14. 공식 참고 자료

- SOLAPI 알림톡 Q&A: `https://solapi.com/guides/kakao-faq`
  - 치환된 변수·줄바꿈을 포함한 본문 1,000자 제한
  - 변수값 개행 지원
  - 승인 템플릿 수정 불가와 신규 등록 필요
- SOLAPI 카카오 버튼 규격: `https://solapi.com/developers/api/kakao-button`
  - 알림톡 버튼 최대 5개
  - `WL` 모바일 링크 필수, PC 링크 선택
- Supabase Database Functions: `https://supabase.com/docs/guides/database/functions`
  - `security definer` 사용 시 빈 `search_path`와 완전 수식 relation 사용
  - public/anon execute 권한 회수 후 필요한 role에만 명시적 grant
