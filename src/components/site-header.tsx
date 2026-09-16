"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { CommandSearch, SearchTrigger } from "@/components/command-search"
import { ModeToggle } from "@/components/mode-toggle"
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
      <header data-slot="site-header" className="sticky top-0 z-30 flex min-h-[var(--shell-header-height-mobile)] shrink-0 items-center border-b border-border/60 bg-[var(--workspace-background)] md:min-h-[var(--shell-header-height)] md:border-transparent">
        <div className="flex w-full items-center gap-2 px-4 py-1 md:gap-4 md:px-5 md:py-3 xl:px-6">
          <SidebarTrigger className="-ml-1 size-[var(--touch-target-height)] shrink-0 md:size-[var(--control-height)]" data-testid="admin-sidebar-toggle" />

          <div className="grid min-w-0 flex-1 gap-0.5">
            {workspaceMeta.section !== workspaceMeta.title ? (
                <p className="hidden text-xs font-medium leading-4 text-muted-foreground md:block">
                  {workspaceMeta.section}
                </p>
            ) : null}
            <h1 className="min-w-0 break-words text-lg font-semibold leading-[26px] text-foreground md:text-[22px] md:leading-7">{workspaceMeta.title}</h1>
          </div>

          <div className="flex shrink-0 items-center gap-1 md:gap-2 [&_[data-testid=admin-theme-toggle]]:size-[var(--touch-target-height)] md:[&_[data-testid=admin-theme-toggle]]:size-[var(--control-height)]">
            <SearchTrigger onClick={(event) => openSearch(event.currentTarget)} />
            <ModeToggle variant="ghost" />
          </div>
        </div>
      </header>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} returnFocusRef={searchOpenerRef} />
    </>
  )
}
