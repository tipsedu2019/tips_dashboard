import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"

export const UUID_PROTOCOL_SIGNATURES = Object.freeze([
  "dashboard_private.finalize_registration_track_enrollments_v1(uuid,uuid)",
  "dashboard_private.apply_registration_current_class_wait(uuid,uuid,uuid,uuid)",
  "dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)",
  "dashboard_private.cancel_registration_admission_batch_impl(uuid,jsonb,text,text)",
  "dashboard_private.complete_registration_admission_batch_impl(uuid,text)",
  "dashboard_private.cancel_registration_enrollment_impl(uuid,text,text,uuid,text,text)",
  "dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid,text)",
  "dashboard_private.complete_ops_transfer_roster_transition_impl(uuid,text)",
  "dashboard_private.apply_scheduled_withdrawal_roster_release_v1(uuid)",
])

export const sourceHash = (value) => createHash("sha256").update(value).digest("hex")
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const TRANSFER_COMPLETION_PR126_SOURCE = Object.freeze({
  migration: "20261009065550_transfer_completion_preexcluded_rosters.sql",
  migrationSha256: "59ca0b65f1d0873b29040afb34551e1d58071291e222e9cc51cd4fbd6ce38099",
  priorCatalogDefinitionMd5: "f5ae6b686d5ab30065b2409096bd0c30",
  priorBodySha256: "4d3a441fcabfbef2f8e62886923c63f80cf8fa4c5785a2697f3a5ed35eb6cfe5",
  finalBodySha256: "d4cebfecb6727afb7f714836d382ab530f9c7d419fba5f763f88cf03aafe4a8c",
})

/** Reconstruct PR126's first DO only. Catalog MD5 is an input source pin, not a runtime claim. */
export function applyPr126TransferCompletionSource(body, source) {
  const pin = TRANSFER_COMPLETION_PR126_SOURCE
  assert.equal(sourceHash(source), pin.migrationSha256, "PR126: reviewed full migration source")
  assert.equal(sourceHash(body), pin.priorBodySha256, "PR126: exact ordered body before dynamic patch")
  const section = source.match(/do \$transfer_completion\$([\s\S]*?)\$transfer_completion\$;/u)?.[1]
  assert.ok(section, "PR126: isolated transfer completion DO")
  assert.ok(section.includes("'dashboard_private.complete_ops_transfer_roster_transition_impl(uuid,text)'::regprocedure"), "PR126: exact target")
  assert.ok(section.includes(`pg_catalog.md5(definition) <> '${pin.priorCatalogDefinitionMd5}'`), "PR126: catalog definition guard retained in source")
  const conflicts = [
    ["ops_transfer_completion_state_conflict", 3], ["ops_transfer_checklist_incomplete", 1],
    ["registration_student_reactivation_required", 1], ["registration_roster_mode_conflict", 2],
    ["registration_student_class_already_active", 1], ["registration_open_admission_batch", 1],
  ]
  const listed = section.match(/foreach business_message in array array\[([^\]]+)\]/u)?.[1]
  assert.ok(listed, "PR126: explicit business label list")
  assert.deepEqual([...listed.matchAll(/'([^']+)'/gu)].map((match) => match[1]), conflicts.map(([message]) => message), "PR126: six business labels")
  for (const [message, count] of conflicts) {
    const old = `raise exception '${message}' using errcode = '40001'`
    assert.equal(body.split(old).length - 1, count, `PR126: ${message} exact old raise count`)
    body = body.replaceAll(old, `raise exception '${message}' using errcode = '23514'`)
  }
  const pairs = [...section.matchAll(/anchor := \$anchor\$([\s\S]*?)\$anchor\$;\s*replacement := \$replacement\$([\s\S]*?)\$replacement\$;/gu)]
  assert.equal(pairs.length, 10, "PR126: ten exact ordered transfer anchors")
  for (const [index, pair] of pairs.entries()) body = replaceOne(body, pair[1], pair[2], `PR126: transfer anchor ${index + 1}`)
  assert.equal(sourceHash(body), pin.finalBodySha256, "PR126: exact reconstructed final body")
  return body
}

export function replaceOne(source, before, after, description) {
  assert.ok(before.length > 0, `${description}: nonempty anchor`)
  assert.equal(source.split(before).length - 1, 1, `${description}: exactly one anchor`)
  return source.replace(before, after)
}

// Read literal SQL concatenations without evaluating SQL or calling a database.
function literalAssignment(source, variable) {
  const start = new RegExp(`\\b${escapeRegex(variable)}(?:\\s+text)?\\s*:=\\s*`, "u").exec(source)
  assert.ok(start, `literal assignment ${variable}`)
  let at = start.index + start[0].length
  let result = ""
  while (at < source.length) {
    if (/\s/u.test(source[at])) { at++; continue }
    if (source.slice(at, at + 2) === "||") { at += 2; continue }
    if (source[at] === ";") return result
    const dollar = /^\$[A-Za-z0-9_]*\$/u.exec(source.slice(at))
    if (dollar) {
      const end = source.indexOf(dollar[0], at + dollar[0].length)
      assert.notEqual(end, -1, `closed literal ${variable}`)
      result += source.slice(at + dollar[0].length, end)
      at = end + dollar[0].length
      continue
    }
    if (source[at] === "'") {
      at++
      while (at < source.length) {
        if (source[at] !== "'") { result += source[at++]; continue }
        if (source[at + 1] === "'") { result += "'"; at += 2; continue }
        at++
        break
      }
      continue
    }
    assert.fail(`nonliteral SQL expression in ${variable}`)
  }
  assert.fail(`unterminated assignment ${variable}`)
}

/** Ordered source reconstruction only. This is NOT a PostgreSQL catalog/runtime. */
export function readFinalUuidProtocolSources() {
  const root = new URL("../../supabase/migrations/", import.meta.url)
  const targets = new Map()
  for (const file of readdirSync(root).filter((name) => name.endsWith(".sql")).sort()) {
    const source = readFileSync(new URL(file, root), "utf8")
    for (const signature of UUID_PROTOCOL_SIGNATURES) {
      const name = signature.slice(0, signature.indexOf("("))
      const pattern = new RegExp(`create(?:\\s+or\\s+replace)?\\s+function\\s+${escapeRegex(name)}\\s*\\(([\\s\\S]*?)\\)\\s*returns\\b[\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$;`, "giu")
      const matches = [...source.matchAll(pattern)].map((match) => {
        const types = match[1].split(",").map((argument) => {
          const typed = argument.trim().match(/^[a-z_][a-z0-9_]*\s+(uuid(?:\[\])?|text|jsonb)(?:\s+default\s+null)?$/iu)
          assert.ok(typed, `${file}: supported named target argument`)
          return typed[1].toLowerCase()
        })
        return { declarationIdentity: `${name}(${types.join(",")})`, body: match[2] }
      }).filter((match) => match.declarationIdentity === signature)
      if (matches.length) targets.set(signature, { ...matches.at(-1), sources: [file] })
    }
    const mutate = (signature, apply) => {
      const current = targets.get(signature)
      assert.ok(current, `${file}: defined target ${signature}`)
      current.body = apply(current.body)
      current.sources.push(file)
    }
    const startSignature = "dashboard_private.start_registration_admission_batch_impl(uuid,uuid[],uuid[],text)"
    if (file === "20260803120000_registration_workflow_data_integrity.sql") {
      const section = source.slice(source.indexOf(`'${startSignature}'::regprocedure`))
      mutate(startSignature, (body) => replaceOne(body, literalAssignment(section, "v_old_fragment"),
        literalAssignment(section, "v_new_fragment"), file))
    }
    if (file === "20260824182043_registration_admission_order_independence.sql") {
      mutate(startSignature, (body) => {
        body = replaceOne(body, literalAssignment(source, "v_start_old_fragment"),
          literalAssignment(source, "v_start_new_fragment"), `${file}: notice independence`)
        const oldPipeline = literalAssignment(source, "v_start_pipeline_status_old_fragment")
        if (body.includes(oldPipeline)) body = replaceOne(body, oldPipeline,
          literalAssignment(source, "v_start_pipeline_status_new_fragment"), `${file}: manual status independence`)
        assert.equal(body.split("using errcode = '40001'").length - 1, 7, `${file}: seven business conflicts`)
        return body.replaceAll("using errcode = '40001'", "using errcode = '23514'")
      })
    }
    if (file === "20260922105632_registration_multiple_textbooks.sql") {
      const signature = "dashboard_private.finalize_registration_track_enrollments_v1(uuid,uuid)"
      const tuples = [...source.matchAll(new RegExp(`\\('${escapeRegex(signature)}', \\$old\\$([\\s\\S]*?)\\$old\\$, \\$new\\$([\\s\\S]*?)\\$new\\$\\)`, "gu"))]
      assert.equal(tuples.length, 2, `${file}: finalizer textbook patches`)
      mutate(signature, (body) => tuples.reduce((value, tuple) => replaceOne(value, tuple[1], tuple[2], file), body))
    }
    const withdrawalSignature = "dashboard_private.complete_ops_withdrawal_roster_transition_impl(uuid,text)"
    if (file === "20261006090000_withdrawal_last_lesson_release.sql") {
      mutate(withdrawalSignature, (body) => replaceOne(body, literalAssignment(source, "v_anchor"),
        literalAssignment(source, "v_patch"), `${file}: last-lesson reservation`))
    }
    if (file === "20261007141548_withdrawal_completion_without_settlement.sql") {
      mutate(withdrawalSignature, (body) => {
        for (let number = 1; number <= 10; number++) {
          const old = source.match(new RegExp(`\\$anchor_${number}\\$([\\s\\S]*?)\\$anchor_${number}\\$`, "u"))
          const next = source.match(new RegExp(`\\$patch_${number}\\$([\\s\\S]*?)\\$patch_${number}\\$`, "u"))
          assert.ok(old && next, `${file}: patch ${number}`)
          body = replaceOne(body, old[1].replaceAll("__legacy_sqlstate__", "40001"), next[1], `${file}: patch ${number}`)
        }
        for (const message of ["ops_withdrawal_completion_state_conflict", "registration_open_admission_batch"]) {
          body = body.replaceAll(`raise exception '${message}' using errcode = '40001';`,
            `raise exception '${message}' using errcode = '23514';`)
        }
        assert.equal(body.split("'40001'").length - 1, 2, `${file}: two actual rescans`)
        return body
      })
    }
    if (file === TRANSFER_COMPLETION_PR126_SOURCE.migration) {
      mutate("dashboard_private.complete_ops_transfer_roster_transition_impl(uuid,text)",
        (body) => applyPr126TransferCompletionSource(body, source))
    }
  }
  assert.equal(targets.size, UUID_PROTOCOL_SIGNATURES.length)
  return targets
}
