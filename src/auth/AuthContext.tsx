import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  AuthUser,
  clearAuthSession,
  installAuthFetchInterceptor,
  loadCurrentUser,
  loginUser,
  logoutUser,
  readStoredUser,
  registerUser,
  setAuthSession
} from '../api/auth';

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (payload: { username: string; email?: string; displayName?: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function clearWorkspaceCache() {
  localStorage.removeItem('vn_project');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    installAuthFetchInterceptor();

    let cancelled = false;
    loadCurrentUser()
      .then(currentUser => {
        if (cancelled) return;
        if (currentUser) {
          setUser(currentUser);
        } else {
          clearAuthSession();
          setUser(null);
        }
      })
      .catch(() => {
        clearAuthSession();
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const handleExpired = () => {
      clearAuthSession();
      clearWorkspaceCache();
      setUser(null);
    };
    window.addEventListener('vn-auth-expired', handleExpired);
    return () => {
      cancelled = true;
      window.removeEventListener('vn-auth-expired', handleExpired);
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    login: async (identifier, password) => {
      const response = await loginUser({ identifier, password });
      setAuthSession(response);
      clearWorkspaceCache();
      setUser(response.user);
    },
    register: async payload => {
      const response = await registerUser(payload);
      setAuthSession(response);
      clearWorkspaceCache();
      setUser(response.user);
    },
    logout: async () => {
      try {
        await logoutUser();
      } catch {
        // Local logout should still succeed if the backend is offline.
      }
      clearAuthSession();
      clearWorkspaceCache();
      setUser(null);
    }
  }), [loading, user]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
