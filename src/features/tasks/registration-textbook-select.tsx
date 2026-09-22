"use client"

import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function RegistrationTextbookSelect({
  id,
  label,
  values,
  options,
  disabled,
  onValuesChange,
}: {
  id: string
  label: string
  values: readonly string[]
  options: readonly { id: string; label: string }[]
  disabled?: boolean
  onValuesChange: (values: string[]) => void
}) {
  const selectedLabel = values.map((value) => (
    options.find((option) => option.id === value)?.label || "교재 정보 확인 필요"
  )).join(", ")

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="w-full min-w-0 justify-between px-3 font-normal"
          aria-label={label}
          title={selectedLabel || "선택 안 함 · 이미 보유"}
          disabled={disabled}
        >
          <span className="min-w-0 truncate">{selectedLabel || "선택 안 함 · 이미 보유"}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" disablePortal className="w-[max(var(--radix-popover-trigger-width),16rem)] max-w-[calc(100vw-2rem)] p-2">
        <div role="group" aria-label={`${label} 목록`} className="grid max-h-64 gap-1 overflow-y-auto">
          {options.map((option) => (
            <Label key={option.id} className="flex items-start gap-2 rounded-md px-2 py-2 font-normal">
              <Checkbox
                checked={values.includes(option.id)}
                disabled={disabled}
                aria-label={option.label}
                onCheckedChange={(checked) => onValuesChange(checked
                  ? [...values.filter((value) => value !== option.id), option.id]
                  : values.filter((value) => value !== option.id))}
              />
              <span className="min-w-0 break-words">{option.label}</span>
            </Label>
          ))}
          {options.length === 0 ? <p className="px-2 py-2 text-sm text-muted-foreground">연결된 교재가 없습니다.</p> : null}
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={disabled || values.length === 0} onClick={() => onValuesChange([])}>
          선택 해제
        </Button>
      </PopoverContent>
    </Popover>
  )
}
