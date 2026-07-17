import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';

/**
 * Project Kickoff e2e — the module's load-bearing behaviors (spec §8):
 *  - only a Project Manager / SUPER_ADMIN can create, and only for an Order
 *    whose latest Confirmation Sheet is EXECUTED (the reused gate)
 *  - creating a kickoff auto-provisions a working board (To Do/In Progress/Done,
 *    last is a done-list) with the creator as a member — WITHOUT the PM needing
 *    Scrum Master rights
 *  - adding an action item creates a real, correctly-assigned Kanban card;
 *    moving that card changes the action item's COMPUTED status (no stored field)
 *  - milestones/risks are simple structured CRUD
 *  - only the creator + internal attendees + SUPER_ADMIN can view a kickoff
 */
describe('Project Kickoff (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peoplehub.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const createdEmployeeIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];
  const createdBoardIds: string[] = [];
  const createdProductIds: string[] = [];
  let lineItemId: string; // a line item on the executed order (for delivery tests)

  let superAdminToken: string;
  let superAdminId: string;
  let pmToken: string; // designated Project Manager
  let pmId: string;
  let plainToken: string; // a non-PM employee (also an outsider to the kickoff)
  let plainId: string;
  let memberToken: string; // becomes an internal attendee
  let memberId: string;
  let salesVerticalId: string;

  let executedOrderId: string; // order with an EXECUTED confirmation sheet
  let unexecutedOrderId: string; // order with NO executed sheet
  let customerId: string;

  function login(email: string, password: string) {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200)
      .then((r) => r.body.data.accessToken as string);
  }

  /** Seed a CONFIRMED order; optionally give it an EXECUTED confirmation sheet
   *  and a single line item (whose id is captured for delivery-classification). */
  async function seedOrder(executed: boolean): Promise<string> {
    const product = await prisma.product.create({
      data: {
        sku: `PK-SKU-${createdProductIds.length}-${Math.floor(performance.now())}`,
        name: 'Test Rack',
        unitPrice: '100000',
        unitOfMeasure: 'each',
      },
    });
    createdProductIds.push(product.id);
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-PK-${createdOrderIds.length}-${Math.floor(performance.now())}`,
        customerId,
        status: 'CONFIRMED',
        totalAmount: '500000',
        ownerId: pmId,
        lineItems: {
          create: {
            productId: product.id,
            quantity: '5',
            unitPrice: '100000',
            lineTotal: '500000',
          },
        },
      },
      include: { lineItems: true },
    });
    if (executed) lineItemId = order.lineItems[0].id;
    createdOrderIds.push(order.id);
    if (executed) {
      await prisma.orderConfirmationSheet.create({
        data: {
          orderId: order.id,
          confirmationNumber: `OC-PK-${createdOrderIds.length}-${Math.floor(performance.now())}`,
          revisionNumber: 1,
          status: 'EXECUTED',
          createdById: pmId,
          // Required content fields — only the EXECUTED status matters to the
          // kickoff gate, so seed minimal valid values for the rest.
          requirementsOverview: 'Supply of DC racks per agreed spec.',
          deliveryDate: new Date('2026-09-01'),
          deliveryLocation: 'Bengaluru',
          deliveryType: 'FULL_TRUCKLOAD',
          warrantyTerms: '24 months',
          paymentMilestones: '100% advance',
          packagingType: 'Wooden Crate',
          protectiveMeasures: 'Moisture barrier',
          labelingRequirements: 'Fragile',
          customerContactName: 'Ravi Kumar',
          customerContactPhone: '+91-9000000000',
          customerContactEmail: 'ravi@customer.example',
        },
      });
    }
    return order.id;
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

    superAdminId = (
      await prisma.employee.findUniqueOrThrow({ where: { email: adminEmail } })
    ).id;
    superAdminToken = await login(adminEmail, adminPassword);
    salesVerticalId = (
      await prisma.vertical.findUniqueOrThrow({ where: { code: 'SALES' } })
    ).id;

    const suffix = Date.now();
    const mk = async (firstName: string, role: string) => {
      const email = `pk.${firstName.toLowerCase()}.${suffix}@peoplehub.local`;
      const res = await request(app.getHttpServer())
        .post('/employees')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          firstName,
          lastName: 'PK',
          email,
          password: 'S3curePass!',
          role,
          verticalId: salesVerticalId,
          reportingManagerId: superAdminId,
        })
        .expect(201);
      createdEmployeeIds.push(res.body.data.id);
      return { id: res.body.data.id as string, email };
    };

    const pm = await mk('Pm', 'MANAGER');
    pmId = pm.id;
    const plain = await mk('Plain', 'EMPLOYEE');
    plainId = plain.id;
    const member = await mk('Member', 'EMPLOYEE');
    memberId = member.id;

    // Designate the PM (and prove the role gate: an EMPLOYEE can't be a PM).
    await request(app.getHttpServer())
      .patch(`/employees/${pmId}/designate-project-manager`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);

    pmToken = await login(pm.email, 'S3curePass!');
    plainToken = await login(plain.email, 'S3curePass!');
    memberToken = await login(member.email, 'S3curePass!');

    const customer = await prisma.customer.create({
      data: {
        name: `PK Customer ${suffix}`,
        billingAddress: { line1: '1 Test Rd', city: 'Bengaluru' },
        ownerId: pmId,
      },
    });
    customerId = customer.id;
    createdCustomerIds.push(customer.id);

    executedOrderId = await seedOrder(true);
    unexecutedOrderId = await seedOrder(false);
  });

  afterAll(async () => {
    // Kickoffs (and their cascade children) first, then boards, orders, etc.
    await prisma.projectKickoff.deleteMany({
      where: { orderId: { in: createdOrderIds } },
    });
    if (createdBoardIds.length) {
      await prisma.kanbanCard.deleteMany({
        where: { list: { boardId: { in: createdBoardIds } } },
      });
      await prisma.kanbanList.deleteMany({
        where: { boardId: { in: createdBoardIds } },
      });
      await prisma.kanbanBoardMember.deleteMany({
        where: { boardId: { in: createdBoardIds } },
      });
      await prisma.kanbanBoard.deleteMany({
        where: { id: { in: createdBoardIds } },
      });
    }
    await prisma.orderConfirmationSheet.deleteMany({
      where: { orderId: { in: createdOrderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    // Products deleted after orders (line items cascade with the order first).
    if (createdProductIds.length) {
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    }
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    if (createdEmployeeIds.length) {
      await prisma.employee.deleteMany({ where: { id: { in: createdEmployeeIds } } });
    }
    await app.close();
  });

  it('PM designation is gated to MANAGER-and-above', async () => {
    // A plain EMPLOYEE cannot be designated a Project Manager.
    await request(app.getHttpServer())
      .patch(`/employees/${plainId}/designate-project-manager`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(400);
  });

  it('eligible-orders lists executed-sheet orders without a kickoff; non-PM is 403', async () => {
    // A non-PM employee can't list eligible orders.
    await request(app.getHttpServer())
      .get('/project-kickoffs/eligible-orders')
      .set('Authorization', `Bearer ${plainToken}`)
      .expect(403);

    const res = await request(app.getHttpServer())
      .get('/project-kickoffs/eligible-orders')
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);
    const ids = (res.body.data as { id: string }[]).map((o) => o.id);
    // Executed order is eligible; the unexecuted one is not.
    expect(ids).toContain(executedOrderId);
    expect(ids).not.toContain(unexecutedOrderId);
  });

  it('non-PM cannot create; PM cannot create for an unexecuted order; PM creates for an executed order', async () => {
    // A non-PM employee is forbidden.
    await request(app.getHttpServer())
      .post('/project-kickoffs')
      .set('Authorization', `Bearer ${plainToken}`)
      .send({ orderId: executedOrderId, meetingDate: '2026-08-01T10:00:00.000Z' })
      .expect(403);

    // PM, but the order's sheet isn't executed → blocked by the reused gate.
    await request(app.getHttpServer())
      .post('/project-kickoffs')
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ orderId: unexecutedOrderId, meetingDate: '2026-08-01T10:00:00.000Z' })
      .expect(400);

    // PM + executed order → created.
    const res = await request(app.getHttpServer())
      .post('/project-kickoffs')
      .set('Authorization', `Bearer ${pmToken}`)
      .send({
        orderId: executedOrderId,
        meetingDate: '2026-08-01T10:00:00.000Z',
        meetingMode: 'HYBRID',
      })
      .expect(201);
    const kickoff = res.body.data;
    createdBoardIds.push(kickoff.kanbanBoardId);

    expect(kickoff.status).toBe('DRAFT');
    expect(kickoff.kanbanBoardId).toBeTruthy();
    // Default project name from customer + order number.
    expect(kickoff.projectName).toContain('PK Customer');

    // Auto-provisioned board: 3 lists, last is a done-list, PM is a member —
    // and the PM was NOT given Scrum Master rights.
    const pmEmp = await prisma.employee.findUniqueOrThrow({ where: { id: pmId } });
    expect(pmEmp.isScrumMaster).toBe(false);

    const lists = await prisma.kanbanList.findMany({
      where: { boardId: kickoff.kanbanBoardId },
      orderBy: { position: 'asc' },
    });
    expect(lists.map((l) => l.name)).toEqual(['To Do', 'In Progress', 'Done']);
    expect(lists[2].isDoneList).toBe(true);

    const membership = await prisma.kanbanBoardMember.findFirst({
      where: { boardId: kickoff.kanbanBoardId, employeeId: pmId },
    });
    expect(membership).not.toBeNull();
  });

  it('full working record: attendees, action-item→card with computed status, milestones, risks, access', async () => {
    const kickoff = (
      await request(app.getHttpServer())
        .post('/project-kickoffs')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ orderId: executedOrderId, meetingDate: '2026-08-02T10:00:00.000Z' })
        .expect(201)
    ).body.data;
    const kid = kickoff.id;
    createdBoardIds.push(kickoff.kanbanBoardId);

    // Attendee validation: must set exactly one of employeeId / externalName.
    await request(app.getHttpServer())
      .post(`/project-kickoffs/${kid}/attendees`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ designation: 'Nobody' })
      .expect(400);

    // Internal attendee → also becomes a board member.
    await request(app.getHttpServer())
      .post(`/project-kickoffs/${kid}/attendees`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ employeeId: memberId, designation: 'Engineer' })
      .expect(201);
    // External attendee.
    const ext = await request(app.getHttpServer())
      .post(`/project-kickoffs/${kid}/attendees`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ externalName: 'Client Rep', externalOrganization: 'Acme', designation: 'CTO' })
      .expect(201);
    expect(ext.body.data.isInternal).toBe(false);
    expect(ext.body.data.name).toBe('Client Rep');

    const memberIsBoardMember = await prisma.kanbanBoardMember.findFirst({
      where: { boardId: kickoff.kanbanBoardId, employeeId: memberId },
    });
    expect(memberIsBoardMember).not.toBeNull();

    // Action item → auto-creates a Kanban card assigned to the owner, on To Do.
    const ai = (
      await request(app.getHttpServer())
        .post(`/project-kickoffs/${kid}/action-items`)
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ description: 'Finalise rack layout', ownerId: memberId, dueDate: '2026-08-10' })
        .expect(201)
    ).body.data;
    expect(ai.kanbanCardId).toBeTruthy();
    expect(ai.status).toBe('TODO');
    expect(ai.currentListName).toBe('To Do');

    const card = await prisma.kanbanCard.findUniqueOrThrow({
      where: { id: ai.kanbanCardId },
    });
    expect(card.assigneeId).toBe(memberId);
    expect(card.title).toBe('Finalise rack layout');

    // Move the card to the Done list → the action item's COMPUTED status flips
    // to DONE, with no separate stored status field.
    const doneList = await prisma.kanbanList.findFirstOrThrow({
      where: { boardId: kickoff.kanbanBoardId, isDoneList: true },
    });
    await prisma.kanbanCard.update({
      where: { id: ai.kanbanCardId },
      data: { listId: doneList.id },
    });
    const afterMove = (
      await request(app.getHttpServer())
        .get(`/project-kickoffs/${kid}`)
        .set('Authorization', `Bearer ${pmToken}`)
        .expect(200)
    ).body.data;
    const movedItem = afterMove.actionItems.find((x: { id: string }) => x.id === ai.id);
    expect(movedItem.status).toBe('DONE');
    expect(movedItem.currentListName).toBe('Done');

    // Milestone + risk CRUD.
    const milestone = (
      await request(app.getHttpServer())
        .post(`/project-kickoffs/${kid}/milestones`)
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ name: 'Design freeze', targetDate: '2026-08-20', ownerId: memberId })
        .expect(201)
    ).body.data;
    expect(milestone.status).toBe('PENDING');
    await request(app.getHttpServer())
      .patch(`/project-kickoffs/${kid}/milestones/${milestone.id}`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    const risk = (
      await request(app.getHttpServer())
        .post(`/project-kickoffs/${kid}/risks`)
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ description: 'Long lead time on doors', likelihood: 'HIGH', impact: 'MEDIUM', mitigationPlan: 'Pre-order' })
        .expect(201)
    ).body.data;
    expect(risk.likelihood).toBe('HIGH');

    // Access: an internal attendee CAN view; a non-attendee non-PM CANNOT;
    // SUPER_ADMIN can.
    await request(app.getHttpServer())
      .get(`/project-kickoffs/${kid}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/project-kickoffs/${kid}`)
      .set('Authorization', `Bearer ${plainToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/project-kickoffs/${kid}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
  });

  it('delivery classification: per-line-item set/persist, vendor fields, and VENDOR→other clears vendor data', async () => {
    // A fresh executed order (with a line item) → new kickoff.
    const freshOrderId = await seedOrder(true);
    const freshLineItemId = lineItemId;
    const kickoff = (
      await request(app.getHttpServer())
        .post('/project-kickoffs')
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ orderId: freshOrderId, meetingDate: '2026-08-03T10:00:00.000Z' })
        .expect(201)
    ).body.data;
    const kid = kickoff.id;
    createdBoardIds.push(kickoff.kanbanBoardId);

    // The kickoff response surfaces the order's line items as deliveryItems.
    expect(Array.isArray(kickoff.deliveryItems)).toBe(true);
    const di = kickoff.deliveryItems.find((x: { id: string }) => x.id === freshLineItemId);
    expect(di).toBeTruthy();
    expect(di.deliveryType).toBeNull();
    expect(di.productName).toBe('Test Rack');

    // Set VENDOR + vendor placeholder fields.
    const vendorSet = (
      await request(app.getHttpServer())
        .patch(`/project-kickoffs/${kid}/delivery-items/${freshLineItemId}`)
        .set('Authorization', `Bearer ${pmToken}`)
        .send({
          deliveryType: 'VENDOR',
          vendorName: 'Acme Fabrication',
          vendorContactInfo: 'ravi@acme.example',
          vendorExpectedLeadTime: '6-8 weeks',
        })
        .expect(200)
    ).body.data;
    expect(vendorSet.deliveryType).toBe('VENDOR');
    expect(vendorSet.vendorName).toBe('Acme Fabrication');
    expect(vendorSet.vendorExpectedLeadTime).toBe('6-8 weeks');

    // Switching VENDOR→IN_HOUSE replaces the manual vendor with the fixed
    // in-house partner (override, not clear) and drops stale contact/lead-time.
    const inhouse = (
      await request(app.getHttpServer())
        .patch(`/project-kickoffs/${kid}/delivery-items/${freshLineItemId}`)
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ deliveryType: 'IN_HOUSE' })
        .expect(200)
    ).body.data;
    expect(inhouse.deliveryType).toBe('IN_HOUSE');
    expect(inhouse.vendorName).toBe('Balaji MetalTech, Bengaluru');
    expect(inhouse.vendorContactInfo).toBeNull();
    expect(inhouse.vendorExpectedLeadTime).toBeNull();

    // The auto-filled in-house vendor name is still overridable.
    const overridden = (
      await request(app.getHttpServer())
        .patch(`/project-kickoffs/${kid}/delivery-items/${freshLineItemId}`)
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ vendorName: 'Internal Facility 2' })
        .expect(200)
    ).body.data;
    expect(overridden.vendorName).toBe('Internal Facility 2');

    // NPD still clears vendor fields entirely.
    const npd = (
      await request(app.getHttpServer())
        .patch(`/project-kickoffs/${kid}/delivery-items/${freshLineItemId}`)
        .set('Authorization', `Bearer ${pmToken}`)
        .send({ deliveryType: 'NPD' })
        .expect(200)
    ).body.data;
    expect(npd.deliveryType).toBe('NPD');
    expect(npd.vendorName).toBeNull();

    // A non-member cannot classify.
    await request(app.getHttpServer())
      .patch(`/project-kickoffs/${kid}/delivery-items/${freshLineItemId}`)
      .set('Authorization', `Bearer ${plainToken}`)
      .send({ deliveryType: 'NPD' })
      .expect(403);

    // A line item from a DIFFERENT order can't be edited via this kickoff.
    await request(app.getHttpServer())
      .patch(`/project-kickoffs/${kid}/delivery-items/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ deliveryType: 'NPD' })
      .expect(404);
  });
});
