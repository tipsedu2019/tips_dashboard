import test from "node:test";
import assert from "node:assert/strict";
import { buildClassPayload, buildClassMetadataPayload } from "../src/features/management/management-service.js";
import { matchesClosedClassDetail } from "../src/features/management/class-close-confirmation.ts";
import { normalizePublicClassesFullPayload, normalizePublicClassesSummaryPayload } from "../src/server/public-classes-payload.js";

const id = "10000000-0000-4000-8000-000000000801";
test("only an explicitly owned public memo enters a class write; omission preserves bulk values", () => {
  for (const build of [buildClassPayload, buildClassMetadataPayload]) {
    assert.equal(Object.hasOwn(build({ id, name: "합성 수업", memo: "PRIVATE", publicNote: "PRIVATE" }), "public_memo"), false);
    assert.equal(build({ id, publicMemo: "  개념부터 차근차근 ✨  " }).public_memo, "개념부터 차근차근 ✨");
    assert.equal(build({ id, public_memo: "", publicMemo: "stale" }).public_memo, "");
    assert.equal(build({ id, public_memo: null }).public_memo, "");
    assert.deepEqual(build({ id, publicMemo: "안내", textbook_ids: ["book"], textbook_usage: { book: { startDate: "2026-10-01", endDate: "" } } }).textbook_usage,
      build({ id, textbook_ids: ["book"], textbook_usage: { book: { startDate: "2026-10-01", endDate: "" } } }).textbook_usage);
  }
});

test("public boundaries expose only the explicit memo and preserve actual schedule times", () => {
  for (const memo of ["진도: 함수 · 안내 <script>alert(1)</script> & ✨", "", null, undefined]) {
    const row = { id, name: "합성 수업", status: "수강", schedule: "화 19:30-21:30 / 토 16:30-18:00", public_memo: memo,
      memo: "PRIVATE", teacherNote: "PRIVATE", textbook_info: "PRIVATE" };
    const raw = { source: "supabase", generatedAt: "2026-10-22T00:00:00Z", classes: [row], textbooks: [], progressLogs: [] };
    const before = structuredClone(raw);
    for (const normalize of [normalizePublicClassesSummaryPayload, normalizePublicClassesFullPayload]) {
      const output = normalize(raw);
      assert.equal(output.classes[0].publicMemo, memo ?? "");
      assert.equal(output.classes[0].schedule, row.schedule);
      assert.equal(JSON.stringify(output).includes("PRIVATE"), false);
      assert.deepEqual(normalize(output), output, "static/cached camel DTO is stable");
    }
    assert.deepEqual(raw, before);
  }
});

test("closed class readback also confirms an explicit public memo", () => {
  const page = { rows: [], hasMore: false, nextCursor: null };
  const detail = { kind: "classes", record: { id, status: "종강", publicMemo: "마무리 안내" }, registeredCount: 0, waitlistCount: 0,
    registeredStudents: page, waitlistedStudents: page };
  assert.equal(matchesClosedClassDetail(detail, id, { status: "종강", public_memo: "마무리 안내" }), true);
  assert.equal(matchesClosedClassDetail(detail, id, { status: "종강", public_memo: "다른 내용" }), false);
});
