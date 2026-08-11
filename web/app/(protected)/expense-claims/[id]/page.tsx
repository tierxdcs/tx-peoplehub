'use client';

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Download, Plus, Trash2, Upload } from 'lucide-react';
import { ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { useFinanceAccess } from '../../../lib/use-finance-access';
import {
  addClaimLine,
  approveClaim,
  confirmReceipt,
  createReceiptUploadUrl,
  getClaim,
  listActiveCategories,
  payClaim,
  receiptDownloadUrl,
  rejectClaim,
  removeClaimLine,
  submitClaim,
  type ExpenseCategory,
  type ExpenseClaim,
} from '../../../lib/expense-claims';
import { uploadToPresignedUrl } from '../../../lib/vault-api';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import { dateOnlyStr, todayDateStr } from '../../../lib/date';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';
import { PageContainer } from '../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Field } from '../../../components/ui/field';
import { StatusBadge } from '../../../components/ui/status-badge';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

export default function ExpenseClaimDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const { isAccountsHead, loading: accessLoading } = useFinanceAccess();
  const { style } = useNumberFormat();

  const [claim, setClaim] = useState<ExpenseClaim | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await getClaim(id);
      setClaim(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load claim');
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    listActiveCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const isOwner = !!user && claim?.employeeId === user.sub;
  const isApprover = !!user && (user.role === 'SUPER_ADMIN' || isAccountsHead);
  // Mirrors the server rule: a Super Admin may approve their own claim; the
  // Accounts Head cannot — hide the buttons rather than surface a 403.
  const canApprove =
    isApprover && (user?.role === 'SUPER_ADMIN' || !isOwner);
  const isDraft = claim?.status === 'DRAFT';
  const isSubmitted = claim?.status === 'SUBMITTED';
  const isApproved = claim?.status === 'APPROVED';

  async function openReceipt(receiptId: string) {
    try {
      const { url } = await receiptDownloadUrl(receiptId);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to open receipt');
    }
  }

  async function handleSubmit() {
    if (!claim) return;
    if (
      !(await confirm({
        title: 'Submit for approval',
        description: `Submit ${claim.claimNumber} for approval? You won't be able to edit it after submitting.`,
        confirmLabel: 'Submit',
      }))
    )
      return;
    setActing(true);
    try {
      setClaim(await submitClaim(claim.id));
      toast.success('Claim submitted for approval');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to submit');
    } finally {
      setActing(false);
    }
  }

  async function handleApprove() {
    if (!claim) return;
    if (
      !(await confirm({
        title: 'Approve claim',
        description: `Approve ${claim.claimNumber} for ${formatINR(claim.totalAmount, style)}? This posts the approval journal to the general ledger.`,
        confirmLabel: 'Approve',
      }))
    )
      return;
    setActing(true);
    try {
      setClaim(await approveClaim(claim.id));
      toast.success('Claim approved and journal posted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to approve');
    } finally {
      setActing(false);
    }
  }

  async function handlePay() {
    if (!claim) return;
    if (
      !(await confirm({
        title: 'Mark as paid',
        description: `Mark ${claim.claimNumber} as paid? This posts the reimbursement journal (debit Employee Reimbursements Payable, credit Cash and Bank).`,
        confirmLabel: 'Mark paid',
      }))
    )
      return;
    setActing(true);
    try {
      setClaim(await payClaim(claim.id));
      toast.success('Claim marked paid and reimbursement journal posted');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to mark paid');
    } finally {
      setActing(false);
    }
  }

  async function handleReject(comment: string) {
    if (!claim) return;
    setActing(true);
    try {
      setClaim(await rejectClaim(claim.id, comment));
      setRejectOpen(false);
      toast.success('Claim rejected');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to reject');
    } finally {
      setActing(false);
    }
  }

  async function handleRemoveLine(lineId: string) {
    if (!claim) return;
    if (
      !(await confirm({
        title: 'Remove line',
        description: 'Remove this expense line from the claim?',
        confirmLabel: 'Remove',
        destructive: true,
      }))
    )
      return;
    try {
      setClaim(await removeClaimLine(claim.id, lineId));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to remove line');
    }
  }

  if (loading || accessLoading) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }

  if (error || !claim) {
    return (
      <PageContainer>
        <p className="text-sm text-destructive">{error ?? 'Claim not found'}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => router.push('/expense-claims')}
        >
          Back
        </Button>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Link
        href={isApprover && !isOwner ? '/finance/expense-claims' : '/expense-claims'}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {claim.claimNumber}
            <StatusBadge value={claim.status} />
          </h1>
          <p className="mt-1 text-muted-foreground">{claim.title}</p>
          {claim.employeeName && (
            <p className="mt-1 text-sm text-muted-foreground">
              Claimant: {claim.employeeName}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isOwner && isDraft && (
            <Button
              onClick={handleSubmit}
              disabled={acting || claim.lines.length === 0}
              title={
                claim.lines.length === 0
                  ? 'Add at least one line before submitting'
                  : undefined
              }
            >
              Submit for approval
            </Button>
          )}
          {canApprove && isSubmitted && (
            <>
              <Button onClick={handleApprove} disabled={acting}>
                Approve
              </Button>
              <Button
                variant="destructive"
                onClick={() => setRejectOpen(true)}
                disabled={acting}
              >
                Reject
              </Button>
            </>
          )}
          {canApprove && isApproved && (
            <Button onClick={handlePay} disabled={acting}>
              Mark as paid
            </Button>
          )}
        </div>
      </div>

      {claim.status === 'REJECTED' && claim.rejectionComment && (
        <Card className="mb-4 border-destructive/40">
          <CardContent className="py-4">
            <p className="text-sm font-medium text-destructive">
              Rejected{claim.rejectedByName ? ` by ${claim.rejectedByName}` : ''}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {claim.rejectionComment}
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Expense lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {isOwner && isDraft && (
                  <TableHead className="text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {claim.lines.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isOwner && isDraft ? 6 : 5}
                    className="text-center text-muted-foreground"
                  >
                    No lines yet.
                  </TableCell>
                </TableRow>
              ) : (
                claim.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{dateOnlyStr(l.expenseDate)}</TableCell>
                    <TableCell>{l.categoryName}</TableCell>
                    <TableCell>{l.description}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => openReceipt(l.receiptId)}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Download className="size-3.5" />
                        {l.receiptFilename}
                      </button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatINR(l.amount, style)}
                    </TableCell>
                    {isOwner && isDraft && (
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label="Remove line"
                          onClick={() => handleRemoveLine(l.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <div className="flex items-center justify-end gap-6 border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="text-base font-semibold tabular-nums">
              {formatINR(claim.totalAmount, style)}
            </span>
          </div>
        </CardContent>
      </Card>

      {isOwner && isDraft && (
        <AddLineForm
          claimId={claim.id}
          categories={categories}
          onAdded={setClaim}
        />
      )}

      <RejectDialog
        open={rejectOpen}
        claimNumber={claim.claimNumber}
        submitting={acting}
        onClose={() => setRejectOpen(false)}
        onReject={handleReject}
      />
    </PageContainer>
  );
}

/**
 * Adds a line with its mandatory receipt. The receipt is uploaded first
 * (upload-url → presigned PUT → confirm) so it is ACTIVE before the line is
 * created; the backend rejects a line whose receipt is not confirmed.
 */
function AddLineForm({
  claimId,
  categories,
  onAdded,
}: {
  claimId: string;
  categories: ExpenseCategory[];
  onAdded: (claim: ExpenseClaim) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [expenseDate, setExpenseDate] = useState(todayDateStr());
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const amountNum = Number(amount);
  const canAdd = useMemo(
    () =>
      !!expenseDate &&
      !!categoryId &&
      !!description.trim() &&
      amountNum > 0 &&
      !!file &&
      !saving,
    [expenseDate, categoryId, description, amountNum, file, saving],
  );

  function reset() {
    setExpenseDate(todayDateStr());
    setCategoryId('');
    setDescription('');
    setAmount('');
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!canAdd || !file) return;
    setSaving(true);
    try {
      const ticket = await createReceiptUploadUrl({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });
      await uploadToPresignedUrl(ticket.uploadUrl, file);
      await confirmReceipt(ticket.receiptId);
      const updated = await addClaimLine(claimId, {
        expenseDate: new Date(expenseDate).toISOString(),
        categoryId,
        description: description.trim(),
        amount: Number(amountNum.toFixed(2)),
        receiptId: ticket.receiptId,
      });
      onAdded(updated);
      toast.success('Line added');
      reset();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add line');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add expense line</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={add} className="grid gap-4 md:grid-cols-2">
          <Field label="Expense date" htmlFor="line-date" required>
            <Input
              id="line-date"
              type="date"
              value={expenseDate}
              max={todayDateStr()}
              onChange={(e) => setExpenseDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Category" htmlFor="line-category" required>
            <Select
              id="line-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
            >
              <option value="" disabled>
                Select a category…
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Description"
            htmlFor="line-desc"
            required
            className="md:col-span-2"
          >
            <Input
              id="line-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              required
            />
          </Field>
          <Field label="Amount (₹)" htmlFor="line-amount" required>
            <Input
              id="line-amount"
              type="number"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Receipt"
            htmlFor="line-receipt"
            required
            hint="A receipt is mandatory on every line."
          >
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-4" />
                {file ? 'Change file' : 'Choose file'}
              </Button>
              <span className="truncate text-sm text-muted-foreground">
                {file ? file.name : 'No file selected'}
              </span>
              <input
                ref={fileRef}
                id="line-receipt"
                type="file"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </Field>
          <div className="md:col-span-2">
            <Button type="submit" disabled={!canAdd}>
              <Plus className="size-4" />
              {saving ? 'Adding…' : 'Add line'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Reject dialog — a comment is required (mirrors the server rule). */
function RejectDialog({
  open,
  claimNumber,
  submitting,
  onClose,
  onReject,
}: {
  open: boolean;
  claimNumber: string;
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
          <DialogTitle>Reject {claimNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Reason (required)" htmlFor="reject-reason">
            <Textarea
              id="reject-reason"
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                setError(null);
              }}
              rows={3}
              placeholder="Explain why this claim is being rejected…"
            />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={submitting}>
            {submitting ? 'Rejecting…' : 'Reject claim'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
