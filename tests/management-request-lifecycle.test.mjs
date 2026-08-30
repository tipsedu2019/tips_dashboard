import test from "node:test";
import assert from "node:assert/strict";

import { createManagementRequestGate } from "../src/features/management/management-request-gate.ts";
import {
  executeManagementContinuationRequest,
  executeManagementInitialRequest,
} from "../src/features/management/management-request-lifecycle.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

test("a newer initial scope aborts the caller signal from the previous request", async () => {
  const gate = createManagementRequestGate();
  const firstPage = deferred();
  const signals = [];
  const first = executeManagementInitialRequest({
    gate,
    scope: "students:first",
    load: (signal) => {
      signals.push(signal);
      return firstPage.promise;
    },
    onPage: () => assert.fail("stale page must not publish"),
    onMetadata: () => assert.fail("stale metadata must not publish"),
    onError: () => assert.fail("aborted work must be silent"),
  });

  const second = executeManagementInitialRequest({
    gate,
    scope: "students:refresh",
    load: async (signal) => {
      signals.push(signal);
      return { page: { rows: [] }, metadata: Promise.resolve({ ok: true, revision: 2 }) };
    },
    onPage: () => {},
    onMetadata: () => {},
    onError: assert.fail,
  });

  assert.equal(signals[0].aborted, true);
  assert.equal(first.ticket.signal.aborted, true);
  assert.equal(signals[1].aborted, false);

  firstPage.resolve({ page: { rows: [{ id: "stale" }] }, metadata: Promise.resolve({ ok: true }) });
  await Promise.all([first.completion, second.completion]);
});

test("the initial page publishes before deferred metadata", async () => {
  const gate = createManagementRequestGate();
  const metadata = deferred();
  const pagePublished = deferred();
  const events = [];
  const execution = executeManagementInitialRequest({
    gate,
    scope: "classes:first",
    load: async () => ({ page: { rows: [{ id: "class-1" }] }, metadata: metadata.promise }),
    onPage: () => {
      events.push("page");
      pagePublished.resolve();
    },
    onMetadata: () => events.push("metadata"),
    onError: assert.fail,
  });

  await pagePublished.promise;
  assert.deepEqual(events, ["page"]);
  metadata.resolve({ ok: true, stats: { total: 1 }, filterOptions: {} });
  await execution.completion;
  assert.deepEqual(events, ["page", "metadata"]);
});

test("metadata from an invalidated initial ticket never publishes", async () => {
  const gate = createManagementRequestGate();
  const metadata = deferred();
  const pagePublished = deferred();
  const events = [];
  const execution = executeManagementInitialRequest({
    gate,
    scope: "textbooks:first",
    load: async () => ({ page: { rows: [] }, metadata: metadata.promise }),
    onPage: () => {
      events.push("page");
      pagePublished.resolve();
    },
    onMetadata: () => events.push("metadata"),
    onError: assert.fail,
  });

  await pagePublished.promise;
  gate.begin("textbooks:new-filter");
  metadata.resolve({ ok: true, stats: { total: 99 }, filterOptions: {} });
  await execution.completion;
  assert.deepEqual(events, ["page"]);
});

test("a deferred continuation cannot merge after its initial ticket is invalidated", async () => {
  const initialGate = createManagementRequestGate();
  const continuationGate = createManagementRequestGate();
  const initialTicket = initialGate.begin("students:initial");
  const nextPage = deferred();
  const merged = [];
  const execution = executeManagementContinuationRequest({
    gate: continuationGate,
    initialGate,
    initialTicket,
    scope: "students:page-2",
    load: () => nextPage.promise,
    onPage: (page) => merged.push(page),
    onError: assert.fail,
  });

  initialGate.begin("students:new-filter");
  nextPage.resolve({ rows: [{ id: "stale-student" }] });
  await execution.completion;
  assert.deepEqual(merged, []);
});

test("AbortError is silent", async () => {
  const gate = createManagementRequestGate();
  const errors = [];
  const execution = executeManagementInitialRequest({
    gate,
    scope: "classes:aborted",
    load: async () => {
      throw new DOMException("aborted", "AbortError");
    },
    onPage: assert.fail,
    onMetadata: assert.fail,
    onError: (error) => errors.push(error),
  });

  await execution.completion;
  assert.deepEqual(errors, []);
});

test("a real error uses the error path without a row-clearing callback", async () => {
  const gate = createManagementRequestGate();
  const failure = new Error("stats unavailable");
  const pages = [];
  const metadata = [];
  const errors = [];
  const execution = executeManagementInitialRequest({
    gate,
    scope: "students:error",
    load: async () => {
      throw failure;
    },
    onPage: (page) => pages.push(page),
    onMetadata: (value) => metadata.push(value),
    onError: (error, phase) => errors.push([error, phase]),
  });

  await execution.completion;
  assert.deepEqual(pages, []);
  assert.deepEqual(metadata, []);
  assert.deepEqual(errors, [[failure, "page"]]);
});
