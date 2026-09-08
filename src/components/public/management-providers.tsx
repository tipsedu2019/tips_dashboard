"use client";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarConfigProvider } from "@/contexts/sidebar-context";
import { AuthProvider } from "@/providers/auth-provider";
export default function ManagementProviders({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="tips-dashboard-v2-theme">
      <AuthProvider>
        <SidebarConfigProvider>{children}</SidebarConfigProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
