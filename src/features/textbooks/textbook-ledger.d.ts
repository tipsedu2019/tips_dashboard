export type TextbookLedgerRow = Record<string, unknown>;

export const TEXTBOOK_COPY_SCOPE_STUDENT: "student";
export const TEXTBOOK_COPY_SCOPE_TEACHER: "teacher";

export function normalizeTextbookLookupValue(value: unknown, options?: { compact?: boolean }): string;
export function getTextbookByReference(textbooks?: TextbookLedgerRow[], reference?: unknown): TextbookLedgerRow | undefined;
export function normalizeTextbookCopyScope(value: unknown): "student" | "teacher";
export function getTextbookCopyScope(row?: TextbookLedgerRow): "student" | "teacher";
export function normalizeBarcodeValue(value: unknown): string;
export function normalizeOptionalUuid(value: unknown): string | null;
export function getTextbookActionErrorMessage(error: unknown): string;
export function getTextbookTitle(row?: TextbookLedgerRow): string;
export function getTextbookSalePrice(row?: TextbookLedgerRow): number;
export function isTipsTextbookSource(row?: TextbookLedgerRow): boolean;
export function getTextbookPurchaseUnitCost(row?: TextbookLedgerRow): number;
export function getTextbookUnitMargin(row?: TextbookLedgerRow): number;
export function getTextbookSubject(row?: TextbookLedgerRow): string;
export function getRecordId(row?: TextbookLedgerRow): string;
export function listIds(value: unknown): string[];
export function buildTextbookInventorySnapshot(args?: {
  textbooks?: TextbookLedgerRow[];
  locations?: TextbookLedgerRow[];
  stockMoves?: TextbookLedgerRow[];
}): TextbookLedgerRow[];
export function buildTextbookSaleDraft(args?: {
  classRecord?: TextbookLedgerRow;
  students?: TextbookLedgerRow[];
  textbook?: TextbookLedgerRow;
  chargeMonth?: string;
  excludedStudentIds?: string[];
  locationId?: string;
  quantity?: number;
  availableQuantity?: number;
}): {
  sale: TextbookLedgerRow;
  lines: TextbookLedgerRow[];
  totalQuantity: number;
  totalAmount: number;
  availableQuantity: number;
  stockShortage: number;
  hasStockShortage: boolean;
};
export function buildTeacherTextbookIssueDraft(args?: {
  textbook?: TextbookLedgerRow;
  teacherId?: string;
  teacherName?: string;
  chargeMonth?: string;
  excludedStudentIds?: string[];
  locationId?: string;
  quantity?: number;
  availableQuantity?: number;
}): {
  sale: TextbookLedgerRow;
  lines: TextbookLedgerRow[];
  totalQuantity: number;
  totalAmount: number;
  availableQuantity: number;
  stockShortage: number;
  hasStockShortage: boolean;
};
export function filterStockMovesForClosing(args?: {
  closingMonth?: string;
  subject?: string;
  textbooks?: TextbookLedgerRow[];
  publishers?: TextbookLedgerRow[];
  suppliers?: TextbookLedgerRow[];
  publisherSupplierLinks?: TextbookLedgerRow[];
  stockMoves?: TextbookLedgerRow[];
}): TextbookLedgerRow[];
export function validateMonthlyClosingDraft(
  closing?: TextbookLedgerRow & { needsReview?: boolean },
  options?: { memo?: string },
): TextbookLedgerRow & { needsReview?: boolean };
export function buildPurchaseLifecycleDraft(args?: {
  stage?: string;
  requestedQuantity?: number;
  orderedQuantity?: number;
  receivedQuantity?: number;
  statementNumber?: string;
  copyScope?: string;
}): TextbookLedgerRow & {
  stage: string;
  copyScope: "student" | "teacher";
  requestedQuantity: number;
  orderedQuantity: number;
  receivedQuantity: number;
  statementNumber: string;
  status: string;
  createsStockMove: boolean;
};
export function validatePurchaseLifecycleDraft<T extends TextbookLedgerRow>(draft?: T): T;
export function buildSaleLineStatusTransition(args?: {
  line?: TextbookLedgerRow;
  targetStatus?: string;
  availableQuantity?: number;
}): {
  targetStatus: string;
  shouldCreateStockMove: boolean;
  stockMove: TextbookLedgerRow | null;
};
export function groupPurchaseLinesByStatus(args?: {
  orders?: TextbookLedgerRow[];
  lines?: TextbookLedgerRow[];
}): Record<string, TextbookLedgerRow[]>;
export function groupSaleLinesByStatus(args?: {
  lines?: TextbookLedgerRow[];
}): Record<string, TextbookLedgerRow[]>;
export function buildTextbookMonthlyClosing(args?: {
  openingQuantity?: number;
  openingAmount?: number;
  stockMoves?: TextbookLedgerRow[];
  receivedAmount?: number;
  supplierPaymentAmount?: number;
}): {
  openingQuantity: number;
  openingAmount: number;
  purchaseQuantity: number;
  purchaseAmount: number;
  saleQuantity: number;
  saleAmount: number;
  adjustmentQuantity: number;
  adjustmentAmount: number;
  endingQuantity: number;
  endingAmount: number;
  receivedAmount: number;
  supplierPaymentAmount: number;
  paymentDifference: number;
  textbookMarginAmount: number;
  teamMargins: Array<{
    team: string;
    saleQuantity: number;
    saleAmount: number;
    purchaseCostAmount: number;
    marginAmount: number;
  }>;
  settlementDifference: number;
  needsReview: boolean;
};
