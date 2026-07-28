'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { Check, CheckCircle2, Clock3, Lock, PackageCheck, Star } from 'lucide-react';
import {
  CustomerOrderProgress,
  resolveCustomerOrderProgress,
  submitCustomerDeliverySignoff,
} from '../../../lib/customer-order-progress';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip);

function PhazeLogo({
  variant,
  className = '',
}: {
  variant: 'dark' | 'light';
  className?: string;
}) {
  return (
    <div
      className={`relative h-16 w-[220px] overflow-hidden ${className}`}
      aria-label="Phaze Dynamics"
    >
      <Image
        src={
          variant === 'dark'
            ? '/phaze-3b-logo-native.png'
            : '/phaze-3b-logo-white.png'
        }
        alt="Phaze Dynamics"
        width={924}
        height={540}
        priority
        className="absolute -top-6 left-0 h-auto w-[220px] max-w-none"
      />
    </div>
  );
}

function Countdown({ progress }: { progress: CustomerOrderProgress }) {
  const { countdown } = progress;
  const style =
    countdown.state === 'OVERDUE'
      ? 'border-red-200 bg-red-50 text-red-800'
      : countdown.state === 'DELIVERED'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-blue-200 bg-blue-50 text-blue-900';
  const text =
    countdown.state === 'OVERDUE'
      ? `Overdue by ${countdown.days} day${countdown.days === 1 ? '' : 's'}`
      : countdown.state === 'DELIVERED'
        ? 'Delivered'
        : countdown.state === 'UNKNOWN'
          ? 'Delivery date being confirmed'
          : `${countdown.days} day${countdown.days === 1 ? '' : 's'} to delivery`;
  return (
    <div className={`rounded-2xl border px-5 py-4 ${style}`}>
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em]">
        <Clock3 className="size-4" /> Delivery
      </div>
      <div className="mt-1 text-2xl font-bold sm:text-3xl">{text}</div>
      {progress.promisedDeliveryDate && (
        <div className="mt-1 text-sm opacity-75">
          Promised {new Date(progress.promisedDeliveryDate).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

function StageTimeline({
  stages,
}: {
  stages: CustomerOrderProgress['lines'][number]['stages'];
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = stages.find((stage) => stage.key === selectedKey) ?? null;
  const statusLabel = selected
    ? selected.state === 'DONE'
      ? 'Completed'
      : selected.state === 'CURRENT'
        ? 'Current stage'
        : 'Upcoming'
    : null;

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-[840px] items-start">
          {stages.map((stage, index) => (
            <div key={stage.key} className="flex min-w-0 flex-1 items-start">
              <button
                type="button"
                onClick={() => setSelectedKey(stage.key)}
                aria-pressed={selectedKey === stage.key}
                aria-label={`View ${stage.label} status`}
                className="group flex min-w-24 flex-col items-center rounded-lg px-1 pb-2 text-center outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-600"
              >
              <div
                className={`flex size-9 items-center justify-center rounded-full border-2 transition group-hover:scale-105 ${
                  stage.state === 'DONE'
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : stage.state === 'CURRENT'
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-300 bg-white text-slate-400'
                }`}
              >
                {stage.state === 'DONE' ? <Check className="size-5" /> : index + 1}
              </div>
              <span
                className={`mt-2 text-xs font-semibold ${
                  stage.state === 'UPCOMING' ? 'text-slate-400' : 'text-slate-800'
                }`}
              >
                {stage.label}
              </span>
              </button>
              {index < stages.length - 1 && (
                <div
                  className={`mt-4 h-0.5 flex-1 ${
                    stages[index + 1].state !== 'UPCOMING'
                      ? 'bg-emerald-500'
                      : 'bg-slate-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      {selected && (
        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
          role="status"
        >
          <div>
            <div className="font-semibold text-slate-900">{selected.label}</div>
            <div
              className={
                selected.state === 'DONE'
                  ? 'text-emerald-700'
                  : selected.state === 'CURRENT'
                    ? 'text-blue-700'
                    : 'text-slate-500'
              }
            >
              {statusLabel}
            </div>
          </div>
          <div className="text-right text-slate-600">
            {selected.changedAt ? (
              <>
                <div className="text-xs uppercase tracking-wide text-slate-400">
                  Status changed
                </div>
                <time dateTime={selected.changedAt}>
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(selected.changedAt))}
                </time>
              </>
            ) : (
              <span>No status change recorded yet</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CustomerOrderProgressPage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [progress, setProgress] = useState<CustomerOrderProgress | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [signoff, setSignoff] = useState({
    customerName: '',
    designation: '',
    receiptConfirmed: false,
    comments: '',
    satisfactionRating: 0,
  });
  const [submitting, setSubmitting] = useState(false);

  async function resolve(passwordValue = password) {
    setLoading(true);
    const result = await resolveCustomerOrderProgress(
      token,
      passwordValue || undefined,
    );
    if (result.ok) {
      if ('requiresPassword' in result.data) {
        setProgress(null);
        setMessage('This link is password protected. Enter the password to continue.');
      } else {
        setProgress(result.data);
        setMessage('');
      }
    } else {
      setMessage(result.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    void resolve('');
    // Resolve once on entry; protected links are retried via the password form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const lineCount = progress?.lines.length ?? 0;
  const cardGrid = useMemo(
    () => (lineCount === 1 ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'),
    [lineCount],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    const result = await submitCustomerDeliverySignoff(token, {
      password: password || undefined,
      ...signoff,
      satisfactionRating: signoff.satisfactionRating || undefined,
    });
    if (result.ok) {
      await resolve(password);
      setMessage('Thank you. Your delivery acknowledgement has been recorded.');
    } else {
      setMessage(result.message);
    }
    setSubmitting(false);
  }

  // Login / gate state — a dedicated bold, centered screen shown before the
  // order resolves (loading, awaiting password, or a link error).
  if (!progress) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-12 text-slate-100">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <PhazeLogo variant="dark" className="mx-auto" />
            <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
              Customer Order Portal
            </h1>
            <p className="mt-3 text-base text-slate-400">
              Track your order from production to delivery.
            </p>
          </div>

          <div className="rounded-3xl bg-white p-8 text-slate-900 shadow-2xl">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-blue-600 text-white">
              <Lock className="size-6" />
            </div>
            {loading ? (
              <p className="mt-6 text-center text-sm text-slate-600">
                Opening your secure link…
              </p>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void resolve(password);
                }}
                className="mt-6 space-y-4"
              >
                <div className="text-center">
                  <h2 className="text-xl font-bold">Enter your access password</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {message || 'This link is password protected.'}
                  </p>
                </div>
                <div>
                  <label
                    className="block text-sm font-semibold"
                    htmlFor="progress-password"
                  >
                    Link password
                  </label>
                  <input
                    id="progress-password"
                    type="password"
                    autoFocus
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter password"
                    className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <button
                  type="submit"
                  className="min-h-12 w-full rounded-xl bg-blue-600 px-5 text-base font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  Continue
                </button>
              </form>
            )}
          </div>

          <p className="mt-8 text-center text-xs text-slate-500">
            System generated by PhazeOne · Read-only customer progress view
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl bg-slate-950 px-6 py-7 text-white shadow-xl sm:px-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PhazeLogo variant="dark" />
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">
              Customer Order Portal
            </div>
          </div>
          {progress && (
            <div className="mt-4 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
              <div>
                <div className="text-sm text-slate-300">Order</div>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                  {progress.orderNumber}
                </h1>
                <p className="mt-2 text-slate-300">{progress.customerName}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {progress.productNames.join(' · ')}
                </p>
              </div>
              <Countdown progress={progress} />
            </div>
          )}
        </header>

        <>
            <div className={`grid gap-5 ${cardGrid}`}>
              {progress.lines.map((line) => (
                <article
                  key={line.lineId}
                  className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Product progress
                      </div>
                      <h2 className="mt-1 text-xl font-bold">{line.productName}</h2>
                    </div>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
                      {line.currentStage.label}
                    </span>
                  </div>
                  <div className="mt-7">
                    <StageTimeline stages={line.stages} />
                  </div>
                  {(line.currentStage.key === 'PRODUCTION' || line.pace) && (
                    <div className="mt-7 grid gap-6 border-t border-slate-100 pt-6 sm:grid-cols-2">
                      {line.currentStage.key === 'PRODUCTION' && (
                        <div className="mx-auto w-full max-w-[190px]">
                          <div className="mb-2 text-center text-sm font-semibold text-slate-600">
                            Production complete
                          </div>
                          <div className="relative mx-auto size-44">
                            <Doughnut
                              data={{
                                datasets: [
                                  {
                                    data: [line.productionPercent, 100 - line.productionPercent],
                                    backgroundColor: ['#2563eb', '#e2e8f0'],
                                    borderWidth: 0,
                                  },
                                ],
                              }}
                              options={{
                                responsive: true,
                                maintainAspectRatio: true,
                                cutout: '75%',
                                plugins: { tooltip: { enabled: false } },
                              }}
                            />
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-2xl font-bold">
                              {line.productionPercent}%
                            </div>
                          </div>
                        </div>
                      )}
                      {line.pace && (
                        <div>
                          <div className="mb-3 text-sm font-semibold text-slate-600">
                            Project pace
                          </div>
                          <div className="relative h-24 w-full">
                            <Bar
                              data={{
                                labels: ['Timeline elapsed'],
                                datasets: [
                                  {
                                    data: [line.pace.percent],
                                    backgroundColor:
                                      line.pace.percent >= 90 ? '#f59e0b' : '#0f766e',
                                    borderRadius: 8,
                                  },
                                ],
                              }}
                              options={{
                                responsive: true,
                                indexAxis: 'y',
                                scales: {
                                  x: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } },
                                  y: { display: false },
                                },
                                plugins: { tooltip: { enabled: false } },
                                maintainAspectRatio: false,
                              }}
                            />
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            Day {line.pace.elapsedDays} of {line.pace.totalDays}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>

            {progress.canSignoff && (
              <section className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm sm:p-8">
                <div className="flex items-center gap-3">
                  <PackageCheck className="size-7 text-emerald-700" />
                  <div>
                    <h2 className="text-xl font-bold">Delivery acknowledgement</h2>
                    <p className="text-sm text-slate-600">
                      Please confirm when the goods have been received.
                    </p>
                  </div>
                </div>
                <form onSubmit={submit} className="mt-6 grid max-w-3xl gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold">
                    Your name
                    <input
                      required
                      value={signoff.customerName}
                      onChange={(e) => setSignoff({ ...signoff, customerName: e.target.value })}
                      className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 font-normal"
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    Designation
                    <input
                      required
                      value={signoff.designation}
                      onChange={(e) => setSignoff({ ...signoff, designation: e.target.value })}
                      className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 font-normal"
                    />
                  </label>
                  <label className="text-sm font-semibold sm:col-span-2">
                    Comments (optional)
                    <textarea
                      value={signoff.comments}
                      onChange={(e) => setSignoff({ ...signoff, comments: e.target.value })}
                      className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 p-3 font-normal"
                    />
                  </label>
                  <fieldset className="sm:col-span-2">
                    <legend className="text-sm font-semibold">Satisfaction (optional)</legend>
                    <div className="mt-2 flex gap-2">
                      {[1, 2, 3, 4, 5].map((rating) => (
                        <button
                          type="button"
                          key={rating}
                          aria-label={`${rating} stars`}
                          onClick={() => setSignoff({ ...signoff, satisfactionRating: rating })}
                          className="min-h-11 min-w-11 rounded-lg border border-slate-200"
                        >
                          <Star
                            className={`mx-auto size-5 ${
                              rating <= signoff.satisfactionRating
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-slate-300'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <label className="flex items-start gap-3 text-sm sm:col-span-2">
                    <input
                      required
                      type="checkbox"
                      checked={signoff.receiptConfirmed}
                      onChange={(e) =>
                        setSignoff({ ...signoff, receiptConfirmed: e.target.checked })
                      }
                      className="mt-1 size-5"
                    />
                    <span>
                      <strong>I confirm receipt of the goods.</strong>
                      <span className="mt-1 block text-slate-500">
                        This is a delivery acknowledgement for operational records,
                        not a legally binding electronic signature.
                      </span>
                    </span>
                  </label>
                  <button
                    disabled={submitting || !signoff.receiptConfirmed}
                    className="min-h-11 rounded-lg bg-emerald-700 px-6 font-semibold text-white disabled:opacity-50 sm:col-span-2 sm:w-fit"
                  >
                    {submitting ? 'Submitting…' : 'Confirm receipt'}
                  </button>
                </form>
              </section>
            )}

            {progress.signoffSubmitted && (
              <section className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
                <CheckCircle2 className="size-6 shrink-0" />
                <div>
                  <div className="font-bold">Delivery acknowledged</div>
                  <div className="text-sm">
                    Recorded {new Date(progress.signoffSubmittedAt!).toLocaleString()}
                  </div>
                </div>
              </section>
            )}
            {message && (
              <p className="rounded-xl bg-white p-4 text-sm text-slate-700 shadow-sm">
                {message}
              </p>
            )}
          </>
        <footer className="flex flex-col items-center py-4 text-center text-xs text-slate-500">
          <PhazeLogo variant="light" className="scale-75" />
          <span>System generated · Read-only customer progress view</span>
        </footer>
      </div>
    </main>
  );
}
