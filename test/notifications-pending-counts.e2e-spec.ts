import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * Notifications pending-counts + OCS pending-approval list e2e.
 * Verifies: the new OCS pending list is Sales-Head/SuperAdmin-scoped; the
 * unified counts endpoint returns every key (0 where N/A); and each count
 * matches its category's actual list result (proving the shared query reuse).
 */
describe('Notifications pending-counts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let superAdminToken: string;
  let superAdminId: string;
  let salesHeadToken: string;
  let salesHeadId: string;
  let repToken: string;
  let repId: string;
  let employeeToken: string;
  let employeeId: string;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const createdEmployeeIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];
  const createdLeaveIds: string[] = [];

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken;
  }

  async function mkEmployee(body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send(body)
      .expect(201);
    createdEmployeeIds.push(res.body.data.id);
    return res.body.data;
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

    const salesVertical = await prisma.vertical.findUniqueOrThrow({
      where: { code: 'SALES' },
    });
    superAdminId = (
      await prisma.employee.findUniqueOrThrow({ where: { email: adminEmail } })
    ).id;
    superAdminToken = await login(adminEmail, adminPassword);

    const suffix = Date.now();
    const head = await mkEmployee({
      firstName: 'Notif',
      lastName: 'Head',
      email: `notif.head.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVertical.id,
      reportingManagerId: superAdminId,
    });
    salesHeadId = head.id;
    await request(app.getHttpServer())
      .patch(`/employees/${salesHeadId}/designate-sales-head`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);

    const rep = await mkEmployee({
      firstName: 'Notif',
      lastName: 'Rep',
      email: `notif.rep.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVertical.id,
      reportingManagerId: salesHeadId,
    });
    repId = rep.id;

    // A plain employee who reports to the rep (so the rep is their approver).
    const emp = await mkEmployee({
      firstName: 'Notif',
      lastName: 'Emp',
      email: `notif.emp.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: salesVertical.id,
      reportingManagerId: repId,
    });
    employeeId = emp.id;

    salesHeadToken = await login(head.email, 'S3curePass!');
    repToken = await login(rep.email, 'S3curePass!');
    employeeToken = await login(emp.email, 'S3curePass!');

    // Seed a PENDING leave request from the employee → the rep is the approver
    // (direct report). Untracked leave type avoids balance setup.
    const leaveType = await prisma.leaveType.findFirstOrThrow({
      where: { accrualType: 'UNTRACKED' },
    });
    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId: leaveType.id,
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-01'),
        numberOfDays: 1,
        reason: 'test',
        status: 'PENDING',
      },
    });
    createdLeaveIds.push(leave.id);

    // Seed a CONFIRMED order + an AWAITING_INTERNAL_SIGNATURE confirmation sheet
    // (the Sales Head's OCS queue).
    const customer = await prisma.customer.create({
      data: {
        name: `Notif Cust ${suffix}`,
        billingAddress: { line1: '1 Rd' },
        ownerId: repId,
      },
    });
    createdCustomerIds.push(customer.id);
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-NOTIF-${suffix}`,
        customerId: customer.id,
        status: 'CONFIRMED',
        totalAmount: '1000',
        ownerId: repId,
      },
    });
    createdOrderIds.push(order.id);
    await prisma.orderConfirmationSheet.create({
      data: {
        confirmationNumber: `OC-NOTIF-${suffix}`,
        orderId: order.id,
        revisionNumber: 1,
        status: 'AWAITING_INTERNAL_SIGNATURE',
        requirementsOverview: 'x',
        deliveryDate: new Date('2026-09-01'),
        deliveryLocation: 'x',
        deliveryType: 'FULL_TRUCKLOAD',
        warrantyTerms: 'x',
        paymentMilestones: 'x',
        packagingType: 'x',
        protectiveMeasures: 'x',
        labelingRequirements: 'x',
        customerContactName: 'x',
        customerContactPhone: 'x',
        customerContactEmail: 'x@y.com',
        createdById: repId,
        signedCopyStorageKey: `order-confirmations/x/signed-copy`,
        signedCopyUploadedById: repId,
        signedCopyUploadedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.orderConfirmationSheet.deleteMany({
      where: { orderId: { in: createdOrderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.customer.deleteMany({
      where: { id: { in: createdCustomerIds } },
    });
    await prisma.leaveRequest.deleteMany({
      where: { id: { in: createdLeaveIds } },
    });
    if (createdEmployeeIds.length) {
      await prisma.employee.deleteMany({
        where: { id: { in: createdEmployeeIds } },
      });
    }
    await app.close();
  });

  it('OCS pending-approval list is visible to the Sales Head and hidden from a plain employee', async () => {
    const headList = await request(app.getHttpServer())
      .get('/confirmation-sheets/pending-approval')
      .set('Authorization', `Bearer ${salesHeadToken}`)
      .expect(200);
    // At least our seeded sheet; all rows are AWAITING_INTERNAL_SIGNATURE.
    expect(headList.body.data.length).toBeGreaterThanOrEqual(1);
    expect(
      (headList.body.data as { status: string }[]).every(
        (s) => s.status === 'AWAITING_INTERNAL_SIGNATURE',
      ),
    ).toBe(true);

    // A non-reviewer (plain employee / rep) is forbidden.
    await request(app.getHttpServer())
      .get('/confirmation-sheets/pending-approval')
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(403);
  });

  it('counts endpoint returns all keys and matches each list result', async () => {
    // Sales Head: has OCS + assessment reviewer counts.
    const headCounts = await request(app.getHttpServer())
      .get('/notifications/pending-counts')
      .set('Authorization', `Bearer ${salesHeadToken}`)
      .expect(200);
    const c = headCounts.body.data;
    // Every key present (0 allowed), never omitted.
    for (const key of [
      'leaveApprovals',
      'bidDiscountApprovals',
      'bidAssessmentApprovals',
      'hrPendingAccess',
      'confirmationSheetsPending',
    ]) {
      expect(typeof c[key]).toBe('number');
    }

    // confirmationSheetsPending must equal the actual OCS list length.
    const ocsList = await request(app.getHttpServer())
      .get('/confirmation-sheets/pending-approval')
      .set('Authorization', `Bearer ${salesHeadToken}`)
      .expect(200);
    expect(c.confirmationSheetsPending).toBe(ocsList.body.data.length);
    expect(c.confirmationSheetsPending).toBeGreaterThanOrEqual(1);

    // Sales Head isn't an ADMIN → hrPendingAccess is 0 for them.
    expect(c.hrPendingAccess).toBe(0);

    // The rep is the leave approver for the seeded request → leaveApprovals
    // matches their pending-approval list total.
    const repCounts = await request(app.getHttpServer())
      .get('/notifications/pending-counts')
      .set('Authorization', `Bearer ${repToken}`)
      .expect(200);
    const repLeaveList = await request(app.getHttpServer())
      .get('/leave-requests/pending-approval?page=1&limit=100')
      .set('Authorization', `Bearer ${repToken}`)
      .expect(200);
    expect(repCounts.body.data.leaveApprovals).toBe(
      repLeaveList.body.data.total,
    );
    expect(repCounts.body.data.leaveApprovals).toBeGreaterThanOrEqual(1);
    // Rep isn't a reviewer → OCS + assessment counts are 0.
    expect(repCounts.body.data.confirmationSheetsPending).toBe(0);
    expect(repCounts.body.data.bidAssessmentApprovals).toBe(0);
  });

  it('SUPER_ADMIN hrPendingAccess count matches the pending-access list total', async () => {
    const counts = await request(app.getHttpServer())
      .get('/notifications/pending-counts')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    const list = await request(app.getHttpServer())
      .get('/employees/pending-access?page=1&limit=1')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    expect(counts.body.data.hrPendingAccess).toBe(list.body.data.total);
  });
});
