import assert from "node:assert/strict";
import test from "node:test";

async function harness() {
  const exports = await import("../src/lib/numbered-page-controller.ts").catch(() => ({}));
  assert.equal(typeof exports.createNumberedPageController, "function", "production numbered controller must exist");
  const requests = [], snapshots = [];
  const controller = exports.createNumberedPageController({
    loadPage(request) {
      return new Promise((resolve, reject) => requests.push({ ...request, resolve, reject }));
    },
    onChange: (snapshot) => snapshots.push(snapshot),
  });
  const result = (index, totalCount = 260) => {
    const request = requests[index];
    request.resolve({ page: request.page, pageSize: request.pageSize, totalCount,
      rows: Array.from({ length: Math.min(request.pageSize, Math.max(0, totalCount - (request.page - 1) * request.pageSize)) }, (_, i) => `${request.scope}:${request.page}:${i}`) });
  };
  return { controller, requests, snapshots, result };
}

test("direct page 11 never loads pages 2 through 10; pending/error retains displayed envelope", async () => {
  const { controller, requests, snapshots, result } = await harness();
  const first = controller.load({ scope: "A", page: 1, pageSize: 10 }); result(0); await first;
  const pending = controller.load({ scope: "B", page: 11, pageSize: 15 });
  assert.deepEqual(requests.map((r) => r.page), [1, 11]);
  assert.deepEqual({ ...snapshots.at(-1), loading: false, requestedPage: 1 }, snapshots.at(-2));
  requests[1].reject(new Error("offline")); await pending;
  assert.equal(snapshots.at(-1).scope, "A");
  assert.equal(snapshots.at(-1).pageSize, 10);
  assert.equal(snapshots.at(-1).totalCount, 260);
  assert.equal(snapshots.at(-1).error.message, "offline");
  const retry = controller.retry(); result(2); await retry;
  assert.equal(snapshots.at(-1).scope, "B");
  assert.equal(snapshots.at(-1).page, 11);
});

test("stale completions cannot publish rows, totals, errors, or settlements", async () => {
  const { controller, requests, snapshots, result } = await harness();
  const old = controller.load({ scope: "old", page: 11, pageSize: 10 });
  const fresh = controller.load({ scope: "filter=new", page: 1, pageSize: 20 });
  assert.equal(requests[0].signal.aborted, true);
  result(1, 3); await fresh;
  const count = snapshots.length;
  result(0, 800); await old;
  assert.equal(snapshots.length, count);
  assert.equal(snapshots.at(-1).totalCount, 3);
  assert.equal(snapshots.at(-1).page, 1);
});

test("refresh keeps valid page and deletion clamps to the final page once", async () => {
  const { controller, requests, snapshots, result } = await harness();
  const first = controller.load({ scope: "A", page: 11, pageSize: 10 }); result(0, 101); await first;
  const refresh = controller.retry(); result(1, 101); await refresh;
  assert.equal(snapshots.at(-1).page, 11);
  const deleted = controller.retry(); result(2, 100);
  await Promise.resolve();
  assert.equal(requests[3].page, 10);
  assert.equal(snapshots.at(-1).page, 11);
  result(3, 100); await deleted;
  assert.equal(snapshots.at(-1).page, 10);
  assert.equal(snapshots.at(-1).totalCount, 100);
});

test("concurrent shrink does not loop and leaves a retriable prior snapshot", async () => {
  const { controller, requests, snapshots, result } = await harness();
  const first = controller.load({ scope: "A", page: 11, pageSize: 10 }); result(0, 101); await first;
  const refresh = controller.retry(); result(1, 100); await Promise.resolve(); result(2, 80); await refresh;
  assert.equal(requests.length, 3);
  assert.equal(snapshots.at(-1).page, 11);
  assert.match(snapshots.at(-1).error.message, /changed|shrink|range/i);
  const retry = controller.retry(); result(3, 80); await Promise.resolve(); result(4, 80); await retry;
  assert.equal(snapshots.at(-1).page, 8);
});

test("dispose aborts and prevents publications, including ignored abort transports", async () => {
  const { controller, requests, snapshots, result } = await harness();
  const pending = controller.load({ scope: "A", page: 1, pageSize: 10 });
  controller.dispose(); const count = snapshots.length; result(0); await pending;
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(snapshots.length, count);
  await controller.retry();
  assert.equal(requests.length, 1);
});
