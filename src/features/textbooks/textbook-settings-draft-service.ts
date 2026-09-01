/* eslint-disable @typescript-eslint/no-explicit-any -- strict transport checks narrow every RPC field. */
import { readTextbookPurpose, textbookPurposeValidation, type TextbookReadOptions } from "./textbook-read-service";
import { assertOwnerDraft } from "./textbook-owner-settings-model";
import type { SaveTextbookSettingsDraftRequest, SaveTextbookSettingsDraftResult } from "./textbook-settings-types";

const v: typeof textbookPurposeValidation = textbookPurposeValidation;
const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
function assertRequest(value: unknown): asserts value is SaveTextbookSettingsDraftRequest { const row = value as Record<string, any>; if (!object(value) || Object.keys(row).length !== 2 || !v.uuid(row.requestId) || !object(row.draft) || Object.keys(row.draft).length !== 3 || row.draft.version !== 1 || row.draft.subSubjects !== null || row.draft.owners === null) v.fail("input"); assertOwnerDraft(row.draft.owners); }
function parse(value: unknown, request: SaveTextbookSettingsDraftRequest): SaveTextbookSettingsDraftResult {
  const row = value as Record<string, any>;
  v.exact(value, ["requestId", "owners", "subSubjects"]);
  const expectedOwners = request.draft.owners;
  if (row.requestId !== request.requestId || row.subSubjects !== null || !object(row.owners) || !expectedOwners) v.fail();
  const owners: Record<string, any> = row.owners;
  v.exact(owners, ["baseRevision", "newRevision", "changedPublisherIds", "deletedPublisherIds", "changedSupplierIds", "deletedSupplierIds", "changedLinkPublisherIds"]);
  if (![owners.baseRevision, owners.newRevision].every(item => typeof item === "string" && /^[0-9a-f]{64}$/.test(item)) || owners.baseRevision !== expectedOwners.baseRevision) v.fail();
  const idsByKey = new Map<string, string[]>();
  for (const key of ["changedPublisherIds", "deletedPublisherIds", "changedSupplierIds", "deletedSupplierIds", "changedLinkPublisherIds"]) {
    const ids = owners[key];
    if (!Array.isArray(ids) || !ids.every(id => v.uuid(id) && id === id.toLowerCase()) || new Set(ids.map(id => id.toLowerCase())).size !== ids.length || ids.some((id, index) => index && ids[index - 1] > id)) v.fail();
    idsByKey.set(key, ids);
  }
  for (const [changedKey, deletedKey] of [["changedPublisherIds", "deletedPublisherIds"], ["changedSupplierIds", "deletedSupplierIds"], ["changedLinkPublisherIds", "deletedPublisherIds"]] as const) {
    const changed = idsByKey.get(changedKey)!;
    const deleted = idsByKey.get(deletedKey)!;
    if (changed.some(id => deleted.includes(id))) v.fail();
  }
  return row as SaveTextbookSettingsDraftResult;
}
export function saveTextbookSettingsDraft(request: SaveTextbookSettingsDraftRequest, options: TextbookReadOptions = {}) { assertRequest(request); const deadline = AbortSignal.timeout(8000); const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline; return readTextbookPurpose({ ...options, signal }, client => client.rpc("save_textbook_settings_draft_v1", { p_request_id: request.requestId, p_draft: request.draft }).abortSignal(signal).retry(false), data => parse(data, request)); }
