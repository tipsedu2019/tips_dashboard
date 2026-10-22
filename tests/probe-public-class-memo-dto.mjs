import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createManagementReadService } from "../src/features/management/management-service.js";
import { normalizePublicClassesFullPayload, normalizePublicClassesSummaryPayload } from "../src/server/public-classes-payload.js";

const url = new URL(process.env.TASK_LOCAL_DB_URL || "https://invalid.invalid");
assert.equal(url.hostname, "127.0.0.1");
assert.match(process.env.TASK_LOCAL_DB_NONCE || "", /^[a-f0-9]{32}$/);
const config = await readFile("supabase/config.toml", "utf8");
const project = config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]+)"/m)?.[1];
assert.ok(project);
assert.ok(config.includes(`[db]\nport = ${url.port}\n`));
const fixture = await readFile("supabase/tests/class_public_memo_test.sql", "utf8");
const capture = `
select set_config('request.jwt.claim.sub',pg_temp.memo_id(900)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.memo_id(900),'role','authenticated')::text,true);
set local role authenticated;
select public.update_class_operational_v1(pg_temp.memo_id(1),'{"status":"수강","public_memo":"공개 안내 ✨ <script>plain text</script>"}',pg_temp.memo_id(108),null);
select jsonb_build_object('dto',public.get_management_detail_v1('classes',pg_temp.memo_id(1)), 'row',(select to_jsonb(c) from public.classes c where id=pg_temp.memo_id(1)));
select * from finish();`;
const source = fixture.replace("begin;", "begin;\ncreate extension if not exists pgtap with schema extensions;\nset local search_path=public,extensions;").replace("select * from finish();", capture);
const child = spawn("docker", ["exec", "-i", `supabase_db_${project}`, "psql", "-XqAt", "--set", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "pipe", "pipe"] });
const output = [], errors = [];
child.stdout.on("data", chunk => output.push(chunk));
child.stderr.on("data", chunk => errors.push(chunk));
const completed = new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
child.stdin.end(source);
assert.equal(await completed, 0, Buffer.concat(errors).toString());
const stdout = Buffer.concat(output).toString();
assert.doesNotMatch(stdout, /(?:^|\n)not ok \d+/);
const wire = JSON.parse(stdout.split("\n").findLast(line => line.startsWith('{"dto"')));
const service = createManagementReadService({ supabase: { rpc(name) {
  assert.equal(name, "get_management_detail_v1");
  return { abortSignal() { return this; }, retry() { return Promise.resolve({ data: wire.dto, error: null }); } };
} } });
const detail = await service.loadDetail({ kind: "classes", id: wire.row.id });
assert.equal(detail.record.publicMemo, wire.row.public_memo);
assert.equal(detail.schedule.plan.sessions[0].memo, "PRIVATE", "private detail still retains its own notes");
const raw = { source: "supabase", generatedAt: new Date().toISOString(), classes: [wire.row], textbooks: [], progressLogs: [] };
for (const normalize of [normalizePublicClassesSummaryPayload, normalizePublicClassesFullPayload]) {
  const data = normalize(raw);
  assert.equal(data.classes.length, 1);
  assert.equal(data.classes[0].publicMemo, "공개 안내 ✨ <script>plain text</script>");
  assert.equal(data.classes[0].schedule, wire.row.schedule);
  assert.equal(JSON.stringify(data).includes("PRIVATE"), false);
  assert.deepEqual(normalize(data), data);
}
console.log(JSON.stringify({ status: "passed", actualSqlDtoConsumed: true, classRows: 1, privateMemoPreserved: true, publicBoundaries: ["summary", "full", "cached"] }));
