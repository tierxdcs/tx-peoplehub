import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * BOM + Item Master + Inventory + kickoff stock-availability e2e.
 * Covers the spec §12 checklist:
 *  - R&D Head designation + vertical validation
 *  - non-R&D cannot create a BOM; R&D-Head-only approve/reject; no self-approve
 *  - draft create/edit, submit, rejection-requires-comment, released immutable
 *  - new revision obsoletes the prior released revision
 *  - only a released BOM can be selected for kickoff; snapshot is stable
 *  - requirement calc with wastage; duplicate-item aggregation
 *  - available/expected/shortage/unknown classification
 *  - reservation create/cancel + over-reservation prevention + no double-count
 *  - stock adjustment negative guards
 */
describe('BOM + Inventory (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const createdEmployeeIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];

  let superAdminToken: string;
  let superAdminId: string;
  let rndAuthorToken: string; // R&D vertical, authors BOMs
  let rndAuthorId: string;
  let rndHeadToken: string; // R&D vertical + isRdHead, approves
  let rndHeadId: string;
  let rndHead2Token: string; // a second R&D Head (approves a BOM the first created)
  let storeToken: string; // PRODUCTION vertical = Store
  let salesToken: string; // outsider (Sales vertical, non-R&D)
  let salesEmpId: string;

  let storeId: string;
  let rndVerticalId: string;
  let salesVerticalId: string;
  let productionVerticalId: string;

  function login(email: string, password: string) {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200)
      .then((r) => r.body.data.accessToken as string);
  }

  const http = () => request(app.getHttpServer());

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

    rndVerticalId = (await prisma.vertical.findUniqueOrThrow({ where: { code: 'RND' } })).id;
    salesVerticalId = (await prisma.vertical.findUniqueOrThrow({ where: { code: 'SALES' } })).id;
    productionVerticalId = (
      await prisma.vertical.findUniqueOrThrow({ where: { code: 'PRODUCTION' } })
    ).id;
    storeId = (await prisma.storeLocation.findFirstOrThrow({ where: { code: 'MAIN' } })).id;

    const suffix = Date.now();
    const mk = async (firstName: string, role: string, verticalId: string) => {
      const email = `bom.${firstName.toLowerCase()}.${suffix}@peoplehub.local`;
      const res = await http()
        .post('/employees')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          firstName,
          lastName: 'BOM',
          email,
          password: 'S3curePass!',
          role,
          verticalId,
          reportingManagerId: superAdminId,
        })
        .expect(201);
      createdEmployeeIds.push(res.body.data.id);
      return { id: res.body.data.id as string, email };
    };

    const author = await mk('Author', 'EMPLOYEE', rndVerticalId);
    rndAuthorId = author.id;
    const head = await mk('Head', 'MANAGER', rndVerticalId);
    rndHeadId = head.id;
    const head2 = await mk('Headtwo', 'MANAGER', rndVerticalId);
    const store = await mk('Store', 'EMPLOYEE', productionVerticalId);
    const sales = await mk('Sales', 'EMPLOYEE', salesVerticalId);
    salesEmpId = sales.id;

    // Designate the two R&D Heads (must be in the R&D vertical).
    await http()
      .patch(`/employees/${rndHeadId}/designate-rd-head`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    await http()
      .patch(`/employees/${head2.id}/designate-rd-head`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);

    rndAuthorToken = await login(author.email, 'S3curePass!');
    rndHeadToken = await login(head.email, 'S3curePass!');
    rndHead2Token = await login(head2.email, 'S3curePass!');
    storeToken = await login(store.email, 'S3curePass!');
    salesToken = await login(sales.email, 'S3curePass!');
  });

  afterAll(async () => {
    // The e2e harness (test/reset-db.ts) truncates every table per suite file,
    // so no manual row cleanup is needed here — just close the app.
    await app.close();
  });

  // ── helpers ────────────────────────────────────────────────────────
  // itemCode is server-generated from itemType (RM-/CM-/SA-/.../-00001) —
  // never sent by the caller. See ItemService.create().
  let itemSeq = 0;
  async function createItem(token: string, over: Record<string, unknown> = {}) {
    itemSeq += 1;
    return (
      await http()
        .post('/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `Item ${itemSeq}`,
          itemType: 'RAW_MATERIAL',
          baseUnitOfMeasure: 'kg',
          ...over,
        })
        .expect(201)
    ).body.data;
  }

  /**
   * A sellable Product linked to a manufactured FINISHED_GOOD Item. Returns both
   * ids — BOMs are keyed on the ITEM, orders reference the PRODUCT.
   */
  async function createProduct(): Promise<{ productId: string; itemId: string }> {
    const fg = await createItem(rndHeadToken, {
      itemType: 'FINISHED_GOOD',
      baseUnitOfMeasure: 'each',
    });
    const p = await prisma.product.create({
      data: {
        sku: `BOM-SKU-${Date.now()}-${createdProductIds.length}`,
        name: `Product ${createdProductIds.length}`,
        unitPrice: '1000',
        unitOfMeasure: 'each',
        itemId: fg.id,
      },
    });
    createdProductIds.push(p.id);
    return { productId: p.id, itemId: fg.id };
  }

  /** A qualified (APPROVED) supplier + link it to a raw-material item. */
  async function createApprovedSupplier(): Promise<string> {
    const s = await prisma.supplier.create({
      data: {
        companyName: `Sup ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        registeredAddress: 'x',
        factoryAddress: 'x',
        yearEstablished: '2000',
        numberOfEmployees: '10',
        annualTurnover: '1cr',
        contactPersonName: 'x',
        contactPersonDesignation: 'x',
        contactEmail: 'x@y.com',
        contactPhone: '+910000000000',
        status: 'APPROVED',
        createdById: superAdminId,
      },
    });
    return s.id;
  }

  /** Link an item to an APPROVED supplier so it clears the release hard-gate. */
  async function qualifyRawMaterial(itemId: string): Promise<void> {
    const supplierId = await createApprovedSupplier();
    await http()
      .post(`/items/${itemId}/suppliers`)
      .set('Authorization', `Bearer ${rndHeadToken}`)
      .send({ supplierId })
      .expect(201);
  }

  // ── R&D Head designation + vertical validation ───────────────────────
  it('R&D Head designation requires the R&D vertical (SUPER_ADMIN exempt)', async () => {
    // A Sales-vertical employee cannot be designated.
    await http()
      .patch(`/employees/${salesEmpId}/designate-rd-head`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(400);
    // A non-admin cannot designate at all (role gate).
    await http()
      .patch(`/employees/${rndAuthorId}/designate-rd-head`)
      .set('Authorization', `Bearer ${rndHeadToken}`)
      .expect(403);
    // A SUPER_ADMIN (typically no vertical) IS allowed to hold the designation.
    await http()
      .patch(`/employees/${superAdminId}/designate-rd-head`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    // Clean up so it doesn't affect other tests / approver-pool notifications.
    await http()
      .patch(`/employees/${superAdminId}/revoke-rd-head`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
  });

  // ── Item Master access ───────────────────────────────────────────────
  it('item create/update is R&D-Head-only; read is broad', async () => {
    // R&D author (not a head) cannot create items.
    await http()
      .post('/items')
      .set('Authorization', `Bearer ${rndAuthorToken}`)
      .send({ name: 'x', itemType: 'RAW_MATERIAL', baseUnitOfMeasure: 'kg' })
      .expect(403);
    // Sales outsider cannot even read.
    await http().get('/items').set('Authorization', `Bearer ${salesToken}`).expect(403);
    // R&D Head can create; store + author can read.
    const item = await createItem(rndHeadToken);
    await http().get(`/items/${item.id}`).set('Authorization', `Bearer ${storeToken}`).expect(200);
    await http().get('/items').set('Authorization', `Bearer ${rndAuthorToken}`).expect(200);
    // Deactivate (no hard delete): the row remains, isActive=false.
    await http()
      .delete(`/items/${item.id}`)
      .set('Authorization', `Bearer ${rndHeadToken}`)
      .expect(200);
    const after = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.isActive).toBe(false);
  });

  // ── BOM workflow ─────────────────────────────────────────────────────
  it('runs the full BOM workflow with all the guardrails', async () => {
    const { itemId: fgItemId } = await createProduct();
    const itemA = await createItem(rndHeadToken, { baseUnitOfMeasure: 'kg' });
    const itemB = await createItem(rndHeadToken, { baseUnitOfMeasure: 'pcs' });
    // Both raw materials get a qualified supplier so release isn't blocked by
    // the hard-gate (which is exercised separately below).
    await qualifyRawMaterial(itemA.id);
    await qualifyRawMaterial(itemB.id);

    // Non-R&D (Sales) cannot create a BOM.
    await http()
      .post('/boms')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ itemId: fgItemId, lines: [] })
      .expect(403);

    // R&D author creates a draft (BOM is FOR the finished-good item).
    const bom = (
      await http()
        .post('/boms')
        .set('Authorization', `Bearer ${rndAuthorToken}`)
        .send({
          itemId: fgItemId,
          revisionNotes: 'first cut',
          lines: [
            { itemId: itemA.id, quantityPerUnit: 2, unitOfMeasure: 'kg', wastagePercent: 10 },
            { itemId: itemB.id, quantityPerUnit: 4, unitOfMeasure: 'pcs' },
          ],
        })
        .expect(201)
    ).body.data;
    expect(bom.status).toBe('DRAFT');
    expect(bom.revisionNumber).toBe(1);
    expect(bom.lines).toHaveLength(2);
    expect(bom.itemId).toBe(fgItemId);

    // Store users may NOT browse the BOM (Engineering) module — R&D-only now.
    await http().get('/boms').set('Authorization', `Bearer ${storeToken}`).expect(403);
    await http()
      .get(`/boms/${bom.id}`)
      .set('Authorization', `Bearer ${storeToken}`)
      .expect(403);
    // R&D author can browse.
    await http().get('/boms').set('Authorization', `Bearer ${rndAuthorToken}`).expect(200);

    // Edit the draft.
    await http()
      .patch(`/boms/${bom.id}`)
      .set('Authorization', `Bearer ${rndAuthorToken}`)
      .send({ revisionNotes: 'edited' })
      .expect(200);

    // Submit for approval.
    const submitted = (
      await http()
        .post(`/boms/${bom.id}/submit`)
        .set('Authorization', `Bearer ${rndAuthorToken}`)
        .expect(201)
    ).body.data;
    expect(submitted.status).toBe('PENDING_APPROVAL');

    // The R&D Head sees it in the queue; a non-head (author) is 403.
    const queue = (
      await http()
        .get('/boms/pending-approval')
        .set('Authorization', `Bearer ${rndHeadToken}`)
        .expect(200)
    ).body.data;
    expect(queue.some((b: { id: string }) => b.id === bom.id)).toBe(true);
    await http()
      .get('/boms/pending-approval')
      .set('Authorization', `Bearer ${rndAuthorToken}`)
      .expect(403);

    // Rejection requires a non-empty comment.
    await http()
      .post(`/boms/${bom.id}/reject`)
      .set('Authorization', `Bearer ${rndHeadToken}`)
      .send({ comment: '' })
      .expect(400);

    // Reject with a comment → REJECTED.
    const rejected = (
      await http()
        .post(`/boms/${bom.id}/reject`)
        .set('Authorization', `Bearer ${rndHeadToken}`)
        .send({ comment: 'Fix the wastage on item B' })
        .expect(201)
    ).body.data;
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionComment).toContain('wastage');

    // A rejected BOM can be edited + resubmitted.
    await http()
      .patch(`/boms/${bom.id}`)
      .set('Authorization', `Bearer ${rndAuthorToken}`)
      .send({ lines: [{ itemId: itemA.id, quantityPerUnit: 3, unitOfMeasure: 'kg', wastagePercent: 5 }] })
      .expect(200);
    await http()
      .post(`/boms/${bom.id}/submit`)
      .set('Authorization', `Bearer ${rndAuthorToken}`)
      .expect(201);

    // The author (even if they were an R&D Head) cannot self-approve. Here the
    // author isn't a head at all, so approve is 403 for them.
    await http()
      .post(`/boms/${bom.id}/approve`)
      .set('Authorization', `Bearer ${rndAuthorToken}`)
      .expect(403);

    // A different R&D Head approves → RELEASED, with a signature snapshot slot.
    const released = (
      await http()
        .post(`/boms/${bom.id}/approve`)
        .set('Authorization', `Bearer ${rndHeadToken}`)
        .expect(201)
    ).body.data;
    expect(released.status).toBe('RELEASED');
    expect(released.approvedById).toBe(rndHeadId);

    // Released BOM is immutable.
    await http()
      .patch(`/boms/${bom.id}`)
      .set('Authorization', `Bearer ${rndAuthorToken}`)
      .send({ revisionNotes: 'nope' })
      .expect(403);

    // New revision → DRAFT rev 2, seeded from rev 1's lines.
    const rev2 = (
      await http()
        .post(`/boms/${bom.id}/new-revision`)
        .set('Authorization', `Bearer ${rndAuthorToken}`)
        .expect(201)
    ).body.data;
    expect(rev2.revisionNumber).toBe(2);
    expect(rev2.status).toBe('DRAFT');
    expect(rev2.lines.length).toBeGreaterThan(0);

    // Submit + approve rev 2 → rev 1 becomes OBSOLETE in the same step.
    await http()
      .post(`/boms/${rev2.id}/submit`)
      .set('Authorization', `Bearer ${rndAuthorToken}`)
      .expect(201);
    await http()
      .post(`/boms/${rev2.id}/approve`)
      .set('Authorization', `Bearer ${rndHead2Token}`)
      .expect(201);
    const rev1After = await prisma.bom.findUniqueOrThrow({ where: { id: bom.id } });
    expect(rev1After.status).toBe('OBSOLETE');
    const rev2After = await prisma.bom.findUniqueOrThrow({ where: { id: rev2.id } });
    expect(rev2After.status).toBe('RELEASED');

    // A creator who is ALSO a head still cannot self-approve: rndHead2 creates,
    // then tries to approve their own.
    const ownFg = await createProduct();
    const ownBom = (
      await http()
        .post('/boms')
        .set('Authorization', `Bearer ${rndHead2Token}`)
        .send({ itemId: ownFg.itemId, lines: [{ itemId: itemA.id, quantityPerUnit: 1, unitOfMeasure: 'kg' }] })
        .expect(201)
    ).body.data;
    await http()
      .post(`/boms/${ownBom.id}/submit`)
      .set('Authorization', `Bearer ${rndHead2Token}`)
      .expect(201);
    await http()
      .post(`/boms/${ownBom.id}/approve`)
      .set('Authorization', `Bearer ${rndHead2Token}`)
      .expect(403); // self-approval blocked
  });

  // ── Inventory adjustments ────────────────────────────────────────────
  it('stock adjustments are Store-only and cannot go negative', async () => {
    const item = await createItem(rndHeadToken);
    // R&D author cannot adjust (not Store).
    await http()
      .post('/inventory/adjustments')
      .set('Authorization', `Bearer ${rndAuthorToken}`)
      .send({ itemId: item.id, storeLocationId: storeId, quantityChange: 10, reason: 'x' })
      .expect(403);
    // Store adds 10.
    const bal = (
      await http()
        .post('/inventory/adjustments')
        .set('Authorization', `Bearer ${storeToken}`)
        .send({ itemId: item.id, storeLocationId: storeId, quantityChange: 10, reason: 'GRN' })
        .expect(201)
    ).body.data;
    expect(bal.onHandQuantity).toBe('10');
    expect(bal.availableQuantity).toBe('10');
    // Removing 15 would go negative → 400.
    await http()
      .post('/inventory/adjustments')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ itemId: item.id, storeLocationId: storeId, quantityChange: -15, reason: 'issue' })
      .expect(400);
  });

  // ── Kickoff snapshot + report + reservations ─────────────────────────
  it('generates a stock report with wastage, aggregation, classification, and reservations', async () => {
    // Two products sharing a common item to prove cross-line aggregation.
    const p1 = await createProduct();
    const p2 = await createProduct();
    const shared = await createItem(rndHeadToken, { baseUnitOfMeasure: 'kg' });
    const only2 = await createItem(rndHeadToken, { baseUnitOfMeasure: 'pcs' });
    const noStock = await createItem(rndHeadToken, { baseUnitOfMeasure: 'kg' });
    // Qualify raw materials so the release hard-gate passes.
    await qualifyRawMaterial(shared.id);
    await qualifyRawMaterial(only2.id);
    await qualifyRawMaterial(noStock.id);

    // Stock: shared has 100 on hand; only2 has 5 on hand + 20 expected (future);
    // noStock has NO balance row → UNKNOWN.
    await http().post('/inventory/adjustments').set('Authorization', `Bearer ${storeToken}`)
      .send({ itemId: shared.id, storeLocationId: storeId, quantityChange: 100, reason: 'seed' }).expect(201);
    await http().post('/inventory/adjustments').set('Authorization', `Bearer ${storeToken}`)
      .send({
        itemId: only2.id, storeLocationId: storeId, quantityChange: 5, reason: 'seed',
        expectedReceiptQuantity: 20, expectedReceiptDate: '2099-01-01',
      }).expect(201);

    // Release the finished-good BOM for each product's item.
    async function releaseBom(itemId: string, lines: object[]) {
      const b = (
        await http().post('/boms').set('Authorization', `Bearer ${rndAuthorToken}`)
          .send({ itemId, lines }).expect(201)
      ).body.data;
      await http().post(`/boms/${b.id}/submit`).set('Authorization', `Bearer ${rndAuthorToken}`).expect(201);
      await http().post(`/boms/${b.id}/approve`).set('Authorization', `Bearer ${rndHeadToken}`).expect(201);
      return b;
    }
    await releaseBom(p1.itemId, [
      { itemId: shared.id, quantityPerUnit: 2, unitOfMeasure: 'kg', wastagePercent: 0 },
    ]);
    await releaseBom(p2.itemId, [
      { itemId: shared.id, quantityPerUnit: 3, unitOfMeasure: 'kg', wastagePercent: 10 },
      { itemId: only2.id, quantityPerUnit: 10, unitOfMeasure: 'pcs', wastagePercent: 0 },
      { itemId: noStock.id, quantityPerUnit: 1, unitOfMeasure: 'kg', wastagePercent: 0 },
    ]);
    const productId1 = p1.productId;
    const productId2 = p2.productId;

    // Order with BOTH products; kickoff needs an EXECUTED confirmation sheet.
    const customer = await prisma.customer.create({
      data: { name: `BOM Cust ${Date.now()}`, billingAddress: { state: 'KA' }, ownerId: superAdminId },
    });
    createdCustomerIds.push(customer.id);
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-BOM-${Date.now()}`,
        customerId: customer.id,
        status: 'CONFIRMED',
        totalAmount: '1000',
        ownerId: superAdminId,
        lineItems: {
          create: [
            { productId: productId1, quantity: '10', unitPrice: '1000', lineTotal: '10000' },
            { productId: productId2, quantity: '10', unitPrice: '1000', lineTotal: '10000' },
          ],
        },
      },
    });
    createdOrderIds.push(order.id);
    await prisma.orderConfirmationSheet.create({
      data: {
        orderId: order.id,
        confirmationNumber: `OC-BOM-${Date.now()}`,
        revisionNumber: 1,
        status: 'EXECUTED',
        createdById: superAdminId,
        requirementsOverview: 'x',
        deliveryDate: new Date('2099-01-01'),
        deliveryLocation: 'BLR',
        deliveryType: 'FULL_TRUCKLOAD',
        warrantyTerms: '12m',
        paymentMilestones: '100%',
        packagingType: 'crate',
        protectiveMeasures: 'none',
        labelingRequirements: 'none',
        customerContactName: 'A',
        customerContactPhone: '+910000000000',
        customerContactEmail: 'a@b.com',
      },
    });
    const kickoff = (
      await http().post('/project-kickoffs').set('Authorization', `Bearer ${superAdminToken}`)
        .send({ orderId: order.id, meetingDate: '2026-08-01T10:00:00.000Z' }).expect(201)
    ).body.data;

    // Generate the report.
    const report = (
      await http()
        .post(`/project-kickoffs/${kickoff.id}/stock-availability/generate`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(201)
    ).body.data;

    const byCode = (code: string) =>
      report.rows.find((r: { itemCode: string }) => r.itemCode === code);

    // shared: product1 (2*10=20) + product2 (3*10=30 base + 10% wastage=3 → 33) = 53.
    const sharedRow = byCode(shared.itemCode);
    expect(sharedRow.grossRequirement).toBe('53');
    expect(sharedRow.bomRevisionSources.length).toBe(2); // aggregated across 2 BOMs
    expect(sharedRow.availabilityStatus).toBe('AVAILABLE'); // 100 on hand ≥ 53

    // only2: 10*10 = 100 gross; 5 on hand + 20 expected(future) → still short → SHORTAGE
    const only2Row = byCode(only2.itemCode);
    expect(only2Row.grossRequirement).toBe('100');
    expect(only2Row.availabilityStatus).toBe('SHORTAGE');

    // noStock: no balance row → UNKNOWN
    const noStockRow = byCode(noStock.itemCode);
    expect(noStockRow.availabilityStatus).toBe('UNKNOWN');

    // Summary counts.
    expect(report.summary.totalItems).toBe(3);
    expect(report.summary.available).toBe(1);
    expect(report.summary.shortage).toBe(1);
    expect(report.summary.unknown).toBe(1);

    // ── Reservations ──
    // Store reserves 20 shared for this kickoff.
    await http()
      .post(`/project-kickoffs/${kickoff.id}/reservations`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ itemId: shared.id, storeLocationId: storeId, quantity: 20 })
      .expect(201);

    // Re-read: shared still AVAILABLE and NOT double-counted (reserved-by-this-
    // kickoff is added back), reservedForThisKickoff = 20.
    const report2 = (
      await http()
        .get(`/project-kickoffs/${kickoff.id}/stock-availability`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200)
    ).body.data;
    const sharedRow2 = report2.rows.find(
      (r: { itemCode: string }) => r.itemCode === shared.itemCode,
    );
    expect(sharedRow2.reservedForThisKickoff).toBe('20');
    expect(sharedRow2.availabilityStatus).toBe('AVAILABLE');

    // Over-reservation prevented: available is now 80 (100-20 reserved); try 200.
    await http()
      .post(`/project-kickoffs/${kickoff.id}/reservations`)
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ itemId: shared.id, storeLocationId: storeId, quantity: 200 })
      .expect(400);

    // Override allows it.
    const overrideRes = (
      await http()
        .post(`/project-kickoffs/${kickoff.id}/reservations`)
        .set('Authorization', `Bearer ${storeToken}`)
        .send({ itemId: shared.id, storeLocationId: storeId, quantity: 200, allowOverride: true })
        .expect(201)
    ).body.data;

    // Cancel the override reservation → released.
    await http()
      .delete(`/project-kickoffs/${kickoff.id}/reservations/${overrideRes.id}`)
      .set('Authorization', `Bearer ${storeToken}`)
      .expect(204);

    // Snapshot stability: release a NEW revision of product1's BOM with a
    // different quantity; the EXISTING report must not change.
    const p1Boms = await prisma.bom.findMany({
      where: { itemId: p1.itemId, status: 'RELEASED' },
    });
    const rev = (
      await http().post(`/boms/${p1Boms[0].id}/new-revision`).set('Authorization', `Bearer ${rndAuthorToken}`).expect(201)
    ).body.data;
    await http().patch(`/boms/${rev.id}`).set('Authorization', `Bearer ${rndAuthorToken}`)
      .send({ lines: [{ itemId: shared.id, quantityPerUnit: 999, unitOfMeasure: 'kg', wastagePercent: 0 }] }).expect(200);
    await http().post(`/boms/${rev.id}/submit`).set('Authorization', `Bearer ${rndAuthorToken}`).expect(201);
    await http().post(`/boms/${rev.id}/approve`).set('Authorization', `Bearer ${rndHeadToken}`).expect(201);

    const report3 = (
      await http()
        .get(`/project-kickoffs/${kickoff.id}/stock-availability`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200)
    ).body.data;
    const sharedRow3 = report3.rows.find(
      (r: { itemCode: string }) => r.itemCode === shared.itemCode,
    );
    // Would be huge if it read the live BOM; snapshot keeps it at 53.
    expect(sharedRow3.grossRequirement).toBe('53');
  });

  // ── Supplier hard-gate on release ────────────────────────────────────
  it('blocks releasing a BOM whose RAW_MATERIAL has no qualified supplier, then allows it once linked', async () => {
    const { itemId: fgItemId } = await createProduct();
    const raw = await createItem(rndHeadToken, {
      itemType: 'RAW_MATERIAL',
      baseUnitOfMeasure: 'kg',
    });

    const bom = (
      await http()
        .post('/boms')
        .set('Authorization', `Bearer ${rndAuthorToken}`)
        .send({ itemId: fgItemId, lines: [{ itemId: raw.id, quantityPerUnit: 1, unitOfMeasure: 'kg' }] })
        .expect(201)
    ).body.data;
    await http().post(`/boms/${bom.id}/submit`).set('Authorization', `Bearer ${rndAuthorToken}`).expect(201);

    // Approve is BLOCKED — the raw material has no qualified supplier. The error
    // names the offending item.
    const blocked = await http()
      .post(`/boms/${bom.id}/approve`)
      .set('Authorization', `Bearer ${rndHeadToken}`)
      .expect(400);
    expect(blocked.body.message).toContain(raw.itemCode);
    // Still not released.
    expect((await prisma.bom.findUniqueOrThrow({ where: { id: bom.id } })).status).toBe(
      'PENDING_APPROVAL',
    );

    // A link to a NON-qualified supplier (PENDING) does not satisfy the gate.
    const pendingSupplier = await prisma.supplier.create({
      data: {
        companyName: `Pending ${Date.now()}`,
        registeredAddress: 'x', factoryAddress: 'x', yearEstablished: '2000',
        numberOfEmployees: '1', annualTurnover: '1', contactPersonName: 'x',
        contactPersonDesignation: 'x', contactEmail: 'p@q.com',
        contactPhone: '+910000000000', status: 'PENDING_QUESTIONNAIRE',
        createdById: superAdminId,
      },
    });
    await http()
      .post(`/items/${raw.id}/suppliers`)
      .set('Authorization', `Bearer ${rndHeadToken}`)
      .send({ supplierId: pendingSupplier.id })
      .expect(201);
    await http()
      .post(`/boms/${bom.id}/approve`)
      .set('Authorization', `Bearer ${rndHeadToken}`)
      .expect(400); // pending supplier still doesn't qualify

    // Link an APPROVED supplier → release now succeeds.
    await qualifyRawMaterial(raw.id);
    const released = (
      await http()
        .post(`/boms/${bom.id}/approve`)
        .set('Authorization', `Bearer ${rndHeadToken}`)
        .expect(201)
    ).body.data;
    expect(released.status).toBe('RELEASED');
  });

  // ── Multi-level explosion through the kickoff report ─────────────────
  it('explodes a 3-level BOM (FG -> SUB -> COMP -> RAW) to raw-material requirements', async () => {
    // Item tree: FG (product) -> 2× SUB ; SUB -> 3× COMP ; COMP -> 4× RAW.
    // RAW per FG = 2*3*4 = 24. Order 10 FG → 240 RAW.
    const fg = await createProduct();
    const sub = await createItem(rndHeadToken, { itemType: 'SUBASSEMBLY', baseUnitOfMeasure: 'ea' });
    const comp = await createItem(rndHeadToken, { itemType: 'COMPONENT', baseUnitOfMeasure: 'ea' });
    const raw = await createItem(rndHeadToken, { itemType: 'RAW_MATERIAL', baseUnitOfMeasure: 'kg' });
    await qualifyRawMaterial(raw.id); // only the RAW leaf needs a supplier

    async function releaseBom(itemId: string, lines: object[]) {
      const b = (
        await http().post('/boms').set('Authorization', `Bearer ${rndAuthorToken}`)
          .send({ itemId, lines }).expect(201)
      ).body.data;
      await http().post(`/boms/${b.id}/submit`).set('Authorization', `Bearer ${rndAuthorToken}`).expect(201);
      await http().post(`/boms/${b.id}/approve`).set('Authorization', `Bearer ${rndHeadToken}`).expect(201);
      return b;
    }
    // Release deepest-first so each parent's children already have released BOMs
    // (not required by the gate, but mirrors real practice).
    await releaseBom(comp.id, [{ itemId: raw.id, quantityPerUnit: 4, unitOfMeasure: 'kg' }]);
    await releaseBom(sub.id, [{ itemId: comp.id, quantityPerUnit: 3, unitOfMeasure: 'ea' }]);
    await releaseBom(fg.itemId, [{ itemId: sub.id, quantityPerUnit: 2, unitOfMeasure: 'ea' }]);

    // Stock 300 RAW → covers 240.
    await http().post('/inventory/adjustments').set('Authorization', `Bearer ${storeToken}`)
      .send({ itemId: raw.id, storeLocationId: storeId, quantityChange: 300, reason: 'seed' }).expect(201);

    const customer = await prisma.customer.create({
      data: { name: `ML Cust ${Date.now()}`, billingAddress: { state: 'KA' }, ownerId: superAdminId },
    });
    createdCustomerIds.push(customer.id);
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-ML-${Date.now()}`, customerId: customer.id, status: 'CONFIRMED',
        totalAmount: '1000', ownerId: superAdminId,
        lineItems: { create: [{ productId: fg.productId, quantity: '10', unitPrice: '1000', lineTotal: '10000' }] },
      },
    });
    createdOrderIds.push(order.id);
    await prisma.orderConfirmationSheet.create({
      data: {
        orderId: order.id, confirmationNumber: `OC-ML-${Date.now()}`, revisionNumber: 1,
        status: 'EXECUTED', createdById: superAdminId, requirementsOverview: 'x',
        deliveryDate: new Date('2099-01-01'), deliveryLocation: 'BLR', deliveryType: 'FULL_TRUCKLOAD',
        warrantyTerms: '12m', paymentMilestones: '100%', packagingType: 'crate',
        protectiveMeasures: 'none', labelingRequirements: 'none', customerContactName: 'A',
        customerContactPhone: '+910000000000', customerContactEmail: 'a@b.com',
      },
    });
    const kickoff = (
      await http().post('/project-kickoffs').set('Authorization', `Bearer ${superAdminToken}`)
        .send({ orderId: order.id, meetingDate: '2026-08-01T10:00:00.000Z' }).expect(201)
    ).body.data;

    const report = (
      await http()
        .post(`/project-kickoffs/${kickoff.id}/stock-availability/generate`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(201)
    ).body.data;

    // The report must show ONLY the RAW leaf (SUB/COMP are intermediate, exploded
    // through — NOT listed), at the fully multiplied 240, and AVAILABLE (300≥240).
    expect(report.rows).toHaveLength(1);
    const rawRow = report.rows[0];
    expect(rawRow.itemCode).toBe(raw.itemCode);
    expect(rawRow.grossRequirement).toBe('240');
    expect(rawRow.availabilityStatus).toBe('AVAILABLE');
    // SUB/COMP are not requirements themselves.
    expect(report.rows.some((r: { itemCode: string }) => r.itemCode === sub.itemCode)).toBe(false);
    expect(report.rows.some((r: { itemCode: string }) => r.itemCode === comp.itemCode)).toBe(false);
  });

  it('refuses to generate a report when no released BOM exists', async () => {
    const customer = await prisma.customer.create({
      data: { name: `NB Cust ${Date.now()}`, billingAddress: { state: 'KA' }, ownerId: superAdminId },
    });
    createdCustomerIds.push(customer.id);
    const { productId } = await createProduct(); // no BOM at all
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-NB-${Date.now()}`,
        customerId: customer.id,
        status: 'CONFIRMED',
        totalAmount: '1000',
        ownerId: superAdminId,
        lineItems: { create: [{ productId, quantity: '1', unitPrice: '1000', lineTotal: '1000' }] },
      },
    });
    createdOrderIds.push(order.id);
    await prisma.orderConfirmationSheet.create({
      data: {
        orderId: order.id, confirmationNumber: `OC-NB-${Date.now()}`, revisionNumber: 1,
        status: 'EXECUTED', createdById: superAdminId, requirementsOverview: 'x',
        deliveryDate: new Date('2099-01-01'), deliveryLocation: 'BLR', deliveryType: 'FULL_TRUCKLOAD',
        warrantyTerms: '12m', paymentMilestones: '100%', packagingType: 'crate',
        protectiveMeasures: 'none', labelingRequirements: 'none', customerContactName: 'A',
        customerContactPhone: '+910000000000', customerContactEmail: 'a@b.com',
      },
    });
    const kickoff = (
      await http().post('/project-kickoffs').set('Authorization', `Bearer ${superAdminToken}`)
        .send({ orderId: order.id, meetingDate: '2026-08-01T10:00:00.000Z' }).expect(201)
    ).body.data;
    await http()
      .post(`/project-kickoffs/${kickoff.id}/stock-availability/generate`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(400);
  });
});
