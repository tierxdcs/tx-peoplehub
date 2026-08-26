'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';

/**
 * The single client-side gate for the whole Executive Dashboards section. Read
 * from the server (GET /executive/access) rather than the JWT, because the grant
 * is a per-employee flag that the CEO can change without the holder re-logging
 * in. A future Finance/Production dashboard reuses this hook as-is.
 */
export function useExecutiveAccess(): {
  hasExecutiveDashboardAccess: boolean;
  loading: boolean;
} {
  const { user, loading: authLoading } = useAuth();
  const [granted, setGranted] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    apiFetch<{ hasExecutiveDashboardAccess: boolean }>('/executive/access')
      .then((res) => setGranted(res.hasExecutiveDashboardAccess))
      .catch(() => setGranted(false))
      .finally(() => setLoading(false));
  }, [authLoading, user]);
  return { hasExecutiveDashboardAccess: granted, loading: authLoading || loading };
}
