# Google Chat Connections, Deep Links, and Delivery Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 알림 설정에 관리팀·경영팀·영어팀·수학팀·과학팀 Google Chat 연결을 고정 순서로 제공하고, 모든 Google Chat 앱 링크를 클릭 가능한 전체 URL로 보내며, 전반·퇴원의 상태별 딥링크와 owner-aware 최근 전달 요약을 정확하게 만든다.

**Architecture:** 연결 목록은 서버와 브라우저가 함께 쓰는 5개 고정 카탈로그를 기준으로 실제 DB 행을 projection하고, 누락 행은 DB 쓰기 없이 revision `"0"`의 가상 `disconnected` 슬롯으로 표시한다. 앱 내부 `href`는 상대 경로로 유지하되 Google Chat provider 경계에서만 고정 origin을 결합한다. 전반·퇴원은 canonical TypeScript adapter와 legacy SQL plan이 같은 상태→flow 계약을 각각 fail-closed로 구현한다. 최근 전달 요약은 canonical delivery와 legacy ownership claim을 6개 필드의 논리 identity와 현재 owner로 선택해 한 번만 집계한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node test runner, Supabase/PostgreSQL migrations, pgTAP, ESLint, Next.js Webpack build

## Global Constraints

- Google Chat 연결은 `관리팀 → 경영팀 → 영어팀 → 수학팀 → 과학팀` 정확히 5개다.
- `assistant`, `google_chat.assistant`, `조교팀 Google Chat`, 조교팀 전체 Chat 수신 규칙은 추가하지 않는다.
- 기존 `assigned_assistant` 개인 인앱 알림은 변경하지 않는다.
- 누락된 영어팀·수학팀 DB 행을 `disconnected`로 seed하지 않는다. 가상 revision `"0"`은 읽기 모델에만 존재한다.
- DB 행이 없는 슬롯과 유효한 legacy 환경변수 fallback 사이의 오표시 충돌은 secret를 출력하지 않는 server-only preflight로만 탐지한다. 자동 import와 환경변수 변경은 금지한다.
- 연결 행의 생성·수정은 rule `enabled`, runtime flag, shadow flag, dispatch owner를 바꾸지 않는다.
- canonical event/delivery에 저장하는 `href`는 계속 `/admin/` 상대 경로다.
- Google Chat 공개 origin은 코드에 고정한 `https://tipsedu.co.kr`만 허용한다. DB payload, template, 브라우저 입력, 환경변수로 바꾸지 않는다.
- 전반·퇴원 상태가 지원 목록에 없으면 임의의 flow로 보내지 않고 fail-closed 처리한다.
- 전반·퇴원 flow의 권위 있는 상태 시점은 canonical notification event에 저장된 `payload.status`다. canonical adapter와 legacy plan 모두 이 동일한 event snapshot을 사용하며, 현재 `ops_tasks.status`를 다시 읽어 서로 다른 링크를 만들지 않는다.
- 최근 전달 요약은 읽기 모델만 변경한다. delivery, event, ownership claim, audit log를 백필·수정·복제하지 않는다.
- 자동 테스트와 브라우저 QA에서 연결 검증, 테스트 메시지, 실제 webhook fetch를 실행하지 않는다.
- 각 Task는 RED 확인 → 최소 구현 → focused 검증 → diff 검토 → 명시 파일만 커밋한 뒤 멈춘다.
- 각 Task 시작 전에 unrelated worktree 변경을 식별하고 보존한다. scoped diff와 명시적 `git add`만 사용하며, 겹치는 변경이 있으면 전용 worktree로 옮기기 전에는 구현하지 않는다.
- 로컬 migration을 실행하기 전에 `supabase migration list --local`로 pending 목록을 확인한다. 해당 Task까지 승인된 migration 외 파일이 pending이면 `migration up`을 실행하지 않고 격리된 disposable local Supabase 환경을 준비한다.
- 운영 DB migration 적용, `main` push, Vercel 배포, provider 발송, runtime 활성화는 이 계획의 로컬 구현 완료에 포함되지 않으며 별도 승인이 필요하다.

---

## File Structure

### Task 1: 고정 연결 카탈로그와 fallback preflight

- Create: `src/features/notifications/notification-google-chat-catalog.ts`
  - 5개 connection key, DB channel, UI label의 단일 고정 카탈로그.
- Modify: `src/features/notifications/notification-control-plane-types.ts`
  - 카탈로그 기반 key type과 snapshot의 정확한 5개 순서 검증.
- Modify: `src/features/notifications/server/notification-connection-repository.ts`
  - 실제 행을 5개 카탈로그에 projection하고 누락 슬롯을 revision `"0"`으로 보완.
- Modify: `src/features/notifications/notification-control-panel.tsx`
  - 고정 label과 표시 순서 사용, `경영진`을 `경영팀`으로 수정.
- Modify: `src/features/notifications/notification-control-plane-model.ts`
  - subject-team 연결 검사 순서를 영어→수학→과학으로 통일.
- Create: `supabase/migrations/20260730143000_notification_google_chat_connection_catalog.sql`
  - snapshot 연결 목록을 고정 카탈로그 left join으로 교체.
- Create: `scripts/preflight-google-chat-connection-fallbacks.mjs`
  - DB에는 channel만 조회하고 missing-row/legacy-env 충돌의 key만 보고.
- Modify: `package.json`
  - server-only preflight 명령 추가.
- Create: `tests/notification-google-chat-connection-catalog.test.mjs`
  - 카탈로그·migration·preflight의 집중 계약.
- Modify: `tests/notification-control-plane-model.test.mjs`
- Modify: `tests/notification-control-plane-api.test.mjs`
- Modify: `tests/notification-control-plane-ui.test.mjs`
- Modify: `supabase/tests/notification_control_plane_runtime_test.sql`
- Modify: `tests/notification-science-provider-zero.test.mjs`

### Task 2: Google Chat provider의 전체 URL 출력 경계

- Modify: `src/features/notifications/server/providers/google-chat-provider.ts`
  - 안전한 상대 `href`만 고정 origin과 결합하고 잘못된 링크는 fetch 전에 거절.
- Modify: `src/features/notifications/server/notification-worker.ts`
  - `render_validation_failed`를 재시도 없는 확정 실패로 정규화.
- Modify: `tests/notification-control-plane-worker.test.mjs`
  - 전체 URL payload, 잘못된 링크의 fetch 0회, worker 결과 정규화 검증.

### Task 3: 전반·퇴원 상태별 canonical/legacy 딥링크

- Create: `src/features/notifications/server/adapters/ops-transition-notification-deep-link.ts`
  - 전반·퇴원 공용 상태→flow TypeScript 계약.
- Modify: `src/features/notifications/server/adapters/immediate-notification-adapter.ts`
  - workflow별 deep-link builder 주입점.
- Modify: `src/features/notifications/server/adapters/transfer-notification-adapter.ts`
- Modify: `src/features/notifications/server/adapters/withdrawal-notification-adapter.ts`
- Create: `supabase/migrations/20260730143100_notification_transfer_withdrawal_deep_links.sql`
  - legacy SQL plan의 동일 상태→flow 계약.
- Modify: `tests/notification-transfer-withdrawal-adapters.test.mjs`
- Modify: `tests/notification-workflow-registry.test.mjs`
- Modify: `supabase/tests/notification_transfer_withdrawal_adapters_test.sql`

### Task 4: owner-aware 최근 전달 요약과 전체 회귀 검증

- Create: `supabase/migrations/20260730143200_notification_owner_aware_delivery_summary.sql`
  - Task 1의 5개 연결 projection을 보존하면서 delivery summary만 owner-aware projection으로 교체.
- Create: `tests/notification-control-plane-owner-aware-summary.test.mjs`
  - identity, 상태 매핑, migration 합성 안전성의 구조 검증.
- Create: `supabase/tests/notification_control_plane_owner_aware_summary_test.sql`
  - canonical/legacy/중복 owner fixture의 실제 집계 검증.

## Migration Dependency

세 migration은 아래 순서로만 추가한다.

```text
20260730143000_notification_google_chat_connection_catalog.sql
20260730143100_notification_transfer_withdrawal_deep_links.sql
20260730143200_notification_owner_aware_delivery_summary.sql
```

이 번호는 계획 작성 시 최신 active migration인 `20260730140446_class_group_rpc_acl_hardening.sql` 뒤에 배치한 것이다. Task 1 시작 시 최신 active migration을 다시 확인한다. 이미 `20260730143000` 이상이 존재하면 파일을 만들기 전에 세 번호를 모두 그 최신값 뒤의 연속 시각으로 재지정하고, 이 계획의 경로·migration URL·pending-set assertion을 한 번에 갱신한다. 기존 migration을 덮어쓰거나 같은 timestamp를 재사용하지 않는다.

`notification_control_plane_snapshot_v1(text, boolean)`는 Task 1과 Task 4가 모두 교체한다. 따라서 `14:32` migration은 `14:30` migration의 전체 최신 함수 본문을 기준으로 작성하고, 5개 연결 catalog CTE와 revision `"0"` projection을 그대로 포함해야 한다. `20260722120000_science_notification_connection.sql`의 이전 snapshot 본문에서 다시 시작하면 안 된다.

---

### Task 1: 고정 5개 Google Chat 연결 카탈로그를 projection한다

**Files:**
- Create: `src/features/notifications/notification-google-chat-catalog.ts`
- Modify: `src/features/notifications/notification-control-plane-types.ts`
- Modify: `src/features/notifications/server/notification-connection-repository.ts`
- Modify: `src/features/notifications/notification-control-panel.tsx`
- Modify: `src/features/notifications/notification-control-plane-model.ts`
- Create: `supabase/migrations/20260730143000_notification_google_chat_connection_catalog.sql`
- Create: `scripts/preflight-google-chat-connection-fallbacks.mjs`
- Modify: `package.json`
- Create: `tests/notification-google-chat-connection-catalog.test.mjs`
- Modify: `tests/notification-control-plane-model.test.mjs`
- Modify: `tests/notification-control-plane-api.test.mjs`
- Modify: `tests/notification-control-plane-ui.test.mjs`
- Modify: `supabase/tests/notification_control_plane_runtime_test.sql`
- Modify: `tests/notification-science-provider-zero.test.mjs`

**Interfaces:**
- Produces: `GOOGLE_CHAT_CONNECTION_CATALOG`, `NotificationConnectionKey`, `GoogleChatConnectionChannel`.
- Produces: 누락 행을 나타내는 `NotificationConnectionDto` with `connectionState: "disconnected"`, `revision: "0"`, `configured: false`.
- Produces: `findGoogleChatConnectionFallbackConflicts()`와 CLI preflight.
- Preserves: 기존 absent-row replace RPC의 `expected_revision = 0 → encrypted_active revision 1` 계약.

- [ ] **Step 1: 카탈로그·parser·UI·repository의 실패 테스트를 먼저 작성한다**

먼저 새 catalog 모듈을 import하지 않고 현재 존재하는 `notification-control-plane-types.ts`, repository, UI source를 대상으로 아래 정확한 순서와 명칭을 고정한다.

```js
const expectedCatalog = [
  ["google_chat.management", "admin", "관리팀 Google Chat"],
  ["google_chat.executive", "executive", "경영팀 Google Chat"],
  ["google_chat.english", "english", "영어팀 Google Chat"],
  ["google_chat.math", "math", "수학팀 Google Chat"],
  ["google_chat.science", "science", "과학팀 Google Chat"],
]

const { NOTIFICATION_CONNECTION_KEYS } = await import(controlPlaneTypesModuleUrl)
assert.deepEqual(
  NOTIFICATION_CONNECTION_KEYS,
  expectedCatalog.map(([connectionKey]) => connectionKey),
)
assert.equal(NOTIFICATION_CONNECTION_KEYS.some((key) => key.includes("assistant")), false)
```

기존 `tests/notification-control-plane-api.test.mjs`의 `createConnectionStore()`와 `makeConnectionRow()`를 사용해 관리·경영·과학 실제 행만 반환하고 결과 전체를 검증한다.

```js
const store = createConnectionStore([
  makeConnectionRow({
    channel: "admin",
    connection_state: "legacy_active",
    revision: "3",
  }),
  makeConnectionRow({
    channel: "executive",
    connection_state: "legacy_active",
    revision: "2",
  }),
  makeConnectionRow({
    channel: "science",
    connection_state: "disconnected",
    revision: "1",
  }),
])
const repository = createNotificationConnectionRepository({
  store,
  encryptionKey: ENCRYPTION_KEY,
  sendVerification: async () => {
    throw new Error("list must not verify")
  },
})
const connections = await repository.listConnections()

assert.deepEqual(
  connections.map(({ connectionKey, connectionState, revision }) => [
    connectionKey,
    connectionState,
    revision,
  ]),
  [
    ["google_chat.management", "legacy_active", "3"],
    ["google_chat.executive", "legacy_active", "2"],
    ["google_chat.english", "disconnected", "0"],
    ["google_chat.math", "disconnected", "0"],
    ["google_chat.science", "disconnected", "1"],
  ],
)
assert.deepEqual(
  store.calls.map(({ operation }) => operation),
  ["listRows"],
)
```

snapshot parser는 누락·중복뿐 아니라 순서가 바뀐 5개 배열도 `ok: false`로 거절하게 테스트한다. UI test는 카드 label 5개와 영어→수학 순서, `조교팀` 부재, 가상 슬롯에서 검증·연결 해제 버튼 비활성화를 고정한다.

- [ ] **Step 2: migration과 preflight의 실패 계약을 추가한다**

현재 local schema를 대상으로 pgTAP assertion을 먼저 추가해 영어·수학 누락 projection이 실패하는지 확인한다. 아직 존재하지 않는 `14:30` migration 파일을 `readFile()`하는 구조 테스트는 RED 단계에 넣지 않고 migration 작성 직후 추가한다.

preflight는 import 가능한 최소 export 골격을 먼저 만든다. 직접 실행 guard는 import 시 CLI를 시작하지 않아야 하고, 미구현 pure function은 의도적으로 아래 오류를 던진다.

```js
export function findGoogleChatConnectionFallbackConflicts() {
  throw new Error("google_chat_connection_preflight_not_implemented")
}
```

preflight pure-function test는 아래 경우를 고정한다.

```js
const validEnglishWebhook =
  "https://chat.googleapis.com/v1/spaces/SPACEIDENTIFIER123456/messages?key=key-secret&token=token-secret"
const result = findGoogleChatConnectionFallbackConflicts({
    storedChannels: ["admin", "executive", "science"],
    environment: {
      GOOGLE_CHAT_WEBHOOK_ENGLISH: validEnglishWebhook,
      GOOGLE_CHAT_WEBHOOK_MATH: "",
    },
})
assert.deepEqual(result, ["google_chat.english"])
assert.equal(JSON.stringify(result).includes(validEnglishWebhook), false)
```

추가 케이스:

- 실제 DB 행이 있으면 같은 env가 있어도 충돌 없음.
- env가 비어 있거나 허용되지 않은 URL이면 충돌 없음.
- science는 legacy env mapping이 없으므로 충돌 후보가 아님.
- 오류 출력에는 URL, token, 암호문, service-role key가 없음.
- CLI test double의 DB select column은 정확히 `channel`, 쓰기와 provider fetch는 0회.

- [ ] **Step 3: focused tests를 실행해 RED를 확인한다**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-google-chat-connection-catalog.test.mjs tests/notification-control-plane-model.test.mjs tests/notification-control-plane-api.test.mjs tests/notification-control-plane-ui.test.mjs tests/notification-science-provider-zero.test.mjs
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase test db --local supabase/tests/notification_control_plane_runtime_test.sql
```

Expected: 현재 key 순서가 수학→영어이고 UI label이 `경영진 Google Chat`이며 누락 DB 행을 projection하지 않으므로 기존 모듈과 pgTAP assertion이 FAIL한다. preflight test는 `google_chat_connection_preflight_not_implemented`에서 FAIL한다. `ERR_MODULE_NOT_FOUND`가 RED 근거가 되어서는 안 된다.

- [ ] **Step 4: 브라우저에서도 안전한 단일 카탈로그를 구현한다**

`src/features/notifications/notification-google-chat-catalog.ts`:

```ts
export const GOOGLE_CHAT_CONNECTION_CATALOG = [
  {
    connectionKey: "google_chat.management",
    channel: "admin",
    label: "관리팀 Google Chat",
  },
  {
    connectionKey: "google_chat.executive",
    channel: "executive",
    label: "경영팀 Google Chat",
  },
  {
    connectionKey: "google_chat.english",
    channel: "english",
    label: "영어팀 Google Chat",
  },
  {
    connectionKey: "google_chat.math",
    channel: "math",
    label: "수학팀 Google Chat",
  },
  {
    connectionKey: "google_chat.science",
    channel: "science",
    label: "과학팀 Google Chat",
  },
] as const

export type NotificationConnectionKey =
  (typeof GOOGLE_CHAT_CONNECTION_CATALOG)[number]["connectionKey"]
export type GoogleChatConnectionChannel =
  (typeof GOOGLE_CHAT_CONNECTION_CATALOG)[number]["channel"]

export const NOTIFICATION_CONNECTION_KEYS = Object.freeze(
  GOOGLE_CHAT_CONNECTION_CATALOG.map(({ connectionKey }) => connectionKey),
) as ReadonlyArray<NotificationConnectionKey>

export const GOOGLE_CHAT_CONNECTION_LABELS = Object.freeze(
  Object.fromEntries(
    GOOGLE_CHAT_CONNECTION_CATALOG.map(({ connectionKey, label }) => [connectionKey, label]),
  ),
) as Readonly<Record<NotificationConnectionKey, string>>
```

구현 직후 새 catalog 모듈을 직접 import하는 regression assertion을 추가한다.

```js
assert.deepEqual(
  GOOGLE_CHAT_CONNECTION_CATALOG.map(({ connectionKey, channel, label }) => [
    connectionKey,
    channel,
    label,
  ]),
  expectedCatalog,
)
assert.equal(JSON.stringify(GOOGLE_CHAT_CONNECTION_CATALOG).includes("assistant"), false)
```

`notification-control-plane-types.ts`는 위 type/constant를 import 후 re-export한다. parser가 성공하기 전에 아래 정확한 set과 index를 확인한다.

```ts
if (
  connections.length !== NOTIFICATION_CONNECTION_KEYS.length ||
  NOTIFICATION_CONNECTION_KEYS.some(
    (connectionKey, index) => connections[index]?.connectionKey !== connectionKey,
  )
) {
  addIssue(
    issues,
    "invalid_field",
    "connections",
    "Connections must match the fixed Google Chat catalog.",
  )
}
```

- [ ] **Step 5: repository와 UI를 고정 카탈로그에 맞춘다**

repository의 양방향 channel map을 카탈로그에서 파생하고 가상 DTO를 추가한다.

```ts
function virtualDisconnectedConnection(
  connectionKey: NotificationConnectionKey,
): NotificationConnectionDto {
  return {
    connectionKey,
    connectionState: "disconnected",
    revision: "0",
    configured: false,
    webhookUrlMask: null,
    lastVerifiedAt: null,
    lastErrorCode: null,
    editable: true,
  }
}
```

`listConnections()`는 모든 row를 기존 `rowToDto()`로 먼저 검증한 뒤 고정 순서로 projection한다.

```ts
const actualByKey = new Map(
  rows.map((row) => {
    const connection = rowToDto(row, encryptionKey)
    return [connection.connectionKey, connection] as const
  }),
)
return NOTIFICATION_CONNECTION_KEYS.map(
  (connectionKey) =>
    actualByKey.get(connectionKey) ?? virtualDisconnectedConnection(connectionKey),
)
```

기존 API harness도 같은 카탈로그를 잠근다. `createWireSnapshot()`의 connections를 5개로 바꾸고 control-plane 최초 GET, 저장 성공 payload, 409 payload의 `current_snapshot`, `/api/notifications/connections` GET 각각에 아래 helper를 적용한다.

```js
const EXPECTED_CONNECTION_KEYS = [
  "google_chat.management",
  "google_chat.executive",
  "google_chat.english",
  "google_chat.math",
  "google_chat.science",
]

function assertFixedConnectionCatalog(wireConnections) {
  assert.deepEqual(
    wireConnections.map((connection) => connection.connection_key),
    EXPECTED_CONNECTION_KEYS,
  )
}
```

각 기존 test의 실제 response 변수에 `assertFixedConnectionCatalog()`를 호출한다. 409 test만 `payload.current_snapshot.connections`를 넘기고 나머지는 `payload.connections`를 넘긴다.

`createConnectionStore()` test double의 `replaceAtomic()`은 row가 없고 `expectedRevision === "0"`인 replace에 한해서 실제 RPC처럼 새 encrypted row를 revision `"1"`로 만든다. 다른 absent mutation은 계속 revision conflict다.

```js
if (!current && operation === "replace" && input.expectedRevision === "0") {
  return {
    existing: null,
    requestFingerprint,
    current: makeConnectionRow({
      channel: input.channel,
      webhook_url: "",
      webhook_url_ciphertext: null,
      webhook_url_mask: null,
      connection_state: "disconnected",
      revision: "0",
    }),
  }
}
```

가상 영어 슬롯을 `expectedRevision: "0"`으로 replace한 뒤 mutation 응답과 별도 GET 재조회가 모두 `encrypted_active`, revision `"1"`이며 provider call은 0회인지 확인한다. 같은 expected revision으로 다시 replace하면 `/api/notifications/connections`는 기존 계약대로 `{ ok: false, code: "notification_connection_revision_conflict" }`만 반환하고, 그 직후 별도 GET이 5개 고정 순서와 영어 revision `"1"`을 반환해야 한다. control-plane save 409의 `current_snapshot.connections` 검증은 앞의 control-plane API test에서 별도로 유지한다.

UI는 `GOOGLE_CHAT_CONNECTION_LABELS`를 사용하고 `경영진 Google Chat` 하드코딩을 제거한다. subject-team 관련 배열은 영어→수학→과학 순서로 맞춘다. 기존 `configured === false` 조건을 유지해 가상 슬롯의 검증·해제 동작이 비활성인지 확인한다.

- [ ] **Step 6: snapshot의 연결 projection migration을 작성한다**

`14:30` migration은 `begin;`과 `set local lock_timeout = '5s';`로 시작한다. `20260722120000_science_notification_connection.sql:984-1105`의 `dashboard_private.notification_control_plane_snapshot_v1(text, boolean)` 정의를 그대로 복사한 후, `'connections'` expression만 아래 코드로 교체한다. 원본 범위를 임의로 다시 작성하지 않는다.

```sql
'connections', (
  with connection_catalog(sort_order, channel, connection_key) as (
    values
      (1, 'admin'::text, 'google_chat.management'::text),
      (2, 'executive'::text, 'google_chat.executive'::text),
      (3, 'english'::text, 'google_chat.english'::text),
      (4, 'math'::text, 'google_chat.math'::text),
      (5, 'science'::text, 'google_chat.science'::text)
  )
  select pg_catalog.jsonb_agg(
    case
      when connection_row.channel is not null then
        dashboard_private.notification_connection_safe_json_v1(
          connection_row,
          p_editable
        )
      else pg_catalog.jsonb_build_object(
        'connection_key', catalog_row.connection_key,
        'connection_state', 'disconnected',
        'revision', '0',
        'configured', false,
        'webhook_url_mask', null,
        'last_verified_at', null,
        'last_error_code', null,
        'editable', coalesce(p_editable, false)
      )
    end
    order by catalog_row.sort_order
  )
  from connection_catalog catalog_row
  left join public.google_chat_webhook_settings connection_row
    on connection_row.channel = catalog_row.channel
),
```

함수 뒤에는 아래 owner/ACL과 `commit;`을 정확히 둔다.

```sql
alter function dashboard_private.notification_control_plane_snapshot_v1(text, boolean)
  owner to postgres;
revoke all on function dashboard_private.notification_control_plane_snapshot_v1(text, boolean)
  from public, anon, authenticated, service_role;

commit;
```

함수 속성 `language sql`, `stable`, `security definer`, `set search_path = ''`를 보존한다. migration에는 설정 테이블 DML을 넣지 않는다. migration 작성 후 Node 구조 test가 고정 `VALUES` 5행, left join, virtual revision `"0"`, no-DML, 함수 속성, owner/ACL을 검사한다.

pgTAP은 기존 `plan(228)`을 정확히 `plan(234)`로 올리고 아래 6개 assertion을 savepoint 안에 추가한 뒤 원상 복구한다.

```sql
savepoint fixed_google_chat_catalog;
reset role;
delete from public.google_chat_webhook_settings where channel in ('english', 'math');
insert into public.google_chat_webhook_settings(
  channel, webhook_url, webhook_url_ciphertext, webhook_url_mask,
  connection_state, revision, last_verified_at, last_error_code
) values ('science', '', null, null, 'disconnected', 1, null, null)
on conflict (channel) do update set
  connection_state = excluded.connection_state,
  revision = excluded.revision,
  webhook_url = excluded.webhook_url,
  webhook_url_ciphertext = excluded.webhook_url_ciphertext,
  webhook_url_mask = excluded.webhook_url_mask;

create temporary table fixed_google_chat_catalog_before on commit drop as
select pg_catalog.count(*)::bigint as row_count
from public.google_chat_webhook_settings;

select is(
  (
    select pg_catalog.jsonb_agg(value ->> 'connection_key' order by ordinal)
    from pg_catalog.jsonb_array_elements(
      dashboard_private.notification_control_plane_snapshot_v1('tasks', true)
        -> 'connections'
    ) with ordinality connection(value, ordinal)
  ),
  '["google_chat.management","google_chat.executive","google_chat.english","google_chat.math","google_chat.science"]'::jsonb,
  'snapshot projects the exact five Google Chat slots in fixed order'
);
select is(
  (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'key', value ->> 'connection_key',
        'state', value ->> 'connection_state',
        'revision', value ->> 'revision',
        'configured', value -> 'configured',
        'mask', value -> 'webhook_url_mask'
      )
      order by ordinal
    )
    from pg_catalog.jsonb_array_elements(
      dashboard_private.notification_control_plane_snapshot_v1('tasks', true)
        -> 'connections'
    ) with ordinality connection(value, ordinal)
    where value ->> 'connection_key' in ('google_chat.english', 'google_chat.math')
  ),
  '[
    {"key":"google_chat.english","state":"disconnected","revision":"0","configured":false,"mask":null},
    {"key":"google_chat.math","state":"disconnected","revision":"0","configured":false,"mask":null}
  ]'::jsonb,
  'missing rows are virtual disconnected revision zero slots'
);
select is(
  (select pg_catalog.count(*)::bigint from public.google_chat_webhook_settings),
  (select row_count from fixed_google_chat_catalog_before),
  'snapshot projection writes no connection row'
);
select is(
  (
    select value ->> 'revision'
    from pg_catalog.jsonb_array_elements(
      dashboard_private.notification_control_plane_snapshot_v1('tasks', true)
        -> 'connections'
    ) connection(value)
    where value ->> 'connection_key' = 'google_chat.science'
  ),
  '1',
  'stored disconnected science revision is preserved'
);

select pg_temp.notification_runtime_set_service_role();
set local role service_role;
select lives_ok(
  $sql$
    select public.replace_google_chat_connection_v1(
      '30000000-0000-4000-8000-000000000001',
      'english',
      'https://chat.googleapis.com/v1/spaces/ENGLISH/messages?key=new-key&token=new-token',
      'v1:new-iv:new-tag:new-ciphertext',
      'chat.googleapis.com/v1/spaces/…/messages',
      0,
      '30000000-0000-4000-8000-000000000411'
    )
  $sql$,
  'absent English row accepts expected revision zero'
);
reset role;
select ok(
  (
    select connection_state = 'encrypted_active' and revision = 1
    from public.google_chat_webhook_settings
    where channel = 'english'
  )
  and (
    select value ->> 'connection_state' = 'encrypted_active'
      and value ->> 'revision' = '1'
    from pg_catalog.jsonb_array_elements(
      dashboard_private.notification_control_plane_snapshot_v1('tasks', true)
        -> 'connections'
    ) connection(value)
    where value ->> 'connection_key' = 'google_chat.english'
  ),
  'revision zero replacement becomes a stored revision one connection'
);
rollback to savepoint fixed_google_chat_catalog;
release savepoint fixed_google_chat_catalog;
```

`tests/notification-science-provider-zero.test.mjs`의 구조 assertion도 `plan(234)`로 정확히 갱신한다.

- [ ] **Step 7: secret-safe server-only preflight를 구현한다**

브라우저 catalog에는 env 이름을 넣지 않는다. preflight 모듈 안에만 server-only mapping을 두고 기존 URL validator를 import한다.

```js
import { pathToFileURL } from "node:url"
import { createClient } from "@supabase/supabase-js"

import { GOOGLE_CHAT_CONNECTION_CATALOG } from "../src/features/notifications/notification-google-chat-catalog.ts"
import { isAllowedGoogleChatWebhookUrl } from "../src/features/notifications/server/notification-connection-crypto.ts"

const LEGACY_ENVIRONMENT_KEY_BY_CHANNEL = Object.freeze({
  admin: "GOOGLE_CHAT_WEBHOOK_ADMIN",
  executive: "GOOGLE_CHAT_WEBHOOK_EXECUTIVE",
  english: "GOOGLE_CHAT_WEBHOOK_ENGLISH",
  math: "GOOGLE_CHAT_WEBHOOK_MATH",
  science: null,
})

export function findGoogleChatConnectionFallbackConflicts({
  storedChannels,
  environment,
}) {
  const stored = new Set(storedChannels)
  return GOOGLE_CHAT_CONNECTION_CATALOG
    .filter(({ channel }) => {
      const legacyEnvironmentKey = LEGACY_ENVIRONMENT_KEY_BY_CHANNEL[channel]
      if (stored.has(channel) || legacyEnvironmentKey === null) return false
      return isAllowedGoogleChatWebhookUrl(environment[legacyEnvironmentKey])
    })
    .map(({ connectionKey }) => connectionKey)
}

export class GoogleChatConnectionFallbackConflictError extends Error {
  constructor(connectionKeys) {
    super("google_chat_connection_fallback_conflict")
    this.name = "GoogleChatConnectionFallbackConflictError"
    this.connectionKeys = Object.freeze([...connectionKeys])
  }
}

export async function runGoogleChatConnectionFallbackPreflight({
  environment = process.env,
  createClientImpl = createClient,
} = {}) {
  const supabaseUrl =
    environment.NEXT_PUBLIC_SUPABASE_URL || environment.VITE_SUPABASE_URL || ""
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY || ""
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("google_chat_connection_preflight_configuration_missing")
  }
  const supabase = createClientImpl(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await supabase
    .from("google_chat_webhook_settings")
    .select("channel")
  if (error || !Array.isArray(data)) {
    throw new Error("google_chat_connection_preflight_db_read_failed")
  }
  const conflicts = findGoogleChatConnectionFallbackConflicts({
    storedChannels: data.map(({ channel }) => channel),
    environment,
  })
  if (conflicts.length > 0) {
    throw new GoogleChatConnectionFallbackConflictError(conflicts)
  }
  return Object.freeze({ ok: true, checkedChannelCount: data.length })
}

function isDirectRun() {
  return typeof process.argv[1] === "string"
    && import.meta.url === pathToFileURL(process.argv[1]).href
}

if (isDirectRun()) {
  try {
    await runGoogleChatConnectionFallbackPreflight()
    console.log("google_chat_connection_preflight_passed")
  } catch (error) {
    const safeDetail = error instanceof GoogleChatConnectionFallbackConflictError
      ? `: ${error.connectionKeys.join(",")}`
      : ""
    console.error(`google_chat_connection_preflight_failed${safeDetail}`)
    process.exitCode = 1
  }
}
```

test는 `createClientImpl`에 query builder double을 주입해 `.select("channel")`만 호출되는지 확인한다. import만 했을 때 `isDirectRun()`이 false라 CLI가 실행되지 않아야 한다. 충돌 오류는 connection key 목록만 보유하고, catch는 원래 error message·DB response·URL·env 값·service-role key를 출력하지 않는다. 자동 import·delete·update는 구현하지 않는다.

`package.json`:

```json
"preflight:google-chat-connections": "node --experimental-strip-types scripts/preflight-google-chat-connection-fallbacks.mjs"
```

- [ ] **Step 8: focused tests와 pgTAP을 실행해 GREEN을 확인한다**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-google-chat-connection-catalog.test.mjs tests/notification-control-plane-model.test.mjs tests/notification-control-plane-api.test.mjs tests/notification-control-plane-ui.test.mjs tests/notification-science-provider-zero.test.mjs
```

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/supabase-migration-layout.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/verify-supabase-migration-layout.mjs
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase migration list --local
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase migration up --local
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase test db --local supabase/tests/notification_control_plane_runtime_test.sql
```

Expected: migration list의 pending set이 정확히 `20260730143000_notification_google_chat_connection_catalog.sql` 하나일 때만 `migration up --local`을 실행하고 모두 PASS. 다른 pending migration이 있거나 pgTAP 실행 환경이 없으면 PASS로 간주하지 말고 격리 local DB를 준비할 때까지 이 Task의 커밋을 보류한다.

- [ ] **Step 9: 정적 검증, diff 검토, Task 1 커밋 후 멈춘다**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/eslint/bin/eslint.js src/features/notifications/notification-google-chat-catalog.ts src/features/notifications/notification-control-plane-types.ts src/features/notifications/server/notification-connection-repository.ts src/features/notifications/notification-control-panel.tsx src/features/notifications/notification-control-plane-model.ts scripts/preflight-google-chat-connection-fallbacks.mjs tests/notification-google-chat-connection-catalog.test.mjs tests/notification-control-plane-model.test.mjs tests/notification-control-plane-api.test.mjs tests/notification-control-plane-ui.test.mjs tests/notification-science-provider-zero.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/next/dist/bin/next build --webpack
git diff --check
git status --short
git diff --stat -- package.json scripts/preflight-google-chat-connection-fallbacks.mjs src/features/notifications/notification-google-chat-catalog.ts src/features/notifications/notification-control-plane-types.ts src/features/notifications/server/notification-connection-repository.ts src/features/notifications/notification-control-panel.tsx src/features/notifications/notification-control-plane-model.ts supabase/migrations/20260730143000_notification_google_chat_connection_catalog.sql supabase/tests/notification_control_plane_runtime_test.sql tests/notification-google-chat-connection-catalog.test.mjs tests/notification-control-plane-model.test.mjs tests/notification-control-plane-api.test.mjs tests/notification-control-plane-ui.test.mjs tests/notification-science-provider-zero.test.mjs
git diff -- package.json scripts/preflight-google-chat-connection-fallbacks.mjs src/features/notifications/notification-google-chat-catalog.ts src/features/notifications/notification-control-plane-types.ts src/features/notifications/server/notification-connection-repository.ts src/features/notifications/notification-control-panel.tsx src/features/notifications/notification-control-plane-model.ts supabase/migrations/20260730143000_notification_google_chat_connection_catalog.sql supabase/tests/notification_control_plane_runtime_test.sql tests/notification-google-chat-connection-catalog.test.mjs tests/notification-control-plane-model.test.mjs tests/notification-control-plane-api.test.mjs tests/notification-control-plane-ui.test.mjs tests/notification-science-provider-zero.test.mjs
```

Expected: scoped diff에는 정확히 Task 1 파일만 있고 secret, webhook URL 값, `assistant`, provider 호출, seed DML, runtime/rule 변경이 없다. 전체 `git status`의 unrelated 변경은 그대로 보존되고 stage 대상에 포함되지 않는다.

Commit:

```bash
git add package.json scripts/preflight-google-chat-connection-fallbacks.mjs src/features/notifications/notification-google-chat-catalog.ts src/features/notifications/notification-control-plane-types.ts src/features/notifications/server/notification-connection-repository.ts src/features/notifications/notification-control-panel.tsx src/features/notifications/notification-control-plane-model.ts supabase/migrations/20260730143000_notification_google_chat_connection_catalog.sql supabase/tests/notification_control_plane_runtime_test.sql tests/notification-google-chat-connection-catalog.test.mjs tests/notification-control-plane-model.test.mjs tests/notification-control-plane-api.test.mjs tests/notification-control-plane-ui.test.mjs tests/notification-science-provider-zero.test.mjs
git commit -m "feat: project fixed Google Chat connection catalog"
```

커밋 후 사용자에게 테스트 결과와 diff 요약을 보고하고 다음 Task 승인을 기다린다.

---

### Task 2: Google Chat provider에서만 전체 URL을 만든다

**Files:**
- Modify: `src/features/notifications/server/providers/google-chat-provider.ts`
- Modify: `src/features/notifications/server/notification-worker.ts`
- Modify: `tests/notification-control-plane-worker.test.mjs`

**Interfaces:**
- Consumes: `GoogleChatBegunDeliveryContext.href: string | null`.
- Produces: Google Chat payload의 `https://tipsedu.co.kr/admin/...` URL.
- Produces: 잘못된 non-null href의 `failed/render_validation_failed`.
- Preserves: 내부 event/delivery/adapter의 상대 href와 webhook transport 상태기계.

- [ ] **Step 1: 전체 URL과 fetch 0회 실패 테스트를 작성한다**

기존 `GOOGLE_CHAT_URL`과 `createBegunGoogleChatContext()` fixture를 재사용해 transport와 context를 완전히 정의한다.

```js
const { createGoogleChatProvider } = await import(googleChatProviderModuleUrl)
const TASK_ID = "ea3cd6e1-e2da-4f9d-833e-c7349c09ee31"
const fetchCalls = []
const provider = createGoogleChatProvider({
  fetch: async (input, init) => {
    fetchCalls.push({ input, init: structuredClone(init) })
    return new Response(JSON.stringify({ name: "spaces/fixture/messages/full-url" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  },
})
const sent = await provider.send(createBegunGoogleChatContext({
  rendered_title: "퇴원 처리",
  rendered_body: "홍길동 학생의 퇴원 업무를 확인해 주세요.",
  href: `/admin/withdrawal?flow=operations&taskId=${TASK_ID}`,
}))
assert.equal(sent.status, "sent")
assert.equal(fetchCalls.length, 1)
assert.equal(
  JSON.parse(fetchCalls[0].init.body).text,
  [
    "퇴원 처리",
    "홍길동 학생의 퇴원 업무를 확인해 주세요.",
    `https://tipsedu.co.kr/admin/withdrawal?flow=operations&taskId=${TASK_ID}`,
  ].join("\n"),
)
```

아래 invalid runtime 값을 각각 별도 context로 보내고 transport call 수가 늘지 않는지 확인한다.

```js
const invalidHrefs = [
  "",
  undefined,
  42,
  { pathname: "/admin/withdrawal" },
  "https://tipsedu.co.kr/admin/withdrawal?taskId=x",
  "https://evil.invalid/admin/withdrawal",
  "//evil.invalid/admin/withdrawal",
  "javascript:alert(1)",
  "/admin/../login",
  "/admin/%2e%2e/login",
  "/admin\\withdrawal",
  "/admin/withdrawal\u0000",
  "/admin/withdrawal\n?taskId=x",
  "/login?next=/admin/withdrawal",
]

for (const href of invalidHrefs) {
  const callsBefore = fetchCalls.length
  const result = await provider.send(createBegunGoogleChatContext({ href }))
  assert.equal(result.status, "failed")
  assert.equal(result.statusReason, "render_validation_failed")
  assert.equal(result.errorCode, "render_validation_failed")
  assert.equal(result.errorSummary, "notification link invalid")
  assert.equal(fetchCalls.length, callsBefore)
}
```

`href: null`은 링크 없는 기존 메시지로 허용하고 제목·본문 두 줄만 전송되는지 고정한다.

```js
const callsBeforeNull = fetchCalls.length
const noLink = await provider.send(createBegunGoogleChatContext({
  rendered_title: "제목",
  rendered_body: "본문",
  href: null,
}))
assert.equal(noLink.status, "sent")
assert.equal(fetchCalls.length, callsBeforeNull + 1)
assert.equal(JSON.parse(fetchCalls.at(-1).init.body).text, "제목\n본문")
```

worker의 기존 delivery RPC harness에 `render_validation_failed` provider 결과를 넣고
claim부터 finalize까지 완전한 실행 경로를 확인한다.

```js
test("worker는 Google Chat render validation 실패를 재시도 없는 확정 실패로 보존한다", async () => {
  const { createNotificationWorkerRuntime } = await import(workerModuleUrl)
  const begunContext = createBegunGoogleChatContext()
  const harness = createRpcHarness({
    claim_notification_deliveries_v1: [createDeliveryClaim()],
    prepare_notification_immediate_delivery_v1: begunContext,
    register_notification_external_attempt_v1: {
      allowed: true,
      attempt_id: "70000000-0000-4000-8000-000000000011",
    },
    finalize_notification_delivery_v1: { ok: true },
  })
  let providerCalls = 0
  const provider = {
    async send(input) {
      providerCalls += 1
      assert.deepEqual(input, begunContext)
      return {
        status: "failed",
        statusReason: "render_validation_failed",
        providerMessageId: null,
        providerResponseCode: null,
        errorCode: "render_validation_failed",
        errorSummary: "notification link invalid",
        nextAttemptAt: null,
      }
    },
  }
  const worker = createNotificationWorkerRuntime({
    getAdapter: () => createAdapter(),
    rpc: harness.rpc,
    getProvider: (channelKey) => channelKey === "google_chat" ? provider : null,
    createRunId: () => RUN_ID,
  })

  const result = await worker.runBatch({
    workerId: "worker-render-validation-fixture",
    batchSize: 1,
    leaseSeconds: 30,
  })

  assert.equal(result.deliveries, 1)
  assert.equal(providerCalls, 1)
  const finalize = harness.calls.find(
    (call) => call.name === "finalize_notification_delivery_v1",
  )
  assert.equal(finalize.parameters.p_status, "failed")
  assert.equal(finalize.parameters.p_status_reason, "render_validation_failed")
  assert.equal(finalize.parameters.p_error_code, "render_validation_failed")
  assert.equal(finalize.parameters.p_error_summary, "notification link invalid")
  assert.equal(finalize.parameters.p_next_attempt_at, null)
  assertNoSensitiveValue(finalize.parameters)
})
```

- [ ] **Step 2: focused test를 실행해 RED를 확인한다**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-control-plane-worker.test.mjs
```

Expected: 현재 provider가 상대 경로를 그대로 payload에 넣고 `render_validation_failed` mapping이 없으므로 FAIL.

- [ ] **Step 3: provider의 고정-origin resolver를 구현한다**

`google-chat-provider.ts`에 공개 origin과 discriminated resolver를 둔다.

```ts
const GOOGLE_CHAT_APP_ORIGIN = "https://tipsedu.co.kr"
const SAFE_GOOGLE_CHAT_APP_HREF = /^\/admin\/[^\u0000-\u001f\u007f\\]*$/

type GoogleChatAppUrlResult =
  | Readonly<{ ok: true; url: string | null }>
  | Readonly<{ ok: false }>

function resolveGoogleChatAppUrl(value: unknown): GoogleChatAppUrlResult {
  if (value === null) return { ok: true, url: null }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("//") ||
    !SAFE_GOOGLE_CHAT_APP_HREF.test(value)
  ) {
    return { ok: false }
  }
  try {
    const resolved = new URL(value, GOOGLE_CHAT_APP_ORIGIN)
    if (
      resolved.origin !== GOOGLE_CHAT_APP_ORIGIN ||
      !resolved.pathname.startsWith("/admin/") ||
      `${resolved.pathname}${resolved.search}${resolved.hash}` !== value
    ) {
      return { ok: false }
    }
    return { ok: true, url: resolved.toString() }
  } catch {
    return { ok: false }
  }
}
```

webhook/context 기본 검증 뒤, transport 호출 전에 resolver를 적용한다.

```ts
const appUrl = resolveGoogleChatAppUrl(context.href)
if (!appUrl.ok) {
  return result("failed", "render_validation_failed", {
    errorCode: "render_validation_failed",
    errorSummary: "notification link invalid",
  })
}
```

payload의 세 번째 줄에는 `context.href` 대신 `appUrl.url`을 사용한다. origin은 export하거나 외부 입력으로 받지 않는다.

- [ ] **Step 4: worker가 render validation을 확정 실패로 보존하게 한다**

`normalizeProviderResult()` mapping에 추가한다.

```ts
render_validation_failed: {
  status: "failed",
  reason: "render_validation_failed",
  errorCode: "render_validation_failed",
  errorSummary: "notification link invalid",
},
```

이 mapping이 없을 때 적용되는 `provider_ambiguous_response` fallback을 사용하면 안 된다. 위 RPC assertion으로 `p_status = failed`, `p_status_reason = render_validation_failed`, `p_next_attempt_at = null`을 고정한다.

- [ ] **Step 5: focused test와 정적 검증을 실행해 GREEN을 확인한다**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-control-plane-worker.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/eslint/bin/eslint.js src/features/notifications/server/providers/google-chat-provider.ts src/features/notifications/server/notification-worker.ts tests/notification-control-plane-worker.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/next/dist/bin/next build --webpack
```

Expected: 모두 PASS, test double 외 실제 network 0회.

- [ ] **Step 6: diff 검토, Task 2 커밋 후 멈춘다**

Run:

```bash
git diff --check
git status --short
git diff --stat -- src/features/notifications/server/providers/google-chat-provider.ts src/features/notifications/server/notification-worker.ts tests/notification-control-plane-worker.test.mjs
git diff -- src/features/notifications/server/providers/google-chat-provider.ts src/features/notifications/server/notification-worker.ts tests/notification-control-plane-worker.test.mjs
```

Expected: provider와 worker, 해당 test만 변경. event/delivery href, DB migration, connection, rule, runtime 설정은 변경 없음.

Commit:

```bash
git add src/features/notifications/server/providers/google-chat-provider.ts src/features/notifications/server/notification-worker.ts tests/notification-control-plane-worker.test.mjs
git commit -m "fix: send absolute Google Chat app links"
```

커밋 후 사용자에게 테스트 결과와 fetch 0회 증거를 보고하고 다음 Task 승인을 기다린다.

---

### Task 3: 전반·퇴원 링크에 상태별 flow를 넣는다

**Files:**
- Create: `src/features/notifications/server/adapters/ops-transition-notification-deep-link.ts`
- Modify: `src/features/notifications/server/adapters/immediate-notification-adapter.ts`
- Modify: `src/features/notifications/server/adapters/transfer-notification-adapter.ts`
- Modify: `src/features/notifications/server/adapters/withdrawal-notification-adapter.ts`
- Create: `supabase/migrations/20260730143100_notification_transfer_withdrawal_deep_links.sql`
- Modify: `tests/notification-transfer-withdrawal-adapters.test.mjs`
- Modify: `tests/notification-workflow-registry.test.mjs`
- Modify: `supabase/tests/notification_transfer_withdrawal_adapters_test.sql`

**Interfaces:**
- Produces: `buildOpsTransitionNotificationDeepLink()`.
- Extends internal config: `deepLinkBuilder?: (input: NotificationRenderInput) => string | null`.
- Produces: SQL helper `dashboard_private.notification_ops_task_deep_link_v1(text, uuid, text)`.
- Preserves: 일반 할 일과 단어 재시험 legacy 경로, runtime marker version 1, 기존 RPC ACL.

- [ ] **Step 1: TypeScript 상태 매핑의 실패 테스트를 작성한다**

먼저 새 helper 파일에 type export와 아래 의도적인 미구현 함수만 둔다. 유효 상태 test가 `notification_transition_deep_link_not_implemented`에서 RED가 되며 module-not-found를 성공적인 RED로 사용하지 않는다.

```ts
export type OpsTransitionNotificationWorkflowKey = "transfer" | "withdrawal"
export type OpsTransitionNotificationFlow = "applicant" | "operations" | "closed"

export function buildOpsTransitionNotificationDeepLink(): string {
  throw new Error("notification_transition_deep_link_not_implemented")
}
```

전반과 퇴원 각각 아래 7개 상태를 table-driven으로 검증한다.

```js
const deepLinkModuleUrl = new URL(
  "../src/features/notifications/server/adapters/ops-transition-notification-deep-link.ts",
  import.meta.url,
)
const { buildOpsTransitionNotificationDeepLink } = await import(deepLinkModuleUrl)
const TASK_ID = "ea3cd6e1-e2da-4f9d-833e-c7349c09ee31"
const flowByStatus = new Map([
  ["requested", "applicant"],
  ["confirmed", "operations"],
  ["in_progress", "operations"],
  ["on_hold", "operations"],
  ["review_requested", "operations"],
  ["done", "closed"],
  ["canceled", "closed"],
])

for (const workflowKey of ["transfer", "withdrawal"]) {
  for (const [status, flow] of flowByStatus) {
    assert.equal(
      buildOpsTransitionNotificationDeepLink({ workflowKey, taskId: TASK_ID, status }),
      `/admin/${workflowKey}?flow=${flow}&taskId=${TASK_ID}`,
    )
  }
}
```

unknown/null/공백 포함 status, 잘못된 workflow, non-UUID/null/공백 포함 task ID는 모두 `notification_payload_schema_unsupported`로 throw해야 한다. 실제 transfer/withdrawal adapter의 `buildDeepLink()`와 worker fanout batch에 저장되는 별도 `href`도 같은 결과인지 확인한다. `buildRenderContext()`에 `deep_link`를 새로 추가하지 않는다. 두 workflow template의 allowed variables에는 그 변수가 없기 때문이다.

- [ ] **Step 2: legacy SQL과 migration 구조의 실패 테스트를 작성한다**

먼저 `14:31` migration 파일을 transaction wrapper와 `20260716191000_notification_transfer_withdrawal_producers.sql:873-1057`의 변경 전 public plan 함수만 복사한 scaffold로 만든다. helper와 flow 변경은 아직 넣지 않는다. 따라서 새 URL은 읽을 수 있지만 behavior assertion은 old taskId-only 링크에서 RED가 된다.

`tests/notification-transfer-withdrawal-adapters.test.mjs` 상단에 새 active migration URL을 명시한다.

```js
const deepLinkMigrationUrl = new URL(
  "../supabase/migrations/20260730143100_notification_transfer_withdrawal_deep_links.sql",
  import.meta.url,
)
```

링크 관련 SQL assertion은 이전 producer migration이 아니라 `deepLinkMigrationUrl`의 source를 읽는다. Node 구조 테스트는 다음을 확인한다.

- helper가 정확히 7개 상태를 세 flow로 매핑.
- query parameter 순서가 `flow`, `taskId`.
- `get_ops_task_legacy_dispatch_plan_v1()`이 `v_task.type`, `v_task.id`, `v_canonical.payload ->> 'status'`로 helper를 호출.
- 일반 할 일 `/admin/tasks?taskId=...`와 단어 재시험 `/admin/word-retests?taskId=...` 유지.
- unknown transition status가 SQLSTATE `22023`, message `ops_task_notification_deep_link_invalid`.
- migration에 runtime flag/rule/owner/provider 변경 DML이 없음.

pgTAP은 private helper의 14개 조합을 한 번에 고정한다.

```sql
reset role;
select is(
  (
    select pg_catalog.jsonb_object_agg(
      task_type || ':' || status,
      dashboard_private.notification_ops_task_deep_link_v1(
        task_type,
        '72000000-0000-4000-8000-000000000090'::uuid,
        status
      )
      order by task_type, status
    )
    from (values
      ('transfer', 'requested'), ('transfer', 'confirmed'),
      ('transfer', 'in_progress'), ('transfer', 'on_hold'),
      ('transfer', 'review_requested'), ('transfer', 'done'),
      ('transfer', 'canceled'), ('withdrawal', 'requested'),
      ('withdrawal', 'confirmed'), ('withdrawal', 'in_progress'),
      ('withdrawal', 'on_hold'), ('withdrawal', 'review_requested'),
      ('withdrawal', 'done'), ('withdrawal', 'canceled')
    ) status_fixture(task_type, status)
  ),
  '{
    "transfer:requested":"/admin/transfer?flow=applicant&taskId=72000000-0000-4000-8000-000000000090",
    "transfer:confirmed":"/admin/transfer?flow=operations&taskId=72000000-0000-4000-8000-000000000090",
    "transfer:in_progress":"/admin/transfer?flow=operations&taskId=72000000-0000-4000-8000-000000000090",
    "transfer:on_hold":"/admin/transfer?flow=operations&taskId=72000000-0000-4000-8000-000000000090",
    "transfer:review_requested":"/admin/transfer?flow=operations&taskId=72000000-0000-4000-8000-000000000090",
    "transfer:done":"/admin/transfer?flow=closed&taskId=72000000-0000-4000-8000-000000000090",
    "transfer:canceled":"/admin/transfer?flow=closed&taskId=72000000-0000-4000-8000-000000000090",
    "withdrawal:requested":"/admin/withdrawal?flow=applicant&taskId=72000000-0000-4000-8000-000000000090",
    "withdrawal:confirmed":"/admin/withdrawal?flow=operations&taskId=72000000-0000-4000-8000-000000000090",
    "withdrawal:in_progress":"/admin/withdrawal?flow=operations&taskId=72000000-0000-4000-8000-000000000090",
    "withdrawal:on_hold":"/admin/withdrawal?flow=operations&taskId=72000000-0000-4000-8000-000000000090",
    "withdrawal:review_requested":"/admin/withdrawal?flow=operations&taskId=72000000-0000-4000-8000-000000000090",
    "withdrawal:done":"/admin/withdrawal?flow=closed&taskId=72000000-0000-4000-8000-000000000090",
    "withdrawal:canceled":"/admin/withdrawal?flow=closed&taskId=72000000-0000-4000-8000-000000000090"
  }'::jsonb,
  'transition helper maps the exact seven statuses for both workflows'
);
```

기존 transfer/withdrawal 완료 fixture는 제출 event 생성 후 현재 task 상태가 이미 이동한
delayed-transition 사례다. 기존 transfer assertion을 바꾸고 withdrawal assertion을 새로
추가해, 두 workflow 모두 현재 task의 `done`이 아니라 event snapshot의
`requested → applicant`를 사용함을 완전한 pgTAP 문장으로 검증한다.

```sql
select is(
  (
    public.get_ops_task_legacy_dispatch_plan_v1(
      (
        select event_row.id
        from public.ops_task_events event_row
        where event_row.task_id = (
          select fixture.task_id
          from ops_transition_fixtures fixture
          where fixture.fixture_key = 'transfer'
        )
          and event_row.event_type = 'transfer.submitted'
      ),
      '72000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items' -> 0 ->> 'href'
  ),
  '/admin/transfer?flow=applicant&taskId=' || (
    select fixture.task_id::text
    from ops_transition_fixtures fixture
    where fixture.fixture_key = 'transfer'
  ),
  '완료된 전반의 제출 계획도 event snapshot의 applicant 링크를 반환한다'
);

select is(
  (
    public.get_ops_task_legacy_dispatch_plan_v1(
      (
        select event_row.id
        from public.ops_task_events event_row
        where event_row.task_id = (
          select fixture.task_id
          from ops_transition_fixtures fixture
          where fixture.fixture_key = 'withdrawal'
        )
          and event_row.event_type = 'withdrawal.submitted'
      ),
      '72000000-0000-4000-8000-000000000001'::uuid
    ) -> 'items' -> 0 ->> 'href'
  ),
  '/admin/withdrawal?flow=applicant&taskId=' || (
    select fixture.task_id::text
    from ops_transition_fixtures fixture
    where fixture.fixture_key = 'withdrawal'
  ),
  '완료된 퇴원의 제출 계획도 event snapshot의 applicant 링크를 반환한다'
);
```

unsupported/null/공백 입력은 `ops_tasks_status_check`를 우회하지 않고 private helper를 직접 검사한다.

```sql
select throws_ok(
  $$select dashboard_private.notification_ops_task_deep_link_v1(
    'transfer', '72000000-0000-4000-8000-000000000090'::uuid, null
  )$$,
  '22023', 'ops_task_notification_deep_link_invalid',
  'null transition status fails closed'
);
select throws_ok(
  $$select dashboard_private.notification_ops_task_deep_link_v1(
    'transfer', '72000000-0000-4000-8000-000000000090'::uuid, ' requested '
  )$$,
  '22023', 'ops_task_notification_deep_link_invalid',
  'whitespace-padded transition status fails closed'
);
select throws_ok(
  $$select dashboard_private.notification_ops_task_deep_link_v1(
    null, '72000000-0000-4000-8000-000000000090'::uuid, 'requested'
  )$$,
  '22023', 'ops_task_notification_deep_link_invalid',
  'null task type fails closed'
);
select throws_ok(
  $$select dashboard_private.notification_ops_task_deep_link_v1(
    'transfer', null, 'requested'
  )$$,
  '22023', 'ops_task_notification_deep_link_invalid',
  'null task id fails closed'
);
```

- [ ] **Step 3: focused tests를 실행해 RED를 확인한다**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-transfer-withdrawal-adapters.test.mjs tests/notification-workflow-registry.test.mjs
```

Expected: 현재 canonical과 legacy 링크 모두 `flow`가 없으므로 FAIL.

- [ ] **Step 4: 공용 TypeScript deep-link builder를 구현한다**

`ops-transition-notification-deep-link.ts`:

```ts
export type OpsTransitionNotificationWorkflowKey = "transfer" | "withdrawal"
export type OpsTransitionNotificationFlow = "applicant" | "operations" | "closed"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const FLOW_BY_STATUS: Readonly<Record<string, OpsTransitionNotificationFlow>> = {
  requested: "applicant",
  confirmed: "operations",
  in_progress: "operations",
  on_hold: "operations",
  review_requested: "operations",
  done: "closed",
  canceled: "closed",
}

export function buildOpsTransitionNotificationDeepLink(input: Readonly<{
  workflowKey: OpsTransitionNotificationWorkflowKey
  taskId: unknown
  status: unknown
}>): string {
  const taskId = typeof input.taskId === "string" ? input.taskId : ""
  const status = typeof input.status === "string" ? input.status : ""
  const flow = FLOW_BY_STATUS[status]
  if (
    (input.workflowKey !== "transfer" && input.workflowKey !== "withdrawal") ||
    !UUID_PATTERN.test(taskId) ||
    !flow
  ) {
    throw new Error("notification_payload_schema_unsupported")
  }
  const query = new URLSearchParams()
  query.set("flow", flow)
  query.set("taskId", taskId)
  return `/admin/${input.workflowKey}?${query.toString()}`
}
```

- [ ] **Step 5: immediate adapter에 workflow별 builder를 주입한다**

`ImmediateNotificationAdapterConfig`에 다음 optional field를 추가한다.

```ts
deepLinkBuilder?: (input: NotificationRenderInput) => string | null
```

`buildImmediateDeepLink()`의 공통 source/workflow 검증 뒤 기존 generic ID 처리 전에 호출한다.

```ts
if (config.deepLinkBuilder) return config.deepLinkBuilder(input)
```

전반 adapter:

```ts
deepLinkBuilder: (input) => buildOpsTransitionNotificationDeepLink({
  workflowKey: "transfer",
  taskId: input.payload.task_id,
  status: input.payload.status,
}),
```

퇴원 adapter에는 아래 코드를 그대로 넣는다. 두 adapter 모두 잘못된 값에서 `linkRoot`로 fallback하지 않는다.

```ts
deepLinkBuilder: (input) => buildOpsTransitionNotificationDeepLink({
  workflowKey: "withdrawal",
  taskId: input.payload.task_id,
  status: input.payload.status,
}),
```

- [ ] **Step 6: legacy SQL helper와 forward-only migration을 구현한다**

`14:31` migration은 `begin;`과 `set local lock_timeout = '5s';`로 시작하고 helper를 추가한다.

```sql
create or replace function dashboard_private.notification_ops_task_deep_link_v1(
  p_task_type text,
  p_task_id uuid,
  p_status text
) returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_flow text;
begin
  if p_task_type is null or p_task_id is null then
    raise exception 'ops_task_notification_deep_link_invalid' using errcode = '22023';
  end if;
  if p_task_type = 'general' then
    return '/admin/tasks?taskId=' || p_task_id::text;
  elsif p_task_type = 'word_retest' then
    return '/admin/word-retests?taskId=' || p_task_id::text;
  elsif p_task_type not in ('transfer', 'withdrawal') then
    raise exception 'ops_task_notification_deep_link_invalid' using errcode = '22023';
  end if;

  v_flow := case p_status
    when 'requested' then 'applicant'
    when 'confirmed' then 'operations'
    when 'in_progress' then 'operations'
    when 'on_hold' then 'operations'
    when 'review_requested' then 'operations'
    when 'done' then 'closed'
    when 'canceled' then 'closed'
    else null
  end;
  if v_flow is null then
    raise exception 'ops_task_notification_deep_link_invalid' using errcode = '22023';
  end if;
  return '/admin/' || p_task_type || '?flow=' || v_flow || '&taskId=' || p_task_id::text;
end;
$$;
```

`20260716191000_notification_transfer_withdrawal_producers.sql:873-1057`의 `public.get_ops_task_legacy_dispatch_plan_v1(uuid, uuid)` 정의를 정확히 복사한다. 원본 968-973행의 `v_deep_link := case ... end`는 삭제하고, canonical event 조회의 `if not found ... end if;` 직후인 원본 995행 다음에 아래 코드를 삽입한다. `v_canonical`을 채우기 전에 payload를 읽으면 안 된다.

```sql
v_deep_link := dashboard_private.notification_ops_task_deep_link_v1(
  v_task.type,
  v_task.id,
  v_canonical.payload ->> 'status'
);
```

이 호출은 현재 `ops_tasks.status`가 아니라 notification event에 저장된 status snapshot을 사용한다. event 생성 뒤 task가 이동해도 canonical과 legacy가 서로 다른 flow를 만들지 않는다.

Node 구조 test는 원본 함수에서 968-973행만 제거한 normalized frame과 새 함수에서 helper call만 제거한 normalized frame이 같은지 비교한다. 또한 helper call이 canonical event `select ... into v_canonical`과 `if not found` 뒤, final JSON aggregation 앞에 위치하는지 index 순서로 확인한다.

helper owner와 직접 실행 권한을 닫고 public plan의 기존 권한을 다시 명시한 뒤 `commit;`한다.

```sql
alter function dashboard_private.notification_ops_task_deep_link_v1(
  text, uuid, text
) owner to postgres;
revoke all on function dashboard_private.notification_ops_task_deep_link_v1(
  text, uuid, text
) from public, anon, authenticated, service_role;
alter function public.get_ops_task_legacy_dispatch_plan_v1(uuid, uuid)
  owner to postgres;
revoke all on function public.get_ops_task_legacy_dispatch_plan_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_ops_task_legacy_dispatch_plan_v1(uuid, uuid)
  to service_role;

commit;
```

pgTAP은 `public`, `anon`, `authenticated`, `service_role` 모두 private helper 직접 EXECUTE 불가, public plan은 service-role만 EXECUTE 가능, public plan의 `stable`, `security definer`, 빈 search path를 확인한다. `transfer_withdrawal_notification_producers_runtime_version()`은 계속 `1`이다.

- [ ] **Step 7: focused tests와 pgTAP을 실행해 GREEN을 확인한다**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-transfer-withdrawal-adapters.test.mjs tests/notification-workflow-registry.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/supabase-migration-layout.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/verify-supabase-migration-layout.mjs
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase migration list --local
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase migration up --local
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase test db --local supabase/tests/notification_transfer_withdrawal_adapters_test.sql
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/eslint/bin/eslint.js src/features/notifications/server/adapters/ops-transition-notification-deep-link.ts src/features/notifications/server/adapters/immediate-notification-adapter.ts src/features/notifications/server/adapters/transfer-notification-adapter.ts src/features/notifications/server/adapters/withdrawal-notification-adapter.ts tests/notification-transfer-withdrawal-adapters.test.mjs tests/notification-workflow-registry.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/next/dist/bin/next build --webpack
```

Expected: pending set이 Task 1 적용 이후 정확히 `20260730143100_notification_transfer_withdrawal_deep_links.sql` 하나인지 확인한 경우에만 migration을 적용하고 모두 PASS. 다른 pending migration 또는 pgTAP 환경 부재 시 커밋하지 않는다.

- [ ] **Step 8: diff 검토, Task 3 커밋 후 멈춘다**

Run:

```bash
git diff --check
git status --short
git diff --stat -- src/features/notifications/server/adapters/ops-transition-notification-deep-link.ts src/features/notifications/server/adapters/immediate-notification-adapter.ts src/features/notifications/server/adapters/transfer-notification-adapter.ts src/features/notifications/server/adapters/withdrawal-notification-adapter.ts supabase/migrations/20260730143100_notification_transfer_withdrawal_deep_links.sql supabase/tests/notification_transfer_withdrawal_adapters_test.sql tests/notification-transfer-withdrawal-adapters.test.mjs tests/notification-workflow-registry.test.mjs
git diff -- src/features/notifications/server/adapters/ops-transition-notification-deep-link.ts src/features/notifications/server/adapters/immediate-notification-adapter.ts src/features/notifications/server/adapters/transfer-notification-adapter.ts src/features/notifications/server/adapters/withdrawal-notification-adapter.ts supabase/migrations/20260730143100_notification_transfer_withdrawal_deep_links.sql supabase/tests/notification_transfer_withdrawal_adapters_test.sql tests/notification-transfer-withdrawal-adapters.test.mjs tests/notification-workflow-registry.test.mjs
```

Expected: 전반·퇴원 링크 파일과 해당 migration/test만 변경. 다른 workflow의 href, provider, rule, runtime, owner는 변경 없음.

Commit:

```bash
git add src/features/notifications/server/adapters/ops-transition-notification-deep-link.ts src/features/notifications/server/adapters/immediate-notification-adapter.ts src/features/notifications/server/adapters/transfer-notification-adapter.ts src/features/notifications/server/adapters/withdrawal-notification-adapter.ts supabase/migrations/20260730143100_notification_transfer_withdrawal_deep_links.sql supabase/tests/notification_transfer_withdrawal_adapters_test.sql tests/notification-transfer-withdrawal-adapters.test.mjs tests/notification-workflow-registry.test.mjs
git commit -m "fix: add flow-aware transition notification links"
```

커밋 후 사용자에게 7개 상태의 canonical/legacy 일치 결과를 보고하고 다음 Task 승인을 기다린다.

---

### Task 4: 최근 전달 요약을 현재 owner 기준으로 합친다

**Files:**
- Create: `supabase/migrations/20260730143200_notification_owner_aware_delivery_summary.sql`
- Create: `tests/notification-control-plane-owner-aware-summary.test.mjs`
- Create: `supabase/tests/notification_control_plane_owner_aware_summary_test.sql`

**Interfaces:**
- Consumes canonical identity: event `workflow_key`, `occurrence_key` + delivery `rule_id`, `channel_key`, `target_key`, `target_generation`.
- Consumes legacy identity: ownership claim의 동일 6개 필드.
- Produces existing DTO only: `pending_count`, `sent_count`, `failed_count`, `unknown_count`, `latest_delivery_at`.
- Excludes from identity: `owner_generation`, `dispatch_token`, `provider_reference`.
- Preserves: Task 1의 연결 catalog projection과 control-plane 함수 ACL.

- [ ] **Step 1: migration 구조의 실패 테스트를 작성한다**

먼저 `14:32` migration 파일을 `14:30` snapshot의 변경 전 복사본과 동일 owner/ACL wrapper를 가진 scaffold로 만든다. owner-aware CTE는 아직 넣지 않는다. 이로써 structure test가 `ERR_MODULE_NOT_FOUND`가 아니라 기존 canonical-only summary 때문에 RED가 된다.

`tests/notification-control-plane-owner-aware-summary.test.mjs`는 두 migration URL과 함수/frame 추출 helper를 완전히 정의한다.

```js
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const catalogUrl = new URL(
  "../supabase/migrations/20260730143000_notification_google_chat_connection_catalog.sql",
  import.meta.url,
)
const ownerUrl = new URL(
  "../supabase/migrations/20260730143200_notification_owner_aware_delivery_summary.sql",
  import.meta.url,
)

function normalizeSql(source) {
  return source.replace(/--.*$/gm, " ").replace(/\s+/g, " ").trim().toLowerCase()
}

function functionBlock(source, qualifiedName) {
  const start = source.indexOf(`create or replace function ${qualifiedName}`)
  assert.notEqual(start, -1)
  const end = source.indexOf("\n$$;", start)
  assert.notEqual(end, -1)
  return source.slice(start, end + 4)
}

function snapshotFrame(block) {
  const summary = block.indexOf("'delivery_summary'")
  const loaded = block.indexOf("'loaded_at'", summary)
  assert.ok(summary > 0 && loaded > summary)
  return {
    beforeSummary: normalizeSql(block.slice(0, summary)),
    afterSummary: normalizeSql(block.slice(loaded)),
    summary: normalizeSql(block.slice(summary, loaded)),
  }
}

test("14:32 preserves the complete 14:30 snapshot outside delivery_summary", async () => {
  const [catalogSql, ownerSql] = await Promise.all([
    readFile(catalogUrl, "utf8"),
    readFile(ownerUrl, "utf8"),
  ])
  const functionName =
    "dashboard_private.notification_control_plane_snapshot_v1"
  const catalog = snapshotFrame(functionBlock(catalogSql, functionName))
  const owner = snapshotFrame(functionBlock(ownerSql, functionName))
  assert.equal(owner.beforeSummary, catalog.beforeSummary)
  assert.equal(owner.afterSummary, catalog.afterSummary)
  assert.match(
    normalizeSql(ownerSql),
    /revoke all on function dashboard_private[.]notification_control_plane_snapshot_v1[(]text, boolean[)] from public, anon, authenticated, service_role;/,
  )
})

test("owner-aware identity uses the exact six fields in rank and join", async () => {
  const source = normalizeSql(await readFile(ownerUrl, "utf8"))
  const partition = (
    source.match(/partition by ([\s\S]+?) order by delivery_row[.]updated_at/)?.[1] ?? ""
  ).trim()
  const ownershipJoin = (
    source.match(
    /left join dashboard_private[.]notification_dispatch_ownership_claims ownership_row ([\s\S]+?) where event_row[.]scope_key/,
    )?.[1] ?? ""
  ).trim()
  assert.ok(partition)
  assert.ok(ownershipJoin)
  assert.match(
    partition,
    /event_row[.]workflow_key, event_row[.]occurrence_key, delivery_row[.]rule_id, delivery_row[.]channel_key, delivery_row[.]target_key, delivery_row[.]target_generation$/,
  )
  for (const equality of [
    "ownership_row.workflow_key = event_row.workflow_key",
    "ownership_row.occurrence_key = event_row.occurrence_key",
    "ownership_row.rule_id = delivery_row.rule_id",
    "ownership_row.channel_key = delivery_row.channel_key",
    "ownership_row.target_key = delivery_row.target_key",
    "ownership_row.target_generation = delivery_row.target_generation",
  ]) {
    assert.ok(ownershipJoin.includes(equality))
  }
  assert.doesNotMatch(
    `${partition} ${ownershipJoin}`,
    /owner_generation|dispatch_token|provider_reference/,
  )
})
```

추가 구조 계약:

- `owner_kind = 'legacy'` claim이 있으면 같은 identity canonical delivery 제외.
- canonical owner 또는 claim 없음이면 canonical 대표 행 사용.
- terminal outcome이 legacy state보다 우선.
- `reserved → pending`, `dispatch_started/closed + null → delivery_unknown`.
- delivery/claim/event/audit 테이블 DML, runtime flag, rule update, provider/network 코드 없음.
- 위 frame equality로 rules/registry, safe serializer, 5개 catalog, 정렬, revision `"0"`, `loaded_at`까지 Task 1의 전체 snapshot을 보존.
- 함수가 `stable`, `security definer`, `set search_path = ''`와 기존 ACL을 유지.

- [ ] **Step 2: 독립 pgTAP fixture를 작성하고 RED를 확인한다**

`supabase/tests/notification_control_plane_owner_aware_summary_test.sql`은 독립 transaction을 사용한다.

```sql
begin;
select plan(9);

create temporary table owner_summary_rule on commit drop as
select
  id as rule_id,
  revision as rule_revision,
  active_template_id as template_id
from dashboard_private.notification_rules
where workflow_key = 'withdrawal'
  and event_key = 'withdrawal.completed'
  and channel_key = 'google_chat'
  and audience_key = 'management_team'
order by id
limit 1;

do $$
begin
  if (select pg_catalog.count(*) from owner_summary_rule) <> 1 then
    raise exception 'owner_summary_rule_fixture_missing';
  end if;
end;
$$;

create function pg_temp.owner_summary(p_workflow_key text) returns jsonb
language sql stable set search_path = '' as $$
  select dashboard_private.notification_control_plane_snapshot_v1(
    p_workflow_key,
    false
  ) -> 'delivery_summary'
$$;

create function pg_temp.add_canonical(
  p_source_id text,
  p_occurrence_key text,
  p_target_key text,
  p_target_generation bigint,
  p_status text,
  p_status_reason text,
  p_updated_at timestamptz
) returns void
language plpgsql volatile set search_path = '' as $$
declare
  v_event_id uuid := pg_catalog.gen_random_uuid();
  v_rule record;
begin
  select * into strict v_rule from pg_temp.owner_summary_rule;
  insert into dashboard_private.notification_events(
    id, scope_key, workflow_key, event_key, source_type, source_id,
    occurrence_key, occurred_at, payload_schema_version, payload, rule_snapshot,
    created_at
  ) values (
    v_event_id, 'global', 'withdrawal', 'withdrawal.completed',
    'owner_summary_fixture', p_source_id, p_occurrence_key, p_updated_at, 1,
    '{}'::jsonb, '[]'::jsonb, p_updated_at
  );
  insert into dashboard_private.notification_deliveries(
    event_id, rule_id, rule_revision, template_id, channel_key, audience_key,
    target_generation, target_set_hash, target_kind, target_key,
    connection_key, target_snapshot, status, status_reason, dedupe_key,
    rendered_title, rendered_body, href, scheduled_for, attempt_count,
    max_attempts, claimed_by, claim_token, lease_expires_at, next_attempt_at,
    created_at, updated_at
  ) values (
    v_event_id, v_rule.rule_id, v_rule.rule_revision, v_rule.template_id,
    'google_chat', 'management_team', p_target_generation,
    'owner-summary-target-set', 'connection', p_target_key,
    'google_chat.management',
    pg_catalog.jsonb_build_object('connection_key', 'google_chat.management'),
    p_status, p_status_reason,
    'owner-summary:' || p_source_id || ':' || p_target_generation::text,
    'fixture title', 'fixture body',
    '/admin/withdrawal?flow=closed&taskId=72000000-0000-4000-8000-000000000099',
    p_updated_at, 0, 3,
    case when p_status in ('claimed', 'sending') then 'owner-summary-worker' else null end,
    case when p_status in ('claimed', 'sending') then pg_catalog.gen_random_uuid() else null end,
    case when p_status in ('claimed', 'sending') then p_updated_at + interval '1 minute' else null end,
    case when p_status = 'retry_wait' then p_updated_at + interval '1 minute' else null end,
    p_updated_at, p_updated_at
  );
end;
$$;

create function pg_temp.add_legacy(
  p_workflow_key text,
  p_occurrence_key text,
  p_target_key text,
  p_target_generation bigint,
  p_owner_generation bigint,
  p_state text,
  p_terminal_outcome text,
  p_updated_at timestamptz
) returns void
language sql volatile set search_path = '' as $$
  insert into dashboard_private.notification_dispatch_ownership_claims(
    workflow_key, occurrence_key, rule_id, channel_key, target_key,
    target_generation, owner_kind, owner_generation, state,
    dispatch_started_at, dispatch_token, terminal_outcome, updated_at
  )
  select
    p_workflow_key, p_occurrence_key, rule_id, 'google_chat', p_target_key,
    p_target_generation, 'legacy', p_owner_generation, p_state,
    case when p_state = 'reserved' then null else p_updated_at end,
    case when p_state = 'reserved' then null else pg_catalog.gen_random_uuid() end,
    p_terminal_outcome, p_updated_at
  from pg_temp.owner_summary_rule
$$;

create temporary table owner_summary_cp(
  name text primary key,
  summary jsonb not null
) on commit drop;
insert into owner_summary_cp values (
  'baseline',
  pg_temp.owner_summary('withdrawal')
);
```

fixture 묶음마다 `owner_summary_cp`에 checkpoint를 추가하고 바로 이전 checkpoint와 delta를 비교한다. 아래 첫 assertion은 production과 유사한 legacy 16건을 기존 data와 격리해 검증한다.

```sql
select pg_temp.add_legacy(
  'withdrawal',
  'owner-summary-legacy-' || fixture_no::text,
  'connection:legacy-' || fixture_no::text,
  0, 0, 'closed', 'sent',
  '2099-01-01 00:00:00+00'::timestamptz + fixture_no * interval '1 second'
)
from pg_catalog.generate_series(1, 16) fixture_no;
insert into owner_summary_cp values ('legacy16', pg_temp.owner_summary('withdrawal'));
select ok(
  (
    (select (summary ->> 'sent_count')::bigint from owner_summary_cp where name = 'legacy16')
    -
    (select (summary ->> 'sent_count')::bigint from owner_summary_cp where name = 'baseline')
  ) = 16,
  'legacy-only sent claims add exactly sixteen completed deliveries'
);
```

나머지 상태 fixture와 checkpoint를 순서대로 추가한다.

```sql
select pg_temp.add_legacy(
  'withdrawal', 'owner-summary-state-' || fixture_no::text,
  'connection:state-' || fixture_no::text, 0, 0, state, outcome,
  '2099-02-01 00:00:00+00'::timestamptz + fixture_no * interval '1 second'
)
from (values
  (1, 'reserved', null),
  (2, 'dispatch_started', null),
  (3, 'closed', 'sent'),
  (4, 'closed', 'failed'),
  (5, 'closed', 'delivery_unknown'),
  (6, 'closed', null)
) fixture(fixture_no, state, outcome);
insert into owner_summary_cp values ('legacy-states', pg_temp.owner_summary('withdrawal'));
select ok(
  (
    select pg_catalog.jsonb_build_array(
      (current.summary ->> 'pending_count')::bigint - (previous.summary ->> 'pending_count')::bigint,
      (current.summary ->> 'sent_count')::bigint - (previous.summary ->> 'sent_count')::bigint,
      (current.summary ->> 'failed_count')::bigint - (previous.summary ->> 'failed_count')::bigint,
      (current.summary ->> 'unknown_count')::bigint - (previous.summary ->> 'unknown_count')::bigint
    )
    from owner_summary_cp current cross join owner_summary_cp previous
    where current.name = 'legacy-states' and previous.name = 'legacy16'
  ) = '[1,1,1,3]'::jsonb,
  'legacy states map to pending sent failed and unknown exactly'
);

select pg_temp.add_canonical(
  'canonical-state-' || fixture_no::text,
  'owner-summary-canonical-state-' || fixture_no::text,
  'connection:canonical-state-' || fixture_no::text,
  0, status, reason,
  '2099-03-01 00:00:00+00'::timestamptz + fixture_no * interval '1 second'
)
from (values
  (1, 'pending', null),
  (2, 'claimed', null),
  (3, 'sending', null),
  (4, 'retry_wait', 'provider_rate_limited'),
  (5, 'sent', null),
  (6, 'failed', 'connection_missing'),
  (7, 'delivery_unknown', 'provider_ambiguous_response')
) fixture(fixture_no, status, reason);
insert into owner_summary_cp values ('canonical-states', pg_temp.owner_summary('withdrawal'));
select ok(
  (
    select pg_catalog.jsonb_build_array(
      (current.summary ->> 'pending_count')::bigint - (previous.summary ->> 'pending_count')::bigint,
      (current.summary ->> 'sent_count')::bigint - (previous.summary ->> 'sent_count')::bigint,
      (current.summary ->> 'failed_count')::bigint - (previous.summary ->> 'failed_count')::bigint,
      (current.summary ->> 'unknown_count')::bigint - (previous.summary ->> 'unknown_count')::bigint
    )
    from owner_summary_cp current cross join owner_summary_cp previous
    where current.name = 'canonical-states' and previous.name = 'legacy-states'
  ) = '[4,1,1,1]'::jsonb,
  'canonical statuses preserve the existing summary mapping'
);

select pg_temp.add_canonical(
  'canonical-latest-old', 'owner-summary-canonical-latest',
  'connection:canonical-latest', 0, 'failed', 'connection_missing',
  '2099-04-01 00:00:01+00'
);
select pg_temp.add_canonical(
  'canonical-latest-new', 'owner-summary-canonical-latest',
  'connection:canonical-latest', 0, 'sent', null,
  '2099-04-01 00:00:02+00'
);
insert into owner_summary_cp values ('canonical-latest', pg_temp.owner_summary('withdrawal'));
select ok(
  (
    select
      (current.summary ->> 'sent_count')::bigint - (previous.summary ->> 'sent_count')::bigint = 1
      and
      (current.summary ->> 'failed_count')::bigint - (previous.summary ->> 'failed_count')::bigint = 0
    from owner_summary_cp current cross join owner_summary_cp previous
    where current.name = 'canonical-latest' and previous.name = 'canonical-states'
  ),
  'latest canonical evidence represents one logical identity'
);

select pg_temp.add_canonical(
  'generation-zero', 'owner-summary-generations',
  'connection:generations', 0, 'sent', null, '2099-04-02 00:00:01+00'
);
select pg_temp.add_canonical(
  'generation-one', 'owner-summary-generations',
  'connection:generations', 1, 'sent', null, '2099-04-02 00:00:02+00'
);
insert into owner_summary_cp values ('target-generations', pg_temp.owner_summary('withdrawal'));
select ok(
  (
    select
      (current.summary ->> 'sent_count')::bigint
      - (previous.summary ->> 'sent_count')::bigint
    from owner_summary_cp current cross join owner_summary_cp previous
    where current.name = 'target-generations' and previous.name = 'canonical-latest'
  ) = 2,
  'target_generation is the sixth logical identity field'
);

select pg_temp.add_canonical(
  'owner-generation-canonical', 'owner-summary-owner-generation',
  'connection:owner-generation', 0, 'sent', null, '2099-04-03 00:00:01+00'
);
select pg_temp.add_legacy(
  'withdrawal', 'owner-summary-owner-generation',
  'connection:owner-generation', 0, 7, 'closed', 'failed',
  '2099-04-03 00:00:02+00'
);
insert into owner_summary_cp values ('owner-generation', pg_temp.owner_summary('withdrawal'));
select ok(
  (
    select
      (current.summary ->> 'sent_count')::bigint - (previous.summary ->> 'sent_count')::bigint = 0
      and
      (current.summary ->> 'failed_count')::bigint - (previous.summary ->> 'failed_count')::bigint = 1
    from owner_summary_cp current cross join owner_summary_cp previous
    where current.name = 'owner-generation' and previous.name = 'target-generations'
  ),
  'owner_generation does not split the logical identity'
);

select pg_temp.add_canonical(
  'legacy-deduped-shadow', 'owner-summary-legacy-deduped',
  'connection:legacy-deduped', 0, 'skipped', 'legacy_deduped',
  '2099-12-31 00:00:00+00'
);
select pg_temp.add_legacy(
  'withdrawal', 'owner-summary-legacy-deduped',
  'connection:legacy-deduped', 0, 0, 'closed', 'sent',
  '2099-06-01 00:00:00+00'
);
insert into owner_summary_cp values ('legacy-deduped', pg_temp.owner_summary('withdrawal'));
select ok(
  (
    select
      (current.summary ->> 'sent_count')::bigint
        - (previous.summary ->> 'sent_count')::bigint = 1
      and (current.summary ->> 'latest_delivery_at')::timestamptz
        = '2099-06-01 00:00:00+00'::timestamptz
    from owner_summary_cp current cross join owner_summary_cp previous
    where current.name = 'legacy-deduped' and previous.name = 'owner-generation'
  ),
  'legacy owner preserves sent evidence and excludes the later canonical shadow'
);

select pg_temp.add_canonical(
  'canonical-plus-legacy', 'owner-summary-canonical-plus-legacy',
  'connection:canonical-plus-legacy', 0, 'sent', null,
  '2099-05-01 00:00:01+00'
);
select pg_temp.add_legacy(
  'withdrawal', 'owner-summary-canonical-plus-legacy',
  'connection:canonical-plus-legacy', 0, 0, 'closed', 'sent',
  '2099-05-01 00:00:02+00'
);
insert into owner_summary_cp values (
  'canonical-plus-legacy',
  pg_temp.owner_summary('withdrawal')
);
select ok(
  (
    select
      (current.summary ->> 'sent_count')::bigint
      - (previous.summary ->> 'sent_count')::bigint
    from owner_summary_cp current cross join owner_summary_cp previous
    where current.name = 'canonical-plus-legacy'
      and previous.name = 'legacy-deduped'
  ) = 1,
  'canonical and legacy evidence for a legacy-owned identity count once'
);
```

no-write fingerprint helper:

```sql
create function pg_temp.owner_summary_fingerprint() returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'events', (
      select pg_catalog.md5(coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(event_row) order by event_row.id)::text,
        '[]'
      ))
      from dashboard_private.notification_events event_row
      where event_row.source_type = 'owner_summary_fixture'
    ),
    'deliveries', (
      select pg_catalog.md5(coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(delivery_row) order by delivery_row.id)::text,
        '[]'
      ))
      from dashboard_private.notification_deliveries delivery_row
      join dashboard_private.notification_events event_row
        on event_row.id = delivery_row.event_id
      where event_row.source_type = 'owner_summary_fixture'
    ),
    'claims', (
      select pg_catalog.md5(coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(claim_row) order by claim_row.id)::text,
        '[]'
      ))
      from dashboard_private.notification_dispatch_ownership_claims claim_row
      where claim_row.occurrence_key like 'owner-summary-%'
    ),
    'audit', (
      select pg_catalog.md5(coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(audit_row) order by audit_row.id)::text,
        '[]'
      ))
      from dashboard_private.notification_audit_logs audit_row
    )
  )
$$;

create temporary table owner_summary_before(fingerprint jsonb not null) on commit drop;
select pg_temp.add_legacy(
  'tasks', 'owner-summary-other-workflow',
  'connection:other-workflow', 0, 0, 'closed', 'sent',
  '2100-01-01 00:00:00+00'
);
insert into owner_summary_cp values (
  'before-read-call',
  pg_temp.owner_summary('withdrawal')
);
insert into owner_summary_before values (pg_temp.owner_summary_fingerprint());
insert into owner_summary_cp values ('read-call', pg_temp.owner_summary('withdrawal'));
select ok(
  pg_temp.owner_summary_fingerprint() = (select fingerprint from owner_summary_before)
  and (
    select current.summary = previous.summary
    from owner_summary_cp current cross join owner_summary_cp previous
    where current.name = 'read-call' and previous.name = 'before-read-call'
  ),
  'other workflows are excluded and snapshot changes no event delivery claim or audit content'
);
select * from finish();
rollback;
```

Run:

```bash
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase test db --local supabase/tests/notification_control_plane_owner_aware_summary_test.sql
```

Expected: 현재 snapshot이 canonical delivery만 조회하므로 legacy fixture assertion이 FAIL.

- [ ] **Step 3: owner-aware projection을 포함한 최종 snapshot migration을 작성한다**

`14:32` migration은 `begin;`과 `set local lock_timeout = '5s';`로 시작한다. `14:30` migration의 전체 `notification_control_plane_snapshot_v1(text, boolean)` 정의를 정확히 복사하고 연결 expression을 그대로 둔 채 `'delivery_summary'` 값만 아래 expression으로 교체한다.

```sql
'delivery_summary', (
  with canonical_ranked as (
    select
      event_row.workflow_key,
      event_row.occurrence_key,
      delivery_row.rule_id,
      delivery_row.channel_key,
      delivery_row.target_key,
      delivery_row.target_generation,
      delivery_row.status as projected_status,
      delivery_row.updated_at as evidence_updated_at,
      pg_catalog.row_number() over (
        partition by
          event_row.workflow_key,
          event_row.occurrence_key,
          delivery_row.rule_id,
          delivery_row.channel_key,
          delivery_row.target_key,
          delivery_row.target_generation
        order by delivery_row.updated_at desc, delivery_row.id desc
      ) as identity_rank
    from dashboard_private.notification_deliveries delivery_row
    join dashboard_private.notification_events event_row
      on event_row.id = delivery_row.event_id
    left join dashboard_private.notification_dispatch_ownership_claims ownership_row
      on ownership_row.workflow_key = event_row.workflow_key
     and ownership_row.occurrence_key = event_row.occurrence_key
     and ownership_row.rule_id = delivery_row.rule_id
     and ownership_row.channel_key = delivery_row.channel_key
     and ownership_row.target_key = delivery_row.target_key
     and ownership_row.target_generation = delivery_row.target_generation
    where event_row.scope_key = 'global'
      and event_row.workflow_key = p_workflow_key
      and ownership_row.owner_kind is distinct from 'legacy'
  ),
  projected_evidence as (
    select
      canonical_row.projected_status,
      canonical_row.evidence_updated_at
    from canonical_ranked canonical_row
    where canonical_row.identity_rank = 1

    union all

    select
      case
        when ownership_row.terminal_outcome = 'sent' then 'sent'
        when ownership_row.terminal_outcome = 'failed' then 'failed'
        when ownership_row.terminal_outcome = 'delivery_unknown' then 'delivery_unknown'
        when ownership_row.state = 'reserved' then 'pending'
        else 'delivery_unknown'
      end as projected_status,
      ownership_row.updated_at as evidence_updated_at
    from dashboard_private.notification_dispatch_ownership_claims ownership_row
    where ownership_row.workflow_key = p_workflow_key
      and ownership_row.owner_kind = 'legacy'
  )
  select pg_catalog.jsonb_build_object(
    'pending_count', pg_catalog.count(*) filter (
      where evidence_row.projected_status in (
        'pending', 'claimed', 'sending', 'retry_wait'
      )
    ),
    'sent_count', pg_catalog.count(*) filter (
      where evidence_row.projected_status = 'sent'
    ),
    'failed_count', pg_catalog.count(*) filter (
      where evidence_row.projected_status = 'failed'
    ),
    'unknown_count', pg_catalog.count(*) filter (
      where evidence_row.projected_status = 'delivery_unknown'
    ),
    'latest_delivery_at', pg_catalog.max(evidence_row.evidence_updated_at)
  )
  from projected_evidence evidence_row
),
```

canonical `skipped`, `disabled`, `canceled`는 기존처럼 네 count에 포함되지 않지만, 현재 owner의 대표 canonical 증거이면 `latest_delivery_at` 후보에는 남는다. legacy terminal outcome은 state보다 먼저 평가한다. owner가 legacy인 identity의 canonical shadow/skipped 행은 count와 latest 모두에서 제외한다.

함수 뒤에는 owner/ACL과 transaction 종결을 정확히 둔다.

```sql
alter function dashboard_private.notification_control_plane_snapshot_v1(text, boolean)
  owner to postgres;
revoke all on function dashboard_private.notification_control_plane_snapshot_v1(text, boolean)
  from public, anon, authenticated, service_role;

commit;
```

- [ ] **Step 4: owner-aware focused tests를 실행해 GREEN을 확인한다**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-control-plane-owner-aware-summary.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/supabase-migration-layout.test.mjs
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/verify-supabase-migration-layout.mjs
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase migration list --local
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase migration up --local
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase test db --local supabase/tests/notification_control_plane_owner_aware_summary_test.sql
```

Expected: pending set이 Task 1·3 적용 이후 정확히 `20260730143200_notification_owner_aware_delivery_summary.sql` 하나일 때만 적용하고 모두 PASS. 특히 legacy `sent` +16 delta, 중복 +1, workflow 격리, content fingerprint no-write assertion이 통과해야 한다.

- [ ] **Step 5: 전체 notification 회귀와 정적 검증을 실행한다**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/notification-control-plane-*.test.mjs tests/notification-google-chat-connection-catalog.test.mjs tests/notification-transfer-withdrawal-adapters.test.mjs tests/notification-workflow-registry.test.mjs tests/notification-science-provider-zero.test.mjs
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase test db --local supabase/tests/notification_control_plane_runtime_test.sql
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase test db --local supabase/tests/notification_transfer_withdrawal_adapters_test.sql
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase test db --local supabase/tests/notification_control_plane_owner_aware_summary_test.sql
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/eslint/bin/eslint.js src tests scripts/preflight-google-chat-connection-fallbacks.mjs middleware.ts next.config.ts
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/next/dist/bin/next build --webpack
```

Expected: 모든 명령 exit 0. Webpack build 성공은 DB migration 적용이나 provider 발송 성공을 뜻하지 않는다.

- [ ] **Step 6: 격리된 DB가 있을 때만 read-only 브라우저 QA를 수행한다**

모든 3개 migration이 적용된 로컬 또는 별도 staging DB가 있을 때만 `/admin/settings/notifications`를 연다. 운영 DB에는 이 단계에서 migration을 적용하지 않는다.

확인 항목:

- 연결 탭에 관리팀, 경영팀, 영어팀, 수학팀, 과학팀이 정확한 순서로 표시.
- `경영진`과 `조교팀` 문구 없음.
- 누락 슬롯은 연결 안 됨으로 표시되며 검증·해제 비활성.
- 퇴원 workflow의 최근 전달 완료 건수와 마지막 시각이 legacy fixture와 일치.
- 저장, 연결 교체, 연결 검증, 테스트 메시지, 연결 해제 버튼은 누르지 않음.
- browser/network log에 Google Chat webhook 요청 0건.

격리된 data-bearing 환경이 없으면 UI QA를 PASS로 쓰지 말고 `pending: isolated migrated DB required`로 남긴다.

- [ ] **Step 7: 전체 diff를 검토하고 Task 4 커밋 후 멈춘다**

Run:

```bash
git diff --check
git status --short
git diff --stat -- supabase/migrations/20260730143200_notification_owner_aware_delivery_summary.sql supabase/tests/notification_control_plane_owner_aware_summary_test.sql tests/notification-control-plane-owner-aware-summary.test.mjs
git diff -- supabase/migrations/20260730143200_notification_owner_aware_delivery_summary.sql supabase/tests/notification_control_plane_owner_aware_summary_test.sql tests/notification-control-plane-owner-aware-summary.test.mjs
```

검토 체크:

- `14:32` snapshot에 Task 1의 5개 connection projection이 그대로 존재.
- 논리 identity는 정확히 6개 필드이며 `owner_generation`이 없음.
- legacy와 canonical이 단순 합산되지 않음.
- DML, backfill, provider 호출, rule/runtime/owner 전환 없음.
- 기존 DTO와 UI 구성 변경 없음.

Commit:

```bash
git add supabase/migrations/20260730143200_notification_owner_aware_delivery_summary.sql supabase/tests/notification_control_plane_owner_aware_summary_test.sql tests/notification-control-plane-owner-aware-summary.test.mjs
git commit -m "fix: make notification delivery summary owner aware"
```

커밋 후 전체 회귀 결과, 남아 있는 브라우저 QA gate, provider 0회 상태를 보고하고 멈춘다.

---

## Separately Authorized Release Gate

다음은 네 로컬 Task가 모두 완료되어도 자동 실행하지 않는다.

1. production release는 `server-only preflight → DB migrations → parser/UI application deploy` 순서로만 진행한다. strict 5-slot parser/UI를 DB projection보다 먼저 배포하면 기존 3~4행 snapshot을 502로 거절할 수 있으므로 순서를 바꾸지 않는다.
2. production DB에는 read-only preflight만 먼저 실행한다.

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --experimental-strip-types scripts/preflight-google-chat-connection-fallbacks.mjs
```

3. missing DB row + valid legacy env 충돌이 하나라도 나오면 channel key만 보고하고 release를 중단한다.
4. URL import 또는 env 제거는 별도 운영 승인과 별도 변경 기록 아래 수행한다.
5. 충돌이 0이면 linked migration history와 pending 파일 목록을 read-only로 확인한다. 적용 대상이 아래 세 파일과 정확히 일치하지 않으면 중단한다.

```text
20260730143000_notification_google_chat_connection_catalog.sql
20260730143100_notification_transfer_withdrawal_deep_links.sql
20260730143200_notification_owner_aware_delivery_summary.sql
```

6. migration 적용 전 secret-free baseline을 별도 파일에 보관한다.

- webhook settings: `channel`, `connection_state`, `revision`, `webhook_url_mask`, `last_verified_at`, `last_error_code`만 조회. plaintext URL과 ciphertext는 조회·출력하지 않음.
- notification events/deliveries/ownership claims/audit logs: row count와 정렬된 `to_jsonb` content hash.
- runtime flags: key, enabled, revision.
- rules: id, workflow, enabled, revision, active template ID.
- ownership: 6-field identity, owner kind, owner generation, state, terminal outcome.
- 현재 control-plane snapshot의 5-slot/summary JSON과 loaded time을 분리해 저장.

7. 사용자가 production DB 적용을 별도로 승인한 뒤에만 세 migration을 적용한다. 적용 직후 같은 baseline query를 다시 실행해 다음만 변경되었는지 확인한다.

- snapshot read model에 5개 fixed slot과 owner-aware summary가 생김.
- settings/events/deliveries/claims/audit/runtime/rules/owner content hash와 상태는 불변.
- migration history에는 승인된 세 파일만 추가.

8. DB 검증이 끝난 뒤에만 Git push와 Vercel production 배포를 별도 승인으로 수행한다. 배포 SHA가 승인된 로컬·remote `main`과 같은지 확인한다.
9. production 브라우저에서는 `/admin/settings/notifications`와 전반·퇴원 딥링크를 read-only로 확인한다.
10. 실제 Google Chat 테스트 메시지는 이 release gate에도 포함하지 않는다. 필요하면 수신 space, 시각, 메시지 1건, 중복 허용 여부를 다시 승인받은 별도 provider 검증으로 수행한다.

완료 보고는 아래 증거를 분리한다.

- 로컬 test/lint/typecheck/build
- migration 파일 작성
- 격리 DB pgTAP
- 운영 preflight
- 운영 DB migration 적용
- Git push
- Vercel deployment SHA/READY
- production browser 관찰
- provider 실제 발송 여부
