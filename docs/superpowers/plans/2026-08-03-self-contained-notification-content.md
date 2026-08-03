# 대시보드·Google Chat 자기완결형 알림 콘텐츠 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드와 Google Chat 알림이 링크를 열지 않아도 대상·발생한 일·핵심 값·현재 진행 상태를 정확히 이해할 수 있게 만들고, 기존 맞춤형 title/body 편집·저장 흐름과 과거 이력을 보존한다.

**Architecture:** rule identity별 server-owned content contract와 workflow별 순수 presentation builder를 추가한다. 도메인 producer는 사람이 읽을 표시명을 event transaction 안에 immutable snapshot으로 보강하고, worker는 full context를 active template version의 immutable allowlist로 필터링한 뒤 렌더한다. DB는 최신 contract를 기준으로 새 template version을 append하고, 시스템 권장본은 pointer를 바꾸지 않은 채 먼저 설치한다. 별도 service-role release RPC가 정확한 system baseline만 CAS 전환·rollback한다. legacy projection과 canonical worker는 같은 fixture로 parity를 증명한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node test runner, Supabase/PostgreSQL, pgTAP, Tailwind CSS, Radix UI, Playwright 기반 브라우저 verifier.

## Global Constraints

- 승인된 상세 설계는 `docs/superpowers/specs/2026-08-03-self-contained-notification-content-design.md`다. 이 계획과 충돌하면 설계의 안전 경계와 의미 계약이 우선한다.
- 구현은 아래 Task를 한 번에 하나만 수행한다. 각 Task에서 RED 확인 → 최소 구현 → focused test → 전체 관련 test → `git diff` 검토 → 해당 파일만 commit한 뒤 멈추고 사용자 승인을 기다린다.
- 과거 migration 파일은 수정하지 않는다. DB 변경은 `20260803130000` 이후의 새 forward migration으로만 추가한다.
- 이 계획 자체는 production DB apply, rule enable, active pointer 전환, dispatch owner 변경, runtime flag 변경, cron/worker 실행, Google Chat/Web Push/SOLAPI 전송, Git push, Vercel 배포를 승인하지 않는다.
- `customer_message`와 독립 Web Push 설정·콘텐츠는 범위 밖이다. 다만 in-app 문구를 상속하는 현재 Web Push 활성 경로가 있으면 production content cutover는 별도 승인을 받을 때까지 막는다.
- Google Chat 대상은 경영팀·관리팀·영어팀·수학팀·과학팀이라는 다섯 destination 중 기존 rule/resolver가 정한 한 곳뿐이다. 한 알림을 다섯 방에 fan-out하지 않는다.
- 기본 문구에는 `[다음]`, 특정 독자 직접 지시, UUID, raw code, ISO 시각, JSON, `null`, `/admin/` 경로를 넣지 않는다. 진행 문장은 `{결재자}님의 결재를 기다리고 있어요.`처럼 단체방 공용 상태로 쓴다.
- `확인 중이에요`는 immutable `progress_state`가 실제 확인 시작을 증명할 때만 쓴다. 그 외에는 `{진행주체}의 확인을 기다리고 있어요.`처럼 대기 상태를 쓴다. 목적지가 과목팀이면 그 과목에 필요한 사실만 context에 포함한다.
- 기존 custom template과 기존 즉시형 `pending`/`retry_wait`, terminal delivery, 이미 생성된 dashboard inbox row는 다시 렌더하거나 덮어쓰지 않는다.
- template version history UI는 추가하지 않는다. 과거 version은 감사·rollback용 DB 이력으로만 보존한다.
- 사용자 소유의 미추적 파일 `docs/superpowers/plans/2026-08-01-registration-notion-status-open-fields.md`는 열거나 stage하지 않는다.
- 모든 테스트 명령의 Node 경로는 다음을 사용한다.

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
TASK_NPM=.codex-temp/tools/npm/bin/npm-cli.js
SUPABASE_CLI=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase
```

## File and Responsibility Map

### Existing source of truth

- Adapter contract: `src/features/notifications/server/notification-workflow-adapter.ts`
- Seven-workflow registry: `src/features/notifications/server/notification-workflow-registry.ts`
- Immediate adapter plumbing: `src/features/notifications/server/adapters/immediate-notification-adapter.ts`
- Canonical renderer/worker: `src/features/notifications/server/notification-worker.ts`
- Google Chat final payload: `src/features/notifications/server/providers/google-chat-provider.ts`
- Legacy in-app projection: `src/features/notifications/server/legacy-in-app-projection.ts`
- Control-plane DTO/model/UI/service/route:
  - `src/features/notifications/notification-control-plane-types.ts`
  - `src/features/notifications/notification-control-plane-model.ts`
  - `src/features/notifications/notification-control-panel.tsx`
  - `src/features/notifications/notification-control-plane-service.ts`
  - `src/features/notifications/server/notification-control-plane-route.ts`
- Latest DB snapshot function: `supabase/migrations/20260730143200_notification_owner_aware_delivery_summary.sql`
- Latest unchecked save implementation: `supabase/migrations/20260722120000_science_notification_connection.sql`
- UI registry/public save wrappers: `supabase/migrations/20260716112500_notification_workflow_settings_seed.sql`
- Registration fixed/legacy rules: `supabase/migrations/20260716194000_notification_registration_handoffs.sql`
- Makeup legacy/canonical boundary: `supabase/migrations/20260716192000_notification_makeup_adapter.sql`

### New shared modules

- `src/features/notifications/notification-content-contract.ts`
- `src/features/notifications/notification-content-contract-registry.ts`
- `src/features/notifications/notification-content-manifest.ts`
- `src/features/notifications/server/presentation/notification-presentation.ts`
- `src/features/notifications/server/presentation/notification-presentation-formatters.ts`
- `src/features/notifications/server/presentation/*-notification-presentation.ts` for seven workflows
- `tests/fixtures/notification-content-contracts.json`
- `tests/fixtures/notification-content-coverage-manifest.json`
- `tests/fixtures/notification-content-golden.json`

### Contract vocabulary that must remain exact

```ts
export type NotificationScopeState =
  | "in_scope"
  | "excluded_channel"
  | "no_rule_event"

export type NotificationConfigurationKind =
  | "editable_rule"
  | "fixed_policy_editable_template"
  | "not_applicable"

export type NotificationEnabledState =
  | "enabled"
  | "disabled"
  | "not_applicable"

export type NotificationDispatchOwner =
  | "canonical"
  | "legacy"
  | "none"

export type NotificationTemplateCompliance =
  | "conformant"
  | "legacy_custom_nonconformant"

export type NotificationDestinationTeam =
  | "management"
  | "executive"
  | "english"
  | "math"
  | "science"

export type NotificationFieldPresenceRule = Readonly<{
  required: boolean
  nullBehavior: "reject" | "omit" | "display"
  nullDisplay: string | null
  emptyArrayBehavior: "reject" | "allow" | "omit"
}>

export type NotificationContentContract = Readonly<{
  contractVersion: string
  availableVariables: ReadonlyArray<NotificationTemplateVariableDto>
  requiredTokens: ReadonlyArray<string>
  optionalLineTokens: ReadonlyArray<string>
  mustHaveFacts: ReadonlyArray<
    "target" | "event" | "current_state" | "before_after" |
    "result" | "progress_actor" | "schedule" | "location"
  >
  supportedPayloadVersions: ReadonlyArray<number>
  destinationPolicy: Readonly<{
    allowedConnectionKeys: ReadonlyArray<NotificationConnectionKey>
    subjectScoped: boolean
  }>
  freeTextVisibility: Readonly<Record<string, "show" | "omit">>
  freeTextPriority: ReadonlyArray<string>
  fieldPresence: Readonly<Record<string, NotificationFieldPresenceRule>>
}>
```

## Required Event-to-Token Matrix

`tests/fixtures/notification-content-contracts.json`과 DB contract row는 아래 48개 event 의미 계약의 required token을 그대로 사용한다. 각 의미 계약은 실제 registry의 event × audience × channel × variant rule identity마다 별도 contract entry로 투영한다. 이 표에 없는 사유·댓글·첨부·진행 행은 `{사유정보}`, `{댓글정보}`, `{첨부정보}`, `{진행정보}`, `{메모정보}` 같은 optional-line token으로만 추가한다.

| Event | Required tokens |
| --- | --- |
| `task.created` | `업무`, `현재상태`, `현재담당` |
| `task.assignee_changed` | `업무`, `기존담당`, `새담당` |
| `task.due_changed` | `업무`, `기존일정`, `새일정` |
| `task.status_changed` | `업무`, `기존상태`, `새상태` |
| `task.completed` | `업무`, `완료상태` |
| `task.canceled` | `업무`, `취소상태` |
| `task.reopened` | `업무`, `기존상태`, `새상태` |
| `task.comment_added` | `업무`, `댓글작성자`, `댓글미리보기` |
| `word_retest.created` | `학생`, `수업`, `시험범위`, `시험일` |
| `word_retest.assigned` | `학생`, `기존담당`, `새담당` |
| `word_retest.schedule_changed` | `학생`, `기존시험일`, `새시험일` |
| `word_retest.started` | `학생`, `수업`, `시험범위`, `시작상태` |
| `word_retest.result_reported` | `학생`, `점수`, `통과기준`, `판정` |
| `word_retest.absent_reported` | `학생`, `시험일`, `판정` |
| `word_retest.revision_requested` | `학생`, `현재결과`, `요청주체` |
| `word_retest.retry_created` | `학생`, `이전결과`, `후속일정` |
| `word_retest.completed` | `학생`, `최종결과` |
| `word_retest.canceled` | `학생`, `취소상태` |
| `registration.case_created` | `학생`, `학년`, `과목`, `문의시각` |
| `registration.registration_completed` | `학생`, `등록과목`, `등록수업`, `완료상태` |
| `registration.case_closed` | `학생`, `과목`, `종료상태` |
| `registration.appointment_reminder_due` | `상담종류`, `학생`, `과목`, `일정`, `장소` |
| `registration.phone_consultation_ready` | `학생`, `과목`, `진행주체` |
| `registration.visit_scheduled` | `학생`, `과목`, `새일정`, `새장소` |
| `registration.visit_rescheduled` | `학생`, `과목`, `기존일정`, `새일정`, `새장소` |
| `registration.visit_replaced` | `학생`, `과목`, `기존예약`, `새예약`, `새장소` |
| `registration.visit_subject_deselected` | `학생`, `제외과목`, `남은과목`, `유지일정`, `유지장소` |
| `registration.visit_canceled` | `학생`, `과목`, `취소일정`, `취소장소` |
| `transfer.submitted` | `학생`, `기존반`, `이동반`, `적용일`, `신청자` |
| `transfer.completed` | `학생`, `기존반`, `이동반`, `기존반종료일`, `새반시작일` |
| `withdrawal.submitted` | `학생`, `과목`, `수업`, `제외일`, `제외회차`, `신청자` |
| `withdrawal.completed` | `학생`, `과목`, `수업`, `제외일`, `제외회차` |
| `makeup.submitted` | `수업`, `과목`, `담당선생님`, `휴강일`, `보강일정`, `장소`, `진행주체` |
| `makeup.refund_requested` | `수업`, `과목`, `대상일정`, `현재상태` |
| `makeup.approved` | `수업`, `과목`, `휴강일`, `보강일정`, `장소`, `승인주체` |
| `makeup.refund_completed` | `수업`, `과목`, `현재상태`, `처리시각` |
| `makeup.approval_canceled` | `수업`, `과목`, `현재상태`, `처리시각`, `처리주체` |
| `makeup.revision_requested` | `수업`, `과목`, `요청주체`, `현재상태` |
| `makeup.rejected` | `수업`, `과목`, `반려주체`, `현재상태` |
| `approval.created` | `문서`, `작성자`, `대상기간`, `현재상태` |
| `approval.submitted` | `문서`, `작성자`, `대상기간`, `진행주체` |
| `approval.review_started` | `문서`, `검토주체`, `현재상태` |
| `approval.approver_changed` | `문서`, `기존결재자`, `새결재자` |
| `approval.approved` | `문서`, `승인주체`, `현재상태`, `처리시각` |
| `approval.returned` | `문서`, `반려주체`, `현재상태` |
| `approval.canceled` | `문서`, `취소주체`, `현재상태` |
| `approval.resubmitted` | `문서`, `재상신자`, `진행주체` |
| `approval.comment_added` | `문서`, `댓글작성자`, `댓글미리보기` |

The manifest must classify the remaining registry events (`transfer.processing_started`, `transfer.details_changed`, `transfer.canceled`, `transfer.reopened`, the matching withdrawal events, `makeup.deleted`, `approval.deleted`, and registration message/customer-only events) as `no_rule_event` or `excluded_channel`; it must not silently omit them.

---

## Task 1: Lock the coverage manifest and TypeScript content contracts

**Files:**

- Create: `src/features/notifications/notification-content-contract.ts`
- Create: `src/features/notifications/notification-content-contract-registry.ts`
- Create: `src/features/notifications/notification-content-manifest.ts`
- Create: `tests/fixtures/notification-content-contracts.json`
- Create: `tests/fixtures/notification-content-coverage-manifest.json`
- Create: `tests/notification-content-contract.test.mjs`
- Create: `tests/notification-content-manifest.test.mjs`
- Modify: `src/features/notifications/notification-control-plane-types.ts`

- [ ] **Step 1: Write the RED manifest test.** Read `NOTIFICATION_EVENT_KEYS_BY_WORKFLOW`, the fixture, and registry-derived identities. Assert every event has exactly one `scopeState`, every rule identity has exactly one `configurationKind`, `enabledState`, and `dispatchOwner`, and reverse comparison finds no fixture-only identity. The fixture stores the approved baseline; later DB evidence overlays current runtime values and reports drift rather than silently rewriting the manifest.

- [ ] **Step 2: Run the focused RED tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-content-contract.test.mjs \
  tests/notification-content-manifest.test.mjs
```

Expected: FAIL because the contract/manifest exports do not exist.

- [ ] **Step 3: Implement the exact types and a fail-closed registry.** Export:

```ts
export function getNotificationContentContract(input: {
  workflowKey: NotificationWorkflowKey
  eventKey: NotificationEventKey
  audienceKey: NotificationAudienceKey
  channelKey: NotificationEditableChannelKey
  ruleVariantKey: string
}): NotificationContentContract | null

export function listNotificationContentContracts(): ReadonlyArray<NotificationContentContractEntry>
export function listNotificationContentCoverage(): ReadonlyArray<NotificationContentCoverageEntry>
```

Reject duplicate identities, duplicate variable keys/tokens, unknown connection keys, empty required tokens, required tokens absent from `availableVariables`, optional tokens not occupying their own semantic line slot, and unsupported payload version `0`.

- [ ] **Step 4: Populate all 48 in-scope event semantic contracts, project them to every existing in-scope rule identity, and classify every excluded/no-rule event.** Use the exact token matrix above; do not use a single generic four-variable contract. `contractVersion` starts at `"1"`. The 48 count applies only to unique event meanings. Never hardcode the projected rule-identity count: derive it at test runtime from the seed/registry, compare manifest ↔ seed in both directions, and fail if one audience/channel/variant identity is omitted or invented.

- [ ] **Step 5: Add three-state field presence cases.** Fixtures must include missing-required rejection, allowed `null` displays (`미배정`, `일정 없음`, `결재자 지정 대기`), disallowed null rejection, and `other_active_subjects: []` distinct from a missing key.

- [ ] **Step 6: Re-run focused tests and the existing registry test.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-content-contract.test.mjs \
  tests/notification-content-manifest.test.mjs \
  tests/notification-workflow-registry.test.mjs
```

Expected: PASS; 48 unique in-scope event meanings are present, every existing in-scope rule tuple resolves a contract, and all other event keys are explicitly classified.

- [ ] **Step 7: Review and commit only Task 1.**

```bash
git diff --check
git diff -- src/features/notifications/notification-content-contract.ts src/features/notifications/notification-content-contract-registry.ts src/features/notifications/notification-content-manifest.ts src/features/notifications/notification-control-plane-types.ts tests/fixtures/notification-content-contracts.json tests/fixtures/notification-content-coverage-manifest.json tests/notification-content-contract.test.mjs tests/notification-content-manifest.test.mjs
git add src/features/notifications/notification-content-contract.ts src/features/notifications/notification-content-contract-registry.ts src/features/notifications/notification-content-manifest.ts src/features/notifications/notification-control-plane-types.ts tests/fixtures/notification-content-contracts.json tests/fixtures/notification-content-coverage-manifest.json tests/notification-content-contract.test.mjs tests/notification-content-manifest.test.mjs
git commit -m "feat: define notification content contracts"
```

Stop and report the test result, diff summary, and commit before Task 2.

---

## Task 2: Add the DB contract registry and versioned save boundary

**Files:**

- Create: `supabase/migrations/20260803140000_notification_content_contracts.sql`
- Create: `supabase/tests/notification_content_contract_test.sql`
- Create: `tests/notification-content-contract-db.test.mjs`
- Modify: `supabase/tests/notification_control_plane_runtime_test.sql`
- Modify: `tests/notification-control-plane-api.test.mjs`
- Modify: `tests/notification-control-plane-seed.test.mjs`

- [ ] **Step 1: Write RED SQL structure and pgTAP assertions.** Require a private, RLS-protected `notification_rule_content_contracts` relation keyed by the five-part rule identity, a contract version, and contract JSON; no browser role gets direct table access.

- [ ] **Step 2: Require these exact DB functions and v2 public RPCs.**

```sql
dashboard_private.notification_content_contract_for_rule_v1(uuid) returns jsonb
dashboard_private.notification_template_contract_violations_v1(uuid,text,text) returns jsonb
dashboard_private.notification_template_compliance_v1(uuid,uuid) returns jsonb
public.save_notification_control_plane_v2(text,jsonb,jsonb,jsonb,uuid) returns jsonb
public.save_notification_control_plane_with_override_v2(text,jsonb,jsonb,jsonb,uuid,uuid,jsonb) returns jsonb
```

The two revision maps are `expected_rule_revisions` and `expected_contract_versions`. Both must match after `FOR UPDATE` locks.

- [ ] **Step 3: Run RED tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-content-contract-db.test.mjs \
  tests/notification-control-plane-api.test.mjs \
  tests/notification-control-plane-seed.test.mjs
```

Expected: FAIL on missing migration/RPC markers.

- [ ] **Step 4: Implement the forward migration.** It must:

  - add `configuration_kind` and `activation_locked` to `notification_settings_ui_registry`;
  - add `content_contract_version` to newly created template snapshots without changing historical title/body/allowlist bytes;
  - create immutable compliance audit rows keyed by `template_id + contract_version`;
  - seed DB contract JSON from the same fixture values as TypeScript;
  - expose registration phone/visit fixed rules in the registration UI registry with `fixed_policy_editable_template` and `activation_locked=true`;
  - leave customer message rules excluded;
  - replace the latest `notification_control_plane_snapshot_v1` definition from `20260730143200_notification_owner_aware_delivery_summary.sql` so each rule returns `configuration_kind`, `activation_locked`, `content_contract`, and `template_compliance`;
  - keep the v1 save RPCs unchanged for old clients and make the new UI use v2 later.

- [ ] **Step 5: Implement v2 save from the latest unchecked implementation in `20260722120000_science_notification_connection.sql`.** The v2 implementation must re-read the contract by locked rule identity, never accept an allowlist from the client, validate required tokens and optional-line placement, snapshot the latest `available_variables` and contract version into the new append-only template, use the existing SHA-256 seed checksum helper, and make identical saves a no-op.

- [ ] **Step 6: Enforce locked policy and warning semantics server-side.** A patch containing `enabled` for an activation-locked rule fails. HTML, external URL, malformed braces, unknown token, missing required token, invalid optional-line placement, title over 200 characters, body over 4,000 characters, and broadcast mention block. `[다음]` and direct imperatives save through the warning flow and produce `legacy_custom_nonconformant`. An already-active legacy Google Chat template containing `deep_link` remains readable/auditable, but a new save is blocked with a remove-link message because the latest contract never offers `deep_link` as an editable variable.

- [ ] **Step 7: Test append-only and custom protection in pgTAP.** Assert old rows are byte-for-byte unchanged, a changed custom body creates exactly one version and increments rule revision once, retry is no-op, active custom is not converted to system, and no enabled/owner/runtime flag changes occur.

- [ ] **Step 8: Prove TypeScript/SQL fixture parity.** For every rule identity, call `notification_content_contract_for_rule_v1`, canonicalize the returned JSON, and deep-compare it with `tests/fixtures/notification-content-contracts.json`, including `contract_version`, array order, field-presence null behavior, destination policy, and free-text priority. Compare both directions so neither DB-only nor fixture-only rows pass.

- [ ] **Step 9: Run Node tests and local pgTAP when the local stack is available.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-content-contract-db.test.mjs \
  tests/notification-control-plane-api.test.mjs \
  tests/notification-control-plane-seed.test.mjs
"$SUPABASE_CLI" test db --local supabase/tests/notification_content_contract_test.sql
"$SUPABASE_CLI" test db --local supabase/tests/notification_control_plane_runtime_test.sql
```

Expected: all Node tests PASS. pgTAP must PASS on an isolated local DB; absence of a local runtime is reported as unverified, never as PASS.

- [ ] **Step 10: Review and commit only Task 2.**

```bash
git diff --check
git diff -- supabase/migrations/20260803140000_notification_content_contracts.sql supabase/tests/notification_content_contract_test.sql supabase/tests/notification_control_plane_runtime_test.sql tests/notification-content-contract-db.test.mjs tests/notification-control-plane-api.test.mjs tests/notification-control-plane-seed.test.mjs
git add supabase/migrations/20260803140000_notification_content_contracts.sql supabase/tests/notification_content_contract_test.sql supabase/tests/notification_control_plane_runtime_test.sql tests/notification-content-contract-db.test.mjs tests/notification-control-plane-api.test.mjs tests/notification-control-plane-seed.test.mjs
git commit -m "feat: add notification content save contracts"
```

Stop before Task 3.

---

## Task 3: Upgrade the control-plane DTO, editor, and fixed-rule UX

**Files:**

- Modify: `src/features/notifications/notification-control-plane-types.ts`
- Modify: `src/features/notifications/notification-control-plane-model.ts`
- Modify: `src/features/notifications/notification-control-plane-service.ts`
- Modify: `src/features/notifications/server/notification-control-plane-route.ts`
- Modify: `src/features/notifications/notification-control-panel.tsx`
- Modify: `tests/notification-control-plane-model.test.mjs`
- Modify: `tests/notification-control-plane-api.test.mjs`
- Modify: `tests/notification-control-plane-ui.test.mjs`

- [ ] **Step 1: Write RED parser/model/UI tests.** Cover snake_case→camelCase contract parsing, v2 request body with both revision maps, current-contract variables instead of historical template variables, required/optional badges, warning-only `[다음]`, and fixed registration rows with no interactive switch.

- [ ] **Step 2: Run RED tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-control-plane-model.test.mjs \
  tests/notification-control-plane-api.test.mjs \
  tests/notification-control-plane-ui.test.mjs
```

- [ ] **Step 3: Extend DTOs exactly.** Add `configurationKind`, `activationLocked`, `contentContract`, `templateCompliance`, and `contentContractVersion`. Add blocker codes for missing required token and invalid optional-line token; keep quality warnings separate from blocking `NotificationIssue`.

- [ ] **Step 4: Introduce one evaluation function.**

```ts
export function evaluateNotificationDraft(
  snapshot: NotificationControlPlaneSnapshot,
  draft: NotificationDraft,
): Readonly<{
  validation: NotificationResult<NotificationDraft>
  warnings: ReadonlyArray<NotificationTemplateWarning>
}>
```

`validateNotificationDraft()` may delegate to it for compatibility. Use `Intl.Segmenter("ko", { granularity: "grapheme" })` for the 60-grapheme title warning.

- [ ] **Step 5: Switch the browser service and server route to v2 RPCs.** The client sends expected rule revision and the contract version observed in the snapshot; it never sends `allowed_variables`.

- [ ] **Step 6: Update `TemplateEditor`.** Show available variables from the current contract; visually distinguish required values and optional complete-line tokens; show hard blocking messages and non-blocking conversational-quality warnings; preserve title/body editing and the existing conflict/rebase/save flow.

- [ ] **Step 7: Update `RuleToggle`.** For `fixed_policy_editable_template`, render a lock badge and “전달 정책 고정” text in place of the switch, retain `내용 수정`, and set no `enabled` patch. Keep at least a 44px action target.

- [ ] **Step 8: Re-run focused tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-control-plane-model.test.mjs \
  tests/notification-control-plane-api.test.mjs \
  tests/notification-control-plane-ui.test.mjs
```

Expected: PASS, including warning-save and fixed-policy cases.

- [ ] **Step 9: Review and commit only Task 3.**

```bash
git diff --check
git diff -- src/features/notifications/notification-control-plane-types.ts src/features/notifications/notification-control-plane-model.ts src/features/notifications/notification-control-plane-service.ts src/features/notifications/server/notification-control-plane-route.ts src/features/notifications/notification-control-panel.tsx tests/notification-control-plane-model.test.mjs tests/notification-control-plane-api.test.mjs tests/notification-control-plane-ui.test.mjs
git add src/features/notifications/notification-control-plane-types.ts src/features/notifications/notification-control-plane-model.ts src/features/notifications/notification-control-plane-service.ts src/features/notifications/server/notification-control-plane-route.ts src/features/notifications/notification-control-panel.tsx tests/notification-control-plane-model.test.mjs tests/notification-control-plane-api.test.mjs tests/notification-control-plane-ui.test.mjs
git commit -m "feat: expose editable notification content contracts"
```

Stop before Task 4.

---

## Task 4: Add shared presentation formatting and renderer filtering

**Files:**

- Create: `src/features/notifications/server/presentation/notification-presentation.ts`
- Create: `src/features/notifications/server/presentation/notification-presentation-formatters.ts`
- Modify: `src/features/notifications/server/notification-workflow-adapter.ts`
- Modify: `src/features/notifications/server/adapters/immediate-notification-adapter.ts`
- Modify: `src/features/notifications/server/notification-worker.ts`
- Create: `tests/notification-presentation-formatters.test.mjs`
- Modify: `tests/notification-control-plane-worker.test.mjs`
- Modify: `tests/registration-notification-adapter.test.mjs`

- [ ] **Step 1: Write RED formatter/worker tests.** Cover KST year derived from `occurred_at`, year boundary, null display, optional line empty/complete behavior, two-field free-text priority, contact/URL/control-character removal, Chat Markdown neutralization, 240 grapheme truncation, blank-line normalization, and legacy allowlist filtering. Add compatibility fixtures for old schema-v1 payload + old immutable template and rich schema-v1 payload + vNext template. The old pair must render without newly introduced fields; the vNext pair must fail closed when a variable requested by that template is absent.

- [ ] **Step 2: Run RED tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-presentation-formatters.test.mjs \
  tests/notification-control-plane-worker.test.mjs
```

- [ ] **Step 3: Implement the pure presentation interface.**

```ts
export type NotificationPresentationInput = Readonly<{
  workflowKey: NotificationWorkflowKey
  eventKey: string
  ruleVariantKey: string
  payloadSchemaVersion: number
  payload: Readonly<Record<string, unknown>>
  audienceKey: string
  channelKey: NotificationChannelKey
  contractIdentity: Readonly<{
    workflowKey: NotificationWorkflowKey
    eventKey: string
    audienceKey: string
    channelKey: NotificationEditableChannelKey
    ruleVariantKey: string
  }>
  requestedContextKeys: ReadonlyArray<string>
  connectionKey: NotificationConnectionKey | null
  destinationTeam: NotificationDestinationTeam | null
  scheduledFor: string
}>

export type NotificationPresentationBuilder =
  (input: NotificationPresentationInput) => NotificationRenderContext
```

- [ ] **Step 4: Implement shared formatters.** Export `formatNotificationKstDate`, `formatNotificationKstDateTime`, `formatNotificationPersonOrTeam`, `readNotificationFieldPresence`, `sanitizeNotificationFreeText`, `truncateNotificationGraphemes`, `buildOptionalNotificationLine`, and `normalizeRenderedNotificationBody`. Never use UUID as display fallback. Sanitization deterministically replaces URLs with `[링크 포함]`, contact-like phone numbers with `[연락처 숨김]`, strips control characters/HTML, folds free-text newlines to spaces, and neutralizes `*`, `_`, `~`, and backticks before the 240-grapheme limit is measured.

- [ ] **Step 5: Add an optional `presentationBuilder` hook to `createImmediateNotificationAdapter()`.** The hook receives the resolved target connection/destination and the full validated five-part contract identity. In both fanout and target reconciliation, the worker parses the immutable active template snapshot's title/body with the same strict token parser used by the renderer, maps each actual token through that snapshot's immutable `{ token → key }` `allowedVariables`, rejects unmapped/ambiguous tokens, and passes only the distinct mapped context keys as `requestedContextKeys` through `NotificationRenderInput`; neither unused allowlisted variables nor browser/provider input may make a field required. Keep the full `allowedVariables` list solely as the post-build filtering boundary. Continue emitting legacy `workflow_label`, `event_label`, `occurred_at`, and `deep_link` keys so old immutable templates still render.

- [ ] **Step 6: Make schema-v1 additive compatibility explicit.** Keep the existing payload schema versions in this scope. Presentation builders validate and require a rich field only when its key is present in `requestedContextKeys`; old schema-v1 payload + old template remains valid, while a vNext template with a missing requested field fails closed. Web Push may resolve only by explicitly inheriting the matching `in_app` contract identity; an independently editable `web_push` contract is invalid, and any active inherited Web Push path blocks production content cutover pending separate approval. If implementation discovers a removed field or changed field meaning rather than an additive field, stop that workflow's activation work and return to design instead of silently reusing or bumping the schema.

- [ ] **Step 7: Filter before rendering.** Add:

```ts
export function filterNotificationRenderContext(
  fullContext: NotificationRenderContext,
  allowedVariables: NotificationTemplateSnapshot["allowedVariables"],
): NotificationRenderContext
```

Call it in both normal fanout and target reconciliation before `renderNotificationSnapshot()`. Unknown tokens remain fail-closed; extra new context no longer breaks old custom templates.

- [ ] **Step 8: Normalize optional-line output after token replacement.** Trim line-end spaces, collapse consecutive empty lines to one, remove leading/trailing empty lines, and keep intentional non-empty line order.

- [ ] **Step 9: Re-run focused tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-presentation-formatters.test.mjs \
  tests/notification-control-plane-worker.test.mjs \
  tests/registration-notification-adapter.test.mjs
```

- [ ] **Step 10: Review and commit only Task 4.**

```bash
git diff --check
git diff -- src/features/notifications/server/presentation/notification-presentation.ts src/features/notifications/server/presentation/notification-presentation-formatters.ts src/features/notifications/server/notification-workflow-adapter.ts src/features/notifications/server/adapters/immediate-notification-adapter.ts src/features/notifications/server/notification-worker.ts tests/notification-presentation-formatters.test.mjs tests/notification-control-plane-worker.test.mjs tests/registration-notification-adapter.test.mjs
git add src/features/notifications/server/presentation/notification-presentation.ts src/features/notifications/server/presentation/notification-presentation-formatters.ts src/features/notifications/server/notification-workflow-adapter.ts src/features/notifications/server/adapters/immediate-notification-adapter.ts src/features/notifications/server/notification-worker.ts tests/notification-presentation-formatters.test.mjs tests/notification-control-plane-worker.test.mjs tests/registration-notification-adapter.test.mjs
git commit -m "feat: add notification presentation formatting"
```

Stop before Task 5.

---

## Task 5: Implement self-contained task notifications

**Files:**

- Create: `src/features/notifications/server/presentation/task-notification-presentation.ts`
- Modify: `src/features/notifications/server/adapters/tasks-notification-adapter.ts`
- Create: `supabase/migrations/20260803141000_notification_task_content_payload.sql`
- Create: `tests/notification-task-presentation.test.mjs`
- Modify: `tests/notification-ops-task-producers.test.mjs`
- Modify: `tests/notification-shadow-preview-fixture-runner.test.mjs`

- [ ] **Step 1: Write RED goldens for all eight task events.** Include assignment `미배정 → 김철수님` and reverse, due `일정 없음 → 8월 7일(금)`, multi-line comment sanitization, optional attachment summary, and absence of UUID/raw status/ISO/deep link in title/body.

- [ ] **Step 2: Run RED tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-task-presentation.test.mjs \
  tests/notification-ops-task-producers.test.mjs
```

- [ ] **Step 3: Implement `buildTaskNotificationPresentation()`.** Use the Task 1 contract; titles use one semantic emoji plus `[할 일]`, and bodies use `[업무]`, `[변경]`, `[상태]`, optional `[학생]`, `[수업]`, `[댓글]`, `[첨부]`, `[진행]` lines.

- [ ] **Step 4: Add immutable payload fields in the new migration.** Start from the latest `create_ops_task_v2_impl` in `20260716191000_notification_transfer_withdrawal_producers.sql` and the latest task functions in `20260716190000_notification_ops_task_producers.sql`. Recreate only functions needed to pass display snapshots into `record_ops_task_notification_source_v2`.

Required additive keys are `task_title`, `current_assignee_name`, `current_assignee_team`, `before_assignee_name`, `after_assignee_name`, `before_due_at`, `after_due_at`, `before_status`, `after_status`, `actor_name`, `comment_author_name`, `comment_body`, `attachment_count`, and `attachment_types`. Required keys remain present with explicit null; remove the current `jsonb_strip_nulls` behavior for contract-required keys without changing payload schema version `1`.

- [ ] **Step 5: Assert transaction and compatibility boundaries.** Display names are selected before the event transaction commits; renderer never live-queries them. Existing UUID recipient keys remain for routing. Existing templates still render through worker filtering.

- [ ] **Step 6: Run task tests and shadow fixture.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-task-presentation.test.mjs \
  tests/notification-ops-task-producers.test.mjs \
  tests/notification-shadow-preview-fixture-runner.test.mjs
```

- [ ] **Step 7: Review and commit only Task 5.**

```bash
git diff --check
git diff -- src/features/notifications/server/presentation/task-notification-presentation.ts src/features/notifications/server/adapters/tasks-notification-adapter.ts supabase/migrations/20260803141000_notification_task_content_payload.sql tests/notification-task-presentation.test.mjs tests/notification-ops-task-producers.test.mjs tests/notification-shadow-preview-fixture-runner.test.mjs
git add src/features/notifications/server/presentation/task-notification-presentation.ts src/features/notifications/server/adapters/tasks-notification-adapter.ts supabase/migrations/20260803141000_notification_task_content_payload.sql tests/notification-task-presentation.test.mjs tests/notification-ops-task-producers.test.mjs tests/notification-shadow-preview-fixture-runner.test.mjs
git commit -m "feat: enrich task notification content"
```

Stop before Task 6.

---

## Task 6: Implement self-contained word-retest notifications

**Files:**

- Create: `src/features/notifications/server/presentation/word-retest-notification-presentation.ts`
- Modify: `src/features/notifications/server/adapters/word-retests-notification-adapter.ts`
- Create: `supabase/migrations/20260803142000_notification_word_retest_content_payload.sql`
- Create: `tests/notification-word-retest-presentation.test.mjs`
- Modify: `tests/notification-ops-task-producers.test.mjs`
- Modify: `tests/notification-shadow-preview-fixture-runner.test.mjs`

- [ ] **Step 1: Write RED goldens for all ten word-retest events.** Include exact score units, threshold units, passed/failed/absent, assistant null transitions, retry lineage without UUID display, KST schedule changes, and safe reason/memo rows.

- [ ] **Step 2: Run RED tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-word-retest-presentation.test.mjs \
  tests/notification-ops-task-producers.test.mjs
```

- [ ] **Step 3: Implement `buildWordRetestNotificationPresentation()`.** The result line must render, for example, `[결과] 46점 / 통과 기준 45점 · 통과`; do not infer pass/fail from a display string when structured score/threshold fields exist.

- [ ] **Step 4: Add additive immutable snapshots in the new migration.** Use the latest retry/absence definitions from `20260721131836_word_retest_reretry.sql` and `20260722145935_word_retest_absence_storm_guard.sql`, not the older originals. Required keys include `assigned_assistant_name`, `assigned_assistant_team`, `before_assistant_name`, `after_assistant_name`, `test_at`, `before_test_at`, `after_test_at`, `total_question_count`, `cutoff_question_count`, the three score fields, `score_out_of_100`, `result_summary`, `actor_name`, `reason`, and `memo`.

- [ ] **Step 5: Preserve schema version and routing IDs.** The display fields are additive; existing source/recipient/retry IDs remain unchanged and are not rendered.

- [ ] **Step 6: Run focused and shadow tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-word-retest-presentation.test.mjs \
  tests/notification-ops-task-producers.test.mjs \
  tests/notification-shadow-preview-fixture-runner.test.mjs \
  tests/word-retest-expected-at.test.mjs
```

- [ ] **Step 7: Review and commit only Task 6.**

```bash
git diff --check
git diff -- src/features/notifications/server/presentation/word-retest-notification-presentation.ts src/features/notifications/server/adapters/word-retests-notification-adapter.ts supabase/migrations/20260803142000_notification_word_retest_content_payload.sql tests/notification-word-retest-presentation.test.mjs tests/notification-ops-task-producers.test.mjs tests/notification-shadow-preview-fixture-runner.test.mjs
git add src/features/notifications/server/presentation/word-retest-notification-presentation.ts src/features/notifications/server/adapters/word-retests-notification-adapter.ts supabase/migrations/20260803142000_notification_word_retest_content_payload.sql tests/notification-word-retest-presentation.test.mjs tests/notification-ops-task-producers.test.mjs tests/notification-shadow-preview-fixture-runner.test.mjs
git commit -m "feat: enrich word retest notification content"
```

Stop before Task 7.

---

## Task 7: Implement registration content, reminders, and fixed-rule editing

**Files:**

- Create: `src/features/notifications/server/presentation/registration-notification-presentation.ts`
- Modify: `src/features/notifications/server/adapters/registration-notification-adapter.ts`
- Create: `supabase/migrations/20260803143000_notification_registration_content_payload.sql`
- Create: `tests/notification-registration-presentation.test.mjs`
- Modify: `tests/registration-notification-adapter.test.mjs`
- Modify: `tests/registration-appointment-reminders.test.mjs`
- Modify: `tests/notification-registration-handoffs.test.mjs`
- Modify: `tests/registration-consultation-notification.test.mjs`

- [ ] **Step 1: Write RED goldens for core create/complete/close, appointment reminder, phone consultation, and all five visit events.** Include schedule/place before→after, removed/remaining subjects, no remaining subjects vs missing subjects, multi-subject progress actor, and management-room-only destination assertions. Add a regression fixture that calls the latest `assign_registration_track_director_impl`, proves the resulting direct dashboard notification uses the fixed phone-consultation rule's active template, and proves one logical event does not create both a hardcoded direct row and a second canonical row.

- [ ] **Step 2: Run RED tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-registration-presentation.test.mjs \
  tests/registration-notification-adapter.test.mjs \
  tests/registration-appointment-reminders.test.mjs \
  tests/notification-registration-handoffs.test.mjs
```

- [ ] **Step 3: Implement `buildRegistrationNotificationPresentation()`.** It receives the resolved destination but does not create a new destination. `registration.visit_rescheduled` must yield the approved structure with `[과목]`, `[변경]`, `[장소]`, and a neutral `[진행]` line.

- [ ] **Step 4: Upgrade immediate and scheduled adapter contexts.** Keep scheduled source validation and reconciliation unchanged. Replace `immediateRenderContext()` string-copy behavior with the presentation builder while retaining old keys for historical templates.

- [ ] **Step 5: Add producer snapshots in the new migration.** Start from the latest `write_registration_track_event_v2`, `registration_appointment_rule_snapshot_v1`, `registration_appointment_source_snapshot_v1`, and `assign_registration_track_director_impl` in `20260722100000_registration_science_subject.sql`. Add `before_scheduled_at`, `after_scheduled_at`, `before_place`, `after_place`, `subjects`, `deselected_subjects`, `remaining_subjects`, `actor_name`, `actor_team`, and explicit null/empty-array states. Keep schema `1` or `2` additive as currently assigned.

- [ ] **Step 6: Remove hardcoded fixed-rule content from every registration direct projection.** Recreate the latest `assign_registration_track_director_impl` in the forward migration and replace its literal `'[과목] 전화상담 대기'` / `'학생 상담을 확인하세요.'` `dashboard_notifications` upsert with the fixed `registration.phone_consultation_ready` in-app rule's active template, immutable allowlist, and rich presentation context. Preserve reassignment/delete/dedupe semantics and make `tests/notification-registration-handoffs.test.mjs` assert a saved custom active template is used on the next direct projection. The phone/visit legacy plan must likewise read its fixed rule's active template and immutable allowlist. Customer/SOLAPI message functions remain unchanged and out of scope.

- [ ] **Step 7: Prove fixed policy remains fixed.** Tests assert content save creates a template version, but enabled value, target calculation, owner, runtime flags, and recipients do not change. Unknown subject/destination fails closed and never falls back to all subject rooms.

- [ ] **Step 8: Run all registration notification tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-registration-presentation.test.mjs \
  tests/registration-notification-adapter.test.mjs \
  tests/registration-appointment-reminders.test.mjs \
  tests/notification-registration-handoffs.test.mjs \
  tests/registration-consultation-notification.test.mjs
```

- [ ] **Step 9: Review and commit only Task 7.**

```bash
git diff --check
git diff -- src/features/notifications/server/presentation/registration-notification-presentation.ts src/features/notifications/server/adapters/registration-notification-adapter.ts supabase/migrations/20260803143000_notification_registration_content_payload.sql tests/notification-registration-presentation.test.mjs tests/registration-notification-adapter.test.mjs tests/registration-appointment-reminders.test.mjs tests/notification-registration-handoffs.test.mjs tests/registration-consultation-notification.test.mjs
git add src/features/notifications/server/presentation/registration-notification-presentation.ts src/features/notifications/server/adapters/registration-notification-adapter.ts supabase/migrations/20260803143000_notification_registration_content_payload.sql tests/notification-registration-presentation.test.mjs tests/registration-notification-adapter.test.mjs tests/registration-appointment-reminders.test.mjs tests/notification-registration-handoffs.test.mjs tests/registration-consultation-notification.test.mjs
git commit -m "feat: enrich registration notification content"
```

Stop before Task 8.

---

## Task 8: Implement self-contained transfer notifications

**Files:**

- Create: `src/features/notifications/server/presentation/transfer-notification-presentation.ts`
- Modify: `src/features/notifications/server/adapters/transfer-notification-adapter.ts`
- Create: `supabase/migrations/20260803144000_notification_transfer_content_payload.sql`
- Create: `tests/notification-transfer-presentation.test.mjs`
- Modify: `tests/notification-transfer-withdrawal-adapters.test.mjs`

- [ ] **Step 1: Write RED submitted/completed goldens.** Assert requester display is distinct from the current class teacher, class before→after is present, and submitted/completed dates have their correct meanings.

- [ ] **Step 2: Run RED tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types tests/notification-transfer-presentation.test.mjs tests/notification-transfer-withdrawal-adapters.test.mjs
```

- [ ] **Step 3: Implement `buildTransferNotificationPresentation()`.** Titles use `[전반]`; body uses `[변경]`, `[일정]`, optional `[사유]`, `[진행]`.

- [ ] **Step 4: Recreate the latest transition source functions in the new migration.** Add requester display, before/after class display, requested effective date, previous end date, new start date, and actor display to the event transaction. Do not relabel `teacher_name` as requester.

- [ ] **Step 5: Run focused tests, review, and commit.**

```bash
"$TASK_NODE" --test --experimental-strip-types tests/notification-transfer-presentation.test.mjs tests/notification-transfer-withdrawal-adapters.test.mjs tests/notification-ops-task-producers.test.mjs
git diff --check
git diff -- src/features/notifications/server/presentation/transfer-notification-presentation.ts src/features/notifications/server/adapters/transfer-notification-adapter.ts supabase/migrations/20260803144000_notification_transfer_content_payload.sql tests/notification-transfer-presentation.test.mjs tests/notification-transfer-withdrawal-adapters.test.mjs
git add src/features/notifications/server/presentation/transfer-notification-presentation.ts src/features/notifications/server/adapters/transfer-notification-adapter.ts supabase/migrations/20260803144000_notification_transfer_content_payload.sql tests/notification-transfer-presentation.test.mjs tests/notification-transfer-withdrawal-adapters.test.mjs
git commit -m "feat: enrich transfer notification content"
```

Stop before Task 9.

---

## Task 9: Implement subject-scoped withdrawal notifications

**Files:**

- Create: `src/features/notifications/server/presentation/withdrawal-notification-presentation.ts`
- Modify: `src/features/notifications/server/adapters/withdrawal-notification-adapter.ts`
- Create: `supabase/migrations/20260803145000_notification_withdrawal_content_payload.sql`
- Create: `tests/notification-withdrawal-presentation.test.mjs`
- Modify: `tests/notification-transfer-withdrawal-adapters.test.mjs`

- [ ] **Step 1: Write RED submitted/completed goldens.** Include exact selected subject/class/date/round and three `other_active_subjects` cases: non-empty shows the preservation line, empty omits it without claiming preservation, missing key fails.

- [ ] **Step 2: Run RED tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types tests/notification-withdrawal-presentation.test.mjs tests/notification-transfer-withdrawal-adapters.test.mjs
```

- [ ] **Step 3: Implement `buildWithdrawalNotificationPresentation()`.** Use `[수강 제외]`, never title or body the event as whole-student withdrawal, and only emit `[상태] 다른 과목 수강은 그대로 유지돼요.` when the immutable payload proves at least one other active subject.

- [ ] **Step 4: Extend the latest subject-scoped completion transaction.** Base it on `20260801110000_withdrawal_subject_scoped_completion.sql`. Snapshot selected subject/class, request and applied date/round, requester display, and authoritative `other_active_subjects` in the same transaction that excludes the selected subject. Do not touch non-selected enrollments.

- [ ] **Step 5: Run focused tests, review, and commit.**

```bash
"$TASK_NODE" --test --experimental-strip-types tests/notification-withdrawal-presentation.test.mjs tests/notification-transfer-withdrawal-adapters.test.mjs tests/notification-ops-task-producers.test.mjs
git diff --check
git diff -- src/features/notifications/server/presentation/withdrawal-notification-presentation.ts src/features/notifications/server/adapters/withdrawal-notification-adapter.ts supabase/migrations/20260803145000_notification_withdrawal_content_payload.sql tests/notification-withdrawal-presentation.test.mjs tests/notification-transfer-withdrawal-adapters.test.mjs
git add src/features/notifications/server/presentation/withdrawal-notification-presentation.ts src/features/notifications/server/adapters/withdrawal-notification-adapter.ts supabase/migrations/20260803145000_notification_withdrawal_content_payload.sql tests/notification-withdrawal-presentation.test.mjs tests/notification-transfer-withdrawal-adapters.test.mjs
git commit -m "feat: enrich subject withdrawal notification content"
```

Stop before Task 10.

---

## Task 10: Implement makeup content and a single canonical writer

**Files:**

- Create: `src/features/notifications/server/presentation/makeup-notification-presentation.ts`
- Modify: `src/features/notifications/server/adapters/makeup-requests-notification-adapter.ts`
- Modify: `src/features/makeup-requests/makeup-request-service.ts`
- Modify: `src/features/makeup-requests/makeup-request-workspace.tsx`
- Create: `supabase/migrations/20260803150000_notification_makeup_content_single_writer.sql`
- Create: `supabase/tests/notification_makeup_single_writer_test.sql`
- Create: `tests/notification-makeup-presentation.test.mjs`
- Modify: `tests/notification-makeup-adapter.test.mjs`
- Modify: `tests/makeup-request-workspace.test.mjs`

- [ ] **Step 1: Write RED goldens for all seven makeup events.** Cover subject destination English/math/science, exact one expected room and zero other rooms, `{결재자}님의 결재를 기다리고 있어요.`, free-text priority, and no direct imperative.

- [ ] **Step 2: Write RED single-writer tests.** Direct authenticated INSERT/UPDATE of legacy template/enable columns must fail; the common v2 command must append canonical template, update pointer, mirror all mapped legacy rows, update metadata checksum, and audit in one transaction.

- [ ] **Step 3: Run RED tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-makeup-presentation.test.mjs \
  tests/notification-makeup-adapter.test.mjs \
  tests/makeup-request-workspace.test.mjs
```

- [ ] **Step 4: Implement `buildMakeupNotificationPresentation()`.** Use structured class/subject/teacher/schedule/location/status first; include no more than two sanitized free-text fields according to contract priority.

- [ ] **Step 5: Add additive payload fields.** Extend the latest `notification_makeup_payload_v1`/source functions with requester/approver display, status timestamps, structured schedule/place, and safe attachment count/type snapshots while keeping filenames out.

- [ ] **Step 6: Make v2 control-plane save the only writer.** Add `dashboard_private.mirror_makeup_notification_template_v1(rule_id,template_id,actor_id)` and call it inside the same v2 save transaction after canonical pointer update. Remove legacy→canonical write authority; retain legacy SELECT for the current legacy sender. Route the old dedicated content editor and its toggle through the same v2 command instead of direct table `upsert()`.

- [ ] **Step 7: Prove rollback and unchanged delivery policy.** If any mirror write fails, canonical insert/pointer/audit all rollback. Enabled values and dispatch owner only change when the operator explicitly changed that field; the content migration itself changes neither.

- [ ] **Step 8: Run focused Node and local pgTAP.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-makeup-presentation.test.mjs \
  tests/notification-makeup-adapter.test.mjs \
  tests/makeup-request-workspace.test.mjs
"$SUPABASE_CLI" test db --local supabase/tests/notification_makeup_single_writer_test.sql
```

- [ ] **Step 9: Review and commit only Task 10.**

```bash
git diff --check
git diff -- src/features/notifications/server/presentation/makeup-notification-presentation.ts src/features/notifications/server/adapters/makeup-requests-notification-adapter.ts src/features/makeup-requests/makeup-request-service.ts src/features/makeup-requests/makeup-request-workspace.tsx supabase/migrations/20260803150000_notification_makeup_content_single_writer.sql supabase/tests/notification_makeup_single_writer_test.sql tests/notification-makeup-presentation.test.mjs tests/notification-makeup-adapter.test.mjs tests/makeup-request-workspace.test.mjs
git add src/features/notifications/server/presentation/makeup-notification-presentation.ts src/features/notifications/server/adapters/makeup-requests-notification-adapter.ts src/features/makeup-requests/makeup-request-service.ts src/features/makeup-requests/makeup-request-workspace.tsx supabase/migrations/20260803150000_notification_makeup_content_single_writer.sql supabase/tests/notification_makeup_single_writer_test.sql tests/notification-makeup-presentation.test.mjs tests/notification-makeup-adapter.test.mjs tests/makeup-request-workspace.test.mjs
git commit -m "feat: unify makeup notification content writes"
```

Stop before Task 11.

---

## Task 11: Implement self-contained approval notifications

**Files:**

- Create: `src/features/notifications/server/presentation/approval-notification-presentation.ts`
- Modify: `src/features/notifications/server/adapters/approvals-notification-adapter.ts`
- Create: `supabase/migrations/20260803151000_notification_approval_content_payload.sql`
- Create: `tests/notification-approval-presentation.test.mjs`
- Modify: `tests/notification-approval-adapter.test.mjs`

- [ ] **Step 1: Write RED goldens for all nine approval events.** Include approver null transitions, current approver waiting text, author/comment display, period, status/time, free-text sanitization, and attachment count/type without filenames.

- [ ] **Step 2: Run RED tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types tests/notification-approval-presentation.test.mjs tests/notification-approval-adapter.test.mjs
```

- [ ] **Step 3: Implement `buildApprovalNotificationPresentation()`.** `approval.submitted` must render the approved neutral progress sentence. `approval.comment_added` must include document, comment author, and safe preview without requiring the link.

- [ ] **Step 4: Extend the latest approval producer functions.** Recreate `write_approval_notification_event_v2` and `write_approval_comment_notification_v2` from `20260716193000_notification_approval_producers.sql` with author, current/before/after approver display, period, comment author/body, attachment count/type, and actor display snapshots. Preserve schema version `1` additively.

- [ ] **Step 5: Run focused tests, review, and commit.**

```bash
"$TASK_NODE" --test --experimental-strip-types tests/notification-approval-presentation.test.mjs tests/notification-approval-adapter.test.mjs tests/approval-workspace.test.mjs
git diff --check
git diff -- src/features/notifications/server/presentation/approval-notification-presentation.ts src/features/notifications/server/adapters/approvals-notification-adapter.ts supabase/migrations/20260803151000_notification_approval_content_payload.sql tests/notification-approval-presentation.test.mjs tests/notification-approval-adapter.test.mjs
git add src/features/notifications/server/presentation/approval-notification-presentation.ts src/features/notifications/server/adapters/approvals-notification-adapter.ts supabase/migrations/20260803151000_notification_approval_content_payload.sql tests/notification-approval-presentation.test.mjs tests/notification-approval-adapter.test.mjs
git commit -m "feat: enrich approval notification content"
```

Stop before Task 12.

---

## Task 12: Install editable system vNext templates and audit them without activation

**Files:**

- Create: `tests/fixtures/notification-content-golden.json`
- Create: `supabase/migrations/20260803152000_notification_system_templates_vnext.sql`
- Create: `supabase/tests/notification_system_template_vnext_test.sql`
- Create: `tests/notification-system-template-vnext.test.mjs`

- [ ] **Step 1: Write the complete exact-string golden fixture.** It must contain at least one representative payload and exact title/body per in-scope rule identity, not merely per workflow. Titles use one semantic emoji and a bracketed workflow name. Bodies use labeled lines and no `deep_link` token. Each event's title verb must exactly match the approved wording in design section 7.8; grammar may use the event's target token but must not reduce to a literal generic `{대상}의` formula.

Required representative exact outputs include:

```text
🔄 [할 일] 박지훈 학생 교재 주문 마감일이 바뀌었어요

[업무] 2학기 수학 교재 주문
[변경] 8월 5일(수) → 8월 7일(금)
[진행] 관리팀의 변경 일정 확인을 기다리고 있어요.
```

```text
✅ [단어 재시험] 이서연 학생이 재시험을 통과했어요

[수업] 중2 영어 A반
[시험] Lesson 12 · 50문항
[결과] 46점 / 통과 기준 45점 · 통과
[상태] 재시험 결과가 기록됐어요.
```

```text
📥 [전자결재] 7월 교재비 정산서가 제출됐어요

[문서] 7월 교재비 정산 · 작성자 박지영
[기간] 2026년 7월
[진행] 김철수님의 결재를 기다리고 있어요.
```

- [ ] **Step 2: Write RED migration and audit tests.** Require deterministic template IDs, SHA-256 checksums, system creator, full baseline identity, append-only insert, and zero active pointer changes during migration apply. Require an audit result for every seed/registry-derived rule identity without hardcoding the projected identity count.

- [ ] **Step 3: Implement the vNext template migration.** Insert one recommended template version for every in-scope rule identity, with the latest contract allowlist/version. Do not update `active_template_id`, `enabled`, owner, or runtime flags.

- [ ] **Step 4: Add the read-only, service-role-only template audit RPC.**

```sql
public.audit_notification_content_templates_v1(text,uuid) returns jsonb
```

The audit compares creator, approved baseline template ID, title/body, allowlist, payload schema, contract version, and SHA-256 checksum. It returns only safe workflow/event/channel/audience/variant labels plus `conformant | legacy_custom_nonconformant` and violations, and writes one idempotent audit record. It must not create a release row or expose any activate/rollback function.

- [ ] **Step 5: Test custom protection and idempotency.** Active custom templates stay untouched and are reported `conformant` or `legacy_custom_nonconformant`. Re-running template install or audit with the same request/release state creates no new template or duplicate audit row. Applying this migration must leave rule revision, active pointer, enabled state, dispatch owner, runtime flags, deliveries, inbox rows, provider attempts, and reconciliation jobs byte-for-byte unchanged.

- [ ] **Step 6: Run Node and local pgTAP.** The audit call occurs only inside the isolated test transaction; do not invoke it against any shared or production project.

```bash
"$TASK_NODE" --test --experimental-strip-types tests/notification-system-template-vnext.test.mjs
"$SUPABASE_CLI" test db --local supabase/tests/notification_system_template_vnext_test.sql
```

- [ ] **Step 7: Review and commit only Task 12.**

```bash
git diff --check
git diff -- tests/fixtures/notification-content-golden.json supabase/migrations/20260803152000_notification_system_templates_vnext.sql supabase/tests/notification_system_template_vnext_test.sql tests/notification-system-template-vnext.test.mjs
git add tests/fixtures/notification-content-golden.json supabase/migrations/20260803152000_notification_system_templates_vnext.sql supabase/tests/notification_system_template_vnext_test.sql tests/notification-system-template-vnext.test.mjs
git commit -m "feat: add notification content system templates"
```

Stop before Task 13. No activation/rollback RPC exists yet, and no real rule is activated.

---

## Task 13: Prove canonical/legacy parity and harden Google Chat final payloads

**Files:**

- Create: `supabase/migrations/20260803153000_notification_legacy_content_projection.sql`
- Modify: `src/features/notifications/server/providers/google-chat-provider.ts`
- Modify: `scripts/run-notification-shadow-preview-fixtures.mjs`
- Modify: `scripts/notification-shadow-deterministic-evidence.mjs`
- Create: `tests/notification-google-chat-content.test.mjs`
- Modify: `tests/notification-control-plane-worker.test.mjs`
- Modify: `tests/notification-shadow-preview-fixture-runner.test.mjs`
- Modify: `tests/notification-shadow-deterministic-evidence.test.mjs`

- [ ] **Step 1: Write RED provider tests.** Assert final plain text is exactly `title + "\n\n" + body + "\n\n" + absoluteUrl`, URL occurs once, UTF-8 byte length is at most 32,000, and the injected fetch is not called for invalid/oversize payloads.

- [ ] **Step 2: Add malicious-link cases.** Reject `//evil.example`, external absolute URLs, `javascript:`, encoded path traversal, fragments, duplicate/unknown query keys, and paths outside the workflow root before provider transport.

- [ ] **Step 3: Run RED provider/parity tests.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-google-chat-content.test.mjs \
  tests/notification-shadow-preview-fixture-runner.test.mjs \
  tests/notification-shadow-deterministic-evidence.test.mjs
```

- [ ] **Step 4: Harden `createGoogleChatProvider()`.** Export a pure `buildGoogleChatTextPayload()` used by `send()`. It validates the relative href, converts it to `https://tipsedu.co.kr`, appends it once, measures `Buffer.byteLength(text, "utf8")`, and returns `render_validation_failed` without fetch when invalid.

- [ ] **Step 5: Update only manifest identities whose current `dispatchOwner === "legacy"` in the new SQL migration.** Derive the exact renderer list from the reviewed manifest and DB owner snapshot; those legacy projections must accept the same rich display keys, optional-line behavior, sanitizer output, and missing/null errors as canonical. Canonical-owned identities, including approvals, are verified through their existing adapters and must not gain a new SQL/legacy sender. Any legacy-owned identity still limited to `workflow_label/event_label/occurred_at/deep_link` blocks Task 16.

- [ ] **Step 6: Expand shadow fixtures from ten scopes to every in-scope event/rule identity.** Remove `registration_solapi` from self-contained completion claims while retaining it as `excluded_channel` coverage. Compare exact title/body/href, normalized hash, error parity, expected one destination, and other four Google Chat destinations at zero.

- [ ] **Step 7: Run focused provider and parity tests.** This task still must not create or expose any activation/rollback function.

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-google-chat-content.test.mjs \
  tests/notification-control-plane-worker.test.mjs \
  tests/notification-shadow-preview-fixture-runner.test.mjs \
  tests/notification-shadow-deterministic-evidence.test.mjs \
  tests/notification-registration-handoffs.test.mjs \
  tests/notification-transfer-withdrawal-adapters.test.mjs \
  tests/notification-makeup-adapter.test.mjs \
  tests/notification-approval-adapter.test.mjs
```

- [ ] **Step 8: Review and commit only Task 13.**

```bash
git diff --check
git diff -- supabase/migrations/20260803153000_notification_legacy_content_projection.sql src/features/notifications/server/providers/google-chat-provider.ts scripts/run-notification-shadow-preview-fixtures.mjs scripts/notification-shadow-deterministic-evidence.mjs tests/notification-google-chat-content.test.mjs tests/notification-control-plane-worker.test.mjs tests/notification-shadow-preview-fixture-runner.test.mjs tests/notification-shadow-deterministic-evidence.test.mjs
git add supabase/migrations/20260803153000_notification_legacy_content_projection.sql src/features/notifications/server/providers/google-chat-provider.ts scripts/run-notification-shadow-preview-fixtures.mjs scripts/notification-shadow-deterministic-evidence.mjs tests/notification-google-chat-content.test.mjs tests/notification-control-plane-worker.test.mjs tests/notification-shadow-preview-fixture-runner.test.mjs tests/notification-shadow-deterministic-evidence.test.mjs
git commit -m "feat: align notification content delivery paths"
```

Stop before Task 14. The codebase still has no content-release activation RPC.

---

## Task 14: Make the dashboard notification surface readable and accessible

**Files:**

- Create: `src/components/dashboard-notification-content.tsx`
- Modify: `src/components/dashboard-notification-popover.tsx`
- Create: `scripts/verify-notification-content-browser.mjs`
- Create: `tests/dashboard-notification-content.test.mjs`
- Modify: `tests/notification-control-plane-ui.test.mjs`
- Modify: `tests/notification-control-plane-inbox-contract.test.mjs`

- [ ] **Step 1: Write RED source/DOM contracts.** Require `whitespace-pre-wrap`, `overflow-wrap:anywhere`, responsive width constrained by viewport margins, `100dvh` max height with internal scroll, `text-sm` readable body, `<time dateTime>`, `status`, `alert`, polite unread count, non-color unread text, and 44×44px read action.

- [ ] **Step 2: Extract a pure display component.** `DashboardNotificationContent` receives a notification, read state, and callbacks. Keep data loading/mark-read/push logic in the popover. Split only a known leading status emoji grapheme into `aria-hidden`; preserve unknown custom emoji.

- [ ] **Step 3: Implement responsive/focus behavior.** At 320px width keep at least 8px outer margins; support Escape and Radix trigger focus return; ensure internal list scrolling keeps focus visible. Bell accessible name includes unread count.

- [ ] **Step 4: Add the Playwright verifier.** `scripts/verify-notification-content-browser.mjs` accepts `--base-url` and `--storage-state`, intercepts inbox RPCs with the golden fixture, blocks link navigation and all provider endpoints, and checks 1440×900, 320×568, 360×800, 390×844, landscape, and 200% zoom. It asserts actual `innerText`, no horizontal overflow, internal scroll, Escape/focus return, button size, status/alert/time semantics, and href-hidden must-have facts.

- [ ] **Step 5: Run focused tests and the verifier against an authenticated local server.**

```bash
"$TASK_NODE" --test --experimental-strip-types tests/dashboard-notification-content.test.mjs tests/notification-control-plane-ui.test.mjs tests/notification-control-plane-inbox-contract.test.mjs
"$TASK_NODE" scripts/verify-notification-content-browser.mjs \
  --base-url http://127.0.0.1:3012 \
  --storage-state /private/tmp/tips-notification-content-storage-state.json
```

Expected: Node tests PASS. Browser verifier PASS only with a reachable local Webpack server and authenticated fixture; a missing server/session is reported as unverified, not PASS.

- [ ] **Step 6: Review and commit only Task 14.**

```bash
git diff --check
git diff -- src/components/dashboard-notification-content.tsx src/components/dashboard-notification-popover.tsx scripts/verify-notification-content-browser.mjs tests/dashboard-notification-content.test.mjs tests/notification-control-plane-ui.test.mjs tests/notification-control-plane-inbox-contract.test.mjs
git add src/components/dashboard-notification-content.tsx src/components/dashboard-notification-popover.tsx scripts/verify-notification-content-browser.mjs tests/dashboard-notification-content.test.mjs tests/notification-control-plane-ui.test.mjs tests/notification-control-plane-inbox-contract.test.mjs
git commit -m "feat: improve dashboard notification readability"
```

Stop before Task 15.

---

## Task 15: Run template round-trip and provider-zero QA as separate evidence lanes

**Files:**

- Create: `scripts/run-notification-content-no-send-qa.mjs`
- Create: `scripts/notification-content-db-evidence.mjs`
- Create: `tests/notification-content-no-send-qa.test.mjs`
- Modify: `scripts/verify-notification-workflow-entrypoints.mjs`
- Modify: `tests/notification-workflow-entrypoints.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write RED no-send tests.** The formatting lane must install process-level traps for `fetch`, `node:http.request`, and `node:https.request`; inject only fake provider transports; remove production connection secrets; and fail if any real external request is attempted.

- [ ] **Step 2: Implement the pure provider-zero lane.** It renders all golden identities, calls the fake formatting transport only where expected, records external request count `0`, actual provider attempt row count `0`, expected destination count `1`, other four destination counts `0`, and exact `{ text }` payloads. It never starts cron or the worker.

- [ ] **Step 3: Implement the isolated DB round-trip lane.** Against local Supabase only, snapshot rule/template/delivery/inbox/provider-attempt counts, save a custom emoji/label/tone/line-order edit through v2, reload and render it, repeat the same save as a no-op, exercise conflict preservation, then rollback the fixture transaction. Report template/rule fixture writes separately from operational delivery deltas.

- [ ] **Step 4: Add read-only operational evidence mode.** It may query safe counts and runtime flags but must refuse non-local project URLs, redact connection values, assert all notification runtime flags false, and produce pre/post deltas for pending/claimed/sending, inbox, provider attempts, and audit tables. It performs no domain event creation.

- [ ] **Step 5: Strengthen entrypoint verification.** Runtime probing must observe provider endpoint requests rather than returning an always-empty array. Settings open/save QA must have provider request count `0` and legacy bridge count `0`.

- [ ] **Step 6: Add package scripts.**

```json
{
  "verify:notification-content:no-send": "node --experimental-strip-types scripts/run-notification-content-no-send-qa.mjs",
  "verify:notification-content:browser": "node scripts/verify-notification-content-browser.mjs"
}
```

- [ ] **Step 7: Run the complete focused suite.**

```bash
"$TASK_NODE" --test --experimental-strip-types \
  tests/notification-content-*.test.mjs \
  tests/notification-*-presentation.test.mjs \
  tests/dashboard-notification-content.test.mjs \
  tests/notification-control-plane-*.test.mjs \
  tests/notification-workflow-registry.test.mjs \
  tests/notification-workflow-entrypoints.test.mjs \
  tests/notification-ops-task-producers.test.mjs \
  tests/registration-notification-adapter.test.mjs \
  tests/registration-appointment-reminders.test.mjs \
  tests/registration-consultation-notification.test.mjs \
  tests/notification-registration-handoffs.test.mjs \
  tests/word-retest-expected-at.test.mjs \
  tests/notification-transfer-withdrawal-adapters.test.mjs \
  tests/notification-makeup-adapter.test.mjs \
  tests/makeup-request-workspace.test.mjs \
  tests/notification-approval-adapter.test.mjs \
  tests/notification-control-plane-worker.test.mjs \
  tests/notification-google-chat-content.test.mjs \
  tests/notification-google-chat-connection-catalog.test.mjs \
  tests/notification-external-attempt-gate.test.mjs \
  tests/notification-science-provider-zero.test.mjs \
  tests/notification-shadow-preview-fixture-runner.test.mjs \
  tests/notification-shadow-fixture-runner.test.mjs
"$TASK_NODE" --experimental-strip-types scripts/run-notification-content-no-send-qa.mjs
"$TASK_NODE" --test tests/supabase-migration-layout.test.mjs
```

- [ ] **Step 8: Run typecheck, lint, and Webpack build.**

```bash
"$TASK_NODE" node_modules/typescript/bin/tsc --noEmit
"$TASK_NODE" node_modules/eslint/bin/eslint.js src tests scripts middleware.ts next.config.ts
"$TASK_NODE" node_modules/next/dist/bin/next build --webpack
```

- [ ] **Step 9: Run local DB tests if the isolated stack is available.**

```bash
"$SUPABASE_CLI" test db --local supabase/tests/notification_control_plane_schema_test.sql
"$SUPABASE_CLI" test db --local supabase/tests/notification_content_contract_test.sql
"$SUPABASE_CLI" test db --local supabase/tests/notification_makeup_single_writer_test.sql
"$SUPABASE_CLI" test db --local supabase/tests/notification_control_plane_runtime_test.sql
"$SUPABASE_CLI" test db --local supabase/tests/notification_ops_task_adapters_test.sql
"$SUPABASE_CLI" test db --local supabase/tests/notification_registration_handoffs_test.sql
"$SUPABASE_CLI" test db --local supabase/tests/notification_transfer_withdrawal_adapters_test.sql
"$SUPABASE_CLI" test db --local supabase/tests/notification_makeup_adapter_test.sql
"$SUPABASE_CLI" test db --local supabase/tests/notification_approval_adapter_test.sql
```

- [ ] **Step 10: Inspect final scope and commit only QA assets.**

```bash
git status --short
git diff --check
git diff -- package.json scripts/run-notification-content-no-send-qa.mjs scripts/notification-content-db-evidence.mjs scripts/verify-notification-workflow-entrypoints.mjs tests/notification-content-no-send-qa.test.mjs tests/notification-workflow-entrypoints.test.mjs
git add package.json scripts/run-notification-content-no-send-qa.mjs scripts/notification-content-db-evidence.mjs scripts/verify-notification-workflow-entrypoints.mjs tests/notification-content-no-send-qa.test.mjs tests/notification-workflow-entrypoints.test.mjs
git commit -m "test: add notification content no-send QA"
```

Stop and report five separate evidence sections: code tests/build, local DB/runtime, browser observation, Git state, and provider-zero. Do not continue to Task 16 unless the Task 14 browser verifier is PASS rather than unverified and every Task 15 required lane is PASS. No content-release activation RPC exists yet. Do not push, deploy, or send a Google Chat message.

---

## Task 16: Install the fail-closed content release controls after all QA passes

**Files:**

- Create: `tests/fixtures/notification-content-release-compatibility.json`
- Create: `supabase/migrations/20260803154000_notification_content_release_control.sql`
- Create: `supabase/tests/notification_content_release_test.sql`
- Create: `tests/notification-content-release.test.mjs`

- [ ] **Step 1: Reconfirm the prerequisite evidence before writing release code.** Require the committed Task 13 canonical/legacy exact-output parity, Task 14 authenticated browser PASS at every required viewport/zoom, and Task 15 code/build, local DB, save/reload, conflict, provider-zero, destination isolation, and external-request-zero PASS. Any missing, stale, failed, or unverified lane stops this Task; a prose claim is not evidence.

- [ ] **Step 2: Write the deterministic compatibility fixture and RED release tests.** Derive every selected identity from current seed/registry rows instead of a literal count. The fixture binds release key, contract version, system template checksum, canonical renderer checksum, legacy renderer checksum, Google Chat final-payload checksum, and the golden/shadow fixture checksums. Tests compare fixture ↔ DB identities both ways and require missing, stale, false, fixture-only, DB-only, or checksum-mismatched evidence to abort the complete activation transaction. Confirm no content-release function exists in migration order before `20260803154000`.

- [ ] **Step 3: Add fail-closed private evidence tables and service-role-only RPCs.** Create `dashboard_private.notification_content_renderer_evidence`, `dashboard_private.notification_content_releases`, and `dashboard_private.notification_content_release_rules`, then expose only:

```sql
public.activate_notification_content_release_v1(text,jsonb,uuid) returns jsonb
public.rollback_notification_content_release_v1(text,jsonb,uuid) returns jsonb
```

The migration seeds only the reviewed compatibility fixture and deterministic checksums. Revoke execution from `public`, `anon`, and `authenticated`; the ordinary settings UI has no route or button that can invoke either function. Applying the migration alone creates no release row, changes no pointer/revision/enabled/owner/runtime flag, schedules no reconciliation, creates no delivery/inbox/provider attempt, and sends nothing.

- [ ] **Step 4: Enforce full-set CAS and custom protection.** Activation locks the selected rule set and requires every identity's current true compatibility evidence, latest template audit, rule ID, expected revision, expected active template ID, baseline creator, title/body, actual used tokens, allowlist, payload schema, contract version, and release template checksum to match. Any missing/incompatible identity rolls back the entire default activation. Exact custom/concurrent rows can be skipped only when a separately reviewed stored manifest explicitly enables `예외 포함 전환` and lists each rule/checksum/reason; RPC arguments alone cannot add an exception.

- [ ] **Step 5: Make inherited Web Push a transaction-level blocker.** Before any pointer update, discover every active `web_push` rule that inherits an affected `in_app` contract. The default stored release manifest has no Web Push approval, so any such row aborts the entire activation. A later separately approved release manifest may allow only exact Web Push rule IDs, revisions, active template IDs, contract versions, and checksums plus an immutable approval reference; call-time JSON cannot create or widen that allowlist.

- [ ] **Step 6: Preserve delivery state exactly.** Activation switches only exact approved system baselines, increments revision once, and records previous/new pointers. It preserves immediate `pending`/`retry_wait` snapshots, replaces only future scheduled `pending`/`retry_wait` through existing cancel-and-reconcile behavior, records a cancel request for scheduled `claimed` before send, and leaves `sending` plus every terminal status unchanged.

- [ ] **Step 7: Implement idempotent rollback.** Rollback requires the activated pointer, activated revision, release checksum, and recorded release rule row to still match; increments revision once; never deletes templates, deliveries, inbox rows, provider attempts, or audit history. Repeating activate/rollback with the same request and state creates no duplicate revision, audit row, delivery replacement, or reconciliation job.

- [ ] **Step 8: Run release tests only in isolated local transactions, then re-run provider-zero.** Do not invoke either RPC against a shared or production project.

```bash
"$TASK_NODE" --test --experimental-strip-types tests/notification-content-release.test.mjs
"$SUPABASE_CLI" test db --local supabase/tests/notification_content_release_test.sql
"$TASK_NODE" --experimental-strip-types scripts/run-notification-content-no-send-qa.mjs
"$TASK_NODE" --test tests/supabase-migration-layout.test.mjs
git diff --check
```

- [ ] **Step 9: Review and commit only Task 16.**

```bash
git diff --check
git diff -- tests/fixtures/notification-content-release-compatibility.json supabase/migrations/20260803154000_notification_content_release_control.sql supabase/tests/notification_content_release_test.sql tests/notification-content-release.test.mjs
git add tests/fixtures/notification-content-release-compatibility.json supabase/migrations/20260803154000_notification_content_release_control.sql supabase/tests/notification_content_release_test.sql tests/notification-content-release.test.mjs
git commit -m "feat: add notification content release safety gate"
```

Stop and report local-only activation/rollback test evidence plus the repeated provider-zero result. Do not apply the migration to production, invoke a real activation, push, deploy, or send a Google Chat message.

## Final Release Gate After Implementation

Implementation completion is not production activation. A later, separately approved release turn must:

1. re-read production-safe rule/template/checksum/owner/flag/unfinished-delivery counts without exposing secrets;
2. prove all active in-scope custom templates are conformant or explicitly report `예외 포함 전환`;
3. confirm no active Web Push path will inherit unapproved content;
4. obtain explicit approval for production migration apply and service-role activation RPC;
5. run only the CAS activation manifest that was reviewed;
6. verify new events after activation separately from historical deliveries;
7. obtain another explicit approval before any real Google Chat test message.
