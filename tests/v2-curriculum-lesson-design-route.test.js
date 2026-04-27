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

test("lesson-design lives under curriculum and legacy class-schedule route redirects there", () => {
  const curriculumWorkspaceSource = read("v2/src/features/academic/curriculum-workspace.tsx");
  const classScheduleWorkspaceSource = read("v2/src/features/operations/class-schedule-workspace.tsx");
  const curriculumLessonDesignPageSource = read("v2/src/app/admin/curriculum/lesson-design/page.tsx");
  const legacyLessonDesignPageSource = read("v2/src/app/admin/class-schedule/lesson-design/page.tsx");

  assert.match(curriculumWorkspaceSource, /return `\/admin\/curriculum\/lesson-design\?\$\{params\.toString\(\)\}`;/);
  assert.match(classScheduleWorkspaceSource, /return `\/admin\/curriculum\/lesson-design\?\$\{params\.toString\(\)\}`;/);
  assert.match(classScheduleWorkspaceSource, /return `\/admin\/curriculum\?\$\{params\.toString\(\)\}`;/);
  assert.match(classScheduleWorkspaceSource, /buildCurriculumWorkspaceHref/);
  assert.match(curriculumLessonDesignPageSource, /export default function CurriculumLessonDesignPage/);
  assert.match(curriculumLessonDesignPageSource, /ClassScheduleWorkspace/);
  assert.match(legacyLessonDesignPageSource, /redirect\(query \? `\/admin\/curriculum\/lesson-design\?\$\{query\}` : "\/admin\/curriculum\/lesson-design"\);/);
  assert.doesNotMatch(legacyLessonDesignPageSource, /ClassScheduleWorkspace/);
});
