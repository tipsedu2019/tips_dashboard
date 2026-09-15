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
  assert.equal(packageJson.scripts.build, "next build --webpack");
});

test("legacy public bundles are absent", () => {
  for (const directory of ["legacy-public", "assets", "embedded"]) {
    assert.equal(fs.existsSync(path.join(repoRoot, "public", directory)), false);
  }
});
