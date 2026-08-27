import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { VaultStorageService } from '../src/modules/vault/vault-storage.service';

/**
 * Vendor Qualification (SCM) e2e (spec §8):
 *  - SCM Manager+/SA creates vendor + questionnaire + invite; non-SCM cannot
 *  - public token form: resolve, partial save/resume, cert upload guardrails,
 *    submit → lock + vendor status + notification to creator
 *  - Internal Auditor (and SA) audits; non-auditor cannot
 *  - classification at exact boundaries (89/90, 79/80, 69/70) → vendor status
 *  - Conditionally Approved → new questionnaire revision, history preserved
 *  - company-wide read for a non-SCM employee
 */
class FakeStorage {
  objects = new Map<string, { sizeBytes: number; contentType: string }>();
  async createUploadUrl(storageKey: string, contentType: string) {
    this.objects.set(storageKey, { sizeBytes: 2048, contentType });
    return {
      url: `https://fake-r2/${storageKey}?sig=put`,
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
}

describe('Vendor Qualification / SCM (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: FakeStorage;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const createdEmployeeIds: string[] = [];
  const createdVendorIds: string[] = [];

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

  /** Full 10-score body totalling a target via the two 20-max categories. */
  function scores(total: number) {
    // Base spreads 60 across the eight non-manufacturing/quality categories at
    // their maxes: cap(10)+eng(10)+fin(5)+supply(10)+export(10)+sus(5)+ehs(5)+cust(5)=60.
    // The remaining (total-60) is split across manufacturing(≤20)+quality(≤20).
    const remaining = total - 60;
    const mfg = Math.min(20, remaining);
    const quality = remaining - mfg;
    return {
      manufacturingCapabilityScore: mfg,
      capacityScore: 10,
      qualitySystemScore: quality,
      engineeringScore: 10,
      financialStabilityScore: 5,
      supplyChainScore: 10,
      exportReadinessScore: 10,
      sustainabilityScore: 5,
      ehsScore: 5,
      customerReferencesScore: 5,
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
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
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
      const email = `scm.${firstName.toLowerCase()}.${suffix}@peoplehub.local`;
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
    await prisma.vendor.deleteMany({ where: { id: { in: createdVendorIds } } });
    if (createdEmployeeIds.length) {
      await prisma.employee.deleteMany({
        where: { id: { in: createdEmployeeIds } },
      });
    }
    await app.close();
  });

  it('internal-auditor designation is MANAGER-gated', async () => {
    // The outsider is an EMPLOYEE → not eligible.
    const outsiderEmpId = createdEmployeeIds[createdEmployeeIds.length - 1];
    await request(app.getHttpServer())
      .patch(`/employees/${outsiderEmpId}/designate-internal-auditor`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(400);
  });

  it('runs the full vendor qualification flow', async () => {
    // Non-SCM employee cannot create a vendor.
    await request(app.getHttpServer())
      .post('/vendors')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send(vendorBody())
      .expect(403);

    // SCM manager creates the vendor (+ first questionnaire).
    const vendor = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send(vendorBody())
        .expect(201)
    ).body.data;
    createdVendorIds.push(vendor.id);
    expect(vendor.status).toBe('PENDING_QUESTIONNAIRE');

    // Company-wide read: even the non-SCM outsider can view.
    const detail = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(200)
    ).body.data;
    expect(detail.questionnaires).toHaveLength(1);
    const questionnaireId = detail.questionnaires[0].id;

    // Generate an invite (SCM manager).
    const invite = (
      await request(app.getHttpServer())
        .post(`/vendors/questionnaires/${questionnaireId}/invites`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send({})
        .expect(201)
    ).body.data;
    const token = invite.token;
    expect(token).toBeTruthy();

    // Public resolve — no auth.
    await request(app.getHttpServer())
      .post(`/public/vendor-questionnaire/${token}/resolve`)
      .send({})
      .expect(201);

    // Partial save (resume) — section JSON.
    await request(app.getHttpServer())
      .post(`/public/vendor-questionnaire/${token}/save`)
      .send({ businessProfile: { companyType: ['Manufacturer'] } })
      .expect(201);

    // Cert upload guardrails: a blocked extension is rejected.
    await request(app.getHttpServer())
      .post(`/public/vendor-questionnaire/${token}/certificate-upload-url`)
      .send({
        name: 'malware.exe',
        mimeType: 'application/octet-stream',
        sizeBytes: 10,
      })
      .expect(400);

    // A valid cert upload presign + confirm.
    const presign = (
      await request(app.getHttpServer())
        .post(`/public/vendor-questionnaire/${token}/certificate-upload-url`)
        .send({
          name: 'iso9001.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
        })
        .expect(201)
    ).body.data;
    await request(app.getHttpServer())
      .post(`/public/vendor-questionnaire/${token}/certificate-confirm`)
      .send({ storageKey: presign.storageKey, name: 'iso9001.pdf' })
      .expect(201);

    // Submit → locks + vendor QUESTIONNAIRE_SUBMITTED + notifies creator.
    await request(app.getHttpServer())
      .post(`/public/vendor-questionnaire/${token}/submit`)
      .send({ declaration: { name: 'V. Vendor', date: '2026-07-17' } })
      .expect(201);

    // Locked: a second save is rejected.
    await request(app.getHttpServer())
      .post(`/public/vendor-questionnaire/${token}/save`)
      .send({ logistics: {} })
      .expect(403);

    const afterSubmit = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(200)
    ).body.data;
    expect(afterSubmit.status).toBe('QUESTIONNAIRE_SUBMITTED');
    expect(afterSubmit.questionnaires[0].qualityCertificateFiles).toHaveLength(
      1,
    );

    // Notification landed for the creator (the SCM manager).
    const notif = await prisma.notification.findFirst({
      where: {
        employeeId: scmManagerId,
        type: 'VENDOR_QUESTIONNAIRE_SUBMITTED',
      },
    });
    expect(notif).not.toBeNull();

    // A non-auditor (SCM manager without the flag) cannot audit.
    await request(app.getHttpServer())
      .post(`/vendors/${vendor.id}/audits`)
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .send({
        questionnaireId,
        auditType: 'PHYSICAL',
        auditDate: '2026-07-18',
        ...scores(85),
      })
      .expect(403);

    // Auditor scores 79 → Conditionally Approved boundary.
    const audit79 = (
      await request(app.getHttpServer())
        .post(`/vendors/${vendor.id}/audits`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({
          questionnaireId,
          auditType: 'VIRTUAL',
          auditDate: '2026-07-18',
          ...scores(79),
        })
        .expect(201)
    ).body.data;
    expect(audit79.totalScore).toBe(79);
    expect(audit79.classification).toBe('CONDITIONALLY_APPROVED');

    const afterAudit = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .expect(200)
    ).body.data;
    expect(afterAudit.status).toBe('CONDITIONALLY_APPROVED');

    // Conditionally Approved → new questionnaire revision (history preserved).
    const rev2 = (
      await request(app.getHttpServer())
        .post(`/vendors/${vendor.id}/questionnaires`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(201)
    ).body.data;
    expect(rev2.revisionNumber).toBe(2);
    expect(rev2.status).toBe('SENT');
    const afterRevision = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(200)
    ).body.data;
    expect(afterRevision.questionnaires).toHaveLength(2); // history kept
    expect(afterRevision.status).toBe('PENDING_QUESTIONNAIRE'); // reset for resubmit
  });

  it('classification hits the exact threshold boundaries', async () => {
    const vendor = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(vendorBody())
        .expect(201)
    ).body.data;
    createdVendorIds.push(vendor.id);
    const qId = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
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
          .post(`/vendors/${vendor.id}/audits`)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({
            questionnaireId: qId,
            auditType: 'PHYSICAL',
            auditDate: '2026-07-18',
            ...scores(total),
          })
          .expect(201)
      ).body.data;
      expect(audit.totalScore).toBe(total);
      expect(audit.classification).toBe(cls);
      // Latest audit sets the vendor status.
      const s = (
        await request(app.getHttpServer())
          .get(`/vendors/${vendor.id}`)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .expect(200)
      ).body.data;
      expect(s.status).toBe(status);
    }
  });

  it('creates a vendor with only companyName + contactEmail; every other master field is genuinely optional at the API level', async () => {
    const minimal = {
      companyName: `Minimal Vendor ${Math.floor(performance.now())}`,
      contactEmail: 'minimal@acme.example',
    };
    const vendor = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send(minimal)
        .expect(201)
    ).body.data;
    createdVendorIds.push(vendor.id);
    expect(vendor.companyName).toBe(minimal.companyName);
    expect(vendor.contactEmail).toBe(minimal.contactEmail);
    expect(vendor.registeredAddress).toBeNull();
    expect(vendor.factoryAddress).toBeNull();
    expect(vendor.yearEstablished).toBeNull();
    expect(vendor.numberOfEmployees).toBeNull();
    expect(vendor.annualTurnover).toBeNull();
    expect(vendor.contactPersonName).toBeNull();
    expect(vendor.contactPersonDesignation).toBeNull();
    expect(vendor.contactPhone).toBeNull();

    // Invite generation still works on a minimally-created vendor.
    const questionnaireId = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(200)
    ).body.data.questionnaires[0].id;
    const invite = (
      await request(app.getHttpServer())
        .post(`/vendors/questionnaires/${questionnaireId}/invites`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send({})
        .expect(201)
    ).body.data;
    expect(invite.token).toBeTruthy();
  });

  it('missing companyName or contactEmail is still rejected (400)', async () => {
    await request(app.getHttpServer())
      .post('/vendors')
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ contactEmail: 'only-email@acme.example' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/vendors')
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ companyName: 'Only Name Co' })
      .expect(400);
  });

  it('the public form Company Information section writes back to the Vendor master record', async () => {
    // Created with only the two required fields — everything else starts null.
    const vendor = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send({
          companyName: `Blank Vendor ${Math.floor(performance.now())}`,
          contactEmail: 'blank@acme.example',
        })
        .expect(201)
    ).body.data;
    createdVendorIds.push(vendor.id);
    const questionnaireId = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(200)
    ).body.data.questionnaires[0].id;
    const invite = (
      await request(app.getHttpServer())
        .post(`/vendors/questionnaires/${questionnaireId}/invites`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send({})
        .expect(201)
    ).body.data;
    const token = invite.token;

    // Resolve shows the blank fields as an editable companyInfo (staff-set
    // fields are already populated; everything else is null).
    const resolved = (
      await request(app.getHttpServer())
        .post(`/public/vendor-questionnaire/${token}/resolve`)
        .send({})
        .expect(201)
    ).body.data;
    expect(resolved.companyInfo.companyName).toBe(vendor.companyName);
    expect(resolved.companyInfo.contactEmail).toBe(vendor.contactEmail);
    expect(resolved.companyInfo.registeredAddress).toBeNull();

    // Vendor completes their own Company Information via partial save.
    const saved = (
      await request(app.getHttpServer())
        .post(`/public/vendor-questionnaire/${token}/save`)
        .send({
          companyInfo: {
            registeredAddress: '9 New Address Rd',
            contactPersonName: 'New Contact',
          },
        })
        .expect(201)
    ).body.data;
    expect(saved.companyInfo.registeredAddress).toBe('9 New Address Rd');
    expect(saved.companyInfo.contactPersonName).toBe('New Contact');
    // Fields not sent in this partial save remain untouched (still null).
    expect(saved.companyInfo.factoryAddress).toBeNull();

    // companyName/contactEmail are staff-set and not part of companyInfo's
    // writable shape at all — they're unaffected by this save.
    expect(saved.companyInfo.companyName).toBe(vendor.companyName);
    expect(saved.companyInfo.contactEmail).toBe(vendor.contactEmail);

    // companyName is not a field on PublicCompanyInfoDto — sending it inside
    // companyInfo is rejected by the global forbidNonWhitelisted pipe (400),
    // not silently written.
    await request(app.getHttpServer())
      .post(`/public/vendor-questionnaire/${token}/save`)
      .send({ companyInfo: { companyName: 'Hijacked Name' } })
      .expect(400);

    // Confirmed against the Vendor master record directly, not just the
    // questionnaire response shape.
    const vendorAfter = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(200)
    ).body.data;
    expect(vendorAfter.registeredAddress).toBe('9 New Address Rd');
    expect(vendorAfter.contactPersonName).toBe('New Contact');

    // Submit can also carry companyInfo (e.g. filling in the rest at the end).
    const submitted = (
      await request(app.getHttpServer())
        .post(`/public/vendor-questionnaire/${token}/submit`)
        .send({
          declaration: { name: 'V. Vendor', date: '2026-07-19' },
          companyInfo: { factoryAddress: '10 Factory Rd' },
        })
        .expect(201)
    ).body.data;
    expect(submitted.companyInfo.factoryAddress).toBe('10 Factory Rd');
    expect(submitted.companyInfo.registeredAddress).toBe('9 New Address Rd');

    const vendorFinal = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(200)
    ).body.data;
    expect(vendorFinal.factoryAddress).toBe('10 Factory Rd');
  });

  it('SuperAdmin classification override: propagates, is revertible, shows both, and is SuperAdmin-only', async () => {
    // Vendor with a below-bar audit (69 → NOT_APPROVED).
    const vendor = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .send(vendorBody())
        .expect(201)
    ).body.data;
    createdVendorIds.push(vendor.id);
    const qId = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(200)
    ).body.data.questionnaires[0].id;
    const audit = (
      await request(app.getHttpServer())
        .post(`/vendors/${vendor.id}/audits`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          questionnaireId: qId,
          auditType: 'PHYSICAL',
          auditDate: '2026-07-20',
          ...scores(69),
        })
        .expect(201)
    ).body.data;
    expect(audit.classification).toBe('NOT_APPROVED');

    // Not a SuperAdmin → 403 (SCM manager, and even the auditor, cannot override).
    await request(app.getHttpServer())
      .patch(`/vendors/${vendor.id}/audits/${audit.id}/classification-override`)
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .send({ overrideClassification: 'APPROVED', reason: 'Risk accepted' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/vendors/${vendor.id}/audits/${audit.id}/classification-override`)
      .set('Authorization', `Bearer ${auditorToken}`)
      .send({ overrideClassification: 'APPROVED', reason: 'Risk accepted' })
      .expect(403);

    // Reason is mandatory (empty → 400 from the DTO).
    await request(app.getHttpServer())
      .patch(`/vendors/${vendor.id}/audits/${audit.id}/classification-override`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ overrideClassification: 'APPROVED', reason: '' })
      .expect(400);

    // A non-classification status (a lifecycle value) is not a valid target (400).
    await request(app.getHttpServer())
      .patch(`/vendors/${vendor.id}/audits/${audit.id}/classification-override`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ overrideClassification: 'UNDER_AUDIT', reason: 'Bad target' })
      .expect(400);

    // SuperAdmin overrides NOT_APPROVED → APPROVED. Both values are surfaced.
    const overridden = (
      await request(app.getHttpServer())
        .patch(
          `/vendors/${vendor.id}/audits/${audit.id}/classification-override`,
        )
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          overrideClassification: 'APPROVED',
          reason: 'Strategic sole-source; risk accepted by SCM head.',
        })
        .expect(200)
    ).body.data;
    expect(overridden.classification).toBe('NOT_APPROVED'); // computed, never deleted
    expect(overridden.overrideClassification).toBe('APPROVED');
    expect(overridden.effectiveClassification).toBe('APPROVED');
    expect(overridden.isOverridden).toBe(true);
    expect(overridden.overrideReason).toContain('risk accepted');
    expect(overridden.overriddenByName).toBeTruthy();
    expect(overridden.overriddenAt).toBeTruthy();

    // Propagates to the master status + statusOverridden flag.
    const afterOverride = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(200)
    ).body.data;
    expect(afterOverride.status).toBe('APPROVED');
    expect(afterOverride.statusOverridden).toBe(true);

    // The vendor now passes the Project Kickoff vendor-selector hard-gate
    // (which requires status ∈ [APPROVED, APPROVED_PREFERRED]).
    expect(['APPROVED', 'APPROVED_PREFERRED']).toContain(afterOverride.status);

    // Editing the override (any direction — down to CONDITIONALLY_APPROVED).
    const edited = (
      await request(app.getHttpServer())
        .patch(
          `/vendors/${vendor.id}/audits/${audit.id}/classification-override`,
        )
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          overrideClassification: 'CONDITIONALLY_APPROVED',
          reason: 'Downgraded pending re-audit.',
        })
        .expect(200)
    ).body.data;
    expect(edited.effectiveClassification).toBe('CONDITIONALLY_APPROVED');
    const afterEdit = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200)
    ).body.data;
    expect(afterEdit.status).toBe('CONDITIONALLY_APPROVED');
    expect(afterEdit.statusOverridden).toBe(true);

    // Clearing the override reverts to the computed classification + status.
    const cleared = (
      await request(app.getHttpServer())
        .delete(
          `/vendors/${vendor.id}/audits/${audit.id}/classification-override`,
        )
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200)
    ).body.data;
    expect(cleared.isOverridden).toBe(false);
    expect(cleared.overrideClassification).toBeNull();
    expect(cleared.effectiveClassification).toBe('NOT_APPROVED');
    const afterClear = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${scmManagerToken}`)
        .expect(200)
    ).body.data;
    expect(afterClear.status).toBe('NOT_APPROVED');
    expect(afterClear.statusOverridden).toBe(false);

    // Clearing (and overriding) is SuperAdmin-only too.
    await request(app.getHttpServer())
      .delete(
        `/vendors/${vendor.id}/audits/${audit.id}/classification-override`,
      )
      .set('Authorization', `Bearer ${scmManagerToken}`)
      .expect(403);
  });

  it('a fresh audit supersedes a prior override (recomputes status, clears the flag)', async () => {
    const vendor = (
      await request(app.getHttpServer())
        .post('/vendors')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(vendorBody())
        .expect(201)
    ).body.data;
    createdVendorIds.push(vendor.id);
    const qId = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200)
    ).body.data.questionnaires[0].id;

    // Audit #1: 69 → NOT_APPROVED, then overridden up to APPROVED.
    const audit1 = (
      await request(app.getHttpServer())
        .post(`/vendors/${vendor.id}/audits`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          questionnaireId: qId,
          auditType: 'PHYSICAL',
          auditDate: '2026-07-20',
          ...scores(69),
        })
        .expect(201)
    ).body.data;
    await request(app.getHttpServer())
      .patch(
        `/vendors/${vendor.id}/audits/${audit1.id}/classification-override`,
      )
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ overrideClassification: 'APPROVED', reason: 'Interim approval.' })
      .expect(200);

    // A newer audit (#2: 85 → APPROVED by score) resets the flag and drives status.
    await request(app.getHttpServer())
      .post(`/vendors/${vendor.id}/audits`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        questionnaireId: qId,
        auditType: 'VIRTUAL',
        auditDate: '2026-07-21',
        ...scores(85),
      })
      .expect(201);
    const afterNewAudit = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200)
    ).body.data;
    expect(afterNewAudit.status).toBe('APPROVED');
    expect(afterNewAudit.statusOverridden).toBe(false);

    // Overriding the OLDER (historical) audit does not clobber the master status.
    const olderAudit = afterNewAudit.audits.find(
      (a: { id: string }) => a.id === audit1.id,
    );
    expect(olderAudit).toBeTruthy();
    await request(app.getHttpServer())
      .patch(
        `/vendors/${vendor.id}/audits/${audit1.id}/classification-override`,
      )
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        overrideClassification: 'NOT_APPROVED',
        reason: 'Correcting the historical record.',
      })
      .expect(200);
    const afterHistoricalOverride = (
      await request(app.getHttpServer())
        .get(`/vendors/${vendor.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200)
    ).body.data;
    // Master status still reflects the LATEST audit, not the overridden older one.
    expect(afterHistoricalOverride.status).toBe('APPROVED');
    expect(afterHistoricalOverride.statusOverridden).toBe(false);
    // But the older audit row itself does carry the override.
    const olderAfter = afterHistoricalOverride.audits.find(
      (a: { id: string }) => a.id === audit1.id,
    );
    expect(olderAfter.isOverridden).toBe(true);
    expect(olderAfter.effectiveClassification).toBe('NOT_APPROVED');
  });

  function vendorBody() {
    return {
      companyName: `Acme Fab ${Math.floor(performance.now())}`,
      registeredAddress: '1 Industrial Rd',
      factoryAddress: '2 Factory Rd',
      yearEstablished: '2005',
      numberOfEmployees: '250',
      annualTurnover: '₹50 Cr',
      contactPersonName: 'V. Vendor',
      contactPersonDesignation: 'Director',
      contactEmail: 'v@acme.example',
      contactPhone: '+91-90000-00000',
    };
  }
});
