"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

import { useAuth } from "@/providers/auth-provider"

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading, canAccessDashboard } = useAuth()

  useEffect(() => {
    if (loading) {
      return
    }

    if (!user) {
      const next = pathname ? `?next=${encodeURIComponent(pathname)}` : ""
      router.replace(`/sign-in${next}`)
      return
    }

    if (!canAccessDashboard) {
      router.replace("/errors/forbidden")
    }
  }, [canAccessDashboard, loading, pathname, router, user])

  if (loading || !user || !canAccessDashboard) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center px-4">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
          <p className="mt-3 text-sm text-muted-foreground">관리자 화면을 준비하고 있습니다.</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
