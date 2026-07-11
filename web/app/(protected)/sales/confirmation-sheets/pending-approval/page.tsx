'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileCheck } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import { OrderConfirmationSheet } from '../../../../lib/types';
import { dateOnlyStr } from '../../../../lib/date';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Skeleton } from '../../../../components/ui/skeleton';
import { EmptyState } from '../../../../components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';

/**
 * Confirmation sheets awaiting the Sales Head's internal countersignature,
 * across all orders. A discovery/navigation surface only — clicking a row
 * (or "View Order") opens the order detail page, whose existing OCS section
 * is where the actual sign/reject happens.
 */
export default function ConfirmationSheetQueuePage() {
  const router = useRouter();
  const [sheets, setSheets] = useState<OrderConfirmationSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
    setError(null);
    try {
      const res = await apiFetch<OrderConfirmationSheet[]>(
        '/confirmation-sheets/pending-approval',
      );
      setSheets(res);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 403) {
        setForbidden(true);
      } else {
        setError('Failed to load the confirmation sheet queue');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) {
    return (
      <PageContainer>
        <PageHeader title="Confirmation Sheet Approvals" />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            This queue is visible only to the designated Sales Head and Super
            Admins.
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Confirmation Sheet Approvals"
        description="Order confirmation sheets awaiting your internal signature. Open an order to sign or reject its sheet."
      />

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Confirmation #</TableHead>
                  <TableHead>Revision</TableHead>
                  <TableHead>Customer Contact</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheets.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/sales/orders/${s.orderId}`)}
                  >
                    <TableCell className="font-medium">
                      {s.confirmationNumber}
                    </TableCell>
                    <TableCell>Rev {s.revisionNumber}</TableCell>
                    <TableCell>{s.customerContactName}</TableCell>
                    <TableCell>{dateOnlyStr(s.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/sales/orders/${s.orderId}`);
                        }}
                      >
                        View Order →
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {sheets.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="p-0">
                      <EmptyState
                        icon={FileCheck}
                        tone="positive"
                        title="No confirmation sheets awaiting your signature."
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
