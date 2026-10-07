import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs";

// Exercise the production TypeScript workspace and shared Radix Popover. JSDOM
// verifies rendered content/interactions, not CSS layout or viewport geometry.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://test.invalid/admin/academic-annual-board?year=2026",
  pretendToBeVisual: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const name of ["window", "self", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "NodeFilter", "DocumentFragment", "Event", "CustomEvent", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
window.HTMLElement.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};
window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

const boardTypes = ["시험기간", "영어시험일", "수학시험일", "과학시험일", "체험학습", "방학·휴일·기타", "팁스"];

// Representative non-empty get_operations_annual_board_v1 producer
// projection: identity stays outside displayMeta; nullable curriculum links and
// auth roles are retained. Dates below are projected values, not a test
// implementation of the SQL metadata parser. The RPC itself is never executed.
function projectedEntry(patch = {}) {
  return {
    id: "7a000000-0000-4000-8000-000000000001",
    parentEventId: "7a000000-0000-4000-8000-000000000001",
    sourceKind: "academic_event",
    title: "2학기 중간고사",
    type: "시험기간",
    start: "2026-10-06",
    end: "2026-10-08",
    dateLabel: "2026-10-06 ~ 2026-10-08",
    schoolId: "7b000000-0000-4000-8000-000000000001",
    schoolName: "기간검수고",
    grade: "고1",
    gradeBadges: ["고1"],
    examTerm: "2학기 중간",
    examDateLabel: "2026-10-06",
    linkedScheduleLabel: null,
    scopeSummary: null,
    scienceAreaKey: null,
    scienceAreaLabel: null,
    academyCurriculumPlanId: null,
    curriculumProfileId: null,
    textbookScope: null,
    subtextbookScope: null,
    textbookScopes: [],
    subtextbookScopes: [],
    displayMeta: { examTerm: "2학기 중간", rangeEnd: "2026-10-08" },
    metaBadges: [],
    materialSections: [],
    displaySections: [],
    notePreview: null,
    color: "bg-rose-500",
    revision: 0,
    ...patch,
  };
}

function rpcResponse(entries) {
  const rows = new Map();
  for (const entry of entries) {
    const key = `${entry.schoolName}:${entry.grade}`;
    if (!rows.has(key)) rows.set(key, {
      id: `${entry.schoolId}:${entry.grade}`, schoolId: entry.schoolId, schoolName: entry.schoolName,
      category: "high", grade: entry.grade, gradeValues: [entry.grade],
      gradeBadges: [entry.grade], totalEvents: 0,
      typeBuckets: Object.fromEntries(boardTypes.map(type => [type, []])),
    });
    const row = rows.get(key);
    row.typeBuckets[entry.type].push(entry);
    row.totalEvents += 1;
  }
  return {
    ok: true,
    data: {
      academicYear: 2026, selectedSemester: "all", yearOptions: [2026],
      rows: [...rows.values()],
      summary: { schoolCount: rows.size, eventCount: entries.length, activeTypeCount: new Set(entries.map(entry => entry.type)).size },
    },
  };
}

async function setup(t, data) {
  const calls = [];
  const params = new URLSearchParams("year=2026");
  const { AcademicAnnualBoardWorkspace } = loadNotificationComponent("src/features/operations/academic-annual-board-workspace.tsx", new Map([
    ["next/navigation", { useRouter: () => ({ push() { throw new Error("unexpected navigation"); } }), useSearchParams: () => params }],
    ["@/providers/auth-provider", { useAuth: () => ({ canManageAll: false, user: null, profile: null, role: null }) }],
    ["@/lib/supabase", { supabase: null }],
    ["./use-operations-workspace-data", { useOperationsWorkspaceData: request => {
      calls.push(request);
      return { data, densityError: null, loading: false, error: null, refresh: async () => { throw new Error("unexpected refresh"); }, loadEventDetail: async () => { throw new Error("unexpected detail RPC"); } };
    } }],
    ["sonner", { toast: { success() {}, error() {}, info() {} } }],
  ]));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(AcademicAnnualBoardWorkspace)));
  t.after(async () => { await act(async () => root.unmount()); host.remove(); });
  assert.ok(calls.length > 0);
  assert.ok(calls.every(request => request.mode === "annual" && request.academicYear === 2026));
  return { host };
}

function typeLabel(type) {
  return ({ "영어시험일": "영어", "수학시험일": "수학", "과학시험일": "과학", "방학·휴일·기타": "방학·기타" })[type] || type;
}

function cell(host, surface, school, type = "시험기간", term = "2학기 중간") {
  const region = surface === "desktop"
    ? host.querySelector('[aria-label="학교별 연간 일정 비교"]')
    : host.querySelector('[data-testid="annual-board-mobile-list"]');
  assert.ok(region, surface);
  const prefix = `${school} 고1 ${term} ${typeLabel(type)}: `;
  const result = [...region.querySelectorAll("button")].find(node => node.getAttribute("aria-label")?.startsWith(prefix));
  assert.ok(result, `${surface} ${prefix}`);
  return result;
}

async function waitFor(predicate) {
  for (let i = 0; i < 60; i++) {
    if (predicate()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  assert.ok(predicate(), "expected Popover state");
}

async function assertCellAndDetail(host, surface, school, compact, detail, type = "시험기간", term = "2학기 중간") {
  const trigger = cell(host, surface, school, type, term);
  assert.equal(trigger.textContent.trim(), compact);
  assert.ok(trigger.getAttribute("aria-label").endsWith(`: ${compact}`));
  await act(async () => { trigger.focus(); trigger.click(); });
  const selector = '[data-slot="popover-content"][data-state="open"]';
  await waitFor(() => document.querySelector(selector));
  const content = document.querySelector(selector);
  assert.equal(content.getAttribute("aria-label"), `${school} 고1 ${term} ${typeLabel(type)} 상세`);
  assert.equal(content.querySelector(".annual-board-hover-value").textContent.trim(), detail);
  assert.equal([...content.querySelectorAll("button")].find(node => node.textContent.trim() === "수정")?.disabled, true, "nullable role stays read-only");
  await act(async () => content.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await waitFor(() => !document.querySelector(selector) && document.activeElement === trigger);
  assert.equal(document.activeElement === trigger, true, "Escape restores the original cell focus");
}

test("projected RPC periods, direct subject ranges and exact subject dates reach both rendered surfaces and real Popover details", async t => {
  const entries = [
    projectedEntry(),
    projectedEntry({ id: "7a000000-0000-4000-8000-000000000002", parentEventId: "7a000000-0000-4000-8000-000000000002", type: "영어시험일", title: "영어 시험일 및 시험범위" }),
    projectedEntry({ id: "exam-detail:7c000000-0000-4000-8000-000000000001", sourceKind: "academic_event_exam_detail", type: "수학시험일", title: "수학 시험일 및 시험범위", start: "2026-10-07", end: "2026-10-07", dateLabel: "2026-10-07", examDateLabel: "2026-10-07" }),
    projectedEntry({ id: "7a000000-0000-4000-8000-000000000003", parentEventId: "7a000000-0000-4000-8000-000000000003", type: "과학시험일", title: "과학 시험일 및 시험범위", scienceAreaKey: "physics", scienceAreaLabel: "물리" }),
    projectedEntry({ id: "7a000000-0000-4000-8000-000000000004", parentEventId: "7a000000-0000-4000-8000-000000000004", type: "체험학습", title: "체험학습", examTerm: null, displayMeta: { rangeEnd: "2026-10-08" } }),
    projectedEntry({ id: "7a000000-0000-4000-8000-000000000005", parentEventId: "7a000000-0000-4000-8000-000000000005", type: "방학·휴일·기타", title: "휴일 일정", examTerm: null, displayMeta: { rangeEnd: "2026-10-08" } }),
  ];
  const { host } = await setup(t, rpcResponse(entries));
  for (const surface of ["desktop", "mobile"]) {
    for (const type of ["시험기간", "영어시험일", "과학시험일"]) {
      await assertCellAndDetail(host, surface, "기간검수고", "10/6~10/8", "10/6(화) ~ 10/8(목)", type);
    }
    await assertCellAndDetail(host, surface, "기간검수고", "10/7", "10/7(수)", "수학시험일");
    await assertCellAndDetail(host, surface, "기간검수고", "10/6~10/8", "10/6(화) ~ 10/8(목)", "체험학습", "체험");
    await assertCellAndDetail(host, surface, "기간검수고", "10/6~10/8", "10/6(화) ~ 10/8(목)", "방학·휴일·기타", "방학");
  }
});

test("same/missing end and month/year boundaries preserve inclusive dates without collapsing cross-year same month/day", async t => {
  const cases = [
    ["동일일고", "2026-10-06", "2026-10-06", "2026-10-06", "10/6", "10/6(화)"],
    ["종료저장없음고", "2026-10-06", "2026-10-06", "2026-10-06", "10/6", "10/6(화)"],
    // Null projected end is an older/incomplete consumer response, whereas the
    // current producer resolves an absent stored rangeEnd to the start date.
    ["종료없음고", "2026-10-06", null, "2026-10-06", "10/6", "10/6(화)"],
    ["월경계고", "2026-10-31", "2026-11-02", "2026-10-31 ~ 2026-11-02", "10/31~11/2", "10/31(토) ~ 11/2(월)"],
    ["연경계고", "2026-12-31", "2027-01-02", "2026-12-31 ~ 2027-01-02", "2026/12/31~2027/1/2", "2026/12/31(목) ~ 2027/1/2(토)"],
    ["다른연도동일일고", "2026-10-06", "2027-10-06", "2026-10-06 ~ 2027-10-06", "2026/10/6~2027/10/6", "2026/10/6(화) ~ 2027/10/6(수)"],
  ];
  const { host } = await setup(t, rpcResponse(cases.map(([schoolName, start, end, dateLabel], index) => projectedEntry({ id: `boundary-${index}`, schoolId: `7b000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`, schoolName, start, end, dateLabel, examDateLabel: start, displayMeta: end && schoolName !== "종료저장없음고" ? { rangeEnd: end } : {} }))));
  for (const surface of ["desktop", "mobile"]) {
    for (const [school, , , , compact, detail] of cases) await assertCellAndDetail(host, surface, school, compact, detail);
  }
});

test("canonical fields override a stale display label, while invalid ISO dates never become rolled calendar dates", async t => {
  // Invalid ISO dates cannot be PostgreSQL date output. These are explicit
  // consumer robustness fixtures, kept separate from the producer fixture.
  const cases = [
    ["표시회귀고", { dateLabel: "2026-10-06" }, "10/6~10/8", "10/6(화) ~ 10/8(목)"],
    ["과목표시회귀고", { type: "영어시험일", dateLabel: "2026-10-06" }, "10/6~10/8", "10/6(화) ~ 10/8(목)"],
    ["잘못된종료고", { start: "2026-02-28", end: "2026-02-30", dateLabel: "2026-02-28 ~ 2026-02-30" }, "2/28", "2/28(토)"],
    ["잘못된시작고", { start: "2026-02-30", end: "2026-03-02", dateLabel: "2026-02-28" }, "—", "—"],
    ["윤년고", { start: "2024-02-29", end: "2024-03-01", dateLabel: "2024-02-29 ~ 2024-03-01" }, "2/29~3/1", "2/29(목) ~ 3/1(금)"],
    ["역순종료고", { start: "2026-10-06", end: "2026-10-05", dateLabel: "2026-10-06 ~ 2026-10-05" }, "10/6", "10/6(화)"],
    ["날짜라벨호환고", { start: "", end: "", dateLabel: "2026-10-06 ~ 2026-10-08" }, "10/6~10/8", "10/6(화) ~ 10/8(목)"],
  ];
  const { host } = await setup(t, rpcResponse(cases.map(([schoolName, patch], index) => projectedEntry({ id: `robustness-${index}`, schoolId: `7b000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`, schoolName, ...patch }))));
  for (const surface of ["desktop", "mobile"]) {
    for (const [school, patch, compact, detail] of cases) await assertCellAndDetail(host, surface, school, compact, detail, patch.type || "시험기간");
  }
});

test("actual RPC material fallback keeps its existing single exam label instead of inheriting the parent range", async t => {
  const entry = projectedEntry({
    id: "material-fallback:7a000000-0000-4000-8000-000000000001:영어시험일",
    sourceKind: "academic_event_material_fallback", type: "영어시험일",
    title: "영어 시험일 및 시험범위",
    textbookScopes: [{ name: "영어 교과서", publisher: "검수출판사", scope: "3단원" }],
  });
  assert.equal(entry.subjectSummary, undefined, "the real producer signals this case through sourceKind");
  const { host } = await setup(t, rpcResponse([entry]));
  for (const surface of ["desktop", "mobile"]) {
    await assertCellAndDetail(host, surface, "기간검수고", "10/6", "10/6(화)", "영어시험일");
  }
});

test("legacy subject summaries retain missing/TBD exam date labels without inheriting their parent period", async t => {
  // Legacy model subjectSummary entries are a consumer compatibility contract;
  // the current annual RPC does not emit subjectSummary.
  const entries = [
    projectedEntry({ id: "summary-missing", type: "영어시험일", subjectSummary: true, examDateLabel: "시험일 미입력" }),
    projectedEntry({ id: "summary-tbd", type: "수학시험일", subjectSummary: true, examDateLabel: "미정" }),
    projectedEntry({ id: "summary-single", type: "과학시험일", subjectSummary: true, examDateLabel: "2026-10-07" }),
  ];
  const { host } = await setup(t, rpcResponse(entries));
  for (const surface of ["desktop", "mobile"]) {
    await assertCellAndDetail(host, surface, "기간검수고", "미입력", "시험일 미입력", "영어시험일");
    await assertCellAndDetail(host, surface, "기간검수고", "미정", "미정", "수학시험일");
    await assertCellAndDetail(host, surface, "기간검수고", "10/7", "10/7(수)", "과학시험일");
    assert.equal(cell(host, surface, "기간검수고", "영어시험일", "2학기 기말").textContent.trim(), "—", "another exam term does not borrow the parent's date");
  }
});

test("date-only range content and weekdays stay stable across negative and positive timezone offsets", async t => {
  const previousTimezone = process.env.TZ;
  t.after(() => { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone; });
  for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Seoul", "Pacific/Kiritimati"]) {
    await t.test(timezone, async subtest => {
      process.env.TZ = timezone;
      const { host } = await setup(subtest, rpcResponse([projectedEntry()]));
      for (const surface of ["desktop", "mobile"]) await assertCellAndDetail(host, surface, "기간검수고", "10/6~10/8", "10/6(화) ~ 10/8(목)");
    });
  }
});
