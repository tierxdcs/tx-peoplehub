'use client';

/**
 * Hand-built SVG / CSS charts for the Executive Dashboards section — the same
 * lightweight approach the Personal Dashboard uses (SVG polylines, CSS
 * conic-gradients, div-width bars), so there is no charting-library dependency,
 * no theme plumbing and no client-side hydration cost for a page that is mostly
 * numbers. Every piece here is section-level on purpose: the planned Finance and
 * Production dashboards reuse these rather than growing their own.
 *
 * Two conventions, both load-bearing:
 *  - A `null` data point means "not measurable", NOT zero. Lines break at nulls
 *    and tiles print an em dash, so a gap in the data never reads as a real 0.
 *  - Colours are mid-tone hexes chosen to read on both the light (#FFFFFF) and
 *    dark (#232323) card surfaces, so no chart needs a theme-conditional palette.
 */

import { cn } from '../../../lib/utils';
import { SIGNAL_FAINT } from '../../../components/ui/signal';

/** Chart palette — mid-tone by design, legible on both card surfaces. */
export const CHART_COLORS = {
  blue: '#4C86D0',
  green: '#35B877',
  orange: '#E08A2C',
  red: '#E5484D',
  purple: '#8B6FD0',
  teal: '#2FA8A8',
  slate: '#7B8794',
} as const;

/** Fallback ordering for donuts whose slices carry no colour of their own. */
export const SLICE_PALETTE = [
  CHART_COLORS.blue,
  CHART_COLORS.green,
  CHART_COLORS.orange,
  CHART_COLORS.purple,
  CHART_COLORS.teal,
  CHART_COLORS.slate,
];

const VIEW_W = 600;

export interface ChartSeries {
  label: string;
  color: string;
  /** null = no measurable value for that bucket; the line breaks there. */
  values: Array<number | null>;
  /** Shade the area under this series (use for the primary one only). */
  fill?: boolean;
  /** Render as a dashed line — for a secondary/derived comparison series. */
  dashed?: boolean;
}

/**
 * Multi-series trend line. Kept hand-built because two polylines plus an area
 * path is genuinely less code than configuring a chart library, and it inherits
 * the page's type and colour without a theme bridge.
 */
export function TrendChart({
  labels,
  series,
  height = 148,
  formatValue,
  emptyMessage = 'No data for this period yet',
}: {
  labels: string[];
  series: ChartSeries[];
  height?: number;
  formatValue: (value: number) => string;
  emptyMessage?: string;
}) {
  const all = series.flatMap((s) =>
    s.values.filter((v): v is number => v !== null),
  );
  if (labels.length === 0 || all.length === 0) {
    return <p className={cn('py-8 text-[12px]', SIGNAL_FAINT)}>{emptyMessage}</p>;
  }
  const max = Math.max(...all, 1);
  const x = (index: number) =>
    labels.length === 1 ? VIEW_W / 2 : (index / (labels.length - 1)) * VIEW_W;
  // 6px top inset so a peak-value stroke isn't clipped by the viewBox edge.
  const y = (value: number) => height - 6 - (value / max) * (height - 12);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {series.map((s) => (
          <span
            key={s.label}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-black/55 dark:text-white/50"
          >
            <span
              className="h-[3px] w-3.5 rounded-full"
              style={{ background: s.color }}
            />
            {s.label}
          </span>
        ))}
        <span className={cn('ml-auto text-[11px] tabular-nums', SIGNAL_FAINT)}>
          peak {formatValue(max)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        preserveAspectRatio="none"
        className="mt-2.5 block w-full"
        style={{ height }}
        aria-hidden
      >
        {[0, 0.5, 1].map((fraction) => (
          <line
            key={fraction}
            x1={0}
            x2={VIEW_W}
            y1={y(max * fraction)}
            y2={y(max * fraction)}
            stroke="var(--sd-track)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {series.map((s) =>
          contiguousRuns(s.values).map((run, index) => {
            const points = run
              .map(({ value, at }) => `${x(at).toFixed(1)},${y(value).toFixed(1)}`)
              .join(' ');
            const first = run[0];
            const last = run[run.length - 1];
            return (
              <g key={`${s.label}-${index}`}>
                {s.fill && run.length > 1 && (
                  <path
                    d={`M ${x(first.at).toFixed(1)},${y(first.value).toFixed(1)} L ${points.replaceAll(' ', ' L ')} L ${x(last.at).toFixed(1)},${height} L ${x(first.at).toFixed(1)},${height} Z`}
                    fill={s.color}
                    fillOpacity={0.12}
                    stroke="none"
                  />
                )}
                {run.length === 1 ? (
                  <circle
                    cx={x(first.at)}
                    cy={y(first.value)}
                    r={3}
                    fill={s.color}
                  />
                ) : (
                  <polyline
                    points={points}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dashed ? '5 4' : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            );
          }),
        )}
      </svg>
      <div className="mt-1.5 flex justify-between">
        {labels.map((label) => (
          <span key={label} className={cn('text-[10px]', SIGNAL_FAINT)}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Split a series into runs of consecutive measurable points. */
function contiguousRuns(values: Array<number | null>) {
  const runs: Array<Array<{ value: number; at: number }>> = [];
  let current: Array<{ value: number; at: number }> = [];
  values.forEach((value, at) => {
    if (value === null) {
      if (current.length) runs.push(current);
      current = [];
      return;
    }
    current.push({ value, at });
  });
  if (current.length) runs.push(current);
  return runs;
}

/** Inline sparkline for a KPI tile — same shape as the Personal Dashboard's. */
export function Sparkline({
  values,
  color,
}: {
  values: Array<number | null>;
  color: string;
}) {
  const measurable = values.filter((v): v is number => v !== null);
  if (measurable.length < 2) return null;
  const max = Math.max(...measurable);
  const min = Math.min(...measurable);
  const range = Math.max(max - min, 1);
  return (
    <svg
      viewBox="0 0 120 28"
      preserveAspectRatio="none"
      className="mt-2.5 block h-[26px] w-full"
      aria-hidden
    >
      {contiguousRuns(values).map((run, index) => (
        <polyline
          key={index}
          points={run
            .map(
              ({ value, at }) =>
                `${((at / Math.max(values.length - 1, 1)) * 120).toFixed(1)},${(25 - ((value - min) / range) * 19).toFixed(1)}`,
            )
            .join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
  /** Pre-formatted share label, or null when the share is undefined. */
  percentLabel: string | null;
}

/**
 * CSS conic-gradient donut. Renders the empty track (never a fake slice) when
 * the slices total zero.
 */
export function Donut({
  slices,
  centerValue,
  centerLabel,
}: {
  slices: DonutSlice[];
  centerValue: string;
  centerLabel: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const stops: string[] = [];
  let accumulated = 0;
  for (const slice of slices) {
    if (slice.value <= 0 || total <= 0) continue;
    const from = (accumulated / total) * 100;
    accumulated += slice.value;
    stops.push(`${slice.color} ${from}% ${(accumulated / total) * 100}%`);
  }
  return (
    <div
      className="grid size-[124px] flex-none place-items-center rounded-full"
      style={{
        background: `conic-gradient(${stops.join(',') || 'var(--sd-track) 0 100%'})`,
      }}
    >
      <div className="grid size-[88px] place-items-center rounded-full bg-white text-center dark:bg-[#232323]">
        <div>
          <div className="text-[16px] font-extrabold leading-none tracking-[-.6px] tabular-nums">
            {centerValue}
          </div>
          <div className="mt-1 text-[9.5px] text-black/50 dark:text-white/45">
            {centerLabel}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Legend line for a donut slice: swatch · label · value · share. */
export function LegendRow({
  color,
  label,
  value,
  percentLabel,
}: {
  color: string;
  label: string;
  value: string;
  percentLabel: string | null;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span
        className="size-[7px] flex-none rounded-full"
        style={{ background: color }}
      />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      <span className="flex-none font-semibold tabular-nums">{value}</span>
      <span
        className={cn(
          'w-[46px] flex-none text-right text-[11px] tabular-nums',
          SIGNAL_FAINT,
        )}
      >
        {percentLabel ?? '—'}
      </span>
    </div>
  );
}

/**
 * Semicircle-free radial gauge for a single percentage (margin, win rate).
 * `percent` may be null — the gauge then shows the empty track and an em dash,
 * which is the honest rendering of "not measurable".
 */
export function Gauge({
  percent,
  label,
  color = CHART_COLORS.green,
}: {
  percent: number | null;
  label: string;
  color?: string;
}) {
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div
      className="grid size-[104px] flex-none place-items-center rounded-full"
      style={{
        background:
          percent === null
            ? 'var(--sd-track)'
            : `conic-gradient(${color} 0 ${clamped}%, var(--sd-track) ${clamped}% 100%)`,
      }}
    >
      <div className="grid size-[76px] place-items-center rounded-full bg-white text-center dark:bg-[#232323]">
        <div>
          <div className="text-[19px] font-extrabold leading-none tracking-[-.8px] tabular-nums">
            {percent === null ? '—' : `${percent.toFixed(1)}%`}
          </div>
          <div className="mt-1 text-[9px] uppercase tracking-[.12em] text-black/45 dark:text-white/40">
            {label}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Stepped funnel. Bar width is proportional to the stage's COUNT (every stage
 * has one), and the value is printed alongside — so a stage with no monetary
 * field still has an honest bar instead of a missing one.
 */
export function FunnelBars({
  stages,
}: {
  stages: Array<{
    key: string;
    label: string;
    count: number;
    valueLabel: string;
    note: string | null;
    color: string;
  }>;
}) {
  const max = Math.max(...stages.map((s) => s.count), 1);
  return (
    <div className="space-y-3">
      {stages.map((stage, index) => {
        const previous = index === 0 ? null : stages[index - 1].count;
        const conversion =
          previous && previous > 0
            ? `${((stage.count / previous) * 100).toFixed(0)}% of previous`
            : null;
        return (
          <div key={stage.key}>
            <div className="flex items-baseline gap-2">
              <span className="text-[12px] font-semibold">{stage.label}</span>
              <span className="text-[15px] font-extrabold tabular-nums tracking-[-.4px]">
                {stage.count}
              </span>
              <span className="ml-auto text-[12px] font-semibold tabular-nums">
                {stage.valueLabel}
              </span>
            </div>
            <div className="mt-1 h-[9px] overflow-hidden rounded-[3px] bg-black/[.06] dark:bg-white/[.07]">
              <div
                className="h-full rounded-[3px]"
                style={{
                  width: `${Math.max((stage.count / max) * 100, stage.count > 0 ? 2 : 0)}%`,
                  background: stage.color,
                }}
              />
            </div>
            {(stage.note || conversion) && (
              <div
                className={cn(
                  'mt-1 flex justify-between text-[10.5px]',
                  SIGNAL_FAINT,
                )}
              >
                <span>{stage.note ?? ''}</span>
                <span className="tabular-nums">{conversion ?? ''}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Single horizontal bar split into proportional segments (new vs repeat, …). */
export function SplitBar({
  segments,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div>
      <div className="flex h-[11px] overflow-hidden rounded-[3px] bg-black/[.06] dark:bg-white/[.07]">
        {total > 0 &&
          segments.map((segment) => (
            <div
              key={segment.label}
              style={{
                width: `${(segment.value / total) * 100}%`,
                background: segment.color,
              }}
            />
          ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment) => (
          <span
            key={segment.label}
            className="inline-flex items-center gap-1.5 text-[11.5px] font-medium"
          >
            <span
              className="size-[7px] rounded-full"
              style={{ background: segment.color }}
            />
            {segment.label}
            <span className="font-semibold tabular-nums">
              {total > 0
                ? `${((segment.value / total) * 100).toFixed(0)}%`
                : '—'}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
