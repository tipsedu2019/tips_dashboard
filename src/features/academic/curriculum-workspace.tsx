"use client";

import Link from "next/link";
import { type KeyboardEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ClipboardList, SlidersHorizontal } from "lucide-react";

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
  { value: "unlinked", label: "교재 미연결" },
  { value: "unscheduled", label: "회차 미생성" },
  { value: "update", label: "진도 미배정" },
  { value: "done", label: "계획 완료" },
] as const;
const CURRICULUM_QUICK_FILTER_IDS = ["subject", "grade", "teacher", "classroom"];
const CURRICULUM_SCROLL_STORAGE_PREFIX = "tips:curriculum-work-queue-scroll:";

function rowMatchesViewMode(row: Record<string, unknown>, viewMode: string) {
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

function getCurriculumScrollStorageKey(returnPath: string) {
  return `${CURRICULUM_SCROLL_STORAGE_PREFIX}${returnPath || "/admin/curriculum"}`;
}

function parseStoredCurriculumScroll(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { pageY?: unknown; listY?: unknown };
    return {
      pageY: Number(parsed.pageY || 0),
      listY: Number(parsed.listY || 0),
    };
  } catch {
    return null;
  }
}

function normalizeCurriculumViewMode(value: unknown) {
  const normalized = text(value);
  return CURRICULUM_VIEW_MODES.some((mode) => mode.value === normalized) ? normalized : "all";
}

function applyCurriculumQueryState(
  params: URLSearchParams,
  state: {
    search: string;
    period: string;
    status: string;
    subject: string;
    grade: string;
    teacher: string;
    classroom: string;
    viewMode: string;
  },
) {
  const values = [
    ["q", state.search.trim(), ""],
    ["period", state.period, ""],
    ["status", state.status, DEFAULT_CURRICULUM_STATUS_FILTER],
    ["subject", state.subject, ""],
    ["grade", state.grade, ""],
    ["teacher", state.teacher, ""],
    ["classroom", state.classroom, ""],
    ["view", normalizeCurriculumViewMode(state.viewMode), "all"],
  ] as const;

  for (const [key, value, defaultValue] of values) {
    if (value && value !== defaultValue) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }

  params.delete("classId");
  params.delete("tab");
  params.delete("section");
  params.delete("sessionId");
  params.delete("returnTo");
}

function buildCurriculumListHref(
  pathname: string,
  currentQuery: string,
  state: Parameters<typeof applyCurriculumQueryState>[1],
) {
  const params = new URLSearchParams(currentQuery);
  applyCurriculumQueryState(params, state);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function buildClassDetailHref(classId: string, tab = "basic", sectionId = "", sessionId = "", returnTo = "") {
  const normalizedClassId = text(classId);
  if (!normalizedClassId) {
    return "/admin/classes";
  }

  const params = new URLSearchParams();
  params.set("classId", normalizedClassId);
  params.set("tab", tab || "basic");
  const normalizedSectionId = text(sectionId);
  if (normalizedSectionId) {
    params.set("section", normalizedSectionId);
  }
  const normalizedSessionId = text(sessionId);
  if (normalizedSessionId) {
    params.set("sessionId", normalizedSessionId);
  }
  const normalizedReturnTo = text(returnTo);
  if (normalizedReturnTo) {
    params.set("returnTo", normalizedReturnTo);
  }
  return `/admin/classes?${params.toString()}`;
}

function getCurriculumDesignAction(row: Record<string, unknown>) {
  const nextSession = (row.nextSession || {}) as Record<string, unknown>;
  const sessionId = text(nextSession.id || nextSession.sessionId);

  if (Number(row.textbookCount || 0) <= 0) {
    return { label: "교재", tab: "curriculum", sectionId: "lesson-design-textbooks", sessionId: "", reason: "교재 연결 필요" };
  }

  if (Number(row.totalSessions || 0) <= 0) {
    return { label: "일정", tab: "schedule", sectionId: "lesson-design-periods", sessionId: "", reason: "회차 생성 필요" };
  }

  if (Number(row.delayedProgressSessions || 0) > 0) {
    return { label: "진도", tab: "curriculum", sectionId: "lesson-design-board", sessionId, reason: `미배정 ${Number(row.delayedProgressSessions || 0)}회` };
  }

  return { label: "보기", tab: "basic", sectionId: "", sessionId: "", reason: "기본 정보 확인" };
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
        <div className="border border-border/70 bg-background px-4 py-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={`row-${index}`} className="mb-3 h-16 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function AcademicCurriculumWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();
  const desktopListRef = useRef<HTMLDivElement | null>(null);
  const { data, loading, error } = useAcademicWorkspaceData();
  const [search, setSearch] = useState(() => text(searchParams.get("q")));
  const [period, setPeriod] = useState(() => text(searchParams.get("period")));
  const [status, setStatus] = useState(() => text(searchParams.get("status")) || DEFAULT_CURRICULUM_STATUS_FILTER);
  const [subject, setSubject] = useState(() => text(searchParams.get("subject")));
  const [grade, setGrade] = useState(() => text(searchParams.get("grade")));
  const [teacher, setTeacher] = useState(() => text(searchParams.get("teacher")));
  const [classroom, setClassroom] = useState(() => text(searchParams.get("classroom")));
  const [viewMode, setViewMode] = useState(() => normalizeCurriculumViewMode(searchParams.get("view")));
  const [classListLimitsByScope, setClassListLimitsByScope] = useState<Record<string, number>>({});
  const deferredSearch = useDeferredValue(search);

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
    () => model.rows.filter((row) => rowMatchesViewMode(row, viewMode)),
    [model.rows, viewMode],
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
      if (Number(row.textbookCount || 0) === 0) counts.unlinked += 1;
      if (Number(row.totalSessions || 0) === 0) counts.unscheduled += 1;
      if (text(row.stateLabel) === "진도 미배정") counts.update += 1;
      if (text(row.stateLabel) === "계획 완료") counts.done += 1;
    }
    return counts;
  }, [model.rows]);
  const curriculumWorkQueueItems = useMemo(
    () =>
      CURRICULUM_VIEW_MODES.map((mode) => ({
        ...mode,
        count: curriculumViewModeCounts[mode.value] || 0,
      })),
    [curriculumViewModeCounts],
  );
  const curriculumQueryState = useMemo(
    () => ({
      search,
      period,
      status,
      subject,
      grade,
      teacher,
      classroom,
      viewMode,
    }),
    [classroom, grade, period, search, status, subject, teacher, viewMode],
  );
  const curriculumReturnPath = useMemo(
    () => buildCurriculumListHref(pathname, searchParamString, curriculumQueryState),
    [curriculumQueryState, pathname, searchParamString],
  );

  useEffect(() => {
    const nextHref = buildCurriculumListHref(pathname, searchParamString, curriculumQueryState);
    const currentHref = searchParamString ? `${pathname}?${searchParamString}` : pathname;
    if (nextHref !== currentHref) {
      router.replace(nextHref, { scroll: false });
    }
  }, [curriculumQueryState, pathname, router, searchParamString]);

  const rememberCurriculumScrollPosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const viewport = desktopListRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    window.sessionStorage.setItem(
      getCurriculumScrollStorageKey(curriculumReturnPath),
      JSON.stringify({
        pageY: window.scrollY,
        listY: viewport?.scrollTop || 0,
      }),
    );
  }, [curriculumReturnPath]);

  const openCurriculumRow = useCallback(
    (row: Record<string, unknown>, rowDesignAction: ReturnType<typeof getCurriculumDesignAction>) => {
      rememberCurriculumScrollPosition();
      router.push(buildClassDetailHref(
        text(row.id),
        rowDesignAction.tab,
        rowDesignAction.sectionId,
        rowDesignAction.sessionId,
        curriculumReturnPath,
      ));
    },
    [curriculumReturnPath, rememberCurriculumScrollPosition, router],
  );

  const handleCurriculumRowKeyDown = useCallback(
    (
      event: KeyboardEvent<HTMLElement>,
      row: Record<string, unknown>,
      rowDesignAction: ReturnType<typeof getCurriculumDesignAction>,
    ) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      openCurriculumRow(row, rowDesignAction);
    },
    [openCurriculumRow],
  );

  useEffect(() => {
    if (typeof window === "undefined" || loading) return undefined;
    const savedScroll = parseStoredCurriculumScroll(
      window.sessionStorage.getItem(getCurriculumScrollStorageKey(curriculumReturnPath)),
    );
    if (!savedScroll) return undefined;

    const restoreScroll = () => {
      const viewport = desktopListRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      if (savedScroll.pageY > 0) {
        window.scrollTo({ top: savedScroll.pageY });
      }
      if (viewport && savedScroll.listY > 0) {
        viewport.scrollTop = savedScroll.listY;
      }
    };

    const firstFrame = window.requestAnimationFrame(() => {
      restoreScroll();
      window.requestAnimationFrame(restoreScroll);
    });
    return () => window.cancelAnimationFrame(firstFrame);
  }, [curriculumReturnPath, loading, visibleViewRows.length]);

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
        setPeriod(value === "none" ? "" : value);
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
          quickSelectIds={CURRICULUM_QUICK_FILTER_IDS}
          footerAction={
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
          }
        />
      </div>

      <div className="px-4 lg:px-6">
        <div data-testid="curriculum-work-queue" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {curriculumWorkQueueItems.map((item) => (
            <button
              key={`curriculum-work-queue-${item.value}`}
              type="button"
              aria-pressed={viewMode === item.value}
              className={[
                "flex h-12 items-center justify-between rounded-md border px-3 text-left text-sm transition-colors",
                viewMode === item.value
                  ? "border-primary bg-primary text-primary-foreground shadow-xs"
                  : "border-border/70 bg-background hover:border-primary/40 hover:bg-muted/40",
              ].join(" ")}
              onClick={() => setViewMode(item.value)}
            >
              <span className="min-w-0 truncate font-medium">{item.label}</span>
              <span
                className={[
                  "ml-3 rounded-md px-2 py-0.5 text-xs font-semibold",
                  viewMode === item.value ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {item.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 lg:px-6">
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
                    const rowDesignAction = getCurriculumDesignAction(row);
                    const hasLinkedTextbooks = row.textbookCount > 0;
                    const progressTargetSessionCount = row.progressTargetSessions ?? row.totalSessions;

                    return (
                      <article
                        key={`mobile-${row.id}`}
                        data-testid={`curriculum-mobile-card-${row.id}`}
                        role="link"
                        tabIndex={0}
                        aria-label={`${row.title} ${rowDesignAction.label} ${rowDesignAction.reason}`}
                        className="cursor-pointer rounded-md border bg-background p-3 shadow-xs transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openCurriculumRow(row, rowDesignAction)}
                        onKeyDown={(event) => handleCurriculumRowKeyDown(event, row, rowDesignAction)}
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

                          <div className="flex items-center justify-between gap-2" data-testid="curriculum-row-next-action">
                            <div className="min-w-0 text-xs">
                              <div className="text-muted-foreground">다음 작업</div>
                              <div className="truncate font-medium text-foreground">{rowDesignAction.reason}</div>
                            </div>
                            <Button asChild variant="outline" size="sm" className="h-8 rounded-sm px-2 text-xs">
                              <Link
                                href={buildClassDetailHref(
                                  row.id,
                                  rowDesignAction.tab,
                                  rowDesignAction.sectionId,
                                  rowDesignAction.sessionId,
                                  curriculumReturnPath,
                                )}
                                aria-label={`${row.title} ${rowDesignAction.label} ${rowDesignAction.reason}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  rememberCurriculumScrollPosition();
                                }}
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

                <div ref={desktopListRef} data-testid="curriculum-desktop-scroll-anchor">
                <ScrollArea className="hidden h-[38rem] [contain-intrinsic-size:640px] [content-visibility:auto] md:block">
                  <Table className="min-w-[980px] table-fixed">
                    <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_var(--border)]">
                      <TableRow>
                        <TableHead className="w-[28%]">수업</TableHead>
                        <TableHead className="w-[18%]">일정</TableHead>
                        <TableHead className="w-[22%]">수업교재</TableHead>
                        <TableHead className="w-[20%]">진도</TableHead>
                        <TableHead className="w-[12%] text-right">작업</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleViewRows.map((row) => {
                      const rowDesignAction = getCurriculumDesignAction(row);
                      const hasLinkedTextbooks = row.textbookCount > 0;
                      const progressTargetSessionCount = row.progressTargetSessions ?? row.totalSessions;

                      return (
                        <TableRow
                          key={row.id}
                          data-testid={`curriculum-desktop-row-${row.id}`}
                          role="link"
                          tabIndex={0}
                          aria-label={`${row.title} ${rowDesignAction.label} ${rowDesignAction.reason}`}
                          className="cursor-pointer transition-colors hover:bg-muted/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          onClick={() => openCurriculumRow(row, rowDesignAction)}
                          onKeyDown={(event) => handleCurriculumRowKeyDown(event, row, rowDesignAction)}
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
                            <div className="grid justify-items-end gap-1.5" data-testid="curriculum-row-next-action">
                              <div className="max-w-28 truncate text-xs font-medium text-muted-foreground">{rowDesignAction.reason}</div>
                              <Button asChild variant="outline" size="sm" className="h-8 rounded-sm px-2 text-xs">
                                <Link
                                  href={buildClassDetailHref(
                                    row.id,
                                    rowDesignAction.tab,
                                    rowDesignAction.sectionId,
                                    rowDesignAction.sessionId,
                                    curriculumReturnPath,
                                  )}
                                  aria-label={`${row.title} ${rowDesignAction.label} ${rowDesignAction.reason}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    rememberCurriculumScrollPosition();
                                  }}
                                >
                                  {rowDesignAction.label}
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
                </div>
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
      </div>
    </div>
  );
}
