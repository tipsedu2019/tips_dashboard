import { execFile } from "node:child_process";
import { randomBytes as defaultRandomBytes } from "node:crypto";
import {
  cp,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const nodeHttp = require("node:http");
const nodeHttps = require("node:https");

export const PINNED_SUPABASE_GO =
  "/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go";
export const PINNED_SUPABASE_VERSION = "2.103.0";

const LOOPBACK_HOST = "127.0.0.1";
const MIN_DYNAMIC_PORT = 49152;
const MAX_DYNAMIC_PORT = 65535;
const PORT_COUNT = 4;
const PORT_ALLOCATION_ATTEMPTS = 32;
const PROJECT_ID_PREFIX = "tips_obs_provider_zero_";
const PROJECT_ID_PATTERN = /^tips_obs_provider_zero_[a-f0-9]{12}$/u;
const WORKDIR_PREFIX = "tips-registration-observation-provider-zero-";
const LEASE_ROOT_PREFIX = "tips-registration-observation-provider-zero-port-leases-";
const LEASE_ROOT = path.join(
  os.tmpdir(),
  "tips-registration-observation-provider-zero-port-leases-v1",
);
const MIGRATION_CEILING = "20260809105000";
const GOOGLE_CHAT_TEST_PATH =
  "supabase/tests/registration_observation_google_chat_test.sql";
const FORWARD_MIGRATION_SUFFIX = "_notification_adapters_forward_install.sql";
const FORWARD_PGTAP_PATH = "supabase/tests/notification_adapters_forward_install_test.sql";
const PENDING_SCHEDULE_MIGRATION_SUFFIX =
  "_notification_delivery_pending_schedule_fix.sql";
const PENDING_SCHEDULE_PGTAP_PATH =
  "supabase/tests/notification_delivery_pending_schedule_test.sql";
const FORWARD_MIGRATION_PACKAGES = Object.freeze([
  Object.freeze({
    migrationSuffix: FORWARD_MIGRATION_SUFFIX,
    pgTapPath: FORWARD_PGTAP_PATH,
    focusDirectory: "notification-adapters-forward-install",
  }),
  Object.freeze({
    migrationSuffix: PENDING_SCHEDULE_MIGRATION_SUFFIX,
    pgTapPath: PENDING_SCHEDULE_PGTAP_PATH,
    focusDirectory: "notification-delivery-pending-schedule",
  }),
]);
const CORE_RECEIPT = "registration_observation_provider_zero_core_receipt";
const SAFE_CHILD_ENVIRONMENT_KEYS = [
  "HOME",
  "LANG",
  "PATH",
  "SHELL",
  "TMPDIR",
  "USER",
];

function fail(code, detail = "") {
  throw new Error(`${code}${detail ? `:${detail}` : ""}`);
}

export function parseProviderZeroArguments(argv) {
  if (
    !Array.isArray(argv)
    || argv.length !== 2
    || argv[0] !== "--execute"
    || argv[1] !== "--approved-local-db"
  ) {
    throw new Error(
      "registration_observation_google_chat_provider_zero_execute_required",
    );
  }
  return Object.freeze({ execute: true, approvedLocalDb: true });
}

export function assertProviderZeroEnvironment(env) {
  const environment = env ?? {};
  const forbidden = Object.keys(environment).filter((key) =>
    /SUPABASE_(URL|KEY|DB_PASSWORD)|GOOGLE_CHAT|SOLAPI|WEBHOOK/i.test(key),
  );
  if (forbidden.length > 0) {
    throw new Error("provider_zero_secret_environment_forbidden");
  }
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) =>
      SAFE_CHILD_ENVIRONMENT_KEYS.includes(key),
    ),
  );
}

export function registrationObservationProviderZeroPrerequisiteSql() {
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
  role text not null default 'viewer',
  name text,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.classes (
  id uuid primary key,
  name text not null,
  subject text,
  grade text,
  teacher text,
  schedule text,
  room text,
  capacity integer,
  fee numeric,
  start_date date,
  end_date date,
  student_ids jsonb default '[]'::jsonb,
  waitlist_ids jsonb default '[]'::jsonb,
  textbook_ids jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  uid text,
  contact text,
  parent_contact text,
  school text,
  grade text,
  enroll_date date,
  class_ids jsonb not null default '[]'::jsonb,
  waitlist_class_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.textbooks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text,
  publisher text,
  price numeric default 0,
  tags text[] not null default '{}',
  lessons jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.progress_logs (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  textbook_id uuid references public.textbooks(id) on delete set null,
  chapter_id text,
  completed_lesson_ids jsonb not null default '[]'::jsonb,
  date date,
  content text,
  homework text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.academic_schools (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  color text,
  textbooks jsonb default '{}'::jsonb,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.academic_curriculum_profiles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.academic_schools(id) on delete cascade,
  grade text,
  subject text,
  main_textbook_title text,
  main_textbook_publisher text,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.academic_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  date date not null,
  type text,
  school_id uuid references public.academic_schools(id) on delete set null,
  grade text default 'all',
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
`;
}

export function registrationObservationProviderZeroHistoryFixtureSql() {
  return `
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '96000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'local-science-director@example.invalid',
  crypt('local-migration-history-only', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"name":"김법균","teacher_team":"과학팀"}'::jsonb,
  now(),
  now()
);
`;
}

function ownedRuntimeRoot(value) {
  if (typeof value !== "string") return false;
  const resolved = path.resolve(value);
  return path.dirname(resolved) === path.resolve(os.tmpdir())
    && path.basename(resolved).startsWith(WORKDIR_PREFIX);
}

function ownedLeaseRoot(value) {
  if (typeof value !== "string") return false;
  const resolved = path.resolve(value);
  return path.dirname(resolved) === path.resolve(os.tmpdir())
    && path.basename(resolved).startsWith(LEASE_ROOT_PREFIX);
}

function exactResources(projectId) {
  return [
    `supabase_db_${projectId}`,
    `supabase_network_${projectId}`,
    `supabase_db_${projectId}`,
  ];
}

function providerZeroConfigToml(projectId, ports) {
  return [
    `project_id = "${projectId}"`,
    "",
    "[api]",
    "enabled = false",
    `port = ${ports.apiPort}`,
    "",
    "[db]",
    `port = ${ports.dbPort}`,
    `shadow_port = ${ports.shadowPort}`,
    "major_version = 15",
    "",
    "[db.pooler]",
    "enabled = false",
    `port = ${ports.poolerPort}`,
    "",
    "[db.migrations]",
    "enabled = true",
    "",
    "[db.seed]",
    "enabled = false",
    "",
  ].join("\n");
}

async function defaultSpawnImpl(executable, args, options) {
  return execFileAsync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function allocateFreeLoopbackPort(host = LOOPBACK_HOST) {
  if (host !== LOOPBACK_HOST) {
    fail("registration_observation_google_chat_provider_zero_port_host_rejected");
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    let settled = false;
    const reject = (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(
        new Error(
          `registration_observation_google_chat_provider_zero_port_allocation_failed:${error?.code ?? "unknown"}`,
        ),
      );
    };
    server.unref();
    server.once("error", reject);
    server.listen({ host, port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (settled) return;
        settled = true;
        if (
          error
          || !Number.isInteger(port)
          || port < MIN_DYNAMIC_PORT
          || port > MAX_DYNAMIC_PORT
        ) {
          rejectPromise(
            new Error(
              `registration_observation_google_chat_provider_zero_port_allocation_failed:${error?.code ?? port}`,
            ),
          );
          return;
        }
        resolvePromise(port);
      });
    });
  });
}

async function ensureLeaseRoot(leaseRoot) {
  if (!ownedLeaseRoot(leaseRoot)) {
    fail("registration_observation_google_chat_provider_zero_lease_root_rejected");
  }
  await mkdir(leaseRoot, { recursive: true, mode: 0o700 });
  const metadata = await lstat(leaseRoot);
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o077) !== 0
  ) {
    fail("registration_observation_google_chat_provider_zero_lease_root_rejected");
  }
}

async function acquireLease({ leaseRoot, port, projectId, now = Date.now }) {
  if (
    !PROJECT_ID_PATTERN.test(projectId)
    || !Number.isInteger(port)
    || port < MIN_DYNAMIC_PORT
    || port > MAX_DYNAMIC_PORT
  ) {
    fail("registration_observation_google_chat_provider_zero_lease_rejected");
  }
  await ensureLeaseRoot(leaseRoot);
  const leasePath = path.join(leaseRoot, `${port}.lease`);
  let handle;
  try {
    handle = await open(leasePath, "wx", 0o600);
    const owner = {
      projectId,
      port,
      pid: process.pid,
      createdAtMs: now(),
    };
    await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    return { leasePath, projectId, port, pid: process.pid };
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // The cleanup path owns the visible failure.
    }
    if (error?.code === "EEXIST") {
      const unavailable = new Error(
        `registration_observation_google_chat_provider_zero_lease_unavailable:${port}`,
      );
      unavailable.code = "lease_unavailable";
      throw unavailable;
    }
    throw error;
  }
}

async function releaseLease(claim) {
  const ownerText = await readFile(claim.leasePath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (ownerText === null) return;
  let owner;
  try {
    owner = JSON.parse(ownerText);
  } catch {
    fail("registration_observation_google_chat_provider_zero_lease_ownership_rejected");
  }
  if (
    owner?.projectId !== claim.projectId
    || owner?.port !== claim.port
    || owner?.pid !== claim.pid
  ) {
    fail("registration_observation_google_chat_provider_zero_lease_ownership_rejected");
  }
  await unlink(claim.leasePath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

async function reserveLoopbackPorts({
  projectId,
  allocate = allocateFreeLoopbackPort,
  leaseRoot = LEASE_ROOT,
  now = Date.now,
}) {
  const claims = [];
  const ports = [];
  try {
    for (let attempt = 0; ports.length < PORT_COUNT && attempt < PORT_ALLOCATION_ATTEMPTS; attempt += 1) {
      const port = await allocate(LOOPBACK_HOST);
      if (!Number.isInteger(port) || port < MIN_DYNAMIC_PORT || port > MAX_DYNAMIC_PORT) {
        fail("registration_observation_google_chat_provider_zero_port_rejected");
      }
      if (ports.includes(port)) continue;
      try {
        const claim = await acquireLease({ leaseRoot, port, projectId, now });
        ports.push(port);
        claims.push(claim);
      } catch (error) {
        if (error?.code !== "lease_unavailable") throw error;
      }
    }
    if (ports.length !== PORT_COUNT) {
      fail("registration_observation_google_chat_provider_zero_port_allocation_exhausted");
    }
    const [apiPort, dbPort, shadowPort, poolerPort] = ports;
    return {
      ports: Object.freeze({
        host: LOOPBACK_HOST,
        apiPort,
        dbPort,
        shadowPort,
        poolerPort,
        dbUrl: `postgresql://postgres:postgres@${LOOPBACK_HOST}:${dbPort}/postgres`,
      }),
      claims,
    };
  } catch (error) {
    await Promise.allSettled(claims.map((claim) => releaseLease(claim)));
    throw error;
  }
}

async function listMigrationPaths(repositoryRoot) {
  const root = path.join(repositoryRoot, "supabase/migrations");
  return (await readdir(root))
    .filter((name) => /^[0-9]{14}_.+\.sql$/u.test(name))
    .sort()
    .filter((name) => name.slice(0, 14) <= MIGRATION_CEILING)
    .map((name) => path.join(root, name));
}

async function defaultInspectResources(projectId, childEnvironment) {
  const labelKey = "com.supabase.cli.project";
  const inspections = [
    ["container", ["container", "ps", "-a", "--filter", `label=${labelKey}=${projectId}`, "--format", `{{.Label \"${labelKey}\"}}|{{.Names}}`]],
    ["network", ["network", "ls", "--filter", `label=${labelKey}=${projectId}`, "--format", `{{.Label \"${labelKey}\"}}|{{.Name}}`]],
    ["volume", ["volume", "ls", "--filter", `label=${labelKey}=${projectId}`, "--format", `{{.Label \"${labelKey}\"}}|{{.Name}}`]],
  ];
  const resources = [];
  for (const [kind, args] of inspections) {
    const { stdout } = await defaultSpawnImpl("docker", args, { env: childEnvironment });
    for (const row of String(stdout).split("\n").map((item) => item.trim()).filter(Boolean)) {
      const [label, name] = row.split("|", 2);
      if (label === projectId && name) resources.push({ kind, name, projectId });
    }
  }
  return resources;
}

async function removeExactResources(resources, projectId, childEnvironment, spawnImpl) {
  const allowed = new Set([
    `container:supabase_db_${projectId}`,
    `network:supabase_network_${projectId}`,
    `volume:supabase_db_${projectId}`,
  ]);
  const commands = {
    container: ["rm", "-f"],
    network: ["network", "rm"],
    volume: ["volume", "rm"],
  };
  for (const resource of resources) {
    if (
      resource?.projectId !== projectId
      || !allowed.has(`${resource.kind}:${resource.name}`)
      || !commands[resource.kind]
    ) {
      fail("registration_observation_google_chat_provider_zero_resource_ownership_rejected");
    }
    await spawnImpl("docker", [...commands[resource.kind], resource.name], {
      env: childEnvironment,
    });
  }
}

function psqlCommand(projectId, sql) {
  return [
    "exec",
    "-i",
    `supabase_db_${projectId}`,
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

async function writeProjectFiles(project) {
  const supabaseRoot = path.join(project.runtimeRoot, "supabase");
  const migrationRoot = path.join(supabaseRoot, "migrations");
  const googleChatTestRoot = path.join(supabaseRoot, "focus-tests", "google-chat");
  await mkdir(migrationRoot, { recursive: true });
  await mkdir(googleChatTestRoot, { recursive: true });
  await writeFile(
    path.join(migrationRoot, "00000000000000_registration_observation_local_qa_prerequisites.sql"),
    registrationObservationProviderZeroPrerequisiteSql(),
    "utf8",
  );
  await writeFile(
    path.join(migrationRoot, "20260722141999_registration_observation_local_qa_history_fixture.sql"),
    registrationObservationProviderZeroHistoryFixtureSql(),
    "utf8",
  );
  const migrations = await listMigrationPaths(project.repositoryRoot);
  for (const migrationPath of migrations) {
    await cp(migrationPath, path.join(migrationRoot, path.basename(migrationPath)));
  }
  await cp(
    path.join(project.repositoryRoot, GOOGLE_CHAT_TEST_PATH),
    path.join(googleChatTestRoot, "001_registration_observation_google_chat_test.sql"),
  );
  await writeFile(
    path.join(supabaseRoot, "config.toml"),
    providerZeroConfigToml(project.projectId, project.ports),
    "utf8",
  );
  project.focusTestDirectories.set(GOOGLE_CHAT_TEST_PATH, googleChatTestRoot);
  project.migrations = migrations.map((entry) => path.basename(entry));
}

async function stageForwardMigration(project, resetMigrationBaseline, migrationPath, testPath) {
  if (!project.started || !project.focusTestDirectories.has(GOOGLE_CHAT_TEST_PATH)) {
    fail("registration_observation_google_chat_provider_zero_forward_migration_order_rejected");
  }
  const packageIndex = FORWARD_MIGRATION_PACKAGES.findIndex(
    (forwardPackage) => forwardPackage.pgTapPath === testPath,
  );
  if (packageIndex === -1) {
    fail("registration_observation_google_chat_provider_zero_forward_pgtap_path_rejected");
  }
  const forwardPackage = FORWARD_MIGRATION_PACKAGES[packageIndex];
  if (
    project.focusTestDirectories.has(forwardPackage.pgTapPath)
    || FORWARD_MIGRATION_PACKAGES
      .slice(0, packageIndex)
      .some((requiredPackage) => !project.focusTestDirectories.has(requiredPackage.pgTapPath))
  ) {
    fail("registration_observation_google_chat_provider_zero_forward_migration_order_rejected");
  }
  const migrationsRoot = path.join(project.repositoryRoot, "supabase", "migrations");
  const resolvedMigrationPath = path.resolve(migrationPath ?? "");
  const migrationBaseName = path.basename(resolvedMigrationPath);
  if (
    path.dirname(resolvedMigrationPath) !== migrationsRoot
    || !/^[0-9]{14}/u.test(migrationBaseName)
    || !migrationBaseName.endsWith(forwardPackage.migrationSuffix)
  ) {
    fail("registration_observation_google_chat_provider_zero_forward_migration_path_rejected");
  }
  const migrationStat = await lstat(resolvedMigrationPath).catch(() => null);
  if (!migrationStat?.isFile()) {
    fail("registration_observation_google_chat_provider_zero_forward_migration_path_rejected");
  }
  const testSourcePath = path.join(project.repositoryRoot, testPath);
  const testStat = await lstat(testSourcePath).catch(() => null);
  if (!testStat?.isFile()) {
    fail("registration_observation_google_chat_provider_zero_forward_pgtap_path_rejected");
  }

  const supabaseRoot = path.join(project.runtimeRoot, "supabase");
  const stagedMigrationPath = path.join(supabaseRoot, "migrations", migrationBaseName);
  const forwardTestRoot = path.join(
    supabaseRoot,
    "focus-tests",
    forwardPackage.focusDirectory,
  );
  await mkdir(forwardTestRoot, { recursive: true });
  await cp(resolvedMigrationPath, stagedMigrationPath);
  await cp(testSourcePath, path.join(forwardTestRoot, `001_${path.basename(testSourcePath)}`));
  project.focusTestDirectories.set(forwardPackage.pgTapPath, forwardTestRoot);
  project.migrations = [...project.migrations, migrationBaseName];
  await resetMigrationBaseline();
  return Object.freeze([...project.migrations]);
}

async function forwardMigrationPath(repositoryRoot, testPath = FORWARD_PGTAP_PATH) {
  const forwardPackage = FORWARD_MIGRATION_PACKAGES.find(
    (candidate) => candidate.pgTapPath === testPath,
  );
  if (!forwardPackage) {
    fail("registration_observation_google_chat_provider_zero_forward_pgtap_path_rejected");
  }
  const migrationsRoot = path.join(repositoryRoot, "supabase", "migrations");
  const matches = (await readdir(migrationsRoot))
    .filter((entry) => /^[0-9]{14}/u.test(entry) && entry.endsWith(forwardPackage.migrationSuffix))
    .sort();
  if (matches.length !== 1) {
    fail("registration_observation_google_chat_provider_zero_forward_migration_count_invalid");
  }
  return path.join(migrationsRoot, matches[0]);
}

function coreLifecycleSql() {
  return `
begin;

create temp table registration_observation_provider_zero_core_receipt(
  payload jsonb not null
) on commit drop;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '95100000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'provider-zero-admin@example.invalid',
  crypt('provider-zero-admin-only', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
)
on conflict (id) do update set
  deleted_at = null,
  banned_until = null,
  updated_at = excluded.updated_at;

insert into public.profiles(id, role, name, email, created_at, updated_at)
values (
  '95100000-0000-4000-8000-000000000001',
  'admin',
  'provider-zero 관리자',
  'provider-zero-admin@example.invalid',
  now(),
  now()
)
on conflict (id) do update set
  role = excluded.role,
  name = excluded.name,
  email = excluded.email,
  updated_at = excluded.updated_at;

do $$
declare
  v_readiness jsonb;
  v_activation jsonb;
  v_activation_replay jsonb;
  v_heartbeat_counts jsonb := '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb;
  v_heartbeat jsonb;
  v_enabled boolean;
  v_revision bigint;
  v_settings jsonb;
  v_settings_replay jsonb;
  v_dispatch jsonb;
  v_dispatch_replay jsonb;
begin
  perform set_config('request.jwt.claim.sub', '95100000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_readiness := public.registration_observation_schema_readiness_v1();
  if v_readiness is distinct from '{"schemaReady":true,"missingObjects":[],"runtimeVersion":0}'::jsonb then
    raise exception 'registration_observation_provider_zero_readiness_receipt_invalid';
  end if;
  v_activation := public.activate_registration_observation_runtime_v1(
    0,
    'provider-zero-google-chat-activate-v1'
  );
  v_activation_replay := public.activate_registration_observation_runtime_v1(
    0,
    'provider-zero-google-chat-activate-v1'
  );
  if v_activation is distinct from v_activation_replay
    or v_activation ->> 'operation' is distinct from 'activate'
    or v_activation ->> 'requestKey' is distinct from 'provider-zero-google-chat-activate-v1'
    or (v_activation ->> 'previousVersion')::integer <> 0
    or (v_activation ->> 'runtimeVersion')::integer <> 1
    or v_activation -> 'readiness' is distinct from v_readiness
  then
    raise exception 'registration_observation_provider_zero_activation_receipt_invalid';
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform public.record_notification_worker_heartbeat_v1(
    'notification-worker-route-v1',
    '95100000-0000-4000-8000-000000000010',
    'started',
    v_heartbeat_counts,
    null
  );
  perform public.record_notification_worker_heartbeat_v1(
    'notification-worker-route-v1',
    '95100000-0000-4000-8000-000000000010',
    'succeeded',
    v_heartbeat_counts,
    null
  );
  select jsonb_build_object(
    'workerId', heartbeat.worker_id,
    'phase', heartbeat.phase,
    'counts', heartbeat.counts,
    'errorCode', heartbeat.error_code
  ) into strict v_heartbeat
  from dashboard_private.notification_worker_heartbeats heartbeat
  where heartbeat.worker_id = 'notification-worker-route-v1'
    and heartbeat.run_id = '95100000-0000-4000-8000-000000000010'
    and heartbeat.phase = 'succeeded';
  if v_heartbeat is distinct from jsonb_build_object(
    'workerId', 'notification-worker-route-v1',
    'phase', 'succeeded',
    'counts', v_heartbeat_counts,
    'errorCode', null
  ) then
    raise exception 'registration_observation_provider_zero_heartbeat_receipt_invalid';
  end if;

  select enabled, revision into strict v_enabled, v_revision
  from dashboard_private.notification_runtime_flags
  where flag_key = 'notification_control_plane_settings_ui_enabled'
  for update;
  if v_enabled or v_revision <> 1 then
    raise exception 'registration_observation_provider_zero_settings_flag_baseline_invalid';
  end if;
  v_settings := public.set_notification_runtime_flag_v1(
    'notification_control_plane_settings_ui_enabled',
    true,
    v_revision,
    '95100000-0000-4000-8000-000000000011'
  );
  v_settings_replay := public.set_notification_runtime_flag_v1(
    'notification_control_plane_settings_ui_enabled',
    true,
    v_revision,
    '95100000-0000-4000-8000-000000000011'
  );
  if v_settings is distinct from v_settings_replay
    or (v_settings ->> 'enabled')::boolean is not true
    or (v_settings ->> 'revision')::bigint <> 2 then
    raise exception 'registration_observation_provider_zero_settings_flag_receipt_invalid';
  end if;

  select enabled, revision into strict v_enabled, v_revision
  from dashboard_private.notification_runtime_flags
  where flag_key = 'notification_control_plane_dispatch_registration_enabled'
  for update;
  if v_enabled or v_revision <> 1 then
    raise exception 'registration_observation_provider_zero_dispatch_flag_baseline_invalid';
  end if;
  v_dispatch := public.set_notification_runtime_flag_v1(
    'notification_control_plane_dispatch_registration_enabled',
    true,
    v_revision,
    '95100000-0000-4000-8000-000000000012'
  );
  v_dispatch_replay := public.set_notification_runtime_flag_v1(
    'notification_control_plane_dispatch_registration_enabled',
    true,
    v_revision,
    '95100000-0000-4000-8000-000000000012'
  );
  if v_dispatch is distinct from v_dispatch_replay
    or (v_dispatch ->> 'enabled')::boolean is not true
    or (v_dispatch ->> 'revision')::bigint <> 2 then
    raise exception 'registration_observation_provider_zero_dispatch_flag_receipt_invalid';
  end if;

  insert into registration_observation_provider_zero_core_receipt(payload)
  values (jsonb_build_object(
    'coreReadiness', v_readiness,
    'coreActivation', jsonb_build_object(
      'previousVersion', v_activation -> 'previousVersion',
      'runtimeVersion', v_activation -> 'runtimeVersion',
      'replayEqual', true
    ),
    'heartbeat', jsonb_build_object(
      'workerId', 'notification-worker-route-v1',
      'phase', 'succeeded',
      'countKeys', jsonb_build_array(
        'observation_due',
        'fanout',
        'rule_reconciliation',
        'target_reconciliation',
        'deliveries',
        'reaped'
      ),
      'allZero', true
    ),
    'sharedFlags', jsonb_build_object(
      'notification_control_plane_settings_ui_enabled', jsonb_build_object(
        'enabled', v_settings -> 'enabled',
        'revision', v_settings ->> 'revision'
      ),
      'notification_control_plane_dispatch_registration_enabled', jsonb_build_object(
        'enabled', v_dispatch -> 'enabled',
        'revision', v_dispatch ->> 'revision'
      )
    ),
    'externalAttemptAudit', 0
 ));
end;
$$;

select payload::text
from registration_observation_provider_zero_core_receipt;
commit;
`;
}

function providerZeroPrerequisiteSql() {
  return `
begin;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  (
    '95200000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'provider-zero-director@example.invalid',
    crypt('provider-zero-director-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  ),
  (
    '95200000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'provider-zero-teacher@example.invalid',
    crypt('provider-zero-teacher-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  ),
  (
    '95200000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'provider-zero-director-b@example.invalid',
    crypt('provider-zero-director-b-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now()
  )
on conflict (id) do update set
  deleted_at = null,
  banned_until = null,
  updated_at = excluded.updated_at;

insert into public.profiles(id, role, name, email, created_at, updated_at)
values
  (
    '95200000-0000-4000-8000-000000000001', 'admin',
    'provider-zero 원장', 'provider-zero-director@example.invalid', now(), now()
  ),
  (
    '95200000-0000-4000-8000-000000000002', 'teacher',
    'provider-zero 담당 선생님', 'provider-zero-teacher@example.invalid', now(), now()
  ),
  (
    '95200000-0000-4000-8000-000000000003', 'admin',
    'provider-zero 원장 B', 'provider-zero-director-b@example.invalid', now(), now()
  )
on conflict (id) do update set
  role = excluded.role,
  name = excluded.name,
  email = excluded.email,
  updated_at = excluded.updated_at;

delete from public.teacher_catalogs
where profile_id in (
  '95200000-0000-4000-8000-000000000001'::uuid,
  '95200000-0000-4000-8000-000000000002'::uuid,
  '95200000-0000-4000-8000-000000000003'::uuid
);
insert into public.teacher_catalogs(
  id, name, subjects, is_visible, sort_order, profile_id, account_email, dashboard_role
) values
  (
    '95200000-0000-4000-8000-000000000101', 'provider-zero 원장',
    array['영어']::text[], true, 95201,
    '95200000-0000-4000-8000-000000000001',
    'provider-zero-director@example.invalid', 'teacher'
  ),
  (
    '95200000-0000-4000-8000-000000000102', 'provider-zero 담당 선생님',
    array['영어']::text[], true, 95202,
    '95200000-0000-4000-8000-000000000002',
    'provider-zero-teacher@example.invalid', 'teacher'
  ),
  (
    '95200000-0000-4000-8000-000000000111', 'provider-zero 원장 B',
    array['영어']::text[], true, 95204,
    '95200000-0000-4000-8000-000000000003',
    'provider-zero-director-b@example.invalid', 'teacher'
  );
update public.profiles
set teacher_catalog_id = case id
  when '95200000-0000-4000-8000-000000000001'::uuid
    then '95200000-0000-4000-8000-000000000101'::uuid
  when '95200000-0000-4000-8000-000000000003'::uuid
    then '95200000-0000-4000-8000-000000000111'::uuid
  else '95200000-0000-4000-8000-000000000102'::uuid
end
where id in (
  '95200000-0000-4000-8000-000000000001'::uuid,
  '95200000-0000-4000-8000-000000000002'::uuid,
  '95200000-0000-4000-8000-000000000003'::uuid
);

insert into public.classroom_catalogs(
  id, name, subjects, is_visible, sort_order, campus
) values (
  '95200000-0000-4000-8000-000000000103', 'provider-zero 301호',
  array['영어']::text[], true, 95203, '본관'
)
on conflict (id) do update set
  name = excluded.name,
  subjects = excluded.subjects,
  is_visible = excluded.is_visible,
  campus = excluded.campus;

insert into public.classes(
  id, name, subject, status, schedule_storage_mode, schedule_plan
) values (
  '95200000-0000-4000-8000-000000000104', 'provider-zero 영어반', '영어',
  '수업 진행 중', 'normalized', '{}'::jsonb
)
on conflict (id) do update set
  name = excluded.name,
  subject = excluded.subject,
  status = excluded.status,
  schedule_storage_mode = excluded.schedule_storage_mode,
  schedule_plan = excluded.schedule_plan;

do $seed_schedule_context$
begin
  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(
    '95200000-0000-4000-8000-000000000104',
    '95200000-0000-4000-8000-000000000199',
    'registration_observation_google_chat_provider_zero'
  );
end
$seed_schedule_context$;

insert into public.class_lesson_sessions(
  id, class_id, session_key, session_date, schedule_state, start_time, end_time,
  teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id,
  classroom_name_snapshot, origin, revision
)
select
  '95200000-0000-4000-8000-000000000105',
  '95200000-0000-4000-8000-000000000104',
  to_char(clock.starts_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ':provider-zero',
  (clock.starts_at at time zone 'Asia/Seoul')::date,
  'active',
  (clock.starts_at at time zone 'Asia/Seoul')::time,
  (clock.ends_at at time zone 'Asia/Seoul')::time,
  '95200000-0000-4000-8000-000000000102', 'provider-zero 담당 선생님',
  '95200000-0000-4000-8000-000000000103', 'provider-zero 301호', 'manual', 7
from (
  select
    date_trunc('minute', clock_timestamp() at time zone 'Asia/Seoul')
      + interval '4 hours' as starts_at,
    date_trunc('minute', clock_timestamp() at time zone 'Asia/Seoul')
      + interval '5 hours' as ends_at
) clock
on conflict (id) do update set
  session_key = excluded.session_key,
  session_date = excluded.session_date,
  schedule_state = excluded.schedule_state,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  teacher_catalog_id = excluded.teacher_catalog_id,
  teacher_name_snapshot = excluded.teacher_name_snapshot,
  classroom_catalog_id = excluded.classroom_catalog_id,
  classroom_name_snapshot = excluded.classroom_name_snapshot,
  revision = excluded.revision;

insert into public.google_chat_webhook_settings(
  channel, webhook_url, webhook_url_ciphertext, webhook_url_mask,
  connection_state, revision, last_verified_at, last_error_code
) values
  ('admin', 'https://chat.googleapis.com/v1/spaces/PROVIDERADMIN/messages?key=provider-zero-key&token=provider-zero-token', null, null, 'legacy_active', 1, clock_timestamp(), null),
  ('english', 'https://chat.googleapis.com/v1/spaces/PROVIDERENGLISH/messages?key=provider-zero-key&token=provider-zero-token', null, null, 'legacy_active', 1, clock_timestamp(), null),
  ('math', 'https://chat.googleapis.com/v1/spaces/PROVIDERMATH/messages?key=provider-zero-key&token=provider-zero-token', null, null, 'legacy_active', 1, clock_timestamp(), null),
  ('science', 'https://chat.googleapis.com/v1/spaces/PROVIDERSCIENCE/messages?key=provider-zero-key&token=provider-zero-token', null, null, 'legacy_active', 1, clock_timestamp(), null)
on conflict (channel) do update set
  webhook_url = excluded.webhook_url,
  webhook_url_ciphertext = excluded.webhook_url_ciphertext,
  webhook_url_mask = excluded.webhook_url_mask,
  connection_state = excluded.connection_state,
  revision = excluded.revision,
  last_verified_at = excluded.last_verified_at,
  last_error_code = excluded.last_error_code;

insert into dashboard_private.google_chat_profile_identities(
  profile_id, account_email_snapshot, chat_user_id, source,
  verification_status, verified_at, last_sync_status, last_sync_at,
  identity_revision, created_at, updated_at
) values
  (
    '95200000-0000-4000-8000-000000000001',
    'provider-zero-director@example.invalid', '123456789', 'manual',
    'verified', clock_timestamp(), 'ok', clock_timestamp(), 1, clock_timestamp(), clock_timestamp()
  ),
  (
    '95200000-0000-4000-8000-000000000002',
    'provider-zero-teacher@example.invalid', '123456788', 'manual',
    'verified', clock_timestamp(), 'ok', clock_timestamp(), 1, clock_timestamp(), clock_timestamp()
  ),
  (
    '95200000-0000-4000-8000-000000000003',
    'provider-zero-director-b@example.invalid', '987654321', 'manual',
    'verified', clock_timestamp(), 'ok', clock_timestamp(), 1, clock_timestamp(), clock_timestamp()
  )
on conflict (profile_id) do update set
  account_email_snapshot = excluded.account_email_snapshot,
  chat_user_id = excluded.chat_user_id,
  source = excluded.source,
  verification_status = excluded.verification_status,
  verified_at = excluded.verified_at,
  last_sync_status = excluded.last_sync_status,
  last_sync_at = excluded.last_sync_at,
  identity_revision = excluded.identity_revision,
  updated_at = excluded.updated_at;

commit;
`;
}

function providerZeroLifecycleSql() {
  return `
begin;

create temp table registration_observation_provider_zero_lifecycle_receipt(
  payload jsonb not null
) on commit drop;

create temp table registration_observation_provider_zero_fanout_claims(
  event_id uuid primary key,
  job_id uuid not null,
  claim_token uuid not null,
  current_cursor text,
  scheduled_for timestamptz not null,
  delivery_count integer not null default 0
) on commit drop;

create or replace function pg_temp.provider_zero_payload_for_job_v1(
  p_job_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case job.event_key
    when 'registration.observation_scheduled' then base.payload || jsonb_build_object(
      'textbook_names', job.preparation_snapshot -> 'textbookNames',
      'progress_summary', job.preparation_snapshot ->> 'progressSummary'
    )
    when 'registration.observation_feedback_submitted' then base.payload || jsonb_build_object(
      'submitted_by_name', job.submission_snapshot ->> 'submittedByName',
      'submitted_at', job.submission_snapshot -> 'submittedAt'
    )
    when 'registration.observation_director_reassigned' then base.payload || jsonb_build_object(
      'assignment_fact_id', job.assignment_fact_id,
      'previous_director_profile_ids', to_jsonb(assignment_fact.previous_profile_ids),
      'director_profile_ids', to_jsonb(assignment_fact.current_profile_ids)
    )
    else null
  end
  from dashboard_private.registration_observation_chat_jobs job
  left join dashboard_private.registration_observation_domain_events domain_event
    on domain_event.event_id = job.domain_event_id
  left join dashboard_private.notification_assignment_change_facts assignment_fact
    on assignment_fact.fact_id = job.assignment_fact_id
  cross join lateral (
    select dashboard_private.get_registration_observation_notification_source_impl_v1(
      job.observation_id
    ) as source
  ) source_row
  cross join lateral (
    select jsonb_build_object(
      'task_id', source_row.source ->> 'taskId',
      'track_id', source_row.source ->> 'trackId',
      'observation_id', job.observation_id,
      'appointment_id', job.appointment_id,
      'appointment_notification_revision', job.notification_revision,
      'student_name', source_row.source ->> 'studentName',
      'subject', source_row.source ->> 'subject',
      'source_revision', job.source_revision,
      'booking_fact_hash', job.booking_fact_hash,
      'occurred_at', coalesce(domain_event.occurred_at, assignment_fact.occurred_at),
      'delivery_expires_at', job.expires_at,
      'mention_role', job.mention_role,
      'mention_profile_ids', to_jsonb(job.mention_profile_ids),
      'event_kind', job.event_key,
      'booking', jsonb_build_object(
        'class_id', job.current_booking_snapshot ->> 'classId',
        'class_name', job.current_booking_snapshot ->> 'className',
        'session_authority', job.current_booking_snapshot ->> 'sessionAuthority',
        'class_lesson_session_id', job.current_booking_snapshot ->> 'classLessonSessionId',
        'legacy_session_key', job.current_booking_snapshot ->> 'legacySessionKey',
        'schedule_state', job.current_booking_snapshot ->> 'scheduleState',
        'starts_at', job.current_booking_snapshot ->> 'startsAt',
        'ends_at', job.current_booking_snapshot ->> 'endsAt',
        'teacher_name', job.current_booking_snapshot ->> 'teacherName',
        'classroom_name', job.current_booking_snapshot ->> 'classroomName',
        'campus', job.current_booking_snapshot ->> 'campus'
      )
    ) as payload
  ) base
  where job.job_id = p_job_id;
$$;

create or replace function pg_temp.provider_zero_apply_fanout_v1(
  p_event_id uuid,
  p_expected_rule_id uuid,
  p_target jsonb,
  p_title text,
  p_body text,
  p_href text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_claim jsonb;
  v_event dashboard_private.notification_events%rowtype;
  v_rule_snapshot jsonb;
  v_rule_index integer;
  v_rule_count integer;
  v_job_id uuid;
  v_claim_token uuid;
  v_current_cursor text;
  v_scheduled_for timestamptz;
  v_delivery_count integer;
  v_target_set jsonb;
  v_delivery jsonb;
  v_delivery_id uuid;
  v_done boolean;
begin
  select claim_row.job_id,
         claim_row.claim_token,
         claim_row.current_cursor,
         claim_row.scheduled_for,
         claim_row.delivery_count
  into v_job_id,
       v_claim_token,
       v_current_cursor,
       v_scheduled_for,
       v_delivery_count
  from registration_observation_provider_zero_fanout_claims claim_row
  where claim_row.event_id = p_event_id
  for update of claim_row;

  if not found then
    select claim into strict v_claim
    from public.claim_notification_fanout_jobs_v1(
      'provider-zero-google-chat-fanout-v1', 100, 60
    ) claim
    where (claim ->> 'event_id')::uuid = p_event_id;
    v_job_id := (v_claim ->> 'job_id')::uuid;
    v_claim_token := (v_claim ->> 'claim_token')::uuid;
    v_current_cursor := nullif(v_claim ->> 'cursor', '');
    v_scheduled_for := (v_claim ->> 'scheduled_for')::timestamptz;
    v_delivery_count := 0;
    insert into registration_observation_provider_zero_fanout_claims(
      event_id, job_id, claim_token, current_cursor, scheduled_for, delivery_count
    ) values (
      p_event_id, v_job_id, v_claim_token, v_current_cursor, v_scheduled_for, 0
    );
  end if;

  select event_row.* into strict v_event
  from dashboard_private.notification_events event_row
  where event_row.id = p_event_id;
  v_rule_index := coalesce(v_current_cursor::integer, 0);
  v_rule_count := pg_catalog.jsonb_array_length(v_event.rule_snapshot);
  v_rule_snapshot := v_event.rule_snapshot -> v_rule_index;
  if v_rule_snapshot is null
    or v_rule_snapshot ->> 'rule_id' is distinct from p_expected_rule_id::text
  then
    raise exception 'registration_observation_provider_zero_fanout_rule_invalid';
  end if;
  v_target_set := jsonb_build_array(p_target);
  v_delivery := p_target || jsonb_build_object(
    'template_id', v_rule_snapshot ->> 'template_id',
    'rendered_title', p_title,
    'rendered_body', p_body,
    'href', p_href,
    'scheduled_for', v_scheduled_for
  );
  v_done := v_rule_index >= v_rule_count - 1;
  perform public.apply_notification_fanout_batch_v1(
    v_job_id,
    v_claim_token,
    v_current_cursor,
    p_expected_rule_id,
    (v_rule_snapshot ->> 'rule_revision')::bigint,
    1,
    dashboard_private.notification_target_set_hash_v1(v_target_set),
    jsonb_build_object('deliveries', jsonb_build_array(v_delivery)),
    case when v_done then null else (v_rule_index + 1)::text end,
    v_done
  );
  select delivery.id into strict v_delivery_id
  from dashboard_private.notification_deliveries delivery
  where delivery.event_id = p_event_id
    and delivery.rule_id = p_expected_rule_id
    and delivery.target_key = p_target ->> 'target_key';
  v_delivery_count := v_delivery_count + 1;
  if v_done then
    perform public.finish_notification_orchestration_job_v1(
      'fanout',
      v_job_id,
      v_claim_token,
      'succeeded',
      jsonb_build_object('delivery_count', v_delivery_count, 'done', true),
      null,
      null
    );
    delete from registration_observation_provider_zero_fanout_claims claim_row
    where claim_row.event_id = p_event_id;
  else
    update registration_observation_provider_zero_fanout_claims claim_row
    set current_cursor = (v_rule_index + 1)::text,
        delivery_count = v_delivery_count
    where claim_row.event_id = p_event_id;
  end if;
  return v_delivery_id;
end;
$$;

create or replace function pg_temp.provider_zero_prepare_feedback_pair_v1(
  p_domain_event_id uuid,
  p_initial_director uuid,
  p_director_state text,
  p_management_first boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job dashboard_private.registration_observation_chat_jobs%rowtype;
  v_job_claim jsonb;
  v_materialized jsonb;
  v_event_id uuid;
  v_chat_delivery uuid;
  v_in_app_delivery uuid;
  v_claims jsonb;
  v_payload jsonb;
  v_payload_hash text;
  v_render_hash text;
  v_chat_prepare jsonb;
  v_in_app_prepare jsonb;
  v_notification_count bigint;
begin
  if p_director_state not in ('active', 'null', 'banned') then
    raise exception 'registration_observation_provider_zero_feedback_pair_state_invalid'
      using errcode = '22023';
  end if;

  select job.* into strict v_job
  from dashboard_private.registration_observation_chat_jobs job
  where job.domain_event_id = p_domain_event_id
    and job.event_key = 'registration.observation_feedback_submitted';
  select claim into strict v_job_claim
  from public.claim_registration_observation_chat_jobs_v1(
    'provider-zero-google-chat-feedback-pair-job-v1', 10, 60
  ) claim
  where (claim ->> 'job_id')::uuid = v_job.job_id;
  v_payload := pg_temp.provider_zero_payload_for_job_v1(v_job.job_id);
  v_materialized := public.materialize_registration_observation_chat_job_v1(
    v_job.job_id,
    (v_job_claim ->> 'claim_token')::uuid,
    3,
    v_payload
  );
  v_event_id := (v_materialized ->> 'event_id')::uuid;
  v_chat_delivery := pg_temp.provider_zero_apply_fanout_v1(
    v_event_id,
    '81000000-0000-4000-8000-000000000006',
    jsonb_build_object(
      'target_kind','connection',
      'target_key','connection:google_chat.management',
      'target_profile_id',null,
      'connection_key','google_chat.management',
      'target_snapshot',jsonb_build_object('connection_key','google_chat.management')
    ),
    '[청강 피드백 등록] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 청강 피드백이 등록되었습니다.',
    '/admin/registration?taskId=95200000-0000-4000-8000-000000000106'
  );
  v_in_app_delivery := pg_temp.provider_zero_apply_fanout_v1(
    v_event_id,
    '81000000-0000-4000-8000-000000000007',
    jsonb_build_object(
      'target_kind','profile',
      'target_key','profile:' || p_initial_director::text,
      'target_profile_id',p_initial_director,
      'connection_key',null,
      'target_snapshot',jsonb_build_object('profile_id',p_initial_director)
    ),
    '[청강 피드백 등록] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 청강 피드백이 등록되었습니다.',
    '/admin/registration?taskId=95200000-0000-4000-8000-000000000106'
  );
  select jsonb_object_agg(claim ->> 'channel_key', claim)
  into v_claims
  from public.claim_notification_deliveries_v1(
    'provider-zero-google-chat-feedback-pair-delivery-v1', 10, 60
  ) claim
  where (claim ->> 'delivery_id')::uuid in (v_chat_delivery, v_in_app_delivery);
  if v_claims is null or not (v_claims ?& array['google_chat','in_app']) then
    raise exception 'registration_observation_provider_zero_feedback_pair_claim_invalid';
  end if;
  v_payload_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(v_payload)
  );
  v_render_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(jsonb_build_object(
      'title','[청강 피드백 등록] provider-zero 청강학생',
      'body','학생: provider-zero 청강학생 · 청강 피드백이 등록되었습니다.',
      'href','/admin/registration?taskId=95200000-0000-4000-8000-000000000106'
    ))
  );
  perform public.refresh_registration_observation_notification_delivery_v1(
    v_chat_delivery,
    (v_claims #>> '{google_chat,claim_token}')::uuid,
    v_event_id,
    '81000000-0000-4000-8000-000000000006',
    2,
    '[청강 피드백 등록] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 청강 피드백이 등록되었습니다.',
    '/admin/registration?taskId=95200000-0000-4000-8000-000000000106',
    v_payload, v_payload_hash, v_render_hash
  );
  perform public.refresh_registration_observation_notification_delivery_v1(
    v_in_app_delivery,
    (v_claims #>> '{in_app,claim_token}')::uuid,
    v_event_id,
    '81000000-0000-4000-8000-000000000007',
    2,
    '[청강 피드백 등록] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 청강 피드백이 등록되었습니다.',
    '/admin/registration?taskId=95200000-0000-4000-8000-000000000106',
    v_payload, v_payload_hash, v_render_hash
  );

  if p_director_state = 'null' then
    update public.ops_registration_subject_tracks track
    set director_profile_id = null,
        director_assignment_source = null,
        director_assignment_rule_key = null,
        director_assigned_at = null,
        updated_at = clock_timestamp()
    where track.id = (
      select observation.track_id
      from public.ops_registration_observations observation
      where observation.id = v_job.observation_id
    );
  elsif p_director_state = 'banned' then
    update auth.users
    set banned_until = clock_timestamp() + interval '1 day',
        updated_at = clock_timestamp()
    where id = p_initial_director;
  end if;

  if p_management_first then
    v_chat_prepare := public.prepare_registration_observation_notification_delivery_v1(
      v_chat_delivery,
      (v_claims #>> '{google_chat,claim_token}')::uuid,
      v_event_id,
      '81000000-0000-4000-8000-000000000006',
      2,
      v_payload_hash,v_render_hash
    );
    v_in_app_prepare := public.prepare_registration_observation_notification_delivery_v1(
      v_in_app_delivery,
      (v_claims #>> '{in_app,claim_token}')::uuid,
      v_event_id,
      '81000000-0000-4000-8000-000000000007',
      2,
      v_payload_hash,v_render_hash
    );
  else
    v_in_app_prepare := public.prepare_registration_observation_notification_delivery_v1(
      v_in_app_delivery,
      (v_claims #>> '{in_app,claim_token}')::uuid,
      v_event_id,
      '81000000-0000-4000-8000-000000000007',
      2,
      v_payload_hash,v_render_hash
    );
    v_chat_prepare := public.prepare_registration_observation_notification_delivery_v1(
      v_chat_delivery,
      (v_claims #>> '{google_chat,claim_token}')::uuid,
      v_event_id,
      '81000000-0000-4000-8000-000000000006',
      2,
      v_payload_hash,v_render_hash
    );
  end if;
  select count(*) into v_notification_count
  from public.dashboard_notifications notification
  where notification.source_delivery_id = v_in_app_delivery;
  if v_chat_prepare ->> 'status' is distinct from 'sending'
    or v_chat_prepare ->> 'connection_key' is distinct from 'google_chat.management'
    or v_chat_prepare -> 'mention_user_names' is distinct from '[]'::jsonb
    or v_in_app_prepare ->> 'status' is distinct from 'canceled'
    or v_in_app_prepare ->> 'status_reason' is distinct from 'recipient_revoked'
    or v_notification_count <> 0
  then
    raise exception 'registration_observation_provider_zero_feedback_pair_prepare_invalid';
  end if;
  return jsonb_build_object(
    'managementStatus',v_chat_prepare ->> 'status',
    'managementConnectionKey',v_chat_prepare ->> 'connection_key',
    'inAppStatus',v_in_app_prepare ->> 'status',
    'inAppStatusReason',v_in_app_prepare ->> 'status_reason'
  );
end;
$$;

do $lifecycle$
declare
  v_director constant uuid := '95200000-0000-4000-8000-000000000001';
  v_teacher constant uuid := '95200000-0000-4000-8000-000000000002';
  v_director_b constant uuid := '95200000-0000-4000-8000-000000000003';
  v_task constant uuid := '95200000-0000-4000-8000-000000000106';
  v_track constant uuid := '95200000-0000-4000-8000-000000000107';
  v_appointment constant uuid := '95200000-0000-4000-8000-000000000108';
  v_observation constant uuid := '95200000-0000-4000-8000-000000000109';
  v_schedule_event constant uuid := '95200000-0000-4000-8000-000000000110';
  v_feedback_event constant uuid := '95200000-0000-4000-8000-000000000111';
  v_missing_identity_schedule_event constant uuid := '95200000-0000-4000-8000-000000000113';
  v_missing_director_event constant uuid := '95200000-0000-4000-8000-000000000114';
  v_inactive_director_event constant uuid := '95200000-0000-4000-8000-000000000115';
  v_missing_director_before_fanout_event constant uuid := '95200000-0000-4000-8000-000000000116';
  v_rule_scheduled constant uuid := '81000000-0000-4000-8000-000000000001';
  v_rule_feedback_chat constant uuid := '81000000-0000-4000-8000-000000000006';
  v_rule_feedback_in_app constant uuid := '81000000-0000-4000-8000-000000000007';
  v_rule_reassigned constant uuid := '81000000-0000-4000-8000-000000000008';
  v_snapshot jsonb;
  v_expected_revisions jsonb;
  v_expected_contracts jsonb;
  v_patch jsonb := jsonb_build_object('rules', jsonb_build_object(
    '81000000-0000-4000-8000-000000000001', jsonb_build_object('enabled', true),
    '81000000-0000-4000-8000-000000000006', jsonb_build_object('enabled', true),
    '81000000-0000-4000-8000-000000000007', jsonb_build_object('enabled', true),
    '81000000-0000-4000-8000-000000000008', jsonb_build_object('enabled', true)
  ));
    v_save jsonb;
    v_save_replay jsonb;
  v_source jsonb;
  v_schedule_chat_claim jsonb;
  v_schedule_materialized jsonb;
  v_schedule_event_id uuid;
  v_schedule_delivery uuid;
  v_schedule_claim jsonb;
  v_schedule_frozen_before jsonb;
  v_schedule_frozen_after jsonb;
  v_schedule_payload jsonb;
  v_schedule_payload_hash text;
  v_schedule_render_hash text;
  v_schedule_refresh jsonb;
  v_schedule_prepare jsonb;
  v_missing_identity_job dashboard_private.registration_observation_chat_jobs%rowtype;
  v_missing_identity_job_claim jsonb;
  v_missing_identity_materialized jsonb;
  v_missing_identity_event_id uuid;
  v_missing_identity_delivery uuid;
  v_missing_identity_delivery_claim jsonb;
  v_missing_identity_payload jsonb;
  v_missing_identity_payload_hash text;
  v_missing_identity_render_hash text;
  v_missing_identity_prepare jsonb;
  v_feedback_chat_claim jsonb;
  v_feedback_materialized jsonb;
  v_feedback_event_id uuid;
  v_feedback_chat_delivery uuid;
  v_feedback_in_app_delivery uuid;
  v_feedback_claims jsonb;
  v_feedback_payload jsonb;
  v_feedback_payload_hash text;
  v_feedback_render_hash text;
  v_feedback_chat_frozen jsonb;
  v_feedback_in_app_frozen jsonb;
  v_feedback_chat_refresh jsonb;
  v_feedback_in_app_refresh jsonb;
  v_feedback_chat_prepare jsonb;
  v_feedback_in_app_prepare jsonb;
  v_missing_director_pair jsonb;
  v_inactive_director_pair jsonb;
  v_missing_director_before_fanout_job dashboard_private.registration_observation_chat_jobs%rowtype;
  v_missing_director_before_fanout_claim jsonb;
  v_missing_director_before_fanout_materialized jsonb;
  v_missing_director_before_fanout_event_id uuid;
  v_missing_director_before_fanout_delivery uuid;
  v_missing_director_before_fanout_delivery_claim jsonb;
  v_missing_director_before_fanout_payload jsonb;
  v_missing_director_before_fanout_payload_hash text;
  v_missing_director_before_fanout_render_hash text;
  v_missing_director_before_fanout_prepare jsonb;
  v_missing_director_before_fanout_count bigint;
  v_missing_director_before_fanout_in_app_count bigint;
  v_reassignment_common_revision integer;
  v_reassignment_receipt jsonb;
  v_reassignment_job dashboard_private.registration_observation_chat_jobs%rowtype;
  v_reassignment_job_claim jsonb;
  v_reassignment_materialized jsonb;
  v_reassignment_event_id uuid;
  v_reassignment_delivery uuid;
  v_reassignment_delivery_claim jsonb;
  v_reassignment_payload jsonb;
  v_reassignment_payload_hash text;
  v_reassignment_render_hash text;
  v_reassignment_prepare jsonb;
  v_reassignment_fanout_state jsonb;
  v_customer_before jsonb;
  v_customer_after jsonb;
  v_notification_count bigint;
  v_push_count bigint;
begin
  perform set_config('request.jwt.claim.sub', v_director::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_snapshot := public.get_notification_control_plane_v1('registration');
  select jsonb_object_agg(rule.id::text, rule.revision::text order by rule.id)
  into v_expected_revisions
  from dashboard_private.notification_rules rule
  where rule.id in (
    v_rule_scheduled, v_rule_feedback_chat, v_rule_feedback_in_app, v_rule_reassigned
  );
  select jsonb_object_agg(contract.rule_id::text, contract.contract_version order by contract.rule_id)
  into v_expected_contracts
  from dashboard_private.notification_rule_content_contracts contract
  where contract.rule_id in (
    v_rule_scheduled, v_rule_feedback_chat, v_rule_feedback_in_app, v_rule_reassigned
  );
  if jsonb_array_length(v_snapshot -> 'rules') < 4
    or v_expected_revisions is null
    or v_expected_contracts is null
  then
    raise exception 'registration_observation_provider_zero_v2_snapshot_invalid';
  end if;
  v_save := public.save_notification_control_plane_v2(
    'registration', v_expected_revisions, v_expected_contracts, v_patch,
    '95200000-0000-4000-8000-000000000112'
  );
  v_save_replay := public.save_notification_control_plane_v2(
    'registration', v_expected_revisions, v_expected_contracts, v_patch,
    '95200000-0000-4000-8000-000000000112'
  );
  if v_save is distinct from v_save_replay
    or (select array_agg(key order by key) from jsonb_object_keys(v_save) key)
      is distinct from array[
        'connections','delivery_summary','loaded_at','reconciliation_job',
        'rules','scope_key','workflow_key'
      ]::text[]
    or v_save ->> 'workflow_key' is distinct from 'registration'
    or v_save #>> '{reconciliation_job,job_kind}' is distinct from 'rule_reconciliation'
    or v_save #>> '{reconciliation_job,status}' is distinct from 'pending'
    or v_save #>> '{reconciliation_job,attempt_count}' is distinct from '0'
    or (select count(*)
        from dashboard_private.notification_rules rule
        where rule.id in (
          v_rule_scheduled, v_rule_feedback_chat, v_rule_feedback_in_app, v_rule_reassigned
        )) <> 4
    or exists (
      select 1
      from dashboard_private.notification_rules rule
      where rule.id in (
        v_rule_scheduled, v_rule_feedback_chat, v_rule_feedback_in_app, v_rule_reassigned
      )
        and (not rule.enabled or rule.revision <> 2)
    )
  then
    raise exception 'registration_observation_provider_zero_v2_receipt_invalid';
  end if;

    perform set_config('request.jwt.claim.role', 'service_role', true);

  select jsonb_build_object(
    'customerMessages', (select count(*) from public.ops_registration_customer_messages),
    'reminders', (select count(*) from dashboard_private.registration_customer_reminder_jobs)
  ) into v_customer_before;

  insert into public.ops_tasks(
    id, title, type, status, priority, requested_by, assignee_id,
    secondary_assignee_id, student_name
  ) values (
    v_task, 'provider-zero 청강 lifecycle', 'registration', 'requested', 'normal',
    v_director, v_director, v_director, 'provider-zero 청강학생'
  );
  insert into public.ops_registration_details(task_id) values (v_task);
  insert into public.ops_registration_subject_tracks(
    id, task_id, subject, pipeline_status, director_profile_id,
    director_assignment_source, director_assigned_at, migration_review_required,
    workflow_status, workflow_revision, workflow_status_entered_at,
    observation_return_workflow_status, observation_attempt_count
  ) values (
    v_track, v_task, '영어', 'consultation_waiting', v_director,
    'manual', clock_timestamp(), false,
    'observation_requested', 1, clock_timestamp(), 'consultation_completed', 0
  );
  insert into public.ops_registration_appointments(
    id, task_id, kind, scheduled_at, place, status, notification_revision, created_by
  )
  select
    v_appointment, v_task, 'observation_class',
      (session.session_date + session.start_time) at time zone 'Asia/Seoul',
      '본관',
    'scheduled', 1, v_director
  from public.class_lesson_sessions session
  where session.id = '95200000-0000-4000-8000-000000000105';
  insert into public.ops_registration_observations(
    id, task_id, track_id, appointment_id, class_id,
    session_authority, class_lesson_session_id, legacy_session_key,
    session_date, starts_at, ends_at, session_schedule_state,
    session_source_revision, legacy_session_source_hash, source_revision,
    booking_fact_hash, teacher_catalog_id, teacher_profile_id,
    classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot,
    classroom_name_snapshot, campus, textbook_snapshot, progress_snapshot,
    created_by, updated_by
  )
  select
    v_observation, v_task, v_track, v_appointment,
    '95200000-0000-4000-8000-000000000104',
    'normalized', session.id, null,
    session.session_date,
    (session.session_date + session.start_time) at time zone 'Asia/Seoul',
    (session.session_date + session.end_time) at time zone 'Asia/Seoul',
    'active',
    session.revision, null,
    jsonb_build_object('authority','normalized','sessionId',session.id,'revision',session.revision),
    dashboard_private.registration_observation_booking_fact_hash_v1(
      jsonb_build_object(
        'classId','95200000-0000-4000-8000-000000000104'::uuid,
        'subject','영어','sessionAuthority','normalized',
        'classLessonSessionId',session.id,'legacySessionKey',null,
        'sessionKey',session.session_key,'scheduleState','active',
        'sessionDate',session.session_date,
        'startsAt',(session.session_date + session.start_time) at time zone 'Asia/Seoul',
        'endsAt',(session.session_date + session.end_time) at time zone 'Asia/Seoul',
        'teacherCatalogId','95200000-0000-4000-8000-000000000102'::uuid,
        'teacherProfileId',v_teacher,'teacherName','provider-zero 담당 선생님',
        'classroomCatalogId','95200000-0000-4000-8000-000000000103'::uuid,
        'classroomName','provider-zero 301호','campus','본관'
      )
    ),
    '95200000-0000-4000-8000-000000000102', v_teacher,
    '95200000-0000-4000-8000-000000000103', '영어', 'provider-zero 영어반',
    'provider-zero 담당 선생님', 'provider-zero 301호', '본관',
    jsonb_build_array(jsonb_build_object(
      'textbookId','provider-zero-book','title','능률 VOCA',
      'planLabel','42~49쪽','memo','단어 시험'
    )),
    '진도: 42~49쪽 · 단어 시험', v_director, v_director
  from public.class_lesson_sessions session
  where session.id = '95200000-0000-4000-8000-000000000105';

  insert into dashboard_private.registration_observation_domain_events(
    event_id, observation_id, appointment_id, notification_revision, event_kind,
    booking_fact_hash, source_revision, occurred_at
  )
  select
    v_schedule_event, observation.id, observation.appointment_id, 1,
    'observation_scheduled', observation.booking_fact_hash,
    observation.source_revision, clock_timestamp()
  from public.ops_registration_observations observation
  where observation.id = v_observation;

  select claim into strict v_schedule_chat_claim
  from public.claim_registration_observation_chat_jobs_v1(
    'provider-zero-google-chat-job-v1', 1, 60
  ) claim
  where claim ->> 'event_key' = 'registration.observation_scheduled';
  v_schedule_payload := pg_temp.provider_zero_payload_for_job_v1(
    (v_schedule_chat_claim ->> 'job_id')::uuid
  );
  v_schedule_materialized := public.materialize_registration_observation_chat_job_v1(
    (v_schedule_chat_claim ->> 'job_id')::uuid,
    (v_schedule_chat_claim ->> 'claim_token')::uuid,
    3,
    v_schedule_payload
  );
  v_schedule_event_id := (v_schedule_materialized ->> 'event_id')::uuid;
  v_schedule_delivery := pg_temp.provider_zero_apply_fanout_v1(
    v_schedule_event_id,
    v_rule_scheduled,
    jsonb_build_object(
      'target_kind','connection',
      'target_key','connection:google_chat.english',
      'target_profile_id',null,
      'connection_key','google_chat.english',
      'target_snapshot',jsonb_build_object('connection_key','google_chat.english')
    ),
    '[청강 예약] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 영어 청강 예약',
    '/admin/registration-observation?observationId=95200000-0000-4000-8000-000000000109'
  );
  select claim into strict v_schedule_claim
  from public.claim_notification_deliveries_v1(
    'provider-zero-google-chat-delivery-v1', 1, 60
  ) claim
  where (claim ->> 'delivery_id')::uuid = v_schedule_delivery;
  v_schedule_frozen_before := public.read_registration_observation_notification_delivery_frozen_state_v1(
    v_schedule_delivery, (v_schedule_claim ->> 'claim_token')::uuid
  );
  if v_schedule_frozen_before -> 'payloadFingerprint' <> 'null'::jsonb
    or v_schedule_frozen_before -> 'renderFingerprint' <> 'null'::jsonb
  then
    raise exception 'registration_observation_provider_zero_first_read_invalid';
  end if;
  v_schedule_payload_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(v_schedule_payload)
  );
  v_schedule_render_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(jsonb_build_object(
      'title','[청강 예약] provider-zero 청강학생',
      'body','학생: provider-zero 청강학생 · 영어 청강 예약',
      'href','/admin/registration-observation?observationId=95200000-0000-4000-8000-000000000109'
    ))
  );
  v_schedule_refresh := public.refresh_registration_observation_notification_delivery_v1(
    v_schedule_delivery,
    (v_schedule_claim ->> 'claim_token')::uuid,
    v_schedule_event_id,
    v_rule_scheduled,
    2,
    '[청강 예약] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 영어 청강 예약',
    '/admin/registration-observation?observationId=95200000-0000-4000-8000-000000000109',
    v_schedule_payload, v_schedule_payload_hash, v_schedule_render_hash
  );
  v_schedule_frozen_after := public.read_registration_observation_notification_delivery_frozen_state_v1(
    v_schedule_delivery, (v_schedule_claim ->> 'claim_token')::uuid
  );
  if v_schedule_refresh is distinct from jsonb_build_object(
      'outcome','refreshed','delivery_id',v_schedule_delivery,
      'payload_fingerprint',v_schedule_payload_hash,
      'render_fingerprint',v_schedule_render_hash
    )
    or v_schedule_frozen_after ->> 'payloadFingerprint' is distinct from v_schedule_payload_hash
    or v_schedule_frozen_after ->> 'renderFingerprint' is distinct from v_schedule_render_hash
  then
    raise exception 'registration_observation_provider_zero_refresh_receipt_invalid';
  end if;
  v_schedule_prepare := public.prepare_registration_observation_notification_delivery_v1(
    v_schedule_delivery,
    (v_schedule_claim ->> 'claim_token')::uuid,
    v_schedule_event_id,
    v_rule_scheduled,
    2,
    v_schedule_payload_hash,
    v_schedule_render_hash
  );
  if v_schedule_prepare ->> 'status' is distinct from 'sending'
    or v_schedule_prepare ->> 'channel_key' is distinct from 'google_chat'
    or v_schedule_prepare ->> 'connection_key' is distinct from 'google_chat.english'
    or v_schedule_prepare -> 'mention_user_names'
      is distinct from '["users/123456788"]'::jsonb
  then
    raise exception 'registration_observation_provider_zero_schedule_prepare_invalid';
  end if;

  -- A verified identity may disappear after the event/fanout snapshot. The
  -- Google Chat delivery must still reach the begin boundary without a stale
  -- or broadened mention.
  update public.ops_registration_appointments
  set notification_revision = 2,
      updated_at = clock_timestamp()
  where id = v_appointment;
  select dashboard_private.get_registration_observation_notification_source_impl_v1(v_observation)
  into strict v_source;
  insert into dashboard_private.registration_observation_domain_events(
    event_id, observation_id, appointment_id, notification_revision, event_kind,
    booking_fact_hash, source_revision, occurred_at
  ) values (
    v_missing_identity_schedule_event, v_observation, v_appointment,
    (v_source ->> 'notificationRevision')::integer,
    'observation_scheduled', v_source ->> 'bookingFactHash',
    v_source -> 'sourceRevision', clock_timestamp()
  );
  select job.* into strict v_missing_identity_job
  from dashboard_private.registration_observation_chat_jobs job
  where job.domain_event_id = v_missing_identity_schedule_event
    and job.event_key = 'registration.observation_scheduled';
  select claim into strict v_missing_identity_job_claim
  from public.claim_registration_observation_chat_jobs_v1(
    'provider-zero-google-chat-missing-identity-job-v1', 10, 60
  ) claim
  where (claim ->> 'job_id')::uuid = v_missing_identity_job.job_id;
  v_missing_identity_payload := pg_temp.provider_zero_payload_for_job_v1(
    v_missing_identity_job.job_id
  );
  v_missing_identity_materialized := public.materialize_registration_observation_chat_job_v1(
    v_missing_identity_job.job_id,
    (v_missing_identity_job_claim ->> 'claim_token')::uuid,
    3,
    v_missing_identity_payload
  );
  v_missing_identity_event_id := (v_missing_identity_materialized ->> 'event_id')::uuid;
  v_missing_identity_delivery := pg_temp.provider_zero_apply_fanout_v1(
    v_missing_identity_event_id,
    v_rule_scheduled,
    jsonb_build_object(
      'target_kind','connection',
      'target_key','connection:google_chat.english',
      'target_profile_id',null,
      'connection_key','google_chat.english',
      'target_snapshot',jsonb_build_object('connection_key','google_chat.english')
    ),
    '[청강 예약] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 영어 청강 예약',
    '/admin/registration-observation?observationId=95200000-0000-4000-8000-000000000109'
  );
  select claim into strict v_missing_identity_delivery_claim
  from public.claim_notification_deliveries_v1(
    'provider-zero-google-chat-missing-identity-delivery-v1', 10, 60
  ) claim
  where (claim ->> 'delivery_id')::uuid = v_missing_identity_delivery;
  v_missing_identity_payload_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(v_missing_identity_payload)
  );
  v_missing_identity_render_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(jsonb_build_object(
      'title','[청강 예약] provider-zero 청강학생',
      'body','학생: provider-zero 청강학생 · 영어 청강 예약',
      'href','/admin/registration-observation?observationId=95200000-0000-4000-8000-000000000109'
    ))
  );
  perform public.refresh_registration_observation_notification_delivery_v1(
    v_missing_identity_delivery,
    (v_missing_identity_delivery_claim ->> 'claim_token')::uuid,
    v_missing_identity_event_id,
    v_rule_scheduled,
    2,
    '[청강 예약] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 영어 청강 예약',
    '/admin/registration-observation?observationId=95200000-0000-4000-8000-000000000109',
    v_missing_identity_payload,
    v_missing_identity_payload_hash,
    v_missing_identity_render_hash
  );
  update dashboard_private.google_chat_profile_identities identity_row
  set chat_user_id = null,
      source = null,
      verification_status = 'not_found',
      last_sync_status = 'not_found',
      verified_at = null,
      updated_at = clock_timestamp()
  where identity_row.profile_id = v_teacher;
  v_missing_identity_prepare := public.prepare_registration_observation_notification_delivery_v1(
    v_missing_identity_delivery,
    (v_missing_identity_delivery_claim ->> 'claim_token')::uuid,
    v_missing_identity_event_id,
    v_rule_scheduled,
    2,
    v_missing_identity_payload_hash,
    v_missing_identity_render_hash
  );
  if v_missing_identity_prepare ->> 'status' is distinct from 'sending'
    or v_missing_identity_prepare -> 'mention_user_names' is distinct from '[]'::jsonb
  then
    raise exception 'registration_observation_provider_zero_missing_identity_prepare_invalid';
  end if;
  update dashboard_private.google_chat_profile_identities identity_row
  set chat_user_id = '123456788',
      source = 'manual',
      verification_status = 'verified',
      last_sync_status = 'ok',
      verified_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where identity_row.profile_id = v_teacher;

  update public.ops_registration_appointments
  set status = 'completed', notification_revision = 3, updated_at = clock_timestamp()
  where id = v_appointment;
  update public.ops_registration_observations
  set status = 'completed',
      attendance = 'attended',
      attendance_recorded_by = v_teacher,
      attendance_recorded_at = clock_timestamp(),
      suitability_result = 'fit',
      feedback_reason = 'provider-zero 합성 피드백',
      feedback_submitted_by = v_teacher,
      feedback_submitted_at = clock_timestamp(),
      feedback_revision = 1,
      revision = revision + 1,
      updated_by = v_teacher,
      updated_at = clock_timestamp()
  where id = v_observation;
  insert into dashboard_private.registration_observation_domain_events(
    event_id, observation_id, appointment_id, notification_revision, event_kind,
    booking_fact_hash, source_revision, occurred_at
  )
  select
    v_feedback_event, observation.id, observation.appointment_id, 3,
    'observation_feedback_submitted', observation.booking_fact_hash,
    observation.source_revision, clock_timestamp()
  from public.ops_registration_observations observation
  where observation.id = v_observation;
  select claim into strict v_feedback_chat_claim
  from public.claim_registration_observation_chat_jobs_v1(
    'provider-zero-google-chat-feedback-job-v1', 1, 60
  ) claim
  where claim ->> 'event_key' = 'registration.observation_feedback_submitted';
  v_feedback_payload := pg_temp.provider_zero_payload_for_job_v1(
    (v_feedback_chat_claim ->> 'job_id')::uuid
  );
  v_feedback_materialized := public.materialize_registration_observation_chat_job_v1(
    (v_feedback_chat_claim ->> 'job_id')::uuid,
    (v_feedback_chat_claim ->> 'claim_token')::uuid,
    3,
    v_feedback_payload
  );
  v_feedback_event_id := (v_feedback_materialized ->> 'event_id')::uuid;
  v_feedback_chat_delivery := pg_temp.provider_zero_apply_fanout_v1(
    v_feedback_event_id,
    v_rule_feedback_chat,
    jsonb_build_object(
      'target_kind','connection',
      'target_key','connection:google_chat.management',
      'target_profile_id',null,
      'connection_key','google_chat.management',
      'target_snapshot',jsonb_build_object('connection_key','google_chat.management')
    ),
    '[청강 피드백 등록] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 청강 피드백이 등록되었습니다.',
    '/admin/registration?taskId=95200000-0000-4000-8000-000000000106'
  );
  v_feedback_in_app_delivery := pg_temp.provider_zero_apply_fanout_v1(
    v_feedback_event_id,
    v_rule_feedback_in_app,
    jsonb_build_object(
      'target_kind','profile',
      'target_key','profile:95200000-0000-4000-8000-000000000001',
      'target_profile_id',v_director,
      'connection_key',null,
      'target_snapshot',jsonb_build_object('profile_id',v_director)
    ),
    '[청강 피드백 등록] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 청강 피드백이 등록되었습니다.',
    '/admin/registration?taskId=95200000-0000-4000-8000-000000000106'
  );
  select jsonb_object_agg(claim ->> 'channel_key', claim)
  into v_feedback_claims
  from public.claim_notification_deliveries_v1(
    'provider-zero-google-chat-feedback-delivery-v1', 10, 60
  ) claim
  where (claim ->> 'delivery_id')::uuid in (
    v_feedback_chat_delivery, v_feedback_in_app_delivery
  );
  if v_feedback_claims is null
    or not (v_feedback_claims ?& array['google_chat','in_app'])
  then
    raise exception 'registration_observation_provider_zero_feedback_claim_invalid';
  end if;
  v_feedback_payload_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(v_feedback_payload)
  );
  v_feedback_render_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(jsonb_build_object(
      'title','[청강 피드백 등록] provider-zero 청강학생',
      'body','학생: provider-zero 청강학생 · 청강 피드백이 등록되었습니다.',
      'href','/admin/registration?taskId=95200000-0000-4000-8000-000000000106'
    ))
  );
  v_feedback_chat_frozen := public.read_registration_observation_notification_delivery_frozen_state_v1(
    v_feedback_chat_delivery,
    (v_feedback_claims #>> '{google_chat,claim_token}')::uuid
  );
  v_feedback_chat_refresh := public.refresh_registration_observation_notification_delivery_v1(
    v_feedback_chat_delivery,
    (v_feedback_claims #>> '{google_chat,claim_token}')::uuid,
    v_feedback_event_id,
    v_rule_feedback_chat,
    2,
    '[청강 피드백 등록] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 청강 피드백이 등록되었습니다.',
    '/admin/registration?taskId=95200000-0000-4000-8000-000000000106',
    v_feedback_payload, v_feedback_payload_hash, v_feedback_render_hash
  );
  v_feedback_in_app_frozen := public.read_registration_observation_notification_delivery_frozen_state_v1(
    v_feedback_in_app_delivery,
    (v_feedback_claims #>> '{in_app,claim_token}')::uuid
  );
  v_feedback_in_app_refresh := public.refresh_registration_observation_notification_delivery_v1(
    v_feedback_in_app_delivery,
    (v_feedback_claims #>> '{in_app,claim_token}')::uuid,
    v_feedback_event_id,
    v_rule_feedback_in_app,
    2,
    '[청강 피드백 등록] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 청강 피드백이 등록되었습니다.',
    '/admin/registration?taskId=95200000-0000-4000-8000-000000000106',
    v_feedback_payload, v_feedback_payload_hash, v_feedback_render_hash
  );
  if v_feedback_chat_frozen -> 'payloadFingerprint' <> 'null'::jsonb
    or v_feedback_in_app_frozen -> 'payloadFingerprint' <> 'null'::jsonb
    or v_feedback_chat_refresh ->> 'outcome' is distinct from 'refreshed'
    or v_feedback_in_app_refresh ->> 'outcome' is distinct from 'refreshed'
  then
    raise exception 'registration_observation_provider_zero_feedback_refresh_invalid';
  end if;
  v_feedback_chat_prepare := public.prepare_registration_observation_notification_delivery_v1(
    v_feedback_chat_delivery,
    (v_feedback_claims #>> '{google_chat,claim_token}')::uuid,
    v_feedback_event_id,
    v_rule_feedback_chat,
    2,
    v_feedback_payload_hash,
    v_feedback_render_hash
  );
  v_feedback_in_app_prepare := public.prepare_registration_observation_notification_delivery_v1(
    v_feedback_in_app_delivery,
    (v_feedback_claims #>> '{in_app,claim_token}')::uuid,
    v_feedback_event_id,
    v_rule_feedback_in_app,
    2,
    v_feedback_payload_hash,
    v_feedback_render_hash
  );
  select count(*) into v_notification_count
  from public.dashboard_notifications notification
  where notification.source_delivery_id = v_feedback_in_app_delivery;
  select count(*) into v_push_count
  from dashboard_private.notification_deliveries delivery
  where delivery.parent_delivery_id = v_feedback_in_app_delivery;
  if v_feedback_chat_prepare ->> 'status' is distinct from 'sending'
    or v_feedback_chat_prepare ->> 'connection_key' is distinct from 'google_chat.management'
    or v_feedback_chat_prepare -> 'mention_user_names'
      is distinct from '["users/123456789"]'::jsonb
    or v_feedback_in_app_prepare ->> 'status' is distinct from 'sent'
    or (v_feedback_in_app_prepare ->> 'push_children_created')::integer <> 0
    or v_notification_count <> 1
    or v_push_count <> 0
  then
    raise exception 'registration_observation_provider_zero_feedback_prepare_invalid';
  end if;

  -- The paired event must keep management Chat independent from a recipient
  -- loss after fanout. Exercise both final-prepare channel orders.
  update public.ops_registration_appointments
  set notification_revision = 4,
      updated_at = clock_timestamp()
  where id = v_appointment;
  select dashboard_private.get_registration_observation_notification_source_impl_v1(v_observation)
  into strict v_source;
  insert into dashboard_private.registration_observation_domain_events(
    event_id, observation_id, appointment_id, notification_revision, event_kind,
    booking_fact_hash, source_revision, occurred_at
  ) values (
    v_missing_director_event, v_observation, v_appointment,
    (v_source ->> 'notificationRevision')::integer,
    'observation_feedback_submitted', v_source ->> 'bookingFactHash',
    v_source -> 'sourceRevision', clock_timestamp()
  );
  v_missing_director_pair := pg_temp.provider_zero_prepare_feedback_pair_v1(
    v_missing_director_event, v_director, 'null', false
  );
  if v_missing_director_pair is distinct from jsonb_build_object(
      'managementStatus','sending',
      'managementConnectionKey','google_chat.management',
      'inAppStatus','canceled',
      'inAppStatusReason','recipient_revoked'
    ) then
    raise exception 'registration_observation_provider_zero_missing_director_pair_invalid';
  end if;
  update public.ops_registration_subject_tracks track
  set director_profile_id = v_director,
      director_assignment_source = 'manual',
      director_assignment_rule_key = null,
      director_assigned_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where track.id = v_track;

  update public.ops_registration_appointments
  set notification_revision = 5,
      updated_at = clock_timestamp()
  where id = v_appointment;
  select dashboard_private.get_registration_observation_notification_source_impl_v1(v_observation)
  into strict v_source;
  insert into dashboard_private.registration_observation_domain_events(
    event_id, observation_id, appointment_id, notification_revision, event_kind,
    booking_fact_hash, source_revision, occurred_at
  ) values (
    v_inactive_director_event, v_observation, v_appointment,
    (v_source ->> 'notificationRevision')::integer,
    'observation_feedback_submitted', v_source ->> 'bookingFactHash',
    v_source -> 'sourceRevision', clock_timestamp()
  );
  v_inactive_director_pair := pg_temp.provider_zero_prepare_feedback_pair_v1(
    v_inactive_director_event, v_director, 'banned', true
  );
  if v_inactive_director_pair is distinct from jsonb_build_object(
      'managementStatus','sending',
      'managementConnectionKey','google_chat.management',
      'inAppStatus','canceled',
      'inAppStatusReason','recipient_revoked'
    ) then
    raise exception 'registration_observation_provider_zero_inactive_director_pair_invalid';
  end if;
  update auth.users
  set banned_until = null,
      updated_at = clock_timestamp()
  where id = v_director;

  -- A missing recipient at target selection time creates only the management
  -- half; it must never manufacture a fallback profile delivery.
  update public.ops_registration_subject_tracks track
  set director_profile_id = null,
      director_assignment_source = null,
      director_assignment_rule_key = null,
      director_assigned_at = null,
      updated_at = clock_timestamp()
  where track.id = v_track;
  update public.ops_registration_appointments
  set notification_revision = 6,
      updated_at = clock_timestamp()
  where id = v_appointment;
  select dashboard_private.get_registration_observation_notification_source_impl_v1(v_observation)
  into strict v_source;
  insert into dashboard_private.registration_observation_domain_events(
    event_id, observation_id, appointment_id, notification_revision, event_kind,
    booking_fact_hash, source_revision, occurred_at
  ) values (
    v_missing_director_before_fanout_event, v_observation, v_appointment,
    (v_source ->> 'notificationRevision')::integer,
    'observation_feedback_submitted', v_source ->> 'bookingFactHash',
    v_source -> 'sourceRevision', clock_timestamp()
  );
  select job.* into strict v_missing_director_before_fanout_job
  from dashboard_private.registration_observation_chat_jobs job
  where job.domain_event_id = v_missing_director_before_fanout_event
    and job.event_key = 'registration.observation_feedback_submitted';
  select claim into strict v_missing_director_before_fanout_claim
  from public.claim_registration_observation_chat_jobs_v1(
    'provider-zero-google-chat-director-null-fanout-job-v1', 10, 60
  ) claim
  where (claim ->> 'job_id')::uuid = v_missing_director_before_fanout_job.job_id;
  v_missing_director_before_fanout_payload := pg_temp.provider_zero_payload_for_job_v1(
    v_missing_director_before_fanout_job.job_id
  );
  v_missing_director_before_fanout_materialized := public.materialize_registration_observation_chat_job_v1(
    v_missing_director_before_fanout_job.job_id,
    (v_missing_director_before_fanout_claim ->> 'claim_token')::uuid,
    3,
    v_missing_director_before_fanout_payload
  );
  v_missing_director_before_fanout_event_id :=
    (v_missing_director_before_fanout_materialized ->> 'event_id')::uuid;
  v_missing_director_before_fanout_delivery := pg_temp.provider_zero_apply_fanout_v1(
    v_missing_director_before_fanout_event_id,
    v_rule_feedback_chat,
    jsonb_build_object(
      'target_kind','connection',
      'target_key','connection:google_chat.management',
      'target_profile_id',null,
      'connection_key','google_chat.management',
      'target_snapshot',jsonb_build_object('connection_key','google_chat.management')
    ),
    '[청강 피드백 등록] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 청강 피드백이 등록되었습니다.',
    '/admin/registration?taskId=95200000-0000-4000-8000-000000000106'
  );
  select count(*) into v_missing_director_before_fanout_count
  from dashboard_private.notification_deliveries delivery
  where delivery.event_id = v_missing_director_before_fanout_event_id
    and delivery.channel_key = 'google_chat';
  select count(*) into v_missing_director_before_fanout_in_app_count
  from dashboard_private.notification_deliveries delivery
  where delivery.event_id = v_missing_director_before_fanout_event_id
    and delivery.channel_key = 'in_app';
  if v_missing_director_before_fanout_count <> 1
    or v_missing_director_before_fanout_in_app_count <> 0 then
    raise exception 'registration_observation_provider_zero_missing_director_fanout_invalid';
  end if;
  select claim into strict v_missing_director_before_fanout_delivery_claim
  from public.claim_notification_deliveries_v1(
    'provider-zero-google-chat-director-null-fanout-delivery-v1', 10, 60
  ) claim
  where (claim ->> 'delivery_id')::uuid = v_missing_director_before_fanout_delivery;
  v_missing_director_before_fanout_payload_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(v_missing_director_before_fanout_payload)
  );
  v_missing_director_before_fanout_render_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(jsonb_build_object(
      'title','[청강 피드백 등록] provider-zero 청강학생',
      'body','학생: provider-zero 청강학생 · 청강 피드백이 등록되었습니다.',
      'href','/admin/registration?taskId=95200000-0000-4000-8000-000000000106'
    ))
  );
  perform public.refresh_registration_observation_notification_delivery_v1(
    v_missing_director_before_fanout_delivery,
    (v_missing_director_before_fanout_delivery_claim ->> 'claim_token')::uuid,
    v_missing_director_before_fanout_event_id,
    v_rule_feedback_chat,
    2,
    '[청강 피드백 등록] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 청강 피드백이 등록되었습니다.',
    '/admin/registration?taskId=95200000-0000-4000-8000-000000000106',
    v_missing_director_before_fanout_payload,
    v_missing_director_before_fanout_payload_hash,
    v_missing_director_before_fanout_render_hash
  );
  v_missing_director_before_fanout_prepare :=
    public.prepare_registration_observation_notification_delivery_v1(
      v_missing_director_before_fanout_delivery,
      (v_missing_director_before_fanout_delivery_claim ->> 'claim_token')::uuid,
      v_missing_director_before_fanout_event_id,
      v_rule_feedback_chat,
      2,
      v_missing_director_before_fanout_payload_hash,
      v_missing_director_before_fanout_render_hash
    );
  if v_missing_director_before_fanout_prepare ->> 'status' is distinct from 'sending'
    or v_missing_director_before_fanout_prepare -> 'mention_user_names'
      is distinct from '[]'::jsonb then
    raise exception 'registration_observation_provider_zero_missing_director_management_invalid';
  end if;
  update public.ops_registration_subject_tracks track
  set director_profile_id = v_director,
      director_assignment_source = 'manual',
      director_assignment_rule_key = null,
      director_assigned_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where track.id = v_track;

  -- The real assignment RPC creates the assignment fact consumed by the
  -- observation materializer. Both prior/current verified directors remain
  -- the frozen semantic mention set on its management delivery.
  select detail.common_revision into strict v_reassignment_common_revision
  from public.ops_registration_details detail
  where detail.task_id = v_task;
  perform set_config('request.jwt.claim.sub', v_director::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  v_reassignment_receipt := public.assign_registration_track_director(
    v_track, v_director_b, 'manual', null, v_reassignment_common_revision,
    'provider-zero-google-chat-director-reassigned-v1'
  );
  perform set_config('request.jwt.claim.role', 'service_role', true);
  if v_reassignment_receipt is null then
    raise exception 'registration_observation_provider_zero_reassignment_receipt_invalid';
  end if;
  select job.* into strict v_reassignment_job
  from dashboard_private.registration_observation_chat_jobs job
  where job.event_key = 'registration.observation_director_reassigned'
    and job.observation_id = v_observation;
  select claim into strict v_reassignment_job_claim
  from public.claim_registration_observation_chat_jobs_v1(
    'provider-zero-google-chat-reassignment-job-v1', 10, 60
  ) claim
  where (claim ->> 'job_id')::uuid = v_reassignment_job.job_id;
  v_reassignment_payload := pg_temp.provider_zero_payload_for_job_v1(v_reassignment_job.job_id);
  if not dashboard_private.registration_observation_chat_payload_valid_v3(
      v_reassignment_payload
    ) then
    raise exception 'registration_observation_provider_zero_reassignment_payload_invalid:%',
      v_reassignment_payload;
  end if;
  v_reassignment_materialized := public.materialize_registration_observation_chat_job_v1(
    v_reassignment_job.job_id,
    (v_reassignment_job_claim ->> 'claim_token')::uuid,
    3,
    v_reassignment_payload
  );
  if v_reassignment_materialized ->> 'outcome' is distinct from 'materialized'
    or v_reassignment_materialized ->> 'event_id' is null
    or v_reassignment_materialized ->> 'fanout_job_id' is null
  then
    raise exception 'registration_observation_provider_zero_reassignment_materialize_invalid:%',
      v_reassignment_materialized;
  end if;
  v_reassignment_event_id := (v_reassignment_materialized ->> 'event_id')::uuid;
  select pg_catalog.jsonb_build_object(
    'fanout_job_id', fanout.id,
    'status', fanout.status,
    'next_attempt_at', fanout.next_attempt_at,
    'scheduled_for', fanout.scheduled_for,
    'event_key', event_row.event_key,
    'rule_snapshot', event_row.rule_snapshot
  )
  into v_reassignment_fanout_state
  from dashboard_private.notification_event_fanout_jobs fanout
  join dashboard_private.notification_events event_row
    on event_row.id = fanout.event_id
  where fanout.id = (v_reassignment_materialized ->> 'fanout_job_id')::uuid;
  if v_reassignment_fanout_state ->> 'status' is distinct from 'pending'
    or (v_reassignment_fanout_state ->> 'next_attempt_at') is null
    or (v_reassignment_fanout_state ->> 'next_attempt_at')::timestamptz
      > pg_catalog.clock_timestamp()
  then
    raise exception 'registration_observation_provider_zero_reassignment_fanout_not_ready:%',
      v_reassignment_fanout_state;
  end if;
  v_reassignment_delivery := pg_temp.provider_zero_apply_fanout_v1(
    v_reassignment_event_id,
    v_rule_reassigned,
    jsonb_build_object(
      'target_kind','connection',
      'target_key','connection:google_chat.management',
      'target_profile_id',null,
      'connection_key','google_chat.management',
      'target_snapshot',jsonb_build_object('connection_key','google_chat.management')
    ),
    '[청강 담당 원장 변경] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 영어 청강 담당 원장이 변경되었습니다.',
    '/admin/registration?taskId=95200000-0000-4000-8000-000000000106'
  );
  select claim into strict v_reassignment_delivery_claim
  from public.claim_notification_deliveries_v1(
    'provider-zero-google-chat-reassignment-delivery-v1', 10, 60
  ) claim
  where (claim ->> 'delivery_id')::uuid = v_reassignment_delivery;
  v_reassignment_payload_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(v_reassignment_payload)
  );
  v_reassignment_render_hash := dashboard_private.notification_sha256_hex_v1(
    dashboard_private.notification_canonical_json_v1(jsonb_build_object(
      'title','[청강 담당 원장 변경] provider-zero 청강학생',
      'body','학생: provider-zero 청강학생 · 영어 청강 담당 원장이 변경되었습니다.',
      'href','/admin/registration?taskId=95200000-0000-4000-8000-000000000106'
    ))
  );
  perform public.refresh_registration_observation_notification_delivery_v1(
    v_reassignment_delivery,
    (v_reassignment_delivery_claim ->> 'claim_token')::uuid,
    v_reassignment_event_id,
    v_rule_reassigned,
    2,
    '[청강 담당 원장 변경] provider-zero 청강학생',
    '학생: provider-zero 청강학생 · 영어 청강 담당 원장이 변경되었습니다.',
    '/admin/registration?taskId=95200000-0000-4000-8000-000000000106',
    v_reassignment_payload,
    v_reassignment_payload_hash,
    v_reassignment_render_hash
  );
  v_reassignment_prepare := public.prepare_registration_observation_notification_delivery_v1(
    v_reassignment_delivery,
    (v_reassignment_delivery_claim ->> 'claim_token')::uuid,
    v_reassignment_event_id,
    v_rule_reassigned,
    2,
    v_reassignment_payload_hash,
    v_reassignment_render_hash
  );
  if v_reassignment_prepare ->> 'status' is distinct from 'sending'
    or v_reassignment_prepare -> 'mention_user_names'
      is distinct from '["users/123456789","users/987654321"]'::jsonb then
    raise exception 'registration_observation_provider_zero_reassignment_prepare_invalid';
  end if;

  select jsonb_build_object(
    'customerMessages', (select count(*) from public.ops_registration_customer_messages),
    'reminders', (select count(*) from dashboard_private.registration_customer_reminder_jobs)
  ) into v_customer_after;
  if v_customer_after is distinct from v_customer_before
    or exists (
      select 1
      from dashboard_private.notification_audit_logs audit
      where audit.entity_kind = 'notification_external_attempt'
        and audit.action = 'external_attempt_registered'
    )
  then
    raise exception 'registration_observation_provider_zero_external_boundary_invalid';
  end if;

  insert into registration_observation_provider_zero_lifecycle_receipt(payload)
  values (jsonb_build_object(
    'v2RuleSaveReceiptExact', true,
    'googleChatPrepareBoundaryReached', true,
    'googleChatDeliveryStatus', v_schedule_prepare ->> 'status',
    'scheduledMentionUserNames', v_schedule_prepare -> 'mention_user_names',
    'feedbackMentionUserNames', v_feedback_chat_prepare -> 'mention_user_names',
    'directorReassignedMentionUserNames', v_reassignment_prepare -> 'mention_user_names',
    'missingIdentityMentionUserNames', v_missing_identity_prepare -> 'mention_user_names',
    'inAppCommitBoundaryReached', true,
    'inAppDeliveryStatus', v_feedback_in_app_prepare ->> 'status',
    'inAppDashboardNotificationCount', v_notification_count,
    'inAppPushChildrenCreated', v_push_count,
    'missingDirectorPair', v_missing_director_pair,
    'inactiveDirectorPair', v_inactive_director_pair,
    'missingDirectorBeforeFanout', jsonb_build_object(
      'managementDeliveryCount', v_missing_director_before_fanout_count,
      'inAppDeliveryCount', v_missing_director_before_fanout_in_app_count
    ),
    'customerQueueUnchanged', true,
    'solapiMessagesUnchanged', true,
    'externalAttemptAudit', 0
  ));
end
$lifecycle$;

select payload::text
from registration_observation_provider_zero_lifecycle_receipt;
commit;
`;
}

function parseCoreReceipt(stdout) {
  const values = String(stdout ?? "")
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length !== 1) {
    fail(`${CORE_RECEIPT}_missing`);
  }
  let receipt;
  try {
    receipt = JSON.parse(values[0]);
  } catch {
    fail(`${CORE_RECEIPT}_invalid`);
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail(`${CORE_RECEIPT}_invalid`);
  }
  return receipt;
}

function parseLifecycleReceipt(stdout) {
  const values = String(stdout ?? "")
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length !== 1) {
    fail("registration_observation_provider_zero_lifecycle_receipt_missing");
  }
  let receipt;
  try {
    receipt = JSON.parse(values[0]);
  } catch {
    fail("registration_observation_provider_zero_lifecycle_receipt_invalid");
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail("registration_observation_provider_zero_lifecycle_receipt_invalid");
  }
  return receipt;
}

function isOwnedLoopbackTarget(input, getOwnedPorts) {
  const ports = getOwnedPorts?.();
  if (!ports || ports.host !== LOOPBACK_HOST) return false;
  let hostname;
  let port;
  try {
    if (typeof input === "string" || input instanceof URL) {
      const url = new URL(input);
      hostname = url.hostname;
      port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    } else if (input && typeof input === "object") {
      hostname = input.hostname ?? String(input.host ?? "").split(":", 1)[0];
      port = Number(input.port ?? 80);
    }
  } catch {
    return false;
  }
  return hostname === LOOPBACK_HOST
    && [ports.apiPort, ports.dbPort, ports.shadowPort, ports.poolerPort].includes(port);
}

export function installProviderZeroTransportTraps(getOwnedPorts) {
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = nodeHttp.request;
  const originalHttpGet = nodeHttp.get;
  const originalHttpsRequest = nodeHttps.request;
  const originalHttpsGet = nodeHttps.get;
  const counters = {
    fetch: 0,
    http: 0,
    https: 0,
    provider: 0,
    directory: 0,
    externalAttempt: 0,
  };
  globalThis.fetch = async (input, init) => {
    if (isOwnedLoopbackTarget(input, getOwnedPorts)) {
      return originalFetch(input, init);
    }
    counters.fetch += 1;
    throw new Error("registration_observation_provider_zero_external_fetch_forbidden");
  };
  nodeHttp.request = (...args) => {
    if (isOwnedLoopbackTarget(args[0], getOwnedPorts)) return originalHttpRequest(...args);
    counters.http += 1;
    throw new Error("registration_observation_provider_zero_external_http_forbidden");
  };
  nodeHttp.get = (...args) => {
    if (isOwnedLoopbackTarget(args[0], getOwnedPorts)) return originalHttpGet(...args);
    counters.http += 1;
    throw new Error("registration_observation_provider_zero_external_http_forbidden");
  };
  nodeHttps.request = (...args) => {
    if (isOwnedLoopbackTarget(args[0], getOwnedPorts)) return originalHttpsRequest(...args);
    counters.https += 1;
    throw new Error("registration_observation_provider_zero_external_https_forbidden");
  };
  nodeHttps.get = (...args) => {
    if (isOwnedLoopbackTarget(args[0], getOwnedPorts)) return originalHttpsGet(...args);
    counters.https += 1;
    throw new Error("registration_observation_provider_zero_external_https_forbidden");
  };
  syncBuiltinESMExports();
  return {
    counters,
    restore() {
      globalThis.fetch = originalFetch;
      nodeHttp.request = originalHttpRequest;
      nodeHttp.get = originalHttpGet;
      nodeHttps.request = originalHttpsRequest;
      nodeHttps.get = originalHttpsGet;
      syncBuiltinESMExports();
    },
  };
}

export async function createOwnedProviderZeroProject({
  repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  env = process.env,
  spawnImpl = defaultSpawnImpl,
  makeTempRoot = () => mkdtemp(path.join(os.tmpdir(), WORKDIR_PREFIX)),
  randomBytes = defaultRandomBytes,
  allocateLoopbackPort = allocateFreeLoopbackPort,
  inspectResources,
  now = Date.now,
} = {}) {
  const childEnvironment = assertProviderZeroEnvironment(env);
  if (typeof spawnImpl !== "function" || typeof makeTempRoot !== "function") {
    fail("registration_observation_google_chat_provider_zero_dependencies_invalid");
  }
  const runtimeRoot = await makeTempRoot();
  if (!ownedRuntimeRoot(runtimeRoot)) {
    fail("registration_observation_google_chat_provider_zero_runtime_root_rejected");
  }
  let reservation;
  try {
  const identity = randomBytes(6);
  if (!(identity instanceof Uint8Array) || identity.byteLength !== 6) {
    fail("registration_observation_google_chat_provider_zero_project_identity_rejected");
  }
  const projectId = `${PROJECT_ID_PREFIX}${Buffer.from(identity).toString("hex")}`;
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    fail("registration_observation_google_chat_provider_zero_project_identity_rejected");
  }
  const versionResult = await spawnImpl(PINNED_SUPABASE_GO, ["--version"], {
    cwd: repositoryRoot,
    env: childEnvironment,
  });
  const version = String(versionResult?.stdout ?? "").trim();
  if (version !== PINNED_SUPABASE_VERSION) {
    fail("registration_observation_google_chat_provider_zero_cli_version_mismatch", version);
  }
  reservation = await reserveLoopbackPorts({
    projectId,
    allocate: allocateLoopbackPort,
    now,
  });
  const manifestPath = path.join(runtimeRoot, "provider-zero-manifest.json");
  const project = {
    repositoryRoot,
    runtimeRoot,
    projectId,
    ports: reservation.ports,
    dbUrl: reservation.ports.dbUrl,
    claims: reservation.claims,
    childEnvironment,
    manifestPath,
    started: false,
    cleaned: false,
    focusTestDirectories: new Map(),
    migrations: [],
  };
  await writeFile(
    manifestPath,
    `${JSON.stringify({
      version: 1,
      projectId,
      host: LOOPBACK_HOST,
      dbUrl: project.dbUrl,
      migrationCeiling: MIGRATION_CEILING,
      resources: exactResources(projectId),
      ports: reservation.ports,
    }, null, 2)}\n`,
    "utf8",
  );
  const inspect = inspectResources
    ?? ((ownedProjectId) => defaultInspectResources(ownedProjectId, childEnvironment));
  const command = async (executable, args) => spawnImpl(executable, args, {
    cwd: repositoryRoot,
    env: childEnvironment,
  });

  const cleanupOwnedResources = async () => {
    if (project.cleaned) return;
    const cleanupErrors = [];
    if (project.started) {
      try {
        await command(PINNED_SUPABASE_GO, [
          "stop",
          "--workdir",
          runtimeRoot,
          "--project-id",
          projectId,
          "--no-backup",
          "--yes",
        ]);
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        const leftovers = await inspect(projectId);
        if (!Array.isArray(leftovers)) {
          fail("registration_observation_google_chat_provider_zero_resource_inventory_invalid");
        }
        if (leftovers.length > 0) {
          await removeExactResources(leftovers, projectId, childEnvironment, spawnImpl);
        }
        const residue = await inspect(projectId);
        if (Array.isArray(residue) && residue.length > 0) {
          fail("registration_observation_google_chat_provider_zero_resource_cleanup_incomplete");
        }
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      if (!ownedRuntimeRoot(runtimeRoot)) {
        fail("registration_observation_google_chat_provider_zero_runtime_root_rejected");
      }
      await rm(runtimeRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    for (const claim of [...reservation.claims].reverse()) {
      try {
        await releaseLease(claim);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    project.cleaned = true;
    if (cleanupErrors.length > 0) {
      const error = new Error("registration_observation_google_chat_provider_zero_cleanup_failed");
      error.cleanupErrors = cleanupErrors;
      throw error;
    }
  };

  const resetMigrationBaseline = async () => command(PINNED_SUPABASE_GO, [
    "db",
    "reset",
    "--local",
    "--no-seed",
    "--workdir",
    runtimeRoot,
  ]);

  return Object.freeze({
    repositoryRoot,
    projectId,
    runtimeRoot,
    dbUrl: project.dbUrl,
    ports: project.ports,
    manifestPath,
    async applyMigrationsThrough(version) {
      if (version !== MIGRATION_CEILING) {
        fail("registration_observation_google_chat_provider_zero_migration_ceiling_rejected");
      }
      await writeProjectFiles(project);
      await command(PINNED_SUPABASE_GO, ["db", "start", "--workdir", runtimeRoot]);
      project.started = true;
      await resetMigrationBaseline();
      return Object.freeze([...project.migrations]);
    },
    async execSql(sql) {
      if (typeof sql !== "string" || sql.trim() === "") {
        fail("registration_observation_google_chat_provider_zero_sql_rejected");
      }
      return command("docker", psqlCommand(projectId, sql));
    },
    async applyForwardMigration(migrationPath, testPath = FORWARD_PGTAP_PATH) {
      return stageForwardMigration(project, resetMigrationBaseline, migrationPath, testPath);
    },
    async runPgTap(testPath = GOOGLE_CHAT_TEST_PATH) {
      const focusTestDirectoryPath = project.focusTestDirectories.get(testPath);
      if (!focusTestDirectoryPath) {
        fail("registration_observation_google_chat_provider_zero_pgtap_path_rejected");
      }
      return command(PINNED_SUPABASE_GO, [
        "test",
        "db",
        "--workdir",
        runtimeRoot,
        focusTestDirectoryPath,
        "--db-url",
        project.dbUrl,
      ]);
    },
    resetMigrationBaseline,
    cleanupOwnedResources,
  });
  } catch (error) {
    const cleanupErrors = [];
    if (reservation) {
      for (const claim of [...reservation.claims].reverse()) {
        try {
          await releaseLease(claim);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
    }
    try {
      await rm(runtimeRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) error.cleanupErrors = cleanupErrors;
    throw error;
  }
}

export async function runRegistrationObservationGoogleChatProviderZero(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  parseProviderZeroArguments(argv);
  assertProviderZeroEnvironment(env);

  let project;
  const traps = installProviderZeroTransportTraps(() => project?.ports ?? null);
  let primaryError;
  let cleanupError;
  let receipt;
  try {
    project = await createOwnedProviderZeroProject(options);
    await project.applyMigrationsThrough(MIGRATION_CEILING);
    await project.runPgTap();
    await project.applyForwardMigration(
      await forwardMigrationPath(project.repositoryRoot, FORWARD_PGTAP_PATH),
      FORWARD_PGTAP_PATH,
    );
    await project.runPgTap(FORWARD_PGTAP_PATH);
    await project.applyForwardMigration(
      await forwardMigrationPath(project.repositoryRoot, PENDING_SCHEDULE_PGTAP_PATH),
      PENDING_SCHEDULE_PGTAP_PATH,
    );
    await project.runPgTap(PENDING_SCHEDULE_PGTAP_PATH);
    await project.resetMigrationBaseline();
    await project.execSql(providerZeroPrerequisiteSql());
    const core = parseCoreReceipt((await project.execSql(coreLifecycleSql()))?.stdout);
    const lifecycle = parseLifecycleReceipt(
      (await project.execSql(providerZeroLifecycleSql()))?.stdout,
    );
    receipt = {
      mode: "provider-zero-lifecycle-receipt",
      projectId: project.projectId,
      runtimeRoot: project.runtimeRoot,
      dbUrl: project.dbUrl,
      callTrace: [
        "readiness",
        "activate",
        "heartbeat.started",
        "heartbeat.succeeded",
        "flag.settings-ui",
        "flag.registration-dispatch",
        "v2-save",
        "lifecycle",
      ],
      ...core,
      ...lifecycle,
      ...traps.counters,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      if (project) await project.cleanupOwnedResources();
    } catch (error) {
      cleanupError = error;
    } finally {
      traps.restore();
    }
  }
  if (cleanupError) {
    if (primaryError) primaryError.cleanupError = cleanupError;
    else throw cleanupError;
  }
  if (primaryError) throw primaryError;
  return Object.freeze({ ...receipt, cleanup: "passed" });
}

async function main() {
  const result = await runRegistrationObservationGoogleChatProviderZero({
    argv: process.argv.slice(2),
    env: process.env,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
