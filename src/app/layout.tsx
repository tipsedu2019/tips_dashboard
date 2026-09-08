import type { Metadata } from "next"

import "./globals.css"

import { RouteProviders } from "@/components/public/route-providers"
import { fontSansClassName } from "@/lib/fonts"

export const metadata: Metadata = {
  title: "TIPS Dashboard",
  description: "TIPS 운영, 학사 일정, 수업 관리 업무를 위한 통합 대시보드",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/favicon-window.png", type: "image/png", sizes: "512x512" }],
    shortcut: "/favicon-window.png",
    apple: "/favicon.png",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko" data-scroll-behavior="smooth" className="antialiased">
      <body className={fontSansClassName}>
        <RouteProviders>{children}</RouteProviders>
      </body>
    </html>
  )
}
