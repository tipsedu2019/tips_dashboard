import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const draft = readFileSync(new URL("../docs/security/sql/student-contact-privacy-audit-link-draft.sql", import.meta.url), "utf8");
const baseline = readFileSync(new URL("../supabase/migrations/20260814115116_dashboard_audit_diff_format.sql", import.meta.url), "utf8");
const candidateMatch = draft.match(/create or replace function dashboard_private\.log_dashboard_audit_event_v2\(\)\n([\s\S]*?)\nas \$student_privacy_body\$([\s\S]*?)\$student_privacy_body\$;/u);
const baselineMatch = baseline.match(/create or replace function dashboard_private\.log_dashboard_audit_event_v2\(\)\n([\s\S]*?)\nas \$\$([\s\S]*?)\$\$;/u);
assert.ok(candidateMatch && baselineMatch, "both exact function sources are readable");
const [, candidateAttributes, candidateBody] = candidateMatch;
const [, baselineAttributes, baselineBody] = baselineMatch;
const executable = draft.replace(/--[^\n]*/gu, "");

test("replacement retains the real baseline execution contract and fail-closed preimage", () => {
  assert.equal(candidateAttributes, baselineAttributes);
  const expected = createHash("sha256").update(baselineBody).digest("hex");
  assert.ok(draft.includes(expected), "preflight pins the actual current writer body");
  for (const field of ["proowner", "proacl", "proconfig", "prosecdef", "provolatile", "proparallel", "proisstrict", "proleakproof", "prolang", "procost", "prorows", "prosupport", "proretset", "prorettype"]) {
    assert.ok(draft.includes(`v_after.${field} is distinct from v_before.${field}`), field);
  }
  assert.equal((executable.match(/create or replace function/giu) || []).length, 1, "no newly callable helper is created");
});

test("nonstudent raw capture, predecessor collision checks and insert columns remain byte-equivalent", () => {
  const captureStart = baselineBody.indexOf("  if tg_op = 'DELETE' then");
  const captureEnd = baselineBody.indexOf("\n  audit_subject := coalesce", captureStart);
  assert.ok(candidateBody.includes(baselineBody.slice(captureStart, captureEnd)));
  const predecessorStart = baselineBody.indexOf("    select * into audit_predecessor");
  const predecessorEnd = baselineBody.indexOf("\n  end if;\n\n  insert into public.dashboard_audit_logs", predecessorStart);
  const originalBlock = baselineBody.slice(predecessorStart, predecessorEnd);
  assert.ok(candidateBody.includes(originalBlock.split("\n").map((line) => `  ${line}`).join("\n")));
  const insertStart = baselineBody.indexOf("  insert into public.dashboard_audit_logs (");
  const insertEnd = baselineBody.indexOf("  ) values (", insertStart) + "  ) values (".length;
  assert.ok(candidateBody.includes(baselineBody.slice(insertStart, insertEnd)));
  const contextStart = baselineBody.indexOf("  begin\n    audit_class_id :=");
  const contextEnd = baselineBody.indexOf("\n  if tg_op = 'INSERT' then", contextStart);
  assert.ok(candidateBody.includes(baselineBody.slice(contextStart, contextEnd)), "audit context, advisory lock and sequence remain unchanged");
  assert.ok(candidateBody.includes(baselineBody.slice(baselineBody.indexOf("begin\n  begin\n"), captureStart)), "actor claims handling remains unchanged");
});

test("draft has no historical row mutation, privilege change or trigger-disable escape", () => {
  assert.doesNotMatch(executable, /\b(?:grant|revoke|create\s+role|alter\s+role|create\s+policy|alter\s+policy|drop\s+policy|truncate|copy)\b/iu);
  assert.doesNotMatch(executable, /\b(?:update\s+(?:public|dashboard_private)\.|delete\s+from\s+(?:public|dashboard_private)\.|disable\s+trigger|session_replication_role)\b/iu);
  assert.doesNotMatch(executable, /drop\s+index[\s\S]*dashboard_audit_logs_v2_entity_sequence_idx/iu);
  assert.doesNotMatch(executable, /validate\s+constraint/iu);
  assert.ok(draft.includes("contact-irreversible".toUpperCase()), "non-restoration boundary is documented");
  assert.ok(draft.includes("NOT permanent purge"));
});

test("legacy and projected predecessor scans both retain actual ordered comparisons", () => {
  assert.match(candidateBody, /audit_predecessor\.after_hash is distinct from audit_legacy_before_hash/u);
  assert.match(candidateBody, /audit_predecessor\.after_hash is distinct from audit_before_hash/u);
  assert.match(candidateBody, /pg_catalog\.to_jsonb\(old\) - 'makeedu_detail_id'/u);
  assert.match(candidateBody, /audit_start_kind := 'privacy_boundary_v3'/u);
  assert.equal((candidateBody.match(/order by event_sequence desc limit 1/gu) || []).length, 2);
  assert.match(executable, /where entity_table = 'students' and record_format in \('full_v2', 'diff_v2', 'privacy_v3'\)/u);
  assert.match(candidateBody, /YYYY-MM-DD"T"HH24:MI:SS\.US"Z"/u);
});
