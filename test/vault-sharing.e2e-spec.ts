import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { VaultStorageService } from '../src/modules/vault/vault-storage.service';

/**
 * Vault Phase 3 e2e: default-folder seed presence + vertical visibility, and
 * additive internal sharing (a file shared with an employee who has no folder
 * access → they see just that file; a VIEW file-share never downgrades a
 * user's broader folder-level write access).
 *
 * R2 is replaced by the same in-memory fake used in the Phase 2 spec.
 */
class FakeStorage {
  objects = new Map<string, { sizeBytes: number; contentType: string }>();
  buildStorageKey(fileId: string, v: number) {
    return `vault/files/${fileId}/v${v}`;
  }
  async createUploadUrl(storageKey: string) {
    return { url: `https://fake-r2/${storageKey}`, expiresInSeconds: 300 };
  }
  async createDownloadUrl(storageKey: string) {
    return { url: `https://fake-r2/${storageKey}?get`, expiresInSeconds: 300 };
  }
  async headObject(storageKey: string) {
    const o = this.objects.get(storageKey);
    return o ? { sizeBytes: o.sizeBytes, contentType: o.contentType } : null;
  }
  async copyObject(from: string, to: string) {
    const o = this.objects.get(from);
    if (o) this.objects.set(to, { ...o });
  }
  async deleteObject(storageKey: string) {
    this.objects.delete(storageKey);
  }
}

describe('Vault sharing + default seed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: FakeStorage;
  let adminToken: string;
  let superAdminId: string;
  let salesVerticalId: string;

  let ownerToken: string; // sales manager, owns the CUSTOM folder
  let teamMemberToken: string; // reports to owner → has folder access
  let teamMemberId: string;
  let outsiderToken: string; // HR, no folder access
  let outsiderId: string;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const createdEmployeeIds: string[] = [];
  const createdFolderIds: string[] = [];

  async function login(email: string, password: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
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
  async function uploadFile(folderId: string, name: string) {
    const res = await request(app.getHttpServer())
      .post('/vault/files/upload-url')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ folderId, name, mimeType: 'application/pdf', sizeBytes: 10 })
      .expect(201);
    const { storageKey, file } = res.body.data;
    storage.objects.set(storageKey, {
      sizeBytes: 10,
      contentType: 'application/pdf',
    });
    await request(app.getHttpServer())
      .post(`/vault/files/${file.id}/confirm-upload`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    return file.id as string;
  }

  beforeAll(async () => {
    storage = new FakeStorage();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(VaultStorageService)
      .useValue(storage)
      .compile();

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

    salesVerticalId = (
      await prisma.vertical.findUniqueOrThrow({ where: { code: 'SALES' } })
    ).id;
    const hrVerticalId = (
      await prisma.vertical.findUniqueOrThrow({ where: { code: 'HR' } })
    ).id;
    superAdminId = (
      await prisma.employee.findUniqueOrThrow({ where: { email: adminEmail } })
    ).id;
    adminToken = await login(adminEmail, adminPassword);

    const suffix = Date.now();
    const owner = await createEmployee({
      firstName: 'Share',
      lastName: 'Owner',
      email: `share.owner.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });
    const teamMember = await createEmployee({
      firstName: 'Share',
      lastName: 'Team',
      email: `share.team.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: salesVerticalId,
      reportingManagerId: owner.id,
    });
    teamMemberId = teamMember.id;
    const outsider = await createEmployee({
      firstName: 'Share',
      lastName: 'Outsider',
      email: `share.out.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: hrVerticalId,
      reportingManagerId: superAdminId,
    });
    outsiderId = outsider.id;

    ownerToken = await login(owner.email, 'S3curePass!');
    teamMemberToken = await login(teamMember.email, 'S3curePass!');
    outsiderToken = await login(outsider.email, 'S3curePass!');
  });

  afterAll(async () => {
    await prisma.vaultInternalShare.deleteMany({
      where: { sharedWithEmployeeId: { in: createdEmployeeIds } },
    });
    await prisma.vaultFileVersion.deleteMany({
      where: { file: { folderId: { in: createdFolderIds } } },
    });
    await prisma.vaultFile.deleteMany({
      where: { folderId: { in: createdFolderIds } },
    });
    await prisma.vaultFolder.deleteMany({
      where: { id: { in: createdFolderIds } },
    });
    if (createdEmployeeIds.length > 0) {
      await prisma.employee.deleteMany({
        where: { id: { in: createdEmployeeIds } },
      });
    }
    await app.close();
  });

  // ── Default folder seed ────────────────────────────────────────────
  it('all 11 default folders exist with correct scope/vertical/versioning', async () => {
    const defaults = await prisma.vaultFolder.findMany({
      where: { type: 'DEFAULT' },
      include: { scopeVertical: { select: { code: true } } },
    });
    const byName = new Map(defaults.map((f) => [f.name, f]));

    expect(defaults.length).toBeGreaterThanOrEqual(11);

    // Company-wide
    for (const name of [
      'Company Policies',
      'Onboarding Documents',
      'Compliance & Legal',
      'IT & Security Guidelines',
      'Company Announcements',
    ]) {
      expect(byName.get(name)?.visibilityScope).toBe('COMPANY_WIDE');
    }
    // Unbounded-retention exception
    expect(byName.get('Company Policies')?.versioningEnabled).toBe(true);
    expect(byName.get('Company Policies')?.maxVersionsRetained).toBeNull();
    expect(byName.get('Compliance & Legal')?.maxVersionsRetained).toBeNull();

    // Vertical-scoped
    expect(byName.get('Sales')?.scopeVertical?.code).toBe('SALES');
    expect(byName.get('Design')?.scopeVertical?.code).toBe('DESIGN');
    expect(byName.get('Design')?.versioningEnabled).toBe(true);
    expect(byName.get('Production / Manufacturing')?.scopeVertical?.code).toBe(
      'PRODUCTION',
    );
    expect(byName.get('Quality')?.scopeVertical?.code).toBe('PRODUCTION');
    expect(byName.get('Procurement / SCM')?.scopeVertical?.code).toBe('SCM');
    expect(byName.get('Dispatch')?.scopeVertical?.code).toBe('SCM');

    // All owned by the seeded SUPER_ADMIN.
    for (const f of defaults) expect(f.ownerId).toBe(superAdminId);
  });

  it('a vertical-scoped default folder is visible only to that vertical', async () => {
    const sales = await prisma.vaultFolder.findFirstOrThrow({
      where: { type: 'DEFAULT', name: 'Sales' },
    });
    // Sales employee (teamMember) can see it; HR outsider cannot.
    await request(app.getHttpServer())
      .get(`/vault/folders/${sales.id}`)
      .set('Authorization', `Bearer ${teamMemberToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/vault/folders/${sales.id}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
  });

  // ── Internal sharing ───────────────────────────────────────────────
  it('sharing a FILE grants access to an employee with no folder access, without exposing the folder', async () => {
    const folderId = (
      await request(app.getHttpServer())
        .post('/vault/folders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Owner Docs', type: 'CUSTOM' })
        .expect(201)
    ).body.data.id;
    createdFolderIds.push(folderId);
    const fileId = await uploadFile(folderId, 'shared.pdf');
    const otherFileId = await uploadFile(folderId, 'not-shared.pdf');

    // Outsider has no access to the folder or its files yet.
    await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/vault/files/${fileId}/versions`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);

    // Share just the one file, VIEW.
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sharedWithEmployeeId: outsiderId, permission: 'VIEW' })
      .expect(201);

    // Now the outsider can view THAT file...
    await request(app.getHttpServer())
      .get(`/vault/files/${fileId}/versions`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/vault/files/${fileId}/download-url`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);

    // ...but NOT the folder, nor the sibling file.
    await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/vault/files/${otherFileId}/versions`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);

    // VIEW share is read-only — cannot upload a new version (folder isn't
    // versioned anyway, but the 403 proves no write access).
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/versions`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ mimeType: 'application/pdf', sizeBytes: 5 })
      .expect(403);
  });

  it('an EDIT file-share grants write; a VIEW share does not downgrade broader folder write access', async () => {
    // Versioned folder so we can test write via a new version.
    const folderId = (
      await request(app.getHttpServer())
        .post('/vault/folders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Versioned Shared', type: 'CUSTOM' })
        .expect(201)
    ).body.data.id;
    createdFolderIds.push(folderId);
    await prisma.vaultFolder.update({
      where: { id: folderId },
      data: { versioningEnabled: true, maxVersionsRetained: null },
    });
    const fileId = await uploadFile(folderId, 'edit.pdf');

    // EDIT share to the HR outsider → they can add a version.
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sharedWithEmployeeId: outsiderId, permission: 'EDIT' })
      .expect(201);
    const verRes = await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/versions`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ mimeType: 'application/pdf', sizeBytes: 20 })
      .expect(201);
    storage.objects.set(verRes.body.data.storageKey, {
      sizeBytes: 20,
      contentType: 'application/pdf',
    });
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/versions/confirm`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(201);

    // The team member already has folder-level write (downstream of owner).
    // A VIEW-only share on this file to them must NOT downgrade that.
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sharedWithEmployeeId: teamMemberId, permission: 'VIEW' })
      .expect(201);
    // Still can write (add a version) thanks to folder access — union wins.
    const tmVer = await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/versions`)
      .set('Authorization', `Bearer ${teamMemberToken}`)
      .send({ mimeType: 'application/pdf', sizeBytes: 30 })
      .expect(201);
    storage.objects.set(tmVer.body.data.storageKey, {
      sizeBytes: 30,
      contentType: 'application/pdf',
    });
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/versions/confirm`)
      .set('Authorization', `Bearer ${teamMemberToken}`)
      .expect(201);
  });

  it('folder share grants access to the whole folder additively', async () => {
    const folderId = (
      await request(app.getHttpServer())
        .post('/vault/folders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Folder Shared', type: 'CUSTOM' })
        .expect(201)
    ).body.data.id;
    createdFolderIds.push(folderId);

    await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/vault/folders/${folderId}/share`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sharedWithEmployeeId: outsiderId, permission: 'VIEW' })
      .expect(201);

    const view = await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);
    expect(view.body.data.access.canRead).toBe(true);
    expect(view.body.data.access.canWrite).toBe(false);
  });

  it('cannot share a resource you lack write access to', async () => {
    const folderId = (
      await request(app.getHttpServer())
        .post('/vault/folders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'No Grant', type: 'CUSTOM' })
        .expect(201)
    ).body.data.id;
    createdFolderIds.push(folderId);
    const fileId = await uploadFile(folderId, 'x.pdf');

    // Outsider has no access → cannot share it onward.
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ sharedWithEmployeeId: teamMemberId, permission: 'VIEW' })
      .expect(403);
  });
});
