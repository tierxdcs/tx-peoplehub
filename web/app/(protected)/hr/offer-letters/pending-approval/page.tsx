'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileCheck } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
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
import { StatusBadge } from '../../../../components/ui/status-badge';

/**
 * A pending offer letter as returned by the list endpoint (raw record + a
 * selected employee). The approver reviews and decides on the detail page.
 * `status` distinguishes the first-stage vertical-owner sign-off from the CEO's
 * final sign-off — the CEO's queue mixes both (plus owner-less fallbacks).
 */
type PendingOfferLetter = {
  id: string;
  referenceNumber: string;
  status: 'PENDING_VERTICAL_APPROVAL' | 'PENDING_CEO_APPROVAL';
  submittedAt: string | null;
  employee: {
    id: string;
    employeeId: string;
    firstName: string;
    lastName: string;
    designation: string | null;
  };
};

/**
 * Offer letters awaiting the current user's vertical-owner approval (Super
 * Admins see every pending letter, including owner-less fallbacks). A
 * discovery surface — clicking a row opens the review page where the frozen
 * document is shown and approved or rejected.
 */
export default function OfferLetterApprovalQueuePage() {
  const router = useRouter();
  const [letters, setLetters] = useState<PendingOfferLetter[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const register = useRegisterList(letters, (letter) => `${letter.referenceNumber} ${letter.employee.firstName} ${letter.employee.lastName} ${letter.employee.employeeId} ${letter.employee.designation ?? ''} ${letter.status} pending`);

  const load = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
    setError(null);
    try {
      const res = await apiFetch<PendingOfferLetter[]>(
        '/offer-letters/pending-approval',
      );
      setLetters(res);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 403) {
        setForbidden(true);
      } else {
        setError('Failed to load the offer letter approval queue');
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
        <SignalHeader title="Offer Letter Approvals" />
        <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
          <SCard className="p-6 text-sm text-muted-foreground">
            This queue is visible only to vertical owners and the CEO.
          </SCard>
        </div>
      </SignalPage>
    );
  }

  return (
    <SignalPage>
      <SignalHeader
        title="Offer Letter Approvals"
        description="Offer letters awaiting your approval — as the new hire’s vertical owner (first sign-off) or, for the CEO, the final sign-off. Open one to review and decide."
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
        <RegisterToolbar title="Approval Queue" search={register.search} onSearchChange={register.setSearch} searchPlaceholder="Search candidate, reference or status" />

        <SCard className="overflow-hidden">
          {loading ? (
            <div className="p-6">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : error ? (
            <p className="p-6 text-sm text-destructive">{error}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference #</TableHead>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {register.visibleItems.map((l) => (
                  <TableRow
                    key={l.id}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(`/hr/offer-letters/pending-approval/${l.id}`)
                    }
                  >
                    <TableCell className="font-medium">
                      {l.referenceNumber}
                    </TableCell>
                    <TableCell>
                      {l.employee.firstName} {l.employee.lastName}
                      <span className="ml-1 text-muted-foreground">
                        · {l.employee.employeeId}
                      </span>
                    </TableCell>
                    <TableCell>{l.employee.designation ?? '—'}</TableCell>
                    <TableCell>
                      <StatusBadge value={l.status} />
                    </TableCell>
                    <TableCell>
                      {l.submittedAt ? dateOnlyStr(l.submittedAt) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(
                            `/hr/offer-letters/pending-approval/${l.id}`,
                          );
                        }}
                      >
                        Review →
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
                        title="No offer letters awaiting your approval."
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
