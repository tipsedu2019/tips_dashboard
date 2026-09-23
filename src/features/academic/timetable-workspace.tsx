"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import {
  CalendarDays,
  GraduationCap,
  ImageDown,
  Loader2,
  School,
  User,
  type LucideIcon,
  RotateCcw,
} from "lucide-react";
import { invalidatePublicClassesCacheAfterMutation } from '@/lib/public-classes-cache-invalidation.js';
import { clearRegistrationTrackServiceCaches } from '@/features/tasks/registration-track-service';
import { supabase } from '@/lib/supabase';
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTableFilterPanel } from "@/components/data-table/data-table-filter-panel";
import {
  WorkspaceTabs,
  WorkspaceTabsList,
  WorkspaceTabsTrigger,
  WorkspaceTabsPanel,
} from "@/components/ui/workspace-tabs";
import { TimetableTargetFilter } from "./timetable-target-filter";
import { exportElementAsImage } from "@/lib/export-as-image";
import { cn } from "@/lib/utils";

import {
  buildTimetableGridPanels,
  buildTimetableWorkspaceModel,
} from "./records.js";
import { getTimetablePanelLayout } from "./timetable-layout";
import { useAcademicWorkspaceData } from "./use-academic-workspace-data";
import { useDraftNavigation } from '@/hooks/use-draft-navigation';
import { useTimetablePlan } from './use-timetable-plan';
import { clearTimetablePlanRecovery } from './timetable-plan-recovery';
import { TimetablePlanPicker } from './timetable-plan-picker';
import { TimetablePlanWorkspace } from './timetable-plan-workspace';
import styles from "./timetable-grid-skin.module.css";
import TimetableGrid from "./components/legacy-timetable-grid.jsx";

const LegacyTimetableGrid = TimetableGrid as unknown as ComponentType<
  Record<string, unknown>
>;

type TimetableView =
  | "teacher-weekly"
  | "classroom-weekly"
  | "daily-teacher"
  | "daily-classroom";

type TimetableViewOption = {
  id: TimetableView;
  label: string;
  description: string;
  icon: LucideIcon;
};

const VIEW_OPTIONS: TimetableViewOption[] = [
  {
    id: "teacher-weekly",
    label: "선생님 주간",
    description: "교사별 주간 배치를 나란히 비교합니다.",
    icon: User,
  },
  {
    id: "classroom-weekly",
    label: "강의실 주간",
    description: "강의실 점유 상태와 충돌 현황을 같은 축에서 비교합니다.",
    icon: School,
  },
  {
    id: "daily-teacher",
    label: "일별 선생님",
    description: "요일별 교사 축 배치를 일별 흐름으로 비교합니다.",
    icon: GraduationCap,
  },
  {
    id: "daily-classroom",
    label: "일별 강의실",
    description: "요일별 강의실 회전과 공실 현황을 함께 보여줍니다.",
    icon: CalendarDays,
  },
];

const GRID_OPTIONS = [1, 2] as const;
const PRIMARY_SUBJECT_FILTERS = ["영어", "수학"];

function buildTimetableVisibleRange(days: 7 | 14) {
  const today = new Date();
  const start = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
  );
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - (day === 0 ? 6 : day - 1));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + days - 1);
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10),
  };
}

function TimetableWorkspaceSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 sm:px-5 lg:px-6">
      <Skeleton className="h-40 w-full rounded-xl" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-[820px] w-full rounded-xl" />
        <Skeleton className="h-[820px] w-full rounded-xl" />
      </div>
    </div>
  );
}

function normalizeSelections(values: string[], options: string[]) {
  if (values.length === 0) {
    return values;
  }

  const optionSet = new Set(options);
  const nextValues = values.filter((value) => optionSet.has(value));
  return nextValues.length === values.length ? values : nextValues;
}

function buildSubjectFilterOptions(subjectOptions: string[]) {
  const primarySet = new Set(PRIMARY_SUBJECT_FILTERS);
  const extras = subjectOptions.filter(
    (option) => option && !primarySet.has(option),
  );
  return ["", ...PRIMARY_SUBJECT_FILTERS, ...extras];
}

function sanitizeImageFileName(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function getTimetableCaptureWidth(element: HTMLElement) {
  const gridElement = element.querySelector<HTMLElement>(".timetable-grid");
  const gridWidth = gridElement ? gridElement.scrollWidth + 32 : 0;
  return Math.ceil(
    Math.max(element.offsetWidth, element.scrollWidth, gridWidth),
  );
}

type TimetablePanelBlockSummary = {
  key?: string;
  classId?: string;
  lessonKey?: string;
  startSlot?: number;
  endSlot?: number;
};

function formatWeeklyHours(hours: number) {
  const safeHours = Math.round(Math.max(0, hours) * 10) / 10;
  return Number.isInteger(safeHours)
    ? `${safeHours}시간`
    : `${safeHours.toFixed(1)}시간`;
}

function getTimetablePanelSummary(blocks: TimetablePanelBlockSummary[] = []) {
  const lessonKeys = new Set(
    blocks
      .map((block) =>
        String(block.lessonKey || block.classId || block.key || ""),
      )
      .filter(Boolean),
  );
  const weeklyHours = blocks.reduce((total, block) => {
    const startSlot = Number(block.startSlot);
    const endSlot = Number(block.endSlot);
    if (
      !Number.isFinite(startSlot) ||
      !Number.isFinite(endSlot) ||
      endSlot <= startSlot
    ) {
      return total;
    }

    return total + (endSlot - startSlot) * 0.5;
  }, 0);

  return {
    lessonCount: lessonKeys.size,
    weeklyHoursLabel: formatWeeklyHours(weeklyHours),
  };
}

export function AcademicTimetableWorkspace() {
  const presetsEnabled = process.env.NEXT_PUBLIC_TIMETABLE_PRESETS_ENABLED !== "false";
  const [view, setView] = useState<TimetableView>("teacher-weekly");
  const [planId, setPlanId] = useState<string | null>(null);
  const operationalRefresh = useRef<(() => Promise<void>) | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [pickerDirty, setPickerDirty] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [transferDirty, setTransferDirty] = useState(false);
  const plan = useTimetablePlan(planId);
  const handleTransferred = useCallback(async (_result: import('./timetable-plan-contract').TransferResult, request: import('./timetable-plan-contract').TransferRequest) => {
    setReloadNonce(value => value + 1);
    if (request.target.kind === 'operational') {
      clearRegistrationTrackServiceCaches();
      const publicCache = await invalidatePublicClassesCacheAfterMutation(supabase, 'class');
      await operationalRefresh.current?.();
      if (publicCache.status === 'pending') throw Error('public_classes_cache_refresh_pending');
    }
  }, []);
  useEffect(() => {
    const error = plan.error as { code?: string; message?: string } | null;
    if (error?.code === '42501' || error?.message === 'timetable_forbidden') {
      let current = true;
      queueMicrotask(() => { if (current) {
        if (plan.service && planId) clearTimetablePlanRecovery(plan.service.actorScope, planId);
        setPlanId(null); setReloadNonce(value => value + 1);
      } });
      return () => { current = false; };
    }
  }, [plan.error, plan.service, planId]);
  const navigation = useDraftNavigation({ dirty: plan.dirty || pickerDirty || editorDirty || transferDirty });
  const changePlan = (id: string | null) => navigation.requestLocalAction(() => {
    setPlanId(id);
  });
  return <div className="space-y-4">
    {presetsEnabled ? <TimetablePlanPicker disabled={!!planId && plan.referenceStatus !== 'verified'} onCommitted={id => { setPlanId(id); }} onFormDirty={setPickerDirty} reloadNonce={reloadNonce} planId={planId} snapshot={plan.snapshot} onChange={changePlan} onRefresh={plan.refresh} requestAction={navigation.requestLocalAction}/> : null}
    <div hidden={Boolean(planId)}><OperationalTimetableWorkspace refreshRef={operationalRefresh} view={view} setView={setView}/></div>
    {planId ? <TimetablePlanWorkspace key={planId} state={plan} onTransferred={handleTransferred} view={view} onViewChange={setView} onEditorDirty={setEditorDirty} onTransferDirty={setTransferDirty} requestAction={navigation.requestLocalAction}/> : null}
    {navigation.confirmation}
  </div>;
}

function OperationalTimetableWorkspace({view, setView, refreshRef}: {refreshRef: MutableRefObject<(() => Promise<void>) | null>; view: TimetableView; setView: (view: TimetableView) => void}) {
  const [status, setStatus] = useState("수강");
  const [subject, setSubject] = useState("");
  const [gridCount, setGridCount] = useState(2);
  const [selectedTeachers, setSelectedTeachers] = useState<string[]>([]);
  const [selectedClassrooms, setSelectedClassrooms] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [savingPanelId, setSavingPanelId] = useState("");
  const timetablePanelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const visibleRange = useMemo(() => buildTimetableVisibleRange(7), []);
  const {
    data: timetableData,
    densityError,
    loading,
    error,
    refresh,
    refreshVerified,
    successfulRequest,
    displayRequest,
    dataMatchesCurrentScope,
  } = useAcademicWorkspaceData({
    mode: "timetable",
    dateFrom: visibleRange.dateFrom,
    dateTo: visibleRange.dateTo,
    filters: {
      classGroupId: null,
      status: status || null,
      subject: subject || null,
    },
  });
  useEffect(() => { refreshRef.current = refreshVerified; return () => { refreshRef.current = null; }; }, [refreshRef, refreshVerified]);
  const displayTimetableRequest = useMemo(
    () =>
      displayRequest.mode === "timetable"
        ? displayRequest
        : successfulRequest?.mode === "timetable"
          ? successfulRequest
          : {
              mode: "timetable" as const,
              dateFrom: visibleRange.dateFrom,
              dateTo: visibleRange.dateTo,
              filters: {
                classGroupId: null,
                status: status || null,
                subject: subject || null,
              },
            },
    [
      displayRequest,
      successfulRequest,
      visibleRange.dateFrom,
      visibleRange.dateTo,
      status,
      subject,
    ],
  );
  const data = useMemo(
    () => ({
      rows: Array.isArray(timetableData?.rows) ? timetableData.rows : [],
      classSummaries: Array.isArray(timetableData?.classSummaries)
        ? timetableData.classSummaries
        : [],
      classTerms: Array.isArray(timetableData?.classTerms)
        ? timetableData.classTerms
        : [],
      classGroups: Array.isArray(timetableData?.classGroups)
        ? timetableData.classGroups
        : [],
      classGroupMembers: Array.isArray(timetableData?.classGroupMembers)
        ? timetableData.classGroupMembers
        : [],
      teacherCatalogs: Array.isArray(timetableData?.teacherCatalogs)
        ? timetableData.teacherCatalogs
        : [],
      classroomCatalogs: Array.isArray(timetableData?.classroomCatalogs)
        ? timetableData.classroomCatalogs
        : [],
    }),
    [timetableData],
  );

  const workspace = useMemo(
    () =>
      buildTimetableWorkspaceModel({
        classes: data.classSummaries,
        precomputedRows: data.rows,
        classTerms: data.classTerms,
        classGroups: data.classGroups,
        classGroupMembers: data.classGroupMembers,
        teacherCatalogs: data.teacherCatalogs,
        classroomCatalogs: data.classroomCatalogs,
        filters: displayTimetableRequest.filters,
      }),
    [
      data.classGroupMembers,
      data.classGroups,
      data.classTerms,
      data.classSummaries,
      data.classroomCatalogs,
      data.rows,
      data.teacherCatalogs,
      displayTimetableRequest,
    ],
  );
  useEffect(() => {
    if (status && !workspace.statusOptions.includes(status)) {
      setStatus(workspace.statusOptions[0] || "수강");
    }
  }, [status, workspace.statusOptions]);

  useEffect(() => {
    setSelectedTeachers((current) =>
      normalizeSelections(current, workspace.teacherOptions),
    );
  }, [workspace.teacherOptions]);

  useEffect(() => {
    setSelectedClassrooms((current) =>
      normalizeSelections(current, workspace.classroomOptions),
    );
  }, [workspace.classroomOptions]);

  useEffect(() => {
    setSelectedDays((current) =>
      normalizeSelections(current, workspace.dayOptions),
    );
  }, [workspace.dayOptions]);

  const subjectFilterOptions = useMemo(
    () => buildSubjectFilterOptions(workspace.subjectOptions),
    [workspace.subjectOptions],
  );

  const activeSubFilterLabel =
    view === "teacher-weekly"
      ? "선생님"
      : view === "classroom-weekly"
        ? "강의실"
        : "요일";

  const selectedTeacherSet = useMemo(
    () => new Set(selectedTeachers),
    [selectedTeachers],
  );
  const selectedClassroomSet = useMemo(
    () => new Set(selectedClassrooms),
    [selectedClassrooms],
  );
  const selectedDaySet = useMemo(() => new Set(selectedDays), [selectedDays]);

  const filteredRows = useMemo(() => {
    const hasSelectedTeachers = selectedTeacherSet.size > 0;
    const hasSelectedClassrooms = selectedClassroomSet.size > 0;
    const hasSelectedDays = selectedDaySet.size > 0;

    return workspace.rows.filter((row) => {
      if (view === "teacher-weekly") {
        return !hasSelectedTeachers || selectedTeacherSet.has(row.teacher);
      }

      if (view === "classroom-weekly") {
        return (
          !hasSelectedClassrooms || selectedClassroomSet.has(row.classroom)
        );
      }

      return !hasSelectedDays || selectedDaySet.has(row.day);
    });
  }, [
    selectedClassroomSet,
    selectedDaySet,
    selectedTeacherSet,
    view,
    workspace.rows,
  ]);

  const axisSelectedTargets =
    view === "teacher-weekly"
      ? selectedTeachers
      : view === "classroom-weekly"
        ? selectedClassrooms
        : selectedDays;

  const gridWorkspace = useMemo(
    () => ({
      ...workspace,
      rows: filteredRows,
      timetableScheduleRows: workspace.rows,
    }),
    [filteredRows, workspace],
  );

  const grid = useMemo(
    () =>
      buildTimetableGridPanels({
        workspace: gridWorkspace,
        view,
        gridCount,
        selectedTargets: axisSelectedTargets,
      }),
    [axisSelectedTargets, gridCount, gridWorkspace, view],
  );

  const panelLayout = getTimetablePanelLayout({ view, gridCount });
  const panelGridStyle = {
    "--timetable-panel-columns": `repeat(${Math.min(
      gridCount,
      Math.max(grid.panels.length, 1),
    )}, minmax(0, 1fr))`,
  } as CSSProperties;

  const resetFilters = () => {
    setStatus("수강");
    setSubject("");
    setSelectedTeachers([]);
    setSelectedClassrooms([]);
    setSelectedDays([]);
  };

  const handleSavePanelImage = async (panelId: string, panelTitle: string) => {
    const element = timetablePanelRefs.current[panelId];
    if (!element || savingPanelId) {
      return;
    }

    const filename = `${sanitizeImageFileName(panelTitle || "시간표")}-시간표.png`;
    setSavingPanelId(panelId);

    try {
      await exportElementAsImage(element, filename, {
        width: getTimetableCaptureWidth(element),
        padding: 0,
        scale: 3,
        backgroundColor: "#ffffff",
      });
      toast.success("시간표 이미지를 저장했습니다.");
    } catch (captureError) {
      console.error(captureError);
      toast.error("시간표 이미지 저장 중 오류가 발생했습니다.");
    } finally {
      setSavingPanelId("");
    }
  };

  if (loading && !timetableData) {
    return <TimetableWorkspaceSkeleton />;
  }

  return (
    <WorkspaceTabs
      value={view}
      onValueChange={(value) => setView(value as TimetableView)}
      className={`${styles.scope} flex flex-col gap-4 px-4 pb-6 sm:px-5 lg:px-6`}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>시간표를 불러오지 못했습니다. 다시 시도해 주세요.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refresh()}
            >
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {densityError ? (
        <Alert variant="destructive">
          <AlertDescription>
            시간표가 너무 많습니다. 과목을 선택해 조회 범위를 좁혀 주세요.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b p-3 sm:px-4">
          <WorkspaceTabsList
            aria-label="시간표 보기"
            className="grid grid-cols-2 md:flex md:w-auto"
          >
            {VIEW_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <WorkspaceTabsTrigger
                  key={option.id}
                  value={option.id}
                  className="h-11 md:h-9"
                >
                  <Icon aria-hidden="true" />
                  {option.label}
                </WorkspaceTabsTrigger>
              );
            })}
          </WorkspaceTabsList>
          <div className="hidden items-center gap-2 xl:flex">
            <Label htmlFor="timetable-layout" className="text-muted-foreground">
              배치
            </Label>
            <Select
              value={String(gridCount)}
              onValueChange={(value) => setGridCount(Number(value))}
            >
              <SelectTrigger id="timetable-layout" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRID_OPTIONS.map((count) => (
                  <SelectItem key={count} value={String(count)}>
                    {count}단
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="p-3 sm:px-4">
          <DataTableFilterPanel
            label="시간표 조건"
            activeFilters={[
              { label: "수업 상태", value: status },
              ...(subject ? [{ label: "과목", value: subject }] : []),
              ...(axisSelectedTargets.length
                ? [
                    {
                      label: activeSubFilterLabel,
                      value: axisSelectedTargets.join(", "),
                    },
                  ]
                : []),
            ]}
            onReset={resetFilters}
            canReset={
              status !== "수강" ||
              Boolean(subject) ||
              axisSelectedTargets.length > 0
            }
          >
            <div
              data-slot="data-table-filters"
              className="grid grid-cols-1 items-end gap-3 md:grid-cols-[9rem_9rem_minmax(10rem,18rem)_auto]"
            >
              <div className="space-y-2">
                <Label htmlFor="timetable-status">수업 상태</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id="timetable-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {workspace.statusOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="timetable-subject">과목</Label>
                <Select
                  value={subject || "all"}
                  onValueChange={(value) =>
                    setSubject(value === "all" ? "" : value)
                  }
                >
                  <SelectTrigger id="timetable-subject" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {subjectFilterOptions.map((option) => (
                      <SelectItem key={option || "all"} value={option || "all"}>
                        {option || "전체 과목"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <TimetableTargetFilter
                key={activeSubFilterLabel}
                label={activeSubFilterLabel}
                options={
                  view === "teacher-weekly"
                    ? workspace.teacherOptions
                    : view === "classroom-weekly"
                      ? workspace.classroomOptions
                      : workspace.dayOptions
                }
                selected={axisSelectedTargets}
                onChange={
                  view === "teacher-weekly"
                    ? setSelectedTeachers
                    : view === "classroom-weekly"
                      ? setSelectedClassrooms
                      : setSelectedDays
                }
              />
              <Button
                type="button"
                variant="ghost"
                className="hidden justify-self-end md:inline-flex"
                onClick={resetFilters}
                disabled={
                  status === "수강" && !subject && !axisSelectedTargets.length
                }
              >
                <RotateCcw aria-hidden="true" />
                초기화
              </Button>
            </div>
          </DataTableFilterPanel>
        </div>
      </div>

      <WorkspaceTabsPanel
        aria-label={VIEW_OPTIONS.find((option) => option.id === view)?.label}
        aria-busy={loading}
      >
        {!dataMatchesCurrentScope && timetableData ? (
          <p role="status" className="pb-3 text-sm text-muted-foreground">
            {loading ? "시간표를 불러오는 중 · " : "이전 조회 결과 · "}
            {displayTimetableRequest.filters.status || "전체 상태"} ·{" "}
            {displayTimetableRequest.filters.subject || "전체 과목"}
          </p>
        ) : null}
        {!timetableData && (loading || error || densityError) ? <div role="status" className="grid min-h-64 place-items-center text-sm text-muted-foreground">{loading ? "시간표를 불러오는 중입니다." : "시간표 조회 결과를 확인할 수 없습니다."}</div> : filteredRows.length === 0 || grid.panels.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center rounded-xl border bg-card px-6 text-center text-sm text-muted-foreground">
            조건에 맞는 시간표가 없습니다.
          </div>
        ) : (
          <div
            className="grid grid-cols-1 gap-4 xl:[grid-template-columns:var(--timetable-panel-columns)]"
            style={panelGridStyle}
          >
            {grid.panels.map((panel) => {
              const isSavingPanel = savingPanelId === panel.id;
              const panelSummary = getTimetablePanelSummary(panel.blocks);

              return (
                <section
                  key={panel.id}
                  className="relative min-w-0 overflow-hidden rounded-xl border bg-card"
                >
                  <div
                    ref={(node) => {
                      timetablePanelRefs.current[panel.id] = node;
                    }}
                    className="min-w-0 bg-background"
                  >
                    <div className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3 pr-16">
                      <h2 className="min-w-0 break-words text-base font-semibold tracking-tight">
                        {panel.title}
                      </h2>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        수업 {panelSummary.lessonCount}개 ·{" "}
                        {view.endsWith("weekly") ? "주간 " : ""}
                        {panelSummary.weeklyHoursLabel}
                      </p>
                    </div>

                    <div
                      className={cn(
                        "min-w-0 p-3",
                        panelLayout.allowHorizontalScroll
                          ? "overflow-x-auto"
                          : "overflow-x-hidden",
                      )}
                    >
                      <LegacyTimetableGrid
                        columns={panel.columns}
                        timeSlots={grid.timeSlots}
                        blocks={panel.blocks}
                        editable={false}
                        density={panelLayout.density}
                        slotHeight={panelLayout.slotHeight}
                        timeColumnWidth={panelLayout.timeColumnWidth}
                        minColumnWidth={panelLayout.minColumnWidth}
                        fitColumns={panelLayout.fitColumns}
                      />
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${panel.title} 이미지 저장`}
                    title="이미지 저장"
                    disabled={Boolean(savingPanelId)}
                    onClick={() => handleSavePanelImage(panel.id, panel.title)}
                    className="absolute right-2 top-2 size-11 sm:right-3 sm:top-3 sm:size-9"
                  >
                    {isSavingPanel ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ImageDown className="size-4" />
                    )}
                  </Button>
                </section>
              );
            })}
          </div>
        )}
      </WorkspaceTabsPanel>
    </WorkspaceTabs>
  );
}
