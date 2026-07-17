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
 * Captures the VSAQ "Vendor Information" fields.
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
    registeredAddress: '',
    factoryAddress: '',
    yearEstablished: '',
    numberOfEmployees: '',
    annualTurnover: '',
    msmeUdyamCertificate: '',
    contactPersonName: '',
    contactPersonDesignation: '',
    contactEmail: '',
    contactPhone: '',
    website: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof CreateVendorInput>(
    key: K,
    value: string,
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const required: (keyof CreateVendorInput)[] = [
    'companyName',
    'registeredAddress',
    'factoryAddress',
    'yearEstablished',
    'numberOfEmployees',
    'annualTurnover',
    'contactPersonName',
    'contactPersonDesignation',
    'contactEmail',
    'contactPhone',
  ];

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
      // Drop empty optionals so they persist as null.
      const payload: CreateVendorInput = { ...form };
      if (!payload.msmeUdyamCertificate?.trim()) delete payload.msmeUdyamCertificate;
      if (!payload.website?.trim()) delete payload.website;
      const created = await createVendor(payload);
      toast.success('Vendor created.');
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create vendor.');
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
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
          <Field label="Website" htmlFor="s-web">
            <Input id="s-web" value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} />
          </Field>
          <Field label="Registered address" required htmlFor="s-reg" className="sm:col-span-2">
            <Input id="s-reg" value={form.registeredAddress} onChange={(e) => set('registeredAddress', e.target.value)} />
          </Field>
          <Field label="Factory address" required htmlFor="s-fac" className="sm:col-span-2">
            <Input id="s-fac" value={form.factoryAddress} onChange={(e) => set('factoryAddress', e.target.value)} />
          </Field>
          <Field label="Year established" required htmlFor="s-year">
            <Input id="s-year" value={form.yearEstablished} onChange={(e) => set('yearEstablished', e.target.value)} />
          </Field>
          <Field label="Number of employees" required htmlFor="s-emp">
            <Input id="s-emp" value={form.numberOfEmployees} onChange={(e) => set('numberOfEmployees', e.target.value)} />
          </Field>
          <Field label="Annual turnover" required htmlFor="s-turn">
            <Input id="s-turn" value={form.annualTurnover} onChange={(e) => set('annualTurnover', e.target.value)} />
          </Field>
          <Field label="MSME / UDYAM certificate" htmlFor="s-msme">
            <Input id="s-msme" value={form.msmeUdyamCertificate ?? ''} onChange={(e) => set('msmeUdyamCertificate', e.target.value)} />
          </Field>
          <Field label="Contact person" required htmlFor="s-cp">
            <Input id="s-cp" value={form.contactPersonName} onChange={(e) => set('contactPersonName', e.target.value)} />
          </Field>
          <Field label="Designation" required htmlFor="s-des">
            <Input id="s-des" value={form.contactPersonDesignation} onChange={(e) => set('contactPersonDesignation', e.target.value)} />
          </Field>
          <Field label="Contact email" required htmlFor="s-email">
            <Input id="s-email" type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
          </Field>
          <Field label="Contact phone" required htmlFor="s-phone">
            <Input id="s-phone" value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
          </Field>
        </div>

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
