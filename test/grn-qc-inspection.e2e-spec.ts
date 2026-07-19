import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * Stores Phase 2: GRN + QC Inspection Gate + NCR. Verifies the defining rule —
 * receiving goods produces ZERO stock movement, and ONLY QC-accepted quantity
 * ever enters stock. Also covers: partial acceptance spawns both a STOCK_IN and
 * an NCR, "previously received" across multiple GRNs, PO status auto-derivation,
 * the isQcInspector designation end-to-end (including that a non-inspector
 * cannot finalize), and NCR disposition access.
 */
describe('GRN + QC Inspection Gate (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  let superAdminToken: string;
  let superAdminId: string;
  let scmManagerToken: string; // creates POs
  let prodEmployeeToken: string; // Production vertical — receives goods
  let qcManagerId: string;
  let qcManagerToken: string; // Production Manager, will be designated QC inspector
  let outsiderToken: string; // non-production, non-QC

  let approvedSupplierId: string;
  let itemAId: string;
  let itemBId: string;
  let storeId: string;

  const http = () => request(app.getHttpServer());
  function login(email: string, password: string) {
    return http()
      .post('/auth/login')
      .send({ email, password })
      .expect(200)
      .then((r) => r.body.data.accessToken as string);
  }

  /** On-hand for an item at the main store, or '0' if no balance row exists. */
  async function onHand(itemId: string): Promise<string> {
    const bal = await prisma.stockBalance.findFirst({
      where: { itemId, storeLocationId: storeId },
    });
    return bal ? bal.onHandQuantity.toString() : '0';
  }

  async function createIssuedPo(
    lines: { itemId: string; orderedQuantity: number; unitPrice: number }[],
  ): Promise<any> {
    const po = (
      await http()
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send({ supplierId: approvedSupplierId, lines })
        .expect(201)
    ).body.data;
    await http()
      .post(`/purchase-orders/${po.id}/issue`)
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .expect(201);
    return po;
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

    superAdminId = (
      await prisma.employee.findUniqueOrThrow({ where: { email: adminEmail } })
    ).id;
    superAdminToken = await login(adminEmail, adminPassword);

    const scmVertical = await prisma.vertical.findUniqueOrThrow({ where: { code: 'SCM' } });
    const prodVertical = await prisma.vertical.findUniqueOrThrow({ where: { code: 'PRODUCTION' } });
    const salesVertical = await prisma.vertical.findUniqueOrThrow({ where: { code: 'SALES' } });
    const suffix = Date.now();
    const mk = async (firstName: string, role: string, verticalId: string) => {
      const email = `grn.${firstName.toLowerCase()}.${suffix}@peoplehub.local`;
      const res = await http()
        .post('/employees')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          firstName,
          lastName: 'GRN',
          email,
          password: 'S3curePass!',
          role,
          verticalId,
          reportingManagerId: superAdminId,
        })
        .expect(201);
      return { id: res.body.data.id as string, email };
    };
    const scmMgr = await mk('Scm', 'MANAGER', scmVertical.id);
    scmManagerToken = await login(scmMgr.email, 'S3curePass!');
    const prodEmp = await mk('Prod', 'EMPLOYEE', prodVertical.id);
    prodEmployeeToken = await login(prodEmp.email, 'S3curePass!');
    const qcMgr = await mk('Qc', 'MANAGER', prodVertical.id);
    qcManagerId = qcMgr.id;
    qcManagerToken = await login(qcMgr.email, 'S3curePass!');
    const outsider = await mk('Out', 'EMPLOYEE', salesVertical.id);
    outsiderToken = await login(outsider.email, 'S3curePass!');

    const supplierBase = {
      registeredAddress: 'x', factoryAddress: 'x', yearEstablished: '2000',
      numberOfEmployees: '10', annualTurnover: '1cr', contactPersonName: 'x',
      contactPersonDesignation: 'x', contactEmail: 'x@y.com',
      contactPhone: '+910000000000', createdById: superAdminId,
    };
    approvedSupplierId = (
      await prisma.supplier.create({
        data: { ...supplierBase, companyName: `GrnSup ${suffix}`, status: 'APPROVED' },
      })
    ).id;

    itemAId = (
      await prisma.item.create({
        data: { itemCode: `GRN-A-${suffix}`, name: 'Steel', itemType: 'RAW_MATERIAL', baseUnitOfMeasure: 'kg' },
      })
    ).id;
    itemBId = (
      await prisma.item.create({
        data: { itemCode: `GRN-B-${suffix}`, name: 'Bolt', itemType: 'COMPONENT', baseUnitOfMeasure: 'pcs' },
      })
    ).id;
    storeId = (
      await prisma.storeLocation.findFirstOrThrow({ where: { code: 'MAIN' } })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('designates a QC Inspector via the API (backend + designation end-to-end)', async () => {
    // MANAGER-or-above requirement + multi-holder flag.
    const res = await http()
      .patch(`/employees/${qcManagerId}/designate-qc-inspector`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    expect(res.body.data.isQcInspector).toBe(true);
  });

  it('rejects designating a non-MANAGER as QC Inspector', async () => {
    const prod = await prisma.employee.findFirstOrThrow({
      where: { email: { startsWith: 'grn.prod.' } },
    });
    await http()
      .patch(`/employees/${prod.id}/designate-qc-inspector`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(400);
  });

  it('creates + submits a GRN with ZERO stock movement (the core rule)', async () => {
    const po = await createIssuedPo([{ itemId: itemAId, orderedQuantity: 100, unitPrice: 10 }]);
    const before = await onHand(itemAId);

    const year = new Date().getUTCFullYear();
    const grn = (
      await http()
        .post('/goods-receipt-notes')
        .set('Authorization', `Bearer ${prodEmployeeToken}`)
        .send({
          purchaseOrderId: po.id,
          lines: [
            { purchaseOrderLineId: po.lines[0].id, storeLocationId: storeId, receivedQuantity: 100 },
          ],
        })
        .expect(201)
    ).body.data;
    expect(grn.status).toBe('DRAFT');
    expect(grn.grnNumber).toMatch(new RegExp(`^GRN-${year}-\\d{4}$`));

    // Submit → PENDING_QC. Still no stock.
    const submitted = (
      await http()
        .post(`/goods-receipt-notes/${grn.id}/submit`)
        .set('Authorization', `Bearer ${prodEmployeeToken}`)
        .expect(201)
    ).body.data;
    expect(submitted.status).toBe('PENDING_QC');

    // On-hand genuinely unchanged, and no adjustment rows were written.
    expect(await onHand(itemAId)).toBe(before);
    const adjustments = await prisma.stockAdjustment.count({
      where: { itemId: itemAId, reason: { contains: grn.grnNumber } },
    });
    expect(adjustments).toBe(0);
  });

  it('finalizes QC full-pass: only accepted qty generates STOCK_IN', async () => {
    const po = await createIssuedPo([{ itemId: itemAId, orderedQuantity: 50, unitPrice: 10 }]);
    const before = Number(await onHand(itemAId));

    const grn = (
      await http()
        .post('/goods-receipt-notes')
        .set('Authorization', `Bearer ${prodEmployeeToken}`)
        .send({
          purchaseOrderId: po.id,
          lines: [{ purchaseOrderLineId: po.lines[0].id, storeLocationId: storeId, receivedQuantity: 50 }],
        })
        .expect(201)
    ).body.data;
    await http().post(`/goods-receipt-notes/${grn.id}/submit`).set('Authorization', `Bearer ${prodEmployeeToken}`).expect(201);

    const finalized = (
      await http()
        .post(`/goods-receipt-notes/${grn.id}/finalize-qc`)
        .set('Authorization', `Bearer ${qcManagerToken}`)
        .send({ lines: [{ grnLineId: grn.lines[0].id, acceptedQuantity: 50, rejectedQuantity: 0 }] })
        .expect(201)
    ).body.data;
    expect(finalized.status).toBe('QC_PASSED');
    expect(finalized.ncrs).toHaveLength(0);
    // Accepted 50 entered stock.
    expect(Number(await onHand(itemAId))).toBe(before + 50);
    // PO fully received.
    const poAfter = (
      await http().get(`/purchase-orders/${po.id}`).set('Authorization', `Bearer ${prodEmployeeToken}`).expect(200)
    ).body.data;
    expect(poAfter.status).toBe('FULLY_RECEIVED');
  });

  it('partial acceptance creates BOTH a STOCK_IN (accepted) and an NCR (rejected)', async () => {
    const po = await createIssuedPo([{ itemId: itemBId, orderedQuantity: 40, unitPrice: 5 }]);
    const before = Number(await onHand(itemBId));

    const grn = (
      await http()
        .post('/goods-receipt-notes')
        .set('Authorization', `Bearer ${prodEmployeeToken}`)
        .send({
          purchaseOrderId: po.id,
          lines: [{ purchaseOrderLineId: po.lines[0].id, storeLocationId: storeId, receivedQuantity: 40 }],
        })
        .expect(201)
    ).body.data;
    await http().post(`/goods-receipt-notes/${grn.id}/submit`).set('Authorization', `Bearer ${prodEmployeeToken}`).expect(201);

    const finalized = (
      await http()
        .post(`/goods-receipt-notes/${grn.id}/finalize-qc`)
        .set('Authorization', `Bearer ${qcManagerToken}`)
        .send({
          lines: [{ grnLineId: grn.lines[0].id, acceptedQuantity: 30, rejectedQuantity: 10, rejectionReason: 'dented' }],
        })
        .expect(201)
    ).body.data;
    expect(finalized.status).toBe('QC_PARTIAL');
    // Only the 30 accepted entered stock; 10 rejected never did.
    expect(Number(await onHand(itemBId))).toBe(before + 30);
    // An NCR was raised for the rejected 10.
    expect(finalized.ncrs).toHaveLength(1);
    expect(finalized.ncrs[0].ncrNumber).toMatch(/^NCR-\d{4}-\d{4}$/);
    expect(finalized.ncrs[0].rejectedQuantity).toBe('10');
    expect(finalized.ncrs[0].status).toBe('OPEN');
    // PO partially received (30 of 40).
    const poAfter = (
      await http().get(`/purchase-orders/${po.id}`).set('Authorization', `Bearer ${prodEmployeeToken}`).expect(200)
    ).body.data;
    expect(poAfter.status).toBe('PARTIALLY_RECEIVED');
  });

  it('full rejection: QC_FAILED, no stock, NCR raised', async () => {
    const po = await createIssuedPo([{ itemId: itemBId, orderedQuantity: 8, unitPrice: 5 }]);
    const before = Number(await onHand(itemBId));
    const grn = (
      await http()
        .post('/goods-receipt-notes')
        .set('Authorization', `Bearer ${prodEmployeeToken}`)
        .send({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: po.lines[0].id, storeLocationId: storeId, receivedQuantity: 8 }] })
        .expect(201)
    ).body.data;
    await http().post(`/goods-receipt-notes/${grn.id}/submit`).set('Authorization', `Bearer ${prodEmployeeToken}`).expect(201);
    const finalized = (
      await http()
        .post(`/goods-receipt-notes/${grn.id}/finalize-qc`)
        .set('Authorization', `Bearer ${qcManagerToken}`)
        .send({ lines: [{ grnLineId: grn.lines[0].id, acceptedQuantity: 0, rejectedQuantity: 8, rejectionReason: 'wrong spec' }] })
        .expect(201)
    ).body.data;
    expect(finalized.status).toBe('QC_FAILED');
    expect(Number(await onHand(itemBId))).toBe(before); // unchanged
    expect(finalized.ncrs).toHaveLength(1);
  });

  it('computes "previously received" across multiple GRNs against the same PO line', async () => {
    const po = await createIssuedPo([{ itemId: itemAId, orderedQuantity: 100, unitPrice: 10 }]);
    const poLineId = po.lines[0].id;

    // First GRN: accept 30.
    const g1 = (
      await http().post('/goods-receipt-notes').set('Authorization', `Bearer ${prodEmployeeToken}`)
        .send({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: poLineId, storeLocationId: storeId, receivedQuantity: 30 }] }).expect(201)
    ).body.data;
    await http().post(`/goods-receipt-notes/${g1.id}/submit`).set('Authorization', `Bearer ${prodEmployeeToken}`).expect(201);
    await http().post(`/goods-receipt-notes/${g1.id}/finalize-qc`).set('Authorization', `Bearer ${qcManagerToken}`)
      .send({ lines: [{ grnLineId: g1.lines[0].id, acceptedQuantity: 30, rejectedQuantity: 0 }] }).expect(201);

    // Second GRN: previously-received should now read 30.
    const g2 = (
      await http().post('/goods-receipt-notes').set('Authorization', `Bearer ${prodEmployeeToken}`)
        .send({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: poLineId, storeLocationId: storeId, receivedQuantity: 25 }] }).expect(201)
    ).body.data;
    const g2read = (
      await http().get(`/goods-receipt-notes/${g2.id}`).set('Authorization', `Bearer ${prodEmployeeToken}`).expect(200)
    ).body.data;
    expect(g2read.lines[0].previouslyReceived).toBe('30');

    await http().post(`/goods-receipt-notes/${g2.id}/submit`).set('Authorization', `Bearer ${prodEmployeeToken}`).expect(201);
    await http().post(`/goods-receipt-notes/${g2.id}/finalize-qc`).set('Authorization', `Bearer ${qcManagerToken}`)
      .send({ lines: [{ grnLineId: g2.lines[0].id, acceptedQuantity: 25, rejectedQuantity: 0 }] }).expect(201);

    // PO now has 55 of 100 → still PARTIALLY_RECEIVED.
    const poAfter = (
      await http().get(`/purchase-orders/${po.id}`).set('Authorization', `Bearer ${prodEmployeeToken}`).expect(200)
    ).body.data;
    expect(poAfter.status).toBe('PARTIALLY_RECEIVED');
  });

  it('warns (but does not block) on over-receipt beyond ordered quantity', async () => {
    const po = await createIssuedPo([{ itemId: itemAId, orderedQuantity: 10, unitPrice: 10 }]);
    const grn = (
      await http().post('/goods-receipt-notes').set('Authorization', `Bearer ${prodEmployeeToken}`)
        .send({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: po.lines[0].id, storeLocationId: storeId, receivedQuantity: 15 }] }).expect(201)
    ).body.data;
    await http().post(`/goods-receipt-notes/${grn.id}/submit`).set('Authorization', `Bearer ${prodEmployeeToken}`).expect(201);
    const finalized = (
      await http().post(`/goods-receipt-notes/${grn.id}/finalize-qc`).set('Authorization', `Bearer ${qcManagerToken}`)
        .send({ lines: [{ grnLineId: grn.lines[0].id, acceptedQuantity: 15, rejectedQuantity: 0 }] }).expect(201)
    ).body.data;
    // Created despite over-receipt, with a warning attached.
    expect(finalized.status).toBe('QC_PASSED');
    expect(finalized.overReceiptWarnings.length).toBeGreaterThanOrEqual(1);
    expect(finalized.overReceiptWarnings[0].message).toMatch(/over-receipt/i);
    expect(finalized.status).not.toBe('CANCELLED');
  });

  it('gates receiving to Production/SA and inspection to QC Inspector/SA', async () => {
    const po = await createIssuedPo([{ itemId: itemAId, orderedQuantity: 5, unitPrice: 10 }]);
    // Outsider (Sales) cannot receive.
    await http().post('/goods-receipt-notes').set('Authorization', `Bearer ${outsiderToken}`)
      .send({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: po.lines[0].id, storeLocationId: storeId, receivedQuantity: 5 }] }).expect(403);
    // Production employee can, and can read company-wide.
    const grn = (
      await http().post('/goods-receipt-notes').set('Authorization', `Bearer ${prodEmployeeToken}`)
        .send({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: po.lines[0].id, storeLocationId: storeId, receivedQuantity: 5 }] }).expect(201)
    ).body.data;
    await http().post(`/goods-receipt-notes/${grn.id}/submit`).set('Authorization', `Bearer ${prodEmployeeToken}`).expect(201);

    // A non-QC-inspector (the plain Production employee) cannot finalize.
    await http().post(`/goods-receipt-notes/${grn.id}/finalize-qc`).set('Authorization', `Bearer ${prodEmployeeToken}`)
      .send({ lines: [{ grnLineId: grn.lines[0].id, acceptedQuantity: 5, rejectedQuantity: 0 }] }).expect(403);
    // The designated QC inspector can.
    await http().post(`/goods-receipt-notes/${grn.id}/finalize-qc`).set('Authorization', `Bearer ${qcManagerToken}`)
      .send({ lines: [{ grnLineId: grn.lines[0].id, acceptedQuantity: 5, rejectedQuantity: 0 }] }).expect(201);
  });

  it('rejects QC decisions whose accepted + rejected != received', async () => {
    const po = await createIssuedPo([{ itemId: itemAId, orderedQuantity: 20, unitPrice: 10 }]);
    const grn = (
      await http().post('/goods-receipt-notes').set('Authorization', `Bearer ${prodEmployeeToken}`)
        .send({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: po.lines[0].id, storeLocationId: storeId, receivedQuantity: 20 }] }).expect(201)
    ).body.data;
    await http().post(`/goods-receipt-notes/${grn.id}/submit`).set('Authorization', `Bearer ${prodEmployeeToken}`).expect(201);
    await http().post(`/goods-receipt-notes/${grn.id}/finalize-qc`).set('Authorization', `Bearer ${qcManagerToken}`)
      .send({ lines: [{ grnLineId: grn.lines[0].id, acceptedQuantity: 5, rejectedQuantity: 5 }] }).expect(400);
    // Also requires a rejection reason when rejecting.
    await http().post(`/goods-receipt-notes/${grn.id}/finalize-qc`).set('Authorization', `Bearer ${qcManagerToken}`)
      .send({ lines: [{ grnLineId: grn.lines[0].id, acceptedQuantity: 15, rejectedQuantity: 5 }] }).expect(400);
  });

  it('runs the NCR disposition workflow (QC Inspector), gated from outsiders', async () => {
    const po = await createIssuedPo([{ itemId: itemBId, orderedQuantity: 12, unitPrice: 5 }]);
    const grn = (
      await http().post('/goods-receipt-notes').set('Authorization', `Bearer ${prodEmployeeToken}`)
        .send({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: po.lines[0].id, storeLocationId: storeId, receivedQuantity: 12 }] }).expect(201)
    ).body.data;
    await http().post(`/goods-receipt-notes/${grn.id}/submit`).set('Authorization', `Bearer ${prodEmployeeToken}`).expect(201);
    const finalized = (
      await http().post(`/goods-receipt-notes/${grn.id}/finalize-qc`).set('Authorization', `Bearer ${qcManagerToken}`)
        .send({ lines: [{ grnLineId: grn.lines[0].id, acceptedQuantity: 10, rejectedQuantity: 2, rejectionReason: 'scratched' }] }).expect(201)
    ).body.data;
    const ncrId = finalized.ncrs[0].id;

    // Outsider cannot disposition.
    await http().post(`/non-conformance-reports/${ncrId}/disposition`).set('Authorization', `Bearer ${outsiderToken}`)
      .send({ disposition: 'RETURN_TO_SUPPLIER' }).expect(403);

    // QC inspector can.
    const dispositioned = (
      await http().post(`/non-conformance-reports/${ncrId}/disposition`).set('Authorization', `Bearer ${qcManagerToken}`)
        .send({ disposition: 'SCRAP', dispositionNotes: 'unusable' }).expect(201)
    ).body.data;
    expect(dispositioned.status).toBe('DISPOSITIONED');
    expect(dispositioned.disposition).toBe('SCRAP');

    const closed = (
      await http().post(`/non-conformance-reports/${ncrId}/close`).set('Authorization', `Bearer ${qcManagerToken}`).expect(201)
    ).body.data;
    expect(closed.status).toBe('CLOSED');
  });
});
