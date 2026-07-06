import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecodedAccessToken } from './jwt';
import type { Vertical } from './types';

// Mock the two collaborators the hook imports. apiFetch is the endpoint call
// under scrutiny; useAuth supplies the current user.
const apiFetch = vi.fn();
vi.mock('./api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

let mockUser: DecodedAccessToken | null = null;
vi.mock('./auth-context', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));

import { useIsHrStaff } from './use-is-hr-staff';

function vertical(code: string): Vertical {
  return {
    id: 'v-1',
    name: code,
    code,
    isActive: true,
    createdAt: '',
    updatedAt: '',
  };
}

function userWith(
  overrides: Partial<DecodedAccessToken>,
): DecodedAccessToken {
  return {
    sub: 'u-1',
    email: 'u@x.com',
    role: 'EMPLOYEE',
    verticalId: 'v-1',
    ...overrides,
  };
}

afterEach(() => {
  apiFetch.mockReset();
  mockUser = null;
});

describe('useIsHrStaff', () => {
  it('is true for a non-admin HR-vertical EMPLOYEE (the case the old /verticals bug broke)', async () => {
    mockUser = userWith({ role: 'EMPLOYEE' });
    apiFetch.mockResolvedValue(vertical('HR'));

    const { result } = renderHook(() => useIsHrStaff());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Must query the non-admin-safe endpoint, not the ADMIN-only list.
    expect(apiFetch).toHaveBeenCalledWith('/verticals/me');
    expect(result.current.isHrStaff).toBe(true);
  });

  it('is true for an HR-vertical MANAGER', async () => {
    mockUser = userWith({ role: 'MANAGER' });
    apiFetch.mockResolvedValue(vertical('HR'));

    const { result } = renderHook(() => useIsHrStaff());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isHrStaff).toBe(true);
  });

  it('is false for a non-HR-vertical employee (regression: no overcorrection)', async () => {
    mockUser = userWith({ role: 'EMPLOYEE' });
    apiFetch.mockResolvedValue(vertical('SALES'));

    const { result } = renderHook(() => useIsHrStaff());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isHrStaff).toBe(false);
  });

  it('is false for an ADMIN without querying any vertical endpoint', async () => {
    mockUser = userWith({ role: 'ADMIN', verticalId: null });

    const { result } = renderHook(() => useIsHrStaff());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isHrStaff).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('is false (not a crash) if the endpoint rejects', async () => {
    mockUser = userWith({ role: 'EMPLOYEE' });
    apiFetch.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useIsHrStaff());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isHrStaff).toBe(false);
  });
});
