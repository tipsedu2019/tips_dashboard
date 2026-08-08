import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cp,
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_URL = "http://127.0.0.1:55421";
const DEFAULT_DB_URL =
  "postgresql://postgres:postgres@127.0.0.1:55422/postgres";
const CLI_PATH =
  "/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go";
const CLI_VERSION = "2.103.0";
const PROJECT_ID_PREFIX = "tips_registration_solapi_qa_";
const PROJECT_ID_PATTERN = /^tips_registration_solapi_qa_[a-f0-9]{12}$/u;
const WORKDIR_PREFIX = "tips-registration-solapi-qa-";
const PG_TAP_PATH =
  "supabase/tests/registration_customer_solapi_messages_test.sql";
const MESSAGE_MIGRATIONS = [
  "20260805110000_registration_customer_solapi_storage.sql",
  "20260805111000_registration_customer_solapi_message_rpc.sql",
  "20260805112000_registration_customer_solapi_activation.sql",
  "20260806130000_registration_customer_message_audit_dedupe.sql",
  "20260808120425_registration_customer_message_subject_admission_details.sql",
];
const CONTAINER_PREFIX = `supabase_db_${PROJECT_ID_PREFIX}`;
const FORBIDDEN_OPTIONS = new Set(["--linked", "--remote", "--production"]);
const GUARDED_ENVIRONMENT_EXACT_KEYS = new Set([
  "APP_ENV",
  "DATABASE_URL",
  "DIRECT_URL",
  "ENV",
  "ENVIRONMENT",
  "NODE_ENV",
]);
const GUARDED_ENVIRONMENT_PREFIXES = [
  "CRON_",
  "NEXT_PUBLIC_SUPABASE_",
  "NOTIFICATION_WORKER_",
  "PG",
  "POSTGRES_",
  "REGISTRATION_SOLAPI_",
  "SOLAPI_",
  "SUPABASE_",
  "VERCEL_",
  "VITE_SUPABASE_",
];
const LOCAL_CHILD_ENVIRONMENT_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
];

function fail(code, detail = "") {
  throw new Error(`${code}${detail ? `: ${detail}` : ""}`);
}

function parseArgs(argv) {
  const options = {
    execute: false,
    approvedLocalDb: false,
    url: DEFAULT_URL,
    dbUrl: DEFAULT_DB_URL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (FORBIDDEN_OPTIONS.has(arg)) {
      fail("registration_local_db_forbidden_option", arg);
    }
    if (arg === "--execute") {
      options.execute = true;
    } else if (arg === "--approved-local-db") {
      options.approvedLocalDb = true;
    } else if (arg === "--url" || arg === "--db-url") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        fail("registration_local_db_invalid_option", arg);
      }
      if (arg === "--url") options.url = value;
      else options.dbUrl = value;
      index += 1;
    } else {
      fail("registration_local_db_forbidden_option", arg);
    }
  }

  return options;
}

function validateExactLoopback(url, dbUrl) {
  let parsedUrl;
  let parsedDbUrl;
  try {
    parsedUrl = new URL(url);
    parsedDbUrl = new URL(dbUrl);
  } catch {
    fail("registration_local_db_loopback_required");
  }

  const urlIsExact =
    url === DEFAULT_URL &&
    parsedUrl.protocol === "http:" &&
    parsedUrl.hostname === "127.0.0.1" &&
    parsedUrl.port === "55421";
  const dbIsExact =
    dbUrl === DEFAULT_DB_URL &&
    parsedDbUrl.protocol === "postgresql:" &&
    parsedDbUrl.hostname === "127.0.0.1" &&
    parsedDbUrl.port === "55422" &&
    parsedDbUrl.pathname === "/postgres";
  if (!urlIsExact || !dbIsExact) {
    fail("registration_local_db_loopback_required");
  }
}

export function assertRegistrationCustomerSolapiSafeEnvironment(environment) {
  const present = Object.keys(environment).filter((key) => {
    const value = environment[key];
    if (typeof value !== "string" || value.length === 0) return false;
    if (["APP_ENV", "ENV", "ENVIRONMENT", "NODE_ENV"].includes(key)) {
      return ["prod", "production"].includes(value.toLowerCase());
    }
    return GUARDED_ENVIRONMENT_EXACT_KEYS.has(key)
      || GUARDED_ENVIRONMENT_PREFIXES.some((prefix) => key.startsWith(prefix));
  });
  if (present.length > 0) {
    fail("registration_local_db_forbidden_environment", present.sort().join(","));
  }
}

export function buildRegistrationCustomerSolapiLocalEnvironment(environment = process.env) {
  const safe = {};
  for (const key of LOCAL_CHILD_ENVIRONMENT_KEYS) {
    if (typeof environment[key] === "string" && environment[key].length > 0) {
      safe[key] = environment[key];
    }
  }
  safe.SUPABASE_INTERNAL_IMAGE_REGISTRY = "";
  return safe;
}

function exactResourceManifest(projectId) {
  return [
    { kind: "container", name: `supabase_db_${projectId}`, projectId },
    { kind: "network", name: `supabase_network_${projectId}`, projectId },
    { kind: "volume", name: `supabase_db_${projectId}`, projectId },
  ];
}

export function buildRegistrationCustomerSolapiQaPlan({
  repositoryRoot,
  url,
  dbUrl,
  projectId,
  runtimeRoot,
}) {
  return {
    cliPath: CLI_PATH,
    cliVersion: CLI_VERSION,
    url,
    dbUrl,
    projectId,
    runtimeRoot,
    pgTapPath: PG_TAP_PATH,
    syntheticRowsOnly: true,
    requiredProviderEnvironment: [],
    providerCalls: 0,
    concurrencyProbe: ["two-client-claim", "marker-replay"],
    startCommand: [
      CLI_PATH,
      "db",
      "start",
      "--workdir",
      runtimeRoot,
    ],
    pgTapCommand: [
      CLI_PATH,
      "test",
      "db",
      "--workdir",
      runtimeRoot,
      PG_TAP_PATH,
      "--db-url",
      dbUrl,
    ],
    cleanupCommand: [
      CLI_PATH,
      "stop",
      "--workdir",
      runtimeRoot,
      "--project-id",
      projectId,
      "--no-backup",
      "--yes",
    ],
    repositoryRoot,
    containerName: `supabase_db_${projectId}`,
    resourceManifest: exactResourceManifest(projectId),
  };
}

function cleanupManifest() {
  return {
    strategy: "exact-created-resources-only",
    projectIdPrefix: PROJECT_ID_PREFIX,
    containerNamePrefix: CONTAINER_PREFIX,
    removeTemporaryWorkdir: true,
    verifyNoLeftovers: true,
  };
}

function dryRunReport(repositoryRoot, url, dbUrl) {
  const projectId = `${PROJECT_ID_PREFIX}<12-random-hex>`;
  const runtimeRoot = path.join(os.tmpdir(), `${WORKDIR_PREFIX}<random>`);
  return {
    mode: "dry-run",
    approvedLocalDb: false,
    url,
    dbUrl,
    observed: {
      childProcesses: 0,
      dockerActions: 0,
      databaseActions: 0,
      networkRequests: 0,
      providerCalls: 0,
    },
    plan: buildRegistrationCustomerSolapiQaPlan({
      repositoryRoot,
      url,
      dbUrl,
      projectId,
      runtimeRoot,
    }),
    cleanup: cleanupManifest(),
  };
}

async function prepareRuntimeDefault({ repositoryRoot, runtimeRoot, projectId }) {
  const supabaseRoot = path.join(runtimeRoot, "supabase");
  await mkdir(path.join(supabaseRoot, "tests"), { recursive: true });
  await mkdir(path.join(supabaseRoot, "migrations"), { recursive: true });
  await writeFile(
    path.join(
      supabaseRoot,
      "migrations/00000000000000_registration_customer_solapi_local_qa_prerequisites.sql",
    ),
    localQaPrerequisiteSql(),
    "utf8",
  );
  for (const migration of MESSAGE_MIGRATIONS) {
    await cp(
      path.join(repositoryRoot, "supabase/migrations", migration),
      path.join(supabaseRoot, "migrations", migration),
    );
  }
  await cp(
    path.join(repositoryRoot, PG_TAP_PATH),
    path.join(runtimeRoot, PG_TAP_PATH),
  );
  await writeFile(
    path.join(supabaseRoot, "config.toml"),
    [
      `project_id = "${projectId}"`,
      "",
      "[api]",
      "enabled = false",
      "port = 55421",
      "",
      "[db]",
      "port = 55422",
      "shadow_port = 55420",
      "major_version = 15",
      "",
      "[db.migrations]",
      "enabled = true",
      "",
      "[db.seed]",
      "enabled = false",
      "",
    ].join("\n"),
    "utf8",
  );
}

function localQaPrerequisiteSql() {
  return `
create extension if not exists pgcrypto;
create extension if not exists pgtap;
create schema if not exists dashboard_private;

do $$
begin
  if pg_catalog.to_regprocedure('public.unlike(text,text,text)') is null then
    execute $function$
      create function public.unlike(text, text, text)
      returns text language sql as 'select public.ok($1 not like $2, $3)'
    $function$;
  end if;
end;
$$;

create table public.profiles (
  id uuid primary key,
  role text not null,
  name text,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.classes (
  id uuid primary key,
  name text not null,
  class_type text,
  subject text,
  grade text,
  teacher text,
  schedule text,
  room text,
  capacity integer,
  fee numeric,
  status text,
  student_ids jsonb default '[]'::jsonb,
  waitlist_ids jsonb default '[]'::jsonb,
  textbook_ids jsonb default '[]'::jsonb,
  lessons jsonb default '[]'::jsonb,
  schedule_plan jsonb,
  schedule_revision bigint not null default 0,
  schedule_storage_mode text not null default 'legacy',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.textbooks (
  id uuid primary key,
  name text not null,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.class_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  weekday smallint not null,
  start_time time not null,
  end_time time not null,
  teacher_name text not null default '',
  classroom_name text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.class_lesson_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  session_key text not null,
  source_schedule_slot_id uuid
    references public.class_schedule_slots(id) on delete set null,
  session_date date not null,
  schedule_state text not null,
  start_time time,
  end_time time,
  teacher_name_snapshot text not null default '',
  classroom_name_snapshot text not null default '',
  origin text not null default 'manual',
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(class_id, session_key)
);

create table dashboard_private.continuous_class_schedule_runtime (
  singleton boolean primary key default true check (singleton),
  version integer not null default 0 check (version in (0, 1))
);
insert into dashboard_private.continuous_class_schedule_runtime(singleton, version)
values (true, 0);

create function public.continuous_class_schedule_runtime_version()
returns integer language sql stable security definer set search_path = '' as $$
  select version
  from dashboard_private.continuous_class_schedule_runtime
  where singleton = true;
$$;

create table public.ops_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null,
  status text not null default 'requested',
  priority text not null default 'normal',
  requested_by uuid references public.profiles(id) on delete set null,
  assignee_id uuid references public.profiles(id) on delete set null,
  secondary_assignee_id uuid references public.profiles(id) on delete set null,
  student_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ops_registration_details (
  task_id uuid primary key references public.ops_tasks(id) on delete cascade,
  parent_phone text,
  common_revision bigint not null default 1,
  admission_notice_sent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ops_registration_subject_tracks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  subject text not null,
  pipeline_status text not null,
  director_profile_id uuid references public.profiles(id) on delete restrict,
  director_assignment_source text,
  director_assignment_rule_key text,
  director_assigned_at timestamptz,
  waiting_kind text,
  migration_review_required boolean not null default false,
  workflow_status text not null default 'inquiry',
  workflow_revision bigint not null default 1,
  workflow_status_entered_at timestamptz not null default now(),
  waiting_detail_kind text,
  waiting_detail_class_id uuid references public.classes(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id, subject)
);

create table public.ops_registration_appointments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  kind text not null,
  scheduled_at timestamptz not null,
  place text not null,
  status text not null default 'scheduled',
  notification_revision integer not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dashboard_private.registration_customer_reminder_jobs (
  appointment_id uuid primary key
    references public.ops_registration_appointments(id) on delete restrict,
  task_id uuid not null references public.ops_tasks(id) on delete restrict,
  source_revision bigint not null,
  scheduled_for timestamptz not null,
  due_at timestamptz not null,
  available_at timestamptz,
  request_key uuid not null unique default gen_random_uuid(),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'dispatching', 'completed', 'canceled')),
  claim_token uuid,
  claim_expires_at timestamptz,
  message_id uuid,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ops_registration_level_tests (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.ops_registration_subject_tracks(id) on delete cascade,
  appointment_id uuid not null references public.ops_registration_appointments(id) on delete restrict,
  attempt_number integer not null,
  status text not null default 'scheduled',
  started_at timestamptz,
  completed_at timestamptz,
  material_link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(track_id, attempt_number),
  unique(appointment_id, track_id)
);

create table public.ops_registration_consultations (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.ops_registration_subject_tracks(id) on delete cascade,
  appointment_id uuid references public.ops_registration_appointments(id) on delete restrict,
  mode text not null,
  status text not null,
  director_profile_id uuid not null references public.profiles(id) on delete restrict,
  completed_at timestamptz,
  outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ops_registration_enrollments (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.ops_registration_subject_tracks(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete restrict,
  textbook_id uuid references public.textbooks(id) on delete restrict,
  admission_batch_id uuid,
  class_start_date date,
  class_start_session_key text,
  class_start_session text,
  class_start_lesson_session_id uuid
    references public.class_lesson_sessions(id) on delete set null,
  status text not null default 'planned',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ops_registration_messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  template_key text not null,
  request_key text not null unique,
  status text not null,
  claim_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ops_task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  field_name text,
  before_value text,
  after_value text,
  created_at timestamptz not null default now()
);

create table dashboard_private.ops_registration_mutations (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_key text not null,
  task_id uuid not null references public.ops_tasks(id) on delete cascade,
  mutation_type text not null,
  target_fingerprint jsonb not null,
  response_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(actor_id, request_key)
);

create function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create function dashboard_private.notification_canonical_json_v1(p_value jsonb)
returns text language plpgsql immutable strict security definer set search_path = '' as $$
declare
  v_type text := pg_catalog.jsonb_typeof(p_value);
  v_result text;
begin
  if v_type = 'null' then return 'null';
  elsif v_type in ('boolean', 'number') then return p_value::text;
  elsif v_type = 'string' then return pg_catalog.to_jsonb(p_value #>> '{}')::text;
  elsif v_type = 'array' then
    select '[' || coalesce(pg_catalog.string_agg(
      dashboard_private.notification_canonical_json_v1(item.value),
      ',' order by item.ordinality
    ), '') || ']'
    into v_result
    from pg_catalog.jsonb_array_elements(p_value) with ordinality item(value, ordinality);
    return v_result;
  elsif v_type = 'object' then
    select '{' || coalesce(pg_catalog.string_agg(
      pg_catalog.to_jsonb(item.key)::text || ':' ||
        dashboard_private.notification_canonical_json_v1(item.value),
      ',' order by item.key
    ), '') || '}'
    into v_result
    from pg_catalog.jsonb_each(p_value) item(key, value);
    return v_result;
  end if;
  raise exception 'notification_canonical_json_invalid' using errcode = '22023';
end;
$$;

create function dashboard_private.notification_sha256_hex_v1(p_value text)
returns text language sql stable strict security definer set search_path = '' as $$
  select pg_catalog.encode(extensions.digest(p_value, 'sha256'), 'hex');
$$;
`;
}

async function runCommandDefault(command, _label, options = {}) {
  const [executable, ...args] = command;
  try {
    return await execFileAsync(executable, args, {
      cwd: options.cwd,
      env: buildRegistrationCustomerSolapiLocalEnvironment(),
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join("\n")
      .trim();
    throw new Error(
      `${error.message}${output ? `\n${output}` : ""}`,
    );
  }
}

async function inspectResourcesDefault(projectId) {
  const labelKey = "com.supabase.cli.project";
  const resourceCommands = [
    ["container", ["ps", "-a", "--filter", `label=${labelKey}=${projectId}`, "--format", `{{.Label \"${labelKey}\"}}|{{.Names}}`]],
    ["network", ["network", "ls", "--filter", `label=${labelKey}=${projectId}`, "--format", `{{.Label \"${labelKey}\"}}|{{.Name}}`]],
    ["volume", ["volume", "ls", "--filter", `label=${labelKey}=${projectId}`, "--format", `{{.Label \"${labelKey}\"}}|{{.Name}}`]],
  ];
  const resources = [];
  for (const [kind, args] of resourceCommands) {
    const { stdout } = await execFileAsync("docker", args, {
      env: buildRegistrationCustomerSolapiLocalEnvironment(),
    });
    resources.push(
      ...stdout
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          const [label, name] = value.split("|", 2);
          return { kind, name, projectId: label };
        }),
    );
  }
  return resources;
}

function assertExecutionProvenance(options) {
  if (!PROJECT_ID_PATTERN.test(options.projectId ?? "")) {
    fail("registration_local_db_project_identity_rejected");
  }
  const resolvedRuntimeRoot = path.resolve(options.runtimeRoot ?? "");
  const expectedParent = path.resolve(os.tmpdir());
  const basename = path.basename(resolvedRuntimeRoot);
  if (
    path.dirname(resolvedRuntimeRoot) !== expectedParent
    || !basename.startsWith(WORKDIR_PREFIX)
    || !/^[A-Za-z0-9_-]+$/u.test(basename.slice(WORKDIR_PREFIX.length))
  ) {
    fail("registration_local_db_runtime_provenance_rejected");
  }
  validateExactLoopback(options.url, options.dbUrl);
}

function exactOwnedResources(resources, projectId) {
  if (!Array.isArray(resources)) fail("registration_local_db_resource_inspection_invalid");
  const expected = exactResourceManifest(projectId);
  const expectedKeys = new Set(expected.map(({ kind, name }) => `${kind}:${name}`));
  const owned = [];
  for (const resource of resources) {
    if (resource?.projectId !== projectId) continue;
    if (
      !["container", "network", "volume"].includes(resource.kind)
      || typeof resource.name !== "string"
      || !expectedKeys.has(`${resource.kind}:${resource.name}`)
    ) {
      fail("registration_local_db_resource_ownership_rejected");
    }
    owned.push(Object.freeze({
      kind: resource.kind,
      name: resource.name,
      projectId,
    }));
  }
  return owned;
}

function assertCreatedResourceManifest(resources, expected) {
  const actualKeys = resources.map(({ kind, name }) => `${kind}:${name}`).sort();
  const expectedKeys = expected.map(({ kind, name }) => `${kind}:${name}`).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail("registration_local_db_created_resource_manifest_rejected");
  }
}

async function removeResourcesDefault(resources, projectId) {
  const owned = exactOwnedResources(resources, projectId);
  const commands = {
    container: ["rm", "-f"],
    volume: ["volume", "rm"],
    network: ["network", "rm"],
  };
  const errors = [];
  for (const kind of ["container", "volume", "network"]) {
    for (const resource of owned.filter((entry) => entry.kind === kind)) {
      try {
        await execFileAsync("docker", [...commands[kind], resource.name], {
          env: buildRegistrationCustomerSolapiLocalEnvironment(),
        });
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`registration_local_db_exact_fallback_failed: ${errors.length}`);
  }
}

async function removeRuntimeDefault(target) {
  const resolved = path.resolve(target);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (
    !resolved.startsWith(tempRoot) ||
    !path.basename(resolved).startsWith(WORKDIR_PREFIX)
  ) {
    fail("registration_local_db_cleanup_target_rejected");
  }
  await rm(resolved, { recursive: true, force: true });
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseJsonOutput(stdout, label) {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  try {
    return JSON.parse(lines.at(-1));
  } catch {
    fail("registration_local_db_probe_invalid_json", label);
  }
}

function psqlCommand(containerName, sql) {
  return [
    "docker",
    "exec",
    "-i",
    containerName,
    "psql",
    "-X",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-c",
    sql,
  ];
}

function probeSeedSql() {
  return `
insert into public.profiles(id, role, name, email, created_at, updated_at)
values ('96000000-0000-4000-8000-000000000001', 'admin', 'Synthetic Registration QA', 'synthetic-registration-qa@example.invalid', now(), now());
insert into public.ops_tasks(id, title, type, status, priority, requested_by, student_name)
values ('96000000-0000-4000-8000-000000000002', 'Synthetic Registration SOLAPI concurrency', 'registration', 'requested', 'normal', '96000000-0000-4000-8000-000000000001', '합성학생');
insert into public.ops_registration_details(task_id, parent_phone, common_revision, admission_notice_sent)
values ('96000000-0000-4000-8000-000000000002', '010-0000-1234', 1, false);
insert into public.ops_registration_subject_tracks(
  id, task_id, subject, pipeline_status, director_assignment_source,
  waiting_kind, migration_review_required, workflow_status, workflow_revision,
  workflow_status_entered_at, waiting_detail_kind, waiting_detail_class_id
) values (
  '96000000-0000-4000-8000-000000000003',
  '96000000-0000-4000-8000-000000000002',
  '영어', 'inquiry', 'unassigned', null, false, 'enrollment_requested', 1,
  now(), null, null
);
insert into public.classes(
  id, name, class_type, subject, grade, teacher, schedule, room,
  capacity, fee, status, student_ids, waitlist_ids, textbook_ids,
  lessons, schedule_plan, schedule_revision, schedule_storage_mode
) values (
  '96000000-0000-4000-8000-000000000004',
  'Synthetic admission class',
  '정규', '영어', '중2', '홍길동', '월수 18:00-20:00', '본관 301호',
  12, 100000, '수업 진행 중', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  '[]'::jsonb,
  '{"sessions":[{"date":"2026-08-17","sessionNumber":1,"scheduleState":"active","startTime":"18:00","endTime":"20:00"}]}'::jsonb,
  1, 'legacy'
);
insert into public.ops_registration_enrollments(
  id, track_id, class_id, class_start_date, class_start_session_key,
  class_start_session, status, sort_order
) values (
  '96000000-0000-4000-8000-000000000005',
  '96000000-0000-4000-8000-000000000003',
  '96000000-0000-4000-8000-000000000004',
  '2026-08-17', '2026-08-17:1', '1회차', 'planned', 0
);
insert into dashboard_private.registration_customer_solapi_template_receipts(
  message_kind, template_id, pf_id, catalog_checksum, provider_checksum,
  provider_status, verified_by
) values (
  'admission_application', 'synthetic-task9-template', 'synthetic-task9-pf',
  repeat('c', 64), repeat('c', 64), 'sendable',
  '96000000-0000-4000-8000-000000000001'
)
on conflict (message_kind) do update set
  template_id = excluded.template_id,
  pf_id = excluded.pf_id,
  catalog_checksum = excluded.catalog_checksum,
  provider_checksum = excluded.provider_checksum,
  provider_status = excluded.provider_status,
  verified_by = excluded.verified_by;
update dashboard_private.registration_customer_solapi_activation
set mode = 'verification',
    verification_task_id = '96000000-0000-4000-8000-000000000002',
    verification_recipient_hash = repeat('b', 64),
    updated_by = '96000000-0000-4000-8000-000000000001'
where message_kind = 'admission_application';
set role service_role;
with source as (
  select public.resolve_registration_customer_message_source_v1(
    '96000000-0000-4000-8000-000000000001',
    'admission_application',
    '96000000-0000-4000-8000-000000000002'
  ) response
), contract as (
  select pg_catalog.jsonb_build_object(
    'parentPhoneDigits', response ->> 'parentPhoneDigits',
    'sourceFingerprint', repeat('a', 64),
    'recipientHash', repeat('b', 64),
    'templateKey', 'admission_application',
    'templateRevision', 1,
    'templateChecksum', repeat('c', 64),
    'renderedVariablesChecksum', repeat('d', 64),
    'renderedBodyChecksum', repeat('e', 64),
    'renderedButtonsChecksum', repeat('f', 64)
  ) value
  from source
), first_preview as (
  select public.create_registration_customer_message_preview_v1(
    '96000000-0000-4000-8000-000000000001',
    'admission_application',
    '96000000-0000-4000-8000-000000000002',
    (select value from contract)
  ) response
), second_preview as (
  select public.create_registration_customer_message_preview_v1(
    '96000000-0000-4000-8000-000000000001',
    'admission_application',
    '96000000-0000-4000-8000-000000000002',
    (select value from contract)
  ) response
)
select pg_catalog.json_build_object(
  'firstPreviewId', (select response ->> 'previewId' from first_preview),
  'secondPreviewId', (select response ->> 'previewId' from second_preview),
  'contract', (select value from contract)
);
`;
}

async function runConcurrencyProbeDefault(plan, runCommand) {
  const seed = await runCommand(
    psqlCommand(plan.containerName, probeSeedSql()),
    "probeSeed",
  );
  const setup = parseJsonOutput(seed.stdout, "seed");
  const contractLiteral = `${sqlLiteral(JSON.stringify(setup.contract))}::jsonb`;
  const claim = (previewId, requestKey) =>
    psqlCommand(
      plan.containerName,
      `set role service_role; select public.claim_registration_customer_message_v1(` +
        `${sqlLiteral("96000000-0000-4000-8000-000000000001")}::uuid,` +
        `${sqlLiteral(previewId)}::uuid,${sqlLiteral(requestKey)},${contractLiteral});`,
    );
  const [first, second] = await Promise.all([
    runCommand(
      claim(
        setup.firstPreviewId,
        "96000000-0000-4000-8000-000000000011",
      ),
      "claimClientOne",
    ),
    runCommand(
      claim(
        setup.secondPreviewId,
        "96000000-0000-4000-8000-000000000012",
      ),
      "claimClientTwo",
    ),
  ]);
  const claims = [
    parseJsonOutput(first.stdout, "claim-one"),
    parseJsonOutput(second.stdout, "claim-two"),
  ];
  const owners = claims.filter((response) => response.owner === true);
  if (owners.length !== 1) {
    fail("registration_local_db_concurrency_owner_count", String(owners.length));
  }

  const owner = owners[0];
  const markerSql = `set role service_role; select public.mark_registration_customer_message_attempt_started_v1(` +
    `${sqlLiteral(owner.messageId)}::uuid,${sqlLiteral(owner.claimToken)}::uuid,` +
    `${sqlLiteral(owner.dispatchToken)}::uuid,${contractLiteral});`;
  const firstMarker = parseJsonOutput(
    (
      await runCommand(
        psqlCommand(plan.containerName, markerSql),
        "markerFirst",
      )
    ).stdout,
    "marker-first",
  );
  const replayMarker = parseJsonOutput(
    (
      await runCommand(
        psqlCommand(plan.containerName, markerSql),
        "markerReplay",
      )
    ).stdout,
    "marker-replay",
  );
  if (firstMarker.allowed !== true || replayMarker.allowed !== false) {
    fail("registration_local_db_marker_replay_failed");
  }

  return {
    claimClients: 2,
    ownerCount: 1,
    firstMarkerAllowed: true,
    replayMarkerAllowed: false,
    providerCalls: 0,
  };
}

export async function runRegistrationCustomerSolapiLocalDbQa(
  options,
  dependencies = {},
) {
  assertExecutionProvenance(options);
  assertRegistrationCustomerSolapiSafeEnvironment(
    dependencies.environment ?? process.env,
  );
  const plan = buildRegistrationCustomerSolapiQaPlan(options);
  const prepareRuntime = dependencies.prepareRuntime ?? prepareRuntimeDefault;
  const runCommand = dependencies.runCommand ?? runCommandDefault;
  const inspectResources = dependencies.inspectResources ?? inspectResourcesDefault;
  const removeResources = dependencies.removeResources ?? removeResourcesDefault;
  const removeRuntime = dependencies.removeRuntime ?? removeRuntimeDefault;
  const runConcurrencyProbe =
    dependencies.runConcurrencyProbe ?? runConcurrencyProbeDefault;
  const errors = [];
  const leftoverEvidence = [];
  let probe;
  let preflightPassed = false;
  let startAttempted = false;

  try {
    try {
      const preflight = exactOwnedResources(
        await inspectResources(options.projectId),
        options.projectId,
      );
      if (preflight.length > 0) {
        throw new Error(
          `registration_local_db_preexisting_resources: ${preflight.map(({ kind, name }) => `${kind}:${name}`).join(",")}`,
        );
      }
      preflightPassed = true;
    } catch (error) {
      errors.push({ stage: "preflight", error });
    }

    if (preflightPassed) {
      try {
        await prepareRuntime(options);
        startAttempted = true;
        await runCommand(plan.startCommand, "dbStart", { cwd: options.repositoryRoot });
        const createdResources = exactOwnedResources(
          await inspectResources(options.projectId),
          options.projectId,
        );
        assertCreatedResourceManifest(createdResources, plan.resourceManifest);
        await runCommand(plan.pgTapCommand, "pgTap", { cwd: options.runtimeRoot });
        probe = await runConcurrencyProbe(plan, runCommand);
      } catch (error) {
        errors.push({ stage: "execution", error });
      }
    }
  } finally {
    if (startAttempted) {
      try {
        await runCommand(plan.cleanupCommand, "cleanup", {
          cwd: options.repositoryRoot,
        });
      } catch (error) {
        errors.push({ stage: "cleanup-command", error });
      }

      let leftovers = [];
      try {
        leftovers = exactOwnedResources(
          await inspectResources(options.projectId),
          options.projectId,
        );
        leftoverEvidence.push(...leftovers);
      } catch (error) {
        errors.push({ stage: "cleanup-inspection", error });
      }

      if (leftovers.length > 0) {
        try {
          await removeResources(leftovers, options.projectId);
        } catch (error) {
          errors.push({ stage: "cleanup-fallback", error });
        } finally {
          try {
            const remaining = exactOwnedResources(
              await inspectResources(options.projectId),
              options.projectId,
            );
            if (remaining.length > 0) {
              leftoverEvidence.push(...remaining);
              errors.push({
                stage: "cleanup-leftovers",
                error: new Error("registration_local_db_cleanup_leftovers"),
              });
            }
          } catch (error) {
            errors.push({ stage: "cleanup-reinspection", error });
          }
        }
      }
    }

    try {
      await removeRuntime(options.runtimeRoot);
    } catch (error) {
      errors.push({ stage: "workdir-removal", error });
    }
  }

  if (errors.length > 0) {
    const safeDetails = errors.map(({ stage, error }) => {
      const redacted = String(error?.message ?? "unknown")
        .replace(/:\/\/[^\s:@/]+:[^\s@/]+@/gu, "://<redacted>@")
      const lines = redacted
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const message = lines.length <= 1
        ? (lines[0] ?? "unknown")
        : `${lines[0]} :: ${lines.slice(-5).join(" | ")}`;
      return `${stage}=${message}`;
    });
    const evidence = [...new Set(leftoverEvidence.map(({ kind, name }) => `${kind}:${name}`))];
    if (evidence.length > 0) safeDetails.push(`leftovers=${evidence.join(",")}`);
    throw new Error(`registration_local_db_qa_failed: ${safeDetails.join(" | ")}`);
  }
  return {
    mode: "executed-local-db",
    url: options.url,
    dbUrl: options.dbUrl,
    projectId: options.projectId,
    pgTap: "passed",
    concurrency: probe,
    providerCalls: 0,
    cleanup: { status: "passed", leftovers: [] },
  };
}

async function main() {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const parsed = parseArgs(process.argv.slice(2));
  validateExactLoopback(parsed.url, parsed.dbUrl);

  if (parsed.execute !== parsed.approvedLocalDb) {
    fail("registration_local_db_approval_required");
  }
  if (!parsed.execute) {
    process.stdout.write(
      `${JSON.stringify(dryRunReport(repositoryRoot, parsed.url, parsed.dbUrl), null, 2)}\n`,
    );
    return;
  }

  assertRegistrationCustomerSolapiSafeEnvironment(process.env);
  const suffix = randomBytes(6).toString("hex");
  const projectId = `${PROJECT_ID_PREFIX}${suffix}`;
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), WORKDIR_PREFIX));
  const report = await runRegistrationCustomerSolapiLocalDbQa({
    repositoryRoot,
    url: parsed.url,
    dbUrl: parsed.dbUrl,
    projectId,
    runtimeRoot,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
