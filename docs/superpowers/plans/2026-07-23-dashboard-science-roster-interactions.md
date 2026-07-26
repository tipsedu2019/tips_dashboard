# Dashboard Science Statistics and Student Roster Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent science dashboard statistics, click-anchored student roster popovers, collapsed-by-default class groups, and targeted outer-border cleanup.

**Architecture:** Extend the existing dashboard metrics projection so each lowest-level distribution row and class summary carries a sorted, deduplicated student roster. Keep all interaction rendering inside `section-cards.tsx`, reuse the existing Radix Popover primitive, and change only local dashboard Card classes and disclosure state.

**Tech Stack:** Next.js 16, React 19, TypeScript/JavaScript, Tailwind CSS, Radix UI Popover, Node test runner.

## Global Constraints

- Do not add a DB table, RPC, API route, or extra browser-side student fetch.
- Preserve `studentCount` as unique students and `enrollmentCount` as enrollment records.
- Show only student name, school, and grade; do not expose contacts or counseling data.
- Keep the top filter border, KPI border/dividers, and internal panel separators.
- Remove only the outer borders of the Student Distribution and Class Operations Cards.
- Keep science selectable for every division; empty combinations use existing zero/empty states.
- Start every class-operations group closed, including after group-mode, subject, or division changes.
- Follow RED → GREEN for every production-code change.

---

### Task 1: Science buckets and roster data projection

**Files:**
- Modify: `tests/dashboard-metrics.test.mjs`
- Modify: `src/features/dashboard/metrics.js`

**Interfaces:**
- Consumes: existing `buildDashboardMetrics({ classes, students })`, class `student_ids`, and student `id`, `name`, `school`, `grade`.
- Produces: `studentRoster: Array<{ id: string, name: string, school: string, grade: string }>` on every `BreakdownRow` and `ClassSummaryRow`; `analyticsBySubject.science`; `analyticsByView.science`.

- [ ] **Step 1: Write the failing metrics test**

Append this focused test to `tests/dashboard-metrics.test.mjs`:

```js
test("builds independent science buckets and sorted dashboard rosters", () => {
  const metrics = buildDashboardMetrics({
    classes: [
      {
        id: "science-high-1",
        name: "고1 통합과학2",
        subject: "science",
        grade: "고1",
        status: "수업 진행 중",
        teacher: "김과학",
        classroom: "별관 4강",
        student_ids: ["student-2", "student-1", "student-2"],
      },
      {
        id: "english-high-1",
        name: "고1 영어",
        subject: "english",
        grade: "고1",
        status: "수업 진행 중",
        student_ids: ["student-3"],
      },
    ],
    students: [
      { id: "student-1", name: "가학생", school: "대기고", grade: "고1" },
      { id: "student-2", name: "나학생", school: "대기고", grade: "고1" },
      { id: "student-3", name: "영학생", school: "중앙여고", grade: "고1" },
    ],
  });

  const science = metrics.analyticsByView.science.high;
  assert.equal(science.summary.activeClassesCount, 1);
  assert.equal(science.summary.uniqueRegisteredStudentCount, 2);
  assert.deepEqual(
    science.studentBreakdowns.byGrade[0].schools[0].studentRoster,
    [
      { id: "student-1", name: "가학생", school: "대기고", grade: "고1" },
      { id: "student-2", name: "나학생", school: "대기고", grade: "고1" },
    ],
  );
  assert.deepEqual(
    science.studentBreakdowns.bySchool[0].grades[0].studentRoster.map((student) => student.name),
    ["가학생", "나학생"],
  );
  assert.deepEqual(
    science.classBreakdowns.byGrade[0].classSummaries[0].studentRoster.map((student) => student.name),
    ["가학생", "나학생"],
  );
  assert.equal(metrics.analyticsByView.english.high.summary.activeClassesCount, 1);
});
```

- [ ] **Step 2: Run the metrics test and verify RED**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-metrics.test.mjs
```

Expected: FAIL because `analyticsByView.science` or `studentRoster` is missing.

- [ ] **Step 3: Add the science filter and roster helper**

In `src/features/dashboard/metrics.js`, add the science filter:

```js
const DASHBOARD_SUBJECT_FILTERS = [
  { key: "all", label: "전체", subject: "" },
  { key: "english", label: "영어", subject: "영어" },
  { key: "math", label: "수학", subject: "수학" },
  { key: "science", label: "과학", subject: "과학" },
];
```

Add a dashboard-specific roster projector beside `studentNamesFromIds`:

```js
function dashboardStudentRosterFromIds(ids = [], studentsById = new Map()) {
  return unique(ids.map((studentId) => text(studentId)))
    .filter(Boolean)
    .map((id) => {
      const student = studentsById.get(id);
      return {
        id,
        name: text(student?.name) || "학생 정보 확인 필요",
        school: text(student?.school),
        grade: text(student?.grade),
      };
    })
    .sort((left, right) => (
      left.name.localeCompare(right.name, "ko", { numeric: true }) ||
      left.id.localeCompare(right.id, "ko", { numeric: true })
    ));
}
```

- [ ] **Step 4: Preserve rosters when finalizing student breakdowns**

Change the student-breakdown finalizer signature and projection:

```js
function finalizeBreakdown(
  map,
  { order = "enrollment-asc", studentsById = new Map() } = {},
) {
  return [...map.entries()]
    .map(([label, payload]) => ({
      label,
      enrollmentCount: payload.enrollmentCount,
      studentCount: payload.studentIds.size,
      studentRoster: dashboardStudentRosterFromIds([...payload.studentIds], studentsById),
    }))
    .sort((left, right) => {
      if (order === "student-desc") {
        return (
          right.studentCount - left.studentCount ||
          right.enrollmentCount - left.enrollmentCount ||
          left.label.localeCompare(right.label, "ko", { numeric: true })
        );
      }

      return (
        left.enrollmentCount - right.enrollmentCount ||
        left.studentCount - right.studentCount ||
        left.label.localeCompare(right.label, "ko", { numeric: true })
      );
    });
}
```

Pass `studentsById` to every `finalizeBreakdown` call in `buildStudentBreakdowns`, including the nested school-by-grade and grade-by-school calls.

- [ ] **Step 5: Preserve rosters in class summaries**

Change the class-summary helper:

```js
function buildDashboardClassSummary(classItem = {}, studentIds = [], studentsById = new Map()) {
  const weeklyMinutes = getWeeklyMinutesForClass(classItem);

  return {
    id: text(classItem.id) || classFullNameOf(classItem),
    title: classNameOf(classItem),
    subject: text(classItem.subject) || "미정",
    scheduleLabel: text(classItem.schedule) || "시간 미정",
    teacherLabel: splitTeacherList(
      classItem.teacher || classItem.teacher_name || classItem.teacherName,
    ).join(", ") || "미정",
    classroomLabel: splitClassroomList(classItem.classroom || classItem.room).join(", ") || "미정",
    studentCount: unique(studentIds).length,
    enrollmentCount: studentIds.length,
    studentRoster: dashboardStudentRosterFromIds(studentIds, studentsById),
    weeklyMinutes,
    weeklyHoursLabel: formatDashboardHours(weeklyMinutes),
  };
}
```

Pass `studentsById` to the full-class, grade-scoped, and school-scoped `buildDashboardClassSummary` calls in `buildClassBreakdowns`.

- [ ] **Step 6: Run the metrics test and verify GREEN**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-metrics.test.mjs
```

Expected: all tests pass with zero failures.

- [ ] **Step 7: Commit the metrics unit**

```bash
git add tests/dashboard-metrics.test.mjs src/features/dashboard/metrics.js
git commit -m "feat: add science dashboard roster metrics"
```

If the execution sandbox keeps `.git` read-only, do not broaden the staged scope; report the commit as blocked and continue with the verified working-tree changes.

---

### Task 2: Science filter, roster Popovers, collapsed groups, and border cleanup

**Files:**
- Modify: `tests/admin-shell.test.mjs`
- Modify: `src/app/admin/dashboard/components/section-cards.tsx`

**Interfaces:**
- Consumes: `studentRoster` from Task 1 on distribution rows and class summaries.
- Produces: science filter UI, `StudentRosterPopover`, click targets on leaf rows, all-closed disclosure state, and two borderless outer Cards.

- [ ] **Step 1: Write the failing UI source-contract test**

Extend the existing dashboard subject/division test in `tests/admin-shell.test.mjs` with:

```js
assert.match(source, /\{ key: "science", label: "과학" \}/);
assert.match(source, /type DashboardSubjectKey = "all" \| "english" \| "math" \| "science"/);
assert.match(source, /function StudentRosterPopover/);
assert.match(source, /PopoverTrigger asChild/);
assert.match(source, /studentRoster/);
assert.match(source, /학생 명단 보기/);
assert.match(source, /max-h-64 overflow-y-auto overscroll-contain/);
assert.match(source, /useState<Set<string>>\(\(\) => new Set\(\)\)/);
assert.doesNotMatch(source, /defaultOpenGroupKey/);
assert.doesNotMatch(source, /nextDefaultOpenKey/);
assert.match(source, /<Card className="min-w-0 gap-4 rounded-xl border-0 py-4 shadow-none">/);
```

Remove the existing assertions that require `defaultOpenGroupKey` and the first group to be inserted into `openGroupKeys`.

- [ ] **Step 2: Run the UI contract test and verify RED**

Run:

```bash
node --test --experimental-strip-types tests/admin-shell.test.mjs
```

Expected: FAIL because science UI, roster Popovers, closed defaults, and `border-0` are missing.

- [ ] **Step 3: Extend dashboard UI types and subject matching**

Update imports and types in `section-cards.tsx`:

```tsx
import { type ReactElement, type ReactNode, useMemo, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

type DashboardSubjectKey = "all" | "english" | "math" | "science"

type DashboardStudentRef = {
  id: string
  name: string
  school: string
  grade: string
}
```

Add `studentRoster?: DashboardStudentRef[]` to `BreakdownRow` and `ClassSummaryRow`. Add the science tab:

```tsx
const SUBJECT_TABS: Array<{ key: DashboardSubjectKey; label: string }> = [
  { key: "all", label: "전체" },
  { key: "english", label: "영어" },
  { key: "math", label: "수학" },
  { key: "science", label: "과학" },
]
```

Make subject matching explicit:

```tsx
function matchesSubject(subject: string | undefined, subjectKey: DashboardSubjectKey) {
  if (subjectKey === "all") return true
  const normalized = normalizeText(subject)
  if (subjectKey === "english") return normalized.includes("영어") || normalized.includes("english")
  if (subjectKey === "math") return normalized.includes("수학") || normalized.includes("math")
  return normalized.includes("과학") || normalized.includes("science")
}
```

- [ ] **Step 4: Add the shared roster Popover**

Add this component near the existing small dashboard controls:

```tsx
function StudentRosterPopover({
  label,
  roster,
  children,
}: {
  label: string
  roster: DashboardStudentRef[]
  children: ReactElement
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[min(18rem,calc(100vw-2rem))] rounded-lg p-0 shadow-lg"
      >
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
          <div className="min-w-0 truncate text-sm font-semibold">{label}</div>
          <Badge variant="secondary" className="h-5 shrink-0 rounded-full px-2 text-[11px]">
            {formatNumber(roster.length)}명
          </Badge>
        </div>
        <div className="max-h-64 overflow-y-auto overscroll-contain p-2">
          {roster.length > 0 ? (
            <div className="grid gap-1">
              {roster.map((student) => {
                const meta = [student.school, student.grade].filter(Boolean).join(" · ")
                return (
                  <div key={student.id} className="rounded-md px-2 py-1.5 hover:bg-muted/70">
                    <div className="text-sm font-medium leading-5">{student.name}</div>
                    {meta ? <div className="text-xs text-muted-foreground">{meta}</div> : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="px-2 py-5 text-center text-sm text-muted-foreground">
              표시할 학생이 없습니다.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 5: Wrap lowest-level distribution rows**

Replace the school-under-grade leaf block with:

```tsx
{schoolRowsForGrade.map((school) => {
  const schoolValue = getValue(school)

  return (
    <div key={school.label} role="listitem">
      <StudentRosterPopover
        label={`${row.label} · ${school.label} 학생`}
        roster={school.studentRoster || []}
      >
        <button
          type="button"
          aria-label={`${row.label} ${school.label} 학생 명단 보기`}
          className={cn(
            DISTRIBUTION_ROW_CLASS,
            "w-full rounded-md text-left text-xs transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
        >
          <span className="truncate pl-5 font-medium text-muted-foreground">{school.label}</span>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <AnimatedBar percent={getBarScale(schoolValue, gradeMax, 4)} className="bg-primary/65" />
          </div>
          <span className="text-right tabular-nums">{formatNumber(schoolValue)}{unit}</span>
        </button>
      </StudentRosterPopover>
    </div>
  )
})}
```

Replace the grade-under-school leaf block with:

```tsx
{gradeRowsForSchool.map((grade) => {
  const gradeValue = getValue(grade)

  return (
    <div key={grade.label} role="listitem">
      <StudentRosterPopover
        label={`${row.label} · ${grade.label} 학생`}
        roster={grade.studentRoster || []}
      >
        <button
          type="button"
          aria-label={`${row.label} ${grade.label} 학생 명단 보기`}
          className={cn(
            DISTRIBUTION_ROW_CLASS,
            "w-full rounded-md text-left text-xs transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
        >
          <span className="truncate pl-5 font-medium text-muted-foreground">{grade.label}</span>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <AnimatedBar percent={getBarScale(gradeValue, schoolMax, 4)} className="bg-primary/65" />
          </div>
          <span className="text-right tabular-nums">{formatNumber(gradeValue)}{unit}</span>
        </button>
      </StudentRosterPopover>
    </div>
  )
})}
```

- [ ] **Step 6: Wrap each individual class row**

Replace the individual-class map with:

```tsx
{classRows.map((classItem) => (
  <div key={classItem.id} role="listitem">
    <StudentRosterPopover
      label={`${classItem.title} 학생`}
      roster={classItem.studentRoster || []}
    >
      <button
        type="button"
        aria-label={`${classItem.title} 학생 명단 보기`}
        className="w-full min-w-0 border-l-2 border-l-primary/35 bg-background px-3 py-2 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
          <Badge variant="outline" className="bg-primary/5 text-primary">{classItem.subject}</Badge>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="min-w-0 max-w-full text-sm font-semibold leading-5">{classItem.title}</span>
            {splitBadgeLabels(classItem.teacherLabel).map((label) => (
              <Badge
                key={`teacher:${classItem.id}:${label}`}
                variant="outline"
                className="min-w-0 max-w-full shrink justify-start !overflow-visible !whitespace-normal break-keep bg-background px-1.5 text-[11px] font-medium leading-4 text-muted-foreground"
              >
                {label}
              </Badge>
            ))}
            {splitBadgeLabels(classItem.classroomLabel).map((label) => (
              <Badge
                key={`classroom:${classItem.id}:${label}`}
                variant="outline"
                className="min-w-0 max-w-full shrink justify-start !overflow-visible !whitespace-normal break-keep bg-background px-1.5 text-[11px] font-medium leading-4 text-muted-foreground"
              >
                {label}
              </Badge>
            ))}
          </div>
          <span className="col-start-2 grid justify-items-start gap-0.5 text-xs font-medium tabular-nums text-muted-foreground sm:col-start-3 sm:justify-items-end">
            <span>{formatWeeklyHoursLabel(classItem.weeklyHoursLabel)}</span>
            <span>{formatNumber(classItem.studentCount)}명</span>
          </span>
        </div>
      </button>
    </StudentRosterPopover>
  </div>
))}
```

- [ ] **Step 7: Remove automatic opening and the two outer borders**

Use an empty disclosure set and a mode change that does not open a row:

```tsx
const [openGroupKeys, setOpenGroupKeys] = useState<Set<string>>(() => new Set())

const changeGroupMode = (nextMode: ClassOperationGroupMode) => {
  setGroupMode(nextMode)
}
```

Delete `defaultOpenGroupKey`, `nextPrefix`, and `nextDefaultOpenKey`. Change only the two panel Card class names:

```tsx
<Card className="min-w-0 gap-4 rounded-xl border-0 py-4 shadow-none">
```

Do not change the header, inner list, row, filter, or KPI border classes.

- [ ] **Step 8: Run the UI contract test and verify GREEN**

Run:

```bash
node --test --experimental-strip-types tests/admin-shell.test.mjs
```

Expected: all tests pass with zero failures.

- [ ] **Step 9: Run both focused suites together**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-metrics.test.mjs tests/admin-shell.test.mjs
```

Expected: all tests pass with zero failures.

- [ ] **Step 10: Commit the interaction unit**

```bash
git add tests/admin-shell.test.mjs src/app/admin/dashboard/components/section-cards.tsx
git commit -m "feat: add dashboard roster interactions"
```

If the execution sandbox keeps `.git` read-only, report the commit as blocked without staging unrelated worktree changes.

---

### Task 3: Static verification, build, local restart, and browser QA

**Files:**
- Verify: `src/features/dashboard/metrics.js`
- Verify: `src/app/admin/dashboard/components/section-cards.tsx`
- Verify: `tests/dashboard-metrics.test.mjs`
- Verify: `tests/admin-shell.test.mjs`

**Interfaces:**
- Consumes: verified Task 1 metrics and Task 2 UI.
- Produces: fresh test, lint, build, server, and browser evidence for the complete request.

- [ ] **Step 1: Check patch hygiene**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 2: Run focused tests**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-metrics.test.mjs tests/admin-shell.test.mjs
```

Expected: all tests pass with zero failures.

- [ ] **Step 3: Run focused lint**

Run:

```bash
pnpm exec eslint src/features/dashboard/metrics.js src/app/admin/dashboard/components/section-cards.tsx tests/dashboard-metrics.test.mjs tests/admin-shell.test.mjs
```

Expected: exit code 0 with no errors.

- [ ] **Step 4: Build the application**

Run:

```bash
pnpm build
```

Expected: `next build --webpack` exits 0.

- [ ] **Step 5: Restart port 3000 with the fresh production build**

Resolve the exact PID listening on port 3000, confirm its cwd is this repository, stop only that process, and start `pnpm start -- --port 3000` from `/Users/hyunjun/Documents/Codex/tips_dashboard`. Preserve the server output for diagnosis.

- [ ] **Step 6: Verify the dashboard in the in-app browser**

At `http://localhost:3000/admin/dashboard` verify:

1. Subject tabs show `전체`, `영어`, `수학`, `과학`.
2. Selecting `과학` changes KPI and both distribution panels without mixing English or math data.
3. Class Operations starts with every grade group closed.
4. Changing to teacher and classroom modes still starts with every group closed.
5. Opening a group and clicking an individual class opens a roster Popover with name, school, and grade.
6. Expanding a Student Distribution parent and clicking its lowest-level row opens the same roster pattern.
7. `Esc` and outside click close each Popover.
8. Long rosters scroll inside the Popover.
9. Student Distribution and Class Operations have no outer Card border while top filter, KPI, and internal separators remain.
10. Desktop and a narrow mobile viewport preserve readable content and reachable triggers.

- [ ] **Step 7: Record the final status**

Report separately:

- source changes,
- focused test results,
- lint result,
- build result,
- port 3000 restart result,
- browser QA result,
- `.git` staging/commit availability.
