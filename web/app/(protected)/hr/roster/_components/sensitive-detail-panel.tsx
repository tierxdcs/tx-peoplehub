'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '../../../../lib/api';
import { BankDetails, Compensation, Statutory } from '../../../../lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Field } from '../../../../components/ui/field';
import { Skeleton } from '../../../../components/ui/skeleton';
import { useToast } from '../../../../components/ui/toaster';
import { cn } from '../../../../lib/utils';

type Tab = 'compensation' | 'statutory' | 'banking';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

interface SensitiveDetailPanelProps {
  employeeId: string;
  employeeName: string;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

/**
 * Admin / HR-Manager only (the roster only renders the trigger for them, and
 * the backend enforces the same). Each tab fetches its endpoint on open. The
 * PII audit warning is a compliance notice — never removed.
 *
 * Statutory + Banking are editable here (add or update, encrypted + gated
 * server-side). Compensation is read-only in this panel — it's an
 * effective-dated salary structure managed on the Salary Structures page, so
 * editing it here would lose that history.
 */
export function SensitiveDetailPanel({
  employeeId,
  employeeName,
  onClose,
}: SensitiveDetailPanelProps) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('compensation');
  const [compensation, setCompensation] = useState<Compensation | null>(null);
  const [statutory, setStatutory] = useState<Statutory | null>(null);
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null);
  // Track which tabs have been fetched, so "no record" (404) is distinct from
  // "not loaded yet" — a 404 on an editable tab means "show the Add form".
  const [loaded, setLoaded] = useState<Record<Tab, boolean>>({
    compensation: false,
    statutory: false,
    banking: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  function selectTab(tab: Tab) {
    setActiveTab(tab);
    setError(null);
    setEditing(false);
    if (loaded[tab]) return;

    setLoading(true);
    const markLoaded = () => setLoaded((l) => ({ ...l, [tab]: true }));
    const fetchers: Record<Tab, () => Promise<void>> = {
      compensation: () =>
        apiFetch<Compensation>(`/employees/${employeeId}/compensation`)
          .then(setCompensation)
          .catch((e) => onLoadError(e, 'compensation')),
      statutory: () =>
        apiFetch<Statutory>(`/employees/${employeeId}/statutory`)
          .then(setStatutory)
          .catch((e) => onLoadError(e, 'statutory')),
      banking: () =>
        apiFetch<BankDetails>(`/employees/${employeeId}/bank-details`)
          .then(setBankDetails)
          .catch((e) => onLoadError(e, 'banking')),
    };
    fetchers[tab]().finally(() => {
      markLoaded();
      setLoading(false);
    });
  }

  // A 404 means "no record yet" — not an error for the editable tabs, where it
  // just means the Add form should show. Other failures surface as errors.
  function onLoadError(e: unknown, tab: Tab) {
    if (e instanceof ApiError && e.statusCode === 404) return;
    setError(
      tab === 'compensation'
        ? 'Failed to load compensation'
        : tab === 'statutory'
          ? 'Failed to load statutory info'
          : 'Failed to load bank details',
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'compensation', label: 'Compensation' },
    { key: 'statutory', label: 'Statutory' },
    { key: 'banking', label: 'Banking' },
  ];

  const editable = activeTab === 'statutory' || activeTab === 'banking';
  const currentEmpty =
    (activeTab === 'statutory' && !statutory) ||
    (activeTab === 'banking' && !bankDetails);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{employeeName} — Sensitive Details</DialogTitle>
        </DialogHeader>

        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          You are viewing sensitive PII. This action is recorded in the audit
          log.
        </div>

        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => selectTab(t.key)}
              className={cn(
                'flex-1 rounded-md px-3 py-1 text-sm font-medium transition-colors',
                activeTab === t.key
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-[140px]">
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Compensation — read-only (managed on the Salary Structures page). */}
          {!loading && activeTab === 'compensation' && (
            <div>
              {compensation ? (
                <>
                  <Row label="Basic salary" value={currency.format(Number(compensation.basicSalary))} />
                  <Row label="HRA" value={currency.format(Number(compensation.hra))} />
                  <Row label="Effective date" value={compensation.effectiveDate} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No compensation on file. Set it on the Salary Structures page
                  (it&rsquo;s effective-dated there).
                </p>
              )}
            </div>
          )}

          {/* Statutory — editable. */}
          {!loading && !error && activeTab === 'statutory' && (
            editing ? (
              <StatutoryForm
                employeeId={employeeId}
                initial={statutory}
                onCancel={() => setEditing(false)}
                onSaved={(next) => {
                  setStatutory(next);
                  setEditing(false);
                  toast.success('Statutory info saved.');
                }}
              />
            ) : statutory ? (
              <>
                <Row label="PAN number" value={statutory.panNumber} />
                <Row label="Aadhaar (last 4)" value={statutory.aadhaarLast4} />
                <Row label="PF account number" value={statutory.pfAccountNumber} />
                <Row label="ESIC number" value={statutory.esicNumber ?? '—'} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No statutory info on file yet.
              </p>
            )
          )}

          {/* Banking — editable. */}
          {!loading && !error && activeTab === 'banking' && (
            editing ? (
              <BankForm
                employeeId={employeeId}
                initial={bankDetails}
                onCancel={() => setEditing(false)}
                onSaved={(next) => {
                  setBankDetails(next);
                  setEditing(false);
                  toast.success('Bank details saved.');
                }}
              />
            ) : bankDetails ? (
              <>
                <Row label="Bank account number" value={bankDetails.bankAccountNumber} />
                <Row label="IFSC code" value={bankDetails.ifscCode} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No bank details on file yet.
              </p>
            )
          )}
        </div>

        <div className="flex justify-between">
          {/* Edit / Add — only on editable tabs and only in read mode. */}
          {editable && !editing && !loading && !error ? (
            <Button variant="outline" onClick={() => setEditing(true)}>
              {currentEmpty ? 'Add details' : 'Edit'}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatutoryForm({
  employeeId,
  initial,
  onCancel,
  onSaved,
}: {
  employeeId: string;
  initial: Statutory | null;
  onCancel: () => void;
  onSaved: (next: Statutory) => void;
}) {
  const [panNumber, setPanNumber] = useState(initial?.panNumber ?? '');
  const [aadhaarLast4, setAadhaarLast4] = useState(initial?.aadhaarLast4 ?? '');
  const [pfAccountNumber, setPfAccountNumber] = useState(initial?.pfAccountNumber ?? '');
  const [esicNumber, setEsicNumber] = useState(initial?.esicNumber ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!panNumber || aadhaarLast4.length !== 4 || !pfAccountNumber) {
      setError('PAN, 4-digit Aadhaar, and PF account number are required.');
      return;
    }
    setSaving(true);
    try {
      const next = await apiFetch<Statutory>(
        `/employees/${employeeId}/statutory`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            panNumber,
            aadhaarLast4,
            pfAccountNumber,
            ...(esicNumber.trim() ? { esicNumber: esicNumber.trim() } : {}),
          }),
        },
      );
      onSaved(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Field label="PAN number" required>
        <Input value={panNumber} onChange={(e) => setPanNumber(e.target.value.toUpperCase())} />
      </Field>
      <Field label="Aadhaar (last 4 only)" required>
        <Input
          value={aadhaarLast4}
          onChange={(e) => setAadhaarLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          maxLength={4}
        />
      </Field>
      <Field label="PF account number" required>
        <Input value={pfAccountNumber} onChange={(e) => setPfAccountNumber(e.target.value)} />
      </Field>
      <Field label="ESIC number (optional)">
        <Input value={esicNumber} onChange={(e) => setEsicNumber(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  );
}

function BankForm({
  employeeId,
  initial,
  onCancel,
  onSaved,
}: {
  employeeId: string;
  initial: BankDetails | null;
  onCancel: () => void;
  onSaved: (next: BankDetails) => void;
}) {
  const [bankAccountNumber, setBankAccountNumber] = useState(initial?.bankAccountNumber ?? '');
  const [ifscCode, setIfscCode] = useState(initial?.ifscCode ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (bankAccountNumber.trim().length < 4 || !ifscCode.trim()) {
      setError('A valid account number and IFSC code are required.');
      return;
    }
    setSaving(true);
    try {
      const next = await apiFetch<BankDetails>(
        `/employees/${employeeId}/bank-details`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            bankAccountNumber: bankAccountNumber.trim(),
            ifscCode: ifscCode.trim(),
          }),
        },
      );
      onSaved(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Field label="Bank account number" required>
        <Input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} />
      </Field>
      <Field label="IFSC code" required>
        <Input value={ifscCode} onChange={(e) => setIfscCode(e.target.value.toUpperCase())} />
      </Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  );
}
