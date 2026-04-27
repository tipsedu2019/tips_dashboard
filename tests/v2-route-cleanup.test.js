import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("legacy admin template routes redirect back to supported admin destinations", () => {
  const dashboardRedirectRoutes = [
    "v2/src/app/admin/dashboard-2/page.tsx",
    "v2/src/app/admin/users/page.tsx",
    "v2/src/app/admin/faqs/page.tsx",
    "v2/src/app/admin/pricing/page.tsx",
    "v2/src/app/admin/mail/page.tsx",
    "v2/src/app/admin/chat/page.tsx",
    "v2/src/app/admin/tasks/page.tsx",
    "v2/src/app/admin/settings/account/page.tsx",
    "v2/src/app/admin/settings/user/page.tsx",
    "v2/src/app/admin/settings/appearance/page.tsx",
    "v2/src/app/admin/settings/notifications/page.tsx",
    "v2/src/app/admin/settings/billing/page.tsx",
    "v2/src/app/admin/settings/connections/page.tsx",
  ];

  dashboardRedirectRoutes.forEach((relativePath) => {
    const source = read(relativePath);
    assert.match(source, /import \{ redirect \} from "next\/navigation";/);
    assert.match(source, /redirect\("\/admin\/dashboard"\);/);
  });

  const calendarAliasSource = read("v2/src/app/admin/calendar/page.tsx");
  assert.match(calendarAliasSource, /redirect\("\/admin\/academic-calendar"\);/);

  const landingAliasSource = read("v2/src/app/landing/page.tsx");
  assert.match(landingAliasSource, /redirect\("\/"\);/);
});

test("classes bridge preserves public query context when redirecting to the legacy public surface", () => {
  const classesSource = read("v2/src/app/classes/page.tsx");

  assert.match(classesSource, /searchParams\?: Promise<Record<string, string \| string\[\] \| undefined>>/);
  assert.match(classesSource, /const resolvedSearchParams = \(await searchParams\) \|\| \{\}/);
  assert.match(classesSource, /Object\.entries\(resolvedSearchParams\)/);
  assert.match(classesSource, /new URLSearchParams\(\)/);
  assert.match(classesSource, /redirect\(`\/legacy-public\/classes\/index\.html\$\{query \? `\?\$\{query\}` : ""\}`\);/);
});

test("user-facing v2 chrome no longer describes the product as a baseline", () => {
  const layoutSource = read("v2/src/app/layout.tsx");
  const sidebarSource = read("v2/src/components/app-sidebar.tsx");
  const dashboardSource = read("v2/src/app/admin/dashboard/page.tsx");
  const publicLayoutSource = read("v2/src/components/public/public-layout.tsx");
  const publicHomeSource = read("v2/src/components/public/public-home-page.tsx");
  const signInSource = read("v2/src/app/(auth)/sign-in/components/login-form-1.tsx");

  [layoutSource, sidebarSource, dashboardSource, publicLayoutSource, publicHomeSource, signInSource].forEach((source) => {
    assert.equal(source.includes("baseline"), false);
    assert.equal(source.includes("ShadcnStore baseline"), false);
    assert.equal(source.includes("v2 baseline"), false);
  });

  assert.match(layoutSource, /title: "TIPS Dashboard"/);
  assert.match(layoutSource, /lang="ko"/);
  assert.match(sidebarSource, /운영 포털/);
  assert.match(dashboardSource, /운영 현황, 일정, 수업 데이터를 한 곳에서 빠르게 확인하고 관리합니다\./);
  assert.match(publicLayoutSource, /입시·학사 운영 포털/);
  assert.match(publicHomeSource, /입시·학사 운영을 한 곳에서 연결하는 TIPS Dashboard/);
  assert.match(signInSource, /기존 TIPS 운영 계정과 역할 체계를 그대로 이어서 로그인할 수 있습니다\./);
});
