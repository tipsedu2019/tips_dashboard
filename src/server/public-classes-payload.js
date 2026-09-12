import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { createPublicClassesDiagnosticFetch, reportPublicClassesFailure } from "./public-classes-diagnostics.js";
import { publicClassSchedule, publicLessons } from "../lib/public-class-schedule.js";

import {
  ACTIVE_CLASS_STATUS,
  computeClassStatus,
  normalizeClassStatus,
} from "../lib/class-status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "../..");

export const PUBLIC_CLASSES_QUERY_TIMEOUT_MS = 8_000;
export const PUBLIC_CLASSES_SUMMARY_PROJECTION =
  "id,name,subject,grade,teacher,room,schedule,status,fee,capacity,student_ids,waitlist_ids,start_date,end_date";
export const PUBLIC_CLASSES_FULL_CLASS_PROJECTION =
  "id,name,subject,grade,teacher,room,schedule,status,fee,capacity,student_ids,waitlist_ids,textbook_ids,lessons,schedule_plan,start_date,end_date";
export const PUBLIC_CLASSES_FULL_TEXTBOOK_PROJECTION =
  "id,title,name,publisher,price,tags,lessons,updated_at";
export const PUBLIC_CLASSES_FULL_PROGRESS_PROJECTION =
  "id,class_id,textbook_id,progress_key,session_id,session_order,status,range_start,range_end,range_label,public_note,updated_at,date";

export function applyPublicClassesQuerySafety(
  query,
  signal = AbortSignal.timeout(PUBLIC_CLASSES_QUERY_TIMEOUT_MS),
) {
  return query
    .abortSignal(signal)
    .retry(false);
}

export function normalizePublicClassesFailure() {
  return "Public class data is temporarily unavailable.";
}

export const publicClassesOutputPath = path.join(
  appRoot,
  "public",
  "data",
  "public-classes.json",
);

async function importEnvFile(filePath, env = process.env) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex < 1) {
        return;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (!env[key]) {
        env[key] = value;
      }
    });
  } catch {
    // Ignore missing env files.
  }
}

export async function loadPublicClassesEnv(env = process.env) {
  await Promise.all([
    importEnvFile(path.join(appRoot, ".env"), env),
    importEnvFile(path.join(appRoot, ".env.local"), env),
    importEnvFile(path.join(appRoot, ".env.supabase.local"), env),
  ]);
}

export function buildFallbackPublicClassesPayload(reason) {
  return {
    generatedAt: new Date().toISOString(),
    source: "fallback-empty",
    reason,
    classes: [],
    textbooks: [],
    progressLogs: [],
  };
}

export function isFallbackPublicClassesPayload(payload) {
  return payload?.source !== "supabase";
}

export function createPublicClassesSupabaseClient(env = process.env, {
  fetch: fetchImpl = globalThis.fetch,
  onFailure = reportPublicClassesFailure,
} = {}) {
  const url = String(
    env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || "",
  ).trim();
  const apiKey = String(
    env.SUPABASE_SERVICE_ROLE_KEY ||
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      env.VITE_SUPABASE_ANON_KEY ||
      "",
  ).trim();

  const diagnosticFetch = createPublicClassesDiagnosticFetch(fetchImpl, onFailure);
  if (!url || !apiKey) {
    diagnosticFetch.unconfigured();
    return null;
  }

  try {
    return createClient(url, apiKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: { fetch: diagnosticFetch.fetch },
    });
  } catch {
    diagnosticFetch.unconfigured();
    return null;
  }
}

function getClassStatus(row) {
  return (
    normalizeClassStatus(row?.status) ||
    computeClassStatus({
      status: row?.status,
      start_date: row?.start_date ?? row?.startDate,
      end_date: row?.end_date ?? row?.endDate,
    })
  );
}

function text(value) {
  return typeof value === "string" ? value : "";
}

function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function records(value) {
  return Array.isArray(value)
    ? value.filter((row) => row !== null && typeof row === "object" && !Array.isArray(row))
    : [];
}

function number(value) {
  const result = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(result) ? result : 0;
}

function count(row, field, camel, snake) {
  if (Number.isSafeInteger(row[field]) && row[field] >= 0) return row[field];
  return strings(row[snake] ?? row[camel]).length;
}

function mapPublicClassSummary(row) {
  const fee = number(row.fee ?? row.tuition);
  const name = text(row.name) || text(row.className);
  const room = text(row.room) || text(row.classroom);
  return {
    id: text(row.id),
    name,
    className: name,
    subject: text(row.subject),
    grade: text(row.grade),
    teacher: text(row.teacher),
    room,
    classroom: room,
    schedule: text(row.schedule),
    status: getClassStatus(row),
    fee,
    tuition: fee,
    capacity: number(row.capacity),
    enrolledCount: count(row, "enrolledCount", "studentIds", "student_ids"),
    waitlistCount: count(row, "waitlistCount", "waitlistIds", "waitlist_ids"),
  };
}

function mapPublicClass(row) {
  return {
    ...mapPublicClassSummary(row),
    textbookIds: strings(row.textbook_ids ?? row.textbookIds),
    lessons: publicLessons(row.lessons),
    schedulePlan: publicClassSchedule(row.schedule_plan ?? row.schedulePlan),
    startDate: text(row.start_date ?? row.startDate),
    endDate: text(row.end_date ?? row.endDate),
  };
}

export function normalizePublicClassesSummaryPayload(payload) {
  if (!payload || typeof payload !== "object" || isFallbackPublicClassesPayload(payload)) {
    return null;
  }
  if (!Array.isArray(payload.classes)) return null;

  return {
    generatedAt: typeof payload.generatedAt === "string"
      ? payload.generatedAt
      : new Date().toISOString(),
    source: payload.source,
    classes: records(payload.classes)
      .map(mapPublicClassSummary)
      .filter((row) => row.status === ACTIVE_CLASS_STATUS),
    textbooks: [],
    progressLogs: [],
  };
}

export function normalizePublicClassesFullPayload(payload) {
  if (!payload || typeof payload !== "object" || isFallbackPublicClassesPayload(payload)) {
    return null;
  }
  if (
    !Array.isArray(payload.classes) ||
    !Array.isArray(payload.textbooks) ||
    !Array.isArray(payload.progressLogs)
  ) {
    return null;
  }

  return {
    generatedAt: typeof payload.generatedAt === "string"
      ? payload.generatedAt
      : new Date().toISOString(),
    source: "supabase",
    classes: records(payload.classes).map(mapPublicClass).filter((row) => row.status === ACTIVE_CLASS_STATUS),
    textbooks: records(payload.textbooks).map(mapPublicTextbook),
    progressLogs: records(payload.progressLogs).map(mapPublicProgressLog),
  };
}

function mapPublicTextbook(row) {
  return {
    id: text(row.id),
    title: text(row.title) || text(row.name),
    publisher: text(row.publisher),
    price: number(row.price),
    tags: strings(row.tags),
    lessons: publicLessons(row.lessons),
    updatedAt: text(row.updated_at ?? row.updatedAt) || null,
  };
}

function mapPublicProgressLog(row) {
  return {
    id: text(row.id),
    classId: text(row.class_id ?? row.classId),
    textbookId: text(row.textbook_id ?? row.textbookId),
    progressKey: text(row.progress_key ?? row.progressKey),
    sessionId: text(row.session_id ?? row.sessionId),
    sessionOrder: number(row.session_order ?? row.sessionOrder),
    status: text(row.status) || "pending",
    rangeStart: text(row.range_start ?? row.rangeStart),
    rangeEnd: text(row.range_end ?? row.rangeEnd),
    rangeLabel: text(row.range_label ?? row.rangeLabel),
    publicNote: text(row.public_note ?? row.publicNote),
    updatedAt: text(row.updated_at ?? row.updatedAt ?? row.date) || null,
    completedLessonIds: strings(row.completed_lesson_ids ?? row.completedLessonIds),
  };
}

export async function buildPublicClassesPayload({
  env = process.env,
  supabaseClient = null,
  mode = "full",
} = {}) {
  await loadPublicClassesEnv(env);

  const supabase = supabaseClient || createPublicClassesSupabaseClient(env);
  if (!supabase) {
    return buildFallbackPublicClassesPayload(
      "Supabase environment variables are missing.",
    );
  }

  try {
    if (mode === "summary") {
      const { data: classRows, error: classError } = await applyPublicClassesQuerySafety(
        supabase
          .from("classes")
          .select(PUBLIC_CLASSES_SUMMARY_PROJECTION),
      );

      if (classError) {
        throw classError;
      }

      return {
        generatedAt: new Date().toISOString(),
        source: "supabase",
        classes: (classRows || [])
          .map(mapPublicClassSummary)
          .filter((row) => row.status === ACTIVE_CLASS_STATUS),
        textbooks: [],
        progressLogs: [],
      };
    }

    const [
      { data: classRows, error: classError },
      { data: textbookRows, error: textbookError },
      { data: progressRows, error: progressError },
    ] = await Promise.all([
      applyPublicClassesQuerySafety(
        supabase.from("classes").select(PUBLIC_CLASSES_FULL_CLASS_PROJECTION),
      ),
      applyPublicClassesQuerySafety(
        supabase.from("textbooks").select(PUBLIC_CLASSES_FULL_TEXTBOOK_PROJECTION),
      ),
      applyPublicClassesQuerySafety(
        supabase.from("progress_logs").select(PUBLIC_CLASSES_FULL_PROGRESS_PROJECTION),
      ),
    ]);

    if (classError) {
      throw classError;
    }
    if (textbookError) {
      throw textbookError;
    }
    if (progressError) {
      throw progressError;
    }

    const classes = (classRows || [])
      .map(mapPublicClass)
      .filter((row) => row.status === ACTIVE_CLASS_STATUS);

    const classIdSet = new Set(classes.map((row) => row.id));
    const textbookIdSet = new Set(
      classes.flatMap((row) =>
        Array.isArray(row.textbookIds) ? row.textbookIds : [],
      ),
    );

    const progressLogs = (progressRows || [])
      .map(mapPublicProgressLog)
      .filter((row) => classIdSet.has(row.classId));

    progressLogs.forEach((row) => {
      if (row.textbookId) {
        textbookIdSet.add(row.textbookId);
      }
    });

    const textbooks = (textbookRows || [])
      .map(mapPublicTextbook)
      .filter((row) => textbookIdSet.has(row.id));

    return {
      generatedAt: new Date().toISOString(),
      source: "supabase",
      classes,
      textbooks,
      progressLogs,
    };
  } catch (error) {
    return buildFallbackPublicClassesPayload(
      normalizePublicClassesFailure(error),
    );
  }
}

export async function writePublicClassesPayload(
  payload,
  outputPath = publicClassesOutputPath,
) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(normalizePublicClassesFullPayload(payload) || buildFallbackPublicClassesPayload(normalizePublicClassesFailure()))}\n`, "utf8");
}
