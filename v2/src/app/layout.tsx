import type { Metadata } from "next"

import "./globals.css"

import { ThemeProvider } from "@/components/theme-provider"
import { SidebarConfigProvider } from "@/contexts/sidebar-context"
import { fontSansClassName } from "@/lib/fonts"
import { AuthProvider } from "@/providers/auth-provider"

export const metadata: Metadata = {
  title: "TIPS Dashboard",
  description: "TIPS 운영, 학사 일정, 수업 관리 업무를 위한 통합 대시보드",
  icons: {
    icon: [
      { url: "/favicon-window.png", type: "image/png", sizes: "512x512" },
      { url: "/favicon.ico", sizes: "any" },
    ],
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
        <ThemeProvider defaultTheme="system" storageKey="tips-dashboard-v2-theme">
          <AuthProvider>
            <SidebarConfigProvider>{children}</SidebarConfigProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
