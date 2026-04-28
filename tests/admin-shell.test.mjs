import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

test("sidebar defaults to icon collapse mode", async () => {
  const source = await readSource("src/contexts/sidebar-context.tsx");

  assert.match(source, /collapsible:\s*"icon"/);
});

test("nav user renders a profile avatar instead of the cart logo", async () => {
  const source = await readSource("src/components/nav-user.tsx");

  assert.match(source, /AvatarImage/);
  assert.doesNotMatch(source, /<\s*Logo\b/);
});

test("root metadata points browser icons at the favicon asset", async () => {
  const source = await readSource("src/app/layout.tsx");

  assert.match(source, /icons:\s*\{/);
  assert.match(source, /favicon-window\.png/);
  assert.match(source, /shortcut:\s*"\/favicon-window\.png"/);
});

test("favicon asset matches the official TIPS logo", async () => {
  const [favicon, darkFavicon, logo, windowFavicon] = await Promise.all([
    readFile(new URL("public/favicon.png", root)),
    readFile(new URL("public/favicon-dark.png", root)),
    readFile(new URL("public/logo_tips.png", root)),
    readFile(new URL("public/favicon-window.png", root)),
  ]);

  assert.equal(favicon.equals(logo), true);
  assert.equal(darkFavicon.equals(logo), true);
  assert.ok(windowFavicon.byteLength > 0);
});

test("dashboard omits introductory briefing copy and redundant workspace heading", async () => {
  const source = await readSource("src/app/admin/dashboard/page.tsx");

  assert.doesNotMatch(source, /오늘의 운영 브리핑/);
  assert.doesNotMatch(source, /오늘의 운영 포인트/);
  assert.doesNotMatch(source, /현재 운영 스냅샷/);
  assert.doesNotMatch(source, /운영 워크스페이스 바로가기/);
});

test("dashboard focuses on student, enrollment, class, and conflict signals", async () => {
  const source = await readSource("src/app/admin/dashboard/components/section-cards.tsx");

  assert.match(source, /학생수 \(인원 기준\)/);
  assert.match(source, /학생수 \(수강 기준\)/);
  assert.match(source, /학생수 \(수강 기준\) \/ 운영 수업/);
  assert.match(source, /UserCheck/);
  assert.match(source, /운영 수업/);
  assert.doesNotMatch(source, /수업당 학생수/);
  assert.doesNotMatch(source, /인원 기준 · 수강 기준/);
  assert.match(source, /waitlistEnrollmentCount\)}명/);
  assert.match(source, /일정 충돌/);
  assert.match(source, /classSummaries/);
  assert.match(source, /scheduleLabel/);
  assert.match(source, /teacherLabel/);
  assert.match(source, /classroomLabel/);
  assert.match(source, /aria-expanded/);
  assert.doesNotMatch(source, /재원 학생/);
  assert.doesNotMatch(source, /수강 등록/);
  assert.doesNotMatch(source, /학교\/학년/);
  assert.doesNotMatch(source, /이번 주 핵심 흐름/);
  assert.doesNotMatch(source, /이번 주 ·/);
  assert.doesNotMatch(source, /교재/);
  assert.doesNotMatch(source, /진도/);
  assert.doesNotMatch(source, /선생/);
  assert.doesNotMatch(source, /교사/);
  assert.doesNotMatch(source, /강의실/);
  assert.doesNotMatch(source, /subjectRows/);
  assert.doesNotMatch(source, /normalCount/);
  assert.doesNotMatch(source, /CheckCircle2/);
  assert.doesNotMatch(source, /SearchCheck/);
});

test("dashboard exposes subject and division tabs with conflict process rows", async () => {
  const source = await readSource("src/app/admin/dashboard/components/section-cards.tsx");

  assert.match(source, /SUBJECT_TABS/);
  assert.match(source, /DIVISION_TABS/);
  assert.match(source, /\{ key: "all", label: "전체" \}/);
  assert.match(source, /초중등부/);
  assert.match(source, /고등부/);
  assert.match(source, /bg-primary text-primary-foreground/);
  assert.match(source, /AnimatedBar/);
  assert.match(source, /const unit = "명"/);
  assert.doesNotMatch(source, /basis === "students" \? "명" : "건"/);
  assert.match(source, /더 보기/);
  assert.match(source, /label="Who"/);
  assert.match(source, /본과목 수업일/);
  assert.match(source, /타과목 시험일 전날/);
  assert.match(source, /본과목 시험일/);
  assert.doesNotMatch(source, /Who·When·Where/);
  assert.doesNotMatch(source, /등록 명단 기준/);
  assert.match(source, /타과목 시험일 전날에는 수업을 진행하지 않습니다/);
  assert.match(source, /본과목 시험일 당일에는 수업을 진행하지 않습니다/);
  assert.doesNotMatch(source, /해당 과목 시험일 당일에는 수업을 진행하지 않습니다/);
  assert.doesNotMatch(source, /시험\/수업 충돌/);
  assert.doesNotMatch(source, /수업: /);
  assert.match(source, /slice\(0, 3\)/);
  assert.match(source, /<ConflictBoard rows=\{conflictRows\} \/>[\s\S]*<div className="grid gap-4/);
  assert.doesNotMatch(source, /slice\(0, 4\)/);
  assert.doesNotMatch(source, /bucket\.classBreakdowns\?\.byGrade \|\| \[\]\)\.slice\(0, 5\)/);
});

test("dashboard keeps dense cards readable on mobile widths", async () => {
  const [source, pageSource] = await Promise.all([
    readSource("src/app/admin/dashboard/components/section-cards.tsx"),
    readSource("src/app/admin/dashboard/page.tsx"),
  ]);

  assert.match(source, /DISTRIBUTION_ROW_CLASS/);
  assert.match(source, /grid-cols-\[minmax\(3\.75rem,5\.25rem\)_minmax\(0,1fr\)_3\.25rem\]/);
  assert.match(source, /CLASS_OPERATION_ROW_CLASS/);
  assert.match(source, /grid-cols-\[3\.25rem_minmax\(0,1fr\)_3\.75rem\]/);
  assert.match(source, /has-data-\[slot=card-action\]:grid-cols-1/);
  assert.match(source, /sm:has-data-\[slot=card-action\]:grid-cols-\[1fr_auto\]/);
  assert.match(source, /grid grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
  assert.match(source, /sm:grid-cols-2/);
  assert.match(source, /truncate text-sm font-semibold/);
  assert.match(pageSource, /px-3 pb-5 sm:px-4 sm:pb-6 lg:px-6/);
});

test("lesson-design routes resolve to the actual design workspace title", async () => {
  const source = await readSource("src/lib/navigation.ts");

  assert.match(source, /match: "\/admin\/curriculum\/lesson-design"/);
  assert.match(source, /match: "\/admin\/class-schedule\/lesson-design"/);
  assert.match(source, /title: "수업 설계"/);
});

test("quick search trigger shows Ctrl + K", async () => {
  const source = await readSource("src/components/command-search.tsx");

  assert.match(source, /QUICK_SEARCH_SHORTCUT_LABEL = "Ctrl \+ K"/);
});

test("public site links use the homepage label consistently", async () => {
  const [headerSource, navigationSource, classScheduleSource] = await Promise.all([
    readSource("src/components/site-header.tsx"),
    readSource("src/lib/navigation.ts"),
    readSource("src/features/operations/class-schedule-workspace.tsx"),
  ]);

  assert.match(headerSource, /홈페이지 확인/);
  assert.doesNotMatch(navigationSource, /홈페이지 확인/);
  assert.match(classScheduleSource, /홈페이지 확인/);

  assert.doesNotMatch(headerSource, /수업 소개 확인/);
  assert.doesNotMatch(navigationSource, /수업 소개 확인/);
  assert.doesNotMatch(classScheduleSource, /수업 소개 확인/);
});
