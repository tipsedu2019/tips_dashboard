import assert from "node:assert/strict";
import test from "node:test";

import {
  button, changeInput, click, ownerPage, publisherRow, setupTextbookSettings,
  subSubjectPage, subSubjectRow, tab,
} from "./helpers/textbook-settings-harness.mjs";

const RPC = "list_textbook_sub_subject_numbered_page_v1";
const english = subSubjectRow(1, { name: "영어 가상 범주", canMoveDown: false });
const math = subSubjectRow(2, { subject: "math", name: "수학 가상 범주", canMoveUp: false, canMoveDown: false });
const page = (request, rows) => subSubjectPage(request, rows, rows.length, {
  subjectCounts: { english: 1, math: 1, science: 0, other: 0 }, visibleCount: 2,
});
const rowInput = (row, mode = "desktop") => document.querySelector(
  `input[data-focus-id="${row.id}"][data-focus-mode="${mode}"]`,
);

async function initial(t) {
  const h = await setupTextbookSettings(t);
  const publishers = await h.waitForRequest("list_textbook_publisher_page_v1");
  await h.resolve(publishers, ownerPage(publishers, [publisherRow(1)], 1));
  await click(tab("세부과목"));
  const first = await h.waitForRequest(RPC);
  await h.resolve(first, page(first, [english]));
  return h;
}

test("switching subject cannot expose the previous subject as editable rows while pending or failed", async t => {
  const h = await initial(t);
  assert.equal(rowInput(english).disabled, false);
  await click(button("수학"));
  const next = await h.waitForRequest(RPC, 2);
  assert.equal(next.args.p_filters.subject, "math");
  assert.equal(button("수학").getAttribute("aria-pressed"), "true");
  assert.equal(Boolean(rowInput(english)), false, "English rows must not appear under selected Math while loading");
  assert.equal(Boolean(rowInput(english, "mobile")), false);
  await h.reject(next, new Error("SYNTHETIC subject read failed"));
  assert.equal(Boolean(rowInput(english)), false, "A failed Math read must not expose editable English rows");
  assert.equal(button("변경 저장").disabled, true);
  await click(button("다시 시도"));
  const retry = await h.waitForRequest(RPC, 3);
  assert.equal(retry.args.p_filters.subject, "math");
  await h.resolve(retry, page(retry, [math]));
  assert.equal(rowInput(math).disabled, false);
  assert.equal(Boolean(rowInput(english)), false);
  await changeInput(rowInput(math), "수학 수정 가상");
  const projection = await h.waitForRequest(RPC, 4);
  assert.deepEqual(projection.args.p_draft.operations.at(-1), {
    type: "patch", id: math.id, patch: { name: "수학 수정 가상" },
  });
  assert.equal(h.requests.some(request => request.name === "save_textbook_settings_draft_v1"), false);
});

test("a late previous-subject projection cannot replace the new subject and its unsaved draft survives the round trip", async t => {
  const h = await initial(t);
  await changeInput(rowInput(english), "영어 보존 초안");
  const oldProjection = await h.waitForRequest(RPC, 2);
  await click(button("수학"));
  const next = await h.waitForRequest(RPC, 3);
  assert.equal(oldProjection.signal.aborted, true);
  assert.deepEqual(next.args.p_draft.operations.at(-1), {
    type: "patch", id: english.id, patch: { name: "영어 보존 초안" },
  });
  await h.resolve(next, page(next, [math]));
  await h.resolve(oldProjection, page(oldProjection, [english]));
  assert.equal(rowInput(math).value, math.name);
  assert.equal(Boolean(rowInput(english)), false);
  await click(button("영어"));
  const back = await h.waitForRequest(RPC, 4);
  assert.equal(Boolean(rowInput(math)), false);
  await h.resolve(back, page(back, [english]));
  assert.equal(rowInput(english).value, "영어 보존 초안");
  assert.equal(rowInput(english, "mobile").value, "영어 보존 초안");
  assert.equal(button("변경 저장").disabled, false);
});

test("subject failure leaves counts unknown while a successful empty subject is a confirmed zero", async t => {
  const h = await initial(t);
  await click(button("과학"));
  const science = await h.waitForRequest(RPC, 2);
  const pager = () => document.querySelector('[aria-label="세부과목 목록 페이지 탐색"]');
  assert.equal(Boolean(rowInput(english)), false);
  await h.reject(science, new Error("SYNTHETIC read unavailable"));
  assert.ok(button("다시 시도"));
  assert.equal(Boolean(rowInput(english)), false);
  assert.equal(Boolean(pager()?.querySelector('[aria-current="page"]')), false);
  assert.match(document.body.textContent, /건수 확인 중/);
  await click(button("다시 시도"));
  const retry = await h.waitForRequest(RPC, 3);
  assert.equal(retry.args.p_filters.subject, "science");
  await h.resolve(retry, page(retry, []));
  assert.equal(Boolean(button("다시 시도")), false);
  assert.match(document.body.textContent, /표시할 세부과목이 없습니다/);
  assert.match(document.body.textContent, /0건 · 0–0번째/);
});
