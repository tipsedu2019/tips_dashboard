import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import {
  buildTextbookInventorySnapshot,
  buildTextbookMonthlyClosing,
  filterStockMovesForClosing,
  validateMonthlyClosingDraft,
  groupPurchaseLinesByStatus,
  groupSaleLinesByStatus,
  getTextbookByReference,
  getTextbookPurchaseUnitCost,
} from "../src/features/textbooks/textbook-ledger.js";

const modelUrl = new URL("../src/features/textbooks/textbook-read-model.ts", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === modelUrl.href && specifier === "./textbook-taxonomy") {
      return nextResolve(new URL("./textbook-taxonomy.ts", modelUrl).href, context);
    }
    return nextResolve(specifier, context);
  },
});
async function model() {
  assert.ok(existsSync(modelUrl), "pure production projections must be importable independently of the workspace");
  return import(modelUrl.href);
}

const book = (id, extra = {}) => ({
  id, title: `교재 ${id}`, subject: "english", status: "active", publisher: "출판사",
  category: "독해", isbn13: `978-${id}`, sale_price: 10000, ...extra,
});
const order = (id, extra = {}) => ({
  id, status: "requested", requested_by: "선생님", supplier_id: "supplier",
  order_date: "2026-08-01", statement_number: "", ...extra,
});
const line = (id, extra = {}) => ({
  id, purchase_order_id: "order", textbook_id: "book", class_id: "class",
  location_id: "main", status: "requested", copy_scope: "student",
  requested_quantity: 2, ordered_quantity: 0, received_quantity: 0,
  created_at: "2026-08-01T00:00:00.000001+00:00", ...extra,
});
const filters = (extra = {}) => ({
  search: "", subject: "all", schoolLevel: "all", gradeLevel: "all",
  subSubject: "all", quality: "all", inventory: "all", ...extra,
});

test("purchase cost business labels remove ECMAScript whitespace without compatibility normalization", () => {
  const whitespace = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  for (const field of ["publisher", "supplier"]) {
    assert.equal(getTextbookPurchaseUnitCost({ sale_price: 10000, [field]: "팁스\ufeff서점" }), 0, `${field} FEFF`);
    for (const space of whitespace) {
      assert.equal(getTextbookPurchaseUnitCost({ sale_price: 10000, [field]: `팁스${space}서점` }), 0, `${field} U+${space.codePointAt(0).toString(16)}`);
    }
    for (const label of ["팁스\u200b서점", "팁스\u0085서점", "팁스\u180e서점", "팁스서점"]) {
      assert.equal(getTextbookPurchaseUnitCost({ sale_price: 10000, [field]: label }), 9000, `${field} non-whitespace/no-NFKC fence`);
    }
  }
});

test("purchase display parents pair only the base case, preserve cross-order members and student primary", async () => {
  const { buildPurchaseDisplayRows } = await model();
  const teacher = line("a-teacher", { copy_scope: "teacher", purchase_order_id: "other-order", memo: "teacher memo" });
  const student = line("b-student", { memo: "student memo" });
  const duplicateStudent = line("c-student");
  const duplicateTeacher = line("d-teacher", { copy_scope: "teacher" });
  const rows = buildPurchaseDisplayRows(
    [duplicateTeacher, duplicateStudent, student, teacher],
    new Map([["order", order("order")], ["other-order", order("other-order")]]),
    [book("book")],
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.memberLineIds), [["a-teacher", "b-student"], ["c-student"], ["d-teacher"]]);
  assert.equal(rows[0].anchorLineId, "a-teacher");
  assert.equal(rows[0].line.id, "b-student");
  assert.equal(rows[0].line.memo, "student memo");
  assert.strictEqual(rows[0].lines[0], teacher);
  assert.strictEqual(rows[0].lines[1], student);
  assert.equal(rows[0].lines[0].purchase_order_id, "other-order");
  assert.deepEqual(rows[0].line.purchaseScopeLines, [teacher, student]);
  assert.equal(Object.hasOwn(teacher, "purchaseScopeLines"), false);
});

test("purchase source ordering preserves microseconds, timezone equivalence, equal-ID ties and nulls last", async () => {
  const { buildPurchaseDisplayRows } = await model();
  const input = [
    line("a-later", { created_at: "2026-08-01T00:00:00.123002Z" }),
    line("z-earlier", { created_at: "2026-08-01T09:00:00.123001+09:00", copy_scope: "teacher" }),
    line("b-equal", { created_at: "2026-08-01T00:00:01Z", class_id: "equal" }),
    line("a-equal", { created_at: "2026-08-01T00:00:01.000000+00:00", class_id: "equal", copy_scope: "teacher" }),
    line("b-null", { created_at: null, class_id: "null" }),
    line("a-null", { created_at: undefined, class_id: "null", copy_scope: "teacher" }),
  ];
  const originalIds = input.map((item) => item.id);
  const orders = new Map([["order", order("order")]]);
  for (const shuffled of [input, [...input].reverse(), [input[4], input[2], input[0], input[5], input[1], input[3]]]) {
    const rows = buildPurchaseDisplayRows(shuffled, orders, [book("book")]);
    assert.deepEqual(rows.map((row) => row.memberLineIds), [["z-earlier", "a-later"], ["a-equal", "b-equal"], ["a-null", "b-null"]]);
    assert.deepEqual(rows.map((row) => row.anchorLineId), ["z-earlier", "a-equal", "a-null"]);
  }
  assert.deepEqual(input.map((item) => item.id), originalIds);
});

test("101 purchase display parents retain a complete pair at the tenth-row boundary and every raw identity", async () => {
  const { buildPurchaseDisplayRows } = await model();
  const input = [];
  for (let index = 0; index < 101; index += 1) {
    const id = String(index).padStart(3, "0");
    input.push(line(`${id}-student`, { class_id: `class-${id}` }));
    input.push(line(`${id}-teacher`, { class_id: `class-${id}`, copy_scope: "teacher" }));
  }
  const rows = buildPurchaseDisplayRows([...input].reverse(), new Map([["order", order("order")]]), [book("book")]);
  assert.equal(rows.length, 101);
  assert.equal(rows.slice(0, 10).length, 10);
  assert.deepEqual(rows[9].memberLineIds, ["009-student", "009-teacher"]);
  assert.deepEqual(rows[10].memberLineIds, ["010-student", "010-teacher"]);
  assert.deepEqual(rows[100].memberLineIds, ["100-student", "100-teacher"]);
  assert.equal(new Set(rows.flatMap((row) => row.memberLineIds)).size, 202);
  assert.equal(rows.flatMap((row) => row.lines).length, 202);
});

test("purchase source timestamps reject malformed values, preserve infinity endpoints and leave inputs untouched", async () => {
  const { buildPurchaseDisplayRows } = await model();
  const orders = new Map([["order", order("order")]]);
  const input = [line("null", { created_at: "  " }), line("future", { created_at: "infinity" }), line("past", { created_at: "-infinity" }), line("now")];
  assert.deepEqual(buildPurchaseDisplayRows(input, orders, [book("book")]).map((row) => row.anchorLineId), ["past", "now", "future", "null"]);
  assert.deepEqual(input.map((row) => row.id), ["null", "future", "past", "now"]);
  for (const created_at of ["not-a-date", "2026-08-01", "2026-02-31T00:00:00Z", "2026-08-01T24:00:00Z", "0000-01-01T00:00:00Z", "2026-08-01T00:00:00.1234567Z", "0001-01-01T00:00:00Z BC"]) {
    assert.throws(() => buildPurchaseDisplayRows([line("bad", { created_at })], orders, [book("book")]), { name: "TypeError", message: "Unsupported purchase created_at timestamp" });
  }
});

test("raw purchase filtering precedes pairing and inactive versus missing references remain distinct", async () => {
  const { buildPurchaseDisplayRows, shouldShowOperationalPurchaseLine, shouldShowOperationalSaleLine, getTextbookReferenceState } = await model();
  const textbooks = [book("book"), book("inactive", { status: "inactive" })];
  const orders = new Map([["order", order("order")]]);
  const input = [line("student"), line("teacher", { copy_scope: "teacher" }), line("inactive", { textbook_id: "inactive" }), line("missing", { textbook_id: "not-found" }), line("free", { textbook_id: "", requested_textbook_title: "미등록 요청" })];
  const eligible = input.filter((item) => shouldShowOperationalPurchaseLine(item, order("order"), textbooks)).filter((item) => item.id !== "student");
  const rows = buildPurchaseDisplayRows(eligible, orders, textbooks);
  assert.deepEqual(rows.map((row) => row.memberLineIds), [["free"], ["missing"], ["teacher"]]);
  assert.equal(getTextbookReferenceState(textbooks, "inactive"), "inactive");
  assert.equal(getTextbookReferenceState(textbooks, "not-found"), "missing");
  assert.equal(getTextbookReferenceState(textbooks, ""), "none");
  assert.equal(shouldShowOperationalSaleLine({ textbook_id: "not-found" }, textbooks), false);
  assert.equal(shouldShowOperationalSaleLine({ textbook_id: "book" }, textbooks), true);
});

test("purchase lookup retains ID, exact alias, normalized then compact precedence and revised editions", async () => {
  const { getTextbookById, buildPurchaseDisplayRows } = await model();
  const textbooks = [
    book("collision", { title: "other" }),
    book("alias", { title: "collision" }),
    book("compact", { title: "AB" }),
    book("normal", { title: "A B" }),
    book("old", { title: "Reading (2022)", name: "Old Reader", barcode: "8801" }),
    book("revised", { title: "Reading (2026)", isbn13: "9781234567890" }),
  ];
  for (const [reference, id] of [["collision", "collision"], ["A B", "normal"], ["a b", "normal"], ["a-b", "compact"], ["Old Reader", "old"], ["8801", "old"], ["9781234567890", "revised"]]) {
    assert.equal(getTextbookById(textbooks, reference)?.id, id, reference);
  }
  const rows = buildPurchaseDisplayRows([
    line("old", { textbook_id: "", requested_textbook_title: "Reading (2022)" }),
    line("new", { textbook_id: "", requested_textbook_title: "Reading (2026)", copy_scope: "teacher" }),
  ], new Map([["order", order("order")]]), textbooks);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.memberLineIds), [["new"], ["old"]]);
});

test("sale history counts complete month/class/textbook parents across source sales, not raw lines", async () => {
  const { buildSaleHistorySummaryRows } = await model();
  const rows = buildSaleHistorySummaryRows({
    sales: [{ id: "sale-a", class_id: "class", charge_month: "2026-08", created_at: "2026-08-01" }, { id: "sale-b", class_id: "class", charge_month: "2026-08" }],
    lines: [
      { id: "wait", sale_id: "sale-a", textbook_id: "book", quantity: 2, status: "charged" },
      { id: "issued", sale_id: "sale-b", textbook_id: "book", quantity: 3, status: "issued", issued_at: "2026-08-02" },
      ...["cancelled", "returned", "excluded"].map((status) => ({ id: status, sale_id: "sale-b", textbook_id: "book", quantity: 99, status })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `extra-${i}`, textbook_id: `book-${i}`, class_id: "class", charge_month: "2026-07", quantity: 1 })),
    ],
    textbooks: [book("book", { status: "inactive" })], classes: [{ id: "class", name: "수업" }],
  });
  assert.equal(rows.length, 11);
  assert.deepEqual(rows[0], { id: "2026-08:class:book", year: "2026", month: "2026-08", classId: "class", className: "수업", textbookId: "book", textbookTitle: "교재 book", waitingQuantity: 2, issuedQuantity: 3, totalQuantity: 5, latestAt: "2026-08-02" });
  assert.equal(rows[1].textbookTitle, "book-0");
  assert.equal(rows[10].totalQuantity, 1);
});

test("empty raw sale status inherits sale only in history while process grouping trims line alone", async () => {
  const { buildSaleHistorySummaryRows } = await model();
  const lines = ['', ' ', ' issued ', ' paid '].map((status, index) => ({ id: `l${index}`, sale_id: 's', textbook_id: 'b', status, quantity: 2, updated_at: '2026-08-30T00:00:00Z' }));
  const groups = groupSaleLinesByStatus({ lines });
  assert.deepEqual(groups.charged.map((row) => row.id), ['l0', 'l1', 'l3']);
  assert.deepEqual(groups.issued.map((row) => row.id), ['l2']);
  const [history] = buildSaleHistorySummaryRows({ sales: [{ id: 's', charge_month: '2026-08', status: 'issued' }], lines, textbooks: [book('b')], classes: [], fallbackMonth: '2026-08' });
  assert.equal(history.issuedQuantity, 4);
  assert.equal(history.waitingQuantity, 4);
});

test("workflow SQL oracle keeps raw history, process grouping and purchase order-first status distinct", async () => {
  const {buildSaleHistorySummaryRows}=await model();
  assert.equal(groupPurchaseLinesByStatus({orders:[{id:'o',status:'ordered'}],lines:[{id:'l',purchase_order_id:'o',status:'requested'}]}).ordered[0].status,'ordered');
  const process=groupSaleLinesByStatus({lines:[{id:'paid',status:'paid'},{id:'excluded',status:'excluded'}]});
  assert.deepEqual(process.charged.map(row=>[row.id,row.status]),[['paid','charged'],['excluded','excluded']]);
  const rows=buildSaleHistorySummaryRows({
    sales:[{id:'sale',charge_month:'2026-09',class_id:'class',created_at:'2026-09-01T00:00:00+00:00'}],
    lines:[
      {id:'paid',sale_id:'sale',textbook_id:'book',status:'paid',quantity:0,copy_scope:'teacher'},
      {id:'early',sale_id:'sale',textbook_id:'book',status:'issued',quantity:-2,copy_scope:'teacher',issued_at:'2026-09-01T23:00:00+09:00'},
      {id:'later',sale_id:'sale',textbook_id:'book',status:'issued',quantity:3,issued_at:'2026-09-01T15:00:00+00:00'},
      {id:'excluded',sale_id:'sale',textbook_id:'book',status:'excluded',quantity:100},
    ],textbooks:[book('book')],classes:[{id:'class',name:'중2반'}],fallbackMonth:'2020-01',
  });
  assert.deepEqual(rows,[{id:'2026-09:class:book',year:'2026',month:'2026-09',classId:'class',className:'중2반',textbookId:'book',textbookTitle:'교재 book',waitingQuantity:1,issuedQuantity:4,totalQuantity:5,latestAt:'2026-09-01T23:00:00+09:00'}]);
});
test("canonical catalog identity ties do not promote active matches over inactive exact aliases",()=>{
 const books=[book('a',{title:'Ｐａｒｉｔｙ Reader',status:'inactive'}),book('b',{title:'Parity Reader',status:'active'}),book('c',{title:'ParityReader'}),book('d',{title:'Parity Reader 2026'})];
 assert.equal(getTextbookByReference(books,'Parity Reader').id,'a');
 assert.equal(getTextbookByReference(books,'c').id,'c');
 assert.equal(getTextbookByReference(books,'Parity Reader 2026').id,'d');
 assert.equal(getTextbookByReference(books,'--'),undefined);
});

test("global duplicate title quality survives search/page boundaries but ignores inactive duplicates", async () => {
  const { buildTextbookMasterRows, buildDuplicateTextbookTitleKeys, matchesTextbookMasterFilters } = await model();
  const textbooks = Array.from({ length: 101 }, (_, index) => book(`book-${index}`, { title: `교재 ${index}` }));
  textbooks[100] = book("book-100", { title: "교재 0" });
  textbooks.push(book("inactive", { title: "교재 1", status: "inactive" }));
  const inventory = buildTextbookInventorySnapshot({ textbooks });
  const rows = buildTextbookMasterRows(inventory);
  const duplicateKeys = buildDuplicateTextbookTitleKeys(inventory);
  assert.equal(rows.find((row) => row.id === "book-0").qualityIssues.duplicate, true);
  assert.equal(rows.find((row) => row.id === "book-0").qualityScore, 8);
  assert.equal(rows.find((row) => row.id === "book-1").qualityIssues.duplicate, false);
  assert.equal(rows.filter((row) => matchesTextbookMasterFilters(row, filters({ quality: "duplicate", search: "교재 0" }), duplicateKeys)).length, 2);
  assert.equal(rows.filter((row) => matchesTextbookMasterFilters(row, filters({ quality: "inactive" }), duplicateKeys)).length, 1);
  assert.equal(rows.filter((row) => matchesTextbookMasterFilters(row, filters({ subject: "math" }), duplicateKeys)).length, 0);
  assert.equal(rows.find((row) => row.id === "book-0").totalQuantity, 0);
  assert.deepEqual(rows.find((row) => row.id === "book-0").teacherLocationQuantities, {});
});

test("master quality scoring and inventory filters preserve zero, negative and low/surplus boundaries", async () => {
  const { getTextbookQualityIssues, getTextbookQualityScore, matchesInventoryFilter } = await model();
  const malformed = { id: "bad", title: "수학", subject: "english", status: "inactive" };
  assert.deepEqual(getTextbookQualityIssues(malformed, new Set(["수학"])), { duplicate: true, missingCode: true, missingPublisher: true, missingCategory: true, missingPrice: true, subjectMismatch: true, inactive: true });
  assert.equal(getTextbookQualityScore(malformed, new Set(["수학"])), 39);
  const rows = [-2, 0, 1, 3, 4, 19, 20].map((totalQuantity) => ({ totalQuantity }));
  for (const [filter, want] of [["shortage", [-2, 1, 3]], ["unused", [0]], ["negative", [-2]], ["surplus", [20]]]) {
    assert.deepEqual(rows.filter((row) => matchesInventoryFilter(row, filter)).map((row) => row.totalQuantity), want);
  }
});

test("all-time ledger quantities feed inventory audit without slicing old moves or teacher quantities", async () => {
  const { buildInventoryCountRows, buildTextbookMasterRows } = await model();
  const textbooks = [book("balance"), book("negative"), book("zero"), book("teacher")];
  const locations = [{ id: "main", name: "본관" }];
  const stockMoves = [
    { id: "old", textbook_id: "balance", location_id: "main", move_type: "opening", quantity: 10, unit_amount: 100, moved_at: "2025-01-01" },
    { id: "buy", textbook_id: "balance", location_id: "main", move_type: "purchase_receipt", quantity: 5, unit_amount: 100, moved_at: "2026-08-01" },
    { id: "sale", textbook_id: "balance", location_id: "main", move_type: "sale_issue", quantity: -4, unit_amount: 100, moved_at: "2026-08-02" },
    { id: "return", textbook_id: "balance", location_id: "main", move_type: "return_in", quantity: 1, unit_amount: 100, moved_at: "2026-08-03" },
    { id: "negative", textbook_id: "negative", location_id: "main", quantity: -2, unit_amount: 100 },
    { id: "teacher", textbook_id: "teacher", location_id: "main", copy_scope: "teacher", quantity: 2, unit_amount: 0 },
  ];
  const inventory = buildTextbookInventorySnapshot({ textbooks, locations, stockMoves });
  const master = buildTextbookMasterRows(inventory);
  assert.equal(master.find((row) => row.id === "balance").totalQuantity, 12);
  assert.equal(master.find((row) => row.id === "balance").stockValue, 1200);
  assert.equal(master.find((row) => row.id === "teacher").teacherQuantity, 2);
  assert.equal(master.find((row) => row.id === "teacher").studentQuantity, 0);
  assert.deepEqual(master.find((row) => row.id === "teacher").teacherLocationQuantities, { main: 2 });
  const counts = buildInventoryCountRows({ rows: inventory, locations, locationId: "main", now: Date.parse("2026-08-31T00:00:00Z"), stockCounts: [
    { id: "old-count", textbook_id: "balance", location_id: "main", counted_at: "2026-07-01" },
    { id: "latest-count", textbook_id: "balance", location_id: "main", counted_at: "2026-08-30" },
    { id: "other-location", textbook_id: "negative", location_id: "annex", counted_at: "2026-08-31" },
  ] });
  assert.deepEqual(counts.map((row) => [row.id, row.currentQuantity, row.status]), [["negative", -2, "recommended"], ["zero", 0, "recommended"], ["teacher", 2, "recommended"], ["balance", 12, "done"]]);
  assert.equal(counts[0].reason, "마이너스 재고");
  assert.equal(counts[3].latestCountAt, "2026-08-30");
  assert.equal(counts[3].daysSinceLatestCount, 1);
  assert.strictEqual(counts[3].source, inventory.find((row) => row.id === "balance"));
});

test("closing still uses the real complete ledger movement classes, costs, margins and review rule", async () => {
  await model();
  const textbook = book("science", { subject: "science", sale_price: 10000 });
  const stockMoves = [
    ["opening", 2], ["purchase_receipt", 3], ["return_in", 1], ["transfer_in", 1],
    ["sale_issue", -2], ["return_out", -1], ["transfer_out", -1], ["stock_adjustment", -1],
  ].map(([move_type, quantity], i) => ({ id: `move-${i}`, textbook_id: "science", location_id: "main", move_type, quantity, unit_amount: 10000, moved_at: "2026-08-01" }));
  stockMoves.push({ id: "teacher-sale", textbook_id: "science", move_type: "sale_issue", quantity: -1, copy_scope: "teacher", unit_amount: 0, moved_at: "2026-08-02" });
  stockMoves.push({ id: "old", textbook_id: "science", move_type: "purchase_receipt", quantity: 99, moved_at: "2025-01-01" });
  const scoped = filterStockMovesForClosing({ closingMonth: "2026-08", subject: "science", textbooks: [textbook], stockMoves });
  assert.equal(scoped.length, 9);
  const closing = buildTextbookMonthlyClosing({ stockMoves: scoped, receivedAmount: 40000, supplierPaymentAmount: 63000 });
  assert.equal(closing.purchaseQuantity, 7);
  assert.equal(closing.saleQuantity, 5);
  assert.equal(closing.adjustmentQuantity, -1);
  assert.equal(closing.endingQuantity, 1);
  // Existing enrichment uses catalog sale price when a zero-priced move has no
  // amount; teacher purchase cost is zero. Preserve that legacy calculation.
  assert.equal(closing.teamMargins.find((row) => row.team === "science").marginAmount, 12000);
  assert.equal(closing.purchaseAmount, 70000);
  assert.equal(closing.saleAmount, 40000);
  assert.equal(closing.adjustmentAmount, -10000);
  assert.equal(closing.endingAmount, 20000);
  assert.equal(closing.paymentDifference, -23000);
  assert.equal(closing.settlementDifference, -11000);
  assert.deepEqual(closing.teamMargins.map((row) => row.team), ["english", "math", "science", "other"]);
  assert.equal(closing.needsReview, true);
  assert.throws(() => validateMonthlyClosingDraft(closing, { memo: "" }));
  assert.doesNotThrow(() => validateMonthlyClosingDraft(closing, { memo: "차이 확인" }));
});
