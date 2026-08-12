import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contractMigrationUrl = new URL(
  "../supabase/migrations/20260809106000_registration_observation_solapi_contract.sql",
  import.meta.url,
);

function normalizeSql(source) {
  return source.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
}

function functionBlock(source, qualifiedName) {
  const escapedName = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+${escapedName}\\s*\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$\\s*;`,
      "i",
    ),
  );
  assert.ok(match, `missing function block: ${qualifiedName}`);
  return match[0];
}

function uniqueIndexBlock(source, indexName) {
  const escapedName = indexName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `create\\s+unique\\s+index\\s+${escapedName}\\s+on[\\s\\S]*?;`,
      "i",
    ),
  );
  assert.ok(match, `missing unique index block: ${indexName}`);
  return match[0];
}

test("observation customer kinds are closed and revision scoped", async () => {
  const source = await readFile(contractMigrationUrl, "utf8");
  const sql = normalizeSql(source);

  assert.match(sql, /'observation_booking'.*'observation_reminder'/s);
  assert.match(sql, /add column observation_id uuid/);
  assert.match(sql, /unique.*observation_id.*message_kind.*source_revision/s);
  const observationLock = uniqueIndexBlock(
    source,
    "ops_reg_customer_msg_observation_revision_once_idx",
  );
  assert.match(
    observationLock,
    /where\s+message_kind\s+in\s*\(\s*'observation_booking'\s*,\s*'observation_reminder'\s*\)\s*;/i,
  );
  assert.doesNotMatch(observationLock, /\bor\b/i);
  assert.match(sql, /automatic_delivery_cutoff_at timestamptz/);
  assert.match(
    sql,
    /\('observation_booking', 'off'\).*\('observation_reminder', 'off'\)/s,
  );

  const cutoff = functionBlock(
    source,
    "dashboard_private.set_registration_customer_solapi_cutoff_v1",
  );
  assert.match(cutoff, /security invoker/);
  assert.doesNotMatch(cutoff, /security definer/);
  assert.doesNotMatch(sql, /update .* mode = 'live'|provider_attempt_count = 1/);
});

test("SOLAPI contract fails closed on the exact observation event producer", async () => {
  const sql = normalizeSql(await readFile(contractMigrationUrl, "utf8"));

  assert.match(sql, /dashboard_private\.registration_observation_domain_events/);
  assert.match(sql, /registration_observation_solapi_dependency_missing/);
  assert.match(
    sql,
    /create temporary table registration_observation_solapi_expected_event_kind_gate/,
  );
  assert.match(
    sql,
    /v_event_kind_constraint.*is distinct from.*v_expected_event_kind_constraint/s,
  );
  for (const eventKind of [
    "observation_scheduled",
    "observation_rescheduled",
    "observation_canceled",
    "observation_attendance_recorded",
    "observation_no_show",
    "observation_feedback_submitted",
  ]) {
    assert.match(sql, new RegExp(`'${eventKind}'`));
  }
});
