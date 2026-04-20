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
  const workspaceMeta = React.useMemo(() => resolveAdminWorkspaceMeta(pathname), [pathname])
  const showSummary = pathname === "/admin" || pathname === "/admin/dashboard"

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen((open) => !open)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  return (
    <>
      <header className="flex h-auto shrink-0 items-center border-b bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-auto">
        <div className="flex w-full items-start gap-3 px-4 py-3 lg:px-6">
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <SidebarTrigger className="-ml-1 shrink-0" />
            <Separator orientation="vertical" className="hidden data-[orientation=vertical]:h-6 sm:block" />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
                {workspaceMeta.section}
              </p>
              <div className="min-w-0 lg:flex lg:items-center lg:gap-3">
                <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{workspaceMeta.title}</h1>
                {showSummary ? <p className="text-sm text-muted-foreground">{workspaceMeta.summary}</p> : null}
              </div>
            </div>

            <div className="flex items-center gap-2 lg:ml-4">
              <div className="min-w-0 flex-1 lg:w-64 lg:flex-none">
                <SearchTrigger onClick={() => setSearchOpen(true)} />
              </div>
              <ModeToggle />
            </div>
          </div>
        </div>
      </header>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  )
}
