"use client";

import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EnrollmentStatusTrigger } from "./enrollment-status-trigger";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import type { ManagementRow } from "./use-management-records";

export type ClassRosterMode = "registered" | "waitlist";
export type ClassRosterPage = { rows: Record<string, unknown>[]; nextCursor: string | null; hasMore: boolean };
export type LoadClassRoster = (classId: string, mode: ClassRosterMode, cursor: string | null) => Promise<ClassRosterPage | null>;

type ClassStudentSummary = {
  id?: string;
  name?: string;
  school?: string;
  grade?: string;
};

type AcceptedRosterPage = { rows: ClassStudentSummary[]; nextCursor: string | null; hasMore: boolean };
type LoadedRosters = Record<ClassRosterMode, AcceptedRosterPage | null>;
type RosterFlags = Record<ClassRosterMode, boolean>;

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
    ? raw.registeredCount ?? raw.registered_count ?? row.metrics.studentCount
    : raw.waitlistCount ?? raw.waitlist_count ?? row.metrics.waitlistCount;
  if (mode === "waitlist") {
    const count = typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;
    return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
  }
  const count = Number(value || 0);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function acceptRosterPage(value: unknown, requestedCursor: string | null): AcceptedRosterPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("class_roster_page_unavailable");
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.rows) || page.rows.length > 30
    || page.rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))
    || typeof page.hasMore !== "boolean"
    || !(page.nextCursor === null || (typeof page.nextCursor === "string" && page.nextCursor.trim()))) {
    throw new Error("class_roster_page_invalid");
  }
  const nextCursor = page.nextCursor as string | null;
  if (page.hasMore && (!nextCursor || nextCursor === requestedCursor || page.rows.length === 0)) {
    throw new Error("class_roster_cursor_invalid");
  }
  const rows = normalizeClassStudentSummaries(page.rows);
  if (rows.length !== page.rows.length) throw new Error("class_roster_rows_invalid");
  return { rows, nextCursor, hasMore: page.hasMore };
}

function ClassEnrollmentStatusPopover({
  row,
  onLoadRoster,
}: {
  row: ManagementRow;
  onLoadRoster?: LoadClassRoster;
}) {
  const [openMode, setOpenMode] = useState<ClassRosterMode | null>(null);
  const [loadedRosters, setLoadedRosters] = useState<LoadedRosters>({ registered: null, waitlist: null });
  const [loading, setLoading] = useState<RosterFlags>({ registered: false, waitlist: false });
  const [errors, setErrors] = useState<RosterFlags>({ registered: false, waitlist: false });
  const requests = useRef({ registered: 0, waitlist: 0 });
  const pending = useRef<RosterFlags>({ registered: false, waitlist: false });
  const lists = useRef<Record<ClassRosterMode, HTMLDivElement | null>>({ registered: null, waitlist: null });
  useEffect(() => () => {
    requests.current.registered += 1;
    requests.current.waitlist += 1;
  }, []);

  const embeddedRosters: Record<ClassRosterMode, ClassStudentSummary[]> = {
    registered: getEmbeddedRoster(row, "registered"),
    waitlist: getEmbeddedRoster(row, "waitlist"),
  };

  const load = async (mode: ClassRosterMode, cursor: string | null) => {
    const count = getRosterCount(row, mode);
    if (!onLoadRoster || pending.current[mode] || count === undefined || count === 0) return;
    const revision = ++requests.current[mode];
    pending.current[mode] = true;
    setLoading((current) => ({ ...current, [mode]: true }));
    setErrors((current) => ({ ...current, [mode]: false }));
    try {
      const result = await onLoadRoster(row.id, mode, cursor);
      if (revision !== requests.current[mode]) return;
      const page = acceptRosterPage(result, cursor);
      setLoadedRosters((current) => ({
        ...current,
        [mode]: {
          ...page,
          rows: cursor ? [...new Map([...(current[mode]?.rows || []), ...page.rows].map((student) => [
            student.id || JSON.stringify([student.name, student.school, student.grade]), student,
          ])).values()] : page.rows,
        },
      }));
    } catch {
      if (revision === requests.current[mode]) setErrors((current) => ({ ...current, [mode]: true }));
    } finally {
      if (revision === requests.current[mode]) {
        pending.current[mode] = false;
        setLoading((current) => ({ ...current, [mode]: false }));
      }
    }
  };

  const handleOpenChange = (mode: ClassRosterMode, open: boolean) => {
    setOpenMode((current) => open ? mode : current === mode ? null : current);
    const count = getRosterCount(row, mode);
    if (open && count !== undefined && count > 0 && !loadedRosters[mode] && embeddedRosters[mode].length < count && !errors[mode]) {
      void load(mode, null);
    }
  };

  const requestPage = (mode: ClassRosterMode) => {
    lists.current[mode]?.focus({ preventScroll: true });
    void load(mode, loadedRosters[mode]?.nextCursor || null);
  };

  const renderRosterPopover = (mode: ClassRosterMode) => {
    const label = mode === "registered" ? "등록" : "대기";
    const page = loadedRosters[mode];
    const count = getRosterCount(row, mode);
    if (count === undefined) {
      return <span className="px-2 text-xs text-muted-foreground">대기 인원 확인 불가</span>;
    }
    const students = count > 0 ? sortClassStudentSummariesAscending(page?.rows ?? embeddedRosters[mode]) : [];

    return (
      <Popover open={openMode === mode} onOpenChange={(open) => handleOpenChange(mode, open)}>
        <PopoverTrigger asChild>
          <EnrollmentStatusTrigger label={label} count={count} aria-label={`${label} 학생 ${count}명 보기`} />
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} className="flex max-h-[var(--radix-popover-content-available-height)] w-64 max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0">
          <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
            <div className="text-sm font-semibold">{label} 학생</div>
            <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px]">{count}명</Badge>
          </div>
          <div ref={(node) => { lists.current[mode] = node; }} tabIndex={-1} role="region" aria-label={`${label} 학생 명단`} className="min-h-0 max-h-64 overflow-y-auto overscroll-contain p-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-live="polite">
            {students.length > 0 ? (
              <div className="grid gap-1">
                {students.map((student, index) => (
                  <div
                    key={`${label}-${student.id || student.name || index}`}
                    className="break-words rounded-md px-2 py-1.5 text-sm leading-5 [overflow-wrap:anywhere] hover:bg-muted/70"
                  >
                    {formatClassStudentSummary(student)}
                  </div>
                ))}
              </div>
            ) : loading[mode] ? (
              <div role="status" className="px-2 py-5 text-center text-sm text-muted-foreground">명단 불러오는 중</div>
            ) : !errors[mode] ? (
              <div className="px-2 py-5 text-center text-sm text-muted-foreground">{count > 0 ? "학생 정보를 확인할 수 없습니다." : `${label} 학생이 없습니다.`}</div>
            ) : null}
          </div>
          {students.length > 0 || errors[mode] || page?.hasMore ? <div className="grid shrink-0 gap-2 border-t p-2">
            {students.length > 0 ? <div role="status" aria-live="polite" className="text-center text-xs tabular-nums text-muted-foreground">
              {students.length <= count ? `${students.length} / ${count}명` : `${students.length}명 표시`}
            </div> : null}
            {errors[mode] ? <div role="alert" className="grid justify-items-center gap-2 text-sm">
              <span>명단을 불러오지 못했습니다.</span>
              <Button type="button" variant="outline" size="sm" onClick={() => requestPage(mode)}>다시 시도</Button>
            </div> : page?.hasMore ? <Button type="button" variant="ghost" size="sm" disabled={loading[mode]} onClick={() => requestPage(mode)}>
              {loading[mode] ? "명단 불러오는 중" : "명단 더 불러오기"}
            </Button> : null}
          </div> : null}
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 py-0.5">
      {renderRosterPopover("registered")}
      {renderRosterPopover("waitlist")}
    </div>
  );
}

function ClassEnrollmentStatusCell({ row, onLoadRoster }: { row: ManagementRow; onLoadRoster?: LoadClassRoster }) {
  const scope = JSON.stringify([row.id, getRosterCount(row, "registered"), getRosterCount(row, "waitlist")]);
  return <ClassEnrollmentStatusPopover key={scope} row={row} onLoadRoster={onLoadRoster} />;
}

export { ClassEnrollmentStatusCell };
