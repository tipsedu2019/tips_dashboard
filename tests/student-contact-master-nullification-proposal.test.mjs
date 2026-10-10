import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const proposal = readFileSync(new URL("../docs/security/sql/student-contact-master-nullification-proposal.sql", import.meta.url), "utf8");
const executable = proposal.replace(/--[^\n]*/gu, "");
const auditDraft = readFileSync(new URL("../docs/security/sql/student-contact-privacy-audit-link-draft.sql", import.meta.url), "utf8");
const writerBody = auditDraft.match(/as \$student_privacy_body\$([\s\S]*?)\$student_privacy_body\$;/u)?.[1];
assert.ok(writerBody);

test("proposal is a separate pending-approved irreversible master stage", () => {
  assert.match(proposal, /Production target, only after separate approval: slnjqlzzhewblvttiidk/u);
  assert.match(proposal, /permanent-deletion approval is pending/u);
  assert.match(proposal, /six privacy install scripts do not invoke it/u);
  assert.match(proposal, /Old audit\n-- records\/backups\/copies remain/u);
  assert.equal((executable.match(/\bbegin\s*;/giu) || []).length, 1);
  assert.equal((executable.match(/\bcommit\s*;/giu) || []).length, 1);
});

test("only two master fields are updated; there is no copied-contact cleanup or permission escape", () => {
  const updates = [...executable.matchAll(/\bupdate\s+public\.[^;]+;/giu)].map((match) => match[0]);
  assert.deepEqual(updates, ["update public.students set contact = null, parent_contact = null where id = v_target.id;"]);
  assert.doesNotMatch(executable, /\b(?:delete\s+from|truncate|copy|grant|revoke|create\s+table|create\s+function|alter\s+table|alter\s+role|disable\s+trigger|set\s+(?:local\s+)?role)\b/iu);
  assert.doesNotMatch(executable, /(?:set_config|request\.jwt|session_replication_role\s*=|row_security\s*=)/u);
  assert.doesNotMatch(executable, /ops_registration_details|parent_phone|student_phone/u);
});

test("exact current privacy writer and all final student triggers are required before any DML", () => {
  const bodyHash = createHash("sha256").update(writerBody).digest("hex");
  assert.match(executable, new RegExp(bodyHash, "u"));
  assert.ok(executable.indexOf(bodyHash) < executable.indexOf("update public.students"));
  for (const marker of ["v_writer.proowner", "v_writer.prosecdef", "v_writer.proconfig", "v_writer.provolatile", "v_writer.proisstrict", "aclexplode", "has_function_privilege", "dashboard_audit_students", "prevent_direct_student_status_write", "t.tgenabled <> 'O'", "t.tgqual is not null", "t.tgtype <> expected.trigger_type"]) {
    assert.ok(executable.includes(marker), marker);
  }
  assert.match(executable, /count\(\*\) from pg_catalog\.pg_trigger[\s\S]*?<> 5/u);
  assert.match(executable, /student_master_contact_privacy_writer_drift' using errcode = '55000'/u);
  assert.match(executable, /student_master_contact_trigger_drift' using errcode = '55000'/u);
  for (const guardHash of ["734ae9d8d5a76393b42510714aabb08f8fcdea0707a70d46fbf41f6c13fb1799", "9375164e54e686ce0b2e29683f4d227270418d7ef49b2ffb49c634fc5288dbcb", "9d38d52a7e0dbf100fe69a02c20ce29ecaa5b78e788d74bbeebfb54b54676976"]) {
    assert.ok(executable.includes(guardHash), "production-catalog-confirmed final guard");
  }
  assert.match(executable, /student_master_contact_business_guard_drift' using errcode = '55000'/u);
});

test("population, ordered row locks and all other business columns are preserved atomically", () => {
  assert.match(executable, /set local lock_timeout = '5s'/u);
  assert.match(executable, /set local statement_timeout = '120s'/u);
  assert.match(executable, /lock table public\.students in share row exclusive mode/u);
  assert.match(executable, /where s\.contact is not null or s\.parent_contact is not null\s+order by s\.id\s+for update of s/u);
  assert.equal((executable.match(/to_jsonb\(s\) - array\['contact', 'parent_contact'\]/gu) || []).length, 2);
  assert.match(executable, /v_after_business is distinct from v_target\.business/u);
  assert.match(executable, /student_master_contact_population_not_cleared' using errcode = '55000'/u);
  assert.match(executable, /v_table_after\.relacl is distinct from v_table_before\.relacl/u);
});

test("native audit timezone and exact rollback exception are not overridden", () => {
  assert.match(executable, /current_setting\('TimeZone'\)/u);
  assert.doesNotMatch(executable, /\bset\s+(?:local\s+)?(?:timezone|time\s+zone)\b/iu);
  assert.doesNotMatch(executable, /exception\s+when|setval|40001/u);
  assert.match(proposal, /sequence\n-- gaps/u);
  assert.match(proposal, /audit_chain_continuity_invalid/u);
  assert.match(writerBody, /raise exception 'audit_chain_continuity_invalid' using errcode = '55000'/u);
});

test("normal contact-only privacy audit and aggregate-only diagnostics are verified", () => {
  assert.match(executable, /v_audit\.record_format <> 'privacy_v3'/u);
  assert.match(executable, /v_audit\.change_patch is distinct from '\{\}'::jsonb/u);
  assert.match(executable, /v_audit\.before_hash is distinct from v_audit\.after_hash/u);
  assert.doesNotMatch(executable, /\breturning\b/iu);
  assert.equal((executable.match(/raise notice/gu) || []).length, 1);
  assert.match(executable, /v_rows, v_student_contact_rows, v_parent_contact_rows, v_timezone/u);
});
