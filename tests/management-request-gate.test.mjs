import test from "node:test";
import assert from "node:assert/strict";

import { createManagementRequestGate } from "../src/features/management/management-request-gate.ts";

test("a newer management scope aborts and invalidates the previous ticket", () => {
  const gate = createManagementRequestGate();
  const first = gate.begin("students:first");
  const second = gate.begin("students:second");
  assert.equal(first.signal.aborted, true);
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});

test("cleanup aborts the current management request", () => {
  const gate = createManagementRequestGate();
  const ticket = gate.begin("classes:page-1");
  gate.abort();
  assert.equal(ticket.signal.aborted, true);
  assert.equal(gate.isCurrent(ticket), false);
});
