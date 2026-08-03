import assert from "node:assert/strict";
import test from "node:test";

import { buildPublicClassesPayload } from "../src/server/public-classes-payload.js";

test("public classes summary mode reads and returns only fields required by the public list", async () => {
  const queries = [];
  const classRow = {
    id: "class-1",
    name: "중1 영어",
    subject: "영어",
    grade: "중1",
    teacher: "담당 선생님",
    room: "본관 1강",
    schedule: "월수금 17:00-19:00",
    status: "수강",
    fee: 270000,
    capacity: 10,
    student_ids: ["student-1", "student-2"],
    waitlist_ids: ["student-3"],
    start_date: "2026-03-01",
    end_date: null,
    schedule_plan: { sessions: Array.from({ length: 100 }, (_, index) => ({ index })) },
    lessons: [{ id: "lesson-1" }],
    textbook_ids: ["textbook-1"],
  };
  const supabaseClient = {
    from(table) {
      return {
        select(columns) {
          queries.push({ table, columns });
          return Promise.resolve({
            data: table === "classes" ? [classRow] : [],
            error: null,
          });
        },
      };
    },
  };

  const payload = await buildPublicClassesPayload({
    env: {},
    supabaseClient,
    mode: "summary",
  });

  assert.deepEqual(queries, [
    {
      table: "classes",
      columns:
        "id,name,subject,grade,teacher,room,schedule,status,fee,capacity,student_ids,waitlist_ids,start_date,end_date",
    },
  ]);
  assert.deepEqual(payload, {
    generatedAt: payload.generatedAt,
    source: "supabase",
    classes: [
      {
        id: "class-1",
        name: "중1 영어",
        className: "중1 영어",
        subject: "영어",
        grade: "중1",
        teacher: "담당 선생님",
        room: "본관 1강",
        classroom: "본관 1강",
        schedule: "월수금 17:00-19:00",
        status: "수강",
        fee: 270000,
        tuition: 270000,
        capacity: 10,
        studentIds: ["student-1", "student-2"],
        waitlistIds: ["student-3"],
      },
    ],
    textbooks: [],
    progressLogs: [],
  });
  assert.equal(JSON.stringify(payload).includes("schedule_plan"), false);
  assert.equal(JSON.stringify(payload).includes("schedulePlan"), false);
});
