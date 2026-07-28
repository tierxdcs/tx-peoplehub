'use client';

import { useState } from 'react';
import { ApiError } from '../../../../lib/api';
import {
  overrideAuditClassification,
  type VendorAudit,
  type VendorClassification,
} from '../../../../lib/scm';
import { useToast } from '../../../../components/ui/toaster';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Field } from '../../../../components/ui/field';
import { Select } from '../../../../components/ui/select';
import { Textarea } from '../../../../components/ui/textarea';
import { Button } from '../../../../components/ui/button';
import { StatusBadge } from '../../../../components/ui/status-badge';

/** The four classification values, ordered high→low, with reference labels. */
const CLASSIFICATION_OPTIONS: { value: VendorClassification; label: string }[] = [
  { value: 'APPROVED_PREFERRED', label: 'Approved (Preferred Vendor)' },
  { value: 'APPROVED', label: 'Approved' },
  {
    value: 'CONDITIONALLY_APPROVED',
    label: 'Conditionally Approved (Improvement Plan Required)',
  },
  { value: 'NOT_APPROVED', label: 'Not Approved' },
];

/**
 * SuperAdmin classification override (set or edit). The computed classification
 * is shown read-only for reference — the override never deletes it, it only
 * takes precedence. A reason is mandatory (this bypasses the scoring gate).
 */
export function OverrideDialog({
  vendorId,
  audit,
  onClose,
  onSaved,
}: {
  vendorId: string;
  audit: VendorAudit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [classification, setClassification] = useState<VendorClassification>(
    audit.overrideClassification ?? audit.classification,
  );
  const [reason, setReason] = useState(audit.overrideReason ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setError('A reason is required to override the classification.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await overrideAuditClassification(vendorId, audit.id, {
        overrideClassification: classification,
        reason: reason.trim(),
      });
      toast.success('Classification override applied.');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to apply override.');
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {audit.isOverridden ? 'Edit Classification Override' : 'Override Classification'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                Computed from score ({audit.totalScore} / 100)
              </span>
              <StatusBadge value={audit.classification} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              The computed classification is never removed — the override simply
              takes precedence and drives the vendor’s status.
            </p>
          </div>

          <Field label="Override classification" htmlFor="o-class">
            <Select
              id="o-class"
              value={classification}
              onChange={(e) =>
                setClassification(e.target.value as VendorClassification)
              }
            >
              {CLASSIFICATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Reason (required)" htmlFor="o-reason">
            <Textarea
              id="o-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this override justified? (retained on the audit record)"
            />
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Saving…' : 'Apply Override'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
