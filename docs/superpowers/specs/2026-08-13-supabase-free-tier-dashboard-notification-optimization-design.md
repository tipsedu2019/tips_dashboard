# Supabase 무료 티어 장기 운영·경량 외부 알림·대시보드 조회 최적화 설계

**작성일:** 2026-08-13

**상태:** 사용자 설계 승인 완료 · 상세 구현 계획 4종 작성

**대상:** TIPS Dashboard 홈·통계·업무 목록·공개 수업 조회, 등록 예약 고객 알림톡, 방문상담·청강 Google Chat 알림, Supabase 운영 DB

## 1. 목표

1. Supabase Free/Nano에서 Disk I/O와 CPU를 반복 소모하는 polling, 전체 테이블 조회, 불필요한 기록 쓰기를 제거한다.
2. 대시보드 내부 알림과 웹푸시를 제거하고 실제 운영에 필요한 고객 알림톡과 Google Chat만 남긴다.
3. 레벨테스트·방문상담·청강 예약 완료 알림을 이벤트 발생 직후 한 번 보내고, 당일 리마인드는 오전 10시(KST)에 한 번만 보낸다.
4. 기존 홈 통계 UI를 보존하되 별도 `통계` 메뉴로 이동하여 사용자가 열 때만 조회한다.
5. 목록·상세·통계 데이터 경계를 분리해 데이터가 늘어도 화면 진입 비용이 전체 데이터 크기에 비례하지 않게 한다.
6. 예약·업무 저장은 외부 provider 실패와 독립적으로 완료되고, 채널별 실패도 서로 영향을 주지 않게 한다.
7. 코드, DB migration, 배포, runtime/cron 활성화, SOLAPI 승인, provider 요청, 실제 수신을 서로 다른 검증 단계로 관리한다.

## 2. 확인된 현재 상태

2026-08-13 읽기 전용 진단에서 다음 상태를 확인했다.

- 프로젝트는 Free/Nano이며 재시작 후 `ACTIVE_HEALTHY`로 회복했다.
- 장애 구간에는 CPU·Disk I/O가 포화됐고 SQL 연결 timeout, statement timeout, broken pipe가 함께 관찰됐다.
- 기존 `tips-notification-worker-v1`과 `tips-notification-cutover-watchdog-v1`은 각각 1분마다 실행됐으나 현재 둘 다 `active=false`다.
- DB 크기는 약 91MB다. 용량 자체보다 Nano에 비해 넓은 schema와 반복 조회가 현재의 우선 문제다.
- `public` schema에 약 95개, `dashboard_private`에 약 55개 테이블이 있고 migration 파일은 약 143개다.
- 홈·운영·학사·관리 화면 일부는 여러 테이블의 `select('*')`를 병렬 실행하고 브라우저에서 조합한다.
- 업무 화면은 많은 task ID를 한 번에 넘겨 댓글·첨부·이벤트 등 관련 테이블을 함께 읽는다.
- `dashboard_audit_logs`는 약 25.8MB로 현재 가장 큰 relation이며 과거 운영 데이터 복구에 실제 사용된 이력이 있다.
- notification worker/watchdog heartbeat, delivery, event, request ledger 등 알림 control plane이 private schema의 상당 부분을 차지한다.
- Performance Advisor는 미인덱스 외래키, per-row auth RLS 계산, 다중 permissive 정책, 중복 인덱스를 보고한다. 재시작 직후의 unused-index 통계는 삭제 근거로 사용할 수 없다.

이 수치는 당시 상태의 진단 기준이며 구현 전후에 동일한 쿼리로 다시 측정한다.

## 3. 핵심 결정

### 3.1 채택: 경량 외부 알림 구조

- 일반 예약 완료 알림은 이벤트 발생 시에만 실행한다.
- 예약 리마인드는 하루 한 번 오전 10시(KST)에만 실행한다.
- polling worker, watchdog, heartbeat를 사용하지 않는다.
- 대시보드 내부 알림, 읽음 수, 웹푸시를 제거한다.
- 고객 알림톡과 Google Chat은 독립 delivery로 취급한다.
- provider 호출은 Vercel의 server-only route가 담당한다.
- Supabase에는 예약 원천, compact 발송 상태, 최근 7일의 최소 delivery 결과만 둔다.

### 3.2 채택: 홈과 통계 분리

- 홈은 `오늘 해야 할 일`을 위한 가벼운 요약만 읽는다.
- 현재 잘 만들어진 전체 통계 UI는 삭제하지 않고 별도 `통계` 메뉴로 이동한다.
- 통계 메뉴를 열기 전에는 통계 쿼리를 실행하지 않는다.
- 통계 메뉴 안에서도 활성 탭만 지연 로딩한다.

### 3.3 기각: 기존 공통 알림 control plane의 주기만 변경

주기를 하루 한 번으로 바꿔도 queue, fanout, reconciliation, delivery, heartbeat, watchdog, 대시보드 알림 projection이 계속 남는다. 이번 요구사항에 비해 구성과 유지 비용이 크므로 새 경량 경로 검증 후 단계적으로 폐기한다.

### 3.4 기각: Postgres에서 provider로 직접 전송

`pg_net`으로 Google Chat 또는 SOLAPI를 직접 호출하면 Vercel 호출은 줄지만 메시지 생성, provider 인증, template drift, 오류 분류가 SQL과 Vault에 묶인다. 외부 발송과 개인정보 처리는 server-only TypeScript 경계에 유지한다.

## 4. 외부 알림 전달 매트릭스

| 업무 이벤트 | 고객 알림톡 | Google Chat |
| --- | --- | --- |
| 레벨테스트 예약 완료 | 고객에게 즉시 1회 | 발송하지 않음 |
| 레벨테스트 당일 오전 10시 | 고객에게 리마인드 1회 | 발송하지 않음 |
| 방문상담 예약 완료 | 고객에게 즉시 1회 | 관리팀방, 상담 책임자 멘션 1회 |
| 방문상담 당일 오전 10시 | 고객에게 리마인드 1회 | 관리팀방, 상담 책임자 멘션과 상담 준비 요청 1회 |
| 청강 예약 완료 | 고객에게 즉시 1회 | 해당 과목방, 수업 담당 선생님 멘션 1회 |
| 청강 당일 오전 10시 | 고객에게 리마인드 1회 | 해당 과목방, 수업 담당 선생님 멘션과 청강 준비 요청 1회 |

멘션 원천은 다음으로 고정한다.

- 방문상담: 저장된 상담 책임자 `director_profile_id`
- 청강: 선택한 실제 수업의 담당 선생님 profile
- 동일 profile이 중복되면 한 번만 멘션
- `@all`, 팀 전체, 관리자 전체 멘션 금지
- Google Chat identity가 없거나 검증되지 않았으면 예약은 정상 저장하고 메시지는 멘션 없이 발송한다. delivery 결과에는 `mention_unresolved`만 남긴다.

Google Chat 메시지는 링크를 열지 않아도 학생, 업무 종류, 과목, 일정, 장소 또는 수업, 담당자, 필요한 행동을 이해할 수 있어야 한다.

## 5. 예약 완료 즉시 발송 흐름

```text
정식 예약 저장 RPC 성공
  -> 권위 있는 예약/청강 원천과 revision 확정
  -> 해당 채널의 경량 delivery intent 생성
  -> transaction commit
  -> 비동기 Database Webhook이 private Vercel dispatcher 호출
  -> dispatcher가 exact intent claim
  -> canonical source를 다시 읽어 server renderer로 메시지 생성
  -> SOLAPI 또는 Google Chat 호출
  -> 채널별 finalize
```

원칙은 다음과 같다.

- provider HTTP 호출은 예약 저장 transaction 안에서 하지 않는다.
- provider 실패, timeout, 429, 5xx는 이미 저장된 예약을 rollback하지 않는다.
- 고객 알림톡과 Google Chat은 별도 intent와 상태를 가진다.
- 한 채널 실패가 성공한 다른 채널의 재전송을 유발하지 않는다.
- 브라우저는 전화번호, webhook URL, SOLAPI template ID, 렌더링 본문을 조립하거나 제출하지 않는다.
- 예약 저장의 request key, source ID, source revision, event kind, channel로 idempotency key를 만든다.
- 예약 변경 알림의 신규 정책은 이번 범위에 추가하지 않는다. 기존 예약 완료 메시지를 변경 때마다 다시 보내지 않으며, 당일 리마인드는 실행 시점의 최신 scheduled 원천만 사용한다.

## 6. 오전 10시 리마인드 흐름

### 6.1 실행 시각

- 사용자 기준: 매일 오전 10:00 Asia/Seoul
- Supabase 기본 UTC cron: `0 1 * * *`
- active cron job: 이 리마인드 job 한 개만 허용

### 6.2 단일 실행

```text
01:00 UTC cron
  -> private Vercel reminder route 1회 호출
  -> 오늘 일정 후보를 한 번의 claim RPC로 확정
  -> 레벨테스트/방문상담/청강의 채널별 미발송 intent 생성·claim
  -> provider별 발송
  -> 채널별 finalize
  -> 7일 초과 delivery/cron 상세 이력 정리
```

후보 조건은 다음을 모두 만족해야 한다.

- KST 기준 오늘 일정
- 상태가 `scheduled`
- 오전 10시 run snapshot 전에 이미 예약 완료
- 취소·완료되지 않음
- 현재 source revision과 일정 날짜의 동일 채널 리마인드가 아직 발송되지 않음

오전 10시 이후 등록한 당일 예약은 예약 완료 알림만 즉시 보내며, 당일 리마인드는 생략한다. 별도 catch-up cron이나 watchdog은 만들지 않는다.

provider가 429 또는 명확한 5xx를 반환하면 동일 Vercel invocation 안에서 짧은 bounded retry를 최대 2회 허용한다. 접수 여부가 불확실하거나 invocation 전체가 실패한 경우 자동 반복 job을 만들지 않고 최근 7일 운영 화면에서 수동 확인 대상으로 남긴다.

## 7. 최소 데이터 모델과 보존

### 7.1 compact notification state

상세 delivery 기록을 7일 후 삭제해도 중복 발송을 막을 수 있도록 source별 compact 상태를 유지한다.

필수 식별 정보:

- source kind와 source ID
- source revision
- event kind: `booking_confirmed` 또는 `same_day_reminder`
- channel: `customer_alimtalk` 또는 `google_chat`
- 마지막으로 처리한 revision 또는 reminder local date
- 처리 결과: 성공, 접수 불확실, 확정 실패
- 마지막 처리 시각

이 상태에는 학생명, 전화번호, 메시지 전문, webhook URL, provider secret을 저장하지 않는다. 성공뿐 아니라 `unknown`과 `failed_hold`도 compact 상태에 반영해 7일 receipt가 정리된 뒤 과거 원천 replay가 새 발송으로 바뀌지 않게 한다. source와 channel당 몇 개의 정수·날짜·상태만 유지하므로 장기 용량은 매우 작다.

### 7.2 최근 delivery receipt

운영 확인과 수동 재전송 판단을 위해 최근 7일만 보존한다.

필수 열:

- intent/delivery ID
- source kind, source ID, source revision
- event kind, channel
- dedupe/request key hash
- 상태: `pending`, `accepted`, `unknown`, `failed_hold`
- provider HTTP 상태 코드와 안전한 provider reference
- mention resolution 결과
- attempt count, created/sent/updated timestamp

금지 정보:

- 전체 전화번호
- 학생명 또는 보호자명
- 메시지 전문과 치환 변수 원문
- Google Chat webhook URL
- SOLAPI API key/secret 및 Authorization 값
- provider 응답 원문

성공·실패 receipt와 오전 reminder job 자체의 cron run detail만 7일 후 같은 오전 job에서 정리한다. 다른 job의 이력은 이름이나 job ID를 넓게 추정해 삭제하지 않는다. 별도 cleanup cron을 만들지 않는다.

### 7.3 요청 시에만 여는 외부 발송 운영 화면

대시보드 알림 inbox와 별도로 `환경 설정`의 관리자용 외부 발송 이력 화면만 유지한다.

- 화면을 열 때만 최근 7일 receipt를 최대 30건 조회한다.
- 성공, 확정 실패, 접수 불확실, mention 누락만 표시한다.
- 학생명·전화번호·메시지 전문은 표시하지 않는다.
- `accepted`는 재전송할 수 없다.
- `unknown`은 provider 조회로 접수 여부를 먼저 조정하며 바로 재전송할 수 없다.
- `failed_hold`는 원인을 수정한 뒤 관리자가 명시적으로 새 발송 generation을 승인해야 한다.
- 이 화면은 주기 refresh, badge count, unread count를 사용하지 않는다.

## 8. 기존 알림 시스템 폐기 순서

1. 현재 worker와 watchdog의 `active=false`를 유지한다.
2. 새 경량 schema와 route를 provider-off 상태로 설치한다.
3. 합성 데이터와 provider-zero 테스트로 intent·claim·finalize·중복 방지를 검증한다.
4. Google Chat test connection과 SOLAPI 승인 템플릿을 별도 검증한다.
5. 사용자 승인 후 종류·채널별 runtime gate를 제한적으로 활성화한다.
6. 새 경로의 실제 provider request와 수신 증거를 확인한다.
7. 대시보드 알림 UI, unread RPC, web push subscription 읽기와 쓰기를 제거한다.
8. 기존 queue/fanout/reconciliation/heartbeat에 새 쓰기가 없음을 확인한다.
9. heartbeat와 cron run history를 먼저 정리한다.
10. dependency audit 후 더 이상 참조되지 않는 함수·테이블·인덱스를 forward migration으로 제거한다.

기존 테이블을 즉시 drop하거나 과거 delivery를 backfill하지 않는다. 폐기 migration은 신규 경로 활성화와 실제 수신 검증 이후 별도 승인을 받는다.

## 9. 홈과 통계 메뉴

### 9.1 홈

홈은 한 번의 `daily brief` RPC만 호출한다.

표시 범위:

- 오늘 레벨테스트 수와 가까운 일정
- 오늘 방문상담 수와 가까운 일정
- 오늘 청강 수와 가까운 일정
- 오늘 처리할 업무 수
- 가장 가까운 일정 최대 5건
- 주요 업무 바로가기
- 통계 메뉴 진입 버튼

원본 학생·수업·교재 배열, 전체 기간 통계, 전체 conflict 계산, 180일 lesson session은 홈에서 읽지 않는다. daily brief RPC가 실패해도 navigation과 바로가기는 정상 렌더링한다.

### 9.2 통계 메뉴

기존 통계의 UX와 지표를 보존해 별도 메뉴로 이동한다.

- 통계 메뉴를 열 때만 첫 통계 요청을 실행한다.
- `운영 현황`, `학생·수업`, `일정·충돌`, `교재` 단위로 탭을 나눈다.
- 활성 탭만 lazy load한다.
- 원본 전체 행이 아니라 통계 전용 summary RPC를 사용한다.
- 기본 기간을 제한하고 사용자가 범위를 넓힐 때만 추가 계산한다.
- 결과를 server 기준 약 10분 캐시한다.
- 마지막 갱신 시각과 수동 새로고침을 제공한다.
- 일부 탭 실패가 다른 통계와 운영 화면을 막지 않는다.

## 10. 목록·상세·공개 조회 구조

### 10.1 업무 목록

- 업무 종류와 상태별 최초 30건만 조회한다.
- 다음 페이지는 `updated_at + id` cursor를 사용한다.
- 목록에서 댓글·첨부·이벤트를 읽지 않는다.
- 상세를 열 때 선택한 task ID의 관련 행만 읽는다.
- 전체 건수는 별도 count/summary RPC로 제공한다.
- 많은 task ID를 URL의 `in(...)`에 넣어 관련 테이블을 함께 읽는 경로를 제거한다.

### 10.2 학생·수업·교재 관리

- 목록은 표시 컬럼만 조회한다.
- 학생 수강 이력, 수업 audit, 교재 사용 내역, 편집 catalog는 상세/편집 진입 시 읽는다.
- 저장 후 화면 전체 `refresh()`를 금지하고 변경한 entity와 dependent summary만 무효화한다.
- 선생님·교실·과목 같은 작은 기준정보는 30분~1시간 또는 로그인 session 동안 캐시한다.

### 10.3 학사일정·시간표

- 현재 학기 또는 화면에 보이는 날짜 범위만 조회한다.
- lesson session은 선택한 월 범위만 조회한다.
- conflict 계산은 홈이 아니라 일정·시간표 화면에서 사용자가 해당 범위를 열 때 수행한다.
- 저장 후 변경한 수업과 날짜 범위만 갱신한다.

### 10.4 공개 수업

- 공개에 필요한 projection만 반환한다.
- Vercel에서 약 10분 캐시하고 수업 변경 시 관련 cache만 무효화한다.
- 방문자마다 classes/textbooks/progress_logs 전체를 읽지 않는다.
- Supabase 장애 시 마지막 정상 snapshot을 제공한다.

### 10.5 공통 query 규칙

- 신규 목록 코드에서 `select('*')` 금지
- 모든 목록은 명시적 projection, filter, order, limit 필수
- 검색은 debounce하고 동일 in-flight 요청을 합친다.
- 페이지를 벗어난 요청은 취소하거나 결과를 폐기한다.
- summary와 detail을 한 RPC에 섞지 않는다.
- `OFFSET` 기반 깊은 페이지 대신 cursor pagination을 사용한다.

## 11. Postgres 최적화 원칙

### 11.1 우선 인덱스

실제 query와 `EXPLAIN`을 기준으로 다음을 우선 확인한다.

- task scoped table의 `task_id`
- 일정 source의 `status, scheduled_at`
- 청강 source의 예약 상태·수업·session·scheduled date
- current/pending row만 포함하는 partial index
- RLS ownership 및 담당자 lookup에 쓰는 profile/foreign-key 컬럼

Advisor의 152개 미인덱스 외래키를 일괄 생성하지 않는다. 읽지 않는 외래키의 인덱스는 write와 storage 비용만 추가할 수 있다.

### 11.2 RLS

- per-row `auth.uid()`/JWT 호출을 `(select auth.uid())` 형태로 한 번 계산하게 한다.
- 같은 role/action의 permissive 정책을 의도가 같은 범위에서 통합한다.
- `TO authenticated`만으로 권한을 열지 않고 실제 ownership/role predicate를 유지한다.
- policy 변경 전후에 결과 행 집합과 권한 거부를 모두 비교한다.

### 11.3 인덱스 제거

- 확인된 exact duplicate index만 우선 제거 후보로 둔다.
- `unused_index` Advisor 결과는 최소 7일의 정상 운영 통계를 수집한 뒤 판단한다.
- 제거 전 query plan, constraint dependency, RLS dependency를 확인한다.
- 인덱스 변경은 하나의 대량 migration으로 실행하지 않는다.

### 11.4 통계와 vacuum

- 큰 데이터 변경 후 대상 테이블만 `ANALYZE`한다.
- 장애 대응 중 `VACUUM FULL`, 대량 reindex, 전체 schema introspection을 실행하지 않는다.
- dead tuple과 autovacuum 상태를 주기적으로 읽기 전용 점검한다.

## 12. 저장 공간과 감사 이력

- `dashboard_audit_logs`는 복구 가치가 있으므로 즉시 삭제하지 않는다.
- 신규 audit는 가능하면 전체 row snapshot 대신 변경 field diff를 기록한다.
- 최근 180일은 운영 DB에 보존한다.
- 180일 초과분은 월 단위 archive의 무결성을 확인한 뒤에만 삭제 대상으로 삼는다.
- archive/delete는 알림 최적화와 별도의 destructive 작업으로 승인받는다.
- notification heartbeat는 신규 경로 검증 후 보존 가치가 없으므로 폐기한다.
- worksheet/question/Gemini 관련 별도 앱 데이터는 7일 사용량 측정 후 두 번째 무료 Supabase 프로젝트 분리를 별도 판단한다.

## 13. 무료 티어 운영 기준

### 13.1 자원 기준

- DB 300MB 미만: 정상 운영
- 300~400MB: archive와 schema 분리 계획 실행
- 400MB 이상: 신규 대량 기능·backfill 중단 후 분리 또는 유료화 판단
- active cron: 원칙적으로 오전 10시 reminder 한 개
- direct Postgres connection보다 Supabase API 또는 pooler를 사용한다.
- serverless가 직접 Postgres에 연결해야 한다면 transaction/session 목적에 맞는 Supavisor와 낮은 connection limit를 사용한다.

### 13.2 변경 운영

- 운영 migration, index build, backfill, 대량 import를 동시에 실행하지 않는다.
- migration 전 대상 query와 lock 범위를 확인한다.
- migration 직후 schema 전체를 반복 조회하는 Studio 화면을 여러 개 열지 않는다.
- 배포, DB 적용, runtime 활성화, provider send를 분리한다.
- 새 기능은 전체 테이블 조회와 신규 주기 worker가 없음을 release check에 포함한다.

### 13.3 백업

Free 플랜의 자동 백업 부재를 전제로 중요 운영 데이터를 별도 주기 백업한다. 백업 파일 생성, 보관 위치, 복원 연습은 이 구현과 분리된 운영 작업으로 설계하고 개인정보 접근 승인을 따로 받는다.

## 14. 오류 처리

- 예약 저장 성공 후 provider 실패: 예약 유지, 채널 delivery만 실패 상태
- 고객 알림톡 실패 + Google Chat 성공: Chat을 재전송하지 않음
- Google Chat 실패 + 고객 알림톡 성공: 고객 알림톡을 재전송하지 않음
- mention identity 누락: 멘션 없는 Chat 발송, `mention_unresolved` 기록
- provider 4xx 확정 거부: `failed_hold`, 자동 재발송 금지
- provider timeout/connection loss: `unknown`, 자동 재발송 금지
- 명확한 429/5xx: 같은 invocation에서 최대 2회 bounded retry
- 오전 cron route 실패: watchdog 없이 운영 실패 목록에 남기고 수동 판단
- 통계 RPC 실패: 해당 카드/탭만 오류 표시, 운영 navigation 유지
- summary cache stale: 마지막 갱신 시각 표시, 수동 갱신 제공

## 15. 검증 전략

### 15.1 알림 계약 테스트

- 6개 전달 매트릭스 조합의 exact channel 수
- 방문상담 상담 책임자와 청강 담당 선생님 mention routing
- broad mention 금지와 duplicate mention 제거
- identity 누락 시 non-blocking fallback
- 예약 저장과 provider 실패의 transaction 분리
- 채널별 dedupe와 한 채널만 재처리
- 오전 10시 이전/정각 snapshot/이후 당일 예약 경계
- canceled/completed 제외
- 최신 source revision 사용
- 7일 retention과 compact state 유지
- provider credential/request zero 상태의 전체 DB·route 테스트

### 15.2 쿼리 테스트

- 홈 진입 query count와 payload size
- 통계 메뉴를 열기 전 통계 query zero
- 활성 통계 탭만 요청
- 목록 30건 cursor pagination
- detail을 열기 전 related table query zero
- 공개 페이지 cache hit 시 Supabase query zero
- 주요 query의 `EXPLAIN (ANALYZE, BUFFERS)` 비교는 합성 또는 안전한 read-only 환경에서 수행

### 15.3 권한·보안 테스트

- service secret과 webhook URL의 client bundle·DB log·receipt 부재
- RLS 결과 동등성과 unauthorized denial
- provider route bearer/request signature 검증
- SECURITY DEFINER 함수의 private schema, fixed `search_path`, revoked PUBLIC execute
- customer phone과 message content가 최근 receipt에 저장되지 않음

### 15.4 운영 검증 분리

다음 증거를 하나의 `완료`로 합치지 않는다.

1. source와 테스트 통과
2. DB migration 적용
3. GitHub `main` 반영
4. Vercel Production `READY`
5. runtime/cron 활성화
6. SOLAPI template 승인·ID·drift preflight
7. Google Chat connection·mention identity 검증
8. provider request 접수
9. 실제 고객/Google Chat 수신

## 16. 안전한 전환 단계

### Phase 0 — 기준선

- 현재 active cron이 0개임을 재확인한다.
- DB size, top relation, top query, RLS/Advisor, 오류율의 기준선을 저장한다.
- 기존 provider attempt가 없는 상태를 확인한다.

### Phase 1 — 대시보드 read 최적화

- 홈 daily brief와 통계 메뉴 lazy-load를 먼저 구현한다.
- 업무 목록·상세 분리, 관리/학사 range 조회, 공개 cache를 작은 단위로 적용한다.
- 각 단계마다 query count와 payload를 비교한다.

### Phase 2 — 경량 알림 passive 설치

- compact state, 최근 receipt, intent/claim/finalize, private routes를 provider-off로 설치한다.
- 기존 worker/watchdog는 계속 inactive다.
- 합성 데이터·provider-zero 테스트를 완료한다.

### Phase 3 — 외부 연결 준비

- 고객 알림톡 종류별 SOLAPI 승인 template과 server catalog drift를 확인한다.
- Google Chat 관리팀방·과목방 connection과 profile mention identity를 검증한다.
- 실제 provider 호출 전 별도 사용자 승인을 받는다.

### Phase 4 — 제한 활성화

- 종류·채널별 gate를 하나씩 활성화한다.
- 예약 완료 알림의 provider 접수와 실제 수신을 먼저 검증한다.
- 오전 10시 cron은 수동 dry run과 날짜 경계 검증 후 별도로 활성화한다.
- 첫 운영 run을 확인한 뒤에만 자동 상태를 유지한다.

### Phase 5 — 구형 알림 폐기

- 대시보드 알림 UI/read/write를 제거한다.
- 구형 control plane write가 0임을 관찰한다.
- dependency와 보존 범위를 다시 검토한 뒤 destructive cleanup을 별도 승인받는다.

## 17. 완료 기준

- 대시보드 최초 진입에서 전체 통계 query가 실행되지 않는다.
- 홈은 daily brief 한 번으로 렌더링되고 통계는 메뉴/탭 진입 시에만 실행된다.
- 일반 예약 알림에는 polling cron이 없다.
- active cron은 오전 10시 리마인드 한 개뿐이다.
- 레벨테스트·방문상담·청강의 알림톡 및 Chat 전달 매트릭스가 exact test를 통과한다.
- 같은 예약·revision·event·channel은 한 번만 성공 처리된다.
- provider 실패가 예약과 다른 채널을 rollback하거나 중복 발송하지 않는다.
- 7일 초과 상세 receipt가 제거돼도 compact state가 중복을 막는다.
- worker·watchdog·heartbeat가 다시 활성화되지 않는다.
- 주요 화면의 query count, payload, 총 실행 시간이 기준선보다 감소한다.
- source/DB/deployment/runtime/provider/receipt 결과가 각각 분리되어 보고된다.

## 18. 명세 관계

이 문서는 `2026-08-05-registration-solapi-customer-messages-design.md`의 고객 예약 메시지 범위 중 다음 결정을 대체한다.

- 레벨테스트·방문상담·청강 예약 완료 고객 알림톡은 명시적 운영 승인 아래 자동 이벤트 발송으로 전환한다.
- 세 예약의 고객 리마인드는 오전 10시 당일 한 번의 자동 발송으로 제한한다.
- 기존 공통 notification worker를 고객 리마인드 소유자로 사용하지 않는다.

입학신청서, 대기 안내, SOLAPI template approval, provider evidence의 기존 안전 경계는 이 문서가 명시적으로 바꾸지 않는 한 유지한다.
