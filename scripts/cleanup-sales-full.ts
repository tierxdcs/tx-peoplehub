/**
 * PRODUCTION cleanup: wipe the ENTIRE Sales order-to-cash chain AND its
 * downstream finance/GL + fulfilment records, to start the pipeline fresh.
 * Keeps users, customers, products, config, procurement/AP, and inventory
 * masters.
 *
 * This is a DEEPER wipe than cleanup-sales-transactional.ts — it also removes
 * the records that block deleting an Order:
 *   Project Kickoffs, Sales Invoices, Delivery Challans, Customer Receipts,
 *   Receipt Allocations, sales-side Finance Adjustment (credit/debit) Notes,
 *   sales-side Bank-Transaction Matches, and the GL Journal Entries those
 *   sales invoices/receipts/notes posted.
 *
 * DELETES (leaves-first, one transaction):
 *   bank_transaction_matches (sales-linked only), receipt_allocations,
 *   customer_receipts, finance_adjustment_notes (sales-side only),
 *   delivery_challans (+lines), sales_invoices (+lines, gst_submissions),
 *   journal_entries (ONLY those from sales invoices/receipts/sales notes),
 *   project_kickoffs (+ all children), orders (+lines, confirmation sheets,
 *   billing milestones), bids (+lines), bid_decision_assessments (+responses),
 *   opportunities, leads (+attachments), sales_sequences.
 *
 * KEEPS (untouched): employees, customers, products, tax_configs,
 *   bid_assessment_questions, Item Master, BOMs, business units, Vault files,
 *   Kanban boards/cards, chart of accounts, accounting periods, AND all
 *   procurement/AP finance (vendor invoices, payments, RFQs, POs, GRNs) and
 *   fixed-asset/schedule/bank JEs.
 *
 * ── CROSS-CUTTING FILTERS (why this is safe for non-sales finance) ──
 *   - journal_entries, finance_adjustment_notes and bank_transaction_matches
 *     are SHARED with AP/vendor + other modules. We only ever delete rows that
 *     are reachable from a SALES invoice/receipt/note. AP rows are never touched.
 *
 * ── KNOWN SIDE EFFECTS (flagged, not auto-repaired) ──
 *   - Inventory: dispatch STOCK_OUT rows + decremented stock balances have no
 *     FK to the dispatch, so they are NOT reversed — inventory ledger will be
 *     stale after this wipe. Reconcile inventory separately if needed.
 *   - Kickoff stock reservations cascade away without decrementing reserved
 *     quantities on stock balances.
 *   - Kanban boards auto-provisioned for kickoffs are left orphaned (not deleted).
 *   - Closed/soft-closed accounting periods: deleting posted sales JEs in a
 *     CLOSED period makes that period's trial balance / close packs stale. The
 *     dry run REPORTS any such entries so you can decide before executing.
 *
 * SAFETY: dry-run by default (prints counts + closed-period warnings, deletes
 * nothing). Pass --confirm to execute. Everything runs in ONE transaction —
 * a mid-run failure rolls the whole thing back (no partial wipe).
 *
 *   ts-node scripts/cleanup-sales-full.ts            # dry run
 *   ts-node scripts/cleanup-sales-full.ts --confirm  # execute
 *
 * For production, point DATABASE_URL at prod explicitly:
 *   DATABASE_URL="postgresql://…prod…" ts-node scripts/cleanup-sales-full.ts --confirm
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CONFIRM = process.argv.includes('--confirm');

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? '(unset)';
  console.log(
    `Target database: ${dbUrl.replace(/\/\/([^:]+):[^@]*@/, '//$1:****@')}`,
  );
  console.log(
    `Mode: ${CONFIRM ? 'EXECUTE (will delete)' : 'DRY RUN (no changes)'}\n`,
  );

  // ── Identify the sales-reachable rows in the SHARED finance tables. We
  // resolve these ids up front so both the report and the delete use the exact
  // same, sales-only set (never the AP/other-module rows). ──

  // Journal entries posted by sales invoices, customer receipts, or sales-side
  // adjustment notes — the only JEs we may delete.
  const salesInvoiceJEs = await prisma.salesInvoice.findMany({
    where: { journalEntryId: { not: null } },
    select: { journalEntryId: true },
  });
  const receiptJEs = await prisma.customerReceipt.findMany({
    where: { journalEntryId: { not: null } },
    select: { journalEntryId: true },
  });
  const salesNoteRows = await prisma.financeAdjustmentNote.findMany({
    where: { salesInvoiceId: { not: null } },
    select: { id: true, journalEntryId: true },
  });
  const salesJournalIds = [
    ...salesInvoiceJEs.map((r) => r.journalEntryId!),
    ...receiptJEs.map((r) => r.journalEntryId!),
    ...salesNoteRows.map((r) => r.journalEntryId).filter((x): x is string => !!x),
  ];
  const uniqueSalesJournalIds = Array.from(new Set(salesJournalIds));
  const salesNoteIds = salesNoteRows.map((r) => r.id);

  // Bank-reconciliation matches tied to a customer receipt (sales side only).
  const salesBankMatches = await prisma.bankTransactionMatch.findMany({
    where: { customerReceiptId: { not: null } },
    select: { id: true },
  });
  const salesBankMatchIds = salesBankMatches.map((r) => r.id);

  // Closed/soft-closed period warning: any sales JE not in an OPEN period.
  const closedPeriodJEs = uniqueSalesJournalIds.length
    ? await prisma.journalEntry.count({
        where: {
          id: { in: uniqueSalesJournalIds },
          period: { status: { in: ['CLOSED', 'SOFT_CLOSED'] } },
        },
      })
    : 0;

  const counts = {
    'bank_transaction_matches (sales)': salesBankMatchIds.length,
    receipt_allocations: await prisma.receiptAllocation.count(),
    customer_receipts: await prisma.customerReceipt.count(),
    'finance_adjustment_notes (sales)': salesNoteIds.length,
    delivery_challans: await prisma.deliveryChallan.count(),
    sales_invoices: await prisma.salesInvoice.count(),
    'journal_entries (sales-posted)': uniqueSalesJournalIds.length,
    project_kickoffs: await prisma.projectKickoff.count(),
    orders: await prisma.order.count(),
    bids: await prisma.bid.count(),
    bid_decision_assessments: await prisma.bidDecisionAssessment.count(),
    opportunities: await prisma.opportunity.count(),
    leads: await prisma.lead.count(),
    sales_sequences: await prisma.salesSequence.count(),
  };

  console.log('Rows that will be deleted:');
  for (const [t, n] of Object.entries(counts)) {
    console.log(`  ${t.padEnd(34)} ${n}`);
  }

  console.log('\nKept (NOT deleted):');
  console.log(`  employees                          ${await prisma.employee.count()}`);
  console.log(`  customers                          ${await prisma.customer.count()}`);
  console.log(`  products                           ${await prisma.product.count()}`);
  console.log(`  vendor/AP invoices                 ${await prisma.accountsPayableInvoice.count()}`);
  console.log(`  purchase_orders                    ${await prisma.purchaseOrder.count()}`);

  if (closedPeriodJEs > 0) {
    console.log(
      `\n⚠️  WARNING: ${closedPeriodJEs} sales journal entr(y/ies) are in a CLOSED / SOFT_CLOSED accounting period.`,
    );
    console.log(
      '   Deleting them will make that period’s trial balance / close packs stale.',
    );
    console.log('   Review before executing.');
  }
  console.log(
    '\nℹ️  Inventory ledger (dispatch stock-out rows / balances) is NOT reversed by this wipe — reconcile separately if needed.',
  );

  if (!CONFIRM) {
    console.log('\nDry run — nothing deleted. Re-run with --confirm to execute.');
    return;
  }

  console.log('\nDeleting…');
  const result = await prisma.$transaction(async (tx) => {
    // 1. Bank matches (sales-linked) — Restrict-block CustomerReceipt.
    const bankMatches = await tx.bankTransactionMatch.deleteMany({
      where: { id: { in: salesBankMatchIds } },
    });
    // 2. Receipt allocations (Restrict→SalesInvoice), then customer receipts.
    const allocations = await tx.receiptAllocation.deleteMany({});
    const receipts = await tx.customerReceipt.deleteMany({});
    // 3. Sales-side adjustment notes (Restrict→SalesInvoice). AP-side kept.
    const notes = await tx.financeAdjustmentNote.deleteMany({
      where: { id: { in: salesNoteIds } },
    });
    // 4. Delivery challans (cascades lines → releases the Restrict pin on order
    //    lines; SetNulls SalesInvoice.linkedInvoiceId).
    const challans = await tx.deliveryChallan.deleteMany({});
    // 5. Sales invoices (cascades lines + gst_submissions). Now free of
    //    allocation/note Restrict children.
    const invoices = await tx.salesInvoice.deleteMany({});
    // 6. Sales-posted GL journal entries ONLY (cascades journal_lines). Clear
    //    any reversal entries first so a reversal can't Restrict-pin its
    //    original. AP/asset/schedule/bank JEs are never in this id set.
    let journalCount = 0;
    if (uniqueSalesJournalIds.length) {
      await tx.journalEntry.deleteMany({
        where: { reversalOfId: { in: uniqueSalesJournalIds } },
      });
      const jes = await tx.journalEntry.deleteMany({
        where: { id: { in: uniqueSalesJournalIds } },
      });
      journalCount = jes.count;
    }
    // 7. Project kickoffs (cascades attendees/milestones/action-items/risks/
    //    reservations/stock-report; SetNulls MaterialIndent/Rfq — procurement
    //    survives). Unblocks Order.
    const kickoffs = await tx.projectKickoff.deleteMany({});
    // 8. Orders (cascades order lines, confirmation sheets, billing milestones).
    const orders = await tx.order.deleteMany({});
    // 9. Bids (cascades bid lines).
    const bids = await tx.bid.deleteMany({});
    // 10. Bid assessments (cascades responses), then opportunities.
    const assessments = await tx.bidDecisionAssessment.deleteMany({});
    // Null the Lead→Opportunity pointer before removing opportunities.
    await tx.lead.updateMany({ data: { convertedToOpportunityId: null } });
    const opportunities = await tx.opportunity.deleteMany({});
    // 11. Leads (cascades lead_attachments; Vault files survive).
    const leads = await tx.lead.deleteMany({});
    // 12. Reset numbering so new records restart at 0001.
    const sequences = await tx.salesSequence.deleteMany({});

    return {
      bank_transaction_matches: bankMatches.count,
      receipt_allocations: allocations.count,
      customer_receipts: receipts.count,
      finance_adjustment_notes: notes.count,
      delivery_challans: challans.count,
      sales_invoices: invoices.count,
      journal_entries: journalCount,
      project_kickoffs: kickoffs.count,
      orders: orders.count,
      bids: bids.count,
      bid_decision_assessments: assessments.count,
      opportunities: opportunities.count,
      leads: leads.count,
      sales_sequences: sequences.count,
    };
  });

  console.log('\nDeleted:');
  for (const [t, n] of Object.entries(result)) {
    console.log(`  ${t.padEnd(34)} ${n}`);
  }
  console.log(
    '\nDone. Sales pipeline + downstream finance cleared; users, masters, and procurement/AP kept.',
  );
}

main()
  .catch((err) => {
    console.error('\nCleanup FAILED (transaction rolled back — no changes made):');
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
