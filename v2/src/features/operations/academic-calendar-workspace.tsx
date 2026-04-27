"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/providers/auth-provider";
import { supabase } from "@/lib/supabase";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/app/admin/calendar/components/calendar";

import {
  buildAcademicEventMutationPayload,
  buildAcademicEventMutationPayloadCandidates,
  DEFAULT_ACADEMIC_EVENT_TYPES,
  getAcademicEventTypeLabel,
} from "./academic-event-utils.js";
import { buildAcademicCalendarTemplateModel } from "./academic-calendar-models.js";
import { useOperationsWorkspaceData } from "./use-operations-workspace-data";

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

function getMutationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === "object") {
    const details = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = [details.message, details.details, details.hint, details.code]
      .map((value) => text(value))
      .filter(Boolean)
      .join(" · ");
    return message || fallback;
  }
  return text(error) || fallback;
}

function isMissingColumnError(error: unknown, columnName: string) {
  const message = getMutationErrorMessage(error, "").toLowerCase();
  const column = columnName.toLowerCase();
  return (
    message.includes(`'${column}'`) ||
    message.includes(`\"${column}\"`) ||
    message.includes(` ${column} `) ||
    message.includes(`column ${column}`) ||
    message.includes(`column '${column}'`) ||
    message.includes(`column \"${column}\"`)
  ) && (
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("could not find") ||
    message.includes("does not exist")
  );
}

function removeColumnFromPayload(payload: Record<string, unknown> | Record<string, unknown>[], columnName: string) {
  const rows = Array.isArray(payload) ? payload : [payload];
  rows.forEach((row) => {
    delete row[columnName];
  });
}

async function runAcademicEventMutation(
  payload: Record<string, unknown>,
  execute: (payload: Record<string, unknown>) => PromiseLike<{ error: unknown }>,
) {
  let lastError: unknown = null;

  for (const candidate of buildAcademicEventMutationPayloadCandidates(payload)) {
    const row = { ...candidate.payload } as Record<string, unknown>;
    const skippedColumns: string[] = [];
    let result = await execute(row);

    while (result.error) {
      const missingColumn = candidate.optionalColumns.find(
        (columnName: string) => !skippedColumns.includes(columnName) && isMissingColumnError(result.error, columnName),
      );
      if (!missingColumn) {
        break;
      }

      skippedColumns.push(missingColumn);
      removeColumnFromPayload(row, missingColumn);
      result = await execute(row);
    }

    if (!result.error) {
      return { error: null };
    }

    lastError = result.error;
  }

  return { error: lastError };
}

function buildSidebarGroups(events: ReturnType<typeof buildAcademicCalendarTemplateModel>["events"]) {
  const typeCounts = new Map<string, { label: string; count: number }>();
  const categoryCounts = new Map<string, { label: string; count: number }>();

  events.forEach((event) => {
    const typeLabel = getAcademicEventTypeLabel(text(event.typeLabel) || "기타");
    const existingType = typeCounts.get(typeLabel) || { label: typeLabel, count: 0 };
    existingType.count += 1;
    typeCounts.set(typeLabel, existingType);

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
      items: [...typeCounts.entries()].map(([typeLabel, entry], index) => ({
        id: `type:${typeLabel}`,
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
  const { data, loading, error, refresh } = useOperationsWorkspaceData();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const initialDate = useMemo(() => parseSearchDate(searchParams.get("date")), [searchParams]);
  const initialEventId = useMemo(() => text(searchParams.get("eventId")), [searchParams]);
  const initialQuery = useMemo(() => text(searchParams.get("q")), [searchParams]);
  const isSeedCalendar = data.academicCalendarSource === "seed";
  const schoolOptions = useMemo(
    () =>
      (data.academicSchools || [])
        .map((school) => ({
          id: text((school as { id?: string }).id),
          name: text((school as { name?: string }).name),
          category: text((school as { category?: string }).category) || "all",
        }))
        .filter((school) => school.id && school.name)
        .sort((left, right) => left.name.localeCompare(right.name, "ko")),
    [data.academicSchools],
  );

  const calendarModel = useMemo(
    () =>
      buildAcademicCalendarTemplateModel({
        academicEvents: data.academicEvents,
        academicSchools: data.academicSchools,
      }),
    [data.academicEvents, data.academicSchools],
  );

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
    const result = buildAcademicEventMutationPayload(
      {
        id: eventData.id,
        title: eventData.title,
        schoolId: eventData.schoolId,
        type: eventData.typeLabel,
        start: toDateKey(eventData.date as Date),
        end: toDateKey((eventData.endDate as Date) || (eventData.date as Date)),
        grade: eventData.grade,
        note: eventData.note || eventData.description,
        examTerm: eventData.examTerm,
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
      const existingId = text(eventData.id);

      if (existingId) {
        const updateResult = await runAcademicEventMutation(
          result.payload as Record<string, unknown>,
          (payload) => {
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
          (payload) => supabaseClient.from("academic_events").insert([payload]),
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
      const message = getMutationErrorMessage(error, "학사 일정 저장 중 오류가 발생했습니다.");
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
      const { error: deleteError } = await supabase
        .from("academic_events")
        .delete()
        .eq("id", text(eventId));

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
        />
      </div>
    </div>
  );
}
