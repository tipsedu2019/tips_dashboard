import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';

// Frozen actual workspace pure closure from f29765fa, captured before extraction.
const originalClosingSource = "function buildTextbookLookupMap(textbooks: Row[]) {\n  const lookup = new Map<string, Row>();\n  for (const textbook of textbooks) {\n    const aliases = [\n      getRecordId(textbook),\n      getTextbookTitle(textbook),\n      textbook.name,\n      textbook.isbn13,\n      textbook.isbn,\n      textbook.barcode,\n    ];\n    for (const alias of aliases) {\n      const key = normalizeTextbookLookup(alias);\n      if (key && !lookup.has(key)) {\n        lookup.set(key, textbook);\n      }\n      const compactKey = normalizeTextbookLookupValue(alias, { compact: true });\n      if (compactKey && !lookup.has(compactKey)) {\n        lookup.set(compactKey, textbook);\n      }\n    }\n  }\n  return lookup;\n}\n\nfunction getTextbookFromLookup(lookup: Map<string, Row>, reference: unknown) {\n  return lookup.get(normalizeTextbookLookup(reference)) ||\n    lookup.get(normalizeTextbookLookupValue(reference, { compact: true }));\n}\n\nfunction buildLocationNameLookup(locations: Row[]) {\n  const lookup = new Map<string, string>();\n  for (const location of locations) {\n    const name = text(location.name || location.code);\n    for (const alias of [getRecordId(location), location.code]) {\n      const key = text(alias);\n      if (key && name) {\n        lookup.set(key, name);\n      }\n    }\n  }\n  return lookup;\n}\n\nfunction getLocationNameFromLookup(lookup: Map<string, string>, reference: unknown) {\n  const key = text(reference);\n  return lookup.get(key) || key;\n}\n\nconst stockMoveTypeLabels: Record<string, string> = {\n  opening: \"기초\",\n  purchase_receipt: \"입고\",\n  sale_issue: \"출고\",\n  return_in: \"반품 입고\",\n  return_out: \"반품 출고\",\n  transfer_in: \"이동 입고\",\n  transfer_out: \"이동 출고\",\n  stock_adjustment: \"실사 조정\",\n};\n\ntype ClosingStoredMetrics = {\n  purchaseQuantity: number;\n  saleQuantity: number;\n  endingQuantity: number;\n  marginAmount: number;\n  status: string;\n  memo: string;\n};\n\nfunction getClosingStoredMetrics(row: Row | undefined): ClosingStoredMetrics {\n  return {\n    purchaseQuantity: numberValue(row?.purchase_quantity || row?.purchaseQuantity),\n    saleQuantity: numberValue(row?.sale_quantity || row?.saleQuantity),\n    endingQuantity: numberValue(row?.ending_quantity || row?.endingQuantity),\n    marginAmount: numberValue(\n      row?.settlement_difference\n        || row?.settlementDifference\n        || row?.textbook_margin_amount\n        || row?.textbookMarginAmount,\n    ),\n    status: text(row?.status) || \"대기\",\n    memo: text(row?.memo),\n  };\n}\n\nfunction hasClosingMetricMismatch(storedValue: number, detailValue: number) {\n  return Math.round(storedValue) !== Math.round(detailValue);\n}\n\nfunction getClosingDetailSearchHaystack(item: {\n  typeLabel: string;\n  textbookTitle: string;\n  locationName: string;\n  quantity: number;\n  amount: number;\n  marginAmount: number;\n}) {\n  return [\n    item.typeLabel,\n    item.textbookTitle,\n    item.locationName,\n    String(item.quantity),\n    String(item.amount),\n    String(item.marginAmount),\n  ].join(\" \").toLowerCase();\n}\n\nfunction buildClosingDetailRows(detailMoves: Row[], textbookLookup: Map<string, Row>, locationNameLookup: Map<string,string>) { return detailMoves\n    .map((move) => {\n      const type = text(move.move_type || move.moveType);\n      const quantity = numberValue(move.quantity);\n      const unitSalePrice = Math.abs(numberValue(move.unit_amount || move.unitAmount)) || getTextbookSalePrice(move);\n      const saleQuantity = type === \"sale_issue\" ? Math.abs(quantity) : 0;\n      const unitPurchaseCost = saleQuantity > 0\n        ? getTextbookPurchaseUnitCost({ ...move, sale_price: unitSalePrice, price: unitSalePrice })\n        : 0;\n      const marginAmount = saleQuantity > 0\n        ? Math.max(0, (unitSalePrice - unitPurchaseCost) * saleQuantity)\n        : 0;\n      const textbook = (move.textbook || getTextbookFromLookup(textbookLookup, move.textbook_id || move.textbookId)) as Row | undefined;\n      return {\n        id: getRecordId(move),\n        at: text(move.moved_at || move.movedAt || move.created_at || move.createdAt),\n        typeLabel: stockMoveTypeLabels[type] || type || \"재고 변경\",\n        textbookTitle: getTextbookTitle(textbook || {}) || \"-\",\n        locationName: getLocationNameFromLookup(locationNameLookup, move.location_id || move.locationId) || \"-\",\n        quantity,\n        amount: numberValue(move.amount || move.total_amount || move.totalAmount),\n        marginAmount,\n      };\n    })\n    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime()); }";
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const feature = new URL('../src/features/textbooks/', import.meta.url);
const closingUrl = new URL('textbook-closing-model.ts', feature);
const handoffUrl = new URL('textbook-handoff-model.ts', feature);
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@/lib/supabase' && context.parentURL?.startsWith(feature.href)) return { url: 'data:text/javascript,export const supabase=null;export const supabaseConfigError="unconfigured";', shortCircuit: true };
  if (specifier === '@/lib/public-classes-cache-invalidation.js' && context.parentURL?.startsWith(feature.href)) return { url: 'data:text/javascript,export async function invalidatePublicClassesCacheAfterMutation(){}', shortCircuit: true };
  if (specifier.startsWith('./') && context.parentURL?.startsWith(feature.href)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return next(candidate.href, context);
  }
  return next(specifier, context);
} });

const contextUrl = new URL('textbook-work-context-service.ts', feature);
// Untouched payload substrings from original '# TASK3C_WIRE ' diagnostic lines.
// Distinct require-final run textbook-task3c-final, 153/153 domain +1937 baseline.
// Original log SHA256 15f1aaabb1bb783d8a01cc6445fa2fa62af0def2bc7503220a735f8701f95605.
// No redacted/encoded/repaired capture is used. Actor is actual auth.uid().
const finalClosingWirePayloads = [
  "{\"data\": {\"page\": 1, \"rows\": [{\"id\": \"3c000000-0000-4000-8000-000000008001\", \"memo\": \"\", \"status\": \"draft\", \"subject\": \"__t3c__\", \"created_at\": \"2026-08-31T18:22:22.68782+00:00\", \"created_by\": null, \"updated_at\": \"2026-08-31T18:22:22.68782+00:00\", \"sale_amount\": 0, \"closing_month\": \"__t3c__001\", \"ending_amount\": 0, \"sale_quantity\": 0, \"opening_amount\": 0, \"ending_quantity\": 0, \"purchase_amount\": 0, \"received_amount\": 0, \"opening_quantity\": 0, \"adjustment_amount\": 0, \"purchase_quantity\": 0, \"adjustment_quantity\": 0, \"settlement_difference\": 0, \"supplier_payment_amount\": 0}], \"pageSize\": 10, \"totalCount\": 1}, \"input\": {\"page\": 1, \"sort\": \"month-desc\", \"filters\": {\"month\": \"__t3c__001\", \"status\": \"all\", \"subject\": \"__t3c__\"}, \"pageSize\": 10}, \"method\": \"listTextbookClosingPage\", \"actorId\": \"3c000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"page\": 1, \"rows\": [{\"at\": \"2099-09-01T00:00:00+00:00\", \"id\": \"3c000000-0000-4000-8000-000000002200\", \"amount\": -40000, \"quantity\": -2, \"typeLabel\": \"출고\", \"locationName\": \"본관\", \"marginAmount\": 2000, \"textbookTitle\": \"__t3c_small__\"}], \"pageSize\": 10, \"totalCount\": 1}, \"input\": {\"page\": 1, \"sort\": \"event-desc\", \"filters\": {\"search\": \"\", \"subject\": \"science\", \"closingMonth\": \"2099-09\"}, \"pageSize\": 10}, \"method\": \"listTextbookClosingMovementPage\", \"actorId\": \"3c000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"row\": {\"id\": \"3c000000-0000-4000-8000-000000008201\", \"memo\": \"소규모 상세\", \"status\": \"draft\", \"subject\": \"science\", \"created_at\": \"2026-08-31T18:22:22.68782+00:00\", \"created_by\": null, \"updated_at\": \"2026-08-31T18:22:22.68782+00:00\", \"sale_amount\": 0, \"closing_month\": \"2099-09\", \"ending_amount\": 0, \"sale_quantity\": 2, \"opening_amount\": 0, \"ending_quantity\": 8, \"purchase_amount\": 0, \"received_amount\": 900, \"opening_quantity\": 10, \"adjustment_amount\": 0, \"purchase_quantity\": 0, \"adjustment_quantity\": 0, \"settlement_difference\": 4000.5, \"supplier_payment_amount\": 1}, \"preview\": {\"closing\": {\"saleAmount\": 40000, \"needsReview\": false, \"teamMargins\": [{\"team\": \"english\", \"saleAmount\": 0, \"marginAmount\": 0, \"saleQuantity\": 0, \"purchaseCostAmount\": 0}, {\"team\": \"math\", \"saleAmount\": 0, \"marginAmount\": 0, \"saleQuantity\": 0, \"purchaseCostAmount\": 0}, {\"team\": \"science\", \"saleAmount\": 40000, \"marginAmount\": 4000, \"saleQuantity\": 2, \"purchaseCostAmount\": 36000}, {\"team\": \"other\", \"saleAmount\": 0, \"marginAmount\": 0, \"saleQuantity\": 0, \"purchaseCostAmount\": 0}], \"endingAmount\": -40000, \"saleQuantity\": 2, \"openingAmount\": 0, \"endingQuantity\": 8, \"purchaseAmount\": 0, \"receivedAmount\": 0, \"openingQuantity\": 10, \"adjustmentAmount\": 0, \"purchaseQuantity\": 0, \"paymentDifference\": 0, \"adjustmentQuantity\": 0, \"settlementDifference\": 4000, \"textbookMarginAmount\": 4000, \"supplierPaymentAmount\": 0}, \"subject\": \"science\", \"closingMonth\": \"2099-09\", \"sourceLineCount\": 1}}, \"input\": \"3c000000-0000-4000-8000-000000008201\", \"method\": \"getTextbookClosingDetail\", \"actorId\": \"3c000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"closing\": {\"saleAmount\": 40000, \"needsReview\": false, \"teamMargins\": [{\"team\": \"english\", \"saleAmount\": 0, \"marginAmount\": 0, \"saleQuantity\": 0, \"purchaseCostAmount\": 0}, {\"team\": \"math\", \"saleAmount\": 0, \"marginAmount\": 0, \"saleQuantity\": 0, \"purchaseCostAmount\": 0}, {\"team\": \"science\", \"saleAmount\": 40000, \"marginAmount\": 4000, \"saleQuantity\": 2, \"purchaseCostAmount\": 36000}, {\"team\": \"other\", \"saleAmount\": 0, \"marginAmount\": 0, \"saleQuantity\": 0, \"purchaseCostAmount\": 0}], \"endingAmount\": -40000, \"saleQuantity\": 2, \"openingAmount\": 0, \"endingQuantity\": 8, \"purchaseAmount\": 0, \"receivedAmount\": 0, \"openingQuantity\": 10, \"adjustmentAmount\": 0, \"purchaseQuantity\": 0, \"paymentDifference\": 0, \"adjustmentQuantity\": 0, \"settlementDifference\": 4000, \"textbookMarginAmount\": 4000, \"supplierPaymentAmount\": 0}, \"subject\": \"science\", \"closingMonth\": \"2099-09\", \"sourceLineCount\": 1}, \"input\": {\"subject\": \"science\", \"closingMonth\": \"2099-09\", \"openingAmount\": 0, \"openingQuantity\": 10}, \"method\": \"getTextbookClosingPreview\", \"actorId\": \"3c000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"class\": {\"id\": \"3c000000-0000-4000-8000-000000000601\", \"name\": \"작은반\", \"student_ids\": [\"3c000000-0000-4000-8000-000000001001\", \"3c000000-0000-4000-8000-000000001001\", \"legacy\"]}, \"input\": {\"classId\": \"3c000000-0000-4000-8000-000000000601\", \"locationId\": \"3c000000-0000-4000-8000-000000000900\", \"textbookId\": \"3c000000-0000-4000-8000-000000000004\", \"chargeMonth\": \"2099-08\"}, \"complete\": true, \"location\": {\"id\": \"3c000000-0000-4000-8000-000000000900\", \"code\": \"__t3c_main__\", \"name\": \"본관\"}, \"students\": [{\"id\": \"3c000000-0000-4000-8000-000000001001\", \"name\": \"합성 학생 1\", \"grade\": \"중2\"}], \"textbook\": {\"id\": \"3c000000-0000-4000-8000-000000000004\", \"name\": \"__t3c_small__\", \"price\": 10001, \"title\": \"__t3c_small__\", \"isbn13\": null, \"status\": \"active\", \"barcode\": null, \"subject\": \"science\", \"publisher\": \"__t3c__ 출판사\", \"list_price\": 0, \"sale_price\": 10001, \"publisher_id\": \"3c000000-0000-4000-8000-000000000710\", \"is_returnable\": false, \"default_supplier_id\": null}, \"inventory\": {\"stockValue\": -40000, \"textbookId\": \"3c000000-0000-4000-8000-000000000004\", \"totalQuantity\": -2, \"currentQuantity\": -2, \"studentQuantity\": -2, \"teacherQuantity\": 0, \"locationQuantities\": {\"3c000000-0000-4000-8000-000000000900\": -2, \"3c000000-0000-4000-8000-000000000910\": 0}, \"studentLocationQuantities\": {\"3c000000-0000-4000-8000-000000000900\": -2, \"3c000000-0000-4000-8000-000000000910\": 0}, \"teacherLocationQuantities\": {\"3c000000-0000-4000-8000-000000000900\": 0, \"3c000000-0000-4000-8000-000000000910\": 0}}, \"duplicateCount\": 1, \"duplicateLines\": [{\"id\": \"3c000000-0000-4000-8000-000000004200\", \"memo\": \"\", \"status\": \"paid\", \"sale_id\": \"3c000000-0000-4000-8000-000000006001\", \"class_id\": null, \"quantity\": 2, \"copy_scope\": \"student\", \"created_at\": \"2099-08-01T00:00:00+00:00\", \"student_id\": \"3c000000-0000-4000-8000-000000001001\", \"teacher_id\": null, \"unit_price\": 0, \"updated_at\": null, \"location_id\": \"3c000000-0000-4000-8000-000000000900\", \"textbook_id\": \"3c000000-0000-4000-8000-000000000004\", \"charge_month\": \"2099-08-25\", \"makeedu_memo\": null, \"teacher_name\": \"\", \"makeedu_paid_at\": null, \"exclusion_reason\": \"\", \"makeedu_item_name\": null, \"makeedu_synced_at\": null, \"makeedu_import_key\": null, \"makeedu_student_no\": null, \"makeedu_paid_amount\": 0, \"makeedu_card_company\": null, \"makeedu_charge_month\": null, \"makeedu_charge_amount\": 0, \"makeedu_unpaid_amount\": 0, \"makeedu_payment_method\": null, \"makeedu_payment_status\": null, \"makeedu_discount_amount\": 0, \"makeedu_saved_point_amount\": 0, \"makeedu_payment_method_detail\": null}], \"duplicateSales\": [{\"id\": \"3c000000-0000-4000-8000-000000006001\", \"memo\": \"\", \"status\": \"charged\", \"class_id\": \"3c000000-0000-4000-8000-000000000601\", \"sale_date\": \"2099-08-01\", \"created_at\": \"2099-08-01T00:00:00+00:00\", \"created_by\": null, \"updated_at\": null, \"charge_month\": \"2099-08\"}], \"duplicateLineIds\": [\"3c000000-0000-4000-8000-000000004200\"], \"missingStudentIds\": [\"legacy\"], \"duplicateLineCount\": 1, \"enrolledStudentIds\": [\"3c000000-0000-4000-8000-000000001001\", \"3c000000-0000-4000-8000-000000001001\", \"legacy\"], \"duplicateStudentIds\": [\"3c000000-0000-4000-8000-000000001001\"]}, \"input\": {\"classId\": \"3c000000-0000-4000-8000-000000000601\", \"locationId\": \"3c000000-0000-4000-8000-000000000900\", \"textbookId\": \"3c000000-0000-4000-8000-000000000004\", \"chargeMonth\": \"2099-08\"}, \"method\": \"getClassTextbookSaleContext\", \"actorId\": \"3c000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"kind\": \"order\", \"lines\": [{\"id\": \"3c000000-0000-4000-8000-000000003200\", \"memo\": \"\", \"order\": {\"id\": \"3c000000-0000-4000-8000-000000005001\", \"memo\": \"\", \"status\": \"partially_received\", \"created_at\": \"2099-08-01T00:00:00+00:00\", \"created_by\": \"3c000000-0000-4000-8000-000000000901\", \"order_date\": \"2099-08-01\", \"ordered_at\": null, \"updated_at\": null, \"received_at\": null, \"supplier_id\": null, \"requested_by\": \"합성 교사\", \"expected_date\": null, \"requested_date\": \"2026-08-31\", \"statement_number\": \"\"}, \"status\": \"partially_received\", \"class_id\": \"3c000000-0000-4000-8000-000000000601\", \"unit_cost\": 0, \"copy_scope\": \"student\", \"created_at\": \"2099-08-01T00:00:00+00:00\", \"updated_at\": null, \"location_id\": \"3c000000-0000-4000-8000-000000000900\", \"textbook_id\": \"3c000000-0000-4000-8000-000000000004\", \"ordered_quantity\": 2, \"purchase_order_id\": \"3c000000-0000-4000-8000-000000005001\", \"received_quantity\": 1, \"requested_quantity\": 2, \"requested_textbook_title\": \"\", \"teacher_ordered_quantity\": 0, \"teacher_received_quantity\": 0}, {\"id\": \"3c000000-0000-4000-8000-000000003201\", \"memo\": \"\", \"order\": {\"id\": \"3c000000-0000-4000-8000-000000005001\", \"memo\": \"\", \"status\": \"partially_received\", \"created_at\": \"2099-08-01T00:00:00+00:00\", \"created_by\": \"3c000000-0000-4000-8000-000000000901\", \"order_date\": \"2099-08-01\", \"ordered_at\": null, \"updated_at\": null, \"received_at\": null, \"supplier_id\": null, \"requested_by\": \"합성 교사\", \"expected_date\": null, \"requested_date\": \"2026-08-31\", \"statement_number\": \"\"}, \"status\": \"partially_received\", \"class_id\": \"3c000000-0000-4000-8000-000000000601\", \"unit_cost\": 0, \"copy_scope\": \"teacher\", \"created_at\": \"2099-08-01T00:00:00+00:00\", \"updated_at\": null, \"location_id\": \"3c000000-0000-4000-8000-000000000910\", \"textbook_id\": \"3c000000-0000-4000-8000-000000000004\", \"ordered_quantity\": 1, \"purchase_order_id\": \"3c000000-0000-4000-8000-000000005001\", \"received_quantity\": 1, \"requested_quantity\": 1, \"requested_textbook_title\": \"\", \"teacher_ordered_quantity\": 0, \"teacher_received_quantity\": 0}], \"classes\": [{\"id\": \"3c000000-0000-4000-8000-000000000601\", \"name\": \"작은반\", \"studentCount\": 3}], \"complete\": true, \"locations\": [{\"id\": \"3c000000-0000-4000-8000-000000000900\", \"code\": \"__t3c_main__\", \"name\": \"본관\"}, {\"id\": \"3c000000-0000-4000-8000-000000000910\", \"code\": \"__t3c_annex__\", \"name\": \"별관\"}], \"suppliers\": [{\"id\": \"3c000000-0000-4000-8000-000000000720\", \"name\": \"__t3c__ 외부\", \"contact\": \"담당\"}, {\"id\": \"3c000000-0000-4000-8000-000000000721\", \"name\": \"팁스 서점\", \"contact\": \"담당\"}], \"textbooks\": [{\"id\": \"3c000000-0000-4000-8000-000000000004\", \"name\": \"__t3c_small__\", \"price\": 10001, \"title\": \"__t3c_small__\", \"isbn13\": null, \"status\": \"active\", \"barcode\": null, \"subject\": \"science\", \"publisher\": \"__t3c__ 출판사\", \"list_price\": 0, \"sale_price\": 10001, \"publisher_id\": \"3c000000-0000-4000-8000-000000000710\", \"is_returnable\": false, \"default_supplier_id\": null}], \"publishers\": [{\"id\": \"3c000000-0000-4000-8000-000000000710\", \"name\": \"__t3c__ 출판사\"}], \"sourceLineIds\": [\"3c000000-0000-4000-8000-000000003200\", \"3c000000-0000-4000-8000-000000003201\"], \"sourceLineCount\": 2, \"resolvedTextbookIds\": [\"3c000000-0000-4000-8000-000000000004\", \"3c000000-0000-4000-8000-000000000004\"], \"publisherSupplierLinks\": [{\"id\": \"3c000000-0000-4000-8000-000000000730\", \"priority\": 99, \"is_primary\": true, \"supplier_id\": \"3c000000-0000-4000-8000-000000000720\", \"publisher_id\": \"3c000000-0000-4000-8000-000000000710\"}, {\"id\": \"3c000000-0000-4000-8000-000000000731\", \"priority\": 0, \"is_primary\": false, \"supplier_id\": \"3c000000-0000-4000-8000-000000000721\", \"publisher_id\": \"3c000000-0000-4000-8000-000000000710\"}]}, \"input\": [{\"mode\": \"order\", \"search\": \"__t3c_small__\", \"boardScope\": \"all\", \"orderFilter\": \"all\", \"requestFilter\": \"all\"}, \"order\"], \"method\": \"getTextbookPurchaseHandoff\", \"actorId\": \"3c000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"kind\": \"return\", \"lines\": [{\"id\": \"3c000000-0000-4000-8000-000000003200\", \"memo\": \"\", \"order\": {\"id\": \"3c000000-0000-4000-8000-000000005001\", \"memo\": \"\", \"status\": \"partially_received\", \"created_at\": \"2099-08-01T00:00:00+00:00\", \"created_by\": \"3c000000-0000-4000-8000-000000000901\", \"order_date\": \"2099-08-01\", \"ordered_at\": null, \"updated_at\": null, \"received_at\": null, \"supplier_id\": null, \"requested_by\": \"합성 교사\", \"expected_date\": null, \"requested_date\": \"2026-08-31\", \"statement_number\": \"\"}, \"status\": \"partially_received\", \"class_id\": \"3c000000-0000-4000-8000-000000000601\", \"unit_cost\": 0, \"copy_scope\": \"student\", \"created_at\": \"2099-08-01T00:00:00+00:00\", \"updated_at\": null, \"location_id\": \"3c000000-0000-4000-8000-000000000900\", \"textbook_id\": \"3c000000-0000-4000-8000-000000000004\", \"ordered_quantity\": 2, \"purchase_order_id\": \"3c000000-0000-4000-8000-000000005001\", \"received_quantity\": 1, \"requested_quantity\": 2, \"requested_textbook_title\": \"\", \"teacher_ordered_quantity\": 0, \"teacher_received_quantity\": 0}, {\"id\": \"3c000000-0000-4000-8000-000000003201\", \"memo\": \"\", \"order\": {\"id\": \"3c000000-0000-4000-8000-000000005001\", \"memo\": \"\", \"status\": \"partially_received\", \"created_at\": \"2099-08-01T00:00:00+00:00\", \"created_by\": \"3c000000-0000-4000-8000-000000000901\", \"order_date\": \"2099-08-01\", \"ordered_at\": null, \"updated_at\": null, \"received_at\": null, \"supplier_id\": null, \"requested_by\": \"합성 교사\", \"expected_date\": null, \"requested_date\": \"2026-08-31\", \"statement_number\": \"\"}, \"status\": \"partially_received\", \"class_id\": \"3c000000-0000-4000-8000-000000000601\", \"unit_cost\": 0, \"copy_scope\": \"teacher\", \"created_at\": \"2099-08-01T00:00:00+00:00\", \"updated_at\": null, \"location_id\": \"3c000000-0000-4000-8000-000000000910\", \"textbook_id\": \"3c000000-0000-4000-8000-000000000004\", \"ordered_quantity\": 1, \"purchase_order_id\": \"3c000000-0000-4000-8000-000000005001\", \"received_quantity\": 1, \"requested_quantity\": 1, \"requested_textbook_title\": \"\", \"teacher_ordered_quantity\": 0, \"teacher_received_quantity\": 0}], \"classes\": [{\"id\": \"3c000000-0000-4000-8000-000000000601\", \"name\": \"작은반\", \"studentCount\": 3}], \"complete\": true, \"locations\": [{\"id\": \"3c000000-0000-4000-8000-000000000900\", \"code\": \"__t3c_main__\", \"name\": \"본관\"}, {\"id\": \"3c000000-0000-4000-8000-000000000910\", \"code\": \"__t3c_annex__\", \"name\": \"별관\"}], \"suppliers\": [{\"id\": \"3c000000-0000-4000-8000-000000000720\", \"name\": \"__t3c__ 외부\", \"contact\": \"담당\"}, {\"id\": \"3c000000-0000-4000-8000-000000000721\", \"name\": \"팁스 서점\", \"contact\": \"담당\"}], \"textbooks\": [{\"id\": \"3c000000-0000-4000-8000-000000000004\", \"name\": \"__t3c_small__\", \"price\": 10001, \"title\": \"__t3c_small__\", \"isbn13\": null, \"status\": \"active\", \"barcode\": null, \"subject\": \"science\", \"publisher\": \"__t3c__ 출판사\", \"list_price\": 0, \"sale_price\": 10001, \"publisher_id\": \"3c000000-0000-4000-8000-000000000710\", \"is_returnable\": false, \"default_supplier_id\": null}], \"publishers\": [{\"id\": \"3c000000-0000-4000-8000-000000000710\", \"name\": \"__t3c__ 출판사\"}], \"sourceLineIds\": [\"3c000000-0000-4000-8000-000000003200\", \"3c000000-0000-4000-8000-000000003201\"], \"sourceLineCount\": 2, \"resolvedTextbookIds\": [\"3c000000-0000-4000-8000-000000000004\", \"3c000000-0000-4000-8000-000000000004\"], \"publisherSupplierLinks\": [{\"id\": \"3c000000-0000-4000-8000-000000000730\", \"priority\": 99, \"is_primary\": true, \"supplier_id\": \"3c000000-0000-4000-8000-000000000720\", \"publisher_id\": \"3c000000-0000-4000-8000-000000000710\"}, {\"id\": \"3c000000-0000-4000-8000-000000000731\", \"priority\": 0, \"is_primary\": false, \"supplier_id\": \"3c000000-0000-4000-8000-000000000721\", \"publisher_id\": \"3c000000-0000-4000-8000-000000000710\"}]}, \"input\": [{\"mode\": \"order\", \"search\": \"__t3c_small__\", \"boardScope\": \"all\", \"orderFilter\": \"all\", \"requestFilter\": \"all\"}, \"return\"], \"method\": \"getTextbookPurchaseHandoff\", \"actorId\": \"3c000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"lines\": [{\"id\": \"3c000000-0000-4000-8000-000000004200\", \"memo\": \"\", \"status\": \"paid\", \"sale_id\": \"3c000000-0000-4000-8000-000000006001\", \"class_id\": null, \"quantity\": 2, \"copy_scope\": \"student\", \"created_at\": \"2099-08-01T00:00:00+00:00\", \"student_id\": \"3c000000-0000-4000-8000-000000001001\", \"teacher_id\": null, \"unit_price\": 0, \"updated_at\": null, \"location_id\": \"3c000000-0000-4000-8000-000000000900\", \"textbook_id\": \"3c000000-0000-4000-8000-000000000004\", \"charge_month\": \"2099-08-25\", \"makeedu_memo\": null, \"teacher_name\": \"\", \"makeedu_paid_at\": null, \"exclusion_reason\": \"\", \"makeedu_item_name\": null, \"makeedu_synced_at\": null, \"makeedu_import_key\": null, \"makeedu_student_no\": null, \"makeedu_paid_amount\": 0, \"makeedu_card_company\": null, \"makeedu_charge_month\": null, \"makeedu_charge_amount\": 0, \"makeedu_unpaid_amount\": 0, \"makeedu_payment_method\": null, \"makeedu_payment_status\": null, \"makeedu_discount_amount\": 0, \"makeedu_saved_point_amount\": 0, \"makeedu_payment_method_detail\": null}], \"sales\": [{\"id\": \"3c000000-0000-4000-8000-000000006001\", \"memo\": \"\", \"status\": \"charged\", \"class_id\": \"3c000000-0000-4000-8000-000000000601\", \"sale_date\": \"2099-08-01\", \"created_at\": \"2099-08-01T00:00:00+00:00\", \"created_by\": null, \"updated_at\": null, \"charge_month\": \"2099-08\"}], \"classes\": [{\"id\": \"3c000000-0000-4000-8000-000000000601\", \"name\": \"작은반\", \"studentCount\": 3}], \"complete\": true, \"students\": [{\"id\": \"3c000000-0000-4000-8000-000000001001\", \"name\": \"합성 학생 1\", \"grade\": \"중2\"}], \"textbooks\": [{\"id\": \"3c000000-0000-4000-8000-000000000004\", \"name\": \"__t3c_small__\", \"price\": 10001, \"title\": \"__t3c_small__\", \"isbn13\": null, \"status\": \"active\", \"barcode\": null, \"subject\": \"science\", \"publisher\": \"__t3c__ 출판사\", \"list_price\": 0, \"sale_price\": 10001, \"publisher_id\": \"3c000000-0000-4000-8000-000000000710\", \"is_returnable\": false, \"default_supplier_id\": null}], \"sourceLineIds\": [\"3c000000-0000-4000-8000-000000004200\"], \"sourceLineCount\": 1}, \"input\": {\"search\": \"__t3c_small__\", \"status\": \"all\"}, \"method\": \"getTextbookBillingHandoff\", \"actorId\": \"3c000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"subject\": \"science\", \"complete\": true, \"suppliers\": [{\"id\": \"3c000000-0000-4000-8000-000000000720\", \"name\": \"__t3c__ 외부\", \"contact\": \"담당\"}, {\"id\": \"3c000000-0000-4000-8000-000000000721\", \"name\": \"팁스 서점\", \"contact\": \"담당\"}], \"textbooks\": [{\"id\": \"3c000000-0000-4000-8000-000000000004\", \"name\": \"__t3c_small__\", \"price\": 10001, \"title\": \"__t3c_small__\", \"isbn13\": null, \"status\": \"active\", \"barcode\": null, \"subject\": \"science\", \"publisher\": \"__t3c__ 출판사\", \"list_price\": 0, \"sale_price\": 10001, \"publisher_id\": \"3c000000-0000-4000-8000-000000000710\", \"is_returnable\": false, \"default_supplier_id\": null}], \"publishers\": [{\"id\": \"3c000000-0000-4000-8000-000000000710\", \"name\": \"__t3c__ 출판사\"}], \"stockMoves\": [{\"id\": \"3c000000-0000-4000-8000-000000002200\", \"memo\": \"\", \"amount\": -40000, \"moved_at\": \"2099-09-01T00:00:00+00:00\", \"quantity\": -2, \"move_type\": \"sale_issue\", \"copy_scope\": \"student\", \"created_at\": \"2026-08-31T18:22:22.68782+00:00\", \"created_by\": null, \"location_id\": \"3c000000-0000-4000-8000-000000000900\", \"textbook_id\": \"3c000000-0000-4000-8000-000000000004\", \"unit_amount\": 0, \"sale_line_id\": null, \"purchase_order_line_id\": null}], \"closingMonth\": \"2099-09\", \"sourceLineIds\": [\"3c000000-0000-4000-8000-000000002200\"], \"sourceLineCount\": 1, \"publisherSupplierLinks\": [{\"id\": \"3c000000-0000-4000-8000-000000000730\", \"priority\": 99, \"is_primary\": true, \"supplier_id\": \"3c000000-0000-4000-8000-000000000720\", \"publisher_id\": \"3c000000-0000-4000-8000-000000000710\"}, {\"id\": \"3c000000-0000-4000-8000-000000000731\", \"priority\": 0, \"is_primary\": false, \"supplier_id\": \"3c000000-0000-4000-8000-000000000721\", \"publisher_id\": \"3c000000-0000-4000-8000-000000000710\"}]}, \"input\": [\"2099-09\", \"science\"], \"method\": \"getTextbookClosingSaveContext\", \"actorId\": \"3c000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"subject\": \"english\", \"complete\": true, \"suppliers\": [{\"id\": \"3c000000-0000-4000-8000-000000000720\", \"name\": \"__t3c__ 외부\", \"contact\": \"담당\"}, {\"id\": \"3c000000-0000-4000-8000-000000000721\", \"name\": \"팁스 서점\", \"contact\": \"담당\"}], \"textbooks\": [{\"id\": \"3c000000-0000-4000-8000-000000000005\", \"name\": \"__t3c__ decimal\", \"price\": 100.1, \"title\": \"__t3c__ decimal\", \"isbn13\": null, \"status\": \"active\", \"barcode\": null, \"subject\": \"english\", \"publisher\": \"__t3c__ 출판사\", \"list_price\": 0, \"sale_price\": 100.1, \"publisher_id\": \"3c000000-0000-4000-8000-000000000710\", \"is_returnable\": false, \"default_supplier_id\": null}], \"publishers\": [{\"id\": \"3c000000-0000-4000-8000-000000000710\", \"name\": \"__t3c__ 출판사\"}], \"stockMoves\": [{\"id\": \"3c000000-0000-4000-8000-000000002305\", \"memo\": \"\", \"amount\": 10000000000000000, \"moved_at\": \"2097-05-03T00:00:00+00:00\", \"quantity\": 1, \"move_type\": \"stock_adjustment\", \"copy_scope\": \"student\", \"created_at\": \"2026-08-31T18:22:22.68782+00:00\", \"created_by\": null, \"location_id\": \"3c000000-0000-4000-8000-000000000900\", \"textbook_id\": \"3c000000-0000-4000-8000-000000000005\", \"unit_amount\": 0, \"sale_line_id\": null, \"purchase_order_line_id\": null}, {\"id\": \"3c000000-0000-4000-8000-000000002306\", \"memo\": \"\", \"amount\": -10000000000000000, \"moved_at\": \"2097-05-02T00:00:00+00:00\", \"quantity\": -1, \"move_type\": \"stock_adjustment\", \"copy_scope\": \"student\", \"created_at\": \"2026-08-31T18:22:22.68782+00:00\", \"created_by\": null, \"location_id\": \"3c000000-0000-4000-8000-000000000900\", \"textbook_id\": \"3c000000-0000-4000-8000-000000000005\", \"unit_amount\": 0, \"sale_line_id\": null, \"purchase_order_line_id\": null}, {\"id\": \"3c000000-0000-4000-8000-000000002304\", \"memo\": \"\", \"amount\": 0.25, \"moved_at\": \"2097-05-01T00:00:00+00:00\", \"quantity\": 1, \"move_type\": \"stock_adjustment\", \"copy_scope\": \"student\", \"created_at\": \"2026-08-31T18:22:22.68782+00:00\", \"created_by\": null, \"location_id\": \"3c000000-0000-4000-8000-000000000900\", \"textbook_id\": \"3c000000-0000-4000-8000-000000000005\", \"unit_amount\": 0, \"sale_line_id\": null, \"purchase_order_line_id\": null}], \"closingMonth\": \"2097-05\", \"sourceLineIds\": [\"3c000000-0000-4000-8000-000000002305\", \"3c000000-0000-4000-8000-000000002306\", \"3c000000-0000-4000-8000-000000002304\"], \"sourceLineCount\": 3, \"publisherSupplierLinks\": [{\"id\": \"3c000000-0000-4000-8000-000000000730\", \"priority\": 99, \"is_primary\": true, \"supplier_id\": \"3c000000-0000-4000-8000-000000000720\", \"publisher_id\": \"3c000000-0000-4000-8000-000000000710\"}, {\"id\": \"3c000000-0000-4000-8000-000000000731\", \"priority\": 0, \"is_primary\": false, \"supplier_id\": \"3c000000-0000-4000-8000-000000000721\", \"publisher_id\": \"3c000000-0000-4000-8000-000000000710\"}]}, \"input\": [\"2097-05\", \"english\"], \"method\": \"getTextbookClosingSaveContext\", \"actorId\": \"3c000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"closing\": {\"saleAmount\": 0, \"needsReview\": false, \"teamMargins\": [{\"team\": \"english\", \"saleAmount\": 0, \"marginAmount\": 0, \"saleQuantity\": 0, \"purchaseCostAmount\": 0}, {\"team\": \"math\", \"saleAmount\": 0, \"marginAmount\": 0, \"saleQuantity\": 0, \"purchaseCostAmount\": 0}, {\"team\": \"science\", \"saleAmount\": 0, \"marginAmount\": 0, \"saleQuantity\": 0, \"purchaseCostAmount\": 0}, {\"team\": \"other\", \"saleAmount\": 0, \"marginAmount\": 0, \"saleQuantity\": 0, \"purchaseCostAmount\": 0}], \"endingAmount\": 2.75, \"saleQuantity\": 0, \"openingAmount\": 2.5, \"endingQuantity\": 1, \"purchaseAmount\": 0, \"receivedAmount\": 0, \"openingQuantity\": 0, \"adjustmentAmount\": 0.25, \"purchaseQuantity\": 0, \"paymentDifference\": 0, \"adjustmentQuantity\": 1, \"settlementDifference\": 0, \"textbookMarginAmount\": 0, \"supplierPaymentAmount\": 0}, \"subject\": \"english\", \"closingMonth\": \"2097-05\", \"sourceLineCount\": 3}, \"input\": {\"subject\": \"english\", \"closingMonth\": \"2097-05\", \"openingAmount\": 2.5, \"openingQuantity\": 0}, \"method\": \"getTextbookClosingPreview\", \"actorId\": \"3c000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"rows\": [{\"at\": \"2097-04-01T00:00:00+00:00\", \"id\": \"3c000000-0000-4000-8000-000000002303\", \"amount\": 0, \"quantity\": -3, \"typeLabel\": \"출고\", \"locationName\": \"본관\", \"marginAmount\": 30.299999999999983, \"textbookTitle\": \"__t3c__ decimal\"}], \"complete\": true, \"sourceLineIds\": [\"3c000000-0000-4000-8000-000000002303\"], \"sourceLineCount\": 1}, \"input\": {\"search\": \"\", \"subject\": \"english\", \"closingMonth\": \"2097-04\"}, \"method\": \"getTextbookClosingMovementExport\", \"actorId\": \"3c000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"closing\": {\"saleAmount\": 0, \"needsReview\": true, \"teamMargins\": [{\"team\": \"english\", \"saleAmount\": 300.29999999999995, \"marginAmount\": 30.299999999999955, \"saleQuantity\": 3, \"purchaseCostAmount\": 270}, {\"team\": \"math\", \"saleAmount\": 0, \"marginAmount\": 0, \"saleQuantity\": 0, \"purchaseCostAmount\": 0}, {\"team\": \"science\", \"saleAmount\": 0, \"marginAmount\": 0, \"saleQuantity\": 0, \"purchaseCostAmount\": 0}, {\"team\": \"other\", \"saleAmount\": 0, \"marginAmount\": 0, \"saleQuantity\": 0, \"purchaseCostAmount\": 0}], \"endingAmount\": 0, \"saleQuantity\": 3, \"openingAmount\": 0, \"endingQuantity\": -3, \"purchaseAmount\": 0, \"receivedAmount\": 0, \"openingQuantity\": 0, \"adjustmentAmount\": 0, \"purchaseQuantity\": 0, \"paymentDifference\": 0, \"adjustmentQuantity\": 0, \"settlementDifference\": 30.299999999999955, \"textbookMarginAmount\": 30.299999999999955, \"supplierPaymentAmount\": 0}, \"subject\": \"english\", \"closingMonth\": \"2097-04\", \"sourceLineCount\": 1}, \"input\": {\"subject\": \"english\", \"closingMonth\": \"2097-04\", \"openingAmount\": 0, \"openingQuantity\": 0}, \"method\": \"getTextbookClosingPreview\", \"actorId\": \"3c000000-0000-4000-8000-000000000901\"}",
  "{\"data\": {\"rows\": [{\"at\": \"2099-09-01T00:00:00+00:00\", \"id\": \"3c000000-0000-4000-8000-000000002200\", \"amount\": -40000, \"quantity\": -2, \"typeLabel\": \"출고\", \"locationName\": \"본관\", \"marginAmount\": 2000, \"textbookTitle\": \"__t3c_small__\"}], \"complete\": true, \"sourceLineIds\": [\"3c000000-0000-4000-8000-000000002200\"], \"sourceLineCount\": 1}, \"input\": {\"search\": \"\", \"subject\": \"science\", \"closingMonth\": \"2099-09\"}, \"method\": \"getTextbookClosingMovementExport\", \"actorId\": \"3c000000-0000-4000-8000-000000000901\"}",
];
const finalTask5b2Evidence = Object.freeze({
  finalSqlLogSha256: '6d04858c363db8090a24037eb8c836dac07473b0ca5471b191577a12d6115dc8',
  wirePayloadSha256: 'a097a5252eca36e08b15407ce05af90ec195f00ad5bd0847d30fc99fb6988328',
});
const finalTask5b2WirePayload = "{\"data\": {\"class\": {\"id\": \"5b200000-0000-4000-8000-000000000600\", \"name\": \"__t5b2_class__\", \"student_ids\": [\"5b200000-0000-4000-8000-000000001001\", \"5b200000-0000-4000-8000-000000001002\", \"5b200000-0000-4000-8000-000000001003\", \"5b200000-0000-4000-8000-000000001004\", \"5b200000-0000-4000-8000-000000001005\", \"5b200000-0000-4000-8000-000000001006\", \"5b200000-0000-4000-8000-000000001007\", \"5b200000-0000-4000-8000-000000001008\", \"5b200000-0000-4000-8000-000000001009\", \"5b200000-0000-4000-8000-000000001010\", \"5b200000-0000-4000-8000-000000001011\", \"5b200000-0000-4000-8000-000000001012\", \"5b200000-0000-4000-8000-000000001013\", \"5b200000-0000-4000-8000-000000001014\", \"5b200000-0000-4000-8000-000000001015\", \"5b200000-0000-4000-8000-000000001016\", \"5b200000-0000-4000-8000-000000001017\", \"5b200000-0000-4000-8000-000000001018\", \"5b200000-0000-4000-8000-000000001019\", \"5b200000-0000-4000-8000-000000001020\", \"5b200000-0000-4000-8000-000000001021\", \"5b200000-0000-4000-8000-000000001022\", \"5b200000-0000-4000-8000-000000001001\", \"legacy-school-id\"]}, \"input\": {\"classId\": \"5b200000-0000-4000-8000-000000000600\", \"locationId\": \"5b200000-0000-4000-8000-000000000800\", \"textbookId\": \"5b200000-0000-4000-8000-000000000700\", \"chargeMonth\": \"2099-08\"}, \"complete\": true, \"location\": {\"id\": \"5b200000-0000-4000-8000-000000000800\", \"code\": \"__t5b2_main__\", \"name\": \"Task5b2 본관\"}, \"students\": [{\"id\": \"5b200000-0000-4000-8000-000000001001\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": null}, {\"id\": \"5b200000-0000-4000-8000-000000001002\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001003\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001004\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001005\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001006\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001007\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001008\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001009\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001010\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001011\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001012\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001013\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001014\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001015\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001016\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001017\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001018\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001019\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001020\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001021\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_default\"}, {\"id\": \"5b200000-0000-4000-8000-000000001022\", \"name\": \"__t5b2_same_name\", \"grade\": \"중2\", \"school\": \"__t5b2_school_offpage\"}], \"textbook\": {\"id\": \"5b200000-0000-4000-8000-000000000700\", \"name\": \"__t5b2_book__\", \"price\": 10001, \"title\": \"__t5b2_book__\", \"isbn13\": null, \"status\": \"active\", \"barcode\": null, \"subject\": \"english\", \"publisher\": \"__t5b2_publisher__\", \"list_price\": 0, \"sale_price\": 10001, \"publisher_id\": null, \"is_returnable\": false, \"default_supplier_id\": null}, \"inventory\": {\"stockValue\": -20002, \"textbookId\": \"5b200000-0000-4000-8000-000000000700\", \"totalQuantity\": -2, \"currentQuantity\": -2, \"studentQuantity\": -2, \"teacherQuantity\": 0, \"locationQuantities\": {\"5b200000-0000-4000-8000-000000000800\": -2}, \"studentLocationQuantities\": {\"5b200000-0000-4000-8000-000000000800\": -2}, \"teacherLocationQuantities\": {\"5b200000-0000-4000-8000-000000000800\": 0}}, \"duplicateCount\": 1, \"duplicateLines\": [{\"id\": \"5b200000-0000-4000-8000-000000004000\", \"memo\": \"\", \"status\": \"paid\", \"sale_id\": \"5b200000-0000-4000-8000-000000003000\", \"class_id\": null, \"quantity\": 1, \"copy_scope\": \"student\", \"created_at\": \"2099-08-01T00:00:00+00:00\", \"student_id\": \"5b200000-0000-4000-8000-000000001022\", \"teacher_id\": null, \"unit_price\": 10001, \"updated_at\": null, \"location_id\": \"5b200000-0000-4000-8000-000000000800\", \"textbook_id\": \"5b200000-0000-4000-8000-000000000700\", \"charge_month\": \"2099-08-25\", \"makeedu_memo\": null, \"teacher_name\": \"\", \"makeedu_paid_at\": null, \"exclusion_reason\": \"\", \"makeedu_item_name\": null, \"makeedu_synced_at\": null, \"makeedu_import_key\": null, \"makeedu_student_no\": null, \"makeedu_paid_amount\": 0, \"makeedu_card_company\": null, \"makeedu_charge_month\": null, \"makeedu_charge_amount\": 0, \"makeedu_unpaid_amount\": 0, \"makeedu_payment_method\": null, \"makeedu_payment_status\": null, \"makeedu_discount_amount\": 0, \"makeedu_saved_point_amount\": 0, \"makeedu_payment_method_detail\": null}], \"duplicateSales\": [{\"id\": \"5b200000-0000-4000-8000-000000003000\", \"memo\": \"\", \"status\": \"charged\", \"class_id\": \"5b200000-0000-4000-8000-000000000600\", \"sale_date\": \"2099-08-01\", \"created_at\": \"2099-08-01T00:00:00+00:00\", \"created_by\": null, \"updated_at\": null, \"charge_month\": \"2099-08\"}], \"duplicateLineIds\": [\"5b200000-0000-4000-8000-000000004000\"], \"missingStudentIds\": [\"legacy-school-id\"], \"duplicateLineCount\": 1, \"enrolledStudentIds\": [\"5b200000-0000-4000-8000-000000001001\", \"5b200000-0000-4000-8000-000000001002\", \"5b200000-0000-4000-8000-000000001003\", \"5b200000-0000-4000-8000-000000001004\", \"5b200000-0000-4000-8000-000000001005\", \"5b200000-0000-4000-8000-000000001006\", \"5b200000-0000-4000-8000-000000001007\", \"5b200000-0000-4000-8000-000000001008\", \"5b200000-0000-4000-8000-000000001009\", \"5b200000-0000-4000-8000-000000001010\", \"5b200000-0000-4000-8000-000000001011\", \"5b200000-0000-4000-8000-000000001012\", \"5b200000-0000-4000-8000-000000001013\", \"5b200000-0000-4000-8000-000000001014\", \"5b200000-0000-4000-8000-000000001015\", \"5b200000-0000-4000-8000-000000001016\", \"5b200000-0000-4000-8000-000000001017\", \"5b200000-0000-4000-8000-000000001018\", \"5b200000-0000-4000-8000-000000001019\", \"5b200000-0000-4000-8000-000000001020\", \"5b200000-0000-4000-8000-000000001021\", \"5b200000-0000-4000-8000-000000001022\", \"5b200000-0000-4000-8000-000000001001\", \"legacy-school-id\"], \"duplicateStudentIds\": [\"5b200000-0000-4000-8000-000000001022\"]}, \"input\": {\"classId\": \"5b200000-0000-4000-8000-000000000600\", \"locationId\": \"5b200000-0000-4000-8000-000000000800\", \"textbookId\": \"5b200000-0000-4000-8000-000000000700\", \"chargeMonth\": \"2099-08\"}, \"method\": \"getClassTextbookSaleContext\", \"actorId\": \"5b200000-0000-4000-8000-000000000901\"}";
const contextId = (n) => `3c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const contextFilters = { mode: 'order', search: '', boardScope: 'all', requestFilter: 'all', orderFilter: 'all' };
const emptyReferences = () => ({ textbooks: [], publishers: [], suppliers: [], publisherSupplierLinks: [] });
const emptyClosing = () => ({ closingMonth: '2026-08', subject: 'all', sourceLineCount: 0, sourceLineIds: [], stockMoves: [], ...emptyReferences(), complete: true });
const emptyPurchase = () => ({ kind: 'order', sourceLineCount: 0, sourceLineIds: [], resolvedTextbookIds: [], lines: [], ...emptyReferences(), locations: [], classes: [], complete: true });
const emptyBilling = () => ({ sourceLineCount: 0, sourceLineIds: [], lines: [], sales: [], textbooks: [], classes: [], students: [], complete: true });
const classInput = { classId: contextId(1), textbookId: contextId(2), locationId: contextId(3), chargeMonth: '2026-08' };
const contextBook = () => ({ id: contextId(2), title: '교재', name: '교재', status: 'active', subject: 'english', publisher: null, publisher_id: null, default_supplier_id: null, price: 10001, sale_price: 10001, list_price: 0, isbn13: null, barcode: null, is_returnable: false });
const classPayload = () => ({ input: classInput, class: { id: contextId(1), name: '중2반', student_ids: [contextId(4), contextId(4), 'legacy'] }, enrolledStudentIds: [contextId(4), contextId(4), 'legacy'],
  students: [{ id: contextId(4), name: '학생', grade: '중2', school: '__t5b2_school_primary' }], missingStudentIds: ['legacy'], textbook: contextBook(), location: { id: contextId(3), code: 'main', name: '본관' },
  inventory: { textbookId: contextId(2), currentQuantity: 123, locationQuantities: { [contextId(3)]: 123 }, studentLocationQuantities: { [contextId(3)]: 120 }, teacherLocationQuantities: { [contextId(3)]: 3 }, totalQuantity: 123, studentQuantity: 120, teacherQuantity: 3, stockValue: 111.5 },
  duplicateLines: [], duplicateSales: [], duplicateLineIds: [], duplicateLineCount: 0, duplicateStudentIds: [], duplicateCount: 0, complete: true });
const billingStudents = () => classPayload().students.map(({ id, name, grade }) => ({ id, name, grade }));
const completePurchaseLine = (n, scope = 'student') => ({ id: contextId(n), purchase_order_id: contextId(500), textbook_id: contextId(2), requested_textbook_title: '', class_id: contextId(1), location_id: contextId(3), requested_quantity: 1, ordered_quantity: 1, received_quantity: 1, teacher_ordered_quantity: 0, teacher_received_quantity: 0, unit_cost: 0, copy_scope: scope, memo: '', created_at: null, updated_at: null, status: 'partially_received',
  order: { id: contextId(500), supplier_id: null, requested_by: '합성', requested_date: '2026-08-01', order_date: '2026-08-01', expected_date: null, ordered_at: null, received_at: null, status: 'partially_received', statement_number: '', memo: '', created_by: null, created_at: null, updated_at: null } });
const completeSale = () => ({ id: contextId(600), class_id: contextId(1), charge_month: '2026-08', sale_date: '2026-08-01', status: 'charged', memo: '', created_by: null, created_at: null, updated_at: null });
// Full captured physical sale-line schema, not repaired redacted diagnostics.
const rawSaleMetadata = () => ({ makeedu_card_company: null, makeedu_charge_amount: 0, makeedu_charge_month: null, makeedu_discount_amount: 0, makeedu_import_key: null,
  makeedu_item_name: null, makeedu_memo: null, makeedu_paid_amount: 0, makeedu_paid_at: null, makeedu_payment_method: null, makeedu_payment_method_detail: null,
  makeedu_payment_status: null, makeedu_saved_point_amount: 0, makeedu_student_no: null, makeedu_synced_at: null, makeedu_unpaid_amount: 0 });
const completeSaleLine = (n) => ({ ...rawSaleMetadata(), id: contextId(n), sale_id: contextId(600), student_id: contextId(4), class_id: contextId(1), textbook_id: contextId(2), charge_month: '2026-08-31', quantity: 2, unit_price: 0, location_id: contextId(3), status: 'paid', exclusion_reason: '', memo: '', created_at: null, updated_at: null, copy_scope: 'student', teacher_id: null, teacher_name: '' });
const rawClosingMove = (n, patch = {}) => ({ id: contextId(n), textbook_id: contextId(2), location_id: contextId(3), purchase_order_line_id: null, sale_line_id: null, move_type: 'sale_issue', quantity: -1, unit_amount: 10001, amount: 0, moved_at: '2026-08-31T23:30:00+00:00', memo: '', created_by: null, created_at: null, copy_scope: 'student', ...patch });
test('complete113-move save context feeds original ledger and unchanged explicit save memo/cash semantics', async () => {
  const api = await import(contextUrl); const legacy = await import(new URL('textbook-service.ts', feature));
  const data = { ...emptyClosing(), sourceLineCount: 113, stockMoves: Array.from({ length: 113 }, (_, i) => rawClosingMove(7000 + i)), textbooks: [contextBook()] };
  data.sourceLineIds = data.stockMoves.map((move) => move.id);
  const context = await api.getTextbookClosingSaveContext('2026-08', 'all', { client: contextWire(data).client });
  const writes = []; const client = { from(table) { return { upsert(payload, options) { writes.push({ table, payload, options }); return { select() { return { single() { return Promise.resolve({ data: payload, error: null }); } }; } }; } }; } };
  const result = await legacy.upsertMonthlyClosing({ closingMonth: '2026-08', subject: 'all', openingQuantity: 200, openingAmount: 10, receivedAmount: 40, supplierPaymentAmount: 3, memo: ' 확인 ', lock: true }, context, client);
  assert.equal(result.closing.saleQuantity, 113); assert.equal(result.closing.saleAmount, 1130113); assert.equal(result.closing.textbookMarginAmount, 113000);
  assert.equal(result.closing.endingQuantity, 87); assert.equal(result.closing.paymentDifference, 37); assert.equal(result.closing.settlementDifference, 113037);
  assert.equal(writes.length, 1); assert.equal(writes[0].table, 'textbook_monthly_closings'); assert.equal(writes[0].payload.memo, '확인'); assert.equal(writes[0].payload.status, 'locked');
  await assert.rejects(() => legacy.upsertMonthlyClosing({ closingMonth: '2026-08', subject: 'all', openingQuantity: 0, memo: '' }, context, client));
  assert.equal(writes.length, 1, 'original needsReview memo guard prevents write');
  for (const patch of [{ stockMoves: data.stockMoves.slice(0, 100) }, { textbooks: [] }, { sourceLineCount: 100 }, { stockMoves: [{ ...data.stockMoves[0], amount: '0' }, ...data.stockMoves.slice(1)] }]) {
    await assert.rejects(() => api.getTextbookClosingSaveContext('2026-08', 'all', { client: contextWire({ ...data, ...patch }).client }), /response_invalid/);
  }
  const boundary = { ...emptyClosing(), sourceLineCount: 1, sourceLineIds: [contextId(1)], stockMoves: [rawClosingMove(1, { moved_at: '2026-09-01T08:30:00+09:00' })], textbooks: [contextBook()] };
  await assert.rejects(() => api.getTextbookClosingSaveContext('2026-08', 'all', { client: contextWire(boundary).client }), /response_invalid/);
});
test('complete contexts execute all real handoff builders across113 raw lines, retaining source count independent of grouping', async () => {
  const api = await import(contextUrl);
  const purchase = { ...emptyPurchase(), lines: Array.from({ length: 113 }, (_, i) => completePurchaseLine(2000 + i, i % 2 ? 'teacher' : 'student')),
    textbooks: [contextBook()], classes: [{ id: contextId(1), name: '중2반', studentCount: 1 }], locations: [classPayload().location] };
  purchase.sourceLineIds = purchase.lines.map((line) => line.id); purchase.resolvedTextbookIds = purchase.lines.map(() => contextId(2)); purchase.sourceLineCount = 113;
  for (const kind of ['order', 'return']) {
    const value = { ...purchase, kind }; const result = await api.getTextbookPurchaseHandoff(contextFilters, kind, { client: contextWire(value).client });
    assert.equal(result.sourceLineCount, 113); assert.equal(result.groups.length, 1); assert.equal(result.groups[0].lines.length, 1);
    assert.equal(result.groups[0].totalQuantity, 113); assert.equal(result.groups[0].totalAmount, 513057);
    assert.equal(result.groups[0].lines[0].quantityLabel, '학생용 57권 · 교사용 56권');
  }
  for (const patch of [{ textbooks: [] }, { classes: [] }, { locations: [] }, { sourceLineCount: 10 }, { resolvedTextbookIds: [] }, { lines: [...purchase.lines.slice(0, -1), purchase.lines[0]] }]) {
    await assert.rejects(() => api.getTextbookPurchaseHandoff(contextFilters, 'order', { client: contextWire({ ...purchase, ...patch }).client }), /response_invalid/);
  }
  const billing = { ...emptyBilling(), sourceLineCount: 113, lines: Array.from({ length: 113 }, (_, i) => completeSaleLine(3000 + i)), sales: [completeSale()], textbooks: [contextBook()], classes: purchase.classes, students: billingStudents() };
  billing.sourceLineIds = billing.lines.map((line) => line.id);
  const result = await api.getTextbookBillingHandoff({ search: '', status: 'all' }, { client: contextWire(billing).client });
  assert.equal(result.sourceLineCount, 113); assert.equal(result.groups[0].lines.length, 113); assert.equal(result.groups[0].totalQuantity, 226); assert.equal(result.groups[0].totalAmount, 2260226);
  assert.equal(result.groups[0].lines[112].id, contextId(3112)); assert.equal(result.groups[0].lines[112].detail, '중2 · 중2반');
  for (const patch of [{ sales: [] }, { students: [] }, { sourceLineCount: 1 }, { lines: [{ ...completeSaleLine(3000), copy_scope: 'teacher' }], sourceLineIds: [contextId(3000)], sourceLineCount: 1 }]) {
    await assert.rejects(() => api.getTextbookBillingHandoff({ search: '', status: 'all' }, { client: contextWire({ ...billing, ...patch }).client }), /response_invalid/);
  }
});
test('complete class duplicate context preserves distinct student count and null-student raw-line fallback', async () => {
  const api = await import(contextUrl);
  for (const absent of [false, true]) {
    const data = classPayload(); data.duplicateLines = [completeSaleLine(9000), completeSaleLine(9001)].map((line) => ({ ...line, student_id: absent ? null : contextId(4) }));
    data.duplicateSales = [completeSale()]; data.duplicateLineIds = data.duplicateLines.map((line) => line.id); data.duplicateLineCount = 2; data.duplicateStudentIds = absent ? [] : [contextId(4)]; data.duplicateCount = absent ? 2 : 1;
    assert.equal((await api.getClassTextbookSaleContext(classInput, { client: contextWire(data).client })).duplicateCount, absent ? 2 : 1);
    for (const linePatch of [{ copy_scope: 'teacher' }, { status: 'excluded' }, { textbook_id: contextId(5) }, { class_id: contextId(6) }, { charge_month: '2026-09' }]) {
      await assert.rejects(() => api.getClassTextbookSaleContext(classInput, { client: contextWire({ ...data, duplicateLines: [{ ...data.duplicateLines[0], ...linePatch }, data.duplicateLines[1]] }).client }), /response_invalid/);
    }
  }
});
test('complete raw sale-line schema validates imported nullable fields without changing old selected projections', async () => {
  const api = await import(contextUrl);
  const data = { ...emptyBilling(), sourceLineCount: 1, sourceLineIds: [contextId(3000)], lines: [completeSaleLine(3000)], sales: [completeSale()], textbooks: [contextBook()], classes: [{ id: contextId(1), name: '중2반', studentCount: 1 }], students: billingStudents() };
  assert.equal((await api.getTextbookBillingHandoff({ search: '', status: 'all' }, { client: contextWire(data).client })).sourceLineCount, 1);
  for (const patch of [{ makeedu_paid_amount: '0' }, { makeedu_import_key: 4 }, { makeedu_synced_at: 'bad-date' }, { makeedu_paid_at: '2026-02-31' }]) {
    await assert.rejects(() => api.getTextbookBillingHandoff({ search: '', status: 'all' }, { client: contextWire({ ...data, lines: [{ ...data.lines[0], ...patch }] }).client }), /response_invalid/);
  }
  const missing = { ...data.lines[0] }; delete missing.makeedu_import_key;
  await assert.rejects(() => api.getTextbookBillingHandoff({ search: '', status: 'all' }, { client: contextWire({ ...data, lines: [missing] }).client }), /response_invalid/);
});
test('class context retains repeated normalized roster and missing-record identity fallback with full selected balance', async () => {
  assert.ok(existsSync(contextUrl), 'complete purpose service must exist'); const api = await import(contextUrl);
  assert.equal(typeof api.getClassTextbookSaleContext, 'function'); const t = contextWire(classPayload());
  assert.deepEqual(await api.getClassTextbookSaleContext(classInput, { client: t.client }), classPayload());
  assert.deepEqual(t.calls[0].args, { p_input: classInput }); assert.equal(t.calls[0].name, 'get_class_textbook_sale_context_v1');
  for (const patch of [{ enrolledStudentIds: [contextId(4), 'legacy'] }, { missingStudentIds: [] }, { students: [] }, { duplicateCount: 1 }, { complete: false }, { textbook: null }, { inventory: { ...classPayload().inventory, currentQuantity: 1 } }]) {
    await assert.rejects(() => api.getClassTextbookSaleContext(classInput, { client: contextWire({ ...classPayload(), ...patch }).client }), /response_invalid/);
  }
});
test('class context requires exact nullable school while billing retains its three-field student contract', async () => {
  const api = await import(contextUrl);
  const withSchool = classPayload();
  assert.deepEqual((await api.getClassTextbookSaleContext(classInput, { client: contextWire(withSchool).client })).students, withSchool.students);
  const withNullSchool = classPayload(); withNullSchool.students[0].school = null;
  assert.equal((await api.getClassTextbookSaleContext(classInput, { client: contextWire(withNullSchool).client })).students[0].school, null);
  const withoutSchool = classPayload(); delete withoutSchool.students[0].school;
  await assert.rejects(() => api.getClassTextbookSaleContext(classInput, { client: contextWire(withoutSchool).client }), /response_invalid/);
  const withAlias = classPayload(); withAlias.students[0].school_name = withAlias.students[0].school;
  await assert.rejects(() => api.getClassTextbookSaleContext(classInput, { client: contextWire(withAlias).client }), /response_invalid/);

  const billing = { ...emptyBilling(), sourceLineCount: 1, sourceLineIds: [contextId(3000)], lines: [completeSaleLine(3000)], sales: [completeSale()],
    textbooks: [contextBook()], classes: [{ id: contextId(1), name: '중2반', studentCount: 1 }], students: billingStudents() };
  assert.equal((await api.getTextbookBillingHandoff({ search: '', status: 'all' }, { client: contextWire(billing).client })).sourceLineCount, 1);
  await assert.rejects(() => api.getTextbookBillingHandoff({ search: '', status: 'all' }, { client: contextWire({ ...billing, students: classPayload().students }).client }), /response_invalid/);
});
test('class context preserves over20 roster school search records without changing roster, duplicate, balance or draft meaning', async () => {
  const api = await import(contextUrl); const ledger = await import(new URL('textbook-ledger.js', feature));
  const students = Array.from({ length: 22 }, (_, index) => ({
    id: contextId(100 + index), name: '동명 학생', grade: '중2', school: index === 21 ? '__t5b2_school_offpage' : index === 0 ? null : '__t5b2_school_default',
  }));
  const enrolledStudentIds = [...students.map((student) => student.id), students[0].id, 'legacy-school-id'];
  const offpageStudent = students.at(-1);
  const duplicateLine = { ...completeSaleLine(9000), student_id: offpageStudent.id };
  const data = { ...classPayload(), class: { ...classPayload().class, student_ids: enrolledStudentIds }, enrolledStudentIds, students, missingStudentIds: ['legacy-school-id'],
    inventory: { ...classPayload().inventory, currentQuantity: -2, locationQuantities: { [contextId(3)]: -2 }, studentLocationQuantities: { [contextId(3)]: -2 },
      teacherLocationQuantities: { [contextId(3)]: 0 }, totalQuantity: -2, studentQuantity: -2, teacherQuantity: 0, stockValue: -20002 },
    duplicateLines: [duplicateLine], duplicateSales: [completeSale()], duplicateLineIds: [duplicateLine.id], duplicateLineCount: 1,
    duplicateStudentIds: [offpageStudent.id], duplicateCount: 1 };
  const context = await api.getClassTextbookSaleContext(classInput, { client: contextWire(data).client });
  assert.equal(context.students.length, 22); assert.equal(context.students[0].school, null);
  assert.equal(context.students[21].school, '__t5b2_school_offpage'); assert.equal(context.students[21].name, context.students[0].name); assert.equal(context.students[21].grade, context.students[0].grade);
  assert.deepEqual(context.enrolledStudentIds, enrolledStudentIds); assert.deepEqual(context.missingStudentIds, ['legacy-school-id']);
  assert.deepEqual(context.duplicateLineIds, [duplicateLine.id]); assert.equal(context.duplicateCount, 1); assert.equal(context.inventory.currentQuantity, -2);
  const draft = ledger.buildTextbookSaleDraft({ classRecord: context.class, students: context.students, textbook: context.textbook,
    chargeMonth: context.input.chargeMonth, locationId: context.location.id, availableQuantity: context.inventory.currentQuantity });
  assert.deepEqual(draft.lines.map((line) => line.student_id), enrolledStudentIds);
  assert.equal(draft.totalQuantity, 24); assert.equal(draft.totalAmount, 240024); assert.equal(draft.stockShortage, 26); assert.equal(draft.hasStockShortage, true);
});
test('selected class snapshot feeds unchanged legacy class sale draft through an explicit adapter', async () => {
  const api = await import(contextUrl); const legacy = await import(new URL('textbook-service.ts', feature));
  const context = await api.getClassTextbookSaleContext(classInput, { client: contextWire(classPayload()).client });
  const writes = [];
  const client = { from(table) { return { insert(payload) { writes.push({ table, payload }); return { select() {
    return table === 'textbook_sales' ? { single: async () => ({ data: { id: contextId(8000), ...payload }, error: null }) } : Promise.resolve({ data: payload, error: null });
  } }; } }; } };
  const selected = { classes: [context.class], students: context.students, textbooks: [context.textbook], inventory: [{ ...context.inventory, id: context.inventory.textbookId }], defaultLocationId: context.location.id };
  const result = await legacy.createClassTextbookSale(classInput, selected, client);
  assert.deepEqual(result.draft.lines.map((line) => line.student_id), [contextId(4), contextId(4), 'legacy']);
  assert.equal(result.draft.totalQuantity, 3); assert.equal(result.draft.totalAmount, 30003);
  assert.equal(result.draft.availableQuantity, 123); assert.equal(result.draft.hasStockShortage, false);
  assert.deepEqual(writes.map((write) => write.table), ['textbook_sales', 'textbook_sale_lines']);
  assert.equal(writes[1].payload.length, 3);
});
test('complete roster preserves original listIds stringification beyond UUID-shaped elements', async () => {
  const { listIds } = await import(new URL('textbook-ledger.js', feature));
  const api = await import(contextUrl);
  for (const [raw, expected] of [
    [[0, false, null, '', 1e-7, [1e-7, null, true], {}, ' legacy '], ['1e-7', '1e-7,,true', '[object Object]', 'legacy']],
    ['[" legacy ","legacy",1e-7]', ['legacy', 'legacy', '1e-7']],
    [' legacy, legacy , ,other', ['legacy', 'legacy', 'other']],
  ]) {
    assert.deepEqual(listIds(raw), expected);
    const data = { ...classPayload(), class: { ...classPayload().class, student_ids: raw }, enrolledStudentIds: expected, missingStudentIds: expected, students: [] };
    assert.deepEqual((await api.getClassTextbookSaleContext(classInput, { client: contextWire(data).client })).enrolledStudentIds, expected);
  }
});
function contextWire(data, error = null, onCall) {
  const calls = [];
  return { calls, client: { from() { throw new Error('no bundle fallback'); }, rpc(name, args) {
    const call = { name, args }; calls.push(call);
    return { abortSignal(signal) { call.signal = signal; return this; }, retry(retry) { call.retry = retry; onCall?.(call); return Promise.resolve({ data, error }); } };
  } } };
}
test('final closing SQL provenance binds all14 untouched wires and exactly nine authenticated methods', () => {
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const fileName = '20260831170552_textbook_closing_work_context_reads.sql';
  const sqlHash = '85d36756ec325de86fd8edea2bd2b5b693a4cb9b9fda8b07e9bafb0ce56facdd';
  assert.equal(hash(readFileSync(new URL(`../supabase/migrations/${fileName}`, import.meta.url))), sqlHash);
  assert.equal(hash(readFileSync(new URL('../supabase/tests/textbook_closing_work_context_reads_test.sql', import.meta.url))), 'f929210e61f66fa34f6afadbdf69c790dcc4090e9636becdb80250463707ab78');
  const manifest = JSON.parse(readFileSync(new URL('../supabase/test-baselines/dashboard-free-tier-v1.manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.orderedNewMigrations.find((entry) => entry.fileName === fileName), { fileName, status: 'final', sha256: sqlHash });
  const task5b2FileName = '20260831234634_textbook_class_sale_roster_school.sql';
  const task5b2SqlHash = '458b951d33356be1f8544c1d1b7c80e4023031dedb78ce7029bef9ea10aa301b';
  assert.equal(hash(readFileSync(new URL(`../supabase/migrations/${task5b2FileName}`, import.meta.url))), task5b2SqlHash);
  assert.equal(hash(readFileSync(new URL('../supabase/tests/textbook_class_sale_roster_context_test.sql', import.meta.url))), '754d4358d17cffc2c2ae81c40857d7eda79cf39935824a57411cb4c97d39c4f2');
  // Later reviewed settings migrations are append-only additions to this same final manifest.
  assert.equal(hash(readFileSync(new URL('../supabase/test-baselines/dashboard-free-tier-v1.manifest.json', import.meta.url))), '468fb430635df8e17f915374bdf6e12eb07b75902ea06e01572787566484600b');
  assert.deepEqual(manifest.orderedNewMigrations.filter((entry) => entry.fileName === task5b2FileName), [{ fileName: task5b2FileName, status: 'final', sha256: task5b2SqlHash }]);
  assert.equal(hash(finalTask5b2WirePayload), finalTask5b2Evidence.wirePayloadSha256);
  assert.equal(finalTask5b2Evidence.finalSqlLogSha256, '6d04858c363db8090a24037eb8c836dac07473b0ca5471b191577a12d6115dc8');
  const finalTask5b2Capture = JSON.parse(finalTask5b2WirePayload);
  assert.deepEqual(Object.keys(finalTask5b2Capture).sort(), ['actorId', 'data', 'input', 'method']);
  assert.equal(finalTask5b2Capture.method, 'getClassTextbookSaleContext');
  assert.equal(finalTask5b2Capture.actorId, '5b200000-0000-4000-8000-000000000901');
  assert.ok(('# TASK5B2_WIRE ' + finalTask5b2WirePayload).length <= 8000);
  assert.ok(finalTask5b2Capture.data.students.every((student) => JSON.stringify(Object.keys(student).sort()) === JSON.stringify(['grade', 'id', 'name', 'school'])));
  assert.equal(finalClosingWirePayloads.length, 14);
  assert.equal(hash(finalClosingWirePayloads.join('\n')), '1eaf5fa1d97443b64bdedcd283b11b2c759b1fa893716ec44947660fafae9410');
  for (const payload of finalClosingWirePayloads) {
    assert.ok(('# TASK3C_WIRE ' + payload).length <= 8000);
    assert.equal(payload.includes('[REDACTED]') || payload.includes('[redacted]'), false);
    const capture = JSON.parse(payload);
    assert.deepEqual(Object.keys(capture).sort(), ['actorId', 'data', 'input', 'method']);
    assert.equal(capture.actorId, contextId(901));
  }
  assert.deepEqual([...new Set(finalClosingWirePayloads.map((payload) => JSON.parse(payload).method))].sort(), [
    'listTextbookClosingPage', 'listTextbookClosingMovementPage', 'getTextbookClosingDetail', 'getTextbookClosingPreview',
    'getClassTextbookSaleContext', 'getTextbookPurchaseHandoff', 'getTextbookBillingHandoff', 'getTextbookClosingSaveContext', 'getTextbookClosingMovementExport',
  ].sort());
  const supersededClassCaptures = finalClosingWirePayloads.map((payload) => JSON.parse(payload)).filter((capture) => capture.method === 'getClassTextbookSaleContext');
  assert.equal(supersededClassCaptures.length, 1);
  assert.deepEqual(Object.keys(supersededClassCaptures[0].data.students[0]).sort(), ['grade', 'id', 'name']);
  assert.equal('school' in supersededClassCaptures[0].data.students[0], false, 'the untouched Task3c class capture is explicitly superseded by Task5b2');
});
test('old13 non-class final SQL wires replay, old class remains superseded, and final Task5b2 class wire feeds draft parity', async () => {
  const api = { ...await import(contextUrl), ...await import(new URL('textbook-read-service.ts', feature)) };
  const handoff = await import(handoffUrl); const ledger = await import(new URL('textbook-ledger.js', feature)); const original = await closingOracle();
  const results = [];
  for (const payload of finalClosingWirePayloads) {
    const capture = JSON.parse(payload); const { method, input, data } = capture;
    if (method === 'getClassTextbookSaleContext') {
      assert.deepEqual(Object.keys(data.students[0]).sort(), ['grade', 'id', 'name']);
      assert.equal('school' in data.students[0], false, 'Task3c class wire cannot pass the Task5b2 current contract');
      continue;
    }
    const args = Array.isArray(input) ? input : [input]; const wire = contextWire(data);
    const result = await api[method](...args, { client: wire.client }); results.push({ ...capture, result });
    assert.equal(wire.calls.length, 1); assert.equal(wire.calls[0].retry, false); assert.ok(wire.calls[0].signal instanceof AbortSignal);
    const rpc = { listTextbookClosingPage: 'list_textbook_closing_page_v1', listTextbookClosingMovementPage: 'list_textbook_closing_movement_page_v1',
      getTextbookClosingDetail: 'get_textbook_closing_detail_v1', getTextbookClosingPreview: 'get_textbook_closing_preview_v1', getClassTextbookSaleContext: 'get_class_textbook_sale_context_v1',
      getTextbookPurchaseHandoff: 'get_textbook_purchase_handoff_context_v1', getTextbookBillingHandoff: 'get_textbook_billing_handoff_context_v1',
      getTextbookClosingSaveContext: 'get_textbook_closing_save_context_v1', getTextbookClosingMovementExport: 'get_textbook_closing_movement_export_v1' };
    assert.equal(wire.calls[0].name, rpc[method]);
    if (method === 'getTextbookPurchaseHandoff') {
      const build = data.kind === 'order' ? handoff.buildPurchaseSupplierHandoffGroups : handoff.buildPurchaseSupplierReturnHandoffGroups;
      const groups = build({ ...data, rows: data.lines, ordersById: new Map(data.lines.map((line) => [line.order.id, line.order])) });
      assert.deepEqual(result, { groups, sourceLineCount: 2, complete: true });
      assert.equal(result.groups[0].totalQuantity, data.kind === 'order' ? 3 : 2);
      assert.equal(result.groups[0].totalAmount, data.kind === 'order' ? 18002 : 9001);
    } else if (method === 'getTextbookBillingHandoff') {
      const groups = handoff.buildMakeEduBillingHandoffGroups({ ...data, rows: data.lines, salesById: new Map(data.sales.map((row) => [row.id, row])), studentsById: new Map(data.students.map((row) => [row.id, row])) });
      assert.deepEqual(result, { groups, sourceLineCount: 1, complete: true });
      assert.equal(groups[0].totalQuantity, 2); assert.equal(groups[0].totalAmount, 20002); assert.equal(groups[0].lines[0].detail, '중2 · 작은반');
    } else if (method === 'getTextbookClosingMovementExport') {
      assert.deepEqual(result, { rows: data.rows, sourceLineCount: 1, complete: true });
    } else if (method === 'getTextbookClosingDetail') {
      assert.deepEqual(result.storedMetrics, original.getClosingStoredMetrics(data.row));
      assert.deepEqual(result.metricMismatches, { purchase: false, sale: false, ending: false, margin: true }); assert.equal(result.metricMismatchCount, 1);
      assert.equal(result.preview.closing.receivedAmount, 0); assert.equal(result.preview.closing.supplierPaymentAmount, 0);
    } else assert.deepEqual(result, data);
    // Every captured boundary still rejects unexpected shape and a corrupted
    // completeness/count marker; no successful replay weakens fail-closed parsing.
    await assert.rejects(() => api[method](...args, { client: contextWire({ ...data, unexpected: true }).client }), /response_invalid/);
    const broken = structuredClone(data);
    if ('complete' in broken) broken.complete = false;
    else if ('totalCount' in broken) broken.totalCount = -1;
    else if ('sourceLineCount' in broken) broken.sourceLineCount = -1;
    else broken.preview.sourceLineCount = -1;
    await assert.rejects(() => api[method](...args, { client: contextWire(broken).client }), /response_invalid/);
  }
  assert.equal(results.length, 13);
  const pick = (method, month) => results.find((capture) => capture.method === method && (capture.input.closingMonth || capture.input[0]) === month);
  for (const month of ['2099-09', '2097-05']) {
    const save = pick('getTextbookClosingSaveContext', month).result; const preview = pick('getTextbookClosingPreview', month);
    const stockMoves = ledger.filterStockMovesForClosing(save);
    assert.deepEqual(ledger.buildTextbookMonthlyClosing({ stockMoves, openingQuantity: preview.input.openingQuantity, openingAmount: preview.input.openingAmount }), preview.result.closing);
    if (month === '2097-05') {
      assert.deepEqual(stockMoves.map((move) => move.id), [contextId(2305), contextId(2306), contextId(2304)]);
      assert.equal(preview.result.closing.adjustmentAmount, 0.25); assert.equal(preview.result.closing.endingAmount, 2.75);
    } else {
      const exported = pick('getTextbookClosingMovementExport', month).result;
      const rows = original.buildClosingDetailRows(stockMoves, original.buildTextbookLookupMap(save.textbooks), original.buildLocationNameLookup([{ id: contextId(900), name: '본관' }]));
      assert.deepEqual(exported.rows, rows); assert.equal(rows[0].marginAmount, 2000); assert.equal(preview.result.closing.textbookMarginAmount, 4000);
    }
  }
  const decimalExport = pick('getTextbookClosingMovementExport', '2097-04').result;
  const decimalPreview = pick('getTextbookClosingPreview', '2097-04').result;
  assert.equal(decimalExport.rows[0].marginAmount, 30.299999999999983);
  assert.equal(decimalPreview.closing.textbookMarginAmount, 30.299999999999955);

  const finalClassCapture = JSON.parse(finalTask5b2WirePayload); const finalWire = contextWire(finalClassCapture.data);
  const actualClass = await api.getClassTextbookSaleContext(finalClassCapture.input, { client: finalWire.client });
  assert.equal(finalWire.calls.length, 1); assert.equal(finalWire.calls[0].name, 'get_class_textbook_sale_context_v1');
  assert.deepEqual(finalWire.calls[0].args, { p_input: finalClassCapture.input }); assert.equal(finalWire.calls[0].retry, false);
  assert.ok(finalWire.calls[0].signal instanceof AbortSignal); assert.deepEqual(actualClass, finalClassCapture.data);
  assert.equal(actualClass.students.length, 22); assert.equal(actualClass.enrolledStudentIds.length, 24); assert.deepEqual(actualClass.missingStudentIds, ['legacy-school-id']);
  assert.equal(actualClass.students[0].school, null); assert.equal(actualClass.students[21].school, '__t5b2_school_offpage');
  assert.deepEqual(Object.keys(actualClass.students[21]).sort(), ['grade', 'id', 'name', 'school']);
  assert.equal(actualClass.duplicateCount, 1); assert.equal(actualClass.inventory.currentQuantity, -2);
  const draft = ledger.buildTextbookSaleDraft({ classRecord: actualClass.class, students: actualClass.students, textbook: actualClass.textbook,
    chargeMonth: actualClass.input.chargeMonth, locationId: actualClass.location.id, availableQuantity: actualClass.inventory.currentQuantity });
  assert.deepEqual(draft.lines.map((line) => line.student_id), actualClass.enrolledStudentIds);
  assert.equal(draft.totalQuantity, 24); assert.equal(draft.totalAmount, 240024); assert.equal(draft.stockShortage, 26); assert.equal(draft.hasStockShortage, true);
});
const completeCases = [
  ['getTextbookPurchaseHandoff', [contextFilters, 'order'], 'get_textbook_purchase_handoff_context_v1', { p_filters: contextFilters, p_kind: 'order' }, emptyPurchase, () => ({ groups: [], sourceLineCount: 0, complete: true })],
  ['getTextbookBillingHandoff', [{ search: '', status: 'all' }], 'get_textbook_billing_handoff_context_v1', { p_filters: { search: '', status: 'all' } }, emptyBilling, () => ({ groups: [], sourceLineCount: 0, complete: true })],
  ['getTextbookClosingSaveContext', ['2026-08', 'all'], 'get_textbook_closing_save_context_v1', { p_closing_month: '2026-08', p_subject: 'all' }, emptyClosing, emptyClosing],
  ['getTextbookClosingMovementExport', [{ closingMonth: '2026-08', subject: 'all', search: '' }], 'get_textbook_closing_movement_export_v1', { p_filters: { closingMonth: '2026-08', subject: 'all', search: '' } },
    () => ({ sourceLineCount: 0, sourceLineIds: [], rows: [], complete: true }), () => ({ rows: [], sourceLineCount: 0, complete: true })],
];
for (const [method, args, rpc, rpcArgs, payload, want] of completeCases) test(`${method} admits only complete purpose snapshots, no ordinary-list fallback`, async () => {
  assert.ok(existsSync(contextUrl), 'complete purpose service must exist'); const api = await import(contextUrl);
  const transport = contextWire(payload());
  assert.deepEqual(await api[method](...args, { client: transport.client }), want());
  assert.equal(transport.calls.length, 1); assert.equal(transport.calls[0].name, rpc); assert.deepEqual(transport.calls[0].args, rpcArgs); assert.equal(transport.calls[0].retry, false);
  for (const bad of [null, {}, { ...payload(), complete: false }, { ...payload(), sourceLineCount: 1 }, { ...payload(), sourceLineIds: [contextId(1)] }, { ...payload(), extra: true }]) {
    await assert.rejects(() => api[method](...args, { client: contextWire(bad).client }), /response_invalid/);
  }
});

test('all nine new reads preserve caller/deadline cancellation and strict single-attempt errors', async (t) => {
  const work = await import(contextUrl); const read = await import(new URL('textbook-read-service.ts', feature));
  const methods = [
    ...completeCases.map(([name, args, , , payload]) => [work[name], args, payload]),
    [work.getClassTextbookSaleContext, [classInput], classPayload],
    [read.listTextbookClosingPage, [{ page: 1, pageSize: 10, filters: { month: 'all', subject: 'all', status: 'all' }, sort: 'month-desc' }], () => ({ rows: [], totalCount: 0, page: 1, pageSize: 10 })],
    [read.listTextbookClosingMovementPage, [{ page: 1, pageSize: 10, filters: { closingMonth: '', subject: 'all', search: '' }, sort: 'event-desc' }], () => ({ rows: [], totalCount: 0, page: 1, pageSize: 10 })],
    [read.getTextbookClosingDetail, [contextId(1)], () => ({ row: null, preview: null })],
    [read.getTextbookClosingPreview, [{ closingMonth: '', subject: 'all', openingQuantity: 0, openingAmount: 0 }], () => null],
  ];
  assert.equal(methods.length, 9);
  for (const [method, args, payload] of methods) {
    for (const cause of ['caller', 'deadline', 'pre-aborted']) {
      const caller = new AbortController(); const deadline = new AbortController(); const reason = new Error(cause);
      t.mock.method(AbortSignal, 'timeout', (ms) => { assert.equal(ms, 8000); return deadline.signal; });
      if (cause === 'pre-aborted') caller.abort(reason);
      const transport = contextWire(payload(), null, () => (cause === 'deadline' ? deadline : caller).abort(reason));
      await assert.rejects(() => method(...args, { client: transport.client, signal: caller.signal }), (error) => error === reason);
      assert.equal(transport.calls.length, cause === 'pre-aborted' ? 0 : 1); t.mock.restoreAll();
    }
    for (const code of ['PGRST202', '42883', '42501', '22023']) {
      const error = { code, message: 'explicit failure' }; const transport = contextWire(null, error);
      await assert.rejects(() => method(...args, { client: transport.client }), (actual) => ['PGRST202', '42883'].includes(code) ? actual.code === 'textbook_read_rpc_unavailable' && actual.cause === error : actual === error);
      assert.equal(transport.calls.length, 1); assert.equal(transport.calls[0].retry, false);
    }
  }
});
test('movement export rejects rows outside its complete raw-month or original searchable scope', async () => {
  const api = await import(contextUrl);
  const row = { id: contextId(88), at: '2026-09-01T00:00:00Z', typeLabel: '출고', textbookTitle: '교재', locationName: '본관', quantity: -1, amount: 0, marginAmount: 1000 };
  const data = { rows: [row], sourceLineIds: [row.id], sourceLineCount: 1, complete: true };
  await assert.rejects(() => api.getTextbookClosingMovementExport({ closingMonth: '2026-08', subject: 'all', search: '' }, { client: contextWire(data).client }), /response_invalid/);
  await assert.rejects(() => api.getTextbookClosingMovementExport({ closingMonth: '2026-09', subject: 'all', search: '없는 교재' }, { client: contextWire(data).client }), /response_invalid/);
});

async function closingOracle() {
  const ledger = await import(new URL('textbook-ledger.js', feature));
  const model = await import(new URL('textbook-read-model.ts', feature));
  const dependencies = { ...ledger, ...model };
  return Function(...Object.keys(dependencies), stripTypeScriptTypes(originalClosingSource) + '\nreturn {buildClosingDetailRows,buildTextbookLookupMap,buildLocationNameLookup,getClosingStoredMetrics,hasClosingMetricMismatch,getClosingDetailSearchHaystack};')(...Object.values(dependencies));
}
async function checkClosingLiteral(api) {
  const books = [{ id: 'b', title: '교재', subject: 'science', sale_price: 10001 }];
  const moves = [
    { id: 'm1', textbook_id: 'b', location_id: 'loc', move_type: 'sale_issue', quantity: -2, amount: -40000, unit_amount: 0, sale_price: 10001, moved_at: '2026-08-31T23:59:59+00:00' },
    { id: 'm2', textbook_id: 'b', location_id: 'unknown', move_type: 'return_out', quantity: -1, amount: 0, total_amount: 123, unit_amount: 10001, moved_at: '2026-08-01T00:00:00+09:00' },
  ];
  const rows = api.buildClosingDetailRows(moves, api.buildTextbookLookupMap(books), api.buildLocationNameLookup([{ id: 'loc', code: 'main', name: '본관' }]));
  assert.deepEqual(rows, [
    { id: 'm1', at: '2026-08-31T23:59:59+00:00', typeLabel: '출고', textbookTitle: '교재', locationName: '본관', quantity: -2, amount: -40000, marginAmount: 2000 },
    { id: 'm2', at: '2026-08-01T00:00:00+09:00', typeLabel: '반품 출고', textbookTitle: '교재', locationName: 'unknown', quantity: -1, amount: 123, marginAmount: 0 },
  ]);
  assert.equal(api.getClosingDetailSearchHaystack(rows[0]), '출고 교재 본관 -2 -40000 2000');
  assert.equal(api.getClosingDetailSearchHaystack(rows[0]).includes('2026-08'), false);
  assert.deepEqual(api.getClosingStoredMetrics({ purchase_quantity: 0, purchaseQuantity: 2, sale_quantity: 3, ending_quantity: -1, settlement_difference: 0, textbook_margin_amount: 2000.49, status: ' draft ', memo: ' 확인 ' }),
    { purchaseQuantity: 2, saleQuantity: 3, endingQuantity: -1, marginAmount: 2000.49, status: 'draft', memo: '확인' });
  assert.equal(api.hasClosingMetricMismatch(2000.49, 2000), false);
  assert.equal(api.hasClosingMetricMismatch(2000.5, 2000), true);
  assert.equal(api.hasClosingMetricMismatch(-0.5, 0), false);
}
test('actual original closing map/metric/search body has literal legacy amount and rounding behavior', async () => {
  await checkClosingLiteral(await closingOracle());
});
test('pure closing module preserves actual original map/metric/search behavior', async () => {
  assert.ok(existsSync(closingUrl), 'pure closing projection must exist before read service can use it');
  await checkClosingLiteral(await import(closingUrl));
});
test('original closing projection keeps JS decimal search spelling and current publisher whitespace fallback', async () => {
  const ledger = await import(new URL('textbook-ledger.js', feature));
  const book = { id: 'decimal-book', title: '소수 교재', subject: 'english', publisher: ' ', publisher_id: 'tips', sale_price: 100.1 };
  const input = { closingMonth: '2026-08', subject: 'all', textbooks: [book], publishers: [{ id: 'tips', name: '팁스서점' }], suppliers: [], publisherSupplierLinks: [],
    stockMoves: [{ id: 'decimal-move', textbook_id: book.id, moved_at: '2026-08-01T00:00:00Z', move_type: 'sale_issue', quantity: -1, unit_amount: 0, amount: 0 }] };
  const enriched = ledger.filterStockMovesForClosing(input); assert.equal(enriched[0].publisher, '팁스서점');
  assert.equal(ledger.buildTextbookMonthlyClosing({ stockMoves: enriched }).textbookMarginAmount, 100.1);
  for (const api of [await closingOracle(), await import(closingUrl)]) {
    const [tips] = api.buildClosingDetailRows(enriched, api.buildTextbookLookupMap([book]), new Map()); assert.equal(tips.marginAmount, 100.1);
    const [external] = api.buildClosingDetailRows([{ ...enriched[0], publisher: '', publisher_name: '' }], api.buildTextbookLookupMap([book]), new Map());
    assert.equal(external.marginAmount, 10.099999999999994);
    assert.equal(api.getClosingDetailSearchHaystack(external).includes('10.099999999999994'), true);
    const tripleMove = { ...enriched[0], publisher: '', publisher_name: '', quantity: -3 };
    const [triple] = api.buildClosingDetailRows([tripleMove], api.buildTextbookLookupMap([book]), new Map());
    assert.equal(triple.marginAmount, 30.299999999999983);
    assert.equal(ledger.buildTextbookMonthlyClosing({ stockMoves: [tripleMove] }).textbookMarginAmount, 30.299999999999955);
    const [tiny] = api.buildClosingDetailRows([{ ...tripleMove, quantity: -1, unit_amount: 1e-7, amount: 1e-7 }], api.buildTextbookLookupMap([book]), new Map());
    assert.equal(api.getClosingDetailSearchHaystack(tiny).includes('1e-7'), true);
  }
});
test('actual ledger preserves native ordered signed fractional accumulation independently of display rows', async () => {
  const { buildTextbookMonthlyClosing } = await import(new URL('textbook-ledger.js', feature));
  const stockMoves = [
    { move_type: 'stock_adjustment', quantity: 1, amount: 1e16, moved_at: '2097-05-03T00:00:00Z' },
    { move_type: 'stock_adjustment', quantity: -1, amount: -1e16, moved_at: '2097-05-02T00:00:00Z' },
    { move_type: 'stock_adjustment', quantity: 1, amount: 0.25, moved_at: '2097-05-01T00:00:00Z' },
  ];
  const closing = buildTextbookMonthlyClosing({ openingAmount: 2.5, stockMoves });
  assert.equal(closing.adjustmentAmount, 0.25); assert.equal(closing.endingAmount, 2.75);
  assert.equal(closing.adjustmentQuantity, 1); assert.equal(closing.paymentDifference, 0);
  assert.equal(buildTextbookMonthlyClosing({ stockMoves: [stockMoves[2], stockMoves[0], stockMoves[1]] }).adjustmentAmount, 0, 'the original operation order is observable');
});
test('actual external purchase cost rounds the binary product immediately below half down', async () => {
  const { getTextbookPurchaseUnitCost, buildTextbookMonthlyClosing } = await import(new URL('textbook-ledger.js', feature));
  const price = 0.5555555555555555;
  assert.equal(price * 0.9, 0.49999999999999994);
  assert.equal(getTextbookPurchaseUnitCost({ sale_price: price, publisher: '외부' }), 0);
  const move = { id: 'round-boundary', move_type: 'sale_issue', quantity: -1, unit_amount: price, sale_price: price, publisher: '외부', moved_at: '2097-06-01T00:00:00Z' };
  assert.equal(buildTextbookMonthlyClosing({ stockMoves: [move] }).textbookMarginAmount, price);
  for (const api of [await closingOracle(), await import(closingUrl)]) assert.equal(api.buildClosingDetailRows([move], new Map(), new Map())[0].marginAmount, price);
});

const textbook = { id: 'book', title: '교재 2', subject: 'english', publisher: '출판사', sale_price: 10001, default_supplier_id: 'supplier' };
const order = (id) => ({ id, status: 'ordered', requested_by: '김쌤', supplier_id: 'supplier' });
const purchaseLine = (id, extra = {}) => ({ id, textbook_id: 'book', purchase_order_id: 'o1', class_id: 'class', location_id: 'main', copy_scope: 'student', status: 'ordered', ordered_quantity: 2, received_quantity: 1, ...extra });
const purchaseInput = () => ({
  rows: [purchaseLine('student'), purchaseLine('teacher', { purchase_order_id: 'o2', copy_scope: 'teacher', ordered_quantity: 1, received_quantity: 1, location_id: 'annex' }), purchaseLine('request', { status: 'requested', ordered_quantity: 99 })],
  ordersById: new Map([['o1', order('o1')], ['o2', order('o2')]]), textbooks: [textbook],
  publishers: [], suppliers: [{ id: 'supplier', name: '외부', contact: '담당' }], publisherSupplierLinks: [],
  locations: [{ id: 'main', name: '본관' }, { id: 'annex', name: '별관' }], classes: [{ id: 'class', name: '중2반' }],
});
async function assertLiteralOutputs(api) {
  const [group] = api.buildPurchaseSupplierHandoffGroups(purchaseInput());
  assert.equal(group.id, 'supplier'); assert.equal(group.totalQuantity, 3); assert.equal(group.totalAmount, 18002);
  assert.deepEqual(group.summary, ['1종', '학생용 2권', '교사용 1권', '3권', '18,002원']);
  assert.deepEqual(group.lines, [{ id: 'supplier||book', title: '교재 2', detail: '학생용/교사용 · 출판사 · 중2반 · 본관, 별관',
    note: '부분 입고, 입고 완료 · 요청 김쌤 · 잔여 1권', quantityLabel: '학생용 2권 · 교사용 1권', amountLabel: '18,002원',
    locationLabel: '본관: 학생용 2권, 교사용 0권 · 별관: 학생용 0권, 교사용 1권',
    locationQuantities: [{ locationLabel: '본관', studentQuantityLabel: '2권', teacherQuantityLabel: '0권' }, { locationLabel: '별관', studentQuantityLabel: '0권', teacherQuantityLabel: '1권' }],
    publisherLabel: '출판사', studentQuantityLabel: '2권', teacherQuantityLabel: '1권', unitCostLabel: '9,001원' }]);
  assert.match(group.message, /총 주문금액: 18,002원/);
  const returns = purchaseInput(); returns.rows = returns.rows.map((line) => ({ ...line, status: line.id === 'student' ? 'partially_received' : 'received' }));
  returns.rows[2].received_quantity = 0;
  const [returned] = api.buildPurchaseSupplierReturnHandoffGroups(returns);
  assert.equal(returned.totalQuantity, 2); assert.equal(returned.totalAmount, 9001);
  assert.equal(returned.lines[0].quantityLabel, '학생용 1권 · 교사용 1권');
  assert.equal(returned.summary[0], '반품 요청서');
  const billing = api.buildMakeEduBillingHandoffGroups({
    rows: [{ id: 'real-line', student_id: 'student', textbook_id: 'book', class_id: 'class', quantity: 2, unit_price: 0, charge_month: '2026-08', status: 'paid' },
      { id: 'teacher-line', textbook_id: 'book', copy_scope: 'teacher', status: 'charged' },
      { id: 'excluded-line', textbook_id: 'book', status: 'excluded' }],
    salesById: new Map(), textbooks: [textbook], classes: [{ id: 'class', name: '중2반' }], studentsById: new Map([['student', { id: 'student', name: '학생', grade: '중2' }]]),
  });
  assert.deepEqual(billing.map((group) => Object.fromEntries(Object.entries(group).filter(([key]) => key !== 'message'))), [{ id: '2026-08:[영어 교재] 교재 2 20002:20002', title: '[영어 교재] 교재 2 20002', subtitle: '수납시작: 2026-08',
    summary: ['1명', '2권', '20,002원'], lines: [{ id: 'real-line', title: '학생', detail: '중2 · 중2반', note: '수량 2 · 출고 대기', quantityLabel: '1명', amountLabel: '20,002원' }], totalQuantity: 2, totalAmount: 20002 }]);
}
test('extracted pure handoff model preserves literal existing order, return and billing outputs', async () => {
  assert.ok(existsSync(handoffUrl), 'pure handoff module must exist independently of React workspace');
  await assertLiteralOutputs(await import(handoffUrl));
});

test('workspace imports and invokes the single extracted implementations of all three builders', () => {
  const workspace = readFileSync(new URL('textbook-operations-workspace.tsx', feature), 'utf8');
  const imports = workspace.match(/import \{([^}]+)\} from "\.\/textbook-handoff-model";/)?.[1].split(/[,\s]+/) || [];
  for (const name of ['buildPurchaseSupplierHandoffGroups', 'buildPurchaseSupplierReturnHandoffGroups', 'buildMakeEduBillingHandoffGroups']) {
    assert.ok(imports.includes(name), `${name} is imported`);
    assert.ok(new RegExp(`${name}\\(`).test(workspace), `${name} is invoked`);
    assert.ok(!new RegExp(`function ${name}\\b`).test(workspace), `${name} has one implementation`);
  }
});

test('teacher-only and zero-price handoffs preserve zero formatting without billing teacher copies', async () => {
  const api = await import(handoffUrl);
  const input = purchaseInput();
  input.rows = [purchaseLine('teacher', { copy_scope: 'teacher', ordered_quantity: 3 })];
  const [teacher] = api.buildPurchaseSupplierHandoffGroups(input);
  assert.equal(teacher.totalAmount, 0); assert.equal(teacher.lines[0].amountLabel, '-');
  assert.equal(teacher.lines[0].unitCostLabel, '0원');
  assert.deepEqual(teacher.summary, ['1종', '교사용 3권', '3권']);
  input.textbooks = [{ ...textbook, sale_price: 0 }];
  input.rows = [purchaseLine('student', { ordered_quantity: 1, unit_cost: 0 })];
  const [zero] = api.buildPurchaseSupplierHandoffGroups(input);
  assert.equal(zero.totalAmount, 0); assert.equal(zero.lines[0].unitCostLabel, '-');
  const groups = api.buildMakeEduBillingHandoffGroups({ rows: [
    { id: 'one', textbook_id: 'book', charge_month: '2026-08', quantity: 1, unit_price: 10.1 },
    { id: 'two', textbook_id: 'book', charge_month: '2026-08', quantity: 1, unit_price: 10.2 },
    { id: 'zero', textbook_id: 'missing', charge_month: '2026-08', quantity: 0, unit_price: 0 },
  ], salesById: new Map(), textbooks: [textbook], classes: [], studentsById: new Map() });
  assert.equal(groups.length, 3, 'rounded fee title does not collapse different exact amounts');
  assert.deepEqual(groups.flatMap((group) => group.lines.map((line) => [line.id, line.quantityLabel, line.amountLabel])).sort(), [
    ['one', '1명', '10.1원'], ['two', '1명', '10.2원'], ['zero', '1명', '-'],
  ]);
});

test('repeated student and teacher source lines accumulate across orders without relaxing order or return eligibility', async () => {
  const api = await import(handoffUrl);
  const input = purchaseInput();
  input.rows = [
    purchaseLine('student-a'),
    purchaseLine('student-b', { purchase_order_id: 'o2', ordered_quantity: 3, received_quantity: 0 }),
    purchaseLine('teacher-a', { copy_scope: 'teacher', ordered_quantity: 1, location_id: 'annex' }),
    purchaseLine('teacher-b', { purchase_order_id: 'o2', copy_scope: 'teacher', ordered_quantity: 2, received_quantity: 0 }),
    purchaseLine('partial', { status: 'partially_received', ordered_quantity: 4, received_quantity: 1 }),
    purchaseLine('zero', { ordered_quantity: 0, requested_quantity: 99, received_quantity: 0 }),
    purchaseLine('cancelled', { status: 'cancelled', ordered_quantity: 10 }),
    purchaseLine('returned', { status: 'returned', ordered_quantity: 5 }),
    purchaseLine('received', { status: 'received', ordered_quantity: 4, received_quantity: 4 }),
    purchaseLine('requested', { status: 'requested', requested_quantity: 99 }),
  ];
  const groups = api.buildPurchaseSupplierHandoffGroups(input);
  assert.equal(groups.length, 1); assert.equal(groups[0].lines.length, 1);
  assert.equal(groups[0].totalQuantity, 12); assert.equal(groups[0].totalAmount, 81009);
  assert.deepEqual(groups[0].lines[0].locationQuantities, [
    { locationLabel: '본관', studentQuantityLabel: '9권', teacherQuantityLabel: '2권' },
    { locationLabel: '별관', studentQuantityLabel: '0권', teacherQuantityLabel: '1권' },
  ]);
  assert.equal(groups[0].lines[0].quantityLabel, '학생용 9권 · 교사용 3권');
  assert.equal(groups[0].lines[0].note, '부분 입고, 주문 외 1 · 요청 김쌤 · 잔여 4권');
  const returned = api.buildPurchaseSupplierReturnHandoffGroups(input);
  assert.equal(returned.length, 1); assert.equal(returned[0].totalQuantity, 5);
  assert.equal(returned[0].totalAmount, 45005);
  assert.equal(returned[0].lines[0].quantityLabel, '학생용 5권');
});

test('configured publisher links retain primary priority, direct supplier precedence and TIPS zero cost', async () => {
  const api = await import(handoffUrl);
  const input = purchaseInput();
  input.rows = [purchaseLine('student', { received_quantity: 0 })];
  input.textbooks = [{ ...textbook, default_supplier_id: '', publisher: '  출판사  ' }];
  input.publishers = [{ id: 'publisher', name: '출판사' }];
  input.suppliers.push({ id: 'tips', name: '팁스서점' });
  input.publisherSupplierLinks = [
    { publisher_id: 'publisher', supplier_id: 'tips', is_primary: false, priority: 0 },
    { publisher_id: 'publisher', supplier_id: 'supplier', is_primary: true, priority: 99 },
  ];
  const [external] = api.buildPurchaseSupplierHandoffGroups(input);
  assert.equal(external.id, 'supplier'); assert.equal(external.totalAmount, 18002);
  input.textbooks[0].default_supplier_id = 'tips';
  const [tips] = api.buildPurchaseSupplierHandoffGroups(input);
  assert.equal(tips.id, 'tips'); assert.equal(tips.totalAmount, 0);
  assert.equal(tips.lines[0].unitCostLabel, '0원'); assert.equal(tips.lines[0].amountLabel, '-');
  input.textbooks[0].sale_price = 0;
  input.rows[0].unit_cost = 123;
  const [fallback] = api.buildPurchaseSupplierHandoffGroups(input);
  assert.equal(fallback.totalAmount, 246, 'missing catalog price keeps legacy explicit unit-cost fallback');
  assert.equal(fallback.lines[0].unitCostLabel, '123원');
});
