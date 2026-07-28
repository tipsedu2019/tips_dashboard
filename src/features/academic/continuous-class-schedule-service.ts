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
  generateSessions: (input: GenerateClassLessonSessionsInput) => Promise<unknown>;
  saveSession: (input: SaveClassLessonSessionInput) => Promise<unknown>;
  saveContent: (input: SaveClassLessonContentInput) => Promise<unknown>;
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
