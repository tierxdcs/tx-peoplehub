'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { useToast } from '../../../components/ui/toaster';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Badge } from '../../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { EmptyState } from '../../../components/ui/empty-state';
import { ClipboardCheck } from 'lucide-react';
import type { EmploymentType } from '../../../lib/types';

type Requisition = { id: string; requisitionNumber: string; positionTitle: string; employmentType: string; justification: string; budgetAnnualCtc: string | null; targetJoiningDate: string | null; status: string; rejectionComment: string | null; createdAt: string; requestedBy: { employeeId: string; firstName: string; lastName: string }; vertical: { name: string; ownerId: string | null } };

export default function CandidateRequisitionsPage() {
  const { user } = useAuth(); const toast = useToast(); const { style: numberFormatStyle } = useNumberFormat();
  const [mine, setMine] = useState<Requisition[]>([]); const [queue, setQueue] = useState<Requisition[]>([]);
  const [positionTitle, setPositionTitle] = useState(''); const [employmentType, setEmploymentType] = useState<EmploymentType>('FULL_TIME_PERMANENT'); const [justification, setJustification] = useState(''); const [budgetAnnualCtc, setBudgetAnnualCtc] = useState(''); const [targetJoiningDate, setTargetJoiningDate] = useState('');
  const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const pageSize = 10;
  const canCreate = user && ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(user.role) && !!user.verticalId;
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const load = useCallback(async () => {
    if (!user) return;
    try {
      const pendingPath = isSuperAdmin ? '/candidate-requisitions/pending-superadmin' : '/candidate-requisitions/pending-vertical';
      const [pending, own] = await Promise.all([
        apiFetch<Requisition[]>(pendingPath),
        ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(user.role) ? apiFetch<Requisition[]>('/candidate-requisitions/mine') : Promise.resolve([]),
      ]);
      setQueue(pending); setMine(own);
    } catch { toast.error('Failed to load candidate requisitions'); }
  }, [isSuperAdmin, toast, user]);
  useEffect(() => { void load(); }, [load]);
  async function create(e: FormEvent) { e.preventDefault(); const budget = Number(budgetAnnualCtc); if (!(budget > 0)) { toast.error('Enter an annual CTC budget greater than zero'); return; } try { await apiFetch('/candidate-requisitions', { method: 'POST', body: JSON.stringify({ positionTitle, employmentType, justification, budgetAnnualCtc: budget, targetJoiningDate: targetJoiningDate || undefined }) }); setPositionTitle(''); setJustification(''); setBudgetAnnualCtc(''); setTargetJoiningDate(''); toast.success('Requisition submitted to the vertical owner'); load(); } catch (err) { toast.error(err instanceof ApiError ? err.message : 'Creation failed'); } }
  async function decide(r: Requisition, approve: boolean) { const stage = isSuperAdmin ? 'superadmin' : 'vertical'; let body: string | undefined; if (!approve) { const comment = window.prompt('Rejection reason (required)')?.trim(); if (!comment) return; body = JSON.stringify({ comment }); } try { await apiFetch(`/candidate-requisitions/${r.id}/${stage}-${approve ? 'approve' : 'reject'}`, { method: 'POST', ...(body ? { body } : {}) }); toast.success(approve ? (isSuperAdmin ? 'Requisition fully approved' : 'Sent to the CEO for final approval') : 'Requisition rejected'); load(); } catch (err) { toast.error(err instanceof ApiError ? err.message : 'Decision failed'); } }
  const matches = (r: Requisition) => `${r.requisitionNumber} ${r.positionTitle} ${r.status} ${r.requestedBy.firstName} ${r.requestedBy.lastName} ${r.vertical.name}`.toLowerCase().includes(search.trim().toLowerCase());
  const filteredQueue = queue.filter(matches); const filteredMine = mine.filter(matches); const pageCount = Math.max(1, Math.ceil(Math.max(filteredQueue.length, filteredMine.length) / pageSize));
  const pageItems = (items: Requisition[]) => items.slice((page - 1) * pageSize, page * pageSize);
  return <PageContainer><PageHeader title="Candidate Requisitions" description="Hiring authorization requires the vertical owner’s approval first, followed by CEO approval." />
    {canCreate && <Card><CardHeader><CardTitle>Request a position</CardTitle></CardHeader><CardContent><form onSubmit={create} className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Position title<Input className="mt-1" value={positionTitle} onChange={(e) => setPositionTitle(e.target.value)} required /></label><label className="text-sm font-medium">Employment type<Select className="mt-1" value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}><option value="FULL_TIME_PERMANENT">Full-time permanent</option><option value="PART_TIME">Part-time</option><option value="CONTRACT">Contract</option><option value="INTERN">Intern</option></Select></label><label className="text-sm font-medium">Target joining date<Input className="mt-1" type="date" value={targetJoiningDate} onChange={(e) => setTargetJoiningDate(e.target.value)} /></label><label className="text-sm font-medium">Annual CTC budget (₹)<Input className="mt-1" type="number" min={1} step="0.01" value={budgetAnnualCtc} onChange={(e) => setBudgetAnnualCtc(e.target.value)} placeholder="e.g. 1200000" required /></label><label className="text-sm font-medium sm:col-span-2">Business justification<Textarea className="mt-1" value={justification} onChange={(e) => setJustification(e.target.value)} rows={4} required /></label><div className="sm:col-span-2"><Button type="submit">Submit requisition</Button></div></form></CardContent></Card>}
    <RegisterToolbar title="Requisition Register" search={search} onSearchChange={(value) => { setSearch(value); setPage(1); }} searchPlaceholder="Search requester, position or status" />
    <RequisitionTable title={isSuperAdmin ? 'Awaiting final CEO approval' : 'Awaiting your vertical-owner approval'} items={pageItems(filteredQueue)} numberFormatStyle={numberFormatStyle} actions={(r) => <><Button size="sm" onClick={() => decide(r, true)}>Approve</Button><Button size="sm" variant="destructive" onClick={() => decide(r, false)}>Reject</Button></>} />
    {['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(user?.role ?? '') && <RequisitionTable title="My requisitions" items={pageItems(filteredMine)} numberFormatStyle={numberFormatStyle} />}
    <RegisterPagination page={page} pageCount={pageCount} onPageChange={setPage} />
  </PageContainer>;
}

function RequisitionTable({ title, items, numberFormatStyle, actions }: { title: string; items: Requisition[]; numberFormatStyle: 'india' | 'international'; actions?: (r: Requisition) => React.ReactNode }) {
  const colCount = actions ? 6 : 5;
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Requisition</TableHead><TableHead>Position</TableHead><TableHead>Requester</TableHead><TableHead className="text-right">Annual CTC budget</TableHead><TableHead>Status</TableHead>{actions && <TableHead className="text-right">Actions</TableHead>}</TableRow></TableHeader><TableBody>{items.map((r) => <TableRow key={r.id}><TableCell className="font-medium">{r.requisitionNumber}<span className="block text-xs text-muted-foreground">{r.vertical.name}</span></TableCell><TableCell>{r.positionTitle}<span className="block text-xs text-muted-foreground">{r.employmentType.replaceAll('_', ' ')}</span></TableCell><TableCell>{r.requestedBy.firstName} {r.requestedBy.lastName}</TableCell><TableCell className="text-right tabular-nums">{formatINR(r.budgetAnnualCtc, numberFormatStyle)}</TableCell><TableCell><Badge variant="secondary">{r.status.replaceAll('_', ' ')}</Badge>{r.rejectionComment && <p className="mt-1 text-xs text-destructive">{r.rejectionComment}</p>}</TableCell>{actions && <TableCell className="space-x-2 text-right">{actions(r)}</TableCell>}</TableRow>)}{!items.length && <TableRow><TableCell colSpan={colCount} className="p-0"><EmptyState icon={ClipboardCheck} title="No requisitions in this queue" tone="positive" /></TableCell></TableRow>}</TableBody></Table></CardContent></Card>;
}
