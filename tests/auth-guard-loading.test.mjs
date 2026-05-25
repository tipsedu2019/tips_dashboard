import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("admin auth guard uses an app-shaped loading skeleton", async () => {
  const source = await readFile(new URL("src/components/auth/auth-guard.tsx", root), "utf8");

  assert.match(source, /function AdminShellLoadingState/);
  assert.match(source, /min-h-\[100dvh\]/);
  assert.match(source, /grid-cols-1 md:grid-cols-\[16rem_1fr\]/);
  assert.match(source, /<Skeleton/);
  assert.match(source, /sr-only/);
  assert.match(source, /관리자 화면을 준비하고 있습니다\./);
  assert.doesNotMatch(source, /animate-spin/);
  assert.doesNotMatch(source, /border-b-2 border-primary/);
});

test("admin auth guard preserves protected query strings for login return", async () => {
  const source = await readFile(new URL("src/components/auth/auth-guard.tsx", root), "utf8");

  assert.match(source, /useSearchParams/);
  assert.match(source, /const searchParams = useSearchParams\(\)/);
  assert.match(source, /const queryString = searchParams\.toString\(\)/);
  assert.match(source, /const nextPath = queryString \? `\$\{pathname\}\?\$\{queryString\}` : pathname/);
  assert.match(source, /encodeURIComponent\(nextPath\)/);
});

test("root metadata only points at existing icon assets", async () => {
  const source = await readFile(new URL("src/app/layout.tsx", root), "utf8");
  const favicon = await stat(new URL("public/favicon.ico", root));

  assert.match(source, /favicon-window\.png/);
  assert.match(source, /favicon\.png/);
  assert.doesNotMatch(source, /favicon\.ico/);
  assert.ok(favicon.size > 0);
});
