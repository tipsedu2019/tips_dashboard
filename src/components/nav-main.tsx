"use client"

import * as React from "react"
import { ChevronRight, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

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

const LEGACY_TODO_VIEW_SEARCH: Record<string, { list: string; filter?: string }> = {
  all: { list: "filters", filter: "all" },
  inbox: { list: "inbox" },
  today: { list: "today" },
  upcoming: { list: "upcoming" },
  board: { list: "board" },
  calendar: { list: "calendar" },
  completed: { list: "completed" },
  overdue: { list: "filters", filter: "overdue" },
  mine: { list: "filters", filter: "mine" },
  priority: { list: "filters", filter: "priority" },
  unassigned: { list: "filters", filter: "unassigned" },
  confirmation: { list: "filters", filter: "all" },
}

function normalizeSearch(path: string, search: string) {
  const params = new URLSearchParams(search.replace(/^\?/, ""))
  if (path === "/admin/tasks") {
    const legacyView = params.get("view") || ""
    const legacyRoute = LEGACY_TODO_VIEW_SEARCH[legacyView]
    if (!params.get("list") && legacyRoute) {
      params.set("list", legacyRoute.list)
      if (legacyRoute.filter && legacyRoute.filter !== "all") {
        params.set("filter", legacyRoute.filter)
      } else {
        params.delete("filter")
      }
      params.delete("view")
      params.delete("focus")
    }
  }
  params.sort()
  const normalized = params.toString()

  return normalized ? `?${normalized}` : ""
}

function splitInternalHref(url: string) {
  try {
    const parsed = new URL(url, "http://tips.local")

    return {
      path: normalizePath(parsed.pathname),
      search: normalizeSearch(normalizePath(parsed.pathname), parsed.search),
    }
  } catch {
    const [path = "/", search = ""] = url.split("?")
    const normalizedPath = normalizePath(path)

    return {
      path: normalizedPath,
      search: normalizeSearch(normalizedPath, search),
    }
  }
}

function normalizeHref(url: string) {
  const { path, search } = splitInternalHref(url)

  return `${path}${search}`
}

function isRouteActive(currentHref: string, targetUrl: string) {
  const current = splitInternalHref(currentHref)
  const target = splitInternalHref(targetUrl)

  if (target.search && target.path === current.path) {
    return target.search === current.search
  }

  if (target.path === "/") {
    return current.path === target.path
  }

  return current.path === target.path || current.path.startsWith(`${target.path}/`)
}

function navigationTargetId(url: string) {
  return normalizeHref(url)
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
  const searchParams = useSearchParams()
  const currentPath = React.useMemo(() => normalizePath(pathname), [pathname])
  const currentSearch = searchParams.toString()
  const currentHref = React.useMemo(() => (
    currentSearch ? `${currentPath}?${currentSearch}` : currentPath
  ), [currentPath, currentSearch])
  const prefetchedRoutesRef = React.useRef(new Set<string>())

  const prefetchRoute = React.useCallback((url: string) => {
    const target = normalizeHref(url)
    if (target === currentHref || prefetchedRoutesRef.current.has(target)) return

    prefetchedRoutesRef.current.add(target)
    router.prefetch(target)
  }, [currentHref, router])

  const routeStateByUrl = React.useMemo(() => {
    const routes = new Map<string, boolean>()

    for (const item of items) {
      routes.set(item.url, isRouteActive(currentHref, item.url))

      for (const subItem of item.items || []) {
        routes.set(subItem.url, isRouteActive(currentHref, subItem.url))
      }
    }

    return routes
  }, [currentHref, items])

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
