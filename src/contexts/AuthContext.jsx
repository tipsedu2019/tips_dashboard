import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  fallbackAdminEmails,
  fallbackStaffEmails,
  fallbackTeacherEmails,
  supabase,
  supabaseConfigError,
} from '../lib/supabase';

const AuthContext = createContext(null);

function normalizeEmail(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  if (!normalized) {
    return '';
  }

  return normalized.includes('@') ? normalized : `${normalized}@tips.com`;
}

function createFallbackSet(values) {
  return new Set(
    (values || [])
      .map((value) => normalizeEmail(value))
      .filter(Boolean)
  );
}

const fallbackAdminSet = createFallbackSet(fallbackAdminEmails);
const fallbackStaffSet = createFallbackSet(fallbackStaffEmails);
const fallbackTeacherSet = createFallbackSet(fallbackTeacherEmails);

function resolveFallbackRole(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return 'viewer';
  }

  if (fallbackAdminSet.has(normalizedEmail)) {
    return 'admin';
  }

  if (fallbackStaffSet.has(normalizedEmail)) {
    return 'staff';
  }

  if (fallbackTeacherSet.has(normalizedEmail)) {
    return 'teacher';
  }

  return 'viewer';
}

function getFallbackName(supabaseUser) {
  const email = supabaseUser?.email || '';
  const localName = email.includes('@') ? email.split('@')[0] : email;

  return (
    supabaseUser?.user_metadata?.name ||
    supabaseUser?.user_metadata?.full_name ||
    localName ||
    '사용자'
  );
}

function createFallbackUser(supabaseUser, role) {
  return {
    ...supabaseUser,
    id: supabaseUser?.id,
    email: supabaseUser?.email || '',
    name: getFallbackName(supabaseUser),
    role,
    isFallbackRole: true,
  };
}

function buildReadonlyMessage(hasProfileError) {
  return hasProfileError
    ? '프로필을 불러오지 못해 읽기 전용 권한으로 전환했습니다.'
    : '프로필 정보가 없어 읽기 전용 권한으로 접속했습니다.';
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    let isActive = true;

    if (!supabase) {
      setAuthError(supabaseConfigError);
      setLoading(false);
      return undefined;
    }

    const applyResolvedUser = async (nextSession) => {
      if (!isActive) {
        return;
      }

      setSession(nextSession);

      if (!nextSession?.user) {
        setUser(null);
        setAuthError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      await fetchProfile(nextSession.user, () => isActive, setUser, setAuthError, setLoading);
    };

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!isActive) {
          return;
        }

        if (error) {
          console.error('Error getting session:', error);
          setAuthError(error.message);
          setLoading(false);
          return;
        }

        applyResolvedUser(data.session);
      })
      .catch((error) => {
        console.error('Critical session fetch error:', error);
        if (!isActive) {
          return;
        }

        setAuthError(error.message);
        setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      applyResolvedUser(nextSession);
    });

    const timeout = setTimeout(() => {
      if (isActive) {
        setLoading(false);
      }
    }, 5000);

    return () => {
      isActive = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const role = user?.role || 'viewer';
  const isAdmin = role === 'admin';
  const isStaff = role === 'staff' || role === 'admin';
  const isTeacher = role === 'teacher';

  const value = useMemo(
    () => ({
      session,
      user,
      role,
      isAdmin,
      isStaff,
      isTeacher,
      loading,
      authError,
      login: async (email, password) => {
        if (!supabase) {
          throw new Error(supabaseConfigError || '지금은 Supabase에 연결할 수 없습니다.');
        }

        setAuthError(null);
        const normalizedEmail = normalizeEmail(email);
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (error) {
          throw error;
        }

        return true;
      },
      logout: async () => {
        if (!supabase) {
          return false;
        }

        const { error } = await supabase.auth.signOut();
        if (error) {
          console.error('Logout error:', error);
          setAuthError(error.message);
          return false;
        }

        return true;
      },
    }),
    [authError, isAdmin, isStaff, isTeacher, loading, role, session, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function fetchProfile(supabaseUser, isStillActive, setUser, setAuthError, setLoading) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', supabaseUser.id)
      .maybeSingle();

    if (!isStillActive()) {
      return;
    }

    if (error || !data) {
      const fallbackRole = resolveFallbackRole(supabaseUser.email);
      const fallbackUser = createFallbackUser(supabaseUser, fallbackRole);

      setUser(fallbackUser);
      setAuthError(fallbackRole === 'viewer' ? buildReadonlyMessage(Boolean(error)) : null);

      if (error) {
        console.warn('Auth: profile fetch failed, using fallback role:', error);
      }

      return;
    }

    setUser({
      ...supabaseUser,
      ...data,
      name: data.name || getFallbackName(supabaseUser),
      role: data.role || 'viewer',
      isFallbackRole: false,
    });
    setAuthError(null);
  } catch (error) {
    if (!isStillActive()) {
      return;
    }

    console.error('Auth: critical profile fetch error:', error);
    const fallbackRole = resolveFallbackRole(supabaseUser.email);
    setUser(createFallbackUser(supabaseUser, fallbackRole));
    setAuthError(fallbackRole === 'viewer' ? buildReadonlyMessage(true) : null);
  } finally {
    if (isStillActive()) {
      setLoading(false);
    }
  }
}

export const useAuth = () => useContext(AuthContext);
