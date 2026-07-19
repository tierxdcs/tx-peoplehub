'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';
import { Vertical } from './types';

/**
 * Client-side-only nav/route gating: is the current user Store staff? The Store
 * team is modelled as the PRODUCTION vertical (see BomAccessService /
 * BOM_INVENTORY.md). Uses GET /verticals/me (readable by any authenticated
 * user), like the other use-is-*-staff hooks. The backend remains the actual
 * enforcement boundary regardless of this hook.
 */
export function useIsStoreStaff(): { isStoreStaff: boolean; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const [isStoreStaff, setIsStoreStaff] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    const isManagerOrEmployee =
      user?.role === 'MANAGER' || user?.role === 'EMPLOYEE';
    if (!user || !isManagerOrEmployee || !user.verticalId) {
      setIsStoreStaff(false);
      setLoading(false);
      return;
    }

    apiFetch<Vertical | null>('/verticals/me')
      .then((vertical) => {
        setIsStoreStaff(vertical?.code === 'PRODUCTION');
      })
      .catch(() => setIsStoreStaff(false))
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  return { isStoreStaff, loading: authLoading || loading };
}
