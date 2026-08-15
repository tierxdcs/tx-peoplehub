'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';
import { Employee, Vertical } from './types';

/**
 * Client-side UI gate mirroring the backend's
 * SalesAccessService.canManageInternalOrders(): SUPER_ADMIN, a Sales- or
 * RND-vertical Manager/Employee, or any designated Project Manager may create
 * and manage internal orders. Used only to show/hide the "New Internal Order"
 * action — the backend stays the real enforcement boundary.
 */
export function useCanManageInternalOrders(): {
  canManage: boolean;
  loading: boolean;
} {
  const { user, loading: authLoading } = useAuth();
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setCanManage(false);
      setLoading(false);
      return;
    }
    if (user.role === 'SUPER_ADMIN') {
      setCanManage(true);
      setLoading(false);
      return;
    }
    // A Sales/RND vertical staffer needs their vertical code; a PM needs their
    // employee flag. Fetch both, tolerate either failing (→ not eligible).
    Promise.all([
      apiFetch<Vertical | null>('/verticals/me').catch(() => null),
      apiFetch<Employee>(`/employees/${user.sub}`).catch(() => null),
    ])
      .then(([vertical, emp]) => {
        const isManagerOrEmployee =
          user.role === 'MANAGER' || user.role === 'EMPLOYEE';
        const inSalesOrRnd =
          isManagerOrEmployee &&
          (vertical?.code === 'SALES' || vertical?.code === 'RND');
        const isPm = emp?.isProjectManager === true;
        setCanManage(inSalesOrRnd || isPm);
      })
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  return { canManage, loading: authLoading || loading };
}
