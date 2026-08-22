export const EFFICIENCY_WINDOW_DAYS = 30;
export const PING_SLA_HOURS = 24;

export type EfficiencyComponent = {
  percentage: number | null;
  onTime: number;
  total: number;
};

export function percentage(onTime: number, total: number): number | null {
  return total === 0 ? null : Math.round((onTime / total) * 100);
}

export function pingSla(
  rows: Array<{ createdAt: Date; respondedAt: Date | null; status: string }>,
): EfficiencyComponent {
  const limitMs = PING_SLA_HOURS * 60 * 60 * 1000;
  const onTime = rows.filter(
    (row) =>
      row.status !== 'PENDING' &&
      row.respondedAt !== null &&
      row.respondedAt.getTime() - row.createdAt.getTime() <= limitMs,
  ).length;
  return { percentage: percentage(onTime, rows.length), onTime, total: rows.length };
}

/** Due dates are calendar-day commitments, so completion anytime that day passes. */
export function taskSla(
  rows: Array<{ dueDate: Date; completedAt: Date | null }>,
): EfficiencyComponent {
  const onTime = rows.filter((row) => {
    if (!row.completedAt) return false;
    const due = row.dueDate;
    const endOfDueDay = Date.UTC(
      due.getUTCFullYear(),
      due.getUTCMonth(),
      due.getUTCDate() + 1,
    );
    return row.completedAt.getTime() < endOfDueDay;
  }).length;
  return { percentage: percentage(onTime, rows.length), onTime, total: rows.length };
}

export function combinedEfficiency(
  ping: EfficiencyComponent,
  task: EfficiencyComponent,
): number | null {
  if (ping.percentage === null || task.percentage === null) return null;
  return Math.round((ping.percentage + task.percentage) / 2);
}
