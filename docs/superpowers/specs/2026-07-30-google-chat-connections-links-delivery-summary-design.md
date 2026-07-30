# Google Chat 연결·전체 URL·전달 현황 정합성 설계

**작성일:** 2026-07-30
**상태:** 사용자 권장안 승인 완료
**대상 저장소:** TIPS Dashboard 관리자 앱

## 1. 목표

알림 설정의 Google Chat 연결을 실제 운영 조직과 일치시키고, 외부 메시지의 링크와 최근 전달 요약을 사용자가 믿을 수 있는 상태로 만든다.

완료 상태는 다음을 모두 만족해야 한다.

1. 알림 설정의 연결 탭에는 관리팀, 경영팀, 영어팀, 수학팀, 과학팀 Google Chat이 이 순서로 항상 표시된다.
2. 조교팀 Google Chat 연결과 조교팀 전체 Chat 수신 규칙은 추가하지 않는다.
3. Google Chat 메시지의 앱 링크는 `https://tipsedu.co.kr`부터 시작하는 클릭 가능한 전체 URL이다.
4. 전반·퇴원 링크는 업무 상태에 맞는 `flow`와 `taskId`를 포함해 해당 업무가 보이는 탭으로 바로 이동한다.
5. 최근 전달 요약은 canonical 전달 원장과 현재 실제 발송을 소유한 legacy 원장을 함께 읽되 같은 전달을 두 번 세지 않는다.
6. 기존 전달 기록을 복제하거나 재생성하지 않고 읽기 모델만 정정한다.
7. 연결 저장, 로컬 테스트, 브라우저 QA 과정에서는 실제 Google Chat 메시지를 보내지 않는다.

## 2. 확인된 현재 상태

2026-07-30 운영 상태를 읽기 전용으로 확인한 결과는 다음과 같다.

- `public.google_chat_webhook_settings`에는 관리팀과 경영팀의 기존 연결, 연결되지 않은 과학팀 행만 존재한다.
- 영어팀과 수학팀은 애플리케이션의 connection key에는 있으나 운영 DB 행이 없어 연결 화면에 나타나지 않는다.
- 조교팀은 Google Chat connection key나 팀 전체 Chat audience로 모델링되어 있지 않다.
- 전반·퇴원 legacy 발송 계획은 `/admin/withdrawal?taskId=...` 같은 상대 경로를 만든다.
- Google Chat provider는 받은 상대 경로를 별도 변환 없이 메시지 본문에 붙인다.
- 퇴원 Google Chat 전달 16건은 legacy ownership 원장에 `sent`로 기록되어 있다.
- 알림 설정 화면의 최근 전달 요약은 `dashboard_private.notification_deliveries`만 집계하므로 같은 시점에 퇴원 전달을 0건으로 표시한다.

따라서 메시지가 사라진 것이 아니라 실제 발송 원장과 설정 화면의 읽기 모델이 갈라진 것이 원인이다.

## 3. 비목표

- 조교팀 Google Chat 연결 또는 조교팀 전체 Chat 알림 규칙
- 기존 `assigned_assistant` 개인 인앱 알림의 변경
- 과거 legacy 발송을 `notification_deliveries`에 복제하는 백필
- 알림 규칙, template, runtime flag 또는 dispatch owner의 자동 활성화
- Google Chat 테스트 메시지나 운영 메시지의 실제 발송
- Web Push, SOLAPI, 인앱 알림 수신자 정책의 변경
- 전체 알림 이력 화면의 신규 상세 테이블이나 검색·필터 UI
- 외부 임의 도메인으로 이동하는 링크 지원

## 4. 검토한 접근법

### 4.1 권장안: 기존 원장을 보존하고 서버 읽기·출력 경계를 정정

- 다섯 팀의 고정 연결 카탈로그를 읽기 모델에 두고, DB 행이 없는 슬롯은 쓰기 없이 연결 가능한 상태로 보완한다.
- 앱 내부 `href`는 상대 경로로 유지한다.
- Google Chat provider 직전에만 고정된 공개 origin을 붙인다.
- 최근 전달 요약은 현재 dispatch owner를 기준으로 canonical delivery와 legacy ownership을 하나의 read model로 합친다.

장점은 기존 환경변수 fallback, 소유권·멱등성 계약을 건드리지 않고 현재 기록을 정확하게 표시할 수 있다는 점이다. 과거 행을 새 원장에 꾸며 넣지 않으므로 감사 이력도 정직하게 유지된다.

### 4.2 대안: legacy 발송 16건을 canonical delivery로 백필

하나의 테이블만 조회할 수 있지만, 당시 존재하지 않았던 delivery 행을 사후 생성해야 한다. 원래의 claim, provider 결과, template snapshot을 완전하게 복원하기 어렵고 canonical/legacy 소유권이 겹칠 위험이 있다. 채택하지 않는다.

### 4.3 대안: 퇴원 화면 또는 API에서만 legacy 건수를 별도 합산

변경량은 작지만 workflow별 특수 처리가 늘고 다른 legacy 발송에도 같은 누락이 반복된다. 비공개 원장 조회 로직이 UI 경계로 새어 나오므로 채택하지 않는다.

## 5. 연결 카탈로그 설계

Google Chat 연결은 다음 다섯 개의 고정 슬롯이다.

| 정렬 | DB channel | connection key | UI 표시명 |
| ---: | --- | --- | --- |
| 1 | `admin` | `google_chat.management` | 관리팀 Google Chat |
| 2 | `executive` | `google_chat.executive` | 경영팀 Google Chat |
| 3 | `english` | `google_chat.english` | 영어팀 Google Chat |
| 4 | `math` | `google_chat.math` | 수학팀 Google Chat |
| 5 | `science` | `google_chat.science` | 과학팀 Google Chat |

`google_chat_webhook_settings`는 계속 실제로 저장된 연결만 보관한다. 누락된 영어팀·수학팀 행을 `disconnected`로 미리 넣는 seed는 만들지 않는다. 현재 legacy resolver는 DB 행이 없을 때만 서버 환경변수 webhook으로 fallback하고, `disconnected` 행이 생기면 fallback을 차단하기 때문이다.

control-plane snapshot과 연결 전용 조회 API는 위 고정 카탈로그를 실제 DB 행에 left join한다. 실제 행이 있으면 그 행을 권위 있는 상태로 사용하고, 행이 없으면 secret가 없는 가상 `disconnected`, revision `0` 슬롯을 반환한다. revision `0`은 읽기 모델에만 존재하며 DB에 저장하지 않는다. control-plane 최초 조회, 저장 성공 응답, 충돌 응답, 연결 변경 후 재조회가 모두 같은 카탈로그와 순서를 사용해야 한다.

연결 교체 RPC의 기존 absent-row 계약을 유지한다. 가상 슬롯에서 `expected_revision = 0`으로 새 URL을 저장하면 `encrypted_active`, revision `1` 실제 행이 생성된다. 연결되지 않은 가상 슬롯은 검증·연결 해제 버튼이 비활성화되므로 absent-row 해제 RPC를 새로 만들지 않는다.

DB 행이 없지만 해당 channel의 legacy 환경변수에는 유효한 webhook이 남아 있는 상태를 `연결 안 됨`으로 오표시해서는 안 된다. 운영 반영 전 server-only preflight에서 값 자체를 출력하지 않고 이 충돌 여부만 검사한다. 충돌이 있으면 배포를 중단하고 별도 운영 승인 아래 기존 URL을 `encrypted_active` 행으로 가져오거나 해당 legacy 환경변수를 제거한 뒤 다시 확인한다. 자동 import, 환경변수 변경, secret 출력, provider 호출은 하지 않는다.

TypeScript connection key 목록, 서버 channel mapper, snapshot 정렬, UI label도 같은 순서를 사용한다. `assistant`, `google_chat.assistant`, 조교팀 표시명은 어느 경계에도 추가하지 않는다.

연결 행의 존재와 실제 발송 활성화는 분리한다. 새 행이 생겨도 rule의 `enabled`, workflow dispatch flag, shadow flag, cutover owner는 바뀌지 않는다.

연결 교체는 URL 저장만 수행하며 provider를 호출하지 않는다. 기존의 `테스트 메시지 보내기`는 사용자가 명시적으로 확인한 별도 동작으로 유지하지만 이 작업의 자동 검증에서는 실행하지 않는다.

## 6. 딥링크와 전체 URL 설계

### 6.1 내부 링크 계약

이벤트, delivery, adapter가 보관하는 `href`는 계속 앱 내부 상대 경로다.

- 반드시 `/admin/`으로 시작한다.
- `//`, 다른 scheme, 외부 origin은 허용하지 않는다.
- DB payload나 브라우저가 공개 origin을 결정하지 않는다.
- 기존 `notification_deliveries.href`의 과거 상대 경로는 수정하지 않는다.

상대 경로 유지로 worker의 workflow별 path 검증과 내부 navigation 계약을 보존한다.

### 6.2 전반·퇴원 flow

전반과 퇴원은 저장된 업무 상태를 기준으로 다음 flow를 사용한다.

| 업무 상태 | flow |
| --- | --- |
| `requested` | `applicant` |
| `confirmed`, `in_progress`, `on_hold`, `review_requested` | `operations` |
| `done`, `canceled` | `closed` |

링크 형식은 다음으로 고정한다.

```text
/admin/withdrawal?flow=operations&taskId=<uuid>
/admin/transfer?flow=operations&taskId=<uuid>
```

legacy SQL 발송 계획과 canonical immediate adapter가 같은 상태 매핑을 사용해야 한다. query parameter는 `URLSearchParams`에 해당하는 안전한 인코딩으로 만들며 표시 예시처럼 `flow` 다음에 `taskId`를 둔다.

알 수 없는 상태를 임의로 `operations`에 넣지 않는다. 지원 상태가 추가되었는데 매핑이 갱신되지 않았다면 테스트와 adapter 검증에서 실패시켜, 목록에 보이지 않는 잘못된 링크를 발송하지 않는다.

일반 할 일, 영어 단어 재시험, 등록, 휴보강, 전자결재는 현재의 검증된 내부 경로와 query parameter를 그대로 유지한다.

### 6.3 Google Chat 출력 경계

Google Chat provider는 검증을 통과한 상대 `href`만 다음 고정 origin에 결합한다.

```text
https://tipsedu.co.kr
```

예시는 다음과 같다.

```text
https://tipsedu.co.kr/admin/withdrawal?flow=operations&taskId=<uuid>
```

이 변환은 legacy ops-task, legacy makeup, 등록 상담, canonical worker 등 같은 Google Chat provider를 사용하는 모든 경로에 일관되게 적용한다. 메시지 제목·본문·URL 결합은 현재처럼 줄바꿈으로 유지한다.

이미 절대 URL이거나 외부 origin인 입력은 허용하지 않는다. URL 변환이 실패하면 상대 경로를 그대로 발송하지 않고 안전한 provider 실패로 종료한다.

## 7. 최근 전달 요약 read model

화면 DTO와 네 개의 기존 요약 항목은 유지한다.

- 대기
- 완료
- 실패
- 결과 확인 필요

DB snapshot 함수 안에서 다음 두 원장을 합친다.

1. canonical: `notification_deliveries`와 `notification_events`
2. legacy: `notification_dispatch_ownership_claims` 중 `owner_kind = 'legacy'`

legacy 상태는 다음과 같이 화면 상태로 투영한다.

| legacy 상태 | 화면 집계 |
| --- | --- |
| `state = 'reserved'` | 대기 |
| `state = 'dispatch_started'`이고 terminal outcome 없음 | 결과 확인 필요 |
| `terminal_outcome = 'sent'` | 완료 |
| `terminal_outcome = 'failed'` | 실패 |
| `terminal_outcome = 'delivery_unknown'` | 결과 확인 필요 |
| `state = 'closed'`인데 terminal outcome 없음 | 결과 확인 필요 |

두 원장을 단순히 `union all`하지 않는다. 논리 전달 identity는 `workflow_key`, `occurrence_key`, `rule_id`, `channel_key`, `target_key`, `target_generation`이다. 같은 identity의 ownership claim이 `legacy`이면 canonical delivery는 shadow/skipped 행일 수 있으므로 canonical 쪽을 제외하고 legacy claim의 상태를 대표 증거로 사용한다. owner가 `canonical`이거나 legacy claim이 없을 때만 canonical delivery를 사용한다. `owner_generation`은 같은 논리 전달의 재시도 세대이므로 중복 제거 identity에 넣지 않는다.

이 owner-aware projection으로 shadow와 cutover 과정에서 양쪽 행이 함께 존재해도 화면 건수는 한 번만 증가하고, `legacy_deduped` canonical 행 때문에 실제 legacy 성공이 사라지지 않는다.

`latest_delivery_at`은 projection에 포함된 canonical delivery 또는 legacy claim의 `updated_at` 중 가장 최근 시각이다. 이 변경은 조회 결과만 바꾸며 legacy claim, canonical delivery, audit log를 수정하거나 새로 만들지 않는다.

## 8. 데이터 흐름

### 8.1 연결 조회

1. 고정 카탈로그가 다섯 개 connection slot을 정의한다.
2. snapshot이 실제 DB 행을 left join하고 누락 슬롯을 revision `0`의 가상 `disconnected`로 채운다.
3. 서버 DTO가 secret를 제거하고 허용된 다섯 connection key만 통과시킨다.
4. UI가 고정 순서로 다섯 카드를 렌더링한다.

### 8.2 Google Chat 발송

1. 업무 변경 transaction이 notification event와 상대 deep link를 만든다.
2. legacy route 또는 canonical worker가 서버에서 connection과 delivery ownership을 확인한다.
3. Google Chat provider가 상대 deep link를 다시 검증한다.
4. provider가 `https://tipsedu.co.kr`과 결합한 전체 URL을 메시지 payload에 넣는다.
5. 기존 상태기계가 provider 결과를 `sent`, `failed`, `delivery_unknown` 등으로 기록한다.

### 8.3 최근 전달 조회

1. 화면이 workflow별 control-plane snapshot을 요청한다.
2. snapshot이 현재 owner가 legacy인 identity는 legacy claim으로, 나머지는 canonical delivery로 투영한다.
3. 서버는 집계 숫자와 마지막 전달 시각만 반환한다.
4. 브라우저는 private 원장, provider reference, secret, 전체 메시지 본문을 받지 않는다.

## 9. 오류 처리와 보안

- 누락 슬롯 표시는 DB 쓰기를 일으키지 않으며 기존 행과 환경변수 fallback을 덮어쓰지 않는다.
- 운영 preflight에서 missing-row/legacy-env 충돌이 발견되면 값을 노출하지 않고 배포를 차단한다.
- webhook 원문과 암호문은 현재처럼 public API와 브라우저 응답에서 제거한다.
- 공개 origin은 클라이언트 입력, event payload, DB template로 바꿀 수 없다.
- 상대 링크 검증 실패 시 외부 요청을 시작하지 않는다.
- legacy `dispatch_started`를 성공으로 추정하지 않고 `결과 확인 필요`로 표시한다.
- 현재 owner가 legacy이면 legacy claim, 그 밖에는 canonical delivery를 화면의 대표 증거로 사용한다.
- summary 조회 실패를 0건 성공으로 위장하지 않고 기존 control-plane 오류 경계로 전달한다.
- migration은 runtime flag, rule enabled 상태, owner generation을 변경하지 않는다.

## 10. 테스트 전략

모든 동작 변경은 실패 테스트를 먼저 확인한 뒤 최소 구현으로 통과시킨다.

### 10.1 연결 계약

- connection key가 정확히 다섯 개이고 조교팀 key가 없는지 확인한다.
- 순서가 관리팀, 경영팀, 영어팀, 수학팀, 과학팀인지 확인한다.
- 누락된 영어팀·수학팀이 DB write 없이 revision `0`의 연결 가능한 카드로 나타나는지 확인한다.
- 가상 슬롯의 연결 교체가 expected revision `0`으로 실제 encrypted row를 생성하는지 확인한다.
- 기존 연결 행, secret, revision, 검증 상태를 보존하는지 확인한다.
- DB 행이 없는 legacy 환경변수 연결을 `연결 안 됨`으로 오표시하지 않고 운영 preflight가 배포를 차단하는지 확인한다.
- 다섯 카드가 연결 여부와 무관하게 표시되는지 확인한다.

### 10.2 링크 계약

- 열린 퇴원 업무가 `/admin/withdrawal?flow=operations&taskId=<uuid>`를 만드는지 확인한다.
- 신청·완료·취소 상태가 각각 올바른 flow를 만드는지 확인한다.
- canonical adapter와 legacy SQL plan이 같은 flow 규칙을 사용하는지 확인한다.
- Google Chat provider payload가 `https://tipsedu.co.kr/admin/...` 전체 URL을 포함하는지 확인한다.
- 외부 URL, protocol-relative URL, 잘못된 `/admin/` 경로를 provider가 거절하는지 확인한다.
- URL 변경 테스트에서는 fetch double만 사용하고 실제 webhook을 호출하지 않는다.

### 10.3 전달 요약 계약

- canonical delivery만 있을 때 기존 집계가 유지되는지 확인한다.
- legacy `sent` 16건만 있을 때 완료 16건으로 보이는지 확인한다.
- legacy-owned identity에 canonical `skipped/legacy_deduped` 행과 legacy `sent` claim이 함께 있으면 완료 1건으로 집계되는지 확인한다.
- canonical-owned identity는 canonical 상태만 한 번 집계되는지 확인한다.
- `dispatch_started`가 결과 확인 필요로 투영되는지 확인한다.
- workflow 경계 밖의 전달이 섞이지 않는지 확인한다.
- 조회가 delivery나 claim 행을 수정하지 않는지 확인한다.

### 10.4 검증 범위

- notification control-plane model/API/UI focused tests
- Google Chat provider와 worker focused tests
- transfer/withdrawal adapter 및 legacy dispatch focused tests
- migration structure test와 notification runtime pgTAP
- TypeScript
- ESLint
- Next.js Webpack production build
- `/admin/settings/notifications`의 퇴원 최근 전달 및 연결 탭 브라우저 QA

브라우저 QA에서는 연결 교체, 테스트 메시지 발송, 연결 해제를 실행하지 않는다.

## 11. 릴리스 경계

설계 문서, 구현 코드, 로컬 테스트, DB migration 파일, 운영 DB 적용, Git push, Vercel 배포, 실제 provider 상태는 각각 별도의 완료 증거다.

이번 구현 단위는 다음에서 멈춘다.

1. 실패 테스트 확인
2. 최소 구현
3. focused test, lint, Webpack build
4. diff 검토
5. 로컬 commit

운영 DB migration 적용, `main` push, Vercel production 배포, 실제 Google Chat 테스트 메시지 발송은 이 구현 완료만으로 자동 승인되지 않는다. 특히 provider 호출과 runtime flag 활성화는 별도 승인 없이는 수행하지 않는다.

production migration·배포 전에는 DB 행이 없는 channel과 legacy 환경변수 fallback의 충돌 여부를 server-only로 확인한다. 충돌이 하나라도 있으면 secret를 출력하지 않은 채 release gate를 실패시키고, 사용자 승인 없이 import나 환경변수 변경을 수행하지 않는다.

## 12. 인수 기준

- 연결 탭에 다섯 팀이 정확한 순서와 명칭으로 표시된다.
- 조교팀 연결이나 조교팀 Chat 규칙이 존재하지 않는다.
- fallback 충돌이 없는 DB 미등록 영어팀·수학팀도 기존 fallback을 끊는 seed 없이 연결 가능한 카드로 표시된다.
- DB 미등록 channel에 legacy 환경변수 연결이 남아 있으면 운영 배포가 차단된다.
- 퇴원 처리 중 업무 링크가 `https://tipsedu.co.kr/admin/withdrawal?flow=operations&taskId=<uuid>` 형식으로 만들어진다.
- 다른 Google Chat 업무 링크도 `https://tipsedu.co.kr`부터 시작한다.
- 퇴원 legacy `sent` 기록이 최근 전달 완료 건수와 마지막 전달 시각에 반영된다.
- legacy-owned 전달은 legacy 결과가 보존되고 canonical/legacy 증거가 함께 있어도 두 번 집계되지 않는다.
- 기존 webhook secret, 전달 행, claim, audit log, runtime flag, rule enabled 상태가 보존된다.
- 자동 테스트와 QA 중 외부 provider 호출이 0건이다.
