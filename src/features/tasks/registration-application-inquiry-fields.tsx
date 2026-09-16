import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { getRegistrationGradeOptions } from "./registration-workflow"
import { RegistrationSelect } from "./registration-select"

export type RegistrationInquiryFieldValues = {
  studentName: string
  schoolGrade: string
  schoolName: string
  parentPhone: string
  studentPhone: string
  inquiryAt: string
  requestNote: string
}

export type RegistrationInquiryFieldName = keyof RegistrationInquiryFieldValues

export function toRegistrationInquiryDateTimeLocal(value: string | null | undefined) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const local = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/)
  if (local && !/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return local[1]
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return local?.[1] || ""
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((item) => item.type === type)?.value || ""
  )
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`
}

export type RegistrationInquiryCommonFieldsProps = {
  values: RegistrationInquiryFieldValues
  disabled?: boolean
  disabledFields?: Partial<Record<RegistrationInquiryFieldName, boolean>>
  onChange: (field: RegistrationInquiryFieldName, value: string) => void
}

export function RegistrationInquiryCommonFields({
  values,
  disabled = false,
  disabledFields = {},
  onChange,
}: RegistrationInquiryCommonFieldsProps) {
  const gradeOptions = getRegistrationGradeOptions()
  const currentGradeIsLegacy = Boolean(values.schoolGrade && !gradeOptions.includes(values.schoolGrade))

  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Label className="grid min-w-0 gap-1.5" data-registration-focus="studentName">
        <span>학생명</span>
        <Input
          data-common-field="student-name"
          value={values.studentName}
          disabled={disabled || disabledFields.studentName}
          onChange={(event) => onChange("studentName", event.target.value)}
        />
      </Label>

      <Label className="grid min-w-0 gap-1.5" data-registration-focus="schoolGrade">
        <span>학년</span>
        <RegistrationSelect
          data-common-field="school-grade"
          value={values.schoolGrade}
          placeholder="미정"
          options={[
            { value: "", label: "미정" },
            ...(currentGradeIsLegacy
              ? [{ value: values.schoolGrade, label: `${values.schoolGrade} · 기존 입력` }]
              : []),
            ...gradeOptions.map((grade) => ({ value: grade, label: grade })),
          ]}
          disabled={disabled || disabledFields.schoolGrade}
          onValueChange={(value) => onChange("schoolGrade", value)}
          className="h-10"
        />
      </Label>

      <Label className="grid min-w-0 gap-1.5">
        <span>학교</span>
        <Input
          data-common-field="school-name"
          value={values.schoolName}
          disabled={disabled || disabledFields.schoolName}
          onChange={(event) => onChange("schoolName", event.target.value)}
        />
      </Label>

      <Label className="grid min-w-0 gap-1.5" data-registration-focus="parentPhone">
        <span>학부모 전화</span>
        <Input
          data-common-field="parent-phone"
          inputMode="tel"
          value={values.parentPhone}
          disabled={disabled || disabledFields.parentPhone}
          onChange={(event) => onChange("parentPhone", event.target.value)}
        />
      </Label>

      <Label className="grid min-w-0 gap-1.5">
        <span>학생 전화</span>
        <Input
          data-common-field="student-phone"
          inputMode="tel"
          value={values.studentPhone}
          disabled={disabled || disabledFields.studentPhone}
          onChange={(event) => onChange("studentPhone", event.target.value)}
        />
      </Label>

      <Label className="grid min-w-0 gap-1.5">
        <span>문의일시</span>
        <Input
          data-common-field="inquiry-at"
          type="datetime-local"
          value={toRegistrationInquiryDateTimeLocal(values.inquiryAt)}
          disabled={disabled || disabledFields.inquiryAt}
          onChange={(event) => onChange("inquiryAt", event.target.value)}
        />
      </Label>

      <Label className="grid min-w-0 gap-1.5 sm:col-span-2 xl:col-span-3">
        <span>요청 사항</span>
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
