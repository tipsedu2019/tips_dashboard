import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const verifierUrl = new URL("../scripts/verify-domain-sqlstate-contract.mjs", import.meta.url)
const notificationClassifierModules = [
  [
    "../src/features/notifications/server/notification-worker.ts",
    "transientSupabaseRpcError",
    "isPlainRecord",
  ],
  [
    "../src/features/notifications/server/adapters/registration-observation-notification-source.ts",
    "transientSourceError",
    "isRecord",
  ],
  [
    "../src/features/notifications/server/adapters/registration-notification-adapter.ts",
    "transientSupabaseReadError",
    "isRecord",
  ],
]

function extractFunction(source, name) {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `missing ${name}`)
  const opening = source.indexOf("{", start)
  assert.notEqual(opening, -1, `missing ${name} body`)

  let depth = 0
  let quote = null
  let escaped = false
  for (let index = opening; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character
      continue
    }
    if (character === "{") depth += 1
    if (character === "}") {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  assert.fail(`unterminated ${name} body`)
}

async function loadClassifier(relativePath, name, recordHelperName) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8")
  const declaration = extractFunction(source, name)
    .replace(`function ${name}(value: unknown)`, `function ${name}(value)`)
  const recordHelper = (value) => (
    typeof value === "object" && value !== null && !Array.isArray(value)
  )
  return new Function(recordHelperName, `return (${declaration})`)(recordHelper)
}

async function loadDomainSqlstateVerifier() {
  return import(verifierUrl)
}

test("new active migrations reject explicit 40001 raises with a stable diagnostic", async () => {
  const { inspectDomainSqlstateMigration } = await loadDomainSqlstateVerifier()
  const violations = inspectDomainSqlstateMigration({
    file: "supabase/migrations/20260821000000_registration_domain_state.sql",
    cutoff: "20260820000000",
    source: [
      "begin;",
      "create or replace function public.example() returns void language plpgsql as $$",
      "begin",
      "  raise exception 'registration_invalid_source_state' using errcode = '40001';",
      "end;",
      "$$;",
      "commit;",
    ].join("\n"),
  })

  assert.deepEqual(
    violations.map(({ reason }) => reason),
    ["domain_sqlstate_40001_forbidden"],
  )

  const directSqlstateViolations = inspectDomainSqlstateMigration({
    file: "supabase/migrations/20260821000001_registration_direct_sqlstate.sql",
    cutoff: "20260820000000",
    source: [
      "begin;",
      "create or replace function public.direct_example() returns void language plpgsql as $$",
      "begin",
      "  raise sqlstate '40001' using message = 'registration_invalid_source_state';",
      "end;",
      "$$;",
      "commit;",
    ].join("\n"),
  })
  assert.deepEqual(
    directSqlstateViolations.map(({ reason }) => reason),
    ["domain_sqlstate_40001_forbidden"],
  )
})

test("pre-cutoff explicit 40001 raises remain grandfathered", async () => {
  const { inspectDomainSqlstateMigration } = await loadDomainSqlstateVerifier()
  const source = await readFile(
    new URL(
      "../supabase/migrations/20260819103434_registration_appointment_integrity_guard.sql",
      import.meta.url,
    ),
    "utf8",
  )
  const violations = inspectDomainSqlstateMigration({
    file: "supabase/migrations/20260819103434_registration_appointment_integrity_guard.sql",
    cutoff: "20260820000000",
    source,
  })

  assert.deepEqual(violations, [])
})

test("40001 handlers remain allowed while new 23514 and P0001 domain raises remain valid", async () => {
  const { inspectDomainSqlstateMigration } = await loadDomainSqlstateVerifier()
  const handlerViolations = inspectDomainSqlstateMigration({
    file: "supabase/migrations/20260821000001_handler.sql",
    cutoff: "20260820000000",
    source: [
      "begin",
      "  perform public.do_work();",
      "exception",
      "  when sqlstate '40001' then",
      "    return;",
      "end;",
    ].join("\n"),
  })
  const domainRaiseViolations = inspectDomainSqlstateMigration({
    file: "supabase/migrations/20260821000002_domain.sql",
    cutoff: "20260820000000",
    source: [
      "raise exception 'registration_invalid_source_state' using errcode = '23514';",
      "raise exception 'registration_invalid_source_state' using errcode = 'P0001';",
    ].join("\n"),
  })

  assert.deepEqual(handlerViolations, [])
  assert.deepEqual(domainRaiseViolations, [])
})

async function loadWithdrawalWorkerMigration() {
  const { WITHDRAWAL_CONCURRENCY_MIGRATION } = await loadDomainSqlstateVerifier()
  const source = await readFile(new URL(`../${WITHDRAWAL_CONCURRENCY_MIGRATION}`, import.meta.url), "utf8")
  const start = source.indexOf("create function dashboard_private.apply_scheduled_withdrawal_roster_release_v1(")
  assert.notEqual(start, -1)
  const bodyStart = source.indexOf("$$", start)
  const end = source.indexOf("$$;", bodyStart + 2)
  assert.notEqual(end, -1)
  return { file: WITHDRAWAL_CONCURRENCY_MIGRATION, source, worker: source.slice(start, end + 3) }
}

test("withdrawal worker allows only its two locked-rescan concurrency raises", async () => {
  const { inspectDomainSqlstateMigration } = await loadDomainSqlstateVerifier()
  const { file, source } = await loadWithdrawalWorkerMigration()
  assert.deepEqual(inspectDomainSqlstateMigration({ file, source }), [])
  // Formatting and comments are not policy: quoted messages and regex content
  // remain unchanged, while SQL token case and inter-token spaces can vary.
  const formatted = source
    .replace("create function dashboard_private.apply_scheduled_withdrawal_roster_release_v1", "CREATE FUNCTION dashboard_private.apply_scheduled_withdrawal_roster_release_v1")
    .replaceAll("using errcode='40001'", "USING errcode = '40001'")
    .replace("if v_current_parent_ids is distinct from v_pre_parent_ids then", "IF v_current_parent_ids IS DISTINCT FROM v_pre_parent_ids THEN -- concurrency guard")
  assert.deepEqual(inspectDomainSqlstateMigration({ file, source: formatted }), [])
})

test("withdrawal concurrency allowance rejects another file or function declaration", async () => {
  const { inspectDomainSqlstateMigration } = await loadDomainSqlstateVerifier()
  const { file, worker } = await loadWithdrawalWorkerMigration()
  for (const [label, candidateFile, source] of [
    ["another migration", file.replace("090000", "090001"), worker],
    ["another directory", `other/${file}`, worker],
    ["another function", file, worker.replace("apply_scheduled_withdrawal_roster_release_v1", "another_worker")],
    ["another schema", file, worker.replace("function dashboard_private.", "function public.")],
    ["another argument", file, worker.replace("(p_task_id uuid)", "(p_other_id uuid)")],
    ["changed lock timeout", file, worker.replace("lock_timeout='5s'", "lock_timeout='10s'")],
  ]) {
    assert.equal(inspectDomainSqlstateMigration({ file: candidateFile, source }).length, 2, label)
  }
})

test("withdrawal concurrency allowance rejects changed guards, messages, and domain raises", async () => {
  const { inspectDomainSqlstateMigration } = await loadDomainSqlstateVerifier()
  const { file, worker } = await loadWithdrawalWorkerMigration()
  for (const [label, source] of [
    ["changed identity comparison", worker.replace("is distinct from v_name_key", "= v_name_key")],
    ["changed identity regex", worker.replace("elsif pg_catalog.lower(pg_catalog.regexp_replace(coalesce(v_student.name,''),'\\s+'", "elsif pg_catalog.lower(pg_catalog.regexp_replace(coalesce(v_student.name,''),'\\s*'")],
    ["changed identity row lock", worker.replace("where id=v_release.student_id for update;", "where id=v_release.student_id;")],
    ["changed parent comparison", worker.replace("v_current_parent_ids is distinct from v_pre_parent_ids", "v_current_parent_ids = v_pre_parent_ids")],
    ["changed parent scan", worker.replace("into v_current_parent_ids from", "into v_wrong_parent_ids from")],
    ["changed error message", worker.replace("'registration_workflow_retry_required'", "'registration_invalid_source_state'")],
    ["unguarded domain conflict", worker.replace("'withdrawal_release_student_status_conflict' using errcode='23514'", "'withdrawal_release_student_status_conflict' using errcode='40001'")],
    ["unguarded identical retry message", worker.replace("'withdrawal_release_student_status_conflict' using errcode='23514'", "'registration_workflow_retry_required' using errcode='40001'")],
  ]) {
    assert.equal(inspectDomainSqlstateMigration({ file, source }).length, 1, label)
  }
})

test("withdrawal concurrency contexts cannot be copied outside or repeated inside the worker", async () => {
  const { inspectDomainSqlstateMigration } = await loadDomainSqlstateVerifier()
  const { file, worker } = await loadWithdrawalWorkerMigration()
  const foreignWorker = worker.replace("apply_scheduled_withdrawal_roster_release_v1", "another_worker")
  assert.equal(inspectDomainSqlstateMigration({ file, source: `${worker}\n${foreignWorker}` }).length, 2)
  assert.equal(inspectDomainSqlstateMigration({ file, source: `${worker}\n${worker}` }).length, 4)
  const parentStart = worker.indexOf("  select coalesce(pg_catalog.array_agg", worker.indexOf("raise exception 'registration_workflow_retry_required'"))
  const parentEnd = worker.indexOf("  end if;", parentStart) + "  end if;".length
  assert.ok(parentStart > 0 && parentEnd > parentStart)
  const parentContext = worker.slice(parentStart, parentEnd)
  const repeated = worker.replace(parentContext, `${parentContext}\n${parentContext}`)
  assert.equal(inspectDomainSqlstateMigration({ file, source: repeated }).length, 1)
  const quoted = worker.replace(parentContext, `  perform $guard$${parentContext}$guard$;`)
  assert.equal(inspectDomainSqlstateMigration({ file, source: quoted }).length, 1)
  // Dollar-quoted outer SQL is skipped as a whole, so an embedded declaration
  // in an unrelated function cannot acquire the target function's allowance.
  const embedded = `create function public.outer_worker() returns void language plpgsql as $outer$\n${worker}\n$outer$;`
  assert.equal(inspectDomainSqlstateMigration({ file, source: embedded }).length, 2)
})

test("notification transient classifiers do not retry bare 40001 domain errors", async () => {
  for (const [relativePath, name, recordHelperName] of notificationClassifierModules) {
    const classify = await loadClassifier(relativePath, name, recordHelperName)
    assert.equal(
      classify({ code: "40001", message: "registration_invalid_source_state" }),
      false,
      `${name} must not classify a domain-state 40001 as transient`,
    )
    assert.equal(
      classify({ code: "40001", message: "serialization_failure" }),
      true,
      `${name} must preserve the explicit serialization_failure transient condition`,
    )
    assert.equal(
      classify({ code: "40001", message: "could not serialize access due to concurrent update" }),
      true,
      `${name} must preserve PostgreSQL serialization failures as transient`,
    )
  }
})

test("final-schema pgTAP enforces exact owner, empty search path, ACL rows, and denial mutations", async () => {
  const source = await readFile(
    new URL("../supabase/tests/active_registration_workflow_sqlstate_contract_test.sql", import.meta.url),
    "utf8",
  )
  assert.match(source, /select plan\(30\);/u)
  assert.equal(
    [...source.matchAll(/^select (?:ok|is|like|unlike|results_eq)\(/gmu)].length,
    30,
  )
  assert.match(source, /pg_catalog\.aclexplode\(\s*coalesce\(\s*procedure\.proacl,\s*pg_catalog\.acldefault\('f', procedure\.proowner\)\s*\)\s*\)/u)
  assert.match(source, /pg_catalog\.pg_get_userbyid\(acl\.grantee\)/u)
  assert.match(source, /when acl\.grantee = 0 then 'PUBLIC'/u)
  assert.match(source, /array\['search_path=', 'search_path=""'\]/u)
  for (const role of ["public", "anon", "service_role"]) {
    assert.match(source, new RegExp(`has_function_privilege\\('${role}'`, "u"))
  }
  for (const mutation of [
    "public execute grant",
    "anon execute grant",
    "wrapper owner drift",
    "wrapper search path drift",
  ]) {
    assert.match(source, new RegExp(`rejects ${mutation}`, "u"))
  }
  assert.match(source, /savepoint public_execute_grant_mutation;/u)
  assert.match(source, /savepoint anon_execute_grant_mutation;/u)
  assert.match(source, /savepoint wrapper_owner_mutation;/u)
  assert.match(source, /savepoint wrapper_search_path_mutation;/u)
  assert.match(source, /create function pg_temp\.postdeploy_null_proconfig_boundary\(\)/u)
  assert.match(
    source,
    /\(\s*pg_catalog\.cardinality\(procedure\.proconfig\) = 1\s*and procedure\.proconfig\[1\] in \('search_path=', 'search_path=""'\)\s*\) is distinct from true/iu,
  )
  assert.match(source, /rejects NULL proconfig/u)
})
