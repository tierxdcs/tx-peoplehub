import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { VaultStorageService } from '../src/modules/vault/vault-storage.service';

/**
 * Supplier Qualification (SCM — raw materials) e2e:
 *  - SCM Manager+/SA creates supplier + questionnaire + invite; non-SCM cannot
 *  - public token form: resolve, partial save/resume, cert upload guardrails,
 *    submit → lock + supplier status + notification to creator
 *    (Packaging & Delivery deliberately left blank — the section is optional)
 *  - Internal Auditor (and SA) audits; non-auditor cannot
 *  - classification at exact boundaries (89/90, 79/80, 69/70) → supplier status
 *  - Conditionally Approved → new questionnaire revision, history preserved
 *  - company-wide read for a non-SCM employee
 *
 * Distinct from Vendor Qualification: routes /suppliers + /public/supplier-
 * questionnaire, tables suppliers/supplier_*, SUPPLIER_QUESTIONNAIRE_SUBMITTED.
 */
class FakeStorage {
  objects = new Map<string, { sizeBytes: number; contentType: string }>();
  async createUploadUrl(storageKey: string, contentType: string) {
    this.objects.set(storageKey, { sizeBytes: 2048, contentType });
    return { url: `https://fake-r2/${storageKey}?sig=put`, expiresInSeconds: 300 };
  }
  async createDownloadUrl(storageKey: string) {
    return { url: `https://fake-r2/${storageKey}?sig=get`, expiresInSeconds: 300 };
  }
  async headObject(storageKey: string) {
    const o = this.objects.get(storageKey);
    return o ? { sizeBytes: o.sizeBytes, contentType: o.contentType } : null;
  }
}

describe('Supplier Qualification / SCM (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: FakeStorage;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const createdEmployeeIds: string[] = [];
  const createdSupplierIds: string[] = [];

  let superAdminToken: string;
  let superAdminId: string;
  let scmManagerToken: string; // SCM-vertical MANAGER
  let scmManagerId: string;
  let auditorToken: string; // designated Internal Auditor (SCM manager too)
  let auditorId: string;
  let outsiderToken: string; // non-SCM employee (company-wide read only)

  function login(email: string, password: string) {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200)
      .then((r) => r.body.data.accessToken as string);
  }

  /** Full 6-score body totalling a target. Maxes 30/15/20/15/10/10 = 100. */
  function scores(total: number) {
    // Base = compliance(15)+logistics(15)+financial(10)+references(10) = 50.
    // The remaining (total-50) fills materialCert(≤30) then commercial(≤20).
    const remaining = total - 50;
    const mat = Math.min(30, remaining);
    const commercial = remaining - mat;
    return {
      materialCertificationsQualityScore: mat,
      complianceScore: 15,
      commercialTermsScore: commercial,
      logisticsDeliveryScore: 15,
      financialStabilityScore: 10,
      referencesScore: 10,
    };
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
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    superAdminId = (
      await prisma.employee.findUniqueOrThrow({ where: { email: adminEmail } })
    ).id;
    superAdminToken = await login(adminEmail, adminPassword);

    const scmVertical = await prisma.vertical.findUniqueOrThrow({
      where: { code: 'SCM' },
    });
    const salesVertical = await prisma.vertical.findUniqueOrThrow({
      where: { code: 'SALES' },
    });
    const suffix = Date.now();
    const mk = async (
      firstName: string,
      role: string,
      verticalId: string,
    ): Promise<{ id: string; email: string }> => {
      const email = `sup.${firstName.toLowerCase()}.${suffix}@peoplehub.local`;
      const res = await request(app.getHttpServer())
        .post('/employees')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          firstName,
          lastName: 'SCM',
          email,
          password: 'S3curePass!',
          role,
          verticalId,
          reportingManagerId: superAdminId,
        })
        .expect(201);
      createdEmployeeIds.push(res.body.data.id);
      return { id: res.body.data.id, email };
    };

    const mgr = await mk('Mgr', 'MANAGER', scmVertical.id);
    scmManagerId = mgr.id;
    const auditor = await mk('Auditor', 'MANAGER', scmVertical.id);
    auditorId = auditor.id;
    const outsider = await mk('Outsider', 'EMPLOYEE', salesVertical.id);

    await request(app.getHttpServer())
      .patch(`/employees/${auditorId}/designate-internal-auditor`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);

    scmManagerToken = await login(mgr.email, 'S3curePass!');
    auditorToken = await login(auditor.email, 'S3curePass!');
    outsiderToken = await login(outsider.email, 'S3curePass!');
  });

  afterAll(async () => {
    await prisma.supplier.deleteMany({ where: { id: { in: createdSupplierIds } } });
    if (createdEmployeeIds.length) {
      await prisma.employee.deleteMany({ where: { id: { in: createdEmployeeIds } } });
    }
    await app.close();
  });

  it('runs the full supplier qualification flow (Packaging & Delivery left blank)', async () => {
    // Non-SCM employee cannot create a supplier.
    await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send(supplierBody())
      .expect(403);

    // SCM manager creates the supplier (+ first questionnaire).
    const supplier = (
      await request(app.getHttpServer())
        .post('/suppliers')
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send(supplierBody())
        .expect(201)
    ).body.data;
    createdSupplierIds.push(supplier.id);
    expect(supplier.status).toBe('PENDING_QUESTIONNAIRE');

    // Company-wide read: even the non-SCM outsider can view.
    const detail = (
      await request(app.getHttpServer())
        .get(`/suppliers/${supplier.id}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(200)
    ).body.data;
    expect(detail.questionnaires).toHaveLength(1);
    const questionnaireId = detail.questionnaires[0].id;

    // Generate an invite (SCM manager).
    const invite = (
      await request(app.getHttpServer())
        .post(`/suppliers/questionnaires/${questionnaireId}/invites`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send({})
        .expect(201)
    ).body.data;
    const token = invite.token;
    expect(token).toBeTruthy();

    // Public resolve — no auth.
    await request(app.getHttpServer())
      .post(`/public/supplier-questionnaire/${token}/resolve`)
      .send({})
      .expect(201);

    // Partial save (resume) — section JSON.
    await request(app.getHttpServer())
      .post(`/public/supplier-questionnaire/${token}/save`)
      .send({ materialRange: { materials: ['Cold-rolled steel'] } })
      .expect(201);

    // Cert upload guardrails: a blocked extension is rejected.
    await request(app.getHttpServer())
      .post(`/public/supplier-questionnaire/${token}/certificate-upload-url`)
      .send({ name: 'malware.exe', mimeType: 'application/octet-stream', sizeBytes: 10 })
      .expect(400);

    // A valid cert upload presign + confirm.
    const presign = (
      await request(app.getHttpServer())
        .post(`/public/supplier-questionnaire/${token}/certificate-upload-url`)
        .send({ name: 'iso9001.pdf', mimeType: 'application/pdf', sizeBytes: 2048 })
        .expect(201)
    ).body.data;
    await request(app.getHttpServer())
      .post(`/public/supplier-questionnaire/${token}/certificate-confirm`)
      .send({ storageKey: presign.storageKey, name: 'iso9001.pdf' })
      .expect(201);

    // Submit → locks + supplier QUESTIONNAIRE_SUBMITTED + notifies creator.
    // Packaging & Delivery intentionally NOT sent — the section is optional.
    await request(app.getHttpServer())
      .post(`/public/supplier-questionnaire/${token}/submit`)
      .send({ declaration: { name: 'S. Supplier', date: '2026-07-17' } })
      .expect(201);

    // Locked: a second save is rejected.
    await request(app.getHttpServer())
      .post(`/public/supplier-questionnaire/${token}/save`)
      .send({ logistics: {} })
      .expect(403);

    const afterSubmit = (
      await request(app.getHttpServer())
        .get(`/suppliers/${supplier.id}`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(200)
    ).body.data;
    expect(afterSubmit.status).toBe('QUESTIONNAIRE_SUBMITTED');
    expect(afterSubmit.questionnaires[0].certificateFiles).toHaveLength(1);
    expect(afterSubmit.questionnaires[0].packagingAndDelivery).toBeNull(); // optional, blank
    expect(afterSubmit.questionnaires[0].filledBy).toBe('EXTERNAL_SUPPLIER'); // public-form path

    // Notification landed for the creator (the SCM manager).
    const notif = await prisma.notification.findFirst({
      where: {
        employeeId: scmManagerId,
        type: 'SUPPLIER_QUESTIONNAIRE_SUBMITTED',
      },
    });
    expect(notif).not.toBeNull();
    expect(notif?.relatedSupplierId).toBe(supplier.id);

    // A non-auditor (SCM manager without the flag) cannot audit.
    await request(app.getHttpServer())
      .post(`/suppliers/${supplier.id}/audits`)
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ questionnaireId, auditType: 'PHYSICAL', auditDate: '2026-07-18', ...scores(85) })
      .expect(403);

    // Auditor scores 79 → Conditionally Approved boundary.
    const audit79 = (
      await request(app.getHttpServer())
        .post(`/suppliers/${supplier.id}/audits`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({ questionnaireId, auditType: 'VIRTUAL', auditDate: '2026-07-18', ...scores(79) })
        .expect(201)
    ).body.data;
    expect(audit79.totalScore).toBe(79);
    expect(audit79.classification).toBe('CONDITIONALLY_APPROVED');

    const afterAudit = (
      await request(app.getHttpServer())
        .get(`/suppliers/${supplier.id}`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .expect(200)
    ).body.data;
    expect(afterAudit.status).toBe('CONDITIONALLY_APPROVED');

    // Conditionally Approved → new questionnaire revision (history preserved).
    const rev2 = (
      await request(app.getHttpServer())
        .post(`/suppliers/${supplier.id}/questionnaires`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(201)
    ).body.data;
    expect(rev2.revisionNumber).toBe(2);
    expect(rev2.status).toBe('SENT');
    const afterRevision = (
      await request(app.getHttpServer())
        .get(`/suppliers/${supplier.id}`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(200)
    ).body.data;
    expect(afterRevision.questionnaires).toHaveLength(2); // history kept
    expect(afterRevision.status).toBe('PENDING_QUESTIONNAIRE'); // reset for resubmit
  });

  it('classification hits the exact threshold boundaries', async () => {
    const supplier = (
      await request(app.getHttpServer())
        .post('/suppliers')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(supplierBody())
        .expect(201)
    ).body.data;
    createdSupplierIds.push(supplier.id);
    const qId = (
      await request(app.getHttpServer())
        .get(`/suppliers/${supplier.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200)
    ).body.data.questionnaires[0].id;

    const cases: [number, string, string][] = [
      [90, 'APPROVED_PREFERRED', 'APPROVED_PREFERRED'],
      [89, 'APPROVED', 'APPROVED'],
      [80, 'APPROVED', 'APPROVED'],
      [79, 'CONDITIONALLY_APPROVED', 'CONDITIONALLY_APPROVED'],
      [70, 'CONDITIONALLY_APPROVED', 'CONDITIONALLY_APPROVED'],
      [69, 'NOT_APPROVED', 'NOT_APPROVED'],
    ];
    for (const [total, cls, status] of cases) {
      const audit = (
        await request(app.getHttpServer())
          .post(`/suppliers/${supplier.id}/audits`)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({ questionnaireId: qId, auditType: 'PHYSICAL', auditDate: '2026-07-18', ...scores(total) })
          .expect(201)
      ).body.data;
      expect(audit.totalScore).toBe(total);
      expect(audit.classification).toBe(cls);
      // Latest audit sets the supplier status.
      const s = (
        await request(app.getHttpServer())
          .get(`/suppliers/${supplier.id}`)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .expect(200)
      ).body.data;
      expect(s.status).toBe(status);
    }
  });

  it('supports the internal-fill path (all fields optional) → filledBy INTERNAL_STAFF', async () => {
    // SCM manager creates the supplier (+ first questionnaire).
    const supplier = (
      await request(app.getHttpServer())
        .post('/suppliers')
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send(supplierBody())
        .expect(201)
    ).body.data;
    createdSupplierIds.push(supplier.id);
    const questionnaireId = supplier
      ? (
          await request(app.getHttpServer())
            .get(`/suppliers/${supplier.id}`)
            .set('Authorization', `Bearer ${scmManagerToken}`)
            .expect(200)
        ).body.data.questionnaires[0].id
      : '';

    // An invite link can also exist — internal fill is available regardless.
    await request(app.getHttpServer())
      .post(`/suppliers/questionnaires/${questionnaireId}/invites`)
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .send({})
      .expect(201);

    // A non-SCM outsider cannot use internal-fill (same gate as invites).
    await request(app.getHttpServer())
      .post(`/suppliers/questionnaires/${questionnaireId}/internal-fill/save`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ materialRange: { materials: ['Aluminium'] } })
      .expect(403);

    // Staff partial-save some section data.
    await request(app.getHttpServer())
      .post(`/suppliers/questionnaires/${questionnaireId}/internal-fill/save`)
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ materialRange: { materials: ['Aluminium 6061'] } })
      .expect(201);

    // Certificate upload works the same way (staff uploading on supplier's behalf).
    const presign = (
      await request(app.getHttpServer())
        .post(`/suppliers/questionnaires/${questionnaireId}/internal-fill/certificate-upload-url`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send({ name: 'mtc.pdf', mimeType: 'application/pdf', sizeBytes: 2048 })
        .expect(201)
    ).body.data;
    await request(app.getHttpServer())
      .post(`/suppliers/questionnaires/${questionnaireId}/internal-fill/certificate-confirm`)
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ storageKey: presign.storageKey, name: 'mtc.pdf' })
      .expect(201);

    // Blocked extension is still rejected internally (guardrails reused).
    await request(app.getHttpServer())
      .post(`/suppliers/questionnaires/${questionnaireId}/internal-fill/certificate-upload-url`)
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ name: 'evil.exe', mimeType: 'application/octet-stream', sizeBytes: 10 })
      .expect(400);

    // Submit with EVERYTHING ELSE blank — every field is optional internally.
    const submitted = (
      await request(app.getHttpServer())
        .post(`/suppliers/questionnaires/${questionnaireId}/internal-fill/submit`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send({})
        .expect(201)
    ).body.data;
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.filledBy).toBe('INTERNAL_STAFF');

    // Locked afterward — a second internal save is rejected.
    await request(app.getHttpServer())
      .post(`/suppliers/questionnaires/${questionnaireId}/internal-fill/save`)
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ logistics: {} })
      .expect(403);

    const afterSubmit = (
      await request(app.getHttpServer())
        .get(`/suppliers/${supplier.id}`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(200)
    ).body.data;
    expect(afterSubmit.status).toBe('QUESTIONNAIRE_SUBMITTED');
    expect(afterSubmit.questionnaires[0].filledBy).toBe('INTERNAL_STAFF');
    expect(afterSubmit.questionnaires[0].certificateFiles).toHaveLength(1);

    // Downstream audit/scoring behaves identically — no special-casing on filledBy.
    const audit = (
      await request(app.getHttpServer())
        .post(`/suppliers/${supplier.id}/audits`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({ questionnaireId, auditType: 'PHYSICAL', auditDate: '2026-07-18', ...scores(90) })
        .expect(201)
    ).body.data;
    expect(audit.totalScore).toBe(90);
    expect(audit.classification).toBe('APPROVED_PREFERRED');
    const finalSupplier = (
      await request(app.getHttpServer())
        .get(`/suppliers/${supplier.id}`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .expect(200)
    ).body.data;
    expect(finalSupplier.status).toBe('APPROVED_PREFERRED');
  });

  function supplierBody() {
    return {
      companyName: `Raw Materials Co ${Math.floor(performance.now())}`,
      registeredAddress: '1 Ore Rd',
      factoryAddress: '2 Smelter Rd',
      yearEstablished: '2010',
      numberOfEmployees: '120',
      annualTurnover: '₹30 Cr',
      contactPersonName: 'S. Supplier',
      contactPersonDesignation: 'Sales Head',
      contactEmail: 's@rawco.example',
      contactPhone: '+91-90000-11111',
    };
  }
});
