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
const BASELINE_RECEIPT =
  "registration_observation_provider_zero_baseline_marker_missing";
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
  if (testPath !== FORWARD_PGTAP_PATH) {
    fail("registration_observation_google_chat_provider_zero_forward_pgtap_path_rejected");
  }
  const migrationsRoot = path.join(project.repositoryRoot, "supabase", "migrations");
  const resolvedMigrationPath = path.resolve(migrationPath ?? "");
  const migrationBaseName = path.basename(resolvedMigrationPath);
  if (
    path.dirname(resolvedMigrationPath) !== migrationsRoot
    || !/^[0-9]{14}/u.test(migrationBaseName)
    || !migrationBaseName.endsWith(FORWARD_MIGRATION_SUFFIX)
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
  const forwardTestRoot = path.join(supabaseRoot, "focus-tests", "notification-adapters-forward-install");
  await mkdir(forwardTestRoot, { recursive: true });
  await cp(resolvedMigrationPath, stagedMigrationPath);
  await cp(testSourcePath, path.join(forwardTestRoot, "001_notification_adapters_forward_install_test.sql"));
  project.focusTestDirectories.set(FORWARD_PGTAP_PATH, forwardTestRoot);
  project.migrations = [...project.migrations, migrationBaseName];
  await resetMigrationBaseline();
  return Object.freeze([...project.migrations]);
}

function baselineSql() {
  return `
begin;

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

select set_config('request.jwt.claim.sub', '95100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.registration_observation_schema_readiness_v1();
select public.activate_registration_observation_runtime_v1(
  0,
  'provider-zero-baseline-activate'
);
select set_config('request.jwt.claim.role', 'service_role', true);
select public.record_notification_worker_heartbeat_v1(
  'notification-worker-route-v1',
  '95100000-0000-4000-8000-000000000010',
  'started',
  '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
  null
);
select public.record_notification_worker_heartbeat_v1(
  'notification-worker-route-v1',
  '95100000-0000-4000-8000-000000000010',
  'succeeded',
  '{"observation_due":0,"fanout":0,"rule_reconciliation":0,"target_reconciliation":0,"deliveries":0,"reaped":0}'::jsonb,
  null
);

do $$
declare
  v_enabled boolean;
  v_revision bigint;
  v_response jsonb;
begin
  select enabled, revision into strict v_enabled, v_revision
  from dashboard_private.notification_runtime_flags
  where flag_key = 'notification_control_plane_settings_ui_enabled'
  for update;
  if v_enabled or v_revision <> 1 then
    raise exception 'registration_observation_provider_zero_settings_flag_baseline_invalid';
  end if;
  v_response := public.set_notification_runtime_flag_v1(
    'notification_control_plane_settings_ui_enabled',
    true,
    v_revision,
    '95100000-0000-4000-8000-000000000011'
  );
  if (v_response ->> 'enabled')::boolean is not true
    or (v_response ->> 'revision')::bigint <> 2 then
    raise exception 'registration_observation_provider_zero_settings_flag_receipt_invalid';
  end if;
end;
$$;

do $$
declare
  v_enabled boolean;
  v_revision bigint;
begin
  select enabled, revision into strict v_enabled, v_revision
  from dashboard_private.notification_runtime_flags
  where flag_key = 'notification_control_plane_dispatch_registration_enabled'
  for update;
  if v_enabled or v_revision <> 1 then
    raise exception 'registration_observation_provider_zero_dispatch_flag_baseline_invalid';
  end if;
  begin
    perform public.set_notification_runtime_flag_v1(
      'notification_control_plane_dispatch_registration_enabled',
      true,
      v_revision,
      '95100000-0000-4000-8000-000000000012'
    );
    raise exception 'registration_observation_provider_zero_dispatch_marker_unexpected_success';
  exception
    when sqlstate '55000' then
      if sqlerrm is distinct from 'notification_runtime_not_ready' then
        raise;
      end if;
  end;
end;
$$;

select '${BASELINE_RECEIPT}';
commit;
`;
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
    await project.resetMigrationBaseline();
    const baseline = await project.execSql(baselineSql());
    if (!String(baseline?.stdout ?? "").split("\n").map((value) => value.trim()).includes(BASELINE_RECEIPT)) {
      fail("registration_observation_google_chat_provider_zero_baseline_receipt_missing");
    }
    receipt = {
      mode: "baseline-marker-missing",
      baselineMarkerMissing: true,
      projectId: project.projectId,
      runtimeRoot: project.runtimeRoot,
      dbUrl: project.dbUrl,
      runtimeVersion: 0,
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
