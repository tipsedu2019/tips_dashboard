import test from "node:test";
import assert from "node:assert/strict";

import { buildTimetableWorkspaceModel, parseAcademicSchedule } from "../v2/src/features/academic/records.js";

test("timetable parsing normalizes legacy classroom aliases into stable classroom labels", () => {
  const slots = parseAcademicSchedule("월 14:00-15:00(별5) / 화 15:00-16:00(별7) / 수 16:00-17:00(본2) / 목 17:00-18:00(별3)", {
    teacher: "강부희",
    classroom: "본관 9강",
  });

  assert.equal(slots.length, 4);
  assert.equal(slots[0].teacher, "강부희");
  assert.equal(slots[0].classroom, "별관 5강");
  assert.equal(slots[1].teacher, "강부희");
  assert.equal(slots[1].classroom, "별관 5강");
  assert.equal(slots[2].classroom, "본관 2강");
  assert.equal(slots[3].classroom, "별관 3강");
});

test("teacher axis options exclude classroom-like override tokens and merge legacy classroom aliases", () => {
  const workspace = buildTimetableWorkspaceModel({
    classes: [
      {
        id: "class-1",
        name: "중2A 수학",
        subject: "수학",
        grade: "중2",
        teacher: "강부희",
        classroom: "본관 9강",
        period: "1학기",
        status: "active",
        schedule: "월 14:00-15:00(별5) / 화 15:00-16:00(본2) / 수 16:00-17:00(별7) / 목 17:00-18:00(본3) / 금 18:00-19:00(본5) / 토 19:00-20:00(별3)",
      },
    ],
    classTerms: [],
  });

  assert.deepEqual(workspace.teacherOptions, ["강부희"]);
  assert.equal(workspace.classroomOptions.includes("별관 5강"), true);
  assert.equal(workspace.classroomOptions.includes("별관 3강"), true);
  assert.equal(workspace.classroomOptions.includes("본관 2강"), true);
  assert.equal(workspace.classroomOptions.includes("본관 3강"), true);
  assert.equal(workspace.classroomOptions.includes("본관 5강"), true);
  assert.equal(workspace.classroomOptions.includes("본2"), false);
  assert.equal(workspace.classroomOptions.includes("본3"), false);
  assert.equal(workspace.classroomOptions.includes("본5"), false);
  assert.equal(workspace.classroomOptions.includes("별3"), false);
  assert.equal(workspace.classroomOptions.includes("별5"), false);
  assert.equal(workspace.classroomOptions.includes("별7"), false);
});
