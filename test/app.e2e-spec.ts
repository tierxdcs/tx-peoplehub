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
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health is public and returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('GET /users without token → 401', async () => {
    await request(app.getHttpServer()).get('/users').expect(401);
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

  it('GET /users with admin token → 200 list', async () => {
    const res = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('POST /users creates a user and writes an audit log', async () => {
    const email = `e2e-${Date.now()}@peoplehub.local`;
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email, password: 'S3curePass!', firstName: 'E2E' })
      .expect(201);

    const createdId = res.body.data.id;
    expect(createdId).toBeDefined();

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'User', action: { contains: 'POST' } },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();

    // cleanup
    await prisma.user.delete({ where: { id: createdId } });
  });
});
