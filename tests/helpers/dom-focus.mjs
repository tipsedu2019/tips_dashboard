import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const describe = (element) => element
  ? `${element.tagName} ${element.getAttribute("aria-label") || element.id || ""}`.trim()
  : "none";

// Radix restores focus in a deferred FocusScope cleanup, after React's act.
// Observe that restoration without moving focus or inspecting React-backed DOM trees.
export async function waitForFocus(h, target, timeoutMs = 1000) {
  assert.ok(target, "focus return target must exist");
  const document = target.ownerDocument;
  const deadline = performance.now() + timeoutMs;
  while (document.activeElement !== target && performance.now() < deadline) {
    await h.act(() => delay(10));
  }
  assert.ok(document.activeElement === target,
    `focus did not return to ${describe(target)}; active element: ${describe(document.activeElement)}`);
}
