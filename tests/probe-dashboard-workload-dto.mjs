import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import {
  buildWorkloadTeams,
  normalizeWorkloadPage,
  normalizeWorkloadSummary,
} from "../src/features/dashboard/workload-contract.ts"

// Only the isolated runner's disposable database is accepted. Reuse the pgTAP
// fixtures and the production consumer instead of inventing a matching JSON DTO.
const url = new URL(process.env.TASK_LOCAL_DB_URL || "https://invalid.invalid")
assert.equal(url.hostname, "127.0.0.1")
assert.match(process.env.TASK_LOCAL_DB_NONCE || "", /^[a-f0-9]{32}$/)
const config = await readFile("supabase/config.toml", "utf8")
const project = config.match(
  /^project_id = "(tips_supabase_db_qa_[a-f0-9]+)"/m,
)?.[1]
assert.ok(project)
assert.ok(config.includes(`[db]\nport = ${url.port}\n`))
const fixture = await readFile(
  "supabase/tests/dashboard_workload_test.sql",
  "utf8",
)
const marker =
  "select is((select count(*)::int from dashboard_private.dashboard_workload_items_v1())"
const end = fixture.indexOf(marker)
assert.ok(end > 0)
const start = fixture.indexOf("-- Synthetic read fixtures")
assert.ok(start > 0 && start < end)
const sql =
  "begin;\nset local statement_timeout = '30s';\n" +
  fixture.slice(start, end) +
  `
select jsonb_build_object(
  'summary', public.get_dashboard_workload_v1(),
  'page', public.list_dashboard_workload_page_v1('영어팀', null, null, null, false, 1, 20)
);
rollback;
`
const child = spawn(
  "docker",
  [
    "exec",
    "-i",
    `supabase_db_${project}`,
    "psql",
    "-XqAt",
    "--set",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
  ],
  { stdio: ["pipe", "pipe", "pipe"] },
)
const chunks = [],
  errors = []
child.stdout.on("data", (chunk) => chunks.push(chunk))
child.stderr.on("data", (chunk) => errors.push(chunk))
const completed = new Promise((resolve, reject) => {
  child.on("error", reject)
  child.on("close", resolve)
})
child.stdin.end(sql)
assert.equal(await completed, 0, Buffer.concat(errors).toString("utf8"))
const stdout = Buffer.concat(chunks).toString("utf8")
assert.doesNotMatch(stdout, /(?:^|\n)not ok \d+/)
const produced = JSON.parse(
  stdout.split("\n").findLast((line) => line.startsWith("{")),
)
const summary = normalizeWorkloadSummary(produced.summary)
const teams = buildWorkloadTeams(summary.groups)
const page = normalizeWorkloadPage(produced.page)
assert.equal(
  teams.reduce((sum, team) => sum + team.summary.total, 0),
  16,
)
assert.ok(
  teams.some((team) => team.owners.some((owner) => owner.ownerKey === "team")),
)
assert.equal(page.totalCount, 14)
assert.equal(page.rows.length, 14)
assert.equal(page.rows[0].workflow, "registration")
assert.equal(page.rows[0].title, "workload-registration · 영어")
assert.ok(
  Date.parse(page.rows[0].requestedAt) < Date.parse(page.rows[0].enteredAt),
)
assert.equal(new Set(page.rows.map((row) => row.ownerKey)).size, 2)
console.log(
  JSON.stringify({
    status: "passed",
    actualRowsConsumed: page.rows.length,
    workloadTotal: 16,
  }),
)
