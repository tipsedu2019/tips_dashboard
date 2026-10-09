import test from "node:test";
import assert from "node:assert/strict";
import { buildStudentPayload, createManagementService } from "../src/features/management/management-service.js";
import { normalizeStudentManagementRecord } from "../src/features/management/records.js";
import { filterClassStudentCandidates } from "../src/features/management/student-class-picker-model.ts";
import { STUDENT_MASTER_READ_COLUMNS } from "../src/features/management/student-master-privacy.js";

const student = {
  id: "91000000-0000-4000-8000-000000000901", name: "합성 학생", uid: "S-901", school: "합성중", grade: "중2",
  contact: "01000000000", parent_contact: "01011111111", parentContact: "01022222222", phone: "01033333333",
  student_phone: "01044444444", guardianContact: "01055555555", status: "재원",
  class_ids: ["class-1"], waitlist_class_ids: ["class-2"], enroll_date: "2026-09-01",
};

test("student payload omits contacts, retaining stable identity and existing relationship values", () => {
  const payload = buildStudentPayload(student);
  assert.equal(payload.id, student.id);
  assert.equal(payload.uid, "S-901");
  assert.deepEqual(payload.class_ids, ["class-1"]);
  assert.deepEqual(payload.waitlist_class_ids, ["class-2"]);
  assert.equal(payload.status, "재원");
  assert.equal(payload.enroll_date, "2026-09-01");
  assert.doesNotMatch(JSON.stringify(payload), /contact|phone|010\d+/);
});

test("create/update send no contact keys and preserve prior stored values instead of clearing them", async () => {
  for (const method of ["createStudent", "updateStudent"]) {
    let stored = { ...student };
    const writes = [];
    const columns = [];
    const client = { from(table) {
      assert.equal(table, "students");
      return { upsert(payload) {
        writes.push(payload);
        stored = { ...stored, ...payload };
        return {
          select(selection) { columns.push(selection); return this; },
          order(column) { assert.equal(column, "id"); return this; },
          limit(value) { assert.equal(value, 1); return this; },
          abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; },
          async retry(enabled) { assert.equal(enabled, false); return { data: [stored], error: null }; },
        };
      } };
    } };
    const service = createManagementService({ supabase: client, probeRegistrationRuntime: async () => ({ mode: "ready", version: 1 }) });
    const result = await service[method]({ ...student, contact: "", parent_contact: "", parentContact: "" });
    assert.equal(writes.length, 1);
    assert.doesNotMatch(JSON.stringify(writes), /contact|phone|010\d+/);
    assert.equal(stored.contact, student.contact);
    assert.equal(stored.parent_contact, student.parent_contact);
    assert.deepEqual(stored.class_ids, ["class-1"]);
    assert.equal(stored.status, "재원");
    assert.deepEqual(columns, [STUDENT_MASTER_READ_COLUMNS]);
    assert.doesNotMatch(JSON.stringify(result), /contact|phone|010\d+/);
  }
});

test("student list and counseling save use explicit contact-free response columns", async () => {
  const selected = [];
  const client = { from(table) {
    assert.equal(table, "students");
    return {
      select(columns) {
        selected.push(columns);
        let filteredRows = [student];
        return {
          filter(column, operator, id) {
            assert.equal(column, "id");
            assert.ok(["gte", "gt"].includes(operator));
            filteredRows = [student].filter((row) => operator === "gt" ? row.id > id : row.id >= id);
            return this;
          },
          order(column, options) { assert.equal(column, "id"); assert.equal(options.ascending, true); return this; },
          limit(value) { assert.equal(value, 30); return this; },
          abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; },
          async retry(enabled) { assert.equal(enabled, false); return { data: filteredRows, error: null }; },
        };
      },
      update(payload) {
        assert.deepEqual(payload, { counseling_note: "합성 메모" });
        return {
          eq(column, id) { assert.equal(column, "id"); assert.equal(id, student.id); return this; },
          select(columns) { selected.push(columns); return this; },
          order(column) { assert.equal(column, "id"); return this; },
          limit(value) { assert.equal(value, 1); return this; },
          abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; },
          async retry(enabled) { assert.equal(enabled, false); return { data: [{ ...student, counseling_note: "합성 메모" }], error: null }; },
        };
      },
    };
  } };
  const service = createManagementService({ supabase: client });
  const rows = await service.listStudents();
  const note = await service.updateStudentCounselingNote({ studentId: student.id, note: "합성 메모" });
  assert.deepEqual(selected, [STUDENT_MASTER_READ_COLUMNS, STUDENT_MASTER_READ_COLUMNS, `${STUDENT_MASTER_READ_COLUMNS},counseling_note`]);
  assert.equal(note.counseling_note, "합성 메모");
  assert.doesNotMatch(JSON.stringify({ rows, note }), /contact|phone|010\d+/);
});

test("master projection and candidate search exclude all legacy contact aliases", () => {
  const normalized = normalizeStudentManagementRecord(student);
  assert.equal(normalized.id, student.id);
  assert.equal(normalized.metrics.classCount, 1);
  assert.doesNotMatch(JSON.stringify(normalized), /contact|phone|010\d+/);
  for (const query of [student.contact, student.parent_contact]) {
    assert.deepEqual(filterClassStudentCandidates([student], { query, grade: "", school: "" }), []);
  }
  assert.equal(filterClassStudentCandidates([student], { query: "S-901", grade: "", school: "" }).length, 1);
});
