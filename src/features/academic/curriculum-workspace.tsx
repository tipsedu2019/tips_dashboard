"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { BookOpen, CalendarDays, CheckCircle2, ClipboardList, SlidersHorizontal } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ClassFilterPanel,
  type ClassFilterPanelChip,
  type ClassFilterPanelSelect,
} from "@/features/management/class-filter-panel";
import { pickDefaultPeriodValue } from "@/features/management/period-preferences";
import { buildCurriculumWorkspaceModel } from "./records.js";
import { useAcademicWorkspaceData } from "./use-academic-workspace-data";

const DEFAULT_CURRICULUM_STATUS_FILTER = "수강";
const CURRICULUM_CLASS_PAGE_SIZE = 40;
const CURRICULUM_VIEW_MODES = [
  { value: "all", label: "전체" },
  { value: "operations", label: "등록/전반/퇴원" },
  { value: "unlinked", label: "교재 미연결" },
  { value: "unscheduled", label: "회차 미생성" },
  { value: "update", label: "진도 미배정" },
  { value: "done", label: "계획 완료" },
] as const;
const CURRICULUM_WORK_QUEUE_VALUES = new Set(["operations", "unlinked", "unscheduled", "update"]);
const CURRICULUM_WORK_QUEUE_MODES = CURRICULUM_VIEW_MODES.filter((mode) => CURRICULUM_WORK_QUEUE_VALUES.has(mode.value));
const KOREAN_DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function rowMatchesViewMode(row: Record<string, unknown>, viewMode: string, operationTasks: Array<Record<string, unknown>> = []) {
  if (viewMode === "operations") {
    return getCurriculumOperationImpactItems(row, operationTasks).length > 0;
  }
  if (viewMode === "unlinked") {
    return Number(row.textbookCount || 0) === 0;
  }
  if (viewMode === "unscheduled") {
    return Number(row.totalSessions || 0) === 0;
  }
  if (viewMode === "update") {
    return text(row.stateLabel) === "진도 미배정";
  }
  if (viewMode === "done") {
    return text(row.stateLabel) === "계획 완료";
  }
  return true;
}

function findFirstCurriculumQueueRow<T extends Record<string, unknown>>(
  rows: T[],
  queueMode: string,
  operationTasks: Array<Record<string, unknown>> = [],
  todayDayLabel = "",
) {
  return sortCurriculumQueueRows(rows, queueMode, operationTasks, todayDayLabel)[0] || null;
}

function getStateVariant(stateLabel: string) {
  if (stateLabel.includes("완료")) {
    return "default" as const;
  }
  if (stateLabel.includes("미배정")) {
    return "destructive" as const;
  }
  if (stateLabel.includes("미생성") || stateLabel.includes("미연결")) {
    return "outline" as const;
  }
  return "secondary" as const;
}

function text(value: unknown) {
  return String(value || "").trim();
}

function getCurriculumScheduleSlots(row: Record<string, unknown>) {
  return Array.isArray(row.scheduleSlots) ? row.scheduleSlots as Array<Record<string, unknown>> : [];
}

function getTodayDayLabel(date = new Date()) {
  return KOREAN_DAY_LABELS[date.getDay()] || "";
}

function rowHasScheduleOnDay(row: Record<string, unknown>, todayDayLabel: string) {
  if (!todayDayLabel) return false;
  return getCurriculumScheduleSlots(row).some((slot) => text(slot.day) === todayDayLabel);
}

function buildLessonDesignHref(classId: string, sessionId = "", sectionId = "") {
  const normalizedClassId = text(classId);
  if (!normalizedClassId) {
    return "/admin/curriculum";
  }

  const params = new URLSearchParams();
  params.set("classId", normalizedClassId);
  params.set("lessonDesign", "1");
  const normalizedSessionId = text(sessionId);
  if (normalizedSessionId) {
    params.set("sessionId", normalizedSessionId);
  }
  const normalizedSectionId = text(sectionId);
  if (normalizedSectionId) {
    params.set("section", normalizedSectionId);
  }
  return `/admin/curriculum/lesson-design?${params.toString()}`;
}

function getSessionSummaryLinkKey(session: Record<string, unknown>, index: number) {
  const stableId = text(session.sessionId || session.id);
  const sessionOrder = text(session.sessionOrder ?? session.sessionNumber);
  const dateValue = text(session.dateValue || session.dateLabel);
  const label = text(session.label);
  return [stableId || `session-${index}`, sessionOrder, dateValue, label, String(index)].filter(Boolean).join(":");
}

function getCurriculumDesignAction(row: Record<string, unknown>) {
  const nextSession = (row.nextSession || {}) as Record<string, unknown>;
  const sessionId = text(nextSession.id || nextSession.sessionId);

  if (Number(row.textbookCount || 0) <= 0) {
    return { label: "교재", sectionId: "lesson-design-textbooks", sessionId: "" };
  }

  if (Number(row.totalSessions || 0) <= 0) {
    return { label: "일정", sectionId: "lesson-design-periods", sessionId: "" };
  }

  if (Number(row.delayedProgressSessions || 0) > 0) {
    return { label: "진도", sectionId: "lesson-design-board", sessionId };
  }

  return { label: "보기", sectionId: "lesson-design-board", sessionId };
}

function formatTextbookCount(count: number) {
  return count > 0 ? `${count}권 연결` : "교재 미연결";
}

function formatProgressPrimary(plannedSessions: number, totalSessions: number) {
  if (totalSessions <= 0) {
    return "회차 설계 전";
  }

  return `진도 ${plannedSessions}/${totalSessions}회`;
}

function formatProgressPercent(progressPercent: number, totalSessions: number) {
  if (totalSessions <= 0) {
    return "-";
  }

  return `${progressPercent}%`;
}

function formatProgressMeta(plannedSessions: number, delayedSessions: number, totalSessions: number) {
  if (totalSessions <= 0) {
    return "수업 설계에서 회차 생성";
  }

  return `배정 ${plannedSessions}회 · 미배정 ${delayedSessions}회`;
}

type CurriculumOperationImpactItem = {
  id: string;
  type: string;
  label: string;
  title: string;
  studentName: string;
  dateLabel: string;
  sessionLabel: string;
  planStateLabel: string;
  planStateVariant: "default" | "secondary" | "destructive" | "outline";
  planFixHref: string;
};

function compactReference(value: unknown) {
  return text(value).replace(/\s+/g, "").toLowerCase();
}

function isClosedOperationTask(status: unknown) {
  return ["done", "canceled"].includes(text(status));
}

function classReferenceMatches(row: Record<string, unknown>, ...references: unknown[]) {
  const rowReferences = [row.id, row.fullTitle, row.title].map(compactReference).filter(Boolean);
  return references.some((reference) => {
    const normalizedReference = compactReference(reference);
    return Boolean(normalizedReference && rowReferences.includes(normalizedReference));
  });
}

function formatOperationImpactSchedule(dateValue: unknown, sessionValue: unknown) {
  return [text(dateValue) || "일정 미정", text(sessionValue)].filter(Boolean).join(" · ");
}

function getSessionOrderValue(value: unknown) {
  const normalizedValue = text(value);
  const directNumber = Number(normalizedValue);
  if (Number.isFinite(directNumber) && directNumber > 0) {
    return directNumber;
  }

  const matchedNumber = normalizedValue.match(/\d+/)?.[0];
  return matchedNumber ? Number(matchedNumber) : 0;
}

function getCurriculumOperationImpactPlanState(row: Record<string, unknown>, sessionLabel: unknown) {
  const targetSessionOrder = getSessionOrderValue(sessionLabel);
  const sessionSummaries = Array.isArray(row.sessionSummaries)
    ? row.sessionSummaries as Array<Record<string, unknown>>
    : [];

  if (targetSessionOrder <= 0) {
    return { label: "회차 미정", variant: "secondary" as const };
  }
  if (Number(row.totalSessions || 0) <= 0) {
    return { label: "회차 미생성", variant: "outline" as const };
  }
  if (Number(row.textbookCount || 0) <= 0) {
    return { label: "교재 미연결", variant: "outline" as const };
  }

  const targetSession = sessionSummaries.find((session) => {
    const sessionOrder = getSessionOrderValue(session.sessionOrder ?? session.sessionNumber ?? session.label);
    return sessionOrder === targetSessionOrder;
  });

  if (!targetSession) {
    return { label: "영향 회차 없음", variant: "destructive" as const };
  }
  if (!targetSession.hasPlanContent) {
    return { label: "영향 진도 미배정", variant: "destructive" as const };
  }

  return { label: "수업계획 확인", variant: "default" as const };
}

function getCurriculumOperationImpactSession(row: Record<string, unknown>, sessionLabel: unknown) {
  const targetSessionOrder = getSessionOrderValue(sessionLabel);
  if (targetSessionOrder <= 0) {
    return null;
  }

  const sessionSummaries = Array.isArray(row.sessionSummaries)
    ? row.sessionSummaries as Array<Record<string, unknown>>
    : [];

  return sessionSummaries.find((session) => {
    const sessionOrder = getSessionOrderValue(session.sessionOrder ?? session.sessionNumber ?? session.label);
    return sessionOrder === targetSessionOrder;
  }) || null;
}

function buildCurriculumOperationImpactPlanFixHref(row: Record<string, unknown>, sessionLabel: unknown, planStateLabel: string) {
  const impactSession = getCurriculumOperationImpactSession(row, sessionLabel);
  const impactSessionId = text(impactSession?.sessionId || impactSession?.id);
  const impactSectionId = planStateLabel === "교재 미연결"
    ? "lesson-design-textbooks"
    : planStateLabel === "회차 미정" || planStateLabel === "회차 미생성" || planStateLabel === "영향 회차 없음"
      ? "lesson-design-periods"
      : "lesson-design-board";

  return buildLessonDesignHref(text(row.id), impactSessionId, impactSectionId);
}

function buildCurriculumOperationImpactHref(item: CurriculumOperationImpactItem) {
  const path = item.type === "registration" ? "/admin/registration" : item.type === "transfer" ? "/admin/transfer" : "/admin/withdrawal";
  return `${path}?${new URLSearchParams({ taskId: item.id }).toString()}`;
}

function getCurriculumOperationImpactSortWeight(planStateLabel: string) {
  switch (planStateLabel) {
    case "영향 회차 없음":
    case "영향 진도 미배정":
      return 0;
    case "회차 미생성":
    case "교재 미연결":
      return 1;
    case "회차 미정":
      return 2;
    case "수업계획 확인":
      return 3;
    default:
      return 2;
  }
}

function getCurriculumOperationImpactItems(
  row: Record<string, unknown>,
  operationTasks: Array<Record<string, unknown>> = [],
): CurriculumOperationImpactItem[] {
  return operationTasks
    .filter((task) => !isClosedOperationTask(task.status))
    .flatMap((task) => {
      const buildImpactItem = (item: Omit<CurriculumOperationImpactItem, "planStateLabel" | "planStateVariant" | "planFixHref">) => {
        const planState = getCurriculumOperationImpactPlanState(row, item.sessionLabel);
        return {
          ...item,
          planStateLabel: planState.label,
          planStateVariant: planState.variant,
          planFixHref: buildCurriculumOperationImpactPlanFixHref(row, item.sessionLabel, planState.label),
        };
      };

      if (task.type === "registration") {
        if (!classReferenceMatches(row, task.classId, task.className)) return [];
        return [buildImpactItem({
          id: text(task.id),
          type: "registration",
          label: "등록 예정",
          title: text(task.title) || "등록",
          studentName: text(task.studentName) || "학생 미정",
          dateLabel: formatOperationImpactSchedule(task.registrationClassStartDate || task.dueAt, task.registrationClassStartSession),
          sessionLabel: text(task.registrationClassStartSession),
        })];
      }

      if (task.type === "withdrawal") {
        if (!classReferenceMatches(row, task.classId, task.className)) return [];
        return [buildImpactItem({
          id: text(task.id),
          type: "withdrawal",
          label: "퇴원 예정",
          title: text(task.title) || "퇴원",
          studentName: text(task.studentName) || "학생 미정",
          dateLabel: formatOperationImpactSchedule(task.withdrawalDate || task.dueAt, task.withdrawalSession),
          sessionLabel: text(task.withdrawalSession),
        })];
      }

      if (task.type === "transfer") {
        const isFromClass = classReferenceMatches(row, task.fromClassId, task.fromClassName);
        const isToClass = classReferenceMatches(row, task.toClassId, task.toClassName, task.classId, task.className);
        if (!isFromClass && !isToClass) return [];

        return [buildImpactItem({
          id: text(task.id),
          type: "transfer",
          label: isFromClass ? "전반 나감" : "전반 들어옴",
          title: text(task.title) || "전반",
          studentName: text(task.studentName) || "학생 미정",
          dateLabel: isFromClass
            ? formatOperationImpactSchedule(task.fromClassEndDate || task.dueAt, task.fromClassEndSession)
            : formatOperationImpactSchedule(task.toClassStartDate || task.dueAt, task.toClassStartSession),
          sessionLabel: text(isFromClass ? task.fromClassEndSession : task.toClassStartSession),
        })];
      }

      return [];
    })
    .sort((left, right) => (
      getCurriculumOperationImpactSortWeight(left.planStateLabel) - getCurriculumOperationImpactSortWeight(right.planStateLabel) ||
      left.dateLabel.localeCompare(right.dateLabel, "ko")
    ));
}

function getCurriculumQueueStateSortWeight(
  row: Record<string, unknown>,
  queueMode: string,
  operationTasks: Array<Record<string, unknown>> = [],
) {
  if (queueMode === "operations") {
    const firstImpact = getCurriculumOperationImpactItems(row, operationTasks)[0];
    return firstImpact ? getCurriculumOperationImpactSortWeight(firstImpact.planStateLabel) : 9;
  }
  if (Number(row.totalSessions || 0) <= 0) return 0;
  if (Number(row.textbookCount || 0) <= 0) return 1;
  if (text(row.stateLabel) === "진도 미배정") return 2;
  if (text(row.stateLabel) === "계획 완료") return 4;
  return 3;
}

function compareCurriculumQueueRows(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  queueMode: string,
  operationTasks: Array<Record<string, unknown>> = [],
  todayDayLabel = "",
) {
  const stateGap =
    getCurriculumQueueStateSortWeight(left, queueMode, operationTasks) -
    getCurriculumQueueStateSortWeight(right, queueMode, operationTasks);
  if (queueMode === "operations" && stateGap !== 0) return stateGap;

  const todayGap =
    Number(!rowHasScheduleOnDay(left, todayDayLabel)) -
    Number(!rowHasScheduleOnDay(right, todayDayLabel));
  if (todayGap !== 0) return todayGap;

  if (stateGap !== 0) return stateGap;

  return (
    text(left.term).localeCompare(text(right.term), "ko", { numeric: true }) ||
    text(left.title).localeCompare(text(right.title), "ko", { numeric: true })
  );
}

function sortCurriculumQueueRows<T extends Record<string, unknown>>(
  rows: T[],
  queueMode: string,
  operationTasks: Array<Record<string, unknown>> = [],
  todayDayLabel = "",
) {
  const matchedRows = rows.filter((row) => rowMatchesViewMode(row, queueMode, operationTasks));
  if (!CURRICULUM_WORK_QUEUE_VALUES.has(queueMode)) return matchedRows;
  return [...matchedRows].sort((left, right) => compareCurriculumQueueRows(left, right, queueMode, operationTasks, todayDayLabel));
}

function getCurriculumViewRows<T extends Record<string, unknown>>(
  rows: T[],
  viewMode: string,
  operationTasks: Array<Record<string, unknown>> = [],
  todayDayLabel = "",
) {
  return sortCurriculumQueueRows(rows, viewMode, operationTasks, todayDayLabel);
}

function CurriculumWorkspaceSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="border border-border/70 bg-background px-4 py-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`filter-${index}`} className="h-10 w-full" />
          ))}
        </div>
      </div>

      <div className="px-4 lg:px-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(24rem,0.65fr)]">
          <div className="border border-border/70 bg-background px-4 py-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={`row-${index}`} className="mb-3 h-16 w-full" />
            ))}
          </div>
          <div className="border border-border/70 bg-background px-4 py-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="mt-4 h-28 w-full" />
            <Skeleton className="mt-3 h-28 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AcademicCurriculumWorkspace() {
  const { data, loading, error } = useAcademicWorkspaceData();
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState(DEFAULT_CURRICULUM_STATUS_FILTER);
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [teacher, setTeacher] = useState("");
  const [classroom, setClassroom] = useState("");
  const [viewMode, setViewMode] = useState("all");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [classListLimitsByScope, setClassListLimitsByScope] = useState<Record<string, number>>({});
  const deferredSearch = useDeferredValue(search);
  const todayDayLabel = useMemo(() => getTodayDayLabel(), []);

  const baseModel = useMemo(
    () =>
      buildCurriculumWorkspaceModel({
        classes: data.classes,
        classTerms: data.classTerms,
        classGroups: data.classGroups,
        classGroupMembers: data.classGroupMembers,
        textbooks: data.textbooks,
        progressLogs: data.progressLogs,
        teacherCatalogs: data.teacherCatalogs,
        classroomCatalogs: data.classroomCatalogs,
        filters: {
          search: deferredSearch,
          classGroupId: "",
          status,
          subject,
          grade,
          teacher,
          classroom,
        },
      }),
    [
      classroom,
      data.classGroupMembers,
      data.classGroups,
      data.classTerms,
      data.classes,
      data.classroomCatalogs,
      data.progressLogs,
      data.teacherCatalogs,
      data.textbooks,
      deferredSearch,
      grade,
      status,
      subject,
      teacher,
    ],
  );
  const defaultPeriod = useMemo(() => pickDefaultPeriodValue(baseModel.classGroupOptions), [baseModel.classGroupOptions]);
  const normalizedPeriod =
    period && baseModel.classGroupOptions.some((option) => option.value === period) ? period : defaultPeriod;
  const model = useMemo(
    () =>
      buildCurriculumWorkspaceModel({
        classes: data.classes,
        classTerms: data.classTerms,
        classGroups: data.classGroups,
        classGroupMembers: data.classGroupMembers,
        textbooks: data.textbooks,
        progressLogs: data.progressLogs,
        teacherCatalogs: data.teacherCatalogs,
        classroomCatalogs: data.classroomCatalogs,
        filters: {
          search: deferredSearch,
          classGroupId: normalizedPeriod,
          status,
          subject,
          grade,
          teacher,
          classroom,
        },
      }),
    [
      classroom,
      data.classGroupMembers,
      data.classGroups,
      data.classTerms,
      data.classes,
      data.classroomCatalogs,
      data.progressLogs,
      data.teacherCatalogs,
      data.textbooks,
      deferredSearch,
      grade,
      normalizedPeriod,
      status,
      subject,
      teacher,
    ],
  );
  const hasNonDefaultPeriodFilter = Boolean(normalizedPeriod && normalizedPeriod !== defaultPeriod);
  const hasNonDefaultStatusFilter = status !== DEFAULT_CURRICULUM_STATUS_FILTER;
  const hasActiveFilters = Boolean(
    search.trim() ||
      hasNonDefaultPeriodFilter ||
      hasNonDefaultStatusFilter ||
      subject ||
      grade ||
      teacher ||
      classroom ||
      viewMode !== "all",
  );
  const viewRows = useMemo(
    () => {
      return getCurriculumViewRows(model.rows, viewMode, data.operationTasks, todayDayLabel);
    },
    [data.operationTasks, model.rows, todayDayLabel, viewMode],
  );
  const classListScopeKey = [
    normalizedPeriod || "none",
    status || "all",
    subject || "all",
    grade || "all",
    teacher || "all",
    classroom || "all",
    viewMode,
    deferredSearch.trim(),
    viewRows.length,
  ].join(":");
  const classListLimit = classListLimitsByScope[classListScopeKey] || CURRICULUM_CLASS_PAGE_SIZE;
  const visibleViewRows = useMemo(() => viewRows.slice(0, classListLimit), [classListLimit, viewRows]);
  const hasMoreViewRows = visibleViewRows.length < viewRows.length;
  const viewRowTotals = useMemo(
    () => {
      let sessions = 0;
      let textbooks = 0;
      for (const row of viewRows) {
        sessions += Number(row.totalSessions || 0);
        textbooks += Number(row.textbookCount || 0);
      }
      return { sessions, textbooks };
    },
    [viewRows],
  );
  const viewRowSessionCount = viewRowTotals.sessions;
  const viewRowTextbookCount = viewRowTotals.textbooks;
  const viewModeLabel = CURRICULUM_VIEW_MODES.find((mode) => mode.value === viewMode)?.label || "전체";
  const curriculumViewModeCounts = useMemo(() => {
    const counts = Object.fromEntries(CURRICULUM_VIEW_MODES.map((mode) => [mode.value, 0])) as Record<string, number>;
    for (const row of model.rows) {
      counts.all += 1;
      if (getCurriculumOperationImpactItems(row, data.operationTasks).length > 0) counts.operations += 1;
      if (Number(row.textbookCount || 0) === 0) counts.unlinked += 1;
      if (Number(row.totalSessions || 0) === 0) counts.unscheduled += 1;
      if (text(row.stateLabel) === "진도 미배정") counts.update += 1;
      if (text(row.stateLabel) === "계획 완료") counts.done += 1;
    }
    return counts;
  }, [data.operationTasks, model.rows]);
  const curriculumWorkQueueItems = useMemo(
    () =>
      CURRICULUM_WORK_QUEUE_MODES.map((mode) => {
        const firstRow = findFirstCurriculumQueueRow(model.rows, mode.value, data.operationTasks, todayDayLabel);
        return {
          ...mode,
          count: curriculumViewModeCounts[mode.value] || 0,
          firstRow,
          firstRowIsToday: Boolean(firstRow && rowHasScheduleOnDay(firstRow, todayDayLabel)),
        };
      }),
    [curriculumViewModeCounts, data.operationTasks, model.rows, todayDayLabel],
  );
  const selectedRow = useMemo(
    () =>
      viewRows.find((row) => row.id === selectedClassId) ||
      viewRows[0] ||
      null,
    [selectedClassId, viewRows],
  );
  const selectedRowProgressAction = selectedRow ? getCurriculumDesignAction(selectedRow) : null;
  const selectedProgressTargetSessionCount = selectedRow
    ? selectedRow.progressTargetSessions ?? selectedRow.totalSessions
    : 0;
  const selectedRowOperationImpacts = selectedRow ? getCurriculumOperationImpactItems(selectedRow, data.operationTasks) : [];
  const selectedRowScheduleSlots = selectedRow ? getCurriculumScheduleSlots(selectedRow) : [];

  const resetFilters = () => {
    setSearch("");
    setPeriod("");
    setStatus(DEFAULT_CURRICULUM_STATUS_FILTER);
    setSubject("");
    setGrade("");
    setTeacher("");
    setClassroom("");
    setViewMode("all");
  };

  const filterSelects: ClassFilterPanelSelect[] = [
    {
      id: "period",
      label: "기간",
      value: normalizedPeriod || "none",
      options: model.classGroupOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
      emptyValue: "none",
      emptyLabel: "기간 없음",
      disabled: model.classGroupOptions.length === 0,
      onChange: (value) => {
        if (value !== "none") {
          setPeriod(value);
        }
      },
    },
    {
      id: "status",
      label: "수업 상태",
      value: status,
      options: model.statusOptions.map((option) => ({
        value: option,
        label: option,
      })),
      onChange: setStatus,
    },
    {
      id: "subject",
      label: "과목",
      value: subject || "all",
      allowEmpty: true,
      emptyValue: "all",
      emptyLabel: "전체 과목",
      options: model.subjectOptions.map((option) => ({
        value: option,
        label: option,
      })),
      onChange: (value) => {
        setSubject(value === "all" ? "" : value);
        setTeacher("");
        setClassroom("");
      },
    },
    {
      id: "grade",
      label: "학년",
      value: grade || "all",
      allowEmpty: true,
      emptyValue: "all",
      emptyLabel: "전체 학년",
      options: model.gradeOptions.map((option) => ({
        value: option,
        label: option,
      })),
      onChange: (value) => setGrade(value === "all" ? "" : value),
    },
    {
      id: "teacher",
      label: "선생님",
      value: teacher || "all",
      allowEmpty: true,
      emptyValue: "all",
      emptyLabel: "전체 선생님",
      options: model.teacherOptions.map((option) => ({
        value: option,
        label: option,
      })),
      onChange: (value) => setTeacher(value === "all" ? "" : value),
    },
    {
      id: "classroom",
      label: "강의실",
      value: classroom || "all",
      allowEmpty: true,
      emptyValue: "all",
      emptyLabel: "전체 강의실",
      options: model.classroomOptions.map((option) => ({
        value: option,
        label: option,
      })),
      onChange: (value) => setClassroom(value === "all" ? "" : value),
    },
  ];

  const filterChips: ClassFilterPanelChip[] = [
    hasNonDefaultPeriodFilter
      ? {
          id: "period",
          label: <>기간 {model.classGroupOptions.find((option) => option.value === normalizedPeriod)?.label || normalizedPeriod}</>,
        }
      : null,
    hasNonDefaultStatusFilter ? { id: "status", label: <>수업 상태 {status}</> } : null,
    subject ? { id: "subject", label: <>과목 {subject}</> } : null,
    grade ? { id: "grade", label: <>학년 {grade}</> } : null,
    teacher ? { id: "teacher", label: <>선생님 {teacher}</> } : null,
    classroom ? { id: "classroom", label: <>강의실 {classroom}</> } : null,
  ].filter(Boolean) as ClassFilterPanelChip[];

  if (loading) {
    return <CurriculumWorkspaceSkeleton />;
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <div className="px-4 lg:px-6">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="px-4 lg:px-6">
        <ClassFilterPanel
          selects={filterSelects}
          searchValue={search}
          searchPlaceholder="수업 검색"
          onSearchChange={setSearch}
          summaryLabel={`수업 ${viewRows.length}개 · 교재 미연결 ${model.summary.unlinkedClassCount}개 · 진도 필요 ${model.summary.updateNeededClassCount}개`}
          chips={filterChips}
          showReset={hasActiveFilters}
          onReset={resetFilters}
          filterCount={filterChips.length}
          footerAction={
            <>
              <div data-testid="curriculum-view-mode-tabs" className="hidden flex-wrap items-center gap-1 lg:flex">
                {CURRICULUM_VIEW_MODES.map((mode) => (
                  <Button
                    key={`desktop-view-${mode.value}`}
                    type="button"
                    size="sm"
                    variant={viewMode === mode.value ? "default" : "outline"}
                    className="h-7 rounded-md px-2 text-xs"
                    onClick={() => setViewMode(mode.value)}
                  >
                    {mode.label}
                  </Button>
                ))}
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" size="sm" variant="outline" className="h-7 rounded-md px-2 text-xs lg:hidden">
                    <SlidersHorizontal className="mr-1.5 size-3.5" />
                    보기
                    <span className="ml-1.5 rounded bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
                      {viewModeLabel}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3">
                  <div className="grid grid-cols-2 gap-1.5">
                    {CURRICULUM_VIEW_MODES.map((mode) => (
                      <Button
                        key={mode.value}
                        type="button"
                        size="sm"
                        variant={viewMode === mode.value ? "default" : "outline"}
                        className="justify-start rounded-md"
                        onClick={() => setViewMode(mode.value)}
                      >
                        {mode.label}
                      </Button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </>
          }
        />
      </div>

      <div className="px-4 lg:px-6">
        <div data-testid="curriculum-work-queue" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {curriculumWorkQueueItems.map((item) => {
            const isOperationQueue = item.value === "operations";
            const queueAction = item.firstRow ? getCurriculumDesignAction(item.firstRow) : null;
            const firstOperationImpact = item.firstRow && isOperationQueue
              ? getCurriculumOperationImpactItems(item.firstRow, data.operationTasks)[0]
              : null;
            const queueEmptyLabel = isOperationQueue ? "진행 중 영향 없음" : "대상 없음";
            const queueDoneLabel = isOperationQueue ? "영향 없음" : "처리 없음";

            return (
              <div
                key={`curriculum-work-queue-${item.value}`}
                data-testid={`curriculum-work-queue-${item.value}`}
                className={[
                  "grid min-w-0 gap-2 rounded-md border bg-background p-2 transition-colors",
                  viewMode === item.value ? "border-primary bg-primary/5 shadow-xs" : "border-border/70 hover:border-primary/40",
                ].join(" ")}
              >
                <button
                  type="button"
                  aria-pressed={viewMode === item.value}
                  className="grid min-w-0 gap-1 text-left text-sm"
                  onClick={() => {
                    setViewMode(item.value);
                    setSelectedClassId(text(item.firstRow?.id || ""));
                  }}
                >
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{item.label}</span>
                    <span
                      className={[
                        "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold",
                        viewMode === item.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      ].join(" ")}
                    >
                      {item.count}
                    </span>
                  </span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {text(item.firstRow?.title) || queueEmptyLabel}
                  </span>
                  {item.firstRowIsToday ? (
                    <span className="inline-flex w-fit max-w-full items-center rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                      오늘 수업
                    </span>
                  ) : null}
                  {firstOperationImpact ? (
                    <span className="flex min-w-0 flex-wrap gap-1">
                      <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                        {firstOperationImpact?.label}
                      </span>
                      <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {firstOperationImpact?.studentName}
                      </span>
                      <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {firstOperationImpact?.dateLabel}
                      </span>
                      <span className="inline-flex max-w-full items-center rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {firstOperationImpact?.planStateLabel}
                      </span>
                    </span>
                  ) : null}
                </button>
                {item.firstRow && isOperationQueue && firstOperationImpact ? (
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-sm px-2 text-xs"
                      onClick={() => {
                        setViewMode(item.value);
                        setSelectedClassId(text(item.firstRow?.id || ""));
                      }}
                    >
                      영향 보기
                    </Button>
                    <Button asChild variant="outline" size="sm" className="h-7 rounded-sm px-2 text-xs">
                      <Link
                        href={buildCurriculumOperationImpactHref(firstOperationImpact)}
                        aria-label={`${firstOperationImpact.title} 업무 열기`}
                      >
                        업무 열기
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm" className="col-span-2 h-7 rounded-sm px-2 text-xs">
                      <Link
                        href={firstOperationImpact.planFixHref}
                        aria-label={`${text(item.firstRow.title)} ${firstOperationImpact.planStateLabel} 바로 수정`}
                      >
                        수업계획 수정
                      </Link>
                    </Button>
                  </div>
                ) : item.firstRow && isOperationQueue ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-sm px-2 text-xs"
                    onClick={() => {
                      setViewMode(item.value);
                      setSelectedClassId(text(item.firstRow?.id || ""));
                    }}
                  >
                    영향 보기
                  </Button>
                ) : item.firstRow && queueAction ? (
                  <Button asChild variant="outline" size="sm" className="h-7 rounded-sm px-2 text-xs">
                    <Link
                      href={buildLessonDesignHref(text(item.firstRow.id), queueAction.sessionId, queueAction.sectionId)}
                      aria-label={`${text(item.firstRow.title)} ${queueAction.label} 바로 열기`}
                    >
                      바로 열기
                    </Link>
                  </Button>
                ) : (
                  <span className="inline-flex h-7 items-center rounded-sm border border-dashed px-2 text-xs text-muted-foreground">
                    {queueDoneLabel}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-4 lg:px-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(24rem,0.65fr)]">
          <section className="overflow-hidden rounded-lg border border-border/70 bg-background">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <ClipboardList className="size-4 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">반별 수업계획</p>
                <Badge variant="secondary">{viewRows.length}개</Badge>
                {hasMoreViewRows ? <Badge variant="outline">{visibleViewRows.length}/{viewRows.length}</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {viewRowSessionCount}회차 · {viewRowTextbookCount}권
              </div>
            </div>
            {viewRows.length === 0 ? (
              <div className="text-muted-foreground flex min-h-72 items-center justify-center border border-dashed text-sm">
                현재 조건에 맞는 계획 데이터가 없습니다.
              </div>
            ) : (
              <>
                <div data-testid="curriculum-mobile-list" className="grid gap-2 p-3 md:hidden">
                  {visibleViewRows.map((row) => {
                    const isSelected = selectedRow?.id === row.id;
                    const rowDesignAction = getCurriculumDesignAction(row);
                    const hasLinkedTextbooks = row.textbookCount > 0;
                    const progressTargetSessionCount = row.progressTargetSessions ?? row.totalSessions;

                    return (
                      <article
                        key={`mobile-${row.id}`}
                        data-testid={`curriculum-mobile-card-${row.id}`}
                        role="button"
                        tabIndex={0}
                        data-selected={isSelected ? "true" : "false"}
                        aria-label={`${row.title} 선택`}
                        className={[
                          "rounded-md border bg-background p-3 shadow-xs transition-colors",
                          isSelected ? "border-primary bg-primary/5" : "hover:border-primary/40 hover:bg-muted/30",
                        ].join(" ")}
                        onClick={() => setSelectedClassId(row.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedClassId(row.id);
                          }
                        }}
                      >
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge>{row.subject || "과목 미정"}</Badge>
                            {row.grade ? <Badge variant="secondary">{row.grade}</Badge> : null}
                            <Badge variant={getStateVariant(row.stateLabel)}>{row.stateLabel}</Badge>
                          </div>

                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{row.title}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {row.teacherSummary || "선생님 미정"} · {row.term || "학기 미정"}
                            </p>
                          </div>

                          <div className="grid gap-2 text-xs">
                            <div className="rounded-md bg-muted/40 px-2 py-1.5">
                              <p className="font-medium">{row.schedule || "시간표 미정"}</p>
                              <p className="text-muted-foreground">{row.nextSession?.label || "회차 미생성"}</p>
                            </div>
                            <div className="rounded-md bg-muted/40 px-2 py-1.5">
                              <p className={row.textbookCount > 0 ? "font-medium" : "font-medium text-muted-foreground"}>
                                {row.textbookSummary || formatTextbookCount(row.textbookCount)}
                                {row.textbookOverflowCount > 0 ? ` 외 ${row.textbookOverflowCount}권` : ""}
                              </p>
                              <p className="truncate text-muted-foreground">
                                {row.textbookScopeLabels?.slice(0, 2).join(", ") || "영역 미정"}
                              </p>
                            </div>
                          </div>

                          {hasLinkedTextbooks ? (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span>{formatProgressPrimary(row.plannedProgressSessions, progressTargetSessionCount)}</span>
                                <span className="text-muted-foreground">
                                  {formatProgressPercent(row.progressTargetPercent, progressTargetSessionCount)}
                                </span>
                              </div>
                              {progressTargetSessionCount > 0 ? <Progress value={row.progressTargetPercent} /> : <div className="h-2 rounded-full bg-muted" />}
                              <p className="text-xs text-muted-foreground">
                                {formatProgressMeta(row.plannedProgressSessions, row.delayedProgressSessions, progressTargetSessionCount)}
                              </p>
                            </div>
                          ) : (
                            <div className="inline-flex h-8 items-center rounded-md border border-dashed bg-muted/20 px-2.5 text-xs font-medium text-muted-foreground">
                              교재 연결 필요
                            </div>
                          )}

                          <div className="flex justify-end">
                            <Button asChild variant="outline" size="sm" className="h-8 rounded-sm px-2 text-xs">
                              <Link
                                href={buildLessonDesignHref(row.id, rowDesignAction.sessionId, rowDesignAction.sectionId)}
                                aria-label={`${row.title} ${rowDesignAction.label}`}
                                onClick={(event) => event.stopPropagation()}
                              >
                                {rowDesignAction.label}
                              </Link>
                            </Button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <ScrollArea className="hidden h-[38rem] [contain-intrinsic-size:640px] [content-visibility:auto] md:block">
                  <Table className="min-w-[1040px] table-fixed">
                    <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_var(--border)]">
                      <TableRow>
                        <TableHead className="w-[30%]">수업</TableHead>
                        <TableHead className="w-[18%]">일정</TableHead>
                        <TableHead className="w-[22%]">수업교재</TableHead>
                        <TableHead className="w-[20%]">진도</TableHead>
                        <TableHead className="w-[10%] text-right">작업</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleViewRows.map((row) => {
                      const isSelected = selectedRow?.id === row.id;
                      const rowDesignAction = getCurriculumDesignAction(row);
                      const hasLinkedTextbooks = row.textbookCount > 0;
                      const progressTargetSessionCount = row.progressTargetSessions ?? row.totalSessions;

                      return (
                        <TableRow
                          key={row.id}
                          aria-selected={isSelected}
                          tabIndex={0}
                          aria-label={`${row.title} 선택`}
                          className={
                            isSelected
                              ? "cursor-pointer border-l-2 border-l-primary bg-primary/5 transition-colors hover:bg-primary/10"
                              : "cursor-pointer transition-colors hover:bg-muted/30"
                          }
                          onClick={() => setSelectedClassId(row.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedClassId(row.id);
                            }
                          }}
                        >
                          <TableCell className="align-top">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge>{row.subject || "과목 미정"}</Badge>
                                {row.grade ? <Badge variant="secondary">{row.grade}</Badge> : null}
                                <Badge variant={getStateVariant(row.stateLabel)}>{row.stateLabel}</Badge>
                              </div>
                              <div>
                                <p className="truncate font-medium text-foreground">{row.title}</p>
                                <p className="truncate text-sm text-muted-foreground">
                                  {row.teacherSummary || "선생님 미정"} · {row.term || "학기 미정"}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="align-top text-sm">
                            <div className="min-w-0 space-y-1">
                              <p className="truncate font-medium">{row.schedule || "시간표 미정"}</p>
                              <p className="text-muted-foreground">
                                {row.nextSession?.label || "회차 미생성"}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="align-top text-sm">
                            <div className="min-w-0 space-y-1">
                              <p className={row.textbookCount > 0 ? "truncate font-medium" : "truncate font-medium text-muted-foreground"}>
                                {row.textbookSummary || formatTextbookCount(row.textbookCount)}
                                {row.textbookOverflowCount > 0 ? ` 외 ${row.textbookOverflowCount}권` : ""}
                              </p>
                              <p className="truncate text-muted-foreground">
                                {row.textbookScopeLabels?.slice(0, 2).join(", ") || "영역 미정"}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            {hasLinkedTextbooks ? (
                              <div className="min-w-0 space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                  <span>{formatProgressPrimary(row.plannedProgressSessions, progressTargetSessionCount)}</span>
                                  <span className="text-muted-foreground">
                                    {formatProgressPercent(row.progressTargetPercent, progressTargetSessionCount)}
                                  </span>
                                </div>
                                {progressTargetSessionCount > 0 ? (
                                  <Progress value={row.progressTargetPercent} />
                                ) : (
                                  <div className="h-2 rounded-full bg-muted" />
                                )}
                                <p className="text-muted-foreground text-xs">
                                  {formatProgressMeta(row.plannedProgressSessions, row.delayedProgressSessions, progressTargetSessionCount)}
                                </p>
                              </div>
                            ) : (
                              <div className="inline-flex h-8 items-center rounded-md border border-dashed bg-muted/20 px-2.5 text-xs font-medium text-muted-foreground">
                                교재 연결 필요
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="align-top text-right">
                            <Button asChild variant="outline" size="sm" className="h-8 rounded-sm px-2 text-xs">
                              <Link
                                href={buildLessonDesignHref(row.id, rowDesignAction.sessionId, rowDesignAction.sectionId)}
                                aria-label={`${row.title} ${rowDesignAction.label}`}
                                onClick={(event) => event.stopPropagation()}
                              >
                                {rowDesignAction.label}
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
                {hasMoreViewRows ? (
                  <div className="flex justify-center border-t bg-background px-4 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-w-44"
                      onClick={() => setClassListLimitsByScope((current) => ({
                        ...current,
                        [classListScopeKey]: (current[classListScopeKey] || CURRICULUM_CLASS_PAGE_SIZE) + CURRICULUM_CLASS_PAGE_SIZE,
                      }))}
                    >
                      더 보기 · {visibleViewRows.length}/{viewRows.length}개
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </section>

          <section className="border border-border/70 bg-background xl:sticky xl:top-24 xl:self-start">
            {selectedRow ? (
              <div className="flex h-full flex-col">
                <div className="border-b px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{selectedRow.subject || "과목 미정"}</Badge>
                        {selectedRow.grade ? <Badge variant="secondary">{selectedRow.grade}</Badge> : null}
                        <Badge variant={getStateVariant(selectedRow.stateLabel)}>{selectedRow.stateLabel}</Badge>
                      </div>
                      <div>
                        <p className="truncate text-lg font-semibold text-foreground">{selectedRow.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {selectedRow.teacherSummary || "선생님 미정"} · {selectedRow.schedule || "시간표 미정"}
                        </p>
                      </div>
                    </div>
                    <div data-testid="curriculum-detail-actions" className="flex shrink-0 flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline" className="h-8 rounded-md px-2.5 text-xs">
                        <Link href={buildLessonDesignHref(selectedRow.id, "", "lesson-design-periods")}>
                          일정 생성
                        </Link>
                      </Button>
                      {selectedRowProgressAction ? (
                        <Button asChild size="sm" className="h-8 rounded-md px-2.5 text-xs">
                          <Link
                            href={buildLessonDesignHref(
                              selectedRow.id,
                              selectedRowProgressAction.sessionId,
                              selectedRowProgressAction.sectionId,
                            )}
                          >
                            {selectedRowProgressAction.label === "교재" ? "교재 연결" : "진도 생성"}
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <ScrollArea className="h-[35rem]">
                  <div className="space-y-5 px-4 py-4">
                    <div className="grid grid-cols-3 divide-x rounded-lg border text-sm">
                      <div className="px-3 py-2">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <CalendarDays className="size-3.5" />
                          <span>회차</span>
                        </div>
                        <p className="mt-1 font-semibold">{selectedProgressTargetSessionCount}회</p>
                      </div>
                      <div className="px-3 py-2">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <BookOpen className="size-3.5" />
                          <span>교재</span>
                        </div>
                        <p className="mt-1 font-semibold">{selectedRow.textbookCount}권</p>
                      </div>
                      <div className="px-3 py-2">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <CheckCircle2 className="size-3.5" />
                          <span>진도</span>
                        </div>
                        <p className="mt-1 font-semibold">{selectedRow.plannedProgressSessions}회</p>
                      </div>
                    </div>

                    <div data-testid="curriculum-detail-timetable">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">시간표</p>
                        <Badge variant="outline">{selectedRowScheduleSlots.length}칸</Badge>
                      </div>
                      {selectedRowScheduleSlots.length > 0 ? (
                        <div className="space-y-2">
                          {selectedRowScheduleSlots.map((slot, slotIndex) => {
                            const slotTime = [text(slot.day), [text(slot.start), text(slot.end)].filter(Boolean).join("-")]
                              .filter(Boolean)
                              .join(" ");
                            const slotMeta = [text(slot.teacher) || "선생님 미정", text(slot.classroom) || "강의실 미정"].join(" · ");

                            return (
                              <div key={`${slotTime}-${slotIndex}`} className="rounded-lg border px-3 py-2 text-sm">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="font-medium text-foreground">{slotTime || "시간 미정"}</p>
                                  <Badge variant="secondary">{text(slot.classroom) || "강의실 미정"}</Badge>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">{slotMeta}</p>
                              </div>
                            );
                          })}
                          <Button asChild variant="outline" size="sm" className="h-8 w-full rounded-md px-2.5 text-xs">
                            <Link href={buildLessonDesignHref(selectedRow.id, "", "lesson-design-periods")}>
                              <CalendarDays className="size-3.5" />
                              시간표 수정
                            </Link>
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="rounded-lg border border-dashed px-3 py-5 text-sm text-muted-foreground">
                            시간표 미정
                          </div>
                          <Button asChild variant="outline" size="sm" className="h-8 w-full rounded-md px-2.5 text-xs">
                            <Link href={buildLessonDesignHref(selectedRow.id, "", "lesson-design-periods")}>
                              <CalendarDays className="size-3.5" />
                              시간표 수정
                            </Link>
                          </Button>
                        </div>
                      )}
                    </div>

                    <div data-testid="curriculum-operation-impact">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">등록/전반/퇴원 영향</p>
                        <Badge variant="outline">{selectedRowOperationImpacts.length}건</Badge>
                      </div>
                      {selectedRowOperationImpacts.length > 0 ? (
                        <div className="space-y-2">
                          {selectedRowOperationImpacts.slice(0, 5).map((item) => (
                            <div
                              key={`${item.type}-${item.id}-${item.label}`}
                              className="rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/40"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <Link
                                  href={buildCurriculumOperationImpactHref(item)}
                                  className="min-w-0 truncate font-medium text-foreground hover:text-primary"
                                >
                                  {item.title}
                                </Link>
                                <Badge variant={item.type === "registration" ? "default" : item.type === "transfer" ? "secondary" : "outline"}>
                                  {item.label}
                                </Badge>
                              </div>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                {item.studentName} · {item.dateLabel}
                              </p>
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <Badge variant={item.planStateVariant}>{item.planStateLabel}</Badge>
                                <Link
                                  href={buildCurriculumOperationImpactHref(item)}
                                  className="inline-flex h-6 items-center rounded border bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                                >
                                  업무 열기
                                </Link>
                                <Link
                                  href={item.planFixHref}
                                  className="inline-flex h-6 items-center rounded border bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                                >
                                  수업계획 수정
                                </Link>
                              </div>
                            </div>
                          ))}
                          {selectedRowOperationImpacts.length > 5 ? (
                            <div className="rounded-lg border border-dashed px-3 py-2 text-center text-sm font-medium text-muted-foreground">
                              나머지 {selectedRowOperationImpacts.length - 5}건은 운영 화면에서 확인
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed px-3 py-5 text-sm text-muted-foreground">
                          진행 중 등록/전반/퇴원 없음
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">수업교재</p>
                        <Badge variant="outline">{selectedRow.textbookCount}권</Badge>
                      </div>
                      {selectedRow.textbookCatalog.length > 0 ? (
                        <div className="space-y-2">
                          {selectedRow.textbookCatalog.map((book) => (
                            <div key={book.textbookId} className="rounded-lg border px-3 py-2 text-sm">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-foreground">{book.title}</p>
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {[book.publisher, book.scopeLabel || book.category].filter(Boolean).join(" · ") || "교재 정보"}
                                  </p>
                                </div>
                                <Badge variant={book.role === "main" ? "default" : "secondary"}>
                                  {book.role === "main" ? "주교재" : "부교재"}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed px-3 py-5 text-sm text-muted-foreground">
                          수업 설계에서 교재를 연결하세요.
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">회차 배치</p>
                        <Badge variant="outline">
                          {selectedRow.plannedProgressSessions}/{selectedProgressTargetSessionCount}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        {selectedRow.sessionSummaries.slice(0, 8).map((session, sessionIndex) => {
                          const sessionStatusLabel = session.hasPlanContent ? "계획 완료" : "진도 미배정";
                          const sessionHref = buildLessonDesignHref(
                            selectedRow.id,
                            session.sessionId || "",
                            "lesson-design-periods",
                          );
                          const sessionMeta = [
                            session.periodLabel,
                            session.planSummary || "범위 미지정",
                            session.textbookEntryCount > 0 ? `${session.textbookEntryCount}권` : "",
                          ].filter(Boolean).join(" · ");

                          return (
                            <Link
                              key={getSessionSummaryLinkKey(session, sessionIndex)}
                              href={sessionHref}
                              className="block rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/40"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-medium text-foreground">{session.label}</p>
                                <Badge variant={getStateVariant(sessionStatusLabel)}>
                                  {session.hasPlanContent ? "배정" : "대기"}
                                </Badge>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {sessionMeta || "범위 미지정"}
                              </p>
                            </Link>
                          );
                        })}
                        {selectedRow.sessionSummaries.length === 0 ? (
                          <div className="rounded-lg border border-dashed px-3 py-5 text-sm text-muted-foreground">
                            수업일정 생성기로 회차를 먼저 만들 수 있습니다.
                          </div>
                        ) : null}
                        {selectedRow.sessionSummaries.length > 8 ? (
                          <Link
                            href={buildLessonDesignHref(selectedRow.id, "", "lesson-design-periods")}
                            className="block rounded-lg border border-dashed px-3 py-2 text-center text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                          >
                            나머지 {selectedRow.sessionSummaries.length - 8}회 보기
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div className="text-muted-foreground flex min-h-72 items-center justify-center border border-dashed text-sm">
                선택 중인 수업이 없습니다.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
