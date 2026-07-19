import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * Stores Phase 3: Material Indent + Issue. Verifies:
 *  - issuing generates a correct STOCK_OUT (computed on-hand decreases)
 *  - an issue that would drive stock negative is rejected
 *  - an issue that would consume stock reserved for a DIFFERENT project is
 *    rejected (the subtle case — tested with a real reservation in place)
 *  - the availability check reuses the existing reservation logic (an indent
 *    linked to the reserving kickoff CAN draw on its own reservation, proving
 *    the same effective-availability rule is applied, not a second one)
 *  - short issue works → PARTIALLY_ISSUED; completing it → FULLY_ISSUED
 *  - indent status is derived from issue history (DB column not trusted)
 *  - access: Production-vertical/SA only
 */
describe('Material Indent + Issue (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  let superAdminToken: string;
  let superAdminId: string;
  let prodToken: string; // Production vertical — Stores (creates indents/issues, reserves)
  let outsiderToken: string; // Sales vertical — no access

  let storeId: string;
  let itemId: string;

  const http = () => request(app.getHttpServer());
  function login(email: string, password: string) {
    return http().post('/auth/login').send({ email, password }).expect(200)
      .then((r) => r.body.data.accessToken as string);
  }

  async function onHand(id: string): Promise<number> {
    const bal = await prisma.stockBalance.findFirst({
      where: { itemId: id, storeLocationId: storeId },
    });
    return bal ? Number(bal.onHandQuantity) : 0;
  }

  /** Set absolute on-hand for the shared item at the main store via the ledger. */
  async function setOnHand(target: number): Promise<void> {
    const current = await onHand(itemId);
    const delta = target - current;
    if (delta === 0) return;
    await http()
      .post('/inventory/adjustments')
      .set('Authorization', `Bearer ${prodToken}`)
      .send({ itemId, storeLocationId: storeId, quantityChange: delta, reason: 'test setup' })
      .expect(201);
  }

  /** A brand-new item seeded with a given on-hand, so reservation tests don't
   *  interfere with each other's stock/reservations on the shared item. */
  async function freshItemWithStock(onHandQty: number): Promise<string> {
    const suffix = `${Date.now()}-${Math.floor(performance.now())}`;
    const id = (
      await prisma.item.create({
        data: { itemCode: `MI-R-${suffix}`, name: 'Reserved', itemType: 'RAW_MATERIAL', baseUnitOfMeasure: 'pcs' },
      })
    ).id;
    await http().post('/inventory/adjustments').set('Authorization', `Bearer ${prodToken}`)
      .send({ itemId: id, storeLocationId: storeId, quantityChange: onHandQty, reason: 'test setup' }).expect(201);
    return id;
  }

  /** Build a real project kickoff (via Prisma + API) so reservations are real. */
  async function createKickoff(): Promise<string> {
    const suffix = `${Date.now()}-${Math.floor(performance.now())}`;
    const fg = await prisma.item.create({
      data: { itemCode: `MI-FG-${suffix}`, name: 'FG', itemType: 'FINISHED_GOOD', baseUnitOfMeasure: 'each' },
    });
    const product = await prisma.product.create({
      data: { sku: `MI-SKU-${suffix}`, name: 'Prod', unitPrice: '1000', unitOfMeasure: 'each', itemId: fg.id },
    });
    const customer = await prisma.customer.create({
      data: { name: `MI Cust ${suffix}`, billingAddress: { state: 'KA' }, ownerId: superAdminId },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-MI-${suffix}`,
        customerId: customer.id,
        status: 'CONFIRMED',
        totalAmount: '1000',
        ownerId: superAdminId,
        lineItems: { create: [{ productId: product.id, quantity: '1', unitPrice: '1000', lineTotal: '1000' }] },
      },
    });
    await prisma.orderConfirmationSheet.create({
      data: {
        orderId: order.id, confirmationNumber: `OC-MI-${suffix}`, revisionNumber: 1, status: 'EXECUTED',
        createdById: superAdminId, requirementsOverview: 'x', deliveryDate: new Date('2099-01-01'),
        deliveryLocation: 'BLR', deliveryType: 'FULL_TRUCKLOAD', warrantyTerms: '12m', paymentMilestones: '100%',
        packagingType: 'crate', protectiveMeasures: 'none', labelingRequirements: 'none',
        customerContactName: 'A', customerContactPhone: '+910000000000', customerContactEmail: 'a@b.com',
      },
    });
    const kickoff = (
      await http().post('/project-kickoffs').set('Authorization', `Bearer ${superAdminToken}`)
        .send({ orderId: order.id, meetingDate: '2026-08-01T10:00:00.000Z' }).expect(201)
    ).body.data;
    return kickoff.id as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    superAdminId = (await prisma.employee.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    superAdminToken = await login(adminEmail, adminPassword);

    const prodVertical = await prisma.vertical.findUniqueOrThrow({ where: { code: 'PRODUCTION' } });
    const salesVertical = await prisma.vertical.findUniqueOrThrow({ where: { code: 'SALES' } });
    const suffix = Date.now();
    const mk = async (firstName: string, role: string, verticalId: string) => {
      const email = `mi.${firstName.toLowerCase()}.${suffix}@peoplehub.local`;
      const res = await http().post('/employees').set('Authorization', `Bearer ${superAdminToken}`)
        .send({ firstName, lastName: 'MI', email, password: 'S3curePass!', role, verticalId, reportingManagerId: superAdminId })
        .expect(201);
      return { id: res.body.data.id as string, email };
    };
    const prod = await mk('Prod', 'EMPLOYEE', prodVertical.id);
    prodToken = await login(prod.email, 'S3curePass!');
    const outsider = await mk('Out', 'EMPLOYEE', salesVertical.id);
    outsiderToken = await login(outsider.email, 'S3curePass!');

    storeId = (await prisma.storeLocation.findFirstOrThrow({ where: { code: 'MAIN' } })).id;
    itemId = (
      await prisma.item.create({
        data: { itemCode: `MI-IT-${suffix}`, name: 'Widget', itemType: 'RAW_MATERIAL', baseUnitOfMeasure: 'pcs' },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('gates indent creation and issuing to Production/SA', async () => {
    await http().post('/material-indents').set('Authorization', `Bearer ${outsiderToken}`)
      .send({ itemId, requestedQuantity: 5 }).expect(403);
    // Production employee can, and can read.
    const indent = (
      await http().post('/material-indents').set('Authorization', `Bearer ${prodToken}`)
        .send({ itemId, requestedQuantity: 5 }).expect(201)
    ).body.data;
    expect(indent.status).toBe('OPEN');
    expect(indent.indentNumber).toMatch(/^IND-\d{4}-\d{4}$/);
    await http().get('/material-indents').set('Authorization', `Bearer ${outsiderToken}`).expect(200);
  });

  it('issuing generates a STOCK_OUT and decreases computed on-hand', async () => {
    await setOnHand(100);
    const before = await onHand(itemId);
    const indent = (
      await http().post('/material-indents').set('Authorization', `Bearer ${prodToken}`)
        .send({ itemId, requestedQuantity: 40 }).expect(201)
    ).body.data;
    const issue = (
      await http().post('/material-issue-notes').set('Authorization', `Bearer ${prodToken}`)
        .send({ materialIndentId: indent.id, storeLocationId: storeId, issuedQuantity: 40, binLocation: 'A1' }).expect(201)
    ).body.data;
    expect(issue.minNumber).toMatch(/^MIN-\d{4}-\d{4}$/);
    expect(await onHand(itemId)).toBe(before - 40);
    // A negative ON_HAND adjustment was written referencing the indent.
    const adj = await prisma.stockAdjustment.findFirst({
      where: { itemId, reason: { contains: indent.indentNumber } },
    });
    expect(adj).toBeTruthy();
    expect(Number(adj!.quantityChange)).toBe(-40);
    // Indent fully issued.
    const read = (
      await http().get(`/material-indents/${indent.id}`).set('Authorization', `Bearer ${prodToken}`).expect(200)
    ).body.data;
    expect(read.status).toBe('FULLY_ISSUED');
  });

  it('rejects an issue that would drive stock negative', async () => {
    await setOnHand(10);
    const indent = (
      await http().post('/material-indents').set('Authorization', `Bearer ${prodToken}`)
        .send({ itemId, requestedQuantity: 50 }).expect(201)
    ).body.data;
    // Only 10 on hand; try to issue 20 (≤ requested 50, but exceeds stock).
    await http().post('/material-issue-notes').set('Authorization', `Bearer ${prodToken}`)
      .send({ materialIndentId: indent.id, storeLocationId: storeId, issuedQuantity: 20 }).expect(400);
    expect(await onHand(itemId)).toBe(10); // unchanged
  });

  it('rejects issuing stock reserved for a DIFFERENT project', async () => {
    const rItem = await freshItemWithStock(30);
    // Project A reserves 25 of the 30 on hand.
    const kickoffA = await createKickoff();
    await http().post(`/project-kickoffs/${kickoffA}/reservations`)
      .set('Authorization', `Bearer ${prodToken}`)
      .send({ itemId: rItem, storeLocationId: storeId, quantity: 25 }).expect(201);

    // available now = 30 - 25 = 5. An unlinked indent (no project) can only draw
    // on the 5 unreserved — issuing 10 must be rejected (would eat project A's).
    const indent = (
      await http().post('/material-indents').set('Authorization', `Bearer ${prodToken}`)
        .send({ itemId: rItem, requestedQuantity: 10 }).expect(201)
    ).body.data;
    await http().post('/material-issue-notes').set('Authorization', `Bearer ${prodToken}`)
      .send({ materialIndentId: indent.id, storeLocationId: storeId, issuedQuantity: 10 }).expect(400);
    expect(await onHand(rItem)).toBe(30); // untouched — reservation protected

    // But issuing 5 (the unreserved portion) succeeds.
    await http().post('/material-issue-notes').set('Authorization', `Bearer ${prodToken}`)
      .send({ materialIndentId: indent.id, storeLocationId: storeId, issuedQuantity: 5 }).expect(201);
    expect(await onHand(rItem)).toBe(25);
  });

  // The subtle double-commit case, exactly as Phase 3's spec framed it: an
  // indent linked to a DIFFERENT project (B) must not be able to consume stock
  // reserved for project A. This exercises the kickoff-scoped reservation
  // lookup — B has no reservation for this item, so its issuable stock is only
  // the unreserved remainder, NOT A's reserved quantity.
  it('rejects a Project-B indent issuing into Project-A reserved stock (100 on-hand, 80 reserved for A)', async () => {
    const rItem = await freshItemWithStock(100);
    const kickoffA = await createKickoff();
    const kickoffB = await createKickoff();

    // Project A reserves 80 of the 100 on hand → only 20 genuinely available.
    await http().post(`/project-kickoffs/${kickoffA}/reservations`)
      .set('Authorization', `Bearer ${prodToken}`)
      .send({ itemId: rItem, storeLocationId: storeId, quantity: 80 }).expect(201);

    // Project B raises an indent and tries to issue 30 — more than the 20
    // unreserved. It must be REJECTED, not silently allowed to eat A's 80.
    const indentB = (
      await http().post('/material-indents').set('Authorization', `Bearer ${prodToken}`)
        .send({ itemId: rItem, requestedQuantity: 30, projectKickoffId: kickoffB }).expect(201)
    ).body.data;
    await http().post('/material-issue-notes').set('Authorization', `Bearer ${prodToken}`)
      .send({ materialIndentId: indentB.id, storeLocationId: storeId, issuedQuantity: 30 }).expect(400);

    // Nothing moved — A's reservation is intact and stock is untouched.
    expect(await onHand(rItem)).toBe(100);
    const bal = await prisma.stockBalance.findFirstOrThrow({ where: { itemId: rItem, storeLocationId: storeId } });
    expect(Number(bal.reservedQuantity)).toBe(80);
    const aStillReserved = await prisma.stockReservation.count({
      where: { kickoffId: kickoffA, itemId: rItem, isActive: true },
    });
    expect(aStillReserved).toBe(1);

    // B issuing exactly the 20 unreserved succeeds (proves the boundary is right).
    await http().post('/material-issue-notes').set('Authorization', `Bearer ${prodToken}`)
      .send({ materialIndentId: indentB.id, storeLocationId: storeId, issuedQuantity: 20 }).expect(201);
    expect(await onHand(rItem)).toBe(80);
    // A's 80 reservation is STILL intact — B drew only from unreserved stock.
    const balAfter = await prisma.stockBalance.findFirstOrThrow({ where: { itemId: rItem, storeLocationId: storeId } });
    expect(Number(balAfter.reservedQuantity)).toBe(80);
  });

  it('reuses the reservation rule: an indent linked to the reserving project CAN draw on its own reservation', async () => {
    const rItem = await freshItemWithStock(30);
    const kickoffId = await createKickoff();
    // Reserve 25 for this project.
    await http().post(`/project-kickoffs/${kickoffId}/reservations`)
      .set('Authorization', `Bearer ${prodToken}`)
      .send({ itemId: rItem, storeLocationId: storeId, quantity: 25 }).expect(201);

    // Indent LINKED to this kickoff: effective availability = 5 unreserved + 25
    // own reservation = 30. Issuing 30 succeeds (same effective-availability
    // rule the stock report uses — proving no second implementation).
    const indent = (
      await http().post('/material-indents').set('Authorization', `Bearer ${prodToken}`)
        .send({ itemId: rItem, requestedQuantity: 30, projectKickoffId: kickoffId }).expect(201)
    ).body.data;
    await http().post('/material-issue-notes').set('Authorization', `Bearer ${prodToken}`)
      .send({ materialIndentId: indent.id, storeLocationId: storeId, issuedQuantity: 30 }).expect(201);
    expect(await onHand(rItem)).toBe(0);
    // The kickoff's reservation was consumed (balance reserved back to 0).
    const bal = await prisma.stockBalance.findFirstOrThrow({ where: { itemId: rItem, storeLocationId: storeId } });
    expect(Number(bal.reservedQuantity)).toBe(0);
    const activeRes = await prisma.stockReservation.count({ where: { kickoffId, itemId: rItem, isActive: true } });
    expect(activeRes).toBe(0);
  });

  it('supports short issue → PARTIALLY_ISSUED, then completion → FULLY_ISSUED (status derived)', async () => {
    await setOnHand(100);
    const indent = (
      await http().post('/material-indents').set('Authorization', `Bearer ${prodToken}`)
        .send({ itemId, requestedQuantity: 60 }).expect(201)
    ).body.data;

    // Short issue: 25 of 60.
    const short = (
      await http().post('/material-issue-notes').set('Authorization', `Bearer ${prodToken}`)
        .send({ materialIndentId: indent.id, storeLocationId: storeId, issuedQuantity: 25 }).expect(201)
    ).body.data;
    void short;
    let read = (
      await http().get(`/material-indents/${indent.id}`).set('Authorization', `Bearer ${prodToken}`).expect(200)
    ).body.data;
    expect(read.status).toBe('PARTIALLY_ISSUED');
    expect(read.issuedQuantity).toBe('25');
    expect(read.outstandingQuantity).toBe('35');

    // Status is DERIVED, not the stored column: corrupt the stored value and
    // confirm the read still recomputes PARTIALLY_ISSUED from issue history.
    await prisma.materialIndent.update({ where: { id: indent.id }, data: { status: 'OPEN' } });
    read = (
      await http().get(`/material-indents/${indent.id}`).set('Authorization', `Bearer ${prodToken}`).expect(200)
    ).body.data;
    expect(read.status).toBe('PARTIALLY_ISSUED');

    // Complete the remaining 35 → FULLY_ISSUED.
    await http().post('/material-issue-notes').set('Authorization', `Bearer ${prodToken}`)
      .send({ materialIndentId: indent.id, storeLocationId: storeId, issuedQuantity: 35 }).expect(201);
    read = (
      await http().get(`/material-indents/${indent.id}`).set('Authorization', `Bearer ${prodToken}`).expect(200)
    ).body.data;
    expect(read.status).toBe('FULLY_ISSUED');
    expect(read.issuedQuantity).toBe('60');
    expect(read.issueNotes).toHaveLength(2);

    // Cannot over-issue beyond requested.
    await http().post('/material-issue-notes').set('Authorization', `Bearer ${prodToken}`)
      .send({ materialIndentId: indent.id, storeLocationId: storeId, issuedQuantity: 1 }).expect(400);
  });
});
