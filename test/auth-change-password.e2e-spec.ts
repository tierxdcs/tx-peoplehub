import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * Self-service change-password (POST /auth/change-password). Verifies: wrong
 * current password is rejected, a no-op (new === current) is rejected, and a
 * successful change actually rotates the password (old fails, new works).
 */
describe('Auth change-password (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const createdIds: string[] = [];

  let userEmail: string;
  const initialPassword = 'S3curePass!';

  function login(email: string, password: string) {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
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

    const adminToken = (
      await login(adminEmail, adminPassword).expect(200)
    ).body.data.accessToken;
    const salesVertical = await prisma.vertical.findUniqueOrThrow({
      where: { code: 'SALES' },
    });
    const superAdminId = (
      await prisma.employee.findUniqueOrThrow({ where: { email: adminEmail } })
    ).id;

    const suffix = Date.now();
    userEmail = `pwtest.${suffix}@peoplehub.local`;
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Pw',
        lastName: 'Test',
        email: userEmail,
        password: initialPassword,
        role: 'EMPLOYEE',
        verticalId: salesVertical.id,
        reportingManagerId: superAdminId,
      })
      .expect(201);
    createdIds.push(res.body.data.id);
  });

  afterAll(async () => {
    if (createdIds.length) {
      await prisma.employee.deleteMany({ where: { id: { in: createdIds } } });
    }
    await app.close();
  });

  it('rejects a wrong current password (401)', async () => {
    const token = (await login(userEmail, initialPassword).expect(200)).body
      .data.accessToken;
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrong-password', newPassword: 'BrandN3wPass!' })
      .expect(401);
  });

  it('rejects reusing the current password as the new one (400)', async () => {
    const token = (await login(userEmail, initialPassword).expect(200)).body
      .data.accessToken;
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: initialPassword, newPassword: initialPassword })
      .expect(400);
  });

  it('requires authentication (401 without a token)', async () => {
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .send({ currentPassword: initialPassword, newPassword: 'BrandN3wPass!' })
      .expect(401);
  });

  it('changes the password: old no longer works, new does', async () => {
    const token = (await login(userEmail, initialPassword).expect(200)).body
      .data.accessToken;
    const newPassword = 'BrandN3wPass!';

    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: initialPassword, newPassword })
      .expect(200);

    // Old password rejected, new one accepted.
    await login(userEmail, initialPassword).expect(401);
    await login(userEmail, newPassword).expect(200);
  });
});
