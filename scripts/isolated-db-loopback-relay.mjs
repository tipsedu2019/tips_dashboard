import { spawn } from "node:child_process";
import { createServer } from "node:net";

// Docker Desktop can suppress published ports on internal bridges. This owned
// loopback socket reaches only the owned DB's localhost through Docker exec;
// the DB keeps its internal network and receives no Docker socket mount.
export async function createOwnedLoopbackRelay({ containerName, port, env, spawnProcess = spawn }) {
  if (!/^supabase_db_tips_supabase_db_qa_[a-f0-9]{12}$/u.test(containerName)
    || !Number.isInteger(port) || port < 1024 || port > 65535
    || !env || Object.keys(env).some((key) => !["PATH", "LANG", "LC_ALL", "SUPABASE_TELEMETRY_DISABLED"].includes(key))) {
    throw new Error("isolated_supabase_db_relay_target_invalid");
  }
  const sockets = new Set();
  const children = new Map();
  let closed = false;
  let relayError = null;
  const diagnostics = { connections: 0, clientBytes: 0, dbBytes: 0, failures: [] };
  const server = createServer((socket) => {
    sockets.add(socket);
    diagnostics.connections += 1;
    let socketClosed = false;
    let stderr = "";
    socket.on("data", (chunk) => { diagnostics.clientBytes += chunk.length; });
    let child;
    try {
      child = spawnProcess("docker", ["exec", "-i", containerName, "nc", "-n", "127.0.0.1", "5432"],
        { env, stdio: ["pipe", "pipe", "pipe"] });
    } catch { relayError = new Error("isolated_supabase_db_relay_spawn_failed"); socket.destroy(); return; }
    child.stdout.on("data", (chunk) => { diagnostics.dbBytes += chunk.length; });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-1000); });
    const exited = new Promise((resolve) => {
      child.once("close", resolve);
      child.once("error", () => { relayError = new Error("isolated_supabase_db_relay_spawn_failed"); });
    });
    child.once("close", (code, signal) => {
      if (!socketClosed && !closed && (code !== 0 || signal)) {
        relayError = new Error("isolated_supabase_db_relay_session_failed");
        // Keep counts and status only. Never record protocol or stderr payloads.
        if (diagnostics.failures.length < 12) diagnostics.failures.push({ code, signal, stderrBytes: Buffer.byteLength(stderr) });
      }
    });
    children.set(child, exited);
    exited.then(() => { children.delete(child); socket.destroy(); });
    child.stdin.on("error", () => socket.destroy());
    child.stdout.on("error", () => socket.destroy());
    socket.on("error", () => {});
    socket.once("close", () => { socketClosed = true; sockets.delete(socket); if (children.has(child)) child.kill("SIGTERM"); });
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
  });
  server.on("error", (error) => { relayError = error; });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    getDiagnostics: () => structuredClone(diagnostics),
    assertBoundary() {
      const address = server.address();
      if (closed || relayError || !address || address.address !== "127.0.0.1" || address.port !== port) {
        throw new Error("isolated_supabase_db_relay_boundary_invalid");
      }
      return true;
    },
    async close() {
      if (closed) return;
      closed = true;
      const ownedChildren = [...children];
      for (const socket of sockets) socket.destroy();
      for (const [child] of ownedChildren) child.kill("SIGTERM");
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await Promise.all(ownedChildren.map(async ([child, exited]) => {
        let timer;
        let forceTimer;
        try {
          await Promise.race([exited, new Promise((_resolve, reject) => {
            timer = setTimeout(() => {
              child.kill("SIGKILL");
              forceTimer = setTimeout(() => reject(new Error("isolated_supabase_db_relay_cleanup_failed")), 1000);
            }, 2000);
          })]);
        } finally { clearTimeout(timer); clearTimeout(forceTimer); }
        if (children.has(child)) throw new Error("isolated_supabase_db_relay_cleanup_failed");
      }));
    },
  };
}
