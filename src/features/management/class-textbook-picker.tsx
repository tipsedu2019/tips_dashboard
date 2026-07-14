"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  TEXTBOOK_GRADE_OPTIONS,
  TEXTBOOK_SCHOOL_LEVEL_OPTIONS,
  TEXTBOOK_SUBJECT_OPTIONS,
  getTextbookGradeSummary,
  getTextbookSchoolLevelSummary,
  getTextbookSubjectLabel,
  normalizeTextbookSubject,
} from "@/features/textbooks/textbook-taxonomy";

import {
  ClassTextbookPickerFilters,
  ClassTextbookRecord,
  filterClassTextbookCandidates,
  getDefaultClassTextbookFilters,
} from "./class-textbook-picker-model";

type ClassTextbookPickerProps = {
  classRecord: Record<string, unknown>;
  textbooks: ClassTextbookRecord[];
  selectedIds: string[];
  disabled: boolean;
  onSelectedIdsChange: (ids: string[]) => void;
};

function text(value: unknown) {
  return String(value || "").trim();
}

export function ClassTextbookPicker({
  classRecord,
  textbooks,
  selectedIds,
  disabled,
  onSelectedIdsChange,
}: ClassTextbookPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ClassTextbookPickerFilters>(() =>
    getDefaultClassTextbookFilters(classRecord),
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const candidates = useMemo(
    () => filterClassTextbookCandidates(textbooks, filters, query)
      .filter((textbook) => !selectedIdSet.has(textbook.id)),
    [filters, query, selectedIdSet, textbooks],
  );
  const gradeOptions = TEXTBOOK_GRADE_OPTIONS.filter((option) =>
    !filters.schoolLevel || option.schoolLevel === filters.schoolLevel,
  );
  const subSubjectOptions = useMemo(
    () => [...new Set(textbooks
      .filter((textbook) => !filters.subject || normalizeTextbookSubject(textbook.subject) === filters.subject)
      .map((textbook) => text(textbook.subSubject))
      .filter(Boolean))].sort((left, right) => left.localeCompare(right, "ko")),
    [filters.subject, textbooks],
  );

  function updateFilter(name: keyof ClassTextbookPickerFilters, value: string) {
    setFilters((current) => {
      if (name === "subject") {
        return { ...current, subject: value, subSubject: "" };
      }
      if (name === "schoolLevel") {
        const gradeStillFits = !current.gradeLevel || TEXTBOOK_GRADE_OPTIONS.some(
          (option) => option.value === current.gradeLevel && (!value || option.schoolLevel === value),
        );
        return { ...current, schoolLevel: value, gradeLevel: gradeStillFits ? current.gradeLevel : "" };
      }
      return { ...current, [name]: value };
    });
  }

  function showAll() {
    setFilters({ subject: "", schoolLevel: "", gradeLevel: "", subSubject: "" });
  }

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" disabled={disabled || textbooks.length === 0}>
          <Plus className="size-4" aria-hidden="true" />
          교재 추가
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(calc(100vw-2rem),36rem)] p-2">
        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <Input
              value={query}
              placeholder="교재명, 출판사 검색"
              aria-label="교재 검색"
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={showAll}>
              전체 보기
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={filters.subject || "all"} onValueChange={(value) => updateFilter("subject", value === "all" ? "" : value)}>
              <SelectTrigger className="h-9" aria-label="과목"><SelectValue placeholder="과목" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 과목</SelectItem>
                {TEXTBOOK_SUBJECT_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.schoolLevel || "all"} onValueChange={(value) => updateFilter("schoolLevel", value === "all" ? "" : value)}>
              <SelectTrigger className="h-9" aria-label="학교 구분"><SelectValue placeholder="학교 구분" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 학교 구분</SelectItem>
                {TEXTBOOK_SCHOOL_LEVEL_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.gradeLevel || "all"} onValueChange={(value) => updateFilter("gradeLevel", value === "all" ? "" : value)}>
              <SelectTrigger className="h-9" aria-label="학년"><SelectValue placeholder="학년" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 학년</SelectItem>
                {gradeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.subSubject || "all"} onValueChange={(value) => updateFilter("subSubject", value === "all" ? "" : value)}>
              <SelectTrigger className="h-9" aria-label="세부과목"><SelectValue placeholder="세부과목" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 세부과목</SelectItem>
                {subSubjectOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="max-h-72 overscroll-contain overflow-y-auto">
            {candidates.length === 0 ? (
              <div className="grid justify-items-start gap-2 px-2 py-3 text-sm text-muted-foreground">
                <span>조건에 맞는 교재 없음</span>
                <Button type="button" size="sm" variant="outline" onClick={showAll}>전체 보기</Button>
              </div>
            ) : candidates.map((textbook) => {
              const meta = [
                getTextbookSubjectLabel(textbook.subject),
                getTextbookSchoolLevelSummary(textbook),
                getTextbookGradeSummary(textbook),
                textbook.subSubject,
                textbook.publisher,
              ].filter(Boolean).join(" · ");
              return (
                <button
                  key={textbook.id}
                  type="button"
                  className="grid w-full gap-0.5 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onSelectedIdsChange(selectedIds.includes(textbook.id) ? selectedIds : [...selectedIds, textbook.id]);
                    setOpen(false);
                  }}
                >
                  <span className="truncate font-medium">{textbook.title}</span>
                  {meta ? <span className="truncate text-xs text-muted-foreground">{meta}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
