'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';
import { Vertical } from './types';

/**
 * Client-side-only nav/route gating: is the current user R&D staff (the RND
 * vertical)? Gates the Engineering (BOM) nav group. Uses GET /verticals/me
 * (readable by any authenticated user), like the other use-is-*-staff hooks.
 * The backend (BomAccessService.assertCanBrowseBoms) remains the actual
 * enforcement boundary regardless of this hook.
 */
export function useIsRndStaff(): { isRndStaff: boolean; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const [isRndStaff, setIsRndStaff] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    const isManagerOrEmployee =
      user?.role === 'MANAGER' || user?.role === 'EMPLOYEE';
    if (!user || !isManagerOrEmployee || !user.verticalId) {
      setIsRndStaff(false);
      setLoading(false);
      return;
    }

    apiFetch<Vertical | null>('/verticals/me')
      .then((vertical) => {
        setIsRndStaff(vertical?.code === 'RND');
      })
      .catch(() => setIsRndStaff(false))
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  return { isRndStaff, loading: authLoading || loading };
}
