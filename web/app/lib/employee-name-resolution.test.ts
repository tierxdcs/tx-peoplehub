import { describe, expect, it, vi } from 'vitest';
import {
  employeeNameOrFallback,
  resolveEmployeeNames,
  unresolvedEmployeeLabel,
} from './employee-name-resolution';

describe('employee name resolution', () => {
  it('renders the resolved employee name', async () => {
    const lookup = vi.fn().mockResolvedValue({
      firstName: 'Priya',
      lastName: 'Shah',
    });

    await expect(resolveEmployeeNames(['emp-1'], lookup)).resolves.toEqual({
      'emp-1': 'Priya Shah',
    });
  });

  it('renders an explicit fallback containing the raw ID when lookup fails', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('not found'));

    const names = await resolveEmployeeNames(['emp-missing'], lookup);

    expect(names['emp-missing']).toBe('Unknown employee (emp-missing)');
    expect(employeeNameOrFallback({}, 'emp-missing')).toBe(
      'Unknown employee (emp-missing)',
    );
  });

  it('falls back when a resolved record has no usable name and de-duplicates IDs', async () => {
    const lookup = vi.fn().mockResolvedValue({ firstName: '', lastName: '' });

    const names = await resolveEmployeeNames(['emp-2', 'emp-2'], lookup);

    expect(names['emp-2']).toBe(unresolvedEmployeeLabel('emp-2'));
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
