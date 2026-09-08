import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPublicClassesApiResponder } from "../src/server/public-classes-api.js";
import { loadPublicClassesPagePayload } from "../src/lib/public-classes-server.js";
import {
  normalizePublicClassesFullPayload,
  normalizePublicClassesSummaryPayload,
  writePublicClassesPayload,
} from "../src/server/public-classes-payload.js";

const privateCanary = "PRIVATE_STUDENT_OR_STAFF_INFORMATION";

function legacyPayload(sessionCount = 1) {
  const plan = {
    version: 2,
    history: [{ memo: privateCanary.repeat(200) }],
    sessionStates: { "2026-09-07": { memo: privateCanary } },
    textbooks: [{ textbookId: "book-1", alias: "공개 교재", memo: privateCanary }],
    sessions: Array.from({ length: sessionCount }, (_, i) => ({
      id: `session-${i}`, sessionKey: `session-${i}`, date: "2026-09-07",
      sessionNumber: i + 1, scheduleState: "makeup", state: "makeup",
      originalDate: "2026-09-06", startTime: "17:00", endTime: "18:00",
      classroomName: "1강의실", teacherName: "담당 선생님",
      memo: privateCanary, teacherNote: privateCanary,
      teacherCatalogId: privateCanary, studentIds: [privateCanary],
      publicNote: "공개 안내", progressStatus: "done",
      textbookEntries: [{
        textbookId: "book-1", alias: "공개 교재",
        plan: { rangeType: "page", start: "1", end: "5", memo: privateCanary },
        actual: { status: "done", start: "1", end: "4", publicNote: "4쪽까지", teacherNote: privateCanary },
        privateExtra: { phone: privateCanary },
      }],
    })),
  };
  return {
    source: "supabase", generatedAt: "2026-09-07T00:00:00.000Z", privateExtra: privateCanary,
    classes: [{
      id: "class-1", className: "공개 영어", name: "공개 영어", status: "수강",
      capacity: 10, studentIds: [privateCanary, "private-student-2"], waitlistIds: [privateCanary],
      textbookIds: ["book-1"], textbookInfo: { memo: privateCanary },
      schedulePlan: plan, schedule_plan: plan, startDate: "2026-09-01",
      lessons: [{ id: "lesson-1", title: "공개 단원", memo: privateCanary }],
    }],
    textbooks: [{ id: "book-1", title: "공개 교재", teacherNote: privateCanary, lessons: [{ id: "lesson-1", title: "공개 단원", memo: privateCanary }] }],
    progressLogs: [{ id: "progress-1", classId: "class-1", textbookId: "book-1", sessionId: "session-0", publicNote: "공개 진도", teacherNote: privateCanary, completedLessonIds: ["lesson-1"] }],
  };
}

function assertPrivateFieldsAbsent(payload) {
  const json = JSON.stringify(payload);
  assert.ok(!json.includes(privateCanary), "private canary must never cross a public boundary");
  assert.ok(!/"(?:studentIds|student_ids|waitlistIds|waitlist_ids|teacherNote|teacher_note|memo|history|sessionStates|teacherCatalogId|schedule_plan)"/.test(json), "private or duplicate fields must be absent");
}

test("full public normalization removes nested private fields and duplicate plans without losing calendar or progress", () => {
  const raw = legacyPayload();
  const before = structuredClone(raw);
  const clean = normalizePublicClassesFullPayload(raw);
  assertPrivateFieldsAbsent(clean);
  assert.equal(clean.classes[0].enrolledCount, 2);
  assert.equal(clean.classes[0].waitlistCount, 1);
  const session = clean.classes[0].schedulePlan.sessions[0];
  assert.equal(session.date, "2026-09-07");
  assert.equal(session.scheduleState, "makeup");
  assert.equal(session.originalDate, "2026-09-06");
  assert.equal(session.startTime, "17:00");
  assert.equal(session.textbookEntries[0].actual.end, "4");
  assert.equal(session.publicNote, "공개 안내");
  assert.equal(clean.textbooks[0].lessons[0].title, "공개 단원");
  assert.equal(clean.progressLogs[0].publicNote, "공개 진도");
  assert.deepEqual(clean.progressLogs[0].completedLessonIds, ["lesson-1"]);
  assert.deepEqual(raw, before, "internal planning source must remain unchanged");
  assert.deepEqual(normalizePublicClassesFullPayload(clean), clean, "safe snapshots retain counts and catalogs on every read");
});

test("summary and page normalization preserve camel or snake roster counts while stripping all internal data", async () => {
  const raw = legacyPayload();
  for (const input of [raw, { ...raw, classes: [{ ...raw.classes[0], studentIds: undefined, waitlistIds: undefined, student_ids: [privateCanary], waitlist_ids: [privateCanary] }] }]) {
    const clean = normalizePublicClassesSummaryPayload(input);
    assertPrivateFieldsAbsent(clean);
    assert.equal(clean.classes[0].enrolledCount, input.classes[0].studentIds?.length ?? 1);
    assert.equal(clean.classes[0].waitlistCount, 1);
    assert.ok(!("schedulePlan" in clean.classes[0]));
    assert.deepEqual(normalizePublicClassesSummaryPayload(clean), clean);
    assert.deepEqual(await loadPublicClassesPagePayload(async () => input), clean);
    assert.deepEqual(await loadPublicClassesPagePayload(async () => null, async () => input), clean);
  }
});

test("API responder and static writer sanitize even an old injected snapshot", async () => {
  const raw = legacyPayload();
  const response = await createPublicClassesApiResponder(async () => raw)();
  assert.equal(response.status, 200);
  assertPrivateFieldsAbsent(JSON.parse(response.body));
  const dir = await mkdtemp(path.join(os.tmpdir(), "tips-public-privacy-"));
  try {
    const output = path.join(dir, "public-classes.json");
    await writePublicClassesPayload(raw, output);
    assertPrivateFieldsAbsent(JSON.parse(await readFile(output, "utf8")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("public nested allowlists reject objects in scalar fields and unknown catalog properties", () => {
  const raw = legacyPayload();
  raw.classes[0].name = { memo: privateCanary };
  raw.classes[0].lessons[0].title = { studentIds: [privateCanary] };
  raw.textbooks[0].tags = [{ memo: privateCanary }, "공개 태그"];
  raw.classes[0].schedulePlan.sessions[0].textbookEntries[0].actual.publicNote = { memo: privateCanary };
  const clean = normalizePublicClassesFullPayload(raw);
  assertPrivateFieldsAbsent(clean);
  assert.deepEqual(clean.textbooks[0].tags, ["공개 태그"]);
});

test("large public plan retains every session and shrinks serialized data", () => {
  const raw = legacyPayload(6_000);
  const clean = normalizePublicClassesFullPayload(raw);
  assert.equal(clean.classes[0].schedulePlan.sessions.length, 6_000);
  assertPrivateFieldsAbsent(clean);
  assert.ok(Buffer.byteLength(JSON.stringify(clean)) < Buffer.byteLength(JSON.stringify(raw)) * 0.4);
});

test("tracked public snapshot contains only normalized public data", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../public/data/public-classes.json", import.meta.url), "utf8"));
  assertPrivateFieldsAbsent(snapshot);
  assert.ok(JSON.stringify(normalizePublicClassesFullPayload(snapshot)) === JSON.stringify(snapshot), "tracked snapshot must already be normalized");
});
