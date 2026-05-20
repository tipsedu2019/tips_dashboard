"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { ArrowLeft, ArrowUpRight, BookOpen, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription } from "@/components/ui/dialog";
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
  applyTextbookPlanRangeField,
  buildSchedulePlanForSave,
  computeAutoEndDate,
  getSuggestedNextStartDate,
  normalizeSchedulePlan,
} from "@/lib/class-schedule-planner";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

import { buildClassScheduleRouteModel } from "./records.js";
import { useOperationsWorkspaceData } from "./use-operations-workspace-data";

function text(value: unknown) {
  return String(value || "").trim();
}

function getTextbookTitle(book: Record<string, unknown> | null | undefined) {
  return text(book?.title || book?.name || book?.textbook_title || book?.textbookTitle);
}

function getTextbookPublisher(book: Record<string, unknown> | null | undefined) {
  return text(book?.publisher || book?.publisher_name || book?.publisherName);
}

function getTextbookCategory(book: Record<string, unknown> | null | undefined) {
  return text(book?.category || book?.area || book?.unit);
}

function getTextbookSubject(book: Record<string, unknown> | null | undefined) {
  return text(book?.subject);
}

function normalizeLessonSubjectKey(value: unknown) {
  const normalized = text(value).replace(/\s+/g, "").toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized.includes("수학") || normalized.includes("math")) {
    return "math";
  }
  if (normalized.includes("영어") || normalized.includes("english")) {
    return "english";
  }
  if (normalized.includes("기타") || normalized.includes("other")) {
    return "other";
  }
  return normalized;
}

function getLessonSubjectDisplayLabel(value: unknown) {
  const subjectKey = normalizeLessonSubjectKey(value);
  if (subjectKey === "math") {
    return "수학";
  }
  if (subjectKey === "english") {
    return "영어";
  }
  if (subjectKey === "other") {
    return "기타";
  }
  return text(value);
}

function buildLessonTextbookFilterOptions(
  books: Record<string, unknown>[],
  getter: (book: Record<string, unknown>) => string,
) {
  return [
    ...new Set(
      books
        .map((book) => getter(book))
        .map((value) => text(value))
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right, "ko"));
}

function buildLessonTextbookSubjectFilterOptions(books: Record<string, unknown>[]) {
  return [
    ...new Set(
      books
        .map((book) => normalizeLessonSubjectKey(getTextbookSubject(book)))
        .filter(Boolean),
    ),
  ].sort((left, right) =>
    getLessonSubjectDisplayLabel(left).localeCompare(getLessonSubjectDisplayLabel(right), "ko"),
  );
}

function matchesLessonTextbookFilter(value: string, filter: string) {
  return !filter || filter === "all" || value === filter;
}

function matchesLessonSubjectFilter(value: string, filter: string) {
  return !filter || filter === "all" || normalizeLessonSubjectKey(value) === normalizeLessonSubjectKey(filter);
}

function getLessonSessionOptionLabel(session: Record<string, unknown> | null | undefined) {
  const label = text(session?.label);
  const dateLabel = text(session?.dateLabel);
  return [label, dateLabel].filter(Boolean).join(" · ");
}

function getLessonTextbookScheduleRangeLabel(
  book: Record<string, unknown>,
  sessions: Record<string, unknown>[],
) {
  const startSessionId = text(book.startSessionId || book.start_session_id);
  const endSessionId = text(book.endSessionId || book.end_session_id);
  const startSession = sessions.find((session) => text(session.id) === startSessionId) || sessions[0];
  const endSession =
    sessions.find((session) => text(session.id) === endSessionId) ||
    sessions[sessions.length - 1];

  const startLabel = getLessonSessionOptionLabel(startSession);
  const endLabel = getLessonSessionOptionLabel(endSession);
  if (!startLabel && !endLabel) {
    return "";
  }
  if (startLabel === endLabel) {
    return startLabel;
  }
  return `${startLabel || "첫 회차"} ~ ${endLabel || "마지막 회차"}`;
}

function getLessonSessionSortTime(session: Record<string, unknown>) {
  const dateValue = text(session.date || session.session_date || session.dateValue);
  const time = Date.parse(`${dateValue}T00:00:00`);
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function sortLessonSessionRecords(left: Record<string, unknown>, right: Record<string, unknown>) {
  const dateGap = getLessonSessionSortTime(left) - getLessonSessionSortTime(right);
  if (dateGap !== 0) {
    return dateGap;
  }

  return (
    Number(left.sessionNumber || left.session_number || 0) -
    Number(right.sessionNumber || right.session_number || 0)
  );
}

function findMatchingLessonSessionRecord(
  sessions: Record<string, unknown>[] = [],
  {
    sessionId,
    sessionNumber,
    sessionDate,
  }: {
    sessionId: string;
    sessionNumber: number;
    sessionDate: string;
  },
) {
  if (sessionId) {
    return (
      sessions.find((session) => text(session?.id || session?.session_id) === sessionId) ||
      null
    );
  }

  const hasSessionNumber = Number.isFinite(sessionNumber) && sessionNumber > 0;
  if (!hasSessionNumber) {
    return null;
  }

  if (sessionDate) {
    const dateMatchedSession = sessions.find((session) => {
      const candidateNumber = Number(session?.sessionNumber || session?.session_number || 0);
      const candidateDate = text(session?.date || session?.session_date);
      return candidateNumber === sessionNumber && candidateDate === sessionDate;
    });
    if (dateMatchedSession) {
      return dateMatchedSession;
    }
  }

  return (
    sessions.find((session) => Number(session?.sessionNumber || session?.session_number || 0) === sessionNumber) ||
    null
  );
}

const LESSON_GRADE_TOKENS = ["중1", "중2", "중3", "고1", "고2", "고3"];
const LESSON_MATCH_TOKENS = [
  "공통수학2",
  "공통수학1",
  "공통수학",
  "수학2",
  "수학1",
  "미적분",
  "확률과통계",
  "확통",
  "기하",
  "독해",
  "어법",
  "문법",
  "듣기",
  "내신",
  "수능",
  "모의고사",
];

function normalizeLessonMatchText(value: unknown) {
  return text(value).replace(/\s+/g, "").toLowerCase();
}

function extractLessonGradeTokens(value: unknown) {
  const normalized = normalizeLessonMatchText(value);
  return LESSON_GRADE_TOKENS.filter((token) => normalized.includes(token));
}

function extractLessonMatchTokens(value: unknown) {
  const normalized = normalizeLessonMatchText(value);
  return [
    ...new Set(
      LESSON_MATCH_TOKENS.filter((token) => normalized.includes(normalizeLessonMatchText(token))),
    ),
  ];
}

function buildTextbookMatchCorpus(book: Record<string, unknown> | null | undefined) {
  return normalizeLessonMatchText(
    [
      getTextbookTitle(book),
      getTextbookPublisher(book),
      getTextbookCategory(book),
      getTextbookSubject(book),
    ].join(" "),
  );
}

function scoreLessonTextbookCandidate(
  book: Record<string, unknown>,
  context: {
    plannerClassName?: string;
    plannerSubject?: string;
    plannerGrade?: string;
  } | null,
) {
  const plannerSubject = text(context?.plannerSubject) === "과목 미정" ? "" : text(context?.plannerSubject);
  const bookSubject = getTextbookSubject(book);
  const plannerSubjectKey = normalizeLessonSubjectKey(plannerSubject);
  const bookSubjectKey = normalizeLessonSubjectKey(bookSubject);
  const corpus = buildTextbookMatchCorpus(book);
  let score = 0;

  if (plannerSubjectKey && bookSubjectKey) {
    score += bookSubjectKey === plannerSubjectKey ? 80 : -120;
  }

  const classText = `${text(context?.plannerClassName)} ${text(context?.plannerGrade)}`;
  const classGrades = extractLessonGradeTokens(classText);
  const bookGrades = extractLessonGradeTokens(corpus);
  classGrades.forEach((gradeToken) => {
    score += bookGrades.includes(gradeToken) ? 45 : 0;
  });
  if (classGrades.length > 0 && bookGrades.some((gradeToken) => !classGrades.includes(gradeToken))) {
    score -= 35;
  }

  extractLessonMatchTokens(classText).forEach((token) => {
    if (corpus.includes(normalizeLessonMatchText(token))) {
      score += token.length >= 4 ? 30 : 20;
    }
  });

  if (classGrades.some((gradeToken) => gradeToken === "고1" || gradeToken === "고2") && corpus.includes("수능대비")) {
    score -= 15;
  }

  return score;
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
    const area = text(entry.area || entry.category);
    const subSubject = text(entry.subSubject || entry.sub_subject);
    const alias = text(entry.alias);
    const actualStatus = text(actual.status);
    const planLabel = text(plan.label) || "계획 범위 미지정";
    const actualLabel = text(actual.label) || "실진도 기록 없음";
    const actualUpdatedAt = formatUpdatedDate(text(actual.updatedAt || actual.updated_at));

    return {
      id: text(entry.id) || `${textbookId || "textbook"}-${index}`,
      textbookId,
      textbookTitle,
      alias,
      area,
      subSubject,
      planStart: text(plan.start),
      planEnd: text(plan.end),
      planLabel,
      planMemo: text(plan.memo) || "계획 메모 없음",
      scopeLabel: [area, subSubject].filter(Boolean).join(" · "),
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
  textbooks: "lesson-design-textbooks",
  periods: "lesson-design-periods",
  calendar: "lesson-design-calendar",
  board: "lesson-design-board",
} as const;
const LESSON_DESIGN_SELECTED_SESSION_EDITOR_ID = "lesson-design-selected-session-editor";
const LESSON_DESIGN_PERIOD_DETAIL_ID_PREFIX = "lesson-design-period-detail-";

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

function getAllLessonMonthKeys(months: Array<{ key: string }>) {
  return months.map((month) => text(month.key)).filter(Boolean);
}

function getDefaultLessonMonthKeys(months: Array<{ key: string }>) {
  return getAllLessonMonthKeys(months);
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

function colorWithAlpha(color: string, alpha: number) {
  const normalized = text(color);
  const hex = normalized.replace("#", "");
  const safeAlpha = Math.max(0, Math.min(1, alpha));

  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const [r, g, b] = hex.split("").map((part) => parseInt(`${part}${part}`, 16));
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }

  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }

  return normalized || "#216e4e";
}

function getLessonCalendarMonthSurfaceStyle(accentColor: string): CSSProperties {
  const color = text(accentColor) || "#216e4e";

  return {
    background: `linear-gradient(135deg, ${colorWithAlpha(color, 0.14)} 0%, ${colorWithAlpha(color, 0.045)} 100%)`,
    borderColor: colorWithAlpha(color, 0.32),
    boxShadow: `inset 4px 0 0 ${colorWithAlpha(color, 0.72)}`,
  };
}

function getLessonCalendarSessionSurfaceStyle(scheduleState: string, accentColor: string): CSSProperties | undefined {
  const state = text(scheduleState);
  const color = text(accentColor) || "#216e4e";

  if (state && state !== "active") {
    return undefined;
  }

  return {
    backgroundColor: color,
    borderColor: color,
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

function getLessonSessionIdentity(session: Record<string, unknown> | null | undefined) {
  const explicitId = text(session?.id || session?.session_id);
  if (explicitId) {
    return `id:${explicitId}`;
  }

  return [
    "session",
    text(session?.dateValue || session?.date || session?.session_date),
    text(session?.sessionNumber || session?.session_number),
    text(session?.billingId || session?.billing_id || session?.periodId || session?.period_id),
    text(session?.scheduleState || session?.schedule_state || session?.state || "active"),
  ].join(":");
}

function uniqueLessonSessionsByIdentity<T extends Record<string, unknown>>(sessions: T[] = []) {
  const seen = new Set<string>();

  return sessions.filter((session) => {
    const key = getLessonSessionIdentity(session);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildLessonDesignSessionSummary<
  T extends {
    monthKey?: string;
    progressLabel?: string;
    periodId?: string;
    dateValue?: string;
  },
>(
  sessions: T[] = [],
  periodSummaries: Array<{
    id: string;
    label: string;
    color: string;
    startDate: string;
    endDate: string;
    rangeLabel: string;
    sessionCount: number;
  }> = [],
) {
  const monthSummaryMap = new Map<string, { key: string; label: string; sessionCount: number; pendingCount: number }>();
  const periodSessionCounts = new Map(periodSummaries.map((period) => [period.id, 0]));
  const undatedSessions: T[] = [];
  let completedSessionCount = 0;
  let updatedSessionCount = 0;

  for (const session of sessions) {
    const monthKey = text(session.monthKey);
    const progressLabel = text(session.progressLabel);

    if (progressLabel === "완료") {
      completedSessionCount += 1;
    }
    if (progressLabel !== "대기") {
      updatedSessionCount += 1;
    }

    if (monthKey) {
      const monthSummary = monthSummaryMap.get(monthKey) || {
        key: monthKey,
        label: formatLessonMonthLabel(monthKey),
        sessionCount: 0,
        pendingCount: 0,
      };
      monthSummary.sessionCount += 1;
      if (progressLabel === "대기") {
        monthSummary.pendingCount += 1;
      }
      monthSummaryMap.set(monthKey, monthSummary);
    } else {
      undatedSessions.push(session);
    }

    for (const period of periodSummaries) {
      if (
        session.periodId === period.id ||
        isDateWithinRange(text(session.dateValue), period.startDate, period.endDate)
      ) {
        periodSessionCounts.set(period.id, (periodSessionCounts.get(period.id) || 0) + 1);
      }
    }
  }

  return {
    periodSummariesWithSessionCounts: periodSummaries.map((period) => ({
      ...period,
      sessionCount: period.sessionCount || periodSessionCounts.get(period.id) || 0,
    })),
    monthSummaries: [...monthSummaryMap.values()].sort((left, right) => left.key.localeCompare(right.key)),
    undatedSessions,
    completedSessionCount,
    updatedSessionCount,
    pendingSessionCount: Math.max(sessions.length - updatedSessionCount, 0),
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
        .sort(sortLessonSessionRecords)
    : [];
  const rawSessions =
    planOverride && Array.isArray(plan?.sessions)
      ? [...(plan.sessions as Record<string, unknown>[])]
          .sort(sortLessonSessionRecords)
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

  const textbookById = new Map(textbooks.map((book) => [text(book?.id), book]));
  const textbookMap = new Map(
    textbooks.map((book) => [text(book?.id), getTextbookTitle(book)]),
  );
  const rawTextbookIds = classItem?.textbook_ids || classItem?.textbookIds;
  const planTextbooks = Array.isArray(plan?.textbooks)
    ? (plan.textbooks as Record<string, unknown>[])
    : [];
  const textbookCatalogSource: Record<string, unknown>[] =
    planTextbooks.length > 0
      ? planTextbooks
      : Array.isArray(rawTextbookIds)
        ? rawTextbookIds.map((value, index) => ({
            textbookId: text(value),
            order: index,
            role: index === 0 ? "main" : "supplement",
          } as Record<string, unknown>))
        : [];
  const textbookCatalog = textbookCatalogSource
    .flatMap((entry, index) => {
      const textbookId = text(entry.textbookId || entry.textbook_id || entry.id);
      if (!textbookId) {
        return [];
      }
      const book = textbookById.get(textbookId) as Record<string, unknown> | undefined;
      const title = text(entry.alias) || getTextbookTitle(book) || textbookId || "교재 정보 없음";
      const publisher = getTextbookPublisher(book);
      const area = text(entry.area || entry.category) || getTextbookCategory(book);
      const subSubject = text(entry.subSubject || entry.sub_subject);
      const startSessionId = text(entry.startSessionId || entry.start_session_id);
      const endSessionId = text(entry.endSessionId || entry.end_session_id);
      return [{
        textbookId,
        title,
        sourceTitle: getTextbookTitle(book) || title,
        publisher,
        subject: getTextbookSubject(book),
        category: getTextbookCategory(book),
        area,
        subSubject,
        role: text(entry.role) || (index === 0 ? "main" : "supplement"),
        order: Number(entry.order ?? index) || index,
        scopeLabel: [area, subSubject].filter(Boolean).join(" · "),
        startSessionId,
        endSessionId,
      }];
    })
    .sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0));
  const textbookTitles = textbookCatalog.map((book) => text(book?.title)).filter(Boolean);

  const periodSummaries = billingPeriods.map((period, index) => ({
    id: text(period.id || period.period_id) || `period-${index}`,
    label: text(period.label || period.period_label) || `${index + 1}구간`,
    color: text(period.color || period.period_color) || "#216e4e",
    startDate: text(period.startDate || period.start_date),
    endDate: text(period.endDate || period.end_date),
    rangeLabel: formatScheduleRange(text(period.startDate || period.start_date), text(period.endDate || period.end_date)),
    sessionCount: Number(period.sessionCount || period.session_count || period.totalSessions || period.total_sessions || 0),
  }));
  const mappedSessions = rawSessions.map((session) => {
    const sessionNumber = Number(session.sessionNumber || session.session_number || 0);
    const sessionId = text(session.id || session.session_id);
    const sessionDate = text(session.date || session.session_date);
    const matchedActualSession = findMatchingLessonSessionRecord(actualSessions, {
      sessionId,
      sessionNumber,
      sessionDate,
    });
    const sessionSource = (matchedActualSession || session) as Record<string, unknown>;
    const monthKey = buildLessonMonthKey(sessionDate);
    const matchedPlanSession = findMatchingLessonSessionRecord(planSessions, {
      sessionId,
      sessionNumber,
      sessionDate,
    });
    const textbookEntrySources = planOverride
      ? [
          session.textbookEntries,
          session.textbook_entries,
          matchedPlanSession?.textbookEntries,
          matchedPlanSession?.textbook_entries,
          sessionSource.textbookEntries,
          sessionSource.textbook_entries,
        ]
      : [
          sessionSource.textbookEntries,
          sessionSource.textbook_entries,
          session.textbookEntries,
          session.textbook_entries,
          matchedPlanSession?.textbookEntries,
          matchedPlanSession?.textbook_entries,
        ];
    const textbookEntries = textbookEntrySources.find((entries) => Array.isArray(entries) && entries.length > 0) as
        | Record<string, unknown>[]
        | undefined;
    const scheduleContext = buildLessonScheduleContext(session, matchedPlanSession || null);
    const textbookEntrySummaries = buildTextbookEntrySummary(textbookEntries || [], textbookMap);
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
    const assignedTextbookEntryCount = textbookEntrySummaries.filter((entry) => entry.hasPlanContent).length;
    const textbookEntryPreview =
      textbookEntrySummaries.length === 0
        ? "교재 범위 미지정"
        : primaryTextbookEntry?.hasPlanContent
          ? primaryTextbookEntry.planLabel
          : `${textbookEntrySummaries.length}권 범위 미배정`;
    const generatedSessionLabel =
      sessionNumber > 0
        ? `${sessionNumber}회차`
        : text(scheduleContext.scheduleStateLabel) !== "정상"
          ? scheduleContext.scheduleStateLabel
          : sessionId || "회차 미정";

    return {
      id: sessionId || `${sessionNumber}-${sessionDate || "undated"}-${text(session.scheduleState || session.schedule_state || "active")}`,
      label: generatedSessionLabel,
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
          ? assignedTextbookEntryCount > 0
            ? `${assignedTextbookEntryCount}/${textbookEntrySummaries.length}권 배정`
            : `${textbookEntrySummaries.length}권 미배정`
          : "교재 범위 미지정",
      textbookEntryPreview,
      textbookEntries: textbookEntrySummaries,
      periodId: matchedPeriod?.id || "",
      periodLabel: matchedPeriod?.label || "전체 운영 구간",
    };
  });
  const sessions = uniqueLessonSessionsByIdentity(mappedSessions);
  const sessionSummary = buildLessonDesignSessionSummary(sessions, periodSummaries);
  const {
    periodSummariesWithSessionCounts,
    monthSummaries,
    undatedSessions,
    completedSessionCount,
    updatedSessionCount,
    pendingSessionCount,
  } = sessionSummary;
  const periodDiagnostics = buildLessonPeriodDiagnostics(periodSummariesWithSessionCounts);

  const firstPeriod = periodSummariesWithSessionCounts[0] || null;
  const lastPeriod = periodSummariesWithSessionCounts[periodSummariesWithSessionCounts.length - 1] || null;
  const plannerClassName =
    text(plan?.className || plan?.class_name || classItem?.className || classItem?.class_name) ||
    text(selectedRow.title) ||
    "수업명 미정";
  const plannerSubject = text(plan?.subject || classItem?.subject || selectedRow.subject) || "과목 미정";
  const plannerGrade = text(plan?.grade || classItem?.grade || selectedRow.grade);
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
    plannerGrade,
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
    textbookCatalog,
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

function scrollLessonDesignSectionAfterRender(sectionId: string) {
  if (typeof window === "undefined") {
    scrollLessonDesignSection(sectionId);
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => scrollLessonDesignSection(sectionId));
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

function getLessonDesignPeriodDetailId(monthKey: string) {
  return `${LESSON_DESIGN_PERIOD_DETAIL_ID_PREFIX}${text(monthKey)}`;
}

function scrollLessonDesignPeriodDetail(monthKey: string) {
  if (typeof document === "undefined") {
    return;
  }

  const target = document.getElementById(getLessonDesignPeriodDetailId(monthKey));
  target?.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "nearest",
  });
}

function scrollLessonDesignPeriodDetailAfterRender(monthKey: string) {
  if (typeof window === "undefined") {
    scrollLessonDesignPeriodDetail(monthKey);
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => scrollLessonDesignPeriodDetail(monthKey));
  });
}

function findLessonDesignElementByDataAttribute(attributeName: string, value: string) {
  if (typeof document === "undefined" || !text(value)) {
    return null;
  }

  return (
    Array.from(document.querySelectorAll(`[${attributeName}]`)).find(
      (element) => element.getAttribute(attributeName) === value,
    ) || null
  );
}

function scrollElementInsideContainerToCenter(container: Element, target: Element) {
  const scrollContainer = container as HTMLElement;
  const targetElement = target as HTMLElement;
  const overflowY =
    typeof window === "undefined" ? "" : window.getComputedStyle(scrollContainer).overflowY;
  const canScrollInside =
    scrollContainer.scrollHeight > scrollContainer.clientHeight + 1 &&
    /^(auto|scroll|overlay)$/.test(overflowY);

  if (!canScrollInside) {
    targetElement.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    return;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  const nextTop =
    scrollContainer.scrollTop +
    targetRect.top -
    containerRect.top -
    scrollContainer.clientHeight / 2 +
    targetRect.height / 2;

  scrollContainer.scrollTo({
    top: Math.max(0, nextTop),
    behavior: "smooth",
  });
}

function scrollLessonDesignSessionPair(sessionId: string) {
  if (typeof document === "undefined") {
    return;
  }

  const periodTarget = findLessonDesignElementByDataAttribute("data-lesson-period-session-id", sessionId);
  const periodSidebar = document.querySelector('[data-lesson-period-sidebar="true"]');

  if (periodTarget && periodSidebar?.contains(periodTarget)) {
    scrollElementInsideContainerToCenter(periodSidebar, periodTarget);
  } else {
    periodTarget?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
  }

  const calendarTarget = findLessonDesignElementByDataAttribute("data-lesson-calendar-session-id", sessionId);
  calendarTarget?.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "nearest",
  });
}

function scrollLessonDesignSessionPairAfterRender(sessionId: string) {
  if (typeof window === "undefined") {
    scrollLessonDesignSessionPair(sessionId);
    return;
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => scrollLessonDesignSessionPair(sessionId));
  });
}

function resolveRequestedLessonDesignSession(
  lessonDesignSnapshot: ReturnType<typeof buildLessonDesignSnapshot> | null | undefined,
  requestedSessionId: string,
  preferredSessionId: string = "",
) {
  const sessions = lessonDesignSnapshot?.sessions || [];
  if (sessions.length === 0) {
    return null;
  }

  return (
    sessions.find((session) => session.id === requestedSessionId) ||
    sessions.find((session) => session.id === preferredSessionId) ||
    sessions[0] ||
    null
  );
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
    const sessionKey = getLessonSessionIdentity(session as Record<string, unknown>);
    if (sessionBucket.some((existingSession) => getLessonSessionIdentity(existingSession as Record<string, unknown>) === sessionKey)) {
      months.set(session.monthKey, existingMonth);
      return;
    }
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
    textbookEntries?: Array<{ hasPlanContent?: boolean }>;
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

      let textbookSessionCount = 0;
      let outsideTextbookRangeCount = 0;
      let pendingCount = 0;
      for (const session of normalizedSessions) {
        if (session.progressStatus !== "done") {
          pendingCount += 1;
        }
        const textbookEntries = Array.isArray(session.textbookEntries) ? session.textbookEntries : [];
        if (textbookEntries.length > 0) {
          textbookSessionCount += 1;
        } else {
          outsideTextbookRangeCount += 1;
        }
      }

      return {
        ...group,
        label: normalizedSessions[0]?.monthLabel || group.label,
        billingLabel:
          group.billingLabel || normalizedSessions[0]?.billingLabel || normalizedSessions[0]?.periodLabel || "구간 미지정",
        billingColor: group.billingColor || normalizedSessions[0]?.billingColor || "#216e4e",
        sessions: normalizedSessions,
        sessionCount: countLessonGroupSessions(normalizedSessions),
        pendingCount,
        textbookSessionCount,
        outsideTextbookRangeCount,
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
  const [focusedLessonMonthKey, setFocusedLessonMonthKey] = useState("");
  const [selectedLessonPeriodId, setSelectedLessonPeriodId] = useState("all");
  const [selectedLessonScheduleState, setSelectedLessonScheduleState] = useState("all");
  const [selectedLessonSessionId, setSelectedLessonSessionId] = useState("");
  const [lessonMonthDetailsOpen, setLessonMonthDetailsOpen] = useState(false);
  const [lessonPlanDraft, setLessonPlanDraft] = useState<Record<string, unknown> | null>(null);
  const [isLessonDesignSaving, setIsLessonDesignSaving] = useState(false);
  const [lessonDesignSaveError, setLessonDesignSaveError] = useState("");
  const [lessonDesignSaveNotice, setLessonDesignSaveNotice] = useState("");
  const [lessonTextbookSearch, setLessonTextbookSearch] = useState("");
  const [lessonTextbookSubjectFilter, setLessonTextbookSubjectFilter] = useState("current");
  const [lessonTextbookCategoryFilter, setLessonTextbookCategoryFilter] = useState("all");
  const [lessonTextbookPublisherFilter, setLessonTextbookPublisherFilter] = useState("all");
  const [isLessonTextbookFinderOpen, setIsLessonTextbookFinderOpen] = useState(false);
  const [selectedLessonCalendarDate, setSelectedLessonCalendarDate] = useState("");
  const [lessonCalendarDragSource, setLessonCalendarDragSource] = useState("");
  const [lessonCalendarDropTarget, setLessonCalendarDropTarget] = useState("");
  const lessonPlanDraftRef = useRef<Record<string, unknown> | null>(null);
  const lessonPlanSourceKeyRef = useRef("");
  const deferredSearch = useDeferredValue(search);
  const deferredLessonTextbookSearch = useDeferredValue(lessonTextbookSearch);

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
  const lessonPlanSourceKey = useMemo(() => {
    const savedPlan = (selectedRowClassItem?.schedulePlan || selectedRowClassItem?.schedule_plan || {}) as Record<string, unknown>;
    const rawTextbookIds = selectedRowClassItem?.textbook_ids || selectedRowClassItem?.textbookIds;
    return JSON.stringify({
      classId: text(selectedRow?.id),
      savedPlan,
      textbookIds: Array.isArray(rawTextbookIds)
        ? rawTextbookIds.map((value) => text(value)).filter(Boolean)
        : [],
    });
  }, [selectedRow?.id, selectedRowClassItem]);
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
  const connectedLessonTextbookIds = useMemo(
    () =>
      new Set(
        (lessonDesignSnapshot?.textbookCatalog || [])
          .map((book) => text(book?.textbookId))
          .filter(Boolean),
      ),
    [lessonDesignSnapshot],
  );
  const lessonTextbookFilterOptions = useMemo(
    () => ({
      subjects: buildLessonTextbookSubjectFilterOptions(data.textbooks),
      categories: buildLessonTextbookFilterOptions(data.textbooks, getTextbookCategory),
      publishers: buildLessonTextbookFilterOptions(data.textbooks, getTextbookPublisher),
    }),
    [data.textbooks],
  );
  const lessonTextbookOptions = useMemo(() => {
    const plannerSubject =
      text(lessonDesignSnapshot?.plannerSubject) === "과목 미정"
        ? ""
        : text(lessonDesignSnapshot?.plannerSubject);
    const plannerSubjectKey = normalizeLessonSubjectKey(plannerSubject);
    const query = text(deferredLessonTextbookSearch).toLowerCase();
    const candidates: Array<{ book: Record<string, unknown>; score: number; title: string }> = [];

    for (const book of data.textbooks) {
      const id = text(book.id);
      if (!id || connectedLessonTextbookIds.has(id)) {
        continue;
      }

      const bookSubject = getTextbookSubject(book);
      const bookSubjectKey = normalizeLessonSubjectKey(bookSubject);
      if (lessonTextbookSubjectFilter === "current") {
        if (plannerSubjectKey && bookSubjectKey && bookSubjectKey !== plannerSubjectKey) {
          continue;
        }
      } else if (!matchesLessonSubjectFilter(bookSubject, lessonTextbookSubjectFilter)) {
        continue;
      }

      const category = getTextbookCategory(book);
      const publisher = getTextbookPublisher(book);
      if (
        !matchesLessonTextbookFilter(category, lessonTextbookCategoryFilter) ||
        !matchesLessonTextbookFilter(publisher, lessonTextbookPublisherFilter)
      ) {
        continue;
      }

      const title = getTextbookTitle(book);
      if (
        query &&
        ![title, publisher, category, bookSubject]
          .join(" ")
          .toLowerCase()
          .includes(query)
      ) {
        continue;
      }

      candidates.push({
        book,
        score: scoreLessonTextbookCandidate(book, lessonDesignSnapshot),
        title,
      });
    }

    return candidates
      .sort((left, right) => {
        const scoreGap =
          right.score - left.score;
        return scoreGap || left.title.localeCompare(right.title, "ko");
      })
      .slice(0, 18)
      .map((item) => item.book);
  }, [
    connectedLessonTextbookIds,
    data.textbooks,
    deferredLessonTextbookSearch,
    lessonDesignSnapshot,
    lessonTextbookCategoryFilter,
    lessonTextbookPublisherFilter,
    lessonTextbookSubjectFilter,
  ]);

  useEffect(() => {
    if (!selectedRow) {
      setLessonPlanDraft(null);
      setLessonDesignSaveError("");
      setLessonDesignSaveNotice("");
      lessonPlanDraftRef.current = null;
      lessonPlanSourceKeyRef.current = "";
      return;
    }
    if (lessonPlanSourceKeyRef.current === lessonPlanSourceKey) {
      return;
    }
    lessonPlanSourceKeyRef.current = lessonPlanSourceKey;

    const savedPlan =
      ((selectedRowClassItem?.schedulePlan || selectedRowClassItem?.schedule_plan || {}) as Record<string, unknown>) || {};
    const normalizedSavedPlan = normalizeSchedulePlan(savedPlan, lessonPlanDefaults) as Record<string, unknown>;
    setLessonPlanDraft(normalizedSavedPlan);
    lessonPlanDraftRef.current = normalizedSavedPlan;
    setLessonDesignSaveError("");
    setLessonDesignSaveNotice("");
  }, [lessonPlanDefaults, lessonPlanSourceKey, selectedRow, selectedRowClassItem]);

  useEffect(() => {
    lessonPlanDraftRef.current =
      ((normalizedLessonPlan || lessonPlanDraft || null) as Record<string, unknown> | null) || null;
  }, [lessonPlanDraft, normalizedLessonPlan]);

  useEffect(() => {
    if (!lessonDesignSnapshot) {
      setSelectedLessonMonthKeys([]);
      setFocusedLessonMonthKey("");
      setSelectedLessonPeriodId("all");
      setSelectedLessonScheduleState("all");
      setLessonTextbookSearch("");
      setLessonTextbookSubjectFilter("current");
      setLessonTextbookCategoryFilter("all");
      setLessonTextbookPublisherFilter("all");
      setIsLessonTextbookFinderOpen(false);
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

    setFocusedLessonMonthKey((current) => {
      const normalizedCurrent = normalizeSelectedLessonMonthKeys(
        current ? [current] : [],
        lessonDesignSnapshot.monthSummaries,
        { fallbackToDefault: false },
      );
      return normalizedCurrent[0] || getDefaultLessonMonthKeys(lessonDesignSnapshot.monthSummaries)[0] || "";
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

  const filteredLessonSessions = useMemo(() => {
    const sessions = uniqueLessonSessionsByIdentity(lessonDesignSnapshot?.sessions || []);

    return sessions.filter((session) => {
      const matchesPeriod = selectedLessonPeriodId === "all" || session.periodId === selectedLessonPeriodId;
      const matchesScheduleState =
        selectedLessonScheduleState === "all" || session.scheduleState === selectedLessonScheduleState;

      return matchesPeriod && matchesScheduleState;
    });
  }, [
    lessonDesignSnapshot,
    selectedLessonPeriodId,
    selectedLessonScheduleState,
  ]);

  const selectedLessonMonthSummaryMap = useMemo(
    () => new Map((lessonDesignSnapshot?.monthSummaries || []).map((month) => [month.key, month])),
    [lessonDesignSnapshot],
  );
  const defaultActiveLessonMonthKey =
    getDefaultLessonMonthKeys(lessonDesignSnapshot?.monthSummaries || [])[0] ||
    selectedLessonMonthKeys[0] ||
    lessonDesignSnapshot?.monthSummaries[0]?.key ||
    "";
  const activeLessonMonthKey =
    focusedLessonMonthKey && selectedLessonMonthSummaryMap.has(focusedLessonMonthKey)
      ? focusedLessonMonthKey
      : defaultActiveLessonMonthKey;

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

  const focusLessonMonthKey = (monthKey: string) => {
    const monthSummaries = lessonDesignSnapshot?.monthSummaries || [];
    const focusedMonthKeys = normalizeSelectedLessonMonthKeys(
      [monthKey],
      monthSummaries,
      { fallbackToDefault: false },
    );

    setSelectedLessonMonthKeys(getAllLessonMonthKeys(monthSummaries));
    setFocusedLessonMonthKey(focusedMonthKeys[0] || "");
    setSelectedLessonPeriodId("all");
    setSelectedLessonScheduleState("all");
  };

  const resetLessonDesignFilters = useCallback(
    (mode: "default" | "all" = "default") => {
      if (!lessonDesignSnapshot) {
        return;
      }

      const nextMonthKeys =
        mode === "all"
          ? getAllLessonMonthKeys(lessonDesignSnapshot.monthSummaries)
          : getDefaultLessonMonthKeys(lessonDesignSnapshot.monthSummaries);

      setSelectedLessonMonthKeys(nextMonthKeys);
      setFocusedLessonMonthKey(nextMonthKeys[0] || "");
      setSelectedLessonPeriodId("all");
      setSelectedLessonScheduleState("all");
    },
    [lessonDesignSnapshot],
  );

  const filteredLessonSessionById = useMemo(
    () => new Map(filteredLessonSessions.map((session) => [text(session.id), session])),
    [filteredLessonSessions],
  );
  const lessonDesignSessionById = useMemo(
    () => new Map((lessonDesignSnapshot?.sessions || []).map((session) => [text(session.id), session])),
    [lessonDesignSnapshot],
  );
  const firstPendingLessonSession = useMemo(
    () => filteredLessonSessions.find((session) => session.progressLabel !== "완료") || filteredLessonSessions[0] || null,
    [filteredLessonSessions],
  );

  useEffect(() => {
    if (!filteredLessonSessions.length) {
      setSelectedLessonSessionId("");
      return;
    }

    setSelectedLessonSessionId((current) => {
      if (current && filteredLessonSessionById.has(current)) {
        return current;
      }
      return firstPendingLessonSession?.id || "";
    });
  }, [filteredLessonSessionById, filteredLessonSessions.length, firstPendingLessonSession]);

  const selectedLessonSession = useMemo(
    () =>
      filteredLessonSessionById.get(selectedLessonSessionId) ||
      filteredLessonSessions[0] ||
      null,
    [filteredLessonSessionById, filteredLessonSessions, selectedLessonSessionId],
  );
  const lastRequestedLessonSessionKeyRef = useRef("");
  const pendingLessonSessionNavigationKeyRef = useRef("");
  const markPendingLessonSessionSelection = useCallback(
    (sessionId: string, row: Record<string, unknown> | null = selectedRow) => {
      const resolvedSessionId = text(sessionId);
      if (!resolvedSessionId) {
        return;
      }

      const nextLessonSessionKey = `${text(row?.id || selectedRow?.id || selectedClassId)}:${resolvedSessionId}`;
      lastRequestedLessonSessionKeyRef.current = nextLessonSessionKey;
      pendingLessonSessionNavigationKeyRef.current = nextLessonSessionKey;
      setSelectedLessonSessionId(resolvedSessionId);

      const targetSession =
        lessonDesignSessionById.get(resolvedSessionId) ||
        filteredLessonSessionById.get(resolvedSessionId) ||
        null;
      const targetDate = text(targetSession?.dateValue);
      if (targetDate) {
        setSelectedLessonCalendarDate(targetDate);
      }
    },
    [filteredLessonSessionById, lessonDesignSessionById, selectedClassId, selectedRow],
  );
  useEffect(() => {
    setLessonCalendarDragSource("");
    setLessonCalendarDropTarget("");
  }, [lessonDesignSnapshot]);
  useEffect(() => {
    setSelectedLessonCalendarDate("");
  }, [selectedClassId]);

  const lessonSessionIndexById = useMemo(
    () => new Map(filteredLessonSessions.map((session, index) => [text(session.id), index])),
    [filteredLessonSessions],
  );
  const selectedLessonSessionIndex = useMemo(
    () => lessonSessionIndexById.get(text(selectedLessonSession?.id)) ?? -1,
    [lessonSessionIndexById, selectedLessonSession],
  );
  const previousLessonSession =
    selectedLessonSessionIndex > 0 ? filteredLessonSessions[selectedLessonSessionIndex - 1] || null : null;
  const nextLessonSession =
    selectedLessonSessionIndex >= 0 && selectedLessonSessionIndex < filteredLessonSessions.length - 1
      ? filteredLessonSessions[selectedLessonSessionIndex + 1] || null
      : null;
  const lessonTextbookProgressSessions = useMemo(
    () => filteredLessonSessions.filter((session) => session.textbookEntries.length > 0),
    [filteredLessonSessions],
  );
  const selectedLessonTextbookProgressSessionIndex = useMemo(
    () => lessonTextbookProgressSessions.findIndex((session) => session.id === selectedLessonSession?.id),
    [lessonTextbookProgressSessions, selectedLessonSession],
  );
  const lessonTextbookCompletedSessionCount = useMemo(
    () =>
      lessonTextbookProgressSessions.filter((session) =>
        session.textbookEntries.every((entry) => entry.hasPlanContent),
      ).length,
    [lessonTextbookProgressSessions],
  );
  const lessonTextbookSelectedCount = lessonDesignSnapshot?.textbookCatalog.length || 0;
  const hasLessonTextbooks = lessonTextbookSelectedCount > 0;
  const lessonTextbookPendingSessionCount =
    lessonTextbookProgressSessions.length - lessonTextbookCompletedSessionCount;
  const lessonTextbookOutOfRangeSessionCount = hasLessonTextbooks
    ? Math.max(filteredLessonSessions.length - lessonTextbookProgressSessions.length, 0)
    : 0;
  const nextPendingLessonSession =
    lessonTextbookProgressSessions.find((session) =>
      session.textbookEntries.some((entry) => !entry.hasPlanContent),
    ) || null;
  const firstOutOfRangeLessonSession =
    hasLessonTextbooks
      ? filteredLessonSessions.find((session) => session.textbookEntries.length === 0) || null
      : null;
  const lessonSessionJumpOptions = useMemo(() => {
    const optionsById = new Map<string, (typeof filteredLessonSessions)[number]>();
    const addSession = (session: (typeof filteredLessonSessions)[number] | null | undefined) => {
      const sessionId = text(session?.id);
      if (!session || !sessionId) {
        return;
      }
      optionsById.set(sessionId, session);
    };

    addSession(previousLessonSession);
    addSession(selectedLessonSession);
    addSession(nextLessonSession);
    addSession(nextPendingLessonSession);
    addSession(firstOutOfRangeLessonSession);

    for (const session of lessonTextbookProgressSessions) {
      if (optionsById.size >= 12) {
        break;
      }
      if (session.textbookEntries.some((entry) => !entry.hasPlanContent)) {
        addSession(session);
      }
    }

    const options = Array.from(optionsById.values());
    if (!options.length) {
      return filteredLessonSessions.slice(0, 12);
    }
    return options.sort(
      (left, right) =>
        (lessonSessionIndexById.get(text(left.id)) ?? Number.MAX_SAFE_INTEGER) -
        (lessonSessionIndexById.get(text(right.id)) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [
    filteredLessonSessions,
    firstOutOfRangeLessonSession,
    lessonSessionIndexById,
    lessonTextbookProgressSessions,
    nextLessonSession,
    nextPendingLessonSession,
    previousLessonSession,
    selectedLessonSession,
  ]);
  const selectedLessonSessionAssignedTextbookCount =
    selectedLessonSession?.textbookEntries.filter((entry) => entry.hasPlanContent).length || 0;
  const selectedLessonSessionOutsideTextbookRange = Boolean(
    hasLessonTextbooks && selectedLessonSession && selectedLessonSession.textbookEntries.length === 0,
  );
  const selectedLessonSessionSummaryLabel = selectedLessonSession
    ? [selectedLessonSession.label, selectedLessonSession.dateLabel].filter(Boolean).join(" · ")
    : "";
  const selectedLessonSessionRangeStateLabel = selectedLessonSessionOutsideTextbookRange
    ? "기간 밖"
    : selectedLessonSession && selectedLessonSession.textbookEntries.length > 0
      ? `${selectedLessonSessionAssignedTextbookCount}/${selectedLessonSession.textbookEntries.length}권`
      : "";
  const lessonDesignReadinessActions = useMemo(
    () => buildLessonDesignReadinessActions(lessonDesignSnapshot, selectedLessonSession),
    [lessonDesignSnapshot, selectedLessonSession],
  );
  const updateLessonPlanDraft = useCallback(
    (updater: (current: Record<string, unknown>) => Record<string, unknown>) => {
      setLessonPlanDraft((current) => {
        const nextBase = (current || {}) as Record<string, unknown>;
        const nextDraft = normalizeSchedulePlan(updater(nextBase), lessonPlanDefaults) as Record<string, unknown>;
        lessonPlanDraftRef.current = nextDraft;
        return nextDraft;
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
  const handleAddLessonTextbook = useCallback((nextTextbookId: string) => {
    const textbookId = text(nextTextbookId);
    if (!textbookId) {
      return;
    }
    const textbook = data.textbooks.find((book) => text(book.id) === textbookId);
    const firstSessionId = text(filteredLessonSessions[0]?.id);
    const selectedSessionId = text(selectedLessonSession?.id);
    const endSessionId = text(filteredLessonSessions[filteredLessonSessions.length - 1]?.id);

    updateLessonPlanDraft((current) => {
      const currentBooks = Array.isArray(current.textbooks)
        ? (current.textbooks as Record<string, unknown>[])
        : [];
      if (currentBooks.some((book) => text(book.textbookId || book.id) === textbookId)) {
        return current;
      }

      return {
        ...current,
        textbooks: [
          ...currentBooks,
          {
            textbookId,
            order: currentBooks.length,
            role: currentBooks.length === 0 ? "main" : "supplement",
            alias: getTextbookTitle(textbook),
            area: getTextbookCategory(textbook),
            subSubject: "",
            startSessionId: currentBooks.length === 0 ? firstSessionId : selectedSessionId || firstSessionId,
            endSessionId,
          },
        ],
      };
    });
    setLessonTextbookSearch("");
    setIsLessonTextbookFinderOpen(false);
  }, [data.textbooks, filteredLessonSessions, selectedLessonSession, updateLessonPlanDraft]);
  const handleRemoveLessonTextbook = useCallback(
    (textbookId: string) => {
      const targetTextbookId = text(textbookId);
      if (!targetTextbookId) {
        return;
      }

      updateLessonPlanDraft((current) => {
        const remainingBooks = (Array.isArray(current.textbooks)
          ? (current.textbooks as Record<string, unknown>[])
          : []
        )
          .filter((book) => text(book.textbookId || book.id) !== targetTextbookId)
          .map((book, index) => ({
            ...book,
            order: index,
            role: index === 0 ? "main" : text(book.role) || "supplement",
          }));

        return {
          ...current,
          textbooks: remainingBooks,
        };
      });
    },
    [updateLessonPlanDraft],
  );
  const handleLessonTextbookCatalogRange = useCallback(
    (
      textbookId: string,
      range: {
        startSessionId?: string;
        endSessionId?: string;
      },
    ) => {
      const targetTextbookId = text(textbookId);
      if (!targetTextbookId) {
        return;
      }

      updateLessonPlanDraft((current) => {
        const currentBooks = Array.isArray(current.textbooks)
          ? (current.textbooks as Record<string, unknown>[])
          : [];
        return {
          ...current,
          textbooks: currentBooks.map((book, index) =>
            text(book.textbookId || book.id) === targetTextbookId
              ? {
                  ...book,
                  order: index,
                  startSessionId: text(range.startSessionId),
                  endSessionId: text(range.endSessionId),
                }
              : { ...book, order: index },
          ),
        };
      });
    },
    [updateLessonPlanDraft],
  );
  const handleLessonTextbookCatalogChange = useCallback(
    (
      textbookId: string,
      field: "role" | "alias" | "area" | "subSubject" | "startSessionId" | "endSessionId",
      value: string,
    ) => {
      const targetTextbookId = text(textbookId);
      if (!targetTextbookId) {
        return;
      }

      updateLessonPlanDraft((current) => {
        const currentBooks = Array.isArray(current.textbooks)
          ? (current.textbooks as Record<string, unknown>[])
          : [];
        return {
          ...current,
          textbooks: currentBooks.map((book, index) => {
            const isTarget = text(book.textbookId || book.id) === targetTextbookId;
            if (!isTarget && field === "role" && value === "main") {
              return { ...book, role: "supplement", order: index };
            }
            if (!isTarget) {
              return { ...book, order: index };
            }
            return {
              ...book,
              order: index,
              [field]: field === "role" ? (value === "main" ? "main" : "supplement") : value,
            };
          }),
        };
      });
    },
    [updateLessonPlanDraft],
  );
  const handleIncludeLessonSessionInTextbookRange = useCallback(
    (sessionId: string) => {
      const targetSessionId = text(sessionId);
      const targetIndex = filteredLessonSessions.findIndex((session) => session.id === targetSessionId);
      if (!targetSessionId || targetIndex < 0) {
        return;
      }

      updateLessonPlanDraft((current) => {
        const currentBooks = Array.isArray(current.textbooks)
          ? (current.textbooks as Record<string, unknown>[])
          : [];
        if (currentBooks.length === 0) {
          return current;
        }

        const lastSessionId = filteredLessonSessions[filteredLessonSessions.length - 1]?.id || targetSessionId;

        return {
          ...current,
          textbooks: currentBooks.map((book) => {
            const startSessionId = text(book.startSessionId || book.start_session_id);
            const endSessionId = text(book.endSessionId || book.end_session_id);
            const startIndex = startSessionId
              ? filteredLessonSessions.findIndex((session) => session.id === startSessionId)
              : 0;
            const endIndex = endSessionId
              ? filteredLessonSessions.findIndex((session) => session.id === endSessionId)
              : filteredLessonSessions.length - 1;
            const resolvedStartIndex = startIndex >= 0 ? startIndex : 0;
            const resolvedEndIndex = endIndex >= 0 ? endIndex : filteredLessonSessions.length - 1;

            if (targetIndex < resolvedStartIndex) {
              return { ...book, startSessionId: targetSessionId };
            }
            if (targetIndex > resolvedEndIndex) {
              return { ...book, endSessionId: targetSessionId || lastSessionId };
            }
            return book;
          }),
        };
      });
      markPendingLessonSessionSelection(targetSessionId);
    },
    [filteredLessonSessions, markPendingLessonSessionSelection, updateLessonPlanDraft],
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
        setSelectedLessonMonthKeys(getAllLessonMonthKeys(nextLessonDesignSnapshot?.monthSummaries || []));
        setFocusedLessonMonthKey(nextFocusedSession.monthKey);
      }
      setSelectedLessonPeriodId("all");
      setSelectedLessonScheduleState("all");
      if (nextFocusedSession?.id) {
        const nextFocusedDate = text(nextFocusedSession.dateValue) || focusTargetDate || focusSourceDate;
        if (nextFocusedDate) {
          setSelectedLessonCalendarDate(nextFocusedDate);
        }
        markPendingLessonSessionSelection(nextFocusedSession.id);
      }
    },
    [data.textbooks, lessonPlanDefaults, markPendingLessonSessionSelection, selectedRow],
  );
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
        setSelectedLessonMonthKeys(getAllLessonMonthKeys(lessonDesignSnapshot.monthSummaries || []));
        setFocusedLessonMonthKey(nextMonthKey);
      }
      setSelectedLessonPeriodId("all");
      setSelectedLessonScheduleState("all");
      if (nextFocusedSession?.id) {
        markPendingLessonSessionSelection(nextFocusedSession.id);
        setLessonMonthDetailsOpen(true);
        scrollLessonDesignSessionPairAfterRender(nextFocusedSession.id);
      }
    },
    [lessonDesignSnapshot, markPendingLessonSessionSelection],
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

      if (meta.hasSession) {
        handleLessonCalendarSelect(dateKey);
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

      updateLessonPlanDraft((current) =>
        applyTextbookPlanRangeField(current, lessonPlanDefaults, {
          sessionId,
          entryId,
          field,
          value,
        }) as Record<string, unknown>,
      );
      markPendingLessonSessionSelection(sessionId);
    },
    [lessonPlanDefaults, markPendingLessonSessionSelection, updateLessonPlanDraft],
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
      options: { sessionId?: string; monthKeys?: string[]; sectionId?: string } = {},
    ) => {
      if (!row) {
        return;
      }

      const nextLessonDesignSnapshot = buildLessonDesignSnapshot(row, data.textbooks);
      if (!nextLessonDesignSnapshot) {
        return;
      }

      setSelectedClassId(text(row.id));
      const targetSession =
        nextLessonDesignSnapshot.sessions.find((session) => session.id === options.sessionId) || null;
      const allMonthKeys = getAllLessonMonthKeys(nextLessonDesignSnapshot.monthSummaries);
      const requestedMonthKeys = normalizeSelectedLessonMonthKeys(
        options.monthKeys || [],
        nextLessonDesignSnapshot.monthSummaries,
        { fallbackToDefault: false },
      );
      const nextSelectedMonthKeys = allMonthKeys;
      setSelectedLessonMonthKeys(nextSelectedMonthKeys);
      setFocusedLessonMonthKey(targetSession?.monthKey || requestedMonthKeys[0] || nextSelectedMonthKeys[0] || "");
      setSelectedLessonPeriodId("all");
      setSelectedLessonScheduleState("all");
      setSelectedLessonSessionId(
        targetSession?.id ||
          nextLessonDesignSnapshot.sessions.find((session) => session.progressLabel !== "완료")?.id ||
          nextLessonDesignSnapshot.sessions[0]?.id ||
          "",
      );
      setLessonMonthDetailsOpen(
        resolveLessonDesignSectionId(options.sectionId || "") === LESSON_DESIGN_SECTION_IDS.periods &&
          Boolean(targetSession?.id),
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
  const requestedClassId = text(searchParams.get("classId"));
  const requestedSessionId = text(searchParams.get("sessionId"));
  const requestedLessonDesignSectionId = resolveLessonDesignSectionId(text(searchParams.get("section")));
  const requestedLessonMonthKeys = useMemo(
    () =>
      text(searchParams.get("lessonMonths"))
        .split(",")
        .map((value) => text(value))
        .filter(Boolean),
    [searchParams],
  );
  const requestedLessonPeriodId = text(searchParams.get("lessonPeriod")) || "all";
  const requestedLessonScheduleState = resolveLessonDesignScheduleState(
    text(searchParams.get("lessonScheduleState")),
  );
  const lastScrolledLessonDesignSectionKeyRef = useRef("");
  const lastSyncedLessonSessionPairKeyRef = useRef("");

  const closeLessonDesignWorkspace = useCallback(() => {
    setLessonDesignOpen(false);
    router.replace(
      buildCurriculumWorkspaceHref(new URLSearchParams(searchParams.toString())),
      { scroll: false },
    );
  }, [router, searchParams]);

  useEffect(() => {
    if (!isLessonDesignPage || !searchParams.has("lessonMonths")) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("lessonMonths");
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }, [isLessonDesignPage, pathname, router, searchParams]);

  const navigateToLessonDesignSection = useCallback(
    (
      sectionId: string,
      row: Record<string, unknown> | null = selectedRow,
      sessionId: string = text(selectedLessonSession?.id),
      options: { scroll?: boolean } = {},
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

      if (options.scroll !== false) {
        scrollLessonDesignSectionAfterRender(resolvedSectionId);
      }
    },
    [isLessonDesignPage, router, selectedLessonSession, selectedRow],
  );

  const focusLessonDesignSession = useCallback(
    (
      sessionId: string,
      {
        row = selectedRow,
        sectionId = LESSON_DESIGN_SECTION_IDS.calendar,
        scrollMode = "editor",
      }: {
        row?: Record<string, unknown> | null;
        sectionId?: string;
        scrollMode?: "editor" | "section" | "sync" | "none";
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
        setSelectedLessonMonthKeys(getAllLessonMonthKeys(lessonDesignSnapshot?.monthSummaries || []));
        setFocusedLessonMonthKey(scopedSession.monthKey);
      }
      setSelectedLessonPeriodId("all");
      setLessonMonthDetailsOpen(true);

      markPendingLessonSessionSelection(resolvedSessionId, targetRow);
      navigateToLessonDesignSection(targetSectionId, targetRow, resolvedSessionId, {
        scroll: scrollMode !== "none" && scrollMode !== "sync",
      });
      if (
        scrollMode === "editor" &&
        (targetSectionId === LESSON_DESIGN_SECTION_IDS.periods ||
          targetSectionId === LESSON_DESIGN_SECTION_IDS.board)
      ) {
        scrollLessonDesignSelectedSessionEditorAfterRender();
      } else if (scrollMode === "sync") {
        scrollLessonDesignSessionPairAfterRender(resolvedSessionId);
      } else if (scrollMode === "none" && scopedSession?.monthKey) {
        scrollLessonDesignPeriodDetailAfterRender(scopedSession.monthKey);
      }
    },
    [filteredLessonSessions, lessonDesignSnapshot, markPendingLessonSessionSelection, navigateToLessonDesignSection, selectedRow],
  );

  useEffect(() => {
    if (!isLessonDesignPage || !lessonDesignSnapshot || lessonDesignOpen) {
      return;
    }

    const allLessonMonthKeys = getAllLessonMonthKeys(lessonDesignSnapshot.monthSummaries);
    const shouldSyncLessonMonths =
      searchParams.has("lessonMonths") &&
      !areSameLessonMonthSelection(
        allLessonMonthKeys,
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
      setSelectedLessonMonthKeys(allLessonMonthKeys);
    }
    if (shouldSyncLessonPeriod) {
      setSelectedLessonPeriodId(requestedLessonPeriodId);
    }
    if (shouldSyncLessonScheduleState) {
      setSelectedLessonScheduleState(requestedLessonScheduleState);
    }
  }, [
    isLessonDesignPage,
    lessonDesignOpen,
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

    const selectedSessionId = text(selectedLessonSession?.id);
    const animationFrameId = window.requestAnimationFrame(() => {
      if (requestedLessonDesignSectionId === LESSON_DESIGN_SECTION_IDS.periods && selectedSessionId) {
        scrollLessonDesignSessionPair(selectedSessionId);
        return;
      }

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

  useEffect(() => {
    if (
      !isLessonDesignPage ||
      requestedLessonDesignSectionId !== LESSON_DESIGN_SECTION_IDS.periods ||
      !selectedLessonSession?.id
    ) {
      lastSyncedLessonSessionPairKeyRef.current = "";
      return;
    }

    const syncKey = [text(selectedRow?.id), selectedLessonSession.id, requestedLessonDesignSectionId].join(":");
    if (lastSyncedLessonSessionPairKeyRef.current === syncKey) {
      return;
    }

    lastSyncedLessonSessionPairKeyRef.current = syncKey;
    scrollLessonDesignSessionPairAfterRender(selectedLessonSession.id);
  }, [
    isLessonDesignPage,
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

  useEffect(() => {
  
  if (loading) {
      return;
    }

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
      (requestedSessionId ? LESSON_DESIGN_SECTION_IDS.board : LESSON_DESIGN_SECTION_IDS.periods);

    if (!isLessonDesignPage) {
      router.replace(buildLessonDesignPageHref(targetRow, requestedSessionId || "", targetSectionId), {
        scroll: false,
      });
      return;
    }

    if (lessonDesignOpen && selectedClassId === requestedClassId) {
      return;
    }

    openLessonDesignForRow(targetRow, {
      sessionId: requestedSessionId || undefined,
      monthKeys: requestedLessonMonthKeys,
      sectionId: targetSectionId,
    });
  }, [
    allRowsModel.rows,
    lessonDesignOpen,
    loading,
    openLessonDesignForRow,
    isLessonDesignPage,
    pathname,
    requestedClassId,
    router,
    searchParams,
    requestedLessonDesignSectionId,
    requestedLessonMonthKeys,
    selectedClassId,
    selectedLessonSessionId,
  ]);

  useEffect(() => {
    if (!isLessonDesignPage || !lessonDesignOpen || !requestedSessionId) {
      if (!requestedSessionId) {
        lastRequestedLessonSessionKeyRef.current = "";
        pendingLessonSessionNavigationKeyRef.current = "";
      }
      return;
    }

    const resolvedRequestedSession = resolveRequestedLessonDesignSession(
      lessonDesignSnapshot,
      requestedSessionId,
      selectedLessonSessionId,
    );
    if (!resolvedRequestedSession) {
      return;
    }

    const requestedLessonSessionKey = `${requestedClassId}:${resolvedRequestedSession.id}`;
    if (
      pendingLessonSessionNavigationKeyRef.current &&
      pendingLessonSessionNavigationKeyRef.current !== requestedLessonSessionKey
    ) {
      return;
    }
    if (pendingLessonSessionNavigationKeyRef.current === requestedLessonSessionKey) {
      pendingLessonSessionNavigationKeyRef.current = "";
    }
    if (
      lastRequestedLessonSessionKeyRef.current === requestedLessonSessionKey &&
      selectedLessonSessionId === resolvedRequestedSession.id
    ) {
      return;
    }

    lastRequestedLessonSessionKeyRef.current = requestedLessonSessionKey;
    if (resolvedRequestedSession.monthKey) {
      setFocusedLessonMonthKey((current) =>
        current === resolvedRequestedSession.monthKey ? current : resolvedRequestedSession.monthKey,
      );
    }
    if (requestedLessonDesignSectionId === LESSON_DESIGN_SECTION_IDS.periods) {
      setLessonMonthDetailsOpen((current) => (current ? current : true));
      scrollLessonDesignSessionPairAfterRender(resolvedRequestedSession.id);
    }
    if (selectedLessonSessionId !== resolvedRequestedSession.id) {
      setSelectedLessonSessionId(resolvedRequestedSession.id);
    }

    if (resolvedRequestedSession.id !== requestedSessionId && selectedRow) {
      const nextParams = buildLessonDesignSearchParams({
        currentParams: new URLSearchParams(searchParams.toString()),
        classId: requestedClassId,
        sessionId: resolvedRequestedSession.id,
        sectionId: requestedLessonDesignSectionId || LESSON_DESIGN_SECTION_IDS.board,
        monthKeys: [],
      });
      router.replace(`/admin/curriculum/lesson-design?${nextParams.toString()}`, { scroll: false });
    }
  }, [
    isLessonDesignPage,
    lessonDesignOpen,
    lessonDesignSnapshot,
    requestedClassId,
    requestedLessonDesignSectionId,
    requestedLessonMonthKeys,
    requestedSessionId,
    router,
    searchParams,
    selectedRow,
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
        sessionId: isLessonDesignPage ? selectedLessonSessionId : "",
        sectionId:
          isLessonDesignPage
            ? requestedLessonDesignSectionId ||
              (selectedLessonSessionId ? LESSON_DESIGN_SECTION_IDS.board : "")
            : "",
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
    lessonDesignSnapshot,
    requestedLessonDesignSectionId,
    selectedLessonSessionId,
    selectedRow,
  ]);

  const lessonDesignTitle = selectedRow?.title || "수업 설계";
  const lessonDesignDescription = selectedRow
    ? `${selectedRow.termName || "학기 미정"} · ${selectedRow.teacher || "선생님 미정"}`
    : "수업 설계";

  if (loading) {
    return <ClassScheduleSkeleton />;
  }

  const lessonDesignActiveMode =
    requestedLessonDesignSectionId === LESSON_DESIGN_SECTION_IDS.board ? "progress" : "schedule";
  const isLessonDesignProgressMode = lessonDesignActiveMode === "progress";
  const lessonTextbookSubjectFilterLabel =
    lessonTextbookSubjectFilter === "current"
      ? "수업 과목"
      : lessonTextbookSubjectFilter === "all"
        ? "전체 과목"
        : getLessonSubjectDisplayLabel(lessonTextbookSubjectFilter);
  const lessonTextbookCategoryFilterLabel =
    lessonTextbookCategoryFilter === "all" ? "전체 구분" : lessonTextbookCategoryFilter;
  const lessonTextbookPublisherFilterLabel =
    lessonTextbookPublisherFilter === "all" ? "전체 출판사" : lessonTextbookPublisherFilter;
  const lessonTextbookFilterSummary = [
    lessonTextbookSubjectFilterLabel,
    lessonTextbookCategoryFilter !== "all" ? lessonTextbookCategoryFilterLabel : "",
    lessonTextbookPublisherFilter !== "all" ? lessonTextbookPublisherFilterLabel : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const activeLessonTextbookFilterCount = [
    lessonTextbookSubjectFilter !== "current",
    lessonTextbookCategoryFilter !== "all",
    lessonTextbookPublisherFilter !== "all",
  ].filter(Boolean).length;
  const lessonTextbookFinderHasQuery =
    Boolean(text(lessonTextbookSearch)) || activeLessonTextbookFilterCount > 0;
  const isLessonTextbookFinderVisible =
    !hasLessonTextbooks || isLessonTextbookFinderOpen || lessonTextbookFinderHasQuery;
  const lessonDesignWorkQueueItems = isLessonDesignProgressMode
    ? [
        {
          key: "textbooks",
          label: "수업교재",
          value: `${lessonTextbookSelectedCount}권`,
          sectionId: LESSON_DESIGN_SECTION_IDS.textbooks,
          targetSessionId: "",
        },
        {
          key: "progress",
          label: "진도",
          value:
            lessonTextbookProgressSessions.length > 0
              ? `${lessonTextbookCompletedSessionCount}/${lessonTextbookProgressSessions.length}`
              : "0/0",
          sectionId: LESSON_DESIGN_SECTION_IDS.board,
          targetSessionId: "",
        },
        {
          key: "pending",
          label: "미배정",
          value: `${lessonTextbookPendingSessionCount}회`,
          sectionId: LESSON_DESIGN_SECTION_IDS.board,
          targetSessionId: nextPendingLessonSession?.id || "",
        },
        {
          key: "out-of-range",
          label: "기간 밖",
          value: `${lessonTextbookOutOfRangeSessionCount}회`,
          sectionId: LESSON_DESIGN_SECTION_IDS.board,
          targetSessionId: firstOutOfRangeLessonSession?.id || "",
        },
        {
          key: "selected",
          label: "현재 회차",
          value: selectedLessonSessionSummaryLabel || "회차 선택",
          sectionId: LESSON_DESIGN_SECTION_IDS.board,
          targetSessionId: "",
        },
      ]
    : [];
  const renderLessonMonthSessionDetails = (
    sessions: typeof filteredLessonSessions,
    options: { showScheduleControls?: boolean; showTextbookPlans?: boolean } = {},
  ) => {
    const showScheduleControls = options.showScheduleControls ?? true;
    const showTextbookPlans = options.showTextbookPlans ?? true;
    const hideSessionHeader = !showScheduleControls && showTextbookPlans && sessions.length === 1;

    return (
    <div className={cn("mt-3", !hideSessionHeader && "border-t")}>
      <div className={cn("space-y-2", hideSessionHeader ? "py-0" : "px-2 py-3")}>
        {sessions.length > 0 ? (
          sessions.map((session) => {
            const isSelectedSession = selectedLessonSession?.id === session.id;
            const hasSessionTextbookEntries = session.textbookEntries.length > 0;
            const isSessionOutsideTextbookRange =
              showTextbookPlans && hasLessonTextbooks && !hasSessionTextbookEntries;
            return (
                <div
                  key={`month-session-edit-${session.id}`}
                  id={isSelectedSession ? LESSON_DESIGN_SELECTED_SESSION_EDITOR_ID : undefined}
                  data-lesson-period-session-id={session.id}
                  data-lesson-selected-editor={isSelectedSession ? "true" : "false"}
                  className={cn(
                    "overflow-hidden rounded-[1rem] border bg-background scroll-mt-28",
                    isSelectedSession && "border-primary/50 shadow-sm",
                )}
              >
                {!hideSessionHeader ? (
                <button
                  type="button"
                  aria-pressed={isSelectedSession}
                  aria-current={isSelectedSession ? "true" : undefined}
                  className={cn(
                    "flex w-full flex-wrap items-center justify-between gap-2 border-l-4 border-l-transparent px-3 py-2.5 text-left transition-colors hover:bg-muted/30",
                    isSelectedSession && "border-l-primary bg-primary/5",
                  )}
                  onPointerDown={() => markPendingLessonSessionSelection(session.id)}
                  onClick={() =>
                    focusLessonDesignSession(session.id, {
                      sectionId: LESSON_DESIGN_SECTION_IDS.periods,
                      scrollMode: "sync",
                    })
                  }
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
                    {hasSessionTextbookEntries ? (
                      <Badge variant="outline">{session.textbookEntryLabel}</Badge>
                    ) : isSessionOutsideTextbookRange ? (
                      <Badge variant="outline">기간 밖</Badge>
                    ) : null}
                  </span>
                </button>
                ) : null}

                {isSelectedSession && selectedLessonSession ? (
                  <div className={cn("bg-background", hideSessionHeader ? "py-0" : "border-t px-3 py-3")}>
                    {showScheduleControls ? (
                      <>
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
                      </>
                    ) : null}

                    {showTextbookPlans ? (
                      selectedLessonSession.textbookEntries.length > 0 ? (
                      <div className={cn("rounded-[1rem] border bg-muted/10 p-3", hideSessionHeader ? "mt-0" : "mt-3")}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">
                              {hideSessionHeader
                                ? selectedLessonSessionSummaryLabel || "회차 진도"
                                : "진도 편집"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {hideSessionHeader
                                ? "교재별 진도"
                                : `${selectedLessonSession.label} · ${selectedLessonSession.dateLabel}`}
                            </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary">
                                {Math.max(selectedLessonTextbookProgressSessionIndex + 1, 1)}/{lessonTextbookProgressSessions.length}회
                              </Badge>
                            <Badge variant="outline">
                              {selectedLessonSessionAssignedTextbookCount}/{selectedLessonSession.textbookEntries.length}권 배정
                            </Badge>
                          </div>
                        </div>
                        <div className="mt-3 space-y-3">
                          {selectedLessonSession.textbookEntries.map((entry) => (
                            <div
                              key={`plan-editor-${selectedLessonSession.id}-${entry.id}`}
                              className={cn(
                                "rounded-[0.9rem] border border-l-4 bg-background p-3",
                                entry.hasPlanContent ? "border-l-primary" : "border-l-muted-foreground/25",
                              )}
                            >
                              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-foreground">{entry.textbookTitle}</p>
                                  {entry.scopeLabel ? (
                                    <p className="mt-0.5 text-xs text-muted-foreground">{entry.scopeLabel}</p>
                                  ) : null}
                                </div>
                                <Badge variant={entry.hasPlanContent ? "secondary" : "outline"}>
                                  {entry.hasPlanContent ? entry.planLabel : "미배정"}
                                </Badge>
                              </div>
                              <div className="grid gap-2 lg:grid-cols-4">
                                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                                  <span>시작 범위</span>
                                  <Input
                                    value={entry.planStart}
                                    aria-label={`${entry.textbookTitle} ${selectedLessonSession.label} 시작 범위`}
                                    placeholder="예: p.12"
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
                                    aria-label={`${entry.textbookTitle} ${selectedLessonSession.label} 종료 범위`}
                                    placeholder="예: p.18"
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
                                <label className="space-y-1.5 text-xs font-medium text-muted-foreground lg:col-span-2">
                                  <span>표시 문구</span>
                                  <Input
                                    value={entry.planLabel === "계획 범위 미지정" ? "" : entry.planLabel}
                                    aria-label={`${entry.textbookTitle} ${selectedLessonSession.label} 표시 문구`}
                                    placeholder="예: 1단원 개념"
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
                                <label className="space-y-1.5 text-xs font-medium text-muted-foreground lg:col-span-4">
                                  <span>계획 메모</span>
                                  <Textarea
                                    value={entry.planMemo === "계획 메모 없음" ? "" : entry.planMemo}
                                    aria-label={`${entry.textbookTitle} ${selectedLessonSession.label} 계획 메모`}
                                    placeholder="메모"
                                    onChange={(event) =>
                                      handleLessonTextbookPlanChange(
                                        selectedLessonSession.id,
                                        entry.id,
                                        "memo",
                                        event.target.value,
                                      )
                                    }
                                    className="min-h-11"
                                  />
                                </label>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[1rem] border border-dashed px-3 py-4 text-sm font-medium text-muted-foreground">
                        <span>{hasLessonTextbooks ? "교재 기간 밖" : "교재 범위 미지정"}</span>
                        {hasLessonTextbooks ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-md"
                            onClick={() => handleIncludeLessonSessionInTextbookRange(selectedLessonSession.id)}
                          >
                            기간에 포함
                          </Button>
                        ) : null}
                      </div>
                      )
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
  };

  const lessonDesignWorkspaceContent = (
    lessonDesignSnapshot ? (
      <div className="bg-background">
        <div
          className={cn(
            "grid min-w-0 gap-0 p-4 pb-24 lg:p-6 lg:pb-24",
            isLessonDesignProgressMode
              ? "2xl:grid-cols-[minmax(24rem,0.9fr)_minmax(32rem,1.1fr)]"
              : "2xl:grid-cols-[minmax(18rem,0.85fr)_minmax(34rem,1.45fr)]",
          )}
        >
          {lessonDesignSaveError ? (
            <Alert variant="destructive" className="xl:col-span-2 2xl:col-span-full">
              <AlertDescription>{lessonDesignSaveError}</AlertDescription>
            </Alert>
          ) : null}
          {lessonDesignSaveNotice ? (
            <Alert className="xl:col-span-2 2xl:col-span-full">
              <AlertDescription>{lessonDesignSaveNotice}</AlertDescription>
            </Alert>
          ) : null}
          {!lessonDesignSnapshot.saveReadiness.ready &&
          (lessonDesignReadinessActions.length > 0 || lessonDesignSnapshot.saveReadiness.blockers.length > 0) ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[1.5rem] border bg-background/90 px-4 py-3 xl:col-span-2 2xl:col-span-full">
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

          <div className="border-b bg-background pb-4 pt-1 2xl:col-span-full">
            <div className="flex flex-wrap items-center gap-2">
              <div
                data-testid="lesson-design-mode-tabs"
                className="grid min-w-0 flex-1 basis-[20rem] grid-cols-2 gap-1 rounded-lg border bg-muted/30 p-1"
              >
                <Button
                  type="button"
                  aria-pressed={!isLessonDesignProgressMode}
                  className="h-10"
                  variant={!isLessonDesignProgressMode ? "default" : "ghost"}
                  onClick={() => navigateToLessonDesignSection(LESSON_DESIGN_SECTION_IDS.periods)}
                >
                  일정 생성
                </Button>
                <Button
                  type="button"
                  aria-pressed={isLessonDesignProgressMode}
                  className="h-10"
                  variant={isLessonDesignProgressMode ? "default" : "ghost"}
                  onClick={() => navigateToLessonDesignSection(LESSON_DESIGN_SECTION_IDS.board)}
                >
                  진도 생성
                </Button>
              </div>
              {isLessonDesignProgressMode ? (
                <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto lg:hidden">
                  {lessonTextbookProgressSessions.length > 0 ? (
                    <>
                      <Badge variant={lessonTextbookPendingSessionCount > 0 ? "outline" : "secondary"}>
                        진도 {lessonTextbookCompletedSessionCount}/{lessonTextbookProgressSessions.length}
                      </Badge>
                      {lessonTextbookPendingSessionCount > 0 ? (
                        <Badge variant="outline">미배정 {lessonTextbookPendingSessionCount}</Badge>
                      ) : (
                        <Badge variant="secondary">완료</Badge>
                      )}
                      {lessonTextbookOutOfRangeSessionCount > 0 ? (
                        <Badge variant="outline">기간 밖 {lessonTextbookOutOfRangeSessionCount}</Badge>
                      ) : null}
                      {selectedLessonSession ? (
                        <Badge
                          variant={selectedLessonSessionOutsideTextbookRange ? "outline" : "secondary"}
                          className="max-w-[16rem] truncate"
                        >
                          {selectedLessonSessionSummaryLabel}
                          {selectedLessonSessionRangeStateLabel ? ` · ${selectedLessonSessionRangeStateLabel}` : ""}
                        </Badge>
                      ) : null}
                    </>
                  ) : (
                    <Badge variant="outline">교재 연결 전</Badge>
                  )}
                </div>
              ) : null}
            </div>
            {isLessonDesignProgressMode && lessonDesignWorkQueueItems.length > 0 ? (
              <div data-testid="lesson-design-work-queue" className="mt-3 hidden gap-2 lg:grid lg:grid-cols-5">
                {lessonDesignWorkQueueItems.map((item) => (
                  <button
                    key={`lesson-design-work-queue-${item.key}`}
                    type="button"
                    className="flex h-11 min-w-0 items-center justify-between rounded-md border border-border/70 bg-background px-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
                    onClick={() => {
                      if (item.targetSessionId) {
                        focusLessonDesignSession(item.targetSessionId, { sectionId: item.sectionId });
                        return;
                      }
                      scrollLessonDesignSection(item.sectionId);
                    }}
                  >
                    <span className="min-w-0 truncate text-muted-foreground">{item.label}</span>
                    <span className="ml-3 min-w-0 truncate font-semibold text-foreground">{item.value}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {isLessonDesignProgressMode ? (
          <section id={LESSON_DESIGN_SECTION_IDS.textbooks} className="scroll-mt-28 border-b bg-background py-3 2xl:col-span-full">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <BookOpen className="size-4 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-foreground">수업교재</p>
                </div>
              </div>
              <div className="flex w-full flex-wrap justify-end gap-2 sm:min-w-[18rem] sm:flex-1">
                {isLessonTextbookFinderVisible ? (
                  <div className="relative min-w-[14rem] flex-1 sm:max-w-md">
                    <Input
                      type="search"
                      value={lessonTextbookSearch}
                      onChange={(event) => {
                        setLessonTextbookSearch(event.target.value);
                        setIsLessonTextbookFinderOpen(true);
                      }}
                      className="w-full pr-9"
                      placeholder="교재명, 출판사 검색"
                      aria-label="수업교재 검색"
                      autoComplete="off"
                      enterKeyHint="search"
                    />
                    {lessonTextbookSearch ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="absolute right-1 top-1/2 size-7 -translate-y-1/2 rounded-md"
                        aria-label="수업교재 검색 지우기"
                        onClick={() => {
                          setLessonTextbookSearch("");
                          if (!hasLessonTextbooks) {
                            setIsLessonTextbookFinderOpen(true);
                          }
                        }}
                      >
                        <X className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {hasLessonTextbooks ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={isLessonTextbookFinderVisible ? "secondary" : "outline"}
                    className="h-9 shrink-0 rounded-md"
                    aria-expanded={isLessonTextbookFinderVisible}
                    aria-controls="lesson-textbook-finder"
                    onClick={() => {
                      if (isLessonTextbookFinderVisible) {
                        setIsLessonTextbookFinderOpen(false);
                        setLessonTextbookSearch("");
                        setLessonTextbookSubjectFilter("current");
                        setLessonTextbookCategoryFilter("all");
                        setLessonTextbookPublisherFilter("all");
                        return;
                      }
                      setIsLessonTextbookFinderOpen(true);
                    }}
                  >
                    <Plus className="mr-2 size-3.5" />
                    {isLessonTextbookFinderVisible ? "목록 닫기" : "교재 추가"}
                  </Button>
                ) : null}
              </div>
            </div>

            <div
              className={cn(
                "mt-3 grid gap-4",
                isLessonTextbookFinderVisible && hasLessonTextbooks
                  ? "xl:grid-cols-[minmax(0,1.1fr)_minmax(24rem,0.9fr)]"
                  : "xl:grid-cols-1",
              )}
            >
              {isLessonTextbookFinderVisible ? (
              <div id="lesson-textbook-finder" className="rounded-lg border bg-background p-3 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">교재 찾기</p>
                    <Badge variant="outline">후보 {lessonTextbookOptions.length}</Badge>
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 max-w-[16rem] justify-start rounded-md"
                          aria-label={`교재 필터: ${lessonTextbookFilterSummary || "기본"}`}
                        >
                          <SlidersHorizontal className="mr-2 size-3.5 shrink-0" />
                          <span className="shrink-0">필터</span>
                          <span className="text-muted-foreground">·</span>
                          <span className="truncate">{lessonTextbookFilterSummary || "기본"}</span>
                          {activeLessonTextbookFilterCount > 0 ? (
                            <span className="ml-2 rounded bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
                              {activeLessonTextbookFilterCount}
                            </span>
                          ) : null}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        sideOffset={8}
                        className="max-h-[min(28rem,calc(100vh-10rem))] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto p-3"
                      >
                        <div className="grid gap-3">
                          <div className="grid gap-1.5">
                            <p className="text-xs font-medium text-muted-foreground">과목</p>
                            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                              <Button
                                type="button"
                                size="sm"
                                variant={lessonTextbookSubjectFilter === "current" ? "default" : "outline"}
                                className="h-8 justify-start rounded-md"
                                onClick={() => setLessonTextbookSubjectFilter("current")}
                              >
                                수업 과목
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant={lessonTextbookSubjectFilter === "all" ? "default" : "outline"}
                                className="h-8 justify-start rounded-md"
                                onClick={() => setLessonTextbookSubjectFilter("all")}
                              >
                                전체
                              </Button>
                              {lessonTextbookFilterOptions.subjects.map((subject) => (
                                <Button
                                  key={`lesson-textbook-subject-${subject}`}
                                  type="button"
                                  size="sm"
                                  variant={lessonTextbookSubjectFilter === subject ? "default" : "outline"}
                                  className="h-8 justify-start rounded-md"
                                  onClick={() => setLessonTextbookSubjectFilter(subject)}
                                >
                                  {getLessonSubjectDisplayLabel(subject)}
                                </Button>
                              ))}
                            </div>
                          </div>
                          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                            <span>구분</span>
                            <select
                              value={lessonTextbookCategoryFilter}
                              onChange={(event) => setLessonTextbookCategoryFilter(event.target.value)}
                              className="border-input bg-background h-9 rounded-md border px-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                              aria-label="교재 구분 필터"
                            >
                              <option value="all">전체 구분</option>
                              {lessonTextbookFilterOptions.categories.map((category) => (
                                <option key={`lesson-textbook-category-${category}`} value={category}>
                                  {category}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                            <span>출판사</span>
                            <select
                              value={lessonTextbookPublisherFilter}
                              onChange={(event) => setLessonTextbookPublisherFilter(event.target.value)}
                              className="border-input bg-background h-9 rounded-md border px-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                              aria-label="교재 출판사 필터"
                            >
                              <option value="all">전체 출판사</option>
                              {lessonTextbookFilterOptions.publishers.map((publisher) => (
                                <option key={`lesson-textbook-publisher-${publisher}`} value={publisher}>
                                  {publisher}
                                </option>
                              ))}
                            </select>
                          </label>
                          {activeLessonTextbookFilterCount > 0 ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 justify-start rounded-md"
                              onClick={() => {
                                setLessonTextbookSubjectFilter("current");
                                setLessonTextbookCategoryFilter("all");
                                setLessonTextbookPublisherFilter("all");
                              }}
                            >
                              필터 초기화
                            </Button>
                          ) : null}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                {activeLessonTextbookFilterCount > 0 ? (
                  <div
                    data-testid="lesson-textbook-filter-chips"
                    className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"
                  >
                    {[lessonTextbookSubjectFilterLabel, lessonTextbookCategoryFilterLabel, lessonTextbookPublisherFilterLabel]
                      .filter((label) => label && label !== "전체 구분" && label !== "전체 출판사")
                      .map((label) => (
                        <Badge key={`lesson-textbook-filter-chip-${label}`} variant="secondary" className="rounded-md">
                          {label}
                        </Badge>
                      ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 rounded-md px-2 text-xs"
                      onClick={() => {
                        setLessonTextbookSubjectFilter("current");
                        setLessonTextbookCategoryFilter("all");
                        setLessonTextbookPublisherFilter("all");
                      }}
                    >
                      필터 해제
                    </Button>
                  </div>
                ) : null}
                <div
                  className={cn(
                    "mt-3 overflow-y-auto rounded-lg border bg-muted/20 p-2",
                    lessonTextbookSelectedCount > 0 ? "max-h-44" : "max-h-[22rem]",
                  )}
                >
            {lessonTextbookOptions.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2">
                {lessonTextbookOptions.map((book) => {
                  const bookId = text(book.id);
                  return (
                    <button
                      key={bookId}
                      type="button"
                      data-testid={`lesson-textbook-candidate-${bookId}`}
                      className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-left text-sm shadow-xs transition-all hover:border-primary/50 hover:bg-primary/5 active:scale-[0.99] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
                      onClick={() => handleAddLessonTextbook(bookId)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{getTextbookTitle(book)}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[getTextbookPublisher(book), getTextbookCategory(book), getLessonSubjectDisplayLabel(getTextbookSubject(book))]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <Plus className="size-4 shrink-0 text-primary" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-md border border-dashed px-3 py-3 text-sm font-medium text-muted-foreground">
                후보 없음
              </div>
            )}
                </div>
              </div>
              ) : null}

              {hasLessonTextbooks ? (
              <div
                className={cn(
                  "rounded-lg border border-primary/20 bg-primary/5 p-2 shadow-xs",
                  !isLessonTextbookFinderVisible && "xl:max-w-3xl",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">교재 설정</p>
                  <Badge variant="secondary">연결 {lessonTextbookSelectedCount}권</Badge>
                </div>

              <div className="mt-2 grid gap-2">
                {lessonDesignSnapshot.textbookCatalog.map((book) => (
                  <div key={book.textbookId} className="rounded-lg border bg-background p-2 shadow-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{book.title}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {[book.publisher, book.sourceTitle !== book.title ? book.sourceTitle : ""]
                            .filter(Boolean)
                            .join(" · ") || "교재 정보"}
                        </p>
                        <p className="mt-1 text-xs font-medium text-primary">
                          {getLessonTextbookScheduleRangeLabel(book, lessonDesignSnapshot.sessions)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8 shrink-0"
                        aria-label={`${book.title} 연결 해제`}
                        onClick={() => handleRemoveLessonTextbook(book.textbookId)}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 rounded-md px-2 text-xs"
                        onClick={() =>
                          handleLessonTextbookCatalogRange(book.textbookId, {
                            startSessionId: filteredLessonSessions[0]?.id || "",
                            endSessionId: filteredLessonSessions[filteredLessonSessions.length - 1]?.id || "",
                          })
                        }
                      >
                        전체 기간
                      </Button>
                      {selectedLessonSession ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 rounded-md px-2 text-xs"
                          onClick={() =>
                            handleLessonTextbookCatalogRange(book.textbookId, {
                              startSessionId: selectedLessonSession.id,
                              endSessionId: filteredLessonSessions[filteredLessonSessions.length - 1]?.id || selectedLessonSession.id,
                            })
                          }
                        >
                          현재 회차부터
                        </Button>
                      ) : null}
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-[6rem_minmax(8rem,1fr)_minmax(8rem,1fr)]">
                      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                        <span>역할</span>
                        <select
                          value={book.role === "main" ? "main" : "supplement"}
                          onChange={(event) =>
                            handleLessonTextbookCatalogChange(book.textbookId, "role", event.target.value)
                          }
                          className="border-input bg-background h-9 rounded-md border px-2 text-sm text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                          aria-label={`${book.title} 역할`}
                        >
                          <option value="main">주교재</option>
                          <option value="supplement">부교재</option>
                        </select>
                      </label>
                      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                        <span>시작</span>
                        <select
                          value={book.startSessionId || ""}
                          onChange={(event) =>
                            handleLessonTextbookCatalogChange(book.textbookId, "startSessionId", event.target.value)
                          }
                          className="border-input bg-background h-9 rounded-md border px-2 text-sm text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                          aria-label={`${book.title} 시작 회차`}
                        >
                          <option value="">첫 회차</option>
                          {lessonDesignSnapshot.sessions.map((session) => (
                            <option key={`${book.textbookId}-start-${session.id}`} value={session.id}>
                              {getLessonSessionOptionLabel(session)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                        <span>종료</span>
                        <select
                          value={book.endSessionId || ""}
                          onChange={(event) =>
                            handleLessonTextbookCatalogChange(book.textbookId, "endSessionId", event.target.value)
                          }
                          className="border-input bg-background h-9 rounded-md border px-2 text-sm text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                          aria-label={`${book.title} 종료 회차`}
                        >
                          <option value="">마지막 회차</option>
                          {lessonDesignSnapshot.sessions.map((session) => (
                            <option key={`${book.textbookId}-end-${session.id}`} value={session.id}>
                              {getLessonSessionOptionLabel(session)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <details className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground md:col-span-3">
                        <summary className="cursor-pointer font-medium text-foreground">교재 정보</summary>
                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                          <label className="grid gap-1.5">
                            <span>표시명</span>
                            <Input
                              value={book.title}
                              onChange={(event) =>
                                handleLessonTextbookCatalogChange(book.textbookId, "alias", event.target.value)
                              }
                              aria-label={`${book.title} 표시명`}
                            />
                          </label>
                          <label className="grid gap-1.5">
                            <span>영역</span>
                            <Input
                              value={book.area}
                              onChange={(event) =>
                                handleLessonTextbookCatalogChange(book.textbookId, "area", event.target.value)
                              }
                              placeholder="영역"
                              aria-label={`${book.title} 영역`}
                            />
                          </label>
                          <label className="grid gap-1.5">
                            <span>세부과목</span>
                            <Input
                              value={book.subSubject}
                              onChange={(event) =>
                                handleLessonTextbookCatalogChange(book.textbookId, "subSubject", event.target.value)
                              }
                              placeholder="세부과목"
                              aria-label={`${book.title} 세부과목`}
                            />
                          </label>
                        </div>
                      </details>
                    </div>
                  </div>
                ))}
              </div>
              </div>
              ) : null}
            </div>
          </section>
          ) : null}

          {!isLessonDesignProgressMode ? (
            <>
          <section
            id={LESSON_DESIGN_SECTION_IDS.periods}
            data-lesson-period-sidebar="true"
            className="bg-background py-4 2xl:col-start-1 2xl:pr-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-lg font-semibold text-foreground">일정 생성</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={handleAddLessonPeriod}>
                  월 추가
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
                          (!text(session.periodId) && periodStartMonthKey && session.monthKey === periodStartMonthKey),
                      )
                      .sort(compareLessonSessionsByDate);
                    const periodMonthKey = periodStartMonthKey || periodSessions[0]?.monthKey || "";
                    const periodSessionMonthKeys = [
                      ...new Set(periodSessions.map((session) => text(session.monthKey)).filter(Boolean)),
                    ];
                    const periodHasActiveMonth = periodSessionMonthKeys.includes(activeLessonMonthKey);
                    const periodSelectedSession =
                      periodSessions.find((session) => session.id === selectedLessonSession?.id) ||
                      periodSessions[0] ||
                      null;
                    const isPeriodDetailsOpen = Boolean(
                      lessonMonthDetailsOpen &&
                        ((periodMonthKey && activeLessonMonthKey === periodMonthKey) ||
                          periodHasActiveMonth ||
                          periodSessions.some((session) => session.id === selectedLessonSession?.id)),
                    );
                    const handlePeriodDetailToggle = () => {
                      if (periodMonthKey) {
                        focusLessonMonthKey(periodMonthKey);
                      }
                      if (periodSelectedSession) {
                        markPendingLessonSessionSelection(periodSelectedSession.id);
                      }
                      setLessonMonthDetailsOpen((current) =>
                        periodMonthKey && activeLessonMonthKey === periodMonthKey ? !current : true,
                      );
                    };

                    return (
                      <div
                        key={period.id}
                        id={getLessonDesignPeriodDetailId(periodMonthKey || period.id)}
                        className="scroll-mt-24 border-t px-2 py-4 first:border-t-0"
                      >
                        {periodSessionMonthKeys.map((monthKey) =>
                          monthKey === periodMonthKey ? null : (
                            <span
                              key={`${period.id}-${monthKey}-anchor`}
                              id={getLessonDesignPeriodDetailId(monthKey)}
                              className="block scroll-mt-24"
                              aria-hidden="true"
                            />
                          ),
                        )}
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
                                aria-label={`${period.label} ${isPeriodDetailsOpen ? "상세 닫기" : "상세 보기"}`}
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
                              className="h-8 w-8 rounded-md p-0 text-destructive hover:text-destructive"
                              aria-label={`${period.label} 삭제`}
                              onClick={() => handleRemoveLessonPeriod(period.id)}
                              disabled={lessonDesignSnapshot.billingPeriods.length <= 1}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
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
                        {isPeriodDetailsOpen ? renderLessonMonthSessionDetails(periodSessions, { showTextbookPlans: false }) : null}
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
                          const monthSurfaceStyle = getLessonCalendarMonthSurfaceStyle(accentColor);
                          const cells = buildLessonCalendarCells(month.year, month.month);

                          return (
                            <div
                              key={month.key}
                              data-lesson-calendar-month={month.key}
                              className="rounded-[1.25rem] border px-4 py-5 shadow-xs"
                              style={monthSurfaceStyle}
                            >
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

                              <div className="mt-4 space-y-3">
                                <div data-testid="lesson-mobile-session-list" className="grid gap-2 md:hidden">
                                  {monthPreviewSessions.map((session) => {
                                    const mobileSessionSurface = getScheduleStateSurface(session.scheduleState);
                                    const mobileSessionSurfaceStyle = getLessonCalendarSessionSurfaceStyle(
                                      session.scheduleState,
                                      session.billingColor || accentColor,
                                    );
                                    const mobileSessionDateKey = text(session.dateValue);
                                    const isSelectedMobileSession = selectedLessonSession?.id === session.id;

                                    return (
                                      <button
                                        key={`lesson-mobile-calendar-session-${session.id}`}
                                        type="button"
                                        style={mobileSessionSurfaceStyle}
                                        className={cn(
                                          "flex min-h-14 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left shadow-xs transition-colors",
                                          mobileSessionSurface.className,
                                          isSelectedMobileSession &&
                                            "ring-2 ring-primary/70 ring-offset-2 ring-offset-background",
                                        )}
                                        onClick={() => {
                                          if (mobileSessionDateKey) {
                                            setSelectedLessonCalendarDate(mobileSessionDateKey);
                                          }
                                          markPendingLessonSessionSelection(session.id);
                                          setLessonMonthDetailsOpen(true);
                                        }}
                                      >
                                        <span className="min-w-0">
                                          <span className="block truncate text-sm font-semibold">{session.label}</span>
                                          <span className={cn("block truncate text-xs", mobileSessionSurface.mutedClassName)}>
                                            {session.dateLabel}
                                          </span>
                                        </span>
                                        <Badge variant="secondary" className="shrink-0 rounded-md">
                                          {session.scheduleStateLabel}
                                        </Badge>
                                      </button>
                                    );
                                  })}
                                </div>
                                <div
                                  data-testid="lesson-desktop-calendar"
                                  className="hidden grid-cols-7 gap-1 text-[11px] font-medium text-muted-foreground md:grid"
                                >
                                  {DAY_LABELS.map((dayLabel) => (
                                    <div key={`${month.key}-${dayLabel}`} className="flex h-8 items-center justify-center rounded-md bg-background/55">
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
                                  const primarySessionAccentColor = primarySession?.billingColor || accentColor;
                                  const primarySessionSurfaceStyle = primarySession
                                    ? getLessonCalendarSessionSurfaceStyle(
                                        primarySession.scheduleState,
                                        primarySessionAccentColor,
                                      )
                                    : undefined;
                                  const activeTextbookEntries = isLessonDesignProgressMode ? primarySession?.textbookEntries || [] : [];
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
                                      data-lesson-calendar-session-id={primarySession?.id || ""}
                                      data-lesson-calendar-accent={primarySessionAccentColor}
                                      {...(canToggleCalendarDate ? { type: "button" as const } : {})}
                                      draggable={Boolean(primarySession) && primarySession?.scheduleState !== "makeup"}
                                      style={primarySessionSurfaceStyle}
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
                                             ? "bg-background/75 hover:border-primary/50 hover:bg-background/95"
                                             : cell.isCurrentMonth
                                               ? "bg-background/65"
                                               : "bg-background/35 text-muted-foreground/50",
                                        isSelectedCalendarSession && "ring-2 ring-primary/70 ring-offset-2 ring-offset-background",
                                        isCalendarDragSource && "opacity-70 ring-2 ring-primary/40",
                                        isCalendarDropTarget && "ring-2 ring-primary",
                                      )}
                                       onClick={() => {
                                         if (primarySession) {
                                           setSelectedLessonCalendarDate(dateKey);
                                           focusLessonDesignSession(primarySession.id, {
                                             sectionId: LESSON_DESIGN_SECTION_IDS.periods,
                                             scrollMode: "sync",
                                           });
                                           return;
                                         }

                                          handleLessonCalendarDateClick(dateKey, {
                                            hasSession: false,
                                            hasBaseSession: Array.isArray(normalizedLessonPlan?.selectedDays)
                                              ? (normalizedLessonPlan.selectedDays as Array<string | number>).map((value) => Number(value)).includes(cell.date.getDay())
                                             : false,
                                           isMakeup: false,
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
                                          {activeTextbookEntries.length > 0 ? (
                                            <div className="flex max-w-full flex-wrap justify-center gap-1">
                                              {activeTextbookEntries.slice(0, 2).map((entry) => (
                                                <span
                                                  key={`${primarySession.id}-${entry.id}`}
                                                  className="max-w-[5.5rem] truncate rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                                                >
                                                  {entry.textbookTitle}
                                                </span>
                                              ))}
                                              {activeTextbookEntries.length > 2 ? (
                                                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                                  +{activeTextbookEntries.length - 2}
                                                </span>
                                              ) : null}
                                            </div>
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
            </>
          ) : null}

          {isLessonDesignProgressMode && hasLessonTextbooks ? (
          <section
            id={LESSON_DESIGN_SECTION_IDS.board}
            className="relative z-[1] min-w-0 border-t bg-background py-6 2xl:col-start-1 2xl:pr-5"
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
                                        {hasLessonTextbooks ? (
                                          <>
                                            <Badge variant="outline">
                                              대상 {group.textbookSessionCount}
                                            </Badge>
                                            {group.outsideTextbookRangeCount > 0 ? (
                                              <Badge variant="outline">
                                                기간 밖 {group.outsideTextbookRangeCount}
                                              </Badge>
                                            ) : null}
                                          </>
                                    ) : null}
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
                                  const textbookPreviewLine =
                                    session.textbookEntryPreview !== "교재 범위 미지정"
                                      ? session.textbookEntryPreview
                                      : "";
                                  const isSessionOutsideTextbookRange =
                                    hasLessonTextbooks && session.textbookEntries.length === 0;
                                  const plannedTextbookCount = session.textbookEntries.filter((entry) => entry.hasPlanContent).length;
                                  const sessionPlanStateLabel = isSessionOutsideTextbookRange
                                    ? "기간 밖"
                                    : session.textbookEntries.length > 0
                                      ? `${plannedTextbookCount}/${session.textbookEntries.length}권`
                                      : "교재 없음";
                                  const isSessionPlanComplete =
                                    session.textbookEntries.length > 0 &&
                                    plannedTextbookCount === session.textbookEntries.length;
                                  const sessionDetailLine = [
                                    textbookPreviewLine,
                                    sessionMemoLine,
                                    session.scheduleConnectionLabel,
                                  ]
                                    .map((value) => text(value))
                                    .filter(Boolean)
                                    .join(" · ");
	                                  return (
                                    <div key={session.id} className="relative pl-9 [contain-intrinsic-size:84px] [content-visibility:auto]">
                                      <span
                                        aria-hidden="true"
                                        className={cn(
                                          "absolute left-3 w-px -translate-x-1/2 bg-border",
                                          isFirstFlowItem ? "top-1/2" : "-top-3",
                                          isLastFlowItem ? "bottom-1/2" : "-bottom-3",
                                        )}
                                      />
                                      <span
                                        aria-hidden="true"
                                        className={cn(
                                          "absolute left-3 top-1/2 z-10 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background",
                                          isDoneFlow
                                            ? "bg-primary border-primary/20"
                                            : isCurrentFlow
                                              ? "bg-primary/15 border-primary text-primary"
                                              : "bg-muted border-border text-muted-foreground",
                                        )}
                                      />
                                      <button
                                      type="button"
                                      data-testid={`lesson-board-session-${session.id}`}
                                      data-session-id={session.id}
                                      data-lesson-session-selected={isSelected ? "true" : "false"}
                                      aria-pressed={isSelected}
                                      aria-current={isSelected ? "true" : undefined}
                                      className={cn(
                                        "relative flex min-h-[4.25rem] w-full cursor-pointer items-start gap-3 rounded-lg border border-l-4 border-l-transparent bg-background px-4 py-3 text-left shadow-xs transition-all hover:border-primary/30 hover:bg-muted/30 active:scale-[0.995] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                                        isSessionOutsideTextbookRange && "bg-muted/20 text-muted-foreground shadow-none hover:bg-muted/40",
                                        isSelected && "border-primary border-l-primary bg-primary/5 shadow-sm ring-1 ring-primary/10",
                                      )}
                                      onPointerDown={() => markPendingLessonSessionSelection(session.id)}
                                      onMouseDown={() => markPendingLessonSessionSelection(session.id)}
                                      onClick={() =>
                                        focusLessonDesignSession(session.id, {
                                          sectionId: LESSON_DESIGN_SECTION_IDS.board,
                                        })
                                      }
                                    >
	                                      <div className="min-w-0 flex-1 space-y-2">
	                                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
	                                          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
	                                            <span className="font-medium text-foreground">{session.label}</span>
	                                            <span className="text-xs text-muted-foreground">{session.dateLabel}</span>
	                                          </span>
                                            <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                                              <Badge
                                                variant={isSessionPlanComplete ? "secondary" : "outline"}
                                                className="h-5 rounded-md px-1.5 text-[11px]"
                                              >
                                                {sessionPlanStateLabel}
                                              </Badge>
	                                            {session.scheduleStateLabel !== "정상" ? (
                                                  <Badge variant={getScheduleStateTone(session.scheduleState)}>
                                                    {session.scheduleStateLabel}
                                                  </Badge>
                                                ) : null}
                                            </span>
	                                        </div>

                                        {sessionDetailLine ? (
                                          <p className="truncate text-xs text-muted-foreground">{sessionDetailLine}</p>
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
          ) : null}

          {isLessonDesignProgressMode && hasLessonTextbooks ? (
            <section
              data-testid="lesson-design-progress-editor"
              className="relative z-[2] min-w-0 overflow-x-hidden border-t bg-background py-6 2xl:sticky 2xl:top-[calc(var(--header-height)+1rem)] 2xl:col-start-2 2xl:max-h-[calc(100dvh-var(--header-height)-6.5rem)] 2xl:self-start 2xl:overflow-y-auto 2xl:border-l 2xl:border-t-0 2xl:pl-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
                <div className="space-y-1">
                  <p className="text-lg font-semibold text-foreground">
                    {selectedLessonSession ? `${selectedLessonSession.label} 진도` : "진도 입력"}
                  </p>
                  {selectedLessonSession ? (
                    <p className="text-xs text-muted-foreground">{selectedLessonSession.dateLabel}</p>
                  ) : null}
                </div>
                {selectedLessonSession ? (
                  <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                    <label className="sr-only" htmlFor="lesson-session-jump">
                      회차
                    </label>
                    <select
                      id="lesson-session-jump"
                      value={selectedLessonSession.id}
                      onChange={(event) =>
                        focusLessonDesignSession(event.target.value, {
                          sectionId: LESSON_DESIGN_SECTION_IDS.board,
                        })
                      }
                      className="border-input bg-background h-9 max-w-[13rem] rounded-md border px-2 text-sm text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                      aria-label="회차 바로 이동"
                    >
                      {lessonSessionJumpOptions.map((session) => (
                        <option key={`lesson-session-jump-${session.id}`} value={session.id}>
                          {getLessonSessionOptionLabel(session)}
                        </option>
                      ))}
                    </select>
                    {previousLessonSession ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 rounded-md"
                        onClick={() =>
                          focusLessonDesignSession(previousLessonSession.id, {
                            sectionId: LESSON_DESIGN_SECTION_IDS.board,
                          })
                        }
                      >
                        이전 회차
                      </Button>
                    ) : null}
                    {nextLessonSession ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 rounded-md"
                        onClick={() =>
                          focusLessonDesignSession(nextLessonSession.id, {
                            sectionId: LESSON_DESIGN_SECTION_IDS.board,
                          })
                        }
                      >
                        다음 회차
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {selectedLessonSession ? (
                renderLessonMonthSessionDetails([selectedLessonSession], {
                  showScheduleControls: false,
                  showTextbookPlans: true,
                })
              ) : (
                <div className="mt-4 rounded-[1.25rem] border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  회차를 선택하세요.
                </div>
              )}
            </section>
          ) : null}
          <div
            data-testid="lesson-design-bottom-action-bar"
            className="fixed bottom-4 right-4 z-30 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border bg-background/95 px-3 py-2 shadow-lg shadow-black/5 backdrop-blur sm:right-6"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant={lessonDesignSnapshot.saveReadiness.ready ? "secondary" : "outline"}>
                {isLessonDesignProgressMode ? "진도 생성" : "일정 생성"}
              </Badge>
              {isLessonDesignProgressMode && lessonTextbookProgressSessions.length > 0 ? (
                <Badge variant={lessonTextbookPendingSessionCount > 0 ? "outline" : "secondary"}>
                  {lessonTextbookCompletedSessionCount}/{lessonTextbookProgressSessions.length}
                </Badge>
              ) : null}
            </div>
            <Button
              type="button"
              className="h-9 rounded-md px-5 shadow-none"
              onClick={handleSaveLessonPlan}
              disabled={
                isLessonDesignSaving ||
                !lessonDesignSnapshot.saveReadiness.ready ||
                (isLessonDesignProgressMode && !hasLessonTextbooks)
              }
            >
              {isLessonDesignSaving ? "저장 중" : isLessonDesignProgressMode && !hasLessonTextbooks ? "교재 연결 필요" : "저장"}
            </Button>
          </div>
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
        <div
          data-testid="lesson-design-page-scroll"
          role="region"
          aria-label="수업 설계 작업 영역"
          tabIndex={0}
          className="h-[calc(100dvh-var(--header-height)-2rem)] overflow-y-auto overscroll-contain px-4 pb-28 outline-none lg:px-6"
        >
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
            <DialogDescription className="sr-only">
              수업 일정과 수업교재를 연결하고 회차별 진도를 설계합니다.
            </DialogDescription>
            {lessonDesignWorkspaceContent}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
