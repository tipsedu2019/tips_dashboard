"use client"

import { useRouter } from "next/navigation"
import { EllipsisVertical, LogOut } from "lucide-react"

import { useAuth } from "@/providers/auth-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

type NavUserRecord = {
  name: string
  email: string
  avatar: string
}

function getAvatarFallback(user: NavUserRecord) {
  const compactName = (user.name || "").replace(/\s+/g, "")
  const nameLetters = Array.from(compactName)
  const isKoreanName = /^[가-힣]+$/.test(compactName)

  if (isKoreanName && nameLetters.length >= 2) {
    return nameLetters.slice(1).join("")
  }

  const nameTokens = user.name.trim().split(/\s+/).filter(Boolean)
  const nameToken = nameTokens[nameTokens.length - 1]
  const seed = Array.from((nameToken || user.email || "T").replace(/\s+/g, ""))
  return seed.slice(0, 2).join("") || "T"
}

function UserAvatar({ user }: { user: NavUserRecord }) {
  return (
    <Avatar className="size-8 rounded-full border border-sidebar-border/70 bg-sidebar-accent/30">
      {user.avatar ? <AvatarImage src={user.avatar} alt={`${user.name} 프로필 이미지`} /> : null}
      <AvatarFallback className="bg-slate-100 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-100">
        {getAvatarFallback(user)}
      </AvatarFallback>
    </Avatar>
  )
}

export function NavUser({ user }: { user: NavUserRecord }) {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const { logout } = useAuth()

  const handleLogout = async () => {
    await logout()
    router.replace("/sign-in")
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="cursor-pointer data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <UserAvatar user={user} />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {user.email}
                </span>
              </div>
              <EllipsisVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <UserAvatar user={user} />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" onClick={handleLogout}>
              <LogOut />
              로그아웃
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
