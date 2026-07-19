import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * RFQ Builder (SCM) e2e. Verifies:
 *  - issuing with < 3 invitees is rejected
 *  - SEALED BIDS hold server-side: quote values are not retrievable via the API
 *    on an ISSUED (not-closed, deadline-future) RFQ
 *  - qualification status is snapshotted at invite time (unchanged if the
 *    partner's status later changes)
 *  - a vendor can save-and-resume, submit, and decline; non-responders appear
 *  - awarding the lowest quote needs no justification; awarding a non-lowest one
 *    is rejected without a justification
 *  - only an isProjectManager holder (or SA) can award
 *  - award pre-fills a DRAFT PO with the right partner + prices (never issued)
 *  - a kickoff shortfall generates a DRAFT RFQ linked to the kickoff
 */
describe('RFQ Builder (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  let superAdminToken: string;
  let superAdminId: string;
  let scmManagerToken: string;
  let scmEmployeeToken: string; // SCM but not manager — cannot manage
  let pmId: string;
  let pmToken: string; // Project Manager (award authority), SCM manager too

  let itemAId: string;
  let itemBId: string;
  const vendorIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const login = (email: string, password: string) =>
    http().post('/auth/login').send({ email, password }).expect(200)
      .then((r) => r.body.data.accessToken as string);

  async function mkVendor(name: string, status: string): Promise<string> {
    const v = await prisma.vendor.create({
      data: {
        companyName: name, registeredAddress: 'x', factoryAddress: 'x', yearEstablished: '2000',
        numberOfEmployees: '10', annualTurnover: '1cr', contactPersonName: 'x', contactPersonDesignation: 'x',
        contactEmail: `${name.replace(/\W/g, '')}@y.com`, contactPhone: '+910000000000',
        createdById: superAdminId, status: status as any,
      },
    });
    return v.id;
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

    const scm = await prisma.vertical.findUniqueOrThrow({ where: { code: 'SCM' } });
    const suffix = Date.now();
    const mk = async (firstName: string, role: string) => {
      const email = `rfq.${firstName.toLowerCase()}.${suffix}@peoplehub.local`;
      const res = await http().post('/employees').set('Authorization', `Bearer ${superAdminToken}`)
        .send({ firstName, lastName: 'Rfq', email, password: 'S3curePass!', role, verticalId: scm.id, reportingManagerId: superAdminId }).expect(201);
      return { id: res.body.data.id as string, email };
    };
    const mgr = await mk('Mgr', 'MANAGER');
    scmManagerToken = await login(mgr.email, 'S3curePass!');
    const emp = await mk('Emp', 'EMPLOYEE');
    scmEmployeeToken = await login(emp.email, 'S3curePass!');
    const pm = await mk('Pm', 'MANAGER');
    pmId = pm.id;
    await http().patch(`/employees/${pm.id}/designate-project-manager`).set('Authorization', `Bearer ${superAdminToken}`).expect(200);
    pmToken = await login(pm.email, 'S3curePass!');

    itemAId = (await prisma.item.create({ data: { itemCode: `RFQ-A-${suffix}`, name: 'Steel', itemType: 'RAW_MATERIAL', baseUnitOfMeasure: 'kg' } })).id;
    itemBId = (await prisma.item.create({ data: { itemCode: `RFQ-B-${suffix}`, name: 'Bolt', itemType: 'COMPONENT', baseUnitOfMeasure: 'pcs' } })).id;
    vendorIds.push(await mkVendor(`RfqV1 ${suffix}`, 'APPROVED'));
    vendorIds.push(await mkVendor(`RfqV2 ${suffix}`, 'APPROVED'));
    vendorIds.push(await mkVendor(`RfqV3 ${suffix}`, 'PENDING_QUESTIONNAIRE')); // unqualified
  });

  afterAll(async () => {
    await app.close();
  });

  /** Create a DRAFT RFQ with 2 lines, deadline in `hoursAhead`. */
  async function createRfq(hoursAhead = 48): Promise<any> {
    return (
      await http().post('/rfqs').set('Authorization', `Bearer ${scmManagerToken}`)
        .send({
          title: 'Test RFQ',
          submissionDeadline: new Date(Date.now() + hoursAhead * 3600 * 1000).toISOString(),
          lines: [
            { itemId: itemAId, quantity: 100 },
            { itemId: itemBId, quantity: 50 },
          ],
        }).expect(201)
    ).body.data;
  }

  async function addThreeInvitees(rfqId: string) {
    for (const vId of vendorIds) {
      await http().post(`/rfqs/${rfqId}/invitees`).set('Authorization', `Bearer ${scmManagerToken}`)
        .send({ vendorId: vId }).expect(201);
    }
  }

  it('rejects issuing with fewer than 3 invitees', async () => {
    const rfq = await createRfq();
    await http().post(`/rfqs/${rfq.id}/invitees`).set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ vendorId: vendorIds[0] }).expect(201);
    await http().post(`/rfqs/${rfq.id}/invitees`).set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ vendorId: vendorIds[1] }).expect(201);
    // 2 invitees → issue rejected.
    await http().post(`/rfqs/${rfq.id}/issue`).set('Authorization', `Bearer ${scmManagerToken}`).expect(400);
    // Add the third → now allowed.
    await http().post(`/rfqs/${rfq.id}/invitees`).set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ vendorId: vendorIds[2] }).expect(201);
    await http().post(`/rfqs/${rfq.id}/issue`).set('Authorization', `Bearer ${scmManagerToken}`).expect(201);
  });

  it('warns (not blocks) when inviting an unqualified vendor and snapshots its status', async () => {
    const rfq = await createRfq();
    const res = await http().post(`/rfqs/${rfq.id}/invitees`).set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ vendorId: vendorIds[2] }).expect(201); // PENDING_QUESTIONNAIRE
    expect(res.body.data.qualificationWarning).toMatch(/not qualified/i);
    const inv = res.body.data.rfq.invitees.find((i: any) => i.vendorId === vendorIds[2]);
    expect(inv.qualificationStatusSnapshot).toBe('PENDING_QUESTIONNAIRE');

    // Later, the vendor gets APPROVED — the snapshot must NOT change.
    await prisma.vendor.update({ where: { id: vendorIds[2] }, data: { status: 'APPROVED' } });
    const reread = (await http().get(`/rfqs/${rfq.id}`).set('Authorization', `Bearer ${scmManagerToken}`).expect(200)).body.data;
    const inv2 = reread.invitees.find((i: any) => i.vendorId === vendorIds[2]);
    expect(inv2.qualificationStatusSnapshot).toBe('PENDING_QUESTIONNAIRE');
    // restore
    await prisma.vendor.update({ where: { id: vendorIds[2] }, data: { status: 'PENDING_QUESTIONNAIRE' } });
  });

  it('SEALED BIDS: quote values are not retrievable server-side while ISSUED', async () => {
    const rfq = await createRfq();
    await addThreeInvitees(rfq.id);
    await http().post(`/rfqs/${rfq.id}/issue`).set('Authorization', `Bearer ${scmManagerToken}`).expect(201);
    const issued = (await http().get(`/rfqs/${rfq.id}`).set('Authorization', `Bearer ${scmManagerToken}`).expect(200)).body.data;
    const tokens = issued.invitees.map((i: any) => i.inviteToken);

    // A vendor submits a quote.
    await http().post(`/public/rfq-quote/${tokens[0]}/submit`).send({
      lines: [
        { rfqLineId: issued.lines[0].id, unitPrice: 10 },
        { rfqLineId: issued.lines[1].id, unitPrice: 5 },
      ],
    }).expect(201);

    // SCM manager tries to read the comparison before close → 400 (sealed).
    await http().get(`/rfqs/${rfq.id}/comparison`).set('Authorization', `Bearer ${scmManagerToken}`).expect(400);
    // And the detail endpoint carries NO quote figures at all.
    const detail = (await http().get(`/rfqs/${rfq.id}`).set('Authorization', `Bearer ${scmManagerToken}`).expect(200)).body.data;
    expect(JSON.stringify(detail)).not.toMatch(/totalQuotedValue|unitPrice/);
  });

  it('supports save-and-resume, decline, and shows non-responders in the comparison', async () => {
    const rfq = await createRfq();
    await addThreeInvitees(rfq.id);
    await http().post(`/rfqs/${rfq.id}/issue`).set('Authorization', `Bearer ${scmManagerToken}`).expect(201);
    const issued = (await http().get(`/rfqs/${rfq.id}`).set('Authorization', `Bearer ${scmManagerToken}`).expect(200)).body.data;
    const t = issued.invitees.map((i: any) => i.inviteToken);
    const [l0, l1] = issued.lines.map((l: any) => l.id);

    // Invitee 0: save partial, then submit full.
    const saved = (await http().post(`/public/rfq-quote/${t[0]}/save`).send({ lines: [{ rfqLineId: l0, unitPrice: 12 }] }).expect(201)).body.data;
    expect(saved.quote.lines).toHaveLength(1);
    await http().post(`/public/rfq-quote/${t[0]}/submit`).send({ lines: [{ rfqLineId: l0, unitPrice: 12 }, { rfqLineId: l1, unitPrice: 6 }], quotedLeadTimeDays: 14 }).expect(201);

    // Invitee 1: submit a cheaper quote.
    await http().post(`/public/rfq-quote/${t[1]}/submit`).send({ lines: [{ rfqLineId: l0, unitPrice: 9 }, { rfqLineId: l1, unitPrice: 5 }], quotedLeadTimeDays: 30 }).expect(201);

    // Invitee 2: decline.
    await http().post(`/public/rfq-quote/${t[2]}/decline`).send({ declineReason: 'Capacity full' }).expect(201);

    // A locked quote cannot be resubmitted.
    await http().post(`/public/rfq-quote/${t[0]}/submit`).send({ lines: [{ rfqLineId: l0, unitPrice: 1 }, { rfqLineId: l1, unitPrice: 1 }] }).expect(403);

    // Close, then comparison shows all three (2 responders + 1 non-responder/declined).
    await http().post(`/rfqs/${rfq.id}/close`).set('Authorization', `Bearer ${scmManagerToken}`).expect(201);
    const cmp = (await http().get(`/rfqs/${rfq.id}/comparison`).set('Authorization', `Bearer ${scmManagerToken}`).expect(200)).body.data;
    expect(cmp.columns).toHaveLength(3);
    const declined = cmp.columns.find((c: any) => c.quoteStatus === 'DECLINED');
    expect(declined.nonResponder).toBe(true);
    expect(declined.declineReason).toBe('Capacity full');
    // Lowest total is invitee 1 (9*100 + 5*50 = 1150) vs invitee 0 (12*100+6*50=1500).
    const lowest = cmp.columns.find((c: any) => c.isLowestTotal);
    expect(Number(lowest.totalQuotedValue)).toBe(1150);
    // Weighted score present for responders, null for the decliner.
    expect(declined.weightedScore).toBeNull();
    expect(cmp.columns.filter((c: any) => c.weightedScore !== null)).toHaveLength(2);
  });

  it('award: lowest needs no justification; non-lowest requires it; PM-gated; pre-fills a DRAFT PO', async () => {
    const rfq = await createRfq();
    await addThreeInvitees(rfq.id);
    await http().post(`/rfqs/${rfq.id}/issue`).set('Authorization', `Bearer ${scmManagerToken}`).expect(201);
    const issued = (await http().get(`/rfqs/${rfq.id}`).set('Authorization', `Bearer ${scmManagerToken}`).expect(200)).body.data;
    const t = issued.invitees.map((i: any) => i.inviteToken);
    const invId = issued.invitees.map((i: any) => i.id);
    const [l0, l1] = issued.lines.map((l: any) => l.id);

    // Two quotes: invitee0 = 1500 (higher), invitee1 = 1150 (lowest).
    await http().post(`/public/rfq-quote/${t[0]}/submit`).send({ lines: [{ rfqLineId: l0, unitPrice: 12 }, { rfqLineId: l1, unitPrice: 6 }] }).expect(201);
    await http().post(`/public/rfq-quote/${t[1]}/submit`).send({ lines: [{ rfqLineId: l0, unitPrice: 9 }, { rfqLineId: l1, unitPrice: 5 }] }).expect(201);
    await http().post(`/rfqs/${rfq.id}/close`).set('Authorization', `Bearer ${scmManagerToken}`).expect(201);

    // A non-PM (plain SCM manager) cannot award.
    await http().post(`/rfqs/${rfq.id}/award`).set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ inviteeId: invId[1] }).expect(403);

    // PM awarding the NON-lowest (invitee0) without justification → 400.
    await http().post(`/rfqs/${rfq.id}/award`).set('Authorization', `Bearer ${pmToken}`)
      .send({ inviteeId: invId[0] }).expect(400);

    // PM awarding the non-lowest WITH justification → ok.
    const awarded = (await http().post(`/rfqs/${rfq.id}/award`).set('Authorization', `Bearer ${pmToken}`)
      .send({ inviteeId: invId[0], justification: 'Better lead time and prior quality record' }).expect(201)).body.data;
    expect(awarded.rfq.status).toBe('AWARDED');
    expect(awarded.purchaseOrderId).toBeTruthy();

    // The PO is DRAFT, correct vendor, and priced from the awarded quote.
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: awarded.purchaseOrderId }, include: { lines: true } });
    expect(po.status).toBe('DRAFT');
    expect(po.vendorId).toBe(vendorIds[0]);
    const poLineA = po.lines.find((l) => l.itemId === itemAId)!;
    expect(Number(poLineA.unitPrice)).toBe(12); // invitee0's price
    expect(Number(poLineA.orderedQuantity)).toBe(100);
  });

  it('awarding the lowest quote requires NO justification', async () => {
    const rfq = await createRfq();
    await addThreeInvitees(rfq.id);
    await http().post(`/rfqs/${rfq.id}/issue`).set('Authorization', `Bearer ${scmManagerToken}`).expect(201);
    const issued = (await http().get(`/rfqs/${rfq.id}`).set('Authorization', `Bearer ${scmManagerToken}`).expect(200)).body.data;
    const t = issued.invitees.map((i: any) => i.inviteToken);
    const invId = issued.invitees.map((i: any) => i.id);
    const [l0, l1] = issued.lines.map((l: any) => l.id);
    await http().post(`/public/rfq-quote/${t[0]}/submit`).send({ lines: [{ rfqLineId: l0, unitPrice: 12 }, { rfqLineId: l1, unitPrice: 6 }] }).expect(201);
    await http().post(`/public/rfq-quote/${t[1]}/submit`).send({ lines: [{ rfqLineId: l0, unitPrice: 9 }, { rfqLineId: l1, unitPrice: 5 }] }).expect(201);
    await http().post(`/rfqs/${rfq.id}/close`).set('Authorization', `Bearer ${scmManagerToken}`).expect(201);
    // Award the LOWEST (invitee1) with no justification → ok.
    await http().post(`/rfqs/${rfq.id}/award`).set('Authorization', `Bearer ${pmToken}`)
      .send({ inviteeId: invId[1] }).expect(201);
  });

  it('generates a DRAFT RFQ from a kickoff shortfall, linked to the kickoff', async () => {
    const suffix = `${Date.now()}-${Math.floor(performance.now())}`;

    // A finished-good product + a shorted raw material (no stock → SHORTAGE).
    const fg = await prisma.item.create({ data: { itemCode: `RFQ-FG-${suffix}`, name: 'FG', itemType: 'FINISHED_GOOD', baseUnitOfMeasure: 'each' } });
    const product = await prisma.product.create({ data: { sku: `RFQ-SKU-${suffix}`, name: 'Prod', unitPrice: '1000', unitOfMeasure: 'each', itemId: fg.id } });
    const raw = await prisma.item.create({ data: { itemCode: `RFQ-RAW-${suffix}`, name: 'Scarce Raw', itemType: 'RAW_MATERIAL', baseUnitOfMeasure: 'kg' } });
    // Qualify the raw material (release hard-gate) via an approved supplier link.
    const sup = await prisma.supplier.create({ data: { companyName: `RFQ Sup ${suffix}`, registeredAddress: 'x', factoryAddress: 'x', yearEstablished: '2000', numberOfEmployees: '1', annualTurnover: '1', contactPersonName: 'x', contactPersonDesignation: 'x', contactEmail: `rfqsup${suffix.replace(/\W/g, '')}@y.com`, contactPhone: '+910000000000', createdById: superAdminId, status: 'APPROVED' } });
    await prisma.itemSupplier.create({ data: { itemId: raw.id, supplierId: sup.id, createdById: superAdminId } });

    // Release a BOM: FG needs 5kg of the shorted raw (no stock → shortage of 50).
    const bom = (await http().post('/boms').set('Authorization', `Bearer ${superAdminToken}`)
      .send({ itemId: fg.id, lines: [{ itemId: raw.id, quantityPerUnit: 5, unitOfMeasure: 'kg', wastagePercent: 0 }] }).expect(201)).body.data;
    await http().post(`/boms/${bom.id}/submit`).set('Authorization', `Bearer ${superAdminToken}`).expect(201);
    // SUPER_ADMIN cannot approve BOMs (needs a real R&D Head), so approve via DB.
    await prisma.bom.update({ where: { id: bom.id }, data: { status: 'RELEASED' } });

    const customer = await prisma.customer.create({ data: { name: `RFQ Cust ${suffix}`, billingAddress: { state: 'KA' }, ownerId: superAdminId } });
    const order = await prisma.order.create({ data: { orderNumber: `ORD-RFQ-${suffix}`, customerId: customer.id, status: 'CONFIRMED', totalAmount: '1', ownerId: superAdminId, lineItems: { create: [{ productId: product.id, quantity: '10', unitPrice: '1000', lineTotal: '10000' }] } } });
    await prisma.orderConfirmationSheet.create({ data: { orderId: order.id, confirmationNumber: `OC-RFQ-${suffix}`, revisionNumber: 1, status: 'EXECUTED', createdById: superAdminId, requirementsOverview: 'x', deliveryDate: new Date('2099-01-01'), deliveryLocation: 'BLR', deliveryType: 'FULL_TRUCKLOAD', warrantyTerms: '12m', paymentMilestones: '100%', packagingType: 'crate', protectiveMeasures: 'none', labelingRequirements: 'none', customerContactName: 'A', customerContactPhone: '+910000000000', customerContactEmail: 'a@b.com' } });
    const kickoff = (await http().post('/project-kickoffs').set('Authorization', `Bearer ${superAdminToken}`).send({ orderId: order.id, meetingDate: '2026-08-01T10:00:00.000Z' }).expect(201)).body.data;

    // Before a report exists → 400.
    await http().post(`/rfqs/from-kickoff/${kickoff.id}`).set('Authorization', `Bearer ${scmManagerToken}`).expect(400);

    // Give the raw material a stock record with insufficient on-hand (need 50,
    // have 5) so it classifies as SHORTAGE (not UNKNOWN, which is what a missing
    // balance row would produce).
    const store = await prisma.storeLocation.findFirstOrThrow({ where: { code: 'MAIN' } });
    await prisma.stockBalance.create({ data: { itemId: raw.id, storeLocationId: store.id, onHandQuantity: '5' } });

    // Generate the stock report (SUPER_ADMIN has BOM read).
    await http().post(`/project-kickoffs/${kickoff.id}/stock-availability/generate`).set('Authorization', `Bearer ${superAdminToken}`).expect(201);

    // Now the shortfall action creates a DRAFT RFQ linked to the kickoff.
    const rfq = (await http().post(`/rfqs/from-kickoff/${kickoff.id}`).set('Authorization', `Bearer ${scmManagerToken}`).expect(201)).body.data;
    expect(rfq.status).toBe('DRAFT');
    expect(rfq.projectKickoffId).toBe(kickoff.id);
    // The shorted raw material is a line; shortfall = gross 50 − available 5 = 45.
    const line = rfq.lines.find((l: any) => l.itemId === raw.id);
    expect(line).toBeTruthy();
    expect(Number(line.quantity)).toBe(45);
  });
});
