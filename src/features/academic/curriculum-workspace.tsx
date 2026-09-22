"use client";

import Link from "next/link";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, ClipboardList } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import {
  DATA_TABLE_LAYOUT_CLASS_NAME,
  DATA_TABLE_MOBILE_LIST_CLASS_NAME,
  DATA_TABLE_PAGER_CLASS_NAME,
  DATA_TABLE_TOOLBAR_CLASS_NAME,
  DataTableBodyCell,
  DataTableBodyRow,
  DataTableHeaderCell,
  DataTableHeaderRow,
  DataTableViewport,
} from "@/components/data-table/data-table-surface";
import { normalizePage } from "@/lib/numbered-pagination";
import {
  Table,
  TableBody,
  TableHeader,
} from "@/components/ui/table";
import {
  ClassFilterPanel,
  type ClassFilterPanelSelect,
} from "@/features/management/class-filter-panel";
import { getCurriculumDesignAction as resolveCurriculumDesignAction } from "./academic-read-service.js";
import type { CurriculumRow } from "./records.js";
import { useAcademicWorkspaceData } from "./use-academic-workspace-data";

const DEFAULT_CURRICULUM_STATUS_FILTER = "수강";
const CURRICULUM_VIEW_MODES = [
  { value: "all", label: "전체" },
  { value: "unscheduled", label: "일정 없음" },
  { value: "update", label: "일정 연장 필요" },
  { value: "done", label: "일정 편성" },
] as const;
const CURRICULUM_SCROLL_STORAGE_PREFIX = "tips:curriculum-work-queue-scroll:";

function getStateVariant(stateLabel: string) {
  if (stateLabel.includes("완료")) {
    return "secondary" as const;
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

function buildCurriculumFilterOptions(values: string[], selected: string) {
  const options = selected && !values.includes(selected) ? [selected, ...values] : values;
  return options.map((value) => ({ value, label: value }));
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

function curriculumNavigationKey(query: string) {
  const params = new URLSearchParams(query);
  params.delete("period");
  return params.toString();
}

function applyCurriculumQueryState(
  params: URLSearchParams,
  state: {
    search: string;
    status: string;
    subject: string;
    grade: string;
    teacher: string;
    classroom: string;
    viewMode: string;
    page: number;
  },
) {
  const values = [
    ["q", state.search.trim(), ""],
    ["status", state.status, DEFAULT_CURRICULUM_STATUS_FILTER],
    ["subject", state.subject, ""],
    ["grade", state.grade, ""],
    ["teacher", state.teacher, ""],
    ["classroom", state.classroom, ""],
    ["view", normalizeCurriculumViewMode(state.viewMode), "all"],
    ["page", String(state.page), "1"],
  ] as const;

  for (const [key, value, defaultValue] of values) {
    if (value && value !== defaultValue) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }

  params.delete("period");

  params.delete("classId");
  params.delete("lessonDesign");
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

function buildLessonDesignHref(classId: string, sectionId = "", sessionId = "", returnTo = "") {
  const normalizedClassId = text(classId);
  if (!normalizedClassId) {
    return "/admin/curriculum";
  }

  const params = new URLSearchParams();
  params.set("lessonDesign", "1");
  params.set("classId", normalizedClassId);
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
  return `/admin/curriculum?${params.toString()}`;
}

function getCurriculumDesignAction(row: Record<string, unknown>) {
  return resolveCurriculumDesignAction(row);
}

function CurriculumClassIdentity({ row }: { row: CurriculumRow }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="break-words text-sm font-semibold leading-5 text-foreground">{row.title}</p>
      <p className="break-words text-xs leading-5 text-muted-foreground">
        {[row.subject, row.grade, row.teacherSummary || "선생님 미정"].filter(Boolean).join(" · ")}
      </p>
      <Badge variant={getStateVariant(row.stateLabel)} className="text-[11px]">{row.stateLabel}</Badge>
    </div>
  );
}

function CurriculumSchedule({ row }: { row: CurriculumRow }) {
  return (
    <div className="min-w-0 space-y-1 text-sm leading-5">
      <p className="break-words">{row.schedule || "시간표 미정"}</p>
      <p className="break-words text-xs text-muted-foreground">{row.classroomSummary || "강의실 미정"}</p>
    </div>
  );
}

function CurriculumSessions({ row }: { row: CurriculumRow }) {
  return <div className="space-y-1 text-sm tabular-nums">
    <p>{row.totalSessions > 0 ? `${row.totalSessions}회` : "—"}</p>
    <p className="text-xs text-muted-foreground">{row.nextSession?.label ? `다음 ${row.nextSession.label}` : row.totalSessions > 0 ? "예정된 일정 없음" : ""}</p>
  </div>;
}

function CurriculumWorkspaceSkeleton() {
  return (
    <div className="px-4 lg:px-6" role="status" aria-label="수업계획 불러오는 중">
      <div className={DATA_TABLE_LAYOUT_CLASS_NAME}>
        <div className={DATA_TABLE_TOOLBAR_CLASS_NAME}>
          <Skeleton className="h-11 w-full sm:h-9 lg:max-w-xl" />
          <Skeleton className="h-11 w-24 md:hidden" />
          <div className="hidden gap-2 md:grid md:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={`filter-${index}`} className="h-14 w-full" />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-b p-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={`mode-${index}`} className="h-9 w-24" />
          ))}
        </div>
        <div className="space-y-3 p-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={`row-${index}`} className="h-24 w-full" />
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
  const [search, setSearch] = useState(() => text(searchParams.get("q")));
  const [status, setStatus] = useState(() => text(searchParams.get("status")) || DEFAULT_CURRICULUM_STATUS_FILTER);
  const [subject, setSubject] = useState(() => text(searchParams.get("subject")));
  const [grade, setGrade] = useState(() => text(searchParams.get("grade")));
  const [teacher, setTeacher] = useState(() => text(searchParams.get("teacher")));
  const [classroom, setClassroom] = useState(() => text(searchParams.get("classroom")));
  const [viewMode, setViewMode] = useState(() => normalizeCurriculumViewMode(searchParams.get("view")));
  const [observedQuery, setObservedQuery] = useState(searchParamString);
  const [writtenQuery, setWrittenQuery] = useState<string | null>(null);
  const [navigation, setNavigation] = useState(() => ({ key: curriculumNavigationKey(searchParamString), page: normalizePage(Number(searchParams.get("page"))) }));
  // Adopt the complete restored location in one render, before reads or URL effects commit.
  if (observedQuery !== searchParamString) {
    setObservedQuery(searchParamString);
    // A self-write is acknowledged once; any other location invalidates it too.
    setWrittenQuery(null);
    if (writtenQuery !== searchParamString) {
      setSearch(text(searchParams.get("q")));
      setStatus(text(searchParams.get("status")) || DEFAULT_CURRICULUM_STATUS_FILTER);
      setSubject(text(searchParams.get("subject"))); setGrade(text(searchParams.get("grade")));
      setTeacher(text(searchParams.get("teacher"))); setClassroom(text(searchParams.get("classroom")));
      setViewMode(normalizeCurriculumViewMode(searchParams.get("view")));
      setNavigation({ key: curriculumNavigationKey(searchParamString), page: normalizePage(Number(searchParams.get("page"))) });
    }
  }
  const {
    data: curriculumData,
    loading,
    page: displayedPage, pageSize, totalCount, goToPage, setPageSizePreference,
    displayRequest,
    dataMatchesCurrentScope,
    error,
    refresh,
  } = useAcademicWorkspaceData({
    mode: "curriculum",
    search,
    status,
    subject: subject || null,
    grade: grade || null,
    teacher: teacher || null,
    classroom: classroom || null,
    viewMode,
    cursor: null,
    page: navigation.page,
    navigationKey: navigation.key,
  });
  const renderData = curriculumData;
  const handlePageChange = (page: number) => {
    if (totalCount === null || displayRequest.mode !== "curriculum") return;
    setSearch(displayRequest.search);
    setStatus(displayRequest.status || DEFAULT_CURRICULUM_STATUS_FILTER);
    setSubject(displayRequest.subject || ""); setGrade(displayRequest.grade || "");
    setTeacher(displayRequest.teacher || ""); setClassroom(displayRequest.classroom || "");
    setViewMode(displayRequest.viewMode);
    return goToPage(page);
  };
  const page = (renderData?.page || {}) as {
    rows?: CurriculumRow[];
    hasMore?: boolean;
  };
  const stats = useMemo(
    () => (renderData?.stats || {}) as Record<string, unknown>,
    [renderData?.stats],
  );
  const filterOptions = useMemo(
    () => (renderData?.filterOptions || {}) as Record<string, unknown>,
    [renderData?.filterOptions],
  );
  const model = useMemo(() => {
    const optionValues = (key: string) => Array.isArray(filterOptions[key])
      ? (filterOptions[key] as unknown[]).map((value) => text(value)).filter(Boolean)
      : [];
    return {
      rows: Array.isArray(page.rows) ? page.rows : [],
      statusOptions: optionValues("statuses"),
      subjectOptions: optionValues("subjects"),
      gradeOptions: optionValues("grades"),
      teacherOptions: optionValues("teachers"),
      classroomOptions: optionValues("classrooms"),
      summary: {

        classCount: Number(stats.total || 0),
        managedClassCount: Number(stats.managedClassCount || 0),
        totalSessions: Number(stats.totalSessions || 0),
        completedSessions: Number(stats.completedSessions || 0),
        pendingSessions: Number(stats.pendingSessions || 0),
        noScheduleClassCount: Number(stats.noScheduleClassCount || 0),
        updateNeededClassCount: Number(stats.updateNeededClassCount || 0),
        completedClassCount: Number(stats.completedClassCount || 0),
        viewModeCounts: stats.viewModeCounts && typeof stats.viewModeCounts === "object"
          ? stats.viewModeCounts as Record<string, number>
          : {},
      },
    };
  }, [filterOptions, page.rows, stats]);
  const hasNonDefaultStatusFilter = status !== DEFAULT_CURRICULUM_STATUS_FILTER;
  const hasActiveFilters = Boolean(
    search.trim() ||
      hasNonDefaultStatusFilter ||
      subject ||
      grade ||
      teacher ||
      classroom ||
      viewMode !== "all",
  );
  const viewRows = model.rows;
  const visibleViewRows = model.rows;
  const displayedViewMode = displayRequest.mode === "curriculum" ? displayRequest.viewMode : viewMode;
  const curriculumViewModeCounts = model.summary.viewModeCounts;
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
      search: displayRequest.mode === "curriculum" ? displayRequest.search : search,
      status: displayRequest.mode === "curriculum" ? displayRequest.status || "" : status,
      subject: displayRequest.mode === "curriculum" ? displayRequest.subject || "" : subject,
      grade: displayRequest.mode === "curriculum" ? displayRequest.grade || "" : grade,
      teacher: displayRequest.mode === "curriculum" ? displayRequest.teacher || "" : teacher,
      classroom: displayRequest.mode === "curriculum" ? displayRequest.classroom || "" : classroom,
      viewMode: displayedViewMode,
      page: displayedPage,
    }),
    [classroom, displayRequest, displayedPage, displayedViewMode, grade, search, status, subject, teacher],
  );
  const curriculumReturnPath = useMemo(
    () => buildCurriculumListHref(pathname, searchParamString, curriculumQueryState),
    [curriculumQueryState, pathname, searchParamString],
  );

  useEffect(() => {
    if (loading || !dataMatchesCurrentScope) return;
    let current = true;
    queueMicrotask(() => {
      if (!current || window.location.pathname !== pathname) return;
      const liveQuery = window.location.search.replace(/^\?/, "");
      const nextHref = buildCurriculumListHref(pathname, liveQuery, curriculumQueryState);
      const currentHref = liveQuery ? `${pathname}?${liveQuery}` : pathname;
      if (nextHref === currentHref) return;
      setWrittenQuery(nextHref.split("?")[1] || "");
      router.replace(nextHref, { scroll: false });
    });
    return () => { current = false; };
  }, [curriculumQueryState, dataMatchesCurrentScope, loading, pathname, router, searchParamString]);

  const rememberCurriculumScrollPosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const viewport = desktopListRef.current?.querySelector<HTMLElement>('[data-slot="data-table-viewport"]');
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
      router.push(buildLessonDesignHref(
        text(row.id),
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
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
        return;
      }

      event.preventDefault();
      openCurriculumRow(row, rowDesignAction);
    },
    [openCurriculumRow],
  );

  useEffect(() => {
    if (typeof window === "undefined" || loading || error) return undefined;
    const savedScroll = parseStoredCurriculumScroll(
      window.sessionStorage.getItem(getCurriculumScrollStorageKey(curriculumReturnPath)),
    );
    if (!savedScroll) {
      const viewport = desktopListRef.current?.querySelector<HTMLElement>('[data-slot="data-table-viewport"]');
      if (viewport) viewport.scrollTop = 0;
      return undefined;
    }

    const restoreScroll = () => {
      const viewport = desktopListRef.current?.querySelector<HTMLElement>('[data-slot="data-table-viewport"]');
      if (savedScroll.pageY > 0) {
        window.scrollTo({ top: savedScroll.pageY });
      }
      if (viewport && savedScroll.listY > 0) {
        viewport.scrollTop = savedScroll.listY;
      }
    };

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      restoreScroll();
      secondFrame = window.requestAnimationFrame(restoreScroll);
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [curriculumReturnPath, error, loading, visibleViewRows.length]);

  const resetFilters = () => {
    setSearch("");
    setStatus(DEFAULT_CURRICULUM_STATUS_FILTER);
    setSubject("");
    setGrade("");
    setTeacher("");
    setClassroom("");
    setViewMode("all");
  };

  const filterSelects: ClassFilterPanelSelect[] = [
    {
      id: "status",
      label: "수업 상태",
      value: status,
      options: buildCurriculumFilterOptions(model.statusOptions, status),
      onChange: setStatus,
    },
    {
      id: "subject",
      label: "과목",
      value: subject || "all",
      allowEmpty: true,
      emptyValue: "all",
      emptyLabel: "전체 과목",
      options: buildCurriculumFilterOptions(model.subjectOptions, subject),
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
      options: buildCurriculumFilterOptions(model.gradeOptions, grade),
      onChange: (value) => setGrade(value === "all" ? "" : value),
    },
    {
      id: "teacher",
      label: "선생님",
      value: teacher || "all",
      allowEmpty: true,
      emptyValue: "all",
      emptyLabel: "전체 선생님",
      options: buildCurriculumFilterOptions(model.teacherOptions, teacher),
      onChange: (value) => setTeacher(value === "all" ? "" : value),
    },
    {
      id: "classroom",
      label: "강의실",
      value: classroom || "all",
      allowEmpty: true,
      emptyValue: "all",
      emptyLabel: "전체 강의실",
      options: buildCurriculumFilterOptions(model.classroomOptions, classroom),
      onChange: (value) => setClassroom(value === "all" ? "" : value),
    },
  ];

  if (loading && !renderData) {
    return <CurriculumWorkspaceSkeleton />;
  }

  const renderRowAction = (row: CurriculumRow) => {
    const rowDesignAction = getCurriculumDesignAction(row);
    return (
      <div className="flex items-center justify-between gap-3 md:grid md:justify-normal md:justify-items-end md:gap-2" data-testid="curriculum-row-next-action">
        <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5">
          <Link
            href={buildLessonDesignHref(
              row.id,
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
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3 px-4 lg:px-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>수업계획을 불러오지 못했습니다. 다시 시도해 주세요.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className={DATA_TABLE_LAYOUT_CLASS_NAME} aria-label="반별 수업계획">
        <ClassFilterPanel
          selects={filterSelects}
          className={DATA_TABLE_TOOLBAR_CLASS_NAME}
          searchValue={search}
          searchPlaceholder="수업 검색"
          onSearchChange={setSearch}
          showReset={hasActiveFilters}
          onReset={resetFilters}
        />
        <div
          data-testid="curriculum-work-queue"
          role="group"
          aria-label="계획 상태"
          className="flex flex-wrap gap-1 border-b border-border/70 bg-muted/30 p-2 sm:px-3"
        >
          {curriculumWorkQueueItems.map((item) => (
            <Button
              key={`curriculum-work-queue-${item.value}`}
              type="button"
              size="sm"
              variant={viewMode === item.value ? "secondary" : "ghost"}
              aria-pressed={viewMode === item.value}
              onClick={() => setViewMode(item.value)}
            >
              <span className="whitespace-nowrap">{item.label}</span>
              <span className="tabular-nums text-muted-foreground">{renderData ? item.count : "—"}</span>
            </Button>
          ))}
        </div>
        <p role="status" className="sr-only">
          {loading ? "수업계획 불러오는 중…" : error ? "수업계획 조회 실패" : `수업 ${totalCount ?? 0}개`}
        </p>
        <div aria-busy={loading}>
          {error && !renderData ? null : viewRows.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
              <ClipboardList className="size-6 text-muted-foreground/60" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters ? "조건에 맞는 수업계획이 없습니다." : "수강 중인 수업이 없습니다."}
              </p>
              {hasActiveFilters ? (
                <Button type="button" variant="outline" size="sm" onClick={resetFilters}>모든 수강 수업 보기</Button>
              ) : (
                <Button asChild variant="outline" size="sm"><Link href="/admin/classes">수업 관리</Link></Button>
              )}
            </div>
          ) : (
            <>
              <div data-testid="curriculum-mobile-list" className={DATA_TABLE_MOBILE_LIST_CLASS_NAME}>
                {visibleViewRows.map((row) => {
                  const rowDesignAction = getCurriculumDesignAction(row);
                  return (
                    <article
                      key={`mobile-${row.id}`}
                      data-testid={`curriculum-mobile-card-${row.id}`}
                      role="link"
                      tabIndex={0}
                      aria-label={`${row.title} ${rowDesignAction.label} ${rowDesignAction.reason}`}
                      className="min-w-0 cursor-pointer space-y-4 rounded-lg border border-border/70 bg-background p-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                      onClick={() => openCurriculumRow(row, rowDesignAction)}
                      onKeyDown={(event) => handleCurriculumRowKeyDown(event, row, rowDesignAction)}
                    >
                      <CurriculumClassIdentity row={row} />
                      <dl className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 gap-y-3">
                        <dt className="text-xs leading-5 text-muted-foreground">일정</dt>
                        <dd><CurriculumSchedule row={row} /></dd>
                        <dt className="text-xs leading-5 text-muted-foreground">회차</dt>
                        <dd><CurriculumSessions row={row} /></dd>
                      </dl>
                      <div className="border-t border-border/60 pt-3">{renderRowAction(row)}</div>
                    </article>
                  );
                })}
              </div>

              <div ref={desktopListRef} data-testid="curriculum-desktop-scroll-anchor">
                <DataTableViewport
                  className="hidden max-h-[38rem] md:block [&>[data-slot=table-container]]:overflow-visible"
                  role="region"
                  aria-label="수업계획 목록"
                  tabIndex={0}
                >
                  <Table className="w-full min-w-[760px] table-fixed">
                    <TableHeader>
                      <DataTableHeaderRow>
                        <DataTableHeaderCell className="w-[30%]">수업</DataTableHeaderCell>
                        <DataTableHeaderCell className="w-[35%]">정규 시간표</DataTableHeaderCell>
                        <DataTableHeaderCell className="w-[23%]">편성 회차</DataTableHeaderCell>
                        <DataTableHeaderCell className="w-[12%] text-right"><span className="sr-only">일정 편성</span></DataTableHeaderCell>
                      </DataTableHeaderRow>
                    </TableHeader>
                    <TableBody>
                      {visibleViewRows.map((row) => {
                        const rowDesignAction = getCurriculumDesignAction(row);
                        return (
                          <DataTableBodyRow
                            key={row.id}
                            data-testid={`curriculum-desktop-row-${row.id}`}
                            tabIndex={0}
                            aria-label={`${row.title} ${rowDesignAction.label} ${rowDesignAction.reason}`}
                            className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            onClick={() => openCurriculumRow(row, rowDesignAction)}
                            onKeyDown={(event) => handleCurriculumRowKeyDown(event, row, rowDesignAction)}
                          >
                            <DataTableBodyCell wrap className="py-3 align-top"><CurriculumClassIdentity row={row} /></DataTableBodyCell>
                            <DataTableBodyCell wrap className="py-3 align-top"><CurriculumSchedule row={row} /></DataTableBodyCell>
                            <DataTableBodyCell wrap className="py-3 align-top"><CurriculumSessions row={row} /></DataTableBodyCell>
                            <DataTableBodyCell wrap className="py-3 align-top">{renderRowAction(row)}</DataTableBodyCell>
                          </DataTableBodyRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </DataTableViewport>
              </div>
            </>
          )}
        </div>
        {renderData ? (
          <div className={DATA_TABLE_PAGER_CLASS_NAME}>
            <DataTablePagination page={displayedPage} pageSize={pageSize} totalCount={totalCount} loading={loading}
              onPageChange={handlePageChange} onPageSizeChange={setPageSizePreference} />
          </div>
        ) : null}
      </section>
    </div>
  );
}
