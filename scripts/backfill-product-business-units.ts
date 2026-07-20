/**
 * ONE-TIME backfill: assign a BusinessUnit to every product that has none.
 *
 * Product.businessUnitId is required for NEW products, but existing rows predate
 * the column. This runs the same keyword inference the product form uses (name
 * first, then description; case-insensitive whole-word; most matched keywords
 * wins; genuine tie → no match) and:
 *   - assigns the inferred BU and sets autoAssignedBusinessUnit = true, OR
 *   - on NO match / a tie, assigns the fallback BU (Phaze Services / SERVICES),
 *     also autoAssignedBusinessUnit = true, and flags it in the report as
 *     "no confident match — review".
 *
 * It NEVER touches a product that already has a businessUnitId (a manual choice
 * always wins). Reports what was assigned PER PRODUCT rather than acting
 * silently, and prints a summary + an explicit "needs review" list.
 *
 * SAFETY: dry-run by default (prints the full plan, writes nothing). Pass
 * --confirm to apply. Keep the KEYWORD_RULES here in sync with the frontend
 * config web/app/lib/business-unit-rules.ts.
 *
 *   ts-node scripts/backfill-product-business-units.ts            # dry run
 *   ts-node scripts/backfill-product-business-units.ts --confirm  # execute
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CONFIRM = process.argv.includes('--confirm');

/** The BU assigned when inference finds no confident match. Flagged for review. */
const FALLBACK_CODE = 'SERVICES';

/**
 * Keyword → business-unit rules. MUST mirror the frontend config
 * (web/app/lib/business-unit-rules.ts). Codes match BusinessUnit.code.
 */
const KEYWORD_RULES: Array<{ businessUnitCode: string; keywords: string[] }> = [
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
 * Best BU code for a product, or null if none / a genuine tie. Counts matched
 * keywords per BU across name (checked first) then description; the BU with the
 * strictly-highest count wins. A tie for the top count → null (don't guess).
 */
function inferBusinessUnitCode(
  name: string,
  description: string | null,
): { code: string | null; tie: boolean } {
  const haystack = `${name} ${description ?? ''}`;
  const scored = KEYWORD_RULES.map((rule) => ({
    code: rule.businessUnitCode,
    count: rule.keywords.filter((k) => wholeWordMatch(haystack, k)).length,
  })).filter((s) => s.count > 0);

  if (scored.length === 0) return { code: null, tie: false };
  scored.sort((a, b) => b.count - a.count);
  if (scored.length > 1 && scored[0].count === scored[1].count) {
    return { code: null, tie: true };
  }
  return { code: scored[0].code, tie: false };
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? '(unset)';
  console.log(`Target database: ${dbUrl.replace(/\/\/([^:]+):[^@]*@/, '//$1:****@')}`);
  console.log(`Mode: ${CONFIRM ? 'EXECUTE (will write)' : 'DRY RUN (no changes)'}\n`);

  const bus = await prisma.businessUnit.findMany({
    select: { id: true, code: true, name: true },
  });
  const byCode = new Map(bus.map((b) => [b.code, b]));
  const fallback = byCode.get(FALLBACK_CODE);
  if (!fallback) {
    throw new Error(
      `Fallback business unit '${FALLBACK_CODE}' not found — run the seed first.`,
    );
  }

  // Only products without a BU. A product that already has one is a prior
  // (possibly manual) decision and is left untouched.
  const products = await prisma.product.findMany({
    where: { businessUnitId: null },
    select: { id: true, sku: true, name: true, description: true },
    orderBy: { sku: 'asc' },
  });

  if (products.length === 0) {
    console.log('No products need backfilling. ✅');
    return;
  }

  const plan: Array<{
    sku: string;
    name: string;
    assignedCode: string;
    assignedName: string;
    reason: 'inferred' | 'fallback-no-match' | 'fallback-tie';
  }> = [];

  for (const p of products) {
    const { code, tie } = inferBusinessUnitCode(p.name, p.description);
    if (code && byCode.has(code)) {
      const bu = byCode.get(code)!;
      plan.push({ sku: p.sku, name: p.name, assignedCode: bu.code, assignedName: bu.name, reason: 'inferred' });
    } else {
      plan.push({
        sku: p.sku,
        name: p.name,
        assignedCode: fallback.code,
        assignedName: fallback.name,
        reason: tie ? 'fallback-tie' : 'fallback-no-match',
      });
    }
  }

  // Per-product report.
  console.log(`Products to backfill: ${plan.length}\n`);
  console.table(
    plan.map((r) => ({
      SKU: r.sku,
      Product: r.name.length > 40 ? r.name.slice(0, 37) + '…' : r.name,
      'Assigned BU': r.assignedName,
      Reason: r.reason,
    })),
  );

  const inferred = plan.filter((r) => r.reason === 'inferred');
  const needsReview = plan.filter((r) => r.reason !== 'inferred');
  console.log(`\nSummary: ${inferred.length} inferred, ${needsReview.length} fell back to ${fallback.name} (review).`);
  if (needsReview.length) {
    console.log('\n⚠️  No confident match — review these:');
    for (const r of needsReview) console.log(`   - ${r.sku}  ${r.name}  (${r.reason})`);
  }

  if (!CONFIRM) {
    console.log('\nDRY RUN — nothing written. Re-run with --confirm to apply.');
    return;
  }

  // Apply: each product gets its BU + autoAssignedBusinessUnit = true so the
  // review filter + "auto-selected" indicator surface every backfilled row.
  let written = 0;
  for (const r of plan) {
    const bu = byCode.get(r.assignedCode)!;
    await prisma.product.update({
      where: { sku: r.sku },
      data: { businessUnitId: bu.id, autoAssignedBusinessUnit: true },
    });
    written += 1;
  }
  console.log(`\n✅ Backfilled ${written} product(s). All flagged autoAssignedBusinessUnit=true for review.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
