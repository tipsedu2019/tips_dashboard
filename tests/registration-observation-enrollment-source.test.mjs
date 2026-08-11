import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260809104000_registration_observation_enrollment_source.sql",
);
const pgTapPath = path.join(
  repositoryRoot,
  "supabase/tests/registration_observation_enrollment_test.sql",
);

const ASSERTION_PATTERN =
  /^select\s+(?:function_returns|is|isnt|ok|throws_ok|lives_ok|cmp_ok|has_column|col_type_is|has_index|fk_ok|trigger_is)\s*\(/gim;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSql(sql) {
  return sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
}

function functionDefinition(sql, qualifiedName) {
  const match = sql.match(
    new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+${escapeRegExp(qualifiedName)}\\s*\\([\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  assert.ok(match, `missing function definition: ${qualifiedName}`);
  return match[0];
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

async function migrationSql() {
  return readFile(migrationPath, "utf8");
}

test("enrollment source column is a restrictive observation foreign key with a partial lookup index", async () => {
  // Production break caught: an observation-backed enrollment can outlive its
  // source or every save scans all enrollment drafts.
  const sql = await migrationSql();
  assert.match(
    sql,
    /add\s+column\s+class_start_source_observation_id\s+uuid\s+references\s+public\.ops_registration_observations\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/i,
  );
  assert.match(
    sql,
    /create\s+index\s+ops_registration_enrollments_class_start_source_observation_id_idx\s+on\s+public\.ops_registration_enrollments\s*\(\s*class_start_source_observation_id\s*\)\s+where\s+class_start_source_observation_id\s+is\s+not\s+null/i,
  );
  assert.doesNotMatch(sql, /on\s+delete\s+(?:cascade|set\s+null)/i);
});

test("historical source validator locks one eligible same-task track and class snapshot", async () => {
  // Production break caught: a caller links an unrelated, no-show, unfit, or
  // undecided observation, or a normalized source silently follows a moved
  // current schedule instead of the recorded observation snapshot.
  const sql = await migrationSql();
  const validator = functionDefinition(
    sql,
    "dashboard_private.validate_registration_observation_class_start_source_v1",
  );
  for (const token of [
    "p_track_id uuid",
    "p_observation_id uuid",
    "p_class_id uuid",
    "p_class_start_date date",
    "p_class_start_session_key text",
    "p_class_start_lesson_session_id uuid",
  ]) assert.match(validator, new RegExp(token.replaceAll("_", "[_]"), "i"));
  assert.match(validator, /security\s+definer/i);
  assert.match(validator, /set\s+search_path\s*=\s*''/i);
  assert.match(validator, /\(select\s+auth\.uid\(\)\)/i);
  assert.match(validator, /assert_registration_mutation_access[\s\S]*?'save_enrollment_rows'/i);
  assert.match(validator, /observation\.task_id\s*=\s*track\.task_id/i);
  assert.match(validator, /observation\.track_id\s*=\s*p_track_id/i);
  assert.match(validator, /observation\.class_id\s*=\s*p_class_id/i);
  assert.match(validator, /observation\.status\s*=\s*'completed'/i);
  assert.match(validator, /observation\.attendance\s*=\s*'attended'/i);
  assert.match(validator, /observation\.suitability_result\s*=\s*'fit'/i);
  assert.match(validator, /observation\.decision_kind\s*=\s*'enrollment'/i);
  assert.match(validator, /for\s+update\s+of\s+observation/i);
  assert.match(validator, /session_authority\s*=\s*'normalized'/i);
  assert.match(validator, /class_lesson_session_id/i);
  assert.match(validator, /session_authority\s*=\s*'legacy'/i);
  assert.match(validator, /legacy_session_key/i);
  assert.match(validator, /at\s+time\s+zone\s+'Asia\/Seoul'/i);
  assert.match(validator, /'classStartSession'/i);
  assert.doesNotMatch(validator, /schedule_state\s+in\s*\(\s*'active'/i);
});

test("pure enrollment normalizer emits nine canonical keys without writes locks or receipts", async () => {
  // Production break caught: request fingerprints depend on omitted keys or a
  // supposedly pure normalizer performs privileged database work.
  const sql = await migrationSql();
  const normalizer = functionDefinition(
    sql,
    "dashboard_private.normalize_registration_enrollment_rows_request_v1",
  );
  assert.match(normalizer, /language\s+plpgsql/i);
  assert.match(normalizer, /immutable/i);
  assert.match(normalizer, /security\s+invoker/i);
  assert.match(normalizer, /set\s+search_path\s*=\s*''/i);
  for (const key of [
    "id",
    "classId",
    "textbookId",
    "classStartDate",
    "classStartSessionKey",
    "classStartLessonSessionId",
    "classStartSession",
    "classStartSourceObservationId",
    "sortOrder",
  ]) assert.match(normalizer, new RegExp(`'${key}'`));
  assert.match(normalizer, /registration_enrollment_rows_unknown_key/i);
  assert.match(normalizer, /registration_enrollment_rows_duplicate_class/i);
  assert.match(normalizer, /registration_enrollment_rows_duplicate_id/i);
  assert.doesNotMatch(
    normalizer,
    /(?:insert\s+into|update\s+|delete\s+from|ops_registration_mutations|pg_advisory_xact_lock|auth\.uid)/i,
  );
});

test("public rows wrapper authorizes before replay and owns exactly one original-key receipt", async () => {
  // Production break caught: replay becomes an authorization oracle, or the
  // public operation creates a nested/derived receipt before its side effects.
  const sql = await migrationSql();
  const wrapper = functionDefinition(
    sql,
    "public.save_registration_enrollment_rows",
  );
  assert.match(wrapper, /language\s+plpgsql/i);
  assert.match(wrapper, /security\s+definer/i);
  assert.match(wrapper, /set\s+search_path\s*=\s*''/i);
  const actor = wrapper.indexOf("auth.uid");
  const normalize = wrapper.indexOf(
    "normalize_registration_enrollment_rows_request_v1",
  );
  const access = wrapper.indexOf("assert_registration_mutation_access");
  const advisory = wrapper.indexOf("pg_advisory_xact_lock");
  const receipt = wrapper.indexOf("ops_registration_mutations");
  const dml = wrapper.indexOf("save_registration_enrollment_rows_canonical_v1");
  const receiptInsert = wrapper.lastIndexOf(
    "insert into dashboard_private.ops_registration_mutations",
  );
  assert.ok(actor >= 0 && actor < normalize);
  assert.ok(normalize < access && access < advisory && advisory < receipt);
  assert.ok(receipt < dml && dml < receiptInsert);
  assert.match(wrapper, /mutation_type\s*=\s*'save_enrollment_rows'/i);
  assert.equal(
    countMatches(wrapper, /insert\s+into\s+dashboard_private\.ops_registration_mutations/gi),
    1,
  );
  assert.equal(
    countMatches(wrapper, /save_registration_enrollment_rows_canonical_v1\s*\(/gi),
    1,
  );
  assert.doesNotMatch(wrapper, /save_registration_enrollment_rows_legacy_v1\s*\(/i);
  assert.doesNotMatch(wrapper, /set_config[\s\S]*dashboard\.registration_status_independent_enrollment/i);
});

test("canonical DML applies one final-set upsert and one audit plus parent recompute without a ledger", async () => {
  // Production break caught: source/date/key/lesson are patched in separate
  // writes, id-less drafts self-conflict, or a retry ledger leaks into the
  // receipt-free inner helper.
  const sql = await migrationSql();
  const canonical = functionDefinition(
    sql,
    "dashboard_private.save_registration_enrollment_rows_canonical_v1",
  );
  assert.match(canonical, /security\s+definer/i);
  assert.match(canonical, /set\s+search_path\s*=\s*''/i);
  assert.match(canonical, /p_actor_id\s+is\s+distinct\s+from\s*\(select\s+auth\.uid\(\)\)/i);
  assert.match(canonical, /assert_registration_mutation_access[\s\S]*?'save_enrollment_rows'/i);
  const stateGate = canonical.indexOf("registration_invalid_source_state");
  const runtimeGate = canonical.indexOf("assert_registration_observation_runtime_v1");
  const enrollmentLock = canonical.indexOf("-- enrollment_source_enrollment_locks");
  const classLock = canonical.indexOf("-- enrollment_source_class_locks");
  const finalRows = canonical.indexOf("-- enrollment_source_final_rows");
  const upsert = canonical.indexOf("insert into public.ops_registration_enrollments");
  assert.ok(stateGate >= 0 && stateGate < runtimeGate);
  assert.ok(runtimeGate < enrollmentLock && enrollmentLock < classLock);
  assert.ok(classLock < finalRows && finalRows < upsert);
  assert.match(
    canonical,
    /pipeline_status[\s\S]*?'enrollment_decided'[\s\S]*?'registered'[\s\S]*?dashboard\.registration_status_independent_enrollment/i,
  );
  assert.match(canonical, /classStartSourceObservationId[\s\S]*?is\s+not\s+null[\s\S]*?assert_registration_observation_runtime_v1/i);
  assert.match(canonical, /status\s*=\s*'planned'/i);
  assert.match(canonical, /admission_batch_id\s+is\s+null/i);
  assert.match(canonical, /student_id\s+is\s+null/i);
  assert.match(canonical, /not\s+enrollment\.roster_active/i);
  assert.match(canonical, /registration_enrollment_draft_ambiguous/i);
  assert.match(canonical, /validate_registration_class_session/i);
  assert.match(canonical, /validate_registration_observation_class_start_source_v1/i);
  assert.equal(
    countMatches(canonical, /insert\s+into\s+public\.ops_registration_enrollments/gi),
    1,
  );
  assert.match(canonical, /insert\s+into\s+public\.ops_registration_enrollments[\s\S]*?select[\s\S]*?on\s+conflict\s*\(\s*id\s*\)\s+do\s+update/i);
  for (const column of [
    "class_id",
    "textbook_id",
    "class_start_date",
    "class_start_session_key",
    "class_start_session",
    "class_start_lesson_session_id",
    "class_start_source_observation_id",
    "sort_order",
  ]) assert.match(canonical, new RegExp(`${column}\\s*=\\s*excluded\\.${column}`, "i"));
  assert.match(canonical, /registration_enrollment_draft_write_mismatch/i);
  assert.equal(countMatches(canonical, /write_registration_track_event_v2\s*\(/gi), 1);
  assert.equal(countMatches(canonical, /recompute_registration_parent\s*\(/gi), 1);
  assert.match(canonical, /'enrollment_rows_saved'/i);
  assert.doesNotMatch(
    canonical,
    /ops_registration_mutations|p_request_key|pg_advisory_xact_lock|save_registration_enrollment_rows_legacy_v1\s*\(/i,
  );
  assert.doesNotMatch(canonical, /set_config[\s\S]*dashboard\.registration_status_independent_enrollment/i);
});

test("details operation preserves its raw outer fingerprint but stores and audits canonical final rows", async () => {
  // Production break caught: details replay skips authorization, stores browser
  // rows, derives an inner key, or owns more than its one outer receipt.
  const sql = await migrationSql();
  const details = functionDefinition(
    sql,
    "dashboard_private.save_registration_enrollment_details_impl",
  );
  const access = details.indexOf("assert_registration_mutation_access");
  const advisory = details.indexOf("pg_advisory_xact_lock");
  const receipt = details.indexOf("ops_registration_mutations");
  const bypass = details.indexOf(
    "dashboard.registration_status_independent_enrollment",
  );
  const normalize = details.indexOf(
    "normalize_registration_enrollment_rows_request_v1",
  );
  const canonical = details.indexOf(
    "save_registration_enrollment_rows_canonical_v1",
  );
  const detailUpdate = details.indexOf("enrollment_detail_rows");
  const audit = details.indexOf("registration_enrollment_details_saved");
  const insert = details.lastIndexOf(
    "insert into dashboard_private.ops_registration_mutations",
  );
  assert.ok(access >= 0 && access < advisory && advisory < receipt);
  assert.ok(receipt < bypass && bypass < normalize && normalize < canonical);
  assert.ok(canonical < detailUpdate && detailUpdate < audit && audit < insert);
  assert.match(details, /'trackId'\s*,\s*p_track_id[\s\S]*?'rows'\s*,\s*p_rows/i);
  assert.match(details, /enrollment_detail_rows\s*=\s*v_response\s*->\s*'rows'/i);
  assert.match(details, /mutation_type[\s\S]*?'save_registration_enrollment_details'/i);
  assert.equal(
    countMatches(details, /insert\s+into\s+dashboard_private\.ops_registration_mutations/gi),
    1,
  );
  assert.equal(
    countMatches(details, /save_registration_enrollment_rows_canonical_v1\s*\(/gi),
    1,
  );
  assert.doesNotMatch(details, /:canonical-rows/i);
  assert.doesNotMatch(details, /public\.save_registration_enrollment_rows\s*\(/i);
});

test("enrollment trigger validates final regular or historical values under the caller actor", async () => {
  // Production break caught: a direct table write can partially change source
  // identity or a historical source is revalidated against only the live plan.
  const sql = await migrationSql();
  const trigger = functionDefinition(
    sql,
    "dashboard_private.sync_registration_enrollment_lesson_session_v1",
  );
  assert.match(trigger, /security\s+definer/i);
  assert.match(trigger, /set\s+search_path\s*=\s*''/i);
  assert.match(trigger, /\(select\s+auth\.uid\(\)\)/i);
  assert.match(trigger, /assert_registration_mutation_access[\s\S]*?'save_enrollment_rows'/i);
  assert.match(trigger, /new\.class_start_source_observation_id\s+is\s+null/i);
  assert.match(trigger, /validate_registration_class_session/i);
  assert.match(trigger, /validate_registration_observation_class_start_source_v1/i);
  assert.match(
    sql,
    /before\s+insert\s+or\s+update\s+of\s+class_id\s*,\s*class_start_date\s*,\s*class_start_session_key\s*,\s*class_start_lesson_session_id\s*,\s*class_start_source_observation_id/i,
  );
});

test("enrollment API grants only the two intended authenticated call chains", async () => {
  // Production break caught: an API role calls the legacy/private bridge or a
  // service key bypasses the public authenticated-only surface.
  const sql = normalizeSql(await migrationSql());
  for (const signature of [
    "public.save_registration_enrollment_rows_legacy_v1(uuid,jsonb,text)",
    "dashboard_private.save_registration_enrollment_rows_impl(uuid,jsonb,text)",
    "dashboard_private.validate_registration_observation_class_start_source_v1(uuid,uuid,uuid,date,text,uuid)",
    "dashboard_private.normalize_registration_enrollment_rows_request_v1(jsonb)",
    "dashboard_private.save_registration_enrollment_rows_canonical_v1(uuid,jsonb,uuid)",
    "dashboard_private.sync_registration_enrollment_lesson_session_v1()",
  ]) {
    const expression = escapeRegExp(signature).replaceAll("\\,", "\\s*,\\s*");
    assert.match(
      sql,
      new RegExp(
        `revoke all on function ${expression} from public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`,
        "i",
      ),
    );
    assert.doesNotMatch(
      sql,
      new RegExp(`grant execute on function ${expression}`, "i"),
    );
  }
  assert.match(
    sql,
    /revoke all on function public\.save_registration_enrollment_rows\(uuid\s*,\s*jsonb\s*,\s*text\) from public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.save_registration_enrollment_rows\(uuid\s*,\s*jsonb\s*,\s*text\) to authenticated/i,
  );
  assert.match(
    sql,
    /grant execute on function dashboard_private\.save_registration_enrollment_details_impl\(uuid\s*,\s*jsonb\s*,\s*text\) to authenticated/i,
  );
});

test("enrollment pgTAP binds the branch replay rollback concurrency and deactivation contracts to one plan", async () => {
  // Production break caught: source SQL looks plausible but real Postgres loses
  // a branch, side-effect rollback, committed activation race, or cleanup gate.
  const sql = await readFile(pgTapPath, "utf8");
  assert.match(sql, /^begin;/i);
  assert.match(sql, /rollback;\s*$/i);
  const plans = [...sql.matchAll(/select\s+plan\((\d+)\);/gi)];
  assert.equal(plans.length, 1);
  assert.equal(Number(plans[0][1]), [...sql.matchAll(ASSERTION_PATTERN)].length);
  for (const token of [
    "completed attended fit enrollment historical source",
    "unfit",
    "no-show",
    "canceled",
    "wrong task",
    "missing decision",
    "id-less",
    "ambiguous",
    "runtime 0",
    "same-fingerprint replay",
    "consultation_completed",
    "canonical-rows",
    "row audit failure",
    "recompute failure",
    "details audit failure",
    "outer receipt failure",
    "concurrent activation",
    "single winner",
    "registration_observation_runtime_deactivate_v1",
    "provider",
  ]) assert.match(sql, new RegExp(token, "i"));
  assert.doesNotMatch(sql, /select\s+no_plan\s*\(/i);
  assert.doesNotMatch(sql, /select\s+\*\s+from\s+finish\s*\(/i);
});

test("Task 6 SQL contains no provider send or finance/import mutation", async () => {
  // Production break caught: linking a first-session suggestion emits a send or
  // mutates admission/payment/import ownership outside enrollment drafts.
  const sql = await migrationSql();
  assert.doesNotMatch(sql, /solapi|google_chat|http_post|net\.http|send_web_push/i);
  assert.doesNotMatch(
    sql,
    /(?:insert\s+into|update\s+|delete\s+from)\s+(?:public\.)?(?:ops_registration_admission_batches|[^\s;]*(?:payment|import)[^\s;]*)/i,
  );
});
