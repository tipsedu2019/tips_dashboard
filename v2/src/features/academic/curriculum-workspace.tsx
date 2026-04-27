"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

function getStateVariant(stateLabel: string) {
  if (stateLabel.includes("완료")) {
    return "default" as const;
  }
  if (stateLabel.includes("업데이트")) {
    return "destructive" as const;
  }
  if (stateLabel.includes("미설정")) {
    return "outline" as const;
  }
  return "secondary" as const;
}

function formatUpdatedDate(value: string) {
  if (!value) {
    return "기록 전";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function text(value: unknown) {
  return String(value || "").trim();
}

function buildLessonDesignHref(classId: string) {
  const normalizedClassId = text(classId);
  if (!normalizedClassId) {
    return "/admin/curriculum";
  }

  const params = new URLSearchParams();
  params.set("classId", normalizedClassId);
  params.set("lessonDesign", "1");
  return `/admin/curriculum/lesson-design?${params.toString()}`;
}

function formatTextbookCount(count: number) {
  return count > 0 ? `${count}권 연결` : "교재 미연결";
}

function formatProgressPrimary(completedSessions: number, totalSessions: number) {
  if (totalSessions <= 0) {
    return "회차 설계 전";
  }

  return `${completedSessions}/${totalSessions}회 완료`;
}

function formatProgressPercent(progressPercent: number, totalSessions: number) {
  if (totalSessions <= 0) {
    return "-";
  }

  return `${progressPercent}%`;
}

function formatProgressMeta(updatedSessions: number, delayedSessions: number, totalSessions: number) {
  if (totalSessions <= 0) {
    return "수업 설계에서 회차 생성";
  }

  return `업데이트 ${updatedSessions}회 · 대기 ${delayedSessions}회`;
}

function CurriculumWorkspaceSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`filter-${index}`} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>

      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={`row-${index}`} className="h-16 w-full" />
            ))}
          </CardContent>
        </Card>
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
  const deferredSearch = useDeferredValue(search);

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
          classGroupId: period,
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
      period,
      status,
      subject,
      teacher,
    ],
  );
  const defaultPeriod = useMemo(() => pickDefaultPeriodValue(model.classGroupOptions), [model.classGroupOptions]);
  const normalizedPeriod = period || defaultPeriod;
  const hasNonDefaultPeriodFilter = Boolean(normalizedPeriod && normalizedPeriod !== defaultPeriod);
  const hasNonDefaultStatusFilter = status !== DEFAULT_CURRICULUM_STATUS_FILTER;
  const hasActiveFilters = Boolean(
    search.trim() ||
      hasNonDefaultPeriodFilter ||
      hasNonDefaultStatusFilter ||
      subject ||
      grade ||
      teacher ||
      classroom,
  );

  useEffect(() => {
    if (model.classGroupOptions.length === 0) {
      if (period) {
        setPeriod("");
      }
      return;
    }

    if (!model.classGroupOptions.some((option) => option.value === period)) {
      setPeriod(defaultPeriod);
    }
  }, [defaultPeriod, model.classGroupOptions, period]);

  const resetFilters = () => {
    setSearch("");
    setPeriod(defaultPeriod);
    setStatus(DEFAULT_CURRICULUM_STATUS_FILTER);
    setSubject("");
    setGrade("");
    setTeacher("");
    setClassroom("");
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
    search.trim() ? { id: "search", label: <>검색어 {search.trim()}</> } : null,
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
          summaryLabel={`수업 ${model.summary.classCount}개, 계획 ${model.summary.managedClassCount}개, 교재 ${model.summary.linkedTextbooks}권`}
          chips={filterChips}
          showReset={hasActiveFilters}
          onReset={resetFilters}
        />
      </div>

      <div className="px-4 lg:px-6">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>반별 계획</CardTitle>
            </CardHeader>
            <CardContent>
              {model.rows.length === 0 ? (
                <div className="text-muted-foreground flex min-h-60 items-center justify-center rounded-xl border border-dashed text-sm">
                  현재 조건에 맞는 계획 데이터가 없습니다.
                </div>
              ) : (
                <ScrollArea className="h-[34rem] pr-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>수업</TableHead>
                        <TableHead>교재</TableHead>
                        <TableHead>진도</TableHead>
                        <TableHead>업데이트</TableHead>
                        <TableHead>상태/작업</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {model.rows.map((row) => (
                        <TableRow
                          key={row.id}
                          className="transition-colors hover:bg-muted/30"
                        >
                          <TableCell className="align-top">
                            <div className="min-w-[15rem] space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge>{row.subject || "과목 미정"}</Badge>
                                {row.grade ? (
                                  <Badge variant="secondary">{row.grade}</Badge>
                                ) : null}
                              </div>
                              <div>
                                <Link
                                  href={buildLessonDesignHref(row.id)}
                                  className="font-medium underline-offset-4 hover:underline"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {row.title}
                                </Link>
                                <p className="text-muted-foreground text-sm">
                                  {row.term || "학기 미정"} · {row.teacherSummary || "선생님 미정"}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="space-y-1">
                              <p className={row.textbookCount > 0 ? "font-medium" : "font-medium text-muted-foreground"}>
                                {formatTextbookCount(row.textbookCount)}
                              </p>
                              <p className="text-muted-foreground text-sm">
                                {row.schedule || "시간표 미정"}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="min-w-[12rem] space-y-2">
                              <div className="flex items-center justify-between text-sm">
                                <span>{formatProgressPrimary(row.completedSessions, row.totalSessions)}</span>
                                <span className="text-muted-foreground">
                                  {formatProgressPercent(row.progressPercent, row.totalSessions)}
                                </span>
                              </div>
                              {row.totalSessions > 0 ? (
                                <Progress value={row.progressPercent} />
                              ) : (
                                <div className="h-2 rounded-full bg-muted" />
                              )}
                              <p className="text-muted-foreground text-xs">
                                {formatProgressMeta(row.updatedSessions, row.delayedSessions, row.totalSessions)}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="align-top text-sm">
                            {formatUpdatedDate(row.lastUpdatedAt)}
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="flex min-w-[7rem] flex-col items-start gap-2">
                              <Badge variant={getStateVariant(row.stateLabel)}>
                                {row.stateLabel}
                              </Badge>
                              <Button asChild variant="outline" size="sm" className="h-7 rounded-sm px-2 text-xs">
                                <Link
                                  href={buildLessonDesignHref(row.id)}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  수업 설계
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
