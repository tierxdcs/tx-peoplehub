import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * Admin force-reset + tokenVersion session invalidation + mustChangePassword
 * gate (the pieces beyond self-service change-password, which its own spec
 * covers). Verifies:
 *  - only ADMIN/SUPER_ADMIN can force-reset; can't reset yourself
 *  - a reset returns a one-time temp password, forces change, and invalidates
 *    the target's existing access + refresh tokens (tokenVersion bump)
 *  - the temp password logs the user in, but the mustChangePassword guard then
 *    blocks every route except change-password / logout
 *  - changing the password clears the flag, re-enables the app, and returns a
 *    fresh working token
 *  - a self-service change also invalidates other outstanding sessions
 */
describe('Password reset / force-change (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const createdIds: string[] = [];
  const initialPassword = 'S3curePass!';

  let adminToken: string;
  let superAdminId: string;
  let userId: string;
  let userEmail: string;
  let repToken: string; // a plain EMPLOYEE, to prove non-admins can't reset
  let repId: string;

  const http = () => request(app.getHttpServer());
  function login(email: string, password: string) {
    return http().post('/auth/login').send({ email, password });
  }
  async function mkEmployee(tag: string, verticalId: string): Promise<{ id: string; email: string }> {
    const email = `pwr.${tag}.${Date.now()}@peoplehub.local`;
    const res = await http()
      .post('/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Pwr',
        lastName: tag,
        email,
        password: initialPassword,
        role: 'EMPLOYEE',
        verticalId,
        reportingManagerId: superAdminId,
      })
      .expect(201);
    createdIds.push(res.body.data.id);
    return { id: res.body.data.id, email };
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

    adminToken = (await login(adminEmail, adminPassword).expect(200)).body.data
      .accessToken;
    superAdminId = (
      await prisma.employee.findUniqueOrThrow({ where: { email: adminEmail } })
    ).id;
    const salesVertical = await prisma.vertical.findUniqueOrThrow({
      where: { code: 'SALES' },
    });

    const user = await mkEmployee('target', salesVertical.id);
    userId = user.id;
    userEmail = user.email;
    const rep = await mkEmployee('rep', salesVertical.id);
    repId = rep.id;
    repToken = (await login(rep.email, initialPassword).expect(200)).body.data
      .accessToken;
  });

  afterAll(async () => {
    if (createdIds.length) {
      await prisma.employee.deleteMany({ where: { id: { in: createdIds } } });
    }
    await app.close();
  });

  it('only ADMIN/SUPER_ADMIN can force-reset, and not themselves', async () => {
    // A plain employee cannot reset anyone.
    await http()
      .patch(`/employees/${userId}/reset-password`)
      .set('Authorization', `Bearer ${repToken}`)
      .expect(403);
    // An admin cannot force-reset their OWN password (use change-password).
    await http()
      .patch(`/employees/${superAdminId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('force-reset invalidates sessions, forces a change, and the temp password works only through change-password', async () => {
    // The target logs in first — capturing an access token + refresh cookie.
    const beforeLogin = await login(userEmail, initialPassword).expect(200);
    const staleAccess = beforeLogin.body.data.accessToken as string;
    const refreshCookie = beforeLogin.headers['set-cookie'];

    // A normal request works pre-reset.
    await http()
      .get(`/employees/${userId}`)
      .set('Authorization', `Bearer ${staleAccess}`)
      .expect(200);

    // Admin force-resets → one-time temp password returned.
    const resetRes = await http()
      .patch(`/employees/${userId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const tempPassword = resetRes.body.data.temporaryPassword as string;
    expect(typeof tempPassword).toBe('string');
    expect(tempPassword.length).toBeGreaterThanOrEqual(8);

    // The previously-issued access token is now dead (tokenVersion bumped).
    await http()
      .get(`/employees/${userId}`)
      .set('Authorization', `Bearer ${staleAccess}`)
      .expect(401);
    // The previously-issued refresh cookie is dead too.
    await http()
      .post('/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(401);
    // The old password no longer logs in.
    await login(userEmail, initialPassword).expect(401);

    // The temp password logs in — but the mustChangePassword guard blocks
    // everything except change-password.
    const forcedLogin = await login(userEmail, tempPassword).expect(200);
    const forcedToken = forcedLogin.body.data.accessToken as string;
    await http()
      .get(`/employees/${userId}`)
      .set('Authorization', `Bearer ${forcedToken}`)
      .expect(403); // MUST_CHANGE_PASSWORD gate

    // change-password IS reachable while forced; it clears the flag + returns a
    // fresh token that now passes the gate.
    const newPassword = 'FreshPass99!';
    const changed = await http()
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${forcedToken}`)
      .send({ currentPassword: tempPassword, newPassword })
      .expect(200);
    const freshToken = changed.body.data.accessToken as string;
    expect(typeof freshToken).toBe('string');
    await http()
      .get(`/employees/${userId}`)
      .set('Authorization', `Bearer ${freshToken}`)
      .expect(200);

    // The forced (pre-change) token is now stale (change bumped version again).
    await http()
      .get(`/employees/${userId}`)
      .set('Authorization', `Bearer ${forcedToken}`)
      .expect(401);

    // The new password logs in cleanly with no forced-change gate.
    const cleanLogin = await login(userEmail, newPassword).expect(200);
    await http()
      .get(`/employees/${userId}`)
      .set('Authorization', `Bearer ${cleanLogin.body.data.accessToken}`)
      .expect(200);
  });

  it('a self-service change invalidates OTHER outstanding sessions', async () => {
    // Two concurrent sessions for the rep.
    const sessionA = (await login(
      (await prisma.employee.findUniqueOrThrow({ where: { id: repId } })).email,
      initialPassword,
    ).expect(200)).body.data.accessToken as string;
    const repEmail = (
      await prisma.employee.findUniqueOrThrow({ where: { id: repId } })
    ).email;
    const sessionB = (await login(repEmail, initialPassword).expect(200)).body
      .data.accessToken as string;

    // Change via session B → session A (older token, same tokenVersion) dies.
    await http()
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${sessionB}`)
      .send({ currentPassword: initialPassword, newPassword: 'RepFresh42!' })
      .expect(200);

    await http()
      .get(`/employees/${repId}`)
      .set('Authorization', `Bearer ${sessionA}`)
      .expect(401);
  });
});
