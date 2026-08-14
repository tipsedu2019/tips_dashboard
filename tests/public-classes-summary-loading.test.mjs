import assert from "node:assert/strict";
import test from "node:test";

import { createPublicClassesApiResponder } from "../src/server/public-classes-api.js";
import {
  buildPublicClassesPayload,
  normalizePublicClassesFailure,
} from "../src/server/public-classes-payload.js";

test("public classes API preserves class plans and their supporting catalogs", async () => {
  const respond = createPublicClassesApiResponder(async ({ mode }) => {
    if (mode === "full") {
      return {
        generatedAt: "2026-08-09T00:00:00.000Z",
        source: "supabase",
        classes: [
          {
            id: "class-1",
            schedulePlan: { sessions: [{ id: "session-1" }] },
            schedule_plan: { sessions: [{ id: "session-1" }] },
          },
        ],
        textbooks: [{ id: "textbook-1", title: "교재" }],
        progressLogs: [{ id: "progress-1", classId: "class-1" }],
      };
    }

    return {
      generatedAt: "2026-08-09T00:00:00.000Z",
      source: "supabase",
      classes: [{ id: "class-1" }],
      textbooks: [],
      progressLogs: [],
    };
  });

  const response = await respond();
  const payload = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(
    response.headers["Cache-Control"],
    "public, max-age=0, s-maxage=600, stale-while-revalidate=3600",
  );
  assert.deepEqual(payload.classes[0].schedulePlan, {
    sessions: [{ id: "session-1" }],
  });
  assert.deepEqual(payload.textbooks, [{ id: "textbook-1", title: "교재" }]);
  assert.deepEqual(payload.progressLogs, [
    { id: "progress-1", classId: "class-1" },
  ]);
});

test("public classes API marks fallback responses no-store", async () => {
  const respond = createPublicClassesApiResponder(async () => ({
    generatedAt: "2026-08-09T00:00:00.000Z",
    source: "fallback-empty",
    reason: "Public class data is temporarily unavailable.",
    classes: [],
    textbooks: [],
    progressLogs: [],
  }));

  const response = await respond();
  assert.equal(response.status, 503);
  assert.equal(response.headers["Cache-Control"], "no-store");
});

test("public classes failures do not expose gateway HTML or request details", () => {
  const reason = normalizePublicClassesFailure(
    new Error("<html>cloudflare 522 https://example.invalid/?token=secret</html>"),
  );

  assert.equal(reason, "Public class data is temporarily unavailable.");
  assert.doesNotMatch(reason, /html|cloudflare|522|token|https?:/i);
});

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
          const result = {
            data: table === "classes" ? [classRow] : [],
            error: null,
          };
          return {
            abortSignal() {
              return this;
            },
            retry() {
              return this;
            },
            then(resolve, reject) {
              return Promise.resolve(result).then(resolve, reject);
            },
          };
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
