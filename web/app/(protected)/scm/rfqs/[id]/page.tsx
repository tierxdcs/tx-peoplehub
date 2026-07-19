'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, AlertTriangle, Check, Copy, Plus, Trash2 } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth-context';
import {
  getRfq,
  addInvitee,
  removeInvitee,
  issueRfq,
  closeRfq,
  cancelRfq,
  type Rfq,
} from '../../../../lib/rfq';
import { listSuppliers, type Supplier } from '../../../../lib/scm-supplier';
import { listVendors, type Vendor } from '../../../../lib/scm';
import { isQualifiedStatus } from '../../../../lib/stores';
import { humanizeEnum } from '../../../../lib/status';
import { dateOnlyStr } from '../../../../lib/date';
import { PageContainer } from '../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Field } from '../../../../components/ui/field';
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
import { useToast } from '../../../../components/ui/toaster';
import { useConfirm } from '../../../../components/ui/confirm';

type PartnerType = 'SUPPLIER' | 'VENDOR';
const MIN_INVITEES = 3;

export default function RfqDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();

  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  // Add-invitee form state.
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [partnerType, setPartnerType] = useState<PartnerType>('SUPPLIER');
  const [partnerId, setPartnerId] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inlineWarning, setInlineWarning] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const canManage =
    user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRfq(await getRfq(id));
    } catch {
      setError('Failed to load RFQ.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Partner pickers are only needed while a DRAFT can be edited.
  useEffect(() => {
    if (!canManage || rfq?.status !== 'DRAFT') return;
    void (async () => {
      try {
        const [s, v] = await Promise.all([listSuppliers(), listVendors()]);
        setSuppliers(s);
        setVendors(v);
      } catch {
        /* picker load failure is non-fatal; the form just stays empty */
      }
    })();
  }, [canManage, rfq?.status]);

  const partners = partnerType === 'SUPPLIER' ? suppliers : vendors;
  // Exclude partners already invited (not revoked) from the picker.
  const invitedIds = useMemo(() => {
    const set = new Set<string>();
    for (const inv of rfq?.invitees ?? []) {
      if (inv.revokedAt) continue;
      if (inv.supplierId) set.add(inv.supplierId);
      if (inv.vendorId) set.add(inv.vendorId);
    }
    return set;
  }, [rfq]);
  const availablePartners = partners.filter((p) => !invitedIds.has(p.id));

  const activeInvitees = useMemo(
    () => (rfq?.invitees ?? []).filter((i) => !i.revokedAt),
    [rfq],
  );

  async function handleAddInvitee() {
    if (!rfq || !partnerId) return;
    setActing(true);
    setInlineWarning(null);
    try {
      const res = await addInvitee(rfq.id, {
        ...(partnerType === 'SUPPLIER' ? { supplierId: partnerId } : { vendorId: partnerId }),
        ...(invitePassword.trim() ? { password: invitePassword.trim() } : {}),
      });
      setRfq(res.rfq);
      setPartnerId('');
      setInvitePassword('');
      if (res.qualificationWarning) {
        setInlineWarning(res.qualificationWarning);
        toast.success(res.qualificationWarning, 'Invitee added with warning');
      } else {
        toast.success('Invitee added');
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add invitee');
    } finally {
      setActing(false);
    }
  }

  async function handleRemoveInvitee(inviteeId: string, name: string | null) {
    if (!rfq) return;
    if (
      !(await confirm({
        title: 'Remove invitee',
        description: `Remove ${name ?? 'this partner'} from the RFQ?`,
        confirmLabel: 'Remove',
        destructive: true,
      }))
    )
      return;
    setActing(true);
    try {
      setRfq(await removeInvitee(rfq.id, inviteeId));
      toast.success('Invitee removed');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove invitee');
    } finally {
      setActing(false);
    }
  }

  async function handleIssue() {
    if (!rfq) return;
    if (
      !(await confirm({
        title: 'Issue RFQ',
        description: `Issue ${rfq.rfqNumber}? Invitees are locked and quote links become active.`,
        confirmLabel: 'Issue',
      }))
    )
      return;
    setActing(true);
    try {
      setRfq(await issueRfq(rfq.id));
      toast.success('RFQ issued');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to issue RFQ');
    } finally {
      setActing(false);
    }
  }

  async function handleClose() {
    if (!rfq) return;
    if (
      !(await confirm({
        title: 'Close RFQ early',
        description: `Close ${rfq.rfqNumber} now? Quotes become visible for comparison and no further submissions are accepted.`,
        confirmLabel: 'Close RFQ',
      }))
    )
      return;
    setActing(true);
    try {
      setRfq(await closeRfq(rfq.id));
      toast.success('RFQ closed');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to close RFQ');
    } finally {
      setActing(false);
    }
  }

  async function handleCancel() {
    if (!rfq) return;
    if (
      !(await confirm({
        title: 'Cancel RFQ',
        description: `Cancel ${rfq.rfqNumber}?`,
        confirmLabel: 'Cancel RFQ',
        destructive: true,
      }))
    )
      return;
    setActing(true);
    try {
      setRfq(await cancelRfq(rfq.id));
      toast.success('RFQ cancelled');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel RFQ');
    } finally {
      setActing(false);
    }
  }

  async function copyLink(token: string) {
    const url = `${window.location.origin}/public/rfq-quote/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      toast.success('Quote link copied to clipboard');
      setTimeout(() => setCopiedToken((t) => (t === token ? null : t)), 2000);
    } catch {
      toast.error('Could not copy — the link is shown below.');
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }
  if (error || !rfq) {
    return (
      <PageContainer>
        <p className="text-sm text-destructive">{error ?? 'Not found.'}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/scm/rfqs')}>
          <ArrowLeft className="size-4" /> Back
        </Button>
      </PageContainer>
    );
  }

  const isDraft = rfq.status === 'DRAFT';
  const isIssued = rfq.status === 'ISSUED';
  const isClosed = rfq.status === 'CLOSED';
  const showTokens = isIssued || isClosed;
  const enoughInvitees = activeInvitees.length >= MIN_INVITEES;

  return (
    <PageContainer>
      <div className="mb-4">
        <Link
          href="/scm/rfqs"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> RFQs
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {rfq.rfqNumber}
            <StatusBadge value={rfq.status} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{rfq.title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canManage && isDraft && (
            <Button
              onClick={handleIssue}
              disabled={acting || !enoughInvitees}
              title={enoughInvitees ? undefined : `Add at least ${MIN_INVITEES} invitees to issue`}
            >
              Issue RFQ
            </Button>
          )}
          {canManage && isIssued && (
            <Button variant="outline" onClick={handleClose} disabled={acting}>
              Close early
            </Button>
          )}
          {isClosed && (
            <Button onClick={() => router.push(`/scm/rfqs/${rfq.id}/compare`)}>
              Compare &amp; Award
            </Button>
          )}
          {canManage && (isDraft || isIssued) && (
            <Button variant="destructive" onClick={handleCancel} disabled={acting}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {rfq.description && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm">Description</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{rfq.description}</CardContent>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        <Info label="Submission Deadline" value={dateOnlyStr(rfq.submissionDeadline)} />
        <Info
          label="Required By"
          value={rfq.requiredByDate ? dateOnlyStr(rfq.requiredByDate) : '—'}
        />
        <Info label="Delivery Location" value={rfq.deliveryLocation ?? '—'} />
        <Info label="Payment Terms" value={rfq.paymentTermsRequested ?? '—'} />
        <Info label="Created By" value={rfq.createdByName ?? '—'} />
        <Info label="Project" value={rfq.projectName ?? '—'} />
      </div>

      {rfq.status === 'AWARDED' && (
        <Card className="mb-6 border-success/40">
          <CardHeader>
            <CardTitle className="text-base">Award Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>
              <span className="text-muted-foreground">Decided by: </span>
              <span className="font-medium">{rfq.awardDecisionByName ?? '—'}</span>
              {rfq.awardDecisionAt && (
                <span className="ml-1 text-muted-foreground">
                  on {dateOnlyStr(rfq.awardDecisionAt)}
                </span>
              )}
            </div>
            {rfq.awardJustification && (
              <div>
                <span className="text-muted-foreground">Justification: </span>
                {rfq.awardJustification}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Line Items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>UoM</TableHead>
                <TableHead>Specification Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rfq.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div className="font-medium">{line.itemName ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{line.itemCode ?? ''}</div>
                  </TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell>{line.unitOfMeasure}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {line.specificationNotes ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Invitees{' '}
            <span className="text-sm font-normal text-muted-foreground">
              ({activeInvitees.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeInvitees.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invitees yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Partner</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Qualification</TableHead>
                  <TableHead>Quote</TableHead>
                  {showTokens && <TableHead>Quote Link</TableHead>}
                  {canManage && isDraft && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeInvitees.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.partnerName ?? '—'}</TableCell>
                    <TableCell>{humanizeEnum(inv.partnerType)}</TableCell>
                    <TableCell>
                      <StatusBadge value={inv.qualificationStatusSnapshot} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={inv.quoteStatus} />
                    </TableCell>
                    {showTokens && (
                      <TableCell>
                        {inv.inviteToken ? (
                          <div className="flex items-center gap-2">
                            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                              /public/rfq-quote/{inv.inviteToken.slice(0, 8)}…
                            </code>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => copyLink(inv.inviteToken!)}
                            >
                              {copiedToken === inv.inviteToken ? (
                                <Check className="size-4 text-success" />
                              ) : (
                                <Copy className="size-4" />
                              )}
                              Copy link
                            </Button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    {canManage && isDraft && (
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={acting}
                          onClick={() => handleRemoveInvitee(inv.id, inv.partnerName)}
                          aria-label="Remove invitee"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {canManage && isDraft && (
            <div className="space-y-4 rounded-md border p-4">
              <div className="text-sm font-medium">Add invitee</div>
              <div className="flex items-center gap-6 text-sm">
                {(['SUPPLIER', 'VENDOR'] as PartnerType[]).map((t) => (
                  <label key={t} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="partnerType"
                      checked={partnerType === t}
                      onChange={() => {
                        setPartnerType(t);
                        setPartnerId('');
                      }}
                    />
                    {t === 'SUPPLIER' ? 'Supplier' : 'Vendor'}
                  </label>
                ))}
              </div>
              <div className="grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-end">
                <Field label={partnerType === 'SUPPLIER' ? 'Supplier' : 'Vendor'}>
                  <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                    <option value="">Select…</option>
                    {availablePartners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.companyName} — {humanizeEnum(p.status)}
                        {isQualifiedStatus(p.status) ? '' : ' ⚠'}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Link password (optional)">
                  <Input
                    type="text"
                    value={invitePassword}
                    onChange={(e) => setInvitePassword(e.target.value)}
                    placeholder="Protect the quote link"
                  />
                </Field>
                <Button
                  type="button"
                  onClick={handleAddInvitee}
                  disabled={!partnerId || acting}
                >
                  <Plus className="size-4" /> Add
                </Button>
              </div>

              {inlineWarning && (
                <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <p>{inlineWarning}</p>
                </div>
              )}

              {!enoughInvitees && (
                <p className="text-xs text-muted-foreground">
                  At least {MIN_INVITEES} invitees are required before the RFQ can be issued.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}
