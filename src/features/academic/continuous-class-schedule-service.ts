import { supabase } from "../../lib/supabase.ts";

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
