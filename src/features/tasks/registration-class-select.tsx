"use client"

import { useState } from "react"
import { Label } from "@/components/ui/label"
import { RegistrationSelect } from "./registration-select"
import { registrationClassGradeOptions, registrationClassOptions, UNASSIGNED_CLASS_GRADE, type RegistrationClassChoice } from "./registration-class-options"

export function RegistrationClassSelect({ classes, value, onValueChange, label, disabled }: {
  classes: readonly RegistrationClassChoice[]
  value: string
  onValueChange: (value: string) => void
  label: string
  disabled?: boolean
}) {
  const [grade, setGrade] = useState("")
  const gradeOptions = registrationClassGradeOptions(classes)
  const activeGrade = gradeOptions.includes(grade) ? grade : ""
  const options = registrationClassOptions(classes, activeGrade)
  const selected = classes.find((item) => item.id === value)
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label className="grid gap-1.5">
        <span>학년</span>
        <RegistrationSelect
          aria-label={`${label} 학년`}
          value={activeGrade}
          placeholder="전체 학년"
          options={[{ value: "", label: "전체 학년" }, ...gradeOptions.map((value) => ({ value, label: value === UNASSIGNED_CLASS_GRADE ? "학년 미지정" : value }))]}
          onValueChange={setGrade}
          disabled={disabled}
        />
      </Label>
      <Label className="grid gap-1.5">
        <span>반</span>
        <RegistrationSelect
          aria-label={label}
          value={value}
          selectedLabel={selected?.label || (value ? "반 정보 확인 필요" : "반 선택")}
          placeholder="반 선택"
          options={[{ value: "", label: "반 선택" }, ...options.map((item) => ({ value: item.id, label: item.label }))]}
          onValueChange={onValueChange}
          disabled={disabled}
        />
      </Label>
      {options.length === 0 ? <p role="status" className="text-xs text-muted-foreground">선택 가능한 반이 없습니다.</p> : null}
    </div>
  )
}
