import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

test("app sidebar no longer renders ShadcnStore promo notification", () => {
  const source = fs.readFileSync(
    path.join(root, "v2", "src", "components", "app-sidebar.tsx"),
    "utf8",
  );

  assert.equal(source.includes("SidebarNotification"), false);
});

test("admin layout no longer renders ShadcnStore footer promo", () => {
  const source = fs.readFileSync(
    path.join(root, "v2", "src", "app", "admin", "layout.tsx"),
    "utf8",
  );

  assert.equal(source.includes("SiteFooter"), false);
});

test("base layout no longer renders ShadcnStore footer promo", () => {
  const source = fs.readFileSync(
    path.join(root, "v2", "src", "components", "layouts", "base-layout.tsx"),
    "utf8",
  );

  assert.equal(source.includes("SiteFooter"), false);
});

test("site header emphasizes current admin workspace and removes extra public bridge links", () => {
  const source = fs.readFileSync(
    path.join(root, "v2", "src", "components", "site-header.tsx"),
    "utf8",
  );

  assert.match(source, /usePathname/);
  assert.match(source, /resolveAdminWorkspaceMeta/);
  assert.match(source, /현재 워크스페이스/);
  assert.match(source, /관리자 전용 동선/);
  assert.match(source, /QUICK_SEARCH_SHORTCUT_LABEL/);
  assert.match(source, /빠른 이동 \{QUICK_SEARCH_SHORTCUT_LABEL\}/);
  assert.match(source, /수업 소개 확인/);
  assert.equal(source.includes('빠른 이동 ⌘K'), false);
  assert.equal(source.includes('href="/reviews"'), false);
  assert.equal(source.includes('href="/results"'), false);
});

test("navigation exports route-aware workspace summaries for core admin pages while keeping sidebar navigation admin-first", () => {
  const source = fs.readFileSync(
    path.join(root, "v2", "src", "lib", "navigation.ts"),
    "utf8",
  );

  assert.match(source, /resolveAdminWorkspaceMeta/);
  assert.match(source, /"\/admin\/class-schedule"/);
  assert.match(source, /수업일정 워크스페이스/);
  assert.match(source, /"\/admin\/manual"/);
  assert.match(source, /사용설명서/);
  assert.match(source, /"\/admin\/curriculum"/);
  assert.match(source, /업데이트 대기 구간을 확인합니다/);
  assert.equal(source.includes('label: "사용설명"'), false);
  assert.equal(source.includes('label: "외부 확인"'), false);
  assert.equal(source.includes('title: "수업 소개 확인"'), false);
  assert.equal(source.includes('url: "/classes"'), false);
  assert.equal(source.includes('label: "공개 페이지"'), false);
  assert.equal(source.includes('url: "/reviews"'), false);
  assert.equal(source.includes('url: "/results"'), false);
  assert.equal(source.includes('title: "홈"'), false);
});

test("command search stays admin-first, adds compact manual/external shortcuts, and reuses the shared shortcut label", () => {
  const source = fs.readFileSync(
    path.join(root, "v2", "src", "components", "command-search.tsx"),
    "utf8",
  );

  assert.match(source, /무엇을 찾고 계신가요\?/);
  assert.match(source, /운영 워크스페이스/);
  assert.match(source, /resolveCommandGroupLabel/);
  assert.match(source, /buildAdminNavGroups/);
  assert.match(source, /useAuth/);
  assert.match(source, /canManageAll/);
  assert.match(source, /canEditCurriculumPlanning/);
  assert.match(source, /createSearchItems/);
  assert.match(source, /QUICK_SEARCH_SHORTCUT_LABEL/);
  assert.match(source, /Ctrl\/⌘K/);
  assert.match(source, /AUXILIARY_COMMAND_ITEMS/);
  assert.match(source, /title: "사용설명서"/);
  assert.match(source, /url: "\/admin\/manual"/);
  assert.match(source, /group: "사용설명"/);
  assert.match(source, /title: "수업 소개 확인"/);
  assert.match(source, /url: "\/classes"/);
  assert.match(source, /group: "외부 확인"/);
  assert.equal(source.includes('const searchItems: SearchItem[] = ['), false);
  assert.equal(source.includes('url: "/reviews"'), false);
  assert.equal(source.includes('url: "/results"'), false);
  assert.equal(source.includes('url: "/sign-in"'), false);
  assert.equal(source.includes('group: "공개"'), false);
  assert.equal(source.includes('Search...'), false);
  assert.equal(source.includes('Command Search'), false);
});
