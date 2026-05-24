"use client"

import * as React from "react"
import { flushSync } from "react-dom"
import { usePathname, useRouter } from "next/navigation"
import { Command as CommandPrimitive } from "cmdk"
import { ArrowRight, Search, type LucideIcon } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { buildAdminNavGroups } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/providers/auth-provider"

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-xl bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50",
      className,
    )}
    {...props}
  />
))
Command.displayName = CommandPrimitive.displayName

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Input
    ref={ref}
    className={cn(
      "mb-3 flex h-12 w-full border-none border-b border-zinc-200 bg-transparent px-4 py-3 text-[17px] outline-none placeholder:text-zinc-500 dark:border-zinc-800 dark:placeholder:text-zinc-400",
      className,
    )}
    {...props}
  />
))
CommandInput.displayName = CommandPrimitive.Input.displayName

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[70vh] overflow-y-auto overflow-x-hidden pb-2 sm:max-h-[440px]", className)}
    {...props}
  />
))
CommandList.displayName = CommandPrimitive.List.displayName

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="flex min-h-20 items-center justify-center px-6 text-center text-sm text-zinc-500 dark:text-zinc-400"
    {...props}
  />
))
CommandEmpty.displayName = CommandPrimitive.Empty.displayName

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden px-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-zinc-500 dark:[&_[cmdk-group-heading]]:text-zinc-400 [&:not(:first-child)]:mt-2",
      className,
    )}
    {...props}
  />
))
CommandGroup.displayName = CommandPrimitive.Group.displayName

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "group relative flex min-h-12 cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-700 outline-none transition-[background-color,color,transform] data-[disabled=true]:pointer-events-none data-[selected=true]:translate-x-0.5 data-[selected=true]:bg-zinc-100 data-[selected=true]:text-zinc-900 data-[disabled=true]:opacity-50 dark:text-zinc-300 dark:data-[selected=true]:bg-zinc-800 dark:data-[selected=true]:text-zinc-100 [&+[cmdk-item]]:mt-1",
      className,
    )}
    {...props}
  />
))
CommandItem.displayName = CommandPrimitive.Item.displayName

interface SearchItem {
  title: string
  url: string
  group: string
  icon?: LucideIcon
}

export const QUICK_SEARCH_SHORTCUT_LABEL = "Ctrl + K"
const EMPTY_GROUPED_SEARCH_ITEMS = {} as Record<string, SearchItem[]>
const EMPTY_GROUPED_SEARCH_ENTRIES: Array<[string, SearchItem[]]> = []

function resolveCommandGroupLabel(label: string) {
  if (label === "운영") {
    return "운영"
  }

  return label
}

function normalizeCommandPath(pathname: string) {
  if (!pathname || pathname === "/") {
    return "/"
  }

  return pathname.replace(/\/+$/, "")
}

function commandTargetId(url: string) {
  return normalizeCommandPath(url)
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "root"
}

function createSearchItems({
  canManageAll,
  canEditCurriculumPlanning,
}: {
  canManageAll: boolean
  canEditCurriculumPlanning: boolean
}): SearchItem[] {
  const navGroups = buildAdminNavGroups({ canManageAll, canEditCurriculumPlanning })
  const seen = new Set<string>()
  const navigationItems: SearchItem[] = []

  for (const group of navGroups) {
    const groupLabel = resolveCommandGroupLabel(group.label)

    for (const item of group.items) {
      const sameUrlChild = item.items?.find((subItem) => subItem.url === item.url)

      if (!sameUrlChild && !seen.has(item.url)) {
        seen.add(item.url)
        navigationItems.push({
          title: item.title,
          url: item.url,
          group: groupLabel,
          icon: item.icon,
        })
      }

      for (const subItem of item.items || []) {
        if (seen.has(subItem.url)) {
          continue
        }

        seen.add(subItem.url)
        navigationItems.push({
          title: subItem.title,
          url: subItem.url,
          group: groupLabel,
          icon: item.icon,
        })
      }
    }
  }

  return navigationItems
}

function groupSearchItems(items: SearchItem[]) {
  return items.reduce(
    (accumulator, item) => {
      if (!accumulator[item.group]) {
        accumulator[item.group] = []
      }
      accumulator[item.group].push(item)
      return accumulator
    },
    {} as Record<string, SearchItem[]>,
  )
}

interface CommandSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandSearch({ open, onOpenChange }: CommandSearchProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { canManageAll, canEditCurriculumPlanning } = useAuth()
  const currentPath = React.useMemo(() => normalizeCommandPath(pathname), [pathname])
  const prefetchedCommandRoutesRef = React.useRef(new Set<string>())

  const prefetchCommandRoute = React.useCallback((url: string) => {
    const targetPath = normalizeCommandPath(url)
    if (targetPath === currentPath || prefetchedCommandRoutesRef.current.has(targetPath)) return

    prefetchedCommandRoutesRef.current.add(targetPath)
    router.prefetch(targetPath)
  }, [currentPath, router])

  const groupedItems = React.useMemo(() => {
    if (!open) return EMPTY_GROUPED_SEARCH_ITEMS
    return groupSearchItems(createSearchItems({ canManageAll, canEditCurriculumPlanning }))
  }, [canEditCurriculumPlanning, canManageAll, open])

  const groupedEntries = React.useMemo(
    () => (open ? Object.entries(groupedItems) : EMPTY_GROUPED_SEARCH_ENTRIES),
    [groupedItems, open],
  )

  const handleSelect = React.useCallback((url: string) => {
    const targetPath = normalizeCommandPath(url)

    flushSync(() => {
      onOpenChange(false)
    })

    if (targetPath !== currentPath) {
      React.startTransition(() => {
        router.push(targetPath)
      })
    }
  }, [currentPath, onOpenChange, router])

  if (!open) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label="빠른 이동"
        data-testid="admin-quick-search-dialog"
        className="w-[calc(100vw-2rem)] max-w-[640px] overflow-hidden border border-zinc-200 p-0 shadow-2xl dark:border-zinc-800"
      >
        <DialogTitle className="sr-only">빠른 이동</DialogTitle>
        <DialogDescription className="sr-only">
          메뉴와 관리 화면을 검색해서 바로 이동합니다.
        </DialogDescription>
        <Command data-testid="admin-quick-search-command">
          <CommandInput
            aria-label="빠른 이동 검색"
            data-testid="admin-quick-search-input"
            placeholder="이동할 메뉴 검색"
            autoFocus
          />
          <CommandList data-testid="admin-quick-search-list">
            <CommandEmpty>일치하는 메뉴가 없습니다.</CommandEmpty>
            {groupedEntries.map(([group, items]) => (
              <CommandGroup key={group} heading={`${group} ${items.length}개`}>
                {items.map((item) => {
                  const Icon = item.icon
                  const isCurrent = normalizeCommandPath(item.url) === currentPath
                  const itemTargetId = commandTargetId(item.url)

                  return (
                    <CommandItem
                      key={item.url}
                      value={`${item.title} ${item.group} ${item.url}`}
                      keywords={[item.group, item.url]}
                      aria-current={isCurrent ? "page" : undefined}
                      aria-label={`빠른 이동: ${item.title}`}
                      data-testid={`admin-quick-search-item-${itemTargetId}`}
                      onPointerEnter={() => prefetchCommandRoute(item.url)}
                      onFocus={() => prefetchCommandRoute(item.url)}
                      onClick={() => handleSelect(item.url)}
                      onSelect={() => handleSelect(item.url)}
                      className={isCurrent ? "bg-primary/5 text-primary data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary" : undefined}
                    >
                      {Icon ? (
                        <Icon className={cn("size-4 shrink-0 text-zinc-500 dark:text-zinc-400", isCurrent && "text-primary")} />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                      {isCurrent ? (
                        <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                          현재
                        </span>
                      ) : (
                        <ArrowRight className="size-4 shrink-0 text-zinc-400 opacity-0 transition-opacity group-data-[selected=true]:opacity-100" />
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

export function SearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`빠른 이동 열기, ${QUICK_SEARCH_SHORTCUT_LABEL}`}
      title={`빠른 이동 (${QUICK_SEARCH_SHORTCUT_LABEL})`}
      data-testid="admin-quick-search-trigger"
      data-shortcut-label={QUICK_SEARCH_SHORTCUT_LABEL}
      onClick={onClick}
      className="relative inline-flex h-8 w-full items-center justify-start gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3 py-1 text-sm font-medium text-muted-foreground shadow-sm transition-[background-color,color,box-shadow,transform] hover:bg-accent hover:text-accent-foreground active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:pr-12 md:w-36 lg:w-56"
    >
      <Search className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden lg:inline-flex">빠른 이동</span>
      <span className="inline-flex lg:hidden">빠른 이동</span>
      <kbd className="pointer-events-none absolute right-1.5 top-1.5 hidden h-4 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
        {QUICK_SEARCH_SHORTCUT_LABEL}
      </kbd>
    </button>
  )
}
