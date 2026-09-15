"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { CommandSearch, SearchTrigger } from "@/components/command-search"
import { ModeToggle } from "@/components/mode-toggle"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { resolveAdminWorkspaceMeta } from "@/lib/navigation"

export function SiteHeader() {
  const pathname = usePathname()
  const [searchOpen, setSearchOpen] = React.useState(false)
  const searchOpenerRef = React.useRef<HTMLElement | null>(null)
  const workspaceMeta = React.useMemo(() => resolveAdminWorkspaceMeta(pathname), [pathname])
  const openSearch = React.useCallback((opener: HTMLElement | null) => {
    searchOpenerRef.current = opener
    setSearchOpen(true)
  }, [])

  React.useEffect(() => {
    setSearchOpen(false)
  }, [pathname])

  return (
    <>
      <header className="sticky top-0 z-30 flex h-auto shrink-0 items-center border-b bg-background/95 backdrop-blur transition-[width,height] ease-linear supports-[backdrop-filter]:bg-background/80 group-has-data-[collapsible=icon]/sidebar-wrapper:h-auto">
        <div className="flex w-full items-start gap-3 px-4 py-3 lg:px-6">
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <SidebarTrigger className="-ml-1 shrink-0" data-testid="admin-sidebar-toggle" />
            <Separator orientation="vertical" className="hidden data-[orientation=vertical]:h-6 sm:block" />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0 flex items-center gap-2 text-sm">
              <p className="shrink-0 text-xs font-medium text-muted-foreground">
                {workspaceMeta.section}
              </p>
              <span className="text-muted-foreground/40">/</span>
              <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{workspaceMeta.title}</h1>
            </div>

            <div className="flex min-w-0 items-center gap-2 sm:ml-4">
              <div className="min-w-0 flex-1 lg:w-64 lg:flex-none">
                <SearchTrigger onClick={(event) => openSearch(event.currentTarget)} />
              </div>
              <ModeToggle />
            </div>
          </div>
        </div>
      </header>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} returnFocusRef={searchOpenerRef} />
    </>
  )
}
