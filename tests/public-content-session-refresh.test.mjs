import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://test.invalid/admin/public-content" });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const name of ["HTMLElement", "Element", "MutationObserver", "CustomEvent", "Event", "Node", "NodeFilter", "DocumentFragment", "HTMLInputElement", "KeyboardEvent"])
  globalThis[name] = dom.window[name];
globalThis.getComputedStyle = window.getComputedStyle;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia = media => ({ media, matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.requestAnimationFrame = window.requestAnimationFrame = callback => window.setTimeout(callback, 0);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame = window.clearTimeout;
window.HTMLElement.prototype.scrollIntoView = () => {};
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
const session = (id = "synthetic-admin-a", revision = 1) => ({
  user: { id, email: `${id}@example.invalid`, user_metadata: {} },
  expires_at: 100 + revision, access_token: `synthetic-placeholder-${id}-${revision}`,
});
const button = text => [...document.querySelectorAll("button")].find(node => node.textContent.trim() === text);
const click = async text => {
  assert.ok(button(text), `missing action: ${text}`);
  await act(async () => button(text).click());
  await settle();
};
const edit = async (node, value) => {
  assert.ok(node);
  await act(async () => {
    node.focus();
    const prototype = node.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value);
    node.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
};
const escape = async node => {
  await act(async () => node.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await settle();
};
const activateTab = async text => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find(node => node.textContent.trim() === text);
  assert.ok(tab);
  await act(async () => { tab.focus(); tab.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  await settle();
};
const entry = (id, name) => ({ id, kind: "teacher", version: 1, sortOrder: 0, isPublished: false, data: { name, subject: "영어", portraitUrl: "/assets/landing/v1/synthetic.png", videoUrl: "", description: "가상 소개" }, previewUrls: {} });

// Actual provider, page, workspace and dialog guards; only SDK/profile I/O,
// HTTP and navigation are synthetic. No real credentials or external requests.
async function setup(t, { deferredReads = false, deferredReviews = false, entries = [] } = {}) {
  document.getElementById("root").replaceChildren();
  window.localStorage.clear();
  const profiles = [], reads = [], reviewReads = [], writes = [], listeners = new Set();
  let activeSession = session();
  const client = {
    auth: {
      async getSession() { return { data: { session: activeSession }, error: null }; },
      onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }; },
    },
    from(table) {
      assert.equal(table, "profiles");
      const pending = Promise.withResolvers();
      profiles.push(pending);
      const query = {
        select() { return query; }, eq() { return query; }, or() { return query; }, order() { return query; }, limit() { return query; },
        abortSignal() { return query; }, maybeSingle() { return query; }, retry(value) { assert.equal(value, false); return pending.promise; },
      };
      return query;
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    assert.ok(String(url).startsWith("/api/admin/public-content"), "no external network");
    const pending = Promise.withResolvers();
    const request = { url: String(url), options, ...pending };
    if (options?.method === "GET") {
      const action = new URL(url, "https://test.invalid").searchParams.get("action");
      if (action === "reorder" || action === "bootstrap") {
        assert.ok(deferredReviews, "review requests need an explicit synthetic response");
        reviewReads.push(request);
      } else {
        reads.push(request);
        if (!deferredReads) pending.resolve({ ok: true, json: async () => ({ entries, totalCount: entries.length }) });
      }
    } else {
      assert.equal(options?.method, "POST", "only explicit synthetic content submission is supported");
      writes.push(request);
    }
    return pending.promise;
  };
  const navigation = { useRouter: () => ({ push() {} }) };
  const auth = loadNotificationComponent("src/providers/auth-provider.tsx", new Map([
    ["@/lib/supabase", { supabase: client, supabaseConfigError: null, fallbackAdminEmails: [], fallbackStaffEmails: [], fallbackTeacherEmails: [] }],
    ["next/navigation", navigation],
  ]));
  const { default: Page } = loadNotificationComponent("src/app/admin/public-content/page.tsx", new Map([
    ["@/providers/auth-provider", auth], ["next/navigation", navigation],
  ]));
  const root = createRoot(document.getElementById("root"));
  t.after(async () => {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
  });
  await act(async () => root.render(createElement(auth.AuthProvider, null, createElement(Page))));
  await settle();
  const resolveProfile = async (index, id = activeSession.user.id, role = "admin") => {
    assert.ok(profiles[index], "authoritative profile read must exist");
    await act(async () => profiles[index].resolve({ data: { id, role, name: id }, error: null }));
    await settle();
  };
  await resolveProfile(0);
  return {
    profiles, reads, reviewReads, writes,
    resolveProfile,
    async emit(event, next) {
      activeSession = next;
      await act(async () => { listeners.forEach(callback => callback(event, next)); });
      await settle();
    },
    async resolveRead(index, values = []) {
      await act(async () => reads[index].resolve({ ok: true, json: async () => ({ entries: values, totalCount: values.length }) }));
      await settle();
    },
    async resolveReview(index, data) {
      await act(async () => reviewReads[index].resolve({ ok: true, json: async () => data }));
      await settle();
    },
  };
}

const reviewEntries = [
  entry("00000000-0000-4000-8000-000000000011", "가상 정렬 A"),
  entry("00000000-0000-4000-8000-000000000012", "가상 정렬 C"),
  entry("00000000-0000-4000-8000-000000000013", "가상 편집 B"),
];
const reorderChanges = (values = reviewEntries.slice(0, 2)) => values.map((value, index) => ({
  id: value.id, expectedVersion: value.version, action: "save", entry: { ...value, sortOrder: index + 1 },
}));
const reorder = async label => {
  const control = document.querySelector(`button[aria-label="${label}"]`);
  assert.ok(control && !control.disabled);
  await act(async () => control.click());
  await settle();
};
const openRecord = async name => {
  const row = [...document.querySelectorAll("li")].find(node => node.textContent.includes(name));
  assert.ok(row);
  await act(async () => [...row.querySelectorAll("button")].find(node => node.textContent.trim() === "수정").click());
  await settle();
};

test("CMS an earlier reorder response after renewal cannot replace a newer record draft", async t => {
  const h = await setup(t, { entries: reviewEntries, deferredReviews: true });
  await reorder("가상 정렬 A 아래로 이동");
  await h.emit("TOKEN_REFRESHED", session(undefined, 2));
  await h.resolveProfile(1);
  await openRecord("가상 편집 B");
  const input = document.getElementById("content-name");
  await edit(input, "새로운 B 초안");
  await h.resolveReview(0, { changes: reorderChanges() });
  assert.equal(document.getElementById("content-name"), input, "old review cannot replace the active editor");
  assert.equal(input.value, "새로운 B 초안");
  assert.equal(button("확인 후 적용"), undefined);
  assert.equal(h.writes.length, 0);
});

for (const outcome of ["success", "empty", "error"])
  test(`CMS superseded review ${outcome} cannot replace the latest review or feedback`, async t => {
    const h = await setup(t, { entries: reviewEntries, deferredReviews: true });
    await reorder("가상 정렬 A 아래로 이동");
    await reorder("가상 편집 B 위로 이동");
    assert.equal(h.reviewReads[0].options.signal.aborted, true);
    assert.equal(h.reviewReads[1].options.signal.aborted, false);
    await h.resolveReview(1, { changes: reorderChanges([reviewEntries[2]]) });
    const dialog = document.querySelector('[role="dialog"]');
    const previousText = dialog.textContent;
    if (outcome === "error") {
      await act(async () => h.reviewReads[0].reject(new Error("Synthetic stale review error")));
      await settle();
    } else await h.resolveReview(0, { changes: outcome === "empty" ? [] : reorderChanges() });
    assert.equal(document.querySelector('[role="dialog"]'), dialog);
    assert.equal(dialog.textContent, previousText);
    assert.ok(previousText.includes("가상 편집 B"));
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.ok(!document.body.textContent.includes("마지막 선생님입니다"));
    assert.equal(h.writes.length, 0);
  });

test("CMS stale review finally does not release a newer pending request", async t => {
  const h = await setup(t, { entries: reviewEntries, deferredReviews: true });
  await reorder("가상 정렬 A 아래로 이동");
  await reorder("가상 편집 B 위로 이동");
  await act(async () => h.reviewReads[0].reject(new Error("Synthetic cancelled read")));
  await settle();
  assert.equal(h.reviewReads[1].options.signal.aborted, false);
  await h.resolveReview(1, { changes: reorderChanges([reviewEntries[2]]) });
  assert.ok(document.querySelector('[role="dialog"]').textContent.includes("가상 편집 B"));
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(h.writes.length, 0);
});

test("CMS a still-current review survives credential renewal and tab focus movement", async t => {
  const h = await setup(t, { entries: reviewEntries, deferredReviews: true });
  await reorder("가상 정렬 A 아래로 이동");
  const firstTab = document.querySelector('[role="tab"][aria-selected="true"]');
  await act(async () => { firstTab.focus(); firstTab.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  await h.emit("TOKEN_REFRESHED", session(undefined, 2));
  await h.resolveProfile(1);
  assert.equal(firstTab.getAttribute("aria-selected"), "true");
  assert.equal(h.reviewReads[0].options.signal.aborted, false, "same actor and intent remain valid");
  await h.resolveReview(0, { changes: reorderChanges() });
  assert.ok(document.querySelector('[role="dialog"]').textContent.includes("가상 정렬 A"));
  assert.equal(h.writes.length, 0);
});

for (const canApply of [true, false])
  test(`CMS stale bootstrap canApply=${canApply} cannot replace a newer editor or set an error`, async t => {
    const h = await setup(t, { deferredReviews: true });
    await click("기존 홈페이지 자료 가져오기");
    await click("선생님 추가");
    const input = document.getElementById("content-name");
    await edit(input, "신규 가상 초안");
    assert.equal(h.reviewReads[0].options.signal.aborted, true);
    await h.resolveReview(0, { canApply, counts: { teacher: 1, review: 0, result: 0 } });
    assert.equal(document.getElementById("content-name"), input);
    assert.equal(input.value, "신규 가상 초안");
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.equal(button("확인 후 적용"), undefined);
    assert.equal(h.writes.length, 0);
  });

test("CMS current bootstrap and current read failures retain their existing behavior", async t => {
  const h = await setup(t, { deferredReviews: true });
  await click("기존 홈페이지 자료 가져오기");
  await act(async () => h.reviewReads[0].reject(new DOMException("Synthetic current timeout", "TimeoutError")));
  await settle();
  assert.match(document.querySelector('[role="alert"]').textContent, /Synthetic current timeout/);
  assert.equal(button("기존 홈페이지 자료 가져오기"), undefined, "the error state exposes list recovery first");
  const readsBeforeRecovery = h.reads.length;
  await click("다시 불러오기");
  assert.equal(h.reads.length, readsBeforeRecovery + 1, "recovery uses the existing list read");
  assert.equal(document.querySelector('[role="alert"]'), null);
  await click("기존 홈페이지 자료 가져오기");
  await h.emit("TOKEN_REFRESHED", session(undefined, 2));
  await h.resolveProfile(1);
  await h.resolveReview(1, { canApply: true, counts: { teacher: 1, review: 0, result: 0 } });
  assert.match(document.querySelector('[role="dialog"]').textContent, /기존 홈페이지 자료 확인/);
  assert.ok(button("확인 후 적용"));
  assert.equal(h.writes.length, 0);
});

for (const boundary of ["logout", "different-user", "admin-revoked"])
  test(`CMS pending review is cancelled on ${boundary} and cannot reopen after authorization returns`, async t => {
    const h = await setup(t, { entries: reviewEntries, deferredReviews: true });
    await reorder("가상 정렬 A 아래로 이동");
    if (boundary === "logout") await h.emit("SIGNED_OUT", null);
    if (boundary === "different-user") await h.emit("SIGNED_IN", session("synthetic-admin-b"));
    if (boundary === "admin-revoked") {
      await h.emit("TOKEN_REFRESHED", session(undefined, 2));
      await h.resolveProfile(1, undefined, "teacher");
    }
    assert.equal(h.reviewReads[0].options.signal.aborted, true);
    if (boundary === "different-user") await h.resolveProfile(1, "synthetic-admin-b");
    else {
      await h.emit("SIGNED_IN", session(undefined, 3));
      await h.resolveProfile(h.profiles.length - 1);
    }
    await click("선생님 추가");
    const input = document.getElementById("content-name");
    await edit(input, "현재 소유자 초안");
    await h.resolveReview(0, { changes: reorderChanges() });
    assert.equal(document.getElementById("content-name"), input);
    assert.equal(input.value, "현재 소유자 초안");
    assert.equal(h.writes.length, 0);
  });

for (const intent of ["refresh", "search", "kind", "close"])
  test(`CMS ${intent} invalidates a pending review without reopening it`, async t => {
    const h = await setup(t, { entries: reviewEntries, deferredReviews: true });
    await reorder("가상 정렬 A 아래로 이동");
    if (intent === "refresh") {
      await act(async () => document.querySelector('button[aria-label="홈페이지 자료 새로고침"]').click());
      await settle();
    }
    if (intent === "search") await edit(document.querySelector('input[aria-label="콘텐츠 검색"]'), "가상");
    if (intent === "kind") await activateTab("공개 후기");
    if (intent === "close") {
      await click("선생님 추가");
      await edit(document.getElementById("content-name"), "버릴 가상 초안");
      await escape(document.getElementById("content-name"));
      await click("변경사항 버리기");
    }
    assert.equal(h.reviewReads[0].options.signal.aborted, true);
    await h.resolveReview(0, { changes: reorderChanges() });
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(h.writes.length, 0);
  });

for (const event of ["TOKEN_REFRESHED", "SIGNED_IN"])
  test(`CMS same-user ${event} preserves the actual dirty input, focus and selection while rechecking permissions`, async t => {
    const h = await setup(t);
    await click("선생님 추가");
    const input = document.getElementById("content-name");
    await edit(input, "합성 초안 보존 확인");
    input.setSelectionRange(2, 5);
    await h.emit(event, session(undefined, 2));
    assert.equal(h.profiles.length, 2, "renewal still checks authoritative permissions");
    assert.equal(document.getElementById("content-name"), input, "same-user renewal must keep the existing editor");
    assert.equal(input.value, "합성 초안 보존 확인");
    assert.equal(document.activeElement, input);
    assert.equal(input.selectionStart, 2);
    assert.equal(input.selectionEnd, 5);
    assert.equal(h.reads.at(-1).options.headers.Authorization, `Bearer ${session(undefined, 2).access_token}`);
    await h.resolveProfile(1);
    assert.equal(document.getElementById("content-name"), input);
    await escape(input);
    assert.ok(button("계속 편집"), "renewal must retain the dirty-close guard");
    await click("계속 편집");
    assert.equal(document.getElementById("content-name").value, "합성 초안 보존 확인");
    assert.equal(h.writes.length, 0);
  });

for (const boundary of ["logout", "different-user", "admin-revoked"])
  test(`CMS ${boundary} removes the previous owner's draft and does not resurrect it`, async t => {
    const h = await setup(t);
    await click("선생님 추가");
    const input = document.getElementById("content-name");
    await edit(input, "이전 소유자 가상 초안");
    if (boundary === "logout") await h.emit("SIGNED_OUT", null);
    if (boundary === "different-user") await h.emit("SIGNED_IN", session("synthetic-admin-b"));
    if (boundary === "admin-revoked") {
      await h.emit("TOKEN_REFRESHED", session(undefined, 2));
      await h.resolveProfile(1, undefined, "teacher");
    }
    assert.equal(document.getElementById("content-name"), null);
    assert.equal(input.isConnected, false);
    if (boundary === "different-user") await h.resolveProfile(1, "synthetic-admin-b");
    else {
      await h.emit("SIGNED_IN", session(undefined, 3));
      await h.resolveProfile(h.profiles.length - 1);
    }
    await click("선생님 추가");
    assert.equal(document.getElementById("content-name").value, "");
    assert.equal(h.writes.length, 0);
  });

test("CMS token renewal preserves search conditions and ignores a late response from the cancelled token", async t => {
  const h = await setup(t, { deferredReads: true });
  await h.resolveRead(0);
  const search = document.querySelector('input[aria-label="콘텐츠 검색"]');
  await edit(search, "가상 검색");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 230)); });
  const oldIndex = h.reads.length - 1;
  assert.equal(new URL(h.reads[oldIndex].url, "https://test.invalid").searchParams.get("q"), "가상 검색");
  await click("선생님 추가");
  await edit(document.getElementById("content-name"), "유지할 가상 초안");
  await h.emit("TOKEN_REFRESHED", session(undefined, 2));
  assert.equal(h.reads[oldIndex].options.signal.aborted, true);
  assert.equal(document.querySelector('input[aria-label="콘텐츠 검색"]'), search);
  assert.equal(search.value, "가상 검색");
  assert.equal(new URL(h.reads.at(-1).url, "https://test.invalid").searchParams.get("q"), "가상 검색");
  await h.resolveRead(h.reads.length - 1, [entry("current", "현재 가상 결과")]);
  await h.resolveRead(oldIndex, [entry("stale", "과거 가상 결과")]);
  assert.ok(document.body.textContent.includes("현재 가상 결과"));
  assert.ok(!document.body.textContent.includes("과거 가상 결과"));
  assert.equal(document.getElementById("content-name").value, "유지할 가상 초안");
  await h.resolveProfile(1);
  assert.equal(h.writes.length, 0);
});

test("CMS a late previous-account read cannot replace the new account's list", async t => {
  const h = await setup(t, { deferredReads: true });
  await h.emit("SIGNED_IN", session("synthetic-admin-b"));
  assert.equal(h.reads[0].options.signal.aborted, true);
  await h.resolveProfile(1, "synthetic-admin-b");
  await h.resolveRead(1, [entry("b", "새 소유자 가상 결과")]);
  await h.resolveRead(0, [entry("a", "이전 소유자 가상 결과")]);
  assert.ok(document.body.textContent.includes("새 소유자 가상 결과"));
  assert.ok(!document.body.textContent.includes("이전 소유자 가상 결과"));
  assert.equal(h.writes.length, 0);
});

test("CMS renewal preserves the reviewed record and failed submission retry identity, without duplicate submission", async t => {
  const recordId = "00000000-0000-4000-8000-000000000001";
  const h = await setup(t, { entries: [entry(recordId, "가상 원본")] });
  await click("수정");
  await edit(document.getElementById("content-name"), "가상 수정 초안");
  await click("내용 검토");
  assert.ok(document.querySelector('[role="dialog"]').textContent.includes("가상 수정 초안"));
  await h.emit("TOKEN_REFRESHED", session(undefined, 2));
  await h.resolveProfile(1);
  assert.ok(button("수정으로 돌아가기"));
  assert.ok(document.querySelector('[role="dialog"]').textContent.includes("가상 수정 초안"));
  await act(async () => {
    const apply = button("확인 후 적용");
    apply.click(); apply.click();
  });
  assert.equal(h.writes.length, 1, "pending reviewed change is submitted once");
  const first = JSON.parse(h.writes[0].options.body);
  assert.equal(first.changes[0].id, recordId);
  assert.equal(first.changes[0].entry.data.name, "가상 수정 초안");
  assert.equal(h.writes[0].options.headers.Authorization, `Bearer ${session(undefined, 2).access_token}`);
  await act(async () => h.writes[0].resolve({ ok: false, json: async () => ({ code: "request_timeout" }) }));
  await settle();
  assert.ok(button("확인 후 적용"), "synthetic failure retains the review");
  assert.ok(document.querySelector('[role="dialog"]').textContent.includes("가상 수정 초안"));
  await h.emit("TOKEN_REFRESHED", session(undefined, 3));
  await h.resolveProfile(2);
  await click("확인 후 적용");
  assert.equal(h.writes.length, 2);
  assert.deepEqual(JSON.parse(h.writes[1].options.body), first, "retry keeps record, version, payload and request ID");
  assert.equal(h.writes[1].options.headers.Authorization, `Bearer ${session(undefined, 3).access_token}`);
  await act(async () => h.writes[1].resolve({ ok: false, json: async () => ({ code: "request_timeout" }) }));
  await settle();
  await click("수정으로 돌아가기");
  assert.equal(document.getElementById("content-name").value, "가상 수정 초안");
});

test("CMS a late submission from the previous account cannot close the new owner's draft", async t => {
  const h = await setup(t, { entries: [entry("00000000-0000-4000-8000-000000000002", "가상 이전 항목")] });
  await click("수정");
  await edit(document.getElementById("content-name"), "이전 계정 변경");
  await click("내용 검토");
  await click("확인 후 적용");
  assert.equal(h.writes.length, 1);
  await h.emit("SIGNED_IN", session("synthetic-admin-b"));
  await h.resolveProfile(1, "synthetic-admin-b");
  await click("선생님 추가");
  const input = document.getElementById("content-name");
  await edit(input, "새 계정 초안");
  await act(async () => h.writes[0].resolve({ ok: true, json: async () => ({}) }));
  await settle();
  assert.equal(document.getElementById("content-name"), input);
  assert.equal(input.value, "새 계정 초안");
  assert.ok(!document.body.textContent.includes("항목을 적용했습니다"));
  assert.equal(h.writes.length, 1);
});

test("CMS closing one reviewed record before opening another does not carry its draft across records", async t => {
  const first = entry("00000000-0000-4000-8000-000000000003", "가상 첫 항목");
  const second = entry("00000000-0000-4000-8000-000000000004", "가상 둘째 항목");
  const h = await setup(t, { entries: [first, second] });
  await click("수정");
  await edit(document.getElementById("content-name"), "버릴 가상 초안");
  await h.emit("TOKEN_REFRESHED", session(undefined, 2));
  await h.resolveProfile(1);
  await escape(document.getElementById("content-name"));
  await click("변경사항 버리기");
  assert.equal(document.querySelector('[role="dialog"]'), null);
  const next = [...document.querySelectorAll("li")].find(node => node.textContent.includes("가상 둘째 항목"));
  await act(async () => [...next.querySelectorAll("button")].find(node => node.textContent.trim() === "수정").click());
  await settle();
  assert.equal(document.getElementById("content-name").value, second.data.name);
  assert.equal(h.writes.length, 0);
});

test("CMS import text survives same-user renewal but is removed on account change", async t => {
  const h = await setup(t);
  await activateTab("공개 후기");
  await click("자료 가져오기");
  const input = document.querySelector('textarea[placeholder="첫 줄의 항목 이름과 함께 붙여넣어 주세요."]');
  const text = "공개이름\t작성자\t후기원문\n가*상\t학생\t가상 후기 원문";
  await edit(input, text);
  await h.emit("TOKEN_REFRESHED", session(undefined, 2));
  await h.resolveProfile(1);
  assert.equal(document.querySelector("textarea"), input);
  assert.equal(input.value, text);
  await h.emit("SIGNED_IN", session("synthetic-admin-b"));
  assert.equal(input.isConnected, false);
  await h.resolveProfile(2, "synthetic-admin-b");
  await activateTab("공개 후기");
  await click("자료 가져오기");
  assert.equal(document.querySelector("textarea").value, "");
  assert.equal(h.writes.length, 0);
});

test("CMS ignores a cancelled-token read rejection while keeping the refreshed list and draft", async t => {
  const h = await setup(t, { deferredReads: true });
  await click("선생님 추가");
  await edit(document.getElementById("content-name"), "가상 보존값");
  await h.emit("TOKEN_REFRESHED", session(undefined, 2));
  await h.resolveProfile(1);
  await h.resolveRead(1, [entry("current", "현재 가상 자료")]);
  await act(async () => h.reads[0].reject(new Error("Synthetic old read failure")));
  await settle();
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.ok(document.body.textContent.includes("현재 가상 자료"));
  assert.equal(document.getElementById("content-name").value, "가상 보존값");
  assert.equal(h.writes.length, 0);
});

test("CMS route isolates a direct authorized user replacement even without a loading interlude", async t => {
  let current = { isAdmin: true, loading: false, session: session() };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith("/api/admin/public-content?"));
    assert.equal(options.method, "GET");
    return { ok: true, json: async () => ({ entries: [], totalCount: 0 }) };
  };
  const { default: Page } = loadNotificationComponent("src/app/admin/public-content/page.tsx", new Map([
    ["@/providers/auth-provider", { useAuth: () => current }],
    ["next/navigation", { useRouter: () => ({ push() {} }) }],
  ]));
  const root = createRoot(document.getElementById("root"));
  t.after(async () => { await act(async () => root.unmount()); globalThis.fetch = originalFetch; });
  await act(async () => root.render(createElement(Page)));
  await settle();
  await click("선생님 추가");
  const input = document.getElementById("content-name");
  await edit(input, "다른 소유자에게 보이면 안 되는 가상 초안");
  current = { ...current, session: session("synthetic-admin-b") };
  await act(async () => root.render(createElement(Page)));
  await settle();
  assert.equal(input.isConnected, false);
  assert.equal(document.querySelector('[role="dialog"]'), null);
  await click("선생님 추가");
  assert.equal(document.getElementById("content-name").value, "");
});
