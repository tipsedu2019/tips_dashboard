import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "tests", "fixtures", "public-classes-cache-next-app");
const node = process.execPath;

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let output = "";
    child.stdout.on("data", (value) => { output += value; });
    child.stderr.on("data", (value) => { output += value; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(output) : reject(new Error(output)));
  });
}

async function start(port, env) {
  const child = spawn(node, [path.join(root, "node_modules/next/dist/bin/next"), "start", fixture, "-p", String(port)], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (value) => { output += value; });
  child.stderr.on("data", (value) => { output += value; });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/summary`);
      if (response.ok) return { child, output: () => output };
    } catch {
      // The process has not bound its loopback port yet.
    }
  }
  child.kill("SIGTERM");
  throw new Error(`fixture did not start: ${output}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

async function readCounter(counter) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = await readFile(counter, "utf8");
    if (/^\d+$/.test(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return readFile(counter, "utf8");
}

test("Next Data Cache reuses a successful public class summary across processes and keeps last-good after tag revalidation failure", { timeout: 120_000 }, async () => {
  const requestId = `cache-${process.pid}-${Date.now()}`;
  const temp = path.join("/private/tmp", `tips-public-cache-${requestId}`);
  assert.match(temp, /^\/private\/tmp\/tips-public-cache-[A-Za-z0-9-]+$/);
  await mkdir(temp, { recursive: true });
  const counter = path.join(temp, "counter.txt");
  await writeFile(counter, "0", "utf8");
  const env = { ...process.env, TIPS_PUBLIC_CACHE_COUNTER_PATH: counter };

  try {
    await rm(path.join(fixture, ".next"), { recursive: true, force: true });
    await run(node, [path.join(root, "node_modules/next/dist/bin/next"), "build", fixture], { cwd: root, env });
    const portA = await reservePort();
    const first = await start(portA, env);
    try {
      assert.equal((await fetch(`http://127.0.0.1:${portA}/api/summary`)).status, 200);
      assert.equal(await readCounter(counter), "1");
    } finally {
      await stop(first.child);
    }

    const portB = await reservePort();
    const second = await start(portB, env);
    try {
      const summaryUrl = `http://127.0.0.1:${portB}/api/summary`;
      assert.equal((await fetch(summaryUrl)).status, 200);
      assert.equal(await readCounter(counter), "1");
      assert.equal((await fetch(summaryUrl, { method: "POST" })).status, 200);
      for (let attempt = 0; attempt < 20 && await readCounter(counter) !== "2"; attempt += 1) {
        assert.equal((await fetch(summaryUrl)).status, 200);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(await readCounter(counter), "2");
      const failingEnv = { ...env, TIPS_PUBLIC_CACHE_FAIL: "1" };
      await stop(second.child);
      const failed = await start(portB, failingEnv);
      try {
        await fetch(summaryUrl, { method: "POST" });
        const response = await fetch(summaryUrl);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).classes[0].id, "class-2");
      } finally {
        await stop(failed.child);
      }
    } finally {
      await stop(second.child);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
