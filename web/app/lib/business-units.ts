'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { BusinessUnit } from './types';

/** Active business units for a picker (any authenticated user). */
export function businessUnitOptions() {
  return apiFetch<BusinessUnit[]>('/business-units/options');
}

/** All business units incl. inactive — for the SUPER_ADMIN management screen. */
export function listBusinessUnits() {
  return apiFetch<BusinessUnit[]>('/business-units');
}

export function createBusinessUnit(input: {
  name: string;
  code: string;
  description?: string;
  displayOrder?: number;
  colorHex?: string;
}) {
  return apiFetch<BusinessUnit>('/business-units', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateBusinessUnit(
  id: string,
  input: {
    name?: string;
    description?: string | null;
    isActive?: boolean;
    displayOrder?: number;
    colorHex?: string;
  },
) {
  return apiFetch<BusinessUnit>(`/business-units/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** Hook wrapper: loads the active picker list once. */
export function useBusinessUnitOptions(): {
  businessUnits: BusinessUnit[];
  loading: boolean;
} {
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    businessUnitOptions()
      .then((b) => {
        if (alive) setBusinessUnits(b);
      })
      .catch(() => {
        if (alive) setBusinessUnits([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { businessUnits, loading };
}
