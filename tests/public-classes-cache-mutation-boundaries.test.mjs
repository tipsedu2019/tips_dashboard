import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("management textbook CRUD refreshes the public cache and preserves pending state for the page", async () => {
  const [service, page] = await Promise.all([
    source("../src/features/management/management-service.js"),
    source("../src/features/management/management-page.tsx"),
  ]);
  for (const method of ["createTextbook", "updateTextbook", "deleteTextbook"]) {
    const start = service.indexOf(`async ${method}`);
    const end = service.indexOf("\n    async ", start + 1);
    assert.ok(start >= 0 && end > start, `${method} exists`);
    assert.match(service.slice(start, end), /refreshPublicClassesCache\("textbook"\)/);
    assert.match(service.slice(start, end), /publicClassesCacheRefresh/);
  }
  assert.match(service, /async function deleteRows[\s\S]*?return \{ deletedIds/);
  assert.match(service, /deleteTextbook[\s\S]*?deleted\.deletedIds\.length/);
  assert.match(page, /publicClassesCacheRefresh.*pending/);
  assert.match(page, /공개 수업 캐시 갱신 대기 중/);
});

test("textbook master mutations return cache pending state and render it without rolling back the save", async () => {
  const [service, workspace] = await Promise.all([
    source("../src/features/textbooks/textbook-service.ts"),
    source("../src/features/textbooks/textbook-operations-workspace.tsx"),
  ]);
  assert.match(service, /upsertTextbookMaster[\s\S]*?publicClassesCacheRefresh/);
  assert.match(service, /deleteTextbookMasters[\s\S]*?publicClassesCacheRefresh/);
  assert.match(service, /purgeInactiveTextbooks[\s\S]*?publicClassesCacheRefresh/);
  assert.match(workspace, /publicClassesCacheRefresh.*pending/);
  assert.match(workspace, /공개 수업 캐시 갱신 대기 중/);
});

test("ops roster receipts carry post-commit cache refresh state without invalidating partial writes", async () => {
  const [service, workspace] = await Promise.all([
    source("../src/features/tasks/ops-task-service.ts"),
    source("../src/features/tasks/ops-task-workspace.tsx"),
  ]);
  assert.match(service, /publicClassesCacheRefresh\?:/);
  assert.doesNotMatch(service.slice(service.indexOf("async function applyReadyOpsRosterMode"), service.indexOf("async function completeReadyOpsRosterTransition")), /invalidatePublicClassesCacheAfterMutation/);
  assert.match(service, /completeReadyOpsRosterTransition[\s\S]*?invalidatePublicClassesCacheAfterMutation/);
  assert.match(service, /refreshPublicClassesAfterCommittedOpsChange/);
  assert.match(service, /deleteOpsTask[\s\S]*?publicClassesCacheRefresh/);
  assert.match(service, /complete_ops_withdrawal_roster_transition_v2/);
  assert.match(service, /complete_ops_transfer_roster_transition_v2/);
  assert.match(workspace, /publicClassesCacheRefresh.*pending/);
  assert.match(workspace, /공개 수업 캐시 갱신 대기 중/);
});

test("canonical registration enrollment mutations return and render nonfatal public cache refresh receipts", async () => {
  const [service, editor, workspace] = await Promise.all([
    source("../src/features/tasks/registration-track-service.ts"),
    source("../src/features/tasks/registration-enrollment-editor.tsx"),
    source("../src/features/tasks/ops-task-workspace.tsx"),
  ]);
  assert.match(service, /completeRegistrationAdmissionBatch[\s\S]*?invalidatePublicClassesCacheAfterMutation/);
  assert.match(service, /cancelRegistrationEnrollment[\s\S]*?invalidatePublicClassesCacheAfterMutation/);
  assert.match(service, /publicClassesCacheRefresh\?:/);
  assert.match(editor, /receipt\.publicClassesCacheRefresh\?\.status === "pending"/);
  assert.match(editor, /공개 수업 캐시 갱신 대기 중/);
  assert.match(workspace, /등록 단계를 변경했습니다\. 공개 수업 캐시 갱신 대기 중/);
});
