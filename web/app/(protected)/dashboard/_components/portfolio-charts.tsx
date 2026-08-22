'use client';

import { useMemo } from 'react';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { useTheme } from 'next-themes';
import { Card, CardContent } from '../../../components/ui/card';

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
);

type Health = { onTrack: number; atRisk: number; blocked: number };
type Blocker = { reason: string; count: number };

function cssColor(token: string) {
  if (typeof window === 'undefined') return '#888';
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  return `hsl(${value})`;
}

export function PortfolioCharts({
  health,
  blockers,
}: {
  health: Health;
  blockers: Blocker[];
}) {
  const { resolvedTheme } = useTheme();
  const colors = useMemo(
    () => ({
      success: cssColor('--success'),
      warning: cssColor('--warning'),
      danger: cssColor('--destructive'),
      primary: cssColor('--primary'),
      text: cssColor('--muted-foreground'),
      border: cssColor('--border'),
    }),
    [resolvedTheme],
  );
  const total = health.onTrack + health.atRisk + health.blocked;

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="grid min-h-64 grid-cols-[minmax(0,11rem)_1fr] items-center gap-4 p-5">
          <div className="relative h-44">
            <Doughnut
              data={{
                labels: ['On track', 'At risk', 'Blocked'],
                datasets: [
                  {
                    data: [health.onTrack, health.atRisk, health.blocked],
                    backgroundColor: [
                      colors.success,
                      colors.warning,
                      colors.danger,
                    ],
                    borderColor: colors.border,
                    borderWidth: 2,
                  },
                ],
              }}
              options={{
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: { legend: { display: false } },
              }}
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-semibold tabular-nums">{total}</span>
              <span className="text-xs text-muted-foreground">projects</span>
            </div>
          </div>
          <div>
            <h2 className="font-semibold">Portfolio health</h2>
            <p className="mb-4 text-sm text-muted-foreground">Your visible projects at a glance</p>
            <HealthRow label="On track" value={health.onTrack} color="bg-success" />
            <HealthRow label="At risk" value={health.atRisk} color="bg-warning" />
            <HealthRow label="Blocked" value={health.blocked} color="bg-destructive" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="min-h-64 p-5">
          <h2 className="font-semibold">Top lifecycle blockers</h2>
          <p className="mb-4 text-sm text-muted-foreground">Most common reasons across your active order lines</p>
          {blockers.length ? (
            <div className="h-44">
              <Bar
                data={{
                  labels: blockers.map((item) => item.reason),
                  datasets: [
                    {
                      label: 'Blocked lines',
                      data: blockers.map((item) => item.count),
                      backgroundColor: colors.danger,
                      borderRadius: 5,
                    },
                  ],
                }}
                options={{
                  maintainAspectRatio: false,
                  indexAxis: 'y',
                  scales: {
                    x: {
                      beginAtZero: true,
                      ticks: { precision: 0, color: colors.text },
                      grid: { color: colors.border },
                    },
                    y: {
                      ticks: { color: colors.text },
                      grid: { display: false },
                    },
                  },
                  plugins: { legend: { display: false } },
                }}
              />
            </div>
          ) : (
            <div className="flex h-44 items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
              No active lifecycle blockers
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function HealthRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="flex items-center gap-2"><span className={`size-2.5 rounded-full ${color}`} />{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
