// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useIsMobile } from './use-is-mobile';

describe('useIsMobile', () => {
  let listener: (() => void) | undefined;
  let matches = false;

  beforeEach(() => {
    listener = undefined;
    matches = false;
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => ({
        get matches() {
          return matches;
        },
        media: '(max-width: 767px)',
        addEventListener: (_event: string, next: () => void) => {
          listener = next;
        },
        removeEventListener: vi.fn(),
      })),
    );
  });

  it('switches the renderer when the viewport crosses the mobile breakpoint', () => {
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      matches = true;
      listener?.();
    });
    expect(result.current).toBe(true);

    act(() => {
      matches = false;
      listener?.();
    });
    expect(result.current).toBe(false);
  });
});
