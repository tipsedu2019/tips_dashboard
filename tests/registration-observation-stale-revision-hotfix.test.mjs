import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceMigrationUrl = new URL(
  "../supabase/migrations/20260809102000_registration_observation_booking.sql",
  import.meta.url,
);
const hotfixMigrationUrl = new URL(
  "../supabase/migrations/20260901110000_registration_observation_stale_revision_nonretryable.sql",
  import.meta.url,
);

function functionDefinition(sql, qualifiedName) {
  const start = sql.toLowerCase().indexOf(`create or replace function ${qualifiedName}`);
  assert.notEqual(start, -1, `${qualifiedName} definition must exist`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${qualifiedName} definition must terminate with $$;`);
  return sql.slice(start, end + 4);
}

function normalizeSql(sql) {
  return sql.trim().replace(/\s+/gu, " ").toLowerCase();
}

test("observation stale-revision hotfix changes only the enter RPC SQLSTATE", async () => {
  const [sourceMigration, hotfixMigration] = await Promise.all([
    readFile(sourceMigrationUrl, "utf8"),
    readFile(hotfixMigrationUrl, "utf8"),
  ]);

  const sourceImpl = normalizeSql(
    functionDefinition(sourceMigration, "dashboard_private.enter_registration_observation_v1_impl"),
  );
  const hotfixImpl = normalizeSql(
    functionDefinition(hotfixMigration, "dashboard_private.enter_registration_observation_v1_impl"),
  );

  assert.match(
    hotfixImpl,
    /raise exception 'registration_observation_stale_revision' using errcode = '23514'/u,
  );
  assert.doesNotMatch(hotfixImpl, /errcode = '40001'/u);
  assert.equal(
    hotfixImpl.replace("errcode = '23514'", "errcode = '40001'"),
    sourceImpl,
    "the implementation must remain byte-equivalent after normalizing the one SQLSTATE change",
  );
});

test("observation stale-revision hotfix preserves owner, security, ACL, and public wrapper boundaries", async () => {
  const [sourceMigration, hotfixMigration] = await Promise.all([
    readFile(sourceMigrationUrl, "utf8"),
    readFile(hotfixMigrationUrl, "utf8"),
  ]);

  const sourceWrapper = normalizeSql(
    functionDefinition(sourceMigration, "public.enter_registration_observation_v1"),
  );
  const hotfixWrapper = normalizeSql(
    functionDefinition(hotfixMigration, "public.enter_registration_observation_v1"),
  );

  assert.equal(hotfixWrapper, sourceWrapper);
  assert.match(hotfixMigration, /^begin;\s*/iu);
  assert.match(hotfixMigration.trim(), /commit;$/iu);
  assert.match(
    hotfixMigration,
    /alter function dashboard_private\.enter_registration_observation_v1_impl\(uuid, integer, text\)\s+owner to postgres;/iu,
  );
  assert.match(
    hotfixMigration,
    /alter function public\.enter_registration_observation_v1\(uuid, integer, text\)\s+owner to postgres;/iu,
  );
  assert.match(
    hotfixMigration,
    /revoke all on function dashboard_private\.enter_registration_observation_v1_impl\(uuid, integer, text\)\s+from public, anon, authenticated, service_role;/iu,
  );
  assert.match(
    hotfixMigration,
    /grant execute on function dashboard_private\.enter_registration_observation_v1_impl\(uuid, integer, text\)\s+to authenticated;/iu,
  );
  assert.match(
    hotfixMigration,
    /revoke all on function public\.enter_registration_observation_v1\(uuid, integer, text\)\s+from public, anon, authenticated, service_role;/iu,
  );
  assert.match(
    hotfixMigration,
    /grant execute on function public\.enter_registration_observation_v1\(uuid, integer, text\)\s+to authenticated;/iu,
  );
});
