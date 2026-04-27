"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { ArrowLeft, ArrowUpRight, Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AcademicFilterToolbar } from "@/features/academic/filter-toolbar";
import {
  applyCalendarDateSubstitution,
  applyCalendarDateToggle,
  buildSchedulePlanForSave,
  computeAutoEndDate,
  getSuggestedNextStartDate,
  normalizeSchedulePlan,
} from "@/lib/class-schedule-planner";
import { exportElementAsImage } from "@/lib/export-as-image";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

import { buildClassScheduleRouteModel } from "./records.js";
import { useOperationsWorkspaceData } from "./use-operations-workspace-data";

function text(value: unknown) {
  return String(value || "").trim();
}

function formatProgress(completedSessions: number, sessionCount: number) {
  if (!sessionCount) {
    return 0;
  }

  return Math.round((completedSessions / sessionCount) * 100);
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

function buildPublicClassHref(selectedRow: Record<string, unknown> | null) {
  const title = text(selectedRow?.title);
  if (!title) {
    return "/classes";
  }

  const params = new URLSearchParams();
  params.set("q", title);
  return `/classes?${params.toString()}`;
}

function sanitizeFilePart(value: unknown) {
  return (
    text(value)
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "lesson-design"
  );
}

function buildLessonDesignExportFilename(
  selectedRow: Record<string, unknown> | null,
  selectedLessonSession: Record<string, unknown> | null,
) {
  const classTitle = sanitizeFilePart(selectedRow?.title || selectedRow?.className || selectedRow?.id);
  const rawSessionLabel = text(
    selectedLessonSession?.label || selectedLessonSession?.dateLabel || selectedLessonSession?.id,
  );
  const sessionLabel = rawSessionLabel ? sanitizeFilePart(rawSessionLabel) : "";

  return sessionLabel
    ? `lesson-design-${classTitle}-${sessionLabel}.png`
    : `lesson-design-${classTitle}.png`;
}

function buildLessonDesignHref(
  selectedRow: Record<string, unknown> | null,
  sessionId: string = "",
  sectionId: string = "",
) {
  const classId = text(selectedRow?.id);
  if (!classId) {
    return "/admin/curriculum";
  }

  const params = buildLessonDesignSearchParams({ classId, sessionId, sectionId });
  return `/admin/curriculum?${params.toString()}`;
}

function buildLessonDesignPageHref(
  selectedRow: Record<string, unknown> | null,
  sessionId: string = "",
  sectionId: string = "",
) {
  const classId = text(selectedRow?.id);
  if (!classId) {
    return "/admin/curriculum/lesson-design";
  }

  const params = buildLessonDesignSearchParams({ classId, sessionId, sectionId });
  return `/admin/curriculum/lesson-design?${params.toString()}`;
}

function buildCurriculumWorkspaceHref(currentParams?: URLSearchParams) {
  const params = clearLessonDesignSearchParams(currentParams || new URLSearchParams());
  const query = params.toString();
  return query ? `/admin/curriculum?${query}` : "/admin/curriculum";
}

function buildClassScheduleWorkspaceHref(currentParams?: URLSearchParams) {
  const params = clearLessonDesignSearchParams(currentParams || new URLSearchParams());
  const query = params.toString();
  return query ? `/admin/class-schedule?${query}` : "/admin/class-schedule";
}

function buildLessonDesignSearchParams({
  currentParams,
  classId,
  sessionId = "",
  sectionId = "",
  monthKeys = [],
  periodId = "all",
  scheduleState = "all",
  status = "all",
}: {
  currentParams?: URLSearchParams;
  classId: string;
  sessionId?: string;
  sectionId?: string;
  monthKeys?: string[];
  periodId?: string;
  scheduleState?: string;
  status?: string;
}) {
  const params = new URLSearchParams(currentParams?.toString() || "");
  params.set("lessonDesign", "1");
  params.set("classId", text(classId));

  const resolvedSessionId = text(sessionId);
  if (resolvedSessionId) {
    params.set("sessionId", resolvedSessionId);
  } else {
    params.delete("sessionId");
  }

  const resolvedSectionId = resolveLessonDesignSectionId(sectionId);
  if (resolvedSectionId) {
    params.set("section", resolvedSectionId);
  } else {
    params.delete("section");
  }

  const resolvedMonthKeys = [...new Set(monthKeys.map((value) => text(value)).filter(Boolean))];
  if (resolvedMonthKeys.length > 0) {
    params.set("lessonMonths", resolvedMonthKeys.join(","));
  } else {
    params.delete("lessonMonths");
  }

  const resolvedPeriodId = text(periodId);
  if (resolvedPeriodId && resolvedPeriodId !== "all") {
    params.set("lessonPeriod", resolvedPeriodId);
  } else {
    params.delete("lessonPeriod");
  }

  const resolvedScheduleState = text(scheduleState);
  if (resolvedScheduleState && resolvedScheduleState !== "all") {
    params.set("lessonScheduleState", resolvedScheduleState);
  } else {
    params.delete("lessonScheduleState");
  }

  const resolvedStatus = text(status);
  if (resolvedStatus && resolvedStatus !== "all") {
    params.set("lessonStatus", resolvedStatus);
  } else {
    params.delete("lessonStatus");
  }

  return params;
}

function clearLessonDesignSearchParams(currentParams: URLSearchParams) {
  const params = new URLSearchParams(currentParams.toString());
  params.delete("lessonDesign");
  params.delete("classId");
  params.delete("sessionId");
  params.delete("section");
  params.delete("lessonMonths");
  params.delete("lessonPeriod");
  params.delete("lessonScheduleState");
  params.delete("lessonStatus");
  return params;
}

function getProgressTone(progressStatus: string) {
  if (progressStatus === "done") {
    return "default" as const;
  }
  if (progressStatus === "partial") {
    return "secondary" as const;
  }
  return "outline" as const;
}

function getProgressLabel(progressStatus: string) {
  if (progressStatus === "done") {
    return "완료";
  }
  if (progressStatus === "partial") {
    return "진행 중";
  }
  return "대기";
}

function getActualEntryLabel(progressStatus: string) {
  if (progressStatus === "done") {
    return "실진도 완료";
  }
  if (progressStatus === "partial") {
    return "실진도 반영";
  }
  return "실진도 대기";
}

function normalizeLessonProgressStatus(value: unknown) {
  const status = text(value);
  if (status === "done" || status === "partial") {
    return status;
  }
  return "pending";
}

function buildLessonSessionProgressKey(classId: string, sessionId: string, textbookId: string) {
  return [text(classId), text(sessionId), text(textbookId)].join(":");
}

function stripLessonProgressPlaceholder(value: unknown, placeholder: string) {
  const normalized = text(value);
  return normalized === placeholder ? "" : normalized;
}

function buildLessonSessionProgressDraft(
  classId: string,
  session: {
    id: string;
    content: string;
    homework: string;
    textbookEntries: Array<{
      textbookId: string;
      textbookTitle: string;
      actualStatus: string;
      actualLabel: string;
      publicNote: string;
      teacherNote: string;
    }>;
  } | null,
) {
  if (!session) {
    return null;
  }

  const sourceEntries = session.textbookEntries.length > 0
    ? session.textbookEntries
    : [
        {
          textbookId: "",
          textbookTitle: "회차 기록",
          actualStatus: "pending",
          actualLabel: "",
          publicNote: "",
          teacherNote: "",
        },
      ];

  return {
    content: stripLessonProgressPlaceholder(session.content, "수업 기록 없음"),
    homework: stripLessonProgressPlaceholder(session.homework, "과제 없음"),
    entries: sourceEntries.map((entry, index) => ({
      id: `${text(entry.textbookId) || "session"}-${index}`,
      textbookId: text(entry.textbookId),
      textbookTitle: text(entry.textbookTitle) || `기록 ${index + 1}`,
      progressKey: buildLessonSessionProgressKey(classId, text(session.id), text(entry.textbookId)),
      status: normalizeLessonProgressStatus(entry.actualStatus),
      rangeLabel: stripLessonProgressPlaceholder(entry.actualLabel, "실진도 기록 없음"),
      publicNote: stripLessonProgressPlaceholder(entry.publicNote, "공개 메모 없음"),
      teacherNote: stripLessonProgressPlaceholder(entry.teacherNote, "교사 메모 없음"),
    })),
  };
}

function isLessonSessionProgressEntryEmpty(
  entry: {
    status: string;
    rangeLabel: string;
    publicNote: string;
    teacherNote: string;
  },
  sharedDraft: { content: string; homework: string },
) {
  return (
    normalizeLessonProgressStatus(entry.status) === "pending" &&
    !text(entry.rangeLabel) &&
    !text(entry.publicNote) &&
    !text(entry.teacherNote) &&
    !text(sharedDraft.content) &&
    !text(sharedDraft.homework)
  );
}

function isMissingLessonProgressColumnError(error: unknown, columns: string[]) {
  const message = text((error as { message?: string })?.message).toLowerCase();
  return columns.some((column) => message.includes(column.toLowerCase()));
}

async function upsertLessonProgressLog(payload: Record<string, unknown>) {
  if (!supabase) {
    throw new Error("Supabase 연결을 확인할 수 없습니다.");
  }

  const result = await supabase
    .from("progress_logs")
    .upsert(payload, { onConflict: "progress_key" })
    .select()
    .single();

  if (!result.error) {
    return;
  }

  const missingProgressKey = isMissingLessonProgressColumnError(result.error, ["progress_key"]);
  const missingSessionId = isMissingLessonProgressColumnError(result.error, ["session_id"]);

  if (missingProgressKey && !missingSessionId) {
    let existingQuery = supabase
      .from("progress_logs")
      .select("id")
      .eq("class_id", text(payload.class_id))
      .eq("session_id", text(payload.session_id));

    if (payload.textbook_id) {
      existingQuery = existingQuery.eq("textbook_id", text(payload.textbook_id));
    } else {
      existingQuery = existingQuery.is("textbook_id", null);
    }

    const existingResult = await existingQuery.maybeSingle();
    if (existingResult.error) {
      throw existingResult.error;
    }

    const { progress_key, ...payloadWithoutProgressKey } = payload;
    if (existingResult.data?.id) {
      const updateResult = await supabase
        .from("progress_logs")
        .update(payloadWithoutProgressKey)
        .eq("id", existingResult.data.id)
        .select()
        .single();
      if (updateResult.error) {
        throw updateResult.error;
      }
      return;
    }

    const insertResult = await supabase
      .from("progress_logs")
      .insert(payloadWithoutProgressKey)
      .select()
      .single();
    if (insertResult.error) {
      throw insertResult.error;
    }
    return;
  }

  throw result.error;
}

async function deleteLessonProgressLog({
  progressKey,
  classId,
  sessionId,
  textbookId,
}: {
  progressKey: string;
  classId: string;
  sessionId: string;
  textbookId: string;
}) {
  if (!supabase || (!progressKey && !classId && !sessionId)) {
    return;
  }

  const deleteByProgressKey = progressKey
    ? await supabase.from("progress_logs").delete().eq("progress_key", progressKey)
    : { error: null as unknown };
  if (!deleteByProgressKey.error) {
    return;
  }

  if (!isMissingLessonProgressColumnError(deleteByProgressKey.error, ["progress_key"])) {
    throw deleteByProgressKey.error;
  }

  let fallbackDelete = supabase
    .from("progress_logs")
    .delete()
    .eq("class_id", classId)
    .eq("session_id", sessionId);
  fallbackDelete = textbookId ? fallbackDelete.eq("textbook_id", textbookId) : fallbackDelete.is("textbook_id", null);
  const fallbackResult = await fallbackDelete;
  if (fallbackResult.error) {
    throw fallbackResult.error;
  }
}

function buildTextbookEntrySummary(
  textbookEntries: Record<string, unknown>[] = [],
  textbookMap: Map<string, string>,
) {
  return textbookEntries.map((entry, index) => {
    const textbookId = text(entry.textbookId || entry.textbook_id || entry.id);
    const textbookTitle =
      text(entry.textbookTitle || entry.textbook_title) ||
      textbookMap.get(textbookId) ||
      textbookId ||
      `교재 ${index + 1}`;
    const plan = ((entry.plan || {}) as Record<string, unknown>);
    const actual = ((entry.actual || {}) as Record<string, unknown>);
    const actualStatus = text(actual.status);
    const planLabel = text(plan.label) || "계획 범위 미지정";
    const actualLabel = text(actual.label) || "실진도 기록 없음";
    const actualUpdatedAt = formatUpdatedDate(text(actual.updatedAt || actual.updated_at));

    return {
      id: text(entry.id) || `${textbookId || "textbook"}-${index}`,
      textbookId,
      textbookTitle,
      planStart: text(plan.start),
      planEnd: text(plan.end),
      planLabel,
      planMemo: text(plan.memo) || "계획 메모 없음",
      actualLabel,
      actualStatus,
      actualStatusLabel: getActualEntryLabel(actualStatus),
      actualStatusTone: getProgressTone(actualStatus),
      actualUpdatedAt,
      publicNote: text(actual.publicNote || actual.public_note) || "공개 메모 없음",
      teacherNote: text(actual.teacherNote || actual.teacher_note) || "교사 메모 없음",
      hasPlanContent: Boolean(text(plan.start) || text(plan.end) || text(plan.label) || text(plan.memo)),
      hasActualContent: Boolean(
        text(actual.start) ||
          text(actual.end) ||
          text(actual.label) ||
          text(actual.publicNote || actual.public_note) ||
          text(actual.teacherNote || actual.teacher_note) ||
          (actualStatus && actualStatus !== "pending"),
      ),
    };
  });
}

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function buildLessonDesignSaveReadiness({
  plannerClassName,
  plannerSubject,
  dayLabels,
  periodRange,
  billingPeriods,
  sessionCount,
  textbookTitles,
  sessions,
}: {
  plannerClassName: string;
  plannerSubject: string;
  dayLabels: string;
  periodRange: string;
  billingPeriods: Array<{
    id: string;
    label: string;
    startDate: string;
    endDate: string;
    rangeLabel: string;
    sessionCount: number;
  }>;
  sessionCount: number;
  textbookTitles: string[];
  sessions: Array<{
    rangeLabel: string;
    textbookEntries: Array<{ hasPlanContent: boolean }>;
  }>;
}) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const invalidPeriods = billingPeriods.filter((period) => {
    const startDate = parseScheduleDateValue(period.startDate);
    const endDate = parseScheduleDateValue(period.endDate);
    return !startDate || !endDate || startDate.getTime() > endDate.getTime();
  });
  const overlappingPeriods = billingPeriods.filter((period, index) => {
    const startDate = parseScheduleDateValue(period.startDate);
    const endDate = parseScheduleDateValue(period.endDate);
    if (!startDate || !endDate) {
      return false;
    }

    return billingPeriods.some((candidate, candidateIndex) => {
      if (index === candidateIndex) {
        return false;
      }
      const candidateStart = parseScheduleDateValue(candidate.startDate);
      const candidateEnd = parseScheduleDateValue(candidate.endDate);
      if (!candidateStart || !candidateEnd) {
        return false;
      }
      return startDate.getTime() <= candidateEnd.getTime() && endDate.getTime() >= candidateStart.getTime();
    });
  });
  const plannedTemplateCount = sessions.filter(
    (session) =>
      session.rangeLabel !== "범위 기록 없음" ||
      session.textbookEntries.some((entry) => entry.hasPlanContent),
  ).length;

  if (plannerClassName === "수업명 미정") {
    blockers.push("공식 수업명이 아직 정리되지 않았습니다.");
  }
  if (plannerSubject === "과목 미정") {
    blockers.push("과목 기준이 아직 정리되지 않았습니다.");
  }
  if (dayLabels === "운영 요일 미정") {
    blockers.push("운영 요일이 아직 정리되지 않았습니다.");
  }
  if (periodRange === "운영 기간 미정" || billingPeriods.length === 0) {
    blockers.push("생성 구간이 아직 준비되지 않았습니다.");
  }
  if (invalidPeriods.length > 0) {
    blockers.push(`시작일 또는 종료일 점검이 필요한 생성 구간 ${invalidPeriods.length}건`);
  }
  if (overlappingPeriods.length > 0) {
    blockers.push(`서로 겹치는 생성 구간 ${overlappingPeriods.length}건`);
  }
  if (sessionCount === 0) {
    blockers.push("생성된 회차가 아직 없습니다.");
  }

  if (textbookTitles.length === 0) {
    warnings.push("연결 교재가 아직 없습니다.");
  }
  if (plannedTemplateCount === 0) {
    warnings.push("회차별 계획 범위 기록이 아직 없습니다.");
  }

  const ready = blockers.length === 0;

  return {
    ready,
    blockers,
    warnings,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    statusLabel: ready ? "저장 준비 완료" : "저장 전 확인 필요",
    statusTone: ready ? ("default" as const) : ("secondary" as const),
    summaryLabel: ready
      ? "생성 구간·회차 구성이 저장 가능한 상태로 집계되었습니다."
      : blockers[0] || "저장 기준 점검이 필요합니다.",
    detailLabel:
      blockers.length > 0
        ? blockers.join(" · ")
        : warnings.length > 0
          ? warnings.join(" · ")
          : "추가 경고 없이 현재 구조를 검토할 수 있습니다.",
  };
}

const LESSON_DESIGN_SECTION_IDS = {
  periods: "lesson-design-periods",
  calendar: "lesson-design-calendar",
  board: "lesson-design-board",
} as const;
const LESSON_DESIGN_SELECTED_SESSION_EDITOR_ID = "lesson-design-selected-session-editor";

const LESSON_DESIGN_SECTION_VALUES = new Set<string>(Object.values(LESSON_DESIGN_SECTION_IDS));
const LESSON_DESIGN_SCHEDULE_STATE_VALUES = new Set([
  "all",
  "active",
  "force_active",
  "exception",
  "makeup",
  "tbd",
]);

function resolveLessonDesignSectionId(sectionId: string) {
  const resolvedSectionId = text(sectionId);
  return LESSON_DESIGN_SECTION_VALUES.has(resolvedSectionId) ? resolvedSectionId : "";
}

function resolveLessonDesignScheduleState(value: string) {
  const resolvedValue = text(value) || "all";
  return LESSON_DESIGN_SCHEDULE_STATE_VALUES.has(resolvedValue) ? resolvedValue : "all";
}

function buildLessonMonthKey(value: string) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{2})-\d{2}$/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function formatLessonMonthLabel(value: string) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return raw || "생성 월 미정";
  }

  return `${match[1]}.${match[2]}`;
}

function formatLessonMonthTabLabel(value: string) {
  const raw = text(value);
  const match = raw.match(/^(?:\d{4}[.-])?0?(\d{1,2})$/);
  if (!match) {
    return raw || "월 미정";
  }

  return `${Number(match[1])}월`;
}

function getDefaultLessonMonthKeys(months: Array<{ key: string }>) {
  if (!months.length) {
    return [] as string[];
  }

  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const futureMonthKeys = months.filter((month) => month.key >= currentMonthKey).map((month) => month.key);
  if (futureMonthKeys.length > 0) {
    return futureMonthKeys[0] ? [futureMonthKeys[0]] : [];
  }

  return months[months.length - 1]?.key ? [months[months.length - 1].key] : [];
}

function normalizeSelectedLessonMonthKeys(
  selectedMonthKeys: string[] = [],
  months: Array<{ key: string }> = [],
  options: { fallbackToDefault?: boolean } = {},
) {
  const availableValues = new Set(months.map((month) => text(month.key)).filter(Boolean));
  const nextSelected = [...new Set(selectedMonthKeys.map((value) => text(value)).filter(Boolean))].filter(
    (value) => availableValues.has(value),
  );

  if (nextSelected.length > 0) {
    return nextSelected;
  }

  if (options.fallbackToDefault === false) {
    return [] as string[];
  }

  return getDefaultLessonMonthKeys(months);
}

function areSameLessonMonthSelection(leftValues: string[] = [], rightValues: string[] = []) {
  const left = [...new Set(leftValues.map((value) => text(value)).filter(Boolean))].sort();
  const right = [...new Set(rightValues.map((value) => text(value)).filter(Boolean))].sort();

  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function formatScheduleDateLabel(value: string) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return raw || "날짜 미정";
  }

  return `${match[1]}.${match[2]}.${match[3]}`;
}

function formatScheduleRange(startValue: string, endValue: string) {
  const start = formatScheduleDateLabel(startValue);
  const end = formatScheduleDateLabel(endValue);

  if (!text(startValue) || !text(endValue) || start === end) {
    return start;
  }

  return `${start} ~ ${end}`;
}

function parseScheduleDateValue(value: string) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isDateWithinRange(value: string, startValue: string, endValue: string) {
  const date = parseScheduleDateValue(value);
  const start = parseScheduleDateValue(startValue);
  const end = parseScheduleDateValue(endValue || startValue);
  if (!date || !start || !end) {
    return false;
  }

  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

function getScheduleStateLabel(scheduleState: string) {
  if (scheduleState === "makeup") {
    return "보강";
  }
  if (scheduleState === "exception") {
    return "휴강";
  }
  if (scheduleState === "force_active") {
    return "추가 수업";
  }
  if (scheduleState === "tbd") {
    return "미정";
  }
  return "정상";
}

function getScheduleStateTone(scheduleState: string) {
  if (scheduleState === "exception") {
    return "destructive" as const;
  }
  if (scheduleState === "tbd") {
    return "secondary" as const;
  }
  if (scheduleState === "makeup" || scheduleState === "force_active") {
    return "default" as const;
  }
  return "outline" as const;
}

function getNextRegularScheduleState(scheduleState: string, hasSubstitution = false) {
  if (scheduleState === "exception") {
    if (hasSubstitution) {
      return "active" as const;
    }
    return "makeup" as const;
  }
  if (scheduleState === "makeup") {
    return "tbd" as const;
  }
  if (scheduleState === "tbd") {
    return "active" as const;
  }
  return "exception" as const;
}

function getScheduleStateSurface(scheduleState: string) {
  if (scheduleState === "exception") {
    return {
      className: "border-red-500 bg-red-600 text-white shadow-sm hover:bg-red-700",
      mutedClassName: "text-white/85",
    };
  }
  if (scheduleState === "makeup") {
    return {
      className: "border-blue-500 bg-blue-600 text-white shadow-sm hover:bg-blue-700",
      mutedClassName: "text-white/85",
    };
  }
  if (scheduleState === "tbd") {
    return {
      className: "border-amber-500 bg-amber-500 text-white shadow-sm hover:bg-amber-600",
      mutedClassName: "text-white/85",
    };
  }
  if (scheduleState === "force_active") {
    return {
      className: "border-violet-500 bg-violet-600 text-white shadow-sm hover:bg-violet-700",
      mutedClassName: "text-white/85",
    };
  }
  return {
    className: "border-emerald-500 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700",
    mutedClassName: "text-white/85",
  };
}

function buildLessonSessionStateDraft(
  existingState: Record<string, unknown> | null,
  {
    nextState,
    memo,
    makeupMemo,
    makeupDate,
    isForced,
  }: {
    nextState: string;
    memo?: string;
    makeupMemo?: string;
    makeupDate?: string;
    isForced?: boolean;
  },
) {
  const current = existingState || {
    state: isForced ? "force_active" : "active",
    memo: "",
    makeupDate: "",
  };
  const nextMemo = text(memo ?? current.memo);
  const nextMakeupMemo = text(makeupMemo ?? current.makeupMemo);
  const nextMakeupDate = text(makeupDate ?? current.makeupDate);

  if (nextState === "active") {
    if (isForced) {
      return {
        state: "force_active",
        memo: nextMemo,
        makeupDate: "",
      };
    }

    if (!nextMemo && !nextMakeupDate && !nextMakeupMemo) {
      return null;
    }

    return {
      state: "active",
      memo: nextMemo,
      makeupDate: "",
    };
  }

  if (nextState === "tbd") {
    return {
      state: "tbd",
      memo: nextMemo,
      makeupDate: "",
    };
  }

  return {
    state: nextState,
    memo: nextMemo,
    makeupMemo: nextState === "exception" ? nextMakeupMemo : "",
    makeupDate: nextState === "exception" ? nextMakeupDate : "",
  };
}

function applyLessonSessionStateChange(
  planInput: Record<string, unknown>,
  dateString: string,
  options: {
    nextState: string;
    memo?: string;
    makeupMemo?: string;
    makeupDate?: string;
    isForced?: boolean;
  },
) {
  if (!dateString) {
    return planInput;
  }

  const nextStates = {
    ...(((planInput.sessionStates || {}) as Record<string, unknown>) || {}),
  };
  const currentState = (nextStates[dateString] || null) as Record<string, unknown> | null;
  const nextDraft = buildLessonSessionStateDraft(currentState, options);

  if (!nextDraft) {
    delete nextStates[dateString];
  } else {
    nextStates[dateString] = nextDraft;
  }

  return {
    ...planInput,
    sessionStates: nextStates,
  };
}

function resolveLessonSessionDraftDate(
  session: {
    scheduleState?: string;
    originalDate?: string;
    original_date?: string;
    dateValue?: string;
  } | null,
) {
  if (!session) {
    return "";
  }

  if (text(session.scheduleState) === "makeup") {
    return text(session.originalDate || session.original_date || session.dateValue);
  }

  return text(session.dateValue);
}

function getLessonSessionDraftState(
  session: {
    scheduleState?: string;
  } | null,
  currentState: Record<string, unknown> | null,
) {
  if (text(session?.scheduleState) === "makeup") {
    return "makeup";
  }

  const currentValue = text(currentState?.state);
  if (currentValue) {
    return currentValue;
  }

  return text(session?.scheduleState) || "active";
}

function getLessonSessionDraftMemo(
  session: {
    memo?: string;
  } | null,
  currentState: Record<string, unknown> | null,
) {
  return text(currentState?.memo) || text(session?.memo);
}

function getLessonSessionEditableMemo(
  session: {
    scheduleState?: string;
    memo?: string;
  } | null,
  currentState: Record<string, unknown> | null,
) {
  if (text(session?.scheduleState) === "makeup") {
    return text(currentState?.makeupMemo) || text(session?.memo);
  }

  return getLessonSessionDraftMemo(session, currentState);
}

function getLessonSessionDraftMakeupMemo(
  session: {
    scheduleState?: string;
    memo?: string;
  } | null,
  currentState: Record<string, unknown> | null,
) {
  return text(currentState?.makeupMemo) || (text(session?.scheduleState) === "makeup" ? text(session?.memo) : "");
}

function getLessonSessionDraftMakeupDate(
  session: {
    makeupDate?: string;
    makeup_date?: string;
  } | null,
  currentState: Record<string, unknown> | null,
) {
  return text(currentState?.makeupDate) || text(session?.makeupDate || session?.makeup_date);
}

function getLessonSessionDraftIsForced(
  session: {
    scheduleState?: string;
  } | null,
  currentState: Record<string, unknown> | null,
) {
  const currentValue = text(currentState?.state);
  if (currentValue) {
    return currentValue === "force_active";
  }

  return text(session?.scheduleState) === "force_active";
}

function buildLessonScheduleConnectionLabel({
  scheduleState,
  makeupDate,
  originalDate,
  fallback,
}: {
  scheduleState?: string;
  makeupDate?: string;
  originalDate?: string;
  fallback?: string;
}) {
  const state = text(scheduleState);
  const makeup = text(makeupDate);
  const original = text(originalDate);

  if (state === "exception") {
    return makeup ? `휴강 후 ${formatScheduleDateLabel(makeup)} 보강` : "보강일 미지정";
  }

  if (state === "makeup") {
    return original ? `${formatScheduleDateLabel(original)} 휴강의 보강` : "휴강일 미지정";
  }

  if (state === "tbd") {
    return text(fallback) || "일정 조정 확인";
  }

  return text(fallback);
}

function buildLessonScheduleContext(session: Record<string, unknown> | null, fallbackSession?: Record<string, unknown> | null) {
  const resolvedSession = session || fallbackSession || null;
  const memo = text(
    session?.memo ||
      session?.session_memo ||
      fallbackSession?.memo ||
      fallbackSession?.session_memo,
  );
  const makeupDate = text(
    session?.makeupDate ||
      session?.makeup_date ||
      fallbackSession?.makeupDate ||
      fallbackSession?.makeup_date,
  );
  const originalDate = text(
    session?.originalDate ||
      session?.original_date ||
      fallbackSession?.originalDate ||
      fallbackSession?.original_date,
  );
  const scheduleState = text(
    session?.scheduleState ||
      session?.schedule_state ||
      fallbackSession?.scheduleState ||
      fallbackSession?.schedule_state ||
      "active",
  );

  const scheduleAdjustmentLabel =
    scheduleState === "exception" && makeupDate
      ? `보강 ${formatScheduleDateLabel(makeupDate)}`
      : scheduleState === "makeup" && originalDate
        ? `${formatScheduleDateLabel(originalDate)} 휴강 보강`
        : scheduleState === "tbd"
          ? memo || "일정 조정 확인"
          : "";

  const scheduleContextLines = [memo, scheduleAdjustmentLabel].filter(Boolean);
  const scheduleConnectionLabel = buildLessonScheduleConnectionLabel({
    scheduleState,
    makeupDate,
    originalDate,
    fallback: scheduleAdjustmentLabel,
  });

  return {
    memo,
    makeupDate,
    originalDate,
    scheduleAdjustmentLabel,
    scheduleContextLabel: scheduleContextLines[0] || "등록된 일정 메모가 없습니다.",
    scheduleContextMeta: scheduleConnectionLabel || scheduleContextLines[1] || "일정 변동 없음",
    scheduleConnectionLabel,
    hasScheduleContext: scheduleContextLines.length > 0,
    scheduleStateLabel: getScheduleStateLabel(scheduleState),
    scheduleState,
    sessionId: text(resolvedSession?.id || resolvedSession?.session_id),
  };
}

function buildLessonPeriodDiagnostics(
  periods: Array<{
    id: string;
    label: string;
    startDate: string;
    endDate: string;
    rangeLabel: string;
    sessionCount: number;
  }>,
) {
  const diagnostics = periods.map((period) => {
    const startDate = parseScheduleDateValue(period.startDate);
    const endDate = parseScheduleDateValue(period.endDate);
    const hasInvalidDateRange = !startDate || !endDate || startDate.getTime() > endDate.getTime();
    const overlaps = hasInvalidDateRange
      ? []
      : periods.filter((candidate) => {
          if (candidate.id === period.id) {
            return false;
          }

          const candidateStart = parseScheduleDateValue(candidate.startDate);
          const candidateEnd = parseScheduleDateValue(candidate.endDate);
          if (!candidateStart || !candidateEnd || candidateStart.getTime() > candidateEnd.getTime()) {
            return false;
          }

          return startDate.getTime() <= candidateEnd.getTime() && endDate.getTime() >= candidateStart.getTime();
        });

    const statusLabel = hasInvalidDateRange
      ? "날짜 점검 필요"
      : overlaps.length > 0
        ? "겹침 점검"
        : "정상 구간";
    const statusTone: "destructive" | "secondary" | "outline" = hasInvalidDateRange
      ? "destructive"
      : overlaps.length > 0
        ? "secondary"
        : "outline";
    const inspectionLabel = hasInvalidDateRange
      ? "시작일 또는 종료일을 다시 확인해야 합니다."
      : overlaps.length > 0
        ? `${overlaps.map((candidate) => candidate.label).join(", ")} 구간과 일정 범위가 겹칩니다.`
        : "현재 생성 구간 기준으로 바로 회차 검토를 이어갈 수 있습니다.";

    return {
      ...period,
      hasInvalidDateRange,
      overlaps,
      overlapsCount: overlaps.length,
      statusLabel,
      statusTone,
      inspectionLabel,
    };
  });

  return {
    periods: diagnostics,
    invalidCount: diagnostics.filter((period) => period.hasInvalidDateRange).length,
    overlapCount: diagnostics.filter((period) => period.overlapsCount > 0).length,
    attentionCount: diagnostics.filter(
      (period) => period.hasInvalidDateRange || period.overlapsCount > 0,
    ).length,
  };
}

function buildLessonDesignSnapshot(
  selectedRow: Record<string, unknown> | null,
  textbooks: Record<string, unknown>[] = [],
  planOverride: Record<string, unknown> | null = null,
) {
  if (!selectedRow) {
    return null;
  }

  const raw = (selectedRow.raw || null) as Record<string, unknown> | null;
  const classItem = (raw?.classItem || null) as Record<string, unknown> | null;
  const plan = (planOverride || classItem?.schedulePlan || classItem?.schedule_plan || null) as Record<string, unknown> | null;
  const actualSessions = Array.isArray(raw?.sessions)
    ? [...(raw.sessions as Record<string, unknown>[])]
        .sort(
          (left, right) =>
            Number(left.sessionNumber || left.session_number || 0) - Number(right.sessionNumber || right.session_number || 0),
        )
    : [];
  const rawSessions =
    planOverride && Array.isArray(plan?.sessions)
      ? [...(plan.sessions as Record<string, unknown>[])]
          .sort(
            (left, right) =>
              Number(left.sessionNumber || left.session_number || 0) - Number(right.sessionNumber || right.session_number || 0),
          )
      : actualSessions;
  const planSessions = Array.isArray(plan?.sessions)
    ? (plan.sessions as Record<string, unknown>[])
    : Array.isArray(plan?.session_list)
      ? (plan.session_list as Record<string, unknown>[])
      : [];
  const billingPeriods = Array.isArray(plan?.billingPeriods)
    ? (plan.billingPeriods as Record<string, unknown>[])
    : Array.isArray(plan?.billing_periods)
      ? (plan.billing_periods as Record<string, unknown>[])
      : [];
  const selectedDays = Array.isArray(plan?.selectedDays)
    ? (plan.selectedDays as Array<string | number>)
    : Array.isArray(plan?.selected_days)
      ? (plan.selected_days as Array<string | number>)
      : [];

  const textbookMap = new Map(
    textbooks.map((book) => [text(book?.id), text(book?.title || book?.name)]),
  );
  const rawTextbookIds = classItem?.textbook_ids || classItem?.textbookIds;
  const textbookTitles = Array.isArray(rawTextbookIds)
    ? rawTextbookIds
        .map((value) => text(value))
        .filter(Boolean)
        .map((bookId) => textbookMap.get(bookId) || bookId || "교재 정보 없음")
    : [];

  const periodSummaries = billingPeriods.map((period, index) => ({
    id: text(period.id || period.period_id) || `period-${index}`,
    label: text(period.label || period.period_label) || `${index + 1}구간`,
    color: text(period.color || period.period_color) || "#216e4e",
    startDate: text(period.startDate || period.start_date),
    endDate: text(period.endDate || period.end_date),
    rangeLabel: formatScheduleRange(text(period.startDate || period.start_date), text(period.endDate || period.end_date)),
    sessionCount: Number(period.sessionCount || period.session_count || period.totalSessions || period.total_sessions || 0),
  }));
  const sessions = rawSessions.map((session) => {
    const sessionNumber = Number(session.sessionNumber || session.session_number || 0);
    const sessionId = text(session.id || session.session_id);
    const sessionDate = text(session.date || session.session_date);
    const matchedActualSession = actualSessions.find((actualSession) => {
      const actualSessionId = text(actualSession?.id || actualSession?.session_id);
      const actualSessionNumber = Number(actualSession?.sessionNumber || actualSession?.session_number || 0);
      return (
        (actualSessionId && actualSessionId === sessionId) ||
        (actualSessionNumber > 0 && actualSessionNumber === sessionNumber)
      );
    });
    const sessionSource = (matchedActualSession || session) as Record<string, unknown>;
    const monthKey = buildLessonMonthKey(sessionDate);
    const matchedPlanSession = planSessions.find((planSession) => {
      const planSessionId = text(planSession?.id || planSession?.session_id);
      const planSessionNumber = Number(planSession?.sessionNumber || planSession?.session_number || 0);
      return (
        (planSessionId && planSessionId === sessionId) ||
        (planSessionNumber > 0 && planSessionNumber === sessionNumber)
      );
    });
    const textbookEntries = Array.isArray(sessionSource.textbookEntries)
      ? (sessionSource.textbookEntries as Record<string, unknown>[])
      : Array.isArray(sessionSource.textbook_entries)
        ? (sessionSource.textbook_entries as Record<string, unknown>[])
        : Array.isArray(session.textbookEntries)
          ? (session.textbookEntries as Record<string, unknown>[])
          : Array.isArray(session.textbook_entries)
            ? (session.textbook_entries as Record<string, unknown>[])
            : Array.isArray(matchedPlanSession?.textbookEntries)
              ? (matchedPlanSession.textbookEntries as Record<string, unknown>[])
              : Array.isArray(matchedPlanSession?.textbook_entries)
                ? (matchedPlanSession.textbook_entries as Record<string, unknown>[])
                : [];
    const scheduleContext = buildLessonScheduleContext(session, matchedPlanSession || null);
    const textbookEntrySummaries = buildTextbookEntrySummary(textbookEntries, textbookMap);
    const sessionBillingId = text(
      session.billingId ||
        session.billing_id ||
        matchedPlanSession?.billingId ||
        matchedPlanSession?.billing_id,
    );
    const sessionBillingLabel = text(
      session.billingLabel ||
        session.billing_label ||
        matchedPlanSession?.billingLabel ||
        matchedPlanSession?.billing_label,
    );
    const sessionBillingColor = text(
      session.billingColor ||
        session.billing_color ||
        matchedPlanSession?.billingColor ||
        matchedPlanSession?.billing_color,
    );
    const matchedPeriod =
      periodSummaries.find((period) => period.id === sessionBillingId) ||
      periodSummaries.find((period) => isDateWithinRange(sessionDate, period.startDate, period.endDate)) ||
      null;
    const primaryTextbookEntry =
      textbookEntrySummaries.find((entry) => entry.hasPlanContent || entry.hasActualContent) ||
      textbookEntrySummaries[0] ||
      null;

    return {
      id: sessionId || `${sessionNumber}-${sessionDate || "undated"}-${text(session.scheduleState || session.schedule_state || "active")}`,
      label: sessionNumber > 0 ? `${sessionNumber}회차` : "0회차",
      sessionNumber,
      dateValue: sessionDate,
      dateLabel: formatScheduleDateLabel(sessionDate),
      monthKey,
      monthLabel: formatLessonMonthLabel(monthKey),
      billingId: sessionBillingId || matchedPeriod?.id || "",
      billingLabel: sessionBillingLabel || matchedPeriod?.label || "구간 미지정",
      billingColor: sessionBillingColor || matchedPeriod?.color || "#216e4e",
      scheduleState: scheduleContext.scheduleState,
      scheduleStateLabel: scheduleContext.scheduleStateLabel,
      memo: scheduleContext.memo,
      makeupDate: scheduleContext.makeupDate,
      originalDate: scheduleContext.originalDate,
      scheduleAdjustmentLabel: scheduleContext.scheduleAdjustmentLabel,
      scheduleContextLabel: scheduleContext.scheduleContextLabel,
      scheduleContextMeta: scheduleContext.scheduleContextMeta,
      scheduleConnectionLabel: scheduleContext.scheduleConnectionLabel,
      hasScheduleContext: scheduleContext.hasScheduleContext,
      progressStatus: text(sessionSource.progressStatus || sessionSource.progress_status),
      progressLabel: getProgressLabel(text(sessionSource.progressStatus || sessionSource.progress_status)),
      progressTone: getProgressTone(text(sessionSource.progressStatus || sessionSource.progress_status)),
      noteSummary: text(sessionSource.noteSummary || sessionSource.note_summary) || "기록 메모 없음",
      rangeLabel: text(sessionSource.rangeLabel || sessionSource.range_label) || "범위 기록 없음",
      publicNote: text(sessionSource.publicNote || sessionSource.public_note) || "공개 메모 없음",
      teacherNote: text(sessionSource.teacherNote || sessionSource.teacher_note) || "교사 메모 없음",
      content: text(sessionSource.content) || "수업 기록 없음",
      homework: text(sessionSource.homework) || "과제 없음",
      updatedAt: formatUpdatedDate(text(sessionSource.updatedAt || sessionSource.updated_at)),
      textbookEntryLabel:
        textbookEntrySummaries.length > 0
          ? `${textbookEntrySummaries.length}개 교재 범위`
          : "교재 범위 미지정",
      textbookEntryPreview: primaryTextbookEntry
        ? `${primaryTextbookEntry.textbookTitle} · ${primaryTextbookEntry.planLabel}`
        : "교재 범위 미지정",
      textbookEntries: textbookEntrySummaries,
      periodId: matchedPeriod?.id || "",
      periodLabel: matchedPeriod?.label || "전체 운영 구간",
    };
  });
  const periodSummariesWithSessionCounts = periodSummaries.map((period) => {
    const calculatedSessionCount = sessions.filter(
      (session) =>
        session.periodId === period.id ||
        isDateWithinRange(session.dateValue, period.startDate, period.endDate),
    ).length;

    return {
      ...period,
      sessionCount: period.sessionCount || calculatedSessionCount,
    };
  });
  const periodDiagnostics = buildLessonPeriodDiagnostics(periodSummariesWithSessionCounts);

  const monthSummaries = [...new Set(sessions.map((session) => session.monthKey).filter(Boolean))]
    .sort()
    .map((monthKey) => {
      const monthSessions = sessions.filter((session) => session.monthKey === monthKey);
      return {
        key: monthKey,
        label: formatLessonMonthLabel(monthKey),
        sessionCount: monthSessions.length,
        pendingCount: monthSessions.filter((session) => session.progressLabel === "대기").length,
      };
    });
  const undatedSessions = sessions.filter((session) => !session.monthKey);

  const firstPeriod = periodSummariesWithSessionCounts[0] || null;
  const lastPeriod = periodSummariesWithSessionCounts[periodSummariesWithSessionCounts.length - 1] || null;
  const completedSessionCount = sessions.filter((session) => session.progressLabel === "완료").length;
  const updatedSessionCount = sessions.filter((session) => session.progressLabel !== "대기").length;
  const pendingSessionCount = Math.max(sessions.length - updatedSessionCount, 0);
  const plannerClassName =
    text(plan?.className || plan?.class_name || classItem?.className || classItem?.class_name) ||
    text(selectedRow.title) ||
    "수업명 미정";
  const plannerSubject = text(plan?.subject || classItem?.subject || selectedRow.subject) || "과목 미정";
  const plannerSchedule =
    text(plan?.schedule || classItem?.schedule || selectedRow.scheduleLabel) || "시간표 미정";
  const plannerGlobalSessionCount = selectedDays.length > 0 ? selectedDays.length * 4 : 0;
  const plannerSelectedDayCount = selectedDays.length;
  const plannerSessionTargetLabel =
    plannerGlobalSessionCount > 0
      ? `${plannerGlobalSessionCount}회 기준`
      : sessions.length > 0
        ? `${sessions.length}회 생성`
        : "회차 기준 미정";
  const plannerPeriodLabel =
    periodSummaries.length > 0 ? `${periodSummaries.length}개 생성 구간` : "생성 구간 미정";
  const saveReadiness = buildLessonDesignSaveReadiness({
    plannerClassName,
    plannerSubject,
    dayLabels:
      selectedDays
        .map((value) => DAY_LABELS[Number(value)])
        .filter(Boolean)
        .join(" · ") || "운영 요일 미정",
    periodRange:
      firstPeriod && lastPeriod
        ? formatScheduleRange(firstPeriod.startDate, lastPeriod.endDate)
        : "운영 기간 미정",
    billingPeriods: periodSummariesWithSessionCounts,
    sessionCount: sessions.length,
    textbookTitles,
    sessions,
  });

  return {
    plannerClassName,
    plannerSubject,
    plannerSchedule,
    plannerGlobalSessionCount,
    plannerSelectedDayCount,
    plannerSessionTargetLabel,
    plannerPeriodLabel,
    saveReadiness,
    shareStatusLabel: plan ? "공개 수업 공유 데이터" : "공유 데이터 없음",
    shareStatusTone: plan ? ("secondary" as const) : ("outline" as const),
    shareSessionCount: sessions.length,
    updatedSessionCount,
    completedSessionCount,
    pendingSessionCount,
    dayLabels:
      selectedDays
        .map((value) => DAY_LABELS[Number(value)])
        .filter(Boolean)
        .join(" · ") || "운영 요일 미정",
    periodRange:
      firstPeriod && lastPeriod
        ? formatScheduleRange(firstPeriod.startDate, lastPeriod.endDate)
        : "운영 기간 미정",
    billingPeriods: periodSummariesWithSessionCounts,
    periodDiagnostics,
    monthSummaries,
    undatedSessions,
    undatedSessionCount: undatedSessions.length,
    sessionCount: sessions.length,
    textbookTitles,
    sessions,
  };
}

function scrollLessonDesignSection(sectionId: string) {
  if (typeof document === "undefined" || !sectionId) {
    return;
  }

  document.getElementById(sectionId)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
    inline: "nearest",
  });
}

function scrollLessonDesignSelectedSessionEditor() {
  if (typeof document === "undefined") {
    return;
  }

  const target =
    document.getElementById(LESSON_DESIGN_SELECTED_SESSION_EDITOR_ID) ||
    document.getElementById(LESSON_DESIGN_SECTION_IDS.periods);
  target?.scrollIntoView({
    behavior: "smooth",
    block: "start",
    inline: "nearest",
  });
}

function scrollLessonDesignSelectedSessionEditorAfterRender() {
  if (typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(scrollLessonDesignSelectedSessionEditor);
  });
}

function findLessonDesignSessionByDate(
  lessonDesignSnapshot: ReturnType<typeof buildLessonDesignSnapshot>,
  dateValue: string,
  options: {
    preferOriginalDate?: string;
    preferScheduleState?: string;
  } = {},
) {
  if (!lessonDesignSnapshot || !dateValue) {
    return null;
  }

  const matches = lessonDesignSnapshot.sessions.filter((session) => session.dateValue === dateValue);
  if (!matches.length) {
    return null;
  }

  if (options.preferOriginalDate) {
    const matchedOriginalDate = matches.find(
      (session) => session.originalDate === options.preferOriginalDate,
    );
    if (matchedOriginalDate) {
      return matchedOriginalDate;
    }
  }

  if (options.preferScheduleState) {
    const matchedScheduleState = matches.find(
      (session) => session.scheduleState === options.preferScheduleState,
    );
    if (matchedScheduleState) {
      return matchedScheduleState;
    }
  }

  return matches.find((session) => session.scheduleState !== "makeup") || matches[0] || null;
}

function buildLessonDesignReadinessActions(
  lessonDesignSnapshot: ReturnType<typeof buildLessonDesignSnapshot>,
  selectedLessonSession: { id: string; label: string } | null,
) {
  if (!lessonDesignSnapshot) {
    return [] as Array<{
      key: string;
      label: string;
      summary: string;
      sectionId: string;
      variant: "default" | "secondary" | "outline";
    }>;
  }

  const plannedTemplateCount = lessonDesignSnapshot.sessions.filter(
    (session) =>
      session.rangeLabel !== "범위 기록 없음" ||
      session.textbookEntries.some((entry) => entry.hasPlanContent),
  ).length;
  const actions: Array<{
    key: string;
    label: string;
    summary: string;
    sectionId: string;
    variant: "default" | "secondary" | "outline";
  }> = [];

  const needsPeriodCheck =
    lessonDesignSnapshot.billingPeriods.length === 0 ||
    lessonDesignSnapshot.periodRange === "운영 기간 미정" ||
    lessonDesignSnapshot.saveReadiness.blockers.some(
      (item) => item.includes("생성 구간") || item.includes("시작일") || item.includes("종료일") || item.includes("겹치는"),
    );
  if (needsPeriodCheck) {
    actions.push({
      key: "periods",
      label: "생성 구간 점검",
      summary: "구간 수 · 날짜 범위 · 겹침 여부를 현재 저장 검토 기준으로 확인합니다.",
      sectionId: LESSON_DESIGN_SECTION_IDS.periods,
      variant: "secondary",
    });
  }

  if (lessonDesignSnapshot.sessionCount === 0) {
    actions.push({
      key: "calendar",
      label: "생성 일정 확인",
      summary: "회차가 생성되지 않은 상태인지 월 캘린더 기준으로 확인합니다.",
      sectionId: LESSON_DESIGN_SECTION_IDS.calendar,
      variant: "secondary",
    });
  }

  if (plannedTemplateCount === 0) {
    actions.push({
      key: "board",
      label: "회차 목록 확인",
      summary: "회차별 계획 범위와 실진도 템플릿 준비 상태를 점검합니다.",
      sectionId: LESSON_DESIGN_SECTION_IDS.board,
      variant: "outline",
    });
  }

  void selectedLessonSession;

  return actions;
}

function buildLessonCalendarCells(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDate = new Date(year, month + 1, 0).getDate();
  const leadingCount = firstDay.getDay();
  const cells: Array<{ date: Date; isCurrentMonth: boolean }> = [];

  for (let index = leadingCount - 1; index >= 0; index -= 1) {
    cells.push({
      date: new Date(year, month, 1 - index - 1),
      isCurrentMonth: false,
    });
  }

  for (let day = 1; day <= lastDate; day += 1) {
    cells.push({
      date: new Date(year, month, day),
      isCurrentMonth: true,
    });
  }

  while (cells.length % 7 !== 0) {
    const nextIndex = cells.length - leadingCount - lastDate + 1;
    cells.push({
      date: new Date(year, month + 1, nextIndex),
      isCurrentMonth: false,
    });
  }

  return cells;
}

function getLessonCalendarPrimarySession<T extends { scheduleState: string }>(sessions: T[] = []) {
  if (!sessions.length) {
    return null;
  }

  return sessions.find((session) => session.scheduleState !== "makeup") || sessions[0] || null;
}

function buildLessonCalendarMonths<
  T extends {
    id: string;
    monthKey: string;
    monthLabel: string;
    dateValue: string;
    scheduleState: string;
    progressStatus: string;
  },
>(sessions: T[] = []) {
  const months = new Map<
    string,
    {
      key: string;
      label: string;
      year: number;
      month: number;
      activeCount: number;
      pendingCount: number;
      sessionsByDate: Map<string, T[]>;
    }
  >();

  sessions.forEach((session) => {
    const date = parseScheduleDateValue(session.dateValue);
    if (!date || !session.monthKey) {
      return;
    }

    const existingMonth = months.get(session.monthKey) || {
      key: session.monthKey,
      label: session.monthLabel,
      year: date.getFullYear(),
      month: date.getMonth(),
      activeCount: 0,
      pendingCount: 0,
      sessionsByDate: new Map<string, T[]>(),
    };
    const dateKey = text(session.dateValue);
    const sessionBucket = existingMonth.sessionsByDate.get(dateKey) || [];
    sessionBucket.push(session);
    existingMonth.sessionsByDate.set(dateKey, sessionBucket);
    existingMonth.activeCount += 1;
    if (session.progressStatus !== "done") {
      existingMonth.pendingCount += 1;
    }
    months.set(session.monthKey, existingMonth);
  });

  return [...months.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function countLessonGroupSessions<
  T extends {
    sessionNumber: number;
    scheduleState: string;
  },
>(sessions: T[] = []) {
  const nonMakeupSessions = sessions.filter((session) => session.scheduleState !== "makeup");
  const numberedSessions = new Set(
    nonMakeupSessions
      .map((session) => Number(session.sessionNumber || 0))
      .filter((sessionNumber) => Number.isFinite(sessionNumber) && sessionNumber > 0),
  );
  const unnumberedSessionCount = nonMakeupSessions.filter(
    (session) => !Number.isFinite(Number(session.sessionNumber || 0)) || Number(session.sessionNumber || 0) <= 0,
  ).length;
  if (numberedSessions.size > 0 || unnumberedSessionCount > 0) {
    return numberedSessions.size + unnumberedSessionCount;
  }

  return sessions.length;
}

function compareLessonSessionsByDate<
  T extends {
    label: string;
    sessionNumber?: number;
    dateValue: string;
  },
>(left: T, right: T) {
  const dateGap = text(left.dateValue).localeCompare(text(right.dateValue));
  if (dateGap !== 0) {
    return dateGap;
  }

  const leftNumber = Number(left.sessionNumber || 0);
  const rightNumber = Number(right.sessionNumber || 0);
  const hasLeftNumber = Number.isFinite(leftNumber) && leftNumber > 0;
  const hasRightNumber = Number.isFinite(rightNumber) && rightNumber > 0;

  if (hasLeftNumber && hasRightNumber && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  if (hasLeftNumber !== hasRightNumber) {
    return hasLeftNumber ? -1 : 1;
  }

  return text(left.label).localeCompare(text(right.label), "ko");
}

function buildLessonSessionGroups<
  T extends {
    id: string;
    label: string;
    sessionNumber: number;
    dateValue: string;
    monthLabel: string;
    billingId: string;
    billingLabel: string;
    billingColor: string;
    periodId: string;
    periodLabel: string;
    progressStatus: string;
    scheduleState: string;
  },
>( 
  sessions: T[] = [],
  billingPeriods: Array<{ id: string; label: string; color: string; rangeLabel: string }> = [],
) {
  const groupMap = new Map(
    billingPeriods.map((period, index) => [
      period.id,
      {
        key: period.id,
        label: period.label || `${index + 1}구간`,
        billingLabel: period.label || `${index + 1}구간`,
        billingColor: period.color || "#216e4e",
        rangeLabel: period.rangeLabel || "생성 구간 정보 없음",
        sessions: [] as T[],
      },
    ]),
  );

  sessions.forEach((session) => {
    const groupKey = text(session.billingId || session.periodId) || "unassigned";
    const existingGroup = groupMap.get(groupKey) || {
      key: groupKey,
      label: text(session.monthLabel) || text(session.periodLabel) || "구간 미지정",
      billingLabel: text(session.billingLabel) || text(session.periodLabel) || "구간 미지정",
      billingColor: text(session.billingColor) || "#216e4e",
      rangeLabel: text(session.monthLabel) || "생성 구간 정보 없음",
      sessions: [] as T[],
    };
    existingGroup.sessions.push(session);
    groupMap.set(groupKey, existingGroup);
  });

  return [...groupMap.values()]
    .filter((group) => group.sessions.length > 0)
    .map((group) => {
      const normalizedSessions = [...group.sessions].sort(compareLessonSessionsByDate);

      return {
        ...group,
        label: normalizedSessions[0]?.monthLabel || group.label,
        billingLabel:
          group.billingLabel || normalizedSessions[0]?.billingLabel || normalizedSessions[0]?.periodLabel || "구간 미지정",
        billingColor: group.billingColor || normalizedSessions[0]?.billingColor || "#216e4e",
        sessions: normalizedSessions,
        sessionCount: countLessonGroupSessions(normalizedSessions),
        pendingCount: normalizedSessions.filter((session) => session.progressStatus !== "done").length,
      };
    });
}

function buildLessonPreviewBadges<
  T extends {
    key: string;
    label: string;
    billingLabel: string;
    billingColor: string;
    sessionCount: number;
  },
>(sessionGroups: T[] = []) {
  const badges: Array<{ key: string; label: string; color: string }> = [];

  sessionGroups.forEach((group) => {
    badges.push({
      key: `period-${group.key}`,
      label: `${group.billingLabel || group.label} ${group.sessionCount}회`,
      color: group.billingColor || "#216e4e",
    });
  });

  return badges;
}

function toComparableLessonTime(value: string) {
  const parsed = parseScheduleDateValue(value);
  if (!parsed) {
    return Number.POSITIVE_INFINITY;
  }

  parsed.setHours(0, 0, 0, 0);
  return parsed.getTime();
}

function buildLessonFlowStepKey(
  groupKey: string,
  session: { id: string; dateValue: string; sessionNumber: number; scheduleState: string },
) {
  return [
    groupKey,
    text(session.id),
    text(session.dateValue) || "undated",
    Number(session.sessionNumber || 0) || "na",
    text(session.scheduleState) || "active",
  ].join("::");
}

function buildLessonFlowStateMap<
  T extends {
    key: string;
    sessions: Array<{
      id: string;
      dateValue: string;
      sessionNumber: number;
      scheduleState: string;
    }>;
  },
>(sessionGroups: T[] = [], referenceDate = new Date()) {
  const comparisonDate = new Date(referenceDate);
  comparisonDate.setHours(0, 0, 0, 0);

  const timeline = sessionGroups
    .flatMap((group, groupIndex) =>
      group.sessions.map((session, sessionIndex) => ({
        groupKey: group.key,
        session,
        groupIndex,
        sessionIndex,
        sortKey: buildLessonFlowStepKey(group.key, session),
      })),
    )
    .sort((left, right) => {
      const timeGap = toComparableLessonTime(left.session.dateValue) - toComparableLessonTime(right.session.dateValue);
      if (timeGap !== 0) {
        return timeGap;
      }
      const sessionNumberGap = Number(left.session.sessionNumber || 0) - Number(right.session.sessionNumber || 0);
      if (sessionNumberGap !== 0) {
        return sessionNumberGap;
      }
      const groupIndexGap = left.groupIndex - right.groupIndex;
      if (groupIndexGap !== 0) {
        return groupIndexGap;
      }
      const sessionIndexGap = left.sessionIndex - right.sessionIndex;
      if (sessionIndexGap !== 0) {
        return sessionIndexGap;
      }
      return text(left.sortKey).localeCompare(text(right.sortKey));
    });

  let activeTimelineIndex = -1;
  timeline.forEach((entry, index) => {
    if (toComparableLessonTime(entry.session.dateValue) <= comparisonDate.getTime()) {
      activeTimelineIndex = index;
    }
  });

  return new Map(
    timeline.map((entry, index) => {
      const flowState =
        index < activeTimelineIndex
          ? "done"
          : index === activeTimelineIndex
            ? "active"
            : "pending";
      return [text(entry.session.id), flowState] as const;
    }),
  );
}

function buildSelectedRowSnapshot(
  selectedRow: Record<string, unknown> | null,
  textbooks: Record<string, unknown>[] = [],
) {
  if (!selectedRow) {
    return null;
  }

  const raw = (selectedRow.raw || null) as Record<string, unknown> | null;
  const classItem = (raw?.classItem || null) as Record<string, unknown> | null;
  const syncGroup = (raw?.syncGroup || null) as Record<string, unknown> | null;
  const warningSummary = (raw?.warningSummary || null) as Record<string, unknown> | null;
  const sessions = Array.isArray(raw?.sessions)
    ? [...(raw?.sessions as Record<string, unknown>[])]
        .sort(
          (left, right) =>
            Number(left?.sessionNumber || 0) - Number(right?.sessionNumber || 0),
        )
    : [];

  const textbookMap = new Map(
    textbooks.map((book) => [text(book?.id), text(book?.title || book?.name)]),
  );
  const rawTextbookIds = classItem?.textbook_ids || classItem?.textbookIds;
  const textbookIds = Array.isArray(rawTextbookIds)
    ? rawTextbookIds.map((value) => text(value)).filter(Boolean)
    : [];
  const textbookTitles = textbookIds.map(
    (bookId) => textbookMap.get(bookId) || bookId || "교재 정보 없음",
  );

  const actionableSessions = sessions.filter(
    (session) => text(session.progressStatus) !== "done",
  );
  const nextActionSession = actionableSessions[0] || null;
  const pendingSessionLabels = actionableSessions
    .map((session) => {
      const sessionNumber = Number(session.sessionNumber || 0);
      return sessionNumber > 0 ? `${sessionNumber}회차` : text(session.id) || "확인 필요";
    })
    .filter(Boolean);
  const latestNoteSession = [...sessions]
    .reverse()
    .find((session) => text(session.noteSummary));
  const recentSessions = [...sessions]
    .filter(
      (session) =>
        text(session.progressStatus) !== "pending" || Boolean(text(session.noteSummary)),
    )
    .slice(-3)
    .reverse();

  const syncGap = (warningSummary?.syncGap || null) as Record<string, unknown> | null;
  const planDrift = (warningSummary?.planDrift || null) as Record<string, unknown> | null;
  const warningText = text(selectedRow.warningText);
  const nextActionNumber = Number(nextActionSession?.sessionNumber || 0);

  return {
    textbookTitles,
    nextSessionId: text(nextActionSession?.id),
    nextSessionTone: getProgressTone(text(nextActionSession?.progressStatus)),
    nextSessionLabel: nextActionSession
      ? nextActionNumber > 0
        ? `${nextActionNumber}회차가 다음 확인 대상으로 집계되었습니다.`
        : "다음 확인 대상 회차가 집계되었습니다."
      : "아직 집계된 회차가 없습니다.",
    nextSessionMeta: nextActionSession
      ? `${getProgressLabel(text(nextActionSession.progressStatus))} · ${formatUpdatedDate(text(nextActionSession.updatedAt))}`
      : "기록 없음",
    syncGroupLabel: syncGroup?.name
      ? `${text(syncGroup.name)} · ${text(raw?.latestActualSessionIndex || selectedRow.latestActualSessionIndex)}회차 기준`
      : "현재 연결된 동기 그룹이 없습니다.",
    syncGroupHint: syncGroup?.name
      ? "같은 그룹에 속한 반들의 실제 회차 기준 상태입니다."
      : "동기 그룹 연결 정보가 아직 없습니다.",
    warningLabel: warningText || "현재 감지된 운영 경고가 없습니다.",
    warningHint: text(planDrift?.message || syncGap?.message) || "계획 대비 차이나 그룹 간 간격 집계 결과입니다.",
    pendingSessionSummary:
      pendingSessionLabels.length > 0
        ? pendingSessionLabels.join(", ")
        : "업데이트 대기 회차가 없습니다.",
    pendingSessions: actionableSessions.slice(0, 4).map((session) => ({
      id: text(session.id) || `${Number(session.sessionNumber || 0)}`,
      label:
        Number(session.sessionNumber || 0) > 0
          ? `${Number(session.sessionNumber || 0)}회차`
          : "확인 필요 회차",
      statusLabel: getProgressLabel(text(session.progressStatus)),
      progressTone: getProgressTone(text(session.progressStatus)),
      updatedAt: formatUpdatedDate(text(session.updatedAt)),
      noteSummary: text(session.noteSummary) || "기록 메모 없음",
    })),
    latestNoteLabel: text(latestNoteSession?.noteSummary) || text(raw?.latestNoteSummary) || "최근 기록 메모가 아직 없습니다.",
    latestNoteSessionLabel:
      (Number(latestNoteSession?.sessionNumber || 0) > 0
        ? `${Number(latestNoteSession?.sessionNumber || 0)}회차`
        : "") || text(raw?.latestNoteSessionLabel) || "기록 없음",
    recentSessions: recentSessions.map((session) => ({
      id: text(session.id) || `${Number(session.sessionNumber || 0)}`,
      label:
        Number(session.sessionNumber || 0) > 0
          ? `${Number(session.sessionNumber || 0)}회차`
          : "기록 회차",
      statusLabel: getProgressLabel(text(session.progressStatus)),
      progressTone: getProgressTone(text(session.progressStatus)),
      updatedAt: formatUpdatedDate(text(session.updatedAt)),
      noteSummary: text(session.noteSummary),
    })),
  };
}

function ClassScheduleSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="border border-border/70 bg-background px-4 py-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={`filter-${index}`} className="h-10 w-full" />
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.55fr_0.85fr]">
        <div className="border border-border/70 bg-background px-4 py-4">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={`row-${index}`} className="h-18 w-full" />
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="border border-border/70 bg-background px-4 py-4">
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={`group-${index}`} className="h-24 w-full" />
              ))}
            </div>
          </div>

          <div className="border border-border/70 bg-background px-4 py-4">
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={`status-${index}`} className="h-18 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ClassScheduleWorkspace() {
  const { data, loading, error, refresh } = useOperationsWorkspaceData();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [termId, setTermId] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [teacher, setTeacher] = useState("");
  const [selectedSyncGroupId, setSelectedSyncGroupId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [lessonDesignOpen, setLessonDesignOpen] = useState(false);
  const [selectedLessonMonthKeys, setSelectedLessonMonthKeys] = useState<string[]>([]);
  const [selectedLessonPeriodId, setSelectedLessonPeriodId] = useState("all");
  const [selectedLessonScheduleState, setSelectedLessonScheduleState] = useState("all");
  const [selectedLessonSessionId, setSelectedLessonSessionId] = useState("");
  const [lessonMonthDetailsOpen, setLessonMonthDetailsOpen] = useState(false);
  const [lessonProgressDraft, setLessonProgressDraft] = useState<ReturnType<typeof buildLessonSessionProgressDraft> | null>(null);
  const [isLessonProgressSaving, setIsLessonProgressSaving] = useState(false);
  const [lessonProgressSaveError, setLessonProgressSaveError] = useState("");
  const [lessonProgressSaveNotice, setLessonProgressSaveNotice] = useState("");
  const [lessonPlanDraft, setLessonPlanDraft] = useState<Record<string, unknown> | null>(null);
  const [isLessonDesignSaving, setIsLessonDesignSaving] = useState(false);
  const [lessonDesignSaveError, setLessonDesignSaveError] = useState("");
  const [lessonDesignSaveNotice, setLessonDesignSaveNotice] = useState("");
  const [lessonDesignExportError, setLessonDesignExportError] = useState("");
  const [isLessonDesignExporting, setIsLessonDesignExporting] = useState(false);
  const [selectedLessonCalendarDate, setSelectedLessonCalendarDate] = useState("");
  const [lessonCalendarDragSource, setLessonCalendarDragSource] = useState("");
  const [lessonCalendarDropTarget, setLessonCalendarDropTarget] = useState("");
  const lessonPlanDraftRef = useRef<Record<string, unknown> | null>(null);
  const lessonDesignExportRef = useRef<HTMLDivElement | null>(null);
  const deferredSearch = useDeferredValue(search);

  const model = useMemo(
    () =>
      buildClassScheduleRouteModel({
        classes: data.classes,
        textbooks: data.textbooks,
        progressLogs: data.progressLogs,
        classTerms: data.classTerms,
        syncGroups: data.syncGroups,
        syncGroupMembers: data.syncGroupMembers,
        filters: {
          search: deferredSearch,
          termId,
          subject,
          grade,
          teacher,
          selectedSyncGroupId,
        },
      }),
    [
      data.classTerms,
      data.classes,
      data.progressLogs,
      data.syncGroupMembers,
      data.syncGroups,
      data.textbooks,
      deferredSearch,
      grade,
      selectedSyncGroupId,
      subject,
      teacher,
      termId,
    ],
  );
  const allRowsModel = useMemo(
    () =>
      buildClassScheduleRouteModel({
        classes: data.classes,
        textbooks: data.textbooks,
        progressLogs: data.progressLogs,
        classTerms: data.classTerms,
        syncGroups: data.syncGroups,
        syncGroupMembers: data.syncGroupMembers,
        filters: {},
      }),
    [
      data.classTerms,
      data.classes,
      data.progressLogs,
      data.syncGroupMembers,
      data.syncGroups,
      data.textbooks,
    ],
  );

  useEffect(() => {
    if (model.rows.length === 0) {
      setSelectedClassId((current) => {
        if (current && allRowsModel.rows.some((row) => row.id === current)) {
          return current;
        }
        return allRowsModel.rows[0]?.id || "";
      });
      return;
    }

    setSelectedClassId((current) => {
      if (
        current &&
        (model.rows.some((row) => row.id === current) ||
          allRowsModel.rows.some((row) => row.id === current))
      ) {
        return current;
      }
      return model.rows.find((row) => row.warningText)?.id || model.rows[0]?.id || "";
    });
  }, [allRowsModel.rows, model.rows]);

  const syncGroupOptions = useMemo(
    () =>
      model.syncGroupCards.map((group) => ({
        value: group.id,
        label: group.name || group.id,
      })),
    [model.syncGroupCards],
  );

  const selectedRow = useMemo(
    () =>
      model.rows.find((row) => row.id === selectedClassId) ||
      allRowsModel.rows.find((row) => row.id === selectedClassId) ||
      null,
    [allRowsModel.rows, model.rows, selectedClassId],
  );

  const selectedSnapshot = useMemo(
    () => buildSelectedRowSnapshot(selectedRow, data.textbooks),
    [data.textbooks, selectedRow],
  );
  const selectedRowClassItem = useMemo(
    () => ((selectedRow?.raw || null) as Record<string, unknown> | null)?.classItem as Record<string, unknown> | null,
    [selectedRow],
  );
  const lessonPlanDefaults = useMemo(() => {
    const savedPlan = (selectedRowClassItem?.schedulePlan || selectedRowClassItem?.schedule_plan || null) as Record<string, unknown> | null;
    const rawTextbookIds = selectedRowClassItem?.textbook_ids || selectedRowClassItem?.textbookIds;
    return {
      className:
        text(savedPlan?.className || savedPlan?.class_name || selectedRowClassItem?.className || selectedRow?.title) ||
        "",
      subject: text(savedPlan?.subject || selectedRowClassItem?.subject || selectedRow?.subject) || "영어",
      schedule: text(savedPlan?.schedule || selectedRowClassItem?.schedule || selectedRow?.scheduleLabel) || "",
      startDate: text(selectedRowClassItem?.start_date || selectedRowClassItem?.startDate),
      endDate: text(selectedRowClassItem?.end_date || selectedRowClassItem?.endDate),
      textbooks: data.textbooks,
      textbookIds: Array.isArray(rawTextbookIds)
        ? rawTextbookIds.map((value) => text(value)).filter(Boolean)
        : [],
    };
  }, [data.textbooks, selectedRow, selectedRowClassItem]);
  const normalizedLessonPlan = useMemo(
    () => (lessonPlanDraft ? normalizeSchedulePlan(lessonPlanDraft, lessonPlanDefaults) : null),
    [lessonPlanDefaults, lessonPlanDraft],
  );
  const lessonPlanForSave = useMemo(
    () =>
      normalizedLessonPlan
        ? (buildSchedulePlanForSave(normalizedLessonPlan, lessonPlanDefaults) as Record<string, unknown>)
        : null,
    [lessonPlanDefaults, normalizedLessonPlan],
  );
  const lessonDesignSnapshot = useMemo(
    () => buildLessonDesignSnapshot(selectedRow, data.textbooks, lessonPlanForSave),
    [data.textbooks, lessonPlanForSave, selectedRow],
  );

  useEffect(() => {
    if (!selectedRow) {
      setLessonPlanDraft(null);
      setLessonDesignSaveError("");
      setLessonDesignSaveNotice("");
      lessonPlanDraftRef.current = null;
      return;
    }

    const savedPlan =
      ((selectedRowClassItem?.schedulePlan || selectedRowClassItem?.schedule_plan || {}) as Record<string, unknown>) || {};
    const normalizedSavedPlan = normalizeSchedulePlan(savedPlan, lessonPlanDefaults) as Record<string, unknown>;
    setLessonPlanDraft(normalizedSavedPlan);
    lessonPlanDraftRef.current = normalizedSavedPlan;
    setLessonDesignSaveError("");
    setLessonDesignSaveNotice("");
  }, [lessonPlanDefaults, selectedRow, selectedRowClassItem]);

  useEffect(() => {
    lessonPlanDraftRef.current =
      ((normalizedLessonPlan || lessonPlanDraft || null) as Record<string, unknown> | null) || null;
  }, [lessonPlanDraft, normalizedLessonPlan]);

  useEffect(() => {
    if (!lessonDesignSnapshot) {
      setSelectedLessonMonthKeys([]);
      setSelectedLessonPeriodId("all");
      setSelectedLessonScheduleState("all");
      return;
    }

    setSelectedLessonMonthKeys((current) => {
      const normalizedCurrent = normalizeSelectedLessonMonthKeys(
        current,
        lessonDesignSnapshot.monthSummaries,
      );
      if (normalizedCurrent.length > 0 || lessonDesignSnapshot.monthSummaries.length === 0) {
        return normalizedCurrent;
      }
      return getDefaultLessonMonthKeys(lessonDesignSnapshot.monthSummaries);
    });

    setSelectedLessonPeriodId((current) => {
      if (current === "all") {
        return current;
      }
      if (lessonDesignSnapshot.billingPeriods.some((period) => period.id === current)) {
        return current;
      }
      return lessonDesignSnapshot.billingPeriods[0]?.id || "all";
    });
  }, [lessonDesignSnapshot]);

  const filteredLessonSessions = useMemo(
    () => lessonDesignSnapshot?.sessions || [],
    [lessonDesignSnapshot],
  );

  const selectedLessonMonthSummaryMap = useMemo(
    () => new Map((lessonDesignSnapshot?.monthSummaries || []).map((month) => [month.key, month])),
    [lessonDesignSnapshot],
  );
  const activeLessonMonthKey =
    selectedLessonMonthKeys[0] ||
    getDefaultLessonMonthKeys(lessonDesignSnapshot?.monthSummaries || [])[0] ||
    lessonDesignSnapshot?.monthSummaries[0]?.key ||
    "";

  const selectedLessonMonthBadges = useMemo<Array<{ key: string; label: string }>>(
    () =>
      selectedLessonMonthKeys.reduce<Array<{ key: string; label: string }>>((result, monthKey) => {
        const matchedMonth = selectedLessonMonthSummaryMap.get(monthKey);
        if (matchedMonth) {
          result.push({ key: matchedMonth.key, label: matchedMonth.label });
        }
        return result;
      }, []),
    [selectedLessonMonthKeys, selectedLessonMonthSummaryMap],
  );
  const lessonScopeSummaryBadges = useMemo<Array<{ key: string; label: string }>>(() => {
    if (!lessonDesignSnapshot) {
      return [];
    }

    const badges: Array<{ key: string; label: string }> = [];
    const allMonthsSelected =
      lessonDesignSnapshot.monthSummaries.length > 0 &&
      selectedLessonMonthKeys.length === lessonDesignSnapshot.monthSummaries.length;

    badges.push({
      key: "months",
      label:
        selectedLessonMonthBadges.length === 0 || allMonthsSelected
          ? "전체 월 범위"
          : `월 ${selectedLessonMonthBadges.map((month) => month.label).join(", ")}`,
    });

    if (selectedLessonPeriodId !== "all") {
      badges.push({
        key: "period",
        label: `생성 구간 ${lessonDesignSnapshot.billingPeriods.find((period) => period.id === selectedLessonPeriodId)?.label || "선택 구간"}`,
      });
    }

    return badges;
  }, [
    lessonDesignSnapshot,
    selectedLessonMonthBadges,
    selectedLessonMonthKeys,
    selectedLessonPeriodId,
  ]);
  const lessonCalendarMonths = useMemo(
    () => buildLessonCalendarMonths(filteredLessonSessions),
    [filteredLessonSessions],
  );
  const lessonSessionGroups = useMemo(
    () => buildLessonSessionGroups(filteredLessonSessions, lessonDesignSnapshot?.billingPeriods || []),
    [filteredLessonSessions, lessonDesignSnapshot],
  );
  const lessonPreviewBadges = useMemo(
    () => buildLessonPreviewBadges(lessonSessionGroups),
    [lessonSessionGroups],
  );
  const [lessonFlowReferenceDate, setLessonFlowReferenceDate] = useState(() => new Date());

  useEffect(() => {
    const nextMidnight = new Date();
    nextMidnight.setHours(24, 0, 0, 0);
    const timeoutId = window.setTimeout(
      () => setLessonFlowReferenceDate(new Date()),
      Math.max(nextMidnight.getTime() - Date.now(), 60_000),
    );

    return () => window.clearTimeout(timeoutId);
  }, [lessonFlowReferenceDate]);

  const lessonFlowStateMap = useMemo(
    () => buildLessonFlowStateMap(lessonSessionGroups, lessonFlowReferenceDate),
    [lessonSessionGroups, lessonFlowReferenceDate],
  );

  const toggleLessonMonthKey = (monthKey: string) => {
    setSelectedLessonMonthKeys(
      normalizeSelectedLessonMonthKeys(
        [monthKey],
        lessonDesignSnapshot?.monthSummaries || [],
        { fallbackToDefault: false },
      ),
    );
    setSelectedLessonPeriodId("all");
    setSelectedLessonScheduleState("all");
  };

  const resetLessonDesignFilters = useCallback(
    (mode: "default" | "all" = "default") => {
      if (!lessonDesignSnapshot) {
        return;
      }

      setSelectedLessonMonthKeys(
        mode === "all"
          ? lessonDesignSnapshot.monthSummaries.map((month) => month.key)
          : getDefaultLessonMonthKeys(lessonDesignSnapshot.monthSummaries),
      );
      setSelectedLessonPeriodId("all");
      setSelectedLessonScheduleState("all");
    },
    [lessonDesignSnapshot],
  );

  useEffect(() => {
    if (!filteredLessonSessions.length) {
      setSelectedLessonSessionId("");
      return;
    }

    setSelectedLessonSessionId((current) => {
      if (current && filteredLessonSessions.some((session) => session.id === current)) {
        return current;
      }
      return filteredLessonSessions.find((session) => session.progressLabel !== "완료")?.id || filteredLessonSessions[0]?.id || "";
    });
  }, [filteredLessonSessions]);

  const selectedLessonSession = useMemo(
    () =>
      filteredLessonSessions.find((session) => session.id === selectedLessonSessionId) ||
      filteredLessonSessions[0] ||
      null,
    [filteredLessonSessions, selectedLessonSessionId],
  );
  useEffect(() => {
    setLessonProgressDraft(buildLessonSessionProgressDraft(text(selectedRow?.id), selectedLessonSession));
    setLessonProgressSaveError("");
    setLessonProgressSaveNotice("");
  }, [selectedLessonSession, selectedRow]);
  useEffect(() => {
    setLessonCalendarDragSource("");
    setLessonCalendarDropTarget("");
  }, [lessonDesignSnapshot]);
  useEffect(() => {
    setSelectedLessonCalendarDate("");
  }, [selectedClassId]);

  const selectedLessonSessionIndex = useMemo(
    () => filteredLessonSessions.findIndex((session) => session.id === selectedLessonSession?.id),
    [filteredLessonSessions, selectedLessonSession],
  );
  const previousLessonSession =
    selectedLessonSessionIndex > 0 ? filteredLessonSessions[selectedLessonSessionIndex - 1] || null : null;
  const nextLessonSession =
    selectedLessonSessionIndex >= 0 && selectedLessonSessionIndex < filteredLessonSessions.length - 1
      ? filteredLessonSessions[selectedLessonSessionIndex + 1] || null
      : null;
  const selectedLessonSessionGroup = useMemo(
    () =>
      lessonSessionGroups.find((group) =>
        group.sessions.some((session) => session.id === selectedLessonSession?.id),
      ) || null,
    [lessonSessionGroups, selectedLessonSession],
  );
  const selectedLessonSessionGroupIndex = useMemo(
    () =>
      selectedLessonSessionGroup?.sessions.findIndex(
        (session) => session.id === selectedLessonSession?.id,
      ) ?? -1,
    [selectedLessonSession, selectedLessonSessionGroup],
  );
  const nextLessonSessionInGroup =
    selectedLessonSessionGroup &&
    selectedLessonSessionGroupIndex >= 0 &&
    selectedLessonSessionGroupIndex < selectedLessonSessionGroup.sessions.length - 1
      ? selectedLessonSessionGroup.sessions[selectedLessonSessionGroupIndex + 1] || null
      : null;
  const lessonDesignReadinessActions = useMemo(
    () => buildLessonDesignReadinessActions(lessonDesignSnapshot, selectedLessonSession),
    [lessonDesignSnapshot, selectedLessonSession],
  );
  const updateLessonPlanDraft = useCallback(
    (updater: (current: Record<string, unknown>) => Record<string, unknown>) => {
      setLessonPlanDraft((current) => {
        const nextBase = (current || {}) as Record<string, unknown>;
        return normalizeSchedulePlan(updater(nextBase), lessonPlanDefaults) as Record<string, unknown>;
      });
      setLessonDesignSaveError("");
      setLessonDesignSaveNotice("");
    },
    [lessonPlanDefaults],
  );
  const buildNextLessonPlanDraft = useCallback(
    (updater: (current: Record<string, unknown>) => Record<string, unknown>) => {
      const nextBase = (lessonPlanDraftRef.current || {}) as Record<string, unknown>;
      return normalizeSchedulePlan(updater(nextBase), lessonPlanDefaults) as Record<string, unknown>;
    },
    [lessonPlanDefaults],
  );
  const syncLessonDesignDraftSnapshot = useCallback(
    (
      nextDraft: Record<string, unknown>,
      options: {
        targetDate?: string;
        sourceDate?: string;
        preferScheduleState?: string;
      } = {},
    ) => {
      setLessonPlanDraft(nextDraft);
      lessonPlanDraftRef.current = nextDraft;
      setLessonDesignSaveError("");
      setLessonDesignSaveNotice("");

      const nextPlanForSave = buildSchedulePlanForSave(nextDraft, lessonPlanDefaults) as Record<string, unknown>;
      const nextLessonDesignSnapshot = buildLessonDesignSnapshot(selectedRow, data.textbooks, nextPlanForSave);
      const focusTargetDate = text(options.targetDate);
      const focusSourceDate = text(options.sourceDate);
      const nextFocusedSession =
        findLessonDesignSessionByDate(nextLessonDesignSnapshot, focusTargetDate, {
          preferOriginalDate: focusSourceDate,
          preferScheduleState: options.preferScheduleState,
        }) ||
        findLessonDesignSessionByDate(nextLessonDesignSnapshot, focusSourceDate, {
          preferScheduleState: options.preferScheduleState,
        });

      if (nextFocusedSession?.monthKey) {
        setSelectedLessonMonthKeys(
          normalizeSelectedLessonMonthKeys(
            [nextFocusedSession.monthKey],
            nextLessonDesignSnapshot?.monthSummaries || [],
          ),
        );
      }
      setSelectedLessonPeriodId("all");
      setSelectedLessonScheduleState("all");
      if (nextFocusedSession?.id) {
        setSelectedLessonSessionId(nextFocusedSession.id);
      }
    },
    [data.textbooks, lessonPlanDefaults, selectedRow],
  );
  const handleLessonProgressSharedFieldChange = useCallback(
    (field: "content" | "homework", value: string) => {
      setLessonProgressDraft((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          [field]: value,
        };
      });
      setLessonProgressSaveError("");
      setLessonProgressSaveNotice("");
    },
    [],
  );
  const handleLessonProgressEntryChange = useCallback(
    (textbookId: string, field: "status" | "rangeLabel" | "publicNote" | "teacherNote", value: string) => {
      setLessonProgressDraft((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          entries: current.entries.map((entry) =>
            entry.textbookId === textbookId
              ? {
                  ...entry,
                  [field]: field === "status" ? normalizeLessonProgressStatus(value) : value,
                }
              : entry,
          ),
        };
      });
      setLessonProgressSaveError("");
      setLessonProgressSaveNotice("");
    },
    [],
  );
  const handleSaveLessonProgress = useCallback(async () => {
    if (!selectedRow || !selectedLessonSession || !lessonProgressDraft || !supabase) {
      return;
    }

    setIsLessonProgressSaving(true);
    setLessonProgressSaveError("");
    setLessonProgressSaveNotice("");

    try {
      const sharedDraft = {
        content: text(lessonProgressDraft.content),
        homework: text(lessonProgressDraft.homework),
      };
      const payloads = lessonProgressDraft.entries
        .filter((entry) => !isLessonSessionProgressEntryEmpty(entry, sharedDraft))
        .map((entry) => ({
          class_id: text(selectedRow.id),
          session_id: text(selectedLessonSession.id),
          session_order: Number(selectedLessonSession.sessionNumber || 0),
          textbook_id: text(entry.textbookId) || null,
          progress_key: buildLessonSessionProgressKey(
            text(selectedRow.id),
            text(selectedLessonSession.id),
            text(entry.textbookId),
          ),
          status: normalizeLessonProgressStatus(entry.status),
          range_label: text(entry.rangeLabel) || null,
          public_note: text(entry.publicNote) || null,
          teacher_note: text(entry.teacherNote) || null,
          content: sharedDraft.content || null,
          homework: sharedDraft.homework || null,
          date: text(selectedLessonSession.dateValue) || null,
          updated_at: new Date().toISOString(),
        }));
      const deleteKeys = lessonProgressDraft.entries
        .filter((entry) => isLessonSessionProgressEntryEmpty(entry, sharedDraft))
        .map((entry) => text(entry.progressKey))
        .filter(Boolean);

      for (const payload of payloads) {
        await upsertLessonProgressLog(payload);
      }
      for (const progressKey of deleteKeys) {
        const matchedEntry = lessonProgressDraft.entries.find((entry) => text(entry.progressKey) === progressKey);
        await deleteLessonProgressLog({
          progressKey,
          classId: text(selectedRow.id),
          sessionId: text(selectedLessonSession.id),
          textbookId: text(matchedEntry?.textbookId),
        });
      }

      await refresh();
      setLessonProgressSaveNotice("실진도 기록을 저장했습니다.");
    } catch (progressSaveError) {
      setLessonProgressSaveError(
        progressSaveError instanceof Error
          ? progressSaveError.message
          : "실진도 기록 저장에 실패했습니다.",
      );
    } finally {
      setIsLessonProgressSaving(false);
    }
  }, [lessonProgressDraft, refresh, selectedLessonSession, selectedRow]);
  const selectedLessonSessionDraftDate = resolveLessonSessionDraftDate(selectedLessonSession);
  const selectedLessonSessionDraftStateEntry = useMemo(() => {
    if (!selectedLessonSessionDraftDate || !normalizedLessonPlan) {
      return null;
    }

    const sessionStates = ((normalizedLessonPlan.sessionStates || {}) as Record<string, unknown>) || {};
    return (sessionStates[selectedLessonSessionDraftDate] || null) as Record<string, unknown> | null;
  }, [normalizedLessonPlan, selectedLessonSessionDraftDate]);
  const selectedLessonSessionEditableState = getLessonSessionDraftState(
    selectedLessonSession,
    selectedLessonSessionDraftStateEntry,
  );
  const selectedLessonSessionEditableMemo = getLessonSessionEditableMemo(
    selectedLessonSession,
    selectedLessonSessionDraftStateEntry,
  );
  const selectedLessonSessionEditableMakeupDate = getLessonSessionDraftMakeupDate(
    selectedLessonSession,
    selectedLessonSessionDraftStateEntry,
  );
  const selectedLessonSessionEditableIsForced = getLessonSessionDraftIsForced(
    selectedLessonSession,
    selectedLessonSessionDraftStateEntry,
  );
  const handleLessonSessionStateChange = useCallback(
    (session: (typeof selectedLessonSession), nextState: "active" | "exception" | "makeup" | "tbd") => {
      const sessionDate = resolveLessonSessionDraftDate(session);
      if (!sessionDate) {
        return;
      }
      const isMakeupSession = text(session?.scheduleState) === "makeup";

      updateLessonPlanDraft((current) => {
        const sessionStates = ((current.sessionStates || {}) as Record<string, unknown>) || {};
        const currentState = (sessionStates[sessionDate] || null) as Record<string, unknown> | null;
        return applyLessonSessionStateChange(current, sessionDate, {
          nextState: isMakeupSession && nextState === "makeup" ? "exception" : nextState,
          memo: isMakeupSession ? text(currentState?.memo) : getLessonSessionDraftMemo(session, currentState),
          makeupMemo: getLessonSessionDraftMakeupMemo(session, currentState),
          makeupDate: getLessonSessionDraftMakeupDate(session, currentState),
          isForced: getLessonSessionDraftIsForced(session, currentState),
        });
      });
    },
    [updateLessonPlanDraft],
  );
  const handleLessonSessionStateCycle = useCallback(
    (session: (typeof selectedLessonSession)) => {
      if (!session || session.scheduleState === "force_active") {
        return;
      }
      const sessionDate = resolveLessonSessionDraftDate(session);
      if (!sessionDate) {
        return;
      }

      updateLessonPlanDraft((current) => {
        const sessionStates = ((current.sessionStates || {}) as Record<string, unknown>) || {};
        const currentState = (sessionStates[sessionDate] || null) as Record<string, unknown> | null;
        const currentScheduleState = getLessonSessionDraftState(session, currentState);
        return applyLessonSessionStateChange(current, sessionDate, {
          nextState: getNextRegularScheduleState(currentScheduleState),
          memo: getLessonSessionDraftMemo(session, currentState),
          makeupMemo: getLessonSessionDraftMakeupMemo(session, currentState),
          makeupDate: getLessonSessionDraftMakeupDate(session, currentState),
          isForced: false,
        });
      });
      setSelectedLessonSessionId(text(session.id));
    },
    [updateLessonPlanDraft],
  );
  const handleLessonSessionMemoChange = useCallback(
    (session: (typeof selectedLessonSession), nextMemo: string) => {
      const sessionDate = resolveLessonSessionDraftDate(session);
      if (!sessionDate) {
        return;
      }

      updateLessonPlanDraft((current) => {
        const sessionStates = ((current.sessionStates || {}) as Record<string, unknown>) || {};
        const currentState = (sessionStates[sessionDate] || null) as Record<string, unknown> | null;
        const isMakeupSession = text(session?.scheduleState) === "makeup";
        return applyLessonSessionStateChange(current, sessionDate, {
          nextState: isMakeupSession ? "exception" : getLessonSessionDraftState(session, currentState),
          memo: isMakeupSession ? text(currentState?.memo) : nextMemo,
          makeupMemo: isMakeupSession ? nextMemo : getLessonSessionDraftMakeupMemo(session, currentState),
          makeupDate: getLessonSessionDraftMakeupDate(session, currentState),
          isForced: getLessonSessionDraftIsForced(session, currentState),
        });
      });
    },
    [updateLessonPlanDraft],
  );
  const handleLessonSessionMakeupDateDirectChange = useCallback(
    (session: (typeof selectedLessonSession), nextMakeupDate: string) => {
      const sessionDate = resolveLessonSessionDraftDate(session);
      if (!sessionDate) {
        return;
      }

      updateLessonPlanDraft((current) => {
        const sessionStates = ((current.sessionStates || {}) as Record<string, unknown>) || {};
        const currentState = (sessionStates[sessionDate] || null) as Record<string, unknown> | null;
        return applyLessonSessionStateChange(current, sessionDate, {
          nextState: text(nextMakeupDate) ? "exception" : getLessonSessionDraftState(session, currentState),
          memo: getLessonSessionDraftMemo(session, currentState),
          makeupMemo: getLessonSessionDraftMakeupMemo(session, currentState),
          makeupDate: nextMakeupDate,
          isForced: getLessonSessionDraftIsForced(session, currentState),
        });
      });
    },
    [updateLessonPlanDraft],
  );
  const handleLessonSessionSubstitution = useCallback(
    (session: (typeof selectedLessonSession), targetDate: string) => {
      const sessionDate = resolveLessonSessionDraftDate(session);
      if (!sessionDate || !targetDate) {
        return;
      }

      updateLessonPlanDraft((current) =>
        applyCalendarDateSubstitution(current, sessionDate, targetDate) as Record<string, unknown>,
      );
    },
    [updateLessonPlanDraft],
  );
  const handleLessonSessionClearSubstitution = useCallback(
    (session: (typeof selectedLessonSession)) => {
      const sessionDate = resolveLessonSessionDraftDate(session);
      if (!sessionDate) {
        return;
      }

      updateLessonPlanDraft((current) => {
        const sessionStates = ((current.sessionStates || {}) as Record<string, unknown>) || {};
        const currentState = (sessionStates[sessionDate] || null) as Record<string, unknown> | null;
        return applyLessonSessionStateChange(current, sessionDate, {
          nextState: "exception",
          memo: getLessonSessionDraftMemo(session, currentState),
          makeupMemo: getLessonSessionDraftMakeupMemo(session, currentState),
          makeupDate: "",
          isForced: false,
        });
      });
    },
    [updateLessonPlanDraft],
  );
  const handleLessonCalendarSelect = useCallback(
    (dateKey: string) => {
      if (!dateKey) {
        return;
      }

      setSelectedLessonCalendarDate(dateKey);

      if (!lessonDesignSnapshot) {
        return;
      }

      const nextFocusedSession = findLessonDesignSessionByDate(lessonDesignSnapshot, dateKey);
      const nextMonthKey = nextFocusedSession?.monthKey || buildLessonMonthKey(dateKey);
      if (nextMonthKey) {
        setSelectedLessonMonthKeys(
          normalizeSelectedLessonMonthKeys([nextMonthKey], lessonDesignSnapshot.monthSummaries || []),
        );
      }
      setSelectedLessonPeriodId("all");
      setSelectedLessonScheduleState("all");
      if (nextFocusedSession?.id) {
        setSelectedLessonSessionId(nextFocusedSession.id);
        setLessonMonthDetailsOpen(true);
        scrollLessonDesignSelectedSessionEditorAfterRender();
      }
    },
    [lessonDesignSnapshot],
  );
  const handleLessonCalendarToggle = useCallback(
    (dateKey: string, meta: { hasSession: boolean; hasBaseSession: boolean; isMakeup: boolean }) => {
      if (!dateKey || meta.isMakeup) {
        return;
      }

      let preferredScheduleState = meta.hasSession ? "exception" : "force_active";
      const nextDraft = buildNextLessonPlanDraft((current) => {
        const sessionStates = (((current.sessionStates || {}) as Record<string, unknown>) || {}) as Record<
          string,
          Record<string, unknown>
        >;
        const currentStateEntry = sessionStates[dateKey] || {};
        const currentScheduleState = text(currentStateEntry.state) || (meta.hasSession ? "active" : "");
        preferredScheduleState = meta.hasSession
          ? getNextRegularScheduleState(currentScheduleState, Boolean(currentStateEntry.makeupDate))
          : "force_active";
        return applyCalendarDateToggle(current, dateKey, meta) as Record<string, unknown>;
      });
      syncLessonDesignDraftSnapshot(nextDraft, {
        targetDate: dateKey,
        preferScheduleState: preferredScheduleState,
      });
      setSelectedLessonCalendarDate(dateKey);
      setLessonMonthDetailsOpen(true);
      scrollLessonDesignSelectedSessionEditorAfterRender();
    },
    [buildNextLessonPlanDraft, syncLessonDesignDraftSnapshot],
  );
  const handleLessonCalendarDrop = useCallback(
    (targetDate: string, meta: { hasSession: boolean }) => {
      if (
        meta.hasSession ||
        !lessonCalendarDragSource ||
        !targetDate ||
        lessonCalendarDragSource === targetDate
      ) {
        setLessonCalendarDropTarget("");
        return;
      }

      const sourceDate = lessonCalendarDragSource;
      const nextDraft = buildNextLessonPlanDraft((current) =>
        applyCalendarDateSubstitution(current, sourceDate, targetDate) as Record<string, unknown>,
      );

      setLessonCalendarDragSource("");
      setLessonCalendarDropTarget("");
      setSelectedLessonCalendarDate(sourceDate);
      syncLessonDesignDraftSnapshot(nextDraft, {
        sourceDate,
        targetDate,
        preferScheduleState: "makeup",
      });
    },
    [buildNextLessonPlanDraft, lessonCalendarDragSource, syncLessonDesignDraftSnapshot],
  );
  const handleLessonCalendarDateClick = useCallback(
    (
      dateKey: string,
      meta: { hasSession: boolean; hasBaseSession: boolean; isMakeup: boolean },
    ) => {
      if (!dateKey) {
        return;
      }

      if (selectedLessonCalendarDate !== dateKey) {
        handleLessonCalendarSelect(dateKey);
        return;
      }

      handleLessonCalendarToggle(dateKey, meta);
    },
    [handleLessonCalendarSelect, handleLessonCalendarToggle, selectedLessonCalendarDate],
  );
  const handleLessonPeriodChange = useCallback(
    (periodId: string, field: "startDate" | "endDate", value: string) => {
      updateLessonPlanDraft((current) => {
        const billingPeriods = Array.isArray(current.billingPeriods)
          ? (current.billingPeriods as Record<string, unknown>[])
          : [];
        return {
          ...current,
          billingPeriods: billingPeriods.map((period) => {
            if (text(period.id) !== periodId) {
              return period;
            }
            const nextPeriod = { ...period, [field]: value };
            if (field === "startDate") {
              nextPeriod.endDate =
                text(nextPeriod.endDate) ||
                computeAutoEndDate(
                  value,
                  Array.isArray(current.selectedDays) ? (current.selectedDays as Array<string | number>) : [],
                  Number(current.globalSessionCount || 0),
                );
            }
            return nextPeriod;
          }),
        };
      });
    },
    [updateLessonPlanDraft],
  );
  const handleAddLessonPeriod = useCallback(() => {
    updateLessonPlanDraft((current) => {
      const billingPeriods = Array.isArray(current.billingPeriods)
        ? [...(current.billingPeriods as Record<string, unknown>[])]
        : [];
      const lastPeriod = billingPeriods[billingPeriods.length - 1] || null;
      const startDate = getSuggestedNextStartDate(
        text(lastPeriod?.endDate || lastPeriod?.end_date),
        Array.isArray(current.selectedDays) ? (current.selectedDays as Array<string | number>) : [],
      );
      const endDate = computeAutoEndDate(
        startDate,
        Array.isArray(current.selectedDays) ? (current.selectedDays as Array<string | number>) : [],
        Number(current.globalSessionCount || 0),
      );
      const nextPeriodIndex = billingPeriods.length + 1;
      billingPeriods.push({
        id: `period-${Date.now()}-${nextPeriodIndex}`,
        month: nextPeriodIndex,
        label: `${nextPeriodIndex}월`,
        startDate,
        endDate,
      });
      return {
        ...current,
        billingPeriods,
      };
    });
  }, [updateLessonPlanDraft]);
  const handleRemoveLessonPeriod = useCallback(
    (periodId: string) => {
      updateLessonPlanDraft((current) => {
        const billingPeriods = Array.isArray(current.billingPeriods)
          ? (current.billingPeriods as Record<string, unknown>[])
          : [];
        return {
          ...current,
          billingPeriods: billingPeriods.filter((period) => text(period.id) !== periodId),
        };
      });
    },
    [updateLessonPlanDraft],
  );
  const handleLessonTextbookPlanChange = useCallback(
    (
      sessionId: string,
      entryId: string,
      field: "start" | "end" | "label" | "memo",
      value: string,
    ) => {
      if (!sessionId || !entryId) {
        return;
      }

      updateLessonPlanDraft((current) => {
        const sessions = Array.isArray(current.sessions)
          ? (current.sessions as Record<string, unknown>[])
          : [];

        return {
          ...current,
          sessions: sessions.map((session) => {
            if (text(session.id) !== sessionId) {
              return session;
            }

            const textbookEntries = Array.isArray(session.textbookEntries)
              ? (session.textbookEntries as Record<string, unknown>[])
              : [];

            return {
              ...session,
              textbookEntries: textbookEntries.map((entry, index) => {
                const resolvedEntryId = text(entry.id) || `${text(entry.textbookId || entry.textbook_id || entry.id) || "textbook"}-${index}`;
                if (resolvedEntryId !== entryId) {
                  return entry;
                }

                return {
                  ...entry,
                  plan: {
                    ...((entry.plan || {}) as Record<string, unknown>),
                    [field]: value,
                  },
                };
              }),
            };
          }),
        };
      });
    },
    [updateLessonPlanDraft],
  );
  const handleSaveLessonPlan = useCallback(async () => {
    if (!selectedRow || !lessonPlanForSave || !supabase) {
      return;
    }

    setIsLessonDesignSaving(true);
    setLessonDesignSaveError("");
    setLessonDesignSaveNotice("");

    try {
      const { error: updateError } = await supabase
        .from("classes")
        .update({ schedule_plan: lessonPlanForSave })
        .eq("id", text(selectedRow.id));

      if (updateError) {
        throw updateError;
      }

      await refresh();
      setLessonDesignSaveNotice("수업계획을 저장했습니다.");
    } catch (saveError) {
      setLessonDesignSaveError(
        saveError instanceof Error ? saveError.message : "수업계획 저장에 실패했습니다.",
      );
    } finally {
      setIsLessonDesignSaving(false);
    }
  }, [lessonPlanForSave, refresh, selectedRow]);
  const openLessonDesignForRow = useCallback(
    (
      row: Record<string, unknown> | null,
      options: { sessionId?: string } = {},
    ) => {
      if (!row) {
        return;
      }

      const nextLessonDesignSnapshot = buildLessonDesignSnapshot(row, data.textbooks);
      if (!nextLessonDesignSnapshot) {
        return;
      }

      setLessonDesignExportError("");
      setSelectedClassId(text(row.id));
      const targetSession =
        nextLessonDesignSnapshot.sessions.find((session) => session.id === options.sessionId) || null;
      setSelectedLessonMonthKeys(
        getDefaultLessonMonthKeys(nextLessonDesignSnapshot.monthSummaries),
      );
      setSelectedLessonPeriodId("all");
      setSelectedLessonScheduleState("all");
      setSelectedLessonSessionId(
        targetSession?.id ||
          nextLessonDesignSnapshot.sessions.find((session) => session.progressLabel !== "완료")?.id ||
          nextLessonDesignSnapshot.sessions[0]?.id ||
          "",
      );
      setLessonDesignOpen(true);
    },
    [data.textbooks],
  );

  const openLessonDesignPageForRow = useCallback(
    (
      row: Record<string, unknown> | null,
      sessionId: string = "",
      sectionId: string = "",
    ) => {
      if (!row) {
        return;
      }

      const resolvedSessionId = text(sessionId);
      const targetSectionId =
        resolveLessonDesignSectionId(sectionId) ||
        (resolvedSessionId ? LESSON_DESIGN_SECTION_IDS.board : LESSON_DESIGN_SECTION_IDS.periods);

      router.push(buildLessonDesignPageHref(row, resolvedSessionId, targetSectionId), {
        scroll: false,
      });
    },
    [router],
  );

  const isLessonDesignPage = pathname.endsWith("/lesson-design");
  const requestedSessionId = text(searchParams.get("sessionId"));
  const requestedLessonDesignSectionId = resolveLessonDesignSectionId(text(searchParams.get("section")));
  const requestedLessonMonthKeys = text(searchParams.get("lessonMonths"))
    .split(",")
    .map((value) => text(value))
    .filter(Boolean);
  const requestedLessonPeriodId = text(searchParams.get("lessonPeriod")) || "all";
  const requestedLessonScheduleState = resolveLessonDesignScheduleState(
    text(searchParams.get("lessonScheduleState")),
  );
  const lastScrolledLessonDesignSectionKeyRef = useRef("");

  const closeLessonDesignWorkspace = useCallback(() => {
    setLessonDesignOpen(false);
    setLessonDesignExportError("");
    router.replace(
      buildCurriculumWorkspaceHref(new URLSearchParams(searchParams.toString())),
      { scroll: false },
    );
  }, [router, searchParams]);

  const navigateToLessonDesignSection = useCallback(
    (
      sectionId: string,
      row: Record<string, unknown> | null = selectedRow,
      sessionId: string = text(selectedLessonSession?.id),
    ) => {
      const resolvedSectionId = resolveLessonDesignSectionId(sectionId);
      if (!resolvedSectionId) {
        return;
      }

      const resolvedSessionId = text(sessionId);
      if (isLessonDesignPage && row) {
        router.replace(buildLessonDesignPageHref(row, resolvedSessionId, resolvedSectionId), {
          scroll: false,
        });
      }

      scrollLessonDesignSection(resolvedSectionId);
    },
    [isLessonDesignPage, router, selectedLessonSession, selectedRow],
  );

  const focusLessonDesignSession = useCallback(
    (
      sessionId: string,
      {
        row = selectedRow,
        sectionId = LESSON_DESIGN_SECTION_IDS.calendar,
      }: {
        row?: Record<string, unknown> | null;
        sectionId?: string;
      } = {},
    ) => {
      const resolvedSessionId = text(sessionId);
      if (!resolvedSessionId) {
        return;
      }

      const targetRow = row || selectedRow;
      const targetSectionId = resolveLessonDesignSectionId(sectionId) || LESSON_DESIGN_SECTION_IDS.calendar;
      const scopedSession =
        lessonDesignSnapshot?.sessions.find((session) => session.id === resolvedSessionId) ||
        filteredLessonSessions.find((session) => session.id === resolvedSessionId) ||
        null;

      if (scopedSession?.monthKey) {
        setSelectedLessonMonthKeys([scopedSession.monthKey]);
      }
      setSelectedLessonPeriodId("all");
      setLessonMonthDetailsOpen(true);

      setSelectedLessonSessionId(resolvedSessionId);
      navigateToLessonDesignSection(targetSectionId, targetRow, resolvedSessionId);
      if (targetSectionId === LESSON_DESIGN_SECTION_IDS.periods) {
        scrollLessonDesignSelectedSessionEditorAfterRender();
      }
    },
    [filteredLessonSessions, lessonDesignSnapshot, navigateToLessonDesignSection, selectedRow],
  );

  useEffect(() => {
    if (!isLessonDesignPage || !lessonDesignSnapshot || lessonDesignOpen) {
      return;
    }

    const shouldSyncLessonMonths =
      searchParams.has("lessonMonths") &&
      !areSameLessonMonthSelection(
        normalizeSelectedLessonMonthKeys(
          requestedLessonMonthKeys,
          lessonDesignSnapshot.monthSummaries,
          { fallbackToDefault: false },
        ),
        selectedLessonMonthKeys,
      );
    const shouldSyncLessonPeriod =
      searchParams.has("lessonPeriod") &&
      requestedLessonPeriodId !== selectedLessonPeriodId &&
      lessonDesignSnapshot.billingPeriods.some((period) => period.id === requestedLessonPeriodId);
    const shouldSyncLessonScheduleState =
      searchParams.has("lessonScheduleState") &&
      requestedLessonScheduleState !== selectedLessonScheduleState;

    if (!shouldSyncLessonMonths && !shouldSyncLessonPeriod && !shouldSyncLessonScheduleState) {
      return;
    }

    if (shouldSyncLessonMonths) {
      setSelectedLessonMonthKeys(
        normalizeSelectedLessonMonthKeys(
          requestedLessonMonthKeys,
          lessonDesignSnapshot.monthSummaries,
          { fallbackToDefault: false },
        ),
      );
    }
    if (shouldSyncLessonPeriod) {
      setSelectedLessonPeriodId(requestedLessonPeriodId);
    }
    if (shouldSyncLessonScheduleState) {
      setSelectedLessonScheduleState(requestedLessonScheduleState);
    }
  }, [
    isLessonDesignPage,
    lessonDesignSnapshot,
    requestedLessonMonthKeys,
    requestedLessonPeriodId,
    requestedLessonScheduleState,
    searchParams,
    selectedLessonMonthKeys,
    selectedLessonPeriodId,
    selectedLessonScheduleState,
  ]);

  useEffect(() => {
    if (!isLessonDesignPage || !lessonDesignSnapshot || !requestedLessonDesignSectionId) {
      if (!requestedLessonDesignSectionId) {
        lastScrolledLessonDesignSectionKeyRef.current = "";
      }
      return;
    }

    const scrollKey = [text(selectedRow?.id), text(selectedLessonSession?.id), requestedLessonDesignSectionId].join(":");
    if (lastScrolledLessonDesignSectionKeyRef.current === scrollKey) {
      return;
    }
    lastScrolledLessonDesignSectionKeyRef.current = scrollKey;

    const animationFrameId = window.requestAnimationFrame(() => {
      scrollLessonDesignSection(requestedLessonDesignSectionId);
    });

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [
    isLessonDesignPage,
    lessonDesignSnapshot,
    requestedLessonDesignSectionId,
    selectedLessonSession,
    selectedRow,
  ]);

  const handleLessonDesignOpenChange = useCallback((open: boolean) => {
    setLessonDesignOpen(open);
    if (!open) {
      closeLessonDesignWorkspace();
    }
  }, [closeLessonDesignWorkspace]);

  const handleExportLessonDesign = useCallback(async () => {
    if (!lessonDesignExportRef.current || !lessonDesignSnapshot) {
      return;
    }

    setIsLessonDesignExporting(true);
    setLessonDesignExportError("");

    try {
      await exportElementAsImage(
        lessonDesignExportRef.current,
        buildLessonDesignExportFilename(selectedRow, selectedLessonSession),
        {
          preset: "a4-landscape",
          backgroundColor: "#ffffff",
        },
      );
    } catch {
      setLessonDesignExportError("이미지 저장에 실패했습니다. 브라우저 렌더 상태를 다시 확인해 주세요.");
    } finally {
      setIsLessonDesignExporting(false);
    }
  }, [lessonDesignSnapshot, selectedLessonSession, selectedRow]);

  useEffect(() => {
  
  if (loading) {
      return;
    }

    const requestedClassId = text(searchParams.get("classId"));
    const requestedSessionId = text(searchParams.get("sessionId"));
    const shouldOpenLessonDesign =
      searchParams.get("lessonDesign") === "1" || pathname.endsWith("/lesson-design");
    if (!shouldOpenLessonDesign) {
      return;
    }

    const nextParams = clearLessonDesignSearchParams(new URLSearchParams(searchParams.toString()));
    const nextQuery = nextParams.toString();

    if (!requestedClassId) {
      router.replace(
        isLessonDesignPage
          ? buildClassScheduleWorkspaceHref(nextParams)
          : nextQuery
            ? `${pathname}?${nextQuery}`
            : pathname,
        { scroll: false },
      );
      return;
    }

    const targetRow = allRowsModel.rows.find((row) => row.id === requestedClassId) || null;
    if (!targetRow) {
      router.replace(
        isLessonDesignPage
          ? buildClassScheduleWorkspaceHref(nextParams)
          : nextQuery
            ? `${pathname}?${nextQuery}`
            : pathname,
        { scroll: false },
      );
      return;
    }

    const targetSectionId =
      requestedLessonDesignSectionId ||
      (requestedSessionId ? LESSON_DESIGN_SECTION_IDS.calendar : LESSON_DESIGN_SECTION_IDS.periods);

    if (!isLessonDesignPage) {
      router.replace(buildLessonDesignPageHref(targetRow, requestedSessionId || "", targetSectionId), {
        scroll: false,
      });
      return;
    }

    if (lessonDesignOpen && selectedClassId === requestedClassId) {
      return;
    }

    openLessonDesignForRow(targetRow, { sessionId: requestedSessionId || undefined });
  }, [
    allRowsModel.rows,
    lessonDesignOpen,
    loading,
    openLessonDesignForRow,
    isLessonDesignPage,
    pathname,
    router,
    searchParams,
    requestedLessonDesignSectionId,
    selectedClassId,
    selectedLessonSessionId,
  ]);

  useEffect(() => {
    if (!isLessonDesignPage || !lessonDesignOpen || !requestedSessionId) {
      return;
    }

    const matchedRequestedSession =
      filteredLessonSessions.find((session) => session.id === requestedSessionId) || null;
    if (!matchedRequestedSession || selectedLessonSessionId === requestedSessionId) {
      return;
    }

    setSelectedLessonSessionId(requestedSessionId);
  }, [
    filteredLessonSessions,
    isLessonDesignPage,
    lessonDesignOpen,
    requestedSessionId,
    selectedLessonSessionId,
  ]);

  useEffect(() => {
    if (loading) {
      return;
    }

    const currentParams = new URLSearchParams(searchParams.toString());

    if (lessonDesignOpen && selectedRow) {
      const defaultLessonMonthKeys = lessonDesignSnapshot
        ? getDefaultLessonMonthKeys(lessonDesignSnapshot.monthSummaries)
        : [];
      const nextParams = buildLessonDesignSearchParams({
        currentParams,
        classId: text(selectedRow.id),
        sessionId: "",
        monthKeys:
          isLessonDesignPage &&
          lessonDesignSnapshot &&
          !areSameLessonMonthSelection(selectedLessonMonthKeys, defaultLessonMonthKeys)
            ? selectedLessonMonthKeys
            : [],
        periodId: isLessonDesignPage ? selectedLessonPeriodId : "all",
        scheduleState: isLessonDesignPage ? selectedLessonScheduleState : "all",
        status: "all",
      });
      const nextQuery = nextParams.toString();
      if (nextQuery !== currentParams.toString()) {
        router.replace(`${pathname}?${nextQuery}`, { scroll: false });
      }
      return;
    }

    if (currentParams.get("lessonDesign") === "1") {
      return;
    }

    if (
      currentParams.has("lessonDesign") ||
      currentParams.has("classId") ||
      currentParams.has("sessionId")
    ) {
      const nextParams = clearLessonDesignSearchParams(currentParams);
      const nextQuery = nextParams.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    }
  }, [
    isLessonDesignPage,
    lessonDesignOpen,
    loading,
    pathname,
    router,
    searchParams,
    selectedLessonMonthKeys,
    selectedLessonPeriodId,
    selectedLessonScheduleState,
    selectedLessonSession,
    selectedRow,
  ]);

  const lessonDesignTitle = selectedRow?.title || "수업 설계";
  const lessonDesignDescription = selectedRow
    ? `${selectedRow.termName || "학기 미정"} · ${selectedRow.teacher || "선생님 미정"}`
    : "수업 설계";

  const lessonDesignSnapshotSafe = lessonDesignSnapshot as NonNullable<typeof lessonDesignSnapshot>;
  const renderLessonMonthSessionDetails = (sessions: typeof filteredLessonSessions) => (
    <div className="mt-3 border-t">
      <div className="space-y-2 px-2 py-3">
        {sessions.length > 0 ? (
          sessions.map((session) => {
            const isSelectedSession = selectedLessonSession?.id === session.id;
            return (
              <div
                key={`month-session-edit-${session.id}`}
                id={isSelectedSession ? LESSON_DESIGN_SELECTED_SESSION_EDITOR_ID : undefined}
                className={cn(
                  "overflow-hidden rounded-[1rem] border bg-background",
                  isSelectedSession && "border-primary/50 shadow-sm",
                )}
              >
                <button
                  type="button"
                  aria-pressed={isSelectedSession}
                  className={cn(
                    "flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/30",
                    isSelectedSession && "bg-primary/5",
                  )}
                  onPointerDown={() => setSelectedLessonSessionId(session.id)}
                  onClick={() => setSelectedLessonSessionId(session.id)}
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-foreground">{session.label}</span>
                      <span className="text-xs text-muted-foreground">{session.dateLabel}</span>
                    </span>
                    {session.scheduleConnectionLabel ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {session.scheduleConnectionLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={getScheduleStateTone(session.scheduleState)}>
                      {session.scheduleStateLabel}
                    </Badge>
                    {session.textbookEntries.length > 0 ? (
                      <Badge variant="outline">{session.textbookEntryLabel}</Badge>
                    ) : null}
                  </span>
                </button>

                {isSelectedSession && selectedLessonSession ? (
                  <div className="border-t bg-background px-3 py-3">
                    <div className="grid grid-cols-4 gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          selectedLessonSessionEditableState === "active" ||
                          selectedLessonSessionEditableState === "force_active"
                            ? "default"
                            : "outline"
                        }
                        onClick={() => handleLessonSessionStateChange(selectedLessonSession, "active")}
                      >
                        정상
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={selectedLessonSessionEditableState === "exception" ? "destructive" : "outline"}
                        onClick={() => handleLessonSessionStateChange(selectedLessonSession, "exception")}
                      >
                        휴강
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={selectedLessonSessionEditableState === "makeup" ? "default" : "outline"}
                        onClick={() => handleLessonSessionStateChange(selectedLessonSession, "makeup")}
                      >
                        보강
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={selectedLessonSessionEditableState === "tbd" ? "secondary" : "outline"}
                        onClick={() => handleLessonSessionStateChange(selectedLessonSession, "tbd")}
                      >
                        미정
                      </Button>
                    </div>

                    <div className="mt-3 grid gap-2">
                      <Textarea
                        value={selectedLessonSessionEditableMemo}
                        onChange={(event) => handleLessonSessionMemoChange(selectedLessonSession, event.target.value)}
                        placeholder="메모"
                        aria-label={`${selectedLessonSession.label} 메모`}
                        rows={1}
                        className="h-9 min-h-9 resize-none overflow-hidden py-2"
                      />
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                          <span>보강일</span>
                          <Input
                            type="date"
                            value={selectedLessonSessionEditableMakeupDate}
                            aria-label={`${selectedLessonSession.label} 보강일`}
                            onChange={(event) =>
                              handleLessonSessionMakeupDateDirectChange(selectedLessonSession, event.target.value)
                            }
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleLessonSessionSubstitution(
                                selectedLessonSession,
                                selectedLessonSessionEditableMakeupDate,
                              )
                            }
                            disabled={!selectedLessonSessionEditableMakeupDate}
                          >
                            보강 적용
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleLessonSessionClearSubstitution(selectedLessonSession)}
                          >
                            보강 해제
                          </Button>
                        </div>
                      </div>
                    </div>

                    {selectedLessonSession.textbookEntries.length > 0 ? (
                      <div className="mt-3 rounded-[1rem] border bg-muted/10 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">계획 범위 편집</p>
                          <Badge variant="outline">{selectedLessonSession.textbookEntries.length}개 교재</Badge>
                        </div>
                        <div className="mt-3 space-y-3">
                          {selectedLessonSession.textbookEntries.map((entry) => (
                            <div
                              key={`plan-editor-${selectedLessonSession.id}-${entry.id}`}
                              className="rounded-[0.9rem] border bg-background p-3"
                            >
                              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-medium text-foreground">{entry.textbookTitle}</p>
                                <Badge variant="outline">{entry.planLabel || "표시 문구 없음"}</Badge>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                                  <span>시작 범위</span>
                                  <Input
                                    value={entry.planStart}
                                    onChange={(event) =>
                                      handleLessonTextbookPlanChange(
                                        selectedLessonSession.id,
                                        entry.id,
                                        "start",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </label>
                                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                                  <span>종료 범위</span>
                                  <Input
                                    value={entry.planEnd}
                                    onChange={(event) =>
                                      handleLessonTextbookPlanChange(
                                        selectedLessonSession.id,
                                        entry.id,
                                        "end",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </label>
                                <label className="space-y-1.5 text-xs font-medium text-muted-foreground sm:col-span-2">
                                  <span>표시 문구</span>
                                  <Input
                                    value={entry.planLabel === "계획 범위 미지정" ? "" : entry.planLabel}
                                    onChange={(event) =>
                                      handleLessonTextbookPlanChange(
                                        selectedLessonSession.id,
                                        entry.id,
                                        "label",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </label>
                                <label className="space-y-1.5 text-xs font-medium text-muted-foreground sm:col-span-2">
                                  <span>계획 메모</span>
                                  <Textarea
                                    value={entry.planMemo === "계획 메모 없음" ? "" : entry.planMemo}
                                    onChange={(event) =>
                                      handleLessonTextbookPlanChange(
                                        selectedLessonSession.id,
                                        entry.id,
                                        "memo",
                                        event.target.value,
                                      )
                                    }
                                    className="min-h-[64px]"
                                  />
                                </label>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="px-2 py-3 text-sm text-muted-foreground">회차 없음</p>
        )}
      </div>
    </div>
  );

  const lessonDesignWorkspaceContent = (
    lessonDesignSnapshot ? (
      <div ref={lessonDesignExportRef} className="bg-background">
        <div className="grid gap-0 p-6 2xl:grid-cols-[minmax(18rem,0.85fr)_minmax(30rem,1.35fr)_minmax(22rem,1fr)]">
          {lessonDesignSaveError ? (
            <Alert variant="destructive" className="xl:col-span-2 2xl:col-span-3">
              <AlertDescription>{lessonDesignSaveError}</AlertDescription>
            </Alert>
          ) : null}
          {lessonDesignSaveNotice ? (
            <Alert className="xl:col-span-2 2xl:col-span-3">
              <AlertDescription>{lessonDesignSaveNotice}</AlertDescription>
            </Alert>
          ) : null}
          {!lessonDesignSnapshot.saveReadiness.ready &&
          (lessonDesignReadinessActions.length > 0 || lessonDesignSnapshot.saveReadiness.blockers.length > 0) ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[1.5rem] border bg-background/90 px-4 py-3 xl:col-span-2 2xl:col-span-3">
              <span className="text-sm font-medium text-foreground">저장 전 확인</span>
              {lessonDesignReadinessActions.map((action) => (
                <Button
                  key={action.key}
                  type="button"
                  size="sm"
                  variant={action.variant}
                  onClick={() => scrollLessonDesignSection(action.sectionId)}
                >
                  {action.label}
                </Button>
              ))}
              {lessonDesignReadinessActions.length === 0
                ? lessonDesignSnapshot.saveReadiness.blockers.map((item) => (
                    <Badge key={item} variant="outline">
                      {item}
                    </Badge>
                  ))
                : null}
            </div>
          ) : null}

          <section
            id={LESSON_DESIGN_SECTION_IDS.periods}
            className="bg-background py-4 2xl:col-start-1 2xl:pr-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-lg font-semibold text-foreground">일정 생성</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={handleAddLessonPeriod}>
                  월 추가
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveLessonPlan}
                  disabled={isLessonDesignSaving || !lessonDesignSnapshot.saveReadiness.ready}
                >
                  {isLessonDesignSaving ? "저장 중" : "저장"}
                </Button>
              </div>
            </div>

            <div className="mt-4">
              <div className="space-y-3">
                {lessonDesignSnapshot.billingPeriods.length > 0 ? (
                  lessonDesignSnapshot.billingPeriods.map((period) => {
                    const periodStartMonthKey = buildLessonMonthKey(period.startDate);
                    const periodSessions = filteredLessonSessions
                      .filter(
                        (session) =>
                          session.periodId === period.id ||
                          (periodStartMonthKey && session.monthKey === periodStartMonthKey),
                      )
                      .sort(compareLessonSessionsByDate);
                    const periodMonthKey = periodStartMonthKey || periodSessions[0]?.monthKey || "";
                    const isPeriodDetailsOpen = Boolean(periodMonthKey && activeLessonMonthKey === periodMonthKey && lessonMonthDetailsOpen);
                    const periodSelectedSession =
                      periodSessions.find((session) => session.id === selectedLessonSession?.id) ||
                      periodSessions[0] ||
                      null;
                    const handlePeriodDetailToggle = () => {
                      if (periodMonthKey) {
                        toggleLessonMonthKey(periodMonthKey);
                      }
                      if (periodSelectedSession) {
                        setSelectedLessonSessionId(periodSelectedSession.id);
                      }
                      setLessonMonthDetailsOpen((current) =>
                        periodMonthKey && activeLessonMonthKey === periodMonthKey ? !current : true,
                      );
                    };

                    return (
                      <div key={period.id} className="border-t px-2 py-4 first:border-t-0">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-foreground">{period.label}</p>
                            <Badge variant="secondary">{period.sessionCount || 0}회</Badge>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {periodSessions.length > 0 ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                aria-expanded={isPeriodDetailsOpen}
                                onClick={handlePeriodDetailToggle}
                              >
                                {isPeriodDetailsOpen ? "상세 닫기" : "상세 보기"}
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleRemoveLessonPeriod(period.id)}
                              disabled={lessonDesignSnapshot.billingPeriods.length <= 1}
                            >
                              삭제
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">시작일</p>
                            <Input
                              type="date"
                              value={period.startDate}
                              onChange={(event) => handleLessonPeriodChange(period.id, "startDate", event.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">종료일</p>
                            <Input
                              type="date"
                              value={period.endDate}
                              onChange={(event) => handleLessonPeriodChange(period.id, "endDate", event.target.value)}
                            />
                          </div>
                        </div>
                        {isPeriodDetailsOpen ? renderLessonMonthSessionDetails(periodSessions) : null}
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-[1.25rem] border border-dashed px-4 py-6 text-sm text-muted-foreground">
                    생성 구간이 없습니다.
                  </div>
                )}
              </div>
            </div>
          </section>

          <section
            id={LESSON_DESIGN_SECTION_IDS.calendar}
            className="border-t bg-background py-6 2xl:col-start-2 2xl:row-span-2 2xl:border-l 2xl:border-t-0 2xl:px-5"
          >
                  <div className="flex flex-wrap items-start justify-between gap-3">
	                    <div className="space-y-1">
	                      <p className="text-lg font-semibold text-foreground">캘린더</p>
	                      <p className="text-sm text-muted-foreground">{lessonDesignSnapshot.plannerSchedule}</p>
	                    </div>
	                  </div>
                    {lessonPreviewBadges.length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {lessonPreviewBadges.map((badge) => (
                          <span
                            key={badge.key}
                            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium text-white shadow-sm"
                            style={{ backgroundColor: badge.color }}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    ) : null}

	                  <div className="mt-4">
                    {lessonCalendarMonths.length > 0 ? (
                      <div className="space-y-4">
                        {lessonCalendarMonths.map((month) => {
                          const monthPreviewSessions = Array.from(month.sessionsByDate.values()).flat();
                          const accentColor = monthPreviewSessions[0]?.billingColor || "#216e4e";
                          const cells = buildLessonCalendarCells(month.year, month.month);

                          return (
                            <div key={month.key} className="border-t pt-5 first:border-t-0">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                  <span className="h-10 w-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
                                  <div className="space-y-1">
                                    <p className="text-xl font-semibold text-foreground">
                                      {month.year}년 {month.month + 1}월
                                    </p>
                                  </div>
                                </div>
                              </div>

                              <div className="mt-4">
                                <div className="grid grid-cols-7 gap-1 text-[11px] font-medium text-muted-foreground">
                                  {DAY_LABELS.map((dayLabel) => (
                                    <div key={`${month.key}-${dayLabel}`} className="flex h-8 items-center justify-center rounded-md bg-muted/40">
                                      {dayLabel}
                                    </div>
                                  ))}
                                  {cells.map((cell) => {
                                  const dateKey = `${cell.date.getFullYear()}-${String(cell.date.getMonth() + 1).padStart(2, "0")}-${String(cell.date.getDate()).padStart(2, "0")}`;
                                  const daySessions = month.sessionsByDate.get(dateKey) || [];
                                  const primarySession = getLessonCalendarPrimarySession(daySessions);
                                  const primaryScheduleSurface = primarySession
                                    ? getScheduleStateSurface(primarySession.scheduleState)
                                    : null;
                                  const isSelectedCalendarSession = daySessions.some(
                                    (session) => session.id === selectedLessonSession?.id,
                                  ) || selectedLessonCalendarDate === dateKey;
                                  const canToggleCalendarDate = cell.isCurrentMonth || Boolean(primarySession);
                                  const isCalendarDragSource = lessonCalendarDragSource === dateKey;
                                  const isCalendarDropTarget = lessonCalendarDropTarget === dateKey;
                                  const CellTag = canToggleCalendarDate ? "button" : "div";

                                  return (
                                    <CellTag
                                      key={`${month.key}-${dateKey}`}
                                      data-lesson-calendar-date={dateKey}
                                      data-lesson-calendar-state={primarySession?.scheduleState || ""}
                                      {...(canToggleCalendarDate ? { type: "button" as const } : {})}
                                      draggable={Boolean(primarySession) && primarySession?.scheduleState !== "makeup"}
                                      onDragStart={(event) => {
                                        if (!primarySession || primarySession.scheduleState === "makeup") {
                                          return;
                                        }
                                        event.dataTransfer.effectAllowed = "move";
                                        event.dataTransfer.setData("text/plain", dateKey);
                                        setSelectedLessonCalendarDate(dateKey);
                                        setLessonCalendarDragSource(dateKey);
                                      }}
                                      onDragEnd={() => {
                                        setLessonCalendarDragSource("");
                                        setLessonCalendarDropTarget("");
                                      }}
                                      onDragOver={(event) => {
                                        if (
                                          primarySession ||
                                          !lessonCalendarDragSource ||
                                          lessonCalendarDragSource === dateKey
                                        ) {
                                          return;
                                        }
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "move";
                                        setLessonCalendarDropTarget(dateKey);
                                      }}
                                      onDragLeave={() => {
                                        if (lessonCalendarDropTarget === dateKey) {
                                          setLessonCalendarDropTarget("");
                                        }
                                      }}
                                      onDrop={(event) => {
                                        if (
                                          primarySession ||
                                          !lessonCalendarDragSource ||
                                          lessonCalendarDragSource === dateKey
                                        ) {
                                          return;
                                        }
                                        event.preventDefault();
                                        handleLessonCalendarDrop(dateKey, {
                                          hasSession: Boolean(primarySession),
                                        });
                                      }}
                                      className={cn(
                                        "flex min-h-[7rem] min-w-0 flex-col overflow-hidden rounded-[1rem] border px-2 py-2 text-left align-top transition-colors",
                                        primarySession
                                          ? primaryScheduleSurface?.className
                                          : canToggleCalendarDate
                                            ? "bg-background/95 hover:border-primary/50 hover:bg-primary/5"
                                            : cell.isCurrentMonth
                                              ? "bg-background/95"
                                              : "bg-background/40 text-muted-foreground/50",
                                        isSelectedCalendarSession && "ring-2 ring-primary/70 ring-offset-2 ring-offset-background",
                                        isCalendarDragSource && "opacity-70 ring-2 ring-primary/40",
                                        isCalendarDropTarget && "ring-2 ring-primary",
                                      )}
                                      onClick={() => {
                                        handleLessonCalendarDateClick(dateKey, {
                                          hasSession: Boolean(primarySession),
                                          hasBaseSession: Array.isArray(normalizedLessonPlan?.selectedDays)
                                            ? (normalizedLessonPlan.selectedDays as Array<string | number>).map((value) => Number(value)).includes(cell.date.getDay())
                                            : false,
                                          isMakeup: primarySession?.scheduleState === "makeup" && Boolean(primarySession.originalDate),
                                        });
                                      }}
                                    >
                                      <p className="text-[11px] font-semibold">{cell.date.getDate()}</p>
                                      {primarySession ? (
                                        <div className="flex min-h-[4.75rem] flex-1 flex-col items-center justify-center gap-1.5 text-center">
                                          <Badge
                                            variant="secondary"
                                            className="max-w-full truncate rounded-full px-2.5 py-1 text-xs font-semibold"
                                          >
                                            {primarySession.label}
                                          </Badge>
                                          <p
                                            className={cn(
                                              "truncate text-xs font-semibold",
                                              primaryScheduleSurface?.mutedClassName,
                                            )}
                                          >
                                            {primarySession.scheduleStateLabel}
                                          </p>
                                          {daySessions.length > 1 ? (
                                            <p
                                              className={cn(
                                                "text-[11px]",
                                                primaryScheduleSurface?.mutedClassName,
                                              )}
                                            >
                                              추가 {daySessions.length - 1}건
                                            </p>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </CellTag>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-[1.25rem] border border-dashed px-4 py-6 text-sm text-muted-foreground">
                        <div className="space-y-3">
                          <p className="font-medium text-foreground">현재 필터에 맞는 생성 일정이 없습니다.</p>
                          {lessonScopeSummaryBadges.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {lessonScopeSummaryBadges.map((item) => (
                                <Badge key={`calendar-empty-${item.key}`} variant="outline">
                                  {item.label}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                          <p>일정 생성 범위를 다시 넓혀 캘린더 기준 회차를 확인합니다.</p>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => resetLessonDesignFilters("default")}>
                              월 선택으로 돌아가기
                            </Button>
                            <Button type="button" size="sm" onClick={() => resetLessonDesignFilters("all")}>
                              모든 월 보기
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
          </section>

          <section
            id={LESSON_DESIGN_SECTION_IDS.board}
            className="border-t bg-background py-6 2xl:col-start-3 2xl:row-span-2 2xl:border-l 2xl:border-t-0 2xl:pl-5"
          >
                    <div className="flex flex-wrap items-start justify-between gap-3">
	                      <div className="space-y-1">
	                        <p className="text-lg font-semibold text-foreground">회차 목록</p>
	                      </div>
	                    </div>

	                    <div className="mt-4">
                      {lessonSessionGroups.length > 0 ? (
                        <div className="space-y-4">
                          {lessonSessionGroups.map((group) => (
                            <div key={group.key} className="border-t pt-4 first:border-t-0">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="secondary">{group.billingLabel}</Badge>
                                    <Badge variant="outline">{group.sessionCount}회</Badge>
                                  </div>
                                  <p className="text-xs text-muted-foreground">{group.rangeLabel}</p>
                                </div>
                              </div>

                              <div className="mt-4 space-y-3">
	                                {group.sessions.map((session, sessionIndex) => {
	                                  const isSelected = selectedLessonSession?.id === session.id;
	                                  const lessonFlowState = lessonFlowStateMap.get(session.id) || "pending";
	                                  const isDoneFlow = lessonFlowState === "done";
	                                  const isCurrentFlow = lessonFlowState === "active";
                                  const isFirstFlowItem = sessionIndex === 0;
                                  const isLastFlowItem = sessionIndex === group.sessions.length - 1;
                                  const sessionMemoLine = [text(session.memo), session.noteSummary !== "기록 메모 없음" ? session.noteSummary : ""]
                                    .map((value) => text(value))
                                    .filter(Boolean)
                                    .join(" · ");
                                  const sessionDetailLine = [sessionMemoLine, session.scheduleConnectionLabel]
                                    .map((value) => text(value))
                                    .filter(Boolean)
                                    .join(" · ");
	                                  return (
                                    <div key={session.id} className="relative pl-10">
                                      <span
                                        aria-hidden="true"
                                        className={cn(
                                          "absolute left-2.5 w-px bg-border",
                                          isFirstFlowItem ? "top-1/2" : "-top-3",
                                          isLastFlowItem ? "bottom-1/2" : "-bottom-3",
                                        )}
                                      />
                                      <span
                                        aria-hidden="true"
                                        className={cn(
                                          "absolute left-0 top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border-4 border-background",
                                          isDoneFlow
                                            ? "bg-primary border-primary/20"
                                            : isCurrentFlow
                                              ? "bg-primary/15 border-primary text-primary"
                                              : "bg-muted border-border text-muted-foreground",
                                        )}
                                      />
                                      <button
                                      type="button"
                                      className={cn(
                                        "relative flex w-full items-start gap-3 rounded-[1.1rem] border bg-background px-4 py-3 text-left transition-colors hover:bg-muted/30",
                                        isSelected && "border-primary bg-primary/5 shadow-sm",
                                      )}
                                      onClick={() =>
                                        focusLessonDesignSession(session.id, {
                                          sectionId: LESSON_DESIGN_SECTION_IDS.periods,
                                        })
                                      }
                                    >
	                                      <div className="min-w-0 flex-1 space-y-2">
	                                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
	                                          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
	                                            <span className="font-medium text-foreground">{session.label}</span>
	                                            <span className="text-xs text-muted-foreground">{session.dateLabel}</span>
	                                          </span>
	                                          <Badge variant={getScheduleStateTone(session.scheduleState)}>
	                                            {session.scheduleStateLabel}
	                                          </Badge>
	                                        </div>

	                                        {sessionDetailLine ? (
	                                          <p className="text-xs text-muted-foreground">{sessionDetailLine}</p>
	                                        ) : null}
	                                      </div>
	                                    </button>
                                    </div>
	                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-[1.25rem] border border-dashed px-4 py-6 text-sm text-muted-foreground">
                          <div className="space-y-3">
                            <p className="font-medium text-foreground">현재 필터에 맞는 회차 목록이 없습니다.</p>
                            {lessonScopeSummaryBadges.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {lessonScopeSummaryBadges.map((item) => (
                                  <Badge key={`board-empty-${item.key}`} variant="outline">
                                    {item.label}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" size="sm" variant="outline" onClick={() => resetLessonDesignFilters("default")}>
                                월 선택으로 돌아가기
                              </Button>
                              <Button type="button" size="sm" onClick={() => resetLessonDesignFilters("all")}>
                                모든 월 보기
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

          </section>
        </div>
      </div>
    ) : null
);

  const classScheduleWorkspaceContent = (
    <>
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
          searchPlaceholder="반명, 선생님, 시간표로 검색"
          onSearchChange={setSearch}
          filters={[
            {
              label: "학기",
              value: termId,
              options: model.filterOptions.terms,
              placeholder: "전체 학기",
              onChange: setTermId,
            },
            {
              label: "과목",
              value: subject,
              options: model.filterOptions.subjects,
              placeholder: "전체 과목",
              onChange: setSubject,
            },
            {
              label: "학년",
              value: grade,
              options: model.filterOptions.grades,
              placeholder: "전체 학년",
              onChange: setGrade,
            },
            {
              label: "선생님",
              value: teacher,
              options: model.filterOptions.teachers,
              placeholder: "전체 선생님",
              onChange: setTeacher,
            },
            {
              label: "동기 그룹",
              value: selectedSyncGroupId,
              options: syncGroupOptions,
              placeholder: "전체 그룹",
              onChange: setSelectedSyncGroupId,
            },
          ]}
        />
      </div>

      <div className="grid gap-6 px-4 xl:grid-cols-[1.55fr_0.85fr] lg:px-6">
        <section className="overflow-hidden border border-border/70 bg-background">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-foreground">수업 목록</p>
              <p className="text-xs text-muted-foreground">반 진행 현황을 행 단위로 비교하는 스프레드시트형 보기</p>
            </div>
            <div className="text-xs text-muted-foreground">행 {model.rows.length}</div>
          </div>
          <div className="px-4 py-4">
            {model.rows.length === 0 ? (
              <div className="text-muted-foreground flex min-h-72 items-center justify-center border border-dashed text-sm">
                선택한 조건에 맞는 수업일정이 없습니다.
              </div>
            ) : (
              <ScrollArea className="h-[34rem] pr-4">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky top-0 z-10 bg-background">반</TableHead>
                      <TableHead className="sticky top-0 z-10 bg-background">운영 정보</TableHead>
                      <TableHead className="sticky top-0 z-10 bg-background">진행도</TableHead>
                      <TableHead className="sticky top-0 z-10 bg-background">동기 그룹</TableHead>
                      <TableHead className="sticky top-0 z-10 bg-background">경고</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {model.rows.map((row) => {
                      const progressPercent = formatProgress(
                        row.completedSessions,
                        row.sessionCount,
                      );

                      return (
                        <TableRow
                          key={row.id}
                          className={cn(
                            "cursor-pointer transition-colors hover:bg-muted/50",
                            selectedClassId === row.id && "bg-muted/60",
                          )}
                          aria-selected={selectedClassId === row.id}
                          onClick={() => setSelectedClassId(row.id)}
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
                                  href={buildLessonDesignPageHref(
                                    row,
                                    row.nextActionSessionId || "",
                                    row.nextActionSessionId
                                      ? LESSON_DESIGN_SECTION_IDS.board
                                      : LESSON_DESIGN_SECTION_IDS.periods,
                                  )}
                                  className="inline-flex text-left font-medium underline-offset-4 hover:underline"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                  }}
                                >
                                  {row.title}
                                </Link>
                                <p className="text-muted-foreground text-sm">
                                  {row.termName || "학기 미정"} · {row.teacher || "선생님 미정"}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="min-w-[12rem] space-y-2 text-sm">
                              <p className="font-medium">{row.scheduleLabel || "시간표 미정"}</p>
                              <p className="text-muted-foreground">
                                계획 {row.latestPlannedSessionIndex}회차 · 실제 {row.latestActualSessionIndex}회차
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="min-w-[12rem] space-y-1.5 text-sm">
                              <div className="flex items-center justify-between gap-3">
                                <span>{row.completedSessions}/{row.sessionCount}회 완료</span>
                                <span className="font-medium text-foreground">{progressPercent}%</span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                계획 {row.latestPlannedSessionIndex}회차 · 실제 {row.latestActualSessionIndex}회차
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            {row.syncGroupName ? (
                              <Badge variant="outline">{row.syncGroupName}</Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">미연결</span>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            {row.warningText ? (
                              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                                {row.warningText}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">정상</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </div>
        </section>

        <div className="space-y-6">
          <section className="border border-border/70 bg-background">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <p className="text-sm font-semibold text-foreground">동기 그룹</p>
              <span className="text-xs text-muted-foreground">{model.syncGroupCards.length}개</span>
            </div>
            <div className="space-y-3 px-4 py-4 text-sm">
              {model.syncGroupCards.length > 0 ? (
                model.syncGroupCards.map((group) => {
                  const isSelected = selectedSyncGroupId === group.id;

                  return (
                    <button
                      key={group.id}
                      type="button"
                      className={cn(
                        "w-full rounded-xl border px-4 py-3 text-left transition-colors hover:bg-muted/50",
                        isSelected && "border-primary bg-muted/60",
                      )}
                      onClick={() => {
                        const nextGroupId = isSelected ? "" : group.id;
                        setSelectedSyncGroupId(nextGroupId);
                        setSelectedClassId(group.members[0]?.classId || "");
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="font-medium">{group.name || group.id}</p>
                          <p className="text-muted-foreground text-xs">
                            {group.memberCount}개 반 · {group.members
                              .map((member) => member.className)
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        </div>
                        <Badge variant={isSelected ? "default" : "outline"}>
                          {isSelected ? "선택 중" : "그룹 확인"}
                        </Badge>
                      </div>
                      {group.warningText ? (
                        <p className="text-muted-foreground mt-3 text-xs">{group.warningText}</p>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <div className="text-muted-foreground border border-dashed px-3 py-6 text-center">
                  현재 연결된 동기 그룹이 없습니다.
                </div>
              )}
            </div>
          </section>

          <section className="border border-border/70 bg-background">
            <div className="border-b px-4 py-3">
              <p className="text-sm font-semibold text-foreground">선택한 반 진행 상세</p>
            </div>
            <div className="space-y-4 px-4 py-4 text-sm">
              {selectedRow && selectedSnapshot ? (
                <>
                  <div className="rounded-xl border px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{selectedRow.subject || "과목 미정"}</Badge>
                          {selectedRow.grade ? (
                            <Badge variant="secondary">{selectedRow.grade}</Badge>
                          ) : null}
                          {selectedRow.syncGroupName ? (
                            <Badge variant="outline">{selectedRow.syncGroupName}</Badge>
                          ) : null}
                        </div>
                        <div>
                          <p className="text-base font-semibold">{selectedRow.title}</p>
                          <p className="text-muted-foreground mt-1">
                            {selectedRow.termName || "학기 미정"} · {selectedRow.teacher || "선생님 미정"}
                          </p>
                        </div>
                      </div>
                      <div className="text-muted-foreground text-right text-xs">
                        <p>마지막 업데이트</p>
                        <p className="mt-1 font-medium text-foreground">
                          {selectedSnapshot.recentSessions[0]?.updatedAt || selectedSnapshot.nextSessionMeta}
                        </p>
	                        {lessonDesignSnapshot ? (
	                          <div className="mt-3 flex flex-wrap justify-end gap-2">
	                            <Button asChild type="button" size="sm" variant="outline">
	                              <Link href={buildPublicClassHref(selectedRow)}>
	                                홈페이지 확인
	                                <ArrowUpRight className="size-3.5" />
	                              </Link>
	                            </Button>
	                            <Button asChild type="button" size="sm">
	                              <Link
	                                href={buildLessonDesignPageHref(
                                  selectedRow,
                                  selectedSnapshot.nextSessionId || "",
                                  selectedSnapshot.nextSessionId
                                    ? LESSON_DESIGN_SECTION_IDS.board
                                    : LESSON_DESIGN_SECTION_IDS.periods,
                                )}
                              >
                                수업 설계
                                <ArrowUpRight className="size-3.5" />
                              </Link>
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={!selectedSnapshot.nextSessionId}
                      aria-disabled={!selectedSnapshot.nextSessionId}
                      className={cn(
                        "rounded-xl border px-3 py-3 text-left transition-colors",
                        selectedSnapshot.nextSessionId
                          ? "hover:bg-muted/40"
                          : "cursor-default",
                      )}
                      onClick={
                        selectedSnapshot.nextSessionId
                          ? () => openLessonDesignPageForRow(selectedRow, selectedSnapshot.nextSessionId || "")
                          : undefined
                      }
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">바로 확인할 회차</p>
                        <Badge variant={selectedSnapshot.nextSessionId ? selectedSnapshot.nextSessionTone : "outline"}>
                          {selectedSnapshot.nextSessionMeta}
                        </Badge>
                      </div>
                      <div className="mt-3 space-y-2 text-muted-foreground">
                        <p>{selectedSnapshot.nextSessionLabel}</p>
                      </div>
                    </button>
                    <div className="rounded-xl border px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">동기 그룹 상태</p>
                        {selectedRow.syncGroupName ? (
                          <Badge variant="outline">{selectedRow.syncGroupName}</Badge>
                        ) : null}
                      </div>
                      <div className="mt-3 space-y-2 text-muted-foreground">
                        <p>{selectedSnapshot.syncGroupLabel}</p>
                        <p>{selectedSnapshot.syncGroupHint}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">계획 대비 경고</p>
                        <Badge variant={selectedRow.warningText ? "destructive" : "outline"}>
                          {selectedRow.warningText ? "점검 필요" : "안정"}
                        </Badge>
                      </div>
                      <div className="mt-3 space-y-2 text-muted-foreground">
                        <p>{selectedSnapshot.warningLabel}</p>
                        <p>{selectedSnapshot.warningHint}</p>
                      </div>
                    </div>
                    <div className="rounded-xl border px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">업데이트 대기 회차</p>
                        <Badge variant="outline">
                          {selectedSnapshot.pendingSessions.length > 0 ? `${selectedSnapshot.pendingSessions.length}건` : "없음"}
                        </Badge>
                      </div>
                      <div className="mt-3 space-y-2 text-muted-foreground">
                        <p>{selectedSnapshot.pendingSessionSummary}</p>
                      </div>
                      {selectedSnapshot.pendingSessions.length > 0 ? (
                        <div className="mt-3 space-y-2">
                          {selectedSnapshot.pendingSessions.map((session) => (
                            <button
                              key={session.id}
                              type="button"
                              className="w-full rounded-lg border bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/40"
                              onClick={() => openLessonDesignPageForRow(selectedRow, session.id)}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-medium text-foreground">{session.label}</p>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={session.progressTone}>{session.statusLabel}</Badge>
                                  <span className="text-xs text-muted-foreground">{session.updatedAt}</span>
                                </div>
                              </div>
                              {session.noteSummary !== "기록 메모 없음" ? (
                                <p className="mt-2 text-xs text-muted-foreground">{session.noteSummary}</p>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-xl border px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">연결 교재</p>
                      <Badge variant="outline">{selectedSnapshot.textbookTitles.length}권</Badge>
                    </div>
                    {selectedSnapshot.textbookTitles.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedSnapshot.textbookTitles.map((title) => (
                          <Badge key={title} variant="secondary">
                            {title}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">최근 기록 메모</p>
                      <Badge variant="outline">{selectedSnapshot.latestNoteSessionLabel}</Badge>
                    </div>
                    <div className="mt-3 space-y-2 text-muted-foreground">
                      <p>{selectedSnapshot.latestNoteLabel}</p>
                      <p>{selectedSnapshot.latestNoteSessionLabel}</p>
                    </div>
                  </div>

                  <div className="rounded-xl border px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">최근 회차 흐름</p>
                      <Badge variant="outline">{selectedSnapshot.recentSessions.length}건</Badge>
                    </div>
                    {selectedSnapshot.recentSessions.length > 0 ? (
                      <div className="mt-3 space-y-3">
                        {selectedSnapshot.recentSessions.map((session) => (
                          <button
                            type="button"
                            key={session.id}
                            className="w-full rounded-xl border bg-muted/20 px-3 py-3 text-left"
                            onClick={() => openLessonDesignPageForRow(selectedRow, session.id)}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-medium">{session.label}</p>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={session.progressTone}>{session.statusLabel}</Badge>
                                <span className="text-muted-foreground text-xs">{session.updatedAt}</span>
                              </div>
                            </div>
                            {session.noteSummary ? (
                              <p className="text-muted-foreground mt-2 text-xs">
                                {session.noteSummary}
                              </p>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground border border-dashed px-3 py-6 text-center">
                  선택 중인 반이 없습니다.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      </div>
    </>
  );

  return (
    <>
      {!isLessonDesignPage ? classScheduleWorkspaceContent : null}
      {isLessonDesignPage ? (
        <div className="px-4 lg:px-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <div className="min-w-0">
              <p className="truncate text-xl font-semibold text-foreground">{lessonDesignTitle}</p>
              <p className="text-sm text-muted-foreground">{lessonDesignDescription}</p>
            </div>
            <Button type="button" variant="outline" onClick={closeLessonDesignWorkspace}>
              <ArrowLeft className="mr-2 size-4" />
              수업계획으로 돌아가기
            </Button>
          </div>
          {lessonDesignSnapshot ? (
            <div className="bg-background">
              {lessonDesignWorkspaceContent}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed px-6 py-10 text-sm text-muted-foreground">
              <div className="space-y-4">
                <p className="text-lg font-semibold text-foreground">연결된 수업계획이 없습니다.</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <Button type="button" variant="outline" onClick={closeLessonDesignWorkspace}>
                    <ArrowLeft className="mr-2 size-4" />
                    수업계획으로 돌아가기
                  </Button>
                  <Link
                    href="/admin/classes"
                    className="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    반 목록 점검
                  </Link>
                  <Link
                    href="/admin/textbooks"
                    className="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    교재 목록 점검
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <Dialog open={lessonDesignOpen} onOpenChange={handleLessonDesignOpenChange}>
          <DialogContent className="flex h-[92vh] w-[98vw] max-w-[1600px] flex-col overflow-hidden gap-0 p-0 xl:h-[94vh]">
            {lessonDesignWorkspaceContent}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
