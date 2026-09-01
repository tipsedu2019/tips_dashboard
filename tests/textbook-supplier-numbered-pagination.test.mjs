import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";

import {
  button,
  changeInput,
  click,
  id,
  ownerPage,
  publisherRow,
  revision,
  setupTextbookSettings,
  subSubjectPage,
  subSubjectRow,
  supplierRow,
  tab,
} from "./helpers/textbook-settings-harness.mjs";

const rowsFor = (page, factory, size = 10) => Array.from({ length: size }, (_, index) => factory((page - 1) * size + index + 1));

test("actual publisher consumer shows one bounded page, page10 to page11 blocks, retained failure, and retry", async (t) => {
  const h = await setupTextbookSettings(t);
  const first = await h.waitForRequest("list_textbook_publisher_page_v1");
  assert.deepEqual(first.args, { p_filters: { search: "" }, p_draft: null, p_sort: "name", p_page: 1, p_page_size: 10 });
  assert.equal(first.retry, false);
  assert.equal(h.requests.some((request) => request.name === "list_textbook_sub_subject_numbered_page_v1"), false);
  await h.resolve(first, ownerPage(first, rowsFor(1, publisherRow), 250));

  const mobile = [...document.querySelectorAll('[data-testid^="textbook-publisher-mobile-card-"]')].map((node) => node.dataset.testid);
  const desktop = [...document.querySelectorAll('[data-testid^="textbook-publisher-desktop-row-"]')].map((node) => node.dataset.testid);
  assert.equal(mobile.length, 10);
  assert.deepEqual(mobile.map((value) => value.replace("mobile-card", "desktop-row")), desktop);
  const firstPager = document.querySelector('[aria-label="출판사 목록 페이지 탐색"]');
  assert.deepEqual([...firstPager.querySelectorAll('[data-slot="pagination-number-group"] button')].map((node) => Number(node.textContent)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  await click(button("10 페이지", firstPager));
  const tenth = await h.waitForRequest("list_textbook_publisher_page_v1", 2);
  assert.equal(tenth.args.p_page, 10);
  await h.resolve(tenth, ownerPage(tenth, rowsFor(10, publisherRow), 250));
  await click(button("다음 페이지", firstPager));
  const eleventh = await h.waitForRequest("list_textbook_publisher_page_v1", 3);
  assert.equal(eleventh.args.p_page, 11);
  await h.resolve(eleventh, ownerPage(eleventh, rowsFor(11, publisherRow), 250));
  assert.match(document.body.textContent, /출판사 101/);
  assert.deepEqual([...firstPager.querySelectorAll('[data-slot="pagination-number-group"] button')].map((node) => Number(node.textContent)), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);

  await click(button("12 페이지", firstPager));
  const failed = await h.waitForRequest("list_textbook_publisher_page_v1", 4);
  await h.reject(failed, new Error("PAGE TWELVE FAILED"));
  assert.match(document.body.textContent, /출판사 101/);
  assert.match(document.body.textContent, /PAGE TWELVE FAILED/);
  assert.equal(button("11 페이지", firstPager).getAttribute("aria-current"), "page");
  await click(button("다시 시도"));
  const retry = await h.waitForRequest("list_textbook_publisher_page_v1", 5);
  assert.equal(retry.args.p_page, 12);
  await h.resolve(retry, ownerPage(retry, rowsFor(12, publisherRow), 250));
  assert.match(document.body.textContent, /출판사 111/);
});

test("manual 15-row preference prepares the same 15 rows for mobile and desktop", async (t) => {
  const h = await setupTextbookSettings(t, {
    preferences: { "textbooks:publishers": { mode: "manual", pageSize: 15 } },
  });
  const request = await h.waitForRequest("list_textbook_publisher_page_v1");
  assert.equal(request.args.p_page_size, 15);
  await h.resolve(request, ownerPage(request, rowsFor(1, publisherRow, 15), 120));
  assert.equal(document.querySelectorAll('[data-testid^="textbook-publisher-mobile-card-"]').length, 15);
  assert.equal(document.querySelectorAll('[data-testid^="textbook-publisher-desktop-row-"]').length, 15);
});

test("publisher and supplier Add rows render and focus before their projected pages return", async (t) => {
  const h = await setupTextbookSettings(t);
  const publisherPage = await h.waitForRequest("list_textbook_publisher_page_v1");
  await h.resolve(publisherPage, ownerPage(publisherPage, rowsFor(1, publisherRow), 120));

  await click(button("출판사 추가"));
  const publisherProjection = await h.waitForRequest("list_textbook_publisher_page_v1", 2);
  const publisherAdd = publisherProjection.args.p_draft.operations.at(-1);
  const publisherCard = document.querySelector(`[data-testid="textbook-publisher-mobile-card-${publisherAdd.id}"]`);
  assert.ok(publisherCard, "publisher draft row must not wait for the projection response");
  assert.equal(document.activeElement?.getAttribute("data-focus-id"), publisherAdd.id);
  await h.resolve(publisherProjection, ownerPage(publisherProjection, [
    publisherRow(1, { id: publisherAdd.id, name: "", subjects: [], textbookCount: 0, isNew: true }),
    ...rowsFor(1, publisherRow).slice(0, 9),
  ], 121));

  await click(tab("총판"));
  const supplierPage = await h.waitForRequest("list_textbook_supplier_page_v1");
  await h.resolve(supplierPage, ownerPage(supplierPage, rowsFor(1, supplierRow), 150));
  await click(button("총판 추가"));
  const supplierProjection = await h.waitForRequest("list_textbook_supplier_page_v1", 2);
  const supplierAdd = supplierProjection.args.p_draft.operations.at(-1);
  const supplierCard = document.querySelector(`[data-testid="textbook-supplier-mobile-card-${supplierAdd.id}"]`);
  assert.ok(supplierCard, "supplier draft row must not wait for the projection response");
  assert.equal(document.activeElement?.getAttribute("data-focus-id"), supplierAdd.id);
  await h.resolve(supplierProjection, ownerPage(supplierProjection, [
    supplierRow(1, { id: supplierAdd.id, name: "", contact: "", memo: "", isNew: true }),
    ...rowsFor(1, supplierRow).slice(0, 9),
  ], 151));
});

test("publisher Add leaves an accepted later page and immediately presents the page-one draft snapshot", async (t) => {
  const h = await setupTextbookSettings(t);
  const first = await h.waitForRequest("list_textbook_publisher_page_v1");
  await h.resolve(first, ownerPage(first, rowsFor(1, publisherRow), 250));
  const pager = document.querySelector('[aria-label="출판사 목록 페이지 탐색"]');

  await click(button("10 페이지", pager));
  const tenth = await h.waitForRequest("list_textbook_publisher_page_v1", 2);
  await h.resolve(tenth, ownerPage(tenth, rowsFor(10, publisherRow), 250));
  await click(button("다음 페이지", pager));
  const eleventh = await h.waitForRequest("list_textbook_publisher_page_v1", 3);
  await h.resolve(eleventh, ownerPage(eleventh, rowsFor(11, publisherRow), 250));
  assert.ok(document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(101)}"]`));

  await click(button("출판사 추가"));
  const projection = await h.waitForRequest("list_textbook_publisher_page_v1", 4);
  assert.equal(projection.args.p_page, 1);
  const addition = projection.args.p_draft.operations.at(-1);
  assert.equal(pager.querySelector('[aria-current="page"]')?.textContent.trim(), "1");
  assert.equal(document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(101)}"]`), null);
  assert.ok(document.querySelector(`[data-testid="textbook-publisher-mobile-card-${addition.id}"]`));
  assert.equal(document.querySelectorAll('[data-testid^="textbook-publisher-mobile-card-"]').length, 1);
  assert.equal(document.querySelectorAll('[data-testid^="textbook-publisher-desktop-row-"]').length, 1);

  await h.resolve(projection, ownerPage(projection, [
    publisherRow(1, { id: addition.id, name: "", subjects: [], textbookCount: 0, isNew: true }),
    ...rowsFor(1, publisherRow).slice(0, 9),
  ], 251));
});

test("authenticated non-managers retain reads but cannot edit or invoke settings writes", async (t) => {
  const h = await setupTextbookSettings(t, { auth: { role: "teacher" } });
  const page = await h.waitForRequest("list_textbook_publisher_page_v1");
  await h.resolve(page, ownerPage(page, rowsFor(1, publisherRow), 120));

  const card = document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(1)}"]`);
  assert.equal(card.querySelector('input[data-focus-mode="mobile"]').disabled, true);
  assert.equal(button("출판사 삭제", card).disabled, true);
  assert.equal(button("출판사 추가").disabled, true);
  assert.equal(button("변경 저장").disabled, true);
  await click(button("출판사 추가"));
  assert.equal(h.requests.filter((request) => request.name === "save_textbook_settings_draft_v1").length, 0);
  assert.equal(h.requests.filter((request) => request.name === "list_textbook_publisher_page_v1").length, 1);
});

test("a deleted publisher disappears from both renderers before the projected page returns", async (t) => {
  const h = await setupTextbookSettings(t);
  const first = await h.waitForRequest("list_textbook_publisher_page_v1");
  await h.resolve(first, ownerPage(first, rowsFor(1, publisherRow), 120));

  const mobileCard = document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(1)}"]`);
  await click(button("출판사 삭제", mobileCard));
  const projected = await h.waitForRequest("list_textbook_publisher_page_v1", 2);

  assert.equal(document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(1)}"]`), null);
  assert.equal(document.querySelector(`[data-testid="textbook-publisher-desktop-row-${id(1)}"]`), null);
  await h.resolve(projected, ownerPage(projected, rowsFor(1, publisherRow).slice(1), 119));
});

test("supplier tab uses whole counts and first-three names without a publisher reread", async (t) => {
  const h = await setupTextbookSettings(t);
  const publisherRequest = await h.waitForRequest("list_textbook_publisher_page_v1");
  await h.resolve(publisherRequest, ownerPage(publisherRequest, rowsFor(1, publisherRow), 250));
  await click(tab("총판"));
  const supplierRequest = await h.waitForRequest("list_textbook_supplier_page_v1");
  const row = supplierRow(1, {
    linkedPublisherCount: 5,
    linkedPublisherNames: ["출판사 1", "출판사 2", "출판사 10"],
  });
  await h.resolve(supplierRequest, ownerPage(supplierRequest, [row, ...rowsFor(1, supplierRow).slice(1)], 125));
  assert.equal(h.requests.filter((request) => request.name === "list_textbook_publisher_page_v1").length, 1);
  assert.match(tab("출판사").textContent, /250/);
  assert.match(tab("총판").textContent, /150/);
  assert.match(document.body.textContent, /출판사 1/);
  assert.match(document.body.textContent, /출판사 10/);
  assert.match(document.body.textContent, /\+2/);
  assert.equal(document.querySelectorAll('[data-testid^="textbook-supplier-mobile-card-"]').length, 10);
  assert.equal(document.querySelectorAll('[data-testid^="textbook-supplier-desktop-row-"]').length, 10);
});

test("paged supplier picker preserves complete off-page checked links from publisher detail", async (t) => {
  const h = await setupTextbookSettings(t);
  const first = await h.waitForRequest("list_textbook_publisher_page_v1");
  const linked = [{ id: id(1), name: "총판 1" }, { id: id(50), name: "총판 50" }];
  await h.resolve(first, ownerPage(first, [publisherRow(1, { suppliers: linked }), ...rowsFor(1, publisherRow).slice(1)], 120));
  const desktopRow = document.querySelector(`[data-testid="textbook-publisher-desktop-row-${id(1)}"]`);
  const trigger = [...desktopRow.querySelectorAll("button")].find((node) => node.textContent.includes("총판 50"));
  await click(trigger);
  const detail = await h.waitForRequest("get_textbook_publisher_setting_detail_v1");
  const pickerFirst = await h.waitForRequest("list_textbook_supplier_setting_picker_page_v1");
  await h.resolve(detail, { row: publisherRow(1, { suppliers: linked }), baseRevision: revision("a"), ownerCounts: { publishers: 120, suppliers: 150 } });
  await h.resolve(pickerFirst, ownerPage(pickerFirst, rowsFor(1, (value) => ({ id: id(value), name: `총판 ${value}` })), 150, { ownerCounts: { publishers: 120, suppliers: 150 } }));
  assert.equal(document.querySelector(`[aria-label="총판 1 연결"]`).getAttribute("data-state"), "checked");
  const pickerPager = document.querySelector('[aria-label="총판 선택 페이지 탐색"]');
  await click(button("5 페이지", pickerPager));
  const pickerFifth = await h.waitForRequest("list_textbook_supplier_setting_picker_page_v1", 2);
  await h.resolve(pickerFifth, ownerPage(pickerFifth, rowsFor(5, (value) => ({ id: id(value), name: `총판 ${value}` })), 150, { ownerCounts: { publishers: 120, suppliers: 150 } }));
  assert.equal(document.querySelector(`[aria-label="총판 50 연결"]`).getAttribute("data-state"), "checked");
  assert.ok(h.requests.every((request) => request.retry === false));
  await act(async () => {});
});

test("one mixed save freezes once while edits made in flight survive as the next journal", async (t) => {
  const h = await setupTextbookSettings(t);
  const publisherRequest = await h.waitForRequest("list_textbook_publisher_page_v1");
  await h.resolve(publisherRequest, ownerPage(publisherRequest, rowsFor(1, publisherRow), 120));
  const publisherInput = document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(1)}"] input[data-focus-mode="mobile"]`);
  await changeInput(publisherInput, "출판사 변경");
  await h.waitForRequest("list_textbook_publisher_page_v1", 2);
  await click(tab("세부과목"));
  const taxonomyRequest = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1");
  const taxonomyRow = {
    id: id(1001), subject: "english", name: "세부과목 1", sortOrder: 10,
    isVisible: true, kind: "persisted", canMoveUp: false, canMoveDown: false,
  };
  await h.resolve(taxonomyRequest, {
    rows: [taxonomyRow], page: 1, pageSize: 10, totalCount: 1,
    baseRevision: revision("b"), visibleCount: 1,
    subjectCounts: { english: 1, math: 0, science: 0, other: 0 },
  });
  const taxonomyInput = document.querySelector(`[data-testid="textbook-subsubject-mobile-card-${id(1001)}"] input[data-focus-mode="mobile"]`);
  await changeInput(taxonomyInput, "세부과목 A");
  await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1", 2);

  const saveButton = button("변경 저장");
  await act(async () => { saveButton.click(); saveButton.click(); });
  const firstSave = await h.waitForRequest("save_textbook_settings_draft_v1");
  assert.equal(h.requests.filter((request) => request.name === "save_textbook_settings_draft_v1").length, 1);
  assert.equal(firstSave.args.p_draft.owners.operations[0].patch.name, "출판사 변경");
  assert.equal(firstSave.args.p_draft.subSubjects.operations[0].patch.name, "세부과목 A");

  await changeInput(taxonomyInput, "세부과목 B");
  await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1", 3);
  await h.resolve(firstSave, {
    requestId: firstSave.args.p_request_id,
    owners: {
      baseRevision: revision("a"), newRevision: revision("c"),
      changedPublisherIds: [id(1)], deletedPublisherIds: [], changedSupplierIds: [],
      deletedSupplierIds: [], changedLinkPublisherIds: [],
    },
    subSubjects: {
      baseRevision: revision("b"), newRevision: revision("d"),
      changedIds: [id(1001)], deletedIds: [], materializedIds: {},
    },
  });
  assert.ok(button("변경 저장"), "later edit remains dirty after the frozen prefix is acknowledged");
  await click(button("변경 저장"));
  const secondSave = await h.waitForRequest("save_textbook_settings_draft_v1", 2);
  assert.equal(secondSave.args.p_draft.owners, null);
  assert.equal(secondSave.args.p_draft.subSubjects.baseRevision, revision("d"));
  assert.deepEqual(secondSave.args.p_draft.subSubjects.operations, [{ type: "patch", id: id(1001), patch: { name: "세부과목 B" } }]);
});

test("unknown save result is never automatic and confirms the exact same request", async (t) => {
  const h = await setupTextbookSettings(t);
  const page = await h.waitForRequest("list_textbook_publisher_page_v1");
  await h.resolve(page, ownerPage(page, rowsFor(1, publisherRow), 120));
  const input = document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(1)}"] input[data-focus-mode="mobile"]`);
  await changeInput(input, "결과 미상");
  await h.waitForRequest("list_textbook_publisher_page_v1", 2);
  await click(button("변경 저장"));
  const firstSave = await h.waitForRequest("save_textbook_settings_draft_v1");
  await h.reject(firstSave, new TypeError("Failed to fetch"));
  assert.equal(h.requests.filter((request) => request.name === "save_textbook_settings_draft_v1").length, 1);
  assert.match(document.body.textContent, /자동 재시도하지 않았습니다/);
  await click(button("저장 결과 확인"));
  const confirmation = await h.waitForRequest("save_textbook_settings_draft_v1", 2);
  assert.equal(confirmation.args.p_request_id, firstSave.args.p_request_id);
  assert.deepEqual(confirmation.args.p_draft, firstSave.args.p_draft);
  await h.resolve(confirmation, {
    requestId: confirmation.args.p_request_id,
    owners: {
      baseRevision: revision("a"), newRevision: revision("c"),
      changedPublisherIds: [id(1)], deletedPublisherIds: [], changedSupplierIds: [],
      deletedSupplierIds: [], changedLinkPublisherIds: [],
    },
    subSubjects: null,
  });
  assert.match(document.body.textContent, /변경사항을 저장했습니다/);
});

test("stale conflict keeps drafts on cancel and only explicit discard performs a retryable null-draft reload", async (t) => {
  const h = await setupTextbookSettings(t);
  const page = await h.waitForRequest("list_textbook_publisher_page_v1");
  await h.resolve(page, ownerPage(page, rowsFor(1, publisherRow), 120));
  const input = document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(1)}"] input[data-focus-mode="mobile"]`);
  await changeInput(input, "충돌 초안");
  await h.waitForRequest("list_textbook_publisher_page_v1", 2);
  await click(button("변경 저장"));
  const firstSave = await h.waitForRequest("save_textbook_settings_draft_v1");
  await h.databaseError(firstSave, { code: "55000", message: "stale revision" });
  assert.match(document.body.textContent, /초안을 유지하거나 버리고/);
  await click(button("취소"));
  assert.ok(button("변경 저장"));
  assert.equal(h.requests.filter((request) => request.name === "list_textbook_publisher_page_v1").length, 2);
  assert.equal(button("변경 저장").disabled, true);
  assert.equal(h.requests.filter((request) => request.name === "save_textbook_settings_draft_v1").length, 1);
  await click(button("초안 버리고 새로 불러오기"));
  const reload = await h.waitForRequest("list_textbook_publisher_page_v1", 3);
  assert.equal(reload.args.p_draft, null);
  await h.databaseError(reload, { code: "57014", message: "reload failed" });
  assert.match(document.body.textContent, /출판사 1/);
  assert.match(document.body.textContent, /reload failed/);
  assert.equal(input.disabled, true);
  await click(button("다시 시도"));
  const retry = await h.waitForRequest("list_textbook_publisher_page_v1", 4);
  assert.equal(retry.args.p_draft, null);
  await h.resolve(retry, ownerPage(retry, rowsFor(1, publisherRow), 120, { baseRevision: revision("c") }));
  const currentInput = document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(1)}"] input[data-focus-mode="mobile"]`);
  assert.equal(currentInput.disabled, false);
  assert.equal(button("변경 저장").disabled, true);
});

test("discarded owner and taxonomy snapshots unlock only after each null-draft baseline succeeds", async (t) => {
  const h = await setupTextbookSettings(t);
  const owner = await h.waitForRequest("list_textbook_publisher_page_v1");
  await h.resolve(owner, ownerPage(owner, rowsFor(1, publisherRow), 120));
  await click(tab("세부과목"));
  const taxonomy = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1");
  await h.resolve(taxonomy, subSubjectPage(taxonomy, [subSubjectRow(1, { canMoveDown: false })], 1, { visibleCount: 61 }));

  const taxonomyInput = document.querySelector(`[data-testid="textbook-subsubject-mobile-card-${id(1001)}"] input[data-focus-mode="mobile"]`);
  await changeInput(taxonomyInput, "폐기할 세부과목 초안");
  await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1", 2);
  await click(button("변경 저장"));
  const save = await h.waitForRequest("save_textbook_settings_draft_v1");
  await h.databaseError(save, { code: "55000", message: "stale revision" });

  const dialog = document.querySelector('[role="dialog"]');
  await click(button("초안 버리고 새로 불러오기", dialog));
  const taxonomyReload = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1", 3);
  assert.equal(taxonomyReload.args.p_draft, null);
  await h.resolve(taxonomyReload, subSubjectPage(taxonomyReload, [subSubjectRow(1, { canMoveDown: false })], 1, {
    baseRevision: revision("c"),
    visibleCount: 61,
  }));
  assert.equal(document.querySelector(`[data-testid="textbook-subsubject-mobile-card-${id(1001)}"] input`).disabled, false);

  await click(tab("출판사"));
  const ownerReload = await h.waitForRequest("list_textbook_publisher_page_v1", 2);
  const retainedOwnerInput = document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(1)}"] input[data-focus-mode="mobile"]`);
  assert.equal(retainedOwnerInput.disabled, true, "discarded owner snapshot stays read-only before its fresh baseline");
  await h.databaseError(ownerReload, { code: "57014", message: "owner reload failed" });
  assert.equal(document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(1)}"] input`).disabled, true);
  assert.match(document.body.textContent, /owner reload failed/);
  await click(button("다시 시도"));
  const ownerRetry = await h.waitForRequest("list_textbook_publisher_page_v1", 3);
  await h.resolve(ownerRetry, ownerPage(ownerRetry, rowsFor(1, publisherRow), 120, { baseRevision: revision("d") }));
  const recoveredPublisherInput = document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(1)}"] input[data-focus-mode="mobile"]`);
  assert.equal(recoveredPublisherInput.disabled, false);
  await changeInput(recoveredPublisherInput, "복구 후 새 출판사 초안");
  const publisherProjection = await h.waitForRequest("list_textbook_publisher_page_v1", 4);
  assert.notEqual(publisherProjection.args.p_draft, null);

  await click(tab("총판"));
  const supplierReload = await h.waitForRequest("list_textbook_supplier_page_v1");
  assert.equal(supplierReload.args.p_draft, null);
  assert.equal(button("총판 추가").disabled, true, "supplier recovery is independent from the publisher page");
  await h.resolve(supplierReload, ownerPage(supplierReload, rowsFor(1, supplierRow), 150, { baseRevision: revision("d") }));
  assert.equal(button("총판 추가").disabled, false);
});

test("role change synchronously drops drafts and ignores a late acknowledgement from the old actor", async (t) => {
  const h = await setupTextbookSettings(t);
  const page = await h.waitForRequest("list_textbook_publisher_page_v1");
  await h.resolve(page, ownerPage(page, rowsFor(1, publisherRow), 120));
  const input = document.querySelector(`[data-testid="textbook-publisher-mobile-card-${id(1)}"] input[data-focus-mode="mobile"]`);
  await changeInput(input, "이전 역할 초안");
  await h.waitForRequest("list_textbook_publisher_page_v1", 2);
  await click(button("변경 저장"));
  const save = await h.waitForRequest("save_textbook_settings_draft_v1");
  await h.setAuth({ role: "teacher" });
  const newActorPage = await h.waitForRequest("list_textbook_publisher_page_v1", 3);
  assert.equal(newActorPage.args.p_draft, null);
  await h.resolve(save, {
    requestId: save.args.p_request_id,
    owners: {
      baseRevision: revision("a"), newRevision: revision("c"),
      changedPublisherIds: [id(1)], deletedPublisherIds: [], changedSupplierIds: [],
      deletedSupplierIds: [], changedLinkPublisherIds: [],
    },
    subSubjects: null,
  });
  assert.doesNotMatch(document.body.textContent, /변경사항을 저장했습니다/);
  await h.resolve(newActorPage, ownerPage(newActorPage, rowsFor(1, publisherRow), 120));
  assert.equal(button("변경 저장").disabled, true);
});
