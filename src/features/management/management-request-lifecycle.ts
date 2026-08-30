import type { ManagementRequestTicket } from "./management-request-gate";

type ManagementRequestGate = {
  begin(scope: string): ManagementRequestTicket;
  isCurrent(ticket: ManagementRequestTicket): boolean;
};

type ManagementInitialLoadResult<TMetadata> = {
  metadata: Promise<TMetadata>;
};

type ManagementRequestErrorPhase = "page" | "metadata";

function isAbortError(error: unknown) {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

function getSettledMetadataError(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || !("ok" in metadata) || metadata.ok !== false) {
    return { failed: false as const };
  }
  return {
    failed: true as const,
    error: "error" in metadata ? metadata.error : undefined,
  };
}

export function executeManagementInitialRequest<
  TMetadata,
  TResult extends ManagementInitialLoadResult<TMetadata>,
>({
  gate,
  scope,
  load,
  onPage,
  onMetadata,
  onError,
}: {
  gate: ManagementRequestGate;
  scope: string;
  load: (signal: AbortSignal) => Promise<TResult>;
  onPage: (result: TResult) => void;
  onMetadata: (metadata: TMetadata) => void;
  onError: (error: unknown, phase: ManagementRequestErrorPhase) => void;
}) {
  const ticket = gate.begin(scope);
  const completion = (async () => {
    let phase: ManagementRequestErrorPhase = "page";
    try {
      const result = await load(ticket.signal);
      if (!gate.isCurrent(ticket)) return;
      onPage(result);

      phase = "metadata";
      const metadata = await result.metadata;
      if (!gate.isCurrent(ticket)) return;
      const settledError = getSettledMetadataError(metadata);
      if (settledError.failed) {
        if (!isAbortError(settledError.error)) onError(settledError.error, phase);
        return;
      }
      onMetadata(metadata);
    } catch (error) {
      if (gate.isCurrent(ticket) && !isAbortError(error)) onError(error, phase);
    }
  })();

  return { ticket, completion };
}

export function executeManagementContinuationRequest<TPage>({
  gate,
  initialGate,
  initialTicket,
  scope,
  load,
  onPage,
  onError,
  onSettled,
}: {
  gate: ManagementRequestGate;
  initialGate: ManagementRequestGate;
  initialTicket: ManagementRequestTicket;
  scope: string;
  load: (signal: AbortSignal) => Promise<TPage>;
  onPage: (page: TPage) => void;
  onError: (error: unknown) => void;
  onSettled?: () => void;
}) {
  const ticket = gate.begin(scope);
  const completion = (async () => {
    try {
      const page = await load(ticket.signal);
      if (!gate.isCurrent(ticket) || !initialGate.isCurrent(initialTicket)) return;
      onPage(page);
    } catch (error) {
      if (
        gate.isCurrent(ticket)
        && initialGate.isCurrent(initialTicket)
        && !isAbortError(error)
      ) onError(error);
    } finally {
      if (gate.isCurrent(ticket)) onSettled?.();
    }
  })();

  return { ticket, completion };
}
