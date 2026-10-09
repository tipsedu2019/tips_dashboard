import { createHash } from "node:crypto"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { resolve, relative, isAbsolute } from "node:path"
import { pathToFileURL } from "node:url"
import { stripMigrationTransaction } from "./build-supabase-transactional-preflight.mjs"

export const contactReleaseInputs = Object.freeze([
  "supabase/migrations/20261004140438_registration_scheduled_index_online.sql",
  "supabase/migrations/20261004140440_registration_free_recording.sql",
  "docs/security/sql/student-contact-privacy-audit-link-draft.sql",
  "docs/security/sql/registration-contact-lifecycle-integration-draft.sql",
  "docs/security/sql/registration-student-uuid-copy-boundary-draft.sql",
  "docs/security/sql/registration-contact-message-fence-draft.sql",
  "docs/security/sql/student-contact-reader-minimization-draft.sql",
  "docs/security/sql/registration-contact-event-reader-draft.sql",
  "docs/security/sql/registration-contact-runtime-acl-activation-proposal.sql",
  "docs/security/sql/registration-contact-runtime-acl-deactivation-proposal.sql",
  "docs/security/sql/student-contact-master-nullification-proposal.sql",
])

const sha = (value) => createHash("sha256").update(value).digest("hex")
const assert = (condition, code) => { if (!condition) throw new Error(code) }

// This builder has no DB, credentials, subprocess, or deployment access.
// An independently reviewed, immutable manifest supplies the input pins.
export async function buildContactPrivacyRelease({ repoRoot, manifest }) {
  assert(manifest?.projectRef === "slnjqlzzhewblvttiidk", "contact_release_project_mismatch")
  assert(/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? ""), "contact_release_commit_missing")
  assert(Array.isArray(manifest.inputs) && manifest.inputs.length === contactReleaseInputs.length,
    "contact_release_input_count_mismatch")
  assert(manifest.inputs.every((item, index) => item.path === contactReleaseInputs[index]
    && /^[a-f0-9]{64}$/.test(item.sha256 ?? "")), "contact_release_input_order_or_pin_invalid")
  const sources = []
  for (const item of manifest.inputs) {
    const path = resolve(repoRoot, item.path)
    const rel = relative(resolve(repoRoot), path)
    assert(!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"), "contact_release_path_outside_repo")
    const source = await readFile(path, "utf8")
    assert(sha(source) === item.sha256, "contact_release_input_hash_mismatch")
    sources.push(source)
  }
  const sections = sources.slice(2, 9).map((source, offset) => {
    // Only the reviewed, exact outer envelope may be removed. The shared SQL
    // lexer rejects nested transaction controls and psql escapes, and preserves
    // function/DO/string bodies. Native concurrent PR96 files never enter here.
    const body = stripMigrationTransaction(source, { requireOuter: true })
    const item = manifest.inputs[offset + 2]
    return `-- exact input ${item.path} SHA256 ${item.sha256}\n${body}`
  })
  const atomicSql = [
    "-- GENERATED REVIEW CANDIDATE. Application requires separate exact-scope approval.",
    "-- Privacy six installers and narrow runtime ACL activation share ONE transaction.",
    "-- PR96 online/core migration and their native ledger commits are separate.",
    "begin;",
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '120s';",
    "do $contact_release_lock$ begin if current_user <> 'postgres' then raise exception 'contact_release_owner_required' using errcode='55000'; end if; if not pg_catalog.pg_try_advisory_xact_lock(20261009,160000) then raise exception 'contact_release_executor_busy' using errcode='55P03'; end if; end $contact_release_lock$;",
    ...sections,
    "commit;",
    "",
  ].join("\n")
  return {
    atomicSql,
    recoverySql: sources[9],
    masterNullificationSql: sources[10],
    receipt: {
      sourceCommit: manifest.sourceCommit,
      sourceTree: manifest.sourceTree ?? null,
      projectRef: manifest.projectRef,
      inputs: manifest.inputs,
      outputs: [
        { path: "registration-contact-privacy-atomic.sql", sha256: sha(atomicSql) },
        { path: "registration-contact-runtime-acl-deactivation.sql", sha256: sha(sources[9]) },
        { path: "student-contact-master-nullification.sql", sha256: sha(sources[10]) },
      ],
      executionOrder: ["readonly_catalog_and_full_ledger", "native_cli_2.115.0_pr96_pair_skip_vault", "readonly_pr96_after_catalog", "privacy_atomic_and_runtime_acl", "readonly_final_catalog", "approved_exact_application_release", "separately_approved_master_phone_nullification", "count_and_open_registration_purpose_verification"],
      exactAfterAction: "noop_without_sql_or_dml",
      mixedOrDriftAction: "stop_keep_registration_writes_and_dispatch_paused",
      recovery: "revoke_new_capabilities_only_preserve_phone_nulls_privacy_v3_receipts_and_business_facts",
      operatingExecution: false,
      masterNullificationScope: { table: "public.students", fields: ["contact", "parent_contact"], rows: "all_rows_where_either_field_is_non_null", registrationParentPhone: "preserved", historicalPurge: false, irreversible: true },
    },
  }
}

async function main() {
  const args = process.argv.slice(2)
  assert(args.length === 4 && args[0] === "--manifest" && args[2] === "--output", "contact_release_builder_arguments_invalid")
  const manifest = JSON.parse(await readFile(resolve(args[1]), "utf8"))
  const result = await buildContactPrivacyRelease({ repoRoot: process.cwd(), manifest })
  const output = resolve(args[3])
  await mkdir(output, { recursive: true })
  // Never silently replace previously frozen delivery inputs or outputs.
  await writeFile(resolve(output, "registration-contact-privacy-atomic.sql"), result.atomicSql, { flag: "wx" })
  await writeFile(resolve(output, "registration-contact-runtime-acl-deactivation.sql"), result.recoverySql, { flag: "wx" })
  await writeFile(resolve(output, "student-contact-master-nullification.sql"), result.masterNullificationSql, { flag: "wx" })
  await writeFile(resolve(output, "release-sql-receipt.json"), `${JSON.stringify(result.receipt, null, 2)}\n`, { flag: "wx" })
  process.stdout.write(`${JSON.stringify(result.receipt)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })
}
