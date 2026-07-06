'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';
import { Vertical } from './types';

/**
 * Client-side-only convenience check for nav/route gating: is the current
 * user a SALES-vertical MANAGER/EMPLOYEE? Uses GET /verticals/me (readable
 * by any authenticated user) rather than the ADMIN-only GET /verticals, so
 * it works for the very Sales staff it's meant to detect. The backend
 * remains the actual enforcement boundary regardless of this hook.
 */
export function useIsSalesStaff(): { isSalesStaff: boolean; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const [isSalesStaff, setIsSalesStaff] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    const isManagerOrEmployee =
      user?.role === 'MANAGER' || user?.role === 'EMPLOYEE';
    if (!user || !isManagerOrEmployee || !user.verticalId) {
      setIsSalesStaff(false);
      setLoading(false);
      return;
    }

    apiFetch<Vertical | null>('/verticals/me')
      .then((vertical) => {
        setIsSalesStaff(vertical?.code === 'SALES');
      })
      .catch(() => setIsSalesStaff(false))
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  return { isSalesStaff, loading: authLoading || loading };
}
