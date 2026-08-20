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
