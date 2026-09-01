import type {
  OwnerDraft,
  OwnerDraftOperation,
  PublisherSettingRow,
  SaveTextbookSettingsDraftRequest,
  SaveTextbookSettingsDraftResult,
  SubSubjectDraft,
  SubSubjectDraftOperation,
  SupplierSettingRow,
  TextbookSubSubjectSettingRow,
} from "./textbook-settings-types";

export type TextbookSettingsPendingSave = {
  request: SaveTextbookSettingsDraftRequest;
  ownerPrefixLength: number;
  subSubjectPrefixLength: number;
  generation: number;
  status: "submitting" | "unknown";
};

export type TextbookSettingsDraftState = {
  actorScope: string;
  ownerBaseRevision: string | null;
  subSubjectBaseRevision: string | null;
  ownerOperations: OwnerDraftOperation[];
  subSubjectOperations: SubSubjectDraftOperation[];
  generation: number;
  pendingSave: TextbookSettingsPendingSave | null;
};

type SaveErrorKind = "conflict" | "known" | "unknown";
const revisionPattern = /^[0-9a-f]{64}$/;

function ensureRevision(value: string) {
  if (!revisionPattern.test(value)) throw new TypeError("textbook_settings_revision_invalid");
  return value;
}

function cloneOwnerOperation(operation: OwnerDraftOperation): OwnerDraftOperation {
  if (operation.type === "publisher.add") {
    return { ...operation, subjects: [...operation.subjects], supplierIds: [...operation.supplierIds] };
  }
  if (operation.type === "publisher.patch") {
    return {
      ...operation,
      patch: {
        ...operation.patch,
        ...(operation.patch.subjects ? { subjects: [...operation.patch.subjects] } : {}),
        ...(operation.patch.supplierIds ? { supplierIds: [...operation.patch.supplierIds] } : {}),
      },
    };
  }
  return { ...operation };
}

function cloneSubSubjectOperation(operation: SubSubjectDraftOperation): SubSubjectDraftOperation {
  if (operation.type === "patch") return { ...operation, patch: { ...operation.patch } };
  return { ...operation };
}

function samePrefix<T>(current: T[], frozen: T[], length: number) {
  return length <= current.length
    && JSON.stringify(current.slice(0, length)) === JSON.stringify(frozen.slice(0, length));
}

function requireOwnerRevision(state: TextbookSettingsDraftState) {
  if (!state.ownerBaseRevision) throw new Error("textbook_settings_owner_baseline_unavailable");
  return state.ownerBaseRevision;
}

function requireSubSubjectRevision(state: TextbookSettingsDraftState) {
  if (!state.subSubjectBaseRevision) throw new Error("textbook_settings_subsubject_baseline_unavailable");
  return state.subSubjectBaseRevision;
}

export function createTextbookSettingsDraftState(actorScope: string): TextbookSettingsDraftState {
  if (!actorScope) throw new TypeError("textbook_settings_actor_invalid");
  return {
    actorScope,
    ownerBaseRevision: null,
    subSubjectBaseRevision: null,
    ownerOperations: [],
    subSubjectOperations: [],
    generation: 0,
    pendingSave: null,
  };
}

export function acceptTextbookOwnerRevision(state: TextbookSettingsDraftState, revision: string) {
  ensureRevision(revision);
  if (state.ownerOperations.length > 0 || state.pendingSave?.ownerPrefixLength) {
    return state;
  }
  return state.ownerBaseRevision === revision ? state : { ...state, ownerBaseRevision: revision };
}

export function acceptTextbookSubSubjectRevision(state: TextbookSettingsDraftState, revision: string) {
  ensureRevision(revision);
  if (state.subSubjectOperations.length > 0 || state.pendingSave?.subSubjectPrefixLength) {
    return state;
  }
  return state.subSubjectBaseRevision === revision ? state : { ...state, subSubjectBaseRevision: revision };
}

export function appendTextbookOwnerOperation(
  state: TextbookSettingsDraftState,
  operation: OwnerDraftOperation,
): TextbookSettingsDraftState {
  requireOwnerRevision(state);
  return {
    ...state,
    ownerOperations: [...state.ownerOperations, cloneOwnerOperation(operation)],
    generation: state.generation + 1,
  };
}

export function appendTextbookSubSubjectOperation(
  state: TextbookSettingsDraftState,
  operation: SubSubjectDraftOperation,
): TextbookSettingsDraftState {
  requireSubSubjectRevision(state);
  return {
    ...state,
    subSubjectOperations: [...state.subSubjectOperations, cloneSubSubjectOperation(operation)],
    generation: state.generation + 1,
  };
}

export function getTextbookOwnerDraft(state: TextbookSettingsDraftState): OwnerDraft | null {
  if (state.ownerOperations.length === 0) return null;
  return {
    version: 1,
    baseRevision: requireOwnerRevision(state),
    operations: state.ownerOperations.map(cloneOwnerOperation),
  };
}

export function getTextbookSubSubjectDraft(state: TextbookSettingsDraftState): SubSubjectDraft | null {
  if (state.subSubjectOperations.length === 0) return null;
  return {
    version: 1,
    baseRevision: requireSubSubjectRevision(state),
    operations: state.subSubjectOperations.map(cloneSubSubjectOperation),
  };
}

export function hasTextbookSettingsChanges(state: TextbookSettingsDraftState) {
  return state.ownerOperations.length > 0 || state.subSubjectOperations.length > 0;
}

export function freezeTextbookSettingsSave(
  state: TextbookSettingsDraftState,
  requestId: string = crypto.randomUUID(),
): { state: TextbookSettingsDraftState; request: SaveTextbookSettingsDraftRequest } {
  if (state.pendingSave) return { state, request: state.pendingSave.request };
  const owners = getTextbookOwnerDraft(state);
  const subSubjects = getTextbookSubSubjectDraft(state);
  if (!owners && !subSubjects) throw new Error("textbook_settings_draft_empty");
  const request: SaveTextbookSettingsDraftRequest = {
    requestId,
    draft: { version: 1, owners, subSubjects },
  };
  const pendingSave: TextbookSettingsPendingSave = {
    request,
    ownerPrefixLength: owners?.operations.length || 0,
    subSubjectPrefixLength: subSubjects?.operations.length || 0,
    generation: state.generation,
    status: "submitting",
  };
  return { state: { ...state, pendingSave }, request };
}

export function markTextbookSettingsSaveUnknown(state: TextbookSettingsDraftState) {
  if (!state.pendingSave || state.pendingSave.status === "unknown") return state;
  return { ...state, pendingSave: { ...state.pendingSave, status: "unknown" as const } };
}

export function rejectTextbookSettingsSave(state: TextbookSettingsDraftState) {
  return state.pendingSave ? { ...state, pendingSave: null } : state;
}

function remapSubSubjectOperation(
  operation: SubSubjectDraftOperation,
  materializedIds: Record<string, string>,
): SubSubjectDraftOperation {
  const id = materializedIds[operation.id] || operation.id;
  return cloneSubSubjectOperation({ ...operation, id } as SubSubjectDraftOperation);
}

export function acknowledgeTextbookSettingsSave(
  state: TextbookSettingsDraftState,
  result: SaveTextbookSettingsDraftResult,
): TextbookSettingsDraftState {
  const pending = state.pendingSave;
  if (!pending || pending.request.requestId !== result.requestId) {
    throw new Error("textbook_settings_save_acknowledgement_obsolete");
  }
  const frozenOwners = pending.request.draft.owners?.operations || [];
  const frozenSubSubjects = pending.request.draft.subSubjects?.operations || [];
  if (!samePrefix(state.ownerOperations, frozenOwners, pending.ownerPrefixLength)
    || !samePrefix(state.subSubjectOperations, frozenSubSubjects, pending.subSubjectPrefixLength)) {
    throw new Error("textbook_settings_save_prefix_changed");
  }
  if (Boolean(result.owners) !== Boolean(pending.request.draft.owners)
    || Boolean(result.subSubjects) !== Boolean(pending.request.draft.subSubjects)) {
    throw new Error("textbook_settings_save_acknowledgement_invalid");
  }

  const remainingOwners = state.ownerOperations
    .slice(pending.ownerPrefixLength)
    .map(cloneOwnerOperation);
  const remainingSubSubjects = state.subSubjectOperations
    .slice(pending.subSubjectPrefixLength)
    .map((operation) => remapSubSubjectOperation(operation, result.subSubjects?.materializedIds || {}));

  return {
    ...state,
    ownerBaseRevision: result.owners?.newRevision || state.ownerBaseRevision,
    subSubjectBaseRevision: result.subSubjects?.newRevision || state.subSubjectBaseRevision,
    ownerOperations: remainingOwners,
    subSubjectOperations: remainingSubSubjects,
    pendingSave: null,
  };
}

export function discardTextbookSettingsDrafts(state: TextbookSettingsDraftState): TextbookSettingsDraftState {
  if (state.pendingSave?.status === "unknown") {
    throw new Error("textbook_settings_save_outcome_unknown");
  }
  return {
    ...state,
    ownerBaseRevision: null,
    subSubjectBaseRevision: null,
    ownerOperations: [],
    subSubjectOperations: [],
    generation: state.generation + 1,
    pendingSave: null,
  };
}

export function classifyTextbookSettingsSaveError(error: unknown): SaveErrorKind {
  if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) return "unknown";
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  if (code === "55000") return "conflict";
  if (code) return "known";
  if (error instanceof TypeError || error instanceof Error) return "unknown";
  return "unknown";
}

export function overlayPublisherSettingRow(
  source: PublisherSettingRow,
  state: TextbookSettingsDraftState,
): PublisherSettingRow | null {
  let row: PublisherSettingRow | null = {
    ...source,
    subjects: [...source.subjects],
    suppliers: source.suppliers.map((supplier) => ({ ...supplier })),
  };
  for (const operation of state.ownerOperations) {
    if (operation.type === "publisher.add" && operation.id === source.id) {
      row = {
        ...source,
        name: operation.name,
        subjects: [...operation.subjects],
        suppliers: operation.supplierIds.map((id) => row?.suppliers.find((item) => item.id === id) || { id, name: "" }),
        isNew: true,
      };
    } else if (operation.type === "publisher.patch" && operation.id === source.id && row) {
      row = {
        ...row,
        ...("name" in operation.patch ? { name: operation.patch.name ?? row.name } : {}),
        ...(operation.patch.subjects ? { subjects: [...operation.patch.subjects] } : {}),
        ...(operation.patch.supplierIds ? {
          suppliers: operation.patch.supplierIds.map((id) => row?.suppliers.find((item) => item.id === id) || { id, name: "" }),
        } : {}),
      };
    } else if (operation.type === "publisher.delete" && operation.id === source.id) {
      row = null;
    } else if (operation.type === "supplier.delete" && row) {
      row = { ...row, suppliers: row.suppliers.filter((supplier) => supplier.id !== operation.id) };
    }
  }
  return row;
}

export function overlaySupplierSettingRow(
  source: SupplierSettingRow,
  state: TextbookSettingsDraftState,
): SupplierSettingRow | null {
  let row: SupplierSettingRow | null = { ...source, linkedPublisherNames: [...source.linkedPublisherNames] };
  for (const operation of state.ownerOperations) {
    if (operation.type === "supplier.add" && operation.id === source.id) {
      row = { ...source, name: operation.name, contact: operation.contact, memo: operation.memo, isNew: true };
    } else if (operation.type === "supplier.patch" && operation.id === source.id && row) {
      row = { ...row, ...operation.patch };
    } else if (operation.type === "supplier.delete" && operation.id === source.id) {
      row = null;
    }
  }
  return row;
}

export function overlaySubSubjectSettingRow(
  source: TextbookSubSubjectSettingRow,
  state: TextbookSettingsDraftState,
): TextbookSubSubjectSettingRow | null {
  let row: TextbookSubSubjectSettingRow | null = { ...source };
  for (const operation of state.subSubjectOperations) {
    if (operation.type === "add" && operation.id === source.id) {
      row = { ...source, name: operation.name, isVisible: operation.isVisible, kind: "added" };
    } else if (operation.type === "patch" && operation.id === source.id && row) {
      row = { ...row, ...operation.patch };
    } else if (operation.type === "delete" && operation.id === source.id) {
      row = null;
    }
  }
  return row;
}
