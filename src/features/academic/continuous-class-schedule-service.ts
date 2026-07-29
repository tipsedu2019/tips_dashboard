import { supabase } from "../../lib/supabase.ts";

import {
  CONTINUOUS_CLASS_SCHEDULE_RPC,
  type GenerateClassLessonSessionsInput,
  type SaveClassLessonContentInput,
  type SaveClassLessonSessionInput,
  type SaveClassScheduleDefaultsInput,
} from "./continuous-class-schedule-contract.ts";

export { CONTINUOUS_CLASS_SCHEDULE_RPC } from "./continuous-class-schedule-contract.ts";

import {
  buildContinuousScheduleBackfillPreview,
  compareContinuousScheduleShadow,
  type ContinuousScheduleLegacyInput,
  type ContinuousScheduleShadowComparison,
} from "./continuous-class-schedule-model.ts";
import type { ContinuousScheduleRuntimeState } from "./continuous-class-schedule-runtime-probe.ts";

export type ContinuousScheduleStorageMode = "legacy" | "shadow" | "normalized";

export type ContinuousScheduleShadowReader = {
  readClassMode: (classId: string) => Promise<unknown>;
  readSlots: (classId: string) => Promise<unknown>;
  readSessions: (classId: string) => Promise<unknown>;
};

export type ContinuousScheduleShadowEvidence = {
  authoritativeSource: "legacy";
  runtimeMode: "legacy" | "shadow" | "ready";
  storageMode: ContinuousScheduleStorageMode;
  shadow: null | {
    comparison: ContinuousScheduleShadowComparison;
    slots: unknown[];
    sessions: unknown[];
  };
  evidenceIssueCodes: string[];
};

export type LoadContinuousScheduleShadowEvidenceInput = {
  reader: ContinuousScheduleShadowReader;
  runtimeState: ContinuousScheduleRuntimeState;
  legacyInput: ContinuousScheduleLegacyInput;
};

type SupabaseReadResult = {
  data: unknown;
  error: unknown;
};

export type ContinuousScheduleRpcErrorKind =
  | "stale"
  | "forbidden"
  | "not_ready"
  | "idempotency"
  | "validation"
  | "unknown";

export type ContinuousScheduleRpcError = {
  kind: ContinuousScheduleRpcErrorKind;
  code: string;
};

export type ContinuousScheduleMutationRpcClient = {
  rpc: (name: string, parameters: Record<string, unknown>) => Promise<{
    data: unknown;
    error: unknown;
  }>;
};

export type ContinuousScheduleMutationAction = {
  requestKey: string;
  saveDefaults: (input: SaveClassScheduleDefaultsInput) => Promise<unknown>;
  previewGeneration: (input: Omit<GenerateClassLessonSessionsInput, "reason">) => Promise<unknown>;
  generateSessions: (input: GenerateClassLessonSessionsInput) => Promise<unknown>;
  saveSession: (input: SaveClassLessonSessionInput) => Promise<unknown>;
  saveContent: (input: SaveClassLessonContentInput) => Promise<unknown>;
};

export type ContinuousScheduleBoundedReadInput = {
  classId: string;
  dateFrom: string;
  dateTo: string;
  refreshKey?: number;
};

export type ContinuousScheduleBoundedReadResult =
  | { source: "normalized"; data: Record<string, unknown> }
  | { source: "legacy"; classId: string; sessions: unknown[] }
  | { source: "error"; error: unknown };

export type ContinuousScheduleBoundedReader = {
  load: (input: ContinuousScheduleBoundedReadInput) => Promise<ContinuousScheduleBoundedReadResult>;
  reset: () => void;
};

type SupabaseReadQuery = PromiseLike<SupabaseReadResult> & {
  eq: (column: string, value: string) => SupabaseReadQuery;
  order: (column: string) => SupabaseReadQuery;
  limit: (count: number) => PromiseLike<SupabaseReadResult>;
};

type SupabaseContinuousScheduleReaderClient = {
  from: (table: string) => {
    select: (columns: string) => SupabaseReadQuery;
  };
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function rpcCode(error: unknown): string {
  return text(record(error)?.code).toUpperCase();
}

function rpcMessage(error: unknown): string {
  return text(record(error)?.message).toLowerCase();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isValidScheduleRange(input: ContinuousScheduleBoundedReadInput): boolean {
  if (!isUuid(input.classId) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dateTo)) {
    return false;
  }
  const dateFrom = new Date(`${input.dateFrom}T00:00:00.000Z`);
  const dateTo = new Date(`${input.dateTo}T00:00:00.000Z`);
  return Number.isFinite(dateFrom.getTime())
    && Number.isFinite(dateTo.getTime())
    && dateTo >= dateFrom
    && (dateTo.getTime() - dateFrom.getTime()) / 86_400_000 <= 366;
}

function isMissingScheduleReadRpc(error: unknown): boolean {
  const code = rpcCode(error);
  const message = rpcMessage(error);
  return code === "PGRST202" || code === "42883"
    || (message.includes("get_class_schedule_v1") && message.includes("schema cache"));
}

export function mapContinuousScheduleRpcError(error: unknown): ContinuousScheduleRpcError {
  const code = rpcCode(error);
  const message = rpcMessage(error);
  if (code === "40001" || message.includes("class_schedule_stale")) {
    return { kind: "stale", code };
  }
  if (code === "42501" || message.includes("class_schedule_forbidden")) {
    return { kind: "forbidden", code };
  }
  if (message.includes("continuous_class_schedule_runtime_not_ready")) {
    return { kind: "not_ready", code };
  }
  if (message.includes("idempotency_key_reused")) {
    return { kind: "idempotency", code };
  }
  if (["22023", "22007", "23514", "23505"].includes(code) || message.includes("class_schedule_validation")) {
    return { kind: "validation", code };
  }
  return { kind: "unknown", code };
}

export function createBoundedContinuousScheduleReader(input: {
  runtimeProbe: Pick<
    import("./continuous-class-schedule-runtime-probe.ts").ContinuousScheduleRuntimeProbe,
    "probe" | "reset"
  >;
  readSchedule: (
    input: ContinuousScheduleBoundedReadInput,
    signal: AbortSignal,
  ) => Promise<Record<string, unknown>>;
  loadLegacy: (
    input: ContinuousScheduleBoundedReadInput,
  ) => Promise<{ source: "legacy"; classId: string; sessions: unknown[] }>;
}): ContinuousScheduleBoundedReader {
  const inFlight = new Map<string, Promise<ContinuousScheduleBoundedReadResult>>();
  const inFlightTokens = new Map<string, symbol>();
  let activeClassId = "";
  let activeController: AbortController | null = null;

  function reset(): void {
    activeController?.abort();
    activeController = null;
    activeClassId = "";
    inFlight.clear();
    inFlightTokens.clear();
  }

  function load(value: ContinuousScheduleBoundedReadInput) {
    if (!isValidScheduleRange(value)) {
      return Promise.reject(new Error("A valid class ID and a date range of at most 366 days are required."));
    }
    const key = `${value.classId}:${value.dateFrom}:${value.dateTo}`;
    const existing = inFlight.get(key);
    if (existing) return existing;
    if (activeClassId && activeClassId !== value.classId) activeController?.abort();
    activeClassId = value.classId;
    const controller = new AbortController();
    activeController = controller;

    const token = Symbol(key);
    const request = (async () => {
      try {
        await input.runtimeProbe.probe();
        const result = await input.readSchedule(value, controller.signal);
        if (result.authoritativeSource === "normalized") {
          return { source: "normalized" as const, data: result };
        }
        if (result.authoritativeSource === "legacy") return input.loadLegacy(value);
        return { source: "error" as const, error: new Error("Continuous schedule read returned no authoritative source.") };
      } catch (error) {
        if (mapContinuousScheduleRpcError(error).kind === "not_ready" || isMissingScheduleReadRpc(error)) {
          input.runtimeProbe.reset();
          return input.loadLegacy(value);
        }
        return { source: "error" as const, error };
      } finally {
        if (inFlightTokens.get(key) === token) {
          inFlight.delete(key);
          inFlightTokens.delete(key);
        }
      }
    })();
    inFlight.set(key, request);
    inFlightTokens.set(key, token);
    return request;
  }

  return { load, reset };
}

function defaultRequestKey(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("A cryptographically secure request key generator is required.");
  }
  return globalThis.crypto.randomUUID();
}

async function invokeContinuousScheduleRpc(
  client: ContinuousScheduleMutationRpcClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.rpc(name, parameters);
  if (result.error) throw result.error;
  return result.data;
}

export function createContinuousScheduleMutationAction(input: {
  rpc: ContinuousScheduleMutationRpcClient["rpc"];
  createRequestKey?: () => string;
}): ContinuousScheduleMutationAction {
  const requestKey = (input.createRequestKey || defaultRequestKey)();
  const client: ContinuousScheduleMutationRpcClient = { rpc: input.rpc };

  return {
    requestKey,
    saveDefaults(value) {
      return invokeContinuousScheduleRpc(client, CONTINUOUS_CLASS_SCHEDULE_RPC.saveDefaults, {
        p_class_id: value.classId,
        p_expected_schedule_revision: value.expectedScheduleRevision,
        p_slots: value.slots,
        p_request_key: requestKey,
        p_reason: value.reason,
      });
    },
    previewGeneration(value) {
      return invokeContinuousScheduleRpc(client, CONTINUOUS_CLASS_SCHEDULE_RPC.previewGeneration, {
        p_class_id: value.classId,
        p_expected_schedule_revision: value.expectedScheduleRevision,
        p_date_from: value.dateFrom,
        p_date_to: value.dateTo,
      });
    },
    generateSessions(value) {
      return invokeContinuousScheduleRpc(client, CONTINUOUS_CLASS_SCHEDULE_RPC.generateSessions, {
        p_class_id: value.classId,
        p_expected_schedule_revision: value.expectedScheduleRevision,
        p_date_from: value.dateFrom,
        p_date_to: value.dateTo,
        p_request_key: requestKey,
        p_reason: value.reason,
      });
    },
    saveSession(value) {
      return invokeContinuousScheduleRpc(client, CONTINUOUS_CLASS_SCHEDULE_RPC.saveSession, {
        p_session_id: value.sessionId,
        p_expected_revision: value.expectedRevision,
        p_schedule_state: value.scheduleState,
        p_session_date: value.sessionDate,
        p_start_time: value.startTime,
        p_end_time: value.endTime,
        p_teacher_catalog_id: value.teacherCatalogId,
        p_classroom_catalog_id: value.classroomCatalogId,
        p_memo: value.memo,
        p_public_note: value.publicNote,
        p_teacher_note: value.teacherNote,
        p_request_key: requestKey,
        p_correction_reason: value.correctionReason,
      });
    },
    saveContent(value) {
      return invokeContinuousScheduleRpc(client, CONTINUOUS_CLASS_SCHEDULE_RPC.saveContent, {
        p_class_id: value.classId,
        p_expected_content_hash: value.expectedContentHash,
        p_content_patch: value.contentPatch,
        p_request_key: requestKey,
      });
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function storageModeFrom(value: unknown): {
  mode: ContinuousScheduleStorageMode;
  isInvalid: boolean;
} {
  const mode = text(record(value)?.schedule_storage_mode);
  if (mode === "legacy" || mode === "shadow" || mode === "normalized") {
    return { mode, isInvalid: false };
  }
  return { mode: "legacy", isInvalid: true };
}

function shadowReadFailure(
  runtimeMode: ContinuousScheduleShadowEvidence["runtimeMode"],
  storageMode: ContinuousScheduleStorageMode,
): ContinuousScheduleShadowEvidence {
  return {
    authoritativeSource: "legacy",
    runtimeMode,
    storageMode,
    shadow: null,
    evidenceIssueCodes: ["shadow_read_failed"],
  };
}

function asRows(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("Continuous schedule shadow rows are invalid.");
  }
  return value;
}

export async function loadContinuousScheduleShadowEvidence(
  input: LoadContinuousScheduleShadowEvidenceInput,
): Promise<ContinuousScheduleShadowEvidence> {
  const classId = text(input.legacyInput.classId);
  if (!classId) {
    throw new Error("Class ID is required to load continuous schedule shadow evidence.");
  }

  if (input.runtimeState.mode === "legacy") {
    return {
      authoritativeSource: "legacy",
      runtimeMode: "legacy",
      storageMode: "legacy",
      shadow: null,
      evidenceIssueCodes: [],
    };
  }

  let classModeRow: unknown;
  try {
    classModeRow = await input.reader.readClassMode(classId);
  } catch {
    return shadowReadFailure(input.runtimeState.mode, "legacy");
  }

  const { mode: storageMode, isInvalid } = storageModeFrom(classModeRow);
  if (isInvalid) {
    return {
      authoritativeSource: "legacy",
      runtimeMode: input.runtimeState.mode,
      storageMode,
      shadow: null,
      evidenceIssueCodes: ["invalid_storage_mode"],
    };
  }
  if (storageMode === "legacy") {
    return {
      authoritativeSource: "legacy",
      runtimeMode: input.runtimeState.mode,
      storageMode,
      shadow: null,
      evidenceIssueCodes: [],
    };
  }

  let slots: unknown[];
  let sessions: unknown[];
  try {
    slots = asRows(await input.reader.readSlots(classId));
    sessions = asRows(await input.reader.readSessions(classId));
  } catch {
    return shadowReadFailure(input.runtimeState.mode, storageMode);
  }

  const preview = buildContinuousScheduleBackfillPreview(input.legacyInput);
  const comparison = compareContinuousScheduleShadow(preview, { slots, sessions });
  const evidenceIssueCodes: string[] = [...comparison.issueCodes];

  if (storageMode === "normalized") {
    evidenceIssueCodes.push(
      input.runtimeState.mode === "ready"
        ? "normalized_cutover_not_enabled"
        : "mode_not_ready",
    );
  }

  return {
    authoritativeSource: "legacy",
    runtimeMode: input.runtimeState.mode,
    storageMode,
    shadow: { comparison, slots, sessions },
    evidenceIssueCodes,
  };
}

function readResultData(result: SupabaseReadResult): unknown {
  if (result.error) throw result.error;
  return result.data;
}

export function createSupabaseContinuousScheduleShadowReader(
  client: SupabaseContinuousScheduleReaderClient = supabase as unknown as SupabaseContinuousScheduleReaderClient,
): ContinuousScheduleShadowReader {
  return {
    async readClassMode(classId) {
      const result = await client
        .from("classes")
        .select("id,schedule_storage_mode")
        .eq("id", classId)
        .limit(1);
      const data = readResultData(result);
      return Array.isArray(data) ? (data[0] ?? null) : data;
    },
    async readSlots(classId) {
      const result = await client
        .from("class_schedule_slots")
        .select(
          "id,class_id,weekday,start_time,end_time,teacher_catalog_id,teacher_name,classroom_catalog_id,classroom_name,sort_order",
        )
        .eq("class_id", classId)
        .order("weekday")
        .order("start_time")
        .order("sort_order");
      return readResultData(result);
    },
    async readSessions(classId) {
      const result = await client
        .from("class_lesson_sessions")
        .select(
          "id,class_id,session_key,session_date,schedule_state,source_schedule_slot_id,origin",
        )
        .eq("class_id", classId)
        .order("session_date")
        .order("start_time")
        .order("id");
      return readResultData(result);
    },
  };
}
