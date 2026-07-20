/**
 * Keyword → business-unit inference rules for the product form's auto-select.
 * A plain data array so the whole rule set is a one-file edit as the product
 * range grows. Codes match BusinessUnit.code (see the seed).
 *
 * NOTE: keep this in sync with the backfill script
 * scripts/backfill-product-business-units.ts, which mirrors these rules to
 * classify existing products.
 *
 * You'll want to review these keywords against your actual product naming.
 */
export interface BusinessUnitRule {
  businessUnitCode: string;
  keywords: string[];
}

export const BUSINESS_UNIT_RULES: BusinessUnitRule[] = [
  {
    businessUnitCode: 'INFRA',
    keywords: ['rack', 'cabinet', 'enclosure', 'busway', 'busbar', 'pdu', 'containment', 'frame'],
  },
  {
    businessUnitCode: 'EDGE',
    keywords: ['edge', 'micro', 'micro-dc', 'microdatacenter', 'edge-dc'],
  },
  {
    businessUnitCode: 'HYPERSCALE',
    keywords: ['hyperscale', 'ocp', 'orv', 'openrack', 'open-rack', 'scale-out'],
  },
  {
    businessUnitCode: 'MOD',
    keywords: ['modular', 'module', 'containerised', 'containerized', 'prefab', 'prefabricated', 'skid'],
  },
  {
    businessUnitCode: 'INTELLIGENCE',
    keywords: ['monitoring', 'dcim', 'software', 'sensor', 'analytics', 'intelligent', 'telemetry', 'bms'],
  },
  {
    businessUnitCode: 'SERVICES',
    keywords: ['service', 'installation', 'commissioning', 'maintenance', 'amc', 'support', 'consulting'],
  },
];

/** Case-insensitive whole-word match of `keyword` anywhere in `text`. */
function wholeWordMatch(text: string, keyword: string): boolean {
  const esc = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}\\b`, 'i').test(text);
}

/**
 * Infer the best business-unit code from a product's name (checked first) and
 * description. Returns the code with the strictly-highest matched-keyword count.
 * Returns null when nothing matches OR the top count is a genuine tie — the
 * caller then leaves the field unset rather than guessing (spec §3).
 */
export function inferBusinessUnitCode(
  name: string,
  description?: string | null,
): string | null {
  const haystack = `${name} ${description ?? ''}`;
  const scored = BUSINESS_UNIT_RULES.map((rule) => ({
    code: rule.businessUnitCode,
    count: rule.keywords.filter((k) => wholeWordMatch(haystack, k)).length,
  })).filter((s) => s.count > 0);

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.count - a.count);
  // Genuine tie for the top score → don't pick arbitrarily.
  if (scored.length > 1 && scored[0].count === scored[1].count) return null;
  return scored[0].code;
}
