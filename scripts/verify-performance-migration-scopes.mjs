import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LIMITS = { userTablesPerMigration: 3, indexDdlsPerMigration: 4, policyDdlsPerMigration: 6 };
const MIGRATION = /^supabase\/migrations\/[^/]+\.sql$/u;
function fail(code) { throw new Error(code); }
function git(root, args) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function entriesFor(manifest, file, category) { return manifest.entries.filter((entry) => entry.file === file && entry.category === category); }
function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || manifest.version !== 1 || JSON.stringify(manifest.limits) !== JSON.stringify(LIMITS) || !Array.isArray(manifest.entries)) fail("performance_scope_manifest_invalid");
  for (const entry of manifest.entries) if (!entry || !MIGRATION.test(entry.file) || !["index", "rls"].includes(entry.category) || !Array.isArray(entry.tables) || entry.tables.length === 0 || !entry.tables.every((value) => /^[a-z_]+\.[a-z_]+$/u.test(value)) || typeof entry.reason !== "string" || !Array.isArray(entry.evidenceIds) || entry.evidenceIds.length === 0) fail("performance_scope_manifest_invalid");
}
export function inspectPerformanceMigrationScope({ file, source, manifest }) {
  validateManifest(manifest); const violations = []; const indexes = [...source.matchAll(/\b(?:create\s+(?:unique\s+)?index|drop\s+index)\b[\s\S]*?(?:\bon\s+)?((?:public|dashboard_private)\.[a-z_]+)/giu)];
  const policies = [...source.matchAll(/\b(?:create|drop)\s+policy\b[\s\S]*?\bon\s+((?:public|dashboard_private)\.[a-z_]+)/giu)];
  const check = (category, matches, limit) => {
    if (!matches.length) return; const allowed = new Set(entriesFor(manifest, file, category).flatMap(({ tables }) => tables)); const tables = new Set(matches.map((match) => match[1]));
    if (matches.length > limit) violations.push({ file, reason: `performance_${category}_ddl_limit` });
    if (tables.size > LIMITS.userTablesPerMigration) violations.push({ file, reason: "performance_user_table_limit" });
    for (const target of tables) if (!allowed.has(target)) violations.push({ file, reason: `performance_${category}_manifest_required`, table: target });
  };
  check("index", indexes, LIMITS.indexDdlsPerMigration); check("rls", policies, LIMITS.policyDdlsPerMigration); return violations;
}
export async function verifyPerformanceMigrationScopes({ root = process.cwd(), base = "HEAD", head = "HEAD", includeWorktree = false } = {}) {
  const manifest = JSON.parse(await readFile(resolve(root, "docs/operations/free-tier-performance-migration-scopes.json"), "utf8")); validateManifest(manifest);
  const files = git(root, includeWorktree ? ["diff", "--name-only", base] : ["diff", "--name-only", `${base}..${head}`]).split("\n").filter((file) => MIGRATION.test(file));
  const violations = []; for (const file of files) violations.push(...inspectPerformanceMigrationScope({ file, source: await readFile(resolve(root, file), "utf8"), manifest })); return { ok: violations.length === 0, violations };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) verifyPerformanceMigrationScopes({ base: process.argv[3], head: process.argv[5], includeWorktree: process.argv.includes("--worktree") }).then(({ ok, violations }) => { if (!ok) { for (const value of violations) process.stderr.write(`${value.file}:${value.reason}\n`); process.exitCode = 1; } }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
