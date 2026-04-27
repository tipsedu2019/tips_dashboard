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

test("lesson-design page route keeps a dedicated workspace entrypoint wired from curriculum links while legacy class-schedule route redirects", () => {
  const workspaceSource = read("v2/src/features/operations/class-schedule-workspace.tsx");
  const curriculumPageSource = read("v2/src/app/admin/curriculum/lesson-design/page.tsx");
  const legacyPageSource = read("v2/src/app/admin/class-schedule/lesson-design/page.tsx");

  assert.match(workspaceSource, /const classScheduleWorkspaceContent = \(/);
  assert.match(workspaceSource, /\{!isLessonDesignPage \? classScheduleWorkspaceContent : null\}/);
  assert.match(workspaceSource, /buildLessonDesignPageHref/);
  assert.match(workspaceSource, /buildCurriculumWorkspaceHref/);
  assert.match(workspaceSource, /params.set\("section", resolvedSectionId\)/);
  assert.match(workspaceSource, /params.delete\("section"\)/);
  assert.match(workspaceSource, /resolveLessonDesignSectionId/);
  assert.match(workspaceSource, /return `\/admin\/curriculum\/lesson-design\?\$\{params\.toString\(\)\}`;/);
  assert.match(workspaceSource, /pathname\.endsWith\("\/lesson-design"\)/);
  assert.match(workspaceSource, /const isLessonDesignPage = pathname\.endsWith\("\/lesson-design"\)/);
  assert.match(workspaceSource, /const requestedLessonDesignSectionId = resolveLessonDesignSectionId\(text\(searchParams.get\("section"\)\)\)/);
  assert.match(workspaceSource, /const requestedLessonMonthKeys = text\(searchParams.get\("lessonMonths"\)\)/);
  assert.match(workspaceSource, /const requestedLessonPeriodId = text\(searchParams.get\("lessonPeriod"\)\) \|\| "all"/);
  assert.match(workspaceSource, /const requestedLessonScheduleState = resolveLessonDesignScheduleState\(/);
  assert.doesNotMatch(workspaceSource, /const requestedLessonStatus = resolveLessonDesignStatus\(text\(searchParams.get\("lessonStatus"\)\)\)/);
  assert.match(workspaceSource, /const closeLessonDesignWorkspace = useCallback\(/);
  assert.match(workspaceSource, /buildCurriculumWorkspaceHref\(new URLSearchParams\(searchParams\.toString\(\)\)\)/);
  assert.match(workspaceSource, /const openLessonDesignPageForRow = useCallback\(/);
  assert.match(workspaceSource, /const targetSectionId =/);
  assert.doesNotMatch(workspaceSource, /LESSON_DESIGN_SECTION_IDS\.overview/);
  assert.match(workspaceSource, /LESSON_DESIGN_SECTION_IDS\.periods/);
  assert.match(workspaceSource, /router\.push\(buildLessonDesignPageHref\(row, resolvedSessionId, targetSectionId\), \{/);
  assert.match(workspaceSource, /if \(!isLessonDesignPage\) \{/);
  assert.match(workspaceSource, /router\.replace\(buildLessonDesignPageHref\(targetRow, requestedSessionId \|\| "", targetSectionId\), \{/);
  assert.match(workspaceSource, /const navigateToLessonDesignSection = useCallback\(/);
  assert.match(workspaceSource, /const focusLessonDesignSession = useCallback\(/);
  assert.match(workspaceSource, /setSelectedLessonSessionId\(resolvedSessionId\)/);
  assert.match(workspaceSource, /const shouldSyncLessonMonths =/);
  assert.match(workspaceSource, /searchParams.has\("lessonMonths"\)/);
  assert.match(workspaceSource, /const defaultLessonMonthKeys = lessonDesignSnapshot/);
  assert.match(workspaceSource, /!areSameLessonMonthSelection\(selectedLessonMonthKeys, defaultLessonMonthKeys\)/);
  assert.match(workspaceSource, /setSelectedLessonMonthKeys\(/);
  assert.match(workspaceSource, /setSelectedLessonPeriodId\(requestedLessonPeriodId\)/);
  assert.match(workspaceSource, /setSelectedLessonScheduleState\(requestedLessonScheduleState\)/);
  assert.doesNotMatch(workspaceSource, /setSelectedLessonStatus\(requestedLessonStatus\)/);
  assert.match(workspaceSource, /navigateToLessonDesignSection\(targetSectionId, targetRow, resolvedSessionId\)/);
  assert.match(workspaceSource, /router.replace\(buildLessonDesignPageHref\(row, resolvedSessionId, resolvedSectionId\), \{/);
  assert.match(workspaceSource, /window\.requestAnimationFrame/);
  assert.match(workspaceSource, /window\.cancelAnimationFrame/);
  assert.match(workspaceSource, /isLessonDesignPage \? \(/);
  assert.match(workspaceSource, /연결된 수업계획이 없습니다\./);
  assert.match(workspaceSource, /반 목록 점검/);
  assert.match(workspaceSource, /교재 목록 점검/);
  assert.match(workspaceSource, /href="\/admin\/classes"/);
  assert.match(workspaceSource, /href="\/admin\/textbooks"/);
  assert.match(workspaceSource, /ArrowLeft/);
  assert.match(workspaceSource, /row\.nextActionSessionId \|\| ""/);
  assert.match(workspaceSource, /href=\{buildLessonDesignPageHref\(/);
  assert.doesNotMatch(workspaceSource, /lessonDesignPageNavigatorSections\.map/);
  assert.doesNotMatch(workspaceSource, /activeLessonDesignSectionId/);
  assert.doesNotMatch(workspaceSource, /currentLessonDesignWorkflowStep/);
  assert.doesNotMatch(workspaceSource, /activeLessonDesignSectionLabel/);

  assert.match(curriculumPageSource, /import type \{ Metadata \} from "next";/);
  assert.match(curriculumPageSource, /export const metadata: Metadata = \{/);
  assert.match(curriculumPageSource, /title: "수업 설계 \| TIPS Dashboard"/);
  assert.match(curriculumPageSource, /description: "반별 수업계획·수업설계 검토를 위한 전용 작업 화면입니다\."/);
  assert.match(curriculumPageSource, /ClassScheduleWorkspace/);
  assert.match(curriculumPageSource, /export default function CurriculumLessonDesignPage/);

  assert.match(legacyPageSource, /redirect\(query \? `\/admin\/curriculum\/lesson-design\?\$\{query\}` : "\/admin\/curriculum\/lesson-design"\);/);
  assert.doesNotMatch(legacyPageSource, /ClassScheduleWorkspace/);
});
