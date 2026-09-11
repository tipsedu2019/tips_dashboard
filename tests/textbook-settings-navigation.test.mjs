import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { requestAppNavigation } from "../src/lib/guarded-navigation.ts";
import { button, changeInput, click, id, ownerPage, publisherRow, revision, setupTextbookSettings, subSubjectPage, subSubjectRow, supplierRow, tab } from "./helpers/textbook-settings-harness.mjs";

const input = () => document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(1)}"] input`);
const confirmation = () => document.querySelector('[data-testid="draft-navigation-confirm-dialog"]');
async function route(destinations, value) { await act(async () => requestAppNavigation(() => destinations.push(value))); }
async function waitFor(predicate) { for (let i = 0; i < 60; i++) { if (predicate()) return; await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); } assert.ok(predicate()); }
async function setup(t) { const h = await setupTextbookSettings(t); const page = await h.waitForRequest("list_textbook_publisher_page_v1"); await h.resolve(page, ownerPage(page, [publisherRow(1)], 1)); return h; }
function receipt(request, newRevision = "b") { return { requestId: request.args.p_request_id, owners: { baseRevision: revision("a"), newRevision: revision(newRevision), changedPublisherIds: [id(1)], deletedPublisherIds: [], changedSupplierIds: [], deletedSupplierIds: [], changedLinkPublisherIds: [] }, subSubjects: null }; }

test("actual textbook settings confirms dirty route, cancels without loss, and does not prompt after reverting a field", async t => {
  await setup(t); const destinations = [];
  await route(destinations, "clean"); assert.deepEqual(destinations, ["clean"]);
  await changeInput(input(), "미저장 출판사"); await route(destinations, "cancelled"); assert.deepEqual(destinations, ["clean"]); assert.ok(confirmation());
  await click(button("계속 편집", confirmation())); assert.equal(input().value, "미저장 출판사");
  await changeInput(input(), "출판사 1"); await route(destinations, "reverted"); assert.deepEqual(destinations, ["clean", "reverted"]);
  await changeInput(input(), "이동할 초안"); await route(destinations, "approved"); await click(button("변경사항 버리기", confirmation())); await waitFor(() => destinations.length === 3); assert.deepEqual(destinations, ["clean", "reverted", "approved"]);
});

test("textbook acknowledgement keeps a newer draft guarded and rebases the revert comparison to the submitted value", async t => {
  const h = await setup(t), destinations = [];
  await changeInput(input(), "제출한 출판사"); await click(button("변경 저장"));
  const save = await h.waitForRequest("save_textbook_settings_draft_v1");
  await changeInput(input(), "저장 중 추가 편집"); await h.resolve(save, receipt(save));
  assert.equal(input().value, "저장 중 추가 편집"); await route(destinations, "blocked-newer"); assert.deepEqual(destinations, []); await click(button("계속 편집", confirmation()));
  await changeInput(input(), "제출한 출판사"); await route(destinations, "submitted-value"); assert.deepEqual(destinations, ["submitted-value"]);
});

test("textbook known save failure preserves navigation protection until explicit retry succeeds", async t => {
  const h = await setup(t), destinations = [];
  await changeInput(input(), "재시도할 출판사"); await click(button("변경 저장")); const first = await h.waitForRequest("save_textbook_settings_draft_v1");
  await h.databaseError(first, { code: "23514", message: "temporary rejection" });
  await route(destinations, "failed-save-route"); assert.deepEqual(destinations, []); await click(button("계속 편집", confirmation())); assert.equal(input().value, "재시도할 출판사");
  await click(button("변경 저장")); const retry = await h.waitForRequest("save_textbook_settings_draft_v1", 2); await h.resolve(retry, receipt(retry));
  await route(destinations, "saved"); assert.deepEqual(destinations, ["saved"]); assert.equal(confirmation(), null);
});

test("supplier and subsubject field reverts are clean while tab selection preserves other drafts", async t => {
  const h = await setup(t), destinations = [];
  await click(tab("총판")); const suppliers = await h.waitForRequest("list_textbook_supplier_page_v1"); await h.resolve(suppliers, ownerPage(suppliers, [supplierRow(1)], 1));
  await route(destinations, "supplier-selection"); assert.deepEqual(destinations, ["supplier-selection"]);
  const supplierInput = document.querySelector(`[data-testid="textbook-supplier-mobile-card-${id(1)}"] input`);
  await changeInput(supplierInput, "총판 수정"); await route(destinations, "supplier-blocked"); assert.equal(destinations.length, 1); await click(button("계속 편집", confirmation()));
  await changeInput(supplierInput, "총판 1"); await route(destinations, "supplier-reverted"); assert.equal(destinations.length, 2);
  await click(tab("세부과목")); const taxonomy = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1"); await h.resolve(taxonomy, subSubjectPage(taxonomy, [subSubjectRow(1, { canMoveDown: false })], 1, { visibleCount: 61 }));
  const taxonomyInput = document.querySelector(`[data-testid="textbook-subsubject-mobile-card-${id(1001)}"] input`);
  assert.ok(taxonomyInput, document.body.textContent);
  await changeInput(taxonomyInput, "세부과목 수정"); await route(destinations, "taxonomy-blocked"); assert.equal(destinations.length, 2); await click(button("계속 편집", confirmation()));
  await changeInput(taxonomyInput, "세부과목 1"); await route(destinations, "taxonomy-reverted"); assert.equal(destinations.length, 3);
});

test("unknown textbook save remains guarded even after a local field reverts, and role change drops old ownership", async t => {
  const h = await setup(t), destinations = [];
  await changeInput(input(), "결과가 불명확한 저장"); await click(button("변경 저장")); const save = await h.waitForRequest("save_textbook_settings_draft_v1");
  await h.reject(save, new TypeError("Failed to fetch"));
  await changeInput(input(), "출판사 1"); await route(destinations, "unknown-outcome"); assert.deepEqual(destinations, []); await click(button("계속 편집", confirmation()));
  await h.setAuth({ role: "teacher" }); await route(destinations, "new-role"); assert.deepEqual(destinations, ["new-role"]); assert.equal(confirmation(), null);
});

test("changing publisher supplier priority remains dirty even with the same linked supplier set", async t => {
  const h = await setupTextbookSettings(t), destinations = [];
  const links = [{ id: id(10), name: "총판 10" }, { id: id(11), name: "총판 11" }];
  const row = publisherRow(1, { suppliers: links });
  const initialPage = await h.waitForRequest("list_textbook_publisher_page_v1"); await h.resolve(initialPage, ownerPage(initialPage, [row], 1));
  const card = document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(1)}"]`);
  await click(button("총판 10, 총판 11", card));
  const picker = await h.waitForRequest("list_textbook_supplier_setting_picker_page_v1"); await h.resolve(picker, ownerPage(picker, links, 2));
  const detail = await h.waitForRequest("get_textbook_publisher_setting_detail_v1"); await h.resolve(detail, { row, baseRevision: revision("a"), ownerCounts: { publishers: 1, suppliers: 2 } });
  await click(document.querySelector('[aria-label="총판 10 연결"]').closest('[cmdk-item]'));
  const nextDetail = await h.waitForRequest("get_textbook_publisher_setting_detail_v1", 2); await h.resolve(nextDetail, { row: { ...row, suppliers: [links[1]] }, baseRevision: revision("a"), ownerCounts: { publishers: 1, suppliers: 2 } });
  const nextPicker = await h.waitForRequest("list_textbook_supplier_setting_picker_page_v1", 2); await h.resolve(nextPicker, ownerPage(nextPicker, links, 2));
  await click(document.querySelector('[aria-label="총판 10 연결"]').closest('[cmdk-item]'));
  const reordered = await h.waitForRequest("get_textbook_publisher_setting_detail_v1", 3);
  assert.deepEqual(reordered.args.p_draft.operations.at(-1).patch.supplierIds, [id(11), id(10)]);
  await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await route(destinations, "priority-change"); assert.deepEqual(destinations, []); assert.ok(confirmation());
});
