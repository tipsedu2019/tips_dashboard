"use client"

import { useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/providers/auth-provider"

const ASSISTANT_ALLOWED_ADMIN_PATHS = [
  "/admin/tasks",
  "/admin/word-retests",
  "/admin/makeup-requests",
  "/admin/academic-calendar",
  "/admin/calendar",
  "/admin/timetable",
]

function normalizeAdminPath(pathname: string) {
  return pathname.replace(/\/+$/, "") || "/"
}

function canAssistantAccessPath(pathname: string) {
  const normalizedPath = normalizeAdminPath(pathname)

  return ASSISTANT_ALLOWED_ADMIN_PATHS.some((path) => (
    normalizedPath === path || normalizedPath.startsWith(`${path}/`)
  ))
}

function AdminShellLoadingState() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <span className="sr-only">관리자 화면을 준비하고 있습니다.</span>
      <div className="grid min-h-[100dvh] grid-cols-1 md:grid-cols-[16rem_1fr]">
        <aside className="hidden min-h-[100dvh] border-r bg-muted/20 px-4 py-5 md:flex md:flex-col">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <div className="mt-10 grid gap-6">
            {Array.from({ length: 3 }).map((_, groupIndex) => (
              <div key={`loading-nav-group-${groupIndex}`} className="grid gap-3">
                <Skeleton className="h-3 w-12" />
                {Array.from({ length: groupIndex === 1 ? 4 : 3 }).map((__, itemIndex) => (
                  <div key={`loading-nav-item-${groupIndex}-${itemIndex}`} className="flex items-center gap-3">
                    <Skeleton className="size-5 rounded-md" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-auto flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <header className="flex h-14 items-center justify-between border-b px-4 md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Skeleton className="size-5 rounded-md md:hidden" />
              <Skeleton className="hidden h-4 w-20 md:block" />
              <Skeleton className="h-5 w-24" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="hidden h-9 w-32 rounded-md sm:block" />
              <Skeleton className="h-9 w-40 rounded-md" />
              <Skeleton className="size-9 rounded-md" />
            </div>
          </header>

          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 md:gap-6 md:px-6">
            <div className="grid gap-3">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-4 w-52" />
            </div>
            <div className="grid gap-3 rounded-lg border bg-background p-3">
              <Skeleton className="h-10 w-full rounded-md" />
              <div className="grid gap-2 sm:grid-cols-3">
                <Skeleton className="h-9 rounded-md" />
                <Skeleton className="h-9 rounded-md" />
                <Skeleton className="h-9 rounded-md" />
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border bg-background">
              <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_96px] gap-3 border-b px-4 py-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-14 justify-self-end" />
              </div>
              {Array.from({ length: 7 }).map((_, index) => (
                <div
                  key={`loading-table-row-${index}`}
                  className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_96px] gap-3 border-b px-4 py-4 last:border-b-0"
                >
                  <div className="grid min-w-0 gap-2">
                    <Skeleton className="h-4 w-full max-w-72" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-20 justify-self-end rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryString = searchParams.toString()
  const {
    user,
    loading,
    canAccessDashboard,
    canUseAssistantOperations,
    defaultAdminPath,
  } = useAuth()
  const canAccessCurrentRoute = !canUseAssistantOperations || canAssistantAccessPath(pathname)

  useEffect(() => {
    if (loading) {
      return
    }

    if (!user) {
      const nextPath = queryString ? `${pathname}?${queryString}` : pathname
      const next = nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""
      router.replace(`/sign-in${next}`)
      return
    }

    if (!canAccessDashboard) {
      router.replace("/errors/forbidden")
      return
    }

    if (!canAccessCurrentRoute) {
      router.replace(defaultAdminPath)
    }
  }, [canAccessCurrentRoute, canAccessDashboard, defaultAdminPath, loading, pathname, queryString, router, user])

  if (loading || !user || !canAccessDashboard || !canAccessCurrentRoute) {
    return <AdminShellLoadingState />
  }

  return <>{children}</>
}
