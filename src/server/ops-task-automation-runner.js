import { createClient } from "@supabase/supabase-js";

import {
  buildGoogleChatTaskNotificationPayload,
  buildOpsRecurringTaskOccurrence,
  buildOpsTriggeredTaskDraft,
} from "../features/tasks/ops-task-model.js";

function text(value) {
  return String(value || "").trim();
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toDateKey(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const date = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function normalizeFrequency(value) {
  const frequency = text(value);
  if (frequency === "monthly") return "monthly_date";
  if (frequency === "last_weekday") return "monthly_last_weekday";
  return frequency;
}

function normalizeRule(row = {}) {
  return {
    id: text(row.id),
    name: text(row.name),
    kind: text(row.kind),
    target: text(row.target),
    triggerKey: text(row.triggerKey || row.trigger_key),
    trigger: text(row.trigger || row.triggerKey || row.trigger_key),
    enabled: row.enabled !== false,
    recurrence: objectValue(row.recurrence),
    conditions: objectValue(row.conditions),
    action: objectValue(row.action),
    assignee: objectValue(row.assignee),
    due: objectValue(row.due),
    notification: objectValue(row.notification),
    notificationChannelId: text(row.notificationChannelId || row.notification_channel_id),
  };
}

function recurringRuleToTemplate(rule) {
  const recurrence = objectValue(rule.recurrence);
  const action = objectValue(rule.action);
  const due = objectValue(rule.due);

  return {
    id: rule.id,
    enabled: rule.enabled,
    title: text(action.title || rule.name),
    frequency: normalizeFrequency(recurrence.frequency),
    interval: recurrence.interval,
    weekdays: recurrence.weekdays,
    monthDay: recurrence.monthDay,
    weekday: recurrence.weekday,
    startDate: recurrence.startDate,
    endDate: recurrence.endDate,
    createLeadDays: recurrence.createLeadDays,
    generationMode: text(recurrence.generationMode || recurrence.generation_mode || recurrence.createMode || recurrence.create_mode),
    dueTime: recurrence.dueTime || due.dueTime,
    timezoneOffset: recurrence.timezoneOffset || due.timezoneOffset,
  };
}

function resolveFixedAssigneeId(assignee = {}) {
  if (text(assignee.strategy) !== "fixed") return "";
  return text(assignee.profileId || assignee.profile_id || assignee.fixedProfileId || assignee.fixed_profile_id);
}

function normalizeChecklist(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/\n|,/).map(text).filter(Boolean);
}

function normalizeTaskChecklistItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (typeof item === "string") {
        const label = text(item);
        return label ? { id: `automation-${index + 1}`, label, checked: false } : null;
      }
      if (!item || typeof item !== "object") return null;
      const label = text(item.label || item.title || item.text || item.name);
      if (!label) return null;
      return {
        id: text(item.id) || `automation-${index + 1}`,
        label,
        checked: item.checked === true || item.done === true || item.completed === true,
      };
    })
    .filter(Boolean);
}

function buildAutomationChecklistItems(value) {
  return normalizeChecklist(value).map((label, index) => ({
    id: `automation-${index + 1}`,
    label,
    checked: false,
  }));
}

function buildAutomationMemo(action = {}) {
  const parts = [];
  const memo = text(action.memo);
  if (memo) parts.push(memo);

  const relatedRoute = text(action.relatedRoute || action.related_route || action.relatedMenu || action.related_menu);
  if (relatedRoute) parts.push(`관련 메뉴: ${relatedRoute}`);
  return parts.join("\n\n");
}

function buildRecurringTaskInput(rule, occurrence, now) {
  const action = objectValue(rule.action);
  return {
    title: occurrence.title || text(action.title || rule.name) || "반복 업무",
    type: "general",
    status: "requested",
    priority: text(action.priority) || "normal",
    assigneeId: resolveFixedAssigneeId(rule.assignee),
    dueAt: occurrence.dueAt,
    memo: buildAutomationMemo(action),
    checklistItems: buildAutomationChecklistItems(action.checklist || action.checklistItems || action.checklist_items),
    automationRuleId: rule.id,
    automationSourceType: "recurring",
    automationSourceId: occurrence.scheduledFor,
    automationSourceKey: occurrence.dedupeKey,
    automationGeneratedAt: new Date(now).toISOString(),
  };
}

function shouldNotify(rule) {
  return rule.notification?.enabled !== false && Boolean(rule.notificationChannelId || rule.notification?.channelId);
}

function buildDeliveryInput(rule, task, event = "created") {
  const payload = buildGoogleChatTaskNotificationPayload({ task, event });
  return {
    taskId: text(task.id),
    ruleId: rule.id,
    channelId: rule.notificationChannelId || text(rule.notification?.channelId),
    threadKey: payload.thread?.threadKey || "",
    payload,
  };
}

function emptyCounts(includeUpdated = false) {
  return includeUpdated
    ? { created: 0, updated: 0, skipped: 0, failed: 0 }
    : { created: 0, skipped: 0, failed: 0 };
}

function addCount(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function buildSourceKeyPreviewForTrigger(rule, event) {
  const sourceType = text(event.sourceType || rule.target || event.task?.type || "ops");
  const sourceId = text(event.sourceId || event.task?.id || event.id);
  const trigger = text(event.trigger || rule.trigger || rule.triggerKey);
  return [rule.id, sourceType, sourceId, trigger].filter(Boolean).join(":");
}

function isAfterCompletionRecurringRule(rule) {
  const recurrence = objectValue(rule.recurrence);
  return text(recurrence.generationMode || recurrence.generation_mode || recurrence.createMode || recurrence.create_mode) === "after_completion";
}

function taskRuleId(task = {}) {
  return text(task.automationRuleId || task.automation_rule_id);
}

function taskSourceType(task = {}) {
  return text(task.automationSourceType || task.automation_source_type);
}

function taskSourceKey(task = {}) {
  return text(task.automationSourceKey || task.automation_source_key);
}

function taskScheduledFor(task = {}) {
  const sourceId = text(task.automationSourceId || task.automation_source_id);
  const sourceKey = taskSourceKey(task);
  return toDateKey(sourceId) || toDateKey(sourceKey.split(":").at(-1));
}

function taskCreatedAt(task = {}) {
  return text(task.automationGeneratedAt || task.automation_generated_at || task.createdAt || task.created_at);
}

function isClosedAutomationTask(task = {}) {
  const status = text(task.status);
  return status === "done" || status === "completed" || status === "canceled" || status === "cancelled" || Boolean(text(task.completedAt || task.completed_at));
}

function compareRecurringTaskRecency(left = {}, right = {}) {
  const leftScheduled = taskScheduledFor(left);
  const rightScheduled = taskScheduledFor(right);
  if (leftScheduled !== rightScheduled) return leftScheduled > rightScheduled ? 1 : -1;
  const leftCreatedAt = taskCreatedAt(left);
  const rightCreatedAt = taskCreatedAt(right);
  if (leftCreatedAt === rightCreatedAt) return 0;
  return leftCreatedAt > rightCreatedAt ? 1 : -1;
}

function latestRecurringTaskByRule(tasks = []) {
  const latest = new Map();
  for (const task of tasks) {
    if (taskSourceType(task) && taskSourceType(task) !== "recurring") continue;
    const ruleId = taskRuleId(task);
    if (!ruleId) continue;
    const current = latest.get(ruleId);
    if (!current || compareRecurringTaskRecency(task, current) > 0) latest.set(ruleId, task);
  }
  return latest;
}

async function enqueueDeliveryIfNeeded(store, rule, task) {
  if (!shouldNotify(rule)) return;
  await store.enqueueNotificationDelivery(buildDeliveryInput(rule, task));
}

export async function runDueRecurringAutomations({ store, now = new Date() } = {}) {
  if (!store) throw new Error("Automation store is required.");
  const result = emptyCounts();
  const todayKey = toDateKey(now);
  const rules = (await store.listAutomationRules({ kind: "recurring" })).map(normalizeRule);
  const afterCompletionRuleIds = rules.filter(isAfterCompletionRecurringRule).map((rule) => rule.id).filter(Boolean);
  const recurringTasksByRule = afterCompletionRuleIds.length > 0 && typeof store.listRecurringAutomationTasksByRule === "function"
    ? latestRecurringTaskByRule(await store.listRecurringAutomationTasksByRule(afterCompletionRuleIds))
    : new Map();
  const planned = rules
    .map((rule) => {
      const latestTask = recurringTasksByRule.get(rule.id);
      if (isAfterCompletionRecurringRule(rule) && latestTask && !isClosedAutomationTask(latestTask)) {
        return { rule, waitingForCompletion: latestTask, occurrence: null };
      }
      return {
        rule,
        waitingForCompletion: null,
        occurrence: buildOpsRecurringTaskOccurrence(recurringRuleToTemplate(rule), {
          fromDate: todayKey,
          afterDate: latestTask && isClosedAutomationTask(latestTask) ? taskScheduledFor(latestTask) : "",
        }),
      };
    })
    .filter((item) => item.occurrence && item.occurrence.createOn <= todayKey);

  for (const rule of rules) {
    const latestTask = recurringTasksByRule.get(rule.id);
    if (!isAfterCompletionRecurringRule(rule) || !latestTask || isClosedAutomationTask(latestTask)) continue;
    await store.recordAutomationRun({
      ruleId: rule.id,
      sourceType: "recurring",
      sourceId: taskScheduledFor(latestTask) || latestTask.id,
      sourceKey: `${rule.id}:waiting_for_completion:${todayKey}`,
      scheduledFor: taskScheduledFor(latestTask),
      taskId: latestTask.id,
      status: "skipped",
      payload: { reason: "waiting_for_previous_completion", taskId: latestTask.id },
    });
    addCount(result, "skipped");
  }

  const existingTasks = await store.listExistingAutomationTasks(planned.map((item) => item.occurrence.dedupeKey));
  const existingSourceKeys = new Set(existingTasks.map((task) => taskSourceKey(task)));

  for (const { rule, occurrence } of planned) {
    if (existingSourceKeys.has(occurrence.dedupeKey)) {
      await store.recordAutomationRun({
        ruleId: rule.id,
        sourceType: "recurring",
        sourceId: occurrence.scheduledFor,
        sourceKey: occurrence.dedupeKey,
        scheduledFor: occurrence.scheduledFor,
        status: "skipped",
        payload: { reason: "duplicate_source_key" },
      });
      addCount(result, "skipped");
      continue;
    }

    try {
      const task = await store.createTask(buildRecurringTaskInput(rule, occurrence, now));
      existingSourceKeys.add(occurrence.dedupeKey);
      await store.recordAutomationRun({
        ruleId: rule.id,
        sourceType: "recurring",
        sourceId: occurrence.scheduledFor,
        sourceKey: occurrence.dedupeKey,
        scheduledFor: occurrence.scheduledFor,
        taskId: task.id,
        status: "created",
        payload: { occurrence },
      });
      await enqueueDeliveryIfNeeded(store, rule, task);
      addCount(result, "created");
    } catch (error) {
      await store.recordAutomationRun({
        ruleId: rule.id,
        sourceType: "recurring",
        sourceId: occurrence.scheduledFor,
        sourceKey: occurrence.dedupeKey,
        scheduledFor: occurrence.scheduledFor,
        status: "failed",
        payload: { occurrence },
        errorMessage: error instanceof Error ? error.message : text(error),
      });
      addCount(result, "failed");
    }
  }

  return result;
}

export async function runTriggerAutomation({ store, event } = {}) {
  if (!store) throw new Error("Automation store is required.");
  if (!event) throw new Error("Automation event is required.");
  const result = emptyCounts(true);
  const rules = (await store.listAutomationRules({ kind: "trigger" }))
    .map(normalizeRule)
    .filter((rule) => {
      if (rule.triggerKey && rule.triggerKey !== text(event.trigger)) return false;
      if (rule.target && rule.target !== text(event.sourceType || event.task?.type)) return false;
      return true;
    });
  const existingTasks = await store.listExistingAutomationTasks(rules.map((rule) => buildSourceKeyPreviewForTrigger(rule, event)));

  for (const rule of rules) {
    const modelRule = { ...rule, trigger: rule.triggerKey || rule.trigger };
    const draft = buildOpsTriggeredTaskDraft(modelRule, event, existingTasks);
    if (!draft) {
      await store.recordAutomationRun({
        ruleId: rule.id,
        sourceType: text(event.sourceType || event.task?.type),
        sourceId: text(event.sourceId || event.task?.id),
        sourceKey: buildSourceKeyPreviewForTrigger(rule, event),
        eventKey: text(event.trigger),
        status: "skipped",
        payload: { reason: "not_applicable_or_duplicate" },
      });
      addCount(result, "skipped");
      continue;
    }

    if (draft.updateTask) {
      try {
        const task = await store.updateTask(draft.updateTask.id, draft.updateTask.patch);
        await store.recordAutomationRun({
          ruleId: rule.id,
          sourceType: draft.task.automationSourceType,
          sourceId: draft.task.automationSourceId,
          sourceKey: draft.dedupeKey,
          eventKey: text(event.trigger),
          taskId: draft.updateTask.id,
          status: "updated",
          payload: {
            reason: "duplicate_update_due",
            patch: draft.updateTask.patch,
            taskTitle: task?.title || draft.task.title,
          },
        });
        addCount(result, "updated");
      } catch (error) {
        await store.recordAutomationRun({
          ruleId: rule.id,
          sourceType: text(event.sourceType || event.task?.type),
          sourceId: text(event.sourceId || event.task?.id),
          sourceKey: draft.dedupeKey,
          eventKey: text(event.trigger),
          status: "failed",
          payload: { reason: "duplicate_update_due", patch: draft.updateTask.patch },
          errorMessage: error instanceof Error ? error.message : text(error),
        });
        addCount(result, "failed");
      }
      continue;
    }

    try {
      const task = await store.createTask(draft.task);
      existingTasks.push(task);
      await store.recordAutomationRun({
        ruleId: rule.id,
        sourceType: draft.task.automationSourceType,
        sourceId: draft.task.automationSourceId,
        sourceKey: draft.dedupeKey,
        eventKey: text(event.trigger),
        taskId: task.id,
        status: "created",
        payload: { event: text(event.trigger), taskTitle: draft.task.title },
      });
      await enqueueDeliveryIfNeeded(store, rule, task);
      addCount(result, "created");
    } catch (error) {
      await store.recordAutomationRun({
        ruleId: rule.id,
        sourceType: text(event.sourceType || event.task?.type),
        sourceId: text(event.sourceId || event.task?.id),
        sourceKey: draft.dedupeKey,
        eventKey: text(event.trigger),
        status: "failed",
        payload: { event: text(event.trigger) },
        errorMessage: error instanceof Error ? error.message : text(error),
      });
      addCount(result, "failed");
    }
  }

  return result;
}

function envKeyPart(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function resolveGoogleChatWebhookUrl(channel = {}, env = process.env) {
  const ref = text(channel.webhookSecretRef || channel.webhook_secret_ref);
  if (ref.startsWith("env:")) return text(env[ref.slice(4)]);
  if (ref && env[ref]) return text(env[ref]);

  const teamKey = ref.startsWith("google_chat_webhook:")
    ? ref.split(":").slice(1).join(":")
    : text(channel.teamKey || channel.team_key);
  const normalizedTeam = envKeyPart(teamKey);
  const candidates = [
    `GOOGLE_CHAT_WEBHOOK_${normalizedTeam}`,
    `OPS_GOOGLE_CHAT_WEBHOOK_${normalizedTeam}`,
  ];

  return candidates.map((key) => text(env[key])).find(Boolean) || "";
}

function buildNextRetryAt(now, attemptCount) {
  const date = new Date(now);
  const retryDelayMinutes = Math.min(60, 5 * (2 ** Math.max(0, attemptCount - 1)));
  date.setUTCMinutes(date.getUTCMinutes() + retryDelayMinutes);
  return date.toISOString();
}

async function defaultSendGoogleChat(webhookUrl, payload) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Google Chat webhook failed with ${response.status}`);
  return { status: response.status };
}

function withGoogleChatThreadReplyOption(webhookUrl, payload = {}) {
  const url = text(webhookUrl);
  const threadKey = text(payload?.thread?.threadKey);
  if (!url || !threadKey) return url;
  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.searchParams.has("messageReplyOption")) {
      parsedUrl.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
    }
    return parsedUrl.toString();
  } catch {
    if (url.includes("messageReplyOption=")) return url;
    return `${url}${url.includes("?") ? "&" : "?"}messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`;
  }
}

function buildGoogleChatChannelTestPayload(channel = {}, actorLabel = "") {
  const channelName = text(channel.name) || text(channel.teamKey || channel.team_key) || "Google Chat 채널";
  const actor = text(actorLabel) || "운영자";
  return {
    text: `[TIPS Dashboard] Google Chat 테스트\n채널: ${channelName}\n요청자: ${actor}`,
    thread: {
      threadKey: `ops-task-channel-test-${text(channel.id) || text(channel.teamKey || channel.team_key)}`,
    },
  };
}

export async function sendGoogleChatChannelTest({
  store,
  channelId,
  actorLabel = "",
  env = process.env,
  sendGoogleChat = defaultSendGoogleChat,
  now = new Date(),
} = {}) {
  if (!store) throw new Error("Automation store is required.");
  if (!channelId) throw new Error("Google Chat 채널을 선택하세요.");
  const channel = await store.getNotificationChannel(channelId);
  if (!channel) throw new Error("Google Chat 채널을 다시 불러오세요.");
  const channelName = text(channel.name) || text(channel.teamKey || channel.team_key) || "Google Chat 채널";
  const attemptAt = new Date(now).toISOString();
  const payload = buildGoogleChatChannelTestPayload(channel, actorLabel);

  if (channel.isActive === false || channel.is_active === false) {
    await store.recordNotificationDelivery?.({
      channelId,
      threadKey: payload.thread.threadKey,
      payload,
      status: "skipped",
      attemptCount: 1,
      lastAttemptAt: attemptAt,
      errorMessage: "Google Chat 채널이 비활성 상태입니다.",
    });
    return { ok: false, status: "skipped", channelName, errorMessage: "Google Chat 채널이 비활성 상태입니다." };
  }

  const webhookUrl = await (store.resolveWebhookUrl
    ? store.resolveWebhookUrl(channel, env)
    : resolveGoogleChatWebhookUrl(channel, env));
  if (!webhookUrl) {
    await store.recordNotificationDelivery?.({
      channelId,
      threadKey: payload.thread.threadKey,
      payload,
      status: "failed",
      attemptCount: 1,
      lastAttemptAt: attemptAt,
      errorMessage: "Google Chat webhook URL을 찾지 못했습니다.",
    });
    return { ok: false, status: "failed", channelName, errorMessage: "Google Chat webhook URL을 찾지 못했습니다." };
  }

  try {
    const response = await sendGoogleChat(withGoogleChatThreadReplyOption(webhookUrl, payload), payload);
    await store.recordNotificationDelivery?.({
      channelId,
      threadKey: payload.thread.threadKey,
      payload,
      status: "sent",
      attemptCount: 1,
      lastAttemptAt: attemptAt,
      responseStatus: response?.status || 200,
      errorMessage: null,
    });
    return { ok: true, status: "sent", channelName };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : text(error);
    await store.recordNotificationDelivery?.({
      channelId,
      threadKey: payload.thread.threadKey,
      payload,
      status: "failed",
      attemptCount: 1,
      lastAttemptAt: attemptAt,
      errorMessage,
    });
    return { ok: false, status: "failed", channelName, errorMessage };
  }
}

export async function sendPendingGoogleChatNotifications({
  store,
  env = process.env,
  sendGoogleChat = defaultSendGoogleChat,
  now = new Date(),
} = {}) {
  if (!store) throw new Error("Automation store is required.");
  const result = { sent: 0, skipped: 0, failed: 0 };
  const deliveries = await store.listPendingNotificationDeliveries({ now });

  for (const delivery of deliveries) {
    const channel = delivery.channel || await store.getNotificationChannel(delivery.channelId || delivery.channel_id);
    const attemptCount = Number(delivery.attemptCount ?? delivery.attempt_count ?? 0) + 1;
    if (!channel || channel.isActive === false || channel.is_active === false) {
      await store.updateNotificationDelivery(delivery.id, {
        status: "skipped",
        attemptCount,
        lastAttemptAt: new Date(now).toISOString(),
        errorMessage: "Google Chat 채널이 비활성 상태입니다.",
      });
      addCount(result, "skipped");
      continue;
    }

    const webhookUrl = await (store.resolveWebhookUrl
      ? store.resolveWebhookUrl(channel, env)
      : resolveGoogleChatWebhookUrl(channel, env));
    if (!webhookUrl) {
      await store.updateNotificationDelivery(delivery.id, {
        status: "failed",
        attemptCount,
        lastAttemptAt: new Date(now).toISOString(),
        nextRetryAt: buildNextRetryAt(now, attemptCount),
        errorMessage: "Google Chat webhook URL을 찾지 못했습니다.",
      });
      addCount(result, "failed");
      continue;
    }

    try {
      const response = await sendGoogleChat(withGoogleChatThreadReplyOption(webhookUrl, delivery.payload), delivery.payload);
      await store.updateNotificationDelivery(delivery.id, {
        status: "sent",
        attemptCount,
        lastAttemptAt: new Date(now).toISOString(),
        nextRetryAt: null,
        responseStatus: response?.status || 200,
        errorMessage: null,
      });
      addCount(result, "sent");
    } catch (error) {
      await store.updateNotificationDelivery(delivery.id, {
        status: "failed",
        attemptCount,
        lastAttemptAt: new Date(now).toISOString(),
        nextRetryAt: buildNextRetryAt(now, attemptCount),
        errorMessage: error instanceof Error ? error.message : text(error),
      });
      addCount(result, "failed");
    }
  }

  return result;
}

function nullable(value) {
  const resolved = text(value);
  return resolved || null;
}

function taskInputToRow(input = {}) {
  return {
    title: text(input.title) || "자동 생성 업무",
    type: text(input.type) || "general",
    status: text(input.status) || "requested",
    priority: text(input.priority) || "normal",
    assignee_id: nullable(input.assigneeId),
    student_id: nullable(input.studentId),
    class_id: nullable(input.classId),
    student_name: nullable(input.studentName),
    class_name: nullable(input.className),
    due_at: nullable(input.dueAt),
    memo: nullable(input.memo),
    checklist_items: normalizeTaskChecklistItems(input.checklistItems),
    automation_rule_id: nullable(input.automationRuleId),
    automation_source_type: nullable(input.automationSourceType),
    automation_source_id: nullable(input.automationSourceId),
    automation_source_key: nullable(input.automationSourceKey),
    automation_generated_at: nullable(input.automationGeneratedAt) || new Date().toISOString(),
  };
}

function taskPatchToRow(patch = {}) {
  const row = {};
  if (Object.prototype.hasOwnProperty.call(patch, "dueAt")) row.due_at = nullable(patch.dueAt);
  if (Object.prototype.hasOwnProperty.call(patch, "title")) row.title = text(patch.title) || "자동 생성 업무";
  if (Object.prototype.hasOwnProperty.call(patch, "assigneeId")) row.assignee_id = nullable(patch.assigneeId);
  if (Object.prototype.hasOwnProperty.call(patch, "priority")) row.priority = text(patch.priority) || "normal";
  if (Object.prototype.hasOwnProperty.call(patch, "memo")) row.memo = nullable(patch.memo);
  if (Object.prototype.hasOwnProperty.call(patch, "checklistItems")) {
    row.checklist_items = normalizeTaskChecklistItems(patch.checklistItems);
  }
  return row;
}

function mapTaskRow(row = {}) {
  return {
    id: text(row.id),
    title: text(row.title),
    type: text(row.type),
    status: text(row.status),
    priority: text(row.priority),
    assigneeId: text(row.assignee_id),
    assigneeLabel: text(row.assignee_label),
    studentId: text(row.student_id),
    studentName: text(row.student_name),
    classId: text(row.class_id),
    className: text(row.class_name),
    dueAt: text(row.due_at),
    memo: text(row.memo),
    checklistItems: normalizeTaskChecklistItems(row.checklist_items),
    automationRuleId: text(row.automation_rule_id),
    automationSourceType: text(row.automation_source_type),
    automationSourceId: text(row.automation_source_id),
    automationSourceKey: text(row.automation_source_key),
  };
}

export function createSupabaseOpsTaskAutomationStore(client) {
  if (!client) throw new Error("Supabase client is required.");

  return {
    async listAutomationRules({ kind } = {}) {
      let query = client.from("ops_task_automation_rules").select("*").eq("enabled", true);
      if (kind) query = query.eq("kind", kind);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },

    async listExistingAutomationTasks(sourceKeys = []) {
      const keys = sourceKeys.map(text).filter(Boolean);
      if (keys.length === 0) return [];
      const { data, error } = await client
        .from("ops_tasks")
        .select("id,automation_source_key")
        .in("automation_source_key", keys);
      if (error) throw error;
      return data || [];
    },

    async listRecurringAutomationTasksByRule(ruleIds = []) {
      const ids = ruleIds.map(text).filter(Boolean);
      if (ids.length === 0) return [];
      const { data, error } = await client
        .from("ops_tasks")
        .select("id,status,completed_at,automation_rule_id,automation_source_type,automation_source_id,automation_source_key,automation_generated_at,created_at")
        .eq("automation_source_type", "recurring")
        .in("automation_rule_id", ids)
        .order("automation_generated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async createTask(task) {
      const { data, error } = await client
        .from("ops_tasks")
        .insert(taskInputToRow(task))
        .select("*")
        .single();
      if (error) throw error;
      return mapTaskRow(data);
    },

    async updateTask(taskId, patch) {
      const { data, error } = await client
        .from("ops_tasks")
        .update(taskPatchToRow(patch))
        .eq("id", taskId)
        .select("*")
        .single();
      if (error) throw error;
      return mapTaskRow(data);
    },

    async recordAutomationRun(run) {
      const { error } = await client
        .from("ops_task_automation_runs")
        .insert({
          rule_id: nullable(run.ruleId),
          source_type: text(run.sourceType) || "ops",
          source_id: text(run.sourceId) || "unknown",
          source_key: text(run.sourceKey),
          event_key: nullable(run.eventKey),
          scheduled_for: nullable(run.scheduledFor),
          task_id: nullable(run.taskId),
          status: text(run.status) || "created",
          payload: objectValue(run.payload),
          error_message: nullable(run.errorMessage),
        });
      if (error && error.code !== "23505") throw error;
    },

    async enqueueNotificationDelivery(delivery) {
      if (!delivery.channelId) return;
      const { error } = await client
        .from("ops_task_notification_deliveries")
        .insert({
          task_id: nullable(delivery.taskId),
          rule_id: nullable(delivery.ruleId),
          channel_id: nullable(delivery.channelId),
          thread_key: nullable(delivery.threadKey),
          payload: objectValue(delivery.payload),
          status: "pending",
        });
      if (error) throw error;
    },

    async recordNotificationDelivery(delivery) {
      if (!delivery.channelId) return null;
      const { data, error } = await client
        .from("ops_task_notification_deliveries")
        .insert({
          task_id: nullable(delivery.taskId),
          rule_id: nullable(delivery.ruleId),
          channel_id: nullable(delivery.channelId),
          thread_key: nullable(delivery.threadKey),
          payload: objectValue(delivery.payload),
          status: text(delivery.status) || "pending",
          attempt_count: Number(delivery.attemptCount || 0),
          last_attempt_at: nullable(delivery.lastAttemptAt),
          next_retry_at: nullable(delivery.nextRetryAt),
          response_status: delivery.responseStatus || null,
          error_message: nullable(delivery.errorMessage),
        })
        .select("id")
        .single();
      if (error) throw error;
      return data || null;
    },

    async listPendingNotificationDeliveries({ now = new Date() } = {}) {
      const nowIso = new Date(now).toISOString();
      const { data, error } = await client
        .from("ops_task_notification_deliveries")
        .select("*")
        .or(`status.eq.pending,and(status.eq.failed,next_retry_at.lte.${nowIso})`)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return data || [];
    },

    async getNotificationChannel(channelId) {
      if (!channelId) return null;
      const { data, error } = await client
        .from("ops_task_notification_channels")
        .select("*")
        .eq("id", channelId)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },

    async updateNotificationDelivery(deliveryId, patch) {
      const { error } = await client
        .from("ops_task_notification_deliveries")
        .update({
          status: patch.status,
          attempt_count: patch.attemptCount,
          last_attempt_at: patch.lastAttemptAt,
          next_retry_at: patch.nextRetryAt,
          response_status: patch.responseStatus,
          error_message: patch.errorMessage,
        })
        .eq("id", deliveryId);
      if (error) throw error;
    },
  };
}

export function createOpsAutomationSupabaseClient(env = process.env) {
  const url = text(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL);
  const serviceRoleKey = text(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY);
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function runOpsTaskAutomationCycle({
  store,
  now = new Date(),
  env = process.env,
  sendGoogleChat = defaultSendGoogleChat,
} = {}) {
  const recurring = await runDueRecurringAutomations({ store, now });
  const notifications = await sendPendingGoogleChatNotifications({
    store,
    env,
    sendGoogleChat,
    now,
  });
  return { recurring, notifications };
}
