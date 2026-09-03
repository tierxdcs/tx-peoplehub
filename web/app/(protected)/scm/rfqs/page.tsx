'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../../lib/auth-context';
import {
  deleteRfq,
  listRfqs,
  type Rfq,
  type RfqStatus,
} from '../../../lib/rfq';
import { dateOnlyStr } from '../../../lib/date';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { StatusBadge } from '../../../components/ui/status-badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { useRegisterList } from '../../../lib/use-register-list';
import { Skeleton } from '../../../components/ui/skeleton';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

const STATUSES: RfqStatus[] = [
  'DRAFT',
  'ISSUED',
  'CLOSED',
  'AWARDED',
  'CANCELLED',
];

/**
 * RFQ Register (SCM). Company-wide read; "New RFQ" shows for SUPER_ADMIN or
 * MANAGER (the backend enforces the SCM-vertical Manager+ rule).
 */
export default function RfqsPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RfqStatus | ''>('');

  const canCreate = user?.role === 'SUPER_ADMIN' || user?.role === 'MANAGER';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRfqs(await listRfqs());
    } catch {
      setError('Failed to load RFQs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => (statusFilter ? rfqs.filter((r) => r.status === statusFilter) : rfqs),
    [rfqs, statusFilter],
  );
  const register = useRegisterList(
    filtered,
    (rfq) =>
      `${rfq.rfqNumber} ${rfq.title} ${rfq.status} ${rfq.projectName ?? ''} ${rfq.orderNumber ?? ''} ${rfq.customerName ?? ''}`,
  );

  async function remove(rfq: Rfq) {
    const accepted = await confirm({
      title: 'Delete RFQ?',
      description: `Permanently delete ${rfq.rfqNumber}, its quotes and attachments? This cannot be undone.`,
      confirmLabel: 'Delete RFQ',
      destructive: true,
    });
    if (!accepted) return;
    try {
      await deleteRfq(rfq.id);
      toast.success(`${rfq.rfqNumber} deleted`);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to delete RFQ',
      );
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="RFQs"
        description="Requests for quotation — sealed-bid sourcing to suppliers and vendors."
        action={
          canCreate ? (
            <Button onClick={() => router.push('/scm/rfqs/new')}>
              <Plus className="size-4" /> New RFQ
            </Button>
          ) : undefined
        }
      />

      <RegisterToolbar
        title="RFQ Register"
        search={register.search}
        onSearchChange={register.setSearch}
        searchPlaceholder="Search RFQ, title, project or status"
        filters={
          <Select
            className="w-56"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as RfqStatus | '')}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        }
      />

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-destructive">{error}</div>
          ) : register.visibleItems.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No RFQs"
              description="Create an RFQ to request sealed quotes from partners."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>RFQ No.</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead className="text-right">Invitees</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Order ID</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {register.visibleItems.map((rfq) => (
                  <TableRow
                    key={rfq.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/scm/rfqs/${rfq.id}`)}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/scm/rfqs/${rfq.id}`}
                        className="text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {rfq.rfqNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{rfq.title}</TableCell>
                    <TableCell>
                      <StatusBadge value={rfq.status} />
                    </TableCell>
                    <TableCell>{dateOnlyStr(rfq.submissionDeadline)}</TableCell>
                    <TableCell className="text-right">
                      {rfq.invitees.length}
                    </TableCell>
                    <TableCell>{rfq.projectName ?? '—'}</TableCell>
                    <TableCell>{rfq.orderNumber ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {rfq.canDelete && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={(event) => {
                            event.stopPropagation();
                            void remove(rfq);
                          }}
                        >
                          <Trash2 className="size-4" /> Delete
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <RegisterPagination
        page={register.page}
        pageCount={register.pageCount}
        onPageChange={register.setPage}
        disabled={loading}
      />
    </PageContainer>
  );
}
