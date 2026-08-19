'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { uploadToPresignedUrl } from '../../../lib/vault-api';

type PublicRole = {
  requisitionNumber: string;
  positionTitle: string;
  verticalName: string;
  employmentType: string;
};

export default function PublicJobApplicationPage() {
  const { token } = useParams<{ token: string }>();
  const [role, setRole] = useState<PublicRole | null>(null);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('Opening application…');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resume, setResume] = useState<File | null>(null);

  async function resolve(passwordValue = password) {
    try {
      setRole(
        await apiFetch<PublicRole>(`/public/job-applications/${token}/resolve`, {
          method: 'POST',
          body: JSON.stringify({ password: passwordValue || undefined }),
        }),
      );
      setMessage('');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Unable to open this application');
    }
  }

  useEffect(() => {
    void resolve('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resume) {
      setMessage('Please attach your resume/CV.');
      return;
    }
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const mimeType = resume.type || 'application/octet-stream';
      const presign = await apiFetch<{
        url: string;
        storageKey: string;
      }>(`/public/job-applications/${token}/resume-upload-url`, {
        method: 'POST',
        body: JSON.stringify({
          password: password || undefined,
          fileName: resume.name,
          mimeType,
          sizeBytes: resume.size,
        }),
      });
      await uploadToPresignedUrl(presign.url, resume);
      await apiFetch(`/public/job-applications/${token}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          password: password || undefined,
          name: form.get('name'),
          contact: form.get('contact'),
          areaOfExpertise: form.get('areaOfExpertise'),
          totalExperienceYears: Number(form.get('totalExperienceYears')),
          relevantExperienceYears: Number(form.get('relevantExperienceYears')),
          currentCtc: form.get('currentCtc') ? Number(form.get('currentCtc')) : undefined,
          expectedCtc: form.get('expectedCtc') ? Number(form.get('expectedCtc')) : undefined,
          aboutExperience: form.get('aboutExperience'),
          projects: form.get('projects') || undefined,
          resumeFileKey: presign.storageKey,
          resumeFileName: resume.name,
          resumeFileSize: resume.size,
          resumeMimeType: mimeType,
        }),
      });
      setSubmitted(true);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Application submission failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-2xl bg-slate-950 p-6 text-white shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-300">
            Phaze Dynamics · Careers
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            {role?.positionTitle ?? 'Job application'}
          </h1>
          {role && (
            <p className="mt-1 text-sm text-slate-300">
              {role.verticalName} · {role.employmentType.replaceAll('_', ' ')} · {role.requisitionNumber}
            </p>
          )}
        </header>

        {submitted ? (
          <section className="rounded-xl border bg-white p-8 text-center shadow-sm">
            <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
            <h2 className="mt-3 text-xl font-semibold">Application submitted</h2>
            <p className="mt-2 text-slate-600">Thank you. Our HR team will review your application.</p>
          </section>
        ) : !role ? (
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-600">{message}</p>
            <label className="mt-4 block text-sm font-medium">
              Link password, if provided
              <input className="mt-1 min-h-11 w-full rounded-md border px-3" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button className="mt-3 min-h-11 rounded-md bg-blue-600 px-5 font-medium text-white" onClick={() => void resolve(password)}>Continue</button>
          </section>
        ) : (
          <form onSubmit={submit} className="space-y-5 rounded-xl border bg-white p-5 shadow-sm sm:p-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <PublicField label="Full name" name="name" required />
              <PublicField label="Email or phone" name="contact" required />
              <PublicField label="Area of expertise" name="areaOfExpertise" required />
              <PublicField label="Total experience (years)" name="totalExperienceYears" type="number" step="0.1" min="0" required />
              <PublicField label="Relevant experience (years)" name="relevantExperienceYears" type="number" step="0.1" min="0" required />
              <PublicField label="Current annual CTC (₹)" name="currentCtc" type="number" min="0" />
              <PublicField label="Expected annual CTC (₹)" name="expectedCtc" type="number" min="0" />
            </div>
            <PublicArea label="A few words about your experience" name="aboutExperience" required />
            <PublicArea label="Relevant projects (optional)" name="projects" />
            <label className="block text-sm font-medium">
              Resume / CV <span className="text-red-600">*</span>
              <input className="mt-1 block min-h-11 w-full rounded-md border p-2" type="file" accept=".pdf,.doc,.docx,.odt" required onChange={(e) => setResume(e.target.files?.[0] ?? null)} />
            </label>
            {message && <p className="text-sm text-red-700">{message}</p>}
            <button disabled={busy} className="min-h-11 rounded-md bg-blue-600 px-6 font-medium text-white disabled:opacity-50">
              {busy ? 'Submitting…' : 'Submit application'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function PublicField({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="block text-sm font-medium">{label}{props.required && <span className="text-red-600"> *</span>}<input {...props} className="mt-1 min-h-11 w-full rounded-md border px-3" /></label>;
}

function PublicArea({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return <label className="block text-sm font-medium">{label}{props.required && <span className="text-red-600"> *</span>}<textarea {...props} rows={4} className="mt-1 w-full rounded-md border px-3 py-2" /></label>;
}
