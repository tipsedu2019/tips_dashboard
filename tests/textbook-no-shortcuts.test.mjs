import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers/textbook-numbered-harness.mjs";

test("retired textbook search hotkey does not steal focus; search remains clickable", async (t) => {
  const h = await setup(t);
  const input = document.querySelector('input[aria-label="교재 검색"]');
  assert.ok(input);
  assert.equal(input.hasAttribute("aria-keyshortcuts"), false);
  const sentinel = document.createElement("button");
  sentinel.textContent = "현재 작업 유지";
  document.body.appendChild(sentinel);
  t.after(() => sentinel.remove());
  sentinel.focus();
  const event = new window.KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
  await h.act(() => sentinel.dispatchEvent(event));
  assert.equal(event.defaultPrevented, false);
  assert.equal(document.activeElement, sentinel);
  await h.act(() => { input.focus(); input.click(); });
  assert.equal(document.activeElement, input);
});
