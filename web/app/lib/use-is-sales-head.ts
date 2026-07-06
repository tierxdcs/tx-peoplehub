'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';
import { Employee } from './types';

/**
 * Is the current user the designated Sales Head? Reads their own employee
 * record (GET /employees/:id allows self) and checks isSalesHead. Used only
 * for nav gating of the assessment-approval queue; the backend remains the
 * real enforcement boundary. SUPER_ADMIN is handled separately in nav (they
 * always see the queue), so this hook only needs to resolve the designation.
 */
export function useIsSalesHead(): { isSalesHead: boolean; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const [isSalesHead, setIsSalesHead] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIsSalesHead(false);
      setLoading(false);
      return;
    }
    apiFetch<Employee>(`/employees/${user.sub}`)
      .then((emp) => setIsSalesHead(emp.isSalesHead === true))
      .catch(() => setIsSalesHead(false))
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  return { isSalesHead, loading: authLoading || loading };
}
