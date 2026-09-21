"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EnrollmentStatusTrigger } from "./enrollment-status-trigger";
import type { ManagementRow } from "./use-management-records";

export type StudentEnrollmentPage = { rows: Record<string, unknown>[]; nextCursor: string | null; hasMore: boolean };
export type LoadStudentEnrollments = (id: string, cursor: string | null) => Promise<StudentEnrollmentPage>;

export function StudentEnrollmentStatusCell({ row, onLoad }: { row: ManagementRow; onLoad?: LoadStudentEnrollments }) {
  const [mode, setMode] = useState<"enrolled" | "waitlisted" | null>(null);
  const [page, setPage] = useState<StudentEnrollmentPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current += 1; }, []);

  const load = async (cursor: string | null) => {
    if (!onLoad || loading) return;
    const revision = ++request.current;
    setLoading(true); setError(false);
    try {
      const result = await onLoad(row.id, cursor);
      if (revision !== request.current) return;
      setPage((previous) => ({ ...result, rows: cursor ? [...(previous?.rows || []), ...result.rows] : result.rows }));
    } catch {
      if (revision === request.current) setError(true);
    } finally {
      if (revision === request.current) setLoading(false);
    }
  };

  return <div className="flex min-w-0 flex-wrap items-center gap-1 py-0.5">
    {(["enrolled", "waitlisted"] as const).map((value) => {
      const label = value === "enrolled" ? "등록" : "대기";
      const count = Number(value === "enrolled" ? row.metrics.classCount : row.metrics.waitlistCount) || 0;
      const embedded = row.raw?.[value === "enrolled" ? "enrolledClasses" : "waitlistClasses"];
      const classes = page ? page.rows.filter((item) => item.status === value || (value === "waitlisted" && item.status === "waitlist"))
        : Array.isArray(embedded) ? embedded as Record<string, unknown>[] : [];
      return <Popover key={value} open={mode === value} onOpenChange={(open) => {
        setMode(open ? value : null);
        if (open && count > 0 && !page && !loading && onLoad) void load(null);
      }}>
        <PopoverTrigger asChild><EnrollmentStatusTrigger label={label} count={count} aria-label={`${row.title} ${label} 수업 ${count}개 보기`} /></PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} className="w-72 rounded-lg p-0 shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="text-sm font-semibold">{label} 수업</div>
            <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px]">{count}개</Badge>
          </div>
          <div className="max-h-72 overflow-y-auto p-2" aria-live="polite">
            {classes.map((item) => <div key={String(item.classId || item.id)} className="rounded-md px-2 py-1.5 text-sm leading-5 hover:bg-muted/70">
              <div className="whitespace-normal break-words font-medium">{String(item.className || item.name || "수업 정보 확인 필요")}</div>
              <div className="whitespace-normal break-words text-xs text-muted-foreground">{[item.subject, item.teacher, item.classroom].filter(Boolean).join(" · ")}</div>
              {item.schedule ? <div className="whitespace-normal break-words text-xs text-muted-foreground">{String(item.schedule)}</div> : null}
            </div>)}
            {count > 0 && loading ? <div className="px-2 py-5 text-center text-sm text-muted-foreground">수업 불러오는 중</div> : null}
            {count > 0 && error ? <div role="alert" className="grid gap-2 p-2 text-sm">
              <span>수업을 불러오지 못했습니다.</span><Button variant="outline" size="sm" onClick={() => void load(page?.nextCursor || null)}>다시 시도</Button>
            </div> : !loading && count > 0 && page?.hasMore ? <Button variant="ghost" size="sm" className="w-full" onClick={() => void load(page.nextCursor)}>수업 더 불러오기</Button>
              : (count === 0 || !loading) && classes.length === 0 ? <div className="px-2 py-5 text-center text-sm text-muted-foreground">{count > 0 ? "수업 정보를 확인할 수 없습니다." : `${label} 수업이 없습니다.`}</div> : null}
          </div>
        </PopoverContent>
      </Popover>;
    })}
  </div>;
}
