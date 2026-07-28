import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { buildContinuousScheduleBackfillPreview, compareContinuousScheduleShadow } from "../src/features/academic/continuous-class-schedule-model.ts";
import { parseClassScheduleSlots } from "../src/features/management/class-schedule-slots.ts";

const USAGE = "Use --input <classes-export.json> or --live (--class-id <uuid> | --all --confirm-all-read).";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseEnvFile(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "")];
      }),
  );
}

export function parseContinuousSchedulePreviewArgs(argv) {
  const args = [...argv];
  const hasInput = args.includes("--input");
  const hasLive = args.includes("--live");
  const hasAll = args.includes("--all");
  const hasClassId = args.includes("--class-id");
  const hasConfirmAllRead = args.includes("--confirm-all-read");

  if (hasInput && hasLive) throw new Error("--input cannot be combined with --live.");
  if (!hasInput && !hasLive) throw new Error(`Provide --input or --live. ${USAGE}`);

  if (hasInput) {
    if (args.length !== 2 || args[0] !== "--input" || !text(args[1])) {
      throw new Error(`Invalid file preview arguments. ${USAGE}`);
    }
    return { mode: "file", inputPath: args[1] };
  }

  if (args[0] !== "--live") throw new Error(`Invalid live preview arguments. ${USAGE}`);
  if (hasAll === hasClassId) throw new Error(`Live preview requires exactly one of --class-id or --all. ${USAGE}`);

  if (hasAll) {
    if (!hasConfirmAllRead) throw new Error("--all requires --confirm-all-read.");
    if (args.length !== 3 || args[1] !== "--all" || args[2] !== "--confirm-all-read") {
      throw new Error(`Invalid all-class preview arguments. ${USAGE}`);
    }
    return { mode: "live", classId: "", all: true };
  }

  const classIdIndex = args.indexOf("--class-id");
  const classId = text(args[classIdIndex + 1]);
  if (args.length !== 3 || classIdIndex !== 1 || !UUID_PATTERN.test(classId)) {
    throw new Error(`--class-id must be a UUID. ${USAGE}`);
  }
  return { mode: "live", classId, all: false };
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function reportClass(row) {
  const classId = text(row?.id);
  const preview = buildContinuousScheduleBackfillPreview({
    classId,
    scheduleText: text(row?.schedule),
    defaultSlots: parseClassScheduleSlots(row?.schedule, row?.teacher, row?.room),
    schedulePlan: row?.schedule_plan,
  });
  const comparison = compareContinuousScheduleShadow(preview, {
    slots: rows(row?.shadow_slots),
    sessions: rows(row?.shadow_sessions),
  });

  return {
    classId: preview.classId,
    eligible: preview.eligible,
    counts: preview.counts,
    issueCodes: preview.issues.map((issue) => issue.code),
    shadowMatches: comparison.matches,
    shadowIssueCodes: comparison.issueCodes,
  };
}

export function buildContinuousSchedulePreviewReport(sourceRows) {
  const classes = rows(sourceRows)
    .map(reportClass)
    .sort((left, right) => left.classId.localeCompare(right.classId));
  const eligible = classes.filter((entry) => entry.eligible).length;
  const shadowMatches = classes.filter((entry) => entry.shadowMatches).length;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    totals: {
      classes: classes.length,
      eligible,
      blocked: classes.length - eligible,
      shadowMatches,
    },
    classes,
  };
}

async function readFileRows(inputPath) {
  const parsed = JSON.parse(await readFile(inputPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Input JSON must be an array of class rows.");
  return parsed;
}

async function readLiveRows(options) {
  const env = parseEnvFile(await readFile(".env.local", "utf8"));
  const url = text(env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = text(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) {
    throw new Error("Live preview requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  }

  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  let classQuery = client
    .from("classes")
    .select("id,schedule,teacher,room,schedule_plan,schedule_storage_mode");
  if (!options.all) classQuery = classQuery.eq("id", options.classId).limit(1);

  const classResult = await classQuery;
  if (classResult.error) throw classResult.error;
  const classRows = rows(classResult.data);
  const classIds = classRows.map((row) => text(row?.id)).filter(Boolean);
  if (classIds.length === 0) return [];

  const slotResult = await client
    .from("class_schedule_slots")
    .select("class_id,weekday,start_time,end_time")
    .in("class_id", classIds);
  if (slotResult.error) throw slotResult.error;

  const sessionResult = await client
    .from("class_lesson_sessions")
    .select("class_id,session_key,session_date,schedule_state")
    .in("class_id", classIds);
  if (sessionResult.error) throw sessionResult.error;

  const slotsByClassId = new Map();
  for (const slot of rows(slotResult.data)) {
    const classId = text(slot?.class_id);
    if (!slotsByClassId.has(classId)) slotsByClassId.set(classId, []);
    slotsByClassId.get(classId).push(slot);
  }
  const sessionsByClassId = new Map();
  for (const session of rows(sessionResult.data)) {
    const classId = text(session?.class_id);
    if (!sessionsByClassId.has(classId)) sessionsByClassId.set(classId, []);
    sessionsByClassId.get(classId).push(session);
  }

  return classRows.map((classRow) => {
    const classId = text(classRow?.id);
    return {
      ...classRow,
      shadow_slots: slotsByClassId.get(classId) || [],
      shadow_sessions: sessionsByClassId.get(classId) || [],
    };
  });
}

async function main() {
  const options = parseContinuousSchedulePreviewArgs(process.argv.slice(2));
  const sourceRows = options.mode === "file"
    ? await readFileRows(options.inputPath)
    : await readLiveRows(options);
  process.stdout.write(`${JSON.stringify(buildContinuousSchedulePreviewReport(sourceRows), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Preview failed."}\n`);
    process.exitCode = 1;
  });
}
