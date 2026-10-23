import test from "node:test";
import assert from "node:assert/strict";
import { setup, id } from "./helpers/textbook-numbered-harness.mjs";

function assertRequestReadsOnly(h, common = false) {
  const reads = h.requests.filter(request => request.name && !request.name.includes("preference"));
  const pages = reads.filter(request => request.name === (common ? "read_operational_common_v1" : "list_textbook_purchase_page_v1"));
  assert.ok(pages.length > 0, "request reader starts");
  for (const request of pages) { if(common) assert.equal(request.args.p_operation, "book_page"); else assert.equal(request.args.p_filters.mode, "request"); }
  assert.deepEqual(reads.filter(request => /inventory|sale|purchase_order|master_page|operations_summary/.test(request.name)).map(request => request.name), []);
  assert.equal(document.querySelector('[role="tab"][aria-label="교재 재고"]'), null);
  assert.equal(document.querySelector('[role="tab"][aria-label="주문·입고"]'), null);
}

test("request-only mode rejects management URLs before the first reader and on history navigation", async t => {
  const h = await setup(t, { mode: "requests", search: `?textbookTab=inventory&textbookDetailKind=master&textbookDetail=${id(1)}` });
  assertRequestReadsOnly(h);
  await h.popstate(`?textbookTab=sales&textbookDetailKind=sale&textbookDetail=${id(2)}`);
  assertRequestReadsOnly(h);
  assert.equal(h.requests.some(request => request.name === "get_textbook_sale_detail_v1"), false);
});

test("teacher request-only view has no create action and never starts management reads", async t => {
  const h = await setup(t, { mode: "requests", auth: { role: "teacher", isTeacher: true, isAdmin: false, isStaff: false, canManageAll: false } });
  assertRequestReadsOnly(h, true);
  assert.equal([...document.querySelectorAll("button")].some(button => /요청 추가|요청 등록/.test(button.textContent)), false);
});

test('teacher deep-linked request detail remains a read-only detail and starts no edit references', async t => {
  const { purchaseRow } = await import('./helpers/textbook-numbered-harness.mjs');
  const row = purchaseRow('request');
  const h = await setup(t, { mode: 'requests', search: `?textbookDetailKind=purchase&textbookDetail=${row.anchorLineId}`, auth: { role: 'teacher', isTeacher: true, isAdmin: false, isStaff: false, canManageAll: false } });
  const detail = h.requests.find(r => r.name === 'read_operational_common_v1' && r.args.p_operation === 'book_detail');
  assert.ok(detail);
  await h.resolve(detail, { id: 'a'.repeat(32), anchorLineId: row.anchorLineId, bookTitle: '교재 101', className: '공통 수업', requesterLabel: '담당자', requestedAt: '2026-10-23', studentQuantity: 2, teacherQuantity: 3 });
  assert.equal(document.querySelector('form'), null, 'a request detail is not an editing form');
  assert.match(document.body.textContent, /교재 101/);
  assert.equal(h.requests.some(r => /book_reference|class_reference|teacher_reference/.test(r.name || '')), false);
});
