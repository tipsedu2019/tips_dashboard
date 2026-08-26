"use client"

import * as React from "react"
import { ChevronsUpDownIcon } from "lucide-react"

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
          aria-label={triggerAriaLabel}
          aria-expanded={open}
          variant="outline"
          className={cn("h-10 w-full justify-between px-3", triggerClassName)}
          disabled={disabled}
        >
          <span className={cn("truncate", triggerPlaceholder && "text-muted-foreground")}>
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
        className={cn("w-[--radix-popover-trigger-width] p-0", contentClassName)}
      >
        <Command
          shouldFilter={false}
          value={selectedValue === undefined ? undefined : commandValue}
          onValueChange={selectedValue === undefined ? undefined : setCommandValue}
        >
          <div className="relative">
            <CommandInput
              data-testid={searchTestId}
              value={searchValue}
              onValueChange={onSearchValueChange}
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
            <div className="p-2 pb-0" onKeyDown={stopCommandKeyDown}>
              {filters}
            </div>
          ) : null}
          <CommandList
            aria-label={listAriaLabel || `${triggerLabel} 목록`}
            className={cn("max-h-72 overscroll-contain", listClassName)}
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
              <div className="p-1" onKeyDown={stopCommandKeyDown}>{footer}</div>
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

export { SearchCombobox, SearchComboboxItem }
