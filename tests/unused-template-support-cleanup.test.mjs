import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function pathExists(pathname) {
  try {
    await readFile(resolve(root, pathname));
    return true;
  } catch {
    return false;
  }
}

test("admin build does not keep unused template shell and primitive support files", async () => {
  for (const pathname of [
    "src/components/nav-secondary.tsx",
    "src/components/auth/admin-session-status.tsx",
    "src/components/ui/breadcrumb.tsx",
    "src/components/ui/chart.tsx",
    "src/components/ui/drawer.tsx",
    "src/components/ui/navigation-menu.tsx",
    "src/components/ui/radio-group.tsx",
    "src/components/ui/resizable.tsx",
    "src/components/ui/switch.tsx",
    "src/components/ui/toggle-group.tsx",
  ]) {
    assert.equal(await pathExists(pathname), false, pathname);
  }
});
