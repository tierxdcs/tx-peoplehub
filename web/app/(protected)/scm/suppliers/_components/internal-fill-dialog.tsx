'use client';

import { useState } from 'react';
import { ApiError } from '../../../../lib/api';
import { uploadToPresignedUrl } from '../../../../lib/vault-api';
import {
  internalCertConfirm,
  internalCertUploadUrl,
  saveInternal,
  submitInternal,
  type CertificateFile,
  type PublicCompanyInfo,
  type SectionKey,
  type SupplierQuestionnaire,
} from '../../../../lib/scm-supplier';
import {
  QuestionnaireSections,
  type FormState,
  type SectionState,
} from '../../../../components/supplier-questionnaire/questionnaire-sections';
import { useToast } from '../../../../components/ui/toaster';
import { useConfirm } from '../../../../components/ui/confirm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Button } from '../../../../components/ui/button';

/**
 * Fill Internally (spec §2–3): SCM staff fill the SAME 9-section questionnaire
 * inside the authenticated app, reusing <QuestionnaireSections> (no second
 * form). Every field is optional — no required-field validation blocks
 * save/submit. "Mark as Submitted" finalizes with filledBy = INTERNAL_STAFF.
 * Certificate uploads reuse the exact same guardrails via the internal endpoints.
 */
export function InternalFillDialog({
  questionnaire,
  onClose,
  onSubmitted,
}: {
  questionnaire: SupplierQuestionnaire;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();

  // Seed from any previously-saved section data (staff may resume a draft).
  const [form, setForm] = useState<FormState>(() => {
    const seeded: FormState = {};
    (Object.keys(questionnaire) as (keyof SupplierQuestionnaire)[]).forEach((k) => {
      const v = questionnaire[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        seeded[k as SectionKey] = v as SectionState;
      }
    });
    return seeded;
  });
  const [companyInfo, setCompanyInfo] = useState<PublicCompanyInfo>({
    registeredAddress: questionnaire.companyInfo.registeredAddress ?? '',
    factoryAddress: questionnaire.companyInfo.factoryAddress ?? '',
    yearEstablished: questionnaire.companyInfo.yearEstablished ?? '',
    numberOfEmployees: questionnaire.companyInfo.numberOfEmployees ?? '',
    annualTurnover: questionnaire.companyInfo.annualTurnover ?? '',
    msmeUdyamCertificate: questionnaire.companyInfo.msmeUdyamCertificate ?? '',
    contactPersonName: questionnaire.companyInfo.contactPersonName ?? '',
    contactPersonDesignation: questionnaire.companyInfo.contactPersonDesignation ?? '',
    contactPhone: questionnaire.companyInfo.contactPhone ?? '',
    website: questionnaire.companyInfo.website ?? '',
  });
  const [certs, setCerts] = useState<CertificateFile[]>(
    questionnaire.certificateFiles ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  function setField(section: SectionKey, key: string, value: unknown) {
    setForm((f) => ({ ...f, [section]: { ...(f[section] ?? {}), [key]: value } }));
  }

  function setCompanyInfoField(key: keyof PublicCompanyInfo, value: string) {
    setCompanyInfo((c) => ({ ...c, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setBanner(null);
    try {
      await saveInternal(questionnaire.id, form, companyInfo);
      toast.success('Progress saved.');
    } catch (err) {
      setBanner(err instanceof ApiError ? err.message : 'Failed to save.');
    } finally {
      setBusy(false);
    }
  }

  async function markSubmitted() {
    if (
      !(await confirm({
        title: 'Mark as submitted?',
        description:
          'This finalizes the questionnaire (recorded as filled internally) and locks it. It then goes to audit like any other submission.',
        confirmLabel: 'Mark as Submitted',
      }))
    )
      return;
    setBusy(true);
    setBanner(null);
    try {
      await submitInternal(questionnaire.id, form, companyInfo);
      toast.success('Questionnaire marked as submitted.');
      onSubmitted();
    } catch (err) {
      setBanner(err instanceof ApiError ? err.message : 'Failed to submit.');
      setBusy(false);
    }
  }

  async function uploadCert(file: File) {
    setBanner(null);
    try {
      const presign = await internalCertUploadUrl(questionnaire.id, {
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });
      await uploadToPresignedUrl(presign.uploadUrl, file);
      const confirmed = await internalCertConfirm(questionnaire.id, {
        storageKey: presign.storageKey,
        name: file.name,
      });
      setCerts((c) => [...c, confirmed]);
    } catch (err) {
      // Surfaces Vault's actual guardrail message (blocked extension / too big).
      setBanner(err instanceof ApiError ? err.message : 'Upload failed. Please try again.');
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fill Internally — Rev {questionnaire.revisionNumber}</DialogTitle>
          <DialogDescription>
            Enter the supplier’s answers on their behalf. Every field is
            optional. Uploaded certificates use the same rules as the supplier
            portal.
          </DialogDescription>
        </DialogHeader>

        {banner && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            {banner}
          </p>
        )}

        <QuestionnaireSections
          form={form}
          setField={setField}
          certs={certs}
          onUploadCert={(f) => void uploadCert(f)}
          companyInfo={companyInfo}
          onCompanyInfoChange={setCompanyInfoField}
        />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save Progress'}
          </Button>
          <Button onClick={markSubmitted} disabled={busy}>
            Mark as Submitted
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
