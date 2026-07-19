'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, ShieldAlert } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import { pendingApprovalBoms, type Bom } from '../../../../lib/scm-bom';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardContent } from '../../../../components/ui/card';
import { EmptyState } from '../../../../components/ui/empty-state';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';

/**
 * R&D Head approval queue (§4). Backend restricts this to R&D Heads; a 403 is
 * surfaced as a friendly empty state rather than an error.
 */
export default function PendingApprovalPage() {
  const router = useRouter();
  const [boms, setBoms] = useState<Bom[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      setBoms(await pendingApprovalBoms());
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 403) {
        setForbidden(true);
      } else {
        setError(
          err instanceof ApiError ? err.message : 'Failed to load approval queue.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageContainer>
      <PageHeader
        title="Pending BOM Approvals"
        description="BOMs awaiting an R&D Head’s technical approval."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          {forbidden ? (
            <EmptyState
              icon={ShieldAlert}
              title="Restricted"
              description="Only R&D Heads can view the approval queue."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Revision</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted by</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
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
                        icon={ClipboardCheck}
                        tone="positive"
                        title="All caught up"
                        description="No BOMs are pending approval."
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
                        {b.submittedAt
                          ? new Date(b.submittedAt).toLocaleDateString()
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
