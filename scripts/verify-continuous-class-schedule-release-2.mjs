import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

function text(value) { return typeof value === "string" ? value.trim() : ""; }
function env(source) { return Object.fromEntries(source.split(/\r?\n/).filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")]; })); }

async function main() {
  const values = env(await readFile(".env.local", "utf8"));
  const token = text(process.env.CONTINUOUS_SCHEDULE_ADMIN_ACCESS_TOKEN);
  if (!values.NEXT_PUBLIC_SUPABASE_URL || !values.NEXT_PUBLIC_SUPABASE_ANON_KEY || !token) throw new Error("Authenticated admin credentials are required.");
  const client = createClient(values.NEXT_PUBLIC_SUPABASE_URL, values.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const [{ data: runtime, error: runtimeError }, { data: classes, error: classesError }] = await Promise.all([
    client.rpc("continuous_class_schedule_runtime_version"),
    client.from("classes").select("id,schedule_storage_mode,schedule_revision"),
  ]);
  if (runtimeError) throw runtimeError;
  if (classesError) throw classesError;
  const rows = Array.isArray(classes) ? classes : [];
  process.stdout.write(`${JSON.stringify({ runtimeVersion: runtime, classCounts: rows.reduce((counts, row) => ({ ...counts, [text(row.schedule_storage_mode) || "legacy"]: (counts[text(row.schedule_storage_mode) || "legacy"] || 0) + 1 }), {}) })}\n`);
}
main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Verification failed."}\n`); process.exitCode = 1; });
