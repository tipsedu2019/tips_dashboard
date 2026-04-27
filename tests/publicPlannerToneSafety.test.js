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

test("public planner timetable tones keep explicit fallback colors for subject badges and cells", () => {
  const source = read("src/components/PublicClassLandingView.jsx");

  assert.match(source, /const PLANNER_SUBJECT_TONES = \{/);
  assert.match(source, /수학:[\s\S]*key:\s*'math'[\s\S]*bg:\s*'#eff6ff'[\s\S]*border:\s*'#93c5fd'[\s\S]*text:\s*'#1d4ed8'/);
  assert.match(source, /영어:[\s\S]*key:\s*'english'[\s\S]*bg:\s*'#fff1f2'[\s\S]*border:\s*'#fda4af'[\s\S]*text:\s*'#be123c'/);

  assert.match(
    source,
    /const PLANNER_TIMETABLE_TONES = \[[\s\S]*bg:\s*'#eff6ff'[\s\S]*bg:\s*'#eafaf6'[\s\S]*bg:\s*'#ecfdf5'[\s\S]*bg:\s*'#fff7ed'[\s\S]*bg:\s*'#fff1f2'/,
  );

  assert.match(
    source,
    /function getPlannerToneForClass\(classItem, index = 0\) \{[\s\S]*if \(PLANNER_SUBJECT_TONES\[subject\]\) \{\s*return PLANNER_SUBJECT_TONES\[subject\]\.timetable;/,
  );
});
