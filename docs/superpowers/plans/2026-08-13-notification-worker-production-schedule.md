# Notification Worker Production Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install and activate one persistent minute-level shared notification worker and watchdog without enabling any observation rule or calling a provider during installation.

**Architecture:** One new active forward migration adds only the current-schema schedule boundary: stop latch, watchdog receipts, Vault validation, authenticated worker invocation, watchdog inspection, and service-role schedule management. The historical quarantine SQL remains untouched and unexecuted; rule activation remains a later control-plane operation.

**Tech Stack:** PostgreSQL, Supabase Vault, pg_cron, pg_net, pgTAP, Next.js worker route, Node test runner.

## Global Constraints

- Do not copy, move, edit, import, or execute `supabase/pending-migrations/notification-cutover`.
- Do not enable notification rules or runtime flags in the migration.
- Do not print or commit a worker URL, bearer secret, webhook, provider credential, or recipient data.
- Keep the existing worker route and worker implementation as the sole dispatch path.
- Run provider-zero isolated DB tests before any production migration or schedule install.

---

### Task 1: Freeze the current-schema schedule contract

**Files:**
- Create: `supabase/migrations/*_notification_worker_production_schedule.sql`
- Create: `supabase/tests/notification_worker_production_schedule_test.sql`
- Create: `tests/notification-worker-production-schedule.test.mjs`
- Modify: `scripts/run-registration-observation-local-db-qa.mjs`

**Interfaces:**
- Consumes: `public.record_notification_worker_heartbeat_v1(text,uuid,text,jsonb,text)`, `public.assert_notification_worker_run_allowed_v1(text)` route call, Vault, pg_cron, pg_net.
- Produces: `public.assert_notification_worker_run_allowed_v1(text)`, `public.manage_notification_worker_schedule_v1(text,uuid)`, two exact cron jobs, secret-free inspect receipt.

- [ ] **Step 1: Write source and pgTAP tests before production SQL**

Require one migration, exact public signatures/ACL, one worker and one watchdog cron, no rule/flag mutation, no quarantine body hash or source import, invalid Vault rejection, and exact secret-free inspect keys.

- [ ] **Step 2: Run tests and capture RED**

```bash
node --experimental-strip-types --test tests/notification-worker-production-schedule.test.mjs
```

Expected: failure because the forward migration is absent.

- [ ] **Step 3: Generate one migration with Supabase CLI 2.103.0**

```bash
supabase-go migration new notification_worker_production_schedule
```

Require exactly one empty 14-digit migration and no timestamp collision.

- [ ] **Step 4: Implement the minimal transaction**

Add dependency drift gates, stop latch/watchdog tables, private Vault and HTTP helpers, public run-allowed and schedule-manage wrappers, exact ACL/RLS, and no provider/rule mutation. `install` unschedules only the two exact names before scheduling each once at `* * * * *`.

- [ ] **Step 5: Run local GREEN**

Run source tests, focused pgTAP through the manifest-owned local runner, migration layout, lint, tsc, webpack, and diff check. Expected provider calls: zero.

- [ ] **Step 6: Commit and deploy the inert install**

Commit only the migration/tests/runner ledger, push feature and main through normal workflows, verify migration workflow success and Vercel READY on the same SHA. Rules remain OFF.

### Task 2: Provision schedule secrets and activate heartbeat only

**Files:**
- Modify: `docs/superpowers/reports/2026-08-13-notification-worker-production-schedule.md`

**Interfaces:**
- Consumes: Production Vercel `NOTIFICATION_WORKER_SECRET`, Supabase Vault `notification_worker_url` and `notification_worker_bearer_secret`, `manage_notification_worker_schedule_v1`.
- Produces: exact one worker/one watchdog schedule plus current heartbeat, with all observation rules still OFF.

- [ ] **Step 1: Generate and install one secret without printing it**

Set the same random 32-byte-or-longer value in Vercel Production `NOTIFICATION_WORKER_SECRET` and Supabase Vault `notification_worker_bearer_secret`; store the Production worker URL in `notification_worker_url`.

- [ ] **Step 2: Redeploy identical code SHA and verify READY**

Confirm the Vercel Production deployment uses the migration-tested SHA and that unauthenticated worker requests still return 401.

- [ ] **Step 3: Install schedules through the service-role RPC**

Call `public.manage_notification_worker_schedule_v1('install', <fresh uuid>)`, require exact one active worker and watchdog at `* * * * *`.

- [ ] **Step 4: Verify two intervals**

Require latest worker `succeeded`, exact six count keys including `observation_due`, recent observation heartbeat true, current watchdog healthy, and provider attempt delta zero while all eight observation rules remain OFF.

- [ ] **Step 5: Record production evidence and continue staged channel activation**

Record only hashes/IDs/timestamps/counts. Continue to Google Chat identity/rule receipts and then SOLAPI receipts; do not claim completion at heartbeat-only state.
