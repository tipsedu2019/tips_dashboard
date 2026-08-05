# Registration SOLAPI Customer Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 등록 과정의 레벨테스트 예약, 방문상담 예약, 예약 리마인드, 대기 안내, 입학신청서 알림톡을 저장된 사실로 미리 본 뒤 명시적으로 확인 발송하고, SOLAPI·운영 DB·Vercel Production을 안전하게 연결해 합성 등록 건으로 종류별 한 번씩 실제 수신까지 검증한다.

**Architecture:** 브라우저는 `messageKind`와 canonical `sourceId`만 서버에 전달한다. 서버는 등록 원천을 다시 읽어 동일 catalog로 미리보기와 provider payload를 렌더링하고, 15분 preview, 영구 dedupe outbox, provider 호출 직전의 원자적 attempt marker, 종류별 `off | verification | live` gate로 중복과 오발송을 막는다. 실제 SOLAPI 연결은 모든 로컬 provider-zero 검증과 운영 fail-closed 배포가 끝난 뒤 수행한다.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase/PostgreSQL security-definer RPC, Node test runner, pgTAP, Playwright 기반 브라우저 검증, SOLAPI Kakao Alimtalk API, GitHub Actions, Vercel Production.

**Issue:** [#6 — 등록 SOLAPI 고객 알림톡 미리보기·확인 발송](https://github.com/tipsedu2019/tips_dashboard/issues/6)

## Global Constraints

- 승인 기준 문서는 `docs/superpowers/specs/2026-08-05-registration-solapi-customer-messages-design.md`다. 이 계획과 구현이 충돌하면 승인 설계의 안전 경계를 우선하고 차이를 기록한다.
- 한 번에 한 Task만 수행한다. 구현 Task 1–9는 `RED → 최소 구현 → 집중 테스트 → 관련 회귀 → diff 확인 → 명시적 커밋 → 사용자 보고 후 멈춤` 순서를 지킨다. 운영 Task 10–19는 명시된 외부 변경 하나만 수행하고 증거를 보고한 뒤 다음 Task 전에 멈춘다.
- 사용자 소유 미추적 파일 `docs/superpowers/plans/2026-08-01-registration-notion-status-open-fields.md`는 열어 수정하거나 stage하지 않는다.
- 기존 migration, quarantine SQL, 과거 `ops_registration_messages` 행은 수정·backfill·삭제하지 않는다. 이 기능은 최신 migration 뒤의 forward-only additive migration만 추가한다.
- 예약·대기·입학 저장과 고객 발송을 결합하지 않는다. 자동 고객 reminder/cron, SMS/LMS fallback, 실제 학생 일괄 발송, 내부 Google Chat/Web Push activation은 범위 밖이다.
- 운영 migration, 신규 네 템플릿, 전용 API key, Vercel Production env, 실제 다섯 건 발송은 Task 10–19의 순서와 gate를 통과한 뒤에만 수행한다.
- 모든 activation row의 설치 기본값은 `off`다. 실제 검증은 사용자가 만든 `SOLAPI 테스트` 합성 등록 건과 사용자 본인 번호로만 한다.
- 전체 전화번호, provider 원문 body, PF/template ID, recipient hash, API key/secret은 공개 응답·감사 테이블·로그·스크린샷에 남기지 않는다. 학생 표시명과 렌더링 본문은 권한 있는 preview 응답/UI에서만 사용하고 DB audit·서버 로그에는 저장하지 않으며, 전화번호는 끝 4자리만 반환한다.
- SOLAPI API Secret은 git, 파일, 터미널 인자/출력, 채팅, DOM 추출 결과에 넣지 않는다. Chrome의 SOLAPI 생성 화면에서 Vercel Production secret 입력란으로 직접 옮기고 즉시 임시 클립보드를 비민감 문자열로 덮는다.
- 외부 전달 exactly-once를 주장하지 않는다. 우리 시스템은 attempt marker 이후 provider 재호출을 0회로 제한하고 불명확한 결과를 `unknown`으로 잠근다.
- `unknown`과 `failed_hold`는 같은 `dedupe_key`를 영구 소유한다. 이번 범위에는 “재발송 허용” 동작이 없다.
- SOLAPI template preflight는 provider가 반환하는 승인 상태, 채널, 본문, 변수, 버튼만 검증한다. `disableSms: true`는 template 조회 응답이 아니라 catalog와 send builder의 테스트 불변조건으로 검증한다.
- `off`에서도 source가 유효하면 본문과 readiness blocker를 읽기 전용으로 보여 줄 수 있지만 auditable `previewId`는 만들지 않고 `sendAllowed=false`로 반환한다.
- 검증 후 `off`로 되돌릴 때 accepted live-test evidence는 private row에 보존한다. 최종 전환은 각 종류를 같은 합성 scope로 `off → verification → live` 순서로 다시 통과시킨다.
- 테스트 통과, 로컬 DB 상태, Git push/PR/main, 운영 migration, Vercel Production `READY`, SOLAPI template 상태, provider 접수, 실제 카카오 수신은 서로 다른 증거로 보고한다.

## Fixed Runtime Commands

아래 경로는 이 workspace에서 확인된 runtime이다. 각 Task는 기본 `node`, 고장 난 `~/.local/bin/vercel`, 임의 설치를 사용하지 않는다.

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
TASK_RUNTIME_BIN=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin
TASK_PNPM=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
TASK_SUPABASE=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase
TASK_VERCEL_CLI=/Users/hyunjun/.npm/_npx/67eb4586ca667318/node_modules/vercel/dist/index.js
```

명령 예시:

```bash
"$TASK_NODE" --test --experimental-strip-types tests/example.test.mjs
PATH="$TASK_RUNTIME_BIN:$PATH" "$TASK_PNPM" exec tsc --noEmit
"$TASK_NODE" "$TASK_VERCEL_CLI" whoami
```

## File and Responsibility Map

### New database files

- `supabase/migrations/20260805110000_registration_customer_solapi_storage.sql`
  - 두 public audit table, 두 private configuration table, constraints, indexes, RLS/revoke, 다섯 `off` seed를 설치한다.
- `supabase/migrations/20260805111000_registration_customer_solapi_message_rpc.sql`
  - canonical resolver, preview, claim, attempt marker, finalize, history, provider check/reconcile RPC를 설치한다.
- `supabase/migrations/20260805112000_registration_customer_solapi_activation.sql`
  - template receipt, activation/readiness RPC와 마지막 runtime marker `registration_customer_solapi_runtime_version() = 1`을 설치한다.
- `supabase/tests/registration_customer_solapi_messages_test.sql`
  - 실제 PostgreSQL 권한·원자성·dedupe·activation 계약을 pgTAP으로 증명한다.

### New shared and server files

- `src/features/tasks/registration-customer-message-contract.ts`
  - 브라우저에 노출 가능한 종류, 상태, readiness, preview, history, send DTO와 strict input parser를 정의한다.
- `src/features/tasks/server/registration-customer-message-auth.ts`
  - bearer session, actor profile, admin/staff 권한, service client 생성 책임을 한곳에 둔다.
- `src/features/tasks/server/registration-customer-message-catalog.ts`
  - 다섯 template의 본문, 변수, 버튼, revision, env mapping, stable checksum, `disableSms=true`를 소유한다.
- `src/features/tasks/server/registration-customer-message-source.ts`
  - DB resolver 결과를 검증하고 KST 일시·과목 정렬·대기 문구·recipient HMAC·source fingerprint를 만든다.
- `src/features/tasks/server/registration-customer-message-solapi.ts`
  - HMAC auth, template preflight, ATA payload, send/result parser, exact message lookup, provider evidence sanitizing을 구현한다.
- `src/features/tasks/server/registration-customer-message-route.ts`
  - injected dependency로 preview/history/send/check/admin state machine을 구현한다.

### New App Router files

- `src/app/api/solapi/registration/preview/route.ts`
- `src/app/api/solapi/registration/send/route.ts`
- `src/app/api/solapi/registration/messages/route.ts`
- `src/app/api/solapi/registration/check/route.ts`
- `src/app/api/solapi/registration/admin/route.ts`

각 route는 production dependency factory를 호출하는 얇은 adapter이며 business logic을 중복하지 않는다.

### New client/UI files

- `src/features/tasks/registration-customer-message-service.ts`
  - bearer token이 있는 실제 fetch client와 fixture가 구현할 공통 client interface를 제공한다.
- `src/features/tasks/registration-alimtalk-preview-dialog.tsx`
  - 다섯 종류가 공유하는 단일 controlled preview→confirm→history dialog를 구현한다.
- `scripts/verify-registration-customer-message-browser.mjs`
  - desktop/390px provider-zero flow와 접근성·network invariant를 검증한다.

### Existing files to modify

- `src/features/tasks/registration-appointment-editor.tsx`
  - 저장된 예약 뒤 예약 안내/리마인드 trigger와 dirty/save-first gate를 연결한다.
- `src/features/tasks/registration-application-track-actions.tsx`
  - 저장된 대기 상세 뒤 과목별 대기 안내 trigger를 연결한다.
- `src/features/tasks/registration-enrollment-editor.tsx`
  - 기존 직접 입학 발송/재발송 UI를 공통 dialog trigger와 admin-only recovery 상태로 바꾼다.
- `src/features/tasks/registration-track-editor.tsx`
  - 공통 dialog를 한 번 렌더링하고 세 하위 editor에 opener를 전달한다.
- `src/features/tasks/ops-task-workspace.tsx`
  - 실제/fixture client를 조립하고 구형 정적 입학 dialog와 문구 소유자를 제거한다.
- `src/features/tasks/registration-track-fixture-runtime.ts`
- `src/features/tasks/registration-track-fixtures.ts`
  - provider network가 없는 in-memory preview/outbox fixture와 완전한 waiting source를 추가한다.
- `src/app/api/solapi/registration/route.ts`
  - 구형 GET은 새 masked history로 위임하고 구형 direct POST는 preview-required로 fail-closed한다.
- `src/app/api/solapi/registration/core.js`
- `src/app/api/solapi/registration/legacy.ts`
  - 신규 UI cutover와 같은 커밋에서 provider 호출 소유권을 제거한다. 과거 DB history는 보존한다.
- `package.json`
  - 전용 browser verifier script를 추가한다.

### Tests to add or update

- Add `tests/registration-customer-solapi-db.test.mjs`
- Add `tests/registration-customer-solapi-local-db-qa.test.mjs`
- Add `tests/registration-customer-message-contract.test.mjs`
- Add `tests/registration-customer-message-catalog.test.mjs`
- Add `tests/registration-customer-message-source.test.mjs`
- Add `tests/registration-customer-message-solapi.test.mjs`
- Add `tests/registration-customer-message-route.test.mjs`
- Add `tests/registration-alimtalk-preview-dialog.test.mjs`
- Modify `tests/registration-admission-message-route.test.mjs`
- Modify `tests/notification-registration-handoffs.test.mjs`
- Modify `tests/registration-track-workspace.test.mjs`
- Modify `tests/ops-task-workspace.test.mjs`
- Modify `tests/registration-track-fixtures.test.mjs`
- Modify `tests/registration-browser-verifier-contract.test.mjs`
- Modify `tests/ops-task-verification-safety.test.mjs`

## Exact Public Contracts

### Message kinds and browser-safe DTOs

```ts
export type RegistrationCustomerMessageKind =
  | "level_test_booking"
  | "visit_consultation_booking"
  | "appointment_reminder"
  | "waiting_notice"
  | "admission_application"

export type RegistrationCustomerMessageStatus =
  | "pending"
  | "accepted"
  | "unknown"
  | "failed_hold"

export type RegistrationCustomerMessageActivationMode =
  | "off"
  | "verification"
  | "live"

export type RegistrationCustomerMessageReadinessCode =
  | "runtime_not_ready"
  | "activation_off"
  | "verification_scope_mismatch"
  | "credentials_missing"
  | "pf_missing"
  | "template_missing"
  | "template_not_verified"
  | "template_drift"
  | "source_invalid"
  | "source_dirty"
  | "duplicate_locked"

export type RegistrationCustomerMessageReadiness = {
  runtimeReady: boolean
  activationMode: RegistrationCustomerMessageActivationMode
  activationEligible: boolean
  credentialsConfigured: boolean
  pfConfigured: boolean
  templateConfigured: boolean
  templateVerified: boolean
  verifiedAt: string | null
  sourceValid: boolean
  sendAllowed: boolean
  blockers: RegistrationCustomerMessageReadinessCode[]
}

export type RegistrationCustomerMessagePreviewResponse = {
  ok: true
  previewId: string | null
  expiresAt: string | null
  messageKind: RegistrationCustomerMessageKind
  studentName: string
  recipientLast4: string
  facts: {
    subjectLabel: string
    scheduleLabel?: string
    placeLabel?: string
    waitingKindLabel?: string
    waitingDetailLabel?: string
  }
  body: string
  buttons: Array<{ name: string; type: "WL"; host: string }>
  readiness: RegistrationCustomerMessageReadiness
  latestMessage: RegistrationCustomerMessageHistoryItem | null
}

export type RegistrationCustomerMessageHistoryItem = {
  messageId: string
  messageKind: RegistrationCustomerMessageKind
  currentStatus: RegistrationCustomerMessageStatus
  confirmedAt: string
  updatedAt: string
  recipientLast4?: string
  canCheck: boolean
}

export type RegistrationCustomerMessageSendResult = {
  ok: boolean
  messageId: string
  messageKind: RegistrationCustomerMessageKind
  currentStatus: RegistrationCustomerMessageStatus
  recipientLast4: string
  confirmedAt: string
  updatedAt: string
  canCheck: boolean
  idempotent: boolean
}
```

공개 DTO에는 `recipientHash`, 전체 전화번호, template/PF/provider ID, fingerprint/checksum, raw evidence가 존재하지 않아야 한다.

### Browser client

```ts
export type RegistrationCustomerMessageTarget = {
  messageKind: RegistrationCustomerMessageKind
  sourceId: string
}

export type RegistrationCustomerMessageClient = {
  preview(
    target: RegistrationCustomerMessageTarget,
    signal?: AbortSignal,
  ): Promise<RegistrationCustomerMessagePreviewResponse>
  send(input: {
    previewId: string
    requestKey: string
  }): Promise<RegistrationCustomerMessageSendResult>
  list(
    target: RegistrationCustomerMessageTarget,
    signal?: AbortSignal,
  ): Promise<RegistrationCustomerMessageHistoryItem[]>
  check(input: {
    messageId: string
  }): Promise<RegistrationCustomerMessageSendResult>
  reconcile(input: {
    messageId: string
    resolution: "accepted" | "failed_hold"
    evidence: {
      providerMessageId?: string
      providerGroupId?: string
      statusCode: string
      statusMessage: string
      observedAt: string
      requestKeyMatched: boolean
    }
    reason: string
    requestKey: string
  }): Promise<RegistrationCustomerMessageSendResult>
  releasePreSend(input: {
    messageId: string
    reason: string
    requestKey: string
  }): Promise<RegistrationCustomerMessageSendResult>
}

export function createRegistrationCustomerMessageClient(input: {
  token: string
  fetchImpl?: typeof fetch
}): RegistrationCustomerMessageClient

export type RegistrationCustomerMessageAdminClient = {
  preflightTemplate(
    messageKind: RegistrationCustomerMessageKind,
  ): Promise<RegistrationCustomerMessageReadiness>
  setActivation(input: {
    messageKind: RegistrationCustomerMessageKind
    mode: RegistrationCustomerMessageActivationMode
    verificationTaskId?: string
    requestKey: string
  }): Promise<RegistrationCustomerMessageReadiness>
  recordLiveTestReceipt(input: {
    messageKind: RegistrationCustomerMessageKind
    messageId: string
    receivedAt: string
    requestKey: string
  }): Promise<RegistrationCustomerMessageReadiness>
}

export function createRegistrationCustomerMessageAdminClient(input: {
  token: string
  fetchImpl?: typeof fetch
}): RegistrationCustomerMessageAdminClient
```

### Dialog ownership

```ts
export type RegistrationAlimtalkPreviewDialogProps = {
  open: boolean
  target: RegistrationCustomerMessageTarget | null
  client: RegistrationCustomerMessageClient
  canSend: boolean
  canReconcile: boolean
  onOpenChange: (open: boolean) => void
  onCommitted: () => void | Promise<void>
  onWarning: (message: string) => void
}
```

`registration-track-editor.tsx`가 `target` state와 dialog를 한 번만 소유한다. 하위 editor는 다음 opener만 받는다.

```ts
onOpenCustomerMessage?: (target: RegistrationCustomerMessageTarget) => void
```

### HTTP endpoints

- `POST /api/solapi/registration/preview`
  - strict body: `{ messageKind, sourceId }`
  - 추가 키가 있으면 400 `invalid_preview_input`
  - gate `off`면 rendered read-only body/readiness를 반환하되 `previewId=null`
- `POST /api/solapi/registration/send`
  - strict body: `{ previewId, requestKey }`
  - exact replay만 같은 masked result를 반환한다.
- `GET /api/solapi/registration/messages?messageKind=...&sourceId=...`
  - 역할별 masked projection과 readiness를 반환한다.
- `POST /api/solapi/registration/check`
  - strict body: `{ messageId }`
  - 서버가 outbox의 provider identity와 원래 request key를 읽으므로 브라우저는 과거 request key를 보관하거나 받지 않는다.
  - admin/staff, attempt 뒤 15분, provider exact identity 조건을 모두 검사한다.
- `POST /api/solapi/registration/admin`
  - admin-only strict discriminated union:

```ts
type RegistrationCustomerMessageAdminAction =
  | { action: "preflight_template"; messageKind: RegistrationCustomerMessageKind }
  | {
      action: "set_activation"
      messageKind: RegistrationCustomerMessageKind
      mode: RegistrationCustomerMessageActivationMode
      verificationTaskId?: string
      requestKey: string
    }
  | {
      action: "record_live_test_receipt"
      messageKind: RegistrationCustomerMessageKind
      messageId: string
      receivedAt: string
      requestKey: string
    }
  | {
      action: "reconcile"
      messageId: string
      resolution: "accepted" | "failed_hold"
      evidence: {
        providerMessageId?: string
        providerGroupId?: string
        statusCode: string
        statusMessage: string
        observedAt: string
        requestKeyMatched: boolean
      }
      reason: string
      requestKey: string
    }
  | {
      action: "release_pre_send"
      messageId: string
      reason: string
      requestKey: string
    }
```

브라우저가 recipient hash를 읽지 않도록 activation verification scope의 hash는 서버가 `verificationTaskId`의 현재 canonical recipient에서 계산해 DB RPC에만 전달한다.

### Database RPCs

모든 mutating public wrapper는 `service_role`만 실행 가능하고 `p_actor_profile_id`의 실제 역할·task 접근권한을 다시 검사한다. base/private table direct privilege는 `PUBLIC`, `anon`, `authenticated`, `service_role` 모두 revoke한다.

```sql
public.resolve_registration_customer_message_source_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_source_id uuid
) returns jsonb

public.create_registration_customer_message_preview_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_source_id uuid,
  p_contract jsonb
) returns jsonb

public.claim_registration_customer_message_v1(
  p_actor_profile_id uuid,
  p_preview_id uuid,
  p_request_key text,
  p_contract jsonb
) returns jsonb

public.mark_registration_customer_message_attempt_started_v1(
  p_message_id uuid,
  p_claim_token uuid,
  p_dispatch_token uuid,
  p_contract jsonb
) returns jsonb

public.release_registration_customer_message_pre_send_claim_v1(
  p_message_id uuid,
  p_claim_token uuid,
  p_error_code text
) returns jsonb

public.release_registration_customer_message_pre_send_claim_admin_v1(
  p_actor_profile_id uuid,
  p_message_id uuid,
  p_reason text,
  p_request_key text
) returns jsonb

public.finalize_registration_customer_message_v1(
  p_message_id uuid,
  p_dispatch_token uuid,
  p_result text,
  p_provider_result jsonb
) returns jsonb

public.list_registration_customer_messages_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_source_id uuid,
  p_limit integer
) returns jsonb

public.record_registration_customer_message_provider_check_v1(
  p_actor_profile_id uuid,
  p_message_id uuid,
  p_resolution text,
  p_provider_evidence jsonb,
  p_request_key text
) returns jsonb

public.reconcile_registration_customer_message_v1(
  p_actor_profile_id uuid,
  p_message_id uuid,
  p_resolution text,
  p_provider_evidence jsonb,
  p_reason text,
  p_request_key text
) returns jsonb

public.record_registration_customer_solapi_template_receipt_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_receipt jsonb
) returns jsonb

public.set_registration_customer_solapi_activation_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_mode text,
  p_evidence jsonb
) returns jsonb

public.record_registration_customer_solapi_live_test_receipt_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_message_id uuid,
  p_received_at timestamptz,
  p_request_key text
) returns jsonb

public.get_registration_customer_solapi_readiness_v1(
  p_actor_profile_id uuid,
  p_message_kind text,
  p_source_id uuid,
  p_template_contract jsonb
) returns jsonb

public.registration_customer_solapi_runtime_version()
returns integer
```

`registration_customer_solapi_runtime_version()`은 `20260805112000`의 마지막 생성 객체이며 정확히 `1`을 반환한다.

## Provider Contract

### Template preflight

- Method: `GET https://api.solapi.com/kakao/v2/templates/?templateId=URL_ENCODED_TEMPLATE_ID&channelId=URL_ENCODED_PF_ID&limit=1`
- Require exactly one template.
- Require `status=APPROVED`, exact channel, exact content/variables, normalized exact buttons.
- Compute provider checksum from only those normalized fields.
- Write a private receipt only when provider checksum equals current catalog checksum.
- Do not claim that this response proves SMS fallback state.

### Send

- Method: `POST https://api.solapi.com/messages/v4/send-many/detail`
- Auth: `HMAC-SHA256 apiKey=..., date=..., salt=..., signature=...`, signature over `date + salt` using the API secret; a fresh salt per request.
- One message, `type: "ATA"`, `strict: true`, `allowDuplicates: false`, `showMessageList: true`.
- The message sets `disableSms: true` and exact catalog variables.
- The only custom field is the opaque `registrationRequestKey`.
- 2xx with accepted message/group identity is `accepted`.
- Explicit 4xx or explicit failed list is `failed_hold`.
- Network error, timeout, 5xx, or unparseable response is `unknown`.

### Exact check

- Method: `GET https://api.solapi.com/messages/v4/list`
- Query by stored provider message ID or group ID only.
- Accept evidence only when exact `customFields.registrationRequestKey` also matches.
- Never fall back to recipient, student name, time window, or rendered body.
- If no provider identity was stored, return `provider_lookup_identity_unavailable` and require admin evidence; never resend.

---

### Task 1: Install the Inert Storage Schema

**Files:**

- Create: `supabase/migrations/20260805110000_registration_customer_solapi_storage.sql`
- Create: `tests/registration-customer-solapi-db.test.mjs`
- Test: `supabase/tests/registration_customer_solapi_messages_test.sql`

**Schema contract:**

- `ops_registration_customer_message_previews` stores only IDs, revisions, hashes/checksums, last4, actor and timestamps. It enforces 15-minute expiry and source shape by message kind.
- `ops_registration_customer_messages` stores the permanent dedupe owner and operational claim/attempt fields.
- `dashboard_private.registration_customer_solapi_template_receipts` stores no message body.
- `dashboard_private.registration_customer_solapi_activation` has exactly five default `off` rows.
- Hash/checksum columns match `^[a-f0-9]{64}$`; `recipient_last4` matches four digits.
- Message status is only `pending | accepted | unknown | failed_hold`.
- `provider_attempt_count` is 0 or 1. Marker fields and terminal state constraints agree.
- `preview_id`, `dedupe_key`, `request_key` and `dispatch_token` are unique.
- Public tables have RLS enabled with no direct select policy and all direct privileges revoked.

- [ ] **Step 1: Write the failing static migration contract**

Add assertions for filenames, table names, all four kinds of constraints, indexes, RLS/revoke, five seed values, and absence of edits to older migrations.

Run:

```bash
"$TASK_NODE" --test --experimental-strip-types tests/registration-customer-solapi-db.test.mjs
```

Expected: FAIL because the storage migration does not exist.

- [ ] **Step 2: Write the failing pgTAP storage tests**

Add tests for table/column types, unique indexes, source-shape checks, invalid checksum/last4 rejection, default `off` rows, and direct privilege denial for `anon`/`authenticated`.

Do not run against a shared or production database in this Task. Confirm the SQL test is parseable through the static test.

- [ ] **Step 3: Implement the storage migration**

Use `dashboard_private.notification_sha256_hex_v1(text)` and `public.set_updated_at()` where appropriate. Add claim fields:

```text
claim_active boolean
claim_token uuid
claim_owner_id uuid
claim_expires_at timestamptz
claim_release_reason text
dispatch_token uuid
provider_attempt_started_at timestamptz
provider_attempt_count integer
resolution_source text
resolved_by uuid
resolved_at timestamptz
```

Generate `dispatch_token` at outbox claim creation, before the later attempt marker validates it.

- [ ] **Step 4: Run focused static tests**

Run the Step 1 command. Expected: PASS.

- [ ] **Step 5: Review the migration diff and immutable boundaries**

Run:

```bash
git diff --check
git status --short
git diff -- supabase/migrations/20260805110000_registration_customer_solapi_storage.sql tests/registration-customer-solapi-db.test.mjs supabase/tests/registration_customer_solapi_messages_test.sql
```

Confirm no older migration and no user-owned untracked plan appears in the staged set.

- [ ] **Step 6: Commit and stop**

```bash
git add supabase/migrations/20260805110000_registration_customer_solapi_storage.sql tests/registration-customer-solapi-db.test.mjs supabase/tests/registration_customer_solapi_messages_test.sql
git commit -m "feat: add inert registration customer message storage"
```

Report RED/GREEN evidence, commit SHA, and stop for approval.

---

### Task 2: Define the Shared Contract and Server Catalog

**Files:**

- Create: `src/features/tasks/registration-customer-message-contract.ts`
- Create: `src/features/tasks/server/registration-customer-message-catalog.ts`
- Create: `tests/registration-customer-message-contract.test.mjs`
- Create: `tests/registration-customer-message-catalog.test.mjs`

**Catalog contract:**

- Exactly five message kinds and the environment variable mapping in the approved spec.
- Four exact new Korean bodies and the existing admission body/button/link.
- KST reservation formatter, stable subject sorting, strict waiting labels, allowlisted variables only.
- Catalog revision and canonical SHA-256 for content, variables, buttons.
- `disableSms=true` is immutable in the send definition.
- Server-only env/template IDs are never exported by the browser-safe module.

- [ ] **Step 1: Write failing contract tests**

Assert exact DTO union members, strict input rejection of `phone`/`body`/`variables`/`templateId`/`pfId`, and forbidden-field absence from serialized sample responses.

- [ ] **Step 2: Write failing catalog tests**

Assert every exact body, variable name, admission button/link, KST date examples, stable `영어 · 수학 · 과학` ordering, waiting mapping, checksum determinism, and `disableSms=true`.

Run:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/registration-customer-message-contract.test.mjs \
  tests/registration-customer-message-catalog.test.mjs
```

Expected: FAIL because both modules are absent.

- [ ] **Step 3: Implement the smallest pure modules**

Do not read `process.env` at module import time. Export a factory that receives a server-only env object, so tests and preflight can prove missing configuration without exposing values.

Required server exports:

```ts
export function createRegistrationCustomerMessageCatalog(
  env: RegistrationCustomerMessageServerEnv,
): RegistrationCustomerMessageCatalog

export function renderRegistrationCustomerMessage(input: {
  kind: RegistrationCustomerMessageKind
  facts: RegistrationCustomerMessageCanonicalFacts
}): RegistrationCustomerMessageRendered

export function checksumRegistrationCustomerMessageTemplate(
  template: RegistrationCustomerMessageTemplate,
): string
```

- [ ] **Step 4: Run focused tests**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Run TypeScript and inspect the diff**

```bash
PATH="$TASK_RUNTIME_BIN:$PATH" "$TASK_PNPM" exec tsc --noEmit
git diff --check
git diff -- src/features/tasks/registration-customer-message-contract.ts src/features/tasks/server/registration-customer-message-catalog.ts tests/registration-customer-message-contract.test.mjs tests/registration-customer-message-catalog.test.mjs
```

- [ ] **Step 6: Commit and stop**

```bash
git add src/features/tasks/registration-customer-message-contract.ts src/features/tasks/server/registration-customer-message-catalog.ts tests/registration-customer-message-contract.test.mjs tests/registration-customer-message-catalog.test.mjs
git commit -m "feat: define registration customer message catalog"
```

Report and stop.

---

### Task 3: Add Canonical Source, Preview, and Outbox RPCs

**Files:**

- Create: `supabase/migrations/20260805111000_registration_customer_solapi_message_rpc.sql`
- Modify: `tests/registration-customer-solapi-db.test.mjs`
- Modify: `supabase/tests/registration_customer_solapi_messages_test.sql`

**RPC behavior:**

- Every service-role wrapper rechecks the supplied actor role and task visibility.
- Resolver uses the new workflow fields as authority; legacy waiting values are checked only when populated with an actual waiting value.
- Exact replay lookup occurs before consumed-preview rejection.
- DB computes dedupe from `messageKind + sourceId + sourceFingerprint + recipientHash`.
- Only `pending + attempt_count=0 + no marker` can release/reacquire.
- Marker moves count 0→1 exactly once and only a committed `allowed=true` result authorizes an HTTP call.
- Replay seeing `pending + attempt_count=1` atomically closes it to `unknown` and returns provider-call ownership false.
- Admission `accepted` atomically sets `ops_registration_details.admission_notice_sent=true` and writes one sanitized `customer_message_sent` event.

- [ ] **Step 1: Extend static tests to RED**

Assert all RPC signatures, strict `jsonb` key allowlists, `security definer` hardening, role grants, replay-before-consumed ordering, marker check, permanent dedupe, and admission compatibility update.

- [ ] **Step 2: Extend pgTAP to RED**

Create synthetic admin/staff/teacher/task/track/appointment facts inside the disposable test transaction. Cover:

- valid level-test, visit, reminder, waiting and admission source resolution;
- invalid/canceled/past appointment and missing participants;
- inconsistent waiting detail and legacy conflict;
- invalid phone/student/type;
- other actor and wrong task;
- preview expiry/owner/stale contract;
- exact replay, request-key conflict, consumed preview;
- two previews with one dedupe owner;
- pre-marker release/reacquire;
- marker replay to `unknown`;
- accepted/rejected/unknown finalization;
- same dedupe locked in every terminal state;
- role-masked history.

- [ ] **Step 3: Implement canonical resolver and preview RPCs**

`resolve_registration_customer_message_source_v1` may return the normalized full phone only to the service-role runtime response. It must never insert it. `create_registration_customer_message_preview_v1` compares `parentPhoneDigits` and stores only hash/last4/checksums.

- [ ] **Step 4: Implement claim, marker, finalize, history, check and reconcile RPCs**

Use row locks and unique constraints, not application-only checks. Provider evidence accepts only normalized ID/status/observedAt/request-key-match keys. Reconcile never clears the dedupe key or creates a second message.

- [ ] **Step 5: Run static tests**

```bash
"$TASK_NODE" --test --experimental-strip-types tests/registration-customer-solapi-db.test.mjs
```

Expected: PASS. pgTAP runtime execution remains Task 9.

- [ ] **Step 6: Inspect security and diff**

```bash
git diff --check
rg -n "grant .*ops_registration_customer|grant .*registration_customer_solapi" supabase/migrations/20260805111000_registration_customer_solapi_message_rpc.sql
git diff -- supabase/migrations/20260805111000_registration_customer_solapi_message_rpc.sql tests/registration-customer-solapi-db.test.mjs supabase/tests/registration_customer_solapi_messages_test.sql
```

Confirm no direct base-table grant and no raw phone/body persistence.

- [ ] **Step 7: Commit and stop**

```bash
git add supabase/migrations/20260805111000_registration_customer_solapi_message_rpc.sql tests/registration-customer-solapi-db.test.mjs supabase/tests/registration_customer_solapi_messages_test.sql
git commit -m "feat: add registration customer message state machine"
```

Report and stop.

---

### Task 4: Add Template Receipts and Activation Gates

**Files:**

- Create: `supabase/migrations/20260805112000_registration_customer_solapi_activation.sql`
- Modify: `tests/registration-customer-solapi-db.test.mjs`
- Modify: `supabase/tests/registration_customer_solapi_messages_test.sql`

**Activation contract:**

- A receipt is usable only when current template ID, PF ID and catalog checksum all match.
- Allowed state transitions are `off → verification`, `verification → live`, `verification → off`, `live → off`.
- An `off` row may retain accepted live-test evidence; it cannot authorize sends.
- Re-entering `verification` requires the same explicit task and current recipient hash.
- `record_registration_customer_solapi_live_test_receipt_v1` may run only in `verification` and stores evidence only after locking and validating an `accepted` message of the same kind, task, recipient and current template receipt.
- `live` requires a matching accepted message and user-confirmed receipt timestamp.
- All activation changes are admin-only.
- Public readiness exposes booleans/timestamps/mode/blocker codes, never allowlist IDs/hashes or provider IDs.

- [ ] **Step 1: Add RED tests**

Cover drifted receipts, wrong role, invalid transitions, verification task/recipient mismatch, live without accepted evidence, live-test receipt outside verification, accepted evidence of another kind/task/hash, idempotent receipt request keys, retained evidence while off, and runtime marker ordering/value/grants.

- [ ] **Step 2: Implement template receipt, live-test receipt, and activation RPCs**

Cross-table accepted evidence validation belongs inside the activation RPC under row locks; do not attempt a cross-table PostgreSQL CHECK constraint.

- [ ] **Step 3: Implement readiness RPC**

Return independent blockers for runtime, mode/scope, env configuration, receipt, and source. An `off` preview caller can still render source facts but cannot get a preview ID.

- [ ] **Step 4: Create the runtime marker last**

The literal last created function/object in the migration must be:

```sql
public.registration_customer_solapi_runtime_version() returns integer
```

It returns exactly `1` and grants execute only to `authenticated` and `service_role`.

- [ ] **Step 5: Run focused static tests**

```bash
"$TASK_NODE" --test --experimental-strip-types tests/registration-customer-solapi-db.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Diff, commit, stop**

```bash
git diff --check
git diff -- supabase/migrations/20260805112000_registration_customer_solapi_activation.sql tests/registration-customer-solapi-db.test.mjs supabase/tests/registration_customer_solapi_messages_test.sql
git add supabase/migrations/20260805112000_registration_customer_solapi_activation.sql tests/registration-customer-solapi-db.test.mjs supabase/tests/registration_customer_solapi_messages_test.sql
git commit -m "feat: gate registration customer message delivery"
```

Report and stop.

---

### Task 5: Implement Canonical Preview and Masked History APIs

**Files:**

- Create: `src/features/tasks/server/registration-customer-message-auth.ts`
- Create: `src/features/tasks/server/registration-customer-message-source.ts`
- Create: `src/features/tasks/server/registration-customer-message-route.ts`
- Create: `src/app/api/solapi/registration/preview/route.ts`
- Create: `src/app/api/solapi/registration/messages/route.ts`
- Create: `tests/registration-customer-message-source.test.mjs`
- Create: `tests/registration-customer-message-route.test.mjs`

**Source behavior:**

- Task must be `registration` with a nonempty display name and normalized Korean mobile matching the repo rule.
- Appointment uses exact scheduled appointment, future time, notification revision, joined active participants, and stable subjects.
- Waiting uses `workflow_status`, `workflow_revision`, `waiting_detail_kind`, `waiting_detail_class_id` and valid class name when required.
- Admission uses the same target selector as `getRegistrationAdmissionApplicationState` and blocks prior accepted/active legacy admission or `admission_notice_sent=true`.
- Recipient HMAC uses `REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER` and domain-separated input.
- Full phone exists only in the request-local server object.

- [ ] **Step 1: Write failing source tests**

Inject RPC results and a fixed clock. Cover all valid and invalid source variants, KST rendering, stable sort, recipient HMAC determinism, fingerprint change on every material source change, and no phone in logged/returned objects.

- [ ] **Step 2: Write failing preview/history route tests**

Inject auth, DB, catalog and clock. Cover strict inputs, roles, inaccessible task, gate off read-only preview, verification scope, active preview creation, expiry, latest message, teacher masking, and provider adapter call count exactly zero.

Run:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/registration-customer-message-source.test.mjs \
  tests/registration-customer-message-route.test.mjs
```

Expected: FAIL because the server modules/routes are absent.

- [ ] **Step 3: Implement auth and source modules**

Use the authenticated client to establish actor/task visibility, then service-role RPCs with the actor profile ID. Never accept actor ID, phone, template or facts from the browser.

- [ ] **Step 4: Implement injected preview/history handlers**

Expose a production factory separately from pure handlers. The thin App Router files parse request/response only. Map stable error codes to Korean UI messages in the client layer, not provider raw text.

- [ ] **Step 5: Run focused and related tests**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/registration-customer-message-contract.test.mjs \
  tests/registration-customer-message-catalog.test.mjs \
  tests/registration-customer-message-source.test.mjs \
  tests/registration-customer-message-route.test.mjs
PATH="$TASK_RUNTIME_BIN:$PATH" "$TASK_PNPM" exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Verify forbidden data and diff**

```bash
rg -n "console\\.|recipientHash|parentPhoneDigits|templateId|pfId|provider_evidence" src/app/api/solapi/registration src/features/tasks/server/registration-customer-message-*.ts
git diff --check
git diff -- src/features/tasks/server src/app/api/solapi/registration/preview src/app/api/solapi/registration/messages tests/registration-customer-message-source.test.mjs tests/registration-customer-message-route.test.mjs
```

Review each match; no secret/full phone/provider raw body may cross the public DTO.

- [ ] **Step 7: Commit and stop**

```bash
git add src/features/tasks/server/registration-customer-message-auth.ts src/features/tasks/server/registration-customer-message-source.ts src/features/tasks/server/registration-customer-message-route.ts src/app/api/solapi/registration/preview/route.ts src/app/api/solapi/registration/messages/route.ts tests/registration-customer-message-source.test.mjs tests/registration-customer-message-route.test.mjs
git commit -m "feat: preview registration customer messages"
```

Report and stop.

---

### Task 6: Implement SOLAPI Send, Check, Preflight, and Admin APIs

**Files:**

- Create: `src/features/tasks/server/registration-customer-message-solapi.ts`
- Create: `src/app/api/solapi/registration/send/route.ts`
- Create: `src/app/api/solapi/registration/check/route.ts`
- Create: `src/app/api/solapi/registration/admin/route.ts`
- Modify: `src/features/tasks/server/registration-customer-message-route.ts`
- Create: `tests/registration-customer-message-solapi.test.mjs`
- Modify: `tests/registration-customer-message-route.test.mjs`

**Attempt boundary:**

```text
claim transaction committed
  → request-local canonical re-read
  → pre-send error: release count-0 claim, exact replay allowed
  → attempt marker transaction committed
  → marker owner only: one SOLAPI HTTP call
  → accepted | failed_hold | unknown finalize
```

- [ ] **Step 1: Write failing HMAC/provider tests**

Use fixed clock/salt and fake fetch. Assert exact HMAC signature input, fresh salt, official paths/methods, no secret in thrown errors/logs, exact ATA payload, `disableSms=true`, normalized outcome mapping, template drift normalization, and exact-ID/request-key lookup.

- [ ] **Step 2: Write failing send state-machine tests**

Cover:

- stale source/recipient/template/gate before claim → provider 0;
- exact tuple replay → same masked result;
- request/preview conflict → non-disclosing 409;
- two previews same dedupe → one owner;
- preparation failure before marker → safe exact replay;
- crash/replay after marker → `unknown` and provider 0 on replay;
- accepted, explicit 4xx, failed list, timeout, 5xx, malformed body;
- `unknown`/`failed_hold` permanent lock;
- check before 15 minutes, absent provider ID, and provider response with a mismatched stored request key;
- staff check versus admin-only reconcile/release/activation;
- live-test receipt requires an accepted message matching the active verification scope and is retained after returning off;
- template preflight receipt only on exact `APPROVED` match.

Run:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/registration-customer-message-solapi.test.mjs \
  tests/registration-customer-message-route.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement the provider adapter**

Use Web Crypto or Node crypto only in the server module. Apply request timeout with abort. Sanitize provider evidence to IDs/status/error code/status message/observed time/request-key-match; never persist the raw response or exception string.

- [ ] **Step 4: Implement send/check/admin handlers and thin routes**

The handler must obtain `allowed=true` from the committed marker RPC before calling fake/real fetch. If finalization fails after the HTTP response, return `unknown` semantics and never retry the provider call in the same request. The check handler reads the original request key from the private outbox; it never requires that value from browser history.

- [ ] **Step 5: Run focused and related backend tests**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/registration-customer-message-contract.test.mjs \
  tests/registration-customer-message-catalog.test.mjs \
  tests/registration-customer-message-source.test.mjs \
  tests/registration-customer-message-solapi.test.mjs \
  tests/registration-customer-message-route.test.mjs
PATH="$TASK_RUNTIME_BIN:$PATH" "$TASK_PNPM" exec tsc --noEmit
```

- [ ] **Step 6: Diff, commit, stop**

```bash
git diff --check
git diff -- src/features/tasks/server/registration-customer-message-route.ts src/features/tasks/server/registration-customer-message-solapi.ts src/app/api/solapi/registration/send src/app/api/solapi/registration/check src/app/api/solapi/registration/admin tests/registration-customer-message-solapi.test.mjs tests/registration-customer-message-route.test.mjs
git add src/features/tasks/server/registration-customer-message-route.ts src/features/tasks/server/registration-customer-message-solapi.ts src/app/api/solapi/registration/send/route.ts src/app/api/solapi/registration/check/route.ts src/app/api/solapi/registration/admin/route.ts tests/registration-customer-message-solapi.test.mjs tests/registration-customer-message-route.test.mjs
git commit -m "feat: send registration customer messages safely"
```

Report and stop.

---

### Task 7: Build the Shared Preview Dialog and Provider-Zero Client

**Files:**

- Create: `src/features/tasks/registration-customer-message-service.ts`
- Create: `src/features/tasks/registration-alimtalk-preview-dialog.tsx`
- Modify: `src/features/tasks/registration-track-fixture-runtime.ts`
- Modify: `src/features/tasks/registration-track-fixtures.ts`
- Create: `tests/registration-alimtalk-preview-dialog.test.mjs`
- Modify: `tests/registration-track-fixtures.test.mjs`

**UI behavior:**

- Open loads only target kind/source.
- Display student, masked last4, source facts, exact rendered body, button name/host, readiness and latest status.
- Generate one client request key per logical confirm and retain it through transport retry.
- Disable confirm when no preview ID, expired, not ready, duplicate locked, loading or sending.
- `accepted` shows `SOLAPI 접수 완료 · 학부모 전화 끝 1234`.
- `unknown` shows `발송 결과 확인 필요` and only a check action.
- `failed_hold` shows `발송 실패 · 같은 내용 재발송 불가`.
- Admin-only recovery disclosure may call `reconcile` or `releasePreSend` with a required reason and structured evidence; staff never sees those controls.
- Errors use `role=alert`; success uses `role=status`.
- Dialog supports focus trap, Escape, trigger focus return, preserved newlines, long-word wrapping, and 44px controls.

- [ ] **Step 1: Write failing service/dialog source-contract tests**

Assert endpoint/method/body strictness, no phone/template/body inputs, controlled props, state labels, disabled rules, request-key retention, roles, focus/accessibility classes, and absence of direct `fetch("/api/solapi/registration")` in the dialog.

- [ ] **Step 2: Write failing fixture-ledger tests**

The fixture client must implement all five previews, accepted/unknown/failed_hold states, exact replay, duplicate lock and dirty blockers entirely in memory. Its actions must not enter the existing external/provider call ledger.

- [ ] **Step 3: Implement client and dialog**

Keep the dialog reusable and presentation-only. Do not put appointment/waiting/admission source selection inside it.

- [ ] **Step 4: Implement provider-zero fixture adapter**

Reuse:

- level test: `fixture-appointment-dual-test`
- visit: `fixture-appointment-split-visit`
- admission: `fixture-task-multiple-classes`

Add one saved waiting track fixture with complete `workflow_status` and `waiting_detail_*`. The fixture must be disabled in production.

- [ ] **Step 5: Run focused tests and TypeScript**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/registration-alimtalk-preview-dialog.test.mjs \
  tests/registration-track-fixtures.test.mjs
PATH="$TASK_RUNTIME_BIN:$PATH" "$TASK_PNPM" exec tsc --noEmit
```

- [ ] **Step 6: Diff, commit, stop**

```bash
git diff --check
git diff -- src/features/tasks/registration-customer-message-service.ts src/features/tasks/registration-alimtalk-preview-dialog.tsx src/features/tasks/registration-track-fixture-runtime.ts src/features/tasks/registration-track-fixtures.ts tests/registration-alimtalk-preview-dialog.test.mjs tests/registration-track-fixtures.test.mjs
git add src/features/tasks/registration-customer-message-service.ts src/features/tasks/registration-alimtalk-preview-dialog.tsx src/features/tasks/registration-track-fixture-runtime.ts src/features/tasks/registration-track-fixtures.ts tests/registration-alimtalk-preview-dialog.test.mjs tests/registration-track-fixtures.test.mjs
git commit -m "feat: add registration alimtalk preview dialog"
```

Report and stop.

---

### Task 8: Wire All Five Triggers and Cut Over Admission Ownership

**Files:**

- Modify: `src/features/tasks/registration-appointment-editor.tsx`
- Modify: `src/features/tasks/registration-application-track-actions.tsx`
- Modify: `src/features/tasks/registration-enrollment-editor.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `src/app/api/solapi/registration/route.ts`
- Modify or delete provider reachability from: `src/app/api/solapi/registration/core.js`
- Modify or delete provider reachability from: `src/app/api/solapi/registration/legacy.ts`
- Modify: `tests/registration-track-workspace.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`
- Modify: `tests/registration-admission-message-route.test.mjs`
- Modify: `tests/notification-registration-handoffs.test.mjs`

**Exact trigger placement:**

- `RegistrationAppointmentEditor`: immediately after `RegistrationSaveButton`, when a persisted scheduled appointment exists:
  - level test: `예약 안내 알림톡` + `리마인드 알림톡`
  - visit: `예약 안내 알림톡` + `리마인드 알림톡`
  - disable and show save-first hint while appointment/external dirty, saving, refresh pending, conflict, or no persisted appointment.
- `RegistrationWaitingDetailsEditor`: immediately after waiting save; source is `track.id`; only complete saved waiting data and `permissions.canManage`; dirty/saving/refresh-pending disabled.
- `RegistrationAdmissionPanel`: replace direct send with `입학신청서 알림톡`; source is task ID.
- `registration-track-editor.tsx`: own one target state and one `RegistrationAlimtalkPreviewDialog`; replace `admissionActions` with generic client/opener props.
- `ops-task-workspace.tsx`: instantiate the real token client or fixture client and remove `getRegistrationAdmissionSolapiMessage` plus old `RegistrationCustomerMessageDialog`.

**Single-owner cutover:**

- The root legacy route no longer calls SOLAPI.
- Legacy GET delegates to the new admission history/readiness projection for compatibility.
- Legacy POST returns a stable 409 `REGISTRATION_CUSTOMER_MESSAGE_PREVIEW_REQUIRED` without provider access.
- Remove staff-facing raw JSON reconcile and `재발송 허용`. Check is admin/staff; manual reconcile/release is admin-only in the new dialog/admin surface.
- Keep old DB functions and rows read-only; do not drop or rewrite history.

- [ ] **Step 1: Write failing workspace tests**

Assert one dialog host, exact four placement areas/five kinds, correct source IDs, role checks, dirty gates, no workflow mutation from triggers, no direct send, no duplicate admission owner, and removal of static admission copy.

- [ ] **Step 2: Write failing legacy route cutover tests**

Assert legacy POST returns preview-required with provider call count zero, legacy GET is masked, and old core/legacy code has no reachable `fetch` to SOLAPI.

Run:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/registration-track-workspace.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration-admission-message-route.test.mjs \
  tests/notification-registration-handoffs.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Wire the shared dialog through the canonical editor**

Pass only `onOpenCustomerMessage` to child editors. Preserve all current appointment, waiting and admission save behavior.

- [ ] **Step 4: Cut over admission in the same change**

Remove the old workspace dialog/direct POST consumer before making the new trigger reachable. The finished diff must never contain two active provider send paths.

- [ ] **Step 5: Run focused and registration regressions**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/registration-track-workspace.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration-admission-message-route.test.mjs \
  tests/notification-registration-handoffs.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-fixtures.test.mjs
PATH="$TASK_RUNTIME_BIN:$PATH" "$TASK_PNPM" exec tsc --noEmit
```

- [ ] **Step 6: Search for duplicate send ownership**

```bash
rg -n 'send-many/detail|sendRegistrationAdmissionMessage|getRegistrationAdmissionSolapiMessage|재발송 허용|fetch\\("/api/solapi/registration"' src tests
```

Expected: the SOLAPI send endpoint appears only in the new server adapter; old direct UI symbols are absent.

- [ ] **Step 7: Diff, commit, stop**

```bash
git diff --check
git diff -- src/features/tasks/registration-appointment-editor.tsx src/features/tasks/registration-application-track-actions.tsx src/features/tasks/registration-enrollment-editor.tsx src/features/tasks/registration-track-editor.tsx src/features/tasks/ops-task-workspace.tsx src/app/api/solapi/registration tests
git add src/features/tasks/registration-appointment-editor.tsx src/features/tasks/registration-application-track-actions.tsx src/features/tasks/registration-enrollment-editor.tsx src/features/tasks/registration-track-editor.tsx src/features/tasks/ops-task-workspace.tsx src/app/api/solapi/registration/route.ts src/app/api/solapi/registration/core.js src/app/api/solapi/registration/legacy.ts tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs tests/registration-admission-message-route.test.mjs tests/notification-registration-handoffs.test.mjs
git commit -m "feat: wire registration customer alimtalk actions"
```

If `core.js` or `legacy.ts` is deleted, stage the deletion with `git add -u` limited to `src/app/api/solapi/registration`. Report and stop.

---

### Task 9: Prove Disposable DB Atomicity and Browser Provider-Zero UX

**Files:**

- Create: `scripts/run-registration-customer-solapi-local-db-qa.mjs`
- Create: `tests/registration-customer-solapi-local-db-qa.test.mjs`
- Create: `scripts/verify-registration-customer-message-browser.mjs`
- Modify: `tests/registration-browser-verifier-contract.test.mjs`
- Modify: `tests/ops-task-verification-safety.test.mjs`
- Modify: `package.json`

**Guarded DB runner contract:**

- Default invocation prints a plan and performs no Docker, DB, network or provider action.
- Execution requires both `--execute` and `--approved-local-db`.
- URL and DB URL must resolve to loopback only.
- Reject linked/remote/production Supabase identifiers and production secrets.
- Use synthetic rows only.
- Do not start notification worker/cron/provider.
- Run pgTAP plus a two-client concurrency probe.
- Stop/remove only the exact disposable local resources it created and report cleanup evidence.

- [ ] **Step 1: Write failing runner guard tests**

Cover default dry run, missing flag rejection, non-loopback rejection, production host rejection, no provider env requirement, exact command plan and cleanup manifest.

- [ ] **Step 2: Implement the guarded runner**

Use the confirmed local Supabase CLI path. Do not read or copy production rows, credentials or provider secrets.

- [ ] **Step 3: Run disposable DB QA**

First:

```bash
"$TASK_NODE" --experimental-strip-types scripts/run-registration-customer-solapi-local-db-qa.mjs
```

Expected: dry-run plan, no external mutation.

Then create an isolated loopback Supabase/Postgres instance and run:

```bash
"$TASK_NODE" --experimental-strip-types \
  scripts/run-registration-customer-solapi-local-db-qa.mjs \
  --execute \
  --approved-local-db \
  --url http://127.0.0.1:54321 \
  --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Runner-internal pgTAP:

```bash
"$TASK_SUPABASE" test db \
  --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  supabase/tests/registration_customer_solapi_messages_test.sql
```

Expected: pgTAP PASS; simultaneous claims produce one owner; marker replay makes no second provider call; exact cleanup PASS.

- [ ] **Step 4: Write failing browser verifier contract tests**

The script must cover all five kinds, dirty-source block, masked recipient, exact body, confirm, accepted/history, duplicate lock, unknown check, desktop `1349×987`, mobile `390×844`, focus/Escape/44px/no overflow, console/overlay absence, and zero requests to `api.solapi.com`.

- [ ] **Step 5: Implement and run the browser verifier**

Use:

```text
/admin/registration?fixture=registration-subject-tracks&fixtureRole=english_admin
```

The fixture may fake only the five app endpoints. Abort any unexpected provider network request.

Run the reachable local server, then:

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/registration-customer-solapi-local-db-qa.test.mjs \
  tests/registration-browser-verifier-contract.test.mjs \
  tests/ops-task-verification-safety.test.mjs
"$TASK_NODE" --experimental-strip-types scripts/verify-registration-customer-message-browser.mjs
```

- [ ] **Step 6: Run full related regression, lint, typecheck and Webpack build**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/registration-customer-solapi-db.test.mjs \
  tests/registration-customer-solapi-local-db-qa.test.mjs \
  tests/registration-customer-message-contract.test.mjs \
  tests/registration-customer-message-catalog.test.mjs \
  tests/registration-customer-message-source.test.mjs \
  tests/registration-customer-message-solapi.test.mjs \
  tests/registration-customer-message-route.test.mjs \
  tests/registration-alimtalk-preview-dialog.test.mjs \
  tests/registration-admission-message-route.test.mjs \
  tests/notification-registration-handoffs.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/registration-track-fixtures.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration-browser-verifier-contract.test.mjs \
  tests/ops-task-verification-safety.test.mjs
PATH="$TASK_RUNTIME_BIN:$PATH" "$TASK_PNPM" exec tsc --noEmit
PATH="$TASK_RUNTIME_BIN:$PATH" "$TASK_PNPM" exec eslint \
  src/app/api/solapi/registration \
  src/features/tasks/registration-customer-message-contract.ts \
  src/features/tasks/registration-alimtalk-preview-dialog.tsx \
  src/features/tasks/registration-customer-message-service.ts \
  src/features/tasks/server/registration-customer-message-auth.ts \
  src/features/tasks/server/registration-customer-message-catalog.ts \
  src/features/tasks/server/registration-customer-message-route.ts \
  src/features/tasks/server/registration-customer-message-solapi.ts \
  src/features/tasks/server/registration-customer-message-source.ts \
  src/features/tasks/registration-appointment-editor.tsx \
  src/features/tasks/registration-application-track-actions.tsx \
  src/features/tasks/registration-enrollment-editor.tsx \
  src/features/tasks/registration-track-editor.tsx \
  src/features/tasks/ops-task-workspace.tsx
PATH="$TASK_RUNTIME_BIN:$PATH" "$TASK_PNPM" build
```

Expected: all PASS and `next build --webpack` succeeds.

- [ ] **Step 7: Diff, commit, stop**

```bash
git diff --check
git status --short
git diff -- scripts/run-registration-customer-solapi-local-db-qa.mjs tests/registration-customer-solapi-local-db-qa.test.mjs scripts/verify-registration-customer-message-browser.mjs tests/registration-browser-verifier-contract.test.mjs tests/ops-task-verification-safety.test.mjs package.json
git add scripts/run-registration-customer-solapi-local-db-qa.mjs tests/registration-customer-solapi-local-db-qa.test.mjs scripts/verify-registration-customer-message-browser.mjs tests/registration-browser-verifier-contract.test.mjs tests/ops-task-verification-safety.test.mjs package.json
git commit -m "test: verify registration customer message delivery"
```

Report local tests, disposable DB cleanup, browser evidence, build, commit SHA separately and stop before any production/provider action.

---

### Task 10: Release the Tested Code and Verify Inert Production

**Files and external state:**

- Publish only the reviewed commits from Tasks 1–9.
- Apply only the three additive migrations through the repository workflow.
- Do not create SOLAPI templates, credentials, env values, previews, outbox rows, or customer sends in this Task.

- [ ] **Step 1: Run the read-only release preflight**

Verify current branch/status, commits, remote `main`, GitHub Actions state, linked Supabase identity/migration history, production DB health, Vercel project, current Production SHA/state, and current SOLAPI customer gates. Abort on unrelated overlap, remote migration divergence, or unexpected active customer dispatch.

```bash
git status --short --branch
git log --oneline origin/main..HEAD
gh pr status
"$TASK_NODE" "$TASK_VERCEL_CLI" whoami
```

- [ ] **Step 2: Publish and merge through the reviewed PR**

```bash
git push -u origin codex/registration-solapi-customer-messages
gh pr create \
  --base main \
  --head codex/registration-solapi-customer-messages \
  --title "feat: add registration SOLAPI customer messages" \
  --body "Closes #6. Implements the approved preview-confirm-send contract, provider-zero QA, additive DB gates, and production verification runbook."
```

Wait for all required checks, inspect the final PR diff, and merge only the reviewed head SHA. Do not include personal/provider data in the PR.

- [ ] **Step 3: Verify the production DB migration separately**

Wait for `.github/workflows/supabase-db-push.yml` on `main`. Read-only verification must prove:

- all three versions applied once;
- runtime marker = 1;
- all five activation rows = `off`;
- preview/outbox row count did not increase from migration;
- existing registration history is unchanged.

Do not run pgTAP or synthetic mutation against production.

- [ ] **Step 4: Verify the first Production deployment is fail-closed**

Require Vercel Production `READY` on the merged SHA. With provider credentials still absent, verify the registration UI remains usable, configuration blockers contain no values, `sendAllowed=false`, provider calls = 0, and internal Google Chat/Web Push/reminder settings are unchanged.

- [ ] **Step 5: Report and stop**

Report PR/main, DB workflow/runtime/gates, Vercel deployment/SHA/`READY`, and provider-zero evidence separately. Stop before opening a SOLAPI create form.

---

### Task 11: Create and Submit the Four New SOLAPI Templates

**External state:**

- Use the Chrome session already logged into SOLAPI.
- Change only templates under the existing `tipsedu` Kakao channel.
- Keep all five application activation rows `off`.
- Do not create an API key or set Vercel env in this Task.

- [ ] **Step 1: Reconfirm the inert gate and existing admission template**

Read the five activation modes and confirm all are `off`. In SOLAPI, read the existing admission template without editing it and compare its name, body, variables and fixed admission link with the approved catalog.

- [ ] **Step 2: Create the level-test booking template**

Enter the exact approved body and four variables, select information/basic type, configure no button, and disable SMS fallback. Inspect the final preview before saving.

- [ ] **Step 3: Create the visit-consultation booking template**

Enter the exact approved body and four variables, no button, and disabled SMS fallback. Inspect before saving.

- [ ] **Step 4: Create the appointment reminder template**

Enter the exact approved body and five variables, including the allowlisted `예약종류` variable, no button, and disabled SMS fallback. Inspect before saving.

- [ ] **Step 5: Create the waiting notice template**

Enter the exact approved body and four variables, no button, and disabled SMS fallback. Inspect before saving.

- [ ] **Step 6: Submit all four for Kakao review and stop**

Verify the four drafts once more, submit each for review, record only non-secret template names/IDs/statuses, and stop. If any form cannot represent the approved content exactly, do not submit a weakened variant; report the exact mismatch.

Template review is external asynchronous state. This Task is complete when all four exact submissions are accepted for review, not when they are approved.

---

### Task 12: Configure Production Credentials, Redeploy, and Record Five Preflight Receipts

**External state:**

- No send is allowed; all activation modes stay `off`.
- No secret/config file is created and `.env.local` remains unchanged.
- Do not create or enter credentials until the console shows all five templates sendable/`APPROVED`.

- [ ] **Step 1: Wait for all five provider approvals**

Poll the SOLAPI console without sending. Continue only when the four new templates and existing admission template are all sendable/`APPROVED`. If any is pending or rejected, report and stop with every gate `off`.

- [ ] **Step 2: Create the dedicated key and Production-only secrets**

Create `tips-dashboard-production-solapi`. Move the secret directly from the creation screen to Vercel Production without printing, DOM extraction, file storage, terminal arguments, or chat. Generate an independent random recipient-hash pepper and set only Production:

```text
SOLAPI_API_KEY
SOLAPI_API_SECRET
SOLAPI_KAKAO_PF_ID
SOLAPI_REGISTRATION_LEVEL_TEST_BOOKING_TEMPLATE_ID
SOLAPI_REGISTRATION_VISIT_BOOKING_TEMPLATE_ID
SOLAPI_REGISTRATION_APPOINTMENT_REMINDER_TEMPLATE_ID
SOLAPI_REGISTRATION_WAITING_TEMPLATE_ID
SOLAPI_REGISTRATION_ADMISSION_TEMPLATE_ID
REGISTRATION_SOLAPI_RECIPIENT_HASH_PEPPER
```

Immediately replace any temporary clipboard content with a non-sensitive string. Do not configure payment or auto-charge. If the balance is insufficient for the later five sends, stop and request explicit payment authorization.

- [ ] **Step 3: Redeploy the same tested SHA**

Trigger a Production redeploy and require `READY` on the same merged commit. Confirm env values are configured only for Production and remain absent from Preview/local.

- [ ] **Step 4: Run five authenticated API preflights**

Now that credentials exist, call `preflight_template` once for each kind. Require exact `APPROVED` channel/content/variable/button checksums and five current private receipts. Separately assert the send builder invariant `disableSms=true`.

- [ ] **Step 5: Verify readiness remains inert and stop**

Confirm credential/PF/template/receipt readiness booleans are true, all five modes remain `off`, `sendAllowed=false`, no preview/outbox row was created, and provider sends = 0. Report masked/non-secret evidence and stop.

---

### Task 13: Prepare the Synthetic Verification Registration

**External state:**

- All five gates begin and end this Task `off`.
- Use no real student or guardian data.
- The user enters their own number directly into TIPS; it is not read into tools or the report.

- [ ] **Step 1: Create the synthetic registration shell**

Create a registration named `SOLAPI 테스트`. Pause at the guardian number field so the user can enter their own mobile number directly, then save.

- [ ] **Step 2: Save the level-test source**

Create one future scheduled level-test appointment with a valid place and at least one active subject participant. Save and reload to prove persistence.

- [ ] **Step 3: Save the visit-consultation source**

Create one future scheduled visit appointment with a valid place and at least one active subject participant. Save and reload.

- [ ] **Step 4: Save the waiting and admission sources**

Save one complete waiting track with consistent `workflow_status` and `waiting_detail_*`. Preserve at least one separate eligible admission track/fact so the admission selector is valid.

- [ ] **Step 5: Verify source readiness without sending and stop**

Read each source ID and masked last4 through the app, confirm all five `off` blockers, dirty state false, provider calls = 0, preview/outbox rows = 0, and no real student data was used. Record only task/source IDs and last4. Stop before changing a gate.

---

### Task 14: Verify One Level-Test Booking Receipt

**Allowed real provider action:** exactly one `level_test_booking` send to the synthetic task/user number.

- [ ] **Step 1: Preflight and enter verification**

Require current template receipt, Production `READY`, source persisted/unchanged, gate `off`, and cumulative real sends = 0. Set only `level_test_booking` to `verification` with the synthetic task; the server calculates the recipient hash.

- [ ] **Step 2: Prove scope isolation**

Request readiness for another registration task without opening or recording its personal message body. Require `verification_scope_mismatch` and provider calls = 0.

- [ ] **Step 3: Preview and confirm once**

Open the saved level-test `예약 안내 알림톡`. Check student label, last4, subjects, KST schedule, place, exact body, no button, readiness, and recent history. Click `확인 후 발송` once.

- [ ] **Step 4: Confirm accepted and actual receipt**

Require one masked `accepted` outbox entry and cumulative provider sends = 1. Ask the user to confirm the Kakao message arrived. If receipt is not confirmed immediately, set the gate `off`, report pending receipt, and do not resend.

- [ ] **Step 5: Record receipt, prove dedupe, return off**

While in `verification`, call `record_live_test_receipt` with the accepted message and user-confirmed time. Replay the exact preview/request tuple and open the same source again; require no second provider call and a permanent duplicate lock. Set the kind `off` while retaining the private receipt.

- [ ] **Step 6: Report and stop**

Report mode `off`, one masked accepted row, one user-confirmed receipt, cumulative sends 1, duplicate replay provider delta 0, and stop.

---

### Task 15: Verify One Visit-Consultation Booking Receipt

**Allowed real provider action:** exactly one `visit_consultation_booking` send to the synthetic task/user number.

- [ ] **Step 1: Preflight and enter verification**

Require current receipt/source, all other kinds `off`, and cumulative sends = 1. Set only `visit_consultation_booking` to `verification` for the synthetic task.

- [ ] **Step 2: Prove scope isolation**

Require another task to return `verification_scope_mismatch` with provider delta 0.

- [ ] **Step 3: Preview and confirm once**

Open the saved visit `예약 안내 알림톡`. Verify last4, subjects, KST schedule, place, exact visit body, no button, and readiness. Confirm once.

- [ ] **Step 4: Confirm accepted and actual receipt**

Require one new masked `accepted` row and cumulative sends = 2. Obtain the user’s actual Kakao receipt confirmation. If not confirmed, set `off` and do not resend.

- [ ] **Step 5: Record receipt, prove dedupe, return off**

Record the verified receipt, exact-replay the same request, reopen the same source, require provider delta 0 and duplicate lock, then set the kind `off`.

- [ ] **Step 6: Report and stop**

Report the second masked accepted/confirmed receipt, cumulative sends 2, all gates `off`, and stop.

---

### Task 16: Verify One Appointment Reminder Receipt

**Allowed real provider action:** exactly one `appointment_reminder` send to the saved synthetic level-test appointment.

- [ ] **Step 1: Preflight and enter verification**

Require the appointment still future/scheduled and unchanged, current receipt, all gates `off`, cumulative sends = 2. Set only `appointment_reminder` to `verification`.

- [ ] **Step 2: Prove scope isolation**

Require another task to return `verification_scope_mismatch` with provider delta 0.

- [ ] **Step 3: Preview and confirm once**

Open `리마인드 알림톡` on the saved level-test appointment. Verify `예약종류=레벨테스트`, last4, subjects, KST schedule, place, exact reminder body, and no button. Confirm once.

- [ ] **Step 4: Confirm accepted and actual receipt**

Require one new masked `accepted` row and cumulative sends = 3. Obtain user receipt confirmation; otherwise set `off` and do not resend.

- [ ] **Step 5: Record receipt, prove dedupe, return off**

Record the receipt, exact-replay and reopen the same revision, prove provider delta 0 and duplicate lock, then set the kind `off`.

- [ ] **Step 6: Report and stop**

Report the third masked accepted/confirmed receipt, cumulative sends 3, all gates `off`, and stop.

---

### Task 17: Verify One Waiting Notice Receipt

**Allowed real provider action:** exactly one `waiting_notice` send to the saved synthetic waiting track.

- [ ] **Step 1: Preflight and enter verification**

Require complete consistent waiting facts, current receipt, all gates `off`, cumulative sends = 3. Set only `waiting_notice` to `verification`.

- [ ] **Step 2: Prove scope isolation**

Require another task to return `verification_scope_mismatch` with provider delta 0.

- [ ] **Step 3: Preview and confirm once**

Open the track’s `대기 안내 알림톡`. Verify subject, waiting kind/detail, last4, exact body, no button, readiness and source revision. Confirm once.

- [ ] **Step 4: Confirm accepted and actual receipt**

Require one new masked `accepted` row and cumulative sends = 4. Obtain user receipt confirmation; otherwise set `off` and do not resend.

- [ ] **Step 5: Record receipt, prove dedupe, return off**

Record the receipt, exact-replay and reopen the same track revision, prove provider delta 0 and duplicate lock, then set the kind `off`.

- [ ] **Step 6: Report and stop**

Report the fourth masked accepted/confirmed receipt, cumulative sends 4, all gates `off`, and stop.

---

### Task 18: Verify One Admission-Application Receipt

**Allowed real provider action:** exactly one `admission_application` send to the synthetic registration.

- [ ] **Step 1: Preflight and enter verification**

Require admission eligibility, prior legacy admission not accepted/active, current receipt, all gates `off`, cumulative sends = 4. Set only `admission_application` to `verification`.

- [ ] **Step 2: Prove scope isolation**

Require another task to return `verification_scope_mismatch` with provider delta 0.

- [ ] **Step 3: Preview and confirm once**

Open `입학신청서 알림톡`. Verify target subjects, last4, exact admission body, button name `입학신청서 작성` and destination host/link contract. Confirm once.

- [ ] **Step 4: Confirm accepted and actual receipt**

Require one new masked `accepted` row, atomic `admission_notice_sent=true` compatibility update, one sanitized event, and cumulative sends = 5. Obtain user receipt confirmation; otherwise set `off` and do not resend.

- [ ] **Step 5: Record receipt, prove dedupe, return off**

Record the receipt, exact-replay and reopen admission, prove provider delta 0, permanent duplicate lock, and no legacy provider call. Set the kind `off`.

- [ ] **Step 6: Report and stop**

Report the fifth masked accepted/confirmed receipt, cumulative sends exactly 5, all gates `off`, and stop.

---

### Task 19: Activate All Five Kinds Live and Close the Execution Issue

**Allowed external action:** activation state changes only; no provider send.

- [ ] **Step 1: Audit all retained evidence**

Require five current template receipts, five matching accepted synthetic messages, five user-confirmed receipt timestamps, cumulative sends exactly 5, all modes `off`, and no `unknown`/unexpected duplicate/privacy incident.

- [ ] **Step 2: Transition each kind through the approved chain**

For each kind, set `off → verification` with the same synthetic task/current recipient hash, then `verification → live` using the retained private evidence. Do not create a new preview or send.

- [ ] **Step 3: Verify the final operating state**

Require all five readiness modes `live`, runtime marker 1, current receipts, Production `READY` on the merged SHA, provider delta 0 during activation, actual student sends 0, customer cron/SMS fallback/internal notification activation/payment actions 0.

- [ ] **Step 4: Confirm rollback readiness**

Verify admin can set an affected kind to `off` and the dedicated key can be revoked, without actually revoking or disabling a healthy release. Do not delete the synthetic registration or audit history without a separate cleanup request.

- [ ] **Step 5: Close Issue #6 only on complete evidence**

Post non-sensitive evidence separating tests/build, GitHub main, DB/runtime/gates, Vercel deployment, provider approvals/preflights, five masked accepted rows and five actual receipt confirmations. Close Issue #6 only when every item passes; otherwise leave it open with the exact gate.

- [ ] **Step 6: Final report and stop**

Report exact total sends = 5, five kinds `live`, production deployment/SHA, rollback action, and remaining cleanup scope. Do not claim completion from provider `accepted` alone.

## Final Completion Gate

This project is complete only when all Task checkboxes are checked, Tasks 1–9 each have a reviewed commit, Tasks 10–19 each have separate non-sensitive operational evidence, the production state surfaces are reported separately, and the user has confirmed receipt of exactly five synthetic Alimtalk messages. A green build, a deployed UI, approved templates, or provider `accepted` alone is not sufficient.
