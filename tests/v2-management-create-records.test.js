import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildClassPayload,
  buildStudentPayload,
  buildTextbookPayload,
  createManagementService,
} from "../v2/src/features/management/management-service.js";

const testDir = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(testDir, "..");
const managementPageFile = path.join(root, "v2", "src", "features", "management", "management-page.tsx");
const managementTableFile = path.join(root, "v2", "src", "features", "management", "management-data-table.tsx");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function createFakeSupabase(seed = {}) {
  const calls = [];
  const tables = new Map(Object.entries(seed).map(([key, value]) => [key, [...value]]));
  return {
    calls,
    tables,
    from(table) {
      const call = { table, operation: null, payload: null, options: null, selected: false, ids: [] };
      calls.push(call);
      return {
        select() {
          call.operation = "select";
          return Promise.resolve({ data: tables.get(table) || [], error: null });
        },
        upsert(payload, options) {
          call.operation = "upsert";
          call.payload = Array.isArray(payload) ? payload : [payload];
          call.options = options;
          const current = tables.get(table) || [];
          const next = [...current];
          call.payload.forEach((item) => {
            const index = next.findIndex((row) => row.id === item.id);
            if (index >= 0) next[index] = { ...next[index], ...item };
            else next.push(item);
          });
          tables.set(table, next);
          return {
            select() {
              call.selected = true;
              return Promise.resolve({ data: call.payload, error: null });
            },
          };
        },
        delete() {
          call.operation = "delete";
          return {
            in(column, ids) {
              call.ids = ids;
              tables.set(table, (tables.get(table) || []).filter((row) => !ids.includes(row[column])));
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

test("management service builds insertable student/class/textbook payloads", () => {
  const generateId = () => "generated-id";

  assert.deepEqual(
    buildStudentPayload(
      {
        name: "  김학생 ",
        uid: " S-001 ",
        school: "제주중",
        grade: "중2",
        contact: "010-1111-2222",
        parentContact: "010-3333-4444",
        enrollDate: "2026-04-23",
      },
      { generateId },
    ),
    {
      id: "generated-id",
      name: "김학생",
      uid: "S-001",
      school: "제주중",
      grade: "중2",
      contact: "010-1111-2222",
      parent_contact: "010-3333-4444",
      enroll_date: "2026-04-23",
      class_ids: [],
      waitlist_class_ids: [],
    },
  );

  const classPayload = buildClassPayload(
    {
      name: "  고2 영어 A ",
      subject: "영어",
      grade: "고2",
      teacher: "한지현",
      schedule: "월 18:00-20:00",
      classroom: " 별5 ",
      capacity: "12",
      fee: "320000",
    },
    { generateId },
  );

  assert.deepEqual(
    classPayload,
    {
      id: "generated-id",
      name: "고2 영어 A",
      subject: "영어",
      grade: "고2",
      teacher: "한지현",
      schedule: "월 18:00-20:00",
      room: "별관 5강",
      capacity: 12,
      fee: 320000,
      status: "수업 진행 중",
      student_ids: [],
      waitlist_ids: [],
      textbook_ids: [],
    },
  );
  for (const invalidClassColumn of ["class_name", "teacher_name", "classroom", "tuition", "waitlist_student_ids"]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(classPayload, invalidClassColumn),
      false,
      `${invalidClassColumn} should stay display-only, not write payload`,
    );
  }

  assert.deepEqual(
    buildTextbookPayload(
      {
        title: "  수능특강 영어 ",
        subject: "영어",
        publisher: "EBS",
        price: "9500",
        tags: "수능, 독해",
      },
      { generateId, now: new Date("2026-04-23T00:00:00.000Z") },
    ),
    {
      id: "generated-id",
      title: "수능특강 영어",
      name: "수능특강 영어",
      subject: "영어",
      publisher: "EBS",
      price: 9500,
      tags: ["수능", "독해"],
      lessons: [],
      updated_at: "2026-04-23",
    },
  );
});

test("management service persists student/class/textbook records through Supabase upsert", async () => {
  const fakeSupabase = createFakeSupabase();
  const service = createManagementService({ supabase: fakeSupabase, generateId: () => "new-id" });

  await service.createStudent({ name: "김학생" });
  await service.createClass({ name: "고2 영어 A" });
  await service.createTextbook({ title: "수능특강 영어" });

  assert.deepEqual(fakeSupabase.calls.filter((call) => call.operation === "upsert").map((call) => call.table), ["students", "classes", "textbooks"]);
});

test("management service updates, deletes, and syncs student/class enrollment both ways", async () => {
  const fakeSupabase = createFakeSupabase({
    students: [{ id: "s1", name: "김학생", class_ids: [], waitlist_class_ids: [] }],
    classes: [{ id: "c1", name: "고2 영어 A", student_ids: [], waitlist_ids: [] }],
  });
  const service = createManagementService({ supabase: fakeSupabase });

  await service.updateStudent({ id: "s1", name: "김학생2" });
  await service.assignStudentToClass({ studentId: "s1", classId: "c1", mode: "enrolled" });

  assert.deepEqual(fakeSupabase.tables.get("students")[0].class_ids, ["c1"]);
  assert.deepEqual(fakeSupabase.tables.get("students")[0].waitlist_class_ids, []);
  assert.deepEqual(fakeSupabase.tables.get("classes")[0].student_ids, ["s1"]);
  assert.deepEqual(fakeSupabase.tables.get("classes")[0].waitlist_ids, []);

  await service.assignStudentToClass({ studentId: "s1", classId: "c1", mode: "waitlist" });
  assert.deepEqual(fakeSupabase.tables.get("students")[0].class_ids, []);
  assert.deepEqual(fakeSupabase.tables.get("students")[0].waitlist_class_ids, ["c1"]);
  assert.deepEqual(fakeSupabase.tables.get("classes")[0].student_ids, []);
  assert.deepEqual(fakeSupabase.tables.get("classes")[0].waitlist_ids, ["s1"]);

  await service.removeStudentFromClass({ studentId: "s1", classId: "c1" });
  assert.deepEqual(fakeSupabase.tables.get("students")[0].waitlist_class_ids, []);
  assert.deepEqual(fakeSupabase.tables.get("classes")[0].waitlist_ids, []);

  await service.deleteStudent("s1");
  assert.deepEqual(fakeSupabase.tables.get("students"), []);
});

test("management page and table expose detail/edit/delete/enrollment controls", () => {
  const pageSource = read(managementPageFile);
  const tableSource = read(managementTableFile);

  for (const marker of [
    "상세 정보",
    "수정 저장",
    "삭제",
    "수강 등록",
    "대기 등록",
    "getSaveErrorMessage(saveError)",
    "managementService.updateStudent",
    "managementService.updateClass",
    "managementService.updateTextbook",
    "managementService.assignStudentToClass",
    "managementService.removeStudentFromClass",
    "운영 요약",
    "수업 운영 허브",
    "학생 운영 허브",
    "수강생",
    "대기자",
    "교재 연결",
    "수업 설계 열기",
    "수업 상세에서 수업설계로 이동",
  ]) {
    assert.ok(pageSource.includes(marker), `${marker} marker missing`);
  }

  for (const marker of ["onOpenRow", "onEditRow", "onDeleteRow", "상세", "수정", "삭제"]) {
    assert.ok(tableSource.includes(marker), `${marker} table marker missing`);
  }
});
