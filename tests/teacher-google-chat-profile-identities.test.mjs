import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

test("teacher settings mount a separate Google Chat identity panel after the organization tree", async () => {
  const [workspaceSource, panelSource] = await Promise.all([
    readSource("src/features/management/teacher-master-workspace.tsx"),
    readSource("src/features/management/teacher-google-chat-identity-panel.tsx"),
  ]);

  const organizationTree = workspaceSource.indexOf('data-testid="teacher-organization-tree"');
  const identityPanel = workspaceSource.indexOf("<TeacherGoogleChatIdentityPanel />");
  const auditHistory = workspaceSource.indexOf('data-testid="teacher-audit-mobile-list"');

  assert.ok(organizationTree >= 0, "organization tree must remain mounted");
  assert.ok(identityPanel > organizationTree, "identity panel must follow the organization tree");
  assert.ok(identityPanel < auditHistory, "identity panel must precede recent audit history");
  assert.match(panelSource, /createGoogleChatProfileIdentityService/);
  assert.match(panelSource, /new AbortController\(\)/);
  assert.match(panelSource, /data-testid="teacher-google-chat-identity-mobile-list"/);
  assert.match(panelSource, /data-testid="teacher-google-chat-identity-desktop-list"/);
});

test("Google Chat identity rows are profile-scoped, accessible, and safe to operate", async () => {
  const panelSource = await readSource(
    "src/features/management/teacher-google-chat-identity-panel.tsx",
  );

  for (const label of ["확인됨", "미설정", "재확인 필요", "조회 실패"]) {
    assert.match(panelSource, new RegExp(`"${label}"`));
  }

  assert.match(panelSource, /identity\.accountEmail/);
  assert.match(panelSource, /identity\.chatUserId \?\? "미설정"/);
  assert.match(panelSource, /identity\.lastSyncAt/);
  assert.match(panelSource, /aria-label=\{`\$\{identity\.profileName\} 자동 조회`\}/);
  assert.match(panelSource, /aria-label=\{`\$\{identity\.profileName\} Google Chat ID`\}/);
  assert.match(panelSource, /aria-label=\{`\$\{identity\.profileName\} 확인`\}/);
  assert.match(panelSource, /disabled=\{!snapshot\.editable/);
  assert.match(panelSource, /Google Workspace Directory 설정이 필요합니다\./);
  assert.match(panelSource, /google_chat_profile_identity_revision_conflict/);
  assert.match(
    panelSource,
    /다른 관리자가 먼저 변경했습니다\. 새로고침 후 다시 시도해 주세요\./,
  );
  assert.match(panelSource, /expected_identity_revision: identity\.identityRevision/);
  assert.match(panelSource, /request_id: crypto\.randomUUID\(\)/);
  assert.doesNotMatch(panelSource, /upsertTeacherCatalogs/);
  assert.doesNotMatch(panelSource, /resourceName/);
  assert.doesNotMatch(panelSource, /aliases/);
});
