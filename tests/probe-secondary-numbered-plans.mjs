import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PAGE_SIZE = 10;
const PLAN_BEGIN = "__secondary_numbered_plan_begin__";
const PLAN_END = "__secondary_numbered_plan_end__";
const SHA256 = /^[a-f0-9]{64}$/u;

export const SECONDARY_PLAN_SCENARIOS = [
  {
    name: "academic-curriculum",
    fixturePath: "supabase/tests/academic_operations_numbered_pages_test.sql",
    fixtureSha256: "b42538fc42a58b586f4010c3025b4eb9e11d419b07a3ef4a735826c23744b9f4",
    marker: "create temp table academic_first as",
    actorRole: "authenticated admin fixture actor 900",
    functionSignature: "public.get_academic_curriculum_numbered_page_v1(jsonb,integer,integer,boolean)",
    migrationProvenance: [
      "20260831052546_academic_operations_numbered_pages.sql:32b51bd8ac1fc14d32bf01a260d1fa22a9324b658960de265f5b89bc0c61b0df",
    ],
    countSql: "(public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),1,10,true)->>'totalCount')::integer",
    selectSql: (page) => `public.get_academic_curriculum_numbered_page_v1(pg_temp.af(),${page},10,true)`,
    noSendSql: "(select count(*) from public.ops_tasks)=(select ops_tasks from task5_probe_read_before)",
  },
  {
    name: "operations-class-schedule",
    fixturePath: "supabase/tests/academic_operations_numbered_pages_test.sql",
    fixtureSha256: "b42538fc42a58b586f4010c3025b4eb9e11d419b07a3ef4a735826c23744b9f4",
    marker: "create temp table academic_first as",
    actorRole: "authenticated admin fixture actor 900",
    functionSignature: "public.get_operations_class_schedule_numbered_page_v1(jsonb,integer,integer)",
    migrationProvenance: [
      "20260831052546_academic_operations_numbered_pages.sql:32b51bd8ac1fc14d32bf01a260d1fa22a9324b658960de265f5b89bc0c61b0df",
    ],
    countSql: "(public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(),1,10)->>'totalCount')::integer",
    selectSql: (page) => `public.get_operations_class_schedule_numbered_page_v1(pg_temp.of(),${page},10)`,
    noSendSql: "(select count(*) from public.ops_tasks)=(select ops_tasks from task5_probe_read_before)",
  },
  {
    name: "approval-list",
    fixturePath: "supabase/tests/approval_numbered_pages_test.sql",
    fixtureSha256: "9c72c420667649b46e32f4e5414f157fc21f79a74aa97f90befccfa3d8353cdd",
    marker: "create temp table approval_eleven as",
    actorRole: "authenticated teacher fixture actor 801",
    functionSignature: "public.list_approval_numbered_page_v1(text,integer,integer)",
    migrationProvenance: [
      "20260831061736_approval_numbered_pages.sql:f371ec311759886788112090fc0aeaeb9242ffb7f86d98348216eb553cbc799d",
      "20260831063537_approval_detail_trim_parity.sql:6fb6efd7e5ba2441aa1ce91d23f2903d975c79567e42bea9d061aa5d6bf74c9b",
    ],
    countSql: "(public.list_approval_numbered_page_v1('mine',1,10)->>'totalCount')::integer",
    selectSql: (page) => `public.list_approval_numbered_page_v1('mine',${page},10)`,
    noSendSql: "(select count(*) from public.approval_events)=(select approval_events from task5_probe_read_before) and (select count(*) from public.approval_comments)=(select approval_comments from task5_probe_read_before)",
  },
  {
    name: "makeup-list",
    fixturePath: "supabase/tests/makeup_numbered_pages_test.sql",
    fixtureSha256: "0bb90fcc4ed8b5f7850df7bf69733739ae5f1b023e4a0c8c54e9afb072eeaa75",
    marker: "select is(pg_temp.page()->'viewCounts',",
    actorRole: "authenticated admin fixture actor 804",
    functionSignature: "public.list_makeup_numbered_page_v1(jsonb,integer,integer)",
    migrationProvenance: [
      "20260831065351_makeup_numbered_pages.sql:9c5bd203b41adee3cdceb4723c6a1f440b4abd67a6adfea0bfb06e3d5f0465bf",
      "20260831101449_makeup_system_note_whitespace_parity.sql:940613f164be35b25661750e8be5c0f15409409890308a5e046ef0fed31369ff",
      "20260831103631_makeup_source_precision_parity.sql:47413b333331c9abfe4e771f52e9078b4edc8d88e8cf2b0125dc437a246328ba",
    ],
    countSql: "(public.list_makeup_numbered_page_v1(pg_temp.filters(),1,10)->>'totalCount')::integer",
    selectSql: (page) => `public.list_makeup_numbered_page_v1(pg_temp.filters(),${page},10)`,
    noSendSql: "(select count(*) from public.makeup_request_events)=(select makeup_request_events from task5_probe_read_before)",
  },
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function derivePagePositions(totalCount, pageSize = PAGE_SIZE) {
  if (!Number.isInteger(totalCount) || totalCount < 1 || !Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("secondary_plan_page_count_invalid");
  }
  const finalPage = Math.ceil(totalCount / pageSize);
  return [
    { label: "first", page: 1 },
    { label: "middle", page: Math.ceil(finalPage / 2) },
    { label: "final", page: finalPage },
  ];
}

export function selectVerifiedFixturePrefix({ source, sha256: expectedSha256, marker }) {
  if (typeof source !== "string" || !SHA256.test(expectedSha256 || "") || typeof marker !== "string" || !marker) {
    throw new Error("secondary_plan_fixture_contract_invalid");
  }
  if (sha256(source) !== expectedSha256) throw new Error("secondary_plan_fixture_sha_drift");
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0 || source.indexOf(marker, markerIndex + marker.length) !== -1) {
    throw new Error("secondary_plan_fixture_marker_drift");
  }
  const prefix = source.slice(0, markerIndex);
  if (!prefix.startsWith("begin;") || !prefix.endsWith("\n")) throw new Error("secondary_plan_fixture_prefix_invalid");
  return prefix;
}

export function prepareFixturePrefixForDirectPsql(prefix) {
  if (typeof prefix !== "string" || !prefix.startsWith("begin;\n")) throw new Error("secondary_plan_fixture_prefix_invalid");
  return `begin;\ncreate temp table task5_pgtap_extension_before as select exists(select 1 from pg_catalog.pg_extension where extname='pgtap') as initially_present;\ncreate extension if not exists pgtap with schema extensions;\nset local search_path = extensions, public;\n${prefix.slice("begin;\n".length)}`;
}

export function parseSecondaryPlanProbeEnvironment(env = process.env) {
  let parsed;
  try { parsed = new URL(env.TASK_LOCAL_DB_URL); } catch { throw new Error("secondary_plan_probe_local_authorization_required"); }
  if (![
    "postgres:", "postgresql:",
  ].includes(parsed.protocol) || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/postgres" || !/^[a-z0-9-]{16,128}$/iu.test(env.TASK_LOCAL_DB_NONCE || "")) {
    throw new Error("secondary_plan_probe_local_authorization_required");
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("secondary_plan_probe_local_authorization_required");
  return { port };
}

function discoverLocalDatabaseContainer({ port }) {
  const result = spawnSync("docker", ["ps", "--filter", `publish=${port}`, "--format", "{{.ID}}"], { encoding: "utf8" });
  const candidates = String(result.stdout || "").trim().split(/\s+/u).filter(Boolean);
  if (result.status !== 0 || candidates.length !== 1 || !/^[a-f0-9]{12,64}$/u.test(candidates[0])) {
    throw new Error("secondary_plan_probe_container_invalid");
  }
  return candidates[0];
}

function runPsql(containerId, sql) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("docker", ["exec", "-i", containerId, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", () => rejectPromise(new Error("secondary_plan_probe_psql_failed")));
    child.once("close", (code) => code === 0
      ? resolvePromise(Buffer.concat(stdout).toString("utf8"))
      : rejectPromise(new Error(`secondary_plan_probe_psql_failed:${safePsqlDiagnostic(Buffer.concat(stderr).toString("utf8"))}`)));
    child.stdin.end(sql);
  });
}

function safePsqlDiagnostic(value) {
  const safe = String(value)
    .replace(/(?:postgres(?:ql)?:\/\/)[^\s]+/giu, "[redacted-url]")
    .replace(/\b((?:password|token|secret|key)\s*(?:=|:|=>))\s*[^\s,;]+/giu, "$1[redacted]")
    .replace(/\s+/gu, " ")
    .trim();
  return safe.slice(0, 500) || "no_stderr";
}

export function buildMeasurementSql(scenario) {
  const captures = [1, 2, 3].map((ordinal) => `
    select '${["first", "middle", "final"][ordinal - 1]}'::text as label,
      case ${ordinal}
        when 1 then 1
        when 2 then pg_catalog.ceil(pg_catalog.ceil(total_count::numeric/${PAGE_SIZE})/2)::integer
        else pg_catalog.ceil(total_count::numeric/${PAGE_SIZE})::integer
      end as page,
      ${ordinal} as ordinal
    from task5_total`).join(" union all");
  return `
reset role;
create temp table task5_probe_read_before as select
  (select count(*) from dashboard_private.notification_events) notification_events,
  (select count(*) from dashboard_private.notification_event_fanout_jobs) notification_event_fanout_jobs,
  (select count(*) from dashboard_private.notification_deliveries) notification_deliveries,
  (select count(*) from public.ops_tasks) ops_tasks,
  (select count(*) from public.approval_events) approval_events,
  (select count(*) from public.approval_comments) approval_comments,
  (select count(*) from public.makeup_request_events) makeup_request_events;
set local role authenticated;
create function pg_temp.task5_capture_plan(p_label text,p_page integer) returns jsonb language plpgsql as $task5$
declare plan jsonb; page_response jsonb;
begin
  execute format($response$select ${scenario.selectSql("%s")}$response$,p_page) into page_response;
  execute format($plan$explain (analyze, buffers, settings, format json) select ${scenario.selectSql("%s")}$plan$,p_page) into plan;
  return jsonb_build_object('label',p_label,'page',p_page,'observedRowCount',jsonb_array_length(page_response->'rows'),'plan',plan);
end
$task5$;
create temp table task5_total as select ${scenario.countSql} as total_count;
create temp table task5_probe_payload as
with positions as (${captures})
select jsonb_build_object(
  'version',1,
  'scenario','${scenario.name}',
  'actorRole','${scenario.actorRole}',
  'functionSignature','${scenario.functionSignature}',
  'functionDefinitionSha256',encode(digest(pg_get_functiondef('${scenario.functionSignature}'::regprocedure),'sha256'),'hex'),
  'authorization',jsonb_build_object('authUid',auth.uid(),'currentUser',current_user,'profileRole',(select role from public.profiles where id=auth.uid())),
  'totalCount',(select total_count from task5_total),
  'pageSize',${PAGE_SIZE},
  'unmeasuredWarmupCalls',jsonb_build_object('countPageReadCalls',1,'selectedPageReadCalls',3,'total',4),
  'plans',(select jsonb_agg(pg_temp.task5_capture_plan(label,page) order by ordinal) from positions)
) as payload;
reset role;
select '${PLAN_BEGIN}';
select jsonb_pretty(jsonb_set(
  jsonb_set(payload,'{noSendInvariant}',to_jsonb(
    (select count(*) from dashboard_private.notification_events)=(select notification_events from task5_probe_read_before)
    and (select count(*) from dashboard_private.notification_event_fanout_jobs)=(select notification_event_fanout_jobs from task5_probe_read_before)
    and (select count(*) from dashboard_private.notification_deliveries)=(select notification_deliveries from task5_probe_read_before)
    and ${scenario.noSendSql}
  )),
  '{pgtapBootstrap}',
  jsonb_build_object('initiallyPresent',(select initially_present from task5_pgtap_extension_before),'availableDuringProbe',exists(select 1 from pg_catalog.pg_extension where extname='pgtap'))
)) from task5_probe_payload;
select '${PLAN_END}';
rollback;
`;
}

function parseMarkedPayload(output) {
  const lines = output.split("\n");
  const start = lines.indexOf(PLAN_BEGIN);
  const end = lines.indexOf(PLAN_END);
  if (start < 0 || end <= start || lines.indexOf(PLAN_BEGIN, start + 1) !== -1 || lines.indexOf(PLAN_END, end + 1) !== -1) {
    throw new Error("secondary_plan_probe_output_invalid");
  }
  try { return JSON.parse(lines.slice(start + 1, end).join("\n")); } catch { throw new Error("secondary_plan_probe_output_invalid"); }
}

export function assertMeasuredPayload(payload) {
  const warmups = payload?.unmeasuredWarmupCalls;
  if (!payload || typeof payload !== "object" || payload.version !== 1 || !Number.isInteger(payload.totalCount) || payload.totalCount < 1 || payload.pageSize !== PAGE_SIZE || !Array.isArray(payload.plans) || payload.plans.length !== 3 || payload.noSendInvariant !== true || payload.authorization?.currentUser !== "authenticated" || typeof payload.authorization?.authUid !== "string" || typeof payload.authorization?.profileRole !== "string" || typeof payload.pgtapBootstrap?.initiallyPresent !== "boolean" || payload.pgtapBootstrap?.availableDuringProbe !== true || warmups?.countPageReadCalls !== 1 || warmups?.selectedPageReadCalls !== 3 || warmups?.total !== 4) {
    throw new Error("secondary_plan_probe_result_invalid");
  }
  const expected = derivePagePositions(payload.totalCount, payload.pageSize);
  if (JSON.stringify(payload.plans.map(({ label, page }) => ({ label, page }))) !== JSON.stringify(expected)
    || !payload.plans.every((plan) => Number.isInteger(plan.observedRowCount) && plan.observedRowCount >= 0 && Array.isArray(plan.plan) && plan.plan.length === 1)
    || !SHA256.test(payload.functionDefinitionSha256 || "")) {
    throw new Error("secondary_plan_probe_result_invalid");
  }
  return payload;
}

function prettyOutput(record) {
  const rendered = JSON.stringify(record, null, 2);
  if (rendered.split("\n").some((line) => Buffer.byteLength(line, "utf8") >= 8000)) {
    throw new Error("secondary_plan_probe_output_line_too_long");
  }
  return rendered;
}

export async function runSecondaryNumberedPlanProbe({ env = process.env, readFixture = (path) => readFile(path, "utf8"), executePsql = runPsql } = {}) {
  const configuration = parseSecondaryPlanProbeEnvironment(env);
  const containerId = discoverLocalDatabaseContainer(configuration);
  const output = [];
  for (const scenario of SECONDARY_PLAN_SCENARIOS) {
    const source = await readFixture(scenario.fixturePath);
    const prefix = selectVerifiedFixturePrefix({ source, sha256: scenario.fixtureSha256, marker: scenario.marker });
    const payload = assertMeasuredPayload(parseMarkedPayload(await executePsql(containerId, `${prepareFixturePrefixForDirectPsql(prefix)}${buildMeasurementSql(scenario)}`)));
    const planJsonSha256 = sha256(JSON.stringify(payload.plans));
    output.push({
      ...payload,
      fixturePath: scenario.fixturePath,
      fixtureSha256: scenario.fixtureSha256,
      fixtureMarker: scenario.marker,
      migrationProvenance: scenario.migrationProvenance,
      planJsonSha256,
      limitations: "synthetic local warm-cache EXPLAIN; function-wrapper plans do not prove nested enrichment loops or production latency",
    });
  }
  return output;
}

export function isSecondaryPlanProbeMain({ argv1 = process.argv[1], moduleUrl = import.meta.url, resolveRealpath = realpathSync } = {}) {
  if (typeof argv1 !== "string" || !argv1 || typeof moduleUrl !== "string" || !moduleUrl || typeof resolveRealpath !== "function") return false;
  try { return resolveRealpath(argv1) === resolveRealpath(fileURLToPath(moduleUrl)); } catch { return false; }
}

if (isSecondaryPlanProbeMain()) {
  runSecondaryNumberedPlanProbe()
    .then((records) => {
      for (const record of records) process.stdout.write(`${prettyOutput(record)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
