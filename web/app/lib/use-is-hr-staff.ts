'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';
import { Vertical } from './types';

/**
 * Client-side-only convenience check mirroring the backend's isHrStaff()
 * (see employees.service.ts) — used purely for nav/route gating. The
 * backend remains the actual enforcement boundary regardless of this hook.
 *
 * Uses GET /verticals/me (readable by any authenticated user) rather than
 * the ADMIN-only GET /verticals list — otherwise this 403s for the very
 * HR-vertical Manager/Employee it's meant to detect, silently hiding the
 * HR nav from real HR staff.
 */
export function useIsHrStaff(): { isHrStaff: boolean; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const [isHrStaff, setIsHrStaff] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    const isManagerOrEmployee =
      user?.role === 'MANAGER' || user?.role === 'EMPLOYEE';
    if (!user || !isManagerOrEmployee || !user.verticalId) {
      setIsHrStaff(false);
      setLoading(false);
      return;
    }

    apiFetch<Vertical | null>('/verticals/me')
      .then((vertical) => {
        setIsHrStaff(vertical?.code === 'HR');
      })
      .catch(() => setIsHrStaff(false))
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  return { isHrStaff, loading: authLoading || loading };
}
