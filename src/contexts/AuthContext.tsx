import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  sendOtpCode: (email: string) => Promise<{ error: Error | null }>;
  verifyOtpCode: (email: string, token: string) => Promise<{ error: Error | null }>;
  signInWithPassword: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUpWithPassword: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const REMEMBER_KEY = 'gvb_playbook_session_30d';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function touchRememberSession() {
  const expiry = Date.now() + THIRTY_DAYS_MS;
  localStorage.setItem(REMEMBER_KEY, String(expiry));
}

export function checkRememberSessionExpired(): boolean {
  const expiryStr = localStorage.getItem(REMEMBER_KEY);
  if (!expiryStr) return false;
  const expiry = Number(expiryStr);
  return !isNaN(expiry) && Date.now() > expiry;
}

export function clearRememberSession() {
  localStorage.removeItem(REMEMBER_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // If 30-day session window has expired after 30 days of inactivity, sign out
    if (checkRememberSessionExpired()) {
      clearRememberSession();
      supabase.auth.signOut().then(() => {
        setSession(null);
        setUser(null);
        setLoading(false);
      });
      return;
    }

    // Set up auth state listener BEFORE checking session
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          touchRememberSession(); // Rolling 30 days on active usage
        }
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        touchRememberSession();
      }
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const sendOtpCode = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth`,
      },
    });
    return { error };
  };

  const verifyOtpCode = async (email: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    return { error };
  };

  const signInWithPassword = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUpWithPassword = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    clearRememberSession();
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ user, session, loading, sendOtpCode, verifyOtpCode, signInWithPassword, signUpWithPassword, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
