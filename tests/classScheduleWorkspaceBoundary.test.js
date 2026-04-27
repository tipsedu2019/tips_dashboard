import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("app wraps the class schedule workspace with a dedicated boundary", () => {
  const source = read("src/App.jsx");

  assert.match(source, /ClassScheduleWorkspaceBoundary/);
  assert.match(source, /<ClassScheduleWorkspaceBoundary[\s\S]*<ClassScheduleWorkspace/);
});
