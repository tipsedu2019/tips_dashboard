"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Pencil, Printer } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/providers/auth-provider";
import { supabase } from "@/lib/supabase";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { EventForm } from "@/app/admin/calendar/components/event-form";
import type { CalendarEvent, TextbookScopeItem } from "@/app/admin/calendar/types";
import { getGradeBadgeLabels } from "@/app/admin/calendar/utils/calendar-grid.js";
import {
  buildAcademicEventMutationPayload,
  DEFAULT_ACADEMIC_EVENT_TYPES,
  isSubjectExamType,
} from "./academic-event-utils.js";
import {
  buildAcademicAnnualBoardModel,
  type AcademicAnnualBoardEntry,
  type AcademicAnnualBoardRow,
  type AcademicAnnualBoardType,
} from "./academic-calendar-models.js";
import { useOperationsWorkspaceData } from "./use-operations-workspace-data";

const FIXED_EXAM_TERM_ROWS = ["1학기 중간", "1학기 기말", "2학기 중간", "2학기 기말"] as const;
const BOARD_TYPES: AcademicAnnualBoardType[] = ["시험기간", "영어시험일", "수학시험일", "체험학습", "방학·휴일·기타", "팁스"];
const SUBJECT_BOARD_TYPES: AcademicAnnualBoardType[] = ["영어시험일", "수학시험일"];
const SEMESTER_FILTER_OPTIONS = ["전체", "1학기", "2학기"] as const;
const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;
const HIGH_GRADE_COLUMN_LABELS = ["고1", "고2", "고3"] as const;
const MIDDLE_GRADE_COLUMN_LABELS = ["중1", "중2", "중3"] as const;

type ExamTerm = (typeof FIXED_EXAM_TERM_ROWS)[number];
type SemesterFilter = (typeof SEMESTER_FILTER_OPTIONS)[number];
type GradeColumnLabel = (typeof HIGH_GRADE_COLUMN_LABELS)[number] | (typeof MIDDLE_GRADE_COLUMN_LABELS)[number];
type EntryState = "complete" | "warning" | "empty";
type AnnualBoardCellType = AcademicAnnualBoardType;

type AnnualBoardTermRow =
  | {
      key: string;
      label: string;
      kind: "exam";
      semester: Exclude<SemesterFilter, "전체">;
      examTerm: ExamTerm;
    }
  | {
      key: string;
      label: string;
      kind: "event";
      type: "체험학습" | "방학·휴일·기타" | "팁스";
    };

type HoveredAnnualBoardCell = {
  schoolKey: string;
  gradeLabel: string;
  termKey: string;
  type: AnnualBoardCellType;
};

type GroupedSchoolRow = {
  schoolKey: string;
  schoolName: string;
  category: string;
  gradeMap: Map<string, AcademicAnnualBoardRow>;
};

const ANNUAL_BOARD_TERM_ROWS: AnnualBoardTermRow[] = [
  { key: "1-mid", label: "1중", kind: "exam", semester: "1학기", examTerm: "1학기 중간" },
  { key: "1-final", label: "1기", kind: "exam", semester: "1학기", examTerm: "1학기 기말" },
  { key: "2-mid", label: "2중", kind: "exam", semester: "2학기", examTerm: "2학기 중간" },
  { key: "2-final", label: "2기", kind: "exam", semester: "2학기", examTerm: "2학기 기말" },
  { key: "experience", label: "체험", kind: "event", type: "체험학습" },
  { key: "vacation", label: "방학", kind: "event", type: "방학·휴일·기타" },
  { key: "tips", label: "팁스", kind: "event", type: "팁스" },
];

function text(value: unknown) {
  return String(value || "").trim();
}

function buildSchoolFilterValue(row: { schoolId?: string | null; schoolName?: string | null }) {
  return text(row.schoolId) || text(row.schoolName);
}

function parseLocalDate(value?: string | null) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return new Date();
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

function toDateKey(value?: Date | null) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "";
  }

  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function normalizeScopeItems(items: unknown): TextbookScopeItem[] {
  return Array.isArray(items)
    ? items
        .map((item) => ({
          name: text((item as { name?: string }).name),
          publisher: text((item as { publisher?: string }).publisher),
          scope: text((item as { scope?: string }).scope),
        }))
        .filter((item) => item.name || item.publisher || item.scope)
    : [];
}

function buildBoardEventTitle(type: string) {
  if (type === "체험학습") {
    return "체험학습";
  }
  if (type === "방학·휴일·기타") {
    return "휴일 일정";
  }
  if (type === "팁스") {
    return "팁스 일정";
  }
  if (type === "영어시험일") {
    return "영어 시험일 및 시험범위";
  }
  if (type === "수학시험일") {
    return "수학 시험일 및 시험범위";
  }
  return "시험기간";
}

function inferExamTermDefaultDate(selectedYear: string, examTerm: string) {
  const year = Number(selectedYear || new Date().getFullYear());
  if (examTerm === "1학기 중간") return new Date(year, 3, 20, 12);
  if (examTerm === "1학기 기말") return new Date(year, 5, 20, 12);
  if (examTerm === "2학기 중간") return new Date(year, 9, 5, 12);
  if (examTerm === "2학기 기말") return new Date(year, 10, 20, 12);
  return new Date(year, 0, 1, 12);
}

function buildBoardDraftDate(
  selectedYear: string,
  row: { typeBuckets: Record<AcademicAnnualBoardType, Array<{ start?: string; examTerm?: string }>> },
  type: AcademicAnnualBoardType,
  examTerm: string = "",
) {
  const matchingEntry = examTerm
    ? [
        ...(row.typeBuckets[type] || []),
        ...(row.typeBuckets["시험기간"] || []),
      ].find((entry) => text(entry?.examTerm) === examTerm)
    : null;
  const firstEntry = row.typeBuckets[type]?.[0];
  return parseLocalDate(
    matchingEntry?.start || firstEntry?.start || toDateKey(inferExamTermDefaultDate(selectedYear, examTerm)) || `${selectedYear || new Date().getFullYear()}-01-01`,
  );
}

function getTypeLabel(type: AcademicAnnualBoardType) {
  if (type === "영어시험일") return "영어";
  if (type === "수학시험일") return "수학";
  if (type === "방학·휴일·기타") return "방학·기타";
  if (type === "팁스") return "팁스";
  return type;
}

function formatOneDate(value?: string | null, options: { weekday?: boolean } = {}) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }

  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!options.weekday) {
    return `${month}/${day}`;
  }

  const weekday = WEEKDAY_LABELS[new Date(Number(match[1]), month - 1, day).getDay()];
  return `${month}/${day}(${weekday})`;
}

function splitDateRange(value?: string | null) {
  const normalized = text(value);
  if (!normalized) {
    return { start: "", end: "" };
  }
  if (normalized.includes(" ~ ")) {
    const [start, end] = normalized.split(" ~ ");
    return { start: text(start), end: text(end) || text(start) };
  }
  return { start: normalized, end: normalized };
}

function formatRangeLabel(entry?: AcademicAnnualBoardEntry | null, options: { compact?: boolean } = {}) {
  if (!entry) {
    return "—";
  }

  const range = splitDateRange(entry.dateLabel || [entry.start, entry.end].filter(Boolean).join(" ~ "));
  const start = formatOneDate(range.start, { weekday: !options.compact });
  const end = formatOneDate(range.end, { weekday: !options.compact });
  if (!start) {
    return "—";
  }
  if (!end || start === end) {
    return start;
  }
  return options.compact ? `${start}~${end}` : `${start} ~ ${end}`;
}

function formatSubjectDateLabel(entry?: AcademicAnnualBoardEntry | null, options: { compact?: boolean } = {}) {
  if (!entry) {
    return "—";
  }

  const directDate = formatOneDate(entry.dateLabel, { weekday: !options.compact });
  if (directDate) {
    return directDate;
  }
  const examDate = formatOneDate(entry.examDateLabel, { weekday: !options.compact });
  if (examDate) {
    return examDate;
  }
  const fallback = text(entry.examDateLabel);
  if (fallback && fallback !== "시험일 미입력") {
    return fallback;
  }
  return "시험일 미입력";
}

function formatEventSummaryLabel(entries: AcademicAnnualBoardEntry[], options: { compact?: boolean } = {}) {
  if (entries.length === 0) {
    return "—";
  }
  const first = entries[0];
  const rangeLabel = formatRangeLabel(first, options);
  return entries.length > 1 ? `${rangeLabel} · ${entries.length}건` : rangeLabel;
}

function getEntryByTerm(row: AcademicAnnualBoardRow, type: AcademicAnnualBoardType, examTerm: ExamTerm) {
  return (row.typeBuckets[type] || []).find((entry) => text(entry.examTerm) === examTerm) || null;
}

function buildBoardEntryMissingItems(entry?: AcademicAnnualBoardEntry | null) {
  if (!entry) {
    return [];
  }

  const sectionMap = new Map((entry.displaySections || []).map((section) => [section.label, Array.isArray(section.items) ? section.items.filter(Boolean) : []]));
  const scopeItems = sectionMap.get("시험범위") || [];
  const structuredScopeItems = [
    ...(Array.isArray(entry.textbookScopes) ? entry.textbookScopes : []),
    ...(Array.isArray(entry.subtextbookScopes) ? entry.subtextbookScopes : []),
  ];
  const hasStructuredPartialScope = structuredScopeItems.some((item) => {
    const hasAnyValue = text(item?.name) || text(item?.publisher) || text(item?.scope);
    return Boolean(hasAnyValue) && (!text(item?.name) || !text(item?.scope));
  });

  return [
    isSubjectExamType(entry.type) && (!text(entry.examDateLabel) || text(entry.examDateLabel) === "시험일 미입력") ? "시험일 미입력" : null,
    isSubjectExamType(entry.type) && scopeItems.length === 0 ? "시험범위 미입력" : null,
    hasStructuredPartialScope ? "시험범위 일부 미입력" : null,
  ].filter((item): item is string => Boolean(item));
}

function getEntryState(entry: AcademicAnnualBoardEntry | null, type: AcademicAnnualBoardType): EntryState {
  if (!entry) {
    return "empty";
  }
  if (type === "시험기간") {
    return text(entry.start) && text(entry.end || entry.start) ? "complete" : "warning";
  }
  if (isSubjectExamType(type)) {
    return buildBoardEntryMissingItems(entry).length > 0 ? "warning" : "complete";
  }
  return text(entry.dateLabel) || text(entry.start) ? "complete" : "warning";
}

function getBoardCellLabel(entry: AcademicAnnualBoardEntry | null, type: AcademicAnnualBoardType, options: { compact?: boolean } = {}) {
  if (type === "시험기간") {
    return formatRangeLabel(entry, options);
  }
  if (isSubjectExamType(type)) {
    return formatSubjectDateLabel(entry, options);
  }
  return entry ? formatRangeLabel(entry, options) : "—";
}

function getTermRows(selectedSemester: SemesterFilter) {
  return ANNUAL_BOARD_TERM_ROWS.filter((row) => {
    if (row.kind === "event" || selectedSemester === "전체") {
      return true;
    }
    return row.semester === selectedSemester;
  });
}

function getEntrySemester(entry?: Pick<AcademicAnnualBoardEntry, "examTerm" | "start"> | null): Exclude<SemesterFilter, "전체"> | "" {
  const examTerm = text(entry?.examTerm);
  if (examTerm.startsWith("1학기")) return "1학기";
  if (examTerm.startsWith("2학기")) return "2학기";

  const month = Number(text(entry?.start).slice(5, 7));
  if (month >= 1 && month <= 7) return "1학기";
  if (month >= 8 && month <= 12) return "2학기";
  return "";
}

function getEventEntriesForSemester(
  row: AcademicAnnualBoardRow,
  type: "체험학습" | "방학·휴일·기타" | "팁스",
  selectedSemester: SemesterFilter,
) {
  const entries = row.typeBuckets[type] || [];
  if (selectedSemester === "전체") {
    return entries;
  }
  return entries.filter((entry) => getEntrySemester(entry) === selectedSemester);
}

function getEventCellLabel(entries: AcademicAnnualBoardEntry[], options: { compact?: boolean } = {}) {
  if (entries.length === 0) {
    return "미입력";
  }

  const first = entries[0];
  const title = text(first.title).replace(/체험학습|휴일 일정|팁스 일정|일정/g, "").trim();
  const rangeLabel = formatRangeLabel(first, options);
  const label = [rangeLabel, title].filter((item) => item && item !== "—").join(" ");
  return entries.length > 1 ? `${label || rangeLabel} · ${entries.length}건` : label || rangeLabel;
}

function getStructuredScopeItems(entry: AcademicAnnualBoardEntry | null, key: "textbookScopes" | "subtextbookScopes") {
  const directItems = normalizeScopeItems(entry?.[key]);
  if (directItems.length > 0) {
    return directItems;
  }

  const scopeSection = (entry?.displaySections || []).find((section) => text(section.label) === "시험범위");
  const fallbackItems = Array.isArray(scopeSection?.items)
    ? scopeSection.items
        .map((item) => {
          const raw = text(item);
          return raw ? { name: "", publisher: "", scope: raw } : null;
        })
        .filter((item): item is TextbookScopeItem => Boolean(item))
    : [];

  return key === "textbookScopes" ? fallbackItems : [];
}

function formatScopeItem(item: TextbookScopeItem) {
  const source = [text(item.name), text(item.publisher)].filter(Boolean).join(" · ");
  const scope = text(item.scope);
  if (source && scope) {
    return `${source}: ${scope}`;
  }
  return source || scope || "미입력";
}

function getCellStateForEntries(entries: AcademicAnnualBoardEntry[], type: AcademicAnnualBoardType) {
  if (entries.length === 0) {
    return "empty" as EntryState;
  }
  return entries.some((entry) => getEntryState(entry, type) !== "complete") ? "warning" : "complete";
}

function getCellToneClass(type: AcademicAnnualBoardType, state: EntryState, active: boolean) {
  return cn(
    "annual-board-value inline-flex min-h-7 w-full items-center rounded-[4px] border px-2 text-left text-[12px] leading-5 font-medium transition-[background-color,border-color,box-shadow,transform]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6FED]/35 active:scale-[0.99]",
    type === "시험기간" && "annual-board-value-period",
    type === "영어시험일" && "annual-board-value-english",
    type === "수학시험일" && "annual-board-value-math",
    type === "체험학습" && "annual-board-value-experience",
    type === "방학·휴일·기타" && "annual-board-value-vacation",
    state === "empty" && "annual-board-value-empty",
    active && "annual-board-value-active",
  );
}

function buildGroupedSchoolRows(rows: AcademicAnnualBoardRow[]) {
  const grouped = new Map<string, GroupedSchoolRow>();
  rows.forEach((row) => {
    const schoolKey = buildSchoolFilterValue(row) || text(row.schoolName);
    if (!schoolKey) {
      return;
    }
    const current = grouped.get(schoolKey) || {
      schoolKey,
      schoolName: text(row.schoolName) || schoolKey,
      category: text(row.category),
      gradeMap: new Map<string, AcademicAnnualBoardRow>(),
    };
    const rowGrades =
      Array.isArray(row.gradeValues) && row.gradeValues.length > 0
        ? row.gradeValues
        : getGradeBadgeLabels(row.grade);
    rowGrades
      .filter((grade) => grade && grade !== "전체")
      .forEach((gradeLabel) => {
        if (!current.gradeMap.has(gradeLabel)) {
          current.gradeMap.set(gradeLabel, row);
        }
      });
    grouped.set(schoolKey, current);
  });

  return [...grouped.values()].sort((left, right) =>
    left.schoolName.localeCompare(right.schoolName, "ko"),
  );
}

function AnnualBoardSkeleton({ columns }: { columns: readonly string[] }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, rowIndex) => (
        <TableRow key={`annual-board-skeleton-${rowIndex}`}>
          <TableCell className="sticky left-0 z-10 border-b border-r bg-background p-3">
            <div className="h-4 w-20 rounded-sm bg-muted" />
          </TableCell>
          {columns.map((column) => (
            <TableCell key={`${column}-${rowIndex}`} className="border-b border-r p-2">
              <div className="h-12 rounded-sm bg-muted/60" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function ScopeSection({ title, items }: { title: string; items: TextbookScopeItem[] }) {
  return (
    <div className="grid gap-1.5">
      <p className="annual-board-muted-label text-[11px] font-semibold uppercase tracking-[0.06em]">{title}</p>
      {items.length > 0 ? (
        <div className="grid gap-1">
          {items.slice(0, 4).map((item, index) => (
            <p key={`${title}-${index}`} className="annual-board-scope-pill rounded-[4px] border px-2 py-1 text-[12px] leading-5">
              {formatScopeItem(item)}
            </p>
          ))}
          {items.length > 4 ? (
            <p className="annual-board-muted-label text-[12px]">외 {items.length - 4}개</p>
          ) : null}
        </div>
      ) : (
        <p className="annual-board-scope-empty rounded-[4px] border px-2 py-1 text-[11px] font-medium">
          미입력
        </p>
      )}
    </div>
  );
}

function AnnualBoardCellHoverContent({
  schoolName,
  gradeLabel,
  termLabel,
  type,
  entries,
  state,
  readOnly,
  onEdit,
  onCreate,
}: {
  schoolName: string;
  gradeLabel: string;
  termLabel: string;
  type: AcademicAnnualBoardType;
  entries: AcademicAnnualBoardEntry[];
  state: EntryState;
  readOnly: boolean;
  onEdit: (entry: AcademicAnnualBoardEntry) => void;
  onCreate: () => void;
}) {
  const primaryEntry = entries[0] || null;
  const missingItems = primaryEntry ? buildBoardEntryMissingItems(primaryEntry) : [];
  const textbookScopes = getStructuredScopeItems(primaryEntry, "textbookScopes");
  const subtextbookScopes = getStructuredScopeItems(primaryEntry, "subtextbookScopes");

  return (
    <HoverCardContent
      align="start"
      sideOffset={8}
      className="annual-board-hover-card w-[336px] rounded-[6px] border p-0 shadow-[0_18px_50px_-28px_rgba(23,32,51,0.45)]"
    >
      <div className="annual-board-hover-card-header border-b px-3 py-2.5">
        <p className="annual-board-hover-title text-[13px] font-semibold">
          {schoolName} · {gradeLabel} · {termLabel}
        </p>
        <p className="annual-board-muted-label mt-0.5 text-[12px]">{getTypeLabel(type)}</p>
      </div>
      <div className="grid gap-3 px-3 py-3 text-[13px]">
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          <span className="annual-board-muted-label">일정</span>
          <span className="annual-board-hover-value font-semibold">
            {entries.length > 1 ? getEventCellLabel(entries) : getBoardCellLabel(primaryEntry, type)}
          </span>
          <span className="annual-board-muted-label">상태</span>
          <span
            className={cn(
              "font-medium",
              state === "empty" ? "annual-board-status-empty" : state === "warning" ? "annual-board-status-warning" : "annual-board-status-complete",
            )}
          >
            {state === "empty" ? "미입력" : state === "warning" ? "확인 필요" : "등록됨"}
          </span>
        </div>

        {SUBJECT_BOARD_TYPES.includes(type) ? (
          <>
            <ScopeSection title="교재 시험범위" items={textbookScopes} />
            <ScopeSection title="부교재 시험범위" items={subtextbookScopes} />
          </>
        ) : null}

        {entries.length > 1 ? (
          <div className="grid gap-1.5">
            <p className="annual-board-muted-label text-[11px] font-semibold uppercase tracking-[0.06em]">등록 일정</p>
            {entries.slice(0, 4).map((entry) => (
              <p key={entry.id} className="annual-board-scope-pill rounded-[4px] px-2 py-1 text-[12px] leading-5">
                {formatRangeLabel(entry, { compact: true })} {text(entry.title)}
              </p>
            ))}
          </div>
        ) : null}

        {missingItems.length > 0 ? (
          <div className="annual-board-scope-empty rounded-[4px] border px-2 py-1.5 text-[11px]">
            {missingItems.join(", ")}
          </div>
        ) : null}

        <Button
          type="button"
          size="sm"
          className="h-8 rounded-[4px] bg-[#2F6FED] text-[12px] active:scale-[0.98]"
          disabled={readOnly}
          onClick={() => {
            if (primaryEntry) {
              onEdit(primaryEntry);
              return;
            }
            onCreate();
          }}
        >
          <Pencil data-icon="inline-start" />
          수정
        </Button>
      </div>
    </HoverCardContent>
  );
}

function AnnualBoardValueCell({
  schoolRow,
  gradeLabel,
  row,
  termRow,
  type,
  label,
  entries,
  state,
  readOnly,
  hoveredCell,
  onHoverCell,
  onEntryEdit,
  onCellCreate,
}: {
  schoolRow: GroupedSchoolRow;
  gradeLabel: GradeColumnLabel;
  row: AcademicAnnualBoardRow;
  termRow: AnnualBoardTermRow;
  type: AcademicAnnualBoardType;
  label: string;
  entries: AcademicAnnualBoardEntry[];
  state: EntryState;
  readOnly: boolean;
  hoveredCell: HoveredAnnualBoardCell | null;
  onHoverCell: (cell: HoveredAnnualBoardCell | null) => void;
  onEntryEdit: (row: AcademicAnnualBoardRow, entry: AcademicAnnualBoardEntry) => void;
  onCellCreate: (row: AcademicAnnualBoardRow, type: AcademicAnnualBoardType, examTerm?: ExamTerm) => void;
}) {
  const isActive =
    hoveredCell?.schoolKey === schoolRow.schoolKey &&
    hoveredCell?.gradeLabel === gradeLabel &&
    hoveredCell?.termKey === termRow.key &&
    hoveredCell?.type === type;
  const examTerm = termRow.kind === "exam" ? termRow.examTerm : undefined;
  const hoverPayload = {
    schoolKey: schoolRow.schoolKey,
    gradeLabel,
    termKey: termRow.key,
    type,
  };

  return (
    <HoverCard openDelay={160} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={getCellToneClass(type, state, isActive)}
          onMouseEnter={() => onHoverCell(hoverPayload)}
          onFocus={() => onHoverCell(hoverPayload)}
          onMouseLeave={() => onHoverCell(null)}
          onBlur={() => onHoverCell(null)}
        >
          <span className="min-w-0 truncate">{label}</span>
        </button>
      </HoverCardTrigger>
      <AnnualBoardCellHoverContent
        schoolName={schoolRow.schoolName}
        gradeLabel={gradeLabel}
        termLabel={termRow.label}
        type={type}
        entries={entries}
        state={state}
        readOnly={readOnly}
        onEdit={(entry) => onEntryEdit(row, entry)}
        onCreate={() => onCellCreate(row, type, examTerm)}
      />
    </HoverCard>
  );
}

function AnnualBoardMapView({
  loading,
  groupedSchoolRows,
  gradeColumnLabels,
  termRows,
  selectedSemester,
  hoveredCell,
  readOnly,
  onHoverCell,
  onEntryEdit,
  onCellCreate,
}: {
  loading: boolean;
  groupedSchoolRows: GroupedSchoolRow[];
  gradeColumnLabels: readonly GradeColumnLabel[];
  termRows: AnnualBoardTermRow[];
  selectedSemester: SemesterFilter;
  hoveredCell: HoveredAnnualBoardCell | null;
  readOnly: boolean;
  onHoverCell: (cell: HoveredAnnualBoardCell | null) => void;
  onEntryEdit: (row: AcademicAnnualBoardRow, entry: AcademicAnnualBoardEntry) => void;
  onCellCreate: (row: AcademicAnnualBoardRow, type: AcademicAnnualBoardType, examTerm?: ExamTerm) => void;
}) {
  const rowStyle = { "--annual-board-row-count": termRows.length } as CSSProperties;

  return (
    <div className="overflow-x-auto">
      <Table className="annual-board-table min-w-[1280px] table-fixed border-separate border-spacing-0 text-[12px]">
        <TableHeader>
          <TableRow className="annual-board-table-header">
            <TableHead className="sticky left-0 z-20 w-[148px] border-b border-r border-[#D9E1EA] bg-[#FFFFFF] px-3 py-2 text-[11px] font-semibold text-[#475467]">
              학교
            </TableHead>
            <TableHead className="w-[52px] border-b border-r border-[#D9E1EA] bg-[#FFFFFF] px-2 py-2 text-[11px] font-semibold text-[#475467]">
              시기
            </TableHead>
            {gradeColumnLabels.map((gradeLabel) => (
              <TableHead
                key={gradeLabel}
                className={cn(
                  "w-[360px] border-b border-r border-[#D9E1EA] bg-[#FFFFFF] px-2 py-2 text-[11px] font-semibold text-[#475467]",
                  hoveredCell?.gradeLabel === gradeLabel && "annual-board-column-active",
                )}
              >
                {gradeLabel}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <AnnualBoardSkeleton columns={["시기", ...gradeColumnLabels]} />
          ) : groupedSchoolRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={gradeColumnLabels.length + 2} className="h-40 text-center text-sm font-medium text-[#475467]">
                조건에 맞는 일정 없음
              </TableCell>
            </TableRow>
          ) : (
            groupedSchoolRows.map((schoolRow, rowIndex) => {
              const rowActive = hoveredCell?.schoolKey === schoolRow.schoolKey;
              return (
                <TableRow
                  key={`map-${schoolRow.schoolKey}`}
                  className={cn("annual-board-map-row align-top", rowIndex % 2 === 1 && "annual-board-map-row-alt", rowActive && "annual-board-row-active")}
                  style={rowStyle}
                >
                  <TableCell className="annual-board-school-cell sticky left-0 z-10 border-b border-r border-[#D9E1EA] px-3 py-3 align-top">
                    <span className={cn("annual-board-school-name block truncate text-[13px] font-semibold", rowActive && "annual-board-school-name-active")}>
                      {schoolRow.schoolName}
                    </span>
                  </TableCell>
                  <TableCell className="border-b border-r border-[#D9E1EA] p-0 align-top">
                    <div className="annual-board-term-stack">
                      <div className="annual-board-grade-subheader">시기</div>
                      {termRows.map((termRow) => (
                        <div
                          key={`${schoolRow.schoolKey}-${termRow.key}`}
                          className={cn(
                            "annual-board-term-cell",
                            termRow.kind === "exam" && termRow.semester === "1학기" && "annual-board-term-first",
                            termRow.kind === "exam" && termRow.semester === "2학기" && "annual-board-term-second",
                            hoveredCell?.schoolKey === schoolRow.schoolKey && hoveredCell?.termKey === termRow.key && "annual-board-term-active",
                          )}
                        >
                          {termRow.label}
                        </div>
                      ))}
                    </div>
                  </TableCell>
                  {gradeColumnLabels.map((gradeLabel) => {
                    const gradeRow = schoolRow.gradeMap.get(gradeLabel) || null;
                    const columnActive = hoveredCell?.gradeLabel === gradeLabel;
                    return (
                      <TableCell
                        key={`map-${schoolRow.schoolKey}-${gradeLabel}`}
                        className={cn("annual-board-grade-cell border-b border-r border-[#D9E1EA] p-0 align-top", columnActive && "annual-board-column-active")}
                      >
                        {gradeRow ? (
                          <div className="annual-board-grade-grid">
                            <div className="annual-board-grade-subheader">시험기간</div>
                            <div className="annual-board-grade-subheader">영어</div>
                            <div className="annual-board-grade-subheader">수학</div>
                            {termRows.map((termRow) => {
                              if (termRow.kind === "event") {
                                const entries = getEventEntriesForSemester(gradeRow, termRow.type, selectedSemester);
                                const state = getCellStateForEntries(entries, termRow.type);
                                return (
                                  <div key={`${gradeRow.id}-${termRow.key}`} className="annual-board-event-row">
                                    <AnnualBoardValueCell
                                      schoolRow={schoolRow}
                                      gradeLabel={gradeLabel}
                                      row={gradeRow}
                                      termRow={termRow}
                                      type={termRow.type}
                                      label={getEventCellLabel(entries, { compact: true })}
                                      entries={entries}
                                      state={state}
                                      readOnly={readOnly}
                                      hoveredCell={hoveredCell}
                                      onHoverCell={onHoverCell}
                                      onEntryEdit={onEntryEdit}
                                      onCellCreate={onCellCreate}
                                    />
                                  </div>
                                );
                              }

                              const periodEntry = getEntryByTerm(gradeRow, "시험기간", termRow.examTerm);
                              const englishEntry = getEntryByTerm(gradeRow, "영어시험일", termRow.examTerm);
                              const mathEntry = getEntryByTerm(gradeRow, "수학시험일", termRow.examTerm);
                              const cells = [
                                { type: "시험기간" as const, entry: periodEntry, label: getBoardCellLabel(periodEntry, "시험기간", { compact: true }) },
                                { type: "영어시험일" as const, entry: englishEntry, label: getBoardCellLabel(englishEntry, "영어시험일", { compact: true }).replace("시험일 미입력", "미입력") },
                                { type: "수학시험일" as const, entry: mathEntry, label: getBoardCellLabel(mathEntry, "수학시험일", { compact: true }).replace("시험일 미입력", "미입력") },
                              ];
                              return cells.map((cell) => (
                                <div key={`${gradeRow.id}-${termRow.key}-${cell.type}`} className="annual-board-exam-cell">
                                  <AnnualBoardValueCell
                                    schoolRow={schoolRow}
                                    gradeLabel={gradeLabel}
                                    row={gradeRow}
                                    termRow={termRow}
                                    type={cell.type}
                                    label={cell.label}
                                    entries={cell.entry ? [cell.entry] : []}
                                    state={getEntryState(cell.entry, cell.type)}
                                    readOnly={readOnly}
                                    hoveredCell={hoveredCell}
                                    onHoverCell={onHoverCell}
                                    onEntryEdit={onEntryEdit}
                                    onCellCreate={onCellCreate}
                                  />
                                </div>
                              ));
                            })}
                          </div>
                        ) : (
                          <div className="annual-board-empty-grade flex h-full min-h-40 items-center justify-center text-[13px] font-medium">—</div>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function AcademicAnnualBoardWorkspace() {
  const searchParams = useSearchParams();
  const { canManageAll } = useAuth();
  const { data, loading, error, refresh } = useOperationsWorkspaceData();
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<"high" | "middle">("high");
  const [selectedSemester, setSelectedSemester] = useState<SemesterFilter>("전체");
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [highlightEventId, setHighlightEventId] = useState("");
  const [appliedHighlightEventId, setAppliedHighlightEventId] = useState("");
  const [hoveredCell, setHoveredCell] = useState<HoveredAnnualBoardCell | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [editingBoardEvent, setEditingBoardEvent] = useState<CalendarEvent | null>(null);
  const [boardDraft, setBoardDraft] = useState<Partial<CalendarEvent> | null>(null);
  const [showBoardEventForm, setShowBoardEventForm] = useState(false);
  const isSeedCalendar = data.academicCalendarSource === "seed";
  const readOnly = !canManageAll || isSeedCalendar;

  useEffect(() => {
    const initialYear = text(searchParams.get("year"));
    const initialCategory = text(searchParams.get("category"));
    const initialSchoolId = text(searchParams.get("schoolId"));
    const initialSemester = text(searchParams.get("semester"));
    const initialEventId = text(searchParams.get("eventId"));
    const normalizedCategory = initialCategory === "middle" ? "middle" : "high";

    setSelectedYear(initialYear);
    setSelectedCategory(normalizedCategory);
    setSelectedSchoolId(initialSchoolId);
    setSelectedSemester(SEMESTER_FILTER_OPTIONS.includes(initialSemester as SemesterFilter) ? (initialSemester as SemesterFilter) : "전체");
    setHighlightEventId(initialEventId);
  }, [searchParams]);

  const model = useMemo(
    () =>
      buildAcademicAnnualBoardModel({
        academicEvents: data.academicEvents,
        academicSchools: data.academicSchools,
        academicEventExamDetails: data.academicEventExamDetails,
        academyCurriculumPlans: data.academyCurriculumPlans,
        academyCurriculumMaterials: data.academyCurriculumMaterials,
        academicCurriculumProfiles: data.academicCurriculumProfiles,
        academicSupplementMaterials: data.academicSupplementMaterials,
        academicExamMaterialPlans: data.academicExamMaterialPlans,
        academicExamMaterialItems: data.academicExamMaterialItems,
        textbooks: data.textbooks,
        selectedYear,
        selectedSemester,
      }),
    [data.academicEventExamDetails, data.academicEvents, data.academicSchools, data.academicCurriculumProfiles, data.academicExamMaterialItems, data.academicExamMaterialPlans, data.academicSupplementMaterials, data.academyCurriculumMaterials, data.academyCurriculumPlans, data.textbooks, selectedSemester, selectedYear],
  );

  const allSchoolOptions = useMemo(
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

  const typeOptions = useMemo(() => DEFAULT_ACADEMIC_EVENT_TYPES, []);
  const activeGradeColumnLabels = useMemo(
    () => (selectedCategory === "middle" ? [...MIDDLE_GRADE_COLUMN_LABELS] : [...HIGH_GRADE_COLUMN_LABELS]),
    [selectedCategory],
  );
  const visibleTermRows = useMemo(() => getTermRows(selectedSemester), [selectedSemester]);

  const filteredRows = useMemo(() => {
    return model.rows.filter((row) => {
      const matchesCategory = row.category === selectedCategory;
      const matchesSchoolId = !selectedSchoolId || buildSchoolFilterValue(row) === selectedSchoolId;
      return matchesCategory && matchesSchoolId;
    });
  }, [model.rows, selectedCategory, selectedSchoolId]);

  const schoolOptions = useMemo(() => {
    const bySchool = new Map<string, { value: string; label: string }>();
    model.rows
      .filter((row) => row.category === selectedCategory)
      .forEach((row) => {
        const schoolId = buildSchoolFilterValue(row);
        if (!schoolId || bySchool.has(schoolId)) {
          return;
        }
        bySchool.set(schoolId, {
          value: schoolId,
          label: text(row.schoolName) || schoolId,
        });
      });

    return [
      { value: "all", label: "전체 학교" },
      ...[...bySchool.values()].sort((left, right) => left.label.localeCompare(right.label, "ko")),
    ];
  }, [model.rows, selectedCategory]);

  const groupedSchoolRows = useMemo(() => buildGroupedSchoolRows(filteredRows), [filteredRows]);
  const printSummary = `${model.selectedYear}년 · ${selectedCategory === "middle" ? "중등" : "고등"} · ${schoolOptions.find((school) => school.value === selectedSchoolId)?.label || "전체 학교"} · 학교 연간 일정표`;
  const hasActiveFilters =
    selectedCategory !== "high" ||
    selectedSemester !== "전체" ||
    Boolean(selectedSchoolId) ||
    Boolean(highlightEventId);

  useEffect(() => {
    if (selectedSchoolId && !schoolOptions.some((option) => option.value === selectedSchoolId)) {
      setSelectedSchoolId("");
    }
  }, [schoolOptions, selectedSchoolId]);

  useEffect(() => {
    setHoveredCell(null);
  }, [selectedSemester, selectedCategory, selectedSchoolId]);

  useEffect(() => {
    if (!highlightEventId || appliedHighlightEventId === highlightEventId) {
      return;
    }

    for (const schoolRow of groupedSchoolRows) {
      for (const gradeLabel of activeGradeColumnLabels) {
        const row = schoolRow.gradeMap.get(gradeLabel);
        if (!row) {
          continue;
        }
        for (const type of BOARD_TYPES) {
          const matchedEntry = (row.typeBuckets[type] || []).find((entry) => text(entry.id) === highlightEventId);
          if (!matchedEntry) {
            continue;
          }
          const matchedExamTerm = FIXED_EXAM_TERM_ROWS.find((term) => term === text(matchedEntry.examTerm));
          const matchedTermRow = matchedExamTerm
            ? ANNUAL_BOARD_TERM_ROWS.find((termRow) => termRow.kind === "exam" && termRow.examTerm === matchedExamTerm)
            : ANNUAL_BOARD_TERM_ROWS.find((termRow) => termRow.kind === "event" && termRow.type === type);
          const matchedSemester = getEntrySemester(matchedEntry);
          if (matchedSemester) {
            setSelectedSemester(matchedSemester);
          }
          setHoveredCell({
            schoolKey: schoolRow.schoolKey,
            gradeLabel,
            type,
            termKey: matchedTermRow?.key || "1-mid",
          });
          setAppliedHighlightEventId(highlightEventId);
          return;
        }
      }
    }
  }, [activeGradeColumnLabels, appliedHighlightEventId, groupedSchoolRows, highlightEventId]);

  const handleResetFilters = () => {
    setSelectedCategory("high");
    setSelectedSemester("전체");
    setSelectedSchoolId("");
    setHighlightEventId("");
    setHoveredCell(null);
  };

  const handleBoardEntryEdit = (
    row: {
      schoolId?: string;
      schoolName: string;
      category: string;
      grade: string;
    },
    entry: AcademicAnnualBoardEntry,
  ) => {
    setBoardDraft(null);
    setEditingBoardEvent({
      id: entry.id,
      sourceId: entry.id,
      title: entry.title,
      date: parseLocalDate(entry.start),
      endDate: parseLocalDate(entry.end || entry.start),
      time: entry.schoolName || row.schoolName,
      duration: entry.start === entry.end ? "하루 일정" : `${entry.start} ~ ${entry.end}`,
      type: entry.type === "체험학습" ? "event" : entry.type === "방학·휴일·기타" ? "reminder" : "task",
      typeLabel: entry.type,
      attendees: Array.isArray(entry.gradeBadges) ? entry.gradeBadges : [],
      location: entry.schoolName || row.schoolName,
      color: entry.type === "체험학습" ? "bg-emerald-500" : entry.type === "방학·휴일·기타" ? "bg-amber-500" : "bg-rose-500",
      description: entry.note || entry.scopeSummary || "",
      schoolId: entry.schoolId || row.schoolId,
      schoolName: entry.schoolName || row.schoolName,
      category: row.category,
      grade: entry.grade || row.grade,
      examTerm: entry.examTerm || "",
      textbookScopes: normalizeScopeItems(entry.textbookScopes),
      subtextbookScopes: normalizeScopeItems(entry.subtextbookScopes),
      note: entry.note || entry.scopeSummary || "",
    });
    setShowBoardEventForm(true);
  };

  const handleBoardCellCreate = (
    row: AcademicAnnualBoardRow,
    type: AcademicAnnualBoardType,
    examTerm: ExamTerm = "1학기 중간",
  ) => {
    if (readOnly) {
      return;
    }

    const resolvedExamTerm = type === "시험기간" || isSubjectExamType(type) ? examTerm : "";
    const draftDate = buildBoardDraftDate(model.selectedYear, row, type, resolvedExamTerm);
    setEditingBoardEvent(null);
    setBoardDraft({
      title: buildBoardEventTitle(type),
      schoolId: row.schoolId,
      schoolName: row.schoolName,
      category: row.category,
      grade: row.grade,
      typeLabel: type,
      date: draftDate,
      endDate: draftDate,
      note: "",
      examTerm: resolvedExamTerm,
      textbookScopes: [],
      subtextbookScopes: [],
    });
    setShowBoardEventForm(true);
  };

  const handleSaveBoardEvent = async (eventData: Partial<CalendarEvent>) => {
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

    const result = buildAcademicEventMutationPayload(
      {
        id: eventData.id,
        title: eventData.title,
        schoolId: eventData.schoolId,
        type: eventData.typeLabel,
        start: toDateKey(eventData.date),
        end: toDateKey(eventData.endDate || eventData.date),
        grade: eventData.grade,
        note: eventData.note || eventData.description,
        examTerm: eventData.examTerm,
        textbookScope: "",
        subtextbookScope: "",
        textbookScopes: eventData.textbookScopes,
        subtextbookScopes: eventData.subtextbookScopes,
      },
      allSchoolOptions,
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
        const updatePayload = { ...result.payload } as Record<string, unknown>;
        delete updatePayload.id;
        const { error: updateError } = await supabase.from("academic_events").update(updatePayload).eq("id", existingId);
        if (updateError) {
          throw updateError;
        }
        toast.success("학사 일정이 업데이트되었습니다.");
      } else {
        const { error: insertError } = await supabase.from("academic_events").insert([result.payload]);
        if (insertError) {
          throw insertError;
        }
        toast.success("새 학사 일정을 추가했습니다.");
      }

      setMutationError(null);
      await refresh();
      setBoardDraft(null);
      setEditingBoardEvent(null);
      setHoveredCell(null);
      return true;
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "학사 일정 저장 중 오류가 발생했습니다.";
      setMutationError(message);
      toast.error(message);
      return false;
    }
  };

  const handleDeleteBoardEvent = async (eventId: number | string) => {
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
      const { error: deleteError } = await supabase.from("academic_events").delete().eq("id", text(eventId));
      if (deleteError) {
        throw deleteError;
      }
      setMutationError(null);
      toast.success("학사 일정을 삭제했습니다.");
      await refresh();
      setBoardDraft(null);
      setEditingBoardEvent(null);
      setHoveredCell(null);
      return true;
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "학사 일정 삭제 중 오류가 발생했습니다.";
      setMutationError(message);
      toast.error(message);
      return false;
    }
  };

  return (
    <div className="annual-board-workspace flex flex-col gap-4">
      {error || mutationError ? (
        <div className="annual-board-non-print px-4 lg:px-6">
          <Alert variant="destructive">
            <AlertDescription>{error || mutationError}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {isSeedCalendar || !canManageAll ? (
        <div className="annual-board-non-print px-4 lg:px-6">
          <Alert>
            <AlertDescription>
              {isSeedCalendar ? "연간 일정표는 현재 기본 학사일정 세트를 기준으로 표시됩니다." : "읽기 전용 상태로 표시됩니다."}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="px-4 lg:px-6">
        <div className="annual-board-print-surface overflow-hidden border">
          <div className="annual-board-print-header hidden border-b px-4 py-3 print:block">
            <h2 className="text-sm font-semibold text-foreground">{printSummary}</h2>
          </div>

          <div className="annual-board-non-print flex flex-wrap items-end gap-3 border-b px-4 py-3">
            <div className="grid flex-1 gap-3 xl:grid-cols-[112px_168px_168px_168px_112px]">
              <div className="grid gap-2">
                <Label htmlFor="annual-board-year" className="text-[11px] text-muted-foreground">연도</Label>
                <Select value={model.selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger id="annual-board-year" className="h-9 w-full rounded-sm text-[12px] font-medium">
                    <SelectValue placeholder="연도 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {model.yearOptions.map((year) => (
                      <SelectItem key={year} value={year}>
                        {year}년
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label className="text-[11px] text-muted-foreground">학교 분류</Label>
                <div className="flex h-9 w-full items-center gap-1 rounded-sm border border-border/70 bg-muted/15 p-1">
                  {[
                    { value: "high", label: "고등" },
                    { value: "middle", label: "중등" },
                  ].map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      size="sm"
                      variant={selectedCategory === option.value ? "default" : "ghost"}
                      onClick={() => setSelectedCategory(option.value as "high" | "middle")}
                      className="h-7 flex-1 rounded-sm px-3 text-[12px] font-medium active:scale-[0.98]"
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="annual-board-semester" className="text-[11px] text-muted-foreground">시기</Label>
                <div id="annual-board-semester" className="flex h-9 w-full items-center gap-1 rounded-sm border border-border/70 bg-muted/15 p-1">
                  {SEMESTER_FILTER_OPTIONS.map((option) => (
                    <Button
                      key={option}
                      type="button"
                      size="sm"
                      variant={selectedSemester === option ? "default" : "ghost"}
                      onClick={() => setSelectedSemester(option)}
                      className="h-7 flex-1 rounded-sm px-3 text-[12px] font-medium active:scale-[0.98]"
                    >
                      {option}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="annual-board-school" className="text-[11px] text-muted-foreground">학교</Label>
                <Select value={selectedSchoolId || "all"} onValueChange={(value) => setSelectedSchoolId(value === "all" ? "" : value)}>
                  <SelectTrigger id="annual-board-school" className="h-9 w-full rounded-sm text-[12px] font-medium">
                    <SelectValue placeholder="학교 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {schoolOptions.map((option) => (
                      <SelectItem key={option.value || "all-schools"} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label className="text-[11px] text-muted-foreground">인쇄</Label>
                <Button type="button" size="sm" className="h-9 w-full rounded-sm bg-[#2F6FED] px-4 text-[12px] font-medium active:scale-[0.98]" onClick={() => window.print()}>
                  <Printer data-icon="inline-start" />
                  인쇄
                </Button>
              </div>
            </div>
            {hasActiveFilters ? (
              <div className="flex shrink-0 items-end gap-2">
                <Button type="button" variant="ghost" className="h-9 rounded-sm px-3 text-[12px] font-medium text-muted-foreground" onClick={handleResetFilters}>
                  필터 초기화
                </Button>
              </div>
            ) : null}
          </div>

          <div className="annual-board-non-print border-b px-4 py-2.5">
            <p className="text-[12px] font-medium text-muted-foreground">
              {printSummary} · {selectedSemester === "전체" ? "전체 시기" : selectedSemester}
            </p>
          </div>

          <AnnualBoardMapView
            loading={loading}
            groupedSchoolRows={groupedSchoolRows}
            gradeColumnLabels={activeGradeColumnLabels}
            termRows={visibleTermRows}
            selectedSemester={selectedSemester}
            hoveredCell={hoveredCell}
            readOnly={readOnly}
            onHoverCell={setHoveredCell}
            onEntryEdit={handleBoardEntryEdit}
            onCellCreate={handleBoardCellCreate}
          />
        </div>
      </div>

      <EventForm
        event={editingBoardEvent}
        open={showBoardEventForm}
        readOnly={readOnly}
        schoolOptions={allSchoolOptions}
        typeOptions={typeOptions}
        defaultDate={boardDraft?.date instanceof Date ? boardDraft.date : undefined}
        defaultEndDate={boardDraft?.endDate instanceof Date ? boardDraft.endDate : undefined}
        initialDraft={boardDraft}
        onOpenChange={(open) => {
          setShowBoardEventForm(open);
          if (!open) {
            setBoardDraft(null);
            setEditingBoardEvent(null);
          }
        }}
        onSave={handleSaveBoardEvent}
        onDelete={readOnly ? undefined : handleDeleteBoardEvent}
      />
    </div>
  );
}
