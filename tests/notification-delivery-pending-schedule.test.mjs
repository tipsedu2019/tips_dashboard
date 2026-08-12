import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createOwnedProviderZeroProject,
} from "../scripts/run-registration-observation-google-chat-provider-zero.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationDirectory = join(repositoryRoot, "supabase", "migrations");
const adapterPgTapPath = "supabase/tests/notification_adapters_forward_install_test.sql";
const pendingSchedulePgTapPath = join(
  repositoryRoot,
  "supabase/tests/notification_delivery_pending_schedule_test.sql",
);

function localOnlyEnvironment() {
  return {
    HOME: process.env.HOME ?? "/tmp",
    LANG: process.env.LANG ?? "C",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    SHELL: process.env.SHELL ?? "/bin/zsh",
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    USER: process.env.USER ?? "pending-delivery-schedule-test",
  };
}

async function oneMigration(suffix) {
  const matches = (await readdir(migrationDirectory))
    .filter((entry) => /^[0-9]{14}/u.test(entry) && entry.endsWith(suffix))
    .sort();
  assert.ok(matches.length <= 1, `at most one migration may match ${suffix}`);
  return matches[0] ? join(migrationDirectory, matches[0]) : null;
}

function functionBlock(source, name) {
  const start = source.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${name}\\s*\\(`, "iu"));
  assert.notEqual(start, -1, `missing function ${name}`);
  const rest = source.slice(start);
  const end = rest.search(/\n\$\$;\s*(?:\n|$)/u);
  assert.notEqual(end, -1, `missing function terminator ${name}`);
  return rest.slice(0, end + 4);
}

test("expired claimed deliveries return to pending without a retry-only timestamp", async () => {
  const leaseReapMigration = await oneMigration(
    "_notification_delivery_lease_reap_schedule_fix.sql",
  );
  assert.ok(leaseReapMigration, "lease reaper schedule fix migration must exist");

  const reaper = functionBlock(
    await readFile(leaseReapMigration, "utf8"),
    "reap_notification_leases_v1",
  );
  assert.match(
    reaper,
    /delivery\.status\s*=\s*'claimed'[\s\S]*?set status\s*=\s*'pending',[\s\S]*?next_attempt_at\s*=\s*null/iu,
  );
  assert.doesNotMatch(
    reaper,
    /delivery\.status\s*=\s*'claimed'[\s\S]*?set status\s*=\s*'pending',[\s\S]*?next_attempt_at\s*=\s*pg_catalog\.clock_timestamp\(\)/iu,
  );
});

test("an enabled canonical fanout materializes a claimable pending delivery without a retry timestamp", async () => {
  // Break caught: assigning next_attempt_at to a first pending delivery
  // violates the ledger's retry-only constraint and prevents real fanout.
  const project = await createOwnedProviderZeroProject({
    repositoryRoot,
    env: localOnlyEnvironment(),
  });

  try {
    await project.applyMigrationsThrough("20260809105000");
    const adapterMigration = await oneMigration(
      "_notification_adapters_forward_install.sql",
    );
    assert.ok(adapterMigration, "adapter migration fixture must exist");
    await project.applyForwardMigration(adapterMigration, adapterPgTapPath);

    const pendingScheduleMigration = await oneMigration(
      "_notification_delivery_pending_schedule_fix.sql",
    );
    if (pendingScheduleMigration) {
      await project.execSql(await readFile(pendingScheduleMigration, "utf8"));
    }

    const { stdout } = await project.execSql(
      await readFile(pendingSchedulePgTapPath, "utf8"),
    );
    assert.match(String(stdout), /^1\.\.4$/mu);
    assert.doesNotMatch(String(stdout), /^not ok /mu);
  } finally {
    await project.cleanupOwnedResources();
  }
});
