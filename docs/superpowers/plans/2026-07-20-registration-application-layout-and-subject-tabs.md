# Registration Application Layout and Subject Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make registration creation and saved-detail inquiry forms use one layout, filter schools by configured grade level, switch every subject-owned workflow area with one subject tab selection, and move read-only history behind a header clock action.

**Architecture:** Keep create and detail persistence state separate, but render both through shared inquiry-field and subject-picker presentation components. Extend the registration option catalog with optional school data, derive one active track for section state and visible subject panels, keep inactive track editors mounted with `hidden`, and render history in a header Popover while retaining the internal read-only history model key.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Radix UI primitives, shadcn components, Tailwind CSS, Node test runner, Supabase option reads.

## Global Constraints

- One registration case remains one document; English and math remain independent tracks inside it.
- Do not add workflow-stage tabs. The new tabs select subjects only.
- Create and detail must share the visible inquiry controls without merging their persistence, conflict, or locking logic.
- Detail saves must continue carrying the canonical hidden `campus`, `inquiryAt`, and `priority` values even though those fields are not rendered as editable controls.
- The visible field order is `학생명-문의일시`, `학년-학교`, `학부모 전화-학생 전화`, then full-width `요청 사항`.
- Inquiry timestamp is automatic and read-only; create shows `저장 시 자동 기록`.
- School candidates come from `academic_schools` and are limited to the selected grade's school level.
- Existing unmatched school text is preserved on initial detail load and cleared only after the operator changes grade to an incompatible level.
- When identity correction locks the saved school name, changing grade must preserve that locked school value instead of auto-clearing it.
- Inactive subject panels stay mounted so local drafts and the registration dirty guard survive tab changes.
- Shared appointments retain one `appointmentId`; case-wide admission actions must not be duplicated or hidden by subject selection.
- History stays automatic and read-only, is removed from the application body, and opens from a clock icon immediately left of close.
- Google Chat, Web Push, and SOLAPI remain disabled during verification; do not trigger a real provider send.
- Preserve the untracked `.pnpm-store/` directory and do not include it in commits.

---

## File Map

**Create**

- `src/features/tasks/registration-school-options.ts` — grade/category normalization and deterministic school choices.
- `src/features/tasks/registration-application-inquiry-fields.tsx` — the shared four-row inquiry field layout.
- `src/features/tasks/registration-subject-picker.tsx` — shared high-contrast English/math selection buttons.
- `src/features/tasks/registration-application-history-action.tsx` — header clock trigger and read-only history Popover.
- `src/features/tasks/registration-application-subject-tabs.tsx` — semantic controlled subject tabs.
- `tests/registration-school-options.test.mjs` — pure school-choice behavior.

**Modify**

- `src/features/tasks/ops-task-service.ts` — shared option types for school catalog data.
- `src/features/tasks/registration-track-service.ts` — optional `academic_schools` read and catalog status.
- `src/features/tasks/registration-track-fixtures.ts` — categorized fixture schools.
- `src/features/tasks/registration-application-create.tsx` — shared subject picker/fields and school options.
- `src/features/tasks/registration-application-inquiry-section.tsx` — subject-first composition; remove separate timestamp block.
- `src/features/tasks/registration-application-track-actions.tsx` — shared detail fields and track-scoped summaries.
- `src/features/tasks/registration-application-model.ts` — visible body order and active-track fallback helper.
- `src/features/tasks/registration-application-shell.tsx` — header history slot and five body sections.
- `src/features/tasks/registration-track-editor.tsx` — active-track state, mounted hidden panels, shared actions, history action.
- `src/features/tasks/ops-task-workspace.tsx` — pass school catalog/status into create and detail hosts.
- `src/features/tasks/registration-history-timeline.tsx` — embedded presentation mode for Popover use.
- `tests/registration-track-service.test.mjs` — fifth option read and non-blocking school failures.
- `tests/registration-track-workspace.test.mjs` — shared fields, subject tabs, history trigger source contracts.
- `tests/registration-application-model.test.mjs` — five visible sections and active-track fallback/state.
- `tests/registration-browser-verifier-contract.test.mjs` — updated browser-verifier selectors.
- `tests/ops-task-workspace.test.mjs` — option propagation and history/header contracts.
- `scripts/verify-ops-task-browser-workflow.mjs` — live create/detail layout, school, tab, and history checks.

---

### Task 1: Grade-Scoped School Catalog

**Files:**
- Create: `src/features/tasks/registration-school-options.ts`
- Create: `tests/registration-school-options.test.mjs`
- Modify: `src/features/tasks/ops-task-service.ts:66-115,284-289`
- Modify: `src/features/tasks/registration-track-service.ts:255-264,1645-1740`
- Modify: `src/features/tasks/registration-track-fixtures.ts:990-1027`
- Test: `tests/registration-track-service.test.mjs:873-950`

**Interfaces:**
- Produces: `OpsSchoolOption`, `RegistrationSchoolCatalogStatus`, `getRegistrationSchoolLevelFromGrade()`, `getRegistrationSchoolChoices()`.
- Produces: `OpsRegistrationWorkspaceOptionData.schools`, `.schoolCatalogStatus`, and `.schoolCatalogError` for Tasks 2 and 5.
- Consumes: `academic_schools(id,name,category,sort_order)`; no registration mutation or schema change.

- [ ] **Step 1: Write the failing pure school-choice tests**

Create `tests/registration-school-options.test.mjs` with exact grade, alias, sorting, and legacy-value cases:

```js
import assert from "node:assert/strict"
import test from "node:test"

const schoolOptions = await import("../src/features/tasks/registration-school-options.ts")

test("official registration grades map to one configured school level", () => {
  for (const grade of ["초1", "초2", "초3", "초4", "초5", "초6"]) {
    assert.equal(schoolOptions.getRegistrationSchoolLevelFromGrade(grade), "elementary")
  }
  for (const grade of ["중1", "중2", "중3"]) {
    assert.equal(schoolOptions.getRegistrationSchoolLevelFromGrade(grade), "middle")
  }
  for (const grade of ["고1", "고2", "고3"]) {
    assert.equal(schoolOptions.getRegistrationSchoolLevelFromGrade(grade), "high")
  }
  assert.equal(schoolOptions.getRegistrationSchoolLevelFromGrade("고 2"), "high")
  assert.equal(schoolOptions.getRegistrationSchoolLevelFromGrade(""), null)
  assert.equal(schoolOptions.getRegistrationSchoolLevelFromGrade("중4"), null)
})

test("every configured school-category alias normalizes to its canonical level", () => {
  for (const alias of ["elementary", "elem", "primary", "초등"]) {
    assert.equal(schoolOptions.normalizeRegistrationSchoolLevel(alias), "elementary")
  }
  for (const alias of ["middle", "mid", "secondary", "중등"]) {
    assert.equal(schoolOptions.normalizeRegistrationSchoolLevel(alias), "middle")
  }
  for (const alias of ["high", "highschool", "고등"]) {
    assert.equal(schoolOptions.normalizeRegistrationSchoolLevel(alias), "high")
  }
})

test("school choices are grade-scoped, sorted, and preserve only the current legacy value", () => {
  const schools = [
    { id: "h2", name: "한빛고", category: "highschool", sortOrder: 2 },
    { id: "m1", name: "가람중", category: "중등", sortOrder: 1 },
    { id: "h1", name: "가람고", category: "high", sortOrder: 1 },
    { id: "blank", name: "  ", category: "high", sortOrder: 0 },
  ]
  assert.deepEqual(
    schoolOptions.getRegistrationSchoolChoices({ schools, grade: "고1", currentSchoolName: "삭제된고" }),
    [
      { value: "가람고", label: "가람고", legacy: false },
      { value: "한빛고", label: "한빛고", legacy: false },
      { value: "삭제된고", label: "기존 입력 · 삭제된고", legacy: true },
    ],
  )
})
```

- [ ] **Step 2: Run the new test to verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-school-options.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `registration-school-options.ts`.

- [ ] **Step 3: Implement the pure school-option module**

Create `src/features/tasks/registration-school-options.ts` with these public contracts and deterministic behavior:

```ts
import type { OpsSchoolOption } from "./ops-task-service"

export type RegistrationSchoolLevel = "elementary" | "middle" | "high"
export type RegistrationSchoolChoice = {
  value: string
  label: string
  legacy: boolean
}

const CATEGORY_ALIASES: Record<string, RegistrationSchoolLevel> = {
  elementary: "elementary", elem: "elementary", primary: "elementary", 초등: "elementary",
  middle: "middle", mid: "middle", secondary: "middle", 중등: "middle",
  high: "high", highschool: "high", 고등: "high",
}

export function normalizeRegistrationSchoolLevel(value: unknown): RegistrationSchoolLevel | null {
  return CATEGORY_ALIASES[String(value || "").trim().toLowerCase()] || null
}

export function getRegistrationSchoolLevelFromGrade(value: string): RegistrationSchoolLevel | null {
  const grade = String(value || "").replace(/\s+/g, "")
  if (/^초[1-6]$/.test(grade)) return "elementary"
  if (/^중[1-3]$/.test(grade)) return "middle"
  if (/^고[1-3]$/.test(grade)) return "high"
  return null
}

export function getRegistrationSchoolChoices(input: {
  schools: readonly OpsSchoolOption[]
  grade: string
  currentSchoolName?: string
}): RegistrationSchoolChoice[] {
  const level = getRegistrationSchoolLevelFromGrade(input.grade)
  const current = String(input.currentSchoolName || "").trim()
  if (!level) return current ? [{ value: current, label: `기존 입력 · ${current}`, legacy: true }] : []
  const choices = input.schools
    .map((school) => ({ ...school, name: school.name.trim(), level: normalizeRegistrationSchoolLevel(school.category) }))
    .filter((school) => school.name && school.level === level)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "ko"))
    .filter((school, index, rows) => rows.findIndex((candidate) => candidate.name === school.name) === index)
    .map((school) => ({ value: school.name, label: school.name, legacy: false }))
  return current && !choices.some((choice) => choice.value === current)
    ? [...choices, { value: current, label: `기존 입력 · ${current}`, legacy: true }]
    : choices
}
```

- [ ] **Step 4: Add school data to the registration option loader with isolated failure status**

Add shared types in `ops-task-service.ts`:

```ts
export type OpsSchoolOption = { id: string; name: string; category: string; sortOrder: number }
export type RegistrationSchoolCatalogStatus = "authoritative" | "error"
```

Extend `OpsTaskWorkspaceOptionData` with optional `schools?: OpsSchoolOption[]`, `schoolCatalogStatus?: RegistrationSchoolCatalogStatus`, and `schoolCatalogError?: string | null`. Extend `OpsRegistrationWorkspaceOptionData` with required fields. In `loadWorkspaceOptionData()`, start a fifth `readWithFallback` call:

```ts
const [profiles, classes, textbooks, teachers, schools] = await Promise.all([
  // existing four reads
  readWithFallback("academic_schools", ["id,name,category,sort_order"], metrics),
])
const requiredErrors = [profiles.error, classes.error, textbooks.error, teachers.error].filter(Boolean)
const schoolOptions = schools.rows.map((row) => ({
  id: text(value(row, "id")),
  name: text(value(row, "name")),
  category: text(value(row, "category")),
  sortOrder: numberValue(value(row, "sort_order", "sortOrder")),
} satisfies OpsSchoolOption))
```

Return `schools: schoolOptions`, `schoolCatalogStatus: schools.error ? "error" : "authoritative"`, and `schoolCatalogError: schools.error ? errorText(schools.error) : null`. Calculate `schemaReady/error` from `requiredErrors` so an optional school read failure does not block registration.

- [ ] **Step 5: Update fixture options and the service RED contract**

Add at least one elementary, middle, and high fixture school to `registration-track-fixtures.ts`. Update `tests/registration-track-service.test.mjs` to expect five concurrent reads, query count `5`, the `academic_schools` column list, mapped school rows, and this isolated failure case:

```js
test("school catalog failure does not fail required registration options", async () => {
  const harness = createClient({ queryHandler(query) {
    if (query.table === "academic_schools") return { data: null, error: new Error("school denied") }
    return { data: [], error: null }
  } })
  const service = createRegistrationTrackService(harness.client, readyOptions())
  const result = await service.loadWorkspaceOptionData({ viewerId: "viewer-1" })
  assert.equal(result.schemaReady, true)
  assert.equal(result.error, null)
  assert.equal(result.schoolCatalogStatus, "error")
  assert.match(result.schoolCatalogError, /school denied/)
  assert.deepEqual(result.schools, [])
})
```

Update `RegistrationSubjectTrackFixtureState.optionData` at `registration-track-fixtures.ts:175-186`, not only the returned fixture literal. Update `tests/registration-track-fixtures.test.mjs` to assert the fixture option packet includes the three school levels, a null school error, and `schoolCatalogStatus === "authoritative"`.

- [ ] **Step 6: Run targeted tests and commit**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-school-options.test.mjs tests/registration-track-service.test.mjs tests/registration-track-fixtures.test.mjs
```

Expected: PASS with no failures.

Commit:

```bash
git add src/features/tasks/registration-school-options.ts src/features/tasks/ops-task-service.ts src/features/tasks/registration-track-service.ts src/features/tasks/registration-track-fixtures.ts tests/registration-school-options.test.mjs tests/registration-track-service.test.mjs tests/registration-track-fixtures.test.mjs
git commit -m "feat: add grade-scoped registration schools"
```

---

### Task 2: Shared Create and Detail Inquiry Controls

**Files:**
- Create: `src/features/tasks/registration-application-inquiry-fields.tsx`
- Create: `src/features/tasks/registration-subject-picker.tsx`
- Modify: `src/features/tasks/registration-application-inquiry-section.tsx:3-62`
- Modify: `src/features/tasks/registration-application-create.tsx:1-315`
- Modify: `src/features/tasks/registration-application-track-actions.tsx:850-1250`
- Modify: `src/features/tasks/registration-track-editor.tsx:60-110,733-817`
- Modify: `src/features/tasks/ops-task-workspace.tsx:9053-9105,12923-12953,13239-13257,13342-13370,14020`
- Test: `tests/registration-track-workspace.test.mjs:1-120,539-610`
- Test: `tests/ops-task-workspace.test.mjs`

**Interfaces:**
- Consumes: `OpsSchoolOption`, `RegistrationSchoolCatalogStatus`, and `getRegistrationSchoolChoices()` from Task 1.
- Produces: `RegistrationInquiryCommonFields` used by create and detail.
- Produces: `RegistrationSubjectPicker` used by the create subject control and saved subject sync editor.

- [ ] **Step 1: Replace the old source contracts with failing shared-control contracts**

Update `tests/registration-track-workspace.test.mjs` to read both new files and assert one approved order:

```js
test("create and detail share the approved subject-first inquiry controls", async () => {
  const fields = await readFile(new URL("../src/features/tasks/registration-application-inquiry-fields.tsx", import.meta.url), "utf8")
  const picker = await readFile(new URL("../src/features/tasks/registration-subject-picker.tsx", import.meta.url), "utf8")
  const create = await readFile(new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url), "utf8")
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  assert.match(create, /<RegistrationInquiryCommonFields/)
  assert.match(actions, /<RegistrationInquiryCommonFields/)
  assert.match(create, /<RegistrationSubjectPicker/)
  assert.match(actions, /<RegistrationSubjectPicker/)
  assert.match(fields, /학생명[\s\S]*문의일시[\s\S]*학년[\s\S]*학교[\s\S]*학부모 전화[\s\S]*학생 전화[\s\S]*요청 사항/)
  assert.match(picker, /variant=\{selected \? "default" : "outline"\}/)
  assert.match(picker, /aria-pressed=\{selected\}/)
  assert.match(picker, /<Check/)
})
```

Delete the obsolete assertions that require a create-only checkbox, free-text school input, separate inquiry timestamp block, and `secondary` active subject styling.

- [ ] **Step 2: Run the workspace contract to verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-track-workspace.test.mjs
```

Expected: FAIL because both shared component files and usages are absent.

- [ ] **Step 3: Create the shared subject picker**

Implement `registration-subject-picker.tsx` with this interface and active treatment:

```tsx
export type RegistrationSubjectPickerProps = {
  value: readonly RegistrationSubject[]
  disabled?: boolean
  disabledSubjects?: ReadonlySet<RegistrationSubject>
  onToggle: (subject: RegistrationSubject, selected: boolean) => void
  action?: ReactNode
}

export function RegistrationSubjectPicker(props: RegistrationSubjectPickerProps) {
  return (
    <section className="grid gap-2" aria-label="문의 과목" data-registration-focus="subject">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">문의 과목</h3>{props.action}</div>
      <div className="grid grid-cols-2 gap-2">
        {(["영어", "수학"] as RegistrationSubject[]).map((subject) => {
          const selected = props.value.includes(subject)
          return <Button key={subject} type="button" variant={selected ? "default" : "outline"}
            aria-pressed={selected} disabled={props.disabled || props.disabledSubjects?.has(subject)}
            onClick={() => props.onToggle(subject, !selected)}>
            {selected ? <Check aria-hidden="true" className="size-4" /> : null}{subject}
          </Button>
        })}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Create the shared four-row inquiry fields**

Implement `registration-application-inquiry-fields.tsx` with an exact value and update contract:

```ts
export type RegistrationInquiryFieldValues = {
  studentName: string
  schoolGrade: string
  schoolName: string
  parentPhone: string
  studentPhone: string
  requestNote: string
}
export type RegistrationInquiryFieldName = keyof RegistrationInquiryFieldValues
export type RegistrationInquiryCommonFieldsProps = {
  values: RegistrationInquiryFieldValues
  inquiryAtLabel: string
  schoolChoices: readonly RegistrationSchoolChoice[]
  schoolCatalogStatus: "loading" | RegistrationSchoolCatalogStatus
  schoolCatalogError?: string
  disabled?: boolean
  disabledFields?: Partial<Record<RegistrationInquiryFieldName, boolean>>
  onChange: (field: RegistrationInquiryFieldName, value: string) => void
  onRetrySchools?: () => void
}
```

Render one `sm:grid-cols-2` grid in the approved order. Use `getRegistrationGradeOptions()` for the required grade select, an `<output>` for inquiry timestamp, a school `<select>` disabled until grade is recognized, telephone input modes, and a full-width textarea. Labels must render the same `필수`, `선택`, and `자동` markers in create and detail. Mark those visual suffixes `aria-hidden="true"`; use `required` or `aria-required="true"` on required controls so exact accessible labels remain `학생명`, `학년`, and `학부모 전화`.

In detail mode, prepend a current grade not found in the official 12-grade list as `${currentGrade} · 기존 입력` so merely opening an old application cannot erase its grade. Associate the timestamp output with `aria-label="문의일시 자동"` and keep it visually read-only rather than input-shaped.

Preserve the verifier focus hooks in the shared component: `data-registration-focus="studentName"`, `schoolGrade`, and `parentPhone`, plus `data-common-field="student-name"`, `school-grade`, and `parent-phone`. Put `data-registration-focus="subject"` on the shared subject picker wrapper.

When `schoolCatalogStatus === "error"`, render `schoolCatalogError || "학교 선택 정보를 불러오지 못했습니다."` next to `다시 불러오기`. Preserve the current school and the blank option, but do not expose stale catalog candidates.

- [ ] **Step 5: Compose subject first and adapt create without changing create persistence**

Change `RegistrationApplicationInquirySection` to render `subjectSyncContent`, then `commonInfoContent`, then the existing route/exception content. Remove the `inquiryAt` prop and its standalone output block because the shared fields own timestamp placement.

```tsx
return (
  <div className="grid gap-4" aria-disabled={!editable}>
    <div className="grid gap-3">{subjectSyncContent}</div>
    <div className="grid gap-3">{commonInfoContent}</div>
    {exceptionContent ? <div className="grid gap-3 border-t pt-4">{exceptionContent}</div> : null}
  </div>
)
```

In `RegistrationApplicationCreate`, add:

```ts
schools?: OpsSchoolOption[]
schoolCatalogStatus?: "loading" | RegistrationSchoolCatalogStatus
schoolCatalogError?: string
onRetrySchools?: () => void
```

Use `RegistrationSubjectPicker` for `subjects` and `RegistrationInquiryCommonFields` for `form`. When grade changes while the school catalog is authoritative, calculate choices **without** `currentSchoolName` and clear `schoolName` only when it is not valid for the new grade. During loading/error preserve the current school because validity cannot be established. Keep `RegistrationInitialRouteFields` and the atomic creation draft unchanged.

```tsx
<RegistrationInquiryCommonFields
  values={{
    studentName: form.studentName || "",
    schoolGrade: registration.schoolGrade || "",
    schoolName: registration.schoolName || "",
    parentPhone: registration.parentPhone || "",
    studentPhone: registration.studentPhone || "",
    requestNote: registration.requestNote || "",
  }}
  inquiryAtLabel="저장 시 자동 기록"
  schoolChoices={schoolChoices}
  schoolCatalogStatus={schoolCatalogStatus}
  schoolCatalogError={schoolCatalogError}
  disabled={disabled || !writable}
  onChange={handleInquiryFieldChange}
  onRetrySchools={onRetrySchools}
/>
```

- [ ] **Step 6: Adapt detail while preserving conflict and dirty behavior**

Add the same school props to `RegistrationCommonInfoSection` and `RegistrationApplication`. Replace only the field JSX inside `RegistrationCommonInfoSection` with `RegistrationInquiryCommonFields`; keep `canonicalDraft`, reconciliation, conflict comparison, validation, request keys, save, and `useOwnedDirtyState` intact.

Do not remove `campus`, `inquiryAt`, or `priority` from `RegistrationCommonDraft` or `commonPayloadKey`; they remain canonical save values even though the shared visible field component consumes only the six approved editable fields.

Use `RegistrationSubjectPicker` inside `RegistrationSubjectSyncSection`; pass its existing removable-subject rules through `disabledSubjects`, and keep the independent `과목 저장` action. On an operator grade change, clear an incompatible `draft.schoolName`; on initial load, pass `canonicalDraft.schoolName` to `getRegistrationSchoolChoices()` so a legacy option remains visible.

The grade-change handler must use a candidate call with no legacy current value. Preserve `draft.schoolName` when `identityLocked` or when the school catalog is loading/error; only an unlocked authoritative mismatch clears it:

```ts
function updateSchoolGrade(nextGrade: string) {
  const catalogChoices = getRegistrationSchoolChoices({ schools, grade: nextGrade })
  setDraft((current) => ({
    ...current,
    schoolGrade: nextGrade,
    schoolName: identityLocked || schoolCatalogStatus !== "authoritative"
      ? current.schoolName
      : catalogChoices.some((choice) => choice.value === current.schoolName)
        ? current.schoolName
        : "",
  }))
}
```

```tsx
<RegistrationInquiryCommonFields
  values={draft}
  inquiryAtLabel={formatRegistrationInquiryAt(draft.inquiryAt)}
  schoolChoices={getRegistrationSchoolChoices({
    schools,
    grade: draft.schoolGrade,
    currentSchoolName: draft.schoolName,
  })}
  schoolCatalogStatus={schoolCatalogStatus}
  schoolCatalogError={schoolCatalogError}
  disabled={!canEdit || saving || refreshPending || Boolean(conflictAttempt)}
  disabledFields={{
    studentName: identityLocked,
    schoolName: identityLocked,
    parentPhone: identityLocked,
    studentPhone: identityLocked,
  }}
  onChange={updateInquiryField}
  onRetrySchools={onRetrySchools}
/>
```

- [ ] **Step 7: Pass school options through every create/detail host**

At every `RegistrationApplicationCreate` and `RegistrationApplication` call in `ops-task-workspace.tsx`, pass:

```tsx
schools={registrationOptionsDataRef.current?.schools || []}
schoolCatalogStatus={registrationOptionsLoading
  ? "loading"
  : registrationOptionsDataRef.current?.schoolCatalogStatus
    || (registrationOptionsError ? "error" : "loading")}
schoolCatalogError={registrationOptionsDataRef.current?.schoolCatalogError || registrationOptionsError}
onRetrySchools={() => void retryRegistrationOptions()}
```

Update `tests/ops-task-workspace.test.mjs` so both modal hosts and the legacy-compatible host are covered.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-school-options.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs
```

Expected: PASS with no failures.

Commit:

```bash
git add src/features/tasks/registration-application-inquiry-fields.tsx src/features/tasks/registration-subject-picker.tsx src/features/tasks/registration-application-inquiry-section.tsx src/features/tasks/registration-application-create.tsx src/features/tasks/registration-application-track-actions.tsx src/features/tasks/registration-track-editor.tsx src/features/tasks/ops-task-workspace.tsx tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs
git commit -m "feat: unify registration inquiry forms"
```

---

### Task 3: Header History Action

**Files:**
- Create: `src/features/tasks/registration-application-history-action.tsx`
- Modify: `src/features/tasks/registration-application-model.ts:10-25,280-360`
- Modify: `src/features/tasks/registration-application-shell.tsx:10-140`
- Modify: `src/features/tasks/registration-history-timeline.tsx:12-240`
- Modify: `src/features/tasks/registration-application-create.tsx`
- Modify: `src/features/tasks/registration-track-editor.tsx:733-890`
- Test: `tests/registration-application-model.test.mjs`
- Test: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Produces: `REGISTRATION_APPLICATION_BODY_SECTION_ORDER`, containing the five visible body sections.
- Produces: `RegistrationApplicationShellProps.historyAction?: ReactNode`.
- Produces: `RegistrationApplicationHistoryAction({ detail, profiles })`.
- Retains: internal `history` section state and read-only event data.

- [ ] **Step 1: Write failing model and shell contracts**

Update tests to require five visible body sections while retaining the internal history state:

```js
assert.deepEqual(application.REGISTRATION_APPLICATION_BODY_SECTION_ORDER, [
  "inquiry", "level_test", "consultation", "placement", "admission",
])
assert.ok(application.REGISTRATION_APPLICATION_SECTION_ORDER.includes("history"))
```

In the workspace source test, require `historyAction: ReactNode`, the `Clock3` action component, `aria-label="자동 이력 보기"`, and absence of inline `{props.history}` or a body `자동 이력` section.

- [ ] **Step 2: Run model/workspace tests to verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-application-model.test.mjs tests/registration-track-workspace.test.mjs
```

Expected: FAIL because visible body order and history action do not exist.

- [ ] **Step 3: Separate internal and visible section order**

Add this constant in `registration-application-model.ts`:

```ts
export const REGISTRATION_APPLICATION_BODY_SECTION_ORDER = [
  "inquiry", "level_test", "consultation", "placement", "admission",
] as const satisfies readonly RegistrationApplicationSectionKey[]
```

Keep `REGISTRATION_APPLICATION_SECTION_ORDER` and all `history` track-state logic intact. Change the shell to map the body order, remove its `history` content prop, add `historyAction?: ReactNode`, and render `{props.historyAction}` immediately before `{props.closeAction}`.

- [ ] **Step 4: Create the clock Popover**

Implement `registration-application-history-action.tsx`:

```tsx
export function RegistrationApplicationHistoryAction({ detail, profiles }: RegistrationHistoryTimelineProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="자동 이력 보기">
          <Clock3 aria-hidden="true" className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[calc(100dvh-6rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain p-0">
        <RegistrationHistoryTimeline detail={detail} profiles={profiles} embedded />
      </PopoverContent>
    </Popover>
  )
}
```

Add `embedded?: boolean` to `RegistrationHistoryTimelineProps`; embedded mode removes the outer duplicate border while keeping its title, filters, entries, and read-only behavior.

- [ ] **Step 5: Wire detail only and remove create/body history**

Pass `<RegistrationApplicationHistoryAction detail={detail} profiles={profiles} />` as `historyAction` from `RegistrationApplication`. Remove the old inline history body prop. Do not pass a history action from `RegistrationApplicationCreate`.

```diff
- history={<RegistrationHistoryTimeline detail={detail} profiles={profiles} />}
+ historyAction={<RegistrationApplicationHistoryAction detail={detail} profiles={profiles} />}
```

- [ ] **Step 6: Run targeted tests and commit**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-application-model.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs
```

Expected: PASS with no failures.

Commit:

```bash
git add src/features/tasks/registration-application-history-action.tsx src/features/tasks/registration-application-model.ts src/features/tasks/registration-application-shell.tsx src/features/tasks/registration-history-timeline.tsx src/features/tasks/registration-application-create.tsx src/features/tasks/registration-track-editor.tsx tests/registration-application-model.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs
git commit -m "feat: move registration history to header"
```

---

### Task 4: Whole-Workflow Subject Tabs

**Files:**
- Create: `src/features/tasks/registration-application-subject-tabs.tsx`
- Modify: `src/features/tasks/registration-application-model.ts`
- Modify: `src/features/tasks/registration-application-inquiry-section.tsx`
- Modify: `src/features/tasks/registration-application-track-actions.tsx:616-700`
- Modify: `src/features/tasks/registration-track-editor.tsx:240-890`
- Test: `tests/registration-application-model.test.mjs`
- Test: `tests/registration-track-workspace.test.mjs`

**Interfaces:**
- Produces: `resolveRegistrationActiveTrackId(tracks, requestedTrackId): string | null`.
- Produces: `RegistrationApplicationSubjectTabs({ tracks, value, panelIdsByTrackId, onValueChange })`.
- Consumes: `RegistrationApplicationInquirySectionProps.subjectNavigationContent?: ReactNode` placed after the shared inquiry fields and before subject-owned inquiry exceptions.
- Retains: every track editor instance in the React tree while its panel is hidden.

- [ ] **Step 1: Write failing active-track and source contracts**

Add model tests:

```js
test("active registration track keeps a valid request and falls back after subject removal", () => {
  const tracks = [{ id: "english" }, { id: "math" }]
  assert.equal(application.resolveRegistrationActiveTrackId(tracks, "math"), "math")
  assert.equal(application.resolveRegistrationActiveTrackId(tracks, "removed"), "english")
  assert.equal(application.resolveRegistrationActiveTrackId([], "removed"), null)
})
```

Replace the old `doesNotMatch(role="tablist")` assertion with contracts requiring:

```js
assert.match(source, /role="tablist"/)
assert.match(source, /aria-label="과목별 등록 진행"/)
assert.match(source, /role="tab"/)
assert.match(source, /aria-selected=\{selected\}/)
assert.match(source, /role="tabpanel"/)
assert.match(source, /hidden=\{!selected\}/)
assert.match(source, /trackStates\.filter\(\(state\) => state\.trackId === activeTrackId\)/)
```

- [ ] **Step 2: Run model/workspace tests to verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-application-model.test.mjs tests/registration-track-workspace.test.mjs
```

Expected: FAIL because active-track fallback and semantic tabs are absent.

- [ ] **Step 3: Add the active-track helper and semantic tabs**

Implement in the model:

```ts
export function resolveRegistrationActiveTrackId(
  tracks: readonly Pick<OpsRegistrationTrackSummary, "id">[],
  requestedTrackId: string | null,
): string | null {
  return tracks.some((track) => track.id === requestedTrackId)
    ? requestedTrackId
    : tracks[0]?.id || null
}
```

Create `registration-application-subject-tabs.tsx`. Render one controlled tablist with primary active buttons, outline inactive buttons, `role="tab"`, `aria-selected`, roving `tabIndex`, a space-separated `aria-controls` list, and ArrowLeft/ArrowRight/Home/End keyboard behavior. Each trigger id must be `registration-subject-tab-${track.id}`.

```tsx
<div role="tablist" aria-label="과목별 등록 진행" className="grid grid-cols-2 gap-2">
  {tracks.map((track) => {
    const selected = track.id === value
    return (
      <Button
        key={track.id}
        id={`registration-subject-tab-${track.id}`}
        type="button"
        role="tab"
        variant={selected ? "default" : "outline"}
        aria-selected={selected}
        aria-controls={panelIdsByTrackId[track.id]?.join(" ")}
        tabIndex={selected ? 0 : -1}
        onKeyDown={(event) => handleSubjectTabKeyDown(event, track.id)}
        onClick={() => onValueChange(track.id)}
      >
        <span>{track.subject}</span><span>{track.statusLabel}</span>
      </Button>
    )
  })}
</div>
```

- [ ] **Step 4: Put the tablist between inquiry and subject-owned sections**

Add `subjectNavigationContent?: ReactNode` to `RegistrationApplicationInquirySection`. Render it after shared subject and field content but before `exceptionContent`, so subject-specific inquiry frames and all later workflow sections respond to a tablist positioned above them:

```tsx
<div className="grid gap-4" aria-disabled={!editable}>
  <div className="grid gap-3">{subjectSyncContent}</div>
  <div className="grid gap-3">{commonInfoContent}</div>
  {subjectNavigationContent ? <div className="grid gap-2 border-t pt-4">{subjectNavigationContent}</div> : null}
  {exceptionContent ? <div className="grid gap-3">{exceptionContent}</div> : null}
</div>
```

Saved detail passes `RegistrationApplicationSubjectTabs`; create passes no subject navigation because unsaved initial routes remain one atomic planning form.

Build the ARIA relationship from every subject-owned body panel and remove the old `RegistrationSubjectProgress` button grid:

```ts
const subjectPanelIdsByTrackId = Object.fromEntries(detail.tracks.map((track) => [
  track.id,
  ["inquiry", "level_test", "consultation", "placement", "admission"]
    .map((section) => `registration-${section}-${track.id}`),
]))
```

- [ ] **Step 5: Derive section state and shared appointment actions from the active track**

In `RegistrationApplication`, derive:

```ts
const activeTrackId = resolveRegistrationActiveTrackId(detail.tracks, focusTrackId)
const activeTrackStates = trackStates.filter((state) => state.trackId === activeTrackId)
const activeAppointmentActionPlans = appointmentActionPlans.filter((plan) => (
  activeTrackId ? plan.participantTrackIds.includes(activeTrackId) : false
))
const sectionStates = getRegistrationApplicationSectionStates({
  tracks: activeTrackStates,
  caseEditableSections: getRegistrationApplicationCaseEditableSections({
    canManage: canManageCase,
    admissionMessageEditable: admissionEditable,
    admissionBatches: detail.admissionBatches,
    appointmentActionSections: activeAppointmentActionPlans.map((plan) => plan.kind === "level_test" ? "level_test" : "consultation"),
  }),
})
```

Filter displayed appointment plan rows by active participation. Keep the case-wide admission message and admission batch panel outside track frames so it remains reachable for every tab.

- [ ] **Step 6: Keep all track panels mounted and hide inactive ones**

Change `RegistrationTrackSectionFrame` to accept `selected: boolean` and render:

```tsx
<article
  role="tabpanel"
  id={`registration-${section}-${context.track.id}`}
  aria-labelledby={`registration-subject-tab-${context.track.id}`}
  hidden={!selected}
  data-registration-track-id={context.track.id}
  data-registration-subject={context.track.subject}
>
  {/* existing values and editor children stay unchanged */}
</article>
```

Continue mapping every `trackContext` in `renderTrackFrames()`. Do not filter the array or conditionally mount `RegistrationTrackStageEditor`, `RegistrationTrackDirectorSection`, `RegistrationConsultationOutcomeEditor`, or `RegistrationEnrollmentTrackEditor`. Wrap migration review/conflict UI in the same mounted-hidden rule for its track.

- [ ] **Step 7: Scope summaries and tab behavior without losing deep-link focus**

Add `trackId: string | null` to `RegistrationLevelTestSummary`, `RegistrationConsultationSummary`, and `RegistrationPlacementSummary`; filter their existing `detail.tracks.map` input to the active id.

```diff
- {detail.tracks.map((track) => {
+ {detail.tracks.filter((track) => track.id === trackId).map((track) => {
```

Replace the focus effect that scrolls on every `focusTrackId` change with a task-keyed initial-focus ref. It may scroll once when a valid deep-linked track first opens, but the tab `onValueChange` path must only call `onFocusTrack(trackId)` and must not scroll. If a synchronized subject removal invalidates the current id, call `onFocusTrack(activeTrackId)` once for the first remaining track.

```ts
useEffect(() => {
  if (!activeTrackId || focusTrackId === activeTrackId) return
  onFocusTrack(activeTrackId)
}, [activeTrackId, focusTrackId, onFocusTrack])

function handleSubjectTabChange(trackId: string) {
  onFocusTrack(trackId)
}
```

- [ ] **Step 8: Run targeted tests and commit**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-application-model.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs
```

Expected: PASS with no failures.

Commit:

```bash
git add src/features/tasks/registration-application-subject-tabs.tsx src/features/tasks/registration-application-model.ts src/features/tasks/registration-application-inquiry-section.tsx src/features/tasks/registration-application-track-actions.tsx src/features/tasks/registration-track-editor.tsx tests/registration-application-model.test.mjs tests/registration-track-workspace.test.mjs tests/ops-task-workspace.test.mjs
git commit -m "feat: switch registration workflow by subject tabs"
```

---

### Task 5: Browser Verifier and Full Regression

**Files:**
- Modify: `scripts/verify-ops-task-browser-workflow.mjs:1809-1845,2950-2958,3076-3080`
- Modify: `tests/registration-browser-verifier-contract.test.mjs`
- Modify: affected registration test contracts discovered by the full suite.

**Interfaces:**
- Consumes: fixture school catalog, shared inquiry controls, subject tab ids/data attributes, and the history trigger from Tasks 1-4.
- Produces: repeatable no-send browser evidence for the annotated workflow.

- [ ] **Step 1: Write failing browser-verifier contracts**

Update `tests/registration-browser-verifier-contract.test.mjs` to require the verifier to locate:

```js
assert.match(source, /자동 이력 보기/)
assert.match(source, /과목별 등록 진행/)
assert.match(source, /registration-subject-tab-/)
assert.match(source, /학년을 먼저 선택/)
assert.match(source, /기존 입력/)
```

Remove the old contract that expects six inline sections, an inline history timeline, and create subject checkboxes.

- [ ] **Step 2: Run the verifier contract to verify RED**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-browser-verifier-contract.test.mjs
```

Expected: FAIL because the script still checks the old inline layout.

- [ ] **Step 3: Update the fixture browser workflow**

Change `verify-ops-task-browser-workflow.mjs` to perform these exact checks without sending notifications:

1. Open `등록 추가`; assert the subject picker precedes the shared fields and the labels appear in the approved row order.
2. Assert school is disabled before grade, choose `고1`, and assert only high-school fixture options appear.
3. Open a saved dual-subject application; assert the same inquiry control structure and timestamp beside student name.
4. Select English and math tabs; after each click assert all visible `[role="tabpanel"]` elements belong to that track and inactive track panels exist with `hidden`.
5. Enter a reversible local draft value, change tabs twice, and assert the value remains.
6. Assert shared appointment action rows keep one appointment id/participant set and admission case actions remain reachable.
7. Click `자동 이력 보기`; assert the Popover contains `등록 자동 이력`, subject/stage filters, actor, and time, then close it and assert focus returns to the clock button.
8. With history open, press Escape and assert only the Popover closes; the registration application remains open and retains its scroll position.

Use `placement`, not the obsolete `enrollment`, for the registration application section id. Replace all create-verifier checkbox locators with `[data-registration-focus="subject"] button[aria-pressed]`; assert the history trigger count is zero before first save and one after opening a saved application. Any legacy verifier step that fills school as free text must instead select a configured option after selecting grade, or leave the optional school blank.

Do not invoke create-save, notification retry, admission-message send, Web Push, Google Chat, or SOLAPI actions during this verification.

Use stable accessible selectors and data attributes instead of viewport coordinates:

```js
const historyButton = page.getByRole("button", { name: "자동 이력 보기" })
await historyButton.click()
await page.getByLabel("등록 자동 이력").waitFor({ state: "visible" })

const mathTab = page.getByRole("tab", { name: /수학/ })
await mathTab.click()
await page.locator('[role="tabpanel"][data-registration-subject="수학"]').waitFor({ state: "visible" })
await page.locator('[role="tabpanel"][data-registration-subject="영어"]').waitFor({ state: "hidden" })
```

- [ ] **Step 4: Run all registration-focused tests**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/registration-*.test.mjs tests/ops-task-workspace.test.mjs
```

Expected: PASS with no failures.

- [ ] **Step 5: Run type, lint, build, and full test suite**

Run:

```bash
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/typescript/bin/tsc --noEmit
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/eslint/bin/eslint.js src tests middleware.ts next.config.ts
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/next/dist/bin/next build --webpack
/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --experimental-strip-types tests/*.test.mjs
git diff --check
```

Expected: TypeScript has no errors; ESLint has no new errors; Next.js build succeeds; full tests pass; diff check is clean.

- [ ] **Step 6: Run live browser QA on the existing local server**

Use `http://localhost:3001/admin/registration?flow=consulting` and repeat the seven checks from Step 3 at desktop width and a narrow mobile viewport. Confirm the history Popover remains above the registration dialog and its own scroll does not move the application body. Record any skipped fixture-only check explicitly; do not substitute screenshots for functional tab, school-option, draft-retention, or focus checks.

- [ ] **Step 7: Commit verifier and regression updates**

```bash
git add scripts/verify-ops-task-browser-workflow.mjs tests/registration-browser-verifier-contract.test.mjs tests
git commit -m "test: verify registration application refinement"
```

Do not push or deploy unless the user separately asks for it.
