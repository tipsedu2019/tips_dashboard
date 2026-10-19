import assert from 'node:assert/strict';
import test from 'node:test';
import { academicId, academicRow, setupAcademicMove } from './helpers/academic-calendar-move-harness.mjs';

const longText = `  합성 본문 ${'원문 보존 '.repeat(40)}끝까지 보존\r\n\t `;
const metadata = {
  examTerm: '1학기 중간', textbookScope: '교과서 1~3단원', subtextbookScope: '부교재 20~30쪽',
  textbookScopes: [{ name: '합성 교과서', publisher: '합성 출판사', scope: '1~3단원' }],
  subtextbookScopes: [{ name: '합성 부교재', publisher: '합성 출판사', scope: '20~30쪽' }],
  future: { enabled: false, values: [0, null, '원문 메타데이터'] }, legacyFlag: 'unknown-key-preserved',
};
const markedNote = `${longText}[[TIPS_META]] \n${JSON.stringify(metadata, null, 2)}  \n`;

async function assertSaved(h, expectedRows) {
  await h.waitFor(() => h.writes.length === 1 && h.toasts.some(toast => toast.kind === 'success'));
  assert.deepEqual([...h.rows.values()], expectedRows, 'only the intended date/range-end bytes changed');
  assert.equal(h.attempts.length, 1, 'one actual drag makes one mutation attempt');
  assert.ok(Object.keys(h.writes[0].payload).every(key => ['date', 'note'].includes(key)), 'move must not rewrite title, school, grade, content or type');
  assert.ok(h.reads.some(read => read.name === 'get_academic_event_detail_v1' && read.writesAtRead === 0), 'actual full-detail service runs before the write');
  await h.waitFor(() => h.reads.some(read => read.name === 'get_operations_calendar_range_v1' && read.writesAtRead === 1), 'accepted move refreshes the actual range');
}

for (const [name, note] of [['long metadata', markedNote], ['short whitespace', '  짧은 원문\r\n\t '], ['empty string', ''], ['null', null]]) {
  test(`academic move preserves ${name} exactly on a single-day drag`, async t => {
    const row = academicRow({ note });
    const h = await setupAcademicMove(t, { records: [row] });
    await h.drag(row.id, '2196-10-07');
    await assertSaved(h, [{ ...row, date: '2196-10-07' }]);
  });
}

for (const [start, end, target, nextEnd] of [
  ['2196-10-06', '2196-10-08', '2196-10-07', '2196-10-09'],
  ['2196-11-30', '2196-12-02', '2196-12-01', '2196-12-03'],
  ['2196-02-28', '2196-03-02', '2196-03-01', '2196-03-04'],
]) {
  test(`academic move preserves inclusive duration and raw metadata from ${start} to ${target}`, async t => {
    const rawMetadata = { ...metadata, future: { rangeEnd: end, repeatedDate: end }, rangeEnd: end };
    const note = `${longText}[[TIPS_META]] \n${JSON.stringify(rawMetadata, null, 2)} \n`;
    const expectedNote = `${longText}[[TIPS_META]] \n${JSON.stringify({ ...rawMetadata, rangeEnd: nextEnd }, null, 2)} \n`;
    const row = academicRow({ date: start, note });
    const h = await setupAcademicMove(t, { records: [row] });
    await h.drag(row.id, target);
    await assertSaved(h, [{ ...row, date: target, note: expectedNote }]);
  });
}

test('academic move failed full-detail read writes nothing and a fresh drag can retry', async t => {
  const row = academicRow({ note: markedNote });
  const h = await setupAcademicMove(t, { records: [row], holdDetails: true });
  await h.drag(row.id, '2196-10-07');
  assert.equal(h.pendingDetails().length, 1);
  await h.resolveDetail(h.pendingDetails()[0], { error: { code: '57014', message: 'synthetic read failure' } });
  await h.waitFor(() => h.toasts.some(toast => toast.kind === 'error'));
  assert.deepEqual([...h.rows.values()], [row]);
  assert.equal(h.attempts.length, 0);
  assert.equal(h.toasts.some(toast => toast.kind === 'success'), false);
  await h.waitFor(() => h.eventButton(row.id, { draggableOnly: false }).getAttribute('draggable') === 'true');
  await h.drag(row.id, '2196-10-08');
  assert.equal(h.pendingDetails().length, 1, 'retry obtains a new full detail');
  await h.resolveDetail(h.pendingDetails()[0]);
  await assertSaved(h, [{ ...row, date: '2196-10-08' }]);
});

for (const transition of ['actor', 'navigation', 'other event', 'unmount']) {
  test(`academic move ignores a late detail after ${transition} changes its owner`, async t => {
    const first = academicRow({ note: markedNote });
    const second = academicRow({ id: academicId(2), title: '합성 다른 일정', date: '2196-10-10' });
    const h = await setupAcademicMove(t, { records: [first, second], holdDetails: true });
    await h.drag(first.id, '2196-10-07');
    const oldRead = h.pendingDetails()[0];
    assert.ok(oldRead);
    if (transition === 'actor') await h.changeActor({ user: { id: '93993000-0000-4000-8000-000000000006' } });
    else if (transition === 'navigation') await h.clickLabel('다음 달');
    else if (transition === 'unmount') await h.unmount();
    else {
      await h.clickLabel(`${second.title} 상세 보기`);
      const secondRead = h.pendingDetails().find(read => read.args.p_event_id === second.id);
      assert.ok(secondRead, 'the second event opens its own real detail flow');
      await h.resolveDetail(secondRead);
      await h.waitFor(() => document.querySelector('#title')?.value === second.title);
    }
    await h.resolveDetail(oldRead);
    await h.flush();
    assert.equal(h.attempts.length, 0, 'late response must not begin a write for the abandoned action');
    assert.deepEqual([...h.rows.values()], [first, second]);
    assert.equal(h.toasts.some(toast => toast.kind === 'success'), false);
    if (transition === 'other event') assert.equal(document.querySelector('#title').value, second.title, 'old move must not replace the current detail');
  });
}

test('academic move locks duplicate drags while its exact detail is pending', async t => {
  const row = academicRow({ note: markedNote });
  const h = await setupAcademicMove(t, { records: [row], holdDetails: true });
  const originalButton = h.eventButton(row.id);
  await h.drag(row.id, '2196-10-07', { button: originalButton });
  assert.equal(h.pendingDetails().length, 1);
  assert.equal(h.eventButton(row.id, { draggableOnly: false }).getAttribute('draggable'), 'false', 'only drag interaction is locked while a move is pending');
  await h.drag(row.id, '2196-10-08', { button: originalButton });
  assert.equal(h.pendingDetails().length, 1, 'a duplicate gesture must not start another detail or mutation');
  await h.resolveDetail(h.pendingDetails()[0]);
  await assertSaved(h, [{ ...row, date: '2196-10-07' }]);
});

test('academic move rejects a full detail whose date changed since the accepted calendar row', async t => {
  const row = academicRow({ note: markedNote });
  const h = await setupAcademicMove(t, { records: [row] });
  h.externalChange(row.id, { date: '2196-10-09' });
  await h.drag(row.id, '2196-10-07');
  await h.waitFor(() => h.toasts.some(toast => toast.kind === 'error'));
  assert.equal(h.attempts.length, 0);
  assert.equal(h.rows.get(row.id).date, '2196-10-09');
  assert.equal(h.rows.get(row.id).note, row.note);
  assert.equal(h.toasts.some(toast => toast.kind === 'success'), false);
});

for (const changedField of ['date', 'note']) {
  test(`academic move does not overwrite a concurrent ${changedField} edit after the full-detail read`, async t => {
    const row = academicRow({ note: markedNote });
    const h = await setupAcademicMove(t, { records: [row], holdWrites: true });
    await h.drag(row.id, '2196-10-07');
    await h.waitFor(() => h.attempts.length === 1);
    const patch = changedField === 'date' ? { date: '2196-10-09' } : { note: `${markedNote} ` };
    h.externalChange(row.id, patch);
    await h.resolveWrite(h.attempts[0]);
    await h.waitFor(() => h.toasts.some(toast => toast.kind === 'error'));
    assert.equal(h.writes.length, 0, 'date and full stored note predicates must reject a changed source');
    assert.deepEqual([...h.rows.values()], [{ ...row, ...patch }]);
    assert.equal(h.toasts.some(toast => toast.kind === 'success'), false);
  });
}

const typeFilterLabel = '영어 시험일 및 시험범위 · 1';
const rangeReads = h => h.reads.filter(read => read.name === 'get_operations_calendar_range_v1');

for (const transition of ['filter', 'navigation']) {
  for (const outcome of ['confirmed', 'error']) {
    test(`academic move ${outcome} write response refreshes the current range after a ${transition} change without reviving its gesture`, async t => {
      const row = academicRow({ note: markedNote });
      const h = await setupAcademicMove(t, { records: [row], holdWrites: true });
      await h.drag(row.id, '2196-10-07');
      await h.waitFor(() => h.attempts.length === 1);
      if (transition === 'filter') await h.clickButtonText(typeFilterLabel);
      else await h.clickLabel('다음 달');
      const currentHeading = h.host.querySelector('[data-calendar-heading]').textContent;
      assert.equal(currentHeading, transition === 'filter' ? '2196년 10월' : '2196년 11월');
      const currentRange = structuredClone(rangeReads(h).at(-1).args);
      const readCount = rangeReads(h).length;
      await h.resolveWrite(h.attempts[0], outcome === 'error' ? { message: 'synthetic late transport failure' } : null);
      await h.waitFor(() => rangeReads(h).length > readCount, 'a write that may have reached the server refreshes the currently selected range');
      assert.deepEqual(rangeReads(h).at(-1).args, currentRange, 'refresh must use the latest range, not the abandoned action range');
      assert.equal(h.host.querySelector('[data-calendar-heading]').textContent, currentHeading, 'late response cannot navigate back');
      assert.deepEqual(h.toasts, [], 'an abandoned gesture must not emit a delayed success/error toast');
      assert.equal(h.attempts.length, 1, 'refresh never retries the mutation');
      assert.deepEqual([...h.rows.values()], [{ ...row, date: outcome === 'confirmed' ? '2196-10-07' : row.date }]);
      assert.equal(h.host.querySelector(`[aria-label="${row.title} 상세 보기"]`), null, 'current month/filter remains selected');
      if (outcome === 'error') {
        const alert = [...h.host.querySelectorAll('[role="alert"]')].find(node => node.textContent.includes('일정 이동 결과를 확인하지 못했습니다.'));
        assert.ok(alert, 'the same mounted actor receives a persistent unconfirmed-result notice');
        assert.match(alert.textContent, /일정을 다시 불러와 날짜를 확인/);
        const beforeRetry = rangeReads(h).length;
        await h.clickButtonText('다시 불러오기');
        await h.waitFor(() => rangeReads(h).length > beforeRetry);
        assert.deepEqual(rangeReads(h).at(-1).args, currentRange);
        assert.equal(document.activeElement, h.host.querySelector('[data-calendar-heading]'), 'confirmation read returns focus to the current calendar heading');
        assert.equal(h.attempts.length, 1, 'confirmation retry only reads');
      } else if (transition === 'filter') {
        assert.equal(rangeReads(h).at(-1).response.rows.find(event => event.id === row.id)?.startsAt, '2196-10-07', 'the latest real range read returns the committed day while the selected filter remains hidden');
      }
    });
  }
}

for (const transition of ['actor', 'unmount']) {
  test(`academic move sent before ${transition} change cannot update the new UI owner after its response`, async t => {
    const row = academicRow({ note: markedNote });
    const h = await setupAcademicMove(t, { records: [row], holdWrites: true });
    await h.drag(row.id, '2196-10-07');
    await h.waitFor(() => h.attempts.length === 1);
    if (transition === 'actor') await h.changeActor({ user: { id: '93993000-0000-4000-8000-000000000006' } });
    else await h.unmount();
    const readCount = h.reads.length;
    const heading = h.host.querySelector('[data-calendar-heading]')?.textContent;
    const alerts = [...h.host.querySelectorAll('[role="alert"]')].map(node => node.textContent);
    const formValue = h.host.querySelector('#title')?.value;
    await h.resolveWrite(h.attempts[0]);
    await h.flush();
    assert.deepEqual([...h.rows.values()], [{ ...row, date: '2196-10-07' }], 'a sent write may already commit; the test does not pretend client cancellation rolls it back');
    assert.equal(h.reads.length, readCount, 'an obsolete owner cannot refresh another actor or unmounted view');
    assert.deepEqual(h.toasts, []);
    assert.equal(h.host.querySelector('[data-calendar-heading]')?.textContent, heading, 'late response cannot navigate the new owner');
    assert.deepEqual([...h.host.querySelectorAll('[role="alert"]')].map(node => node.textContent), alerts);
    assert.equal(h.host.querySelector('#title')?.value, formValue, 'late response cannot replace the new owner form');
    if (transition === 'actor') {
      assert.ok(h.eventButton(row.id, { draggableOnly: false }).closest('div.group')?.querySelector('[aria-label="10월 6일 선택"]'), 'late response does not apply a moved event to the new owner');
    } else assert.equal(h.host.childElementCount, 0);
    assert.equal(h.attempts.length, 1);
  });
}

for (const returned of ['null', 'wrong id', 'wrong date', 'wrong note']) {
  test(`academic move treats a ${returned} write receipt as unconfirmed and reads before any retry`, async t => {
    const row = academicRow({ note: markedNote });
    const h = await setupAcademicMove(t, { records: [row], holdWrites: true });
    await h.drag(row.id, '2196-10-07');
    await h.waitFor(() => h.attempts.length === 1);
    let receipt = { id: row.id, date: '2196-10-07', note: row.note };
    if (returned === 'null') receipt = null;
    if (returned === 'wrong id') receipt.id = academicId(2);
    if (returned === 'wrong date') receipt.date = row.date;
    if (returned === 'wrong note') receipt.note = `${row.note}unexpected`;
    const currentRange = structuredClone(rangeReads(h).at(-1).args);
    await h.resolveWrite(h.attempts[0], null, receipt);
    await h.waitFor(() => h.host.querySelector('[role="alert"]')?.textContent.includes('일정 이동 결과를 확인하지 못했습니다.'));
    assert.equal(h.toasts.some(toast => toast.kind === 'success'), false);
    assert.ok(h.host.querySelector('[role="alert"]')?.textContent.includes('일정 이동 결과를 확인하지 못했습니다.'));
    assert.deepEqual([...h.rows.values()], [{ ...row, date: '2196-10-07' }], 'uncertain receipt does not imply the accepted mutation was rolled back');
    assert.equal(h.attempts.length, 1);
    const beforeRetry = rangeReads(h).length;
    await h.clickButtonText('다시 불러오기');
    await h.waitFor(() => rangeReads(h).length > beforeRetry);
    assert.deepEqual(rangeReads(h).at(-1).args, currentRange);
    assert.equal(document.activeElement, h.host.querySelector('[data-calendar-heading]'));
    assert.equal(h.attempts.length, 1, 'the offered retry confirms the server state without a duplicate write');
  });
}

function patchInputs(storedNote, { start = '2196-10-06', end = '2196-10-08', nextStart = '2196-10-07', nextEnd = '2196-10-09' } = {}) {
  const day = value => new Date(`${value}T12:00:00`);
  const id = academicId(1);
  return [
    { id, sourceId: id, startsAt: start, endsAt: end, storedNote },
    { id, sourceId: id, date: day(start), endDate: day(end) },
    { id, sourceId: id, date: day(nextStart), endDate: day(nextEnd) },
  ];
}

test('academic move parser changes only an escaped top-level rangeEnd value and preserves numeric/string source bytes', async () => {
  const { buildAcademicCalendarMovePatch } = await import('../src/features/operations/academic-calendar-move.js');
  const prefix = '  합성 메모\r\n\t[[TIPS_META]] \n';
  const beforeJson = '{ "future": {"rangeEnd":"2196-10-08","large":9007199254740993,"exponent":1e+03,"minusZero":-0,"decimal":0.00,"quoted":"\\\"rangeEnd\\\":\\\"2196-10-08\\\""},\n  "range\\u0045nd" : "2196-10-08", "examTerm":"1학기 중간" }\t\n';
  const expectedJson = '{ "future": {"rangeEnd":"2196-10-08","large":9007199254740993,"exponent":1e+03,"minusZero":-0,"decimal":0.00,"quoted":"\\\"rangeEnd\\\":\\\"2196-10-08\\\""},\n  "range\\u0045nd" : "2196-10-09", "examTerm":"1학기 중간" }\t\n';
  const storedNote = prefix + beforeJson;
  const result = buildAcademicCalendarMovePatch(...patchInputs(storedNote));
  assert.deepEqual(result, {
    id: academicId(1), originalDate: '2196-10-06', storedNote,
    patch: { date: '2196-10-07', note: prefix + expectedJson },
  });
});

test('academic move parser leaves a nested-only rangeEnd and its raw single-day note unchanged', async () => {
  const { buildAcademicCalendarMovePatch } = await import('../src/features/operations/academic-calendar-move.js');
  const storedNote = ' \n[[TIPS_META]] {"future":{"rangeEnd":"2196-10-08","value":1e+03}}  \n';
  const result = buildAcademicCalendarMovePatch(...patchInputs(storedNote, { end: '2196-10-06', nextEnd: '2196-10-07' }));
  assert.equal(result.id, academicId(1));
  assert.equal(result.originalDate, '2196-10-06');
  assert.equal(result.storedNote, storedNote);
  assert.ok(Object.keys(result.patch).every(key => ['date', 'note'].includes(key)));
  assert.deepEqual({ date: '2196-10-06', note: storedNote, ...result.patch }, { date: '2196-10-07', note: storedNote });
});

for (const [name, storedNote] of [
  ['duplicate rangeEnd', '[[TIPS_META]] {"rangeEnd":"2196-10-08","rangeEnd":"2196-10-08"}'],
  ['escaped duplicate rangeEnd', '[[TIPS_META]] {"rangeEnd":"2196-10-08","range\\u0045nd":"2196-10-08"}'],
  ['repeated metadata marker', '[[TIPS_META]] {"rangeEnd":"2196-10-08","future":"[[TIPS_META]]"}'],
]) {
  test(`academic move parser refuses ${name} before producing a mutation`, async () => {
    const { buildAcademicCalendarMovePatch } = await import('../src/features/operations/academic-calendar-move.js');
    assert.throws(() => buildAcademicCalendarMovePatch(...patchInputs(storedNote)));
  });
}

for (const previousEnd of ['2196-10-03', '2196-10-06']) {
  test(`academic move parser keeps a displayed single-day event single-day when its stored rangeEnd is ${previousEnd}`, async () => {
    const { buildAcademicCalendarMovePatch } = await import('../src/features/operations/academic-calendar-move.js');
    const storedNote = `\t원문\n[[TIPS_META]] { "rangeEnd" : "${previousEnd}", "future": {"rangeEnd":"${previousEnd}"} } \n`;
    const expectedNote = `\t원문\n[[TIPS_META]] { "rangeEnd" : "2196-10-07", "future": {"rangeEnd":"${previousEnd}"} } \n`;
    const result = buildAcademicCalendarMovePatch(...patchInputs(storedNote, { end: '2196-10-06', nextEnd: '2196-10-07' }));
    assert.deepEqual(result, { id: academicId(1), originalDate: '2196-10-06', storedNote, patch: { date: '2196-10-07', note: expectedNote } });
  });
}
