// Source-chain regression only. The separate pgTAP runner must prove actual
// committed states, failure rollback and retry against isolated PostgreSQL.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const original = await read('20261027005334_teacher_own_request_workflow.sql');
const first = await read('20261029100252_teacher_withdrawal_hours_snapshot.sql');
const second = await read('20261029105121_teacher_withdrawal_hours_server_snapshot.sql');
function definition(name) {
  const start = original.indexOf(`create function ${name}(`);
  assert.ok(start >= 0, name);
  const end = original.indexOf('\nend $$;', start);
  assert.ok(end > start, name);
  return original.slice(start, end + '\nend $$;'.length);
}
function apply(source, migration, name) {
  const target = `target:='${name}(`;
  const start = migration.indexOf(target);
  if (start < 0) return source;
  const next = migration.indexOf("target:='", start + target.length);
  const block = migration.slice(start, next < 0 ? undefined : next);
  const patches = block.slice(block.indexOf('anchors:=array['));
  const split = patches.indexOf('replacements:=array[');
  assert.ok(split > 0);
  const anchors = [...patches.slice(0, split).matchAll(/\$a\$([\s\S]*?)\$a\$/g)].map(m => m[1]);
  const replacements = [...patches.slice(split).split(' for n in ')[0].matchAll(/\$r\$([\s\S]*?)\$r\$/g)].map(m => m[1]);
  assert.equal(anchors.length, replacements.length);
  for (const [i, anchor] of anchors.entries()) {
    assert.equal(source.split(anchor).length - 1, 1, `${name} anchor ${i + 1} must match once`);
    source = source.replace(anchor, () => replacements[i]);
  }
  return source;
}
const inputName = 'dashboard_private.teacher_request_ops_input_v1';
const baseInput = definition(inputName);
const prefixInput = apply(baseInput, first, inputName);
const finalInput = apply(prefixInput, second, inputName);

for (const [stage, source] of [['base', baseInput], ['first committed file', prefixInput], ['final committed file', finalInput]]) {
  test(`${stage}: direct RPC input retains the exact eight-key guard`, () => {
    assert.match(source, /not\(p \?& keys\) or p-keys<>'\{\}'/);
    assert.doesNotMatch(source, /allowed_keys|p \?& hour_keys|teacher_request_json_pick_v1\(p,hour_keys\)/);
    assert.match(source, /raise exception 'teacher_request_input_invalid' using errcode='22023'/);
    assert.ok(source.indexOf("p-keys<>'{}'") < source.indexOf('select * into s'), 'reject extra keys before reading or writing student/class data');
  });
}
test('read-compatible first state clears stale metrics on changed date/session without accepting a pair', () => {
  assert.match(prefixInput, /withdrawal_date'\)::date is distinct from old_withdrawal\.withdrawal_date/);
  assert.match(prefixInput, /withdrawal_session',''\) is distinct from nullif\(old_withdrawal\.withdrawal_session,''\)/);
  assert.match(prefixInput, /jsonb_build_object\('completed_lesson_hours',null,'four_week_lesson_hours',null\)/);
  assert.doesNotMatch(prefixInput, /calculate_teacher_withdrawal_hours_v1/);
});
test('final state derives from the locked class and preserves immutable effective history', () => {
  assert.match(finalInput, /select \* into c[\s\S]*?for share;/);
  assert.match(finalInput, /calculate_teacher_withdrawal_hours_v1\(\s*jsonb_build_object\('schedule_plan',c.schedule_plan,'schedule',c.schedule\)/);
  const mutation = apply(definition('public.mutate_teacher_own_request_v1'), second, 'dashboard_private.mutate_teacher_own_request_v1_impl');
  assert.match(mutation, /values\(p_domain,i,a,p_action,note,history_input\)/);
  assert.match(mutation, /'input',p_input,'revision',p_expected_revision/);
  assert.ok(mutation.indexOf('return r;') < mutation.indexOf('teacher_request_ops_input_v1(p_domain,p_input)'), 'receipt replay remains before new-input validation');
});
test('each candidate file remains one explicit transaction with fail-closed anchors and unchanged function security metadata', () => {
  for (const source of [first, second]) {
    assert.match(source, /^begin;\n/);
    assert.match(source.trimEnd(), /\ncommit;$/);
    assert.equal((source.match(/^commit;/gm) || []).length, 1);
    assert.match(source, /errcode='55000'/);
    assert.match(source, /jsonb_build_array\(proowner,proacl,provolatile,prosecdef,proconfig\)/);
    assert.match(source, /before_contract is distinct from after_contract/);
  }
});
