// Source-chain and real management-consumer evidence. These tests do not run
// PostgreSQL and must not be reported as SQL runtime or permission coverage.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as schedule from '../src/features/tasks/withdrawal-schedule-metrics.js';
import { toDateKey } from '../src/features/tasks/ops-task-model.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const predecessor = read('supabase/migrations/20261029105121_teacher_withdrawal_hours_server_snapshot.sql');
const correction = read('supabase/migrations/20261111031143_teacher_withdrawal_numeric_parity.sql');
const sql = read('supabase/tests/teacher_withdrawal_hours_formula_test.sql');
const workspace = read('src/features/tasks/ops-task-workspace.tsx');
const ast = ts.createSourceFile('workspace.tsx', workspace, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const start = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'stringValue').getStart(ast);
const end = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'getWithdrawalScheduleMetrics').end;
const context = vm.createContext({ ...schedule, toDateKey, Date, Intl, Map, Set });
vm.runInContext(ts.transpileModule(workspace.slice(start, end) + '\nglobalThis.metrics={getWithdrawalClassScheduleItems,getWithdrawalScheduleMetrics};', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText, context);

function block(signature) {
  const part = correction.split(`target:='${signature}'::regprocedure;`)[1]?.split("target:='")[0];
  assert.ok(part, signature);
  return {
    anchors: [...part.split('replacements:=array[')[0].matchAll(/\$a\$([\s\S]*?)\$a\$/g)].map(m => m[1]),
    replacements: [...part.split('replacements:=array[')[1].matchAll(/\$r\$([\s\S]*?)\$r\$/g)].map(m => m[1]),
  };
}
function definition(name) {
  const begin = predecessor.indexOf(`create function dashboard_private.${name}(`);
  const end = predecessor.indexOf('\nend $$;', begin);
  assert.ok(begin >= 0 && end > begin);
  return predecessor.slice(begin, end + 8);
}
function apply(source, patch) {
  assert.equal(patch.anchors.length, patch.replacements.length);
  for (const [i, anchor] of patch.anchors.entries()) {
    assert.equal(source.split(anchor).length - 1, 1, 'exactly one approved anchor is required');
    source = source.replace(anchor, () => patch.replacements[i]);
  }
  return source;
}
const scalar = block('dashboard_private.withdrawal_first_scalar_v1(jsonb,text[])');
const calculator = block('dashboard_private.calculate_teacher_withdrawal_hours_v1(jsonb,date)');

test('numeric scalar source chain changes only the validated decimal conversion', () => {
  const before = definition('withdrawal_first_scalar_v1');
  const after = apply(before, scalar);
  assert.equal(after, before.replace("return (v#>>'{}')::bigint::text;", "return (v#>>'{}')::numeric::bigint::text;"));
  assert.match(after, /jsonb_typeof\(v\)='number'/);
  assert.match(after, /<=9007199254740991/);
  assert.match(after, /errcode='22023'/);
});
test('calculator source chain keeps duration binary64 through sorting and aggregation', () => {
  const after = apply(definition('calculate_teacher_withdrawal_hours_v1'), calculator);
  assert.match(after, /hours_by_index\[entry\.ordinality::integer\]:=duration/);
  assert.equal((after.match(/hours_by_index\[\(value->>'index'\)::integer\]/g) || []).length, 2);
  assert.match(after, /completed_minutes:=completed_minutes\+hours_by_index\[\(item->>'index'\)::integer\]\*60/);
  assert.doesNotMatch(after, /->>'hours'|'hours',duration/);
  assert.match(after, /completed_minutes\/60/);
});
for (const [name, patch, before] of [
  ['scalar', scalar, definition('withdrawal_first_scalar_v1')],
  ['calculator', calculator, definition('calculate_teacher_withdrawal_hours_v1')],
]) {
  test(`${name}: missing, duplicated and already-applied predecessor anchors reject`, () => {
    for (const anchor of patch.anchors) {
      assert.throws(() => apply(before.replace(anchor, ''), patch));
      assert.throws(() => apply(before.replace(anchor, anchor + '\n' + anchor), patch));
    }
    assert.throws(() => apply(apply(before, patch), patch));
  });
}
test('correction retains one transaction and fail-closed metadata checks without changing grants or GUCs', () => {
  assert.match(correction, /^begin;\n/);
  assert.equal((correction.match(/^commit;/gm) || []).length, 1);
  assert.equal((correction.match(/before_contract is distinct from after_contract/g) || []).length, 2);
  assert.match(correction, /proowner,proacl,provolatile,prosecdef,proconfig,proparallel,proisstrict,proleakproof/);
  assert.doesNotMatch(correction, /\b(grant|revoke|alter role|set extra_float_digits|security definer)\b/i);
});
test('new SQL vectors exactly match the real management functions', () => {
  const rows = [...sql.matchAll(/^\('parity-([^']+)','([^']+)'::jsonb,'([^']+)'::date,'([^']+)'::jsonb,'([^']+)'::jsonb,'numeric parity regression'\)/gm)];
  assert.ok(rows.length >= 8, 'representative numeric parity vectors are required');
  for (const [, label, input, selectedDate, management, server] of rows) {
    const source = JSON.parse(input), expected = JSON.parse(management);
    assert.deepEqual(JSON.parse(server), expected, label);
    const classItem = { id: 'synthetic-class', schedule: source.schedule, schedulePlan: source.schedule_plan };
    const items = context.metrics.getWithdrawalClassScheduleItems(classItem, { authoritativeOnly: true });
    const actual = context.metrics.getWithdrawalScheduleMetrics(items, selectedDate, classItem);
    assert.deepEqual({ completed_lesson_hours: actual.completedLessonHours, four_week_lesson_hours: actual.fourWeekLessonHours }, expected, label);
  }
});
