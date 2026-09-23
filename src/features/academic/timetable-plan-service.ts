import type {
  DeletePlanItemCommand, PlanCommand, PlanItem, PlanMutationResult, PlanRevision, PlanSnapshot,
  SavePlanItemCommand, TimetableOperatingReference, TimetablePlanRpcContract, TransferCommitCommand, TransferPreview,
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
const nullableString = (value: unknown) => value === null || string(value);
const nullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));
const nullableInteger = (value: unknown) => value === null || integer(value);
const pendingSlot = (value: unknown) => record(value) && string(value.id) && string(value.sourceText)
  && ['missing_resource', 'conflict', 'invalid_time'].includes(String(value.reason))
  && nullableInteger(value.weekday) && nullableInteger(value.startMinute) && nullableInteger(value.endMinute)
  && nullableString(value.teacherId) && nullableString(value.classroomId);
const planItem = (value: unknown): value is PlanItem => record(value) && string(value.id) && string(value.planId)
  && integer(value.revision) && string(value.name) && string(value.subject)
  && nullableString(value.subjectAreaKey) && string(value.grade) && nullableNumber(value.capacity)
  && nullableNumber(value.tuition) && nullableString(value.defaultTeacherId)
  && nullableString(value.defaultClassroomId) && nullableInteger(value.durationMinutes)
  && nullableString(value.sourceClassId) && (value.state === 'draft' || value.state === 'applied')
  && nullableString(value.appliedClassId) && nullableString(value.appliedTransferId)
  && nullableString(value.appliedAt) && Array.isArray(value.pendingSlots)
  && value.pendingSlots.every(pendingSlot);
const planSlot = (value: unknown) => record(value) && string(value.id) && string(value.itemId)
  && string(value.planId) && integer(value.weekday) && integer(value.startMinute)
  && integer(value.endMinute) && string(value.teacherId) && string(value.classroomId);
const dateKey = (value: unknown) => string(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);
const planMetadata = (value: unknown) => record(value) && string(value.id) && string(value.name)
  && (value.state === 'draft' || value.state === 'archived') && integer(value.metaRevision)
  && integer(value.changeSequence) && nullableString(value.targetStartDate)
  && nullableString(value.targetEndDate) && (value.targetStartDate === null) === (value.targetEndDate === null);
const shadowSlot = (value: unknown) => record(value) && string(value.id) && string(value.classId)
  && nullableString(value.sourceSlotId) && integer(value.weekday) && integer(value.startMinute)
  && integer(value.endMinute) && string(value.teacherId) && string(value.classroomId)
  && integer(value.classRevision);
const shadowClass = (value: unknown) => record(value) && string(value.id) && string(value.name)
  && nullableString(value.subject) && nullableString(value.grade) && value.status === '수강'
  && integer(value.revision);
const resourceOption = (value: unknown) => record(value) && string(value.id) && string(value.name)
  && typeof value.isVisible === 'boolean' && Array.isArray(value.subjects)
  && value.subjects.every(string) && (value.isMissing === undefined || typeof value.isMissing === 'boolean');
const occupancyBlocker = (value: unknown) => record(value) && string(value.classId)
  && string(value.label) && (value.scope === 'all' || value.scope === 'resource')
  && nullableString(value.resourceId) && ['unresolved_time', 'unresolved_resource', 'incomplete_read'].includes(String(value.reason));
const datedSession = (value: unknown) => record(value) && string(value.id) && string(value.classId)
  && nullableString(value.sourceSlotId) && dateKey(value.date)
  && ['active', 'exception', 'makeup', 'skipped', 'tbd'].includes(String(value.state))
  && (value.startMinute === null || integer(value.startMinute))
  && (value.endMinute === null || integer(value.endMinute))
  && nullableString(value.teacherId) && nullableString(value.classroomId) && integer(value.revision);
export function requireTimetableOperatingReference(value: unknown): TimetableOperatingReference {
  if (!record(value) || !dateKey(value.asOfDate) || !Array.isArray(value.shadowSlots)
    || !value.shadowSlots.every(shadowSlot) || !Array.isArray(value.shadowClasses)
    || !value.shadowClasses.every(shadowClass) || !record(value.catalogs)
    || !Array.isArray(value.catalogs.teachers) || !value.catalogs.teachers.every(resourceOption)
    || !Array.isArray(value.catalogs.classrooms) || !value.catalogs.classrooms.every(resourceOption)
    || !Array.isArray(value.unresolvedOccupancies) || !value.unresolvedOccupancies.every(occupancyBlocker)
    || !string(value.shadowFingerprint) || !Array.isArray(value.datedSessions)
    || !value.datedSessions.every(datedSession) || !Array.isArray(value.datedUnresolvedOccupancies)
    || !value.datedUnresolvedOccupancies.every((entry: unknown) => record(entry)
      && occupancyBlocker(entry) && (entry.date === null || dateKey(entry.date)))
    || !string(value.datedFingerprint) || typeof value.datedComplete !== 'boolean'
    || typeof value.complete !== 'boolean') throw invalid();
  return value as TimetableOperatingReference;
}

function requireSnapshot(value: unknown): PlanSnapshot {
  requireTimetableOperatingReference(value);
  if (!record(value) || !planMetadata(value.plan) || !Array.isArray(value.items)
    || !value.items.every(planItem) || !Array.isArray(value.slots) || !value.slots.every(planSlot)
    || !Array.isArray(value.appliedSnapshots) || !value.appliedSnapshots.every((entry: unknown) => record(entry)
      && string(entry.itemId) && Array.isArray(entry.slots) && entry.slots.every(planSlot))
    || value.items.some((item: unknown) => record(item) && item.planId !== (value.plan as Record<string, unknown>).id)
    || value.slots.some((slot: unknown) => record(slot) && slot.planId !== (value.plan as Record<string, unknown>).id)
    || !Array.isArray(value.members) || !record(value.permissions)
    || typeof value.permissions.canEdit !== 'boolean' || typeof value.permissions.canManage !== 'boolean'
    || typeof value.permissions.canTransfer !== 'boolean' || !record(value.capacity)
    || !integer(value.capacity.itemCount) || !integer(value.capacity.slotCount)
    || value.capacity.maxItems !== 500 || value.capacity.maxSlots !== 2000
    || typeof value.capacity.exceeded !== 'boolean') throw invalid();
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
/** Validate a full source snapshot or a complete delta before either service or controller accepts it. */
export function requireTimetableTransferResult(value: unknown, sourcePlanId: string): TransferResult {
  if (!record(value) || !string(value.transferId) || !string(value.shadowFingerprint)
    || !Array.isArray(value.mappings) || !value.mappings.every((mapping: unknown) => record(mapping)
      && string(mapping.sourceId) && string(mapping.targetId) && nullableString(mapping.targetClassId))
    || !Array.isArray(value.appliedItems)
    || !value.appliedItems.every((item: unknown) => planItem(item) && item.planId === sourcePlanId
      && item.state === 'applied' && item.appliedTransferId === value.transferId
      && string(item.appliedAt) && !Number.isNaN(Date.parse(item.appliedAt)))
    || new Set(value.appliedItems.map((item: PlanItem) => item.id)).size !== value.appliedItems.length
    || !Array.isArray(value.removedItemIds)
    || !value.removedItemIds.every(string)
    || value.removedItemIds.some((id: string) => (value.appliedItems as PlanItem[]).some((item) => item.id === id))
    || !Array.isArray(value.addedShadowSlots)
    || !value.addedShadowSlots.every(shadowSlot) || !Array.isArray(value.createdItems)
    || !value.createdItems.every(planItem) || !Array.isArray(value.createdSlots)
    || !value.createdSlots.every(planSlot)) throw invalid();
  let authoritative: TimetableOperatingReference;
  if (value.snapshot !== undefined) {
    const snapshot = requireSnapshot(value.snapshot);
    if (snapshot.plan.id !== sourcePlanId || snapshot.shadowFingerprint !== value.shadowFingerprint) throw invalid();
    authoritative = snapshot;
  } else {
    if (!planMetadata(value.sourcePlan) || !record(value.sourcePlan)
      || value.sourcePlan.id !== sourcePlanId || !Array.isArray(value.addedShadowClasses)
      || !value.addedShadowClasses.every(shadowClass)) throw invalid();
    authoritative = requireTimetableOperatingReference(value.operatingReference);
    if (authoritative.shadowFingerprint !== value.shadowFingerprint) throw invalid();
    for (const label of value.addedShadowClasses) {
      if (!record(label) || !authoritative.shadowClasses.some((actual) => actual.id === label.id
        && actual.name === label.name && actual.revision === label.revision)) throw invalid();
    }
  }
  for (const slot of value.addedShadowSlots) {
    if (!record(slot) || !authoritative.shadowSlots.some((actual) => actual.id === slot.id
      && actual.classId === slot.classId && actual.classRevision === slot.classRevision)
      || !authoritative.shadowClasses.some((label) => label.id === slot.classId)) throw invalid();
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
      requireTimetableTransferResult(await invoke('commit_timetable_plan_transfer_v1', { p_command: command }, options), command.request.source.planId),
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
