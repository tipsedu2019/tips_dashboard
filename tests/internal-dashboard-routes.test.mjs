import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs";

test("the root server page enters the role-aware admin index", () => {
  const destinations = [];
  const { default: HomePage } = loadNotificationComponent("src/app/page.tsx", new Map([
    ["next/navigation", { redirect: (destination) => destinations.push(destination) }],
  ]));
  HomePage();
  assert.deepEqual(destinations, ["/admin"]);
});

test("the root middleware sends the incoming request to the same admin index", () => {
  const { middleware } = loadNotificationComponent("middleware.ts", new Map([
    ["next/server", { NextResponse: { redirect: url => url.href } }],
  ]));
  const url = "https://example.test/";
  assert.equal(middleware({ url, nextUrl: new URL(url) }), "https://example.test/admin");
});

test("retired admin bookmarks resolve to the role-aware index", () => {
  for (const route of [
    "chat", "dashboard-2", "faqs", "mail", "manual", "pricing", "users", "settings/account",
    "settings/appearance", "settings/billing", "settings/connections", "settings/user",
  ]) {
    const destinations = [];
    const { default: Page } = loadNotificationComponent(`src/app/admin/${route}/page.tsx`, new Map([
      ["next/navigation", { redirect: url => destinations.push(url) }],
    ]));
    Page();
    assert.deepEqual(destinations, ["/admin"], route);
  }
});

test("retired public addresses lead to the landing site without catching admin or API routes", async () => {
  const { default: config } = loadNotificationComponent("next.config.ts", new Map([
    ["./public-env", { resolveTipsPublicEnv: () => ({}) }],
  ]));
  const redirects = await config.redirects();
  assert.deepEqual(redirects, [
    { source: "/home", destination: "/admin", permanent: true },
    ...["classes", "reviews", "results"].map((page) => ({
      source: `/${page}`, destination: `https://tipsedu.co.kr/${page}`, permanent: true,
    })),
    { source: "/landing", destination: "https://tipsedu.co.kr", permanent: true },
  ]);
});

test("duplicate public entry pages are retired while internal homepage management and data endpoints remain", () => {
  for (const file of [
    "src/app/classes/page.tsx", "src/app/classes/loading.tsx", "src/app/classes/error.tsx",
    "src/app/reviews/page.tsx", "src/app/results/page.tsx", "src/app/landing/page.tsx",
    "src/components/public/public-classes-view.tsx", "src/components/public/route-providers.tsx",
  ]) assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), false, file);

  for (const file of [
    "src/app/admin/public-content/page.tsx", "src/providers/management-providers.tsx",
    "src/app/api/public-classes/route.ts", "src/app/api/public-classes/summary/route.ts",
    "src/app/api/public-classes/[classId]/route.ts", "src/app/api/public-content/route.ts",
    "src/app/api/public-content/assets/[...path]/route.ts", "src/app/api/admin/public-content/route.ts",
    "src/app/api/admin/public-content/uploads/route.ts", "src/app/api/public-classes/cache/invalidate/route.ts",
  ]) assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), true, file);
});
