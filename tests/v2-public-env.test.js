import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveTipsPublicEnv } from "../v2/public-env.js";

test("resolveTipsPublicEnv falls back to VITE Supabase variables", () => {
  const resolved = resolveTipsPublicEnv({
    VITE_SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_ANON_KEY: "anon-key",
  });

  assert.equal(
    resolved.NEXT_PUBLIC_SUPABASE_URL,
    "https://example.supabase.co",
  );
  assert.equal(resolved.NEXT_PUBLIC_SUPABASE_ANON_KEY, "anon-key");
});

test("resolveTipsPublicEnv prefers NEXT_PUBLIC values when both exist", () => {
  const resolved = resolveTipsPublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://next.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "next-anon",
    VITE_SUPABASE_URL: "https://vite.supabase.co",
    VITE_SUPABASE_ANON_KEY: "vite-anon",
  });

  assert.equal(
    resolved.NEXT_PUBLIC_SUPABASE_URL,
    "https://next.supabase.co",
  );
  assert.equal(resolved.NEXT_PUBLIC_SUPABASE_ANON_KEY, "next-anon");
});

test("resolveTipsPublicEnv reads root .env.local VITE keys for a nested v2 app", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tips-v2-env-"));
  const appDir = path.join(tempRoot, "v2");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, ".env.local"),
    "VITE_SUPABASE_URL=https://root.supabase.co\nVITE_SUPABASE_ANON_KEY=root-anon\n",
    "utf8",
  );

  const resolved = resolveTipsPublicEnv({}, { appDir });

  assert.equal(resolved.NEXT_PUBLIC_SUPABASE_URL, "https://root.supabase.co");
  assert.equal(resolved.NEXT_PUBLIC_SUPABASE_ANON_KEY, "root-anon");

  fs.rmSync(tempRoot, { recursive: true, force: true });
});
