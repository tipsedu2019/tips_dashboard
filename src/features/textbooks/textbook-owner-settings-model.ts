/* eslint-disable @typescript-eslint/no-explicit-any -- every JSON field is checked before use. */
import type { OwnerDraft, OwnerDraftOperation, PublisherDraftFields, SupplierDraftFields } from "./textbook-settings-types";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const revisionPattern = /^[0-9a-f]{64}$/;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value: unknown, keys: string[]) => object(value) && Object.keys(value).length === keys.length && keys.every(key => own(value, key));
const fail = (): never => { throw new TypeError("textbook_settings_draft_invalid"); };
export const normalizeOwnerText = (value: unknown) => typeof value === "string" ? value.trim() : "";
export const normalizeOwnerList = (value: unknown) => !Array.isArray(value) ? [] : [...new Set(value.map(normalizeOwnerText).filter(Boolean))];
export const ownerSubjectLabel = (subjects: string[]) => subjects.map(subject => ({ english: "영어", math: "수학", science: "과학", other: "기타" }[subject] || subject)).join(", ") || "미설정";
const koreanNumeric = new Intl.Collator("ko", { numeric: true, sensitivity: "variant" });
export const ownerMatchesSearch = (parts: readonly string[], search: string) => parts.join(" ").toLowerCase().includes(normalizeOwnerText(search).toLowerCase());
export const ownerFirstThreePublisherNames = (rows: readonly { id: string; name: string }[]) => [...rows]
  .sort((left, right) => koreanNumeric.compare(left.name, right.name) || left.id.localeCompare(right.id)).slice(0, 3).map(row => row.name);
export function ownerTextbookCounts(
  publishers: readonly { id: string; name: string }[],
  textbooks: readonly { publisherId: string | null; publisher: string | null }[],
) {
  const byId = new Map(publishers.map(row => [row.id, 0]));
  const lastIdByTrimmedName = new Map(publishers.map(row => [normalizeOwnerText(row.name), row.id]));
  for (const textbook of textbooks) {
    // project_v1 joins a non-null publisher_id directly; only a null ID falls
    // through to its canonical-base-order last matching trimmed display name.
    const publisherId = textbook.publisherId === null ? lastIdByTrimmedName.get(normalizeOwnerText(textbook.publisher)) || "" : textbook.publisherId;
    if (byId.has(publisherId)) byId.set(publisherId, byId.get(publisherId)! + 1);
  }
  return byId;
}

function uuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value); }
function fields(value: unknown, allowed: string[], required = false) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || (required && !Object.keys(value).length)) fail();
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === "string"); }
function operation(value: unknown): asserts value is OwnerDraftOperation {
  const row = value as Record<string, any>;
  if (!object(value) || typeof row.type !== "string" || !uuid(row.id)) fail();
  switch (row.type) {
    case "publisher.add": if (!exact(value, ["type", "id", "name", "subjects", "supplierIds"]) || typeof row.name !== "string" || !strings(row.subjects) || !strings(row.supplierIds) || !row.supplierIds.every(uuid) || new Set(row.supplierIds.map((id: string) => id.toLowerCase())).size !== row.supplierIds.length || !normalizeOwnerText(row.name)) fail(); break;
    case "publisher.patch": if (!exact(value, ["type", "id", "patch"]) || !object(row.patch)) fail(); fields(row.patch, ["name", "subjects", "supplierIds"], true); if ((own(row.patch, "name") && (typeof row.patch.name !== "string" || !normalizeOwnerText(row.patch.name))) || (own(row.patch, "subjects") && !strings(row.patch.subjects)) || (own(row.patch, "supplierIds") && (!strings(row.patch.supplierIds) || !row.patch.supplierIds.every(uuid) || new Set(row.patch.supplierIds.map((id: string) => id.toLowerCase())).size !== row.patch.supplierIds.length))) fail(); break;
    case "publisher.delete": if (!exact(value, ["type", "id"])) fail(); break;
    case "supplier.add": if (!exact(value, ["type", "id", "name", "contact", "memo"]) || ![row.name, row.contact, row.memo].every(item => typeof item === "string") || !normalizeOwnerText(row.name)) fail(); break;
    case "supplier.patch": if (!exact(value, ["type", "id", "patch"]) || !object(row.patch)) fail(); fields(row.patch, ["name", "contact", "memo"], true); if ((own(row.patch, "name") && (typeof row.patch.name !== "string" || !normalizeOwnerText(row.patch.name))) || (own(row.patch, "contact") && typeof row.patch.contact !== "string") || (own(row.patch, "memo") && typeof row.patch.memo !== "string")) fail(); break;
    case "supplier.delete": if (!exact(value, ["type", "id"])) fail(); break;
    default: fail();
  }
}
export function assertOwnerDraft(value: unknown): asserts value is OwnerDraft {
  const draft = value as Record<string, any>;
  if (!exact(value, ["version", "baseRevision", "operations"]) || draft.version !== 1 || typeof draft.baseRevision !== "string" || !revisionPattern.test(draft.baseRevision) || !Array.isArray(draft.operations)) fail();
  draft.operations.forEach(operation);
}

export type OwnerProjection = { publishers: Array<PublisherDraftFields & { id: string; isNew: boolean }>; suppliers: Array<SupplierDraftFields & { id: string; isNew: boolean }> };
/** Pure mirror of the draft lifecycle. The database remains the authority for persisted IDs, links and counts. */
export function projectOwnerDraft(base: OwnerProjection, draft: OwnerDraft | null): OwnerProjection {
  const publishers = base.publishers.map(row => ({ ...row, subjects: normalizeOwnerList(row.subjects), supplierIds: normalizeOwnerList(row.supplierIds) }));
  const suppliers = base.suppliers.map(row => ({ ...row }));
  if (!draft) return { publishers, suppliers };
  assertOwnerDraft(draft);
  const seenPublisherIds = new Set(publishers.map(row => row.id.toLowerCase()));
  const seenSupplierIds = new Set(suppliers.map(row => row.id.toLowerCase()));
  for (const op of draft.operations) {
    const opId = op.id.toLowerCase();
    if (op.type === "publisher.add") { if (seenPublisherIds.has(opId) || op.supplierIds.some(id => !suppliers.some(row => row.id.toLowerCase() === id.toLowerCase()))) fail(); seenPublisherIds.add(opId); publishers.unshift({ id: op.id, name: normalizeOwnerText(op.name), subjects: normalizeOwnerList(op.subjects), supplierIds: op.supplierIds, isNew: true }); }
    else if (op.type === "publisher.patch") { const row = publishers.find(row => row.id.toLowerCase() === opId); if (!row || (own(op.patch, "supplierIds") && op.patch.supplierIds!.some(id => !suppliers.some(supplier => supplier.id.toLowerCase() === id.toLowerCase())))) fail(); Object.assign(row!, own(op.patch, "name") ? { name: normalizeOwnerText(op.patch.name) } : {}, own(op.patch, "subjects") ? { subjects: normalizeOwnerList(op.patch.subjects) } : {}, own(op.patch, "supplierIds") ? { supplierIds: op.patch.supplierIds } : {}); }
    else if (op.type === "publisher.delete") { const index = publishers.findIndex(row => row.id.toLowerCase() === opId); if (index < 0) fail(); publishers.splice(index, 1); }
    else if (op.type === "supplier.add") { if (seenSupplierIds.has(opId)) fail(); seenSupplierIds.add(opId); suppliers.unshift({ id: op.id, name: normalizeOwnerText(op.name), contact: normalizeOwnerText(op.contact), memo: normalizeOwnerText(op.memo), isNew: true }); }
    else if (op.type === "supplier.patch") { const row = suppliers.find(row => row.id.toLowerCase() === opId); if (!row) fail(); Object.assign(row!, own(op.patch, "name") ? { name: normalizeOwnerText(op.patch.name) } : {}, own(op.patch, "contact") ? { contact: normalizeOwnerText(op.patch.contact) } : {}, own(op.patch, "memo") ? { memo: normalizeOwnerText(op.patch.memo) } : {}); }
    else { const index = suppliers.findIndex(row => row.id.toLowerCase() === opId); if (index < 0) fail(); suppliers.splice(index, 1); for (const publisher of publishers) publisher.supplierIds = publisher.supplierIds.filter(id => id.toLowerCase() !== opId); }
  }
  return { publishers, suppliers };
}
