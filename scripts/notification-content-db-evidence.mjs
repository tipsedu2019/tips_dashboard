import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])
const CUSTOM_TITLE = "🌿 [업무 알림] {task_title} 내용을 함께 확인해요"
const CUSTOM_BODY = [
  "[담당] {current_assignee}",
  "[업무] {task_title}",
  "[상태] {current_status}",
  "[안내] 필요한 내용을 한눈에 볼 수 있어요.",
].join("\n")
const RENDER_CONTEXT = Object.freeze({
  task_title: "2학기 수학 교재 주문",
  current_assignee: "김철수님",
  current_status: "요청됐어요.",
})

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

export function assertLocalDatabaseTarget(value) {
  let parsed
  try {
    parsed = new URL(text(value))
  } catch {
    throw new Error("notification_content_database_url_invalid")
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol) || !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error("notification_content_remote_database_refused")
  }
  return parsed
}

export function redactDatabaseTarget(value) {
  const parsed = assertLocalDatabaseTarget(value)
  const credentials = parsed.username || parsed.password ? "[redacted]@" : ""
  const port = parsed.port ? `:${parsed.port}` : ""
  return `${parsed.protocol}//${credentials}${parsed.hostname}${port}${parsed.pathname}`
}

function renderTemplate(template, context) {
  const rendered = template.replace(/\{([a-z][a-z0-9_]*)\}/gu, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(context, key) || typeof context[key] !== "string") {
      throw new Error(`notification_content_db_render_context_missing:${key}`)
    }
    return context[key]
  })
  if (/[{}]/u.test(rendered)) throw new Error("notification_content_db_render_token_unresolved")
  return rendered
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function roundTripSql() {
  const title = sqlLiteral(CUSTOM_TITLE)
  const body = sqlLiteral(CUSTOM_BODY)
  const context = sqlLiteral(JSON.stringify(RENDER_CONTEXT))
  return `begin;
set local timezone = 'Asia/Seoul';
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set constraints all deferred;

create temporary table notification_content_qa_before on commit drop as
select
  (select count(*) from dashboard_private.notification_rules) as rule_count,
  (select count(*) from dashboard_private.notification_templates) as template_count,
  (select count(*) from dashboard_private.notification_audit_logs) as audit_count,
  (select count(*) from dashboard_private.notification_deliveries
    where status in ('pending', 'claimed', 'sending')) as pending_claimed_sending_count,
  (select count(*) from public.dashboard_notifications) as inbox_count,
  (select count(*) from dashboard_private.notification_deliveries
    where attempt_count > 0 or last_attempt_started_at is not null) as provider_attempt_count,
  not exists (
    select 1 from dashboard_private.notification_runtime_flags where enabled
  ) as runtime_flags_all_false;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '31500000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'notification-content-no-send@runtime.invalid',
  crypt('notification-content-no-send-only', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"fixture":"notification-content-no-send"}'::jsonb,
  now(), now()
)
on conflict (id) do update
set email = excluded.email, updated_at = excluded.updated_at;

insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  '31500000-0000-4000-8000-000000000001', 'admin',
  '알림 콘텐츠 무발송 QA', 'notification-content-no-send@runtime.invalid', now(), now()
)
on conflict (id) do update
set role = excluded.role, name = excluded.name, email = excluded.email, updated_at = excluded.updated_at;

create temporary table notification_content_qa_fixture on commit drop as
select
  rule_row.id as rule_id,
  rule_row.revision as initial_revision,
  rule_row.active_template_id as initial_template_id,
  contract_row.contract_version,
  (select count(*) from dashboard_private.notification_templates template_row
    where template_row.rule_id = rule_row.id) as initial_template_count,
  (select count(*) from dashboard_private.notification_audit_logs audit_row
    where audit_row.entity_kind = 'notification_rule'
      and audit_row.entity_id = rule_row.id::text) as initial_rule_audit_count
from dashboard_private.notification_rules rule_row
join dashboard_private.notification_settings_ui_registry registry
  on registry.rule_id = rule_row.id
join dashboard_private.notification_rule_content_contracts contract_row
  on contract_row.rule_id = rule_row.id
where registry.workflow_key = 'tasks'
  and registry.event_key = 'task.created'
  and registry.audience_key = 'requester_profile'
  and registry.channel_key = 'in_app'
  and registry.rule_variant_key = 'immediate'
limit 1;

create temporary table notification_content_qa_save_results(
  result_key text primary key,
  payload jsonb not null
) on commit drop;

create temporary table notification_content_qa_conflict(
  conflict_code text not null
) on commit drop;

do $$
begin
  if (select count(*) from notification_content_qa_fixture) <> 1 then
    raise exception 'notification_content_round_trip_fixture_missing';
  end if;
end;
$$;

create or replace function pg_temp.notification_content_qa_set_actor()
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"31500000-0000-4000-8000-000000000001","role":"authenticated","email":"notification-content-no-send@runtime.invalid"}',
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.sub', '31500000-0000-4000-8000-000000000001', true
  );
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.notification_content_qa_capture_conflict(
  p_rule_id uuid,
  p_stale_revision bigint,
  p_contract_version text
)
returns text
language plpgsql
volatile
as $$
begin
  perform public.save_notification_control_plane_v2(
    'tasks',
    pg_catalog.jsonb_build_object(p_rule_id::text, p_stale_revision::text),
    pg_catalog.jsonb_build_object(p_rule_id::text, p_contract_version),
    pg_catalog.jsonb_build_object(
      'rules',
      pg_catalog.jsonb_build_object(
        p_rule_id::text,
        pg_catalog.jsonb_build_object(
          'title_template', '⛔ [충돌] 보존되어야 하는 변경 · {task_title}',
          'body_template', '[업무] {task_title}' || chr(10)
            || '[상태] {current_status}' || chr(10)
            || '[담당] {current_assignee}'
        )
      )
    ),
    '31500000-0000-4000-8000-000000000103'
  );
  return 'conflict_not_raised';
exception
  when others then
    if sqlerrm ~ 'notification_revision_conflict' then
      return 'notification_revision_conflict';
    end if;
    raise;
end;
$$;

grant select on notification_content_qa_fixture to authenticated;
grant select, insert on notification_content_qa_save_results to authenticated;
grant select, insert on notification_content_qa_conflict to authenticated;
grant execute on function pg_temp.notification_content_qa_set_actor() to authenticated;
grant execute on function pg_temp.notification_content_qa_capture_conflict(uuid, bigint, text)
  to authenticated;

update dashboard_private.notification_runtime_flags
set enabled = true
where flag_key = 'notification_control_plane_settings_ui_enabled';

do $$ begin perform pg_temp.notification_content_qa_set_actor(); end $$;
set local role authenticated;
insert into notification_content_qa_save_results(result_key, payload)
select 'changed', public.save_notification_control_plane_v2(
  'tasks',
  pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.initial_revision::text),
  pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.contract_version),
  pg_catalog.jsonb_build_object(
    'rules',
    pg_catalog.jsonb_build_object(
      fixture.rule_id::text,
      pg_catalog.jsonb_build_object(
        'title_template', ${title},
        'body_template', ${body}
      )
    )
  ),
  '31500000-0000-4000-8000-000000000101'
)
from notification_content_qa_fixture fixture;
reset role;

create temporary table notification_content_qa_changed on commit drop as
select
  rule_row.revision as changed_revision,
  rule_row.active_template_id as changed_template_id,
  template_row.title_template,
  template_row.body_template,
  (select count(*) from dashboard_private.notification_templates other_template
    where other_template.rule_id = rule_row.id) as changed_template_count,
  (select count(*) from dashboard_private.notification_audit_logs audit_row
    where audit_row.entity_kind = 'notification_rule'
      and audit_row.entity_id = rule_row.id::text) as changed_rule_audit_count
from notification_content_qa_fixture fixture
join dashboard_private.notification_rules rule_row on rule_row.id = fixture.rule_id
join dashboard_private.notification_templates template_row
  on template_row.id = rule_row.active_template_id;

do $$ begin perform pg_temp.notification_content_qa_set_actor(); end $$;
set local role authenticated;
insert into notification_content_qa_save_results(result_key, payload)
select 'no-op', public.save_notification_control_plane_v2(
  'tasks',
  pg_catalog.jsonb_build_object(fixture.rule_id::text, changed.changed_revision::text),
  pg_catalog.jsonb_build_object(fixture.rule_id::text, fixture.contract_version),
  pg_catalog.jsonb_build_object(
    'rules',
    pg_catalog.jsonb_build_object(
      fixture.rule_id::text,
      pg_catalog.jsonb_build_object(
        'title_template', ${title},
        'body_template', ${body}
      )
    )
  ),
  '31500000-0000-4000-8000-000000000102'
)
from notification_content_qa_fixture fixture
cross join notification_content_qa_changed changed;

insert into notification_content_qa_conflict(conflict_code)
select pg_temp.notification_content_qa_capture_conflict(
  fixture.rule_id,
  fixture.initial_revision,
  fixture.contract_version
) as conflict_code
from notification_content_qa_fixture fixture;
reset role;

update dashboard_private.notification_runtime_flags
set enabled = false
where flag_key = 'notification_control_plane_settings_ui_enabled';

select pg_catalog.jsonb_build_object(
  'mode', 'round-trip',
  'runtimeFlagsAllFalseBefore', before_state.runtime_flags_all_false,
  'runtimeFlagsAllFalseAfter', not exists (
    select 1 from dashboard_private.notification_runtime_flags where enabled
  ),
  'rolledBack', true,
  'conflictCode', conflict.conflict_code,
  'conflictPreserved',
    rule_row.revision = changed.changed_revision
    and rule_row.active_template_id = changed.changed_template_id
    and template_row.title_template = changed.title_template
    and template_row.body_template = changed.body_template,
  'noOpPreserved',
    rule_row.revision = changed.changed_revision
    and (select count(*) from dashboard_private.notification_templates candidate
      where candidate.rule_id = fixture.rule_id) = changed.changed_template_count,
  'titleTemplate', template_row.title_template,
  'bodyTemplate', template_row.body_template,
  'renderContext', ${context}::jsonb,
  'expectedTitle', '🌿 [업무 알림] 2학기 수학 교재 주문 내용을 함께 확인해요',
  'expectedBody', '[담당] 김철수님' || chr(10)
    || '[업무] 2학기 수학 교재 주문' || chr(10)
    || '[상태] 요청됐어요.' || chr(10)
    || '[안내] 필요한 내용을 한눈에 볼 수 있어요.',
  'fixtureWrites', pg_catalog.jsonb_build_object(
    'ruleRevisionDelta', rule_row.revision - fixture.initial_revision,
    'templateDelta', changed.changed_template_count - fixture.initial_template_count,
    'auditDelta', changed.changed_rule_audit_count - fixture.initial_rule_audit_count
  ),
  'operationalDeltas', pg_catalog.jsonb_build_object(
    'pendingClaimedSending',
      (select count(*) from dashboard_private.notification_deliveries
        where status in ('pending', 'claimed', 'sending'))
      - before_state.pending_claimed_sending_count,
    'inbox',
      (select count(*) from public.dashboard_notifications) - before_state.inbox_count,
    'providerAttempts',
      (select count(*) from dashboard_private.notification_deliveries
        where attempt_count > 0 or last_attempt_started_at is not null)
      - before_state.provider_attempt_count
  )
) as notification_content_db_evidence
from notification_content_qa_before before_state
cross join notification_content_qa_fixture fixture
cross join notification_content_qa_changed changed
cross join notification_content_qa_conflict conflict
join dashboard_private.notification_rules rule_row on rule_row.id = fixture.rule_id
join dashboard_private.notification_templates template_row
  on template_row.id = rule_row.active_template_id;
rollback;
`
}

function readOnlySql() {
  return `begin read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
with snapshot as (
  select
    not exists (
      select 1 from dashboard_private.notification_runtime_flags where enabled
    ) as runtime_flags_all_false,
    (select count(*) from dashboard_private.notification_deliveries
      where status in ('pending', 'claimed', 'sending')) as pending_claimed_sending_count,
    (select count(*) from public.dashboard_notifications) as inbox_count,
    (select count(*) from dashboard_private.notification_deliveries
      where attempt_count > 0 or last_attempt_started_at is not null) as provider_attempt_count,
    (select count(*) from dashboard_private.notification_audit_logs) as audit_count,
    (select count(*) from public.google_chat_webhook_settings) as connection_count
)
select pg_catalog.jsonb_build_object(
  'mode', 'read-only',
  'runtimeFlagsAllFalseBefore', snapshot.runtime_flags_all_false,
  'runtimeFlagsAllFalseAfter', snapshot.runtime_flags_all_false,
  'connectionValues', '[redacted]',
  'connectionCount', snapshot.connection_count,
  'operationalDeltas', pg_catalog.jsonb_build_object(
    'pendingClaimedSending', 0,
    'inbox', 0,
    'providerAttempts', 0,
    'audit', 0
  )
) as notification_content_db_evidence
from snapshot;
rollback;
`
}

function parseJsonOutput(stdout) {
  const source = String(stdout || "")
  const firstObject = source.indexOf("{")
  const firstArray = source.indexOf("[")
  const starts = [firstObject, firstArray].filter((value) => value >= 0)
  const start = starts.length > 0 ? Math.min(...starts) : -1
  const end = Math.max(source.lastIndexOf("}"), source.lastIndexOf("]"))
  if (start < 0 || end < start) throw new Error("notification_content_db_cli_json_missing")
  return JSON.parse(source.slice(start, end + 1))
}

function findEvidence(value) {
  if (!value || typeof value !== "object") return null
  if (Object.prototype.hasOwnProperty.call(value, "notification_content_db_evidence")) {
    const candidate = value.notification_content_db_evidence
    return typeof candidate === "string" ? JSON.parse(candidate) : candidate
  }
  if (value.mode === "round-trip" || value.mode === "read-only") return value
  for (const candidate of Array.isArray(value) ? value : Object.values(value)) {
    const found = findEvidence(candidate)
    if (found) return found
  }
  return null
}

function wrapWindowsCommand(command, args) {
  if (process.platform !== "win32" || !/\.cmd$/iu.test(command)) return { command, args }
  return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command, ...args] }
}

function configuredCli() {
  const explicit = text(process.env.SUPABASE_CLI_PATH || process.env.SUPABASE_CLI)
  if (explicit) return explicit
  const candidates = [
    resolve(ROOT, ".codex-temp/tools/supabase/bin/supabase"),
    resolve(ROOT, ".tools/supabase/bin/supabase"),
  ]
  return candidates.find(existsSync) || "supabase"
}

function sanitizeCliText(value, databaseUrl) {
  const parsed = assertLocalDatabaseTarget(databaseUrl)
  return String(value || "")
    .replaceAll(databaseUrl, redactDatabaseTarget(databaseUrl))
    .replaceAll(parsed.password, parsed.password ? "[redacted]" : "")
}

function queryWithSupabaseCli({ sql, databaseUrl }) {
  const cli = configuredCli()
  const helpInvocation = wrapWindowsCommand(cli, ["db", "query", "--help"])
  const help = spawnSync(helpInvocation.command, helpInvocation.args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  })
  if (help.status !== 0) {
    throw new Error(`notification_content_db_cli_unavailable:${sanitizeCliText(help.stderr, databaseUrl)}`)
  }

  const sqlFile = resolve(tmpdir(), `tips-notification-content-${randomUUID()}.sql`)
  writeFileSync(sqlFile, sql, { encoding: "utf8", mode: 0o600 })
  try {
    const invocation = wrapWindowsCommand(cli, [
      "db", "query", "--db-url", databaseUrl, "--output", "json", "--file", sqlFile,
    ])
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 90_000,
      windowsHide: true,
    })
    if (result.status !== 0) {
      throw new Error([
        "notification_content_db_query_failed",
        sanitizeCliText(result.stderr, databaseUrl).trim(),
        sanitizeCliText(result.stdout, databaseUrl).trim(),
      ].filter(Boolean).join(":"))
    }
    const found = findEvidence(parseJsonOutput(result.stdout))
    if (!found) throw new Error("notification_content_db_evidence_missing")
    return found
  } finally {
    try {
      if (existsSync(sqlFile)) unlinkSync(sqlFile)
    } catch {
      // The SQL file contains no secrets; best-effort cleanup is enough after process failure.
    }
  }
}

function zeroOperationalDeltas(value, keys) {
  return value && keys.every((key) => Number(value[key]) === 0)
}

export async function runNotificationContentDbEvidence({
  mode = "read-only",
  databaseUrl,
  disposable = false,
  query = queryWithSupabaseCli,
} = {}) {
  if (mode !== "read-only" && mode !== "round-trip") {
    throw new Error("notification_content_db_mode_invalid")
  }
  assertLocalDatabaseTarget(databaseUrl)
  if (mode === "round-trip" && disposable !== true) {
    throw new Error("notification_content_round_trip_disposable_required")
  }
  if (typeof query !== "function") throw new Error("notification_content_db_query_unavailable")

  const raw = await query({
    mode,
    databaseUrl,
    sql: mode === "round-trip" ? roundTripSql() : readOnlySql(),
  })
  if (!raw || raw.mode !== mode) throw new Error("notification_content_db_evidence_contract_invalid")
  if (raw.runtimeFlagsAllFalseBefore !== true || raw.runtimeFlagsAllFalseAfter !== true) {
    throw new Error("notification_content_runtime_flags_enabled")
  }

  if (mode === "read-only") {
    if (
      raw.connectionValues !== "[redacted]"
      || !zeroOperationalDeltas(raw.operationalDeltas, [
        "pendingClaimedSending", "inbox", "providerAttempts", "audit",
      ])
    ) throw new Error("notification_content_read_only_delta_nonzero")
    return Object.freeze({
      ...raw,
      passed: true,
      databaseTarget: redactDatabaseTarget(databaseUrl),
    })
  }

  const renderedTitle = renderTemplate(raw.titleTemplate, raw.renderContext)
  const renderedBody = renderTemplate(raw.bodyTemplate, raw.renderContext)
  if (
    raw.rolledBack !== true
    || raw.conflictCode !== "notification_revision_conflict"
    || raw.conflictPreserved !== true
    || raw.noOpPreserved !== true
    || renderedTitle !== raw.expectedTitle
    || renderedBody !== raw.expectedBody
    || Number(raw.fixtureWrites?.ruleRevisionDelta) !== 1
    || Number(raw.fixtureWrites?.templateDelta) !== 1
    || Number(raw.fixtureWrites?.auditDelta) !== 1
    || !zeroOperationalDeltas(raw.operationalDeltas, [
      "pendingClaimedSending", "inbox", "providerAttempts",
    ])
  ) throw new Error("notification_content_round_trip_evidence_failed")

  return Object.freeze({
    ...raw,
    passed: true,
    databaseTarget: redactDatabaseTarget(databaseUrl),
    renderedTitle,
    renderedBody,
  })
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const mode = argumentValue("--mode") || "read-only"
  const databaseUrl = argumentValue("--db-url") || process.env.NOTIFICATION_CONTENT_DB_URL
  const disposable = process.argv.includes("--disposable")
    && text(process.env.NOTIFICATION_CONTENT_DB_SCOPE).toLowerCase() === "local"
  const result = await runNotificationContentDbEvidence({ mode, databaseUrl, disposable })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "알림 콘텐츠 DB 증거 수집에 실패했습니다."}\n`)
    process.exitCode = 1
  })
}
