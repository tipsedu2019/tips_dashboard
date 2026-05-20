"use client"

import * as React from "react"
import { ChevronRight, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"

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

function normalizePath(path: string) {
  const normalized = path.split(/[?#]/)[0]?.replace(/\/+$/, "") || "/"
  return normalized === "" ? "/" : normalized
}

function isRouteActive(currentPath: string, targetUrl: string) {
  const target = normalizePath(targetUrl)

  if (target === "/") {
    return currentPath === target
  }

  return currentPath === target || currentPath.startsWith(`${target}/`)
}

function navigationTargetId(url: string) {
  return normalizePath(url)
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "root"
}

function getNavMoveLabel(title: string) {
  return `${title} 이동`
}

function getNavSubmenuLabel(title: string, open: boolean) {
  return `${title} 하위 메뉴 ${open ? "접기" : "펼치기"}`
}

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
  const router = useRouter()
  const pathname = usePathname()
  const currentPath = React.useMemo(() => normalizePath(pathname), [pathname])
  const prefetchedRoutesRef = React.useRef(new Set<string>())

  const prefetchRoute = React.useCallback((url: string) => {
    const target = normalizePath(url)
    if (target === currentPath || prefetchedRoutesRef.current.has(target)) return

    prefetchedRoutesRef.current.add(target)
    router.prefetch(target)
  }, [currentPath, router])

  const routeStateByUrl = React.useMemo(() => {
    const routes = new Map<string, boolean>()

    for (const item of items) {
      routes.set(item.url, isRouteActive(currentPath, item.url))

      for (const subItem of item.items || []) {
        routes.set(subItem.url, isRouteActive(currentPath, subItem.url))
      }
    }

    return routes
  }, [currentPath, items])

  const isUrlActive = React.useCallback((url: string) => routeStateByUrl.get(url) ?? false, [routeStateByUrl])

  const shouldBeOpen = React.useCallback((item: (typeof items)[number]) => {
    if (item.isActive || isUrlActive(item.url)) return true
    return item.items?.some((subItem) => isUrlActive(subItem.url)) || false
  }, [isUrlActive])

  const [openItems, setOpenItems] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((item) => [item.url, shouldBeOpen(item)])),
  )

  const handleItemOpenChange = React.useCallback((url: string, open: boolean) => {
    setOpenItems((current) => {
      if (current[url] === open) return current
      return { ...current, [url]: open }
    })
  }, [])

  React.useEffect(() => {
    setOpenItems((current) => {
      const nextState = { ...current }
      let changed = false

      for (const item of items) {
        const nextOpen = shouldBeOpen(item)
        if (nextOpen && current[item.url] !== true) {
          nextState[item.url] = true
          changed = true
        } else if (!(item.url in current)) {
          nextState[item.url] = nextOpen
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
          const itemTargetId = navigationTargetId(item.url)

          return (
            <Collapsible
              key={item.url}
              asChild
              open={openItems[item.url] ?? false}
              onOpenChange={(open) => handleItemOpenChange(item.url, open)}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                {hasSubItems ? (
                  <>
                    <SidebarMenuButton asChild tooltip={item.title} className="cursor-pointer" isActive={isParentActive}>
                      <Link
                        href={item.url}
                        aria-label={getNavMoveLabel(item.title)}
                        title={item.title}
                        data-testid={`admin-nav-link-${itemTargetId}`}
                        onPointerEnter={() => prefetchRoute(item.url)}
                        onFocus={() => prefetchRoute(item.url)}
                      >
                        {item.icon && <item.icon />}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuAction
                        className="cursor-pointer"
                        aria-expanded={openItems[item.url] ?? false}
                        aria-label={getNavSubmenuLabel(
                          item.title,
                          openItems[item.url] ?? false,
                        )}
                        title={`${item.title} 하위 메뉴`}
                        data-testid={`admin-nav-disclosure-${itemTargetId}`}
                      >
                        <ChevronRight className="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuAction>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items?.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.url}>
                            <SidebarMenuSubButton asChild className="cursor-pointer" isActive={isUrlActive(subItem.url)}>
                              <Link
                                href={subItem.url}
                                aria-label={getNavMoveLabel(subItem.title)}
                                title={subItem.title}
                                data-testid={`admin-nav-sublink-${navigationTargetId(subItem.url)}`}
                                onPointerEnter={() => prefetchRoute(subItem.url)}
                                onFocus={() => prefetchRoute(subItem.url)}
                              >
                                <span>{subItem.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </>
                ) : (
                  <SidebarMenuButton asChild tooltip={item.title} className="cursor-pointer" isActive={isUrlActive(item.url)}>
                    <Link
                      href={item.url}
                      aria-label={getNavMoveLabel(item.title)}
                      title={item.title}
                      data-testid={`admin-nav-link-${itemTargetId}`}
                      onPointerEnter={() => prefetchRoute(item.url)}
                      onFocus={() => prefetchRoute(item.url)}
                    >
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
