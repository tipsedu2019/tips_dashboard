# Continuous Class Schedule Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the inactive, read-only foundation for continuous classes and per-session schedule snapshots without changing the current lesson-design UI, authoritative `schedule_plan` writes, or production behavior.

**Architecture:** Introduce normalized default-slot and lesson-session tables behind a global runtime marker and a per-class storage mode that both remain inactive. A pure legacy-preview model, cached runtime probe, shadow reader, and read-only audit script establish deterministic migration evidence while the existing JSON remains authoritative.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Node test runner, Supabase/Postgres migrations, pgTAP, ESLint, Webpack build.

## Global Constraints

- Implement only release 1, `기반과 어두운 전환`, from `docs/superpowers/specs/2026-07-28-continuous-classes-session-snapshots-design.md`.
- Do not change the current lesson-design UI or `ClassScheduleWorkspace`.
- Do not change the authoritative browser write to `classes.schedule_plan`.
- Do not apply a migration to any linked, preview, or production database. An
  already-running, unlinked disposable local Supabase test database may be used
  only for pgTAP verification after confirming its isolation.
- Do not set any class above `schedule_storage_mode = 'legacy'`.
- `continuous_class_schedule_runtime_version()` must return `0`; normalized reads cannot become authoritative.
- Do not backfill, infer, or display historical teacher, classroom, start-time, or end-time values.
- Do not modify or delete `class_terms`, `classes.term_id`, `classes.period`, explicit class groups, or existing `schedule_plan` data.
- Defer `class_textbook_assignments`, `progress_logs` foreign keys, historical
  views, term-filter removal, and end/reopen UI to release 3.
- Do not enable Google Chat, Web Push, SOLAPI, notification workers, or any notification capability.
- No production push, Vercel deployment, Supabase migration application, or provider action is included.
- Execute inline one task at a time by default; do not use subagents unless the user explicitly reauthorizes them.
- Every database mutation added in a later release must use revision checks and idempotency. This release creates only the inactive schema and read-only inspection boundary.

---

## File Map

- `src/features/academic/continuous-class-schedule-model.ts` — pure normalization and comparison of legacy plan data against shadow rows.
- `src/features/academic/continuous-class-schedule-runtime-probe.ts` — cached global runtime detection with `legacy`, `shadow`, and `ready` states.
- `src/features/academic/continuous-class-schedule-service.ts` — exact-class, read-only shadow loader; never changes the authoritative legacy result.
- `scripts/preview-continuous-class-schedule-backfill.mjs` — explicit read-only JSON/live preview entry point that emits IDs, counts, and issue codes only.
- `supabase/migrations/20260728130000_continuous_class_schedule_foundation.sql` — additive columns, normalized shadow tables, RLS, audit triggers, and runtime marker.
- `supabase/tests/continuous_class_schedule_foundation_test.sql` — pgTAP contract for the inactive schema.
- `tests/continuous-class-schedule-model.node.ts` — pure migration-preview and comparison tests.
- `tests/continuous-class-schedule-schema.test.mjs` — migration lexical, ACL, and safety assertions.
- `tests/continuous-class-schedule-runtime-probe.test.mjs` — missing/shadow/ready/error/cache runtime behavior.
- `tests/continuous-class-schedule-service.test.mjs` — exact-ID shadow reads and legacy-authority assertions.
- `tests/continuous-class-schedule-backfill-preview.test.mjs` — audit report redaction and no-write source contract.
- `docs/operations/continuous-class-schedule-foundation-runbook.md` — dry-run commands, evidence format, and explicit stop gates.

## Locked Interfaces

```ts
export type ContinuousScheduleRuntimeState =
  | { mode: "legacy"; version: 0 }
  | { mode: "shadow"; version: 0 }
  | { mode: "ready"; version: 1 };

export type ContinuousScheduleStorageMode = "legacy" | "shadow" | "normalized";

export type ContinuousScheduleSlotSeed = {
  classId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacherCatalogId: null;
  teacherName: string;
  classroomCatalogId: null;
  classroomName: string;
  sortOrder: number;
};

export type ContinuousLessonSessionSeed = {
  classId: string;
  sessionKey: string;
  sessionDate: string;
  scheduleState: "active" | "exception" | "makeup" | "tbd" | "skipped";
  startTime: null;
  endTime: null;
  teacherCatalogId: null;
  teacherNameSnapshot: "";
  classroomCatalogId: null;
  classroomNameSnapshot: "";
  origin: "legacy";
  legacyBillingId: string;
  legacyBillingLabel: string;
  legacyBillingColor: string;
};

export type ContinuousScheduleLegacyInput = {
  classId: string;
  scheduleText: string;
  defaultSlots: Array<{
    day: string;
    startTime: string;
    endTime: string;
    teacher: string;
    classroom: string;
  }>;
  schedulePlan: unknown;
};

export type ContinuousScheduleBackfillIssueCode =
  | "missing_class_id"
  | "unparseable_default_schedule"
  | "missing_session_key"
  | "duplicate_session_key"
  | "missing_session_date"
  | "invalid_session_state";

export type ContinuousScheduleBackfillPreview = {
  classId: string;
  eligible: boolean;
  slots: ContinuousScheduleSlotSeed[];
  sessions: ContinuousLessonSessionSeed[];
  issues: Array<{
    code: ContinuousScheduleBackfillIssueCode;
    sessionKey: string;
  }>;
  counts: {
    slots: number;
    sessions: number;
    issues: number;
  };
};

export type ContinuousScheduleShadowRows = {
  slots: unknown[];
  sessions: unknown[];
};

export type ContinuousScheduleShadowComparison = {
  matches: boolean;
  issueCodes: Array<
    | "slot_count_mismatch"
    | "session_count_mismatch"
    | "missing_shadow_session"
    | "unexpected_shadow_session"
    | "session_date_mismatch"
    | "session_state_mismatch"
  >;
};

export function buildContinuousScheduleBackfillPreview(
  input: ContinuousScheduleLegacyInput,
): ContinuousScheduleBackfillPreview;

export function compareContinuousScheduleShadow(
  preview: ContinuousScheduleBackfillPreview,
  shadow: ContinuousScheduleShadowRows,
): ContinuousScheduleShadowComparison;

export type ContinuousScheduleRuntimeProbeResult = {
  data: unknown;
  error: unknown;
};

export type ContinuousScheduleRuntimeProbeClient = {
  rpc: (name: string) => PromiseLike<ContinuousScheduleRuntimeProbeResult>;
  from: (table: string) => {
    select: (
      columns: string,
      options: { head: true; count: "exact" },
    ) => {
      limit: (count: number) => PromiseLike<ContinuousScheduleRuntimeProbeResult>;
    };
  };
};

export type ContinuousScheduleRuntimeProbe = {
  probe: () => Promise<ContinuousScheduleRuntimeState>;
  reset: () => void;
  invalidateAfterReadyFailure: (cause: unknown) => never;
};

export function createContinuousScheduleRuntimeProbe(
  client: ContinuousScheduleRuntimeProbeClient | null,
): ContinuousScheduleRuntimeProbe;

export type ContinuousScheduleShadowReader = {
  readClassMode: (classId: string) => Promise<unknown>;
  readSlots: (classId: string) => Promise<unknown>;
  readSessions: (classId: string) => Promise<unknown>;
};

export type LoadContinuousScheduleShadowEvidenceInput = {
  reader: ContinuousScheduleShadowReader;
  runtimeState: ContinuousScheduleRuntimeState;
  legacyInput: ContinuousScheduleLegacyInput;
};

export async function loadContinuousScheduleShadowEvidence(
  input: LoadContinuousScheduleShadowEvidenceInput,
): Promise<ContinuousScheduleShadowEvidence>;
```

---

### Task 1: Lock the legacy-to-shadow preview model

**Files:**
- Create: `src/features/academic/continuous-class-schedule-model.ts`
- Create: `tests/continuous-class-schedule-model.node.ts`

**Interfaces:**
- Consumes: already-parsed default slots with `{ day, startTime, endTime, teacher, classroom }`, a class ID, raw schedule text, and the existing `schedule_plan`.
- Produces: `buildContinuousScheduleBackfillPreview()` and `compareContinuousScheduleShadow()` using the locked interfaces above.

- [ ] **Step 1: Write the failing preview tests**

Create `tests/continuous-class-schedule-model.node.ts` with these cases:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContinuousScheduleBackfillPreview,
  compareContinuousScheduleShadow,
} from "../src/features/academic/continuous-class-schedule-model.ts";

const CLASS_ID = "10000000-0000-4000-8000-000000000001";

test("legacy sessions retain keys, states, and billing metadata without invented resources", () => {
  const preview = buildContinuousScheduleBackfillPreview({
    classId: CLASS_ID,
    scheduleText: "화 14:00-15:30",
    defaultSlots: [{
      day: "화",
      startTime: "14:00",
      endTime: "15:30",
      teacher: "양소윤",
      classroom: "별관 7강",
    }],
    schedulePlan: {
      sessions: [{
        id: "session:001:2026-04-03",
        date: "2026-04-03",
        scheduleState: "active",
        billingId: "period-april",
        billingLabel: "4월",
        billingColor: "#3182f6",
      }],
    },
  });

  assert.equal(preview.eligible, true);
  assert.deepEqual(preview.counts, { slots: 1, sessions: 1, issues: 0 });
  assert.deepEqual(preview.sessions[0], {
    classId: CLASS_ID,
    sessionKey: "session:001:2026-04-03",
    sessionDate: "2026-04-03",
    scheduleState: "active",
    startTime: null,
    endTime: null,
    teacherCatalogId: null,
    teacherNameSnapshot: "",
    classroomCatalogId: null,
    classroomNameSnapshot: "",
    origin: "legacy",
    legacyBillingId: "period-april",
    legacyBillingLabel: "4월",
    legacyBillingColor: "#3182f6",
  });
});

test("invalid and duplicate legacy sessions become deterministic review issues", () => {
  const preview = buildContinuousScheduleBackfillPreview({
    classId: CLASS_ID,
    scheduleText: "화 14:00-15:30",
    defaultSlots: [{
      day: "화",
      startTime: "14:00",
      endTime: "15:30",
      teacher: "",
      classroom: "",
    }],
    schedulePlan: {
      sessions: [
        { id: "same", date: "2026-04-03", state: "active" },
        { id: "same", date: "2026-04-10", state: "active" },
        { id: "", date: "", state: "unknown" },
      ],
    },
  });

  assert.equal(preview.eligible, false);
  assert.deepEqual(
    preview.issues.map((issue) => issue.code),
    [
      "duplicate_session_key",
      "missing_session_key",
      "missing_session_date",
      "invalid_session_state",
    ],
  );
});

test("shadow comparison reports exact key, date, state, and slot count mismatches", () => {
  const preview = buildContinuousScheduleBackfillPreview({
    classId: CLASS_ID,
    scheduleText: "화 14:00-15:30",
    defaultSlots: [{
      day: "화",
      startTime: "14:00",
      endTime: "15:30",
      teacher: "",
      classroom: "",
    }],
    schedulePlan: {
      sessions: [{
        id: "session-1",
        date: "2026-04-03",
        state: "active",
      }],
    },
  });
  const comparison = compareContinuousScheduleShadow(preview, {
    slots: [],
    sessions: [{
      session_key: "session-1",
      session_date: "2026-04-10",
      schedule_state: "makeup",
    }],
  });

  assert.equal(comparison.matches, false);
  assert.deepEqual(comparison.issueCodes, [
    "slot_count_mismatch",
    "session_date_mismatch",
    "session_state_mismatch",
  ]);
});
```

- [ ] **Step 2: Run the preview tests and confirm the missing module failure**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test --experimental-strip-types tests/continuous-class-schedule-model.node.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `continuous-class-schedule-model.ts`.

- [ ] **Step 3: Implement strict normalization types and helpers**

Create `src/features/academic/continuous-class-schedule-model.ts`. Use these exact state and day registries:

```ts
const DAY_INDEX = new Map([
  ["일", 0], ["월", 1], ["화", 2], ["수", 3],
  ["목", 4], ["금", 5], ["토", 6],
]);

const SCHEDULE_STATES = new Set([
  "active", "exception", "makeup", "tbd", "skipped",
]);
```

Normalize each default slot only when the day is registered, both times match
`/^(?:[01]\d|2[0-3]):[0-5]\d$/`, and `startTime < endTime`. A nonblank
`scheduleText` with zero valid slots emits one
`unparseable_default_schedule` issue.

Normalize legacy session fields with these aliases:

```ts
const sessionKey = text(session.id || session.sessionId || session.session_id);
const sessionDate = text(session.date || session.dateValue || session.date_value);
const scheduleState = text(
  session.scheduleState || session.schedule_state || session.state,
) || "active";
```

Never copy teacher, classroom, start time, or end time from the class default
into a legacy session. Return the exact null/empty resource fields asserted by
the test. Sort issues by session input order and then by this fixed code order:

```ts
const ISSUE_ORDER = [
  "missing_class_id",
  "unparseable_default_schedule",
  "missing_session_key",
  "duplicate_session_key",
  "missing_session_date",
  "invalid_session_state",
] as const;
```

`eligible` is true only when `issues.length === 0`.

- [ ] **Step 4: Implement deterministic shadow comparison**

Add:

```ts
export type ContinuousScheduleShadowIssueCode =
  | "slot_count_mismatch"
  | "session_count_mismatch"
  | "missing_shadow_session"
  | "unexpected_shadow_session"
  | "session_date_mismatch"
  | "session_state_mismatch";
```

`compareContinuousScheduleShadow()` must compare:

- total default slot count;
- total session count;
- session membership by `session_key`;
- exact ISO date;
- exact schedule state.

Return unique issue codes in the order shown above. Do not compare resource
snapshots for legacy sessions because those values are intentionally unknown.

- [ ] **Step 5: Run the focused model test**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test --experimental-strip-types tests/continuous-class-schedule-model.node.ts
```

Expected: all three tests PASS.

- [ ] **Step 6: Run lint and commit Task 1**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" node_modules/eslint/bin/eslint.js src/features/academic/continuous-class-schedule-model.ts tests/continuous-class-schedule-model.node.ts
git diff --check
git add src/features/academic/continuous-class-schedule-model.ts tests/continuous-class-schedule-model.node.ts
git commit -m "feat: model continuous schedule shadow previews"
```

Expected: lint and diff checks pass; one focused commit is created.

---

### Task 2: Add the inactive normalized schema

**Files:**
- Create: `supabase/migrations/20260728130000_continuous_class_schedule_foundation.sql`
- Create: `supabase/tests/continuous_class_schedule_foundation_test.sql`
- Create: `tests/continuous-class-schedule-schema.test.mjs`

**Interfaces:**
- Consumes: existing `public.classes`, `public.profiles`, `public.teacher_catalogs`, `public.classroom_catalogs`, `public.set_updated_at()`, and `public.log_dashboard_audit_event()`.
- Produces: additive class columns, `public.class_schedule_slots`, `public.class_lesson_sessions`, `dashboard_private.class_schedule_mutation_receipts`, and `public.continuous_class_schedule_runtime_version()`.

- [ ] **Step 1: Write the failing migration contract test**

Create `tests/continuous-class-schedule-schema.test.mjs`. Read the migration and
pgTAP file with `readFile`. Normalize SQL by removing line comments and
collapsing whitespace. Assert all of the following:

```js
assert.match(migration, /^begin;\s*/i);
assert.match(migration.trim(), /commit;$/i);
assert.match(migration, /set local lock_timeout = '5s';/i);
assert.match(migration, /set local statement_timeout = '120s';/i);

for (const column of [
  "schedule_revision bigint not null default 0",
  "schedule_storage_mode text not null default 'legacy'",
  "closed_at timestamptz",
  "closed_by uuid",
]) {
  assert.match(normalized, new RegExp(`add column if not exists ${column}`));
}

for (const table of [
  "public.class_schedule_slots",
  "public.class_lesson_sessions",
  "dashboard_private.class_schedule_mutation_receipts",
]) {
  assert.match(normalized, new RegExp(`create table if not exists ${table}`));
}

assert.match(normalized, /check \(schedule_storage_mode in \('legacy', 'shadow', 'normalized'\)\)/);
assert.match(normalized, /check \(schedule_state in \('active', 'exception', 'makeup', 'tbd', 'skipped'\)\)/);
assert.match(normalized, /unique \(class_id, session_key\)/);
assert.match(normalized, /where source_schedule_slot_id is not null/);
assert.match(normalized, /returns integer[\s\S]*select 0/);
assert.doesNotMatch(normalized, /update public\.classes set schedule_storage_mode/);
assert.doesNotMatch(normalized, /update public\.classes set schedule_plan/);
assert.doesNotMatch(normalized, /insert into public\.class_schedule_slots/);
assert.doesNotMatch(normalized, /insert into public\.class_lesson_sessions/);
assert.doesNotMatch(normalized, /schedule_overrides/);
assert.doesNotMatch(normalized, /google_chat|web_push|solapi/i);
assert.doesNotMatch(normalized, /drop (?:table|column)/);
```

Also assert:

- RLS is enabled for both public shadow tables;
- authenticated receives SELECT only;
- authenticated/anon/public are revoked from mutation receipts;
- no INSERT/UPDATE/DELETE policy exists for the shadow tables;
- both shadow tables use the existing audit trigger;
- the pgTAP file names all tables, columns, checks, indexes, RLS states, and the
  runtime function returning zero.

- [ ] **Step 2: Run the schema test and confirm missing-file failure**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test tests/continuous-class-schedule-schema.test.mjs
```

Expected: FAIL because the migration and pgTAP files do not exist.

- [ ] **Step 3: Create the forward-only migration header and class columns**

Start `supabase/migrations/20260728130000_continuous_class_schedule_foundation.sql`
with:

```sql
begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.classes
  add column if not exists schedule_revision bigint not null default 0,
  add column if not exists schedule_storage_mode text not null default 'legacy',
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid;
```

Add these idempotent constraints:

```sql
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'classes_schedule_revision_nonnegative'
      and conrelid = 'public.classes'::regclass
  ) then
    alter table public.classes
      add constraint classes_schedule_revision_nonnegative
      check (schedule_revision >= 0);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'classes_schedule_storage_mode_check'
      and conrelid = 'public.classes'::regclass
  ) then
    alter table public.classes
      add constraint classes_schedule_storage_mode_check
      check (schedule_storage_mode in ('legacy', 'shadow', 'normalized'));
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'classes_closed_by_fkey'
      and conrelid = 'public.classes'::regclass
  ) then
    alter table public.classes
      add constraint classes_closed_by_fkey
      foreign key (closed_by)
      references public.profiles(id)
      on delete set null;
  end if;
end
$$;
```

Do not update any existing class row.

- [ ] **Step 4: Add the current-default slot table**

Use this exact core shape:

```sql
create table if not exists public.class_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  teacher_catalog_id uuid references public.teacher_catalogs(id) on delete set null,
  teacher_name text not null default '',
  classroom_catalog_id uuid references public.classroom_catalogs(id) on delete set null,
  classroom_name text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_schedule_slots_time_order_check check (start_time < end_time),
  constraint class_schedule_slots_sort_order_nonnegative check (sort_order >= 0),
  constraint class_schedule_slots_class_time_key
    unique (class_id, weekday, start_time, end_time)
);

create index if not exists class_schedule_slots_class_sort_idx
  on public.class_schedule_slots (class_id, weekday, start_time, sort_order);
```

Add an idempotent `set_updated_at_class_schedule_slots` trigger using
`public.set_updated_at()`.

- [ ] **Step 5: Add the lesson-session snapshot table**

Use this exact core shape:

```sql
create table if not exists public.class_lesson_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  session_key text not null,
  source_schedule_slot_id uuid
    references public.class_schedule_slots(id) on delete set null,
  session_date date not null,
  schedule_state text not null,
  start_time time,
  end_time time,
  teacher_catalog_id uuid references public.teacher_catalogs(id) on delete set null,
  teacher_name_snapshot text not null default '',
  classroom_catalog_id uuid references public.classroom_catalogs(id) on delete set null,
  classroom_name_snapshot text not null default '',
  origin text not null,
  makeup_of_session_id uuid
    references public.class_lesson_sessions(id) on delete restrict,
  legacy_billing_id text not null default '',
  legacy_billing_label text not null default '',
  legacy_billing_color text not null default '',
  memo text not null default '',
  public_note text not null default '',
  teacher_note text not null default '',
  revision bigint not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_lesson_sessions_class_key unique (class_id, session_key),
  constraint class_lesson_sessions_state_check
    check (schedule_state in ('active', 'exception', 'makeup', 'tbd', 'skipped')),
  constraint class_lesson_sessions_origin_check
    check (origin in ('default', 'manual', 'legacy')),
  constraint class_lesson_sessions_revision_nonnegative check (revision >= 0),
  constraint class_lesson_sessions_time_pair_check
    check (
      (start_time is null and end_time is null)
      or (start_time is not null and end_time is not null and start_time < end_time)
    )
);
```

Add:

```sql
create unique index if not exists class_lesson_sessions_default_source_key
  on public.class_lesson_sessions (class_id, session_date, source_schedule_slot_id)
  where source_schedule_slot_id is not null;

create index if not exists class_lesson_sessions_class_date_idx
  on public.class_lesson_sessions (class_id, session_date, start_time, id);

create index if not exists class_lesson_sessions_class_state_date_idx
  on public.class_lesson_sessions (class_id, schedule_state, session_date);
```

Add an idempotent `set_updated_at_class_lesson_sessions` trigger.

- [ ] **Step 6: Add the private receipt table and inactive marker**

Create:

```sql
create table if not exists dashboard_private.class_schedule_mutation_receipts (
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  operation text not null,
  request_key uuid not null,
  request_hash text not null,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_profile_id, operation, request_key),
  constraint class_schedule_mutation_receipts_operation_nonblank
    check (btrim(operation) <> ''),
  constraint class_schedule_mutation_receipts_hash_nonblank
    check (btrim(request_hash) <> '')
);

create or replace function public.continuous_class_schedule_runtime_version()
returns integer
language sql
stable
set search_path = ''
as $$
  select 0;
$$;
```

Apply exact ACLs:

```sql
revoke all on table dashboard_private.class_schedule_mutation_receipts
  from public, anon, authenticated;
revoke all on function public.continuous_class_schedule_runtime_version()
  from public;
grant execute on function public.continuous_class_schedule_runtime_version()
  to authenticated;
```

- [ ] **Step 7: Add read-only RLS and audit triggers**

For `class_schedule_slots` and `class_lesson_sessions`:

```sql
alter table public.class_schedule_slots enable row level security;
alter table public.class_lesson_sessions enable row level security;

create policy class_schedule_slots_authenticated_select
  on public.class_schedule_slots
  for select
  to authenticated
  using (true);

create policy class_lesson_sessions_authenticated_select
  on public.class_lesson_sessions
  for select
  to authenticated
  using (true);

revoke all
  on public.class_schedule_slots, public.class_lesson_sessions
  from public, anon, authenticated;
grant select on public.class_schedule_slots, public.class_lesson_sessions
  to authenticated;
```

Do not create a write policy. Add idempotent
`dashboard_audit_class_schedule_slots` and
`dashboard_audit_class_lesson_sessions` triggers that execute
`public.log_dashboard_audit_event()`.

End the migration with `commit;`.

- [ ] **Step 8: Create the pgTAP schema contract**

Create `supabase/tests/continuous_class_schedule_foundation_test.sql` with a
transactional pgTAP test containing these 33 assertions:

```sql
begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

select has_column('public', 'classes', 'schedule_revision');
select has_column('public', 'classes', 'schedule_storage_mode');
select has_column('public', 'classes', 'closed_at');
select has_column('public', 'classes', 'closed_by');

select has_table('public', 'class_schedule_slots');
select has_table('public', 'class_lesson_sessions');
select has_table('dashboard_private', 'class_schedule_mutation_receipts');

select is(
  public.continuous_class_schedule_runtime_version(),
  0,
  'foundation runtime remains inactive'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.continuous_class_schedule_runtime_version()',
    'EXECUTE'
  ),
  'authenticated can read the runtime marker'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.class_schedule_slots'::regclass),
  'class schedule slots enable RLS'
);
select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.class_lesson_sessions'::regclass),
  'class lesson sessions enable RLS'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'dashboard_private.class_schedule_mutation_receipts',
    'SELECT'
  )
  and not has_table_privilege(
    'authenticated',
    'dashboard_private.class_schedule_mutation_receipts',
    'INSERT'
  ),
  'authenticated cannot read or write mutation receipts'
);

select ok(
  has_table_privilege('authenticated', 'public.class_schedule_slots', 'SELECT')
  and not has_table_privilege('anon', 'public.class_schedule_slots', 'SELECT'),
  'only authenticated can select schedule slots'
);
select ok(
  has_table_privilege('authenticated', 'public.class_lesson_sessions', 'SELECT')
  and not has_table_privilege('anon', 'public.class_lesson_sessions', 'SELECT'),
  'only authenticated can select lesson sessions'
);
select ok(
  not has_table_privilege('authenticated', 'public.class_schedule_slots', 'INSERT')
  and not has_table_privilege('authenticated', 'public.class_schedule_slots', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.class_schedule_slots', 'DELETE'),
  'authenticated cannot mutate schedule slots'
);
select ok(
  not has_table_privilege('authenticated', 'public.class_lesson_sessions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.class_lesson_sessions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.class_lesson_sessions', 'DELETE'),
  'authenticated cannot mutate lesson sessions'
);

select is(
  (select count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename = 'class_schedule_slots'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'schedule slots have no write policy'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'public'
     and tablename = 'class_lesson_sessions'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0,
  'lesson sessions have no write policy'
);

select ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conname = 'classes_schedule_storage_mode_check'),
  'class storage mode is constrained'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conname = 'classes_schedule_revision_nonnegative'),
  'class schedule revision is nonnegative'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conname = 'class_schedule_slots_weekday_check'),
  'slot weekday is constrained'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conname = 'class_schedule_slots_time_order_check'),
  'slot time order is constrained'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conname = 'class_lesson_sessions_state_check'),
  'lesson state is constrained'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conname = 'class_lesson_sessions_origin_check'),
  'lesson origin is constrained'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
          where conname = 'class_lesson_sessions_time_pair_check'),
  'lesson time pair is constrained'
);

select ok(
  to_regclass('public.class_lesson_sessions_class_key') is not null,
  'class and session key are unique'
);
select ok(
  to_regclass('public.class_lesson_sessions_default_source_key') is not null,
  'default-source duplicate index exists'
);
select ok(
  to_regclass('public.class_lesson_sessions_class_date_idx') is not null,
  'class date index exists'
);
select ok(
  to_regclass('public.class_lesson_sessions_class_state_date_idx') is not null,
  'class state date index exists'
);

select ok(
  exists (select 1 from pg_catalog.pg_trigger
          where tgname = 'dashboard_audit_class_schedule_slots'
            and not tgisinternal),
  'slot audit trigger exists'
);
select ok(
  exists (select 1 from pg_catalog.pg_trigger
          where tgname = 'dashboard_audit_class_lesson_sessions'
            and not tgisinternal),
  'lesson audit trigger exists'
);
select ok(
  exists (select 1 from pg_catalog.pg_trigger
          where tgname = 'set_updated_at_class_schedule_slots'
            and not tgisinternal),
  'slot updated-at trigger exists'
);
select ok(
  exists (select 1 from pg_catalog.pg_trigger
          where tgname = 'set_updated_at_class_lesson_sessions'
            and not tgisinternal),
  'lesson updated-at trigger exists'
);

select * from finish();
rollback;
```

The total assertion count must remain exactly 33.

- [ ] **Step 9: Run schema contracts**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test tests/continuous-class-schedule-schema.test.mjs
```

Expected: PASS.

If an unlinked disposable local Supabase database is already running, first
confirm `supabase status` reports only localhost URLs, then run:

```bash
/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase test db supabase/tests/continuous_class_schedule_foundation_test.sql
```

Expected: 33 pgTAP assertions PASS. If no isolated database is running, record
the pgTAP runtime check as pending; do not start, reset, link, or modify a
linked/remote database as part of this task.

- [ ] **Step 10: Commit Task 2**

Run:

```bash
git diff --check
git add supabase/migrations/20260728130000_continuous_class_schedule_foundation.sql supabase/tests/continuous_class_schedule_foundation_test.sql tests/continuous-class-schedule-schema.test.mjs
git commit -m "feat: add continuous schedule shadow schema"
```

Expected: one additive schema commit; no operational database is changed.

---

### Task 3: Add a fail-closed runtime probe

**Files:**
- Create: `src/features/academic/continuous-class-schedule-runtime-probe.ts`
- Create: `tests/continuous-class-schedule-runtime-probe.test.mjs`

**Interfaces:**
- Consumes: `public.continuous_class_schedule_runtime_version()` and a zero-row fallback probe of `public.class_lesson_sessions`.
- Produces: cached `ContinuousScheduleRuntimeState`, `probeContinuousScheduleRuntime()`, `resetContinuousScheduleRuntimeProbe()`, and `invalidateContinuousScheduleRuntimeAfterReadyFailure()`.

- [ ] **Step 1: Write the runtime-probe harness and failing tests**

Use the same factory-marker and `typescript.transpileModule()` harness as
`tests/registration-runtime-probe.test.mjs`. The client records RPC names and
zero-row table probes.

Cover these exact results:

```js
[
  {
    name: "version 1 is ready",
    readiness: { data: 1, error: null },
    expected: { mode: "ready", version: 1 },
    tableReads: 0,
  },
  {
    name: "version 0 is shadow",
    readiness: { data: 0, error: null },
    expected: { mode: "shadow", version: 0 },
    tableReads: 0,
  },
  {
    name: "unknown version fails closed to shadow",
    readiness: { data: 9, error: null },
    expected: { mode: "shadow", version: 0 },
    tableReads: 0,
  },
]
```

Also test:

- missing RPC plus missing table returns `{ mode: "legacy", version: 0 }`;
- missing RPC plus existing table returns `{ mode: "shadow", version: 0 }`;
- unrelated RPC/table errors propagate;
- concurrent calls share one request;
- resolved state remains cached until reset;
- reset during an in-flight request cannot repopulate stale cache;
- `invalidateAfterReadyFailure()` resets and throws
  `ContinuousScheduleRuntimeIntegrityError`.

- [ ] **Step 2: Run the probe test and confirm missing-module failure**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test tests/continuous-class-schedule-runtime-probe.test.mjs
```

Expected: FAIL because the runtime probe module does not exist.

- [ ] **Step 3: Implement the probe factory**

Create `src/features/academic/continuous-class-schedule-runtime-probe.ts`
with factory markers:

```ts
// continuous-class-schedule-runtime-probe-factory:start
export type ContinuousScheduleRuntimeState =
  | { mode: "legacy"; version: 0 }
  | { mode: "shadow"; version: 0 }
  | { mode: "ready"; version: 1 };

const CONTINUOUS_SCHEDULE_RUNTIME_RPC =
  "continuous_class_schedule_runtime_version";
const CONTINUOUS_SCHEDULE_SESSION_TABLE = "class_lesson_sessions";
```

Use narrow missing-object detection:

- RPC missing: `PGRST202` or `42883`, or exact schema-cache text naming
  `continuous_class_schedule_runtime_version`;
- table missing: `PGRST205` or `42P01`;
- every unrelated error propagates.

When the RPC is missing, probe:

```ts
client
  .from(CONTINUOUS_SCHEDULE_SESSION_TABLE)
  .select("id", { head: true, count: "exact" })
  .limit(0);
```

Follow the generation-token cache/reset pattern in
`registration-runtime-probe.ts`. End the factory marker before binding the
default Supabase client.

- [ ] **Step 4: Run probe tests and lint**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test tests/continuous-class-schedule-runtime-probe.test.mjs
"$TASK_NODE" node_modules/eslint/bin/eslint.js src/features/academic/continuous-class-schedule-runtime-probe.ts tests/continuous-class-schedule-runtime-probe.test.mjs
```

Expected: all runtime tests pass and lint exits zero.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git diff --check
git add src/features/academic/continuous-class-schedule-runtime-probe.ts tests/continuous-class-schedule-runtime-probe.test.mjs
git commit -m "feat: probe continuous schedule shadow runtime"
```

---

### Task 4: Add the exact-class shadow evidence reader

**Files:**
- Create: `src/features/academic/continuous-class-schedule-service.ts`
- Create: `tests/continuous-class-schedule-service.test.mjs`

**Interfaces:**
- Consumes: `ContinuousScheduleRuntimeState`, a class row with `schedule_storage_mode`, the Task 1 preview model, and exact-class Supabase reads.
- Produces: `loadContinuousScheduleShadowEvidence()`; its `authoritativeSource` is locked to `"legacy"` in release 1.

- [ ] **Step 1: Write failing service tests**

Build a fake reader with these methods:

```ts
export type ContinuousScheduleShadowReader = {
  readClassMode: (classId: string) => Promise<unknown>;
  readSlots: (classId: string) => Promise<unknown>;
  readSessions: (classId: string) => Promise<unknown>;
};
```

Test:

1. `legacy` runtime performs zero reader calls and returns:

```js
{
  authoritativeSource: "legacy",
  runtimeMode: "legacy",
  storageMode: "legacy",
  shadow: null,
}
```

2. `shadow` runtime reads class mode first. A `legacy` class performs no child
   reads.
3. A `shadow` class reads only that class's slots and sessions, compares them,
   and still returns `authoritativeSource: "legacy"`.
4. A class row claiming `normalized` while global runtime is `shadow` remains
   legacy-authoritative and emits `mode_not_ready`.
5. A ready runtime and normalized class also remains legacy-authoritative in
   this release and emits `normalized_cutover_not_enabled`.
6. A shadow read error is returned as an evidence error code and never replaces
   the legacy plan.

The central test must exercise the read order and authority boundary:

```ts
test("shadow mode compares exact-class rows but keeps legacy authoritative", async () => {
  const calls = [];
  const reader = {
    async readClassMode(classId) {
      calls.push(`class:${classId}`);
      return { id: classId, schedule_storage_mode: "shadow" };
    },
    async readSlots(classId) {
      calls.push(`slots:${classId}`);
      return [{
        class_id: classId,
        weekday: 2,
        start_time: "14:00:00",
        end_time: "15:30:00",
      }];
    },
    async readSessions(classId) {
      calls.push(`sessions:${classId}`);
      return [{
        class_id: classId,
        session_key: "session-1",
        session_date: "2026-04-03",
        schedule_state: "active",
      }];
    },
  };

  const evidence = await loadContinuousScheduleShadowEvidence({
    reader,
    runtimeState: { mode: "shadow", version: 0 },
    legacyInput: {
      classId: "10000000-0000-4000-8000-000000000001",
      scheduleText: "화 14:00-15:30",
      defaultSlots: [{
        day: "화",
        startTime: "14:00",
        endTime: "15:30",
        teacher: "",
        classroom: "",
      }],
      schedulePlan: {
        sessions: [{
          id: "session-1",
          date: "2026-04-03",
          state: "active",
        }],
      },
    },
  });

  assert.equal(evidence.authoritativeSource, "legacy");
  assert.equal(evidence.shadow?.comparison.matches, true);
  assert.deepEqual(calls, [
    "class:10000000-0000-4000-8000-000000000001",
    "slots:10000000-0000-4000-8000-000000000001",
    "sessions:10000000-0000-4000-8000-000000000001",
  ]);
});
```

- [ ] **Step 2: Run the service test and confirm missing-module failure**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test --experimental-strip-types tests/continuous-class-schedule-service.test.mjs
```

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement the release-1 service boundary**

Create:

```ts
export type ContinuousScheduleShadowEvidence = {
  authoritativeSource: "legacy";
  runtimeMode: "legacy" | "shadow" | "ready";
  storageMode: "legacy" | "shadow" | "normalized";
  shadow: null | {
    comparison: ContinuousScheduleShadowComparison;
    slots: unknown[];
    sessions: unknown[];
  };
  evidenceIssueCodes: string[];
};
```

`loadContinuousScheduleShadowEvidence()` must:

- reject a blank class ID before any read;
- return immediately for global `legacy`;
- read class mode before child rows;
- accept only `legacy`, `shadow`, `normalized`; unknown values become `legacy`
  plus `invalid_storage_mode`;
- read slots and sessions only for class mode `shadow` or `normalized`;
- pass exact rows to `compareContinuousScheduleShadow()`;
- catch shadow-only read errors and return `shadow_read_failed`;
- never throw away, replace, mutate, or persist the supplied legacy plan;
- return `authoritativeSource: "legacy"` on every branch.

Add a Supabase adapter whose queries are exact:

```ts
supabase
  .from("classes")
  .select("id,schedule_storage_mode")
  .eq("id", classId)
  .limit(1);

supabase
  .from("class_schedule_slots")
  .select("id,class_id,weekday,start_time,end_time,teacher_catalog_id,teacher_name,classroom_catalog_id,classroom_name,sort_order")
  .eq("class_id", classId)
  .order("weekday")
  .order("start_time")
  .order("sort_order");

supabase
  .from("class_lesson_sessions")
  .select("id,class_id,session_key,session_date,schedule_state,source_schedule_slot_id,origin")
  .eq("class_id", classId)
  .order("session_date")
  .order("start_time")
  .order("id");
```

Do not import this service into `useAcademicWorkspaceData` or
`ClassScheduleWorkspace` in release 1.

- [ ] **Step 4: Run service tests, model tests, and lint**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test --experimental-strip-types tests/continuous-class-schedule-model.node.ts tests/continuous-class-schedule-service.test.mjs
"$TASK_NODE" node_modules/eslint/bin/eslint.js src/features/academic/continuous-class-schedule-model.ts src/features/academic/continuous-class-schedule-service.ts tests/continuous-class-schedule-model.node.ts tests/continuous-class-schedule-service.test.mjs
```

Expected: all focused tests and lint pass.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git diff --check
git add src/features/academic/continuous-class-schedule-service.ts tests/continuous-class-schedule-service.test.mjs
git commit -m "feat: read continuous schedule shadow evidence"
```

---

### Task 5: Add a read-only preview command and operator runbook

**Files:**
- Create: `scripts/preview-continuous-class-schedule-backfill.mjs`
- Create: `tests/continuous-class-schedule-backfill-preview.test.mjs`
- Create: `tests/fixtures/continuous-class-schedule-preview.json`
- Create: `docs/operations/continuous-class-schedule-foundation-runbook.md`

**Interfaces:**
- Consumes: exported class rows or an explicitly authorized read-only live Supabase query, `parseClassScheduleSlots()`, Task 1 preview model, and optional shadow rows.
- Produces: redacted JSON evidence with class IDs, eligibility, counts, and issue codes; it performs no write.

- [ ] **Step 1: Write failing command-contract tests**

Create `tests/continuous-class-schedule-backfill-preview.test.mjs`.
Import these functions from the script:

```js
import {
  buildContinuousSchedulePreviewReport,
  parseContinuousSchedulePreviewArgs,
} from "../scripts/preview-continuous-class-schedule-backfill.mjs";
```

Test:

- default arguments reject execution without `--input` or `--live`;
- `--live` requires exactly one of `--class-id <uuid>` or `--all`;
- `--all` also requires `--confirm-all-read`;
- `--input fixtures.json` is accepted without credentials;
- report rows contain only `classId`, `eligible`, `counts`, `issueCodes`,
  `shadowMatches`, and `shadowIssueCodes`;
- class name, teacher name, classroom name, textbook details, student data,
  contacts, raw `schedule_plan`, and environment values are absent;
- the script source contains no `.insert(`, `.update(`, `.delete(`, `.upsert(`,
  or mutation RPC call.

Use a report assertion that serializes the entire result:

```js
test("preview report exposes only redacted identifiers, counts, and issue codes", () => {
  const report = buildContinuousSchedulePreviewReport([{
    id: "10000000-0000-4000-8000-000000000001",
    name: "비공개 수업명",
    schedule: "화 14:00-15:30",
    teacher: "비공개 선생님",
    room: "비공개 강의실",
    schedule_plan: {
      sessions: [{
        id: "session-1",
        date: "2026-04-03",
        state: "active",
      }],
    },
    shadow_slots: [],
    shadow_sessions: [],
  }]);
  const serialized = JSON.stringify(report);

  assert.match(serialized, /10000000-0000-4000-8000-000000000001/);
  assert.doesNotMatch(serialized, /비공개 수업명|비공개 선생님|비공개 강의실/);
  assert.doesNotMatch(serialized, /schedule_plan|teacher|room|contact|student/i);
});

test("live all-class preview requires explicit confirmation", () => {
  assert.throws(
    () => parseContinuousSchedulePreviewArgs(["--live", "--all"]),
    /--confirm-all-read/,
  );
  assert.deepEqual(
    parseContinuousSchedulePreviewArgs([
      "--live", "--all", "--confirm-all-read",
    ]),
    { mode: "live", classId: "", all: true },
  );
});
```

- [ ] **Step 2: Run the command tests and confirm missing-file failure**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test tests/continuous-class-schedule-backfill-preview.test.mjs
```

Expected: FAIL because the preview script does not exist.

- [ ] **Step 3: Implement explicit argument and redaction boundaries**

`parseContinuousSchedulePreviewArgs(argv)` returns one of:

```ts
{ mode: "file"; inputPath: string }
{ mode: "live"; classId: string; all: false }
{ mode: "live"; classId: ""; all: true }
```

Reject every other combination with a concise usage error. Do not accept an
output path; write the JSON report to stdout so the caller controls any
evidence file.

`buildContinuousSchedulePreviewReport(rows)` must sort by class ID and return:

```js
{
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  totals: {
    classes: rows.length,
    eligible: 0,
    blocked: 0,
    shadowMatches: 0,
  },
  classes: [],
}
```

Populate only the redacted fields asserted by the test.

- [ ] **Step 4: Implement file and explicit live reads**

File mode reads a JSON array whose rows may contain:

```js
{
  id,
  schedule,
  teacher,
  room,
  schedule_plan,
  shadow_slots,
  shadow_sessions,
}
```

Live mode requires `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. Parse `.env.local` with `readFile`; do not print
the values. Use `@supabase/supabase-js` and only these reads:

```js
client
  .from("classes")
  .select("id,schedule,teacher,room,schedule_plan,schedule_storage_mode");

client
  .from("class_schedule_slots")
  .select("class_id,weekday,start_time,end_time")
  .in("class_id", classIds);

client
  .from("class_lesson_sessions")
  .select("class_id,session_key,session_date,schedule_state")
  .in("class_id", classIds);
```

For `--class-id`, add `.eq("id", classId).limit(1)` to the class query. For
`--all`, do not query until `--confirm-all-read` is present.

Import:

```js
import { parseClassScheduleSlots } from "../src/features/management/class-schedule-slots.ts";
import {
  buildContinuousScheduleBackfillPreview,
  compareContinuousScheduleShadow,
} from "../src/features/academic/continuous-class-schedule-model.ts";
```

The command must not stage shadow data, update storage mode, call a mutation
RPC, or write a file.

- [ ] **Step 5: Write the operator runbook**

Create `docs/operations/continuous-class-schedule-foundation-runbook.md` with:

- scope: read-only foundation evidence;
- required commit and migration filename;
- file-mode command;
- single-class live command;
- all-class live command with explicit confirmation;
- redacted report schema;
- interpretation of every issue code;
- stop conditions;
- statement that release 1 never applies the migration to a linked/remote
  database or flips runtime/mode;
- separate approval requirements for database migration, production read, and
  any later backfill write.

Use these exact commands:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --experimental-strip-types scripts/preview-continuous-class-schedule-backfill.mjs --input /absolute/path/classes-export.json

"$TASK_NODE" --experimental-strip-types scripts/preview-continuous-class-schedule-backfill.mjs --live --class-id 10000000-0000-4000-8000-000000000001

"$TASK_NODE" --experimental-strip-types scripts/preview-continuous-class-schedule-backfill.mjs --live --all --confirm-all-read
```

- [ ] **Step 6: Add the synthetic fixture and run a local smoke test**

Create `tests/fixtures/continuous-class-schedule-preview.json`:

```json
[
  {
    "id": "10000000-0000-4000-8000-000000000001",
    "schedule": "화 14:00-15:30",
    "teacher": "테스트 선생님",
    "room": "테스트 강의실",
    "schedule_plan": {
      "sessions": [
        {
          "id": "session:001:2026-04-03",
          "date": "2026-04-03",
          "scheduleState": "active"
        }
      ]
    },
    "shadow_slots": [],
    "shadow_sessions": []
  }
]
```

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test --experimental-strip-types tests/continuous-class-schedule-backfill-preview.test.mjs
"$TASK_NODE" --experimental-strip-types scripts/preview-continuous-class-schedule-backfill.mjs --input tests/fixtures/continuous-class-schedule-preview.json
```

Expected: tests pass and stdout contains one eligible synthetic class with no
raw plan or names.

- [ ] **Step 7: Lint and commit Task 5**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" node_modules/eslint/bin/eslint.js scripts/preview-continuous-class-schedule-backfill.mjs tests/continuous-class-schedule-backfill-preview.test.mjs
git diff --check
git add scripts/preview-continuous-class-schedule-backfill.mjs tests/continuous-class-schedule-backfill-preview.test.mjs tests/fixtures/continuous-class-schedule-preview.json docs/operations/continuous-class-schedule-foundation-runbook.md
git commit -m "chore: add continuous schedule shadow preview"
```

---

### Task 6: Run the release-1 verification gate

**Files:**
- Modify: `docs/superpowers/plans/2026-07-28-continuous-class-schedule-foundation.md` only to record actual command results and check completed boxes.

**Interfaces:**
- Consumes: all Task 1–5 artifacts.
- Produces: evidence that the foundation is inactive, additive, read-only, and safe to hand to a high-reasoning database review before any migration application.

- [x] **Step 1: Run all focused Node tests**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test --experimental-strip-types \
  tests/continuous-class-schedule-model.node.ts \
  tests/continuous-class-schedule-schema.test.mjs \
  tests/continuous-class-schedule-runtime-probe.test.mjs \
  tests/continuous-class-schedule-service.test.mjs \
  tests/continuous-class-schedule-backfill-preview.test.mjs
```

Expected: all focused tests pass.

- [x] **Step 2: Run related legacy regressions**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test --experimental-strip-types \
  tests/class-schedule-planner-calendar-toggle.test.mjs \
  tests/class-schedule-planner-textbook-ranges.test.mjs \
  tests/lesson-design-page.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/notification-makeup-adapter.test.mjs \
  tests/dashboard-metrics.test.mjs
```

Expected: existing lesson design, registration, makeup, and dashboard results
remain unchanged.

- [x] **Step 3: Run full static and build verification**

Run:

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --test --experimental-strip-types tests/*.test.mjs
"$TASK_NODE" node_modules/eslint/bin/eslint.js src tests scripts middleware.ts next.config.ts
"$TASK_NODE" node_modules/typescript/bin/tsc --noEmit
"$TASK_NODE" node_modules/next/dist/bin/next build --webpack
git diff --check
```

Expected: all commands exit zero. Record any pre-existing warning separately;
do not convert a warning into a pass claim for a failed command.

- [x] **Step 4: Inspect the release boundary**

Run:

```bash
git status --short
git diff --stat origin/main..HEAD
git diff origin/main..HEAD -- \
  src/features/academic/continuous-class-schedule-model.ts \
  src/features/academic/continuous-class-schedule-runtime-probe.ts \
  src/features/academic/continuous-class-schedule-service.ts \
  scripts/preview-continuous-class-schedule-backfill.mjs \
  supabase/migrations/20260728130000_continuous_class_schedule_foundation.sql \
  supabase/tests/continuous_class_schedule_foundation_test.sql \
  tests/continuous-class-schedule-model.node.ts \
  tests/continuous-class-schedule-schema.test.mjs \
  tests/continuous-class-schedule-runtime-probe.test.mjs \
  tests/continuous-class-schedule-service.test.mjs \
  tests/continuous-class-schedule-backfill-preview.test.mjs \
  tests/fixtures/continuous-class-schedule-preview.json \
  docs/operations/continuous-class-schedule-foundation-runbook.md
```

Confirm:

- no UI file changed;
- no current `schedule_plan` writer changed;
- the runtime function returns zero;
- no row is inserted into a shadow table;
- no storage mode is changed;
- no notification file or capability changed;
- the only live-capable command is read-only and requires explicit flags.

- [x] **Step 5: Record results and commit the verification note**

Update this plan with the exact test counts, command exits, pgTAP runtime status,
and any pending database-backed check. Then run:

```bash
git add docs/superpowers/plans/2026-07-28-continuous-class-schedule-foundation.md
git commit -m "docs: record continuous schedule foundation verification"
```

- [x] **Step 6: Stop for database safety review**

Do not push, deploy, apply the migration, run the live preview, or start release
2. Hand off:

- commit hashes for Tasks 1–6;
- automated verification results;
- pgTAP runtime status;
- statement that no database was modified;
- request for a highest-model/high-reasoning review of migration, RLS, ACL,
  runtime marker, and rollback boundary.

Expected: release 1 is code-complete but operationally inactive.

---

## Verification record — 2026-07-28

- Focused foundation Node tests: 25 passed, 0 failed.
- Related legacy regression tests: 114 passed, 0 failed.
- Full Node test command: 1,906 passed, 0 failed.
- ESLint: 0 errors; one existing warning remains in
  `scripts/generate-target-ui-blueprints.mjs` for unused `contentH`.
- `tsc --noEmit`: passed after commit `d4183d09` corrected two new type-contract
  mismatches.
- `next build --webpack`: passed.
- `git diff --check`: passed before the verification-note commit.
- pgTAP runtime verification: pending. `supabase status` could not connect to
  Docker, so no local database was started, reset, linked, migrated, or changed.
- 2026-07-29 operator decision: proceed with source integration without Docker.
  This does not waive the database gate: the migration remains unapplied until
  an isolated PostgreSQL/Supabase environment can run the 33 pgTAP assertions.

Release 1 remains operationally inactive: no migration application, live
preview, runtime/storage-mode change, push, deployment, or provider action was
performed. Before any database action, request a highest-model/high-reasoning
review of migration, RLS, ACL, runtime marker, and rollback boundaries.
