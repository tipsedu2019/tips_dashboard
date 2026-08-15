import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

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
  "id,name,subject,grade,teacher,room,schedule,status,fee,capacity,student_ids,waitlist_ids,textbook_ids,textbook_info,lessons,schedule_plan,start_date,end_date";
export const PUBLIC_CLASSES_FULL_TEXTBOOK_PROJECTION =
  "id,title,name,publisher,price,tags,lessons,updated_at";
export const PUBLIC_CLASSES_FULL_PROGRESS_PROJECTION =
  "id,class_id,textbook_id,progress_key,session_id,session_order,status,range_start,range_end,range_label,public_note,teacher_note,updated_at,date";

export function applyPublicClassesQuerySafety(query) {
  return query
    .abortSignal(AbortSignal.timeout(PUBLIC_CLASSES_QUERY_TIMEOUT_MS))
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

export function createPublicClassesSupabaseClient(env = process.env) {
  const url = String(
    env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL || "",
  ).trim();
  const apiKey = String(
    env.SUPABASE_SERVICE_ROLE_KEY ||
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      env.VITE_SUPABASE_ANON_KEY ||
      "",
  ).trim();

  if (!url || !apiKey) {
    return null;
  }

  return createClient(url, apiKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getClassStatus(row) {
  return (
    normalizeClassStatus(row?.status) ||
    computeClassStatus({
      status: row?.status,
      start_date: row?.start_date,
      end_date: row?.end_date,
    })
  );
}

function mapPublicClass(row) {
  const normalizedStatus = getClassStatus(row);
  const fee = Number(row.fee || 0);
  return {
    id: row.id,
    name: row.name || "",
    className: row.name || "",
    subject: row.subject || "",
    grade: row.grade || "",
    teacher: row.teacher || "",
    room: row.room || "",
    classroom: row.room || "",
    schedule: row.schedule || "",
    status: normalizedStatus,
    fee,
    tuition: fee,
    capacity: Number(row.capacity || 0),
    studentIds: Array.isArray(row.student_ids) ? row.student_ids : [],
    waitlistIds: Array.isArray(row.waitlist_ids) ? row.waitlist_ids : [],
    textbookIds: Array.isArray(row.textbook_ids) ? row.textbook_ids : [],
    textbookInfo: row.textbook_info || null,
    lessons: Array.isArray(row.lessons) ? row.lessons : [],
    schedulePlan: row.schedule_plan || null,
    schedule_plan: row.schedule_plan || null,
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    start_date: row.start_date || "",
    end_date: row.end_date || "",
  };
}

function mapPublicClassSummary(row) {
  const normalizedStatus = getClassStatus(row);
  const fee = Number(row.fee || 0);
  return {
    id: row.id,
    name: row.name || "",
    className: row.name || "",
    subject: row.subject || "",
    grade: row.grade || "",
    teacher: row.teacher || "",
    room: row.room || "",
    classroom: row.room || "",
    schedule: row.schedule || "",
    status: normalizedStatus,
    fee,
    tuition: fee,
    capacity: Number(row.capacity || 0),
    studentIds: Array.isArray(row.student_ids) ? row.student_ids : [],
    waitlistIds: Array.isArray(row.waitlist_ids) ? row.waitlist_ids : [],
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
    classes: payload.classes
      .map(mapPublicClassSummary)
      .filter((row) => row.status === ACTIVE_CLASS_STATUS),
    textbooks: [],
    progressLogs: [],
  };
}

function mapPublicTextbook(row) {
  return {
    id: row.id,
    title: row.title || row.name || "",
    publisher: row.publisher || "",
    price: Number(row.price || 0),
    tags: Array.isArray(row.tags) ? row.tags : [],
    lessons: Array.isArray(row.lessons) ? row.lessons : [],
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

function mapPublicProgressLog(row) {
  const completedLessonIds = Array.isArray(row.completed_lesson_ids)
    ? row.completed_lesson_ids
    : [];

  return {
    id: row.id,
    classId: row.class_id || "",
    textbookId: row.textbook_id || "",
    progressKey: row.progress_key || "",
    sessionId: row.session_id || "",
    sessionOrder: Number(row.session_order || 0),
    status: row.status || "pending",
    rangeStart: row.range_start || "",
    rangeEnd: row.range_end || "",
    rangeLabel: row.range_label || "",
    publicNote: row.public_note || "",
    teacherNote: row.teacher_note || "",
    updatedAt: row.updated_at || row.date || null,
    completedLessonIds,
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
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
