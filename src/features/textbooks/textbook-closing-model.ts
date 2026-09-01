import type { Row } from "./textbook-read-types";
import { getRecordId, getTextbookPurchaseUnitCost, getTextbookSalePrice, getTextbookTitle, normalizeTextbookLookupValue } from "./textbook-ledger.js";
import { text, numberValue, normalizeTextbookLookup } from "./textbook-read-model";

export function buildTextbookLookupMap(textbooks: Row[]) {
  const lookup = new Map<string, Row>();
  for (const textbook of textbooks) {
    const aliases = [
      getRecordId(textbook),
      getTextbookTitle(textbook),
      textbook.name,
      textbook.isbn13,
      textbook.isbn,
      textbook.barcode,
    ];
    for (const alias of aliases) {
      const key = normalizeTextbookLookup(alias);
      if (key && !lookup.has(key)) {
        lookup.set(key, textbook);
      }
      const compactKey = normalizeTextbookLookupValue(alias, { compact: true });
      if (compactKey && !lookup.has(compactKey)) {
        lookup.set(compactKey, textbook);
      }
    }
  }
  return lookup;
}

export function getTextbookFromLookup(lookup: Map<string, Row>, reference: unknown) {
  return lookup.get(normalizeTextbookLookup(reference)) ||
    lookup.get(normalizeTextbookLookupValue(reference, { compact: true }));
}

export function buildLocationNameLookup(locations: Row[]) {
  const lookup = new Map<string, string>();
  for (const location of locations) {
    const name = text(location.name || location.code);
    for (const alias of [getRecordId(location), location.code]) {
      const key = text(alias);
      if (key && name) {
        lookup.set(key, name);
      }
    }
  }
  return lookup;
}

export function getLocationNameFromLookup(lookup: Map<string, string>, reference: unknown) {
  const key = text(reference);
  return lookup.get(key) || key;
}

export const stockMoveTypeLabels: Record<string, string> = {
  opening: "기초",
  purchase_receipt: "입고",
  sale_issue: "출고",
  return_in: "반품 입고",
  return_out: "반품 출고",
  transfer_in: "이동 입고",
  transfer_out: "이동 출고",
  stock_adjustment: "실사 조정",
};

export type ClosingStoredMetrics = {
  purchaseQuantity: number;
  saleQuantity: number;
  endingQuantity: number;
  marginAmount: number;
  status: string;
  memo: string;
};

export function getClosingStoredMetrics(row: Row | undefined): ClosingStoredMetrics {
  return {
    purchaseQuantity: numberValue(row?.purchase_quantity || row?.purchaseQuantity),
    saleQuantity: numberValue(row?.sale_quantity || row?.saleQuantity),
    endingQuantity: numberValue(row?.ending_quantity || row?.endingQuantity),
    marginAmount: numberValue(
      row?.settlement_difference
        || row?.settlementDifference
        || row?.textbook_margin_amount
        || row?.textbookMarginAmount,
    ),
    status: text(row?.status) || "대기",
    memo: text(row?.memo),
  };
}

export function hasClosingMetricMismatch(storedValue: number, detailValue: number) {
  return Math.round(storedValue) !== Math.round(detailValue);
}

export function getClosingDetailSearchHaystack(item: {
  typeLabel: string;
  textbookTitle: string;
  locationName: string;
  quantity: number;
  amount: number;
  marginAmount: number;
}) {
  return [
    item.typeLabel,
    item.textbookTitle,
    item.locationName,
    String(item.quantity),
    String(item.amount),
    String(item.marginAmount),
  ].join(" ").toLowerCase();
}

export function buildClosingDetailRows(detailMoves: Row[], textbookLookup: Map<string, Row>, locationNameLookup: Map<string,string>) {
  return detailMoves
    .map((move) => {
      const type = text(move.move_type || move.moveType);
      const quantity = numberValue(move.quantity);
      const unitSalePrice = Math.abs(numberValue(move.unit_amount || move.unitAmount)) || getTextbookSalePrice(move);
      const saleQuantity = type === "sale_issue" ? Math.abs(quantity) : 0;
      const unitPurchaseCost = saleQuantity > 0
        ? getTextbookPurchaseUnitCost({ ...move, sale_price: unitSalePrice, price: unitSalePrice })
        : 0;
      const marginAmount = saleQuantity > 0
        ? Math.max(0, (unitSalePrice - unitPurchaseCost) * saleQuantity)
        : 0;
      const textbook = (move.textbook || getTextbookFromLookup(textbookLookup, move.textbook_id || move.textbookId)) as Row | undefined;
      return {
        id: getRecordId(move),
        at: text(move.moved_at || move.movedAt || move.created_at || move.createdAt),
        typeLabel: stockMoveTypeLabels[type] || type || "재고 변경",
        textbookTitle: getTextbookTitle(textbook || {}) || "-",
        locationName: getLocationNameFromLookup(locationNameLookup, move.location_id || move.locationId) || "-",
        quantity,
        amount: numberValue(move.amount || move.total_amount || move.totalAmount),
        marginAmount,
      };
    })
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
}
