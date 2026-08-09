'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/ui/toaster';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import type { ProvisioningRequest } from '../../../components/provisioning/provisioning-types';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { EmptyState } from '../../../components/ui/empty-state';
import { ClipboardCheck } from 'lucide-react';
import { useRegisterList } from '../../../lib/use-register-list';

export default function ProvisioningApprovalsPage() {
  const [items, setItems] = useState<ProvisioningRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const register = useRegisterList(items, (r) => `${r.employee.firstName} ${r.employee.lastName} ${r.employee.employeeId} ${r.itemType.name} ${r.status}`);
  const load = useCallback(() => { setLoading(true); apiFetch<ProvisioningRequest[]>('/provisioning/pending-approval').then(setItems).catch(() => toast.error('Failed to load provisioning approvals')).finally(() => setLoading(false)); }, [toast]);
  useEffect(() => { void load(); }, [load]);
  async function approve(id: string) { try { await apiFetch(`/provisioning/requests/${id}/approve`, { method: 'POST' }); toast.success('Request approved'); load(); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Approval failed'); } }
  async function reject(id: string) { const comment = window.prompt('Rejection reason (required)')?.trim(); if (!comment) return; try { await apiFetch(`/provisioning/requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ comment }) }); toast.success('Request rejected'); load(); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Rejection failed'); } }
  return <PageContainer><PageHeader title="Provisioning Approvals" description="Approve onboarding items routed to you as vertical owner. Physical items continue to SCM; action items complete here." />
    <RegisterToolbar title="Approval Queue" search={register.search} onSearchChange={register.setSearch} searchPlaceholder="Search employee, item or status" />
    <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Item</TableHead><TableHead>Fulfillment</TableHead><TableHead>Requested</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
      {register.visibleItems.map((r) => <TableRow key={r.id}><TableCell className="font-medium">{r.employee.firstName} {r.employee.lastName}<span className="block text-xs text-muted-foreground">{r.employee.employeeId}</span></TableCell><TableCell>{r.itemType.name}</TableCell><TableCell>{r.itemType.requiresScmFulfillment ? 'SCM' : 'Direct'}</TableCell><TableCell>{new Date(r.createdAt).toLocaleDateString()}</TableCell><TableCell className="space-x-2 text-right"><Button size="sm" onClick={() => approve(r.id)}>Approve</Button><Button size="sm" variant="destructive" onClick={() => reject(r.id)}>Reject</Button></TableCell></TableRow>)}
      {!loading && !register.visibleItems.length && <TableRow><TableCell colSpan={5} className="p-0"><EmptyState icon={ClipboardCheck} title={register.search ? 'No matching provisioning requests' : 'No provisioning requests await your approval'} tone="positive" /></TableCell></TableRow>}
    </TableBody></Table></CardContent></Card><RegisterPagination page={register.page} pageCount={register.pageCount} onPageChange={register.setPage} disabled={loading} /></PageContainer>;
}
