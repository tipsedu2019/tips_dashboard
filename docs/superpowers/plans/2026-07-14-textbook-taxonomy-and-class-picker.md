# Textbook Taxonomy and Class Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make textbook subject, school level, grade, and sub-subject a complete multi-value classification contract, backfill existing books safely, and make the class-detail textbook picker open on the books that fit the class.

**Architecture:** `textbook-taxonomy.ts` owns canonical ordering, scalar fallback, multi-value transitions, summaries, and containment checks. A forward-only Supabase migration adds authoritative `school_levels[]` and `grade_levels[]`, normalizes every legacy row, and installs database constraints without changing historical migrations. The textbook workspace consumes the shared model for editing and filtering; the class workspace delegates its picker UI and filter state to focused management components while continuing to persist only the class `textbook_ids` array.

**Tech Stack:** Next.js 16.1.1, React 19.2.3, TypeScript 5.9, Supabase/PostgreSQL 17, shadcn/Radix UI, Node.js built-in test runner.

## Global Constraints

- `subject`, `school_levels`, `grade_levels`, and `sub_subject` are required for every active or inactive textbook.
- Allowed school levels are exactly `elementary`, `middle`, and `high`; allowed grades are exactly `e1`-`e6`, `m1`-`m3`, and `h1`-`h3`.
- Selecting a school level initially selects every grade in it; grades can then be unchecked.
- Selecting a grade automatically selects its school level; removing the final grade removes that school level.
- Existing rows with no inferable school or grade receive all three school levels and all twelve grades.
- `school_levels[]` and `grade_levels[]` are authoritative; scalar `school_level` and `grade_level` remain compatibility projections in canonical order.
- Existing title, publisher, ISBN, pricing, inventory, purchase, sale, and class-link data must remain unchanged.
- The class picker defaults from class subject and grade, supports subject/school/grade/sub-subject filters, and never hides already connected books from the class detail.
- Reuse the current shadcn/Radix components and existing dense modal/table design; add no explanatory cards or duplicate workflow controls.
- Preserve the current uncommitted changes in `management-page.tsx` and `use-management-records.ts`; extend the existing class-textbook draft instead of replacing unrelated edits.
- Do not apply the migration to the linked Supabase project, mutate production data, push, or deploy without separate authorization.

---

## File Structure

- `src/features/textbooks/textbook-taxonomy.ts`: canonical taxonomy types, normalization, selection transitions, labels, validation, and containment.
- `src/features/textbooks/textbook-service.ts`: validate taxonomy and persist authoritative arrays plus scalar projections.
- `src/features/textbooks/textbook-operations-workspace.tsx`: master list filters, compact summaries, required editor, and bulk edit integration.
- `src/features/management/class-textbook-picker-model.ts`: pure class-default and candidate-filtering model.
- `src/features/management/class-textbook-picker.tsx`: focused class-detail picker UI.
- `src/features/management/management-page.tsx`: class form persistence and connected-book rendering; delegates picker behavior.
- `src/features/management/use-management-records.ts`: exposes complete textbook taxonomy metadata to class details.
- `supabase/migrations/*_textbook_taxonomy_arrays.sql`: generated forward-only schema/backfill/constraint migration.
- `tests/textbook-taxonomy-arrays.test.mjs`: executable taxonomy behavior tests.
- `tests/textbook-taxonomy-schema.test.mjs`: migration source-contract and fixture coverage tests.
- `tests/textbook-workspace.test.mjs`: textbook master editor/list/service source-contract checks.
- `tests/class-textbook-picker-model.test.mjs`: executable class default/filter behavior tests.
- `tests/management-class-student-roster.test.mjs`: class-detail picker integration source contract.
- `supabase/tests/registration_subject_tracks_runtime_test.sql`: keeps its direct textbook fixture valid under the required taxonomy contract.

---

### Task 1: Canonical Multi-Value Taxonomy Model

**Files:**
- Create: `tests/textbook-taxonomy-arrays.test.mjs`
- Modify: `src/features/textbooks/textbook-taxonomy.ts`

**Interfaces:**
- Consumes: existing `TEXTBOOK_SCHOOL_LEVEL_OPTIONS`, `TEXTBOOK_GRADE_OPTIONS`, scalar normalizers, and legacy title/category inference.
- Produces: `TextbookTaxonomySelection`, `getTextbookTaxonomySelection(row)`, `toggleTextbookSchoolLevel(selection, value, checked)`, `toggleTextbookGradeLevel(selection, value, checked)`, `validateTextbookTaxonomy(record)`, `getTextbookSchoolLevelSummary(row)`, `getTextbookGradeSummary(row)`, and `matchesTextbookTaxonomy(row, filters)`.

- [ ] **Step 1: Write executable failing tests for array precedence and scalar fallback**

Create `tests/textbook-taxonomy-arrays.test.mjs` with direct imports from the TypeScript module using Node 24 type stripping:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  getTextbookGradeSummary,
  getTextbookSchoolLevelSummary,
  getTextbookTaxonomySelection,
  matchesTextbookTaxonomy,
  toggleTextbookGradeLevel,
  toggleTextbookSchoolLevel,
  validateTextbookTaxonomy,
} from "../src/features/textbooks/textbook-taxonomy.ts";

test("arrays are authoritative and canonical", () => {
  assert.deepEqual(
    getTextbookTaxonomySelection({
      school_levels: ["high", "elementary", "high"],
      grade_levels: ["h3", "e6", "h1", "h3"],
      school_level: "middle",
      grade_level: "m2",
    }),
    {
      schoolLevels: ["elementary", "high"],
      gradeLevels: ["e6", "h1", "h3"],
    },
  );
});

test("a scalar school without a grade expands to every grade in that school", () => {
  assert.deepEqual(
    getTextbookTaxonomySelection({ school_level: "high" }),
    { schoolLevels: ["high"], gradeLevels: ["h1", "h2", "h3"] },
  );
});

test("a scalar grade derives its school", () => {
  assert.deepEqual(
    getTextbookTaxonomySelection({ grade_level: "e6" }),
    { schoolLevels: ["elementary"], gradeLevels: ["e6"] },
  );
});

test("an unclassified legacy textbook becomes broad", () => {
  const result = getTextbookTaxonomySelection({ title: "공용 교재", category: "기타" });
  assert.deepEqual(result.schoolLevels, ["elementary", "middle", "high"]);
  assert.equal(result.gradeLevels.length, 12);
});
```

- [ ] **Step 2: Run the new file and verify it fails on missing exports**

Run:

```bash
CODEX_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$CODEX_NODE --experimental-strip-types --test tests/textbook-taxonomy-arrays.test.mjs
```

Expected: FAIL because `getTextbookTaxonomySelection` and the other array helpers are not exported.

- [ ] **Step 3: Add canonical taxonomy types, ordering, and normalization**

Add these public types/constants and implement normalization without mutating input arrays:

```ts
export type TextbookSchoolLevel = "elementary" | "middle" | "high";
export type TextbookGradeLevel =
  | "e1" | "e2" | "e3" | "e4" | "e5" | "e6"
  | "m1" | "m2" | "m3"
  | "h1" | "h2" | "h3";

export type TextbookTaxonomySelection = {
  schoolLevels: TextbookSchoolLevel[];
  gradeLevels: TextbookGradeLevel[];
};

export const ALL_TEXTBOOK_SCHOOL_LEVELS: TextbookSchoolLevel[] = ["elementary", "middle", "high"];
export const ALL_TEXTBOOK_GRADE_LEVELS: TextbookGradeLevel[] = [
  "e1", "e2", "e3", "e4", "e5", "e6",
  "m1", "m2", "m3",
  "h1", "h2", "h3",
];
```

`getTextbookTaxonomySelection(row)` must apply this exact precedence:

1. Non-empty valid `school_levels` and `grade_levels` arrays.
2. Explicit scalar `grade_level`, deriving its school.
3. Explicit scalar `school_level`, expanding to every grade in it.
4. Grade inferred from `category + title`, deriving its school.
5. School inferred from `category + title`, expanding to all grades in it.
6. All school levels and all grades.

Canonicalize and deduplicate according to the exported order. When arrays contain a grade but omit its school, add the grade's school; when arrays contain a school with no grade, add every grade for that school.

- [ ] **Step 4: Add selection-transition tests and implement the transitions**

Append these tests:

```js
test("checking a school adds all of its grades", () => {
  assert.deepEqual(
    toggleTextbookSchoolLevel({ schoolLevels: [], gradeLevels: [] }, "high", true),
    { schoolLevels: ["high"], gradeLevels: ["h1", "h2", "h3"] },
  );
});

test("checking a grade adds its school and removing the final grade removes the school", () => {
  const checked = toggleTextbookGradeLevel({ schoolLevels: [], gradeLevels: [] }, "e6", true);
  assert.deepEqual(checked, { schoolLevels: ["elementary"], gradeLevels: ["e6"] });
  assert.deepEqual(toggleTextbookGradeLevel(checked, "e6", false), { schoolLevels: [], gradeLevels: [] });
});

test("unchecking a school removes all grades in that school", () => {
  assert.deepEqual(
    toggleTextbookSchoolLevel(
      { schoolLevels: ["middle", "high"], gradeLevels: ["m1", "m3", "h2"] },
      "middle",
      false,
    ),
    { schoolLevels: ["high"], gradeLevels: ["h2"] },
  );
});
```

Implement the two toggle functions through one internal canonicalizer. School-on adds the complete grade set; school-off removes that set. Grade-on adds its school; grade-off removes its school only when no grade from that school remains.

- [ ] **Step 5: Add validation, summary, and containment tests**

Append:

```js
test("required taxonomy validation returns a Korean field error", () => {
  assert.deepEqual(
    validateTextbookTaxonomy({ subject: "math", schoolLevels: ["high"], gradeLevels: [], subSubject: "기하" }),
    { valid: false, field: "gradeLevels", message: "학년을 하나 이상 선택하세요." },
  );
});

test("broad summaries stay compact", () => {
  const broad = { school_levels: ["elementary", "middle", "high"], grade_levels: [
    "e1", "e2", "e3", "e4", "e5", "e6", "m1", "m2", "m3", "h1", "h2", "h3",
  ] };
  assert.equal(getTextbookSchoolLevelSummary(broad), "초·중·고");
  assert.equal(getTextbookGradeSummary(broad), "전 학년");
  assert.equal(getTextbookGradeSummary({ school_levels: ["high"], grade_levels: ["h1", "h2", "h3"] }), "고1–고3");
  assert.equal(getTextbookGradeSummary({ school_levels: ["high"], grade_levels: ["h1", "h3"] }), "고1 · 고3");
});

test("containment includes broad books and excludes unrelated grades", () => {
  const broad = { school_levels: ["elementary", "middle", "high"], grade_levels: [
    "e1", "e2", "e3", "e4", "e5", "e6", "m1", "m2", "m3", "h1", "h2", "h3",
  ], subject: "math", sub_subject: "기타" };
  assert.equal(matchesTextbookTaxonomy(broad, { subject: "math", schoolLevel: "high", gradeLevel: "h3", subSubject: "" }), true);
  assert.equal(matchesTextbookTaxonomy({ ...broad, grade_levels: ["h1"] }, { subject: "math", schoolLevel: "high", gradeLevel: "h3", subSubject: "" }), false);
});
```

Implement `validateTextbookTaxonomy` to return the first missing field in this order: subject, school levels, grade levels, sub-subject. Implement summaries from canonical arrays and `matchesTextbookTaxonomy` with array membership plus exact normalized subject/sub-subject matching when those filters are non-empty.

- [ ] **Step 6: Run the taxonomy tests and commit**

Run:

```bash
CODEX_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$CODEX_NODE --experimental-strip-types --test tests/textbook-taxonomy-arrays.test.mjs
git diff --check -- src/features/textbooks/textbook-taxonomy.ts tests/textbook-taxonomy-arrays.test.mjs
git add src/features/textbooks/textbook-taxonomy.ts tests/textbook-taxonomy-arrays.test.mjs
git commit -m "feat: add multi-value textbook taxonomy model"
```

Expected: all taxonomy tests PASS; commit contains only the taxonomy module and its new test.

---

### Task 2: Forward Schema Migration and Legacy Backfill

**Files:**
- Create via Supabase CLI: `supabase/migrations/*_textbook_taxonomy_arrays.sql` (the CLI supplies the timestamp prefix)
- Create: `tests/textbook-taxonomy-schema.test.mjs`
- Modify: `supabase/tests/registration_subject_tracks_runtime_test.sql:127-129`

**Interfaces:**
- Consumes: current scalar `textbooks.school_level`, `textbooks.grade_level`, `textbooks.sub_subject`, `textbooks.category`, and `textbooks.title`.
- Produces: authoritative `textbooks.school_levels text[]` and `textbooks.grade_levels text[]`, check constraints, normalized required scalar fields, and seeded `기타` sub-subject options.

- [ ] **Step 1: Write the failing migration source-contract test**

Create `tests/textbook-taxonomy-schema.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);

async function readMigration(suffix) {
  const names = await readdir(migrationsUrl);
  const name = names.find((candidate) => candidate.endsWith(`_${suffix}.sql`));
  assert.ok(name, `missing ${suffix} migration`);
  return readFile(new URL(name, migrationsUrl), "utf8");
}

test("textbook taxonomy migration adds, backfills, and constrains arrays", async () => {
  const sql = await readMigration("textbook_taxonomy_arrays");
  assert.match(sql, /add column if not exists school_levels text\[\]/i);
  assert.match(sql, /add column if not exists grade_levels text\[\]/i);
  assert.match(sql, /textbook_taxonomy_backfill/i);
  assert.match(sql, /array\['elementary', 'middle', 'high'\]::text\[\]/i);
  assert.match(sql, /array\['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'm1', 'm2', 'm3', 'h1', 'h2', 'h3'\]::text\[\]/i);
  assert.match(sql, /textbooks_school_levels_required/i);
  assert.match(sql, /textbooks_grade_levels_required/i);
  assert.match(sql, /textbooks_grade_school_consistency/i);
  assert.match(sql, /textbooks_school_grade_coverage/i);
  assert.match(sql, /insert into public\.textbook_sub_subject_settings/i);
  assert.match(sql, /'english', '기타'/i);
  assert.match(sql, /'math', '기타'/i);
  assert.match(sql, /notify pgrst, 'reload schema'/i);
});

test("registration runtime textbook fixture satisfies required taxonomy", async () => {
  const source = await readFile(new URL("../supabase/tests/registration_subject_tracks_runtime_test.sql", import.meta.url), "utf8");
  assert.match(source, /insert into public\.textbooks\([\s\S]*school_levels[\s\S]*grade_levels[\s\S]*sub_subject/i);
});
```

- [ ] **Step 2: Run the schema test and verify the missing-migration failure**

Run:

```bash
CODEX_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$CODEX_NODE --test tests/textbook-taxonomy-schema.test.mjs
```

Expected: FAIL with `missing textbook_taxonomy_arrays migration`.

- [ ] **Step 3: Generate the migration with the pinned Supabase CLI**

Run:

```bash
CODEX_PNPM=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
$CODEX_PNPM dlx supabase@2.109.1 migration new textbook_taxonomy_arrays
```

Expected: one new file under `supabase/migrations/` ending in `_textbook_taxonomy_arrays.sql`. Use that generated file for all remaining steps; do not rename it or edit a historical migration.

- [ ] **Step 4: Implement the additive columns and deterministic backfill**

At the start of the generated migration, set a short lock timeout and add the columns:

```sql
set local lock_timeout = '5s';

alter table public.textbooks
  add column if not exists school_levels text[] not null default '{}'::text[],
  add column if not exists grade_levels text[] not null default '{}'::text[];

-- textbook_taxonomy_backfill
```

Use one CTE-backed `UPDATE public.textbooks` that applies this exact order:

1. Normalize valid existing array values into canonical order.
2. If a valid scalar grade exists, use it and derive its school.
3. If a valid scalar school exists without a grade, select all grades in that school.
4. Infer Korean grade tokens `(초|중|고)[1-6]` from `category || ' ' || title`; derive the school.
5. Infer `초등`, `중등`, or `고등`; select every grade in the inferred school.
6. Otherwise use all school levels and all grades.

In the same update:

```sql
subject = case
  when lower(btrim(coalesce(subject, ''))) in ('english', '영어') then 'english'
  when lower(btrim(coalesce(subject, ''))) in ('math', '수학') then 'math'
  else 'other'
end,
sub_subject = coalesce(
  nullif(btrim(sub_subject), ''),
  nullif(btrim(regexp_replace(coalesce(category, ''), '^(초등|중등|고등|초\s*[1-6]|중\s*[1-3]|고\s*[1-3])\s*', '')), ''),
  '기타'
)
```

Then set scalar projections to the first array entry in canonical order, not database input order. End the backfill with a `DO` assertion that raises `textbook_taxonomy_backfill_failed` when any row has an empty required field, invalid value, uncovered grade, or school with no grade. The exception must abort the migration transaction.

- [ ] **Step 5: Add database constraints and editable fallback settings**

Add named checks idempotently through a `DO` block that first checks `pg_constraint`:

```sql
check (subject is not null and subject in ('english', 'math', 'other'));
check (cardinality(school_levels) > 0 and school_levels <@ array['elementary', 'middle', 'high']::text[]);
check (cardinality(grade_levels) > 0 and grade_levels <@ array['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'm1', 'm2', 'm3', 'h1', 'h2', 'h3']::text[]);
check (
  (not (grade_levels && array['e1', 'e2', 'e3', 'e4', 'e5', 'e6']::text[]) or school_levels @> array['elementary']::text[])
  and (not (grade_levels && array['m1', 'm2', 'm3']::text[]) or school_levels @> array['middle']::text[])
  and (not (grade_levels && array['h1', 'h2', 'h3']::text[]) or school_levels @> array['high']::text[])
);
check (
  (not (school_levels @> array['elementary']::text[]) or grade_levels && array['e1', 'e2', 'e3', 'e4', 'e5', 'e6']::text[])
  and (not (school_levels @> array['middle']::text[]) or grade_levels && array['m1', 'm2', 'm3']::text[])
  and (not (school_levels @> array['high']::text[]) or grade_levels && array['h1', 'h2', 'h3']::text[])
);
check (sub_subject is not null and btrim(sub_subject) <> '');
```

Name them `textbooks_subject_required`, `textbooks_school_levels_required`, `textbooks_grade_levels_required`, `textbooks_grade_school_consistency`, `textbooks_school_grade_coverage`, and `textbooks_sub_subject_required`. Insert `('english', '기타')`, `('math', '기타')`, and `('other', '기타')` with sort order `999` and `ON CONFLICT (subject, name) DO NOTHING`. Finish with `notify pgrst, 'reload schema';`.

- [ ] **Step 6: Update the direct SQL fixture**

Change the fixture insert to include a complete broad classification so it remains about registration behavior, not taxonomy validation:

```sql
insert into public.textbooks(
  id, title, name, subject, school_level, grade_level, school_levels, grade_levels,
  sub_subject, publisher, price, tags, lessons, status
)
values (
  '00000000-0000-4000-8000-000000000401',
  '영어 교재', '영어 교재', 'english', 'high', 'h1',
  array['high']::text[], array['h1', 'h2', 'h3']::text[],
  '기타', '테스트', 10000, '[]'::jsonb, '[]'::jsonb, 'active'
);
```

Preserve the fixture's existing ID and all values referenced later in that SQL file; only add the taxonomy columns/values.

- [ ] **Step 7: Run source-contract tests and inspect the migration**

Run:

```bash
CODEX_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$CODEX_NODE --test tests/textbook-taxonomy-schema.test.mjs tests/textbook-management-schema.test.mjs
git diff --check -- supabase/migrations tests/textbook-taxonomy-schema.test.mjs supabase/tests/registration_subject_tracks_runtime_test.sql
```

Expected: both Node test files PASS; the migration diff contains no changes to older migrations. Runtime SQL execution remains pending unless an authorized local/preview database becomes available; do not substitute the linked production project.

- [ ] **Step 8: Commit the migration contract**

Run:

```bash
git add supabase/migrations/*_textbook_taxonomy_arrays.sql tests/textbook-taxonomy-schema.test.mjs supabase/tests/registration_subject_tracks_runtime_test.sql
git commit -m "feat: add textbook taxonomy array schema"
```

Expected: one commit containing only the generated migration and its schema/fixture tests.

---

### Task 3: Required Master Editor and Persistence

**Files:**
- Modify: `src/features/textbooks/textbook-service.ts:307-345`
- Modify: `src/features/textbooks/textbook-operations-workspace.tsx:293-321, 3444-3465, 3648-3702, 4182-4268, 4458-4480, 5227-5419`
- Modify: `tests/textbook-workspace.test.mjs`

**Interfaces:**
- Consumes: Task 1 taxonomy selection, toggles, summaries, validation, and Task 2 array columns.
- Produces: validated `upsertTextbookMaster()` payloads with arrays/scalars and required checkbox-based master/bulk editors.

- [ ] **Step 1: Add failing service/editor source contracts**

Append a test to `tests/textbook-workspace.test.mjs` that reads the service/workspace and asserts:

```js
test("textbook master saves required multi-value taxonomy", async () => {
  const workspaceSource = await readFile(new URL("src/features/textbooks/textbook-operations-workspace.tsx", root), "utf8");
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");

  assert.match(serviceSource, /validateTextbookTaxonomy/);
  assert.match(serviceSource, /school_levels: taxonomy\.schoolLevels/);
  assert.match(serviceSource, /grade_levels: taxonomy\.gradeLevels/);
  assert.match(serviceSource, /school_level: taxonomy\.schoolLevels\[0\]/);
  assert.match(serviceSource, /grade_level: taxonomy\.gradeLevels\[0\]/);
  assert.match(workspaceSource, /schoolLevels: \[\]/);
  assert.match(workspaceSource, /gradeLevels: \[\]/);
  assert.match(workspaceSource, /toggleTextbookSchoolLevel/);
  assert.match(workspaceSource, /toggleTextbookGradeLevel/);
  assert.match(workspaceSource, /과목을 선택하세요/);
  assert.match(workspaceSource, /학교 구분을 하나 이상 선택하세요/);
  assert.match(workspaceSource, /학년을 하나 이상 선택하세요/);
  assert.match(workspaceSource, /세부과목을 선택하세요/);
  assert.doesNotMatch(workspaceSource, /<SelectItem value="none">미지정<\/SelectItem>[\s\S]{0,500}학교 구분/);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
CODEX_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$CODEX_NODE --test --test-name-pattern="required multi-value taxonomy" tests/textbook-workspace.test.mjs
```

Expected: FAIL because the service still writes scalar-only taxonomy and the editor still uses single-value selects.

- [ ] **Step 3: Make `upsertTextbookMaster` validate and write both forms**

Import `getTextbookTaxonomySelection`, `normalizeTextbookSubject`, and `validateTextbookTaxonomy`. Before constructing the payload:

```ts
const taxonomy = getTextbookTaxonomySelection({
  ...record,
  school_levels: record.schoolLevels || record.school_levels,
  grade_levels: record.gradeLevels || record.grade_levels,
});
const subject = normalizeTextbookSubject(record.subject);
const subSubject = text(record.subSubject || record.sub_subject);
const validation = validateTextbookTaxonomy({
  subject,
  schoolLevels: taxonomy.schoolLevels,
  gradeLevels: taxonomy.gradeLevels,
  subSubject,
});
if (!validation.valid) throw new Error(validation.message);
```

Write:

```ts
subject,
school_levels: taxonomy.schoolLevels,
grade_levels: taxonomy.gradeLevels,
school_level: taxonomy.schoolLevels[0],
grade_level: taxonomy.gradeLevels[0],
sub_subject: subSubject,
```

Build `category` from the compact taxonomy summaries plus sub-subject. Do not change inventory/purchase/sale methods.

- [ ] **Step 4: Convert master form state and edit hydration to arrays**

Replace scalar form state with:

```ts
const emptyMasterForm = {
  id: "",
  title: "",
  subject: "english",
  schoolLevels: [] as string[],
  gradeLevels: [] as string[],
  subSubject: "",
  category: "",
  publisher: "",
  isbn13: "",
  barcode: "",
  price: "",
  status: "active",
};
```

`selectMasterTextbook(row)` must hydrate both arrays from `getTextbookTaxonomySelection(row)`. `openNewMasterDialog()` remains empty so the operator makes an explicit required selection; legacy rows become broad through the Task 1 fallback.

- [ ] **Step 5: Replace school/grade selects with compact checkbox groups**

Use the existing `Checkbox`, `Field`, and grid primitives. Render three school checkboxes and only the grade checkboxes belonging to selected schools. Call the shared toggle helpers for every change. Mark 과목, 학교 구분, 학년, and 세부과목 `required` visually and expose group labels with `role="group"` plus `aria-label="학교 구분 선택"` / `aria-label="학년 선택"`.

Immediately below a missing required group, render one message only:

```tsx
<p className="text-xs text-destructive" role="alert">학교 구분을 하나 이상 선택하세요.</p>
```

Use equivalent copy for subject, grade, and sub-subject. Do not add a summary card.

- [ ] **Step 6: Block invalid submission and keep successful save behavior**

Derive one `masterTaxonomyValidation` from form state. Extend `masterSubmitDisabled` with `!masterTaxonomyValidation.valid`. In `submitMaster`, set `actionErrorMessage` to the validation message and return before calling the service. Keep duplicate detection and `showSavedMasterTextbook()` unchanged.

- [ ] **Step 7: Upgrade bulk taxonomy patching without clearing untouched fields**

Replace `schoolLevel`/`gradeLevel` patch fields with nullable arrays:

```ts
const emptyBulkTextbookPatch = {
  subject: "keep",
  schoolLevels: null as string[] | null,
  gradeLevels: null as string[] | null,
  category: "",
  publisher: "",
  price: "",
  status: "keep",
};
```

In the expanded bulk controls, a `학교·학년 변경` checkbox switches both arrays from `null` to empty arrays and shows the same school/grade checkbox groups. Applying is disabled until both arrays contain values. `getBulkTextbookPatchValues(row)` sends `schoolLevels` and `gradeLevels` only when they are non-null; otherwise it preserves the row's existing taxonomy. Subject/sub-subject changes continue to preserve untouched values.

- [ ] **Step 8: Run the focused taxonomy/editor tests and commit**

Run:

```bash
CODEX_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$CODEX_NODE --experimental-strip-types --test tests/textbook-taxonomy-arrays.test.mjs tests/textbook-workspace.test.mjs
git diff --check -- src/features/textbooks/textbook-service.ts src/features/textbooks/textbook-operations-workspace.tsx tests/textbook-workspace.test.mjs
git add src/features/textbooks/textbook-service.ts src/features/textbooks/textbook-operations-workspace.tsx tests/textbook-workspace.test.mjs
git commit -m "feat: require textbook taxonomy in master editor"
```

Expected: taxonomy and workspace tests PASS; no migration or management files are included in this commit.

---

### Task 4: Array-Aware Master List, Filters, and Summaries

**Files:**
- Modify: `src/features/textbooks/textbook-operations-workspace.tsx:2824-2903, 3008-3037, 7530-7576, 8581-8930`
- Modify: `tests/textbook-workspace.test.mjs`

**Interfaces:**
- Consumes: Task 1 `getTextbookTaxonomySelection`, compact summaries, and containment matcher.
- Produces: master list cells and filters that represent every applicable school/grade instead of only the first scalar projection.

- [ ] **Step 1: Add a failing list/filter contract**

Append:

```js
test("textbook master list and filters use taxonomy arrays", async () => {
  const workspaceSource = await readFile(new URL("src/features/textbooks/textbook-operations-workspace.tsx", root), "utf8");
  const taxonomySource = await readFile(new URL("src/features/textbooks/textbook-taxonomy.ts", root), "utf8");
  assert.match(workspaceSource, /getTextbookSchoolLevelSummary/);
  assert.match(workspaceSource, /getTextbookGradeSummary/);
  assert.match(workspaceSource, /matchesTextbookTaxonomy/);
  assert.match(taxonomySource, /초·중·고/);
  assert.match(taxonomySource, /전 학년/);
  assert.doesNotMatch(workspaceSource, /getTextbookGradeLabel\(getTextbookGradeLevel\(row\)\) \|\| getTextbookSchoolLevelLabel/);
});
```

- [ ] **Step 2: Verify the test fails against scalar display logic**

Run:

```bash
CODEX_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$CODEX_NODE --test --test-name-pattern="master list and filters use taxonomy arrays" tests/textbook-workspace.test.mjs
```

Expected: FAIL because the table and filters still call scalar getters.

- [ ] **Step 3: Replace equality filters with containment**

For both `listFilteredInventory` and `textbookQualityFilterCounts`, replace scalar school/grade equality checks with:

```ts
if (!matchesTextbookTaxonomy(row, {
  subject: subjectGroupFilter === "all" ? "" : subjectGroupFilter,
  schoolLevel: schoolLevelGroupFilter === "all" ? "" : schoolLevelGroupFilter,
  gradeLevel: gradeLevelGroupFilter === "all" ? "" : gradeLevelGroupFilter,
  subSubject: categoryGroupFilter === "all" ? "" : categoryGroupFilter,
})) return false;
```

Grade filter options remain limited by the selected school filter, but broad books match every contained grade.

- [ ] **Step 4: Render compact summaries everywhere the master taxonomy appears**

Use `getTextbookSchoolLevelSummary(row)` and `getTextbookGradeSummary(row)` in desktop rows, mobile rows, select metadata, duplicate preview identity, and search text. The school column displays `초·중·고` for all levels. The grade column displays `전 학년` for all twelve grades, the single-school range for a complete school, or explicit labels for a partial set.

Keep title, publisher, inventory, selection, and action columns unchanged.

- [ ] **Step 5: Run the workspace suite and commit**

Run:

```bash
CODEX_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$CODEX_NODE --experimental-strip-types --test tests/textbook-taxonomy-arrays.test.mjs tests/textbook-workspace.test.mjs
git diff --check -- src/features/textbooks/textbook-operations-workspace.tsx tests/textbook-workspace.test.mjs
git add src/features/textbooks/textbook-operations-workspace.tsx tests/textbook-workspace.test.mjs
git commit -m "feat: show and filter textbook taxonomy arrays"
```

Expected: all focused tests PASS and broad books remain visible under specific school/grade filters.

---

### Task 5: Class-Fit Picker Model and Focused Component

**Files:**
- Create: `src/features/management/class-textbook-picker-model.ts`
- Create: `src/features/management/class-textbook-picker.tsx`
- Create: `tests/class-textbook-picker-model.test.mjs`
- Modify: `src/features/management/use-management-records.ts:585-594`
- Modify: `src/features/management/management-page.tsx:71-81, 1225-1285, 2012-2020, 2617-2734, 2887`
- Modify: `tests/management-class-student-roster.test.mjs:100-120`

**Interfaces:**
- Consumes: Task 1 taxonomy normalization/containment; existing class `subject`, `grade`, optional `sub_subject`, existing `textbook_ids`, and the already loaded textbook catalog.
- Produces: `ClassTextbookPickerFilters`, `getDefaultClassTextbookFilters(classRecord)`, `filterClassTextbookCandidates(textbooks, filters, query)`, and a controlled `ClassTextbookPicker` component.

- [ ] **Step 1: Write failing executable model tests**

Create `tests/class-textbook-picker-model.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  filterClassTextbookCandidates,
  getDefaultClassTextbookFilters,
} from "../src/features/management/class-textbook-picker-model.ts";

const catalog = [
  { id: "broad", title: "공용 수학", subject: "math", school_levels: ["elementary", "middle", "high"], grade_levels: ["e1", "e2", "e3", "e4", "e5", "e6", "m1", "m2", "m3", "h1", "h2", "h3"], sub_subject: "기타", publisher: "A" },
  { id: "h3", title: "고3 모고", subject: "math", school_levels: ["high"], grade_levels: ["h3"], sub_subject: "모고", publisher: "B" },
  { id: "m2", title: "중2 수학", subject: "math", school_levels: ["middle"], grade_levels: ["m2"], sub_subject: "내신", publisher: "C" },
];

test("class defaults derive subject, school, and grade", () => {
  assert.deepEqual(getDefaultClassTextbookFilters({ subject: "수학", grade: "고3" }), {
    subject: "math",
    schoolLevel: "high",
    gradeLevel: "h3",
    subSubject: "",
  });
});

test("default candidates include broad and exact books only", () => {
  const filters = getDefaultClassTextbookFilters({ subject: "수학", grade: "고3" });
  assert.deepEqual(filterClassTextbookCandidates(catalog, filters, "").map((book) => book.id), ["broad", "h3"]);
});

test("sub-subject and text search narrow independently", () => {
  const filters = { subject: "math", schoolLevel: "high", gradeLevel: "h3", subSubject: "모고" };
  assert.deepEqual(filterClassTextbookCandidates(catalog, filters, "고3").map((book) => book.id), ["h3"]);
});

test("cleared taxonomy filters expose the full catalog", () => {
  const filters = { subject: "", schoolLevel: "", gradeLevel: "", subSubject: "" };
  assert.deepEqual(filterClassTextbookCandidates(catalog, filters, "").map((book) => book.id), ["broad", "h3", "m2"]);
});
```

- [ ] **Step 2: Run the model test and verify the missing-module failure**

Run:

```bash
CODEX_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$CODEX_NODE --experimental-strip-types --test tests/class-textbook-picker-model.test.mjs
```

Expected: FAIL with module-not-found for `class-textbook-picker-model.ts`.

- [ ] **Step 3: Implement the pure filter model**

Define:

```ts
export type ClassTextbookPickerFilters = {
  subject: string;
  schoolLevel: string;
  gradeLevel: string;
  subSubject: string;
};

export type ClassTextbookRecord = {
  id: string;
  title: string;
  subject: string;
  schoolLevel: string;
  gradeLevel: string;
  schoolLevels: string[];
  gradeLevels: string[];
  subSubject: string;
  publisher: string;
};

export function getDefaultClassTextbookFilters(classRecord: Record<string, unknown>): ClassTextbookPickerFilters;

export function filterClassTextbookCandidates<T extends Record<string, unknown>>(
  textbooks: T[],
  filters: ClassTextbookPickerFilters,
  query: string,
): T[];
```

Normalize Korean/English subjects and grades through Task 1 helpers. Derive school from grade. Candidate filtering calls `matchesTextbookTaxonomy` first, then applies a lowercase search over title/name, subject label, compact school/grade summaries, sub-subject, and publisher. Preserve input order.

- [ ] **Step 4: Extend class textbook metadata without changing fetch count**

In `use-management-records.ts`, keep the existing loaded `textbooks` query and expose:

```ts
available_textbooks: textbooks.map((textbook) => ({
  id: textValue(textbook.id),
  title: textValue(textbook.title || textbook.name),
  subject: textValue(textbook.subject),
  school_level: textValue(textbook.school_level),
  grade_level: textValue(textbook.grade_level),
  school_levels: Array.isArray(textbook.school_levels) ? textbook.school_levels : [],
  grade_levels: Array.isArray(textbook.grade_levels) ? textbook.grade_levels : [],
  sub_subject: textValue(textbook.sub_subject),
  publisher: textValue(textbook.publisher),
})).filter((textbook) => textbook.id && textbook.title),
```

Do not add another Supabase request when picker filters change.

- [ ] **Step 5: Build the focused picker component**

`ClassTextbookPicker` receives:

```ts
type ClassTextbookPickerProps = {
  classRecord: Record<string, unknown>;
  textbooks: ClassTextbookRecord[];
  selectedIds: string[];
  disabled: boolean;
  onSelectedIdsChange: (ids: string[]) => void;
};
```

On a different class ID, initialize filters from `getDefaultClassTextbookFilters`. The popover contains, in order: one text search, four compact selects (과목, 학교 구분, 학년, 세부과목), `전체 보기`, and the scrollable result list. School changes clear an incompatible grade. Subject changes clear an incompatible sub-subject. `전체 보기` clears only the four taxonomy filters and preserves search text. Selecting a result appends its ID once and closes the popover.

Each result row displays title, then:

```tsx
{[subjectLabel, schoolSummary, gradeSummary, textbook.subSubject, textbook.publisher]
  .filter(Boolean)
  .join(" · ")}
```

When no result matches, show `조건에 맞는 교재 없음` and the same `전체 보기` action. Use `max-h-72 overscroll-contain overflow-y-auto` for the list.

- [ ] **Step 6: Replace the inline draft picker while preserving selected cards and save flow**

In `management-page.tsx`, remove the local `ClassTextbookRecord` type in favor of the model export, remove local picker/query state now owned by the component, and replace only the picker trigger/content inside `renderClassTextbookManagement()` with `ClassTextbookPicker`.

Update `normalizeClassTextbookRecords()` to return the model's camel-case contract explicitly:

```ts
return [{
  id,
  title,
  subject: text(record.subject),
  schoolLevel: text(record.schoolLevel || record.school_level),
  gradeLevel: text(record.gradeLevel || record.grade_level),
  schoolLevels: idList(record.schoolLevels || record.school_levels),
  gradeLevels: idList(record.gradeLevels || record.grade_levels),
  subSubject: text(record.subSubject || record.sub_subject),
  publisher: text(record.publisher),
}];
```

Keep these existing behaviors unchanged:

- `form.textbookIds` remains JSON text inside generic form state.
- `compact()` writes both `payload.textbook_ids` and `payload.textbookIds`.
- Connected textbook cards render outside the picker and remain visible regardless of active filters.
- The unlink icon removes only the selected ID.
- The class detail save button remains the only persistence boundary.

- [ ] **Step 7: Add integration source contracts**

Extend `tests/management-class-student-roster.test.mjs`:

```js
const pickerSource = await readFile(new URL("src/features/management/class-textbook-picker.tsx", root), "utf8");
const pickerModelSource = await readFile(new URL("src/features/management/class-textbook-picker-model.ts", root), "utf8");

assert.match(pageSource, /ClassTextbookPicker/);
assert.match(pickerSource, /전체 보기/);
assert.match(pickerSource, /조건에 맞는 교재 없음/);
assert.match(pickerSource, /max-h-72 overscroll-contain overflow-y-auto/);
assert.match(pickerSource, /학교 구분/);
assert.match(pickerSource, /세부과목/);
assert.match(pickerModelSource, /getDefaultClassTextbookFilters/);
assert.match(pickerModelSource, /filterClassTextbookCandidates/);
assert.match(hookSource, /school_levels:/);
assert.match(hookSource, /grade_levels:/);
assert.match(hookSource, /sub_subject:/);
assert.match(pageSource, /payload\.textbook_ids = textbookIds/);
```

- [ ] **Step 8: Run focused tests and commit the class picker**

Run:

```bash
CODEX_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$CODEX_NODE --experimental-strip-types --test tests/class-textbook-picker-model.test.mjs tests/textbook-taxonomy-arrays.test.mjs tests/management-class-student-roster.test.mjs
git diff --check -- src/features/management/class-textbook-picker-model.ts src/features/management/class-textbook-picker.tsx src/features/management/management-page.tsx src/features/management/use-management-records.ts tests/class-textbook-picker-model.test.mjs tests/management-class-student-roster.test.mjs
git add src/features/management/class-textbook-picker-model.ts src/features/management/class-textbook-picker.tsx src/features/management/management-page.tsx src/features/management/use-management-records.ts tests/class-textbook-picker-model.test.mjs tests/management-class-student-roster.test.mjs
git commit -m "feat: filter class textbook picker by class"
```

Expected: focused tests PASS. Before committing, inspect `git diff --cached --name-only` and `git diff --cached` carefully because two management files already contain user-owned uncommitted work; stage only the completed combined file versions after confirming no unrelated change was lost.

---

### Task 6: Full Regression and Browser Acceptance

**Files:**
- Modify only if a regression is found: files changed in Tasks 1-5 and their focused tests.

**Interfaces:**
- Consumes: the complete taxonomy schema/model/editor/list and class picker.
- Produces: verified local code with documented database-runtime boundary; no production mutation.

- [ ] **Step 1: Run the focused Node suites together**

Run:

```bash
CODEX_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$CODEX_NODE --experimental-strip-types --test \
  tests/textbook-taxonomy-arrays.test.mjs \
  tests/textbook-taxonomy-schema.test.mjs \
  tests/textbook-workspace.test.mjs \
  tests/class-textbook-picker-model.test.mjs \
  tests/management-class-student-roster.test.mjs \
  tests/lesson-design-page.test.mjs \
  tests/registration-track-service.test.mjs
```

Expected: all focused suites PASS with zero unhandled promise rejections.

- [ ] **Step 2: Run lint on changed implementation/test files**

Run:

```bash
CODEX_PNPM=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
$CODEX_PNPM exec eslint \
  src/features/textbooks/textbook-taxonomy.ts \
  src/features/textbooks/textbook-service.ts \
  src/features/textbooks/textbook-operations-workspace.tsx \
  src/features/management/class-textbook-picker-model.ts \
  src/features/management/class-textbook-picker.tsx \
  src/features/management/management-page.tsx \
  src/features/management/use-management-records.ts \
  tests/textbook-taxonomy-arrays.test.mjs \
  tests/textbook-taxonomy-schema.test.mjs \
  tests/class-textbook-picker-model.test.mjs
```

Expected: exit code 0.

- [ ] **Step 3: Run the production build**

Run:

```bash
CODEX_PNPM=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
$CODEX_PNPM build
```

Expected: Next.js production build succeeds. If a pre-existing unrelated dirty-file error appears, record the exact error and prove the changed files pass their focused lint/tests; do not overwrite unrelated work to force a green build.

- [ ] **Step 4: Start the local app with the workspace environment**

Run:

```bash
CODEX_PNPM=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm
$CODEX_PNPM dev
```

Expected: the app serves `http://127.0.0.1:3000`. Use only the user's in-app browser for interaction; do not switch to Playwright or Chrome automation without permission.

- [ ] **Step 5: Verify textbook master behavior in the real UI**

At `/admin/textbooks`:

1. Open 신규 등록 and confirm 과목, 학교 구분, 학년, 세부과목 are visibly required.
2. Check `고등`; confirm `고1`, `고2`, `고3` check automatically.
3. Uncheck `고2`; confirm 고등 remains selected and the summary is `고1 · 고3`.
4. Start with no school selection and check `초6`; confirm `초등` checks automatically.
5. Confirm save is blocked with a Korean field error if any required taxonomy is empty.
6. Open an unclassified legacy row after a preview/local migration and confirm it renders `초·중·고` / `전 학년` and can be narrowed manually.
7. Confirm existing ISBN, price, inventory, order, issue, and settlement values are unchanged.

- [ ] **Step 6: Verify class picker behavior in the real UI**

At `/admin/classes?classId=fafa068f-35cb-4823-af6a-8e0a73bc6fe4&tab=basic`:

1. Open `교재 추가`; confirm filters default to 수학, 고등, and the class grade.
2. Confirm both an exact-grade book and a broad 전 학년 book appear.
3. Change school/grade/sub-subject and confirm the result list narrows without closing.
4. Use `전체 보기`; confirm taxonomy filters clear while the search input remains.
5. Add a book, close the picker, and confirm it remains in the connected list.
6. Change filters so that book would not match; confirm the connected list still shows it.
7. Save the class, reopen it, and confirm `textbook_ids` persisted.
8. Confirm long candidate lists scroll inside the popover without moving the dialog unexpectedly.

- [ ] **Step 7: Record the database verification boundary and inspect final diff**

Run:

```bash
git status --short --branch
git diff --check
git log --oneline -6
```

Expected: implementation commits are present; user-owned unrelated dirty files remain preserved. Record `remote taxonomy migration not applied; production data backfill pending explicit authorization` in the handoff.

- [ ] **Step 8: Commit only regression fixes, if any**

If Steps 1-6 required fixes, stage only those files and run:

```bash
git commit -m "fix: harden textbook taxonomy workflow"
```

If no fix was needed, do not create an empty commit.
