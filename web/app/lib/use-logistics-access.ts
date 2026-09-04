'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { useAuth } from './auth-context';

export type LogisticsAccessLevel = 'VIEW' | 'OPERATE';

export function useLogisticsAccess() {
  const { user, loading: authLoading } = useAuth();
  const [level, setLevel] = useState<LogisticsAccessLevel | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLevel(null);
      setLoading(false);
      return;
    }
    apiFetch<{ level: LogisticsAccessLevel | null }>('/logistics/otd/access', {
      cache: 'no-store',
    })
      .then((result) => setLevel(result.level))
      .catch(() => setLevel(null))
      .finally(() => setLoading(false));
  }, [authLoading, user]);
  return { logisticsAccessLevel: level, loading: authLoading || loading };
}
