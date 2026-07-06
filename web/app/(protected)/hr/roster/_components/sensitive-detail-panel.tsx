'use client';

import { useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { BankDetails, Compensation, Statutory } from '../../../../lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';
import { Skeleton } from '../../../../components/ui/skeleton';
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
 * Admin-only. Only ever rendered by the roster page when the viewer is an
 * Admin/SuperAdmin — HR-vertical viewers never see the trigger. Each tab
 * fetches its own endpoint only when opened, not eagerly. The PII audit
 * warning is a compliance notice — restyled, never removed.
 */
export function SensitiveDetailPanel({
  employeeId,
  employeeName,
  onClose,
}: SensitiveDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('compensation');
  const [compensation, setCompensation] = useState<Compensation | null>(null);
  const [statutory, setStatutory] = useState<Statutory | null>(null);
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectTab(tab: Tab) {
    setActiveTab(tab);
    setError(null);

    if (tab === 'compensation' && !compensation) {
      setLoading(true);
      apiFetch<Compensation>(`/employees/${employeeId}/compensation`)
        .then(setCompensation)
        .catch(() => setError('Failed to load compensation'))
        .finally(() => setLoading(false));
    } else if (tab === 'statutory' && !statutory) {
      setLoading(true);
      apiFetch<Statutory>(`/employees/${employeeId}/statutory`)
        .then(setStatutory)
        .catch(() => setError('Failed to load statutory info'))
        .finally(() => setLoading(false));
    } else if (tab === 'banking' && !bankDetails) {
      setLoading(true);
      apiFetch<BankDetails>(`/employees/${employeeId}/bank-details`)
        .then(setBankDetails)
        .catch(() => setError('Failed to load bank details'))
        .finally(() => setLoading(false));
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'compensation', label: 'Compensation' },
    { key: 'statutory', label: 'Statutory' },
    { key: 'banking', label: 'Banking' },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{employeeName} — Sensitive Details</DialogTitle>
        </DialogHeader>

        {/* Compliance notice — audit-logged PII access. Restyled, not removed. */}
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

        <div className="min-h-[120px]">
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {!loading && activeTab === 'compensation' && compensation && (
            <div>
              <Row
                label="Basic salary"
                value={currency.format(Number(compensation.basicSalary))}
              />
              <Row label="HRA" value={currency.format(Number(compensation.hra))} />
              <Row label="Effective date" value={compensation.effectiveDate} />
            </div>
          )}

          {!loading && activeTab === 'statutory' && statutory && (
            <div>
              <Row label="PAN number" value={statutory.panNumber} />
              <Row label="Aadhaar (last 4)" value={statutory.aadhaarLast4} />
              <Row label="PF account number" value={statutory.pfAccountNumber} />
              <Row label="ESIC number" value={statutory.esicNumber ?? '—'} />
            </div>
          )}

          {!loading && activeTab === 'banking' && bankDetails && (
            <div>
              <Row
                label="Bank account number"
                value={bankDetails.bankAccountNumber}
              />
              <Row label="IFSC code" value={bankDetails.ifscCode} />
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
