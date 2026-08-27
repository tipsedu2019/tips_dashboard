"use client";

import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { ManagementRow } from "./use-management-records";

export type ClassRosterMode = "registered" | "waitlist";

type ClassStudentSummary = {
  id?: string;
  name?: string;
  school?: string;
  grade?: string;
};

type LoadedRosters = Record<ClassRosterMode, ClassStudentSummary[] | null>;
type RosterErrors = Record<ClassRosterMode, string>;

function normalizeScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (["number", "boolean", "string"].includes(typeof value)) return String(value).trim();
  return "";
}

function isUuidLike(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizeScalar(value));
}

function normalizeClassStudentSummaries(value: unknown): ClassStudentSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return {
          id: normalizeScalar(record.id),
          name: normalizeScalar(record.name),
          school: normalizeScalar(record.school),
          grade: normalizeScalar(record.grade),
        };
      }
      return { id: normalizeScalar(item) };
    })
    .filter((student) => student.name || student.id);
}

function formatClassStudentSummary(student: ClassStudentSummary) {
  const rawName = student.name || "";
  const rawId = student.id || "";
  const name = rawName && !isUuidLike(rawName)
    ? rawName
    : rawId && !isUuidLike(rawId)
      ? rawId
      : "학생 정보 확인 필요";
  const school = student.school || "";
  const grade = school && student.grade?.startsWith(school.slice(-1))
    ? student.grade.slice(1)
    : student.grade || "";
  const schoolGrade = [school, grade].filter(Boolean).join("");
  return schoolGrade ? `${name}(${schoolGrade})` : name;
}

function sortClassStudentSummariesAscending(students: ClassStudentSummary[]) {
  return [...students].sort((left, right) => (
    formatClassStudentSummary(left).localeCompare(formatClassStudentSummary(right), "ko")
  ));
}

function getEmbeddedRoster(row: ManagementRow, mode: ClassRosterMode) {
  const raw = row.raw || {};
  return normalizeClassStudentSummaries(mode === "registered"
    ? raw.registeredStudents || raw.registered_students
    : raw.waitlistStudents || raw.waitlist_students);
}

function getRosterCount(row: ManagementRow, mode: ClassRosterMode) {
  const raw = row.raw || {};
  const value = mode === "registered"
    ? raw.registeredCount || raw.registered_count || row.metrics.studentCount
    : raw.waitlistCount || raw.waitlist_count || row.metrics.waitlistCount;
  const count = Number(value || 0);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function ClassEnrollmentStatusCell({
  row,
  onLoadRoster,
}: {
  row: ManagementRow;
  onLoadRoster?: (classId: string, mode: ClassRosterMode) => Promise<unknown[]>;
}) {
  const [openMode, setOpenMode] = useState<ClassRosterMode | null>(null);
  const [loadedRosters, setLoadedRosters] = useState<LoadedRosters>({ registered: null, waitlist: null });
  const [loadingMode, setLoadingMode] = useState<ClassRosterMode | null>(null);
  const [errors, setErrors] = useState<RosterErrors>({ registered: "", waitlist: "" });
  const activeRowIdRef = useRef(row.id);

  const embeddedRosters: Record<ClassRosterMode, ClassStudentSummary[]> = {
    registered: getEmbeddedRoster(row, "registered"),
    waitlist: getEmbeddedRoster(row, "waitlist"),
  };

  const handleOpenChange = (mode: ClassRosterMode, open: boolean) => {
    setOpenMode(open ? mode : null);
    if (!open || loadedRosters[mode] !== null || embeddedRosters[mode].length > 0 || loadingMode === mode || !onLoadRoster) {
      return;
    }

    const requestedRowId = row.id;
    setLoadingMode(mode);
    setErrors((current) => ({ ...current, [mode]: "" }));
    void onLoadRoster(requestedRowId, mode)
      .then((students) => {
        if (activeRowIdRef.current !== requestedRowId) return;
        setLoadedRosters((current) => ({
          ...current,
          [mode]: normalizeClassStudentSummaries(students),
        }));
      })
      .catch(() => {
        if (activeRowIdRef.current !== requestedRowId) return;
        setErrors((current) => ({ ...current, [mode]: "명단을 불러오지 못했습니다. 다시 열어 주세요." }));
      })
      .finally(() => {
        if (activeRowIdRef.current === requestedRowId) setLoadingMode(null);
      });
  };

  const renderRosterPopover = (mode: ClassRosterMode) => {
    const label = mode === "registered" ? "등록" : "대기";
    const students = sortClassStudentSummariesAscending(loadedRosters[mode] ?? embeddedRosters[mode]);
    const count = Math.max(getRosterCount(row, mode), students.length);
    const toneClassName = mode === "registered"
      ? "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-950/50"
      : "bg-orange-50 text-orange-700 hover:bg-orange-100 dark:bg-orange-950/30 dark:text-orange-300 dark:hover:bg-orange-950/50";

    return (
      <Popover open={openMode === mode} onOpenChange={(open) => handleOpenChange(mode, open)}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("relative z-20 h-6 rounded-full px-2.5 text-xs font-medium", toneClassName)}
            aria-label={`${label} 학생 ${count}명 보기`}
            onClick={(event) => event.stopPropagation()}
          >
            {label} {count}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} className="w-64 rounded-lg p-0 shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="text-sm font-semibold">{label} 학생</div>
            <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px]">{count}명</Badge>
          </div>
          <div className="max-h-64 overflow-y-auto p-2" aria-live="polite">
            {loadingMode === mode ? (
              <div className="px-2 py-5 text-center text-sm text-muted-foreground">명단 불러오는 중</div>
            ) : errors[mode] ? (
              <div className="px-2 py-5 text-center text-sm text-destructive">{errors[mode]}</div>
            ) : students.length > 0 ? (
              <div className="grid gap-1">
                {students.map((student, index) => (
                  <div
                    key={`${label}-${student.id || student.name || index}`}
                    className="rounded-md px-2 py-1.5 text-sm leading-5 hover:bg-muted/70"
                  >
                    {formatClassStudentSummary(student)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-2 py-5 text-center text-sm text-muted-foreground">표시할 학생이 없습니다.</div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <div className="flex min-w-[12rem] flex-wrap items-center gap-2 py-0.5">
      {renderRosterPopover("registered")}
      {renderRosterPopover("waitlist")}
    </div>
  );
}

export { ClassEnrollmentStatusCell };
