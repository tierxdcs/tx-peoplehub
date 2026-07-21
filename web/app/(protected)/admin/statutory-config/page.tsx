'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { StatutoryConfig, StatutoryConfigType } from '../../../lib/types';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { Field } from '../../../components/ui/field';
import { Skeleton } from '../../../components/ui/skeleton';
import { EmptyState } from '../../../components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

const CONFIG_TYPES: StatutoryConfigType[] = [
  'PF',
  'ESI',
  'PROFESSIONAL_TAX',
  'TDS_SLAB',
  'STANDARD_DEDUCTION',
];

/** Placeholder configData JSON per type — matches StatutoryConfigService's REQUIRED_FIELDS. */
const CONFIG_DATA_PLACEHOLDER: Record<StatutoryConfigType, string> = {
  PF: JSON.stringify(
    { employeeRate: 0.12, employerRate: 0.12, epsRate: 0.0833, wageCeiling: 15000, adminCharge: 0.005 },
    null, 2,
  ),
  ESI: JSON.stringify(
    { employeeRate: 0.0075, employerRate: 0.0325, wageThreshold: 21000 },
    null, 2,
  ),
  PROFESSIONAL_TAX: JSON.stringify(
    { slabs: [{ slabFrom: 0, slabTo: 15000, amount: 0 }] },
    null, 2,
  ),
  TDS_SLAB: JSON.stringify(
    { slabs: [{ slabFrom: 0, slabTo: 300000, rate: 0 }] },
    null, 2,
  ),
  STANDARD_DEDUCTION: JSON.stringify({ amount: 50000 }, null, 2),
};

export default function StatutoryConfigPage() {
  const [items, setItems] = useState<StatutoryConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await apiFetch<StatutoryConfig[]>('/statutory-config'));
    } catch {
      setError('Failed to load statutory config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="Statutory Config"
        description="Effective-dated PF / ESI / PT / TDS / standard-deduction rates used by payroll processing."
        action={<Button onClick={() => setShowForm(true)}>Add Config Version</Button>}
      />

      {/* Compliance guardrail — load-bearing, keep prominent. */}
      <div className="mb-6 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        <p>
          <span className="font-semibold">Verify before use.</span> Statutory
          rates must be checked against current EPFO/ESIC/Income Tax sources
          before a real payroll run. Do not enter production rates without
          compliance sign-off — every payslip generated from configs here is a
          test/placeholder computation until that sign-off is complete.
        </p>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title="No statutory config entries yet"
              description="Payroll processing will fail until at least the required configs are added."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Effective From</TableHead>
                  <TableHead>Effective To</TableHead>
                  <TableHead>Source Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.configType}</TableCell>
                    <TableCell>{c.state ?? '—'}</TableCell>
                    <TableCell>{c.effectiveFrom.slice(0, 10)}</TableCell>
                    <TableCell>
                      {c.effectiveTo ? c.effectiveTo.slice(0, 10) : 'Open-ended'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.sourceNote}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {showForm && (
        <CreateConfigForm
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
    </PageContainer>
  );
}

function CreateConfigForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [configType, setConfigType] = useState<StatutoryConfigType>('PF');
  const [state, setState] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [configData, setConfigData] = useState(CONFIG_DATA_PLACEHOLDER.PF);
  const [sourceNote, setSourceNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleTypeChange(next: StatutoryConfigType) {
    setConfigType(next);
    setConfigData(CONFIG_DATA_PLACEHOLDER[next]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (configType === 'PROFESSIONAL_TAX' && !state.trim()) {
      setError('State is required for PROFESSIONAL_TAX');
      return;
    }
    if (!sourceNote.trim()) {
      setError('Source note is required — where did this rate come from?');
      return;
    }
    let parsedConfigData: Record<string, unknown>;
    try {
      parsedConfigData = JSON.parse(configData);
    } catch {
      setError('configData must be valid JSON');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/statutory-config', {
        method: 'POST',
        body: JSON.stringify({
          configType,
          state: state.trim() || undefined,
          effectiveFrom,
          effectiveTo: effectiveTo || undefined,
          configData: parsedConfigData,
          sourceNote,
        }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save config');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Config Version</DialogTitle>
          <DialogDescription className="text-warning">
            Do not enter production rates without compliance sign-off.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              <Select
                value={configType}
                onChange={(e) => handleTypeChange(e.target.value as StatutoryConfigType)}
              >
                {CONFIG_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            {configType === 'PROFESSIONAL_TAX' && (
              <Field label="State" required>
                <Input value={state} onChange={(e) => setState(e.target.value)} />
              </Field>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Effective from" required>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </Field>
            <Field label="Effective to" hint="Open-ended if blank">
              <Input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
            </Field>
          </div>
          <Field label="Config data (JSON — shape depends on type)">
            <Textarea
              value={configData}
              onChange={(e) => setConfigData(e.target.value)}
              className="min-h-32 font-mono text-xs"
            />
          </Field>
          <Field label="Source note" hint="Where this rate came from / who approved it">
            <Input
              value={sourceNote}
              onChange={(e) => setSourceNote(e.target.value)}
              placeholder="e.g. TEST DATA — not a real rate"
            />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
