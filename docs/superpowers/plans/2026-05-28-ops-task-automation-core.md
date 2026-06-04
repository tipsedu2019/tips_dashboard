# Ops Task Automation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first testable slice of recurring tasks, trigger-based follow-up tasks, dedupe keys, and Google Chat notification payloads for TIPS operational work.

**Architecture:** Keep operational state boards as their own work surfaces and use `ops_tasks` only for recurring work or follow-up work created after a meaningful event. Add pure model helpers first so the behavior is testable without Supabase, then add a migration skeleton for automation rules, execution logs, notification channel metadata, and task source metadata.

**Tech Stack:** Next.js 16, React 19, Supabase Postgres, Node test runner, plain JavaScript model helpers.

---

### Task 1: Pure Automation Model

**Files:**
- Modify: `src/features/tasks/ops-task-model.js`
- Test: `tests/ops-task-model.test.mjs`

- [x] Add failing tests for a registration-completed trigger rule that creates a follow-up task due five days after `registration.classStartDate`, assigned to the responsible teacher profile.
- [x] Add failing tests proving pipeline/status-board events do not create duplicate todos.
- [x] Add failing tests proving duplicate source keys suppress repeat generation.
- [x] Add failing tests for recurring daily, weekly, monthly-date, and monthly-last-weekday occurrence calculation.
- [x] Implement only the model helpers needed to satisfy those tests:
  - `buildOpsTriggeredTaskDraft`
  - `buildOpsRecurringTaskOccurrence`
  - `buildGoogleChatTaskNotificationPayload`

### Task 2: Supabase Schema Foundation

**Files:**
- Create: `supabase/migrations/20260528120000_ops_task_automation_core.sql`

- [x] Add columns to `public.ops_tasks` for automation source metadata: `automation_rule_id`, `automation_source_type`, `automation_source_id`, `automation_source_key`, and `automation_generated_at`.
- [x] Add `public.ops_task_automation_rules` for recurring and trigger rules.
- [x] Add `public.ops_task_automation_runs` for dedupe and execution history.
- [x] Add `public.ops_task_notification_channels` for team/channel metadata without storing raw webhook URLs in exposed rows.
- [x] Add `public.ops_task_notification_deliveries` for Google Chat send attempts and retry state.
- [x] Enable RLS and allow admin/staff to manage rules and channels while allowing assistant visibility where operationally needed.

### Task 3: Service Integration Slice

**Files:**
- Modify: `src/features/tasks/ops-task-service.ts`
- Test: `tests/ops-task-workspace.test.mjs`

- [x] Extend task mapping and input types with automation metadata.
- [x] Ensure `createOpsTask` can persist automation-generated source metadata.
- [x] Keep registration/transfer/withdrawal/word-retest status-board cards from being mirrored into todos unless a trigger rule explicitly creates follow-up work.

### Task 4: UI Slice

**Files:**
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Test: `tests/ops-task-workspace.test.mjs`

- [x] Add a `반복 업무` tab and an `자동화 규칙` entry point without replacing the existing `오늘`, `예정`, `내 담당`, `보드`, `일정`, and `완료` flow.
- [x] Surface generated task source labels such as `자동 생성`, `등록 완료 후속`, and the source student name.
- [x] Keep rule creation structured: trigger, conditions, action, due basis, assignee strategy, and notification channel.
- [x] Add `Google Chat 채널` settings so team rooms can be selected from automation rules.

### Task 5: Verification

**Files:**
- Test: `tests/ops-task-model.test.mjs`
- Test: `tests/ops-task-workspace.test.mjs`

- [x] Run `node --test tests/ops-task-model.test.mjs`.
- [x] Run `node --test tests/ops-task-workspace.test.mjs`.
- [x] Run `node --test tests/*.mjs` before claiming the goal slice is stable.
- [x] Run `tsc --noEmit`.
- [x] Run `next build --webpack`.
- [x] Browser-check `/admin/tasks?list=recurring` and `/admin/tasks?list=automations`.

### Remaining Goal Work

- [x] Add the actual automation executor that evaluates enabled rules and writes `ops_task_automation_runs`.
- [x] Add secure Google Chat delivery that resolves webhook secret references server-side and records `ops_task_notification_deliveries`.
- [ ] Apply the Supabase migration remotely once Supabase CLI/project access is available in this environment.

### 2026-05-28 Automation Runner Slice

- [x] Add `src/server/ops-task-automation-runner.js` for due recurring rule execution, trigger rule execution, delivery queue processing, dedupe/source-key checks, and server-side Google Chat webhook resolution.
- [x] Add `/api/ops-task-automations/run` guarded by `CRON_SECRET` so Vercel Cron can run the automation cycle without exposing a public mutation path.
- [x] Add `vercel.json` cron scheduling for the automation route.
- [x] Add `.env.example` keys for the Supabase service role, cron secret, and team-scoped Google Chat webhook env refs.
- [x] Hook completed registration, transfer, withdrawal, and word-retest events into trigger automation creation without mirroring ongoing state-board cards into `ops_tasks`.
- [x] Surface automation run state in settings: latest run, next recurring run, recent generated task, and Google Chat delivery pending/failed counts.
- [x] Add rule creation previews so staff can verify title, schedule, assignee, priority, checklist count, related menu, and Google Chat target before saving.
- [x] Add compact rule history details for recent automation runs and notification deliveries.
- [x] Persist checklist and related-menu intent in automation rule actions, and copy it into generated task memos for the current schema slice.
- [x] Add authenticated Google Chat channel test-send flow: admin/staff Supabase JWT verification, server-side webhook resolution, immediate test delivery, and delivery log recording.
- [x] Verify with focused automation tests, full Node tests, TypeScript, and production build.

### Next Goal Work

- [ ] Apply `supabase/migrations/20260528120000_ops_task_automation_core.sql` to the real Supabase project and verify generated types/schema cache.
- [ ] Add safer Google Chat onboarding in settings: copyable env var name and team-room mapping guidance.
- [ ] Promote generated-task checklist from memo text into a structured `ops_tasks` checklist schema when the task detail UI is ready to manage it.
- [ ] Add structured checklist, priority, and saved filter improvements to make the task surface feel closer to a daily work-management app.
