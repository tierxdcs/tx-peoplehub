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

export default function ProvisioningFulfillmentPage() {
  const [items, setItems] = useState<ProvisioningRequest[]>([]); const toast = useToast();
  const load = useCallback(() => apiFetch<ProvisioningRequest[]>('/provisioning/scm-queue').then(setItems).catch((e) => toast.error(e instanceof ApiError ? e.message : 'Failed to load queue')), [toast]);
  useEffect(() => { void load(); }, [load]);
  async function fulfill(id: string) { try { await apiFetch(`/provisioning/requests/${id}/fulfill`, { method: 'POST' }); toast.success('Item marked fulfilled'); load(); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Fulfillment failed'); } }
  return <PageContainer><PageHeader title="Employee Provisioning" description="Physical onboarding items approved and ready for SCM fulfillment." /><Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Item</TableHead><TableHead>Approved</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{items.map((r) => <TableRow key={r.id}><TableCell className="font-medium">{r.employee.firstName} {r.employee.lastName}<span className="block text-xs text-muted-foreground">{r.employee.employeeId}</span></TableCell><TableCell>{r.itemType.name}</TableCell><TableCell>{r.approvedAt ? new Date(r.approvedAt).toLocaleString() : '—'}</TableCell><TableCell className="text-right"><Button size="sm" onClick={() => fulfill(r.id)}>Mark Fulfilled</Button></TableCell></TableRow>)}{!items.length && <TableRow><TableCell colSpan={4} className="py-12 text-center text-muted-foreground">No physical items await fulfillment.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></PageContainer>;
}
