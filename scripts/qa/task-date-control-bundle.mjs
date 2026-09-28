import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

// Run after a production build, from the repository root. This measures the
// route's client-reference chunks, not a browser's complete network transfer.
const routes = {};
for (const route of ["registration", "transfer", "withdrawal", "word-retests"]) {
  const sandbox = {};
  vm.runInNewContext(await readFile(`.next/server/app/admin/${route}/page_client-reference-manifest.js`, "utf8"), sandbox);
  const manifest = sandbox.__RSC_MANIFEST[`/admin/${route}/page`];
  const paths = [...new Set(Object.values(manifest.clientModules)
    .flatMap((module) => module.chunks).filter((path) => path.endsWith(".js")))];
  const files = await Promise.all(paths.map(async (path) => {
    const bytes = await readFile(`.next/${path}`);
    return { path, bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
  }));
  routes[route] = {
    files,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
  };
}
console.log(JSON.stringify({ routes }, null, 2));
