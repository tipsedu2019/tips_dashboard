# Class Picker and Schedule Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore compact multi-day class schedules and polish class/student picker controls without changing relation persistence or database schema.

**Architecture:** Extract schedule parsing/formatting into a pure TypeScript module with behavior tests, then consume it from the existing management page. Add a small shared labelled filter-surface component for the three candidate pickers, while keeping their existing model functions and state. Keep numeric and copy changes local to the class detail editor and roster renderer.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui, Node test runner with `--experimental-strip-types`.

## Global Constraints

- Preserve the existing `classes.schedule`, teacher, room, enrollment, waitlist, and textbook-link persistence contracts.
- Do not rewrite the database; the compact source schedules are intact.
- Default student-class results to the selected student's grade and retain explicit all-grade expansion.
- Do not hide genuinely different per-slot teachers or classrooms.
- Preserve all unrelated dirty-worktree changes.

---

### Task 1: Multi-day schedule parser and compact candidate schedule

**Files:**
- Create: `src/features/management/class-schedule-slots.ts`
- Modify: `src/features/management/management-page.tsx`
- Create: `tests/class-schedule-slots.test.mjs`
- Modify: `tests/management-class-student-roster.test.mjs`

**Interfaces:**
- Produces: `ClassScheduleSlot`, `parseClassScheduleSlots(scheduleValue, teacherValue, classroomValue)`, `formatClassScheduleSlots(slots)`, and `stripSharedScheduleDetails(scheduleValue, teacherValue, classroomValue)`.
- Consumes: Korean weekday tokens, class-level teacher strings, and room aliases already stored on class rows.

- [ ] **Step 1: Write failing behavior tests**

```js
test("compact weekday groups expand without losing days", () => {
  assert.deepEqual(
    parseClassScheduleSlots("화목 17:00-19:00", "권용재", "별관 2강").map(({ day, startTime, endTime }) => ({ day, startTime, endTime })),
    [
      { day: "화", startTime: "17:00", endTime: "19:00" },
      { day: "목", startTime: "17:00", endTime: "19:00" },
    ],
  );
});

test("mixed compact and single-day schedules preserve every slot", () => {
  assert.deepEqual(
    parseClassScheduleSlots("화목 17:00-19:00\n토 12:30-14:00", "권용재", "별관 2강").map((slot) => slot.day),
    ["화", "목", "토"],
  );
});

test("shared candidate details are removed but different details stay", () => {
  assert.equal(
    stripSharedScheduleDetails(
      "월 19:20-21:20 (정보영, 본관 7강)\n수 19:20-21:20 (정보영, 본관 7강)",
      "정보영",
      "본관 7강",
    ),
    "월 19:20-21:20\n수 19:20-21:20",
  );
  assert.match(
    stripSharedScheduleDetails("금 21:30-23:00 (양소윤, 별7)\n토 15:30-17:00 (김성은, 본2)", "양소윤, 김성은", "별관 7강(금),본관 2강(토)"),
    /김성은/,
  );
});
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
PATH="/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH" \
node --test --experimental-strip-types tests/class-schedule-slots.test.mjs
```

Expected: FAIL because `src/features/management/class-schedule-slots.ts` does not exist.

- [ ] **Step 3: Implement the pure schedule module**

```ts
const DAY_GROUP_PATTERN = /([월화수목금토일]+)\s*(\d{1,2}:\d{2})\s*[-~–]\s*(\d{1,2}:\d{2})(?:\s*\(([^)]*)\))?/g;

for (const match of schedule.matchAll(DAY_GROUP_PATTERN)) {
  const days = [...match[1]].filter((day) => CLASS_SCHEDULE_DAYS.includes(day as ClassScheduleDay));
  for (const day of days) {
    slots.push({ day, startTime, endTime, teacher, classroom });
  }
}
```

Implement the existing teacher/room alias fallback inside the module. `stripSharedScheduleDetails` removes a parenthesized segment only when every normalized segment value matches the class-level teacher or room set.

- [ ] **Step 4: Replace local parser/formatter definitions with imports**

```ts
import {
  formatClassScheduleSlots,
  parseClassScheduleSlots,
  stripSharedScheduleDetails,
  type ClassScheduleSlot,
} from "./class-schedule-slots";
```

Update `getClassCandidateMetaItems` so its schedule item uses:

```ts
{
  key: "schedule",
  value: stripSharedScheduleDetails(
    record.schedule,
    record.teacher || record.teacher_name || record.teacherName,
    record.classroom || record.room || record.class_room,
  ),
}
```

- [ ] **Step 5: Run focused schedule tests and verify GREEN**

Run the Task 1 test command plus `tests/management-class-student-roster.test.mjs`.

Expected: all schedule behavior and source-contract tests PASS.

---

### Task 2: Capacity stepper and roster wording

**Files:**
- Modify: `src/features/management/management-page.tsx`
- Modify: `tests/management-class-student-roster.test.mjs`

**Interfaces:**
- Produces: `ClassCapacityInput` with the same right-side up/down control structure as `ClassTuitionManwonInput`.
- Consumes: `handleEditableFieldChange("capacity", value)` and the existing mutation permission state.

- [ ] **Step 1: Add failing UI contract tests**

```js
test("class capacity uses the dedicated stepper input", async () => {
  assert.match(pageSource, /function ClassCapacityInput/);
  assert.match(pageSource, /data-testid="class-capacity-input"/);
  assert.match(pageSource, /aria-label="정원 1명 올리기"/);
  assert.match(pageSource, /aria-label="정원 1명 내리기"/);
  assert.match(pageSource, /field\.name === "capacity"/);
});

test("class roster uses explicit enrollment wording", async () => {
  assert.match(pageSource, /renderRelationList\("수강 학생", classEnrolledStudentIds, "수강"\)/);
  assert.match(pageSource, /kind === "classes" && modeLabel === "수강" \? "수강 해제"/);
});
```

- [ ] **Step 2: Run the focused contract test and verify RED**

Run `node --test --experimental-strip-types tests/management-class-student-roster.test.mjs`.

Expected: FAIL because the capacity component and new copy do not exist.

- [ ] **Step 3: Implement capacity stepper and copy**

`ClassCapacityInput` uses `type="text"`, `inputMode="numeric"`, digit-only normalization, a minimum of zero, and `ChevronUp`/`ChevronDown` buttons in the same `grid w-8 shrink-0 border-l` container as tuition.

Render it before the generic field branch:

```tsx
{kind === "classes" && field.name === "capacity" ? (
  <ClassCapacityInput
    id={id}
    name={field.name}
    value={value}
    disabled={!canMutateRows}
    onChange={(nextValue) => handleEditableFieldChange(field.name, nextValue)}
  />
) : kind === "classes" && field.name === "fee" ? (
```

Change the class roster title to `수강 학생` and use `수강 해제` for enrolled class-roster rows and `대기 해제` for class waitlist rows.

- [ ] **Step 4: Run the focused contract test and verify GREEN**

Expected: PASS with no console warnings.

---

### Task 3: Shared labelled filter surfaces and textbook metadata

**Files:**
- Create: `src/features/management/picker-filter-surface.tsx`
- Modify: `src/features/management/class-textbook-picker.tsx`
- Modify: `src/features/management/management-page.tsx`
- Modify: `tests/management-class-student-roster.test.mjs`
- Modify: `tests/student-class-picker-model.test.mjs`

**Interfaces:**
- Produces: `PickerFilterSurface({ children })` and `PickerFilterField({ label, children })`.
- Consumes: the existing `Select` controls and picker model filter state.

- [ ] **Step 1: Add failing source-contract tests**

```js
test("management pickers use persistent labelled filter fields", async () => {
  assert.match(pageSource, /<PickerFilterSurface>/);
  assert.match(pageSource, /<PickerFilterField label="과목">/);
  assert.match(pageSource, /<PickerFilterField label="학년">/);
  assert.match(pageSource, /<PickerFilterField label="학교">/);
});

test("textbook picker removes publisher metadata", async () => {
  assert.match(pickerSource, /<PickerFilterField label="세부과목">/);
  assert.doesNotMatch(candidateBlock, /key: "publisher"/);
});
```

- [ ] **Step 2: Run focused picker tests and verify RED**

Run:

```bash
node --test --experimental-strip-types \
  tests/management-class-student-roster.test.mjs \
  tests/student-class-picker-model.test.mjs
```

Expected: FAIL because the shared filter components are absent and publisher is still rendered.

- [ ] **Step 3: Implement the shared compact filter surface**

```tsx
export function PickerFilterSurface({ children }: PropsWithChildren) {
  return <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-2">{children}</div>;
}

export function PickerFilterField({ label, children }: PropsWithChildren<{ label: string }>) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="px-0.5 text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
```

Use borderless white/background select triggers inside this surface. Keep filter order exactly as approved in the design.

- [ ] **Step 4: Remove publisher pill and preserve publisher search**

Delete only `{ key: "publisher", value: textbook.publisher }` from textbook candidate metadata. Keep `textbook.publisher` in the picker search model and the search placeholder.

- [ ] **Step 5: Run focused picker tests and verify GREEN**

Expected: all focused picker tests PASS and existing default-grade model assertions remain unchanged.

---

### Task 4: Full verification and browser QA

**Files:**
- Modify only if verification reveals a regression in the files above.

**Interfaces:**
- Consumes: all outputs from Tasks 1-3.
- Produces: verified class and student management behavior.

- [ ] **Step 1: Run focused tests**

```bash
node --test --experimental-strip-types \
  tests/class-schedule-slots.test.mjs \
  tests/class-textbook-picker-model.test.mjs \
  tests/student-class-picker-model.test.mjs \
  tests/management-class-student-roster.test.mjs \
  tests/management-student-detail-selects.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 2: Run TypeScript and targeted ESLint**

```bash
pnpm exec tsc --noEmit
pnpm exec eslint \
  src/features/management/class-schedule-slots.ts \
  src/features/management/picker-filter-surface.tsx \
  src/features/management/picker-meta-pills.tsx \
  src/features/management/class-textbook-picker.tsx \
  src/features/management/student-class-picker-model.ts \
  src/features/management/management-page.tsx
```

Expected: exit code 0.

- [ ] **Step 3: Run production build**

```bash
pnpm build
```

Expected: Next.js production build exits 0.

- [ ] **Step 4: Verify rendered behavior**

Open class `c53586ad-2f55-4122-b78c-9e1868b54620` and confirm separate Tuesday and Thursday rows. Open a `월수금` class and confirm three rows. Verify capacity buttons, labelled filter surfaces, publisher-pill removal, compact student-class schedule, `수강 학생`, and `수강 해제`.

- [ ] **Step 5: Review the final diff and commit implementation files**

Run `git diff --check`, confirm no unrelated changes were overwritten, then stage only the management implementation/tests and commit with:

```bash
git commit -m "fix: restore class schedules and polish pickers"
```
