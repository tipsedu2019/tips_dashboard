# 대시보드 내부 알림 제거와 외부 알림 운영 설계

**작성일:** 2026-08-15

**상태:** 사용자 권장안 및 추가 요구 승인 완료

**대상:** TIPS Dashboard 관리자 앱, Google Chat, SOLAPI 알림톡

## 1. 목표

대시보드 안에서 소비하는 내부 알림 UI와 그 신규 생성 경로를 제거하고, 실제 운영에 필요한 외부 알림만 남긴다.

완료 상태는 다음과 같다.

1. 상단 헤더에 알림 종, 받은함, 읽지 않은 수, 읽음 처리 UI가 없다.
2. `알림 설정`은 독립 사이드바 항목이 아니라 `환경 설정`의 하위 항목이다.
3. 알림 설정 화면에서 관리자가 변경할 수 있는 채널은 Google Chat뿐이다.
4. SOLAPI 알림톡 규칙, 문구, 템플릿, 승인 정보는 설정 화면에 표시하지 않는다.
5. 알림톡은 승인된 백엔드 고정 계약으로 계속 발송되며, 화면 변경이 발송 계약을 수정하지 않는다.
6. Google Chat과 알림톡의 안전한 전달 결과는 운영 이력에서 확인할 수 있다.
7. 기존 내부 알림 저장 구조는 즉시 삭제하지 않지만 신규 내부 알림 projection과 Web Push 발송은 중단한다.
8. 외부 알림은 준비 상태, 실제 provider 접수, 수신 확인을 분리해 검증한 뒤 가동한다.

## 2. 범위

### 제거

- `SiteHeader`의 `DashboardNotificationPopover`
- 대시보드 받은함 목록, badge, 읽음 처리, Web Push 구독 UI
- 업무별 화면에서 내부 알림 또는 모바일 알림을 설정하는 진입점
- canonical/legacy producer가 새 dashboard inbox projection 또는 Web Push delivery를 만드는 경로
- 알림 설정 화면의 dashboard/Web Push 채널 선택과 관련 설명
- 알림 설정 화면의 SOLAPI 규칙, 문구, 템플릿, 재승인 관련 편집 UI
- `/admin/settings/notifications/solapi`로 향하는 관리자 진입점

### 유지

- `/admin/settings/notifications` route
- `환경 설정` 하위의 `알림 설정` 메뉴
- Google Chat 업무 규칙, 수신 공간 연결, 담당자 mention 연결과 검증 UI
- Google Chat 및 알림톡 외부 전달의 PII 없는 최근 결과와 실패 상태
- SOLAPI provider adapter, 승인된 template ID/PF ID의 server-only 설정, 멱등성, 예약/리마인드 worker
- Google Chat provider adapter, 암호화된 webhook 연결, profile-scoped mention
- 예약·일정·상태 저장과 외부 전달을 분리하는 현재 transaction 경계

## 3. 채택한 접근

UI만 숨기고 내부 알림 producer를 계속 실행하면 불필요한 DB 쓰기와 Web Push 경로가 남는다. 반대로 기존 inbox table과 migration을 즉시 삭제하면 과거 감사 자료와 아직 참조하는 코드에 회귀 위험이 생긴다.

따라서 다음의 점진적 제거를 채택한다.

1. 사용자 표면에서 내부 받은함과 내부 채널 설정을 제거한다.
2. producer/adapter 단계에서 dashboard inbox와 Web Push 신규 생성을 차단한다.
3. 읽기·쓰기 dead code는 참조가 사라진 범위에서 제거한다.
4. 기존 DB table/RPC와 과거 행은 이번 작업에서 삭제하지 않는다.
5. 별도 후속 migration에서 참조·보존기간·감사 요구를 확인한 뒤 물리 삭제 여부를 결정한다.

## 4. 정보 구조와 UI

설정 사이드바는 다음 구조를 사용한다.

```text
설정
└─ 환경 설정
   ├─ 학교 설정
   ├─ 과목 설정
   ├─ 선생님 설정
   ├─ 강의실 설정
   ├─ 기간 설정
   ├─ 교재 설정
   └─ 알림 설정
```

`알림 설정` 페이지의 제목은 `Google Chat 알림`으로 바꾼다. 화면에는 다음 두 기능만 둔다.

- 업무별 Google Chat 사용 여부와 routing
- Google Chat 공간 연결 및 담당자 mention 연결 상태

알림톡 rule/template 편집 탭, SOLAPI 설정 링크, dashboard/Web Push channel control은 표시하지 않는다. 알림톡 발송 결과가 운영 이력에 함께 나타날 경우에도 읽기 전용 `알림톡` 전달 결과로만 표시하고 설정 링크를 제공하지 않는다.

업무별 화면에 알림 설정 shortcut이 필요한 경우 Google Chat 설정으로만 연결한다. 같은 기능을 반복하는 업무별 dialog는 제거하고 중앙 설정 페이지로 통일한다.

## 5. 외부 알림 계약

### Google Chat

- 관리자가 UI에서 enabled/routing/connection을 변경할 수 있다.
- webhook 원문은 브라우저로 반환하지 않고 server-side 암호화 저장을 유지한다.
- mention은 검증된 profile별 `users/{ID}`만 사용한다.
- 연결이나 mention이 없으면 업무 저장을 실패시키지 않고, 명시적인 전달 실패/보류 상태를 기록한다.
- broad mention과 임의 free-form mention은 허용하지 않는다.

### SOLAPI 알림톡

- template, PF ID, message contract, event mapping은 server-only 고정값이다.
- 대시보드에서 수정·미리보기·승인 요청·template 선택 기능을 제공하지 않는다.
- 내용 변경은 코드/서버 설정 변경, SOLAPI 재승인, 검증, 배포를 거치는 별도 릴리스로 처리한다.
- 현재 승인된 계약과 provider adapter는 유지하며 UI 제거를 발송 중단으로 해석하지 않는다.
- 예약 확인과 리마인드는 각각의 멱등 key를 유지한다.

## 6. 데이터 흐름

1. 사용자가 예약·일정·업무 상태를 저장한다.
2. 업무 기록은 알림 전달 성공 여부와 독립적으로 commit된다.
3. 외부 알림 대상 event만 Google Chat 또는 알림톡 delivery로 projection된다.
4. 내부 dashboard inbox와 Web Push delivery는 생성하지 않는다.
5. worker가 source, rule, connection, mention, template, dedupe 상태를 preflight한다.
6. 실제 provider 호출 직전에 attempt를 기록한다.
7. provider 접수 결과는 `accepted`, 명확한 실패는 `failed`, 접수 여부 불명은 `unknown`으로 보존한다.
8. 운영 이력은 PII와 secret 없이 채널, 업무, 시각, 결과, 안전한 참조만 보여준다.

## 7. 재가동 순서

재가동은 한 번에 모든 flag를 켜는 작업이 아니다.

1. **소스/테스트:** 내부 채널이 생성되지 않고 외부 채널 계약이 유지됨을 검증한다.
2. **DB 준비:** runtime marker, rule, cron/worker 상태, migration ledger를 읽기 전용으로 확인한다.
3. **연결 준비:** Google Chat 공간/mention과 SOLAPI server-only template 설정을 secret 노출 없이 확인한다.
4. **verification:** 검증용 source allowlist에서만 채널별 provider 접수와 수신을 확인한다.
5. **live:** 검증된 event/channel cell만 활성화하며 activation 이전 event는 catch-up하지 않는다.
6. **운영 관찰:** worker run, provider 결과, 수신 증거를 확인하고 첫 불일치에서 해당 cell을 다시 off로 내린다.

Google Chat 수신 확인이 알림톡 가동의 증거가 될 수 없고, 알림톡 예약 확인 수신이 리마인드 수신의 증거가 될 수 없다. 각 event/channel을 독립적으로 닫는다.

## 8. 오류와 안전 경계

- provider 실패는 예약·일정·상태 저장을 rollback하지 않는다.
- timeout이나 connection loss로 접수 여부가 불명확하면 자동 재발송하지 않는다.
- activation 이전 event를 live 전환 뒤 소급 발송하지 않는다.
- 설정 저장과 테스트 메시지 발송은 분리하고, 테스트 발송은 별도 확인 동작으로 유지한다.
- 전화번호, 학생명, 메시지 전문, template/PF ID, webhook, secret, raw provider body를 브라우저 DTO나 운영 로그에 넣지 않는다.
- UI에서 알림톡 rule을 숨기는 변경은 backend rule을 삭제하거나 임의 변경하지 않는다.
- 기존 내부 알림 row의 삭제는 이번 범위가 아니다.

## 9. 테스트 전략

모든 동작 변경은 실패 테스트를 먼저 확인한다.

### UI 계약

- 헤더가 dashboard notification popover를 import/render하지 않는다.
- `알림 설정`이 `환경 설정.items` 안에 있고 독립 설정 항목으로 존재하지 않는다.
- 설정 페이지가 Google Chat 설정만 렌더링한다.
- SOLAPI rule/template/preview 링크와 dashboard/Web Push control이 나타나지 않는다.
- 업무별 내부 알림 설정 shortcut/dialog가 남아 있지 않다.

### producer 계약

- 지원 workflow가 dashboard inbox와 Web Push delivery를 만들지 않는다.
- Google Chat delivery와 알림톡 delivery의 event matrix, dedupe, privacy 계약은 유지된다.
- 알림톡 고정 template 계약을 browser input으로 덮어쓸 수 없다.
- provider 실패가 원 업무 저장을 rollback하지 않는다.

### 운영 검증

- TypeScript, ESLint, focused Node tests, 전체 build를 실행한다.
- DB 변경이 있으면 isolated pgTAP과 migration parity를 실행한다.
- 배포 뒤 authenticated UI에서 헤더, 사이드바, Google Chat 설정, 외부 전달 이력을 확인한다.
- worker run, provider request/response, 실제 수신 증거를 채널·event별로 기록한다.

## 10. 완료 보고 기준

완료 보고는 다음 gate를 합치지 않는다.

- source/tests
- production migration/configuration
- GitHub `main`과 Vercel Production `READY`
- runtime/worker 실행
- Google Chat provider 접수와 실제 Chat 수신
- SOLAPI provider 접수와 실제 알림톡 수신

어느 한 gate가 완료되지 않으면 전체를 `완전 가동`으로 표현하지 않고 첫 미충족 gate와 복구 방법을 보고한다.
