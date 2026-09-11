"use client"

import type { ReactNode } from "react"

import {
  SearchCombobox,
  SearchComboboxItem,
} from "@/components/ui/search-combobox"
import { cn } from "@/lib/utils"

export type ManagementRelationComboboxItem = {
  id: string
  title: string
  meta?: ReactNode
}

type ManagementRelationComboboxProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled: boolean
  relationLabel: string
  selectedLabel: string
  query: string
  onQueryChange: (query: string) => void
  selectedId: string
  items: ManagementRelationComboboxItem[]
  onSelect: (id: string) => void
  filters?: ReactNode
  triggerId?: string
  searchTestId?: string
  wrapLabels?: boolean
}

export function ManagementRelationCombobox({
  open,
  onOpenChange,
  disabled,
  relationLabel,
  selectedLabel,
  query,
  onQueryChange,
  selectedId,
  items,
  onSelect,
  filters,
  triggerId,
  searchTestId,
  wrapLabels = false,
}: ManagementRelationComboboxProps) {
  const triggerLabel = selectedLabel || `${relationLabel} 검색 또는 선택`

  return (
    <SearchCombobox
      open={open}
      onOpenChange={onOpenChange}
      disabled={disabled}
      triggerLabel={triggerLabel}
      triggerId={triggerId}
      triggerPlaceholder={!selectedLabel}
      triggerAriaLabel={selectedLabel ? `${relationLabel} 선택: ${selectedLabel}` : triggerLabel}
      searchValue={query}
      onSearchValueChange={onQueryChange}
      searchPlaceholder={`${relationLabel} 이름 검색`}
      searchAriaLabel={`${relationLabel} 이름 검색`}
      searchTestId={searchTestId}
      selectedValue={selectedId || undefined}
      listAriaLabel={`선택 가능한 ${relationLabel}`}
      emptyMessage={`조건에 맞는 ${relationLabel} 없음`}
      filters={filters}
      triggerClassName={wrapLabels ? "h-auto min-h-10 items-start py-2 text-left [&>span]:whitespace-normal [&>span]:overflow-visible [&>span]:text-clip [&>span]:break-words" : undefined}
      contentClassName={wrapLabels ? "w-[min(44rem,calc(100vw-2rem))]" : undefined}
    >
      {items.map((item) => (
        <SearchComboboxItem
          key={item.id}
          value={item.id}
          data-current={selectedId === item.id}
          className={cn(
            "w-full",
            selectedId === item.id && "bg-primary/10 text-primary",
          )}
          disabled={disabled}
          onSelect={() => onSelect(item.id)}
        >
          <div className="grid min-w-0 flex-1 gap-1.5 text-left">
            <span className={cn("font-medium", wrapLabels ? "whitespace-normal break-words leading-6" : "truncate")}>{item.title}</span>
            {item.meta}
          </div>
        </SearchComboboxItem>
      ))}
    </SearchCombobox>
  )
}
