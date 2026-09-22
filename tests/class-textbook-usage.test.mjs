import test from 'node:test';
import assert from 'node:assert/strict';
import { readClassTextbookUsage, buildClassTextbookUsage, classTextbookUsageError } from '../src/features/management/class-textbook-usage.ts';

test('usage accepts open dates and valid leap dates but rejects impossible or reversed dates', () => {
  for (const [startDate, endDate] of [['', ''], ['2028-02-29', ''], ['', '2026-10-01'], ['2026-09-22', '2026-09-22']]) {
    assert.equal(classTextbookUsageError({ startDate, endDate, title: '' }), '');
  }
  for (const [startDate, endDate] of [['2026-02-29', ''], ['2026-13-01', ''], ['2026-9-01', ''], ['2026-10-01', '2026-09-30']]) {
    assert.notEqual(classTextbookUsageError({ startDate, endDate, title: '' }), '');
    assert.throws(() => buildClassTextbookUsage({ a: { startDate, endDate } }, ['a']));
  }
});

test('saving selected books preserves historical titles and removes usage only for removed books', () => {
  const source = { deletedCatalogBook: { title: '보존 교재', startDate: '2026-09-01', endDate: null }, removed: { title: '제거', startDate: '', endDate: '' } };
  const result = buildClassTextbookUsage(JSON.stringify(source), ['deletedCatalogBook', 'newBook']);
  assert.deepEqual(result, { deletedCatalogBook: { title: '보존 교재', startDate: '2026-09-01', endDate: '' } });
  assert.equal(source.deletedCatalogBook.endDate, null);
  assert.deepEqual(readClassTextbookUsage(undefined), {});
});
