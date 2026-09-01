import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getErrorMessage } from "../src/lib/error-message.ts";

test("returns the message from native Error instances", () => {
  assert.equal(getErrorMessage(new Error("database unavailable"), "fallback"), "database unavailable");
});

test("returns the message from structured Supabase errors", () => {
  assert.equal(
    getErrorMessage({ code: "22007", message: "invalid input syntax for type date" }, "fallback"),
    "invalid input syntax for type date",
  );
});

test("uses structured details when message is missing", () => {
  assert.equal(
    getErrorMessage({ code: "PGRST500", details: "upstream database rejected the query" }, "fallback"),
    "upstream database rejected the query",
  );
});

test("ignores blank or non-string fields and does not stringify arbitrary objects", () => {
  assert.equal(getErrorMessage({ message: "  ", details: { secret: "do not expose" } }, "안전한 오류"), "안전한 오류");
  assert.equal(getErrorMessage({ token: "do not expose" }, "안전한 오류"), "안전한 오류");
  assert.equal(getErrorMessage(null, "안전한 오류"), "안전한 오류");
});

test("workspace hooks preserve structured range and numbered-page errors", async () => {
  const sources = await Promise.all([
    readFile(new URL("../src/features/academic/use-academic-workspace-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/operations/use-operations-workspace-data.ts", import.meta.url), "utf8"),
  ]);

  for (const source of sources) {
    assert.match(source, /import \{ getErrorMessage \} from "@\/lib\/error-message"/);
    assert.match(source, /setRangeError\(getErrorMessage\(error,/);
    assert.match(source, /snapshot\?\.error \? getErrorMessage\(snapshot\.error,/);
    assert.doesNotMatch(source, /Unknown error/);
  }
});
