import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLog, Prisma } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * End-to-end coverage for the Bid/No-Bid decision gate:
 *   - bid creation is blocked with no assessment,
 *   - submit → reject (comments required) → resubmit → approve,
 *   - only the most-recent assessment gates bid creation,
 *   - SUPER_ADMIN fallback review when no Sales Head is designated, plus
 *     the designated-Sales-Head path and atomic re-designation.
 * Requires a running, migrated, seeded Postgres (seed loads the question set).
 */
describe('Bid/No-Bid decision gate (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string; // seeded SUPER_ADMIN (fallback reviewer)
  let salesVerticalId: string;
  let superAdminId: string;

  let managerToken: string;
  let managerId: string;
  let repToken: string;
  let repId: string;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const createdEmployeeIds: string[] = [];
  const createdCustomerIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdBidIds: string[] = [];
  const createdOpportunityIds: string[] = [];

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

  async function waitForAuditLog(
    where: Prisma.AuditLogWhereInput,
    predicate: (row: AuditLog) => boolean = () => true,
  ) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const row = await prisma.auditLog.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
      });
      if (row && predicate(row)) return row;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }

  async function createOpportunity(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/opportunities')
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        name: 'Gate test opp',
        estimatedValue: 100000,
        expectedCloseDate: '2027-01-31',
      })
      .expect(201);
    createdOpportunityIds.push(res.body.data.id);
    return res.body.data.id;
  }

  async function createCustomerAndProduct(): Promise<{
    customerId: string;
    productId: string;
  }> {
    const suffix = Date.now();
    const cust = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${repToken}`)
      .send({ name: 'Gate Cust', billingAddress: { state: 'Karnataka' } })
      .expect(201);
    createdCustomerIds.push(cust.body.data.id);
    const prod = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        sku: `GATE-${suffix}`,
        name: 'Gate Product',
        unitPrice: 1000,
        unitOfMeasure: 'each',
      })
      .expect(201);
    createdProductIds.push(prod.body.data.id);
    return { customerId: cust.body.data.id, productId: prod.body.data.id };
  }

  async function answersForActiveQuestions(): Promise<
    Array<{ questionId: string; answerValue: string }>
  > {
    const res = await request(app.getHttpServer())
      .get('/bid-assessment-questions')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return (
      res.body.data as Array<{
        id: string;
        type: string;
        options: string[] | null;
      }>
    ).map((q) => ({
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
      firstName: 'Gate',
      lastName: 'Mgr',
      email: `gate.mgr.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });
    managerId = manager.id;
    const rep = await createEmployee({
      firstName: 'Gate',
      lastName: 'Rep',
      email: `gate.rep.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: salesVerticalId,
      reportingManagerId: managerId,
    });
    repId = rep.id;

    managerToken = await login(manager.email, 'S3curePass!');
    repToken = await login(rep.email, 'S3curePass!');
  });

  afterAll(async () => {
    await prisma.bidLineItem.deleteMany({
      where: { bidId: { in: createdBidIds } },
    });
    await prisma.bid.deleteMany({ where: { id: { in: createdBidIds } } });
    // Assessments + responses cascade from opportunities.
    await prisma.opportunity.deleteMany({
      where: { id: { in: createdOpportunityIds } },
    });
    await prisma.customer.deleteMany({
      where: { id: { in: createdCustomerIds } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: createdProductIds } },
    });
    // Reset any Sales Head designation we set, then remove test employees.
    await prisma.employee.updateMany({
      where: { id: { in: createdEmployeeIds } },
      data: { isSalesHead: false },
    });
    if (createdEmployeeIds.length > 0) {
      await prisma.employee.deleteMany({
        where: { id: { in: createdEmployeeIds } },
      });
    }
    await app.close();
  });

  it('blocks bid creation when the opportunity has no assessment', async () => {
    const opportunityId = await createOpportunity();
    const { customerId, productId } = await createCustomerAndProduct();

    const res = await request(app.getHttpServer())
      .post('/bids')
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        opportunityId,
        customerId,
        validUntil: '2027-02-28',
        lineItems: [{ productId, quantity: 1 }],
      })
      .expect(400);
    expect(res.body.message).toMatch(/approved Bid\/No-Bid assessment/i);
  });

  it('runs the full flow: submit → reject (comments) → resubmit → approve → bid succeeds (SUPER_ADMIN fallback)', async () => {
    // No Sales Head designated at this point → SUPER_ADMIN is the reviewer.
    await prisma.employee.updateMany({
      where: { isSalesHead: true },
      data: { isSalesHead: false },
    });

    const opportunityId = await createOpportunity();
    const { customerId, productId } = await createCustomerAndProduct();
    const answers = await answersForActiveQuestions();
    expect(answers.length).toBeGreaterThan(0);

    // Submit #1.
    const submit1 = await request(app.getHttpServer())
      .post(`/opportunities/${opportunityId}/bid-assessment`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ answers })
      .expect(201);
    const assessment1 = submit1.body.data.id;
    expect(submit1.body.data.status).toBe('PENDING_REVIEW');
    // Question text is snapshotted onto each response.
    expect(submit1.body.data.responses[0].questionTextSnapshot).toEqual(
      expect.any(String),
    );

    // It appears in the reviewer's pending queue.
    const queue = await request(app.getHttpServer())
      .get('/bid-assessments/pending-approval?page=1&limit=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      queue.body.data.items.some((a: { id: string }) => a.id === assessment1),
    ).toBe(true);

    // A plain rep cannot review.
    await request(app.getHttpServer())
      .patch(`/bid-assessments/${assessment1}/approve`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({})
      .expect(403);

    // Reject requires comments.
    await request(app.getHttpServer())
      .patch(`/bid-assessments/${assessment1}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);

    // Reject with comments.
    const rejectRes = await request(app.getHttpServer())
      .patch(`/bid-assessments/${assessment1}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reviewerComments: 'Margin too thin — revise pricing' })
      .expect(200);
    expect(rejectRes.body.data.status).toBe('REJECTED');

    // A rejected assessment still blocks bid creation.
    await request(app.getHttpServer())
      .post('/bids')
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        opportunityId,
        customerId,
        validUntil: '2027-02-28',
        lineItems: [{ productId, quantity: 1 }],
      })
      .expect(400);

    // Resubmit → a NEW assessment (history preserved).
    const submit2 = await request(app.getHttpServer())
      .post(`/opportunities/${opportunityId}/bid-assessment`)
      .set('Authorization', `Bearer ${repToken}`)
      .send({ answers })
      .expect(201);
    const assessment2 = submit2.body.data.id;
    expect(assessment2).not.toBe(assessment1);

    // Approve the new one.
    await request(app.getHttpServer())
      .patch(`/bid-assessments/${assessment2}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reviewerComments: 'Approved to bid' })
      .expect(200);

    // Both assessments still exist (fresh record, not a reopen).
    const history = await prisma.bidDecisionAssessment.count({
      where: { opportunityId },
    });
    expect(history).toBe(2);

    // Now bid creation succeeds.
    const bidRes = await request(app.getHttpServer())
      .post('/bids')
      .set('Authorization', `Bearer ${repToken}`)
      .send({
        opportunityId,
        customerId,
        validUntil: '2027-02-28',
        lineItems: [{ productId, quantity: 1 }],
      })
      .expect(201);
    createdBidIds.push(bidRes.body.data.id);

    // Audit trail captured the approval.
    const audit = await waitForAuditLog({
      entityId: assessment2,
      action: { contains: 'approve' },
    });
    expect(audit).not.toBeNull();
  });

  it('routes to the designated Sales Head, and re-designation is atomic (single holder)', async () => {
    // Designate the manager as Sales Head.
    await request(app.getHttpServer())
      .patch(`/employees/${managerId}/designate-sales-head`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    let heads = await prisma.employee.count({ where: { isSalesHead: true } });
    expect(heads).toBe(1);

    // The Sales Head can see the pending queue; a normal rep still cannot.
    await request(app.getHttpServer())
      .get('/bid-assessments/pending-approval')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/bid-assessments/pending-approval')
      .set('Authorization', `Bearer ${repToken}`)
      .expect(403);

    // Designate the rep instead — the manager must be unset in the same step.
    await request(app.getHttpServer())
      .patch(`/employees/${repId}/designate-sales-head`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    heads = await prisma.employee.count({ where: { isSalesHead: true } });
    expect(heads).toBe(1);
    const stillHead = await prisma.employee.findUnique({
      where: { id: managerId },
      select: { isSalesHead: true },
    });
    expect(stillHead?.isSalesHead).toBe(false);
    const newHead = await prisma.employee.findUnique({
      where: { id: repId },
      select: { isSalesHead: true },
    });
    expect(newHead?.isSalesHead).toBe(true);
  });
});
