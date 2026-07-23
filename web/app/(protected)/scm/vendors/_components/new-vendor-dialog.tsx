'use client';

import { useState } from 'react';
import { ApiError } from '../../../../lib/api';
import { createVendor, type CreateVendorInput } from '../../../../lib/scm';
import { useToast } from '../../../../components/ui/toaster';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Field } from '../../../../components/ui/field';
import { Input } from '../../../../components/ui/input';
import { Button } from '../../../../components/ui/button';

/**
 * Create a Vendor + its first (SENT) questionnaire in one action (spec §3).
 * Only company name + contact email are collected here — everything else
 * (address, turnover, contact person, etc.) is collected via the vendor's own
 * questionnaire (the public form's Company Information section), so asking
 * staff to fill it in twice would be redundant.
 */
export function NewVendorDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<CreateVendorInput>({
    companyName: '',
    contactEmail: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof CreateVendorInput>(
    key: K,
    value: string,
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const required: (keyof CreateVendorInput)[] = ['companyName', 'contactEmail'];

  async function submit() {
    for (const k of required) {
      if (!String(form[k] ?? '').trim()) {
        setError('Please fill in all required fields.');
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createVendor(form);
      toast.success('Vendor created.');
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create vendor.');
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Vendor</DialogTitle>
          <DialogDescription>
            Creates the vendor record and its first self-assessment
            questionnaire.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name" required htmlFor="s-company">
            <Input id="s-company" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} />
          </Field>
          <Field label="Contact email" required htmlFor="s-email">
            <Input id="s-email" type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
          </Field>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          The vendor will fill in company details, contact person, and the
          rest of the profile themselves via the questionnaire.
        </p>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create vendor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
