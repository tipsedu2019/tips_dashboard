"use client"

import type { ComponentProps, ReactNode } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const EMPTY_VALUE_SENTINEL = "__registration_empty_value__"

export type RegistrationSelectOption = {
  value: string
  label: ReactNode
  disabled?: boolean
}

export type RegistrationSelectProps = {
  value: string
  placeholder: ReactNode
  options: RegistrationSelectOption[]
  disabled?: boolean
  required?: boolean
  onValueChange: (value: string) => void
} & Omit<ComponentProps<typeof SelectTrigger>, "children" | "disabled">

export function RegistrationSelect({
  value,
  placeholder,
  options,
  disabled,
  required,
  onValueChange,
  className,
  ...triggerProps
}: RegistrationSelectProps) {
  const normalizedValue = value === "" ? EMPTY_VALUE_SENTINEL : value
  const hasEmptyOption = options.some((option) => option.value === "")

  return (
    <Select
      value={normalizedValue}
      disabled={disabled}
      required={required}
      onValueChange={(nextValue) => onValueChange(
        nextValue === EMPTY_VALUE_SENTINEL ? "" : nextValue,
      )}
    >
      <SelectTrigger className={cn("w-full min-w-0", className)} {...triggerProps}>
        <SelectValue placeholder={placeholder}>
          {value === "" && !hasEmptyOption ? placeholder : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => {
          const optionValue = option.value === "" ? EMPTY_VALUE_SENTINEL : option.value
          return (
            <SelectItem
              key={optionValue}
              value={optionValue}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
