"use client"

import * as React from "react"
import { ChevronRight, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

export function NavMain({
  label,
  items,
}: {
  label: string
  items: {
    title: string
    url: string
    icon?: LucideIcon
    isActive?: boolean
    items?: {
      title: string
      url: string
      isActive?: boolean
    }[]
  }[]
}) {
  const pathname = usePathname()

  const shouldBeOpen = React.useCallback((item: (typeof items)[number]) => {
    if (item.isActive || pathname === item.url) return true
    return item.items?.some((subItem) => pathname === subItem.url) || false
  }, [pathname])

  const [openItems, setOpenItems] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((item) => [item.title, shouldBeOpen(item)])),
  )

  React.useEffect(() => {
    setOpenItems((current) => {
      const nextState = { ...current }
      let changed = false

      for (const item of items) {
        const nextOpen = shouldBeOpen(item)
        if (nextOpen && current[item.title] !== true) {
          nextState[item.title] = true
          changed = true
        } else if (!(item.title in current)) {
          nextState[item.title] = nextOpen
          changed = true
        }
      }

      return changed ? nextState : current
    })
  }, [items, shouldBeOpen])

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const hasSubItems = Boolean(item.items?.length)
          const isParentActive = shouldBeOpen(item)

          return (
            <Collapsible
              key={item.title}
              asChild
              open={openItems[item.title] ?? false}
              onOpenChange={(open) => setOpenItems((current) => ({ ...current, [item.title]: open }))}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                {hasSubItems ? (
                  <>
                    <SidebarMenuButton asChild tooltip={item.title} className="cursor-pointer" isActive={isParentActive}>
                      <Link href={item.url}>
                        {item.icon && <item.icon />}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuAction
                        className="cursor-pointer"
                        aria-label={`${item.title} 하위 메뉴 펼치기`}
                        showOnHover
                      >
                        <ChevronRight className="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuAction>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items?.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.title}>
                            <SidebarMenuSubButton asChild className="cursor-pointer" isActive={pathname === subItem.url}>
                              <Link href={subItem.url}>
                                <span>{subItem.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </>
                ) : (
                  <SidebarMenuButton asChild tooltip={item.title} className="cursor-pointer" isActive={pathname === item.url}>
                    <Link href={item.url}>
                      {item.icon && <item.icon />}
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                )}
              </SidebarMenuItem>
            </Collapsible>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
