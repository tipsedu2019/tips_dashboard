import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import ts from "typescript"

import {
  REGISTRATION_RPC_CALL_SITES as CALL_SITES,
  REGISTRATION_RPC_SOURCE_DEPENDENCIES as DEPENDENCIES,
  REGISTRATION_RPC_SOURCE_MANIFEST as SOURCE_MANIFEST,
  registrationRpcMigrationClosureHash,
  registrationRpcSourceHash,
  verifyRegistrationRpcSourceClosure,
} from "../src/lib/registration-rpc-source-contract.js"
import { inspectQuerySurfaceSource, verifyQuerySurfaceBudget } from "../src/lib/query-surface-budget.js"

// Capture one source-only snapshot. No provider, SQL execution or live account
// participates in these tests; fixture Git operations stay inside owned /tmp.
const repository = fileURLToPath(new URL("../", import.meta.url))
const sources = new Map(await Promise.all(DEPENDENCIES.map(async file =>
  [file, await readFile(join(repository, file), "utf8")])))
const migrationFiles = (await readdir(join(repository, "supabase/migrations")))
  .filter(file => file.endsWith(".sql")).sort().map(file => "supabase/migrations/" + file)
const migrations = await Promise.all(migrationFiles.map(async file =>
  [file, await readFile(join(repository, file), "utf8")]))

function manifestFor(snapshot = sources, orderedMigrations = migrations) {
  return {
    version: 1, assurance: "reviewed-source-contract-only",
    databaseRuntimeVerified: false, sqlApplied: false,
    sourceHashes: Object.fromEntries(DEPENDENCIES.map(file =>
      [file, registrationRpcSourceHash(snapshot.get(file))])),
    migrationClosure: {
      count: orderedMigrations.length,
      sha256: registrationRpcMigrationClosureHash(orderedMigrations),
    },
    contracts: CALL_SITES.map(site => ({ ...site })),
  }
}
const reviewedManifest = manifestFor()

function closure(snapshot = sources, manifest = manifestFor(snapshot), orderedMigrations = migrations) {
  return verifyRegistrationRpcSourceClosure({ manifest, sources: snapshot, migrations: orderedMigrations })
}
function proven(snapshot = sources) {
  const verified = closure(snapshot)
  assert.deepEqual(verified.reasons, [], "the reviewed source snapshot must establish a proof")
  assert.ok(verified.proof)
  return verified.proof
}
function inspect(site, snapshot = sources, proof = proven(snapshot), file = site.file, symbol = site.symbol) {
  return inspectQuerySurfaceSource({
    surface: "tasks", file, source: snapshot.get(site.file), registrationProof: proof,
  }).filter(violation => violation.symbol === symbol)
}
function reasons(site, snapshot, proof, file, symbol) {
  return inspect(site, snapshot, proof, file, symbol).map(violation => violation.reason)
}
function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, "mutation must hit one actual source boundary")
  return source.replace(before, after)
}
function changeFunction(site, transform) {
  const source = sources.get(site.file)
  const parsed = ts.createSourceFile(site.file, source, ts.ScriptTarget.Latest, true)
  const matches = parsed.statements.filter(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === site.symbol)
  assert.equal(matches.length, 1)
  const node = matches[0]
  const start = node.getStart(parsed)
  const changed = transform(source.slice(start, node.end), node.body.getStart(parsed) - start)
  assert.notEqual(changed, source.slice(start, node.end))
  const snapshot = new Map(sources)
  snapshot.set(site.file, source.slice(0, start) + changed + source.slice(node.end))
  return snapshot
}
const fenceSite = CALL_SITES.find(site => site.symbol === "readBundleContactFence")
const guard = (kind, site) => "assertRegistrationNonpageableRpc" + kind + '("' + site.rpc + '", ' +
  (kind === "Arguments" ? "args)" : "result.data, args)")
function expectSiteRejection(site, snapshot, expected, symbol = site.symbol) {
  const diagnostics = reasons(site, snapshot, proven(snapshot), site.file, symbol)
  assert.ok(diagnostics.includes(expected), diagnostics.join(", "))
}

test("all four actual callers require a source proof and use nonpageable contracts without fake p_limit", () => {
  assert.equal(migrations.length, 389)
  const proof = proven()
  for (const site of CALL_SITES) {
    assert.deepEqual(inspect(site, sources, proof), [], site.symbol)
    const unproved = reasons(site, sources, null)
    assert.ok(unproved.includes("registration_rpc_contract_unverified"), site.symbol)
    assert.ok(unproved.includes("rpc_page_limit_missing"), site.symbol)
  }
  assert.equal(Object.keys(reviewedManifest.sourceHashes).length, DEPENDENCIES.length)
  assert.equal(reviewedManifest.databaseRuntimeVerified, false)
  assert.equal(reviewedManifest.sqlApplied, false)
})

test("opaque proofs cannot be forged, reused in another file, or borrowed by a different caller", () => {
  assert.ok(reasons(fenceSite, sources, {}).includes("registration_rpc_contract_unverified"))
  assert.ok(reasons(fenceSite, sources, proven(), "src/features/tasks/server/spoof.ts")
    .includes("registration_rpc_contract_caller_invalid"))
  const snapshot = changeFunction(fenceSite, source =>
    replaceOnce(source, "function " + fenceSite.symbol, "function spoofedCaller"))
  expectSiteRejection(fenceSite, snapshot, "registration_rpc_contract_caller_invalid", "spoofedCaller")
})

test("RPC name suffixes, dynamic names, const aliases and computed methods cannot inherit an exact contract", () => {
  const literal = 'client.rpc("' + fenceSite.rpc + '", args)'
  for (const replacement of [
    'client.rpc("' + fenceSite.rpc + '_other", args)',
    "client.rpc(untrustedRpcName, args)",
  ]) {
    const snapshot = changeFunction(fenceSite, source => replaceOnce(source, literal, replacement))
    expectSiteRejection(fenceSite, snapshot, "rpc_page_limit_missing")
  }
  const alias = changeFunction(fenceSite, (source, body) =>
    replaceOnce(source.slice(0, body + 1) + '\nconst rpcName = "' + fenceSite.rpc + '";' + source.slice(body + 1),
      literal, "client.rpc(rpcName, args)"))
  expectSiteRejection(fenceSite, alias, "registration_rpc_contract_entry_invalid")
  const computed = changeFunction(fenceSite, source =>
    replaceOnce(source, literal, 'client["rpc"]("' + fenceSite.rpc + '", args)'))
  expectSiteRejection(fenceSite, computed, "registration_rpc_contract_entry_invalid")
})

test("argument identity, spreads and fake p_limit cannot disguise a failed contextual contract", () => {
  const wrongTarget = changeFunction(fenceSite, source =>
    replaceOnce(source, "p_source_id: sourceId", "p_source_id: actorProfileId"))
  expectSiteRejection(fenceSite, wrongTarget, "registration_rpc_contract_argument_scope_invalid")
  for (const extra of ["...untrustedRequest,", "p_limit: 1,"]) {
    const snapshot = changeFunction(fenceSite, source =>
      replaceOnce(source, "const args = {", "const args = { " + extra))
    expectSiteRejection(fenceSite, snapshot, "registration_rpc_contract_arguments_invalid")
  }
  const fakeInlinePage = changeFunction(fenceSite, source =>
    replaceOnce(source, 'client.rpc("' + fenceSite.rpc + '", args)',
      'client.rpc("' + fenceSite.rpc + '", { p_limit: 1 })'))
  expectSiteRejection(fenceSite, fakeInlinePage, "registration_rpc_contract_arguments_invalid")
})

for (const [label, statement] of [
  ["target mutation", site => "args." +
    (site.rpc === "read_registration_contact_message_fence_v1" ? "p_source_id" : "p_task_id") + " = foreignTaskId;"],
  ["unknown helper escape", () => "mutateArgs(args);"],
  ["alias escape", () => "const escaped = args;"],
]) {
  test("validated args reject " + label + " before every actual RPC call", () => {
    for (const site of CALL_SITES) {
      const snapshot = changeFunction(site, source =>
        replaceOnce(source, guard("Arguments", site),
          guard("Arguments", site) + ";\n  " + statement(site)))
      expectSiteRejection(site, snapshot, "registration_rpc_contract_argument_scope_invalid")
    }
  })
}

test("missing, conditional and wrongly bound request/result validators fail closed", () => {
  for (const kind of ["Arguments", "Result"]) {
    const missing = changeFunction(fenceSite, source => replaceOnce(source, guard(kind, fenceSite), "void 0"))
    expectSiteRejection(fenceSite, missing, kind === "Arguments"
      ? "registration_rpc_contract_request_validation_missing" : "registration_rpc_contract_result_validation_missing")
    const conditional = changeFunction(fenceSite, source =>
      replaceOnce(source, guard(kind, fenceSite), "if (untrustedCondition) " + guard(kind, fenceSite)))
    expectSiteRejection(fenceSite, conditional, kind === "Arguments"
      ? "registration_rpc_contract_request_validation_missing" : "registration_rpc_contract_result_validation_missing")
  }
  const wrongResult = changeFunction(fenceSite, source =>
    replaceOnce(source, guard("Result", fenceSite), guard("Result", fenceSite).replace("result.data", "other.data")))
  expectSiteRejection(fenceSite, wrongResult, "registration_rpc_contract_result_validation_missing")
})

for (const kind of ["Arguments", "Result"]) {
  test(kind + " validator cannot be authorized through lazy short-circuit expressions", () => {
    const expected = kind === "Arguments"
      ? "registration_rpc_contract_request_validation_missing"
      : "registration_rpc_contract_result_validation_missing"
    for (const prefix of ["false && ", "true || ", "untrustedValue ?? "]) {
      const snapshot = changeFunction(fenceSite, source =>
        replaceOnce(source, guard(kind, fenceSite), prefix + guard(kind, fenceSite)))
      expectSiteRejection(fenceSite, snapshot, expected)
    }
  })
}

test("a successful RPC response cannot be returned before its result validator", () => {
  const snapshot = changeFunction(fenceSite, source =>
    replaceOnce(source, guard("Result", fenceSite),
      "return result;\n  " + guard("Result", fenceSite)))
  expectSiteRejection(fenceSite, snapshot, "registration_rpc_contract_result_validation_missing")
})

test("a copied validator import or a local no-op shadow cannot authorize a reviewed RPC", () => {
  const wrongImport = new Map(sources)
  wrongImport.set(fenceSite.file, replaceOnce(sources.get(fenceSite.file),
    '"../../../lib/registration-nonpageable-rpc-contract.js"', '"./local-no-op-validators.js"'))
  expectSiteRejection(fenceSite, wrongImport, "registration_rpc_contract_validator_import_missing")
  const shadow = changeFunction(fenceSite, (source, body) => source.slice(0, body + 1) +
    "\nconst assertRegistrationNonpageableRpcArguments = () => {};\n" +
    "const assertRegistrationNonpageableRpcResult = () => {};\n" + source.slice(body + 1))
  expectSiteRejection(fenceSite, shadow, "registration_rpc_contract_validator_shadowed")
})

test("all exact callers retain the independent eight-second and no-retry requirements", () => {
  for (const site of CALL_SITES) {
    for (const [before, after, expected] of [
      ["AbortSignal.timeout(8_000)", "AbortSignal.timeout(9_000)", "list_abort_signal_missing"],
      [".retry(false)", ".retry(true)", "list_retry_false_missing"],
      [".retry(false)", "", "list_retry_false_missing"],
    ]) {
      const snapshot = changeFunction(site, source => replaceOnce(source, before, after))
      expectSiteRejection(site, snapshot, expected)
    }
    const abort = site.rpc === "mutate_registration_contact_v1"
      ? ".abortSignal(AbortSignal.any([signal, AbortSignal.timeout(8_000)]))"
      : ".abortSignal(AbortSignal.timeout(8_000))"
    for (const replacement of ["", ".abortSignal(signal)"]) {
      const snapshot = changeFunction(site, source => replaceOnce(source, abort, replacement))
      expectSiteRejection(site, snapshot, "list_abort_signal_missing")
    }
  }
})

test("auth deletion is rejected even after rehashing the candidate source", () => {
  for (const [file, before] of [
    [CALL_SITES[0].file, "await options.auth.authenticate(request)"],
    [fenceSite.file, "await auth.authenticate(request)"],
    [CALL_SITES[3].file, "requireRole(context, OPERATOR_ROLES)"],
  ]) {
    const snapshot = new Map(sources)
    const original = snapshot.get(file)
    assert.ok(original.includes(before))
    snapshot.set(file, original.replaceAll(before, "void 0"))
    const verified = closure(snapshot)
    assert.equal(verified.proof, null)
    assert.ok(verified.reasons.includes("registration_rpc_contract_authorization_missing"), file)
  }
})

test("dependency omissions and source-only SQL drift invalidate proof issuance", () => {
  const missing = new Map(sources)
  missing.delete(DEPENDENCIES[0])
  const absent = closure(missing, reviewedManifest)
  assert.equal(absent.proof, null)
  assert.ok(absent.reasons.includes("registration_rpc_contract_dependency_missing"))
  const sql = "docs/security/sql/registration-contact-lifecycle-integration-draft.sql"
  const drift = new Map(sources)
  drift.set(sql, sources.get(sql) + "\n-- synthetic source-only drift\n")
  const changed = closure(drift, reviewedManifest)
  assert.equal(changed.proof, null)
  assert.ok(changed.reasons.includes("registration_rpc_contract_source_drift"))
  const weakened = new Map(sources)
  weakened.set(sql, replaceOnce(sources.get(sql),
    "octet_length(p_payload::text)>128000", "octet_length(p_payload::text)>999999"))
  const rehashed = closure(weakened)
  assert.equal(rehashed.proof, null)
  assert.ok(rehashed.reasons.includes("registration_rpc_contract_sql_scope_invalid"))
})

test("ordered migration content, removal and additions cannot reuse the reviewed SQL closure", () => {
  const drift = migrations.map(tuple => [...tuple])
  drift[0][1] += "\n-- synthetic migration drift\n"
  for (const candidate of [drift, migrations.slice(1),
    [...migrations, ["supabase/migrations/20990101010101_synthetic.sql", "select 1;"]]]) {
    const result = closure(sources, reviewedManifest, candidate)
    assert.equal(result.proof, null)
    assert.ok(result.reasons.includes("registration_rpc_contract_sql_drift"))
  }
  assert.equal(registrationRpcMigrationClosureHash([...migrations].reverse()),
    registrationRpcMigrationClosureHash(migrations), "closure hashes use migration path order")
})

test("source manifests cannot claim SQL application or database runtime verification", () => {
  for (const patch of [{ databaseRuntimeVerified: true }, { sqlApplied: true },
    { assurance: "database-runtime-verified" }, { contracts: CALL_SITES.slice(1) }]) {
    const result = closure(sources, { ...reviewedManifest, ...patch })
    assert.equal(result.proof, null)
    assert.deepEqual(result.reasons, ["registration_rpc_contract_manifest_invalid"])
  }
})

test("issued proof does not trust later mutations to the caller-owned source map", () => {
  const snapshot = new Map(sources)
  const proof = proven(snapshot)
  const changed = snapshot.get(fenceSite.file).replaceAll("await auth.authenticate(request)", "void 0")
  assert.notEqual(changed, snapshot.get(fenceSite.file))
  snapshot.set(fenceSite.file, changed)
  assert.ok(reasons(fenceSite, snapshot, proof).includes("registration_rpc_contract_source_drift"),
    "proof issuance must capture immutable reviewed sources")
})

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}
async function writeFixtureFile(root, file, content) {
  await mkdir(dirname(join(root, file)), { recursive: true })
  await writeFile(join(root, file), content)
}
function assertFourCallersBlocked(result) {
  assert.equal(result.ok, false)
  for (const site of CALL_SITES) {
    assert.ok(result.violations.some(violation => violation.file === site.file &&
      violation.symbol === site.symbol && violation.reason === "registration_rpc_contract_unverified"), site.symbol)
  }
  assert.equal(result.registrationSourceContract.assurance, "blocked")
  assert.equal(result.registrationSourceContract.databaseRuntimeVerified, false)
  assert.equal(result.registrationSourceContract.sqlApplied, false)
}

test("Git verifier rechecks unchanged callers for SQL-only, auth-only and migration-only worktree edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "registration-rpc-source-fixture-"))
  try {
    for (const [file, content] of [...sources, ...migrations]) await writeFixtureFile(root, file, content)
    await writeFixtureFile(root, SOURCE_MANIFEST, JSON.stringify(reviewedManifest, null, 2) + "\n")
    git(root, ["init", "--quiet"])
    git(root, ["config", "user.email", "source-contract@example.invalid"])
    git(root, ["config", "user.name", "Source contract fixture"])
    git(root, ["add", "."])
    git(root, ["commit", "--quiet", "-m", "synthetic reviewed source snapshot"])
    const baseSha = git(root, ["rev-parse", "HEAD"])
    const options = { root, surface: "tasks", baseSha, debtManifest: [] }
    const positive = await verifyQuerySurfaceBudget({ ...options, includeWorktree: true })
    assert.equal(positive.ok, true, JSON.stringify(positive.violations))
    assert.equal(positive.registrationSourceContract.callSiteCount, 4)
    assert.equal(positive.registrationSourceContract.assurance, "reviewed-source-contract-only")
    assert.equal(positive.registrationSourceContract.databaseRuntimeVerified, false)
    assert.equal(positive.registrationSourceContract.sqlApplied, false)
    const edits = [
      ["docs/security/sql/registration-contact-lifecycle-integration-draft.sql",
        sources.get("docs/security/sql/registration-contact-lifecycle-integration-draft.sql") + "\n-- synthetic SQL-only edit\n"],
      ["src/features/tasks/server/registration-customer-message-auth.ts",
        replaceOnce(sources.get("src/features/tasks/server/registration-customer-message-auth.ts"),
          "await actorClient.auth.getUser(token)", "{ data: { user: { id: token } }, error: null }")],
      [migrations[0][0], migrations[0][1] + "\n-- synthetic migration-only edit\n"],
    ]
    for (const [file, content] of edits) {
      const original = sources.get(file) ?? migrations.find(tuple => tuple[0] === file)[1]
      assert.notEqual(content, original)
      await writeFixtureFile(root, file, content)
      const changedPaths = git(root, ["diff", "--name-only"]).split("\n")
      assert.deepEqual(changedPaths, [file])
      assertFourCallersBlocked(await verifyQuerySurfaceBudget({ ...options, includeWorktree: true }))
      // The committed revision must not inherit a dirty worktree's proof.
      const committed = await verifyQuerySurfaceBudget({ ...options, headSha: baseSha })
      assert.equal(committed.ok, true, JSON.stringify(committed.violations))
      await writeFixtureFile(root, file, original)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
