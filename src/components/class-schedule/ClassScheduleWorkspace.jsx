import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../../contexts/AuthContext";
import { DashboardDataSurface } from "../ui/dashboard";
import ClassSchedulePlanModal from "../ClassSchedulePlanModal";
import { useViewport } from "../../hooks/useViewport";
import { buildSchedulePlanForSave } from "../../lib/classSchedulePlanner.js";
import {
  DEFAULT_CLASS_SCHEDULE_VIEW_STATE,
  buildClassScheduleWorkspaceData,
  restoreClassScheduleViewState,
} from "../../lib/classScheduleWorkspaceModel.js";
import ClassScheduleQuickProgressPopover from "./ClassScheduleQuickProgressPopover";
import ClassScheduleSyncGroupPanel from "./ClassScheduleSyncGroupPanel";
import ClassScheduleTimelineView from "./ClassScheduleTimelineView";
import ClassScheduleToolbar from "./ClassScheduleToolbar";
import {
  buildChecklistPayloads,
  buildCombinedProgressLogs,
  buildSessionProgressPayload,
  buildSyncGroupCards,
  buildTimelineAxis,
  buildTimelineRows,
  buildWorkspaceFilterOptions,
  createProgressDraft,
  isProgressDraftEmpty,
  resolveWorkspaceSelection,
  safeText,
} from "./classScheduleWorkspaceUtils.js";

const VIEW_PREFERENCE_KEY = "workspace:class-schedule:view";

function createEmptyGroupForm(subject = "") {
  return {
    id: "",
    name: "",
    subject,
    color: "#3182f6",
    note: "",
    memberIds: [],
  };
}

function toMinimalTimelineViewState(state = DEFAULT_CLASS_SCHEDULE_VIEW_STATE) {
  const safeState = state && typeof state === "object" ? state : {};
  return {
    ...DEFAULT_CLASS_SCHEDULE_VIEW_STATE,
    ...safeState,
    view: "timeline",
    timelineZoom: "day",
    showWarningsOnly: false,
    filters: {
      ...DEFAULT_CLASS_SCHEDULE_VIEW_STATE.filters,
      ...(safeState.filters && typeof safeState.filters === "object" ? safeState.filters : {}),
    },
    inspectorOpen:
      typeof safeState.inspectorOpen === "boolean"
        ? safeState.inspectorOpen
        : DEFAULT_CLASS_SCHEDULE_VIEW_STATE.inspectorOpen,
  };
}

function buildVisibleTimelineRange(rows = [], fallback = { start: "", end: "" }) {
  const dates = (rows || [])
    .flatMap((row) => (row.sessions || []).map((session) => safeText(session?.date)))
    .filter(Boolean)
    .sort();

  if (!dates.length) {
    return fallback;
  }

  return {
    start: dates[0],
    end: dates[dates.length - 1],
  };
}

function matchesSearch(row, keyword) {
  const haystack = [
    safeText(row?.classItem?.className || row?.classItem?.name),
    safeText(row?.classItem?.subject),
    safeText(row?.classItem?.grade),
    safeText(row?.classItem?.teacher),
    safeText(row?.term?.name),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(keyword);
}

function buildClassCandidates(rows = [], subject = "") {
  return (rows || [])
    .filter((row) => {
      if (!subject) return true;
      return safeText(row?.classItem?.subject) === safeText(subject);
    })
    .map((row) => ({
      classId: safeText(row?.classItem?.id),
      className: safeText(row?.classItem?.className || row?.classItem?.name),
      subject: safeText(row?.classItem?.subject),
      teacher: safeText(row?.classItem?.teacher),
    }))
    .filter((item) => item.classId);
}

export default function ClassScheduleWorkspace({
  data = {},
  dataService,
  managedTerms = [],
}) {
  const { isMobile } = useViewport();
  const { canEditClassSchedule, canEditClassSchedulePlanning } = useAuth();
  const [viewState, setViewState] = useState(() =>
    toMinimalTimelineViewState(DEFAULT_CLASS_SCHEDULE_VIEW_STATE),
  );
  const [searchValue, setSearchValue] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedTextbookId, setSelectedTextbookId] = useState("");
  const [expandedClassIds, setExpandedClassIds] = useState(() => new Set());
  const [optimisticProgress, setOptimisticProgress] = useState({});
  const [draft, setDraft] = useState(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [modalState, setModalState] = useState({
    open: false,
    row: null,
    mode: "readonly",
  });
  const [syncConfigOpen, setSyncConfigOpen] = useState(false);
  const [syncForm, setSyncForm] = useState(() => createEmptyGroupForm());
  const saveTimeoutRef = useRef(null);
  const saveFeedbackTimeoutRef = useRef(null);
  const selectionKeyRef = useRef("");

  const classes = data?.classes || [];
  const textbooks = data?.textbooks || [];
  const progressLogs = data?.progressLogs || data?.progress_logs || [];
  const classTerms = data?.classTerms || data?.class_terms || managedTerms || [];
  const syncGroups = data?.classScheduleSyncGroups || data?.class_schedule_sync_groups || [];
  const syncGroupMembers =
    data?.classScheduleSyncGroupMembers || data?.class_schedule_sync_group_members || [];

  useEffect(() => {
    let cancelled = false;

    async function loadPreference() {
      if (!dataService?.getAppPreference) return;
      try {
        const preference = await dataService.getAppPreference(VIEW_PREFERENCE_KEY);
        if (cancelled) return;
        setViewState(
          toMinimalTimelineViewState(
            restoreClassScheduleViewState(preference?.value || null),
          ),
        );
      } catch (error) {
        console.error("Failed to load class schedule preference:", error);
      }
    }

    loadPreference();

    return () => {
      cancelled = true;
    };
  }, [dataService]);

  useEffect(() => {
    if (
      viewState.view !== "timeline" ||
      viewState.timelineZoom !== "day" ||
      viewState.showWarningsOnly
    ) {
      setViewState((current) => toMinimalTimelineViewState(current));
    }
  }, [viewState]);

  const minimalViewState = useMemo(
    () => toMinimalTimelineViewState(viewState),
    [viewState],
  );

  useEffect(() => {
    if (!canEditClassSchedulePlanning || !dataService?.setAppPreference) return;
    dataService.setAppPreference(VIEW_PREFERENCE_KEY, minimalViewState).catch((error) => {
      console.error("Failed to persist class schedule preference:", error);
    });
  }, [canEditClassSchedulePlanning, dataService, minimalViewState]);

  const combinedProgressLogs = useMemo(
    () => buildCombinedProgressLogs(progressLogs, optimisticProgress),
    [optimisticProgress, progressLogs],
  );

  const allWorkspaceData = useMemo(
    () =>
      buildClassScheduleWorkspaceData({
        classes,
        textbooks,
        progressLogs: combinedProgressLogs,
        classTerms,
        syncGroups,
        syncGroupMembers,
        filters: {},
      }),
    [classes, textbooks, combinedProgressLogs, classTerms, syncGroups, syncGroupMembers],
  );

  const filteredWorkspaceData = useMemo(
    () =>
      buildClassScheduleWorkspaceData({
        classes,
        textbooks,
        progressLogs: combinedProgressLogs,
        classTerms,
        syncGroups,
        syncGroupMembers,
        filters: minimalViewState.filters,
      }),
    [
      classes,
      textbooks,
      combinedProgressLogs,
      classTerms,
      syncGroups,
      syncGroupMembers,
      minimalViewState.filters,
    ],
  );

  const searchFilteredRows = useMemo(() => {
    const keyword = safeText(searchValue).toLowerCase();

    return (filteredWorkspaceData.rows || []).filter((row) => {
      if (
        minimalViewState.selectedSyncGroupId &&
        safeText(row?.syncGroupId) !== safeText(minimalViewState.selectedSyncGroupId)
      ) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      return matchesSearch(row, keyword);
    });
  }, [filteredWorkspaceData.rows, minimalViewState.selectedSyncGroupId, searchValue]);

  const filterOptions = useMemo(
    () => buildWorkspaceFilterOptions(allWorkspaceData.rows || []),
    [allWorkspaceData.rows],
  );

  const workspaceErrors = filteredWorkspaceData.errors || [];
  const visibleTimelineRange = useMemo(
    () => buildVisibleTimelineRange(searchFilteredRows, filteredWorkspaceData.timelineRange),
    [searchFilteredRows, filteredWorkspaceData.timelineRange],
  );
  const timelineAxis = useMemo(
    () => buildTimelineAxis(visibleTimelineRange),
    [visibleTimelineRange],
  );
  const timelineRows = useMemo(
    () => buildTimelineRows(searchFilteredRows, expandedClassIds),
    [expandedClassIds, searchFilteredRows],
  );
  const syncGroupCards = useMemo(
    () =>
      buildSyncGroupCards(
        filteredWorkspaceData.syncGroups,
        syncGroupMembers,
        searchFilteredRows,
        classes,
      ),
    [filteredWorkspaceData.syncGroups, syncGroupMembers, searchFilteredRows, classes],
  );

  const selection = useMemo(
    () =>
      resolveWorkspaceSelection(
        searchFilteredRows,
        selectedClassId,
        selectedSessionId,
        selectedTextbookId,
      ),
    [searchFilteredRows, selectedClassId, selectedSessionId, selectedTextbookId],
  );

  const selectedRow = selection.row;
  const selectedSession = selection.session;
  const selectedEntry = selection.entry;
  const inspectorOpen = !isMobile || minimalViewState.inspectorOpen;

  const classCandidates = useMemo(
    () =>
      buildClassCandidates(
        filteredWorkspaceData.rows || [],
        syncForm.subject || minimalViewState.filters.subject,
      ),
    [filteredWorkspaceData.rows, syncForm.subject, minimalViewState.filters.subject],
  );

  useEffect(() => {
    if (!syncGroupCards.some((group) => safeText(group.id) === safeText(minimalViewState.selectedSyncGroupId))) {
      if (minimalViewState.selectedSyncGroupId) {
        setViewState((current) => ({
          ...current,
          selectedSyncGroupId: "",
        }));
      }
    }
  }, [syncGroupCards, minimalViewState.selectedSyncGroupId]);

  useEffect(() => {
    if (!searchFilteredRows.length) {
      if (selectionKeyRef.current) {
        selectionKeyRef.current = "";
      }
      if (selectedClassId || selectedSessionId || selectedTextbookId) {
        setSelectedClassId("");
        setSelectedSessionId("");
        setSelectedTextbookId("");
      }
      return;
    }

    selectionKeyRef.current = selection.key;

    if (selection.classId !== selectedClassId) {
      setSelectedClassId(selection.classId);
    }
    if (selection.sessionId !== selectedSessionId) {
      setSelectedSessionId(selection.sessionId);
    }
    if (selection.textbookId !== selectedTextbookId) {
      setSelectedTextbookId(selection.textbookId);
    }
  }, [
    searchFilteredRows.length,
    selection.classId,
    selection.key,
    selection.sessionId,
    selection.textbookId,
    selectedClassId,
    selectedSessionId,
    selectedTextbookId,
  ]);

  useEffect(() => {
    if (!selectedRow || !selectedSession || !selectedEntry) {
      setDraft(null);
      setDraftDirty(false);
      setSaveState("idle");
      return;
    }

    setDraft(createProgressDraft(selectedRow, selectedSession, selectedEntry));
    setDraftDirty(false);
    setSaveState("idle");
  }, [selectedEntry, selectedRow, selectedSession]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (saveFeedbackTimeoutRef.current) {
        clearTimeout(saveFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!canEditClassSchedulePlanning) {
      return undefined;
    }
    if (!draftDirty || !draft || !selectedRow || !selectedSession || !selectedEntry) {
      return undefined;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (saveFeedbackTimeoutRef.current) {
      clearTimeout(saveFeedbackTimeoutRef.current);
    }

    setSaveState("saving");
    const payload = buildSessionProgressPayload({
      row: selectedRow,
      session: selectedSession,
      entry: selectedEntry,
      draft,
    });

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        if (isProgressDraftEmpty(draft)) {
          setOptimisticProgress((current) => ({
            ...current,
            [payload.progressKey]: null,
          }));
          await dataService?.deleteSessionProgressLog?.({
            progressKey: payload.progressKey,
          });
        } else {
          setOptimisticProgress((current) => ({
            ...current,
            [payload.progressKey]: {
              ...payload,
              id: payload.progressKey,
            },
          }));
          await dataService?.upsertSessionProgressLog?.(payload);
        }

        setDraftDirty(false);
        setSaveState("saved");
        saveFeedbackTimeoutRef.current = setTimeout(() => {
          setSaveState((current) => (current === "saved" ? "idle" : current));
        }, 1200);
      } catch (error) {
        console.error("Failed to autosave class schedule progress:", error);
        setSaveState("error");
      }
    }, 350);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    canEditClassSchedulePlanning,
    dataService,
    draft,
    draftDirty,
    selectedEntry,
    selectedRow,
    selectedSession,
  ]);

  function setInspectorOpen(nextOpen) {
    setViewState((current) => ({
      ...current,
      inspectorOpen: Boolean(nextOpen),
    }));
  }

  function handleSelectClass(classId) {
    const nextSelection = resolveWorkspaceSelection(
      searchFilteredRows,
      classId,
      selectedSessionId,
      selectedTextbookId,
    );

    setSelectedClassId(nextSelection.classId);
    setSelectedSessionId(nextSelection.sessionId);
    setSelectedTextbookId(nextSelection.textbookId);

    if (isMobile) {
      setInspectorOpen(true);
    }
  }

  function handleSelectSession(sessionId) {
    const nextSession = (selectedRow?.sessions || []).find(
      (session) => safeText(session?.id) === safeText(sessionId),
    );
    const nextEntry =
      (nextSession?.textbookEntries || []).find(
        (entry) => safeText(entry?.textbookId) === safeText(selectedTextbookId),
      ) ||
      (nextSession?.textbookEntries || [])[0] ||
      null;

    setSelectedSessionId(safeText(nextSession?.id));
    setSelectedTextbookId(safeText(nextEntry?.textbookId));
  }

  function handleSelectEntry(textbookId) {
    setSelectedTextbookId(safeText(textbookId));
  }

  function handleToggleExpand(classId) {
    setExpandedClassIds((current) => {
      const next = new Set(current);
      if (next.has(classId)) {
        next.delete(classId);
      } else {
        next.add(classId);
      }
      return next;
    });
  }

  function handleSelectActualTarget(row, session, entry) {
    setSelectedClassId(safeText(row?.classItem?.id));
    setSelectedSessionId(safeText(session?.id));
    setSelectedTextbookId(safeText(entry?.textbookId));

    if (isMobile) {
      setInspectorOpen(true);
    }
  }

  function handlePlanClick(row) {
    setSelectedClassId(safeText(row?.classItem?.id));
    setModalState({
      open: true,
      row,
      mode: canEditClassSchedulePlanning ? "builder" : "readonly",
    });
  }

  function handleActualClick(row, session, entry) {
    handleSelectActualTarget(row, session, entry);
  }

  function handleDraftChange(patch = {}) {
    if (!canEditClassSchedulePlanning) {
      return;
    }
    setDraft((current) => ({
      ...(current || createProgressDraft(selectedRow, selectedSession, selectedEntry)),
      ...patch,
    }));
    setDraftDirty(true);
    setSaveState("saving");
  }

  async function handleBuilderSave({ classPatch, schedulePlan }) {
    if (!canEditClassSchedulePlanning) return;
    const classItem = modalState.row?.classItem;
    if (!classItem) return;

    const mergedClass = {
      ...classItem,
      subject: classPatch?.subject ?? classItem.subject,
      className: classPatch?.className ?? classItem.className ?? classItem.name,
      textbookIds: classPatch?.textbookIds ?? classItem.textbookIds ?? [],
    };
    const savedPlan = buildSchedulePlanForSave(schedulePlan, mergedClass);

    await dataService?.updateClass?.(classItem.id, {
      ...mergedClass,
      schedulePlan: savedPlan,
    });

    setModalState({
      open: false,
      row: null,
      mode: "readonly",
    });
  }

  async function handleChecklistSave({ classPatch, schedulePlan }) {
    if (!canEditClassSchedulePlanning) return;
    const classItem = modalState.row?.classItem;
    if (!classItem || !schedulePlan) {
      setModalState({
        open: false,
        row: null,
        mode: "readonly",
      });
      return;
    }

    const mergedClass = {
      ...classItem,
      subject: classPatch?.subject ?? classItem.subject,
      className: classPatch?.className ?? classItem.className ?? classItem.name,
      textbookIds: classPatch?.textbookIds ?? classItem.textbookIds ?? [],
    };
    const payloads = buildChecklistPayloads({
      classItem: mergedClass,
      schedulePlan,
      textbooksCatalog: textbooks,
    });

    const optimisticPatch = {};
    for (const payload of payloads) {
      optimisticPatch[payload.progressKey] = {
        ...payload,
        id: payload.progressKey,
      };
      await dataService?.upsertSessionProgressLog?.(payload);
    }
    setOptimisticProgress((current) => ({
      ...current,
      ...optimisticPatch,
    }));

    setModalState({
      open: false,
      row: null,
      mode: "readonly",
    });
  }

  function handleOpenChecklist(row) {
    setModalState({
      open: true,
      row,
      mode: canEditClassSchedulePlanning ? "checklist" : "readonly",
    });
  }

  function handleOpenBuilder(row) {
    setModalState({
      open: true,
      row,
      mode: canEditClassSchedulePlanning ? "builder" : "readonly",
    });
  }

  function handleOpenSyncConfig(groupId = "") {
    if (!groupId) {
      setSyncForm(createEmptyGroupForm(minimalViewState.filters.subject));
      setSyncConfigOpen(true);
      return;
    }

    const group =
      syncGroupCards.find((item) => safeText(item.id) === safeText(groupId)) ||
      filteredWorkspaceData.syncGroups.find((item) => safeText(item.id) === safeText(groupId)) ||
      null;

    if (!group) {
      setSyncForm(createEmptyGroupForm(minimalViewState.filters.subject));
      setSyncConfigOpen(true);
      return;
    }

    const memberIds = (syncGroupMembers || [])
      .filter((member) => safeText(member.groupId || member.group_id) === safeText(groupId))
      .sort(
        (left, right) =>
          Number(left.sortOrder || left.sort_order || 0) -
          Number(right.sortOrder || right.sort_order || 0),
      )
      .map((member) => safeText(member.classId || member.class_id))
      .filter(Boolean);

    setSyncForm({
      id: safeText(group.id),
      name: safeText(group.name),
      subject: safeText(group.subject),
      color: safeText(group.color) || "#3182f6",
      note: safeText(group.note),
      memberIds,
    });
    setSyncConfigOpen(true);
  }

  async function handleSaveSyncGroup() {
    if (!canEditClassSchedule) return;
    const savedGroup = await dataService?.upsertClassScheduleSyncGroup?.({
      id: syncForm.id || undefined,
      termId: minimalViewState.filters.termId || null,
      name: safeText(syncForm.name) || "진도 동기화 그룹",
      subject: safeText(syncForm.subject),
      color: safeText(syncForm.color) || "#3182f6",
      note: safeText(syncForm.note),
    });
    const groupId = safeText(savedGroup?.id || syncForm.id);

    if (groupId) {
      await dataService?.replaceClassScheduleSyncGroupMembers?.(
        groupId,
        syncForm.memberIds.map((classId, index) => ({
          classId,
          sortOrder: index,
        })),
      );
      setViewState((current) => ({
        ...current,
        selectedSyncGroupId: groupId,
      }));
    }

    setSyncConfigOpen(false);
  }

  async function handleDeleteSyncGroup(groupId) {
    if (!canEditClassSchedule) return;
    await dataService?.deleteClassScheduleSyncGroup?.(groupId);
    setViewState((current) => ({
      ...current,
      selectedSyncGroupId:
        safeText(current.selectedSyncGroupId) === safeText(groupId)
          ? ""
          : current.selectedSyncGroupId,
    }));
    setSyncConfigOpen(false);
    setSyncForm(createEmptyGroupForm(minimalViewState.filters.subject));
  }

  function handleToggleSyncMember(classId) {
    setSyncForm((current) => {
      const memberIds = current.memberIds.includes(classId)
        ? current.memberIds.filter((item) => item !== classId)
        : [...current.memberIds, classId];

      return {
        ...current,
        memberIds,
      };
    });
  }

  function handleMoveSyncMember(classId, direction) {
    setSyncForm((current) => {
      const index = current.memberIds.findIndex((item) => item === classId);
      if (index < 0) return current;

      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= current.memberIds.length) {
        return current;
      }

      const memberIds = [...current.memberIds];
      const [item] = memberIds.splice(index, 1);
      memberIds.splice(nextIndex, 0, item);

      return {
        ...current,
        memberIds,
      };
    });
  }

  return (
    <div
      className="class-schedule-workspace class-schedule-workspace--minimal"
      data-density={minimalViewState.density}
    >
      <DashboardDataSurface className="class-schedule-workspace__command-shell class-schedule-workspace__command-shell--minimal">
        <ClassScheduleToolbar
          viewState={minimalViewState}
          filterOptions={filterOptions}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          onFiltersChange={(patch) =>
            setViewState((current) => ({
              ...current,
              filters: {
                ...current.filters,
                ...patch,
              },
            }))}
        />
      </DashboardDataSurface>

      {workspaceErrors.length > 0 ? (
        <DashboardDataSurface className="class-schedule-workspace__notice-surface">
          <div className="class-schedule-workspace__notice">
            <strong>일부 수업 일정 데이터를 읽는 중 문제가 있었습니다.</strong>
            <span>
              {workspaceErrors
                .slice(0, 2)
                .map((item) => item.className || item.classId)
                .filter(Boolean)
                .join(", ")}
            </span>
          </div>
        </DashboardDataSurface>
      ) : null}

      <div className={`class-schedule-workspace__body${inspectorOpen ? " has-inspector" : ""}`}>
        <div className="class-schedule-workspace__main">
          <DashboardDataSurface className="class-schedule-workspace__view-surface">
            <div className="class-schedule-workspace__surface class-schedule-workspace__surface--minimal">
              <div className="class-schedule-workspace__surface-header class-schedule-workspace__surface-header--minimal">
                <div className="class-schedule-workspace__surface-copy">
                  <strong>타임라인</strong>
                </div>
              </div>

              <ClassScheduleTimelineView
                timelineRows={timelineRows}
                axis={timelineAxis}
                timelineRange={visibleTimelineRange}
                selectedClassId={selectedRow?.classItem?.id || ""}
                expandedClassIds={expandedClassIds}
                timelineZoom="day"
                onSelectClass={handleSelectClass}
                onToggleExpand={handleToggleExpand}
                onPlanClick={handlePlanClick}
                onActualClick={handleActualClick}
              />
            </div>
          </DashboardDataSurface>

          <DashboardDataSurface className="class-schedule-workspace__sync-surface">
            <ClassScheduleSyncGroupPanel
              editable={canEditClassSchedule}
              groups={syncGroupCards}
              selectedGroupId={minimalViewState.selectedSyncGroupId}
              onSelectGroup={(groupId) => {
                if (
                  canEditClassSchedule &&
                  safeText(minimalViewState.selectedSyncGroupId) === safeText(groupId)
                ) {
                  handleOpenSyncConfig(groupId);
                  return;
                }

                setViewState((current) => ({
                  ...current,
                  selectedSyncGroupId: safeText(groupId),
                }));
              }}
              configOpen={syncConfigOpen}
              onCloseConfig={() => setSyncConfigOpen(false)}
              formState={syncForm}
              classCandidates={classCandidates}
              onChangeForm={(patch) =>
                setSyncForm((current) => ({
                  ...current,
                  ...patch,
                }))}
              onToggleMember={handleToggleSyncMember}
              onMoveMemberUp={(classId) => handleMoveSyncMember(classId, "up")}
              onMoveMemberDown={(classId) => handleMoveSyncMember(classId, "down")}
              onSave={handleSaveSyncGroup}
              onDelete={handleDeleteSyncGroup}
              onCreate={() => handleOpenSyncConfig("")}
            />
          </DashboardDataSurface>
        </div>

        {inspectorOpen ? (
          <div className="class-schedule-workspace__aside">
            <ClassScheduleQuickProgressPopover
              open={inspectorOpen}
              row={selectedRow}
              selectedSession={selectedSession}
              selectedEntry={selectedEntry}
              canEditClassSchedule={canEditClassSchedule}
              draft={canEditClassSchedulePlanning ? draft : null}
              saveState={saveState}
              onClose={() => setInspectorOpen(false)}
              onSelectSession={handleSelectSession}
              onSelectEntry={handleSelectEntry}
              onDraftChange={handleDraftChange}
              onOpenChecklist={handleOpenChecklist}
              onOpenBuilder={handleOpenBuilder}
              showClose={isMobile}
            />
          </div>
        ) : null}
      </div>

      <ClassSchedulePlanModal
        open={modalState.open}
        editable={canEditClassSchedulePlanning && modalState.mode !== "readonly"}
        mode={modalState.mode}
        classItem={modalState.row?.classItem || null}
        plan={
          modalState.row?.classItem?.schedulePlan ||
          modalState.row?.classItem?.schedule_plan ||
          null
        }
        textbooksCatalog={textbooks}
        progressLogs={combinedProgressLogs}
        onSaveDraft={
          modalState.mode === "readonly"
            ? undefined
            : modalState.mode === "builder"
              ? handleBuilderSave
              : handleChecklistSave
        }
        onClose={() =>
          setModalState({
            open: false,
            row: null,
            mode: "readonly",
          })}
      />
    </div>
  );
}
