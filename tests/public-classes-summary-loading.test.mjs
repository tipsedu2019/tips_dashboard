import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { createPublicClassesApiResponder } from "../src/server/public-classes-api.js";
import {
  buildPublicClassesPayload,
  normalizePublicClassesFailure,
} from "../src/server/public-classes-payload.js";

test("public classes route enables Vercel response caching", async () => {
  const source = await fs.readFile(
    new URL("../src/app/api/public-classes/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /export const revalidate = 600;/);
  assert.doesNotMatch(source, /force-dynamic/);
});

function createRecordingSupabaseClient(rowsByTable, queries) {
  return {
    from(table) {
      return {
        select(columns) {
          const query = {
            table,
            columns,
            abortSignalApplied: false,
            retry: undefined,
          };
          queries.push(query);

          const result = {
            data: rowsByTable[table] || [],
            error: null,
          };

          return {
            abortSignal() {
              query.abortSignalApplied = true;
              return this;
            },
            retry(value) {
              query.retry = value;
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
}

test("public classes API preserves class plans and their supporting catalogs", async () => {
  const calls = [];
  const respond = createPublicClassesApiResponder(async (...args) => {
    calls.push(args);
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
  assert.deepEqual(calls, [[]]);
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

test("public classes full mode reads only production columns and keeps compatibility output", async () => {
  const queries = [];
  const rowsByTable = {
    classes: [
      {
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
        student_ids: [],
        waitlist_ids: [],
        textbook_ids: ["book-1"],
        textbook_info: null,
        lessons: [],
        schedule_plan: { sessions: [{ id: "session-1" }] },
        start_date: "2026-03-01",
        end_date: null,
      },
    ],
    textbooks: [
      {
        id: "book-1",
        title: "교재",
        name: "",
        publisher: "출판사",
        price: 10000,
        tags: [],
        lessons: [],
        updated_at: null,
      },
    ],
    progress_logs: [
      {
        id: "progress-1",
        class_id: "class-1",
        textbook_id: "book-1",
        progress_key: "p-1",
        session_id: "session-1",
        session_order: 1,
        status: "done",
        range_start: "1",
        range_end: "2",
        range_label: "1-2",
        public_note: "",
        teacher_note: "",
        updated_at: null,
        date: null,
      },
    ],
  };
  const supabaseClient = createRecordingSupabaseClient(rowsByTable, queries);

  const payload = await buildPublicClassesPayload({
    env: {},
    supabaseClient,
    mode: "full",
  });

  assert.deepEqual(queries, [
    {
      table: "classes",
      columns:
        "id,name,subject,grade,teacher,room,schedule,status,fee,capacity,student_ids,waitlist_ids,textbook_ids,textbook_info,lessons,schedule_plan,start_date,end_date",
      abortSignalApplied: true,
      retry: false,
    },
    {
      table: "textbooks",
      columns: "id,title,name,publisher,price,tags,lessons,updated_at",
      abortSignalApplied: true,
      retry: false,
    },
    {
      table: "progress_logs",
      columns:
        "id,class_id,textbook_id,progress_key,session_id,session_order,status,range_start,range_end,range_label,public_note,teacher_note,updated_at,date",
      abortSignalApplied: true,
      retry: false,
    },
  ]);
  assert.equal(payload.classes[0].tuition, 270000);
  assert.deepEqual(payload.progressLogs[0].completedLessonIds, []);
});
