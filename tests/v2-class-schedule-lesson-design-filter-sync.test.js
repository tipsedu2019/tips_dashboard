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

test("lesson-design page stops forcing month/period filters back from stale session query state", () => {
  const source = read("v2/src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /if \(!isLessonDesignPage \|\| !lessonDesignSnapshot \|\| lessonDesignOpen\) \{/);
  assert.match(source, /searchParams\.has\("lessonMonths"\) &&/);
  assert.match(source, /searchParams\.has\("lessonPeriod"\) &&/);
  assert.match(source, /setSelectedLessonMonthKeys\([\s\S]*fallbackToDefault: false/);
  assert.match(source, /setSelectedLessonPeriodId\(requestedLessonPeriodId\)/);
  assert.match(source, /setSelectedLessonMonthKeys\([\s\S]*getDefaultLessonMonthKeys\(nextLessonDesignSnapshot\.monthSummaries\)/);
  assert.match(source, /setSelectedLessonPeriodId\("all"\)/);
  assert.doesNotMatch(source, /targetSession\?\.monthKey[\s\S]*setSelectedLessonMonthKeys/);
  assert.doesNotMatch(source, /targetSession\?\.periodId \|\| "all"/);
});
