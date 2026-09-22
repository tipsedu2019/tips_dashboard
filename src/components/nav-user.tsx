"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { Check, EllipsisVertical, KeyRound, LogOut, UserRound } from "lucide-react"

import { useAuth } from "@/providers/auth-provider"
import { getProfileAvatarPreset, profileAvatarPresets } from "@/lib/profile-avatars"
import { supabase, supabaseConfigError } from "@/lib/supabase"
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
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type NavUserRecord = {
  name: string
  email: string
  avatar: string
}

function profileSaveErrorMessage(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined
  if (["reauthentication_needed", "reauthentication_not_valid", "reauth_nonce_missing", "session_expired", "session_not_found", "refresh_token_not_found"].includes(String(code))) {
    return "다시 로그인한 뒤 계정 설정을 저장해 주세요. 현재 변경 사항은 저장되지 않았습니다."
  }
  if (code === "same_password") return "현재 비밀번호와 다른 새 비밀번호를 입력해 주세요."
  if (code === "weak_password") return "더 안전한 새 비밀번호를 입력해 주세요. 문자, 숫자, 기호를 함께 사용해 주세요."
  if (code === "over_request_rate_limit") return "잠시 후 다시 저장해 주세요. 요청이 너무 많습니다."
  return "계정 설정을 저장하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요."
}

const PROFILE_AVATAR_INITIAL_LIMIT = 20
const PROFILE_AVATAR_BATCH_SIZE = 15

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
  const avatar = getProfileAvatarPreset(user.avatar)

  return (
    <Avatar className="size-8 rounded-full border border-sidebar-border/70 bg-sidebar-accent/30">
      <AvatarImage src={avatar.src} alt={`${user.name} 프로필 이미지`} />
      <AvatarFallback className="bg-slate-100 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-100">
        {getAvatarFallback(user)}
      </AvatarFallback>
    </Avatar>
  )
}

export function NavUser({ user, menuContainer }: { user: NavUserRecord; menuContainer?: HTMLElement | null }) {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const accountMenuButtonRef = React.useRef<HTMLButtonElement>(null)
  const { logout, user: authUser } = useAuth()
  const fallbackAvatar = profileAvatarPresets[0]?.src || ""
  const normalizedUserAvatar = getProfileAvatarPreset(user.avatar).src || fallbackAvatar
  const [profileOpen, setProfileOpen] = React.useState(false)
  const [localAvatar, setLocalAvatar] = React.useState(normalizedUserAvatar)
  const [selectedAvatar, setSelectedAvatar] = React.useState(normalizedUserAvatar)
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [feedback, setFeedback] = React.useState<{ type: "success" | "error"; message: string; field?: "newPassword" | "confirmPassword" } | null>(null)
  const [avatarLimit, setAvatarLimit] = React.useState(PROFILE_AVATAR_INITIAL_LIMIT)

  React.useEffect(() => {
    setLocalAvatar(normalizedUserAvatar)
    setSelectedAvatar(normalizedUserAvatar)
  }, [normalizedUserAvatar])

  React.useEffect(() => {
    if (profileOpen) {
      setAvatarLimit(PROFILE_AVATAR_INITIAL_LIMIT)
    }
  }, [profileOpen])

  React.useEffect(() => {
    if (feedback?.type !== "error") return
    document.getElementById(feedback.field === "newPassword" ? "profile-new-password" : feedback.field === "confirmPassword" ? "profile-confirm-password" : "profile-feedback")?.focus()
  }, [feedback])

  const displayUser = React.useMemo(
    () => ({
      ...user,
      avatar: localAvatar || normalizedUserAvatar,
    }),
    [localAvatar, normalizedUserAvatar, user],
  )
  const selectedPreset = React.useMemo(
    () => profileAvatarPresets.find((preset) => preset.src === selectedAvatar),
    [selectedAvatar],
  )
  const visibleProfileAvatarPresets = React.useMemo(() => {
    const visiblePresets = profileAvatarPresets.slice(0, avatarLimit)
    if (selectedPreset && !visiblePresets.some((preset) => preset.id === selectedPreset.id)) {
      return [...visiblePresets, selectedPreset]
    }
    return visiblePresets
  }, [avatarLimit, selectedPreset])
  const hasMoreAvatars = avatarLimit < profileAvatarPresets.length

  const handleAvatarSelect = React.useCallback((avatar: string) => {
    setSelectedAvatar(avatar)
  }, [])

  const revealMoreAvatars = React.useCallback(() => {
    setAvatarLimit((current) => Math.min(current + PROFILE_AVATAR_BATCH_SIZE, profileAvatarPresets.length))
  }, [])

  const handleLogout = async () => {
    await logout()
    router.replace("/sign-in")
  }

  const handleProfileSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!supabase) {
      setFeedback({ type: "error", message: supabaseConfigError || "계정 설정을 저장할 수 없습니다." })
      return
    }

    const shouldChangePassword = newPassword.length > 0 || confirmPassword.length > 0
    if (shouldChangePassword && newPassword.length < 8) {
      setFeedback({ type: "error", message: "비밀번호는 8자 이상 입력해 주세요.", field: "newPassword" })
      return
    }

    if (shouldChangePassword && newPassword !== confirmPassword) {
      setFeedback({ type: "error", message: "새 비밀번호와 확인 값이 다릅니다.", field: "confirmPassword" })
      return
    }

    const avatarChanged = Boolean(selectedAvatar && selectedAvatar !== (localAvatar || normalizedUserAvatar))

    if (!avatarChanged && !shouldChangePassword) {
      setFeedback({ type: "error", message: "변경할 아바타 또는 비밀번호를 입력해 주세요." })
      return
    }

    setSaving(true)
    setFeedback(null)

    const metadata = {
      ...((authUser?.user_metadata ?? {}) as Record<string, unknown>),
      ...(avatarChanged
        ? {
            avatar_url: selectedAvatar,
            avatar_preset: selectedPreset?.id || "",
            picture: selectedAvatar,
          }
        : {}),
    }

    let updateError: unknown
    try {
      const result = await supabase.auth.updateUser({
        ...(shouldChangePassword ? { password: newPassword } : {}),
        ...(avatarChanged ? { data: metadata } : {}),
      })
      updateError = result.error
    } catch (error) {
      updateError = error
    } finally {
      setSaving(false)
    }

    if (updateError) {
      setFeedback({ type: "error", message: profileSaveErrorMessage(updateError), ...(shouldChangePassword ? { field: "newPassword" as const } : {}) })
      return
    }

    if (avatarChanged) {
      setLocalAvatar(selectedAvatar)
    }
    setNewPassword("")
    setConfirmPassword("")
    setFeedback({ type: "success", message: "계정 설정을 저장했습니다." })
  }

  const menu = (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              ref={accountMenuButtonRef}
              size="lg"
              aria-label={`${displayUser.name} 계정 메뉴 열기`}
              title="계정 메뉴"
              data-testid="admin-user-menu-trigger"
              className="cursor-pointer data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <UserAvatar user={displayUser} />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayUser.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {displayUser.email}
                </span>
              </div>
              <EllipsisVertical className="ml-auto size-4" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
            data-testid="admin-user-menu"
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <UserAvatar user={displayUser} />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{displayUser.name}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {displayUser.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" data-testid="admin-user-profile-settings" onSelect={() => setProfileOpen(true)}>
              <UserRound />
              프로필 설정
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" data-testid="admin-user-logout" onClick={handleLogout}>
              <LogOut />
              로그아웃
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )

  return (
    <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
      {menuContainer === undefined ? menu : menuContainer ? createPortal(menu, menuContainer) : null}
      <DialogContent
        aria-label="프로필 설정"
        data-testid="admin-profile-dialog"
        onCloseAutoFocus={event => {
          event.preventDefault()
          const opener = accountMenuButtonRef.current
          if (opener?.isConnected && opener.getClientRects().length > 0) opener.focus({ preventScroll: true })
          else document.querySelector<HTMLElement>("#admin-workspace")?.focus({ preventScroll: true })
        }}
        className="max-h-[calc(100dvh-2rem)] w-[min(920px,calc(100vw-2rem))] !max-w-[920px] overflow-hidden p-0"
      >
        <form onSubmit={handleProfileSave} className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col">
          <DialogHeader className="shrink-0 border-b px-5 py-4 sm:px-6">
            <DialogTitle>프로필 설정</DialogTitle>
            <DialogDescription className="sr-only">
              아바타를 고르고 새 비밀번호를 입력하면 계정에 바로 반영됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 gap-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.35fr)_20rem]">
            <section className="min-w-0 rounded-xl border bg-muted/20">
              <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">프리셋 아바타</div>
                </div>
                <Avatar className="size-12 rounded-2xl border bg-background shadow-xs">
                  <AvatarImage src={selectedAvatar} alt="선택한 프로필 아바타" />
                  <AvatarFallback>{getAvatarFallback(displayUser)}</AvatarFallback>
                </Avatar>
              </div>
              <ScrollArea className="h-[316px]">
                <div
                  className="grid grid-cols-5 gap-2 p-3 sm:grid-cols-10"
                  data-testid="admin-profile-avatar-grid"
                  data-visible-count={visibleProfileAvatarPresets.length}
                >
                  {visibleProfileAvatarPresets.map((preset, index) => {
                    const selected = selectedAvatar === preset.src
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-label={`${preset.label} 선택`}
                        aria-pressed={selected}
                        data-testid={`admin-profile-avatar-${preset.id}`}
                        onClick={() => handleAvatarSelect(preset.src)}
                        className={cn(
                          "group relative grid aspect-square place-items-center rounded-xl border bg-background p-1 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted",
                          selected && "border-primary bg-primary/5",
                        )}
                      >
                        <Avatar className="size-full rounded-lg bg-background">
                          <AvatarImage src={preset.src} alt="" className="rounded-lg object-cover" />
                          <AvatarFallback className="rounded-lg text-[10px]">
                            {String(index + 1).padStart(2, "0")}
                          </AvatarFallback>
                        </Avatar>
                        {selected ? (
                          <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                            <Check className="size-3.5" />
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
                {hasMoreAvatars ? (
                  <div className="px-3 pb-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 w-full rounded-md"
                      data-testid="admin-profile-avatar-show-more"
                      onClick={revealMoreAvatars}
                    >
                      더 보기
                    </Button>
                  </div>
                ) : null}
              </ScrollArea>
            </section>
            <section className="grid content-start gap-4">
              <div className="rounded-xl border bg-background p-4">
                <div className="flex items-center gap-3">
                  <UserAvatar user={{ ...displayUser, avatar: selectedAvatar }} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{displayUser.name}</div>
                    <div className="text-muted-foreground truncate text-xs">{displayUser.email}</div>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border bg-background p-4">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
                  <KeyRound className="size-4" />
                  비밀번호 변경
                </div>
                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="profile-new-password">새 비밀번호</Label>
                    <Input
                      id="profile-new-password"
                      aria-invalid={Boolean(feedback?.type === "error" && feedback.field === "newPassword")}
                      aria-describedby={feedback ? "profile-feedback" : undefined}
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="8자 이상"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="profile-confirm-password">새 비밀번호 확인</Label>
                    <Input
                      id="profile-confirm-password"
                      aria-invalid={Boolean(feedback?.type === "error" && feedback.field === "confirmPassword")}
                      aria-describedby={feedback ? "profile-feedback" : undefined}
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="한 번 더 입력"
                    />
                  </div>
                </div>
              </div>
              {feedback ? (
                <div id="profile-feedback" tabIndex={-1} role={feedback.type === "error" ? "alert" : "status"}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm",
                    feedback.type === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-destructive/25 bg-destructive/10 text-destructive",
                  )}
                >
                  {feedback.message}
                </div>
              ) : null}
            </section>
          </div>
          <DialogFooter className="shrink-0 border-t bg-background px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" onClick={() => setProfileOpen(false)}>
              닫기
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "저장 중" : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
