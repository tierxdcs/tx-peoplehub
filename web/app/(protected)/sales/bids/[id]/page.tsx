'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  Download,
  FileText,
  UserRound,
} from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth-context';
import { Bid, Customer, Employee } from '../../../../lib/types';
import { formatINR, prettyEnum } from '../../../../lib/sales';
import { todayDateStr } from '../../../../lib/date';
import { PageContainer } from '../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { BusinessUnitLabel } from '../../../../components/ui/business-unit-label';
import { ProcessFlow } from '../../../../components/ui/process-flow';
import { bidFlow } from '../../../../lib/record-flows';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { useToast } from '../../../../components/ui/toaster';
import { useConfirm } from '../../../../components/ui/confirm';
import { SignatureDisplay } from '../../../../components/ui/signature-display';
import { SignatureSetupInline } from '../../../../components/ui/signature-setup-inline';
import { ProductCell } from '../../_components/product-cell';
import { BidPrintDocument } from '../../_components/bid-print-document';

export default function BidDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [bid, setBid] = useState<Bid | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  // Name of the rep who created the bid — shown as "Prepared By" and in the
  // closing of the printed proposal.
  const [preparedByName, setPreparedByName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [comments, setComments] = useState('');
  const [hasSignature, setHasSignature] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await apiFetch<Bid>(`/bids/${id}`);
      setBid(loaded);
      // Recipient details + preparer name for the printable proposal —
      // best-effort so either fetch failing never blocks the bid view itself.
      try {
        setCustomer(
          await apiFetch<Customer>(`/customers/${loaded.customerId}`),
        );
      } catch {
        setCustomer(null);
      }
      try {
        const creator = await apiFetch<Employee>(
          `/employees/${loaded.createdById}`,
        );
        setPreparedByName(`${creator.firstName} ${creator.lastName}`.trim());
      } catch {
        setPreparedByName(null);
      }
    } catch {
      setError('Failed to load bid');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Whether the current user has a signature configured — drives the
  // just-in-time setup prompt shown beside the approve controls.
  useEffect(() => {
    if (!user) return;
    apiFetch<Employee>(`/employees/${user.sub}`)
      .then((me) => setHasSignature(!!me.signatureText))
      .catch(() => setHasSignature(true));
  }, [user]);

  async function act(
    path: string,
    body?: Record<string, unknown>,
    confirmOpts?: {
      title: string;
      description?: string;
      destructive?: boolean;
    },
  ) {
    // Every action confirms first. A caller may supply a specific prompt;
    // otherwise fall back to a generic one so nothing fires unconfirmed.
    const ok = await confirm(
      confirmOpts ?? {
        title: 'Confirm action',
        description: `Are you sure you want to ${path} this bid?`,
      },
    );
    if (!ok) return;
    setActing(true);
    try {
      await apiFetch(`/bids/${id}/${path}`, {
        method: 'PATCH',
        body: body ? JSON.stringify(body) : undefined,
      });
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : `Failed to ${path} bid`,
      );
    } finally {
      setActing(false);
    }
  }

  async function convertToOrder() {
    const ok = await confirm({
      title: 'Convert to order?',
      description: 'This will create a confirmed order from the accepted bid.',
    });
    if (!ok) return;
    setActing(true);
    try {
      const order = await apiFetch<{ id: string }>(
        `/bids/${id}/convert-to-order`,
        { method: 'POST' },
      );
      router.push(`/sales/orders/${order.id}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to convert to order',
      );
      setActing(false);
    }
  }

  /**
   * Print/Save-as-PDF. Chrome prints the browser tab title (document.title) in
   * its own page header — by default "PhazeOne - Phaze ERP". Swap it to a
   * clean "System generated by PhazeOne" line for the duration of the print,
   * then restore it so the app tab title is unaffected.
   */
  function printProposal() {
    const previous = document.title;
    document.title = 'System generated by PhazeOne';
    const restore = () => {
      document.title = previous;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
    // Fallback for browsers that don't fire afterprint reliably.
    setTimeout(restore, 1000);
  }

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-6 w-24" />
        <Skeleton className="mb-6 h-9 w-64" />
        <Skeleton className="h-48 w-full" />
      </PageContainer>
    );
  }
  if (error || !bid) {
    return (
      <PageContainer>
        <p className="text-destructive">{error ?? 'Bid not found'}</p>
      </PageContainer>
    );
  }

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const isAssignedApprover = !!user && bid.approverId === user.sub;
  const canApprove =
    bid.status === 'PENDING_APPROVAL' && (isAssignedApprover || isAdmin);

  return (
    <>
      {/* Hidden on screen; the only thing shown when printing / Save-as-PDF. */}
      <BidPrintDocument
        bid={bid}
        customer={customer}
        preparedByName={preparedByName}
        generatedOn={todayDateStr()}
      />

      <PageContainer>
        <Link
          href="/sales/bids"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Bids
        </Link>

        {/* Header row: number + status on the left, actions on the right */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {bid.bidNumber}
            </h1>
            <StatusBadge value={bid.status} />
            <BusinessUnitLabel
              name={bid.businessUnitName}
              colorHex={bid.businessUnitColorHex}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={printProposal}>
              <Download /> Download PDF
            </Button>
            {(bid.status === 'DRAFT' || bid.status === 'REJECTED') && (
              <Button
                disabled={acting}
                onClick={() =>
                  act(
                    'submit',
                    undefined,
                    Number(bid.discountPercent) > 10
                      ? {
                          title: 'Submit for approval?',
                          description:
                            'Discount exceeds 10% — this will route to your manager for approval.',
                        }
                      : undefined,
                  )
                }
              >
                {acting ? '…' : 'Submit'}
              </Button>
            )}
            {bid.status === 'APPROVED' && (
              <Button
                disabled={acting}
                onClick={() =>
                  act(
                    'status',
                    { status: 'SENT' },
                    {
                      title: 'Mark as Sent?',
                      description: 'Record this bid as sent to the customer.',
                    },
                  )
                }
              >
                Mark as Sent
              </Button>
            )}
            {bid.status === 'SENT' && (
              <Button
                disabled={acting}
                onClick={() =>
                  act(
                    'status',
                    { status: 'ACCEPTED' },
                    {
                      title: 'Mark as Accepted?',
                      description:
                        'Record the customer as having accepted this bid.',
                    },
                  )
                }
              >
                Mark as Accepted
              </Button>
            )}
            {bid.status === 'ACCEPTED' &&
              (bid.convertedOrderId ? (
                // Already converted — a bid maps to at most one order. Offer a
                // link to it instead of a dead "Convert" that the API rejects.
                <Button
                  variant="outline"
                  onClick={() =>
                    router.push(`/sales/orders/${bid.convertedOrderId}`)
                  }
                >
                  View Order
                </Button>
              ) : (
                <Button disabled={acting} onClick={convertToOrder}>
                  Convert to Order
                </Button>
              ))}
            {(bid.status === 'DRAFT' || bid.status === 'REJECTED') && (
              <Button
                variant="outline"
                onClick={() =>
                  router.push(
                    `/sales/bids/new?opportunityId=${bid.opportunityId}`,
                  )
                }
              >
                New revised bid
              </Button>
            )}
          </div>
        </div>

        {/* Live flow indicator — current stage derived from the bid's status. */}
        <ProcessFlow
          title="Bid progress"
          className="mb-4"
          {...bidFlow(bid.status)}
        />

        {/* Metadata card: Valid until / Tender reference, two-column with icons */}
        <Card className="mb-4">
          <CardContent className="grid gap-6 p-6 sm:grid-cols-3">
            <div className="flex items-start gap-3">
              <CalendarDays className="mt-0.5 size-5 text-muted-foreground" />
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Valid until
                </div>
                <div className="mt-0.5 text-sm font-medium">
                  {bid.validUntil.slice(0, 10)}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <UserRound className="mt-0.5 size-5 text-muted-foreground" />
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Owner
                </div>
                <div className="mt-0.5 text-sm font-medium">
                  {bid.ownerName}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 size-5 text-muted-foreground" />
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Tender reference
                </div>
                <div className="mt-0.5 text-sm font-medium">
                  {bid.tenderReferenceNumber || '—'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Technical specification card */}
        {bid.technicalSpecification && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Technical specification
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="whitespace-pre-wrap text-sm">
                {bid.technicalSpecification}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Attachments (reference links) */}
        {bid.attachments && bid.attachments.length > 0 && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Attachments (reference links)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0 text-sm">
              {bid.attachments.map((a, i) => (
                <div key={i}>
                  {String((a as Record<string, unknown>).filename ?? '')}{' '}
                  {(a as Record<string, unknown>).url ? (
                    <a
                      className="text-primary underline-offset-4 hover:underline"
                      href={String((a as Record<string, unknown>).url)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {String((a as Record<string, unknown>).url)}
                    </a>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Line items — full width */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Line items</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Disc %</TableHead>
                  <TableHead className="text-right">Line Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(bid.lineItems ?? []).map((li) => (
                  <TableRow key={li.id}>
                    <TableCell>
                      <ProductCell name={li.productName} sku={li.productSku} />
                    </TableCell>
                    <TableCell className="text-right">{li.quantity}</TableCell>
                    <TableCell className="text-right">
                      {formatINR(li.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right">
                      {li.lineDiscountPercent ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatINR(li.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
                {(bid.lineItems ?? []).length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground"
                    >
                      No line items.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Summary block — right-aligned, fixed width */}
        <div className="mb-6 flex justify-end">
          <Card className="w-full max-w-[320px]">
            <CardContent className="space-y-2 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatINR(bid.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Discount ({bid.discountPercent}%)
                </span>
                <span>−{formatINR(bid.discountAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Tax
                  {bid.taxType
                    ? ` (${prettyEnum(bid.taxType)} ${bid.taxRate}%)`
                    : ''}
                </span>
                <span>{formatINR(bid.taxAmount)}</span>
              </div>
              {(bid.amcCharges ?? []).length > 0 && (
                <>
                  <div className="my-1 border-t" />
                  {(bid.amcCharges ?? []).map((charge) => (
                    <div className="flex justify-between" key={charge.id}>
                      <span className="text-muted-foreground">
                        AMC Charges for{' '}
                        {charge.yearNumber === 2
                          ? '2nd'
                          : charge.yearNumber === 3
                            ? '3rd'
                            : `${charge.yearNumber}th`}{' '}
                        Year
                      </span>
                      <span>{formatINR(charge.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between font-medium">
                    <span>AMC Total</span>
                    <span>{formatINR(bid.amcTotal)}</span>
                  </div>
                </>
              )}
              <div className="my-1 border-t" />
              <div className="flex justify-between text-lg font-semibold">
                <span>Grand Total</span>
                <span>{formatINR(bid.grandTotal)}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {bid.approverComments && (
          <p className="mb-4 text-sm">
            <span className="font-semibold">Approver comments:</span>{' '}
            {bid.approverComments}
          </p>
        )}

        {/* Approver's e-signature, shown once the bid is approved. */}
        {bid.status === 'APPROVED' && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Approved by
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <SignatureDisplay
                text={bid.approverSignatureTextSnapshot}
                font={bid.approverSignatureFontSnapshot}
                date={bid.approvedAt ? bid.approvedAt.slice(0, 10) : null}
              />
            </CardContent>
          </Card>
        )}

        {/* Approve/reject controls for the assigned approver */}
        {canApprove && !hasSignature && (
          <div className="mb-4">
            <SignatureSetupInline onSaved={() => setHasSignature(true)} />
          </div>
        )}
        {canApprove && (
          <Card className="mb-4">
            <CardContent className="flex flex-wrap items-center gap-2 p-4">
              <Input
                className="max-w-xs"
                placeholder="Comments (optional)"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
              <Button
                disabled={acting}
                onClick={() =>
                  act(
                    'approve',
                    { approverComments: comments || undefined },
                    {
                      title: 'Approve this bid?',
                      description: 'The bid will be marked APPROVED.',
                    },
                  )
                }
              >
                Approve
              </Button>
              <Button
                variant="destructive"
                disabled={acting}
                onClick={() =>
                  act(
                    'reject',
                    { approverComments: comments || undefined },
                    {
                      title: 'Reject this bid?',
                      description: 'The bid will be marked REJECTED.',
                      destructive: true,
                    },
                  )
                }
              >
                Reject
              </Button>
            </CardContent>
          </Card>
        )}

        {bid.status === 'PENDING_APPROVAL' && !canApprove && (
          <p className="text-sm text-muted-foreground">
            Awaiting approval from the assigned manager.
          </p>
        )}
      </PageContainer>
    </>
  );
}
