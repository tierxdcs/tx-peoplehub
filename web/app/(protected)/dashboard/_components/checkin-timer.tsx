'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { todayDateStr } from '../../../lib/date';
import type { Attendance, PaginatedResult } from '../../../lib/types';
import { cn } from '../../../lib/utils';

/** Hours on the clock before the ribbon warns, then escalates. */
export const WARN_AFTER_HOURS = 6;
export const ALERT_AFTER_HOURS = 8;

const HOUR_MS = 3_600_000;

export type CheckinTone = 'idle' | 'warn' | 'alert';

/**
 * Ribbon tone for a running clock. Thresholds are inclusive — six hours exactly
 * already reads as a long day, rather than waiting for 6:00:01.
 */
export function checkinTone(elapsedMs: number): CheckinTone {
  const hours = elapsedMs / HOUR_MS;
  if (hours >= ALERT_AFTER_HOURS) return 'alert';
  if (hours >= WARN_AFTER_HOURS) return 'warn';
  return 'idle';
}

/** `H:MM:SS`, counting past 24h rather than wrapping (a forgotten check-out). */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Time on the clock since today's check-in, as a live ribbon readout.
 *
 * Deliberately its own component with its own one-second interval: ticking
 * state on the dashboard page would re-render every card (portfolio charts,
 * ping panel, PLM work) once a second. Here the re-render is confined to this
 * one chip.
 *
 * Reads zero whenever the clock isn't running — before the first check-in and
 * again after check-out — rather than freezing at the day's total, so the
 * number always answers "how long have I been on the clock right now". The
 * day's finished total stays on the Attendance page.
 */
export function CheckinTimer() {
  const [today, setToday] = useState<Attendance | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const load = useCallback(async () => {
    try {
      // Own history is date-desc, so one row is either today's or an older day.
      const res = await apiFetch<PaginatedResult<Attendance>>(
        '/attendance/me?page=1&limit=1',
      );
      const latest = res.items[0] ?? null;
      setToday(
        latest && latest.date.slice(0, 10) === todayDateStr() ? latest : null,
      );
    } catch {
      // A failed fetch leaves the last known state; the ribbon just goes stale.
    } finally {
      setLoaded(true);
    }
  }, []);

  // Attendance only changes when the user checks in or out — on another page or
  // another device — so poll slowly and catch up whenever they return here.
  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(poll);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const running = !!today?.checkInTime && !today.checkOutTime;
  const checkInAt = today?.checkInTime ?? null;

  useEffect(() => {
    if (!running || !checkInAt) {
      setElapsedMs(0);
      return;
    }
    const startedAt = new Date(checkInAt).getTime();
    // Clamp: a clock-skewed or corrected check-in must never count backwards.
    const tick = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [running, checkInAt]);

  const tone = checkinTone(elapsedMs);

  const label = running
    ? `On the clock since ${new Date(checkInAt!).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })}`
    : today?.checkOutTime
      ? 'Checked out — clock reset for today'
      : 'Not checked in yet today';

  return (
    <Link
      href="/attendance"
      title={label}
      aria-label={`${label}. ${formatDuration(elapsedMs)} on the clock.`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-[11px] py-[5px] text-[11.5px] font-semibold tabular-nums transition-colors',
        tone === 'alert' &&
          'bg-[#D9363E]/[.16] text-[#D9363E] dark:text-[#FF5257]',
        tone === 'warn' &&
          'bg-[#E08A2C]/[.16] text-[#C9761B] dark:text-[#E08A2C]',
        tone === 'idle' &&
          'text-black/50 hover:text-black/70 dark:text-white/45 dark:hover:text-white/70',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          running ? 'animate-pulse bg-current' : 'bg-current opacity-40',
        )}
      />
      {loaded ? formatDuration(elapsedMs) : '—:--:--'}
    </Link>
  );
}
