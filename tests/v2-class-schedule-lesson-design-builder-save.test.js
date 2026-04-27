import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("class schedule lesson-design workspace keeps editable planner controls and save flow in v2", () => {
  const source = read("v2/src/features/operations/class-schedule-workspace.tsx");

  assert.match(source, /from "@\/lib\/class-schedule-planner"/);
  assert.match(source, /const \[lessonPlanDraft, setLessonPlanDraft\] = useState<Record<string, unknown> \| null>\(null\)/);
  assert.match(source, /const \[isLessonDesignSaving, setIsLessonDesignSaving\] = useState\(false\)/);
  assert.match(source, /const \[lessonDesignSaveError, setLessonDesignSaveError\] = useState\(""\)/);
  assert.match(source, /const \[lessonDesignSaveNotice, setLessonDesignSaveNotice\] = useState\(""\)/);
  assert.match(source, /const lessonPlanDefaults = useMemo\(/);
  assert.match(source, /normalizeSchedulePlan\(lessonPlanDraft, lessonPlanDefaults\)/);
  assert.match(source, /buildSchedulePlanForSave\(normalizedLessonPlan, lessonPlanDefaults\)/);
  assert.match(source, /buildLessonDesignSnapshot\(selectedRow, data.textbooks, lessonPlanForSave\)/);
  assert.doesNotMatch(source, /const handleLessonDayToggle = useCallback\(/);
  assert.doesNotMatch(source, /DAY_OPTIONS\.map/);
  assert.doesNotMatch(source, /const handleLessonGlobalSessionCountChange = useCallback\(/);
  assert.match(source, /const handleLessonPeriodChange = useCallback\(/);
  assert.match(source, /const handleAddLessonPeriod = useCallback\(/);
  assert.match(source, /const handleRemoveLessonPeriod = useCallback\(/);
  assert.match(source, /const handleSaveLessonPlan = useCallback\(async \(\) => \{/);
  assert.match(source, /from\("classes"\)\s*\.update\(\{ schedule_plan: lessonPlanForSave \}\)/s);
  assert.match(source, /await refresh\(\)/);
  assert.match(source, /setLessonDesignSaveNotice\("수업계획을 저장했습니다\."\)/);
  assert.match(source, /월 추가/);
  assert.doesNotMatch(source, /생성 구간 추가/);
  assert.match(source, /저장 전 확인/);
  assert.match(source, /lessonDesignReadinessActions\.map\(\(action\) => \(/);
  assert.match(source, /scrollLessonDesignSection\(action\.sectionId\)/);
  assert.doesNotMatch(source, /기본 설정 점검/);
  assert.match(source, /생성 구간 점검/);
  assert.match(source, /저장 중/);
  assert.match(source, /저장/);
  assert.match(source, /시작일/);
  assert.match(source, /종료일/);
  assert.match(source, /handleLessonPeriodChange\(period.id, "startDate"/);
  assert.match(source, /handleLessonPeriodChange\(period.id, "endDate"/);
  assert.match(source, /handleRemoveLessonPeriod\(period.id\)/);
  assert.doesNotMatch(source, /수업 설계 작업 공간/);
  assert.doesNotMatch(source, /선택한 반의 수업계획·수업설계 데이터를 큰 작업 화면에서 검토합니다/);
  assert.doesNotMatch(source, /기본 설정과 생성 기간만 남긴 작업 화면/);
  assert.doesNotMatch(source, /왼쪽에서 일정 생성 범위를 정리하고, 오른쪽에서 캘린더와 회차 흐름을 바로 확인합니다/);
});

test("v2 lesson-design planner library exists for shared schedule-plan generation", () => {
  const source = read("v2/src/lib/class-schedule-planner.js");

  assert.match(source, /function parseSchedule\(scheduleStr = ""\)/);
  assert.match(source, /export function normalizeSchedulePlan\(/);
  assert.match(source, /export function calculateSchedulePlan\(/);
  assert.match(source, /export function buildSchedulePlanForSave\(/);
  assert.match(source, /export function computeAutoEndDate\(/);
  assert.match(source, /export function getSuggestedNextStartDate\(/);
});

test("lesson-design planner reuses prior session ids at most once when weekday scope changes", async () => {
  const plannerModule = await import(pathToFileURL(path.join(root, "v2/src/lib/class-schedule-planner.js")).href);
  const { normalizeSchedulePlan } = plannerModule;

  const defaults = {
    subject: "영어",
    className: "테스트",
    schedule: "금",
    textbooks: [],
  };

  const initialPlan = normalizeSchedulePlan(
    {
      selectedDays: [5],
      globalSessionCount: 4,
      billingPeriods: [{ id: "b1", label: "4월", startDate: "2026-04-01", endDate: "2026-04-30" }],
      textbooks: [],
    },
    defaults,
  );

  const widenedPlan = normalizeSchedulePlan(
    {
      ...initialPlan,
      selectedDays: [4, 5],
    },
    defaults,
  );

  const ids = widenedPlan.sessions.map((session) => session.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    widenedPlan.sessions.filter((session) => session.date === "2026-04-02").map((session) => session.id).length,
    1,
  );
  assert.deepEqual(
    widenedPlan.sessions.filter((session) => session.date === "2026-04-03").map((session) => session.id).length,
    1,
  );
  assert.notEqual(
    widenedPlan.sessions.find((session) => session.date === "2026-04-02")?.id,
    widenedPlan.sessions.find((session) => session.date === "2026-04-03")?.id,
  );
});

test("lesson-design planner keeps overlapping billing-period boundary sessions uniquely keyed", async () => {
  const plannerModule = await import(pathToFileURL(path.join(root, "v2/src/lib/class-schedule-planner.js")).href);
  const { normalizeSchedulePlan, computeAutoEndDate, getSuggestedNextStartDate } = plannerModule;

  const defaults = {
    subject: "영어",
    className: "테스트",
    schedule: "금",
    textbooks: [],
  };

  const addPeriod = (plan) => {
    const billingPeriods = [...(plan.billingPeriods || [])];
    const lastPeriod = billingPeriods[billingPeriods.length - 1] || null;
    const startDate = getSuggestedNextStartDate(lastPeriod?.endDate || "", plan.selectedDays || []);
    const endDate = computeAutoEndDate(startDate, plan.selectedDays || [], Number(plan.globalSessionCount || 0));
    const nextPeriodIndex = billingPeriods.length + 1;
    billingPeriods.push({
      id: `period-${nextPeriodIndex}`,
      month: nextPeriodIndex,
      label: `${nextPeriodIndex}월`,
      startDate,
      endDate,
    });
    return { ...plan, billingPeriods };
  };

  let plan = normalizeSchedulePlan(
    {
      selectedDays: [5],
      globalSessionCount: 4,
      billingPeriods: [{ id: "period-1", month: 1, label: "4월", startDate: "2026-04-03", endDate: "2026-04-24" }],
      textbooks: [],
    },
    defaults,
  );

  for (let index = 0; index < 4; index += 1) {
    plan = normalizeSchedulePlan(addPeriod(plan), defaults);
  }

  const overlappedPlan = normalizeSchedulePlan(
    {
      ...plan,
      billingPeriods: plan.billingPeriods.map((period, index) =>
        index === 1 ? { ...period, endDate: "2026-05-29" } : period,
      ),
    },
    defaults,
  );

  const ids = overlappedPlan.sessions.map((session) => session.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    overlappedPlan.sessions
      .filter((session) => session.date === "2026-05-29")
      .map((session) => session.id),
    [
      "session:005:2026-05-29:period-2:active",
      "session:001:2026-05-29:period-3:active",
    ],
  );
});

test("lesson-design planner labels cross-month billing periods by resolved month end", async () => {
  const plannerModule = await import(pathToFileURL(path.join(root, "v2/src/lib/class-schedule-planner.js")).href);
  const { normalizeSchedulePlan } = plannerModule;

  const plan = normalizeSchedulePlan(
    {
      selectedDays: [3, 0],
      globalSessionCount: 8,
      billingPeriods: [
        { id: "period-1", startDate: "2026-04-01", endDate: "2026-04-26" },
        { id: "period-2", startDate: "2026-04-29", endDate: "2026-05-27" },
        { id: "period-3", startDate: "2026-05-31", endDate: "2026-06-24" },
        { id: "period-4", startDate: "2026-06-28", endDate: "2026-07-29" },
      ],
      textbooks: [],
    },
    { subject: "수학", className: "고1A 공통수학1", schedule: "수 일", textbooks: [] },
  );

  assert.deepEqual(
    plan.billingPeriods.map((period) => period.label),
    ["4월", "5월", "6월", "7월"],
  );
});

test("lesson-design planner keeps generated billing-period ids stable when source periods had no ids", async () => {
  const plannerModule = await import(pathToFileURL(path.join(root, "v2/src/lib/class-schedule-planner.js")).href);
  const { normalizeSchedulePlan } = plannerModule;

  const rawPlan = {
    selectedDays: [3, 0],
    globalSessionCount: 8,
    billingPeriods: [
      { startDate: "2026-04-01", endDate: "2026-04-26" },
      { startDate: "2026-04-29", endDate: "2026-05-27" },
      { startDate: "2026-05-31", endDate: "2026-06-24" },
      { startDate: "2026-06-28", endDate: "2026-07-29" },
    ],
    textbooks: [],
  };
  const defaults = { subject: "수학", className: "고1A 공통수학1", schedule: "수 일", textbooks: [] };

  const first = normalizeSchedulePlan(rawPlan, defaults);
  const second = normalizeSchedulePlan(rawPlan, defaults);

  assert.deepEqual(
    first.billingPeriods.map((period) => period.id),
    second.billingPeriods.map((period) => period.id),
  );
  assert.deepEqual(
    first.sessions.map((session) => session.id),
    second.sessions.map((session) => session.id),
  );
});
