import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const normalize = (value) => value.replace(/\s+/gu, " ").trim()
const signature = /create(?: or replace)? function public\.claim_registration_customer_reminder_job_v1\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/giu

async function finalClaimSource() {
  const directory = new URL("supabase/migrations/", root)
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()
  const sources = new Map()
  let final = null
  for (const file of files) {
    const source = await readFile(new URL(file, directory), "utf8")
    sources.set(file, source)
    for (const match of source.matchAll(signature)) final = { file, body: match[1], source }
  }
  assert.ok(final, "the current producer definition must be present")
  for (const file of files.filter((file) => file > final.file)) {
    assert.equal(/pg_get_functiondef\([\s\S]{0,180}'public\.claim_registration_customer_reminder_job_v1\(\)'/u.test(sources.get(file)), false,
      `A later dynamic claim rewrite needs independent ordered-source review: ${file}`)
  }
  return final
}

test("ordered source keeps the actual reminder producer retired rather than the earlier August active loop", async () => {
  const current = await finalClaimSource()
  assert.equal(current.file, "20260901111200_registration_flat_fact_runtime_finalization.sql")
  assert.equal(normalize(current.body), "begin if (select auth.role()) <> 'service_role' then raise exception 'registration_customer_reminder_worker_unauthorized' using errcode = '42501'; end if; return null; end;")
  assert.doesNotMatch(current.body, /for v_job|update |provider|materialize/iu)
})

test("draft exact source preflight accepts the final retired body and rejects the historical active producer", async () => {
  const current = await finalClaimSource()
  const draft = await readFile(new URL("docs/security/sql/registration-contact-message-fence-draft.sql", root), "utf8")
  const literal = draft.match(/source_body is distinct from\s*'((?:[^']|'')*)'/u)?.[1]
  assert.ok(literal, "draft must explicitly pin the retired body before installation")
  const expected = literal.replace(/''/gu, "'")
  assert.equal(normalize(current.body), expected)
  const historical = await readFile(new URL("supabase/migrations/20260825090000_registration_customer_reminder_claim_final_gate.sql", root), "utf8")
  const oldBody = [...historical.matchAll(signature)].at(-1)?.[1]
  assert.ok(oldBody)
  assert.notEqual(normalize(oldBody), expected)
  assert.doesNotMatch(draft, /create(?: or replace)? function public\.claim_registration_customer_reminder_job_v1\(/iu,
    "candidate must preserve the retired producer rather than resurrect an earlier claim loop")
  assert.doesNotMatch(draft, /grant execute/iu, "installation capabilities remain withheld")
})

test("source regression: SQL whitespace collapse precedes space-only btrim for the actual newline-delimited retired body", async () => {
  const current = await finalClaimSource()
  const draft = await readFile(new URL("docs/security/sql/registration-contact-message-fence-draft.sql", root), "utf8")
  const literal = draft.match(/source_body is distinct from\s*'((?:[^']|'')*)'/u)?.[1]
  assert.ok(literal)
  const expected = literal.replace(/''/gu, "'")
  assert.ok(draft.includes("select btrim(regexp_replace(p.prosrc,'\\s+',' ','g')),pg_get_userbyid(p.proowner)"),
    "Postgres btrim removes spaces by default, so newline/tab collapse must run first")
  const postgresBtrim = (value) => value.replace(/^ +| +$/gu, "")
  const previousOrder = (value) => postgresBtrim(value).replace(/\s+/gu, " ")
  const correctedOrder = (value) => postgresBtrim(value.replace(/\s+/gu, " "))
  assert.match(current.body, /^\n[\s\S]*\n$/u, "the actual ordered source contains newline edges")
  assert.notEqual(previousOrder(current.body), expected, "the old order rejects the genuine retired body")
  for (const body of [current.body, `\n\t${expected}\r\n`, `  \n${expected}\t  `, expected]) {
    assert.equal(correctedOrder(body), expected)
  }
  assert.notEqual(correctedOrder(current.body.replace("return null;", "return true;")), expected,
    "whitespace compatibility must not accept a changed producer meaning")
  assert.match(draft, /if owner_name<>'postgres' or source_body is distinct from/u)
  assert.match(draft, /contact_retired_reminder_source_review_required' using errcode='55000'/u)
})
