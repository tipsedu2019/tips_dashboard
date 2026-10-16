import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { loadNotificationComponent } from './helpers/notification-component-loader.mjs';

async function setup(t) {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1/admin/timetable' });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.sessionStorage = dom.window.sessionStorage;
    for (const key of ['HTMLElement', 'Element', 'MutationObserver', 'CustomEvent', 'Event', 'Node', 'NodeFilter', 'DocumentFragment', 'HTMLInputElement', 'KeyboardEvent']) globalThis[key] = dom.window[key];
    globalThis.getComputedStyle = window.getComputedStyle;
    window.HTMLElement.prototype.getClientRects = function () { return this.hidden || this.style.display === 'none' ? [] : [{ width: 32, height: 32 }]; };
    window.HTMLElement.prototype.scrollIntoView = () => {};
    const source = { id: 'source', name: '다음 학기 프리셋', state: 'draft', metaRevision: 1, changeSequence: 1, targetStartDate: null, targetEndDate: null };
    const deleted = { ...source, id: 'deleted', name: '삭제한 프리셋', state: 'archived', metaRevision: 7 };
    const mutations = [];
    let finish;
    const service = {
        listPlans: async (archived) => ({ plans: archived ? [source, deleted] : [source], total: archived ? 2 : 1, page: 1, pageSize: 30, canManage: true }),
        mutatePlan: command => { mutations.push(command); return new Promise(resolve => { finish = resolve; }); },
    };
    const { TimetablePlanPicker } = loadNotificationComponent('src/features/academic/timetable-plan-picker.tsx', new Map([
        ['@/providers/auth-provider', { useAuth: () => ({ user: { id: 'synthetic-admin' }, role: 'admin', loading: false }) }],
        ['@/lib/supabase', { supabase: {} }],
        ['./timetable-plan-service', { createTimetablePlanService: () => service }],
    ]));
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.getElementById('root'));
    function Fixture() {
        const [planId, setPlanId] = React.useState(source.id);
        return React.createElement(TimetablePlanPicker, { planId, snapshot: planId ? { plan: source, permissions: { canManage: true } } : null, onChange: setPlanId, onCommitted: setPlanId, onRefresh: async () => {}, requestAction: action => action() });
    }
    await React.act(async () => root.render(React.createElement(Fixture)));
    t.after(async () => { await React.act(async () => root.unmount()); dom.window.close(); });
    const settle = () => React.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    const click = async button => { await React.act(async () => { button.focus(); button.click(); }); await settle(); };
    const escape = async () => { await React.act(async () => document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))); await settle(); };
    const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
    const openDelete = async () => {
        const opener = button('더보기');
        await React.act(async () => { opener.focus(); opener.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
        await settle();
        const remove = [...document.querySelectorAll('[role="menuitem"]')].find(node => node.textContent === '삭제');
        assert.ok(remove);
        await click(remove);
        return opener;
    };
    return { button, click, escape, settle, openDelete, mutations, finish: () => React.act(async () => finish({ plan: { ...source, state: 'archived', metaRevision: 2 } })) };
}

test('real picker deletion uses cancel-first alertdialog and returns keyboard focus on cancellation', async t => {
    const f = await setup(t);
    const opener = await f.openDelete();
    const dialog = document.querySelector('[role="alertdialog"]');
    assert.ok(dialog);
    assert.match(dialog.textContent, /다음 학기 프리셋/);
    assert.equal(document.activeElement.textContent, '취소');
    await f.escape();
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.ok(document.activeElement === opener, 'delete opener must regain focus');
    assert.equal(f.mutations.length, 0);
});

test('real picker confirmation stays mounted during pending deletion and focuses persistent selector after success', async t => {
    const f = await setup(t);
    await f.openDelete();
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find(button => button.textContent === '삭제');
    await f.click(confirm);
    await f.escape();
    assert.ok(document.querySelector('[role="alertdialog"]'));
    assert.equal(f.mutations.length, 1);
    assert.equal(confirm.disabled, true);
    await f.finish(); await f.settle();
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.equal(document.activeElement.id, 'timetable-plan');
});

test('real picker restore target opens a cancel-first confirmation and returns focus to restore entry', async t => {
    const f = await setup(t);
    const opener = f.button('삭제한 프리셋 복구'); await f.click(opener);
    await f.click(f.button('삭제한 프리셋'));
    const dialog = document.querySelector('[role="alertdialog"]');
    assert.ok(dialog);
    assert.match(dialog.textContent, /삭제한 프리셋/);
    assert.equal(document.activeElement.textContent, '취소');
    await f.escape();
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.ok(document.activeElement === opener, 'restore entry must regain focus');
    assert.equal(f.mutations.length, 0);
});
