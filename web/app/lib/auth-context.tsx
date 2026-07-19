'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  apiFetch,
  ApiError,
  refreshAccessToken,
  setAccessToken,
} from './api';
import { decodeAccessToken, DecodedAccessToken } from './jwt';

interface AuthContextValue {
  user: DecodedAccessToken | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Adopt a freshly-issued access token (e.g. the one change-password returns
   * after clearing mustChangePassword + bumping tokenVersion) and re-derive the
   * user from it. Keeps the in-memory token and decoded user in lockstep.
   */
  applyAccessToken: (token: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<DecodedAccessToken | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    refreshAccessToken()
      .then((token) => {
        setUser(token ? decodeAccessToken(token) : null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const { accessToken } = await apiFetch<{ accessToken: string }>(
        '/auth/login',
        { method: 'POST', body: JSON.stringify({ email, password }) },
        { skipRetry: true },
      );
      setAccessToken(accessToken);
      setUser(decodeAccessToken(accessToken));
    } catch (err) {
      if (err instanceof ApiError) {
        throw new Error('Invalid email or password');
      }
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' }, { skipRetry: true });
    setAccessToken(null);
    setUser(null);
  }, []);

  const applyAccessToken = useCallback((token: string) => {
    setAccessToken(token);
    setUser(decodeAccessToken(token));
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, applyAccessToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export function roleHome(role: DecodedAccessToken['role']): string {
  switch (role) {
    case 'SUPER_ADMIN':
    case 'ADMIN':
      return '/admin/employees';
    case 'MANAGER':
      return '/team';
    case 'EMPLOYEE':
      return '/profile';
  }
}
