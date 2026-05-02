import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

  assert.match(workspaceSource, /TabsList className="grid h-auto w-full grid-cols-2 rounded-md border bg-background p-1 sm:grid-cols-3 lg:grid-cols-6/);
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
  assert.match(settingsSource, /필터 표시/);
  assert.match(taxonomySource, /TEXTBOOK_SCHOOL_LEVEL_OPTIONS/);
  assert.match(taxonomySource, /TEXTBOOK_GRADE_OPTIONS/);
  assert.match(taxonomySource, /"단어", "독해", "듣기", "문법", "모고", "내신"/);
  assert.match(taxonomySource, /"공통수학1", "공통수학2"/);
  assert.match(serviceSource, /textbookSubSubjectSettings/);
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
  assert.match(workspaceSource, /toggleTextbookSelection/);
  assert.match(workspaceSource, /toggleAllVisibleTextbooks/);
  assert.match(workspaceSource, /applyBulkTextbookEdit/);
  assert.match(workspaceSource, /deleteSelectedTextbooks/);
  assert.match(workspaceSource, /selectedTextbookRows = useMemo\([\s\S]*filteredInventory\.filter/);
  assert.match(workspaceSource, /const visibleIds = new Set\(visibleTextbookIds\)/);
  assert.match(workspaceSource, /조건에 맞는 교재가 없습니다/);
  assert.match(workspaceSource, /aria-label=\{`\$\{getTextbookTitle\(row\)\} \$\{getPublisherLabel\(row\)\} \$\{rowId\} 선택`\}/);
  assert.match(workspaceSource, /onBulkSelectionChange/);
  assert.match(workspaceSource, /categoryOptions=\{categoryGroupOptions\}/);
  assert.match(workspaceSource, /publisherOptions=\{publisherGroupOptions\}/);
  assert.match(workspaceSource, /placeholder=\{categoryOptions\.length > 0 \? "유지 또는 선택" : "유지"\}/);
  assert.match(serviceSource, /deleteTextbookMasters/);
  assert.match(serviceSource, /\.from\("textbooks"\)[\s\S]*\.delete\(\)[\s\S]*\.in\("id", ids\)/);
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
  assert.doesNotMatch(workspaceSource, /메이크에듀/);
  assert.doesNotMatch(workspaceSource, /납부/);
  assert.doesNotMatch(workspaceSource, /SelectItem value="issued">/);
  assert.match(serviceSource, /buildPurchaseLifecycleDraft/);
  assert.match(serviceSource, /buildSaleLineStatusTransition/);
  assert.match(serviceSource, /updateSaleLineStatus/);
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
  assert.match(workspaceSource, /Table className="w-full min-w-\[920px\]"/);
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
  assert.match(workspaceSource, /className="shrink-0" onClick=\{onAddLine\}/);
  assert.match(workspaceSource, /mode === "request" \? "w-full min-w-\[1100px\]" : "w-full min-w-\[1160px\]"/);
  assert.match(workspaceSource, /aria-label=\{\`\$\{group\.title\} 그룹 \$\{collapsed \? "펼치기" : "접기"\}\`\}/);
  assert.match(workspaceSource, /!collapsed && rows\.length > 0/);
  assert.match(serviceSource, /deletePurchaseLifecycle/);
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
  assert.match(workspaceSource, /textbookId: selectedPurchaseTextbookId \|\| purchaseForm\.textbookId/);
  assert.match(workspaceSource, /aria-label="요청 교재명"/);
  assert.match(workspaceSource, /getRequestedTextbookTitle/);
  assert.match(workspaceSource, /getPurchaseTextbookTitle/);
  assert.match(workspaceSource, /openMasterFromPurchaseRequest/);
  assert.match(workspaceSource, /마스터 등록/);
  assert.match(workspaceSource, /buildKyoboSearchUrl/);
  assert.match(workspaceSource, /교보 검색/);
  assert.match(workspaceSource, /disabled=\{!textbook\}/);
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
  assert.match(workspaceSource, /normalizeTextbookLookup/);
  assert.match(workspaceSource, /getTextbookTitle\(textbook\)/);
  assert.match(workspaceSource, /publisherSupplierLinks=\{data\.publisherSupplierLinks\}/);
  assert.match(tableSource, /publisherSupplierLinks: Row\[\]/);
  assert.match(tableSource, /const configuredSupplierId = getConfiguredSupplierIdForTextbook\(textbook, publisherSupplierLinks\) \|\| draft\.supplierId/);
  assert.match(tableSource, /const unitCost = getTextbookSalePrice\(textbook \|\| \{\}\) \|\| numberValue\(draft\.unitCost\)/);
  assert.match(tableSource, /TableHead className="w-\[96px\] text-right">단가/);
  assert.match(tableSource, /TableHead className="w-\[88px\]">위치/);
  assert.match(tableSource, /<TableCell className="max-w-\[88px\] truncate">\{locationName\}<\/TableCell>/);
  assert.doesNotMatch(tableSource, /<div className="text-xs text-muted-foreground">\{getLocationName\(locations, draft\.locationId\)/);
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

  assert.match(tableSource, /mode === "request" \? "w-full min-w-\[1100px\]" : "w-full min-w-\[1160px\]"/);
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
  assert.match(workspaceSource, /DialogTitle>선택 요청 주문<\/DialogTitle>/);
  assert.match(workspaceSource, /선택한 요청을 공급처 주문 단계로 한꺼번에 전환합니다/);
  assert.match(workspaceSource, /draft\.orderedQuantity \|\| draft\.requestedQuantity \|\| "1"/);
  assert.match(workspaceSource, /const nextOrderedQuantity = nextStage === "request" \? orderedQuantity : orderedQuantity \|\| requestedQuantity \|\| "1"/);
  assert.match(workspaceSource, /<Metric label="요청" value=\{`\$\{formatQuantity\(purchaseForm\.requestedQuantity\)\}권`\}/);
  assert.match(tableSource, /주문 가능한 요청 전체 선택/);
  assert.match(tableSource, /선택 주문/);
  assert.match(tableSource, /onToggleVisibleLines\?\.\(visibleOrderableRequestLineIds, value === true\)/);
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
  assert.match(workspaceSource, /DialogClose/);
  assert.match(workspaceSource, /dialogFooterClassName/);
  assert.match(workspaceSource, /sticky bottom-0 -mx-6 -mb-6/);
  assert.doesNotMatch(workspaceSource, /showCloseButton=\{false\}/);
  assert.match(workspaceSource, /closeMasterDialog/);
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
  assert.doesNotMatch(workspaceSource, /onPointerDown=\{\(event\) =>/);
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
  assert.match(workspaceSource, /재고 이력/);
  assert.match(workspaceSource, /stockMoves=\{data\.stockMoves\}/);
  assert.match(workspaceSource, /stockCounts=\{data\.stockCounts\}/);
  assert.match(workspaceSource, /function getInventoryAuditActor/);
  assert.match(workspaceSource, /row\.created_by/);
  assert.match(workspaceSource, /currentUserLabel/);
  assert.match(workspaceSource, /stockMoveTypeLabels/);
  assert.match(serviceSource, /createStockCountAdjustment[\s\S]*created_by: createdBy/);
  assert.match(serviceSource, /updateSaleLineStatus[\s\S]*created_by: createdBy/);
});

test("inventory stock count is inline and mobile-first with recommended targets", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /type InventoryAuditFilter = "recommended" \| "pending" \| "done" \| "all"/);
  assert.match(workspaceSource, /inventoryCountDrafts/);
  assert.match(workspaceSource, /inventoryCountMemoDrafts/);
  assert.match(workspaceSource, /inventoryAuditFilter/);
  assert.match(workspaceSource, /INVENTORY_COUNT_CYCLE_DAYS = 30/);
  assert.match(workspaceSource, /INVENTORY_LOW_STOCK_THRESHOLD = 3/);
  assert.match(workspaceSource, /function buildInventoryCountRows/);
  assert.match(workspaceSource, /function InventoryCountWorkspace/);
  assert.match(workspaceSource, /function InventoryCountMobileCard/);
  assert.match(workspaceSource, /submitInlineStockCount/);
  assert.match(workspaceSource, /onSubmitCount=\{submitInlineStockCount\}/);
  assert.match(workspaceSource, /aria-label=\{`\$\{row\.title\} \$\{row\.locationName\} 실사 수량`\}/);
  assert.match(workspaceSource, /aria-label=\{`\$\{row\.title\} \$\{row\.locationName\} 실사 메모`\}/);
  assert.match(workspaceSource, /className="grid gap-3 sm:hidden"/);
  assert.match(workspaceSource, /className="hidden overflow-x-auto rounded-lg border sm:block"/);
  assert.match(workspaceSource, /월 1회/);
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
  assert.match(workspaceSource, /setPurchaseRequestFilter\("orderable"\)/);
  assert.match(workspaceSource, /setSalesProcessFilter\("waiting"\)/);
  assert.match(workspaceSource, /setInventoryFilter\("shortage"\)/);
  assert.match(workspaceSource, /aria-label="교재 운영 액션 큐"/);
  assert.match(workspaceSource, /aria-label=\{`\$\{item\.label\} 보기`\}/);
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
});

test("textbook workspace keeps list and process controls responsive and focused", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /grid-cols-2 rounded-md border bg-background p-1 sm:grid-cols-3 lg:grid-cols-6/);
  assert.match(workspaceSource, /<Table className="min-w-\[1120px\] table-fixed">/);
  assert.match(workspaceSource, /목록 필터/);
  assert.match(workspaceSource, /type PurchaseRequestFilter = "all" \| "unregistered" \| "orderable"/);
  assert.match(workspaceSource, /전체 요청/);
  assert.match(workspaceSource, /주문 가능/);
  assert.match(workspaceSource, /shouldShowRequestLine/);
  assert.match(workspaceSource, /type SalesProcessFilter = "all" \| "waiting" \| "issued"/);
  assert.match(workspaceSource, /출고 완료/);
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
  assert.match(workspaceSource, /대기 \{formatQuantity\(activeQueueTotal\)\}/);
  assert.doesNotMatch(workspaceSource, /오늘 \{formatQuantity\(activeQueueTotal\)\}/);
  assert.match(workspaceSource, /activeQueueKey=\{activeQueueKey\}/);
  assert.match(workspaceSource, /activeQueueKey === item\.key/);
  assert.match(workspaceSource, /setPurchaseOrderFilter\("partial"\)/);
  assert.match(workspaceSource, /onOrderFilterChange=\{setPurchaseOrderFilter\}/);
  assert.match(workspaceSource, /purchaseOrderFilterLabels/);
  assert.match(workspaceSource, /orderFilter === "waiting"/);
  assert.match(workspaceSource, /orderFilter === "partial"/);
  assert.match(workspaceSource, /compareTextbookGroupLabels/);
  assert.match(workspaceSource, /visibleTextbookGroupLabels/);
  assert.match(workspaceSource, /collapseVisibleTextbookGroups/);
  assert.match(workspaceSource, /onCollapseAllGroups/);
  assert.match(workspaceSource, /aria-label=\{`\$\{group\.label\} 그룹 \$\{isCollapsed \? "펼치기" : "접기"\}`\}/);
});

test("textbook workspace names modal selects and removes duplicate hidden purchase form", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /getPurchaseDialogTitle/);
  assert.match(workspaceSource, /DialogTitle>\{getPurchaseDialogTitle\(purchaseForm\.requestStage, Boolean\(selectedPurchaseLineId\)\)\}/);
  assert.match(workspaceSource, /onOpenChange=\{\(open\) => \(open \? setPurchaseDialogOpen\(true\) : closePurchaseDialog\(\)\)\}/);
  assert.match(workspaceSource, /ariaLabel="요청자 선택"/);
  assert.match(workspaceSource, /"요청 위치 선택" : "입고 위치 선택"/);
  assert.match(workspaceSource, /ariaLabel="출고 위치 선택"/);
  assert.match(workspaceSource, /ariaLabel="실사 위치 선택"/);
  assert.match(workspaceSource, /aria-label="마감 과목 선택"/);
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
  assert.match(workspaceSource, /aria-label="업무 검색"/);
  assert.match(workspaceSource, /matchesPurchaseLineQuery/);
  assert.match(workspaceSource, /matchesSaleLineQuery/);
  assert.match(workspaceSource, /searchQuery=\{operationQuery\}/);
  assert.match(workspaceSource, /purchaseForm\.requestStage !== "request" \? \(/);
  assert.match(workspaceSource, /주문 추가/);
  assert.match(workspaceSource, /<TableHead className="w-\[88px\]">위치<\/TableHead>/);
  assert.match(workspaceSource, /<TableCell className="max-w-\[88px\] truncate">\{locationName\}<\/TableCell>/);
  assert.match(workspaceSource, /<TableCell colSpan=\{6\} className="text-right">합계<\/TableCell>/);
  assert.match(workspaceSource, /aria-label=\{`\$\{studentName\} \$\{textbookTitle\} 출고 완료 처리`\}/);
  assert.match(workspaceSource, /aria-label="일괄 과목 선택"/);
  assert.match(workspaceSource, /aria-label=\{`\$\{getTextbookTitle\(row\)\} \$\{getPublisherLabel\(row\)\} \$\{rowId\} 편집`\}/);
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
  assert.match(workspaceSource, /const hasPurchaseProcessRows = data\.purchaseOrderLines\.length > 0/);
  assert.match(workspaceSource, /const hasSalesProcessRows = data\.saleLines\.length > 0/);
  assert.match(workspaceSource, /value !== "requests" && value !== "purchase" && value !== "sales"[\s\S]*setOperationQuery\(""\)/);
  assert.match(workspaceSource, /formatQuantity\(groupCount\)\}그룹/);
  assert.match(workspaceSource, /sticky bottom-3 z-20/);
  assert.match(workspaceSource, /const groupTotalQuantity = group\.rows\.reduce/);
  assert.match(workspaceSource, /const groupAmountValue = group\.rows\.reduce/);
  assert.match(workspaceSource, /검색 조건에 맞는 주문·입고 건이 없습니다/);
  assert.match(workspaceSource, /검색 조건에 맞는 출고 건이 없습니다/);
  assert.match(workspaceSource, /function getVisiblePurchaseRows/);
  assert.match(workspaceSource, /visibleRowCount > 0 \? \(/);
  assert.match(workspaceSource, /label=\{getPurchaseProcessEmptyLabel\(mode, emptyGroupId, requestFilter, orderFilter, searchQuery\)\}/);
  assert.match(workspaceSource, /label=\{getSalesProcessEmptyLabel\(emptyGroupId, statusFilter, searchQuery\)\}/);
  assert.match(workspaceSource, /요청 \{formatQuantity\(requestedTotal\)\}/);
  assert.match(workspaceSource, /수량 \{formatQuantity\(totalQuantity\)\}/);
});

test("textbook workspace surfaces counts and data quality inside dense ledgers", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-operations-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /const \{ data, loading, error, refresh, user \} = useTextbookOperationsData\(\)/);
  assert.match(workspaceSource, /function TextbookLoadingState/);
  assert.match(workspaceSource, /aria-label="교재관리 로딩"/);
  assert.match(workspaceSource, /const listFilteredInventory = useMemo/);
  assert.match(workspaceSource, /const inventoryFilterCounts = useMemo/);
  assert.match(workspaceSource, /표시 \{formatQuantity\(filteredInventory\.length\)\}종/);
  assert.match(workspaceSource, /재고 \{formatQuantity\(filteredInventoryTotalQuantity\)\}권/);
  assert.match(workspaceSource, /판매가합 \{formatCurrency\(filteredInventorySaleValue\)\}/);
  assert.match(workspaceSource, /function getTextbookTitleKey/);
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
  assert.match(workspaceSource, /extraQualityIssueCount > 0/);
  assert.match(workspaceSource, /aria-label=\{`정리 필요:/);
  assert.match(workspaceSource, /function shouldShowRequestLineForFilter/);
  assert.match(workspaceSource, /function shouldShowOrderGroupForFilter/);
  assert.match(workspaceSource, /getRequestFilterCount\(option\.value\)/);
  assert.match(workspaceSource, /getOrderFilterCount\(filter\)/);
  assert.match(workspaceSource, /getSalesFilterCount\(option\.value as SalesProcessFilter\)/);
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
  assert.match(workspaceSource, /activeTab === "master" \? \(/);
  assert.match(workspaceSource, /textbookQualityFilterLabels\[filter\]/);
  assert.match(workspaceSource, /textbookQualityFilterCounts\[filter\]/);
  assert.match(workspaceSource, /aria-pressed=\{inventoryFilter === filter\}/);
  assert.match(workspaceSource, /aria-pressed=\{textbookQualityFilter === filter\}/);
  assert.match(workspaceSource, /aria-pressed=\{subjectFilter === option\.value\}/);
  assert.match(workspaceSource, /aria-pressed=\{schoolLevelFilter === option\.value\}/);
  assert.match(workspaceSource, /showZero/);
  assert.match(workspaceSource, /<TabCountBadge value=\{operationMetrics\.requestCount\} showZero \/>/);
  assert.match(workspaceSource, /<TabCountBadge value=\{data\.inventory\.length\} \/>/);
  assert.match(workspaceSource, /const tableTotals = \{/);
  assert.match(workspaceSource, /tableTotals\.locationQuantities/);
  assert.match(workspaceSource, /<TableHead className="w-20">학년<\/TableHead>/);
  assert.match(workspaceSource, /<TableHead className="w-28">세부과목<\/TableHead>/);
  assert.match(workspaceSource, /const gradeLabel = getTextbookGradeLabel/);
  assert.match(workspaceSource, /const subSubjectLabel = getTextbookSubSubject\(row\) \|\| "-"/);
  assert.match(workspaceSource, /<TableCell>합계<\/TableCell>/);
  assert.match(workspaceSource, /const renderedGroups = visibleGroups\.filter/);
  assert.match(workspaceSource, /const emptyGroupId = visibleGroups\[0\]\?\.id/);
  assert.match(workspaceSource, /function getTextbookQualityScore/);
  assert.match(workspaceSource, /const leftScore = getTextbookQualityScore/);
  assert.match(workspaceSource, /const groupQualityIssueCount = group\.rows\.filter/);
  assert.match(workspaceSource, /aria-label=\{`\$\{getTextbookTitle\(row\)\} \$\{getPublisherLabel\(row\)\} \$\{rowId\} 선택`\}/);
  assert.match(workspaceSource, /function ProcessGroupEmptyState\(\{ label, actionLabel, onAction \}/);
  assert.match(workspaceSource, /actionLabel=\{mode === "request" \? "요청 바로 추가" : "주문 바로 추가"\}/);
  assert.match(workspaceSource, /actionLabel="출고 바로 추가"/);
  assert.match(workspaceSource, /const getBoardScopeCount = \(scope: PurchaseBoardScope\)/);
  assert.match(workspaceSource, /getBoardScopeCount\(scope\)/);
  assert.match(workspaceSource, /Math\.min\(data\.monthlyClosings\.length, 12\)/);
  assert.match(workspaceSource, /<TableHeader className="sticky top-0 z-10 bg-background">/);
  assert.match(workspaceSource, /표시 \{formatQuantity\(visibleRowCount\)\}건/);
  assert.match(workspaceSource, /수량 \{formatQuantity\(visibleTotalQuantity\)\}/);
});
