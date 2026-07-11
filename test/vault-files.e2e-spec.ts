import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { VaultStorageService } from '../src/modules/vault/vault-storage.service';

/**
 * Vault Phase 2 e2e: presigned-URL upload flow, write-permission gating,
 * version increment / current-version tracking, append-only restore,
 * retention pruning (asserted against the storage layer, not just the API),
 * unbounded retention, whole-file delete, and non-versioned duplicate-name
 * behaviour.
 *
 * R2 is replaced by an in-memory fake (FakeStorage) that records object keys,
 * so we can assert the ACTUAL object was deleted on prune/delete — the
 * verification checklist's "direct storage check" — without real network I/O.
 */

/** Tracks "R2 objects" as a set of keys; mirrors VaultStorageService's surface. */
class FakeStorage {
  objects = new Map<string, { sizeBytes: number; contentType: string }>();

  buildStorageKey(fileId: string, versionNumber: number): string {
    return `vault/files/${fileId}/v${versionNumber}`;
  }
  async createUploadUrl(storageKey: string, contentType: string) {
    // Simulate the browser's direct PUT immediately so confirm can HEAD it.
    // Size is stamped in via the pendingSize channel below.
    this.objects.set(storageKey, {
      sizeBytes: this.pendingSize.get(storageKey) ?? 0,
      contentType,
    });
    return {
      url: `https://fake-r2/${storageKey}?sig=x`,
      expiresInSeconds: 300,
    };
  }
  async createDownloadUrl(storageKey: string) {
    return {
      url: `https://fake-r2/${storageKey}?sig=get`,
      expiresInSeconds: 300,
    };
  }
  async headObject(storageKey: string) {
    const o = this.objects.get(storageKey);
    return o ? { sizeBytes: o.sizeBytes, contentType: o.contentType } : null;
  }
  async copyObject(fromKey: string, toKey: string) {
    const o = this.objects.get(fromKey);
    if (o) this.objects.set(toKey, { ...o });
  }
  async deleteObject(storageKey: string) {
    this.objects.delete(storageKey);
  }

  // Test channel: the size the "upload" should record for a key.
  pendingSize = new Map<string, number>();
}

describe('Vault files (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: FakeStorage;
  let adminToken: string;
  let superAdminId: string;
  let salesVerticalId: string;

  let ownerToken: string; // manager who owns folders
  let outsiderToken: string; // different vertical, no access

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
  async function createFolder(
    token: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    createdFolderIds.push(res.body.data.id);
    return res.body.data.id;
  }

  /** Full upload of a NEW file: request URL (fake stamps the size) → confirm. */
  async function uploadFile(
    token: string,
    folderId: string,
    name: string,
    sizeBytes: number,
  ): Promise<{ id: string; storageKey: string }> {
    const res = await request(app.getHttpServer())
      .post('/vault/files/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({ folderId, name, mimeType: 'application/pdf', sizeBytes })
      .expect(201);
    const { storageKey, file } = res.body.data;
    // Emulate the browser PUT: object now exists at storageKey with this size.
    storage.pendingSize.set(storageKey, sizeBytes);
    storage.objects.set(storageKey, {
      sizeBytes,
      contentType: 'application/pdf',
    });
    await request(app.getHttpServer())
      .post(`/vault/files/${file.id}/confirm-upload`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return { id: file.id, storageKey };
  }

  /** Full upload of a NEW VERSION: request version URL → confirm (+prune). */
  async function uploadVersion(
    token: string,
    fileId: string,
    sizeBytes: number,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mimeType: 'application/pdf', sizeBytes })
      .expect(201);
    const { storageKey } = res.body.data;
    storage.objects.set(storageKey, {
      sizeBytes,
      contentType: 'application/pdf',
    });
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/versions/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return storageKey;
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
      firstName: 'File',
      lastName: 'Owner',
      email: `file.owner.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });
    const outsider = await createEmployee({
      firstName: 'File',
      lastName: 'Outsider',
      email: `file.out.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: hrVerticalId,
      reportingManagerId: superAdminId,
    });

    ownerToken = await login(owner.email, 'S3curePass!');
    outsiderToken = await login(outsider.email, 'S3curePass!');
  });

  afterAll(async () => {
    await prisma.vaultFileVersion.deleteMany({
      where: { file: { folderId: { in: createdFolderIds } } },
    });
    await prisma.vaultFile.deleteMany({
      where: { folderId: { in: createdFolderIds } },
    });
    await prisma.vaultFolderPermission.deleteMany({
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

  it('upload flow: presigned URL → (browser PUT) → confirm finalizes the record', async () => {
    const folderId = await createFolder(ownerToken, {
      name: 'Docs',
      type: 'CUSTOM',
    });
    const urlRes = await request(app.getHttpServer())
      .post('/vault/files/upload-url')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        folderId,
        name: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
      })
      .expect(201);
    expect(urlRes.body.data.uploadUrl).toContain('https://fake-r2/');
    expect(urlRes.body.data.file.status).toBe('PENDING');
    const fileId = urlRes.body.data.file.id;
    const storageKey = urlRes.body.data.storageKey;

    // Browser uploads directly to R2 (simulated).
    storage.objects.set(storageKey, {
      sizeBytes: 1234,
      contentType: 'application/pdf',
    });

    const confirmRes = await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/confirm-upload`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    expect(confirmRes.body.data.status).toBe('ACTIVE');
  });

  it('a PENDING (never-confirmed) file does NOT appear in the folder listing', async () => {
    const folderId = await createFolder(ownerToken, {
      name: 'Pending Check',
      type: 'CUSTOM',
    });
    // Request an upload URL but never confirm — mirrors a browser PUT that
    // failed (e.g. R2 CORS-blocked). The file stays PENDING.
    const urlRes = await request(app.getHttpServer())
      .post('/vault/files/upload-url')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        folderId,
        name: 'never-landed.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 500,
      })
      .expect(201);
    expect(urlRes.body.data.file.status).toBe('PENDING');

    // The listing shows ACTIVE files only — the PENDING one is absent.
    const list = await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}/files`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(list.body.data).toHaveLength(0);

    // After a real confirm it appears.
    await uploadFile(ownerToken, folderId, 'landed.pdf', 500);
    const list2 = await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}/files`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(list2.body.data).toHaveLength(1);
    expect(list2.body.data[0].name).toBe('landed.pdf');
  });

  it('storage failure while minting the presigned URL leaves NO orphaned file row', async () => {
    const folderId = await createFolder(ownerToken, {
      name: 'Orphan Check',
      type: 'CUSTOM',
    });
    // Simulate unconfigured/unreachable storage: presign throws. This is the
    // "Vault file storage is not configured" case from the field. The presign
    // happens BEFORE any DB write, so the request must fail with zero rows
    // created — no PENDING orphan that looks like a successful upload.
    const original = storage.createUploadUrl.bind(storage);
    storage.createUploadUrl = async () => {
      throw new Error('Vault file storage is not configured');
    };
    try {
      await request(app.getHttpServer())
        .post('/vault/files/upload-url')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          folderId,
          name: 'ghost.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1234,
        })
        .expect(500);
    } finally {
      storage.createUploadUrl = original;
    }
    const count = await prisma.vaultFile.count({ where: { folderId } });
    expect(count).toBe(0);
  });

  it('rejects an upload-url request for a folder without write permission (no URL issued)', async () => {
    const folderId = await createFolder(ownerToken, {
      name: 'Private Docs',
      type: 'CUSTOM',
    });
    // Outsider (different vertical, not in owner's team) has no TEAM access.
    await request(app.getHttpServer())
      .post('/vault/files/upload-url')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({
        folderId,
        name: 'sneaky.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
      })
      .expect(403);
    // No file record was created for that folder.
    const count = await prisma.vaultFile.count({ where: { folderId } });
    expect(count).toBe(0);
  });

  it('versioning folder: new versions increment number, move currentVersionId, keep old versions', async () => {
    const folderId = await createFolder(ownerToken, {
      name: 'Versioned',
      type: 'CUSTOM',
    });
    await prisma.vaultFolder.update({
      where: { id: folderId },
      data: { versioningEnabled: true, maxVersionsRetained: null },
    });
    const { id: fileId } = await uploadFile(ownerToken, folderId, 'v.pdf', 100);
    await uploadVersion(ownerToken, fileId, 200);
    await uploadVersion(ownerToken, fileId, 300);

    const versions = await request(app.getHttpServer())
      .get(`/vault/files/${fileId}/versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(versions.body.data.map((v: any) => v.versionNumber)).toEqual([
      1, 2, 3,
    ]);

    const file = await prisma.vaultFile.findUniqueOrThrow({
      where: { id: fileId },
    });
    const current = await prisma.vaultFileVersion.findUniqueOrThrow({
      where: { id: file.currentVersionId as string },
    });
    expect(current.versionNumber).toBe(3);
    // Old versions still downloadable.
    const v1 = versions.body.data[0];
    await request(app.getHttpServer())
      .get(`/vault/files/${fileId}/download-url?versionId=${v1.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  });

  it('restore creates a NEW higher version copying the target; history stays intact and ordered', async () => {
    const folderId = await createFolder(ownerToken, {
      name: 'Restore',
      type: 'CUSTOM',
    });
    await prisma.vaultFolder.update({
      where: { id: folderId },
      data: { versioningEnabled: true, maxVersionsRetained: null },
    });
    const { id: fileId } = await uploadFile(ownerToken, folderId, 'r.pdf', 100);
    await uploadVersion(ownerToken, fileId, 200); // v2

    const before = await request(app.getHttpServer())
      .get(`/vault/files/${fileId}/versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const v1 = before.body.data.find((v: any) => v.versionNumber === 1);

    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/versions/${v1.id}/restore`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    const after = await request(app.getHttpServer())
      .get(`/vault/files/${fileId}/versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    // v1 and v2 untouched; a new v3 exists copying v1's size + noting the restore.
    expect(after.body.data.map((v: any) => v.versionNumber)).toEqual([1, 2, 3]);
    const v3 = after.body.data[2];
    expect(v3.sizeBytes).toBe('100');
    expect(v3.changeNote).toContain('Restored from version 1');

    const file = await prisma.vaultFile.findUniqueOrThrow({
      where: { id: fileId },
    });
    expect(file.currentVersionId).toBe(v3.id);
  });

  it('pruning: a 6th version in a maxVersionsRetained=5 folder deletes the oldest R2 object', async () => {
    const folderId = await createFolder(ownerToken, {
      name: 'Capped',
      type: 'CUSTOM',
    });
    await prisma.vaultFolder.update({
      where: { id: folderId },
      data: { versioningEnabled: true, maxVersionsRetained: 5 },
    });
    const { id: fileId, storageKey: v1Key } = await uploadFile(
      ownerToken,
      folderId,
      'c.pdf',
      10,
    );
    // Bring it up to 5 versions total — no prune yet.
    for (let i = 2; i <= 5; i++)
      await uploadVersion(ownerToken, fileId, i * 10);
    expect(storage.objects.has(v1Key)).toBe(true);
    expect(await prisma.vaultFileVersion.count({ where: { fileId } })).toBe(5);

    // 6th version → oldest (v1) must be pruned from BOTH the DB and R2.
    await uploadVersion(ownerToken, fileId, 60);

    expect(await prisma.vaultFileVersion.count({ where: { fileId } })).toBe(5);
    // Direct storage check: v1's object is actually gone.
    expect(storage.objects.has(v1Key)).toBe(false);
    const remaining = await prisma.vaultFileVersion.findMany({
      where: { fileId },
      orderBy: { versionNumber: 'asc' },
    });
    expect(remaining.map((v) => v.versionNumber)).toEqual([2, 3, 4, 5, 6]);
  });

  it('maxVersionsRetained = null never prunes, however many versions', async () => {
    const folderId = await createFolder(ownerToken, {
      name: 'Unbounded',
      type: 'CUSTOM',
    });
    await prisma.vaultFolder.update({
      where: { id: folderId },
      data: { versioningEnabled: true, maxVersionsRetained: null },
    });
    const { id: fileId, storageKey: v1Key } = await uploadFile(
      ownerToken,
      folderId,
      'u.pdf',
      10,
    );
    for (let i = 2; i <= 8; i++)
      await uploadVersion(ownerToken, fileId, i * 10);

    expect(await prisma.vaultFileVersion.count({ where: { fileId } })).toBe(8);
    expect(storage.objects.has(v1Key)).toBe(true); // oldest still present
  });

  it('deleting a file soft-deletes it and frees ALL version objects; no single-version delete exists', async () => {
    const folderId = await createFolder(ownerToken, {
      name: 'ToDelete',
      type: 'CUSTOM',
    });
    await prisma.vaultFolder.update({
      where: { id: folderId },
      data: { versioningEnabled: true, maxVersionsRetained: null },
    });
    const { id: fileId } = await uploadFile(ownerToken, folderId, 'd.pdf', 10);
    await uploadVersion(ownerToken, fileId, 20);
    const versions = await prisma.vaultFileVersion.findMany({
      where: { fileId },
    });
    const keys = versions.map((v) => v.storageKey);
    keys.forEach((k) => expect(storage.objects.has(k)).toBe(true));

    await request(app.getHttpServer())
      .delete(`/vault/files/${fileId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    const file = await prisma.vaultFile.findUniqueOrThrow({
      where: { id: fileId },
    });
    expect(file.status).toBe('DELETED');
    // Every version's object freed together.
    keys.forEach((k) => expect(storage.objects.has(k)).toBe(false));
    // The file is no longer retrievable via the API.
    await request(app.getHttpServer())
      .get(`/vault/files/${fileId}/versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });

  it('non-versioned folder: duplicate filename creates a SEPARATE file, not a new version', async () => {
    const folderId = await createFolder(ownerToken, {
      name: 'Flat',
      type: 'CUSTOM',
    });
    // versioningEnabled defaults false.
    const a = await uploadFile(ownerToken, folderId, 'same.pdf', 10);
    const b = await uploadFile(ownerToken, folderId, 'same.pdf', 20);
    expect(a.id).not.toBe(b.id);

    // A new-version request against a non-versioned folder is rejected.
    await request(app.getHttpServer())
      .post(`/vault/files/${a.id}/versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ mimeType: 'application/pdf', sizeBytes: 30 })
      .expect(400);

    const files = await prisma.vaultFile.findMany({ where: { folderId } });
    expect(files).toHaveLength(2);
    files.forEach((f) =>
      expect(
        prisma.vaultFileVersion.count({ where: { fileId: f.id } }),
      ).resolves.toBe(1),
    );
  });
});
