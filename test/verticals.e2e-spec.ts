import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * Covers GET /verticals/me — the endpoint the client-side vertical-staff
 * nav hooks (useIsHrStaff / useIsSalesStaff) rely on. The original bug:
 * those hooks called the ADMIN-only GET /verticals, which 403s for the very
 * HR/Sales Manager/Employee they're meant to detect, silently hiding their
 * nav. These tests assert /verticals/me is readable by a non-admin and
 * returns their own vertical (with its code), while /verticals stays
 * admin-only. Requires a running, migrated, seeded Postgres.
 */
describe('Verticals (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let hrVerticalId: string;
  let salesVerticalId: string;
  let superAdminId: string;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const createdEmployeeIds: string[] = [];

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken;
  }

  async function createActiveEmployee(verticalId: string): Promise<string> {
    const suffix = Date.now() + Math.floor(Math.random() * 100000);
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Vert',
        lastName: 'Tester',
        email: `vert.tester.${suffix}@peoplehub.local`,
        password: 'S3curePass!',
        role: 'EMPLOYEE',
        verticalId,
        reportingManagerId: superAdminId,
      })
      .expect(201);
    createdEmployeeIds.push(res.body.data.id);
    return login(res.body.data.email, 'S3curePass!');
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

    hrVerticalId = (
      await prisma.vertical.findUniqueOrThrow({ where: { code: 'HR' } })
    ).id;
    salesVerticalId = (
      await prisma.vertical.findUniqueOrThrow({ where: { code: 'SALES' } })
    ).id;
    superAdminId = (
      await prisma.employee.findUniqueOrThrow({ where: { email: adminEmail } })
    ).id;

    adminToken = await login(adminEmail, adminPassword);
  });

  afterAll(async () => {
    if (createdEmployeeIds.length > 0) {
      await prisma.employee.deleteMany({
        where: { id: { in: createdEmployeeIds } },
      });
    }
    await app.close();
  });

  it('lets a non-admin HR-vertical employee read their own vertical via /verticals/me', async () => {
    // This is the exact case the useIsHrStaff bug silently broke.
    const hrToken = await createActiveEmployee(hrVerticalId);
    const res = await request(app.getHttpServer())
      .get('/verticals/me')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);
    expect(res.body.data.code).toBe('HR');
    expect(res.body.data.id).toBe(hrVerticalId);
  });

  it('returns the SALES code for a non-admin Sales-vertical employee', async () => {
    const salesToken = await createActiveEmployee(salesVerticalId);
    const res = await request(app.getHttpServer())
      .get('/verticals/me')
      .set('Authorization', `Bearer ${salesToken}`)
      .expect(200);
    expect(res.body.data.code).toBe('SALES');
  });

  it('allows HR-vertical staff to list all verticals (needed for the onboard/roster screens)', async () => {
    const hrToken = await createActiveEmployee(hrVerticalId);
    const res = await request(app.getHttpServer())
      .get('/verticals')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);
    // HR onboards into ANY vertical, so they must see the full list.
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(1);
  });

  it('forbids a non-HR, non-admin employee from the full GET /verticals list', async () => {
    const salesToken = await createActiveEmployee(salesVerticalId);
    await request(app.getHttpServer())
      .get('/verticals')
      .set('Authorization', `Bearer ${salesToken}`)
      .expect(403);
  });

  it('returns null for a user with no vertical (SUPER_ADMIN)', async () => {
    const res = await request(app.getHttpServer())
      .get('/verticals/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.data).toBeNull();
  });
});
