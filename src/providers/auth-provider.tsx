"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { Session, SupabaseClient, User } from "@supabase/supabase-js"

import {
  fallbackAdminEmails,
  fallbackStaffEmails,
  fallbackTeacherEmails,
  supabase,
  supabaseConfigError,
} from "@/lib/supabase"
import {
  getRoleCapabilities,
  normalizeDashboardRole,
  normalizeLoginIdentifier,
  shouldForcePasswordChange,
  type DashboardRole,
} from "@/lib/auth-utils"
import { getAuthErrorMessage } from "@/lib/auth-error-messages"
import { createAuthResolutionCoordinator } from "@/lib/auth-resolution-coordinator.js"

type DashboardUser = User & {
  name?: string
  role?: DashboardRole
  loginId?: string
  teacherCatalogId?: string
  mustChangePassword?: boolean
  isFallbackRole?: boolean
}

type AuthContextValue = {
  session: Session | null
  user: DashboardUser | null
  role: DashboardRole
  isAdmin: boolean
  isStaff: boolean
  isTeacher: boolean
  isAssistant: boolean
  loading: boolean
  authError: string | null
  mustChangePassword: boolean
  canAccessDashboard: boolean
  canManageAll: boolean
  canEditCurriculumPlanning: boolean
  canEditClassSchedulePlanning: boolean
  canEditClassSchedule: boolean
  canUseAssistantOperations: boolean
  defaultAdminPath: string
  login: (identifier: string, password: string) => Promise<boolean>
  logout: () => Promise<boolean>
}

type DashboardProfileResult = {
  user: DashboardUser
  authError: string | null
}

type AuthResolutionToken = {
  sessionKey: string
  generation: number
}

type ResolvedDashboardProfile = DashboardProfileResult & AuthResolutionToken

type InitialAuthSessionResult = Awaited<
  ReturnType<SupabaseClient["auth"]["getSession"]>
>

let initialAuthSessionPromise: Promise<InitialAuthSessionResult> | null = null
const PROFILE_QUERY_TIMEOUT_MS = 10_000

function loadInitialAuthSession(client: SupabaseClient) {
  initialAuthSessionPromise ||= client.auth.getSession().finally(() => {
    initialAuthSessionPromise = null
  })

  return initialAuthSessionPromise
}

const AuthContext = createContext<AuthContextValue | null>(null)

function normalizeEmail(value: string) {
  return normalizeLoginIdentifier(String(value || "").replace(/\s+/g, ""))
}

function createFallbackSet(values: string[]) {
  return new Set(values.map((value) => normalizeEmail(value)).filter(Boolean))
}

const fallbackAdminSet = createFallbackSet(fallbackAdminEmails)
const fallbackStaffSet = createFallbackSet(fallbackStaffEmails)
const fallbackTeacherSet = createFallbackSet(fallbackTeacherEmails)

function resolveFallbackRole(email: string | undefined): DashboardRole {
  const normalizedEmail = normalizeEmail(email || "")
  if (!normalizedEmail) return "viewer"
  if (fallbackAdminSet.has(normalizedEmail)) return "admin"
  if (fallbackStaffSet.has(normalizedEmail)) return "staff"
  if (fallbackTeacherSet.has(normalizedEmail)) return "teacher"
  return "viewer"
}

function getFallbackName(supabaseUser: User | null) {
  const email = supabaseUser?.email || ""
  const localName = email.includes("@") ? email.split("@")[0] : email

  return (
    (supabaseUser?.user_metadata?.name as string | undefined) ||
    (supabaseUser?.user_metadata?.full_name as string | undefined) ||
    localName ||
    "사용자"
  )
}

function createFallbackUser(supabaseUser: User, role: DashboardRole): DashboardUser {
  return {
    ...supabaseUser,
    email: supabaseUser.email || "",
    name: getFallbackName(supabaseUser),
    role,
    isFallbackRole: true,
    mustChangePassword: shouldForcePasswordChange(supabaseUser),
  }
}

function buildProfileResolutionMessage(hasProfileError: boolean) {
  return hasProfileError
    ? "프로필을 불러오지 못해 임시 권한으로 접속했습니다."
    : "프로필 정보가 없어 임시 권한으로 접속했습니다."
}

function isStaleRefreshTokenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "")
  const normalized = message.toLowerCase()

  return (
    normalized.includes("invalid refresh token") ||
    normalized.includes("refresh token not found") ||
    normalized.includes("refresh token already used")
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<DashboardUser | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [authError, setAuthError] = useState<string | null>(
    supabase ? null : supabaseConfigError,
  )
  const authResolutionRef = useRef(createAuthResolutionCoordinator())
  const profileRequestRef = useRef<{
    key: string
    promise: Promise<DashboardProfileResult> | null
  }>({ key: "", promise: null })

  useEffect(() => {
    let isActive = true

    const getSessionKey = (nextSession: Session | null) => {
      if (!nextSession?.user?.id) {
        return "anonymous"
      }

      return `${nextSession.user.id}:${nextSession.expires_at || ""}`
    }

    const resetAnonymousSession = (resolution: AuthResolutionToken) => {
      if (!authResolutionRef.current.markResolvedProfile(resolution)) return
      profileRequestRef.current = { key: "", promise: null }
      setSession(null)
      setUser(null)
      setAuthError(null)
      setLoading(false)
    }

    const resolveDashboardProfile = async (
      supabaseUser: User,
    ): Promise<DashboardProfileResult> => {
      try {
        const normalizedEmail = normalizeEmail(supabaseUser.email || "")
        const normalizedLoginId = normalizedEmail.includes("@")
          ? normalizedEmail.split("@")[0]
          : normalizedEmail
        const profileById = await supabase!
          .from("profiles")
          .select("*")
          .eq("id", supabaseUser.id)
          .abortSignal(AbortSignal.timeout(PROFILE_QUERY_TIMEOUT_MS))
          .maybeSingle()
          .retry(false)
        let data = profileById.data
        let error = profileById.error

        if (!data && !error && normalizedEmail) {
          const profileByIdentity = await supabase!
            .from("profiles")
            .select("*")
            .or(`email.eq.${normalizedEmail},login_id.eq.${normalizedLoginId}`)
            .order("updated_at", { ascending: false })
            .limit(1)
            .abortSignal(AbortSignal.timeout(PROFILE_QUERY_TIMEOUT_MS))
            .maybeSingle()
            .retry(false)

          data = profileByIdentity.data
          error = profileByIdentity.error
        }

        if (error || !data) {
          const fallbackRole = resolveFallbackRole(supabaseUser.email)
          return {
            user: createFallbackUser(supabaseUser, fallbackRole),
            authError: buildProfileResolutionMessage(Boolean(error)),
          }
        }

        return {
          user: {
            ...supabaseUser,
            ...data,
            name: data.name || getFallbackName(supabaseUser),
            role: normalizeDashboardRole(data.role || "viewer"),
            loginId:
              data.login_id ||
              (supabaseUser.email?.includes("@")
                ? supabaseUser.email.split("@")[0]
                : supabaseUser.email || ""),
            teacherCatalogId: data.teacher_catalog_id || "",
            mustChangePassword:
              shouldForcePasswordChange(data) || shouldForcePasswordChange(supabaseUser),
            isFallbackRole: false,
          },
          authError: null,
        }
      } catch (error) {
        console.error("Auth: profile fetch error", error)
        const fallbackRole = resolveFallbackRole(supabaseUser.email)
        return {
          user: createFallbackUser(supabaseUser, fallbackRole),
          authError: buildProfileResolutionMessage(true),
        }
      }
    }

    const applyResolvedProfile = (resolvedProfile: ResolvedDashboardProfile) => {
      if (!isActive || !authResolutionRef.current.markResolvedProfile(resolvedProfile)) return

      setUser(resolvedProfile.user)
      setAuthError(resolvedProfile.authError)
      setLoading(false)
    }

    const applyResolvedUser = async (
      nextSession: Session | null,
      resolution: AuthResolutionToken,
      event: string,
    ) => {
      if (!isActive || !authResolutionRef.current.isCurrent(resolution)) return
      const { sessionKey } = resolution

      if (sessionKey === "anonymous") {
        resetAnonymousSession(resolution)
        return
      }

      if (!nextSession) {
        setLoading(false)
        return
      }

      setSession(nextSession)

      const shouldRefreshProfile = event === "USER_UPDATED"
      const canReuseResolvedProfile = authResolutionRef.current.canReuseResolvedProfile(sessionKey)
      if (!shouldRefreshProfile && canReuseResolvedProfile) {
        setLoading(false)
        return
      }

      if (!canReuseResolvedProfile) {
        setUser(null)
        setAuthError(null)
        setLoading(true)
      }

      const requestKey = shouldRefreshProfile
        ? `${sessionKey}:user-updated:${resolution.generation}`
        : sessionKey
      const inflight = profileRequestRef.current
      if (inflight.key === requestKey && inflight.promise) {
        const resolvedProfile = { ...(await inflight.promise), ...resolution }
        applyResolvedProfile(resolvedProfile)
        return
      }

      const profilePromise = resolveDashboardProfile(nextSession.user).finally(() => {
        if (profileRequestRef.current.key === requestKey) {
          profileRequestRef.current = { key: "", promise: null }
        }
      })

      profileRequestRef.current = { key: requestKey, promise: profilePromise }
      const resolvedProfile = { ...(await profilePromise), ...resolution }
      applyResolvedProfile(resolvedProfile)
    }

    if (!supabase) {
      return undefined
    }

    const client = supabase
    const authResolution = authResolutionRef.current
    const initialSnapshot = authResolution.captureSnapshot()

    loadInitialAuthSession(client)
      .then(async ({ data, error }) => {
        if (!isActive || !authResolution.isSnapshotCurrent(initialSnapshot)) return
        if (error) {
          if (isStaleRefreshTokenError(error)) {
            await client.auth.signOut({ scope: "local" })
            if (!isActive) return
            if (!authResolution.isSnapshotCurrent(initialSnapshot)) return
            const resolution = authResolution.begin("anonymous")
            resetAnonymousSession(resolution)
            return
          }
          setAuthError(getAuthErrorMessage(error, "로그인 상태를 확인하지 못했습니다."))
          setLoading(false)
          return
        }
        const resolution = authResolution.begin(getSessionKey(data.session))
        await applyResolvedUser(data.session, resolution, "INITIAL_SESSION")
      })
      .catch((error) => {
        if (!isActive || !authResolution.isSnapshotCurrent(initialSnapshot)) return
        setAuthError(getAuthErrorMessage(error, "로그인 상태를 확인하지 못했습니다."))
        setLoading(false)
      })

    let subscription: ReturnType<typeof client.auth.onAuthStateChange>["data"]["subscription"] | null = null
    const authSubscriptionTimer = setTimeout(() => {
      if (!isActive) return
      const result = client.auth.onAuthStateChange((event, nextSession) => {
        setTimeout(() => {
          if (!isActive) return
          const resolution = authResolution.begin(getSessionKey(nextSession))
          void applyResolvedUser(nextSession, resolution, event)
        }, 0)
      })
      subscription = result.data.subscription
    }, 0)

    return () => {
      isActive = false
      clearTimeout(authSubscriptionTimer)
      subscription?.unsubscribe()
    }
  }, [])

  const role = normalizeDashboardRole(user?.role)
  const isAdmin = role === "admin"
  const isStaff = role === "staff" || role === "admin"
  const isTeacher = role === "teacher"
  const isAssistant = role === "assistant"
  const capabilities = getRoleCapabilities(role)
  const mustChangePassword = shouldForcePasswordChange(user || undefined)

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      role,
      isAdmin,
      isStaff,
      isTeacher,
      isAssistant,
      loading,
      authError,
      mustChangePassword,
      ...capabilities,
      login: async (identifier: string, password: string) => {
        if (!supabase) {
          throw new Error(supabaseConfigError || "지금은 Supabase에 연결할 수 없습니다.")
        }

        setAuthError(null)
        const normalizedEmail = normalizeEmail(identifier)
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        })

        if (error) {
          throw error
        }

        return true
      },
      logout: async () => {
        if (!supabase) {
          return false
        }

        const { error } = await supabase.auth.signOut()
        if (error) {
          setAuthError(getAuthErrorMessage(error, "로그아웃에 실패했습니다."))
          return false
        }

        return true
      },
    }),
    [authError, capabilities, isAdmin, isStaff, isTeacher, isAssistant, loading, mustChangePassword, role, session, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return context
}
