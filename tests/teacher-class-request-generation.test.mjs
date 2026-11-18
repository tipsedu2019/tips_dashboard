import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, StrictMode, useLayoutEffect, useState } from 'react';
import { setup } from './helpers/textbook-numbered-harness.mjs';
import { teacherAuth } from './helpers/teacher-own-request-fixtures.mjs';
import { subjectCatalog, subjectScopeResponse } from './helpers/teacher-subject-fixtures.mjs';

test('#261 shared class context waits for current subject metadata on reentry and re-enable', async t => {
  const external = [], previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { external.push('fetch'); throw new Error('Unexpected external request'); };
  t.after(() => { globalThis.fetch = previousFetch; });
  const h = await setup(t, { auth: teacherAuth, component: { file: 'src/features/teacher-requests/teacher-request-actions.tsx', name: 'TeacherRequestActions' }, props: { domain: 'withdrawal', onChanged() { assert.fail('Unexpected write'); } } });
  const { useTeacherFormClass } = h.load('src/features/teacher-requests/teacher-form-context.tsx');
  const list = 'get_operations_class_schedule_numbered_page_v1', scope = 'get_academic_curriculum_numbered_page_v2';
  const last = name => h.requests.filter(r => r.name === name).at(-1);
  const denied = () => assert.fail('Unexpected permission denial');
  let current, change;
  const commits = [];
  function Probe() {
    const [input, setInput] = useState({ subject: '영어', enabled: true });
    const result = useTeacherFormClass({ ...input, id: '', month: '2026-11', teacher: '', onPermissionDenied: denied });
    useLayoutEffect(() => { current = result; change = setInput; commits.push({ loading: result.loading, teachers: result.teachers }); }, [result]);
    return null;
  }
  function StrictProbe() { return createElement(StrictMode, null, createElement(Probe)); }
  await h.mountTestComponent(StrictProbe, {});
  const finishPage = () => h.resolve(last(list), { page: 1, pageSize: 15, totalCount: 0, rows: [], stats: { total: 0, active: 0, draft: 0 }, filterOptions: { terms: [], subjects: ['영어', '수학'], grades: [], teachers: [], syncGroups: [] }, syncGroupCounts: [] });
  for (const r of h.requests.filter(r => r.name === 'list_operations_catalogs_v1')) await h.resolve(r, subjectCatalog);
  await finishPage();
  await h.resolve(last(scope), subjectScopeResponse(last(scope)));
  assert.equal(current.loading, false);
  assert.ok(current.teachers.includes('가상 교사'));

  await h.act(() => change({ subject: '수학', enabled: true }));
  const stale = last(scope);
  await finishPage();
  const before = commits.length;
  await h.act(() => change({ subject: '영어', enabled: true }));
  const fresh = last(scope);
  assert.notEqual(fresh, stale);
  assert.equal(stale.signal.aborted, true);
  assert.equal(commits[before].loading, true, 'first committed render cannot revive previous successful metadata');
  assert.deepEqual(commits[before].teachers, []);
  await finishPage();
  await h.resolve(stale, subjectScopeResponse(stale));
  assert.equal(current.loading, true, 'current page success alone does not complete current metadata');
  assert.deepEqual(current.teachers, []);
  await h.resolve(fresh, subjectScopeResponse(fresh));
  assert.equal(current.loading, false);
  assert.ok(current.teachers.includes('가상 교사'));
  assert.equal(current.teachers.includes('가상 수학 교사'), false);

  await h.act(() => change({ subject: '영어', enabled: false }));
  const count = h.requests.length;
  await h.act(() => change({ subject: '영어', enabled: true }));
  assert.ok(h.requests.length > count);
  assert.equal(current.loading, true);
  assert.deepEqual(current.teachers, []);
  await finishPage();
  assert.equal(current.loading, true);
  await h.resolve(last(scope), subjectScopeResponse(last(scope)));
  assert.equal(current.loading, false);
  assert.deepEqual(external, []);
  assert.equal(h.requests.some(r => r.table || ![list, scope, 'list_operations_catalogs_v1'].includes(r.name)), false, 'read-only synthetic transport');
});
