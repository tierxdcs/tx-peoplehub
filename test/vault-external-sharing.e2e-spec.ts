import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { VaultStorageService } from '../src/modules/vault/vault-storage.service';

/**
 * Vault Phase 5 e2e: security guardrails + external share links, PLUS the
 * full five-phase end-to-end walk (the spec's final checklist item).
 *
 * R2 is a byte-holding in-memory fake; the preview pipeline is left native
 * (PDF/image = READY immediately) so no Gotenberg is needed here.
 */
class FakeStorage {
  objects = new Map<string, Buffer>();
  buildStorageKey(fileId: string, v: number) {
    return `vault/files/${fileId}/v${v}`;
  }
  buildPreviewStorageKey(fileId: string, v: number) {
    return `vault/files/${fileId}/v${v}-preview.pdf`;
  }
  async createUploadUrl(storageKey: string) {
    return { url: `https://fake-r2/${storageKey}`, expiresInSeconds: 300 };
  }
  async createDownloadUrl(storageKey: string) {
    return { url: `https://fake-r2/${storageKey}?get`, expiresInSeconds: 300 };
  }
  async headObject(storageKey: string) {
    const b = this.objects.get(storageKey);
    return b ? { sizeBytes: b.length, contentType: null } : null;
  }
  async getObjectBytes(storageKey: string) {
    const b = this.objects.get(storageKey);
    if (!b) throw new Error('missing');
    return b;
  }
  async putObjectBytes(storageKey: string, bytes: Buffer) {
    this.objects.set(storageKey, bytes);
  }
  async copyObject(from: string, to: string) {
    const b = this.objects.get(from);
    if (b) this.objects.set(to, Buffer.from(b));
  }
  async deleteObject(storageKey: string) {
    this.objects.delete(storageKey);
  }
}

const PDF = 'application/pdf';

describe('Vault external sharing + guardrails + full E2E (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: FakeStorage;
  let adminToken: string;
  let ownerToken: string;
  let ownerId: string;
  let outsiderToken: string;
  let superAdminId: string;
  let salesVerticalId: string;

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
  async function makeFolder(
    token: string,
    name: string,
    versioning = false,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, type: 'CUSTOM' })
      .expect(201);
    const id = res.body.data.id;
    createdFolderIds.push(id);
    if (versioning) {
      await prisma.vaultFolder.update({
        where: { id },
        data: { versioningEnabled: true, maxVersionsRetained: null },
      });
    }
    return id;
  }
  async function uploadFile(
    token: string,
    folderId: string,
    name: string,
    body: string,
    mimeType = PDF,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/vault/files/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({ folderId, name, mimeType, sizeBytes: Buffer.byteLength(body) })
      .expect(201);
    storage.objects.set(res.body.data.storageKey, Buffer.from(body));
    await request(app.getHttpServer())
      .post(`/vault/files/${res.body.data.file.id}/confirm-upload`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return res.body.data.file.id as string;
  }
  async function uploadVersion(
    token: string,
    fileId: string,
    body: string,
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mimeType: PDF, sizeBytes: Buffer.byteLength(body) })
      .expect(201);
    storage.objects.set(res.body.data.storageKey, Buffer.from(body));
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/versions/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
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
      firstName: 'Ext',
      lastName: 'Owner',
      email: `ext.owner.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });
    ownerId = owner.id;
    const outsider = await createEmployee({
      firstName: 'Ext',
      lastName: 'Outsider',
      email: `ext.out.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: hrVerticalId,
      reportingManagerId: superAdminId,
    });
    ownerToken = await login(owner.email, 'S3curePass!');
    outsiderToken = await login(outsider.email, 'S3curePass!');

    // The owner was created via POST /employees (no auto personal folder —
    // only /employees/onboard provisions one). Create it directly so the
    // quota + PERSONAL-folder-link tests have one to target.
    const personal = await prisma.vaultFolder.create({
      data: {
        name: 'My Documents',
        type: 'PERSONAL',
        ownerId,
        visibilityScope: 'PRIVATE',
      },
    });
    createdFolderIds.push(personal.id);
  });

  afterAll(async () => {
    await prisma.vaultExternalAccessLog.deleteMany({
      where: { shareLink: { createdById: { in: createdEmployeeIds } } },
    });
    await prisma.vaultExternalShareLink.deleteMany({
      where: { createdById: { in: createdEmployeeIds } },
    });
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

  // ── Guardrails ──────────────────────────────────────────────────────
  it('rejects a blocked extension before issuing a presigned URL', async () => {
    const folderId = await makeFolder(ownerToken, 'Guard');
    const res = await request(app.getHttpServer())
      .post('/vault/files/upload-url')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        folderId,
        name: 'malware.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 10,
      })
      .expect(400);
    expect(res.body.message).toMatch(/\.exe.*not allowed/i);
    // No file row created.
    expect(await prisma.vaultFile.count({ where: { folderId } })).toBe(0);
  });

  it('rejects a file over the 500MB cap', async () => {
    const folderId = await makeFolder(ownerToken, 'Big');
    const res = await request(app.getHttpServer())
      .post('/vault/files/upload-url')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        folderId,
        name: 'huge.pdf',
        mimeType: PDF,
        sizeBytes: 500 * 1024 * 1024 + 1,
      })
      .expect(400);
    expect(res.body.message).toMatch(/limit/i);
  });

  it('enforces the 5GB personal-folder quota (cumulative), independent of the per-file cap', async () => {
    const personal = await prisma.vaultFolder.findFirstOrThrow({
      where: { ownerId, type: 'PERSONAL' },
    });
    // Seed existing usage near the 5GB quota with a completed file+version
    // (a big sizeBytes; no real bytes needed — the quota sums the column).
    const near = BigInt(5 * 1024 * 1024 * 1024 - 100 * 1024 * 1024); // 5GB - 100MB
    const seeded = await prisma.vaultFile.create({
      data: {
        folderId: personal.id,
        name: 'existing.pdf',
        uploadedById: ownerId,
        status: 'ACTIVE',
      },
    });
    await prisma.vaultFileVersion.create({
      data: {
        fileId: seeded.id,
        versionNumber: 1,
        mimeType: PDF,
        sizeBytes: near,
        storageKey: 'seed/key',
        uploadedById: ownerId,
      },
    });

    // A within-cap (200MB < 500MB) upload that pushes cumulative over 5GB → quota error.
    const overQuota = await request(app.getHttpServer())
      .post('/vault/files/upload-url')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        folderId: personal.id,
        name: 'ok-size.pdf',
        mimeType: PDF,
        sizeBytes: 200 * 1024 * 1024,
      })
      .expect(400);
    expect(overQuota.body.message).toMatch(/quota/i);

    // A small upload that stays under quota still succeeds.
    await request(app.getHttpServer())
      .post('/vault/files/upload-url')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        folderId: personal.id,
        name: 'tiny.pdf',
        mimeType: PDF,
        sizeBytes: 1024,
      })
      .expect(201);
  });

  // ── External share links ────────────────────────────────────────────
  it('creating an external link requires WRITE access to the resource', async () => {
    // A COMPANY_WIDE default folder: every employee reads it, but only
    // MANAGER+ gets write. This is exactly where the read-vs-write gate bites.
    const companyWide = await prisma.vaultFolder.create({
      data: {
        name: 'Company Handbook',
        type: 'DEFAULT',
        ownerId: superAdminId,
        visibilityScope: 'COMPANY_WIDE',
      },
    });
    createdFolderIds.push(companyWide.id);
    // Owner is a MANAGER → has write on company-wide, so can upload the file.
    const fileId = await uploadFile(ownerToken, companyWide.id, 's.pdf', 'X');

    // A read-only EMPLOYEE can VIEW the file but must NOT be able to mint a
    // public link to it — link creation now matches the upload/internal-share
    // bar (write), not read.
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share-link`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({})
      .expect(403);

    // The MANAGER (write access) still can.
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share-link`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
  });

  it('a PERSONAL folder cannot be link-shared whole, but a file within it can', async () => {
    const personal = await prisma.vaultFolder.findFirstOrThrow({
      where: { ownerId, type: 'PERSONAL' },
    });
    await request(app.getHttpServer())
      .post(`/vault/folders/${personal.id}/share-link`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(400);

    // A file inside it shares fine.
    const fileId = await uploadFile(
      ownerToken,
      personal.id,
      'mine.pdf',
      'PERSONAL',
    );
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share-link`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
  });

  it('link is accessible with zero auth; enforces expiry, revocation, password; logs every attempt', async () => {
    const folderId = await makeFolder(ownerToken, 'Public');
    const fileId = await uploadFile(
      ownerToken,
      folderId,
      'p.pdf',
      'PUBLIC-BODY',
    );

    // Password-protected link.
    const created = await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share-link`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ password: 'letmein' })
      .expect(201);
    const { token, id: linkId } = created.body.data;
    expect(created.body.data.permission).toBe('VIEW');
    expect(created.body.data.hasPassword).toBe(true);

    // No auth header at all → still resolves. Password travels in the POST
    // body (never the query string / URL).
    const ok = await request(app.getHttpServer())
      .post(`/public/vault/shared/${token}`)
      .send({ password: 'letmein' })
      .expect(201);
    expect(ok.body.data.url).toContain('https://fake-r2/');

    // Wrong password → 403 (still logged).
    await request(app.getHttpServer())
      .post(`/public/vault/shared/${token}`)
      .send({ password: 'nope' })
      .expect(403);

    // A GET (no body) against a password-protected link → 403 (no password
    // supplied). Confirms GET can't be used to sidestep the password.
    await request(app.getHttpServer())
      .get(`/public/vault/shared/${token}`)
      .expect(403);

    // Both attempts were logged.
    const logs = await prisma.vaultExternalAccessLog.count({
      where: { shareLinkId: linkId },
    });
    expect(logs).toBeGreaterThanOrEqual(2);

    // Revoke → immediately dead, even though not expired.
    await request(app.getHttpServer())
      .delete(`/vault/share-links/${linkId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .post(`/public/vault/shared/${token}`)
      .send({ password: 'letmein' })
      .expect(403);

    // An expired link is also rejected.
    const created2 = await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share-link`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    await prisma.vaultExternalShareLink.update({
      where: { id: created2.body.data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.getHttpServer())
      .get(`/public/vault/shared/${created2.body.data.token}`)
      .expect(403);
  });

  it('version pinning: uploading v2 after the link is created does NOT change what the link serves', async () => {
    const folderId = await makeFolder(ownerToken, 'Pin', true);
    const fileId = await uploadFile(
      ownerToken,
      folderId,
      'pin.pdf',
      'V1-CONTENT',
    );

    // Link pins v1.
    const created = await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share-link`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    const token = created.body.data.token;

    // Upload v2 (new current version).
    await uploadVersion(ownerToken, fileId, 'V2-CONTENT');

    // The link still resolves to v1's object, not v2.
    const res = await request(app.getHttpServer())
      .get(`/public/vault/shared/${token}`)
      .expect(200);
    // URL points at v1's key; fetch the underlying bytes to be sure.
    const key = res.body.data.url
      .replace('https://fake-r2/', '')
      .replace('?get', '');
    expect(storage.objects.get(key)?.toString('utf8')).toBe('V1-CONTENT');
  });

  // ── Read layer (folder browser / file list / share lists) ───────────
  it('lists root folders the caller can see, Personal first', async () => {
    // Owner has a PERSONAL folder (seeded in beforeAll) + CUSTOM folders made
    // in earlier tests. Roots come back Personal-first.
    const res = await request(app.getHttpServer())
      .get('/vault/folders/roots')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const roots = res.body.data as Array<{
      id: string;
      type: string;
      access: { canRead: boolean };
    }>;
    expect(roots.length).toBeGreaterThan(0);
    expect(roots[0].type).toBe('PERSONAL');
    expect(roots.every((r) => r.access.canRead)).toBe(true);
    // The outsider (different vertical, no shares) does not see the owner's
    // private personal folder among their roots.
    const personal = await prisma.vaultFolder.findFirstOrThrow({
      where: { ownerId, type: 'PERSONAL' },
    });
    const outsiderRes = await request(app.getHttpServer())
      .get('/vault/folders/roots')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);
    expect(
      (outsiderRes.body.data as Array<{ id: string }>).some(
        (r) => r.id === personal.id,
      ),
    ).toBe(false);
  });

  it('lists files in a folder enriched with size/version/preview + per-file access', async () => {
    const folderId = await makeFolder(ownerToken, 'ListFiles');
    await uploadFile(ownerToken, folderId, 'a.pdf', 'AAAA');
    await uploadFile(ownerToken, folderId, 'b.pdf', 'BBBBBB');

    const res = await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}/files`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const files = res.body.data as Array<{
      name: string;
      sizeBytes: string | null;
      versionCount: number;
      previewStatus: string | null;
      uploadedByName: string | null;
      access: { canRead: boolean; canWrite: boolean };
    }>;
    expect(files.map((f) => f.name).sort()).toEqual(['a.pdf', 'b.pdf']);
    const a = files.find((f) => f.name === 'a.pdf')!;
    expect(a.sizeBytes).toBe(String('AAAA'.length));
    expect(a.versionCount).toBe(1);
    expect(a.uploadedByName).toContain('Ext'); // owner is "Ext Owner"
    expect(a.access.canWrite).toBe(true);

    // Outsider without access is forbidden from listing.
    await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}/files`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
  });

  it('single-file detail is enriched and read-gated', async () => {
    const folderId = await makeFolder(ownerToken, 'Detail');
    const fileId = await uploadFile(ownerToken, folderId, 'd.pdf', 'DD');
    const res = await request(app.getHttpServer())
      .get(`/vault/files/${fileId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body.data.id).toBe(fileId);
    expect(res.body.data.sizeBytes).toBe(String('DD'.length));
    expect(res.body.data.access.canRead).toBe(true);

    await request(app.getHttpServer())
      .get(`/vault/files/${fileId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
  });

  it('lists internal shares on a file and revokes one (access lost afterward)', async () => {
    const folderId = await makeFolder(ownerToken, 'ShareList');
    const fileId = await uploadFile(ownerToken, folderId, 'sh.pdf', 'SH');

    // Share with the outsider (VIEW).
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sharedWithEmployeeId: createdEmployeeIds[1], permission: 'VIEW' })
      .expect(201);

    // Recipient can now read the file's detail.
    await request(app.getHttpServer())
      .get(`/vault/files/${fileId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);

    // The share appears in the file's share list with the recipient's name.
    const listed = await request(app.getHttpServer())
      .get(`/vault/files/${fileId}/shares`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const shares = listed.body.data as Array<{
      id: string;
      sharedWithEmployeeId: string;
      sharedWithEmployeeName: string | null;
      permission: string;
    }>;
    expect(shares).toHaveLength(1);
    expect(shares[0].sharedWithEmployeeId).toBe(createdEmployeeIds[1]);
    expect(shares[0].sharedWithEmployeeName).toContain('Ext');

    // A file route cannot revoke via a mismatched folder path (404 guard).
    await request(app.getHttpServer())
      .delete(`/vault/folders/${folderId}/shares/${shares[0].id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);

    // Revoke it via the correct nested file route → recipient loses access.
    await request(app.getHttpServer())
      .delete(`/vault/files/${fileId}/shares/${shares[0].id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/vault/files/${fileId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
    // List is now empty.
    const after = await request(app.getHttpServer())
      .get(`/vault/files/${fileId}/shares`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(after.body.data).toHaveLength(0);

    // A recipient (non-manager) cannot view the share list.
    await request(app.getHttpServer())
      .get(`/vault/files/${fileId}/shares`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
  });

  it('lists active external links for a file with an access count; revoked links drop off', async () => {
    const folderId = await makeFolder(ownerToken, 'LinkList');
    const fileId = await uploadFile(ownerToken, folderId, 'lk.pdf', 'LK');

    const created = await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share-link`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    const { token, id: linkId } = created.body.data;

    // Hit the public link twice → access count = 2.
    await request(app.getHttpServer())
      .get(`/public/vault/shared/${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/public/vault/shared/${token}`)
      .expect(200);

    const listed = await request(app.getHttpServer())
      .get(`/vault/files/${fileId}/share-links`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const links = listed.body.data as Array<{
      id: string;
      token: string;
      accessCount: number;
    }>;
    expect(links).toHaveLength(1);
    expect(links[0].token).toBe(token);
    expect(links[0].accessCount).toBeGreaterThanOrEqual(2);

    // Revoke → it drops off the active list.
    await request(app.getHttpServer())
      .delete(`/vault/share-links/${linkId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    const after = await request(app.getHttpServer())
      .get(`/vault/files/${fileId}/share-links`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(after.body.data).toHaveLength(0);
  });

  it('folder internal shares: list + nested revoke', async () => {
    const folderId = await makeFolder(ownerToken, 'FolderShareList');
    await request(app.getHttpServer())
      .post(`/vault/folders/${folderId}/share`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sharedWithEmployeeId: createdEmployeeIds[1], permission: 'EDIT' })
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}/shares`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const shares = listed.body.data as Array<{
      id: string;
      permission: string;
    }>;
    expect(shares).toHaveLength(1);
    expect(shares[0].permission).toBe('EDIT');

    await request(app.getHttpServer())
      .delete(`/vault/folders/${folderId}/shares/${shares[0].id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    const after = await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}/shares`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(after.body.data).toHaveLength(0);
  });

  it('a VIEW-only file share yields read-only per-file access (no write/delete)', async () => {
    const folderId = await makeFolder(ownerToken, 'ViewOnlyAccess');
    const fileId = await uploadFile(ownerToken, folderId, 'vo.pdf', 'VO');
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sharedWithEmployeeId: createdEmployeeIds[1], permission: 'VIEW' })
      .expect(201);

    // Recipient (no folder access) sees the file, with read-only access flags.
    const res = await request(app.getHttpServer())
      .get(`/vault/files/${fileId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);
    expect(res.body.data.access).toMatchObject({
      canRead: true,
      canWrite: false,
      canDelete: false,
    });
  });

  it('employee search returns lean partial name/email matches to any employee', async () => {
    // The outsider (a plain EMPLOYEE) can use the picker search.
    const res = await request(app.getHttpServer())
      .get('/employees/search?q=Ext')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);
    const results = res.body.data as Array<{
      id: string;
      fullName: string;
      email: string;
    }>;
    expect(results.length).toBeGreaterThan(0);
    // Every result matches the term somewhere in name/email.
    expect(
      results.every((r) => /ext/i.test(r.fullName) || /ext/i.test(r.email)),
    ).toBe(true);
    // Lean shape — no sensitive fields leaked.
    expect(results[0]).not.toHaveProperty('role');
    expect(results[0]).not.toHaveProperty('accessStatus');

    // A blank term is rejected by validation (MinLength 1).
    await request(app.getHttpServer())
      .get('/employees/search?q=')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(400);
  });

  // ── Full five-phase E2E ─────────────────────────────────────────────
  it('full E2E: onboard → personal folder → custom folder → upload → v2 → restore → internal share → external link (pinned) → access → revoke → dead', async () => {
    const suffix = Date.now();

    // Phase 1: onboard an employee → personal folder auto-created.
    const onboardRes = await request(app.getHttpServer())
      .post('/employees/onboard')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'E2E',
        lastName: 'Newbie',
        dateOfBirth: '1995-01-01',
        gender: 'F',
        personalEmail: `e2e.newbie.${suffix}@personal.example`,
        mobile: '9000000000',
        designation: 'Analyst',
        employmentType: 'FULL_TIME_PERMANENT',
        dateOfJoining: '2026-07-01',
        workLocation: 'Bengaluru',
        verticalId: salesVerticalId,
        emergencyContactName: 'EC',
        emergencyContactRelation: 'Parent',
        emergencyContactPhone: '8000000000',
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
    const newEmpId = onboardRes.body.data.id;
    createdEmployeeIds.push(newEmpId);
    const personal = await prisma.vaultFolder.findFirstOrThrow({
      where: { ownerId: newEmpId, type: 'PERSONAL' },
    });
    expect(personal.visibilityScope).toBe('PRIVATE');

    // Phase 1: custom team folder (versioned) owned by the manager.
    const folderId = await makeFolder(ownerToken, 'E2E Team', true);

    // Phase 2: upload a file, then a 2nd version.
    const fileId = await uploadFile(
      ownerToken,
      folderId,
      'e2e.pdf',
      'CONTENT-V1',
    );
    await uploadVersion(ownerToken, fileId, 'CONTENT-V2');
    let versions = await prisma.vaultFileVersion.findMany({
      where: { fileId },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2]);

    // Phase 2: restore v1 → creates v3 (append-only), history intact.
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/versions/${versions[0].id}/restore`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    versions = await prisma.vaultFileVersion.findMany({
      where: { fileId },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2, 3]);

    // Phase 3: internal-share the file with the HR outsider (VIEW).
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sharedWithEmployeeId: createdEmployeeIds[1], permission: 'VIEW' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/vault/files/${fileId}/versions`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);

    // Phase 5: external link — pins the current version (v3 = restored v1).
    const linkRes = await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/share-link`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    const { token, id: linkId, pinnedVersionId } = linkRes.body.data;
    expect(pinnedVersionId).toBe(versions[2].id); // v3

    // Upload v4 AFTER the link — the link must keep serving v3's bytes.
    await uploadVersion(ownerToken, fileId, 'CONTENT-V4');
    const access = await request(app.getHttpServer())
      .get(`/public/vault/shared/${token}`)
      .expect(200);
    const key = access.body.data.url
      .replace('https://fake-r2/', '')
      .replace('?get', '');
    // v3 was a restore of v1 → its bytes are v1's content.
    expect(storage.objects.get(key)?.toString('utf8')).toBe('CONTENT-V1');

    // Revoke → link dead.
    await request(app.getHttpServer())
      .delete(`/vault/share-links/${linkId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/public/vault/shared/${token}`)
      .expect(403);

    // Guardrails still enforced in this flow.
    await request(app.getHttpServer())
      .post('/vault/files/upload-url')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ folderId, name: 'x.bat', mimeType: 'text/plain', sizeBytes: 1 })
      .expect(400);
  });
});
