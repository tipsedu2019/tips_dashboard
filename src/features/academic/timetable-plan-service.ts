import type {
  DeletePlanItemCommand, PlanCommand, PlanItem, PlanMutationResult, PlanRevision, PlanSnapshot,
  SavePlanItemCommand, TimetablePlanRpcContract, TransferCommitCommand, TransferPreview,
  TransferRequest, TransferResult,
} from './timetable-plan-contract.ts';

type RpcName = keyof TimetablePlanRpcContract | 'preview_timetable_plan_transfer_v1' | 'commit_timetable_plan_transfer_v1';
type RpcQuery = PromiseLike<{ data: unknown; error: unknown }> & { abortSignal?: (signal: AbortSignal) => RpcQuery };
export type TimetableRpcClient = { rpc: (name: RpcName, args: Record<string, unknown>) => RpcQuery };
export type RequestOptions = { signal?: AbortSignal };
const invalid = () => new Error('timetable_plan_response_invalid');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const integer = (value: unknown): value is number => Number.isSafeInteger(value);
const planItem = (value: unknown): value is PlanItem => record(value) && string(value.id) && string(value.planId)
  && integer(value.revision) && (value.state === 'draft' || value.state === 'applied')
  && Array.isArray(value.pendingSlots);
const planSlot = (value: unknown) => record(value) && string(value.id) && string(value.itemId)
  && string(value.planId) && integer(value.weekday) && integer(value.startMinute)
  && integer(value.endMinute) && string(value.teacherId) && string(value.classroomId);
const planMetadata = (value: unknown) => record(value) && string(value.id) && string(value.name)
  && (value.state === 'draft' || value.state === 'archived') && integer(value.metaRevision)
  && integer(value.changeSequence);

function requireSnapshot(value: unknown): PlanSnapshot {
  if (!record(value) || !planMetadata(value.plan) || !Array.isArray(value.items)
    || !value.items.every(planItem) || !Array.isArray(value.slots) || !value.slots.every(planSlot)
    || !Array.isArray(value.appliedSnapshots) || !Array.isArray(value.shadowSlots)
    || !Array.isArray(value.shadowClasses) || !Array.isArray(value.datedSessions)
    || !Array.isArray(value.datedUnresolvedOccupancies) || !Array.isArray(value.unresolvedOccupancies)
    || !record(value.catalogs) || !Array.isArray(value.catalogs.teachers)
    || !Array.isArray(value.catalogs.classrooms) || !record(value.permissions)
    || typeof value.permissions.canEdit !== 'boolean' || typeof value.permissions.canManage !== 'boolean'
    || typeof value.permissions.canTransfer !== 'boolean' || !record(value.capacity)
    || !integer(value.capacity.itemCount) || !integer(value.capacity.slotCount)
    || !string(value.shadowFingerprint) || !string(value.datedFingerprint)
    || !string(value.asOfDate) || typeof value.complete !== 'boolean' || typeof value.datedComplete !== 'boolean') throw invalid();
  return value as PlanSnapshot;
}
function requireRevision(value: unknown): PlanRevision {
  if (!record(value) || !string(value.planId) || !integer(value.metaRevision)
    || !integer(value.changeSequence) || !string(value.shadowFingerprint)
    || typeof value.complete !== 'boolean') throw invalid();
  return value as PlanRevision;
}
function requireMutation(value: unknown): PlanMutationResult {
  if (!record(value) || !string(value.planId) || !integer(value.metaRevision)
    || !integer(value.changeSequence) || !string(value.shadowFingerprint)
    || !Array.isArray(value.slots) || !value.slots.every(planSlot)
    || !Array.isArray(value.removedItemIds) || !value.removedItemIds.every(string)
    || !(value.item === null || (planItem(value.item) && value.item.planId === value.planId))) throw invalid();
  return value as PlanMutationResult;
}
function requirePreview(value: unknown): TransferPreview {
  if (!record(value) || !string(value.fingerprint) || !string(value.shadowFingerprint)
    || !record(value.request) || !Array.isArray(value.mappings) || !Array.isArray(value.blockers)) throw invalid();
  return value as TransferPreview;
}
function requireTransfer(value: unknown): TransferResult {
  if (!record(value) || !string(value.transferId) || !string(value.shadowFingerprint)
    || !Array.isArray(value.mappings) || !Array.isArray(value.appliedItems)
    || !Array.isArray(value.removedItemIds) || !Array.isArray(value.addedShadowSlots)
    || !Array.isArray(value.createdItems) || !Array.isArray(value.createdSlots)
    || (!record(value.snapshot) && (!Array.isArray(value.addedShadowClasses)
      || !record(value.sourcePlan) || !record(value.operatingReference)))) throw invalid();
  if (record(value.snapshot)) requireSnapshot(value.snapshot);
  else {
    const sourcePlan = value.sourcePlan as Record<string, unknown>;
    const reference = value.operatingReference as Record<string, unknown>;
    if (!string(sourcePlan.id) || !integer(sourcePlan.changeSequence)
      || !Array.isArray(reference.shadowSlots) || !Array.isArray(reference.shadowClasses)
      || reference.shadowFingerprint !== value.shadowFingerprint) throw invalid();
  }
  return value as TransferResult;
}

/** RPC arguments and responses are the canonical timetable contract; actorScope partitions client state only. */
export function createTimetablePlanService({ client, actorScope }: { client: TimetableRpcClient; actorScope: string }) {
  if (!client || typeof client.rpc !== 'function' || !actorScope.trim()) throw new Error('timetable_plan_scope_missing');
  async function invoke(name: RpcName, args: Record<string, unknown>, options: RequestOptions = {}): Promise<unknown> {
    let query = client.rpc(name, args);
    if (options.signal && typeof query.abortSignal === 'function') query = query.abortSignal(options.signal);
    const { data, error } = await query;
    if (error) throw error;
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
    return data;
  }
  return {
    actorScope,
    readPlan: async (planId: string, options?: RequestOptions) => requireSnapshot(await invoke('get_timetable_plan_v1', { p_plan_id: planId }, options)),
    readRevision: async (planId: string, options?: RequestOptions) => requireRevision(await invoke('get_timetable_plan_revision_v1', { p_plan_id: planId }, options)),
    saveItem: async (command: SavePlanItemCommand | DeletePlanItemCommand, options?: RequestOptions) =>
      requireMutation(await invoke('mutate_timetable_plan_item_v1', { p_command: command }, options)),
    mutatePlan: async (command: PlanCommand, options?: RequestOptions) => {
      const result = await invoke('mutate_timetable_plan_v1', { p_command: command }, options);
      if (!record(result) || !planMetadata(result.plan)) throw invalid();
      return result as { plan: PlanSnapshot['plan'] };
    },
    previewTransfer: async (request: TransferRequest, options?: RequestOptions) =>
      requirePreview(await invoke('preview_timetable_plan_transfer_v1', { p_request: request }, options)),
    commitTransfer: async (command: TransferCommitCommand, options?: RequestOptions) =>
      requireTransfer(await invoke('commit_timetable_plan_transfer_v1', { p_command: command }, options)),
  };
}
export type TimetablePlanService = ReturnType<typeof createTimetablePlanService>;

type SignalPayload = { new?: unknown };
type SignalChannel = {
  on: (type: 'postgres_changes', filter: { event: 'INSERT' | 'UPDATE'; schema: 'public'; table: 'timetable_invalidation_signals'; filter: string },
    callback: (payload: SignalPayload) => void) => SignalChannel;
  subscribe: () => unknown;
};
export type TimetableSignalClient = {
  channel: (name: string) => SignalChannel;
  removeChannel: (channel: SignalChannel) => unknown;
};
export type TimetableWatchEnvironment = {
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setInterval' | 'clearInterval'>;
};
/** Signal rows carry only an ID/sequence; all timetable contents come from authorized RPC reads. */
export function watchTimetablePlan({ client, actorScope, planId, onInvalidate, onPoll, environment }: {
  client: TimetableSignalClient; actorScope: string; planId: string;
  onInvalidate: () => void; onPoll: () => void; environment: TimetableWatchEnvironment;
}): () => void {
  const channel = client.channel(`timetable-signals:${actorScope}:${planId}`);
  const onSignal = (payload: SignalPayload) => {
    const row = payload.new;
    if (record(row) && (row.id === planId || row.id === 'operating')
      && integer(row.change_sequence)) onInvalidate();
  };
  for (const event of ['INSERT', 'UPDATE'] as const) {
    channel.on('postgres_changes', { event, schema: 'public', table: 'timetable_invalidation_signals', filter: `id=eq.${planId}` }, onSignal);
    channel.on('postgres_changes', { event, schema: 'public', table: 'timetable_invalidation_signals', filter: 'id=eq.operating' }, onSignal);
  }
  channel.subscribe();
  const visible = () => environment.document.visibilityState === 'visible';
  const poll = () => { if (visible()) onPoll(); };
  const resume = () => { if (visible()) onInvalidate(); };
  const timer = environment.window.setInterval(poll, 20_000);
  environment.document.addEventListener('visibilitychange', resume);
  environment.window.addEventListener('focus', resume);
  return () => {
    environment.window.clearInterval(timer);
    environment.document.removeEventListener('visibilitychange', resume);
    environment.window.removeEventListener('focus', resume);
    void client.removeChannel(channel);
  };
}
