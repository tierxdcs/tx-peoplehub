/**
 * One-off: remove the named TEST leads from the sales pipeline, plus the
 * opportunity/bids they spawned. Intended to be run in the Railway backend
 * service shell (the only place the prod DATABASE_URL resolves).
 *
 * SAFETY:
 *  - Matches leads by EXACT companyName in TEST_LEAD_NAMES only.
 *  - DRY RUN by default. Set CONFIRM=yes to actually delete.
 *  - ABORTS (deletes nothing) if any matched lead's chain has an Order —
 *    orders are real business records and out of scope here.
 *  - All deletes run in a single transaction (all-or-nothing).
 *
 * Run (dry run first):
 *   npx ts-node --skip-project --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node","esModuleInterop":true}' \
 *     scripts/cleanup-test-leads.ts
 * Then, to delete:
 *   CONFIRM=yes npx ts-node --skip-project --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node","esModuleInterop":true}' \
 *     scripts/cleanup-test-leads.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Exact company names of the leads to remove (from the Lead Register screenshot).
const TEST_LEAD_NAMES = ['Test-NSP', 'Test 4', 'Test 3'];

async function main() {
  const confirm = process.env.CONFIRM === 'yes';

  const leads = await prisma.lead.findMany({
    where: { companyName: { in: TEST_LEAD_NAMES } },
    include: {
      attachments: { select: { id: true } },
      convertedToOpportunity: {
        include: {
          bids: {
            include: {
              orders: { select: { id: true, orderNumber: true, status: true } },
              _count: { select: { lineItems: true, amcCharges: true } },
            },
          },
          bidAssessments: { select: { id: true } },
        },
      },
    },
    orderBy: { leadNumber: 'asc' },
  });

  console.log(
    `\nMatched ${leads.length} lead(s) by exact name ${JSON.stringify(TEST_LEAD_NAMES)}:\n`,
  );

  const leadIds: string[] = [];
  const oppIds: string[] = [];
  const bidIds: string[] = [];
  const blockingOrders: string[] = [];

  for (const l of leads) {
    leadIds.push(l.id);
    const opp = l.convertedToOpportunity;
    const bids = opp?.bids ?? [];
    const orders = bids.flatMap((b) => b.orders);
    if (opp) oppIds.push(opp.id);
    for (const b of bids) {
      bidIds.push(b.id);
      for (const o of b.orders) blockingOrders.push(o.orderNumber);
    }
    console.log(
      `  ${l.leadNumber} | "${l.companyName}" | status=${l.status} | ` +
        `attachments=${l.attachments.length} | ` +
        `opportunity=${opp ? opp.id.slice(0, 8) + ` (${opp.stage})` : '—'} | ` +
        `bids=${bids.length} | assessments=${opp?.bidAssessments.length ?? 0} | ` +
        `orders=${orders.length}` +
        (orders.length
          ? ` [${orders.map((o) => `${o.orderNumber}/${o.status}`).join(', ')}]`
          : ''),
    );
  }

  if (leads.length === 0) {
    console.log('\nNothing to do — no leads matched. (Nothing deleted.)');
    return;
  }

  if (blockingOrders.length > 0) {
    console.error(
      `\n✋ ABORT: matched leads have ${blockingOrders.length} order(s) in their chain ` +
        `(${blockingOrders.join(', ')}). Orders are real records and out of scope. ` +
        `Nothing deleted — resolve these manually and re-run.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nPlan: delete ${bidIds.length} bid(s) → ${oppIds.length} opportunity(ies) ` +
      `→ ${leadIds.length} lead(s) (attachments + assessments cascade).`,
  );

  if (!confirm) {
    console.log(
      '\nDRY RUN — nothing was deleted. Re-run with CONFIRM=yes to apply.',
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Bids first (Opportunity→Bid is onDelete: Restrict). Bid delete cascades
    // its line items + AMC charges.
    if (bidIds.length)
      await tx.bid.deleteMany({ where: { id: { in: bidIds } } });
    // Opportunities next (cascades BidDecisionAssessment + responses; the
    // lead's convertedToOpportunityId FK is auto-nulled via onDelete: SetNull).
    if (oppIds.length)
      await tx.opportunity.deleteMany({ where: { id: { in: oppIds } } });
    // Leads last (cascades LeadAttachment; underlying VaultFiles are left
    // intact by design — onDelete: Restrict on the file side).
    await tx.lead.deleteMany({ where: { id: { in: leadIds } } });
  });

  console.log(
    `\n✅ Deleted ${leadIds.length} lead(s), ${oppIds.length} opportunity(ies), ` +
      `${bidIds.length} bid(s).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
