'use client';

/**
 * "Signal" design-language primitives — the shared building blocks of the
 * redesigned pages (dashboard, new purchase order, sales pipeline).
 * The module-by-module conversion playbook lives in /SIGNAL_UI.md.
 *
 * The language in one paragraph: pages are full-bleed surfaces on the app grey
 * ramp (#F4F4F4 light / #1B1B1B dark) with white/#232323 cards separated by
 * hairline borders, the app blue #3B6FB5 for primary actions and #3B6FB5/#6FA3E0
 * for links, orange #E08A2C strictly for warning/at-risk meaning, green/red for
 * success/danger. UI text uses the app font with tabular-nums for numeric
 * columns (never a mono face). Depth comes from surface steps and hairlines —
 * no shadows. Empty states are a plain muted sentence, never an illustration.
 *
 * Usage sketch:
 *   <SignalPage>
 *     <SignalHeader backHref="/sales/orders" backLabel="Orders"
 *       title="ORD-2026-0006" chip={<SignalChip>Confirmed</SignalChip>}
 *       actions={<>…buttons…</>} />
 *     <div className="grid gap-4 px-5 pb-7 pt-[18px] lg:px-7 xl:grid-cols-[1fr_316px]">
 *       <SCard className="px-5 py-[18px]">…</SCard>
 *       <div className="flex flex-col gap-3.5 xl:sticky xl:top-[4.5rem]">…rail…</div>
 *     </div>
 *   </SignalPage>
 *
 * For tables: header row = SIGNAL_TABLE_HEAD on a grid, body rows share the
 * same grid template with SIGNAL_ROW_DIVIDER between rows and a hover tint.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

// ── Class constants (compose into page-specific markup) ─────────────────────

/** Card / section hairline border. */
export const SIGNAL_HAIRLINE = 'border-black/10 dark:border-white/[.08]';
/** List/table row divider (subtler than the hairline). */
export const SIGNAL_ROW_DIVIDER = 'border-black/[.07] dark:border-white/[.06]';
/** Inline text link in the accent blue. */
export const SIGNAL_LINK =
  'font-semibold text-[#3B6FB5] dark:text-[#6FA3E0] hover:underline';
/** Secondary text (labels, meta). */
export const SIGNAL_MUTED = 'text-black/45 dark:text-white/40';
/** Faintest text (empty states, axis ticks, placeholders). */
export const SIGNAL_FAINT = 'text-black/40 dark:text-white/[.32]';
/** Uppercase micro-label (section eyebrows, table group headers). */
export const SIGNAL_EYEBROW =
  'text-[10px] font-semibold uppercase tracking-[.14em] text-black/45 dark:text-white/[.42]';
/** Table header row: pair with a `grid` + the page's column template. */
export const SIGNAL_TABLE_HEAD =
  'border-y border-black/10 bg-black/[.035] text-[12px] font-medium text-black/60 dark:border-white/[.08] dark:bg-white/[.035] dark:text-white/[.62]';
/** Row hover tint for clickable list/table rows. */
export const SIGNAL_ROW_HOVER =
  'transition-colors hover:bg-black/[.03] dark:hover:bg-white/[.03]';
/** Primary (blue) action button. */
export const SIGNAL_BTN_PRIMARY =
  'rounded-lg bg-[#3B6FB5] px-4 py-2 text-[12.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50';
/** Quiet text button (Cancel etc.). */
export const SIGNAL_BTN_GHOST =
  'rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-black/65 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/5';
/** Signal surface for a DialogContent / AlertDialogContent (pass as className;
 * the dialog primitives merge it over their defaults). */
export const SIGNAL_DIALOG =
  'rounded-xl border-black/10 bg-white text-[#1B1B1B] dark:border-white/[.08] dark:bg-[#232323] dark:text-[#EDEDED]';
/** Signal dialog/panel heading (pass as className on DialogTitle). */
export const SIGNAL_DIALOG_TITLE = 'text-[17px] font-bold tracking-[-.4px]';
/** Outlined secondary button. */
export const SIGNAL_BTN_OUTLINE =
  'rounded-lg border border-black/15 px-3.5 py-2 text-[12.5px] font-semibold text-black/75 hover:bg-black/[.03] dark:border-white/[.16] dark:text-white/80 dark:hover:bg-white/[.04]';

// ── Page scaffold ────────────────────────────────────────────────────────────

/**
 * Full-bleed Signal page surface. Counteracts the shell's <main> padding,
 * fills the viewport, and (via the body attribute + globals.css) paints the
 * shell's stretched content column to match in both themes.
 */
export function SignalPage({
  className,
  style,
  children,
}: {
  className?: string;
  /** For page-scoped CSS custom properties (e.g. a measured chrome height). */
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  useEffect(() => {
    document.body.dataset.signalPage = '';
    return () => {
      delete document.body.dataset.signalPage;
    };
  }, []);
  return (
    <div
      style={style}
      className={cn(
        '-m-4 min-h-[calc(100dvh-3.5rem)] bg-[#F4F4F4] text-[#1B1B1B] md:-m-6 dark:bg-[#1B1B1B] dark:text-[#EDEDED]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The header action bar: breadcrumb · title · chips · right-aligned actions. */
export function SignalHeader({
  backHref,
  backLabel,
  breadcrumb,
  title,
  description,
  chip,
  actions,
}: {
  backHref?: string;
  backLabel?: string;
  /**
   * A multi-level path trail, for pages nested deeper than one level (Vault
   * folders). Rendered on its own row above the title; use `backHref` instead
   * when a single "back to the register" link says everything.
   */
  breadcrumb?: React.ReactNode;
  title: React.ReactNode;
  /** One-line register/page description shown under the title row. */
  description?: React.ReactNode;
  chip?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="border-b border-black/10 bg-[#ECECEC] px-5 py-3.5 lg:px-7 dark:border-white/[.07] dark:bg-[#1F1F1F]">
      {breadcrumb && <div className="mb-1.5">{breadcrumb}</div>}
      <div className="flex flex-wrap items-center gap-3.5">
        {backHref && (
          <>
            <Link
              href={backHref}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-black/45 hover:text-black/70 dark:text-white/45 dark:hover:text-white/70"
            >
              <ArrowLeft className="size-3.5" /> {backLabel ?? 'Back'}
            </Link>
            <span className="hidden h-4 w-px bg-black/15 sm:inline dark:bg-white/[.12]" />
          </>
        )}
        <h1 className="text-[19px] font-extrabold tracking-[-.7px]">{title}</h1>
        {chip}
        {actions && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {description && (
        <p className="mt-1 text-[12px] text-black/45 dark:text-white/45">
          {description}
        </p>
      )}
    </div>
  );
}

/** Neutral chip for the header (e.g. "Draft", a status, a count). */
export function SignalChip({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'rounded-[5px] bg-black/10 px-[9px] py-1 text-[11.5px] font-medium text-black/65 dark:bg-white/[.09] dark:text-white/60',
        className,
      )}
    >
      {children}
    </span>
  );
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

/** The standard card surface. */
export function SCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-white dark:bg-[#232323]',
        SIGNAL_HAIRLINE,
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Card title row: bold title + optional muted subtitle, on one baseline. */
export function SCardTitle({
  title,
  subtitle,
  right,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2.5">
      <span className="text-[14px] font-bold">{title}</span>
      {subtitle && (
        <span className="text-[11.5px] text-black/40 dark:text-white/35">
          {subtitle}
        </span>
      )}
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}

/** Warning (orange) or danger (red) callout with the leading glyph. */
export function Callout({
  variant = 'warning',
  className,
  children,
}: {
  variant?: 'warning' | 'danger';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'mt-3.5 flex gap-2.5 rounded-[9px] border px-3.5 py-3',
        variant === 'warning'
          ? 'border-[#C9761B] bg-[#E08A2C]/[.09] dark:border-[#E08A2C]'
          : 'border-[#E5484D]/40 bg-[#E5484D]/[.07]',
        className,
      )}
    >
      <AlertTriangle
        className={cn(
          'mt-0.5 size-4 shrink-0',
          variant === 'warning'
            ? 'text-[#C9761B] dark:text-[#E08A2C]'
            : 'text-[#C13438] dark:text-[#FF8A8D]',
        )}
      />
      <div className="text-[12px] leading-normal text-black/70 dark:text-white/[.72]">
        {children}
      </div>
    </div>
  );
}

// ── Rail widgets ─────────────────────────────────────────────────────────────

/** Label / value row inside a summary card. */
export function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between border-b py-2 text-[12px] font-medium text-black/60 dark:text-white/55',
        SIGNAL_ROW_DIVIDER,
      )}
    >
      <span>{label}</span>
      <span className="text-[12.5px] font-semibold tabular-nums text-[#1B1B1B] dark:text-[#EDEDED]">
        {value}
      </span>
    </div>
  );
}

/** One step of a vertical route/status timeline. */
export function RouteStep({
  state,
  title,
  meta,
  last,
}: {
  state: 'done' | 'active' | 'future';
  title: string;
  meta?: string;
  last?: boolean;
}) {
  return (
    <div className="flex gap-[11px]">
      <div className="flex flex-col items-center">
        {state === 'done' ? (
          <span className="grid size-[18px] flex-none place-items-center rounded-full bg-[#1E9E63] dark:bg-[#3DD68C]">
            <Check className="size-3 text-white dark:text-[#1B1B1B]" />
          </span>
        ) : (
          <span
            className={cn(
              'size-[18px] flex-none rounded-full border-2',
              state === 'active'
                ? 'border-[#3B6FB5] dark:border-[#6FA3E0]'
                : 'border-black/15 dark:border-white/[.16]',
            )}
          />
        )}
        {!last && (
          <span className="min-h-[22px] w-[2px] flex-1 bg-black/10 dark:bg-white/[.12]" />
        )}
      </div>
      <div className={cn(!last && 'pb-3.5')}>
        <div
          className={cn(
            'text-[12.5px] font-semibold',
            state === 'active' && 'text-[#3B6FB5] dark:text-[#6FA3E0]',
            state === 'future' && 'text-black/40 dark:text-white/40',
          )}
        >
          {title}
        </div>
        {meta && (
          <div className="text-[11px] text-black/45 dark:text-white/40">
            {meta}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Status chips ─────────────────────────────────────────────────────────────

export type SignalTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_CHIP: Record<SignalTone, string> = {
  neutral:
    'bg-black/[.07] text-black/65 dark:bg-white/[.08] dark:text-white/60',
  info: 'bg-[#3B6FB5]/[.12] text-[#3B6FB5] dark:bg-[#3B6FB5]/[.25] dark:text-[#6FA3E0]',
  success:
    'bg-[#3DD68C]/[.14] text-[#1E9E63] dark:text-[#3DD68C]',
  warning:
    'bg-[#E08A2C]/[.16] text-[#C9761B] dark:text-[#E08A2C]',
  danger:
    'bg-[#E5484D]/[.14] text-[#C13438] dark:text-[#FF8A8D]',
};

/** Small status chip in one of the Signal tones. */
export function ToneChip({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: SignalTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[5px] px-2 py-[3px] text-[10.5px] font-semibold',
        TONE_CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Big-number stat tile for list-page KPI strips (no sparkline). */
export function StatTile({
  label,
  value,
  valueClass,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <div className="bg-white px-[18px] py-4 dark:bg-[#232323]">
      <div className={SIGNAL_EYEBROW}>{label}</div>
      <div
        className={cn(
          'mt-1.5 text-[30px] font-extrabold leading-none tracking-[-1.4px] tabular-nums',
          valueClass,
        )}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-1.5 text-[11px] text-black/40 dark:text-white/[.33]">
          {hint}
        </div>
      )}
    </div>
  );
}

/** Hairline-gapped container for a row of StatTiles. */
export function StatStrip({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-black/10 bg-black/10 md:grid-cols-4 dark:border-white/[.08] dark:bg-white/[.08]',
        className,
      )}
    >
      {children}
    </div>
  );
}
