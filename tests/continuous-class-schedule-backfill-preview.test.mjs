import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildContinuousSchedulePreviewReport,
  parseContinuousSchedulePreviewArgs,
} from "../scripts/preview-continuous-class-schedule-backfill.mjs";

test("preview arguments require exactly one explicit input mode", () => {
  assert.throws(() => parseContinuousSchedulePreviewArgs([]), /--input or --live/);
  assert.throws(
    () => parseContinuousSchedulePreviewArgs(["--live"]),
    /--class-id or --all/,
  );
  assert.throws(
    () => parseContinuousSchedulePreviewArgs(["--input", "fixture.json", "--live", "--all", "--confirm-all-read"]),
    /cannot be combined/i,
  );
  assert.deepEqual(
    parseContinuousSchedulePreviewArgs(["--input", "fixture.json"]),
    { mode: "file", inputPath: "fixture.json" },
  );
});

test("live all-class preview requires explicit confirmation", () => {
  assert.throws(
    () => parseContinuousSchedulePreviewArgs(["--live", "--all"]),
    /--confirm-all-read/,
  );
  assert.deepEqual(
    parseContinuousSchedulePreviewArgs([
      "--live", "--all", "--confirm-all-read",
    ]),
    { mode: "live", classId: "", all: true },
  );
});

test("preview report exposes only redacted identifiers, counts, and issue codes", () => {
  const report = buildContinuousSchedulePreviewReport([{
    id: "10000000-0000-4000-8000-000000000001",
    name: "비공개 수업명",
    schedule: "화 14:00-15:30",
    teacher: "비공개 선생님",
    room: "비공개 강의실",
    textbook: "비공개 교재",
    contact: "비공개 연락처",
    students: ["비공개 학생"],
    schedule_plan: {
      sessions: [{
        id: "session-1",
        date: "2026-04-03",
        state: "active",
      }],
    },
    shadow_slots: [],
    shadow_sessions: [],
  }]);
  const serialized = JSON.stringify(report);

  assert.match(serialized, /10000000-0000-4000-8000-000000000001/);
  assert.doesNotMatch(serialized, /비공개 수업명|비공개 선생님|비공개 강의실|비공개 교재|비공개 연락처|비공개 학생/);
  assert.doesNotMatch(serialized, /schedule_plan|teacher|room|contact|student/i);
  assert.deepEqual(Object.keys(report.classes[0]).sort(), [
    "classId",
    "counts",
    "eligible",
    "issueCodes",
    "shadowIssueCodes",
    "shadowMatches",
  ]);
});

test("preview command source has no database mutation operation", async () => {
  const source = await readFile(
    new URL("../scripts/preview-continuous-class-schedule-backfill.mjs", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /\.insert\s*\(/);
  assert.doesNotMatch(source, /\.update\s*\(/);
  assert.doesNotMatch(source, /\.delete\s*\(/);
  assert.doesNotMatch(source, /\.upsert\s*\(/);
  assert.doesNotMatch(source, /rpc\s*\(\s*["'](?:create|update|delete|mutate)/i);
});
