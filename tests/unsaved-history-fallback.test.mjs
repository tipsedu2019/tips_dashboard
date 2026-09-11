import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/unsaved-history-fallback.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { createUnsavedHistoryFallback, pushLocalHistoryState, installUnsavedHistoryDispatcher } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
const stateFor = id => ({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: [id], renderedSearch: "?screen=" + id }, custom: { id } });

// Traversal and popstate are separate tasks; a pre-existing Next bubble listener
// exposes any temporary URL/state incorrectly published during restoration.
function createBrowser(paths = ["/admin/dashboard", "/admin/students?studentId=a"], index = paths.length - 1) {
  const entries = paths.map((path, offset) => ({ url: "https://tips.test" + path, state: stateFor(String(offset)) }));
  const tasks = [], listeners = [], restored = [], calls = [];
  const captureValue = value => value === true || value?.capture === true;
  const browser = {
    location: { get href() { return entries[index].url; } },
    addEventListener(type, handler, capture = false) { listeners.push({ type, handler, capture: captureValue(capture) }); },
    removeEventListener(type, handler, capture = false) {
      const position = listeners.findIndex(listener => listener.type === type && listener.handler === handler && listener.capture === captureValue(capture));
      if (position >= 0) listeners.splice(position, 1);
    },
    history: {
      get state() { return structuredClone(entries[index].state); },
      get length() { return entries.length; },
      pushState(state, _unused, url) {
        entries.splice(index + 1, entries.length, { state: structuredClone(state), url: new URL(url || browser.location.href, browser.location.href).href });
        index += 1;
      },
      replaceState(state, _unused, url) {
        entries[index] = { state: structuredClone(state), url: new URL(url || browser.location.href, browser.location.href).href };
      },
      go(delta) {
        calls.push(delta);
        tasks.push(() => {
          const destination = index + delta;
          if (destination < 0 || destination >= entries.length) return;
          index = destination;
          let stopped = false;
          const event = { state: browser.history.state, stopImmediatePropagation() { stopped = true; } };
          const handlers = listeners.filter(listener => listener.type === "popstate");
          // Window popstate reaches listeners in registration order. A capture
          // flag added after Next's listener cannot move a guard ahead of it.
          for (const listener of handlers) {
            if (stopped) break;
            listener.handler(event);
          }
        });
      },
      back() { this.go(-1); },
      forward() { this.go(1); },
    },
  };
  // The real Next instrumentation entry installs this before router hydration.
  installUnsavedHistoryDispatcher(browser);
  browser.addEventListener("popstate", () => restored.push({ url: browser.location.href, state: browser.history.state }));
  const flush = () => {
    let count = 0;
    while (tasks.length) {
      assert.ok(++count <= 30, "history recovery must not loop");
      tasks.shift()();
    }
  };
  return { browser, entries, calls, restored, flush, flushOne: () => tasks.shift()?.(), index: () => index, pending: () => tasks.length };
}

test("Back restores ownership before asking, then confirmed traversal reaches the prior route once", () => {
  const ui = createBrowser(), attempts = [];
  const guard = createUnsavedHistoryFallback(ui.browser, resume => attempts.push(resume));
  ui.browser.history.back();
  ui.flushOne();
  assert.equal(attempts.length, 0);
  assert.equal(ui.restored.length, 0);
  ui.flushOne();
  assert.equal(attempts.length, 1);
  assert.equal(ui.index(), 2);
  assert.equal(ui.restored.length, 0);
  guard.release(attempts[0]);
  ui.flush();
  assert.equal(ui.browser.location.href, "https://tips.test/admin/dashboard");
  assert.equal(ui.restored.length, 1);
  assert.equal(ui.entries[1].state.__tipsUnsavedHistory, undefined);
  assert.deepEqual(ui.entries[1], ui.entries[2], "retired forward copy has no stale state");
});

test("repeated Back preserves the first intent already owned by a confirmation dialog", () => {
  const ui = createBrowser(), attempts = [];
  const guard = createUnsavedHistoryFallback(ui.browser, resume => attempts.push(resume));
  ui.browser.history.back(); ui.flush();
  ui.browser.history.back(); ui.flush();
  assert.equal(attempts.length, 2);
  assert.equal(ui.index(), 2);
  guard.release(attempts[0]); ui.flush();
  assert.equal(ui.index(), 0);
  const previousCalls = [...ui.calls];
  attempts[1](); ui.flush();
  assert.deepEqual(ui.calls, previousCalls, "an ignored later intent cannot cause another traversal");
});

test("repeated release of the same intent cannot execute it twice", () => {
  const ui = createBrowser();
  let completed = 0;
  const guard = createUnsavedHistoryFallback(ui.browser, () => {});
  const intent = () => { completed += 1; };
  guard.release(intent);
  guard.release(intent);
  ui.flush();
  guard.release(intent);
  assert.equal(completed, 1);
});

test("release preserves the latest same-document URL and opaque Next state", () => {
  const ui = createBrowser();
  const originalReplace = ui.browser.history.replaceState;
  const guard = createUnsavedHistoryFallback(ui.browser, () => assert.fail("cleanup is not a navigation attempt"));
  const nextState = stateFor("latest");
  ui.browser.history.replaceState(nextState, "", "/admin/students?studentId=a&page=3");
  let completed = 0;
  guard.release(() => { completed += 1; });
  assert.equal(completed, 0);
  ui.flush();
  assert.equal(completed, 1);
  assert.equal(ui.index(), 1);
  assert.equal(ui.browser.location.href, "https://tips.test/admin/students?studentId=a&page=3");
  assert.deepEqual(ui.browser.history.state, nextState);
  assert.deepEqual(ui.entries[1], ui.entries[2]);
  assert.equal(ui.restored.length, 0);
  assert.equal(ui.browser.history.replaceState, originalReplace);
});

test("release during restoration waits for ownership before running its intent", () => {
  const ui = createBrowser();
  let attempts = 0, completed = 0;
  const guard = createUnsavedHistoryFallback(ui.browser, () => { attempts += 1; });
  ui.browser.history.back(); ui.flushOne();
  guard.release(() => { completed += 1; });
  assert.equal(completed, 0);
  ui.flush();
  assert.equal(completed, 1);
  assert.equal(attempts, 0);
  assert.equal(ui.index(), 1);
  assert.equal(ui.restored.length, 0);
});

test("effect cleanup retires its sentinel before a new dirty lifetime is armed", () => {
  const ui = createBrowser(), attempts = [];
  const oldGuard = createUnsavedHistoryFallback(ui.browser, () => assert.fail("disposed guard must not ask"));
  oldGuard.dispose();
  const nextGuard = createUnsavedHistoryFallback(ui.browser, resume => attempts.push(resume));
  assert.equal(ui.entries.length, 3);
  ui.flush();
  assert.equal(ui.entries.length, 3);
  assert.equal(ui.index(), 2);
  ui.browser.history.back(); ui.flush();
  assert.equal(attempts.length, 1);
  nextGuard.dispose(); ui.flush();
  assert.equal(ui.index(), 1);
  assert.equal(ui.restored.length, 0);
});

test("a guard disposed while waiting never arms or leaves a history listener", () => {
  const ui = createBrowser();
  const first = createUnsavedHistoryFallback(ui.browser, () => {});
  first.dispose();
  const second = createUnsavedHistoryFallback(ui.browser, () => assert.fail("waiting lifetime cannot ask"));
  second.dispose(); ui.flush();
  assert.equal(ui.index(), 1);
  ui.browser.history.back(); ui.flush();
  assert.equal(ui.index(), 0);
  assert.equal(ui.restored.length, 1);
});

test("unmount after an unrelated push never backs out of or rewrites the new route", () => {
  const ui = createBrowser();
  const guard = createUnsavedHistoryFallback(ui.browser, () => {});
  const destinationState = stateFor("destination");
  ui.browser.history.pushState(destinationState, "", "/admin/classes");
  guard.dispose(); ui.flush();
  assert.equal(ui.browser.location.href, "https://tips.test/admin/classes");
  assert.deepEqual(ui.browser.history.state, destinationState);
  assert.deepEqual(ui.calls, []);
});

test("multi-entry Back resumes its original destination after restoration", () => {
  const ui = createBrowser(["/admin/dashboard", "/admin/classes", "/admin/students?studentId=a"]), attempts = [];
  const guard = createUnsavedHistoryFallback(ui.browser, resume => attempts.push(resume));
  ui.browser.history.go(-3); ui.flush();
  assert.equal(ui.index(), 3);
  assert.equal(attempts.length, 1);
  guard.release(attempts[0]); ui.flush();
  assert.equal(ui.index(), 0);
  assert.equal(ui.restored.length, 1);
});

test("approved router pushes run after cleanup and retain a single return entry", () => {
  const ui = createBrowser();
  const guard = createUnsavedHistoryFallback(ui.browser, () => {});
  guard.release(() => ui.browser.history.pushState(stateFor("class"), "", "/admin/classes"));
  ui.flush();
  assert.equal(ui.entries.length, 3);
  ui.browser.history.back(); ui.flush();
  assert.equal(ui.browser.location.href, "https://tips.test/admin/students?studentId=a");
  assert.equal(ui.index(), 1);
});

test("resume can be invoked directly and cannot traverse twice", () => {
  const ui = createBrowser();
  let resume;
  createUnsavedHistoryFallback(ui.browser, next => { resume = next; });
  ui.browser.history.back(); ui.flush();
  resume(); ui.flush();
  const previousCalls = [...ui.calls];
  resume(); ui.flush();
  assert.deepEqual(ui.calls, previousCalls);
});

test("sentinel fallback explicitly truncates a pre-existing forward branch", () => {
  const ui = createBrowser(["/admin/dashboard", "/admin/students?studentId=a", "/admin/classes"], 1);
  const guard = createUnsavedHistoryFallback(ui.browser, () => {});
  assert.equal(ui.entries.length, 3);
  assert.equal(ui.entries[2].url, "https://tips.test/admin/students?studentId=a");
  guard.dispose(); ui.flush();
});

test("null history state is preserved rather than becoming an unrelated state object", () => {
  const ui = createBrowser();
  ui.browser.history.replaceState(null, "", ui.browser.location.href);
  const guard = createUnsavedHistoryFallback(ui.browser, () => {});
  guard.dispose(); ui.flush();
  assert.equal(ui.browser.history.state, null);
  assert.equal(ui.entries[2].state, null);
});

test("a browser with no prior history does not gain an artificial Back step", () => {
  const ui = createBrowser(["/admin/students?studentId=a"]);
  const guard = createUnsavedHistoryFallback(ui.browser, () => assert.fail("there is no Back destination"));
  assert.equal(ui.entries.length, 1);
  let completed = 0;
  guard.release(() => { completed += 1; });
  assert.equal(completed, 1);
  assert.deepEqual(ui.calls, []);
});


test("local filter pushes preserve legacy draft ownership and the latest URL through cancelled Back", () => {
  const ui=createBrowser(), attempts=[];
  const guard=createUnsavedHistoryFallback(ui.browser,resume=>attempts.push(resume));
  const length=ui.browser.history.length;
  pushLocalHistoryState(ui.browser,stateFor('page2'),'','/admin/students?page=2');
  assert.equal(ui.browser.history.length,length);
  assert.equal(ui.browser.history.state.__tipsUnsavedHistory.role,'sentinel');
  ui.browser.history.back();ui.flush();
  assert.equal(attempts.length,1);assert.equal(ui.browser.location.href,'https://tips.test/admin/students?page=2');
  assert.equal(ui.restored.length,0,'cancelled history never publishes an intermediate filter to Next');
  guard.release(attempts[0]);ui.flush();assert.equal(ui.browser.location.href,'https://tips.test/admin/dashboard');
});

test("local filter pushes keep ordinary history when no legacy guard owns the current entry", () => {
  const ui=createBrowser();const before=ui.browser.history.length;
  pushLocalHistoryState(ui.browser,stateFor('page2'),'','/admin/students?page=2');
  assert.equal(ui.browser.history.length,before+1);assert.deepEqual(ui.browser.history.state,stateFor('page2'));
  ui.browser.history.back();ui.flush();assert.equal(ui.browser.location.href,'https://tips.test/admin/students?studentId=a');
});

test("early dispatch protects repeated Back after local query changes from router-driven editor disposal", () => {
  const ui = createBrowser(), attempts = [];
  let renderedUrl = ui.browser.location.href;
  let disposedByRouter = false;
  let guard;
  // Installed before the dirty editor, just as the hydrated router is.
  ui.browser.addEventListener("popstate", () => {
    if (ui.browser.location.href !== renderedUrl) {
      disposedByRouter = true;
      guard.dispose();
    }
  });
  guard = createUnsavedHistoryFallback(ui.browser, resume => attempts.push(resume));
  ui.browser.history.back(); ui.flush();
  assert.equal(attempts.length, 1);
  for (const subject of ["english", "math"]) {
    pushLocalHistoryState(ui.browser, stateFor(subject), "", `/admin/students?subject=${subject}`);
    renderedUrl = ui.browser.location.href;
  }
  ui.browser.history.back(); ui.flush();
  assert.equal(attempts.length, 2);
  assert.equal(disposedByRouter, false);
  assert.equal(ui.browser.location.href, renderedUrl);
  assert.equal(ui.restored.length, 0);
  guard.release(attempts[0]); ui.flush();
  assert.equal(ui.browser.location.href, "https://tips.test/admin/dashboard");
  assert.equal(ui.restored.length, 1, "the approved destination is published once");
});

test("bootstrap is idempotent and inactive dispatch preserves normal Back and Forward", () => {
  const ui = createBrowser();
  assert.equal(installUnsavedHistoryDispatcher(ui.browser), installUnsavedHistoryDispatcher(ui.browser));
  ui.browser.history.back(); ui.flush();
  ui.browser.history.forward(); ui.flush();
  assert.equal(ui.restored.length, 2);
  assert.equal(ui.index(), 1);
});
