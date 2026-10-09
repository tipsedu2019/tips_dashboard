import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"

export const STUDENT_CONTACT_READER_SIGNATURES = Object.freeze([
  "public.list_management_numbered_page_v1(text,jsonb,integer,integer,jsonb)",
  "public.list_management_page_v1(text,jsonb,text,uuid,integer)",
  "public.get_management_detail_v1(text,uuid)",
  "public.list_management_detail_relation_page_v1(text,uuid,text,text,uuid,integer)",
  "dashboard_private.ops_task_page_source_v1(text,jsonb)",
  "dashboard_private.ops_task_numbered_keys_v1(text,jsonb)",
  "dashboard_private.ops_task_numbered_project_v1(text,uuid[],uuid[])",
  "dashboard_private.ops_registration_task_stats_v1(jsonb)",
])
export const readerSourceHash = (value) => createHash("sha256").update(value).digest("hex")
export function replaceReaderSourceOnce(body, before, after, label) {
  assert.ok(before.length, `${label}: nonempty anchor`)
  assert.equal(body.split(before).length - 1, 1, `${label}: exact unique anchor`)
  return body.replace(before, after)
}
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// Parse SQL text literals only. Never evaluate PL/pgSQL or execute SQL.
export function readerSqlLiteral(source, offset = 0) {
  let at = offset
  while (/\s/u.test(source[at] ?? "")) at++
  const dollar = /^\$[A-Za-z0-9_]*\$/u.exec(source.slice(at))
  if (dollar) {
    const end = source.indexOf(dollar[0], at + dollar[0].length)
    assert.notEqual(end, -1, "closed SQL dollar literal")
    return { value: source.slice(at + dollar[0].length, end), end: end + dollar[0].length }
  }
  const escaped = source[at] === "E" || source[at] === "e"
  if (escaped) at++
  assert.equal(source[at++], "'", "SQL literal expression only")
  let value = ""
  while (at < source.length) {
    const character = source[at++]
    if (character === "'") {
      if (source[at] === "'") { value += "'"; at++; continue }
      return { value, end: at }
    }
    if (escaped && character === "\\") {
      const next = source[at++]
      assert.ok(["n", "r", "t", "\\", "'"].includes(next), "known SQL E escape")
      value += ({ n: "\n", r: "\r", t: "\t", "\\": "\\", "'": "'" })[next]
    } else value += character
  }
  assert.fail("unterminated SQL literal")
}
export function readerLiteralAssignment(source, variable) {
  const start = new RegExp(`\\b${escapeRegex(variable)}(?:\\s+text)?\\s*:=\\s*`, "u").exec(source)
  assert.ok(start, `SQL literal assignment ${variable}`)
  let at = start.index + start[0].length
  let value = ""
  while (at < source.length) {
    if (/\s/u.test(source[at])) { at++; continue }
    if (source.slice(at, at + 2) === "||") { at += 2; continue }
    if (source[at] === ";") return value
    const literal = readerSqlLiteral(source, at)
    value += literal.value; at = literal.end
  }
  assert.fail(`unterminated assignment ${variable}`)
}

/** Ordered source reconstruction; NOT a PostgreSQL catalog/runtime. */
export function readFinalStudentContactReaderSources() {
  const root = new URL("../../supabase/migrations/", import.meta.url)
  const pins = JSON.parse(readFileSync(new URL("../fixtures/student-contact-reader-source-pins.json", import.meta.url), "utf8"))
  const targets = new Map()
  for (const file of readdirSync(root).filter((name) => name.endsWith(".sql")).sort()) {
    const source = readFileSync(new URL(file, root), "utf8")
    const names = STUDENT_CONTACT_READER_SIGNATURES.map((signature) => signature.slice(0, signature.indexOf("(")))
    if (!names.some((name) => source.includes(name))) continue
    assert.equal(readerSourceHash(source), pins[file], `${file}: exact ordered input migration`)
    for (const signature of STUDENT_CONTACT_READER_SIGNATURES) {
      const name = signature.slice(0, signature.indexOf("("))
      const pattern = new RegExp(`create(?:\\s+or\\s+replace)?\\s+function\\s+${escapeRegex(name)}\\s*\\([\\s\\S]*?\\bas\\s+(\\$[A-Za-z0-9_]*\\$)([\\s\\S]*?)\\1;`, "giu")
      const matches = [...source.matchAll(pattern)]
      if (matches.length) targets.set(signature, { body: matches.at(-1)[2], sources: [file] })
    }
    const mutate = (signature, apply) => {
      const current = targets.get(signature)
      assert.ok(current, `${file}: defined ${signature}`)
      current.body = apply(current.body); current.sources.push(file)
    }
    const page = STUDENT_CONTACT_READER_SIGNATURES[1]
    const detail = STUDENT_CONTACT_READER_SIGNATURES[2]
    const relation = STUDENT_CONTACT_READER_SIGNATURES[3]
    if (file === "20260825152044_registration_admission_checklist_roster_consistency.sql") {
      mutate(page, (body) => replaceReaderSourceOnce(body, readerLiteralAssignment(source, "v_old_count_predicate"), readerLiteralAssignment(source, "v_new_count_predicate"), file))
      mutate(relation, (body) => {
        for (const pair of [["v_old_student_status", "v_new_student_status"], ["v_old_student_predicate", "v_new_student_predicate"]]) {
          body = replaceReaderSourceOnce(body, readerLiteralAssignment(source, pair[0]), readerLiteralAssignment(source, pair[1]), file)
        }
        return body
      })
    }
    if (file === "20260901110600_registration_subject_soft_archive.sql") {
      for (const signature of STUDENT_CONTACT_READER_SIGNATURES.slice(4, 6)) mutate(signature, (body) => {
        for (const pair of [["v_join_needle", "v_join_replacement"], ["v_where_needle", "v_where_replacement"]]) {
          body = replaceReaderSourceOnce(body, readerLiteralAssignment(source, pair[0]), readerLiteralAssignment(source, pair[1]), file)
        }
        return body
      })
    }
    if (file === "20260905064919_ops_task_parameter_sensitive_plans.sql") {
      for (const signature of STUDENT_CONTACT_READER_SIGNATURES.slice(4, 6)) mutate(signature, (body) =>
        "#variable_conflict use_column\nbegin\n  return query\n" + body.replace(/[ \t\n\r;]+$/u, "") + ";\nend;\n")
    }
    if (file === "20260921144020_student_enrollment_status.sql") {
      const sections = [...source.matchAll(/v_target := '([^']+)'::regprocedure;([\s\S]*?)(?=\n  v_target :=|\nend;)/gu)]
      for (const section of sections) if (targets.has(section[1])) mutate(section[1], (body) => {
        const pairs = [...section[2].matchAll(/v_old := \$old\$([\s\S]*?)\$old\$;\s*v_new := \$new\$([\s\S]*?)\$new\$;/gu)]
        assert.ok(pairs.length, `${file}: literal patch pairs`)
        return pairs.reduce((value, pair) => replaceReaderSourceOnce(value, pair[1], pair[2], file), body)
      })
    }
    if (file === "20260922054047_curriculum_schedule_and_class_textbooks.sql" || file === "20260922140000_class_detail_roster_counts.sql") {
      mutate(detail, (body) => replaceReaderSourceOnce(body, readerLiteralAssignment(source, "old_text"), source.match(/execute replace\(definition,old_text,\$new\$([\s\S]*?)\$new\$\)/u)?.[1] ?? assert.fail("literal inline replacement"), file))
    }
    if (file === "20260927141000_student_enrollment_batch_reads.sql") {
      const tuples = [...source.matchAll(/\('([^']+)',\s*('(?:''|[^'])*'),\s*('(?:''|[^'])*')\)/gu)]
      for (const tuple of tuples) if (targets.has(tuple[1])) mutate(tuple[1], (body) => {
        body = replaceReaderSourceOnce(body, readerSqlLiteral(tuple[2]).value, readerSqlLiteral(tuple[3]).value, file)
        if (tuple[1] === page) {
          const literals = [...source.matchAll(/(?:old_text|new_text):=(E'(?:''|[^'])*');/gu)]
          assert.equal(literals.length, 2)
          body = replaceReaderSourceOnce(body, readerSqlLiteral(literals[0][1]).value, readerSqlLiteral(literals[1][1]).value, `${file}: batch source`)
        }
        return body
      })
    }
    if (file === "20260928021444_registration_numbered_keys_narrow_summary.sql") {
      mutate(STUDENT_CONTACT_READER_SIGNATURES[5], (body) => {
        const pairs = [...source.matchAll(/definition := pg_catalog\.replace\(definition,\s*('(?:''|[^'])*'),\s*(\$summary\$[\s\S]*?\$summary\$|'(?:''|[^'])*')\);/gu)]
        assert.equal(pairs.length, 3, `${file}: three narrow source replacements`)
        return pairs.reduce((value, pair) => replaceReaderSourceOnce(value, readerSqlLiteral(pair[1]).value, readerSqlLiteral(pair[2]).value, file), body)
      })
    }
    if (file === "20260928010618_registration_stats_narrow_summary.sql") {
      mutate(STUDENT_CONTACT_READER_SIGNATURES[7], (body) => {
        const replacement = /body := pg_catalog\.replace\(function_row\.prosrc,\s*('(?:''|[^'])*'),\s*(\$summary\$[\s\S]*?\$summary\$)\);/u.exec(source)
        assert.ok(replacement, `${file}: exact narrow stats source replacement`)
        return replaceReaderSourceOnce(body, readerSqlLiteral(replacement[1]).value, readerSqlLiteral(replacement[2]).value, file)
      })
    }
  }
  assert.equal(targets.size, STUDENT_CONTACT_READER_SIGNATURES.length)
  return targets
}
