import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { EmployeeStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * End-to-end coverage for the Employee & Access Management module: admin
 * onboards a 3-level hierarchy, a mid-level manager's team query must include
 * indirect reports, and deactivation preserves historical attribution.
 * Requires a running, migrated, seeded Postgres (see README).
 */
describe('Employees (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let verticalId: string;
  let superAdminId: string;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const createdIds: string[] = [];

  async function createEmployee(body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);
    createdIds.push(res.body.data.id);
    return res.body.data;
  }

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken;
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

    const vertical = await prisma.vertical.findFirstOrThrow();
    verticalId = vertical.id;
    const superAdmin = await prisma.employee.findUniqueOrThrow({
      where: { email: adminEmail },
    });
    superAdminId = superAdmin.id;

    adminToken = await login(adminEmail, adminPassword);
  });

  afterAll(async () => {
    // cleanup in reverse-dependency order (reports before managers)
    for (const id of createdIds.reverse()) {
      await prisma.employee.deleteMany({ where: { id } });
    }
    await app.close();
  });

  it('includes both direct and indirect reports in a 3-level hierarchy', async () => {
    const password = 'S3curePass!';
    const suffix = Date.now();

    const managerRes = await createEmployee({
      firstName: 'Top',
      lastName: 'Manager',
      email: `top-mgr-${suffix}@peoplehub.local`,
      password,
      role: 'MANAGER',
      verticalId,
      reportingManagerId: superAdminId,
    });

    const reportARes = await createEmployee({
      firstName: 'Report',
      lastName: 'A',
      email: `report-a-${suffix}@peoplehub.local`,
      password,
      role: 'MANAGER',
      verticalId,
      reportingManagerId: managerRes.id,
    });

    const reportBRes = await createEmployee({
      firstName: 'Report',
      lastName: 'B',
      email: `report-b-${suffix}@peoplehub.local`,
      password,
      role: 'EMPLOYEE',
      verticalId,
      reportingManagerId: reportARes.id,
    });

    const managerToken = await login(managerRes.email, password);

    const teamRes = await request(app.getHttpServer())
      .get(`/employees/${managerRes.id}/team`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    const teamIds = teamRes.body.data.map((e: { id: string }) => e.id);
    expect(teamIds).toContain(reportARes.id);
    expect(teamIds).toContain(reportBRes.id); // indirect report — the case a naive impl misses
    expect(teamIds).not.toContain(managerRes.id);
  });

  it('forbids a manager from viewing another manager’s team', async () => {
    const password = 'S3curePass!';
    const suffix = Date.now();

    const managerA = await createEmployee({
      firstName: 'Manager',
      lastName: 'A',
      email: `mgr-a-${suffix}@peoplehub.local`,
      password,
      role: 'MANAGER',
      verticalId,
      reportingManagerId: superAdminId,
    });

    const managerB = await createEmployee({
      firstName: 'Manager',
      lastName: 'B',
      email: `mgr-b-${suffix}@peoplehub.local`,
      password,
      role: 'MANAGER',
      verticalId,
      reportingManagerId: superAdminId,
    });

    const managerAToken = await login(managerA.email, password);

    await request(app.getHttpServer())
      .get(`/employees/${managerB.id}/team`)
      .set('Authorization', `Bearer ${managerAToken}`)
      .expect(403);
  });

  it('deactivate is a soft delete: historical audit attribution survives', async () => {
    const suffix = Date.now();
    const target = await createEmployee({
      firstName: 'ToDeactivate',
      lastName: 'Employee',
      email: `deactivate-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId,
      reportingManagerId: superAdminId,
    });

    await request(app.getHttpServer())
      .patch(`/employees/${target.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const reloaded = await prisma.employee.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(reloaded.status).toBe(EmployeeStatus.INACTIVE);
    expect(reloaded.deactivatedAt).not.toBeNull();

    // The employee row still exists (soft delete), so any audit log
    // referencing them as actor/entity still resolves via the FK.
    const stillResolvable = await prisma.employee.findUnique({
      where: { id: target.id },
    });
    expect(stillResolvable).not.toBeNull();

    const deactivateAudit = await prisma.auditLog.findFirst({
      where: {
        entity: 'Employee',
        entityId: target.id,
        action: { contains: 'deactivate' },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(deactivateAudit).not.toBeNull();
  });

  it('EMPLOYEE cannot use the team endpoint at all', async () => {
    const suffix = Date.now();
    const employee = await createEmployee({
      firstName: 'Plain',
      lastName: 'Employee',
      email: `plain-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId,
      reportingManagerId: superAdminId,
    });
    const employeeToken = await login(employee.email, 'S3curePass!');

    await request(app.getHttpServer())
      .get(`/employees/${employee.id}/team`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(403);
  });

  // ── Permanent (hard) delete — SUPER_ADMIN only ──────────────────────
  it('SUPER_ADMIN permanently deletes an unreferenced employee (204, row gone)', async () => {
    const suffix = Date.now();
    const target = await createEmployee({
      firstName: 'Duplicate',
      lastName: 'Account',
      email: `harddelete-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId,
      reportingManagerId: superAdminId,
    });

    await request(app.getHttpServer())
      .delete(`/employees/${target.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const gone = await prisma.employee.findUnique({
      where: { id: target.id },
    });
    expect(gone).toBeNull();
  });

  it('refuses to hard-delete an employee who still has direct reports, naming the blocker', async () => {
    const suffix = Date.now();
    const manager = await createEmployee({
      firstName: 'HasReports',
      lastName: 'Manager',
      email: `hasreports-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId,
      reportingManagerId: superAdminId,
    });
    await createEmployee({
      firstName: 'Report',
      lastName: 'Under',
      email: `report-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId,
      reportingManagerId: manager.id,
    });

    const res = await request(app.getHttpServer())
      .delete(`/employees/${manager.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    expect(res.body.message).toContain('1 direct report');
    expect(res.body.message).toContain('Deactivate them instead');

    // Row untouched.
    const still = await prisma.employee.findUnique({
      where: { id: manager.id },
    });
    expect(still).not.toBeNull();
  });

  it('a non-SUPER_ADMIN (ADMIN) cannot hard-delete (403)', async () => {
    const suffix = Date.now();
    const admin = await createEmployee({
      firstName: 'Plain',
      lastName: 'Admin',
      email: `plainadmin-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'ADMIN',
      verticalId,
      reportingManagerId: superAdminId,
    });
    const adminOnlyToken = await login(admin.email, 'S3curePass!');
    const victim = await createEmployee({
      firstName: 'Victim',
      lastName: 'Employee',
      email: `victim-${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId,
      reportingManagerId: superAdminId,
    });

    await request(app.getHttpServer())
      .delete(`/employees/${victim.id}`)
      .set('Authorization', `Bearer ${adminOnlyToken}`)
      .expect(403);
  });
});
