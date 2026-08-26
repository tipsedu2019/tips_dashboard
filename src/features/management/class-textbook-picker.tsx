"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { SearchCombobox, SearchComboboxItem } from "@/components/ui/search-combobox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { PickerMetaPills } from "./picker-meta-pills";
import {
  PICKER_FILTER_TRIGGER_CLASS_NAME,
  PickerFilterField,
  PickerFilterSurface,
} from "./picker-filter-surface";

type ClassTextbookPickerProps = {
  classRecord: Record<string, unknown>;
  textbooks: ClassTextbookRecord[];
  selectedIds: string[];
  disabled: boolean;
  loading: boolean;
  hasMore: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onFiltersChange: (filters: ClassTextbookPickerFilters) => void;
  onLoadMore: () => Promise<void> | void;
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
  loading,
  hasMore,
  query,
  onQueryChange,
  onFiltersChange,
  onLoadMore,
  onSelectedIdsChange,
}: ClassTextbookPickerProps) {
  const [open, setOpen] = useState(false);
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

  useEffect(() => {
    onFiltersChange(filters);
  }, [filters, onFiltersChange]);

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
    onQueryChange("");
  }

  return (
    <SearchCombobox
      open={open}
      onOpenChange={setOpen}
      triggerLabel="교재 검색 또는 선택"
      triggerPlaceholder
      triggerAriaLabel="교재 검색 또는 선택"
      searchValue={query}
      onSearchValueChange={onQueryChange}
      searchPlaceholder="교재명, 출판사 검색"
      searchAriaLabel="교재 검색"
      searchAction={(
        <Button type="button" size="sm" variant="ghost" onClick={showAll}>
          전체 보기
        </Button>
      )}
      listAriaLabel="선택 가능한 교재"
      emptyMessage="조건에 맞는 교재 없음"
      loading={loading && candidates.length === 0}
      loadingMessage="교재 불러오는 중"
      disabled={disabled}
      contentClassName="min-w-[min(calc(100vw-2rem),24rem)]"
      filters={(
        <PickerFilterSurface>
            <PickerFilterField label="과목">
              <Select value={filters.subject || "all"} onValueChange={(value) => updateFilter("subject", value === "all" ? "" : value)}>
                <SelectTrigger className={PICKER_FILTER_TRIGGER_CLASS_NAME} aria-label="과목"><SelectValue placeholder="과목" /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">전체 과목</SelectItem>
                    {TEXTBOOK_SUBJECT_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </PickerFilterField>
            <PickerFilterField label="세부과목">
              <Select value={filters.subSubject || "all"} onValueChange={(value) => updateFilter("subSubject", value === "all" ? "" : value)}>
                <SelectTrigger className={PICKER_FILTER_TRIGGER_CLASS_NAME} aria-label="세부과목"><SelectValue placeholder="세부과목" /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">전체 세부과목</SelectItem>
                    {subSubjectOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </PickerFilterField>
            <PickerFilterField label="학교 구분">
              <Select value={filters.schoolLevel || "all"} onValueChange={(value) => updateFilter("schoolLevel", value === "all" ? "" : value)}>
                <SelectTrigger className={PICKER_FILTER_TRIGGER_CLASS_NAME} aria-label="학교 구분"><SelectValue placeholder="학교 구분" /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">전체 학교 구분</SelectItem>
                    {TEXTBOOK_SCHOOL_LEVEL_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </PickerFilterField>
            <PickerFilterField label="학년">
              <Select value={filters.gradeLevel || "all"} onValueChange={(value) => updateFilter("gradeLevel", value === "all" ? "" : value)}>
                <SelectTrigger className={PICKER_FILTER_TRIGGER_CLASS_NAME} aria-label="학년"><SelectValue placeholder="학년" /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">전체 학년</SelectItem>
                    {gradeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </PickerFilterField>
        </PickerFilterSurface>
      )}
      footer={hasMore ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="w-full"
          disabled={loading}
          onClick={() => void onLoadMore()}
        >
          {loading ? "더 불러오는 중" : "다음 30건"}
        </Button>
      ) : null}
    >
      {candidates.map((textbook) => (
        <SearchComboboxItem
          key={textbook.id}
          value={textbook.id}
          onSelect={() => {
            onSelectedIdsChange(selectedIds.includes(textbook.id) ? selectedIds : [...selectedIds, textbook.id]);
          }}
        >
          <div className="grid min-w-0 flex-1 gap-1.5 text-left">
                  <span className="truncate font-medium">{textbook.title}</span>
                  <PickerMetaPills
                    items={[
                      { key: "subject", value: getTextbookSubjectLabel(textbook.subject), tone: "primary" },
                      { key: "subSubject", value: textbook.subSubject },
                      { key: "schoolLevel", value: getTextbookSchoolLevelSummary(textbook) },
                      { key: "gradeLevel", value: getTextbookGradeSummary(textbook) },
                    ]}
                  />
          </div>
        </SearchComboboxItem>
      ))}
    </SearchCombobox>
  );
}
