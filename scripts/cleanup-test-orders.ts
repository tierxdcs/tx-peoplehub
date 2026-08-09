/**
 * One-off cleanup of the "Test-NSP" and "Test 4" test records — full chain
 * (orders + their project kickoffs, PLM trackers and auto-provisioned Kanban
 * boards, then bids, opportunities, leads, and the customers themselves).
 *
 * SAFETY MODEL
 *  - Dry-run by default. Prints exactly what it would delete and stops.
 *    Pass `--execute` to actually delete (inside a single transaction).
 *  - Refuses to run if any target order/customer carries REAL finance/dispatch
 *    data (sales invoices, customer receipts, delivery challans, customer
 *    sign-offs, or logged PLM production updates). Those are not disposable
 *    test rows. Project kickoffs / PLM trackers / their Kanban boards ARE
 *    expected here (Test-NSP progressed into the project workflow) and are
 *    removed as part of the cleanup — approved explicitly.
 *  - Asserts each Kanban board it removes is referenced ONLY by the kickoffs /
 *    PLM trackers being deleted, so a board shared with another order is never
 *    touched.
 *
 * USAGE
 *   DATABASE_URL='postgresql://…prod…' npx ts-node \
 *     --compiler-options '{"module":"commonjs"}' scripts/cleanup-test-orders.ts
 *   # add --execute to perform the deletion after reviewing the dry-run.
 */
import { PrismaClient } from '@prisma/client';

const CUSTOMER_NAMES = ['Test-NSP', 'Test 4'];
const EXECUTE = process.argv.includes('--execute');

const prisma = new PrismaClient();

async function main() {
  const customers = await prisma.customer.findMany({
    where: { name: { in: CUSTOMER_NAMES } },
    select: { id: true, name: true },
  });

  if (customers.length === 0) {
    console.log('No customers named', CUSTOMER_NAMES, '— nothing to do.');
    return;
  }
  const customerIds = customers.map((c) => c.id);
  console.log('Target customers:');
  for (const c of customers) console.log(`  - ${c.name}  (${c.id})`);

  // Bids for these customers, and the orders reachable via customer OR via bid.
  const bids = await prisma.bid.findMany({
    where: { customerId: { in: customerIds } },
    select: { id: true, bidNumber: true, opportunityId: true },
  });
  const bidIds = bids.map((b) => b.id);
  const oppIdsFromBids = bids.map((b) => b.opportunityId);

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { customerId: { in: customerIds } },
        ...(bidIds.length ? [{ bidId: { in: bidIds } }] : []),
      ],
    },
    select: { id: true, orderNumber: true },
  });
  const orderIds = orders.map((o) => o.id);

  const opportunities = await prisma.opportunity.findMany({
    where: {
      OR: [
        { customerId: { in: customerIds } },
        ...(oppIdsFromBids.length ? [{ id: { in: oppIdsFromBids } }] : []),
      ],
    },
    select: { id: true, name: true },
  });
  const oppIds = opportunities.map((o) => o.id);

  const leads = await prisma.lead.findMany({
    where: oppIds.length
      ? { convertedToOpportunityId: { in: oppIds } }
      : { id: { in: [] } },
    select: { id: true, leadNumber: true },
  });

  // Project workflow attached to these orders (approved for deletion).
  const kickoffs = orderIds.length
    ? await prisma.projectKickoff.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true, projectName: true, kanbanBoardId: true },
      })
    : [];
  const kickoffIds = kickoffs.map((k) => k.id);

  const plmTrackers = orderIds.length
    ? await prisma.plmTracker.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true, currentStage: true, productionBoardId: true },
      })
    : [];
  const plmTrackerIds = plmTrackers.map((t) => t.id);

  const boardIds = [
    ...new Set(
      [
        ...kickoffs.map((k) => k.kanbanBoardId),
        ...plmTrackers
          .map((t) => t.productionBoardId)
          .filter((x): x is string => !!x),
      ].filter(Boolean),
    ),
  ];

  // ---- Heavy-data guard: real finance/dispatch artifacts ------------------
  const [
    salesInvoices,
    customerReceipts,
    deliveryChallans,
    signoffs,
    productionUpdates,
  ] = await Promise.all([
    prisma.salesInvoice.count({
      where: {
        OR: [
          { customerId: { in: customerIds } },
          ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
        ],
      },
    }),
    prisma.customerReceipt.count({ where: { customerId: { in: customerIds } } }),
    prisma.deliveryChallan.count({
      where: {
        OR: [
          { customerId: { in: customerIds } },
          ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
        ],
      },
    }),
    orderIds.length
      ? prisma.orderCustomerSignoff.count({
          where: { orderId: { in: orderIds } },
        })
      : Promise.resolve(0),
    plmTrackerIds.length
      ? prisma.plmProductionUpdate.count({
          where: { trackerId: { in: plmTrackerIds } },
        })
      : Promise.resolve(0),
  ]);

  console.log('\nWould delete:');
  console.log(`  orders          : ${orders.length}  [${orders.map((o) => o.orderNumber).join(', ')}]`);
  console.log(`  project kickoffs: ${kickoffs.length}  [${kickoffs.map((k) => k.projectName).join(', ')}]`);
  console.log(`  plm trackers    : ${plmTrackers.length}  [stages: ${plmTrackers.map((t) => t.currentStage).join(', ')}]`);
  console.log(`  kanban boards   : ${boardIds.length}  [${boardIds.join(', ')}]`);
  console.log(`  bids            : ${bids.length}  [${bids.map((b) => b.bidNumber).join(', ')}]`);
  console.log(`  opportunities   : ${opportunities.length}`);
  console.log(`  leads           : ${leads.length}  [${leads.map((l) => l.leadNumber).join(', ')}]`);
  console.log(`  customers       : ${customers.length}`);

  console.log('\nHeavy-data guard (must all be 0 to proceed):');
  console.log(`  sales invoices     : ${salesInvoices}`);
  console.log(`  customer receipts  : ${customerReceipts}`);
  console.log(`  delivery challans  : ${deliveryChallans}`);
  console.log(`  customer signoffs  : ${signoffs}`);
  console.log(`  plm prod. updates  : ${productionUpdates}`);

  const heavy =
    salesInvoices +
    customerReceipts +
    deliveryChallans +
    signoffs +
    productionUpdates;
  if (heavy > 0) {
    console.error(
      '\nABORT: these records carry real finance/dispatch/production data — not clean test data.\n' +
        'Review the artifacts above manually before any deletion.',
    );
    process.exitCode = 1;
    return;
  }

  // ---- Board-sharing guard: only remove boards owned solely by our targets -
  for (const bId of boardIds) {
    const [kRefs, pRefs] = await Promise.all([
      prisma.projectKickoff.count({ where: { kanbanBoardId: bId } }),
      prisma.plmTracker.count({ where: { productionBoardId: bId } }),
    ]);
    const kOutside = await prisma.projectKickoff.count({
      where: { kanbanBoardId: bId, id: { notIn: kickoffIds } },
    });
    const pOutside = await prisma.plmTracker.count({
      where: { productionBoardId: bId, id: { notIn: plmTrackerIds } },
    });
    if (kOutside > 0 || pOutside > 0) {
      console.error(
        `\nABORT: Kanban board ${bId} is shared with other records ` +
          `(kickoffs=${kRefs}, plmTrackers=${pRefs}; outside-target kickoffs=${kOutside}, plmTrackers=${pOutside}). ` +
          'Refusing to delete a shared board.',
      );
      process.exitCode = 1;
      return;
    }
  }

  if (!EXECUTE) {
    console.log('\nDRY RUN — no changes made. Re-run with --execute to delete.');
    return;
  }

  // ---- Delete bottom-up in one transaction --------------------------------
  await prisma.$transaction(async (tx) => {
    // 1. PLM trackers first — their kickoffId is Restrict. Cascades: events,
    //    vendor-update invites, production updates, notifications; production
    //    cards' plmTrackerId is SetNull.
    if (plmTrackerIds.length) {
      await tx.plmTracker.deleteMany({ where: { id: { in: plmTrackerIds } } });
    }
    // 2. Kickoffs next — their kanbanBoardId is Restrict, and the order's
    //    kickoff FK is Restrict too. Cascades: attendees, milestones, action
    //    items (kanbanCardId SetNull), risks, stock reservations, stock report.
    if (kickoffIds.length) {
      await tx.projectKickoff.deleteMany({ where: { id: { in: kickoffIds } } });
    }
    // 3. Kanban boards — now unreferenced. Cascades: members, lists→cards
    //    (comments/activity/attachments/labels/notifications), sprints, labels.
    if (boardIds.length) {
      await tx.kanbanBoard.deleteMany({ where: { id: { in: boardIds } } });
    }
    // 4. Orders — cascades line items, confirmation sheets, billing
    //    milestones, progress invites, customer signoff.
    if (orderIds.length) {
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    // 5. Bids — cascades bid line items, AMC charges.
    if (bidIds.length) {
      await tx.bid.deleteMany({ where: { id: { in: bidIds } } });
    }
    // 6. Opportunities — cascades bid decision assessments + responses.
    if (oppIds.length) {
      await tx.opportunity.deleteMany({ where: { id: { in: oppIds } } });
    }
    // 7. Leads.
    if (leads.length) {
      await tx.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } });
    }
    // 8. Customers — cascades customer contacts.
    await tx.customer.deleteMany({ where: { id: { in: customerIds } } });
  });

  console.log('\n✅ Deleted the Test-NSP / Test 4 chain successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
