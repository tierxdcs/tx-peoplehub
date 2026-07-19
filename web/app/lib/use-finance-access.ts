'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { apiFetch } from './api';

export interface FinanceAccess {
  isFinanceUser: boolean;
  isAccountsHead: boolean;
  isFinanceAuditor: boolean;
}

export function useFinanceAccess(): FinanceAccess & { loading: boolean } {
  const { user, loading: authLoading } = useAuth();
  const [access, setAccess] = useState<FinanceAccess>({
    isFinanceUser: false,
    isAccountsHead: false,
    isFinanceAuditor: false,
  });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    apiFetch<FinanceAccess>('/finance/access')
      .then(setAccess)
      .catch(() =>
        setAccess({
          isFinanceUser: false,
          isAccountsHead: false,
          isFinanceAuditor: false,
        }),
      )
      .finally(() => setLoading(false));
  }, [authLoading, user]);
  return { ...access, loading: authLoading || loading };
}
