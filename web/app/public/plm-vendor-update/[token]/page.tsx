'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Check } from 'lucide-react';
import { uploadToPresignedUrl } from '../../../lib/vault-api';
import {
  createPlmPhotoUploadUrl,
  PLM_PRODUCTION_STEPS,
  PlmPublicView,
  resolvePlmVendorUpdate,
  submitPlmVendorUpdate,
  submitPlmVendorComment,
} from '../../../lib/plm-public';

const TOTAL_STEPS = PLM_PRODUCTION_STEPS.length;

function relativeTime(iso: string | null) {
  if (!iso) return 'No update submitted yet';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function PlmVendorUpdatePage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [view, setView] = useState<PlmPublicView | null>(null);
  const [completedSteps, setCompletedSteps] = useState(0);
  const [notes, setNotes] = useState('');
  const [quickComment, setQuickComment] = useState('');
  const [mode, setMode] = useState<'FULL_PROGRESS' | 'COMMENT_ONLY'>('FULL_PROGRESS');
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function resolve(passwordValue = password) {
    setLoading(true);
    const result = await resolvePlmVendorUpdate(token, passwordValue || undefined);
    if (result.ok) {
      setView(result.data);
      const latest = result.data.updates.find(
        (update) => update.updateType === 'FULL_PROGRESS',
      );
      if (latest) {
        // Seed from the last reported step count so the vendor picks up where
        // they left off. Fall back to deriving from a legacy percentage.
        const seeded =
          latest.completedSteps ??
          (latest.fabricationPercent != null
            ? Math.round((latest.fabricationPercent / 100) * TOTAL_STEPS)
            : 0);
        setCompletedSteps(Math.max(0, Math.min(TOTAL_STEPS, seeded)));
      }
      setMessage('');
    } else {
      setMessage(result.message);
    }
    setLoading(false);
  }

  async function submitQuickComment(event: FormEvent) {
    event.preventDefault();
    if (!quickComment.trim()) return;
    setSubmitting(true);
    setMessage('');
    try {
      const result = await submitPlmVendorComment(token, {
        password: password || undefined,
        notes: quickComment.trim(),
      });
      if (!result.ok) throw new Error(result.message);
      setQuickComment('');
      setMessage('Quick comment submitted successfully.');
      await resolve(password);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to submit comment');
    } finally {
      setSubmitting(false);
    }
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
        completedSteps,
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
              <div className="mt-3 border-t border-blue-200 pt-3 text-sm">
                <strong>Last update: {relativeTime(view.lastVendorUpdateAt)}</strong>
                <span className="ml-2 text-blue-900/70">
                  · Expected every {view.vendorUpdateCadenceDays} day(s)
                </span>
              </div>
            </section>

            <section className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="grid gap-2 text-sm sm:grid-cols-3">
                <div><span className="text-slate-500">Order</span><p className="font-medium">{view.orderNumber}</p></div>
                <div><span className="text-slate-500">Product</span><p className="font-medium">{view.product.name}</p></div>
                <div><span className="text-slate-500">Current stage</span><p className="font-medium">{view.currentStage}</p></div>
              </div>
            </section>

            <div className="grid grid-cols-2 rounded-lg border bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setMode('FULL_PROGRESS')}
                className={`min-h-11 rounded-md px-3 text-sm font-medium ${mode === 'FULL_PROGRESS' ? 'bg-blue-600 text-white' : 'text-slate-600'}`}
              >
                Full progress update
              </button>
              <button
                type="button"
                onClick={() => setMode('COMMENT_ONLY')}
                className={`min-h-11 rounded-md px-3 text-sm font-medium ${mode === 'COMMENT_ONLY' ? 'bg-blue-600 text-white' : 'text-slate-600'}`}
              >
                Quick comment
              </button>
            </div>

            {mode === 'FULL_PROGRESS' ? (
            <form onSubmit={submit} className="space-y-5 rounded-xl border bg-white p-5 shadow-sm">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Production progress</span>
                  <span className="text-sm font-semibold text-blue-700">
                    {completedSteps}/{TOTAL_STEPS} steps ·{' '}
                    {Math.round((completedSteps / TOTAL_STEPS) * 100)}%
                  </span>
                </div>
                {/* Derived progress bar. */}
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all"
                    style={{ width: `${(completedSteps / TOTAL_STEPS) * 100}%` }}
                  />
                </div>

                {/* Sequential routing: tap a step to mark it (and everything
                    before it) complete; tap the last completed step to undo. */}
                <ol className="mt-4 space-y-2">
                  {PLM_PRODUCTION_STEPS.map((step, index) => {
                    const done = index < completedSteps;
                    const current = index === completedSteps;
                    return (
                      <li key={step}>
                        <button
                          type="button"
                          onClick={() =>
                            // Tapping the last completed step steps back one;
                            // otherwise advance to include this step.
                            setCompletedSteps(
                              done && index === completedSteps - 1
                                ? index
                                : index + 1,
                            )
                          }
                          aria-pressed={done}
                          className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 text-left text-sm transition-colors ${
                            done
                              ? 'border-green-500 bg-green-50 text-green-900'
                              : current
                                ? 'border-blue-500 bg-blue-50 text-blue-900'
                                : 'border-slate-200 text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <span
                            className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                              done
                                ? 'border-green-500 bg-green-500 text-white'
                                : current
                                  ? 'border-blue-500 text-blue-600'
                                  : 'border-slate-300 text-slate-400'
                            }`}
                          >
                            {done ? <Check className="size-4" /> : index + 1}
                          </span>
                          <span className="font-medium">{step}</span>
                          {current && (
                            <span className="ml-auto text-xs font-medium text-blue-600">
                              In progress
                            </span>
                          )}
                          {done && (
                            <span className="ml-auto text-xs font-medium text-green-600">
                              Done
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>

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
            ) : (
              <form onSubmit={submitQuickComment} className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
                <div>
                  <h2 className="font-semibold">Quick comment</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Share a status note without changing the latest progress percentages.
                  </p>
                </div>
                <textarea
                  required
                  value={quickComment}
                  onChange={(event) => setQuickComment(event.target.value)}
                  rows={5}
                  className="w-full rounded-md border p-3"
                  placeholder="Current status, blocker, material update, expected next step…"
                />
                {message && <p className="text-sm text-slate-700">{message}</p>}
                <button
                  type="submit"
                  disabled={submitting || !quickComment.trim()}
                  className="min-h-12 w-full rounded-md bg-blue-600 px-5 font-medium text-white disabled:opacity-50"
                >
                  {submitting ? 'Submitting…' : 'Submit quick comment'}
                </button>
              </form>
            )}

            <section className="rounded-xl border bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Update history</h2>
              {view.updates.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No updates submitted yet.</p>
              ) : (
                <div className="mt-4 space-y-4">
                  {view.updates.map((update) => (
                    <article key={update.id} className="border-l-2 border-blue-200 pl-4">
                      <div className="flex flex-wrap justify-between gap-2 text-sm">
                        <strong>
                          {update.updateType === 'COMMENT_ONLY' ? 'Quick comment' : 'Progress update'}
                        </strong>
                        <time className="text-slate-500">
                          {new Date(update.createdAt).toLocaleString()}
                        </time>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {update.reporterDisplayName}
                        {update.reporterType === 'INTERNAL_AUDITOR_VISIT' ? ' · Internal auditor visit' : ''}
                      </p>
                      {update.updateType === 'FULL_PROGRESS' && (
                        update.completedSteps != null ? (
                          <div className="mt-2 text-xs text-slate-600">
                            {PLM_PRODUCTION_STEPS[update.completedSteps - 1] ??
                              'Not started'}
                            {update.completedSteps > 0 &&
                              update.completedSteps < TOTAL_STEPS &&
                              ` → ${PLM_PRODUCTION_STEPS[update.completedSteps]}`}
                            <span className="ml-2 font-medium text-slate-800">
                              {update.completedSteps}/{TOTAL_STEPS} ·{' '}
                              {update.percentComplete ?? 0}%
                            </span>
                          </div>
                        ) : (
                          // Legacy free-form update recorded before step tracking.
                          <div className="mt-2 flex flex-wrap gap-3 text-xs">
                            <span>Fabrication {update.fabricationPercent}%</span>
                            <span>Surface finish {update.surfaceFinishPercent}%</span>
                            <span>Assembly {update.assemblyPercent}%</span>
                          </div>
                        )
                      )}
                      {update.notes && <p className="mt-2 text-sm">{update.notes}</p>}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
