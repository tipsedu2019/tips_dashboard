import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { waitForFocus } from "./helpers/dom-focus.mjs";

const h = { act: async (callback) => callback() };

test("focus verification waits for deferred restoration", async (t) => {
  const dom = new JSDOM('<button aria-label="Filter">Filter</button>');
  t.after(() => dom.window.close());
  const target = dom.window.document.querySelector("button");
  dom.window.setTimeout(() => target.focus(), 30);

  await waitForFocus(h, target);

  assert.ok(dom.window.document.activeElement === target);
});

test("missing focus restoration fails with bounded diagnostics without forcing focus", async (t) => {
  const dom = new JSDOM('<button aria-label="Filter">Filter</button>');
  t.after(() => dom.window.close());
  const target = dom.window.document.querySelector("button");

  await assert.rejects(waitForFocus(h, target, 30), {
    code: "ERR_ASSERTION",
    message: "focus did not return to BUTTON Filter; active element: BODY",
  });
  assert.ok(dom.window.document.activeElement === dom.window.document.body);
});
