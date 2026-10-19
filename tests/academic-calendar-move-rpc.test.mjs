import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';

import {
  isConfirmedAcademicCalendarMove,
  prepareAcademicCalendarMoveRequest,
  writeAcademicCalendarMove,
} from '../src/features/operations/academic-calendar-move-rpc.js';

const id = '9812bbbb-0000-4000-8000-000000000001';
const day = key => new Date(`${key}T12:00:00`);
const fingerprint = note => note === null ? null : createHash('sha256').update(note, 'utf8').digest('hex');
function inputs(note, multiDay = false) {
  const end = multiDay ? '2196-10-08' : '2196-10-06';
  const nextEnd = multiDay ? '2196-10-09' : '2196-10-07';
  return [
    { id, sourceId: id, startsAt: '2196-10-06', endsAt: end, storedNote: note },
    { id, sourceId: id, date: day('2196-10-06'), endDate: day(end) },
    { id, sourceId: id, date: day('2196-10-07'), endDate: day(nextEnd) },
  ];
}

for (const [label, note] of [
  ['null', null], ['empty string', ''], ['Unicode and whitespace', '  합성 e\u0301 🧪\r\n\t '],
]) {
  test(`move RPC prepares a six-field body from an exact ${label} snapshot`, async () => {
    const move = await prepareAcademicCalendarMoveRequest(...inputs(note));
    const expected = {
      p_event_id: id, p_expected_date: '2196-10-06', p_expected_end_date: '2196-10-06',
      p_expected_note_sha256: fingerprint(note), p_next_date: '2196-10-07', p_next_end_date: '2196-10-07',
    };
    assert.ok(JSON.stringify(move.params) === JSON.stringify(expected), 'body equals independently derived six-field expectation');
    assert.ok(Object.keys(move.params).length === 6 && !Object.hasOwn(move.params, 'note'), 'no raw-note argument exists');
    assert.ok(move.expectedReceipt.noteSha256 === fingerprint(note), 'receipt fingerprint preserves null and exact UTF-8 bytes');
  });
}

test('move RPC expected receipt fingerprints only the replaced end token', async () => {
  const prefix = '  합성 🧪\r\n[[TIPS_META]] ';
  const before = prefix + '{ "range\\u0045nd" : "2196-10-08", "unknown":9007199254740993, "value":1e+03 }\n';
  const after = prefix + '{ "range\\u0045nd" : "2196-10-09", "unknown":9007199254740993, "value":1e+03 }\n';
  const move = await prepareAcademicCalendarMoveRequest(...inputs(before, true));
  assert.ok(move.params.p_expected_note_sha256 === fingerprint(before), 'source fingerprint preserves unknown original bytes');
  assert.ok(move.expectedReceipt.noteSha256 === fingerprint(after), 'result fingerprint preserves every byte outside the end token');
  assert.ok(move.params.p_next_end_date === '2196-10-09' && move.expectedReceipt.endsAt === '2196-10-09', 'inclusive end remains in the request and receipt');
});

function replaceDigest(t, digest) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: { digest } } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  });
}

test('move RPC captures both original and expected source before asynchronous digest work', async t => {
  const note = '합성 snapshot';
  const source = inputs(note);
  let release;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  replaceDigest(t, async (algorithm, bytes) => {
    const value = await webcrypto.subtle.digest(algorithm, bytes);
    if (++calls === 1) {
      entered();
      await new Promise(resolve => { release = resolve; });
    }
    return value;
  });
  const pending = prepareAcademicCalendarMoveRequest(...source);
  await ready;
  source[0].storedNote = 'changed synthetic snapshot';
  source[0].endsAt = '2196-12-31';
  source[2].endDate.setDate(20);
  release();
  const move = await pending;
  assert.ok(move.params.p_expected_note_sha256 === fingerprint(note), 'source fingerprint is bound to the first snapshot');
  assert.ok(move.expectedReceipt.noteSha256 === fingerprint(note), 'result fingerprint is bound to the same snapshot');
  assert.ok(move.params.p_expected_end_date === '2196-10-06' && move.params.p_next_end_date === '2196-10-07', 'dates cannot change during digest awaits');
});

for (const [label, value] of [
  ['unpaired high surrogate', 'synthetic\ud800'], ['unpaired low surrogate', '\udc00synthetic'],
  ['non-string source', { note: 'synthetic' }],
]) {
  test(`move RPC rejects ${label} before transport without exposing input`, async () => {
    let caught;
    try { await prepareAcademicCalendarMoveRequest(...inputs(value)); } catch (error) { caught = error; }
    assert.ok(caught instanceof Error && caught.message === 'academic_move_source_invalid' && caught.cause === undefined,
      'invalid input has only the fixed error and no attached cause');
  });
}

test('move RPC digest rejection cannot expose native error details or source values', async t => {
  replaceDigest(t, async () => { throw new Error('synthetic native detail that must stay internal'); });
  let caught;
  try { await prepareAcademicCalendarMoveRequest(...inputs('synthetic source')); } catch (error) { caught = error; }
  assert.ok(caught instanceof Error && caught.message === 'academic_move_source_invalid' && caught.cause === undefined,
    'crypto rejection has only the fixed error and no attached cause');
});

test('move RPC transport uses the SDK default POST, one call, timeout, and retry false', async () => {
  const calls = [];
  const params = { synthetic: true };
  const response = { data: null, error: null };
  const builder = {
    abortSignal(signal) { calls.push({ method: 'abortSignal', valid: signal instanceof AbortSignal }); return this; },
    retry(value) { calls.push({ method: 'retry', value }); return this; },
    then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
  };
  const client = { rpc(...args) { calls.push({ method: 'rpc', args }); return builder; } };
  const result = await writeAcademicCalendarMove(client, params);
  assert.ok(result === response && calls.length === 3, 'single SDK chain returns its result');
  assert.ok(calls[0].method === 'rpc' && calls[0].args.length === 2
    && calls[0].args[0] === 'move_academic_event_dates_v1' && calls[0].args[1] === params,
  'RPC receives only its name and body, with no GET/head options or URL filters');
  assert.ok(calls[1].method === 'abortSignal' && calls[1].valid && calls[2].method === 'retry' && calls[2].value === false,
    'transport is bounded and automatic retries are disabled');
});

const expected = { id, date: '2196-10-07', endsAt: '2196-10-07', noteSha256: null };
test('move RPC confirms only an exact receipt including an own null fingerprint', () => {
  assert.ok(isConfirmedAcademicCalendarMove({ data: { ...expected }, error: null }, expected));
});

for (const [label, result] of [
  ['missing response', undefined], ['null data', { data: null }], ['array data', { data: [{ ...expected }] }],
  ['server error', { data: { ...expected }, error: { message: 'synthetic' } }],
  ['wrong identity', { data: { ...expected, id: 'different' } }],
  ['wrong start', { data: { ...expected, date: '2196-10-06' } }],
  ['wrong end', { data: { ...expected, endsAt: '2196-10-08' } }],
  ['wrong fingerprint', { data: { ...expected, noteSha256: '' } }],
  ['missing fingerprint', { data: { id, date: expected.date, endsAt: expected.endsAt } }],
  ['inherited fingerprint', { data: Object.assign(Object.create({ noteSha256: null }), { id, date: expected.date, endsAt: expected.endsAt }) }],
  ['unexpected raw-note field', { data: { ...expected, note: 'synthetic' } }],
]) {
  test(`move RPC leaves ${label} unconfirmed`, () => {
    assert.ok(!isConfirmedAcademicCalendarMove(result, expected), 'receipt mismatch cannot be a confirmed success');
  });
}
