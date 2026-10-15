import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { useToast } from './ToastProvider';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession);
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) toast(error.message);
      setSession(data?.session ?? null);
      setLoading(false);
    }).catch((error) => {
      if (active) {
        toast(error.message || 'We could not restore your session.');
        setLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [toast]);

  const signUp = useCallback(async ({ name, username, email, password }) => {
    if (!supabase) throw new Error('Add your Supabase URL and anon key to .env.local to enable authentication.');
    return supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, username },
        emailRedirectTo: `${window.location.origin}/`,
      },
    });
  }, []);

  const signIn = useCallback(async ({ email, password }) => {
    if (!supabase) throw new Error('Add your Supabase URL and anon key to .env.local to enable authentication.');
    return supabase.auth.signInWithPassword({ email, password });
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const resetPassword = useCallback(async (email) => {
    if (!supabase) throw new Error('Add your Supabase URL and anon key to .env.local to enable authentication.');
    return supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password?mode=update`,
    });
  }, []);

  const updatePassword = useCallback(async (password) => {
    if (!supabase) throw new Error('Add your Supabase URL and anon key to .env.local to enable authentication.');
    return supabase.auth.updateUser({ password });
  }, []);

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    loading,
    configured: isSupabaseConfigured,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
  }), [session, loading, signUp, signIn, signOut, resetPassword, updatePassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
