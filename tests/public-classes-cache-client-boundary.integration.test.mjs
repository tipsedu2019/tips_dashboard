import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "tests", "fixtures", "public-classes-cache-client-next-app");

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let output = "";
    child.stdout.on("data", (value) => { output += value; });
    child.stderr.on("data", (value) => { output += value; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

test("the class schedule client graph compiles without importing Node-only cache modules", { timeout: 120_000 }, async () => {
  try {
    await rm(path.join(fixture, ".next"), { recursive: true, force: true });
    const result = await run(
      process.execPath,
      [path.join(root, "node_modules/next/dist/bin/next"), "build", fixture, "--webpack"],
      { cwd: root, env: process.env },
    );

    assert.equal(result.code, 0, result.output);
    assert.doesNotMatch(result.output, /UnhandledSchemeError|node:(?:fs|path|process|url)/u);
  } finally {
    await rm(path.join(fixture, ".next"), { recursive: true, force: true });
  }
});
