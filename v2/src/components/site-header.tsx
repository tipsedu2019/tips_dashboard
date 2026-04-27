"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ExternalLink } from "lucide-react"

import { CommandSearch, SearchTrigger } from "@/components/command-search"
import { ModeToggle } from "@/components/mode-toggle"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { resolveAdminWorkspaceMeta } from "@/lib/navigation"

export function SiteHeader() {
  const pathname = usePathname()
  const [searchOpen, setSearchOpen] = React.useState(false)
  const workspaceMeta = React.useMemo(() => resolveAdminWorkspaceMeta(pathname), [pathname])

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

          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2 text-sm">
              <p className="shrink-0 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
                {workspaceMeta.section}
              </p>
              <span className="text-muted-foreground/40">/</span>
              <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{workspaceMeta.title}</h1>
            </div>

            <div className="flex items-center gap-2 lg:ml-4">
              <Link
                href="/"
                className="hidden h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground lg:inline-flex"
              >
                <ExternalLink className="size-3.5" />
                홈페이지 확인
              </Link>
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
