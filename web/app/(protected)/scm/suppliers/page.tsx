'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Boxes } from 'lucide-react';
import { useAuth } from '../../../lib/auth-context';
import {
  listSuppliers,
  SUPPLIER_STATUS_LABEL,
  type Supplier,
  type SupplierStatus,
} from '../../../lib/scm-supplier';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { StatusBadge } from '../../../components/ui/status-badge';
import { OverrideTag } from '../../../components/ui/override-tag';
import { EmptyState } from '../../../components/ui/empty-state';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { useRegisterList } from '../../../lib/use-register-list';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { NewSupplierDialog } from './_components/new-supplier-dialog';

const STATUSES: SupplierStatus[] = [
  'PENDING_QUESTIONNAIRE',
  'QUESTIONNAIRE_SUBMITTED',
  'UNDER_AUDIT',
  'APPROVED_PREFERRED',
  'APPROVED',
  'CONDITIONALLY_APPROVED',
  'NOT_APPROVED',
];

/**
 * Supplier list (spec §2) — raw-materials suppliers, distinct from Vendors.
 * Company-wide read; "New Supplier" is shown to SCM-vertical Manager+/SuperAdmin
 * (the button; the backend is the real gate).
 */
export default function SuppliersPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<SupplierStatus | ''>('');
  const [creating, setCreating] = useState(false);

  // UI hint only — the button shows for SUPER_ADMIN or a MANAGER (the backend
  // enforces SCM-vertical). A non-SCM manager may see the button and get a 403
  // on submit (surfaced as a toast).
  const canCreate = user?.role === 'SUPER_ADMIN' || user?.role === 'MANAGER';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSuppliers(await listSuppliers());
    } catch {
      setError('Failed to load suppliers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      statusFilter
        ? suppliers.filter((s) => s.status === statusFilter)
        : suppliers,
    [suppliers, statusFilter],
  );
  const register = useRegisterList(filtered, (supplier) => `${supplier.companyName} ${supplier.status} ${supplier.contactPersonName ?? ''} ${supplier.contactEmail}`);

  return (
    <PageContainer>
      <PageHeader
        title="Suppliers"
        description="Raw-materials supplier master and qualification status."
        action={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>+ New Supplier</Button>
          ) : undefined
        }
      />

      <RegisterToolbar title="Supplier Register" search={register.search} onSearchChange={register.setSearch} searchPlaceholder="Search supplier, contact or status" filters={<Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as SupplierStatus | '')}
          className="h-9 w-56"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {SUPPLIER_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>} />

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
              ) : register.visibleItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="p-0">
                    <EmptyState
                      icon={Boxes}
                      title="No suppliers yet"
                      description={
                        canCreate
                          ? 'Add a supplier to start the qualification process.'
                          : 'Suppliers will appear here once added by the SCM team.'
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                register.visibleItems.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/scm/suppliers/${s.id}`)}
                  >
                    <TableCell className="font-medium">{s.companyName}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge value={s.status} />
                        {s.statusOverridden && <OverrideTag />}
                      </div>
                    </TableCell>
                    <TableCell>{s.contactPersonName ?? '—'}</TableCell>
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
      <RegisterPagination page={register.page} pageCount={register.pageCount} onPageChange={register.setPage} disabled={loading} />

      {creating && (
        <NewSupplierDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/scm/suppliers/${id}`)}
        />
      )}
    </PageContainer>
  );
}
