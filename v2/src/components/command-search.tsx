"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Command as CommandPrimitive } from "cmdk"
import { BookOpenCheck, Search, type LucideIcon } from "lucide-react"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
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
      "mb-4 flex h-12 w-full border-none border-b border-zinc-200 bg-transparent px-4 py-3 text-[17px] outline-none placeholder:text-zinc-500 dark:border-zinc-800 dark:placeholder:text-zinc-400",
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
    className={cn("max-h-[400px] overflow-y-auto overflow-x-hidden pb-2", className)}
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
    className="flex h-12 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400"
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
      "overflow-hidden px-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-zinc-500 dark:[&_[cmdk-group-heading]]:text-zinc-400 [&:not(:first-child)]:mt-2",
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
      "relative flex h-12 cursor-pointer select-none items-center gap-2 rounded-lg px-4 text-sm text-zinc-700 outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-zinc-100 data-[selected=true]:text-zinc-900 data-[disabled=true]:opacity-50 dark:text-zinc-300 dark:data-[selected=true]:bg-zinc-800 dark:data-[selected=true]:text-zinc-100 [&+[cmdk-item]]:mt-1",
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

export const QUICK_SEARCH_SHORTCUT_LABEL = "Ctrl/⌘K"

const AUXILIARY_COMMAND_ITEMS: SearchItem[] = [
  {
    title: "사용설명서",
    url: "/admin/manual",
    group: "사용설명",
    icon: BookOpenCheck,
  },
]

function resolveCommandGroupLabel(label: string) {
  if (label === "운영") {
    return "운영 워크스페이스"
  }

  return label
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

  const navigationItems = navGroups.flatMap((group) => {
    const groupLabel = resolveCommandGroupLabel(group.label)

    return group.items.flatMap((item) => {
      const items: SearchItem[] = []

      if (!seen.has(item.url)) {
        seen.add(item.url)
        items.push({
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
        items.push({
          title: subItem.title,
          url: subItem.url,
          group: groupLabel,
          icon: item.icon,
        })
      }

      return items
    })
  })

  for (const item of AUXILIARY_COMMAND_ITEMS) {
    if (seen.has(item.url)) {
      continue
    }

    seen.add(item.url)
    navigationItems.push(item)
  }

  return navigationItems
}

interface CommandSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandSearch({ open, onOpenChange }: CommandSearchProps) {
  const router = useRouter()
  const commandRef = React.useRef<HTMLDivElement>(null)
  const { canManageAll, canEditCurriculumPlanning } = useAuth()

  const groupedItems = React.useMemo(() => {
    return createSearchItems({ canManageAll, canEditCurriculumPlanning }).reduce(
      (accumulator, item) => {
        if (!accumulator[item.group]) {
          accumulator[item.group] = []
        }
        accumulator[item.group].push(item)
        return accumulator
      },
      {} as Record<string, SearchItem[]>,
    )
  }, [canEditCurriculumPlanning, canManageAll])

  const handleSelect = (url: string) => {
    router.push(url)
    onOpenChange(false)

    if (commandRef.current) {
      commandRef.current.style.transform = "scale(0.96)"
      setTimeout(() => {
        if (commandRef.current) {
          commandRef.current.style.transform = ""
        }
      }, 100)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] overflow-hidden border border-zinc-200 p-0 shadow-2xl dark:border-zinc-800">
        <DialogTitle className="sr-only">운영 워크스페이스 빠른 이동</DialogTitle>
        <Command
          ref={commandRef}
          className="transition-transform duration-100 ease-out"
        >
          <CommandInput placeholder="무엇을 찾고 계신가요?" autoFocus />
          <CommandList>
            <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
            {Object.entries(groupedItems).map(([group, items]) => (
              <CommandGroup key={group} heading={group}>
                {items.map((item) => {
                  const Icon = item.icon
                  return (
                    <CommandItem
                      key={item.url}
                      value={item.title}
                      onSelect={() => handleSelect(item.url)}
                    >
                      {Icon ? <Icon className="mr-2 h-4 w-4" /> : null}
                      {item.title}
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
      onClick={onClick}
      className="relative inline-flex h-8 w-full items-center justify-start gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3 py-1 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:pr-12 md:w-36 lg:w-56"
    >
      <Search className="mr-2 h-3.5 w-3.5" />
      <span className="hidden lg:inline-flex">빠른 이동</span>
      <span className="inline-flex lg:hidden">빠른 이동</span>
      <kbd className="pointer-events-none absolute right-1.5 top-1.5 hidden h-4 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
        {QUICK_SEARCH_SHORTCUT_LABEL}
      </kbd>
    </button>
  )
}
