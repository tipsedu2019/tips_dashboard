import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClassesSummaryApiResponder } from "../src/server/public-classes-summary-api.js";

const timestamp = "2026-09-12T00:00:00.000Z";
const clock = Date.parse(timestamp);
const privateValue = "PRIVATE_STUDENT_OR_STAFF_CANARY";
const classRow = (overrides = {}) => ({
  id: "class-1", name: "초6 중등과정반", subject: "수학", grade: "초6", teacher: "담당 선생님",
  room: "본관 1강", schedule: "월금 17:00-19:00", status: "수강", fee: 0, capacity: 10,
  student_ids: [privateValue, "student-2"], waitlist_ids: [privateValue],
  memo: privateValue, schedule_plan: { sessions: [{ memo: privateValue }] },
  lessons: [{ memo: privateValue }], textbook_ids: ["book-1"],
  ...overrides,
});
const payload = (overrides = {}) => ({
  source: "supabase", generatedAt: timestamp, classes: [classRow()],
  textbooks: [{ memo: privateValue }], progressLogs: [{ memo: privateValue }], ...overrides,
});
const respondWith = (data, options = {}) => createPublicClassesSummaryApiResponder({
  loadLive: async () => data, readSnapshot: async () => null, now: () => clock, ...options,
})();

test("summary uses the existing public aggregate projection and omits full schedules and private fields", async () => {
  const response = await respondWith(payload());
  assert.equal(response.status, 200);
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(response.headers["Cache-Control"], "public, max-age=0, s-maxage=600");
  assert.deepEqual(JSON.parse(response.body), {
    source: "supabase", generatedAt: timestamp, availability: "live", classes: [{
      id: "class-1", name: "초6 중등과정반", className: "초6 중등과정반", subject: "수학", grade: "초6",
      teacher: "담당 선생님", room: "본관 1강", classroom: "본관 1강", schedule: "월금 17:00-19:00",
      status: "수강", fee: 0, tuition: 0, capacity: 10, enrolledCount: 2, waitlistCount: 1,
    }],
  });
  assert.doesNotMatch(response.body, /PRIVATE_|student_ids|waitlist_ids|schedule_plan|schedulePlan|textbooks|lessons|progressLogs|memo/u);
});

test("confirmed empty summary is 200, while failures are 503 no-store without provider details", async () => {
  const empty = await respondWith(payload({ classes: [] }));
  assert.equal(empty.status, 200);
  assert.deepEqual(JSON.parse(empty.body).classes, []);
  for (const value of [null, {}, [], payload({ source: "fallback-empty", classes: [] }), payload({ generatedAt: null }), payload({ classes: null })]) {
    const response = await respondWith(value);
    assert.equal(response.status, 503);
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.deepEqual(JSON.parse(response.body), { error: "public_classes_unavailable" });
  }
  const failed = await respondWith(null, {
    loadLive: async () => { throw new Error(`${privateValue} https://provider.invalid/?token=secret`); },
    readSnapshot: async () => { throw new Error(privateValue); },
  });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(failed.body, /PRIVATE_|token|provider|secret/);
});

test("fresh static fallback and aged live summaries retain snapshot provenance and no-store", async () => {
  const fallback = await respondWith(null, { readSnapshot: async () => payload() });
  assert.equal(fallback.status, 200);
  assert.equal(fallback.headers["Cache-Control"], "no-store");
  assert.equal(JSON.parse(fallback.body).availability, "snapshot");
  for (const [age, availability] of [[600_000, "live"], [600_001, "snapshot"], [86_400_000, "snapshot"]]) {
    const response = await respondWith(payload(), { now: () => clock + age });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).availability, availability);
    assert.equal(response.headers["Cache-Control"], availability === "live" ? "public, max-age=0, s-maxage=600" : "no-store");
  }
});

test("older than 24 hours, future and invalid snapshot timestamps cannot masquerade as current data", async () => {
  for (const generatedAt of ["2026-09-10T23:59:59.999Z", "2026-09-12T00:00:00.001Z", "invalid", undefined]) {
    const response = await respondWith(payload({ generatedAt }), { readSnapshot: async () => payload({ generatedAt }) });
    assert.equal(response.status, 503);
  }
});

test("damaged rows and duplicate IDs fail atomically instead of becoming empty or partial lists", async () => {
  for (const row of [null, [], {}, classRow({ id: "" }), classRow({ subject: {} }), classRow({ capacity: -1 }), classRow({ enrolledCount: 0.5 }), classRow({ tuition: -1 }), classRow({ fee: Infinity })]) {
    const response = await respondWith(payload({ classes: [classRow({ id: "valid" }), row] }));
    assert.equal(response.status, 503);
  }
  assert.equal((await respondWith(payload({ classes: [classRow(), classRow()] }))).status, 503);
});

test("only active classes remain, and known zero counts are not replaced by legacy private arrays", async () => {
  const response = await respondWith(payload({ classes: [
    classRow({ enrolledCount: 0, waitlistCount: 0, status: "개강" }),
    classRow({ id: "ended", status: "종강" }),
    classRow({ id: "preparing", status: "개강 준비" }),
  ] }));
  const result = JSON.parse(response.body);
  assert.equal(result.classes.length, 1);
  assert.equal(result.classes[0].status, "수강");
  assert.equal(result.classes[0].enrolledCount, 0);
  assert.equal(result.classes[0].waitlistCount, 0);
});

test("nullable legacy summary values follow the existing normalizer without leaking private fallback fields", async () => {
  const response = await respondWith(payload({ classes: [classRow({
    fee: null, tuition: null, capacity: null, teacher: null, room: null,
    student_ids: [], waitlist_ids: [],
  })] }));
  assert.equal(response.status, 200);
  const item = JSON.parse(response.body).classes[0];
  assert.deepEqual([item.fee, item.tuition, item.capacity, item.teacher, item.room, item.enrolledCount, item.waitlistCount], [0, 0, 0, "", "", 0, 0]);
});

test("67 class summaries remain small even when a fallback includes large plans", async () => {
  const classes = Array.from({ length: 67 }, (_, index) => classRow({ id: `class-${index}`, schedule_plan: { memo: privateValue.repeat(1_000) } }));
  const response = await respondWith(payload({ classes }));
  assert.equal(JSON.parse(response.body).classes.length, 67);
  assert.ok(Buffer.byteLength(response.body) < 40_000);
  assert.doesNotMatch(response.body, /PRIVATE_|schedule_plan/);
});
