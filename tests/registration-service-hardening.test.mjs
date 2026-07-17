import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

const [serviceSource, sampleWorkflowSource, browserWorkflowSource, inquiryChannelMigrationSource] = await Promise.all([
  readFile(new URL("../src/features/tasks/ops-task-service.ts", import.meta.url), "utf8"),
  readFile(new URL("../scripts/verify-ops-task-sample-workflow.mjs", import.meta.url), "utf8"),
  readFile(new URL("../scripts/verify-ops-task-browser-workflow.mjs", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260711123928_drop_registration_inquiry_channel.sql", import.meta.url), "utf8"),
]);

function sourceBetween(start, end) {
  const startIndex = serviceSource.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  const endIndex = serviceSource.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return serviceSource.slice(startIndex, endIndex);
}

function assertInOrder(source, markers) {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.notEqual(next, -1, `missing ordered marker: ${marker}`);
    assert.ok(next > cursor, `${marker} must appear after the previous write`);
    cursor = next;
  }
}

function assertIncludesAll(source, snippets) {
  for (const snippet of snippets) assert.ok(source.includes(snippet), `missing source contract: ${snippet}`);
}

function loadRegistrationIdentityMatcher() {
  const textSource = sourceBetween(
    "function text(value: unknown)",
    "function bool(value: unknown)",
  );
  const matcherSource = sourceBetween(
    "function matchesOpsRegistrationStudent",
    "async function resolveOpsRegistrationStudent",
  );
  const compiled = ts.transpileModule(
    `${textSource}\n${matcherSource}\nmodule.exports = { matchesOpsRegistrationStudent }`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports });
  return sandboxModule.exports.matchesOpsRegistrationStudent;
}

function loadUpdateRegistrationOpsTaskWithMocks(mocks) {
  const updateSource = sourceBetween(
    "async function updateRegistrationOpsTask",
    "export async function updateOpsTask",
  );
  const compiled = ts.transpileModule(
    `${updateSource}\nmodule.exports = { updateRegistrationOpsTask }`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    ...mocks,
  });
  return sandboxModule.exports.updateRegistrationOpsTask;
}

function loadRegistrationProjectionRollbackWithMocks(mocks) {
  const rollbackSource = sourceBetween(
    "async function prepareRegistrationProjectionRollback",
    "async function prepareOpsCompletionStatusRollback",
  );
  const compiled = ts.transpileModule(
    `${rollbackSource}\nmodule.exports = { prepareRegistrationProjectionRollback }`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    ...mocks,
  });
  return sandboxModule.exports.prepareRegistrationProjectionRollback;
}

function loadRegistrationCompletionRollbackWithMocks(mocks) {
  const rollbackSource = sourceBetween(
    "async function rollbackOpsRegistrationCompletionSync",
    "async function rollbackOpsTransferCompletionSync",
  );
  const compiled = ts.transpileModule(
    `${rollbackSource}\nmodule.exports = { rollbackOpsRegistrationCompletionSync }`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    ...mocks,
  });
  return sandboxModule.exports.rollbackOpsRegistrationCompletionSync;
}

function loadRegistrationManagementSyncWithMocks(mocks) {
  const syncSource = sourceBetween(
    "async function syncRegistrationManagementLinks",
    "async function markWithdrawalRosterUpdated",
  );
  const compiled = ts.transpileModule(
    `${syncSource}\nmodule.exports = { syncRegistrationManagementLinks }`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    ...mocks,
  });
  return sandboxModule.exports.syncRegistrationManagementLinks;
}

function loadCreatedTaskCleanupWithMocks(mocks) {
  const cleanupSource = sourceBetween(
    "async function deleteCreatedOpsTaskOnFailure",
    "function attachOpsTaskCleanupError",
  );
  const compiled = ts.transpileModule(
    `${cleanupSource}\nmodule.exports = { deleteCreatedOpsTaskOnFailure }`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    ...mocks,
  });
  return sandboxModule.exports.deleteCreatedOpsTaskOnFailure;
}

function loadWaitlistDeleteClassResolverWithMocks(mocks) {
  const resolverSource = sourceBetween(
    "async function resolveRegistrationWaitlistClassForDelete",
    "async function removeRegistrationWaitlistOnDelete",
  );
  const compiled = ts.transpileModule(
    `${resolverSource}\nmodule.exports = { resolveRegistrationWaitlistClassForDelete }`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    ...mocks,
  });
  return sandboxModule.exports.resolveRegistrationWaitlistClassForDelete;
}

function loadWaitlistDeleteRollbackWithMocks(mocks) {
  const rollbackSource = sourceBetween(
    "async function rollbackRegistrationWaitlistRemovalAfterFailure",
    "async function resolveRegistrationWaitlistClassForDelete",
  );
  const compiled = ts.transpileModule(
    `${rollbackSource}\nmodule.exports = { rollbackRegistrationWaitlistRemovalAfterFailure }`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    ...mocks,
  });
  return sandboxModule.exports.rollbackRegistrationWaitlistRemovalAfterFailure;
}

test("registration identity matching rejects a persisted student with a different name or contact", () => {
  const matches = loadRegistrationIdentityMatcher();
  const input = {
    studentName: "김다미",
    registration: {
      schoolName: "중앙여고",
      studentPhone: "010-1111-2222",
      parentPhone: "010-3333-4444",
    },
  };

  assert.equal(matches({
    name: "김다미",
    school: "중앙여고",
    contact: "01011112222",
    parent_contact: "01033334444",
  }, input), true);
  assert.equal(matches({
    name: "동명이인",
    school: "중앙여고",
    contact: "010-1111-2222",
    parent_contact: "010-3333-4444",
  }, input), false);
  assert.equal(matches({
    name: "김다미",
    school: "중앙여고",
    contact: "010-9999-9999",
    parent_contact: "010-3333-4444",
  }, input), false);
});

test("registration lookup never falls back to an arbitrary same-name row and revalidates a persisted id", () => {
  const findByNameSource = sourceBetween(
    "async function findOpsStudentByName",
    "async function resolveOpsStudent",
  );
  const resolverSource = sourceBetween(
    "async function resolveOpsRegistrationStudent",
    "async function ensureOpsStudent",
  );
  const deleteCleanupSource = sourceBetween(
    "async function removeRegistrationWaitlistOnDelete",
    "export async function deleteOpsTask",
  );
  const syncSource = sourceBetween(
    "async function syncRegistrationManagementLinks",
    "async function markWithdrawalRosterUpdated",
  );

  assert.match(findByNameSource, /input\.type === "registration"/);
  assert.match(findByNameSource, /matchesOpsRegistrationStudent\(row, input\)/);
  assert.match(resolverSource, /byId && matchesOpsRegistrationStudent\(byId, input\)/);
  assert.match(resolverSource, /if \(persistedStudentId\)/);
  assert.match(resolverSource, /throw new Error\("연결된 학생 정보가 등록 문의 정보와 일치하지 않습니다\."\)/);
  assert.match(deleteCleanupSource, /const student = await resolveOpsRegistrationStudent\(input\)/);
  assert.match(syncSource, /const linkedStudent = shouldEnsureStudent \? existingStudent : await resolveOpsRegistrationStudent\(input\)/);
  assert.doesNotMatch(syncSource, /: await resolveOpsStudent\(input\)/);
});

test("준비 모드 명단 변경은 원자 RPC를 사용하고 유지보수 상태에서는 실패 폐쇄한다", () => {
  const assignSource = sourceBetween(
    "async function assignOpsStudentToClass",
    "async function assignOpsStudentToWaitlist",
  );
  const waitlistSource = sourceBetween(
    "async function assignOpsStudentToWaitlist",
    "async function assignOpsTextbookToClass",
  );
  const removeSource = sourceBetween(
    "async function removeOpsStudentFromClass",
    "async function setOpsStudentStatus",
  );
  const updateSource = sourceBetween(
    "export async function updateOpsTask",
    "async function updateOpsTaskStatusRow",
  );
  const statusSource = sourceBetween(
    "export async function updateOpsTaskStatus",
    "async function rollbackRegistrationWaitlistRemovalAfterFailure",
  );

  assertIncludesAll(serviceSource, [
    "probeRegistrationSubjectTrackRuntime",
    "invalidateRegistrationSubjectTrackRuntimeAfterReadyFailure",
    "set_student_class_roster_mode",
    "complete_ops_withdrawal_roster_transition",
    "complete_ops_transfer_roster_transition",
    "데이터 전환 중",
  ]);
  assert.match(assignSource, /applyReadyOpsRosterMode[\s\S]*?"enrolled"[\s\S]*?previousMode \|\| "removed"/);
  assert.match(waitlistSource, /applyReadyOpsRosterMode[\s\S]*?"waitlist"[\s\S]*?previousMode \|\| "removed"/);
  assert.match(removeSource, /applyReadyOpsRosterMode[\s\S]*?"removed"[\s\S]*?previousMode \|\| "removed"/);
  assert.match(updateSource, /completeReadyOpsRosterTransition\(taskId, input\.type\)/);
  assert.match(serviceSource, /function getReadyOpsCompletionInput[\s\S]*?timetableRosterUpdated:\s*false/);
  assert.match(
    updateSource,
    /const producerInput = nextStatus === "done"[\s\S]*?getReadyOpsCompletionInput\(\{ \.\.\.input, status: existingTask\.status \}\)/,
  );
  assert.match(updateSource, /p_input: buildOpsTaskProducerInput\(producerInput\)/);
  assert.match(statusSource, /completeReadyOpsRosterTransition\(currentTask\.id, currentTask\.type\)/);
  assert.match(statusSource, /currentTask\.type === "registration"[\s\S]*?getOpsRosterRuntimeState\(\)[\s\S]*?runtime\.mode !== "legacy"/);
  assert.match(serviceSource, /stagesReadyOpsRosterCompletion[\s\S]*?completeReadyOpsRosterTransition\(taskId, input\.type\)/);
  assert.doesNotMatch(serviceSource, /completeReadyOpsRosterTransition\(taskId, input\.type\)[\s\S]{0,300}?write(?:Committed)?Event\(taskId, "created"/);
  assert.match(serviceSource, /p_request_key:\s*`ops-\$\{type\}-completion-\$\{taskId\}`/);
  assert.match(updateSource, /input\.type === "registration"[\s\S]*?getOpsRosterRuntimeState\(\)[\s\S]*?runtime\.mode !== "legacy"/);
  assert.match(updateSource, /과목별 등록 화면에서 변경하세요/);
  assertInOrder(updateSource, [
    'if (input.type === "registration")',
    "await getOpsRosterRuntimeState()",
    "await updateRegistrationOpsTask(taskId, input, existingTask)",
  ]);
});

test("registration terminal form updates write child state while the parent is open", () => {
  const updateSource = sourceBetween(
    "async function updateRegistrationOpsTask",
    "export async function updateOpsTask",
  );
  const rollbackSource = sourceBetween(
    "async function rollbackRegistrationUpdate",
    "async function updateRegistrationOpsTask",
  );
  const projectionRollbackSource = sourceBetween(
    "async function prepareRegistrationProjectionRollback",
    "async function prepareOpsCompletionStatusRollback",
  );
  const publicUpdateSource = sourceBetween(
    "export async function updateOpsTask",
    "export async function updateOpsTaskStatus",
  );

  assert.match(publicUpdateSource, /if \(input\.type === "registration"\)/);
  assert.match(publicUpdateSource, /await updateRegistrationOpsTask\(taskId, input, existingTask\)/);
  assert.match(updateSource, /const reopensTerminalTask/);
  assert.match(updateSource, /parentWriteOrder: "last"/);
  assert.match(updateSource, /parentWriteOrder: "first"/);
  assertInOrder(updateSource, [
    "await prepareRegistrationProjectionRollback",
    "await applyRegistrationTaskChildren",
    "await updateRegistrationTaskParent",
  ]);
  assertInOrder(rollbackSource, [
    'parentWriteOrder === "first"',
    "await captureRollback(() => updateRegistrationTaskParent",
    "await captureRollback(() => rollbackRegistrationProjection())",
  ]);
  assert.doesNotMatch(rollbackSource, /restoreRegistrationTaskChildren/);
  assertIncludesAll(projectionRollbackSource, [
    "previousStudent",
    "targetStudent",
    "previousClass",
    "targetClass",
    "deleteOpsRegistrationCreatedStudent",
    "restoreOpsRegistrationStudentSnapshot",
    "restoreOpsClassRosterSnapshot",
    "restoreOpsClassTextbookSnapshot",
    "assertRegistrationProjectionSnapshotsRestored",
    "writeRegistrationProjectionRollbackHistory",
    "restoreOpsTaskLinkSnapshot",
    "restoreOpsTaskDetailSnapshot",
    'writeEvent(task.id, "rollback", "등록 저장"',
  ]);
});

test("registration waitlist update prepares an exact rollback before creating or linking a student", async () => {
  const calls = [];
  const rollbackProjection = async () => calls.push("projection-rollback");
  const updateRegistrationOpsTask = loadUpdateRegistrationOpsTaskWithMocks({
    prepareRegistrationProjectionRollback: async () => {
      calls.push("prepare");
      return { createdStudentId: "created-student-1", rollback: rollbackProjection };
    },
    applyRegistrationTaskChildren: async () => calls.push("children"),
    updateRegistrationTaskParent: async () => {
      calls.push("parent");
      throw new Error("parent failed");
    },
    rollbackRegistrationUpdate: async (_taskId, _existingTask, error, rollback) => {
      calls.push("rollback");
      assert.equal(error.message, "parent failed");
      await rollback();
    },
  });

  await assert.rejects(
    updateRegistrationOpsTask(
      "task-1",
      { type: "registration", status: "in_progress", registration: { pipelineStatus: "4-1. 현재반 대기 신청" } },
      { id: "task-1", type: "registration", status: "requested", registration: { pipelineStatus: "0. 등록 문의" } },
    ),
    /parent failed/,
  );
  assert.deepEqual(calls, ["prepare", "children", "parent", "rollback", "projection-rollback"]);
});

test("registration projection rollback deletes only its preallocated student id", async () => {
  const calls = [];
  const targetClass = { id: "class-new", student_ids: [], waitlist_ids: [], textbook_ids: [] };
  const prepareRegistrationProjectionRollback = loadRegistrationProjectionRollbackWithMocks({
    supabase: {},
    inputFromTask: () => ({ type: "registration", studentId: "", classId: "" }),
    text: (value) => String(value || "").trim(),
    selectOpsRowById: async () => null,
    resolveOpsRegistrationStudent: async () => null,
    resolveOpsClass: async (classId) => classId === "class-new" ? targetClass : null,
    uniqueOpsRowsById: (rows) => rows.filter(Boolean),
    shouldEnsureRegistrationStudent: () => true,
    isRegistrationWorkflowComplete: () => false,
    createOpsId: () => "created-student-fixed",
    getRegistrationProjectionRollbackHistory: async () => [],
    restoreOpsRegistrationStudentSnapshot: async () => calls.push("restore-student"),
    restoreOpsClassRosterSnapshot: async (classId) => calls.push(`restore-roster:${classId}`),
    restoreOpsClassTextbookSnapshot: async (classId) => calls.push(`restore-textbook:${classId}`),
    throwFirstRejectedRollback: (results) => {
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected) throw rejected.reason;
    },
    deleteOpsRegistrationCreatedStudent: async (student, shouldDelete) => calls.push(`delete:${student?.id}:${shouldDelete}`),
    assertRegistrationProjectionSnapshotsRestored: async (_students, _classes, createdStudentId) => calls.push(`verify:${createdStudentId}`),
    restoreOpsTaskLinkSnapshot: async () => calls.push("restore-links"),
    restoreOpsTaskDetailSnapshot: async () => calls.push("restore-detail"),
    writeRegistrationProjectionRollbackHistory: async () => calls.push("rollback-history"),
    writeEvent: async () => calls.push("rollback-event"),
  });

  const prepared = await prepareRegistrationProjectionRollback(
    { id: "task-1", type: "registration", studentId: "", classId: "" },
    { type: "registration", studentId: "", classId: "class-new", registration: { pipelineStatus: "4-1. 현재반 대기 신청" } },
  );
  assert.equal(prepared.createdStudentId, "created-student-fixed");
  await prepared.rollback();
  assert.deepEqual(calls, [
    "restore-roster:class-new",
    "restore-textbook:class-new",
    "delete:created-student-fixed:true",
    "verify:created-student-fixed",
    "restore-links",
    "restore-detail",
    "rollback-history",
    "rollback-event",
  ]);
});

test("registration completion arms rollback before any child write", () => {
  const publicUpdateSource = sourceBetween(
    "export async function updateOpsTask",
    "export async function updateOpsTaskStatus",
  );
  const registrationUpdateSource = sourceBetween(
    "async function updateRegistrationOpsTask",
    "export async function updateOpsTask",
  );

  assertInOrder(publicUpdateSource, [
    'if (input.type === "registration")',
    "await updateRegistrationOpsTask",
    "return",
    'if (nextStatus === "done")',
  ]);
  assertInOrder(registrationUpdateSource, [
    "await prepareRegistrationProjectionRollback",
    "try {",
    "await applyRegistrationTaskChildren",
    "await updateRegistrationTaskParent",
  ]);
  assert.match(registrationUpdateSource, /catch \(error\) \{[\s\S]*rollbackRegistrationUpdate[\s\S]*throw error/);
});

test("registration completion rolls detail projection back when a later write fails", async () => {
  const calls = [];
  const rollbackSnapshot = async () => calls.push("rollback-snapshot");
  const updateRegistrationOpsTask = loadUpdateRegistrationOpsTaskWithMocks({
    prepareRegistrationProjectionRollback: async () => {
      calls.push("prepare");
      return { createdStudentId: "created-student-1", rollback: rollbackSnapshot };
    },
    applyRegistrationTaskChildren: async () => calls.push("detail-projection"),
    updateRegistrationTaskParent: async () => {
      calls.push("parent");
      throw new Error("parent write failed");
    },
    rollbackRegistrationUpdate: async (_taskId, _existingTask, originalError, rollback) => {
      calls.push("rollback");
      assert.equal(originalError.message, "parent write failed");
      await rollback();
    },
  });

  await assert.rejects(
    updateRegistrationOpsTask(
      "task-1",
      { type: "registration", status: "done", title: "등록", registration: { pipelineStatus: "7. 등록 완료" } },
      { id: "task-1", type: "registration", status: "in_progress", title: "등록", registration: { pipelineStatus: "6. 수납 확인" } },
    ),
    /parent write failed/,
  );
  assert.deepEqual(calls, [
    "prepare",
    "detail-projection",
    "parent",
    "rollback",
    "rollback-snapshot",
  ]);
});

test("registration status updates synchronize the pipeline before closing the parent and reopen the parent first", () => {
  const helperSource = sourceBetween(
    "async function updateRegistrationOpsTaskStatus",
    "export async function updateOpsTaskStatus",
  );
  const publicStatusSource = sourceBetween(
    "export async function updateOpsTaskStatus",
    "async function removeRegistrationWaitlistOnDelete",
  );

  assert.match(publicStatusSource, /currentTask\.type === "registration"/);
  assert.match(publicStatusSource, /await updateRegistrationOpsTaskStatus\(currentTask, status\)/);
  assert.match(publicStatusSource, /return/);
  assert.match(helperSource, /const reopensTerminalTask/);
  assert.match(helperSource, /await updateRegistrationOpsTask\(currentTask\.id, nextInput, currentTask\)/);
  assert.match(helperSource, /if \(reopensTerminalTask\)/);
  assert.match(helperSource, /const nextPipelineStatus = getRegistrationPipelineStatusForTaskStatus\(status, currentTask\.registration\?\.pipelineStatus\)/);
  assert.match(helperSource, /pipelineStatus: nextPipelineStatus/);
  assertInOrder(helperSource, [
    "rollbackPipelineStatus = await syncRegistrationPipelineStatusForTaskStatus",
    "await updateOpsTaskStatusRow",
  ]);
});

test("registration roster writes require both sides and a real affected row", () => {
  const rosterSource = sourceBetween(
    "function getOpsStudentClassMode",
    "async function assignOpsTextbookToClass",
  );

  assert.match(rosterSource, /function hasSymmetricOpsStudentClassRosterLink/);
  assert.match(rosterSource, /async function waitForOpsRosterWriteResults/);
  assert.match(rosterSource, /Promise\.allSettled\(writes\)/);
  assert.match(rosterSource, /studentMode === "enrolled" && classMode === "enrolled"/);
  assert.match(rosterSource, /studentMode === "waitlist" && classMode === "waitlist"/);
  assert.match(rosterSource, /\.eq\("id", studentId\)\.select\("id"\)/);
  assert.match(rosterSource, /\.eq\("id", classId\)\.select\("id"\)/);
  assert.match(rosterSource, /didMutateOpsTask\(studentResult\.data\)/);
  assert.match(rosterSource, /didMutateOpsTask\(classResult\.data\)/);
});

test("registration completion rollback restores the class textbook projection", () => {
  const rollbackSource = sourceBetween(
    "async function rollbackOpsRegistrationCompletionSync",
    "async function rollbackOpsTransferCompletionSync",
  );

  assertInOrder(rollbackSource, [
    'selectOpsRowById("students", studentId)',
    "const previousMode = getOpsStudentClassMode(projectedStudent, classId)",
    "restoreOpsRegistrationStudentSnapshot",
  ]);
  assert.match(rollbackSource, /restoreOpsClassTextbookSnapshot\(classId, classRow\)/);
  assert.match(rollbackSource, /registration_projection_rollback/);
});

test("registration completion rollback records the projected mode that actually existed", async () => {
  const history = [];
  const calls = [];
  const rollback = loadRegistrationCompletionRollbackWithMocks({
    text: (value) => String(value || "").trim(),
    selectOpsRowById: async () => ({
      id: "student-1",
      class_ids: ["class-1"],
      waitlist_class_ids: [],
    }),
    getOpsStudentClassMode: (student, classId) => student?.class_ids?.includes(classId)
      ? "enrolled"
      : student?.waitlist_class_ids?.includes(classId)
        ? "waitlist"
        : "",
    deleteOpsRegistrationCreatedStudent: async () => calls.push("delete-created"),
    restoreOpsRegistrationStudentSnapshot: async () => calls.push("restore-student"),
    restoreOpsClassRosterSnapshot: async () => calls.push("restore-roster"),
    restoreOpsClassTextbookSnapshot: async () => calls.push("restore-textbook"),
    insertOpsStudentClassHistory: async (...args) => history.push(args),
    writeAutoSyncEventOnce: async () => calls.push("rollback-event"),
  });

  await rollback(
    "task-1",
    { id: "student-1", name: "김하윤", class_ids: [], waitlist_class_ids: ["class-1"] },
    { id: "class-1", name: "중2 영어", student_ids: [], waitlist_ids: ["student-1"], textbook_ids: [] },
    { id: "student-1", class_ids: [], waitlist_class_ids: ["class-1"] },
    false,
  );

  assert.deepEqual(calls, ["restore-student", "restore-roster", "restore-textbook", "rollback-event"]);
  assert.equal(history.length, 1);
  assert.deepEqual(Array.from(history[0]), [
    "student-1",
    "class-1",
    "waitlist",
    "enrolled",
    "waitlist",
    "registration_projection_rollback",
  ]);
});

test("registration completion validates and synchronizes textbook work only when an id is selected", () => {
  const readySource = sourceBetween(
    "function assertManagementSyncReady",
    "function assertRegistrationInquiryBaseReady",
  );
  const recordsSource = sourceBetween(
    "async function assertManagementSyncRecordsReady",
    "function assertResolvedManagementRecord",
  );
  const syncSource = sourceBetween(
    "async function syncRegistrationManagementLinks",
    "async function markWithdrawalRosterUpdated",
  );
  const registrationReadySource = readySource.slice(
    readySource.indexOf('if (input.type === "registration" && isRegistrationWorkflowComplete(input))'),
    readySource.indexOf('if (input.type === "withdrawal"'),
  );

  assert.doesNotMatch(registrationReadySource, /if \(!hasManagementReference\(input\.textbookId\)\) missingFields\.push\("교재"\)/);
  assert.match(registrationReadySource, /classStartSession/);
  assert.match(recordsSource, /if \(hasManagementReference\(input\.textbookId\)\) assertResolvedManagementRecord\(textbook/);
  assert.match(syncSource, /const textbook = hasManagementReference\(input\.textbookId\)/);
  assert.match(syncSource, /if \(textbook\) \{[\s\S]*assignOpsTextbookToClass[\s\S]*markRegistrationTextbookReady/);
  assert.match(syncSource, /if \(textbook\) \{[\s\S]*writeAutoSyncEventOnce\(taskId, "교재 연결"/);
});

test("registration manual check events follow the four-step admission sequence while legacy columns stay compatible", () => {
  const manualDefinitionsSource = sourceBetween(
    "const MANUAL_CHECK_FIELD_DEFINITIONS",
    "async function writeManualCheckEvents",
  );
  const registrationManualSource = manualDefinitionsSource.slice(
    manualDefinitionsSource.indexOf("registration:"),
    manualDefinitionsSource.indexOf("withdrawal:"),
  );
  const missingLabelsSource = sourceBetween(
    "function getMissingRegistrationCheckLabels",
    "function getMissingWithdrawalCheckLabels",
  );
  const mapSource = sourceBetween("function mapRegistration", "function mapWithdrawal");
  const buildSource = sourceBetween("function buildRegistrationRow", "function buildWithdrawalRow");
  const orderedLabels = [
    "입학신청서 발송",
    "메이크에듀 등록(수업, 교재)",
    "청구서 발송",
    "수납 완료 확인",
  ];

  assertInOrder(registrationManualSource, orderedLabels);
  assertInOrder(missingLabelsSource, orderedLabels);
  assert.doesNotMatch(registrationManualSource, /textbook_billing_issued|textbookBillingIssued|교재 청구출고표/);
  assert.doesNotMatch(missingLabelsSource, /textbookBillingIssued|교재 청구출고표/);
  assert.match(mapSource, /textbookBillingIssued: bool\(row\.textbook_billing_issued\)/);
  assert.match(buildSource, /textbook_billing_issued: Boolean\(detail\.textbookBillingIssued\)/);
});

test("sample completed registrations satisfy every new manual admission check", () => {
  const sqlCompletionStart = sampleWorkflowSource.indexOf("create temp table codex_ops_sample_detail_done");
  const sqlCompletionSource = sampleWorkflowSource.slice(
    sqlCompletionStart,
    sampleWorkflowSource.indexOf("word_retest_target as", sqlCompletionStart),
  );
  const clientCompletionStart = sampleWorkflowSource.indexOf('pipeline_status: "7. 등록 완료"');
  const clientCompletionSource = sampleWorkflowSource.slice(
    clientCompletionStart,
    sampleWorkflowSource.indexOf('.in("task_id", registrationIds)', clientCompletionStart),
  );

  assert.match(sqlCompletionSource, /admission_notice_sent = true[\s\S]*makeedu_registered = true[\s\S]*makeedu_invoice_sent = true[\s\S]*payment_checked = true/);
  assert.match(clientCompletionSource, /admission_notice_sent: true[\s\S]*makeedu_registered: true[\s\S]*makeedu_invoice_sent: true[\s\S]*payment_checked: true/);
});

test("registration completion skips every textbook side effect when empty and runs all of them when selected", async () => {
  async function run(textbookId) {
    const calls = [];
    const student = { id: "student-1", name: "김하윤" };
    const classRow = { id: "class-1", name: "중2 영어" };
    const textbook = { id: "textbook-1", title: "중등 독해" };
    const sync = loadRegistrationManagementSyncWithMocks({
      isRegistrationWorkflowComplete: () => true,
      shouldEnsureRegistrationStudent: () => true,
      resolveOpsRegistrationStudent: async () => student,
      ensureOpsStudent: async () => student,
      resolveOpsClass: async () => classRow,
      hasManagementReference: (...values) => values.some((value) => String(value || "").trim()),
      resolveOpsTextbook: async () => {
        calls.push("resolve-textbook");
        return textbook;
      },
      updateOpsTaskLinkFields: async (_taskId, patch) => calls.push(["links", patch]),
      syncRegistrationWaitlist: async () => calls.push("waitlist"),
      assertResolvedManagementRecord: (record, message) => {
        if (!record) throw new Error(message);
      },
      text: (value) => String(value || "").trim(),
      assignOpsStudentToClass: async () => calls.push("assign-student"),
      markRegistrationRosterUpdated: async () => calls.push("roster-ready"),
      assignOpsTextbookToClass: async () => calls.push("assign-textbook"),
      markRegistrationTextbookReady: async () => calls.push("textbook-ready"),
      rollbackOpsRegistrationCompletionSync: async () => calls.push("rollback"),
      attachOpsTaskCleanupError: () => {},
      writeAutoSyncEventOnce: async (_taskId, field) => calls.push(`audit:${field}`),
    });

    await sync("task-1", {
      type: "registration",
      status: "done",
      studentId: "student-1",
      studentName: "김하윤",
      classId: "class-1",
      className: "중2 영어",
      textbookId,
      textbookTitle: textbookId ? "중등 독해" : "",
      registration: { pipelineStatus: "7. 등록 완료" },
    });
    return calls;
  }

  const withoutTextbook = await run("");
  assert.ok(withoutTextbook.includes("assign-student"));
  assert.ok(withoutTextbook.includes("roster-ready"));
  assert.ok(withoutTextbook.includes("audit:학생관리"));
  assert.ok(withoutTextbook.includes("audit:수업명단"));
  for (const forbidden of ["resolve-textbook", "assign-textbook", "textbook-ready", "audit:교재 연결"]) {
    assert.equal(withoutTextbook.includes(forbidden), false, forbidden);
  }

  const withTextbook = await run("textbook-1");
  for (const required of ["resolve-textbook", "assign-textbook", "textbook-ready", "audit:교재 연결"]) {
    assert.ok(withTextbook.includes(required), required);
  }
});

test("created registration rollback is armed before waitlist or completion projection writes", () => {
  const prepareSource = sourceBetween(
    "async function prepareCreatedOpsCompletionSyncRollback",
    "async function rollbackAppliedCompletionSync",
  );
  const createSource = sourceBetween(
    "export async function createOpsTask",
    "async function updateRegistrationTaskParent",
  );

  assert.match(prepareSource, /isRegistrationWaitlistPipelineStatus\(input\.registration\?\.pipelineStatus\)/);
  assert.match(prepareSource, /const registrationCreatedStudentId = originalStudent \? "" : createOpsId\(\)/);
  assert.match(prepareSource, /selectOpsRowById\("students", studentId\)/);
  assertInOrder(createSource, [
    "const completionMutation = await prepareCreatedOpsCompletionSyncRollback",
    "rollbackCompletionSync = completionMutation.rollback",
    "completionSyncApplied = Boolean(rollbackCompletionSync)",
    "await syncOpsTaskManagementLinks",
  ]);
});

test("optional registration reads only tolerate a genuinely absent optional relation", () => {
  const readSource = sourceBetween(
    "async function readTable",
    "async function writeEvent",
  );

  assert.match(readSource, /optional && isMissingRelationError\(result\.error\)/);
  assert.match(readSource, /if \(!isMissingColumnError\(result\.error\)\) \{\s*throw result\.error/);
  assert.doesNotMatch(readSource, /optional \|\| isMissingRelationError/);
});

test("completed registration cases cannot be deleted while their roster projection is live", () => {
  const deleteSource = sourceBetween(
    "export async function deleteOpsTask",
    "export async function addOpsTaskComment",
  );

  assert.match(deleteSource, /task\.status === "done" \|\| isRegistrationCompletionImmutable\(task\.registration\?\.pipelineStatus\)/);
  assert.match(deleteSource, /등록 완료 건은 학생·수업·교재 연결을 유지해야 하므로 삭제할 수 없습니다\./);
});

test("failed waitlist deletion re-reads the current roster before writing compensating history", () => {
  const deleteCleanupSource = sourceBetween(
    "async function resolveRegistrationWaitlistClassForDelete",
    "export async function deleteOpsTask",
  );

  assert.match(deleteCleanupSource, /const persistedClassId = text\(task\.classId\)/);
  assert.match(deleteCleanupSource, /hasSymmetricOpsWaitlistLink/);
  assert.match(deleteCleanupSource, /symmetricCandidates\.length !== 1/);
  assert.doesNotMatch(deleteCleanupSource, /resolveOpsClass\(task\.classId, task\.className\)/);
  assert.match(deleteCleanupSource, /const student = await resolveOpsRegistrationStudent\(input\)/);
  assert.doesNotMatch(deleteCleanupSource, /selectOpsRowById\("students", task\.studentId/);
  assertInOrder(deleteCleanupSource, [
    "try {",
    'await removeOpsStudentFromClass(student, classRow, "registration_waitlist_deleted")',
    "catch (error)",
    "await rollbackRegistrationWaitlistRemovalAfterFailure(student, classRow, error)",
    "throw error",
  ]);
  assertInOrder(deleteCleanupSource, [
    "await removeOpsStudentFromClass",
    'selectOpsRowById("students", text(student.id))',
    'selectOpsRowById("classes", text(classRow.id))',
    "assignOpsStudentToWaitlist(currentStudent, currentClass",
  ]);
});

test("registration persistence and verification fixtures no longer reference inquiry channel", () => {
  assert.doesNotMatch(serviceSource, /inquiryChannel|inquiry_channel/);
  assert.doesNotMatch(sampleWorkflowSource, /inquiry_channel/);
  assert.doesNotMatch(browserWorkflowSource, /inquiry_channel/);
});

test("registration inquiry-channel removal migration is lock-bounded and idempotent", () => {
  assert.equal(
    inquiryChannelMigrationSource,
    "set local lock_timeout = '5s';\n\nalter table public.ops_registration_details\n  drop column if exists inquiry_channel;\n",
  );
});

test("waitlist delete history failure restores both roster snapshots before surfacing failure", async () => {
  const calls = [];
  const history = [];
  const originalError = new Error("history unavailable");
  const rollback = loadWaitlistDeleteRollbackWithMocks({
    text: (value) => String(value || "").trim(),
    selectOpsRowById: async (table) => table === "students"
      ? { id: "student-1", class_ids: [], waitlist_class_ids: [] }
      : { id: "class-1", student_ids: [], waitlist_ids: [] },
    getOpsStudentClassMode: (student, classId) => student.waitlist_class_ids.includes(classId) ? "waitlist" : "",
    restoreOpsStudentRosterSnapshot: async () => calls.push("restore-student"),
    restoreOpsClassRosterSnapshot: async () => calls.push("restore-class"),
    insertOpsStudentClassHistory: async (...args) => history.push(args),
    attachOpsTaskCleanupError: (error, cleanupError) => {
      error.cleanupError = cleanupError;
    },
  });

  await rollback(
    { id: "student-1", class_ids: [], waitlist_class_ids: ["class-1"] },
    { id: "class-1", student_ids: [], waitlist_ids: ["student-1"] },
    originalError,
  );

  assert.deepEqual(calls, ["restore-student", "restore-class"]);
  assert.deepEqual(Array.from(history[0]), [
    "student-1",
    "class-1",
    "waitlist",
    "",
    "waitlist",
    "registration_waitlist_delete_rollback",
  ]);
  assert.equal(originalError.cleanupError, undefined);
});

test("waitlist deletion never picks the first same-name class without a unique symmetric link", async () => {
  const classes = [
    { id: "class-old", name: "중2 영어", waitlist_ids: ["student-1"] },
    { id: "class-new", name: "중2 영어", waitlist_ids: [] },
  ];
  const resolver = loadWaitlistDeleteClassResolverWithMocks({
    supabase: {
      from: () => ({
        select() {
          return this;
        },
        async in() {
          return { data: classes, error: null };
        },
      }),
    },
    text: (value) => String(value || "").trim(),
    normalizeIdList: (value) => Array.isArray(value) ? value : [],
    selectOpsRowById: async () => null,
    hasSymmetricOpsWaitlistLink: (student, classRow) => (
      student.waitlist_class_ids.includes(classRow.id)
      && classRow.waitlist_ids.includes(student.id)
    ),
  });
  const student = { id: "student-1", waitlist_class_ids: ["class-old", "class-new"] };

  const resolved = await resolver({ classId: "", className: "중2 영어" }, student);
  assert.equal(resolved.id, "class-old");

  classes[1].waitlist_ids = ["student-1"];
  await assert.rejects(
    resolver({ classId: "", className: "중2 영어" }, student),
    /대기 수업 연결을 하나로 확인할 수 없습니다/,
  );
});

test("registration 파생 감사 이력은 커밋 뒤 별도 activity RPC로 기록하지 않는다", () => {
  const updateSource = sourceBetween(
    "export async function updateOpsTask",
    "export async function updateOpsTaskStatus",
  );
  const statusSource = sourceBetween(
    "export async function updateOpsTaskStatus",
    "async function removeRegistrationWaitlistOnDelete",
  );

  assert.doesNotMatch(serviceSource, /async function writeCommittedEvent/);
  assert.doesNotMatch(updateSource, /writeEvent\(taskId, "updated"/);
  assert.doesNotMatch(statusSource, /writeEvent\(currentTask\.id, "(?:status_changed|revision_requested)"/);
});

test("terminal registration creation keeps the parent open until children exist", () => {
  const createSource = sourceBetween(
    "export async function createOpsTask",
    "async function updateRegistrationTaskParent",
  );
  const cleanupSource = sourceBetween(
    "async function deleteCreatedOpsTaskOnFailure",
    "function attachOpsTaskCleanupError",
  );

  assertIncludesAll(createSource, [
    "const stagesTerminalRegistrationParent",
    'status: "in_progress"',
    "const initialParentInput",
    "await upsertDetail",
    "await updateRegistrationTaskParent(taskId, input, { preserveManagementLinks: true })",
  ]);
  assertInOrder(createSource, [
    "const initialParentInput",
    "await upsertDetail",
    "await updateRegistrationTaskParent(taskId, input, { preserveManagementLinks: true })",
  ]);
  assert.doesNotMatch(createSource, /writeEvent\(taskId, "created"/);
  assert.match(createSource, /\.select\("id,created_at"\)/);
  assert.match(createSource, /deleteCreatedOpsTaskOnFailure\(taskId, createdAt\)/);
  assert.match(cleanupSource, /runIdempotentOpsTaskProducerRpc\("cleanup_created_ops_task_v1"/);
  assert.match(cleanupSource, /p_expected_created_at: expectedCreatedAt/);
  assert.match(cleanupSource, /producerCleanupDeleted\(response, taskId\)/);
  assert.doesNotMatch(cleanupSource, /\.from\(|\.delete\(/);
});

test("생성된 등록 업무 정리는 고정 RPC 영수증을 요구한다", async () => {
  const calls = [];
  let validReceipt = true;
  const cleanup = loadCreatedTaskCleanupWithMocks({
    supabase: {},
    text: (value) => String(value || "").trim(),
    runIdempotentOpsTaskProducerRpc: async (name, parameters) => {
      calls.push({ name, parameters });
      return { taskId: "task-1", deleted: validReceipt };
    },
    producerCleanupDeleted: (response, taskId) => {
      if (response.deleted !== true || response.taskId !== taskId) {
        throw new Error("생성 실패 업무 정리 결과를 확인하지 못했습니다.");
      }
    },
  });

  const expectedCreatedAt = "2026-07-17T00:00:00.000Z";
  assert.equal(await cleanup("task-1", expectedCreatedAt), null);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    name: "cleanup_created_ops_task_v1",
    parameters: {
      p_task_id: "task-1",
      p_expected_created_at: expectedCreatedAt,
    },
  }]);

  validReceipt = false;
  const error = await cleanup("task-1", expectedCreatedAt);
  assert.match(error.message, /생성 실패 업무 정리 결과를 확인하지 못했습니다/);
});
