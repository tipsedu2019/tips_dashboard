"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/providers/auth-provider";
import { supabase } from "@/lib/supabase";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/app/admin/calendar/components/calendar";

import {
  buildAcademicEventMutationPayload,
  DEFAULT_ACADEMIC_EVENT_TYPES,
  getAcademicEventFilterTypeKey,
  getAcademicEventTypeLabel,
  getAcademicEventMutationErrorMessage,
  getPersistedAcademicEventId,
  normalizeAcademicEventType,
  parseActiveScienceSubjectAreas,
  prepareAcademicEventMetadataForWrite,
  runAcademicEventMutation,
} from "./academic-event-utils.js";
import { useOperationsWorkspaceData } from "./use-operations-workspace-data";
import { buildSevenDayRangeKeys } from "./operations-read-service.js";

function text(value: unknown) {
  return String(value || "").trim();
}

function toDateKey(value: Date | null | undefined) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "";
  }

  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function parseSearchDate(value: string | null) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildSidebarGroups(events: Array<Record<string, unknown>>) {
  const typeCounts = new Map<string, { label: string; count: number }>();
  const categoryCounts = new Map<string, { label: string; count: number }>();

  events.forEach((event) => {
    const typeKey = normalizeAcademicEventType(text(event.typeLabel) || "기타");
    const typeLabel = getAcademicEventTypeLabel(typeKey);
    const existingType = typeCounts.get(typeKey) || { label: typeLabel, count: 0 };
    existingType.count += 1;
    typeCounts.set(typeKey, existingType);

    const categoryKey = text(event.category) || "all";
    const categoryLabel =
      categoryKey === "high"
        ? "고등"
        : categoryKey === "middle"
          ? "중등"
          : categoryKey === "elementary"
            ? "초등"
            : "기타";
    const existingCategory = categoryCounts.get(categoryKey) || { label: categoryLabel, count: 0 };
    existingCategory.count += 1;
    categoryCounts.set(categoryKey, existingCategory);
  });

  const typePalette = ["bg-rose-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-violet-500"];
  const categoryPalette = ["bg-violet-500", "bg-amber-500", "bg-slate-500", "bg-emerald-500"];

  return [
    {
      name: "일정 유형",
      items: [...typeCounts.entries()].map(([typeKey, entry], index) => ({
        id: getAcademicEventFilterTypeKey(typeKey),
        name: `${entry.label} · ${entry.count}`,
        color: typePalette[index % typePalette.length],
        visible: true,
        type: "work" as const,
      })),
    },
    {
      name: "학교 분류",
      items: [...categoryCounts.entries()].map(([categoryKey, entry], index) => ({
        id: `category:${categoryKey}`,
        name: `${entry.label} · ${entry.count}`,
        color: categoryPalette[index % categoryPalette.length],
        visible: true,
        type: "shared" as const,
      })),
    },
  ].filter((group) => group.items.length > 0);
}

export function AcademicCalendarWorkspace() {
  const searchParams = useSearchParams();
  const { canManageAll } = useAuth();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [activeScienceAreas, setActiveScienceAreas] = useState<ReturnType<typeof parseActiveScienceSubjectAreas>>([]);
  const initialDate = useMemo(() => parseSearchDate(searchParams.get("date")), [searchParams]);
  const initialEventId = useMemo(() => text(searchParams.get("eventId")), [searchParams]);
  const initialQuery = useMemo(() => text(searchParams.get("q")), [searchParams]);
  const [visibleRange, setVisibleRange] = useState(() => {
    const anchor = initialDate || new Date();
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 12);
    first.setDate(first.getDate() - first.getDay());
    last.setDate(last.getDate() + (6 - last.getDay()));
    return { dateFrom: toDateKey(first), dateTo: toDateKey(last) };
  });
  const [recoveryRange, setRecoveryRange] = useState<{ dateFrom: string; dateTo: string } | null>(null);
  const requestRange = recoveryRange || visibleRange;
  const request = useMemo(() => ({ mode: "calendar" as const, ...requestRange }), [requestRange]);
  const { data, densityError, error, refresh, loadEventDetail } = useOperationsWorkspaceData(request);
  const isSeedCalendar = false;
  const lastMonthRowsRef = useRef<Array<Record<string, unknown>>>([]);
  const responseRange = (data?.range || {}) as { dateFrom?: string; dateTo?: string };
  const isConfirmedSevenDayRange = Boolean(
    recoveryRange &&
      data?.ok === true &&
      responseRange.dateFrom === recoveryRange.dateFrom &&
      responseRange.dateTo === recoveryRange.dateTo,
  );
  const isConfirmedMonthRange = Boolean(
    data?.ok === true &&
      responseRange.dateFrom === visibleRange.dateFrom &&
      responseRange.dateTo === visibleRange.dateTo,
  );
  useEffect(() => {
    if (!isConfirmedMonthRange || data?.ok !== true || !Array.isArray(data.rows)) return;
    lastMonthRowsRef.current = data.rows as Array<Record<string, unknown>>;
  }, [data, isConfirmedMonthRange]);
  const calendarRows = useMemo(
    () => {
      if (isConfirmedSevenDayRange && data?.ok === true && Array.isArray(data.rows)) {
        return data.rows as Array<Record<string, unknown>>;
      }
      if (isConfirmedMonthRange && data?.ok === true && Array.isArray(data.rows)) {
        return data.rows as Array<Record<string, unknown>>;
      }
      if (lastMonthRowsRef.current.length > 0) return lastMonthRowsRef.current;
      return [];
    },
    [data, isConfirmedMonthRange, isConfirmedSevenDayRange],
  );

  useEffect(() => {
    let cancelled = false;
    if (!supabase) return;

    const client = supabase;
    void Promise.resolve().then(async () => {
      const { data: areaRows, error: areaError } = await client.rpc("list_active_science_subject_areas_v1")
        .limit(200)
        .abortSignal(AbortSignal.timeout(8_000))
        .retry(false);
      if (cancelled) return;
      setActiveScienceAreas(areaError ? [] : parseActiveScienceSubjectAreas(areaRows));
    });

    return () => {
      cancelled = true;
    };
  }, []);
  const schoolOptions = useMemo(
    () =>
      [...new Map(calendarRows.map((row) => [text(row.schoolId), row])).values()]
        .map((row) => ({
          id: text(row.schoolId),
          name: text(row.schoolName),
          category: text(row.category) || "all",
        }))
        .filter((school) => school.id && school.name)
        .sort((left, right) => left.name.localeCompare(right.name, "ko")),
    [calendarRows],
  );

  const calendarModel = useMemo(
    () => {
      const scienceContext = { scienceSubjectAreas: activeScienceAreas };
      const events = calendarRows.map((row) => ({
        id: text(row.id),
        sourceId: text(row.sourceId || row.id),
        title: text(row.title),
        date: new Date(`${text(row.startsAt).slice(0, 10)}T12:00:00`),
        endDate: new Date(`${text(row.endsAt || row.startsAt).slice(0, 10)}T12:00:00`),
        time: text(row.timeLabel),
        duration: text(row.durationLabel),
        type: row.eventType as "meeting" | "event" | "personal" | "task" | "reminder",
        typeLabel: text(row.typeLabel),
        attendees: Array.isArray(row.attendees) ? row.attendees.map(text).filter(Boolean) : [],
        location: text(row.place),
        color: text(row.color),
        description: text(row.description),
        note: text(row.notePreview),
        schoolId: text(row.schoolId),
        schoolName: text(row.schoolName),
        category: text(row.category),
        grade: text(row.grade),
        examTerm: text(row.examTerm),
        scienceAreaKey: text(row.scienceAreaKey),
        scienceAreaLabel: text(row.scienceAreaLabel)
          || text(scienceContext.scienceSubjectAreas.find((area) => area.areaKey === text(row.scienceAreaKey))?.label),
        scopeSummary: text(row.scopeSummary),
      }));
      const counts = new Map<string, number>();
      for (const event of events) {
        const cursor = new Date(event.date);
        while (cursor <= event.endDate) {
          const key = toDateKey(cursor);
          counts.set(key, (counts.get(key) || 0) + 1);
          cursor.setDate(cursor.getDate() + 1);
        }
      }
      return { events, eventDates: [...counts].map(([key, count]) => ({ date: new Date(`${key}T12:00:00`), count })) };
    },
    [activeScienceAreas, calendarRows],
  );

  const handleVisibleRangeChange = useCallback((range: { start: Date; end: Date }) => {
    const next = { dateFrom: toDateKey(range.start), dateTo: toDateKey(range.end) };
    setRecoveryRange(null);
    setVisibleRange((current) => current.dateFrom === next.dateFrom && current.dateTo === next.dateTo ? current : next);
  }, []);

  const handleOneWeekView = useCallback(() => {
    if (densityError?.code !== "visible_range_too_dense") return;
    const dateKeys = buildSevenDayRangeKeys(densityError.range.dateFrom);
    setRecoveryRange({ dateFrom: dateKeys[0], dateTo: dateKeys[dateKeys.length - 1] });
  }, [densityError]);

  const sevenDayKeys = useMemo(
    () => recoveryRange ? buildSevenDayRangeKeys(recoveryRange.dateFrom) : [],
    [recoveryRange],
  );

  const handleLoadEventDetail = useCallback(async (eventId: string) => {
    const detail = await loadEventDetail(eventId) as Record<string, unknown>;
    return {
      id: text(detail.id), sourceId: text(detail.sourceId || detail.id), title: text(detail.title),
      date: new Date(`${text(detail.startsAt).slice(0, 10)}T12:00:00`),
      endDate: new Date(`${text(detail.endsAt || detail.startsAt).slice(0, 10)}T12:00:00`),
      time: text(detail.timeLabel), duration: text(detail.durationLabel),
      type: detail.eventType as "meeting" | "event" | "personal" | "task" | "reminder",
      typeLabel: text(detail.typeLabel), attendees: Array.isArray(detail.attendees) ? detail.attendees.map(text) : [],
      location: text(detail.place), color: text(detail.color), description: text(detail.description),
      note: text(detail.note), schoolId: text(detail.schoolId), schoolName: text(detail.schoolName),
      category: text(detail.category), grade: text(detail.grade), examTerm: text(detail.examTerm),
      scienceAreaKey: text(detail.scienceAreaKey), scienceAreaLabel: text(detail.scienceAreaLabel),
      embeddedNoteMeta: (detail.embeddedNoteMeta || {}) as Record<string, unknown>,
      textbookScopes: Array.isArray(detail.textbookScopes) ? detail.textbookScopes : [],
      subtextbookScopes: Array.isArray(detail.subtextbookScopes) ? detail.subtextbookScopes : [],
    };
  }, [loadEventDetail]);

  const sidebarGroups = useMemo(
    () => buildSidebarGroups(calendarModel.events),
    [calendarModel.events],
  );

  const typeOptions = useMemo(
    () => DEFAULT_ACADEMIC_EVENT_TYPES,
    [],
  );

  const handleSaveEvent = async (eventData: Record<string, unknown>) => {
    if (!canManageAll) {
      const message = "읽기 전용 상태에서는 학사 일정을 수정할 수 없습니다.";
      setMutationError(message);
      toast.error(message);
      return false;
    }

    if (isSeedCalendar) {
      toast.info("기본 학사일정 세트는 읽기 전용입니다.");
      return false;
    }

    if (!supabase) {
      const message = "Supabase 연결이 없어 학사 일정을 저장할 수 없습니다.";
      setMutationError(message);
      toast.error(message);
      return false;
    }

    const supabaseClient = supabase;
    const existingId = getPersistedAcademicEventId(eventData.id);
    const metadataResult = prepareAcademicEventMetadataForWrite(eventData, activeScienceAreas);
    if (!metadataResult.isValid) {
      const message = Object.values(metadataResult.errors)[0] || "과학 시험일 입력값을 확인해 주세요.";
      setMutationError(message);
      toast.error(message);
      return false;
    }
    const result = buildAcademicEventMutationPayload(
      {
        id: existingId,
        title: eventData.title,
        schoolId: eventData.schoolId,
        type: eventData.typeLabel,
        start: toDateKey(eventData.date as Date),
        end: toDateKey((eventData.endDate as Date) || (eventData.date as Date)),
        grade: eventData.grade,
        note: metadataResult.note,
        examTerm: eventData.examTerm,
        scienceAreaKey: metadataResult.scienceAreaKey,
        textbookScope: eventData.textbookScope,
        subtextbookScope: eventData.subtextbookScope,
        textbookScopes: eventData.textbookScopes,
        subtextbookScopes: eventData.subtextbookScopes,
      },
      schoolOptions,
    );

    if (!result.isValid || !result.payload) {
      const message = Object.values(result.errors)[0] || "입력값을 확인해 주세요.";
      setMutationError(message);
      toast.error(message);
      return false;
    }

    try {
      if (existingId) {
        const updateResult = await runAcademicEventMutation(
          result.payload as Record<string, unknown>,
          (payload: Record<string, unknown>) => {
            const updatePayload = { ...payload } as Record<string, unknown>;
            delete updatePayload.id;
            return supabaseClient
              .from("academic_events")
              .update(updatePayload)
              .eq("id", existingId);
          },
        );

        if (updateResult.error) {
          throw updateResult.error;
        }

        toast.success("학사 일정이 업데이트되었습니다.");
      } else {
        const insertResult = await runAcademicEventMutation(
          result.payload as Record<string, unknown>,
          (payload: Record<string, unknown>) => supabaseClient.from("academic_events").insert([payload]),
        );

        if (insertResult.error) {
          throw insertResult.error;
        }

        toast.success("새 학사 일정을 추가했습니다.");
      }

      setMutationError(null);
      await refresh();
      return true;
    } catch (error) {
      const message = getAcademicEventMutationErrorMessage(error, "학사 일정 저장 중 오류가 발생했습니다.");
      setMutationError(message);
      toast.error(message);
      return false;
    }
  };

  const handleDeleteEvent = async (eventId: string | number) => {
    if (!canManageAll) {
      const message = "읽기 전용 상태에서는 학사 일정을 삭제할 수 없습니다.";
      setMutationError(message);
      toast.error(message);
      return false;
    }

    if (isSeedCalendar) {
      toast.info("기본 학사일정 세트는 읽기 전용입니다.");
      return false;
    }

    if (!supabase) {
      const message = "Supabase 연결이 없어 학사 일정을 삭제할 수 없습니다.";
      setMutationError(message);
      toast.error(message);
      return false;
    }

    try {
      const persistedId = getPersistedAcademicEventId(eventId);
      if (!persistedId) {
        return false;
      }

      const { error: deleteError } = await supabase
        .from("academic_events")
        .delete()
        .eq("id", persistedId);

      if (deleteError) {
        throw deleteError;
      }

      setMutationError(null);
      toast.success("학사 일정을 삭제했습니다.");
      await refresh();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "학사 일정 삭제 중 오류가 발생했습니다.";
      setMutationError(message);
      toast.error(message);
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-6">

      {error || mutationError ? (
        <div className="px-4 lg:px-6">
          <Alert variant="destructive">
            <AlertDescription>{error || mutationError}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {densityError?.code === "visible_range_too_dense" ? (
        <div className="px-4 lg:px-6">
          <Alert>
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>선택한 기간의 일정이 너무 많아 이전 달력을 유지합니다.</span>
              <Button type="button" variant="outline" size="sm" onClick={handleOneWeekView}>한 주 보기</Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {isSeedCalendar || !canManageAll ? (
        <div className="px-4 lg:px-6">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            {isSeedCalendar ? <Badge variant="outline">기본 일정 세트</Badge> : null}
            {!canManageAll ? <Badge variant="outline">읽기 전용</Badge> : null}
            <span>
              {isSeedCalendar
                ? "현재는 TIPS 기본 일정 세트가 표시되고 있습니다"
                : "학사일정 조회 전용 상태입니다"}
            </span>
            {isSeedCalendar && !canManageAll ? <span>·</span> : null}
            {isSeedCalendar && !canManageAll ? <span>학사일정 조회 전용 상태입니다</span> : null}
          </div>
        </div>
      ) : null}

      <div className="px-4 lg:px-6">
        {isConfirmedSevenDayRange ? (
          <section data-testid="operations-seven-day-agenda" className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">한 주 일정</h2>
              <Button type="button" variant="outline" size="sm" onClick={() => setRecoveryRange(null)}>월간 보기</Button>
            </div>
            <div className="grid gap-3 lg:grid-cols-7">
              {sevenDayKeys.map((dateKey) => {
                const dayEvents = calendarModel.events.filter((event) => {
                  const startsAt = toDateKey(event.date);
                  const endsAt = toDateKey(event.endDate || event.date);
                  return startsAt <= dateKey && dateKey <= endsAt;
                });
                return (
                  <article key={dateKey} className="min-h-32 rounded-lg border border-border/70 bg-background p-3">
                    <h3 className="text-sm font-medium">{dateKey}</h3>
                    <div className="mt-3 space-y-2">
                      {dayEvents.length === 0 ? <p className="text-xs text-muted-foreground">일정 없음</p> : null}
                      {dayEvents.map((event) => (
                        <div key={`${dateKey}:${event.id}`} className="rounded-md bg-muted/50 px-2 py-1.5 text-xs">
                          <p className="font-medium">{event.title}</p>
                          {event.schoolName ? <p className="mt-0.5 text-muted-foreground">{event.schoolName}</p> : null}
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : (
        <Calendar
          events={calendarModel.events}
          eventDates={calendarModel.eventDates}
          initialDate={initialDate || undefined}
          initialEventId={initialEventId || undefined}
          initialQuery={initialQuery || undefined}
          readOnly={!canManageAll || isSeedCalendar}
          schoolOptions={schoolOptions}
          typeOptions={typeOptions}
          calendars={sidebarGroups}
          addButtonLabel="새 학사 일정"
          onSaveEvent={handleSaveEvent}
          onDeleteEvent={handleDeleteEvent}
          onMoveEvent={handleSaveEvent}
          onVisibleRangeChange={handleVisibleRangeChange}
          onLoadEventDetail={handleLoadEventDetail}
        />
        )}
      </div>
    </div>
  );
}
