import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { VaultStorageService } from '../src/modules/vault/vault-storage.service';

/**
 * Vault Phase 4 e2e: the preview pipeline end-to-end through the API.
 *   - PDF/image → previewStatus READY immediately (preview = original).
 *   - .docx → PENDING then READY once the (mocked) Gotenberg conversion runs,
 *     with the resulting preview a distinct object per version.
 *   - unsupported type → NOT_APPLICABLE, no conversion.
 *   - two .docx versions → two independent previews (no stale cache).
 *   - a Gotenberg failure → previewStatus FAILED (never stuck at PENDING).
 *
 * R2 is a byte-holding in-memory fake; Gotenberg is a mocked global.fetch that
 * returns a per-input PDF (or an error, to exercise the failure path).
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
  async getObjectBytes(storageKey: string): Promise<Buffer> {
    const b = this.objects.get(storageKey);
    if (!b) throw new Error(`no object at ${storageKey}`);
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

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('Vault preview pipeline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: FakeStorage;
  let adminToken: string;
  let ownerToken: string;
  let superAdminId: string;
  let salesVerticalId: string;
  let fetchSpy: jest.SpyInstance;
  /** Toggle to force the mocked Gotenberg to fail (corrupted-file simulation). */
  let gotenbergShouldFail = false;

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

  /** Upload a file (v1) with a given mime + body bytes, through the real API. */
  async function uploadFile(
    folderId: string,
    name: string,
    mimeType: string,
    body: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/vault/files/upload-url')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ folderId, name, mimeType, sizeBytes: Buffer.byteLength(body) })
      .expect(201);
    const { storageKey, file } = res.body.data;
    storage.objects.set(storageKey, Buffer.from(body));
    await request(app.getHttpServer())
      .post(`/vault/files/${file.id}/confirm-upload`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    return file.id as string;
  }

  async function uploadVersion(
    fileId: string,
    mimeType: string,
    body: string,
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ mimeType, sizeBytes: Buffer.byteLength(body) })
      .expect(201);
    storage.objects.set(res.body.data.storageKey, Buffer.from(body));
    await request(app.getHttpServer())
      .post(`/vault/files/${fileId}/versions/confirm`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
  }

  /** Poll view-url until the preview leaves PENDING (async conversion). */
  async function waitForPreview(fileId: string, versionId?: string) {
    const q = versionId ? `?versionId=${versionId}` : '';
    for (let i = 0; i < 40; i++) {
      const res = await request(app.getHttpServer())
        .get(`/vault/files/${fileId}/view-url${q}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      if (res.body.data.previewStatus !== 'PENDING') return res.body.data;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('preview stuck at PENDING');
  }

  beforeAll(async () => {
    // The preview service reads GOTENBERG_URL from config at construction;
    // set it here so this spec is self-contained in the full e2e run (the
    // fetch mock below stands in for the real Gotenberg service).
    process.env.GOTENBERG_URL =
      process.env.GOTENBERG_URL ?? 'http://fake-gotenberg.local';

    storage = new FakeStorage();
    // Mock Gotenberg: echo a per-input PDF so different versions differ; or
    // fail when the corrupted-file flag is set.
    fetchSpy = jest
      .spyOn(global, 'fetch' as any)
      .mockImplementation(async (_url: any, init: any) => {
        if (gotenbergShouldFail) {
          return { ok: false, status: 500, text: async () => 'bad doc' } as any;
        }
        // Derive a deterministic "PDF" from the uploaded form bytes so each
        // version's preview is distinguishable.
        const form = init.body as FormData;
        const file = form.get('files') as Blob;
        const src = Buffer.from(await file.arrayBuffer()).toString('utf8');
        // Return a Blob so arrayBuffer() yields exactly these bytes (avoids
        // the Node Buffer-pool gotcha where buf.buffer is the shared pool).
        const pdf = new Blob([`%PDF from:${src}`]);
        return { ok: true, arrayBuffer: () => pdf.arrayBuffer() } as any;
      });

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
    // Ensure the preview service sees a Gotenberg URL (config is read at
    // construction from env; set it before the module built above via env).
    await app.init();
    prisma = app.get(PrismaService);

    salesVerticalId = (
      await prisma.vertical.findUniqueOrThrow({ where: { code: 'SALES' } })
    ).id;
    superAdminId = (
      await prisma.employee.findUniqueOrThrow({ where: { email: adminEmail } })
    ).id;
    adminToken = await login(adminEmail, adminPassword);

    const suffix = Date.now();
    const owner = await (async () => {
      const res = await request(app.getHttpServer())
        .post('/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Prev',
          lastName: 'Owner',
          email: `prev.owner.${suffix}@peoplehub.local`,
          password: 'S3curePass!',
          role: 'MANAGER',
          verticalId: salesVerticalId,
          reportingManagerId: superAdminId,
        })
        .expect(201);
      createdEmployeeIds.push(res.body.data.id);
      return res.body.data;
    })();
    ownerToken = await login(owner.email, 'S3curePass!');
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
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

  async function makeFolder(versioning = false): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/vault/folders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Prev', type: 'CUSTOM' })
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

  it('PDF/image → previewStatus READY immediately, preview = original object', async () => {
    const folderId = await makeFolder();
    const pdfId = await uploadFile(
      folderId,
      'a.pdf',
      'application/pdf',
      'PDFBYTES',
    );
    const imgId = await uploadFile(folderId, 'b.png', 'image/png', 'PNGBYTES');

    for (const id of [pdfId, imgId]) {
      const res = await request(app.getHttpServer())
        .get(`/vault/files/${id}/view-url`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.previewStatus).toBe('READY');
      expect(res.body.data.viewUrl).toContain('https://fake-r2/');
    }
    // No conversion object was created for a native type.
    const pdfVersion = await prisma.vaultFileVersion.findFirstOrThrow({
      where: { file: { id: pdfId } },
    });
    expect(pdfVersion.previewStorageKey).toBe(pdfVersion.storageKey);
  });

  it('unsupported type → NOT_APPLICABLE, no conversion attempted', async () => {
    const folderId = await makeFolder();
    const zipId = await uploadFile(folderId, 'c.zip', 'application/zip', 'ZIP');
    const res = await request(app.getHttpServer())
      .get(`/vault/files/${zipId}/view-url`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body.data.previewStatus).toBe('NOT_APPLICABLE');
    expect(res.body.data.viewUrl).toBeNull();
    const v = await prisma.vaultFileVersion.findFirstOrThrow({
      where: { file: { id: zipId } },
    });
    expect(v.previewStorageKey).toBeNull();
  });

  it('.docx → PENDING then READY, producing a valid preview PDF', async () => {
    gotenbergShouldFail = false;
    const folderId = await makeFolder();
    const docId = await uploadFile(folderId, 'd.docx', DOCX, 'DOCX-CONTENT-1');

    const ready = await waitForPreview(docId);
    expect(ready.previewStatus).toBe('READY');
    expect(ready.viewUrl).toContain('-preview.pdf');

    // The stored preview object is the converted PDF derived from the source.
    const v = await prisma.vaultFileVersion.findFirstOrThrow({
      where: { file: { id: docId } },
    });
    const previewBytes = storage.objects.get(v.previewStorageKey as string);
    expect(previewBytes?.toString('utf8')).toBe('%PDF from:DOCX-CONTENT-1');
  });

  it('two .docx versions → two independent previews (no stale cache)', async () => {
    gotenbergShouldFail = false;
    const folderId = await makeFolder(true);
    const docId = await uploadFile(folderId, 'v.docx', DOCX, 'CONTENT-A');
    await waitForPreview(docId);
    await uploadVersion(docId, DOCX, 'CONTENT-B');

    const versions = await prisma.vaultFileVersion.findMany({
      where: { fileId: docId },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions).toHaveLength(2);
    // Wait for v2's conversion (current version) to finish.
    await waitForPreview(docId, versions[1].id);

    const [v1, v2] = await prisma.vaultFileVersion.findMany({
      where: { fileId: docId },
      orderBy: { versionNumber: 'asc' },
    });
    expect(v1.previewStorageKey).not.toBe(v2.previewStorageKey);
    expect(
      storage.objects.get(v1.previewStorageKey as string)?.toString('utf8'),
    ).toBe('%PDF from:CONTENT-A');
    expect(
      storage.objects.get(v2.previewStorageKey as string)?.toString('utf8'),
    ).toBe('%PDF from:CONTENT-B');
  });

  it('conversion failure → previewStatus FAILED, not stuck at PENDING', async () => {
    gotenbergShouldFail = true;
    const folderId = await makeFolder();
    const docId = await uploadFile(folderId, 'bad.docx', DOCX, 'CORRUPT');

    // Poll until it leaves PENDING; it must land on FAILED.
    let status = 'PENDING';
    for (let i = 0; i < 40 && status === 'PENDING'; i++) {
      const res = await request(app.getHttpServer())
        .get(`/vault/files/${docId}/view-url`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      status = res.body.data.previewStatus;
      if (status === 'PENDING') await new Promise((r) => setTimeout(r, 25));
    }
    expect(status).toBe('FAILED');
    gotenbergShouldFail = false;
  });
});
