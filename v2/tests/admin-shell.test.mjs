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

test("dashboard metric cards act as direct workspace links", async () => {
  const source = await readSource("src/app/admin/dashboard/components/section-cards.tsx");

  assert.match(source, /import Link from "next\/link"/);
  assert.match(source, /href: "\/admin\/classes"/);
  assert.match(source, /href: "\/admin\/students"/);
  assert.match(source, /href: "\/admin\/textbooks"/);
  assert.match(source, /href: "\/admin\/curriculum"/);
  assert.match(source, /aria-label=\{`\$\{card\.title\} \$\{card\.destinationLabel\} 열기`\}/);
});

test("dashboard collision and analytics panels stay operationally dense", async () => {
  const source = await readSource("src/app/admin/dashboard/components/section-cards.tsx");

  assert.match(source, /if \(totalRisk === 0\) return null/);
  assert.match(source, /filter\(\(section\) => section\.rows\.length > 0\)/);
  assert.doesNotMatch(source, /충돌 없음/);
  assert.match(source, /DASHBOARD_SUBJECT_TABS/);
  assert.match(source, /slice\(0, 5\)/);
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
