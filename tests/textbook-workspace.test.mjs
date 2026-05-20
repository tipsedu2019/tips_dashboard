import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildSaleLineStatusTransition,
  buildTextbookMonthlyClosing,
  buildTextbookSaleDraft,
  getTextbookPurchaseUnitCost,
  getTextbookUnitMargin,
} from "../src/features/textbooks/textbook-ledger.js";

const root = new URL("../", import.meta.url);

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
  assert.match(workspaceSource, /TabsTrigger value="closing"/);
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
  assert.doesNotMatch(workspaceSource, /onClickCapture=\{\(event\) => \{/);
  assert.match(workspaceSource, /onClick=\{closePurchaseDialog\}/);
  assert.match(workspaceSource, /window\.setTimeout\(\(\) => setPurchaseDialogOpen\(false\), 0\)/);
  assert.match(workspaceSource, /window\.setTimeout\(\(\) => setSaleDialogOpen\(false\), 0\)/);
  assert.match(workspaceSource, /window\.setTimeout\(\(\) => setClosingDialogOpen\(false\), 0\)/);
  assert.match(workspaceSource, /\{purchaseDialogOpen \? \(/);
  assert.match(workspaceSource, /\{bulkOrderDialogOpen \? \(/);
  assert.match(workspaceSource, /\{saleDialogOpen \? \(/);
  assert.match(workspaceSource, /\{closingDialogOpen \? \(/);
  assert.match(workspaceSource, /w-\[calc\(100vw-2rem\)\] overflow-x-hidden overflow-y-auto sm:max-w-2xl/);
  assert.match(workspaceSource, /w-\[calc\(100vw-2rem\)\] overflow-x-hidden overflow-y-auto sm:max-w-xl/);
  assert.ok(srOnlyCaptionCount >= 4);
  assert.match(workspaceSource, /<caption className="sr-only">재고 실사 입력 목록<\/caption>/);
  assert.match(workspaceSource, /<caption className="sr-only">교재 마스터 목록<\/caption>/);
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
  assert.match(workspaceSource, /function buildSaleHistorySummaryRows/);
  assert.match(workspaceSource, /function SalesHistoryLedger/);
  assert.match(workspaceSource, /const salesHistorySummary = useMemo/);
  assert.match(workspaceSource, /const filteredRows: Array<\(typeof rows\)\[number\]> = \[\]/);
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
  assert.match(workspaceSource, /aria-label="검색 초기화"/);
  assert.match(workspaceSource, /aria-label="교재 검색"/);
  assert.ok(
    workspaceSource.indexOf('TabsList className="grid h-auto w-full grid-cols-5') <
      workspaceSource.indexOf('aria-label="교재 검색"'),
  );
  assert.match(workspaceSource, /activeTab === "master"[\s\S]*신규 등록/);
  assert.doesNotMatch(workspaceSource, /<TabsContent value="master" className="mt-4 grid gap-4">[\s\S]*<Plus className="mr-2 size-4" \/>[\s\S]*신규 등록/);
  assert.match(workspaceSource, /inventoryFilter/);
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
  assert.match(workspaceSource, /normalizeSubjectValue/);
  assert.match(workspaceSource, /getSubjectLabel\(row\.subject\)/);
  assert.match(workspaceSource, /const \[activeTab, setActiveTab\] = useState\("master"\)/);
  assert.match(workspaceSource, /showsInventoryTools/);
  assert.match(workspaceSource, /function changeActiveTab/);
  assert.match(workspaceSource, /재고 없음/);
  assert.match(workspaceSource, /purchaseSubmitDisabled/);
  assert.match(workspaceSource, /submitInlineStockCount/);
});

test("textbook workspace resolves reviewed master and inventory UX issues", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /TabsList[\s\S]*aria-label="교재관리 업무 탭"/);
  assert.match(workspaceSource, /TextbookListControls/);
  assert.match(workspaceSource, /분류 필터/);
  assert.match(workspaceSource, /subjectGroupFilter/);
  assert.match(workspaceSource, /schoolLevelGroupFilter/);
  assert.match(workspaceSource, /gradeLevelGroupFilter/);
  assert.match(workspaceSource, /getTextbookGroupLabel/);
  assert.doesNotMatch(workspaceSource, /TextbookGroupMode/);
  assert.doesNotMatch(workspaceSource, /publisherGroupFilter/);
  assert.match(workspaceSource, /amountMode="salePrice"/);
  assert.match(workspaceSource, /판매가/);
  assert.match(workspaceSource, /재고금액/);
  assert.match(workspaceSource, /data-\[state=active\]:bg-primary/);
  assert.match(workspaceSource, /masterDialogOpen/);
  assert.match(workspaceSource, /openNewMasterDialog/);
  assert.match(workspaceSource, /DialogTitle>\{masterForm\.id \? "교재 수정" : "교재 신규 등록"\}/);
  assert.match(workspaceSource, /overflow-x-hidden overflow-y-auto sm:max-w-3xl/);
  assert.match(workspaceSource, /sm:grid-cols-\[minmax\(0,1fr\)_140px_140px\]/);
  assert.match(workspaceSource, /sm:grid-cols-2 lg:grid-cols-5/);
  assert.match(workspaceSource, /학교 구분/);
  assert.match(workspaceSource, /세부과목/);
  assert.match(workspaceSource, /전체 학년/);
  assert.match(workspaceSource, /buildTextbookCategoryValue/);
  assert.match(workspaceSource, /list="textbook-publisher-options"/);
  assert.match(workspaceSource, /placeholder="예: 쎈 고등 수학 2"/);
  assert.match(workspaceSource, /placeholder="예: 신사고"/);
  assert.match(workspaceSource, /placeholder="13자리 ISBN"/);
  assert.match(workspaceSource, /placeholder="스캔 또는 입력"/);
  assert.match(workspaceSource, /autoFocus/);
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
  assert.match(workspaceSource, /if \(categoryGroupFilter !== "all" && getTextbookSubSubject\(row\) !== categoryGroupFilter\) return false/);
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
  const serviceSource = await readFile(new URL("src/features/textbooks/textbook-service.ts", root), "utf8");
  const navigationSource = await readFile(new URL("src/lib/navigation.ts", root), "utf8");
  const migrationSource = await readFile(
    new URL("supabase/migrations/20260501100000_textbook_taxonomy_settings.sql", root),
    "utf8",
  );

  assert.match(navigationSource, /title: "교재 설정"/);
  assert.match(settingsSource, /SubSubjectSettingsPanel/);
  assert.match(settingsSource, /textbook_sub_subject_settings/);
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
  assert.match(serviceSource, /school_level: text\(record\.schoolLevel/);
  assert.match(serviceSource, /sub_subject: text\(record\.subSubject/);
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
  assert.match(workspaceSource, /TextbookBulkActionBar/);
  assert.match(workspaceSource, /bulkPatchControlsOpen/);
  assert.match(workspaceSource, /const showPatchControls = bulkPatchControlsOpen \|\| hasPatch/);
  assert.match(workspaceSource, /aria-controls=\{patchControlsId\}/);
  assert.match(workspaceSource, />\s*속성 변경\s*<\/Button>/);
  assert.match(workspaceSource, /showPatchControls \? \(/);
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
  assert.match(workspaceSource, /inventoryById\.get\(saleForm\.textbookId\)/);
  assert.match(workspaceSource, /const availableIds = new Set\(filteredInventory\.map\(getRecordId\)\.filter\(Boolean\)\)/);
  assert.match(workspaceSource, /setSelectedTextbookIds\(\(current\) => \{[\s\S]*availableIds\.has\(id\)/);
  assert.match(workspaceSource, /const visibleTextbookIdSet = useMemo\(\(\) => new Set\(visibleTextbookIds\), \[visibleTextbookIds\]\)/);
  assert.match(workspaceSource, /visibleTextbookIdSet\.has\(id\)/);
  assert.match(workspaceSource, /function toggleVisiblePurchaseLineSelection/);
  assert.match(workspaceSource, /function toggleVisibleSaleLineSelection/);
  assert.match(workspaceSource, /function toggleVisibleClosingSelection/);
  assert.match(workspaceSource, /const idSet = new Set\(ids\)/);
  assert.match(workspaceSource, /idSet\.has\(id\)/);
  assert.match(workspaceSource, /textbookQualityIssueFilterKeys/);
  assert.match(workspaceSource, /for \(const row of listFilteredInventory\)/);
  assert.match(workspaceSource, /\[content-visibility:auto\]/);
  assert.doesNotMatch(workspaceSource, /document\.addEventListener\("pointerdown", closeFromNativeEvent, true\)/);
  assert.match(workspaceSource, /window\.setTimeout\(\(\) => setMasterDialogOpen\(false\), 0\)/);
  assert.match(workspaceSource, /\{masterDialogOpen \? \(/);
  assert.match(workspaceSource, /조건에 맞는 교재가 없습니다/);
  assert.match(workspaceSource, /getTextbookIdentityLabel/);
  assert.match(workspaceSource, /aria-label=\{`\$\{rowA11yLabel\} 선택`\}/);
  assert.doesNotMatch(workspaceSource, /aria-label=\{`\$\{getTextbookTitle\(row\)\} \$\{getPublisherLabel\(row\)\} \$\{rowId\} 선택`\}/);
  assert.match(workspaceSource, /onBulkSelectionChange/);
  assert.match(workspaceSource, /categoryOptions=\{bulkCategoryOptions\}/);
  assert.match(workspaceSource, /gradeLevelOptions=\{bulkGradeOptions\}/);
  assert.match(workspaceSource, /schoolLevel: "keep"/);
  assert.match(workspaceSource, /gradeLevel: "keep"/);
  assert.match(workspaceSource, /patch\.schoolLevel !== "keep"/);
  assert.match(workspaceSource, /patch\.gradeLevel !== "keep"/);
  assert.match(workspaceSource, /buildTextbookCategoryValue\(\{[\s\S]*schoolLevel: nextSchoolLevel[\s\S]*gradeLevel: nextGradeLevel[\s\S]*subSubject: nextSubSubject/);
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
  assert.match(serviceSource, /buildSaleLineStatusTransition/);
  assert.match(serviceSource, /updateSaleLineStatus/);
});

test("textbook workspace exports supplier orders and MakeEdu billing handoffs", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /captureElementAsPngBlob/);
  assert.match(workspaceSource, /downloadBlob/);
  assert.match(workspaceSource, /function TextbookHandoffDialog/);
  assert.match(workspaceSource, /function buildPurchaseSupplierHandoffGroups/);
  assert.match(workspaceSource, /function buildMakeEduBillingHandoffGroups/);
  assert.match(workspaceSource, /공급처별 주문 전달 열기/);
  assert.match(workspaceSource, /메이크에듀 청구 준비 열기/);
  assert.match(workspaceSource, /전체 복사/);
  assert.match(workspaceSource, /이미지/);
  assert.match(workspaceSource, /PDF/);
  assert.match(workspaceSource, /수납명:/);
  assert.match(workspaceSource, /수납시작:/);
  assert.match(workspaceSource, /반복: 1회/);
  assert.match(workspaceSource, /ClipboardItem/);
  assert.match(workspaceSource, /window\.print/);
  assert.match(workspaceSource, /getSupplierContact/);
  assert.match(workspaceSource, /getStudentGradeLabel/);
  assert.doesNotMatch(workspaceSource, /syncMakeEduTextbookPayments/);
  assert.doesNotMatch(workspaceSource, /makeEduImportDialogOpen/);
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
  assert.match(workspaceSource, /Table className="w-full min-w-\[980px\]"/);
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
  assert.match(workspaceSource, /authLoading/);
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
  assert.match(workspaceSource, /shouldShowPurchaseLineOnBoard/);
  assert.match(workspaceSource, /min-w-0 overflow-hidden rounded-lg border bg-background/);
  assert.match(workspaceSource, /aria-label="교재 요청 추가"[\s\S]*onClick=\{onAddLine\}/);
  assert.match(workspaceSource, /mode === "request" \? "w-full min-w-\[1040px\]" : "w-full min-w-\[1200px\]"/);
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
  assert.match(workspaceSource, /sm:grid-cols-\[minmax\(0,1fr\)_160px\]/);
  assert.match(workspaceSource, /<Field label="선생님">/);
  assert.match(workspaceSource, /ariaLabel="선생님 선택"/);
  assert.match(workspaceSource, /textbookId: selectedPurchaseTextbookId \|\| purchaseForm\.textbookId/);
  assert.match(workspaceSource, /aria-label="요청 교재명"/);
  assert.match(workspaceSource, /getRequestedTextbookTitle/);
  assert.match(workspaceSource, /getPurchaseTextbookTitle/);
  assert.match(workspaceSource, /openMasterFromPurchaseRequest/);
  assert.match(workspaceSource, /activeTab === "purchase" && purchaseRequestFilter === "unregistered"/);
  assert.match(workspaceSource, /setActiveTab\("purchase"\)[\s\S]*setPurchaseRequestFilter\("unregistered"\)/);
  assert.match(workspaceSource, /const visibleRequestFilterOptions = mode === "order"/);
  assert.match(workspaceSource, /const isMissingTextbookRequest = status === "requested" && !textbook/);
  assert.match(workspaceSource, /mode === "order" && isMissingTextbookRequest/);
  assert.match(workspaceSource, /마스터 등록/);
  assert.match(workspaceSource, /buildKyoboSearchUrl/);
  assert.match(workspaceSource, /교보 검색/);
  assert.match(workspaceSource, /const isSelectablePurchaseLine = mode === "order" &&/);
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

test("purchase requests are linked to classes and compare quantity against roster size", async () => {
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
  assert.match(workspaceSource, /selectedPurchaseClass/);
  assert.match(workspaceSource, /purchaseClassStudentCount/);
  assert.match(workspaceSource, /getPurchaseQuantityClassFit/);
  assert.match(workspaceSource, /ClassSelect classes=\{data\.classes\} value=\{purchaseForm\.classId\}/);
  assert.match(workspaceSource, /학생 \$\{formatQuantity\(purchaseClassStudentCount\)\}명/);
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
  assert.match(workspaceSource, /purchaseFieldVisibility\.classFit/);
  assert.match(workspaceSource, /\{purchaseFieldVisibility\.location \? \(/);
  assert.match(workspaceSource, /configuredPurchaseSupplierId/);
  assert.match(workspaceSource, /configuredPurchaseUnitCost/);
  assert.doesNotMatch(workspaceSource, /purchaseFieldVisibility\.supplier/);
  assert.doesNotMatch(workspaceSource, /purchaseFieldVisibility\.unitCost/);
  assert.doesNotMatch(workspaceSource, /setPurchaseField\("supplierId"/);
  assert.doesNotMatch(workspaceSource, /setPurchaseField\("unitCost"/);
});

test("purchase process derives supplier and unit cost from settings and separates location", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const tableSource = workspaceSource.slice(workspaceSource.indexOf("function PurchaseProcessTable"));

  assert.match(workspaceSource, /getConfiguredSupplierIdForTextbook/);
  assert.match(workspaceSource, /getPublisherIdForTextbook/);
  assert.match(workspaceSource, /normalizeTextbookLookup/);
  assert.match(workspaceSource, /getTextbookTitle\(textbook\)/);
  assert.match(workspaceSource, /publisherSupplierLinks=\{data\.publisherSupplierLinks\}/);
  assert.match(workspaceSource, /publishers=\{data\.publishers\}/);
  assert.match(tableSource, /publisherSupplierLinks: Row\[\]/);
  assert.match(tableSource, /publishers: Row\[\]/);
  assert.match(tableSource, /const configuredSupplierId = getConfiguredSupplierIdForTextbook\(textbook, publisherSupplierLinks, publishers\) \|\| draft\.supplierId/);
  assert.match(tableSource, /const unitCost = getConfiguredTextbookPurchaseUnitCost\(textbook, configuredSupplierId, suppliers, draft\.unitCost\)/);
  assert.match(tableSource, /TableHead className="w-\[96px\] text-right">단가/);
  assert.match(tableSource, /TableHead className="w-\[88px\]">위치/);
  assert.match(tableSource, /<TableCell className="max-w-\[88px\] truncate" title=\{locationName\}>\{locationName\}<\/TableCell>/);
  assert.doesNotMatch(tableSource, /<div className="text-xs text-muted-foreground">\{getLocationName\(locations, draft\.locationId\)/);
});

test("textbook workspace keeps margin pricing inside closing surfaces only", async () => {
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
  assert.match(workspaceSource, /closingTeamMarginMetrics/);
  assert.match(workspaceSource, /<Metric label="마진" value=\{closingNeedsMemo \? "사유 필요" : formatCurrency\(closingPreview\.textbookMarginAmount\)\}/);
  assert.match(workspaceSource, /function ClosingDetailDialog/);
  assert.match(workspaceSource, /const textbookLookup = useMemo\(\(\) => buildTextbookLookupMap\(textbooks\), \[textbooks\]\)/);
  assert.match(workspaceSource, /const locationNameLookup = useMemo\(\(\) => buildLocationNameLookup\(locations\), \[locations\]\)/);
  assert.match(workspaceSource, /getTextbookFromLookup\(textbookLookup, move\.textbook_id \|\| move\.textbookId\)/);
  assert.match(workspaceSource, /getLocationNameFromLookup\(locationNameLookup, move\.location_id \|\| move\.locationId\)/);
  assert.match(workspaceSource, /<Metric label="마진" value=\{formatCurrency\(detailClosing\.textbookMarginAmount\)\}/);
  assert.match(workspaceSource, /label=\{`\$\{getSubjectLabel\(item\.team\)\}팀`\}/);
  assert.match(workspaceSource, /const closingTargetSubjects = closingForm\.subject === "all" \? \["all", "english", "math"\] : \[closingForm\.subject\]/);
  assert.match(workspaceSource, /closingTargetSubjects\.map/);
  assert.match(workspaceSource, /<Metric label="저장" value=\{`\$\{formatQuantity\(closingTargetSubjects\.length\)\}건`\}/);
  assert.match(workspaceSource, /aria-label="월마감 추가"/);
  assert.match(workspaceSource, /aria-label=\{`\$\{text\(row\.closing_month\)\} \$\{text\(row\.subject\) === "all" \? "전체" : getSubjectLabel\(row\.subject\)\} 정산 상세 열기`\}/);
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
  assert.match(workspaceSource, /const configuredPurchaseTotalCost = configuredPurchaseUnitCost \* purchaseStageQuantity/);
  assert.match(workspaceSource, /const saleProjectedAmount = saleDraft\.totalAmount/);
  assert.match(workspaceSource, /const saleProjectedEndingQuantity = saleDraft\.availableQuantity - saleDraft\.totalQuantity/);
  assert.match(workspaceSource, /<Metric label="합계" value=\{configuredPurchaseTotalCost > 0 \? formatCurrency\(configuredPurchaseTotalCost\) : "-"\}/);
  assert.match(workspaceSource, /<Metric\s+label="입고 후"[\s\S]*purchaseProjectedLocationQuantity/);
  assert.match(workspaceSource, /<Metric label="대상" value=\{`\$\{formatQuantity\(includedSaleStudentCount\)\}명`\}/);
  assert.match(workspaceSource, /<Metric\s+label="출고 후"[\s\S]*saleProjectedEndingQuantity/);
  assert.match(workspaceSource, /<Metric label="청구" value=\{saleProjectedAmount > 0 \? formatCurrency\(saleProjectedAmount\) : "-"\}/);
  assert.match(workspaceSource, /setOperationQuery\(completedPurchaseTitle\)/);
  assert.match(workspaceSource, /setPurchaseRequestFilter\("orderable"\)/);
  assert.match(workspaceSource, /setPurchaseBoardScope\("recent"\)/);
  assert.match(workspaceSource, /setSalesProcessFilter\("waiting"\)/);
  assert.match(workspaceSource, /setSalesProcessFilter\("issued"\)/);
  assert.match(workspaceSource, /setInventoryAuditFilter\("done"\)/);
});

test("purchase process resolves supplier links by publisher name and exposes shared column settings", async () => {
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
  const supplierResolverSource = workspaceSource.slice(
    workspaceSource.indexOf("function getPublisherIdForTextbook"),
    workspaceSource.indexOf("function normalizeTextbookLookup"),
  );
  const tableSource = workspaceSource.slice(workspaceSource.indexOf("function PurchaseProcessTable"));

  assert.match(supplierResolverSource, /textbook\.publisher_id \|\| textbook\.publisherId/);
  assert.match(supplierResolverSource, /getKnownPublisherLabel\(textbook\)/);
  assert.match(supplierResolverSource, /publishers\.find/);
  assert.match(workspaceSource, /getConfiguredSupplierIdForTextbook\(selectedPurchaseTextbook, data\.publisherSupplierLinks, data\.publishers\)/);
  assert.match(tableSource, /buildPurchaseProcessColumns\(mode, showBulkPurchaseSelection\)/);
  assert.match(tableSource, /useDataTableColumns\(`textbook-purchase-process-\$\{mode\}`/);
  assert.match(tableSource, /columnSettingsControl/);
  assert.match(tableSource, /isPurchaseColumnVisible\("supplier"\)/);
  assert.match(tableSource, /aria-colcount=\{visiblePurchaseColumnCount\}/);
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

  assert.match(workspaceSource, /getDefaultTeacherForClass/);
  assert.match(workspaceSource, /splitTeacherNames/);
  assert.match(workspaceSource, /name === "classId"/);
  assert.match(workspaceSource, /previousTeacher/);
  assert.match(workspaceSource, /nextTeacher/);
  assert.match(workspaceSource, /shouldDefaultTeacher/);
  assert.match(workspaceSource, /requestBy: shouldDefaultTeacher \? nextTeacher : current\.requestBy/);
  assert.match(workspaceSource, /inferClassLocationId\(nextClass, locations\)/);
  assert.match(workspaceSource, /locationId: nextLocationId \|\| current\.locationId/);
  assert.match(workspaceSource, /ariaLabel=\{purchaseForm\.requestStage === "request" \? "요청 위치 선택" : "입고 위치 선택"\}/);
  assert.match(workspaceSource, /<TeacherSelect[\s\S]*onValueChange=\{\(value\) => setPurchaseField\("requestBy", value\)\}/);
});

test("purchase process rows stay database-style and open the modal for editing", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );
  const tableSource = workspaceSource.slice(workspaceSource.indexOf("function PurchaseProcessTable"));

  assert.match(tableSource, /mode === "request" \? "w-full min-w-\[1040px\]" : "w-full min-w-\[1200px\]"/);
  assert.match(tableSource, /TableHead className="w-\[96px\] text-right">단가/);
  assert.match(tableSource, /TableHead className="w-\[88px\]">위치/);
  assert.match(tableSource, /TableHead className="w-\[72px\] text-right">요청/);
  assert.match(tableSource, /TableHead className="w-\[72px\] text-right">주문/);
  assert.match(tableSource, /TableHead className="w-\[72px\] text-right">입고/);
  assert.match(tableSource, /수정/);
  assert.match(tableSource, /purchaseProcessAction\(status\)/);
  assert.match(tableSource, /onSelectLine\(line, order, processAction\.stage\)/);
  assert.match(tableSource, /processAction\?\.label \|\| "이동"/);
  assert.doesNotMatch(tableSource, /다음/);
  assert.match(tableSource, /합계/);
  assert.match(tableSource, /getPurchaseQuantityClassFit/);
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
  assert.match(workspaceSource, /DialogTitle>선택 요청 일괄 주문<\/DialogTitle>/);
  assert.match(workspaceSource, /선택한 요청을 공급처 주문 단계로 한꺼번에 전환합니다/);
  assert.match(workspaceSource, /draft\.orderedQuantity \|\| draft\.requestedQuantity \|\| "1"/);
  assert.match(workspaceSource, /const nextOrderedQuantity = nextStage === "request" \? orderedQuantity : orderedQuantity \|\| requestedQuantity \|\| "1"/);
  assert.match(workspaceSource, /<Metric label="요청" value=\{`\$\{formatQuantity\(purchaseForm\.requestedQuantity\)\}권`\}/);
  assert.match(tableSource, /일괄 처리 가능한 행 전체 선택/);
  assert.match(tableSource, /선택 주문/);
  assert.match(tableSource, /onToggleVisibleLines\?\.\(groupActionableLineIds, value === true\)/);
  assert.match(tableSource, /onToggleLine\?\.\(lineId, value === true\)/);
  assert.match(serviceSource, /created_by: createdBy/);
});

test("textbook workspace fixes second-round browser audit issues", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /useState<PurchaseBoardScope>\("active"\)/);
  assert.match(workspaceSource, /resetTextbookListFilters/);
  assert.match(workspaceSource, /필터 초기화/);
  assert.match(workspaceSource, /masterDuplicateRows/);
  assert.match(workspaceSource, /중복 의심/);
  assert.doesNotMatch(workspaceSource, /DialogClose/);
  assert.doesNotMatch(workspaceSource, /onPointerDown=\{\(event\) =>/);
  assert.doesNotMatch(workspaceSource, /event\.preventDefault\(\);[\s\S]*closePurchaseDialog\(\);/);
  assert.match(workspaceSource, /dialogFooterClassName/);
  assert.match(workspaceSource, /sticky bottom-0 -mx-6 -mb-6/);
  assert.doesNotMatch(workspaceSource, /showCloseButton=\{false\}/);
  assert.match(workspaceSource, /closeMasterDialog/);
  assert.match(workspaceSource, /<div className=\{dialogFooterClassName\}>[\s\S]*aria-label="교재 등록 취소"/);
  assert.match(workspaceSource, /onClick=\{closeMasterDialog\}[\s\S]*aria-label="교재 등록 취소"/);
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
  assert.match(workspaceSource, /aria-label="교재 요청·주문 창 닫기"/);
});

test("inventory count is inline while monthly closing still uses modal entry", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /closingDialogOpen/);
  assert.match(workspaceSource, /DialogTitle>월마감<\/DialogTitle>/);
  assert.match(workspaceSource, /function InventoryCountWorkspace/);
  assert.match(workspaceSource, /function InventoryCountMobileCard/);
  assert.match(workspaceSource, /submitInlineStockCount/);
  assert.match(workspaceSource, /onSubmitCount=\{submitInlineStockCount\}/);
  assert.match(workspaceSource, /const readyRowIds = new Set\(readyRows\.map\(\(row\) => row\.id\)\)/);
  assert.match(workspaceSource, /!readyRowIds\.has\(id\)/);
  assert.doesNotMatch(workspaceSource, /!readyRows\.some\(\(row\) => row\.id === id\)/);
  assert.doesNotMatch(workspaceSource, /<Button type="button" onClick=\{openCountDialog\}>[\s\S]*실사 추가/);
  assert.match(workspaceSource, /월마감 추가/);
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
  assert.match(workspaceSource, /function buildTextbookLookupMap/);
  assert.match(workspaceSource, /function buildLocationNameLookup/);
  assert.match(workspaceSource, /const historyRows: InventoryHistoryRow\[\] = \[\]/);
  assert.match(workspaceSource, /getTextbookFromLookup\(textbookLookup, move\.textbook_id \|\| move\.textbookId\)/);
  assert.match(workspaceSource, /getLocationNameFromLookup\(locationNameLookup, move\.location_id \|\| move\.locationId\)/);
  assert.match(workspaceSource, /재고 이력/);
  assert.match(workspaceSource, /stockMoves=\{activeStockMoves\}/);
  assert.match(workspaceSource, /stockCounts=\{activeStockCounts\}/);
  assert.match(workspaceSource, /function getInventoryAuditActor/);
  assert.match(workspaceSource, /row\.created_by/);
  assert.match(workspaceSource, /currentUserLabel/);
  assert.match(workspaceSource, /stockMoveTypeLabels/);
  assert.match(workspaceSource, /canDeleteHistory=\{canDeleteTextbookHistory\}/);
  assert.match(workspaceSource, /aria-label=\{`\$\{row\.textbookTitle\} 재고 이력 삭제`\}/);
  assert.match(workspaceSource, /textbookService\.deleteInventoryHistory/);
  assert.match(workspaceSource, /textbookHistoryDeleteAdminEmails\.has\(currentUserEmail\)/);
  assert.match(workspaceSource, /canManageAll \|\|[\s\S]*isAdmin \|\|[\s\S]*role === "admin"/);
  assert.match(serviceSource, /export async function deleteInventoryHistory/);
  assert.match(serviceSource, /\.from\("textbook_stock_counts"\)[\s\S]*\.update\(\{ adjustment_move_id: null \}\)/);
  assert.match(serviceSource, /\.from\("textbook_stock_moves"\)[\s\S]*\.delete\(\)/);
  assert.match(serviceSource, /createStockCountAdjustment[\s\S]*created_by: createdBy/);
  assert.match(serviceSource, /updateSaleLineStatus[\s\S]*created_by: createdBy/);
});

test("inventory stock count is inline and mobile-first with recommended targets", async () => {
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

  assert.match(workspaceSource, /type InventoryAuditFilter = "recommended" \| "pending" \| "done" \| "all"/);
  assert.match(workspaceSource, /inventoryCountDrafts/);
  assert.match(workspaceSource, /inventoryCountMemoDrafts/);
  assert.match(workspaceSource, /inventoryAuditFilter/);
  assert.match(workspaceSource, /INVENTORY_COUNT_CYCLE_DAYS = 30/);
  assert.match(workspaceSource, /INVENTORY_LOW_STOCK_THRESHOLD = 3/);
  assert.match(workspaceSource, /INVENTORY_COUNT_PAGE_SIZE = 30/);
  assert.match(workspaceSource, /function buildInventoryCountRows/);
  assert.match(workspaceSource, /function InventoryCountWorkspace/);
  assert.match(workspaceSource, /function InventoryCountMobileCard/);
  assert.match(workspaceSource, /function getInventoryCountReasonLabel/);
  assert.match(workspaceSource, /function getInventoryCountSubmitLabel/);
  assert.match(workspaceSource, /const visibleAuditFilterOptions = \(Object\.keys\(inventoryAuditFilterLabels\)/);
  assert.match(workspaceSource, /visibleAuditFilterOptions\.map/);
  assert.match(workspaceSource, /const \[displayLimitsByScope, setDisplayLimitsByScope\] = useState<Record<string, number>>\(\{\}\)/);
  assert.match(workspaceSource, /const \[usesDesktopInventoryTable, setUsesDesktopInventoryTable\] = useState\(true\)/);
  assert.match(workspaceSource, /const displayScopeKey = `\$\{auditFilter\}:\$\{locationId\}:\$\{rows\.length\}`/);
  assert.match(workspaceSource, /const displayLimit = displayLimitsByScope\[displayScopeKey\] \|\| INVENTORY_COUNT_PAGE_SIZE/);
  assert.match(workspaceSource, /const selectedIdSet = useMemo\(\(\) => new Set\(selectedIds\), \[selectedIds\]\)/);
  assert.match(workspaceSource, /const visibleRows = useMemo/);
  assert.match(workspaceSource, /const displayRows = useMemo\(\(\) => visibleRows\.slice\(0, displayLimit\), \[displayLimit, visibleRows\]\)/);
  assert.match(workspaceSource, /const groupsByLabel = new Map/);
  assert.match(workspaceSource, /window\.matchMedia\("\(min-width: 640px\)"\)/);
  assert.match(workspaceSource, /query\.addEventListener\("change", syncLayout\)/);
  assert.match(workspaceSource, /!usesDesktopInventoryTable \? \(/);
  assert.match(workspaceSource, /usesDesktopInventoryTable \? \(/);
  assert.match(workspaceSource, /setDisplayLimitsByScope\(\(current\) => \(\{/);
  assert.match(workspaceSource, /\[displayScopeKey\]: \(current\[displayScopeKey\] \|\| INVENTORY_COUNT_PAGE_SIZE\) \+ INVENTORY_COUNT_PAGE_SIZE/);
  assert.match(workspaceSource, /submitInlineStockCount/);
  assert.match(workspaceSource, /onSubmitCount=\{submitInlineStockCount\}/);
  assert.match(workspaceSource, /aria-label=\{`\$\{row\.title\} \$\{row\.locationName\} 실사 수량`\}/);
  assert.match(workspaceSource, /aria-label=\{`\$\{row\.title\} \$\{row\.locationName\} 실사 메모`\}/);
  assert.match(workspaceSource, /!usesDesktopInventoryTable \? \(/);
  assert.match(workspaceSource, /usesDesktopInventoryTable \? \(/);
  assert.match(workspaceSource, /className="overflow-x-auto rounded-lg border \[contain-intrinsic-size:720px\] \[content-visibility:auto\]"/);
  assert.doesNotMatch(workspaceSource, /className="hidden overflow-x-auto rounded-lg border sm:block"/);
  assert.match(workspaceSource, /title=\{getInventoryCountReasonLabel\(row\)\}/);
  assert.match(inventorySource, /\{currentLocation\} \{visibleRowSummary\}/);
  assert.match(inventorySource, /더 보기 · \{formatQuantity\(displayRows\.length\)\}\/\{formatQuantity\(visibleRows\.length\)\}종/);
  assert.match(inventorySource, /<div className="truncate" title=\{getInventoryCountReasonLabel\(row\)\}>\{getInventoryCountReasonLabel\(row\)\}<\/div>/);
  assert.doesNotMatch(inventorySource, /groupQualityIssueCount/);
  assert.doesNotMatch(inventorySource, /정리 필요/);
  assert.match(inventoryMobileSource, /`최종 \$\{formatCompactDateTime\(row\.latestCountAt\)\} · \$\{getInventoryCountReasonLabel\(row\)\}`/);
  assert.match(workspaceSource, /aria-label=\{getInventoryCountSubmitLabel/);
  assert.match(workspaceSource, /실사 수량 입력 필요/);
  assert.match(workspaceSource, /실사 반영 불가/);
  assert.doesNotMatch(workspaceSource, /실사 수량을 입력하면 반영할 수 있습니다/);
  assert.match(workspaceSource, /실사 기준/);
  assert.match(workspaceSource, /추천 기준: 한 달에 한 번, 실사 이력 없음, 또는 재고 3권 이하/);
  assert.doesNotMatch(workspaceSource, /월 1회 · 30일 경과 · 이력 없음/);
  assert.match(workspaceSource, /할 일/);
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
  assert.match(workspaceSource, /setError\(getTextbookActionErrorMessage\(loadError\)\)/);
  assert.match(workspaceSource, /actionErrorMessage/);
  assert.match(workspaceSource, /setActionErrorMessage\(getTextbookActionErrorMessage\(actionError\)\)/);
  assert.match(workspaceSource, /variant=\{error \|\| actionErrorMessage \? "destructive" : "default"\}/);
  assert.doesNotMatch(workspaceSource, /actionError instanceof Error \? actionError\.message : "처리 중 오류가 발생했습니다\."/);
  assert.match(serviceSource, /normalizeOptionalUuid/);
  assert.match(serviceSource, /normalizeOptionalUuid\(record\.locationId/);
  assert.match(serviceSource, /normalizeOptionalUuid\(line\.location_id/);
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
  assert.match(workspaceSource, /교재 관리 DB 마이그레이션이 아직 적용되지 않았습니다/);
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

test("textbook workspace provides a research-backed operations command center", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /function buildTextbookOpsMetrics/);
  assert.match(workspaceSource, /function TextbookOpsCommandCenter/);
  assert.match(workspaceSource, /operationMetrics/);
  assert.match(workspaceSource, /미등록 요청/);
  assert.match(workspaceSource, /주문 필요/);
  assert.match(workspaceSource, /부분입고/);
  assert.match(workspaceSource, /출고 대기/);
  assert.match(workspaceSource, /재고 부족/);
  assert.match(workspaceSource, /onSelectQueue\(item\.key\)/);
  assert.match(workspaceSource, /function openTextbookOpsQueue/);
  assert.match(workspaceSource, /setPurchaseRequestFilter\("unregistered"\)/);
  assert.match(workspaceSource, /setPurchaseOrderFilter\("waiting"\)/);
  assert.match(workspaceSource, /setSalesProcessFilter\("waiting"\)/);
  assert.match(workspaceSource, /changeInventoryFilter\("shortage"\)/);
  assert.match(workspaceSource, /aria-label="교재관리 할 일 보기"/);
  assert.match(workspaceSource, /aria-label="교재관리 할 일 목록"/);
  assert.match(workspaceSource, /onSelectQueue\(""\)/);
});

test("textbook workspace improves operational empty states and modal accessibility", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /DialogDescription/);
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
  assert.match(workspaceSource, /aria-busy=\{saving === "master"\}/);
  assert.match(workspaceSource, /aria-busy=\{saving === "purchase"\}/);
  assert.match(workspaceSource, /aria-busy=\{saving === "sale"\}/);
  assert.match(workspaceSource, /aria-busy=\{saving === "closing"\}/);
  assert.match(workspaceSource, /교재 저장 중/);
  assert.match(workspaceSource, /saving === "sale" \? "저장 중" : "출고 대기 저장"/);
  assert.match(workspaceSource, /saving === "closing" \? "저장 중" : "마감 저장"/);
});

test("textbook workspace keeps list and process controls responsive and focused", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /canManageTextbookOperations \? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" : "grid-cols-1"/);
  assert.match(workspaceSource, /<Table className="min-w-\[920px\] table-fixed">/);
  assert.match(workspaceSource, /교재 상태 필터 열기/);
  assert.match(workspaceSource, /type PurchaseRequestFilter = "all" \| "unregistered" \| "orderable"/);
  assert.match(workspaceSource, /검토 전체/);
  assert.match(workspaceSource, /미등록 요청/);
  assert.match(workspaceSource, /등록 교재/);
  assert.match(workspaceSource, /shouldShowRequestLine/);
  assert.match(workspaceSource, /type SalesProcessFilter = "all" \| "waiting" \| "issued" \| "returned" \| "cancelled"/);
  assert.match(workspaceSource, /출고 완료/);
  assert.match(workspaceSource, /\{ value: "returned", label: "반품" \}/);
  assert.match(workspaceSource, /\{ value: "cancelled", label: "취소" \}/);
  assert.match(workspaceSource, /statusFilter === "returned"/);
  assert.match(workspaceSource, /statusFilter === "cancelled"/);
  assert.match(workspaceSource, /statusFilter === "issued"/);
  assert.match(workspaceSource, /visibleGroups/);
  assert.match(workspaceSource, /openNewSaleDialog\(\)[\s\S]*setSaleForm/);
  assert.match(workspaceSource, /function InventoryCountWorkspace/);
  assert.match(workspaceSource, /function openClosingDialog/);
});

test("textbook workspace tightens the operations queue and grouped list controls", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /type PurchaseOrderFilter = "all" \| "waiting" \| "partial"/);
  assert.match(workspaceSource, /const purchaseOrderFilterLabels/);
  assert.match(workspaceSource, /const queueBadgeValue = activeQueueItem \? activeQueueItem\.value : activeQueueTotal/);
  assert.match(workspaceSource, /activeQueueItem \? activeQueueItem\.label : "할 일"/);
  assert.doesNotMatch(workspaceSource, /오늘 \{formatQuantity\(activeQueueTotal\)\}/);
  assert.match(workspaceSource, /const activeQueueItem = actionItems\.find/);
  assert.match(workspaceSource, /const visibleActionItems = actionItems\.filter/);
  assert.match(workspaceSource, /visibleActionItems\.map/);
  assert.match(workspaceSource, /activeQueueKey=\{activeQueueKey\}/);
  assert.match(workspaceSource, /activeQueueKey === item\.key/);
  assert.match(workspaceSource, /canManageTextbookOperations && activeTab !== "requests"/);
  assert.match(workspaceSource, /setPurchaseOrderFilter\("partial"\)/);
  assert.match(workspaceSource, /onOrderFilterChange=\{setPurchaseOrderFilter\}/);
  assert.match(workspaceSource, /purchaseOrderFilterLabels/);
  assert.match(workspaceSource, /orderFilter === "waiting"/);
  assert.match(workspaceSource, /orderFilter === "partial"/);
  assert.match(workspaceSource, /compareTextbookGroupLabels/);
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
  assert.match(workspaceSource, /DialogTitle>\{getPurchaseDialogTitle\(purchaseForm\.requestStage, Boolean\(selectedPurchaseLineId\)\)\}/);
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
  assert.match(workspaceSource, /ariaLabel="요청자 선택"/);
  assert.match(workspaceSource, /"요청 위치 선택" : "입고 위치 선택"/);
  assert.match(workspaceSource, /ariaLabel="출고 위치 선택"/);
  assert.match(workspaceSource, /ariaLabel="실사 위치 선택"/);
  assert.match(workspaceSource, /aria-label="마감 과목 선택"/);
  assert.match(workspaceSource, /const saleSubmitHint = !selectedSaleClass/);
  assert.match(workspaceSource, /!selectedSaleClass \? "수업을 선택하세요" : !selectedSaleTextbook \? "교재를 선택하세요" : "대상 학생이 없습니다"/);
  assert.match(workspaceSource, /selectedSaleClass \|\| selectedSaleTextbook \? \(/);
  assert.match(workspaceSource, /const closingTargetSubjects = closingForm\.subject === "all" \? \["all", "english", "math"\] : \[closingForm\.subject\]/);
  assert.match(workspaceSource, /<Metric label="저장" value=\{`\$\{formatQuantity\(closingTargetSubjects\.length\)\}건`\}/);
  assert.match(workspaceSource, /aria-label=\{ariaLabel\}/);
  assert.doesNotMatch(workspaceSource, /<TabsContent value="purchase" className="mt-4 grid min-w-0 gap-4">\s*<form onSubmit=\{submitPurchase\} className="hidden">/);
  assert.match(workspaceSource, /purchaseForm\.requestStage === "request" \? openNewRequestDialog : openNewPurchaseDialog/);
});

test("textbook workspace adds searchable process tables and tighter issue ledgers", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /const \[operationQuery, setOperationQuery\] = useState\(""\)/);
  assert.match(workspaceSource, /aria-label=\{operationSearchLabel\}/);
  assert.match(workspaceSource, /matchesPurchaseLineQuery/);
  assert.match(workspaceSource, /matchesSaleLineQuery/);
  assert.match(workspaceSource, /const deferredOperationQuery = useDeferredValue\(operationQuery\)/);
  assert.match(workspaceSource, /searchQuery=\{deferredOperationQuery\}/);
  assert.match(workspaceSource, /purchaseForm\.requestStage !== "request" \? \(/);
  assert.match(workspaceSource, /주문 추가/);
  assert.match(workspaceSource, /<TableHead className="w-\[88px\]">위치<\/TableHead>/);
  assert.match(workspaceSource, /<TableCell className="max-w-\[88px\] truncate" title=\{locationName\}>\{locationName\}<\/TableCell>/);
  assert.match(workspaceSource, /<TableCell colSpan=\{7\} className="text-right">합계<\/TableCell>/);
  assert.match(workspaceSource, /aria-label=\{`\$\{studentName\} \$\{textbookTitle\} 출고 완료 처리`\}/);
  assert.match(workspaceSource, /aria-label="일괄 과목 선택"/);
  assert.match(workspaceSource, /aria-label=\{`\$\{rowA11yLabel\} 편집`\}/);
  assert.match(workspaceSource, /status === "charged" \|\| status === "paid"/);
  assert.match(workspaceSource, /filter === "shortage"\) return totalQuantity < 0 \|\|/);
  assert.match(workspaceSource, /function TabCountBadge/);
});

test("textbook workspace reduces idle clutter and exposes group totals", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /if \(activeQueueTotal <= 0\) \{\s*return null;\s*\}/);
  assert.match(workspaceSource, /const activeProcessHasRows =/);
  assert.match(workspaceSource, /activeProcessHasRows \|\| Boolean\(text\(operationQuery\)\)/);
  assert.match(workspaceSource, /function isEditableShortcutTarget/);
  assert.match(workspaceSource, /masterSearchRef/);
  assert.match(workspaceSource, /operationSearchRef/);
  assert.match(workspaceSource, /const deferredQuery = useDeferredValue\(query\)/);
  assert.match(workspaceSource, /const deferredOperationQuery = useDeferredValue\(operationQuery\)/);
  assert.match(workspaceSource, /aria-keyshortcuts="\/"/);
  assert.match(workspaceSource, /event\.key !== "\/"/);
  assert.match(workspaceSource, /event\.key === "Escape"/);
  assert.match(workspaceSource, /const operationQueueTotal =/);
  assert.match(workspaceSource, /const showsProcessCommandCenter =/);
  assert.match(workspaceSource, /operationQueueTotal > 0/);
  assert.match(workspaceSource, /const showsProcessToolbar =/);
  assert.match(workspaceSource, /showsProcessSearch \|\| showsProcessCommandCenter/);
  assert.match(workspaceSource, /!showsProcessSearch && "sm:justify-end"/);
  assert.match(workspaceSource, /showsProcessSearch \? \(/);
  assert.match(workspaceSource, /activeTab === "purchase" \|\|/);
  assert.match(workspaceSource, /value !== "requests" && value !== "purchase" && value !== "sales"[\s\S]*setOperationQuery\(""\)/);
  assert.match(workspaceSource, /if \(value !== activeTab\) \{[\s\S]*clearMasterSelection\(\);[\s\S]*setSelectedPurchaseLineIds\(\[\]\);[\s\S]*setSelectedSaleLineIds\(\[\]\);[\s\S]*setSelectedClosingIds\(\[\]\);[\s\S]*\}/);
  assert.doesNotMatch(workspaceSource, /formatQuantity\(groupCount\)\}그룹/);
  assert.match(workspaceSource, /sticky bottom-3 z-20/);
  assert.match(workspaceSource, /const groupTotalQuantity = group\.rows\.reduce/);
  assert.doesNotMatch(workspaceSource, /const groupAmountValue = group\.rows\.reduce/);
  assert.match(workspaceSource, /const groupCountLabel = `\$\{formatQuantity\(group\.rows\.length\)\}/);
  assert.match(workspaceSource, /const groupDetailText = \[/);
  assert.match(workspaceSource, /function getKnownPublisherLabel/);
  assert.match(workspaceSource, /getKnownPublisherLabel\(row\)/);
  assert.match(workspaceSource, /publisherLabel \? \(/);
  assert.match(workspaceSource, /MASTER_TEXTBOOK_PAGE_SIZE/);
  assert.match(workspaceSource, /MASTER_TEXTBOOK_PAGE_SIZE = 60/);
  assert.match(workspaceSource, /const \[masterListLimit, setMasterListLimit\] = useState\(MASTER_TEXTBOOK_PAGE_SIZE\)/);
  assert.match(workspaceSource, /const masterVisibleInventory = useMemo/);
  assert.match(workspaceSource, /const keyword = deferredQuery\.trim\(\)\.toLowerCase\(\)/);
  assert.match(workspaceSource, /function buildTextbookSearchIndex/);
  assert.match(workspaceSource, /const textbookSearchIndexById = useMemo/);
  assert.match(workspaceSource, /textbookSearchIndexById\.get\(getRecordId\(row\)\)/);
  assert.match(workspaceSource, /filteredInventory\.slice\(0, masterListLimit\)/);
  assert.match(workspaceSource, /const visibleTextbookIdSet = useMemo\(\(\) => new Set\(visibleTextbookIds\), \[visibleTextbookIds\]\)/);
  assert.match(workspaceSource, /const selectedVisibleTextbookCount = useMemo/);
  assert.match(workspaceSource, /visibleTextbookIdSet\.has\(id\)/);
  assert.match(workspaceSource, /rows=\{masterVisibleInventory\}/);
  assert.match(workspaceSource, /emptyActionLabel=\{hasTextbookListFilter \? "필터 초기화" : "신규 등록"\}/);
  assert.match(workspaceSource, /onEmptyAction=\{hasTextbookListFilter \? resetTextbookListFilters : openNewMasterDialog\}/);
  assert.match(workspaceSource, /aria-label="교재 더 보기"/);
  assert.match(workspaceSource, /검색 조건에 맞는 주문·입고 건이 없습니다/);
  assert.match(workspaceSource, /검색 조건에 맞는 출고 건이 없습니다/);
  assert.match(workspaceSource, /const searchMatchedPurchaseRowsByGroup = useMemo/);
  assert.match(workspaceSource, /searchMatchedPurchaseRowsByGroup\.get\(groupId\)/);
  assert.match(workspaceSource, /const purchaseHandoffGroups = useMemo/);
  assert.match(workspaceSource, /const getVisiblePurchaseRows = useCallback/);
  assert.match(workspaceSource, /const visiblePurchaseRowsByGroup = useMemo/);
  assert.match(workspaceSource, /getCurrentVisiblePurchaseRows\(group\.id\)/);
  assert.match(workspaceSource, /const visiblePurchaseRows = useMemo/);
  assert.match(workspaceSource, /const visibleRowCount = visiblePurchaseRows\.length/);
  assert.match(workspaceSource, /const requestFilterOptions = useMemo/);
  assert.match(workspaceSource, /const purchaseProcessFilterCounts = useMemo/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\.boardScope\[scope\]/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\.order\[filter\]/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\.request\[option\.value\]/);
  assert.doesNotMatch(workspaceSource, /const getRequestFilterCount =/);
  assert.match(workspaceSource, /const purchaseProcessActionIds = useMemo/);
  assert.match(workspaceSource, /for \(const line of visiblePurchaseRows\)/);
  assert.match(workspaceSource, /const visibleActionablePurchaseLineIdSet = useMemo/);
  assert.match(workspaceSource, /const selectedProcessLineCount = useMemo/);
  assert.match(workspaceSource, /visibleActionablePurchaseLineIdSet\.has\(lineId\)/);
  assert.match(workspaceSource, /rows: visiblePurchaseRows/);
  assert.match(workspaceSource, /const searchMatchedSaleRowsByGroup = useMemo/);
  assert.match(workspaceSource, /searchMatchedSaleRowsByGroup\.get\(groupId\)/);
  assert.match(workspaceSource, /const makeEduBillingGroups = useMemo/);
  assert.match(workspaceSource, /const visibleSaleRowsByGroup = useMemo/);
  assert.match(workspaceSource, /getCurrentVisibleSaleRows\(group\.id\)/);
  assert.match(workspaceSource, /const visibleSaleRowsWithGroup = useMemo/);
  assert.match(workspaceSource, /const visibleSaleRows = useMemo/);
  assert.match(workspaceSource, /const visibleRowCount = visibleSaleRows\.length/);
  assert.match(workspaceSource, /const saleProcessActionIds = useMemo/);
  assert.match(workspaceSource, /for \(const \{ line, groupId \} of visibleSaleRowsWithGroup\)/);
  assert.match(workspaceSource, /const status = text\(line\.status\) \|\| groupId/);
  assert.match(workspaceSource, /const salesProcessFilterCounts = useMemo/);
  assert.match(workspaceSource, /salesProcessFilterCounts\[option\.value as SalesProcessFilter\]/);
  assert.match(workspaceSource, /const visibleActionableLineIdSet = useMemo/);
  assert.match(workspaceSource, /const visibleSelectableSaleLineIdSet = useMemo/);
  assert.match(workspaceSource, /visibleSelectableSaleLineIdSet\.has\(lineId\)/);
  assert.match(workspaceSource, /const selectedActionableCount = useMemo/);
  assert.doesNotMatch(workspaceSource, /const getSalesFilterCount =/);
  assert.match(workspaceSource, /rows: visibleSaleRows/);
  assert.match(workspaceSource, /searchQuery=\{deferredOperationQuery\}/);
  assert.match(workspaceSource, /visibleRowCount > 0 \? \(/);
  assert.match(workspaceSource, /label=\{getPurchaseProcessEmptyLabel\(mode, emptyGroupId, requestFilter, orderFilter, searchQuery\)\}/);
  assert.match(workspaceSource, /label=\{getSalesProcessEmptyLabel\(emptyGroupId, statusFilter, searchQuery\)\}/);
  assert.match(workspaceSource, /return "주문 필요 건이 없습니다"/);
  assert.match(workspaceSource, /return "요청에서 확정된 교재가 주문 대기 목록에 올라옵니다\."/);
  assert.match(workspaceSource, /requestedTotal > 0 \? `요청 \$\{formatQuantity\(requestedTotal\)\}` : ""/);
  assert.match(workspaceSource, /수량 \{formatQuantity\(totalQuantity\)\}/);
});

test("textbook workspace surfaces counts and data quality inside dense ledgers", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /const \{ data, loading, error, refresh, user \} = useTextbookOperationsData\(\)/);
  assert.match(workspaceSource, /function TextbookLoadingState/);
  assert.match(workspaceSource, /TEXTBOOK_DATA_LOAD_TIMEOUT_MS = 12_000/);
  assert.match(workspaceSource, /function withTextbookDataLoadTimeout/);
  assert.match(workspaceSource, /Promise\.race\(\[promise, timeoutPromise\]\)/);
  assert.match(workspaceSource, /const loadRequestIdRef = useRef\(0\)/);
  assert.match(workspaceSource, /loadRequestIdRef\.current !== requestId/);
  assert.match(workspaceSource, /onClick=\{\(\) => void refresh\(\)\}/);
  assert.match(workspaceSource, />\s*다시 불러오기\s*<\/Button>/);
  assert.match(workspaceSource, /aria-label="교재관리 로딩"/);
  assert.match(workspaceSource, /role="status"/);
  assert.match(workspaceSource, />교재관리 로딩 중<\/span>/);
  assert.match(workspaceSource, /const listFilteredInventory = useMemo/);
  assert.match(workspaceSource, /const inventoryFilterCounts = useMemo/);
  assert.match(workspaceSource, /const locationColumns = useMemo/);
  assert.match(workspaceSource, /locations\.map\(\(location\) => \(\{/);
  assert.match(workspaceSource, /locationQuantities\[location\.id\]/);
  assert.doesNotMatch(workspaceSource, /filteredInventoryTotalQuantity/);
  assert.doesNotMatch(workspaceSource, /filteredInventorySaleValue/);
  assert.doesNotMatch(workspaceSource, /판매가합 \{formatCurrency\(filteredInventorySaleValue\)\}/);
  assert.match(workspaceSource, /function getTextbookTitleKey/);
  assert.match(workspaceSource, /function buildTextbookLookupMap/);
  assert.match(workspaceSource, /function getTextbookFromLookup/);
  assert.match(workspaceSource, /function buildLocationNameLookup/);
  assert.match(workspaceSource, /function getLocationNameFromLookup/);
  assert.match(workspaceSource, /const duplicateTextbookTitleKeys = useMemo/);
  assert.match(workspaceSource, /duplicateTitleKeys=\{duplicateTextbookTitleKeys\}/);
  assert.match(workspaceSource, /function getTextbookQualityIssueLabels/);
  assert.match(workspaceSource, /label: "중복"/);
  assert.match(workspaceSource, /label: "코드 없음"/);
  assert.match(workspaceSource, /label: "출판사 없음"/);
  assert.match(workspaceSource, /label: "분류 없음"/);
  assert.match(workspaceSource, /label: "가격 없음"/);
  assert.match(workspaceSource, /label: "과목 확인"/);
  assert.match(workspaceSource, /label: "미사용"/);
  assert.match(workspaceSource, /qualityIssueLabels\.length > 0/);
  assert.match(workspaceSource, /정리 \{formatQuantity\(qualityIssueLabels\.length\)\}/);
  assert.match(workspaceSource, /aria-label=\{`정리 필요: \$\{qualityIssueSummary\}`\}/);
  assert.doesNotMatch(workspaceSource, /visibleQualityIssueLabels = qualityIssueLabels\.slice\(0, 3\)/);
  assert.match(workspaceSource, /const shouldShowRequestLineForFilter = useCallback/);
  assert.match(workspaceSource, /const shouldShowOrderGroupForFilter = useCallback/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\.request\[option\.value\]/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\.order\[filter\]/);
  assert.match(workspaceSource, /salesProcessFilterCounts\[option\.value as SalesProcessFilter\]/);
  assert.match(workspaceSource, /const textbookLookup = useMemo\(\(\) => buildTextbookLookupMap\(textbooks\), \[textbooks\]\)/);
  assert.match(workspaceSource, /const locationNameLookup = useMemo\(\(\) => buildLocationNameLookup\(locations\), \[locations\]\)/);
  assert.match(workspaceSource, /getTextbookFromLookup\(textbookLookup/);
  assert.match(workspaceSource, /getLocationNameFromLookup\(locationNameLookup/);
});

test("textbook workspace adds quality triage, tab totals, and compact empty process groups", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /\| "missingCategory"/);
  assert.match(workspaceSource, /\| "missingPrice"/);
  assert.match(workspaceSource, /const textbookQualityFilterLabels/);
  assert.match(workspaceSource, /const \[textbookQualityFilter, setTextbookQualityFilter\] = useState<TextbookQualityFilter>\("all"\)/);
  assert.match(workspaceSource, /function hasTextbookSubjectMismatch/);
  assert.match(workspaceSource, /function getTextbookQualityIssues/);
  assert.match(workspaceSource, /function matchesTextbookQualityFilter/);
  assert.match(workspaceSource, /const textbookQualityFilterCounts = useMemo/);
  assert.match(workspaceSource, /setTextbookQualityFilter\("all"\)/);
  assert.match(workspaceSource, /const activeTextbookQualityFilter = activeTab === "master" \? textbookQualityFilter : "all"/);
  assert.match(workspaceSource, /activeTextbookQualityFilter !== "all"/);
  assert.doesNotMatch(workspaceSource, /function TextbookQualityQuickFilters/);
  assert.doesNotMatch(workspaceSource, /aria-label="교재 정리 빠른 필터"/);
  assert.doesNotMatch(workspaceSource, /const totalCount = counts\.all \|\| 0/);
  assert.doesNotMatch(workspaceSource, /return totalCount <= 0 \|\| count < totalCount/);
  assert.doesNotMatch(workspaceSource, /<TextbookQualityQuickFilters/);
  assert.match(workspaceSource, /activeTab === "master" \? \(/);
  assert.match(workspaceSource, /textbookQualityFilterLabels\[filter\]/);
  assert.match(workspaceSource, /textbookQualityFilterCounts\[filter\]/);
  assert.match(workspaceSource, /aria-pressed=\{inventoryFilter === filter\}/);
  assert.match(workspaceSource, /aria-pressed=\{textbookQualityFilter === filter\}/);
  assert.match(workspaceSource, /aria-pressed=\{subjectFilter === option\.value\}/);
  assert.match(workspaceSource, /aria-pressed=\{schoolLevelFilter === option\.value\}/);
  assert.doesNotMatch(workspaceSource, /showZero/);
  assert.match(workspaceSource, /aria-label="마스터"/);
  assert.match(workspaceSource, /aria-label="주문·입고"/);
  assert.match(workspaceSource, /aria-hidden="true"/);
  assert.match(workspaceSource, /<TabCountBadge value=\{operationMetrics\.requestCount\} \/>/);
  assert.match(workspaceSource, /<TabCountBadge value=\{operationMetrics\.unregisteredRequestCount \+ operationMetrics\.orderNeededCount \+ operationMetrics\.receivingBacklogCount\} \/>/);
  assert.match(workspaceSource, /<TabCountBadge value=\{activeTextbooks\.length\} \/>/);
  assert.match(workspaceSource, /<TabCountBadge value=\{activeInventory\.length\} \/>/);
  assert.match(workspaceSource, /const activeInventory = useMemo\(\(\) => data\.inventory\.filter\(isActiveTextbook\), \[data\.inventory\]\)/);
  assert.match(workspaceSource, /inactive: "미사용 보관함"/);
  assert.match(workspaceSource, /if \(filter === "inactive"\) return !isActiveTextbook\(row\)/);
  assert.match(workspaceSource, /if \(!isActiveTextbook\(row\)\) return false/);
  assert.match(workspaceSource, /function shouldShowOperationalPurchaseLine/);
  assert.match(workspaceSource, /function shouldShowOperationalSaleLine/);
  assert.match(workspaceSource, /const activePurchaseOrderLines = useMemo/);
  assert.match(workspaceSource, /const activeSaleLines = useMemo/);
  assert.match(workspaceSource, /const activeStockMoves = useMemo/);
  assert.match(workspaceSource, /aria-label="미사용 교재 보관함"/);
  assert.match(workspaceSource, /<Archive className="mr-2 size-3\.5" \/>/);
  assert.match(workspaceSource, /const tableTotals = useMemo/);
  assert.match(workspaceSource, /const groupsByLabel = new Map<string, Row\[\]>\(\)/);
  assert.match(workspaceSource, /const selectedIdSet = useMemo\(\(\) => new Set\(selectedIds\), \[selectedIds\]\)/);
  assert.match(workspaceSource, /checked=\{selectedIdSet\.has\(rowId\)\}/);
  assert.match(workspaceSource, /tableTotals\.locationQuantities/);
  assert.match(workspaceSource, /<TableHead className="w-44">분류<\/TableHead>/);
  assert.match(workspaceSource, /const gradeLabel = getTextbookGradeLabel/);
  assert.match(workspaceSource, /const subSubjectLabel = getTextbookSubSubject\(row\) \|\| "-"/);
  assert.match(workspaceSource, /const categorySummary = compactUniqueLabels/);
  assert.match(workspaceSource, /<TableCell>합계<\/TableCell>/);
  assert.match(workspaceSource, /const renderedGroups = visibleGroups\.filter/);
  assert.match(workspaceSource, /const emptyGroupId = visibleGroups\[0\]\?\.id/);
  assert.match(workspaceSource, /const hasHiddenProcessRows =/);
  assert.match(workspaceSource, /const showProcessSummary = visibleRowCount > 0 \|\| hasProcessSearchQuery/);
  assert.match(workspaceSource, /const activePurchaseFilterCount =/);
  assert.match(workspaceSource, /const activePurchaseFilterLabel =/);
  assert.doesNotMatch(workspaceSource, /const showGroupViewControls =/);
  assert.match(workspaceSource, /const visibleBoardScopeOptions = \(Object\.keys\(purchaseBoardScopeLabels\)/);
  assert.match(workspaceSource, /const visibleOrderFilterOptions = \(Object\.keys\(purchaseOrderFilterLabels\)/);
  assert.match(workspaceSource, /visibleBoardScopeOptions\.map/);
  assert.match(workspaceSource, /visibleOrderFilterOptions\.map/);
  assert.match(workspaceSource, /<PopoverContent align="start" className="w-\[min\(24rem,calc\(100vw-2rem\)\)\] p-3">/);
  assert.match(workspaceSource, /onScopeChange\("active"\);\s*onOrderFilterChange\("all"\);\s*onRequestFilterChange\("all"\);/);
  assert.doesNotMatch(workspaceSource, /showGroupViewControls \? \(/);
  assert.match(workspaceSource, /hint=\{showProcessControls && !hasHiddenProcessRows \?/);
  assert.match(workspaceSource, /function getTextbookQualityScore/);
  assert.match(workspaceSource, /const leftScore = getTextbookQualityScore/);
  assert.match(workspaceSource, /const groupQualityIssueCount = group\.rows\.filter/);
  assert.match(workspaceSource, /aria-label=\{`\$\{rowA11yLabel\} 선택`\}/);
  assert.match(workspaceSource, /function ProcessGroupEmptyState\(\{/);
  assert.match(workspaceSource, /hint\?: string/);
  assert.match(workspaceSource, /const emptyActionLabel = hasProcessSearchQuery/);
  assert.match(workspaceSource, /const totalProcessRowCount = groups\.reduce/);
  assert.match(workspaceSource, /const showProcessControls = totalProcessRowCount > 0 \|\| hasProcessSearchQuery/);
  assert.match(workspaceSource, /const totalSalesRowCount = lines\.length/);
  assert.match(workspaceSource, /const showSalesControls = totalSalesRowCount > 0 \|\| hasProcessSearchQuery/);
  assert.match(workspaceSource, /const showSalesGroupToggleControls = renderedGroups\.length > 1/);
  assert.match(workspaceSource, /visibleRowCount > 0 && showSalesGroupToggleControls \? \(/);
  assert.match(workspaceSource, /hint=\{showSalesControls \? getSalesProcessEmptyHint/);
  assert.match(workspaceSource, /actionLabel=\{emptyActionLabel\}/);
  assert.match(workspaceSource, /onClearSearch=\{\(\) => setOperationQuery\(""\)\}/);
  assert.match(workspaceSource, /const shouldShowOrderGroupForFilter = useCallback/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\.boardScope\[scope\]/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\.order\[filter\]/);
  assert.match(workspaceSource, /purchaseProcessFilterCounts\.request\[option\.value\]/);
  assert.match(workspaceSource, /Math\.min\(data\.monthlyClosings\.length, 12\)/);
  assert.match(workspaceSource, /<TableHeader className="sticky top-0 z-10 bg-background">/);
  assert.match(workspaceSource, /표시 \{formatQuantity\(visibleRowCount\)\}건/);
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
  assert.match(workspaceSource, /aria-label=\{`\$\{operationSearchLabel\} 초기화`\}/);
  assert.match(workspaceSource, /aria-live="polite"/);
  assert.match(workspaceSource, /aria-label=\{actionLabel\}/);
  assert.match(workspaceSource, /const hasProcessSearchQuery = Boolean\(text\(searchQuery\)\)/);
  assert.match(workspaceSource, /const handleEmptyAction = \(\) => \{/);
  assert.match(workspaceSource, /if \(hasHiddenProcessRows\) \{\s*onScopeChange\("all"\);\s*onRequestFilterChange\("all"\);\s*onOrderFilterChange\("all"\);/);
  assert.match(workspaceSource, /aria-label=\{`\$\{textbookTitle\} \$\{mode === "request" \? "요청" : "주문·입고"\} 상세 열기`\}/);
  assert.match(workspaceSource, /aria-label=\{`\$\{textbookTitle\} 교보문고 검색`\}/);
  assert.match(workspaceSource, /title=\{`\$\{textbookTitle\} 일괄 처리 선택`\}/);
  assert.match(workspaceSource, /aria-label="월마감 정산 이력"/);
  assert.match(workspaceSource, /selectedClosingDetailId/);
  assert.match(workspaceSource, /function ClosingDetailDialog/);
  assert.match(workspaceSource, /onInspectRow=\{\(row\) => setSelectedClosingDetailId\(getRecordId\(row\)\)\}/);
  assert.match(workspaceSource, /filterStockMovesForClosing\(\{[\s\S]*closingMonth[\s\S]*subject[\s\S]*stockMoves/);
  assert.match(workspaceSource, /월마감에 반영된 재고 이동과 마진 상세 내역입니다/);
  assert.match(workspaceSource, />\s*상세\s*<\/Button>/);
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
  assert.match(workspaceSource, /text\(value\) && "border-blue-200 bg-blue-50\/30"/);
  assert.match(workspaceSource, /const hasDraft = text\(draftValue\)/);
  assert.match(workspaceSource, /bg-blue-50\/40/);
  assert.match(workspaceSource, /현재 수량 입력/);
  assert.match(workspaceSource, /onKeyDown=\{\(event\) => \{/);
  assert.match(workspaceSource, /event\.key === "Enter" && hasDraft/);
  assert.match(workspaceSource, /event\.key === "Enter" && text\(value\)/);
  assert.match(workspaceSource, /variant=\{hasDraft \? "default" : "outline"\}/);
  assert.match(workspaceSource, /aria-busy=\{isSaving\}/);
  assert.match(workspaceSource, /let shouldRefresh = false/);
  assert.match(workspaceSource, /shouldRefresh = true/);
  assert.match(workspaceSource, /void refresh\(\)\.catch/);
  assert.doesNotMatch(workspaceSource, /await refresh\(\);/);
});

test("textbook workspace third-pass polish tightens navigation and action ergonomics", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /aria-label="교재관리 업무 탭"/);
  assert.match(workspaceSource, /type="search"/);
  assert.match(workspaceSource, /autoComplete="off"/);
  assert.match(workspaceSource, /enterKeyHint="search"/);
  assert.match(workspaceSource, /role="search" aria-label=\{operationSearchLabel\}/);
  assert.match(workspaceSource, /const title = normalizedStage === "receive" \? "교재 입고" : normalizedStage === "order" \? "교재 주문" : "교재 요청"/);
  assert.match(workspaceSource, /DialogTitle>선택 요청 일괄 주문<\/DialogTitle>/);
  assert.match(workspaceSource, /aria-label="선택 요청 일괄 주문"/);
  assert.match(workspaceSource, /aria-label="선택 교재 삭제"/);
  assert.match(workspaceSource, /aria-label="선택 교재 선택 해제"/);
  assert.match(workspaceSource, /aria-label="재고 실사 목록"/);
  assert.match(workspaceSource, /aria-label="교재 목록"/);
  assert.match(workspaceSource, /<TableHead className=\{cn\("w-24 text-right", stickyActionHeadClassName\)\}>작업<\/TableHead>/);
  assert.match(workspaceSource, /<TableHead className=\{cn\(mode === "request" \? "w-\[160px\]" : "w-\[260px\]", "text-right", stickyActionHeadClassName\)\}>/);
  assert.match(workspaceSource, /<span>작업<\/span>\s*\{columnSettingsControl\}/);
  assert.match(workspaceSource, /<TableHead className=\{cn\("w-\[120px\] text-right", stickyActionHeadClassName\)\}>작업<\/TableHead>/);
  assert.match(workspaceSource, /<TableCell className=\{stickyActionCellClassName\}>/);
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
  assert.match(workspaceSource, /<Dialog open=\{textbookDeleteDialogOpen\} onOpenChange=\{setTextbookDeleteDialogOpen\}>/);
  assert.match(workspaceSource, /<DialogTitle>선택 교재 정리<\/DialogTitle>/);
  assert.match(workspaceSource, /onClick=\{confirmDeleteSelectedTextbooks\}/);
  assert.match(workspaceSource, /function clearMasterSelection\(\)/);
  assert.match(workspaceSource, /setBulkTextbookPatch\(emptyBulkTextbookPatch\)/);
  assert.match(workspaceSource, /function updateMasterSearchQuery\(value: string\)/);
  assert.match(workspaceSource, /onChange=\{\(event\) => updateMasterSearchQuery\(event\.target\.value\)\}/);
  assert.match(workspaceSource, /function changeInventoryFilter\(value: InventoryFilter\)/);
  assert.match(workspaceSource, /function changeTextbookQualityFilter\(value: TextbookQualityFilter\)/);
  assert.match(workspaceSource, /function changeSubjectGroupFilter\(value: string\)/);
  assert.match(workspaceSource, /function changeSchoolLevelGroupFilter\(value: string\)/);
  assert.match(workspaceSource, /onGradeLevelFilterChange=\{changeGradeLevelGroupFilter\}/);
  assert.match(workspaceSource, /onCategoryFilterChange=\{changeCategoryGroupFilter\}/);
  assert.match(workspaceSource, /onClear=\{clearMasterSelection\}/);
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

  assert.match(workspaceSource, /canLoadManagementTextbookData/);
  assert.match(workspaceSource, /scope: canLoadManagementTextbookData \? "management" : "request"/);
  assert.match(workspaceSource, /if \(!canManageTextbookOperations && value !== "requests"\)/);
  assert.match(workspaceSource, /canManageTextbookOperations \? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" : "grid-cols-1"/);
  assert.match(serviceSource, /type TextbookOperationsDataScope = "management" \| "request"/);
  assert.match(serviceSource, /const canLoadManagementTables = scope === "management"/);
  assert.match(serviceSource, /canLoadManagementTables \? readTable\(client, "textbook_stock_moves"/);
  assert.match(serviceSource, /canLoadManagementTables \? readTable\(client, "textbook_sale_lines"/);
  assert.match(serviceSource, /canLoadManagementTables \? readTable\(client, "textbook_monthly_closings"/);
});
