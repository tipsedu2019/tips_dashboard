"use client";

import React from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { useSidebarConfig } from "@/hooks/use-sidebar-config";
import { AuthGuard } from "@/components/auth/auth-guard";
import { useAuth } from "@/providers/auth-provider";

function ViewerPermissionNotice() {
  const { authError, role, user } = useAuth();

  if (authError && user?.isFallbackRole) {
    return (
      <div
        data-testid="profile-resolution-notice"
        aria-live="polite"
        className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950 md:px-6"
      >
        권한 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.
      </div>
    );
  }

  if (role === "viewer" && user?.isFallbackRole === false) {
    return (
      <div
        data-testid="viewer-permission-notice"
        className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950 md:px-6"
      >
        관리팀에게 권한 조정을 요청하세요.
      </div>
    );
  }

  return null;
}

function DashboardMain({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <ViewerPermissionNotice />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { config } = useSidebarConfig();

  return (
    <AuthGuard>
      <SidebarProvider
        style={{
          "--sidebar-width": "16rem",
          "--sidebar-width-icon": "3rem",
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties}
        className={config.collapsible === "none" ? "sidebar-none-mode" : ""}
      >
        {config.side === "left" ? (
          <>
            <AppSidebar
              variant={config.variant}
              collapsible={config.collapsible}
              side={config.side}
            />
            <SidebarInset>
              <DashboardMain>{children}</DashboardMain>
            </SidebarInset>
          </>
        ) : (
          <>
            <SidebarInset>
              <DashboardMain>{children}</DashboardMain>
            </SidebarInset>
            <AppSidebar
              variant={config.variant}
              collapsible={config.collapsible}
              side={config.side}
            />
          </>
        )}
      </SidebarProvider>
    </AuthGuard>
  );
}
