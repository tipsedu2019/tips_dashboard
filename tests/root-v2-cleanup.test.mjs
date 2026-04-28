import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("project root is promoted to the v2 Next app", () => {
  assert.equal(fs.existsSync(path.join(repoRoot, "v2")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "vite.config.js")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "next.config.ts")), true);

  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.scripts.dev, "next dev");
  assert.equal(packageJson.scripts.build, "next build");
});

test("public routes no longer redirect to legacy static bundles", () => {
  for (const route of [
    "src/app/page.tsx",
    "src/app/classes/page.tsx",
    "src/app/reviews/page.tsx",
    "src/app/results/page.tsx",
  ]) {
    const source = read(route);
    assert.equal(source.includes("legacy-public"), false, route);
    assert.equal(source.includes("next/navigation"), false, route);
  }

  assert.equal(fs.existsSync(path.join(repoRoot, "public", "legacy-public")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "public", "assets")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "public", "embedded")), false);
});
