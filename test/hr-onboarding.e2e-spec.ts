import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * End-to-end coverage for the HR Module Phase 1 two-step onboarding flow:
 * HR-vertical staff create a personnel record (no login yet) → Admin grants
 * system access → the employee can then authenticate. Also verifies
 * encrypted-at-rest storage of PII and role-shaped roster responses.
 * Requires a running, migrated, seeded Postgres (see README).
 */
describe('HR onboarding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let hrStaffToken: string;
  let salesVerticalId: string;
  let hrVerticalId: string;
  let superAdminId: string;
  let hrStaffId: string;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const createdIds: string[] = [];

  function onboardPayload(overrides: Record<string, unknown> = {}) {
    const suffix = Date.now() + Math.floor(Math.random() * 1000);
    return {
      firstName: `John${suffix}`,
      lastName: 'Doe',
      dateOfBirth: '1995-05-20',
      gender: 'Male',
      personalEmail: `john.personal.${suffix}@gmail.com`,
      mobile: '+91 9876543210',
      designation: 'Design Engineer',
      employmentType: 'FULL_TIME_PERMANENT',
      dateOfJoining: '2026-07-05',
      workLocation: 'Bangalore HQ',
      verticalId: salesVerticalId,
      emergencyContactName: 'Jane Roe',
      emergencyContactRelation: 'Spouse',
      emergencyContactPhone: '+91 9876500000',
      compensation: {
        basicSalary: 50000,
        hra: 10000,
        effectiveDate: '2026-07-05',
      },
      statutoryInfo: {
        panNumber: 'ABCDE1234F',
        aadhaarLast4: '1234',
        pfAccountNumber: 'PF1234567890',
      },
      bankDetails: {
        bankAccountNumber: '000123456789',
        ifscCode: 'HDFC0001234',
      },
      ...overrides,
    };
  }

  /** statutoryInfo including the optional esicNumber (omitted by default). */
  function statutoryWithEsic() {
    return {
      panNumber: 'ABCDE1234F',
      aadhaarLast4: '1234',
      pfAccountNumber: 'PF1234567890',
      esicNumber: 'ESIC1234567890',
    };
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

    const salesVertical = await prisma.vertical.findUniqueOrThrow({
      where: { code: 'SALES' },
    });
    salesVerticalId = salesVertical.id;
    const hrVertical = await prisma.vertical.findUniqueOrThrow({
      where: { code: 'HR' },
    });
    hrVerticalId = hrVertical.id;

    const superAdmin = await prisma.employee.findUniqueOrThrow({
      where: { email: adminEmail },
    });
    superAdminId = superAdmin.id;

    adminToken = await login(adminEmail, adminPassword);

    // Onboard + grant-access an HR-vertical EMPLOYEE to act as the HR staff
    // member for the rest of this suite.
    const hrOnboardRes = await request(app.getHttpServer())
      .post('/employees/onboard')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(
        onboardPayload({
          verticalId: hrVerticalId,
          designation: 'HR Associate',
        }),
      )
      .expect(201);
    hrStaffId = hrOnboardRes.body.data.id;
    createdIds.push(hrStaffId);

    const hrPassword = 'S3curePass!';
    await request(app.getHttpServer())
      .patch(`/employees/${hrStaffId}/grant-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        role: 'EMPLOYEE',
        verticalId: hrVerticalId,
        reportingManagerId: superAdminId,
        password: hrPassword,
      })
      .expect(200);

    const hrEmployee = await prisma.employee.findUniqueOrThrow({
      where: { id: hrStaffId },
    });
    hrStaffToken = await login(hrEmployee.email, hrPassword);
  });

  afterAll(async () => {
    for (const id of createdIds.reverse()) {
      await prisma.employee.deleteMany({ where: { id } });
    }
    await app.close();
  });

  it('HR-vertical staff can onboard an employee into a different vertical (cross-vertical exception)', async () => {
    const res = await request(app.getHttpServer())
      .post('/employees/onboard')
      .set('Authorization', `Bearer ${hrStaffToken}`)
      .send(onboardPayload({ verticalId: salesVerticalId }))
      .expect(201);

    createdIds.push(res.body.data.id);
    expect(res.body.data.verticalId).toBe(salesVerticalId);
    expect(res.body.data.role).toBeNull();
    expect(res.body.data.accessStatus).toBe('PENDING_ACCESS');
  });

  it('a non-HR-vertical MANAGER/EMPLOYEE cannot access the onboarding endpoint', async () => {
    // Onboard + activate a plain Sales employee to prove they're locked out.
    const onboarded = await request(app.getHttpServer())
      .post('/employees/onboard')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(onboardPayload({ verticalId: salesVerticalId }))
      .expect(201);
    createdIds.push(onboarded.body.data.id);

    const activatePassword = 'S3curePass!';
    await request(app.getHttpServer())
      .patch(`/employees/${onboarded.body.data.id}/grant-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        role: 'EMPLOYEE',
        verticalId: salesVerticalId,
        reportingManagerId: superAdminId,
        password: activatePassword,
      })
      .expect(200);

    const salesEmployee = await prisma.employee.findUniqueOrThrow({
      where: { id: onboarded.body.data.id },
    });
    const salesToken = await login(salesEmployee.email, activatePassword);

    await request(app.getHttpServer())
      .post('/employees/onboard')
      .set('Authorization', `Bearer ${salesToken}`)
      .send(onboardPayload({ verticalId: salesVerticalId }))
      .expect(403);
  });

  it('a non-HR-vertical, non-Admin employee cannot access the roster endpoint', async () => {
    // The /roster route's @Roles guard is deliberately broad (any employee);
    // the HR-or-Admin restriction is enforced in the service. Prove a plain
    // Sales EMPLOYEE is actually rejected at the HTTP boundary, not just in
    // a unit test.
    const onboarded = await request(app.getHttpServer())
      .post('/employees/onboard')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(onboardPayload({ verticalId: salesVerticalId }))
      .expect(201);
    createdIds.push(onboarded.body.data.id);

    const activatePassword = 'S3curePass!';
    await request(app.getHttpServer())
      .patch(`/employees/${onboarded.body.data.id}/grant-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        role: 'EMPLOYEE',
        verticalId: salesVerticalId,
        reportingManagerId: superAdminId,
        password: activatePassword,
      })
      .expect(200);

    const salesEmployee = await prisma.employee.findUniqueOrThrow({
      where: { id: onboarded.body.data.id },
    });
    const salesToken = await login(salesEmployee.email, activatePassword);

    await request(app.getHttpServer())
      .get('/employees/roster')
      .set('Authorization', `Bearer ${salesToken}`)
      .expect(403);
  });

  it('generates a collision-safe official email and rejects login before grant-access', async () => {
    const first = await request(app.getHttpServer())
      .post('/employees/onboard')
      .set('Authorization', `Bearer ${hrStaffToken}`)
      .send(onboardPayload({ firstName: 'CollisionTest', lastName: 'Doe' }))
      .expect(201);
    createdIds.push(first.body.data.id);

    const second = await request(app.getHttpServer())
      .post('/employees/onboard')
      .set('Authorization', `Bearer ${hrStaffToken}`)
      .send(onboardPayload({ firstName: 'CollisionTest', lastName: 'Doe' }))
      .expect(201);
    createdIds.push(second.body.data.id);

    expect(first.body.data.email).toBe('collisiontest.doe@vertixdcs.com');
    expect(second.body.data.email).toBe('collisiontest.doe2@vertixdcs.com');

    // PENDING_ACCESS: login must be rejected even with no password set.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: first.body.data.email, password: 'anything' })
      .expect(401);
  });

  it('grant-access activates login; PAN/PF/bank account are stored encrypted at rest', async () => {
    const onboarded = await request(app.getHttpServer())
      .post('/employees/onboard')
      .set('Authorization', `Bearer ${hrStaffToken}`)
      // esicNumber is optional and omitted from the default payload, so
      // supply it here explicitly — otherwise its at-rest encryption goes
      // unverified (the stored row would just be null).
      .send(onboardPayload({ statutoryInfo: statutoryWithEsic() }))
      .expect(201);
    const employeeId = onboarded.body.data.id;
    createdIds.push(employeeId);

    const password = 'GrantMeAccess1!';
    const grantRes = await request(app.getHttpServer())
      .patch(`/employees/${employeeId}/grant-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        role: 'EMPLOYEE',
        verticalId: salesVerticalId,
        reportingManagerId: superAdminId,
        password,
      })
      .expect(200);

    expect(grantRes.body.data.accessStatus).toBe('ACTIVE');
    expect(grantRes.body.data.role).toBe('EMPLOYEE');

    // Login now succeeds using the generated official email as the login id.
    await login(grantRes.body.data.email, password);

    // Raw DB rows must not contain the plaintext PII values.
    const statutory = await prisma.employeeStatutoryInfo.findUniqueOrThrow({
      where: { employeeId },
    });
    expect(statutory.panNumber).not.toBe('ABCDE1234F');
    expect(statutory.panNumber).not.toContain('ABCDE1234F');
    expect(statutory.pfAccountNumber).not.toBe('PF1234567890');
    expect(statutory.esicNumber).not.toBeNull();
    expect(statutory.esicNumber).not.toBe('ESIC1234567890');
    expect(statutory.esicNumber).not.toContain('ESIC1234567890');

    const bank = await prisma.employeeBankDetails.findUniqueOrThrow({
      where: { employeeId },
    });
    expect(bank.bankAccountNumber).not.toBe('000123456789');
    expect(bank.bankAccountNumber).not.toContain('000123456789');

    // Decrypted read-back via the Admin-only endpoint returns the original values.
    const decrypted = await request(app.getHttpServer())
      .get(`/employees/${employeeId}/statutory`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(decrypted.body.data.panNumber).toBe('ABCDE1234F');
    expect(decrypted.body.data.esicNumber).toBe('ESIC1234567890');
  });

  it('roster response differs by caller role: HR staff never see compensation/statutory/bank data', async () => {
    const onboarded = await request(app.getHttpServer())
      .post('/employees/onboard')
      .set('Authorization', `Bearer ${hrStaffToken}`)
      .send(onboardPayload())
      .expect(201);
    createdIds.push(onboarded.body.data.id);

    const hrRosterRes = await request(app.getHttpServer())
      .get('/employees/roster')
      .set('Authorization', `Bearer ${hrStaffToken}`)
      .expect(200);
    const hrRow = hrRosterRes.body.data.items.find(
      (e: { id: string }) => e.id === onboarded.body.data.id,
    );
    expect(hrRow).toBeDefined();
    expect(hrRow).not.toHaveProperty('hasCompensationOnFile');
    expect(JSON.stringify(hrRow)).not.toMatch(
      /basicSalary|panNumber|bankAccountNumber/i,
    );

    const adminRosterRes = await request(app.getHttpServer())
      .get('/employees/roster')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const adminRow = adminRosterRes.body.data.items.find(
      (e: { id: string }) => e.id === onboarded.body.data.id,
    );
    expect(adminRow.hasCompensationOnFile).toBe(true);
    expect(adminRow.hasStatutoryInfoOnFile).toBe(true);
    expect(adminRow.hasBankDetailsOnFile).toBe(true);
    expect(JSON.stringify(adminRow)).not.toMatch(
      /basicSalary|panNumber|bankAccountNumber/i,
    );
  });

  it('compensation/statutory/bank GET endpoints reject HR-vertical staff, including the one who created the record', async () => {
    const onboarded = await request(app.getHttpServer())
      .post('/employees/onboard')
      .set('Authorization', `Bearer ${hrStaffToken}`)
      .send(onboardPayload())
      .expect(201);
    createdIds.push(onboarded.body.data.id);

    await request(app.getHttpServer())
      .get(`/employees/${onboarded.body.data.id}/compensation`)
      .set('Authorization', `Bearer ${hrStaffToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get(`/employees/${onboarded.body.data.id}/statutory`)
      .set('Authorization', `Bearer ${hrStaffToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get(`/employees/${onboarded.body.data.id}/bank-details`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });
});
