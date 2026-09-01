import { spawnSync } from "node:child_process";

function fail(code) { throw new Error(code); }

function localDatabasePort(env = process.env) {
  let parsed;
  try { parsed = new URL(env.TASK_LOCAL_DB_URL); } catch { fail("task6b_wire_local_authorization_required"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost"].includes(parsed.hostname)
    || parsed.pathname !== "/postgres"
    || !/^[a-z0-9-]{16,128}$/iu.test(env.TASK_LOCAL_DB_NONCE || "")) {
    fail("task6b_wire_local_authorization_required");
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail("task6b_wire_local_authorization_required");
  return port;
}

function databaseContainer(port) {
  const result = spawnSync("docker", ["ps", "--filter", `publish=${port}`, "--format", "{{.ID}}"], { encoding: "utf8" });
  const candidates = String(result.stdout || "").trim().split(/\s+/u).filter(Boolean);
  if (result.status !== 0 || candidates.length !== 1 || !/^[a-f0-9]{12,64}$/u.test(candidates[0])) {
    fail("task6b_wire_container_invalid");
  }
  return candidates[0];
}

function safeDiagnostic(value) {
  return String(value || "")
    .replace(/(?:postgres(?:ql)?:\/\/)[^\s]+/giu, "[redacted-url]")
    .replace(/\b((?:password|token|secret|key)\s*(?:=|:|=>))\s*[^\s,;]+/giu, "$1[redacted]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500) || "no_stderr";
}

const sql = String.raw`
begin;
set local lock_timeout = '7s';

create function pg_temp.task6b_wire_id(n integer) returns uuid language sql immutable as $id$
  select ('6f000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$id$;
create function pg_temp.task6b_wire_filters(subject_name text, search_text text) returns jsonb
language sql immutable as $filters$
  select jsonb_build_object('subject',subject_name,'search',search_text)
$filters$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values (pg_temp.task6b_wire_id(901),'00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','task6b-wire@example.invalid',crypt('local-only',gen_salt('bf')),
  now(),'{}','{}',now(),now());
update public.profiles set role='admin',name='Task6b Wire 관리자'
where id=pg_temp.task6b_wire_id(901);

insert into public.textbook_sub_subject_settings(id,subject,name,sort_order,is_visible)
select pg_temp.task6b_wire_id(n),'other','__task6b_wire__ 사용자 '||n,100+n*10,(n%4)<>0
from generate_series(1,112) n;

create temp table task6b_wire_values(key text primary key,value jsonb);
grant select,insert,update,delete on task6b_wire_values to authenticated;

set local role authenticated;
set local "request.jwt.claim.sub" = '6f000000-0000-4000-8000-000000000901';
set local "request.jwt.claim.role" = 'authenticated';

insert into task6b_wire_values values
  ('taxonomy_base',to_jsonb(textbook_settings_private.taxonomy_revision_v1())),
  ('owner_base',to_jsonb(textbook_settings_private.revision_v1()));

insert into task6b_wire_values values ('page_input',jsonb_build_object(
  'page',11,'pageSize',10,
  'filters',pg_temp.task6b_wire_filters('other','__task6b_wire__'),
  'draft',null));
select '# TASK6B_WIRE ' || jsonb_build_object(
  'actorId',pg_temp.task6b_wire_id(901),
  'method','listTextbookSubSubjectPage',
  'input',(select value from task6b_wire_values where key='page_input'),
  'data',public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.task6b_wire_filters('other','__task6b_wire__'),null,11,10))::text;

insert into task6b_wire_values values ('draft_page_input',jsonb_build_object(
  'page',11,'pageSize',10,
  'filters',pg_temp.task6b_wire_filters('other','__task6b_wire__'),
  'draft',jsonb_build_object(
    'version',1,
    'baseRevision',(select value#>>'{}' from task6b_wire_values where key='taxonomy_base'),
    'operations',jsonb_build_array(
      jsonb_build_object('type','add','id',pg_temp.task6b_wire_id(800),
        'subject','other','name','__task6b_wire__ 추가','isVisible',true),
      jsonb_build_object('type','move','id',pg_temp.task6b_wire_id(100),'direction','up')))));
select '# TASK6B_WIRE ' || jsonb_build_object(
  'actorId',pg_temp.task6b_wire_id(901),
  'method','listTextbookSubSubjectPage',
  'input',(select value from task6b_wire_values where key='draft_page_input'),
  'data',public.list_textbook_sub_subject_numbered_page_v1(
    pg_temp.task6b_wire_filters('other','__task6b_wire__'),
    (select value->'draft' from task6b_wire_values where key='draft_page_input'),11,10))::text;

insert into task6b_wire_values values ('taxonomy_save_input',jsonb_build_object(
  'requestId',pg_temp.task6b_wire_id(9001),
  'draft',jsonb_build_object(
    'version',1,'owners',null,
    'subSubjects',jsonb_build_object(
      'version',1,
      'baseRevision',(select value#>>'{}' from task6b_wire_values where key='taxonomy_base'),
      'operations',jsonb_build_array(jsonb_build_object(
        'type','patch','id','english-독해',
        'patch',jsonb_build_object('name','__task6b_wire__ 독해 심화','isVisible',true)))))));
insert into task6b_wire_values
select 'taxonomy_save_result',public.save_textbook_settings_draft_v1(
  (value->>'requestId')::uuid,value->'draft')
from task6b_wire_values where key='taxonomy_save_input';
select '# TASK6B_WIRE ' || jsonb_build_object(
  'actorId',pg_temp.task6b_wire_id(901),'method','saveTextbookSettingsDraft','phase','taxonomy-first',
  'input',(select value from task6b_wire_values where key='taxonomy_save_input'),
  'data',(select value from task6b_wire_values where key='taxonomy_save_result'))::text;
select '# TASK6B_WIRE ' || jsonb_build_object(
  'actorId',pg_temp.task6b_wire_id(901),'method','saveTextbookSettingsDraft','phase','taxonomy-replay',
  'input',(select value from task6b_wire_values where key='taxonomy_save_input'),
  'data',public.save_textbook_settings_draft_v1(
    ((select value from task6b_wire_values where key='taxonomy_save_input')->>'requestId')::uuid,
    (select value->'draft' from task6b_wire_values where key='taxonomy_save_input')))::text;

insert into task6b_wire_values values ('mixed_save_input',jsonb_build_object(
  'requestId',pg_temp.task6b_wire_id(9002),
  'draft',jsonb_build_object(
    'version',1,
    'owners',jsonb_build_object(
      'version',1,
      'baseRevision',(select value#>>'{}' from task6b_wire_values where key='owner_base'),
      'operations',jsonb_build_array(jsonb_build_object(
        'type','publisher.add','id',pg_temp.task6b_wire_id(701),
        'name','__task6b_wire__ 혼합 출판사','subjects',jsonb_build_array('english'),
        'supplierIds','[]'::jsonb))),
    'subSubjects',jsonb_build_object(
      'version',1,
      'baseRevision',textbook_settings_private.taxonomy_revision_v1(),
      'operations',jsonb_build_array(jsonb_build_object(
        'type','add','id',pg_temp.task6b_wire_id(702),
        'subject','other','name','__task6b_wire__ 혼합 세부과목','isVisible',true))))));
insert into task6b_wire_values
select 'mixed_save_result',public.save_textbook_settings_draft_v1(
  (value->>'requestId')::uuid,value->'draft')
from task6b_wire_values where key='mixed_save_input';
select '# TASK6B_WIRE ' || jsonb_build_object(
  'actorId',pg_temp.task6b_wire_id(901),'method','saveTextbookSettingsDraft','phase','mixed-first',
  'input',(select value from task6b_wire_values where key='mixed_save_input'),
  'data',(select value from task6b_wire_values where key='mixed_save_result'))::text;
select '# TASK6B_WIRE ' || jsonb_build_object(
  'actorId',pg_temp.task6b_wire_id(901),'method','saveTextbookSettingsDraft','phase','mixed-replay',
  'input',(select value from task6b_wire_values where key='mixed_save_input'),
  'data',public.save_textbook_settings_draft_v1(
    ((select value from task6b_wire_values where key='mixed_save_input')->>'requestId')::uuid,
    (select value->'draft' from task6b_wire_values where key='mixed_save_input')))::text;

rollback;
`;

const container = databaseContainer(localDatabasePort());
const result = spawnSync("docker", [
  "exec", "-i", container,
  "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
], { input: sql, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
if (result.status !== 0) fail(`task6b_wire_psql_failed:${safeDiagnostic(result.stderr)}`);
const lines = String(result.stdout || "").trim().split("\n").filter(Boolean);
if (lines.length !== 6 || lines.some((line) => !line.startsWith("# TASK6B_WIRE ") || line.length > 8000)) {
  fail("task6b_wire_output_invalid");
}
process.stdout.write(`${lines.join("\n")}\n`);
