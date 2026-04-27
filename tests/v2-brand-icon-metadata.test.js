import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const layoutFile = path.join(root, "v2", "src", "app", "layout.tsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("v2 app metadata uses the TIPS logo for browser window icons", () => {
  const source = read(layoutFile);

  assert.match(source, /title:\s*"TIPS Dashboard"/);
  assert.match(source, /favicon-window\.png/);
  assert.match(source, /shortcut:\s*"\/favicon-window\.png"/);
  assert.match(source, /apple:\s*"\/favicon\.png"/);
  assert.doesNotMatch(source, /icon:\s*"\/favicon\.png"/);
});
