'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarRange } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { PayrollRun } from '../../../lib/types';
import {
  SCard,
  SIGNAL_BTN_GHOST,
  SIGNAL_BTN_PRIMARY,
  SIGNAL_DIALOG,
  SIGNAL_DIALOG_TITLE,
  SignalHeader,
  SignalPage,
} from '../../../components/ui/signal';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { Field } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';
import { StatusBadge } from '../../../components/ui/status-badge';
import { cn } from '../../../lib/utils';
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

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function PayrollRunsPage() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRuns(await apiFetch<PayrollRun[]>('/payroll-runs'));
    } catch {
      setError('Failed to load payroll runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SignalPage>
      <SignalHeader
        title="Payroll Runs"
        description="Monthly payroll cycles. Process to generate payslips, then lock to finalize."
        actions={<Button onClick={() => setShowForm(true)}>New Payroll Run</Button>}
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <SCard className="overflow-hidden">
          {loading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <EmptyState
              icon={CalendarRange}
              title="No payroll runs yet"
              description="Create a run for a month to begin generating payslips."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Processed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {MONTH_NAMES[r.month - 1]} {r.year}
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={r.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.processedAt
                        ? new Date(r.processedAt).toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/admin/payroll-runs/${r.id}`)}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </SCard>

      {showForm && (
        <NewRunForm
          onClose={() => setShowForm(false)}
          onCreated={(run) => {
            setShowForm(false);
            router.push(`/admin/payroll-runs/${run.id}`);
          }}
        />
      )}
      </div>
    </SignalPage>
  );
}

function NewRunForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (run: PayrollRun) => void;
}) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const run = await apiFetch<PayrollRun>('/payroll-runs', {
        method: 'POST',
        body: JSON.stringify({ month, year }),
      });
      onCreated(run);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create run');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('max-w-sm', SIGNAL_DIALOG)}>
        <DialogHeader>
          <DialogTitle className={SIGNAL_DIALOG_TITLE}>New Payroll Run</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Month">
            <Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>{name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Year">
            <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <button type="button" className={SIGNAL_BTN_GHOST} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={SIGNAL_BTN_PRIMARY} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
