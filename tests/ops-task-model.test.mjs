import test from "node:test";
import assert from "node:assert/strict";
import * as opsTaskModel from "../src/features/tasks/ops-task-model.js";

import {
  OPS_TASK_STATUSES,
  OPS_TASK_TYPES,
  buildRegistrationTextbookSaleDraft,
  buildTransferClassPlanPatch,
  buildTransferScheduleDefaults,
  buildTransferTextbookDefaults,
  buildWithdrawalClassPlanPatch,
  buildWithdrawalSettlementDefaults,
  buildWithdrawalTextbookDefaults,
  buildWordRetestAssistantActionPatch,
  buildGoogleChatTaskNotificationPayload,
  buildOpsRecurringTaskOccurrence,
  buildOpsTriggeredTaskDraft,
  buildWordRetestRerequestDraft,
  getOpsAutomationSourceLabel,
  getWordRetestAssistantQuickActions,
  getWordRetestCompletionReviewItems,
  getRegistrationCompletionChecklistItems,
  getRegistrationCompletionReviewItems,
  getRegistrationCompletionSyncItems,
  getRegistrationDuplicateCompletionBlockers,
  getTransferCompletionSyncItems,
  getTransferCompletionChecklistItems,
  getTransferCompletionReviewItems,
  getWithdrawalCompletionSyncItems,
  getWithdrawalCompletionChecklistItems,
  getWithdrawalCompletionReviewItems,
  groupOpsTasksByAssignee,
  groupOpsTasksByStatus,
  getOpsTaskBasicCompletionBlockers,
  getRegistrationDuplicateStudentCandidates,
  getOpsTaskCalendarItems,
  getOpsTaskScheduleCompletionBlockers,
  isWordRetestInExecutionQueue,
  isWordRetestScoreValue,
  getWordRetestExecutionStage,
  sortWordRetestExecutionQueue,
  hasOpsTaskCalendarDate,
  hasOpsTaskOverdueCalendarDate,
  isClosedOpsTask,
  isOpsTaskActionable,
  isOpsTaskAssignedToUser,
  summarizeOpsTasks,
} from "../src/features/tasks/ops-task-model.js";

test("automation source labels separate recurring and follow-up work from state board work", () => {
  assert.equal(
    getOpsAutomationSourceLabel({
      automationSourceType: "recurring",
      automationSourceKey: "daily-check:2026-05-28",
    }),
    "자동 생성 · 반복 업무",
  );

  assert.equal(
    getOpsAutomationSourceLabel({
      automationSourceType: "registration",
      automationSourceKey: "rule-first-greeting:registration:registration-task-1:registration.completed",
    }),
    "자동 생성 · 등록 완료 후속",
  );

  assert.equal(
    getOpsAutomationSourceLabel({
      type: "registration",
      registration: { pipelineStatus: "6. 수납 진행 중" },
    }),
    "",
  );
});

test("trigger automation creates a registration follow-up due from the first class date", () => {
  const draft = buildOpsTriggeredTaskDraft({
    id: "rule-first-greeting",
    enabled: true,
    trigger: "registration.completed",
    conditions: {
      required: ["task.registration.classStartDate"],
    },
    action: {
      kind: "create_follow_up_task",
      title: "{studentName} 첫 인사 및 안내 전화",
      memo: "첫 수업 시작 후 학부모에게 안내 전화를 남긴다.",
      priority: "high",
      checklist: ["출결/교재 안내", "학부모 통화 기록"],
      relatedRoute: "/admin/registration",
    },
    assignee: {
      strategy: "responsible_teacher",
    },
    due: {
      basis: "task.registration.classStartDate",
      offsetDays: 5,
      dueTime: "18:00",
    },
    notification: {
      channelKey: "teachers",
    },
  }, {
    trigger: "registration.completed",
    sourceType: "registration",
    sourceId: "registration-task-1",
    occurredAt: "2026-05-28T09:00:00+09:00",
    task: {
      id: "registration-task-1",
      type: "registration",
      studentId: "student-1",
      studentName: "김민준",
      classId: "class-1",
      className: "영어 중3 A",
      registration: {
        classStartDate: "2026-06-01",
      },
    },
    teacher: {
      profileId: "teacher-profile-1",
      name: "강부희",
    },
  });

  assert.equal(draft.dedupeKey, "rule-first-greeting:registration:registration-task-1:registration.completed");
  assert.equal(draft.task.title, "김민준 첫 인사 및 안내 전화");
  assert.equal(draft.task.type, "general");
  assert.equal(draft.task.priority, "high");
  assert.equal(draft.task.assigneeId, "teacher-profile-1");
  assert.equal(draft.task.studentId, "student-1");
  assert.equal(draft.task.classId, "class-1");
  assert.equal(draft.task.dueAt, "2026-06-06T18:00:00+09:00");
  assert.deepEqual(draft.task.checklistItems, [
    { id: "automation-1", label: "출결/교재 안내", checked: false },
    { id: "automation-2", label: "학부모 통화 기록", checked: false },
  ]);
  assert.doesNotMatch(draft.task.memo, /체크리스트/);
  assert.match(draft.task.memo, /관련 메뉴: \/admin\/registration/);
  assert.equal(draft.notification.channelKey, "teachers");
});

test("trigger automation treats UI follow-up action type as a general todo type", () => {
  const draft = buildOpsTriggeredTaskDraft({
    id: "rule-ui-action-type",
    enabled: true,
    target: "registration",
    trigger: "registration.completed",
    action: {
      type: "create_follow_up_task",
      title: "{studentName} 후속 안내",
    },
  }, {
    trigger: "registration.completed",
    sourceType: "registration",
    sourceId: "registration-task-ui-type",
    task: {
      id: "registration-task-ui-type",
      type: "registration",
      studentName: "권도윤",
    },
  });

  assert.equal(draft.task.type, "general");
});

test("trigger automation creates curriculum follow-ups from class plan events", () => {
  const draft = buildOpsTriggeredTaskDraft({
    id: "rule-curriculum-materials",
    enabled: true,
    target: "curriculum",
    trigger: "curriculum.plan_saved",
    conditions: {
      required: ["event.classItem.nextSessionDate"],
      filters: {
        subject: "영어",
        grade: "고3",
        team: "선생님팀",
      },
    },
    action: {
      type: "create_follow_up_task",
      title: "{className} 다음 수업 자료 준비",
      memo: "확정된 수업계획 기준으로 자료를 준비한다.",
      relatedRoute: "/admin/curriculum",
    },
    assignee: {
      strategy: "teacher",
    },
    due: {
      basis: "event.classItem.nextSessionDate",
      offsetDays: -1,
      dueTime: "20:00",
    },
    notification: {
      channelKey: "teachers",
    },
  }, {
    trigger: "curriculum.plan_saved",
    sourceType: "curriculum",
    sourceId: "class-english-g3",
    occurredAt: "2026-05-28T20:00:00+09:00",
    classItem: {
      id: "class-english-g3",
      name: "영어 고3 심화",
      subject: "영어",
      grade: "고3",
      nextSessionDate: "2026-06-03",
    },
    teacher: {
      profileId: "teacher-profile-9",
      name: "강부희",
      team: "선생님팀",
    },
  });

  assert.equal(draft.dedupeKey, "rule-curriculum-materials:curriculum:class-english-g3:curriculum.plan_saved");
  assert.equal(draft.task.type, "general");
  assert.equal(draft.task.title, "영어 고3 심화 다음 수업 자료 준비");
  assert.equal(draft.task.classId, "class-english-g3");
  assert.equal(draft.task.className, "영어 고3 심화");
  assert.equal(draft.task.assigneeId, "teacher-profile-9");
  assert.equal(draft.task.dueAt, "2026-06-02T20:00:00+09:00");
  assert.equal(draft.notification.channelKey, "teachers");
});

test("trigger automation creates academic calendar follow-ups from confirmed dates", () => {
  const draft = buildOpsTriggeredTaskDraft({
    id: "rule-academic-exam-prep",
    enabled: true,
    target: "academic_calendar",
    trigger: "academic_calendar.date_confirmed",
    conditions: {
      required: ["event.academicEvent.start"],
      filters: {
        grade: "고3",
      },
    },
    action: {
      kind: "create_follow_up_task",
      title: "{eventTitle} 시험 범위 확인",
      memo: "{schoolName} {grade} 일정 기준으로 준비한다.",
      checklist: ["{eventType} 일정 확인", "{eventTitle} 범위 공유"],
      relatedRoute: "/admin/academic-calendar",
    },
    assignee: {
      strategy: "fixed",
      profileId: "assistant-lead",
    },
    due: {
      basis: "event.academicEvent.start",
      offsetDays: -7,
      dueTime: "17:00",
    },
    notification: {
      channelKey: "assistants",
    },
  }, {
    trigger: "academic_calendar.date_confirmed",
    sourceType: "academic_calendar",
    sourceId: "academic-event-1",
    academicEvent: {
      id: "academic-event-1",
      title: "중앙여고 1학기 기말고사",
      type: "시험기간",
      start: "2026-07-07",
      end: "2026-07-10",
      schoolName: "중앙여고",
      grade: "고3",
    },
  });

  assert.equal(draft.dedupeKey, "rule-academic-exam-prep:academic_calendar:academic-event-1:academic_calendar.date_confirmed");
  assert.equal(draft.task.type, "general");
  assert.equal(draft.task.title, "중앙여고 1학기 기말고사 시험 범위 확인");
  assert.equal(draft.task.memo, "중앙여고 고3 일정 기준으로 준비한다.\n\n관련 메뉴: /admin/academic-calendar");
  assert.deepEqual(draft.task.checklistItems, [
    { id: "automation-1", label: "시험기간 일정 확인", checked: false },
    { id: "automation-2", label: "중앙여고 1학기 기말고사 범위 공유", checked: false },
  ]);
  assert.equal(draft.task.assigneeId, "assistant-lead");
  assert.equal(draft.task.dueAt, "2026-06-30T17:00:00+09:00");
  assert.equal(draft.task.automationSourceType, "academic_calendar");
  assert.equal(draft.task.automationSourceId, "academic-event-1");
  assert.equal(draft.notification.channelKey, "assistants");
});

test("trigger automation can assign a follow-up to a fixed profile", () => {
  const draft = buildOpsTriggeredTaskDraft({
    id: "rule-fixed-assignee",
    enabled: true,
    trigger: "withdrawal.completed",
    action: {
      type: "create_follow_up_task",
      title: "{studentName} 퇴원 정산 최종 확인",
    },
    assignee: {
      strategy: "fixed",
      profileId: "profile-desk-lead",
    },
  }, {
    trigger: "withdrawal.completed",
    sourceType: "withdrawal",
    sourceId: "withdrawal-task-1",
    task: {
      id: "withdrawal-task-1",
      type: "withdrawal",
      studentName: "정서윤",
    },
  });

  assert.equal(draft.task.assigneeId, "profile-desk-lead");
});

test("trigger automation does not mirror state-board residence into duplicate todos", () => {
  const draft = buildOpsTriggeredTaskDraft({
    id: "rule-registration-status",
    enabled: true,
    trigger: "registration.pipeline_status_held",
    action: {
      kind: "create_follow_up_task",
      title: "{studentName} 등록 상태 확인",
    },
  }, {
    trigger: "registration.pipeline_status_held",
    sourceType: "registration",
    sourceId: "registration-task-2",
    task: {
      id: "registration-task-2",
      type: "registration",
      status: "in_progress",
      studentName: "이서연",
      registration: {
        pipelineStatus: "6. 수납 진행 중",
      },
    },
  });

  assert.equal(draft, null);
});

test("trigger automation uses source keys to prevent duplicate generated tasks", () => {
  const rule = {
    id: "rule-transfer-handoff",
    enabled: true,
    trigger: "transfer.completed",
    action: {
      kind: "create_follow_up_task",
      title: "{studentName} 전반 인수인계 확인",
    },
  };
  const event = {
    trigger: "transfer.completed",
    sourceType: "transfer",
    sourceId: "transfer-task-1",
    task: {
      id: "transfer-task-1",
      type: "transfer",
      studentName: "박지호",
    },
  };
  const existingTasks = [
    {
      id: "todo-1",
      automationSourceKey: "rule-transfer-handoff:transfer:transfer-task-1:transfer.completed",
    },
  ];

  assert.equal(buildOpsTriggeredTaskDraft(rule, event, existingTasks), null);
});

test("trigger automation respects structured operation filters", () => {
  const rule = {
    id: "rule-main-english",
    enabled: true,
    trigger: "registration.completed",
    conditions: {
      filters: {
        campus: "본관",
        subject: "영어",
        status: "done",
      },
    },
    action: {
      kind: "create_follow_up_task",
      title: "{studentName} 본관 영어 후속",
    },
  };
  const event = {
    trigger: "registration.completed",
    sourceType: "registration",
    sourceId: "registration-task-filtered",
    task: {
      id: "registration-task-filtered",
      type: "registration",
      status: "done",
      campus: "본관",
      subject: "영어",
      studentName: "최유나",
    },
  };

  assert.equal(buildOpsTriggeredTaskDraft(rule, {
    ...event,
    task: { ...event.task, campus: "별관" },
  }), null);

  const draft = buildOpsTriggeredTaskDraft(rule, event);
  assert.equal(draft.task.title, "최유나 본관 영어 후속");
  assert.equal(draft.task.automationSourceKey, "rule-main-english:registration:registration-task-filtered:registration.completed");
});

test("trigger automation can update an existing follow-up due date instead of duplicating it", () => {
  const rule = {
    id: "rule-first-greeting",
    enabled: true,
    trigger: "registration.completed",
    conditions: {
      duplicatePolicy: "update_due",
      required: ["task.registration.classStartDate"],
    },
    action: {
      kind: "create_follow_up_task",
      title: "{studentName} 첫 인사",
    },
    due: {
      basis: "task.registration.classStartDate",
      offsetDays: 5,
      dueTime: "18:00",
    },
  };
  const event = {
    trigger: "registration.completed",
    sourceType: "registration",
    sourceId: "registration-task-1",
    task: {
      id: "registration-task-1",
      type: "registration",
      studentName: "김민준",
      registration: { classStartDate: "2026-06-03" },
    },
  };
  const existingTasks = [{
    id: "todo-existing",
    dueAt: "2026-06-06T18:00:00+09:00",
    automationSourceKey: "rule-first-greeting:registration:registration-task-1:registration.completed",
  }];

  const draft = buildOpsTriggeredTaskDraft(rule, event, existingTasks);
  assert.equal(draft.existingTaskId, "todo-existing");
  assert.equal(draft.updateTask.id, "todo-existing");
  assert.deepEqual(draft.updateTask.patch, {
    dueAt: "2026-06-08T18:00:00+09:00",
  });
  assert.equal(draft.task.title, "김민준 첫 인사");
});

test("recurring automation calculates daily, weekly, monthly date, and monthly last weekday occurrences", () => {
  assert.deepEqual(
    buildOpsRecurringTaskOccurrence({
      id: "daily-check",
      enabled: true,
      title: "오늘 단어 재시험 미응시 확인",
      frequency: "daily",
      startDate: "2026-05-27",
      dueTime: "11:00",
    }, { fromDate: "2026-05-28" }),
    {
      templateId: "daily-check",
      title: "오늘 단어 재시험 미응시 확인",
      scheduledFor: "2026-05-28",
      createOn: "2026-05-28",
      dueAt: "2026-05-28T11:00:00+09:00",
      dedupeKey: "daily-check:2026-05-28",
    },
  );

  assert.equal(
    buildOpsRecurringTaskOccurrence({
      id: "weekly-check",
      enabled: true,
      title: "주간 시간표 변경 확인",
      frequency: "weekly",
      weekdays: [1, 3],
      dueTime: "10:00",
    }, { fromDate: "2026-05-28" }).scheduledFor,
    "2026-06-01",
  );

  assert.equal(
    buildOpsRecurringTaskOccurrence({
      id: "monthly-check",
      enabled: true,
      title: "월말 정산",
      frequency: "monthly_date",
      monthDay: 31,
    }, { fromDate: "2026-06-01" }).scheduledFor,
    "2026-06-30",
  );

  assert.equal(
    buildOpsRecurringTaskOccurrence({
      id: "last-friday-check",
      enabled: true,
      title: "마지막 금요일 점검",
      frequency: "monthly_last_weekday",
      weekday: 5,
    }, { fromDate: "2026-05-28" }).scheduledFor,
    "2026-05-29",
  );
});

test("Google Chat task notification payload is grouped by automation source thread", () => {
  const payload = buildGoogleChatTaskNotificationPayload({
    task: {
      title: "김민준 첫 인사 및 안내 전화",
      dueAt: "2026-06-06T18:00:00+09:00",
      assigneeLabel: "강부희",
      automationSourceKey: "rule-first-greeting:registration:registration-task-1:registration.completed",
      studentName: "김민준",
    },
    event: "created",
  });

  assert.match(payload.text, /김민준 첫 인사 및 안내 전화/);
  assert.match(payload.text, /강부희/);
  assert.match(payload.text, /2026-06-06/);
  assert.deepEqual(payload.thread, {
    threadKey: "rule-first-greeting-registration-registration-task-1-registration-completed",
  });
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
    ["요청", "확인", "진행", "완료", "보류", "취소"],
  );
});

test("withdrawal completion requires session and settlement hours", () => {
  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "withdrawal",
      status: "done",
      withdrawal: {
        withdrawalDate: "2026-05-25",
        withdrawalSession: "",
        completedLessonHours: "",
        fourWeekLessonHours: "",
      },
    }),
    ["퇴원회차", "진행 수업시수", "4주 기준 수업시수"],
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "withdrawal",
      status: "done",
      withdrawal: {
        withdrawalDate: "2026-05-25",
        withdrawalSession: "7회차",
        completedLessonHours: "6",
        fourWeekLessonHours: "8",
      },
    }),
    [],
  );
});

test("withdrawal completion blocks settlement hours that exceed the four-week basis", () => {
  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "withdrawal",
      status: "done",
      withdrawal: {
        withdrawalDate: "2026-05-25",
        withdrawalSession: "7회차",
        completedLessonHours: "9",
        fourWeekLessonHours: "8",
      },
    }),
    ["수업시수 충돌"],
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "withdrawal",
      status: "done",
      withdrawal: {
        withdrawalDate: "2026-05-25",
        withdrawalSession: "7회차",
        completedLessonHours: "8",
        fourWeekLessonHours: "8",
      },
    }),
    [],
  );
});

test("basic completion blockers expose unresolved operation work without option lists", () => {
  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      type: "transfer",
      status: "confirmed",
      assigneeId: "assistant-1",
      dueAt: "2026-05-27",
      studentId: "student-1",
      classId: "class-next",
      transfer: {
        fromClassId: "class-old",
        fromClassEndDate: "2026-05-26",
        toClassStartDate: "2026-05-27",
        makeeduTransferDone: true,
        feeProcessed: true,
        textbookFeeProcessed: true,
      },
    }),
    ["전 수업 종료회차", "후 수업 시작회차"],
  );

  assert.equal(
    getOpsTaskBasicCompletionBlockers({
      type: "word_retest",
      status: "confirmed",
      studentId: "student-1",
      classId: "class-1",
      textbookId: "textbook-1",
      wordRetest: {
        teacherId: "teacher-1",
        branch: "별관",
        testAt: "2026-05-26T18:00:00+09:00",
        unit: "20",
        retestStatus: "absent",
      },
    }).includes("점수"),
    false,
  );
});

test("word retest basic completion blockers use the single class plan textbook", () => {
  const classes = [
    {
      id: "class-single",
      label: "영어 고1",
      textbookIds: ["book-a"],
    },
  ];

  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      type: "word_retest",
      status: "done",
      studentId: "student-1",
      classId: "class-single",
      wordRetest: {
        teacherId: "teacher-1",
        branch: "본관",
        testAt: "2026-05-26T18:00:00+09:00",
        unit: "20",
        retestStatus: "done",
        firstScore: "95",
      },
    }, { classes }),
    [],
  );
});

test("word retest basic completion blockers infer branch from the selected class", () => {
  const classes = [
    {
      id: "class-annex",
      label: "영어 고1",
      room: "별관 4강",
      textbookIds: ["book-a"],
    },
  ];

  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      type: "word_retest",
      status: "done",
      studentId: "student-1",
      classId: "class-annex",
      wordRetest: {
        teacherId: "teacher-1",
        testAt: "2026-05-26T18:00:00+09:00",
        unit: "20",
        retestStatus: "done",
        firstScore: "95",
      },
    }, { classes }),
    [],
  );
});

test("word retest completion only accepts numeric scores from 0 to 100", () => {
  const baseTask = {
    type: "word_retest",
    status: "done",
    studentId: "student-1",
    classId: "class-1",
    textbookId: "book-1",
    wordRetest: {
      teacherId: "teacher-1",
      branch: "본관",
      testAt: "2026-05-26T18:00:00+09:00",
      unit: "20",
      retestStatus: "done",
    },
  };

  assert.equal(isWordRetestScoreValue("0"), true);
  assert.equal(isWordRetestScoreValue("100"), true);
  assert.equal(isWordRetestScoreValue("101"), false);
  assert.equal(isWordRetestScoreValue("abc"), false);
  assert.equal(isWordRetestScoreValue("95점"), false);

  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      ...baseTask,
      wordRetest: { ...baseTask.wordRetest, firstScore: "abc" },
    }),
    ["점수"],
  );
  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      ...baseTask,
      wordRetest: { ...baseTask.wordRetest, firstScore: "101" },
    }),
    ["점수"],
  );
  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      ...baseTask,
      wordRetest: { ...baseTask.wordRetest, firstScore: "0" },
    }),
    [],
  );
  assert.equal(
    getWordRetestExecutionStage({
      ...baseTask,
      wordRetest: { ...baseTask.wordRetest, firstScore: "abc" },
    }, { today: "2026-05-27" }),
    "needs_score",
  );
  assert.equal(
    buildWordRetestAssistantActionPatch(baseTask, {
      key: "quick_score",
      kind: "quick_score",
      status: "done",
      retestStatus: "done",
      scoreField: "firstScore",
      score: "101",
    }),
    null,
  );
  assert.equal(
    buildWordRetestAssistantActionPatch(baseTask, {
      key: "quick_score",
      kind: "quick_score",
      status: "done",
      retestStatus: "done",
      scoreField: "firstScore",
      score: "abc",
    }),
    null,
  );
  assert.deepEqual(
    buildWordRetestAssistantActionPatch(baseTask, {
      key: "quick_score",
      kind: "quick_score",
      status: "done",
      retestStatus: "done",
      scoreField: "firstScore",
      score: "100",
    }),
    {
      status: "done",
      wordRetest: {
        ...baseTask.wordRetest,
        retestStatus: "done",
        firstScore: "100",
        secondScore: "",
        thirdScore: "",
      },
    },
  );
});

test("withdrawal settlement defaults come from the selected class plan without overwriting edits", () => {
  assert.deepEqual(
    buildWithdrawalSettlementDefaults({
      withdrawal: {},
      classItem: { sessionCount: 8, plannedSessionCount: 6 },
    }),
    {
      withdrawalSession: "6회차",
      completedLessonHours: "6",
      fourWeekLessonHours: "8",
    },
  );

  assert.deepEqual(
    buildWithdrawalSettlementDefaults({
      withdrawal: {
        withdrawalSession: "4회차",
        completedLessonHours: "3",
        fourWeekLessonHours: "",
      },
      classItem: { sessionCount: 8, plannedSessionCount: 6 },
    }),
    {
      fourWeekLessonHours: "8",
    },
  );

  assert.deepEqual(
    buildWithdrawalSettlementDefaults({
      withdrawal: {},
      classItem: { sessionCount: 0, plannedSessionCount: 0 },
    }),
    {},
  );
});

test("withdrawal settlement defaults use the entered withdrawal session for completed hours", () => {
  assert.deepEqual(
    buildWithdrawalSettlementDefaults({
      withdrawal: { withdrawalSession: "4회차" },
      classItem: { sessionCount: 8, plannedSessionCount: 6 },
    }),
    {
      completedLessonHours: "4",
      fourWeekLessonHours: "8",
    },
  );

  assert.deepEqual(
    buildWithdrawalSettlementDefaults({
      withdrawal: {
        withdrawalSession: "4회차",
        completedLessonHours: "직접 정산",
        fourWeekLessonHours: "8",
      },
      classItem: { sessionCount: 8, plannedSessionCount: 6 },
    }),
    {},
  );
});

test("withdrawal textbook defaults come from class textbooks without overwriting edits", () => {
  const classTextbooks = [
    { id: "book-a", label: "문법 1" },
    { id: "book-b", label: "독해 2" },
  ];

  assert.deepEqual(
    buildWithdrawalTextbookDefaults({ withdrawal: {}, classTextbooks }),
    { undistributedTextbooks: "문법 1, 독해 2" },
  );

  assert.deepEqual(
    buildWithdrawalTextbookDefaults({
      withdrawal: { undistributedTextbooks: "직접 확인" },
      classTextbooks,
    }),
    {},
  );

  assert.deepEqual(
    buildWithdrawalTextbookDefaults({ withdrawal: {}, classTextbooks: [] }),
    {},
  );
});

test("withdrawal class plan patch fills settlement and textbook defaults without overwriting edits", () => {
  assert.deepEqual(
    buildWithdrawalClassPlanPatch({
      withdrawal: {},
      classItem: { sessionCount: 8, plannedSessionCount: 6 },
      classTextbooks: [{ id: "book-a", label: "문법 1" }],
    }),
    {
      withdrawalSession: "6회차",
      completedLessonHours: "6",
      fourWeekLessonHours: "8",
      undistributedTextbooks: "문법 1",
    },
  );

  assert.deepEqual(
    buildWithdrawalClassPlanPatch({
      withdrawal: {
        withdrawalSession: "4회차",
        completedLessonHours: "3",
        fourWeekLessonHours: "8",
        undistributedTextbooks: "직접 확인",
      },
      classItem: { sessionCount: 8, plannedSessionCount: 6 },
      classTextbooks: [{ id: "book-a", label: "문법 1" }],
    }),
    {},
  );
});

test("withdrawal workflow presets set date and class-plan defaults together", () => {
  assert.equal(typeof opsTaskModel.buildWithdrawalWorkflowPresetPatch, "function");

  assert.deepEqual(
    opsTaskModel.buildWithdrawalWorkflowPresetPatch("today_with_class_plan", {
      dueTodayValue: "2026-05-25T09:00",
      withdrawal: {},
      classItem: { sessionCount: 8, plannedSessionCount: 6 },
      classTextbooks: [
        { label: "워드마스터 고등" },
        { title: "자이스토리 영어" },
      ],
    }),
    {
      withdrawalDate: "2026-05-25",
      withdrawalSession: "6회차",
      completedLessonHours: "6",
      fourWeekLessonHours: "8",
      undistributedTextbooks: "워드마스터 고등, 자이스토리 영어",
    },
  );

  assert.deepEqual(
    opsTaskModel.buildWithdrawalWorkflowPresetPatch("today_with_class_plan", {
      dueTodayValue: "2026-05-25T09:00",
      withdrawal: {
        withdrawalSession: "직접 입력",
        completedLessonHours: "5",
        fourWeekLessonHours: "7",
        undistributedTextbooks: "없음",
      },
      classItem: { sessionCount: 8, plannedSessionCount: 6 },
      classTextbooks: [{ label: "워드마스터 고등" }],
    }),
    {
      withdrawalDate: "2026-05-25",
    },
  );
});

test("transfer schedule defaults come from class plan sessions without overwriting edits", () => {
  assert.deepEqual(
    buildTransferScheduleDefaults({
      transfer: {},
      fromClass: { sessionCount: 8, plannedSessionCount: 6 },
      toClass: { sessionCount: 10 },
    }),
    {
      fromClassEndSession: "6회차",
      toClassStartSession: "7회차",
    },
  );

  assert.deepEqual(
    buildTransferScheduleDefaults({
      transfer: { fromClassEndSession: "4회차" },
      fromClass: { sessionCount: 8, plannedSessionCount: 6 },
      toClass: { sessionCount: 8 },
    }),
    {
      toClassStartSession: "5회차",
    },
  );

  assert.deepEqual(
    buildTransferScheduleDefaults({
      transfer: { toClassStartSession: "9회차" },
      fromClass: { sessionCount: 8, plannedSessionCount: 6 },
      toClass: { sessionCount: 8 },
    }),
    {
      fromClassEndSession: "6회차",
    },
  );

  assert.deepEqual(
    buildTransferScheduleDefaults({
      transfer: {},
      fromClass: { sessionCount: 8, plannedSessionCount: 8 },
      toClass: { sessionCount: 8 },
    }),
    {
      fromClassEndSession: "8회차",
    },
  );
});

test("transfer schedule defaults wait when target class plan has not reached the next session", () => {
  assert.deepEqual(
    buildTransferScheduleDefaults({
      transfer: {},
      fromClass: { sessionCount: 8, plannedSessionCount: 6 },
      toClass: { sessionCount: 8, plannedSessionCount: 6 },
    }),
    {
      fromClassEndSession: "6회차",
    },
  );
});

test("transfer textbook defaults compare from and to class textbooks without overwriting edits", () => {
  assert.deepEqual(
    buildTransferTextbookDefaults({
      transfer: {},
      fromTextbooks: [{ id: "book-a", label: "전반 전 교재" }],
      toTextbooks: [{ id: "book-b", label: "전반 후 교재" }],
    }),
    {
      fromUndistributedTextbooks: "전반 전 교재",
      toUndistributedTextbooks: "전반 후 교재",
    },
  );

  assert.deepEqual(
    buildTransferTextbookDefaults({
      transfer: { fromUndistributedTextbooks: "직접 입력" },
      fromTextbooks: [{ id: "book-a", label: "전반 전 교재" }],
      toTextbooks: [{ id: "book-b", label: "전반 후 교재" }],
    }),
    {
      toUndistributedTextbooks: "전반 후 교재",
    },
  );

  assert.deepEqual(
    buildTransferTextbookDefaults({
      transfer: {},
      fromTextbooks: [],
      toTextbooks: [],
    }),
    {},
  );
});

test("transfer class plan patch fills schedule and textbook defaults without overwriting edits", () => {
  assert.deepEqual(
    buildTransferClassPlanPatch({
      transfer: {},
      fromClass: { sessionCount: 8, plannedSessionCount: 6 },
      toClass: { sessionCount: 10 },
      fromTextbooks: [{ id: "book-a", label: "전반 전 교재" }],
      toTextbooks: [{ id: "book-b", label: "전반 후 교재" }],
    }),
    {
      fromClassEndSession: "6회차",
      toClassStartSession: "7회차",
      fromUndistributedTextbooks: "전반 전 교재",
      toUndistributedTextbooks: "전반 후 교재",
    },
  );

  assert.deepEqual(
    buildTransferClassPlanPatch({
      transfer: {
        fromClassEndSession: "4회차",
        toClassStartSession: "5회차",
        fromUndistributedTextbooks: "직접 입력",
        toUndistributedTextbooks: "직접 확인",
      },
      fromClass: { sessionCount: 8, plannedSessionCount: 6 },
      toClass: { sessionCount: 8 },
      fromTextbooks: [{ id: "book-a", label: "전반 전 교재" }],
      toTextbooks: [{ id: "book-b", label: "전반 후 교재" }],
    }),
    {},
  );
});

test("transfer workflow presets set dates and class-plan defaults together", () => {
  assert.equal(typeof opsTaskModel.buildTransferWorkflowPresetPatch, "function");

  assert.deepEqual(
    opsTaskModel.buildTransferWorkflowPresetPatch("today_to_tomorrow_with_class_plan", {
      dueTodayValue: "2026-05-25T09:00",
      dueTomorrowValue: "2026-05-26T09:00",
      transfer: {},
      fromClass: { sessionCount: 8, plannedSessionCount: 6 },
      toClass: { sessionCount: 10 },
      fromTextbooks: [{ label: "전반 전 교재" }],
      toTextbooks: [{ title: "전반 후 교재" }],
    }),
    {
      fromClassEndDate: "2026-05-25",
      toClassStartDate: "2026-05-26",
      fromClassEndSession: "6회차",
      toClassStartSession: "7회차",
      fromUndistributedTextbooks: "전반 전 교재",
      toUndistributedTextbooks: "전반 후 교재",
    },
  );

  assert.deepEqual(
    opsTaskModel.buildTransferWorkflowPresetPatch("today_to_tomorrow_with_class_plan", {
      dueTodayValue: "2026-05-25T09:00",
      dueTomorrowValue: "2026-05-26T09:00",
      transfer: {
        fromClassEndSession: "직접 종료",
        toClassStartSession: "직접 시작",
        fromUndistributedTextbooks: "직접 전 교재",
        toUndistributedTextbooks: "직접 후 교재",
      },
      fromClass: { sessionCount: 8, plannedSessionCount: 6 },
      toClass: { sessionCount: 10 },
      fromTextbooks: [{ label: "전반 전 교재" }],
      toTextbooks: [{ title: "전반 후 교재" }],
    }),
    {
      fromClassEndDate: "2026-05-25",
      toClassStartDate: "2026-05-26",
    },
  );
});

test("transfer completion catches missing overlapping and skipped sessions", () => {
  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "transfer",
      status: "done",
      transfer: {
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-26",
        fromClassEndSession: "",
        toClassStartSession: "",
      },
    }),
    ["전 수업 종료회차", "후 수업 시작회차"],
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "transfer",
      status: "done",
      transfer: {
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-26",
        fromClassEndSession: "8회차",
        toClassStartSession: "8회차",
      },
    }),
    ["회차 충돌"],
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "transfer",
      status: "done",
      transfer: {
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-26",
        fromClassEndSession: "8",
        toClassStartSession: "10",
      },
    }),
    ["회차 공백"],
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "transfer",
      status: "done",
      transfer: {
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-26",
        fromClassEndSession: "8",
        toClassStartSession: "9",
      },
    }),
    [],
  );
});

test("transfer completion blocks a new class starting before the previous class ends", () => {
  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "transfer",
      status: "done",
      transfer: {
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-24",
        fromClassEndSession: "8회차",
        toClassStartSession: "9회차",
      },
    }),
    ["일정 충돌"],
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "transfer",
      status: "done",
      transfer: {
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-25",
        fromClassEndSession: "8회차",
        toClassStartSession: "9회차",
      },
    }),
    [],
  );
});

test("registration completion requires the principal-assigned start session", () => {
  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "registration",
      status: "done",
      registration: {
        pipelineStatus: "7. 등록 완료",
        classStartDate: "2026-05-25",
        classStartSession: "",
      },
    }),
    ["수업시작회차"],
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "registration",
      status: "in_progress",
      registration: {
        pipelineStatus: "7. 등록 완료",
        classStartDate: "2026-05-25",
        classStartSession: "3회차",
      },
    }),
    [],
  );
});

test("completion blocks sessions outside the selected class plan range", () => {
  const classes = [
    { id: "class-a", label: "영어 고1", sessionCount: 8 },
    { id: "class-b", label: "영어 고2", sessionCount: 10 },
    { id: "class-empty", label: "수학 중3", sessionCount: 0 },
  ];

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "registration",
      status: "done",
      classId: "class-a",
      registration: {
        pipelineStatus: "7. 등록 완료",
        classStartDate: "2026-05-25",
        classStartSession: "9회차",
      },
    }, { classes }),
    ["수업계획 회차"],
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "withdrawal",
      status: "done",
      classId: "class-empty",
      withdrawal: {
        withdrawalDate: "2026-05-25",
        withdrawalSession: "1회차",
        completedLessonHours: "2",
        fourWeekLessonHours: "8",
      },
    }, { classes }),
    ["수업계획 회차"],
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "transfer",
      status: "done",
      transfer: {
        fromClassId: "class-a",
        toClassId: "class-b",
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-26",
        fromClassEndSession: "9회차",
        toClassStartSession: "10회차",
      },
    }, { classes }),
    ["전 수업계획 회차"],
  );
});

test("completion blocks transfer and withdrawal sessions beyond assigned class plan content", () => {
  const classes = [
    { id: "class-a", label: "영어 고1", sessionCount: 8, plannedSessionCount: 5 },
    { id: "class-b", label: "영어 고2", sessionCount: 10, plannedSessionCount: 6 },
  ];

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "withdrawal",
      status: "done",
      classId: "class-a",
      withdrawal: {
        withdrawalDate: "2026-05-25",
        withdrawalSession: "6회차",
        completedLessonHours: "6",
        fourWeekLessonHours: "8",
      },
    }, { classes }),
    ["수업계획 진도"],
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "transfer",
      status: "done",
      transfer: {
        fromClassId: "class-a",
        toClassId: "class-b",
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-26",
        fromClassEndSession: "6회차",
        toClassStartSession: "7회차",
      },
    }, { classes }),
    ["전 수업계획 진도", "후 수업계획 진도"],
  );
});

test("transfer class plan blockers name the exact from or to class plan target", () => {
  const classes = [
    { id: "from-class", label: "영어 고1", sessionCount: 8, plannedSessionCount: 5, textbookIds: ["book-a"] },
    { id: "to-class", label: "영어 고2", sessionCount: 8, plannedSessionCount: 5, textbookIds: [] },
  ];

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "transfer",
      status: "done",
      transfer: {
        fromClassId: "from-class",
        toClassId: "to-class",
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-26",
        fromClassEndSession: "5회차",
        toClassStartSession: "6회차",
      },
    }, { classes }),
    ["후 수업계획 진도", "후 수업계획 교재"],
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "transfer",
      status: "done",
      transfer: {
        fromClassId: "from-class",
        toClassId: "to-class",
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-26",
        fromClassEndSession: "6회차",
        toClassStartSession: "7회차",
      },
    }, { classes }),
    ["전 수업계획 진도", "후 수업계획 진도", "후 수업계획 교재"],
  );
});

test("class plan progress can be inferred from unplanned session counts", () => {
  const classes = [
    { id: "class-a", label: "영어 고1", sessionCount: 8, unplannedSessionCount: 3 },
    { id: "class-b", label: "영어 고2", sessionCount: 10, unplannedSessionCount: 4 },
  ];

  assert.deepEqual(
    buildWithdrawalSettlementDefaults({
      withdrawal: {},
      classItem: classes[0],
    }),
    {
      withdrawalSession: "5회차",
      completedLessonHours: "5",
      fourWeekLessonHours: "8",
    },
  );

  assert.deepEqual(
    buildTransferScheduleDefaults({
      transfer: {},
      fromClass: classes[0],
      toClass: classes[1],
    }),
    {
      fromClassEndSession: "5회차",
      toClassStartSession: "6회차",
    },
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "transfer",
      status: "done",
      transfer: {
        fromClassId: "class-a",
        toClassId: "class-b",
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-26",
        fromClassEndSession: "6회차",
        toClassStartSession: "7회차",
      },
    }, { classes }),
    ["전 수업계획 진도", "후 수업계획 진도"],
  );
});

test("completion blockers use exact class-plan session readiness when available", () => {
  const classes = [
    {
      id: "class-exact",
      label: "영어 고1",
      sessionCount: 4,
      plannedSessionCount: 3,
      unplannedSessionCount: 1,
      textbookIds: ["book-a"],
      planSessions: [
        { sessionOrder: 1, planned: true },
        { sessionOrder: 2, planned: false },
        { sessionOrder: 4, planned: true },
      ],
    },
  ];

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "withdrawal",
      status: "done",
      classId: "class-exact",
      withdrawal: {
        withdrawalDate: "2026-05-25",
        withdrawalSession: "2회차",
        completedLessonHours: "2",
        fourWeekLessonHours: "4",
      },
    }, { classes }),
    ["수업계획 진도"],
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "withdrawal",
      status: "done",
      classId: "class-exact",
      withdrawal: {
        withdrawalDate: "2026-05-25",
        withdrawalSession: "3회차",
        completedLessonHours: "3",
        fourWeekLessonHours: "4",
      },
    }, { classes }),
    ["수업계획 회차"],
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "registration",
      status: "done",
      classId: "class-exact",
      registration: {
        pipelineStatus: "7. 등록 완료",
        classStartDate: "2026-05-25",
        classStartSession: "2회차",
      },
    }, { classes }),
    ["수업계획 진도"],
  );
});

test("completion separates class plan progress and textbook blockers", () => {
  const classes = [
    {
      id: "from-class",
      label: "영어 고1",
      sessionCount: 8,
      plannedSessionCount: 5,
      unplannedSessionCount: 3,
      textbookIds: ["book-a"],
    },
    {
      id: "to-class",
      label: "영어 고2",
      sessionCount: 8,
      plannedSessionCount: 8,
      unplannedSessionCount: 0,
      textbookIds: [],
    },
  ];

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "withdrawal",
      status: "done",
      classId: "from-class",
      withdrawal: {
        withdrawalDate: "2026-05-25",
        withdrawalSession: "6회차",
        completedLessonHours: "6",
        fourWeekLessonHours: "8",
      },
    }, { classes }),
    ["수업계획 진도"],
  );

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "transfer",
      status: "done",
      transfer: {
        fromClassId: "from-class",
        toClassId: "to-class",
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-26",
        fromClassEndSession: "6회차",
        toClassStartSession: "7회차",
      },
    }, { classes }),
    ["전 수업계획 진도", "후 수업계획 교재"],
  );
});

test("basic completion blockers can use class plan progress and textbook references", () => {
  const classes = [
    {
      id: "from-class",
      label: "영어 고1",
      sessionCount: 8,
      plannedSessionCount: 5,
      textbookIds: ["book-a"],
    },
    {
      id: "to-class",
      label: "영어 고2",
      sessionCount: 8,
      plannedSessionCount: 8,
      textbookIds: [],
    },
  ];

  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      type: "transfer",
      status: "confirmed",
      studentId: "student-1",
      transfer: {
        fromClassId: "from-class",
        toClassId: "to-class",
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-26",
        fromClassEndSession: "6회차",
        toClassStartSession: "7회차",
        makeeduTransferDone: true,
        feeProcessed: true,
        textbookFeeProcessed: true,
      },
    }, { classes }),
    ["전 수업계획 진도", "후 수업계획 교재"],
  );
});

test("registration basic completion blockers use the single class plan textbook", () => {
  const classes = [
    {
      id: "class-single",
      label: "영어 고1",
      sessionCount: 8,
      plannedSessionCount: 8,
      textbookIds: ["book-a"],
    },
  ];

  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      type: "registration",
      status: "done",
      studentId: "student-a",
      classId: "class-single",
      registration: {
        pipelineStatus: "7. 등록 완료",
        classStartDate: "2026-05-25",
        classStartSession: "3회차",
        principalReviewNote: "원장 분석 완료",
        principalPlacementChecked: true,
        admissionNoticeSent: true,
        paymentChecked: true,
        makeeduRegistered: true,
        makeeduInvoiceSent: true,
        textbookBillingIssued: true,
      },
    }, { classes }),
    [],
  );
});

test("registration completion points missing class-plan textbooks back to 수업계획", () => {
  const classes = [
    {
      id: "class-empty",
      label: "영어 고1",
      sessionCount: 8,
      plannedSessionCount: 8,
      textbookIds: [],
    },
  ];

  assert.deepEqual(
    getOpsTaskScheduleCompletionBlockers({
      type: "registration",
      status: "done",
      classId: "class-empty",
      registration: {
        pipelineStatus: "7. 등록 완료",
        classStartDate: "2026-05-25",
        classStartSession: "3회차",
      },
    }, { classes }),
    ["수업계획 교재"],
  );

  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      type: "registration",
      status: "done",
      studentId: "student-a",
      classId: "class-empty",
      registration: {
        pipelineStatus: "7. 등록 완료",
        classStartDate: "2026-05-25",
        classStartSession: "3회차",
        principalReviewNote: "원장 분석 완료",
        principalPlacementChecked: true,
        admissionNoticeSent: true,
        paymentChecked: true,
        makeeduRegistered: true,
        makeeduInvoiceSent: true,
        textbookBillingIssued: true,
      },
    }, { classes }),
    ["수업계획 교재"],
  );
});

test("class plan defaults do not suggest unassigned zero progress sessions", () => {
  assert.deepEqual(
    buildWithdrawalSettlementDefaults({
      withdrawal: {},
      classItem: { sessionCount: 8, plannedSessionCount: 0 },
    }),
    { fourWeekLessonHours: "8" },
  );

  assert.deepEqual(
    buildTransferScheduleDefaults({
      transfer: {},
      fromClass: { sessionCount: 8, plannedSessionCount: 0 },
      toClass: { sessionCount: 8 },
    }),
    {},
  );
});

test("registration detects duplicate students from phone and school identity", () => {
  const candidates = getRegistrationDuplicateStudentCandidates(
    {
      type: "registration",
      studentName: "김민수",
      registration: {
        schoolName: "중앙고",
        studentPhone: "010-1234-5678",
        parentPhone: "010-9999-0000",
      },
    },
    [
      {
        id: "student-phone",
        label: "김민수",
        school: "중앙고",
        grade: "고1",
        contact: "01012345678",
        parentContact: "",
      },
      {
        id: "parent-phone",
        label: "김민수 형제",
        school: "중앙고",
        grade: "고2",
        contact: "",
        parentContact: "010-9999-0000",
      },
      {
        id: "name-school",
        label: "김민수",
        school: "중앙고",
        grade: "고3",
        contact: "",
        parentContact: "",
      },
      {
        id: "different-school",
        label: "김민수",
        school: "서문고",
        grade: "고1",
        contact: "",
        parentContact: "",
      },
    ],
  );

  assert.deepEqual(
    candidates.map((candidate) => `${candidate.id}:${candidate.reason}`),
    [
      "student-phone:학생 전화 중복",
      "parent-phone:학부모 전화 중복",
      "name-school:이름/학교 중복",
    ],
  );
});

test("registration duplicate candidates keep every matched reason for review", () => {
  const [candidate] = getRegistrationDuplicateStudentCandidates(
    {
      type: "registration",
      studentName: "김민수",
      registration: {
        schoolName: "중앙고",
        studentPhone: "010-1234-5678",
        parentPhone: "010-9999-0000",
      },
    },
    [
      {
        id: "existing-student",
        label: "김민수",
        school: "중앙고",
        grade: "고1",
        contact: "01012345678",
        parentContact: "01099990000",
      },
    ],
  );

  assert.equal(candidate.reason, "학생 전화 중복");
  assert.deepEqual(candidate.reasons, ["학생 전화 중복", "학부모 전화 중복", "이름/학교 중복"]);
});

test("registration completion blocks unresolved duplicate student candidates", () => {
  const students = [
    {
      id: "existing-student",
      label: "김민수",
      school: "중앙고",
      grade: "고1",
      contact: "01012345678",
      parentContact: "",
    },
  ];

  assert.deepEqual(
    getRegistrationDuplicateCompletionBlockers({
      type: "registration",
      status: "done",
      studentName: "김민수",
      registration: {
        pipelineStatus: "7. 등록 완료",
        schoolName: "중앙고",
        studentPhone: "010-1234-5678",
      },
    }, students),
    ["기존 학생 후보"],
  );

  assert.deepEqual(
    getRegistrationDuplicateCompletionBlockers({
      type: "registration",
      status: "done",
      studentId: "existing-student",
      studentName: "김민수",
      registration: {
        pipelineStatus: "7. 등록 완료",
        schoolName: "중앙고",
        studentPhone: "010-1234-5678",
      },
    }, students),
    [],
  );

  assert.deepEqual(
    getRegistrationDuplicateCompletionBlockers({
      type: "registration",
      status: "done",
      studentId: "existing-student",
      studentName: "김민수",
      registration: {
        pipelineStatus: "7. 등록 완료",
        schoolName: "중앙고",
        studentPhone: "010-1234-5678",
        parentPhone: "010-9999-0000",
      },
    }, [
      ...students,
      {
        id: "sibling-student",
        label: "김민수 형제",
        school: "중앙고",
        grade: "고2",
        contact: "",
        parentContact: "010-9999-0000",
      },
    ]),
    ["기존 학생 후보"],
  );
});

test("basic completion blockers include unresolved registration duplicate candidates", () => {
  const task = {
    type: "registration",
    status: "confirmed",
    studentName: "김민수",
    classId: "class-a",
    textbookId: "book-a",
    registration: {
      pipelineStatus: "6. 수납 진행 중",
      schoolName: "중앙고",
      studentPhone: "010-1234-5678",
      classStartDate: "2026-05-25",
      classStartSession: "1회차",
      principalReviewNote: "원장 분석 완료",
      principalPlacementChecked: true,
      admissionNoticeSent: true,
      paymentChecked: true,
      makeeduRegistered: true,
      makeeduInvoiceSent: true,
      textbookBillingIssued: true,
    },
  };
  const options = {
    students: [
      {
        id: "existing-student",
        label: "김민수",
        school: "중앙고",
        contact: "01012345678",
      },
    ],
    classes: [
      {
        id: "class-a",
        textbookIds: ["book-a"],
        sessionCount: 8,
        plannedSessionCount: 8,
      },
    ],
  };

  assert.deepEqual(getOpsTaskBasicCompletionBlockers(task, options), ["기존 학생 후보"]);
  assert.equal(opsTaskModel.isOpsTaskBasicConfirmationCandidate(task, options), true);
});

test("basic completion blockers catch stale linked management records", () => {
  const options = {
    students: [{ id: "student-ok", label: "김민수", classIds: ["class-ok"], waitlistClassIds: [] }],
    classes: [
      {
        id: "class-ok",
        label: "영어 고1",
        textbookIds: ["book-ok"],
        sessionCount: 8,
        plannedSessionCount: 8,
      },
    ],
    textbooks: [{ id: "book-ok", label: "문법 A" }],
    teachers: [{ id: "teacher-ok", label: "임현준" }],
  };

  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      type: "registration",
      status: "confirmed",
      studentId: "missing-student",
      classId: "missing-class",
      textbookId: "missing-book",
      registration: {
        pipelineStatus: "6. 수납 진행 중",
        classStartDate: "2026-05-25",
        classStartSession: "1회차",
        principalReviewNote: "원장 분석 완료",
        principalPlacementChecked: true,
        admissionNoticeSent: true,
        paymentChecked: true,
        makeeduRegistered: true,
        makeeduInvoiceSent: true,
        textbookBillingIssued: true,
      },
    }, options),
    ["학생", "수업", "교재"],
  );

  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      type: "word_retest",
      status: "done",
      studentId: "student-ok",
      classId: "class-ok",
      textbookId: "missing-book",
      wordRetest: {
        teacherId: "missing-teacher",
        branch: "본관",
        testAt: "2026-05-25T18:00:00+09:00",
        unit: "Unit 3",
        firstScore: "85",
      },
    }, options),
    ["선생님", "교재"],
  );
});

test("basic completion blockers catch missing roster links before completion", () => {
  const options = {
    students: [
      { id: "student-a", label: "김민수", classIds: [], waitlistClassIds: [] },
      { id: "student-b", label: "이서연", classIds: ["from-class"], waitlistClassIds: [] },
    ],
    classes: [
      {
        id: "class-a",
        label: "영어 고1",
        studentIds: [],
        waitlistIds: [],
        textbookIds: ["book-a"],
        sessionCount: 8,
        plannedSessionCount: 8,
      },
      {
        id: "from-class",
        label: "영어 고2",
        studentIds: [],
        waitlistIds: [],
        textbookIds: ["book-b"],
        sessionCount: 8,
        plannedSessionCount: 8,
      },
      {
        id: "to-class",
        label: "영어 고3",
        studentIds: [],
        waitlistIds: [],
        textbookIds: ["book-c"],
        sessionCount: 8,
        plannedSessionCount: 8,
      },
    ],
    textbooks: [
      { id: "book-a", label: "문법 A" },
      { id: "book-b", label: "문법 B" },
      { id: "book-c", label: "문법 C" },
    ],
    teachers: [{ id: "teacher-a", label: "임현준" }],
  };

  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      type: "withdrawal",
      status: "done",
      studentId: "student-a",
      classId: "class-a",
      withdrawal: {
        withdrawalDate: "2026-05-25",
        withdrawalSession: "4회차",
        completedLessonHours: "4",
        fourWeekLessonHours: "8",
        makeeduWithdrawalDone: true,
        feeProcessed: true,
        textbookFeeProcessed: true,
      },
    }, options),
    ["수업 명단"],
  );

  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      type: "transfer",
      status: "done",
      studentId: "student-a",
      transfer: {
        fromClassId: "from-class",
        toClassId: "to-class",
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-26",
        fromClassEndSession: "4회차",
        toClassStartSession: "5회차",
        makeeduTransferDone: true,
        feeProcessed: true,
        textbookFeeProcessed: true,
      },
    }, options),
    ["전 수업 명단"],
  );

  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      type: "word_retest",
      status: "done",
      studentId: "student-a",
      classId: "class-a",
      textbookId: "book-a",
      wordRetest: {
        teacherId: "teacher-a",
        branch: "본관",
        testAt: "2026-05-25T18:00:00+09:00",
        unit: "Unit 3",
        firstScore: "85",
      },
    }, options),
    ["수업 명단"],
  );

  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      type: "transfer",
      status: "done",
      studentId: "student-b",
      transfer: {
        fromClassId: "from-class",
        toClassId: "to-class",
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-26",
        fromClassEndSession: "4회차",
        toClassStartSession: "5회차",
        makeeduTransferDone: true,
        feeProcessed: true,
        textbookFeeProcessed: true,
      },
    }, options),
    [],
  );
});

test("registration completion sync preview follows selected records without recommending classes", () => {
  const classes = [
    { id: "class-a", label: "영어 고1", textbookIds: ["book-a"], sessionCount: 8 },
    { id: "class-b", label: "영어 고2", textbookIds: [], sessionCount: 10 },
  ];
  const textbooks = [
    { id: "book-a", title: "고등 영어 독해" },
    { id: "book-b", title: "고등 영어 문법" },
  ];

  const detailedPreview = getRegistrationCompletionSyncItems({
    type: "registration",
    studentName: "김민수",
    classId: "class-a",
    textbookId: "book-a",
    registration: {
      classStartDate: "2026-05-25",
      classStartSession: "3회차",
    },
  }, { classes, textbooks });

  assert.deepEqual(
    detailedPreview.map((item) => `${item.label}:${item.state}:${item.detail || ""}`),
    [
      "학생관리:will_create:김민수",
      "수업명단:will_add:김민수 · 영어 고1",
      "교재 연결:already_linked:영어 고1 · 고등 영어 독해",
      "교재 청구/출고:will_create:김민수 · 영어 고1 · 고등 영어 독해",
      "교재 준비:will_check:김민수 · 고등 영어 독해",
    ],
  );

  assert.deepEqual(
    getRegistrationCompletionSyncItems({
      type: "registration",
      studentName: "김민수",
      classId: "class-a",
      textbookId: "book-a",
      registration: {
        classStartDate: "2026-05-25",
        classStartSession: "3회차",
      },
    }, { classes }).map((item) => `${item.label}:${item.state}`),
    [
      "학생관리:will_create",
      "수업명단:will_add",
      "교재 연결:already_linked",
      "교재 청구/출고:will_create",
      "교재 준비:will_check",
    ],
  );

  assert.deepEqual(
    getRegistrationCompletionSyncItems({
      type: "registration",
      studentId: "student-a",
      studentName: "김민수",
      classId: "class-b",
      textbookId: "book-b",
      registration: {
        classStartDate: "2026-05-25",
        classStartSession: "3회차",
      },
    }, { classes }).map((item) => `${item.label}:${item.state}`),
    [
      "학생관리:will_link",
      "수업명단:will_add",
      "교재 연결:will_link",
      "교재 청구/출고:will_create",
      "교재 준비:will_check",
    ],
  );
});

test("registration completion sync preview uses linked student ids without duplicate roster work", () => {
  const classes = [
    { id: "class-a", label: "영어 고1", textbookIds: ["book-a"], studentIds: ["student-a"], sessionCount: 8 },
    { id: "class-b", label: "영어 고2", textbookIds: ["book-b"], student_ids: [], sessionCount: 8 },
  ];

  assert.deepEqual(
    getRegistrationCompletionSyncItems({
      type: "registration",
      studentId: "student-a",
      classId: "class-a",
      textbookId: "book-a",
      registration: {
        classStartDate: "2026-05-25",
        classStartSession: "3회차",
      },
    }, { classes }).map((item) => `${item.label}:${item.state}`),
    [
      "학생관리:will_link",
      "수업명단:already_linked",
      "교재 연결:already_linked",
      "교재 청구/출고:will_create",
      "교재 준비:will_check",
    ],
  );

  assert.deepEqual(
    getRegistrationCompletionSyncItems({
      type: "registration",
      studentId: "student-a",
      classId: "class-b",
      textbookId: "book-b",
      registration: {
        classStartDate: "2026-05-25",
        classStartSession: "3회차",
      },
    }, { classes }).map((item) => `${item.label}:${item.state}`),
    [
      "학생관리:will_link",
      "수업명단:will_add",
      "교재 연결:already_linked",
      "교재 청구/출고:will_create",
      "교재 준비:will_check",
    ],
  );
});

test("registration completion sync uses a single class plan textbook without duplicate entry", async () => {
  const { getRegistrationEffectiveTextbookId } = await import("../src/features/tasks/ops-task-model.js");
  const classes = [
    { id: "class-single", label: "영어 고1", textbookIds: ["book-a"], sessionCount: 8 },
    { id: "class-many", label: "영어 고2", textbookIds: ["book-a", "book-b"], sessionCount: 8 },
  ];

  assert.equal(typeof getRegistrationEffectiveTextbookId, "function");

  assert.equal(
    getRegistrationEffectiveTextbookId({
      type: "registration",
      classId: "class-single",
      registration: { classStartDate: "2026-05-25" },
    }, { classes }),
    "book-a",
  );

  assert.equal(
    getRegistrationEffectiveTextbookId({
      type: "registration",
      classId: "class-many",
      registration: { classStartDate: "2026-05-25" },
    }, { classes }),
    "",
  );

  assert.deepEqual(
    getRegistrationCompletionSyncItems({
      type: "registration",
      studentId: "student-a",
      classId: "class-single",
      registration: {
        classStartDate: "2026-05-25",
        classStartSession: "3회차",
      },
    }, { classes }).map((item) => `${item.label}:${item.state}`),
    [
      "학생관리:will_link",
      "수업명단:will_add",
      "교재 연결:already_linked",
      "교재 청구/출고:will_create",
      "교재 준비:will_check",
    ],
  );

  assert.deepEqual(
    getRegistrationCompletionSyncItems({
      type: "registration",
      studentId: "student-a",
      classId: "class-single",
      registration: {
        classStartDate: "2026-05-25",
        classStartSession: "3회차",
        textbookReady: true,
      },
    }, { classes }).map((item) => `${item.label}:${item.state}`),
    [
      "학생관리:will_link",
      "수업명단:will_add",
      "교재 연결:already_linked",
      "교재 청구/출고:will_create",
      "교재 준비:already_linked",
    ],
  );
});

test("registration workflow presets set pipeline status and date together without recommendations", async () => {
  const { buildRegistrationWorkflowPresetPatch } = await import("../src/features/tasks/ops-task-model.js");

  assert.equal(typeof buildRegistrationWorkflowPresetPatch, "function");
  assert.deepEqual(
    buildRegistrationWorkflowPresetPatch("phone_inquiry_today", {
      inquiryNowValue: "2026-05-25T14:30",
      dueTodayValue: "2026-05-25T09:00",
    }),
    {
      pipelineStatus: "0. 등록 문의",
      inquiryAt: "2026-05-25T14:30",
      inquiryChannel: "전화",
    },
  );
  assert.deepEqual(
    buildRegistrationWorkflowPresetPatch("chat_inquiry_today", { dueTodayValue: "2026-05-25T09:00" }),
    {
      pipelineStatus: "0. 등록 문의",
      inquiryAt: "2026-05-25T09:00",
      inquiryChannel: "채널톡",
    },
  );
  assert.deepEqual(
    buildRegistrationWorkflowPresetPatch("level_test_today", { dueTodayValue: "2026-05-25T09:00" }),
    {
      pipelineStatus: "1. 레벨테스트 신청",
      levelTestAt: "2026-05-25T09:00",
    },
  );
  assert.deepEqual(
    buildRegistrationWorkflowPresetPatch("consult_today", { dueTodayValue: "2026-05-25T09:00" }),
    {
      pipelineStatus: "2. 상담 신청",
      consultationAt: "2026-05-25T09:00",
    },
  );
  assert.deepEqual(
    buildRegistrationWorkflowPresetPatch("phone_consult_today", { dueTodayValue: "2026-05-25T09:00" }),
    {
      pipelineStatus: "2. 상담 신청",
      phoneConsultationAt: "2026-05-25T09:00",
    },
  );
  assert.deepEqual(
    buildRegistrationWorkflowPresetPatch("visit_consult_today", { dueTodayValue: "2026-05-25T09:00" }),
    {
      pipelineStatus: "2. 상담 신청",
      visitConsultationAt: "2026-05-25T09:00",
    },
  );
  assert.deepEqual(
    buildRegistrationWorkflowPresetPatch("registration_request"),
    {
      pipelineStatus: "5. 등록 신청",
    },
  );
  assert.deepEqual(
    buildRegistrationWorkflowPresetPatch("payment_in_progress"),
    {
      pipelineStatus: "6. 수납 진행 중",
    },
  );
  assert.equal(JSON.stringify(buildRegistrationWorkflowPresetPatch("level_test_today")), JSON.stringify({ pipelineStatus: "1. 레벨테스트 신청" }));
  assert.equal(JSON.stringify(buildRegistrationWorkflowPresetPatch("registration_request")).includes("추천"), false);
});

test("registration completion creates one charged textbook issue draft for the selected student", () => {
  const draft = buildRegistrationTextbookSaleDraft({
    input: {
      type: "registration",
      status: "done",
      studentId: "student-a",
      classId: "class-a",
      textbookId: "book-a",
      registration: {
        pipelineStatus: "7. 등록 완료",
        classStartDate: "2026-05-25",
      },
    },
    student: { id: "student-a", name: "김민수" },
    classRow: { id: "class-a", name: "영어 고1" },
    textbook: { id: "book-a", title: "고등 영어 독해", sale_price: 12000 },
  });

  assert.deepEqual(draft, {
    sale: {
      class_id: "class-a",
      charge_month: "2026-05",
      status: "charged",
      memo: "등록 자동 생성 · 영어 고1",
    },
    line: {
      student_id: "student-a",
      class_id: "class-a",
      textbook_id: "book-a",
      charge_month: "2026-05",
      quantity: 1,
      unit_price: 12000,
      status: "charged",
      memo: "등록 자동 생성 · 김민수 · 고등 영어 독해",
    },
  });
});

test("registration textbook issue draft can use the class plan textbook id", () => {
  const draft = buildRegistrationTextbookSaleDraft({
    input: {
      type: "registration",
      status: "done",
      studentId: "student-a",
      classId: "class-a",
      registration: {
        pipelineStatus: "7. 등록 완료",
        classStartDate: "2026-05-25",
      },
    },
    student: { id: "student-a", name: "김민수" },
    classRow: { id: "class-a", name: "영어 고1", textbookIds: ["book-a"] },
    textbook: { title: "고등 영어 독해", sale_price: 12000 },
  });

  assert.equal(draft?.line.textbook_id, "book-a");
  assert.equal(draft?.line.memo, "등록 자동 생성 · 김민수 · 고등 영어 독해");
});

test("registration completion checklist keeps the staff completion order", () => {
  const items = getRegistrationCompletionChecklistItems({
    principalPlacementChecked: true,
    admissionNoticeSent: true,
    paymentChecked: false,
    makeeduRegistered: true,
    makeeduInvoiceSent: false,
    textbookBillingIssued: false,
  });

  assert.deepEqual(
    items.map((item) => `${item.order}:${item.phase}:${item.label}:${item.checked}`),
    [
      "1:배정:원장 반배정:true",
      "2:안내:입학안내문:true",
      "3:수납:수납:false",
      "4:메이크에듀:메이크에듀 등록:true",
      "5:메이크에듀:청구서 발송:false",
      "6:교재:교재 청구출고표:false",
    ],
  );

  assert.deepEqual(
    items.filter((item) => !item.checked).map((item) => item.label),
    ["수납", "청구서 발송", "교재 청구출고표"],
  );
});

test("registration completion review keeps principal placement start and handoff values visible", () => {
  assert.deepEqual(
    getRegistrationCompletionReviewItems({
      type: "registration",
      className: "영어 고1",
      textbookTitle: "고등 영어 독해",
      registration: {
        principalReviewNote: "원장 분석 완료",
        principalPlacementChecked: true,
        classStartDate: "2026-05-25",
        classStartSession: "3회차",
        makeeduRegistered: true,
        makeeduInvoiceSent: false,
      },
    }).map((item) => `${item.label}:${item.value}`),
    [
      "원장 분석:원장 분석 완료",
      "반배정:원장 반배정 완료",
      "수업 시작:영어 고1 · 2026-05-25 · 3회차",
      "교재:고등 영어 독해",
      "메이크에듀:등록 완료 / 청구서 미발송",
    ],
  );
});

test("registration principal queue summary stays manual and recommendation-free", () => {
  assert.equal(typeof opsTaskModel.getRegistrationPrincipalQueueSummary, "function");

  assert.equal(
    opsTaskModel.getRegistrationPrincipalQueueSummary({
      type: "registration",
      registration: { pipelineStatus: "0. 등록 문의" },
    }),
    null,
  );

  const pending = opsTaskModel.getRegistrationPrincipalQueueSummary({
    type: "registration",
    registration: {
      pipelineStatus: "1. 레벨테스트 신청",
      levelTestResult: "문법 80",
    },
  });

  assert.deepEqual(pending, {
    testAtLabel: "레벨테스트 미정",
    materialLabel: "자료 미연결",
    resultLabel: "결과 문법 80",
    analysisLabel: "원장 분석 필요",
    placementLabel: "반배정 대기",
  });
  assert.equal(JSON.stringify(pending).includes("추천"), false);

  assert.deepEqual(
    opsTaskModel.getRegistrationPrincipalQueueSummary({
      type: "registration",
      registration: {
        pipelineStatus: "5. 등록 신청",
        levelTestAt: "2026-05-25T14:30:00+09:00",
        levelTestMaterialLink: "https://drive.example/result",
        levelTestResult: "상위권",
        principalReviewNote: "원장 분석 완료",
        principalPlacementChecked: true,
      },
    }),
    {
      testAtLabel: "레벨테스트 2026-05-25 14:30",
      materialLabel: "자료 연결",
      resultLabel: "결과 상위권",
      analysisLabel: "원장 분석 완료",
      placementLabel: "원장 반배정 완료",
    },
  );
});

test("registration completion requires principal analysis and manual placement without class recommendation", () => {
  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      type: "registration",
      status: "done",
      studentId: "student-1",
      classId: "class-1",
      textbookId: "book-1",
      registration: {
        pipelineStatus: "7. 등록 완료",
        classStartDate: "2026-05-25",
        classStartSession: "1회차",
        admissionNoticeSent: true,
        paymentChecked: true,
        makeeduRegistered: true,
        makeeduInvoiceSent: true,
        textbookBillingIssued: true,
      },
    }),
    ["원장 분석", "원장 반배정"],
  );

  assert.deepEqual(
    getOpsTaskBasicCompletionBlockers({
      type: "registration",
      status: "done",
      studentId: "student-1",
      classId: "class-1",
      textbookId: "book-1",
      registration: {
        pipelineStatus: "7. 등록 완료",
        classStartDate: "2026-05-25",
        classStartSession: "1회차",
        principalReviewNote: "원장 분석 완료",
        admissionNoticeSent: true,
        paymentChecked: true,
        makeeduRegistered: true,
        makeeduInvoiceSent: true,
        textbookBillingIssued: true,
      },
    }),
    ["원장 반배정"],
  );
});

test("withdrawal completion checklist keeps roster settlement and MakeEdu order", () => {
  const items = getWithdrawalCompletionChecklistItems({
    studentStatusUpdated: true,
    makeeduWithdrawalDone: true,
    feeProcessed: false,
    textbookFeeProcessed: true,
  });

  assert.deepEqual(
    items.map((item) => `${item.order}:${item.phase}:${item.label}:${item.checked}`),
    [
      "1:명단:시간표 명단 변경:false",
      "2:학생:학생 상태 변경:true",
      "3:메이크에듀:메이크에듀 퇴원처리:true",
      "4:정산:수업료 처리:false",
      "5:정산:교재비 처리:true",
    ],
  );

  assert.deepEqual(
    items.filter((item) => !item.auto && !item.checked).map((item) => item.label),
    ["수업료 처리"],
  );
});

test("transfer completion checklist keeps roster MakeEdu and settlement order", () => {
  const items = getTransferCompletionChecklistItems({
    timetableRosterUpdated: true,
    makeeduTransferDone: false,
    feeProcessed: true,
    textbookFeeProcessed: false,
  });

  assert.deepEqual(
    items.map((item) => `${item.order}:${item.phase}:${item.label}:${item.checked}`),
    [
      "1:명단:시간표 명단 변경:true",
      "2:메이크에듀:메이크에듀 전반처리:false",
      "3:정산:수업료 처리:true",
      "4:정산:교재비 처리:false",
    ],
  );

  assert.deepEqual(
    items.filter((item) => !item.auto && !item.checked).map((item) => item.label),
    ["메이크에듀 전반처리", "교재비 처리"],
  );
});

test("withdrawal and transfer completion sync previews show roster and student status work", () => {
  const students = [
    { id: "student-a", label: "김민수", classIds: ["from-class"], waitlistClassIds: [] },
  ];
  const classes = [
    { id: "from-class", label: "영어 고1", studentIds: ["student-a"], waitlistIds: [] },
    { id: "to-class", label: "영어 고2", studentIds: [], waitlistIds: [] },
  ];

  assert.deepEqual(
    getWithdrawalCompletionSyncItems({
      type: "withdrawal",
      studentId: "student-a",
      classId: "from-class",
    }, { students, classes }).map((item) => `${item.label}:${item.state}:${item.detail}`),
    [
      "수업명단:will_remove:김민수 · 영어 고1",
      "학생 상태:will_mark_withdrawn:김민수",
    ],
  );

  assert.deepEqual(
    getTransferCompletionSyncItems({
      type: "transfer",
      studentId: "student-a",
      transfer: {
        fromClassId: "from-class",
        toClassId: "to-class",
      },
    }, { students, classes }).map((item) => `${item.label}:${item.state}:${item.detail}`),
    [
      "전 수업명단:will_remove:김민수 · 영어 고1",
      "후 수업명단:will_add:김민수 · 영어 고2",
      "학생 상태:will_mark_active:김민수",
    ],
  );

  const unlinkedClasses = [
    { id: "from-class", label: "영어 고1", studentIds: [], waitlistIds: [] },
    { id: "to-class", label: "영어 고2", studentIds: [], waitlistIds: [] },
  ];
  const unlinkedStudents = [
    { id: "student-a", label: "김민수", classIds: [], waitlistClassIds: [] },
  ];

  assert.deepEqual(
    getWithdrawalCompletionSyncItems({
      type: "withdrawal",
      studentId: "student-a",
      classId: "from-class",
    }, { students: unlinkedStudents, classes: unlinkedClasses }).map((item) => `${item.label}:${item.state}:${item.detail}`),
    [
      "수업명단:missing:김민수 · 영어 고1",
      "학생 상태:will_mark_withdrawn:김민수",
    ],
  );

  assert.deepEqual(
    getTransferCompletionSyncItems({
      type: "transfer",
      studentId: "student-a",
      transfer: {
        fromClassId: "from-class",
        toClassId: "to-class",
      },
    }, { students: unlinkedStudents, classes: unlinkedClasses }).map((item) => `${item.label}:${item.state}:${item.detail}`),
    [
      "전 수업명단:missing:김민수 · 영어 고1",
      "후 수업명단:will_add:김민수 · 영어 고2",
      "학생 상태:will_mark_active:김민수",
    ],
  );
});

test("withdrawal and transfer completion review keeps final schedule settlement and textbook values visible", () => {
  assert.deepEqual(
    getWithdrawalCompletionReviewItems({
      type: "withdrawal",
      className: "영어 고1",
      withdrawal: {
        teacherName: "김선생",
        withdrawalDate: "2026-05-25",
        withdrawalSession: "7회차",
        completedLessonHours: "6",
        fourWeekLessonHours: "8",
        undistributedTextbooks: "독해, 문법",
        teacherOpinion: "퇴원 상담 완료",
      },
    }).map((item) => `${item.label}:${item.value}`),
    [
      "수업:영어 고1",
      "선생님:김선생",
      "퇴원 일정:2026-05-25 · 7회차",
      "정산 기준:진행 6 / 4주 8",
      "미배부 교재:독해, 문법",
      "선생님 의견:퇴원 상담 완료",
    ],
  );

  assert.deepEqual(
    getTransferCompletionReviewItems({
      type: "transfer",
      transfer: {
        fromClassName: "영어 고1",
        toClassName: "영어 고2",
        fromTeacherName: "김선생",
        toTeacherName: "박선생",
        fromClassEndDate: "2026-05-25",
        toClassStartDate: "2026-05-26",
        fromClassEndSession: "6회차",
        toClassStartSession: "7회차",
        fromUndistributedTextbooks: "독해",
        toUndistributedTextbooks: "문법",
      },
    }).map((item) => `${item.label}:${item.value}`),
    [
      "전 수업 종료:영어 고1 · 2026-05-25 · 6회차",
      "후 수업 시작:영어 고2 · 2026-05-26 · 7회차",
      "선생님:전 김선생 / 후 박선생",
      "미배부 교재:전 독해 / 후 문법",
    ],
  );
});

test("word retest completion review keeps execution teacher scope and score visible", () => {
  assert.deepEqual(
    getWordRetestCompletionReviewItems({
      type: "word_retest",
      className: "영어 고1",
      textbookTitle: "워드마스터",
      wordRetest: {
        teacherName: "김선생",
        branch: "별관",
        testAt: "2026-05-25T18:00:00+09:00",
        unit: "20강",
        retestStatus: "done",
        firstScore: "100",
      },
    }, { today: "2026-05-25" }).map((item) => `${item.label}:${item.value}`),
    [
      "수업:영어 고1",
      "선생님:김선생",
      "응시 일정:2026-05-25 · 별관",
      "범위:워드마스터 · 20강",
      "응시 결과:완료 · 1차 100",
    ],
  );
});

test("word retest execution stages split assistant queue work", () => {
  const today = "2026-05-25";

  assert.equal(
    getWordRetestExecutionStage({
      type: "word_retest",
      status: "requested",
      wordRetest: { testAt: "2026-05-25T18:00:00+09:00", retestStatus: "not_started" },
    }, { today }),
    "today",
  );

  assert.equal(
    getWordRetestExecutionStage({
      type: "word_retest",
      status: "in_progress",
      wordRetest: { testAt: "2026-05-25T18:00:00+09:00", retestStatus: "in_progress" },
    }, { today }),
    "in_progress",
  );

  assert.equal(
    getWordRetestExecutionStage({
      type: "word_retest",
      status: "confirmed",
      wordRetest: { testAt: "2026-05-24T18:00:00+09:00", retestStatus: "not_started" },
    }, { today }),
    "needs_score",
  );

  assert.equal(
    getWordRetestExecutionStage({
      type: "word_retest",
      status: "confirmed",
      wordRetest: { testAt: "2026-05-24T18:00:00+09:00", retestStatus: "absent" },
    }, { today }),
    "absent",
  );

  assert.equal(
    getWordRetestExecutionStage({
      type: "word_retest",
      status: "confirmed",
      wordRetest: { testAt: "2026-05-24T18:00:00+09:00", retestStatus: "not_started", firstScore: "90" },
    }, { today }),
    "in_progress",
  );

  assert.equal(
    getWordRetestExecutionStage({
      type: "word_retest",
      status: "done",
      wordRetest: { testAt: "2026-05-24T18:00:00+09:00", retestStatus: "done", firstScore: "90" },
    }, { today }),
    "done",
  );
});

test("word retest execution stage falls back to task due date when exam time is missing", () => {
  assert.equal(
    getWordRetestExecutionStage({
      type: "word_retest",
      status: "requested",
      dueAt: "2026-05-25T18:00:00+09:00",
      wordRetest: { retestStatus: "not_started" },
    }, { today: "2026-05-25" }),
    "today",
  );
});

test("word retest assistant queue prioritizes score entry and active exams", () => {
  const today = "2026-05-25";
  const tasks = [
    { id: "future", type: "word_retest", status: "requested", wordRetest: { testAt: "2026-05-28T18:00:00+09:00" } },
    { id: "today", type: "word_retest", status: "requested", wordRetest: { testAt: "2026-05-25T19:00:00+09:00" } },
    { id: "score", type: "word_retest", status: "confirmed", wordRetest: { testAt: "2026-05-24T19:00:00+09:00" } },
    { id: "progress", type: "word_retest", status: "in_progress", wordRetest: { testAt: "2026-05-25T18:00:00+09:00", retestStatus: "in_progress" } },
    { id: "absent", type: "word_retest", status: "confirmed", wordRetest: { testAt: "2026-05-24T18:00:00+09:00", retestStatus: "absent" } },
    { id: "done", type: "word_retest", status: "done", wordRetest: { testAt: "2026-05-24T18:00:00+09:00", retestStatus: "done", firstScore: "100" } },
  ];

  assert.deepEqual(
    sortWordRetestExecutionQueue(tasks, { today }).map((task) => task.id),
    ["score", "progress", "today", "absent", "future", "done"],
  );
});

test("word retest assistant queue sorts same-day exams by test time", () => {
  const today = "2026-05-25";
  const tasks = [
    { id: "later", title: "A 늦은 응시", type: "word_retest", status: "requested", wordRetest: { testAt: "2026-05-25T19:00:00+09:00" } },
    { id: "earlier", title: "Z 빠른 응시", type: "word_retest", status: "requested", wordRetest: { testAt: "2026-05-25T17:00:00+09:00" } },
  ];

  assert.deepEqual(
    sortWordRetestExecutionQueue(tasks, { today }).map((task) => task.id),
    ["earlier", "later"],
  );
});

test("word retest same-day past exams move into the score-entry queue", () => {
  const task = {
    id: "past-today",
    type: "word_retest",
    status: "confirmed",
    wordRetest: { testAt: "2026-05-25T17:00:00+09:00", retestStatus: "not_started" },
  };
  const options = { today: "2026-05-25", now: "2026-05-25T17:20:00+09:00" };

  assert.equal(getWordRetestExecutionStage(task, options), "needs_score");
  assert.equal(isWordRetestInExecutionQueue(task, "needs_score", options), true);
  assert.equal(isWordRetestInExecutionQueue(task, "today", options), false);
  assert.deepEqual(
    getWordRetestAssistantQuickActions(task, options),
    [
      { key: "quick_score", label: "점수 저장", kind: "quick_score", status: "done", retestStatus: "done", scoreField: "firstScore" },
      { key: "absent", label: "미응시", kind: "status", status: "confirmed", retestStatus: "absent", clearScores: true },
    ],
  );
});

test("word retest assistant all queue includes completed retests", () => {
  const task = {
    id: "done",
    type: "word_retest",
    status: "done",
    wordRetest: { testAt: "2026-05-24T18:00:00+09:00", retestStatus: "done", firstScore: "100" },
  };

  assert.equal(isWordRetestInExecutionQueue(task, "done", { today: "2026-05-25" }), true);
  assert.equal(isWordRetestInExecutionQueue(task, "all", { today: "2026-05-25" }), true);
  assert.equal(isWordRetestInExecutionQueue(task, "today", { today: "2026-05-25" }), false);
});

test("word retest completion without a score stays in the score entry queue", () => {
  const task = {
    id: "done-without-score",
    type: "word_retest",
    status: "confirmed",
    wordRetest: { testAt: "2026-05-24T18:00:00+09:00", retestStatus: "done" },
  };

  assert.equal(getWordRetestExecutionStage(task, { today: "2026-05-25" }), "needs_score");
  assert.equal(isWordRetestInExecutionQueue(task, "needs_score", { today: "2026-05-25" }), true);
  assert.equal(isWordRetestInExecutionQueue(task, "done", { today: "2026-05-25" }), false);
  assert.deepEqual(
    getWordRetestAssistantQuickActions(task, { today: "2026-05-25" }),
    [
      { key: "quick_score", label: "점수 저장", kind: "quick_score", status: "done", retestStatus: "done", scoreField: "firstScore" },
      { key: "absent", label: "미응시", kind: "status", status: "confirmed", retestStatus: "absent", clearScores: true },
    ],
  );

  assert.equal(
    getWordRetestExecutionStage({
      id: "closed-without-score",
      type: "word_retest",
      status: "done",
      wordRetest: { testAt: "2026-05-24T18:00:00+09:00", retestStatus: "not_started" },
    }, { today: "2026-05-25" }),
    "needs_score",
  );
});

test("word retest absent status stays in the absent queue after task closure", () => {
  const task = {
    id: "absent-done",
    type: "word_retest",
    status: "done",
    wordRetest: { testAt: "2026-05-24T18:00:00+09:00", retestStatus: "absent" },
  };

  assert.equal(getWordRetestExecutionStage(task, { today: "2026-05-25" }), "absent");
  assert.equal(isWordRetestInExecutionQueue(task, "absent", { today: "2026-05-25" }), true);
  assert.equal(isWordRetestInExecutionQueue(task, "done", { today: "2026-05-25" }), false);
});

test("word retest branch queue separates main and annex requests without splitting data", async () => {
  const { isWordRetestInBranchQueue } = await import("../src/features/tasks/ops-task-model.js");
  assert.equal(typeof isWordRetestInBranchQueue, "function");

  const mainBranchTask = {
    id: "main",
    type: "word_retest",
    campus: "본관",
    wordRetest: { branch: "본관", testAt: "2026-05-25T18:00:00+09:00" },
  };
  const annexBranchTask = {
    id: "annex",
    type: "word_retest",
    campus: "별관",
    word_retest: { branch: "별관", test_at: "2026-05-25T18:00:00+09:00" },
  };

  assert.equal(isWordRetestInBranchQueue(mainBranchTask, "all"), true);
  assert.equal(isWordRetestInBranchQueue(mainBranchTask, "본관"), true);
  assert.equal(isWordRetestInBranchQueue(mainBranchTask, "별관"), false);
  assert.equal(isWordRetestInBranchQueue(annexBranchTask, "본관"), false);
  assert.equal(isWordRetestInBranchQueue(annexBranchTask, "별관"), true);
  assert.equal(isWordRetestInBranchQueue({ id: "general", type: "general" }, "본관"), false);
});

test("word retest workflow presets set date and branch together", () => {
  assert.equal(typeof opsTaskModel.buildWordRetestWorkflowPresetPatch, "function");

  assert.deepEqual(
    opsTaskModel.buildWordRetestWorkflowPresetPatch("today_main", {
      dueTodayValue: "2026-05-25T09:00",
      dueTomorrowValue: "2026-05-26T09:00",
    }),
    {
      testAt: "2026-05-25T09:00",
      branch: "본관",
    },
  );

  assert.deepEqual(
    opsTaskModel.buildWordRetestWorkflowPresetPatch("tomorrow_annex", {
      dueTodayValue: "2026-05-25T09:00",
      dueTomorrowValue: "2026-05-26T09:00",
    }),
    {
      testAt: "2026-05-26T09:00",
      branch: "별관",
    },
  );
});

test("word retest assistant queue exposes one-click execution actions", () => {
  const today = "2026-05-25";

  assert.deepEqual(
    getWordRetestAssistantQuickActions({
      type: "word_retest",
      status: "requested",
      wordRetest: { testAt: "2026-05-25T18:00:00+09:00", retestStatus: "not_started" },
    }, { today }),
    [
      { key: "start", label: "응시 시작", kind: "status", status: "in_progress", retestStatus: "in_progress" },
      { key: "absent", label: "미응시", kind: "status", status: "confirmed", retestStatus: "absent", clearScores: true },
    ],
  );

  assert.deepEqual(
    getWordRetestAssistantQuickActions({
      type: "word_retest",
      status: "in_progress",
      wordRetest: { testAt: "2026-05-25T18:00:00+09:00", retestStatus: "in_progress" },
    }, { today }),
    [
      { key: "quick_score", label: "점수 저장", kind: "quick_score", status: "done", retestStatus: "done", scoreField: "firstScore" },
      { key: "absent", label: "미응시", kind: "status", status: "confirmed", retestStatus: "absent", clearScores: true },
    ],
  );

  assert.deepEqual(
    getWordRetestAssistantQuickActions({
      type: "word_retest",
      status: "confirmed",
      wordRetest: { testAt: "2026-05-24T18:00:00+09:00", retestStatus: "not_started" },
    }, { today }),
    [
      { key: "quick_score", label: "점수 저장", kind: "quick_score", status: "done", retestStatus: "done", scoreField: "firstScore" },
      { key: "absent", label: "미응시", kind: "status", status: "confirmed", retestStatus: "absent", clearScores: true },
    ],
  );

  assert.deepEqual(
    getWordRetestAssistantQuickActions({
      type: "word_retest",
      status: "in_progress",
      wordRetest: { testAt: "2026-05-25T18:00:00+09:00", retestStatus: "in_progress", firstScore: "90" },
    }, { today }),
    [
      { key: "score", label: "점수 수정", kind: "edit_scores" },
      { key: "done", label: "완료", kind: "status", status: "done", retestStatus: "done" },
    ],
  );

  assert.deepEqual(
    getWordRetestAssistantQuickActions({
      type: "word_retest",
      status: "done",
      wordRetest: { testAt: "2026-05-24T18:00:00+09:00", retestStatus: "done", firstScore: "100" },
    }, { today }),
    [],
  );
});

test("word retest assistant actions build one safe execution patch", () => {
  const task = {
    type: "word_retest",
    status: "in_progress",
    wordRetest: {
      retestStatus: "in_progress",
      firstScore: "",
      secondScore: "95",
      thirdScore: "",
    },
  };

  assert.deepEqual(
    buildWordRetestAssistantActionPatch(task, {
      key: "quick_score",
      label: "점수 저장",
      kind: "quick_score",
      status: "done",
      retestStatus: "done",
      scoreField: "firstScore",
      score: "100",
    }),
    {
      status: "done",
      wordRetest: {
        retestStatus: "done",
        firstScore: "100",
        secondScore: "95",
        thirdScore: "",
      },
    },
  );

  assert.equal(
    buildWordRetestAssistantActionPatch(task, {
      key: "quick_score",
      label: "점수 저장",
      kind: "quick_score",
      status: "done",
      retestStatus: "done",
      scoreField: "firstScore",
      score: "",
    }),
    null,
  );

  assert.deepEqual(
    buildWordRetestAssistantActionPatch(task, {
      key: "absent",
      label: "미응시",
      kind: "status",
      status: "confirmed",
      retestStatus: "absent",
      clearScores: true,
    }),
    {
      status: "confirmed",
      wordRetest: {
        retestStatus: "absent",
        firstScore: "",
        secondScore: "",
        thirdScore: "",
      },
    },
  );
});

test("word retest execution summary exposes stage score and branch for assistant scan", () => {
  const today = "2026-05-25";
  assert.equal(typeof opsTaskModel.getWordRetestExecutionSummary, "function");

  assert.deepEqual(
    opsTaskModel.getWordRetestExecutionSummary({
      type: "word_retest",
      status: "confirmed",
      campus: "별관",
      wordRetest: {
        testAt: "2026-05-24T18:00:00+09:00",
        retestStatus: "not_started",
        teacherName: "박선생",
        textbookTitle: "워드마스터",
        unit: "20강",
      },
    }, { today }),
    {
      stage: "needs_score",
      stageLabel: "점수 입력",
      scoreLabel: "점수 없음",
      branchLabel: "별관",
      testAtLabel: "응시 2026-05-24 18:00",
      teacherLabel: "박선생",
      scopeLabel: "워드마스터 · 20강",
    },
  );

  assert.deepEqual(
    opsTaskModel.getWordRetestExecutionSummary({
      type: "word_retest",
      status: "confirmed",
      campus: "본관",
      word_retest: {
        test_at: "2026-05-25T18:00:00+09:00",
        first_score: "90",
        secondScore: "95",
        teacher_name: "이선생",
        textbook_name: "뜯어먹는 영단어",
        unit: "Day 7",
      },
    }, { today }),
    {
      stage: "in_progress",
      stageLabel: "진행 중",
      scoreLabel: "1차 90 · 2차 95",
      branchLabel: "본관",
      testAtLabel: "응시 2026-05-25 18:00",
      teacherLabel: "이선생",
      scopeLabel: "뜯어먹는 영단어 · Day 7",
    },
  );

  assert.equal(opsTaskModel.getWordRetestExecutionSummary({ type: "general" }, { today }), null);
});

test("word retest absent tasks can be copied into a teacher rerequest draft", () => {
  const draft = buildWordRetestRerequestDraft({
    id: "word-1",
    title: "김민수 단어 재시험",
    type: "word_retest",
    status: "confirmed",
    priority: "high",
    assigneeId: "teacher-1",
    studentId: "student-1",
    studentName: "김민수",
    classId: "class-1",
    className: "영어 고1",
    textbookId: "book-1",
    textbookTitle: "워드마스터",
    campus: "본관",
    subject: "영어",
    wordRetest: {
      branch: "본관",
      teacherId: "teacher-1",
      teacherName: "임선생",
      textbookName: "워드마스터",
      unit: "Unit 3",
      testAt: "2026-05-24T18:00:00+09:00",
      retestStatus: "absent",
      requestNote: "숙제 미제출",
    },
  }, { nextTestAt: "2026-05-26T18:00" });

  assert.deepEqual(draft, {
    title: "김민수 단어 재시험 재요청",
    type: "word_retest",
    status: "requested",
    priority: "high",
    assigneeId: "teacher-1",
    secondaryAssigneeId: "",
    studentId: "student-1",
    studentName: "김민수",
    classId: "class-1",
    className: "영어 고1",
    textbookId: "book-1",
    textbookTitle: "워드마스터",
    campus: "본관",
    subject: "영어",
    dueAt: "2026-05-26T18:00",
    memo: "",
    wordRetest: {
      branch: "본관",
      teacherId: "teacher-1",
      teacherName: "임선생",
      textbookName: "워드마스터",
      unit: "Unit 3",
      testAt: "2026-05-26T18:00",
      retestStatus: "not_started",
      firstScore: "",
      secondScore: "",
      thirdScore: "",
      requestNote: "미응시 재요청 · 2026-05-24 · 숙제 미제출",
    },
  });

  assert.equal(buildWordRetestRerequestDraft({ type: "word_retest", wordRetest: { retestStatus: "done" } }), null);
});

test("word retest rerequest draft keeps the previous due date when exam time is missing", () => {
  const draft = buildWordRetestRerequestDraft({
    title: "김민수 단어 재시험",
    type: "word_retest",
    status: "confirmed",
    dueAt: "2026-05-24T18:00:00+09:00",
    studentName: "김민수",
    wordRetest: {
      retestStatus: "absent",
      requestNote: "결석",
    },
  }, { nextTestAt: "2026-05-26T18:00" });

  assert.equal(draft?.wordRetest.requestNote, "미응시 재요청 · 2026-05-24 · 결석");
});

test("word retest rerequest draft preserves synced branch without using teacher catalog id as assignee", () => {
  const draft = buildWordRetestRerequestDraft({
    title: "이서연 단어 재시험",
    type: "word_retest",
    status: "confirmed",
    student_id: "student-2",
    class_id: "class-2",
    textbook_id: "book-2",
    word_retest: {
      branch_name: "별관",
      teacher_id: "teacher-catalog-2",
      teacher_name: "박선생",
      class_name: "영어 중2",
      student_name: "이서연",
      textbook_name: "뜯어먹는 영단어",
      unit: "Day 7",
      test_at: "2026-05-24T18:30:00+09:00",
      retest_status: "absent",
      request_note: "결석",
    },
  }, { nextTestAt: "2026-05-26T18:00" });

  assert.equal(draft?.assigneeId, "");
  assert.equal(draft?.campus, "별관");
  assert.equal(draft?.wordRetest.branch, "별관");
  assert.equal(draft?.wordRetest.teacherId, "teacher-catalog-2");
  assert.equal(draft?.wordRetest.teacherName, "박선생");
  assert.equal(draft?.wordRetest.requestNote, "미응시 재요청 · 2026-05-24 · 결석");
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
        phoneConsultationAt: "2026-05-21T11:00:00+09:00",
        visitConsultationAt: "2026-05-21T19:00:00+09:00",
        levelTestAt: "2026-05-23T14:00:00+09:00",
        classStartDate: "2026-05-29",
      },
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
      "registration-1:방문상담:2026-05-21",
      "registration-1:전화상담:2026-05-21",
      "registration-1:예정:2026-05-22",
      "registration-1:레벨테스트:2026-05-23",
      "withdrawal-1:퇴원일:2026-05-24",
      "transfer-1:전 수업 종료:2026-05-25",
      "word-1:응시:2026-05-26",
      "transfer-1:후 수업 시작:2026-05-27",
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

test("basic confirmation candidates include requested operations and blocked final steps", () => {
  assert.equal(typeof opsTaskModel.isOpsTaskBasicConfirmationCandidate, "function");

  assert.equal(
    opsTaskModel.isOpsTaskBasicConfirmationCandidate({
      type: "registration",
      status: "requested",
      registration: { pipelineStatus: "0. 등록 문의" },
    }),
    true,
  );

  assert.equal(
    opsTaskModel.isOpsTaskBasicConfirmationCandidate({
      type: "withdrawal",
      status: "in_progress",
      withdrawal: { withdrawalDate: "2026-05-25" },
    }),
    true,
  );

  assert.equal(
    opsTaskModel.isOpsTaskBasicConfirmationCandidate({
      type: "registration",
      status: "confirmed",
      registration: { pipelineStatus: "6. 수납 진행 중" },
    }),
    true,
  );

  assert.equal(opsTaskModel.isOpsTaskBasicConfirmationCandidate({ type: "general", status: "requested" }), false);
  assert.equal(opsTaskModel.isOpsTaskBasicConfirmationCandidate({ type: "transfer", status: "done" }), false);
});

test("basic confirmation candidates use class plan blockers from dashboard data", () => {
  const task = {
    type: "transfer",
    status: "in_progress",
    studentId: "student-a",
    transfer: {
      fromClassId: "from-class",
      toClassId: "to-class",
      fromClassEndDate: "2026-05-25",
      toClassStartDate: "2026-05-26",
      fromClassEndSession: "6회차",
      toClassStartSession: "7회차",
      makeeduTransferDone: true,
      feeProcessed: true,
      textbookFeeProcessed: true,
    },
  };

  assert.equal(
    opsTaskModel.isOpsTaskBasicConfirmationCandidate(task, {
      classes: [
        { id: "from-class", sessionCount: 8, plannedSessionCount: 8, textbookIds: ["book-a"] },
        { id: "to-class", sessionCount: 8, plannedSessionCount: 5, textbookIds: ["book-b"] },
      ],
    }),
    true,
  );
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
      wordRetest: { teacherId: "me", retestStatus: "done", firstScore: "100" },
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
      registration: { phoneConsultationAt: "2026-05-21T14:00:00+09:00" },
    },
    {
      id: "registration-visit-today",
      title: "registration visit today",
      type: "registration",
      status: "confirmed",
      registration: { visitConsultationAt: "2026-05-21T19:00:00+09:00" },
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
      wordRetest: { testAt: "2026-05-21T18:00:00+09:00", retestStatus: "done", firstScore: "100" },
    },
  ];

  assert.equal(hasOpsTaskCalendarDate(tasks[0], "2026-05-21"), true);

  const summary = summarizeOpsTasks(tasks, {
    now: new Date("2026-05-21T09:00:00+09:00"),
  });

  assert.equal(summary.todayDue, 4);
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
      wordRetest: { testAt: "2026-05-20T18:00:00+09:00", retestStatus: "done", firstScore: "100" },
    },
  ];

  assert.equal(hasOpsTaskOverdueCalendarDate(tasks[0], "2026-05-21"), true);

  const summary = summarizeOpsTasks(tasks, {
    now: new Date("2026-05-21T09:00:00+09:00"),
  });

  assert.equal(summary.overdue, 3);
});

test("ops task summary keeps actionable closed word retests in todo signals", () => {
  const tasks = [
    {
      id: "closed-needs-score",
      title: "점수 누락",
      type: "word_retest",
      status: "done",
      wordRetest: { testAt: "2026-05-20T18:00:00+09:00", retestStatus: "done" },
    },
    {
      id: "closed-absent",
      title: "미응시",
      type: "word_retest",
      status: "done",
      wordRetest: { testAt: "2026-05-21T18:00:00+09:00", retestStatus: "absent" },
    },
    {
      id: "closed-scored",
      title: "완료",
      type: "word_retest",
      status: "done",
      wordRetest: { testAt: "2026-05-20T18:00:00+09:00", retestStatus: "done", firstScore: "100" },
    },
  ];

  assert.equal(typeof isOpsTaskActionable, "function");
  assert.equal(isClosedOpsTask(tasks[0]), true);
  assert.equal(isOpsTaskActionable(tasks[0], { today: "2026-05-21" }), true);
  assert.equal(isOpsTaskActionable(tasks[1], { today: "2026-05-21" }), true);
  assert.equal(isOpsTaskActionable(tasks[2], { today: "2026-05-21" }), false);
  assert.equal(hasOpsTaskOverdueCalendarDate(tasks[0], "2026-05-21"), true);
  assert.equal(hasOpsTaskCalendarDate(tasks[1], "2026-05-21"), true);

  const summary = summarizeOpsTasks(tasks, {
    now: new Date("2026-05-21T09:00:00+09:00"),
  });

  assert.equal(summary.todayDue, 1);
  assert.equal(summary.overdue, 1);
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
        ...(index === 5 ? { retestStatus: "done", firstScore: "100" } : {}),
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
          pipelineStatus: "5. 등록 신청",
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
      ? { ...task.wordRetest, retestStatus: "done", firstScore: "100" }
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
