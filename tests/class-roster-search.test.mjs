import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesClassRosterSearch, buildClassRosterReturnPath } from '../src/features/management/class-roster-search.ts';

test('roster search matches names, school and grade words without treating missing fields as text', () => {
  const fields = ['합성 학생', '제주중학교', '중3', null, undefined];
  assert.equal(matchesClassRosterSearch(' 학생  제주 중3 ', fields), true);
  assert.equal(matchesClassRosterSearch('고1', fields), false);
  assert.equal(matchesClassRosterSearch('undefined', fields), false);
  assert.equal(matchesClassRosterSearch('   ', fields), true);
});

test('contact searches accept formatting but never join two contacts into a false match', () => {
  assert.equal(matchesClassRosterSearch('010-1234', ['01012345678']), true);
  assert.equal(matchesClassRosterSearch('12345678', ['010-1234-5678']), true);
  assert.equal(matchesClassRosterSearch('5678010', ['01012345678', '01098765432']), false);
});

test('student return URL retains accepted class search, filters, sort, page and prior return context', () => {
  const search = new URLSearchParams({ q: '고2 영어', subject: '영어', teacher: '담당', page: '3', sort: '[{"id":"title","desc":true}]', returnTo: '/admin/curriculum?page=2', studentId: 'old', section: 'retired', sessionId: 'retired' });
  const result = new URL(buildClassRosterReturnPath(search.toString(), 'class-1', 'students', 'student-2'), 'https://example.invalid');
  for (const key of ['q', 'subject', 'teacher', 'page', 'sort', 'returnTo']) assert.equal(result.searchParams.get(key), search.get(key));
  assert.equal(result.searchParams.get('classId'), 'class-1');
  assert.equal(result.searchParams.get('tab'), 'students');
  assert.equal(result.searchParams.get('studentId'), 'student-2');
  assert.equal(result.searchParams.has('section'), false);
  assert.equal(result.searchParams.has('sessionId'), false);
  assert.equal(new URL(buildClassRosterReturnPath(search.toString(), 'class-1', 'basic'), result).searchParams.has('studentId'), false);
});
