'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';
import { Employee } from './types';

/**
 * Is the current user a designated QC Inspector (or SUPER_ADMIN, who is always
 * implicitly one)? Reads their own employee record and checks isQcInspector.
 * Used only for UI gating (the QC Inspection screen + its action); the backend
 * (GrnAccessService) remains the real enforcement boundary.
 */
export function useIsQcInspector(): { isQcInspector: boolean; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const [isQcInspector, setIsQcInspector] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIsQcInspector(false);
      setLoading(false);
      return;
    }
    if (user.role === 'SUPER_ADMIN') {
      setIsQcInspector(true);
      setLoading(false);
      return;
    }
    apiFetch<Employee>(`/employees/${user.sub}`)
      .then((emp) => setIsQcInspector(emp.isQcInspector === true))
      .catch(() => setIsQcInspector(false))
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  return { isQcInspector, loading: authLoading || loading };
}
