import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Logo } from "@/components/logo"

export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-5 py-10">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Logo size={22} />
            </span>
            TIPS Dashboard
          </Link>
          <span className="font-mono text-xs font-medium text-muted-foreground">404</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">없는 화면입니다</h1>
          <p className="text-sm leading-6 text-muted-foreground">주소가 바뀌었거나 운영 범위에서 제외된 화면입니다.</p>
        </div>
        <Button asChild className="mt-8 w-full cursor-pointer">
          <Link href="/admin/dashboard">대시보드</Link>
        </Button>
      </section>
    </main>
  )
}
