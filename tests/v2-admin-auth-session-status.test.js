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

test("admin layout keeps the site header without injecting AdminSessionStatus", () => {
  const layoutSource = read("v2/src/app/admin/layout.tsx");

  assert.doesNotMatch(layoutSource, /import \{ AdminSessionStatus \} from "@\/components\/auth\/admin-session-status";/);
  assert.doesNotMatch(layoutSource, /<AdminSessionStatus \/>/);
  assert.match(layoutSource, /<SiteHeader \/>/);
});

test("shared admin chrome drops the requested route and session badges", () => {
  const headerSource = read("v2/src/components/site-header.tsx");
  const sessionSource = read("v2/src/components/auth/admin-session-status.tsx");
  const dashboardSource = read("v2/src/app/admin/dashboard/page.tsx");

  assert.doesNotMatch(headerSource, /관리자 전용 동선/);
  assert.doesNotMatch(headerSource, /resolveAdminWorkspaceMeta/);
  assert.doesNotMatch(headerSource, /usePathname/);
  assert.doesNotMatch(headerSource, /현재 워크스페이스/);
  assert.match(headerSource, /홈페이지/);
  assert.doesNotMatch(headerSource, /수업 소개 확인/);
  assert.match(headerSource, /<ModeToggle \/>/);
  assert.doesNotMatch(sessionSource, /인증된 운영 세션/);
  assert.doesNotMatch(sessionSource, /역할 검증 완료/);
  assert.doesNotMatch(dashboardSource, /관리자 전용 동선/);
});
