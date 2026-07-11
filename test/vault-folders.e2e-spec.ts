import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * Vault Phase 1 e2e: folder creation gates (DEFAULT=SuperAdmin,
 * CUSTOM=Manager+), computed visibility across a 3-level hierarchy,
 * vertical/company-wide scoping, additive explicit grants, and one PERSONAL
 * folder per onboarded employee. Requires a running, migrated, seeded
 * Postgres.
 */
describe('Vault folders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string; // seeded SUPER_ADMIN
  let superAdminId: string;
  let salesVerticalId: string;
  let hrVerticalId: string;

  // 3-level hierarchy: manager -> mid (manager) -> leaf (employee),
  // plus an outsider in another chain and another vertical.
  let managerToken: string;
  let managerId: string;
  let midToken: string;
  let midId: string;
  let leafToken: string;
  let outsiderToken: string;
  let outsiderId: string;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const createdEmployeeIds: string[] = [];
  const createdFolderIds: string[] = [];

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
    const hrVertical = await prisma.vertical.findUniqueOrThrow({
      where: { code: 'HR' },
    });
    hrVerticalId = hrVertical.id;
    const superAdmin = await prisma.employee.findUniqueOrThrow({
      where: { email: adminEmail },
    });
    superAdminId = superAdmin.id;
    adminToken = await login(adminEmail, adminPassword);

    const suffix = Date.now();
    const manager = await createEmployee({
      firstName: 'Vault',
      lastName: 'Mgr',
      email: `vault.mgr.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });
    managerId = manager.id;
    const mid = await createEmployee({
      firstName: 'Vault',
      lastName: 'Mid',
      email: `vault.mid.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVerticalId,
      reportingManagerId: managerId,
    });
    midId = mid.id;
    const leaf = await createEmployee({
      firstName: 'Vault',
      lastName: 'Leaf',
      email: `vault.leaf.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: salesVerticalId,
      reportingManagerId: midId,
    });
    const outsider = await createEmployee({
      firstName: 'Vault',
      lastName: 'Outsider',
      email: `vault.out.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: hrVerticalId,
      reportingManagerId: superAdminId,
    });
    outsiderId = outsider.id;

    managerToken = await login(manager.email, 'S3curePass!');
    midToken = await login(mid.email, 'S3curePass!');
    leafToken = await login(leaf.email, 'S3curePass!');
    outsiderToken = await login(outsider.email, 'S3curePass!');
  });

  afterAll(async () => {
    await prisma.vaultFolderPermission.deleteMany({
      where: { folderId: { in: createdFolderIds } },
    });
    await prisma.vaultFolder.deleteMany({
      where: { id: { in: createdFolderIds } },
    });
    // Employee delete cascades their auto-provisioned PERSONAL folders.
    if (createdEmployeeIds.length > 0) {
      await prisma.employee.deleteMany({
        where: { id: { in: createdEmployeeIds } },
      });
    }
    await app.close();
  });

  it('an EMPLOYEE cannot create CUSTOM or DEFAULT folders (403)', async () => {
    await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${leafToken}`)
      .send({ name: 'nope', type: 'CUSTOM' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${leafToken}`)
      .send({ name: 'nope', type: 'DEFAULT', visibilityScope: 'COMPANY_WIDE' })
      .expect(403);
  });

  it('a MANAGER cannot create a DEFAULT folder (403), only SUPER_ADMIN can', async () => {
    await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'nope', type: 'DEFAULT', visibilityScope: 'COMPANY_WIDE' })
      .expect(403);
  });

  it('CUSTOM folder: visible to the 3-level downstream team, invisible outside it', async () => {
    const res = await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${managerToken}`)
      // Any client-sent scope must be ignored — CUSTOM is forced to TEAM.
      .send({
        name: 'Team Docs',
        type: 'CUSTOM',
        visibilityScope: 'COMPANY_WIDE',
      })
      .expect(201);
    const folderId = res.body.data.id;
    createdFolderIds.push(folderId);
    expect(res.body.data.visibilityScope).toBe('TEAM');
    expect(res.body.data.ownerId).toBe(managerId);

    // Direct report (mid) and indirect report (leaf) can read.
    const midView = await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${midToken}`)
      .expect(200);
    expect(midView.body.data.access.canRead).toBe(true);
    expect(midView.body.data.access.canWrite).toBe(true);
    expect(midView.body.data.access.canDelete).toBe(false);

    const leafView = await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${leafToken}`)
      .expect(200);
    expect(leafView.body.data.access.canRead).toBe(true);

    // Outside the hierarchy: 403.
    await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
  });

  it('DEFAULT folder scoped to a vertical: visible only to that vertical', async () => {
    const res = await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Sales Policies',
        type: 'DEFAULT',
        visibilityScope: 'VERTICAL',
        scopeVerticalId: salesVerticalId,
      })
      .expect(201);
    const folderId = res.body.data.id;
    createdFolderIds.push(folderId);

    // Sales EMPLOYEE reads (no write); Sales MANAGER writes.
    const leafView = await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${leafToken}`)
      .expect(200);
    expect(leafView.body.data.access.canRead).toBe(true);
    expect(leafView.body.data.access.canWrite).toBe(false);

    const mgrView = await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    expect(mgrView.body.data.access.canWrite).toBe(true);

    // HR outsider: 403.
    await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
  });

  it('COMPANY_WIDE DEFAULT folder: everyone reads', async () => {
    const res = await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Company Handbook',
        type: 'DEFAULT',
        visibilityScope: 'COMPANY_WIDE',
      })
      .expect(201);
    const folderId = res.body.data.id;
    createdFolderIds.push(folderId);

    for (const token of [leafToken, outsiderToken, managerToken]) {
      const view = await request(app.getHttpServer())
        .get(`/vault/folders/${folderId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(view.body.data.access.canRead).toBe(true);
    }
  });

  it('PRIVATE DEFAULT folder: owner-only until internally shared', async () => {
    // SuperAdmin creates a DEFAULT folder scoped PRIVATE (no scopeVerticalId).
    const res = await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'SuperAdmin Private',
        type: 'DEFAULT',
        visibilityScope: 'PRIVATE',
      })
      .expect(201);
    const folderId = res.body.data.id;
    createdFolderIds.push(folderId);
    expect(res.body.data.visibilityScope).toBe('PRIVATE');
    expect(res.body.data.scopeVerticalId).toBeNull();

    // No other (non-SuperAdmin) employee can see it — same PRIVATE semantics
    // as a PERSONAL folder, just on a DEFAULT-type one.
    for (const token of [leafToken, outsiderToken, managerToken]) {
      await request(app.getHttpServer())
        .get(`/vault/folders/${folderId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    }

    // An internal share grants access exactly like any other folder.
    await request(app.getHttpServer())
      .post(`/vault/folders/${folderId}/share`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sharedWithEmployeeId: outsiderId, permission: 'VIEW' })
      .expect(201);

    const view = await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);
    expect(view.body.data.access.canRead).toBe(true);
    expect(view.body.data.access.canWrite).toBe(false);
  });

  it('explicit permission grants ADD access beyond scope without reducing it', async () => {
    // Manager's TEAM folder; the HR outsider normally has no access.
    const res = await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Shared With HR', type: 'CUSTOM' })
      .expect(201);
    const folderId = res.body.data.id;
    createdFolderIds.push(folderId);

    await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);

    // Owner grants the outsider read.
    await request(app.getHttpServer())
      .post(`/vault/folders/${folderId}/permissions`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ granteeType: 'EMPLOYEE', granteeId: outsiderId, canRead: true })
      .expect(201);

    const view = await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);
    expect(view.body.data.access.canRead).toBe(true);
    expect(view.body.data.access.canWrite).toBe(false);

    // Team members' scope access is untouched by the grant.
    const midView = await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${midToken}`)
      .expect(200);
    expect(midView.body.data.access.canWrite).toBe(true);
  });

  it('every onboarded employee gets exactly one PERSONAL folder, visible only to them', async () => {
    // Onboard through the real HR flow (SuperAdmin may onboard).
    const suffix = Date.now();
    const onboardRes = await request(app.getHttpServer())
      .post('/employees/onboard')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Vault',
        lastName: 'Onboardee',
        dateOfBirth: '1995-05-05',
        gender: 'F',
        personalEmail: `vault.onboardee.${suffix}@personal.example`,
        mobile: '9999999999',
        designation: 'Analyst',
        employmentType: 'FULL_TIME_PERMANENT',
        dateOfJoining: '2026-07-01',
        workLocation: 'Bengaluru',
        verticalId: salesVerticalId,
        emergencyContactName: 'EC',
        emergencyContactRelation: 'Parent',
        emergencyContactPhone: '8888888888',
        compensation: {
          basicSalary: 50000,
          hra: 20000,
          effectiveDate: '2026-07-01',
        },
        statutoryInfo: {
          panNumber: 'ABCDE1234F',
          aadhaarLast4: '1234',
          pfAccountNumber: 'PF123456',
        },
        bankDetails: {
          bankAccountNumber: '000111222333',
          ifscCode: 'HDFC0001234',
        },
      })
      .expect(201);
    const newEmployeeId = onboardRes.body.data.id;
    createdEmployeeIds.push(newEmployeeId);

    const personalFolders = await prisma.vaultFolder.findMany({
      where: { ownerId: newEmployeeId, type: 'PERSONAL' },
    });
    expect(personalFolders).toHaveLength(1);
    expect(personalFolders[0].visibilityScope).toBe('PRIVATE');
    const personalFolderId = personalFolders[0].id;

    // Another employee cannot see it; even their would-be manager cannot.
    await request(app.getHttpServer())
      .get(`/vault/folders/${personalFolderId}`)
      .set('Authorization', `Bearer ${leafToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/vault/folders/${personalFolderId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(403);

    // Versioning is not togglable on a PERSONAL folder — even for SuperAdmin.
    await request(app.getHttpServer())
      .patch(`/vault/folders/${personalFolderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ versioningEnabled: true })
      .expect(400);
  });

  it('PATCH toggles versioning on a non-PERSONAL folder (write access required)', async () => {
    const res = await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Versioned', type: 'CUSTOM' })
      .expect(201);
    const folderId = res.body.data.id;
    createdFolderIds.push(folderId);

    const updated = await request(app.getHttpServer())
      .patch(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ versioningEnabled: true, maxVersionsRetained: 10 })
      .expect(200);
    expect(updated.body.data.versioningEnabled).toBe(true);
    expect(updated.body.data.maxVersionsRetained).toBe(10);

    // The outsider (no write access) cannot rename it.
    await request(app.getHttpServer())
      .patch(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ name: 'hijacked' })
      .expect(403);
  });

  // ── DELETE (archive) DEFAULT folders — SUPER_ADMIN only ──────────────
  async function makeDefaultFolder(name: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name, type: 'DEFAULT', visibilityScope: 'COMPANY_WIDE' })
      .expect(201);
    createdFolderIds.push(res.body.data.id);
    return res.body.data.id;
  }

  it('SUPER_ADMIN deletes an empty DEFAULT folder; it archives and drops out of listings', async () => {
    const folderId = await makeDefaultFolder('To Delete');

    await request(app.getHttpServer())
      .delete(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    // Status is ARCHIVED (soft delete, not a hard delete).
    const row = await prisma.vaultFolder.findUniqueOrThrow({
      where: { id: folderId },
    });
    expect(row.status).toBe('ARCHIVED');

    // Gone from roots.
    const roots = await request(app.getHttpServer())
      .get('/vault/folders/roots')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      (roots.body.data as { id: string }[]).some((f) => f.id === folderId),
    ).toBe(false);
  });

  it('rejects deleting a DEFAULT folder that still contains active files, naming the count', async () => {
    const folderId = await makeDefaultFolder('Has Files');
    const file = await prisma.vaultFile.create({
      data: {
        folderId,
        name: 'keep.pdf',
        uploadedById: superAdminId,
        status: 'ACTIVE',
      },
    });

    const res = await request(app.getHttpServer())
      .delete(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    expect(res.body.message).toContain('1 file');
    expect(res.body.message).toContain('remove these first');

    // Folder untouched (still ACTIVE).
    const row = await prisma.vaultFolder.findUniqueOrThrow({
      where: { id: folderId },
    });
    expect(row.status).toBe('ACTIVE');

    // Clean up the file row so the folder can be torn down (FK is Restrict).
    await prisma.vaultFile.delete({ where: { id: file.id } });
  });

  it('rejects deleting a DEFAULT folder that still contains an active subfolder', async () => {
    const parentId = await makeDefaultFolder('Has Subfolder');
    // A child DEFAULT folder under it.
    const childRes = await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Child',
        type: 'DEFAULT',
        visibilityScope: 'COMPANY_WIDE',
        parentFolderId: parentId,
      })
      .expect(201);
    createdFolderIds.push(childRes.body.data.id);

    const res = await request(app.getHttpServer())
      .delete(`/vault/folders/${parentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    expect(res.body.message).toContain('1 subfolder');
  });

  it('non-SUPER_ADMIN cannot delete a folder (403), even a MANAGER with write access', async () => {
    // Manager owns a CUSTOM folder → full write access, but still can't delete.
    const res = await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Mgr Owned', type: 'CUSTOM' })
      .expect(201);
    createdFolderIds.push(res.body.data.id);

    await request(app.getHttpServer())
      .delete(`/vault/folders/${res.body.data.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(403);
  });

  it('PERSONAL and CUSTOM folder types cannot be deleted via this endpoint (400)', async () => {
    // CUSTOM: SuperAdmin tries → type-rejected (not silently archived).
    const custom = await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'A Custom', type: 'CUSTOM' })
      .expect(201);
    createdFolderIds.push(custom.body.data.id);
    await request(app.getHttpServer())
      .delete(`/vault/folders/${custom.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    // PERSONAL: create one directly, SuperAdmin tries → type-rejected.
    const personal = await prisma.vaultFolder.create({
      data: {
        name: 'Someone Personal',
        type: 'PERSONAL',
        ownerId: outsiderId,
        visibilityScope: 'PRIVATE',
      },
    });
    createdFolderIds.push(personal.id);
    await request(app.getHttpServer())
      .delete(`/vault/folders/${personal.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('an archived DEFAULT folder rejects uploads and new subfolders', async () => {
    const folderId = await makeDefaultFolder('Archived Container');
    await request(app.getHttpServer())
      .delete(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    // Upload-url rejected.
    await request(app.getHttpServer())
      .post('/vault/files/upload-url')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        folderId,
        name: 'late.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
      })
      .expect(400);

    // Subfolder creation rejected.
    await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Late Child',
        type: 'DEFAULT',
        visibilityScope: 'COMPANY_WIDE',
        parentFolderId: folderId,
      })
      .expect(400);
  });
});
