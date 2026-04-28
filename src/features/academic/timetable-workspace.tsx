"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType, type Dispatch, type SetStateAction } from "react";
import {
  CalendarDays,
  GraduationCap,
  ImageDown,
  Loader2,
  School,
  User,
  type LucideIcon,
} from "lucide-react";
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
import { pickDefaultPeriodValue } from "@/features/management/period-preferences";
import { exportElementAsImage } from "@/lib/export-as-image";
import { cn } from "@/lib/utils";

import {
  buildTimetableGridPanels,
  buildTimetableWorkspaceModel,
} from "./records.js";
import { getTimetablePanelLayout } from "./timetable-layout";
import { useAcademicWorkspaceData } from "./use-academic-workspace-data";
import styles from "./timetable-grid-skin.module.css";
import TimetableGrid from "./components/legacy-timetable-grid.jsx";

const LegacyTimetableGrid =
  TimetableGrid as unknown as ComponentType<Record<string, unknown>>;

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

function TimetableWorkspaceSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="grid gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-[360px] w-full rounded-[28px]" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-[820px] w-full rounded-[28px]" />
        <Skeleton className="h-[820px] w-full rounded-[28px]" />
      </div>
    </div>
  );
}

function iconForView(view: TimetableView) {
  return VIEW_OPTIONS.find((option) => option.id === view)?.icon || User;
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
  const extras = subjectOptions.filter((option) => option && !primarySet.has(option));
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
  return Math.ceil(Math.max(element.offsetWidth, element.scrollWidth, gridWidth));
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
  return Number.isInteger(safeHours) ? `${safeHours}시간` : `${safeHours.toFixed(1)}시간`;
}

function getTimetablePanelSummary(blocks: TimetablePanelBlockSummary[] = []) {
  const lessonKeys = new Set(
    blocks.map((block) => String(block.lessonKey || block.classId || block.key || "")).filter(Boolean),
  );
  const weeklyHours = blocks.reduce((total, block) => {
    const startSlot = Number(block.startSlot);
    const endSlot = Number(block.endSlot);
    if (!Number.isFinite(startSlot) || !Number.isFinite(endSlot) || endSlot <= startSlot) {
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
  const { data, loading, error } = useAcademicWorkspaceData();
  const [view, setView] = useState<TimetableView>("teacher-weekly");
  const [classGroupId, setClassGroupId] = useState("");
  const [status, setStatus] = useState("수강");
  const [subject, setSubject] = useState("");
  const [gridCount, setGridCount] = useState(2);
  const [selectedTeachers, setSelectedTeachers] = useState<string[]>([]);
  const [selectedClassrooms, setSelectedClassrooms] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [savingPanelId, setSavingPanelId] = useState("");
  const timetablePanelRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const workspace = useMemo(
    () =>
      buildTimetableWorkspaceModel({
        classes: data.classes,
        classTerms: data.classTerms,
        classGroups: data.classGroups,
        classGroupMembers: data.classGroupMembers,
        teacherCatalogs: data.teacherCatalogs,
        classroomCatalogs: data.classroomCatalogs,
        filters: {
          classGroupId,
          status,
          subject,
        },
      }),
    [
      classGroupId,
      data.classGroupMembers,
      data.classGroups,
      data.classTerms,
      data.classes,
      data.classroomCatalogs,
      data.teacherCatalogs,
      status,
      subject,
    ],
  );
  const defaultPeriodId = useMemo(
    () => pickDefaultPeriodValue(workspace.classGroupOptions),
    [workspace.classGroupOptions],
  );

  useEffect(() => {
    if (!classGroupId && workspace.classGroupOptions.length > 0) {
      setClassGroupId(defaultPeriodId);
    }
  }, [classGroupId, defaultPeriodId, workspace.classGroupOptions]);

  useEffect(() => {
    if (classGroupId && !workspace.classGroupOptions.some((option) => option.value === classGroupId)) {
      setClassGroupId(defaultPeriodId);
    }
  }, [classGroupId, defaultPeriodId, workspace.classGroupOptions]);

  useEffect(() => {
    if (status && !workspace.statusOptions.includes(status)) {
      setStatus(workspace.statusOptions[0] || "수강");
    }
  }, [status, workspace.statusOptions]);

  useEffect(() => {
    setSelectedTeachers((current) => normalizeSelections(current, workspace.teacherOptions));
  }, [workspace.teacherOptions]);

  useEffect(() => {
    setSelectedClassrooms((current) => normalizeSelections(current, workspace.classroomOptions));
  }, [workspace.classroomOptions]);

  useEffect(() => {
    setSelectedDays((current) => normalizeSelections(current, workspace.dayOptions));
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

  const selectedTeacherSet = useMemo(() => new Set(selectedTeachers), [selectedTeachers]);
  const selectedClassroomSet = useMemo(() => new Set(selectedClassrooms), [selectedClassrooms]);
  const selectedDaySet = useMemo(() => new Set(selectedDays), [selectedDays]);

  const filteredRows = useMemo(
    () => {
      const hasSelectedTeachers = selectedTeacherSet.size > 0;
      const hasSelectedClassrooms = selectedClassroomSet.size > 0;
      const hasSelectedDays = selectedDaySet.size > 0;

      return workspace.rows.filter((row) => {
        if (view === "teacher-weekly") {
          return !hasSelectedTeachers || selectedTeacherSet.has(row.teacher);
        }

        if (view === "classroom-weekly") {
          return !hasSelectedClassrooms || selectedClassroomSet.has(row.classroom);
        }

        return !hasSelectedDays || selectedDaySet.has(row.day);
      });
    },
    [selectedClassroomSet, selectedDaySet, selectedTeacherSet, view, workspace.rows],
  );

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

  const toggleFilterValue = (
    value: string,
    currentValues: string[],
    setter: Dispatch<SetStateAction<string[]>>,
  ) => {
    const hasValue = currentValues.includes(value);
    setter(hasValue ? currentValues.filter((item) => item !== value) : [...currentValues, value]);
  };

  const resetFilters = () => {
    setClassGroupId(defaultPeriodId);
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

  if (loading) {
    return <TimetableWorkspaceSkeleton />;
  }

  return (
    <div className={`${styles.scope} flex flex-col gap-6 px-4 lg:px-6`}>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4 border border-border/70 bg-background p-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(180px,0.95fr)_minmax(190px,0.9fr)_minmax(180px,0.8fr)_minmax(320px,1.35fr)_auto]">
          <div className="space-y-2">
            <Label htmlFor="period-filter" className="text-[11px] text-muted-foreground">기간</Label>
            <Select
              value={classGroupId || defaultPeriodId || "none"}
              disabled={workspace.classGroupOptions.length === 0}
              onValueChange={(value) => {
                if (value !== "none") {
                  setClassGroupId(value);
                }
              }}
            >
              <SelectTrigger id="period-filter" className="h-9 rounded-sm">
                <SelectValue placeholder="기간" />
              </SelectTrigger>
              <SelectContent>
                {workspace.classGroupOptions.length === 0 ? (
                  <SelectItem value="none" disabled>
                    기간 없음
                  </SelectItem>
                ) : (
                  workspace.classGroupOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-[11px] text-muted-foreground">수업 상태</Label>
            <div className="flex flex-wrap gap-2">
              {workspace.statusOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={status === option ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatus(option)}
                  className="h-9 rounded-sm px-3 text-[12px] font-medium"
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[11px] text-muted-foreground">과목</Label>
            <div className="flex flex-wrap gap-2">
              {subjectFilterOptions.map((option) => (
                <Button
                  key={option || "all-subjects"}
                  type="button"
                  variant={subject === option ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSubject(option)}
                  className="h-9 min-w-12 rounded-sm px-3 text-[12px] font-medium"
                >
                  {option || "전체"}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[11px] text-muted-foreground">보기 전환</Label>
            <div className="flex flex-wrap gap-2">
              {VIEW_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = option.id === view;
                return (
                  <Button
                    key={option.id}
                    type="button"
                    variant={active ? "default" : "outline"}
                    size="sm"
                    onClick={() => setView(option.id)}
                    className="h-9 rounded-sm px-3 text-[12px] font-medium"
                  >
                    <Icon className="mr-1.5 size-3.5" />
                    {option.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[11px] text-muted-foreground">레이아웃</Label>
            <div className="flex gap-2">
              {GRID_OPTIONS.map((count) => {
                const active = count === gridCount;
                return (
                  <Button
                    key={count}
                    type="button"
                    variant={active ? "default" : "outline"}
                    size="sm"
                    onClick={() => setGridCount(count)}
                    className="h-9 min-w-14 rounded-sm px-3 text-[12px] font-medium"
                  >
                    {count}단
                  </Button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border/70 pt-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="text-[11px] text-muted-foreground">{activeSubFilterLabel}</div>
            {view === "teacher-weekly"
              ? workspace.teacherOptions.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant={selectedTeachers.includes(option) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleFilterValue(option, selectedTeachers, setSelectedTeachers)}
                    className="h-8 rounded-sm px-2.5 text-[12px] font-medium"
                  >
                    {option}
                  </Button>
                ))
              : view === "classroom-weekly"
                ? workspace.classroomOptions.map((option) => (
                    <Button
                      key={option}
                      type="button"
                      variant={selectedClassrooms.includes(option) ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleFilterValue(option, selectedClassrooms, setSelectedClassrooms)}
                      className="h-8 rounded-sm px-2.5 text-[12px] font-medium"
                    >
                      {option}
                    </Button>
                  ))
                : workspace.dayOptions.map((option) => (
                    <Button
                      key={option}
                      type="button"
                      variant={selectedDays.includes(option) ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleFilterValue(option, selectedDays, setSelectedDays)}
                      className="h-8 rounded-sm px-2.5 text-[12px] font-medium"
                    >
                      {option}
                    </Button>
                  ))}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            className="h-8 shrink-0 rounded-sm px-2.5 text-[12px] font-medium text-muted-foreground"
          >
            필터 초기화
          </Button>
        </div>
      </div>

      {filteredRows.length === 0 || grid.panels.length === 0 ? (
        <div className="flex min-h-[420px] items-center justify-center border border-dashed border-border/60 bg-muted/10 px-6 text-center text-sm text-muted-foreground">
          현재 조건에 맞는 시간표가 없습니다. 기간, 수업 상태, 과목을 확인해 주세요.
        </div>
      ) : (
        <div
          className="grid gap-6"
          style={{
            gridTemplateColumns: `repeat(${Math.min(
              gridCount,
              Math.max(grid.panels.length, 1),
            )}, minmax(0, 1fr))`,
          }}
        >
          {grid.panels.map((panel) => {
            const PanelIcon = iconForView(view);
            const isSavingPanel = savingPanelId === panel.id;
            const panelSummary = getTimetablePanelSummary(panel.blocks);

            return (
              <section
                key={panel.id}
                className="relative min-w-0 overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm"
              >
                <div
                  ref={(node) => {
                    timetablePanelRefs.current[panel.id] = node;
                  }}
                  className="min-w-0 bg-background"
                >
                  <div className="flex items-center gap-3 border-b border-border/70 bg-muted/15 px-4 py-3 pr-14">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground">
                      <PanelIcon className="size-4" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold tracking-tight text-foreground">
                        {panel.title}
                      </p>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                          수업 {panelSummary.lessonCount}개
                        </span>
                        <span className="inline-flex items-center rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                          주간 {panelSummary.weeklyHoursLabel}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "min-w-0 p-4",
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
                  className="absolute right-3 top-3 size-9 rounded-md border border-border/70 bg-background/95 text-muted-foreground shadow-sm hover:bg-primary/5 hover:text-primary disabled:opacity-60"
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
    </div>
  );
}
