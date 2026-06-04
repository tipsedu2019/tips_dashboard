import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveGoogleChatWebhookUrl,
  runDueRecurringAutomations,
  runTriggerAutomation,
  sendGoogleChatChannelTest,
  sendPendingGoogleChatNotifications,
} from "../src/server/ops-task-automation-runner.js";

class MemoryAutomationStore {
  constructor({ rules = [], tasks = [], channels = [], deliveries = [] } = {}) {
    this.rules = rules;
    this.tasks = tasks;
    this.channels = channels;
    this.deliveries = deliveries;
    this.runs = [];
    this.createdTasks = [];
    this.updatedTasks = [];
    this.updatedDeliveries = [];
  }

  async listAutomationRules({ kind } = {}) {
    return this.rules.filter((rule) => (
      rule.enabled !== false &&
      (!kind || rule.kind === kind)
    ));
  }

  async listExistingAutomationTasks(sourceKeys = []) {
    const sourceKeySet = new Set(sourceKeys);
    return [...this.tasks, ...this.createdTasks].filter((task) => (
      sourceKeySet.has(task.automationSourceKey || task.automation_source_key)
    ));
  }

  async listRecurringAutomationTasksByRule(ruleIds = []) {
    const ruleIdSet = new Set(ruleIds);
    return [...this.tasks, ...this.createdTasks].filter((task) => (
      ruleIdSet.has(task.automationRuleId || task.automation_rule_id) &&
      (!task.automationSourceType || task.automationSourceType === "recurring")
    ));
  }

  async createTask(task) {
    const createdTask = {
      id: `task-${this.createdTasks.length + 1}`,
      ...task,
    };
    this.createdTasks.push(createdTask);
    return createdTask;
  }

  async updateTask(taskId, patch) {
    const task = [...this.tasks, ...this.createdTasks].find((item) => item.id === taskId);
    if (task) Object.assign(task, patch);
    this.updatedTasks.push({ taskId, patch });
    return task ? { ...task } : { id: taskId, ...patch };
  }

  async recordAutomationRun(run) {
    this.runs.push(run);
  }

  async enqueueNotificationDelivery(delivery) {
    this.deliveries.push({
      id: `delivery-${this.deliveries.length + 1}`,
      status: "pending",
      attemptCount: 0,
      ...delivery,
    });
  }

  async listPendingNotificationDeliveries() {
    return this.deliveries.filter((delivery) => (
      delivery.status === "pending" ||
      (delivery.status === "failed" && delivery.nextRetryAt <= "2026-05-28T09:00:00.000Z")
    ));
  }

  async getNotificationChannel(channelId) {
    return this.channels.find((channel) => channel.id === channelId) || null;
  }

  async updateNotificationDelivery(deliveryId, patch) {
    const delivery = this.deliveries.find((item) => item.id === deliveryId);
    if (delivery) Object.assign(delivery, patch);
    this.updatedDeliveries.push({ deliveryId, patch });
  }

  async recordNotificationDelivery(delivery) {
    const recorded = {
      id: `delivery-${this.deliveries.length + 1}`,
      ...delivery,
    };
    this.deliveries.push(recorded);
    return recorded;
  }
}

test("due recurring automations create a sourced task, run log, and Google Chat delivery", async () => {
  const store = new MemoryAutomationStore({
    channels: [{ id: "channel-teachers", teamKey: "teachers", isActive: true }],
    rules: [{
      id: "rule-daily",
      name: "매일 재시험 점검",
      kind: "recurring",
      enabled: true,
      recurrence: {
        frequency: "daily",
        startDate: "2026-05-28",
        dueTime: "11:00",
      },
      action: {
        title: "오늘 단어 재시험 미응시 확인",
        priority: "high",
        memo: "미응시 학생을 확인한다.",
        checklist: ["미응시 명단 확인", "담당 선생님 공유"],
        relatedRoute: "/admin/word-retests",
      },
      assignee: {
        strategy: "fixed",
        profileId: "assistant-1",
      },
      notificationChannelId: "channel-teachers",
      notification: { enabled: true },
    }],
  });

  const result = await runDueRecurringAutomations({
    store,
    now: "2026-05-28",
  });

  assert.deepEqual(result, { created: 1, skipped: 0, failed: 0 });
  assert.equal(store.createdTasks[0].title, "오늘 단어 재시험 미응시 확인");
  assert.deepEqual(store.createdTasks[0].checklistItems, [
    { id: "automation-1", label: "미응시 명단 확인", checked: false },
    { id: "automation-2", label: "담당 선생님 공유", checked: false },
  ]);
  assert.doesNotMatch(store.createdTasks[0].memo, /체크리스트/);
  assert.match(store.createdTasks[0].memo, /관련 메뉴: \/admin\/word-retests/);
  assert.equal(store.createdTasks[0].assigneeId, "assistant-1");
  assert.equal(store.createdTasks[0].dueAt, "2026-05-28T11:00:00+09:00");
  assert.equal(store.createdTasks[0].automationSourceType, "recurring");
  assert.equal(store.createdTasks[0].automationSourceKey, "rule-daily:2026-05-28");
  assert.equal(store.runs[0].status, "created");
  assert.equal(store.runs[0].sourceKey, "rule-daily:2026-05-28");
  assert.equal(store.deliveries[0].channelId, "channel-teachers");
  assert.match(store.deliveries[0].payload.text, /오늘 단어 재시험/);
});

test("after-completion recurring automation waits for the open previous task", async () => {
  const store = new MemoryAutomationStore({
    tasks: [{
      id: "task-open",
      status: "requested",
      automationRuleId: "rule-after-completion",
      automationSourceType: "recurring",
      automationSourceId: "2026-05-28",
      automationSourceKey: "rule-after-completion:2026-05-28",
      automationGeneratedAt: "2026-05-28T00:00:00.000Z",
    }],
    rules: [{
      id: "rule-after-completion",
      name: "완료 후 점검",
      kind: "recurring",
      enabled: true,
      recurrence: {
        frequency: "daily",
        generationMode: "after_completion",
        startDate: "2026-05-28",
        dueTime: "11:00",
      },
      action: {
        title: "완료 후 다음 점검",
      },
    }],
  });

  const result = await runDueRecurringAutomations({
    store,
    now: "2026-05-29",
  });

  assert.deepEqual(result, { created: 0, skipped: 1, failed: 0 });
  assert.equal(store.createdTasks.length, 0);
  assert.equal(store.runs[0].status, "skipped");
  assert.equal(store.runs[0].payload.reason, "waiting_for_previous_completion");
});

test("after-completion recurring automation creates the next occurrence after completion", async () => {
  const store = new MemoryAutomationStore({
    tasks: [{
      id: "task-done",
      status: "done",
      completedAt: "2026-05-28T13:00:00.000Z",
      automationRuleId: "rule-after-completion",
      automationSourceType: "recurring",
      automationSourceId: "2026-05-28",
      automationSourceKey: "rule-after-completion:2026-05-28",
      automationGeneratedAt: "2026-05-28T00:00:00.000Z",
    }],
    rules: [{
      id: "rule-after-completion",
      name: "완료 후 점검",
      kind: "recurring",
      enabled: true,
      recurrence: {
        frequency: "daily",
        generationMode: "after_completion",
        startDate: "2026-05-28",
        dueTime: "11:00",
      },
      action: {
        title: "완료 후 다음 점검",
      },
    }],
  });

  const result = await runDueRecurringAutomations({
    store,
    now: "2026-05-29",
  });

  assert.deepEqual(result, { created: 1, skipped: 0, failed: 0 });
  assert.equal(store.createdTasks[0].automationSourceKey, "rule-after-completion:2026-05-29");
  assert.equal(store.createdTasks[0].dueAt, "2026-05-29T11:00:00+09:00");
  assert.equal(store.runs[0].status, "created");
});

test("trigger automation creates only follow-up work and records duplicate skips", async () => {
  const store = new MemoryAutomationStore({
    tasks: [{
      id: "existing-follow-up",
      automationSourceKey: "rule-first-greeting:registration:registration-task-1:registration.completed",
    }],
    rules: [{
      id: "rule-first-greeting",
      name: "첫 인사",
      kind: "trigger",
      target: "registration",
      triggerKey: "registration.completed",
      enabled: true,
      conditions: { required: ["task.registration.classStartDate"] },
      action: {
        title: "{studentName} 첫 인사 및 안내 전화",
        priority: "high",
      },
      assignee: { strategy: "teacher" },
      due: {
        basis: "task.registration.classStartDate",
        offsetDays: 5,
        dueTime: "18:00",
      },
    }],
  });

  const duplicateResult = await runTriggerAutomation({
    store,
    event: {
      trigger: "registration.completed",
      sourceType: "registration",
      sourceId: "registration-task-1",
      task: {
        id: "registration-task-1",
        type: "registration",
        studentName: "김민준",
        registration: { classStartDate: "2026-06-01" },
      },
      teacher: { profileId: "teacher-profile-1" },
    },
  });

  assert.deepEqual(duplicateResult, { created: 0, updated: 0, skipped: 1, failed: 0 });
  assert.equal(store.createdTasks.length, 0);
  assert.equal(store.runs[0].status, "skipped");

  const createdResult = await runTriggerAutomation({
    store,
    event: {
      trigger: "registration.completed",
      sourceType: "registration",
      sourceId: "registration-task-2",
      task: {
        id: "registration-task-2",
        type: "registration",
        studentName: "이서연",
        registration: { classStartDate: "2026-06-03" },
      },
      teacher: { profileId: "teacher-profile-2" },
    },
  });

  assert.deepEqual(createdResult, { created: 1, updated: 0, skipped: 0, failed: 0 });
  assert.equal(store.createdTasks[0].title, "이서연 첫 인사 및 안내 전화");
  assert.equal(store.createdTasks[0].assigneeId, "teacher-profile-2");
  assert.equal(store.createdTasks[0].dueAt, "2026-06-08T18:00:00+09:00");
});

test("trigger automation can update the due date of an existing follow-up", async () => {
  const store = new MemoryAutomationStore({
    tasks: [{
      id: "existing-follow-up",
      title: "김민준 첫 인사 및 안내 전화",
      dueAt: "2026-06-06T18:00:00+09:00",
      automationSourceKey: "rule-first-greeting:registration:registration-task-1:registration.completed",
    }],
    rules: [{
      id: "rule-first-greeting",
      name: "첫 인사",
      kind: "trigger",
      target: "registration",
      triggerKey: "registration.completed",
      enabled: true,
      conditions: {
        required: ["task.registration.classStartDate"],
        duplicatePolicy: "update_due",
      },
      action: {
        title: "{studentName} 첫 인사 및 안내 전화",
      },
      due: {
        basis: "task.registration.classStartDate",
        offsetDays: 5,
        dueTime: "18:00",
      },
    }],
  });

  const result = await runTriggerAutomation({
    store,
    event: {
      trigger: "registration.completed",
      sourceType: "registration",
      sourceId: "registration-task-1",
      task: {
        id: "registration-task-1",
        type: "registration",
        studentName: "김민준",
        registration: { classStartDate: "2026-06-03" },
      },
    },
  });

  assert.deepEqual(result, { created: 0, updated: 1, skipped: 0, failed: 0 });
  assert.equal(store.createdTasks.length, 0);
  assert.deepEqual(store.updatedTasks[0], {
    taskId: "existing-follow-up",
    patch: { dueAt: "2026-06-08T18:00:00+09:00" },
  });
  assert.equal(store.runs[0].status, "updated");
  assert.equal(store.runs[0].payload.reason, "duplicate_update_due");
});

test("Google Chat delivery sender masks webhook storage and records retry state", async () => {
  assert.equal(
    resolveGoogleChatWebhookUrl(
      { webhookSecretRef: "google_chat_webhook:teacher-team", teamKey: "teacher-team" },
      { GOOGLE_CHAT_WEBHOOK_TEACHER_TEAM: "https://chat.googleapis.com/v1/spaces/test/messages?key=abc" },
    ),
    "https://chat.googleapis.com/v1/spaces/test/messages?key=abc",
  );

  const store = new MemoryAutomationStore({
    channels: [{
      id: "channel-teachers",
      teamKey: "teachers",
      webhookSecretRef: "env:TEACHER_WEBHOOK",
      isActive: true,
    }],
    deliveries: [{
      id: "delivery-1",
      channelId: "channel-teachers",
      payload: { text: "새 할 일", thread: { threadKey: "task-1" } },
      status: "pending",
      attemptCount: 0,
    }],
  });

  const sentPayloads = [];
  const successResult = await sendPendingGoogleChatNotifications({
    store,
    env: { TEACHER_WEBHOOK: "https://chat.googleapis.com/v1/spaces/test/messages?key=abc" },
    sendGoogleChat: async (webhookUrl, payload) => {
      sentPayloads.push({ webhookUrl, payload });
      return { status: 200 };
    },
    now: "2026-05-28T09:00:00.000Z",
  });

  assert.deepEqual(successResult, { sent: 1, skipped: 0, failed: 0 });
  assert.equal(sentPayloads[0].payload.text, "새 할 일");
  assert.equal(
    new URL(sentPayloads[0].webhookUrl).searchParams.get("messageReplyOption"),
    "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD",
  );
  assert.equal(store.deliveries[0].status, "sent");
  assert.equal(store.deliveries[0].attemptCount, 1);

  store.deliveries.push({
    id: "delivery-2",
    channelId: "channel-teachers",
    payload: { text: "실패할 알림" },
    status: "pending",
    attemptCount: 1,
  });

  const failureResult = await sendPendingGoogleChatNotifications({
    store,
    env: { TEACHER_WEBHOOK: "https://chat.googleapis.com/v1/spaces/test/messages?key=abc" },
    sendGoogleChat: async () => {
      throw new Error("network down");
    },
    now: "2026-05-28T09:00:00.000Z",
  });

  assert.deepEqual(failureResult, { sent: 0, skipped: 0, failed: 1 });
  assert.equal(store.deliveries[1].status, "failed");
  assert.equal(store.deliveries[1].attemptCount, 2);
  assert.match(store.deliveries[1].errorMessage, /network down/);
  assert.ok(store.deliveries[1].nextRetryAt > "2026-05-28T09:00:00.000Z");
});

test("Google Chat channel test-send resolves a masked webhook and records the result", async () => {
  const store = new MemoryAutomationStore({
    channels: [{
      id: "channel-teachers",
      name: "선생님팀",
      teamKey: "teachers",
      webhookSecretRef: "google_chat_webhook:teachers",
      isActive: true,
    }],
  });
  const sentPayloads = [];

  const result = await sendGoogleChatChannelTest({
    store,
    channelId: "channel-teachers",
    actorLabel: "임현준",
    env: { GOOGLE_CHAT_WEBHOOK_TEACHERS: "https://chat.googleapis.com/v1/spaces/test/messages?key=abc" },
    sendGoogleChat: async (webhookUrl, payload) => {
      sentPayloads.push({ webhookUrl, payload });
      return { status: 200 };
    },
    now: "2026-05-28T09:00:00.000Z",
  });

  assert.deepEqual(result, { ok: true, status: "sent", channelName: "선생님팀" });
  assert.equal(sentPayloads[0].payload.text.includes("Google Chat 테스트"), true);
  assert.equal(sentPayloads[0].payload.thread.threadKey, "ops-task-channel-test-channel-teachers");
  assert.equal(store.deliveries[0].status, "sent");
  assert.equal(store.deliveries[0].attemptCount, 1);
  assert.equal(store.deliveries[0].channelId, "channel-teachers");
});
