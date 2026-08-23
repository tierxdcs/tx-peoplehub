'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileCheck } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import { OrderConfirmationSheet } from '../../../../lib/types';
import { dateOnlyStr } from '../../../../lib/date';
import {
  SCard,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
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
import { RegisterToolbar } from '../../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../../components/ui/register-pagination';
import { useRegisterList } from '../../../../lib/use-register-list';
import {
  employeeNameOrFallback,
  resolveEmployeeNames,
} from '../../../../lib/employee-name-resolution';

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
  const [creatorNames, setCreatorNames] = useState<Record<string, string>>({});
  const register = useRegisterList(sheets, (sheet) => `${sheet.confirmationNumber} ${sheet.customerContactName} ${employeeNameOrFallback(creatorNames, sheet.createdById)} ${sheet.status} ${sheet.createdAt}`);

  const load = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
    setError(null);
    try {
      const res = await apiFetch<OrderConfirmationSheet[]>(
        '/confirmation-sheets/pending-approval',
      );
      setSheets(res);
      setCreatorNames(
        await resolveEmployeeNames(res.map((sheet) => sheet.createdById)),
      );
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
      <SignalPage>
        <SignalHeader title="Confirmation Sheet Approvals" />
        <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
          <SCard className="p-6 text-sm text-muted-foreground">
            This queue is visible only to the designated Sales Head and Super
            Admins.
          </SCard>
        </div>
      </SignalPage>
    );
  }

  return (
    <SignalPage>
      <SignalHeader
        title="Confirmation Sheet Approvals"
        description="Order confirmation sheets awaiting your internal signature. Open an order to sign or reject its sheet."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
      <RegisterToolbar title="Approval Queue" search={register.search} onSearchChange={register.setSearch} searchPlaceholder="Search confirmation, requester or status" />

      <SCard className="overflow-hidden">
          {loading ? (
            <div className="p-4">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : error ? (
            <p className="p-4 text-sm text-destructive">{error}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Confirmation #</TableHead>
                  <TableHead>Revision</TableHead>
                  <TableHead>Customer Contact</TableHead>
                  <TableHead>Requester</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {register.visibleItems.map((s) => (
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
                    <TableCell>{employeeNameOrFallback(creatorNames, s.createdById)}</TableCell>
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
                {register.visibleItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
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
      </SCard>
      <RegisterPagination page={register.page} pageCount={register.pageCount} onPageChange={register.setPage} disabled={loading} />
      </div>
    </SignalPage>
  );
}
