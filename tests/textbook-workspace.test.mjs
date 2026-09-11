import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildSaleLineStatusTransition,
  buildTextbookMonthlyClosing,
  buildTextbookSaleDraft,
  getTextbookPurchaseUnitCost,
  getTextbookUnitMargin,
} from "../src/features/textbooks/textbook-ledger.js";

const root = new URL("../", import.meta.url);
const handoffModelSource = await readFile(new URL("src/features/textbooks/textbook-handoff-model.ts", root), "utf8");
const readModelSource = await readFile(new URL("src/features/textbooks/textbook-read-model.ts", root), "utf8");
const readTypesSource = await readFile(new URL("src/features/textbooks/textbook-read-types.ts", root), "utf8");
const closingModelSource = await readFile(new URL("src/features/textbooks/textbook-closing-model.ts", root), "utf8");
const referenceModelSource = await readFile(new URL("src/features/textbooks/textbook-reference-model.ts", root), "utf8");
const dataTableSearchFieldSource = await readFile(new URL("src/components/data-table/data-table-search-field.tsx", root), "utf8");
const dataTableSelectFilterSource = await readFile(new URL("src/components/data-table/data-table-select-filter.tsx", root), "utf8");
const formDialogSource = await readFile(new URL("src/components/ui/form-dialog.tsx", root), "utf8");

function assertPreparedWorkspaceReads(source) {
  assert.match(source, /useTextbookNumberedData/);
  assert.match(source, /useTextbookReferenceData/);
  assert.doesNotMatch(source, /useTextbookOperationsData|TextbookOperationsData/);
  assert.doesNotMatch(source, /\bdata\.(?:textbooks|purchaseOrders|purchaseOrderLines|stockMoves|sales|saleLines|students|classes)\b/);
}

test("textbook workspace consumes extracted projections while filtering raw purchase members before grouping", async () => {
  const workspaceSource = await readFile(new URL("src/features/textbooks/textbook-operations-workspace.tsx", root), "utf8");
  const modelImports = workspaceSource.match(/import \{([^}]+)\} from "\.\/textbook-read-model";/)?.[1] || "";
  const typeImports = workspaceSource.match(/import type \{([^}]+)\} from "\.\/textbook-read-types";/)?.[1] || "";
  for (const name of ["buildPurchaseDisplayRows", "getPurchaseScopeLines", "getTextbookById"]) {
    assert.ok(modelImports.split(/[,\s]+/).includes(name), `${name} is imported from the real model`);
    assert.doesNotMatch(workspaceSource, new RegExp(`function ${name}\\b`));
    assert.match(workspaceSource, new RegExp(`${name}\\(`));
  }
  for (const name of ["InventoryCountRow", "InventoryHistoryRow", "PurchaseKanbanDraft"]) {
    assert.ok(typeImports.split(/[,\s]+/).includes(name), `${name} uses the extracted type`);
    assert.doesNotMatch(workspaceSource, new RegExp(`type ${name}\\b`));
  }
  assert.match(workspaceSource, /const rows = getCurrentVisiblePurchaseRows\(group\.id\);[\s\S]*buildPurchaseDisplayRows\(rows, ordersById, textbooks\)/);
  assert.match(workspaceSource, /const filteredInventory = numbered\.master\.rows/);
  assert.match(workspaceSource, /rows=\{numbered\.inventory\.rows\}/);
  assertPreparedWorkspaceReads(workspaceSource);
});

let textbookServicePromise;

function loadTextbookService() {
  if (!textbookServicePromise) {
    const supabaseStubUrl = `data:text/javascript,${encodeURIComponent('export const supabase = null; export const supabaseConfigError = "";')}`;
    const cacheInvalidationStubUrl = `data:text/javascript,${encodeURIComponent('export async function invalidatePublicClassesCacheAfterMutation() {}')}`;
    const withKnownExtension = (url) => {
      const path = fileURLToPath(url);
      if (extname(path)) return url;
      for (const extension of [".ts", ".js"]) {
        if (existsSync(`${path}${extension}`)) return pathToFileURL(`${path}${extension}`).href;
      }
      return url;
    };
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === "@/lib/supabase") {
          return { url: supabaseStubUrl, shortCircuit: true };
        }
        if (specifier === "@/lib/public-classes-cache-invalidation.js") {
          return { url: cacheInvalidationStubUrl, shortCircuit: true };
        }
        if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
          return nextResolve(withKnownExtension(new URL(specifier, context.parentURL).href), context);
        }
        return nextResolve(specifier, context);
      },
    });
    textbookServicePromise = import("../src/features/textbooks/textbook-service.ts");
  }
  return textbookServicePromise;
}

test("textbook request creation uses the constrained request RPC", async () => {
  const { textbookService } = await loadTextbookService();
  const calls = [];
  const response = { data: { order: { id: "order-1" }, lines: [] }, error: null };
  const client = {
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      return response;
    },
  };

  const result = await textbookService.createTextbookRequest({
    textbookId: "10000000-0000-4000-8000-000000000001",
    requestedTextbookTitle: "개념원리",
    classId: "20000000-0000-4000-8000-000000000001",
    locationId: "30000000-0000-4000-8000-000000000001",
    studentRequestedQuantity: 12,
    teacherRequestedQuantity: 1,
    memo: "수업 시작 전 필요",
  }, client);

  assert.deepEqual(calls, [{
    name: "create_textbook_request_v1",
    parameters: {
      p_textbook_id: "10000000-0000-4000-8000-000000000001",
      p_requested_textbook_title: "개념원리",
      p_class_id: "20000000-0000-4000-8000-000000000001",
      p_location_id: "30000000-0000-4000-8000-000000000001",
      p_student_requested_quantity: 12,
      p_teacher_requested_quantity: 1,
      p_memo: "수업 시작 전 필요",
    },
  }]);
  assert.deepEqual(result, response.data);

  const deniedClient = {
    async rpc() {
      return { data: null, error: new Error("denied") };
    },
  };
  await assert.rejects(
    () => textbookService.createTextbookRequest({}, deniedClient),
    { message: "denied" },
  );
});

test("admin textbooks route uses the dedicated operations workspace", async () => {
  const pageSource = await readFile(new URL("src/app/admin/textbooks/page.tsx", root), "utf8");
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(pageSource, /TextbookOperationsWorkspace/);
  assert.match(workspaceSource, /TabsTrigger value="master"/);
  assert.match(workspaceSource, /TabsTrigger value="purchase"/);
  assert.match(workspaceSource, /TabsTrigger value="sales"/);
  assert.match(workspaceSource, /TabsTrigger value="inventory"/);
  assert.doesNotMatch(workspaceSource, /TabsTrigger value="closing"/);
});

test("textbook workspace reuses its preloaded science area map for every master save", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const preloadedContextCount = (
    workspaceSource.match(/scienceSubjectAreas:\s*acceptedMasterOptions\?\.scienceSubjectAreas \|\| \[\]/g) || []
  ).length;

  assert.equal(preloadedContextCount, 3);
});

test("textbook edit and purchase-request forms preserve unsupported subjects until explicit selection", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /subject:\s*getTextbookSubjectWriteValue\(row\.subject\)/);
  assert.match(workspaceSource, /subject:\s*getTextbookSubjectWriteValue\(line\.subject\)/);
  assert.doesNotMatch(workspaceSource, /subject:\s*normalizeSubjectValue\(row\.subject\)/);
  assert.doesNotMatch(
    workspaceSource,
    /subject:\s*normalizeSubjectValue\(line\.subject\s*\|\|\s*emptyMasterForm\.subject\)/,
  );
  assert.match(workspaceSource, /validateTextbookTaxonomyForWrite\(masterForm\)/);
});

test("textbook workspace fourth-pass polish keeps dialogs and dense tables stable", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  const srOnlyCaptionCount = (workspaceSource.match(/<caption className="sr-only">/g) || []).length;

  assert.doesNotMatch(workspaceSource, /DialogClose/);
  assert.doesNotMatch(workspaceSource, /data-textbook-modal-dismiss/);
  assert.doesNotMatch(workspaceSource, /closeFromNativeEvent/);
  assert.doesNotMatch(workspaceSource, /document\.addEventListener\("pointerup"/);
  assert.match(workspaceSource, /const dialogOpenerRef = useRef<HTMLElement \| null>\(null\)/);
  assert.match(workspaceSource, /onClickCapture=\{rememberTextbookDialogOpener\}/);
  assert.match(workspaceSource, /onFocusCapture=\{rememberTextbookDialogOpener\}/);
  assert.match(workspaceSource, /dialogOpenerRef\.current = button/);
  assert.equal((workspaceSource.match(/returnFocusRef=\{dialogOpenerRef\}/g) || []).length, 7);
  assert.match(workspaceSource, /onCancel=\{closePurchaseDialog\}/);
  assert.match(workspaceSource, /window\.setTimeout\(\(\) => setPurchaseDialogOpen\(false\), 0\)/);
  assert.match(workspaceSource, /window\.setTimeout\(\(\) => setSaleDialogOpen\(false\), 0\)/);
  assert.doesNotMatch(workspaceSource, /window\.setTimeout\(\(\) => setClosingDialogOpen\(false\), 0\)/);
  assert.match(workspaceSource, /\{purchaseDialogOpen \? \(/);
  assert.match(workspaceSource, /\{bulkOrderDialogOpen \? \(/);
  assert.match(workspaceSource, /\{saleDialogOpen \? \(/);
  assert.doesNotMatch(workspaceSource, /\{closingDialogOpen \? \(/);
  assert.match(workspaceSource, /import \{ FormDialogContent, DetailDialogContent, DocumentDialogContent, ConfirmationDialogContent \} from "@\/components\/ui\/form-dialog"/);
  assert.doesNotMatch(workspaceSource, /w-\[calc\(100vw-2rem\)\] overflow-x-hidden overflow-y-auto sm:max-w-xl/);
  assert.ok(srOnlyCaptionCount >= 4);
  assert.match(workspaceSource, /<caption className="sr-only">재고 실사 입력 목록<\/caption>/);
  assert.match(workspaceSource, /<caption className="sr-only">교재 재고<\/caption>/);
  assert.match(workspaceSource, /<caption className="sr-only">\{mode === "request" \? "교재 요청 처리 목록" : "교재 주문·입고 처리 목록"\}<\/caption>/);
  assert.match(workspaceSource, /<caption className="sr-only">교재 출고 처리 목록<\/caption>/);
  assert.match(workspaceSource, /role="region"[\s\S]*aria-live="polite"/);
  assert.match(workspaceSource, /title="현재 교재 전체 선택"/);
  assert.match(workspaceSource, /title=\{`\$\{rowA11yLabel\} 선택`\}/);
  assert.match(workspaceSource, /title="일괄 처리 가능한 행 전체 선택"/);
  assert.match(workspaceSource, /title=\{`\$\{textbookTitle\} 일괄 처리 선택`\}/);
  assert.match(workspaceSource, /title=\{actionLabel\}/);
  assert.match(workspaceSource, /const stickyActionHeadClassName =/);
  assert.match(workspaceSource, /const stickyActionCellClassName =/);
  assert.match(workspaceSource, /sticky right-0 bg-background/);
});

test("textbook workspace exposes class-linked sales and scanner-ready fields", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");

  assert.match(workspaceSource, /selectedClassId/);
  assert.match(workspaceSource, /excludedStudentIds/);
  assert.match(workspaceSource, /type="search"[\s\S]*value=\{saleStudentQuery\}/);
  assert.match(workspaceSource, /name="title"[\s\S]*value=\{masterForm\.title\}/);
  assert.match(workspaceSource, /masterPublisherOptions/);
  assert.match(workspaceSource, /ariaLabel="출판사 선택"/);
  assert.match(workspaceSource, /name="price"[\s\S]*value=\{masterForm\.price\}/);
  assert.match(workspaceSource, /name="isbn13"[\s\S]*value=\{masterForm\.isbn13\}/);
  assert.match(workspaceSource, /name="barcode"[\s\S]*value=\{masterForm\.barcode\}/);
  assert.match(workspaceSource, /chargeMonth/);
  assert.match(workspaceSource, /barcode/);
  assert.match(workspaceSource, /isbn13/);
  assert.match(serviceSource, /buildTextbookSaleDraft/);
  assert.match(serviceSource, /textbook_sale_lines/);
  assert.match(serviceSource, /textbook_stock_moves/);
});

test("textbook sale issuing records negative stock instead of blocking shortage", () => {
  const transition = buildSaleLineStatusTransition({
    line: {
      id: "sale-line-1",
      textbook_id: "textbook-1",
      location_id: "location-1",
      quantity: 5,
      unit_price: 12000,
      student_name: "테스트 학생",
    },
    targetStatus: "issued",
    availableQuantity: 0,
  });

  assert.equal(transition.targetStatus, "issued");
  assert.equal(transition.shouldCreateStockMove, true);
  assert.equal(transition.stockMove.quantity, -5);
  assert.equal(transition.stockMove.amount, -60000);
});

test("textbook sale return records positive stock movement", () => {
  const transition = buildSaleLineStatusTransition({
    line: {
      id: "sale-line-1",
      textbook_id: "textbook-1",
      location_id: "location-1",
      quantity: 2,
      unit_price: 10000,
      student_name: "student",
    },
    targetStatus: "returned",
  });

  assert.equal(transition.targetStatus, "returned");
  assert.equal(transition.shouldCreateStockMove, true);
  assert.equal(transition.stockMove.move_type, "return_in");
  assert.equal(transition.stockMove.quantity, 2);
  assert.equal(transition.stockMove.amount, 20000);
});

test("textbook sale line payload stays compatible with the deployed schema", () => {
  const draft = buildTextbookSaleDraft({
    classRecord: { id: "class-1", student_ids: ["student-1"] },
    students: [{ id: "student-1", name: "테스트 학생" }],
    textbook: { id: "textbook-1", sale_price: 12000 },
    chargeMonth: "2026-05",
    locationId: "location-1",
  });

  assert.equal(draft.lines.length, 1);
  assert.equal(Object.hasOwn(draft.lines[0], "student_name"), false);
  assert.equal(draft.lines[0].student_id, "student-1");
});

test("textbook purchase pricing applies external distributor discount and tips bookstore profit", () => {
  assert.equal(getTextbookPurchaseUnitCost({
    sale_price: 10000,
    publisher: "외부출판사",
    supplier: "외부총판",
  }), 9000);
  assert.equal(getTextbookUnitMargin({
    sale_price: 10000,
    publisher: "외부출판사",
    supplier: "외부총판",
  }), 1000);
  assert.equal(getTextbookPurchaseUnitCost({
    sale_price: 10000,
    publisher: "팁스서점",
    supplier: "팁스서점",
  }), 0);
  assert.equal(getTextbookUnitMargin({
    sale_price: 10000,
    publisher: "팁스서점",
    supplier: "팁스서점",
  }), 10000);
});

test("monthly closing splits textbook margin by English and Math teams", () => {
  const closing = buildTextbookMonthlyClosing({
    stockMoves: [
      {
        move_type: "sale_issue",
        quantity: -1,
        unit_amount: 10000,
        amount: -10000,
        subject: "english",
        publisher: "외부출판사",
        supplier: "외부총판",
      },
      {
        move_type: "sale_issue",
        quantity: -2,
        unit_amount: 10000,
        amount: -20000,
        subject: "math",
        publisher: "팁스서점",
        supplier: "팁스서점",
      },
    ],
  });

  const margins = Object.fromEntries(closing.teamMargins.map((item) => [item.team, item]));

  assert.equal(closing.saleAmount, 30000);
  assert.equal(closing.textbookMarginAmount, 21000);
  assert.equal(closing.settlementDifference, 21000);
  assert.equal(margins.english.marginAmount, 1000);
  assert.equal(margins.math.marginAmount, 20000);
});

test("textbook sales keep actor audit and annual monthly class history", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");

  assert.match(workspaceSource, /createdBy: currentUserId/);
  assert.match(serviceSource, /createClassTextbookSale[\s\S]*const createdBy = normalizeOptionalUuid/);
  assert.match(serviceSource, /textbook_sales[\s\S]*created_by: createdBy/);
  assert.match(readModelSource, /function buildSaleHistorySummaryRows/);
  assert.match(workspaceSource, /function SalesHistoryLedger/);
  assert.match(workspaceSource, /summary=\{numbered\.saleHistory\.summary\.value\}/);
  assert.doesNotMatch(workspaceSource, /const filteredRows = rows\.filter/);
  assert.doesNotMatch(workspaceSource, /const totalIssuedQuantity = filteredRows\.reduce/);
  assert.match(workspaceSource, /aria-label="교재 출고 이력"/);
  assert.match(workspaceSource, /연도 월 수업별 교재 출고 이력/);
  assert.match(workspaceSource, /대기 \{formatQuantity\(totalWaitingQuantity\)\}/);
  assert.match(workspaceSource, /완료 \{formatQuantity\(totalIssuedQuantity\)\}/);
  assert.match(workspaceSource, /<SalesHistoryLedger/);
});

test("textbook workspace fixes the main operational friction found in browser use", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");

  assert.doesNotMatch(workspaceSource, /<h1/);
  assert.doesNotMatch(workspaceSource, /통합 원장/);
  assert.doesNotMatch(workspaceSource, /aria-label="새로고침"/);
  assert.match(workspaceSource, /label="교재 검색" clearLabel="검색 초기화"/);
  assert.match(dataTableSearchFieldSource, /aria-label=\{clearLabel\}/);
  assert.match(dataTableSearchFieldSource, /aria-label=\{label\}/);
  assert.match(workspaceSource, /placeholder="교재명, 출판사, ISBN, 바코드"/);
  assert.ok(
    workspaceSource.indexOf('aria-label="교재관리 업무 탭"') <
      workspaceSource.indexOf('label="교재 검색"'),
  );
  assert.match(workspaceSource, /activeTab === "master"[\s\S]*신규 등록/);
  assert.doesNotMatch(workspaceSource, /<TabsContent value="master" className="mt-4 grid gap-4">[\s\S]*<Plus className="mr-2 size-4" \/>[\s\S]*신규 등록/);
  assert.doesNotMatch(workspaceSource, /inventoryAuditFilter/);
  assert.match(workspaceSource, /stockShortage/);
  assert.match(workspaceSource, /saleSubmitDisabled/);
  assert.match(workspaceSource, /selectMasterTextbook/);
  assert.match(workspaceSource, /신규 등록/);
  assert.match(serviceSource, /filterStockMovesForClosing/);
  assert.match(serviceSource, /validateMonthlyClosingDraft/);
});

test("textbook workspace uses searchable selectors and tab-scoped inventory controls", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /SearchCombobox/);
  assert.match(workspaceSource, /CommandInput/);
  assert.match(workspaceSource, /searchPlaceholder="교재명, 출판사, ISBN"/);
  assert.match(workspaceSource, /getTextbookSubjectWriteValue/);
  assert.match(workspaceSource, /getSubjectLabel\(row\.subject\)/);
  assert.match(workspaceSource, /const \[activeTab, setActiveTab\] = useState<TextbookTab>\(initialNavigationRef\.current\.tab\)/);
  assert.match(workspaceSource, /classificationControls=\{\(locationControl\) => <TextbookListControls extraFilters=\{locationControl\}/);
  assert.match(workspaceSource, /function changeActiveTab/);
  assert.match(workspaceSource, /재고 실사/);
  assert.match(workspaceSource, /purchaseSubmitDisabled/);
  assert.match(workspaceSource, /submitInlineStockCount/);
});

test("textbook operation selectors keep long option menus scrollable without selector sorting", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const searchComboboxBlock = workspaceSource.slice(
    workspaceSource.indexOf("function SearchCombobox"),
    workspaceSource.indexOf("function toggleSearchSelectFilter"),
  );
  const textbookSelectBlock = workspaceSource.slice(
    workspaceSource.indexOf("function TextbookSelect"),
    workspaceSource.indexOf("function ClassSelect"),
  );
  const classSelectBlock = workspaceSource.slice(
    workspaceSource.indexOf("function ClassSelect"),
    workspaceSource.indexOf("function TeacherSelect"),
  );

  assert.match(workspaceSource, /onWheelCapture=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(workspaceSource, /CommandList[\s\S]*className="max-h-80 overscroll-contain overflow-y-auto"/);
  assert.match(workspaceSource, /option\.metaRows/);
  assert.doesNotMatch(workspaceSource, /type SearchSelectSortOption =/);
  assert.doesNotMatch(searchComboboxBlock, /sortOptions/);
  assert.doesNotMatch(searchComboboxBlock, /정렬/);
  assert.doesNotMatch(workspaceSource, /const textbookSelectSortOptions/);
  assert.doesNotMatch(textbookSelectBlock, /sortOptions=/);
  assert.doesNotMatch(textbookSelectBlock, /defaultSortKey=/);
  assert.doesNotMatch(workspaceSource, /const classSelectSortOptions/);
  assert.doesNotMatch(classSelectBlock, /sortOptions=/);
  assert.doesNotMatch(classSelectBlock, /defaultSortKey=/);
});

test("textbook operation selectors expose class and textbook attributes in menu options", async () => {

  assert.match(referenceModelSource, /function buildTextbookSelectMetaRows/);
  assert.match(referenceModelSource, /metaRows: buildTextbookSelectMetaRows\(textbook\)/);
  assert.match(referenceModelSource, /const categoryDetail = compactUniqueLabels\(\[schoolLevel, grade, subSubject\]\)\.join\(" · "\)/);
  assert.match(referenceModelSource, /\{ label: "구분", value: categoryDetail \|\| getTaxonomyCategoryLabel\(textbook\) \}/);
  assert.match(referenceModelSource, /label: "출판사"/);
  assert.match(referenceModelSource, /label: "ISBN"/);
  assert.match(referenceModelSource, /label: "바코드"/);
  assert.match(referenceModelSource, /function buildClassSelectMetaRows/);
  assert.match(referenceModelSource, /metaRows: buildClassSelectMetaRows\(classItem\)/);
  const classSelectMetaRowsBlock = referenceModelSource.slice(
    referenceModelSource.indexOf("function buildClassSelectMetaRows"),
    referenceModelSource.indexOf("function buildTextbookReferenceOptions"),
  );
  assert.match(classSelectMetaRowsBlock, /\{ label: "선생님", value: getClassTeacherLabel\(classItem\) \}/);
  assert.match(classSelectMetaRowsBlock, /\{ label: "강의실", value: getClassClassroomSelectLabel\(classItem\) \}/);
  assert.match(classSelectMetaRowsBlock, /\{ label: "학생", value: studentCount > 0 \? `\$\{formatQuantity\(studentCount\)\}명` : "" \}/);
  assert.match(classSelectMetaRowsBlock, /\{ label: "시간", value: getClassScheduleLabel\(classItem\) \}/);
  assert.doesNotMatch(classSelectMetaRowsBlock, /label: "담당"/);
  assert.doesNotMatch(classSelectMetaRowsBlock, /label: "과목"/);
  assert.doesNotMatch(classSelectMetaRowsBlock, /label: "학년"/);
  assert.doesNotMatch(classSelectMetaRowsBlock, /label: "상태"/);
});

test("textbook operation selectors support multi-select filters in option menus", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const searchComboboxBlock = workspaceSource.slice(
    workspaceSource.indexOf("function SearchCombobox"),
    workspaceSource.indexOf("function toggleSearchSelectFilter"),
  );
  const textbookSelectBlock = workspaceSource.slice(
    workspaceSource.indexOf("function TextbookSelect"),
    workspaceSource.indexOf("function ClassSelect"),
  ) + referenceModelSource.slice(referenceModelSource.indexOf("function buildTextbookReferenceOptions"), referenceModelSource.indexOf("function buildTextbookClassReferenceOptions"));
  const classSelectBlock = workspaceSource.slice(
    workspaceSource.indexOf("function ClassSelect"),
    workspaceSource.indexOf("function TeacherSelect"),
  ) + referenceModelSource.slice(referenceModelSource.indexOf("function buildTextbookClassReferenceOptions"));

  assert.match(readTypesSource, /type SearchSelectFilterGroup =/);
  assert.match(readTypesSource, /type SearchSelectFilterLayout = "default" \| "subject-grade-teacher" \| "subject-grade-detail"/);
  assert.match(workspaceSource, /filterGroups\?: SearchSelectFilterGroup\[\]/);
  assert.match(workspaceSource, /filterLayout\?: SearchSelectFilterLayout/);
  assert.match(workspaceSource, /const \[selectedFilterValues, setSelectedFilterValues\] = useState<Record<string, string\[\]>>/);
  assert.match(workspaceSource, /const filteredOptions = serverState \? options : filterGroups\.length === 0/);
  assert.match(searchComboboxBlock, /const visibleFilterGroups = serverState\?\.visibleFilterGroups \|\| buildVisibleSearchSelectFilterGroups/);
  assert.match(searchComboboxBlock, /const shouldInlineFilterReset = usesTwoColumnFilterLayout && activeFilterCount > 0/);
  assert.match(searchComboboxBlock, /shouldInlineFilterReset && "grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)_auto\]"/);
  assert.match(searchComboboxBlock, /!usesTwoColumnFilterLayout && activeFilterCount > 0/);
  assert.match(searchComboboxBlock, /usesTwoColumnFilterLayout && "grid-cols-2/);
  assert.match(searchComboboxBlock, /usesTwoColumnFilterLayout && !\["subject", "grade"\]\.includes\(group\.key\) && \(shouldInlineFilterReset \? "col-span-3" : "col-span-2"\)/);
  assert.match(searchComboboxBlock, /group\.key === "grade" && shouldInlineFilterReset/);
  assert.match(workspaceSource, /function toggleSearchSelectFilter/);
  assert.match(workspaceSource, /activeFilterCount/);
  assert.match(workspaceSource, /필터 초기화/);
  assert.doesNotMatch(searchComboboxBlock, />\s*필터\s*<\/span>/);
  assert.match(workspaceSource, /aria-pressed=\{isFilterSelected\}/);
  assert.doesNotMatch(workspaceSource, /필터\{activeFilterCount > 0/);
  assert.doesNotMatch(workspaceSource, /\{formatQuantity\(option\.count\)\}/);
  assert.match(workspaceSource, /buildSearchSelectFilterGroups/);
  assert.match(referenceModelSource, /function buildVisibleSearchSelectFilterGroups/);
  assert.match(referenceModelSource, /filterValues: \{/);
  assert.match(workspaceSource, /const textbookSelectFilterGroups = buildSearchSelectFilterGroups/);
  assert.match(workspaceSource, /const classSelectFilterGroups = buildSearchSelectFilterGroups/);
  assert.match(textbookSelectBlock, /subject: buildSearchSelectFilterValues/);
  assert.match(textbookSelectBlock, /grade: buildSearchSelectFilterValues/);
  assert.match(textbookSelectBlock, /subSubject: buildSearchSelectFilterValues\(\[getTextbookSelectSubSubject\(textbook\)\]\)/);
  assert.doesNotMatch(textbookSelectBlock, /schoolLevel: buildSearchSelectFilterValues/);
  assert.match(textbookSelectBlock, /\{ key: "subject", label: "과목", optionOrder: \["영어", "수학", "기타"\] \}/);
  assert.match(textbookSelectBlock, /\{ key: "grade", label: "학년" \}[\s\S]*\{ key: "subSubject", label: "세부과목" \}/);
  assert.match(textbookSelectBlock, /\{ key: "subSubject", label: "세부과목" \}/);
  assert.doesNotMatch(textbookSelectBlock, /\{ key: "schoolLevel"/);
  assert.match(textbookSelectBlock, /filterLayout="subject-grade-detail"/);
  assert.match(referenceModelSource, /function getTextbookSelectSubSubject/);
  assert.match(referenceModelSource, /const textbookNonSubSubjectFilterLabels = new Set/);
  assert.match(referenceModelSource, /TEXTBOOK_GRADE_OPTIONS\.map\(\(option\) => option\.label\)/);
  assert.match(referenceModelSource, /TEXTBOOK_SCHOOL_LEVEL_OPTIONS\.map\(\(option\) => option\.label\)/);
  assert.doesNotMatch(textbookSelectBlock, /publisher: buildSearchSelectFilterValues/);
  assert.doesNotMatch(textbookSelectBlock, /category: buildSearchSelectFilterValues/);
  assert.doesNotMatch(textbookSelectBlock, /\{ key: "publisher"/);
  assert.doesNotMatch(textbookSelectBlock, /\{ key: "category"/);
  assert.match(classSelectBlock, /subject: buildSearchSelectFilterValues/);
  assert.match(classSelectBlock, /grade: buildSearchSelectFilterValues/);
  assert.match(classSelectBlock, /teacher: buildSearchSelectFilterValues/);
  assert.match(classSelectBlock, /\{ key: "subject", label: "과목", optionOrder: \["영어", "수학", "기타"\] \}/);
  assert.match(classSelectBlock, /\{ key: "grade", label: "학년" \}/);
  assert.match(classSelectBlock, /\{ key: "teacher", label: "선생님" \}/);
  assert.match(classSelectBlock, /filterLayout="subject-grade-teacher"/);
  assert.doesNotMatch(classSelectBlock, /status: buildSearchSelectFilterValues/);
  assert.doesNotMatch(classSelectBlock, /\{ key: "status"/);
});

test("textbook workspace resolves reviewed master and inventory UX issues", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const listControlsSource = workspaceSource.slice(
    workspaceSource.indexOf("function TextbookListControls"),
    workspaceSource.indexOf("function TextbookSelectionActions"),
  );

  assert.match(workspaceSource, /TabsList[\s\S]*aria-label="교재관리 업무 탭"/);
  assert.match(workspaceSource, /TextbookListControls/);
  assert.match(listControlsSource, /aria-label="교재 분류 필터"/);
  assert.match(listControlsSource, /<DataTableFilters/);
  assert.match(listControlsSource, /sm:grid sm:grid-cols-2 lg:flex lg:flex-nowrap/);
  assert.doesNotMatch(listControlsSource, /lg:w-3[024]|lg:w-4[04]/);
  assert.match(listControlsSource, /ariaLabel="교재 과목 필터"/);
  assert.match(listControlsSource, /ariaLabel="교재 세부과목 필터"/);
  assert.match(listControlsSource, /ariaLabel="교재 학교 구분 필터"/);
  assert.match(listControlsSource, /ariaLabel="교재 학년 필터"/);
  assert.equal((listControlsSource.match(/<DataTableSelectFilter inline/g) || []).length, 3);
  assert.match(listControlsSource, /searchPlaceholder="세부과목 검색"/);
  assert.match(dataTableSelectFilterSource, /inline && "lg:flex lg:w-auto lg:max-w-60 lg:flex-1 lg:items-center lg:gap-2"/);
  assert.doesNotMatch(listControlsSource, /교재 분류 필터 열기/);
  assert.doesNotMatch(listControlsSource, /<Popover>/);
  assert.doesNotMatch(listControlsSource, /분류\s*<span/);
  assert.match(workspaceSource, /subjectGroupFilter/);
  assert.match(workspaceSource, /schoolLevelGroupFilter/);
  assert.match(workspaceSource, /gradeLevelGroupFilter/);
  assert.match(workspaceSource, /getTextbookGroupLabel/);
  assert.doesNotMatch(workspaceSource, /TextbookGroupMode/);
  assert.doesNotMatch(workspaceSource, /publisherGroupFilter/);
  assert.match(workspaceSource, /amountMode="salePrice"/);
  assert.match(workspaceSource, /판매가/);
  assert.match(workspaceSource, /재고금액/);
  assert.match(workspaceSource, /data-\[state=active\]:bg-background/);
  assert.match(workspaceSource, /masterDialogOpen/);
  assert.match(workspaceSource, /openNewMasterDialog/);
  assert.match(workspaceSource, /title=\{masterForm\.id \? "교재 수정" : "교재 신규 등록"\}/);
  assert.match(workspaceSource, /<FormDialogContent[\s\S]*onSubmit=\{submitMaster\}/);
  assert.match(workspaceSource, /sm:col-span-2"><Field label="교재명" required/);
  assert.match(workspaceSource, /min-h-9 items-center gap-2 whitespace-nowrap/);
  assert.match(workspaceSource, /학교 구분/);
  assert.match(workspaceSource, /세부과목/);
  assert.match(workspaceSource, /전체 학년/);
  assert.match(workspaceSource, /getTextbookSchoolLevelSummary/);
  assert.match(workspaceSource, /getTextbookGradeSummary/);
  assert.match(workspaceSource, /configuredPublisherOptions/);
  assert.match(workspaceSource, /masterPublisherOptions/);
  assert.match(workspaceSource, /masterPublisherOptions/);
  assert.match(workspaceSource, /placeholder="예: 쎈 고등 수학 2"/);
  assert.match(workspaceSource, /placeholder="출판사 선택"/);
  assert.match(workspaceSource, /searchPlaceholder="출판사 검색"/);
  assert.match(workspaceSource, /emptyLabel="설정된 출판사가 없습니다"/);
  assert.match(workspaceSource, /placeholder="13자리 ISBN"/);
  assert.match(workspaceSource, /placeholder="스캔 또는 입력"/);
  assert.match(workspaceSource, /autoFocus/);
  assert.match(workspaceSource, /function normalizeMoneyInput/);
  assert.match(workspaceSource, /function normalizeInlineTextInput/);
  assert.match(workspaceSource, /function normalizeStoredTextInput/);
  assert.match(workspaceSource, /function setMasterIsbn13/);
  assert.match(workspaceSource, /price: normalizeMoneyInput\(event\.target\.value\)/);
  assert.match(workspaceSource, /onPatchChange\("price", normalizeMoneyInput\(event\.target\.value\)\)/);
  assert.match(workspaceSource, /pattern="\[0-9\]\*"/);
  assert.match(workspaceSource, /onChange=\{\(event\) => setMasterTextField\("title", event\.target\.value\)\}/);
  assert.match(workspaceSource, /onBlur=\{\(\) => settleMasterTextField\("title"\)\}/);
  assert.match(workspaceSource, /publisher: normalizeStoredTextInput\(value === "none" \? "" : value\)/);
  assert.match(workspaceSource, /onChange=\{\(event\) => setMasterIsbn13\(event\.target\.value\)\}/);
  assert.match(workspaceSource, /const shouldMirrorBarcode = !previousBarcode \|\| previousBarcode === previousIsbn/);
  assert.match(workspaceSource, /isNewMasterDuplicate/);
  assert.match(workspaceSource, /이미 등록된 교재/);
  assert.match(workspaceSource, /저장 잠김/);
});

test("textbook workspace keeps inactive textbooks in a compact trash flow", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");


  assert.match(workspaceSource, /getTextbookInactiveCleanupContext/);
  assert.match(workspaceSource, /context\.previewRows/);
  assert.match(workspaceSource, /function emptyInactiveTextbookTrash/);
  assert.match(workspaceSource, /requestTextbookConfirmation\(\{[\s\S]*title: "미사용 보관함 비우기"/);
  assert.match(workspaceSource, /confirmLabel: "영구 삭제"/);
  assert.match(workspaceSource, /textbookService\.purgeInactiveTextbooks\(targetIds\)/);
  assert.match(workspaceSource, /aria-label="미사용 교재 보기"/);
  assert.match(workspaceSource, />\s*비우기\s*<\/Button>/);
  assert.match(workspaceSource, /activeTab === "master" && textbookQualityFilter === "inactive"/);
  assert.match(serviceSource, /export async function purgeInactiveTextbooks/);
  assert.match(serviceSource, /"textbook_stock_counts"/);
  assert.match(serviceSource, /"textbook_stock_moves"/);
  assert.match(serviceSource, /"textbook_purchase_order_lines"/);
  assert.match(serviceSource, /"textbook_sale_lines"/);
  assert.match(serviceSource, /await client\.from\(table\)\.delete\(\)\.in\("textbook_id", ids\)/);
  assert.match(serviceSource, /\.from\("textbooks"\)[\s\S]*\.delete\(\)[\s\S]*\.eq\("status", "inactive"\)[\s\S]*\.in\("id", ids\)/);
  assert.match(serviceSource, /purgeInactiveTextbooks,/);
});

test("textbook workspace separates category filters and lets grouped rows collapse", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /getCategoryLabel/);
  assert.match(workspaceSource, /categoryGroupFilter/);
  assert.match(workspaceSource, /categoryGroupOptions/);
  assert.match(workspaceSource, /onCategoryFilterChange/);
  assert.match(workspaceSource, /categoryGroupFilter/);
  assert.match(workspaceSource, /subSubject: categoryGroupFilter/);
  assert.doesNotMatch(workspaceSource, /구분별/);
  assert.doesNotMatch(workspaceSource, /출판사별/);
  assert.match(workspaceSource, /TEXTBOOK_SCHOOL_LEVEL_OPTIONS/);
  assert.match(workspaceSource, /getGradeOptionsForSchoolLevel/);
  assert.match(workspaceSource, /getSubSubjectOptionsForSubject/);
  assert.doesNotMatch(workspaceSource, /row\.publisher \|\| row\.category/);
  assert.match(workspaceSource, /collapsedTextbookGroups/);
  assert.match(workspaceSource, /toggleTextbookGroup/);
  assert.match(workspaceSource, /aria-expanded=\{!isCollapsed\}/);
  assert.match(workspaceSource, /ChevronRight/);
  assert.match(workspaceSource, /ChevronDown/);
});

test("textbook settings manage subject taxonomy for textbook filters", async () => {
  const settingsSource = await readFile(
    new URL("src/features/textbooks/textbook-supplier-settings-workspace.tsx", root),
    "utf8",
  );
  const taxonomySource = await readFile(new URL("src/features/textbooks/textbook-taxonomy.ts", root), "utf8");
  const settingsPagesSource = await readFile(new URL("src/features/textbooks/use-textbook-settings-pages.ts", root), "utf8");
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");
  const navigationSource = await readFile(new URL("src/lib/navigation.ts", root), "utf8");
  const migrationSource = await readFile(
    new URL("supabase/migrations/20260501100000_textbook_taxonomy_settings.sql", root),
    "utf8",
  );

  assert.match(navigationSource, /title: "교재 설정"/);
  assert.match(settingsSource, /useTextbookSettingsPages/);
  assert.match(settingsSource, /data-testid="textbook-subsubjects-mobile-list"/);
  assert.match(settingsPagesSource, /listTextbookSubSubjectPage/);
  assert.match(settingsPagesSource, /enabled: activeSection === "subSubjects"/);
  assert.doesNotMatch(settingsSource, /textbook_sub_subject_settings|\.from\("textbook_/);
  assert.match(settingsSource, /세부과목 추가/);
  assert.match(settingsSource, /순서/);
  assert.match(settingsSource, /표시/);
  assert.match(settingsSource, /검색어 지우기/);
  assert.match(taxonomySource, /TEXTBOOK_SCHOOL_LEVEL_OPTIONS/);
  assert.match(taxonomySource, /TEXTBOOK_GRADE_OPTIONS/);
  assert.match(taxonomySource, /"단어", "독해", "듣기", "문법", "모고", "내신"/);
  assert.match(taxonomySource, /"공통수학1", "공통수학2"/);
  assert.match(serviceSource, /textbookSubSubjectSettings/);
  assert.match(serviceSource, /"textbook_sub_subject_settings"/);
  assert.match(serviceSource, /readTable\(client, "textbook_sub_subject_settings", "\*", missingTables\)/);
  assert.match(serviceSource, /school_levels: taxonomy\.schoolLevels/);
  assert.match(serviceSource, /grade_levels: taxonomy\.gradeLevels/);
  assert.match(serviceSource, /sub_subject: subSubject/);
  assert.match(migrationSource, /add column if not exists school_level text/);
  assert.match(migrationSource, /create table if not exists public\.textbook_sub_subject_settings/);
  assert.match(migrationSource, /notify pgrst, 'reload schema'/i);
});

test("textbook workspace supports selecting rows for bulk edit and delete", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");

  assert.match(workspaceSource, /selectedTextbookIds/);
  assert.match(workspaceSource, /bulkTextbookPatch/);
  assert.match(workspaceSource, /TextbookBulkEditDialog/);
  assert.match(workspaceSource, /masterBulkControlsOpen/);
  assert.match(workspaceSource, /<TextbookSelectionActions[\s\S]*controlsOpen=\{masterBulkControlsOpen\}/);
  assert.match(workspaceSource, /<TextbookBulkEditDialog[\s\S]*controlsOpen=\{masterBulkControlsOpen\}/);
  assert.match(workspaceSource, /aria-expanded=\{controlsOpen\} aria-haspopup="dialog"/);
  assert.match(workspaceSource, />\s*속성 변경\s*<\/Button>/);
  assert.match(workspaceSource, /if \(selectedCount === 0 \|\| !controlsOpen\) \{\s*return null;\s*\}/);
  assert.match(workspaceSource, /submitAriaLabel="선택 교재 변경 저장"/);
  assert.match(workspaceSource, /if \(pendingActionsRef\.current\.has\(actionKey\)\) return false/);
  assert.match(workspaceSource, /toggleTextbookSelection/);
  assert.match(workspaceSource, /toggleAllVisibleTextbooks/);
  assert.match(workspaceSource, /applyBulkTextbookEdit/);
  assert.match(workspaceSource, /deleteSelectedTextbooks/);
  assert.match(workspaceSource, /const completedMasterTitle = getTextbookTitle\(masterPayload\)/);
  assert.match(workspaceSource, /function showSavedMasterTextbook/);
  assert.match(workspaceSource, /showSavedMasterTextbook\(completedMasterTitle\)/);
  assert.match(workspaceSource, /clearTextbookListFilters\(title\)/);
  assert.match(workspaceSource, /masterSearchRef\.current\?\.select\(\)/);
  assert.match(workspaceSource, /selectedTextbookRows = useMemo\([\s\S]*selectedTextbookIds[\s\S]*inventoryById\.get\(id\)/);
  assert.match(workspaceSource, /const selectedTextbookIdSet = useMemo\(\(\) => new Set\(selectedTextbookIds\), \[selectedTextbookIds\]\)/);
  assert.match(workspaceSource, /selectedTextbookIdSet\.has\(id\)/);
  assert.match(workspaceSource, /const inventoryById = useMemo/);
  assert.match(workspaceSource, /const purchaseLinesById = useMemo/);
  assert.match(workspaceSource, /const saleLinesById = useMemo/);
  assert.match(workspaceSource, /purchaseLinesById\.get\(id\)/);
  assert.match(workspaceSource, /saleLinesById\.get\(id\)/);
  assert.match(workspaceSource, /teacherSaleBalance/);
  assert.match(workspaceSource, /const availableIds = new Set\(filteredInventory\.map\(getRecordId\)\.filter\(Boolean\)\)/);
  assert.match(workspaceSource, /setSelectedTextbookIds\(\(current\) => \{[\s\S]*availableIds\.has\(id\)/);
  assert.match(workspaceSource, /const visibleTextbookIdSet = useMemo\(\(\) => new Set\(visibleTextbookIds\), \[visibleTextbookIds\]\)/);
  assert.match(workspaceSource, /visibleTextbookIdSet\.has\(id\)/);
  assert.match(workspaceSource, /function toggleVisiblePurchaseLineSelection/);
  assert.match(workspaceSource, /function toggleVisibleSaleLineSelection/);
  assert.doesNotMatch(workspaceSource, /function toggleVisibleClosingSelection/);
  assert.match(workspaceSource, /const idSet = new Set\(ids\)/);
  assert.match(workspaceSource, /idSet\.has\(id\)/);
  assert.match(workspaceSource, /row\.status === "inactive"/);
  assert.match(workspaceSource, /masterVisibleInventory/);
  assert.match(workspaceSource, /TEXTBOOK_RESULTS_CLASS_NAME/);
  assert.doesNotMatch(workspaceSource, /document\.addEventListener\("pointerdown", closeFromNativeEvent, true\)/);
  assert.match(workspaceSource, /window\.setTimeout\(\(\) => setMasterDialogOpen\(false\), 0\)/);
  assert.match(workspaceSource, /\{masterDialogOpen \? \(/);
  assert.match(workspaceSource, /조건에 맞는 교재가 없습니다/);
  assert.match(workspaceSource, /getTextbookIdentityLabel/);
  assert.match(workspaceSource, /aria-label=\{`\$\{rowA11yLabel\} 선택`\}/);
  assert.doesNotMatch(workspaceSource, /aria-label=\{`\$\{getTextbookTitle\(row\)\} \$\{getPublisherLabel\(row\)\} \$\{rowId\} 선택`\}/);
  assert.match(workspaceSource, /onBulkSelectionChange/);
  assert.match(workspaceSource, /categoryOptions=\{bulkCategoryOptions\}/);
  assert.match(workspaceSource, /schoolLevels: null as string\[\] \| null/);
  assert.match(workspaceSource, /gradeLevels: null as string\[\] \| null/);
  assert.match(workspaceSource, /patch\.schoolLevels !== null/);
  assert.match(workspaceSource, /patch\.gradeLevels !== null/);
  assert.match(workspaceSource, /학교·학년 변경/);
  assert.match(workspaceSource, /onTaxonomyEnabledChange/);
  assert.match(workspaceSource, /onSchoolLevelChange/);
  assert.match(workspaceSource, /onGradeLevelChange/);
  assert.match(workspaceSource, /publisherOptions=\{publisherGroupOptions\}/);
  assert.match(workspaceSource, /SearchCombobox[\s\S]*ariaLabel="일괄 세부과목"/);
  assert.match(serviceSource, /deleteTextbookMasters/);
  assert.match(serviceSource, /TEXTBOOK_MASTER_REFERENCE_TABLES/);
  assert.match(serviceSource, /collectReferencedTextbookIds/);
  assert.match(serviceSource, /\{ table: "textbook_stock_moves", column: "textbook_id" \}/);
  assert.match(serviceSource, /\.from\(table\)[\s\S]*\.select\(column\)[\s\S]*\.in\(column, ids\)/);
  assert.match(serviceSource, /const archivedIds = ids\.filter\(\(id\) => referencedIds\.has\(id\)\)/);
  assert.match(serviceSource, /\.from\("textbooks"\)[\s\S]*\.update\(\{[\s\S]*status: "inactive"/);
  assert.match(serviceSource, /\.from\("textbooks"\)[\s\S]*\.delete\(\)[\s\S]*\.in\("id", deletedIds\)/);
  assert.match(workspaceSource, /deleteResult/);
  assert.match(workspaceSource, /삭제하거나 미사용으로 전환/);
});

test("textbook workspace follows request order receipt and issue process", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");

  assert.match(workspaceSource, /TabsTrigger value="requests"[\s\S]*요청/);
  assert.match(workspaceSource, /TabsTrigger value="purchase"[\s\S]*주문·입고/);
  assert.match(workspaceSource, /requestStage/);
  assert.match(workspaceSource, /requestedTextbookTitle/);
  assert.match(workspaceSource, /requestedQuantity/);
  assert.match(workspaceSource, /requestBy/);
  assert.match(workspaceSource, /출고 대기/);
  assert.match(workspaceSource, /출고 완료/);
  assert.match(workspaceSource, /출고 대기 저장/);
  assert.match(workspaceSource, /출고/);
  assert.match(workspaceSource, /updateSaleLineStatus/);
  assert.match(workspaceSource, /메이크에듀 청구 준비/);
  assert.doesNotMatch(workspaceSource, /납부/);
  assert.doesNotMatch(workspaceSource, /SelectItem value="issued">/);
  assert.match(serviceSource, /buildPurchaseLifecycleDraft/);
  assert.match(serviceSource, /updateSaleLineStatus/);
});

test("textbook workspace manages teacher copies across purchase, issue, and stock", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");
  const ledgerSource = await readFile(new URL("src/features/textbooks/textbook-ledger.js", root), "utf8");

  assert.match(workspaceSource, /copyScope/);
  assert.match(workspaceSource, /학생용/);
  assert.match(workspaceSource, /교사용/);
  assert.match(workspaceSource, /teacherName/);
  assert.match(workspaceSource, /createTeacherTextbookIssue/);
  assert.match(workspaceSource, /getTextbookCopyScopeLabel/);
  assert.match(workspaceSource, /copy_scope/);
  assert.match(serviceSource, /createTeacherTextbookIssue/);
  assert.match(serviceSource, /copy_scope: copyScope/);
  assert.match(ledgerSource, /buildTeacherTextbookIssueDraft/);
  assert.match(ledgerSource, /teacherQuantity/);
});

test("textbook purchase workflow links registered title requests before ordering", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");

  assert.match(workspaceSource, /const selectedPurchaseTextbook = explicitlySelectedPurchaseTextbook/);
  assert.match(workspaceSource, /function getPurchaseLineTextbookId\(line: Row, references\?: TextbookPurchaseCaseRow\["references"\]\)/);
  assert.match(workspaceSource, /textbookId: getPurchaseLineTextbookId\(scopeLine, detail\.references\) \|\| text\(movePayload\.textbookId\)/);
  assert.doesNotMatch(workspaceSource, /purchaseForm\.requestStage === "request" && hasManualPurchaseCatalogMatch/);
  assert.match(workspaceSource, /getConfiguredTextbookPurchaseUnitCost\([\s\S]*purchaseCopyScope[\s\S]*\)/);
  assert.match(serviceSource, /resolvePurchaseLifecycleTextbook/);
  assert.match(serviceSource, /resolveTextbookReference\([\s\S]*activeOnly: false, scope: "request"/);
  const resolver = serviceSource.slice(serviceSource.indexOf("async function resolvePurchaseLifecycleTextbook"), serviceSource.indexOf("export async function listTextbookOperationsData"));
  assert.doesNotMatch(resolver, /\.from\("textbooks"\)/);
});

test("textbook workspace exports supplier orders and MakeEdu billing handoffs", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /captureElementAsPngBlob/);
  assert.match(workspaceSource, /downloadBlob/);
  assert.match(workspaceSource, /function TextbookHandoffDialog/);
  assert.match(handoffModelSource, /function buildPurchaseSupplierHandoffGroups/);
  assert.match(handoffModelSource, /function buildMakeEduBillingHandoffGroups/);
  assert.match(workspaceSource, /공급처별 주문 전달 열기/);
  assert.match(workspaceSource, /메이크에듀 청구 준비 열기/);
  assert.match(workspaceSource, /전체 복사/);
  assert.match(workspaceSource, /이미지/);
  assert.match(workspaceSource, /PDF/);
  assert.match(handoffModelSource, /수납명:/);
  assert.match(handoffModelSource, /수납시작:/);
  assert.match(handoffModelSource, /반복: 1회/);
  assert.match(workspaceSource, /downloadHandoffImage/);
  assert.match(workspaceSource, /downloadHandoffPdf/);
  assert.match(handoffModelSource, /getSupplierContact/);
  assert.match(workspaceSource, /getStudentGradeLabel/);
  assert.doesNotMatch(workspaceSource, /syncMakeEduTextbookPayments/);
  assert.doesNotMatch(workspaceSource, /makeEduImportDialogOpen/);
});

test("textbook handoff exports use a printable capture target instead of the scroll shell", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /getHandoffCaptureElement/);
  assert.match(workspaceSource, /data-handoff-capture-target/);
  assert.match(workspaceSource, /data-handoff-print-root/);
  assert.match(workspaceSource, /data-handoff-scroll/);
  assert.match(workspaceSource, /downloadHandoffPdf\(getHandoffCaptureElement\(allDomId\)/);
  assert.match(workspaceSource, /downloadHandoffImage\(getHandoffCaptureElement\(allDomId\)/);
  assert.match(workspaceSource, /downloadHandoffImage\(getHandoffCaptureElement\(groupDomId\)/);
});

test("textbook handoff keeps text copy only for non-document handoffs", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const copySource = workspaceSource.slice(
    workspaceSource.indexOf("async function writeClipboardText"),
    workspaceSource.indexOf("async function downloadHandoffImage"),
  );

  assert.match(copySource, /try \{\s*await navigator\.clipboard\.writeText\(value\);\s*return;\s*\} catch/);
  assert.match(copySource, /const copied = document\.execCommand\("copy"\)/);
  assert.match(copySource, /if \(!copied\) \{/);
  assert.match(copySource, /throw new Error\("클립보드 권한이 없어 복사하지 못했습니다\."\)/);
  assert.match(workspaceSource, /const \[manualCopyText, setManualCopyText\] = useState\(""\)/);
  assert.match(workspaceSource, /manualCopyTextareaRef/);
  assert.match(workspaceSource, /자동 복사가 제한되어 메시지를 선택했습니다./);
  assert.match(workspaceSource, /aria-label="복사할 청구 메시지"/);
  assert.match(workspaceSource, /const allowsTextCopy = !isPurchaseDocument/);
  assert.match(workspaceSource, /allowsTextCopy \? \(/);
  assert.match(workspaceSource, /전체 이미지/);
  assert.match(workspaceSource, /전체 문서 저장 메뉴/);
});

test("purchase supplier handoff is a location-first supplier order sheet with direct file exports", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const imageExportSource = await readFile(new URL("src/lib/export-as-image.ts", root), "utf8");
  const messageSource = handoffModelSource.slice(
    handoffModelSource.indexOf("function buildPurchaseSupplierMessage"),
    handoffModelSource.indexOf("function buildMakeEduBillingMessage"),
  );
  const handoffSource = handoffModelSource.slice(
    handoffModelSource.indexOf("function buildPurchaseSupplierHandoffGroups"),
    handoffModelSource.indexOf("function buildMakeEduBillingHandoffGroups"),
  );
  const dialogSource = workspaceSource.slice(
    workspaceSource.indexOf("function TextbookHandoffDialog"),
    workspaceSource.indexOf("function SearchCombobox"),
  );

  assert.match(workspaceSource, /captureElementAsPdfBlob/);
  assert.match(imageExportSource, /export async function captureElementAsPdfBlob/);
  assert.match(imageExportSource, /new Blob\(\[pdfBytes\], \{ type: "application\/pdf" \}\)/);
  assert.match(dialogSource, /format = "default"/);
  assert.match(dialogSource, /format === "purchase-order"/);
  assert.match(dialogSource, /const allowsTextCopy = !isPurchaseDocument/);
  assert.match(dialogSource, />교재명</);
  assert.match(dialogSource, /rowSpan=\{2\}/);
  assert.match(dialogSource, /colSpan=\{2\}/);
  assert.match(dialogSource, /getPurchaseOrderLocations\(group\)/);
  assert.match(dialogSource, /getLocationQuantityForLine\(line, locationLabel\)/);
  assert.match(dialogSource, />학생용</);
  assert.match(dialogSource, />교사용</);
  assert.match(dialogSource, />매입 단가</);
  assert.match(dialogSource, /format === "purchase-return" \? "반품 금액" : "주문 금액"/);
  assert.doesNotMatch(dialogSource, /<TableHead[^>]*>출판사<\/TableHead>/);
  assert.match(dialogSource, /downloadHandoffImage\(getHandoffCaptureElement\(groupDomId\), filename, signal\)/);
  assert.match(dialogSource, /downloadHandoffPdf\(getHandoffCaptureElement\(groupDomId\), filename, signal\)/);
  assert.match(dialogSource, /"이미지 저장됨"/);
  assert.match(dialogSource, /"PDF 저장됨"/);
  assert.match(dialogSource, /preparedDownload/);
  assert.match(dialogSource, /download=\{preparedDownload\.filename\}/);
  assert.match(dialogSource, /파일 준비됨/);
  assert.doesNotMatch(dialogSource, /printHandoffElement/);
  assert.match(messageSource, /위치:/);
  assert.match(messageSource, /교재:/);
  assert.match(messageSource, /출판사:/);
  assert.match(messageSource, /학생용/);
  assert.match(messageSource, /교사용/);
  assert.match(messageSource, /매입단가:/);
  assert.match(messageSource, /주문금액:/);
  assert.match(messageSource, /총 주문금액/);
  assert.match(handoffSource, /getPurchaseSupplierHandoffLocationLabel\(line\.locationScopeQuantities\)/);
  assert.match(handoffSource, /getPurchaseSupplierHandoffLocationQuantities\(line\.locationScopeQuantities\)/);
});

test("purchase supplier handoff renders as a dated order document with academy footer", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const dialogSource = workspaceSource.slice(
    workspaceSource.indexOf("function TextbookHandoffDialog"),
    workspaceSource.indexOf("function SearchCombobox"),
  );
  const messageSource = handoffModelSource.slice(
    handoffModelSource.indexOf("function buildPurchaseSupplierMessage"),
    handoffModelSource.indexOf("function buildMakeEduBillingMessage"),
  );

  assert.match(handoffModelSource, /const TEXTBOOK_HANDOFF_BUSINESS_NAME = "TIPS 영어수학학원"/);
  assert.match(handoffModelSource, /function formatKoreanDocumentDate/);
  assert.match(handoffModelSource, /function getTextbookHandoffDocumentMeta/);
  assert.match(dialogSource, /문서일자/);
  assert.match(dialogSource, /내용/);
  assert.match(dialogSource, /발신/);
  assert.match(dialogSource, /TEXTBOOK_HANDOFF_BUSINESS_NAME/);
  assert.match(handoffModelSource, /documentTitle: "주문서"/);
  assert.match(messageSource, /documentMeta\.documentTitle/);
  assert.match(messageSource, /문서일자:/);
  assert.match(messageSource, /내용: 교재 주문 요청/);
  assert.match(messageSource, /발신: \$\{TEXTBOOK_HANDOFF_BUSINESS_NAME\}/);
});

test("purchase process exposes supplier return requests opposite the order handoff", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const returnHandoffSource = handoffModelSource.slice(
    handoffModelSource.indexOf("function buildPurchaseSupplierReturnHandoffGroups"),
    handoffModelSource.indexOf("function buildMakeEduBillingHandoffGroups"),
  );
  const tableSource = workspaceSource.slice(workspaceSource.indexOf("function PurchaseProcessTable"));

  assert.match(readTypesSource, /type PurchaseOrderFilter = "all" \| "waiting" \| "partial" \| "returnable" \| "returned"/);
  assert.match(workspaceSource, /returnable: "반품 가능"/);
  assert.match(workspaceSource, /returned: "반품 완료"/);
  assert.match(workspaceSource, /const \[returnHandoffDialogOpen, setReturnHandoffDialogOpen\] = useState\(false\)/);
  assert.match(handoffModelSource, /function buildPurchaseSupplierReturnMessage/);
  assert.match(handoffModelSource, /function buildPurchaseSupplierReturnHandoffGroups/);
  assert.match(returnHandoffSource, /status !== "received" && status !== "partially_received"/);
  assert.match(returnHandoffSource, /const quantity = Math\.max\(0, receivedQuantity\)/);
  assert.match(returnHandoffSource, /반품 요청서/);
  assert.match(tableSource, /returnHandoffGroups/);
  assert.match(tableSource, /공급처 반품 요청서 열기/);
  assert.match(tableSource, /반품 요청서/);
  assert.match(tableSource, /format="purchase-return"/);
  assert.match(tableSource, /displayedFilter === "returnable"/);
  assert.match(tableSource, /displayedFilter === "returned"/);
});

test("textbook workspace keeps purchase and sale cases in grouped process tables", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");
  const ledgerSource = await readFile(new URL("src/features/textbooks/textbook-ledger.js", root), "utf8");

  assert.match(workspaceSource, /PurchaseProcessTable/);
  assert.match(workspaceSource, /SalesProcessTable/);
  assert.match(workspaceSource, /data-testid="textbook-purchase-process-mobile-list"/);
  assert.match(workspaceSource, /data-testid="textbook-sales-process-mobile-list"/);
  assert.match(workspaceSource, /<DataTableViewport/);
  assert.match(workspaceSource, /DATA_TABLE_LAYOUT_CLASS_NAME/);
  assert.match(workspaceSource, /className=\{mode === "request" \? "w-full min-w-\[812px\] table-fixed" : "w-full min-w-\[1188px\] table-fixed"\}/);
  assert.doesNotMatch(workspaceSource, /ProcessEmptyState/);
  assert.doesNotMatch(workspaceSource, /표시할 교재가 없습니다/);
  assert.match(workspaceSource, /selectedPurchaseLineId/);
  assert.match(workspaceSource, /selectPurchaseLine/);
  assert.match(workspaceSource, /resetPurchaseForm/);
  assert.match(workspaceSource, /onSelectLine/);
  assert.match(workspaceSource, /진행상태/);
  assert.match(workspaceSource, /TabsTrigger value="sales"[\s\S]*출고/);
  assert.match(workspaceSource, /updatePurchaseLifecycle/);
  assert.match(workspaceSource, /groupPurchaseLinesByStatus/);
  assert.match(workspaceSource, /groupSaleLinesByStatus/);
  assert.doesNotMatch(workspaceSource, /DndContext/);
  assert.doesNotMatch(workspaceSource, /useDraggable/);
  assert.doesNotMatch(workspaceSource, /useDroppable/);
  assert.doesNotMatch(workspaceSource, /RecentPurchaseTable/);
  assert.doesNotMatch(workspaceSource, /RecentSalesTable/);
  assert.match(serviceSource, /updatePurchaseLifecycle/);
  assert.match(ledgerSource, /groupPurchaseLinesByStatus/);
  assert.match(ledgerSource, /groupSaleLinesByStatus/);
});

test("textbook workspace removes external payment sync from the issue flow", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");
  const ledgerSource = await readFile(new URL("src/features/textbooks/textbook-ledger.js", root), "utf8");

  assert.match(workspaceSource, /useAuth/);
  assert.match(workspaceSource, /const \{ user, role, loading \} = useAuth\(\)/);
  assert.match(workspaceSource, /if \(loading \|\| !user\?\.id \|\| !role\)/);
  assert.match(workspaceSource, /onUpdateStatus\(line, "issued"\)/);
  assert.match(workspaceSource, /status !== "issued" && status !== "cancelled" && status !== "returned"/);
  assert.doesNotMatch(workspaceSource, /makeEduImportDialogOpen/);
  assert.doesNotMatch(workspaceSource, /parseMakeEduPaymentWorkbook/);
  assert.doesNotMatch(workspaceSource, /unzipSync/);
  assert.doesNotMatch(workspaceSource, /buildMakeEduPaymentImportPlan/);
  assert.doesNotMatch(workspaceSource, /syncMakeEduTextbookPayments/);
  assert.doesNotMatch(workspaceSource, /makeEduPaymentImports=\{data\.makeEduPaymentImports\}/);
  assert.doesNotMatch(workspaceSource, /메이크에듀 엑셀/);
  assert.doesNotMatch(workspaceSource, /MakeEdu 입력 복사/);
  assert.doesNotMatch(workspaceSource, /미매칭 청구 생성/);
  assert.doesNotMatch(workspaceSource, /수납 저장/);
  assert.doesNotMatch(serviceSource, /syncMakeEduTextbookPayments/);
  assert.doesNotMatch(serviceSource, /createMakeEduImportCharges/);
  assert.doesNotMatch(serviceSource, /textbook_makeedu_payment_imports/);
  assert.doesNotMatch(serviceSource, /makeedu_payment_status/);
  assert.doesNotMatch(ledgerSource, /buildMakeEduPaymentImportPlan/);
  assert.doesNotMatch(ledgerSource, /postpaidIssuedRows/);
});

test("purchase process table supports grouped movement, modal edits, deletion, and completed aging", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");

  assert.match(workspaceSource, /PurchaseProcessTable/);
  assert.match(workspaceSource, /collapsedGroups/);
  assert.match(workspaceSource, /toggleGroup/);
  assert.match(workspaceSource, /purchaseNextStatus/);
  assert.match(workspaceSource, /진행상태/);
  assert.match(workspaceSource, /총판/);
  assert.match(workspaceSource, /purchaseDialogOpen/);
  assert.match(workspaceSource, /onAddLine/);
  assert.match(workspaceSource, /요청 추가/);
  assert.doesNotMatch(workspaceSource, /onSaveLine/);
  assert.doesNotMatch(workspaceSource, /handlePurchaseDragEnd/);
  assert.match(workspaceSource, /onDeleteLine/);
  assert.match(workspaceSource, /purchaseBoardScope/);
  assert.doesNotMatch(workspaceSource, /function shouldShowPurchaseLineOnBoard/);
  assert.match(workspaceSource, /const preparedPurchaseRows = useMemo\(\(\) => \[\.\.\.numbered\.requests\.rows, \.\.\.numbered\.purchase\.rows\]/);
  assert.match(workspaceSource, /DATA_TABLE_LAYOUT_CLASS_NAME/);
  assert.match(workspaceSource, /aria-label="교재 요청 추가"[\s\S]*onClick=\{onAddLine\}/);
  assert.match(workspaceSource, /mode === "request" \? "w-full min-w-\[812px\] table-fixed" : "w-full min-w-\[1188px\] table-fixed"/);
  assert.match(workspaceSource, /aria-label=\{\`\$\{group\.title\} 그룹 \$\{collapsed \? "펼치기" : "접기"\}\`\}/);
  assert.match(workspaceSource, /!collapsed && rows\.length > 0/);
  assert.match(serviceSource, /deletePurchaseLifecycle/);
});

test("textbook process supports pre-cancel and post-return actions", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");
  const ledgerSource = await readFile(new URL("src/features/textbooks/textbook-ledger.js", root), "utf8");

  assert.match(workspaceSource, /selectedReturnablePurchaseLines/);
  assert.match(workspaceSource, /selectedReturnableSaleLines/);
  assert.match(workspaceSource, /selectedDeletableSaleLines/);
  assert.match(workspaceSource, /textbookHistoryDeleteAdminEmails = new Set\(\["yeoyuasset@naver\.com"\]\)/);
  assert.match(workspaceSource, /const canDeleteTextbookHistory =/);
  assert.match(workspaceSource, /textbookHistoryDeleteAdminEmails\.has\(currentUserEmail\)/);
  assert.match(workspaceSource, /onBulkReturn/);
  assert.match(workspaceSource, /onBulkCancel/);
  assert.match(workspaceSource, /onBulkDelete=\{deleteSelectedSaleHistoryLines\}/);
  assert.match(workspaceSource, /onCancelLine/);
  assert.match(workspaceSource, /onReturnLine/);
  assert.match(workspaceSource, /onDeleteLine=\{deleteSaleLine\}/);
  assert.match(workspaceSource, /function deleteSelectedSaleHistoryLines/);
  assert.match(workspaceSource, /선택 출고 이력 삭제/);
  assert.match(workspaceSource, /표시된 출고 이력 전체 선택/);
  assert.match(workspaceSource, /출고 이력을 삭제했습니다/);
  assert.match(serviceSource, /returnPurchaseLifecycle/);
  assert.match(serviceSource, /deleteSaleLineLifecycle/);
  assert.match(serviceSource, /move_type: "return_out"/);
  assert.match(ledgerSource, /target === "returned"/);
  assert.match(ledgerSource, /move_type: "return_in"/);
});

test("purchase request tab accepts unregistered textbook titles before management ordering", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");
  const migrationSource = await readFile(
    new URL("supabase/migrations/20260430150000_textbook_purchase_request_free_title.sql", root),
    "utf8",
  );

  assert.match(workspaceSource, /openNewRequestDialog/);
  assert.match(workspaceSource, /mode="request"/);
  assert.match(workspaceSource, /mode="order"/);
  assert.match(workspaceSource, /explicitPurchaseTextbookId/);
  assert.match(workspaceSource, /등록 교재 선택 해제/);
  assert.match(workspaceSource, /purchaseRequestInputMode/);
  assert.match(workspaceSource, /purchaseRequestUsesCatalog/);
  assert.match(workspaceSource, /aria-label="요청 교재 입력 방식"/);
  assert.match(workspaceSource, /purchaseRequestUsesCatalog \? \(/);
  assert.match(workspaceSource, /setPurchaseRequestInputMode\("manual"\)/);
  assert.doesNotMatch(workspaceSource, /등록교재 우선 · 없으면 직접 입력/);
  const requestDialogSource = workspaceSource.slice(
    workspaceSource.indexOf("{purchaseForm.requestStage === \"request\" ? ("),
    workspaceSource.indexOf("purchaseForm.requestStage !== \"request\" && purchaseForm.requestedTextbookTitle"),
  );
  assert.match(requestDialogSource, /<div className="grid gap-4 sm:grid-cols-2">/);
  assert.match(requestDialogSource, /<Field label="수업">[\s\S]*<Field label="학생용 요청">[\s\S]*<Field label="교사용 요청">[\s\S]*<Field label="선생님">/);
  assert.match(requestDialogSource, /<div>\s*<Field label="위치">/);
  assert.doesNotMatch(requestDialogSource, /sm:col-span-2"><Field label="교재명" required/);
  assert.match(workspaceSource, /<Field label="선생님">/);
  assert.match(workspaceSource, /ariaLabel="선생님 선택"/);
  assert.match(workspaceSource, /textbookId: selectedPurchaseTextbookId/);
  assert.match(workspaceSource, /aria-label="요청 교재명"/);
  assert.match(workspaceSource, /getRequestedTextbookTitle/);
  assert.match(workspaceSource, /getPurchaseTextbookTitle/);
  assert.match(workspaceSource, /openMasterFromPurchaseRequest/);
  assert.match(workspaceSource, /requestFilter=\{purchaseRequestFilter\}/);
  assert.match(workspaceSource, /onRequestFilterChange=\{setPurchaseRequestFilter\}/);
  assert.match(workspaceSource, /const requestFilterOptions = useMemo/);
  assert.match(workspaceSource, /const isMissingTextbookRequest = status === "requested" && !textbook/);
  assert.match(workspaceSource, /mode === "order" && isMissingTextbookRequest/);
  assert.match(workspaceSource, /마스터 등록/);
  assert.match(workspaceSource, /buildKyoboSearchUrl/);
  assert.match(workspaceSource, /교보 검색/);
  assert.match(workspaceSource, /const displayActionableLineIds = displayLineIds\.filter/);
  assert.match(serviceSource, /requested_textbook_title: requestedTextbookTitle/);
  assert.match(serviceSource, /요청 교재명을 입력하세요/);
  assert.match(serviceSource, /주문할 등록 교재를 선택하세요/);
  assert.match(migrationSource, /add column if not exists requested_textbook_title text not null default ''/);
  assert.match(migrationSource, /alter column textbook_id drop not null/);
});

test("purchase requester is selected from teacher catalogs", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");

  assert.match(serviceSource, /teacher_catalogs/);
  assert.match(serviceSource, /teacherCatalogs/);
  assert.match(workspaceSource, /teacherCatalogs/);
  assert.match(workspaceSource, /TeacherSelect/);
  assert.doesNotMatch(workspaceSource, /<Field label="요청자">\s*<Input value=\{purchaseForm\.requestBy\}/);
});

test("purchase requests keep class linkage without roster-based judgments", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");
  const migrationSource = await readFile(
    new URL("supabase/migrations/20260429110000_textbook_management.sql", root),
    "utf8",
  );

  assert.match(workspaceSource, /classId/);
  assert.doesNotMatch(workspaceSource, /purchaseClassStudentCount/);
  assert.doesNotMatch(workspaceSource, /getPurchaseQuantityClassFit/);
  assert.match(workspaceSource, /<ClassSelect value=\{purchaseForm\.classId\} serverState=\{referenceData\.classOptions\}/);
  assert.doesNotMatch(workspaceSource, /학생 \$\{formatQuantity\(purchaseClassStudentCount\)\}명/);
  assert.match(serviceSource, /class_id: normalizeOptionalUuid\(record\.classId/);
  assert.match(migrationSource, /class_id uuid references public\.classes\(id\) on delete set null/);
});

test("purchase form shows only the fields needed for the selected process stage", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /getPurchaseFieldVisibility/);
  assert.match(workspaceSource, /purchaseForm\.requestStage === "request"/);
  assert.match(workspaceSource, /requestedTextbookTitle/);
  assert.match(workspaceSource, /purchaseFieldVisibility\.requester/);
  assert.match(workspaceSource, /purchaseFieldVisibility\.location/);
  assert.match(workspaceSource, /purchaseFieldVisibility\.requestedQuantity/);
  assert.match(workspaceSource, /purchaseFieldVisibility\.orderedQuantity/);
  assert.match(workspaceSource, /purchaseFieldVisibility\.receivedQuantity/);
  assert.match(workspaceSource, /purchaseFieldVisibility\.statementNumber/);
  assert.doesNotMatch(workspaceSource, /purchaseFieldVisibility\.classFit/);
  assert.match(workspaceSource, /\{purchaseFieldVisibility\.location \? \(/);
  assert.match(workspaceSource, /configuredPurchaseSupplierId/);
  assert.match(workspaceSource, /configuredPurchaseUnitCost/);
  assert.doesNotMatch(workspaceSource, /purchaseFieldVisibility\.supplier/);
  assert.doesNotMatch(workspaceSource, /purchaseFieldVisibility\.unitCost/);
  assert.doesNotMatch(workspaceSource, /setPurchaseField\("supplierId"/);
  assert.doesNotMatch(workspaceSource, /setPurchaseField\("unitCost"/);
});

test("purchase order stage keeps request details editable before supplier ordering", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const visibilitySource = workspaceSource.slice(
    workspaceSource.indexOf("function getPurchaseFieldVisibility"),
    workspaceSource.indexOf("function getPurchaseDisplayScopeQuantity"),
  );
  const dialogSource = workspaceSource.slice(
    workspaceSource.indexOf("function TextbookOperationsWorkspace"),
    workspaceSource.indexOf("function PurchaseBulkOrderDialog"),
  );

  assert.match(visibilitySource, /requester: normalizedStage === "request" \|\| normalizedStage === "order"/);
  assert.match(visibilitySource, /location: normalizedStage === "request" \|\| normalizedStage === "order" \|\| normalizedStage === "receive"/);
  assert.match(visibilitySource, /requestedQuantity: normalizedStage === "request" \|\| normalizedStage === "order"/);
  assert.doesNotMatch(visibilitySource, /classFit: normalizedStage === "request" \|\| normalizedStage === "order"/);
  assert.match(dialogSource, /purchaseForm\.requestStage !== "request" && \(purchaseFieldVisibility\.requester \|\| purchaseFieldVisibility\.location\)/);
  assert.match(dialogSource, /ariaLabel=\{purchaseForm\.requestStage === "order" \? "주문 요청자 선택" : "요청자 선택"\}/);
  assert.match(dialogSource, /ariaLabel=\{purchaseForm\.requestStage === "order" \? "주문 위치 선택" : "입고 위치 선택"\}/);
  assert.match(dialogSource, /<Field label="학생용 요청">[\s\S]*studentRequestedQuantity/);
  assert.match(dialogSource, /<Field label="교사용 요청">[\s\S]*teacherRequestedQuantity/);
});

test("class combobox can clear a selected class by selecting it again", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const comboboxSource = workspaceSource.slice(
    workspaceSource.indexOf("function SearchCombobox"),
    workspaceSource.indexOf("function TextbookSelect"),
  );
  const classSelectSource = workspaceSource.slice(
    workspaceSource.indexOf("function ClassSelect"),
    workspaceSource.indexOf("function TeacherSelect"),
  );

  assert.match(comboboxSource, /allowDeselect = false/);
  assert.match(comboboxSource, /onValueChange\(allowDeselect && option\.value === value \? "" : option\.value\)/);
  assert.match(classSelectSource, /allowDeselect=\{true\}/);
});

test("purchase process derives supplier and unit cost from settings and separates location", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const tableSource = workspaceSource.slice(workspaceSource.indexOf("function PurchaseProcessTable"));

  assert.match(workspaceSource, /getConfiguredSupplierIdForTextbook/);
  assert.match(handoffModelSource, /getPublisherIdForTextbook/);
  assert.match(handoffModelSource, /normalizeTextbookLookup/);
  assert.match(workspaceSource, /getTextbookTitle\(textbook\)/);
  assert.match(workspaceSource, /publisherSupplierLinks=\{\[\]\}/);
  assert.match(workspaceSource, /publishers=\{purchaseRendererData\.publishers\}/);
  assert.match(tableSource, /publisherSupplierLinks: Row\[\]/);
  assert.match(tableSource, /publishers: Row\[\]/);
  assert.match(tableSource, /const configuredSupplierId = getConfiguredSupplierIdForTextbook\(textbook, publisherSupplierLinks, publishers\) \|\| draft\.supplierId/);
  assert.match(tableSource, /const unitCost = getConfiguredTextbookPurchaseUnitCost\(textbook, configuredSupplierId, suppliers, draft\.unitCost, draft\.copyScope\)/);
  assert.match(tableSource, /<DataTableHeaderCell>\{mode === "order" \? "총판 · 단가" : "요청자"\}<\/DataTableHeaderCell>/);
  assert.match(tableSource, /<DataTableHeaderCell>수업 · 위치<\/DataTableHeaderCell>/);
  assert.match(tableSource, /<div className="text-xs tabular-nums text-muted-foreground">\{formatPurchaseUnitCost\(unitCost, textbook\)\}<\/div>/);
  assert.match(tableSource, /<div className="text-xs text-muted-foreground">\{locationName\}\{mode === "order" && draft\.requestBy/);
});

test("textbook workspace keeps purchase pricing without retired closing controls", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");

  assert.match(workspaceSource, /getConfiguredTextbookPurchaseUnitCost/);
  assert.match(workspaceSource, /applyConfiguredPurchasePricingToPayload/);
  assert.doesNotMatch(workspaceSource, /configuredPurchaseUnitMargin/);
  assert.doesNotMatch(workspaceSource, /saleProjectedMargin/);
  assert.doesNotMatch(workspaceSource, /selectedSaleUnitMargin/);
  assert.doesNotMatch(workspaceSource, /closingTeamMarginMetrics/);
  assert.doesNotMatch(workspaceSource, /<Metric label="마진" value=\{!closingPreview \? "—" : closingNeedsMemo \? "사유 필요" : formatCurrency\(closingPreview\.textbookMarginAmount\)\}/);
  assert.doesNotMatch(workspaceSource, /function ClosingDetailDialog/);
  assert.doesNotMatch(workspaceSource, /rows: ClosingMovementRow\[\]/);
  assert.doesNotMatch(workspaceSource, /const detailRows = rows/);
  assert.doesNotMatch(workspaceSource, /current: formatCurrency\(detailClosing\.textbookMarginAmount\), mismatch: closingMetricMismatches\.margin/);
  assert.doesNotMatch(workspaceSource, /label=\{`\$\{getSubjectLabel\(item\.team\)\}팀`\}/);
  assert.doesNotMatch(workspaceSource, /const closingTargetSubjects = closingForm\.subject === "all" \? \["all", "english", "math", "science"\] : \[closingForm\.subject\]/);
  assert.doesNotMatch(workspaceSource, /closingTargetSubjects\.map/);
  assert.doesNotMatch(workspaceSource, /<Metric label="저장" value=\{`\$\{formatQuantity\(closingTargetSubjects\.length\)\}건`\}/);
  assert.doesNotMatch(workspaceSource, /aria-label="월마감 추가"/);
  assert.doesNotMatch(workspaceSource, /DataTableDetailButton label=\{`\$\{closingA11yLabel\} 정산 상세 열기`\}/);
  assert.match(serviceSource, /suppliers: \(data\.suppliers \|\| \[\]\) as Row\[\]/);
  assert.match(serviceSource, /publisherSupplierLinks: \(data\.publisherSupplierLinks \|\| data\.publisher_supplier_links \|\| \[\]\) as Row\[\]/);
});

test("textbook workspace keeps each textbook workflow visually continuous", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /const includedSaleStudentCount = selectedClassStudents\s*\.filter/);
  assert.match(workspaceSource, /const purchaseProjectedLocationQuantity = purchaseForm\.requestStage === "receive"/);
  assert.match(workspaceSource, /const configuredPurchaseTotalCost = configuredPurchaseStudentUnitCost \* \(/);
  assert.match(workspaceSource, /const saleProjectedAmount = saleDraft\.totalAmount/);
  assert.match(workspaceSource, /const saleProjectedEndingQuantity = saleDraft\.availableQuantity - saleDraft\.totalQuantity/);
  assert.match(workspaceSource, /<Metric label="합계" value=\{configuredPurchaseTotalCost > 0 \? formatCurrency\(configuredPurchaseTotalCost\) : "-"\}/);
  assert.match(workspaceSource, /<Metric\s+label="입고 후"[\s\S]*purchaseProjectedLocationQuantity/);
  assert.match(workspaceSource, /<Metric label="대상" value=\{`\$\{formatQuantity\(includedSaleStudentCount\)\}명`\}/);
  assert.match(workspaceSource, /<Metric\s+label="출고 후"[\s\S]*saleProjectedEndingQuantity/);
  assert.match(workspaceSource, /<Metric label="청구" value=\{saleProjectedAmount > 0 \? formatCurrency\(saleProjectedAmount\) : "-"\}/);
  assert.match(workspaceSource, /showSavedPurchaseFlow\(completedPurchaseStage, completedPurchaseTitle, completedPurchaseHasCatalogTextbook\)/);
  assert.match(workspaceSource, /getSavedPurchaseRequestFilter\(stage, hasCatalogTextbook\)/);
  assert.match(workspaceSource, /getSavedPurchaseBoardScope\(stage\)/);
  assert.match(workspaceSource, /setSalesProcessFilter\("waiting"\)/);
  assert.match(workspaceSource, /setSalesProcessFilter\("issued"\)/);
  assert.doesNotMatch(workspaceSource, /setInventoryAuditFilter\("done"\)/);
});

test("purchase process resolves supplier links with fixed columns while shared settings remain available elsewhere", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const commonColumnSource = await readFile(
    new URL("src/components/data-table/data-table-columns.tsx", root),
    "utf8",
  );
  const managementColumnSource = await readFile(
    new URL("src/features/management/settings-table-columns.tsx", root),
    "utf8",
  );
  const supplierResolverSource = handoffModelSource.slice(
    handoffModelSource.indexOf("function getPublisherIdForTextbook"),
    handoffModelSource.indexOf("function getStudentNameById"),
  );
  const tableSource = workspaceSource.slice(workspaceSource.indexOf("function PurchaseProcessTable"));

  assert.match(supplierResolverSource, /textbook\.publisher_id \|\| textbook\.publisherId/);
  assert.match(supplierResolverSource, /getKnownPublisherLabel\(textbook\)/);
  assert.match(supplierResolverSource, /publishers\.find/);
  assert.match(workspaceSource, /configuredPurchaseSupplierId/);
  assert.doesNotMatch(tableSource, /buildPurchaseProcessColumns|useDataTableColumns|columnSettingsControl|isPurchaseColumnVisible/);
  assert.match(tableSource, /aria-colcount=\{mode === "request" \? 5 : 8 \+ Number\(showBulkPurchaseSelection\)\}/);
  assert.match(tableSource, /<DataTableHeaderCell>\{mode === "order" \? "총판 · 단가" : "요청자"\}<\/DataTableHeaderCell>/);
  assert.match(commonColumnSource, /export type DataTableColumn/);
  assert.match(commonColumnSource, /export function useDataTableColumns/);
  assert.match(commonColumnSource, /sanitizeVisibility\(columns, visibility\)/);
  assert.match(managementColumnSource, /useDataTableColumns as useSettingsTableColumns/);
});

test("selecting a class defaults requester to its teacher without locking the field", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /resolved\.defaultTeacherName/);
  assert.match(workspaceSource, /name === "classId"/);
  assert.match(workspaceSource, /const nextTeacher = resolved\.defaultTeacherName/);
  assert.match(workspaceSource, /const canSetTeacher = !current\.requestBy \|\| current\.requestBy === purchaseAutoDefaultsRef\.current\.requestBy/);
  assert.match(workspaceSource, /requestBy: canSetTeacher \? nextTeacher : current\.requestBy/);
  assert.match(workspaceSource, /const nextLocation = resolved\.inferredLocation\?\.id \|\| ""/);
  assert.match(workspaceSource, /ariaLabel=\{purchaseForm\.requestStage === "order" \? "주문 위치 선택" : "입고 위치 선택"\}/);
  assert.match(workspaceSource, /<TeacherSelect[\s\S]*onValueChange=\{\(value\) => setPurchaseField\("requestBy", value\)\}/);
});

test("purchase process rows stay database-style and open the modal for editing", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const tableSource = workspaceSource.slice(workspaceSource.indexOf("function PurchaseProcessTable"));

  assert.match(tableSource, /mode === "request" \? "w-full min-w-\[812px\] table-fixed" : "w-full min-w-\[1188px\] table-fixed"/);
  assert.match(tableSource, /<DataTableHeaderCell>\{mode === "order" \? "총판 · 단가" : "요청자"\}<\/DataTableHeaderCell>/);
  assert.match(tableSource, /<DataTableHeaderCell>수업 · 위치<\/DataTableHeaderCell>/);
  assert.match(tableSource, /buildPurchaseDisplayRows\(rows, ordersById, textbooks\)/);
  assert.match(tableSource, /getPurchaseDisplayScopeQuantity\(displayLines, "student", column\.kind\)/);
  assert.match(tableSource, /getPurchaseDisplayScopeQuantity\(displayLines, "teacher", column\.kind\)/);
  assert.match(tableSource, /수정/);
  assert.match(tableSource, /purchaseProcessAction\(status\)/);
  assert.match(tableSource, /onSelectLine\(line, order, processAction\.stage\)/);
  assert.match(tableSource, /processAction\?\.label \|\| "이동"/);
  assert.doesNotMatch(tableSource, /다음/);
  assert.match(tableSource, /합계/);
  assert.doesNotMatch(tableSource, /getPurchaseQuantityClassFit/);
  assert.doesNotMatch(tableSource, /aria-label="요청 수량"/);
  assert.doesNotMatch(tableSource, /<Select value=\{status\}/);
  assert.doesNotMatch(tableSource, /<TextbookSelect/);
  assert.doesNotMatch(tableSource, /<TeacherSelect/);
  assert.doesNotMatch(tableSource, /placeholder="거래명세표"/);
  assert.doesNotMatch(tableSource, /placeholder="메모"/);
  assert.doesNotMatch(tableSource, /PurchaseKanbanCard/);
});

test("purchase requests support bulk ordering with requested quantity defaults", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");
  const tableSource = workspaceSource.slice(workspaceSource.indexOf("function PurchaseProcessTable"));

  assert.match(workspaceSource, /selectedPurchaseLineIds/);
  assert.match(workspaceSource, /bulkOrderDialogOpen/);
  assert.match(workspaceSource, /selectedBulkOrderLines/);
  assert.match(workspaceSource, /title="선택 요청 일괄 주문"/);
  assert.match(workspaceSource, /선택한 요청을 공급처 주문 단계로 한꺼번에 전환합니다/);
  assert.match(workspaceSource, /function getPositivePurchaseQuantityText\(value: unknown\)/);
  assert.match(workspaceSource, /getPositivePurchaseQuantityText\(draft\.orderedQuantity\) \|\| draft\.requestedQuantity \|\| "1"/);
  assert.match(workspaceSource, /const orderedQuantity = normalizeQuantityInput\(bulkOrderQuantities\[lineId\]\) \|\| getPositivePurchaseQuantityText\(draft\.orderedQuantity\) \|\| draft\.requestedQuantity \|\| "1"/);
  assert.match(workspaceSource, /data-slot="bulk-order-editor"/);
  assert.match(workspaceSource, /<ul aria-label="일괄 주문 수량"/);
  assert.match(workspaceSource, /className="h-11 text-right tabular-nums sm:h-9"/);
  assert.match(workspaceSource, /const metadata = compactUniqueLabels\(\[scopeLabel, getPublisherLabel\(textbook \|\| \{\}\), text\(references\?\.class\?\.name\), text\(references\?\.location\?\.name\)\]\)/);
  assert.match(tableSource, /visiblePurchaseRows\.flatMap\(getPurchaseScopeLines\)/);
  assert.match(tableSource, /rows\.flatMap\(getPurchaseScopeLines\)/);
  assert.match(workspaceSource, /const nextOrderedQuantity = nextStage === "request" \? orderedQuantity : getPositivePurchaseQuantityText\(orderedQuantity\) \|\| primaryRequestedQuantity/);
  assert.match(workspaceSource, /<Metric label="요청" value=\{purchaseRequestedScopeSummary\}/);
  assert.match(tableSource, /일괄 처리 가능한 행 전체 선택/);
  assert.match(tableSource, /선택 주문/);
  assert.match(tableSource, /onToggleVisibleLines\?\.\(groupActionableLineIds, value === true\)/);
  assert.match(tableSource, /onToggleLine\?\.\(lineId, value === true\)/);
  assert.match(serviceSource, /created_by: createdBy/);
});

test("purchase order modal separates requested copy scope totals before ordering", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /function formatPurchaseScopeQuantityMetric\(studentQuantity: number, teacherQuantity: number\)/);
  assert.match(workspaceSource, /const purchaseRequestedScopeSummary = formatPurchaseScopeQuantityMetric\(purchaseStudentRequestedQuantity, purchaseTeacherRequestedQuantity\)/);
  assert.match(workspaceSource, /<Metric label="요청" value=\{purchaseRequestedScopeSummary\}/);
  assert.doesNotMatch(workspaceSource, /<Metric label="요청" value=\{`\$\{formatQuantity\(purchaseRequestedTotalQuantity\)\}권`\}/);
});

test("purchase supplier handoff excludes request-only rows and never falls back to requested quantity", async () => {
  const handoffSource = handoffModelSource.slice(
    handoffModelSource.indexOf("function buildPurchaseSupplierHandoffGroups"),
    handoffModelSource.indexOf("function buildMakeEduBillingHandoffGroups"),
  );

  assert.match(handoffSource, /if \(status !== "ordered" && status !== "partially_received"\) \{/);
  assert.match(handoffSource, /if \(orderedQuantity <= 0\) \{\s*continue;\s*\}/);
  assert.match(handoffSource, /const quantity = orderedQuantity;/);
  assert.doesNotMatch(handoffSource, /orderedQuantity \|\| requestedQuantity/);
});

test("purchase copy-scope actions identify student and teacher copies through order dialogs", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /<SelectItem value="request">요청 접수<\/SelectItem>/);
  assert.match(workspaceSource, /const scopeLabel = getTextbookCopyScopeLabel\(draft\.copyScope\)/);
  assert.match(workspaceSource, /compactUniqueLabels\(\[scopeLabel,/);
  assert.match(workspaceSource, /detail: \[[\s\S]*getTextbookCopyScopeLabel\(draft\.copyScope\),[\s\S]*statusLabel/);
  assert.match(handoffModelSource, /type PurchaseSupplierHandoffLineAccumulator/);
  assert.match(handoffModelSource, /lineAccumulators: new Map/);
  assert.match(handoffModelSource, /getPurchaseSupplierHandoffQuantityLabel\(line\.scopeQuantities\)/);
  assert.match(handoffModelSource, /학생용\/교사용/);
});

test("purchase order edits allow zero requested quantities for direct management orders", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(readModelSource, /function textPreservingZero/);
  assert.match(readModelSource, /function getRowFieldText/);
  assert.match(readModelSource, /const requested = getRowFieldText\(line, "requested_quantity", "requestedQuantity"\)/);
  assert.match(workspaceSource, /const requestedQuantity = getRowFieldText\(primaryLine, "requested_quantity", "requestedQuantity"\)/);
  assert.match(workspaceSource, /\(purchaseForm\.requestStage === "request" && !purchaseRequestedTotalQuantity && !selectedPurchaseLineId\)/);
  assert.doesNotMatch(workspaceSource, /\|\|\s*!purchaseRequestedTotalQuantity\s*\|\|/);
  assert.match(workspaceSource, /if \(stageQuantity <= 0 && purchaseForm\.requestStage !== "request"\) return \[\]/);
  assert.match(workspaceSource, /requestedQuantity: requestedQuantity \|\| \(purchaseForm\.requestStage === "request" \? orderedQuantity \|\| receivedQuantity \|\| "1" : "0"\)/);
});

test("purchase process grouped rows move and delete every copy-scope line together", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const tableSource = workspaceSource.slice(workspaceSource.indexOf("function PurchaseProcessTable"));

  assert.match(readModelSource, /function getPurchaseScopeLines\(line: Row\)/);
  assert.match(workspaceSource, /function readFreshPurchaseMembers/);
  assert.match(workspaceSource, /function movePurchaseLine[\s\S]*readFreshPurchaseMembers/);
  assert.match(workspaceSource, /details\.map\(\(detail\) => detail\.row/);
  assert.match(workspaceSource, /buildPurchaseStatusPayload\(scopeLine, scopeOrder, status\)/);
  assert.match(workspaceSource, /textbookId: getPurchaseLineTextbookId\(scopeLine, detail\.references\) \|\| text\(movePayload\.textbookId\)/);
  assert.match(workspaceSource, /function deletePurchaseLine[\s\S]*readFreshPurchaseMembers\(\[line\], mode\)[\s\S]*const scopeLines = detail\.lines/);
  assert.match(workspaceSource, /getPurchaseConfirmationItems\(scopeLine, \(scopeLine\.order as Row \| null\) \|\| order, detail\.references\)/);
  assert.match(workspaceSource, /textbookService\.deletePurchaseLifecycle\(\{[\s\S]*purchaseOrderLineId: getRecordId\(scopeLine\)/);
  assert.match(tableSource, /onSelect=\{\(\) => onDeleteLine\(\{ \.\.\.line, purchaseScopeLines: displayLines \}, order\)\}/);
});

test("purchase process keeps explicit copy scopes within three stage columns", async () => {
  const workspaceSource = await readFile(new URL("src/features/textbooks/textbook-operations-workspace.tsx", root), "utf8");
  const tableSource = workspaceSource.slice(workspaceSource.indexOf("function PurchaseProcessTable"), workspaceSource.indexOf("function SalesHistoryLedger"));
  const header = tableSource.slice(tableSource.indexOf("<TableHeader"), tableSource.indexOf("</TableHeader>"));
  assert.ok(header.indexOf('>교재</DataTableHeaderCell>') < header.indexOf('purchaseProcessQuantityColumns.filter'));
  assert.ok(header.indexOf('purchaseProcessQuantityColumns.filter') < header.indexOf('mode === "order" ? "총판 · 단가" : "요청자"'));
  assert.doesNotMatch(workspaceSource, /\{ id: "copyScope", label: "용도" \}/);
  assert.match(tableSource, /onDeleteLine\(\{ \.\.\.line, purchaseScopeLines: displayLines \}, order\)/);
  assert.match(tableSource, /aggregateGroup\?\.quantities\.student\[column\.kind\] \?\? null/);
  assert.match(tableSource, /aggregateGroup\?\.quantities\.teacher\[column\.kind\] \?\? null/);
});

test("textbook workspace fixes second-round browser audit issues", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /useState<PurchaseBoardScope>\(\(\) => \(text\(initialPrimaryFilters\.boardScope\) \|\| "active"\) as PurchaseBoardScope\)/);
  assert.match(workspaceSource, /resetTextbookListFilters/);
  assert.match(workspaceSource, /필터 초기화/);
  assert.match(workspaceSource, /masterDuplicateRows/);
  assert.match(workspaceSource, /이미 등록된 교재/);
  assert.match(workspaceSource, /저장 잠김/);
  assert.doesNotMatch(workspaceSource, /DialogClose/);
  assert.doesNotMatch(workspaceSource, /onPointerDown=\{\(event\) =>/);
  assert.doesNotMatch(workspaceSource, /event\.preventDefault\(\);[\s\S]*closePurchaseDialog\(\);/);
  assert.doesNotMatch(workspaceSource, /dialogFooterClassName/);
  assert.match(workspaceSource, /<FormDialogContent[\s\S]*onSubmit=\{submitMaster\}/);
  assert.match(workspaceSource, /cancelLabel="교재 등록 취소"/);
  assert.match(workspaceSource, /<FormDialogContent[\s\S]*onSubmit=\{submitPurchase\}/);
  assert.match(workspaceSource, /<FormDialogContent[\s\S]*onSubmit=\{submitSale\}/);
  assert.doesNotMatch(workspaceSource, /<form onSubmit=\{submitClosing\} className="grid min-w-0 max-w-full gap-3 \[\&>\*\]:min-w-0 \[\&>\*\]:max-w-full"/);
  assert.doesNotMatch(workspaceSource, /<form onSubmit=\{submitPurchase\} className="grid min-w-0 max-w-full gap-3 overflow-hidden/);
  assert.doesNotMatch(workspaceSource, /<form onSubmit=\{submitSale\} className="grid min-w-0 max-w-full gap-3 overflow-hidden/);
  assert.doesNotMatch(workspaceSource, /<form onSubmit=\{submitClosing\} className="grid min-w-0 max-w-full gap-3 overflow-hidden/);
  assert.doesNotMatch(workspaceSource, /showCloseButton=\{false\}/);
  assert.match(workspaceSource, /closeMasterDialog/);

  assert.match(workspaceSource, /onCancel=\{closeMasterDialog\}[\s\S]*cancelLabel="교재 등록 취소"/);
  assert.doesNotMatch(workspaceSource, /data-textbook-modal-dismiss="master"/);
  assert.match(workspaceSource, /closePurchaseDialog/);
  assert.match(workspaceSource, /onSetStatus/);
  assert.match(workspaceSource, /사용 전환/);
  assert.match(workspaceSource, /미사용 처리/);
  assert.match(workspaceSource, /aria-label="요청 메모"/);
  assert.match(workspaceSource, /전체 접기/);
  assert.match(workspaceSource, /전체 펼치기/);
  assert.match(workspaceSource, /required \? <span className="ml-1 text-destructive">\*<\/span>/);
  assert.doesNotMatch(workspaceSource, /선택한 교재를 편집합니다/);
  assert.doesNotMatch(workspaceSource, /선택한 건을 이어서 처리합니다/);
  assert.match(workspaceSource, /cancelLabel="교재 요청·주문 창 닫기"/);
});

test("inventory count is inline and monthly closing entry is retired", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.doesNotMatch(workspaceSource, /closingDialogOpen/);
  assert.doesNotMatch(workspaceSource, /DialogTitle>월마감<\/DialogTitle>/);
  assert.match(workspaceSource, /function InventoryCountWorkspace/);
  assert.match(workspaceSource, /function InventoryCountMobileCard/);
  assert.match(workspaceSource, /submitInlineStockCount/);
  assert.match(workspaceSource, /onSubmitCount=\{submitInlineStockCount\}/);
  assert.match(workspaceSource, /const acknowledgedRowIds = new Set\(acknowledged\.map\(\(snapshot\) => snapshot\.row\.id\)\)/);
  assert.match(workspaceSource, /!acknowledgedRowIds\.has\(id\)/);
  assert.doesNotMatch(workspaceSource, /!readyRows\.some\(\(row\) => row\.id === id\)/);
  assert.doesNotMatch(workspaceSource, /<Button type="button" onClick=\{openCountDialog\}>[\s\S]*실사 추가/);
  assert.doesNotMatch(workspaceSource, /월마감 추가/);
  assert.doesNotMatch(workspaceSource, /<TabsContent value="inventory" className="mt-4 grid min-w-0 gap-4">\s*<form/);
  assert.doesNotMatch(workspaceSource, /<TabsContent value="closing" className="mt-4 grid gap-4 xl:grid-cols/);
});

test("inventory tab shows stock change audit history", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");

  assert.match(workspaceSource, /function InventoryHistoryPanel/);
  assert.match(closingModelSource, /function buildTextbookLookupMap/);
  assert.match(closingModelSource, /function buildLocationNameLookup/);
  assert.match(workspaceSource, /rows=\{numbered\.inventoryHistory\.rows\}/);
  assert.match(workspaceSource, /function InventoryHistoryPanel/);
  assert.match(workspaceSource, /재고 이력/);
  assert.match(workspaceSource, /rows=\{numbered\.inventoryHistory\.rows\}/);
  assert.match(workspaceSource, /actor: row\.actorLabel \|\| \(row\.actorId === currentUserId \? currentUserLabel : row\.actorId\) \|\| "-"/);
  assert.match(workspaceSource, /row\.actor/);
  assert.match(workspaceSource, /currentUserLabel/);
  assert.match(workspaceSource, /actor: row\.actorLabel/);
  assert.match(workspaceSource, /canDeleteHistory=\{canDeleteTextbookHistory\}/);
  assert.match(workspaceSource, /aria-label=\{`\$\{row\.textbookTitle\} 재고 이력 삭제`\}/);
  assert.match(workspaceSource, /textbookService\.deleteInventoryHistory/);
  assert.match(workspaceSource, /textbookHistoryDeleteAdminEmails\.has\(currentUserEmail\)/);
  assert.match(workspaceSource, /canManageAll \|\|[\s\S]*isAdmin \|\|[\s\S]*role === "admin"/);
  assert.match(serviceSource, /export async function deleteInventoryHistory/);
});

test("inventory stock count is inline and mobile-first without audit classifications", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  const inventorySource = workspaceSource.slice(
    workspaceSource.indexOf("function InventoryCountWorkspace"),
    workspaceSource.indexOf("function InventoryCountMobileCard"),
  );
  const inventoryMobileSource = workspaceSource.slice(
    workspaceSource.indexOf("function InventoryCountMobileCard"),
    workspaceSource.indexOf("function TextbookTable"),
  );

  assert.match(readTypesSource, /type InventoryAuditFilter = "recommended" \| "pending" \| "done" \| "all"/);
  assert.match(workspaceSource, /inventoryCountDrafts/);
  assert.match(workspaceSource, /inventoryCountMemoDrafts/);
  assert.doesNotMatch(workspaceSource, /inventoryAuditFilter/);
  assert.match(readModelSource, /INVENTORY_COUNT_CYCLE_DAYS = 30/);
  assert.match(readModelSource, /INVENTORY_LOW_STOCK_THRESHOLD = 3/);
  assert.doesNotMatch(workspaceSource, /INVENTORY_COUNT_PAGE_SIZE/);
  assert.match(workspaceSource, /numbered\.inventory\.rows/);
  assert.match(workspaceSource, /function InventoryCountWorkspace/);
  assert.match(workspaceSource, /function InventoryCountMobileCard/);
  assert.match(workspaceSource, /function getInventoryCountReasonLabel/);
  assert.match(workspaceSource, /function getInventoryCountSubmitLabel/);
  assert.doesNotMatch(workspaceSource, /const visibleAuditFilterOptions = \(Object\.keys\(inventoryAuditFilterLabels\)/);
  assert.doesNotMatch(workspaceSource, /visibleAuditFilterOptions\.map/);
  assert.doesNotMatch(workspaceSource, /displayLimitsByScope|displayScopeKey/);
  assert.match(workspaceSource, /DataTablePagination/);
  assert.match(workspaceSource, /const selectedIdSet = useMemo\(\(\) => new Set\(selectedIds\), \[selectedIds\]\)/);
  assert.match(workspaceSource, /const visibleRows = rows/);
  assert.match(workspaceSource, /const displayRows = visibleRows/);
  assert.doesNotMatch(workspaceSource, /const groupsByLabel = new Map/);
  assert.doesNotMatch(workspaceSource, /usesDesktopInventoryTable/);
  assert.doesNotMatch(workspaceSource, /window\.matchMedia\("\(min-width: 640px\)"\)/);
  assert.match(workspaceSource, /DataTablePagination/);
  assert.doesNotMatch(workspaceSource, /setDisplayLimitsByScope/);
  assert.match(workspaceSource, /submitInlineStockCount/);
  assert.match(workspaceSource, /onSubmitCount=\{submitInlineStockCount\}/);
  assert.match(workspaceSource, /aria-label=\{`\$\{row\.title\} \$\{row\.locationName\} 실사 수량`\}/);
  assert.match(workspaceSource, /aria-label=\{`\$\{row\.title\} \$\{row\.locationName\} 실사 메모`\}/);
  assert.doesNotMatch(workspaceSource, /className="hidden overflow-x-auto rounded-lg border sm:block"/);
  assert.doesNotMatch(workspaceSource, /title=\{getInventoryCountReasonLabel\(row\)\}/);
  assert.doesNotMatch(inventorySource, /<DataTablePagination/);
  assert.match(inventorySource, /DATA_TABLE_MOBILE_LIST_CLASS_NAME/);
  assert.match(inventorySource, /<DataTableViewport/);
  assert.match(inventorySource, /getInventoryCountReasonLabel\(row\)/);
  assert.match(inventoryMobileSource, /<DataTableSelectionCheckbox/);
  assert.match(inventoryMobileSource, /<InventoryCountQuantityInput/);
  assert.match(inventoryMobileSource, /<InventoryCountSubmitButton/);
  assert.doesNotMatch(inventoryMobileSource, /active:scale/);
  assert.doesNotMatch(inventorySource, /groupQualityIssueCount/);
  assert.doesNotMatch(inventorySource, /정리 필요/);
  assert.match(workspaceSource, /aria-label=\{getInventoryCountSubmitLabel/);
  assert.match(workspaceSource, /실사 수량 입력 필요/);
  assert.match(workspaceSource, /실사 반영 불가/);
  assert.doesNotMatch(workspaceSource, /실사 수량을 입력하면 반영할 수 있습니다/);
  assert.doesNotMatch(workspaceSource, /월 1회 · 30일 경과 · 이력 없음/);
  assert.doesNotMatch(workspaceSource, /실사 권장/);
  assert.match(workspaceSource, /대기/);
  assert.match(workspaceSource, /완료/);
  assert.match(workspaceSource, /최종 실사/);
  assert.doesNotMatch(workspaceSource, /<Button type="button" onClick=\{openCountDialog\}>[\s\S]*실사 추가/);
});

test("textbook workspace surfaces real Supabase write errors during testing", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");

  assert.match(workspaceSource, /getTextbookActionErrorMessage/);
  assert.match(workspaceSource, /activePrimaryState\.error/);
  assert.match(workspaceSource, /actionErrorMessage/);
  assert.match(workspaceSource, /setActionErrorMessage\(getTextbookActionErrorMessage\(actionError\)\)/);
  assert.match(workspaceSource, /<ActionFeedback[\s\S]*message=\{actionErrorMessage \|\| message\}[\s\S]*error=\{Boolean\(actionErrorMessage\)\}/);
  assert.doesNotMatch(workspaceSource, /actionError instanceof Error \? actionError\.message : "처리 중 오류가 발생했습니다\."/);
  assert.match(serviceSource, /normalizeOptionalUuid/);
  assert.match(serviceSource, /normalizeOptionalUuid\(record\.locationId/);
});

test("textbook workspace blocks writes when operation tables are not migrated", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");

  assert.match(serviceSource, /missingTables/);
  assert.match(serviceSource, /isSchemaReady/);
  assert.match(workspaceSource, /schemaDisabled/);
  assert.doesNotMatch(workspaceSource, /schemaDisabled = false/);
  assert.match(workspaceSource, /isPreparedSchemaError/);
});

test("textbook service blocks writes when request title column is missing from schema cache", async () => {
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");
  const migrationSource = await readFile(
    new URL("supabase/migrations/20260430150000_textbook_purchase_request_free_title.sql", root),
    "utf8",
  );

  assert.match(serviceSource, /TEXTBOOK_PURCHASE_ORDER_LINE_SELECT/);
  assert.match(serviceSource, /requested_textbook_title/);
  assert.match(serviceSource, /isMissingColumnError/);
  assert.match(serviceSource, /getMissingColumnSchemaItem/);
  assert.match(serviceSource, /textbook_purchase_order_lines\.requested_textbook_title/);
  assert.match(serviceSource, /isMissingColumnError\(error\)[\s\S]*getMissingColumnSchemaItem\(table, columns, error\)[\s\S]*isMissingTableError\(error\)/);
  assert.match(serviceSource, /readTable\(client, "textbook_purchase_order_lines", TEXTBOOK_PURCHASE_ORDER_LINE_SELECT, missingTables\)/);
  assert.match(migrationSource, /notify pgrst, 'reload schema'/i);
});

test("textbook workspace puts pending work in workflow tabs without a duplicate task menu", async () => {
  const workspaceSource = await readFile(new URL("src/features/textbooks/textbook-operations-workspace.tsx", root), "utf8");
  assert.match(workspaceSource, /const operationMetrics = numbered\.operations\.value/);
  assert.match(workspaceSource, /value=\{operationMetrics\.requestCount\}/);
  assert.match(workspaceSource, /value=\{operationMetrics\.issueWaitingCount\}/);
  assert.doesNotMatch(workspaceSource, /TextbookOpsCommandCenter|openTextbookOpsQueue|operationQueueTotal|교재관리 할 일/);
});

test("textbook workspace improves operational empty states and modal accessibility", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  const dialogSource = await readFile(new URL("src/components/ui/form-dialog.tsx", root), "utf8");
  assert.match(dialogSource, /<DialogDescription[^>]*>\{description\}<\/DialogDescription>/);
  assert.match(workspaceSource, /교재명, 학년, 세부과목, 출판사, 판매가, ISBN, 바코드를 등록하거나 수정합니다/);
  assert.match(workspaceSource, /교재 요청, 주문, 입고 단계에 필요한 수량과 연결 정보를 저장합니다/);
  assert.match(workspaceSource, /출고 대기 내역을 생성합니다/);
  assert.match(workspaceSource, /function ProcessGroupEmptyState/);
  assert.match(workspaceSource, /getPurchaseProcessEmptyLabel/);
  assert.match(workspaceSource, /getSalesProcessEmptyLabel/);
  assert.match(workspaceSource, /미등록 요청이 없습니다/);
  assert.match(workspaceSource, /주문 가능한 요청이 없습니다/);
  assert.match(workspaceSource, /입고 대기 주문이 없습니다/);
  assert.match(workspaceSource, /출고 대기 건이 없습니다/);
  assert.match(workspaceSource, /busy=\{saving === "master"\}/);
  assert.match(workspaceSource, /busy=\{saving === "purchase"\}/);
  assert.match(workspaceSource, /busy=\{saving === "sale"\}/);
  assert.doesNotMatch(workspaceSource, /aria-busy=\{saving === "closing"\}/);
  assert.match(workspaceSource, /submitAriaLabel="교재 저장"/);
  assert.match(workspaceSource, /submitLabel="출고 대기 저장"/);
  assert.doesNotMatch(workspaceSource, /saving === "closing" \? "저장 중" : "마감 저장"/);
});

test("textbook workspace keeps list and process controls responsive and focused", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /canManageTextbookOperations \? "grid-cols-3 lg:grid-cols-6" : "grid-cols-1"/);
  assert.match(workspaceSource, /data-testid="textbook-master-mobile-list"/);
  assert.match(workspaceSource, /data-testid=\{`textbook-master-mobile-card-\$\{rowId\}`\}/);
  assert.match(workspaceSource, /aria-label="교재 재고 스크롤"/);
  assert.match(workspaceSource, /<DataTableViewport/);
  assert.match(workspaceSource, /aria-label="재고 실사"/);
  assert.match(readTypesSource, /type PurchaseRequestFilter = "all" \| "unregistered" \| "orderable"/);
  assert.match(workspaceSource, /전체 교재/);
  assert.match(workspaceSource, /미등록 요청/);
  assert.match(workspaceSource, /등록 교재/);
  assert.doesNotMatch(workspaceSource, /function shouldShowRequestLine/);
  assert.match(readTypesSource, /type SalesProcessFilter = "all" \| "waiting" \| "issued" \| "returned" \| "cancelled"/);
  assert.match(workspaceSource, /출고 완료/);
  assert.match(workspaceSource, /\{ value: "returned", label: "반품" \}/);
  assert.match(workspaceSource, /\{ value: "cancelled", label: "취소" \}/);
  assert.match(workspaceSource, /statusFilter === "returned"/);
  assert.match(workspaceSource, /statusFilter === "cancelled"/);
  assert.match(workspaceSource, /statusFilter === "issued"/);
  assert.match(workspaceSource, /visibleGroups/);
  assert.match(workspaceSource, /openNewSaleDialog\(\)[\s\S]*setSaleForm/);
  assert.match(workspaceSource, /function InventoryCountWorkspace/);
  assert.doesNotMatch(workspaceSource, /function openClosingDialog/);
});

test("textbook workspace keeps workflow filters and grouped list controls", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(readTypesSource, /type PurchaseOrderFilter = "all" \| "waiting" \| "partial" \| "returnable" \| "returned"/);
  assert.match(workspaceSource, /const purchaseOrderFilterLabels/);
  assert.doesNotMatch(workspaceSource, /오늘 \{formatQuantity\(activeQueueTotal\)\}/);
  assert.match(workspaceSource, /onOrderFilterChange=\{setPurchaseOrderFilter\}/);
  assert.match(workspaceSource, /purchaseOrderFilterLabels/);
  assert.match(workspaceSource, /orderFilter === "waiting"/);
  assert.match(workspaceSource, /orderFilter === "partial"/);
  assert.match(workspaceSource, /displayedFilter === "returnable"/);
  assert.match(workspaceSource, /displayedFilter === "returned"/);
  assert.match(workspaceSource, /filteredInventory/);
  assert.doesNotMatch(workspaceSource, /visibleTextbookGroupLabels/);
  assert.doesNotMatch(workspaceSource, /collapseVisibleTextbookGroups/);
  assert.doesNotMatch(workspaceSource, /onCollapseAllGroups/);
  assert.match(workspaceSource, /aria-label=\{`\$\{group\.label\} 그룹 \$\{isCollapsed \? "펼치기" : "접기"\} · \$\{groupDetailText\}`\}/);
});

test("textbook workspace names modal selects and removes duplicate hidden purchase form", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /getPurchaseDialogTitle/);
  assert.match(workspaceSource, /title=\{getPurchaseDialogTitle\(purchaseForm\.requestStage, Boolean\(selectedPurchaseLineId\)\)\}/);
  assert.match(workspaceSource, /purchaseRequestInputMode/);
  assert.match(workspaceSource, /aria-label="요청 교재 입력 방식"/);
  assert.match(workspaceSource, /등록 교재/);
  assert.match(workspaceSource, /직접 입력/);
  assert.match(workspaceSource, /placeholder="교재명을 그대로 입력"/);
  assert.doesNotMatch(workspaceSource, /등록교재 우선 · 없으면 직접 입력/);
  assert.doesNotMatch(workspaceSource, /aria-label=\{saving === "purchase" \? `\$\{purchaseActionLabel\(purchaseForm\.requestStage\)\} 저장 중`/);
  assert.doesNotMatch(workspaceSource, /aria-label=\{saving === "sale" \? "출고 대기 저장 중"/);
  assert.doesNotMatch(workspaceSource, /aria-label=\{saving === "closing" \? "월마감 저장 중"/);
  assert.match(workspaceSource, /onOpenChange=\{\(open\) => \(open \? setPurchaseDialogOpen\(true\) : closePurchaseDialog\(\)\)\}/);
  assert.match(workspaceSource, /"주문 요청자 선택" : "요청자 선택"/);
  assert.match(workspaceSource, /"주문 위치 선택" : "입고 위치 선택"/);
  assert.match(workspaceSource, /ariaLabel="출고 위치 선택"/);
  assert.match(workspaceSource, /ariaLabel="실사 위치 선택"/);
  assert.doesNotMatch(workspaceSource, /aria-label="마감 과목 선택"/);
  assert.match(workspaceSource, /const effectiveSaleSubmitHint = schemaDisabled/);
  assert.match(workspaceSource, /!selectedSaleClass \? "수업을 선택하세요" : !selectedSaleTextbook \? "교재를 선택하세요"/);
  assert.match(workspaceSource, /saleDuplicateLines\.length > 0[\s\S]*"이미 같은 월 출고가 있습니다\."/);
  assert.match(workspaceSource, /selectedSaleClass \|\| selectedSaleTextbook \? \(/);
  assert.doesNotMatch(workspaceSource, /const closingTargetSubjects = closingForm\.subject === "all" \? \["all", "english", "math", "science"\] : \[closingForm\.subject\]/);
  assert.doesNotMatch(workspaceSource, /<Metric label="저장" value=\{`\$\{formatQuantity\(closingTargetSubjects\.length\)\}건`\}/);
  assert.match(workspaceSource, /aria-label=\{ariaLabel\}/);
  assert.doesNotMatch(workspaceSource, /<TabsContent value="purchase" className="mt-4 grid min-w-0 gap-4">\s*<form onSubmit=\{submitPurchase\} className="hidden">/);
  assert.match(workspaceSource, /submitLabel=\{selectedPurchaseLineId \? "변경 저장" : purchaseActionLabel\(purchaseForm\.requestStage\)\}/);
});

test("textbook workspace adds searchable process tables and tighter issue ledgers", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /const \[operationQuery, setOperationQuery\] = useState\(\(\) => text\(initialPrimaryFilters\.search\)\)/);
  assert.match(workspaceSource, /label=\{operationSearchLabel\}/);
  assert.match(dataTableSearchFieldSource, /aria-label=\{label\}/);
  assert.match(workspaceSource, /searchQuery=\{deferredOperationQuery\}/);
  assert.doesNotMatch(workspaceSource, /matchesPurchaseLineQuery|matchesSaleLineQuery/);
  assert.match(workspaceSource, /const deferredOperationQuery = useDeferredValue\(operationQuery\)/);
  assert.match(workspaceSource, /searchQuery=\{deferredOperationQuery\}/);
  assert.match(workspaceSource, /purchaseForm\.requestStage !== "request" \? \(/);
  assert.match(workspaceSource, /주문 추가/);
  assert.match(workspaceSource, /<DataTableHeaderCell>수업 · 위치<\/DataTableHeaderCell>/);
  assert.match(workspaceSource, /<div className="text-xs text-muted-foreground">\{locationName\}\{mode === "order" && draft\.requestBy/);
  assert.match(workspaceSource, /<TableCell colSpan=\{4\} className="text-right">이 페이지 합계<\/TableCell>/);
  assert.match(workspaceSource, /aria-label=\{`\$\{studentName\} \$\{textbookTitle\} 출고 완료 처리`\}/);
  assert.match(workspaceSource, /aria-label="일괄 과목 선택"/);
  assert.match(workspaceSource, /aria-label=\{`\$\{rowA11yLabel\} 편집`\}/);
  assert.match(workspaceSource, /status === "requested" \|\| status === "charged"/);
  assert.match(readModelSource, /filter === "shortage"\) return totalQuantity < 0 \|\|/);
  assert.match(workspaceSource, /function TabCountBadge/);
});

test("textbook workspace reduces idle clutter and exposes group totals", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /const showsProcessToolbar = activeTab === "requests"/);
  assert.match(workspaceSource, /activeTab === "purchase" \|\| activeTab === "sales"/);
  assert.match(workspaceSource, /function isEditableShortcutTarget/);
  assert.match(workspaceSource, /masterSearchRef/);
  assert.match(workspaceSource, /operationSearchRef/);
  assert.match(workspaceSource, /const deferredQuery = useDeferredValue\(query\)/);
  assert.match(workspaceSource, /const deferredOperationQuery = useDeferredValue\(operationQuery\)/);
  assert.match(workspaceSource, /shortcut="\/"/);
  assert.match(dataTableSearchFieldSource, /aria-keyshortcuts=\{shortcut\}/);
  assert.match(workspaceSource, /event\.key !== "\/"/);
  assert.match(workspaceSource, /event\.key === "Escape"/);
  assert.match(workspaceSource, /const showsProcessToolbar =/);
  assert.match(dataTableSearchFieldSource, /role="search" aria-label=\{label\}/);
  assert.match(workspaceSource, /<DataTableWorkspaceToolbar/);
  assert.match(workspaceSource, /searchControl=\{<DataTableSearchField ref=\{operationSearchRef\}/);
  assert.match(workspaceSource, /value !== "requests" && value !== "purchase" && value !== "sales"[\s\S]*updateOperationSearchQuery\(""\)/);
  assert.match(workspaceSource, /if \(value !== activeTab\) \{[\s\S]*clearMasterSelection\(\);[\s\S]*setSelectedPurchaseLineIds\(\[\]\);[\s\S]*setSelectedSaleLineIds\(\[\]\);[\s\S]*\}/);
  assert.doesNotMatch(workspaceSource, /formatQuantity\(groupCount\)\}그룹/);
  assert.match(workspaceSource, /aria-label="선택한 교재 일괄 작업"/);
  assert.match(workspaceSource, /const groupTotalQuantity = group\.rows\.reduce/);
  assert.doesNotMatch(workspaceSource, /const groupAmountValue = group\.rows\.reduce/);
  assert.match(workspaceSource, /const groupCountLabel = `\$\{formatQuantity\(group\.rows\.length\)\}/);
  assert.match(workspaceSource, /const groupDetailText = \[/);
  assert.match(handoffModelSource, /function getKnownPublisherLabel/);
  assert.match(workspaceSource, /getKnownPublisherLabel\(row\)/);
  assert.match(workspaceSource, /publisherLabel \? \(/);
  assert.doesNotMatch(workspaceSource, /MASTER_TEXTBOOK_PAGE_SIZE|masterListLimit/);
  assert.match(workspaceSource, /const masterVisibleInventory = numbered\.master\.rows/);
  assert.match(workspaceSource, /search: deferredQuery/);
  assert.match(readModelSource, /const keyword = filters\.search\.trim\(\)\.toLowerCase\(\)/);
  assert.match(readModelSource, /function buildTextbookSearchIndex/);
  assert.doesNotMatch(workspaceSource, /const textbookSearchIndexById = useMemo/);
  assert.match(workspaceSource, /const filteredInventory = numbered\.master\.rows/);
  assert.doesNotMatch(workspaceSource, /filteredInventory\.slice\(0, masterListLimit\)/);
  assert.match(workspaceSource, /const visibleTextbookIdSet = useMemo\(\(\) => new Set\(visibleTextbookIds\), \[visibleTextbookIds\]\)/);
  assert.match(workspaceSource, /const selectedVisibleTextbookCount = useMemo/);
  assert.match(workspaceSource, /visibleTextbookIdSet\.has\(id\)/);
  assert.match(workspaceSource, /rows=\{masterVisibleInventory\}/);
  assert.match(workspaceSource, /emptyActionLabel=\{numbered\.master\.loading \|\| numbered\.master\.error \? undefined : hasTextbookListFilter \? "필터 초기화" : "신규 등록"\}/);
  assert.match(workspaceSource, /onEmptyAction=\{numbered\.master\.error \? undefined : hasTextbookListFilter \? resetTextbookListFilters : openNewMasterDialog\}/);
  assert.match(workspaceSource, /<DataTablePagination/);
  assert.match(workspaceSource, /totalCount=\{numbered\.master\.totalCount\}/);
  assert.match(workspaceSource, /검색 조건에 맞는 주문·입고 건이 없습니다/);
  assert.match(workspaceSource, /검색 조건에 맞는 출고 건이 없습니다/);
  assert.match(workspaceSource, /const searchMatchedPurchaseRowsByGroup = useMemo/);
  assert.match(workspaceSource, /searchMatchedPurchaseRowsByGroup\.get\(groupId\)/);
  assert.match(workspaceSource, /const \[purchaseHandoffGroups, setPurchaseHandoffGroups\] = useState/);
  assert.match(workspaceSource, /const getVisiblePurchaseRows = useCallback/);
  assert.match(workspaceSource, /const visiblePurchaseRowsByGroup = useMemo/);
  assert.match(workspaceSource, /getCurrentVisiblePurchaseRows\(group\.id\)/);
  assert.match(workspaceSource, /const visiblePurchaseRows = useMemo/);
  assert.match(workspaceSource, /const requestFilterOptions = useMemo/);
  assert.match(workspaceSource, /const purchaseProcessFilterCounts = summary \? \{/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\?\.boardScope\[value\]/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\?\.order\[value\]/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\?\.request\[option\.value\]/);
  assert.doesNotMatch(workspaceSource, /const getRequestFilterCount =/);
  assert.match(workspaceSource, /const purchaseProcessActionIds = useMemo/);
  assert.match(workspaceSource, /for \(const line of visiblePurchaseRows\.flatMap\(getPurchaseScopeLines\)\)/);
  assert.match(workspaceSource, /const visibleActionablePurchaseLineIdSet = useMemo/);
  assert.match(workspaceSource, /const selectedProcessLineCount = useMemo/);
  assert.match(workspaceSource, /visibleActionablePurchaseLineIdSet\.has\(lineId\)/);
  assert.match(workspaceSource, /\[mode, ordersById, textbooks, visiblePurchaseRows\]/);
  assert.match(workspaceSource, /const searchMatchedSaleRowsByGroup = useMemo/);
  assert.match(workspaceSource, /searchMatchedSaleRowsByGroup\.get\(groupId\)/);
  assert.match(workspaceSource, /const \[makeEduBillingGroups, setMakeEduBillingGroups\] = useState/);
  assert.match(workspaceSource, /const visibleSaleRowsByGroup = useMemo/);
  assert.match(workspaceSource, /getCurrentVisibleSaleRows\(group\.id\)/);
  assert.match(workspaceSource, /const visibleSaleRowsWithGroup = useMemo/);
  assert.match(workspaceSource, /const visibleSaleRows = useMemo/);
  assert.match(workspaceSource, /const saleProcessActionIds = useMemo/);
  assert.match(workspaceSource, /for \(const \{ line, groupId \} of visibleSaleRowsWithGroup\)/);
  assert.match(workspaceSource, /const status = text\(line\.status\) \|\| groupId/);
  assert.match(workspaceSource, /const salesProcessFilterCounts = summary\?\.statusCounts \|\| null/);
  assert.match(workspaceSource, /salesProcessFilterCounts\?\.\[option\.value\]/);
  assert.match(workspaceSource, /const visibleActionableLineIdSet = useMemo/);
  assert.match(workspaceSource, /const visibleSelectableSaleLineIdSet = useMemo/);
  assert.match(workspaceSource, /visibleSelectableSaleLineIdSet\.has\(lineId\)/);
  assert.match(workspaceSource, /const selectedActionableCount = useMemo/);
  assert.doesNotMatch(workspaceSource, /const getSalesFilterCount =/);
  assert.match(workspaceSource, /\[canDeleteHistory, visibleSaleRowsWithGroup\]/);
  assert.match(workspaceSource, /searchQuery=\{deferredOperationQuery\}/);
  assert.match(workspaceSource, /summary \? \(/);
  assert.match(workspaceSource, /label=\{loading \? "목록 불러오는 중…" : readError \? "교재 목록을 불러오지 못했습니다" : getPurchaseProcessEmptyLabel\(mode, emptyGroupId, requestFilter, orderFilter, searchQuery\)\}/);
  assert.match(workspaceSource, /label=\{loading \? "목록 불러오는 중…" : readError \? "출고 목록을 불러오지 못했습니다" : getSalesProcessEmptyLabel\(emptyGroupId, statusFilter, searchQuery\)\}/);
  assert.match(workspaceSource, /return "주문 필요 건이 없습니다"/);
  assert.match(workspaceSource, /return "요청에서 확정된 교재가 주문 대기 목록에 올라옵니다\."/);
  assert.match(workspaceSource, /requestedTotal > 0 \? `요청 \$\{formatQuantity\(requestedTotal\)\}` : ""/);
  assert.match(workspaceSource, /수량 \{formatQuantity\(totalQuantity\)\}/);
});

test("textbook workspace preserves authoritative counts without optional-field warning badges", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.doesNotMatch(workspaceSource, /useTextbookOperationsData|listTextbookOperationsData|TextbookOperationsData|emptyData/);
  assert.match(workspaceSource, /const numbered = useTextbookNumberedData\(/);
  assert.match(workspaceSource, /const activePrimaryState =/);
  assert.match(workspaceSource, /activePrimaryState\.error/);
  assert.match(workspaceSource, /const invalidateMaster = useCallback/);
  assert.match(workspaceSource, /const invalidatePurchase = useCallback/);
  assert.match(workspaceSource, /const invalidateSales = useCallback/);
  assert.match(workspaceSource, /const invalidateInventory = useCallback/);
  assert.doesNotMatch(workspaceSource, /const invalidateClosing = useCallback/);
  assert.match(workspaceSource, /rows=\{numbered\.inventory\.rows\}/);
  assert.match(workspaceSource, /const locationColumns = useMemo/);
  assert.match(workspaceSource, /locations\.map\(\(location\) => \(\{/);
  assert.match(workspaceSource, /locationQuantities\[location\.id\]/);
  assert.doesNotMatch(workspaceSource, /filteredInventoryTotalQuantity/);
  assert.doesNotMatch(workspaceSource, /filteredInventorySaleValue/);
  assert.doesNotMatch(workspaceSource, /판매가합 \{formatCurrency\(filteredInventorySaleValue\)\}/);
  assert.match(readModelSource, /function getTextbookTitleKey/);
  assert.match(closingModelSource, /function buildTextbookLookupMap/);
  assert.match(closingModelSource, /function getTextbookFromLookup/);
  assert.match(closingModelSource, /function buildLocationNameLookup/);
  assert.match(closingModelSource, /function getLocationNameFromLookup/);
  assert.doesNotMatch(workspaceSource, /const duplicateTextbookTitleKeys = useMemo/);
  assert.match(workspaceSource, /referenceData\.masterDuplicate\.value/);
  assert.match(workspaceSource, /label: "미사용"/);
  assert.doesNotMatch(workspaceSource, /visibleQualityIssueLabels = qualityIssueLabels\.slice\(0, 3\)/);
  assert.doesNotMatch(workspaceSource, /const shouldShowRequestLineForFilter = useCallback/);
  assert.doesNotMatch(workspaceSource, /const shouldShowOrderGroupForFilter = useCallback/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\?\.request\[option\.value\]/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\?\.order\[value\]/);
  assert.match(workspaceSource, /salesProcessFilterCounts\?\.\[option\.value\]/);
  assert.doesNotMatch(workspaceSource, /const textbookLookup = useMemo\(\(\) => buildTextbookLookupMap/);
  assert.doesNotMatch(workspaceSource, /const locationNameLookup = useMemo\(\(\) => buildLocationNameLookup/);
  assert.match(workspaceSource, /numbered\.inventoryHistory\.rows/);
  assert.doesNotMatch(workspaceSource, /numbered\.closingMovements\.rows/);
});

test("textbook workspace keeps archive access, pending tab counts, and compact empty process groups", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(readTypesSource, /\| "missingCategory"/);
  assert.match(readTypesSource, /\| "missingPrice"/);
  assert.match(workspaceSource, /const \[textbookQualityFilter, setTextbookQualityFilter\] = useState<"all" \| "inactive">\(\(\) =>/);
  assert.match(readModelSource, /function hasTextbookSubjectMismatch/);
  assert.match(readModelSource, /function getTextbookQualityIssues/);
  assert.match(readModelSource, /function matchesTextbookQualityFilter/);
  assert.match(workspaceSource, /const textbookQualityFilterCounts = acceptedMasterSummary\?\.qualityCounts \|\| null/);
  assert.match(workspaceSource, /setTextbookQualityFilter\("all"\)/);
  assert.match(workspaceSource, /const activeTextbookQualityFilter = activeTab === "master" \? textbookQualityFilter : "all"/);
  assert.match(workspaceSource, /activeTextbookQualityFilter !== "all"/);
  assert.doesNotMatch(workspaceSource, /function TextbookQualityQuickFilters/);
  assert.doesNotMatch(workspaceSource, /aria-label="교재 정리 빠른 필터"/);
  assert.doesNotMatch(workspaceSource, /const totalCount = counts\.all \|\| 0/);
  assert.doesNotMatch(workspaceSource, /return totalCount <= 0 \|\| count < totalCount/);
  assert.doesNotMatch(workspaceSource, /<TextbookQualityQuickFilters/);
  assert.match(workspaceSource, /activeTab === "master" \? \(/);
  assert.match(workspaceSource, /ariaLabel="교재 과목 필터"/);
  assert.match(workspaceSource, /ariaLabel="교재 학교 구분 필터"/);
  assert.doesNotMatch(workspaceSource, /showZero/);
  assert.match(workspaceSource, /aria-label="교재 재고"/);
  assert.match(workspaceSource, /aria-label="주문·입고"/);
  assert.match(workspaceSource, /aria-hidden="true"/);
  assert.match(workspaceSource, /<TabCountBadge value=\{operationMetrics\.requestCount\} \/>/);
  assert.match(workspaceSource, /<TabCountBadge value=\{operationMetrics\.unregisteredRequestCount \+ operationMetrics\.orderNeededCount \+ operationMetrics\.receivingBacklogCount\} \/>/);
  assert.doesNotMatch(workspaceSource, /data\.inventory/);
  assert.match(readModelSource, /if \(filter === "inactive"\) return !isActiveTextbook\(row\)/);
  assert.match(readModelSource, /if \(!isActiveTextbook\(row\)\) return false/);
  assert.match(readModelSource, /function shouldShowOperationalPurchaseLine/);
  assert.match(readModelSource, /function shouldShowOperationalSaleLine/);
  assert.match(workspaceSource, /numbered\.requests\.rows/);
  assert.match(workspaceSource, /numbered\.sales\.rows/);
  assert.match(workspaceSource, /numbered\.inventoryHistory\.rows/);
  assert.match(workspaceSource, /aria-label="미사용 교재 보기"/);
  assert.match(workspaceSource, /const tableTotals = summary \? \{/);
  assert.doesNotMatch(workspaceSource, /const groupsByLabel = new Map<string, Row\[\]>\(\)/);
  assert.match(workspaceSource, /const selectedIdSet = useMemo\(\(\) => new Set\(selectedIds\), \[selectedIds\]\)/);
  assert.match(workspaceSource, /checked=\{selectedIdSet\.has\(rowId\)\}/);
  assert.match(workspaceSource, /tableTotals\.locationQuantities/);
  assert.match(workspaceSource, /<DataTableHeaderCell[^>]*>분류<\/DataTableHeaderCell>/);
  assert.match(workspaceSource, /const columnSpan = locationColumns\.length \+ 2 \+ 2 \+ \(onSelectTextbook \? 1 : 0\) \+ \(hasSelection \? 1 : 0\)/);
  assert.match(workspaceSource, /getTextbookGradeSummary/);
  assert.match(workspaceSource, /getTextbookSchoolLevelSummary/);
  assert.match(workspaceSource, /getTextbookSubSubject/);
  assert.match(workspaceSource, /<DataTableBodyCell>\{tableTotals \? "합계" : "집계 확인 필요"\}<\/DataTableBodyCell>/);
  assert.match(workspaceSource, /const renderedGroups = visibleGroups\.filter/);
  assert.match(workspaceSource, /const emptyGroupId = visibleGroups\[0\]\?\.id/);
  assert.match(workspaceSource, /const hasHiddenProcessRows =/);
  assert.doesNotMatch(workspaceSource, /const showProcessSummary =/);
  assert.match(workspaceSource, /const purchaseFiltersAreDefault =/);
  assert.match(workspaceSource, /const filtersChanging =/);
  assert.doesNotMatch(workspaceSource, /const showGroupViewControls =/);
  assert.match(workspaceSource, /Object\.keys\(purchaseBoardScopeLabels\)/);
  assert.match(workspaceSource, /Object\.keys\(purchaseOrderFilterLabels\)/);
  assert.match(workspaceSource, /onValueChange=\{onScopeChange\}/);
  assert.match(workspaceSource, /onValueChange=\{onOrderFilterChange\}/);
  assert.match(workspaceSource, /<DataTableFilters aria-label="주문·입고 필터">/);
  assert.match(workspaceSource, /onScopeChange\("active"\);\s*onOrderFilterChange\("all"\);\s*onRequestFilterChange\("all"\);/);
  assert.doesNotMatch(workspaceSource, /showGroupViewControls \? \(/);
  assert.match(workspaceSource, /hint=\{!readError && !hasHiddenProcessRows \?/);
  assert.match(readModelSource, /function getTextbookQualityScore/);
  assert.doesNotMatch(workspaceSource, /const leftScore = getTextbookQualityScore/);
  assert.doesNotMatch(workspaceSource, /groupQualityIssueCount/);
  assert.match(workspaceSource, /aria-label=\{`\$\{rowA11yLabel\} 선택`\}/);
  assert.match(workspaceSource, /function ProcessGroupEmptyState\(\{/);
  assert.match(workspaceSource, /hint\?: string/);
  assert.match(workspaceSource, /const emptyActionLabel = hasProcessSearchQuery/);
  assert.match(workspaceSource, /const totalProcessRowCount = summary\?\.totalCount \?\? null/);
  assert.match(workspaceSource, /<DataTableSelectFilter inline id="purchase-stage-filter"/);
  assert.match(workspaceSource, /<DataTableSelectFilter inline id="sale-status-filter"/);
  assert.match(workspaceSource, /const showSalesGroupToggleControls = renderedGroups\.length > 1/);
  assert.match(workspaceSource, /showSalesGroupToggleControls \? <DataTableRowActions label="출고 그룹 보기">/);
  assert.match(workspaceSource, /hint=\{readError \? undefined : getSalesProcessEmptyHint/);
  assert.match(workspaceSource, /actionLabel=\{loading \|\| readError \? undefined : emptyActionLabel\}/);
  assert.match(workspaceSource, /onClearSearch=\{\(\) => updateOperationSearchQuery\(""\)\}/);
  assert.doesNotMatch(workspaceSource, /const shouldShowOrderGroupForFilter = useCallback/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\?\.boardScope\[value\]/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\?\.order\[value\]/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\?\.request\[option\.value\]/);
  assert.doesNotMatch(workspaceSource, /numbered\.closing\.totalCount/);
  assert.match(workspaceSource, /<TableHeader className="sticky top-0 z-10 bg-background">/);
  assert.match(workspaceSource, /수량 \{formatQuantity\(visibleTotalQuantity\)\}/);
});

test("textbook workspace second-pass polish keeps process ledgers self-explanatory", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /function getOperationSearchPlaceholder/);
  assert.match(workspaceSource, /return "요청 교재명, 수업, 요청자"/);
  assert.match(workspaceSource, /return "주문 교재명, 총판, 수업"/);
  assert.match(workspaceSource, /return "출고 교재명, 학생, 수업"/);
  assert.match(workspaceSource, /const operationSearchLabel = getOperationSearchLabel\(activeTab\)/);
  assert.match(workspaceSource, /placeholder=\{operationSearchPlaceholder\}/);
  assert.match(workspaceSource, /label=\{operationSearchLabel\}/);
  assert.match(dataTableSearchFieldSource, /clearLabel = `\$\{label\} 초기화`/);
  assert.match(dataTableSearchFieldSource, /aria-label=\{clearLabel\}/);
  assert.match(workspaceSource, /aria-live="polite"/);
  assert.match(workspaceSource, /aria-label=\{actionLabel\}/);
  assert.match(workspaceSource, /const hasProcessSearchQuery = Boolean\(text\(searchQuery\)\)/);
  assert.match(workspaceSource, /const handleEmptyAction = \(\) => \{/);
  assert.match(workspaceSource, /if \(hasHiddenProcessRows\) \{\s*onScopeChange\("all"\);\s*onRequestFilterChange\("all"\);\s*onOrderFilterChange\("all"\);/);
  assert.match(workspaceSource, /label=\{`\$\{textbookTitle\} \$\{mode === "request" \? "요청" : "주문·입고"\} 상세 열기`\}/);
  assert.match(workspaceSource, /aria-label=\{`\$\{textbookTitle\} 교보문고 검색`\}/);
  assert.match(workspaceSource, /title=\{`\$\{textbookTitle\} 일괄 처리 선택`\}/);
  assert.doesNotMatch(workspaceSource, /aria-label="월마감 정산 이력"/);
  assert.doesNotMatch(workspaceSource, /selectedClosingDetailId/);
  assert.doesNotMatch(workspaceSource, /function ClosingDetailDialog/);
  assert.doesNotMatch(workspaceSource, /onInspectRow=\{\(row\) => \{[\s\S]*setSelectedClosingDetailId\(getRecordId\(row\)\)/);
  assert.doesNotMatch(workspaceSource, /getTextbookClosingDetail/);
  assert.doesNotMatch(workspaceSource, /저장된 월마감값과 현재 재고 이동 재계산값을 함께 확인합니다/);
  assert.doesNotMatch(workspaceSource, /DataTableDetailButton label=\{`\$\{closingA11yLabel\} 정산 상세 열기`\}/);
  assert.match(workspaceSource, /className="text-right tabular-nums"/);
});

test("textbook workspace fourth-pass polish speeds empty flows and stock counts", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /activeTab === "requests" \|\|/);
  assert.match(workspaceSource, /activeTab === "purchase" \|\|/);
  assert.match(workspaceSource, /activeTab === "sales"/);
  assert.match(workspaceSource, /function getPurchaseProcessEmptyHint/);
  assert.match(workspaceSource, /function getSalesProcessEmptyHint/);
  assert.match(workspaceSource, /hint=\{getPurchaseProcessEmptyHint/);
  assert.match(workspaceSource, /hint=\{getSalesProcessEmptyHint/);
  assert.match(workspaceSource, /className="font-medium text-foreground"/);
  assert.match(workspaceSource, /className=\{DATA_TABLE_MOBILE_ITEM_CLASS_NAME\} data-state=\{selected \? "selected" : undefined\}/);
  assert.match(workspaceSource, /현재 수량 입력/);
  assert.match(workspaceSource, /onKeyDown=\{\(event\) => \{/);
  assert.match(workspaceSource, /!disabled && !saving && text\(value\)/);
  assert.match(workspaceSource, /variant=\{text\(value\) \? "default" : "outline"\}/);
  assert.match(workspaceSource, /aria-busy=\{saving\}/);
  assert.match(workspaceSource, /const invalidateInventory = useCallback/);
  assert.match(workspaceSource, /numbered\.inventory\.refresh/);
  assert.match(workspaceSource, /numbered\.inventoryHistory\.refresh/);
  assert.doesNotMatch(workspaceSource, /function refresh\(/);
});

test("textbook workspace third-pass polish tightens navigation and action ergonomics", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /aria-label="교재관리 업무 탭"/);
  assert.match(dataTableSearchFieldSource, /type="search"/);
  assert.match(dataTableSearchFieldSource, /autoComplete="off"/);
  assert.match(dataTableSearchFieldSource, /enterKeyHint="search"/);
  assert.match(dataTableSearchFieldSource, /role="search" aria-label=\{label\}/);
  assert.match(workspaceSource, /const title = normalizedStage === "receive" \? "교재 입고" : normalizedStage === "order" \? "교재 주문" : "교재 요청"/);
  assert.match(workspaceSource, /title="선택 요청 일괄 주문"/);
  assert.match(workspaceSource, /aria-label="선택 요청 일괄 주문"/);
  assert.match(workspaceSource, /aria-label="선택 교재 삭제"/);
  assert.match(workspaceSource, /aria-label="선택 교재 선택 해제"/);
  assert.match(workspaceSource, /aria-label="재고 실사 목록"/);
  assert.match(workspaceSource, /aria-label="교재 재고"/);
  assert.match(workspaceSource, /<DataTableHeaderCell className=\{cn\("w-\[132px\] min-w-\[132px\]", "text-right", stickyActionHeadClassName\)\}>작업<\/DataTableHeaderCell>/);
  assert.doesNotMatch(workspaceSource, /aria-label="교재 처리표 컬럼 구성"|columnSettingsControl/);
  assert.match(workspaceSource, /<DataTableHeaderCell className=\{cn\("w-\[132px\] text-right", stickyActionHeadClassName\)\}>작업<\/DataTableHeaderCell>/);
  assert.match(workspaceSource, /<DataTableBodyCell className=\{stickyActionCellClassName\}>/);
  assert.match(workspaceSource, /aria-label=\{mode === "request" \? "교재 요청 목록" : "교재 주문·입고 목록"\}/);
  assert.match(workspaceSource, /aria-label="교재 출고 목록"/);
  assert.match(workspaceSource, /aria-label="교재 요청 추가"/);
  assert.match(workspaceSource, /aria-label="교재 주문 추가"/);
  assert.match(workspaceSource, /aria-label="교재 출고 추가"/);
  assert.match(workspaceSource, /aria-label="출고 학생 전체 선택"/);
  assert.match(workspaceSource, /aria-label="출고 학생 전체 해제"/);
  assert.match(workspaceSource, /aria-label=\{`\$\{studentName\} 출고 대상 선택`\}/);
  assert.match(workspaceSource, /\{formatQuantity\(includedSaleStudentCount\)\}\/\{formatQuantity\(selectedSaleStudentCount\)\}명/);
  assert.match(workspaceSource, /aria-label="신규 등록"/);
  assert.doesNotMatch(workspaceSource, /data-textbook-modal-dismiss="master"/);
});

test("textbook workspace keeps master filters reversible and avoids native delete confirms", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.doesNotMatch(workspaceSource, /window\.confirm/);
  assert.match(workspaceSource, /const \[textbookDeleteDialogOpen, setTextbookDeleteDialogOpen\] = useState\(false\)/);
  assert.match(workspaceSource, /<ConfirmationDialogContent[\s\S]*title="선택 교재 정리"/);
  assert.match(workspaceSource, /executeTextbookConfirmation\(confirmDeleteSelectedTextbooks/);
  assert.match(workspaceSource, /function clearMasterSelection\(\)/);
  assert.match(workspaceSource, /function clearTransientTextbookFeedback\(\)/);
  assert.match(workspaceSource, /setMessage\(""\)/);
  assert.match(workspaceSource, /setActionErrorMessage\(""\)/);
  assert.match(workspaceSource, /setBulkTextbookPatch\(emptyBulkTextbookPatch\)/);
  assert.match(workspaceSource, /function updateMasterSearchQuery\(value: string\)/);
  assert.match(workspaceSource, /clearTransientTextbookFeedback\(\);[\s\S]*setQuery\(value\)/);
  assert.match(workspaceSource, /onValueChange=\{updateMasterSearchQuery\}/);
  assert.match(dataTableSearchFieldSource, /onChange=\{\(event\) => onValueChange\(event\.target\.value\)\}/);
  assert.doesNotMatch(workspaceSource, /function changeInventoryFilter/);
  assert.match(workspaceSource, /function changeTextbookQualityFilter\(value: "all" \| "inactive"\)/);
  assert.match(workspaceSource, /function changeSubjectGroupFilter\(value: string\)/);
  assert.match(workspaceSource, /function changeSchoolLevelGroupFilter\(value: string\)/);
  assert.match(workspaceSource, /onGradeLevelFilterChange=\{changeGradeLevelGroupFilter\}/);
  assert.match(workspaceSource, /onCategoryFilterChange=\{changeCategoryGroupFilter\}/);
  assert.match(workspaceSource, /onClear=\{\(\) => \{ clearMasterSelection\(\); setMasterBulkControlsOpen\(false\); masterSearchRef\.current\?\.focus\(\{ preventScroll: true \}\); \}\}/);
  assert.match(workspaceSource, /textbookService\.deleteTextbookMasters/);
  assert.match(workspaceSource, /invalidateMaster/);
});

test("textbook workspace keeps teacher request access separate from management data", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(
    new URL("src/features/textbooks/textbook-service.ts", root),
    "utf8",
  );

  assertPreparedWorkspaceReads(workspaceSource);
  assert.match(workspaceSource, /canManageTextbookOperations/);
  assert.match(workspaceSource, /if \(!canManageTextbookOperations && value !== "requests"\)/);
  assert.match(workspaceSource, /canManageTextbookOperations \? "grid-cols-3 lg:grid-cols-6" : "grid-cols-1"/);
  assert.match(serviceSource, /create_textbook_request_v1/);
  assert.doesNotMatch(workspaceSource, /listTextbookOperationsData/);
});

test("teachers can add requests but cannot manage existing textbook requests", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const requestDialogStart = workspaceSource.indexOf('{purchaseForm.requestStage === "request" ? (');
  const requestDialogEnd = workspaceSource.indexOf(
    '{purchaseForm.requestStage !== "request" && purchaseForm.requestedTextbookTitle',
    requestDialogStart,
  );
  const requestDialogSource = workspaceSource.slice(requestDialogStart, requestDialogEnd);

  assert.match(workspaceSource, /const \{ user, role, canManageAll, isAdmin, isStaff, isTeacher \} = useAuth\(\)/);
  assert.match(workspaceSource, /const canCreateTextbookRequest = isTeacher \|\| canManageTextbookOperations/);
  assert.match(workspaceSource, /requestBy: currentUserLabel/);
  assert.match(workspaceSource, /purchaseForm\.requestStage === "request"[\s\S]*textbookService\.createTextbookRequest/);
  assert.match(workspaceSource, /canManageRequestLines=\{canManageTextbookOperations\}/);
  assert.match(workspaceSource, /canManageRequestLines && onSelectLine/);
  assert.match(workspaceSource, /if \(!canManageRequestLines\) return null/);
  assert.match(requestDialogSource, /canManageTextbookOperations \? \([\s\S]*<TeacherSelect[\s\S]*\) : \([\s\S]*currentUserLabel/);
  assert.match(requestDialogSource, /canManageTextbookOperations \? \([\s\S]*selectedPurchaseLineId \? \([\s\S]*<TeacherSelect/);
});

test("teacher request save stays on the unfiltered request tab synchronously", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const savedPurchaseFlowSource = workspaceSource.slice(
    workspaceSource.indexOf("function showSavedPurchaseFlow"),
    workspaceSource.indexOf("function toggleTextbookGroup"),
  );

  assert.match(savedPurchaseFlowSource, /setActiveTab\(canManageTextbookOperations \? "purchase" : "requests"\)/);
  assert.match(
    savedPurchaseFlowSource,
    /setPurchaseRequestFilter\(canManageTextbookOperations\s*\? getSavedPurchaseRequestFilter\(stage, hasCatalogTextbook\)\s*:\s*"all"\)/,
  );
  assert.doesNotMatch(savedPurchaseFlowSource, /setActiveTab\("purchase"\)/);
});

test("textbook workspace preserves daily-operation safeguards with simpler navigation", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const workspaceUiSource = `${workspaceSource}\n${dataTableSearchFieldSource}`;

  const safeguards = [
    /RefreshCw/,
    /useTextbookNumberedData/,
    /useTextbookReferenceData/,
    /getTextbookPurchaseDetail/,
    /getTextbookSaleDetail/,
    /getTextbookInventoryBalance/,
    /getTextbookInactiveCleanupContext/,
    /aria-label="교재관리 새로고침"/,
    /refreshTextbookData/,
    /activePrimaryState\.totalCount/,
    /updateOperationSearchQuery/,
    /setSelectedPurchaseLineIds\(\[\]\)/,
    /setSelectedSaleLineIds\(\[\]\)/,
    /activePrimaryState\.error/,
    /activePrimaryState\.loading/,
    /activePrimaryState\.retry/,
    /animate-spin/,
    /role="status"/,
    /aria-live="polite"/,
    /aria-keyshortcuts=\{shortcut\}/,
    /enterKeyHint="search"/,
    /autoComplete="off"/,
    /function clearMasterSelection\(\)/,
    /setBulkTextbookPatch\(emptyBulkTextbookPatch\)/,
    /numbered\.master\.goToPage/,
    /useDeferredValue\(query\)/,
    /useDeferredValue\(operationQuery\)/,
    /const invalidateMaster = useCallback/,
    /const invalidatePurchase = useCallback/,
    /const invalidateSales = useCallback/,
    /const invalidateInventory = useCallback/,
    /setActionErrorMessage\(""\)/,
    /setMessage\(""\)/,
    /function changeTextbookQualityFilter\(value: "all" \| "inactive"\)/,
    /function resetTextbookListFilters\(\)/,
  ];

  assert.doesNotMatch(workspaceSource, /TextbookOperationsStatusBar|TextbookOpsCommandCenter|inventoryFilterLabels|textbookQualityFilterLabels|qualityIssueLabels|groupQualityIssueCount/);
  for (const safeguard of safeguards) {
    assert.match(workspaceUiSource, safeguard);
  }
  assert.doesNotMatch(workspaceSource, /\{ id: "queue", label: "할 일"/);
  assert.doesNotMatch(workspaceSource, /\{ id: "loaded", label: "갱신"/);
  assert.doesNotMatch(workspaceSource, /\{ id: "speed", label: "응답"/);
  assert.doesNotMatch(workspaceSource, /useTextbookOperationsData|TextbookOperationsData/);
});

test("textbook workspace locks 50 master data-entry safeguards", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  const safeguards = [
    /function normalizeInlineTextInput/,
    /function normalizeStoredTextInput/,
    /function setMasterIsbn13/,
    /const previousIsbn = normalizeBarcodeValue\(current\.isbn13\)/,
    /const previousBarcode = normalizeBarcodeValue\(current\.barcode\)/,
    /const shouldMirrorBarcode = !previousBarcode \|\| previousBarcode === previousIsbn/,
    /barcode: shouldMirrorBarcode \? nextIsbn : previousBarcode/,
    /function openDuplicateMaster\(row: Row\)/,
    /selectMasterTextbook\(row\)/,
    /const masterTitleValue = text\(masterForm\.title\)/,
    /const masterDuplicatePreviewRows = masterDuplicateRows\.slice\(0, 3\)/,
    /const isNewMasterDuplicate = !masterForm\.id && masterDuplicateTotalCount > 0/,
    /const masterSubmitDisabled = schemaDisabled \|\| saving === "master" \|\| !masterTitleValue \|\| !masterTaxonomyValidation\.valid \|\| isNewMasterDuplicate/,
    /if \(isNewMasterDuplicate\)/,
    /setActionErrorMessage\("이미 등록된 교재입니다\. 기존 교재를 열어 수정하세요\."\)/,
    /title: normalizeStoredTextInput\(masterForm\.title\)/,
    /publisher: normalizeStoredTextInput\(masterForm\.publisher\)/,
    /isbn13: normalizeBarcodeValue\(masterForm\.isbn13\)/,
    /barcode: normalizeBarcodeValue\(masterForm\.barcode \|\| masterForm\.isbn13\)/,
    /onChange=\{\(event\) => setMasterTextField\("title", event\.target\.value\)\}/,
    /onBlur=\{\(\) => settleMasterTextField\("title"\)\}/,
    /options=\{masterPublisherOptions\}/,
    /value=\{masterForm\.publisher \|\| "none"\}/,
    /publisher: normalizeStoredTextInput\(value === "none" \? "" : value\)/,
    /ariaLabel="출판사 선택"/,
    /onChange=\{\(event\) => setMasterIsbn13\(event\.target\.value\)\}/,
    /role="alert"/,
    /masterDuplicatePreviewRows\.map/,
    /getPublisherLabel\(row\)/,
    /getCategoryLabel\(row\)/,
    /onClick=\{\(\) => openDuplicateMaster\(row\)\}/,
    /aria-label=\{`\$\{getTextbookTitle\(row\)\} 기존 교재 열기`\}/,
    /저장 잠김/,
    /이미 등록된 교재 \{formatQuantity\(masterDuplicateTotalCount\)\}건/,
    /hint=\{masterSubmitHint\}/,
    /function normalizeMoneyInput/,
    /pattern="\[0-9\]\*"/,
    /autoFocus/,
    /required/,
    /configuredPublisherOptions/,
    /acceptedMasterOptions\?\.publisherOptions/,
    /<datalist id="textbook-category-options">/,
    /inputMode="numeric"/,
    /barcode: normalizeBarcodeValue\(masterForm\.barcode \|\| masterForm\.isbn13\)/,
    /onChange=\{\(event\) => setMasterForm\(\(current\) => \(\{ \.\.\.current, barcode: normalizeBarcodeValue\(event\.target\.value\) \}\)\)\}/,
    /aria-label="교재명"/,
    /aria-label="ISBN"/,
    /masterDuplicateRows\.length > 0/,
    /key=\{rowId\}/,
    /submitDisabled=\{masterSubmitDisabled\}/,
  ];

  assert.equal(safeguards.length, 50);
  for (const safeguard of safeguards) {
    assert.match(workspaceSource, safeguard);
  }
});

test("textbook workspace locks 54 request ordering safeguards", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  const safeguards = [
    /function normalizeQuantityInput/,
    /replace\(\/\[\^\\d\]\/g, ""\)/,
    /options: \{ allowZero\?: boolean \} = \{\}/,
    /if \(!options\.allowZero && quantity <= 0\) return ""/,
    /return String\(Math\.max\(options\.allowZero \? 0 : 1, quantity\)\)/,
    /const manualPurchaseCatalogMatches = useMemo/,
    /purchaseRequestInputMode !== "manual"/,
    /const textbook = selectedBookReference\?\.textbook && getTextbookTitle\(selectedBookReference\.textbook\) === purchaseRequestTitle/,
    /return textbook \? \[textbook\] : \[\]/,
    /const hasManualPurchaseCatalogMatch = manualPurchaseCatalogMatches\.length > 0/,
    /const completedPurchaseHasCatalogTextbook = Boolean\(selectedPurchaseTextbookId\)/,
    /function setPurchaseField\(name: string, value: string\)/,
    /if \(name === "requestedTextbookTitle"\)/,
    /requestedTextbookTitle: normalizeInlineTextInput\(value\)/,
    /isPurchaseQuantityField\(name\)/,
    /normalizePurchaseQuantityField\(name, value\)/,
    /if \(name === "unitCost"\)/,
    /unitCost: normalizeMoneyInput\(value\)/,
    /if \(name === "statementNumber"\)/,
    /statementNumber: normalizeInlineTextInput\(value\)/,
    /const studentRequestedQuantity = normalizePurchaseQuantityField\("studentRequestedQuantity", current\.studentRequestedQuantity\) \|\| "1"/,
    /const studentOrderedQuantity = normalizePurchaseQuantityField\("studentOrderedQuantity", current\.studentOrderedQuantity\) \|\| studentRequestedQuantity/,
    /receivedQuantity: value === "receive"/,
    /normalizePurchaseQuantityField\("studentReceivedQuantity", current\.studentReceivedQuantity\) \|\| studentOrderedQuantity/,
    /function settlePurchaseTextField\(name: "requestedTextbookTitle" \| "statementNumber"\)/,
    /normalizeStoredTextInput\(current\[name\]\)/,
    /function selectCatalogTextbookForPurchaseRequest\(row: Row\)/,
    /setPurchaseRequestInputMode\("catalog"\)/,
    /setPurchaseField\("textbookId", getRecordId\(row\)\)/,
    /const purchasePayloads = \(\["student", "teacher"\] as TextbookCopyScope\[\]\)\.flatMap/,
    /const requestedQuantity = normalizePurchaseQuantityField\(`\$\{scope\}RequestedQuantity`, getPurchaseScopeQuantity\(purchaseForm, scope, "requested"\)\)/,
    /const orderedQuantity = purchaseForm\.requestStage === "request"/,
    /normalizePurchaseQuantityField\(`\$\{scope\}OrderedQuantity`, getPurchaseScopeQuantity\(purchaseForm, scope, "ordered"\)\) \|\| requestedQuantity/,
    /const receivedQuantity = purchaseForm\.requestStage === "receive"/,
    /normalizePurchaseQuantityField\(`\$\{scope\}ReceivedQuantity`, getPurchaseScopeQuantity\(purchaseForm, scope, "received"\)\) \|\| orderedQuantity/,
    /textbookId: selectedPurchaseTextbookId/,
    /requestedTextbookTitle: normalizeStoredTextInput\(purchaseRequestTitle\)/,
    /statementNumber: normalizeStoredTextInput\(purchaseForm\.statementNumber\)/,
    /onBlur=\{\(\) => settlePurchaseTextField\("requestedTextbookTitle"\)\}/,
    /hasManualPurchaseCatalogMatch \? \(/,
    /등록 교재가 있습니다/,
    /등록 교재 연결/,
    /manualPurchaseCatalogMatches\.map/,
    /selectCatalogTextbookForPurchaseRequest\(row\)/,
    /aria-label=\{`\$\{getTextbookTitle\(row\)\} 등록 교재로 선택`\}/,
    /onBlur=\{\(\) => settlePurchaseTextField\("statementNumber"\)\}/,
    /<Input value=\{purchaseForm\.studentRequestedQuantity\} onChange=\{\(event\) => setPurchaseField\("studentRequestedQuantity", event\.target\.value\)\} inputMode="numeric" min="0"/,
    /<Input value=\{purchaseForm\.teacherRequestedQuantity\} onChange=\{\(event\) => setPurchaseField\("teacherRequestedQuantity", event\.target\.value\)\} inputMode="numeric" min="0"/,
    /<Input value=\{purchaseForm\.studentOrderedQuantity\} onChange=\{\(event\) => setPurchaseField\("studentOrderedQuantity", event\.target\.value\)\} inputMode="numeric" min="0"/,
    /<Input value=\{purchaseForm\.teacherOrderedQuantity\} onChange=\{\(event\) => setPurchaseField\("teacherOrderedQuantity", event\.target\.value\)\} inputMode="numeric" min="0"/,
    /<Input value=\{purchaseForm\.studentReceivedQuantity\} onChange=\{\(event\) => setPurchaseField\("studentReceivedQuantity", event\.target\.value\)\} inputMode="numeric" min="0"/,
    /<Input value=\{purchaseForm\.teacherReceivedQuantity\} onChange=\{\(event\) => setPurchaseField\("teacherReceivedQuantity", event\.target\.value\)\} inputMode="numeric" min="0"/,
    /getTextbookPurchaseDetail/,
    /hint=\{purchaseSubmitHint\}/,
  ];

  assert.equal(safeguards.length, 54);
  for (const safeguard of safeguards) {
    assert.match(workspaceSource, safeguard);
  }
});

test("purchase request ordering uses the same compact title match in list, modal, and save", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /function getOrderablePurchaseRequestTextbook[\s\S]*return getTextbookById\(textbooks, draft\.textbookId \|\| draft\.requestedTextbookTitle\)/);
  assert.match(workspaceSource, /selectedBookReference\?\.textbook/);
  assert.match(workspaceSource, /selectedPurchaseTextbookId/);
  assert.match(workspaceSource, /readFreshPurchaseMembers/);
  assert.doesNotMatch(workspaceSource, /data\.textbooks/);
});

test("purchase order modal defaults student and teacher order quantities from grouped requests", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /const studentBaseQuantity = studentRequestedQuantity \|\| \(!teacherLine \? primaryRequestedQuantity : ""\)/);
  assert.match(workspaceSource, /const teacherBaseQuantity = teacherRequestedQuantity \|\| \(!studentLine \? primaryRequestedQuantity : ""\)/);
  assert.match(workspaceSource, /const nextStudentOrderedQuantity = nextStage === "request" \? studentOrderedQuantity : getPositivePurchaseQuantityText\(studentOrderedQuantity\) \|\| studentBaseQuantity/);
  assert.match(workspaceSource, /const nextTeacherOrderedQuantity = nextStage === "request" \? teacherOrderedQuantity : getPositivePurchaseQuantityText\(teacherOrderedQuantity\) \|\| teacherBaseQuantity/);
  assert.match(workspaceSource, /studentOrderedQuantity: nextStudentOrderedQuantity/);
  assert.match(workspaceSource, /teacherOrderedQuantity: nextTeacherOrderedQuantity/);
});

test("textbook workspace preserves inventory count safeguards", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  const safeguards = [
    /function getInventoryCurrentQuantityDraft\(row: InventoryCountRow\)/,
    /Math\.max\(0, numberValue\(row\.currentQuantity\)\)/,
    /function setInventoryCountDraft\(row: InventoryCountRow, value: string\)/,
    /setInventoryCountDrafts\(\(current\) => \(/,
    /normalizeQuantityInput\(value, \{ allowZero: true \}\)/,
    /function setInventoryCountMemoDraft\(row: InventoryCountRow, value: string\)/,
    /setInventoryCountMemoDrafts\(\(current\) => \(/,
    /normalizeInlineTextInput\(value\)/,
    /function clearInventoryCountDraft\(row: InventoryCountRow\)/,
    /const draftKey = getInventoryCountDraftKey\(row\.id, row\.locationId\)/,
    /delete next\[draftKey\]/,
    /const normalizedQuantity = normalizeQuantityInput\(countedQuantity, \{ allowZero: true \}\)/,
    /const normalizedMemo = normalizeStoredTextInput\(memo\)/,
    /if \(!normalizedQuantity\)/,
    /countedQuantity: normalizedQuantity/,
    /memo: normalizedMemo/,
    /const readyRows = rows\.filter\(\(row\) => \(/,
    /normalizeQuantityInput\(inventoryCountDrafts\[getInventoryCountDraftKey\(row\.id, row\.locationId\)\], \{ allowZero: true \}\)/,
    /quantity: normalizeQuantityInput\(inventoryCountDrafts\[key\], \{ allowZero: true \}\)/,
    /memo: normalizeStoredTextInput\(inventoryCountMemoDrafts\[key\]\)/,
    /onClearDraft=\{clearInventoryCountDraft\}/,
    /onClearDraft,/,
    /onClearDraft: \(row: InventoryCountRow\) => void/,
    /onClear=\{\(\) => onClearDraft\(row\)\}/,
    /onClear: \(\) => void/,
    /const hasDraftContent = Boolean\(text\(value\) \|\| text\(memoValue\)\)/,
    /pattern="\[0-9\]\*"/,
    /autoComplete="off"/,
    /enterKeyHint="done"/,
    /onBlur=\{\(event\) => onMemoChange\(row, normalizeStoredTextInput\(event\.target\.value\)\)\}/,
    /onBlur=\{\(event\) => onMemoChange\(normalizeStoredTextInput\(event\.target\.value\)\)\}/,
    /aria-label=\{hasDraftContent \? `\$\{row\.title\} \$\{row\.locationName\} 실사 입력 초기화`/,
    /onChange\(getInventoryCurrentQuantityDraft\(row\)\)/,
    /\{hasDraftContent \? "초기화" : "현재"\}/,
    /disabled=\{disabled \|\| saving \|\| !text\(value\)\}/,
    /selectedDraftRows/,
    /onSubmitBulkCount\?\.\(selectedDisplayRows\)/,
    /getInventoryCountSubmitLabel/,
    /PackageCheck/,
  ];

  for (const safeguard of safeguards) {
    assert.match(workspaceSource, safeguard);
  }
});

test("textbook workspace preserves sale issuing safeguards", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  const safeguards = [
    /saleStudentQuery/,
    /setSaleStudentQuery/,
    /const normalizedSaleChargeMonth = normalizeMonthInput\(saleForm\.chargeMonth\)/,
    /const saleStudentSearchQuery = normalizeStoredTextInput\(saleStudentQuery\)\.toLowerCase\(\)/,
    /const visibleSaleStudents = useMemo/,
    /getStudentGradeLabel\(student\)/,
    /const saleDuplicateLines = useMemo/,
    /classSaleContext\?\.duplicateLines/,
    /saleDuplicateStudentCount/,
    /saleDuplicateLines/,
    /const saleDuplicateStudentCount = useMemo/,
    /chargeMonth: normalizedSaleChargeMonth/,
    /saleDuplicateLines\.length > 0/,
    /이미 같은 월 출고가 있습니다/,
    /const visibleSaleStudentCount = visibleSaleStudents\.length/,
    /const visibleIncludedSaleStudentCount = visibleSaleStudents/,
    /if \(name === "chargeMonth"\)/,
    /if \(name === "memo"\)/,
    /function settleSaleMemo/,
    /function resetSaleForm/,
    /setSaleStudentQuery\(""\)/,
    /function openNewSaleDialog\(\)[\s\S]*resetSaleForm\(\)/,
    /function closeSaleDialog\(\)[\s\S]*resetSaleForm\(\)/,
    /setSaleField\("classId", value\);[\s\S]*setSaleStudentQuery\(""\)/,
    /placeholder="학생 검색"/,
    /aria-label="출고 학생 검색"/,
    /enterKeyHint="search"/,
    /visibleIncludedSaleStudentCount/,
    /visibleSaleStudentCount/,
    /visibleSaleStudents\.length > 0 \? visibleSaleStudents\.map/,
    /검색된 학생이 없습니다/,
    /<Textarea[\s\S]*value=\{saleForm\.memo\}/,
    /onBlur=\{settleSaleMemo\}/,
    /aria-label="출고 메모"/,
    /role="alert"/,
    /setActionErrorMessage\("이미 같은 월에 같은 수업·교재 출고가 있습니다/,
    /const salePayload = \{/,
    /memo: normalizeStoredTextInput\(saleForm\.memo\)/,
    /const visibleTotalAmount = summary\?\.totalAmount \?\? null/,
    /const frozenFilters = \{ \.\.\.acceptedFilters \}/,
    /aria-label="메이크에듀 청구 준비 열기"/,
  ];

  const handoffSafeguards = [/function normalizeMonthInput/, /function getSaleLineQuantity/, /function getSaleLineUnitPrice/, /function getSaleLineAmount/, /function getSaleLineMonth/, /function getSaleLineStatus/, /function isBillableSaleLineStatus/];
  assert.equal(safeguards.length + handoffSafeguards.length, 48);
  for (const safeguard of handoffSafeguards) assert.match(handoffModelSource, safeguard);
  for (const safeguard of safeguards) {
    assert.match(workspaceSource, safeguard);
  }
});

test("textbook workspace keeps completed sale actions visible after status changes", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /function getSaleLineTextbookTitle\(line: Row\)/);
  assert.match(workspaceSource, /function getSaleStatusFilterAfterAction\(status: "issued" \| "returned"\): SalesProcessFilter/);
  assert.match(workspaceSource, /return status === "returned" \? "returned" : "issued"/);
  assert.match(workspaceSource, /function showUpdatedSaleLine\(line: Row, status: "issued" \| "returned"\)/);
  assert.match(workspaceSource, /setSalesProcessFilter\(getSaleStatusFilterAfterAction\(status\)\)/);
  assert.match(workspaceSource, /updateOperationSearchQuery\(title\)/);
  assert.match(workspaceSource, /updateSaleLineStatus\(line: Row, status: "issued" \| "returned"\)[\s\S]*\.then\(\(ok\) => \{/);
  assert.match(workspaceSource, /showUpdatedSaleLine\(line, status\)/);
  assert.match(workspaceSource, /const returnedTextbookTitles = \[\.\.\.new Set\(selectedReturnableSaleLines/);
  assert.match(workspaceSource, /setSalesProcessFilter\("returned"\)/);
  assert.match(workspaceSource, /updateOperationSearchQuery\(returnedTextbookTitles\[0\]\)/);
});

test("textbook workspace locks 50 cleanup confirmation safeguards", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  const safeguards = [
    /function getTextbookDeleteResultMessage/,
    /result: \{ deletedIds\?: string\[\]; archivedIds\?: string\[\] \} \| undefined/,
    /const deletedCount = result\?\.deletedIds\?\.length \|\| 0/,
    /const archivedCount = result\?\.archivedIds\?\.length \|\| 0/,
    /if \(!result\) \{/,
    /deletedCount > 0 && archivedCount > 0/,
    /if \(archivedCount > 0\) \{/,
    /function buildTextbookCleanupPreviewRows/,
    /getTextbookTitle\(row\) \|\| "교재명 없음"/,
    /getPublisherLabel\(row\)/,
    /getCategoryLabel\(row\)/,
    /normalizeStatusValue\(row\.status\) === "inactive" \? "미사용" : "사용중"/,
    /id: getRecordId\(row\) \|\| title/,
    /const selectedTextbookRows = useMemo/,
    /selectedTextbookIds\s*\.map\(\(id\) => inventoryById\.get\(id\)\)/,
    /const selectedTextbookCleanupRows = useMemo/,
    /buildTextbookCleanupPreviewRows\(selectedTextbookRows\)/,
    /const textbookCleanupPreviewRef = useRef<TextbookConfirmationPreviewItem\[]>\(\[]\)/,
    /textbookCleanupPreviewRef\.current = selectedTextbookCleanupRows/,
    /function deleteSelectedTextbooks/,
    /if \(selectedTextbookRows\.length === 0\) \{/,
    /setTextbookDeleteDialogOpen\(true\)/,
    /async function confirmDeleteSelectedTextbooks/,
    /executeTextbookConfirmation\(confirmDeleteSelectedTextbooks/,
    /const targetIds = \[\.\.\.selectedTextbookIds\]/,
    /const targetCount = selectedTextbookRows\.length/,
    /const shouldClearSearchAfterDelete = Boolean\(text\(query\)\)/,
    /filteredInventory\.every\(\(row\) => targetIds\.includes\(getRecordId\(row\)\)\)/,
    /deleteResult = await textbookService\.deleteTextbookMasters\(targetIds\)/,
    /updateMasterSearchQuery\(""\)/,
    /clearMasterSelection\(\)/,
    /getTextbookDeleteResultMessage\(deleteResult, targetCount\)/,
    /<ConfirmationDialogContent/,
    /title="선택 교재 정리"/,
    /formatQuantity\(textbookCleanupPreviewRef\.current\.length\)/,
    /재고·주문·출고 이력이 있으면 기록 보존을 위해 미사용으로 전환됩니다/,
    /items=\{textbookCleanupPreviewRef\.current\}/,
    /itemsLabel="정리 대상 교재"/,
    /confirmLabel="정리 실행"/,
    /busy=\{confirmationBusy\}/,
    /error=\{actionErrorMessage \|\| confirmationError\}/,
    /returnFocusRef=\{dialogOpenerRef\}/,
    /if \(confirmationPendingRef\.current\) return/,
    /confirmationPendingRef\.current = true/,
    /const ok = await action\(\)/,
    /if \(ok\) \{/,
    /선택 교재 삭제/,
    /선택 교재 선택 해제/,
    /setSelectedTextbookIds\(\[\]\)/,
    /교재를 삭제했습니다/,
  ];

  assert.equal(safeguards.length, 50);
  for (const [index, safeguard] of safeguards.entries()) {
    assert.match(index >= 7 && index <= 12 ? referenceModelSource : workspaceSource, safeguard);
  }
});

test("textbook workspace locks 50 saved purchase visibility safeguards", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  const safeguards = [
    /function getSavedPurchaseRequestFilter/,
    /stage: string, hasCatalogTextbook: boolean/,
    /if \(stage !== "request"\) return "all"/,
    /return hasCatalogTextbook \? "orderable" : "unregistered"/,
    /function getSavedPurchaseOrderFilter/,
    /if \(stage === "request"\) \{/,
    /return hasCatalogTextbook \? "waiting" : "all"/,
    /if \(stage === "order"\) return "waiting"/,
    /function getSavedPurchaseBoardScope/,
    /return stage === "receive" \? "recent" : "active"/,
    /function showSavedPurchaseFlow/,
    /setActiveTab\(canManageTextbookOperations \? "purchase" : "requests"\)/,
    /updateOperationSearchQuery\(title\)/,
    /setPurchaseBoardScope\(getSavedPurchaseBoardScope\(stage\)\)/,
    /setPurchaseRequestFilter\(canManageTextbookOperations \? getSavedPurchaseRequestFilter\(stage, hasCatalogTextbook\) : "all"\)/,
    /setPurchaseOrderFilter\(getSavedPurchaseOrderFilter\(stage, hasCatalogTextbook\)\)/,
    /operationSearchRef\.current\?\.select\(\)/,
    /const selectedPurchaseTextbookId = getRecordId\(selectedPurchaseTextbook \|\| \{\}\)/,
    /const completedPurchaseStage = purchaseForm\.requestStage/,
    /const completedPurchaseTitle = purchaseRequestTitle/,
    /const completedPurchaseHasCatalogTextbook = Boolean\(selectedPurchaseTextbookId\)/,
    /showSavedPurchaseFlow\(completedPurchaseStage, completedPurchaseTitle, completedPurchaseHasCatalogTextbook\)/,
    /setPurchaseDialogOpen\(false\)/,
    /setSelectedPurchaseLineId\(""\)/,
    /setPurchaseForm\(emptyPurchaseForm\)/,
    /textbookId: selectedPurchaseTextbookId/,
    /requestedTextbookTitle: normalizeStoredTextInput\(purchaseRequestTitle\)/,
    /const fresh = await getTextbookPurchaseDetail\(directSnapshot\.input\)[\s\S]*await textbookService\.updatePurchaseLifecycle\(applyConfiguredPurchasePricingToPayload/,
    /textbookService\.createPurchaseReceipt\(purchasePayload\)/,
    /purchaseActionLabel\(purchaseForm\.requestStage\)/,
    /requestFilter=\{purchaseRequestFilter\}/,
    /orderFilter=\{purchaseOrderFilter\}/,
    /const activePrimaryState =/,
    /activeTab === "purchase" \? numbered\.purchase/,
    /requestFilterOptions/,
    /DataTableSelectFilter/,
    /purchaseFiltersAreDefault/,
    /filtersChanging/,
    /purchaseProcessFilterCounts\?\.request\[option\.value\]/,
    /purchaseProcessFilterCounts\?\.order\[value\]/,
    /purchaseProcessFilterCounts\?\.boardScope\[value\]/,
    /getPurchaseProcessEmptyLabel/,
    /getPurchaseProcessEmptyHint/,
    /검색어를 지우면 현재 탭의 전체 흐름을 다시 볼 수 있습니다/,
    /onClearSearch=\{\(\) => updateOperationSearchQuery\(""\)\}/,
    /placeholder=\{operationSearchPlaceholder\}/,
    /label=\{operationSearchLabel\}/,
    /return "주문 교재명, 총판, 수업"/,
    /return "요청 교재명, 수업, 요청자"/,
    /value=\{operationQuery\}/,
  ];

  assert.equal(safeguards.length, 50);
  for (const safeguard of safeguards) {
    assert.match(workspaceSource, safeguard);
  }
  assert.match(dataTableSearchFieldSource, /clearLabel = `\$\{label\} 초기화`/);
  assert.match(dataTableSearchFieldSource, /aria-label=\{clearLabel\}/);
});

test("textbook workspace keeps destructive confirmation previews on prepared and freshly rechecked members", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  const safeguards = [
    /type TextbookConfirmationPreviewItem = \{/,
    /detail: string/,
    /items\?: TextbookConfirmationPreviewItem\[\]/,
    /function getPurchaseConfirmationItems\(line: Row, order: Row \| undefined, references\?: TextbookPurchaseCaseRow\["references"\]\): TextbookConfirmationPreviewItem\[\]/,
    /const draft = buildPurchaseCardDraft\(line, order\)/,
    /const prepared = preparedPurchaseRows\.find/,
    /const textbook = references\?\.textbook \|\| prepared\?\.references\.textbook/,
    /const classRecord = references\?\.class \|\| prepared\?\.references\.class/,
    /function getSaleDetailConfirmationItems\(rows: SaleLineRow\[\]\)/,
    /row\.recipientName \|\| "대상 미지정"/,
    /getTextbookCopyScopeLabel\(row\.line\.copy_scope\)/,
    /readFreshPurchaseMembers\(\[line\], mode\)/,
    /readFreshPurchaseMembers\(\[line\], "order"\)/,
    /readFreshSaleDetails\(\[line\]\)/,
    /const \[rechecked\] = await readFreshSaleDetails/,
    /items: scopeLines\.flatMap/,
    /items: detail\.lines\.flatMap/,
    /items: getSaleDetailConfirmationItems\(\[detail\]\)/,
    /totalCount\?: number/,
    /totalCount: context\.totalCount/,
    /items=\{confirmationRequest\.items\}/,
    /totalCount=\{confirmationRequest\.totalCount\}/,
  ];

  for (const safeguard of safeguards) {
    assert.match(workspaceSource, safeguard);
  }
  for (const safeguard of [
    /role=\{confirmation \? "alertdialog" : "dialog"\}/,
    /onInteractOutside=\{confirmation \? \(event\) => event\.preventDefault\(\) : undefined\}/,
    /onEscapeKeyDown=\{busy && confirmation \? \(event\) => event\.preventDefault\(\) : undefined\}/,
    /const visibleItems = items\.slice\(0, 5\)/,
    /const remaining = Math\.max\(0, totalCount - visibleItems\.length\)/,
    /<ul aria-label=\{itemsLabel\}/,
    /break-words text-sm font-medium/,
    /remaining\.toLocaleString\("ko-KR"\)/,
    /disabled=\{busy\} aria-label=\{`\$\{title\} 취소`\}/,
    /aria-label=\{`\$\{title\} \$\{confirmLabel\}`\}/,
  ]) assert.match(formDialogSource, safeguard);
  assert.doesNotMatch(workspaceSource, /data\.(?:textbooks|classes|students|sales)/);
});

test("textbook master saves required multi-value taxonomy", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(
    new URL("src/features/textbooks/textbook-service.ts", root),
    "utf8",
  );

  assert.match(serviceSource, /validateTextbookTaxonomy/);
  assert.match(serviceSource, /school_levels: taxonomy\.schoolLevels/);
  assert.match(serviceSource, /grade_levels: taxonomy\.gradeLevels/);
  assert.match(serviceSource, /school_level: taxonomy\.schoolLevels\[0\]/);
  assert.match(serviceSource, /grade_level: taxonomy\.gradeLevels\[0\]/);
  assert.match(workspaceSource, /schoolLevels: \[\]/);
  assert.match(workspaceSource, /gradeLevels: \[\]/);
  assert.match(workspaceSource, /toggleTextbookSchoolLevel/);
  assert.match(workspaceSource, /toggleTextbookGradeLevel/);
  assert.match(workspaceSource, /!masterTaxonomyValidation.valid \? masterTaxonomyValidation.message/);




  assert.doesNotMatch(
    workspaceSource,
    /<SelectItem value="none">미지정<\/SelectItem>[\s\S]{0,500}학교 구분/,
  );
});

test("textbook master list and filters use taxonomy arrays", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const taxonomySource = await readFile(
    new URL("src/features/textbooks/textbook-taxonomy.ts", root),
    "utf8",
  );

  assert.match(workspaceSource, /getTextbookSchoolLevelSummary/);
  assert.match(workspaceSource, /getTextbookGradeSummary/);
  assert.doesNotMatch(workspaceSource, /matchesTextbookTaxonomy/);
  assert.match(workspaceSource, /schoolLevel: schoolLevelGroupFilter/);
  assert.match(taxonomySource, /초·중·고/);
  assert.match(taxonomySource, /전 학년/);
  assert.doesNotMatch(
    workspaceSource,
    /getTextbookGradeLabel\(getTextbookGradeLevel\(row\)\) \|\| getTextbookSchoolLevelLabel/,
  );
});
