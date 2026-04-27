import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

test("v2 package declares module type for Node-based admin parity tests", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "v2", "package.json"), "utf8"),
  );

  assert.equal(packageJson.type, "module");
});
