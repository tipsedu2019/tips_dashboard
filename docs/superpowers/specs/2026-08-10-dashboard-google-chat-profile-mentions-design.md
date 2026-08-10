# 대시보드 공용 Google Chat 담당자 멘션 및 청강 우선 적용 설계

**작성일:** 2026-08-10

**상태:** 사용자 설계 승인 완료 · 구현 계획 작성 전

**대상 브랜치:** `codex/registration-observation-workflow`

**관련 설계·계획:**

- `docs/superpowers/specs/2026-08-09-registration-observation-workflow-design.md`
- `docs/superpowers/specs/2026-07-30-google-chat-connections-links-delivery-summary-design.md`
- `docs/superpowers/plans/2026-08-09-registration-observation-workflow.md`
- `docs/superpowers/plans/2026-08-09-registration-observation-feedback-enrollment.md`
- `docs/superpowers/plans/2026-08-09-registration-observation-google-chat.md`
- `docs/superpowers/plans/2026-08-09-registration-observation-solapi.md`

## 1. 목표

대시보드 계정과 Google Workspace 사용자의 안정적인 Google Chat 사용자 ID를 연결하고, 행동이 필요한 Google Chat 알림에서 실제 담당자만 멘션한다. 이 기반은 청강에 먼저 적용하고, 청강 전체 흐름을 완료한 뒤 할 일·등록·전반·퇴원·휴보강·전자결재 등으로 순차 확대한다.

목표는 다음과 같다.

1. `대시보드 > 환경 설정 > 선생님 설정`에서 계정 이메일을 기준으로 Google Chat 사용자 ID를 조회·검증하고, 필요하면 ID를 직접 입력할 수 있다.
2. 행동이 필요한 Google Chat 규칙은 멘션을 기본 활성화하되, 규칙별로 켜고 끌 수 있다.
3. 과목방에서는 현재 담당 선생님을, 관리팀방에서는 현재 담당 원장선생님을 멘션한다.
4. 담당자가 바뀌었다는 사실을 알리는 이벤트는 이전 담당자와 새 담당자를 모두 멘션한다.
5. ID가 없거나 검증되지 않은 경우에도 본래 업무와 Google Chat 메시지는 정상 처리하고, 멘션만 생략한다.
6. 멘션·Google Chat·SOLAPI 실패가 청강 예약, 출결, 피드백, 원장 결정, 등록 신청 저장을 롤백하지 않는다.
7. 코드, DB 적용, 배포, provider 활성화, 실제 수신을 서로 다른 완료 증거로 관리한다.

## 2. 범위와 순서

### 2.1 이번 통합 작업에 포함

1. 남은 청강 교사 피드백·등록 연결을 먼저 완료한다.
   - 참석·노쇼
   - 담당 교사 적합·부적합 피드백과 사유
   - 원장 최종 결정
   - 등록 신청 시 `청강일 = 첫 수업일` 기본 제안과 원장의 최종 날짜 선택
   - 달력, 목록, 상세 딥링크
2. 프로필 기반 Google Chat 사용자 ID 원장과 선생님 설정 UI를 구현한다.
3. 공용 멘션 대상 해석기와 Google Chat provider 출력 경계를 구현한다.
4. 청강 알림에 우선 적용한다.
   - 과목방: 담당 선생님
   - 관리팀방: 담당 원장선생님
   - 청강 3시간 전 알림
   - 청강 종료 30분 후 피드백 요청
   - 피드백 제출 후 원장 판단 요청
   - 담당자 변경 시 이전·신규 담당자
5. 청강 SOLAPI 예약 안내와 자동 리마인드를 기존 승인 설계대로 완료한다.
6. 로컬 provider-zero부터 실제 방·실제 고객 수신까지 단계별 증거를 남긴다.

### 2.2 후속 확대 범위

공용 기반이 청강에서 실제 검증된 뒤 다음 순서로 하나씩 연결한다.

1. 일반 할 일
2. 일반 등록
3. 전반·퇴원
4. 휴보강
5. 전자결재

각 후속 업무는 기존 adapter가 제공하는 담당 프로필을 사용하되, 대상 역할·방·변경 이벤트를 별도 계약과 테스트로 닫는다. 공용 기반을 만든다는 이유로 이 업무들의 현재 라우팅이나 활성화를 한 번에 변경하지 않는다.

### 2.3 비범위

- Google Chat 전체 알림의 일괄 활성화
- 임의 사용자·임의 그룹·`@all` 멘션
- 메시지 템플릿에 사용자가 raw `<users/...>`를 입력하는 기능
- Google Chat 안에서 청강 피드백이나 원장 결정을 입력하는 기능
- 기존 incoming webhook을 대체하는 대규모 Chat 앱·봇 플랫폼 도입
- 다른 알림 플랫폼으로 기존 notification control plane 교체
- 청강 완료 전 전 업무의 멘션 동시 전환

## 3. 검토한 접근법

### 3.1 공식 Google 부품 + 기존 TIPS 기반 + 얇은 도메인 계층 — 채택

- Google 인증과 Directory API 호출은 Google 공식 Node.js 클라이언트를 사용한다.
- 메시지 형식은 Google 공식 문서와 Google Workspace 샘플을 기준으로 한다.
- 전송, 재시도, 멱등성, 감사 이력, provider-zero는 기존 TIPS notification control plane을 유지한다.
- TIPS 고유의 프로필 연결, 담당자 선정, 규칙 토글, 재검증만 직접 구현한다.

장점은 인증·API 처리의 바퀴를 다시 만들지 않으면서 기존 운영 안전장치를 보존하는 것이다. 새 의존성은 Directory 조회에 필요한 최소 공식 패키지로 제한한다.

### 3.2 외부 완성형 알림·Chat 봇 프레임워크 도입 — 미채택

초기 데모는 빠를 수 있지만 현재 webhook 연결, workflow adapter, delivery 원장, provider-zero, 배포 gate를 중복하거나 우회할 가능성이 높다. 청강 완료를 늦추고 운영 경계를 두 개로 나누므로 채택하지 않는다.

### 3.3 Google 인증·Directory REST를 모두 직접 구현 — 미채택

의존성은 줄지만 토큰 갱신, 오류 분류, 보안 업데이트를 직접 소유해야 한다. 반면 멘션 문자열 생성은 단순하므로 별도 라이브러리를 추가하지 않고 TIPS에서 직접 구현한다.

## 4. 외부 부품 채택 기준

외부 코드나 패키지는 다음 조건을 모두 확인한 뒤 사용한다.

- Google이 공식 지원하거나 Google Workspace 문서가 직접 연결한 소스
- 현재 Node.js 지원 범위와 호환
- 라이선스가 명확하고 저장소 사용과 배포를 허용
- 인증정보를 클라이언트나 로그에 노출하지 않음
- 현재 TIPS provider-zero·멱등성·감사 원장을 우회하지 않음
- 필요한 API만 포함하는 최소 의존성
- 테스트와 보안 업데이트 이력이 확인됨

Google Workspace Chat 샘플 저장소는 구현 패턴을 확인하는 참고 자료로만 사용한다. 샘플 전체를 복사하거나 운영 의존성으로 삼지 않는다.

## 5. 프로필 기반 Google Chat 사용자 원장

### 5.1 소유 단위

Google Chat 사용자는 `teacher_catalog`가 아니라 `profiles.id`에 연결한다.

- Google Chat 계정은 대시보드 로그인 계정과 같은 사람을 나타낸다.
- 한 프로필은 최대 하나의 현재 Google Chat 사용자 ID를 가진다.
- 교사, 원장, 관리팀 등 역할이 바뀌어도 프로필 연결은 유지된다.
- 과목·팀 카탈로그가 여러 개인 사용자의 ID를 중복 저장하지 않는다.

### 5.2 저장 사실

새 원장은 최소한 다음 사실을 가진다.

- `profile_id` — 프로필 기준 unique/primary identity
- `account_email_snapshot` — 검증에 사용한 정규화 이메일
- `chat_user_id` — Google Directory의 안정적인 사용자 ID
- `source` — `directory | manual`
- `verification_status` — `verified | unverified | not_found`
- `verified_at`
- `last_sync_status` — `ok | not_found | email_mismatch | provider_error`
- `last_sync_at`
- `identity_revision`
- `updated_by`, `created_at`, `updated_at`

저장값은 숫자형 Directory 사용자 ID로 정규화하고, 메시지 출력 시에만 `users/{id}` resource name을 만든다. 이메일은 Chat 멘션 식별자로 직접 저장하거나 발송 본문에 삽입하지 않는다.

### 5.3 검증 규칙

- 자동 조회는 프로필의 현재 대시보드 계정 이메일을 `users.get`의 key로 사용한다.
- 성공 응답의 사용자 ID와 primary/alias 이메일이 대상 프로필과 일치할 때만 `verified`다.
- 수동 ID 입력도 서버가 해당 ID를 Directory에서 다시 조회하고 프로필 이메일 일치를 확인해야 `verified`가 된다.
- 응답이 `not_found`이거나 이메일이 불일치하면 현재 멘션 eligibility를 즉시 제거하고 `not_found | unverified`로 남긴다.
- 프로필 이메일이 그대로인 상태에서 일시적인 Directory 권한·연결 오류가 발생하면 이미 검증된 ID는 유지하되 `last_sync_status = provider_error` 경고를 남긴다. 이전 verified ID가 없으면 `unverified`로 남긴다.
- 계정 이메일이 바뀌면 기존 검증을 자동으로 유효하다고 간주하지 않는다. 설정 화면에서 불일치 경고를 보이고 재검증한다.
- 전송에는 `verified`이며 현재 활성 프로필인 ID만 사용한다.

## 6. 선생님 설정 UX와 권한

`대시보드 > 환경 설정 > 선생님 설정`의 각 프로필 행에 다음을 제공한다.

- 대시보드 계정 이메일
- Google Chat 사용자 ID
- `자동 조회` 동작
- 수동 ID 입력과 `확인` 동작
- `확인됨 | 미설정 | 재확인 필요 | 조회 실패` 상태
- 마지막 검증 시각
- 이메일 불일치 또는 누락 경고

대시보드 역할이 `admin | staff`인 관리자와 관리팀만 조회·동기화·수정할 수 있다. 브라우저가 table을 직접 수정하지 않고 actor, 역할, expected revision을 검증하는 canonical RPC를 사용한다. 일반 선생님과 다른 인증 사용자는 원장, 변경 이력, 동기화 오류를 직접 읽을 수 없다.

Directory credential은 서버에서만 사용한다. API scope는 사용자 읽기 전용으로 제한하고, 필요하면 Google Workspace 관리자가 domain-wide delegation을 명시적으로 승인한다. credential 원문, access token, webhook URL은 DB 응답·브라우저·로그·감사 payload에 남기지 않는다.

## 7. 알림 규칙과 대상 계약

### 7.1 규칙별 토글

각 Google Chat 규칙에는 `mention_enabled`가 있다.

- 사람이 후속 행동을 해야 하는 규칙은 기본값 `true`다.
- 단순 정보성 규칙은 기본값 `false`다.
- 운영자는 Google Chat 알림 규칙별로 값을 켜고 끌 수 있다.
- 규칙 OFF는 멘션만 끄며, 그 규칙의 기존 메시지 활성화 여부를 암묵적으로 바꾸지 않는다.
- 전체 멘션 강제 ON, 전역 `@all`, 사용자 자유 입력 대상은 제공하지 않는다.

멘션 대상 역할은 편집 가능한 문자열이 아니라 workflow adapter의 닫힌 계약이다. 규칙 설정은 멘션 여부만 소유하고, 누구를 멘션할지는 이벤트의 검증된 담당 프로필 사실이 소유한다.

### 7.2 공용 대상 모델

adapter는 raw Chat ID가 아니라 다음 의미를 출력한다.

- 대상 프로필 ID 목록
- 대상 역할: 담당 교사, 담당 원장, primary/secondary assignee 등
- 선택 이유가 되는 source revision
- 변경 이벤트라면 이전 담당 프로필 ID와 신규 담당 프로필 ID

공용 resolver는 프로필 ID를 active·verified identity에 연결하고, 같은 사람이 여러 역할에 있으면 한 번만 남긴다. 결과 순서는 업무가 제공한 역할 우선순위와 프로필 ID의 안정 정렬로 고정한다.

### 7.3 청강 라우팅

| 청강 이벤트 | Google Chat 방 | 멘션 대상 |
| --- | --- | --- |
| 예약·변경·3시간 전 준비 | 해당 과목방 | 현재 담당 선생님 전원 |
| 종료 30분 후 피드백 요청 | 해당 과목방 | 현재 담당 선생님 전원 |
| 교사 피드백 제출·원장 판단 필요 | 관리팀방 `google_chat.management` | 현재 담당 원장선생님 전원 |
| 담당 교사 변경 알림 | 해당 과목방 | 이전 담당 교사 + 신규 담당 교사 |
| 담당 원장 변경 알림 | 관리팀방 | 이전 담당 원장 + 신규 담당 원장 |

현재 청강 Google Chat 계획의 `feedback_submitted → google_chat.executive` 계약은 폐기한다. 구현 계획은 이를 `google_chat.management`와 담당 원장 멘션으로 교체하고, 경영진방이 호출되지 않는 negative test를 포함해야 한다.

## 8. 메시지 출력 계약

기존 Google Chat provider와 `cardsV2` 상세 카드는 유지한다. 멘션은 메시지 top-level `text`에 서버가 생성한다.

```text
<users/123456789> 청강 피드백을 확인해 주세요.
```

Google Chat이 이를 사용자 표시명 멘션으로 렌더한다. 멘션 줄도 링크 없이 학생, 과목, 이벤트, 상태, 일정·반 정보를 이해할 수 있는 자연스러운 한국어 한 줄을 포함한다. 상세 카드는 현재 검증된 제목·본문·버튼 계약을 유지한다.

- editable title/body에는 raw `<users/...>`, `@all`, 임의 URL을 허용하지 않는다.
- provider가 검증된 canonical 사용자 ID만 markup으로 만든다.
- 검증된 대상이 0명이면 raw `@`나 내부 오류 문구 없이 같은 안내 문장만 보낸다.
- 멘션 여부가 카드의 개인정보 노출 범위를 넓히지 않는다.
- 피드백 결과·사유, 전화번호, 학교, 내부 UUID 등 기존 비공개 사실은 Chat 본문에 새로 넣지 않는다.

## 9. 데이터 흐름

### 9.1 계정 동기화

1. 관리자 또는 관리팀이 선생님 설정을 연다.
2. 서버가 현재 프로필 이메일과 identity revision을 반환한다.
3. 사용자가 자동 조회 또는 수동 ID 확인을 요청한다.
4. 서버가 actor·role·expected revision을 확인한다.
5. 공식 Google auth/client가 Directory 읽기 전용 API를 호출한다.
6. ID와 이메일이 일치하면 새 revision의 verified identity를 저장하고 audit을 남긴다.
7. 불일치·미존재·provider 오류는 실패 상태와 사용자용 경고만 저장하며 기존 업무 상태를 변경하지 않는다.

### 9.2 일반 알림

1. 청강 등 핵심 업무 mutation이 도메인 사실과 이벤트를 먼저 원자 저장한다.
2. notification materializer가 규칙과 의미적 멘션 대상 프로필을 기록한다.
3. worker가 delivery를 claim한다.
4. provider marker 직전 final-prepare가 source revision, 현재 담당자, active profile, identity revision, `mention_enabled`를 같은 잠금 경계에서 재검증한다.
5. 검증된 ID를 중복 제거하고 delivery generation의 mention snapshot을 만든다.
6. provider가 top-level text와 기존 cardsV2를 webhook으로 보낸다.
7. 결과와 누락된 대상 profile ID/사유 code를 secret-free audit에 기록한다.

Directory API는 4~6번의 hot send path에서 호출하지 않는다. Google Directory 장애가 실제 알림 지연이나 provider retry 폭증으로 이어지지 않게 한다.

첫 provider marker 전 담당자·identity revision drift가 발견되면 stale delivery를 보내지 않고 새 source generation으로 다시 materialize한다. provider marker 뒤의 불확실한 결과는 payload를 바꾸지 않고 기존 delivery state machine으로 확인·재시도한다.

### 9.3 담당자 변경

담당자 변경 이벤트는 변경 전·후 프로필을 immutable source fact로 보관한다. final-prepare는 두 목록의 active·verified identity를 합치고 중복 제거한다. 변경 뒤 일반 업무 알림은 현재 담당자만 사용하고, 이전 담당자를 계속 멘션하지 않는다.

## 10. 실패 처리와 운영 경고

| 상황 | 업무 저장 | Google Chat 메시지 | 멘션 | 운영 증거 |
| --- | --- | --- | --- | --- |
| ID 미설정 | 성공 | 정상 발송 | 생략 | `identity_missing` + 설정 경고 |
| ID 미검증/이메일 불일치 | 성공 | 정상 발송 | 생략 | `identity_unverified` + 설정 경고 |
| 일부 대상만 검증 | 성공 | 정상 발송 | 검증된 대상만 | 누락 대상 audit |
| 규칙 멘션 OFF | 성공 | 기존 규칙대로 | 생략 | rule snapshot |
| webhook 실패 | 성공 | 기존 retry 상태 | snapshot 유지 | provider attempt |
| 담당자 source drift | 성공 | stale generation 중단 | 새 generation에서 결정 | source-dirty audit |
| Directory 일시 오류·이메일 동일 | 성공 | 기존 verified ID가 있으면 정상 발송 | 기존 검증 유지 | `provider_error` 경고·sync audit |
| Directory 일시 오류·기존 검증 없음 | 성공 | 정상 발송 | 생략 | `unverified` 경고·sync audit |
| Directory 미존재·이메일 불일치 | 성공 | 정상 발송 | 생략 | eligibility 제거·sync audit |

어떤 실패도 `@all`, 관리팀 전체, 경영진 전체 같은 넓은 fallback으로 바꾸지 않는다. 고객 또는 팀 메시지에 `사용자 ID 누락`, `Directory 오류` 같은 내부 운영 문제를 표시하지 않는다.

## 11. 청강 작업과의 결합 순서

공용 멘션 구현이 청강의 남은 핵심 기능을 밀어내지 않도록 다음 의존 순서를 유지한다.

1. 청강 core의 승인된 계약과 구현 증거를 기준선으로 고정한다.
2. 교사 피드백·원장 결정·등록 첫 수업일·달력/딥링크를 완성한다.
3. 공용 프로필 identity/RPC/설정 UI를 구현한다.
4. Google Chat 공용 mention resolver와 provider output을 구현한다.
5. 청강 Google Chat 계획의 관리팀 라우팅과 멘션 snapshot을 보완하고 구현한다.
6. 청강 SOLAPI 계획을 구현한다.
7. 청강 전체를 통합 검증·배포·선택적 활성화한다.
8. 청강 운영 검증 뒤 후속 workflow를 하나씩 채택한다.

공용 모듈은 후속 workflow adapter를 받을 수 있도록 만들지만, 이번 초기 구현에서 후속 workflow의 규칙·recipient·runtime flag를 변경하지 않는다.

## 12. 테스트 계약

### 12.1 DB와 권한

- identity table RLS와 직접 table privilege 차단
- admin/staff canonical RPC 허용
- 일반 authenticated·비활성·삭제·정지 계정 거부
- expected revision 충돌과 immutable audit
- profile unique, normalized numeric ID, verification status 불변식
- service-role worker read RPC의 최소 ACL
- security definer의 empty search path, schema qualification, actor/role guard

### 12.2 단위 테스트

- 이메일 자동 조회 성공·미존재·불일치·provider 오류
- 수동 ID 검증
- current direct assignee 전체 선택
- 이전+신규 담당자 합집합과 중복 제거
- inactive/unverified profile 제외
- action-required default ON, informational default OFF, rule toggle OFF
- raw mention, `@all`, malformed ID, duplicate ID 거부
- 검증된 대상 0명에서 자연스러운 무멘션 문장

### 12.3 통합 테스트

- production assembly가 동일 webhook provider에 `text + cardsV2`를 전달
- Directory client는 설정 sync에서만 호출되고 worker send에서는 0회
- provider-zero production assembly에서 실제 webhook fetch 0회
- source drift, identity drift, retry, provider unknown 결과
- core 업무 commit 뒤 Chat 실패가 도메인 행을 롤백하지 않음
- 청강 과목방 teacher, 관리팀방 director, executive 방 0회
- 3시간 전·30분 후·feedback submitted·reassignment exact target
- 기존 5종 Google Chat rule과 non-observation payload 회귀 없음

### 12.4 UI와 빌드

- 선생님 설정 데스크톱·모바일: ID, 상태, 마지막 검증, 경고, 키보드 접근
- admin/staff edit와 일반 사용자 비노출
- 규칙별 멘션 토글과 저장 충돌
- 로컬 격리 Supabase clean apply와 pgTAP
- focused Node tests, ESLint, TypeScript, `next build --webpack`

## 13. 출시와 활성화

1. 모든 신규 DB 기능은 기본 비활성·runtime 0·provider-zero로 적용한다.
2. migration을 먼저 안전하게 적용하고 동일 SHA의 코드를 배포한다.
3. runtime 0에서 기존 청강·등록·알림 회귀와 provider 호출 0을 확인한다.
4. 관리자·관리팀이 실제 선생님·원장 프로필 ID를 조회·검증한다.
5. 규칙별 멘션 설정을 확인하되 Google Chat/SOLAPI 발송은 계속 OFF로 둔다.
6. 별도 운영 확인 후 `[테스트]` 메시지로 과목방 teacher mention과 관리팀방 director mention을 각각 확인한다.
7. 청강 Google Chat을 verification에서 live로 전환하고 실제 provider receipt와 방 수신을 확인한다.
8. 청강 SOLAPI는 별도 preview·확인 후 활성화하고 테스트 고객의 실제 수신을 확인한다.
9. 실패하면 runtime/rule을 OFF로 되돌리며 저장된 청강·피드백·등록 사실은 보존한다.

Preview·로컬에는 실제 Google credential, webhook secret, SOLAPI credential을 복제하지 않는다. 실제 provider activation과 테스트 발송은 구현·배포 승인만으로 자동 승인된 것으로 간주하지 않는다.

## 14. 완료 기준

다음 증거를 각각 따로 기록한다.

1. 코드·테스트·빌드 완료
2. Supabase migration 적용과 runtime 0 확인
3. GitHub `main` 반영 SHA
4. Vercel Production 동일 SHA `READY`
5. Google Chat/SOLAPI 규칙과 provider 활성화 상태
6. 실제 과목방·관리팀방 멘션 수신과 고객 메시지 수신 receipt

청강 통합 완료는 다음 기능도 함께 충족해야 한다.

- 참석·노쇼
- 교사 피드백과 원장 최종 결정
- 첫 수업일 청강일 기본 제안과 원장 직접 선택
- 달력·목록·정확한 5-key 딥링크
- 과목방 담당 교사 멘션
- 관리팀방 담당 원장 멘션
- 고객 예약 안내와 3시간 전 리마인드
- 재시도·무멘션 fallback·감사 이력

로컬 테스트나 Production `READY` 하나만으로 전체 완료라고 보고하지 않는다. 청강이 이 기준을 통과하기 전에는 전 업무 멘션 확대를 시작하지 않는다.

## 15. 공식 참고 자료

- Google Chat 사용자 식별: `https://developers.google.com/workspace/chat/identify-reference-users`
- Admin SDK Directory `users.get`: `https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/get`
- Google APIs Node.js Client: `https://github.com/googleapis/google-api-nodejs-client`
- Google Chat samples: `https://github.com/googleworkspace/google-chat-samples`
