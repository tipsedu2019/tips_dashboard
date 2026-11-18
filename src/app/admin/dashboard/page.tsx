"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { buildAdminNavGroups } from "@/lib/navigation"
import { useAuth } from "@/providers/auth-provider"

const destinations = [
  "/admin/registration", "/admin/transfer", "/admin/withdrawal",
  "/admin/makeup-requests", "/admin/classes", "/admin/textbooks",
  "/admin/academic-calendar", "/admin/statistics",
]

export default function Page() {
  const auth = useAuth()
  const permitted = buildAdminNavGroups(auth).flatMap((group) => group.items)
  const links = destinations.flatMap((url) => permitted.filter((item) => item.url === url))

  return (
    <nav aria-label="업무 바로가기" className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4 px-4 pb-5 sm:px-5 sm:pb-6 lg:px-6">
      {links.map(({ title, url, icon: Icon }) => (
        <Button key={url} asChild variant="outline" className="h-auto min-h-16 justify-start gap-3 px-4 py-4">
          <Link href={url} prefetch={false}>
            {Icon && <Icon aria-hidden="true" className="size-5" />}
            {title}
          </Link>
        </Button>
      ))}
    </nav>
  )
}
