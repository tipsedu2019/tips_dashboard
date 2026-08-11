# Notification Adapters Forward Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 active 알림 control-plane에 passive adapter runtime capability를 forward-install하여, Task 6의 실제 service-role setter와 Google Chat/in-app provider-zero lifecycle을 로컬 disposable DB에서 끝까지 검증한다.

**Architecture:** 먼저 baseline active chain만 적용하는 독립 runner가 실제 dispatch setter의 marker-missing failure를 기록한다. 그 다음 새 active forward migration이 current-path ownership ABI와 passive marker를 설치하고, content-hashed layout exception·pgTAP으로 검증된다. 마지막으로 같은 manifest-owned runner가 production RPC lifecycle을 Google Chat sending 및 in-app sent 경계까지 실행하되 provider/Directory/external-attempt 전에는 멈춘다.

**Tech Stack:** Supabase CLI 2.103.0, PostgreSQL/pgTAP/RLS/SECURITY DEFINER, Node.js test runner, existing notification control-plane RPCs, isolated local Docker Supabase project, ESLint, TypeScript, Next.js webpack build.

## Global Constraints

- 권위 문서는 docs/superpowers/specs/2026-08-12-notification-adapters-forward-install-design.md와 .superpowers/sdd/2026-08-09-registration-observation-google-chat/task-6-brief.md다.
- supabase/pending-migrations/notification-cutover/의 SQL, manifest, SHA, test는 수정·복사·이동·실행·runtime import하지 않는다.
- 기존 migration, frozen common runner scripts/run-registration-observation-local-db-qa.mjs, common runner test를 변경하지 않는다.
- independent runner에 들어가는 prerequisite/history fixture 두 문자열만 common runner source와 SHA-256으로 동등함을 증명한다. source fixture를 import하거나 runtime에 읽지 않는다.
- pinned Supabase CLI가 만든 새 timestamp migration 하나만 active lane에 추가한다. MIGRATION_PATH와 MIGRATION_BASENAME은 Task 2 generator gate가 출력한 유일한 path/basename이다.
- migration은 cron.schedule, pg_net, net.http, Vault, webhook, provider, Directory, worker loop, activation RPC를 만들거나 호출하지 않는다.
- migration은 기존 runtime flag 값을 변경하지 않는다. dispatch/adapter flag가 하나라도 enabled인 fixture에서는 오류로 중단한다. 새 owner row 10개는 모두 owner_kind='legacy'다.
- remote Supabase, linked DB, Vercel, Git push, production flag/rule change, worker/cron start, provider/Directory/customer/recipient request는 수행하지 않는다.
- private SQL은 SECURITY DEFINER, SET search_path='', owner postgres, API-role direct EXECUTE revoke를 사용한다. public marker만 authenticated, service_role EXECUTE를 갖는다.
- 모든 DB verification은 manifest-owned loopback local project에서 실행하며, every path cleans only its own project/container/network/lease/temp-root and reports transport/provider counter zero.

## File Structure

| Path | Responsibility |
| --- | --- |
| scripts/run-registration-observation-google-chat-provider-zero.mjs | Independent project builder, baseline marker-missing receipt, staged forward apply, transport traps, final evidence. |
| tests/registration-observation-google-chat-provider-zero-runner.test.mjs | Argument/environment, fixture SHA, command, staged migration, cleanup, evidence unit tests. |
| supabase/migrations/$MIGRATION_BASENAME | One frozen active forward migration: preflight, owner table/resolver, current-path ABI, passive marker, ACL/RLS. |
| supabase/tests/notification_adapters_forward_install_test.sql | pgTAP for ABI, mapping, RLS/ACL, flags, and real setter order. |
| tests/notification-adapters-forward-install.test.mjs | Source contract and mutation sensitivity for the frozen forward migration. |
| scripts/verify-supabase-migration-layout.mjs | Content-hashed forward migration exception for the adapters marker. |
| tests/supabase-migration-layout.test.mjs | Verifier regression for a changed forward token and copied quarantine source. |
| tests/registration-observation-google-chat-provider-zero.test.mjs | Full disposable Task 6 lifecycle receipt. |
| package.json | One independent verification command. |

---

### Task 1: Build baseline-only owned runner and prove the real marker-missing boundary

**Files:**
- Create: scripts/run-registration-observation-google-chat-provider-zero.mjs
- Create: tests/registration-observation-google-chat-provider-zero-runner.test.mjs

**Interfaces:**
- Consumes: pinned supabase-go, frozen common runner source only for approved fixture SHA comparison, current active migrations through 20260809105000.
- Produces: parseProviderZeroArguments(argv), assertProviderZeroEnvironment(env), createOwnedProviderZeroProject(options), and runRegistrationObservationGoogleChatProviderZero(options).

- [ ] **Step 1: Write failing runner unit tests**

Create the runner test with injected spawnImpl and makeTempRoot. Assert exact rejection contracts:

~~~js
await assert.rejects(
  runRegistrationObservationGoogleChatProviderZero({ argv: [], env: {}, spawnImpl, makeTempRoot }),
  /registration_observation_google_chat_provider_zero_execute_required/,
)
await assert.rejects(
  runRegistrationObservationGoogleChatProviderZero({
    argv: ["--execute", "--approved-local-db"],
    env: { GOOGLE_CHAT_WEBHOOK_URL: "forbidden" },
    spawnImpl,
    makeTempRoot,
  }),
  /provider_zero_secret_environment_forbidden/,
)
~~~

Add unit assertions that all child commands use the pinned CLI, manifest-owned project ID, and loopback URL; all inherited SUPABASE connection values and Google Chat/SOLAPI/webhook values are absent; and the two independent fixture strings SHA-256 match the corresponding source functions in the common runner.

- [ ] **Step 2: Run the unit tests to record RED**

~~~bash
node --experimental-strip-types --test tests/registration-observation-google-chat-provider-zero-runner.test.mjs
~~~

Expected: FAIL because the independent runner/export is absent. No local project or network call happens before argument validation.

- [ ] **Step 3: Implement argument, environment, manifest, and cleanup contracts**

Implement these exact public guards:

~~~js
export function parseProviderZeroArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--execute" || argv[1] !== "--approved-local-db") {
    throw new Error("registration_observation_google_chat_provider_zero_execute_required")
  }
  return Object.freeze({ execute: true, approvedLocalDb: true })
}

export function assertProviderZeroEnvironment(env) {
  const forbidden = Object.keys(env).filter((key) =>
    /SUPABASE_(URL|KEY|DB_PASSWORD)|GOOGLE_CHAT|SOLAPI|WEBHOOK/i.test(key),
  )
  if (forbidden.length > 0) throw new Error("provider_zero_secret_environment_forbidden")
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => /^(HOME|LANG|PATH|SHELL|TMPDIR|USER)$/.test(key)),
  )
}
~~~

createOwnedProviderZeroProject verifies supabase-go version 2.103.0, reserves unique loopback ports, writes a manifest before each resource,
and in finally stops only manifest project/container/network/lease/temp-root IDs. It returns applyMigrationsThrough(version), execSql(sql),
runPgTap(path), and cleanupOwnedResources().

- [ ] **Step 4: Add the real baseline receipt**

Apply migrations only through 20260809105000, run the existing focused Google Chat pgTAP through its frozen command, seed only synthetic local
prerequisites, then execute this genuine production path:

~~~text
readiness → activate_registration_observation_runtime_v1(0, request key)
→ heartbeat.started → heartbeat.succeeded
→ set_notification_runtime_flag_v1(settings-ui, false/1→true/2)
→ set_notification_runtime_flag_v1(registration-dispatch, false/1→ERROR 55000 notification_runtime_not_ready)
~~~

Record the named rejection and assert fetch/http/https/provider/directory/externalAttempt equal zero. Do not stage a forward migration in Task 1.

- [ ] **Step 5: Run runner GREEN and local baseline evidence**

~~~bash
node --experimental-strip-types --test tests/registration-observation-google-chat-provider-zero-runner.test.mjs
PATH=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  exec node --experimental-strip-types \
  scripts/run-registration-observation-google-chat-provider-zero.mjs --execute --approved-local-db
~~~

Expected: unit tests pass; the owned DB reaches exactly the adapters-marker blocker, cleanup passes, and no external side effect occurs.

- [ ] **Step 6: Commit the baseline runner foundation**

~~~bash
git add \
  scripts/run-registration-observation-google-chat-provider-zero.mjs \
  tests/registration-observation-google-chat-provider-zero-runner.test.mjs
git commit -m "test: capture adapter runtime provider-zero baseline"
~~~

---

### Task 2: Generate one forward migration and prove passive adapter capability

**Files:**
- Create: supabase/migrations/$MIGRATION_BASENAME
- Create: supabase/tests/notification_adapters_forward_install_test.sql
- Create: tests/notification-adapters-forward-install.test.mjs
- Modify: scripts/verify-supabase-migration-layout.mjs
- Modify: tests/supabase-migration-layout.test.mjs
- Modify: scripts/run-registration-observation-google-chat-provider-zero.mjs
- Modify: tests/registration-observation-google-chat-provider-zero-runner.test.mjs

**Interfaces:**
- Consumes: Task 1 project builder, runtime flags, heartbeat table, request ledger, registration marker, quarantine verifier.
- Produces: dashboard_private.notification_cutover_owners, dashboard_private.notification_dispatch_scope_for_event_v1(text,text), and public.notification_workflow_adapters_runtime_version().

- [ ] **Step 1: Write source and pgTAP RED tests**

Create tests/notification-adapters-forward-install.test.mjs. It locates exactly one filename matching the generated suffix,
requires owner table/resolver/marker, and rejects cron.schedule, net.http, pg_net, vault, webhook, provider, directory tokens.
It also rejects an UPDATE against notification_runtime_flags or any enabled=true literal in the migration source.

Create supabase/tests/notification_adapters_forward_install_test.sql with plan(30). Check every one of the ten rows, legacy owner,
all registration branches, six non-registration scopes, null/unknown result, marker result, RLS, table/function ACL, empty search path,
unchanged flags, and direct DML denial:

~~~sql
select is(
  dashboard_private.notification_dispatch_scope_for_event_v1(
    'registration', 'registration.phone_consultation_ready'
  ), 'registration_phone'
);
select is(
  dashboard_private.notification_dispatch_scope_for_event_v1('unknown', 'unknown.event'),
  null::text
);
select is(public.notification_workflow_adapters_runtime_version(), 1);
select ok(not has_table_privilege('authenticated', 'dashboard_private.notification_cutover_owners', 'select'));
select ok(has_function_privilege('authenticated', 'public.notification_workflow_adapters_runtime_version()', 'execute'));
select ok(not has_function_privilege('anon', 'public.notification_workflow_adapters_runtime_version()', 'execute'));
~~~

In the Node test, build two owned migration fixtures: one pre-creates a conflicting owner table row and one pre-creates the marker signature
with a wrong ACL. Each apply must fail closed, preserve every runtime flag/rule value, and leave no newly inserted owner row.

- [ ] **Step 2: Run source/DB RED**

~~~bash
node --experimental-strip-types --test tests/notification-adapters-forward-install.test.mjs
~~~

Use Task 1 project at baseline schema to execute forward pgTAP. Expected: source test fails while migration is absent; after an empty
generated file exists, pgTAP fails on absent table/resolver/marker. No provider or remote project is used.

- [ ] **Step 3: Generate, freeze, and stage the empty migration**

~~~bash
SUPABASE_GO=/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go
"$SUPABASE_GO" --version
"$SUPABASE_GO" migration new notification_adapters_forward_install
MIGRATION_PATH="$(find supabase/migrations -maxdepth 1 -type f -name '*_notification_adapters_forward_install.sql' -print)"
test "$(printf '%s\n' "$MIGRATION_PATH" | sed '/^$/d' | wc -l | tr -d ' ')" = 1
test ! -s "$MIGRATION_PATH"
MIGRATION_BASENAME="$(basename "$MIGRATION_PATH")"
git add "$MIGRATION_PATH"
~~~

Require CLI version 2.103.0, one emitted migration, valid 14-digit prefix, zero bytes, and a staged name-only diff containing only MIGRATION_PATH.
Do not commit an empty migration body.

- [ ] **Step 4: Implement forward package in one transaction**

Begin the migration with this preflight:

~~~sql
do $$
begin
  if pg_catalog.to_regclass('dashboard_private.notification_cutover_owners') is not null
    or pg_catalog.to_regprocedure('public.notification_workflow_adapters_runtime_version()') is not null
    or pg_catalog.to_regclass('dashboard_private.notification_worker_heartbeats') is null
    or pg_catalog.to_regprocedure('public.registration_appointment_reminders_runtime_version()') is null
    or exists (
      select 1 from dashboard_private.notification_runtime_flags
      where flag_key in (
        'notification_control_plane_dispatch_tasks_enabled',
        'notification_control_plane_dispatch_word_retests_enabled',
        'notification_control_plane_dispatch_registration_enabled',
        'notification_control_plane_registration_phone_adapter_enabled',
        'notification_control_plane_registration_visit_adapter_enabled',
        'notification_control_plane_registration_solapi_adapter_enabled',
        'notification_control_plane_dispatch_transfer_enabled',
        'notification_control_plane_dispatch_withdrawal_enabled',
        'notification_control_plane_dispatch_makeup_requests_enabled',
        'notification_control_plane_dispatch_approvals_enabled'
      ) and enabled
    ) then
    raise exception 'notification_adapters_forward_install_preflight_failed' using errcode = '55000';
  end if;
end;
$$;
~~~

Create table constraints/RLS/no API grants and plain INSERT of exact ten design tuples. Create private immutable resolver with SET search_path='':
phone consultation → phone; visit prefix → visit; admission-message prefix → SOLAPI; other registration → registration; each six known
non-registration workflow → itself; null/unknown → NULL. A further active-path helper may be added only after a direct lifecycle test names its
exact signature and fails because it is absent.

Create marker last:

~~~sql
create or replace function public.notification_workflow_adapters_runtime_version()
returns integer language sql immutable security invoker set search_path = ''
as $$ select 1; $$;
alter function public.notification_workflow_adapters_runtime_version() owner to postgres;
revoke all on function public.notification_workflow_adapters_runtime_version() from public, anon;
grant execute on function public.notification_workflow_adapters_runtime_version() to authenticated, service_role;
commit;
~~~

- [ ] **Step 5: Make layout exception exact and content-bound**

~~~bash
MIGRATION_SHA256="$(shasum -a 256 "$MIGRATION_PATH" | awk '{print $1}')"
printf '%s\n%s\n' "$MIGRATION_BASENAME" "$MIGRATION_SHA256"
~~~

Write the emitted basename/SHA as literal ADAPTER_FORWARD_INSTALL_FILE and ADAPTER_FORWARD_INSTALL_SHA256 constants. Bypass only
worker_schedule.runtime_version when basename, hash, and this predicate all match:

~~~js
function adapterForwardInstallContractValid(source) {
  return /create table dashboard_private\.notification_cutover_owners/i.test(source)
    && /notification_dispatch_scope_for_event_v1/i.test(source)
    && /create or replace function public\.notification_workflow_adapters_runtime_version\(\)/i.test(source)
    && /revoke all on function public\.notification_workflow_adapters_runtime_version\(\)\s+from public, anon/i.test(source)
    && /grant execute on function public\.notification_workflow_adapters_runtime_version\(\)\s+to authenticated, service_role/i.test(source)
    && !/cron\.schedule|net\.http|pg_net|vault|manage_notification_worker_schedule_v1|activate_notification_dispatch_cutover_v1/i.test(source)
}
~~~

Keep all other quarantine timestamps, hashes, semantic hashes, reserved objects, and activation markers blocked. Add verifier fixtures that mutate
one forward token and copy one quarantine source into active migrations; both must fail.

- [ ] **Step 6: Run passive-capability GREEN and mutation checks**

~~~bash
node --experimental-strip-types --test \
  tests/notification-adapters-forward-install.test.mjs \
  tests/supabase-migration-layout.test.mjs \
  tests/registration-observation-google-chat-provider-zero-runner.test.mjs
node scripts/verify-supabase-migration-layout.mjs
~~~

Use Task 1 methods to stage only MIGRATION_PATH after baseline, then execute the forward pgTAP. Temporarily remove phone mapping, change
one legacy owner, grant authenticated table SELECT, remove resolver search_path, and return marker 0. The named assertion must fail each time.
Restore exact source and require pgTAP 30/30 green with no runtime flag/rule/event/delivery/provider change. Execute the two pre-created
conflict fixtures from Step 1 and require their migration apply to fail before owner insertion or flag/rule mutation.

- [ ] **Step 7: Commit frozen migration package**

~~~bash
git add \
  supabase/migrations/*_notification_adapters_forward_install.sql \
  supabase/tests/notification_adapters_forward_install_test.sql \
  tests/notification-adapters-forward-install.test.mjs \
  scripts/verify-supabase-migration-layout.mjs \
  tests/supabase-migration-layout.test.mjs \
  scripts/run-registration-observation-google-chat-provider-zero.mjs \
  tests/registration-observation-google-chat-provider-zero-runner.test.mjs
git diff --cached --check
git commit -m "feat: install notification adapter runtime capability"
~~~

---

### Task 3: Complete the real provider-zero lifecycle receipt

**Files:**
- Create: tests/registration-observation-google-chat-provider-zero.test.mjs
- Modify: scripts/run-registration-observation-google-chat-provider-zero.mjs
- Modify: tests/registration-observation-google-chat-provider-zero-runner.test.mjs
- Modify: package.json

**Interfaces:**
- Consumes: Task 1 runner, Task 2 marker/package, production readiness/activation/heartbeat/flag/v2-save/claim/frozen-read/final-prepare RPCs.
- Produces: verify:registration-observation:google-chat and a closed local evidence receipt.

- [ ] **Step 1: Write integration RED**

Create the test with exact bootstrap trace and zero-send boundary:

~~~js
assert.deepEqual(callTrace.slice(0, 8), [
  "readiness", "activate", "heartbeat.started", "heartbeat.succeeded",
  "flag.settings-ui", "flag.registration-dispatch", "v2-save", "lifecycle",
])
assert.equal(receipt.coreReadiness.runtimeVersion, 0)
assert.equal(receipt.coreActivation.runtimeVersion, 1)
assert.deepEqual(receipt.heartbeat.countKeys, [
  "observation_due", "fanout", "rule_reconciliation",
  "target_reconciliation", "deliveries", "reaped",
])
assert.equal(receipt.fetch, 0)
assert.equal(receipt.http, 0)
assert.equal(receipt.https, 0)
assert.equal(receipt.directory, 0)
assert.equal(receipt.provider, 0)
assert.equal(receipt.externalAttemptAudit, 0)
~~~

Also assert activation replay byte-equal; both setters produce false/1 → true/2 through service role only; one v2 patch/replay enables four
required rules; scheduled Google Chat is sending/dispatch_started after locked read → refresh → locked read → final-prepare; paired feedback
has management Chat sending and in-app sent/closed with one dashboard notification; null/banned director cancels only in-app as recipient_revoked;
null director before fanout gives management=1/in-app=0; A→B freezes two verified names; customer/SOLAPI fingerprints remain equal.

- [ ] **Step 2: Run integration RED**

~~~bash
node --experimental-strip-types --test tests/registration-observation-google-chat-provider-zero.test.mjs
~~~

Expected: first unimplemented ordered lifecycle receipt fails, every trap counter is zero, exact project cleanup succeeds.

- [ ] **Step 3: Implement only real production-seam lifecycle calls**

Seed synthetic local auth/admin, campus/class/session/catalog, verified/missing users/... identity, zero push subscriptions, customer queue sentinel,
and deterministic syntactically valid fake google_chat.management connection. Invoke exactly:

~~~text
registration_observation_schema_readiness_v1
activate_registration_observation_runtime_v1
record_notification_worker_heartbeat_v1
set_notification_runtime_flag_v1
save_notification_control_plane_v2
claim_notification_deliveries_v1
read_registration_observation_notification_delivery_frozen_state_v1
prepareRegistrationObservationDeliveryForDispatch
begin_notification_delivery_send_v1 | commit_notification_in_app_delivery_v1
~~~

Stop Google Chat after real begin and before external-attempt registration. Use atomic in-app commit and require one dashboard notification.
Test-only director null/ban occurs after paired fanout/claim in the disposable DB; execute paired final-prepare in both channel orders.

- [ ] **Step 4: Add exact command and run lifecycle GREEN**

Add only this package script:

~~~json
"verify:registration-observation:google-chat": "node --experimental-strip-types scripts/run-registration-observation-google-chat-provider-zero.mjs --execute --approved-local-db"
~~~

Then run:

~~~bash
PATH=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  run verify:registration-observation:google-chat
node --experimental-strip-types --test \
  tests/registration-observation-google-chat-provider-zero.test.mjs \
  tests/notification-registration-observation.test.mjs \
  tests/notification-google-chat-content.test.mjs \
  tests/notification-control-plane-worker.test.mjs \
  tests/notification-content-contract.test.mjs \
  tests/notification-content-manifest.test.mjs \
  tests/notification-operations.test.mjs
~~~

Expected: ordered lifecycle succeeds; all transport/provider/attempt counters zero; Chat stops sending; in-app sent; customer/SOLAPI fingerprints
unchanged; every manifest resource disappears.

- [ ] **Step 5: Commit lifecycle proof**

~~~bash
git add \
  scripts/run-registration-observation-google-chat-provider-zero.mjs \
  tests/registration-observation-google-chat-provider-zero.test.mjs \
  tests/registration-observation-google-chat-provider-zero-runner.test.mjs \
  package.json
git commit -m "test: prove observation chat provider zero lifecycle"
~~~

---

### Task 4: Final verification, review, and bounded handoff

**Files:**
- Modify: .superpowers/sdd/2026-08-09-registration-observation-google-chat/task-6-report.md (ignored evidence only)
- Verify: all Task 1–3 files

**Interfaces:**
- Consumes: frozen migration, layout verifier, forward pgTAP, independent runner evidence.
- Produces: a local-only report that separates source/tests from migration application, deployment, runtime activation, provider request, and recipient receipt.

- [ ] **Step 1: Run final static, DB, and source verification**

~~~bash
node scripts/verify-supabase-migration-layout.mjs
node --experimental-strip-types --test \
  tests/notification-adapters-forward-install.test.mjs \
  tests/supabase-migration-layout.test.mjs \
  tests/registration-observation-google-chat-provider-zero-runner.test.mjs \
  tests/registration-observation-google-chat-provider-zero.test.mjs
git diff --check
git status --short --branch
~~~

Expected: no layout error, no bypass outside the one content-hashed migration, no whitespace error, only Task files changed.

- [ ] **Step 2: Run lint, typecheck, and build**

~~~bash
PATH=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  exec eslint \
    scripts/run-registration-observation-google-chat-provider-zero.mjs \
    tests/notification-adapters-forward-install.test.mjs \
    tests/registration-observation-google-chat-provider-zero-runner.test.mjs \
    tests/registration-observation-google-chat-provider-zero.test.mjs
PATH=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  exec tsc --noEmit
PATH=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
  /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm \
  run build
~~~

Expected: all pass. A missing bare-shell node is environment evidence only; it never replaces bundled-Node results.

- [ ] **Step 3: Request independent code review**

Review the committed range against these questions:

~~~text
1. Does any active migration copy, move, or execute quarantine SQL?
2. Can any file other than content-hashed forward migration bypass adapters marker reservation?
3. Are owner table/RLS, private ACL, marker ACL, search_path, and preflight fail-closed?
4. Does the runner own every resource, migration phase, fixture copy, transport trap, and cleanup path?
5. Does lifecycle use production RPCs and stop before Google external-attempt registration?
6. Does code mutate remote state, production activation, customer/SOLAPI rows, worker/cron, or provider/recipient state?
~~~

Resolve every Critical or Important result by a named RED, minimal fix, and fresh GREEN.

- [ ] **Step 4: Append evidence and make final local commit**

Append only sanitized migration basename/SHA, baseline rejection, marker/ACL pgTAP, lifecycle receipt, zero counters, customer/SOLAPI fingerprints,
cleanup, verification results, review verdict, and release exclusions to the ignored Task 6 report. Then run:

~~~bash
git add \
  supabase/migrations/*_notification_adapters_forward_install.sql \
  supabase/tests/notification_adapters_forward_install_test.sql \
  tests/notification-adapters-forward-install.test.mjs \
  scripts/verify-supabase-migration-layout.mjs \
  tests/supabase-migration-layout.test.mjs \
  scripts/run-registration-observation-google-chat-provider-zero.mjs \
  tests/registration-observation-google-chat-provider-zero-runner.test.mjs \
  tests/registration-observation-google-chat-provider-zero.test.mjs \
  package.json
git diff --cached --check
git commit -m "test: complete adapter runtime provider-zero verification"
git status --short --branch
~~~

Expected: clean tracked worktree. Stop after commit: no push, deploy, remote migration, production rule/flag enable, worker/cron start, or provider/recipient request.

## Plan Self-Review

### Spec coverage

- Baseline real setter failure, exact owned fixture, local resource cleanup: Task 1.
- Forward package, owner mapping, resolver, marker, ACL/RLS, passive flags, quarantine protection: Task 2.
- Full readiness/activation/heartbeat/flag/v2-save/lifecycle trace with Google Chat/in-app boundaries and provider-zero counters: Task 3.
- Static/DB/Node/lint/typecheck/build, review, report, and release separation: Task 4.

### Interface consistency

- runRegistrationObservationGoogleChatProviderZero({ argv, env, spawnImpl, makeTempRoot }) is defined in Task 1 and extended in Tasks 2–3.
- MIGRATION_PATH is created once in Task 2; its basename/SHA become exact verifier values and the runner sole second-phase migration path.
- Marker signature is always public.notification_workflow_adapters_runtime_version() returns integer.
- Evidence separates baseline runtimeVersion=0, disposable core activation 0→1, final local cleanup, and every excluded operational action.
