import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicClassesPayload,
  createPublicClassesSupabaseClient,
} from "../src/server/public-classes-payload.js";

function createFakeSupabase(tables) {
  return {
    from(tableName) {
      return {
        async select() {
          return { data: tables[tableName] || [], error: null };
        },
      };
    },
  };
}

test("public classes live fetch requires a server-only Supabase service key", () => {
  assert.equal(
    createPublicClassesSupabaseClient({
      SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      VITE_SUPABASE_ANON_KEY: "vite-anon-key",
    }),
    null,
  );
});

test("public classes payload strips student identifiers and teacher-only notes", async () => {
  const payload = await buildPublicClassesPayload({
    supabaseClient: createFakeSupabase({
      classes: [
        {
          id: "class-1",
          name: "영어 고1",
          subject: "영어",
          grade: "고1",
          status: "수업 진행 중",
          student_ids: ["student-a", "student-b"],
          waitlist_ids: ["student-c"],
          textbook_ids: ["book-1"],
          capacity: 8,
          schedule_plan: {
            sessions: [
              {
                publicNote: "Public lesson note",
                teacherNote: "Internal lesson note",
                textbookEntries: [
                  { actual: { publicNote: "Visible", teacherNote: "Hidden" } },
                ],
              },
            ],
          },
          lessons: [{ title: "Internal lesson" }],
        },
      ],
      textbooks: [{ id: "book-1", title: "Reading Book" }],
      progress_logs: [
        {
          id: "progress-1",
          class_id: "class-1",
          textbook_id: "book-1",
          public_note: "Unit 3",
          teacher_note: "Private pacing note",
        },
      ],
    }),
  });

  assert.equal(payload.source, "supabase");
  assert.equal(payload.classes[0].enrollmentCount, 2);
  assert.equal(payload.classes[0].waitlistCount, 1);
  assert.equal(payload.classes[0].studentIds, undefined);
  assert.equal(payload.classes[0].waitlistIds, undefined);
  assert.equal(payload.classes[0].schedulePlan, undefined);
  assert.equal(payload.classes[0].schedule_plan, undefined);
  assert.equal(payload.classes[0].lessons, undefined);
  assert.equal(payload.progressLogs[0].publicNote, "Unit 3");
  assert.equal(payload.progressLogs[0].teacherNote, undefined);

  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("student-a"), false);
  assert.equal(serialized.includes("student-b"), false);
  assert.equal(serialized.includes("student-c"), false);
  assert.equal(serialized.includes("Private pacing note"), false);
  assert.equal(serialized.includes("Internal lesson note"), false);
  assert.equal(serialized.includes("Hidden"), false);
});
