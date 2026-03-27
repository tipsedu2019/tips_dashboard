import { createClient } from '@supabase/supabase-js';

function trimEnvValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseFallbackEmails(rawValue, defaults = []) {
  if (typeof rawValue === 'string') {
    return rawValue
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return defaults;
}

const supabaseUrl = trimEnvValue(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = trimEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY);

export const fallbackAdminEmails = parseFallbackEmails(
  import.meta.env.VITE_FALLBACK_ADMIN_EMAILS,
  ['admin@tipsedu.co.kr', 'admin@tips.com', 'yeoyuasset@naver.com']
);

export const fallbackStaffEmails = parseFallbackEmails(
  import.meta.env.VITE_FALLBACK_STAFF_EMAILS,
  ['staff@tipsedu.co.kr', 'tipsacademy@naver.com']
);

export const fallbackTeacherEmails = parseFallbackEmails(
  import.meta.env.VITE_FALLBACK_TEACHER_EMAILS,
  ['teacher@tipsedu.co.kr', 'teacher@tips.com', 'tipsedu@naver.com']
);

export const supabaseConfigError = !supabaseUrl || !supabaseAnonKey
  ? 'Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  : null;

export const isSupabaseConfigured = !supabaseConfigError;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
