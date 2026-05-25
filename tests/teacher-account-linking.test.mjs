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

test("teacher settings links teachers to login accounts and editable roles", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/management/teacher-master-workspace.tsx", root),
    "utf8",
  );
  const serviceSource = await readFile(
    new URL("src/features/management/management-service.js", root),
    "utf8",
  );

  assert.match(workspaceSource, /type AccountProfile/);
  assert.match(workspaceSource, /profileId/);
  assert.match(workspaceSource, /accountEmail/);
  assert.match(workspaceSource, /dashboardRole/);
  assert.match(workspaceSource, /aria-label=\{`\$\{row\.name \|\| "새 선생님"\} 이름`\}/);
  assert.match(workspaceSource, /placeholder="이메일 또는 아이디"/);
  assert.match(workspaceSource, /aria-label="로그인 계정 이메일 또는 아이디"/);
  assert.match(workspaceSource, /RefreshCw/);
  assert.match(workspaceSource, /계정 새로고침/);
  assert.match(workspaceSource, /visibilitychange/);
  assert.match(
    workspaceSource,
    /window\.addEventListener\("focus", reloadOnFocus\)/,
  );
  assert.match(workspaceSource, /계정/);
  assert.match(workspaceSource, /권한/);
  assert.match(workspaceSource, /최근 변경 이력/);
  assert.match(workspaceSource, /연결된 계정/);
  assert.match(workspaceSource, /function formatAccountIdentifier/);
  assert.match(workspaceSource, /아이디 \$\{trimmed\}/);
  assert.match(workspaceSource, /계정 \$\{profile\.id\.slice\(0, 8\)\}/);
  assert.match(workspaceSource, /연결됨/);
  assert.match(serviceSource, /listTeacherAccountSettingsData/);
  assert.match(serviceSource, /syncLinkedTeacherProfiles/);
  assert.match(serviceSource, /teacher_catalogs/);
  assert.match(serviceSource, /profiles/);
});

test("teacher settings uses fixed team groups instead of subject labels", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/management/teacher-master-workspace.tsx", root),
    "utf8",
  );

  assert.match(
    workspaceSource,
    /TEAM_OPTIONS = \["영어팀", "수학팀", "관리팀"\]/,
  );
  assert.match(
    workspaceSource,
    /TEAM_FILTERS = \["전체", \.\.\.TEAM_OPTIONS\]/,
  );
  assert.match(workspaceSource, /normalizeTeamValue/);
  assert.match(workspaceSource, /handleTeamChange/);
  assert.match(workspaceSource, /label: "팀"/);
  assert.match(workspaceSource, />\s*팀\s*<\/TableHead>/);
  assert.match(workspaceSource, /placeholder="팀"/);
  assert.doesNotMatch(workspaceSource, /SUBJECT_OPTIONS/);
  assert.doesNotMatch(workspaceSource, /label: "과목"/);
});

test("teacher settings uses mobile edit cards instead of a clipped wide table", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/management/teacher-master-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /data-testid="teacher-settings-mobile-list"/);
  assert.match(workspaceSource, /className="grid gap-2 md:hidden"/);
  assert.match(workspaceSource, /data-testid=\{`teacher-settings-mobile-card-\$\{row\.id\}`\}/);
  assert.match(workspaceSource, /normalizeTeamValue\(row\.subjects\)/);
  assert.match(workspaceSource, /handleAccountChange\(row\.id, value\)/);
  assert.match(workspaceSource, /aria-label="선생님 모바일 편집 목록"/);
  assert.match(workspaceSource, /<div className="hidden md:block">[\s\S]*<SettingsTableFrame>/);
  assert.match(workspaceSource, /data-testid="teacher-audit-mobile-list"/);
  assert.match(workspaceSource, /data-testid=\{`teacher-audit-mobile-card-\$\{log\.id\}`\}/);
  assert.match(workspaceSource, /formatAuditTime\(log\.changedAt\)/);
});

test("teacher account migration stores profile links, permissions, and audit history", async () => {
  const migrationSource = await readAllMigrationSource();

  assert.match(
    migrationSource,
    /alter table public\.teacher_catalogs[\s\S]*profile_id uuid/,
  );
  assert.match(migrationSource, /account_email text/);
  assert.match(migrationSource, /dashboard_role text/);
  assert.match(migrationSource, /teacher_catalog_id uuid/);
  assert.match(migrationSource, /profiles_teacher_catalog_id_fkey/);
  assert.match(
    migrationSource,
    /references public\.teacher_catalogs\(id\) on delete set null/,
  );
  assert.match(
    migrationSource,
    /create table if not exists public\.dashboard_audit_logs/,
  );
  assert.match(
    migrationSource,
    /create or replace function public\.handle_new_dashboard_user/,
  );
  assert.match(migrationSource, /after insert on auth\.users/);
  assert.match(migrationSource, /matched_profile_id/);
  assert.match(migrationSource, /when unique_violation then/);
  assert.match(migrationSource, /profiles_self_identity_select/);
  assert.match(migrationSource, /'viewer' as role/);
  assert.match(migrationSource, /profiles_self_insert/);
  assert.match(migrationSource, /actor_profile_id uuid/);
  assert.match(migrationSource, /actor_email text/);
  assert.match(migrationSource, /entity_table text not null/);
  assert.match(
    migrationSource,
    /create or replace function public\.log_dashboard_audit_event/,
  );

  for (const table of [
    "teacher_catalogs",
    "profiles",
    "students",
    "classes",
    "textbooks",
  ]) {
    assert.match(
      migrationSource,
      new RegExp(`create trigger dashboard_audit_${table}`),
      `${table} must keep insert/update/delete actor history`,
    );
  }
});
