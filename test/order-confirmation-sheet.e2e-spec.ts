import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { VaultStorageService } from '../src/modules/vault/vault-storage.service';

/**
 * Order Confirmation Sheet e2e (§7 lifecycle):
 *   create → fill (incl. required packaging) → generate PDF →
 *   customer requests a change BEFORE signing → request-revision → new DRAFT →
 *   edit → regenerate → upload signed copy → Sales Head REJECTS w/ comments →
 *   revision again → re-upload → Sales Head SIGNS → EXECUTED →
 *   order can now move to IN_PRODUCTION (and is blocked before that point),
 *   with all prior revisions' history intact.
 *
 * The R2 client is replaced by an in-memory fake so signed-copy upload/confirm
 * work without real object storage.
 */
class FakeStorage {
  objects = new Map<string, { contentType: string }>();
  async createUploadUrl(storageKey: string, contentType: string) {
    // Simulate the browser's direct PUT landing immediately.
    this.objects.set(storageKey, { contentType });
    return { url: `https://fake-r2/${storageKey}?sig=put`, expiresInSeconds: 300 };
  }
  async createDownloadUrl(storageKey: string) {
    return { url: `https://fake-r2/${storageKey}?sig=get`, expiresInSeconds: 300 };
  }
  async headObject(storageKey: string) {
    return this.objects.has(storageKey)
      ? { sizeBytes: 1024, contentType: 'application/pdf' }
      : null;
  }
}

describe('Order Confirmation Sheet (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: FakeStorage;

  let repToken: string;
  let salesHeadToken: string;
  let superAdminToken: string;
  let superAdminId: string;
  let salesVerticalId: string;
  let repId: string;
  let salesHeadId: string;
  let orderId: string;
  let customerId: string;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const createdEmployeeIds: string[] = [];
  const extraOrderIds: string[] = [];

  /** A fresh CONFIRMED order (each test that advances status needs its own). */
  async function freshOrder(): Promise<string> {
    const o = await prisma.order.create({
      data: {
        orderNumber: `ORD-TEST-${extraOrderIds.length}-${repId.slice(0, 6)}-${Math.floor(
          performance.now(),
        )}`,
        customerId,
        status: 'CONFIRMED',
        totalAmount: '1000000',
        ownerId: repId,
      },
    });
    extraOrderIds.push(o.id);
    return o.id;
  }

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken;
  }

  /** A fully-populated update body (all required fields incl. packaging). */
  function completeFields(overrides: Record<string, unknown> = {}) {
    return {
      requirementsOverview: 'Deliver 3 modular DC racks per agreed spec.',
      deliveryDate: '2026-09-01',
      deliveryLocation: 'Plot 12, Industrial Area, Bengaluru',
      deliveryType: 'FULL_TRUCKLOAD',
      qualityReportsExpected: ['MATERIAL_TEST_CERTIFICATE', 'CALIBRATION_CERTIFICATE'],
      warrantyTerms: '24 months on-site warranty.',
      paymentMilestones: '50% on dispatch, 50% on installation.',
      packagingType: 'Wooden Crate',
      protectiveMeasures: 'Moisture barrier + shock indicators',
      labelingRequirements: 'Fragile, this-side-up, customer PO on each crate',
      customerContactName: 'Ravi Kumar',
      customerContactPhone: '+91-9000000000',
      customerContactEmail: 'ravi@customer.example',
      ...overrides,
    };
  }

  async function fillAndGenerate(sheetId: string, overrides = {}) {
    await request(app.getHttpServer())
      .patch(`/confirmation-sheets/${sheetId}`)
      .set('Authorization', `Bearer ${repToken}`)
      .send(completeFields(overrides))
      .expect(200);
    return request(app.getHttpServer())
      .post(`/confirmation-sheets/${sheetId}/generate-pdf`)
      .set('Authorization', `Bearer ${repToken}`)
      .expect(201);
  }

  async function uploadSignedCopy(sheetId: string) {
    const presign = await request(app.getHttpServer())
      .post(`/confirmation-sheets/${sheetId}/signed-copy-upload-url`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ contentType: 'application/pdf' })
      .expect(201);
    const { storageKey } = presign.body.data;
    await request(app.getHttpServer())
      .post(`/confirmation-sheets/${sheetId}/upload-signed-copy`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ storageKey })
      .expect(201);
  }

  beforeAll(async () => {
    storage = new FakeStorage();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(VaultStorageService)
      .useValue(storage)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const salesVertical = await prisma.vertical.findUniqueOrThrow({
      where: { code: 'SALES' },
    });
    salesVerticalId = salesVertical.id;
    const superAdmin = await prisma.employee.findUniqueOrThrow({
      where: { email: adminEmail },
    });
    superAdminId = superAdmin.id;
    const adminToken = await login(adminEmail, adminPassword);
    superAdminToken = adminToken;

    const suffix = Date.now();
    const mk = async (body: Record<string, unknown>) => {
      const res = await request(app.getHttpServer())
        .post('/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body)
        .expect(201);
      createdEmployeeIds.push(res.body.data.id);
      return res.body.data;
    };

    const rep = await mk({
      firstName: 'Oc',
      lastName: 'Rep',
      email: `oc.rep.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVertical.id,
      reportingManagerId: superAdmin.id,
    });
    repId = rep.id;
    const head = await mk({
      firstName: 'Oc',
      lastName: 'Head',
      email: `oc.head.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVertical.id,
      reportingManagerId: superAdmin.id,
    });
    salesHeadId = head.id;
    // Designate the Sales Head (the sign/reject reviewer).
    await request(app.getHttpServer())
      .patch(`/employees/${salesHeadId}/designate-sales-head`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    repToken = await login(rep.email, 'S3curePass!');
    salesHeadToken = await login(head.email, 'S3curePass!');

    // Seed a CONFIRMED order (owned by the rep) directly — the sheet workflow
    // only needs the order to exist; driving the whole lead→bid→order chain
    // isn't what's under test here.
    const customer = await prisma.customer.create({
      data: {
        name: `OC Customer ${suffix}`,
        billingAddress: { line1: '1 Test Rd', city: 'Bengaluru' },
        ownerId: repId,
      },
    });
    customerId = customer.id;
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-TEST-${suffix}`,
        customerId,
        status: 'CONFIRMED',
        totalAmount: '1000000',
        ownerId: repId,
      },
    });
    orderId = order.id;
  });

  afterAll(async () => {
    const allOrderIds = [orderId, ...extraOrderIds];
    await prisma.orderConfirmationSheet.deleteMany({
      where: { orderId: { in: allOrderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: allOrderIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    if (createdEmployeeIds.length) {
      await prisma.employee.deleteMany({ where: { id: { in: createdEmployeeIds } } });
    }
    await app.close();
  });

  it('runs the full lifecycle incl. revision-before-signing and the order gate', async () => {
    // Order can't enter production before any executed sheet.
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ status: 'IN_PRODUCTION' })
      .expect(400);

    // 1. Create DRAFT (rev 1).
    const createRes = await request(app.getHttpServer())
      .post(`/orders/${orderId}/confirmation-sheets`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({})
      .expect(201);
    const rev1 = createRes.body.data;
    expect(rev1.confirmationNumber).toMatch(/^OC-\d{4}-\d{4}$/);
    expect(rev1.revisionNumber).toBe(1);
    expect(rev1.status).toBe('DRAFT');

    // generate-pdf must reject while required fields (packaging etc.) are empty.
    await request(app.getHttpServer())
      .post(`/confirmation-sheets/${rev1.id}/generate-pdf`)
      .set('Authorization', `Bearer ${repToken}`)
      .expect(400);

    // 2. Fill + generate → AWAITING_CUSTOMER_SIGNATURE (locked).
    const genRes = await fillAndGenerate(rev1.id);
    expect(genRes.body.data.status).toBe('AWAITING_CUSTOMER_SIGNATURE');
    expect(genRes.body.data.pdfGeneratedAt).not.toBeNull();

    // Locked: editing a non-DRAFT sheet is rejected.
    await request(app.getHttpServer())
      .patch(`/confirmation-sheets/${rev1.id}`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ deliveryLocation: 'changed' })
      .expect(400);

    // 3. Customer requests a change BEFORE signing → request-revision → rev 2.
    const rev2Res = await request(app.getHttpServer())
      .post(`/confirmation-sheets/${rev1.id}/request-revision`)
      .set('Authorization', `Bearer ${repToken}`)
      .expect(201);
    const rev2 = rev2Res.body.data;
    expect(rev2.revisionNumber).toBe(2);
    expect(rev2.status).toBe('DRAFT');
    // Pre-filled from rev1.
    expect(rev2.packagingType).toBe('Wooden Crate');
    expect(rev2.deliveryLocation).toBe('Plot 12, Industrial Area, Bengaluru');

    // Edit (new delivery date), regenerate, upload signed copy.
    await fillAndGenerate(rev2.id, { deliveryDate: '2026-10-15' });
    await uploadSignedCopy(rev2.id);
    const rev2AfterUpload = await request(app.getHttpServer())
      .get(`/confirmation-sheets/${rev2.id}`)
      .set('Authorization', `Bearer ${repToken}`)
      .expect(200);
    expect(rev2AfterUpload.body.data.status).toBe('AWAITING_INTERNAL_SIGNATURE');
    expect(rev2AfterUpload.body.data.hasSignedCopy).toBe(true);

    // A plain rep cannot sign or reject.
    await request(app.getHttpServer())
      .patch(`/confirmation-sheets/${rev2.id}/sign`)
      .set('Authorization', `Bearer ${repToken}`)
      .expect(403);

    // Reject requires comments.
    await request(app.getHttpServer())
      .patch(`/confirmation-sheets/${rev2.id}/reject`)
      .set('Authorization', `Bearer ${salesHeadToken}`)
      .send({})
      .expect(400);

    // 4. Sales Head rejects with comments → REJECTED.
    const rejRes = await request(app.getHttpServer())
      .patch(`/confirmation-sheets/${rev2.id}/reject`)
      .set('Authorization', `Bearer ${salesHeadToken}`)
      .send({ comments: 'Delivery window still wrong.' })
      .expect(200);
    expect(rejRes.body.data.status).toBe('REJECTED');
    expect(rejRes.body.data.internalReviewComments).toBe(
      'Delivery window still wrong.',
    );

    // Order still blocked from production (latest sheet is REJECTED).
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ status: 'IN_PRODUCTION' })
      .expect(400);

    // 5. Revision again from REJECTED → rev 3, fill, generate, re-upload.
    const rev3Res = await request(app.getHttpServer())
      .post(`/confirmation-sheets/${rev2.id}/request-revision`)
      .set('Authorization', `Bearer ${repToken}`)
      .expect(201);
    const rev3 = rev3Res.body.data;
    expect(rev3.revisionNumber).toBe(3);
    await fillAndGenerate(rev3.id, { deliveryDate: '2026-11-01' });
    await uploadSignedCopy(rev3.id);

    // Sales Head reviews the real uploaded doc (presigned GET works).
    const dl = await request(app.getHttpServer())
      .get(`/confirmation-sheets/${rev3.id}/signed-copy-download-url`)
      .set('Authorization', `Bearer ${salesHeadToken}`)
      .expect(200);
    expect(dl.body.data.downloadUrl).toContain('https://fake-r2/');

    // 6. Sales Head signs → EXECUTED.
    const signRes = await request(app.getHttpServer())
      .patch(`/confirmation-sheets/${rev3.id}/sign`)
      .set('Authorization', `Bearer ${salesHeadToken}`)
      .expect(200);
    expect(signRes.body.data.status).toBe('EXECUTED');
    expect(signRes.body.data.internalSignedById).toBe(salesHeadId);

    // 7. Order can NOW move to IN_PRODUCTION.
    const prodRes = await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ status: 'IN_PRODUCTION' })
      .expect(200);
    expect(prodRes.body.data.status).toBe('IN_PRODUCTION');

    // All three revisions' history remains intact and viewable.
    const historyRes = await request(app.getHttpServer())
      .get(`/orders/${orderId}/confirmation-sheets`)
      .set('Authorization', `Bearer ${repToken}`)
      .expect(200);
    const history = historyRes.body.data as Array<{
      revisionNumber: number;
      status: string;
    }>;
    expect(history).toHaveLength(3);
    // Newest first.
    expect(history.map((h) => h.revisionNumber)).toEqual([3, 2, 1]);
    expect(history.find((h) => h.revisionNumber === 3)?.status).toBe('EXECUTED');
    expect(history.find((h) => h.revisionNumber === 2)?.status).toBe('REJECTED');
    expect(history.find((h) => h.revisionNumber === 1)?.status).toBe(
      'AWAITING_CUSTOMER_SIGNATURE',
    );
  });

  it('snapshots the Sales Head signature at sign time and never rewrites it after a later change', async () => {
    // Sales Head configures a signature.
    await request(app.getHttpServer())
      .patch('/employees/me/signature')
      .set('Authorization', `Bearer ${salesHeadToken}`)
      .send({ signatureText: 'S. Head', signatureFont: 'DANCING_SCRIPT' })
      .expect(200);

    // Minimal sheet → generate → upload → sign (on a fresh CONFIRMED order).
    const freshOrderId = await freshOrder();
    const created = await request(app.getHttpServer())
      .post(`/orders/${freshOrderId}/confirmation-sheets`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({})
      .expect(201);
    const sheetId = created.body.data.id;
    await fillAndGenerate(sheetId);
    await uploadSignedCopy(sheetId);
    const signed = await request(app.getHttpServer())
      .patch(`/confirmation-sheets/${sheetId}/sign`)
      .set('Authorization', `Bearer ${salesHeadToken}`)
      .expect(200);

    // Snapshot captured with the values that were current at sign time.
    expect(signed.body.data.approverSignatureTextSnapshot).toBe('S. Head');
    expect(signed.body.data.approverSignatureFontSnapshot).toBe(
      'DANCING_SCRIPT',
    );

    // Sales Head later CHANGES their signature.
    await request(app.getHttpServer())
      .patch('/employees/me/signature')
      .set('Authorization', `Bearer ${salesHeadToken}`)
      .send({ signatureText: 'Different Name', signatureFont: 'PACIFICO' })
      .expect(200);

    // The already-executed sheet still shows the ORIGINAL snapshot (immutable).
    const reread = await request(app.getHttpServer())
      .get(`/confirmation-sheets/${sheetId}`)
      .set('Authorization', `Bearer ${salesHeadToken}`)
      .expect(200);
    expect(reread.body.data.approverSignatureTextSnapshot).toBe('S. Head');
    expect(reread.body.data.approverSignatureFontSnapshot).toBe(
      'DANCING_SCRIPT',
    );
  });

  it('signing without a configured signature still works; snapshot stays null', async () => {
    // A fresh Sales Head with NO signature configured.
    const suffix = Date.now();
    const bareHead = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        firstName: 'Bare',
        lastName: 'Head',
        email: `bare.head.${suffix}@peoplehub.local`,
        password: 'S3curePass!',
        role: 'MANAGER',
        verticalId: salesVerticalId,
        reportingManagerId: superAdminId,
      })
      .expect(201);
    createdEmployeeIds.push(bareHead.body.data.id);
    // Make this one the Sales Head (designate moves the flag atomically).
    await request(app.getHttpServer())
      .patch(`/employees/${bareHead.body.data.id}/designate-sales-head`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    const bareHeadToken = await login(
      `bare.head.${suffix}@peoplehub.local`,
      'S3curePass!',
    );

    const freshOrderId = await freshOrder();
    const created = await request(app.getHttpServer())
      .post(`/orders/${freshOrderId}/confirmation-sheets`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({})
      .expect(201);
    const sheetId = created.body.data.id;
    await fillAndGenerate(sheetId);
    await uploadSignedCopy(sheetId);
    const signed = await request(app.getHttpServer())
      .patch(`/confirmation-sheets/${sheetId}/sign`)
      .set('Authorization', `Bearer ${bareHeadToken}`)
      .expect(200);

    // Approval succeeded (not blocked) and the snapshot is null (UI falls back).
    expect(signed.body.data.status).toBe('EXECUTED');
    expect(signed.body.data.approverSignatureTextSnapshot).toBeNull();
    expect(signed.body.data.approverSignatureFontSnapshot).toBeNull();
  });
});
