# Dashboard External Notification UI and Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dashboard inbox/Web Push UI and production creation paths, expose only Google Chat configuration under 환경 설정, keep SOLAPI rules server-only, and activate each verified external notification cell safely.

**Architecture:** Keep the canonical notification snapshot and provider adapters as the server authority, but project only Google Chat rules into the editable administrator surface. Close internal channels with an additive database fence instead of deleting historical tables, and keep external delivery results read-only. Release activation proceeds by exact event/channel cells through source, DB, deployment, worker, provider, and recipient gates.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node test runner, Supabase/PostgreSQL/pgTAP, Vercel, Google Chat webhooks, SOLAPI 알림톡.

## Global Constraints

- `알림 설정` is a child of `환경 설정`, not a standalone sidebar item.
- Only Google Chat rules, routing, connections, and profile-scoped mentions are editable in the dashboard.
- SOLAPI template, PF ID, message contract, and event mapping remain server-only fixed values and are not rendered in settings.
- Google Chat and SOLAPI delivery outcomes remain available as PII-free read-only operational evidence.
- Dashboard inbox and Web Push create no new deliveries after the cutover; historical rows and schema are not deleted in this release.
- Booking, schedule, and status mutations commit independently from notification delivery.
- Unknown provider acceptance is not retried automatically.
- Activation never catches up events created before a channel cell's eligibility cutoff.
- Do not expose phone numbers, student names, message bodies, template/PF IDs, webhook URLs, access keys, secrets, or raw provider responses.
- Run `pnpm build`; the package script already supplies webpack.
- The fresh `origin/main` baseline has unrelated failing tests. Preserve their evidence and require all task-focused tests to pass.

---

### Task 1: Remove the dashboard inbox shell and nest notification settings

**Files:**
- Modify: `src/components/site-header.tsx`
- Modify: `src/lib/navigation.ts`
- Modify: `tests/admin-shell.test.mjs`
- Modify: `tests/makeup-request-workspace.test.mjs`

**Interfaces:**
- Consumes: `buildAdminNavigation(role)` and `SiteHeader`.
- Produces: one navigation entry `{ title: "알림 설정", url: "/admin/settings/notifications" }` inside `환경 설정.items`; a header with no dashboard notification popover.

- [ ] **Step 1: Write the failing shell tests**

Add assertions equivalent to:

```js
assert.doesNotMatch(headerSource, /DashboardNotificationPopover|aria-label="알림"/)
assert.match(navigationSource, /title:\s*"환경 설정"[\s\S]*items:\s*\[[\s\S]*title:\s*"알림 설정"/)
assert.doesNotMatch(navigationSource, /\},\s*\{\s*title:\s*"알림 설정"[\s\S]*icon:\s*BellRing/)
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test --experimental-strip-types tests/admin-shell.test.mjs tests/makeup-request-workspace.test.mjs
```

Expected: FAIL because the header renders `DashboardNotificationPopover` and the navigation keeps a standalone `BellRing` item.

- [ ] **Step 3: Implement the shell change**

Remove the popover import/render from `SiteHeader`, remove unused `BellRing`, and append the notification child to the existing environment settings item:

```ts
{ title: "알림 설정", url: "/admin/settings/notifications" }
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/site-header.tsx src/lib/navigation.ts tests/admin-shell.test.mjs tests/makeup-request-workspace.test.mjs
git commit -m "feat: remove dashboard notification shell"
```

### Task 2: Make the central settings page Google Chat-only

**Files:**
- Create: `src/features/notifications/notification-google-chat-settings.ts`
- Modify: `src/features/notifications/notification-settings-workspace.tsx`
- Modify: `src/features/notifications/notification-control-panel.tsx`
- Modify: `src/app/admin/settings/notifications/page.tsx`
- Delete: `src/app/admin/settings/notifications/solapi/page.tsx`
- Test: `tests/notification-google-chat-settings.test.mjs`
- Modify: `tests/notification-control-plane-ui.test.mjs`

**Interfaces:**
- Consumes: `NotificationRuleDto`, `NotificationControlPlaneSnapshot`.
- Produces: `selectEditableGoogleChatRules(rules: readonly NotificationRuleDto[]): NotificationRuleDto[]` and a page whose editable rules all have `channelKey === "google_chat"`.

- [ ] **Step 1: Write the failing projection test**

Create a test that passes `in_app`, `web_push`, `customer_message`, and `google_chat` fixtures and asserts:

```js
assert.deepEqual(
  selectEditableGoogleChatRules(rules).map(({ channelKey }) => channelKey),
  ["google_chat"],
)
```

Also assert the settings source does not render `RegistrationCustomerReminderSettings`, `SOLAPI`, `알림톡 규칙`, `Web Push`, or `대시보드 알림`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test --experimental-strip-types tests/notification-google-chat-settings.test.mjs tests/notification-control-plane-ui.test.mjs
```

Expected: FAIL because no Google Chat-only selector exists and the registration reminder settings are rendered.

- [ ] **Step 3: Implement the exact selector**

Implement:

```ts
export function selectEditableGoogleChatRules(
  rules: ReadonlyArray<NotificationRuleDto>,
) {
  return rules.filter((rule) => rule.channelKey === "google_chat")
}
```

Use this projection only for rule rendering and template editing. Preserve the complete snapshot and draft for optimistic revision and delivery-summary parsing; do not rewrite or save hidden rules.

- [ ] **Step 4: Simplify the page copy and tabs**

Set the page title/copy to `Google Chat 알림`, remove the registration reminder settings component, retain `Google Chat 규칙`, `최근 전달`, and `연결`, and ensure hidden rules cannot become `editingRule`.

Delete the SOLAPI settings route and any navigation/link that reaches it. Keep provider code and read-only delivery summaries unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/notifications/notification-google-chat-settings.ts src/features/notifications/notification-settings-workspace.tsx src/features/notifications/notification-control-panel.tsx src/app/admin/settings/notifications/page.tsx tests/notification-google-chat-settings.test.mjs tests/notification-control-plane-ui.test.mjs
git rm src/app/admin/settings/notifications/solapi/page.tsx
git commit -m "feat: make notification settings Google Chat only"
```

### Task 3: Remove duplicated workflow notification launchers

**Files:**
- Modify: `src/features/approvals/approval-workspace.tsx`
- Modify: `src/features/makeup-requests/makeup-request-workspace.tsx`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `tests/approval-workspace.test.mjs`
- Modify: `tests/makeup-request-workspace.test.mjs`
- Modify: `tests/ops-task-workspace.test.mjs`
- Modify: `tests/registration-consultation-notification.test.mjs`

**Interfaces:**
- Consumes: the central `/admin/settings/notifications` page from Task 2.
- Produces: workflow workspaces with no local `NotificationControlPanel`, legacy mobile notification dialog, or notification setting gear.

- [ ] **Step 1: Replace launcher-presence assertions with absence assertions**

For each workspace source assert:

```js
assert.doesNotMatch(source, /NotificationControlPanel/)
assert.doesNotMatch(source, /notificationDialogOpen/)
assert.doesNotMatch(source, /알림 설정"/)
```

Keep assertions for the actual business save/action buttons.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test --experimental-strip-types tests/approval-workspace.test.mjs tests/makeup-request-workspace.test.mjs tests/ops-task-workspace.test.mjs tests/registration-consultation-notification.test.mjs
```

Expected: FAIL because workflow-local launchers and dialogs still exist.

- [ ] **Step 3: Remove local settings state and rendering**

Remove `NotificationControlPanel`, availability hooks used only for launchers, notification dialog state, gear buttons, legacy mobile/Web Push controls, and their dialog bodies. Preserve server notification bridge calls that occur after successful business persistence.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/approvals/approval-workspace.tsx src/features/makeup-requests/makeup-request-workspace.tsx src/features/tasks/ops-task-workspace.tsx tests/approval-workspace.test.mjs tests/makeup-request-workspace.test.mjs tests/ops-task-workspace.test.mjs tests/registration-consultation-notification.test.mjs
git commit -m "refactor: centralize Google Chat notification settings"
```

### Task 4: Fence new internal inbox and Web Push deliveries

**Files:**
- Create via Supabase CLI: one migration named `disable_internal_dashboard_notification_channels`
- Create: `supabase/tests/notification_internal_channels_disabled_test.sql`
- Create: `tests/notification-internal-channel-fence.test.mjs`
- Modify: `src/features/notifications/server/notification-worker.ts`

**Interfaces:**
- Consumes: `dashboard_private.notification_rules`, delivery claim envelopes, existing provider adapters.
- Produces: `public.notification_internal_channels_disabled_runtime_version() returns integer`; all `in_app` and `web_push` rules disabled and rejected by runtime delivery handling.

- [ ] **Step 1: Read current Supabase changelog and CLI help**

Run:

```bash
supabase --version
supabase migration new --help
```

Review `https://supabase.com/changelog.md` for relevant PostgreSQL, Cron, or migration breaking changes before SQL implementation.

- [ ] **Step 2: Create the migration through the CLI**

Run:

```bash
supabase migration new disable_internal_dashboard_notification_channels
```

Copy the exact generated path into the Node contract and pgTAP file so both tests read the same migration.

- [ ] **Step 3: Write RED Node and pgTAP contracts**

Require the migration to:

```sql
update dashboard_private.notification_rules
set enabled = false
where channel_key in ('in_app', 'web_push')
  and enabled = true;
```

Require an immutable runtime marker returning version `1`, fixed `search_path`, `PUBLIC`/`anon`/`authenticated` execute revoked, and a trigger or checked management RPC boundary that prevents either internal channel from being re-enabled. Assert Google Chat/customer-message rows are unchanged.

Require the worker to terminalize a stale internal claim without invoking Web Push, Google Chat, or SOLAPI providers.

- [ ] **Step 4: Run tests and verify RED**

Run:

```bash
node --test --experimental-strip-types tests/notification-internal-channel-fence.test.mjs
node scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/notification_internal_channels_disabled_test.sql
```

Expected: FAIL because the marker/fence and worker handling do not exist.

- [ ] **Step 5: Implement the additive fence**

Keep historical tables and rows. Add the version marker and exact re-enable rejection in the active migration lane. In the worker, return a stable `internal_channel_disabled` terminal outcome before rendering or provider selection for `in_app`/`web_push` claims.

- [ ] **Step 6: Run tests and verify GREEN**

Run the Step 4 commands. Expected: Node and pgTAP tests pass with zero provider calls.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations supabase/tests/notification_internal_channels_disabled_test.sql tests/notification-internal-channel-fence.test.mjs src/features/notifications/server/notification-worker.ts
git commit -m "feat: disable internal notification channels"
```

### Task 5: Verify external channel readiness without sending

**Files:**
- Create: `docs/operations/evidence/2026-08-15-external-notification-reactivation.md`

**Interfaces:**
- Consumes: production-safe configuration metadata, runtime markers, exact rule/event matrix, provider-zero adapters.
- Produces: a PII-free readiness receipt that names each event/channel cell as `ready`, `blocked`, or `not_applicable`.

- [ ] **Step 1: Run source and provider-zero verification**

Run:

```bash
node --test --experimental-strip-types \
  tests/admin-shell.test.mjs \
  tests/notification-google-chat-settings.test.mjs \
  tests/notification-control-plane-ui.test.mjs \
  tests/notification-internal-channel-fence.test.mjs \
  tests/notification-control-plane-worker.test.mjs \
  tests/notification-google-chat-connection-catalog.test.mjs \
  tests/registration-customer-message-solapi.test.mjs \
  tests/registration-observation-solapi-provider-zero.test.mjs
pnpm exec tsc --noEmit
pnpm lint
pnpm build
pnpm preflight:google-chat-connections
git diff --check
```

Record exact exit codes and failure names. A failure in these task-focused tests blocks activation. A pre-existing unrelated full-suite failure remains separate baseline evidence.

- [ ] **Step 2: Read production runtime state**

Using authenticated Supabase tooling, read only runtime markers, active rules, schedule/cron state, last safe worker run, Google Chat connection states, verified mention counts, and SOLAPI configuration presence. Never print secret values or customer data.

- [ ] **Step 3: Reconcile readiness gaps**

For a missing passive migration or schedule, apply only the reviewed forward migration/configuration. Re-read the exact state after each mutation. Do not enable a channel cell whose connection, template approval, dedupe, source, or worker proof is missing.

- [ ] **Step 4: Write the readiness receipt**

For each supported cell record:

```text
source_kind | event_kind | channel | source_test | db_ready | connection_ready | provider_zero | next_gate
```

Do not include names, phone numbers, message bodies, webhook URLs, or provider secrets.

- [ ] **Step 5: Commit**

```bash
git add scripts docs/operations/evidence/2026-08-15-external-notification-reactivation.md
git commit -m "test: record external notification readiness"
```

### Task 6: Publish and activate verified external cells

**Files:**
- Modify: `docs/operations/evidence/2026-08-15-external-notification-reactivation.md`

**Interfaces:**
- Consumes: clean focused verification, reviewed migrations, exact readiness matrix from Task 5.
- Produces: GitHub `main`, Vercel Production `READY`, active worker/schedule, and separate provider/recipient receipts for each enabled cell.

- [ ] **Step 1: Run final local verification**

Run:

```bash
node --test --experimental-strip-types \
  tests/admin-shell.test.mjs \
  tests/notification-google-chat-settings.test.mjs \
  tests/notification-control-plane-ui.test.mjs \
  tests/notification-internal-channel-fence.test.mjs \
  tests/notification-control-plane-worker.test.mjs \
  tests/notification-google-chat-connection-catalog.test.mjs \
  tests/registration-customer-message-solapi.test.mjs \
  tests/registration-observation-solapi-provider-zero.test.mjs
node scripts/run-isolated-supabase-db-tests.mjs --execute --authorized --request-id "$TASK_REQUEST_ID" --test supabase/tests/notification_internal_channels_disabled_test.sql
pnpm exec tsc --noEmit
pnpm lint
pnpm build
git diff --check
```

Compare failures with the captured unrelated baseline; no new failure is allowed.

- [ ] **Step 2: Publish the branch through review**

Push the branch, create/review the PR, merge to `main`, and record the merge SHA. Do not describe provider activation as complete at this step.

- [ ] **Step 3: Verify Vercel Production**

Confirm the deployment for the merge SHA reaches `READY`, then inspect the authenticated header, nested environment settings menu, Google Chat-only settings page, and read-only external delivery summary.

- [ ] **Step 4: Apply and verify production DB changes**

Confirm migration ledger parity, apply the internal-channel fence migration, verify marker version `1`, verify all internal rules disabled, and re-read Google Chat/SOLAPI rules without exposing secrets.

- [ ] **Step 5: Activate verification cells**

Move only approved synthetic/test source IDs to `verification` with a future expiry and current timestamp cutoff. Start the worker/schedule only after verification scope is visible on re-read.

- [ ] **Step 6: Verify Google Chat provider and receipt**

Send the fixed non-business verification message through each required Google Chat connection. Record safe request IDs/statuses and confirm arrival in the intended Chat spaces. Missing mention mapping may omit a mention but must be recorded; broad mentions are forbidden.

- [ ] **Step 7: Verify SOLAPI provider and receipt**

Use only the configured verification recipient and approved fixed template. Confirm provider acceptance and actual device receipt separately for booking confirmation and reminder. Do not send to an arbitrary production customer as a test.

- [ ] **Step 8: Promote verified cells to live**

Promote only cells whose provider and recipient gates passed. Use a new eligibility cutoff so historical events are not replayed. Re-read gate versions, schedule, and worker status after the mutation.

- [ ] **Step 9: Observe the first live cycle**

Confirm worker execution, delivery state, provider result, and one intended recipient receipt per event/channel. If a cell produces unknown acceptance, wrong routing, unexpected duplicate, or missing receipt, immediately return that cell to `off` and retain the business record.

- [ ] **Step 10: Complete the evidence report**

Update the evidence document with separate source/tests, migration, `main`/Vercel, runtime/worker, provider, and recipient gates. State the first unmet gate for any cell not promoted to live.
