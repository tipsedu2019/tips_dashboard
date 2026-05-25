import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("calendar day add action is keyboard visible and large enough to click", async () => {
  const source = await readFile(
    new URL("src/app/admin/calendar/components/calendar-main.tsx", root),
    "utf8",
  );

  assert.match(source, /aria-label=\{`\$\{format\(day, "M월 d일", \{ locale: ko \}\)\} 일정 추가`\}/);
  assert.match(source, /inline-flex size-7/);
  assert.match(source, /<Plus className="size-3\.5" aria-hidden="true" \/>/);
  assert.match(source, /focus-visible:opacity-100/);
  assert.match(source, /focus-visible:ring-2 focus-visible:ring-ring/);
  assert.match(source, /hover:bg-background hover:text-foreground/);
  assert.match(source, /DialogDescription/);
  assert.match(source, /선택한 날짜의 학사 일정을 확인하고 이동합니다\./);
});

test("academic calendar search is named and keyboard ready", async () => {
  const source = await readFile(
    new URL("src/app/admin/calendar/components/calendar-main.tsx", root),
    "utf8",
  );

  assert.match(source, /role="search" aria-label="학사일정 검색"/);
  assert.match(source, /type="search"/);
  assert.match(source, /aria-label="학사일정 검색"/);
  assert.match(source, /autoComplete="off"/);
  assert.match(source, /enterKeyHint="search"/);
});

test("academic calendar month view switches to readable mobile agenda cards", async () => {
  const source = await readFile(
    new URL("src/app/admin/calendar/components/calendar-main.tsx", root),
    "utf8",
  );

  assert.match(source, /data-testid="academic-calendar-mobile-month-agenda"/);
  assert.match(source, /className="grid gap-2 p-4 md:hidden"/);
  assert.match(source, /const mobileMonthEventGroups = useMemo/);
  assert.match(source, /listEventGroups\.filter\(\(group\) => isSameMonth\(group\.date, currentDate\)\)/);
  assert.match(source, /mobileMonthEventGroups\.map\(\(group\) => \(/);
  assert.match(source, /data-testid=\{`academic-calendar-mobile-day-\$\{format\(group\.date, "yyyy-MM-dd"\)\}`\}/);
  assert.match(source, /formatAgendaDay\(group\.date\)/);
  assert.match(source, /formatEventRange\(event\)/);
  assert.match(source, /className="hidden flex-1 bg-background md:block"/);
});

test("shared date picker defaults to Korean calendar labels", async () => {
  const source = await readFile(
    new URL("src/components/ui/calendar.tsx", root),
    "utf8",
  );

  assert.match(source, /from "date-fns\/locale"/);
  assert.match(source, /locale=\{ko\}/);
  assert.match(source, /toLocaleString\("ko-KR", \{ month: "short" \}\)/);
  assert.match(source, /labelNav: \(\) => "달력 월 이동"/);
  assert.match(source, /labelGrid: \(date\) => `\$\{date\.getFullYear\(\)\}년 \$\{date\.getMonth\(\) \+ 1\}월 달력`/);
  assert.match(source, /labelPrevious: \(\) => "이전 달로 이동"/);
  assert.match(source, /labelNext: \(\) => "다음 달로 이동"/);
  assert.match(source, /\.\.\.labels/);
});

test("academic event form normalizes dependent fields in change handlers", async () => {
  const source = await readFile(
    new URL("src/app/admin/calendar/components/event-form.tsx", root),
    "utf8",
  );

  assert.match(source, /DialogDescription/);
  assert.match(source, /<DialogDescription className="sr-only">학사 일정 정보를 입력하고 저장합니다\.<\/DialogDescription>/);
  assert.match(source, /const handleSchoolChange = \(schoolId: string\) =>/);
  assert.match(source, /onValueChange=\{handleSchoolChange\}/);
  assert.match(source, /const handleGradeToggle = \(grade: string\) =>/);
  assert.match(source, /onCheckedChange=\{\(\) => handleGradeToggle\(option\.value\)\}/);
  assert.match(source, /const nextGrades = currentGrades\.filter/);
  assert.match(source, /grade: serializeGradeSelection\(nextGrades\)/);
  assert.match(source, /const nextGradeValue = serializeGradeSelection\(nextGrades\)/);
  assert.match(source, /getSchoolOptionsForGrade\(nextGradeValue, schoolOptions\)\.some/);
  assert.match(source, /schoolId:[\s\S]*\? prev\.schoolId[\s\S]*: ""/);
  assert.doesNotMatch(source, /if \(selectedSchool\) \{\s*const allowedGrades[\s\S]*setFormData\(\(prev\) => \(\{ \.\.\.prev, grade: normalizedNext \}\)\)/);
  assert.doesNotMatch(source, /useEffect\(\(\) => \{[\s\S]*setFormData/);
});

test("academic event form keeps date ranges valid while editing", async () => {
  const source = await readFile(
    new URL("src/app/admin/calendar/components/event-form.tsx", root),
    "utf8",
  );

  assert.match(source, /const handleStartDateChange = \(date: string\) =>/);
  assert.match(source, /endDate: !prev\.endDate \|\| prev\.endDate === prev\.date \|\| prev\.endDate < date \? date : prev\.endDate/);
  assert.match(source, /const handleEndDateChange = \(endDate: string\) =>/);
  assert.match(source, /onChange=\{\(event\) => handleStartDateChange\(event\.target\.value\)\}/);
  assert.match(source, /min=\{formData\.date \|\| undefined\}/);
  assert.match(source, /onChange=\{\(event\) => handleEndDateChange\(event\.target\.value\)\}/);
  assert.match(source, /if \(nextEndDate < nextDate\)/);
});
