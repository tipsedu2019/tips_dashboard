import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const buttonSource = readFileSync(
  join(process.cwd(), "src", "components", "ui", "tds", "Button.jsx"),
  "utf8",
);

const badgeSource = readFileSync(
  join(process.cwd(), "src", "components", "ui", "tds", "Badge.jsx"),
  "utf8",
);

const iconButtonSource = readFileSync(
  join(process.cwd(), "src", "components", "ui", "tds", "IconButton.jsx"),
  "utf8",
);

test("Button wrapper accepts official-style color and variant props while preserving legacy aliases", () => {
  assert.match(buttonSource, /color\s*=/);
  assert.match(buttonSource, /variant\s*=/);
  assert.match(buttonSource, /onClick/);
  assert.match(buttonSource, /onPress/);
  assert.match(buttonSource, /const resolvedColor/);
  assert.match(buttonSource, /const resolvedVariant/);
  assert.match(buttonSource, /const clickHandler = onClick \|\| onPress/);
});

test("Badge wrapper accepts official-style color and variant props while preserving legacy aliases", () => {
  assert.match(badgeSource, /color\s*=/);
  assert.match(badgeSource, /variant\s*=/);
  assert.match(badgeSource, /type\s*=/);
  assert.match(badgeSource, /badgeStyle\s*=/);
  assert.match(badgeSource, /const resolvedColor/);
  assert.match(badgeSource, /const resolvedVariant/);
});

test("IconButton wrapper can respond to either onClick or onPress", () => {
  assert.match(iconButtonSource, /onClick/);
  assert.match(iconButtonSource, /onPress/);
  assert.match(iconButtonSource, /const clickHandler = onClick \|\| onPress/);
});
