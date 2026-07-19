import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * Logistics & Dispatch e2e. Verifies the whole outbound flow and its integrations:
 *  - dispatch seeds a DRAFT invoice (never ISSUED, no journal entry)
 *  - a logistics (non-finance) user can dispatch; the draft appears in Finance/AR
 *  - STOCK_OUT is generated; finished-goods on-hand decreases
 *  - place-of-supply + HSN seeded onto the draft invoice
 *  - QC gate blocks dispatch until final QC cleared (and only a QC inspector clears)
 *  - partial dispatch across multiple DCs; "previously dispatched" + fulfilment status
 *  - each DC produces its OWN draft invoice (not one per order)
 *  - over-dispatch warns without blocking
 *  - OTD report computes on-time vs late
 */
describe('Logistics & Dispatch (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  let superAdminToken: string;
  let superAdminId: string;
  let prodToken: string; // Production vertical — logistics (non-finance)
  let qcToken: string; // Production Manager + isQcInspector
  let salesToken: string; // non-production — cannot dispatch

  let storeId: string;

  const http = () => request(app.getHttpServer());
  const login = (email: string, password: string) =>
    http().post('/auth/login').send({ email, password }).expect(200)
      .then((r) => r.body.data.accessToken as string);

  async function onHand(itemId: string): Promise<number> {
    const bal = await prisma.stockBalance.findFirst({
      where: { itemId, storeLocationId: storeId },
    });
    return bal ? Number(bal.onHandQuantity) : 0;
  }

  /** Seed an order with N line items, each product bridged to a stocked Item. */
  async function seedOrder(
    lines: { qty: number; unitPrice: number; onHand: number }[],
  ): Promise<{ orderId: string; customerId: string; lineIds: string[]; itemIds: string[] }> {
    const suffix = `${Date.now()}-${Math.floor(performance.now())}`;
    const customer = await prisma.customer.create({
      data: { name: `Disp Cust ${suffix}`, billingAddress: { state: 'KA' }, gstin: '29ABCDE1234F1Z5', ownerId: superAdminId },
    });
    const itemIds: string[] = [];
    const lineData: any[] = [];
    for (let i = 0; i < lines.length; i++) {
      const item = await prisma.item.create({
        data: { itemCode: `DISP-${suffix}-${i}`, name: `FG ${i}`, itemType: 'FINISHED_GOOD', baseUnitOfMeasure: 'NOS' },
      });
      itemIds.push(item.id);
      const product = await prisma.product.create({
        data: { sku: `DISP-SKU-${suffix}-${i}`, name: `Widget ${i}`, unitPrice: String(lines[i].unitPrice), unitOfMeasure: 'NOS', hsnCode: `8479${i}`, itemId: item.id },
      });
      lineData.push({ productId: product.id, quantity: String(lines[i].qty), unitPrice: String(lines[i].unitPrice), lineTotal: String(lines[i].qty * lines[i].unitPrice) });
      // Seed on-hand via the ledger directly.
      const bal = await prisma.stockBalance.upsert({
        where: { itemId_storeLocationId: { itemId: item.id, storeLocationId: storeId } },
        create: { itemId: item.id, storeLocationId: storeId, onHandQuantity: String(lines[i].onHand) },
        update: { onHandQuantity: String(lines[i].onHand) },
      });
      void bal;
    }
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-DISP-${suffix}`, customerId: customer.id, status: 'CONFIRMED',
        totalAmount: '1000', ownerId: superAdminId, lineItems: { create: lineData },
      },
      include: { lineItems: true },
    });
    return {
      orderId: order.id,
      customerId: customer.id,
      lineIds: order.lineItems.map((l) => l.id),
      itemIds,
    };
  }

  function clearQc(orderId: string, token = qcToken): request.Test {
    return http()
      .post(`/logistics/delivery-challans/orders/${orderId}/clear-final-qc`)
      .set('Authorization', `Bearer ${token}`) as request.Test;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    superAdminId = (await prisma.employee.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    superAdminToken = await login(adminEmail, adminPassword);

    const prodVertical = await prisma.vertical.findUniqueOrThrow({ where: { code: 'PRODUCTION' } });
    const salesVertical = await prisma.vertical.findUniqueOrThrow({ where: { code: 'SALES' } });
    const suffix = Date.now();
    const mk = async (firstName: string, role: string, verticalId: string) => {
      const email = `disp.${firstName.toLowerCase()}.${suffix}@peoplehub.local`;
      const res = await http().post('/employees').set('Authorization', `Bearer ${superAdminToken}`)
        .send({ firstName, lastName: 'Disp', email, password: 'S3curePass!', role, verticalId, reportingManagerId: superAdminId }).expect(201);
      return { id: res.body.data.id as string, email };
    };
    const prod = await mk('Prod', 'EMPLOYEE', prodVertical.id);
    prodToken = await login(prod.email, 'S3curePass!');
    const qc = await mk('Qc', 'MANAGER', prodVertical.id);
    await http().patch(`/employees/${qc.id}/designate-qc-inspector`).set('Authorization', `Bearer ${superAdminToken}`).expect(200);
    qcToken = await login(qc.email, 'S3curePass!');
    const sales = await mk('Sales', 'EMPLOYEE', salesVertical.id);
    salesToken = await login(sales.email, 'S3curePass!');

    storeId = (await prisma.storeLocation.findFirstOrThrow({ where: { code: 'MAIN' } })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks dispatch until final QC is cleared, and only a QC inspector can clear it', async () => {
    const o = await seedOrder([{ qty: 10, unitPrice: 100, onHand: 100 }]);
    const dc = (
      await http().post('/logistics/delivery-challans').set('Authorization', `Bearer ${prodToken}`)
        .send({ orderId: o.orderId, consigneeName: 'ACME', consigneeAddress: 'Blr', consigneeStateCode: '29', transportMode: 'ROAD',
          lines: [{ orderLineId: o.lineIds[0], quantity: 10 }] }).expect(201)
    ).body.data;
    expect(dc.status).toBe('DRAFT');

    // Dispatch blocked — QC not cleared.
    await http().post(`/logistics/delivery-challans/${dc.id}/dispatch`).set('Authorization', `Bearer ${prodToken}`).expect(400);

    // A non-QC production user cannot clear QC.
    await clearQc(o.orderId, prodToken).expect(403);
    // The QC inspector can.
    await clearQc(o.orderId).expect(201);
    // Now dispatch succeeds.
    await http().post(`/logistics/delivery-challans/${dc.id}/dispatch`).set('Authorization', `Bearer ${prodToken}`).expect(201);
  });

  it('a logistics (non-finance) user dispatches; a DRAFT invoice is created (never ISSUED, no journal), STOCK_OUT generated, place-of-supply + HSN seeded', async () => {
    const o = await seedOrder([{ qty: 4, unitPrice: 250, onHand: 50 }]);
    await clearQc(o.orderId).expect(201);
    const before = await onHand(o.itemIds[0]);

    const dc = (
      await http().post('/logistics/delivery-challans').set('Authorization', `Bearer ${prodToken}`)
        .send({ orderId: o.orderId, consigneeName: 'ACME', consigneeAddress: 'Blr', consigneeStateCode: '27', transportMode: 'ROAD',
          lines: [{ orderLineId: o.lineIds[0], quantity: 4 }] }).expect(201)
    ).body.data;

    const dispatched = (
      await http().post(`/logistics/delivery-challans/${dc.id}/dispatch`).set('Authorization', `Bearer ${prodToken}`).expect(201)
    ).body.data;
    expect(dispatched.status).toBe('DISPATCHED');
    expect(dispatched.linkedInvoiceId).toBeTruthy();
    expect(dispatched.linkedInvoiceStatus).toBe('DRAFT');

    // STOCK_OUT: on-hand dropped by 4.
    expect(await onHand(o.itemIds[0])).toBe(before - 4);
    const adj = await prisma.stockAdjustment.findFirst({ where: { itemId: o.itemIds[0], reason: { contains: dc.dcNumber } } });
    expect(adj).toBeTruthy();
    expect(Number(adj!.quantityChange)).toBe(-4);

    // The invoice is genuinely DRAFT with no journal entry, and carries seeded fields.
    const inv = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: dispatched.linkedInvoiceId }, include: { lines: true } });
    expect(inv.status).toBe('DRAFT');
    expect(inv.journalEntryId).toBeNull();
    expect(inv.placeOfSupplyStateCode).toBe('27');
    expect(inv.lines[0].hsnSacCode).toBe('84790'); // seeded from product.hsnCode

    // It appears in Finance/AR for a finance user (the super admin).
    const arList = (
      await http().get('/finance/ar/invoices').set('Authorization', `Bearer ${superAdminToken}`).expect(200)
    ).body.data;
    expect(arList.items.some((i: any) => i.id === inv.id)).toBe(true);
  });

  it('gates dispatch to Production/SA — a Sales user cannot create a DC', async () => {
    const o = await seedOrder([{ qty: 1, unitPrice: 10, onHand: 10 }]);
    await http().post('/logistics/delivery-challans').set('Authorization', `Bearer ${salesToken}`)
      .send({ orderId: o.orderId, consigneeName: 'x', consigneeAddress: 'x', consigneeStateCode: '29', transportMode: 'ROAD',
        lines: [{ orderLineId: o.lineIds[0], quantity: 1 }] }).expect(403);
    // But sales CAN read the register (company-wide read).
    await http().get('/logistics/delivery-challans').set('Authorization', `Bearer ${salesToken}`).expect(200);
  });

  it('supports partial dispatch across multiple DCs with correct previously-dispatched + derived fulfilment status; each DC gets its own draft invoice', async () => {
    const o = await seedOrder([{ qty: 10, unitPrice: 100, onHand: 100 }]);
    await clearQc(o.orderId).expect(201);

    // DC #1 — dispatch 6 of 10.
    const dc1 = (
      await http().post('/logistics/delivery-challans').set('Authorization', `Bearer ${prodToken}`)
        .send({ orderId: o.orderId, consigneeName: 'ACME', consigneeAddress: 'Blr', consigneeStateCode: '29', transportMode: 'ROAD',
          lines: [{ orderLineId: o.lineIds[0], quantity: 6 }] }).expect(201)
    ).body.data;
    const disp1 = (await http().post(`/logistics/delivery-challans/${dc1.id}/dispatch`).set('Authorization', `Bearer ${prodToken}`).expect(201)).body.data;

    // Order now PARTIALLY_DISPATCHED.
    let order = await prisma.order.findUniqueOrThrow({ where: { id: o.orderId } });
    expect(order.fulfilmentStatus).toBe('PARTIALLY_DISPATCHED');

    // DC #2 — the form should now show previouslyDispatched = 6 for this order line.
    const dc2 = (
      await http().post('/logistics/delivery-challans').set('Authorization', `Bearer ${prodToken}`)
        .send({ orderId: o.orderId, consigneeName: 'ACME', consigneeAddress: 'Blr', consigneeStateCode: '29', transportMode: 'ROAD',
          lines: [{ orderLineId: o.lineIds[0], quantity: 4 }] }).expect(201)
    ).body.data;
    expect(dc2.lines[0].previouslyDispatched).toBe('6');
    expect(dc2.lines[0].orderedQuantity).toBe('10');
    const disp2 = (await http().post(`/logistics/delivery-challans/${dc2.id}/dispatch`).set('Authorization', `Bearer ${prodToken}`).expect(201)).body.data;

    // Each DC has its OWN distinct draft invoice.
    expect(disp1.linkedInvoiceId).toBeTruthy();
    expect(disp2.linkedInvoiceId).toBeTruthy();
    expect(disp1.linkedInvoiceId).not.toBe(disp2.linkedInvoiceId);

    // Cumulative 10 of 10 → FULLY_DISPATCHED.
    order = await prisma.order.findUniqueOrThrow({ where: { id: o.orderId } });
    expect(order.fulfilmentStatus).toBe('FULLY_DISPATCHED');
  });

  it('warns on over-dispatch without blocking', async () => {
    const o = await seedOrder([{ qty: 5, unitPrice: 100, onHand: 100 }]);
    await clearQc(o.orderId).expect(201);
    // Dispatch 8 against an ordered 5 — allowed, but warned.
    const dc = (
      await http().post('/logistics/delivery-challans').set('Authorization', `Bearer ${prodToken}`)
        .send({ orderId: o.orderId, consigneeName: 'ACME', consigneeAddress: 'Blr', consigneeStateCode: '29', transportMode: 'ROAD',
          lines: [{ orderLineId: o.lineIds[0], quantity: 8 }] }).expect(201)
    ).body.data;
    const disp = (await http().post(`/logistics/delivery-challans/${dc.id}/dispatch`).set('Authorization', `Bearer ${prodToken}`).expect(201)).body.data;
    expect(disp.status).toBe('DISPATCHED'); // not blocked
    expect(disp.overDispatchWarnings.length).toBeGreaterThanOrEqual(1);
    expect(disp.overDispatchWarnings[0].message).toMatch(/over-dispatch/i);
  });

  it('computes the OTD report (on-time and late cases)', async () => {
    // On-time: promised in the future relative to actual.
    const o1 = await seedOrder([{ qty: 2, unitPrice: 100, onHand: 100 }]);
    await clearQc(o1.orderId).expect(201);
    const dcA = (
      await http().post('/logistics/delivery-challans').set('Authorization', `Bearer ${prodToken}`)
        .send({ orderId: o1.orderId, consigneeName: 'A', consigneeAddress: 'x', consigneeStateCode: '29', transportMode: 'ROAD',
          promisedDeliveryDate: '2026-06-10T00:00:00.000Z', lines: [{ orderLineId: o1.lineIds[0], quantity: 2 }] }).expect(201)
    ).body.data;
    await http().post(`/logistics/delivery-challans/${dcA.id}/dispatch`).set('Authorization', `Bearer ${prodToken}`).expect(201);
    // Deliver on time (before promised) via POD confirm — but POD needs storage;
    // set the actual date directly so OTD math is exercised without R2.
    await prisma.deliveryChallan.update({ where: { id: dcA.id }, data: { status: 'DELIVERED', actualDeliveryDate: new Date('2026-06-08T00:00:00.000Z') } });

    // Late: actual after promised.
    const o2 = await seedOrder([{ qty: 2, unitPrice: 100, onHand: 100 }]);
    await clearQc(o2.orderId).expect(201);
    const dcB = (
      await http().post('/logistics/delivery-challans').set('Authorization', `Bearer ${prodToken}`)
        .send({ orderId: o2.orderId, consigneeName: 'B', consigneeAddress: 'x', consigneeStateCode: '29', transportMode: 'ROAD',
          promisedDeliveryDate: '2026-06-10T00:00:00.000Z', lines: [{ orderLineId: o2.lineIds[0], quantity: 2 }] }).expect(201)
    ).body.data;
    await http().post(`/logistics/delivery-challans/${dcB.id}/dispatch`).set('Authorization', `Bearer ${prodToken}`).expect(201);
    await prisma.deliveryChallan.update({ where: { id: dcB.id }, data: { status: 'DELIVERED', actualDeliveryDate: new Date('2026-06-15T00:00:00.000Z') } });

    const otd = (
      await http().get('/logistics/otd?from=2026-06-01T00:00:00.000Z&to=2026-06-30T00:00:00.000Z')
        .set('Authorization', `Bearer ${prodToken}`).expect(200)
    ).body.data;
    expect(otd.summary.totalDelivered).toBeGreaterThanOrEqual(2);
    expect(otd.summary.onTime).toBeGreaterThanOrEqual(1);
    expect(otd.summary.late).toBeGreaterThanOrEqual(1);
    // The late one was 5 days late.
    const lateRow = otd.dispatches.find((d: any) => d.dcNumber === dcB.dcNumber);
    expect(lateRow.onTime).toBe(false);
    expect(lateRow.delayDays).toBe(5);
    const onTimeRow = otd.dispatches.find((d: any) => d.dcNumber === dcA.dcNumber);
    expect(onTimeRow.onTime).toBe(true);
  });
});
