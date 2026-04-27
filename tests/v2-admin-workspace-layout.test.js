import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

const cases = [
  {
    file: path.join(root, "v2", "src", "features", "management", "management-page.tsx"),
    absent: ["Live management", "ManagementStatCards"],
  },
  {
    file: path.join(root, "v2", "src", "features", "operations", "academic-calendar-workspace.tsx"),
    absent: ["ShadcnStore calendar", "AcademicStatCard"],
  },
  {
    file: path.join(root, "v2", "src", "features", "operations", "academic-annual-board-workspace.tsx"),
    absent: ["Annual school board", "AcademicStatCard"],
  },
  {
    file: path.join(root, "v2", "src", "features", "operations", "class-schedule-workspace.tsx"),
    absent: ["Live class schedule", "AcademicStatCard"],
  },
  {
    file: path.join(root, "v2", "src", "features", "academic", "timetable-workspace.tsx"),
    absent: ["Live timetable", "AcademicStatCard"],
  },
  {
    file: path.join(root, "v2", "src", "features", "academic", "curriculum-workspace.tsx"),
    absent: ["Live planning", "AcademicStatCard"],
  },
];

for (const { file, absent } of cases) {
  test(`${path.basename(file)} omits top intro and stat-card markers`, () => {
    const source = fs.readFileSync(file, "utf8");

    for (const marker of absent) {
      assert.equal(
        source.includes(marker),
        false,
        `${path.basename(file)} should not include "${marker}"`,
      );
    }
  });
}
