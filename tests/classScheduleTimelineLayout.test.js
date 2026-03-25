import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { getTimelineRowEstimate } from "../src/components/class-schedule/classScheduleWorkspaceUtils.js";

const root = path.resolve("C:/Antigravity/tips_dashboard");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("timeline row estimates stay large enough to avoid class/textbook overlap", () => {
  assert.ok(getTimelineRowEstimate("class") >= 120);
  assert.ok(getTimelineRowEstimate("textbook") >= 44);
  assert.ok(getTimelineRowEstimate("class") > getTimelineRowEstimate("textbook"));
});

test("timeline rows use dynamic measurement so expanded textbook rows do not clip", () => {
  const source = read("src/components/class-schedule/ClassScheduleTimelineView.jsx");

  assert.match(source, /data-index=\{virtualRow\.index\}/);
  assert.match(source, /measureElement/);
});
