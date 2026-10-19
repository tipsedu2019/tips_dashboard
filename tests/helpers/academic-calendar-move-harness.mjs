import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';
import { loadNotificationComponent } from './notification-component-loader.mjs';
import { extractAcademicEventNoteMetadata, stripAcademicEventNoteMetadata } from '../../src/features/operations/academic-event-utils.js';
import { buildAcademicCalendarMovePatch } from '../../src/features/operations/academic-calendar-move.js';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const { act, createElement } = require('react');
const sourceFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/academic-calendar-inclusive-range-sql-output.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);
const seed = sourceFixture.details[0];
const moveRpc = 'move_academic_event_dates_v1';
const moveParameters = ['p_event_id', 'p_expected_date', 'p_expected_end_date', 'p_expected_note_sha256', 'p_next_date', 'p_next_end_date'];
const noteHash = note => note === null ? null : createHash('sha256').update(note, 'utf8').digest('hex');
const localDay = value => new Date(`${value}T12:00:00`);

export const academicId = index => `93991000-0000-4000-8000-${String(index).padStart(12, '0')}`;
export function academicRow(patch = {}) {
  return { id: academicId(1), school_id: seed.schoolId, title: '합성 날짜 이동', type: '영어시험일',
    date: '2196-10-06', grade: '고1', note: '합성 원문', content: '합성 별도 내용 보존', created_at: '2196-01-01T00:00:00Z', ...patch };
}

// Production Workspace, Calendar, grid, read service and mutation code are loaded
// unchanged. Only auth/router/toast and the external database transport are synthetic.
export async function setupAcademicMove(t, { records = [academicRow()], initialDate = records[0].date, holdDetails = false, holdWrites = false, holdDigests = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: `https://test.invalid/admin/academic-calendar?date=${initialDate}`, pretendToBeVisual: true,
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  for (const name of ['window', 'self', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : dom.window[name] });
  }
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  window.HTMLElement.prototype.scrollIntoView = () => {};
  // The importing CI entry loads react-dom before JSDOM. Its legacy input-event
  // feature probe therefore needs the same harmless DOM compatibility hooks.
  window.HTMLElement.prototype.attachEvent = () => {};
  window.HTMLElement.prototype.detachEvent = () => {};
  window.scrollTo = () => {};
  window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
  const deny = name => () => { throw Error(`academic move harness denies ${name}`); };
  window.fetch = deny('fetch');
  window.XMLHttpRequest.prototype.open = deny('XHR');
  window.WebSocket = deny('WebSocket');
  if (window.navigator.sendBeacon) window.navigator.sendBeacon = deny('sendBeacon');
  const { createRoot } = require('react-dom/client');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let mounted = true;
  const digests = [];
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const unmount = async () => { if (mounted) { await act(async () => root.unmount()); mounted = false; } };
  t.after(async () => {
    try { await unmount(); }
    finally {
      for (const digest of digests) digest.release();
      if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
      else delete globalThis.crypto;
      host.remove(); dom.window.close();
    }
  });
  // Always perform the real digest. A gate delays only delivery of its result,
  // so the workspace's ownership checks are exercised across a real await.
  const subtle = new Proxy(webcrypto.subtle, {
    get(target, key) {
      if (key !== 'digest') {
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (algorithm, input) => {
        const gate = Promise.withResolvers();
        const ordinal = digests.length + 1;
        const held = holdDigests === true || holdDigests === ordinal;
        const request = { ordinal, held, ready: false, settled: false, released: false,
          release() { request.released = true; gate.resolve(); } };
        digests.push(request);
        try {
          const result = await target.digest(algorithm, input);
          request.ready = true;
          if (held) await gate.promise;
          return result;
        } finally { request.settled = true; }
      };
    },
  });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: new Proxy(webcrypto, {
    get(target, key) {
      if (key === 'subtle') return subtle;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) });

  const rows = new Map(records.map(row => [row.id, clone(row)]));
  const before = clone(records);
  const reads = [], attempts = [], writes = [], toasts = [];
  let auth = { user: { id: '93993000-0000-4000-8000-000000000005' }, profile: null, role: 'admin', loading: false, canManageAll: true };
  const params = new URLSearchParams(`date=${initialDate}`);

  function endDate(row) {
    const raw = extractAcademicEventNoteMetadata(row.note).rangeEnd;
    return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw >= row.date ? raw : row.date;
  }
  function projectList(row) {
    const note = stripAcademicEventNoteMetadata(row.note).slice(0, 160);
    return { ...clone(sourceFixture.calendar.rows[0]), id: row.id, sourceId: row.id,
      schoolId: row.school_id, title: row.title, typeLabel: row.type, eventType: 'task', startsAt: row.date, endsAt: endDate(row),
      durationLabel: endDate(row) === row.date ? '하루 일정' : `${row.date} ~ ${endDate(row)}`,
      grade: row.grade, attendees: [row.grade], description: note, notePreview: note,
      examTerm: null, scopeSummary: null, scienceAreaKey: null, scienceAreaLabel: null };
  }
  function projectDetail(row) {
    const plain = stripAcademicEventNoteMetadata(row.note);
    return { ...clone(seed), ...projectList(row), storedNote: row.note, note: plain, description: plain,
      embeddedNoteMeta: null, textbookScopes: [], subtextbookScopes: [], materialSections: [] };
  }
  function makeDeferred(metadata) {
    const deferred = Promise.withResolvers();
    const request = { ...metadata, ...deferred, settled: false };
    const q = {
      limit() { return q; }, abortSignal(signal) { request.signal = signal; return q; },
      retry(value) { assert.equal(value, false, 'reads do not retry independently'); return q; },
      then: deferred.promise.then.bind(deferred.promise),
    };
    return { request, q };
  }
  function resolveRead(request, error = null, detailOverride) {
    assert.equal(request.settled, false, 'each synthetic response settles once');
    request.settled = true;
    request.resolve({ data: error ? null : clone(detailOverride === undefined ? request.response : detailOverride), error });
  }
  function completeWrite(request, error = null, responseOverride) {
    assert.equal(request.settled, false);
    request.settled = true;
    if (error) { request.resolve({ data: null, error }); return; }
    const args = request.args;
    const row = rows.get(args.p_event_id);
    if (!row || row.date !== args.p_expected_date || noteHash(row.note) !== args.p_expected_note_sha256) {
      request.resolve({ data: null, error: { code: 'PT409', message: 'synthetic source conflict' } });
      return;
    }
    // This is a synthetic UI transport oracle, not execution of the SQL proposal.
    // Reuse the already-tested raw-token builder only to model the server effect;
    // the RPC caller's six parameters and expected receipt are checked separately.
    const { patch } = buildAcademicCalendarMovePatch(projectDetail(row), {
      id: row.id, sourceId: row.id, date: localDay(args.p_expected_date), endDate: localDay(args.p_expected_end_date),
    }, {
      id: row.id, sourceId: row.id, date: localDay(args.p_next_date), endDate: localDay(args.p_next_end_date),
    });
    Object.assign(row, clone(patch));
    writes.push({ id: row.id, payload: clone(patch), args: clone(args) });
    const receipt = { id: row.id, date: row.date, endsAt: endDate(row), noteSha256: noteHash(row.note) };
    request.resolve({ data: responseOverride === undefined ? receipt : clone(responseOverride), error: null });
  }
  const client = {
    rpc(name, args = {}, options = {}) {
      if (name === moveRpc) {
        assert.deepEqual(Object.keys(args).sort(), [...moveParameters].sort(), 'move RPC accepts exactly six body parameters');
        assert.notEqual(options.get, true, 'the mutation must use POST, never GET');
        assert.notEqual(options.head, true, 'the mutation must return its receipt');
        assert.ok(args.p_expected_note_sha256 === null || /^[0-9a-f]{64}$/.test(args.p_expected_note_sha256), 'body contains only a canonical note fingerprint');
        const { request } = makeDeferred({ name, args: clone(args), method: 'POST', retry: null, signal: null });
        let started = false;
        const query = {
          abortSignal(signal) { request.signal = signal; return query; },
          retry(value) { assert.equal(value, false, 'calendar moves must not automatically retry writes'); request.retry = value; return query; },
          then(resolve, reject) {
            if (!started) {
              started = true;
              assert.equal(request.retry, false, 'RPC write explicitly disables automatic retry');
              assert.ok(request.signal, 'RPC write has a bounded abort signal');
              attempts.push(request);
              if (!holdWrites) completeWrite(request);
            }
            return request.promise.then(resolve, reject);
          },
        };
        return query;
      }
      const { request, q } = makeDeferred({ name, args: clone(args), writesAtRead: writes.length });
      reads.push(request);
      if (name === 'get_operations_calendar_range_v1') request.response = { ...clone(sourceFixture.calendar),
        range: { dateFrom: args.p_date_from, dateTo: args.p_date_to },
        rows: [...rows.values()].filter(row => row.date <= args.p_date_to && endDate(row) >= args.p_date_from).map(projectList) };
      else if (name === 'get_academic_event_detail_v1') {
        const row = rows.get(args.p_event_id);
        assert.ok(row, 'detail request targets an existing synthetic event');
        request.response = projectDetail(row);
      } else if (name === 'list_operations_catalogs_v1') request.response = { academicSchools: [{ id: seed.schoolId, name: seed.schoolName, category: 'high' }] };
      else if (name === 'list_active_science_subject_areas_v1') request.response = [];
      else assert.fail(`unmodeled RPC denied: ${name}`);
      if (name !== 'get_academic_event_detail_v1' || !holdDetails) resolveRead(request);
      return q;
    },
    from() { assert.fail('calendar moves must use the body RPC, never a raw-note table PATCH'); },
  };
  const { AcademicCalendarWorkspace } = loadNotificationComponent('src/features/operations/academic-calendar-workspace.tsx', new Map([
    ['next/navigation', { useRouter: () => ({ push() {} }), useSearchParams: () => params }],
    ['@/providers/auth-provider', { useAuth: () => auth }],
    ['@/lib/supabase', { supabase: client }],
    ['sonner', { toast: { success: message => toasts.push({ kind: 'success', message }),
      error: message => toasts.push({ kind: 'error', message }), info: message => toasts.push({ kind: 'info', message }) } }],
  ]));
  const render = () => act(async () => root.render(createElement(AcademicCalendarWorkspace)));
  async function waitFor(predicate, message = 'actual UI did not settle') {
    for (let i = 0; i < 180; i++) {
      if (predicate()) return;
      await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    }
    assert.ok(predicate(), message);
  }
  async function flush() { await act(async () => new Promise(resolve => setTimeout(resolve, 5))); }
  function eventButton(id, { draggableOnly = true } = {}) {
    const title = rows.get(id)?.title;
    const nodes = [...host.querySelectorAll('[aria-label]')].filter(node => node.getAttribute('aria-label') === `${title} 상세 보기`);
    const node = draggableOnly ? nodes.find(node => node.getAttribute('draggable') === 'true') : nodes.find(node => node.hasAttribute('draggable')) || nodes[0];
    assert.ok(node, `actual event button exists: ${id}`);
    return node;
  }
  async function drag(id, targetDate, { button = eventButton(id) } = {}) {
    const [, month, day] = targetDate.split('-');
    await act(async () => button.dispatchEvent(new window.Event('dragstart', { bubbles: true, cancelable: true })));
    const target = [...host.querySelectorAll(`[aria-label="${Number(month)}월 ${Number(day)}일 선택"]`)].find(node => node.closest('div.group'))?.closest('div.group');
    assert.ok(target, `actual month-grid target exists: ${targetDate}`);
    await act(async () => target.dispatchEvent(new window.Event('dragover', { bubbles: true, cancelable: true })));
    await act(async () => target.dispatchEvent(new window.Event('drop', { bubbles: true, cancelable: true })));
    await flush();
  }
  async function clickLabel(label) {
    const node = [...host.querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === label);
    assert.ok(node, `actual action exists: ${label}`);
    await act(async () => node.click());
    await flush();
  }
  async function clickButtonText(text) {
    const node = [...host.querySelectorAll('button')].find(button => button.textContent.trim() === text);
    assert.ok(node, `actual button exists: ${text}`);
    await act(async () => node.click());
    await flush();
  }
  await render();
  await waitFor(() => host.querySelector(`[aria-label="${records[0].title} 상세 보기"][draggable="true"]`));
  return { rows, before, reads, attempts, writes, toasts, digests, host, drag, eventButton, clickLabel, clickButtonText, waitFor, flush, unmount,
    pendingDetails: () => reads.filter(request => request.name === 'get_academic_event_detail_v1' && !request.settled),
    resolveDetail: (request, options = {}) => act(async () => resolveRead(request, options.error ?? null, options.detail)),
    resolveWrite: (request, error = null, responseOverride) => act(async () => completeWrite(request, error, responseOverride)),
    pendingDigests: () => digests.filter(request => request.held && request.ready && !request.settled),
    resolveDigest: request => act(async () => { assert.equal(request.released, false); request.release(); }),
    changeActor: async patch => { auth = { ...auth, ...patch }; await render(); await flush(); },
    externalChange: (id, patch) => Object.assign(rows.get(id), clone(patch)),
  };
}
