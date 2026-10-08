# AI Agent Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 직원 본인 요청과 관리자 전체 관리, 봇의 안전한 처리·질문 재개 및 선택적 Chat 완료 알림을 제공한다.

**Architecture:** 요청·질문·claim·업무 효과 journal은 독립 AI subsystem으로 만들고 완료 알림은 같은 DB commit의 outbox로 연결한다. 직원 authenticated RPC와 bot service-only gateway를 분리하며 기존 opaque 인증 모델을 별도 AI credential 저장소에 적용한다. Chat transport는 고정 server map만 사용하고 기존 bridge/CLI는 Muse 소유의 연결 작업으로 남긴다.

**Tech Stack:** 현재 repo의 Next.js 16.1.1/React 19.2.3, TypeScript, Zod 4, Supabase/Postgres·pgTAP, shadcn/Radix, TanStack Table, Node built-in test, 기존 브라우저 QA 도구. 새 dependency 도입은 기본 범위에 없다.

**Spec:** [승인된 설계](../specs/2026-10-03-ai-agent-requests-design.md), [API·DB 부록](../specs/2026-10-03-ai-agent-requests-api-db-appendix.md). 사용자 승인: written design 및 active staff/teacher/assistant 본인 요청, active admin 전체, viewer 제외. 이 계획은 승인된 로컬 구현과 별도 운영 활성화 경계를 기록한다.

2026-10-04 현재 상태: Tasks 1–5 로컬 구현은 accepted feature `471312763dd7c430c845504cd1fa85493d9e69e5`에 수용되었다. 통합 base는 `0bbc7593`, CI 소유자의 scoped 수락 HEAD는 `737dfd72f875008265dc98f2909924494bec3c11`이다. 아래 C20 시작점·계획 체크박스·당시 수치는 역사적 기록이며 현재 미구현 상태를 뜻하지 않는다. 현재 통합 QA와 마지막 수정의 검증은 별도로 기록하며, full DB·strict consumer·whole-branch 및 운영 수용을 완료했다고 선언하지 않는다. 운영 SQL 설치·설정·발급·scheduler·provider 증거는 별도 gate다. 체크박스를 일괄 완료 처리하지 않고 당시 task 절차를 보존한다.

## Global Constraints

- 역할: active `staff`, `teacher`, `assistant`는 own; active `admin`은 all; `viewer`·fallback·권한 미확인·비활성은 deny. active는 현재 DB profile 및 auth 계정 존재, 삭제 없음, ban 없음/해제 상태로 판정한다. UI fallback을 서버 권한으로 신뢰하지 않는다.
- 상태: `pending`, `processing`, `question`, `done`, `cancelled`. 열린 질문은 1개이고 answer append와 `question → pending`은 같은 commit이다.
- 목록 page size는 `10/15/20`, 기본 `10`. 기존 표·공통 dialog·semantic token·표준 키보드를 사용하고 별도 요약 카드·단축키를 추가하지 않는다.
- claim lease `15분`, 실행 중 renew `5분`, 신규 queue polling `30분`. expired/unknown은 자동 재등록·완료하지 않는다.
- 모든 쓰기 UUID `Idempotency-Key`; 요청 업무 변경 `If-Match: "r<version>"`; 누락 `428`, stale `409`. nonce `256-bit`, 서버 hash-only, 현재 claim에만 유효하다.
- title `200자`, body/result `20,000자`, message `5,000자`, JSON `128 KiB`; 전체 serialized Chat message `32,000 bytes` 이하.
- 직원 create `10회/시간`, messages `30회/분`, bot `60회/분`, Chat credential/global `60회/분`, space dispatch 최소 `1초`. 제한은 DB에서 원자적으로 집행한다.
- 완료 알림 default off; 직원 space 기본 허용 없음; admin도 고정 7개 카탈로그만; 미설정/미허용은 선택·송신 금지. DM 제외.
- 기존 thread는 `thread.name`과 `REPLY_MESSAGE_OR_FAIL`; threadKey 변환·새 글 fallback·다른 space 재송신 금지. human thread/webhook dedupe는 실제 테스트 전 미검증이다.
- polling/bridge는 at-least-once 입력으로 취급한다. CAS·stable action/event ID·receipt로 중복 효과를 막되 provider exactly-once를 보장하지 않는다. unknown은 자동 retry하지 않고 증거 기반 manual reconcile한다.
- `40001`은 실제 concurrency collision에만 사용한다. 업무 충돌 `23514/55000`, 권한 `42501`, 입력 `22023`, bot 미인증 `28000`의 final-definition pgTAP 증거를 남긴다.
- 기존 class/calendar scope·private verifier·credential을 확대하지 않는다. 직원 본문/답변/sourceReference는 권한 승인 증거가 아니다.
- 공개사이트, 기존 dirty 파일, `.github/workflows`, CI 공용 runner/verifier, 기존 bridge/CLI, retired `/admin/approvals`는 이 작업의 수정 범위가 아니다.
- credential/grant 발급, env/webhook 등록·생성, scheduler 활성화, hosted SQL 설치·ACL, 실제 외부 작업·발송은 구체적인 대상·내용의 action-time 승인 후 실행한다. 일반 source publication/merge/deploy의 권한과 SQL-before-main 순서는 아래 현재 release 계약을 따른다.

일반 source push/PR merge/deploy는 parent/controller가 gates 이후 진행하도록 승인했다. 순서는 accepted branch source/preview + CI/whole-branch gates → exact hosted SQL 설치·ACL action-time 승인 → 여섯 개의 고정된 AI migration을 정렬 순서대로 설치하고 최종 schema/RPC/ACL 호환성을 읽기 전용으로 확인 → protected main merge/production app build다. main의 Supabase workflow는 isolated validation이며 hosted SQL push가 아니다. 문서화된 Vercel main production build는 자동이므로 SQL 호환성 확인이 먼저다. 실제 hosted target·pending migration ledger·Vercel project/environment·복원 artifact는 미확정이다. 보안 SQL 설치, credential/grant, secure webhook/config, scheduler와 live Chat에는 각각 정확한 대상의 action-time 확인을 유지한다.

설치 기본값은 support `issuance_enabled=false`, Chat runtime flag OFF, origin null, 7 slots unconfigured, 직원 permission `[]`, domain registry empty/disabled다. `issuance_enabled=false`는 새 credential create만 차단하며 기존 키·송신의 kill switch가 아니다. 중지는 exact worker stop, runtime OFF + 검증된 configuration sync, credential/grant revoke, 필요 user policy clear를 각각 수행하고 audit/receipt/attempt를 보존한다. 요청 메뉴·직원 RPC 자체에는 deployment flag가 없다.

## Review Focus

1. 계정/역할 변경 중 늦게 도착한 관리자 read/write 응답이 새 직원 rows·오류·toast·초안 clear에 섞이지 않는다 — Task 4 deferred-response 테스트.
2. 질문 답변과 cancel/claim이 경합하거나 첫 claim 응답이 유실되어도 답변은 보존되고 처리권·effect는 하나다 — Task 2 실제 2-session probe 및 live nonce replay.
3. 외부 행동 dispatch 뒤 crash/만료/취소가 발생하면 결과 기록은 남기고 unknown을 재실행·done/resume하지 않는다 — Task 2 action lifecycle 테스트.
4. space 권한 회수·설정 제거·multibyte text·provider 응답 mismatch가 완료 결과를 없애거나 비밀을 노출하지 않는다 — Tasks 3/5 DTO·byte·outbox 테스트.
5. bridge event 재수신·credential 교체·없는/cross-space thread가 중복 답글이나 새 root 글을 만들지 않는다 — Task 5 stable source dedupe 및 Task 7 승인된 thread 증거.

---

## 역사적 실행 시작점과 파일 소유

구현 시작점은 통합 소유자가 지정한 검증된 운영 C20 **`8dcf4595181fb5615df7a5556e9202eff87be031`**이다. 통합 소유자 전달 기준 PR90 `cf883a9e`는 SQL static 검증만 통과했고 DB startup/RPC contract 검증이 미완료이므로 새 기능 시작점으로 사용하지 않는다. 이는 소유자 보고이며 이 문서 작업에서 운영 DB·PR90 검증을 실행한 결과가 아니다. 오래된 원본 main이나 진행 중 CI checkout에서 구현하지 않는다.

계획 승인·실행 방식 선택 후, **Task 1 이전**에 위 C20 SHA에서 같은 Mac의 관리되는 별도 worktree/branch를 만든다. 시작점·HEAD·clean 상태와 migration baseline/manifest 규격을 evidence에 기록하고 해당 source의 AGENTS/DESIGN·의존 버전·auth 최종 함수·공용 DB runner interface를 대조한다. CI/manifest는 통합 소유자에게 유지한다. 원격 통합 기준은 PR90의 DB startup/RPC contract까지 검증하고 병합한 뒤 parent와 소유자가 지정한 정확 SHA로 갱신한다. 그 합류 시점에 auth·migration·runner·shared 파일 diff와 필요한 checks를 재검토하며 미검증 PR90 tip을 중간 base로 가져오지 않는다. 당시에는 계획·실행 방식 승인 전이었다. 현재 isolated 구현은 완료·수용되었으며 이 시작점 기록을 새 통합 HEAD로 오해하지 않는다.

새 migration은 CLI `migration new`로 생성한다. 날짜 prefix는 실행 시 부여되므로 아래 `_*.sql`은 suffix 소유만 의미한다. CI 소유자와 신규 ordered file/hash/status append를 조율하고 기존 final migration, capture/baseline hash를 재생성하지 않는다. 새 test/probe suite 목록을 전달하되 CI workflow·공용 runner는 그 소유자가 연결한다. 작업 중 shared 파일을 다른 작업이 바꾸면 원본을 덮지 않고 새 기준에서 필요한 diff를 재검토한다.

| 소유자 | 파일 범위 | 합류 조건 |
| --- | --- | --- |
| 이 기능 구현자 | `src/features/ai-agent/`, `src/features/chat/server/`, 새 AI/Chat routes, AI SQL/test/probe/QA와 아래 제한적 메뉴·설정 연결 | 각 Task tests와 독립 review |
| 이 delegated 문서 작업 | 이 plan 및 `2026-10-03-ai-agent-requests-{design,api-db-appendix}.md` 두 spec | 원본 트리에 추가된 로컬 문서 3개만. 다른 dirty 파일 보존 |
| CI 통합/PR90 소유자 | `.github/workflows`, 공용 isolated runner/manifest-loader·baseline 관리 | 신규 migration/test/probe 목록 및 no-send 계약 전달 |
| Muse | 기존 bridge/CLI, 비밀 주입, polling 운영 연결 | Tasks 6/7의 승인된 설정·안정적인 event ID·claim lifecycle 계약 |

추천은 동일 Mac 격리 branch에서 **Subagent-driven** 방식으로 다음 Task를 순차 실행하는 것이다. task마다 새 구현자와 독립 reviewer를 두되 동일 파일을 동시에 수정하지 않는다. Native 방식도 같은 gates·검증을 유지한다. 구현 순서는 DB/권한 → API/상태/중복 방지 → UI → Chat adapter/설정 → Muse 종단 검증이다.

## 공유 인터페이스

아래는 작성할 계약이며 아직 존재하지 않는다. Task 1의 `ai-agent-request-contract.ts`에서 DTO와 Zod strict schemas를 정의하고 다른 Task는 이를 import한다.

| 인터페이스 | 정의·소비 |
| --- | --- |
| `AiRequestStatus`, `AiRequestDto`, `AiRequestDetailDto`, `AiRequestListDto`, `AiSpaceDto` | 승인 부록의 공개 allowlist. `version`은 bigint의 decimal string, 일반 DTO에 nonce/token/hash/secret URL 없음 |
| `aiCreateRequestSchema`, `parseAiRequestDetailDto(value:unknown):AiRequestDetailDto` | strict 생성 body와 strict 상세 DTO 검증. 나머지 list/space DTO도 같은 Task 1 contract에서 검증 |
| `AiWriteHeaders` | `{idempotencyKey:string,expectedVersion?:string,claimToken?:string,claimGeneration?:string}`. 직원 client에는 claim 필드 없음 |
| `AiPrincipal` | `{kind:"user",userId,role}` 또는 `{kind:"bot",tokenHash}`. bot 권한의 최종 판단은 gateway DB 내부 |
| `AiRpc` | `(name:string,input:Record<string,unknown>) => Promise<{data:unknown,error:unknown}>`; server의 고정 RPC 이름/operation만 사용 |
| `createAiAgentRouteHandler(deps)` | `(request:Request,route:AiRoute) => Promise<Response>`; deps의 user auth·user RPC·bot RPC를 주입해 실제 handler를 테스트 |
| `createAiAgentRequestService({getAccessToken,fetch?,timeoutMs?})` | `list/get/create/appendMessage/cancel/resume/listSpaces/getSpacePermissions/setSpacePermissions`를 공개 DTO로 반환. 직원 session만 사용 |
| `createChatSendHandler(deps)` | `(request:Request) => Promise<Response>`; DB-authorized intent/attempt를 소비하고 injected transport의 고정 target만 호출 |
| `dispatchGoogleChat({target,intent,signal,fetch})` | `Promise<ChatTransportOutcome>`; 성공 resource names, definite failure, ambiguous outcome을 분리. `target`은 server-only 카탈로그에서만 생성 |

## Task 1: private 저장 구조와 목적별 인증·권한

**Files:** Create `src/features/ai-agent/ai-agent-request-contract.ts`; CLI 신규 `_ai_agent_requests.sql`, `_ai_agent_scoped_credentials.sql`; `supabase/tests/ai_agent_requests_authz_test.sql`, `ai_agent_credentials_test.sql`; `scripts/run-ai-agent-local-db-qa.mjs`, `tests/ai-agent-local-db-runner.test.mjs`, `tests/ai-agent-request-contract.test.mjs`.

**Interfaces:** Produce `public.ai_agent_user_api_v1(p_action text,p_input jsonb)` authenticated-only와 `public.ai_agent_bot_api_v1(p_token_hash text,p_action text,p_input jsonb)` service-only. 새 `create_ai_agent_credential_v1(p_label text,p_scopes text[],p_grant jsonb,p_expires_at timestamptz)`, `list_ai_agent_credentials_v1(p_page integer,p_page_size integer)`, `revoke_ai_agent_credential_v1(p_id uuid)`는 active admin/해당 issuer만 허용한다. 실제 발급 호출은 Task 6 전 금지한다.

- [ ] **1. 권한 fixture/test 작성.** 각 active staff/teacher/assistant는 own create/list/get 허용, other ID는 404, admin만 all, viewer/deleted/banned/missing profile은 거부를 assert한다. 실제 append/cancel 전이는 Task 2에서 같은 역할별로 검증한다. anon/service_role 직접 table 접근과 user RPC 대리 actor 입력은 거부한다. bot class credential·미승인 queue/scope·expiry/revoke·issuer role 상실은 거부하며 raw token은 발급 응답 외 저장/조회에 나타나지 않는다.
- [ ] **2. 실패 확인.** `node --test --experimental-strip-types tests/ai-agent-request-contract.test.mjs tests/ai-agent-local-db-runner.test.mjs`와 신규 AI runner `--plan --suite auth`로 없는 계약/파일이 실패하는지 확인한다. DB test 실패 확인은 manifest가 CI 소유 규격에 등록된 뒤 loopback 임시 DB에서만 한다.
- [ ] **3. 최소 저장/권한 구현.** 부록의 private request/message/event/claim/receipt·별도 AI credential/grant/space-permission 테이블, index, RLS, 직접 접근 revoke를 만든다. SECURITY DEFINER는 고정 search_path와 explicit active/ownership 검사를 사용한다. 새 issuer는 5개 AI/Chat scope allowlist, 명시 queue/action/space/purpose·expiry, default 1일·최대 30일·issuer active key 최대 20개를 제한한다. 기존 class 발급·목록·verifier는 수정하지 않는다.
- [ ] **4. 실제 경계 검증.** 새 얇은 runner는 공용 `runIsolatedSupabaseDbTests`를 호출한다. `--suite auth`는 위 2개 pgTAP만, `--suite all`(기본)은 Task 2까지의 4개 pgTAP과 probe를 선택하는 고정 allowlist다. 운영 env/credential·webhook·scheduler를 주입하지 않고 DB/probe는 loopback disposable project/nonce만 허용한다. `--plan`은 무변경; `--execute`는 선택한 AI pgTAP/probe·final migration·lint만 실행한다. remote/linked options를 받지 않고 종료 cleanup 실패도 실패로 반환한다. 합성 SQL fixture는 auth.users/profile부터 생성한다.
- [ ] **5. 통과와 commit.** Node contracts 및 `node scripts/run-ai-agent-local-db-qa.mjs --suite auth --execute --request-id ai-agent-local-auth-01`에서 pgTAP/DB lint 성공을 기록한다. 이 runner 명령은 구현 후에만 존재한다. 구현 파일·테스트·신규 migration만 stage해 `feat: add private AI request authorization`으로 commit하고 review한다.

Node test 이름/핵심 assertion:

```ts
test("create rejects a caller-selected requester", () => {
  assert.equal(aiCreateRequestSchema.safeParse({
    title: "수신 확인", body: "합성 테스트", notifyOnDone: false,
    requester: "00000000-0000-4000-8000-000000000001",
  }).success, false);
});
```

pgTAP cases는 `staff owns only`, `teacher owns only`, `assistant owns only`, `admin reads all`, `viewer rejected`, `revoked bot rejected`의 description과 실제 RPC 반환/SQLSTATE를 assert한다. 모든 fixture는 `.invalid` 합성 계정이다.

## Task 2: 상태·claim·질문 재개·effect journal·outbox 트랜잭션

**Files:** CLI 신규 `_ai_agent_request_lifecycle.sql`, `_ai_agent_chat_outbox.sql`; `supabase/tests/ai_agent_requests_transition_test.sql`, `ai_agent_chat_outbox_test.sql`; `tests/probe-ai-agent-claim-concurrency.mjs`. Task 1에서 확정한 migration은 수정하지 않고 후속 migration에서 최종 writer를 정의한다.

**Interfaces:** Consume Task 1 RPC/auth contract. Produce DB operations `claim/renew/progress/question/done/cancel/append_message/resume/register_action/start_action/record_action/reconcile_action` 및 `chat_outbox/list/prepare_attempt/record_attempt`. 내부 action/outbox own revision을 요청 업무 version과 구분한다. `ai_agent_chat_api_v1(p_token_hash text,p_action text,p_input jsonb)`는 service-only로 Chat scope·space/purpose grant를 검사한다.

- [ ] **1. 실제 전이·경합 test 작성.** active staff/teacher/assistant 각 own append/cancel 허용·other 거부와 admin all을 실제 writer로 확인한다. 두 bot pending claim 중 1개만 성공, answer→pending+message+question close 원자성, stale 409와 정확 SQLSTATE, answer/cancel·done/cancel의 먼저 commit 승리를 assert한다. 순번 audit 수정·삭제 거부, 동일 key/payload replay 추가 effect 0·다른 payload 409, lost claim 응답의 live nonce replay·expired generation 거부를 포함한다.
- [ ] **2. effect/outbox test 작성.** started 전 action 등록·권한 재검증 필요, request cancel은 prepared만 취소, started/unknown은 증거가 남고 done/resume 거부를 assert한다. 늦은 결과는 기존 action append만 가능, 자유 답변/confirmed만으로 reconcile 거부. completion commit rollback에는 outbox 0, done commit에는 고정 intent 1, notification config 제거에는 done 유지+미송신 사유를 assert한다. 기존 notification event/delivery 전후 counts도 같다.
- [ ] **3. 실패 확인 후 상태 writer 구현.** 요청 행 잠금·고정 lock 순서·CAS·hash nonce/generation·lease·rate·receipt를 한 DB transaction에 묶는다. GET은 claim/만료 처리를 하지 않는다. prepared/start/result audit는 append-only이고 시작 직전에 scope·queue·requester domain permission·target/hash·claim·cancel을 재검사한다. read-only 조사에는 변경 action이 필요 없다.
- [ ] **4. 불명확한 effect 복구 구현.** unknown은 자동 retry하지 않는다. admin reconcile은 기존 domain operation receipt 또는 구체적인 manual observation을 target/hash에 결합한다. 관찰과 서버 대조 증거를 구분한다. 현재 지원되지 않은 변경 action 종류는 deny하는 registry 경계를 둔다. 최초 실제 업무 종류·허용 대상·domain adapter는 Task 6에서 명시적으로 확정하기 전 활성화하지 않는다.
- [ ] **5. poll/outbox 중복 방지 구현.** pending은 매 실행 첫 페이지 `(ready_at,id)`부터 읽으며 answer 재개를 created watermark로 누락시키지 않는다. completion unique event/space 및 stable bridge source/event unique를 둔다. credential 교체로 bridge dedupe namespace가 바뀌지 않는다. append-only attempt와 projection, sending→unknown 복구, 취소·space 회수·DB budget을 정의한다. request generation 종료와 old-result append 권한을 분리한다.
- [ ] **6. 통과와 commit.** `node scripts/run-ai-agent-local-db-qa.mjs --execute --request-id ai-agent-local-races-01`로 4개 AI pgTAP과 probe를 실행한다. probe는 built-in Node·docker psql 2-session checkpoint를 사용하고 별도 dependency/공용 runner 변경 없이 stage 가능해야 한다. domain error를 `40001`로 위장하지 않았는지 final definitions를 검토한다. `feat: add durable AI request lifecycle` commit 후 review한다.

probe의 `two claimers produce one live claim`은 첫 writer가 request lock을 잡은 checkpoint 뒤 둘째 writer를 시작한다. commit 뒤 실제 counts를 읽어 다음을 assert한다. `answer/cancel first commit wins`, `done/cancel first commit wins`도 같은 checkpoint 방식이며 단순 동시 Promise로 대체하지 않는다.

```ts
assert.equal(liveClaims, 1);
assert.equal(claimEvents, 1);
assert.equal(successfulClaimers, 1);
assert.equal(loserSqlstate, "55000");
assert.equal(oldNotificationCountAfter, oldNotificationCountBefore);
```

claim 경합의 domain code는 `ai_agent_conflict`, SQLSTATE는 `55000`으로 고정한다. constraint 입력의 `23514`와 실제 `40001`은 별도 의미다.

## Task 3: 직원·bot API와 strict HTTP 계약

**Files:** Create `src/features/ai-agent/server/{ai-agent-auth,ai-agent-repository,ai-agent-routes,ai-agent-production,ai-agent-space-policy-route}.ts`; `tests/ai-agent-request-routes.test.mjs`, `ai-agent-request-auth.test.mjs`. Create routes `src/app/api/ai-agent/requests/route.ts`, `requests/[id]/route.ts`, `requests/[id]/messages/route.ts`, `requests/[id]/resume/route.ts`, `requests/[id]/actions/route.ts`, `requests/[id]/actions/[actionId]/route.ts`, `requests/[id]/actions/[actionId]/reconcile/route.ts`, `src/app/api/ai-agent/spaces/route.ts`, `space-permissions/[userId]/route.ts`.

**Interfaces:** Consume Tasks 1/2 DTO/RPC operations. Implement `createAiAgentRouteHandler`; route files pass server-selected `AiRoute`, never caller action/RPC/actor. User auth uses Bearer `auth.getUser` and authenticated `current_dashboard_role`; DB rechecks active account. Bot uses exact opaque format→SHA-256→new private gateway, not existing v2 health.

- [ ] **1. handler test 작성.** real handler with injected auth/RPC에 anonymous/viewer/fallback, teacher/assistant own, staff other, admin all, existing class scope bot, duplicate query, page/cursor 혼합, body actor/status injection, JSON 128 KiB 초과, missing If-Match/Idempotency-Key, nonce leakage를 넣고 status·RPC call count·payload allowlist를 assert한다. GET list/detail은 DB write 0이다.
- [ ] **2. 실패 확인.** `node --test --experimental-strip-types tests/ai-agent-request-auth.test.mjs tests/ai-agent-request-routes.test.mjs`가 미구현 handler 때문에 실패하는지 확인한다.
- [ ] **3. handler/production 연결 구현.** 직원에는 authenticated client RPC만, bot에는 server service RPC만 주입한다. 고정 오류 code/HTTP mapping, bounded JSON, safe DTO projection, no-store/private/Vary/nosniff를 사용한다. raw exception/provider payload·token/hash/claim nonce를 log/response에 노출하지 않는다. runtime 미설정·권한 조회 실패는 fail closed이다.
- [ ] **4. API 정책 검증.** outbox/config 권한 실패를 요청 완료 실패로 바꾸지 않는 DTO, payload/claim replay mismatch, late-result 최소 append와 request mutation 거부를 real DB producer DTO→HTTP consumer parser로 검증한다. question/result nonempty 및 정해진 size를 실제 boundary 입력으로 검사한다.
- [ ] **5. 통과와 commit.** 신규 Node tests, `pnpm lint`, `pnpm build`를 실행한다. 기존 agent/API 관련 tests도 통과시켜 private auth gate가 유지됨을 기록한다. `feat: expose scoped AI request APIs` commit 후 review한다.

`missing version never reaches a domain writer` 테스트는 실제 handler에 유효 employee auth와 idempotency key, `PATCH {status:"cancelled"}`를 주되 If-Match를 생략한다.

```ts
assert.equal(response.status, 428);
assert.equal(domainWriteCalls.length, 0);
assert.equal(response.headers.get("cache-control"), "no-store, private");
```

## Task 4: 사이드바·요청 목록·작성·상세·관리자 공간 정책 UI

**Files:** Create `src/app/admin/ai-agent/page.tsx`, `[id]/page.tsx`; `src/features/ai-agent/{ai-agent-request-workspace,ai-agent-request-create-dialog,ai-agent-request-detail,ai-agent-request-activity,ai-agent-space-policy-settings}.tsx`; `src/features/ai-agent/{ai-agent-request-access,ai-agent-request-service,ai-agent-request-attempt,use-ai-agent-requests}.ts`. Modify `src/lib/navigation.ts`, `src/lib/auth-utils.ts`, `src/providers/auth-provider.tsx`, `src/components/{app-sidebar,command-search}.tsx`, `src/components/auth/auth-guard.tsx`, `src/features/agent-api/agent-access-workspace.tsx`. Create `tests/ai-agent-request-{access,service,workspace,draft-navigation}.test.mjs`, `ai-agent-navigation.test.mjs`, `scripts/qa/ai-agent-requests-browser.mjs`, `scripts/qa/ai-agent-requests-fixture-server.mjs`.

**Interfaces:** Consume Task 3 APIs. `resolveAiAgentRequestAccess({role,isFallbackRole,loading}) -> {canUseRequests,canViewAll}` gives own to staff/teacher/assistant and all to admin only after resolution. Implement Task 1 DTO-based service and `useAiAgentRequests` with actor-keyed controller/dispose. Request attempt retains submitted payload+idempotency key until definite receipt and never clears newer input.

- [ ] **1. access/service/component test 작성.** 네 역할 메뉴·assistant 상세 접근·viewer/fallback 숨김, page sizes 10/15/20, requester 자동 표시·수정 불가, 열린 question만 answer, terminal append 없음, Chat off 기본·empty allowed spaces에서도 저장 가능을 assert한다. 취소/Escape/outsideclick·stale/error에서 draft 보존·focus 복귀를 검사한다.
- [ ] **2. late-response test 작성.** deferred list/detail/mutation을 old admin actor에서 시작해 계정/role을 바꾸고 resolve/reject한다. 새 화면 rows·errors·toast·draft clear에 old response가 영향을 주지 않아야 한다. successful save 뒤 작성한 새 입력도 유지한다. Back/Forward는 기존 `useDraftNavigation` 흐름을 사용한다.
- [ ] **3. 실패 확인 후 UI 구현.** `/admin/students` 표·shared toolbar/read-feedback/pager, `useDataTablePageSize("ai-agent:requests")`, FormDialogContent·Form/Input/Textarea/Checkbox/Select를 소비한다. 초안은 사용자/request/question의 메모리 scope로 분리한다. 계정/role 변경에는 기존 controller를 재생성/dispose하고 synchronous actor boundary로 old snapshot 노출을 막는다. `canManageAll/isStaff`를 신규 all/own로 재사용하지 않는다.
- [ ] **4. 제한적 메뉴·설정 연결 구현.** assistant allowlist에 `/admin/ai-agent`만 추가하고 하위 상세 경로는 기존 prefix 검사로 연결한다. 신규 feature 자체 guard와 sidebar/search capability를 같이 적용한다. AI 연결의 admin-only 알림 공간 탭에 사용자별 policy만 넣고 secret 편집/발급은 넣지 않는다. 기존 class key 목록·발급 동작은 유지한다.
- [ ] **5. 브라우저 검증.** loopback 합성 fixture와 외부 요청 차단으로 `node scripts/qa/ai-agent-requests-browser.mjs`를 실행한다. 1440×900/390×844·light/dark에서 같은 데이터/상태의 학생 표와 비교한다. 긴 본문/Q&A/audit, loading/empty/error, 알림 미설정, 표준 키보드·초점, 계정/role 변경의 screenshots와 assertions를 남긴다.
- [ ] **6. 통과와 commit.** 신규 Node tests 및 기존 auth-guard-loading/admin-shell/command-search-navigation/sidebar-focus-return/common-controls-ui/data-table-surface/data-table-pagination/numbered-page-controller/settings-draft-navigation tests, lint/build를 실행한다. 화면과 browser evidence review 후 `feat: add AI request workspace`로 commit한다. 공유 token/component의 새 시각 규칙은 이 범위에서 만들지 않는다.

`teacher and assistant receive own capability` 테스트는 pure function과 실제 메뉴/guard를 각각 검사한다.

```ts
for (const role of ["staff", "teacher", "assistant"]) {
  assert.deepEqual(resolveAiAgentRequestAccess({
    role, isFallbackRole: false, loading: false,
  }), {canUseRequests: true, canViewAll: false});
}
assert.deepEqual(resolveAiAgentRequestAccess({
  role: "viewer", isFallbackRole: false, loading: false,
}), {canUseRequests: false, canViewAll: false});
```

## Task 5: 고정 Chat adapter·durable delivery·목적별 지원 UI

**Files:** Create `src/features/chat/server/{chat-contract,chat-send-route,chat-outbox,chat-space-catalog,google-chat-transport,chat-production}.ts`; `src/app/api/chat/{send,outbox}/route.ts`; `src/features/ai-agent/ai-agent-credential-issue-dialog.tsx`; `tests/chat-send-route.test.mjs`, `chat-outbox.test.mjs`, `google-chat-transport.test.mjs`. Restrict settings integration to `src/features/agent-api/agent-access-workspace.tsx`; 신규 `_ai_agent_chat_outbox.sql`/후속 migration에는 Tasks 1/2의 준비된 Chat gateway만 완성한다.

**Interfaces:** Consume DB-authorized immutable intent/attempt DTO. Implement `createChatSendHandler` and `dispatchGoogleChat`. Completion uses `X-Chat-Intent-ID`; bridge uses `X-Bridge-Event-ID` and server grant의 stable `bridge_source_id`. Header는 정확히 하나만; body `{space,thread?,text}`는 stored purpose/target/hash와 일치해야 한다. 새 AI credential UI는 authenticated-only `ai_agent_credential_api_v1` list/create/revoke만 사용한다. credential UI의 최종 공개 경로는 authenticated-only `public.ai_agent_credential_api_v1(text,jsonb)`의 list/create/revoke다. 내부에서 active admin과 issuer ownership을 재검증하며 신규 create는 `issuance_enabled`를 검사한다. 기존 create/list/revoke helper 3개는 PUBLIC/anon/authenticated/service_role 모두 직접 EXECUTE가 revoke되었다. 요청 bot/Chat gateway, configuration sync와 bridge-grant resolver는 service_role-only이고 직원 RPC는 authenticated-only다. 최초 성공 create에서 raw token을 한 번 반환하며 receipt/replay는 token null이고 hash는 반환하지 않는다. 실제 발급·보안 주입은 별도 승인이다.

- [ ] **1. send/outcome test 작성.** intent/attempt 저장 실패·미허용 space·grant 회수·DM·cross-space/thread 누락에는 fetch 0, concurrent send에는 fetch 1, sent/repeated bridge에는 fetch 추가 0을 assert한다. credential 교체 시 같은 bridge source event도 intent 1이다. serialized multibyte payload 32,000 bytes 초과·redirect·임의 caller URL/query·원시 provider secret은 거부/제거한다.
- [ ] **2. recovery test 작성.** dispatch 후 timeout/reset/crash는 delivery_unknown, 새 automatic attempt 0. provider definite HTTP 429만 총 dispatch attempt 최대 다섯 번의 backoff+jitter, input/auth/thread 오류는 failed. stable requestId를 유지하되 webhook dedupe 미검증이면 unknown retry 금지. HTTP 성공이라도 message/thread resource 불일치·누락이면 incident/unknown이지 sent가 아님을 assert한다.
- [ ] **3. 실패 확인 후 adapter 구현.** server-only 7-slot map은 `spaceKey→실제 ID→env 참조` 구조이며 운영 ID/비밀값은 Task 6 hand-off까지 비워 둔다. allowlisted fixed Google HTTPS origin/path, redirect:error, deadline, server-selected requestId/reply option만 사용한다. 기존 validator를 느슨하게 변경하지 않는다. env 없음은 configured:false이고 요청 기능은 정상 작동한다.
- [ ] **4. durable dispatcher와 지원 UI 구현.** DB attempt commit 뒤 network call·결과 append로 분리하고 network 동안 DB lock을 잡지 않는다. pending/retry_wait만 outbox drain 대상이며 unknown은 관리자 증거 확인 대상으로 남긴다. immutable text는 제목·완료 상태·인증된 상세 링크만 포함한다. 관리자 AI credential 발급 UI는 지원 설정 승인 전 실제 발급을 하지 않고 raw secret 표시도 one-time/계정 변경 폐기 흐름만 구현·합성 검증한다.
- [ ] **5. no-send 검증과 commit.** `node --test --experimental-strip-types tests/chat-send-route.test.mjs tests/chat-outbox.test.mjs tests/google-chat-transport.test.mjs` 및 AI local DB QA를 stub transport/실제 provider 호출 0으로 실행한다. 기존 notification queue counts가 변하지 않음을 검증한다. lint/build·전체 feature review 후 `feat: add durable allowlisted Chat delivery`로 commit한다.

`ambiguous dispatch is recorded and never automatically retried`은 첫 transport fetch를 timeout으로 종료한 뒤 같은 intent/key와 다음 outbox drain을 다시 실행한다.

```ts
assert.equal(outbox.state, "delivery_unknown");
assert.equal(transportFetchCalls, 1);
assert.equal(automaticRetryCandidates.includes(outbox.id), false);
```

## Task 6: 실제 설정 hand-off 준비와 승인된 활성화

**Files:** Create `docs/operations/ai-agent-activation.md`와 secret 없는 운영 evidence. 제품 env 값·webhook URL·Muse 비밀은 문서/일반 대화/commit에 넣지 않는다. 기존 bridge/CLI/cron 파일의 소유권은 Muse에게 있다.

**Interfaces:** Consume Tasks 1–5의 API 계약·scopes·grant·space map·outbox·action registry. Produce 운영자용 exact packet: 대상 credential/만료·queue/업무 종류·space ID/수신자·env reference·scheduler·test 내용/범위·되돌리기 방법. 실행 승인은 해당 packet에만 결합한다.

- [ ] **1. 검토 가능한 설정 packet 작성.** 7개 실제 ID/label/수신자 및 사용자별 allowed spaces를 확인한다. parent가 제공한 읽기 전용 inventory에서 7개 기존 webhook의 존재를 확인했다. 실제 수신자·공간 유형(DM 제외)·secure env mapping·sender 권한은 모두 별도 확인·승인 대기이며 존재 확인을 configured/live 증거로 확대하지 않는다. 제안 AI credential의 5 scopes·queue·허용 업무·space/purpose·expiry/revoke를 정확히 열거한다. 초기 safe E2E는 합성 요청의 제목/본문 수신 확인 결과 작성만 제안하며 외부 업무 변경을 포함하지 않는다. 이 제안 자체를 송신 승인으로 간주하지 않는다.
- [ ] **2. Muse 연결 계약 준비.** 30분 새 poll은 pending 첫 페이지 및 outbox를 각각 drain, claim nonce private lifecycle·5분 renew·질문 answer 재개·late-result append·same key receipt 복구를 사용한다. 기존 bridge 운영시간/watermark는 유지하고 원본 message.name/thread.name·stable bridge identity를 전달한다. action-time approver 검증 없이 자유 입력으로 신규 도메인 변경을 시작하지 않는다.
- [ ] **3. 실제 업무 범위 확정.** 실제로 허용할 첫 업무 종류·대상·requester domain permission·기존 API scope/operation receipt 연결을 구체적인 adapter contract로 검토한다. 지원하지 않는 종류는 계속 deny한다. read-only 확인은 이 결정 없이도 safe test로 사용할 수 있다. 범위 밖 변경은 별도 승인 대상으로 준비한다.
- [ ] **4. 설정 승인 후에만 활성화.** parent가 위 packet의 새로운 지속권한, server env/webhook 설정, scheduler 활성화와 hosted SQL 설치·ACL을 각 대상 기준으로 승인받는다. 일반 source publication/merge/deploy는 이미 승인된 gates와 SQL-before-main 순서를 따른다. 이미 승인된 범위는 다시 묻지 않는다. Muse/운영자는 승인된 secret 경로로 주입하고 일반 대화에는 configured/receipt ID만 반환한다. 6개 webhook을 자동 생성하지 않는다. 미승인 항목은 disabled로 남긴다.
- [ ] **5. readiness 기록.** prod 적용·설정 결과와 로컬 test 성공을 구분하고 단순 source/env 존재를 운영 성공으로 표시하지 않는다. runtime OFF + 검증된 config sync/worker stop/credential·grant revoke/space permission revoke를 각각 점검한다. issuance OFF만으로 기존 키·송신을 중지했다고 판단하지 않는다. 승인받은 항목별 evidence·범위·만료와 remaining unknown을 activation 문서에 기록한다.

## Task 7: Muse 실제 종단 검증과 최종 수용

**Files:** Create `docs/reviews/2026-10-03-ai-agent-requests-acceptance.md`(실제 실행 날짜가 다르면 그 날짜로 생성); Task 6 activation record를 갱신한다. 실제 업무/Chat 호출은 승인 범위 안에서만 수행한다.

**Interfaces:** Consume 활성화된 approved credential·queue·space·safe test packet과 Muse connection. Produce secret 없는 request/event/action/attempt/message/thread IDs, 정확한 provider 결과·화면 evidence, 실패 시 안전한 중지와 unresolved 목록.

- [ ] **1. 실제 test 승인 확인.** exact safe request 내용·대상 계정·space·수신자·기존 human thread·없는 thread negative test 범위를 준비해 parent가 action-time 승인을 확보한다. 현재 기존 관리팀 webhook 사용 사실만으로 승인된 것으로 간주하지 않는다.
- [ ] **2. safe 1건 실행.** 요청 생성 → Muse poll → CAS claim → 합성 read-only 수신 확인 → PATCH done → completion outbox → Chat 발송을 연결한다. request/result/상태·attempt·message resource로 성공을 증명한다. 내부 구현 완료만으로 이 완료조건을 충족했다고 쓰지 않는다.
- [ ] **3. 원래 thread 및 failure 검증.** 승인된 human thread 답글 성공을 actual provider evidence로 확인한다. 없는 thread는 failed이고 root message 0, cross-space는 외부 fetch 0이어야 한다. 실제 root 확인에 권한/도구가 없으면 불확실성을 남겨 완료 판정을 보류한다. webhook arbitrary-thread 미지원이면 새 글 fallback 없이 차단하며 다른 credential/auth 방식을 임의 생성하지 않는다.
- [ ] **4. 반복·중단 결과 점검.** 같은 event/key 재호출은 중복 새 message를 만들지 않고 기록을 반환한다. ambiguous outcome은 unknown과 manual reconcile로 남긴다. unsafe provider failure를 일부러 만들거나 dedupe 시험을 추가하는 것은 승인된 negative 범위에 있을 때만 한다. webhook requestId dedupe를 시험하지 않았다면 미검증 상태를 유지한다.
- [ ] **5. 최종 review·전달.** 격리 branch의 tests·DB final SQLSTATE/ACL·browser evidence·실제 provider 결과를 각각 기록하고 whole-branch 독립 review를 받는다. 필요 source 합류는 parent/CI 소유자의 최신 검증 SHA 기준으로 재검토한다. PR 생성·merge/배포는 그 단계의 권한으로 진행하며 생성한 PR은 task에 attach한다. blockers가 있으면 기능/설정/실제 전달의 완료 범위를 분리해 보고한다.

## 검증 명령·승인 gate

새 AI runner는 C20의 `scripts/run-isolated-supabase-db-tests.mjs`를 소비하는 얇은 adapter다. PR90 합류 후 확정 API와 대조한다. 아래 공용 명령은 당시 **신규 파일·ordered migration manifest 합류 후** 검증 계획의 역사적 예시다. 최종 등록은 CI 소유자가 수행했다. 현재 full common DB acceptance는 완료하지 않았고 승인된 별도 실행 receipt로만 판정한다.

```sh
node scripts/run-isolated-supabase-db-tests.mjs \
  --review-head --require-final --lint --execute --authorized \
  --request-id ai-agent-local-20261003-01 \
  --test supabase/tests/ai_agent_credentials_test.sql \
  --test supabase/tests/ai_agent_requests_authz_test.sql \
  --test supabase/tests/ai_agent_requests_transition_test.sql \
  --test supabase/tests/ai_agent_chat_outbox_test.sql \
  --probe tests/probe-ai-agent-claim-concurrency.mjs
```

`--authorized`는 disposable local QA 실행 표현이며 production credential/grant·외부 발송 권한을 뜻하지 않는다. 검증 범위는 구현→local DB→UI/browser→운영 설정→provider 순서로 확장한다. 통과 후 같은 검사를 이유 없이 반복하지 않는다.

| Gate | 필요한 결과 | 다음 단계 |
| --- | --- | --- |
| A | 사용자 계획 검토 + 실행 방식 선택 | 지정된 C20 `8dcf459…`에서 격리 worktree, Tasks 1–5 |
| B | DB/RPC/API/UI/Chat no-send 검증·독립 review | Task 6의 구체적인 설정 packet 준비 |
| C | 새 지속권한·실제 설정·활성화 승인 | 해당 대상만 Muse/운영자 hand-off 및 readiness |
| D | safe test 내용·수신자·thread/negative 범위 승인 | Task 7 실제 1건/답글 검증 |

## 자체 검토 기록

2026-10-03: 작성자가 승인 spec 전체를 다시 대조했다. UI/역할·질문 재개는 Tasks 1–4, CAS/취소/receipt/effect journal은 Task 2, private auth/strict API는 Tasks 1/3, outbox·space·SSRF/thread는 Tasks 2/5, secret hand-off·업무 허용 범위는 Task 6, 실제 완료 증거는 Task 7에 연결했다. Review Focus 5개마다 소유 Task와 구체적인 실패 입력/assertion을 명시했다. 공통 인터페이스 이름·DTO·헤더·역할·lease/rate/size 값은 부록과 일치한다. 독립 자료조사는 기존 runner/UI 연결 근거에만 사용했으며 plan self-review는 위임하지 않았다.

written spec self-review에서도 staff-only 가정을 제거하고 사용자 승인 역할을 확정했다. bridge credential 교체에 따른 중복을 막는 stable source ID와, 기존 class key 화면/게이트를 유지하는 별도 AI private credential 저장소를 명시했다. 실제 업무 종류·7개 수신 공간/설정·provider 검증은 미확정 운영 항목으로 남겼고 구현 단계 승인과 섞지 않았다. 당시 2026-10-03 문서 작성 작업은 이 plan과 두 spec뿐이며 제품 코드·DB·외부 설정·발송을 수행하지 않았다. 2026-10-04 갱신은 accepted Tasks 1–5와 현재 통합 QA 수준을 반영하며 운영 활성화·발송을 수행하지 않는다.

2026-10-04 worker 계약 확인: GET detail은 nullable `nextMessageSeq`/`nextEventSeq`를 각각 `afterMessageSeq`/`afterEventSeq` query로 전달하며 최대 50개씩 두 흐름을 모두 null까지 drain한다. 요청 DTO의 `readyAt`은 queue-ready 시각으로 answer/admin resume에서 갱신되며 createdAt이 아니다. claim replay는 최초 If-Match version/key/nonce를 그대로 유지한다. 이후 renew/progress/question/done은 반환된 decimal `X-Claim-Generation`과 현재 request version을 사용한다. renew는 lease/audit만 바꾸고 업무 version/updatedAt을 바꾸지 않는다. provider의 definite HTTP 429만 retry_wait 대상이며 최대 **총 다섯 번의 dispatch attempt**다. 지연은 `2^attemptCount`초 + intent별 deterministic jitter [0,1)이고 반환된 readyAt을 따른다. API 429만으로 retry_wait 전이를 증명하지 않는다. due retry는 기존 intent ID를 `X-Chat-Intent-ID`에 넣고 immutable payload/upstreamRequestId를 유지하며 새 logical attempt UUID를 사용한다. 응답 유실 복구는 원래 key/body로 수행하고 새 fetch를 만들지 않는다. `X-Bridge-Event-ID`는 원본 message.name이며 반복 bridge-source 호출은 attempt를 만들지 않고 due existing bridge retry는 intent header를 사용한다. Chat send에는 If-Match/claim headers를 넣지 않는다.
