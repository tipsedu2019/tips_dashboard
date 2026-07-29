import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function text(value) { return typeof value === "string" ? value.trim() : ""; }
function env(source) { return Object.fromEntries(source.split(/\r?\n/).filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")]; })); }

export function parseContinuousScheduleVerifyArgs(argv) {
  const args = [...argv];
  if (args.length === 0) return null;
  const read = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? "" : text(args[index + 1]);
  };
  const classId = read("--class-id");
  const expectedSourceHash = read("--expected-source-hash");
  if (!UUID.test(classId) || !expectedSourceHash) {
    throw new Error("Valid --class-id and --expected-source-hash are required.");
  }
  if (args.length !== 4) throw new Error("Unexpected verification arguments.");
  return { classId, expectedSourceHash };
}

export async function verifyContinuousScheduleShadow(gateway, input) {
  return gateway.verify({
    p_class_id: input.classId,
    p_expected_source_hash: input.expectedSourceHash,
  });
}

async function main() {
  const input = parseContinuousScheduleVerifyArgs(process.argv.slice(2));
  const values = env(await readFile(".env.local", "utf8"));
  const token = text(process.env.CONTINUOUS_SCHEDULE_ADMIN_ACCESS_TOKEN);
  if (!values.NEXT_PUBLIC_SUPABASE_URL || !values.NEXT_PUBLIC_SUPABASE_ANON_KEY || !token) throw new Error("Authenticated admin credentials are required.");
  const client = createClient(values.NEXT_PUBLIC_SUPABASE_URL, values.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const verification = input
    ? await verifyContinuousScheduleShadow({
        async verify(parameters) {
          const { data, error } = await client.rpc("verify_class_schedule_shadow_v1", parameters);
          if (error) throw error;
          return data && typeof data === "object" ? data : {};
        },
      }, input)
    : null;
  const [{ data: runtime, error: runtimeError }, { data: classes, error: classesError }] = await Promise.all([
    client.rpc("continuous_class_schedule_runtime_version"),
    client.from("classes").select("id,schedule_storage_mode,schedule_revision"),
  ]);
  if (runtimeError) throw runtimeError;
  if (classesError) throw classesError;
  const rows = Array.isArray(classes) ? classes : [];
  process.stdout.write(`${JSON.stringify({
    runtimeVersion: runtime,
    classCounts: rows.reduce((counts, row) => ({ ...counts, [text(row.schedule_storage_mode) || "legacy"]: (counts[text(row.schedule_storage_mode) || "legacy"] || 0) + 1 }), {}),
    ...(input ? { classId: input.classId, verification } : {}),
  })}\n`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Verification failed."}\n`); process.exitCode = 1; });
}
