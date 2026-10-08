import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { bootstrapRecoveryScript } from '../src/lib/bootstrap-recovery.ts';

function fixture(path = '/admin/registration?taskPage=2#draft') {
  const dom = new JSDOM('<input id="draft" value="합성 미저장 입력"><button>저장</button>', {
    url: `https://fixture.invalid${path}`, runScripts: 'outside-only',
  });
  dom.window.eval(bootstrapRecoveryScript);
  return dom;
}
function failScript(window, src = '/_next/static/chunks/7047-old.js') {
  const script = window.document.createElement('script');
  script.src = src;
  window.document.head.append(script);
  script.dispatchEvent(new window.Event('error'));
}

test('initial failed Next script shows one notice without remounting, changing focus or losing a draft', () => {
  const dom = fixture(), { window } = dom, doc = window.document;
  try {
    const input = doc.getElementById('draft'), button = doc.querySelector('button'), url = window.location.href;
    input.focus();
    failScript(window);
    failScript(window);
    assert.equal(doc.querySelectorAll('[role="alert"]').length, 1);
    assert.equal(doc.getElementById('draft'), input);
    assert.equal(input.value, '합성 미저장 입력');
    assert.equal(doc.activeElement, input);
    assert.equal(doc.querySelector('button'), button);
    assert.equal(window.location.href, url);
    const link = doc.querySelector('aside a'), reopened = new URL(link.href);
    assert.ok(reopened.searchParams.get('_tips_recovery'));
    reopened.searchParams.delete('_tips_recovery');
    assert.equal(reopened.href, url);
    assert.equal(link.target, '_blank');
    assert.match(link.rel, /noopener/);
    doc.querySelector('aside button').click();
    assert.equal(doc.querySelector('aside'), null);
    assert.equal(doc.activeElement, input);
    assert.equal(input.value, '합성 미저장 입력');
    assert.doesNotMatch(bootstrapRecoveryScript, /location\.(assign|replace|reload)|preventDefault|setTimeout|setInterval/);
  } finally { window.close(); }
});

test('unrelated resources/errors and non-admin routes do not raise the notice', () => {
  for (const path of ['/admin/registration', '/sign-in']) {
    const dom = fixture(path), { window } = dom;
    try {
      failScript(window, 'https://unrelated.invalid/_next/static/foreign.js');
      failScript(window, '/custom.js');
      const css = window.document.createElement('link');
      css.href = '/_next/static/css/missing.css';
      window.document.head.append(css);
      css.dispatchEvent(new window.Event('error'));
      window.dispatchEvent(new window.ErrorEvent('error', { message: 'business validation' }));
      if (path === '/sign-in') failScript(window);
      assert.equal(window.document.querySelector('aside'), null);
    } finally { window.close(); }
  }
});

test('dynamic chunk rejection is reported without suppressing the original event', () => {
  const dom = fixture(), { window } = dom;
  try {
    const event = new window.Event('unhandledrejection', { cancelable: true });
    event.reason = { name: 'ChunkLoadError', request: 'https://fixture.invalid/_next/static/chunks/7047-old.js' };
    window.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assert.ok(window.document.querySelector('[role="alert"]'));
  } finally { window.close(); }
});

test('script failure before body exists waits for DOM readiness without polling', () => {
  const dom = fixture(), { window } = dom;
  try {
    window.document.body.remove();
    failScript(window);
    failScript(window);
    window.document.documentElement.append(window.document.createElement('body'));
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    assert.equal(window.document.querySelectorAll('aside').length, 1);
  } finally { window.close(); }
});


test('a completed cached 404 is detected even when its error event preceded bootstrap', () => {
  const dom = new JSDOM('<input value="합성 초안">', { url: 'https://fixture.invalid/admin/registration', runScripts: 'outside-only' });
  const { window } = dom;
  try {
    window.performance.getEntriesByType = () => [
      { initiatorType: 'script', responseStatus: 200, name: 'https://fixture.invalid/_next/static/good.js' },
      { initiatorType: 'script', responseStatus: 0, name: 'https://fixture.invalid/_next/static/unknown.js' },
    ];
    window.eval(bootstrapRecoveryScript);
    assert.equal(window.document.querySelector('aside'), null);
    window.performance.getEntriesByType = () => [
      { initiatorType: 'script', responseStatus: 404, name: 'https://fixture.invalid/_next/static/old.js' },
    ];
    window.eval(bootstrapRecoveryScript);
    assert.ok(window.document.querySelector('[role="alert"]'));
    assert.equal(window.document.querySelector('input').value, '합성 초안');
  } finally { window.close(); }
});


test('an available React error screen prevents a duplicate bootstrap notice', () => {
  const dom = fixture(), { window } = dom;
  try {
    const fallback = window.document.createElement('main');
    fallback.setAttribute('data-page-recovery', '');
    window.document.body.append(fallback);
    failScript(window);
    assert.equal(window.document.querySelector('aside'), null);
  } finally { window.close(); }
});
