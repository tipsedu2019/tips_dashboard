import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function readSource(pathname) {
  return readFile(resolve(root, pathname), "utf8");
}

async function pathExists(pathname) {
  try {
    await readFile(resolve(root, pathname));
    return true;
  } catch {
    return false;
  }
}

async function listFiles(pathname) {
  const base = resolve(root, pathname);
  const output = [];

  async function walk(relativePath) {
    const entries = await readdir(resolve(base, relativePath), { withFileTypes: true });
    for (const entry of entries) {
      const child = join(relativePath, entry.name).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        await walk(`${child}/`);
      } else {
        output.push(`${pathname}/${child}`.replace(/\/+/g, "/"));
      }
    }
  }

  await walk("");
  return output.sort();
}

test("landing alias does not keep unused marketing template and theme customizer files", async () => {
  const landingSource = await readSource("src/app/landing/page.tsx");
  const landingFiles = await listFiles("src/app/landing");
  const globalsSource = await readSource("src/app/globals.css");

  assert.match(landingSource, /redirect\("\/admin\/dashboard"\)/);
  assert.deepEqual(landingFiles, ["src/app/landing/page.tsx"]);

  for (const pathname of [
    "src/components/color-picker.tsx",
    "src/components/pricing-plans.tsx",
    "src/components/dot-pattern.tsx",
    "src/components/image-3d.tsx",
    "src/components/landing/mega-menu.tsx",
    "src/components/theme-customizer/import-modal.tsx",
    "src/components/ui/card-decorator.tsx",
    "src/config/theme-customizer-constants.ts",
    "src/config/theme-data.ts",
    "src/hooks/use-theme-manager.ts",
    "src/types/theme-customizer.ts",
    "src/types/theme.ts",
    "src/utils/shadcn-ui-theme-presets.ts",
    "src/utils/tweakcn-theme-presets.ts",
  ]) {
    assert.equal(await pathExists(pathname), false, pathname);
  }

  assert.doesNotMatch(globalsSource, /logo-scroll/);
  assert.doesNotMatch(globalsSource, /animate-logo-scroll/);
});
