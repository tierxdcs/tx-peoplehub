'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Factory } from 'lucide-react';
import { ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import {
  listVendors,
  VENDOR_STATUS_LABEL,
  type Vendor,
  type VendorStatus,
} from '../../../lib/scm';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { StatusBadge } from '../../../components/ui/status-badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { NewVendorDialog } from './_components/new-vendor-dialog';

const STATUSES: VendorStatus[] = [
  'PENDING_QUESTIONNAIRE',
  'QUESTIONNAIRE_SUBMITTED',
  'UNDER_AUDIT',
  'APPROVED_PREFERRED',
  'APPROVED',
  'CONDITIONALLY_APPROVED',
  'NOT_APPROVED',
];

/**
 * Vendor list (spec §3). Company-wide read; "New Vendor" is shown to
 * SCM-vertical Manager+/SuperAdmin (the button; the backend is the real gate).
 */
export default function VendorsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<VendorStatus | ''>('');
  const [creating, setCreating] = useState(false);

  // UI hint only — the button shows for SUPER_ADMIN or a MANAGER (the backend
  // enforces SCM-vertical). We can't see vertical code here, so a non-SCM
  // manager may see the button and get a 403 on submit (surfaced as a toast).
  const canCreate =
    user?.role === 'SUPER_ADMIN' || user?.role === 'MANAGER';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setVendors(await listVendors());
    } catch {
      setError('Failed to load vendors.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => (statusFilter ? vendors.filter((s) => s.status === statusFilter) : vendors),
    [vendors, statusFilter],
  );

  return (
    <PageContainer>
      <PageHeader
        title="Vendors"
        description="Vendor master and qualification status."
        action={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>+ New Vendor</Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as VendorStatus | '')}
          className="h-9 w-56"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {VENDOR_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-28" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="p-0">
                    <EmptyState
                      icon={Factory}
                      title="No vendors yet"
                      description={
                        canCreate
                          ? 'Add a vendor to start the qualification process.'
                          : 'Vendors will appear here once added by the SCM team.'
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/scm/vendors/${s.id}`)}
                  >
                    <TableCell className="font-medium">{s.companyName}</TableCell>
                    <TableCell>
                      <StatusBadge value={s.status} />
                    </TableCell>
                    <TableCell>{s.contactPersonName}</TableCell>
                    <TableCell>
                      {new Date(s.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {creating && (
        <NewVendorDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/scm/vendors/${id}`)}
        />
      )}
    </PageContainer>
  );
}
