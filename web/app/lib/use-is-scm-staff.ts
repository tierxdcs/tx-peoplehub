'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';
import { Vertical } from './types';

/**
 * Client-side-only nav/route gating: is the current user SCM staff? SCM is the
 * procurement function (Vendors, Suppliers, Purchase Orders). Uses GET
 * /verticals/me (readable by any authenticated user), like the other
 * use-is-*-staff hooks. The backend remains the actual enforcement boundary
 * (e.g. PurchasingAccessService gates PO create to SCM Manager+/SA).
 */
export function useIsScmStaff(): { isScmStaff: boolean; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const [isScmStaff, setIsScmStaff] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    const isManagerOrEmployee =
      user?.role === 'MANAGER' || user?.role === 'EMPLOYEE';
    if (!user || !isManagerOrEmployee || !user.verticalId) {
      setIsScmStaff(false);
      setLoading(false);
      return;
    }

    apiFetch<Vertical | null>('/verticals/me')
      .then((vertical) => {
        setIsScmStaff(vertical?.code === 'SCM');
      })
      .catch(() => setIsScmStaff(false))
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  return { isScmStaff, loading: authLoading || loading };
}
