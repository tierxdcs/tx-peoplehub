'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { uploadToPresignedUrl } from '../../../lib/vault-api';
import {
  createPlmPhotoUploadUrl,
  PlmPublicView,
  resolvePlmVendorUpdate,
  submitPlmVendorUpdate,
} from '../../../lib/plm-public';

const stages = [
  ['Fabrication', 'fabrication'] as const,
  ['Surface finish', 'surfaceFinish'] as const,
  ['Assembly', 'assembly'] as const,
];

export default function PlmVendorUpdatePage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [view, setView] = useState<PlmPublicView | null>(null);
  const [values, setValues] = useState({
    fabrication: 0,
    surfaceFinish: 0,
    assembly: 0,
  });
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function resolve(passwordValue = password) {
    setLoading(true);
    const result = await resolvePlmVendorUpdate(token, passwordValue || undefined);
    if (result.ok) {
      setView(result.data);
      const latest = result.data.updates[0];
      if (latest) {
        setValues({
          fabrication: latest.fabricationPercent,
          surfaceFinish: latest.surfaceFinishPercent,
          assembly: latest.assemblyPercent,
        });
      }
      setMessage('');
    } else {
      setMessage(result.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    void resolve('');
    // Resolve once on entry; password-protected links are retried by the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      const photos: Array<{ storageKey: string; fileName: string }> = [];
      for (const file of files) {
        const presign = await createPlmPhotoUploadUrl(token, {
          password: password || undefined,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        });
        if (!presign.ok) throw new Error(presign.message);
        await uploadToPresignedUrl(presign.data.uploadUrl, file);
        photos.push({ storageKey: presign.data.storageKey, fileName: file.name });
      }
      const result = await submitPlmVendorUpdate(token, {
        password: password || undefined,
        fabricationPercent: values.fabrication,
        surfaceFinishPercent: values.surfaceFinish,
        assemblyPercent: values.assembly,
        notes: notes.trim() || undefined,
        photos,
      });
      if (!result.ok) throw new Error(result.message);
      setNotes('');
      setFiles([]);
      setMessage('Progress update submitted successfully.');
      await resolve(password);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to submit update');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-2xl space-y-5">
        <header>
          <p className="text-sm font-medium text-blue-700">Phaze ERP · Production update</p>
          <h1 className="mt-1 text-2xl font-semibold">Vendor production progress</h1>
        </header>

        {!view ? (
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <p className="mb-4 text-sm text-slate-600">
              {loading ? 'Opening your secure update link…' : message}
            </p>
            {!loading && (
              <div className="space-y-3">
                <label className="block text-sm font-medium">Link password, if provided</label>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="min-h-11 w-full rounded-md border px-3"
                />
                <button
                  onClick={() => void resolve(password)}
                  className="min-h-11 rounded-md bg-blue-600 px-5 text-white"
                >
                  Continue
                </button>
              </div>
            )}
          </section>
        ) : (
          <>
            <section className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                Update provenance
              </p>
              <p className="mt-1 font-medium">Updated by: {view.vendorName}</p>
              <p className="mt-1 text-sm text-blue-900/70">
                This submission will be recorded as a vendor self-report and retained in the PLM timeline.
              </p>
            </section>

            <section className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="grid gap-2 text-sm sm:grid-cols-3">
                <div><span className="text-slate-500">Order</span><p className="font-medium">{view.orderNumber}</p></div>
                <div><span className="text-slate-500">Product</span><p className="font-medium">{view.product.name}</p></div>
                <div><span className="text-slate-500">Current stage</span><p className="font-medium">{view.currentStage}</p></div>
              </div>
            </section>

            <form onSubmit={submit} className="space-y-5 rounded-xl border bg-white p-5 shadow-sm">
              {stages.map(([label, key]) => (
                <label key={key} className="block">
                  <span className="flex justify-between text-sm font-medium">
                    <span>{label}</span><span>{values[key]}%</span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={values[key]}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [key]: Number(event.target.value) }))
                    }
                    className="mt-2 h-11 w-full"
                  />
                </label>
              ))}

              <label className="block text-sm font-medium">
                Notes
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded-md border p-3"
                  placeholder="Work completed, blockers, expected next milestone…"
                />
              </label>

              <label className="block text-sm font-medium">
                Progress photos (up to 5)
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 5))}
                  className="mt-2 block min-h-11 w-full rounded-md border p-2"
                />
              </label>

              {message && <p className="text-sm text-slate-700">{message}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="min-h-12 w-full rounded-md bg-blue-600 px-5 font-medium text-white disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit progress update'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
