import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * End-to-end happy-path tests. Requires a running Postgres and a migrated,
 * seeded database (see README). Exercises the auth flow, RBAC, and audit trail.
 */
describe('App (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let refreshCookie: string;
  let verticalId: string;
  let superAdminId: string;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health is public and returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('GET /employees without token → 401', async () => {
    await request(app.getHttpServer()).get('/employees').expect(401);
  });

  it('POST /auth/login returns access token + sets refresh cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword })
      .expect(200);

    expect(res.body.data.accessToken).toBeDefined();
    accessToken = res.body.data.accessToken;

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    refreshCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(refreshCookie).toMatch(/peoplehub_rt=/);
  });

  it('POST /auth/refresh with cookie returns a new access token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);
    expect(res.body.data.accessToken).toBeDefined();
  });

  it('GET /employees with super admin token → 200 list', async () => {
    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('POST /employees creates an employee and writes an audit log with before/after', async () => {
    const email = `e2e-${Date.now()}@peoplehub.local`;
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'E2E',
        lastName: 'Employee',
        email,
        password: 'S3curePass!',
        role: 'MANAGER',
        verticalId,
        reportingManagerId: superAdminId,
      })
      .expect(201);

    const createdId = res.body.data.id;
    expect(createdId).toBeDefined();
    expect(res.body.data.employeeId).toMatch(/^EMP-\d{4,}$/);

    const createAudit = await prisma.auditLog.findFirst({
      where: { entity: 'Employee', action: { contains: 'POST' } },
      orderBy: { createdAt: 'desc' },
    });
    expect(createAudit).not.toBeNull();

    await request(app.getHttpServer())
      .patch(`/employees/${createdId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Updated' })
      .expect(200);

    const updateAudit = await prisma.auditLog.findFirst({
      where: { entity: 'Employee', action: { contains: 'PATCH' } },
      orderBy: { createdAt: 'desc' },
    });
    expect(updateAudit).not.toBeNull();
    expect((updateAudit?.before as any)?.firstName).toBe('E2E');
    expect((updateAudit?.after as any)?.firstName).toBe('Updated');

    // cleanup
    await prisma.employee.delete({ where: { id: createdId } });
  });
});
