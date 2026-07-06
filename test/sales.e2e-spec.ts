import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLog, Prisma } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * End-to-end coverage for the Sales module: the full pipeline
 * (lead → qualify → convert → opportunity → bid with a >10% discount →
 * escalated manager approval → accept → convert to order → status
 * progression), plus the key access rules (Sales-vertical scoping, plain
 * ADMIN blocked, vertical-wide READ visibility with owner-scoped WRITES)
 * and year-prefixed numbering.
 * Requires a running, migrated, seeded Postgres.
 */
describe('Sales (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string; // seeded SUPER_ADMIN
  let salesVerticalId: string;
  let superAdminId: string;

  let managerToken: string;
  let repToken: string;
  let managerId: string;
  let repId: string;

  // A second EMPLOYEE reporting to the same manager: a peer of `rep`, and
  // deliberately NOT in rep's downstream team (nor rep in theirs). Used to
  // prove vertical-wide READ visibility while write-scope stays owner-bound.
  let peerRepToken: string;
  let peerRepId: string;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const createdEmployeeIds: string[] = [];
  const createdCustomerIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdBidIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdOpportunityIds: string[] = [];
  const createdLeadIds: string[] = [];
  const createdTaxConfigIds: string[] = [];

  async function waitForAuditLog(
    where: Prisma.AuditLogWhereInput,
    predicate: (row: AuditLog) => boolean = () => true,
  ) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const row = await prisma.auditLog.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
      });
      if (row && predicate(row)) {
        return row;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken;
  }

  async function createEmployee(body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);
    createdEmployeeIds.push(res.body.data.id);
    return res.body.data;
  }

  /**
   * Clears the Bid/No-Bid gate for an opportunity: the rep submits an
   * assessment answering every active question, then the reviewer
   * (SUPER_ADMIN fallback here) approves it. Returns the assessment id.
   */
  async function passBidGate(opportunityId: string): Promise<string> {
    const questionsRes = await request(app.getHttpServer())
      .get('/bid-assessment-questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const questions = questionsRes.body.data as Array<{
      id: string;
      type: string;
      options: string[] | null;
    }>;
    const answers = questions.map((q) => ({
      questionId: q.id,
      answerValue:
        q.type === 'BOOLEAN'
          ? 'true'
          : q.type === 'SCALE'
            ? '4'
            : q.type === 'SELECT'
              ? (q.options?.[0] ?? 'n/a')
              : 'ok',
    }));
    const submitRes = await request(app.getHttpServer())
      .post(`/opportunities/${opportunityId}/bid-assessment`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ answers })
      .expect(201);
    const assessmentId = submitRes.body.data.id;
    await request(app.getHttpServer())
      .patch(`/bid-assessments/${assessmentId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reviewerComments: 'Go' })
      .expect(200);
    return assessmentId;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
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
    adminToken = await login(adminEmail, adminPassword);

    const suffix = Date.now();
    const manager = await createEmployee({
      firstName: 'Sam',
      lastName: 'SalesMgr',
      email: `sam.mgr.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });
    managerId = manager.id;
    const rep = await createEmployee({
      firstName: 'Ella',
      lastName: 'SalesRep',
      email: `ella.rep.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: salesVerticalId,
      reportingManagerId: managerId,
    });
    repId = rep.id;

    const peerRep = await createEmployee({
      firstName: 'Peer',
      lastName: 'SalesRep',
      email: `peer.rep.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: salesVerticalId,
      reportingManagerId: managerId,
    });
    peerRepId = peerRep.id;

    managerToken = await login(manager.email, 'S3curePass!');
    repToken = await login(rep.email, 'S3curePass!');
    peerRepToken = await login(peerRep.email, 'S3curePass!');
  });

  afterAll(async () => {
    await prisma.orderLineItem.deleteMany({
      where: { orderId: { in: createdOrderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.bidLineItem.deleteMany({
      where: { bidId: { in: createdBidIds } },
    });
    await prisma.bid.deleteMany({ where: { id: { in: createdBidIds } } });
    await prisma.opportunity.deleteMany({
      where: { id: { in: createdOpportunityIds } },
    });
    await prisma.lead.deleteMany({ where: { id: { in: createdLeadIds } } });
    await prisma.customerContact.deleteMany({
      where: { customerId: { in: createdCustomerIds } },
    });
    await prisma.customer.deleteMany({
      where: { id: { in: createdCustomerIds } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: createdProductIds } },
    });
    await prisma.taxConfig.deleteMany({
      where: { id: { in: createdTaxConfigIds } },
    });
    // Clean the two employees created here + any customers they own from
    // lead conversion (owned by rep, tracked separately below is not needed
    // since conversion customers are captured in createdCustomerIds).
    await prisma.customer.deleteMany({
      where: { ownerId: { in: createdEmployeeIds } },
    });
    if (createdEmployeeIds.length > 0) {
      await prisma.employee.deleteMany({
        where: { id: { in: createdEmployeeIds } },
      });
    }
    await app.close();
  });

  it('blocks a plain ADMIN from Sales operational data', async () => {
    const suffix = Date.now();
    const plainAdmin = await createEmployee({
      firstName: 'Pat',
      lastName: 'PlainAdmin',
      email: `pat.admin.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'ADMIN',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });
    const adminOnlyToken = await login(plainAdmin.email, 'S3curePass!');
    await request(app.getHttpServer())
      .get('/leads')
      .set('Authorization', `Bearer ${adminOnlyToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/bids')
      .set('Authorization', `Bearer ${adminOnlyToken}`)
      .expect(403);
  });

  it('runs the full pipeline: lead → opportunity → bid(>10%) → escalated approval → order', async () => {
    const suffix = Date.now();

    // Manager seeds a GST rate + a product.
    const taxRes = await request(app.getHttpServer())
      .post('/tax-config')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        taxType: 'IGST',
        rate: 18,
        effectiveFrom: '2026-01-01',
        sourceNote: 'Demo rate — Finance verified',
      })
      .expect(201);
    createdTaxConfigIds.push(taxRes.body.data.id);

    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        sku: `LC25-${suffix}`,
        name: 'Liquid Cooling LC25',
        unitPrice: 125000,
        unitOfMeasure: 'each',
        hsnCode: '8419',
      })
      .expect(201);
    const productId = productRes.body.data.id;
    createdProductIds.push(productId);

    // Rep is view-only on products.
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        sku: `X-${suffix}`,
        name: 'x',
        unitPrice: 1,
        unitOfMeasure: 'each',
      })
      .expect(403);

    // Rep creates a lead → year-prefixed number.
    const leadRes = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        companyName: 'Globex Mfg',
        contactName: 'Priya',
        requirement: 'LC25 — 500 nos',
        priority: 'HIGH',
        source: 'EVENT',
      })
      .expect(201);
    const leadId = leadRes.body.data.id;
    createdLeadIds.push(leadId);
    expect(leadRes.body.data.leadNumber).toMatch(/^LD-\d{4}-\d{4}$/);

    // Cannot convert until QUALIFIED.
    await request(app.getHttpServer())
      .post(`/leads/${leadId}/convert`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        opportunityName: 'x',
        estimatedValue: 1,
        expectedCloseDate: '2026-09-30',
        billingAddress: { state: 'Maharashtra' },
      })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/leads/${leadId}`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ status: 'CONTACTED' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/leads/${leadId}`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ status: 'QUALIFIED' })
      .expect(200);

    const convertRes = await request(app.getHttpServer())
      .post(`/leads/${leadId}/convert`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        opportunityName: 'Globex — LC25 supply',
        estimatedValue: 6250000,
        expectedCloseDate: '2026-09-30',
        billingAddress: { state: 'Maharashtra', city: 'Mumbai' },
      })
      .expect(201);
    const opportunityId = convertRes.body.data.id;
    const customerId = convertRes.body.data.customerId;
    createdOpportunityIds.push(opportunityId);
    createdCustomerIds.push(customerId);

    // Lead is now CONVERTED and linked.
    const leadAfter = await request(app.getHttpServer())
      .get(`/leads/${leadId}`)
      .set('Authorization', `Bearer ${repToken}`)
      .expect(200);
    expect(leadAfter.body.data.status).toBe('CONVERTED');
    expect(leadAfter.body.data.convertedToOpportunityId).toBe(opportunityId);

    // Bid creation is gated until an approved Bid/No-Bid assessment exists.
    await request(app.getHttpServer())
      .post('/bids')
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        opportunityId,
        customerId,
        validUntil: '2026-10-31',
        discountPercent: 15,
        lineItems: [{ productId, quantity: 500 }],
      })
      .expect(400);

    // Rep submits the questionnaire; reviewer approves — the gate opens.
    await passBidGate(opportunityId);

    // Rep creates a bid with a 15% discount.
    const bidRes = await request(app.getHttpServer())
      .post('/bids')
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        opportunityId,
        customerId,
        validUntil: '2026-10-31',
        tenderReferenceNumber: 'TENDER/2026/0042',
        technicalSpecification: 'LC25 configuration…',
        discountPercent: 15,
        lineItems: [{ productId, quantity: 500 }],
      })
      .expect(201);
    const bidId = bidRes.body.data.id;
    createdBidIds.push(bidId);
    expect(bidRes.body.data.bidNumber).toMatch(/^BID-\d{4}-\d{4}$/);
    expect(bidRes.body.data.createdById).toBe(repId);
    // Money math: 500*125000 = 62,500,000; -15% = 53,125,000; +18% IGST.
    expect(bidRes.body.data.subtotal).toBe('62500000');
    expect(bidRes.body.data.discountAmount).toBe('9375000');
    expect(bidRes.body.data.taxType).toBe('IGST');
    expect(bidRes.body.data.taxAmount).toBe('9562500');
    expect(bidRes.body.data.totalAmount).toBe('62687500');
    // Price snapshot, not a live reference.
    expect(bidRes.body.data.lineItems[0].unitPrice).toBe('125000');
    // Line items resolve the product name/SKU for display (not just the FK).
    expect(bidRes.body.data.lineItems[0].productName).toBe(
      'Liquid Cooling LC25',
    );
    expect(bidRes.body.data.lineItems[0].productSku).toBe(`LC25-${suffix}`);

    // Submit → routes to PENDING_APPROVAL (discount > 10%).
    const submitRes = await request(app.getHttpServer())
      .patch(`/bids/${bidId}/submit`)
      .set('Authorization', `Bearer ${repToken}`)
      .expect(200);
    expect(submitRes.body.data.status).toBe('PENDING_APPROVAL');
    expect(submitRes.body.data.approverId).toBe(managerId);

    // The bid appears in the manager's approval queue…
    const mgrQueue = await request(app.getHttpServer())
      .get('/bids/pending-approval?page=1&limit=100')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    expect(
      mgrQueue.body.data.items.some((b: { id: string }) => b.id === bidId),
    ).toBe(true);

    // …but NOT in the rep's own queue (self-exclusion).
    const repQueue = await request(app.getHttpServer())
      .get('/bids/pending-approval?page=1&limit=100')
      .set('Authorization', `Bearer ${repToken}`)
      .expect(200);
    expect(
      repQueue.body.data.items.some((b: { id: string }) => b.id === bidId),
    ).toBe(false);

    // Rep cannot approve their own bid.
    await request(app.getHttpServer())
      .patch(`/bids/${bidId}/approve`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({})
      .expect(403);

    // Manager (escalated approver) approves.
    const approveRes = await request(app.getHttpServer())
      .patch(`/bids/${bidId}/approve`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ approverComments: 'OK — strategic account' })
      .expect(200);
    expect(approveRes.body.data.status).toBe('APPROVED');

    // Rep sends then records customer acceptance.
    await request(app.getHttpServer())
      .patch(`/bids/${bidId}/status`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ status: 'SENT' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/bids/${bidId}/status`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ status: 'ACCEPTED' })
      .expect(200);

    // Convert to order.
    const orderRes = await request(app.getHttpServer())
      .post(`/bids/${bidId}/convert-to-order`)
      .set('Authorization', `Bearer ${repToken}`)
      .expect(201);
    const orderId = orderRes.body.data.id;
    createdOrderIds.push(orderId);
    expect(orderRes.body.data.orderNumber).toMatch(/^ORD-\d{4}-\d{4}$/);
    expect(orderRes.body.data.status).toBe('CONFIRMED');
    expect(orderRes.body.data.lineItems[0].lineTotal).toBe('62500000');
    // Order line items also resolve the product name/SKU for display.
    expect(orderRes.body.data.lineItems[0].productName).toBe(
      'Liquid Cooling LC25',
    );
    expect(orderRes.body.data.lineItems[0].productSku).toBe(`LC25-${suffix}`);
    // Booked value snapshotted from the accepted bid's total.
    expect(orderRes.body.data.totalAmount).toBe('62687500');

    // Status progression + illegal-skip guard.
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ status: 'IN_PRODUCTION' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ status: 'DELIVERED' })
      .expect(400);

    // Manager sees the rep's bid (vertical-wide read visibility).
    const mgrBids = await request(app.getHttpServer())
      .get('/bids?page=1&limit=50')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    expect(
      mgrBids.body.data.items.some((b: { id: string }) => b.id === bidId),
    ).toBe(true);

    // Audit trail captured the approval.
    const audit = await waitForAuditLog({
      entity: 'Bid',
      entityId: bidId,
      action: { contains: 'approve' },
    });
    expect(audit).not.toBeNull();
  });

  it("lets a peer EMPLOYEE READ another rep's records but not WRITE them", async () => {
    // `rep` creates a lead they own.
    const leadRes = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        companyName: 'Initech',
        contactName: 'Bill',
        requirement: 'Peer-visibility fixture',
      })
      .expect(201);
    const leadId = leadRes.body.data.id;
    createdLeadIds.push(leadId);
    expect(leadRes.body.data.ownerId).toBe(repId);

    // Peer rep (not in rep's team, nor rep in theirs) can now SEE the lead
    // in the list — vertical-wide read visibility.
    const peerList = await request(app.getHttpServer())
      .get('/leads?page=1&limit=100')
      .set('Authorization', `Bearer ${peerRepToken}`)
      .expect(200);
    expect(
      peerList.body.data.items.some((l: { id: string }) => l.id === leadId),
    ).toBe(true);

    // …and read the detail directly.
    const peerDetail = await request(app.getHttpServer())
      .get(`/leads/${leadId}`)
      .set('Authorization', `Bearer ${peerRepToken}`)
      .expect(200);
    expect(peerDetail.body.data.id).toBe(leadId);
    expect(peerDetail.body.data.ownerId).toBe(repId);
    expect(peerDetail.body.data.ownerId).not.toBe(peerRepId);

    // But the peer STILL cannot edit a lead they don't own (write-scope
    // unchanged: owner/hierarchy only).
    await request(app.getHttpServer())
      .patch(`/leads/${leadId}`)
      .set('Authorization', `Bearer ${peerRepToken}`)
      .send({ status: 'CONTACTED' })
      .expect(403);

    // The owning rep can still edit it.
    await request(app.getHttpServer())
      .patch(`/leads/${leadId}`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ status: 'CONTACTED' })
      .expect(200);
  });

  it('sends a <=10% discount bid straight to SENT without approval', async () => {
    const suffix = Date.now();
    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        sku: `SM-${suffix}`,
        name: 'Small item',
        unitPrice: 1000,
        unitOfMeasure: 'each',
      })
      .expect(201);
    createdProductIds.push(productRes.body.data.id);

    const oppRes = await request(app.getHttpServer())
      .post('/opportunities')
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        name: 'Direct opp',
        estimatedValue: 10000,
        expectedCloseDate: '2026-12-31',
      })
      .expect(201);
    createdOpportunityIds.push(oppRes.body.data.id);

    const custRes = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        name: 'Direct Cust',
        billingAddress: { state: 'Karnataka' },
      })
      .expect(201);
    createdCustomerIds.push(custRes.body.data.id);

    await passBidGate(oppRes.body.data.id);

    const bidRes = await request(app.getHttpServer())
      .post('/bids')
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        opportunityId: oppRes.body.data.id,
        customerId: custRes.body.data.id,
        validUntil: '2026-11-30',
        discountPercent: 5,
        lineItems: [{ productId: productRes.body.data.id, quantity: 10 }],
      })
      .expect(201);
    createdBidIds.push(bidRes.body.data.id);

    const submitRes = await request(app.getHttpServer())
      .patch(`/bids/${bidRes.body.data.id}/submit`)
      .set('Authorization', `Bearer ${repToken}`)
      .expect(200);
    expect(submitRes.body.data.status).toBe('SENT');
    expect(submitRes.body.data.approverId).toBeNull();
  });
});
