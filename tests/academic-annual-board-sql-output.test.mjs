import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadNotificationComponent } from "./helpers/notification-component-loader.mjs";

// Historical PostgreSQL output from the recorded base6c60 source dependency
// slice is replayed through the current consumer. Its original provenance stays
// unchanged; this does not verify the current full migration chain, JWT or HTTP.
// The archived producer hash and current function-body equality are checked below.
// Node never connects to a DB.
const fixture = JSON.parse(await readFile(new URL("./fixtures/academic-annual-board-range-sql-output.json", import.meta.url), "utf8"));
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://test.invalid/admin/academic-annual-board?year=2026", pretendToBeVisual: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
for (const name of ["window", "self", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "NodeFilter", "DocumentFragment", "Event", "CustomEvent", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
window.HTMLElement.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};
window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

function canonicalAnnualDefinition(source) {
  const definitions = [...source.matchAll(/create or replace function public\.get_operations_annual_board_v1\(p_academic_year integer\)[\s\S]*?\n\$function\$;/g)];
  assert.equal(definitions.length, 1, "one complete annual function definition is present");
  const definition = definitions[0];
  assert.match(source.slice(0, definition.index), /^(?:--[^\n]*\n|\s)*(?:set lock_timeout = '1s';\nset statement_timeout = '5s';\n\s*)?$/, "only comments, whitespace and the exact reviewed timeout pair precede the function");
  assert.match(source.slice(definition.index + definition[0].length), /^\s*$/, "no extra statement follows the function");
  return definition[0];
}

function entries(response) {
  return (response.data?.rows || []).flatMap(row => Object.values(row.typeBuckets).flat());
}

function withoutChangedProjection(response) {
  const normalized = structuredClone(response);
  for (const entry of entries(normalized)) {
    delete entry.end;
    delete entry.dateLabel;
    if (entry.displayMeta) delete entry.displayMeta.rangeEnd;
  }
  return normalized;
}

function label(type) {
  return ({ "영어시험일": "영어", "수학시험일": "수학", "과학시험일": "과학", "방학·휴일·기타": "방학·기타" })[type] || type;
}

async function waitFor(predicate, message = "expected annual-board state") {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  assert.ok(predicate(), message);
}

async function setup(t, role, phase, academicYear = 2026) {
  performance.clearMeasures();
  performance.clearMarks();
  const record = fixture.roles[role];
  const response = academicYear === 2026 ? record[phase] : fixture.years[academicYear][phase];
  const calls = [];
  const params = new URLSearchParams(`year=${response.data.academicYear}`);
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      let data;
      if (name === "get_operations_annual_board_v1") {
        assert.deepEqual(args, { p_academic_year: response.data.academicYear });
        data = response;
      } else if (name === "list_operations_catalogs_v1") {
        assert.deepEqual(args, {});
        data = { academicSchools: [], teachers: [], classrooms: [] };
      } else if (name === "list_active_science_subject_areas_v1") {
        data = [];
      } else {
        throw new Error(`unexpected external RPC ${name}`);
      }
      const chain = {
        limit() { return chain; },
        abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return chain; },
        retry(value) { assert.equal(value, false); return Promise.resolve({ data, error: null }); },
      };
      return chain;
    },
    from() { throw new Error("writes and direct table reads are outside this replay test"); },
  };
  const auth = { user: { id: record.actorId }, profile: null, role, loading: false, canManageAll: false };
  const router = { push() { throw new Error("unexpected navigation"); } };
  const { AcademicAnnualBoardWorkspace } = loadNotificationComponent("src/features/operations/academic-annual-board-workspace.tsx", new Map([
    ["next/navigation", { useRouter: () => router, useSearchParams: () => params }],
    ["@/providers/auth-provider", { useAuth: () => auth }],
    ["@/lib/supabase", { supabase: client }],
    ["sonner", { toast: { success() {}, error() {}, info() {} } }],
  ]));
  // The production workspace hook and createOperationsReadService are retained;
  // only the transport/auth boundary replays the recorded SQL result.
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(AcademicAnnualBoardWorkspace)));
  t.after(async () => { await act(async () => root.unmount()); host.remove(); });
  await waitFor(() => calls.some(call => call.name === "get_operations_annual_board_v1") && (response.data.rows.length > 0
    ? host.querySelector(".annual-board-value") !== null
    : host.textContent.includes("조건에 맞는 일정 없음")));
  assert.ok(calls.some(call => call.name === "list_operations_catalogs_v1"), "the real hook loads its catalog boundary");
  return { host, response };
}

async function assertRenderedCase(host, surface, expected, phase) {
  const compact = phase === "baseline" ? expected.baselineCompact : expected.compact;
  const detail = phase === "baseline" ? expected.baselineDetail : expected.detail;
  const region = surface === "desktop"
    ? host.querySelector('[aria-label="학교별 연간 일정 비교"]')
    : host.querySelector('[data-testid="annual-board-mobile-list"]');
  assert.ok(region, surface);
  const name = `${expected.schoolName} 고1 ${expected.term} ${label(expected.type)}`;
  const trigger = [...region.querySelectorAll("button")].find(node => node.getAttribute("aria-label")?.startsWith(`${name}: `));
  assert.ok(trigger, `${phase} ${surface} ${expected.id}`);
  assert.equal(trigger.textContent.trim(), compact, `${phase} ${surface} ${expected.id}`);
  await act(async () => { trigger.focus(); trigger.click(); });
  const selector = '[data-slot="popover-content"][data-state="open"]';
  await waitFor(() => document.querySelector(selector));
  const content = document.querySelector(selector);
  assert.equal(content.getAttribute("aria-label"), `${name} 상세`);
  assert.equal(content.querySelector(".annual-board-hover-value").textContent.trim(), detail);
  assert.equal([...content.querySelectorAll("button")].find(node => node.textContent.trim() === "수정")?.disabled, true);
  await act(async () => content.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await waitFor(() => !document.querySelector(selector) && document.activeElement === trigger);
  // React development rendering measures every node in this dense real tree.
  // Node retains perf_hooks entries indefinitely; dispose measurements after
  // each settled interaction so replaying both scopes cannot exhaust the heap.
  performance.clearMeasures();
  performance.clearMarks();
}

test("historical SQL source-slice role outputs retain their provenance and the current draft has the identical producer body", async () => {
  assert.ok(fixture.provenance, "the fixture records its historical SQL execution provenance");
  assert.equal(fixture.provenance.baseCommit, "6c60e855cfb6faef3a47d44561ad5ef12b039522");
  assert.match(fixture.provenance.scope, /source dependency slice, not full chain\./);
  assert.match(fixture.provenance.auth, /no signed JWT, PostgREST or auth service verification\./);
  const recordedMigration = await readFile(new URL("./fixtures/academic-annual-board-range-recorded-migration.sql", import.meta.url));
  const migration = await readFile(new URL("../supabase/migrations/20261006183148_operations_annual_board_range.sql", import.meta.url));
  assert.equal(createHash("sha256").update(recordedMigration).digest("hex"), fixture.provenance.migrationSha256, "the archived historical producer matches the original recorded raw source hash");
  assert.equal(canonicalAnnualDefinition(migration.toString("utf8")), canonicalAnnualDefinition(recordedMigration.toString("utf8")), "the current draft differs only in its migration header and reviewed timeout declarations; this is source equivalence, not current-schema execution evidence");
  assert.deepEqual(Object.keys(fixture.roles).sort(), ["admin", "assistant", "staff", "teacher", "viewer"]);
  assert.ok(fixture.expected.length > 0, "non-empty literal consumer expectations accompany the SQL output");
  for (const [role, record] of Object.entries(fixture.roles)) {
    assert.equal(record.baseline.ok, true, role);
    assert.equal(record.current.ok, true, role);
    assert.deepEqual(withoutChangedProjection(record.current), withoutChangedProjection(record.baseline), `${role} scope and all non-date fields are unchanged`);
    assert.deepEqual(entries(record.current).map(entry => entry.id), entries(record.baseline).map(entry => entry.id), `${role} entry ordering and identity stay intact`);
  }
  const ids = new Set([
    ...entries(fixture.roles.admin.current),
    ...Object.values(fixture.years || {}).flatMap(record => entries(record.current)),
  ].map(entry => entry.id));
  for (const expected of fixture.expected) {
    assert.ok(ids.has(expected.id), `literal expectation ${expected.id} belongs to actual SQL output`);
    for (const key of ["compact", "detail", "baselineCompact", "baselineDetail"]) assert.equal(typeof expected[key], "string", `${expected.id} ${key}`);
  }
});

test("historical baseline and range-producer SQL responses reach the current read service, hook, desktop/mobile cells and Popover", async t => {
  for (const phase of ["baseline", "current"]) {
    await t.test(phase, async subtest => {
      const { host, response } = await setup(subtest, "admin", phase);
      for (const surface of ["desktop", "mobile"]) {
        for (const expected of fixture.expected.filter(item => !item.academicYear || item.academicYear === 2026)) await assertRenderedCase(host, surface, expected, phase);
        const region = surface === "desktop"
          ? host.querySelector('[aria-label="학교별 연간 일정 비교"]')
          : host.querySelector('[data-testid="annual-board-mobile-list"]');
        for (const entry of entries(response).filter(item => item.type === "시험기간" && !item.examTerm)) {
          const termCells = [...region.querySelectorAll("button")].filter(node => node.getAttribute("aria-label")?.startsWith(`${entry.schoolName} 고1 `) && node.getAttribute("aria-label").includes(" 시험기간: "));
          assert.equal(termCells.length, 4, "a termless SQL entry is retained without being assigned to an arbitrary exam term");
          assert.ok(termCells.every(node => node.textContent.trim() === "—"));
        }
      }
    });
  }
});

test("historical SQL leap and prior-year records retain their explicit year scopes through the current consumer", async t => {
  for (const academicYear of [2027, 2028]) {
    await t.test(String(academicYear), async subtest => {
      assert.deepEqual(withoutChangedProjection(fixture.years[academicYear].current), withoutChangedProjection(fixture.years[academicYear].baseline));
      const { host, response } = await setup(subtest, "viewer", "current", academicYear);
      const expectedCases = fixture.expected.filter(item => item.academicYear === academicYear);
      if (expectedCases.length === 0) {
        assert.deepEqual(response.data.rows, [], `${academicYear} does not borrow a range that started in another year`);
        assert.equal(host.querySelectorAll(".annual-board-value").length, 0);
        assert.ok(host.textContent.includes("조건에 맞는 일정 없음"));
        return;
      }
      for (const surface of ["desktop", "mobile"]) {
        for (const expected of expectedCases) await assertRenderedCase(host, surface, expected, "current");
      }
    });
  }
});

test("recorded teacher, assistant, staff and viewer SQL scopes are preserved by the real consumer", async t => {
  for (const role of ["teacher", "assistant", "staff", "viewer"]) {
    await t.test(role, async subtest => {
      const { host, response } = await setup(subtest, role, "current");
      const visibleIds = new Set(entries(response).map(entry => entry.id));
      const visibleExpected = fixture.expected.filter(expected => visibleIds.has(expected.id));
      if (visibleExpected.length === 0) {
        assert.ok(host.textContent.includes("조건에 맞는 일정 없음"), `${role} empty scope stays empty`);
        assert.equal(host.querySelectorAll(".annual-board-value").length, 0);
        return;
      }
      for (const surface of ["desktop", "mobile"]) {
        // Admin covers every literal case; repeat representative range/single
        // interactions under each recorded scoped response without remapping it.
        for (const expected of visibleExpected.slice(0, 2)) await assertRenderedCase(host, surface, expected, "current");
      }
    });
  }
});
