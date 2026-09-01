export type ManagementListLoadState = "pending" | "loading" | "settled";

export function createManagementListLoadState(): ManagementListLoadState {
  return "pending";
}

export function beginManagementListLoad(): ManagementListLoadState {
  return "loading";
}

export function settleManagementListLoad(): ManagementListLoadState {
  return "settled";
}

export function isManagementListLoading(state: ManagementListLoadState) {
  return state !== "settled";
}

export function getManagementListErrorRecoveryState({
  error,
  loading,
  rowCount,
}: {
  error: string | null;
  loading: boolean;
  rowCount: number;
}) {
  const visible = Boolean(error);
  return {
    visible,
    retryDisabled: Boolean(loading),
    hasRetainedRows: visible && rowCount > 0,
  };
}
