import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * Stores follow-up: GRN logistics / sign-off fields promoted to real columns
 * (spec §3.1). Verifies all seven fields persist and round-trip, that `notes`
 * is a pure free-text remarks field (no structured logistics data), that an
 * update mutates them, and that a GRN created WITHOUT any of them (older-style)
 * still loads with the fields simply null.
 */
describe('GRN logistics/sign-off fields (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  let superAdminToken: string;
  let superAdminId: string;
  let scmManagerToken: string;
  let prodEmployeeToken: string;
  let supervisorId: string;

  let approvedSupplierId: string;
  let itemAId: string;
  let storeId: string;

  const http = () => request(app.getHttpServer());
  function login(email: string, password: string) {
    return http().post('/auth/login').send({ email, password }).expect(200)
      .then((r) => r.body.data.accessToken as string);
  }

  async function createIssuedPo(): Promise<any> {
    const po = (
      await http().post('/purchase-orders').set('Authorization', `Bearer ${scmManagerToken}`)
        .send({ supplierId: approvedSupplierId, lines: [{ itemId: itemAId, orderedQuantity: 100, unitPrice: 10 }] })
        .expect(201)
    ).body.data;
    await http().post(`/purchase-orders/${po.id}/issue`).set('Authorization', `Bearer ${scmManagerToken}`).expect(201);
    return po;
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

    superAdminId = (await prisma.employee.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    superAdminToken = await login(adminEmail, adminPassword);

    const scmVertical = await prisma.vertical.findUniqueOrThrow({ where: { code: 'SCM' } });
    const prodVertical = await prisma.vertical.findUniqueOrThrow({ where: { code: 'PRODUCTION' } });
    const suffix = Date.now();
    const mk = async (firstName: string, role: string, verticalId: string) => {
      const email = `grnlog.${firstName.toLowerCase()}.${suffix}@peoplehub.local`;
      const res = await http().post('/employees').set('Authorization', `Bearer ${superAdminToken}`)
        .send({ firstName, lastName: 'GRNLog', email, password: 'S3curePass!', role, verticalId, reportingManagerId: superAdminId })
        .expect(201);
      return { id: res.body.data.id as string, email };
    };
    const scmMgr = await mk('Scm', 'MANAGER', scmVertical.id);
    scmManagerToken = await login(scmMgr.email, 'S3curePass!');
    const prodEmp = await mk('Prod', 'EMPLOYEE', prodVertical.id);
    prodEmployeeToken = await login(prodEmp.email, 'S3curePass!');
    const supervisor = await mk('Sup', 'MANAGER', prodVertical.id);
    supervisorId = supervisor.id;

    approvedSupplierId = (
      await prisma.supplier.create({
        data: {
          companyName: `GrnLogSup ${suffix}`, registeredAddress: 'x', factoryAddress: 'x', yearEstablished: '2000',
          numberOfEmployees: '10', annualTurnover: '1cr', contactPersonName: 'x', contactPersonDesignation: 'x',
          contactEmail: 'x@y.com', contactPhone: '+910000000000', createdById: superAdminId, status: 'APPROVED',
        },
      })
    ).id;
    itemAId = (
      await prisma.item.create({
        data: { itemCode: `GRNLOG-A-${suffix}`, name: 'Steel', itemType: 'RAW_MATERIAL', baseUnitOfMeasure: 'kg' },
      })
    ).id;
    storeId = (await prisma.storeLocation.findFirstOrThrow({ where: { code: 'MAIN' } })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('persists and round-trips all seven logistics/sign-off fields; notes stays free-text', async () => {
    const po = await createIssuedPo();
    const grn = (
      await http().post('/goods-receipt-notes').set('Authorization', `Bearer ${prodEmployeeToken}`)
        .send({
          purchaseOrderId: po.id,
          notes: 'Two cartons crushed on arrival',
          vendorDeliveryChallanNumber: 'DC-9981',
          deliveryChallanDate: '2026-08-03T00:00:00.000Z',
          vehicleOrAwbNumber: 'KA01AB1234',
          driverOrCourier: 'Ramesh (BlueDart)',
          totalPackagesReceived: 12,
          packingCondition: 'PARTIALLY_DAMAGED',
          supervisorSignOffId: supervisorId,
          lines: [{ purchaseOrderLineId: po.lines[0].id, storeLocationId: storeId, receivedQuantity: 100 }],
        })
        .expect(201)
    ).body.data;

    // Round-trip on the create response.
    expect(grn.vendorDeliveryChallanNumber).toBe('DC-9981');
    expect(grn.deliveryChallanDate).toMatch(/^2026-08-03/);
    expect(grn.vehicleOrAwbNumber).toBe('KA01AB1234');
    expect(grn.driverOrCourier).toBe('Ramesh (BlueDart)');
    expect(grn.totalPackagesReceived).toBe(12);
    expect(grn.packingCondition).toBe('PARTIALLY_DAMAGED');
    expect(grn.supervisorSignOffId).toBe(supervisorId);
    expect(grn.supervisorSignOffName).toBeTruthy();
    // notes is pure free-text — no structured logistics leaked in.
    expect(grn.notes).toBe('Two cartons crushed on arrival');
    expect(grn.notes).not.toMatch(/Delivery Challan:|Vehicle\/AWB:|Packing condition:|Stores keeper:/);

    // Re-fetch confirms persistence.
    const fetched = (
      await http().get(`/goods-receipt-notes/${grn.id}`).set('Authorization', `Bearer ${prodEmployeeToken}`).expect(200)
    ).body.data;
    expect(fetched.packingCondition).toBe('PARTIALLY_DAMAGED');
    expect(fetched.vendorDeliveryChallanNumber).toBe('DC-9981');
    expect(fetched.supervisorSignOffId).toBe(supervisorId);

    // And the raw column really holds it (not embedded in notes).
    const row = await prisma.goodsReceiptNote.findUniqueOrThrow({ where: { id: grn.id } });
    expect(row.packingCondition).toBe('PARTIALLY_DAMAGED');
    expect(row.totalPackagesReceived).toBe(12);
    expect(row.notes).toBe('Two cartons crushed on arrival');
  });

  it('updates logistics fields on a DRAFT GRN', async () => {
    const po = await createIssuedPo();
    const grn = (
      await http().post('/goods-receipt-notes').set('Authorization', `Bearer ${prodEmployeeToken}`)
        .send({ purchaseOrderId: po.id, packingCondition: 'DAMAGED', lines: [{ purchaseOrderLineId: po.lines[0].id, storeLocationId: storeId, receivedQuantity: 50 }] })
        .expect(201)
    ).body.data;
    expect(grn.packingCondition).toBe('DAMAGED');

    const updated = (
      await http().patch(`/goods-receipt-notes/${grn.id}`).set('Authorization', `Bearer ${prodEmployeeToken}`)
        .send({ packingCondition: 'GOOD', vehicleOrAwbNumber: 'TN22XY9', totalPackagesReceived: 3 })
        .expect(200)
    ).body.data;
    expect(updated.packingCondition).toBe('GOOD');
    expect(updated.vehicleOrAwbNumber).toBe('TN22XY9');
    expect(updated.totalPackagesReceived).toBe(3);
  });

  it('creates a GRN with NO logistics fields — they load as null (older-style receipt)', async () => {
    const po = await createIssuedPo();
    const grn = (
      await http().post('/goods-receipt-notes').set('Authorization', `Bearer ${prodEmployeeToken}`)
        .send({ purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: po.lines[0].id, storeLocationId: storeId, receivedQuantity: 10 }] })
        .expect(201)
    ).body.data;
    expect(grn.vendorDeliveryChallanNumber).toBeNull();
    expect(grn.deliveryChallanDate).toBeNull();
    expect(grn.vehicleOrAwbNumber).toBeNull();
    expect(grn.driverOrCourier).toBeNull();
    expect(grn.totalPackagesReceived).toBeNull();
    expect(grn.packingCondition).toBeNull();
    expect(grn.supervisorSignOffId).toBeNull();
    expect(grn.supervisorSignOffName).toBeNull();
    expect(grn.notes).toBeNull();
  });

  it('rejects an invalid packing condition enum value', async () => {
    const po = await createIssuedPo();
    await http().post('/goods-receipt-notes').set('Authorization', `Bearer ${prodEmployeeToken}`)
      .send({ purchaseOrderId: po.id, packingCondition: 'SMASHED', lines: [{ purchaseOrderLineId: po.lines[0].id, storeLocationId: storeId, receivedQuantity: 5 }] })
      .expect(400);
  });
});
