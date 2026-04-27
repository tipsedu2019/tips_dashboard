import Link from "next/link"
import type { LucideIcon } from "lucide-react"

import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"

type AuthErrorAction = {
  href: string
  label: string
  variant?: "default" | "outline"
}

export function AuthErrorScreen({
  code,
  title,
  message,
  icon: Icon,
  actions,
}: {
  code: string
  title: string
  message: string
  icon: LucideIcon
  actions: AuthErrorAction[]
}) {
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
          <span className="font-mono text-xs font-medium text-muted-foreground">{code}</span>
        </div>

        <div className="space-y-4">
          <div className="flex size-11 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            <Icon className="size-5" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm leading-6 text-muted-foreground">{message}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-2 sm:grid-cols-2">
          {actions.map((action) => (
            <Button key={action.href} asChild variant={action.variant ?? "default"} className="cursor-pointer">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ))}
        </div>
      </section>
    </main>
  )
}
