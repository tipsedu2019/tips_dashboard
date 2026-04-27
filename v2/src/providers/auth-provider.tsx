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
import type { Session, User } from "@supabase/supabase-js"

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

type DashboardUser = User & {
  name?: string
  role?: DashboardRole
  loginId?: string
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
  loading: boolean
  authError: string | null
  mustChangePassword: boolean
  canAccessDashboard: boolean
  canManageAll: boolean
  canEditCurriculumPlanning: boolean
  canEditClassSchedulePlanning: boolean
  canEditClassSchedule: boolean
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<boolean>
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

function buildReadonlyMessage(hasProfileError: boolean) {
  return hasProfileError
    ? "프로필을 불러오지 못해 읽기 전용 권한으로 전환했습니다."
    : "프로필 정보가 없어 읽기 전용 권한으로 접속했습니다."
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<DashboardUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const lastResolvedSessionKeyRef = useRef("")
  const profileRequestRef = useRef<{ key: string; promise: Promise<void> | null }>({
    key: "",
    promise: null,
  })

  useEffect(() => {
    let isActive = true

    const getSessionKey = (nextSession: Session | null) => {
      if (!nextSession?.user?.id) {
        return "anonymous"
      }

      return `${nextSession.user.id}:${nextSession.expires_at || ""}`
    }

    const fetchProfile = async (supabaseUser: User) => {
      try {
        const { data, error } = await supabase!
          .from("profiles")
          .select("*")
          .eq("id", supabaseUser.id)
          .maybeSingle()

        if (!isActive) return

        if (error || !data) {
          const fallbackRole = resolveFallbackRole(supabaseUser.email)
          setUser(createFallbackUser(supabaseUser, fallbackRole))
          setAuthError(fallbackRole === "viewer" ? buildReadonlyMessage(Boolean(error)) : null)
          return
        }

        setUser({
          ...supabaseUser,
          ...data,
          name: data.name || getFallbackName(supabaseUser),
          role: normalizeDashboardRole(data.role || "viewer"),
          loginId:
            data.login_id ||
            (supabaseUser.email?.includes("@")
              ? supabaseUser.email.split("@")[0]
              : supabaseUser.email || ""),
          mustChangePassword:
            shouldForcePasswordChange(data) || shouldForcePasswordChange(supabaseUser),
          isFallbackRole: false,
        })
        setAuthError(null)
      } catch (error) {
        if (!isActive) return

        console.error("Auth: profile fetch error", error)
        const fallbackRole = resolveFallbackRole(supabaseUser.email)
        setUser(createFallbackUser(supabaseUser, fallbackRole))
        setAuthError(fallbackRole === "viewer" ? buildReadonlyMessage(true) : null)
      } finally {
        if (isActive) {
          setLoading(false)
        }
      }
    }

    const applyResolvedUser = async (nextSession: Session | null) => {
      const sessionKey = getSessionKey(nextSession)

      if (sessionKey === "anonymous") {
        if (lastResolvedSessionKeyRef.current === sessionKey) {
          setLoading(false)
          return
        }

        lastResolvedSessionKeyRef.current = sessionKey
        profileRequestRef.current = { key: "", promise: null }
        setSession(null)
        setUser(null)
        setAuthError(null)
        setLoading(false)
        return
      }

      if (!nextSession) {
        setLoading(false)
        return
      }

      if (lastResolvedSessionKeyRef.current === sessionKey) {
        const inflight = profileRequestRef.current
        if (inflight.key === sessionKey && inflight.promise) {
          return inflight.promise
        }

        setLoading(false)
        return
      }

      lastResolvedSessionKeyRef.current = sessionKey
      setSession(nextSession)
      setLoading(true)

      const profilePromise = fetchProfile(nextSession.user).finally(() => {
        if (profileRequestRef.current.key === sessionKey) {
          profileRequestRef.current = { key: "", promise: null }
        }
      })

      profileRequestRef.current = { key: sessionKey, promise: profilePromise }
      return profilePromise
    }

    if (!supabase) {
      setAuthError(supabaseConfigError)
      setLoading(false)
      return undefined
    }

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isActive) return
        if (error) {
          setAuthError(error.message)
          setLoading(false)
          return
        }
        void applyResolvedUser(data.session)
      })
      .catch((error) => {
        if (!isActive) return
        setAuthError(error.message)
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void applyResolvedUser(nextSession)
    })

    return () => {
      isActive = false
      subscription.unsubscribe()
    }
  }, [])

  const role = normalizeDashboardRole(user?.role)
  const isAdmin = role === "admin"
  const isStaff = role === "staff" || role === "admin"
  const isTeacher = role === "teacher"
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
      loading,
      authError,
      mustChangePassword,
      ...capabilities,
      login: async (email: string, password: string) => {
        if (!supabase) {
          throw new Error(supabaseConfigError || "지금은 Supabase에 연결할 수 없습니다.")
        }

        setAuthError(null)
        const normalizedEmail = normalizeEmail(email)
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
          setAuthError(error.message)
          return false
        }

        return true
      },
    }),
    [authError, capabilities, isAdmin, isStaff, isTeacher, loading, mustChangePassword, role, session, user],
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
