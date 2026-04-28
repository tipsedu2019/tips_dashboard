import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
  assert.equal(sidebarBrand.href, "/admin/dashboard");
});

test("sidebar brand keeps the logo size and only repositions it in icon collapse mode", async () => {
  const source = await readSource("src/components/app-sidebar.tsx");

  assert.match(source, /group-data-\[collapsible=icon\]:size-9!/);
  assert.match(source, /group-data-\[collapsible=icon\]:justify-center/);
  assert.match(source, /group-data-\[collapsible=icon\]:hidden/);
  assert.match(source, /rounded-md border border-sidebar-border\/60/);
});
