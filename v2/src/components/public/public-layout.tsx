import Link from "next/link"

import { ModeToggle } from "@/components/mode-toggle"
import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"

export function PublicLayout({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Logo size={24} />
            </div>
            <div>
              <p className="text-sm font-semibold">TIPS Dashboard</p>
              <p className="text-xs text-muted-foreground">입시·학사 운영 포털</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild className="hidden sm:inline-flex">
              <Link href="/classes">수업 소개</Link>
            </Button>
            <Button variant="ghost" asChild className="hidden sm:inline-flex">
              <Link href="/reviews">리뷰</Link>
            </Button>
            <Button variant="ghost" asChild className="hidden sm:inline-flex">
              <Link href="/results">결과</Link>
            </Button>
            <ModeToggle variant="ghost" />
            <Button asChild>
              <Link href="/admin/dashboard">관리자</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">{eyebrow}</p>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
            <p className="max-w-3xl text-muted-foreground">{description}</p>
          </div>
        </div>
        {children}
      </main>
    </div>
  )
}
