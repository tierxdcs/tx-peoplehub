'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CalendarDays, Download, FileText, UserRound } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth-context';
import { Bid, Customer, Employee } from '../../../../lib/types';
import { formatINR, prettyEnum } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
import { todayDateStr } from '../../../../lib/date';
import {
  SCard,
  SCardTitle,
  SIGNAL_BTN_GHOST,
  SIGNAL_BTN_PRIMARY,
  SIGNAL_DIALOG,
  SIGNAL_DIALOG_TITLE,
  SIGNAL_EYEBROW,
  SIGNAL_LINK,
  SIGNAL_MUTED,
  SignalHeader,
  SignalPage,
} from '../../../../components/ui/signal';
import { Button } from '../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
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
import { AdHocResolutionCard } from '../../_components/ad-hoc-resolution';
import { StrategyMeetingsSection } from '../_components/strategy-meetings-section';
import { PromoteInternalOrderDialog } from '../_components/promote-internal-order-dialog';
import {
  canCloseBidAsLost,
  CloseBidAsLostDialog,
} from '../_components/close-bid-as-lost-dialog';

export default function BidDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { style: numberFormatStyle } = useNumberFormat();

  const [bid, setBid] = useState<Bid | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  // Name of the rep who created the bid — shown as "Prepared By" and in the
  // closing of the printed proposal.
  const [preparedByName, setPreparedByName] = useState<string | null>(null);
  // Email of the rep who created the bid — shown under "Prepared By" so the
  // recipient contacts the actual salesperson, not the generic company inbox.
  const [preparedByEmail, setPreparedByEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [comments, setComments] = useState('');
  const [hasSignature, setHasSignature] = useState(true);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [closeLostOpen, setCloseLostOpen] = useState(false);

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
        setPreparedByEmail(creator.email ?? null);
      } catch {
        setPreparedByName(null);
        setPreparedByEmail(null);
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

  // Conversion dialog: doubles as the confirmation step and lets Sales set an
  // optional customer-facing name/description per line (the customer's own PO
  // wording). Display-only — the real Product keeps driving BOM/PLM/costing.
  const [convertOpen, setConvertOpen] = useState(false);
  const [lineOverrides, setLineOverrides] = useState<
    Record<string, { name: string; description: string }>
  >({});

  function setOverride(
    lineId: string,
    patch: Partial<{ name: string; description: string }>,
  ) {
    setLineOverrides((current) => {
      const existing = current[lineId] ?? { name: '', description: '' };
      return { ...current, [lineId]: { ...existing, ...patch } };
    });
  }

  async function convertToOrder() {
    setActing(true);
    try {
      const overrides = Object.entries(lineOverrides)
        .filter(([, v]) => v.name.trim() || v.description.trim())
        .map(([bidLineItemId, v]) => ({
          bidLineItemId,
          customerFacingProductName: v.name.trim() || undefined,
          customerFacingDescription: v.description.trim() || undefined,
        }));
      const order = await apiFetch<{ id: string }>(
        `/bids/${id}/convert-to-order`,
        {
          method: 'POST',
          body: JSON.stringify(
            overrides.length ? { lineOverrides: overrides } : {},
          ),
        },
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
   * its own page header — by default "PhazeOne - Phaze ERP". Blank it (a single
   * space, so Chrome doesn't fall back to printing the URL) for the duration of
   * the print, then restore it so the app tab title is unaffected.
   */
  function printProposal() {
    const previous = document.title;
    document.title = ' ';
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
      <SignalPage>
        <div className="px-5 pb-7 pt-[18px] lg:px-7">
          <Skeleton className="mb-4 h-6 w-24" />
          <Skeleton className="mb-6 h-9 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </SignalPage>
    );
  }
  if (error || !bid) {
    return (
      <SignalPage>
        <div className="px-5 pb-7 pt-[18px] lg:px-7">
          <p className="text-destructive">{error ?? 'Bid not found'}</p>
        </div>
      </SignalPage>
    );
  }

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const isAssignedApprover = !!user && bid.approverId === user.sub;
  const canApprove =
    bid.status === 'PENDING_APPROVAL' && (isAssignedApprover || isAdmin);
  // "Create Product Now" reuses POST /products, which is Manager/SuperAdmin-only.
  const canCreateProduct =
    user?.role === 'MANAGER' || user?.role === 'SUPER_ADMIN';
  // Any unresolved ad-hoc line blocks conversion (server enforces this too).
  const hasAdHocLines = (bid.lineItems ?? []).some((li) => li.isAdHoc);

  return (
    <>
      {/* Hidden on screen; the only thing shown when printing / Save-as-PDF. */}
      <BidPrintDocument
        bid={bid}
        customer={customer}
        preparedByName={preparedByName}
        preparedByEmail={preparedByEmail}
        generatedOn={todayDateStr()}
        numberFormatStyle={numberFormatStyle}
      />

      <SignalPage>
        <SignalHeader
          backHref="/sales/bids"
          backLabel="Bids"
          title={bid.bidNumber}
          chip={
            <>
              <StatusBadge value={bid.status} />
              <BusinessUnitLabel
                name={bid.businessUnitName}
                colorHex={bid.businessUnitColorHex}
              />
            </>
          }
          actions={
            <>
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
                  <>
                    <Button
                      variant="outline"
                      disabled={acting || hasAdHocLines}
                      title={
                        hasAdHocLines
                          ? 'Resolve all ad-hoc line items before promoting'
                          : 'Attach this won bid to an existing internal order, preserving its kickoff/PLM/Kanban history'
                      }
                      onClick={() => setPromoteOpen(true)}
                    >
                      Promote Internal Order
                    </Button>
                    <Button
                      disabled={acting || hasAdHocLines}
                      title={
                        hasAdHocLines
                          ? 'Resolve all ad-hoc line items before converting'
                          : undefined
                      }
                      onClick={() => {
                        setLineOverrides({});
                        setConvertOpen(true);
                      }}
                    >
                      Convert to Order
                    </Button>
                  </>
                ))}
              {(bid.status === 'DRAFT' ||
                bid.status === 'REJECTED' ||
                bid.status === 'SENT') && (
                <Button
                  variant="outline"
                  onClick={() =>
                    router.push(
                      `/sales/bids/new?opportunityId=${bid.opportunityId}`,
                    )
                  }
                >
                  Revise Bid
                </Button>
              )}
              {canCloseBidAsLost(bid) && (
                <Button
                  variant="outline"
                  disabled={acting}
                  title="Record this bid as lost so it stops counting as live pipeline"
                  onClick={() => setCloseLostOpen(true)}
                >
                  Close as Lost
                </Button>
              )}
            </>
          }
        />

        <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">
          {/* Live flow indicator — current stage derived from the bid's status. */}
          <ProcessFlow title="Bid progress" {...bidFlow(bid.status)} />

          {/* Formalization gate: resolve any ad-hoc lines to real products before
              this bid can convert to an order. Hidden once converted. */}
          {hasAdHocLines && !bid.convertedOrderId && (
            <AdHocResolutionCard
              bid={bid}
              canCreateProduct={canCreateProduct}
              onResolved={load}
            />
          )}

          {/* Metadata card: Valid until / Tender reference, two-column with icons */}
          <SCard className="grid gap-6 px-5 py-[18px] sm:grid-cols-3">
            <div className="flex items-start gap-3">
              <CalendarDays className={`mt-0.5 size-5 ${SIGNAL_MUTED}`} />
              <div>
                <div className={SIGNAL_EYEBROW}>Valid until</div>
                <div className="mt-0.5 text-sm font-medium">
                  {bid.validUntil.slice(0, 10)}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <UserRound className={`mt-0.5 size-5 ${SIGNAL_MUTED}`} />
              <div>
                <div className={SIGNAL_EYEBROW}>Owner</div>
                <div className="mt-0.5 text-sm font-medium">
                  {bid.ownerName}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <FileText className={`mt-0.5 size-5 ${SIGNAL_MUTED}`} />
              <div>
                <div className={SIGNAL_EYEBROW}>Tender reference</div>
                <div className="mt-0.5 text-sm font-medium">
                  {bid.tenderReferenceNumber || '—'}
                </div>
              </div>
            </div>
          </SCard>

          {/* Technical specification card */}
          {bid.technicalSpecification && (
            <SCard className="px-5 py-[18px]">
              <SCardTitle title="Technical specification" />
              <p className="mt-3 whitespace-pre-wrap text-sm">
                {bid.technicalSpecification}
              </p>
            </SCard>
          )}

          {/* Attachments (reference links) */}
          {bid.attachments && bid.attachments.length > 0 && (
            <SCard className="px-5 py-[18px]">
              <SCardTitle title="Attachments (reference links)" />
              <div className="mt-3 space-y-1 text-sm">
                {bid.attachments.map((a, i) => (
                  <div key={i}>
                    {String((a as Record<string, unknown>).filename ?? '')}{' '}
                    {(a as Record<string, unknown>).url ? (
                      <a
                        className={SIGNAL_LINK}
                        href={String((a as Record<string, unknown>).url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {String((a as Record<string, unknown>).url)}
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </SCard>
          )}

          {/* Line items — full width */}
          <SCard className="overflow-hidden">
            <div className="px-5 pb-3.5 pt-[18px]">
              <SCardTitle title="Line items" />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                  <TableHead className="text-right">Disc %</TableHead>
                  <TableHead className="text-right">Line Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(bid.lineItems ?? []).map((li) => (
                  <TableRow key={li.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ProductCell
                          name={li.productName}
                          sku={li.productSku}
                        />
                        {li.isAdHoc && (
                          <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
                            Awaiting setup
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{li.quantity}</TableCell>
                    <TableCell className="text-right">
                      {formatINR(li.unitPrice, numberFormatStyle)}
                    </TableCell>
                    <TableCell className="text-right">
                      {li.marginPercent ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {li.lineDiscountPercent ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatINR(li.lineTotal, numberFormatStyle)}
                    </TableCell>
                  </TableRow>
                ))}
                {(bid.lineItems ?? []).length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground"
                    >
                      No line items.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </SCard>

          {/* Summary block — right-aligned, fixed width */}
          <div className="flex justify-end">
            <SCard className="w-full max-w-[320px] space-y-2 px-5 py-[18px] text-sm">
              <div className="flex justify-between">
                <span className={SIGNAL_MUTED}>Subtotal</span>
                <span className="tabular-nums">
                  {formatINR(bid.subtotal, numberFormatStyle)}
                </span>
              </div>
              {Number(bid.marginPercent) > 0 && (
                <div className={`flex justify-between text-xs ${SIGNAL_MUTED}`}>
                  <span>Margin (bid-level, {bid.marginPercent}%)</span>
                  <span>included in prices</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className={SIGNAL_MUTED}>
                  Discount ({bid.discountPercent}%)
                </span>
                <span className="tabular-nums">
                  −{formatINR(bid.discountAmount, numberFormatStyle)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className={SIGNAL_MUTED}>
                  Tax
                  {bid.taxType
                    ? ` (${prettyEnum(bid.taxType)} ${bid.taxRate}%)`
                    : ''}
                </span>
                <span className="tabular-nums">
                  {formatINR(bid.taxAmount, numberFormatStyle)}
                </span>
              </div>
              {(bid.amcCharges ?? []).length > 0 && (
                <>
                  <div className="my-1 border-t border-black/[.07] dark:border-white/[.06]" />
                  {(bid.amcCharges ?? []).map((charge) => (
                    <div className="flex justify-between" key={charge.id}>
                      <span className={SIGNAL_MUTED}>
                        AMC Charges for{' '}
                        {charge.yearNumber === 2
                          ? '2nd'
                          : charge.yearNumber === 3
                            ? '3rd'
                            : `${charge.yearNumber}th`}{' '}
                        Year
                      </span>
                      <span className="tabular-nums">
                        {formatINR(charge.amount, numberFormatStyle)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between font-medium">
                    <span>AMC Total</span>
                    <span className="tabular-nums">
                      {formatINR(bid.amcTotal, numberFormatStyle)}
                    </span>
                  </div>
                </>
              )}
              <div className="my-1 border-t border-black/[.07] dark:border-white/[.06]" />
              <div className="flex justify-between text-lg font-semibold">
                <span>Grand Total</span>
                <span className="tabular-nums tracking-[-.5px]">
                  {formatINR(bid.grandTotal, numberFormatStyle)}
                </span>
              </div>
            </SCard>
          </div>

          {bid.approverComments && (
            <p className="text-sm">
              <span className="font-semibold">Approver comments:</span>{' '}
              {bid.approverComments}
            </p>
          )}

          {/* The loss record. Kept separate from `approverComments` above, which
              is an INTERNAL discount refusal, not a commercial loss. */}
          {bid.status === 'LOST' && (
            <SCard className="px-5 py-[18px]">
              <SCardTitle title="Closed as lost" />
              <p className="mt-2 text-sm">{bid.lostReason}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {[
                  bid.closedAsLostByName ? `By ${bid.closedAsLostByName}` : null,
                  bid.closedAsLostAt ? bid.closedAsLostAt.slice(0, 10) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {' — this bid no longer counts as live pipeline, but it still '}
                counts in the win rate.
              </p>
            </SCard>
          )}

          {/* Approver's e-signature, shown once the bid is approved. */}
          {bid.status === 'APPROVED' && (
            <SCard className="px-5 py-[18px]">
              <SCardTitle title="Approved by" />
              <div className="mt-3">
                <SignatureDisplay
                  text={bid.approverSignatureTextSnapshot}
                  font={bid.approverSignatureFontSnapshot}
                  date={bid.approvedAt ? bid.approvedAt.slice(0, 10) : null}
                />
              </div>
            </SCard>
          )}

          {/* Approve/reject controls for the assigned approver */}
          {canApprove && !hasSignature && (
            <SignatureSetupInline onSaved={() => setHasSignature(true)} />
          )}
          {canApprove && (
            <SCard className="flex flex-wrap items-center gap-2 p-4">
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
            </SCard>
          )}

          {bid.status === 'PENDING_APPROVAL' && !canApprove && (
            <p className="text-sm text-muted-foreground">
              Awaiting approval from the assigned manager.
            </p>
          )}
          <StrategyMeetingsSection bidId={bid.id} />
        </div>
      </SignalPage>

      <PromoteInternalOrderDialog
        bid={bid}
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
        onPromoted={(orderId) => router.push(`/sales/orders/${orderId}`)}
        canCreateProduct={canCreateProduct}
      />

      {/* Reload rather than patching in the response: closing the opportunity's
          last live bid also closes the opportunity, which this page reflects. */}
      <CloseBidAsLostDialog
        bid={bid}
        open={closeLostOpen}
        onOpenChange={setCloseLostOpen}
        onClosed={() => load()}
      />

      {/* Convert-to-order confirmation, with optional per-line customer-facing
          wording (editable later from the order's line items too). */}
      <Dialog
        open={convertOpen}
        onOpenChange={(open) => !open && setConvertOpen(false)}
      >
        <DialogContent className={`${SIGNAL_DIALOG} max-h-[85vh] overflow-y-auto sm:max-w-[560px]`}>
          <DialogHeader>
            <DialogTitle className={SIGNAL_DIALOG_TITLE}>
              Convert to order?
            </DialogTitle>
            <DialogDescription>
              This will create a confirmed order from the accepted bid.
              Optionally set the customer&apos;s own wording per line — it
              appears on the order, its documents, and the customer portal,
              while internal screens keep the real product name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {(bid.lineItems ?? []).map((li) => (
              <div
                key={li.id}
                className="rounded-md border border-black/[.07] p-3 dark:border-white/[.08]"
              >
                <div className="text-sm font-medium">{li.productName}</div>
                <div className="mt-2 space-y-2">
                  <Input
                    placeholder="Customer-facing product name (optional)"
                    value={lineOverrides[li.id]?.name ?? ''}
                    onChange={(e) =>
                      setOverride(li.id, { name: e.target.value })
                    }
                    maxLength={300}
                  />
                  <Input
                    placeholder="Customer-facing description (optional)"
                    value={lineOverrides[li.id]?.description ?? ''}
                    onChange={(e) =>
                      setOverride(li.id, { description: e.target.value })
                    }
                    maxLength={2000}
                  />
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConvertOpen(false)}
              className={SIGNAL_BTN_GHOST}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={acting}
              onClick={() => void convertToOrder()}
              className={SIGNAL_BTN_PRIMARY}
            >
              {acting ? 'Converting…' : 'Convert to Order'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
