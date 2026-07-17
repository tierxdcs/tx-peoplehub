'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';
import { Employee } from './types';

/**
 * Is the current user a designated Project Manager? Reads their own employee
 * record and checks isProjectManager. Used only for UI gating (the "Create
 * Project Kickoff" button); the backend (ProjectKickoffAccessService) remains
 * the real enforcement boundary. SUPER_ADMIN is handled at call sites (always a
 * PM), so this hook only resolves the designation flag itself.
 */
export function useIsProjectManager(): {
  isProjectManager: boolean;
  loading: boolean;
} {
  const { user, loading: authLoading } = useAuth();
  const [isProjectManager, setIsProjectManager] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIsProjectManager(false);
      setLoading(false);
      return;
    }
    apiFetch<Employee>(`/employees/${user.sub}`)
      .then((emp) => setIsProjectManager(emp.isProjectManager === true))
      .catch(() => setIsProjectManager(false))
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  return { isProjectManager, loading: authLoading || loading };
}
