import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs";
import * as brandAssets from "../src/components/brand-assets.ts";

const sidebarBrand = brandAssets.sidebarBrand ?? brandAssets.default?.sidebarBrand;
const root = new URL("../", import.meta.url);

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

test("sidebar brand uses the official TIPS logo asset", () => {
  assert.ok(sidebarBrand);
  assert.equal(sidebarBrand.src, "/logo_tips.png");
  assert.equal(sidebarBrand.alt, "TIPS 운영 포털 로고");
});

test("sidebar brand keeps the logo size and only repositions it in icon collapse mode", async () => {
  const source = await readSource("src/components/app-sidebar.tsx");

  assert.match(source, /group-data-\[collapsible=icon\]:size-9!/);
  assert.match(source, /group-data-\[collapsible=icon\]:justify-center/);
  assert.match(source, /group-data-\[collapsible=icon\]:hidden/);
  assert.match(source, /width=\{36\}/);
  assert.match(source, /height=\{36\}/);
  assert.match(source, /size-\[var\(--shell-logo-size\)\]/);
});

test("the sidebar brand links directly to each signed-in role's home", () => {
  const { getRoleCapabilities } = loadNotificationComponent("src/lib/auth-utils.ts");
  let capabilities;
  const childrenOnly = ({ children }) => children;
  const { AppSidebar } = loadNotificationComponent("src/components/app-sidebar.tsx", new Map([
    ["@/providers/auth-provider", { useAuth: () => capabilities }],
    ["@/components/nav-main", { NavMain: () => null }],
    ["@/components/nav-user", { NavUser: () => null }],
    ["@/components/ui/sidebar", {
      Sidebar: childrenOnly, SidebarContent: childrenOnly, SidebarFooter: childrenOnly,
      SidebarHeader: childrenOnly, SidebarMenu: childrenOnly, SidebarMenuButton: childrenOnly,
      SidebarMenuItem: childrenOnly, SidebarRail: () => null, useSidebar: () => ({ isMobile: false }),
    }],
  ]));
  for (const [role, home] of [
    ["admin", "/admin/registration"], ["staff", "/admin/registration"], ["assistant", "/admin/word-retests"],
    ["teacher", "/admin/academic-calendar"], ["viewer", "/admin/academic-calendar"],
  ]) {
    capabilities = { ...getRoleCapabilities(role), user: { id: role }, isAdmin: role === "admin" };
    const sidebar = JSDOM.fragment(renderToStaticMarkup(createElement(AppSidebar)));
    const logo = sidebar.querySelector('a[aria-label="첫 화면으로 이동"]');
    assert.equal(logo?.getAttribute("href"), home, role);
    assert.equal(logo?.getAttribute("title"), "첫 화면");
  }
});
