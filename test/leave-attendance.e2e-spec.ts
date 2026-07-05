import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLog, Prisma } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * End-to-end coverage for the Leave & Attendance module: submit → manager
 * approval → balance deduction → cancellation → balance restoration; the
 * manager-requesting-their-own-leave escalation case explicitly (routes to
 * their own manager, not self-approvable); SUPER_ADMIN auto-approval;
 * overlap rejection; check-in/check-out; Admin manual attendance
 * correction with an audit before/after diff; and the manual accrual
 * endpoint's idempotency. Requires a running, migrated, seeded Postgres.
 */
describe('Leave & Attendance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let salesVerticalId: string;
  let superAdminId: string;
  let clTypeId: string;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const createdEmployeeIds: string[] = [];

  /**
   * AuditInterceptor writes are fire-and-forget (never block the response
   * — see audit.interceptor.ts), so a query issued immediately after a
   * request can race ahead of the write, or (when multiple mutations hit
   * the same entity back-to-back) return an earlier write before a later
   * one has landed. Poll until `predicate` accepts a matching row rather
   * than asserting on the first read.
   */
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

    const clType = await prisma.leaveType.findUniqueOrThrow({
      where: { code: 'CL' },
    });
    clTypeId = clType.id;

    adminToken = await login(adminEmail, adminPassword);
  });

  afterAll(async () => {
    // Clean up dependents before employees (FK order), then employees.
    if (createdEmployeeIds.length > 0) {
      await prisma.leaveRequest.deleteMany({
        where: { employeeId: { in: createdEmployeeIds } },
      });
      await prisma.attendance.deleteMany({
        where: { employeeId: { in: createdEmployeeIds } },
      });
      await prisma.leaveBalance.deleteMany({
        where: { employeeId: { in: createdEmployeeIds } },
      });
      await prisma.employee.deleteMany({
        where: { id: { in: createdEmployeeIds } },
      });
    }
    await app.close();
  });

  it('full cycle: submit → manager approves → balance deducted → cancel → balance restored', async () => {
    const suffix = Date.now();
    const manager = await createEmployee({
      firstName: 'Cycle',
      lastName: 'Manager',
      email: `cycle-mgr-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });
    const employee = await createEmployee({
      firstName: 'Cycle',
      lastName: 'Employee',
      email: `cycle-emp-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: salesVerticalId,
      reportingManagerId: manager.id,
    });

    const employeeToken = await login(employee.email, 'S3curePass!');
    const managerToken = await login(manager.email, 'S3curePass!');

    const createRes = await request(app.getHttpServer())
      .post('/leave-requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        leaveTypeId: clTypeId,
        startDate: '2026-08-10',
        endDate: '2026-08-12',
        numberOfDays: 3,
        reason: 'Family function',
      })
      .expect(201);
    expect(createRes.body.data.status).toBe('PENDING');
    const requestId = createRes.body.data.id;

    await request(app.getHttpServer())
      .patch(`/leave-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ approverComments: 'Approved' })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.status).toBe('APPROVED');
      });

    const balanceAfterApprove = await request(app.getHttpServer())
      .get('/leave-balances/me')
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);
    const clBalance = balanceAfterApprove.body.data.find(
      (b: { leaveTypeCode: string }) => b.leaveTypeCode === 'CL',
    );
    expect(clBalance.used).toBe('3');
    expect(clBalance.remaining).toBe('9');

    await request(app.getHttpServer())
      .patch(`/leave-requests/${requestId}/cancel`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.data.status).toBe('CANCELLED');
      });

    const balanceAfterCancel = await request(app.getHttpServer())
      .get('/leave-balances/me')
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);
    const clBalanceRestored = balanceAfterCancel.body.data.find(
      (b: { leaveTypeCode: string }) => b.leaveTypeCode === 'CL',
    );
    expect(clBalanceRestored.used).toBe('0');
    expect(clBalanceRestored.remaining).toBe('12');
  });

  it('a manager’s own leave request routes to their manager, not self-approvable', async () => {
    const suffix = Date.now();
    const seniorManager = await createEmployee({
      firstName: 'Senior',
      lastName: 'Manager',
      email: `senior-mgr-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });
    const midManager = await createEmployee({
      firstName: 'Mid',
      lastName: 'Manager',
      email: `mid-mgr-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVerticalId,
      reportingManagerId: seniorManager.id,
    });

    const midToken = await login(midManager.email, 'S3curePass!');
    const seniorToken = await login(seniorManager.email, 'S3curePass!');

    const createRes = await request(app.getHttpServer())
      .post('/leave-requests')
      .set('Authorization', `Bearer ${midToken}`)
      .send({
        leaveTypeId: clTypeId,
        startDate: '2026-09-01',
        endDate: '2026-09-01',
        numberOfDays: 1,
        reason: 'Personal',
      })
      .expect(201);
    const requestId = createRes.body.data.id;

    // Self-approval must be blocked even though the requester is a manager.
    await request(app.getHttpServer())
      .patch(`/leave-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${midToken}`)
      .send({})
      .expect(403);

    // It must appear in the senior manager's queue, not the mid manager's own.
    const pendingForSenior = await request(app.getHttpServer())
      .get('/leave-requests/pending-approval')
      .set('Authorization', `Bearer ${seniorToken}`)
      .expect(200);
    const ids = pendingForSenior.body.data.items.map(
      (r: { id: string }) => r.id,
    );
    expect(ids).toContain(requestId);

    await request(app.getHttpServer())
      .patch(`/leave-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${seniorToken}`)
      .send({})
      .expect(200)
      .expect((res) => {
        expect(res.body.data.status).toBe('APPROVED');
        expect(res.body.data.approverId).toBe(seniorManager.id);
      });
  });

  it('SUPER_ADMIN leave requests auto-approve immediately and are audited', async () => {
    const res = await request(app.getHttpServer())
      .post('/leave-requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        leaveTypeId: clTypeId,
        startDate: '2026-10-01',
        endDate: '2026-10-01',
        numberOfDays: 1,
        reason: 'Personal',
      })
      .expect(201);

    expect(res.body.data.status).toBe('APPROVED');
    expect(res.body.data.approverId).toBeNull();

    const auditRow = await waitForAuditLog({
      entity: 'LeaveRequest',
      action: { contains: 'POST' },
    });
    expect(auditRow).not.toBeNull();

    // Clean up: this request belongs to the seeded super admin, not a
    // per-test-created employee, so it's removed explicitly rather than
    // via the afterAll employee-cascade.
    await prisma.leaveRequest.delete({ where: { id: res.body.data.id } });
    await prisma.leaveBalance.updateMany({
      where: { employeeId: superAdminId },
      data: { used: 0 },
    });
  });

  it('rejects an overlapping leave request', async () => {
    const suffix = Date.now();
    const employee = await createEmployee({
      firstName: 'Overlap',
      lastName: 'Employee',
      email: `overlap-emp-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });
    const token = await login(employee.email, 'S3curePass!');

    await request(app.getHttpServer())
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        leaveTypeId: clTypeId,
        startDate: '2026-11-05',
        endDate: '2026-11-07',
        numberOfDays: 3,
        reason: 'First',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/leave-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        leaveTypeId: clTypeId,
        startDate: '2026-11-06',
        endDate: '2026-11-06',
        numberOfDays: 1,
        reason: 'Overlapping',
      })
      .expect(400);
  });

  it('check-in/check-out happy path, and double check-in is rejected', async () => {
    const suffix = Date.now();
    const employee = await createEmployee({
      firstName: 'Attendance',
      lastName: 'Employee',
      email: `attendance-emp-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });
    const token = await login(employee.email, 'S3curePass!');

    await request(app.getHttpServer())
      .post('/attendance/check-in')
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect((res) => {
        expect(res.body.data.checkInTime).not.toBeNull();
      });

    await request(app.getHttpServer())
      .post('/attendance/check-in')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    await request(app.getHttpServer())
      .post('/attendance/check-out')
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect((res) => {
        expect(res.body.data.status).toBe('PRESENT');
      });
  });

  it('Admin manual attendance correction is audited with a before/after diff', async () => {
    const suffix = Date.now();
    const employee = await createEmployee({
      firstName: 'Correction',
      lastName: 'Employee',
      email: `correction-emp-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });

    const createRes = await request(app.getHttpServer())
      .patch(`/attendance/${employee.id}/2026-07-01`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        checkInTime: '2026-07-01T09:00:00.000Z',
        checkOutTime: '2026-07-01T18:00:00.000Z',
      })
      .expect(200);
    expect(createRes.body.data.status).toBe('PRESENT');

    await request(app.getHttpServer())
      .patch(`/attendance/${employee.id}/2026-07-01`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ checkInTime: '2026-07-01T09:15:00.000Z' })
      .expect(200);

    const auditRow = await waitForAuditLog(
      {
        entity: 'Attendance',
        action: { contains: 'PATCH' },
        entityId: createRes.body.data.id,
      },
      // Wait specifically for the second PATCH's row, not the first.
      (row) => (row.after as any)?.checkInTime === '2026-07-01T09:15:00.000Z',
    );
    expect(auditRow).not.toBeNull();
    expect((auditRow?.before as any)?.checkInTime).toBe(
      '2026-07-01T09:00:00.000Z',
    );
    expect((auditRow?.after as any)?.checkInTime).toBe(
      '2026-07-01T09:15:00.000Z',
    );
  });

  it('manual accrual run credits EL once and a second immediate run is a no-op', async () => {
    const suffix = Date.now();
    const employee = await createEmployee({
      firstName: 'Accrual',
      lastName: 'Employee',
      email: `accrual-emp-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });

    const first = await request(app.getHttpServer())
      .post('/leave-accrual/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(first.body.data.credited).toBeGreaterThan(0);

    const second = await request(app.getHttpServer())
      .post('/leave-accrual/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(second.body.data.credited).toBe(0);

    const balances = await request(app.getHttpServer())
      .get('/leave-balances/me')
      .set(
        'Authorization',
        `Bearer ${await login(employee.email, 'S3curePass!')}`,
      )
      .expect(200);
    const elBalance = balances.body.data.find(
      (b: { leaveTypeCode: string }) => b.leaveTypeCode === 'EL',
    );
    expect(elBalance.allocated).toBe('1.5');
  });
});
