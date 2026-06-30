import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function readAllMigrationSource() {
  const migrationDir = new URL("supabase/migrations/", root);
  const migrationNames = await readdir(migrationDir);
  return (
    await Promise.all(
      migrationNames
        .filter((name) => name.endsWith(".sql"))
        .map((name) => readFile(new URL(name, migrationDir), "utf8")),
    )
  ).join("\n");
}

test("official class and student databases separate read access from staff-only writes", async () => {
  const migrationSource = await readAllMigrationSource();

  for (const table of ["classes", "students"]) {
    assert.match(
      migrationSource,
      new RegExp(`alter table public\\.${table} enable row level security`),
      `${table} must enforce row level security`,
    );
    assert.match(
      migrationSource,
      new RegExp(`create policy ${table}_authenticated_select[\\s\\S]*on public\\.${table}[\\s\\S]*for select[\\s\\S]*to authenticated[\\s\\S]*using \\(true\\)`),
      `${table} must stay readable to authenticated dashboard users`,
    );
    assert.match(
      migrationSource,
      new RegExp(`create policy ${table}_staff_write[\\s\\S]*on public\\.${table}[\\s\\S]*for all[\\s\\S]*to authenticated[\\s\\S]*using \\(public\\.current_dashboard_role\\(\\) in \\('admin', 'staff'\\)\\)[\\s\\S]*with check \\(public\\.current_dashboard_role\\(\\) in \\('admin', 'staff'\\)\\)`),
      `${table} writes must match the admin/staff-only management UI`,
    );
  }

  assert.doesNotMatch(
    migrationSource,
    /create policy (classes|students)_teacher_write[\s\S]*current_dashboard_role\(\) in \('admin', 'staff', 'teacher'\)/,
    "teachers can edit planning surfaces, but not the official class/student database",
  );
});
