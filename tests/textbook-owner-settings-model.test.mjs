import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

const feature = new URL("../src/features/textbooks/", import.meta.url);
const modelUrl = new URL("../src/features/textbooks/textbook-owner-settings-model.ts", import.meta.url);
const id = (value) => `6a000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
registerHooks({ resolve(specifier, context, nextResolve) { if (specifier.startsWith("./") && context.parentURL?.startsWith(feature.href)) { const candidate = new URL(`${specifier}.ts`, context.parentURL); if (existsSync(candidate)) return nextResolve(candidate.href, context); } return nextResolve(specifier, context); } });

test("owner draft model preserves operation chronology and supplier delete link cleanup", async () => {
  const { projectOwnerDraft, ownerSubjectLabel } = await import(modelUrl.href);
  const result = projectOwnerDraft({
    publishers: [{ id: id(1), name: "기존", subjects: ["english"], supplierIds: [id(2)], isNew: false }],
    suppliers: [{ id: id(2), name: "기존 공급처", contact: "", memo: "", isNew: false }],
  }, {
    version: 1, baseRevision: "b".repeat(64), operations: [
      { type: "supplier.add", id: id(3), name: " 새 공급처 ", contact: " 연락 ", memo: " 메모 " },
      { type: "publisher.patch", id: id(1), patch: { supplierIds: [id(3)] } },
      { type: "supplier.delete", id: id(3) },
    ],
  });
  assert.deepEqual(result.publishers[0].supplierIds, []);
  assert.deepEqual(result.suppliers.map((row) => row.id), [id(2)]);
  assert.equal(ownerSubjectLabel(["english", "math"]), "영어, 수학");
});

test("owner draft model rejects duplicate supplier identities and impossible lifecycle transitions", async () => {
  const { projectOwnerDraft } = await import(modelUrl.href);
  const base = { publishers: [], suppliers: [] };
  assert.throws(() => projectOwnerDraft(base, { version: 1, baseRevision: "c".repeat(64), operations: [
    { type: "publisher.add", id: id(10), name: "출판사", subjects: [], supplierIds: [id(11), id(11)] },
  ] }), /textbook_settings_draft_invalid/);
  assert.throws(() => projectOwnerDraft(base, { version: 1, baseRevision: "d".repeat(64), operations: [
    { type: "publisher.patch", id: id(12), patch: { name: "없는 출판사" } },
  ] }), /textbook_settings_draft_invalid/);
});

test("owner draft model keeps base positions, prepends newest adds, and rejects deleted identity reuse", async () => {
  const { projectOwnerDraft } = await import(modelUrl.href);
  const base = {
    publishers: [{ id: id(1), name: "기존 1", subjects: [], supplierIds: [], isNew: false }, { id: id(2), name: "기존 2", subjects: [], supplierIds: [], isNew: false }],
    suppliers: [{ id: id(10), name: "기존 공급처", contact: "", memo: "", isNew: false }],
  };
  const revision = "e".repeat(64);
  const result = projectOwnerDraft(base, { version: 1, baseRevision: revision, operations: [
    { type: "supplier.add", id: id(11), name: " 새 공급처 ", contact: " 연락 ", memo: " 메모 " },
    { type: "publisher.add", id: id(3), name: " 새 출판사 ", subjects: [" english "], supplierIds: [id(11)] },
    { type: "publisher.patch", id: id(1), patch: { name: " 이름 변경 " } },
  ] });
  assert.deepEqual(result.publishers.map(row => row.id), [id(3), id(1), id(2)]);
  assert.deepEqual(result.suppliers.map(row => row.id), [id(11), id(10)]);
  assert.deepEqual(result.publishers[0], { id: id(3), name: "새 출판사", subjects: ["english"], supplierIds: [id(11)], isNew: true });
  assert.equal(result.publishers[1].name, "이름 변경");
  for (const operations of [
    [{ type: "publisher.delete", id: id(1) }, { type: "publisher.add", id: id(1), name: "다시", subjects: [], supplierIds: [] }],
    [{ type: "supplier.delete", id: id(10) }, { type: "supplier.add", id: id(10), name: "다시", contact: "", memo: "" }],
  ]) assert.throws(() => projectOwnerDraft(base, { version: 1, baseRevision: revision, operations }), /textbook_settings_draft_invalid/);
});

test("owner model mirrors exact whitespace search, numeric first-three names, and ID-first textbook counts", async () => {
  const { ownerMatchesSearch, ownerFirstThreePublisherNames, ownerTextbookCounts } = await import(modelUrl.href);
  assert.equal(ownerMatchesSearch(["  Basic  Grammar ", "한글  제목"], "basic  grammar"), true);
  assert.equal(ownerMatchesSearch(["  Basic  Grammar "], "basic grammar"), false, "inner whitespace is not collapsed");
  assert.equal(ownerMatchesSearch(["한글  제목"], "한글  제목"), true);
  assert.deepEqual(ownerFirstThreePublisherNames([
    { id: id(1), name: "출판사 10" }, { id: id(2), name: "출판사 2" }, { id: id(3), name: "출판사 1" }, { id: id(4), name: "출판사 20" },
  ]), ["출판사 1", "출판사 2", "출판사 10"]);
  const counts = ownerTextbookCounts([
    { id: id(20), name: " Same " }, { id: id(21), name: "Same" },
  ], [
    { publisherId: id(20), publisher: "Same" },
    { publisherId: id(22), publisher: "Same" },
    { publisherId: null, publisher: " Same " },
  ]);
  assert.deepEqual([...counts], [[id(20), 1], [id(21), 1]], "nonempty publisherId wins even when dangling; null display fallback is the last canonical matching trimmed name");
});
