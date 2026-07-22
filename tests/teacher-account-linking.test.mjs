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
  assert.match(workspaceSource, /function getAccountIdentifier/);
  assert.match(workspaceSource, /function getAccountPrimaryLabel/);
  assert.match(workspaceSource, /function getAccountConnectionStatus/);
  assert.match(workspaceSource, /선생님 이름 일치/);
  assert.doesNotMatch(workspaceSource, />\s*연결됨\s*</);
  assert.match(serviceSource, /listTeacherAccountSettingsData/);
  assert.match(serviceSource, /syncLinkedTeacherProfiles/);
  assert.match(serviceSource, /teacher_catalogs/);
  assert.match(serviceSource, /profiles/);
});

test("teacher settings labels admin as operator and staff as administrator", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/management/teacher-master-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /{ value: "admin", label: "운영자" }/);
  assert.match(workspaceSource, /{ value: "staff", label: "관리자" }/);
  assert.doesNotMatch(workspaceSource, /{ value: "admin", label: "관리자" }/);
  assert.doesNotMatch(workspaceSource, /{ value: "staff", label: "운영" }/);
  assert.match(workspaceSource, /운영자: "관리팀"/);
  assert.match(workspaceSource, /관리자: "관리팀"/);
});

test("teacher settings uses fixed team groups instead of subject labels", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/management/teacher-master-workspace.tsx", root),
    "utf8",
  );

  assert.match(
    workspaceSource,
    /TEAM_OPTIONS = \["영어팀", "수학팀", "과학팀", "관리팀", "조교팀"\]/,
  );
  assert.match(
    workspaceSource,
    /TEAM_FILTERS = \["전체", \.\.\.TEAM_OPTIONS\]/,
  );
  assert.match(workspaceSource, /normalizeTeamValue/);
  assert.match(workspaceSource, /science: "과학팀"/);
  assert.match(workspaceSource, /과학: "과학팀"/);
  assert.match(workspaceSource, /과학팀: "과학팀"/);
  assert.match(workspaceSource, /resolveRoleForTeam/);
  assert.match(workspaceSource, /handleTeamChange/);
  assert.match(workspaceSource, /value === "조교팀" \? "assistant"/);
  assert.match(workspaceSource, /data-testid="teacher-organization-tree"/);
  assert.match(workspaceSource, /data-testid=\{`teacher-team-group-\$\{team\}`\}/);
  assert.match(workspaceSource, /placeholder="팀"/);
  assert.doesNotMatch(workspaceSource, /SUBJECT_OPTIONS/);
  assert.doesNotMatch(workspaceSource, /label: "과목"/);
});

test("science organization migration recreates the complete signup handler", async () => {
  const migrationSource = await readFile(
    new URL(
      "supabase/migrations/20260722093000_science_team_and_classroom.sql",
      root,
    ),
    "utf8",
  );

  assert.match(
    migrationSource,
    /create or replace function public\.handle_new_dashboard_user\(\)[\s\S]*returns trigger[\s\S]*security definer[\s\S]*set search_path = ''/i,
  );
  assert.match(migrationSource, /normalized_email text;/);
  assert.match(migrationSource, /when '과학팀' then '과학팀'/);
  assert.match(migrationSource, /when unique_violation then/);
  assert.match(migrationSource, /teacher_catalog_id = linked_teacher_id/);
  assert.match(migrationSource, /return new;/);
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
  assert.match(workspaceSource, /onAccountChange=\{handleAccountChange\}/);
  assert.match(workspaceSource, /aria-label="선생님 모바일 편집 목록"/);
  assert.match(workspaceSource, /data-testid="teacher-organization-tree"/);
  assert.match(workspaceSource, /data-testid="teacher-audit-mobile-list"/);
  assert.match(workspaceSource, /data-testid=\{`teacher-audit-mobile-card-\$\{log\.id\}`\}/);
  assert.match(workspaceSource, /formatAuditTime\(log\.changedAt\)/);
});

test("teacher settings renders a team organization tree with account identity state", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/management/teacher-master-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /data-testid="teacher-organization-tree"/);
  assert.match(workspaceSource, /data-testid=\{`teacher-team-group-\$\{team\}`\}/);
  assert.match(workspaceSource, /handleAddToTeam/);
  assert.match(workspaceSource, /getRowsForTeam/);
  assert.match(workspaceSource, /handleMoveRowWithinTeam/);
  assert.match(workspaceSource, /이미 연결: \$\{linkedTeacherName\}/);
  assert.match(workspaceSource, /가입명 확인/);
  assert.match(workspaceSource, /getAccountPrimaryLabel\(profile\)/);
  assert.match(workspaceSource, /getAccountSecondaryLabel\(profile\)/);
});

test("teacher organization tree keeps the list clean after automatic account linking", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/management/teacher-master-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /const selectedAccountLabel = selectedProfile/);
  assert.match(workspaceSource, /getAccountIdentifier\(selectedProfile\)/);
  assert.match(workspaceSource, /{selectedAccountLabel}/);
  assert.match(workspaceSource, /data-testid="teacher-organization-tree"/);
  assert.match(workspaceSource, /divide-y divide-border\/60/);
  assert.match(workspaceSource, /items-center gap-2 px-2 py-2/);
  assert.doesNotMatch(workspaceSource, /const selectedStatus = selectedProfile/);
  assert.doesNotMatch(workspaceSource, /{getAccountSecondaryLabel\(selectedProfile\)} · {selectedStatus}/);
  assert.doesNotMatch(workspaceSource, /가입명 \{selectedProfile\.name \|\| "-"\}/);
  assert.doesNotMatch(workspaceSource, /before:absolute before:bottom-8/);
  assert.doesNotMatch(workspaceSource, /after:absolute after:left-\[-1\.9rem\]/);
  assert.doesNotMatch(workspaceSource, /rounded-md border bg-background px-3 py-2 shadow-xs/);
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
  assert.match(migrationSource, /selected_teacher_team/);
  assert.match(migrationSource, /raw_user_meta_data ->> 'teacher_team'/);
  assert.match(migrationSource, /insert into public\.teacher_catalogs/);
  assert.match(migrationSource, /profile_id,\s*account_email,\s*dashboard_role/);
  assert.match(migrationSource, /array\[selected_teacher_team\]/);
  assert.match(migrationSource, /dashboard_role[\s\S]*'viewer'/);
  assert.match(migrationSource, /teacher_catalog_id = linked_teacher_id/);
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
  assert.match(migrationSource, /role in \('admin', 'staff', 'teacher', 'assistant', 'viewer'\)/);
  assert.match(migrationSource, /dashboard_role in \('admin', 'staff', 'teacher', 'assistant', 'viewer'\)/);

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

test("assistant team maps to a restricted dashboard role", async () => {
  const [workspaceSource, serviceSource, authUtilsSource, providerSource, migrationSource] =
    await Promise.all([
      readFile(new URL("src/features/management/teacher-master-workspace.tsx", root), "utf8"),
      readFile(new URL("src/features/management/management-service.js", root), "utf8"),
      readFile(new URL("src/lib/auth-utils.ts", root), "utf8"),
      readFile(new URL("src/providers/auth-provider.tsx", root), "utf8"),
      readAllMigrationSource(),
    ]);

  assert.match(workspaceSource, /{ value: "assistant", label: "조교" }/);
  assert.match(workspaceSource, /조교팀/);
  assert.match(serviceSource, /DASHBOARD_ROLES = \["admin", "staff", "teacher", "assistant", "viewer"\]/);
  assert.match(authUtilsSource, /export type DashboardRole = "admin" \| "staff" \| "teacher" \| "assistant" \| "viewer"/);
  assert.match(authUtilsSource, /if \(normalized === "assistant"\) return "assistant"/);
  assert.match(authUtilsSource, /const canUseAssistantOperations = normalizedRole === "assistant"/);
  assert.match(providerSource, /isAssistant: boolean/);
  assert.match(providerSource, /const isAssistant = role === "assistant"/);
  assert.match(migrationSource, /update public\.teacher_catalogs[\s\S]*dashboard_role = 'assistant'[\s\S]*'조교팀' = any\(subjects\)/);
  assert.match(migrationSource, /academic_events_staff_write[\s\S]*'assistant'/);
});
