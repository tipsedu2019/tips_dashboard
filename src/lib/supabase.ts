import { createClient } from "@supabase/supabase-js"

function trimEnvValue(value: string | undefined) {
  return typeof value === "string" ? value.trim() : ""
}

function parseFallbackEmails(rawValue: string | undefined, defaults: string[] = []) {
  if (typeof rawValue === "string") {
    return rawValue
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  return defaults
}

const supabaseUrl = trimEnvValue(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
)
const supabaseAnonKey = trimEnvValue(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
)

export const fallbackAdminEmails = parseFallbackEmails(
  process.env.NEXT_PUBLIC_FALLBACK_ADMIN_EMAILS,
  ["admin@tipsedu.co.kr", "admin@tips.com", "yeoyuasset@naver.com"],
)

export const fallbackStaffEmails = parseFallbackEmails(
  process.env.NEXT_PUBLIC_FALLBACK_STAFF_EMAILS,
  ["staff@tipsedu.co.kr", "tipsacademy@naver.com"],
)

export const fallbackTeacherEmails = parseFallbackEmails(
  process.env.NEXT_PUBLIC_FALLBACK_TEACHER_EMAILS,
  ["teacher@tipsedu.co.kr", "teacher@tips.com", "tipsedu@naver.com"],
)

export const supabaseConfigError =
  !supabaseUrl || !supabaseAnonKey
    ? "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY or reuse the root VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY."
    : null

export const supabase = supabaseConfigError
  ? null
  : createClient(supabaseUrl, supabaseAnonKey)
