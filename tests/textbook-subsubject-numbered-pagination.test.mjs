import assert from "node:assert/strict";
import test from "node:test";

import {
  button,
  click,
  id,
  ownerPage,
  publisherRow,
  setupTextbookSettings,
  subSubjectPage,
  subSubjectRow,
  tab,
} from "./helpers/textbook-settings-harness.mjs";

const publisherRows = Array.from({ length: 10 }, (_, index) => publisherRow(index + 1));
const taxonomyRows = (page, size = 10) => Array.from({ length: size }, (_, index) => subSubjectRow((page - 1) * 10 + index + 1));

test("actual taxonomy consumer stays lazy, shows whole visible count, and moves page10 to the 11-20 block", async (t) => {
  const h = await setupTextbookSettings(t);
  const publisherRequest = await h.waitForRequest("list_textbook_publisher_page_v1");
  assert.equal(h.requests.some((request) => request.name === "list_textbook_sub_subject_numbered_page_v1"), false);
  await h.resolve(publisherRequest, ownerPage(publisherRequest, publisherRows, 120));
  await click(tab("세부과목"));
  const first = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1");
  assert.deepEqual(first.args, { p_filters: { subject: "english", search: "" }, p_draft: null, p_page: 1, p_page_size: 10 });
  await h.resolve(first, subSubjectPage(first, taxonomyRows(1), 205));
  assert.match(tab("세부과목").textContent, /250/);
  assert.equal(document.querySelectorAll('[data-testid^="textbook-subsubject-mobile-card-"]').length, 10);
  assert.equal(document.querySelectorAll('[data-testid^="textbook-subsubject-desktop-row-"]').length, 10);

  const pager = document.querySelector('[aria-label="세부과목 목록 페이지 탐색"]');
  assert.deepEqual([...pager.querySelectorAll('[data-slot="pagination-number-group"] button')].map((node) => Number(node.textContent)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  await click(button("10 페이지", pager));
  const tenth = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1", 2);
  await h.resolve(tenth, subSubjectPage(tenth, taxonomyRows(10), 205));
  await click(button("다음 페이지", pager));
  const eleventh = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1", 3);
  await h.resolve(eleventh, subSubjectPage(eleventh, taxonomyRows(11), 205));
  assert.match(document.body.textContent, /세부과목 101/);
  assert.deepEqual([...pager.querySelectorAll('[data-slot="pagination-number-group"] button')].map((node) => Number(node.textContent)), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);

  const firstPageElevenCard = document.querySelector(`[data-testid="textbook-subsubject-mobile-card-${id(1101)}"]`);
  assert.equal(button("세부과목 101 위로 이동", firstPageElevenCard).disabled, false, "global server move availability must not use page-local index zero");
});

test("taxonomy Add clears search and targets the true final subject page from subjectCounts", async (t) => {
  const h = await setupTextbookSettings(t);
  const owner = await h.waitForRequest("list_textbook_publisher_page_v1");
  await h.resolve(owner, ownerPage(owner, publisherRows, 120));
  await click(tab("세부과목"));
  const first = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1");
  await h.resolve(first, subSubjectPage(first, taxonomyRows(1), 205));
  await click(button("세부과목 추가"));
  const added = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1", 2);
  assert.equal(added.args.p_page, 21);
  assert.equal(added.args.p_filters.search, "");
  assert.equal(added.args.p_draft.baseRevision, "b".repeat(64));
  const operation = added.args.p_draft.operations.at(-1);
  assert.deepEqual({ ...operation, id: "<uuid>" }, { type: "add", id: "<uuid>", subject: "english", name: "", isVisible: true });
  assert.ok(document.querySelector(`[data-testid="textbook-subsubject-mobile-card-${operation.id}"]`), "taxonomy draft row must not wait for the projection response");
  assert.equal(document.activeElement?.getAttribute("data-focus-id"), operation.id);
  const lastRows = [
    ...Array.from({ length: 5 }, (_, index) => subSubjectRow(201 + index, { canMoveDown: true })),
    {
      id: operation.id,
      subject: "english",
      name: "",
      sortOrder: 2060,
      isVisible: true,
      kind: "added",
      canMoveUp: true,
      canMoveDown: false,
    },
  ];
  await h.resolve(added, subSubjectPage(added, lastRows, 206, {
    subjectCounts: { english: 206, math: 20, science: 20, other: 20 },
    visibleCount: 251,
  }));
  assert.equal(document.activeElement?.getAttribute("data-focus-id"), operation.id);
});

test("consecutive taxonomy Add uses optimistic journal counts across a page boundary", async (t) => {
  const h = await setupTextbookSettings(t);
  const owner = await h.waitForRequest("list_textbook_publisher_page_v1");
  await h.resolve(owner, ownerPage(owner, publisherRows, 120));
  await click(tab("세부과목"));
  const first = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1");
  const initialRows = taxonomyRows(1, 9);
  initialRows.at(-1).canMoveDown = false;
  await h.resolve(first, subSubjectPage(first, initialRows, 9, {
    subjectCounts: { english: 9, math: 20, science: 20, other: 20 },
    visibleCount: 69,
  }));

  await click(button("세부과목 추가"));
  const firstProjection = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1", 2);
  assert.equal(firstProjection.args.p_page, 1);
  const firstAdd = firstProjection.args.p_draft.operations.at(-1);
  assert.ok(document.querySelector(`[data-testid="textbook-subsubject-mobile-card-${firstAdd.id}"]`));

  await click(button("세부과목 추가"));
  const secondProjection = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1", 3);
  assert.equal(secondProjection.args.p_page, 2);
  assert.equal(secondProjection.args.p_draft.operations.filter((operation) => operation.type === "add").length, 2);
  const secondAdd = secondProjection.args.p_draft.operations.at(-1);
  const pager = document.querySelector('[aria-label="세부과목 목록 페이지 탐색"]');
  assert.equal(pager.querySelector('[aria-current="page"]')?.textContent.trim(), "2");
  assert.equal(document.querySelector(`[data-testid="textbook-subsubject-mobile-card-${id(1001)}"]`), null);
  assert.ok(document.querySelector(`[data-testid="textbook-subsubject-mobile-card-${secondAdd.id}"]`));
  assert.equal(document.querySelectorAll('[data-testid^="textbook-subsubject-mobile-card-"]').length, 1);
  assert.equal(document.querySelectorAll('[data-testid^="textbook-subsubject-desktop-row-"]').length, 1);
  assert.equal(document.activeElement?.getAttribute("data-focus-id"), secondAdd.id);

  await h.resolve(secondProjection, subSubjectPage(secondProjection, [{
    ...subSubjectRow(11),
    id: secondAdd.id,
    name: "",
    sortOrder: 110,
    kind: "added",
    canMoveDown: false,
  }], 11, {
    subjectCounts: { english: 11, math: 20, science: 20, other: 20 },
    visibleCount: 71,
  }));
});

test("taxonomy read failure retains the prior prepared page and retries the same target", async (t) => {
  const h = await setupTextbookSettings(t);
  const owner = await h.waitForRequest("list_textbook_publisher_page_v1");
  await h.resolve(owner, ownerPage(owner, publisherRows, 120));
  await click(tab("세부과목"));
  const first = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1");
  await h.resolve(first, subSubjectPage(first, taxonomyRows(1), 205));
  const pager = document.querySelector('[aria-label="세부과목 목록 페이지 탐색"]');
  await click(button("2 페이지", pager));
  const second = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1", 2);
  await h.reject(second, new Error("TAXONOMY PAGE FAILED"));
  assert.match(document.body.textContent, /세부과목 1/);
  assert.match(document.body.textContent, /TAXONOMY PAGE FAILED/);
  await click(button("다시 시도"));
  const retry = await h.waitForRequest("list_textbook_sub_subject_numbered_page_v1", 3);
  assert.equal(retry.args.p_page, 2);
  await h.resolve(retry, subSubjectPage(retry, taxonomyRows(2), 205));
  assert.match(document.body.textContent, /세부과목 11/);
});
