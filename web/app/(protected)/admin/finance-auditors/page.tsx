'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import {
  SCard,
  SCardTitle,
  SIGNAL_FAINT,
  SIGNAL_MUTED,
  SIGNAL_ROW_DIVIDER,
  SignalHeader,
  SignalPage,
} from '../../../components/ui/signal';
import { cn } from '../../../lib/utils';
import { useToast } from '../../../components/ui/toaster';

type Grant = {
  employeeId: string;
  isActive: boolean;
  expiresAt?: string;
  grantedAt: string;
  employee: { employeeId: string; firstName: string; lastName: string; email: string; status: string } | null;
};

export default function FinanceAuditorsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const load = () => apiFetch<Grant[]>('/finance/reporting/auditors').then(setGrants);
  useEffect(() => { if (user?.role === 'SUPER_ADMIN') load().catch(fail); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Operation failed');
  async function grant(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/finance/reporting/auditors', { method: 'POST', body: JSON.stringify({ employeeId, expiresAt: expiresAt || undefined }) });
      setEmployeeId(''); setExpiresAt(''); toast.success('Read-only auditor access granted'); await load();
    } catch (e) { fail(e); }
  }
  async function revoke(id: string) {
    try { await apiFetch(`/finance/reporting/auditors/${id}/revoke`, { method: 'POST', body: '{}' }); toast.success('Auditor access revoked'); await load(); }
    catch (e) { fail(e); }
  }
  if (user?.role !== 'SUPER_ADMIN') return null;
  return <SignalPage>
    <SignalHeader title="Finance Auditors" description="The CEO controls time-bound, read-only access to executive finance reports" />
    <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
    <SCard className="px-5 py-[18px]">
      <form className="grid gap-3 md:grid-cols-3" onSubmit={grant}>
        <Input required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="Employee record ID" />
        <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        <Button type="submit">Grant read-only access</Button>
      </form>
      <p className={cn('mt-2 text-[11.5px]', SIGNAL_MUTED)}>Use the employee record UUID. Expiry is optional; auditors cannot create, submit, approve, post, or modify finance records.</p>
    </SCard>
    <SCard className="px-5 py-[18px]">
      <SCardTitle title="Access register" />
      <div className="mt-2">
      {grants.map((g) => <div key={g.employeeId} className={cn('flex flex-wrap items-center justify-between gap-2 border-b py-3 text-[12.5px]', SIGNAL_ROW_DIVIDER)}>
        <span><b className="font-semibold">{g.employee ? `${g.employee.firstName} ${g.employee.lastName}` : g.employeeId}</b>{g.employee ? ` · ${g.employee.email}` : ''} · {g.isActive ? 'ACTIVE' : 'REVOKED'}{g.expiresAt ? ` · expires ${g.expiresAt.slice(0, 10)}` : ''}</span>
        {g.isActive && <Button size="sm" onClick={() => revoke(g.employeeId)}>Revoke</Button>}
      </div>)}
      {!grants.length && <p className={cn('text-[12.5px]', SIGNAL_FAINT)}>No auditor grants created.</p>}
      </div>
    </SCard>
    </div>
  </SignalPage>;
}
