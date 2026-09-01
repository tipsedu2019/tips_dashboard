import assert from "node:assert/strict";
import test from "node:test";

const taxonomyUrl = new URL("../src/features/textbooks/textbook-taxonomy.ts", import.meta.url);
const id = (value) => `6c000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const revision = "a".repeat(64);

test("taxonomy projection exports the strict journal boundary", async () => {
  const model = await import(taxonomyUrl.href);
  assert.equal(typeof model.assertSubSubjectDraft, "function");
  assert.equal(typeof model.projectTextbookSubSubjectDraft, "function");
});

test("persisted rows suppress matching defaults while all other built-ins remain stable", async () => {
  const { projectTextbookSubSubjectDraft } = await import(taxonomyUrl.href);
  const persistedId = id(1);
  const rows = projectTextbookSubSubjectDraft([
    { id: persistedId, subject: "영어", name: " 단어 ", sort_order: 10, is_visible: false },
  ], null);

  assert.equal(rows.length, 21);
  assert.deepEqual(rows.find((row) => row.id === persistedId), {
    id: persistedId,
    subject: "english",
    name: "단어",
    sortOrder: 10,
    isVisible: false,
    kind: "persisted",
    canMoveUp: false,
    canMoveDown: true,
  });
  assert.equal(rows.some((row) => row.id === "english-단어"), false);
  assert.equal(rows.filter((row) => row.kind === "default").length, 20);
  assert.equal(rows.find((row) => row.id === "science-물리학")?.kind, "default");
});

test("the complete chronological journal preserves blank previews and global subject rank", async () => {
  const { projectTextbookSubSubjectDraft } = await import(taxonomyUrl.href);
  const addedId = id(2);
  const persistedId = id(3);
  const rows = projectTextbookSubSubjectDraft([
    { id: persistedId, subject: "math", name: "사용자 2", sort_order: 500, is_visible: true },
  ], {
    version: 1,
    baseRevision: revision,
    operations: [
      { type: "add", id: addedId, subject: "math", name: "", isVisible: true },
      { type: "patch", id: addedId, patch: { name: " 사용자 10 ", isVisible: false } },
      { type: "patch", id: persistedId, patch: { name: "   " } },
      { type: "move", id: addedId, direction: "up" },
    ],
  });

  const math = rows.filter((row) => row.subject === "math");
  const added = math.find((row) => row.id === addedId);
  const persisted = math.find((row) => row.id === persistedId);
  assert.equal(added.kind, "added");
  assert.equal(added.name, "사용자 10");
  assert.equal(added.isVisible, false);
  assert.equal(persisted.name, "");
  assert.ok(math.indexOf(added) < math.indexOf(persisted), "move uses the complete subject order");
  assert.equal(added.canMoveUp, true);
  assert.equal(added.canMoveDown, true);
});

test("delete tombstones virtual defaults only in the active draft and custom rows independently", async () => {
  const { projectTextbookSubSubjectDraft } = await import(taxonomyUrl.href);
  const customId = id(4);
  const base = [{ id: customId, subject: "english", name: "사용자", sort_order: 700, is_visible: true }];
  const projected = projectTextbookSubSubjectDraft(base, {
    version: 1,
    baseRevision: revision,
    operations: [
      { type: "delete", id: "english-독해" },
      { type: "delete", id: customId },
    ],
  });
  assert.equal(projected.some((row) => row.id === "english-독해"), false);
  assert.equal(projected.some((row) => row.id === customId), false);
  const canonicalReload = projectTextbookSubSubjectDraft(base, null);
  assert.equal(canonicalReload.some((row) => row.id === "english-독해"), true);
  assert.equal(canonicalReload.some((row) => row.id === customId), true);
});

test("more than one hundred custom rows retain defaults, deterministic ties, and page eleven", async () => {
  const { projectTextbookSubSubjectDraft } = await import(taxonomyUrl.href);
  const base = Array.from({ length: 101 }, (_, index) => ({
    id: id(1000 + index),
    subject: index % 2 ? "legacy-unknown" : "other",
    name: `사용자 ${index + 1}`,
    sort_order: 100,
    is_visible: index % 3 !== 0,
  }));
  const rows = projectTextbookSubSubjectDraft(base, null);
  const other = rows.filter((row) => row.subject === "other");
  assert.equal(other.length, 102, "101 persisted rows plus the missing other default");
  assert.equal(other.slice(100, 110).length, 2);
  assert.deepEqual(
    other.filter((row) => row.sortOrder === 100).slice(0, 3).map((row) => row.name),
    ["사용자 1", "사용자 2", "사용자 3"],
  );
});

test("invalid shapes, duplicate add identities, and impossible transitions fail before projection", async () => {
  const { assertSubSubjectDraft, projectTextbookSubSubjectDraft } = await import(taxonomyUrl.href);
  for (const invalid of [
    { version: 1, baseRevision: revision, operations: [{ type: "patch", id: "english-단어", patch: {} }] },
    { version: 1, baseRevision: revision, operations: [{ type: "move", id: "english-단어", direction: "sideways" }] },
    { version: 1, baseRevision: revision, operations: [{ type: "add", id: id(8), subject: "korean", name: "국어", isVisible: true }] },
    { version: 1, baseRevision: revision, operations: [], extra: true },
  ]) assert.throws(() => assertSubSubjectDraft(invalid), /textbook_settings_draft_invalid/);

  assert.throws(() => projectTextbookSubSubjectDraft([], {
    version: 1,
    baseRevision: revision,
    operations: [
      { type: "add", id: id(9), subject: "english", name: "새 항목", isVisible: true },
      { type: "delete", id: id(9) },
      { type: "add", id: id(9), subject: "english", name: "재사용", isVisible: true },
    ],
  }), /textbook_settings_draft_invalid/);
  assert.throws(() => projectTextbookSubSubjectDraft([], {
    version: 1,
    baseRevision: revision,
    operations: [{ type: "patch", id: id(999), patch: { name: "없음" } }],
  }), /textbook_settings_draft_invalid/);
});

test("move still swaps adjacent rows when legacy ranks are tied", async () => {
  const { projectTextbookSubSubjectDraft } = await import(taxonomyUrl.href);
  const firstId = id(700);
  const secondId = id(701);
  const rows = projectTextbookSubSubjectDraft([
    { id: firstId, subject: "other", name: "동률 1", sort_order: 100, is_visible: true },
    { id: secondId, subject: "other", name: "동률 2", sort_order: 100, is_visible: true },
  ], {
    version: 1,
    baseRevision: revision,
    operations: [{ type: "move", id: secondId, direction: "up" }],
  }).filter((row) => [firstId, secondId].includes(row.id));
  assert.deepEqual(rows.map((row) => row.id), [secondId, firstId]);
});
