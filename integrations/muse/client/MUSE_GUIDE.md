---
name: tips-admin-api
description: Tips academy operations API (classes & academic calendar): read classes/schedules, preview & commit single weekly-slot time changes, query operation results. Auth via Secure Vault surrogate (bearer_header). Use when handling Tips class/schedule work through the API instead of the browser.
---

# tips-admin-api

팁스 업무 API 전용 스킬. 브라우저 자동화 대신 REST API로 수업·학사일정을 조회하고,
단일 수업의 주간 슬롯 시간 변경을 미리보기/확정/조회한다.

## Scope (fixed)

- 조회: `health`, `classes` (검색/상세), `calendar/events`
- 변경: `classes/{id}/weekly-time/preview` → `operations` (commit) → `operations/{requestKey}` (결과 조회)
- **Out of scope**: 다른 운영 데이터 변경, 고객·관리팀 메시지 발송, 다른 서비스의 로그인/자동화 설정 변경.
- **테스트 주소 전달 전까지 실서비스 호출 금지.** `--base-url` 없이는 어떤 요청도 나가지 않는다.

## Setup — 사용자 단계 (테스트 주소가 준비되면)

1. 내가 `credentials.request_api_access`를 호출한다. 파라미터(비밀 아님):
   - `provider`: `tips-admin-api` → `custom.tips-admin-api`로 등록
   - `api_hosts`: 검증된 베어 호스트명 (송신 허용 목록)
   - `auth_scheme`: `api_key`, `placement`: `bearer_header`
2. 현준님이 호스팅된 연결 페이지에서 API 키를 입력한다 → Secure Vault 직행. 키 값은 대화·파일·로그 어디에도 남지 않는다.
3. 환경 변수 설정:
   - `TIPS_API_BASE_URL=https://<검증 호스트>/api/v1`
   - `TIPS_API_ALLOWED_HOSTS=<연결 때 고정한 베어 호스트명>` (필수. 임의의 --base-url은 이 목록과 교차 검증되며, 목록에 없는 호스트는 거부된다)
   (`TIPS_API_CREDENTIAL`은 기본값 `custom.tips-admin-api` 그대로 두면 된다.)
4. 연결 확인: `bin/tips-admin health` → `credentialId, executor, scopes, classIds, expiresAt, timezone` 응답으로 주입 여부 검증.

## Tooling

CLI: `bin/tips-admin` (Python, 실행 가능). 공통 옵션: `--base-url`, `--credential`, `--journal`.

```
tips-admin health
tips-admin classes search [--search ...] [--status 수강] [--page 1]      # pageSize 20, v1
tips-admin classes get --id <UUID>                                       # v1
tips-admin classes weekly-time preview --id <UUID> --slot-id <id> \
    --start-minute <0-1439> --end-minute <1-1440> --expected-version <v> --reason <text>  # v1
tips-admin operations commit --preview-token <token> \
    [--source-reference <https://원본메시지링크>] [--idempotency-key <UUID>]   # v1+v2
tips-admin operations get --request-key <key>                             # v1+v2
tips-admin operations list [--page 1]                                     # v1+v2, pageSize 20
tips-admin workspace get --class-id <UUID> --from YYYY-MM-DD --to YYYY-MM-DD  # v2, 최대 93일
tips-admin catalogs get --class-id <UUID> --kind teachers|classrooms \
    [--search ...] [--page 1]                                             # v2, pageSize 20
tips-admin changes preview --class-id <UUID> --expected-version <v> \
    --from YYYY-MM-DD --to YYYY-MM-DD --reason <text> \
    [--basic-json '{...}'] [--weekly-slots-json '[...]'] [--lessons-json '[...]']  # v2
tips-admin calendar events --from YYYY-MM-DD --to YYYY-MM-DD            # v1, 최대 31일
```
v1 명령은 `/api/v1` 베이스에서, v2 명령(`workspace`/`catalogs`/`changes`)은 `/api/v2`
베이스에서만 동작한다. `health`/`operations`는 둘 다 된다. 베이스 경로가 버전을
결정하며, 다른 버전 베이스에서 호출하면 사용법 거부(종료 코드 2).

## Auth

- `bin/dynamic_credentials.py` (번들 헬퍼)만 사용. `urllib` + `add_surrogate_to_request`.
- 다루는 값은 `hsurr:*` 서러게이트뿐. 실제 비밀값은 프로세스가 절대 보지 못한다.
- `allowed_hosts`는 `--base-url`의 호스트에서 유도되며 매 호출마다 강제 검증된다.
- 리다이렉트는 거부된다.

## Execution rules (반드시 준수)

CLI 종료 코드: `0` 정상 / `2` 사용법·설정 거부 / `3` 확정 실패(요청 키와 `data.error.code`가 검증된 영수증 `data.state=failed`, 또는 서버의 명시적 거부(4xx + 고정 error.code)) / `4` 미확정(unknown, 응답 유실, 영수증 검증 불일치, 유효한 영수증 없는 5xx, 읽기 실패·전송 실패, HTTP 200의 비정상 본문) / `5` 레이트리밋(429, Retry-After 보고, 자동 재시도 금지).

**영수증 상태별 형태와 처리 (실제 서버):**
- `applied`: `{data:{operationId, state:'applied', class:{id, ...}}}`. `data.operationId`가 전송한 `Idempotency-Key`와 일치 + `data.class.id` 존재 + 기록된 preview 기대값과 일치가 모두 맞아야 exit 0.
- `failed`: `{data:{operationId, state:'failed', error:{code, sqlstate}}}` — **class가 없다.** 요청 키와 유효한 `data.error.code`를 검증한 뒤 exit 3(확정 실패). `error.code`가 없으면 확정 실패로 단정할 수 없어 exit 4.
- `unknown`: `{data:{operationId, state:'unknown', retryWithNewKey:false}}` — exit 4.
- 임의의 `state` 값이나 잘못된 envelope은 exit 4. `failed`·예상 밖 상태가 exit 0으로 끝나는 경로는 없다. `class.id`/preview 비교는 applied에서만 요구한다.

1. **대상 확정은 UUID로만.** 이름 검색 결과가 여러 건이면 사용자에게 질문하고 UUID를 받아 확정한다. 이름으로 추측 확정 금지.
2. **weekly-time preview는 기존 주간 슬롯 1개의 시간 변경 전용.** 날짜 지정 휴강/보강 요청에는 사용하지 않는다. 이미 생성된 개별 회차는 바뀌지 않는다 (`effect: weekly_template_only`, `materializedLessonsChanged: false`).
3. **키 네임스페이스 분리.** preview 키를 `POST /operations`의 `Idempotency-Key`로 재사용 금지. 같은 확정 요청의 재시도(동일 페이로드)에만 같은 키 사용. 동일 키에 다른 내용이 실리면 전송 전 중단.
4. **POST /operations 전송 전에** `{requestKey, previewToken, body}`를 저널에 먼저 기록한다.
    저널 경로: `journal/<canonical-origin>/v<1|2>/<credentialId>/operations.jsonl` (권한 0600, 동시 실행 잠금, 전체 바이트 기록 확인 + flush + fsync).
    canonical origin은 base URL의 scheme+host+effective port(명시 없으면 443)이며, 디렉토리명은 `host_port_sha256(앞 16자)` 형태라 서로 다른 origin이 충돌하지 않는다. base URL에 userinfo/query/fragment가 있으면 거부한다. apiVersion도 파티션에 포함되므로 v1/v2 기록이 섞이지 않는다. (이전 hostname-only 레이아웃과 달라 구 버전이 쓴 저널은 새 위치에서 읽히지 않는다.)
    `credentialId`는 `GET /health` 응답에서 읽는다.
    **저널은 단일 실행자를 전제**한다. 동기화 폴더+파일 잠금만으로 여러 머신의 중복 실행을 막을 수 있다고 가정하지 않는다.
    **손상된 JSONL 줄이 있으면 미확정으로 중단**한다(exit 4): 이전 commit 상태를 알 수 없으므로 새 키 발급·재실행을 하지 않고, 무시하고 넘어가지 않는다.
    같은 `previewToken`의 저널 기록이 이미 있으면 새 UUID를 만들지 않고, 새 preview로 우회하지도 않으며,
    기존 `requestKey`로 결과를 먼저 조회한다. **`--idempotency-key`를 기존 키와 같게 명시했어도 동일하게 기존 키 GET부터 하고 POST는 0회**다. 새 키는 계속 거부한다.
    `applied`면 재전송 없이 종료, `failed`면 영수증을 보고하고 자동 재시도하지 않으며,
    `unknown`이면 미확정으로 보고한다.
    **v1 preview 성공 시 기대값을 저널에 기록**한다: `{kind: preview, previewToken, classId=before.id, afterSlots=after.weeklySlots 전체, expiresAt}`.
    commit/replay의 applied 영수증은 이 기대값과 대조한다: `data.operationId` 일치 + `data.class.id`가 preview 수업 ID와 같은지 + 주간 슬롯들의 `weekday/startMinute/endMinute/teacherId/classroomId`가 `preview.after`와 같은지(의미 있는 필드들로 정렬 비교; legacy 슬롯 id는 시간 문자열이 바뀌면 달라질 수 있어 id로 찾지 않음; 버전·timestamp는 비교 제외).
    다르면 exit 4로 중단하고, preview 기대값 기록이 없으면 commit 성공으로 자동 판정하지 말고 미확정으로 보고한다.
    **v2 changes preview 성공 시 기대값을 저널에 기록**한다: `{kind: preview, apiVersion: 2, previewToken, classId=before.id, afterHash=after.verificationHash, expiresAt}`.
    applied 영수증은 `data.operationId` 일치 + `data.class.id == before.id` + `data.class.verificationHash == after.verificationHash`를 모두 만족해야 성공이다.
    `verificationHash`는 기본정보/주간슬롯/날짜별회차의 의미 상태 검증용이며 version/timestamp는 제외된다.
    기대값이 없거나 해시가 다르면 exit 4. HTTP 오류 응답에 실린 applied 영수증도 같은 해시 검증을 통과해야 한다.
5. **응답 유실 시** `operations get --request-key`로 먼저 조회한다. `state=unknown`은 실패도 성공도 아니다.
    새 키로 재실행하지 않고, 브라우저로 우회하지 않으며, 미확정으로 보고한다.
    **`POST /operations`가 500/502/503/504를 반환하면서 사용 가능한 영수증이
    없으면, 저장 실패가 확인된 것이 아니다.** DB commit이 성공하고 응답/프록시 단계만
    실패했을 수 있으므로 **exit 4 미확정**으로 처리한다. 저널에 이미 기록된 동일
    `requestKey`로 `GET /operations/{key}`를 조회해야 하며, **새 키·새
    preview·브라우저 쓰기로 재실행하면 안 된다.** GET 영수증 조회 자체가 5xx여도
    결과는 여전히 미확정이다.
    **HTTP 200인데 본문이 HTML/깨진 JSON/비UTF8/JSON 배열·null이면** operation
    POST/GET 응답은 exit 4 미확정 + 동일 키 복구이며, 원문 본문은 출력하지 않는다.
    소켓 타임아웃·응답 중 단절도 동일하게 처리한다(요청이 적용됐을 수 있으므로 확정 실패가 아니다).
    일반 읽기(GET health/workspace 등)의 5xx·전송 실패도 읽기가 실패했을 뿐이며 확정 실패(종료 코드 3)가 아니다. **종료 코드 3은 요청 키와 `data.error.code`가 검증된
    `data.state=failed` 영수증이 있을 때만** 쓴다 (명시적 거부 4xx는 별도).
    **409 뒤의 복구도 자동 우회로 쓰지 않는다**: 최신 버전만 복사하지 말고 수업 전체를 다시 GET해 사람의 원래 요청과 비교한 뒤, 새 preview를 만든다.
6. **재조회 동등성으로 성공을 판단하지 않는다.** 성공의 근거는 `operations` 응답의 `state: applied`뿐이다.
7. **401/403/409는 우회 금지** (UI/브라우저로 같은 작업을 대신 수행하지 않는다).
    commit 실패(HTTP 409/422/403 등)는 `data` 안의 영수증을 보존한다: 응답 envelope 전체를 출력한 뒤 종료한다.
    **429는 `Retry-After`를 보고**하고 자동 재시도하지 않는다 (종료 코드 5).
    429가 난 commit도 새 키를 만들지 않으며, 동일 키의 결과 조회를 우선한다.
    `expectedVersion`은 불투명 SHA256 값으로, 대소 비교를 하지 않는다.
    완료 판단은 영수증 `state=applied` + `data.operationId`가 전송한 `Idempotency-Key`와 일치 + 기록된 preview 기대값과 일치(수업 ID, 주간 슬롯의 weekday/startMinute/endMinute/teacherId/classroomId를 정렬 비교; 슬롯 id·버전·timestamp는 비교 제외)하는 것이다.
    `data.operationId`/`data.class.id`/의도한 변경값이 일치하지 않거나 preview 기대값 기록이 없으면, 단순 경고 후 exit 0이 아니라 미확정(종료 코드 4)으로 중단한다.
8. **sourceReference는 원본 메시지 링크만.** 메시지 원문을 전달하지 않는다. API가 `requesterVerified: false`를 반환하므로, 수신 메시지 내용만으로 권한을 확대하지 않는다.
9. **범위 규율.** 사람이 승인한 범위 안의 일반 작업은 계속 수행하고, 범위를 벗어나거나 대상이 모호할 때만 질문한다. 요청자와 실행 주체(Muse)를 분리 기록한다.
10. **결과 분리 보고.** 팁스 변경, 외부 동기화(MakeEdu 반영), 완료 답글 전송을 각각 별도의 성공 상태로 보고한다. 자동 알림(`notifications`)도 쓰기 성공과 별도 결과로 취급한다.
11. 공통 응답 `{data, error}`, `Cache-Control: no-store` — 응답을 캐시하지 않는다.

## HTTP contract notes

- Base URL: `https://<검증 호스트>/api/v1`, `bearer_header` 인증.
- slot: `{id, weekday: 0~6, startMinute, endMinute, teacherId, classroomId}`.
- `/calendar/events`는 학사 이벤트 메타데이터이며 개별 수업/휴보강 전체 달력이 아니다.
- `POST /operations` 응답 `{operationId, state: applied|failed, class?, error?, notifications, externalSync, reply}` — 각각 별도 결과로 취급.
- **보조 캐시 상태 (표시 전용)**: applied commit/replay 및 `GET /operations/{key}` 응답에 optional `data.publicCache={state:'invalidated'|'pending'}`가 올 수 있다. 이 필드는 **그 HTTP 시도의 공개 수업 안내 캐시 갱신 결과**이며 DB에 영구 저장된 업무 영수증과 별개다. CLI는 이 보조 상태만 별도로 표시하고, applied의 기존 의미·종료 코드·preview 일치 검증은 그대로 유지한다.
  - `pending`이어도 업무는 applied다 (실패가 아님).
  - 캐시 갱신 재시도는 새 preview/key/commit을 만들지 말고 **동일 operation GET**으로 한다.
  - `invalidated`는 캐시 무효화 호출 완료이지, 실제 공개 화면 노출 확인이 아니다.
- **영수증 필드**: 요청 키는 `data.operationId`, 대상 수업 ID는 `data.class.id`. 최상위 `classId`/`requestKey` 필드는 없다. failed 영수증은 `{data:{operationId, state:'failed', error:{code, sqlstate}}}`(class 없음), unknown 영수증은 `{data:{operationId, state:'unknown', retryWithNewKey:false}}`다.
  `data.operationId`는 전송한 `Idempotency-Key`와 일치해야 한다.
- `class.version`은 불투명 SHA256 값으로, 대소 비교를 하지 않는다.
- 고정 error.code: `agent_stale` / `agent_preview_expired` / `agent_idempotency_key_reused` / `agent_preview_consumed` / `timetable_resource_conflict` / `agent_missing_billing_period` / `agent_ambiguous_lesson` / (v2) `agent_approval_workflow_required`.
- preview 유효기간은 10분이며 `expiresAt`을 반환한다. 모든 슬롯 분·요일·학사 날짜는 Asia/Seoul 기준이다.
- 상세 계약은 `/openapi` 참조 (구현 중).

## v2 HTTP contract notes (`/api/v2`)

- `GET /health` → `data={apiVersion: '2', credentialId, scopes, ...}`. 새 권한:
  `class-details:read`, `class-info:write`, `weekly-plan:write`, `lesson-plan:write`.
  **기존 키는 자동 확장되지 않는다.** 필요한 scope이 없으면 CLI가 요청을 보내기 전에
  거부한다(종료 코드 2).
- `GET /classes/{classId}?from=YYYY-MM-DD&to=YYYY-MM-DD`: 날짜 차이 최대 93일.
  `data={id, version, basic, weeklySlots, lessons, window, timezone, capabilities, verificationHash}`.
  `basic={name, classType, subject, subjectAreaKey, grade, capacity, fee}`.
  `lessons[]={id, date, state: scheduled|cancelled|skipped|undecided|makeup, startMinute, endMinute, teacherId, classroomId, sourceSlotId, makeupOfLessonId, originalDate, makeupDate, materialized}`.
  lesson id·날짜는 추측하지 않고 workspace 조회 결과 그대로 사용한다.
- `GET /classes/{id}/catalogs?kind=teachers|classrooms&search=...&page=1`:
  `data={kind, page, pageSize: 20, total, items: [{id, name, subjects}]}`.
  이름으로 검색한 뒤 **exact ID**를 사용한다. 실제 과목 적합성은 preview에서 최종 검증된다.
- `POST /classes/{id}/changes/preview`:
  `{expectedVersion, window: {from, to}, reason, basic?, weeklySlots?, lessons?}`.
  - `basic`: 변경된 필드만 (위 basic 필드 중).
  - `weeklySlots`: **기존 id의 수정 목록** (추가/삭제 아님). 각 항목은
    `id, weekday, startMinute, endMinute, teacherId, classroomId, sortOrder` 전부 필수.
  - `lessons` (최대 50개): `{date, lessonId?, state: scheduled|cancelled|skipped|undecided, timing?: {startMinute, endMinute, teacherId, classroomId}, makeup?: null | {date, startMinute, endMinute, teacherId, classroomId}}`.
    **보강은 cancelled에만 연결**한다. 날짜·source가 모호하면 중단하고 추측하지 않는다.
    날짜는 오늘 이후(Asia/Seoul)만. 하나의 클래스 전체가 원자적으로 처리된다.
  - 주간 템플릿 변경은 즉시 적용되므로, "10월부터"처럼 끝날짜 없는 요청은 범위 내
    **날짜별 lessons로 작성**한다. 끝날짜가 없으면 사람에게 먼저 확인한다.
  - 승인 건과 겹치면 `error.code=agent_approval_workflow_required` → 자동 우회 금지(종료 코드 3).
  - 범위 밖: 삭제, 수납, 발송, 승인 변경.
- preview 응답: `data={previewToken, expiresAt, before: <workspace>, after: <workspace>, notifications: {state: 'not_requested'}}`.
- `POST /operations`: v1과 같은 `previewToken`/`sourceReference` + UUID `Idempotency-Key`.
  `data.state=applied|failed`, applied면 `data.class=<workspace>`.
  `GET /operations/{requestKey}`와 `GET /operations?page=1`(20개 목록)이 복구 경로.
  publicCache 규칙은 v1과 동일. `unknown`에 새 키 재실행 금지.
- 고정 error.code에 `agent_approval_workflow_required` 추가.
- `agent_missing_billing_period`: legacy 월 계획이 없는 수업의 날짜별 편집은 거부된다(종료 코드 3). 클라이언트 재시도·브라우저 우회 대상이 아니다.
- `agent_ambiguous_lesson`: **legacy의 동일 날짜 복수 회차는 날짜 단위 저장이라
  lessonId가 있어도 거부된다**(종료 코드 3). 정확한 회차를 지정하려면 요청자에게
  확인하거나 normalized 수업의 exact lessonId를 사용한다. **normalized 복수
  회차만 exact lessonId로 고른다.**
- **서버 측 수정 반영 (일반 날짜별 시간 변경)**: 유일한 일반 날짜별 시간 변경은
  기존 주간 시간과 자기 충돌하지 않도록 DB에서 고쳤다. 다른 날짜의 주간 시간은
  유지된다.

## 운용 제한 (2026-09-29 서버 검증 반영)

Codex가 격리 DB에서 확인한 항목 (운영은 아직 미배포):
- 기존/normalized 두 저장 방식의 일괄 휴보강 저장
- private 학습 기록 보존 (휴보강 저장 시 지워지지 않음)
- 미리보기 rollback (preview 실패 시 저장 상태 복귀)
- 중복 실행 방지 (동일 operation 재실행)
- commit 시점의 23P01 충돌 재검사

날짜별 수업 (`changes preview` + `lessons`) 추가 제한:
- **weeklySlots는 기존 슬롯 수정만.** 추가/삭제는 지원하지 않는다. 각 항목의
  `id, weekday, startMinute, endMinute, teacherId, classroomId, sortOrder` 전부 필수.
- **날짜별 수업은 오늘 이후(Asia/Seoul)이면서 preview window `[--from, --to]` 안에서만
  수정**한다. window 밖 날짜는 CLI가 전송 전에 거부한다(종료 코드 2). 날짜는 추측 금지.
- **한 날짜가 모호하면 lessonId와 정확한 원본 날짜를 먼저 확인**한다.
  `--lessons-json`에 같은 날짜가 두 번 나오면 CLI가 거부한다.
- **한 취소 회차에는 보강 하나만 연결**한다(1:1). 서로 다른 휴강을 같은 보강 회차로
  합치거나, 이미 차 있는 날짜로 보강을 보내는 것은 지원하지 않으며 CLI가 거부한다.
  change set 밖에 있는 날짜의 점유 여부는 workspace 조회로 먼저 교차 확인한다.
- **기존 승인 요청과 겹치면 승인 흐름이 필요**하다
  (`error.code=agent_approval_workflow_required` → 종료 코드 3, 자동 우회 금지).
- **normalized 저장 방식에서 취소는 저장상 `skipped`가 된다.** 따라서 영수증의
  state 문자열을 `cancelled`로 단정하지 말고, **preview.after의 실제 상태와
  `verificationHash`를 기준**으로 성공을 판단한다 (CLI는 해시 비교만 한다).
- **'9회차'처럼 번호만 있고 날짜 대응이 불확실하면 날짜를 먼저 확인**한다.
  회차 번호→날짜 추측 금지. workspace 조회에서 날짜를 확정하고, 안 되면 사람에게 묻는다.

## 수업 UUID 해소 워크플로우 (v1/v2 베이스 분리)

- **API v2는 `/classes` 검색을 제공하지 않는다.** 수업 이름→UUID 해소는 반드시
  **`/api/v1` 베이스로 명시적으로** 수행한다:
  ```
  tips-admin --base-url https://<검증 호스트>/api/v1 classes search --search "<수업명>"
  ```
  UUID를 확정한 뒤, v2 작업은 `/api/v2` 베이스로 별도 호출한다:
  ```
  tips-admin --base-url https://<검증 호스트>/api/v2 workspace get --class-id <UUID> --from ... --to ...
  ```
- v1 베이스에서 v2 명령을, v2 베이스에서 v1 명령을 실행하면 종료 코드 2로 거부된다.
  **임의 fallback이나 브라우저 쓰기로 UUID를 해소하지 않는다.**
- 연결 카드/운영 호출 없이 로컬 mock만 유지한다. 운영 호출은 별도 승인 전까지 금지.

## 2차 범위 (구현됨, 로컬 mock 검증)

- 날짜별 휴강·보강의 원자적 일괄 변경 (`changes preview` + `lessons`)
- 서버 작업 목록 / 미확정 복구 (`operations list`, `operations get`)
- 주간 템플릿 변경 (`changes preview` + `weeklySlots`)
- 선생님·강의실 ID 조회 (`catalogs get`)

## 테스트

- `tests/test_v1_mock.py`: v1 59개 스위트. **그중 기존 47개는 사라진 `/tmp` 원본
  테스트 파일이 아니라, 확인된 v1 계약·행동을 기준으로 다시 작성한 복원
  스위트다.** 12개는 신규(5xx 무영수증 미확정·동일 키 GET 복구·503 HTML·502
  깨진 JSON·`agent_ambiguous_lesson`·실서버 failed/unknown 형태·error.code 없는
  failed는 미확정·GET failed→exit3/임의 state→exit4·명시적 동일 키는 GET만·
  손상 저널 중단·canonical origin 포트 분리 및 userinfo/query/fragment 거부).
- `tests/test_v2_mock.py`: v2 39개 스위트 (합성 mock). 10개는 신규(5xx 무영수증
  미확정·단일 POST 보장·동일 키 GET 복구/GET 5xx·503 HTML·502 깨진 JSON·실서버
  failed→exit3/unknown→exit4·GET failed→exit3/임의 state→exit4·HTTP 200
  HTML(본문 미출력)+동일 키 복구·200 비UTF8·200 JSON 배열·소켓 타임아웃·
  명시적 동일 키는 GET만·손상 저널·canonical origin 분리).
  `test_v2_mock.py`의 `BIN`은 `__file__` 기준 상대 경로이므로 어디서든 재현된다.
- `python3 tests/test_v1_mock.py`, `python3 tests/test_v2_mock.py`로 재실행.
- 운영 호출·연결 카드·키 생성 없이 로컬 mock만 유지한다.
