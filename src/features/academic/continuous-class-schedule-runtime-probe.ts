import { supabase } from "@/lib/supabase";

// continuous-class-schedule-runtime-probe-factory:start
export type ContinuousScheduleRuntimeState =
  | { mode: "legacy"; version: 0 }
  | { mode: "shadow"; version: 0 }
  | { mode: "ready"; version: 1 };

export type ContinuousScheduleRuntimeProbeResult = {
  data: unknown;
  error: unknown;
};

export type ContinuousScheduleRuntimeProbeClient = {
  rpc: (name: string) => PromiseLike<ContinuousScheduleRuntimeProbeResult>;
  from: (table: string) => {
    select: (
      columns: string,
      options: { head: true; count: "exact" },
    ) => {
      limit: (count: number) => PromiseLike<ContinuousScheduleRuntimeProbeResult>;
    };
  };
};

export type ContinuousScheduleRuntimeProbe = {
  probe: () => Promise<ContinuousScheduleRuntimeState>;
  reset: () => void;
  resetForFocus: () => void;
  invalidateAfterReadyFailure: (cause: unknown) => never;
};

const CONTINUOUS_SCHEDULE_RUNTIME_RPC =
  "continuous_class_schedule_runtime_version";
const CONTINUOUS_SCHEDULE_SESSION_TABLE = "class_lesson_sessions";

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String(error.code || "").trim().toUpperCase();
}

function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return String(error.message || "").trim().toLowerCase();
}

function isMissingRuntimeFunction(error: unknown): boolean {
  const code = errorCode(error);
  if (code === "PGRST202" || code === "42883") return true;

  const message = errorMessage(error);
  return message.includes("continuous_class_schedule_runtime_version")
    && message.includes("schema cache")
    && message.includes("could not find the function");
}

function isMissingSessionTable(error: unknown): boolean {
  const code = errorCode(error);
  return code === "PGRST205" || code === "42P01";
}

async function detectContinuousScheduleRuntime(
  client: ContinuousScheduleRuntimeProbeClient | null,
): Promise<ContinuousScheduleRuntimeState> {
  if (!client) {
    throw new Error("Continuous schedule runtime client is unavailable.");
  }

  const readiness = await client.rpc(CONTINUOUS_SCHEDULE_RUNTIME_RPC);
  if (!readiness.error) {
    return readiness.data === 1
      ? { mode: "ready", version: 1 }
      : { mode: "shadow", version: 0 };
  }
  if (!isMissingRuntimeFunction(readiness.error)) throw readiness.error;

  const sessionProbe = await client
    .from(CONTINUOUS_SCHEDULE_SESSION_TABLE)
    .select("id", { head: true, count: "exact" })
    .limit(0);
  if (!sessionProbe.error) return { mode: "shadow", version: 0 };
  if (isMissingSessionTable(sessionProbe.error)) return { mode: "legacy", version: 0 };
  throw sessionProbe.error;
}

export class ContinuousScheduleRuntimeIntegrityError extends Error {
  readonly code = "CONTINUOUS_SCHEDULE_RUNTIME_INTEGRITY_ERROR";
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Continuous schedule runtime readiness does not match the deployed schema.");
    this.name = "ContinuousScheduleRuntimeIntegrityError";
    this.cause = cause;
  }
}

export function createContinuousScheduleRuntimeProbe(
  client: ContinuousScheduleRuntimeProbeClient | null,
  options: {
    maxAgeMs?: number;
    now?: () => number;
  } = {},
): ContinuousScheduleRuntimeProbe {
  let cachedState: ContinuousScheduleRuntimeState | null = null;
  let cachedAt = 0;
  let inFlight: Promise<ContinuousScheduleRuntimeState> | null = null;
  let generation = 0;
  const maxAgeMs = options.maxAgeMs ?? 30_000;
  const now = options.now ?? (() => Date.now());

  function reset(): void {
    generation += 1;
    cachedState = null;
    cachedAt = 0;
    inFlight = null;
  }

  function probe(): Promise<ContinuousScheduleRuntimeState> {
    if (cachedState && now() - cachedAt < maxAgeMs) return Promise.resolve(cachedState);
    if (cachedState) cachedState = null;
    if (inFlight) return inFlight;

    const requestGeneration = generation;
    const request = detectContinuousScheduleRuntime(client)
      .then((state) => {
        if (requestGeneration === generation) {
          cachedState = state;
          cachedAt = now();
        }
        return state;
      })
      .finally(() => {
        if (inFlight === request) inFlight = null;
      });
    inFlight = request;
    return request;
  }

  function invalidateAfterReadyFailure(cause: unknown): never {
    reset();
    throw new ContinuousScheduleRuntimeIntegrityError(cause);
  }

  return { probe, reset, resetForFocus: reset, invalidateAfterReadyFailure };
}
// continuous-class-schedule-runtime-probe-factory:end

const defaultContinuousScheduleRuntimeProbe = createContinuousScheduleRuntimeProbe(
  supabase as unknown as ContinuousScheduleRuntimeProbeClient | null,
);

export function probeContinuousScheduleRuntime(): Promise<ContinuousScheduleRuntimeState> {
  return defaultContinuousScheduleRuntimeProbe.probe();
}

export function resetContinuousScheduleRuntimeProbe(): void {
  defaultContinuousScheduleRuntimeProbe.reset();
}

export function resetContinuousScheduleRuntimeProbeForFocus(): void {
  defaultContinuousScheduleRuntimeProbe.resetForFocus();
}

export function invalidateContinuousScheduleRuntimeAfterReadyFailure(
  cause: unknown,
): never {
  return defaultContinuousScheduleRuntimeProbe.invalidateAfterReadyFailure(cause);
}
