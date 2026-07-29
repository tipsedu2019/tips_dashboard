import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) { return typeof value === "string" ? value.trim() : ""; }

function env(source) {
  return Object.fromEntries(source.split(/\r?\n/).filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).map((line) => {
    const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
  }));
}

export function parseContinuousScheduleApplyArgs(argv) {
  const args = [...argv];
  const read = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? "" : text(args[index + 1]);
  };
  const classId = read("--class-id");
  const expectedSourceHash = read("--expected-source-hash");
  const requestKey = read("--request-key");
  if (!args.includes("--apply")) throw new Error("--apply is required.");
  if (!UUID.test(classId) || !UUID.test(requestKey) || !expectedSourceHash) throw new Error("Valid --class-id, --expected-source-hash, and --request-key are required.");
  if (read("--confirm-class-id") !== classId) throw new Error("--confirm-class-id must exactly match --class-id.");
  if (args.length !== 9) throw new Error("Unexpected apply arguments.");
  return { classId, expectedSourceHash, requestKey };
}

async function main() {
  const input = parseContinuousScheduleApplyArgs(process.argv.slice(2));
  const values = env(await readFile(".env.local", "utf8"));
  const url = text(values.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = text(values.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const accessToken = text(process.env.CONTINUOUS_SCHEDULE_ADMIN_ACCESS_TOKEN);
  if (!url || !anonKey || !accessToken) throw new Error("Authenticated admin credentials are required.");
  const client = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
  const { data, error } = await client.rpc("backfill_class_schedule_shadow_v1", {
    p_class_id: input.classId, p_expected_source_hash: input.expectedSourceHash, p_request_key: input.requestKey,
  });
  if (error) throw error;
  process.stdout.write(`${JSON.stringify({ classId: input.classId, applied: true, result: data && typeof data === "object" ? data : {} })}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Apply failed."}\n`); process.exitCode = 1; });
