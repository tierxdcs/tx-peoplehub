'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { Vertical } from './types';

/**
 * Active verticals for a picker (via GET /verticals/options, readable by any
 * authenticated user) — used to tag a Kanban card with the department its work
 * belongs to. Distinct from the Admin/HR-gated full list.
 */
export function verticalOptions() {
  return apiFetch<Vertical[]>('/verticals/options');
}

/** Hook wrapper: loads the picker list once. */
export function useVerticalOptions(): { verticals: Vertical[]; loading: boolean } {
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    verticalOptions()
      .then((v) => {
        if (alive) setVerticals(v);
      })
      .catch(() => {
        if (alive) setVerticals([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { verticals, loading };
}
