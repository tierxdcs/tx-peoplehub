'use client';

import { useState } from 'react';
import { ApiError } from '../../../../lib/api';
import { createSupplier, type CreateSupplierInput } from '../../../../lib/scm-supplier';
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
 * Create a Supplier + its first (SENT) questionnaire in one action (spec §2).
 * Only company name + contact email are required — staff often don't know the
 * rest yet, and it's expected to arrive via the supplier's own questionnaire
 * (the public form's Company Information section). "Registered/factory
 * address" doubles as the origin location for raw-material suppliers.
 */
export function NewSupplierDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<CreateSupplierInput>({
    companyName: '',
    contactEmail: '',
    registeredAddress: '',
    factoryAddress: '',
    yearEstablished: '',
    numberOfEmployees: '',
    annualTurnover: '',
    msmeUdyamCertificate: '',
    contactPersonName: '',
    contactPersonDesignation: '',
    contactPhone: '',
    website: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof CreateSupplierInput>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const required: (keyof CreateSupplierInput)[] = ['companyName', 'contactEmail'];
  const optionalFields: (keyof CreateSupplierInput)[] = [
    'registeredAddress',
    'factoryAddress',
    'yearEstablished',
    'numberOfEmployees',
    'annualTurnover',
    'msmeUdyamCertificate',
    'contactPersonName',
    'contactPersonDesignation',
    'contactPhone',
    'website',
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
      const payload: CreateSupplierInput = { ...form };
      for (const k of optionalFields) {
        if (!payload[k]?.trim()) delete payload[k];
      }
      const created = await createSupplier(payload);
      toast.success('Supplier created.');
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create supplier.');
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Supplier</DialogTitle>
          <DialogDescription>
            Creates the supplier record and its first self-assessment
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
          <Field label="Website" htmlFor="s-web">
            <Input id="s-web" value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} />
          </Field>
          <Field label="Registered address / origin location" htmlFor="s-reg" className="sm:col-span-2">
            <Input id="s-reg" value={form.registeredAddress ?? ''} onChange={(e) => set('registeredAddress', e.target.value)} />
          </Field>
          <Field label="Factory address" htmlFor="s-fac" className="sm:col-span-2">
            <Input id="s-fac" value={form.factoryAddress ?? ''} onChange={(e) => set('factoryAddress', e.target.value)} />
          </Field>
          <Field label="Year established" htmlFor="s-year">
            <Input id="s-year" value={form.yearEstablished ?? ''} onChange={(e) => set('yearEstablished', e.target.value)} />
          </Field>
          <Field label="Number of employees" htmlFor="s-emp">
            <Input id="s-emp" value={form.numberOfEmployees ?? ''} onChange={(e) => set('numberOfEmployees', e.target.value)} />
          </Field>
          <Field label="Annual turnover" htmlFor="s-turn">
            <Input id="s-turn" value={form.annualTurnover ?? ''} onChange={(e) => set('annualTurnover', e.target.value)} />
          </Field>
          <Field label="MSME / UDYAM certificate" htmlFor="s-msme">
            <Input id="s-msme" value={form.msmeUdyamCertificate ?? ''} onChange={(e) => set('msmeUdyamCertificate', e.target.value)} />
          </Field>
          <Field label="Contact person" htmlFor="s-cp">
            <Input id="s-cp" value={form.contactPersonName ?? ''} onChange={(e) => set('contactPersonName', e.target.value)} />
          </Field>
          <Field label="Designation" htmlFor="s-des">
            <Input id="s-des" value={form.contactPersonDesignation ?? ''} onChange={(e) => set('contactPersonDesignation', e.target.value)} />
          </Field>
          <Field label="Contact phone" htmlFor="s-phone">
            <Input id="s-phone" value={form.contactPhone ?? ''} onChange={(e) => set('contactPhone', e.target.value)} />
          </Field>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Only company name and contact email are required — the supplier can
          complete the rest themselves via the questionnaire.
        </p>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create supplier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
