import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { parseRegistrationVisitCancellationPage } from "../src/features/tasks/registration-visit-cancellation-service.ts"

// The runner stages this exact consumer alongside this probe. The existing SQL
// fixture supplies real producer output; no copy of its JSON shape is invented.
const url = new URL(process.env.TASK_LOCAL_DB_URL || "https://invalid.invalid")
assert.equal(url.hostname, "127.0.0.1")
assert.match(process.env.TASK_LOCAL_DB_NONCE || "", /^[a-f0-9]{32}$/)
const config = await readFile("supabase/config.toml", "utf8")
const project = config.match(/^project_id = "(tips_supabase_db_qa_[a-f0-9]+)"/m)?.[1]
assert.ok(project)
assert.ok(config.includes(`[db]\nport = ${url.port}\n`))
const fixture = await readFile("supabase/tests/registration_visit_cancellation_explicit_test.sql", "utf8")
// Stop before the service materialize/begin block: only facts, the historical
// synthetic success, read RPCs and explicit preparation have run at this point.
const marker = "set local role service_role;"
const end = fixture.indexOf(marker)
assert.ok(end > 0 && fixture.indexOf(marker, end + marker.length) < 0)
const sql = fixture.slice(0, end) + `
reset role;
select jsonb_build_object(
  'page', public.list_registration_visit_cancellations_v1((select (data->>'taskId')::uuid from cancel_fixture where key='case'),1,10),
  'privateHref', (select data#>>'{items,0,href}' from cancel_fixture where key='plan'),
  'expectedHref', '/admin/registration?taskId='||(select data->>'taskId' from cancel_fixture where key='case'),
  'confirmedChecksum', (select data->>'previewChecksum' from cancel_fixture where key='preview'),
  'frozenChecksum', (select event_row.payload#>>'{cancellation_preview,previewChecksum}'
    from dashboard_private.notification_events event_row where event_row.id=(select (data->>'sourceEventId')::uuid from cancel_fixture where key='ensure')),
  'attempts', (select count(*) from dashboard_private.notification_audit_logs where entity_kind='notification_external_attempt' and action='external_attempt_registered')
);
rollback;
`
const child = spawn("docker", ["exec", "-i", `supabase_db_${project}`, "psql", "-XqAt",
  "--set", "ON_ERROR_STOP=1", "--set", "VERBOSITY=verbose", "-U", "postgres", "-d", "postgres"],
{ stdio: ["pipe", "pipe", "pipe"] })
let stdout = "", stderr = ""
child.stdout.on("data", chunk => { stdout += chunk })
child.stderr.on("data", chunk => { stderr += chunk })
const completed = new Promise((resolve, reject) => {
  child.on("error", reject)
  child.on("close", code => resolve(code))
})
child.stdin.end(sql)
assert.equal(await completed, 0, stderr)
assert.doesNotMatch(stdout, /(?:^|\n)not ok \d+/)
const line = stdout.split("\n").findLast(value => value.startsWith("{"))
assert.ok(line, "actual public list JSON must be returned by the isolated database")
const produced = JSON.parse(line)
const consumed = parseRegistrationVisitCancellationPage(produced.page, 1, 10)
assert.equal(consumed.items.length, 1)
assert.equal(consumed.items[0].status, "ready")
assert.equal(consumed.items[0].canSend, true)
assert.equal(consumed.items[0].previewChecksum, produced.confirmedChecksum)
assert.equal(produced.confirmedChecksum, produced.frozenChecksum)
assert.equal(produced.privateHref, produced.expectedHref)
assert.equal("href" in consumed.items[0], false)
assert.equal(produced.attempts, 0)
console.log(JSON.stringify({ status: "passed", publicRowsConsumed: consumed.items.length,
  state: "ready", frozenChecksumPreserved: true, privateCardHrefPreserved: true, providerCalls: 0 }))
