// Reads local source only. It does not connect to or execute SQL.
// These structural guards complement the real pgTAP behavior/ACL/atomicity tests;
// they are not proof of SQL execution, production identity, or deployment.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = '131ce90392c8a2f8e39a4ed794fd927de5a8d5d2';
const migration = '20261020012000_timetable_independent_presets.sql';
const directory = 'supabase/migrations';
// Read from the final ordered chain at base 131ce9039; checked-in constants keep
// this source contract usable in validation snapshots that intentionally omit
// .git. Updating a pin requires an independent review of that changed function.
const priorExecution = new Map([
  ['public.get_timetable_plan_v1', ['p_plan_id uuid', 'jsonb', 'stable', 'definer']],
  ['public.get_timetable_plan_revision_v1', ['p_plan_id uuid', 'jsonb', 'stable', 'definer']],
  ['dashboard_private.validate_timetable_item_slots_v1', ['p_plan uuid, p_item uuid, p_subject text, p_slots jsonb, p_reference jsonb', 'void', 'stable', 'invoker']],
  ['public.mutate_timetable_plan_item_v1', ['p_command jsonb', 'jsonb', 'volatile', 'definer']],
  ['public.commit_timetable_plan_import_v1', ['p_command jsonb', 'jsonb', 'volatile', 'definer']],
  ['dashboard_private.evaluate_timetable_transfer_v1', ['r jsonb', 'jsonb', 'stable', 'definer']],
  ['public.commit_timetable_plan_transfer_v1', ['p_command jsonb', 'jsonb', 'volatile', 'definer']],
  ['dashboard_private.read_timetable_weekly_reference_v1', ['', 'jsonb', 'stable', 'definer']],
]);
const changed = [
  'public.get_timetable_plan_v1',
  'public.get_timetable_plan_revision_v1',
  'dashboard_private.validate_timetable_item_slots_v1',
  'public.mutate_timetable_plan_item_v1',
  'public.commit_timetable_plan_import_v1',
  'dashboard_private.evaluate_timetable_transfer_v1',
  'public.commit_timetable_plan_transfer_v1',
  'dashboard_private.read_timetable_weekly_reference_v1',
];
const priorPreserved = new Map([
  ['dashboard_private.read_timetable_operating_reference_v1', {
    file: '20261013070534_timetable_reader_explicit_native_resolution.sql',
    sha256: 'e76be02c60c2013abf4cece63200d1a01c9899b8c90cb393b6f6ee27978bab18',
  }],
  ['dashboard_private.validate_timetable_operating_reference_v1', {
    file: '20261014180000_timetable_validation_unchanged_inputs.sql',
    sha256: 'c7352d313dee946be5a5cfa9668f81b8fc0f1683038b9db7b0371de2f9f15464',
  }],
  ['dashboard_private.assert_timetable_operational_conflicts_v1', {
    file: '20261013043948_class_close_gateway_noop_validation_reuse.sql',
    sha256: '16e68d4113fbaf18cbd1bd432adff022f413adcd4e2665b0a0c832742640561e',
  }],
  ['dashboard_private.prepare_timetable_transfer_v1', {
    file: '20260929154143_timetable_director_preparing_workflow.sql',
    sha256: '7cb9296912c775d480525fd6f6777f5367a5f591937ab737a05913fd21e0f53d',
  }],
]);
const preserved = [...priorPreserved.keys()];
const wanted = new Set([...changed, ...preserved]);
const sha = value => createHash('sha256').update(value).digest('hex');

// A small lexer, not a SQL parser. Comments/whitespace/keyword case are ignored,
// quoted values retain their identity, and dollar bodies stay opaque at the top
// level. This prevents a comment or dynamic SQL string from becoming a function
// declaration. Both $$; and $function$ followed by a newline and ; are accepted.
function lex(source) {
  const result = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/u.test(source[i])) { i++; continue; }
    if (source.startsWith('--', i)) {
      const end = source.indexOf('\n', i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith('/*', i)) {
      let depth = 1;
      i += 2;
      while (i < source.length && depth) {
        if (source.startsWith('/*', i)) { depth++; i += 2; }
        else if (source.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      assert.equal(depth, 0, 'unterminated SQL comment');
      continue;
    }
    const start = i;
    const delimiter = /^\$(?:[a-z_][a-z_0-9]*)?\$/iu.exec(source.slice(i))?.[0];
    if (delimiter) {
      const end = source.indexOf(delimiter, i + delimiter.length);
      assert.ok(end >= 0, 'unterminated SQL dollar body');
      i = end + delimiter.length;
      result.push({ kind: 'body', value: source.slice(start, i),
        body: source.slice(start + delimiter.length, end), start, end: i });
      continue;
    }
    if (source[i] === "'" || source[i] === '"') {
      const quote = source[i++];
      const escaped = quote === "'" && /(?:^|[^\w])e$/iu.test(source.slice(0, start));
      let closed = false;
      while (i < source.length) {
        if (escaped && source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) {
          if (source[i + 1] === quote) { i += 2; continue; }
          i++; closed = true; break;
        }
        i++;
      }
      assert.ok(closed, 'unterminated SQL quoted value');
      result.push({ kind: quote === "'" ? 'string' : 'quoted', value: source.slice(start, i), start, end: i });
      continue;
    }
    const word = /^[a-z_][a-z_0-9$]*/iu.exec(source.slice(i))?.[0];
    const number = /^\d+/u.exec(source.slice(i))?.[0];
    const operator = /^(?:->>|#>>|->|#>|::|:=|<>|!=|<=|>=|\|\|)/u.exec(source.slice(i))?.[0];
    const value = word ?? number ?? operator ?? source[i];
    i += value.length;
    result.push({ kind: word ? 'word' : 'symbol', value: word ? value.toLowerCase() : value, start, end: i });
  }
  return result;
}
const values = tokens => tokens.map(token => token.value);
const pattern = fragment => values(lex(fragment));
function at(tokens, fragment, from = 0) {
  const needle = pattern(fragment);
  for (let i = from; i <= tokens.length - needle.length; i++) {
    if (needle.every((value, j) => tokens[i + j].value === value)) return i;
  }
  return -1;
}
function has(tokens, fragment, message = fragment) {
  const found = at(tokens, fragment);
  assert.ok(found >= 0, `missing contract: ${message}`);
  return found;
}
function lacks(tokens, fragment, message = fragment) {
  assert.equal(at(tokens, fragment), -1, `forbidden contract: ${message}`);
}
function ordered(tokens, fragments) {
  let cursor = 0;
  for (const fragment of fragments) {
    const found = at(tokens, fragment, cursor);
    assert.ok(found >= cursor, `missing/out-of-order contract: ${fragment}`);
    cursor = found + pattern(fragment).length;
  }
}
function between(tokens, start, end) {
  const a = has(tokens, start);
  const b = at(tokens, end, a + pattern(start).length);
  assert.ok(b > a, `missing boundary after ${start}: ${end}`);
  return tokens.slice(a, b);
}
function statements(source) {
  const rows = []; let pending = [];
  for (const token of lex(source)) {
    pending.push(token);
    if (token.value === ';') { rows.push(pending); pending = []; }
  }
  assert.equal(pending.length, 0, 'unterminated top-level SQL statement');
  return rows;
}
function definition(tokens, source, file) {
  let i = 0;
  if (tokens[i++]?.value !== 'create') return null;
  let replace = false;
  if (tokens[i]?.value === 'or') {
    assert.equal(tokens[++i]?.value, 'replace'); i++; replace = true;
  }
  if (tokens[i++]?.value !== 'function') return null;
  const name = tokens.slice(i, i + 3).map(token => token.value).join('');
  if (!wanted.has(name)) return { name, replace };
  i += 3;
  assert.equal(tokens[i]?.value, '(');
  const argStart = i++; let depth = 1;
  while (i < tokens.length && depth) {
    if (tokens[i].value === '(') depth++;
    if (tokens[i].value === ')') depth--;
    i++;
  }
  assert.equal(depth, 0, `invalid function signature: ${name}`);
  const header = tokens.slice(i, tokens.findIndex(token => token.kind === 'body'));
  const dollar = tokens.find(token => token.kind === 'body');
  assert.ok(dollar, `missing body: ${name}`);
  assert.equal(header.at(-1)?.value, 'as');
  const after = keyword => header[has(header, keyword) + 1]?.value;
  const security = at(header, 'security definer') >= 0 ? 'definer' : 'invoker';
  const config = values(header.slice(has(header, 'set search_path') + 2, -1));
  assert.ok(['to', '='].includes(config[0]), `explicit search_path required: ${name}`);
  assert.deepEqual(config.slice(1), ["''"], `empty search_path required: ${name}`);
  return { name, replace, file, body: lex(dollar.body),
    signature: values(tokens.slice(argStart, i)),
    attributes: { returns: after('returns'), language: after('language'), security,
      volatility: header.find(token => ['stable', 'volatile', 'immutable'].includes(token.value))?.value ?? 'volatile',
      searchPath: config.slice(1) },
    sql: source.slice(tokens[0].start, tokens.at(-1).end) };
}
function resolveFinal(files) {
  // Resolve literal declarations in migration order. Pair this with the existing
  // immutable migration manifest/source-closure gate; this is not a SQL engine
  // and does not infer arbitrary dynamic definitions from earlier DO blocks.
  const final = new Map();
  for (const { file, source } of files) for (const statement of statements(source)) {
    const row = definition(statement, source, file);
    if (row && wanted.has(row.name)) final.set(row.name, row);
  }
  for (const name of wanted) assert.ok(final.has(name), `missing final definition: ${name}`);
  return final;
}
const names = (await readdir(join(root, directory))).filter(file => file.endsWith('.sql')).sort();
const currentFiles = await Promise.all(names.map(async file => ({ file, source: await readFile(join(root, directory, file), 'utf8') })));
const current = resolveFinal(currentFiles);
const source = currentFiles.find(row => row.file === migration)?.source;
assert.ok(source, '014 migration exists');
const body = name => current.get(name).body;

test('014 replaces exactly eight existing signatures with unchanged execution attributes and no extra top-level DDL/ACL/data writes', () => {
  const replacements = [];
  for (const statement of statements(source)) {
    const row = definition(statement, source, migration);
    if (row) {
      replacements.push(row.name);
      assert.equal(row.replace, true, 'existing functions use CREATE OR REPLACE');
      continue;
    }
    const v = values(statement).join(' ');
    assert.ok(['begin ;', 'commit ;', "set local lock_timeout = '5s' ;", "set local statement_timeout = '120s' ;"].includes(v),
      `unexpected top-level statement: ${v}`);
  }
  assert.deepEqual(replacements.sort(), [...changed].sort());
  for (const name of changed) {
    const now = current.get(name);
    const [args, returns, volatility, security] = priorExecution.get(name);
    assert.equal(now.file, migration, `${name} must resolve to the reviewed final migration`);
    assert.deepEqual(now.signature, pattern(`(${args})`), `${name}: argument contract from ${base}`);
    assert.deepEqual(now.attributes, { returns, language: 'plpgsql', security, volatility, searchPath: ["''"] },
      `${name}: security/volatility/search_path contract from ${base}`);
    for (const keyword of ['create', 'alter', 'drop', 'grant', 'revoke', 'execute']) {
      assert.ok(!now.body.some(token => token.kind === 'word' && token.value === keyword), `${name}: unexpected ${keyword}`);
    }
    lacks(now.body, 'set_config', 'no hidden role/session configuration changes');
    lacks(now.body, "errcode = '40001'", 'domain failures must not fabricate serialization errors');
    lacks(now.body, "raise sqlstate '40001'");
  }
});

test('actual dated reader, operating validation and transfer authorization/locking are unchanged from the reviewed base', () => {
  for (const name of preserved) {
    assert.equal(current.get(name).file, priorPreserved.get(name).file, `${name}: no newer replacement`);
    assert.equal(sha(current.get(name).sql), priorPreserved.get(name).sha256, `${name}: exact definition bytes from ${base}`);
  }
});

test('preset snapshots retain catalogs/applied history and never read operating occupancy', () => {
  const snapshot = body('public.get_timetable_plan_v1');
  ordered(snapshot, ['perform dashboard_private.timetable_require_v1(p_plan_id)', 'from public.timetable_plans']);
  for (const key of ['shadowSlots', 'shadowClasses', 'unresolvedOccupancies', 'datedSessions', 'datedUnresolvedOccupancies']) {
    has(snapshot, `'${key}', '[]'::jsonb`, `empty external ${key}`);
  }
  has(snapshot, "'shadowFingerprint',md5((ref->'catalogs')::text)");
  for (const table of ['teacher_catalogs', 'classroom_catalogs']) has(snapshot, `from public.${table}`);
  has(snapshot, "'isMissing',true", 'resource tombstones survive');
  has(snapshot, "state='applied'", 'applied rows remain a separate snapshot');
  has(snapshot, "'appliedSnapshots',applied");
  has(snapshot, 'total_items<=500 and total_slots<=2000', 'capacity still gates completeness');
  for (const reader of ['read_timetable_operating_reference_v1', 'read_timetable_weekly_reference_v1']) {
    lacks(snapshot, `dashboard_private.${reader}`);
  }
  has(body('public.get_timetable_plan_revision_v1'), 'r:=public.get_timetable_plan_v1(p_plan_id)', 'revision shares independent snapshot reference');
});

test('item and import writers authorize, lock, reauthorize and replay before stale validation or writes', () => {
  ordered(body('public.mutate_timetable_plan_item_v1'), [
    'perform dashboard_private.timetable_require_v1(pid,true,false)',
    'perform dashboard_private.lock_timetable_operating_resources_v1()',
    'select * into p from public.timetable_plans where id=pid for update',
    'perform dashboard_private.timetable_require_v1(pid,true,false)',
    "response:=dashboard_private.timetable_receipt_v1('item.'||op,p_command)",
    'if response is not null then return response;end if',
    "if op='save_batch' then",
  ]);
  ordered(body('public.commit_timetable_plan_import_v1'), [
    'perform dashboard_private.timetable_require_v1(null,false,true)',
    'perform dashboard_private.lock_timetable_operating_resources_v1()',
    'perform dashboard_private.timetable_require_v1(null,false,true)',
    "response:=dashboard_private.timetable_receipt_v1('import',p_command)",
    'if response is not null then return response;end if',
    'preview:=dashboard_private.timetable_import_source_v1(src)',
    "ref:='{}'::jsonb", 'insert into public.timetable_plans',
    'perform dashboard_private.validate_timetable_item_slots_v1',
    "perform dashboard_private.timetable_record_receipt_v1('import',p_command,response)",
  ]);
});

test('batch validates the complete final plan before its first write, with one sequence and immutable receipt', () => {
  const batch = between(body('public.mutate_timetable_plan_item_v1'), "if op='save_batch' then", "perform dashboard_private.timetable_record_receipt_v1('item.save_batch',p_command,response)");
  const firstWrite = Math.min(...['delete from public.', 'insert into public.', 'update public.']
    .map(fragment => at(batch, fragment)).filter(index => index >= 0));
  assert.ok(Number.isFinite(firstWrite));
  const validation = batch.slice(0, firstWrite);
  ordered(validation, ['perform id from public.timetable_plan_items where id=any(edit_ids) order by id for update',
    'perform dashboard_private.timetable_require_v1(pid,true,false)', 'into baseline_slots', 'into candidate_slots',
    "errcode='23P01',message='timetable_resource_conflict'"]);
  for (const field of ['expectedChangeSequence', 'expectedItemRevision', 'sourceSlotId']) has(validation, `'${field}'`);
  const candidate = between(validation, 'into candidate_slots', ') q');
  has(candidate, 'where z.plan_id=pid and not z.item_id=any(edit_ids)');
  has(candidate, 'union all', 'untouched and edited slots form one final candidate');
  has(candidate, "select x from jsonb_array_elements(batch_edits) e cross join lateral jsonb_array_elements(e->'slots') x where e->>'operation'='save'",
    'submitted save slots are part of the final candidate');
  lacks(candidate, '.state', 'untouched applied items are not filtered out');
  const selfConflict = between(validation, "if exists(select 1 from jsonb_array_elements(batch_edit->'slots') x", 'end if;');
  has(selfConflict, "where (x->>'id')::uuid<>sid and (x->>'weekday')::int=day and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a",
    'same-item overlap is checked even with distinct resources');
  const crossConflict = between(validation, 'if exists(select 1 from jsonb_array_elements(candidate_slots) x', 'end if;');
  has(crossConflict, "where (x->>'itemId')::uuid<>iid and (x->>'weekday')::int=day and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a",
    'cross-item final occupancy uses a half-open interval');
  has(crossConflict, "(x->>'teacherId')::uuid=tid or (x->>'classroomId')::uuid=rid");
  for (const scope of [selfConflict, crossConflict]) has(scope, "then raise exception using errcode='23P01',message='timetable_resource_conflict'");
  has(validation, 'if not changed then continue;end if', 'unchanged resources stay grandfathered');
  has(batch, "'snapshot',public.get_timetable_plan_v1(pid)");
  const sequence = pattern('update public.timetable_plans set change_sequence=change_sequence+1');
  assert.equal(batch.filter((_, i) => sequence.every((value, j) => batch[i + j]?.value === value)).length, 1);
  for (const target of ['classes', 'students', 'class_lesson_sessions']) {
    for (const verb of ['insert into', 'update', 'delete from']) lacks(batch, `${verb} public.${target}`);
  }
});

test('single and transfer conflict scopes include all same-preset applied slots while retaining resource and provenance checks', () => {
  const single = body('dashboard_private.validate_timetable_item_slots_v1');
  has(single, "(v->>'sourceSlotId')::uuid is distinct from old.source_slot_id");
  has(single, 'if not changed then continue;end if');
  has(single, 'where s.plan_id=p_plan and s.item_id<>p_item');
  has(single, 's.weekday=day and s.start_minute<b and s.end_minute>a');
  has(single, 's.teacher_catalog_id=tid or s.classroom_catalog_id=rid');
  has(single, "jsonb_array_elements(p_slots) x where (x->>'id')::uuid<>sid and (x->>'weekday')::int=day and (x->>'startMinute')::int<b and (x->>'endMinute')::int>a", 'self-overlap remains checked even with distinct resources');
  lacks(single, "i.state='draft'", 'applied occupancy participates');
  const transfer = body('dashboard_private.evaluate_timetable_transfer_v1');
  has(transfer, 'where x.plan_id=i.plan_id and x.id<>s.id and x.weekday=s.weekday');
  has(transfer, 'x.item_id=s.item_id or x.teacher_catalog_id=s.teacher_catalog_id or x.classroom_catalog_id=s.classroom_catalog_id');
  has(transfer, 'where x.plan_id=target_id and x.weekday=s.weekday');
  const sourceOccupancy = between(transfer, 'elsif exists(select 1 from public.timetable_plan_slots x', 'or exists(select 1 from public.timetable_plan_slots x');
  const targetOccupancy = between(transfer, 'or exists(select 1 from public.timetable_plan_slots x', "then code:='conflict'");
  lacks(sourceOccupancy, 'x.item_id=any(selected)', 'unselected source siblings still participate');
  for (const scope of [sourceOccupancy, targetOccupancy]) {
    lacks(scope, '.state', 'occupancy queries do not exclude applied slots');
    has(scope, 'x.start_minute<s.end_minute and x.end_minute>s.start_minute');
  }
  for (const tokens of [single, transfer]) {
    has(tokens, 'registration_observation_teacher_subject_matches_v1');
    for (const external of ['read_timetable_operating_reference_v1', 'read_timetable_weekly_reference_v1', 'timetable_blocker_intersects_v2']) lacks(tokens, external);
  }
});

test('new publication requires explicit preparing, while an authorized historical receipt returns before that policy', () => {
  const evaluator = body('dashboard_private.evaluate_timetable_transfer_v1');
  ordered(evaluator, ["r#>>'{target,kind}'='operational' and r#>>'{target,status}' is distinct from '개강 준비'", "errcode='22023',message='timetable_preparing_required'", 'source_snapshot:=public.get_timetable_plan_v1(source_id)']);
  has(evaluator, "case when target_id is null then 'create_preparing_class' else 'create_plan_item' end", 'preview action agrees with actual preparing publication');
  const commit = body('public.commit_timetable_plan_transfer_v1');
  ordered(commit, ['perform dashboard_private.prepare_timetable_transfer_v1(r)',
    "response:=dashboard_private.timetable_receipt_v1('transfer',p_command)",
    'if response is not null then return response;end if',
    'p:=dashboard_private.evaluate_timetable_transfer_v1(r)',
    "p->>'fingerprint' is distinct from p_command->>'previewFingerprint'", 'insert into dashboard_private.timetable_plan_transfers',
    'insert into public.classes', "values(i.name,i.subject,i.subject_area_key,i.grade,i.capacity,i.tuition,'개강 준비')",
    'perform public.initialize_new_class_schedule_v1', 'perform dashboard_private.assert_timetable_operational_conflicts_v1()',
    "perform dashboard_private.timetable_record_receipt_v1('transfer',p_command,response)",
  ]);
  for (const verb of ['update', 'delete from']) lacks(commit, `${verb} public.classes`, 'existing operating classes are not changed');
  for (const verb of ['insert into', 'update', 'delete from']) lacks(commit, `${verb} public.class_lesson_sessions`, 'no dated session generation');
  lacks(commit, 'public.activate_class_schedule_storage_v1');
  lacks(body('dashboard_private.prepare_timetable_transfer_v1'), "'timetable_preparing_required'", 'shared pre-receipt authorization must still accept historical request shape');
});

test('weekly reservations include only operating classes and keep the existing class reader', () => {
  const weekly = body('dashboard_private.read_timetable_weekly_reference_v1');
  const selection = between(weekly, 'for c in select * from public.classes', 'order by id loop');
  has(selection, "dashboard_private.academic_class_status_v1(status,nullif(btrim(start_date),'')::date,nullif(btrim(end_date),'')::date)='수강'");
  lacks(selection, "'개강 준비'", 'preparing publication does not reserve weekly occupancy');
  lacks(selection, 'timetable_plan_transfers', 'transfer provenance does not turn a preparation into a reservation');
  has(weekly, 'payload:=dashboard_private.read_timetable_class_weekly_v2(c)');
});
