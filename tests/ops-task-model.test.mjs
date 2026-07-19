import test from "node:test";
import assert from "node:assert/strict";

import {
  OPS_TASK_STATUSES,
  OPS_TASK_TYPES,
  groupOpsTasksByAssignee,
  groupOpsTasksByStatus,
  getOpsTaskCalendarItems,
  getOpsTaskHistoryMutation,
  getRegistrationDirtyBackPlan,
  getRegistrationDirtyCloseDecision,
  hasOpsTaskCalendarDate,
  hasOpsTaskOverdueCalendarDate,
  isClosedOpsTask,
  isOpsTaskAssignedToUser,
  isOpsTaskInUserInbox,
  isOpsTaskInUserSent,
  getWordRetestWorkspaceRole,
  isWordRetestInAssistantQueue,
  isWordRetestInTeacherQueue,
  sortOpsTasksByPriority,
  sortOpsTasksByWorkDate,
  sortOpsTasksByWorkflowStatus,
  summarizeOpsTasks,
} from "../src/features/tasks/ops-task-model.js";

test("task history pushes one list-to-detail entry and replaces internal URL changes without duplicates", () => {
  assert.equal(getOpsTaskHistoryMutation({
    currentUrl: "/admin/registration?view=calendar",
    nextUrl: "/admin/registration?view=calendar&taskId=task-1&appointmentId=appointment-1",
    intent: "push",
  }), "push");
  assert.equal(getOpsTaskHistoryMutation({
    currentUrl: "/admin/registration?taskId=task-1",
    nextUrl: "/admin/registration?taskId=task-1&trackId=track-1",
    intent: "push",
  }), "replace", "canonical focus must not add a second detail entry");
  assert.equal(getOpsTaskHistoryMutation({
    currentUrl: "/admin/registration?taskId=task-1&trackId=track-1",
    nextUrl: "/admin/registration?taskId=task-1&trackId=track-1",
    intent: "push",
  }), "none");
  assert.equal(getOpsTaskHistoryMutation({
    currentUrl: "/admin/registration",
    nextUrl: "/admin/registration?taskId=task-1&trackId=track-1&appointmentId=appointment-1",
    intent: "replace",
  }), "replace", "cancel restoration must replace the list URL instead of pushing");
});

test("dirty registration Back preserves the exact detail link until cancel or discard", () => {
  const exactDetail = {
    taskId: "task-1",
    focusTrackId: "track-1",
    appointmentId: "appointment-1",
  };
  const back = getRegistrationDirtyBackPlan({
    urlHasTask: false,
    hostKind: "detail",
    dirty: true,
    ...exactDetail,
  });

  assert.deepEqual(back, { requestClose: true, restoreDeepLink: exactDetail });
  assert.deepEqual(getRegistrationDirtyCloseDecision("cancel", back.restoreDeepLink, {
    canRestoreForward: true,
  }), {
    close: false,
    restoreDeepLink: exactDetail,
    historyRestore: "forward",
  });
  assert.deepEqual(getRegistrationDirtyCloseDecision("cancel", back.restoreDeepLink, {
    canRestoreForward: false,
  }), {
    close: false,
    restoreDeepLink: exactDetail,
    historyRestore: "replace",
  });
  assert.deepEqual(getRegistrationDirtyCloseDecision("discard", back.restoreDeepLink), {
    close: true,
    restoreDeepLink: null,
    historyRestore: "none",
  });
  assert.deepEqual(getRegistrationDirtyBackPlan({
    urlHasTask: false,
    hostKind: "detail",
    dirty: false,
    ...exactDetail,
  }), { requestClose: true, restoreDeepLink: null });
});

test("ops task types keep the Notion migration scope narrow", () => {
  const labels = OPS_TASK_TYPES.map((item) => item.label);

  assert.deepEqual(labels, ["등록", "퇴원", "전반", "영어 단어 재시험", "교재", "일반"]);
  assert.equal(labels.includes("학사일정"), false);
  assert.equal(labels.includes("정산"), false);
});

test("ops task statuses follow the shared workflow", () => {
  assert.deepEqual(
    OPS_TASK_STATUSES.map((item) => item.label),
    ["요청", "확인", "진행", "검토 요청", "완료", "보류", "취소"],
  );
});

test("team workflow inbox and sent boxes follow the current action owner", () => {
  const tasks = [
    {
      id: "requested-work",
      status: "requested",
      requestedBy: "requester-1",
      requestedByLabel: "요청자",
      requestedTeam: "수학팀",
      assigneeId: "assistant-1",
      assigneeLabel: "담당자",
      assigneeTeam: "조교팀",
    },
    {
      id: "review-work",
      status: "review_requested",
      requestedBy: "requester-1",
      requestedByLabel: "요청자",
      requestedTeam: "수학팀",
      assigneeId: "assistant-1",
      assigneeLabel: "담당자",
      assigneeTeam: "조교팀",
    },
    {
      id: "done-work",
      status: "done",
      requestedBy: "requester-1",
      requestedTeam: "수학팀",
      assigneeId: "assistant-1",
      assigneeTeam: "조교팀",
    },
  ];

  assert.equal(isOpsTaskInUserInbox(tasks[0], { currentUserId: "assistant-1", currentUserTeam: "조교팀" }), true);
  assert.equal(isOpsTaskInUserSent(tasks[0], { currentUserId: "requester-1", currentUserTeam: "수학팀" }), true);
  assert.equal(isOpsTaskInUserInbox(tasks[1], { currentUserId: "requester-1", currentUserTeam: "수학팀" }), true);
  assert.equal(isOpsTaskInUserSent(tasks[1], { currentUserId: "assistant-1", currentUserTeam: "조교팀" }), true);
  assert.equal(isOpsTaskInUserInbox(tasks[2], { currentUserId: "requester-1", currentUserTeam: "수학팀" }), false);
  assert.equal(isOpsTaskInUserSent(tasks[2], { currentUserId: "assistant-1", currentUserTeam: "조교팀" }), false);
});

test("word retest workspace roles follow assistant teacher action ownership", () => {
  const assistantStatuses = ["requested", "confirmed", "in_progress", "on_hold"];

  for (const status of assistantStatuses) {
    const task = { id: status, type: "word_retest", status };
    assert.equal(getWordRetestWorkspaceRole(task), "assistant", status);
    assert.equal(isWordRetestInAssistantQueue(task), true, status);
    assert.equal(isWordRetestInTeacherQueue(task), false, status);
  }

  const reviewTask = {
    id: "review",
    type: "word_retest",
    status: "review_requested",
    requestedBy: "teacher-1",
    requestedTeam: "영어팀",
    wordRetest: { teacherId: "teacher-1", teacherName: "한지현" },
  };

  assert.equal(getWordRetestWorkspaceRole(reviewTask), "teacher");
  assert.equal(isWordRetestInAssistantQueue(reviewTask), false);
  assert.equal(isWordRetestInTeacherQueue(reviewTask), true);
  assert.equal(isWordRetestInTeacherQueue(reviewTask, { currentUserId: "teacher-1" }), true);
  assert.equal(isWordRetestInTeacherQueue(reviewTask, { currentUserLabel: "한지현" }), true);
  assert.equal(isWordRetestInTeacherQueue(reviewTask, { currentUserId: "other", currentUserLabel: "다른선생님" }), false);

  assert.equal(getWordRetestWorkspaceRole({ type: "word_retest", status: "done" }), "completed");
  assert.equal(getWordRetestWorkspaceRole({ type: "word_retest", status: "canceled" }), "completed");
  assert.equal(getWordRetestWorkspaceRole({ type: "general", status: "requested" }), "none");
});

test("team workflow sorting supports due-date and status ordering", () => {
  const tasks = [
    { id: "none", title: "미정", status: "confirmed", priority: "normal" },
    { id: "future", title: "예정", status: "review_requested", priority: "normal", dueAt: "2026-05-23" },
    { id: "overdue", title: "지연", status: "in_progress", priority: "normal", dueAt: "2026-05-20" },
    { id: "today", title: "오늘", status: "requested", priority: "normal", dueAt: "2026-05-21" },
    { id: "start-only", title: "시작", status: "requested", priority: "normal", startAt: "2026-05-22" },
  ];

  assert.deepEqual(
    sortOpsTasksByWorkDate(tasks, "2026-05-21").map((task) => task.id),
    ["overdue", "today", "start-only", "future", "none"],
  );
  assert.deepEqual(
    sortOpsTasksByWorkflowStatus(tasks, "2026-05-21").map((task) => task.id),
    ["today", "start-only", "none", "overdue", "future"],
  );
});

test("team workflow sorting supports priority ordering", () => {
  const tasks = [
    { id: "normal", title: "보통", status: "requested", priority: "normal", dueAt: "2026-05-21" },
    { id: "low", title: "낮음", status: "requested", priority: "low", dueAt: "2026-05-20" },
    { id: "urgent", title: "긴급", status: "requested", priority: "urgent", dueAt: "2026-05-23" },
    { id: "high", title: "높음", status: "requested", priority: "high", dueAt: "2026-05-22" },
  ];

  assert.deepEqual(
    sortOpsTasksByPriority(tasks, "2026-05-21").map((task) => task.id),
    ["urgent", "high", "normal", "low"],
  );
});

test("ops task calendar merges registration withdrawal transfer and word retest dates", () => {
  const items = getOpsTaskCalendarItems([
    {
      id: "registration-1",
      title: "중2 등록 문의",
      type: "registration",
      status: "requested",
      dueAt: "2026-05-22",
      registration: {
        inquiryAt: "2026-05-20T10:00:00+09:00",
        levelTestAt: "2026-05-23T14:00:00+09:00",
        classStartDate: "2026-05-29",
      },
    },
    {
      id: "general-1",
      title: "일반 할 일",
      type: "general",
      status: "requested",
      startAt: "2026-05-21",
      dueAt: "2026-05-28",
    },
    {
      id: "withdrawal-1",
      title: "고1 퇴원",
      type: "withdrawal",
      status: "in_progress",
      withdrawal: { withdrawalDate: "2026-05-24" },
    },
    {
      id: "transfer-1",
      title: "중3 전반",
      type: "transfer",
      status: "confirmed",
      transfer: { fromClassEndDate: "2026-05-25", toClassStartDate: "2026-05-27" },
    },
    {
      id: "word-1",
      title: "본관 단어 재시험",
      type: "word_retest",
      status: "requested",
      wordRetest: { testAt: "2026-05-26T18:00:00+09:00" },
    },
    {
      id: "closed-1",
      title: "완료 업무",
      type: "general",
      status: "done",
      dueAt: "2026-05-30",
    },
  ]);

  assert.deepEqual(
    items.map((item) => `${item.taskId}:${item.kind}:${item.date}`),
    [
      "registration-1:문의:2026-05-20",
      "general-1:시작:2026-05-21",
      "registration-1:예정:2026-05-22",
      "registration-1:레벨테스트:2026-05-23",
      "withdrawal-1:퇴원일:2026-05-24",
      "transfer-1:전 수업 종료:2026-05-25",
      "word-1:본시험:2026-05-26",
      "transfer-1:후 수업 시작:2026-05-27",
      "general-1:마감:2026-05-28",
      "registration-1:수업 시작:2026-05-29",
    ],
  );
});

test("ops task summary prioritizes today overdue mine and confirmation queues", () => {
  const summary = summarizeOpsTasks(
    [
      { id: "1", status: "requested", dueAt: "2026-05-21", assigneeId: "me" },
      { id: "2", status: "confirmed", dueAt: "2026-05-20", assigneeId: "other" },
      { id: "3", status: "in_progress", dueAt: "2026-05-22", assigneeId: "me" },
      { id: "4", status: "done", dueAt: "2026-05-19", assigneeId: "me" },
    ],
    { now: new Date("2026-05-21T09:00:00+09:00"), currentUserId: "me" },
  );

  assert.equal(summary.todayDue, 1);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.assignedToMe, 2);
  assert.equal(summary.needsConfirmation, 1);
});

test("ops task summary counts requested and detail-assigned operational work as mine", () => {
  const tasks = [
    { id: "requested-by-me", status: "confirmed", requestedBy: "me" },
    {
      id: "word-teacher",
      type: "word_retest",
      status: "in_progress",
      wordRetest: { teacherId: "me" },
    },
    {
      id: "snake-word-teacher",
      type: "word_retest",
      status: "requested",
      word_retest: { teacher_id: "me" },
    },
    {
      id: "teacher-name-only",
      type: "word_retest",
      status: "confirmed",
      wordRetest: { teacherName: "한지현" },
    },
    {
      id: "closed-word",
      type: "word_retest",
      status: "done",
      wordRetest: { teacherId: "me" },
    },
  ];

  assert.equal(isOpsTaskAssignedToUser(tasks[1], "me"), true);
  assert.equal(isOpsTaskAssignedToUser(tasks[1], "other"), false);
  assert.equal(isOpsTaskAssignedToUser(tasks[3], "teacher-profile", "한지현"), true);

  const summary = summarizeOpsTasks(tasks, {
    now: new Date("2026-05-21T09:00:00+09:00"),
    currentUserId: "me",
  });

  assert.equal(summary.assignedToMe, 3);

  const labelSummary = summarizeOpsTasks(tasks, {
    now: new Date("2026-05-21T09:00:00+09:00"),
    currentUserId: "teacher-profile",
    currentUserLabel: "한지현",
  });

  assert.equal(labelSummary.assignedToMe, 1);
});

test("ops task summary counts operational detail dates as today work", () => {
  const tasks = [
    {
      id: "registration-today",
      title: "registration today",
      type: "registration",
      status: "confirmed",
      registration: { levelTestAt: "2026-05-21T14:00:00+09:00" },
    },
    {
      id: "withdrawal-today",
      title: "withdrawal today",
      type: "withdrawal",
      status: "in_progress",
      withdrawal: { withdrawalDate: "2026-05-21" },
    },
    {
      id: "same-task-twice",
      title: "same task twice",
      type: "registration",
      status: "requested",
      dueAt: "2026-05-21",
      registration: { levelTestAt: "2026-05-21T16:00:00+09:00" },
    },
    {
      id: "closed-today",
      title: "closed today",
      type: "word_retest",
      status: "done",
      wordRetest: { testAt: "2026-05-21T18:00:00+09:00" },
    },
  ];

  assert.equal(hasOpsTaskCalendarDate(tasks[0], "2026-05-21"), true);

  const summary = summarizeOpsTasks(tasks, {
    now: new Date("2026-05-21T09:00:00+09:00"),
  });

  assert.equal(summary.todayDue, 3);
});

test("ops task summary counts operational detail dates as overdue work", () => {
  const tasks = [
    {
      id: "registration-overdue",
      title: "registration overdue",
      type: "registration",
      status: "confirmed",
      registration: { levelTestAt: "2026-05-20T14:00:00+09:00" },
    },
    {
      id: "transfer-overdue",
      title: "transfer overdue",
      type: "transfer",
      status: "in_progress",
      transfer: { fromClassEndDate: "2026-05-19", toClassStartDate: "2026-05-23" },
    },
    {
      id: "same-task-twice",
      title: "same task twice",
      type: "withdrawal",
      status: "requested",
      dueAt: "2026-05-20",
      withdrawal: { withdrawalDate: "2026-05-20" },
    },
    {
      id: "closed-overdue",
      title: "closed overdue",
      type: "word_retest",
      status: "done",
      wordRetest: { testAt: "2026-05-20T18:00:00+09:00" },
    },
  ];

  assert.equal(hasOpsTaskOverdueCalendarDate(tasks[0], "2026-05-21"), true);

  const summary = summarizeOpsTasks(tasks, {
    now: new Date("2026-05-21T09:00:00+09:00"),
  });

  assert.equal(summary.overdue, 3);
});

test("ops task status and assignee grouping keep operational views scannable", () => {
  const tasks = [
    { id: "1", status: "requested", assigneeLabel: "김조교" },
    { id: "2", status: "requested", assigneeLabel: "김조교" },
    { id: "3", status: "in_progress", assigneeLabel: "" },
    { id: "4", status: "done", assigneeLabel: "박선생" },
  ];

  const statusGroups = groupOpsTasksByStatus(tasks);
  const assigneeGroups = groupOpsTasksByAssignee(tasks);

  assert.deepEqual(
    statusGroups.filter((group) => group.tasks.length > 0).map((group) => `${group.label}:${group.tasks.length}`),
    ["요청:2", "진행:1", "완료:1"],
  );
  assert.deepEqual(
    assigneeGroups.map((group) => `${group.label}:${group.tasks.length}`),
    ["김조교:2", "미지정:1", "박선생:1"],
  );
});

test("ops task model keeps 30 운영 scenarios schedulable accountable and closable", () => {
  const scenarioTasks = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `todo-${index + 1}`,
      title: `운영 할 일 ${index + 1}`,
      type: "general",
      status: index === 5 ? "done" : index === 4 ? "requested" : "confirmed",
      dueAt: index < 2 ? "2026-06-14" : index < 5 ? "2026-06-15" : "2026-06-16",
      assigneeId: index % 2 === 0 ? "assistant-1" : "manager-1",
      assigneeLabel: index % 2 === 0 ? "김조교" : "임현준",
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `registration-${index + 1}`,
      title: `등록 ${index + 1}`,
      type: "registration",
      status: index === 7 ? "done" : index < 2 ? "requested" : "in_progress",
      assigneeId: index % 3 === 0 ? "assistant-1" : "manager-1",
      studentName: `등록학생${index + 1}`,
      className: index % 2 === 0 ? "중2 영어" : "고1 수학",
      registration: {
        inquiryAt: `2026-06-${String(10 + index).padStart(2, "0")}T10:00:00+09:00`,
        levelTestAt: `2026-06-${String(12 + index).padStart(2, "0")}T15:00:00+09:00`,
        classStartDate: `2026-06-${String(18 + index).padStart(2, "0")}`,
      },
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `transfer-${index + 1}`,
      title: `전반 ${index + 1}`,
      type: "transfer",
      status: index === 4 ? "canceled" : index < 2 ? "requested" : "confirmed",
      assigneeId: index === 0 ? "" : "manager-1",
      transfer: {
        fromClassEndDate: `2026-06-${String(13 + index).padStart(2, "0")}`,
        toClassStartDate: `2026-06-${String(16 + index).padStart(2, "0")}`,
      },
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `withdrawal-${index + 1}`,
      title: `퇴원 ${index + 1}`,
      type: "withdrawal",
      status: index === 4 ? "done" : index < 2 ? "requested" : "in_progress",
      assigneeId: index % 2 === 0 ? "assistant-1" : "manager-1",
      withdrawal: {
        withdrawalDate: `2026-06-${String(11 + index).padStart(2, "0")}`,
      },
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `word-${index + 1}`,
      title: `단어 재시험 ${index + 1}`,
      type: "word_retest",
      status: index === 5 ? "done" : index < 3 ? "requested" : "in_progress",
      wordRetest: {
        teacherId: index % 2 === 0 ? "teacher-1" : "teacher-2",
        teacherName: index % 2 === 0 ? "한지현" : "박지환",
        branch: index % 2 === 0 ? "본관" : "별관",
        testAt: `2026-06-${String(14 + index).padStart(2, "0")}T18:00:00+09:00`,
      },
    })),
  ];

  assert.equal(scenarioTasks.length, 30);

  const openTasks = scenarioTasks.filter((task) => !isClosedOpsTask(task));
  const calendarItems = getOpsTaskCalendarItems(scenarioTasks);
  const calendarItemsWithClosed = getOpsTaskCalendarItems(scenarioTasks, { includeClosed: true });
  const statusGroups = groupOpsTasksByStatus(scenarioTasks);
  const assigneeGroups = groupOpsTasksByAssignee(scenarioTasks);
  const summaryForAssistant = summarizeOpsTasks(scenarioTasks, {
    now: new Date("2026-06-15T09:00:00+09:00"),
    currentUserId: "assistant-1",
    currentUserLabel: "김조교",
  });
  const summaryForTeacher = summarizeOpsTasks(scenarioTasks, {
    now: new Date("2026-06-15T09:00:00+09:00"),
    currentUserId: "teacher-1",
    currentUserLabel: "한지현",
  });

  assert.equal(openTasks.length, 25);
  assert.ok(calendarItems.length >= openTasks.length);
  assert.ok(calendarItemsWithClosed.length > calendarItems.length);
  assert.equal(statusGroups.reduce((total, group) => total + group.tasks.length, 0), 30);
  assert.ok(assigneeGroups.some((group) => group.label === "미지정" && group.tasks.length === 7));
  assert.ok(summaryForAssistant.todayDue >= 6);
  assert.ok(summaryForAssistant.overdue >= 8);
  assert.ok(summaryForAssistant.assignedToMe >= 7);
  assert.ok(summaryForAssistant.needsConfirmation >= 10);
  assert.equal(summaryForTeacher.assignedToMe, 3);
});

test("ops task model simulates 30 sample workflows from create edit complete to cleanup", () => {
  const types = [
    ...Array(6).fill("general"),
    ...Array(8).fill("registration"),
    ...Array(5).fill("transfer"),
    ...Array(5).fill("withdrawal"),
    ...Array(6).fill("word_retest"),
  ];
  const created = types.map((type, index) => ({
    id: `sample-${String(index + 1).padStart(2, "0")}`,
    title: `샘플 업무 ${index + 1}`,
    type,
    status: "requested",
    assigneeId: index % 2 === 0 ? "assistant-1" : "teacher-1",
    assigneeLabel: index % 2 === 0 ? "김조교" : "한지현",
  }));

  const edited = created.map((task, index) => {
    const day = String(10 + index).padStart(2, "0");
    if (task.type === "general") {
      return { ...task, dueAt: `2026-07-${day}T09:00`, status: "confirmed" };
    }
    if (task.type === "registration") {
      return {
        ...task,
        status: "in_progress",
        studentName: `등록샘플${index}`,
        className: "중2 영어",
        registration: {
          inquiryAt: `2026-07-${day}T10:00:00+09:00`,
          levelTestAt: `2026-07-${day}T17:00:00+09:00`,
          classStartDate: `2026-07-${String(15 + index).padStart(2, "0")}`,
          pipelineStatus: "5. 입학 등록 결정",
        },
      };
    }
    if (task.type === "transfer") {
      return {
        ...task,
        status: "confirmed",
        studentName: `전반샘플${index}`,
        transfer: {
          fromClassEndDate: `2026-07-${day}`,
          toClassStartDate: `2026-07-${String(12 + index).padStart(2, "0")}`,
        },
      };
    }
    if (task.type === "withdrawal") {
      return {
        ...task,
        status: "in_progress",
        studentName: `퇴원샘플${index}`,
        withdrawal: { withdrawalDate: `2026-07-${day}` },
      };
    }
    return {
      ...task,
      status: "confirmed",
      studentName: `재시험샘플${index}`,
      wordRetest: {
        teacherId: task.assigneeId,
        teacherName: task.assigneeLabel,
        branch: index % 2 === 0 ? "본관" : "별관",
        testAt: `2026-07-${day}T18:00:00+09:00`,
      },
    };
  });

  const completed = edited.map((task) => ({
    ...task,
    status: "done",
    completedAt: "2026-07-31T20:00:00+09:00",
    registration: task.registration
      ? { ...task.registration, pipelineStatus: "7. 등록 완료" }
      : task.registration,
    wordRetest: task.wordRetest
      ? { ...task.wordRetest, retestStatus: "done" }
      : task.wordRetest,
  }));
  const cleaned = completed.filter((task) => !task.id.startsWith("sample-"));

  assert.equal(created.length, 30);
  assert.equal(edited.length, 30);
  assert.equal(getOpsTaskCalendarItems(edited).length >= 30, true);
  assert.equal(summarizeOpsTasks(edited, {
    now: new Date("2026-07-15T09:00:00+09:00"),
    currentUserId: "assistant-1",
  }).assignedToMe, 15);
  assert.equal(completed.every(isClosedOpsTask), true);
  assert.equal(getOpsTaskCalendarItems(completed).length, 0);
  assert.equal(getOpsTaskCalendarItems(completed, { includeClosed: true }).length >= 30, true);
  assert.equal(cleaned.length, 0);
});
