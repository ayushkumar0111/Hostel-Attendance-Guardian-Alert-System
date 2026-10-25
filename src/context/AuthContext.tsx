import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Profile, UserRole } from '../types/database';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  role: UserRole | null;
  isLoading: boolean;
  isConfigured: boolean;
  previewRole: UserRole | null;
  setPreviewRole: (role: UserRole | null) => void;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string, role?: UserRole) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [previewRole, setPreviewRole] = useState<UserRole | null>(null);
  const configured = isSupabaseConfigured();

  const fetchProfile = async (userId: string) => {
    if (!configured) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn('Profile fetch note:', error.message);
        return null;
      }
      return data as Profile;
    } catch (err) {
      console.warn('Error loading user profile:', err);
      return null;
    }
  };

  useEffect(() => {
    if (!configured) {
      setIsLoading(false);
      return;
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const userProfile = await fetchProfile(session.user.id);
        if (userProfile) {
          setProfile(userProfile);
          setRole(userProfile.role);
        } else {
          // Fallback to metadata if profile row trigger is processing
          const metaRole = (session.user.user_metadata?.role as UserRole) || 'student';
          setRole(metaRole);
        }
      }
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const userProfile = await fetchProfile(session.user.id);
        if (userProfile) {
          setProfile(userProfile);
          setRole(userProfile.role);
        } else {
          const metaRole = (session.user.user_metadata?.role as UserRole) || 'student';
          setRole(metaRole);
        }
      } else {
        setProfile(null);
        setRole(null);
      }
      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [configured]);

  const signIn = async (email: string, password: string) => {
    if (!configured) {
      return {
        error: new Error(
          'Supabase is not configured yet. Please provide valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env to enable real authentication.'
        ),
      };
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  };

  const signUp = async (email: string, password: string, fullName: string, targetRole: UserRole = 'student') => {
    if (!configured) {
      return {
        error: new Error(
          'Supabase is not configured yet. Please provide valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env to create real accounts.'
        ),
      };
    }
    // Public registrations are strictly enrolled as 'student' or 'guardian'
    // Warden and Administrator accounts must be created or promoted by an authorized administrator
    const assignedRole = targetRole === 'guardian' ? 'guardian' : 'student';

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: assignedRole,
        },
      },
    });
    return { error: error ? new Error(error.message) : null };
  };

  const signOut = async () => {
    if (configured) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    setRole(null);
    setPreviewRole(null);
  };

  // Enforce security: Authenticated non-admin accounts strictly retain their authorized role.
  // Preview role is permitted only for administrators auditing interfaces or unauthenticated inspection.
  const effectiveRole: UserRole | null = user
    ? (profile?.role === 'admin' ? (previewRole || profile?.role) : (profile?.role || role || 'student'))
    : (previewRole || role);

  const safeSetPreviewRole = (newRole: UserRole | null) => {
    if (user && profile?.role !== 'admin') {
      // Prevent privilege self-escalation
      return;
    }
    setPreviewRole(newRole);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        role: effectiveRole,
        isLoading,
        isConfigured: configured,
        previewRole,
        setPreviewRole: safeSetPreviewRole,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
