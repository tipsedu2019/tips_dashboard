/* eslint-disable @typescript-eslint/no-explicit-any -- strict transport checks narrow every RPC field. */
import { readTextbookPurpose, textbookPurposeValidation, type TextbookReadOptions } from "./textbook-read-service";
import { assertOwnerDraft } from "./textbook-owner-settings-model";
import { assertSubSubjectDraft, isDefaultTextbookSubSubjectId } from "./textbook-taxonomy";
import type { SaveTextbookSettingsDraftRequest, SaveTextbookSettingsDraftResult } from "./textbook-settings-types";

const v: typeof textbookPurposeValidation = textbookPurposeValidation;
const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
function assertRequest(value: unknown): asserts value is SaveTextbookSettingsDraftRequest { const row = value as Record<string, any>; if (!object(value) || Object.keys(row).length !== 2 || !v.uuid(row.requestId) || !object(row.draft) || Object.keys(row.draft).length !== 3 || row.draft.version !== 1 || (row.draft.owners === null && row.draft.subSubjects === null)) v.fail("input"); if (row.draft.owners !== null) assertOwnerDraft(row.draft.owners); if (row.draft.subSubjects !== null) assertSubSubjectDraft(row.draft.subSubjects); }
function sortedIds(value: unknown) {
  if (!Array.isArray(value) || !value.every(id => v.uuid(id) && id === id.toLowerCase()) || new Set(value).size !== value.length || value.some((id, index) => index && value[index - 1] > id)) v.fail();
  return value as string[];
}
function parseOwners(value: unknown, baseRevision: string) {
  const owners = value as Record<string, any>;
  v.exact(owners, ["baseRevision", "newRevision", "changedPublisherIds", "deletedPublisherIds", "changedSupplierIds", "deletedSupplierIds", "changedLinkPublisherIds"]);
  if (![owners.baseRevision, owners.newRevision].every(item => typeof item === "string" && /^[0-9a-f]{64}$/.test(item)) || owners.baseRevision !== baseRevision) v.fail();
  const idsByKey = new Map<string, string[]>();
  for (const key of ["changedPublisherIds", "deletedPublisherIds", "changedSupplierIds", "deletedSupplierIds", "changedLinkPublisherIds"]) idsByKey.set(key, sortedIds(owners[key]));
  for (const [changedKey, deletedKey] of [["changedPublisherIds", "deletedPublisherIds"], ["changedSupplierIds", "deletedSupplierIds"], ["changedLinkPublisherIds", "deletedPublisherIds"]] as const) {
    const changed = idsByKey.get(changedKey)!;
    const deleted = idsByKey.get(deletedKey)!;
    if (changed.some(id => deleted.includes(id))) v.fail();
  }
  return owners;
}
function parseSubSubjects(value: unknown, baseRevision: string) {
  const result = value as Record<string, any>;
  v.exact(result, ["baseRevision", "newRevision", "changedIds", "deletedIds", "materializedIds"]);
  if (![result.baseRevision, result.newRevision].every(item => typeof item === "string" && /^[0-9a-f]{64}$/.test(item)) || result.baseRevision !== baseRevision) v.fail();
  const changedIds = sortedIds(result.changedIds);
  const deletedIds = sortedIds(result.deletedIds);
  if (changedIds.some(id => deletedIds.includes(id)) || !object(result.materializedIds)) v.fail();
  const materializedValues = new Set<string>();
  for (const [virtualId, persistedId] of Object.entries(result.materializedIds)) {
    if (!isDefaultTextbookSubSubjectId(virtualId) || !v.uuid(persistedId) || persistedId !== persistedId.toLowerCase() || materializedValues.has(persistedId) || !changedIds.includes(persistedId)) v.fail();
    materializedValues.add(persistedId);
  }
  return result;
}
function parse(value: unknown, request: SaveTextbookSettingsDraftRequest): SaveTextbookSettingsDraftResult {
  const row = value as Record<string, any>;
  v.exact(value, ["requestId", "owners", "subSubjects"]);
  const expectedOwners = request.draft.owners;
  const expectedSubSubjects = request.draft.subSubjects;
  if (row.requestId !== request.requestId
    || (expectedOwners === null ? row.owners !== null : !object(row.owners))
    || (expectedSubSubjects === null ? row.subSubjects !== null : !object(row.subSubjects))) v.fail();
  if (expectedOwners !== null) parseOwners(row.owners, expectedOwners.baseRevision);
  if (expectedSubSubjects !== null) parseSubSubjects(row.subSubjects, expectedSubSubjects.baseRevision);
  return row as SaveTextbookSettingsDraftResult;
}
export function saveTextbookSettingsDraft(request: SaveTextbookSettingsDraftRequest, options: TextbookReadOptions = {}) { assertRequest(request); const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline; return readTextbookPurpose({ ...options, signal }, client => client.rpc("save_textbook_settings_draft_v1", { p_request_id: request.requestId, p_draft: request.draft }).abortSignal(signal).retry(false), data => parse(data, request)); }
