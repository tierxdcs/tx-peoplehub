import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * Purchase Orders (Stores Phase 1). Verifies:
 *  - PO + lines CRUD; company-wide read; SCM Manager+/SA gate on create/manage
 *  - exactly-one-of supplier/vendor enforced
 *  - unqualified supplier/vendor → clear warning, but PO still created
 *  - poNumber uses the shared year-prefixed sequence (PO-YYYY-0001, increments)
 *  - status flow DRAFT → ISSUED → CANCELLED; receipt-derived states unreachable
 *  - lineTotal computed; no receivedQuantity field exists on lines
 */
describe('Purchase Orders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  let superAdminToken: string;
  let superAdminId: string;
  let scmManagerToken: string;
  let outsiderToken: string; // non-SCM EMPLOYEE — company-wide read only

  let approvedSupplierId: string;
  let unqualifiedSupplierId: string;
  let approvedVendorId: string;
  let itemAId: string;
  let itemBId: string;

  const http = () => request(app.getHttpServer());
  function login(email: string, password: string) {
    return http().post('/auth/login').send({ email, password }).expect(200)
      .then((r) => r.body.data.accessToken as string);
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
    const salesVertical = await prisma.vertical.findUniqueOrThrow({ where: { code: 'SALES' } });
    const suffix = Date.now();
    const mk = async (firstName: string, role: string, verticalId: string) => {
      const email = `po.${firstName.toLowerCase()}.${suffix}@peoplehub.local`;
      const res = await http()
        .post('/employees')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          firstName,
          lastName: 'PO',
          email,
          password: 'S3curePass!',
          role,
          verticalId,
          reportingManagerId: superAdminId,
        })
        .expect(201);
      return { id: res.body.data.id as string, email };
    };
    const mgr = await mk('Mgr', 'MANAGER', scmVertical.id);
    scmManagerToken = await login(mgr.email, 'S3curePass!');
    const outsider = await mk('Outsider', 'EMPLOYEE', salesVertical.id);
    outsiderToken = await login(outsider.email, 'S3curePass!');

    // Trading partners: an APPROVED supplier, an unqualified (PENDING) supplier,
    // and an APPROVED vendor.
    const supplierBase = {
      registeredAddress: 'x', factoryAddress: 'x', yearEstablished: '2000',
      numberOfEmployees: '10', annualTurnover: '1cr', contactPersonName: 'x',
      contactPersonDesignation: 'x', contactEmail: 'x@y.com',
      contactPhone: '+910000000000', createdById: superAdminId,
    };
    approvedSupplierId = (
      await prisma.supplier.create({
        data: { ...supplierBase, companyName: `AppSup ${suffix}`, status: 'APPROVED' },
      })
    ).id;
    unqualifiedSupplierId = (
      await prisma.supplier.create({
        data: {
          ...supplierBase,
          companyName: `PendSup ${suffix}`,
          status: 'PENDING_QUESTIONNAIRE',
        },
      })
    ).id;
    approvedVendorId = (
      await prisma.vendor.create({
        data: { ...supplierBase, companyName: `AppVen ${suffix}`, status: 'APPROVED_PREFERRED' },
      })
    ).id;

    itemAId = (
      await prisma.item.create({
        data: { itemCode: `PO-IT-A-${suffix}`, name: 'Steel', itemType: 'RAW_MATERIAL', baseUnitOfMeasure: 'kg' },
      })
    ).id;
    itemBId = (
      await prisma.item.create({
        data: { itemCode: `PO-IT-B-${suffix}`, name: 'Bolt', itemType: 'COMPONENT', baseUnitOfMeasure: 'pcs' },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a PO (qualified supplier), computes line totals, and numbers PO-YYYY-####', async () => {
    const year = new Date().getUTCFullYear();
    const po = (
      await http()
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send({
          supplierId: approvedSupplierId,
          notes: 'first PO',
          lines: [
            { itemId: itemAId, orderedQuantity: 10, unitPrice: 100 },
            { itemId: itemBId, orderedQuantity: 5, unitPrice: 20, unitOfMeasure: 'box' },
          ],
        })
        .expect(201)
    ).body.data;

    expect(po.status).toBe('DRAFT');
    expect(po.poNumber).toMatch(new RegExp(`^PO-${year}-\\d{4}$`));
    expect(po.qualificationWarning).toBeNull(); // supplier is APPROVED
    expect(po.lines).toHaveLength(2);
    expect(po.lines[0].lineTotal).toBe('1000'); // 10 × 100
    expect(po.lines[1].unitOfMeasure).toBe('box'); // explicit snapshot honoured
    expect(po.totalAmount).toBe('1100.00');

    // A second PO increments the sequence within the same year.
    const po2 = (
      await http()
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send({ vendorId: approvedVendorId, lines: [{ itemId: itemAId, orderedQuantity: 1, unitPrice: 1 }] })
        .expect(201)
    ).body.data;
    const seq1 = Number(po.poNumber.split('-')[2]);
    const seq2 = Number(po2.poNumber.split('-')[2]);
    expect(seq2).toBe(seq1 + 1);
    // UoM defaulted from the item's base unit when omitted.
    expect(po2.lines[0].unitOfMeasure).toBe('kg');
  });

  it('warns (but does not block) for an unqualified supplier/vendor', async () => {
    const po = (
      await http()
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send({
          supplierId: unqualifiedSupplierId,
          lines: [{ itemId: itemAId, orderedQuantity: 2, unitPrice: 50 }],
        })
        .expect(201) // created despite being unqualified
    ).body.data;
    expect(po.status).toBe('DRAFT');
    expect(po.qualificationWarning).not.toBeNull();
    expect(po.qualificationWarning.partnerType).toBe('SUPPLIER');
    expect(po.qualificationWarning.status).toBe('PENDING_QUESTIONNAIRE');
    expect(po.qualificationWarning.message).toMatch(/not qualified/i);
    // The PO genuinely persisted.
    expect((await prisma.purchaseOrder.count({ where: { id: po.id } }))).toBe(1);
  });

  it('enforces exactly-one-of supplier/vendor', async () => {
    // Neither.
    await http()
      .post('/purchase-orders')
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ lines: [{ itemId: itemAId, orderedQuantity: 1, unitPrice: 1 }] })
      .expect(400);
    // Both.
    await http()
      .post('/purchase-orders')
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .send({
        supplierId: approvedSupplierId,
        vendorId: approvedVendorId,
        lines: [{ itemId: itemAId, orderedQuantity: 1, unitPrice: 1 }],
      })
      .expect(400);
  });

  it('gates create/manage to SCM Manager+/SA; read is company-wide', async () => {
    // A non-SCM employee cannot create.
    await http()
      .post('/purchase-orders')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ supplierId: approvedSupplierId, lines: [{ itemId: itemAId, orderedQuantity: 1, unitPrice: 1 }] })
      .expect(403);
    // But can read.
    await http().get('/purchase-orders').set('Authorization', `Bearer ${outsiderToken}`).expect(200);
  });

  it('runs the DRAFT → ISSUED → CANCELLED flow and rejects invalid transitions', async () => {
    const po = (
      await http()
        .post('/purchase-orders')
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send({ supplierId: approvedSupplierId, lines: [{ itemId: itemAId, orderedQuantity: 3, unitPrice: 10 }] })
        .expect(201)
    ).body.data;

    // Edit while DRAFT.
    await http()
      .patch(`/purchase-orders/${po.id}`)
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ notes: 'edited' })
      .expect(200);

    // Issue.
    const issued = (
      await http()
        .post(`/purchase-orders/${po.id}/issue`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(201)
    ).body.data;
    expect(issued.status).toBe('ISSUED');
    expect(issued.issuedAt).toBeTruthy();

    // Editing an ISSUED PO is rejected.
    await http()
      .patch(`/purchase-orders/${po.id}`)
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ notes: 'nope' })
      .expect(400);

    // Can't issue again.
    await http()
      .post(`/purchase-orders/${po.id}/issue`)
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .expect(400);

    // Cancel from ISSUED.
    const cancelled = (
      await http()
        .post(`/purchase-orders/${po.id}/cancel`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(201)
    ).body.data;
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledAt).toBeTruthy();

    // No transitions out of CANCELLED.
    await http()
      .post(`/purchase-orders/${po.id}/issue`)
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .expect(400);
  });

  it('has no stored receivedQuantity column on purchase_order_lines', async () => {
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'purchase_order_lines'",
    );
    const names = cols.map((c) => c.column_name.toLowerCase());
    expect(names).not.toContain('receivedquantity');
    expect(names).not.toContain('received_quantity');
  });
});
