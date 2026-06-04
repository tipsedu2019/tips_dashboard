import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

async function readSource(path) {
  return fs.readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertIncludesAll(source, fragments) {
  for (const fragment of fragments) {
    assert.ok(source.includes(fragment), fragment);
  }
}

test("ops task automation cron route is protected and runs the server automation cycle", async () => {
  const [routeSource, vercelSource, envExampleSource] = await Promise.all([
    readSource("src/app/api/ops-task-automations/run/route.ts"),
    readSource("vercel.json"),
    readSource(".env.example"),
  ]);
  const vercelJson = JSON.parse(vercelSource);

  assertIncludesAll(routeSource, [
    "createOpsAutomationSupabaseClient",
    "createSupabaseOpsTaskAutomationStore",
    "runOpsTaskAutomationCycle",
    "request.headers.get(\"authorization\")",
    "`Bearer ${process.env.CRON_SECRET}`",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NextResponse.json",
  ]);
  assert.deepEqual(vercelJson.crons, [
    {
      path: "/api/ops-task-automations/run",
      schedule: "0 0 * * *",
    },
  ]);
  assertIncludesAll(envExampleSource, [
    "SUPABASE_SERVICE_ROLE_KEY=",
    "CRON_SECRET=",
    "GOOGLE_CHAT_WEBHOOK_TEACHERS=",
    "GOOGLE_CHAT_WEBHOOK_ASSISTANTS=",
  ]);
});

test("Google Chat channel test route verifies a Supabase user before sending", async () => {
  const routeSource = await readSource("src/app/api/ops-task-notification-channels/test/route.ts");

  assertIncludesAll(routeSource, [
    "createOpsAutomationSupabaseClient",
    "createSupabaseOpsTaskAutomationStore",
    "sendGoogleChatChannelTest",
    "request.headers.get(\"authorization\")",
    "auth.getUser(accessToken)",
    ".from(\"profiles\")",
    ".or(`email.eq.${normalizedEmail},login_id.eq.${normalizedLoginId}`)",
    "admin",
    "staff",
    "channelId",
    "NextResponse.json",
  ]);
});

test("ops task trigger route verifies a Supabase user before running one automation event", async () => {
  const routeSource = await readSource("src/app/api/ops-task-automations/trigger/route.ts");

  assertIncludesAll(routeSource, [
    "createOpsAutomationSupabaseClient",
    "createSupabaseOpsTaskAutomationStore",
    "runTriggerAutomation",
    "request.headers.get(\"authorization\")",
    "auth.getUser(accessToken)",
    ".from(\"profiles\")",
    ".or(`email.eq.${normalizedEmail},login_id.eq.${normalizedLoginId}`)",
    "admin",
    "staff",
    "trigger",
    "sourceType",
    "NextResponse.json",
  ]);
});

test("ops task automation presets seed practical follow-up rules for operations", async () => {
  const presetSource = await readSource("supabase/migrations/20260528144000_ops_task_automation_rule_presets.sql");

  assertIncludesAll(presetSource, [
    "insert into public.ops_task_automation_rules",
    "registration.completed",
    "{studentName} 첫 인사 및 안내 전화",
    "task.registration.classStartDate",
    "transfer.completed",
    "{studentName} 전반 인수인계 확인",
    "task.transfer.toClassStartDate",
    "withdrawal.completed",
    "{studentName} 퇴원 정산 및 자료 정리 확인",
    "task.withdrawal.withdrawalDate",
    "word_retest.completed",
    "{studentName} 재시험 결과 확인 및 안내",
    "task.wordRetest.testAt",
    "curriculum.plan_saved",
    "{className} 다음 수업 자료 준비",
    "event.classItem.nextSessionDate",
    "duplicatePolicy",
    "update_due",
    "skipStateBoardMirroring",
    "google_chat_webhook",
  ]);
});
