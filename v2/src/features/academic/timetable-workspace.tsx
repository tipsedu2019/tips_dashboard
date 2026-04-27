"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  CalendarDays,
  GraduationCap,
  School,
  User,
  type LucideIcon,
} from "lucide-react";

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

export function AcademicTimetableWorkspace() {
  const { data, loading, error } = useAcademicWorkspaceData();
  const [view, setView] = useState<TimetableView>("teacher-weekly");
  const [classGroupId, setClassGroupId] = useState("");
  const [status, setStatus] = useState("수강");
  const [gridCount, setGridCount] = useState(2);
  const [selectedTeachers, setSelectedTeachers] = useState<string[]>([]);
  const [selectedClassrooms, setSelectedClassrooms] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);

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

  const activeSubFilterLabel =
    view === "teacher-weekly"
      ? "선생님"
      : view === "classroom-weekly"
        ? "강의실"
        : "요일";

  const filteredRows = useMemo(
    () =>
      workspace.rows.filter((row) => {
        if (view === "teacher-weekly") {
          return selectedTeachers.length === 0 || selectedTeachers.includes(row.teacher);
        }

        if (view === "classroom-weekly") {
          return selectedClassrooms.length === 0 || selectedClassrooms.includes(row.classroom);
        }

        return selectedDays.length === 0 || selectedDays.includes(row.day);
      }),
    [selectedClassrooms, selectedDays, selectedTeachers, view, workspace.rows],
  );

  const axisSelectedTargets =
    view === "teacher-weekly"
      ? selectedTeachers
      : view === "classroom-weekly"
        ? selectedClassrooms
        : selectedDays;

  const grid = useMemo(
    () =>
      buildTimetableGridPanels({
        workspace: {
          ...workspace,
          rows: filteredRows,
        },
        view,
        gridCount,
        selectedTargets: axisSelectedTargets,
      }),
    [axisSelectedTargets, filteredRows, gridCount, view, workspace],
  );

  const panelLayout = getTimetablePanelLayout({ view, gridCount });

  const toggleFilterValue = (
    value: string,
    currentValues: string[],
    setter: (values: string[]) => void,
  ) => {
    const hasValue = currentValues.includes(value);
    setter(hasValue ? currentValues.filter((item) => item !== value) : [...currentValues, value]);
  };

  const resetFilters = () => {
    setClassGroupId(defaultPeriodId);
    setStatus("수강");
    setSelectedTeachers([]);
    setSelectedClassrooms([]);
    setSelectedDays([]);
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
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,1.35fr)_auto]">
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
          현재 조건에 맞는 시간표가 없습니다. 기간과 수업 상태를 확인해 주세요.
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

            return (
              <section
                key={panel.id}
                className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm"
              >
                <div className="flex items-center gap-3 border-b border-border/70 bg-muted/15 px-4 py-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground">
                    <PanelIcon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold tracking-tight text-foreground">
                      {panel.title}
                    </p>
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
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
