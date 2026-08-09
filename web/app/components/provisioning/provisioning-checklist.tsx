'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import type { ProvisioningRequest } from './provisioning-types';

export function ProvisioningChecklist({ employeeId }: { employeeId: string }) {
  const [items, setItems] = useState<ProvisioningRequest[]>([]);
  useEffect(() => { apiFetch<ProvisioningRequest[]>(`/provisioning/employee/${employeeId}`).then(setItems).catch(() => setItems([])); }, [employeeId]);
  return (
    <Card>
      <CardHeader><CardTitle>Provisioning Checklist</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Route</TableHead><TableHead>Status</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader>
          <TableBody>{items.map((r) => <TableRow key={r.id}><TableCell className="font-medium">{r.itemType.name}</TableCell><TableCell>{r.itemType.requiresScmFulfillment ? 'SCM fulfillment' : 'Approver action'}</TableCell><TableCell><Badge variant="secondary">{r.status.replaceAll('_', ' ')}</Badge>{r.rejectionComment && <p className="mt-1 text-xs text-destructive">{r.rejectionComment}</p>}</TableCell><TableCell>{new Date(r.fulfilledAt ?? r.completedAt ?? r.approvedAt ?? r.createdAt).toLocaleString()}</TableCell></TableRow>)}{items.length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Provisioning requests appear when access is granted.</TableCell></TableRow>}</TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
