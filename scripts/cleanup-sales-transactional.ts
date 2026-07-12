/**
 * PRODUCTION cleanup: wipe the Sales module's TRANSACTIONAL data while keeping
 * users/employees AND sales master/config data.
 *
 * DELETES (in FK-safe order):
 *   - order_confirmation_sheets
 *   - bid_assessment_responses, bid_decision_assessments
 *   - order_line_items, orders
 *   - bid_line_items, bids
 *   - opportunities, leads
 *   - sales_sequences  (resets OC/BID/ORD/LD numbering back to 0001)
 *
 * KEEPS (master/config + identity — untouched):
 *   - customers, customer_contacts
 *   - products
 *   - tax_configs
 *   - bid_assessment_questions
 *   - employees / everything outside the Sales module
 *
 * SAFETY: dry-run by default (prints counts, deletes nothing). Pass --confirm
 * to actually delete. Everything runs inside ONE transaction, so it's
 * all-or-nothing — a mid-run failure rolls the whole thing back.
 *
 * Run against the DB in your environment's DATABASE_URL:
 *   ts-node scripts/cleanup-sales-transactional.ts            # dry run
 *   ts-node scripts/cleanup-sales-transactional.ts --confirm  # execute
 *
 * For production, point DATABASE_URL at prod explicitly, e.g.:
 *   DATABASE_URL="postgresql://…prod…" ts-node scripts/cleanup-sales-transactional.ts --confirm
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CONFIRM = process.argv.includes('--confirm');

async function main() {
  // Redact credentials before logging which DB we're pointed at.
  const dbUrl = process.env.DATABASE_URL ?? '(unset)';
  const safeUrl = dbUrl.replace(/\/\/([^:]+):[^@]*@/, '//$1:****@');
  console.log(`Target database: ${safeUrl}`);
  console.log(`Mode: ${CONFIRM ? 'EXECUTE (will delete)' : 'DRY RUN (no changes)'}\n`);

  // Current row counts for the tables in scope.
  const counts = {
    order_confirmation_sheets: await prisma.orderConfirmationSheet.count(),
    bid_assessment_responses: await prisma.bidAssessmentResponse.count(),
    bid_decision_assessments: await prisma.bidDecisionAssessment.count(),
    order_line_items: await prisma.orderLineItem.count(),
    orders: await prisma.order.count(),
    bid_line_items: await prisma.bidLineItem.count(),
    bids: await prisma.bid.count(),
    opportunities: await prisma.opportunity.count(),
    leads: await prisma.lead.count(),
    sales_sequences: await prisma.salesSequence.count(),
  };

  console.log('Rows that will be deleted:');
  for (const [table, n] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(28)} ${n}`);
  }

  // Preserved tables — printed so it's explicit what is NOT touched.
  console.log('\nKept (NOT deleted):');
  console.log(`  customers                    ${await prisma.customer.count()}`);
  console.log(`  customer_contacts            ${await prisma.customerContact.count()}`);
  console.log(`  products                     ${await prisma.product.count()}`);
  console.log(`  tax_configs                  ${await prisma.taxConfig.count()}`);
  console.log(`  bid_assessment_questions     ${await prisma.bidAssessmentQuestion.count()}`);
  console.log(`  employees                    ${await prisma.employee.count()}`);

  if (!CONFIRM) {
    console.log('\nDry run — nothing deleted. Re-run with --confirm to execute.');
    return;
  }

  console.log('\nDeleting…');
  const result = await prisma.$transaction(async (tx) => {
    // Children first, then parents, respecting onDelete: Restrict FKs.
    // (bid_line_items / order_line_items / confirmation_sheets /
    // assessment_responses would cascade from their parents, but we delete
    // them explicitly so the reported counts are exact and the order is
    // self-documenting.)
    const ocs = await tx.orderConfirmationSheet.deleteMany({});
    const responses = await tx.bidAssessmentResponse.deleteMany({});
    const assessments = await tx.bidDecisionAssessment.deleteMany({});

    const orderLines = await tx.orderLineItem.deleteMany({});
    const orders = await tx.order.deleteMany({});

    const bidLines = await tx.bidLineItem.deleteMany({});
    const bids = await tx.bid.deleteMany({});

    // Break the Lead → Opportunity link (convertedToOpportunityId is SetNull,
    // but null it first so deleting opportunities can't be blocked) then delete
    // opportunities, then leads.
    await tx.lead.updateMany({ data: { convertedToOpportunityId: null } });
    const opportunities = await tx.opportunity.deleteMany({});
    const leads = await tx.lead.deleteMany({});

    // Reset the per-entity numbering counters so new records restart at 0001.
    const sequences = await tx.salesSequence.deleteMany({});

    return {
      order_confirmation_sheets: ocs.count,
      bid_assessment_responses: responses.count,
      bid_decision_assessments: assessments.count,
      order_line_items: orderLines.count,
      orders: orders.count,
      bid_line_items: bidLines.count,
      bids: bids.count,
      opportunities: opportunities.count,
      leads: leads.count,
      sales_sequences: sequences.count,
    };
  });

  console.log('\nDeleted:');
  for (const [table, n] of Object.entries(result)) {
    console.log(`  ${table.padEnd(28)} ${n}`);
  }
  console.log('\nDone. Sales transactional data cleared; master data + users kept.');
}

main()
  .catch((err) => {
    console.error('\nCleanup FAILED (transaction rolled back — no changes made):');
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
