import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const name = '20261109015335_timetable_date_override_native_reader.sql';
const read = path => readFile(new URL(path, root), 'utf8');
const md5 = value => createHash('md5').update(value).digest('hex');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const baseHash = 'bc52c94595c5b2cb294f2c1eebbb6bcc';
const nextHash = '297fe1400b5313adbd978ea859d98fbb';
function readerDefinition(source) {
  const start = source.indexOf('create or replace function dashboard_private.read_timetable_operating_reference_v1()');
  assert.ok(start >= 0);
  const end = source.indexOf('$f$;', source.indexOf('as $f$', start)) + 4;
  return source.slice(start, end);
}
function body(source) { return source.split('as $f$')[1].split('$f$;')[0]; }
function applyFragments(source, sql) {
  const fragments = [...sql.matchAll(/\(\$before(\d+)\$([\s\S]*?)\$before\1\$, \$after\1\$([\s\S]*?)\$after\1\$\)/gu)];
  assert.equal(fragments.length, 4);
  for (const [, , before, after] of fragments) {
    assert.equal(source.split(before).length - 1, 1, 'each reviewed fragment must select exactly one location');
    source = source.replace(before, () => after);
  }
  return source;
}
function migrationDo(sql) { return sql.slice(sql.indexOf('do $'), sql.lastIndexOf('\ncommit;')).trim(); }

test('date override reader migration changes only the reviewed body and retains the original artifact', async () => {
  const original = await read('supabase/migrations/20261031120000_class_close_occupancy_release.sql');
  assert.equal(sha256(original), '1872ae421e86e383e1c06ee9cc9df7a86c4c462ea6f9f2433cc254735f55fe63');
  const definition = readerDefinition(original), before = body(definition);
  assert.equal(md5(before), baseHash);
  const forward = await read('supabase/migrations/' + name);
  const after = applyFragments(before, forward);
  assert.equal(md5(after), nextHash);
  assert.equal(sha256(definition.replace(before, () => after)), 'ce2956de371dc29378b07a33c3e54251cd8f52d31d92c4204e50818656e37587');
  // Common parsing, fallback, output order and close projection remain exact bytes.
  assert.equal(after.slice(after.indexOf('   -- Parse hours')), before.slice(before.indexOf('   -- Parse hours')));
});

test('date override reader recovery is the exact inverse and requires the candidate body', async () => {
  const before = body(readerDefinition(await read('supabase/migrations/20261031120000_class_close_occupancy_release.sql')));
  const forward = await read('supabase/migrations/' + name), recovery = await read('supabase/rollbacks/' + name);
  assert.equal(applyFragments(applyFragments(before, forward), recovery), before);
  assert.ok(recovery.includes("md5(original_body) is distinct from '" + nextHash + "'"));
  assert.ok(recovery.includes("md5(candidate_body) is distinct from '" + baseHash + "'"));
});

test('pgTAP lifecycle executes exact published migration and recovery DO blocks', async () => {
  const sql = await read('supabase/tests/timetable_date_override_native_reader_test.sql');
  const forward = await read('supabase/migrations/' + name), recovery = await read('supabase/rollbacks/' + name);
  assert.equal(sql.split('$forward$')[1], migrationDo(forward));
  assert.equal(sql.split('$rollback$')[1], migrationDo(recovery));
  assert.ok(sql.includes('select ok(passed,label) from reader_lifecycle_results;'));
});
