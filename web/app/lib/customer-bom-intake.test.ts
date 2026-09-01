import { describe, expect, it } from 'vitest';
import { intakeProgress } from './customer-bom-intake';

/**
 * The register's turnaround bar. Calendar-day maths on date-only strings, so a
 * promise for the 15th is neither late at noon on the 15th nor a day out for a
 * user whose clock sits on the other side of UTC midnight.
 */
describe('intakeProgress', () => {
  const raised = '2026-09-01T18:45:00.000Z';
  const promised = '2026-09-11T00:00:00.000Z';

  it('has nothing to show without a promised date', () => {
    expect(intakeProgress(raised, null, '2026-09-05')).toBeNull();
  });

  it('runs the window down day by day', () => {
    expect(intakeProgress(raised, promised, '2026-09-01')).toMatchObject({
      percent: 0,
      daysLeft: 10,
      overdue: false,
      label: '10 days left',
    });
    expect(intakeProgress(raised, promised, '2026-09-06')).toMatchObject({
      percent: 50,
      daysLeft: 5,
      label: '5 days left',
    });
    expect(intakeProgress(raised, promised, '2026-09-10')).toMatchObject({
      percent: 90,
      daysLeft: 1,
      label: '1 day left',
    });
  });

  it('calls the promised day itself due today, not overdue', () => {
    expect(intakeProgress(raised, promised, '2026-09-11')).toMatchObject({
      percent: 100,
      daysLeft: 0,
      overdue: false,
      label: 'due today',
    });
  });

  it('keeps counting past the date instead of capping the bar silently', () => {
    expect(intakeProgress(raised, promised, '2026-09-12')).toMatchObject({
      percent: 100,
      daysLeft: -1,
      overdue: true,
      label: 'overdue by 1 day',
    });
    expect(intakeProgress(raised, promised, '2026-09-25')).toMatchObject({
      daysLeft: -14,
      overdue: true,
      label: 'overdue by 14 days',
    });
  });

  it('treats a same-day or backdated promise as a window with nothing left', () => {
    expect(
      intakeProgress(raised, '2026-09-01T00:00:00.000Z', '2026-09-01'),
    ).toMatchObject({ percent: 100, daysLeft: 0, label: 'due today' });
    expect(
      intakeProgress(raised, '2026-08-30T00:00:00.000Z', '2026-09-01'),
    ).toMatchObject({ percent: 100, overdue: true, label: 'overdue by 2 days' });
  });
});
