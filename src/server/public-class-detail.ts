import process from "node:process";

import { unstable_cache } from "next/cache.js";

import type {
  PublicClassDetail,
  PublicClassItem,
  PublicProgressLog,
  PublicTextbook,
} from "../components/public/classes/types.ts";
import {
  PUBLIC_CLASSES_FULL_CACHE_TAG,
  PUBLIC_CLASSES_FULL_REVALIDATE_SECONDS,
  PUBLIC_CLASSES_SNAPSHOT_MAX_AGE_MS,
} from "./public-classes-cache.js";
import {
  applyPublicClassesQuerySafety,
  createPublicClassesSupabaseClient,
  loadPublicClassesEnv,
  normalizePublicClassesFullPayload,
  PUBLIC_CLASSES_QUERY_TIMEOUT_MS,
  PUBLIC_CLASSES_FULL_CLASS_PROJECTION,
  PUBLIC_CLASSES_FULL_PROGRESS_PROJECTION,
  PUBLIC_CLASSES_FULL_TEXTBOOK_PROJECTION,
} from "./public-classes-payload.js";

const PUBLIC_CLASS_DETAIL_CACHE_KEY = "public-class-detail-v2";
const PUBLIC_CLASS_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type QueryResult = { data: unknown; error: unknown };
type Query = PromiseLike<QueryResult> & {
  abortSignal(signal: AbortSignal): Query;
  retry(value: boolean): Query;
  eq(column: string, value: string): Query;
  in(column: string, values: string[]): Query;
  maybeSingle(): Query;
};
type PublicClassesClient = {
  from(table: string): { select(columns: string): Query };
};

type PublicClassDetailLoadResult =
  | { status: "success"; detail: PublicClassDetail }
  | { status: "not-found" }
  | { status: "unavailable" };

type PublicClassLookup =
  | { status: "public"; detail: PublicClassDetail }
  | { status: "absent" };

type DetailLoaderOptions = {
  loadLive?: (classId: string) => Promise<PublicClassDetail>;
  now?: () => number;
  cache?: typeof unstable_cache;
};

type QueryDetailOptions = {
  env?: NodeJS.ProcessEnv;
  supabaseClient?: PublicClassesClient | null;
  now?: () => Date;
};

export class PublicClassNotFoundError extends Error {
  readonly code = "public_class_not_found";

  constructor() {
    super("public_class_not_found");
    this.name = "PublicClassNotFoundError";
  }
}

export class PublicClassUnavailableError extends Error {
  readonly code = "public_class_unavailable";

  constructor() {
    super("public_class_unavailable");
    this.name = "PublicClassUnavailableError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isPublicClassId(value: string): boolean {
  return PUBLIC_CLASS_ID_PATTERN.test(value);
}

function isNotFound(error: unknown): boolean {
  return error instanceof PublicClassNotFoundError ||
    (isRecord(error) && error.code === "public_class_not_found");
}

function rawGeneratedAt(payload: unknown): string | null {
  return isRecord(payload) && typeof payload.generatedAt === "string"
    ? payload.generatedAt
    : null;
}

function classifyCachedDetail(
  detail: PublicClassDetail,
  now: () => number,
): PublicClassDetail | null {
  const age = now() - Date.parse(detail.generatedAt);
  if (!Number.isFinite(age) || age < 0 || age > PUBLIC_CLASSES_SNAPSHOT_MAX_AGE_MS) {
    return null;
  }
  return {
    ...detail,
    availability: age <= PUBLIC_CLASSES_FULL_REVALIDATE_SECONDS * 1_000
      ? "live"
      : "snapshot",
  };
}

function collectTextbookIds(
  classItem: PublicClassItem,
  progressLogs: PublicProgressLog[],
): Set<string> {
  const ids = new Set(classItem.textbookIds || []);
  classItem.schedulePlan?.textbooks.forEach((entry) => {
    if (entry.textbookId) ids.add(entry.textbookId);
  });
  classItem.schedulePlan?.sessions.forEach((session) => {
    session.textbookEntries?.forEach((entry) => {
      if (entry.textbookId) ids.add(entry.textbookId);
    });
  });
  progressLogs.forEach((log) => {
    if (log.textbookId) ids.add(log.textbookId);
  });
  return ids;
}

export function normalizePublicClassDetail(
  payload: unknown,
  classId: string,
  availability: "live" | "snapshot",
): PublicClassDetail | null {
  const generatedAt = rawGeneratedAt(payload);
  if (!generatedAt) return null;
  const normalized = normalizePublicClassesFullPayload(payload);
  if (!normalized) return null;

  const classItem = (normalized.classes as PublicClassItem[])
    .find((item) => item.id === classId);
  if (!classItem) return null;

  const progressLogs = (normalized.progressLogs as PublicProgressLog[])
    .filter((log) => log.classId === classId);
  const textbookIds = collectTextbookIds(classItem, progressLogs);
  const textbooks = (normalized.textbooks as PublicTextbook[])
    .filter((book) => textbookIds.has(book.id));

  return { classItem, textbooks, progressLogs, generatedAt, availability };
}

async function execute(query: Query, signal: AbortSignal): Promise<QueryResult> {
  return applyPublicClassesQuerySafety(query, signal) as Promise<QueryResult>;
}

export async function queryPublicClassDetail(
  classId: string,
  {
    env = process.env,
    supabaseClient = null,
    now = () => new Date(),
  }: QueryDetailOptions = {},
): Promise<PublicClassDetail> {
  if (!isPublicClassId(classId)) throw new PublicClassNotFoundError();
  await loadPublicClassesEnv(env);
  const supabase = supabaseClient ||
    (createPublicClassesSupabaseClient(env) as unknown as PublicClassesClient | null);
  if (!supabase) throw new PublicClassUnavailableError();
  const signal = AbortSignal.timeout(PUBLIC_CLASSES_QUERY_TIMEOUT_MS);

  try {
    const classQuery = supabase
      .from("classes")
      .select(PUBLIC_CLASSES_FULL_CLASS_PROJECTION)
      .eq("id", classId)
      .maybeSingle();
    const classResult = await execute(classQuery, signal);
    if (classResult.error) throw new PublicClassUnavailableError();
    if (!isRecord(classResult.data)) throw new PublicClassNotFoundError();

    const classOnlyPayload = {
      generatedAt: now().toISOString(),
      source: "supabase",
      classes: [classResult.data],
      textbooks: [],
      progressLogs: [],
    };
    const classOnlyDetail = normalizePublicClassDetail(classOnlyPayload, classId, "live");
    if (!classOnlyDetail) throw new PublicClassNotFoundError();

    const progressQuery = supabase
      .from("progress_logs")
      .select(PUBLIC_CLASSES_FULL_PROGRESS_PROJECTION)
      .eq("class_id", classId);
    const progressResult = await execute(progressQuery, signal);
    if (progressResult.error || !Array.isArray(progressResult.data)) {
      throw new PublicClassUnavailableError();
    }

    const progressPayload = {
      ...classOnlyPayload,
      progressLogs: progressResult.data,
    };
    const progressDetail = normalizePublicClassDetail(progressPayload, classId, "live");
    if (!progressDetail) throw new PublicClassUnavailableError();
    const textbookIds = [...collectTextbookIds(
      progressDetail.classItem,
      progressDetail.progressLogs,
    )];

    let textbookRows: unknown[] = [];
    if (textbookIds.length) {
      const textbookQuery = supabase
        .from("textbooks")
        .select(PUBLIC_CLASSES_FULL_TEXTBOOK_PROJECTION)
        .in("id", textbookIds);
      const textbookResult = await execute(textbookQuery, signal);
      if (textbookResult.error || !Array.isArray(textbookResult.data)) {
        throw new PublicClassUnavailableError();
      }
      textbookRows = textbookResult.data;
    }

    const detail = normalizePublicClassDetail({
      ...progressPayload,
      textbooks: textbookRows,
    }, classId, "live");
    if (!detail) throw new PublicClassUnavailableError();
    return detail;
  } catch (error) {
    if (isNotFound(error)) throw error;
    throw new PublicClassUnavailableError();
  }
}

export function createPublicClassDetailLoader({
  loadLive = queryPublicClassDetail,
  now = () => Date.now(),
  cache = unstable_cache,
}: DetailLoaderOptions = {}) {
  const loadCached = cache(
    async (classId: string): Promise<PublicClassLookup> => {
      try {
        return { status: "public", detail: await loadLive(classId) };
      } catch (error) {
        // Absence is a successful database lookup, not a provider failure.
        // Returning it lets Next's background revalidation replace an old
        // public detail. Throwing would preserve that obsolete success.
        if (isNotFound(error)) return { status: "absent" };
        throw error;
      }
    },
    [PUBLIC_CLASS_DETAIL_CACHE_KEY],
    {
      revalidate: PUBLIC_CLASSES_FULL_REVALIDATE_SECONDS,
      tags: [PUBLIC_CLASSES_FULL_CACHE_TAG],
    },
  );

  return async function loadDetail(classId: string): Promise<PublicClassDetailLoadResult> {
    if (!isPublicClassId(classId)) return { status: "not-found" };
    try {
      const lookup = await loadCached(classId);
      // Keep authoritative absence ahead of every snapshot fallback, including
      // later requests where a transient refresh failure retains this entry.
      // Only lookup data is cached; the HTTP 404 remains no-store below.
      if (lookup.status === "absent") return { status: "not-found" };
      const detail = classifyCachedDetail(lookup.detail, now);
      if (detail) return { status: "success", detail };
    } catch {
      // Provider failures are never cached. Only an existing public lookup can
      // serve a bounded snapshot above: after cache eviction, a static file
      // could resurrect a class whose authoritative absence was discarded.
    }
    return { status: "unavailable" };
  };
}

const loadDefaultPublicClassDetail = createPublicClassDetailLoader();

export async function loadPublicClassDetail(
  classId: string,
): Promise<PublicClassDetailLoadResult> {
  return loadDefaultPublicClassDetail(classId);
}

export function createPublicClassDetailResponder(
  loadDetail = loadPublicClassDetail,
) {
  return async function respond(classId: string) {
    const result = await loadDetail(classId);
    if (result.status === "success") {
      return {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": result.detail.availability === "live"
            ? "public, max-age=0, s-maxage=600"
            : "no-store",
        },
        body: JSON.stringify(result.detail),
      };
    }
    return {
      status: result.status === "not-found" ? 404 : 503,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        error: result.status === "not-found"
          ? "public_class_not_found"
          : "public_class_unavailable",
      }),
    };
  };
}
