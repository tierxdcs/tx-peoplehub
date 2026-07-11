'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileSignature, Upload } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../../lib/api';
import { useAuth } from '../../../../../lib/auth-context';
import {
  Customer,
  Employee,
  OrderConfirmationDeliveryType,
  OrderConfirmationQualityReport,
  OrderConfirmationSheet,
} from '../../../../../lib/types';
import { prettyEnum } from '../../../../../lib/sales';
import { todayDateStr } from '../../../../../lib/date';
import { uploadToPresignedUrl } from '../../../../../lib/vault-api';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card';
import { Button } from '../../../../../components/ui/button';
import { Field } from '../../../../../components/ui/field';
import { Input } from '../../../../../components/ui/input';
import { Textarea } from '../../../../../components/ui/textarea';
import { Select } from '../../../../../components/ui/select';
import { Checkbox } from '../../../../../components/ui/checkbox';
import { Switch } from '../../../../../components/ui/switch';
import { StatusBadge } from '../../../../../components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../../../components/ui/dialog';
import { useToast } from '../../../../../components/ui/toaster';
import { useConfirm } from '../../../../../components/ui/confirm';
import { SignatureDisplay } from '../../../../../components/ui/signature-display';
import { SignatureSetupInline } from '../../../../../components/ui/signature-setup-inline';
import { ConfirmationSheetPrintDocument } from '../../../_components/confirmation-sheet-print-document';

const DELIVERY_TYPES: OrderConfirmationDeliveryType[] = [
  'FULL_TRUCKLOAD',
  'PARTIAL_TRUCKLOAD',
  'CUSTOMER_PICKUP_EXWORKS',
  'COURIER_EXPRESS',
  'OTHER',
];

const QUALITY_REPORTS: OrderConfirmationQualityReport[] = [
  'MATERIAL_TEST_CERTIFICATE',
  'FACTORY_ACCEPTANCE_TEST_REPORT',
  'CALIBRATION_CERTIFICATE',
  'COMPLIANCE_CERTIFICATE',
  'OTHER',
];

/** Editable subset of a sheet — mirrors the PATCH body the backend accepts. */
interface DraftForm {
  requirementsOverview: string;
  deliveryDate: string;
  deliveryLocation: string;
  deliveryType: OrderConfirmationDeliveryType | '';
  qualityReportsExpected: OrderConfirmationQualityReport[];
  qualityReportNotes: string;
  installationCommissioningRequired: boolean;
  installationNotes: string;
  warrantyTerms: string;
  paymentMilestones: string;
  siteReadinessRequirements: string;
  specialHandlingInstructions: string;
  packagingType: string;
  protectiveMeasures: string;
  packagingComplianceStandard: string;
  labelingRequirements: string;
  customerPackagingSpecReference: string;
  customerContactName: string;
  customerContactPhone: string;
  customerContactEmail: string;
}

/** Epoch sentinel the backend stores for an unset DRAFT deliveryDate. */
const EPOCH_DATE = '1970-01-01';

function toForm(sheet: OrderConfirmationSheet): DraftForm {
  const deliveryDay = sheet.deliveryDate ? sheet.deliveryDate.slice(0, 10) : '';
  return {
    requirementsOverview: sheet.requirementsOverview ?? '',
    // Treat the unset-DRAFT epoch sentinel as blank so the picker shows empty,
    // not a bogus past date.
    deliveryDate: deliveryDay === EPOCH_DATE ? '' : deliveryDay,
    deliveryLocation: sheet.deliveryLocation ?? '',
    deliveryType: sheet.deliveryType ?? '',
    qualityReportsExpected: sheet.qualityReportsExpected ?? [],
    qualityReportNotes: sheet.qualityReportNotes ?? '',
    installationCommissioningRequired:
      sheet.installationCommissioningRequired ?? false,
    installationNotes: sheet.installationNotes ?? '',
    warrantyTerms: sheet.warrantyTerms ?? '',
    paymentMilestones: sheet.paymentMilestones ?? '',
    siteReadinessRequirements: sheet.siteReadinessRequirements ?? '',
    specialHandlingInstructions: sheet.specialHandlingInstructions ?? '',
    packagingType: sheet.packagingType ?? '',
    protectiveMeasures: sheet.protectiveMeasures ?? '',
    packagingComplianceStandard: sheet.packagingComplianceStandard ?? '',
    labelingRequirements: sheet.labelingRequirements ?? '',
    customerPackagingSpecReference: sheet.customerPackagingSpecReference ?? '',
    customerContactName: sheet.customerContactName ?? '',
    customerContactPhone: sheet.customerContactPhone ?? '',
    customerContactEmail: sheet.customerContactEmail ?? '',
  };
}

/** Trim strings and drop empty optionals so PATCH sends nulls, not ''. */
function toPatchBody(form: DraftForm): Record<string, unknown> {
  const opt = (v: string) => (v.trim() === '' ? null : v.trim());
  return {
    requirementsOverview: form.requirementsOverview.trim(),
    deliveryDate: opt(form.deliveryDate),
    deliveryLocation: form.deliveryLocation.trim(),
    deliveryType: form.deliveryType === '' ? null : form.deliveryType,
    qualityReportsExpected: form.qualityReportsExpected,
    qualityReportNotes: opt(form.qualityReportNotes),
    installationCommissioningRequired: form.installationCommissioningRequired,
    installationNotes: opt(form.installationNotes),
    warrantyTerms: form.warrantyTerms.trim(),
    paymentMilestones: form.paymentMilestones.trim(),
    siteReadinessRequirements: opt(form.siteReadinessRequirements),
    specialHandlingInstructions: opt(form.specialHandlingInstructions),
    packagingType: form.packagingType.trim(),
    protectiveMeasures: form.protectiveMeasures.trim(),
    packagingComplianceStandard: opt(form.packagingComplianceStandard),
    labelingRequirements: form.labelingRequirements.trim(),
    customerPackagingSpecReference: opt(form.customerPackagingSpecReference),
    customerContactName: form.customerContactName.trim(),
    customerContactPhone: form.customerContactPhone.trim(),
    customerContactEmail: form.customerContactEmail.trim(),
  };
}

export function ConfirmationSheetsSection({
  orderId,
  canWrite,
  isReviewer,
  customer,
  onLatestExecutedChange,
}: {
  orderId: string;
  canWrite: boolean;
  isReviewer: boolean;
  customer: Customer | null;
  /**
   * Reports whether the order's LATEST sheet is EXECUTED, after each load.
   * Lets the parent gate the CONFIRMED→IN_PRODUCTION status control and
   * re-enable it live when a sheet is signed here (no page reload needed).
   */
  onLatestExecutedChange?: (latestExecuted: boolean) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();

  const [sheets, setSheets] = useState<OrderConfirmationSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [form, setForm] = useState<DraftForm | null>(null);
  // Which sheet the (hidden) print document renders. Defaults to the latest,
  // but any row can be printed — e.g. an EXECUTED sheet that isn't the latest.
  const [printSheetId, setPrintSheetId] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComments, setRejectComments] = useState('');
  const [hasSignature, setHasSignature] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Whether the current user (a would-be countersigner) has a signature set up
  // — drives the just-in-time setup prompt shown beside Countersign.
  useEffect(() => {
    if (!user || !isReviewer) return;
    apiFetch<Employee>(`/employees/${user.sub}`)
      .then((me) => setHasSignature(!!me.signatureText))
      .catch(() => setHasSignature(true));
  }, [user, isReviewer]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiFetch<OrderConfirmationSheet[]>(
        `/orders/${orderId}/confirmation-sheets`,
      );
      setSheets(list);
      const latest = list[0];
      // Keep the editable form in sync with the latest DRAFT only.
      setForm(latest && latest.status === 'DRAFT' ? toForm(latest) : null);
      onLatestExecutedChange?.(latest?.status === 'EXECUTED');
    } catch {
      toast.error('Failed to load confirmation sheets');
    } finally {
      setLoading(false);
    }
  }, [orderId, toast, onLatestExecutedChange]);

  useEffect(() => {
    load();
  }, [load]);

  // Newest first (backend sorts by createdAt desc).
  const latest = sheets[0] ?? null;
  // The sheet the print document currently renders: an explicitly-selected row
  // (any status) or, by default, the latest.
  const printSheet =
    (printSheetId && sheets.find((s) => s.id === printSheetId)) || latest;

  /** Print a specific sheet: point the print doc at it, then invoke print. */
  function printSheetById(id: string) {
    setPrintSheetId(id);
    // Let the print-doc re-render with the chosen sheet before printing.
    setTimeout(() => window.print(), 0);
  }
  // An in-progress sheet blocks creating a new one; REJECTED/EXECUTED don't.
  const hasActiveSheet =
    latest !== null &&
    latest.status !== 'REJECTED' &&
    latest.status !== 'EXECUTED';

  function setField<K extends keyof DraftForm>(key: K, value: DraftForm[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function toggleQualityReport(report: OrderConfirmationQualityReport) {
    setForm((prev) => {
      if (!prev) return prev;
      const has = prev.qualityReportsExpected.includes(report);
      return {
        ...prev,
        qualityReportsExpected: has
          ? prev.qualityReportsExpected.filter((r) => r !== report)
          : [...prev.qualityReportsExpected, report],
      };
    });
  }

  async function createSheet() {
    setActing(true);
    try {
      await apiFetch(`/orders/${orderId}/confirmation-sheets`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast.success('Confirmation sheet created');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to create sheet',
      );
    } finally {
      setActing(false);
    }
  }

  async function saveDraft() {
    if (!latest || !form) return;
    setActing(true);
    try {
      await apiFetch(`/confirmation-sheets/${latest.id}`, {
        method: 'PATCH',
        body: JSON.stringify(toPatchBody(form)),
      });
      toast.success('Draft saved');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setActing(false);
    }
  }

  async function generatePdf() {
    if (!latest || !form) return;
    const ok = await confirm({
      title: 'Generate PDF & lock?',
      description:
        'This locks the sheet for editing and moves it to Awaiting Customer Signature.',
    });
    if (!ok) return;
    setActing(true);
    try {
      // Save latest edits first so generate-pdf validates current values.
      await apiFetch(`/confirmation-sheets/${latest.id}`, {
        method: 'PATCH',
        body: JSON.stringify(toPatchBody(form)),
      });
      await apiFetch(`/confirmation-sheets/${latest.id}/generate-pdf`, {
        method: 'POST',
      });
      toast.success('PDF generated — awaiting customer signature');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to generate PDF',
      );
    } finally {
      setActing(false);
    }
  }

  async function uploadSignedCopy(file: File) {
    if (!latest) return;
    setActing(true);
    try {
      const presign = await apiFetch<{
        storageKey: string;
        uploadUrl: string;
        expiresInSeconds: number;
      }>(`/confirmation-sheets/${latest.id}/signed-copy-upload-url`, {
        method: 'POST',
        body: JSON.stringify({
          contentType: file.type || 'application/octet-stream',
        }),
      });
      await uploadToPresignedUrl(presign.uploadUrl, file);
      await apiFetch(`/confirmation-sheets/${latest.id}/upload-signed-copy`, {
        method: 'POST',
        body: JSON.stringify({ storageKey: presign.storageKey }),
      });
      toast.success('Signed copy uploaded — awaiting internal signature');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to upload signed copy',
      );
    } finally {
      setActing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  /** Open a sheet's uploaded signed copy (the scan stored in R2). */
  async function viewSignedCopy(sheetId: string) {
    try {
      const res = await apiFetch<{
        downloadUrl: string;
        expiresInSeconds: number;
      }>(`/confirmation-sheets/${sheetId}/signed-copy-download-url`);
      // Each call returns a freshly-presigned URL (new X-Amz-Date/signature),
      // so the browser can't serve a stale cached response — no cache-bust
      // query param, which would break the SigV4 signature on R2.
      window.open(res.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to open signed copy',
      );
    }
  }

  /**
   * The row-level "PDF" action. If the sheet has an uploaded signed copy, open
   * that actual scan; otherwise print the generated confirmation-sheet doc.
   * One button, unambiguous per row.
   */
  function openSheetPdf(sheet: OrderConfirmationSheet) {
    if (sheet.hasSignedCopy) {
      viewSignedCopy(sheet.id);
    } else {
      printSheetById(sheet.id);
    }
  }

  async function countersign() {
    if (!latest) return;
    const ok = await confirm({
      title: 'Countersign this confirmation?',
      description:
        'This executes the confirmation sheet. This action cannot be undone.',
    });
    if (!ok) return;
    setActing(true);
    try {
      await apiFetch(`/confirmation-sheets/${latest.id}/sign`, {
        method: 'PATCH',
      });
      toast.success('Confirmation sheet executed');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to sign');
    } finally {
      setActing(false);
    }
  }

  async function submitReject() {
    if (!latest || !rejectComments.trim()) return;
    setActing(true);
    try {
      await apiFetch(`/confirmation-sheets/${latest.id}/reject`, {
        method: 'PATCH',
        body: JSON.stringify({ comments: rejectComments.trim() }),
      });
      toast.success('Confirmation sheet rejected');
      setRejectOpen(false);
      setRejectComments('');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to reject');
    } finally {
      setActing(false);
    }
  }

  async function requestRevision() {
    if (!latest) return;
    const ok = await confirm({
      title: 'Request a new revision?',
      description:
        'This creates a new editable draft revision, pre-filled from this one.',
    });
    if (!ok) return;
    setActing(true);
    try {
      await apiFetch(`/confirmation-sheets/${latest.id}/request-revision`, {
        method: 'POST',
      });
      toast.success('New revision created');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to request revision',
      );
    } finally {
      setActing(false);
    }
  }

  return (
    <>
      {/* Hidden on screen; shown only when printing the selected sheet. */}
      {printSheet && (
        <ConfirmationSheetPrintDocument
          sheet={printSheet}
          customer={customer}
          generatedOn={todayDateStr()}
        />
      )}

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="size-5 text-muted-foreground" />
            Order Confirmation Sheets
          </CardTitle>
          {canWrite && !hasActiveSheet && (
            <Button onClick={createSheet} disabled={acting}>
              {acting ? '…' : 'Create Confirmation Sheet'}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : sheets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No confirmation sheets yet.
            </p>
          ) : (
            <>
              {/* All revisions */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Confirmation #</TableHead>
                    <TableHead className="text-right">Rev</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Signed copy</TableHead>
                    <TableHead>Executed</TableHead>
                    <TableHead className="text-right">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sheets.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        {s.confirmationNumber}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.revisionNumber}
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={s.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.signedCopyUploadedAt
                          ? s.signedCopyUploadedAt.slice(0, 10)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.internalSignedAt
                          ? s.internalSignedAt.slice(0, 10)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Opens the uploaded signed scan if there is one,
                            otherwise prints the generated sheet. */}
                        {s.status !== 'DRAFT' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openSheetPdf(s)}
                          >
                            <Download /> PDF
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {latest && (
                <LatestSheetPanel
                  sheet={latest}
                  form={form}
                  canWrite={canWrite}
                  isReviewer={isReviewer}
                  hasSignature={hasSignature}
                  onSignatureSaved={() => setHasSignature(true)}
                  acting={acting}
                  setField={setField}
                  toggleQualityReport={toggleQualityReport}
                  onSave={saveDraft}
                  onGenerate={generatePdf}
                  onPrint={() => latest && printSheetById(latest.id)}
                  onUploadClick={() => fileInputRef.current?.click()}
                  onCountersign={countersign}
                  onOpenReject={() => setRejectOpen(true)}
                  onRequestRevision={requestRevision}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Hidden file input for the signed-copy upload. Accept PDFs/images —
          this must be the customer-SIGNED scan, not the blank generated PDF. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadSignedCopy(f);
        }}
      />

      {/* Reject dialog — comments mandatory. */}
      <Dialog open={rejectOpen} onOpenChange={(o) => !o && setRejectOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject confirmation sheet</DialogTitle>
            <DialogDescription>
              Explain what needs to change. A new revision can then be
              requested.
            </DialogDescription>
          </DialogHeader>
          <Field label="Comments" required>
            <Textarea
              value={rejectComments}
              onChange={(e) => setRejectComments(e.target.value)}
              placeholder="Reason for rejection…"
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={acting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={submitReject}
              disabled={acting || !rejectComments.trim()}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The action/edit panel for the latest revision, branched on status. */
function LatestSheetPanel({
  sheet,
  form,
  canWrite,
  isReviewer,
  hasSignature,
  onSignatureSaved,
  acting,
  setField,
  toggleQualityReport,
  onSave,
  onGenerate,
  onPrint,
  onUploadClick,
  onCountersign,
  onOpenReject,
  onRequestRevision,
}: {
  sheet: OrderConfirmationSheet;
  form: DraftForm | null;
  canWrite: boolean;
  isReviewer: boolean;
  hasSignature: boolean;
  onSignatureSaved: () => void;
  acting: boolean;
  setField: <K extends keyof DraftForm>(key: K, value: DraftForm[K]) => void;
  toggleQualityReport: (r: OrderConfirmationQualityReport) => void;
  onSave: () => void;
  onGenerate: () => void;
  onPrint: () => void;
  onUploadClick: () => void;
  onCountersign: () => void;
  onOpenReject: () => void;
  onRequestRevision: () => void;
}) {
  return (
    <div className="space-y-4 border-t pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold">
          {sheet.confirmationNumber} · Revision {sheet.revisionNumber}
        </h3>
        <StatusBadge value={sheet.status} />
      </div>

      {sheet.status === 'DRAFT' && form && (
        <DraftEditor
          form={form}
          canWrite={canWrite}
          acting={acting}
          setField={setField}
          toggleQualityReport={toggleQualityReport}
          onSave={onSave}
          onGenerate={onGenerate}
        />
      )}

      {sheet.status === 'AWAITING_CUSTOMER_SIGNATURE' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={onPrint}>
            <Download /> Download PDF
          </Button>
          {canWrite && (
            <Button variant="outline" onClick={onUploadClick} disabled={acting}>
              <Upload /> Upload signed copy
            </Button>
          )}
          {canWrite && (
            <Button
              variant="outline"
              onClick={onRequestRevision}
              disabled={acting}
            >
              Request Revision
            </Button>
          )}
          <p className="w-full text-sm text-muted-foreground">
            Awaiting the customer&apos;s signature. Download the PDF, get it
            physically signed by the customer, then upload the{' '}
            <strong>signed scan</strong> — not the blank generated PDF.
          </p>
        </div>
      )}

      {sheet.status === 'AWAITING_INTERNAL_SIGNATURE' && (
        <div className="flex flex-wrap items-center gap-2">
          {isReviewer && (
            <p className="w-full text-sm text-muted-foreground">
              Review the uploaded signed copy (the <strong>PDF</strong> button
              on this row above) before countersigning.
            </p>
          )}
          {isReviewer && !hasSignature && (
            <div className="w-full">
              <SignatureSetupInline onSaved={onSignatureSaved} />
            </div>
          )}
          {isReviewer && (
            <Button onClick={onCountersign} disabled={acting}>
              Countersign
            </Button>
          )}
          {isReviewer && (
            <Button
              variant="destructive"
              onClick={onOpenReject}
              disabled={acting}
            >
              Reject
            </Button>
          )}
          {canWrite && (
            <Button
              variant="outline"
              onClick={onRequestRevision}
              disabled={acting}
            >
              Request Revision
            </Button>
          )}
          {!isReviewer && (
            <p className="w-full text-sm text-muted-foreground">
              Awaiting countersignature from the Sales Head.
            </p>
          )}
        </div>
      )}

      {sheet.status === 'REJECTED' && (
        <div className="space-y-3">
          {sheet.internalReviewComments && (
            <p className="text-sm">
              <span className="font-semibold">Review comments:</span>{' '}
              {sheet.internalReviewComments}
            </p>
          )}
          {canWrite && (
            <Button
              variant="outline"
              onClick={onRequestRevision}
              disabled={acting}
            >
              Request Revision
            </Button>
          )}
        </div>
      )}

      {sheet.status === 'EXECUTED' && (
        <div className="space-y-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Countersigned by Sales Head
            </div>
            <div className="mt-1">
              <SignatureDisplay
                text={sheet.approverSignatureTextSnapshot}
                font={sheet.approverSignatureFontSnapshot}
                date={
                  sheet.internalSignedAt
                    ? sheet.internalSignedAt.slice(0, 10)
                    : null
                }
              />
            </div>
          </div>
          {/* The uploaded signed scan is available via the row's PDF button. */}
        </div>
      )}
    </div>
  );
}

/** The full editable form for a DRAFT sheet. */
function DraftEditor({
  form,
  canWrite,
  acting,
  setField,
  toggleQualityReport,
  onSave,
  onGenerate,
}: {
  form: DraftForm;
  canWrite: boolean;
  acting: boolean;
  setField: <K extends keyof DraftForm>(key: K, value: DraftForm[K]) => void;
  toggleQualityReport: (r: OrderConfirmationQualityReport) => void;
  onSave: () => void;
  onGenerate: () => void;
}) {
  const disabled = !canWrite || acting;

  return (
    <div className="space-y-4">
      <Field label="Requirements overview" required>
        <Textarea
          value={form.requirementsOverview}
          onChange={(e) => setField('requirementsOverview', e.target.value)}
          disabled={disabled}
        />
      </Field>

      {/* Delivery */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Delivery date" required>
          <Input
            type="date"
            value={form.deliveryDate}
            // Forward-looking: delivery can't be scheduled in the past.
            min={todayDateStr()}
            onChange={(e) => setField('deliveryDate', e.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label="Delivery type" required>
          <Select
            value={form.deliveryType}
            onChange={(e) =>
              setField(
                'deliveryType',
                e.target.value as OrderConfirmationDeliveryType | '',
              )
            }
            disabled={disabled}
          >
            <option value="">Select delivery type…</option>
            {DELIVERY_TYPES.map((t) => (
              <option key={t} value={t}>
                {prettyEnum(t)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Delivery location" required>
        <Input
          value={form.deliveryLocation}
          onChange={(e) => setField('deliveryLocation', e.target.value)}
          disabled={disabled}
        />
      </Field>

      {/* Packaging (required block) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Packaging type" required>
          <Input
            value={form.packagingType}
            onChange={(e) => setField('packagingType', e.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label="Packaging compliance standard">
          <Input
            value={form.packagingComplianceStandard}
            onChange={(e) =>
              setField('packagingComplianceStandard', e.target.value)
            }
            disabled={disabled}
          />
        </Field>
      </div>
      <Field label="Protective measures" required>
        <Textarea
          value={form.protectiveMeasures}
          onChange={(e) => setField('protectiveMeasures', e.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field label="Labeling requirements" required>
        <Textarea
          value={form.labelingRequirements}
          onChange={(e) => setField('labelingRequirements', e.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field label="Customer packaging spec reference">
        <Input
          value={form.customerPackagingSpecReference}
          onChange={(e) =>
            setField('customerPackagingSpecReference', e.target.value)
          }
          disabled={disabled}
        />
      </Field>

      {/* Quality reports */}
      <Field label="Quality reports expected">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {QUALITY_REPORTS.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.qualityReportsExpected.includes(r)}
                onCheckedChange={() => toggleQualityReport(r)}
                disabled={disabled}
              />
              {prettyEnum(r)}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Quality report notes">
        <Textarea
          value={form.qualityReportNotes}
          onChange={(e) => setField('qualityReportNotes', e.target.value)}
          disabled={disabled}
        />
      </Field>

      {/* Installation & commissioning */}
      <Field label="Installation & commissioning">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={form.installationCommissioningRequired}
            onCheckedChange={(v) =>
              setField('installationCommissioningRequired', v)
            }
            disabled={disabled}
          />
          Installation / commissioning required
        </label>
      </Field>
      <Field label="Installation notes">
        <Textarea
          value={form.installationNotes}
          onChange={(e) => setField('installationNotes', e.target.value)}
          disabled={disabled}
        />
      </Field>

      {/* Commercial terms */}
      <Field label="Warranty terms" required>
        <Textarea
          value={form.warrantyTerms}
          onChange={(e) => setField('warrantyTerms', e.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field label="Payment milestones" required>
        <Textarea
          value={form.paymentMilestones}
          onChange={(e) => setField('paymentMilestones', e.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field label="Site readiness requirements">
        <Textarea
          value={form.siteReadinessRequirements}
          onChange={(e) => setField('siteReadinessRequirements', e.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field label="Special handling instructions">
        <Textarea
          value={form.specialHandlingInstructions}
          onChange={(e) =>
            setField('specialHandlingInstructions', e.target.value)
          }
          disabled={disabled}
        />
      </Field>

      {/* Customer coordination contact */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Contact name" required>
          <Input
            value={form.customerContactName}
            onChange={(e) => setField('customerContactName', e.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label="Contact phone" required>
          <Input
            value={form.customerContactPhone}
            onChange={(e) => setField('customerContactPhone', e.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label="Contact email" required>
          <Input
            type="email"
            value={form.customerContactEmail}
            onChange={(e) => setField('customerContactEmail', e.target.value)}
            disabled={disabled}
          />
        </Field>
      </div>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={onSave} disabled={acting}>
            Save
          </Button>
          <Button onClick={onGenerate} disabled={acting}>
            Generate PDF
          </Button>
        </div>
      )}
    </div>
  );
}
