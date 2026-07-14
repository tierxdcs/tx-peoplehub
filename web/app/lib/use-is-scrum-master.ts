'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';
import { Employee } from './types';

/**
 * Is the current user a designated Scrum Master? Reads their own employee
 * record (GET /employees/:id allows self) and checks isScrumMaster. Used only
 * for UI gating (New Board button, list/label management); the backend
 * (KanbanAccessService) remains the real enforcement boundary. SUPER_ADMIN is
 * handled separately at call sites (they always manage), so this hook only
 * resolves the designation flag itself.
 */
export function useIsScrumMaster(): { isScrumMaster: boolean; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const [isScrumMaster, setIsScrumMaster] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIsScrumMaster(false);
      setLoading(false);
      return;
    }
    apiFetch<Employee>(`/employees/${user.sub}`)
      .then((emp) => setIsScrumMaster(emp.isScrumMaster === true))
      .catch(() => setIsScrumMaster(false))
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  return { isScrumMaster, loading: authLoading || loading };
}
