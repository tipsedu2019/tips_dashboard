import { lstat, mkdir, open, rename, rm, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function validTime(value) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }
function compatible(before, after) {
  return before?.projectRef === after?.projectRef
    && before?.environment?.postgresVersion === after?.environment?.postgresVersion
    && before?.environment?.databaseStatsReset === after?.environment?.databaseStatsReset
    && before?.environment?.statementsStatsReset === after?.environment?.statementsStatsReset
    && JSON.stringify(before?.environment?.extensions) === JSON.stringify(after?.environment?.extensions);
}
function validCapture(capture) {
  const start = validTime(capture?.clientStartedAt); const end = validTime(capture?.clientEndedAt); const dbStart = validTime(capture?.bracket?.startedAt); const dbEnd = validTime(capture?.bracket?.endedAt);
  return [start, end, dbStart, dbEnd].every((value) => value !== null) && start <= dbStart && dbStart <= dbEnd && dbEnd <= end;
}

const DATABASE_COUNTERS = ["xact_commit", "xact_rollback", "temp_files", "temp_bytes", "deadlocks"];
function databaseActivity(before, after) {
  const first = before.sections?.database?.rows?.[0];
  const last = after.sections?.database?.rows?.[0];
  const unknown = (reason) => ({ status: "unknown", reason });
  if (!before.sections?.database?.available || !after.sections?.database?.available
    || validTime(first?.postmaster_started_at) === null || validTime(last?.postmaster_started_at) === null) return unknown("database_counters_missing");
  if (first.postmaster_started_at !== last.postmaster_started_at) return unknown("postgres_restarted");
  const start = validTime(first.captured_at); const end = validTime(last.captured_at);
  if (start === null || end === null || end <= start
    || start < validTime(before.bracket.startedAt) || start > validTime(before.bracket.endedAt)
    || end < validTime(after.bracket.startedAt) || end > validTime(after.bracket.endedAt)) return unknown("database_sample_time_invalid");
  const elapsedSeconds = (end - start) / 1000;
  const deltas = {}; const perSecond = {};
  for (const key of DATABASE_COUNTERS) {
    const validCounter = (value) => (typeof value === "number" || (typeof value === "string" && /^\d+$/u.test(value)))
      && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
    if (!validCounter(first[key]) || !validCounter(last[key])) return unknown("database_counter_missing_or_imprecise");
    if (Number(last[key]) < Number(first[key])) return unknown("database_counter_decreased");
    deltas[key] = Number(last[key]) - Number(first[key]);
    perSecond[key] = deltas[key] / elapsedSeconds;
  }
  return { status: "available", elapsedSeconds, deltas, perSecond };
}

export function compareResourceEvidence(before, after) {
  if (!validCapture(before) || !validCapture(after) || validTime(before.clientEndedAt) > validTime(after.clientStartedAt)) return { status: "unknown", reason: "capture_interval_invalid" };
  if (!compatible(before, after)) return { status: "unknown", reason: "environment_or_counter_reset_drift" };
  return { status: "comparable", observedFrom: before.clientEndedAt, observedTo: after.clientStartedAt, databaseActivity: databaseActivity(before, after) };
}

export async function writeExclusiveJson(path, value) {
  if (!isAbsolute(path)) throw new Error("resource_evidence_output_path_invalid");
  try { await lstat(path); throw new Error("resource_evidence_output_exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  await mkdir(dirname(path), { recursive: true });
  const temp = `${resolve(path)}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temp, "wx", 0o600); await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); await handle.close(); handle = undefined;
    try { await lstat(path); throw new Error("resource_evidence_output_exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    await rename(temp, path);
  } catch (error) { await handle?.close().catch(() => {}); await rm(temp, { force: true }); throw error; }
}

export async function compareResourceEvidenceCli({ argv = process.argv.slice(2), env = process.env } = {}) {
  const read = (flag) => { const index = argv.indexOf(flag); return index < 0 ? undefined : argv[index + 1]; };
  const beforePath = read("--before") || env.TASK_EVIDENCE_BEFORE; const afterPath = read("--after") || env.TASK_EVIDENCE_AFTER; const output = read("--output") || env.TASK_EVIDENCE_COMPARISON_OUTPUT;
  if (![beforePath, afterPath, output].every(isAbsolute)) throw new Error("resource_evidence_output_path_invalid");
  const result = compareResourceEvidence(JSON.parse(await readFile(beforePath, "utf8")), JSON.parse(await readFile(afterPath, "utf8")));
  await writeExclusiveJson(output, result); return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) compareResourceEvidenceCli().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
