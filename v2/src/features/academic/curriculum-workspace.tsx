"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { AcademicFilterToolbar } from "./filter-toolbar";
import { buildCurriculumWorkspaceModel } from "./records.js";
import { useAcademicWorkspaceData } from "./use-academic-workspace-data";

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
    return "업데이트 없음";
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
    return "/admin/class-schedule";
  }

  const params = new URLSearchParams();
  params.set("classId", normalizedClassId);
  params.set("lessonDesign", "1");
  return `/admin/class-schedule?${params.toString()}`;
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
  const [term, setTerm] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [teacher, setTeacher] = useState("");
  const [state, setState] = useState("");
  const deferredSearch = useDeferredValue(search);

  const model = useMemo(
    () =>
      buildCurriculumWorkspaceModel({
        classes: data.classes,
        classTerms: data.classTerms,
        textbooks: data.textbooks,
        progressLogs: data.progressLogs,
        filters: {
          search: deferredSearch,
          term,
          subject,
          grade,
          teacher,
          state,
        },
      }),
    [
      data.classTerms,
      data.classes,
      data.progressLogs,
      data.textbooks,
      deferredSearch,
      grade,
      state,
      subject,
      teacher,
      term,
    ],
  );

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
        <AcademicFilterToolbar
          searchValue={search}
          searchPlaceholder="수업명, 선생님, 학기로 검색"
          onSearchChange={setSearch}
          filters={[
            {
              label: "학기",
              value: term,
              options: model.termOptions,
              placeholder: "전체 학기",
              onChange: setTerm,
            },
            {
              label: "과목",
              value: subject,
              options: model.subjectOptions,
              placeholder: "전체 과목",
              onChange: setSubject,
            },
            {
              label: "학년",
              value: grade,
              options: model.gradeOptions,
              placeholder: "전체 학년",
              onChange: setGrade,
            },
            {
              label: "선생님",
              value: teacher,
              options: model.teacherOptions,
              placeholder: "전체 선생님",
              onChange: setTeacher,
            },
            {
              label: "상태",
              value: state,
              options: model.stateOptions,
              placeholder: "전체 상태",
              onChange: setState,
            },
          ]}
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
                        <TableHead>상태</TableHead>
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
                              <p className="font-medium">{row.textbookCount}권 연결</p>
                              <p className="text-muted-foreground text-sm">
                                {row.schedule || "시간표 미정"}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="min-w-[12rem] space-y-2">
                              <div className="flex items-center justify-between text-sm">
                                <span>{row.completedSessions}/{row.totalSessions}회 완료</span>
                                <span className="text-muted-foreground">{row.progressPercent}%</span>
                              </div>
                              <Progress value={row.progressPercent} />
                              <p className="text-muted-foreground text-xs">
                                업데이트 {row.updatedSessions}회 · 대기 {row.delayedSessions}회
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="align-top text-sm">
                            {formatUpdatedDate(row.lastUpdatedAt)}
                          </TableCell>
                          <TableCell className="align-top">
                            <Badge variant={getStateVariant(row.stateLabel)}>
                              {row.stateLabel}
                            </Badge>
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
