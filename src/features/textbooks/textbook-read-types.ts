export type Row = Record<string, unknown>;

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
export type SaleHistoryFilters = { search: string; year: string; month: string; classId: string };
export type InventoryFilters = MasterFilters & { locationId: string; audit: InventoryAuditFilter };
export type InventoryHistoryFilters = { textbookId: string | null; locationId: string | null };
export type ClosingFilters = { month: string; subject: string; status: string };
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
