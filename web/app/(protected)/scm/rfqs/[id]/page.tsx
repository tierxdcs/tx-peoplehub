'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileText,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  SquarePen,
  Upload,
  Trash2,
  X,
} from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth-context';
import {
  getRfq,
  updateRfq,
  deleteRfq,
  addInvitee,
  removeInvitee,
  requestQuoteRevision,
  approveRfq,
  rejectRfq,
  issueRfq,
  closeRfq,
  cancelRfq,
  rfqComparison,
  type Rfq,
  type RfqInvitee,
  type RfqLine,
  type ComparisonColumn,
  type RfqTechnicalView,
  getRfqTechnicalDocuments,
  rfqTechnicalUploadUrl,
  confirmRfqTechnicalUpload,
  downloadRfqTechnicalAttachment,
  deleteRfqTechnicalAttachment,
} from '../../../../lib/rfq';
import {
  blankLineDraft,
  lineSignature,
  toDateTimeInput,
  toLineDraft,
  type LineDraft,
} from '../../../../lib/rfq-draft';
import { uploadToPresignedUrl } from '../../../../lib/vault-api';
import { listItems } from '../../../../lib/scm-item-master';
import { listSuppliers, type Supplier } from '../../../../lib/scm-supplier';
import { listVendors, type Vendor } from '../../../../lib/scm';
import { isQualifiedStatus } from '../../../../lib/stores';
import { humanizeEnum } from '../../../../lib/status';
import { dateOnlyStr } from '../../../../lib/date';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
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
import { Textarea } from '../../../../components/ui/textarea';
import { Field } from '../../../../components/ui/field';
import {
  ItemPicker,
  type ItemPickerItem,
} from '../../../../components/ui/item-picker';
import { Skeleton } from '../../../../components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { ProcessFlow } from '../../../../components/ui/process-flow';
import { rfqFlow } from '../../../../lib/record-flows';
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

/** RFQ header fields SCM can still revise while the RFQ is a DRAFT. */
interface DraftForm {
  title: string;
  description: string;
  submissionDeadline: string;
  requiredByDate: string;
  deliveryLocation: string;
  paymentTermsRequested: string;
}

export default function RfqDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const { style: numberFormatStyle } = useNumberFormat();

  const [rfq, setRfq] = useState<Rfq | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [technical, setTechnical] = useState<RfqTechnicalView | null>(null);
  const [drawingLineId, setDrawingLineId] = useState('');
  const [uploadingDrawing, setUploadingDrawing] = useState(false);
  // Per-invitee quoted totals, keyed by inviteeId. Sealed-bid: these live only
  // in the guarded comparison endpoint and are fetched once quotes are visible
  // (CLOSED / AWARDED) so the detail table can show what each partner quoted.
  const [quoteTotals, setQuoteTotals] = useState<Map<string, ComparisonColumn>>(
    new Map(),
  );

  // Add-invitee form state.
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [partnerType, setPartnerType] = useState<PartnerType>('SUPPLIER');
  const [partnerId, setPartnerId] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inlineWarning, setInlineWarning] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  // The invitee whose link SCM is reopening for a negotiated revision, if any.
  const [revisionTarget, setRevisionTarget] = useState<RfqInvitee | null>(null);

  // ── DRAFT editing ──────────────────────────────────────────────────────
  // A DRAFT is still a working document — the quote window, the terms and the
  // sourcing lines all get revised before it goes out. Saving routes through
  // PATCH /rfqs/:id, which reconciles the lines item-by-item (so a line keeps
  // its technical drawings) and clears the PM approval only when what a partner
  // would be quoting on actually changed.
  const [editing, setEditing] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [deletingRfq, setDeletingRfq] = useState(false);
  const [items, setItems] = useState<ItemPickerItem[]>([]);
  const [form, setForm] = useState<DraftForm | null>(null);
  const [editLines, setEditLines] = useState<LineDraft[]>([]);

  const canManage =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN' ||
    user?.role === 'MANAGER';

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

  const loadTechnical = useCallback(async () => {
    try {
      setTechnical(await getRfqTechnicalDocuments(id));
    } catch {
      setTechnical(null);
    }
  }, [id]);

  useEffect(() => {
    void loadTechnical();
  }, [loadTechnical]);

  async function uploadDrawing(file: File) {
    setUploadingDrawing(true);
    try {
      const line = drawingLineId || undefined;
      const presign = await rfqTechnicalUploadUrl(id, {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        rfqLineId: line,
      });
      await uploadToPresignedUrl(presign.uploadUrl, file);
      await confirmRfqTechnicalUpload(id, {
        fileKey: presign.fileKey,
        fileName: file.name,
        rfqLineId: line,
      });
      toast.success('Technical drawing attached');
      await loadTechnical();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Drawing upload failed',
      );
    } finally {
      setUploadingDrawing(false);
    }
  }

  async function downloadDrawing(attachmentId: string) {
    try {
      const result = await downloadRfqTechnicalAttachment(id, attachmentId);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Download failed');
    }
  }

  async function deleteDrawing(attachmentId: string, fileName: string) {
    const approved = await confirm({
      title: 'Delete technical attachment?',
      description: `${fileName} will be permanently removed from this RFQ and file storage.`,
      confirmLabel: 'Delete attachment',
      destructive: true,
    });
    if (!approved) return;
    try {
      await deleteRfqTechnicalAttachment(id, attachmentId);
      toast.success('Technical attachment deleted');
      await loadTechnical();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

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

  // Once the sealed phase is over (CLOSED / AWARDED), pull the comparison so we
  // can show each invitee's quoted total on the detail table. Non-fatal: if it
  // fails the table simply omits the amount column.
  useEffect(() => {
    if (rfq?.status !== 'CLOSED' && rfq?.status !== 'AWARDED') {
      setQuoteTotals(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const cmp = await rfqComparison(id);
        if (cancelled) return;
        setQuoteTotals(new Map(cmp.columns.map((c) => [c.inviteeId, c])));
      } catch {
        /* comparison load failure is non-fatal; amounts just won't show */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, rfq?.status]);

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

  // The winning invitee + its comparison figures, resolved for the Award
  // Decision card. Name/type come from the RFQ payload immediately; the quoted
  // value and commercial terms arrive once the (async) comparison loads.
  const awardedInvitee = useMemo(
    () =>
      rfq?.awardedInviteeId
        ? ((rfq.invitees ?? []).find((i) => i.id === rfq.awardedInviteeId) ??
          null)
        : null,
    [rfq],
  );
  const awardedColumn = rfq?.awardedInviteeId
    ? (quoteTotals.get(rfq.awardedInviteeId) ?? null)
    : null;

  async function handleAddInvitee() {
    if (!rfq || !partnerId) return;
    setActing(true);
    setInlineWarning(null);
    try {
      const res = await addInvitee(rfq.id, {
        ...(partnerType === 'SUPPLIER'
          ? { supplierId: partnerId }
          : { vendorId: partnerId }),
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
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to add invitee',
      );
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
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to remove invitee',
      );
    } finally {
      setActing(false);
    }
  }

  /**
   * Reopen one invitee's link for a negotiated revised quote. Only that partner
   * is affected — the RFQ stays CLOSED and nobody else's link changes. Their
   * next submission lands as Revision 2+ alongside the original, which stays
   * intact and visible in the comparison history.
   */
  async function handleRequestRevision(input: {
    revisionDeadline: string;
    note?: string;
    password?: string;
  }) {
    if (!rfq || !revisionTarget) return;
    setActing(true);
    try {
      setRfq(await requestQuoteRevision(rfq.id, revisionTarget.id, input));
      setRevisionTarget(null);
      toast.success(
        `Quote link reopened for ${revisionTarget.partnerName ?? 'this partner'} — copy it to them from the Quote Link column`,
        'Revised quote requested',
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : 'Failed to request a revised quote',
      );
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
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to issue RFQ',
      );
    } finally {
      setActing(false);
    }
  }

  async function handleApprove() {
    if (!rfq) return;
    if (
      !(await confirm({
        title: 'Approve RFQ',
        description: `Approve ${rfq.rfqNumber}? SCM can then generate the invitee quote links and issue the RFQ.`,
        confirmLabel: 'Approve',
      }))
    )
      return;
    setActing(true);
    try {
      setRfq(await approveRfq(rfq.id));
      toast.success('RFQ approved');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to approve RFQ',
      );
    } finally {
      setActing(false);
    }
  }

  async function handleReject(comment: string) {
    if (!rfq) return;
    setActing(true);
    try {
      setRfq(await rejectRfq(rfq.id, comment));
      setRejectOpen(false);
      toast.success('RFQ rejected — returned to SCM for revision');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to reject RFQ',
      );
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
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to close RFQ',
      );
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
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to cancel RFQ',
      );
    } finally {
      setActing(false);
    }
  }

  function startEditing() {
    if (!rfq) return;
    setForm({
      title: rfq.title,
      description: rfq.description ?? '',
      submissionDeadline: toDateTimeInput(rfq.submissionDeadline),
      requiredByDate: rfq.requiredByDate ? dateOnlyStr(rfq.requiredByDate) : '',
      deliveryLocation: rfq.deliveryLocation ?? '',
      paymentTermsRequested: rfq.paymentTermsRequested ?? '',
    });
    setEditLines(rfq.lines.map(toLineDraft));
    setEditing(true);
    if (items.length === 0) void loadItems(rfq.lines);
  }

  /**
   * Items for the line picker. Anything a line already points at is merged in
   * even if it has since been deactivated, so an existing line still renders
   * (its group heading is a guess — the RFQ payload carries no item type).
   */
  async function loadItems(lines: RfqLine[]) {
    try {
      const rows = await listItems({ activeOnly: true });
      const known = new Set(rows.map((row) => row.id));
      const missing: ItemPickerItem[] = lines
        .filter((line) => !known.has(line.itemId))
        .map((line) => ({
          id: line.itemId,
          itemCode: line.itemCode ?? '',
          name: line.itemName ?? 'Inactive item',
          itemType: 'COMPONENT' as const,
        }));
      setItems([...rows, ...missing]);
    } catch {
      toast.error(
        'Failed to load the item master — line items cannot be changed',
      );
    }
  }

  function updateEditLine(key: number, patch: Partial<LineDraft>) {
    setEditLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function addEditLine() {
    setEditLines((prev) => [...prev, blankLineDraft()]);
  }

  async function handleSaveDraft() {
    if (!rfq || !form) return;
    if (!form.title.trim()) {
      toast.error('A title is required');
      return;
    }
    if (!form.submissionDeadline) {
      toast.error('A submission deadline is required');
      return;
    }
    const validLines = editLines.filter(
      (line) => line.itemId && Number(line.quantity) > 0,
    );
    if (validLines.length === 0) {
      toast.error('An RFQ needs at least one line with an item and a quantity');
      return;
    }
    const original = rfq.lines.map(toLineDraft);
    // Only send `lines` when they actually differ: the server clears the PM
    // approval on a scope change, and there's no reason to risk that on a save
    // that only touched the title or the terms.
    const linesChanged = lineSignature(validLines) !== lineSignature(original);
    setSavingDraft(true);
    try {
      const saved = await updateRfq(rfq.id, {
        title: form.title.trim(),
        description: form.description.trim(),
        submissionDeadline: new Date(form.submissionDeadline).toISOString(),
        requiredByDate: form.requiredByDate || undefined,
        deliveryLocation: form.deliveryLocation.trim(),
        paymentTermsRequested: form.paymentTermsRequested.trim(),
        ...(linesChanged
          ? {
              lines: validLines.map((line, index) => ({
                itemId: line.itemId,
                quantity: Number(line.quantity),
                ...(line.unitOfMeasure
                  ? { unitOfMeasure: line.unitOfMeasure }
                  : {}),
                ...(line.targetPrice
                  ? { targetPrice: Number(line.targetPrice) }
                  : {}),
                ...(line.specificationNotes.trim()
                  ? { specificationNotes: line.specificationNotes.trim() }
                  : {}),
                sequence: index,
              })),
            }
          : {}),
      });
      setRfq(saved);
      setEditing(false);
      toast.success(
        linesChanged && rfq.pmApproved && !saved.pmApproved
          ? 'Draft saved — the sourcing scope changed, so it needs Project Manager approval again'
          : 'Draft saved',
      );
      // Line ids can change when lines were added or dropped, so the
      // drawing/BOM panel needs re-fetching alongside.
      if (linesChanged) await loadTechnical();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to save draft',
      );
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleDelete() {
    if (!rfq) return;
    if (
      !(await confirm({
        title: 'Delete this draft RFQ?',
        description: `${rfq.rfqNumber} and everything on it — line items, invitees and technical drawings — are permanently removed. Cancel the RFQ instead if you want to keep the record.`,
        confirmLabel: 'Delete RFQ',
        destructive: true,
      }))
    )
      return;
    setDeletingRfq(true);
    try {
      await deleteRfq(rfq.id);
      toast.success(`${rfq.rfqNumber} deleted`);
      router.push('/scm/rfqs');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to delete RFQ',
      );
      setDeletingRfq(false);
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
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => router.push('/scm/rfqs')}
        >
          <ArrowLeft className="size-4" /> Back
        </Button>
      </PageContainer>
    );
  }

  const isDraft = rfq.status === 'DRAFT';
  const isIssued = rfq.status === 'ISSUED';
  const isClosed = rfq.status === 'CLOSED';
  const isAwarded = rfq.status === 'AWARDED';
  const showTokens = isIssued || isClosed;
  // Quoted totals are only meaningful (and only fetched) once the RFQ is past
  // the sealed phase. Show the column for CLOSED and AWARDED.
  const showQuotedValue = isClosed || isAwarded;
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
          {editing ? (
            <>
              <Button
                variant="outline"
                onClick={() => setEditing(false)}
                disabled={savingDraft}
              >
                <X className="size-4" /> Discard changes
              </Button>
              <Button onClick={handleSaveDraft} disabled={savingDraft}>
                <Save className="size-4" />
                {savingDraft ? 'Saving…' : 'Save draft'}
              </Button>
            </>
          ) : (
            canManage &&
            isDraft && (
              <>
                <Button variant="outline" onClick={startEditing}>
                  <SquarePen className="size-4" /> Edit draft
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deletingRfq || acting}
                  title="Delete this draft outright — only possible before it is issued"
                >
                  <Trash2 className="size-4" />
                  {deletingRfq ? 'Deleting…' : 'Delete'}
                </Button>
              </>
            )
          )}
          {!editing && rfq.canApprove && isDraft && (
            <>
              <Button
                variant="outline"
                onClick={handleApprove}
                disabled={acting}
              >
                <ShieldCheck className="size-4" /> Approve
              </Button>
              <Button
                variant="destructive"
                onClick={() => setRejectOpen(true)}
                disabled={acting}
              >
                <X className="size-4" /> Reject
              </Button>
            </>
          )}
          {!editing && canManage && isDraft && (
            <Button
              onClick={handleIssue}
              disabled={acting || !enoughInvitees || !rfq.pmApproved}
              title={
                !rfq.pmApproved
                  ? `Awaiting approval from ${rfq.pmApproverName ?? 'the Project Manager'}`
                  : !enoughInvitees
                    ? `Add at least ${MIN_INVITEES} invitees to issue`
                    : undefined
              }
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
          {!editing && canManage && (isDraft || isIssued) && (
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={acting}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Live flow indicator — stage derived from the RFQ's status. */}
      <ProcessFlow
        title="RFQ progress"
        className="mb-6"
        {...rfqFlow(rfq.status)}
      />

      {/* PM approval gate — invitee links can't be generated until approved. */}
      {isDraft &&
        (rfq.pmApproved ? (
          <div className="mb-6 flex items-start gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            <p>
              Approved by{' '}
              <span className="font-medium">
                {rfq.pmApprovedByName ?? 'the Project Manager'}
              </span>
              {rfq.pmApprovedAt && <> on {dateOnlyStr(rfq.pmApprovedAt)}</>}.
              SCM can now generate the invitee links and issue the RFQ.
            </p>
          </div>
        ) : rfq.pmRejectionComment ? (
          <div className="mb-6 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">
                Rejected by the Project Manager — revise and resubmit for
                approval.
              </p>
              <p className="mt-1 text-muted-foreground">
                {rfq.pmRejectionComment}
              </p>
            </div>
          </div>
        ) : (
          <div className="mb-6 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>
              Awaiting Project Manager approval
              {rfq.pmApproverName ? <> from {rfq.pmApproverName}</> : null}.
              Invitee quote links cannot be generated until this RFQ is
              approved.
            </p>
          </div>
        ))}

      {editing && form ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Draft details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Title" htmlFor="draft-title" required>
              <Input
                id="draft-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label="Description" htmlFor="draft-description">
              <Textarea
                id="draft-description"
                rows={3}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Submission Deadline"
                htmlFor="draft-deadline"
                required
              >
                <Input
                  id="draft-deadline"
                  type="datetime-local"
                  value={form.submissionDeadline}
                  onChange={(e) =>
                    setForm({ ...form, submissionDeadline: e.target.value })
                  }
                />
              </Field>
              <Field label="Required By Date" htmlFor="draft-required-by">
                <Input
                  id="draft-required-by"
                  type="date"
                  value={form.requiredByDate}
                  onChange={(e) =>
                    setForm({ ...form, requiredByDate: e.target.value })
                  }
                />
              </Field>
              <Field label="Delivery Location" htmlFor="draft-delivery">
                <Input
                  id="draft-delivery"
                  value={form.deliveryLocation}
                  onChange={(e) =>
                    setForm({ ...form, deliveryLocation: e.target.value })
                  }
                />
              </Field>
              <Field label="Payment Terms Requested" htmlFor="draft-terms">
                <Input
                  id="draft-terms"
                  value={form.paymentTermsRequested}
                  onChange={(e) =>
                    setForm({ ...form, paymentTermsRequested: e.target.value })
                  }
                  placeholder="e.g. Net 30"
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Changing the sourcing lines (item, quantity, target price or
              specification) clears the Project Manager approval, so the final
              scope is always the approved one. Dropping a line also removes the
              technical drawings attached to it.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {rfq.description && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-sm">Description</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {rfq.description}
              </CardContent>
            </Card>
          )}

          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
            <Info
              label="Submission Deadline"
              value={dateOnlyStr(rfq.submissionDeadline)}
            />
            <Info
              label="Required By"
              value={rfq.requiredByDate ? dateOnlyStr(rfq.requiredByDate) : '—'}
            />
            <Info
              label="Delivery Location"
              value={rfq.deliveryLocation ?? '—'}
            />
            <Info
              label="Payment Terms"
              value={rfq.paymentTermsRequested ?? '—'}
            />
            <Info label="Created By" value={rfq.createdByName ?? '—'} />
            <Info label="Project" value={rfq.projectName ?? '—'} />
          </div>
        </>
      )}

      {rfq.orderNumber && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Linked customer order</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Info label="Order ID" value={rfq.orderNumber} />
              <Info label="Customer" value={rfq.customerName ?? '—'} />
              <Info
                label="Order value"
                value={
                  rfq.orderTotal
                    ? formatINR(rfq.orderTotal, numberFormatStyle)
                    : '—'
                }
              />
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Order status
                </p>
                <div className="mt-1">
                  {rfq.orderStatus ? (
                    <StatusBadge value={rfq.orderStatus} />
                  ) : (
                    '—'
                  )}
                </div>
              </div>
            </div>
            {rfq.orderLines.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">Order products</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {rfq.orderLines.map((line) => (
                    <div
                      key={line.orderLineId}
                      className="rounded-md border p-3 text-sm"
                    >
                      <p className="font-medium">{line.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {line.productSku} · {line.quantity} {line.unitOfMeasure}{' '}
                        · {formatINR(line.lineTotal, numberFormatStyle)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {rfq.status === 'AWARDED' && (
        <Card className="mb-6 border-success/40">
          <CardHeader>
            <CardTitle className="text-base">Award Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {/* Awardee — the winning partner, front and centre. */}
            <div className="rounded-md border border-success/40 bg-success/10 p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Awarded to
              </div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-base font-semibold">
                  {awardedInvitee?.partnerName ?? '—'}
                </span>
                {awardedInvitee && (
                  <span className="text-xs text-muted-foreground">
                    {humanizeEnum(awardedInvitee.partnerType)}
                  </span>
                )}
              </div>
              {awardedColumn?.totalQuotedValue && (
                <div className="mt-1 text-sm">
                  <span className="text-muted-foreground">Awarded value: </span>
                  <span className="font-semibold text-success">
                    {formatINR(
                      awardedColumn.totalQuotedValue,
                      numberFormatStyle,
                    )}
                  </span>
                </div>
              )}
            </div>

            {/* Winning quote's commercial terms, when the comparison has loaded. */}
            {awardedColumn && (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <Info
                  label="Lead Time"
                  value={
                    awardedColumn.quotedLeadTimeDays != null
                      ? `${awardedColumn.quotedLeadTimeDays} days`
                      : '—'
                  }
                />
                <Info
                  label="Payment Terms"
                  value={awardedColumn.paymentTermsOffered ?? '—'}
                />
                <Info
                  label="Quote Validity"
                  value={
                    awardedColumn.validityDays != null
                      ? `${awardedColumn.validityDays} days`
                      : '—'
                  }
                />
              </div>
            )}

            <div className="space-y-1 border-t pt-3">
              <div>
                <span className="text-muted-foreground">Decided by: </span>
                <span className="font-medium">
                  {rfq.awardDecisionByName ?? '—'}
                </span>
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
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Line Items</CardTitle>
        </CardHeader>
        {editing ? (
          <CardContent className="space-y-3">
            {editLines.map((line) => {
              const item = items.find((it) => it.id === line.itemId) ?? null;
              return (
                <div
                  key={line.key}
                  className="grid items-end gap-3 md:grid-cols-[minmax(200px,1.3fr)_110px_130px_minmax(200px,1fr)_40px]"
                >
                  <Field label="Item">
                    <ItemPicker
                      items={items}
                      value={line.itemId}
                      onValueChange={(itemId) =>
                        updateEditLine(line.key, { itemId })
                      }
                    />
                  </Field>
                  <Field label="Qty">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity}
                      onChange={(e) =>
                        updateEditLine(line.key, { quantity: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Target Price">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.targetPrice}
                      onChange={(e) =>
                        updateEditLine(line.key, {
                          targetPrice: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field
                    label={`Specification Notes${item ? '' : ' (pick an item)'}`}
                  >
                    <Input
                      value={line.specificationNotes}
                      onChange={(e) =>
                        updateEditLine(line.key, {
                          specificationNotes: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setEditLines((prev) =>
                        prev.length > 1
                          ? prev.filter((row) => row.key !== line.key)
                          : prev,
                      )
                    }
                    disabled={editLines.length === 1}
                    aria-label="Remove line"
                    title={
                      editLines.length === 1
                        ? 'An RFQ needs at least one line'
                        : 'Remove this line'
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
            <div className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addEditLine}
              >
                <Plus className="size-4" /> Add line
              </Button>
            </div>
          </CardContent>
        ) : (
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>UoM</TableHead>
                  <TableHead>Target Price</TableHead>
                  <TableHead>Specification Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rfq.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <div className="font-medium">{line.itemName ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">
                        {line.itemCode ?? ''}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {line.quantity}
                    </TableCell>
                    <TableCell>{line.unitOfMeasure}</TableCell>
                    <TableCell>
                      {line.targetPrice
                        ? `₹${Number(line.targetPrice).toLocaleString('en-IN', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {line.specificationNotes ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">BOM & technical drawings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            BOMs are rendered live from the current released revision. Internal
            costs are never included. Drawing uploads support files up to 500
            MB.
          </p>
          {canManage && (
            <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
              <Field label="Attach to">
                <Select
                  value={drawingLineId}
                  onChange={(event) => setDrawingLineId(event.target.value)}
                  className="min-w-64"
                >
                  <option value="">Whole RFQ (general document)</option>
                  {rfq.lines.map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.itemCode} - {line.itemName}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
                <Upload className="size-4" />
                {uploadingDrawing ? 'Uploading...' : 'Attach drawing'}
                <input
                  type="file"
                  className="sr-only"
                  disabled={uploadingDrawing}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadDrawing(file);
                    event.target.value = '';
                  }}
                />
              </label>
            </div>
          )}

          {(technical?.attachments.length ?? 0) > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Attachments</h3>
              {technical?.attachments.map((file) => {
                const line = rfq.lines.find(
                  (item) => item.id === file.rfqLineId,
                );
                return (
                  <div
                    key={file.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        <FileText className="mr-1 inline size-4" />
                        {file.fileName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {line
                          ? `${line.itemCode} - ${line.itemName}`
                          : 'General RFQ document'}{' '}
                        · {(file.fileSize / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadDrawing(file.id)}
                      >
                        <Download className="size-4" /> Download
                      </Button>
                      {canManage && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            void deleteDrawing(file.id, file.fileName)
                          }
                        >
                          <Trash2 className="size-4" /> Delete
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-3">
            {rfq.lines.map((line) => {
              const bom = technical?.lineBoms.find(
                (item) => item.rfqLineId === line.id,
              );
              return (
                <details key={line.id} className="rounded-md border p-3">
                  <summary className="cursor-pointer text-sm font-semibold">
                    {line.itemCode} - {line.itemName}{' '}
                    <span className="font-normal text-muted-foreground">
                      {bom?.revisionNumber
                        ? `· Released BOM Rev ${bom.revisionNumber}`
                        : '· No released BOM'}
                    </span>
                  </summary>
                  {bom && bom.components.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Component</TableHead>
                          <TableHead className="text-right">
                            Sourcing Qty
                          </TableHead>
                          <TableHead>Specification</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bom.components.map((component) => (
                          <TableRow key={component.itemId}>
                            <TableCell>
                              {component.itemCode} - {component.itemName}
                            </TableCell>
                            <TableCell className="text-right">
                              {component.quantity} {component.unitOfMeasure}
                            </TableCell>
                            <TableCell>
                              {component.specification ?? '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </details>
              );
            })}
          </div>
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
                  {showQuotedValue && (
                    <TableHead className="text-right">Quoted Value</TableHead>
                  )}
                  {showTokens && <TableHead>Quote Link</TableHead>}
                  {canManage && (isDraft || isClosed) && (
                    <TableHead className={isClosed ? '' : 'w-10'} />
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeInvitees.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">
                      {inv.partnerName ?? '—'}
                    </TableCell>
                    <TableCell>{humanizeEnum(inv.partnerType)}</TableCell>
                    <TableCell>
                      <StatusBadge value={inv.qualificationStatusSnapshot} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge value={inv.quoteStatus} />
                        {/* Which revision they are on, once past the original. */}
                        {inv.submittedRevisionCount > 1 && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                            Rev {inv.submittedRevisionCount}
                          </span>
                        )}
                        {inv.revisionPending && (
                          <span
                            className="rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning-foreground"
                            title={
                              inv.revisionNote
                                ? `Asked: ${inv.revisionNote}`
                                : undefined
                            }
                          >
                            Revision requested
                            {inv.revisionDeadline
                              ? ` · due ${dateOnlyStr(inv.revisionDeadline)}`
                              : ''}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    {showQuotedValue &&
                      (() => {
                        const col = quoteTotals.get(inv.id);
                        const isAwardedInvitee =
                          rfq.awardedInviteeId === inv.id;
                        return (
                          <TableCell className="text-right">
                            {col && col.totalQuotedValue ? (
                              <span
                                className={
                                  isAwardedInvitee
                                    ? 'font-semibold text-success'
                                    : col.isLowestTotal
                                      ? 'font-medium text-success'
                                      : 'font-medium'
                                }
                              >
                                {formatINR(
                                  col.totalQuotedValue,
                                  numberFormatStyle,
                                )}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        );
                      })()}
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
                    {canManage && (isDraft || isClosed) && (
                      <TableCell className="text-right">
                        {isDraft && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={acting}
                            onClick={() =>
                              handleRemoveInvitee(inv.id, inv.partnerName)
                            }
                            aria-label="Remove invitee"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                        {/* Negotiation follows a quote: only an invitee who
                            actually submitted can be asked to revise. */}
                        {isClosed &&
                          inv.quoteStatus === 'SUBMITTED' &&
                          !inv.revisionPending && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={acting}
                              onClick={() => setRevisionTarget(inv)}
                            >
                              <RefreshCw className="size-4" />
                              Request revised quote
                            </Button>
                          )}
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
                <Field
                  label={partnerType === 'SUPPLIER' ? 'Supplier' : 'Vendor'}
                >
                  <Select
                    value={partnerId}
                    onChange={(e) => setPartnerId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {availablePartners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.companyName} — {humanizeEnum(p.status)}
                        {p.statusOverridden ? ' (manually overridden)' : ''}
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
                  At least {MIN_INVITEES} invitees are required before the RFQ
                  can be issued.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <RequestRevisionDialog
        invitee={revisionTarget}
        submitting={acting}
        onClose={() => setRevisionTarget(null)}
        onRequest={handleRequestRevision}
      />

      <RejectRfqDialog
        open={rejectOpen}
        rfqNumber={rfq.rfqNumber}
        submitting={acting}
        onClose={() => setRejectOpen(false)}
        onReject={handleReject}
      />
    </PageContainer>
  );
}

/**
 * Reopen ONE invitee's quote link for a negotiated revision. The deadline is
 * required (it is also the reopened link's expiry, so it cannot be left open
 * indefinitely); the note is the negotiation ask the vendor sees on the link.
 */
function RequestRevisionDialog({
  invitee,
  submitting,
  onClose,
  onRequest,
}: {
  invitee: RfqInvitee | null;
  submitting: boolean;
  onClose: () => void;
  onRequest: (input: {
    revisionDeadline: string;
    note?: string;
    password?: string;
  }) => void;
}) {
  const [deadline, setDeadline] = useState('');
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Reset per target so a previous partner's ask never leaks into the next one.
  useEffect(() => {
    if (!invitee) return;
    setDeadline(
      toDateTimeInput(new Date(Date.now() + 7 * 86_400_000).toISOString()),
    );
    setNote('');
    setPassword('');
    setError(null);
  }, [invitee]);

  function submit() {
    if (!deadline) {
      setError('A revision deadline is required.');
      return;
    }
    const when = new Date(deadline);
    if (Number.isNaN(when.getTime()) || when <= new Date()) {
      setError('The revision deadline must be in the future.');
      return;
    }
    onRequest({
      revisionDeadline: when.toISOString(),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(password.trim() ? { password: password.trim() } : {}),
    });
  }

  if (!invitee) return null;
  const nextRevision = (invitee.submittedRevisionCount || 1) + 1;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Request revised quote — {invitee.partnerName ?? 'partner'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This reopens {invitee.partnerName ?? 'this partner'}&apos;s
            submission link only — no other invitee is affected and the RFQ
            stays closed. Their new quote is captured as{' '}
            <span className="font-medium text-foreground">
              Revision {nextRevision}
            </span>
            ; the existing quote is kept in full and stays visible in the
            comparison. A new link is generated, so the old one stops working —
            copy it to them from the Quote Link column afterwards.
          </p>
          <Field label="Revision deadline" htmlFor="rfq-revision-deadline">
            <Input
              id="rfq-revision-deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => {
                setDeadline(e.target.value);
                setError(null);
              }}
            />
          </Field>
          <Field
            label="What are you asking them to revise? (optional)"
            htmlFor="rfq-revision-note"
          >
            <Textarea
              id="rfq-revision-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. Hold the unit price but improve freight and lead time to 20 days."
            />
          </Field>
          <Field
            label="New link password (optional — blank keeps the current one)"
            htmlFor="rfq-revision-password"
          >
            <Input
              id="rfq-revision-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Reopening…' : 'Reopen link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reject dialog — a comment is required (mirrors the server rule). */
function RejectRfqDialog({
  open,
  rfqNumber,
  submitting,
  onClose,
  onReject,
}: {
  open: boolean;
  rfqNumber: string;
  submitting: boolean;
  onClose: () => void;
  onReject: (comment: string) => void;
}) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!comment.trim()) {
      setError('A rejection comment is required.');
      return;
    }
    onReject(comment.trim());
  }

  if (!open) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reject {rfqNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Rejecting returns this RFQ to SCM as an editable draft. The comment
            below is shown to them so they can revise and resubmit for approval.
          </p>
          <Field label="Reason (required)" htmlFor="rfq-reject-reason">
            <Textarea
              id="rfq-reject-reason"
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                setError(null);
              }}
              rows={3}
              placeholder="Explain what needs to change before this RFQ can be approved…"
            />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={submitting}>
            {submitting ? 'Rejecting…' : 'Reject RFQ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}
