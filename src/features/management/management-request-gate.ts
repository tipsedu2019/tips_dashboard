export type ManagementRequestTicket = {
  generation: number;
  scope: string;
  signal: AbortSignal;
};

export function createManagementRequestGate() {
  let generation = 0;
  let controller: AbortController | null = null;

  return {
    begin(scope: string): ManagementRequestTicket {
      controller?.abort();
      controller = new AbortController();
      generation += 1;
      return { generation, scope, signal: controller.signal };
    },
    isCurrent(ticket: ManagementRequestTicket) {
      return !ticket.signal.aborted && ticket.generation === generation;
    },
    abort() {
      generation += 1;
      controller?.abort();
      controller = null;
    },
  };
}
