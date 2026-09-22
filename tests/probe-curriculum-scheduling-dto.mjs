import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { createAcademicReadService } from "../src/features/academic/academic-read-service.js"

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
const fixture = await readFile("supabase/tests/curriculum_scheduling_textbook_usage_test.sql", "utf8")
const end = fixture.indexOf("reset role;\nselect ok(not has_function_privilege")
assert.ok(end > 0)
const sql = fixture.slice(0, end).replace("begin;", "begin;\ncreate extension if not exists pgtap with schema extensions;\nset local search_path=public,extensions;") + "\nselect data from result;\nrollback;\n"
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
const service = createAcademicReadService({ actorScope: "fixture:admin", supabase: {
  rpc(name) {
    assert.equal(name, "get_academic_curriculum_numbered_page_v2")
    return { abortSignal() { return this }, retry() { return Promise.resolve({ data: produced, error: null }) } }
  },
}})
const page = await service.readCurriculumNumberedPage({
  filters: { periodId: null, search: "__schedule_only__", status: null, subject: null, grade: null, teacher: null, classroom: null, viewMode: "all" },
  page: 1, pageSize: 10,
})
assert.equal(page.rows.length, 5)
assert.equal(page.totalCount, 5)
const legacy = page.rows.find(row => row.id.endsWith("000000000001"))
assert.equal(legacy.totalSessions, 2)
assert.equal(legacy.nextSession.sessionId, "legacy:future")
assert.equal(legacy.stateLabel, "일정 편성")
assert.equal(page.stats.noScheduleClassCount, 1)
assert.equal(page.rows.find(row => row.id.endsWith("000000000004")).stateLabel, "일정 연장 필요")
console.log(JSON.stringify({ status: "passed", actualRowsConsumed: page.rows.length, legacySessionKeyConsumed: true }))
