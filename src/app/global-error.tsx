"use client"

import { PageRecovery } from "@/components/errors/page-recovery"

export default function GlobalError() {
  return (
    <html lang="ko">
      <body style={{ margin: 0 }}><PageRecovery /></body>
    </html>
  )
}
