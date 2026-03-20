import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  fallbackAdminEmails,
  fallbackStaffEmails,
  fallbackTeacherEmails,
  supabase,
  supabaseConfigError,
} from '../lib/supabase';
import { getE2ERole, isE2EModeEnabled } from '../testing/e2e/e2eMode';

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
  const lastResolvedSessionKeyRef = useRef('');
  const profileRequestRef = useRef({ key: '', promise: null });
  const loadingRef = useRef(true);

  useEffect(() => {
    let isActive = true;

    if (isE2EModeEnabled()) {
      const role = getE2ERole();
      const e2eUser = {
        id: 'e2e-user',
        email: `${role}@tips.test`,
        name: 'E2E Tester',
        role,
        isE2E: true,
      };
      lastResolvedSessionKeyRef.current = `e2e:${role}`;
      profileRequestRef.current = { key: '', promise: null };
      setSession({ user: e2eUser, expires_at: null });
      setUser(e2eUser);
      setAuthError(null);
      setLoading(false);
      loadingRef.current = false;
      return undefined;
    }

    const setLoadingState = (nextLoading) => {
      if (loadingRef.current === nextLoading) {
        return;
      }

      loadingRef.current = nextLoading;
      setLoading(nextLoading);
    };

    const getSessionKey = (nextSession) => {
      if (!nextSession?.user?.id) {
        return 'anonymous';
      }

      return `${nextSession.user.id}:${nextSession.expires_at || ''}`;
    };

    if (!supabase) {
      setAuthError(supabaseConfigError);
      setLoadingState(false);
      return undefined;
    }

    const applyResolvedUser = async (nextSession) => {
      if (!isActive) {
        return;
      }

      const sessionKey = getSessionKey(nextSession);

      if (sessionKey === 'anonymous') {
        profileRequestRef.current = { key: '', promise: null };

        if (lastResolvedSessionKeyRef.current === sessionKey) {
          setLoadingState(false);
          return;
        }

        lastResolvedSessionKeyRef.current = sessionKey;
        setSession((current) => (current === null ? current : null));
        setUser((current) => (current === null ? current : null));
        setAuthError((current) => (current === null ? current : null));
        setLoadingState(false);
        return;
      }

      if (lastResolvedSessionKeyRef.current === sessionKey) {
        const inflight = profileRequestRef.current;
        if (inflight.key === sessionKey && inflight.promise) {
          return inflight.promise;
        }

        setLoadingState(false);
        return;
      }

      lastResolvedSessionKeyRef.current = sessionKey;
      setSession((current) => (
        current?.user?.id === nextSession.user.id && current?.expires_at === nextSession.expires_at
          ? current
          : nextSession
      ));

      if (profileRequestRef.current.key === sessionKey && profileRequestRef.current.promise) {
        return profileRequestRef.current.promise;
      }

      setLoadingState(true);

      const profilePromise = fetchProfile(
        nextSession.user,
        () => isActive,
        setUser,
        setAuthError,
        setLoadingState
      ).finally(() => {
        if (profileRequestRef.current.key === sessionKey) {
          profileRequestRef.current = { key: '', promise: null };
        }
      });

      profileRequestRef.current = { key: sessionKey, promise: profilePromise };
      return profilePromise;
    };

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!isActive) {
          return;
        }

        if (error) {
          console.error('Error getting session:', error);
          setAuthError(error.message);
          setLoadingState(false);
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
        setLoadingState(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      applyResolvedUser(nextSession);
    });

    const timeout = setTimeout(() => {
      if (isActive) {
        setLoadingState(false);
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
        if (isE2EModeEnabled()) {
          const normalizedEmail = normalizeEmail(email) || `${getE2ERole()}@tips.test`;
          const nextRole = getE2ERole();
          const e2eUser = {
            id: 'e2e-user',
            email: normalizedEmail,
            name: 'E2E Tester',
            role: nextRole,
            isE2E: true,
          };
          setSession({ user: e2eUser, expires_at: null });
          setUser(e2eUser);
          setAuthError(null);
          setLoading(false);
          return true;
        }
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
        if (isE2EModeEnabled()) {
          return true;
        }
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
