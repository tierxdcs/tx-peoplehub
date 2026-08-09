'use client';

import { useState } from 'react';
import { ApiError } from '../../../../lib/api';
import {
  updateVendorCoreCompetency,
  VENDOR_CORE_COMPETENCY_LABEL,
  type VendorCoreCompetency,
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
import { Button } from '../../../../components/ui/button';

/** Core competency options, ordered as declared on the backend enum. */
const CORE_COMPETENCY_OPTIONS = (
  Object.keys(VENDOR_CORE_COMPETENCY_LABEL) as VendorCoreCompetency[]
).map((value) => ({ value, label: VENDOR_CORE_COMPETENCY_LABEL[value] }));

/**
 * Set/correct a vendor's core competency independently of an audit. SCM
 * Manager+/SA (backend enforces). This edits only the vendor master — it never
 * touches audit records or the qualification status.
 */
export function CoreCompetencyDialog({
  vendorId,
  current,
  onClose,
  onSaved,
}: {
  vendorId: string;
  current: VendorCoreCompetency | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [competency, setCompetency] = useState<VendorCoreCompetency>(
    current ?? 'SHEET_METAL',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await updateVendorCoreCompetency(vendorId, competency);
      toast.success('Core competency updated.');
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to update core competency.',
      );
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Core Competency</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The core competency describes the vendor’s primary manufacturing
            capability, used when sourcing. This edits the vendor record only —
            it doesn’t change any audit or the qualification status.
          </p>

          <Field label="Core competency" htmlFor="cc-select">
            <Select
              id="cc-select"
              value={competency}
              onChange={(e) =>
                setCompetency(e.target.value as VendorCoreCompetency)
              }
            >
              {CORE_COMPETENCY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
