import test from "node:test";
import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

async function listFiles(pathname) {
  const directory = new URL(pathname, root);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const childPathname = `${pathname}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await listFiles(childPathname));
    } else {
      files.push(childPathname);
    }
  }

  return files;
}

async function pathExists(pathname) {
  try {
    await access(new URL(pathname, root));
    return true;
  } catch {
    return false;
  }
}

test("sidebar defaults to icon collapse mode", async () => {
  const source = await readSource("src/contexts/sidebar-context.tsx");

  assert.match(source, /collapsible:\s*"icon"/);
});

test("nav user renders a profile avatar instead of the cart logo", async () => {
  const source = await readSource("src/components/nav-user.tsx");

  assert.match(source, /AvatarImage/);
  assert.match(source, /nameLetters\.slice\(1\)\.join\(""\)/);
  assert.doesNotMatch(source, /<\s*Logo\b/);
});

test("nav user lets signed-in users edit avatar and password", async () => {
  const [navUserSource, appSidebarSource, avatarSource] = await Promise.all([
    readSource("src/components/nav-user.tsx"),
    readSource("src/components/app-sidebar.tsx"),
    readSource("src/lib/profile-avatars.ts"),
  ]);

  assert.match(navUserSource, /프로필 설정/);
  assert.match(navUserSource, /supabase\.auth\.updateUser/);
  assert.match(navUserSource, /<DialogDescription className="sr-only">/);
  assert.match(navUserSource, /새 비밀번호/);
  assert.match(navUserSource, /visibleProfileAvatarPresets\.map/);
  assert.doesNotMatch(navUserSource, /노션 스타일 얼굴/);
  assert.match(appSidebarSource, /userMetadata\.avatar_url[\s\S]*userMetadata\.picture[\s\S]*profileFields\.avatar_url/);
  assert.match(avatarSource, /Array\.from\(\{ length: 50 \}/);
  assert.match(avatarSource, /notion-face-/);
  assert.match(avatarSource, /renderFaceAvatar/);
  assert.match(avatarSource, /faceShapes/);
  assert.doesNotMatch(avatarSource, /notion-character-/);
  assert.doesNotMatch(avatarSource, /outfitBodies/);
  assert.doesNotMatch(avatarSource, /renderProp/);
});

test("sidebar keeps fallback permission status compact", async () => {
  const source = await readSource("src/components/app-sidebar.tsx");

  assert.match(source, /<span className="truncate">임시 권한<\/span>/);
  assert.doesNotMatch(source, /임시 권한 사용 중/);
  assert.doesNotMatch(source, /프로필이 없으면/);
  assert.doesNotMatch(source, /leading-relaxed/);
});

test("todo navigation exposes direct queues and keeps query links distinct", async () => {
  const [navigationSource, navMainSource] = await Promise.all([
    readSource("src/lib/navigation.ts"),
    readSource("src/components/nav-main.tsx"),
  ]);

  for (const url of [
    "/admin/tasks?list=inbox",
    "/admin/tasks?list=sent",
    "/admin/tasks?list=completed",
  ]) {
    assert.ok(navigationSource.includes(`url: "${url}"`), url);
  }

  assert.doesNotMatch(navigationSource, /filter=confirmation/);
  assert.doesNotMatch(navMainSource, /filter: "confirmation"/);

  assert.match(navMainSource, /useSearchParams/);
  assert.match(navMainSource, /function normalizeHref/);
  assert.match(navMainSource, /const LEGACY_TODO_VIEW_SEARCH: Record<string, \{ list: string; sort\?: string; due\?: string; status\?: string \}>/);
  assert.match(navMainSource, /const legacyRoute = LEGACY_TODO_VIEW_SEARCH\[legacyView\]/);
  assert.match(navMainSource, /params\.set\("list", legacyRoute\.list\)/);
  assert.match(navMainSource, /params\.set\("sort", legacyRoute\.sort\)/);
  assert.match(navMainSource, /params\.set\("due", legacyRoute\.due\)/);
  assert.match(navMainSource, /params\.set\("status", legacyRoute\.status\)/);
  assert.match(navMainSource, /const currentHref = React\.useMemo/);
  assert.match(navMainSource, /navigationTargetId\(url: string\)[\s\S]*normalizeHref\(url\)/);
  assert.match(navMainSource, /target\.search && target\.path === current\.path/);
  assert.match(navMainSource, /router\.prefetch\(target\)/);
});

test("admin navigation exposes the persistent notification settings workspace", async () => {
  const navigationSource = await readSource("src/lib/navigation.ts");

  assert.match(navigationSource, /match:\s*"\/admin\/settings\/notifications"/);
  assert.match(navigationSource, /title:\s*"알림 설정"/);
  assert.match(navigationSource, /url:\s*"\/admin\/settings\/notifications"/);
});

test("legacy admin redirect routes do not keep template implementation files", async () => {
  const redirectOnlyRoutes = [
    "src/app/admin/chat",
    "src/app/admin/dashboard-2",
    "src/app/admin/faqs",
    "src/app/admin/mail",
    "src/app/admin/pricing",
    "src/app/admin/users",
    "src/app/admin/settings/billing",
  ];

  for (const pathname of redirectOnlyRoutes) {
    const pageSource = await readSource(`${pathname}/page.tsx`);
    const files = await listFiles(pathname);

    assert.match(pageSource, /redirect\("\/admin\/dashboard"\)/);
    assert.deepEqual(files, [`${pathname}/page.tsx`]);
  }
});

test("academic calendar alias does not keep unused sample calendar templates", async () => {
  const aliasSource = await readSource("src/app/admin/calendar/page.tsx");

  assert.match(aliasSource, /redirect\("\/admin\/academic-calendar"\)/);

  for (const pathname of [
    "src/app/admin/calendar/components/calendar-unified.tsx",
    "src/app/admin/calendar/components/quick-actions.tsx",
    "src/app/admin/calendar/use-calendar.ts",
    "src/app/admin/calendar/data.ts",
    "src/app/admin/calendar/data/events.json",
    "src/app/admin/calendar/data/event-dates.json",
    "src/app/admin/calendar/data/calendars.json",
  ]) {
    assert.equal(await pathExists(pathname), false, pathname);
  }
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

test("dashboard starts with live metrics and removes the inaccurate todo summary", async () => {
  const [pageSource, serviceSource] = await Promise.all([
    readSource("src/app/admin/dashboard/page.tsx"),
    readSource("src/features/tasks/ops-task-service.ts"),
  ]);

  assert.match(pageSource, /SectionCards/);
  assert.doesNotMatch(pageSource, /OpsTaskDashboardSummary/);
  assert.equal(
    await pathExists("src/features/tasks/ops-task-dashboard-summary.tsx"),
    false,
  );
  assert.doesNotMatch(
    serviceSource,
    /OpsTodoDashboardSummaryData|loadOpsTodoDashboardSummaryData/,
  );

  for (const pathname of [
    "src/app/admin/dashboard/components/chart-area-interactive.tsx",
    "src/app/admin/dashboard/components/data-table.tsx",
    "src/app/admin/dashboard/schemas/task-schema.ts",
    "src/app/admin/dashboard/data/data.json",
    "src/app/admin/dashboard/data/focus-documents-data.json",
    "src/app/admin/dashboard/data/key-personnel-data.json",
    "src/app/admin/dashboard/data/past-performance-data.json",
  ]) {
    assert.equal(await pathExists(pathname), false, pathname);
  }
});

test("dashboard focuses on student, enrollment, class, and conflict signals", async () => {
  const source = await readSource("src/app/admin/dashboard/components/section-cards.tsx");

  assert.match(source, /title: "재원"/);
  assert.match(source, /title: "수강"/);
  assert.match(source, /title: "수업"/);
  assert.match(source, /title: "수업당"/);
  assert.doesNotMatch(source, /학생수 \(수강 기준\) \/ 운영 수업/);
  assert.doesNotMatch(source, /학생수 \(인원 기준\)/);
  assert.doesNotMatch(source, /학생수 \(수강 기준\)/);
  assert.doesNotMatch(source, /수업당 학생수/);
  assert.doesNotMatch(source, /Users/);
  assert.doesNotMatch(source, /GraduationCap/);
  assert.doesNotMatch(source, /Clock3/);
  assert.doesNotMatch(source, /BarChart3/);
  assert.doesNotMatch(source, /Layers3/);
  assert.doesNotMatch(source, /UserCheck/);
  assert.doesNotMatch(source, /운영 수업/);
  assert.doesNotMatch(source, /인원 기준 · 수강 기준/);
  assert.match(source, /withUnit\(getMetricValue\(summary\.uniqueRegisteredStudentCount, metrics\), "명"\)/);
  assert.match(source, /withUnit\(getMetricValue\(summary\.registeredEnrollmentCount, metrics\), "명"\)/);
  assert.match(source, /withUnit\(getMetricValue\(summary\.activeClassesCount, metrics\), "개"\)/);
  assert.match(source, /getPositiveMetricSub\(summary\.uniqueWaitlistStudentCount, "대기", "명", metrics\)/);
  assert.doesNotMatch(source, /getSupportingMetricValue/);
  assert.match(source, /getSupportingLabel\(summary\.weeklyHoursLabel, metrics\)/);
  assert.match(source, /const weeklyHoursLabel = getSupportingLabel\(summary\.weeklyHoursLabel, metrics\)/);
  assert.match(source, /function isMetricUnavailable/);
  assert.match(source, /function getPositiveMetricSub/);
  assert.match(source, /value === "0분"\) return undefined/);
  assert.match(source, /if \(Number\(denominator \|\| 0\) <= 0\) return "-"/);
  assert.doesNotMatch(source, /\?\? "0분"/);
  assert.doesNotMatch(source, /확인 필요/);
  assert.doesNotMatch(source, /대기 인원/);
  assert.doesNotMatch(source, /대기 수강/);
  assert.match(source, /일정 충돌/);
  assert.doesNotMatch(source, /충돌 없음/);
  assert.doesNotMatch(source, /충돌 0건/);
  assert.doesNotMatch(source, /CheckCircle2/);
  assert.match(source, /if \(rows\.length === 0\) \{\s*return null\s*\}/);
  assert.match(source, /classSummaries/);
  assert.match(source, /scheduleLabel/);
  assert.match(source, /weeklyHoursLabel/);
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
  assert.doesNotMatch(source, /교사/);
  assert.match(source, /CLASS_OPERATION_GROUP_TABS/);
  assert.match(source, /\{ key: "teacher", label: "선생님" \}/);
  assert.match(source, /\{ key: "classroom", label: "강의실" \}/);
  assert.doesNotMatch(source, /subjectRows/);
  assert.doesNotMatch(source, /normalCount/);
  assert.doesNotMatch(source, /SearchCheck/);
});

test("dashboard exposes subject and division tabs with conflict process rows", async () => {
  const source = await readSource("src/app/admin/dashboard/components/section-cards.tsx");

  assert.match(source, /SUBJECT_TABS/);
  assert.match(source, /DIVISION_TABS/);
  assert.match(source, /\{ key: "all", label: "전체" \}/);
  assert.match(source, /초중등부/);
  assert.match(source, /고등부/);
  const visibleFilterBlock = source.slice(
    source.indexOf("function DashboardVisibleFilters"),
    source.indexOf("function DashboardHeader"),
  );
  const segmentedControlBlock = source.slice(
    source.indexOf("function SegmentedControl"),
    source.indexOf("function ListScopeToggle"),
  );

  for (const value of [
    ">과목</span>",
    ">부서</span>",
    'label="과목"',
    "items={SUBJECT_TABS}",
    'label="부서"',
    "items={DIVISION_TABS}",
    "grid min-w-0 gap-2",
    "sm:flex",
  ]) {
    assert.ok(visibleFilterBlock.includes(value), value);
  }
  assert.match(segmentedControlBlock, /role="group" aria-label=\{label\}/);
  assert.match(segmentedControlBlock, /aria-pressed=\{isActive\}/);
  assert.doesNotMatch(source, /DashboardFilterMenu|FilterRadioGroup|전체 범위/);
  assert.doesNotMatch(source, /DropdownMenuRadioGroup|DropdownMenuContent/);
  assert.doesNotMatch(source, /activeFilterCount|SlidersHorizontal/);
  assert.match(source, /const statusBadge =/);
  assert.match(source, /운영 상태/);
  assert.doesNotMatch(source, /운영 범위/);
  assert.doesNotMatch(source, /현재 필터 범위/);
  assert.doesNotMatch(source, /운영 현황/);
  assert.doesNotMatch(source, /학교 \{formatNumber\(summary\.schoolCount\)\} · 학년/);
  assert.doesNotMatch(source, /학교 \{formatNumber\(summary\.schoolCount\)\}곳/);
  assert.doesNotMatch(source, />필터<\/span>/);
  assert.match(source, /bg-primary text-primary-foreground/);
  assert.match(source, /AnimatedBar/);
  assert.match(source, /const unit = "명"/);
  assert.doesNotMatch(source, /basis === "students" \? "명" : "건"/);
  assert.doesNotMatch(source, /더 보기/);
  assert.match(source, /label="대상"/);
  assert.match(source, /label="일시"/);
  assert.match(source, />처리<\/span>/);
  assert.match(source, /schoolLabel/);
  assert.match(source, /gradeLabel/);
  assert.match(source, /\[row\.schoolLabel, row\.gradeLabel\]/);
  assert.doesNotMatch(source, /\[row\.schoolLabel, row\.gradeLabel, row\.dateLabel\]/);
  assert.match(source, /text-destructive">\{row\.classTitle\}/);
  assert.doesNotMatch(source, /\$\{row\.label\} 더 보기/);
  assert.match(source, /const schoolRowsForGrade = isExpanded \? allSchoolRowsForGrade : \[\]/);
  assert.match(source, /const gradeRowsForSchool = isExpanded \? allGradeRowsForSchool : \[\]/);
  assert.match(source, /DISTRIBUTION_TOGGLE_ROW_CLASS/);
  assert.match(source, /aria-expanded=\{isExpanded\}/);
  assert.match(source, /truncate pl-5 font-medium text-muted-foreground/);
  assert.match(source, /\$\{row\.label\} 학교 분포 \$\{isExpanded \? "접기" : "펼치기"\}/);
  assert.match(source, /\$\{row\.label\} 학년 분포 \$\{isExpanded \? "접기" : "펼치기"\}/);
  assert.match(source, /isExpanded && "rotate-180 text-primary"/);
  assert.match(source, /const DISTRIBUTION_PREVIEW_LIMIT = 5/);
  assert.match(source, /const CLASS_PREVIEW_LIMIT = 3/);
  assert.match(source, /ListScopeToggle/);
  assert.match(source, /role="group" aria-label=\{label\}/);
  assert.match(source, /aria-pressed=\{expanded\}/);
  assert.match(source, /const actionLabel = expanded \? "접기" : "전체 보기"/);
  assert.match(source, /const countLabel = expanded \? `상위 \$\{formatNumber\(visibleCount\)\}개` : `\$\{formatNumber\(totalCount\)\}개`/);
  assert.match(source, /label="학년 분포"/);
  assert.match(source, /label="학교 분포"/);
  assert.match(source, /label=\{`\$\{row\.label\} 수업 목록`\}/);
  assert.match(source, /aria-label="학년별 학생 분포"/);
  assert.match(source, /aria-label="학교별 학생 분포"/);
  assert.match(source, /aria-label=\{`\$\{groupLabel\}별 수업 운영`\}/);
  assert.match(source, /label="수업 운영 보기"/);
  assert.match(source, /value=\{groupMode\}/);
  assert.match(source, /role="listitem"/);
  assert.match(source, /classRows = isExpanded \? allClassRows : allClassRows\.slice\(0, CLASS_PREVIEW_LIMIT\)/);
  assert.match(source, /const groupRowsByMode = useMemo/);
  assert.match(source, /byTeacher \|\| \[\]/);
  assert.match(source, /byClassroom \|\| \[\]/);
  assert.match(source, /function getClassOperationGroupKey/);
  assert.match(source, /const defaultOpenGroupKey = groupRows\[0\] \? getClassOperationGroupKey\(groupMode, groupRows\[0\]\.label\) : undefined/);
  assert.match(source, /const changeGroupMode = \(nextMode: ClassOperationGroupMode\)/);
  assert.match(source, /new Set\(defaultOpenGroupKey \? \[defaultOpenGroupKey\] : \[\]\)/);
  assert.doesNotMatch(source, /\+\$\{formatNumber/);
  assert.match(source, /label: "재원"/);
  assert.match(source, /label: "수강"/);
  assert.doesNotMatch(source, /label: "인원"/);
  assert.doesNotMatch(source, /INLINE_DISCLOSURE_BUTTON_CLASS/);
  assert.doesNotMatch(source, /LIST_DISCLOSURE_BUTTON_CLASS/);
  assert.match(source, /LIST_SCOPE_TOGGLE_CLASS/);
  assert.match(source, /hover:border-primary\/40/);
  assert.match(source, /hasDistributionRows/);
  assert.match(source, /<EmptyLine label="학생 데이터 없음" \/>/);
  assert.match(source, /<EmptyLine label="학년 데이터 없음" \/>/);
  assert.match(source, /<EmptyLine label="학교 데이터 없음" \/>/);
  assert.match(source, /<EmptyLine label="수업 데이터 없음" \/>/);
  assert.doesNotMatch(source, /인원 기준/);
  assert.doesNotMatch(source, /수강 기준/);
  assert.doesNotMatch(source, /선택 탭에 표시할 학생 데이터가 없습니다/);
  assert.doesNotMatch(source, /학년별 학교 분포/);
  assert.doesNotMatch(source, /학교별 학년 분포/);
  assert.doesNotMatch(source, /totalClassCount/);
  assert.match(source, /function formatWeeklyHoursLabel/);
  assert.match(source, /합계 \{formatNumber\(row\.classCount\)\}개 · \{formatWeeklyHoursLabel\(row\.weeklyHoursLabel\)\} · \{formatNumber\(row\.studentCount\)\}명/);
  assert.match(source, /\{formatNumber\(row\.studentCount\)\}명/);
  assert.match(source, /formatWeeklyHoursLabel\(classItem\.weeklyHoursLabel\)[\s\S]*formatNumber\(classItem\.studentCount\)/);
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
  assert.match(source, /const visibleRows = showAllConflicts \? rows : rows\.slice\(0, 3\)/);
  assert.match(source, /label="일정 충돌"/);
  assert.match(source, /<ConflictBoard rows=\{conflictRows\} \/>[\s\S]*<div className="grid gap-4/);
  assert.match(source, /splitBadgeLabels\(classItem\.teacherLabel\)/);
  assert.match(source, /splitBadgeLabels\(classItem\.classroomLabel\)/);
  assert.doesNotMatch(source, /classItem\.scheduleLabel\} · \{classItem\.teacherLabel\}/);
  assert.match(source, /getBarScale\(schoolValue, gradeMax, 4\)/);
  assert.match(source, /getBarScale\(gradeValue, schoolMax, 4\)/);
  assert.doesNotMatch(source, /GradeSharePie/);
  assert.doesNotMatch(source, /conic-gradient/);
  assert.doesNotMatch(source, /violet/);
  assert.doesNotMatch(source, /slice\(0, 4\)/);
  assert.doesNotMatch(source, /bucket\.classBreakdowns\?\.byGrade \|\| \[\]\)\.slice\(0, 5\)/);
});

test("dashboard metrics renders the core snapshot before optional enrichment", async () => {
  const source = await readSource("src/hooks/use-tips-dashboard-metrics.ts");

  assert.match(source, /const DASHBOARD_CORE_TABLE_TIMEOUT_MS = 15000/);
  assert.match(source, /const DASHBOARD_OPTIONAL_TABLE_TIMEOUT_MS = 5000/);
  assert.match(source, /classes: "\*"/);
  assert.match(source, /students:\s*\[[\s\S]*"school"[\s\S]*"grade"[\s\S]*"class_ids"/);
  assert.match(source, /academic_events: "\*"/);
  assert.match(source, /function isMissingColumnError/);
  assert.match(source, /result = await queryTable\(tableName, "\*", optional, timeoutMs\)/);
  assert.match(source, /if \(optional \|\| isMissingRelationError\(result\.error\)\)/);
  assert.match(source, /const \[classes, students\] = await Promise\.all/);
  assert.match(source, /buildMetrics\(\{\s*classes,\s*students,\s*\}\)/);
  assert.match(source, /readTable\("class_terms", \{ optional: true \}\)/);
});

test("dashboard keeps dense cards readable on mobile widths", async () => {
  const [source, pageSource] = await Promise.all([
    readSource("src/app/admin/dashboard/components/section-cards.tsx"),
    readSource("src/app/admin/dashboard/page.tsx"),
  ]);

  assert.match(source, /DISTRIBUTION_ROW_CLASS/);
  assert.match(source, /grid-cols-\[minmax\(3\.75rem,5\.25rem\)_minmax\(0,1fr\)_3\.25rem\]/);
  assert.match(source, /CLASS_OPERATION_ROW_CLASS/);
  assert.match(source, /grid-cols-\[1rem_minmax\(4\.5rem,7rem\)_minmax\(0,1fr\)_6\.25rem\]/);
  assert.match(source, /focus-visible:ring-2 focus-visible:ring-ring/);
  assert.match(source, /defaultOpenGroupKey/);
  assert.match(source, /ChevronDown/);
  assert.match(source, /aria-label=\{`\$\{row\.label\} \$\{groupLabel\} 수업/);
  assert.match(source, /key=\{`\$\{activeSubject\}:\$\{activeDivision\}`\}/);
  assert.match(source, /order-2 min-w-0 lg:order-1/);
  assert.match(source, /order-1 min-w-0 lg:order-2/);
  assert.match(source, /has-data-\[slot=card-action\]:grid-cols-1/);
  assert.match(source, /sm:has-data-\[slot=card-action\]:grid-cols-\[1fr_auto\]/);
  assert.match(source, /grid grid-cols-\[auto_minmax\(0,1fr\)\]/);
  assert.match(source, /sm:grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
  assert.match(source, /!whitespace-normal break-keep bg-background/);
  assert.match(source, /min-w-0 max-w-full text-sm font-semibold leading-5/);
  assert.match(source, /grid min-w-0 gap-2 sm:flex sm:flex-wrap sm:items-center/);
  assert.doesNotMatch(source, /DashboardFilterMenu/);
  assert.match(pageSource, /px-3 pb-5 sm:px-4 sm:pb-6 lg:px-6/);
});

test("lesson-design routes resolve to the actual design workspace title", async () => {
  const source = await readSource("src/lib/navigation.ts");

  assert.match(source, /match: "\/admin\/curriculum\/lesson-design"/);
  assert.match(source, /match: "\/admin\/class-schedule\/lesson-design"/);
  assert.match(source, /title: "수업 설계"/);
});

test("class schedule list heading avoids explanatory copy", async () => {
  const source = await readSource("src/features/operations/class-schedule-workspace.tsx");
  const navigationSource = await readSource("src/lib/navigation.ts");

  assert.match(source, />수업 목록<\/p>/);
  assert.match(source, /<Badge variant="outline">\{model\.rows\.length\}개<\/Badge>/);
  assert.doesNotMatch(source, /스프레드시트형 보기/);
  assert.doesNotMatch(source, />행 \{model\.rows\.length\}<\/div>/);
  assert.match(navigationSource, /match: "\/admin\/class-schedule"/);
  assert.match(navigationSource, /title: "수업일정"/);
  assert.doesNotMatch(navigationSource, /수업일정 워크스페이스/);
});

test("quick search trigger shows Ctrl + K", async () => {
  const source = await readSource("src/components/command-search.tsx");

  assert.match(source, /usePathname/);
  assert.match(source, /function normalizeCommandPath/);
  assert.match(source, /const currentPath = React\.useMemo/);
  assert.match(source, /QUICK_SEARCH_SHORTCUT_LABEL = "Ctrl \+ K"/);
  assert.match(source, /return "운영"/);
  assert.match(source, /aria-label="빠른 이동"/);
  assert.match(source, /<DialogTitle className="sr-only">빠른 이동<\/DialogTitle>/);
  assert.match(source, /placeholder="이동할 메뉴 검색"/);
  assert.match(source, /keywords=\{\[item\.group, item\.url\]\}/);
  assert.match(source, /value=\{`\$\{item\.title\} \$\{item\.group\} \$\{item\.url\}`\}/);
  assert.match(source, /aria-current=\{isCurrent \? "page" : undefined\}/);
  assert.match(source, /aria-label=\{`빠른 이동: \$\{item\.title\}`\}/);
  assert.match(source, /현재/);
  assert.match(source, /<ArrowRight/);
  assert.match(source, /aria-label=\{`빠른 이동 열기, \$\{QUICK_SEARCH_SHORTCUT_LABEL\}`\}/);
  assert.match(source, /title=\{`빠른 이동 \(\$\{QUICK_SEARCH_SHORTCUT_LABEL\}\)`\}/);
  assert.match(source, /heading=\{`\$\{group\} \$\{items\.length\}개`\}/);
  assert.match(source, /keywords=\{\[item\.group, item\.url\]\}/);
  assert.doesNotMatch(source, /운영 워크스페이스/);
  assert.doesNotMatch(source, /<span className="truncate text-xs text-zinc-500 dark:text-zinc-400">\{item\.group\}<\/span>/);
  assert.doesNotMatch(source, /<span className="truncate text-xs text-zinc-500 dark:text-zinc-400">\{item\.url\}<\/span>/);
  assert.doesNotMatch(source, /setTimeout/);
  assert.doesNotMatch(source, /style\.transform/);
});

test("sidebar submenu disclosure stays discoverable", async () => {
  const source = await readSource("src/components/nav-main.tsx");

  assert.match(source, /function isRouteActive/);
  assert.match(source, /function getNavMoveLabel/);
  assert.match(source, /return `\$\{title\} 이동`/);
  assert.match(source, /function getNavSubmenuLabel/);
  assert.match(source, /current\.path\.startsWith\(`\$\{target\.path\}\/`\)/);
  assert.match(source, /aria-expanded=\{openItems\[item\.url\] \?\? false\}/);
  assert.match(source, /aria-label=\{getNavSubmenuLabel\(/);
  assert.doesNotMatch(source, /\$\{item\.title\}로 이동/);
  assert.doesNotMatch(source, /\$\{subItem\.title\}로 이동/);
  assert.doesNotMatch(source, /showOnHover/);
});

test("global shell controls use Korean action labels", async () => {
  const [sidebarSource, modeToggleSource, headerSource, navUserSource, appSidebarSource] = await Promise.all([
    readSource("src/components/ui/sidebar.tsx"),
    readSource("src/components/mode-toggle.tsx"),
    readSource("src/components/site-header.tsx"),
    readSource("src/components/nav-user.tsx"),
    readSource("src/components/app-sidebar.tsx"),
  ]);

  assert.match(sidebarSource, /탐색 메뉴/);
  assert.match(sidebarSource, /운영 메뉴와 계정 메뉴를 표시합니다/);
  assert.match(sidebarSource, /사이드바 펼치기/);
  assert.match(sidebarSource, /사이드바 접기/);
  assert.match(sidebarSource, /className=\{cn\("size-8", className\)\}/);
  assert.match(sidebarSource, /absolute top-0 right-0 flex aspect-square w-8/);
  assert.match(sidebarSource, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.doesNotMatch(sidebarSource, /Toggle Sidebar/);

  assert.match(modeToggleSource, /다크 모드로 전환/);
  assert.match(modeToggleSource, /라이트 모드로 전환/);
  assert.doesNotMatch(modeToggleSource, /Switch to/);

  assert.match(headerSource, /aria-label="홈페이지를 새 화면에서 확인"/);
  assert.match(headerSource, /target="_blank"/);
  assert.match(headerSource, /rel="noreferrer"/);
  assert.match(navUserSource, /계정 메뉴 열기/);
  assert.match(appSidebarSource, /aria-label="대시보드 홈으로 이동"/);
});

test("assistant navigation only exposes allowed operation surfaces", async () => {
  const [navigationSource, sidebarSource, commandSearchSource] = await Promise.all([
    readSource("src/lib/navigation.ts"),
    readSource("src/components/app-sidebar.tsx"),
    readSource("src/components/command-search.tsx"),
  ]);
  const assistantOverviewBlock = navigationSource.slice(
    navigationSource.indexOf("const assistantOverviewItems"),
    navigationSource.indexOf("const fullOverviewItems"),
  );

  assert.match(navigationSource, /canUseAssistantOperations/);
  assert.match(navigationSource, /const assistantOverviewItems: NavItem\[\]/);
  assert.match(navigationSource, /title: "할 일"[\s\S]*url: "\/admin\/tasks"/);
  assert.match(navigationSource, /title: "영어 단어 재시험"[\s\S]*url: "\/admin\/word-retests"/);
  assert.match(navigationSource, /title: "학사일정"[\s\S]*url: "\/admin\/academic-calendar"/);
  assert.match(navigationSource, /title: "시간표"[\s\S]*url: "\/admin\/timetable"/);
  assert.doesNotMatch(assistantOverviewBlock, /url: "\/admin\/dashboard"/);
  assert.match(navigationSource, /canUseAssistantOperations \? assistantOverviewItems : fullOverviewItems/);
  assert.match(sidebarSource, /buildAdminNavGroups\(\{ canManageAll, canEditCurriculumPlanning, canUseAssistantOperations \}\)/);
  assert.match(commandSearchSource, /buildAdminNavGroups\(\{ canManageAll, canEditCurriculumPlanning, canUseAssistantOperations \}\)/);
});

test("global shell exposes stable browser-use targets", async () => {
  const [navMainSource, commandSearchSource, headerSource, modeToggleSource, navUserSource, appSidebarSource, sidebarSource, dialogSource, globalsSource] = await Promise.all([
    readSource("src/components/nav-main.tsx"),
    readSource("src/components/command-search.tsx"),
    readSource("src/components/site-header.tsx"),
    readSource("src/components/mode-toggle.tsx"),
    readSource("src/components/nav-user.tsx"),
    readSource("src/components/app-sidebar.tsx"),
    readSource("src/components/ui/sidebar.tsx"),
    readSource("src/components/ui/dialog.tsx"),
    readSource("src/app/globals.css"),
  ]);

  assert.match(appSidebarSource, /data-testid="admin-sidebar-brand"/);
  assert.match(headerSource, /data-testid="admin-sidebar-toggle"/);
  assert.match(headerSource, /data-testid="admin-public-site-link"/);
  assert.match(navMainSource, /data-testid=\{`admin-nav-link-\$\{itemTargetId\}`\}/);
  assert.match(navMainSource, /data-testid=\{`admin-nav-disclosure-\$\{itemTargetId\}`\}/);
  assert.match(navMainSource, /data-testid=\{`admin-nav-sublink-\$\{navigationTargetId\(subItem\.url\)\}`\}/);
  assert.match(commandSearchSource, /data-testid="admin-quick-search-trigger"/);
  assert.match(commandSearchSource, /data-testid="admin-quick-search-dialog"/);
  assert.match(commandSearchSource, /data-testid=\{`admin-quick-search-item-\$\{itemTargetId\}`\}/);
  assert.match(commandSearchSource, /onClick=\{\(\) => handleSelect\(item\.url\)\}/);
  assert.match(commandSearchSource, /flushSync\(\(\) => \{/);
  assert.match(commandSearchSource, /aria-label="빠른 이동 검색"/);
  assert.match(headerSource, /setSearchOpen\(false\)[\s\S]*\[pathname\]/);
  assert.match(modeToggleSource, /data-testid="admin-theme-toggle"/);
  assert.match(navUserSource, /data-testid="admin-user-menu-trigger"/);
  assert.match(navUserSource, /data-testid="admin-profile-avatar-grid"/);
  assert.match(sidebarSource, /data-testid="admin-sidebar-rail"/);
  assert.match(appSidebarSource, /<SidebarRail \/>/);
  assert.match(dialogSource, /data-\[state=closed\]:pointer-events-none data-\[state=closed\]:hidden data-\[state=closed\]:invisible/);
  assert.match(dialogSource, /absolute top-4 right-4 z-30/);
  assert.match(globalsSource, /\[data-slot="dialog-content"\]\[data-state="closed"\]/);
});

test("global shell avoids hidden palette and avatar over-render work", async () => {
  const [navMainSource, commandSearchSource, modeToggleSource, navUserSource, sidebarSource] = await Promise.all([
    readSource("src/components/nav-main.tsx"),
    readSource("src/components/command-search.tsx"),
    readSource("src/components/mode-toggle.tsx"),
    readSource("src/components/nav-user.tsx"),
    readSource("src/components/ui/sidebar.tsx"),
  ]);

  assert.match(navMainSource, /useRouter/);
  assert.match(navMainSource, /const currentPath = React\.useMemo/);
  assert.match(navMainSource, /const prefetchedRoutesRef = React\.useRef/);
  assert.match(navMainSource, /router\.prefetch\(target\)/);
  assert.match(navMainSource, /key=\{item\.url\}/);
  assert.match(navMainSource, /key=\{subItem\.url\}/);
  assert.match(navMainSource, /openItems\[item\.url\]/);
  assert.match(navMainSource, /onPointerEnter=\{\(\) => prefetchRoute\(item\.url\)\}/);
  assert.match(navMainSource, /const routeStateByUrl = React\.useMemo/);
  assert.match(navMainSource, /const isUrlActive = React\.useCallback/);
  assert.match(navMainSource, /const handleItemOpenChange = React\.useCallback/);
  assert.match(commandSearchSource, /const prefetchedCommandRoutesRef = React\.useRef/);
  assert.match(commandSearchSource, /router\.prefetch\(targetPath\)/);
  assert.match(commandSearchSource, /const targetPath = normalizeCommandPath\(url\)/);
  assert.match(commandSearchSource, /onPointerEnter=\{\(\) => prefetchCommandRoute\(item\.url\)\}/);
  assert.match(commandSearchSource, /if \(!open\) return EMPTY_GROUPED_SEARCH_ITEMS/);
  assert.match(commandSearchSource, /if \(!open\) \{\s+return null\s+\}/);
  assert.match(commandSearchSource, /const groupedEntries = React\.useMemo/);
  assert.match(commandSearchSource, /function groupSearchItems/);
  assert.match(commandSearchSource, /React\.startTransition/);
  assert.doesNotMatch(commandSearchSource, /navGroups\.flatMap/);
  assert.match(modeToggleSource, /React\.useState\(getSystemDarkMode\)/);
  assert.match(modeToggleSource, /if \(theme === "dark" \|\| theme === "light"\)/);
  assert.match(navUserSource, /const PROFILE_AVATAR_INITIAL_LIMIT = 20/);
  assert.match(navUserSource, /profileAvatarPresets\.slice\(0, avatarLimit\)/);
  assert.match(navUserSource, /const visibleProfileAvatarPresets = React\.useMemo/);
  assert.match(navUserSource, /const revealMoreAvatars = React\.useCallback/);
  assert.match(sidebarSource, /if \(openState === open\) return/);
});

test("admin shell does not keep unused floating template controls", async () => {
  for (const pathname of [
    "src/components/layouts/base-layout.tsx",
    "src/components/upgrade-to-pro-button.tsx",
    "src/components/dynamic-imports.ts",
    "src/components/theme-customizer.tsx",
    "src/components/theme-customizer/index.tsx",
    "src/components/theme-customizer/main.tsx",
    "src/components/theme-customizer/theme-tab.tsx",
    "src/components/theme-customizer/layout-tab.tsx",
    "src/components/theme-customizer/circular-transition.css",
    "src/hooks/use-fullscreen.ts",
  ]) {
    assert.equal(await pathExists(pathname), false, pathname);
  }

  const modeToggleSource = await readSource("src/components/mode-toggle.tsx");
  assert.match(modeToggleSource, /"\.\/mode-toggle-transition\.css"/);
  assert.doesNotMatch(modeToggleSource, /theme-customizer/);
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
