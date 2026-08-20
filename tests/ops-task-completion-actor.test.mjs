import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import * as opsTaskModel from "../src/features/tasks/ops-task-model.js";

const root = new URL("../", import.meta.url);
const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

async function readMigration(suffix) {
  const names = await readdir(migrationsUrl);
  const name = names.find((candidate) => candidate.endsWith(`_${suffix}.sql`));
  assert.ok(name, `missing ${suffix} migration`);
  return readFile(new URL(name, migrationsUrl), "utf8");
}

test("완료 처리자는 완료 상태에서만 실제 완료자 또는 미기록으로 표시한다", () => {
  assert.equal(
    typeof opsTaskModel.getOpsTaskCompletionActorLabel,
    "function",
    "완료 처리자 표시 함수를 제공해야 한다",
  );

  assert.equal(
    opsTaskModel.getOpsTaskCompletionActorLabel({
      status: "done",
      completedByLabel: "관리팀 김완료",
    }),
    "관리팀 김완료",
  );
  assert.equal(
    opsTaskModel.getOpsTaskCompletionActorLabel({ status: "done" }),
    "처리자 미기록",
  );
  assert.equal(
    opsTaskModel.getOpsTaskCompletionActorLabel({
      status: "canceled",
      completedByLabel: "이전 완료자",
    }),
    "미정",
  );
});

test("상세 조회와 완료일시 옆 UI가 담당자가 아닌 완료 처리자를 사용한다", async () => {
  const [serviceSource, registrationTrackSource, workspaceSource] = await Promise.all([
    readSource("src/features/tasks/ops-task-service.ts"),
    readSource("src/features/tasks/registration-track-service.ts"),
    readSource("src/features/tasks/ops-task-workspace.tsx"),
  ]);

  assert.match(serviceSource, /completedBy: string/);
  assert.match(serviceSource, /completedByLabel: string/);
  assert.match(serviceSource, /const completedBy = text\(row\.completed_by\)/);
  assert.match(serviceSource, /completedByLabel: text\(row\.completed_by_label\) \|\| profileLabel\(profiles\.get\(completedBy\)\)/);
  assert.match(serviceSource, /completed_by,completed_by_label,completed_at/);
  assert.match(serviceSource, /taskRow\.completed_by/);
  assert.match(serviceSource, /completedBy: text\(payload\.completedById\)/);
  assert.match(serviceSource, /completedByLabel: text\(payload\.completedByLabel\)/);
  assert.match(serviceSource, /rpc\("list_ops_task_page_v2", pageArgs\)/);
  assert.match(serviceSource, /rpc\("list_ops_task_page_v1", pageArgs\)/);

  assert.match(registrationTrackSource, /completedByLabel: text\(value\(row, "completed_by_label", "completedByLabel"\)\)/);

  assert.match(workspaceSource, /getOpsTaskCompletionActorLabel/);
  assert.equal(
    (workspaceSource.match(/<Info label="처리자" value=\{getOpsTaskCompletionActorLabel\(task\)\} \/>/g) || []).length,
    3,
    "등록·퇴원·전반 상세의 완료일시 왼쪽 칸은 모두 처리자를 표시해야 한다",
  );
});

test("DB는 완료 전환의 인증 주체를 기록하고, 재개·취소와 위조 값을 막는다", async () => {
  const [sql, pgTap] = await Promise.all([
    readMigration("ops_task_completion_actor"),
    readSource("supabase/tests/ops_task_completion_actor_test.sql"),
  ]);

  assert.match(sql.trim(), /^begin;[\s\S]*commit;$/i);
  assert.match(
    sql,
    /add column if not exists completed_by uuid references public\.profiles\(id\) on delete restrict/,
  );
  assert.match(sql, /add column if not exists completed_by_label text/);
  assert.match(sql, /create index if not exists ops_tasks_completed_by_idx/);
  assert.match(sql, /create or replace function public\.normalize_ops_task_completion_actor_input\(\)/);
  assert.match(sql, /create trigger v_normalize_ops_task_completion_actor_input/);
  assert.match(sql, /create or replace function public\.set_ops_task_completion_actor\(\)/);
  assert.match(sql, /v_actor uuid := \(select auth\.uid\(\)\);/);
  assert.match(sql, /v_actor_label text;/);
  assert.match(sql, /if new\.status = 'done' then/);
  assert.match(sql, /new\.completed_by := v_actor;/);
  assert.match(sql, /new\.completed_by_label := v_actor_label;/);
  assert.match(sql, /new\.completed_by := old\.completed_by;/);
  assert.match(sql, /new\.completed_by_label := old\.completed_by_label;/);
  assert.match(sql, /else\s+new\.completed_by := null;/);
  assert.match(sql, /create trigger zz_set_ops_task_completion_actor/);
  assert.match(sql, /before insert or update on public\.ops_tasks/);
  assert.match(sql, /for each row execute function public\.set_ops_task_completion_actor\(\)/);
  assert.match(sql, /event\.event_type = task\.type \|\| '\.completed'/);
  assert.match(sql, /event\.actor_id is not null/);
  assert.match(sql, /set_config\('app\.ops_transition_defer_details', 'true', true\)/);
  assert.match(sql, /set_config\('app\.ops_transition_defer_details', '', true\)/);
  assert.match(sql, /set_config\('app\.ops_transition_parent_details_changed', '', true\)/);
  assert.match(sql, /create or replace function public\.list_ops_task_page_v2\(/);
  assert.match(sql, /'completedByLabel', coalesce\(task\.completed_by_label, ''\)/);
  assert.match(sql, /grant execute on function public\.list_ops_task_page_v2\(text,jsonb,jsonb,uuid,integer\)/);
  assert.match(pgTap, /disable trigger write_ops_transition_task_source_v1/);
  assert.match(pgTap, /set_config\('request\.jwt\.claim\.sub', '', true\)/);
  assert.match(pgTap, /transfer\.details_changed/);
  assert.match(pgTap, /foreign_key_violation/);
});

test("격리 DB 기준 매니페스트에 새 마이그레이션 후보와 현재 해시를 등록한다", async () => {
  const [sql, manifestSource] = await Promise.all([
    readMigration("ops_task_completion_actor"),
    readSource("supabase/test-baselines/dashboard-free-tier-v1.manifest.json"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const entry = manifest.orderedNewMigrations.find(
    (candidate) => candidate.fileName === "20260820150057_ops_task_completion_actor.sql",
  );

  assert.deepEqual(entry, {
    fileName: "20260820150057_ops_task_completion_actor.sql",
    status: "candidate",
    sha256: createHash("sha256").update(sql).digest("hex"),
  });
});
