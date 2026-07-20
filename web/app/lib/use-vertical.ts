'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';
import { Vertical } from './types';

/**
 * The current user's vertical (via GET /verticals/me, readable by any
 * authenticated user) — used to pick which process-flow overview the dashboard
 * shows. Returns the full Vertical (or null: SUPER_ADMIN / no vertical). Mirrors
 * the use-is-*-staff hooks but returns the record rather than a boolean.
 */
export function useVertical(): { vertical: Vertical | null; loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const [vertical, setVertical] = useState<Vertical | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !user.verticalId) {
      setVertical(null);
      setLoading(false);
      return;
    }
    apiFetch<Vertical | null>('/verticals/me')
      .then((v) => setVertical(v))
      .catch(() => setVertical(null))
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  return { vertical, loading: authLoading || loading };
}
