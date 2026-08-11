import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
} from "node:fs";
import {
  cp,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PINNED_SUPABASE_GO =
  "/Users/hyunjun/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go";
export const PINNED_SUPABASE_VERSION = "2.103.0";

const LOOPBACK_HOST = "127.0.0.1";
const MIN_DYNAMIC_PORT = 49152;
const MAX_DYNAMIC_PORT = 65535;
const PORT_ALLOCATION_ATTEMPTS = 32;
const PORT_LEASE_ROOT = path.join(
  os.tmpdir(),
  "tips-registration-observation-port-leases-v1",
);
const PORT_LEASE_ROOT_PREFIX =
  "tips-registration-observation-port-leases-";
const RUNTIME_PORT_LEASES = new WeakMap();
const PROJECT_ID_PREFIX = "tips_obs_qa_";
const PROJECT_ID_PATTERN = /^tips_obs_qa_[a-f0-9]{12}$/u;
const WORKDIR_PREFIX = "tips-registration-observation-qa-";
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

const FOCUS_REGISTRY = new Map([
  [
    "schema",
    {
      ceiling: "20260809101000",
      migrations: [
        "20260809100000_registration_observation_core_schema.sql",
      ],
      tests: ["supabase/tests/registration_observation_schema_test.sql"],
      fixture: "noop",
      providerOutboxStage: "core",
    },
  ],
  [
    "booking",
    {
      ceiling: "20260809102000",
      migrations: [
        "20260809102000_registration_observation_booking.sql",
      ],
      tests: [
        "supabase/tests/registration_observation_schema_test.sql",
        "supabase/tests/registration_observation_booking_test.sql",
      ],
      fixture: "booking-committed",
      providerOutboxStage: "core",
    },
  ],
  [
    "workspace",
    {
      ceiling: "20260809102200",
      migrations: [
        "20260809102200_registration_observation_shared_event_filter.sql",
      ],
      tests: [
        "supabase/tests/registration_observation_shared_event_filter_test.sql",
      ],
      fixture: "noop",
      providerOutboxStage: "core",
    },
  ],
  [
    "core-review",
    {
      ceiling: "20260809102450",
      migrations: [
        "20260809102400_registration_observation_core_review_fixes.sql",
        "20260809102450_registration_observation_core_review_followup.sql",
      ],
      tests: [
        "supabase/tests/registration_observation_core_review_fixes_test.sql",
        "supabase/tests/registration_observation_core_review_followup_test.sql",
      ],
      fixture: "noop",
      providerOutboxStage: "core",
    },
  ],
  [
    "feedback-access",
    {
      ceiling: "20260809102500",
      migrations: [
        "20260809102500_registration_observation_feedback_access.sql",
      ],
      tests: [
        "supabase/tests/registration_observation_feedback_access_test.sql",
      ],
      fixture: "noop",
      providerOutboxStage: "core",
    },
  ],
  [
    "feedback-submit",
    {
      ceiling: "20260809103000",
      migrations: [
        "20260809102500_registration_observation_feedback_access.sql",
        "20260809103000_registration_observation_feedback_mutations.sql",
      ],
      tests: [
        "supabase/tests/registration_observation_feedback_access_test.sql",
        "supabase/tests/registration_observation_feedback_submit_test.sql",
      ],
      fixture: Object.freeze({ kind: "committed" }),
      providerOutboxStage: "core",
    },
  ],
  [
    "feedback",
    {
      ceiling: "20260809103500",
      migrations: [
        "20260809102500_registration_observation_feedback_access.sql",
        "20260809103000_registration_observation_feedback_mutations.sql",
        "20260809103500_registration_observation_feedback_decisions.sql",
      ],
      tests: [
        "supabase/tests/registration_observation_feedback_access_test.sql",
        "supabase/tests/registration_observation_feedback_submit_test.sql",
        "supabase/tests/registration_observation_feedback_decisions_test.sql",
      ],
      fixture: Object.freeze({ kind: "committed" }),
      providerOutboxStage: "core",
    },
  ],
  [
    "enrollment",
    {
      ceiling: "20260809104000",
      migrations: [
        "20260809104000_registration_observation_enrollment_source.sql",
      ],
      tests: [
        "supabase/tests/registration_observation_enrollment_test.sql",
      ],
      fixture: Object.freeze({ kind: "committed" }),
      providerOutboxStage: "core",
    },
  ],
  [
    "chat-mentions",
    {
      ceiling: "20260809104500",
      migrations: [
        "20260809104500_dashboard_google_chat_profile_mentions.sql",
      ],
      tests: [
        "supabase/tests/dashboard_google_chat_profile_mentions_test.sql",
      ],
      fixture: "noop",
      providerOutboxStage: "core",
    },
  ],
  [
    "google-chat",
    {
      ceiling: "20260809105000",
      migrations: [
        "20260809105000_registration_observation_google_chat.sql",
      ],
      tests: [
        "supabase/tests/registration_observation_google_chat_test.sql",
      ],
      fixture: "noop",
      providerOutboxStage: "chat",
    },
  ],
  [
    "solapi-contract",
    {
      ceiling: "20260809106000",
      migrations: [
        "20260809106000_registration_observation_solapi_contract.sql",
      ],
      tests: [
        "supabase/tests/registration_observation_solapi_contract_test.sql",
      ],
      fixture: "noop",
      providerOutboxStage: "chat",
    },
  ],
  [
    "solapi-queue",
    {
      ceiling: "20260809106100",
      migrations: [
        "20260809106000_registration_observation_solapi_contract.sql",
        "20260809106100_registration_observation_solapi_queue.sql",
      ],
      tests: [
        "supabase/tests/registration_observation_solapi_contract_test.sql",
        "supabase/tests/registration_observation_solapi_queue_test.sql",
      ],
      fixture: "noop",
      providerOutboxStage: "solapi-queue",
    },
  ],
  [
    "solapi",
    {
      ceiling: "20260809106200",
      migrations: [
        "20260809106000_registration_observation_solapi_contract.sql",
        "20260809106100_registration_observation_solapi_queue.sql",
        "20260809106200_registration_observation_solapi_dispatch.sql",
      ],
      tests: [
        "supabase/tests/registration_observation_solapi_contract_test.sql",
        "supabase/tests/registration_observation_solapi_queue_test.sql",
        "supabase/tests/registration_observation_solapi_dispatch_test.sql",
      ],
      fixture: "noop",
      providerOutboxStage: "solapi-queue",
    },
  ],
]);

const PROVIDER_OUTBOX_STAGE_RANK = new Map([
  ["core", 0],
  ["chat", 1],
  ["solapi-queue", 2],
]);
const PROVIDER_OUTBOX_BASELINE_TABLE =
  "dashboard_private.registration_observation_local_qa_provider_baselines";
const PROVIDER_OUTBOX_ZERO_RECEIPT =
  "registration_observation_provider_outbox_delta=0";
const PROVIDER_OUTBOX_MANIFEST = Object.freeze([
  {
    key: "observation-domain-events",
    relation: "dashboard_private.registration_observation_domain_events",
  },
  {
    key: "observation-chat-jobs",
    relation: "dashboard_private.registration_observation_chat_jobs",
    requiredStage: "chat",
  },
  {
    key: "observation-solapi-event-consumptions",
    relation:
      "dashboard_private.registration_observation_solapi_event_consumptions",
    requiredStage: "solapi-queue",
  },
  {
    key: "observation-customer-messages",
    relation: "public.ops_registration_customer_messages",
    where:
      "message_kind in ('observation_booking', 'observation_reminder')",
  },
  {
    key: "observation-provider-attempt-markers",
    relation: "public.ops_registration_customer_messages",
    where:
      "message_kind in ('observation_booking', 'observation_reminder') and provider_attempt_count = 1",
  },
  {
    key: "registration-reminder-jobs",
    relation: "dashboard_private.registration_customer_reminder_jobs",
  },
  {
    key: "observation-booking-template-receipts",
    relation:
      "dashboard_private.registration_customer_solapi_template_receipts",
    where: "message_kind = 'observation_booking'",
  },
  {
    key: "observation-reminder-template-receipts",
    relation:
      "dashboard_private.registration_customer_solapi_template_receipts",
    where: "message_kind = 'observation_reminder'",
  },
  {
    key: "notification-events",
    relation: "dashboard_private.notification_events",
  },
  {
    key: "notification-fanout-jobs",
    relation: "dashboard_private.notification_event_fanout_jobs",
  },
  {
    key: "notification-deliveries",
    relation: "dashboard_private.notification_deliveries",
  },
  {
    key: "notification-audit-logs",
    relation: "dashboard_private.notification_audit_logs",
  },
]);

function fail(code, detail = "", exitCode = 1) {
  const error = new Error(`${code}${detail ? `:${detail}` : ""}`);
  error.exitCode = exitCode;
  throw error;
}

function hasExactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}

function runtimePortManifestRefused() {
  fail("registration_observation_local_db_runtime_port_manifest_refused", "", 2);
}

export function assertRegistrationObservationRuntimePortManifest(value) {
  if (!hasExactKeys(value, [
    "apiPort",
    "dbPort",
    "dbUrl",
    "host",
    "poolerPort",
    "shadowPort",
  ])) {
    runtimePortManifestRefused();
  }
  const ports = [
    value.apiPort,
    value.dbPort,
    value.shadowPort,
    value.poolerPort,
  ];
  const expectedDbUrl =
    `postgresql://postgres:postgres@${LOOPBACK_HOST}:${value.dbPort}/postgres`;
  if (
    value.host !== LOOPBACK_HOST
    || ports.some((port) =>
      !Number.isInteger(port)
      || port < MIN_DYNAMIC_PORT
      || port > MAX_DYNAMIC_PORT
    )
    || new Set(ports).size !== ports.length
    || value.dbUrl !== expectedDbUrl
  ) {
    runtimePortManifestRefused();
  }
  return value;
}

async function allocateFreeLoopbackPort(host = LOOPBACK_HOST) {
  if (host !== LOOPBACK_HOST) runtimePortManifestRefused();
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    let settled = false;
    const rejectAllocation = (cause) => {
      if (settled) return;
      settled = true;
      rejectPromise(
        new Error(
          `registration_observation_local_db_port_allocation_failed:${
            cause?.code ?? cause?.message ?? "socket_error"
          }`,
        ),
      );
    };
    server.unref();
    server.once("error", rejectAllocation);
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
              `registration_observation_local_db_port_allocation_failed:${
                error?.code ?? (Number.isInteger(port) ? port : "invalid_port")
              }`,
            ),
          );
          return;
        }
        resolvePromise(port);
      });
    });
  });
}

function portLeaseFailure(code, detail = "") {
  const error = new Error(`${code}${detail ? `:${detail}` : ""}`);
  error.code = code;
  return error;
}

function portLeaseRootIsOwned(leaseRoot) {
  if (typeof leaseRoot !== "string") return false;
  const resolved = path.resolve(leaseRoot);
  return path.dirname(resolved) === path.resolve(os.tmpdir())
    && path.basename(resolved).startsWith(PORT_LEASE_ROOT_PREFIX);
}

async function assertPortLeaseRoot(leaseRoot) {
  if (!portLeaseRootIsOwned(leaseRoot)) {
    throw portLeaseFailure(
      "registration_observation_local_db_port_lease_root_refused",
    );
  }
  await mkdir(leaseRoot, { recursive: true, mode: 0o700 });
  const metadata = await lstat(leaseRoot);
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o077) !== 0
  ) {
    throw portLeaseFailure(
      "registration_observation_local_db_port_lease_root_refused",
    );
  }
}

function portLeaseOwnerIsValid(owner, port) {
  return hasExactKeys(owner, [
    "createdAtMs",
    "pid",
    "port",
    "projectId",
    "version",
  ])
    && owner.version === 1
    && PROJECT_ID_PATTERN.test(owner.projectId)
    && Number.isInteger(owner.pid)
    && owner.pid > 0
    && owner.port === port
    && Number.isFinite(owner.createdAtMs)
    && owner.createdAtMs > 0;
}

async function acquirePortLeaseDefault({
  port,
  projectId,
  leaseRoot,
  now = Date.now,
}) {
  if (
    !Number.isInteger(port)
    || port < MIN_DYNAMIC_PORT
    || port > MAX_DYNAMIC_PORT
    || !PROJECT_ID_PATTERN.test(projectId)
    || typeof now !== "function"
  ) {
    throw portLeaseFailure(
      "registration_observation_local_db_port_lease_refused",
    );
  }
  await assertPortLeaseRoot(leaseRoot);
  const leasePath = path.join(leaseRoot, `${port}.lease`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await open(leasePath, "wx", 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw portLeaseFailure(
          "registration_observation_local_db_port_lease_unavailable",
          String(port),
        );
      }
      throw error;
    }

    try {
      const owner = {
        version: 1,
        projectId,
        pid: process.pid,
        port,
        createdAtMs: now(),
      };
      if (!portLeaseOwnerIsValid(owner, port)) {
        throw portLeaseFailure(
          "registration_observation_local_db_port_lease_refused",
        );
      }
      await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      return Object.freeze({
        leasePath,
        port,
        projectId,
        pid: process.pid,
      });
    } catch (error) {
      try {
        await handle.close();
      } catch {
        // The rollback below owns the observable cleanup result.
      }
      try {
        await unlink(leasePath);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") {
          error.cleanupError = unlinkError;
          error.portLeaseCleanupClaim = Object.freeze({
            leasePath,
            partialOwner: true,
            port,
            projectId,
            pid: process.pid,
          });
        }
      }
      throw error;
    }
  }
  throw portLeaseFailure(
    "registration_observation_local_db_port_lease_unavailable",
    String(port),
  );
}

async function releasePortLeaseDefault(claim) {
  if (claim.partialOwner === true) {
    try {
      await unlink(claim.leasePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return;
  }
  const ownerText = await readFile(claim.leasePath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (ownerText === null) return;
  let owner;
  try {
    owner = JSON.parse(ownerText);
  } catch {
    throw portLeaseFailure(
      "registration_observation_local_db_port_lease_ownership_refused",
    );
  }
  if (
    !portLeaseOwnerIsValid(owner, claim.port)
    || owner.projectId !== claim.projectId
    || owner.pid !== claim.pid
  ) {
    throw portLeaseFailure(
      "registration_observation_local_db_port_lease_ownership_refused",
    );
  }
  try {
    await unlink(claim.leasePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function releasePortLeaseClaims(claims, releasePortLease) {
  const failedClaims = [];
  const errors = [];
  for (const claim of [...claims].reverse()) {
    try {
      await releasePortLease(claim);
    } catch (error) {
      failedClaims.unshift(claim);
      errors.push(error);
    }
  }
  return { failedClaims, errors };
}

async function failRuntimePortManifestAfterRollback({
  claims,
  primaryError,
  releasePortLease,
}) {
  const { failedClaims, errors } = await releasePortLeaseClaims(
    claims,
    releasePortLease,
  );
  const error = new Error(
    `registration_observation_local_db_runtime_port_manifest_refused:${
      primaryError?.message ?? "allocation_attempts_exhausted"
    }`,
    { cause: primaryError },
  );
  error.exitCode = 2;
  if (failedClaims.length > 0) {
    error.portLeaseCleanup = { failedClaims, releasePortLease };
  }
  const rollbackErrors = [];
  for (const rollbackError of [primaryError?.cleanupError, ...errors]) {
    if (rollbackError && !rollbackErrors.includes(rollbackError)) {
      rollbackErrors.push(rollbackError);
    }
  }
  if (rollbackErrors.length > 0) {
    error.portLeaseRollbackErrors = rollbackErrors;
  }
  throw error;
}

export async function buildRegistrationObservationRuntimePortManifest({
  allocateLoopbackPort = allocateFreeLoopbackPort,
  acquirePortLease = acquirePortLeaseDefault,
  host = LOOPBACK_HOST,
  leaseRoot = PORT_LEASE_ROOT,
  now = Date.now,
  projectId,
  releasePortLease = releasePortLeaseDefault,
} = {}) {
  if (
    host !== LOOPBACK_HOST
    || !PROJECT_ID_PATTERN.test(projectId)
    || typeof allocateLoopbackPort !== "function"
    || typeof acquirePortLease !== "function"
    || typeof releasePortLease !== "function"
    || !portLeaseRootIsOwned(leaseRoot)
  ) {
    runtimePortManifestRefused();
  }
  const ports = [];
  const claims = [];
  let attempts = 0;
  let lastAllocationError;
  while (ports.length < 4 && attempts < PORT_ALLOCATION_ATTEMPTS) {
    attempts += 1;
    let port;
    try {
      port = await allocateLoopbackPort(host);
    } catch (error) {
      lastAllocationError = error;
      continue;
    }
    if (
      !Number.isInteger(port)
      || port < MIN_DYNAMIC_PORT
      || port > MAX_DYNAMIC_PORT
    ) {
      await failRuntimePortManifestAfterRollback({
        claims,
        primaryError: portLeaseFailure(
          "registration_observation_local_db_port_allocation_invalid",
          String(port),
        ),
        releasePortLease,
      });
    }
    if (ports.includes(port)) continue;
    let claim;
    try {
      claim = await acquirePortLease({
        port,
        projectId,
        leaseRoot,
        now,
      });
    } catch (error) {
      if (
        error?.code
        === "registration_observation_local_db_port_lease_unavailable"
      ) {
        continue;
      }
      if (error?.portLeaseCleanupClaim) {
        claims.push(error.portLeaseCleanupClaim);
      }
      await failRuntimePortManifestAfterRollback({
        claims,
        primaryError: error,
        releasePortLease,
      });
    }
    ports.push(port);
    claims.push(claim);
  }
  if (ports.length !== 4) {
    await failRuntimePortManifestAfterRollback({
      claims,
      primaryError: lastAllocationError
        ?? portLeaseFailure(
          "registration_observation_local_db_port_allocation_attempts_exhausted",
        ),
      releasePortLease,
    });
  }
  const [apiPort, dbPort, shadowPort, poolerPort] = ports;
  const manifest = Object.freeze({
    host,
    apiPort,
    dbPort,
    shadowPort,
    poolerPort,
    dbUrl:
      `postgresql://postgres:postgres@${host}:${dbPort}/postgres`,
  });
  assertRegistrationObservationRuntimePortManifest(manifest);
  RUNTIME_PORT_LEASES.set(manifest, { claims, releasePortLease });
  return manifest;
}

export async function releaseRegistrationObservationRuntimePortLeases(
  runtimePortManifest,
) {
  assertRegistrationObservationRuntimePortManifest(runtimePortManifest);
  const held = RUNTIME_PORT_LEASES.get(runtimePortManifest);
  if (!held) return;
  const { failedClaims, errors } = await releasePortLeaseClaims(
    held.claims,
    held.releasePortLease,
  );
  if (failedClaims.length === 0) {
    RUNTIME_PORT_LEASES.delete(runtimePortManifest);
  } else {
    RUNTIME_PORT_LEASES.set(runtimePortManifest, {
      ...held,
      claims: failedClaims,
    });
  }
  if (errors.length > 0) {
    throw portLeaseFailure(
      "registration_observation_local_db_port_lease_release_failed",
      errors.map((error) => error?.message ?? String(error)).join("|"),
    );
  }
}

export function listRegistrationObservationFocusNames() {
  return [...FOCUS_REGISTRY.keys()];
}

function resolveRegistrationObservationProviderOutboxManifest(focus) {
  const contract = FOCUS_REGISTRY.get(focus);
  if (!contract) {
    fail("registration_observation_local_db_unknown_focus", focus, 2);
  }
  const focusRank = PROVIDER_OUTBOX_STAGE_RANK.get(
    contract.providerOutboxStage,
  );
  return PROVIDER_OUTBOX_MANIFEST.map((entry) => ({
    ...entry,
    expected: entry.requiredStage
      && focusRank < PROVIDER_OUTBOX_STAGE_RANK.get(entry.requiredStage)
      ? "absent"
      : "present",
  }));
}

export function getRegistrationObservationProviderOutboxManifest(focus) {
  return Object.freeze(
    resolveRegistrationObservationProviderOutboxManifest(focus).map(
      ({ key, relation, expected }) => Object.freeze({
        key,
        relation,
        expected,
      }),
    ),
  );
}

function sqlStringLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function providerOutboxMetricSql(entry) {
  return `(select pg_catalog.count(*) from ${entry.relation}${
    entry.where ? ` where ${entry.where}` : ""
  })`;
}

export function registrationObservationProviderOutboxBaselineSetupSql(focus) {
  const manifest = resolveRegistrationObservationProviderOutboxManifest(focus);
  const presenceChecks = manifest.map((entry) => {
    const relation = sqlStringLiteral(entry.relation);
    if (entry.expected === "absent") {
      return [
        `  if pg_catalog.to_regclass(${relation}) is not null then`,
        `    raise exception ${sqlStringLiteral(
          `registration_observation_provider_outbox_relation_unexpected:${entry.key}`,
        )};`,
        "  end if;",
      ].join("\n");
    }
    return [
      `  if pg_catalog.to_regclass(${relation}) is null then`,
      `    raise exception ${sqlStringLiteral(
        `registration_observation_provider_outbox_relation_missing:${entry.key}`,
      )};`,
      "  end if;",
    ].join("\n");
  });
  const baselineInserts = manifest
    .filter((entry) => entry.expected === "present")
    .map((entry) => [
      `insert into ${PROVIDER_OUTBOX_BASELINE_TABLE}(`,
      "  manifest_key, relation_name, baseline_count",
      ") values (",
      `  ${sqlStringLiteral(entry.key)},`,
      `  ${sqlStringLiteral(entry.relation)},`,
      `  ${providerOutboxMetricSql(entry)}`,
      ");",
    ].join("\n"));

  return [
    "begin;",
    `create table ${PROVIDER_OUTBOX_BASELINE_TABLE} (`,
    "  manifest_key text primary key,",
    "  relation_name text not null,",
    "  baseline_count bigint not null check (baseline_count >= 0)",
    ");",
    "do $$",
    "begin",
    ...presenceChecks,
    "end",
    "$$;",
    ...baselineInserts,
    "commit;",
  ].join("\n");
}

function registrationObservationBookingFixtureSetupLines() {
  return [
    "insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)",
    "values",
    "  ('99000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'booking-runner-admin@example.invalid', crypt('booking-runner-only', gen_salt('bf')), now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, '{}'::jsonb, now(), now()),",
    "  ('99000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'booking-runner-director@example.invalid', crypt('booking-runner-only', gen_salt('bf')), now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, '{}'::jsonb, now(), now());",
    "insert into public.profiles(id, role, name, email, created_at, updated_at)",
    "values",
    "  ('99000000-0000-4000-8000-000000000001', 'admin', '청강 runner 관리자', 'booking-runner-admin@example.invalid', now(), now()),",
    "  ('99000000-0000-4000-8000-000000000003', 'teacher', '청강 runner 원장', 'booking-runner-director@example.invalid', now(), now())",
    "on conflict (id) do update set role = excluded.role, name = excluded.name, email = excluded.email, updated_at = excluded.updated_at;",
    "delete from public.teacher_catalogs where profile_id = '99000000-0000-4000-8000-000000000003';",
    "insert into public.teacher_catalogs(id, name, subjects, is_visible, sort_order, profile_id, account_email, dashboard_role)",
    "values ('99000000-0000-4000-8000-000000000101', '청강 runner 원장', array['영어']::text[], true, 9991, '99000000-0000-4000-8000-000000000003', 'booking-runner-director@example.invalid', 'teacher');",
    "update public.profiles set teacher_catalog_id = '99000000-0000-4000-8000-000000000101' where id = '99000000-0000-4000-8000-000000000003';",
    "insert into public.classroom_catalogs(id, name, subjects, is_visible, sort_order, campus)",
    "values ('99000000-0000-4000-8000-000000000102', '청강 runner 101호', array['영어']::text[], true, 9992, '본관');",
    "insert into public.classes(id, name, subject, status, schedule_storage_mode, schedule_plan)",
    "values ('99000000-0000-4000-8000-000000000103', '청강 runner 영어반', '영어', '수업 진행 중', 'normalized', '{\"sessions\":[]}'::jsonb);",
    "do $$",
    "begin",
    "  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(",
    "    '99000000-0000-4000-8000-000000000103',",
    "    '99000000-0000-4000-8000-000000000111',",
    "    'registration_observation_booking_runner'",
    "  );",
    "end",
    "$$;",
    "insert into public.class_lesson_sessions(id, class_id, session_key, session_date, schedule_state, start_time, end_time, teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id, classroom_name_snapshot, origin, revision)",
    "values",
    "  ('99000000-0000-4000-8000-000000000104', '99000000-0000-4000-8000-000000000103', 'runner-booking-session-a', current_date + 7, 'active', '18:00', '20:00', '99000000-0000-4000-8000-000000000101', '청강 runner 원장', '99000000-0000-4000-8000-000000000102', '청강 runner 101호', 'manual', 1),",
    "  ('99000000-0000-4000-8000-000000000114', '99000000-0000-4000-8000-000000000103', 'runner-booking-session-b', current_date + 14, 'active', '19:00', '21:00', '99000000-0000-4000-8000-000000000101', '청강 runner 원장', '99000000-0000-4000-8000-000000000102', '청강 runner 101호', 'manual', 2);",
    "insert into public.ops_tasks(id, title, type, status, priority, requested_by, student_name)",
    "values",
    "  ('99000000-0000-4000-8000-000000000105', '청강 runner book withdraw', 'registration', 'requested', 'normal', '99000000-0000-4000-8000-000000000001', '합성 동시학생1'),",
    "  ('99000000-0000-4000-8000-000000000115', '청강 runner reschedule cancel', 'registration', 'requested', 'normal', '99000000-0000-4000-8000-000000000001', '합성 동시학생2');",
    "insert into public.ops_registration_details(task_id)",
    "values ('99000000-0000-4000-8000-000000000105'), ('99000000-0000-4000-8000-000000000115');",
    "insert into public.ops_registration_subject_tracks(id, task_id, subject, pipeline_status, director_profile_id, director_assignment_source, director_assigned_at, migration_review_required, workflow_status, workflow_revision, workflow_status_entered_at, observation_return_workflow_status, observation_attempt_count)",
    "values",
    "  ('99000000-0000-4000-8000-000000000106', '99000000-0000-4000-8000-000000000105', '영어', 'consultation_waiting', '99000000-0000-4000-8000-000000000003', 'manual', now(), false, 'observation_requested', 1, now(), 'consultation_completed', 0),",
    "  ('99000000-0000-4000-8000-000000000116', '99000000-0000-4000-8000-000000000115', '영어', 'consultation_waiting', '99000000-0000-4000-8000-000000000003', 'manual', now(), false, 'observation_requested', 1, now(), 'consultation_completed', 1);",
    "insert into public.ops_registration_appointments(id, task_id, kind, scheduled_at, place, status, notification_revision, created_by)",
    "values ('99000000-0000-4000-8000-000000000117', '99000000-0000-4000-8000-000000000115', 'observation_class', ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'scheduled', 1, '99000000-0000-4000-8000-000000000001');",
    "insert into public.ops_registration_observations(id, task_id, track_id, appointment_id, class_id, session_authority, class_lesson_session_id, legacy_session_key, session_date, starts_at, ends_at, session_schedule_state, session_source_revision, legacy_session_source_hash, source_revision, booking_fact_hash, teacher_catalog_id, teacher_profile_id, classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot, classroom_name_snapshot, campus, status, feedback_revision, revision, created_by, updated_by)",
    "values ('99000000-0000-4000-8000-000000000118', '99000000-0000-4000-8000-000000000115', '99000000-0000-4000-8000-000000000116', '99000000-0000-4000-8000-000000000117', '99000000-0000-4000-8000-000000000103', 'normalized', '99000000-0000-4000-8000-000000000104', null, current_date + 7, ((current_date + 7 + time '18:00') at time zone 'Asia/Seoul'), ((current_date + 7 + time '20:00') at time zone 'Asia/Seoul'), 'active', 1, null, '{\"authority\":\"normalized\",\"sessionId\":\"99000000-0000-4000-8000-000000000104\",\"revision\":1}'::jsonb, repeat('d', 64), '99000000-0000-4000-8000-000000000101', '99000000-0000-4000-8000-000000000003', '99000000-0000-4000-8000-000000000102', '영어', '청강 runner 영어반', '청강 runner 원장', '청강 runner 101호', '본관', 'scheduled', 0, 1, '99000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001');",
    "update dashboard_private.registration_observation_runtime_settings",
    "set activation_version = 1, updated_at = now(), updated_by = '99000000-0000-4000-8000-000000000001'",
    "where singleton = true;",
  ];
}

function registrationObservationFeedbackFixtureSetupLines() {
  return [
    "insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)",
    "values",
    "  ('99200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-runner-admin@example.invalid', crypt('feedback-runner-only', gen_salt('bf')), now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, '{}'::jsonb, now(), now()),",
    "  ('99200000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-runner-teacher@example.invalid', crypt('feedback-runner-only', gen_salt('bf')), now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, '{}'::jsonb, now(), now()),",
    "  ('99200000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'feedback-runner-director@example.invalid', crypt('feedback-runner-only', gen_salt('bf')), now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, '{}'::jsonb, now(), now());",
    "insert into public.profiles(id, role, name, email, created_at, updated_at)",
    "values",
    "  ('99200000-0000-4000-8000-000000000001', 'admin', '청강 피드백 runner 관리자', 'feedback-runner-admin@example.invalid', now(), now()),",
    "  ('99200000-0000-4000-8000-000000000003', 'teacher', '청강 피드백 runner 담당', 'feedback-runner-teacher@example.invalid', now(), now()),",
    "  ('99200000-0000-4000-8000-000000000004', 'teacher', '청강 피드백 runner 원장', 'feedback-runner-director@example.invalid', now(), now())",
    "on conflict (id) do update set role = excluded.role, name = excluded.name, email = excluded.email, updated_at = excluded.updated_at;",
    "delete from public.teacher_catalogs where profile_id = '99200000-0000-4000-8000-000000000003';",
    "insert into public.teacher_catalogs(id, name, subjects, is_visible, sort_order, profile_id, account_email, dashboard_role)",
    "values ('99200000-0000-4000-8000-000000000101', '청강 피드백 runner 담당', array['영어']::text[], true, 9993, '99200000-0000-4000-8000-000000000003', 'feedback-runner-teacher@example.invalid', 'teacher');",
    "update public.profiles set teacher_catalog_id = '99200000-0000-4000-8000-000000000101' where id = '99200000-0000-4000-8000-000000000003';",
    "insert into public.classroom_catalogs(id, name, subjects, is_visible, sort_order, campus)",
    "values ('99200000-0000-4000-8000-000000000102', '청강 피드백 runner 101호', array['영어']::text[], true, 9994, '본관');",
    "insert into public.classes(id, name, subject, status, schedule_storage_mode, schedule_plan)",
    "values ('99200000-0000-4000-8000-000000000103', '청강 피드백 runner 영어반', '영어', '수업 진행 중', 'normalized', '{\"sessions\":[]}'::jsonb);",
    "do $$",
    "begin",
    "  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(",
    "    '99200000-0000-4000-8000-000000000103',",
    "    '99200000-0000-4000-8000-000000000111',",
    "    'registration_observation_feedback_runner'",
    "  );",
    "end",
    "$$;",
    "insert into public.class_lesson_sessions(id, class_id, session_key, session_date, schedule_state, start_time, end_time, teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id, classroom_name_snapshot, origin, revision)",
    "values ('99200000-0000-4000-8000-000000000104', '99200000-0000-4000-8000-000000000103', 'runner-feedback-session-a', current_date - 1, 'active', '18:00', '20:00', '99200000-0000-4000-8000-000000000101', '청강 피드백 runner 담당', '99200000-0000-4000-8000-000000000102', '청강 피드백 runner 101호', 'manual', 7);",
    "insert into public.ops_tasks(id, title, type, status, priority, requested_by, student_name)",
    "values ('99200000-0000-4000-8000-000000000105', '청강 피드백 runner concurrency', 'registration', 'requested', 'normal', '99200000-0000-4000-8000-000000000001', '합성 피드백 동시학생');",
    "insert into public.ops_registration_details(task_id)",
    "values ('99200000-0000-4000-8000-000000000105');",
    "insert into public.ops_registration_subject_tracks(id, task_id, subject, pipeline_status, director_profile_id, director_assignment_source, director_assigned_at, migration_review_required, workflow_status, workflow_revision, workflow_status_entered_at, observation_return_workflow_status, observation_attempt_count)",
    "values ('99200000-0000-4000-8000-000000000106', '99200000-0000-4000-8000-000000000105', '영어', 'consultation_waiting', '99200000-0000-4000-8000-000000000004', 'manual', now(), false, 'observation_requested', 1, now(), 'consultation_completed', 1);",
    "insert into public.ops_registration_appointments(id, task_id, kind, scheduled_at, place, status, notification_revision, created_by)",
    "values ('99200000-0000-4000-8000-000000000107', '99200000-0000-4000-8000-000000000105', 'observation_class', ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'scheduled', 3, '99200000-0000-4000-8000-000000000001');",
    "insert into public.ops_registration_observations(id, task_id, track_id, appointment_id, class_id, session_authority, class_lesson_session_id, legacy_session_key, session_date, starts_at, ends_at, session_schedule_state, session_source_revision, legacy_session_source_hash, source_revision, booking_fact_hash, teacher_catalog_id, teacher_profile_id, classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot, classroom_name_snapshot, campus, status, feedback_revision, revision, created_by, updated_by)",
    "values ('99200000-0000-4000-8000-000000000108', '99200000-0000-4000-8000-000000000105', '99200000-0000-4000-8000-000000000106', '99200000-0000-4000-8000-000000000107', '99200000-0000-4000-8000-000000000103', 'normalized', '99200000-0000-4000-8000-000000000104', null, current_date - 1, ((current_date - 1 + time '18:00') at time zone 'Asia/Seoul'), ((current_date - 1 + time '20:00') at time zone 'Asia/Seoul'), 'active', 7, null, '{\"authority\":\"normalized\",\"sessionId\":\"99200000-0000-4000-8000-000000000104\",\"revision\":7}'::jsonb, repeat('f', 64), '99200000-0000-4000-8000-000000000101', '99200000-0000-4000-8000-000000000003', '99200000-0000-4000-8000-000000000102', '영어', '청강 피드백 runner 영어반', '청강 피드백 runner 담당', '청강 피드백 runner 101호', '본관', 'scheduled', 0, 1, '99200000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000001');",
    "update dashboard_private.registration_observation_runtime_settings",
    "set activation_version = 1, updated_at = now(), updated_by = '99200000-0000-4000-8000-000000000001'",
    "where singleton = true;",
  ];
}

function registrationObservationEnrollmentFixtureSetupLines() {
  return [
    "insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)",
    "values",
    "  ('99300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'enrollment-runner-admin@example.invalid', crypt('enrollment-runner-only', gen_salt('bf')), now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, '{}'::jsonb, now(), now()),",
    "  ('99300000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'enrollment-runner-staff@example.invalid', crypt('enrollment-runner-only', gen_salt('bf')), now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, '{}'::jsonb, now(), now()),",
    "  ('99300000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'enrollment-runner-teacher@example.invalid', crypt('enrollment-runner-only', gen_salt('bf')), now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, '{}'::jsonb, now(), now()),",
    "  ('99300000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'enrollment-runner-unrelated@example.invalid', crypt('enrollment-runner-only', gen_salt('bf')), now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, '{}'::jsonb, now(), now()),",
    "  ('99300000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'enrollment-runner-director@example.invalid', crypt('enrollment-runner-only', gen_salt('bf')), now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, '{}'::jsonb, now(), now());",
    "insert into public.profiles(id, role, name, email, created_at, updated_at)",
    "values",
    "  ('99300000-0000-4000-8000-000000000001', 'admin', '청강 등록 runner 관리자', 'enrollment-runner-admin@example.invalid', now(), now()),",
    "  ('99300000-0000-4000-8000-000000000002', 'staff', '청강 등록 runner 직원', 'enrollment-runner-staff@example.invalid', now(), now()),",
    "  ('99300000-0000-4000-8000-000000000003', 'teacher', '청강 등록 runner 담당', 'enrollment-runner-teacher@example.invalid', now(), now()),",
    "  ('99300000-0000-4000-8000-000000000004', 'teacher', '청강 등록 runner 무관', 'enrollment-runner-unrelated@example.invalid', now(), now()),",
    "  ('99300000-0000-4000-8000-000000000005', 'teacher', '청강 등록 runner 원장', 'enrollment-runner-director@example.invalid', now(), now())",
    "on conflict (id) do update set role = excluded.role, name = excluded.name, email = excluded.email, updated_at = excluded.updated_at;",
    "delete from public.teacher_catalogs where profile_id in ('99300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000004');",
    "insert into public.teacher_catalogs(id, name, subjects, is_visible, sort_order, profile_id, account_email, dashboard_role)",
    "values",
    "  ('99300000-0000-4000-8000-000000000101', '청강 등록 runner 담당', array['영어']::text[], true, 9995, '99300000-0000-4000-8000-000000000003', 'enrollment-runner-teacher@example.invalid', 'teacher'),",
    "  ('99300000-0000-4000-8000-000000000111', '청강 등록 runner 무관', array['영어']::text[], true, 9996, '99300000-0000-4000-8000-000000000004', 'enrollment-runner-unrelated@example.invalid', 'teacher');",
    "update public.profiles set teacher_catalog_id = case id when '99300000-0000-4000-8000-000000000003' then '99300000-0000-4000-8000-000000000101'::uuid else '99300000-0000-4000-8000-000000000111'::uuid end where id in ('99300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000004');",
    "insert into public.classroom_catalogs(id, name, subjects, is_visible, sort_order, campus)",
    "values ('99300000-0000-4000-8000-000000000102', '청강 등록 runner 101호', array['영어']::text[], true, 9997, '본관');",
    "insert into public.classes(id, name, subject, status, schedule_storage_mode, schedule_plan)",
    "values",
    "  ('99300000-0000-4000-8000-000000000103', '청강 등록 historical 영어반', '영어', '수업 진행 중', 'normalized', '{\"sessions\":[]}'::jsonb),",
    "  ('99300000-0000-4000-8000-000000000113', '청강 등록 regular 영어반', '영어', '수업 진행 중', 'normalized', '{\"sessions\":[]}'::jsonb);",
    "do $$",
    "begin",
    "  perform dashboard_private.with_continuous_class_schedule_audit_context_v1('99300000-0000-4000-8000-000000000103', '99300000-0000-4000-8000-000000000191', 'registration_observation_enrollment_runner');",
    "  perform dashboard_private.with_continuous_class_schedule_audit_context_v1('99300000-0000-4000-8000-000000000113', '99300000-0000-4000-8000-000000000192', 'registration_observation_enrollment_runner');",
    "end",
    "$$;",
    "insert into public.class_lesson_sessions(id, class_id, session_key, session_date, schedule_state, start_time, end_time, teacher_catalog_id, teacher_name_snapshot, classroom_catalog_id, classroom_name_snapshot, origin, revision)",
    "values",
    "  ('99300000-0000-4000-8000-000000000104', '99300000-0000-4000-8000-000000000103', to_char(current_date - 2, 'YYYY-MM-DD') || ':7', current_date - 2, 'exception', '18:00', '20:00', '99300000-0000-4000-8000-000000000101', '청강 등록 runner 담당', '99300000-0000-4000-8000-000000000102', '청강 등록 runner 101호', 'manual', 7),",
    "  ('99300000-0000-4000-8000-000000000124', '99300000-0000-4000-8000-000000000103', to_char(current_date - 3, 'YYYY-MM-DD') || ':8', current_date - 3, 'exception', '17:00', '19:00', '99300000-0000-4000-8000-000000000101', '청강 등록 runner 담당', '99300000-0000-4000-8000-000000000102', '청강 등록 runner 101호', 'manual', 8),",
    "  ('99300000-0000-4000-8000-000000000114', '99300000-0000-4000-8000-000000000113', to_char(current_date + 7, 'YYYY-MM-DD') || ':1', current_date + 7, 'active', '19:00', '21:00', '99300000-0000-4000-8000-000000000101', '청강 등록 runner 담당', '99300000-0000-4000-8000-000000000102', '청강 등록 runner 101호', 'manual', 1);",
    "insert into public.ops_tasks(id, title, type, status, priority, requested_by, student_name)",
    "values ('99300000-0000-4000-8000-000000000105', '청강 등록 source/concurrency', 'registration', 'requested', 'normal', '99300000-0000-4000-8000-000000000001', '합성 등록학생');",
    "insert into public.ops_registration_details(task_id)",
    "values ('99300000-0000-4000-8000-000000000105');",
    "insert into public.ops_registration_subject_tracks(id, task_id, subject, pipeline_status, director_profile_id, director_assignment_source, director_assigned_at, migration_review_required, workflow_status, workflow_revision, workflow_status_entered_at, observation_return_workflow_status, observation_attempt_count)",
    "values ('99300000-0000-4000-8000-000000000106', '99300000-0000-4000-8000-000000000105', '영어', 'consultation_waiting', '99300000-0000-4000-8000-000000000005', 'manual', now(), false, 'consultation_completed', 3, now(), null, 1);",
    "insert into public.ops_tasks(id, title, type, status, priority, requested_by, student_name)",
    "values ('99300000-0000-4000-8000-000000000280', '청강 등록 stale-audit concurrency', 'registration', 'requested', 'normal', '99300000-0000-4000-8000-000000000001', '합성 stale-audit 학생');",
    "insert into public.ops_registration_details(task_id)",
    "values ('99300000-0000-4000-8000-000000000280');",
    "insert into public.ops_registration_subject_tracks(id, task_id, subject, pipeline_status, director_profile_id, director_assignment_source, director_assigned_at, migration_review_required, workflow_status, workflow_revision, workflow_status_entered_at, observation_return_workflow_status, observation_attempt_count)",
    "values ('99300000-0000-4000-8000-000000000281', '99300000-0000-4000-8000-000000000280', '영어', 'consultation_waiting', '99300000-0000-4000-8000-000000000005', 'manual', now(), false, 'consultation_completed', 1, now(), null, 0);",
    "insert into public.ops_registration_appointments(id, task_id, kind, scheduled_at, place, status, notification_revision, created_by)",
    "values",
    "  ('99300000-0000-4000-8000-000000000107', '99300000-0000-4000-8000-000000000105', 'observation_class', ((current_date - 2 + time '18:00') at time zone 'Asia/Seoul'), '본관', 'completed', 4, '99300000-0000-4000-8000-000000000001'),",
    "  ('99300000-0000-4000-8000-000000000117', '99300000-0000-4000-8000-000000000105', 'observation_class', ((current_date - 3 + time '17:00') at time zone 'Asia/Seoul'), '본관', 'completed', 5, '99300000-0000-4000-8000-000000000001');",
    "insert into public.ops_registration_observations(id, task_id, track_id, appointment_id, class_id, session_authority, class_lesson_session_id, legacy_session_key, session_date, starts_at, ends_at, session_schedule_state, session_source_revision, legacy_session_source_hash, source_revision, booking_fact_hash, teacher_catalog_id, teacher_profile_id, classroom_catalog_id, subject, class_name_snapshot, teacher_name_snapshot, classroom_name_snapshot, campus, status, attendance, attendance_recorded_by, attendance_recorded_at, suitability_result, feedback_reason, feedback_submitted_by, feedback_submitted_at, feedback_revision, decision_kind, decided_by, decided_at, revision, created_by, updated_by)",
    "values",
    "  ('99300000-0000-4000-8000-000000000108', '99300000-0000-4000-8000-000000000105', '99300000-0000-4000-8000-000000000106', '99300000-0000-4000-8000-000000000107', '99300000-0000-4000-8000-000000000103', 'normalized', '99300000-0000-4000-8000-000000000104', null, current_date - 2, ((current_date - 2 + time '18:00') at time zone 'Asia/Seoul'), ((current_date - 2 + time '20:00') at time zone 'Asia/Seoul'), 'exception', 7, null, '{\"authority\":\"normalized\",\"sessionId\":\"99300000-0000-4000-8000-000000000104\",\"revision\":7}'::jsonb, repeat('e', 64), '99300000-0000-4000-8000-000000000101', '99300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000102', '영어', '청강 등록 historical 영어반', '청강 등록 runner 담당', '청강 등록 runner 101호', '본관', 'completed', 'attended', '99300000-0000-4000-8000-000000000003', now() - interval '2 days', 'fit', '등록 적합 A', '99300000-0000-4000-8000-000000000003', now() - interval '2 days', 1, 'enrollment', '99300000-0000-4000-8000-000000000005', now() - interval '1 day', 3, '99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001'),",
    "  ('99300000-0000-4000-8000-000000000118', '99300000-0000-4000-8000-000000000105', '99300000-0000-4000-8000-000000000106', '99300000-0000-4000-8000-000000000117', '99300000-0000-4000-8000-000000000103', 'normalized', '99300000-0000-4000-8000-000000000124', null, current_date - 3, ((current_date - 3 + time '17:00') at time zone 'Asia/Seoul'), ((current_date - 3 + time '19:00') at time zone 'Asia/Seoul'), 'exception', 8, null, '{\"authority\":\"normalized\",\"sessionId\":\"99300000-0000-4000-8000-000000000124\",\"revision\":8}'::jsonb, repeat('b', 64), '99300000-0000-4000-8000-000000000101', '99300000-0000-4000-8000-000000000003', '99300000-0000-4000-8000-000000000102', '영어', '청강 등록 historical 영어반', '청강 등록 runner 담당', '청강 등록 runner 101호', '본관', 'completed', 'attended', '99300000-0000-4000-8000-000000000003', now() - interval '3 days', 'fit', '등록 적합 B', '99300000-0000-4000-8000-000000000003', now() - interval '3 days', 1, 'enrollment', '99300000-0000-4000-8000-000000000005', now() - interval '1 day', 4, '99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001');",
    "update dashboard_private.registration_observation_runtime_settings",
    "set activation_version = 0, updated_at = now(), updated_by = null",
    "where singleton = true;",
  ];
}

export function registrationObservationFocusSetupSql(focus) {
  const baseline = registrationObservationProviderOutboxBaselineSetupSql(focus);
  if (![
    "booking",
    "feedback-submit",
    "feedback",
    "enrollment",
  ].includes(focus)) return baseline;
  const lines = baseline.split("\n");
  if (lines.at(-1) !== "commit;") {
    throw new Error("registration_observation_local_db_setup_manifest_invalid");
  }
  const fixtureLines = focus === "booking"
    ? registrationObservationBookingFixtureSetupLines()
    : focus === "enrollment"
      ? registrationObservationEnrollmentFixtureSetupLines()
      : registrationObservationFeedbackFixtureSetupLines();
  return [
    ...lines.slice(0, 1),
    "create extension if not exists dblink;",
    ...lines.slice(1, -1),
    ...fixtureLines,
    "commit;",
  ].join("\n");
}

export function registrationObservationFocusCleanupSql(focus) {
  if (focus === "enrollment") {
    return [
      "begin;",
      "set local lock_timeout = '5s';",
      "set local statement_timeout = '60s';",
      "lock table dashboard_private.registration_observation_runtime_settings",
      "  in row exclusive mode;",
      "do $registration_observation_runtime_deactivate_v1$",
      "declare",
      "  v_current integer;",
      "begin",
      "  select activation_version",
      "  into v_current",
      "  from dashboard_private.registration_observation_runtime_settings",
      "  where singleton = true",
      "  for update;",
      "  if not found or v_current not in (0, 1) then",
      "    raise exception 'registration_observation_runtime_state_invalid'",
      "      using errcode = '55000';",
      "  end if;",
      "  if v_current = 1 then",
      "    update dashboard_private.registration_observation_runtime_settings",
      "    set activation_version = 0,",
      "        updated_at = pg_catalog.clock_timestamp(),",
      "        updated_by = null",
      "    where singleton = true",
      "      and activation_version = 1;",
      "  end if;",
      "end;",
      "$registration_observation_runtime_deactivate_v1$;",
      "delete from dashboard_private.notification_deliveries delivery using dashboard_private.notification_events event where delivery.event_id = event.id and event.payload ->> 'task_id' = '99300000-0000-4000-8000-000000000280';",
      "delete from dashboard_private.notification_event_fanout_jobs job using dashboard_private.notification_events event where job.event_id = event.id and event.payload ->> 'task_id' = '99300000-0000-4000-8000-000000000280';",
      "delete from dashboard_private.notification_events where payload ->> 'task_id' = '99300000-0000-4000-8000-000000000280';",
      "delete from public.ops_task_events where task_id = any(array['99300000-0000-4000-8000-000000000105'::uuid, '99300000-0000-4000-8000-000000000280'::uuid]);",
      "delete from dashboard_private.ops_registration_mutations where actor_id = '99300000-0000-4000-8000-000000000001' or task_id = any(array['99300000-0000-4000-8000-000000000105'::uuid, '99300000-0000-4000-8000-000000000280'::uuid]);",
      "delete from dashboard_private.registration_observation_mutation_requests where actor_profile_id = '99300000-0000-4000-8000-000000000001' or track_id = any(array['99300000-0000-4000-8000-000000000106'::uuid, '99300000-0000-4000-8000-000000000281'::uuid]);",
      "delete from dashboard_private.registration_observation_domain_events where observation_id = any(array['99300000-0000-4000-8000-000000000108'::uuid, '99300000-0000-4000-8000-000000000118'::uuid]);",
      "delete from public.ops_registration_enrollments where track_id = any(array['99300000-0000-4000-8000-000000000106'::uuid, '99300000-0000-4000-8000-000000000281'::uuid]);",
      "delete from public.ops_registration_observations where id = any(array['99300000-0000-4000-8000-000000000108'::uuid, '99300000-0000-4000-8000-000000000118'::uuid]);",
      "delete from public.ops_registration_appointments where id = any(array['99300000-0000-4000-8000-000000000107'::uuid, '99300000-0000-4000-8000-000000000117'::uuid]);",
      "delete from public.ops_registration_subject_tracks where id = any(array['99300000-0000-4000-8000-000000000106'::uuid, '99300000-0000-4000-8000-000000000281'::uuid]);",
      "delete from public.ops_tasks where id = any(array['99300000-0000-4000-8000-000000000105'::uuid, '99300000-0000-4000-8000-000000000280'::uuid]);",
      "do $$",
      "begin",
      "  perform dashboard_private.with_continuous_class_schedule_audit_context_v1('99300000-0000-4000-8000-000000000103', '99300000-0000-4000-8000-000000000191', 'registration_observation_enrollment_runner_cleanup');",
      "  perform dashboard_private.with_continuous_class_schedule_audit_context_v1('99300000-0000-4000-8000-000000000113', '99300000-0000-4000-8000-000000000192', 'registration_observation_enrollment_runner_cleanup');",
      "end",
      "$$;",
      "delete from public.class_lesson_sessions where id = any(array['99300000-0000-4000-8000-000000000104'::uuid, '99300000-0000-4000-8000-000000000114'::uuid, '99300000-0000-4000-8000-000000000124'::uuid]);",
      "delete from public.dashboard_audit_logs where class_id = any(array['99300000-0000-4000-8000-000000000103'::uuid, '99300000-0000-4000-8000-000000000113'::uuid]) or entity_id like '99300000-0000-4000-8000-%';",
      "alter table public.classes disable trigger dashboard_audit_classes;",
      "delete from public.classes where id = any(array['99300000-0000-4000-8000-000000000103'::uuid, '99300000-0000-4000-8000-000000000113'::uuid]);",
      "alter table public.classes enable trigger dashboard_audit_classes;",
      "select pg_catalog.set_config('app.class_schedule_mutation', '', true);",
      "select pg_catalog.set_config('app.class_schedule_class_id', '', true);",
      "select pg_catalog.set_config('app.class_schedule_request_key', '', true);",
      "select pg_catalog.set_config('app.class_schedule_request_operation', '', true);",
      "select pg_catalog.set_config('app.class_schedule_change_reason', '', true);",
      "update public.profiles set teacher_catalog_id = null where id = any(array['99300000-0000-4000-8000-000000000003'::uuid, '99300000-0000-4000-8000-000000000004'::uuid]);",
      "delete from public.teacher_catalogs where id = any(array['99300000-0000-4000-8000-000000000101'::uuid, '99300000-0000-4000-8000-000000000111'::uuid]);",
      "delete from public.classroom_catalogs where id = '99300000-0000-4000-8000-000000000102';",
      "delete from public.profiles where id = any(array['99300000-0000-4000-8000-000000000001'::uuid, '99300000-0000-4000-8000-000000000002'::uuid, '99300000-0000-4000-8000-000000000003'::uuid, '99300000-0000-4000-8000-000000000004'::uuid, '99300000-0000-4000-8000-000000000005'::uuid]);",
      "delete from auth.users where id = any(array['99300000-0000-4000-8000-000000000001'::uuid, '99300000-0000-4000-8000-000000000002'::uuid, '99300000-0000-4000-8000-000000000003'::uuid, '99300000-0000-4000-8000-000000000004'::uuid, '99300000-0000-4000-8000-000000000005'::uuid]);",
      "delete from public.dashboard_audit_logs where entity_id like '99300000-0000-4000-8000-%';",
      "commit;",
    ].join("\n");
  }
  if (["feedback-submit", "feedback"].includes(focus)) {
    return [
      "begin;",
      "delete from dashboard_private.registration_observation_domain_events where observation_id = '99200000-0000-4000-8000-000000000108';",
      "delete from dashboard_private.registration_observation_mutation_requests where track_id = '99200000-0000-4000-8000-000000000106';",
      "delete from public.ops_registration_observations where id = '99200000-0000-4000-8000-000000000108';",
      "delete from public.ops_registration_appointments where id = '99200000-0000-4000-8000-000000000107';",
      "delete from public.ops_registration_subject_tracks where id = '99200000-0000-4000-8000-000000000106';",
      "delete from public.ops_tasks where id = '99200000-0000-4000-8000-000000000105';",
      "do $$",
      "begin",
      "  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(",
      "    '99200000-0000-4000-8000-000000000103',",
      "    '99200000-0000-4000-8000-000000000111',",
      "    'registration_observation_feedback_runner_cleanup'",
      "  );",
      "end",
      "$$;",
      "delete from public.class_lesson_sessions where id = '99200000-0000-4000-8000-000000000104';",
      "delete from public.dashboard_audit_logs where class_id = '99200000-0000-4000-8000-000000000103' or entity_id = any(array['99200000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000003', '99200000-0000-4000-8000-000000000004', '99200000-0000-4000-8000-000000000101', '99200000-0000-4000-8000-000000000102', '99200000-0000-4000-8000-000000000103', '99200000-0000-4000-8000-000000000104']);",
      "alter table public.classes disable trigger dashboard_audit_classes;",
      "delete from public.classes where id = '99200000-0000-4000-8000-000000000103';",
      "alter table public.classes enable trigger dashboard_audit_classes;",
      "select pg_catalog.set_config('app.class_schedule_mutation', '', true);",
      "select pg_catalog.set_config('app.class_schedule_class_id', '', true);",
      "select pg_catalog.set_config('app.class_schedule_request_key', '', true);",
      "select pg_catalog.set_config('app.class_schedule_request_operation', '', true);",
      "select pg_catalog.set_config('app.class_schedule_change_reason', '', true);",
      "update public.profiles set teacher_catalog_id = null where id = '99200000-0000-4000-8000-000000000003';",
      "delete from public.teacher_catalogs where id = '99200000-0000-4000-8000-000000000101';",
      "delete from public.classroom_catalogs where id = '99200000-0000-4000-8000-000000000102';",
      "delete from public.profiles where id = any(array['99200000-0000-4000-8000-000000000001'::uuid, '99200000-0000-4000-8000-000000000003'::uuid, '99200000-0000-4000-8000-000000000004'::uuid]);",
      "delete from auth.users where id = any(array['99200000-0000-4000-8000-000000000001'::uuid, '99200000-0000-4000-8000-000000000003'::uuid, '99200000-0000-4000-8000-000000000004'::uuid]);",
      "delete from public.dashboard_audit_logs where entity_id = any(array['99200000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000003', '99200000-0000-4000-8000-000000000004', '99200000-0000-4000-8000-000000000101', '99200000-0000-4000-8000-000000000102', '99200000-0000-4000-8000-000000000103', '99200000-0000-4000-8000-000000000104']);",
      "update dashboard_private.registration_observation_runtime_settings set activation_version = 0, updated_at = now(), updated_by = null where singleton = true;",
      "commit;",
    ].join("\n");
  }
  if (focus !== "booking") return "begin; commit;";
  return [
    "begin;",
    "delete from dashboard_private.registration_observation_domain_events where observation_id = '99000000-0000-4000-8000-000000000118';",
    "delete from dashboard_private.registration_observation_mutation_requests where actor_profile_id = '99000000-0000-4000-8000-000000000001' and track_id = any(array['99000000-0000-4000-8000-000000000106'::uuid, '99000000-0000-4000-8000-000000000116'::uuid]);",
    "delete from public.ops_registration_observations where id = '99000000-0000-4000-8000-000000000118';",
    "delete from public.ops_registration_appointments where id = '99000000-0000-4000-8000-000000000117';",
    "delete from public.ops_registration_subject_tracks where id = any(array['99000000-0000-4000-8000-000000000106'::uuid, '99000000-0000-4000-8000-000000000116'::uuid]);",
    "delete from public.ops_tasks where id = any(array['99000000-0000-4000-8000-000000000105'::uuid, '99000000-0000-4000-8000-000000000115'::uuid]);",
    "do $$",
    "begin",
    "  perform dashboard_private.with_continuous_class_schedule_audit_context_v1(",
    "    '99000000-0000-4000-8000-000000000103',",
    "    '99000000-0000-4000-8000-000000000111',",
    "    'registration_observation_booking_runner_cleanup'",
    "  );",
    "end",
    "$$;",
    "delete from public.class_lesson_sessions where id = any(array['99000000-0000-4000-8000-000000000104'::uuid, '99000000-0000-4000-8000-000000000114'::uuid]);",
    "delete from public.dashboard_audit_logs where class_id = '99000000-0000-4000-8000-000000000103' or entity_id = any(array['99000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000003', '99000000-0000-4000-8000-000000000101', '99000000-0000-4000-8000-000000000102', '99000000-0000-4000-8000-000000000103', '99000000-0000-4000-8000-000000000104', '99000000-0000-4000-8000-000000000114']);",
    "alter table public.classes disable trigger dashboard_audit_classes;",
    "delete from public.classes where id = '99000000-0000-4000-8000-000000000103';",
    "alter table public.classes enable trigger dashboard_audit_classes;",
    "select pg_catalog.set_config('app.class_schedule_mutation', '', true);",
    "select pg_catalog.set_config('app.class_schedule_class_id', '', true);",
    "select pg_catalog.set_config('app.class_schedule_request_key', '', true);",
    "select pg_catalog.set_config('app.class_schedule_request_operation', '', true);",
    "select pg_catalog.set_config('app.class_schedule_change_reason', '', true);",
    "update public.profiles set teacher_catalog_id = null where id = '99000000-0000-4000-8000-000000000003';",
    "delete from public.teacher_catalogs where id = '99000000-0000-4000-8000-000000000101';",
    "delete from public.classroom_catalogs where id = '99000000-0000-4000-8000-000000000102';",
    "delete from public.profiles where id = any(array['99000000-0000-4000-8000-000000000001'::uuid, '99000000-0000-4000-8000-000000000003'::uuid]);",
    "delete from auth.users where id = any(array['99000000-0000-4000-8000-000000000001'::uuid, '99000000-0000-4000-8000-000000000003'::uuid]);",
    "delete from public.dashboard_audit_logs where entity_id = any(array['99000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000003', '99000000-0000-4000-8000-000000000101', '99000000-0000-4000-8000-000000000102', '99000000-0000-4000-8000-000000000103', '99000000-0000-4000-8000-000000000104', '99000000-0000-4000-8000-000000000114']);",
    "update dashboard_private.registration_observation_runtime_settings set activation_version = 0, updated_at = now(), updated_by = null where singleton = true;",
    "commit;",
  ].join("\n");
}

export function getRegistrationObservationFocusContract(focus) {
  const contract = FOCUS_REGISTRY.get(focus);
  if (!contract) {
    fail("registration_observation_local_db_unknown_focus", focus, 2);
  }
  return Object.freeze({
    ceiling: contract.ceiling,
    ...(typeof contract.fixture === "object"
      ? { fixture: Object.freeze({ ...contract.fixture }) }
      : {}),
    tests: Object.freeze([...contract.tests]),
  });
}

export function resolveRegistrationObservationSchemaFocusTerminal(
  migrationPaths,
) {
  const basenames = new Set(migrationPaths.map((entry) => path.basename(entry)));
  if (
    basenames.has("20260809101000_registration_observation_reads.sql")
  ) {
    return "20260809101000";
  }
  return "20260809100000";
}

function parseArgs(argv) {
  const options = {
    execute: false,
    approvedLocalDb: false,
    focus: "schema",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (FORBIDDEN_OPTIONS.has(argument)) {
      fail("registration_observation_local_db_forbidden_option", argument, 2);
    }
    if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--approved-local-db") {
      options.approvedLocalDb = true;
    } else if (argument === "--db-url") {
      fail(
        "registration_observation_local_db_custom_db_url_forbidden",
        "",
        2,
      );
    } else if (argument === "--focus") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        fail("registration_observation_local_db_invalid_option", argument, 2);
      }
      options.focus = value;
      index += 1;
    } else {
      fail("registration_observation_local_db_forbidden_option", argument, 2);
    }
  }
  if (!FOCUS_REGISTRY.has(options.focus)) {
    fail("registration_observation_local_db_unknown_focus", options.focus, 2);
  }
  return options;
}

export function assertRegistrationObservationSafeEnvironment(environment) {
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
    fail(
      "registration_observation_local_db_forbidden_environment",
      present.sort().join(","),
      2,
    );
  }
}

export function buildRegistrationObservationLocalEnvironment(
  environment = process.env,
) {
  const safe = {};
  for (const key of LOCAL_CHILD_ENVIRONMENT_KEYS) {
    if (typeof environment[key] === "string" && environment[key].length > 0) {
      safe[key] = environment[key];
    }
  }
  safe.SUPABASE_INTERNAL_IMAGE_REGISTRY = "";
  return safe;
}

export function registrationObservationLocalQaPrerequisiteSql() {
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

export function registrationObservationLocalQaHistoryFixtureSql() {
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

function exactResourceManifest(projectId) {
  return [
    { kind: "container", name: `supabase_db_${projectId}`, projectId },
    { kind: "network", name: `supabase_network_${projectId}`, projectId },
    { kind: "volume", name: `supabase_db_${projectId}`, projectId },
  ];
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

function registrationObservationProviderOutboxFreshAssertionLines(focus) {
  const manifest = resolveRegistrationObservationProviderOutboxManifest(focus);
  return manifest.flatMap((entry) => {
    const relation = sqlStringLiteral(entry.relation);
    if (entry.expected === "absent") {
      return [
        `  if pg_catalog.to_regclass(${relation}) is not null then`,
        `    raise exception ${sqlStringLiteral(
          `registration_observation_provider_outbox_relation_unexpected:${entry.key}`,
        )};`,
        "  end if;",
      ];
    }
    return [
      `  if pg_catalog.to_regclass(${relation}) is null then`,
      `    raise exception ${sqlStringLiteral(
        `registration_observation_provider_outbox_relation_missing:${entry.key}`,
      )};`,
      "  end if;",
      "  if (",
      `    select baseline.baseline_count from ${PROVIDER_OUTBOX_BASELINE_TABLE} baseline`,
      `    where baseline.manifest_key = ${sqlStringLiteral(entry.key)}`,
      `  ) is distinct from ${providerOutboxMetricSql(entry)} then`,
      `    raise exception ${sqlStringLiteral(
        `registration_observation_provider_outbox_delta_nonzero:${entry.key}`,
      )};`,
      "  end if;",
    ];
  });
}

function registrationObservationBookingFreshAssertionLines(focus) {
  if (focus !== "booking") return [];
  return [
    "  if exists (select 1 from auth.users where id = any(array['99000000-0000-4000-8000-000000000001'::uuid, '99000000-0000-4000-8000-000000000003'::uuid])) then",
    "    raise exception 'registration_observation_booking_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.profiles where id = any(array['99000000-0000-4000-8000-000000000001'::uuid, '99000000-0000-4000-8000-000000000003'::uuid])) then",
    "    raise exception 'registration_observation_booking_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.teacher_catalogs where id = '99000000-0000-4000-8000-000000000101'::uuid) then",
    "    raise exception 'registration_observation_booking_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.classroom_catalogs where id = '99000000-0000-4000-8000-000000000102'::uuid) then",
    "    raise exception 'registration_observation_booking_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.classes where id = '99000000-0000-4000-8000-000000000103'::uuid) then",
    "    raise exception 'registration_observation_booking_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.class_lesson_sessions where id = any(array['99000000-0000-4000-8000-000000000104'::uuid, '99000000-0000-4000-8000-000000000114'::uuid])) then",
    "    raise exception 'registration_observation_booking_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_tasks where id = any(array['99000000-0000-4000-8000-000000000105'::uuid, '99000000-0000-4000-8000-000000000115'::uuid])) then",
    "    raise exception 'registration_observation_booking_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_registration_subject_tracks where id = any(array['99000000-0000-4000-8000-000000000106'::uuid, '99000000-0000-4000-8000-000000000116'::uuid])) then",
    "    raise exception 'registration_observation_booking_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_registration_appointments where id = '99000000-0000-4000-8000-000000000117'::uuid) then",
    "    raise exception 'registration_observation_booking_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_registration_observations where id = '99000000-0000-4000-8000-000000000118'::uuid) then",
    "    raise exception 'registration_observation_booking_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from dashboard_private.registration_observation_mutation_requests where actor_profile_id = '99000000-0000-4000-8000-000000000001'::uuid and track_id = any(array['99000000-0000-4000-8000-000000000106'::uuid, '99000000-0000-4000-8000-000000000116'::uuid])) then",
    "    raise exception 'registration_observation_booking_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from dashboard_private.registration_observation_domain_events where observation_id = '99000000-0000-4000-8000-000000000118'::uuid) then",
    "    raise exception 'registration_observation_booking_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.dashboard_audit_logs where class_id = '99000000-0000-4000-8000-000000000103'::uuid or entity_id = any(array['99000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000003', '99000000-0000-4000-8000-000000000101', '99000000-0000-4000-8000-000000000102', '99000000-0000-4000-8000-000000000103', '99000000-0000-4000-8000-000000000104', '99000000-0000-4000-8000-000000000114'])) then",
    "    raise exception 'registration_observation_booking_fixture_remains';",
    "  end if;",
  ];
}

function registrationObservationFeedbackFreshAssertionLines(focus) {
  if (!["feedback-submit", "feedback"].includes(focus)) return [];
  return [
    "  if exists (select 1 from auth.users where id = any(array['99200000-0000-4000-8000-000000000001'::uuid, '99200000-0000-4000-8000-000000000003'::uuid, '99200000-0000-4000-8000-000000000004'::uuid])) then",
    "    raise exception 'registration_observation_feedback_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.profiles where id = any(array['99200000-0000-4000-8000-000000000001'::uuid, '99200000-0000-4000-8000-000000000003'::uuid, '99200000-0000-4000-8000-000000000004'::uuid])) then",
    "    raise exception 'registration_observation_feedback_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.teacher_catalogs where id = '99200000-0000-4000-8000-000000000101'::uuid) then",
    "    raise exception 'registration_observation_feedback_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.classroom_catalogs where id = '99200000-0000-4000-8000-000000000102'::uuid) then",
    "    raise exception 'registration_observation_feedback_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.classes where id = '99200000-0000-4000-8000-000000000103'::uuid) then",
    "    raise exception 'registration_observation_feedback_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.class_lesson_sessions where id = '99200000-0000-4000-8000-000000000104'::uuid) then",
    "    raise exception 'registration_observation_feedback_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_tasks where id = '99200000-0000-4000-8000-000000000105'::uuid) then",
    "    raise exception 'registration_observation_feedback_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_registration_subject_tracks where id = '99200000-0000-4000-8000-000000000106'::uuid) then",
    "    raise exception 'registration_observation_feedback_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_registration_appointments where id = '99200000-0000-4000-8000-000000000107'::uuid) then",
    "    raise exception 'registration_observation_feedback_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_registration_observations where id = '99200000-0000-4000-8000-000000000108'::uuid) then",
    "    raise exception 'registration_observation_feedback_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from dashboard_private.registration_observation_mutation_requests where track_id = '99200000-0000-4000-8000-000000000106'::uuid) then",
    "    raise exception 'registration_observation_feedback_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from dashboard_private.registration_observation_domain_events where observation_id = '99200000-0000-4000-8000-000000000108'::uuid) then",
    "    raise exception 'registration_observation_feedback_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.dashboard_audit_logs where class_id = '99200000-0000-4000-8000-000000000103'::uuid or entity_id = any(array['99200000-0000-4000-8000-000000000001', '99200000-0000-4000-8000-000000000003', '99200000-0000-4000-8000-000000000004', '99200000-0000-4000-8000-000000000101', '99200000-0000-4000-8000-000000000102', '99200000-0000-4000-8000-000000000103', '99200000-0000-4000-8000-000000000104'])) then",
    "    raise exception 'registration_observation_feedback_fixture_remains';",
    "  end if;",
  ];
}

function registrationObservationEnrollmentFreshAssertionLines(focus) {
  if (focus !== "enrollment") return [];
  return [
    "  if exists (select 1 from auth.users where id = any(array['99300000-0000-4000-8000-000000000001'::uuid, '99300000-0000-4000-8000-000000000002'::uuid, '99300000-0000-4000-8000-000000000003'::uuid, '99300000-0000-4000-8000-000000000004'::uuid, '99300000-0000-4000-8000-000000000005'::uuid])) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.profiles where id = any(array['99300000-0000-4000-8000-000000000001'::uuid, '99300000-0000-4000-8000-000000000002'::uuid, '99300000-0000-4000-8000-000000000003'::uuid, '99300000-0000-4000-8000-000000000004'::uuid, '99300000-0000-4000-8000-000000000005'::uuid])) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.teacher_catalogs where id = any(array['99300000-0000-4000-8000-000000000101'::uuid, '99300000-0000-4000-8000-000000000111'::uuid])) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.classroom_catalogs where id = '99300000-0000-4000-8000-000000000102'::uuid) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.classes where id = any(array['99300000-0000-4000-8000-000000000103'::uuid, '99300000-0000-4000-8000-000000000113'::uuid])) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.class_lesson_sessions where id = any(array['99300000-0000-4000-8000-000000000104'::uuid, '99300000-0000-4000-8000-000000000114'::uuid, '99300000-0000-4000-8000-000000000124'::uuid])) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_tasks where id = any(array['99300000-0000-4000-8000-000000000105'::uuid, '99300000-0000-4000-8000-000000000280'::uuid])) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_registration_subject_tracks where id = any(array['99300000-0000-4000-8000-000000000106'::uuid, '99300000-0000-4000-8000-000000000281'::uuid])) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_registration_appointments where id = any(array['99300000-0000-4000-8000-000000000107'::uuid, '99300000-0000-4000-8000-000000000117'::uuid])) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_registration_observations where id = any(array['99300000-0000-4000-8000-000000000108'::uuid, '99300000-0000-4000-8000-000000000118'::uuid])) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_registration_enrollments where track_id = any(array['99300000-0000-4000-8000-000000000106'::uuid, '99300000-0000-4000-8000-000000000281'::uuid])) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from dashboard_private.ops_registration_mutations where actor_id = '99300000-0000-4000-8000-000000000001'::uuid or task_id = any(array['99300000-0000-4000-8000-000000000105'::uuid, '99300000-0000-4000-8000-000000000280'::uuid])) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from dashboard_private.registration_observation_mutation_requests where actor_profile_id = '99300000-0000-4000-8000-000000000001'::uuid or track_id = any(array['99300000-0000-4000-8000-000000000106'::uuid, '99300000-0000-4000-8000-000000000281'::uuid])) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from dashboard_private.registration_observation_domain_events where observation_id = any(array['99300000-0000-4000-8000-000000000108'::uuid, '99300000-0000-4000-8000-000000000118'::uuid])) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_task_events where task_id = any(array['99300000-0000-4000-8000-000000000105'::uuid, '99300000-0000-4000-8000-000000000280'::uuid])) then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from dashboard_private.notification_events where payload ->> 'task_id' = '99300000-0000-4000-8000-000000000280') then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
    "  if exists (select 1 from public.dashboard_audit_logs where class_id = any(array['99300000-0000-4000-8000-000000000103'::uuid, '99300000-0000-4000-8000-000000000113'::uuid]) or entity_id like '99300000-0000-4000-8000-%') then",
    "    raise exception 'registration_observation_enrollment_fixture_remains';",
    "  end if;",
  ];
}

export function registrationObservationSchemaFreshAssertionSql(
  focus = "schema",
) {
  const providerAssertions =
    registrationObservationProviderOutboxFreshAssertionLines(focus);
  const bookingAssertions =
    registrationObservationBookingFreshAssertionLines(focus);
  const feedbackAssertions =
    registrationObservationFeedbackFreshAssertionLines(focus);
  const enrollmentAssertions =
    registrationObservationEnrollmentFreshAssertionLines(focus);
  return [
    "begin;",
    "do $$",
    "begin",
    "  if (select activation_version from dashboard_private.registration_observation_runtime_settings where singleton = true) is distinct from 0 then",
    "    raise exception 'registration_observation_runtime_not_zero';",
    "  end if;",
    "  if (select updated_by from dashboard_private.registration_observation_runtime_settings where singleton = true) is not null then",
    "    raise exception 'registration_observation_runtime_actor_not_cleared';",
    "  end if;",
    "  if exists (select 1 from auth.users where id = any(array['97000000-0000-4000-8000-000000000001'::uuid, '97000000-0000-4000-8000-000000000002'::uuid, '97000000-0000-4000-8000-000000000003'::uuid, '97000000-0000-4000-8000-000000000004'::uuid])) then",
    "    raise exception 'registration_observation_fixture_auth_users_remain';",
    "  end if;",
    "  if exists (select 1 from public.profiles where id = any(array['97000000-0000-4000-8000-000000000001'::uuid, '97000000-0000-4000-8000-000000000002'::uuid, '97000000-0000-4000-8000-000000000003'::uuid, '97000000-0000-4000-8000-000000000004'::uuid])) then",
    "    raise exception 'registration_observation_fixture_profiles_remain';",
    "  end if;",
    "  if exists (select 1 from public.teacher_catalogs where id = '97000000-0000-4000-8000-000000000101'::uuid or profile_id = any(array['97000000-0000-4000-8000-000000000001'::uuid, '97000000-0000-4000-8000-000000000002'::uuid, '97000000-0000-4000-8000-000000000003'::uuid, '97000000-0000-4000-8000-000000000004'::uuid])) then",
    "    raise exception 'registration_observation_fixture_teacher_catalogs_remain';",
    "  end if;",
    "  if exists (select 1 from public.classroom_catalogs where id = '97000000-0000-4000-8000-000000000102'::uuid) then",
    "    raise exception 'registration_observation_fixture_classroom_remains';",
    "  end if;",
    "  if exists (select 1 from public.class_schedule_slots where id = '97000000-0000-4000-8000-000000000113'::uuid) then",
    "    raise exception 'registration_observation_fixture_schedule_slot_remains';",
    "  end if;",
    "  if exists (select 1 from public.classes where id = any(array['97000000-0000-4000-8000-000000000103'::uuid, '97000000-0000-4000-8000-000000000112'::uuid])) then",
    "    raise exception 'registration_observation_fixture_class_remains';",
    "  end if;",
    "  if exists (select 1 from public.class_lesson_sessions where id = '97000000-0000-4000-8000-000000000104'::uuid) then",
    "    raise exception 'registration_observation_fixture_session_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_tasks where id = '97000000-0000-4000-8000-000000000105'::uuid) then",
    "    raise exception 'registration_observation_fixture_task_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_registration_subject_tracks where id = '97000000-0000-4000-8000-000000000106'::uuid) then",
    "    raise exception 'registration_observation_fixture_track_remains';",
    "  end if;",
    "  if exists (select 1 from public.ops_registration_appointments where id = any(array['97000000-0000-4000-8000-000000000107'::uuid, '97000000-0000-4000-8000-000000000109'::uuid])) then",
    "    raise exception 'registration_observation_fixture_appointments_remain';",
    "  end if;",
    "  if exists (select 1 from public.ops_registration_observations where id = any(array['97000000-0000-4000-8000-000000000108'::uuid, '97000000-0000-4000-8000-000000000110'::uuid])) then",
    "    raise exception 'registration_observation_fixture_rows_remain';",
    "  end if;",
    "  if exists (select 1 from dashboard_private.registration_observation_mutation_requests where actor_profile_id = any(array['97000000-0000-4000-8000-000000000001'::uuid, '97000000-0000-4000-8000-000000000002'::uuid, '97000000-0000-4000-8000-000000000003'::uuid, '97000000-0000-4000-8000-000000000004'::uuid])) then",
    "    raise exception 'registration_observation_fixture_receipts_remain';",
    "  end if;",
    "  if exists (select 1 from dashboard_private.registration_observation_domain_events where observation_id = any(array['97000000-0000-4000-8000-000000000108'::uuid, '97000000-0000-4000-8000-000000000110'::uuid])) then",
    "    raise exception 'registration_observation_fixture_events_remain';",
    "  end if;",
    ...bookingAssertions,
    ...feedbackAssertions,
    ...enrollmentAssertions,
    ...providerAssertions,
    "end",
    "$$;",
    `drop table ${PROVIDER_OUTBOX_BASELINE_TABLE};`,
    "commit;",
    `select ${sqlStringLiteral(PROVIDER_OUTBOX_ZERO_RECEIPT)};`,
  ].join("\n");
}

export function buildRegistrationObservationLocalDbQaPlan(options) {
  const containerName = `supabase_db_${options.projectId}`;
  const runtimePortManifest =
    assertRegistrationObservationRuntimePortManifest(
      options.runtimePortManifest,
    );
  return Object.freeze({
    repositoryRoot: options.repositoryRoot,
    runtimeRoot: options.runtimeRoot,
    projectId: options.projectId,
    focus: options.focus,
    dbUrl: runtimePortManifest.dbUrl,
    runtimePortManifest,
    migrations: Object.freeze([...(options.migrationPaths ?? [])]),
    tests: Object.freeze([
      ...(FOCUS_REGISTRY.get(options.focus)?.tests ?? []),
    ]),
    resourceManifest: Object.freeze(exactResourceManifest(options.projectId)),
    steps: Object.freeze([
      {
        name: "db-start",
        argv: [
          PINNED_SUPABASE_GO,
          "db",
          "start",
          "--workdir",
          options.runtimeRoot,
        ],
      },
      {
        name: "db-reset",
        argv: [
          PINNED_SUPABASE_GO,
          "db",
          "reset",
          "--local",
          "--no-seed",
          "--workdir",
          options.runtimeRoot,
        ],
      },
      ...(options.focus === "booking"
        ? [{
            name: "schema-pgtap",
            argv: [
              PINNED_SUPABASE_GO,
              "test",
              "db",
              "--workdir",
              options.runtimeRoot,
              options.preFixtureTestDirectoryPath,
              "--db-url",
              runtimePortManifest.dbUrl,
            ],
          }]
        : []),
      {
        name: "focus-fixture-setup",
        argv: psqlCommand(containerName, options.setupSql),
      },
      {
        name: "pgtap",
        argv: [
          PINNED_SUPABASE_GO,
          "test",
          "db",
          "--workdir",
          options.runtimeRoot,
          options.focusTestDirectoryPath,
          "--db-url",
          runtimePortManifest.dbUrl,
        ],
      },
      {
        name: "focus-fixture-cleanup",
        argv: psqlCommand(containerName, options.cleanupSql),
      },
      {
        name: "fresh-runtime0-assert",
        argv: psqlCommand(containerName, options.freshAssertSql),
      },
      {
        name: "db-stop",
        argv: [
          PINNED_SUPABASE_GO,
          "stop",
          "--workdir",
          options.runtimeRoot,
          "--project-id",
          options.projectId,
          "--no-backup",
          "--yes",
        ],
      },
    ]),
  });
}

export async function executeRegistrationObservationLocalDbQaPlan(
  plan,
  dependencies = {},
) {
  const runStep = dependencies.runStep ?? runStepDefault;
  const inspectResources = dependencies.inspectResources ?? inspectResourcesDefault;
  const state = {
    status: 0,
    primaryError: null,
    cleanupErrors: [],
    startAttempted: false,
    setupStarted: false,
    providerCalls: null,
  };
  const stepsByName = new Map(plan.steps.map((step) => [step.name, step]));
  const start = stepsByName.get("db-start");
  const reset = stepsByName.get("db-reset");
  const schemaPgTap = stepsByName.get("schema-pgtap");
  const setup = stepsByName.get("focus-fixture-setup");
  const pgTap = stepsByName.get("pgtap");
  const cleanup = stepsByName.get("focus-fixture-cleanup");
  const fresh = stepsByName.get("fresh-runtime0-assert");
  const stop = stepsByName.get("db-stop");

  const recordPrimary = (step, error) => {
    if (!state.primaryError) state.primaryError = { step, error };
    else state.cleanupErrors.push({ step, error });
  };
  const recordCleanup = (step, error) => {
    state.cleanupErrors.push({ step, error });
  };

  try {
    state.startAttempted = true;
    try {
      await runStep(start);
    } catch (error) {
      recordPrimary(start.name, error);
      return state;
    }

    try {
      await runStep(reset);
    } catch (error) {
      recordPrimary(reset.name, error);
      return state;
    }

    if (schemaPgTap) {
      try {
        await runStep(schemaPgTap);
      } catch (error) {
        recordPrimary(schemaPgTap.name, error);
        return state;
      }
    }

    state.setupStarted = true;
    try {
      await runStep(setup);
      await runStep(pgTap);
    } catch (error) {
      recordPrimary(
        error?.stepName
          ?? (error?.message?.includes(setup.name) ? setup.name : pgTap.name),
        error,
      );
    } finally {
      try {
        await runStep(cleanup);
      } catch (error) {
        recordCleanup(cleanup.name, error);
      }
      try {
        const freshResult = await runStep(fresh);
        const receipts = String(freshResult?.stdout ?? "")
          .split("\n")
          .map((value) => value.trim())
          .filter((value) => value === PROVIDER_OUTBOX_ZERO_RECEIPT);
        if (receipts.length !== 1) {
          throw new Error(
            "registration_observation_provider_outbox_zero_receipt_invalid",
          );
        }
        state.providerCalls = 0;
      } catch (error) {
        recordCleanup(fresh.name, error);
      }
    }
    return state;
  } finally {
    if (state.startAttempted) {
      try {
        await runStep(stop);
      } catch (error) {
        recordCleanup(stop.name, error);
      }
      try {
        const leftovers = await inspectResources(plan.projectId);
        if (leftovers.length > 0) {
          recordCleanup(
            "resource-residue",
            new Error(
              `registration_observation_local_db_cleanup_incomplete:${leftovers
                .map(({ kind, name }) => `${kind}:${name}`)
                .join(",")}`,
            ),
          );
        }
      } catch (error) {
        recordCleanup("resource-inspection", error);
      }
    }
    if (state.primaryError || state.cleanupErrors.length > 0) {
      state.status = 1;
    }
  }
}

async function listRepositoryMigrationPaths(repositoryRoot) {
  const migrationRoot = path.join(repositoryRoot, "supabase/migrations");
  const names = await readdir(migrationRoot);
  return names
    .filter((name) => /^[0-9]{14}_.+\.sql$/u.test(name))
    .sort()
    .map((name) => path.join("supabase/migrations", name));
}

export function registrationObservationFocusTestStagedName(index, testPath) {
  if (!Number.isSafeInteger(index) || index < 0) {
    fail("registration_observation_local_db_test_order_invalid");
  }
  return `${String(index + 1).padStart(3, "0")}_${path.basename(testPath)}`;
}

function focusTerminal(focus, migrationPaths) {
  return focus === "schema"
    ? resolveRegistrationObservationSchemaFocusTerminal(migrationPaths)
    : FOCUS_REGISTRY.get(focus).ceiling;
}

function assertFocusAvailable(focus, repositoryRoot, migrationPaths) {
  const contract = FOCUS_REGISTRY.get(focus);
  const names = new Set(migrationPaths.map((entry) => path.basename(entry)));
  const requiredMigrations = focus === "schema"
    ? [
        focusTerminal(focus, migrationPaths) === "20260809101000"
          ? "20260809101000_registration_observation_reads.sql"
          : "20260809100000_registration_observation_core_schema.sql",
      ]
    : contract.migrations;
  const missingMigration = requiredMigrations.some((name) => !names.has(name));
  const testPathsPresent = contract.tests.every((testPath) =>
    existsSync(path.join(repositoryRoot, testPath))
  );
  if (
    missingMigration
    || !testPathsPresent
    || contract.fixture === "downstream-committed"
  ) {
    fail("registration_observation_local_db_focus_unavailable", focus, 2);
  }
}

export function registrationObservationLocalConfigToml(
  projectId,
  runtimePortManifest,
) {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    fail("registration_observation_local_db_project_identity_rejected");
  }
  const manifest = assertRegistrationObservationRuntimePortManifest(
    runtimePortManifest,
  );
  return [
    `project_id = "${projectId}"`,
    "",
    "[api]",
    "enabled = false",
    `port = ${manifest.apiPort}`,
    "",
    "[db]",
    `port = ${manifest.dbPort}`,
    `shadow_port = ${manifest.shadowPort}`,
    "major_version = 15",
    "",
    "[db.pooler]",
    "enabled = false",
    `port = ${manifest.poolerPort}`,
    "",
    "[db.migrations]",
    "enabled = true",
    "",
    "[db.seed]",
    "enabled = false",
    "",
  ].join("\n");
}

async function prepareRuntime(options, migrationPaths) {
  const terminal = focusTerminal(options.focus, migrationPaths);
  const supabaseRoot = path.join(options.runtimeRoot, "supabase");
  const migrationRoot = path.join(supabaseRoot, "migrations");
  const focusTestDirectoryPath = path.join(
    supabaseRoot,
    "focus-tests",
    options.focus,
  );
  const preFixtureTestDirectoryPath = options.focus === "booking"
    ? path.join(supabaseRoot, "focus-tests", "booking-schema")
    : null;
  const auditRoot = path.join(supabaseRoot, "qa-audit", options.focus);
  await mkdir(migrationRoot, { recursive: true });
  await mkdir(focusTestDirectoryPath, { recursive: true });
  if (preFixtureTestDirectoryPath) {
    await mkdir(preFixtureTestDirectoryPath, { recursive: true });
  }
  await mkdir(auditRoot, { recursive: true });

  await writeFile(
    path.join(
      migrationRoot,
      "00000000000000_registration_observation_local_qa_prerequisites.sql",
    ),
    registrationObservationLocalQaPrerequisiteSql(),
    "utf8",
  );
  await writeFile(
    path.join(
      migrationRoot,
      "20260722141999_registration_observation_local_qa_history_fixture.sql",
    ),
    registrationObservationLocalQaHistoryFixtureSql(),
    "utf8",
  );

  const selectedMigrations = migrationPaths.filter(
    (entry) => path.basename(entry).slice(0, 14) <= terminal,
  );
  for (const migrationPath of selectedMigrations) {
    await cp(
      path.join(options.repositoryRoot, migrationPath),
      path.join(migrationRoot, path.basename(migrationPath)),
    );
  }

  const focusContract = FOCUS_REGISTRY.get(options.focus);
  for (const [testIndex, testPath] of focusContract.tests.entries()) {
    const destinationRoot = options.focus === "booking"
        && path.basename(testPath) === "registration_observation_schema_test.sql"
      ? preFixtureTestDirectoryPath
      : focusTestDirectoryPath;
    await cp(
      path.join(options.repositoryRoot, testPath),
      path.join(
        destinationRoot,
        registrationObservationFocusTestStagedName(testIndex, testPath),
      ),
    );
  }

  const setupSql = registrationObservationFocusSetupSql(options.focus);
  const cleanupSql = registrationObservationFocusCleanupSql(options.focus);
  const freshAssertSql = registrationObservationSchemaFreshAssertionSql(
    options.focus,
  );
  const sqlFiles = [
    ["setup.sql", setupSql],
    ["cleanup.sql", cleanupSql],
    ["fresh-runtime0-assert.sql", freshAssertSql],
  ];
  for (const [name, contents] of sqlFiles) {
    await writeFile(path.join(auditRoot, name), `${contents}\n`, "utf8");
  }

  await writeFile(
    path.join(supabaseRoot, "config.toml"),
    registrationObservationLocalConfigToml(
      options.projectId,
      options.runtimePortManifest,
    ),
    "utf8",
  );

  return {
    migrationPaths: selectedMigrations,
    focusTestDirectoryPath,
    preFixtureTestDirectoryPath,
    setupSql: (await readFile(path.join(auditRoot, "setup.sql"), "utf8")).trim(),
    cleanupSql: (await readFile(path.join(auditRoot, "cleanup.sql"), "utf8")).trim(),
    freshAssertSql: (
      await readFile(path.join(auditRoot, "fresh-runtime0-assert.sql"), "utf8")
    ).trim(),
  };
}

async function runStepDefault(step) {
  const [executable, ...arguments_] = step.argv;
  try {
    return await execFileAsync(executable, arguments_, {
      env: buildRegistrationObservationLocalEnvironment(),
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    error.stepName = step.name;
    throw error;
  }
}

async function inspectResourcesDefault(projectId) {
  const labelKey = "com.supabase.cli.project";
  const commands = [
    ["container", ["ps", "-a", "--filter", `label=${labelKey}=${projectId}`, "--format", `{{.Label \"${labelKey}\"}}|{{.Names}}`]],
    ["network", ["network", "ls", "--filter", `label=${labelKey}=${projectId}`, "--format", `{{.Label \"${labelKey}\"}}|{{.Name}}`]],
    ["volume", ["volume", "ls", "--filter", `label=${labelKey}=${projectId}`, "--format", `{{.Label \"${labelKey}\"}}|{{.Name}}`]],
  ];
  const resources = [];
  for (const [kind, arguments_] of commands) {
    const { stdout } = await execFileAsync("docker", arguments_, {
      env: buildRegistrationObservationLocalEnvironment(),
    });
    for (const row of stdout.split("\n").map((value) => value.trim()).filter(Boolean)) {
      const [label, name] = row.split("|", 2);
      if (label === projectId) resources.push({ kind, name, projectId: label });
    }
  }
  return resources;
}

async function removeExactResources(resources, projectId) {
  const allowed = new Set(
    exactResourceManifest(projectId).map(({ kind, name }) => `${kind}:${name}`),
  );
  const commands = {
    container: ["rm", "-f"],
    volume: ["volume", "rm"],
    network: ["network", "rm"],
  };
  for (const kind of ["container", "volume", "network"]) {
    for (const resource of resources.filter((entry) => entry.kind === kind)) {
      if (
        resource.projectId !== projectId
        || !allowed.has(`${resource.kind}:${resource.name}`)
      ) {
        fail("registration_observation_local_db_resource_ownership_rejected");
      }
      await execFileAsync(
        "docker",
        [...commands[kind], resource.name],
        { env: buildRegistrationObservationLocalEnvironment() },
      );
    }
  }
}

function assertExecutionProvenance(options) {
  if (!PROJECT_ID_PATTERN.test(options.projectId)) {
    fail("registration_observation_local_db_project_identity_rejected");
  }
  const resolved = path.resolve(options.runtimeRoot);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir())
    || !path.basename(resolved).startsWith(WORKDIR_PREFIX)
  ) {
    fail("registration_observation_local_db_runtime_provenance_rejected");
  }
  assertRegistrationObservationRuntimePortManifest(
    options.runtimePortManifest,
  );
}

function assertPinnedCliVersion() {
  const version = execFileSync(PINNED_SUPABASE_GO, ["--version"], {
    encoding: "utf8",
    env: buildRegistrationObservationLocalEnvironment(),
  }).trim();
  if (version !== PINNED_SUPABASE_VERSION) {
    fail(
      "registration_observation_local_db_cli_version_mismatch",
      version,
    );
  }
}

function errorDetail(error) {
  return [
    error?.message,
    error?.stdout?.trim(),
    error?.stderr?.trim(),
  ].filter(Boolean).join("\n");
}

function formatPlanFailure(report) {
  const primary = report.primaryError
    ? `${report.primaryError.step}:${errorDetail(report.primaryError.error)}`
    : "none";
  const cleanup = report.cleanupErrors
    .map(({ step, error }) => `${step}:${errorDetail(error)}`)
    .join("|");
  return `registration_observation_local_db_qa_failed:primary=${primary}${
    cleanup ? `|cleanup=${cleanup}` : ""
  }`;
}

async function runExecutionStep(step, callback) {
  try {
    return await callback();
  } catch (error) {
    const stepError = error instanceof Error
      ? error
      : new Error(String(error));
    if (!stepError.stepName) stepError.stepName = step;
    throw stepError;
  }
}

async function runExecuted(options, dependencies, lifecycleState) {
  const inspectResources =
    dependencies.inspectResources ?? inspectResourcesDefault;
  const assertSafeEnvironment =
    dependencies.assertSafeEnvironment
    ?? assertRegistrationObservationSafeEnvironment;
  const assertCliVersion =
    dependencies.assertPinnedCliVersion ?? assertPinnedCliVersion;
  const listMigrationPaths =
    dependencies.listMigrationPaths ?? listRepositoryMigrationPaths;
  const prepare = dependencies.prepareRuntime ?? prepareRuntime;
  const executePlan =
    dependencies.executePlan ?? executeRegistrationObservationLocalDbQaPlan;

  await runExecutionStep("execution-provenance", () =>
    assertExecutionProvenance(options)
  );
  await runExecutionStep("environment-preflight", () =>
    assertSafeEnvironment(process.env)
  );
  await runExecutionStep("cli-version-preflight", () => assertCliVersion());
  const migrationPaths = await runExecutionStep(
    "migration-catalog-preflight",
    () => listMigrationPaths(options.repositoryRoot),
  );
  await runExecutionStep("focus-availability-preflight", () =>
    assertFocusAvailable(options.focus, options.repositoryRoot, migrationPaths)
  );
  const preflight = await runExecutionStep(
    "resource-preflight",
    () => inspectResources(options.projectId),
  );
  if (preflight.length > 0) {
    const error = new Error(
      "registration_observation_local_db_preexisting_resources",
    );
    error.stepName = "resource-preflight";
    throw error;
  }
  lifecycleState.resourceCleanupAllowed = true;

  const prepared = await runExecutionStep(
    "runtime-prepare",
    () => prepare(options, migrationPaths),
  );
  const plan = buildRegistrationObservationLocalDbQaPlan({
    ...options,
    ...prepared,
  });
  const report = await runExecutionStep(
    "qa-plan",
    () => executePlan(plan, { inspectResources }),
  );
  if (report.status !== 0) {
    const error = new Error(formatPlanFailure(report));
    error.stepName = report.primaryError?.step
      ?? report.cleanupErrors[0]?.step
      ?? "qa-plan";
    error.qaReport = report;
    throw error;
  }
  return {
    mode: "executed-local-db",
    focus: options.focus,
    runtimeVersion: 0,
    providerCalls: report.providerCalls,
    cleanup: "passed",
    report,
  };
}

function runtimeRootIsOwned(runtimeRoot) {
  if (typeof runtimeRoot !== "string") return false;
  const resolved = path.resolve(runtimeRoot);
  return path.dirname(resolved) === path.resolve(os.tmpdir())
    && path.basename(resolved).startsWith(WORKDIR_PREFIX);
}

async function removeRuntimeRootDefault(runtimeRoot) {
  await rm(runtimeRoot, { recursive: true, force: true });
}

export async function executeRegistrationObservationLocalDbQaLifecycle(
  options,
  dependencies = {},
) {
  const state = {
    status: 0,
    primaryError: null,
    cleanupErrors: [],
    cleanupEvidence: [],
    result: null,
  };
  const lifecycleState = { resourceCleanupAllowed: false };
  const createRuntimeRoot = dependencies.createRuntimeRoot
    ?? (() => mkdtemp(path.join(os.tmpdir(), WORKDIR_PREFIX)));
  const randomSource = dependencies.randomBytes ?? randomBytes;
  const inspectResources =
    dependencies.inspectResources ?? inspectResourcesDefault;
  const removeResources =
    dependencies.removeResources ?? removeExactResources;
  const removeRuntimeRoot =
    dependencies.removeRuntimeRoot ?? removeRuntimeRootDefault;
  const fallbackRemoveRuntimeRoot =
    dependencies.fallbackRemoveRuntimeRoot ?? removeRuntimeRootDefault;
  let runtimeRoot;
  let projectId;
  let runtimePortManifest;
  let pendingPortLeaseCleanup;

  const recordCleanup = (step, error) => {
    state.cleanupErrors.push({ step, error });
    state.cleanupEvidence.push({ step, status: "failed", error });
  };
  const recordCleanupSuccess = (step, detail = "passed") => {
    state.cleanupEvidence.push({ step, status: detail });
  };

  try {
    runtimeRoot = await runExecutionStep(
      "runtime-root-creation",
      createRuntimeRoot,
    );
    await runExecutionStep("runtime-root-provenance", () => {
      if (!runtimeRootIsOwned(runtimeRoot)) {
        fail("registration_observation_local_db_runtime_provenance_rejected");
      }
    });
    const randomValue = await runExecutionStep(
      "project-identity-allocation",
      () => randomSource(6),
    );
    if (
      !(randomValue instanceof Uint8Array)
      || randomValue.byteLength !== 6
    ) {
      const error = new Error(
        "registration_observation_local_db_project_identity_rejected",
      );
      error.stepName = "project-identity-allocation";
      throw error;
    }
    projectId = `${PROJECT_ID_PREFIX}${Buffer.from(randomValue).toString("hex")}`;
    runtimePortManifest = await runExecutionStep(
      "runtime-port-allocation",
      () => buildRegistrationObservationRuntimePortManifest({
        allocateLoopbackPort:
          dependencies.allocateLoopbackPort ?? allocateFreeLoopbackPort,
        acquirePortLease:
          dependencies.acquirePortLease ?? acquirePortLeaseDefault,
        leaseRoot: dependencies.leaseRoot ?? PORT_LEASE_ROOT,
        now: dependencies.now ?? Date.now,
        projectId,
        releasePortLease:
          dependencies.releasePortLease ?? releasePortLeaseDefault,
      }),
    );
    state.result = await runExecuted(
      {
        repositoryRoot: options.repositoryRoot,
        runtimeRoot,
        projectId,
        focus: options.focus,
        runtimePortManifest,
      },
      dependencies,
      lifecycleState,
    );
  } catch (error) {
    pendingPortLeaseCleanup = error?.portLeaseCleanup;
    for (const rollbackError of error?.portLeaseRollbackErrors ?? []) {
      recordCleanup("runtime-port-lease-rollback", rollbackError);
    }
    state.primaryError = {
      step: error?.stepName ?? "execution",
      error,
    };
  } finally {
    if (runtimeRoot && projectId && PROJECT_ID_PATTERN.test(projectId)) {
      let leftovers;
      try {
        leftovers = await inspectResources(projectId);
        recordCleanupSuccess("emergency-resource-inspection");
      } catch (error) {
        recordCleanup("emergency-resource-inspection", error);
      }

      if (
        Array.isArray(leftovers)
        && leftovers.length > 0
        && lifecycleState.resourceCleanupAllowed
      ) {
        try {
          await removeResources(leftovers, projectId);
          recordCleanupSuccess("emergency-resource-removal");
        } catch (error) {
          recordCleanup("emergency-resource-removal", error);
        }
        try {
          const residue = await inspectResources(projectId);
          if (residue.length > 0) {
            throw new Error(
              `registration_observation_local_db_cleanup_incomplete:${residue
                .map(({ kind, name }) => `${kind}:${name}`)
                .join(",")}`,
            );
          }
          recordCleanupSuccess("emergency-resource-reinspection");
        } catch (error) {
          recordCleanup("emergency-resource-reinspection", error);
        }
      } else if (Array.isArray(leftovers) && leftovers.length > 0) {
        recordCleanupSuccess(
          "emergency-resource-removal",
          "skipped-preflight-not-passed",
        );
      }
    }

    if (runtimeRoot) {
      if (!runtimeRootIsOwned(runtimeRoot)) {
        recordCleanup(
          "runtime-root-removal",
          new Error(
            "registration_observation_local_db_runtime_provenance_rejected",
          ),
        );
      } else {
        try {
          await removeRuntimeRoot(runtimeRoot);
          recordCleanupSuccess("runtime-root-removal");
        } catch (error) {
          recordCleanup("runtime-root-removal", error);
          try {
            await fallbackRemoveRuntimeRoot(runtimeRoot);
            recordCleanupSuccess("runtime-root-removal-fallback");
          } catch (fallbackError) {
            recordCleanup("runtime-root-removal-fallback", fallbackError);
          }
        }
      }
    }

    if (runtimePortManifest) {
      try {
        await releaseRegistrationObservationRuntimePortLeases(
          runtimePortManifest,
        );
        recordCleanupSuccess("runtime-port-lease-release");
      } catch (error) {
        recordCleanup("runtime-port-lease-release", error);
        try {
          await releaseRegistrationObservationRuntimePortLeases(
            runtimePortManifest,
          );
          recordCleanupSuccess("runtime-port-lease-release-fallback");
        } catch (fallbackError) {
          recordCleanup(
            "runtime-port-lease-release-fallback",
            fallbackError,
          );
        }
      }
    } else if (pendingPortLeaseCleanup) {
      const releasePendingClaims = async () => {
        const { failedClaims, errors } = await releasePortLeaseClaims(
          pendingPortLeaseCleanup.failedClaims,
          pendingPortLeaseCleanup.releasePortLease,
        );
        pendingPortLeaseCleanup = {
          ...pendingPortLeaseCleanup,
          failedClaims,
        };
        if (errors.length > 0) {
          throw portLeaseFailure(
            "registration_observation_local_db_port_lease_release_failed",
            errors.map((error) => error?.message ?? String(error)).join("|"),
          );
        }
      };
      try {
        await releasePendingClaims();
        recordCleanupSuccess("runtime-port-lease-release");
      } catch (error) {
        recordCleanup("runtime-port-lease-release", error);
        try {
          await releasePendingClaims();
          recordCleanupSuccess("runtime-port-lease-release-fallback");
        } catch (fallbackError) {
          recordCleanup(
            "runtime-port-lease-release-fallback",
            fallbackError,
          );
        }
      }
    }
  }
  if (state.primaryError || state.cleanupErrors.length > 0) state.status = 1;
  return state;
}

function formatLifecycleFailure(state) {
  const primary = state.primaryError
    ? `${state.primaryError.step}:${errorDetail(state.primaryError.error)}`
    : "none";
  const cleanup = state.cleanupErrors
    .map(({ step, error }) => `${step}:${errorDetail(error)}`)
    .join("|");
  return `primary=${primary}${cleanup ? `|cleanup=${cleanup}` : ""}`;
}

async function main() {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.execute !== parsed.approvedLocalDb) {
    fail("registration_observation_local_db_approval_required", "", 2);
  }

  if (!parsed.execute) {
    process.stdout.write(
      `DRY RUN — zero database changes\n${JSON.stringify({
        focus: parsed.focus,
        databaseHost: LOOPBACK_HOST,
        ports: "allocated uniquely per execution",
        providerCalls: 0,
        lifecycle: parsed.focus === "booking"
          ? [
              "db-start",
              "db-reset",
              "schema-pgtap",
              "focus-fixture-setup",
              "pgtap",
              "focus-fixture-cleanup",
              "fresh-runtime0-assert",
              "db-stop",
            ]
          : [
              "db-start",
              "db-reset",
              "focus-fixture-setup",
              "pgtap",
              "focus-fixture-cleanup",
              "fresh-runtime0-assert",
              "db-stop",
            ],
      }, null, 2)}\n`,
    );
    return;
  }

  const migrationPaths = await listRepositoryMigrationPaths(repositoryRoot);
  assertFocusAvailable(parsed.focus, repositoryRoot, migrationPaths);
  const lifecycle = await executeRegistrationObservationLocalDbQaLifecycle({
    repositoryRoot,
    focus: parsed.focus,
  });
  if (lifecycle.status !== 0) {
    const exitCode = lifecycle.primaryError?.error?.exitCode ?? 1;
    fail(
      "registration_observation_local_db_qa_failed",
      formatLifecycleFailure(lifecycle),
      exitCode,
    );
  }
  process.stdout.write(`${JSON.stringify(lifecycle.result, null, 2)}\n`);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  });
}
