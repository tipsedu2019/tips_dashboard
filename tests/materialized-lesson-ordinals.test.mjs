import assert from "node:assert/strict";
import test from "node:test";
import { projectMaterializedLessonOrdinals } from "../src/lib/materialized-lesson-ordinals.js";
import { publicClassSchedule } from "../src/lib/public-class-schedule.js";
import { classWorkspace } from "../src/features/agent-api/server/class-edit-compiler.mjs";

const octoberDates = ["01", "06", "08", "13", "15", "20", "22", "27", "29"];
const period = (id = "october", startDate = "2026-10-01", endDate = "2026-10-29") => ({ id, startDate, endDate, label: "10월", totalSessions: 0 });
const lesson = (date, overrides = {}) => ({
  id: `stored:${date}:skipped`, sessionKey: `stable:${date}`, date, billingId: "october",
  state: "active", scheduleState: "active", sessionNumber: 77, isForced: false,
  originalDate: "", makeupDate: "", startTime: "17:00", endTime: "19:00",
  teacherCatalogId: "synthetic-teacher", classroomCatalogId: "synthetic-room",
  teacherNote: "PRIVATE_ORDINAL_CANARY", unknownField: { kept: true },
  textbookEntries: [{ textbookId: "synthetic-book", plan: { label: "공개 범위" }, teacherOnly: "PRIVATE_ORDINAL_CANARY" }],
  ...overrides,
});
function octoberPlan() {
  return { version: 2, selectedDays: [2, 4], globalSessionCount: 8,
    billingPeriods: [period()], history: [{ id: "history", summary: "KEEP", teacherOnly: "PRIVATE_ORDINAL_CANARY" }],
    sessionStates: { "2026-10-01": { state: "active" }, "2026-10-06": { state: "exception" } },
    sessions: octoberDates.map((day, index) => lesson(`2026-10-${day}`, {
      id: `session:${index === 0 ? "" : `${index}:`}2026-10-${day}:october:${index === 8 ? "exception" : index === 0 ? "skipped" : "active"}`,
      state: index === 1 ? "exception" : "active", scheduleState: index === 1 ? "exception" : "active",
      sessionNumber: index < 2 ? null : index - 1,
    })),
  };
}
const withoutOrdinals = plan => ({ ...plan, sessions: plan.sessions.map(row => {
  const copy = { ...row }; delete copy.sessionNumber; return copy;
}) });
function deepFreeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

test("a corrected sixty-row history derives October ordinals without changing any stored data", () => {
  const saved = octoberPlan();
  for (let month = 4; month <= 9; month += 1) {
    const monthText = String(month).padStart(2, "0"), id = `history-${month}`;
    saved.billingPeriods.unshift(period(id, `2026-${monthText}-01`, `2026-${monthText}-28`));
    const count = month < 7 ? 9 : 8;
    for (let index = 0; index < count; index += 1) saved.sessions.unshift(lesson(`2026-${monthText}-${String(index + 1).padStart(2, "0")}`, {
      billingId: id, sessionNumber: index + 1,
    }));
  }
  const before = structuredClone(saved), projected = projectMaterializedLessonOrdinals(deepFreeze(saved));
  assert.equal(projected.sessions.length, 60);
  assert.deepEqual(projected.sessions.filter(row => row.billingId === "october").map(row => row.sessionNumber), [1, null, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(projected.sessions.map(row => row.id), before.sessions.map(row => row.id));
  assert.deepEqual(withoutOrdinals(projected), withoutOrdinals(before));
  assert.deepEqual(saved, before);
  assert.equal(projected.billingPeriods.find(row => row.id === "october").totalSessions, 0, "derived read does not repair stored period metadata");
  projected.sessions[0].unknownField.kept = false;
  assert.equal(saved.sessions[0].unknownField.kept, true, "nested projection data is detached from the saved plan");
});

test("only existing dated rows count: active and makeup count, exception/skipped/tbd do not", () => {
  const saved = { billingPeriods: [period()], sessions: ["active", "exception", "makeup", "skipped", "tbd"].map((state, index) => lesson(`2026-10-0${index + 1}`, { state, scheduleState: state })) };
  const projected = projectMaterializedLessonOrdinals(saved);
  assert.deepEqual(projected.sessions.map(row => row.sessionNumber), [1, null, 2, null, null]);
  assert.deepEqual(projected.sessions.map(row => row.date), saved.sessions.map(row => row.date));
  assert.equal(projected.sessions.length, 5, "weekly days and period bounds never predict additional sessions");
});

test("chronological counting does not reorder rows or use ID hints, old numbers or forced weekdays", () => {
  const saved = octoberPlan(); saved.sessions.reverse(); saved.sessions.find(row => row.date === "2026-10-08").isForced = true;
  const projected = projectMaterializedLessonOrdinals(saved);
  assert.deepEqual(projected.sessions.map(row => row.id), saved.sessions.map(row => row.id));
  assert.equal(projected.sessions.find(row => row.date === "2026-10-01").sessionNumber, 1);
  assert.equal(projected.sessions.find(row => row.date === "2026-10-29").sessionNumber, 8);
  assert.equal(projected.sessions.find(row => row.date === "2026-10-06").sessionNumber, null);
});

test("an existing in-period cancellation and linked makeup preserve ownership and count the makeup", () => {
  const saved = octoberPlan(); saved.sessions[1].makeupDate = "2026-10-07";
  saved.sessions.splice(2, 0, lesson("2026-10-07", { state: "makeup", scheduleState: "makeup", originalDate: "2026-10-06", isForced: true }));
  const projected = projectMaterializedLessonOrdinals(saved);
  assert.deepEqual(projected.sessions.map(row => row.sessionNumber), [1, null, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(withoutOrdinals(projected), withoutOrdinals(saved));
});

test("explicit compatible aliases count without replacing their canonical booking fields", () => {
  const saved = { billing_periods: [{ period_id: "october", start_date: "2026-10-01", end_date: "2026-10-29" }], sessions: [
    { session_id: "row-1", session_date: "2026-10-01", billing_id: "october", schedule_state: "active", session_number: 9 },
    { session_id: "row-2", session_date: "2026-10-06", billing_id: "october", schedule_state: "exception", session_number: 10 },
  ] };
  const projected = projectMaterializedLessonOrdinals(saved);
  assert.deepEqual(projected.sessions.map(row => row.sessionNumber), [1, null]);
  assert.deepEqual(projected.sessions.map(row => row.session_number), [9, 10]);
  assert.deepEqual(withoutOrdinals(projected), saved);
});

for (const [name, change] of [
  ["unknown current state", p => { p.sessions[0].state = p.sessions[0].scheduleState = "unknown"; }],
  ["missing current state", p => { delete p.sessions[0].state; delete p.sessions[0].scheduleState; }],
  ["conflicting state aliases", p => { p.sessions[0].state = "skipped"; }],
  ["unsupported force_active wire state", p => { p.sessions[0].state = p.sessions[0].scheduleState = "force_active"; }],
  ["missing period ownership", p => { delete p.sessions[0].billingId; }],
  ["unknown period ownership", p => { p.sessions[0].billingId = "unknown"; }],
  ["conflicting ownership aliases", p => { p.sessions[0].billing_id = "other"; }],
  ["duplicate row identity", p => { p.sessions[2].id = p.sessions[0].id; }],
  ["missing row identity", p => { delete p.sessions[0].id; }],
  ["duplicate materialized date", p => { p.sessions[2].date = p.sessions[0].date; }],
  ["invalid row calendar date", p => { p.sessions[0].date = "2026-02-30"; }],
  ["row before period boundary", p => { p.sessions[0].date = "2026-09-30"; }],
  ["row after period boundary", p => { p.sessions[0].date = "2026-10-30"; }],
  ["forced row before boundary", p => { p.sessions[0].date = "2026-09-30"; p.sessions[0].isForced = true; }],
  ["malformed forced marker", p => { p.sessions[0].isForced = "false"; }],
  ["makeup link outside period", p => { p.sessions[1].makeupDate = "2026-11-01"; }],
  ["original link outside period", p => { p.sessions[2].state = p.sessions[2].scheduleState = "makeup"; p.sessions[2].originalDate = "2026-09-30"; }],
  ["self-linked cancellation", p => { p.sessions[1].makeupDate = p.sessions[1].date; }],
  ["malformed or contradictory link", p => { p.sessions[1].makeupDate = "2026-10-07"; p.sessions[1].makeup_date = "2026-10-08"; }],
  ["link on unsupported current state", p => { p.sessions[0].originalDate = "2026-10-06"; }],
  ["duplicate period identity", p => { p.billingPeriods.push({ ...p.billingPeriods[0] }); }],
  ["overlapping explicit periods", p => { p.billingPeriods.push(period("second", "2026-10-29", "2026-11-20")); }],
  ["missing explicit boundary", p => { delete p.billingPeriods[0].startDate; }],
  ["invalid period calendar date", p => { p.billingPeriods[0].startDate = "2026-02-30"; }],
  ["reversed period range", p => { p.billingPeriods[0].startDate = "2026-10-30"; }],
  ["malformed session object", p => { p.sessions.push(null); }],
]) test(`${name} preserves stored ordinals and every original field`, () => {
  const saved = octoberPlan(); change(saved); const before = structuredClone(saved);
  const observed = [];
  assert.deepEqual(projectMaterializedLessonOrdinals(saved, { onDerived: (...args) => observed.push(args) }), before);
  assert.deepEqual(observed, [], "ambiguous periods never report a derived display value");
  assert.deepEqual(saved, before);
});

test("ambiguity in another known period does not prevent an independent valid period projection", () => {
  const saved = octoberPlan(); saved.billingPeriods.push(period("november", "2026-11-01", "2026-11-30"));
  saved.sessions.push(lesson("2026-11-03", { billingId: "november", state: "unknown", scheduleState: "unknown", sessionNumber: 91 }));
  const projected = projectMaterializedLessonOrdinals(saved);
  assert.equal(projected.sessions[0].sessionNumber, 1);
  assert.equal(projected.sessions.at(-1).sessionNumber, 91);
});

test("missing or malformed period/session collections remain unchanged", () => {
  for (const saved of [null, undefined, [], {}, { sessions: [] }, { billingPeriods: [], sessions: [lesson("2026-10-01")] }, { billingPeriods: [period()], sessions: "invalid" }]) {
    assert.deepEqual(projectMaterializedLessonOrdinals(saved), saved);
  }
});

test("the observer exposes only indices and nullable ordinals for eligible existing rows", () => {
  const saved = octoberPlan(); saved.sessions.reverse(); const before = structuredClone(saved), observed = [];
  const projected = projectMaterializedLessonOrdinals(deepFreeze(saved), { onDerived: (...args) => observed.push(args) });
  assert.deepEqual(observed, [[8, 1], [7, null], [6, 2], [5, 3], [4, 4], [3, 5], [2, 6], [1, 7], [0, 8]]);
  assert.ok(observed.every(args => args.length === 2 && typeof args[0] === "number" && (args[1] === null || typeof args[1] === "number")));
  assert.deepEqual(withoutOrdinals(projected), withoutOrdinals(before));
  assert.deepEqual(saved, before);
  assert.deepEqual(projectMaterializedLessonOrdinals(saved), projected, "one-argument callers retain the same cloned projection");
});

test("the observer ignores blocked periods while reporting independent validated entries", () => {
  const saved = octoberPlan(), observed = [];
  saved.billingPeriods.push(period("november", "2026-11-01", "2026-11-30"));
  saved.sessions.push(lesson("2026-11-03", { billingId: "november", state: "unknown", scheduleState: "unknown", sessionNumber: 91 }));
  const projected = projectMaterializedLessonOrdinals(saved, { onDerived: (...args) => observed.push(args) });
  assert.equal(observed.length, 9); assert.ok(observed.every(([index]) => index < 9));
  assert.equal(projected.sessions.at(-1).sessionNumber, 91);
});

test("whole-plan rejection and missing collections never invoke the observer", () => {
  const duplicate = octoberPlan(); duplicate.sessions.at(-1).id = duplicate.sessions[0].id;
  for (const saved of [null, undefined, {}, duplicate, { sessions: [], billingPeriods: [{ id: "broken" }] }]) {
    const observed = [];
    assert.deepEqual(projectMaterializedLessonOrdinals(saved, { onDerived: (...args) => observed.push(args) }), saved);
    assert.deepEqual(observed, []);
  }
});

test("display derivation preserves raw public booking numbers and the public materialized-only privacy contract", () => {
  const saved = octoberPlan(), before = publicClassSchedule(saved);
  const display = projectMaterializedLessonOrdinals(saved), after = publicClassSchedule(saved);
  assert.deepEqual(after, before, "public serializer still receives raw booking identity values");
  assert.equal(display.sessions.find(row => row.date === "2026-10-08").sessionNumber, 2);
  assert.equal(after.sessions.find(row => row.date === "2026-10-08").sessionNumber, 1);
  assert.equal(after.sessions.find(row => row.date === "2026-10-01").sessionNumber, undefined);
  assert.equal(`${after.sessions.find(row => row.date === "2026-10-08").date}:${after.sessions.find(row => row.date === "2026-10-08").sessionNumber}`, "2026-10-08:1");
  assert.deepEqual(after.sessions.map(row => row.id), saved.sessions.map(row => row.id));
  assert.equal(after.sessions.length, 9); assert.ok(!JSON.stringify(after).includes("PRIVATE_ORDINAL_CANARY"));
});

test("agent v2 workspace and verification hash do not acquire an ordinal field or change", () => {
  const plan = octoberPlan(), context = { id: "synthetic-class", version: "a".repeat(64), storageMode: "legacy", basic: { name: "가상 수업", subject: "영어" }, weeklySlots: [], weeklyScheduleComplete: true, catalogs: { teachers: [], classrooms: [] }, plan };
  const window = { from: "2026-10-01", to: "2026-10-29" }, before = classWorkspace(context, window);
  const display = projectMaterializedLessonOrdinals(plan);
  assert.deepEqual(classWorkspace(context, window), before);
  assert.deepEqual(classWorkspace({ ...context, plan: display }, window), before);
  assert.ok(before.lessons.every(row => !Object.hasOwn(row, "sessionNumber")));
});
