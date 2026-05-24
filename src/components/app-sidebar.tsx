"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { Lock } from "lucide-react"

import { sidebarBrand } from "@/components/brand-assets"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { buildAdminNavGroups } from "@/lib/navigation"
import { useAuth } from "@/providers/auth-provider"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"

function pickFirstString(...values: unknown[]) {
  return (
    values.find((value): value is string => typeof value === "string" && value.trim().length > 0) ??
    ""
  )
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user, canManageAll, canEditCurriculumPlanning } = useAuth()
  const navGroups = React.useMemo(
    () => buildAdminNavGroups({ canManageAll, canEditCurriculumPlanning }),
    [canEditCurriculumPlanning, canManageAll],
  )

  const userMetadata = (user?.user_metadata ?? {}) as Record<string, unknown>
  const profileFields = (user ?? {}) as Record<string, unknown>

  const displayUser = {
    name: user?.name || "TIPS 사용자",
    email: user?.email || "viewer@tipsedu.co.kr",
    avatar: pickFirstString(
      userMetadata.avatar_url,
      userMetadata.picture,
      profileFields.avatar_url,
      profileFields.avatarUrl,
      profileFields.profile_image_url,
      profileFields.profileImageUrl,
    ),
  }

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              className="group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center"
            >
              <Link
                href={sidebarBrand.href}
                aria-label="대시보드 홈으로 이동"
                title="대시보드"
                data-testid="admin-sidebar-brand"
              >
                <div className="flex aspect-square size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-sidebar-border/60 bg-white p-1 shadow-sm">
                  <Image
                    src={sidebarBrand.src}
                    alt={sidebarBrand.alt}
                    width={28}
                    height={28}
                    priority
                    className="object-contain"
                  />
                </div>
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate font-medium">TIPS Dashboard</span>
                  <span className="truncate text-xs">운영 포털</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <NavMain key={group.label} label={group.label} items={group.items} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        {!user?.isFallbackRole && user?.email ? null : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-sidebar-border px-2.5 py-1.5 text-xs font-medium text-sidebar-foreground/70">
            <Lock className="size-3.5" />
            <span className="truncate">임시 권한</span>
          </div>
        )}
        <NavUser user={displayUser} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
