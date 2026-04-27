import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const cssPath = path.join(root, "src", "index.css");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("embedded public view uses a dedicated bottom-nav height variable", () => {
  const source = read(cssPath);

  assert.match(source, /\.public-landing-shell\.has-embedded-view\s*\{\s*--public-embedded-bottom-nav-height:\s*74px;/);
  assert.match(
    source,
    /height:\s*calc\(\s*100vh - var\(--public-embedded-bottom-nav-height\) - var\(--shell-safe-bottom\)\s*\);/,
  );
});

test("embedded public view reduces the reserved nav height on desktop", () => {
  const source = read(cssPath);

  assert.match(source, /@media \(min-width: 769px\)\s*\{\s*\.public-landing-shell\.has-embedded-view\s*\{\s*--public-embedded-bottom-nav-height:\s*56px;/);
  assert.doesNotMatch(source, /height:\s*calc\(100vh - 82px - var\(--shell-safe-bottom\)\)/);
});
