export type Row = Record<string, unknown>;

export type TextbookReferenceFilters = { search: string; selectedFilters: Partial<Record<"subject" | "grade" | "subSubject", string[]>> };
export type TextbookClassReferenceFilters = { search: string; selectedFilters: Partial<Record<"subject" | "grade" | "teacher", string[]>> };
export type TextbookReferenceSearch = { search: string };
export type TextbookReferenceFacetPage = import("@/lib/numbered-pagination").NumberedPage<SearchSelectOption> & {
  baseFilterGroups: SearchSelectFilterGroup[]; visibleFilterGroups: SearchSelectFilterGroup[]; activeFilterCount: number;
};
export type TextbookReferenceLocation = { id: string; code: string; name: string };
export type TextbookLocationReferencePage = import("@/lib/numbered-pagination").NumberedPage<SearchSelectOption> & { defaultLocation: TextbookReferenceLocation | null };
export type TextbookReferenceInput = { reference: string; activeOnly: boolean; scope: "request" | "management"; fallbackSupplier: string };
export type SelectedTextbookReference = WorkflowTextbookReference & {
  category: string | null; school_level: string; grade_level: string; school_levels: string[]; grade_levels: string[]; sub_subject: string; subject_area_key: string | null;
};
export type TextbookReferenceResult = { row: { textbook: SelectedTextbookReference; option: SearchSelectOption | null; configuredSupplierId: string; supplier: { id: string; name: string } | null } | null };
export type TextbookClassReferenceResult = { row: { id: string; name: string; option: SearchSelectOption; enrolledStudentCount: number; defaultTeacherName: string; inferredLocation: TextbookReferenceLocation | null } | null };
export type TextbookLocationReferenceResult = { row: (TextbookReferenceLocation & { option: SearchSelectOption }) | null };
export type TextbookMasterOptionsInput = { subject: "english" | "math" | "science" | "other"; listSubject: "all" | "english" | "math" | "science" | "other"; bulkSubject: "keep" | "english" | "math" | "science" | "other" };
export type TextbookMasterOptions = { publisherOptions: Array<{ value: string; label: string; description: string }>; subSubjectOptions: string[]; categoryOptions: string[]; bulkCategoryOptions: string[];
  scienceSubjectAreas: Array<{ subject: string; area_key: string; label: string; sort_order: number; is_active: boolean }>;
  counts: Record<"publisherOptions" | "subSubjectOptions" | "categoryOptions" | "bulkCategoryOptions" | "scienceSubjectAreas", number>; complete: true };
export type TextbookInactiveCleanupContext = { targetIds: string[]; totalCount: number; previewRows: Array<{ id: string; title: string; detail: string }>; complete: true };

export type SearchSelectOption = {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
  metaRows?: SearchSelectMetaRow[];
  filterValues?: Record<string, SearchSelectFilterValue[]>;
};

export type SearchSelectMetaRow = {
  label: string;
  value: string;
};

export type SearchSelectFilterValue = {
  value: string;
  label: string;
};

export type SearchSelectFilterOption = SearchSelectFilterValue & {
  count: number;
};

export type SearchSelectFilterLayout = "default" | "subject-grade-teacher" | "subject-grade-detail";

export type SearchSelectFilterGroupConfig = {
  key: string;
  label: string;
  optionOrder?: string[];
};

export type SearchSelectFilterGroup = {
  key: string;
  label: string;
  optionOrder?: string[];
  options: SearchSelectFilterOption[];
};

export type InventoryFilter = "all" | "shortage" | "surplus" | "unused" | "negative";

export type InventoryAuditFilter = "recommended" | "pending" | "done" | "all";

export type TextbookQualityFilter =
  | "all"
  | "attention"
  | "duplicate"
  | "missingCode"
  | "missingPublisher"
  | "missingCategory"
  | "missingPrice"
  | "subjectMismatch"
  | "inactive";

export type PurchaseBoardScope = "active" | "recent" | "all";

export type PurchaseRequestFilter = "all" | "unregistered" | "orderable";

export type PurchaseOrderFilter = "all" | "waiting" | "partial" | "returnable" | "returned";

export type SalesProcessFilter = "all" | "waiting" | "issued" | "returned" | "cancelled";

export type PurchaseKanbanStatus = "requested" | "ordered" | "partially_received" | "received" | "cancelled" | "returned";

export type TextbookCopyScope = "student" | "teacher";

export type PurchaseQuantityKind = "requested" | "ordered" | "received";

export type PurchaseKanbanDraft = {
  textbookId: string;
  requestedTextbookTitle: string;
  copyScope: TextbookCopyScope;
  classId: string;
  supplierId: string;
  locationId: string;
  requestBy: string;
  requestedQuantity: string;
  orderedQuantity: string;
  receivedQuantity: string;
  studentRequestedQuantity: string;
  teacherRequestedQuantity: string;
  studentOrderedQuantity: string;
  teacherOrderedQuantity: string;
  studentReceivedQuantity: string;
  teacherReceivedQuantity: string;
  unitCost: string;
  statementNumber: string;
  memo: string;
};

export type InventoryCountRow = {
  source: Row;
  id: string;
  title: string;
  publisher: string;
  locationId: string;
  locationName: string;
  currentQuantity: number;
  latestCountAt: string;
  daysSinceLatestCount: number;
  isCountedThisCycle: boolean;
  isRecommended: boolean;
  status: InventoryAuditFilter;
  reason: string;
  dueLabel: string;
};

export type InventoryHistoryRow = {
  id: string;
  kind: "move" | "count";
  sourceId: string;
  linkedMoveId: string;
  at: string;
  textbookTitle: string;
  locationName: string;
  change: string;
  action: string;
  actor: string;
  memo: string;
};

export type TextbookSearchIndex = {
  haystack: string;
  barcodeText: string;
};

export type SaleHistorySummaryRow = {
  id: string;
  year: string;
  month: string;
  classId: string;
  className: string;
  textbookId: string;
  textbookTitle: string;
  waitingQuantity: number;
  issuedQuantity: number;
  totalQuantity: number;
  latestAt: string;
};

export type PageRequest<F, S extends string> = {
  page: number;
  pageSize: 10 | 15 | 20;
  filters: F;
  sort: S;
};
export type MasterFilters = {
  search: string;
  subject: string;
  schoolLevel: string;
  gradeLevel: string;
  subSubject: string;
  quality: TextbookQualityFilter;
  inventory: InventoryFilter;
};
export type PurchaseFilters = {
  mode: "request" | "order";
  search: string;
  boardScope: PurchaseBoardScope;
  requestFilter: PurchaseRequestFilter;
  orderFilter: PurchaseOrderFilter;
};
export type SaleFilters = { search: string; status: SalesProcessFilter };
// History has no operations-search consumer or search semantics.
export type SaleHistoryFilters = { search: ""; year: string; month: string; classId: string };
export type TextbookSaleHistorySummary = {
  totalCount: number;
  totalWaitingQuantity: number;
  totalIssuedQuantity: number;
  sourceTotalCount: number;
  yearOptions: string[];
  monthOptions: string[];
  classOptions: Array<[string, string]>;
  effectiveMonth: string;
};
export type InventoryFilters = MasterFilters & { locationId: string; audit: InventoryAuditFilter };
export type InventoryHistoryFilters = { textbookId: string | null; locationId: string | null };
export type ClosingFilters = { month: string; subject: string; status: string };
export type ClosingMovementFilters = { closingMonth: string; subject: string; search: string };
export type ClosingMovementRow = { id: string; at: string; typeLabel: string; textbookTitle: string; locationName: string; quantity: number; amount: number; marginAmount: number };
export type ClosingRow = Row & {
  id: string; closing_month: string; subject: string; opening_quantity: number; opening_amount: number;
  purchase_quantity: number; purchase_amount: number; sale_quantity: number; sale_amount: number;
  adjustment_quantity: number; adjustment_amount: number; ending_quantity: number; ending_amount: number;
  received_amount: number; supplier_payment_amount: number; settlement_difference: number;
  status: "draft" | "locked"; memo: string; created_by: string | null; created_at: string | null; updated_at: string | null;
};
export type ClosingPreviewInput = { closingMonth: string; subject: string; openingQuantity: number; openingAmount: number };
export type ClosingCalculation = ReturnType<typeof import("./textbook-ledger.js").buildTextbookMonthlyClosing>;
export type TextbookClosingPreview = { closingMonth: string; subject: string; sourceLineCount: number; closing: ClosingCalculation };
export type TextbookClosingDetail = { row: ClosingRow | null; preview: TextbookClosingPreview | null;
  storedMetrics: import("./textbook-closing-model").ClosingStoredMetrics | null;
  metricMismatches: { purchase: boolean; sale: boolean; ending: boolean; margin: boolean } | null; metricMismatchCount: number };
export type TextbookClosingSaveContext = { closingMonth: string; subject: string; sourceLineCount: number; sourceLineIds: string[];
  stockMoves: Row[]; textbooks: Row[]; publishers: Row[]; suppliers: Row[]; publisherSupplierLinks: Row[]; complete: true };
export type ClassTextbookSaleContextInput = { classId: string; textbookId: string; chargeMonth: string; locationId: string };
export type ClassTextbookSaleContext = {
  input: ClassTextbookSaleContextInput; class: Row; enrolledStudentIds: string[]; students: Row[]; missingStudentIds: string[];
  textbook: WorkflowTextbookReference; location: WorkflowLocationReference; inventory: TextbookInventoryBalanceRow;
  duplicateLines: SaleMemberSource[]; duplicateSales: SaleSource[]; duplicateLineIds: string[]; duplicateLineCount: number;
  duplicateStudentIds: string[]; duplicateCount: number; complete: true;
};
export type TextbookHandoffResult = { groups: import("./textbook-handoff-model").TextbookHandoffGroup[]; sourceLineCount: number; complete: true };
export type TextbookClosingMovementExport = { rows: ClosingMovementRow[]; sourceLineCount: number; complete: true };
export type SettingFilters = { search: string };

export type TextbookQualityIssues = Record<Exclude<TextbookQualityFilter, "all" | "attention">, boolean>;

// The existing ledger snapshot fields; balances always represent complete movement input.
export type TextbookMasterRow = Row & {
  locationQuantities: Record<string, number>;
  studentLocationQuantities: Record<string, number>;
  teacherLocationQuantities: Record<string, number>;
  totalQuantity: number;
  studentQuantity: number;
  teacherQuantity: number;
  stockValue: number;
  qualityIssues: TextbookQualityIssues;
  qualityScore: number;
};

// id is a display key, never a mutation ID. Members retain complete original DTOs.
export type PurchaseCaseRow = {
  id: string;
  anchorLineId: string;
  memberLineIds: string[];
  line: Row & { purchaseScopeLines: Row[] };
  lines: Row[];
};

// Selected display references only; these are not complete save/picker contexts.
export type WorkflowTextbookReference = {
  id: string; title: string | null; name: string; status: string; subject: string | null;
  publisher: string | null; publisher_id: string | null; default_supplier_id: string | null;
  price: number | null; sale_price: number; list_price: number; isbn13: string | null;
  barcode: string | null; is_returnable: boolean;
};
export type WorkflowClassReference = { id: string; name: string; studentCount: number };
export type WorkflowLocationReference = { id: string; code: string; name: string };
export type WorkflowNamedReference = { id: string; name: string };
export type PurchaseOrderSource = Row & {
  id: string; supplier_id: string | null; requested_by: string; requested_date: string;
  order_date: string; expected_date: string | null; ordered_at: string | null; received_at: string | null;
  status: PurchaseKanbanStatus; statement_number: string; memo: string; created_by: string | null;
  created_at: string | null; updated_at: string | null;
};
export type PurchaseMemberSource = Row & {
  id: string; purchase_order_id: string; textbook_id: string | null; requested_textbook_title: string;
  class_id: string | null; location_id: string | null; requested_quantity: number; ordered_quantity: number;
  received_quantity: number; teacher_ordered_quantity: number; teacher_received_quantity: number;
  unit_cost: number; copy_scope: TextbookCopyScope; memo: string; created_at: string | null; updated_at: string | null;
  status: PurchaseKanbanStatus; order: PurchaseOrderSource | null;
};
export type PurchaseScopeQuantities = Record<PurchaseQuantityKind, number>;
export type PurchaseQuantities = PurchaseScopeQuantities & { student: PurchaseScopeQuantities; teacher: PurchaseScopeQuantities };
// Keep the extracted pure parent contract usable by its unchanged legacy caller.
// The RPC contract adds required typed enrichment to that existing parent shape.
export type TextbookPurchaseCaseRow = PurchaseCaseRow & {
  line: PurchaseMemberSource & { purchaseScopeLines: PurchaseMemberSource[] };
  lines: PurchaseMemberSource[]; mode: "request" | "order"; status: PurchaseKanbanStatus;
  eventAt: string; quantities: PurchaseQuantities;
  references: {
    textbook: WorkflowTextbookReference | null; class: WorkflowClassReference | null;
    location: WorkflowLocationReference | null; publisher: WorkflowNamedReference | null;
    supplier: WorkflowNamedReference | null; configuredSupplierId: string; unitCost: number;
  };
};
export type SaleSource = {
  id: string; class_id: string | null; charge_month: string; sale_date: string;
  status: "draft" | "charged" | "paid" | "issued" | "cancelled";
  memo: string; created_by: string | null; created_at: string | null; updated_at: string | null;
};
export type SaleMemberSource = {
  id: string; sale_id: string; student_id: string | null; class_id: string | null; textbook_id: string;
  charge_month: string; quantity: number; unit_price: number; location_id: string | null;
  status: "charged" | "paid" | "issued" | "excluded" | "cancelled" | "returned";
  exclusion_reason: string; memo: string; created_at: string | null; updated_at: string | null;
  copy_scope: TextbookCopyScope; teacher_id: string | null; teacher_name: string;
};
export type SaleLineRow = {
  id: string; line: SaleMemberSource; sale: SaleSource | null; textbook: WorkflowTextbookReference;
  class: WorkflowClassReference | null; student: WorkflowNamedReference | null; location: WorkflowLocationReference | null;
  status: Exclude<SaleMemberSource["status"], "paid">; groupStatus: "charged" | "issued" | "cancelled" | "returned";
  eventAt: string; quantity: number; amount: number; recipientName: string;
};
export type TextbookPurchaseSummary = {
  mode: "request" | "order"; totalCount: number; rawLineCount: number; quantities: PurchaseQuantities;
  groups: Array<{ status: PurchaseKanbanStatus; totalCount: number; rawLineCount: number; quantities: PurchaseQuantities }>;
  requestCounts: Record<PurchaseRequestFilter, number>; orderCounts: Record<PurchaseOrderFilter, number>;
  boardScopeCounts: Record<PurchaseBoardScope, number>;
};
export type TextbookSaleSummary = {
  totalCount: number; totalQuantity: number; studentCount: number; classCount: number; totalAmount: number;
  // Existing group headers use quantity||1 (unlike the overall max(1,quantity||1)).
  groups: Array<{ status: SaleLineRow["groupStatus"]; totalCount: number; totalQuantity: number }>;
  statusCounts: Record<SalesProcessFilter, number>;
};
export type TextbookOperationsSummary = {
  requestCount: number; unregisteredRequestCount: number; orderNeededCount: number;
  receivingBacklogCount: number; partialReceiptCount: number; issueWaitingCount: number; stockRiskCount: number;
};
export type TextbookPurchaseDetailInput = { anchorLineId: string; mode: "request" | "order" };
export type TextbookPurchaseDetail = { row: TextbookPurchaseCaseRow | null };
export type TextbookSaleDetail = { row: SaleLineRow | null };

export type TextbookMasterSummary = {
  totalCount: number;
  totalQuantity: number;
  studentQuantity: number;
  teacherQuantity: number;
  stockValue: number;
  salePriceTotal: number;
  locationQuantities: Record<string, number>;
  subjectTotals: Array<{
    subject: "english" | "math" | "science" | "other";
    totalCount: number;
    totalQuantity: number;
    salePriceTotal: number;
    stockValue: number;
  }>;
  qualityCounts: Record<TextbookQualityFilter, number>;
  inventoryCounts: Record<InventoryFilter, number>;
  subSubjectOptions: string[];
  locations: Array<{ id: string; code: string; name: string; sortOrder: number }>;
};
export type TextbookInventorySummary = TextbookMasterSummary & {
  auditCounts: Record<InventoryAuditFilter, number>;
};
export type TextbookMasterDetail = { row: TextbookMasterRow | null };
export type TextbookInventoryBalanceInput = { textbookIds: string[]; locationId: string | null };
export type TextbookInventoryBalanceRow = Pick<TextbookMasterRow,
  "locationQuantities" | "studentLocationQuantities" | "teacherLocationQuantities" |
  "totalQuantity" | "studentQuantity" | "teacherQuantity" | "stockValue"
> & { textbookId: string; currentQuantity: number };
export type TextbookInventoryBalance = { locationId: string | null; rows: TextbookInventoryBalanceRow[] };
export type TextbookMasterDuplicateInput = { excludeId: string | null; title: string; subject: string; publisher: string; category: string };
export type TextbookMasterDuplicate = { totalCount: number; previewRows: TextbookMasterRow[] };
// JSON has no Infinity: null is the explicit wire sentinel. The read service
// restores +Infinity before exposing the existing InventoryCountRow model.
export type TextbookInventoryCountTransport = Omit<InventoryCountRow, "source" | "daysSinceLatestCount"> & {
  source: TextbookMasterRow;
  daysSinceLatestCount: number | null;
};
// Task4 applies the signed-in user's email only when actorLabel is empty and
// actorId matches that session. Neither value is a database authority argument.
export type TextbookInventoryHistoryTransport = InventoryHistoryRow & { actorId: string; actorLabel: string };
