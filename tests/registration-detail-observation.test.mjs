import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { createRegistrationDetailObservation } from "../src/features/tasks/registration-detail-observation.ts";

function fixture() {
  let time = 100;
  const outputs = [];
  const observer = createRegistrationDetailObservation({ now: () => time, emit: rows => outputs.push(rows) });
  return { observer, outputs, setTime: value => { time = value; } };
}

test("only fixed labels and elapsed time survive the output boundary", () => {
  const { observer, outputs, setTime } = fixture();
  const poison = new Proxy({}, { get() { throw new Error("must not inspect payload"); } });
  observer.record(poison, "failure");
  observer.record("events", poison);
  observer.record("https://synthetic.invalid?token=FAKE_PRIVATE", "failure");
  observer.begin("events");
  setTime(107.8);
  observer.end("events", false);
  observer.finish(false);
  assert.deepEqual(outputs, [[
    { kind: "events", phase: "start", elapsedMs: 0 },
    { kind: "events", phase: "failure", elapsedMs: 7 },
    { kind: "detail", phase: "failure", elapsedMs: 7 },
  ]]);
  for (const row of outputs[0]) assert.deepEqual(Object.keys(row), ["kind", "phase", "elapsedMs"]);
});

test("successful reads remove both listeners; late deadlines never enter a later failure table", () => {
  const { observer, outputs } = fixture();
  const deadline = new AbortController();
  const detail = new AbortController();
  observer.watchDeadline("tracks", deadline.signal);
  observer.begin("tracks", detail.signal);
  assert.equal(getEventListeners(deadline.signal, "abort").length, 1);
  assert.equal(getEventListeners(detail.signal, "abort").length, 1);
  observer.end("tracks", true);
  assert.equal(getEventListeners(deadline.signal, "abort").length, 0);
  assert.equal(getEventListeners(detail.signal, "abort").length, 0);
  deadline.abort(new Error("FAKE_PRIVATE"));
  detail.abort(new Error("FAKE_PRIVATE"));
  observer.finish(false);
  assert.equal(outputs[0].some(row => row.phase.endsWith("elapsed") || row.phase === "detail_cancel_observed"), false);
});

test("owned deadline and detail cancellation are separate, emitted once, without reading reasons", () => {
  const { observer, outputs, setTime } = fixture();
  const deadline = new AbortController();
  const detail = new AbortController();
  const privateReason = new Proxy({}, { get() { throw new Error("reason is private"); } });
  observer.watchDeadline("tracks", deadline.signal);
  observer.begin("tracks", detail.signal);
  setTime(8100);
  deadline.abort(privateReason);
  detail.abort(privateReason);
  observer.end("tracks", false);
  observer.finish(false);
  observer.finish(false);
  observer.record("tracks", "failure");
  assert.equal(outputs.length, 1);
  assert.deepEqual(outputs[0].map(row => row.phase), ["start", "child_deadline_elapsed", "detail_cancel_observed", "failure", "failure"]);
  assert.equal(getEventListeners(detail.signal, "abort").length, 0);
});

test("already aborted signals are recorded once and cleaned up", () => {
  const { observer, outputs } = fixture();
  const deadline = new AbortController();
  deadline.abort("FAKE_PRIVATE");
  observer.watchDeadline("tracks", deadline.signal);
  observer.finish(false);
  assert.equal(outputs[0].filter(row => row.phase === "child_deadline_elapsed").length, 1);
  assert.equal(getEventListeners(deadline.signal, "abort").length, 0);
});

test("success closes the buffer silently and cleans up pending request listeners", () => {
  const { observer, outputs } = fixture();
  const deadline = new AbortController();
  observer.watchDeadline("tracks", deadline.signal);
  observer.begin("detail");
  observer.finish(true);
  deadline.abort();
  observer.end("reminder_request", false);
  observer.finish(false);
  assert.deepEqual(outputs, []);
  assert.equal(getEventListeners(deadline.signal, "abort").length, 0);
});

test("buffer is capped at 64 with room for truncation and terminal failure", () => {
  const { observer, outputs } = fixture();
  for (let i = 0; i < 1000; i++) observer.record("events", "start", true);
  observer.finish(false);
  assert.equal(outputs[0].length, 64);
  assert.equal(outputs[0].at(-2).phase, "truncated");
  assert.deepEqual(outputs[0].at(-1), { kind: "detail", phase: "failure", elapsedMs: 0 });
});

test("clock and sink failures are contained and finite elapsed times remain monotonic", () => {
  assert.equal(createRegistrationDetailObservation({ now() { throw new Error("clock"); }, emit() { assert.fail(); } }), undefined);
  assert.equal(createRegistrationDetailObservation({ now: () => NaN, emit() { assert.fail(); } }), undefined);
  const { observer, outputs, setTime } = fixture();
  observer.begin("detail");
  setTime(120.5); observer.record("tracks", "start");
  setTime(110); observer.record("tracks", "success");
  setTime(Infinity); observer.record("events", "start");
  setTime(-1); observer.record("events", "start");
  setTime(1e100); observer.record("events", "start");
  setTime(130); observer.finish(false);
  assert.deepEqual(outputs[0].map(row => row.elapsedMs), [0, 20, 20, 30]);
  const broken = createRegistrationDetailObservation({ now: () => 1, emit() { throw new Error("sink"); } });
  broken.begin("detail");
  assert.doesNotThrow(() => broken.finish(false));
  let first = true;
  const interrupted = createRegistrationDetailObservation({ now() { if (first) { first = false; return 1; } throw new Error("clock"); }, emit() { assert.fail(); } });
  assert.doesNotThrow(() => { interrupted.begin("detail"); interrupted.finish(false); });
});

test("concurrent buffers and emitted snapshots stay isolated", () => {
  const one = fixture();
  const two = fixture();
  one.observer.begin("tracks");
  two.observer.begin("events");
  one.setTime(108); one.observer.finish(false);
  two.setTime(115); two.observer.finish(false);
  one.outputs[0][0].kind = "modified by sink";
  assert.deepEqual(two.outputs[0], [
    { kind: "events", phase: "start", elapsedMs: 0 },
    { kind: "detail", phase: "failure", elapsedMs: 15 },
  ]);
  one.observer.finish(false);
  assert.equal(one.outputs.length, 1);
});
