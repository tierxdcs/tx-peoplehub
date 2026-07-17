'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';
import { Employee } from './types';

/**
 * Is the current user a designated R&D Head? Reads their own employee record
 * and checks isRdHead. Used only for UI gating (the BOM approval-queue nav item
 * + approve/reject controls); the backend (BomAccessService) remains the real
 * enforcement boundary. Unlike the other capability hooks, SUPER_ADMIN is NOT
 * auto-treated as an R&D Head — technical BOM approval requires a real
 * designation (spec §1), so this hook resolves the flag as-is.
 */
export function useIsRndHead(): { isRndHead: boolean; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const [isRndHead, setIsRndHead] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIsRndHead(false);
      setLoading(false);
      return;
    }
    apiFetch<Employee>(`/employees/${user.sub}`)
      .then((emp) => setIsRndHead(emp.isRdHead === true))
      .catch(() => setIsRndHead(false))
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  return { isRndHead, loading: authLoading || loading };
}
