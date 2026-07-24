import { describe, expect, it } from 'vitest';
import {
  BUSINESS_UNIT_RULES,
  inferBusinessUnitCode,
  orderProductsForOpportunity,
} from './business-unit-rules';

describe('inferBusinessUnitCode', () => {
  it('matches a single clear keyword (name)', () => {
    expect(inferBusinessUnitCode('42U Server Rack')).toBe('INFRA');
    expect(inferBusinessUnitCode('Hyperscale OCP node')).toBe('HYPERSCALE');
    expect(inferBusinessUnitCode('Edge Micro-DC 6kW')).toBe('EDGE');
  });

  it('is case-insensitive', () => {
    expect(inferBusinessUnitCode('MODULAR data hall')).toBe('MOD');
  });

  it('checks the description too', () => {
    expect(
      inferBusinessUnitCode('Unit A', 'DCIM monitoring appliance'),
    ).toBe('INTELLIGENCE');
  });

  it('whole-word only — a substring inside another word does not match', () => {
    // "services" would match SERVICES, but "serviceable" should not.
    expect(inferBusinessUnitCode('Serviceable widget')).toBeNull();
  });

  it('picks the BU with the most matched keywords', () => {
    // Two INFRA keywords (rack, cabinet) vs one EDGE (edge) → INFRA wins.
    expect(inferBusinessUnitCode('Edge rack cabinet')).toBe('INFRA');
  });

  it('returns null on a genuine tie rather than guessing', () => {
    // One INFRA keyword (rack) and one EDGE keyword (edge) → 1-1 tie → null.
    expect(inferBusinessUnitCode('edge rack')).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(inferBusinessUnitCode('Generic Thing XYZ')).toBeNull();
  });
});

describe('orderProductsForOpportunity', () => {
  const products = BUSINESS_UNIT_RULES.map((rule) => ({
    id: `product-${rule.businessUnitCode}`,
    businessUnitId: rule.businessUnitCode,
  }));

  it.each(BUSINESS_UNIT_RULES.map((rule) => rule.businessUnitCode))(
    'keeps products from every BU selectable for a %s opportunity',
    (opportunityBusinessUnitId) => {
      const ordered = orderProductsForOpportunity(
        products,
        opportunityBusinessUnitId,
      );

      expect(ordered).toHaveLength(products.length);
      expect(ordered.map((product) => product.businessUnitId).sort()).toEqual(
        products.map((product) => product.businessUnitId).sort(),
      );
      expect(ordered[0].businessUnitId).toBe(opportunityBusinessUnitId);
    },
  );
});
