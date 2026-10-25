"use client"

import * as React from "react"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

type SearchComboboxProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerLabel: string
  triggerId?: string
  triggerPlaceholder?: boolean
  triggerAriaLabel?: string
  searchValue: string
  onSearchValueChange: (value: string) => void
  searchPlaceholder: string
  searchAriaLabel: string
  searchTestId?: string
  searchAction?: React.ReactNode
  onSearchCompositionStart?: React.CompositionEventHandler<HTMLInputElement>
  onSearchCompositionEnd?: React.CompositionEventHandler<HTMLInputElement>
  shouldFilter?: boolean
  wrapTrigger?: boolean
  selectedValue?: string
  listAriaLabel?: string
  emptyMessage: React.ReactNode
  loading?: boolean
  loadingMessage?: React.ReactNode
  disabled?: boolean
  filters?: React.ReactNode
  footer?: React.ReactNode
  children?: React.ReactNode
  triggerClassName?: string
  contentClassName?: string
  listClassName?: string
}

function SearchCombobox({
  open,
  onOpenChange,
  triggerLabel,
  triggerId,
  triggerPlaceholder = false,
  triggerAriaLabel,
  searchValue,
  onSearchValueChange,
  searchPlaceholder,
  searchAriaLabel,
  searchTestId,
  searchAction,
  onSearchCompositionStart,
  onSearchCompositionEnd,
  shouldFilter = false,
  wrapTrigger = false,
  selectedValue,
  listAriaLabel,
  emptyMessage,
  loading = false,
  loadingMessage = "불러오는 중",
  disabled = false,
  filters,
  footer,
  children,
  triggerClassName,
  contentClassName,
  listClassName,
}: SearchComboboxProps) {
  const [commandValue, setCommandValue] = React.useState(selectedValue || "")

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && selectedValue !== undefined) {
      setCommandValue(selectedValue)
    }
    onOpenChange(nextOpen)
  }

  function stopCommandKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    event.stopPropagation()
  }

  return (
    <Popover modal open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={triggerId}
          type="button"
          role="combobox"
          aria-label={triggerAriaLabel || `${searchAriaLabel}: ${triggerLabel}`}
          aria-expanded={open}
          variant="outline"
          className={cn("h-10 w-full justify-between px-3", wrapTrigger && "h-auto min-h-[var(--touch-target-height)] whitespace-normal py-2 text-left font-normal sm:min-h-[var(--field-height)]", triggerClassName)}
          disabled={disabled}
        >
          <span className={cn("min-w-0", wrapTrigger ? "break-words [overflow-wrap:anywhere]" : "truncate", triggerPlaceholder && "text-muted-foreground")}>
            {triggerLabel}
          </span>
          <ChevronsUpDownIcon
            data-icon="inline-end"
            className="shrink-0 opacity-50"
            aria-hidden="true"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0", wrapTrigger && "flex min-w-[min(20rem,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden", contentClassName)}
      >
        <Command
          shouldFilter={shouldFilter}
          className={cn(wrapTrigger && "min-h-0")}
          value={selectedValue === undefined ? undefined : commandValue}
          onValueChange={selectedValue === undefined ? undefined : setCommandValue}
        >
          <div className="relative shrink-0">
            <CommandInput
              data-testid={searchTestId}
              value={searchValue}
              onValueChange={onSearchValueChange}
              onCompositionStart={onSearchCompositionStart}
              onCompositionEnd={onSearchCompositionEnd}
              placeholder={searchPlaceholder}
              aria-label={searchAriaLabel}
              className={cn(searchAction && "pr-20")}
              disabled={disabled}
            />
            {searchAction ? (
              <div
                className="absolute inset-y-0 right-2 flex items-center"
                onKeyDown={stopCommandKeyDown}
              >
                {searchAction}
              </div>
            ) : null}
          </div>
          {filters ? (
            <div className="shrink-0 p-2 pb-0" onKeyDown={stopCommandKeyDown}>
              {filters}
            </div>
          ) : null}
          <CommandList
            aria-label={listAriaLabel || `${triggerLabel} 목록`}
            className={cn("max-h-72 overscroll-contain", wrapTrigger && "min-h-0", listClassName)}
          >
            {loading ? (
              <div role="status" aria-live="polite" className="px-2 py-3 text-sm text-muted-foreground">
                {loadingMessage}
              </div>
            ) : (
              <>
                <CommandEmpty>
                  <div onKeyDown={stopCommandKeyDown}>{emptyMessage}</div>
                </CommandEmpty>
                <CommandGroup>{children}</CommandGroup>
              </>
            )}
          </CommandList>
          {footer ? (
            <>
              <Separator />
              <div className="shrink-0 p-1" onKeyDown={stopCommandKeyDown}>{footer}</div>
            </>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function SearchComboboxItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandItem>) {
  return (
    <CommandItem
      className={cn("h-auto items-start py-2", className)}
      {...props}
    />
  )
}

function SearchComboboxOptionContent({ label, description, selected }: {
  label: string
  description?: string
  selected: boolean
}) {
  return <>
    <CheckIcon className={cn("mt-0.5 size-4 shrink-0", selected ? "opacity-100" : "opacity-0")} aria-hidden="true" />
    <span className="min-w-0 flex-1 text-left [overflow-wrap:anywhere]">
      <span className="block whitespace-normal font-medium">{label}</span>
      {description ? <span className="mt-0.5 block whitespace-normal text-xs leading-relaxed text-muted-foreground">{description}</span> : null}
      {selected ? <span className="sr-only">선택됨</span> : null}
    </span>
  </>
}

function SearchComboboxPagination({ label, page, pageSize, totalCount, loading, onPageChange, onClear, clearDisabled = false }: {
  label: string
  page: number
  pageSize: number
  totalCount: number | null
  loading: boolean
  onPageChange: (page: number) => void
  onClear?: () => void
  clearDisabled?: boolean
}) {
  return <div className="flex min-w-0 items-center justify-between gap-1" aria-label={`${label} 서버 페이지`}>
    {onClear ? <Button type="button" size="sm" variant="ghost" disabled={clearDisabled} onClick={onClear}>선택 해제</Button> : <span />}
    <div className="flex min-w-0 items-center gap-1">
      <Button type="button" size="sm" variant="ghost" aria-label={`${label} 이전 페이지`} disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>이전</Button>
      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground" role="status" aria-live="polite">
        {totalCount === null ? "—" : `${page} / ${Math.max(1, Math.ceil(totalCount / pageSize))}`}
      </span>
      <Button type="button" size="sm" variant="ghost" aria-label={`${label} 다음 페이지`} disabled={loading || totalCount === null || page * pageSize >= totalCount} onClick={() => onPageChange(page + 1)}>다음</Button>
    </div>
  </div>
}

export { SearchCombobox, SearchComboboxItem, SearchComboboxOptionContent, SearchComboboxPagination }
