# Science Subject Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add science as a third typed, high-school-only subject across registration, organization, classrooms, classes, textbooks, academic exams, and notification connection settings without enabling external sends or leaking science into English-only workflows.

**Architecture:** A fixed TypeScript subject registry owns stable identities and explicit capabilities. `academic_subject_settings` and `academic_subject_areas` store safe operational configuration, while additive PostgreSQL migrations enforce the same grade, director, track-count, and taxonomy invariants. Existing English and math flows remain compatible when the new capability RPC is absent.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Node test runner, Supabase/PostgreSQL migrations, shadcn/Radix UI.

## Global Constraints

- Root subjects are exactly `english | math | science`, displayed as `영어 | 수학 | 과학`, in that order.
- Science is available only for `고1 | 고2 | 고3`.
- Science subject areas are exactly `integrated_science | physics | chemistry | life_science | earth_science` with labels `통합과학 | 물리학 | 화학 | 생명과학 | 지구과학`.
- Unknown root subjects fail closed and must never fall back to English, math, or `other` on authoritative writes.
- Registration keeps one parent application with independent subject tracks; level tests remain optional per track.
- Existing English and math behavior and runtime marker value `1` remain compatible.
- Only the existing `별관 4강` receives initial science classroom membership; do not create a duplicate classroom.
- Do not add science to English word retests, English weekly tests, or a science-specific monthly approval template.
- Do not modify public homepage or landing files.
- Google Chat, Web Push, and SOLAPI runtime flags remain false; provider calls must remain zero.
- Preserve the existing dirty word-retest changes in `src/features/tasks/ops-task-model.js`, `src/features/tasks/ops-task-service.ts`, `tests/notification-ops-task-producers.test.mjs`, and `tests/ops-task-model.test.mjs`.
- Add only forward migrations; never edit historical migrations.
- Do not add new `select("*")` calls or per-row subject-setting queries.

---

### Task 1: Typed academic subject registry

**Files:**
- Create: `src/lib/academic-subject-registry.ts`
- Test: `tests/academic-subject-registry.test.mjs`
- Modify: `src/features/tasks/registration-track-service.ts`
- Modify: `src/features/tasks/registration-track-model.d.ts`
- Modify: `src/features/tasks/registration-workflow.js`
- Modify: `src/features/tasks/registration-track-history.js`
- Modify: `src/features/tasks/registration-appointment-calendar-model.ts` (type-exhaustive ordering only)
- Modify: `src/features/tasks/ops-task-workspace.tsx` (type-exhaustive subject rendering only; do not touch word-retest changes)

**Interfaces:**
- Produces: `AcademicSubjectKey`, `AcademicSubjectValue`, `ACADEMIC_SUBJECTS`, `ACADEMIC_SUBJECT_VALUES`, `parseAcademicSubject`, `parseAcademicSubjectKey`, `sortAcademicSubjects`, `serializeAcademicSubjects`, `isScienceGrade`, `subjectSupports`.
- Consumers: every later task imports these values instead of declaring an English/math array.

- [ ] **Step 1: Write failing registry tests**

```js
import {
  ACADEMIC_SUBJECT_VALUES,
  parseAcademicSubject,
  parseAcademicSubjectKey,
  sortAcademicSubjects,
  isScienceGrade,
  subjectSupports,
} from "../src/lib/academic-subject-registry.ts"

test("the root registry keeps three stable subjects", () => {
  assert.deepEqual(ACADEMIC_SUBJECT_VALUES, ["영어", "수학", "과학"])
  assert.equal(parseAcademicSubject("science"), "과학")
  assert.equal(parseAcademicSubjectKey("과학"), "science")
  assert.equal(parseAcademicSubject("unknown"), null)
})

test("science stays high-school-only and out of English-only workflows", () => {
  assert.equal(isScienceGrade("고1"), true)
  assert.equal(isScienceGrade("중3"), false)
  assert.equal(subjectSupports("과학", "registration"), true)
  assert.equal(subjectSupports("과학", "word_retest"), false)
  assert.equal(subjectSupports("수학", "word_retest"), false)
  assert.equal(subjectSupports("영어", "word_retest"), true)
  assert.deepEqual(sortAcademicSubjects(["과학", "영어", "수학"]), ["영어", "수학", "과학"])
})
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/academic-subject-registry.test.mjs
```

Expected: FAIL because `academic-subject-registry.ts` does not exist.

- [ ] **Step 3: Implement the fixed registry**

```ts
export const ACADEMIC_SUBJECTS = [
  { key: "english", value: "영어", team: "영어팀", sortOrder: 10, grades: ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"], capabilities: ["registration", "level_test", "classes", "textbooks", "academic_exam", "subject_chat", "word_retest", "monthly_approval"] },
  { key: "math", value: "수학", team: "수학팀", sortOrder: 20, grades: ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"], capabilities: ["registration", "level_test", "classes", "textbooks", "academic_exam", "subject_chat", "monthly_approval"] },
  { key: "science", value: "과학", team: "과학팀", sortOrder: 30, grades: ["고1", "고2", "고3"], capabilities: ["registration", "level_test", "classes", "textbooks", "academic_exam", "subject_chat"] },
] as const

export type AcademicSubjectKey = typeof ACADEMIC_SUBJECTS[number]["key"]
export type AcademicSubjectValue = typeof ACADEMIC_SUBJECTS[number]["value"]
export type AcademicSubjectCapability = typeof ACADEMIC_SUBJECTS[number]["capabilities"][number]
```

Implement the exported parsers using an explicit alias map for English, math, and science. `parseAcademicSubject` returns `null` for every unsupported value. `sortAcademicSubjects` removes duplicates and unsupported values. `serializeAcademicSubjects` joins the sorted values with `", "`.

- [ ] **Step 4: Replace registration fallbacks**

Change `RegistrationSubject` to `AcademicSubjectValue`. Replace `registration-track-service.ts`'s `수학 ? 수학 : 영어` mapper with `parseAcademicSubject`; a supported track row with no parsed subject throws `registration_subject_unsupported`. Replace subject parsing, serialization, ordering, and history filtering with registry functions. Repair every TypeScript exhaustiveness error caused directly by the widened subject type with an explicit science branch; do not introduce an English/math fallback.

- [ ] **Step 5: Run focused tests**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/academic-subject-registry.test.mjs tests/registration-workflow.test.mjs tests/registration-track-history.test.mjs tests/registration-track-service.test.mjs
```

Expected: PASS with no unknown-to-English assertion.

- [ ] **Step 6: Record the task boundary**

Review `git diff --check` and confirm the four pre-existing dirty word-retest files still contain their original diff hunks.

---

### Task 2: Subject settings, areas, and capability probe

**Files:**
- Create: `supabase/migrations/20260722090000_academic_subject_foundation.sql`
- Create: `src/features/management/academic-subject-settings-service.ts`
- Create: `src/features/tasks/registration-subject-capability-probe.ts`
- Test: `tests/academic-subject-settings.test.mjs`
- Test: `tests/registration-subject-capability-probe.test.mjs`
- Test: `supabase/tests/academic_subject_foundation_test.sql`

**Interfaces:**
- Produces DB tables `academic_subject_settings`, `academic_subject_areas`.
- Produces RPCs `list_registration_subject_capabilities_v1()` and `update_academic_subject_setting_v1(text, boolean, boolean, text[], uuid)`.
- Produces `RegistrationSubjectCapability` and a cached probe with `probe()` and `reset()`.
- Produces `createAcademicSubjectSettingsService(client)` with defensive `list()` and `update()` RPC parsing.

- [ ] **Step 1: Write failing static and probe tests**

The static test must assert that the migration:

```js
assert.match(sql, /create table public\.academic_subject_settings/i)
assert.match(sql, /subject in \('영어', '수학', '과학'\)/i)
assert.match(sql, /array\['고1', '고2', '고3'\]/i)
assert.match(sql, /create table public\.academic_subject_areas/i)
assert.match(sql, /integrated_science[\s\S]*physics[\s\S]*chemistry[\s\S]*life_science[\s\S]*earth_science/i)
assert.match(sql, /list_registration_subject_capabilities_v1/i)
```

The probe test must cover:

- missing RPC returns built-in English/math create capabilities and science disabled;
- valid RPC returns science enabled only for high-school grades;
- malformed subject, grade array, or duplicate row closes science without blocking English/math;
- cached probes issue one RPC call until reset.

- [ ] **Step 2: Verify RED**

Run the two new Node tests. Expected: missing files and missing exports.

- [ ] **Step 3: Add the forward schema**

Create both tables with explicit checks and RLS. Revoke direct table access from browser roles; authenticated reads and admin writes go only through the two explicit RPCs. Seed:

```sql
insert into public.academic_subject_settings(
  subject, is_active, registration_create_enabled, grade_levels, sort_order
) values
  ('영어', true, true, array['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'], 10),
  ('수학', true, true, array['초1','초2','초3','초4','초5','초6','중1','중2','중3','고1','고2','고3'], 20),
  ('과학', true, true, array['고1','고2','고3'], 30)
on conflict (subject) do update set
  is_active = excluded.is_active,
  registration_create_enabled = excluded.registration_create_enabled,
  grade_levels = excluded.grade_levels,
  sort_order = excluded.sort_order;
```

Seed the five stable science areas at sort orders 10, 20, 30, 40, 50. Add a private stable helper that validates a non-null director through `teacher_catalogs.profile_id = profiles.id = auth.users.id`, `teacher_catalogs.is_visible = true`, exact `과학팀` membership, `auth.users.deleted_at is null`, and no active ban. Do not require the science director's global profile role to be `admin`; subject-scoped authority is added later. Authenticated users read only through the safe RPC; only `admin` may call the update RPC. The update RPC rejects science grades outside `고1`–`고3` and rejects a default director without that active science-team account link.

- [ ] **Step 4: Implement the capability probe**

Use the same cached/in-flight/generation pattern as `registration-runtime-probe.ts`. A missing PostgREST function (`PGRST202` or `42883` identifying the capability function) returns the compatibility fallback. Other errors surface to callers, which render science disabled while preserving English/math. The settings service maps snake_case explicitly, accepts exactly three unique subjects, validates every field, and rejects malformed payloads as `academic_subject_settings_unsafe_response`; a successful update resets the capability cache.

- [ ] **Step 5: Add pgTAP-style SQL assertions**

Assert fixed rows, RLS/grants, science grades, stable area keys, invalid director rejection, and non-admin update rejection. Do not call external providers.

- [ ] **Step 6: Run focused tests**

Run the two Node tests plus existing registration runtime-probe tests. Expected: PASS.

---

### Task 3: Subject, team, and classroom settings UI

**Files:**
- Create: `src/features/management/subject-master-workspace.tsx`
- Create: `src/app/admin/settings/subjects/page.tsx`
- Modify: `src/lib/navigation.ts`
- Modify: `src/features/management/teacher-master-workspace.tsx`
- Modify: `src/app/(auth)/sign-up/components/signup-form-1.tsx`
- Modify: `src/features/academic/records.js`
- Modify: `src/features/management/classroom-master-workspace.tsx`
- Modify: `src/features/management/management-service.js`
- Create: `supabase/migrations/20260722093000_science_team_and_classroom.sql`
- Test: `tests/subject-settings-workspace.test.mjs`
- Test: `tests/teacher-account-linking.test.mjs`
- Test: `tests/classroom-subject-membership.test.mjs`
- Test: `tests/auth-login.test.mjs`
- Test: `tests/timetable-layout.test.mjs`

**Interfaces:**
- Consumes subject settings service and registry.
- Produces a fixed-row `/admin/settings/subjects` workspace and authoritative `subjects[]` classroom editing.

- [ ] **Step 1: Write failing UI contract tests**

Assert that:

- settings navigation includes `과목 설정`;
- the subject workspace renders exactly three fixed subjects and permits active/create/director changes without editing stable keys;
- team options and aliases include `과학팀`, `science`, and `과학`;
- a classroom row can serialize `['영어', '과학']` without dropping either value;
- an empty classroom subject selection is rejected;
- the migration updates, rather than inserts, `별관 4강` by appending distinct `과학`.

- [ ] **Step 2: Verify RED**

Run the three new or modified tests. Expected: missing route, missing science team, and single-subject classroom failures.

- [ ] **Step 3: Implement the fixed subject settings workspace**

Use one compact row per root subject with status, permitted grade summary, and default director select. Resolve authorization from `useAuth().isAdmin`; only `admin` sees save actions, and the handler guards non-admin calls. Load settings and teacher candidates once per workspace. Science director candidates are visible, profile-linked teacher catalogs whose `subjects[]` contains `과학팀`; the update RPC remains authoritative for live account eligibility. English/math preserve their existing default rules unless an explicit setting exists.

- [ ] **Step 4: Add science team normalization**

Add `과학팀` to teacher and signup options and aliases, including both timetable academic-team and known-team sets. Recreate the complete latest auth signup handler in the new organization forward migration with an explicit `when '과학팀' then '과학팀'` branch so unrecognized values still follow the current default but science never becomes English. Do not amend the already-reviewed foundation migration or replace the handler with a partial copy.

- [ ] **Step 5: Convert classroom subject editing to a multi-select**

Keep the row value as `AcademicSubjectValue[]`, render three checkbox/toggle buttons, preserve canonical order through `sortAcademicSubjects`, and call `upsertClassroomCatalogs` with the full array. Reject empty and unsupported classroom memberships in the workspace and in the classroom-only service payload path without applying the academic allowlist to teacher team arrays. Add `별4`, `별4강`, and `별관4강` aliases in both management and academic normalization. The new migration adds a `NOT VALID` classroom membership check so new/direct writes are non-empty and limited to the three root subjects without failing on unreviewed legacy rows. Add this idempotent data update:

```sql
update public.classroom_catalogs
set subjects = (
  select pg_catalog.array_agg(value order by sort_order)
  from (
    select distinct member.value,
      case member.value when '영어' then 10 when '수학' then 20 when '과학' then 30 else 99 end as sort_order
    from pg_catalog.unnest(coalesce(subjects, array[]::text[]) || array['과학']) member(value)
  ) ordered
)
where pg_catalog.btrim(name) = '별관 4강';
```

- [ ] **Step 6: Run focused tests**

Run subject settings, teacher account, classroom membership, timetable teacher filter, and school settings tests. Expected: PASS.

---

### Task 4: Registration client support and high-school gate

**Files:**
- Modify: `src/features/tasks/registration-subject-picker.tsx`
- Modify: `src/features/tasks/registration-application-create.tsx`
- Modify: `src/features/tasks/registration-intake-workflow.ts`
- Modify: `src/features/tasks/registration-initial-plan-control.tsx`
- Modify: `src/features/tasks/registration-application-track-actions.tsx`
- Modify: `src/features/tasks/registration-appointment-calendar-model.ts`
- Modify: `src/features/tasks/registration-track-fixtures.ts`
- Modify: `src/features/tasks/registration-track-fixture-runtime.ts`
- Modify: `src/features/tasks/registration-director-default.js`
- Modify: `src/features/tasks/registration-track-model.js`
- Modify: `src/features/tasks/registration-track-editor.tsx`
- Modify: `src/features/tasks/registration-application-subject-tabs.tsx`
- Modify: `src/features/tasks/ops-task-workspace.tsx`
- Modify: `src/features/tasks/registration-subject-capability-probe.ts`
- Modify: `src/features/notifications/server/adapters/registration-notification-adapter.ts`
- Test: `tests/registration-science-subject.test.mjs`
- Test: `tests/registration-intake-workflow.test.mjs`
- Test: `tests/registration-appointment-calendar.test.mjs`
- Test: `tests/registration-director-default.test.mjs`
- Test: `tests/registration-notification-adapter.test.mjs`
- Test: `tests/registration-subject-capability-probe.test.mjs`
- Test: `tests/registration-track-fixtures.test.mjs`
- Test: `tests/registration-track-model.test.mjs`
- Test: `tests/registration-track-workspace.test.mjs`
- Test: `tests/ops-task-workspace.test.mjs`

**Interfaces:**
- Consumes capability probe, registry, and subject settings.
- Produces science-capable picker, initial workflow, history, calendar, fixtures, and adapter parsing.

- [ ] **Step 1: Write failing science registration tests**

Cover:

```js
assert.deepEqual(parseRegistrationSubjects("과학, 영어, 수학"), ["영어", "수학", "과학"])
assert.deepEqual(createRegistrationInitialWorkflowDraft(["과학"]), {
  subjectPlans: { 과학: "inquiry" },
  levelTestScheduledAt: "",
  levelTestPlace: "",
  visitScheduledAt: "",
  visitPlace: "",
  directorOverrides: {},
})
```

Also assert science-only, English+science, math+science, and all-three participants; high-school visibility; middle-school rejection; optional level test; three-track calendar ordering; science director with `teacher` viewer role can complete only their assigned consultation; unknown adapter subjects remain rejected; the cached capability RPC is shared rather than duplicated; capability errors do not block existing detail loading; and DB-free fixtures provide explicit science capability/profile/class/textbook data without a non-English-to-math fallback.

- [ ] **Step 2: Verify RED**

Run the five focused tests. Expected: fixed two-subject arrays and role checks fail.

- [ ] **Step 3: Feed capability options into pickers**

Extend the capability DTO/parser with `defaultDirectorProfileId` from the existing RPC so the create workspace does not issue a second settings call. Load the cached capability probe once in the registration workspace, independently from option/detail loading. `RegistrationSubjectPicker` receives `options`, `grade`, and `disabledReasonBySubject`. Existing science tracks remain visible even when create is disabled, while new fallback-mode science remains hidden. New science selection requires an enabled capability whose `gradeLevels` includes the current grade. Changing the create form grade to a non-high grade immediately removes science, reconciles its draft plan/director override, and shows the removal reason.

- [ ] **Step 4: Replace local subject arrays and two-column assumptions**

Use registry ordering in create, sync, initial plan, appointment calendar, subject tabs, fixture IDs/runtime, track actions, and notification adapter. Layouts use `grid-cols-1 sm:grid-cols-3` for three root subjects. Every fixture branch handles science explicitly; delete all `else => math` ID/profile/class/textbook fallbacks.

- [ ] **Step 5: Resolve science directors from settings**

`resolveRegistrationDirectorDefault` keeps existing English/math name rules. For science, it selects the one configured `defaultDirectorProfileId` only when the profile and science-team catalog are active. Return `unavailable` for zero, mismatched, or inactive candidates. Rule keys use `subject-director-v1:<subject>:<profileId>` for science.

- [ ] **Step 6: Extend assigned-director UI permissions**

Allow a viewer role of `teacher` to complete a consultation only when viewer ID, track director ID, and consultation director ID are identical and the consultation is actionable. Do not set `canManage=true`; every other edit remains read-only.

- [ ] **Step 7: Run focused tests**

Run all registration `*.test.mjs` files and the notification registration adapter test. Expected: PASS.

---

### Task 5: Additive registration database expansion

**Files:**
- Create: `supabase/migrations/20260722100000_registration_science_subject.sql`
- Test: `supabase/tests/registration_science_subject_test.sql`
- Modify: `tests/registration-track-schema.test.mjs`
- Modify: `tests/registration-track-service.test.mjs`
- Modify: `tests/registration-browser-verifier-contract.test.mjs`

**Interfaces:**
- Consumes `academic_subject_settings` and `academic_subject_areas`.
- Preserves public RPC signatures and existing runtime marker values.
- Produces three-subject-safe constraints, create/sync/appointment/reminder/history functions.

- [ ] **Step 1: Write failing static migration tests**

Assert the new migration replaces the subject check with three values, validates capability and grade, permits 1–3 tracks, orders `영어=10`, `수학=20`, `과학=30`, and recreates the latest definitions of these functions/views:

- `dashboard_private.is_active_subject_director`
- `dashboard_private.resolve_registration_default_director`
- `dashboard_private.derive_registration_parent_projection`
- `dashboard_private.create_registration_case_impl`
- latest `dashboard_private.sync_registration_case_subjects_impl`
- latest `dashboard_private.update_registration_case_common_impl`
- `dashboard_private.save_registration_shared_appointment_impl`
- `dashboard_private.create_registration_case_with_initial_workflow_v1_impl`
- `dashboard_private.assert_registration_mutation_access`
- `dashboard_private.assert_registration_track_director_ready`
- `dashboard_private.assign_registration_track_director_core`
- `dashboard_private.complete_registration_consultation_impl`
- the latest visit-reminder wrapper that revalidates track directors
- `public.ops_registration_appointment_calendar`
- reminder preview/snapshot helpers
- admission message track selector
- the canonical registration visit event subject serializer

- [ ] **Step 2: Verify RED**

Run registration schema/service/browser contract tests. Expected: missing migration and two-subject cardinality failures.

- [ ] **Step 3: Add shared SQL helpers**

Create private helpers:

```sql
dashboard_private.registration_subject_sort_order(text) returns integer
dashboard_private.assert_registration_subject_enabled(text, text) returns void
dashboard_private.is_active_subject_director(uuid, text) returns boolean
```

The assertion accepts only three subjects, requires active/create-enabled settings, and requires science grades to be high school. The director helper preserves the existing active-admin behavior for English/math and accepts the configured active science-team profile only for science.

- [ ] **Step 4: Replace the table constraint and current gateway functions**

Drop only `ops_registration_subject_tracks_subject_check`; add the same named constraint with `('영어','수학','과학')`. Copy the current function definitions from the latest historical migration into the forward migration, then make these exact semantic changes:

- validation allowlist contains three subjects;
- cardinality is `between 1 and 3`;
- every subject order calls `registration_subject_sort_order`;
- create and sync call `assert_registration_subject_enabled` using the parent grade;
- common grade updates reject moving a case with an existing science track outside 고1–고3 without treating capability-off legacy reads as new creates;
- appointment membership and reminder preview accept up to 3 track IDs;
- director validation passes the track subject;
- assigned science director completion uses `is_active_subject_director` and exact track ownership;
- director-readiness, director-assignment, consultation-completion, and visit-reminder wrappers receive the subject-aware helper rather than retaining an inner admin-only recheck;
- reminder director targets/snapshots and canonical visit event payloads preserve the science director and fixed 영어→수학→과학 order;
- runtime marker functions continue returning `1`.

- [ ] **Step 5: Add SQL behavioral tests**

Test science-only inquiry, science level-test, science consultation without director rejection, configured science director success, English+science, all three subjects, four/unknown rejection, 2→3 sync, three-subject shared appointment, high-school enforcement, direct table-write denial, parent projection order, and capability-off write denial with existing science read retention.

- [ ] **Step 6: Run registration tests**

Run all Node registration tests. If a local Supabase test runtime is configured, run the three registration SQL test files plus the new one; otherwise record SQL tests as not executed rather than claiming a pass.

---

### Task 6: Science classes and textbook taxonomy

**Files:**
- Create: `supabase/migrations/20260722110000_science_classes_and_textbooks.sql`
- Modify: `src/features/management/management-page.tsx`
- Modify: `src/features/management/use-management-records.ts`
- Modify: `src/features/management/management-service.js`
- Modify: `src/features/management/records.js`
- Modify: `src/features/academic/records.js`
- Modify: `src/features/academic/records.d.ts`
- Modify: `src/features/textbooks/textbook-taxonomy.ts`
- Modify: `src/features/textbooks/textbook-service.ts`
- Modify: `src/features/textbooks/textbook-operations-workspace.tsx`
- Modify: `src/features/textbooks/textbook-supplier-settings-workspace.tsx`
- Modify: `src/features/textbooks/textbook-ledger.js`
- Test: `tests/science-class-taxonomy.test.mjs`
- Test: `tests/textbook-taxonomy-arrays.test.mjs`
- Test: `tests/textbook-taxonomy-schema.test.mjs`
- Test: `tests/textbook-ledger.test.mjs`

**Interfaces:**
- Produces `classes.subject_area_key` and `textbooks.subject_area_key`.
- Consumes stable area settings and subject registry.

- [ ] **Step 1: Write failing class and textbook tests**

Assert that the first science class can be created before another science class exists, science classes require high grade and an active science area, non-science classes reject a science area, `science`/`과학` normalize to science, science textbooks contain only high/h1–h3 taxonomy, and ledger closing returns a separate `science` bucket.

- [ ] **Step 2: Verify RED**

Run the four focused tests. Expected: no science option, no area key, and `science → other` failures.

- [ ] **Step 3: Add DB columns and constraints**

Add nullable `subject_area_key` columns to classes and textbooks. Add composite references to `academic_subject_areas(subject, area_key)` through explicit subject mapping. Science rows require a key and high-school grades; non-science rows require null. Extend the textbook subject check to `english | math | science | other`. Seed the five compatibility `textbook_sub_subject_settings` rows and preserve all existing `other` rows unchanged.

- [ ] **Step 4: Add class form controls**

Merge registry subject options with legacy row values so the first science class is selectable. When subject becomes science, restrict grades to 고1–고3 and show a required area select. Filter teacher and classroom candidates through science team/membership. Serialize `subject_area_key` in create and update payloads.

- [ ] **Step 5: Add textbook controls and ledger bucket**

Add science to all subject option/alias maps. Science selection sets school levels to `["high"]`, grade levels to `["h1","h2","h3"]`, and requires one stable area. Keep `sub_subject` as the current display label. Add `science` to closing totals without changing monthly approval templates.

- [ ] **Step 6: Run focused tests**

Run all management class, academic record, and textbook tests. Expected: PASS.

---

### Task 7: Science exam date and scope

**Files:**
- Modify: `src/features/operations/academic-calendar-models.d.ts`
- Modify: `src/features/operations/academic-event-utils.js`
- Modify: `src/features/operations/academic-calendar-models.js`
- Modify: `src/features/operations/academic-annual-board-workspace.tsx`
- Modify: `src/features/operations/academic-event-editor-sheet.tsx`
- Modify: `src/app/admin/calendar/components/calendar-main.tsx`
- Modify: `src/app/admin/calendar/components/event-form.tsx`
- Modify: `src/features/dashboard/metrics.js`
- Test: `tests/academic-annual-board.test.mjs`
- Test: `tests/academic-calendar-ui.test.mjs`
- Test: `tests/academic-event-form-rules.test.mjs`
- Test: `tests/dashboard-metrics.test.mjs`

**Interfaces:**
- Produces `과학시험일` as a typed subject exam board type.
- Consumes science areas, high-school policy, class/textbook scope data.

- [ ] **Step 1: Write failing academic tests**

Assert that `과학시험일` is recognized as a subject exam, appears after math, creates only on high-school rows, includes science scope and area labels, contributes to dashboard exam conflicts, and is rejected for middle-school creation.

- [ ] **Step 2: Verify RED**

Run the four academic tests. Expected: the science type is ignored or rejected.

- [ ] **Step 3: Implement science board/model support**

Add science to typed board arrays, type-to-subject mapping, synthetic summary generation, bucket initialization, ordering, labels, classes, editor type choices, and calendar filters. Reuse the existing date/scope storage contract and attach the stable science area key to structured note metadata.

- [ ] **Step 4: Enforce high-school-only editing**

The annual board renders no science create action for rows whose grade does not match `고1`–`고3`. The editor rejects a science save without a high grade or active science area before calling the mutation service.

- [ ] **Step 5: Run focused tests**

Run all academic calendar, annual board, event form, and dashboard metrics tests. Expected: PASS.

---

### Task 8: Science Google Chat connection with provider-zero safety

**Files:**
- Create: `supabase/migrations/20260722120000_science_notification_connection.sql`
- Modify: `src/features/notifications/notification-control-plane-types.ts`
- Modify: `src/features/notifications/notification-control-plane-model.ts`
- Modify: `src/features/notifications/notification-control-panel.tsx`
- Modify: `src/features/notifications/server/notification-connection-repository.ts`
- Modify: `src/features/notifications/server/adapters/immediate-notification-adapter.ts`
- Modify: `src/features/notifications/server/adapters/registration-notification-adapter.ts`
- Test: `tests/notification-control-plane-model.test.mjs`
- Test: `tests/notification-control-plane-api.test.mjs`
- Test: `tests/notification-control-plane-ui.test.mjs`
- Test: `tests/notification-control-plane-worker.test.mjs`
- Test: `tests/registration-notification-adapter.test.mjs`
- Test: `tests/notification-science-provider-zero.test.mjs`

The forward migration also recreates the latest canonical worker recipient revalidation that currently recognizes only the legacy active registration director, so an assigned science teacher is not cancelled before delivery projection. Preserve the complete current worker function and change only the subject-aware director predicate.

**Interfaces:**
- Produces `google_chat.science` ↔ DB channel `science`.
- Does not enable any workflow rule or runtime flag.

- [ ] **Step 1: Write failing connection and zero-send tests**

Assert science connection parsing, safe DTO masking, UI label `과학팀 Google Chat`, subject resolver mapping `과학/science → google_chat.science`, and zero provider calls while every runtime flag is false. Assert the science row is disconnected with no secret.

- [ ] **Step 2: Verify RED**

Run the six focused tests. Expected: unknown connection key and missing UI card failures.

- [ ] **Step 3: Extend connection contracts**

Add `google_chat.science` to the connection key tuple, repository channel maps, UI labels, subject-team readiness lists, safe wire validation, and target resolution. Keep all mutation endpoints admin-only.

- [ ] **Step 4: Add the forward notification migration**

Replace the Google Chat channel check with `admin | executive | english | math | science`. Insert the science row with empty encrypted secret fields and `disconnected`. Update current safe settings/readiness/worker functions to recognize science. Before any data change, assert every external notification runtime flag is false; otherwise raise `science_notification_provider_zero_required`. Do not enable rules or flags.

- [ ] **Step 5: Run focused notification tests**

Run all notification Node tests. Expected: PASS and the dedicated provider-zero test reports zero fetch/provider calls.

---

### Task 9: Negative workflow guards, hygiene, and full verification

**Files:**
- Modify: `.gitignore`
- Modify: tests covering word-retest class filters only if the negative contract is absent
- Modify: tests covering approval templates only if the negative contract is absent
- Create: `docs/qa/2026-07-22-science-subject-local-verification.md`

**Interfaces:**
- Consumes every prior task.
- Produces final local verification evidence without deployment or provider activation.

- [ ] **Step 1: Add negative tests before guard changes**

Assert that science classes never appear in word-retest class options, science is not a monthly approval template subject, public files have no diff, and notification flags remain false.

- [ ] **Step 2: Verify RED only where a real gap exists**

If an existing negative test already passes, retain it and do not add production code. If science leaks through a fallback, preserve the failing output, add the smallest capability-based guard, and rerun to green.

- [ ] **Step 3: Ignore the local pnpm store**

Add exactly this dependency ignore entry without deleting any files:

```gitignore
/.pnpm-store/
```

- [ ] **Step 4: Run the complete Node suite**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/*.test.mjs
```

Expected: all tests pass, zero failures.

- [ ] **Step 5: Run lint**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/lib/node_modules/npm/bin/npm-cli.js run lint
```

Expected: exit 0 with no ESLint errors.

- [ ] **Step 6: Run production build**

Run the repository `build` script with the bundled Node/npm runtime. Expected: `next build --webpack` exits 0.

- [ ] **Step 7: Verify the exact local routes**

Start the app locally and inspect:

- `/admin/registration`
- `/admin/settings/subjects`
- `/admin/settings/teachers`
- `/admin/settings/classrooms`
- `/admin/classes`
- `/admin/timetable`
- `/admin/textbooks`
- `/admin/academic-annual`
- `/admin/settings/notifications`
- `/admin/word-retests`

Record whether data is fixture, local Supabase, or unavailable. Confirm science is absent from word retests and monthly approval templates, and do not call notification connection verification.

- [ ] **Step 8: Audit scope and existing changes**

Run `git diff --check`, `git status --short`, and a path audit proving no public homepage file changed. Compare the four pre-existing dirty word-retest file hunks with the baseline and report them separately from science changes.

- [ ] **Step 9: Write the Korean verification report**

Record test counts, lint/build status, route evidence, SQL-runtime availability, provider-zero evidence, uncommitted/commit limitation, and deployment status. Do not claim Supabase migration application or production deployment without direct evidence.
