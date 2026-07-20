import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import {
  getRegistrationSchoolLevelFromGrade,
  type RegistrationSchoolChoice,
} from "./registration-school-options"
import type { RegistrationSchoolCatalogStatus } from "./ops-task-service"
import {
  getRegistrationGradeOptions,
  isValidRegistrationMobilePhone,
} from "./registration-workflow"

export type RegistrationInquiryFieldValues = {
  studentName: string
  schoolGrade: string
  schoolName: string
  parentPhone: string
  studentPhone: string
  requestNote: string
}

export type RegistrationInquiryFieldName = keyof RegistrationInquiryFieldValues

export type RegistrationInquiryCommonFieldsProps = {
  values: RegistrationInquiryFieldValues
  inquiryAtLabel: string
  schoolChoices: readonly RegistrationSchoolChoice[]
  schoolCatalogStatus: "loading" | RegistrationSchoolCatalogStatus
  schoolCatalogError?: string
  disabled?: boolean
  disabledFields?: Partial<Record<RegistrationInquiryFieldName, boolean>>
  onChange: (field: RegistrationInquiryFieldName, value: string) => void
  onRetrySchools?: () => void
}

function FieldLabel({
  children,
  requirement,
}: {
  children: string
  requirement: "필수" | "선택" | "자동"
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{children}</span>
      <span
        aria-hidden="true"
        className={requirement === "필수" ? "text-xs font-semibold text-primary" : "text-xs text-muted-foreground"}
      >
        {requirement}
      </span>
    </span>
  )
}

export function RegistrationInquiryCommonFields({
  values,
  inquiryAtLabel,
  schoolChoices,
  schoolCatalogStatus,
  schoolCatalogError,
  disabled = false,
  disabledFields = {},
  onChange,
  onRetrySchools,
}: RegistrationInquiryCommonFieldsProps) {
  const gradeOptions = getRegistrationGradeOptions()
  const currentGradeIsLegacy = Boolean(values.schoolGrade && !gradeOptions.includes(values.schoolGrade))
  const gradeRecognized = Boolean(getRegistrationSchoolLevelFromGrade(values.schoolGrade))
  const schoolUnavailable = schoolCatalogStatus !== "authoritative"
  const visibleSchoolChoices = schoolUnavailable
    ? values.schoolName
      ? [{ value: values.schoolName, label: `기존 입력 · ${values.schoolName}`, legacy: true }]
      : []
    : schoolChoices

  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <Label className="grid min-w-0 gap-1.5" data-registration-focus="studentName">
        <FieldLabel requirement="필수">학생명</FieldLabel>
        <Input
          data-common-field="student-name"
          value={values.studentName}
          required
          disabled={disabled || disabledFields.studentName}
          onChange={(event) => onChange("studentName", event.target.value)}
        />
      </Label>

      <div className="grid min-w-0 content-start gap-1.5">
        <FieldLabel requirement="자동">문의일시</FieldLabel>
        <output aria-label="문의일시 자동" className="min-h-10 py-2 text-sm">
          {inquiryAtLabel}
        </output>
      </div>

      <Label className="grid min-w-0 gap-1.5" data-registration-focus="schoolGrade">
        <FieldLabel requirement="필수">학년</FieldLabel>
        <select
          data-common-field="school-grade"
          value={values.schoolGrade}
          required
          disabled={disabled || disabledFields.schoolGrade}
          onChange={(event) => onChange("schoolGrade", event.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">미정</option>
          {currentGradeIsLegacy ? (
            <option value={values.schoolGrade}>{values.schoolGrade} · 기존 입력</option>
          ) : null}
          {gradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
        </select>
      </Label>

      <div className="grid min-w-0 gap-1.5">
        <Label className="grid min-w-0 gap-1.5">
          <FieldLabel requirement="선택">학교</FieldLabel>
          <select
            value={values.schoolName}
            disabled={disabled || disabledFields.schoolName || !gradeRecognized || schoolUnavailable}
            onChange={(event) => onChange("schoolName", event.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">선택 안 함</option>
            {visibleSchoolChoices.map((school) => (
              <option key={`${school.legacy ? "legacy" : "catalog"}:${school.value}`} value={school.value}>
                {school.label}
              </option>
            ))}
          </select>
        </Label>
        {schoolCatalogStatus === "error" ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-xs text-destructive">
            <span>{schoolCatalogError || "학교 선택 정보를 불러오지 못했습니다."}</span>
            {onRetrySchools ? (
              <Button type="button" variant="outline" size="sm" onClick={onRetrySchools} disabled={disabled}>
                다시 불러오기
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Label className="grid min-w-0 gap-1.5" data-registration-focus="parentPhone">
        <FieldLabel requirement="필수">학부모 전화</FieldLabel>
        <Input
          data-common-field="parent-phone"
          inputMode="tel"
          value={values.parentPhone}
          required
          aria-invalid={Boolean(values.parentPhone && !isValidRegistrationMobilePhone(values.parentPhone))}
          disabled={disabled || disabledFields.parentPhone}
          onChange={(event) => onChange("parentPhone", event.target.value)}
        />
      </Label>

      <Label className="grid min-w-0 gap-1.5">
        <FieldLabel requirement="선택">학생 전화</FieldLabel>
        <Input
          inputMode="tel"
          value={values.studentPhone}
          disabled={disabled || disabledFields.studentPhone}
          onChange={(event) => onChange("studentPhone", event.target.value)}
        />
      </Label>

      <Label className="grid min-w-0 gap-1.5 sm:col-span-2">
        <FieldLabel requirement="선택">요청 사항</FieldLabel>
        <Textarea
          value={values.requestNote}
          rows={3}
          disabled={disabled || disabledFields.requestNote}
          onChange={(event) => onChange("requestNote", event.target.value)}
        />
      </Label>
    </div>
  )
}
