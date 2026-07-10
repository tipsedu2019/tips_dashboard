# Registration Workflow Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing registration workspace with one application-centered flow from first inquiry through class enrollment, without a Notion runtime dependency.

**Architecture:** Keep `OpsTaskWorkspace` as the shared operations shell used by transfer and withdrawal. Store each prospect as one registration task whose detail row accumulates level-test, consultation, decision, admission-form, manual-payment, and enrollment data. Use Supabase roster arrays for waitlist/enrollment effects and a server-only SOLAPI route for approved AlimTalk templates.

**Tech Stack:** Next.js App Router, React, Supabase, SOLAPI AlimTalk, source-level Node tests, and Playwright browser verification.

## Global Constraints

- One application remains the operational record throughout the process; no per-stage duplicate tasks.
- The process is inquiry -> level-test reservation -> level-test completion -> consultation reservation -> consultation completion -> enrollment/waitlist/not-enrolled decision -> admission form -> manual payment confirmation -> enrollment completion.
- A waitlist decision must add the student to the selected class waitlist; enrollment completion must move the student into that class roster.
- Payment stays manual in this implementation. No Toss Front, MakeEdu payment, kiosk, QR, card-terminal, or bank-transfer API integration is introduced.
- MakeEdu remains available for teacher-authored messages. Only approved automated customer messages use SOLAPI, with SMS fallback disabled.
- Registration does not expose the generic comments/attachments rail.

---

### Task 1: Lock Registration UX Contract

**Files:**
- Modify: `tests/ops-task-workspace.test.mjs`

- [x] Cover process tabs, filters, data table, mobile cards, notification settings, registration detail, decision actions, manual payment, waitlist sync, and SOLAPI wiring.
- [x] Keep the contract aligned with the shared transfer/withdrawal workspace pattern.

### Task 2: Extend Registration Detail Data

**Files:**
- Create: `supabase/migrations/20260710103000_registration_notion_parity_fields.sql`
- Modify: `src/features/tasks/ops-task-service.ts`
- Modify: `src/features/tasks/ops-task-workspace.tsx`

- [x] Add textbook preparation, visit consultation place, and timetable roster state.
- [x] Map the fields through reads, writes, forms, table values, detail, and checklist surfaces.

### Task 3: Build The Application-Centered Process

**Files:**
- Modify: `src/features/tasks/ops-task-model.js`
- Modify: `src/features/tasks/ops-task-service.ts`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Create: `supabase/migrations/20260710150000_registration_operational_flow.sql`

- [x] Model the real level-test, consultation, decision, admission-form, payment, and completion stages.
- [x] Require stage-specific fields before advancing.
- [x] Present explicit enrollment, waitlist, next-opening, and not-enrolled decisions after consultation.
- [x] Synchronize waitlist selections with the selected class and clean them up when the decision, class, or task changes.
- [x] Convert the waitlist link into an enrolled roster link on registration completion.

### Task 4: Add Approval-Ready Customer Messaging

**Files:**
- Create: `src/app/api/solapi/registration/route.ts`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `supabase/migrations/20260710150000_registration_operational_flow.sql`
- Create: `supabase/migrations/20260710153000_registration_message_least_privilege.sql`
- Create: `supabase/migrations/20260710154500_registration_message_policy_performance.sql`

- [x] Keep API credentials and full phone numbers server-side.
- [x] Send the admission-form AlimTalk with the approved template and no SMS fallback.
- [x] Reserve an idempotency key before provider submission and retain masked operational history.
- [x] Restrict message-history writes to the server role while authenticated operators receive RLS-filtered read access.
- [x] Index the sender relation and keep authenticated identity evaluation out of the per-row RLS path.
- [x] Offer a separate MakeEdu-ready copy action using the academy's existing message.
- [x] Move the application to the admission-form-sent stage only after SOLAPI accepts the message.

### Task 5: Verify

- [x] Apply and inspect the registration Supabase migrations.
- [x] Run focused tests, full lint, and production build.
- [x] Verify `/admin/registration` at desktop and mobile widths without console errors or horizontal overflow.
- [x] Exercise waitlist, waitlist removal, admission-message readiness, and final-enrollment roster effects with temporary browser fixtures and clean them up.
