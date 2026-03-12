import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null); // { id, role, name, ...profile }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      console.error('Supabase client not initialized');
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) console.error('Error getting session:', error);
      setSession(session);
      if (session) {
        _fetchProfile(session.user);
      } else {
        setLoading(false);
      }
    }).catch(err => {
      console.error('Critical session fetch error:', err);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        _fetchProfile(session.user);
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    // Safety timeout: Ensure loading finishes even if Supabase hangs
    const timeout = setTimeout(() => {
      setLoading(prev => {
        if (prev) console.warn('Auth loading timed out');
        return false;
      });
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const _fetchProfile = async (supabaseUser) => {
    try {
      // Assuming a 'profiles' table exists with role and name
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', supabaseUser.id)
        .single();
      
      if (error) {
        console.warn('Profile fetch error (using fallback):', error);
        // Fallback or default role
        setUser({ id: supabaseUser.id, name: supabaseUser.email, role: 'viewer' });
      } else {
        setUser({ ...supabaseUser, ...data });
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
      setUser({ id: supabaseUser.id, name: supabaseUser.email, role: 'viewer' });
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return true;
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const role = user ? user.role : 'viewer';
  const isAdmin = role === 'admin';
  const isStaff = role === 'staff' || role === 'admin';
  const isTeacher = role === 'teacher';

  return (
    <AuthContext.Provider value={{
      session,
      user,
      role,
      isAdmin,
      isStaff,
      isTeacher,
      loading,
      login,
      logout
    }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
