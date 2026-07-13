import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

import { getRegistrationTrackViewKey } from "../src/features/tasks/registration-track-model.js";

const listUrl = new URL(
  "../src/features/tasks/registration-track-list.tsx",
  import.meta.url,
);

async function readListSource() {
  return readFile(listUrl, "utf8");
}

async function readWorkspaceSource() {
  return readFile(
    new URL("../src/features/tasks/ops-task-workspace.tsx", import.meta.url),
    "utf8",
  );
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start + startMarker.length, end);
}

async function loadListAdapter() {
  const source = await readListSource();
  const adapterSource = sourceBetween(
    source,
    "// registration-track-list-adapter:start",
    "// registration-track-list-adapter:end",
  );
  const compiled = ts.transpileModule(
    `${adapterSource}\nmodule.exports = { buildRegistrationTrackListItems, filterRegistrationTrackListItems, sortRegistrationConsultationItems, getRegistrationConsultationTimeLabel, getRegistrationTrackTimeValue };`,
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
    getRegistrationTrackViewKey,
  });
  return sandboxModule.exports;
}

function fixtureTasks() {
  return [{
    id: "case-1",
    title: "등록: 김다미",
    studentName: "김다미",
    registrationTracks: [
      {
        id: "eng",
        subject: "영어",
        status: "consultation_waiting",
        directorProfileId: "director-1",
        directorName: "강부희",
        stageEnteredAt: "2026-07-10T00:00:00Z",
        migrationReviewRequired: false,
      },
      {
        id: "math",
        subject: "수학",
        status: "level_test_scheduled",
        directorProfileId: "director-2",
        directorName: "양소윤",
        stageEnteredAt: "2026-07-11T00:00:00Z",
        migrationReviewRequired: false,
      },
    ],
  }];
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function consultationItem(trackId, stageEnteredAt, mode = "phone") {
  return {
    key: `case:${trackId}`,
    taskId: "case",
    trackId,
    status: mode === "phone" ? "consultation_waiting" : "visit_consultation_scheduled",
    stageEnteredAt,
  }
}

test("phone queue is oldest first and never shows a reservation time", async () => {
  const { sortRegistrationConsultationItems, getRegistrationConsultationTimeLabel } = await loadListAdapter()
  const items = sortRegistrationConsultationItems([
    consultationItem("new", "2026-07-12T03:00:00Z", "phone"),
    consultationItem("old", "2026-07-10T03:00:00Z", "phone"),
  ])
  assert.deepEqual(plain(items.map((item) => item.trackId)), ["old", "new"])
  assert.equal(getRegistrationConsultationTimeLabel(items[0]), "전화상담 대기")
})

test("visit rows use only the canonical active appointment time and never relabel stage entry as the booking", async () => {
  const { getRegistrationTrackTimeValue } = await loadListAdapter()
  assert.equal(getRegistrationTrackTimeValue({
    status: "visit_consultation_scheduled",
    visitScheduledAt: "2026-07-15T03:00:00Z",
    stageEnteredAt: "2026-07-12T01:00:00Z",
  }), "2026-07-15T03:00:00Z")
  assert.equal(getRegistrationTrackTimeValue({
    status: "visit_consultation_scheduled",
    visitScheduledAt: "",
    stageEnteredAt: "2026-07-12T01:00:00Z",
  }), "")
  assert.equal(getRegistrationTrackTimeValue({
    status: "level_test_scheduled",
    visitScheduledAt: "",
    stageEnteredAt: "2026-07-12T01:00:00Z",
  }), "2026-07-12T01:00:00Z")
})

test("one parent case becomes one work item per subject track", async () => {
  const { buildRegistrationTrackListItems } = await loadListAdapter();
  const items = buildRegistrationTrackListItems(fixtureTasks());

  assert.deepEqual(plain(items.map((item) => [item.key, item.subject, item.viewKey])), [
    ["case-1:eng", "영어", "consulting"],
    ["case-1:math", "수학", "level_test"],
  ]);
  assert.equal(items[0].taskId, "case-1");
  assert.equal(items[0].trackId, "eng");
});

test("same parent tracks can appear in different tabs", async () => {
  const {
    buildRegistrationTrackListItems,
    filterRegistrationTrackListItems,
  } = await loadListAdapter();
  const items = buildRegistrationTrackListItems(fixtureTasks());

  assert.deepEqual(
    plain(filterRegistrationTrackListItems(items, "consulting").map((item) => item.trackId)),
    ["eng"],
  );
  assert.deepEqual(
    plain(filterRegistrationTrackListItems(items, "level_test").map((item) => item.trackId)),
    ["math"],
  );
});

test("phone consultation queue is oldest-first without reordering other tabs", async () => {
  const {
    buildRegistrationTrackListItems,
    filterRegistrationTrackListItems,
  } = await loadListAdapter();
  const tasks = fixtureTasks();
  const baseTask = tasks[0];
  tasks.unshift({
    ...baseTask,
    id: "case-2",
    studentName: "신규",
    registrationTracks: [{
      ...baseTask.registrationTracks[0],
      id: "eng-newer",
      taskId: "case-2",
      stageEnteredAt: "2026-07-12T00:00:00Z",
    }],
  });
  tasks.push({
    ...baseTask,
    id: "case-3",
    studentName: "방문",
    registrationTracks: [{
      ...baseTask.registrationTracks[0],
      id: "eng-visit",
      status: "visit_consultation_scheduled",
      stageEnteredAt: "2026-07-09T00:00:00Z",
    }],
  });
  tasks.push({
    ...baseTask,
    id: "case-4",
    studentName: "수학 후속",
    registrationTracks: [{
      ...baseTask.registrationTracks[1],
      id: "math-second",
      stageEnteredAt: "2026-07-08T00:00:00Z",
    }],
  });

  const items = buildRegistrationTrackListItems(tasks);
  const originalItems = plain(items);
  assert.deepEqual(
    plain(filterRegistrationTrackListItems(items, "consulting").map((item) => item.trackId)),
    ["eng", "eng-newer", "eng-visit"],
  );
  assert.deepEqual(
    plain(filterRegistrationTrackListItems(items, "level_test").map((item) => item.trackId)),
    ["math", "math-second"],
  );
  assert.deepEqual(plain(items), originalItems, "filtering must not mutate the shared track list");
});

test("track list renders compact subject-scoped desktop and mobile rows", async () => {
  const source = await readListSource();

  assert.match(source, /export function RegistrationTrackList/);
  assert.match(source, /data-testid="registration-track-desktop-list"/);
  assert.match(source, /data-testid="registration-track-mobile-list"/);
  assert.match(source, /item\.studentName/);
  assert.match(source, /<Badge variant="outline">\{item\.subject\}<\/Badge>/);
  assert.match(source, /<RegistrationTrackStatusBadge status=\{item\.status\}/);
  assert.match(source, /같은 문의의 과목별 진행/);
  assert.match(source, /단일 과목 문의/);
  assert.match(source, /item\.directorName \|\| "미지정"/);
  assert.match(source, /min-w-0/);
  assert.match(source, /overflow-hidden/);
  assert.match(source, /REGISTRATION_TRACK_INITIAL_RENDER_LIMIT/);
  assert.match(source, /visibleItems/);
  assert.match(source, /windowState\.key === itemSetKey/);
  assert.match(source, /setWindowState/);
  assert.match(source, /더 보기/);
  assert.match(source, /REGISTRATION_TRACK_DATE_FORMATTER/);
  assert.match(source, /content-visibility:auto/);
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /visitScheduledAt/);
  assert.match(source, /visitPlace/);
  assert.match(source, /방문상담 일시/);
  assert.match(source, /방문상담 장소/);
});

test("selected visit consultation card shows the canonical appointment time and place", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /visitAppointment/)
  assert.match(source, /selectedVisitConsultation\?\.appointmentId/)
  assert.match(source, /방문상담 일시/)
  assert.match(source, /방문상담 장소/)
  assert.match(source, /visitAppointment\.scheduledAt/)
  assert.match(source, /visitAppointment\.place/)
})

test("unbatched enrollment drafts may omit a schedule while batch start requires complete schedules", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const draftBlock = sourceBetween(source, "const blockers = useMemo", "function updateRow")
  assert.match(draftBlock, /requireSchedule:\s*false/)
  assert.match(source, /selectedEnrollmentsHaveCompleteSchedules/)
  assert.match(source, /입학 처리 전에 선택한 모든 수업의 시작 일정을 지정하세요/)
})

test("list permissions are summary hints and every callback remains subject-scoped", async () => {
  const source = await readListSource();

  assert.match(source, /getRegistrationSummaryActionPermissions/);
  assert.match(source, /canOpenConsultationCompletion/);
  assert.match(source, /onOpen\(item\.taskId, item\.trackId\)/);
  assert.match(source, /onEdit\(item\.taskId, item\.trackId\)/);
  assert.match(source, /onAction\(item\.taskId, item\.trackId, "complete_consultation"\)/);
  assert.match(source, /`\[\$\{item\.subject\}\] \$\{consultationActionLabel\}`/);
  assert.match(source, /strict detail permission/i);
  assert.doesNotMatch(source, /getRegistrationActionPermissions/);
  assert.doesNotMatch(source, /\.consultations/);
});

test("workspace derives tab counts from every track before filtering the selected view", async () => {
  const source = await readWorkspaceSource();

  assert.match(source, /buildRegistrationTrackListItems/);
  assert.match(source, /filterRegistrationTrackListItems/);
  assert.match(source, /getRegistrationTrackTabCounts/);
  assert.match(source, /const registrationTrackItems = useMemo/);
  assert.match(source, /getRegistrationTrackTabCounts\(registrationTrackItems\.map\(\(item\) => item\.track\)\)/);
  assert.match(source, /const visibleRegistrationTrackItems = useMemo/);
  assert.match(source, /filterRegistrationTrackListItems\(registrationTrackItems, registrationView\)/);
  assert.match(source, /<RegistrationTrackList/);
  assert.match(source, /items=\{visibleRegistrationTrackItems\}/);
  assert.match(source, /viewerId=\{registrationViewerId\}/);
  assert.match(source, /viewerRole=\{registrationViewerRole\}/);
  assert.doesNotMatch(source, /\bregistrationPipeline\b/);
  assert.doesNotMatch(source, /isRegistrationPipelineInView/);
  assert.match(source, /const visibleWorkspaceItemCount = isRegistrationWorkspace[\s\S]*?visibleRegistrationTrackItems\.length/);
  assert.match(source, /shouldHideEmptySurface = !loading && visibleWorkspaceItemCount === 0/);
});

test("registration deep links preserve task and real track ids and clear both on close", async () => {
  const source = await readWorkspaceSource();

  assert.match(source, /const \[selectedRegistrationTrackId, setSelectedRegistrationTrackId\] = useState/);
  assert.match(source, /searchParams\.set\("trackId", nextTrackId\)/);
  assert.match(source, /searchParams\.delete\("trackId"\)/);
  assert.match(source, /syncTaskDeepLink\(taskId, trackId\)/);
  assert.match(source, /searchParams\.get\("trackId"\)/);
  assert.match(source, /setSelectedRegistrationTrackId\(deepLinkedTrackId\)/);
  assert.match(source, /setSelectedRegistrationTrackId\(null\)/);
  assert.match(source, /if \(isLegacyRegistrationTrackId\(trackId\)\)/);
  assert.match(source, /syncTaskDeepLink\(taskId, null\)/);
  assert.match(source, /deepLinkedTask\.type !== "registration" && deepLinkedTrackId[\s\S]*?syncTaskDeepLink\(deepLinkedTaskId, null\)/);
});

test("consultation completion hint reloads exact detail and rechecks strict ownership", async () => {
  const source = await readWorkspaceSource();

  assert.match(source, /loadRegistrationCaseForWorkspace\(taskId, true\)/);
  assert.match(source, /loadOpsRegistrationCaseDetail\(taskId, registrationViewerId, \{ force \}\)/);
  assert.match(source, /getRegistrationActionPermissions\(\{/);
  assert.match(source, /activeConsultation/);
  assert.match(source, /permissions\.canCompleteConsultation/);
  assert.match(source, /상담 담당자 또는 진행 상태가 변경되었습니다/);
  assert.match(source, /await reload\(true, false\)/);
  assert.match(source, /action !== "complete_consultation"/);
  assert.match(source, /isLegacyRegistrationTrackId\(trackId\)/);
  assert.match(source, /const actionSelectionKey = `action:\$\{taskId\}:\$\{trackId\}`/);
  assert.match(source, /registrationTrackSelectionRef\.current = actionSelectionKey/);
  assert.match(source, /if \(registrationTrackSelectionRef\.current !== actionSelectionKey\) return/);
  assert.match(source, /track\?\.status === "consultation_waiting"/);
  assert.match(source, /track\?\.status === "visit_consultation_scheduled"/);
  assert.match(source, /setRegistrationConsultationOutcomeTrackId\(trackId\)/)
  assert.match(source, /consultationOutcomeOpen=\{registrationConsultationOutcomeTrackId === selectedRegistrationTrackId\}/)
});

test("track editor shows common information once and subject-scoped navigation", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /등록 공통 정보/)
  assert.match(source, /detail\.tracks\.map/)
  assert.match(source, /selectedTrackId/)
  assert.match(source, /track\.subject/)
  assert.match(source, /track\.status/)
  assert.match(source, /updateRegistrationCaseCommon/)
  assert.match(source, /expectedCommonRevision:\s*detail\.commonRevision/)
  assert.match(source, /commonPayloadKey/)
  assert.match(source, /subjectPayloadKey/)
  assert.match(source, /getRegistrationIdentityEditLock\(detail\)/)
  assert.match(source, /admissionApplicationAccepted/)
  assert.match(source, /공통 정보 저장/)
  assert.match(source, /문의일시/)
  assert.match(source, /필수/)
})

test("canonical track detail resolves and persists director defaults only for management roles", async () => {
  const editor = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  const workspace = await readWorkspaceSource()

  assert.match(editor, /resolveRegistrationTrackDirectorDefaults/)
  assert.match(editor, /permissions\.canManage/)
  assert.match(editor, /resolution\.shouldClear\s*\?\s*"clear_default"\s*:\s*"default"/)
  assert.match(editor, /expectedCommonRevision:\s*detail\.commonRevision/)
  assert.match(editor, /registration_common_revision_conflict/)
  assert.match(editor, /registration_director_refresh_required/)
  assert.match(editor, /registration_director_default_stale/)
  assert.match(editor, /isRegistrationDirectorCatalogRefreshError\(message\)/)
  assert.match(editor, /setCatalogRefreshRequired\(true\)/)
  assert.match(editor, /const refreshed = await onRetryDirectorCatalog\(\)/)
  assert.match(editor, /if \(refreshed === false\)/)
  assert.match(editor, /await onReload\(\)/)
  assert.match(editor, /자동 배정 다시 시도/)
  assert.match(editor, /automaticRefreshError/)
  assert.match(editor, /최신 정보 다시 불러오기/)
  assert.match(editor, /visitGuardSignature/)
  assert.match(workspace, /directorCatalogStatus=/)
  assert.match(workspace, /registrationOptionsLoading\s*\?\s*"loading"/)
  assert.match(workspace, /teacherOptions=\{data\?\.teachers/)
  assert.match(workspace, /selectedRegistrationTrackIdRef\.current = selectedRegistrationTrackId/)
  assert.match(workspace, /preferredTrackId \|\| selectedRegistrationTrackIdRef\.current/)

  const automaticBlock = sourceBetween(
    editor,
    "async function applyAutomaticDefaults() {",
    "const terminal =",
  )
  assert.doesNotMatch(automaticBlock, /await onReload/)
  assert.match(automaticBlock, /attemptedRef\.current\.add\(attemptKey\)[\s\S]*?setAutomaticError\(""\)/)
  assert.match(automaticBlock, /if \(!attemptedAny\)[\s\S]*?attemptedAny = true[\s\S]*?setAutomaticError\(""\)/)
  assert.match(editor, /advanceRegistrationAutomaticSavingGeneration\([\s\S]*?automaticGenerationRef\.current[\s\S]*?hasAutomaticActions/)
  assert.match(editor, /automaticGenerationRef\.current = generationState\.generation[\s\S]*?if \(!generationState\.saving\)[\s\S]*?setAutomaticSaving\(false\)/)
  assert.match(automaticBlock, /shouldSettleRegistrationAutomaticSavingGeneration\([\s\S]*?generationState\.generation[\s\S]*?automaticGenerationRef\.current/)
  assert.doesNotMatch(automaticBlock, /if \(!cancelled\) setAutomaticSaving\(false\)/)
  assert.match(editor, /automaticRefreshRequest[\s\S]*?await onReload\(request\.preferredTrackId \|\| undefined\)/)
  assert.match(workspace, /registrationOptionsLoadGenerationRef\.current !== loadGeneration[\s\S]*?return false/)
  assert.match(workspace, /setRegistrationOptionsLoading\(false\)[\s\S]*?return enrichmentData\.directorCatalogStatus === "authoritative"/)
})

test("common information conflicts clear their stable key only after a successful latest-data reload", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  const commonSection = sourceBetween(source, "function RegistrationCommonInfoSection", "function RegistrationSubjectSyncSection")
  const saveCommon = sourceBetween(source, "async function saveCommon", "return (")

  assert.match(commonSection, /type CommonSaveOutcome|Promise<CommonSaveOutcome>/)
  assert.match(commonSection, /const outcome = await onSave\(draft, requestKey\)[\s\S]*?submissionKeys\.clear/)
  assert.match(commonSection, /outcome === "conflict_reloaded"[\s\S]*?최신 정보로 다시 불러왔습니다/)
  assert.doesNotMatch(commonSection, /message\.includes\("registration_common_revision_conflict"\)[\s\S]*?submissionKeys\.clear/)
  assert.match(saveCommon, /registration_common_revision_conflict[\s\S]*?await onReload\(\)[\s\S]*?return "conflict_reloaded"/)
  assert.match(saveCommon, /최신 정보를 다시 불러오지 못했습니다[\s\S]*?창을 닫고 다시 여세요/)
  assert.match(saveCommon, /await onReload\(\)[\s\S]*?return "saved"/)
})

test("ordinary tracks expose compact manual director selection and visit reassignment guidance", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  const manualSave = sourceBetween(source, "async function saveManualDirector", "async function retryAutomaticRefresh")
  assert.match(source, /RegistrationTrackDirectorSection/)
  assert.match(source, /상담 책임자/)
  assert.match(source, /assignmentSource:\s*"manual"/)
  assert.match(source, /ruleKey:\s*null/)
  assert.match(source, /registration_visit_reassign_requires_reschedule/)
  assert.match(source, /방문상담 예약 수정에서 담당 원장을 다시 확인하세요/)
  assert.match(source, /setVisitCorrectionRequest\(\{ id, trackId: resolution\.trackId \}\)/)
  assert.match(source, /onOpenVisit\(visitCorrectionRequest\.trackId\)/)
  assert.match(source, /item\.trackId === trackId && item\.mode === "visit"/)
  assert.match(source, /onSelectTrack\(trackId\)/)
  assert.match(source, /requestKeysRef\.current\.delete\(logicalKey\)/)
  assert.match(source, /visitCorrectionTrackId/)
  assert.match(source, /preferredTrackId:\s*visitCorrectionTrackId/)
  assert.match(source, /activeDirectorProfileIds/)
  assert.match(source, /teacherOptions\.map\(\(teacher\) => teacher\.profileId\)/)
  assert.match(source, /baselineProfileId === serverDirectorProfileId/)
  assert.match(source, /saveManualDirector[\s\S]*?isRegistrationDirectorCatalogRefreshError\(message\)[\s\S]*?setCatalogRefreshRequired\(true\)/)
  assert.match(source, /const selectedDirectorIsAvailable = availableDirectors\.some\(\(profile\) => profile\.id === directorProfileId\)/)
  assert.match(manualSave, /!selectedDirectorIsAvailable/)
  assert.match(source, /disabled=\{!directorProfileId \|\| !selectedDirectorIsAvailable/)
})

test("detail renders one chronological subject-badged canonical and legacy history", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /buildRegistrationSubjectHistory/)
  assert.match(source, /과목별 진행 이력/)
  assert.match(source, /history\.map/)
  assert.match(source, /item\.subjects\.map/)
  assert.match(source, /item\.occurredAt/)
  assert.match(source, /item\.description/)
  assert.match(source, /item\.actorId/)
  assert.match(source, /actorLabelById/)
})

test("migration review blocks ordinary actions until explicit attribution", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /과목 분리 확인 필요/)
  assert.match(source, /RegistrationMigrationReviewEditor/)
  assert.match(source, /migrationReviewRequired/)
  assert.match(source, /resolveRegistrationMigrationReview/)
  assert.match(source, /상담 책임자/)
  assert.match(source, /assignRegistrationTrackDirector/)
  assert.match(source, /consultation_waiting/)
  assert.match(source, /visit_consultation_scheduled/)
  assert.match(source, /directorProfileId/)
  assert.match(source, /const requiresExplicitAssignments = reviewTracks\.length > 1/)
  assert.match(source, /migrationDirectorEntityKey/)
  assert.match(source, /migrationReviewEntityKey/)
  assert.match(source, /활성 담당자 다시 선택/)
  assert.match(source, /availableDirectors\.some\(\(profile\) => profile\.id === directorProfileId\)/)
  assert.match(source, /RegistrationMigrationReviewEditor[\s\S]*?onRetryDirectorCatalog/)
  assert.match(source, /saveDirector[\s\S]*?isRegistrationDirectorCatalogRefreshError\(message\)[\s\S]*?setCatalogRefreshRequired\(true\)/)
  assert.match(source, /retryDirectorCatalog[\s\S]*?await onRetryDirectorCatalog\(\)[\s\S]*?담당자 정보 다시 불러오기/)
  assert.match(source, /requiresExplicitAssignments\s*\?\s*groups\.map/)
  assert.match(source, /classOptions\.some\(\(option\) => option\.id === detail\.migrationLegacy\?\.classId && option\.subject === track\.subject\)/)
  assert.match(source, /\{ classId: detail\.migrationLegacy\?\.classId \|\| "" \}/)
})

test("subject removal is routed through the history-aware RPC", async () => {
  const service = await readFile(new URL("../src/features/tasks/registration-track-service.ts", import.meta.url), "utf8")
  assert.match(service, /sync_registration_case_subjects/)
  assert.match(service, /p_subjects/)
})

test("migration resolution keeps typed inputs separate and sends one canonical JSON payload", async () => {
  const service = await readFile(new URL("../src/features/tasks/registration-track-service.ts", import.meta.url), "utf8")
  assert.match(service, /trackStates/)
  assert.match(service, /p_assignments:\s*\{\s*assignments:\s*input\.assignments,\s*trackStates:\s*input\.trackStates,?\s*\}/)
  assert.doesNotMatch(service, /p_track_states/)
})

test("inquiry decisions are subject-scoped and never fake a phone reservation", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /레벨테스트 예약/)
  assert.match(source, /바로 상담/)
  assert.match(source, /문의만 완료/)
  assert.match(source, /routeRegistrationInquiry/)
  assert.doesNotMatch(source, /phoneConsultationAt/)
})

test("waiting controls require the retest decision and expose explicit closure", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /레벨테스트 재응시 필요/)
  assert.match(source, /재응시 없이 등록/)
  assert.match(source, /대기 종료 · 미등록/)
  assert.match(source, /transitionRegistrationWaiting/)
})

test("subject removal renders the deployed history-block error inline", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /registration_subject_removal_blocked/)
  assert.doesNotMatch(source, /registration_subject_has_history/)
})

test("workspace mounts the unified editor only for a loaded canonical subject track", async () => {
  const source = await readWorkspaceSource()
  assert.match(source, /import \{ RegistrationTrackEditor \} from "\.\/registration-track-editor"/)
  assert.match(source, /const \[registrationCaseDetail, setRegistrationCaseDetail\] = useState/)
  assert.match(source, /setRegistrationCaseDetail\(detail\)/)
  assert.match(source, /registrationCaseDetail && isCanonicalRegistrationTrackDetail/)
  assert.match(source, /<RegistrationTrackEditor/)
  assert.match(source, /detail=\{registrationCaseDetail\}/)
  assert.match(source, /selectedTrackId=\{selectedRegistrationTrackId\}/)
  assert.match(source, /onSelectTrack=\{handleSelectRegistrationTrack\}/)
  assert.match(source, /caseLevelActions=/)
})

test("ready-mode creation atomically creates the parent and both selected subject tracks", async () => {
  const source = await readWorkspaceSource()
  assert.match(source, /probeRegistrationSubjectTrackRuntime/)
  assert.match(source, /runtime\.mode === "ready" && runtime\.version === 1/)
  assert.match(source, /createRegistrationCase\(\{/)
  assert.match(source, /subjects:\s*parseRegistrationSubjects\(createPayload\.subject\)/)
  assert.match(source, /registrationCreateRequestRef/)
  assert.match(source, /persistCreatedRegistrationDirectorDefaults/)
  assert.match(source, /response\.commonRevision/)
  assert.match(source, /runtime\.mode === "maintenance"/)
})

test("appointment editor uses one schedule and one result control per subject", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /DateTimePickerControl/)
  assert.match(source, /적용 과목/)
  assert.match(source, /activities\.map/)
  assert.match(source, /시험지·결과지 URL/)
  assert.match(source, /시험 시작/)
  assert.match(source, /startRegistrationLevelTestAttempt/)
  assert.match(source, /문의 종료/)
  assert.match(source, /closeRegistrationLevelTestTrack/)
  assert.match(source, /남은 과목 일정 다시 잡기/)
  assert.match(source, /예약 취소/)
  assert.match(source, /cancelRegistrationAppointment/)
})

test("appointment editor dispatches only authoritative notification targets before its saved handoff", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /onSaved\(saved\)/)
  assert.match(source, /notificationTargets/)
  assert.match(source, /sendRegistrationVisitNotificationTarget\(target/)
  assert.match(source, /appointment\?\.id \|\| null/)
  assert.match(source, /appointment\?\.notificationRevision \?\? null/)
  assert.match(source, /registration_appointment_revision_conflict/)
  assert.match(source, /다른 사용자가 예약을 변경했습니다\. 최신 내용을 확인하세요/)
  assert.match(source, /replaceRemaining: editMode === "replace_remaining"/)
  assert.doesNotMatch(source, /fetch\("\/api\/registration\/consultation-notification/)
})

test("committed appointment and result mutations cannot be resubmitted when refresh degrades", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /effectiveSelectedTrackIds/)
  assert.match(source, /getRegistrationAppointmentPayloadTrackIds/)
  assert.match(source, /latestLevelTestActivityIds/)
  assert.match(source, /refreshPending/)
  assert.match(source, /저장은 완료/)
  assert.match(source, /최신 내용 다시 불러오기/)
})

test("track editor opens one shared editor for level tests and visit consultations", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /RegistrationAppointmentEditor/)
  assert.match(source, /kind="level_test"/)
  assert.match(source, /kind="visit_consultation"/)
  assert.match(source, /방문상담 예약/)
})

test("phone and visit consultation completion share the subject outcome dialog", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /RegistrationConsultationOutcomeDialog/)
  assert.match(source, /completeRegistrationConsultation/)
  assert.match(source, /consultationId: consultation\.id/)
  assert.match(source, />등록</)
  assert.match(source, />대기</)
  assert.match(source, />미등록 완료</)
  assert.match(source, /현재 학기 수강반 대기/)
  assert.match(source, /현재 학기 개강반 대기/)
  assert.match(source, /다음 학기 개강반 대기/)
  assert.doesNotMatch(source, /상담 완료일시/)
})

test("phone completion does not call the visit reservation notification helper", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  const dialogBlock = sourceBetween(source, "export function RegistrationConsultationOutcomeDialog", "export function RegistrationMigrationReviewEditor")
  assert.match(dialogBlock, /completeRegistrationConsultation/)
  assert.match(dialogBlock, /onReload/)
  assert.doesNotMatch(dialogBlock, /sendRegistrationVisitNotificationTarget/)
  assert.doesNotMatch(dialogBlock, /consultation-notification/)
})

test("enrollment editor supports stable repeated subject rows and exact class detail hydration", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /export function RegistrationEnrollmentEditor/)
  assert.match(source, /track\.subject/)
  assert.match(source, /수업 추가/)
  assert.match(source, /loadOpsRegistrationClassDetail/)
  assert.match(source, /classDetailById/)
  assert.match(source, /loadingClassIds/)
  assert.match(source, /new Set\(draftRows\.map/)
  assert.match(source, /선택 안 함 · 이미 보유/)
  assert.match(source, /textbookExplicitlyCleared/)
  assert.match(source, /getSelectableRegistrationScheduleSessions/)
  assert.match(source, /saveRegistrationEnrollmentRows/)
  assert.match(source, /mergeSavedRegistrationEnrollmentRows/)
  assert.match(source, /submissionKeys\.getOrCreate\("enrollment-rows"/)
  assert.match(source, /sm:grid-cols/)
})

test("enrollment decision exposes waiting and not-registered before a batch starts", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /routeRegistrationEnrollmentDecision/)
  assert.match(source, /대기로 전환/)
  assert.match(source, /미등록 완료/)
  assert.match(source, /current_class/)
  assert.match(source, /reason/)
})

test("case admission panel selects exact rows and renders the ordered mixed-subject batch checklist", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /export function RegistrationAdmissionPanel/)
  assert.match(source, /currentBatchEnrollments\.map/)
  assert.match(source, /trackById\.get\(enrollment\.trackId\)/)
  assert.match(source, /selectedEnrollmentIds/)
  assert.match(source, /selectedTrackIds/)
  assert.match(source, /startRegistrationAdmissionBatch/)
  assert.match(source, /setRegistrationEnrollmentMakeedu/)
  assert.match(source, /advanceRegistrationAdmissionBatch/)
  assert.match(source, /completeRegistrationAdmissionBatch/)
  assert.match(source, /cancelRegistrationAdmissionBatch/)
  assert.match(source, /cancelRegistrationEnrollment/)
  assert.match(source, /입학신청서 발송/)
  assert.match(source, /메이크에듀 등록/)
  assert.match(source, /청구서 발송/)
  assert.match(source, /수납 완료 확인/)
  assert.match(source, /등록 완료/)
  assert.match(source, /이전 입학 처리/)
})

test("case admission message states stay actionable independently of the selected subject", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /getRegistrationAdmissionApplicationState/)
  assert.match(source, /발송 처리 중/)
  assert.match(source, /발송 접수됨 · 상태 동기화 필요/)
  assert.match(source, /발송 결과 확인 필요/)
  assert.match(source, /미접수 확인 · 재발송 잠금/)
  assert.match(source, /onCheckAdmissionMessage/)
  assert.match(source, /onReconcileAdmissionMessage/)
  assert.match(source, /onReleaseAdmissionMessageRetry/)
  assert.match(source, /onSendAdmissionMessage/)
})

test("unified track editor and workspace mount subject rows plus one case-level admission panel", async () => {
  const trackEditor = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  assert.match(trackEditor, /RegistrationEnrollmentEditor/)
  assert.match(trackEditor, /track=\{selectedTrack\}/)
  assert.match(trackEditor, /enrollments=\{detail\.enrollments/)

  const shell = await readWorkspaceSource()
  assert.match(shell, /import \{ RegistrationAdmissionPanel \}/)
  assert.match(shell, /caseLevelActions=\{/)
  assert.match(shell, /<RegistrationAdmissionPanel/)
  assert.doesNotMatch(shell, /caseLevelActions=\{null\}/)
})

test("committed enrollment and admission actions recover refresh without resubmitting mutations", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const enrollmentBlock = sourceBetween(source, "export function RegistrationEnrollmentEditor", "export type RegistrationAdmissionPanelProps")
  const admissionBlock = sourceBetween(source, "export function RegistrationAdmissionPanel", "return (\n    <section")
  assert.match(enrollmentBlock, /async function retryEnrollmentReload/)
  assert.match(enrollmentBlock, /await onReload\(\)[\s\S]*setRefreshPending\(false\)[\s\S]*catch[\s\S]*setRefreshPending\(true\)/)
  assert.doesNotMatch(enrollmentBlock, /setRefreshPending\(true\)\s*\n\s*await reloadCommitted/)
  assert.match(admissionBlock, /async function retryAdmissionReload/)
  assert.match(admissionBlock, /await onReload\(\)[\s\S]*setRefreshPending\(false\)[\s\S]*catch[\s\S]*setRefreshPending\(true\)/)
  assert.match(source, /onClick=\{\(\) => void retryEnrollmentReload\(\)\}/)
  assert.match(source, /onClick=\{\(\) => void retryAdmissionReload\(\)\}/)
})

test("registered add-class starts empty and cannot submit an empty draft list", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /track\.status === "enrollment_decided"[\s\S]*createRegistrationEnrollmentDraft/)
  assert.match(source, /disabled=\{saving \|\| refreshPending \|\| draftRows\.length === 0 \|\| blockers\.length > 0\}/)
  assert.match(source, /row\.id === null && draftRows\.length === 1 && track\.status === "enrollment_decided"/)
})

test("persisted planned rows cancel explicitly and class detail failures can be retried", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /row\.id === null \? "삭제" : "수강 취소"/)
  assert.match(source, /row\.id === null[\s\S]*setCancelEnrollmentId\(row\.id\)/)
  assert.match(source, /classDetailRetryToken/)
  assert.match(source, /수업 일정 다시 불러오기/)
  assert.match(source, /activeEnrollmentRows/)
})

test("batch cancellation requires each first-admission destination and message recovery respects the server delay", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /cancelDestinations\[trackId\] \|\| ""/)
  assert.match(source, /resolutions\.some\(\(item\) => !item\.destination\)/)
  assert.match(source, /messageRecoveryAvailable/)
  assert.match(source, /발송 후 15분이 지나면 확인할 수 있습니다/)
})

test("enrollment and batch cancellation UI consumes the canonical history classifiers", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /getRegistrationEnrollmentCancellationState/)
  assert.match(source, /getRegistrationAdmissionBatchCancellationGroups/)
  assert.match(source, /selectedEnrollmentCancellation\.requiresDestination/)
  assert.doesNotMatch(source, /const otherActiveRows/)
  assert.doesNotMatch(source, /enrollment\.admissionBatchId !== openBatch\?\.id[\s\S]*enrollment\.rosterActive/)
  assert.match(source, /setCancelDestination\(""\)[\s\S]*setCancelEnrollmentId\(row\.id\)/)
  assert.match(source, /setCancelDestinations\(\{\}\)[\s\S]*setCancelBatchOpen\(true\)/)
})

test("an unrelated subject open batch does not block registered draft editing", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const editorBlock = sourceBetween(source, "export function RegistrationEnrollmentEditor", "export type RegistrationAdmissionPanelProps")
  const canEditBlock = sourceBetween(editorBlock, "const canEditRows", "const selectedCancelEnrollment")
  assert.match(canEditBlock, /!trackHasOpenBatch/)
  assert.doesNotMatch(canEditBlock, /&& !openBatch/)
  const service = await readFile(new URL("../src/features/tasks/registration-track-service.ts", import.meta.url), "utf8")
  const saveBlock = sourceBetween(service, "async function saveRegistrationEnrollmentRows", "async function claimRegistrationAdmissionMessage")
  assert.doesNotMatch(saveBlock, /admissionBatches|hasOtherOpenBatch/)
})

test("persisted null textbooks remain explicitly cleared after editor remount", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /restoreRegistrationEnrollmentDraft/)
  assert.doesNotMatch(source, /textbookExplicitlyCleared:\s*false,\s*\n\s*textbookId:\s*enrollment\.textbookId/)
})

test("read-only admission viewers see checklist status without mutation buttons", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /permissions\.canManage \? \([\s\S]*3\. 청구서 발송[\s\S]*4\. 수납 완료 확인[\s\S]*5\. 등록 완료/)
  assert.match(source, /aria-label="읽기 전용 입학 처리 상태"/)
  assert.match(source, /const isAddClass = addClassTrackIds\.includes\(trackId\)/)
  assert.match(source, /isAddClass \? <span[\s\S]*기존 등록 유지/)
})

test("admission batch selection ignores stale IDs when enabling and submitting", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /getRegistrationSelectedAdmissionEnrollmentIds/)
  assert.match(source, /activeSelectedEnrollmentIds\.length === 0/)
  assert.match(source, /const enrollmentIds = activeSelectedEnrollmentIds/)
})

test("admission recovery schedules a rerender at the canonical available time", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /useAdmissionRecoveryAvailable/)
  assert.match(source, /getRegistrationAdmissionRecoveryDelayMs/)
  assert.match(source, /setTimeout\(/)
  assert.match(source, /clearTimeout\(/)
})

test("every enrollment decision and cancellation handler locks after a committed refresh failure", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const routeBlock = sourceBetween(source, "async function routeDecision", "async function cancelPersistedEnrollment")
  const cancelBlock = sourceBetween(source, "async function cancelPersistedEnrollment", "const immutableHistory")
  const startBlock = sourceBetween(source, "async function startBatch", "async function setMakeedu")
  assert.match(routeBlock, /refreshPending/)
  assert.match(cancelBlock, /refreshPending/)
  assert.match(startBlock, /busyAction \|\| refreshPending/)
  assert.match(source, /disabled=\{!decisionDestination \|\| !decisionReason\.trim\(\) \|\| saving \|\| refreshPending\}/)
  assert.match(source, /disabled=\{!cancelReason\.trim\(\) \|\| saving \|\| refreshPending/)
})

test("an unrelated subject open batch does not hide enrollment decision routing", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const decisionSection = sourceBetween(source, "{track.status === \"enrollment_decided\" && permissions.canManage", "immutableHistory.length > 0")
  assert.match(decisionSection, /!trackHasOpenBatch/)
  assert.doesNotMatch(decisionSection, /!openBatch/)
})
