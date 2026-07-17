'use client';

import { useMemo, useState } from 'react';
import { ApiError } from '../../../../lib/api';
import {
  AUDIT_CATEGORIES,
  classify,
  createAudit,
  type AuditType,
  type CreateAuditInput,
} from '../../../../lib/scm-supplier';
import { todayDateStr } from '../../../../lib/date';
import { useToast } from '../../../../components/ui/toaster';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Field } from '../../../../components/ui/field';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Textarea } from '../../../../components/ui/textarea';
import { Button } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';

type ScoreKey = (typeof AUDIT_CATEGORIES)[number]['key'];

/**
 * Create + finalize a supplier audit (Internal Auditor/SA). Six weighted score
 * inputs (30/15/20/15/10/10 = 100) with a LIVE total + classification preview
 * (same 90/80/70 thresholds as Vendor); the server re-verifies on submit.
 * Finalizing sets the supplier's status to the computed classification.
 */
export function AuditForm({
  supplierId,
  questionnaireId,
  onClose,
  onCreated,
}: {
  supplierId: string;
  questionnaireId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [auditType, setAuditType] = useState<AuditType>('PHYSICAL');
  const [auditDate, setAuditDate] = useState(todayDateStr());
  const [scores, setScores] = useState<Record<ScoreKey, string>>(
    Object.fromEntries(AUDIT_CATEGORIES.map((c) => [c.key, ''])) as Record<
      ScoreKey,
      string
    >,
  );
  const [auditNotes, setAuditNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(
    () =>
      AUDIT_CATEGORIES.reduce((sum, c) => {
        const n = Number(scores[c.key]);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0),
    [scores],
  );
  const { label } = classify(total);
  const anyEntered = AUDIT_CATEGORIES.some((c) => scores[c.key] !== '');

  function setScore(key: ScoreKey, value: string, max: number) {
    // Clamp to [0, max] to mirror the reference form's live behavior.
    if (value === '') return setScores((s) => ({ ...s, [key]: '' }));
    let n = Number(value);
    if (Number.isNaN(n)) return;
    if (n < 0) n = 0;
    if (n > max) n = max;
    setScores((s) => ({ ...s, [key]: String(n) }));
  }

  async function submit() {
    // Every category must have a value before finalizing.
    for (const c of AUDIT_CATEGORIES) {
      if (scores[c.key] === '') {
        setError('Enter a score for every category before finalizing.');
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateAuditInput = {
        questionnaireId,
        auditType,
        auditDate,
        auditNotes: auditNotes.trim() || undefined,
        materialCertificationsQualityScore: Number(scores.materialCertificationsQualityScore),
        complianceScore: Number(scores.complianceScore),
        commercialTermsScore: Number(scores.commercialTermsScore),
        logisticsDeliveryScore: Number(scores.logisticsDeliveryScore),
        financialStabilityScore: Number(scores.financialStabilityScore),
        referencesScore: Number(scores.referencesScore),
      };
      await createAudit(supplierId, payload);
      toast.success('Audit finalized.');
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to finalize audit.');
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Audit</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Audit type" htmlFor="a-type">
              <Select
                id="a-type"
                value={auditType}
                onChange={(e) => setAuditType(e.target.value as AuditType)}
              >
                <option value="PHYSICAL">Physical</option>
                <option value="VIRTUAL">Virtual</option>
              </Select>
            </Field>
            <Field label="Audit date" htmlFor="a-date">
              <Input
                id="a-date"
                type="date"
                value={auditDate}
                onChange={(e) => setAuditDate(e.target.value)}
              />
            </Field>
          </div>

          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="p-2">Category</th>
                  <th className="p-2 text-center">Max</th>
                  <th className="p-2 text-center">Score</th>
                </tr>
              </thead>
              <tbody>
                {AUDIT_CATEGORIES.map((c) => (
                  <tr key={c.key} className="border-b last:border-0">
                    <td className="p-2">{c.label}</td>
                    <td className="p-2 text-center text-muted-foreground">{c.max}</td>
                    <td className="p-2 text-center">
                      <Input
                        type="number"
                        min={0}
                        max={c.max}
                        value={scores[c.key]}
                        onChange={(e) => setScore(c.key, e.target.value, c.max)}
                        className="mx-auto h-8 w-20 text-center"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Live total + classification preview */}
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
            <span className="font-medium">Total: {total} / 100</span>
            {anyEntered && <Badge variant={badgeVariant(total)}>{label}</Badge>}
          </div>

          <Field label="Audit notes" htmlFor="a-notes">
            <Textarea
              id="a-notes"
              value={auditNotes}
              onChange={(e) => setAuditNotes(e.target.value)}
              rows={3}
            />
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Finalizing…' : 'Finalize Audit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function badgeVariant(total: number) {
  if (total >= 80) return 'success' as const;
  if (total >= 70) return 'warning' as const;
  return 'destructive' as const;
}
