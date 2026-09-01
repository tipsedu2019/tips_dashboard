import assert from "node:assert/strict";
import test from "node:test";

const modelUrl = new URL(
  "../src/features/textbooks/textbook-settings-draft-model.ts",
  import.meta.url,
);
const id = (value) => `6d000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const revision = (value) => String(value).repeat(64);

test("actor-scoped settings drafts keep page-independent chronological journals", async () => {
  const model = await import(modelUrl.href);
  let state = model.createTextbookSettingsDraftState("actor-a:admin");
  state = model.acceptTextbookOwnerRevision(state, revision("a"));
  state = model.acceptTextbookSubSubjectRevision(state, revision("b"));
  state = model.appendTextbookOwnerOperation(state, {
    type: "publisher.patch",
    id: id(1),
    patch: { name: "페이지 11 편집" },
  });
  state = model.appendTextbookSubSubjectOperation(state, {
    type: "patch",
    id: "english-독해",
    patch: { name: "독해 심화" },
  });

  assert.deepEqual(model.getTextbookOwnerDraft(state), {
    version: 1,
    baseRevision: revision("a"),
    operations: [{
      type: "publisher.patch",
      id: id(1),
      patch: { name: "페이지 11 편집" },
    }],
  });
  assert.deepEqual(model.getTextbookSubSubjectDraft(state), {
    version: 1,
    baseRevision: revision("b"),
    operations: [{
      type: "patch",
      id: "english-독해",
      patch: { name: "독해 심화" },
    }],
  });
  assert.equal(model.hasTextbookSettingsChanges(state), true);

  const otherActor = model.createTextbookSettingsDraftState("actor-a:teacher");
  assert.equal(model.hasTextbookSettingsChanges(otherActor), false);
});

test("one frozen request survives double click and explicit unknown-result confirmation byte-for-byte", async () => {
  const model = await import(modelUrl.href);
  let state = model.acceptTextbookOwnerRevision(
    model.createTextbookSettingsDraftState("actor-a:admin"),
    revision("c"),
  );
  state = model.appendTextbookOwnerOperation(state, {
    type: "supplier.add",
    id: id(2),
    name: "새 총판",
    contact: "",
    memo: "",
  });
  const first = model.freezeTextbookSettingsSave(state, id(90));
  const second = model.freezeTextbookSettingsSave(first.state, id(91));
  assert.strictEqual(second.request, first.request);
  assert.deepEqual(second.request, first.request);
  assert.equal(second.request.requestId, id(90));

  state = model.markTextbookSettingsSaveUnknown(second.state);
  assert.equal(state.pendingSave?.status, "unknown");
  const confirmation = model.freezeTextbookSettingsSave(state, id(92));
  assert.strictEqual(confirmation.request, first.request);
  assert.deepEqual(confirmation.request, first.request);
});

test("acknowledgement clears only the frozen prefix, advances revisions, and remaps later virtual targets", async () => {
  const model = await import(modelUrl.href);
  let state = model.createTextbookSettingsDraftState("actor-a:admin");
  state = model.acceptTextbookOwnerRevision(state, revision("d"));
  state = model.acceptTextbookSubSubjectRevision(state, revision("e"));
  state = model.appendTextbookOwnerOperation(state, {
    type: "publisher.patch",
    id: id(3),
    patch: { name: "저장 대상" },
  });
  state = model.appendTextbookSubSubjectOperation(state, {
    type: "patch",
    id: "english-문법",
    patch: { name: "문법 A" },
  });
  const frozen = model.freezeTextbookSettingsSave(state, id(93));
  state = model.appendTextbookOwnerOperation(frozen.state, {
    type: "publisher.patch",
    id: id(3),
    patch: { subjects: ["english", "math"] },
  });
  state = model.appendTextbookSubSubjectOperation(state, {
    type: "patch",
    id: "english-문법",
    patch: { name: "문법 B" },
  });

  state = model.acknowledgeTextbookSettingsSave(state, {
    requestId: id(93),
    owners: {
      baseRevision: revision("d"),
      newRevision: revision("f"),
      changedPublisherIds: [id(3)],
      deletedPublisherIds: [],
      changedSupplierIds: [],
      deletedSupplierIds: [],
      changedLinkPublisherIds: [],
    },
    subSubjects: {
      baseRevision: revision("e"),
      newRevision: revision("1"),
      changedIds: [id(4)],
      deletedIds: [],
      materializedIds: { "english-문법": id(4) },
    },
  });

  assert.equal(state.pendingSave, null);
  assert.deepEqual(model.getTextbookOwnerDraft(state), {
    version: 1,
    baseRevision: revision("f"),
    operations: [{
      type: "publisher.patch",
      id: id(3),
      patch: { subjects: ["english", "math"] },
    }],
  });
  assert.deepEqual(model.getTextbookSubSubjectDraft(state), {
    version: 1,
    baseRevision: revision("1"),
    operations: [{
      type: "patch",
      id: id(4),
      patch: { name: "문법 B" },
    }],
  });
});

test("known rollback and stale conflict retain journals while explicit discard clears them", async () => {
  const model = await import(modelUrl.href);
  let state = model.acceptTextbookOwnerRevision(
    model.createTextbookSettingsDraftState("actor-a:admin"),
    revision("2"),
  );
  state = model.appendTextbookOwnerOperation(state, {
    type: "publisher.delete",
    id: id(5),
  });
  state = model.freezeTextbookSettingsSave(state, id(94)).state;
  state = model.rejectTextbookSettingsSave(state);
  assert.equal(state.pendingSave, null);
  assert.equal(model.hasTextbookSettingsChanges(state), true);
  assert.equal(model.classifyTextbookSettingsSaveError({ code: "55000" }), "conflict");
  assert.equal(model.classifyTextbookSettingsSaveError(new DOMException("timeout", "TimeoutError")), "unknown");
  assert.equal(model.classifyTextbookSettingsSaveError({ code: "42501" }), "known");

  state = model.discardTextbookSettingsDrafts(state);
  assert.equal(model.hasTextbookSettingsChanges(state), false);
  assert.equal(state.ownerBaseRevision, null);
  assert.equal(state.subSubjectBaseRevision, null);
});
