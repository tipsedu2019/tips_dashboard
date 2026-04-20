"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowUpRight } from "lucide-react"

import { CommandSearch, QUICK_SEARCH_SHORTCUT_LABEL, SearchTrigger } from "@/components/command-search"
import { ModeToggle } from "@/components/mode-toggle"
import { Button } from "@/components/ui/button"
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
      <header className="flex h-auto shrink-0 items-center gap-2 border-b bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-auto">
        <div className="flex w-full flex-col gap-3 px-4 py-3 lg:px-6">
          <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="flex shrink-0 items-center gap-2 pt-1">
                <SidebarTrigger className="-ml-1 shrink-0" />
                <Separator
                  orientation="vertical"
                  className="hidden data-[orientation=vertical]:h-6 sm:block"
                />
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground">
                    <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-1">현재 워크스페이스</span>
                    <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-1">관리자 전용 동선</span>
                    <span className="rounded-full border border-dashed border-border/70 px-2 py-1">빠른 이동 {QUICK_SEARCH_SHORTCUT_LABEL}</span>
                  </div>
                  <div className="mt-2 min-w-0 space-y-1">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
                      {workspaceMeta.section}
                    </p>
                    <div className="flex min-w-0 flex-col gap-1 lg:flex-row lg:items-end lg:justify-between">
                      <div className="min-w-0">
                        <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
                          {workspaceMeta.title}
                        </h1>
                        <p className="text-sm text-muted-foreground">{workspaceMeta.summary}</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="min-w-0 max-w-md">
                  <SearchTrigger onClick={() => setSearchOpen(true)} />
                </div>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2 self-end lg:self-start">
              <Button variant="ghost" asChild size="sm" className="hidden sm:inline-flex">
                <Link href="/classes" target="_blank" rel="noreferrer">
                  수업 소개 확인
                  <ArrowUpRight className="size-4" />
                </Link>
              </Button>
              <ModeToggle />
            </div>
          </div>
        </div>
      </header>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  )
}
