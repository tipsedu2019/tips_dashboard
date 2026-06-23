import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPurchaseLifecycleDraft,
  buildSaleLineStatusTransition,
  buildTeacherTextbookIssueDraft,
  buildTextbookInventorySnapshot,
  buildTextbookMonthlyClosing,
  buildTextbookSaleDraft,
  filterStockMovesForClosing,
  getTextbookByReference,
  getTextbookCopyScope,
  getTextbookPurchaseUnitCost,
  normalizeBarcodeValue,
  groupPurchaseLinesByStatus,
  groupSaleLinesByStatus,
  getTextbookActionErrorMessage,
  validatePurchaseLifecycleDraft,
  validateMonthlyClosingDraft,
  normalizeOptionalUuid,
} from "../src/features/textbooks/textbook-ledger.js";

test("textbook inventory snapshot is calculated from stock moves per location", () => {
  const snapshot = buildTextbookInventorySnapshot({
    textbooks: [
      { id: "book-1", title: "Junior Reading", sale_price: 11000 },
      { id: "book-2", title: "Algebra Basic", price: 9000 },
    ],
    locations: [
      { id: "main", name: "본관" },
      { id: "annex", name: "별관" },
    ],
    stockMoves: [
      { textbook_id: "book-1", location_id: "main", quantity: 8, amount: 88000, move_type: "purchase_receipt" },
      { textbook_id: "book-1", location_id: "annex", quantity: 4, amount: 44000, move_type: "purchase_receipt" },
      { textbook_id: "book-1", location_id: "main", quantity: -3, amount: -33000, move_type: "sale_issue" },
      { textbook_id: "book-2", location_id: "annex", quantity: 2, amount: 18000, move_type: "stock_adjustment" },
    ],
  });

  const reading = snapshot.find((row) => row.id === "book-1");
  const algebra = snapshot.find((row) => row.id === "book-2");

  assert.equal(reading.totalQuantity, 9);
  assert.equal(reading.locationQuantities.main, 5);
  assert.equal(reading.locationQuantities.annex, 4);
  assert.equal(reading.stockValue, 99000);
  assert.equal(algebra.totalQuantity, 2);
});

test("sale draft creates one linked sale line per selected enrolled student", () => {
  const draft = buildTextbookSaleDraft({
    classRecord: {
      id: "class-1",
      name: "초6반",
      student_ids: ["student-1", "student-2", "student-3"],
    },
    students: [
      { id: "student-1", name: "고유주" },
      { id: "student-2", name: "문혁진" },
      { id: "student-3", name: "이지율" },
    ],
    textbook: { id: "book-1", sale_price: 11000 },
    chargeMonth: "2026-05",
    excludedStudentIds: ["student-2"],
    locationId: "main",
  });

  assert.equal(draft.sale.class_id, "class-1");
  assert.equal(draft.sale.charge_month, "2026-05");
  assert.deepEqual(
    draft.lines.map((line) => [line.student_id, line.class_id, line.textbook_id, line.quantity, line.unit_price]),
    [
      ["student-1", "class-1", "book-1", 1, 11000],
      ["student-3", "class-1", "book-1", 1, 11000],
    ],
  );
  assert.equal(draft.lines.some((line) => Object.hasOwn(line, "student_name")), false);
  assert.equal(draft.totalAmount, 22000);
});

test("monthly closing compares opening stock, movements, and cash settlement", () => {
  const closing = buildTextbookMonthlyClosing({
    openingQuantity: 10,
    openingAmount: 100000,
    stockMoves: [
      { move_type: "purchase_receipt", quantity: 5, amount: 50000 },
      { move_type: "sale_issue", quantity: -4, amount: -44000 },
      { move_type: "stock_adjustment", quantity: -1, amount: -10000 },
    ],
    receivedAmount: 44000,
    supplierPaymentAmount: 50000,
  });

  assert.equal(closing.purchaseQuantity, 5);
  assert.equal(closing.saleQuantity, 4);
  assert.equal(closing.adjustmentQuantity, -1);
  assert.equal(closing.endingQuantity, 10);
  assert.equal(closing.endingAmount, 96000);
  assert.equal(closing.paymentDifference, -6000);
  assert.equal(closing.textbookMarginAmount, 4400);
  assert.deepEqual(
    closing.teamMargins.map((row) => [row.team, row.saleQuantity, row.saleAmount, row.purchaseCostAmount, row.marginAmount]),
    [
      ["english", 0, 0, 0, 0],
      ["math", 0, 0, 0, 0],
      ["other", 4, 44000, 39600, 4400],
    ],
  );
  assert.equal(closing.settlementDifference, -1600);
  assert.equal(closing.needsReview, true);
});

test("monthly closing filters stock moves by textbook subject", () => {
  const moves = filterStockMovesForClosing({
    closingMonth: "2026-05",
    subject: "math",
    textbooks: [
      { id: "book-math", subject: "math" },
      { id: "book-english", subject: "english" },
    ],
    stockMoves: [
      { textbook_id: "book-math", moved_at: "2026-05-02T09:00:00Z", quantity: 5 },
      { textbook_id: "book-english", moved_at: "2026-05-03T09:00:00Z", quantity: 7 },
      { textbook_id: "book-math", moved_at: "2026-06-01T09:00:00Z", quantity: 11 },
    ],
  });

  assert.deepEqual(moves.map((move) => move.textbook_id), ["book-math"]);
});

test("monthly closing requires a memo when a difference needs review", () => {
  const closing = buildTextbookMonthlyClosing({
    stockMoves: [],
    receivedAmount: 10000,
    supplierPaymentAmount: 0,
  });

  assert.throws(
    () => validateMonthlyClosingDraft(closing, { memo: "" }),
    /review memo/i,
  );
  assert.doesNotThrow(() => validateMonthlyClosingDraft(closing, { memo: "cash pending" }));
});

test("sale draft reports stock shortage before issued sales are saved", () => {
  const draft = buildTextbookSaleDraft({
    classRecord: { id: "class-1", student_ids: ["s1", "s2", "s3"] },
    students: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
    textbook: { id: "book-1", sale_price: 12000 },
    chargeMonth: "2026-05",
    availableQuantity: 2,
  });

  assert.equal(draft.totalQuantity, 3);
  assert.equal(draft.availableQuantity, 2);
  assert.equal(draft.stockShortage, 1);
  assert.equal(draft.hasStockShortage, true);
});

test("barcode values normalize to digits for ISBN and scanner matching", () => {
  assert.equal(normalizeBarcodeValue("ISBN 978-89-01-23456-7"), "9788901234567");
  assert.equal(normalizeBarcodeValue(" 880 1234 567890 "), "8801234567890");
});

test("textbook reference lookup tolerates compact math textbook titles", () => {
  const textbooks = [
    { id: "concept-type", title: "개념 + 유형 기초탄탄 라이트 중학수학 3-1 (2027년)" },
    { id: "concept-type-live", title: "개념+유형 기초탄탄 라이트 중학 수학 3-1 (2027년)" },
    { id: "rpm", title: "개념원리 RPM 중학수학 3-1 (2027년)" },
  ];

  assert.equal(
    getTextbookByReference(textbooks, "개념+유형 기초탄탄라이트 중학수학 3-1(2027년)")?.id,
    "concept-type",
  );
  assert.equal(
    getTextbookByReference(textbooks, "개념원리RPM 중학수학3-1(2027년)")?.id,
    "rpm",
  );
  assert.equal(
    getTextbookByReference(textbooks, "개념+유형 기초탄탄 라이트 중학 수학 3-1 (2027년)")?.id,
    "concept-type-live",
  );
});

test("teacher copy purchase unit cost is always zero", () => {
  assert.equal(getTextbookPurchaseUnitCost({
    title: "개념+유형 기초탄탄 라이트 중학 수학 3-1 (2027년)",
    publisher: "비상교육",
    sale_price: 19500,
    copy_scope: "teacher",
  }), 0);
  assert.equal(getTextbookPurchaseUnitCost({
    title: "개념+유형 기초탄탄 라이트 중학 수학 3-1 (2027년)",
    publisher: "비상교육",
    sale_price: 19500,
    copy_scope: "student",
  }), 17550);
});

test("purchase lifecycle separates teacher request, supplier order, and receipt", () => {
  const requested = buildPurchaseLifecycleDraft({
    stage: "request",
    requestedQuantity: 12,
  });
  const ordered = buildPurchaseLifecycleDraft({
    stage: "order",
    requestedQuantity: 12,
    orderedQuantity: 10,
  });
  const received = buildPurchaseLifecycleDraft({
    stage: "receive",
    requestedQuantity: 12,
    orderedQuantity: 10,
    receivedQuantity: 8,
    statementNumber: "A-102",
  });

  assert.equal(requested.status, "requested");
  assert.equal(requested.orderedQuantity, 0);
  assert.equal(requested.createsStockMove, false);
  assert.equal(ordered.status, "ordered");
  assert.equal(received.status, "partially_received");
  assert.equal(received.createsStockMove, true);
  assert.throws(
    () => validatePurchaseLifecycleDraft(buildPurchaseLifecycleDraft({
      stage: "receive",
      requestedQuantity: 1,
      orderedQuantity: 1,
      receivedQuantity: 1,
    })),
    /statement/i,
  );
});

test("teacher copy lifecycle keeps request, receipt, issue, and stock scoped", () => {
  const teacherPurchase = buildPurchaseLifecycleDraft({
    stage: "receive",
    copyScope: "교사용",
    requestedQuantity: 2,
    orderedQuantity: 2,
    receivedQuantity: 2,
    statementNumber: "T-2027",
  });
  const teacherIssue = buildTeacherTextbookIssueDraft({
    textbook: { id: "book-1", sale_price: 13000 },
    teacherName: "김선생",
    quantity: 1,
    locationId: "main",
    chargeMonth: "2026-06",
    availableQuantity: 2,
  });
  const snapshot = buildTextbookInventorySnapshot({
    textbooks: [{ id: "book-1", title: "개념원리RPM 중학수학3-1(2027년)" }],
    locations: [{ id: "main", name: "본관" }],
    stockMoves: [
      { textbook_id: "book-1", location_id: "main", copy_scope: "student", quantity: 5, amount: 65000 },
      { textbook_id: "book-1", location_id: "main", copy_scope: "teacher", quantity: 2, amount: 26000 },
    ],
  });
  const issued = buildSaleLineStatusTransition({
    line: teacherIssue.lines[0],
    targetStatus: "issued",
  });

  assert.equal(teacherPurchase.copyScope, "teacher");
  assert.equal(teacherIssue.lines[0].copy_scope, "teacher");
  assert.equal(teacherIssue.lines[0].teacher_name, "김선생");
  assert.equal(teacherIssue.lines[0].unit_price, 0);
  assert.equal(teacherIssue.totalAmount, 0);
  assert.equal(snapshot[0].totalQuantity, 7);
  assert.equal(snapshot[0].studentQuantity, 5);
  assert.equal(snapshot[0].teacherQuantity, 2);
  assert.equal(getTextbookCopyScope(issued.stockMove), "teacher");
  assert.equal(issued.stockMove.copy_scope, "teacher");
  assert.equal(issued.stockMove.quantity, -1);
});

test("sale line transition issues stock directly from the pending issue state", () => {
  const issued = buildSaleLineStatusTransition({
    line: { id: "line-1", status: "charged", quantity: 1, textbook_id: "book-1", location_id: "main", unit_price: 12000 },
    targetStatus: "issued",
    availableQuantity: 2,
  });

  assert.equal(issued.shouldCreateStockMove, true);
  assert.equal(issued.stockMove.quantity, -1);
  const shortageIssued = buildSaleLineStatusTransition({
    line: { id: "line-1", status: "charged", quantity: 2, textbook_id: "book-1" },
    targetStatus: "issued",
    availableQuantity: 1,
  });
  assert.equal(shortageIssued.shouldCreateStockMove, true);
  assert.equal(shortageIssued.stockMove.quantity, -2);
});

test("kanban grouping keeps each purchase line in its current lifecycle status", () => {
  const grouped = groupPurchaseLinesByStatus({
    orders: [
      { id: "po-request", status: "requested" },
      { id: "po-order", status: "ordered" },
      { id: "po-partial", status: "partially_received" },
      { id: "po-received", status: "received" },
    ],
    lines: [
      { id: "line-1", purchase_order_id: "po-request" },
      { id: "line-2", purchase_order_id: "po-order" },
      { id: "line-3", purchase_order_id: "po-partial" },
      { id: "line-4", purchase_order_id: "po-received" },
    ],
  });

  assert.deepEqual(grouped.requested.map((card) => card.id), ["line-1"]);
  assert.deepEqual(grouped.ordered.map((card) => card.id), ["line-2"]);
  assert.deepEqual(grouped.partially_received.map((card) => card.id), ["line-3"]);
  assert.deepEqual(grouped.received.map((card) => card.id), ["line-4"]);
  assert.equal(grouped.requested[0].status, "requested");
});

test("kanban grouping keeps sale lines in issue-centered columns", () => {
  const grouped = groupSaleLinesByStatus({
    lines: [
      { id: "sale-line-1", status: "charged" },
      { id: "sale-line-2", status: "paid" },
      { id: "sale-line-3", status: "issued" },
      { id: "sale-line-4", status: "" },
    ],
  });

  assert.deepEqual(grouped.charged.map((card) => card.id), ["sale-line-1", "sale-line-2", "sale-line-4"]);
  assert.deepEqual(grouped.issued.map((card) => card.id), ["sale-line-3"]);
});

test("optional uuid fields ignore fallback location codes before Supabase writes", () => {
  assert.equal(normalizeOptionalUuid("main"), null);
  assert.equal(normalizeOptionalUuid("annex"), null);
  assert.equal(normalizeOptionalUuid(""), null);
  assert.equal(
    normalizeOptionalUuid("1dece1c6-b2a2-4202-a01d-677a939f2d5b"),
    "1dece1c6-b2a2-4202-a01d-677a939f2d5b",
  );
});

test("textbook action errors expose Supabase messages instead of a generic failure", () => {
  assert.equal(
    getTextbookActionErrorMessage({ message: "invalid input syntax for type uuid: \"main\"" }),
    "invalid input syntax for type uuid: \"main\"",
  );
  assert.equal(
    getTextbookActionErrorMessage({
      code: "PGRST205",
      message: "Could not find the table 'public.textbook_purchase_orders' in the schema cache",
    }),
    "교재 관리 DB 마이그레이션이 아직 적용되지 않았습니다. Supabase SQL 마이그레이션을 적용한 뒤 새로고침하세요.",
  );
  assert.equal(
    getTextbookActionErrorMessage({
      code: "PGRST204",
      message: "Could not find the 'student_name' column of 'textbook_sale_lines' in the schema cache",
    }),
    "교재 관리 DB 스키마가 최신이 아닙니다. 누락 컬럼: textbook_sale_lines.student_name. Supabase SQL 마이그레이션을 적용한 뒤 새로고침하세요.",
  );
});
