"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { DEFAULT_ACADEMIC_EVENT_TYPES, getAcademicEventTypeLabel, isExamTypeWithTerm, isSubjectExamType } from "@/features/operations/academic-event-utils.js"
import { type CalendarEvent, type TextbookScopeItem } from "../types"
import {
  createEmptyTextbookScopeItem,
  getEventGradeOptions,
  getGradeBadgeLabels,
  getGradeOptionsForSchoolCategory,
  getSchoolOptionsForGrade,
  normalizeTextbookScopeItems,
  parseGradeSelection,
  serializeGradeSelection,
} from "../utils/calendar-grid.js"

interface SchoolOption {
  id: string
  name: string
  category?: string
}

interface EventFormProps {
  event?: CalendarEvent | null
  initialDraft?: Partial<CalendarEvent> | null
  open: boolean
  readOnly?: boolean
  schoolOptions?: SchoolOption[]
  typeOptions?: string[]
  defaultDate?: Date
  defaultEndDate?: Date
  onOpenChange: (open: boolean) => void
  onSave: (event: Partial<CalendarEvent>) => boolean | Promise<boolean>
  onDelete?: (eventId: number | string) => boolean | Promise<boolean>
}

function ScopeFields({
  label,
  items,
  disabled,
  onChange,
  onAdd,
  onRemove,
}: {
  label: string
  items: TextbookScopeItem[]
  disabled: boolean
  onChange: (index: number, field: keyof TextbookScopeItem, value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        {!disabled ? (
          <Button type="button" variant="outline" size="sm" onClick={onAdd} className="cursor-pointer">
            추가
          </Button>
        ) : null}
      </div>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={`${label}-${index}`} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_1fr_1.4fr_auto]">
            <Input
              placeholder="교재명"
              value={item.name}
              disabled={disabled}
              onChange={(event) => onChange(index, "name", event.target.value)}
            />
            <Input
              placeholder="출판사"
              value={item.publisher}
              disabled={disabled}
              onChange={(event) => onChange(index, "publisher", event.target.value)}
            />
            <Input
              placeholder="범위"
              value={item.scope}
              disabled={disabled}
              onChange={(event) => onChange(index, "scope", event.target.value)}
            />
            {!disabled ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemove(index)}
                className="cursor-pointer"
              >
                삭제
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function toDateInputValue(date?: Date | null) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return ""
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function fromDateInputValue(value: string) {
  if (!value) {
    return null
  }

  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) {
    return null
  }

  return new Date(year, month - 1, day, 12)
}

const fallbackTypeOptions = DEFAULT_ACADEMIC_EVENT_TYPES

const examTermOptions = ["1학기 중간", "1학기 기말", "2학기 중간", "2학기 기말"]

function toggleGradeSelection(currentGrades: string[], grade: string) {
  if (grade === "all") {
    return ["all"]
  }

  const withoutAll = currentGrades.filter((value) => value !== "all")
  if (withoutAll.includes(grade)) {
    const nextGrades = withoutAll.filter((value) => value !== grade)
    return nextGrades.length > 0 ? nextGrades : ["all"]
  }

  return [...withoutAll, grade]
}

export function EventForm({
  event,
  initialDraft,
  open,
  readOnly = false,
  schoolOptions = [],
  typeOptions = fallbackTypeOptions,
  defaultDate,
  defaultEndDate,
  onOpenChange,
  onSave,
  onDelete,
}: EventFormProps) {
  const [formData, setFormData] = useState({
    title: "",
    schoolId: "",
    date: "",
    endDate: "",
    typeLabel: typeOptions[0] || fallbackTypeOptions[0],
    grade: "all",
    examTerm: examTermOptions[0],
    textbookScopes: [createEmptyTextbookScopeItem()],
    subtextbookScopes: [createEmptyTextbookScopeItem()],
    note: "",
  })

  useEffect(() => {
    if (!open) {
      return
    }

    setFormData({
      title: event?.title || initialDraft?.title || "",
      schoolId: event?.schoolId || initialDraft?.schoolId || "",
      date: toDateInputValue(event?.date) || toDateInputValue(initialDraft?.date as Date) || toDateInputValue(defaultDate || new Date()),
      endDate:
        toDateInputValue(event?.endDate || event?.date) ||
        toDateInputValue((initialDraft?.endDate as Date) || (initialDraft?.date as Date)) ||
        toDateInputValue(defaultEndDate || defaultDate || new Date()),
      typeLabel: event?.typeLabel || initialDraft?.typeLabel || typeOptions[0] || fallbackTypeOptions[0],
      grade: serializeGradeSelection(event?.grade || initialDraft?.grade || "all"),
      examTerm: event?.examTerm || initialDraft?.examTerm || examTermOptions[0],
      textbookScopes: normalizeTextbookScopeItems(event?.textbookScopes || initialDraft?.textbookScopes),
      subtextbookScopes: normalizeTextbookScopeItems(event?.subtextbookScopes || initialDraft?.subtextbookScopes),
      note: event?.note || event?.description || initialDraft?.note || initialDraft?.description || "",
    })
  }, [defaultDate, defaultEndDate, event, initialDraft, open, typeOptions])

  const selectedSchool = useMemo(
    () => schoolOptions.find((school) => school.id === formData.schoolId) || null,
    [formData.schoolId, schoolOptions],
  )
  const selectedGrades = useMemo(() => parseGradeSelection(formData.grade), [formData.grade])
  const selectedGradeBadges = useMemo(() => getGradeBadgeLabels(formData.grade), [formData.grade])
  const allGradeOptions = useMemo(() => getEventGradeOptions(), [])
  const gradeOptions = useMemo(
    () => getGradeOptionsForSchoolCategory(selectedSchool?.category),
    [selectedSchool?.category],
  )
  const filteredSchoolOptions = useMemo(
    () => getSchoolOptionsForGrade(formData.grade, schoolOptions),
    [formData.grade, schoolOptions],
  )

  useEffect(() => {
    if (!selectedSchool) {
      return
    }

    const allowedGrades = getGradeOptionsForSchoolCategory(selectedSchool.category).map((option) => option.value)
    const nextGrades = selectedGrades.filter((grade) => grade === "all" || allowedGrades.includes(grade))
    const normalizedCurrent = serializeGradeSelection(selectedGrades)
    const normalizedNext = serializeGradeSelection(nextGrades)
    if (normalizedCurrent !== normalizedNext) {
      setFormData((prev) => ({ ...prev, grade: normalizedNext }))
    }
  }, [selectedGrades, selectedSchool])

  useEffect(() => {
    if (!formData.schoolId) {
      return
    }

    if (!filteredSchoolOptions.some((school) => school.id === formData.schoolId)) {
      setFormData((prev) => ({ ...prev, schoolId: "" }))
    }
  }, [filteredSchoolOptions, formData.schoolId])

  const handleScopeChange = (
    key: "textbookScopes" | "subtextbookScopes",
    index: number,
    field: keyof TextbookScopeItem,
    value: string,
  ) => {
    setFormData((prev) => ({
      ...prev,
      [key]: prev[key].map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }))
  }

  const handleScopeAdd = (key: "textbookScopes" | "subtextbookScopes") => {
    setFormData((prev) => ({
      ...prev,
      [key]: [...prev[key], createEmptyTextbookScopeItem()],
    }))
  }

  const handleScopeRemove = (key: "textbookScopes" | "subtextbookScopes", index: number) => {
    setFormData((prev) => {
      const nextItems = prev[key].filter((_, itemIndex) => itemIndex !== index)
      return {
        ...prev,
        [key]: nextItems.length > 0 ? nextItems : [createEmptyTextbookScopeItem()],
      }
    })
  }

  const handleSave = async () => {
    const nextDate = fromDateInputValue(formData.date)
    const nextEndDate = fromDateInputValue(formData.endDate || formData.date)

    if (!formData.title.trim()) {
      toast.error("일정 제목을 입력해 주세요.")
      return
    }

    if (!nextDate) {
      toast.error("시작일을 확인해 주세요.")
      return
    }

    if (!nextEndDate) {
      toast.error("종료일을 확인해 주세요.")
      return
    }

    if (!selectedSchool && readOnly === false) {
      toast.error("학교를 선택해 주세요.")
      return
    }

    const saved = await onSave({
      id: event?.sourceId || event?.id,
      sourceId: event?.sourceId || event?.id,
      title: formData.title,
      date: nextDate || new Date(),
      endDate: nextEndDate || nextDate || new Date(),
      time: selectedSchool?.name || "학교 미지정",
      duration: formData.endDate && formData.endDate !== formData.date ? `${formData.date} ~ ${formData.endDate}` : "하루 일정",
      type: event?.type || "meeting",
      typeLabel: formData.typeLabel,
      attendees: selectedGrades.includes("all") ? [] : selectedGrades,
      location: selectedSchool?.name || "",
      color: event?.color || "bg-blue-500",
      description: formData.note,
      schoolId: formData.schoolId,
      schoolName: selectedSchool?.name || "",
      category: selectedSchool?.category || "all",
      grade: serializeGradeSelection(selectedGrades),
      examTerm: showExamTermField ? formData.examTerm : "",
      textbookScopes: showScopeFields ? formData.textbookScopes : [],
      subtextbookScopes: showScopeFields ? formData.subtextbookScopes : [],
      note: formData.note,
    })
    if (saved !== false) {
      onOpenChange(false)
    }
  }

  const handleDelete = async () => {
    if (!event?.sourceId && !event?.id) {
      return
    }

    const deleted = await onDelete?.(event.sourceId || event.id)
    if (deleted !== false) {
      onOpenChange(false)
    }
  }

  const isDisabled = readOnly
  const showExamTermField = isExamTypeWithTerm(formData.typeLabel)
  const showScopeFields = isSubjectExamType(formData.typeLabel)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{readOnly ? "학사 일정 상세" : event ? "학사 일정 수정" : "새 학사 일정 추가"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className={cn("grid gap-4 md:grid-cols-2", showExamTermField && "xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]")}>
            <div className="space-y-2">
              <Label htmlFor="title">일정 제목</Label>
              <Input
                id="title"
                placeholder="일정 제목 입력"
                value={formData.title}
                disabled={isDisabled}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, title: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>일정 유형</Label>
              <Select
                value={formData.typeLabel}
                disabled={isDisabled}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, typeLabel: value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="유형 선택" />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((typeOption) => (
                    <SelectItem key={typeOption} value={typeOption}>
                      {getAcademicEventTypeLabel(typeOption)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {showExamTermField ? (
              <div className="space-y-2">
                <Label>시기</Label>
                <Select
                  value={formData.examTerm}
                  disabled={isDisabled}
                  onValueChange={(value) =>
                    setFormData((prev) => ({ ...prev, examTerm: value }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="시기 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {examTermOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>학년</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={isDisabled}>
                  <Button variant="outline" className="w-full justify-between" disabled={isDisabled}>
                    <span className="truncate">
                      {selectedGradeBadges.length > 0 ? selectedGradeBadges.join(" · ") : "학년 선택"}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {(selectedSchool ? gradeOptions : allGradeOptions).map((option) => {
                    const checked =
                      option.value === "all"
                        ? selectedGrades.includes("all")
                        : selectedGrades.includes(option.value)

                    return (
                      <DropdownMenuCheckboxItem
                        key={option.value}
                        checked={checked}
                        onCheckedChange={() => {
                          const nextGrades = toggleGradeSelection(selectedGrades, option.value)
                          setFormData((prev) => ({
                            ...prev,
                            grade: serializeGradeSelection(nextGrades),
                          }))
                        }}
                      >
                        {option.label}
                      </DropdownMenuCheckboxItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="space-y-2">
              <Label>학교</Label>
              <Select
                value={formData.schoolId}
                disabled={isDisabled}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, schoolId: value }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="학교 선택" />
                </SelectTrigger>
                <SelectContent>
                  {filteredSchoolOptions.map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="date">시작일</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                disabled={isDisabled}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, date: event.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="end-date">종료일</Label>
              <Input
                id="end-date"
                type="date"
                value={formData.endDate}
                disabled={isDisabled}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, endDate: event.target.value }))
                }
              />
            </div>
          </div>

          {showScopeFields ? (
            <div className="space-y-4">
              <ScopeFields
                label="교재 시험범위"
                items={formData.textbookScopes}
                disabled={isDisabled}
                onAdd={() => handleScopeAdd("textbookScopes")}
                onRemove={(index) => handleScopeRemove("textbookScopes", index)}
                onChange={(index, field, value) =>
                  handleScopeChange("textbookScopes", index, field, value)
                }
              />

              <ScopeFields
                label="부교재 시험범위"
                items={formData.subtextbookScopes}
                disabled={isDisabled}
                onAdd={() => handleScopeAdd("subtextbookScopes")}
                onRemove={(index) => handleScopeRemove("subtextbookScopes", index)}
                onChange={(index, field, value) =>
                  handleScopeChange("subtextbookScopes", index, field, value)
                }
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="note">메모</Label>
            <Textarea
              id="note"
              placeholder="메모 (선택)"
              value={formData.note}
              disabled={isDisabled}
              rows={4}
              onChange={(event) =>
                setFormData((prev) => ({ ...prev, note: event.target.value }))
              }
            />
          </div>

          <div className="flex gap-3 pt-2">
            {!readOnly ? (
              <Button onClick={handleSave} className="flex-1 cursor-pointer">
                {event ? "변경 저장" : "일정 추가"}
              </Button>
            ) : null}
            {!readOnly && event && onDelete ? (
              <Button onClick={handleDelete} variant="destructive" className="cursor-pointer">
                삭제
              </Button>
            ) : null}
            <Button onClick={() => onOpenChange(false)} variant="outline" className="cursor-pointer">
              닫기
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
