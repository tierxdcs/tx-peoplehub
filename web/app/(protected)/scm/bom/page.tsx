'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileStack } from 'lucide-react';
import { useAuth } from '../../../lib/auth-context';
import {
  BOM_STATUS_LABEL,
  listBoms,
  type Bom,
  type BomStatus,
} from '../../../lib/scm-bom';
import { ApiError } from '../../../lib/api';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { EmptyState } from '../../../components/ui/empty-state';
import { Skeleton } from '../../../components/ui/skeleton';
import { StatusBadge } from '../../../components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

const STATUSES: BomStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'REJECTED',
  'RELEASED',
  'OBSOLETE',
];

/**
 * BOM list (§3). Read is broad; "New BOM" is shown to MANAGER+/SA and the
 * backend enforces R&D-vertical authoring.
 */
export default function BomListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [boms, setBoms] = useState<Bom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<BomStatus | ''>('');

  const canManage =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN' ||
    user?.role === 'MANAGER';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBoms(await listBoms(statusFilter ? { status: statusFilter } : {}));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load BOMs.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageContainer>
      <PageHeader
        title="Bills of Material"
        description="Item BOMs, their revisions and approval status."
        action={
          canManage ? (
            <Button onClick={() => router.push('/scm/bom/new')}>+ New BOM</Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as BomStatus | '')}
          className="h-9 w-52"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {BOM_STATUS_LABEL[s]}
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
                <TableHead>Item</TableHead>
                <TableHead>Revision</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Creator</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : boms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState
                      icon={FileStack}
                      title="No BOMs"
                      description={
                        canManage
                          ? 'Create a BOM to define a product’s components.'
                          : 'BOMs will appear here once R&D creates them.'
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                boms.map((b) => (
                  <TableRow
                    key={b.id}
                    className="cursor-pointer"
                    onClick={() => router.push('/scm/bom/' + b.id)}
                  >
                    <TableCell>
                      <div className="font-medium">{b.itemCode ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">
                        {b.itemName ?? ''}
                      </div>
                    </TableCell>
                    <TableCell>Rev {b.revisionNumber}</TableCell>
                    <TableCell>
                      <StatusBadge value={b.status} />
                    </TableCell>
                    <TableCell>{b.createdByName ?? '—'}</TableCell>
                    <TableCell>
                      {new Date(b.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
