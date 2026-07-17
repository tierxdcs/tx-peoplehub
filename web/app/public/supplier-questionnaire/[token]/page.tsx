'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { COMPANY } from '../../../lib/theme';
import { uploadToPresignedUrl } from '../../../lib/vault-api';
import {
  publicCertConfirm,
  publicCertUploadUrl,
  resolvePublicQuestionnaire,
  savePublicQuestionnaire,
  submitPublicQuestionnaire,
  type CertificateFile,
  type SectionKey,
  type SupplierQuestionnaire,
} from '../../../lib/scm-supplier';
import {
  QuestionnaireSections,
  btnPrimary,
  btnSecondary,
  inputStyle,
  INK,
  ACCENT,
  type FormState,
  type SectionState,
} from '../../../components/supplier-questionnaire/questionnaire-sections';

/**
 * Public supplier self-assessment questionnaire (raw materials) — outside the
 * app shell, unauthenticated, resolved by token. Save/resume, certificate
 * upload (guarded server-side by Vault's rules), and a final submit that locks
 * the form. All section data is sent as JSON blobs the backend stores opaquely.
 *
 * The 9-section body is the shared <QuestionnaireSections>, reused verbatim by
 * the authenticated internal-fill UI — this page owns only the token
 * plumbing, resolve/password/expired states, and the standalone document shell.
 */

export default function PublicSupplierQuestionnairePage() {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [questionnaire, setQuestionnaire] = useState<SupplierQuestionnaire | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [certs, setCerts] = useState<CertificateFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  // Password is kept in a ref so save/submit calls always use the resolved one.
  const pwRef = useRef<string | undefined>(undefined);

  const applyResolved = useCallback((q: SupplierQuestionnaire) => {
    setQuestionnaire(q);
    setSubmitted(q.status === 'SUBMITTED');
    setCerts(q.certificateFiles ?? []);
    // Seed the form from any previously-saved section data (resume).
    const seeded: FormState = {};
    (Object.keys(q) as (keyof SupplierQuestionnaire)[]).forEach((k) => {
      const v = q[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // Only the section keys are plain objects; skip files array etc.
        seeded[k as SectionKey] = v as SectionState;
      }
    });
    setForm(seeded);
  }, []);

  const resolve = useCallback(
    async (pwd?: string) => {
      const res = await resolvePublicQuestionnaire(token, pwd);
      if (res.ok) {
        pwRef.current = pwd;
        setNeedsPassword(false);
        setErrorMsg(null);
        applyResolved(res.data);
      } else if (res.passwordRequired) {
        setNeedsPassword(true);
      } else {
        setErrorMsg(res.message);
      }
    },
    [token, applyResolved],
  );

  useEffect(() => {
    resolve().finally(() => setLoading(false));
  }, [resolve]);

  function setField(section: SectionKey, key: string, value: unknown) {
    setForm((f) => ({ ...f, [section]: { ...(f[section] ?? {}), [key]: value } }));
  }

  async function save() {
    setSaving(true);
    setBanner(null);
    const res = await savePublicQuestionnaire(token, form, pwRef.current);
    setSaving(false);
    if (res.ok) setBanner('Progress saved. You can close this and resume later via the same link.');
    else setBanner(res.message);
  }

  async function submit() {
    const declared = (form.declaration ?? {}) as SectionState;
    if (!declared.certified) {
      setBanner('Please tick the certification checkbox in the Declaration section before submitting.');
      return;
    }
    setSaving(true);
    setBanner(null);
    const res = await submitPublicQuestionnaire(token, form, pwRef.current);
    setSaving(false);
    if (res.ok) {
      setSubmitted(true);
      setQuestionnaire(res.data);
    } else {
      setBanner(res.message);
    }
  }

  async function uploadCert(file: File) {
    setBanner(null);
    const presign = await publicCertUploadUrl(
      token,
      { name: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size },
      pwRef.current,
    );
    if (!presign.ok) {
      // Surfaces Vault's actual guardrail message (blocked extension / too big).
      setBanner(presign.message);
      return;
    }
    try {
      await uploadToPresignedUrl(presign.data.uploadUrl, file);
    } catch {
      setBanner('Upload failed. Please try again.');
      return;
    }
    const confirmed = await publicCertConfirm(
      token,
      { storageKey: presign.data.storageKey, name: file.name },
      pwRef.current,
    );
    if (confirmed.ok) setCerts((c) => [...c, confirmed.data]);
    else setBanner(confirmed.message);
  }

  // ── Render states ──────────────────────────────────────────────────
  if (loading) {
    return <Shell><p style={{ color: '#6b7280' }}>Loading…</p></Shell>;
  }
  if (errorMsg) {
    return (
      <Shell>
        <div style={{ padding: 24, textAlign: 'center' }}>
          <h2 style={{ color: INK }}>This link isn’t available</h2>
          <p style={{ color: '#6b7280' }}>{errorMsg}</p>
          <p style={{ color: '#6b7280', fontSize: 13 }}>
            If you believe this is an error, please contact your Phaze Dynamics
            representative for a new link.
          </p>
        </div>
      </Shell>
    );
  }
  if (needsPassword) {
    return (
      <Shell>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void resolve(password);
          }}
          style={{ padding: 24, maxWidth: 360, margin: '0 auto' }}
        >
          <h2 style={{ color: INK }}>Password required</h2>
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            This questionnaire link is password-protected.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            style={inputStyle}
          />
          <button type="submit" style={{ ...btnPrimary, marginTop: 12 }}>
            Continue
          </button>
        </form>
      </Shell>
    );
  }
  if (submitted) {
    return (
      <Shell>
        <div style={{ padding: 24, textAlign: 'center' }}>
          <h2 style={{ color: INK }}>Thank you — your submission has been received.</h2>
          <p style={{ color: '#6b7280' }}>
            Your supplier self-assessment questionnaire has been submitted to
            Phaze Dynamics and is now locked. No further changes are needed.
          </p>
        </div>
      </Shell>
    );
  }
  if (!questionnaire) return <Shell><p>Not available.</p></Shell>;

  // ── The form ───────────────────────────────────────────────────────
  return (
    <Shell>
      <p style={{ margin: '0 0 20px', padding: '12px 16px', background: '#f8f8f9', borderLeft: `4px solid ${ACCENT}`, fontSize: 14, color: '#374151' }}>
        Please complete all sections that are relevant to your business. If a
        section or question does not apply, leave it blank. Use <strong>Save
        Progress</strong> at any time — you can close this page and resume later
        via the same link.
      </p>

      {banner && (
        <p style={{ margin: '0 0 16px', padding: '10px 14px', background: '#fff7ec', border: '1px solid #f1d9b0', borderRadius: 4, fontSize: 13.5, color: '#92400e' }}>
          {banner}
        </p>
      )}

      <QuestionnaireSections
        form={form}
        setField={setField}
        certs={certs}
        onUploadCert={(f) => void uploadCert(f)}
      />

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, marginTop: 28, justifyContent: 'flex-end' }}>
        <button onClick={save} disabled={saving} style={btnSecondary}>
          {saving ? 'Saving…' : 'Save Progress'}
        </button>
        <button onClick={submit} disabled={saving} style={btnPrimary}>
          Submit
        </button>
      </div>
    </Shell>
  );
}

// ── Layout shell (standalone document look) ──────────────────────────
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ background: '#eef0f3', minHeight: '100vh', padding: '24px 0 60px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '28px 40px 20px', borderBottom: `3px solid ${INK}` }}>
          {COMPANY.logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={COMPANY.logoPath} alt={COMPANY.name} style={{ height: 46 }} />
          ) : (
            <strong style={{ fontSize: 20, color: INK }}>{COMPANY.name}</strong>
          )}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, letterSpacing: '0.06em', color: '#6b7280', textTransform: 'uppercase' }}>
              {COMPANY.legalEntityName}
            </div>
            <h1 style={{ fontSize: 20, margin: '4px 0 0', color: INK }}>
              Supplier Self-Assessment Questionnaire
            </h1>
          </div>
        </header>
        <div style={{ padding: '20px 40px 40px' }}>{children}</div>
        <footer style={{ textAlign: 'center', fontSize: 11.5, color: '#6b7280', padding: '20px 40px 34px' }}>
          {COMPANY.legalEntityName} — Supplier Self-Assessment Questionnaire ·{' '}
          {COMPANY.confidentialityLine}
        </footer>
      </div>
    </main>
  );
}
