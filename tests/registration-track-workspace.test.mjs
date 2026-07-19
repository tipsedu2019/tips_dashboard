import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listUrl = new URL(
  "../src/features/tasks/registration-case-list.tsx",
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

async function readRegistrationApplicationSource() {
  const [actions, application] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
  ])
  return `${actions}\n${application}`
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start + startMarker.length, end);
}

test("registration application shell renders all six sections once in fixed order without stage navigation", async () => {
  const shell = await readFile(new URL("../src/features/tasks/registration-application-shell.tsx", import.meta.url), "utf8")
  const inquiry = await readFile(new URL("../src/features/tasks/registration-application-inquiry-section.tsx", import.meta.url), "utf8")

  const titles = ["문의 정보", "레벨테스트", "상담", "등록·대기 정보", "입학 처리", "자동 이력"]
  let previous = -1
  for (const title of titles) {
    const index = shell.indexOf(title)
    assert.ok(index > previous, `${title} is rendered after the preceding section`)
    assert.equal(shell.indexOf(title, index + 1), -1, `${title} is rendered exactly once`)
    previous = index
  }
  assert.match(shell, /aria-disabled/)
  assert.match(shell, /editable/)
  assert.match(shell, /isRegistrationApplicationSectionContentDisabled/)
  assert.match(shell, /<fieldset[\s\S]*disabled=\{contentDisabled\}/)
  assert.match(shell, /closeAction: ReactNode/)
  assert.match(shell, /\{props\.closeAction\}/)
  assert.match(inquiry, /inquiryAt/)
  assert.match(inquiry, /저장 시 자동 기록/)
  assert.match(inquiry, /exceptionContent/)
  assert.doesNotMatch(shell, /이전|다음|stage tabs|StageTabs/)
})

test("registration create mounts the shared cumulative application with visible locked future fields", async () => {
  const create = await readFile(new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url), "utf8")
  const initialPlan = await readFile(new URL("../src/features/tasks/registration-initial-plan-control.tsx", import.meta.url), "utf8")
  const levelTest = await readFile(new URL("../src/features/tasks/registration-application-level-test-section.tsx", import.meta.url), "utf8")
  const consultation = await readFile(new URL("../src/features/tasks/registration-application-consultation-section.tsx", import.meta.url), "utf8")
  const placement = await readFile(new URL("../src/features/tasks/registration-application-placement-section.tsx", import.meta.url), "utf8")
  const admission = await readFile(new URL("../src/features/tasks/registration-application-admission-section.tsx", import.meta.url), "utf8")
  const workspace = await readWorkspaceSource()

  assert.match(create, /import \{ RegistrationApplicationShell \} from "\.\/registration-application-shell"/)
  assert.match(create, /import \{ RegistrationApplicationInquirySection \} from "\.\/registration-application-inquiry-section"/)
  assert.match(create, /getRegistrationCreateSectionStates/)
  assert.match(create, /RegistrationInitialRouteFields/)
  assert.match(create, /RegistrationInitialLevelTestFields/)
  assert.match(create, /RegistrationInitialConsultationFields/)
  assert.match(create, /allowedInitialActions=\{persistence\.mode === "ready_atomic"/)
  assert.match(create, /persistence\.mode === "ready_atomic"[\s\S]*?\["inquiry", "direct_phone", "level_test", "visit"\][\s\S]*?\["inquiry"\]/)
  assert.match(create, /useEffect\([\s\S]*?reconcileRegistrationInitialWorkflowCapabilities/)
  assert.doesNotMatch(create, /<form\b/)
  assert.doesNotMatch(create, /useState\(|createRegistrationInitialWorkflowDraft/)

  const inquiryFields = ["과목", "학생명", "학년", "학교", "학부모 전화", "학생 전화", "요청 사항"]
  let inquiryCursor = -1
  for (const field of inquiryFields) {
    const next = create.indexOf(field, inquiryCursor + 1)
    assert.ok(next > inquiryCursor, `${field} follows the approved inquiry order`)
    inquiryCursor = next
  }
  assert.match(create, /mode="create"/)
  assert.match(create, /inquiryAt=\{null\}/)
  assert.match(create, /저장 시 자동 기록|RegistrationApplicationInquirySection/)
  assert.doesNotMatch(create + workspace, /문의 채널|문의채널|inquiryChannel/)

  assert.match(initialPlan, /export function RegistrationInitialRouteFields/)
  assert.match(initialPlan, /allowedInitialActions/)
  assert.match(initialPlan, /PLAN_OPTIONS\.filter/)
  assert.match(levelTest + initialPlan, /레벨테스트 예약일시/)
  assert.match(levelTest + initialPlan, /레벨테스트 장소/)
  assert.match(consultation + initialPlan, /상담 책임자[\s\S]*전화상담 대기 기준일시[\s\S]*방문상담일시[\s\S]*방문상담실[\s\S]*상담 결과/)
  assert.match(placement + create, /대기 종류/)
  assert.match(placement + create, /수업 시작 일정/)
  for (const label of ["입학신청서 발송", "메이크에듀 등록(수업, 교재)", "청구서 발송", "수납 완료 확인", "등록 완료"]) {
    assert.ok((admission + create).includes(label), label)
  }
  assert.match(create, /첫 저장 후 자동 기록됩니다/)
  assert.doesNotMatch(create, /onSaveHistory|이력 추가|이력 수정|이력 삭제/)
})

test("registration create keeps the complete approved future field packet mounted in order", async () => {
  const create = await readFile(new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url), "utf8")
  const initialPlan = await readFile(new URL("../src/features/tasks/registration-initial-plan-control.tsx", import.meta.url), "utf8")
  const levelTest = sourceBetween(
    initialPlan,
    "export function RegistrationInitialLevelTestFields",
    "export function RegistrationInitialConsultationFields",
  )
  const placement = sourceBetween(
    create,
    "placement={(\n",
    "admission={(\n",
  )

  const assertOrdered = (source, labels) => {
    let cursor = -1
    for (const label of labels) {
      const next = source.indexOf(label, cursor + 1)
      assert.ok(next > cursor, `${label} follows the approved order`)
      cursor = next
    }
  }

  assertOrdered(levelTest, [
    'label="진행상태"',
    "<span>예약일시</span>",
    "<span>장소</span>",
    'label="시험 시작·완료 상태"',
    "<span>시험지·결과지 링크</span>",
    'label="결과"',
  ])
  assertOrdered(placement, [
    "대기 종류",
    'label="대기 수업"',
    'label="등록 단계"',
    'label="수강 수업"',
    'label="교재"',
    'label="수업 시작일·회차"',
    'label="입학 처리 시작 행동"',
    'label="문의 요청 사항"',
  ])
  assert.match(levelTest, /data-registration-focus="levelTestAt"/)
  assert.match(levelTest, /data-registration-focus="levelTestPlace"/)
  assert.match(initialPlan, /data-registration-focus=\{`counselor:\$\{subject\}`\}/)
  assert.match(initialPlan, /data-registration-focus="visitConsultationAt"/)
  assert.match(initialPlan, /data-registration-focus="visitConsultationPlace"/)
})

test("registration create owns one accurate inquiry lock reason without a duplicate runtime note", async () => {
  const create = await readFile(new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url), "utf8")

  assert.match(create, /const inquiryLockReason = disabled[\s\S]*?저장 중입니다/)
  assert.match(create, /persistence\.mode\.startsWith\("blocked_"\)[\s\S]*?note/)
  assert.match(create, /inquiry: \{ \.\.\.base\.inquiry, lockReason: inquiryLockReason \}/)
  assert.match(create, /const showInquiryOnlyNote = persistence\.mode === "canonical_inquiry"[\s\S]*?legacy_inquiry/)
  assert.match(create, /exceptionContent=\{showInquiryOnlyNote/)
  assert.doesNotMatch(create, /exceptionContent=\{note \?/)
})

async function loadCaseListModel() {
  return import("../src/features/tasks/registration-case-list-model.ts");
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
        phoneReadyAt: "2026-07-10T02:00:00Z",
        phoneReadySource: "inquiry",
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

function consultationItem(trackId, stageEnteredAt, phoneReadyAt, mode = "phone") {
  return {
    key: `case:${trackId}`,
    taskId: "case",
    trackId,
    status: mode === "phone" ? "consultation_waiting" : "visit_consultation_scheduled",
    stageEnteredAt,
    phoneReadyAt,
  }
}

test("case list renders one keyed application row in each responsive surface", async () => {
  const source = await readListSource();

  assert.match(source, /export function RegistrationCaseList/);
  assert.match(source, /export function RegistrationCaseListRow/);
  assert.match(source, /data-testid="registration-case-desktop-list"/);
  assert.match(source, /data-testid="registration-case-mobile-list"/);
  assert.match(source, /key=\{item\.taskId\}/);
  assert.match(source, /item\.tracks\.map/);
  assert.match(source, /item\.matchingTracks\.map/);
  assert.match(source, /REGISTRATION_CASE_INITIAL_RENDER_LIMIT = 40/);
});

test("case projection retains canonical phone and visit dates", async () => {
  const { getRegistrationCaseTrackTimeValue } = await loadCaseListModel()
  assert.equal(getRegistrationCaseTrackTimeValue({ status: "consultation_waiting", stageEnteredAt: "stage", phoneReadyAt: "phone", visitScheduledAt: "visit" }), "phone")
  assert.equal(getRegistrationCaseTrackTimeValue({ status: "visit_consultation_scheduled", stageEnteredAt: "stage", phoneReadyAt: null, visitScheduledAt: "visit" }), "visit")
})

test("one parent application remains one list item while retaining every subject", async () => {
  const { buildRegistrationCaseListItems } = await loadCaseListModel();
  const items = buildRegistrationCaseListItems(fixtureTasks());

  assert.equal(items.length, 1);
  assert.equal(items[0].taskId, "case-1");
  assert.deepEqual(items[0].tracks.map((item) => item.trackId), ["eng", "math"]);
});

test("one application can appear in different views without duplicating a view row", async () => {
  const {
    buildRegistrationCaseListItems,
    filterRegistrationCaseListItems,
  } = await loadCaseListModel();
  const items = buildRegistrationCaseListItems(fixtureTasks());

  assert.deepEqual(
    plain(filterRegistrationCaseListItems(items, "consulting").map((item) => item.taskId)),
    ["case-1"],
  );
  assert.deepEqual(
    plain(filterRegistrationCaseListItems(items, "level_test").map((item) => item.taskId)),
    ["case-1"],
  );
});

test("application search narrows the selected view by student, phone, subject, director, and place", async () => {
  const {
    buildRegistrationCaseListItems,
    filterRegistrationCaseListItems,
  } = await loadCaseListModel();
  const tasks = fixtureTasks();
  tasks[0].registration = {
    parentPhone: "010-1234-5678",
    studentPhone: "010-8765-4321",
  };
  tasks.push({
    ...tasks[0],
    id: "case-visit",
    title: "등록: 박방문",
    studentName: "박방문",
    registration: {
      parentPhone: "010-9999-0000",
      studentPhone: "",
    },
    registrationTracks: [{
      ...tasks[0].registrationTracks[0],
      id: "math-visit",
      subject: "수학",
      status: "visit_consultation_scheduled",
      directorName: "이상담",
      visitScheduledAt: "2026-07-20T09:00:00Z",
      visitPlace: "별관 상담실",
    }],
  });
  const items = buildRegistrationCaseListItems(tasks);

  for (const query of ["김다미", "1234-5678", "영어", "강부희"]) {
    assert.deepEqual(
      plain(filterRegistrationCaseListItems(items, "consulting", query).map((item) => item.taskId)),
      ["case-1"],
      `${query} should find only the matching application`,
    );
  }
  for (const query of ["박방문", "9999-0000", "이상담", "별관 상담실"]) {
    assert.deepEqual(
      plain(filterRegistrationCaseListItems(items, "consulting", query).map((item) => item.taskId)),
      ["case-visit"],
      `${query} should find only the matching application`,
    );
  }
  assert.deepEqual(
    plain(filterRegistrationCaseListItems(items, "consulting", "수학").map((item) => item.taskId)),
    ["case-1", "case-visit"],
    "subject search should find every matching application in the current view",
  )
});

test("phone consultation applications are oldest-first without reordering other views", async () => {
  const {
    buildRegistrationCaseListItems,
    filterRegistrationCaseListItems,
  } = await loadCaseListModel();
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
      phoneReadyAt: "2026-07-12T02:00:00Z",
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

  const items = buildRegistrationCaseListItems(tasks);
  const originalItems = plain(items);
  assert.deepEqual(
    plain(filterRegistrationCaseListItems(items, "consulting").map((item) => item.taskId)),
    ["case-1", "case-2", "case-3"],
  );
  assert.deepEqual(
    plain(filterRegistrationCaseListItems(items, "level_test").map((item) => item.taskId)),
    ["case-1", "case-4"],
  );
  assert.deepEqual(plain(items), originalItems, "filtering must not mutate the shared track list");
});

test("case list renders application-scoped desktop and mobile rows", async () => {
  const source = await readListSource();
  const rowSource = sourceBetween(source, "export function RegistrationCaseListRow", "export function RegistrationCaseList");

  assert.match(source, /export function RegistrationCaseList/);
  assert.match(source, /data-testid="registration-case-desktop-list"/);
  assert.match(source, /data-testid="registration-case-mobile-list"/);
  assert.match(source, /item\.studentName/);
  assert.match(source, /item\.tracks\.map/);
  assert.match(source, /item\.matchingTracks\.map/);
  assert.match(source, /min-w-0/);
  assert.match(source, /overflow-hidden/);
  assert.match(source, /REGISTRATION_CASE_INITIAL_RENDER_LIMIT/);
  assert.match(source, /visibleItems/);
  assert.match(source, /windowState\.key === itemSetKey/);
  assert.match(source, /setWindowState/);
  assert.match(source, /더 보기/);
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /visitScheduledAt/);
  assert.match(source, /visitPlace/);
  assert.match(source, /phoneReadyAt/);
  assert.match(source, /className="grid min-w-0 gap-2 p-2 lg:hidden"/);
  assert.match(source, /className="hidden w-full min-w-0 overflow-hidden lg:block"/);
  assert.doesNotMatch(source, /md:hidden|md:block/);
  assert.match(source, /item\.representativeTrack\.trackId/);
  assert.match(source, /break-words \[overflow-wrap:anywhere\]/);
});

test("desktop application rows provide one table cell for each column while mobile cards stay shared", async () => {
  const source = await readListSource();
  const desktopSource = sourceBetween(source, 'data-testid="registration-case-desktop-list"', "{hasMore ? (");

  assert.match(desktopSource, /<RegistrationCaseListRow item=\{item\}[\s\S]*?cellRole="cell"/);
  assert.match(source, /role=\{cellRole\}/);
  assert.equal((source.match(/role=\{cellRole\}/g) || []).length, 3);
});

test("registration summaries wrap long operational values instead of clipping them", async () => {
  const editorSource = await readRegistrationApplicationSource();
  const enrollmentSource = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8");
  const summarySource = sourceBetween(editorSource, "function RegistrationLevelTestSummary", "const REGISTRATION_DIRECTOR_VISIBLE_STATUSES");

  assert.doesNotMatch(summarySource, /min-w-0 truncate/);
  assert.match(summarySource, /break-words \[overflow-wrap:anywhere\]/);
  assert.doesNotMatch(enrollmentSource, /className="min-w-0 flex-1 truncate">\{classItem\?\.label/);
  assert.match(enrollmentSource, /className="min-w-0 flex-1 break-words \[overflow-wrap:anywhere\]"/);
});

test("selected visit consultation card shows the canonical appointment time and place", async () => {
  const source = await readRegistrationApplicationSource()
  assert.match(source, /visitAppointment/)
  assert.match(source, /visitConsultation\?\.appointmentId/)
  assert.match(source, /방문상담일시/)
  assert.match(source, /방문상담실/)
  assert.match(source, /visitAppointment\?\.scheduledAt/)
  assert.match(source, /visitAppointment\?\.place/)
})

test("selected phone consultation card shows active readiness without a stage fallback", async () => {
  const source = await readRegistrationApplicationSource()
  const phoneCard = sourceBetween(
    source,
    'if (track.status === "consultation_waiting")',
    'if (["level_test_scheduled", "level_test_in_progress"].includes(track.status))',
  )

  assert.match(phoneCard, /전화상담 대기 기준일시/)
  assert.match(phoneCard, /activeConsultation\?\.readyAt/)
  assert.match(phoneCard, /formatRegistrationDateTime/)
  assert.doesNotMatch(phoneCard, /stageEnteredAt/)
  assert.match(source, /activeConsultation=\{activeConsultation\}/)
})

test("unbatched enrollment drafts may omit a schedule while batch start requires complete schedules", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const draftBlock = sourceBetween(source, "const blockers = useMemo", "function updateRow")
  assert.match(draftBlock, /requireSchedule:\s*false/)
  assert.match(source, /selectedEnrollmentsHaveCompleteSchedules/)
  assert.match(source, /입학 처리 전에 선택한 모든 수업의 시작 일정을 지정하세요/)
})

test("case list permissions are summary hints and each quick action remains subject-scoped", async () => {
  const source = await readListSource();

  assert.match(source, /getRegistrationSummaryActionPermissions/);
  assert.match(source, /canOpenConsultationCompletion/);
  assert.match(source, /onOpen\(item\.taskId, item\.representativeTrack\.trackId\)/);
  assert.match(source, /onEdit\(item\.taskId, item\.representativeTrack\.trackId\)/);
  assert.match(source, /onAction\(item\.taskId, track\.trackId, "complete_consultation"\)/);
  assert.match(source, /strict detail permission/i);
  assert.doesNotMatch(source, /getRegistrationActionPermissions/);
  assert.doesNotMatch(source, /\.consultations/);
  assert.match(
    source,
    /representativePermissions\.canManage[\s\S]*?onEdit\(item\.taskId, item\.representativeTrack\.trackId\)[\s\S]*?:[\s\S]*?onOpen\(item\.taskId, item\.representativeTrack\.trackId\)/,
    "one contextual open action should replace duplicate detail and management buttons",
  );
  assert.match(source, /aria-label=\{`\$\{track\.subject\} \$\{item\.studentName\} \$\{consultationActionLabel\}`\}/);
});

test("workspace derives tab counts from application cases before filtering the selected view", async () => {
  const source = await readWorkspaceSource();

  assert.match(source, /buildRegistrationCaseListItems/);
  assert.match(source, /filterRegistrationCaseListItems/);
  assert.match(source, /getRegistrationCaseTabCounts/);
  assert.match(source, /const registrationCaseItems = useMemo/);
  assert.match(source, /getRegistrationCaseTabCounts\(registrationCaseItems\)/);
  assert.match(source, /const visibleRegistrationCaseItems = useMemo/);
  assert.match(source, /filterRegistrationCaseListItems\(registrationCaseItems, registrationView, deferredQuery\)/);
  assert.match(source, /<RegistrationCaseList/);
  assert.match(source, /items=\{visibleRegistrationCaseItems\}/);
  assert.match(source, /viewerId=\{registrationViewerId\}/);
  assert.match(source, /viewerRole=\{registrationViewerRole\}/);
  assert.doesNotMatch(source, /\bregistrationPipeline\b/);
  assert.doesNotMatch(source, /isRegistrationPipelineInView/);
  assert.match(source, /const visibleWorkspaceItemCount = isRegistrationWorkspace[\s\S]*?visibleRegistrationCaseItems\.length/);
  assert.match(source, /shouldHideEmptySurface = !loading && visibleWorkspaceItemCount === 0/);
  assert.match(source, /const registrationEmptyLabel = hasQuery[\s\S]*?현재 단계에서 검색 결과가 없습니다\./);
  assert.match(source, /등록 업무가 없습니다\./);
  assert.match(source, /emptyLabel=\{registrationEmptyLabel\}/);
  assert.match(
    source,
    /loading \? \(\s*isRegistrationWorkspace \? \([\s\S]*?등록 업무를 불러오는 중입니다\./,
  );
});

test("registration deep links preserve task, track, and appointment ids and clear them on close", async () => {
  const source = await readWorkspaceSource();
  const deepLinkEffect = sourceBetween(
    source,
    "  useEffect(() => {\n    if (deleteTarget) return",
    "\n  function handleDetailOpenChange",
  );
  const closeHandler = sourceBetween(
    source,
    "  function handleDetailOpenChange",
    "\n  function closeForm",
  );

  assert.match(source, /const \[selectedRegistrationTrackId, setSelectedRegistrationTrackId\] = useState/);
  assert.match(source, /searchParams\.set\("trackId", nextTrackId\)/);
  assert.match(source, /searchParams\.delete\("trackId"\)/);
  assert.match(source, /searchParams\.set\("appointmentId", nextAppointmentId\)/);
  assert.match(source, /searchParams\.delete\("appointmentId"\)/);
  assert.match(source, /syncTaskDeepLink\(taskId, trackId\)/);
  assert.match(deepLinkEffect, /const currentSearchParams = new URLSearchParams\(window\.location\.search\)/);
  assert.match(deepLinkEffect, /currentSearchParams\.get\("taskId"\)/);
  assert.match(deepLinkEffect, /currentSearchParams\.get\("trackId"\)/);
  assert.doesNotMatch(deepLinkEffect, /searchParams\.get\(/);
  assert.match(deepLinkEffect, /setSelectedRegistrationTrackId\(deepLinkedTrackId\)/);
  assert.match(closeHandler, /setDetailOpen\(nextOpen\)/);
  assert.match(closeHandler, /setSelectedRegistrationTrackId\(null\)/);
  assert.match(closeHandler, /setRegistrationCaseDetail\(null\)/);
  assert.match(closeHandler, /syncTaskDeepLink\(null\)/);
  assert.match(source, /if \(isLegacyRegistrationTrackId\(trackId\)\)/);
  assert.match(source, /syncTaskDeepLink\(taskId, null\)/);
  assert.match(source, /deepLinkedTask\.type !== "registration" && \(deepLinkedTrackId \|\| deepLinkedAppointmentId\)[\s\S]*?syncTaskDeepLink\(deepLinkedTaskId, null\)/);
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
  assert.match(source, /setSelectedRegistrationTrackId\(trackId\)/)
  assert.match(source, /focusTrackId=\{selectedRegistrationTrackId\}/)
});

test("track editor shows common information once and subject-scoped navigation", async () => {
  const source = await readRegistrationApplicationSource()
  const commonInfoSource = sourceBetween(
    source,
    "function RegistrationCommonInfoSection(",
    "function RegistrationSubjectSyncSection(",
  )
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
  assert.doesNotMatch(commonInfoSource, /문의일시|DateTimePickerControl/)
  assert.match(
    commonInfoSource,
    /inquiryAt: toLocalDateTime\(registration\.inquiryAt \|\| task\.createdAt\)/,
    "legacy cases without inquiryAt must remain editable by falling back to their immutable creation time",
  )
  assert.match(commonInfoSource, /campus: task\.campus \|\| "본관"/)
  assert.match(commonInfoSource, /const valid = Boolean\([\s\S]*?draft\.campus\.trim\(\)[\s\S]*?draft\.inquiryAt/)
  assert.match(commonInfoSource, /inquiryAt: draft\.inquiryAt/)
  assert.doesNotMatch(commonInfoSource, /requiredLabel\("캠퍼스"|aria-label="캠퍼스"/)
  assert.doesNotMatch(commonInfoSource, /requiredLabel\("우선순위"/)
  assert.match(source, /필수/)
})

test("canonical detail uses one progressively filled registration application", async () => {
  const source = await readRegistrationApplicationSource()

  assert.match(source, /import \{ RegistrationApplicationShell \} from "\.\/registration-application-shell"/)
  assert.match(source, /<RegistrationApplicationShell/)
  assert.match(source, /mode="detail"/)
  assert.match(source, /inquiry=\{/)
  assert.match(source, /levelTest=\{/)
  assert.match(source, /consultation=\{/)
  assert.match(source, /placement=\{/)
  assert.match(source, /admission=\{/)
  assert.match(source, /history=\{<RegistrationHistoryTimeline/)
  assert.doesNotMatch(source, /role="tablist" aria-label="과목별 등록 진행"/)
})

test("one application keeps both subject states and prior-stage values visible", async () => {
  const source = await readRegistrationApplicationSource()

  assert.match(source, /function RegistrationSubjectProgress/)
  assert.match(source, /aria-label="과목별 진행 현황"/)
  assert.match(source, /detail\.tracks\.map\(\(track\) =>/)
  assert.match(source, /STATUS_LABELS\[track\.status\]/)
  assert.match(source, /function RegistrationLevelTestSummary/)
  assert.match(source, /detail\.levelTests/)
  assert.match(source, /detail\.appointments/)
  assert.match(source, /function RegistrationConsultationSummary/)
  assert.match(source, /detail\.consultations/)
  assert.match(source, /function RegistrationPlacementSummary/)
  assert.match(source, /detail\.enrollments/)
})

test("two tracks at different statuses expose both current sections and actions in one saved application", async () => {
  const [source, actions, applicationModel] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8"),
    import("../src/features/tasks/registration-application-model.ts"),
  ])
  const makeTrack = (id, subject, status) => ({
    id,
    taskId: "registration-case",
    subject,
    status,
    legacy: false,
    directorProfileId: "director-1",
    directorName: "담당 원장",
    directorAssignmentSource: "default",
    directorAssignmentRuleKey: "fixture",
    waitingKind: "",
    levelTestRetakeDecision: "",
    migrationReviewRequired: false,
    stageEnteredAt: "2026-07-20T00:00:00Z",
    phoneReadyAt: null,
    phoneReadySource: null,
  })
  const states = [
    applicationModel.getRegistrationApplicationTrackState({
      track: makeTrack("english-track", "영어", "level_test_scheduled"),
      canManage: true,
      canCompleteConsultation: false,
    }),
    applicationModel.getRegistrationApplicationTrackState({
      track: makeTrack("math-track", "수학", "consultation_waiting"),
      canManage: true,
      canCompleteConsultation: true,
    }),
  ]

  assert.deepEqual(states.map((state) => state.currentSection), ["level_test", "consultation"])
  assert.deepEqual(states[0].sections.level_test.actions, ["start_level_test", "record_level_test_result", "cancel_level_test"])
  assert.ok(states[1].sections.consultation.actions.includes("complete_phone_consultation"))
  assert.match(source, /detail\.tracks\.map\(\(track\) => getRegistrationApplicationTrackState/)
  assert.match(source, /trackContexts\.map/)
  assert.match(source, /<RegistrationApplicationShell/)
  assert.doesNotMatch(source, /focusTrackId === context\.track\.id\) \? \(\s*<RegistrationConsultationOutcomeEditor/)
  assert.match(actions, /export function RegistrationTrackStageEditor/)
  assert.match(actions, /export function RegistrationEnrollmentTrackEditor/)
  assert.doesNotMatch(source, /selectedStageEditor|현재 업무/)
})

test("terminal subjects do not gate common edits and progressed subjects cannot be removed by sync", async () => {
  const [application, actions] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8"),
  ])
  const saveCommon = sourceBetween(application, "async function saveCommon", "function openAppointment")
  const syncSection = sourceBetween(actions, "export function RegistrationSubjectSyncSection", "function SubjectClassSelect")

  assert.match(application, /<RegistrationCommonInfoSection[\s\S]*?canEdit=\{canManageCase\}/)
  assert.doesNotMatch(saveCommon, /syncRegistrationCaseSubjects|subjects:/)
  assert.match(syncSection, /track\.status === "inquiry" && !track\.migrationReviewRequired/)
  assert.match(syncSection, /subjects\.includes\(subject\) && !removableSubjects\.has\(subject\)/)
  assert.match(syncSection, /syncRegistrationCaseSubjects/)
})

test("two decided subjects share one admission send action and expose two badges", async () => {
  const [application, enrollment] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8"),
  ])
  const decidedTracks = [
    { id: "english-track", subject: "영어", status: "enrollment_decided" },
    { id: "math-track", subject: "수학", status: "enrollment_decided" },
  ]
  const badges = decidedTracks.filter((track) => track.status === "enrollment_decided").map((track) => track.subject)

  assert.deepEqual(badges, ["영어", "수학"])
  assert.equal((application.match(/<RegistrationAdmissionPanel/g) || []).length, 1)
  assert.match(application, /getRegistrationApplicationCaseEditableSections\(\{[\s\S]*?admissionBatches: detail\.admissionBatches/)
  assert.match(application, /getRegistrationAdmissionApplicationState\(\{[\s\S]*?tracks: detail\.tracks,[\s\S]*?enrollments: detail\.enrollments/)
  assert.match(application, /admissionApplicationState\.canSend/)
  assert.match(application, /detail\.tracks\.filter\(\(track\) => track\.status === "enrollment_decided"\)\.map/)
  assert.equal((enrollment.match(/>입학신청서 발송<\/Button>/g) || []).length, 1)
})

test("saved and create applications share one six-section shell with inline owning editors", async () => {
  const [detail, create, actions, appointment, workspace] = await Promise.all([
    readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-create.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8"),
    readWorkspaceSource(),
  ])

  for (const consumer of [detail, create]) {
    assert.match(consumer, /import \{ RegistrationApplicationShell \} from "\.\/registration-application-shell"/)
    assert.match(consumer, /import \{ RegistrationApplicationInquirySection \} from "\.\/registration-application-inquiry-section"/)
    assert.match(consumer, /RegistrationApplicationLevelTestSection/)
    assert.match(consumer, /RegistrationApplicationConsultationSection/)
    assert.match(consumer, /RegistrationApplicationPlacementSection/)
    assert.match(consumer, /RegistrationApplicationAdmissionSection/)
  }
  assert.match(detail, /closeAction=\{closeAction\}/)
  assert.match(workspace, /showCloseButton=\{!canonicalRegistrationApplicationRendered\}/)
  assert.match(workspace, /closeAction=\{registrationDetailCloseAction\}/)
  assert.match(appointment, /embedded\?: boolean/)
  assert.match(appointment, /embedded\s*\?/)
  const outcome = sourceBetween(
    actions,
    "export function RegistrationConsultationOutcomeEditor",
    "export function RegistrationMigrationReviewEditor",
  )
  assert.doesNotMatch(outcome, /<Dialog|<DialogContent/)
  assert.doesNotMatch(detail + create + actions, /<Dialog[\s>]|<DialogContent/)
})

test("saved application keeps exception actions in their owning sections", async () => {
  const source = await readRegistrationApplicationSource()
  const inquiry = sourceBetween(source, "inquiry={(\n", "levelTest={(\n")
  const placement = sourceBetween(source, "placement={(\n", "admission={(\n")
  const admission = sourceBetween(source, "admission={(\n", "history={")

  assert.match(inquiry, /RegistrationMigrationReviewEditor/)
  assert.match(inquiry, /renderTrackFrames\("inquiry"\)/)
  assert.match(placement, /renderTrackFrames\("placement"\)/)
  assert.match(source, /section === "placement"[\s\S]*?<RegistrationEnrollmentTrackEditor/)
  assert.match(admission, /RegistrationAdmissionPanel/)
  assert.match(admission, /cancelRegistrationAdmissionBatch|admissionActions/)
})

test("canonical track detail resolves and persists director defaults only for management roles", async () => {
  const editor = await readRegistrationApplicationSource()
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
  const source = await readRegistrationApplicationSource()
  const commonSection = sourceBetween(source, "function RegistrationCommonInfoSection", "function RegistrationSubjectSyncSection")
  const saveCommon = sourceBetween(source, "async function saveCommon", "return (")

  assert.match(commonSection, /type RegistrationCommonSaveOutcome|Promise<RegistrationCommonSaveOutcome>/)
  assert.match(commonSection, /const outcome = await onSave\(draft, requestKey\)[\s\S]*?submissionKeys\.clear/)
  assert.match(commonSection, /outcome === "conflict_reloaded"[\s\S]*?최신 정보로 다시 불러왔습니다/)
  assert.doesNotMatch(commonSection, /message\.includes\("registration_common_revision_conflict"\)[\s\S]*?submissionKeys\.clear/)
  assert.match(saveCommon, /registration_common_revision_conflict[\s\S]*?await onReload\(\)[\s\S]*?return "conflict_reloaded"/)
  assert.match(saveCommon, /최신 정보를 다시 불러오지 못했습니다[\s\S]*?창을 닫고 다시 여세요/)
  assert.match(saveCommon, /await onReload\(\)[\s\S]*?return "saved"/)
})

test("ordinary tracks expose compact manual director selection and visit reassignment guidance", async () => {
  const source = await readRegistrationApplicationSource()
  const manualSave = sourceBetween(source, "async function saveManualDirector", "async function retryAutomaticRefresh")
  assert.match(source, /RegistrationTrackDirectorSection/)
  assert.match(source, /상담 책임자/)
  assert.match(source, /assignmentSource:\s*"manual"/)
  assert.match(source, /ruleKey:\s*null/)
  assert.match(source, /registration_visit_reassign_requires_reschedule/)
  assert.match(source, /방문상담 예약 수정에서 담당 원장을 다시 확인하세요/)
  assert.match(source, /setVisitCorrectionRequest\(\{ id, trackId: resolution\.trackId \}\)/)
  assert.match(source, /onOpenVisit\(visitCorrectionRequest\.trackId\)/)
  assert.match(source, /target\.visitConsultation\?\.appointmentId/)
  assert.match(source, /onFocusTrack\(context\.track\.id\)/)
  assert.match(source, /requestKeysRef\.current\.delete\(logicalKey\)/)
  assert.match(source, /visitCorrectionTrackId/)
  assert.match(source, /preferredTrackId:\s*visitCorrectionTrackId/)
  assert.match(source, /activeDirectorProfileIds/)
  assert.match(source, /teacherOptions\.map\(\(teacher\) => teacher\.profileId\)/)
  assert.match(source, /baselineProfileId === serverDirectorProfileId/)
  assert.match(source, /saveManualDirector[\s\S]*?isRegistrationDirectorCatalogRefreshError\(message\)[\s\S]*?setCatalogRefreshRequired\(true\)/)
  assert.match(source, /const selectedDirectorIsAvailable = availableDirectors\.some\(\(profile\) => profile\.id === directorProfileId\)/)
  assert.match(manualSave, /!selectedDirectorIsAvailable/)
  assert.match(source, /disabled=\{Boolean\(manualDirectorConflictAttempt\) \|\| !directorProfileId \|\| !selectedDirectorIsAvailable/)
})

test("operational detail omits the internal subject event log", async () => {
  const source = await readRegistrationApplicationSource()
  assert.doesNotMatch(source, /function RegistrationSubjectHistory/)
  assert.doesNotMatch(source, /<RegistrationSubjectHistory/)
  assert.doesNotMatch(source, /과목별 진행 이력/)
})

test("대기 상세는 저장된 현재반 claim을 수업 선택값으로 다시 연다", async () => {
  const source = await readRegistrationApplicationSource()
  assert.match(source, /getRegistrationCurrentClassWaitClassId/)
  assert.match(source, /currentClassWaitClassId=\{getRegistrationCurrentClassWaitClassId/)
  assert.match(source, /useState\(currentClassWaitClassId\)/)
  assert.match(source, /track\.waitingKind, enrollments: detail\.enrollments/)
})

test("migration review blocks ordinary actions until explicit attribution", async () => {
  const source = await readRegistrationApplicationSource()
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
  const source = await readRegistrationApplicationSource()
  assert.match(source, /레벨테스트 예약/)
  assert.match(source, /바로 상담/)
  assert.match(source, /문의만 완료/)
  assert.match(source, /routeRegistrationInquiry/)
  assert.doesNotMatch(source, /phoneConsultationAt/)
})

test("waiting controls require the retest decision and expose explicit closure", async () => {
  const source = await readRegistrationApplicationSource()
  assert.match(source, /레벨테스트 재응시 필요/)
  assert.match(source, /재응시 없이 등록/)
  assert.match(source, /대기 종료 · 미등록/)
  assert.match(source, /transitionRegistrationWaiting/)
})

test("terminal subject outcomes can be deliberately reopened from the same application", async () => {
  const source = await readRegistrationApplicationSource()

  assert.match(source, /reopenRegistrationTrack/)
  assert.match(source, /function TerminalStageEditor/)
  assert.match(source, /문의로 다시 열기/)
  assert.match(source, /전화상담으로 다시 열기/)
  assert.match(source, /재개 사유/)
})

test("new shared appointments start with only the initiating subject selected", async () => {
  const editor = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  const workspace = await readRegistrationApplicationSource()

  assert.match(editor, /initialTrackId\?: string/)
  assert.match(editor, /selectableTracks\.some\(\(track\) => track\.id === initialTrackId\)/)
  assert.doesNotMatch(editor, /:\s*selectableTracks\.map\(\(track\) => track\.id\)/)
  assert.match(workspace, /initialTrackId=\{appointmentEditor\.initialTrackId\}/)
})

test("subject removal renders the deployed history-block error inline", async () => {
  const source = await readRegistrationApplicationSource()
  assert.match(source, /registration_subject_removal_blocked/)
  assert.doesNotMatch(source, /registration_subject_has_history/)
})

test("workspace mounts the unified editor only for a loaded canonical subject track", async () => {
  const source = await readWorkspaceSource()
  assert.match(source, /import \{ RegistrationApplication \} from "\.\/registration-track-editor"/)
  assert.match(source, /const \[registrationCaseDetail, setRegistrationCaseDetail\] = useState/)
  assert.match(source, /setRegistrationCaseDetail\(detail\)/)
  assert.match(source, /registrationCaseDetail && isCanonicalRegistrationTrackDetail/)
  assert.match(source, /<RegistrationApplication/)
  assert.match(source, /detail=\{registrationCaseDetail\}/)
  assert.match(source, /focusTrackId=\{selectedRegistrationTrackId\}/)
  assert.match(source, /onFocusTrack=\{handleSelectRegistrationTrack\}/)
  assert.match(source, /admissionActions=/)
})

test("ready-mode creation uses one guarded initial-workflow RPC without a director follow-up", async () => {
  const source = await readWorkspaceSource()
  assert.match(source, /probeRegistrationSubjectTrackRuntime/)
  assert.match(source, /probeRegistrationIntakeWorkflowRuntime/)
  assert.match(source, /registrationPersistence\.mode === "ready_atomic"/)
  assert.match(source, /createRegistrationCaseWithInitialWorkflow\(\{/)
  assert.match(source, /const subjects = parseRegistrationSubjects\(createPayload\.subject\)/)
  assert.match(source, /createRegistrationCreateAttempt\([\s\S]*?subjects,/)
  assert.match(source, /registrationCreateAttemptRef/)
  assert.doesNotMatch(source, /persistCreatedRegistrationDirectorDefaults/)
  assert.match(source, /registrationPersistence\.mode === "blocked_maintenance"/)
})

test("appointment editor uses one schedule and one result control per subject", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /DateTimePickerControl/)
  assert.match(source, /REGISTRATION_TIME_OPTIONS/)
  assert.match(source, /timeOptions=\{REGISTRATION_TIME_OPTIONS\}/)
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
  const source = await readRegistrationApplicationSource()
  const stageSource = sourceBetween(source, "export function RegistrationTrackStageEditor", "type ConsultationOutcomeDraft")
  assert.match(source, /RegistrationAppointmentEditor/)
  assert.match(source, /getRegistrationApplicationAppointmentActionPlans\(\{/)
  assert.match(source, /appointmentActionPlans\.filter\(\(plan\) => plan\.kind === kind\)/)
  assert.match(source, /plans\.map\(\(plan\) =>/)
  assert.match(source, /openAppointment\(owner, kind, plan\.appointmentId\)/)
  assert.match(source, /openAppointment\(context, "level_test"/)
  assert.match(source, /openAppointment\(context, "visit_consultation"/)
  assert.equal((source.match(/<RegistrationAppointmentEditor/g) || []).length, 1)
  assert.doesNotMatch(stageSource, /예약 및 과목별 결과 관리|레벨테스트 결과 보기|방문상담 예약 수정/)
  assert.match(source, /방문상담 예약/)
})

test("phone and visit consultation completion share one inline subject outcome editor", async () => {
  const source = await readRegistrationApplicationSource()
  const outcomeSource = sourceBetween(source, "export function RegistrationConsultationOutcomeEditor", "export function RegistrationMigrationReviewEditor")
  const stageSource = sourceBetween(source, "export function RegistrationTrackStageEditor", "type ConsultationOutcomeDraft")
  assert.match(source, /RegistrationConsultationOutcomeEditor/)
  assert.match(source, /completeRegistrationConsultation/)
  assert.match(source, /consultationId: consultation\.id/)
  assert.match(source, />등록</)
  assert.match(source, />대기</)
  assert.match(source, />미등록 완료</)
  assert.match(source, /className="grid grid-cols-2 gap-2 sm:grid-cols-3"/)
  assert.match(source, /className="col-span-2 sm:col-span-1"[\s\S]*?>미등록 완료</)
  assert.match(source, /현재 학기 수강반 대기/)
  assert.match(source, /현재 학기 개강반 대기/)
  assert.match(source, /다음 학기 개강반 대기/)
  assert.doesNotMatch(source, /상담 완료일시/)
  assert.match(outcomeSource, /aria-pressed=\{draft\.outcome === "enrollment"\}[\s\S]*?disabled=\{saving\}/)
  assert.match(outcomeSource, /aria-pressed=\{draft\.outcome === "waiting"\}[\s\S]*?disabled=\{saving\}/)
  assert.match(outcomeSource, /aria-pressed=\{draft\.outcome === "not_registered"\}[\s\S]*?disabled=\{saving\}/)
  assert.match(outcomeSource, /value=\{draft\.waitingKind\}[\s\S]*?disabled=\{saving\}/)
  assert.match(outcomeSource, /SubjectClassSelect[\s\S]*?disabled=\{saving\}/)
  assert.match(outcomeSource, /saving \? "저장 중" : "상담 결과 저장"/)
  assert.doesNotMatch(outcomeSource, /<Dialog|<DialogContent/)
  assert.doesNotMatch(stageSource, /onOpenOutcome|전화상담 완료|방문상담 완료/)
  assert.doesNotMatch(source, /onOpenOutcome=\{/)
})

test("registration stage selects have subject-specific accessible names", async () => {
  const source = await readRegistrationApplicationSource()
  const subjectSelectSource = sourceBetween(source, "function SubjectClassSelect(", "function InquiryStageEditor(")
  const inquirySource = sourceBetween(source, "function InquiryStageEditor(", "function WaitingStageEditor(")
  const waitingSource = sourceBetween(source, "function WaitingStageEditor(", "function RegistrationTrackStageEditor(")
  const migrationSource = source.slice(source.indexOf("export function RegistrationMigrationReviewEditor"))

  assert.match(subjectSelectSource, /aria-label=\{`\$\{subject\} 수업 선택`\}/)
  assert.match(subjectSelectSource, /className="h-9 w-full min-w-0/)
  assert.match(inquirySource, /aria-label=\{`\$\{track\.subject\} 대기 종류`\}/)
  assert.match(waitingSource, /aria-label=\{`\$\{track\.subject\} 대기 종류`\}/)
  assert.match(migrationSource, /aria-label=\{`\$\{track\.subject\} 대기 종류`\}/)
})

test("appointment editor opens before history and scrolls into view", async () => {
  const source = await readRegistrationApplicationSource()
  const editorSource = source.slice(source.indexOf("export function RegistrationApplication"))
  assert.match(source, /const appointmentEditorRef = useRef<HTMLDivElement \| null>\(null\)/)
  assert.match(source, /appointmentEditorRef\.current\?\.scrollIntoView\(\{ block: "nearest", behavior: "smooth" \}\)/)
  assert.ok(
    editorSource.indexOf('ref={appointmentEditorRef}') < editorSource.indexOf("<RegistrationHistoryTimeline"),
    "appointment editor should render before the history timeline",
  )
})

test("phone completion does not call the visit reservation notification helper", async () => {
  const source = await readRegistrationApplicationSource()
  const outcomeBlock = sourceBetween(source, "export function RegistrationConsultationOutcomeEditor", "export function RegistrationMigrationReviewEditor")
  assert.match(outcomeBlock, /completeRegistrationConsultation/)
  assert.match(outcomeBlock, /onReload/)
  assert.doesNotMatch(outcomeBlock, /sendRegistrationVisitNotificationTarget/)
  assert.doesNotMatch(outcomeBlock, /consultation-notification/)
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

test("enrollment cancellation selects expose subject-specific accessible names", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /aria-label=\{`\$\{track\.subject\} 등록 결정 후 대기 종류`\}/)
  assert.match(source, /aria-label=\{`\$\{track\.subject\} 등록 결정 후 대기 수업`\}/)
  assert.match(source, /aria-label=\{`\$\{track\.subject\} 수강 취소 후 단계`\}/)
  assert.match(source, /aria-label=\{`\$\{track\.subject\} 수강 취소 대기 종류`\}/)
  assert.match(source, /aria-label=\{`\$\{track\.subject\} 수강 취소 대기 수업`\}/)
  assert.match(source, /aria-label=\{`\$\{track\?\.subject \|\| "과목"\} 입학 처리 취소 후 단계`\}/)
  assert.match(source, /aria-label=\{`\$\{track\?\.subject \|\| "과목"\} 입학 처리 취소 대기 종류`\}/)
  assert.match(source, /aria-label=\{`\$\{track\?\.subject \|\| "과목"\} 입학 처리 취소 대기 수업`\}/)
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
  const trackEditor = await readRegistrationApplicationSource()
  assert.match(trackEditor, /RegistrationEnrollmentTrackEditor/)
  assert.match(trackEditor, /track=\{track\}/)
  assert.match(trackEditor, /enrollments=\{detail\.enrollments/)
  assert.equal((trackEditor.match(/<RegistrationAdmissionPanel/g) || []).length, 1)

  const shell = await readWorkspaceSource()
  assert.match(shell, /<RegistrationApplication/)
  assert.match(shell, /admissionActions=\{/)
  assert.doesNotMatch(shell, /<RegistrationAdmissionPanel/)
})

test("stage and enrollment editors use disjoint React key namespaces", async () => {
  const source = await readRegistrationApplicationSource()

  assert.match(source, /<RegistrationTrackStageEditor\s+key=\{`stage:/)
  assert.match(source, /<RegistrationEnrollmentEditor\s+key=\{`enrollment:/)
})

test("enrollment stages show the real work surface without a redundant placeholder or director row", async () => {
  const source = await readRegistrationApplicationSource()
  const stageEditor = sourceBetween(
    source,
    "export function RegistrationTrackStageEditor(",
    "\ntype ConsultationOutcomeDraft",
  )

  assert.match(stageEditor, /\["not_registered", "inquiry_closed"\]\.includes\(track\.status\)[\s\S]*?<TerminalStageEditor/)
  assert.match(stageEditor, /\["enrollment_decided", "enrollment_processing", "registered"\]\.includes\(track\.status\)[\s\S]*?return null/)
  assert.doesNotMatch(stageEditor, /전용 입력 화면|현재 상태와 권한/)
  assert.match(source, /export const REGISTRATION_DIRECTOR_VISIBLE_STATUSES = new Set/)
  assert.match(source, /REGISTRATION_DIRECTOR_VISIBLE_STATUSES\.has\(context\.track\.status\)/)
})

test("committed enrollment and admission actions recover refresh without resubmitting mutations", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const enrollmentBlock = sourceBetween(source, "export function RegistrationEnrollmentEditor", "export type RegistrationAdmissionPanelProps")
  const admissionBlock = sourceBetween(source, "export function RegistrationAdmissionPanel", "return (\n    <section")
  assert.match(enrollmentBlock, /async function retryEnrollmentReload/)
  assert.match(enrollmentBlock, /await onReload\(\)[\s\S]*setOwnerRefreshPending\(owner, false\)[\s\S]*catch[\s\S]*setOwnerRefreshPending\(owner, true\)/)
  assert.doesNotMatch(enrollmentBlock, /setOwnerRefreshPending\([^,]+, true\)\s*\n\s*await reloadCommitted/)
  assert.match(admissionBlock, /async function retryAdmissionReload/)
  assert.match(admissionBlock, /const setPending = owner === "message" \? setMessageRefreshPending : setBatchRefreshPending[\s\S]*await onReload\(\)[\s\S]*setPending\(false\)[\s\S]*catch[\s\S]*setPending\(true\)/)
  assert.match(source, /onClick=\{\(\) => void retryEnrollmentReload\(\{ kind: "rows" \}\)\}/)
  assert.match(source, /onClick=\{\(\) => void retryEnrollmentReload\(\{ kind: "decision" \}\)\}/)
  assert.match(source, /onClick=\{\(\) => void retryEnrollmentReload\(cancellationScope\)\}/)
  assert.match(source, /onClick=\{\(\) => void retryAdmissionReload\("message"\)\}/)
  assert.match(source, /onClick=\{\(\) => void retryAdmissionReload\("batch"\)\}/)
})

test("registered add-class starts empty and cannot submit an empty draft list", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  assert.match(source, /track\.status === "enrollment_decided"[\s\S]*createRegistrationEnrollmentDraft/)
  assert.match(source, /disabled=\{saving \|\| rowsRefreshPending \|\| draftRows\.length === 0\}/)
  assert.match(source, /if \(blockers\.length > 0\)[\s\S]*?\.focus\(\)/)
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
  assert.match(routeBlock, /decisionRefreshPending/)
  assert.match(cancelBlock, /cancellationRefreshPending/)
  assert.match(startBlock, /busyAction \|\| batchRefreshPending/)
  assert.match(source, /disabled=\{saving \|\| decisionRefreshPending\}/)
  assert.match(source, /disabled=\{saving \|\| cancellationRefreshPending\}/)
})

test("an unrelated subject open batch does not hide enrollment decision routing", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const decisionSection = sourceBetween(source, "{track.status === \"enrollment_decided\" && permissions.canManage", "immutableHistory.length > 0")
  assert.match(decisionSection, /!trackHasOpenBatch/)
  assert.doesNotMatch(decisionSection, /!openBatch/)
})

test("registration application owns the exact stable dirty-key aggregates", async () => {
  const source = await readRegistrationApplicationSource()
  const editor = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")

  assert.match(editor, /useRef<Set<RegistrationApplicationDirtyKey>>\(new Set\(\)\)/)
  assert.match(editor, /updateRegistrationApplicationDirtyKeys/)
  assert.match(editor, /onDirtyChangeRef\.current\?\.\(next\.size > 0\)/)
  for (const key of [
    "inquiry:common",
    "inquiry:subjects",
    "level_test:track-${trackId}",
    "consultation:track-${context.track.id}",
    "admission:message",
    "admission:batch-${scope.batchId}",
  ]) assert.ok(source.includes(key), `missing dirty owner ${key}`)
  assert.match(editor, /setDirty\(`\$\{section\}:track-\$\{track\.id\}`/)
  assert.match(editor, /getRegistrationEnrollmentDirtyKey\(track\.id, scope\)/)
  assert.match(editor, /appointmentEditor\.kind === "level_test" \? "level_test" : "consultation"/)
})

test("every local registration editor reports dirty state through its owner", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const appointment = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const inquiry = await readFile(new URL("../src/features/tasks/registration-application-inquiry-section.tsx", import.meta.url), "utf8")

  assert.ok((actions.match(/onDirtyChange\?: \(dirty: boolean\) => void/g) || []).length >= 7)
  assert.match(appointment, /onDirtyChange\?: \(dirty: boolean\) => void/)
  assert.match(appointment, /onTrackDirtyChange\?: \(trackId: string, dirty: boolean\) => void/)
  assert.match(enrollment, /RegistrationEnrollmentEditorProps[\s\S]*?onDirtyChange\?: \(scope: RegistrationEnrollmentDirtyScope, dirty: boolean\) => void/)
  assert.match(enrollment, /RegistrationAdmissionPanelProps[\s\S]*?onDirtyChange\?: \(scope: AdmissionDirtyScope, dirty: boolean\) => void/)
  assert.match(inquiry, /onDirtyChange\?: \(scope: "common" \| "subjects", dirty: boolean\) => void/)
})

test("sibling canonical reloads preserve editor drafts and dirty membership", async () => {
  const editor = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")

  assert.doesNotMatch(editor, /key=\{`stage:\$\{track\.id\}:\$\{track\.status\}:\$\{track\.waitingKind\}`\}/)
  assert.doesNotMatch(editor, /detail\.enrollments\.map\(\(enrollment\)/)
  assert.doesNotMatch(editor, /appointmentActivitySignature/)
  assert.match(actions, /useOwnedDirtyState/)
  assert.match(editor, /key=\{`consultation:\$\{context\.activeConsultation\.id\}:\$\{context\.activeConsultation\.updatedAt\}`\}/)
})

test("inline consultation completion exposes the locked Task 6 interface and recovery copy", async () => {
  const source = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const outcome = sourceBetween(source, "export type RegistrationConsultationOutcomeEditorProps", "export function RegistrationMigrationReviewEditor")

  assert.match(outcome, /subject: RegistrationSubject/)
  assert.match(outcome, /active: boolean/)
  assert.match(outcome, /onDirtyChange\?: \(dirty: boolean\) => void/)
  assert.match(source, /const COMMITTED_REFRESH_ERROR = "저장은 완료됐지만 최신 내용을 불러오지 못했습니다"/)
  assert.match(outcome, /\{COMMITTED_REFRESH_ERROR\}/)
  assert.match(outcome, /최신 내용 다시 불러오기/)
  assert.doesNotMatch(outcome, /Dialog|DialogContent|onOpenChange/)
})

test("section validation is local, Korean, and focuses its first invalid control", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const appointment = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")

  for (const source of [actions, appointment, enrollment]) {
    assert.match(source, /role="alert"/)
    assert.match(source, /\.focus\(\)/)
  }
  assert.match(actions, /입력하세요|선택하세요/)
  assert.match(appointment, /예약 일시, 장소, 적용 과목을 모두 입력하세요/)
  assert.match(enrollment, /수업 정보를 확인하세요/)
})

test("subject-owned controls name their subject and keep mobile primary actions after inputs", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const appointment = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const consultation = sourceBetween(actions, "export type RegistrationConsultationOutcomeEditorProps", "export function RegistrationMigrationReviewEditor")
  const enrollmentRows = sourceBetween(enrollment, "export function RegistrationEnrollmentEditor", "export type RegistrationAdmissionPanelProps")

  assert.match(consultation, /aria-label=\{`\$\{subject\} 상담 결과 저장`\}/)
  assert.match(appointment, /aria-label=\{`\$\{track\?\.subject \|\| "과목"\} 시험지·결과지 URL`\}/)
  assert.match(enrollmentRows, /aria-label=\{`\$\{track\.subject\} 수업 \$\{index \+ 1\} 선택`\}/)
  assert.ok(consultation.indexOf("waitingKind") < consultation.indexOf("상담 결과 저장"))
  assert.ok(enrollmentRows.indexOf("draftRows.map") < enrollmentRows.indexOf("수업 정보 저장"))
})

test("catalog failures lock only their selectors and retain a local retry", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")

  assert.match(actions, /const directorSelectorLocked =/)
  assert.match(actions, /disabled=\{Boolean\(manualDirectorConflictAttempt\) \|\| directorSelectorLocked \|\| savingManual \|\| automaticSaving\}/)
  assert.match(actions, /담당자 정보 다시 불러오기/)
  assert.match(enrollment, /classDetailById\[row\.classId\] === null/)
  assert.match(enrollment, /수업 일정 다시 불러오기/)
})

test("committed refresh failures clear only their dirty owner and lock mutation replay", async () => {
  const source = await readRegistrationApplicationSource()
  const appointment = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")

  for (const editor of [source, appointment]) {
    assert.match(editor, /저장은 완료됐지만 최신 내용을 불러오지 못했습니다/)
    assert.match(editor, /onDirtyChange\?\.\(false\)/)
    assert.match(editor, /최신 내용 다시 불러오기/)
  }
  assert.match(enrollment, /저장은 완료됐지만 최신 내용을 불러오지 못했습니다/)
  assert.match(enrollment, /onDirtyChange\?\.\(owner, false\)/)
  assert.match(enrollment, /최신 내용 다시 불러오기/)
  assert.match(appointment, /trackRefreshPendingIds/)
  assert.match(appointment, /reloadAfterCommittedMutation\(trackId: string\)/)
  assert.doesNotMatch(sourceBetween(appointment, "async function reloadAfterCommittedMutation", "async function retryTrackRefresh"), /onTrackDirtyChangeRef\.current\?\.\(trackId, false\)/)
  assert.match(appointment, /linkDirty \|\| reasonDirty/)
  assert.match(enrollment, /rowsRefreshPending/)
  assert.match(enrollment, /decisionRefreshPending/)
  assert.match(enrollment, /cancellationRefreshPending/)
  assert.match(enrollment, /messageRefreshPending/)
  assert.match(enrollment, /batchRefreshPending/)
  assert.match(enrollment, /afterCommitted\(owner: "message" \| "batch"\)/)
  assert.doesNotMatch(sourceBetween(source, "async function retryRefresh()", "return ("), /completeRegistrationConsultation/)
})

test("common revision conflicts show attempted and latest values before an explicit choice", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const common = sourceBetween(actions, "export function RegistrationCommonInfoSection", "export function RegistrationSubjectSyncSection")

  assert.match(common, /getRegistrationCommonConflictRows/)
  assert.match(common, /conflictAttempt/)
  assert.match(common, /내가 입력한 값/)
  assert.match(common, /최신 저장 값/)
  assert.match(common, /최신 값 사용/)
  assert.match(common, /내 입력 다시 적용/)
  assert.doesNotMatch(sourceBetween(common, 'outcome === "conflict_reloaded"', 'outcome === "committed_refresh_pending"'), /await onSave/)
})

test("manual director revision conflicts compare the attempted and latest director before retry", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const director = sourceBetween(actions, "export function RegistrationTrackDirectorSection", "const REGISTRATION_HISTORY_DATE_FORMATTER")
  const conflict = sourceBetween(director, 'message.includes("registration_common_revision_conflict")', 'message.includes("registration_visit_reassign_requires_reschedule")')

  assert.match(director, /manualDirectorConflictAttempt/)
  assert.match(director, /내가 선택한 담당자/)
  assert.match(director, /최신 저장 담당자/)
  assert.match(director, /최신 담당자 사용/)
  assert.match(director, /내 선택 다시 적용/)
  assert.doesNotMatch(conflict, /assignRegistrationTrackDirector/)
})

test("migration review revision conflicts preserve a comparable draft behind an explicit choice", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const editor = await readRegistrationApplicationSource()
  const migrationStart = actions.indexOf("export function RegistrationMigrationReviewEditor")
  assert.notEqual(migrationStart, -1)
  const migration = actions.slice(migrationStart)
  const conflict = sourceBetween(migration, 'message.includes("registration_common_revision_conflict")', "} else {")

  assert.match(editor, /<RegistrationMigrationReviewEditor[\s\S]*?key=\{detail\.task\.id\}/)
  assert.match(migration, /migrationConflictAttempt/)
  assert.match(migration, /내가 선택한 분리안/)
  assert.match(migration, /최신 저장 상태/)
  assert.match(migration, /최신 상태 사용/)
  assert.match(migration, /내 분리안 다시 적용/)
  assert.doesNotMatch(conflict, /resolveRegistrationMigrationReview/)
})

test("enrollment rows, decisions, and persisted cancellations report and recover separate owners", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const editor = await readFile(new URL("../src/features/tasks/registration-track-editor.tsx", import.meta.url), "utf8")
  const block = sourceBetween(enrollment, "export function RegistrationEnrollmentEditor", "export type AdmissionDirtyScope")

  assert.match(enrollment, /export type RegistrationEnrollmentDirtyScope/)
  assert.match(block, /rowsRefreshPending/)
  assert.match(block, /decisionRefreshPending/)
  assert.match(block, /cancellationRefreshPending/)
  assert.match(block, /reloadCommitted\(owner: RegistrationEnrollmentDirtyScope\)/)
  assert.match(block, /useScopedDirtyState\(\{ kind: "rows" \}/)
  assert.match(block, /useScopedDirtyState\(\{ kind: "decision" \}/)
  assert.match(block, /kind: "cancellation"/)
  assert.match(block, /persistedRegistrationEnrollmentDrafts/)
  assert.match(block, /cachedEnrollmentDraft/)
  assert.match(editor, /getRegistrationEnrollmentDirtyKey/)
  assert.match(editor, /clearRegistrationEnrollmentDrafts\(detail\.task\.id\)/)
  assert.match(actions, /key=\{`enrollment:\$\{track\.id\}`\}/)
})

test("starting a level test preserves unsaved result links through canonical reload recovery", async () => {
  const appointment = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  const reload = sourceBetween(appointment, "async function reloadAfterCommittedMutation", "async function retryTrackRefresh")
  const start = sourceBetween(appointment, "async function startAttempt", "async function completeAttempt")

  assert.doesNotMatch(reload, /onTrackDirtyChangeRef\.current\?\.\(trackId, false\)/)
  assert.doesNotMatch(start, /setDraftLinks/)
  assert.match(start, /reloadAfterCommittedMutation\(activity\.trackId\)/)
  assert.doesNotMatch(appointment, /!trackRefreshPendingIds\.has\(activity\.trackId\) && \(linkDirty \|\| reasonDirty\)/)
})

test("enrollment decision and cancellation validation is local and focuses subject-owned controls", async () => {
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")
  const decision = sourceBetween(enrollment, "async function routeDecision", "async function cancelPersistedEnrollment")
  const cancellation = sourceBetween(enrollment, "async function cancelPersistedEnrollment", "const immutableHistory")

  assert.match(decision, /대기 종류를 선택하세요/)
  assert.match(decision, /대기 수업을 선택하세요/)
  assert.match(decision, /\.focus\(\)/)
  assert.match(cancellation, /취소 후 대기 종류를 선택하세요/)
  assert.match(cancellation, /취소 후 대기 수업을 선택하세요/)
  assert.match(cancellation, /\.focus\(\)/)
  assert.match(enrollment, /decisionValidationError[\s\S]*role="alert"/)
  assert.match(enrollment, /cancellationValidationError[\s\S]*role="alert"/)
})

test("remaining subject-owned mutation controls expose their subject in accessible names", async () => {
  const actions = await readFile(new URL("../src/features/tasks/registration-application-track-actions.tsx", import.meta.url), "utf8")
  const appointment = await readFile(new URL("../src/features/tasks/registration-appointment-editor.tsx", import.meta.url), "utf8")
  const enrollment = await readFile(new URL("../src/features/tasks/registration-enrollment-editor.tsx", import.meta.url), "utf8")

  assert.match(actions, /aria-label=\{`\$\{track\.subject\} 대기 종류 저장`\}/)
  assert.match(actions, /aria-label=\{`\$\{track\.subject\} 등록 전환`\}/)
  assert.match(actions, /aria-label=\{`\$\{track\.subject\} 방문상담 예약`\}/)
  assert.match(enrollment, /aria-label=\{`\$\{track\.subject\} 수업 \$\{index \+ 1\} \$\{row\.id === null \? "삭제" : "수강 취소"\}`\}/)
  assert.match(appointment, /aria-label=\{`\$\{track\?\.subject \|\| "과목"\} 다시 예약`\}/)
  assert.match(appointment, /aria-label=\{`\$\{track\?\.subject \|\| "과목"\} 문의 종료`\}/)
})

test("ops task workspace owns the registration application aggregate without adding the close guard", async () => {
  const workspace = await readWorkspaceSource()

  assert.match(workspace, /const \[registrationApplicationDirty, setRegistrationApplicationDirty\] = useState\(false\)/)
  assert.match(workspace, /onDirtyChange=\{setRegistrationApplicationDirty\}/)
  assert.match(workspace, /data-registration-application-dirty=\{registrationApplicationDirty \? "true" : "false"\}/)
  assert.doesNotMatch(workspace, /if \(registrationApplicationDirty\)[\s\S]{0,200}(confirm|preventDefault)/)
})
