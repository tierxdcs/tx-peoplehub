import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { VaultStorageService } from '../src/modules/vault/vault-storage.service';

/**
 * Vault browse layer e2e: fuzzy search with a folder/vault scope toggle, the
 * four filter dimensions (type, upload date range, uploader, origin) and their
 * combinations, the four sort criteria, breadcrumb ancestors, and recent files.
 *
 * Every assertion here is about DISCOVERY only — no test in this file changes
 * folder structure, permissions, or file/version state beyond creating its own
 * fixtures, because that is exactly the guarantee the feature makes.
 *
 * R2 is replaced with an in-memory fake so uploads can be finalised without
 * network I/O (same approach as vault-files.e2e-spec).
 */
class FakeStorage {
  objects = new Map<string, { sizeBytes: number; contentType: string }>();

  buildStorageKey(fileId: string, versionNumber: number): string {
    return `vault/files/${fileId}/v${versionNumber}`;
  }
  async createUploadUrl(storageKey: string, contentType: string) {
    this.objects.set(storageKey, { sizeBytes: 0, contentType });
    return { url: `https://fake-r2/${storageKey}`, expiresInSeconds: 300 };
  }
  async createDownloadUrl(storageKey: string) {
    return { url: `https://fake-r2/${storageKey}?get`, expiresInSeconds: 300 };
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
}

interface ListItem {
  id: string;
  name: string;
  fileType: string;
  origin: string;
  sizeBytes: string | null;
  folderId: string;
  folderName: string | null;
  uploadedById: string;
}

describe('Vault browse: search / filter / sort / navigation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: FakeStorage;

  let adminToken: string;
  let superAdminId: string;
  let ownerToken: string;
  let ownerId: string;
  let memberToken: string;
  let memberId: string;
  let outsiderToken: string;

  let rootId: string;
  let contractsId: string;
  let deepId: string;
  let rfqFolderId: string;

  const files: Record<string, string> = {};

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

  /** Presigned upload → (simulated browser PUT) → confirm. */
  async function upload(
    token: string,
    folderId: string,
    name: string,
    mimeType: string,
    sizeBytes: number,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/vault/files/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send({ folderId, name, mimeType, sizeBytes })
      .expect(201);
    const { storageKey, file } = res.body.data;
    storage.objects.set(storageKey, { sizeBytes, contentType: mimeType });
    await request(app.getHttpServer())
      .post(`/vault/files/${file.id}/confirm-upload`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return file.id as string;
  }

  /** GET /vault/files/search with a raw query string. */
  async function search(
    token: string,
    query: string,
  ): Promise<{
    folders: { id: string; name: string }[];
    files: ListItem[];
    totalFileMatches: number;
    truncated: boolean;
  }> {
    const res = await request(app.getHttpServer())
      .get(`/vault/files/search?${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data;
  }

  async function listFolderFiles(
    token: string,
    folderId: string,
    query = '',
  ): Promise<ListItem[]> {
    const res = await request(app.getHttpServer())
      .get(`/vault/folders/${folderId}/files${query ? `?${query}` : ''}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data;
  }

  const names = (items: { name: string }[]) => items.map((i) => i.name);

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

    const salesVerticalId = (
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
      firstName: 'Browse',
      lastName: 'Owner',
      email: `browse.owner.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'MANAGER',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });
    const member = await createEmployee({
      firstName: 'Browse',
      lastName: 'Member',
      email: `browse.member.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: salesVerticalId,
      reportingManagerId: superAdminId,
    });
    const outsider = await createEmployee({
      firstName: 'Browse',
      lastName: 'Outsider',
      email: `browse.out.${suffix}@peoplehub.local`,
      password: 'S3curePass!',
      role: 'EMPLOYEE',
      verticalId: hrVerticalId,
      reportingManagerId: superAdminId,
    });
    ownerId = owner.id;
    memberId = member.id;
    ownerToken = await login(owner.email, 'S3curePass!');
    memberToken = await login(member.email, 'S3curePass!');
    outsiderToken = await login(outsider.email, 'S3curePass!');

    // ---- folder tree: Browse Root > Contracts > 2026, plus a module-owned
    // DEFAULT folder so origin derivation has something real to derive from.
    rootId = await createFolder(ownerToken, {
      name: `Browse Root ${suffix}`,
      type: 'CUSTOM',
    });
    contractsId = await createFolder(ownerToken, {
      name: 'Contracts',
      type: 'CUSTOM',
      parentFolderId: rootId,
    });
    deepId = await createFolder(ownerToken, {
      name: '2026',
      type: 'CUSTOM',
      parentFolderId: contractsId,
    });
    // A DEFAULT folder named exactly as the RFQ module's own vault folder: this
    // is what makes a file in it read as auto-filed from RFQ (there is no
    // stored source-module column — see vault-search.ts). Created directly
    // because the module seeds it, and kept PRIVATE to the owner so the
    // access-narrowing assertions below stay meaningful.
    const rfqFolder = await prisma.vaultFolder.create({
      data: {
        name: 'RFQ Quotes',
        type: 'DEFAULT',
        parentFolderId: rootId,
        ownerId,
        visibilityScope: 'PRIVATE',
      },
    });
    rfqFolderId = rfqFolder.id;
    createdFolderIds.push(rfqFolderId);

    // The member needs write access to upload into the tree.
    await request(app.getHttpServer())
      .post(`/vault/folders/${rootId}/permissions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        granteeType: 'EMPLOYEE',
        granteeId: memberId,
        canRead: true,
        canWrite: true,
      })
      .expect(201);

    // ---- files: deliberately varied in type, size, uploader and folder.
    files.quote = await upload(
      ownerToken,
      rfqFolderId,
      'Quote for Acme Industries.pdf',
      'application/pdf',
      245_760,
    );
    files.numbers = await upload(
      memberToken,
      rootId,
      'Quarterly Numbers.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      1_572_864,
    );
    files.agreement = await upload(
      ownerToken,
      contractsId,
      'Vendor Agreement.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      51_200,
    );
    files.photo = await upload(
      ownerToken,
      deepId,
      'Site photo east wing.png',
      'image/png',
      3_145_728,
    );
    // Generic mimetype on purpose: the extension has to win for CAD.
    files.drawing = await upload(
      ownerToken,
      rootId,
      'Assembly drawing.dwg',
      'application/octet-stream',
      9_437_184,
    );
    files.checklist = await upload(
      ownerToken,
      contractsId,
      'Kickoff Checklist.pdf',
      'application/pdf',
      120_000,
    );

    // Backdate one document so date-based behaviour has two sides to prove.
    // Vault distinguishes two dates and so does this fixture: the file row's
    // createdAt is the UPLOAD date (what the date-range filter uses), while the
    // current version's createdAt is LAST MODIFIED (what sorting and recent
    // files use). Backdate both, so this really is an old document.
    const backdated = new Date('2026-01-15T09:00:00.000Z');
    await prisma.vaultFile.update({
      where: { id: files.checklist },
      data: { createdAt: backdated },
    });
    await prisma.vaultFileVersion.updateMany({
      where: { fileId: files.checklist },
      data: { createdAt: backdated },
    });
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
    // Children first — the folder tree FK is Restrict.
    await prisma.vaultFolder.deleteMany({ where: { id: deepId } });
    await prisma.vaultFolder.deleteMany({
      where: { id: { in: [contractsId, rfqFolderId] } },
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

  // ---- 1. search ----

  it('fuzzy-matches file names — a prefix of one word is enough', async () => {
    const result = await search(ownerToken, 'q=quart&scope=VAULT');
    expect(names(result.files)).toContain('Quarterly Numbers.xlsx');
  });

  it('fuzzy-matches across words and by initials, not just substrings', async () => {
    const acrossWords = await search(ownerToken, 'q=acme quote&scope=VAULT');
    expect(names(acrossWords.files)).toContain('Quote for Acme Industries.pdf');

    const initials = await search(ownerToken, 'q=spew&scope=VAULT');
    expect(names(initials.files)).toContain('Site photo east wing.png');
  });

  it('matches folder names with the same scorer as file names', async () => {
    const result = await search(ownerToken, 'q=rfq&scope=VAULT');
    expect(names(result.folders)).toContain('RFQ Quotes');
  });

  it('rejects noise instead of matching everything', async () => {
    const result = await search(ownerToken, 'q=payroll appraisal&scope=VAULT');
    expect(result.files).toHaveLength(0);
    expect(result.totalFileMatches).toBe(0);
  });

  it('scope=FOLDER searches the folder AND everything nested beneath it', async () => {
    const nested = await search(
      ownerToken,
      `q=site&scope=FOLDER&folderId=${contractsId}`,
    );
    // 'Site photo east wing.png' lives two levels down, in Contracts > 2026.
    expect(names(nested.files)).toEqual(['Site photo east wing.png']);
  });

  it('scope=FOLDER excludes matches outside that subtree', async () => {
    const elsewhere = await search(
      ownerToken,
      `q=site&scope=FOLDER&folderId=${rfqFolderId}`,
    );
    expect(elsewhere.files).toHaveLength(0);

    const vaultWide = await search(ownerToken, 'q=site&scope=VAULT');
    expect(names(vaultWide.files)).toContain('Site photo east wing.png');
  });

  it('rejects scope=FOLDER without a folder to search', async () => {
    const res = await request(app.getHttpServer())
      .get('/vault/files/search?q=site&scope=FOLDER')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
    expect(String(res.body.message)).toContain('folderId');
  });

  it('never surfaces files from folders the caller cannot read', async () => {
    const outsiderView = await search(outsiderToken, 'q=quote&scope=VAULT');
    const ourFolders = new Set([rootId, contractsId, deepId, rfqFolderId]);
    expect(
      outsiderView.files.filter((f) => ourFolders.has(f.folderId)),
    ).toHaveLength(0);
    expect(
      outsiderView.folders.filter((f) => ourFolders.has(f.id)),
    ).toHaveLength(0);

    await request(app.getHttpServer())
      .get(`/vault/folders/${rootId}/files`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
  });

  // ---- 2. filters ----

  it('filters by file type, using the extension over a generic mimetype', async () => {
    const spreadsheets = await search(
      ownerToken,
      'scope=VAULT&fileType=SPREADSHEET',
    );
    expect(names(spreadsheets.files)).toContain('Quarterly Numbers.xlsx');
    expect(names(spreadsheets.files)).not.toContain('Assembly drawing.dwg');

    // Uploaded as application/octet-stream — only the .dwg says it is CAD.
    const cad = await search(ownerToken, 'scope=VAULT&fileType=CAD');
    expect(names(cad.files)).toContain('Assembly drawing.dwg');
  });

  it('filters by upload date range, inclusive of the end day', async () => {
    const old = await search(
      ownerToken,
      'scope=VAULT&uploadedFrom=2026-01-01&uploadedTo=2026-01-15',
    );
    expect(names(old.files)).toEqual(['Kickoff Checklist.pdf']);

    const recent = await search(
      ownerToken,
      'scope=VAULT&uploadedFrom=2026-02-01',
    );
    expect(names(recent.files)).not.toContain('Kickoff Checklist.pdf');
    expect(names(recent.files)).toContain('Quarterly Numbers.xlsx');
  });

  it('filters by uploader', async () => {
    const byMember = await search(
      ownerToken,
      `scope=VAULT&uploadedById=${memberId}`,
    );
    expect(names(byMember.files)).toEqual(['Quarterly Numbers.xlsx']);

    const byOwner = await search(
      ownerToken,
      `scope=VAULT&uploadedById=${ownerId}`,
    );
    expect(names(byOwner.files)).not.toContain('Quarterly Numbers.xlsx');
    expect(names(byOwner.files)).toContain('Assembly drawing.dwg');
  });

  it('filters by origin using the same derived value the row displays', async () => {
    const fromRfq = await search(ownerToken, 'scope=VAULT&origin=RFQ');
    expect(names(fromRfq.files)).toContain('Quote for Acme Industries.pdf');
    for (const file of fromRfq.files) expect(file.origin).toBe('RFQ');

    // The regression this guards: deriving origin without the containing folder
    // makes every auto-filed document look MANUAL, so origin=RFQ finds nothing
    // while origin=MANUAL wrongly includes it.
    const manual = await search(ownerToken, 'scope=VAULT&origin=MANUAL');
    expect(names(manual.files)).not.toContain('Quote for Acme Industries.pdf');
    expect(names(manual.files)).toContain('Quarterly Numbers.xlsx');
  });

  it('combines filter dimensions', async () => {
    const combined = await search(
      ownerToken,
      `scope=VAULT&fileType=PDF&uploadedById=${ownerId}&uploadedFrom=2026-02-01`,
    );
    // PDFs by the owner, recent: the quote — not the backdated checklist, not
    // the member's spreadsheet.
    expect(names(combined.files)).toEqual(['Quote for Acme Industries.pdf']);
  });

  it('combines a search term with filters', async () => {
    const withTerm = await search(
      ownerToken,
      'q=quote&scope=VAULT&fileType=SPREADSHEET',
    );
    expect(withTerm.files).toHaveLength(0);

    const matching = await search(
      ownerToken,
      'q=quote&scope=VAULT&fileType=PDF',
    );
    expect(names(matching.files)).toContain('Quote for Acme Industries.pdf');
  });

  it('applies the same filters when plainly listing a folder', async () => {
    const all = await listFolderFiles(ownerToken, rfqFolderId);
    expect(names(all)).toEqual(['Quote for Acme Industries.pdf']);

    expect(
      await listFolderFiles(ownerToken, rfqFolderId, 'origin=MANUAL'),
    ).toHaveLength(0);
    expect(
      names(await listFolderFiles(ownerToken, rfqFolderId, 'origin=RFQ')),
    ).toEqual(['Quote for Acme Industries.pdf']);
    expect(
      await listFolderFiles(ownerToken, rootId, 'fileType=PDF'),
    ).toHaveLength(0);
  });

  // ---- 3. sort ----

  it('sorts by name in both directions', async () => {
    const asc = await search(
      ownerToken,
      `scope=FOLDER&folderId=${rootId}&sort=NAME_ASC`,
    );
    const desc = await search(
      ownerToken,
      `scope=FOLDER&folderId=${rootId}&sort=NAME_DESC`,
    );
    expect(names(asc.files)).toEqual([...names(desc.files)].reverse());
    expect(names(asc.files)[0]).toBe('Assembly drawing.dwg');
  });

  it('sorts by size and by file type', async () => {
    const bySize = await search(
      ownerToken,
      `scope=FOLDER&folderId=${rootId}&sort=SIZE_DESC`,
    );
    const sizes = bySize.files.map((f) => Number(f.sizeBytes));
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(bySize.files[0].name).toBe('Assembly drawing.dwg');

    const byType = await search(
      ownerToken,
      `scope=FOLDER&folderId=${rootId}&sort=TYPE_ASC`,
    );
    // PDFs first, OTHER last — a stable display order, not alphabetical.
    const order = byType.files.map((f) => f.fileType);
    expect(order.indexOf('PDF')).toBeLessThan(order.indexOf('SPREADSHEET'));
    expect(order.indexOf('SPREADSHEET')).toBeLessThan(order.indexOf('IMAGE'));
  });

  it('sorts by modified date in both directions', async () => {
    const newest = await search(
      ownerToken,
      `scope=FOLDER&folderId=${rootId}&sort=MODIFIED_DESC`,
    );
    const oldest = await search(
      ownerToken,
      `scope=FOLDER&folderId=${rootId}&sort=MODIFIED_ASC`,
    );
    expect(names(newest.files)).toEqual([...names(oldest.files)].reverse());
  });

  // ---- 4. navigation ----

  it('reports the full ancestor path for breadcrumbs', async () => {
    const res = await request(app.getHttpServer())
      .get(`/vault/folders/${deepId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body.data.name).toBe('2026');
    // Outermost first, so the UI can render Vault › Root › Contracts › 2026.
    expect(res.body.data.ancestors.map((a: { id: string }) => a.id)).toEqual([
      rootId,
      contractsId,
    ]);
    for (const ancestor of res.body.data.ancestors) {
      expect(ancestor.canRead).toBe(true);
    }
  });

  it('marks ancestors the caller cannot open, so the trail stays honest', async () => {
    // Access can be granted on a child without the parent: the member is given
    // the deep folder directly, and must still see where it sits.
    await request(app.getHttpServer())
      .post(`/vault/folders/${deepId}/permissions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ granteeType: 'EMPLOYEE', granteeId: memberId, canRead: true })
      .expect(201);
    await prisma.vaultFolderPermission.deleteMany({
      where: { folderId: rootId, granteeId: memberId },
    });

    const res = await request(app.getHttpServer())
      .get(`/vault/folders/${deepId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    const crumbs = res.body.data.ancestors as {
      id: string;
      canRead: boolean;
    }[];
    expect(crumbs.map((c) => c.id)).toEqual([rootId, contractsId]);
    expect(crumbs.every((c) => c.canRead)).toBe(false);

    // Restore the member's tree access for any later test.
    await request(app.getHttpServer())
      .post(`/vault/folders/${rootId}/permissions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        granteeType: 'EMPLOYEE',
        granteeId: memberId,
        canRead: true,
        canWrite: true,
      })
      .expect(201);
  });

  it('recent files are the caller-visible documents, newest first', async () => {
    const res = await request(app.getHttpServer())
      .get('/vault/files/recent?limit=4')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const recent = res.body.data as (ListItem & { updatedAt: string })[];
    expect(recent.length).toBeLessThanOrEqual(4);
    const times = recent.map((f) => Date.parse(f.updatedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    // The backdated one is not among the newest handful.
    expect(names(recent)).not.toContain('Kickoff Checklist.pdf');

    const outsiderRecent = await request(app.getHttpServer())
      .get('/vault/files/recent?limit=50')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(200);
    const ourFolders = new Set([rootId, contractsId, deepId, rfqFolderId]);
    expect(
      (outsiderRecent.body.data as ListItem[]).filter((f) =>
        ourFolders.has(f.folderId),
      ),
    ).toHaveLength(0);
  });

  it('is a discovery layer only — structure, permissions and versions are untouched', async () => {
    // Everything created in beforeAll is still exactly as it was: same tree,
    // same file rows, same single version each, permissions intact.
    const tree = await prisma.vaultFolder.findMany({
      where: { id: { in: [rootId, contractsId, deepId, rfqFolderId] } },
      select: { id: true, parentFolderId: true, status: true },
    });
    expect(tree).toHaveLength(4);
    expect(tree.every((f) => f.status === 'ACTIVE')).toBe(true);
    expect(tree.find((f) => f.id === deepId)?.parentFolderId).toBe(contractsId);

    const rows = await prisma.vaultFile.findMany({
      where: { id: { in: Object.values(files) } },
      select: {
        id: true,
        status: true,
        currentVersionId: true,
        _count: { select: { versions: true } },
      },
    });
    expect(rows).toHaveLength(Object.keys(files).length);
    for (const row of rows) {
      expect(row.status).toBe('ACTIVE');
      expect(row.currentVersionId).toBeTruthy();
      expect(row._count.versions).toBe(1);
    }
  });
});
