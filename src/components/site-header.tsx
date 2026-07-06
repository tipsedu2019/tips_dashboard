"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ExternalLink } from "lucide-react"

import { CommandSearch, SearchTrigger } from "@/components/command-search"
import { DashboardNotificationPopover } from "@/components/dashboard-notification-popover"
import { ModeToggle } from "@/components/mode-toggle"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { resolveAdminWorkspaceMeta } from "@/lib/navigation"

export function SiteHeader() {
  const pathname = usePathname()
  const [searchOpen, setSearchOpen] = React.useState(false)
  const workspaceMeta = React.useMemo(() => resolveAdminWorkspaceMeta(pathname), [pathname])

  React.useEffect(() => {
    setSearchOpen(false)
  }, [pathname])

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
              <Link
                href="/"
                target="_blank"
                rel="noreferrer"
                aria-label="홈페이지를 새 화면에서 확인"
                title="홈페이지 확인"
                data-testid="admin-public-site-link"
                className="hidden size-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground lg:inline-flex"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
                <span className="sr-only">홈페이지 확인</span>
              </Link>
              <div className="min-w-0 flex-1 lg:w-64 lg:flex-none">
                <SearchTrigger onClick={() => setSearchOpen(true)} />
              </div>
              <div aria-label="알림">
                <DashboardNotificationPopover />
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
