import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

import {
  APPROVED_EXCEPTION_REASONS,
  OPERATIONAL_LEGACY_EXCEPTIONS,
  inspectOperationalMigrationSource,
  verifyFreeTierContracts,
} from "../scripts/verify-free-tier-query-contracts.mjs"

const verifier = new URL("../scripts/verify-free-tier-query-contracts.mjs", import.meta.url)

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

async function writeFiles(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(root, relativePath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }
}

async function createFixtureRepository(files = { "README.md": "fixture\n" }) {
  const root = await mkdtemp(join(tmpdir(), "free-tier-guardrails-"))
  await writeFiles(root, files)
  git(root, ["init", "--quiet"])
  git(root, ["config", "user.email", "free-tier-guard@example.invalid"])
  git(root, ["config", "user.name", "Free tier guard fixture"])
  git(root, ["add", "."])
  git(root, ["commit", "--quiet", "-m", "baseline"])
  return root
}

function commitFixture(root, message = "candidate") {
  git(root, ["add", "."])
  git(root, ["commit", "--quiet", "-m", message])
  return git(root, ["rev-parse", "HEAD"])
}

test("operational SQL guard rejects periodic notification workers, heartbeat writes, raw receipts, and broad cron removal", () => {
  const violations = inspectOperationalMigrationSource({
    file: "supabase/migrations/20990101010101_bad_operations.sql",
    source: `
create table public.notification_worker_heartbeats (id uuid primary key);
insert into public.notification_worker_heartbeats(id) values (gen_random_uuid());
create table public.delivery_receipts (
  id uuid primary key,
  full_phone text,
  message_body text,
  webhook_url text,
  provider_raw_receipt jsonb
);
select cron.schedule(
  'notification-worker-every-minute',
  '* * * * *',
  $$select public.run_notification_worker_v1()$$
);
select cron.unschedule(jobid) from cron.job where jobname like 'notification-%';
delete from cron.job where jobname like 'notification-%';
`,
  })

  assert.deepEqual([...new Set(violations.map(({ reason }) => reason))].sort(), [
    "broad_cron_removal",
    "cron_schedule_direct_activation",
    "full_message_receipt_column",
    "full_phone_receipt_column",
    "heartbeat_or_watchdog_table",
    "heartbeat_or_watchdog_write",
    "notification_every_minute_cron",
    "provider_raw_receipt_column",
    "webhook_receipt_column",
  ])
})

test("operational SQL guard permits runtime function definitions, exact unschedule, and bounded receipt metadata", () => {
  const violations = inspectOperationalMigrationSource({
    file: "supabase/migrations/20990101010102_safe_operations.sql",
    source: `
create table public.notification_delivery_receipts (
  id uuid primary key,
  schedule_id uuid not null,
  outcome text not null,
  provider_http_status integer,
  dedupe_key text not null,
  sent_at timestamptz not null
);
create function public.install_notification_schedule_v1() returns void
language plpgsql
as $body$
begin
  perform cron.schedule('notification-daily', '0 1 * * *', 'select 1');
end;
$body$;
select cron.unschedule('notification-daily-old');
`,
  })

  assert.deepEqual(violations, [])
})

test("operational SQL guard inspects executable DO bodies and periodic cron inside function definitions", () => {
  const file = "supabase/migrations/20990101010103_dollar_body_bypasses.sql"
  const doViolations = inspectOperationalMigrationSource({
    file,
    source: `do $body$
begin
  perform cron.schedule('notification-do-worker', '* * * * *', 'select 1');
end;
$body$;
`,
  })
  assert.ok(doViolations.some(({ reason }) => reason === "cron_schedule_direct_activation"))
  assert.ok(doViolations.some(({ reason }) => reason === "notification_every_minute_cron"))

  const functionViolations = inspectOperationalMigrationSource({
    file,
    source: `create function public.install_notification_worker_v1() returns void
language plpgsql
as $body$
begin
  perform cron.schedule('notification-function-worker', '* * * * *', 'select 1');
end;
$body$;
`,
  })
  assert.equal(functionViolations.some(({ reason }) => reason === "cron_schedule_direct_activation"), false)
  assert.ok(functionViolations.some(({ reason }) => reason === "notification_every_minute_cron"))
})

test("periodic cron detection accepts dollar-quoted cadence but ignores cron text inside string literals", () => {
  const file = "supabase/migrations/20990101010105_cron_literal_boundaries.sql"
  const dollarCadence = inspectOperationalMigrationSource({
    file,
    source: `create function public.install_notification_worker_v2() returns void
language plpgsql
as $body$
begin
  perform cron.schedule('notification-function-worker', $cron$* * * * *$cron$, 'select 1');
end;
$body$;
`,
  })
  assert.ok(dollarCadence.some(({ reason }) => reason === "notification_every_minute_cron"))

  const documentationOnly = inspectOperationalMigrationSource({
    file,
    source: `create function public.describe_notification_worker_v1() returns void
language plpgsql
as $body$
begin
  raise notice 'perform cron.schedule(''notification-worker'', ''* * * * *'', ''select 1'')';
end;
$body$;
`,
  })
  assert.deepEqual(documentationOnly, [])
})

test("balanced SQL parsing ignores parentheses inside line and block comments", () => {
  const file = "supabase/migrations/20990101010107_comment_parentheses.sql"
  const cronViolations = inspectOperationalMigrationSource({
    file,
    source: `create function public.install_notification_worker_v3() returns void
language plpgsql
as $body$
begin
  perform cron.schedule(
    'notification-comment-worker',
    -- documentation closes nothing )
    $cron$* * * * *$cron$,
    'select 1'
  );
end;
$body$;
`,
  })
  assert.ok(cronViolations.some(({ reason }) => reason === "notification_every_minute_cron"))

  const receiptViolations = inspectOperationalMigrationSource({
    file,
    source: `create table public.delivery_receipts (
  id uuid primary key,
  /* documentation closes nothing ) */
  phone text,
  message text,
  hook_url text,
  raw_receipt jsonb
);
`,
  })
  assert.deepEqual([...new Set(receiptViolations.map(({ reason }) => reason))].sort(), [
    "full_message_receipt_column",
    "full_phone_receipt_column",
    "provider_raw_receipt_column",
    "webhook_receipt_column",
  ])
})

test("cron parsing covers quoted identifiers and PostgreSQL escape-string cadence", () => {
  const file = "supabase/migrations/20990101010108_postgres_equivalent_syntax.sql"
  const quoted = inspectOperationalMigrationSource({
    file,
    source: `select "cron"."schedule"(
  'notification-quoted-worker',
  '* * * * *',
  'select 1'
);
`,
  })
  assert.ok(quoted.some(({ reason }) => reason === "cron_schedule_direct_activation"))
  assert.ok(quoted.some(({ reason }) => reason === "notification_every_minute_cron"))

  const escaped = inspectOperationalMigrationSource({
    file,
    source: `create function public.install_notification_worker_v4() returns void
language plpgsql
as $body$
begin
  perform cron.schedule('notification-escaped-worker', E'* * * * *', 'select 1');
end;
$body$;
`,
  })
  assert.ok(escaped.some(({ reason }) => reason === "notification_every_minute_cron"))
})

test("operational receipt tables reject generic raw PII column spellings", () => {
  const violations = inspectOperationalMigrationSource({
    file: "supabase/migrations/20990101010104_generic_receipt_columns.sql",
    source: `create table public.delivery_receipts (
  id uuid primary key,
  phone text,
  message text,
  hook_url text,
  raw_receipt jsonb
);
`,
  })

  assert.deepEqual([...new Set(violations.map(({ reason }) => reason))].sort(), [
    "full_message_receipt_column",
    "full_phone_receipt_column",
    "provider_raw_receipt_column",
    "webhook_receipt_column",
  ])
})

test("operational receipt matching checks column identifiers rather than constraint literal values", () => {
  const violations = inspectOperationalMigrationSource({
    file: "supabase/migrations/20990101010106_receipt_constraint_literals.sql",
    source: `create table public.notification_deliveries (
  id uuid primary key,
  channel text check (channel in ('message', 'phone', 'webhook')),
  outcome text not null
);
`,
  })

  assert.deepEqual(violations, [])
})

test("wrapper delegates list contracts to the shared query-surface verifier", async () => {
  const root = await createFixtureRepository({
    "src/features/tasks/list-tasks.ts": "export const baseline = true\n",
  })
  try {
    const baseSha = git(root, ["rev-parse", "HEAD"])
    await writeFiles(root, {
      "src/features/tasks/list-tasks.ts": `export async function listTasks(client) {
  return client.from("ops_tasks").select("*").limit(30).order("id").abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
    })
    const headSha = commitFixture(root)
    const result = await verifyFreeTierContracts({
      root,
      surface: "tasks",
      baseSha,
      headSha,
      queryDebtManifest: [],
      operationalExceptions: [],
    })

    assert.deepEqual(result.violations, [{
      file: "src/features/tasks/list-tasks.ts",
      symbol: "listTasks",
      surface: "tasks",
      reason: "list_select_star",
    }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("shared query verifier keeps an exact-ID detail read outside list pagination rules", async () => {
  const root = await createFixtureRepository({
    "src/features/tasks/task-detail.ts": "export const baseline = true\n",
  })
  try {
    const baseSha = git(root, ["rev-parse", "HEAD"])
    await writeFiles(root, {
      "src/features/tasks/task-detail.ts": `export async function loadTask(client, id) {
  return client.from("ops_tasks").select("id, status").eq("id", id).single().abortSignal(AbortSignal.timeout(8000)).retry(false)
}
`,
    })
    const headSha = commitFixture(root)
    const result = await verifyFreeTierContracts({
      root,
      surface: "tasks",
      baseSha,
      headSha,
      queryDebtManifest: [],
      operationalExceptions: [],
    })

    assert.deepEqual(result, { ok: true, violations: [] })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("unchanged historical migration violations are outside the candidate diff", async () => {
  const root = await createFixtureRepository({
    "supabase/migrations/20200101010101_legacy.sql": "select cron.schedule('notification-legacy', '* * * * *', 'select 1');\n",
    "src/features/academic/safe.ts": "export const value = 1\n",
  })
  try {
    const baseSha = git(root, ["rev-parse", "HEAD"])
    await writeFiles(root, { "src/features/academic/safe.ts": "export const value = 2\n" })
    const headSha = commitFixture(root)
    const result = await verifyFreeTierContracts({
      root,
      surface: "academic",
      baseSha,
      headSha,
      queryDebtManifest: [],
      operationalExceptions: [],
    })

    assert.deepEqual(result, { ok: true, violations: [] })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a touched legacy migration requires an exact baseline-bound checksum exception", async () => {
  const file = "supabase/migrations/20200101010101_legacy.sql"
  const legacy = "select cron.schedule('notification-legacy', '* * * * *', 'select 1');\n"
  const root = await createFixtureRepository({ [file]: legacy })
  try {
    const baseSha = git(root, ["rev-parse", "HEAD"])
    await writeFiles(root, { [file]: `${legacy}\n-- reviewed without changing the legacy statement\n` })
    const headSha = commitFixture(root)

    const rejected = await verifyFreeTierContracts({
      root,
      surface: "academic",
      baseSha,
      headSha,
      queryDebtManifest: [],
      operationalExceptions: [],
    })
    assert.ok(rejected.violations.some(({ reason }) => reason === "cron_schedule_direct_activation"))

    const operationalExceptions = inspectOperationalMigrationSource({ file, source: legacy }).map((violation) => ({
      file,
      symbol: violation.symbol,
      violation: violation.reason,
      reason: "test fixture",
      baselineSha: baseSha,
      checksum: violation.checksum,
    }))
    const allowed = await verifyFreeTierContracts({
      root,
      surface: "academic",
      baseSha,
      headSha,
      queryDebtManifest: [],
      operationalExceptions,
    })
    assert.deepEqual(allowed, { ok: true, violations: [] })

    const corrupted = structuredClone(operationalExceptions)
    corrupted[0].checksum = "0".repeat(64)
    await assert.rejects(
      verifyFreeTierContracts({
        root,
        surface: "academic",
        baseSha,
        headSha,
        queryDebtManifest: [],
        operationalExceptions: corrupted,
      }),
      { code: "free_tier_exception_manifest_invalid" },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a checksum exception cannot survive executable SQL changes after comment-like string content", async () => {
  const file = "supabase/migrations/20200101010102_legacy_string.sql"
  const legacy = "select cron.schedule('notification--legacy', '* * * * *', 'select safe_v1()');\n"
  const root = await createFixtureRepository({ [file]: legacy })
  try {
    const baseSha = git(root, ["rev-parse", "HEAD"])
    const operationalExceptions = inspectOperationalMigrationSource({ file, source: legacy }).map((violation) => ({
      file,
      symbol: violation.symbol,
      violation: violation.reason,
      reason: "test fixture",
      baselineSha: baseSha,
      checksum: violation.checksum,
    }))
    await writeFiles(root, { [file]: legacy.replace("safe_v1", "dangerous_v1") })
    const headSha = commitFixture(root)
    const result = await verifyFreeTierContracts({
      root,
      surface: "academic",
      baseSha,
      headSha,
      queryDebtManifest: [],
      operationalExceptions,
    })

    assert.ok(result.violations.some(({ reason }) => reason === "cron_schedule_direct_activation"))
    assert.ok(result.violations.some(({ reason }) => reason === "notification_every_minute_cron"))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("approved exception vocabulary and built-in exception ledger are immutable and test-visible", () => {
  assert.deepEqual(APPROVED_EXCEPTION_REASONS, ["schema probing", "exact-ID detail", "test fixture"])
  assert.deepEqual(OPERATIONAL_LEGACY_EXCEPTIONS, [])
  assert.equal(Object.isFrozen(APPROVED_EXCEPTION_REASONS), true)
  assert.equal(Object.isFrozen(OPERATIONAL_LEGACY_EXCEPTIONS), true)
})

test("CLI rejects incomplete, mixed, malformed, and disconnected revision modes", async () => {
  const missingHead = spawnSync(process.execPath, [verifier.pathname, "--base", "0".repeat(40), "--surface", "all"], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
  assert.equal(missingHead.status, 2)
  assert.match(missingHead.stderr, /free_tier_mode_invalid/u)

  const mixed = spawnSync(process.execPath, [verifier.pathname, "--base", "HEAD", "--head", "0".repeat(40), "--surface", "all", "--worktree"], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
  assert.equal(mixed.status, 2)
  assert.match(mixed.stderr, /free_tier_mode_invalid/u)

  const symbolicCiRevision = spawnSync(process.execPath, [verifier.pathname, "--base", "HEAD", "--head", "HEAD", "--surface", "all"], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
  assert.equal(symbolicCiRevision.status, 2)
  assert.match(symbolicCiRevision.stderr, /free_tier_ci_revision_invalid/u)

  const unknownObject = spawnSync(process.execPath, [verifier.pathname, "--base", "0".repeat(40), "--head", "1".repeat(40), "--surface", "all"], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
  assert.equal(unknownObject.status, 2)
  assert.match(unknownObject.stderr, /free_tier_git_object_invalid/u)

  const root = await createFixtureRepository()
  try {
    const baseSha = git(root, ["rev-parse", "HEAD"])
    git(root, ["switch", "--orphan", "unrelated"])
    await rm(join(root, "README.md"), { force: true })
    await writeFiles(root, { "UNRELATED.md": "unrelated\n" })
    git(root, ["add", "-A"])
    git(root, ["commit", "--quiet", "-m", "unrelated"])
    const headSha = git(root, ["rev-parse", "HEAD"])
    const disconnected = spawnSync(process.execPath, [verifier.pathname, "--base", baseSha, "--head", headSha, "--surface", "academic"], {
      cwd: root,
      encoding: "utf8",
    })
    assert.equal(disconnected.status, 2)
    assert.match(disconnected.stderr, /free_tier_merge_base_unavailable/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("CI uses the merge-base and --base HEAD worktree mode includes committed, index, unstaged, and untracked changes", async () => {
  const root = await createFixtureRepository({ "src/features/academic/safe.ts": "export const value = 1\n" })
  try {
    const mergeBase = git(root, ["rev-parse", "HEAD"])
    git(root, ["switch", "-c", "base-side"])
    await writeFiles(root, {
      "supabase/migrations/20990101010101_base_only.sql": "select cron.schedule('notification-base-only', '* * * * *', 'select 1');\n",
    })
    const baseSha = commitFixture(root, "base side")

    git(root, ["switch", "-c", "head-side", mergeBase])
    await writeFiles(root, { "src/features/academic/safe.ts": "export const value = 2\n" })
    const headSha = commitFixture(root, "head side")
    const ciResult = await verifyFreeTierContracts({
      root,
      surface: "academic",
      baseSha,
      headSha,
      queryDebtManifest: [],
      operationalExceptions: [],
    })
    assert.deepEqual(ciResult, { ok: true, violations: [] })

    await writeFiles(root, {
      "supabase/migrations/20990101010102_committed.sql": "select cron.schedule('notification-committed', '* * * * *', 'select 1');\n",
      "supabase/migrations/20990101010104_unstaged.sql": "select 1;\n",
    })
    commitFixture(root, "committed local change")
    await writeFiles(root, {
      "supabase/migrations/20990101010103_indexed.sql": "create table public.notification_worker_heartbeats(id uuid);\n",
    })
    git(root, ["add", "supabase/migrations/20990101010103_indexed.sql"])
    await writeFiles(root, {
      "supabase/migrations/20990101010104_unstaged.sql": "create table public.delivery_receipts(id uuid, full_phone text);\n",
      "supabase/migrations/20990101010105_untracked.sql": "delete from cron.job where jobname like 'notification-%';\n",
    })
    const worktreeResult = await verifyFreeTierContracts({
      root,
      surface: "academic",
      baseSha: "HEAD",
      includeWorktree: true,
      queryDebtManifest: [],
      operationalExceptions: [],
    })
    for (const expected of [
      ["20990101010102_committed.sql", "cron_schedule_direct_activation"],
      ["20990101010103_indexed.sql", "heartbeat_or_watchdog_table"],
      ["20990101010104_unstaged.sql", "full_phone_receipt_column"],
      ["20990101010105_untracked.sql", "broad_cron_removal"],
    ]) {
      assert.ok(worktreeResult.violations.some(({ file, reason }) => file.endsWith(expected[0]) && reason === expected[1]),
        `expected ${expected.join(":")}`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
