import {
  AccessStatus,
  BidStatus,
  KickoffStatus,
  LeadStatus,
  OpportunityStage,
  OrderLineDeliveryType,
  OrderStatus,
  PlmEventType,
  PlmStage,
  PrismaClient,
  QmsInspectionResult,
  QmsInspectionStatus,
  QmsPlanStatus,
  QmsResponseType,
  QmsTemplateStatus,
  QmsTemplateType,
  Role,
} from '@prisma/client';

const prisma = new PrismaClient();

const IDS = {
  customer: 'demo-plm-customer',
  contact: 'demo-plm-contact',
  lead: 'demo-plm-lead',
  opportunity: 'demo-plm-opportunity',
  bid: 'demo-plm-bid',
  order: 'demo-plm-order',
  board: 'demo-plm-board',
  kickoff: 'demo-plm-kickoff',
};

const samples = [
  {
    key: 'npd',
    sku: 'PLM-DEMO-NPD-001',
    name: 'Smart MCC Control Panel',
    description: 'New product development sample requiring design review and drawing release.',
    price: 485000,
    quantity: 1,
    deliveryType: OrderLineDeliveryType.NPD,
    stage: PlmStage.DESIGN,
  },
  {
    key: 'inhouse',
    sku: 'PLM-DEMO-INH-002',
    name: 'Industrial Conveyor Module',
    description: 'In-house manufactured assembly sample currently in production.',
    price: 275000,
    quantity: 2,
    deliveryType: OrderLineDeliveryType.IN_HOUSE,
    stage: PlmStage.PRODUCTION,
  },
  {
    key: 'vendor',
    sku: 'PLM-DEMO-VEN-003',
    name: 'Precision Fabricated Enclosure',
    description: 'Vendor-supplied fabrication sample awaiting material and supplier progress.',
    price: 125000,
    quantity: 3,
    deliveryType: OrderLineDeliveryType.VENDOR,
    stage: PlmStage.RELEASE_TO_SCM,
  },
];

function dateFromToday(days: number): Date {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

async function main() {
  const owner = await prisma.employee.findFirst({
    where: {
      accessStatus: AccessStatus.ACTIVE,
      OR: [
        { email: process.env.SEED_ADMIN_EMAIL },
        { role: Role.SUPER_ADMIN },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) throw new Error('No active SUPER_ADMIN found. Run the baseline seed first.');

  const businessUnit = await prisma.businessUnit.findFirst({
    where: { isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  });
  if (!businessUnit) throw new Error('No active Business Unit found. Run the baseline seed first.');

  const customer = await prisma.customer.upsert({
    where: { id: IDS.customer },
    update: { name: 'Apex Automation Pvt Ltd', ownerId: owner.id },
    create: {
      id: IDS.customer,
      name: 'Apex Automation Pvt Ltd',
      industry: 'Industrial Automation',
      gstin: '29ABCDE1234F1Z5',
      billingAddress: {
        line1: '42 Peenya Industrial Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560058',
        country: 'India',
      },
      ownerId: owner.id,
    },
  });
  await prisma.customerContact.upsert({
    where: { id: IDS.contact },
    update: { name: 'Ananya Rao', isPrimary: true },
    create: {
      id: IDS.contact,
      customerId: customer.id,
      name: 'Ananya Rao',
      email: 'ananya.rao@example.com',
      phone: '+91 98765 43210',
      designation: 'Projects Manager',
      isPrimary: true,
    },
  });

  const products = [];
  for (const sample of samples) {
    products.push(
      await prisma.product.upsert({
        where: { sku: sample.sku },
        update: {
          name: sample.name,
          description: sample.description,
          unitPrice: sample.price,
          businessUnitId: businessUnit.id,
          isActive: true,
        },
        create: {
          id: `demo-plm-product-${sample.key}`,
          sku: sample.sku,
          name: sample.name,
          description: sample.description,
          unitPrice: sample.price,
          unitOfMeasure: 'Nos',
          hsnCode: '85371000',
          businessUnitId: businessUnit.id,
        },
      }),
    );
  }

  const lead = await prisma.lead.upsert({
    where: { leadNumber: 'PLM-DEMO-LD-001' },
    update: { ownerId: owner.id, enquiryCreatorId: owner.id },
    create: {
      id: IDS.lead,
      leadNumber: 'PLM-DEMO-LD-001',
      companyName: customer.name,
      contactName: 'Ananya Rao',
      email: 'ananya.rao@example.com',
      requirement: 'Automation line covering NPD, internal manufacture and vendor fabrication',
      status: LeadStatus.CONVERTED,
      ownerId: owner.id,
      enquiryCreatorId: owner.id,
      businessUnitId: businessUnit.id,
    },
  });

  const opportunity = await prisma.opportunity.upsert({
    where: { id: IDS.opportunity },
    update: { ownerId: owner.id, stage: OpportunityStage.CLOSED_WON },
    create: {
      id: IDS.opportunity,
      leadId: lead.id,
      customerId: customer.id,
      name: 'Apex Integrated Automation Line — PLM Demo',
      stage: OpportunityStage.CLOSED_WON,
      estimatedValue: 1410000,
      expectedCloseDate: dateFromToday(-20),
      ownerId: owner.id,
      enquiryCreatorId: owner.id,
      businessUnitId: businessUnit.id,
    },
  });
  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: LeadStatus.CONVERTED, convertedToOpportunityId: opportunity.id },
  });

  const bid = await prisma.bid.upsert({
    where: { bidNumber: 'PLM-DEMO-BID-001' },
    update: { status: BidStatus.ACCEPTED, totalAmount: 1410000 },
    create: {
      id: IDS.bid,
      bidNumber: 'PLM-DEMO-BID-001',
      opportunityId: opportunity.id,
      customerId: customer.id,
      status: BidStatus.ACCEPTED,
      validUntil: dateFromToday(30),
      quotationSubject: 'Integrated automation line',
      subtotal: 1410000,
      totalAmount: 1410000,
      createdById: owner.id,
      enquiryCreatorId: owner.id,
      businessUnitId: businessUnit.id,
    },
  });

  const order = await prisma.order.upsert({
    where: { orderNumber: 'PLM-DEMO-ORD-001' },
    update: { status: OrderStatus.IN_PRODUCTION, ownerId: owner.id },
    create: {
      id: IDS.order,
      orderNumber: 'PLM-DEMO-ORD-001',
      bidId: bid.id,
      customerId: customer.id,
      status: OrderStatus.IN_PRODUCTION,
      totalAmount: 1410000,
      ownerId: owner.id,
      enquiryCreatorId: owner.id,
      businessUnitId: businessUnit.id,
    },
  });

  await prisma.kanbanBoard.upsert({
    where: { id: IDS.board },
    update: { name: 'Apex Automation Line — Production' },
    create: { id: IDS.board, name: 'Apex Automation Line — Production', createdById: owner.id },
  });
  await prisma.kanbanBoardMember.upsert({
    where: { boardId_employeeId: { boardId: IDS.board, employeeId: owner.id } },
    update: {},
    create: { boardId: IDS.board, employeeId: owner.id, addedById: owner.id },
  });
  for (const [index, name] of ['To Do', 'In progress', 'Completed'].entries()) {
    await prisma.kanbanList.upsert({
      where: { id: `${IDS.board}-list-${index + 1}` },
      update: { name, position: (index + 1) * 1024, isDoneList: index === 2 },
      create: {
        id: `${IDS.board}-list-${index + 1}`,
        boardId: IDS.board,
        name,
        position: (index + 1) * 1024,
        isDoneList: index === 2,
        createdById: owner.id,
      },
    });
  }

  const kickoff = await prisma.projectKickoff.upsert({
    where: { id: IDS.kickoff },
    update: { status: KickoffStatus.COMPLETED, kanbanBoardId: IDS.board },
    create: {
      id: IDS.kickoff,
      orderId: order.id,
      projectName: 'Apex Integrated Automation Line',
      meetingDate: dateFromToday(-14),
      overviewAndScope: 'PLM demonstration project with NPD, in-house and vendor delivery flows.',
      minutesNotes: 'Delivery classification confirmed for all three order lines.',
      status: KickoffStatus.COMPLETED,
      kanbanBoardId: IDS.board,
      createdById: owner.id,
    },
  });
  const attendee = await prisma.kickoffAttendee.findFirst({
    where: { kickoffId: kickoff.id, employeeId: owner.id },
  });
  if (!attendee) {
    await prisma.kickoffAttendee.create({ data: { kickoffId: kickoff.id, employeeId: owner.id } });
  }

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const product = products[index];
    const lineTotal = sample.price * sample.quantity;
    await prisma.bidLineItem.upsert({
      where: { id: `demo-plm-bid-line-${sample.key}` },
      update: { quantity: sample.quantity, unitPrice: sample.price, lineTotal },
      create: {
        id: `demo-plm-bid-line-${sample.key}`,
        bidId: bid.id,
        productId: product.id,
        quantity: sample.quantity,
        unitPrice: sample.price,
        lineTotal,
      },
    });
    const orderLine = await prisma.orderLineItem.upsert({
      where: { id: `demo-plm-order-line-${sample.key}` },
      update: {
        quantity: sample.quantity,
        unitPrice: sample.price,
        lineTotal,
        deliveryType: sample.deliveryType,
      },
      create: {
        id: `demo-plm-order-line-${sample.key}`,
        orderId: order.id,
        productId: product.id,
        quantity: sample.quantity,
        unitPrice: sample.price,
        lineTotal,
        deliveryType: sample.deliveryType,
        ...(sample.deliveryType === OrderLineDeliveryType.VENDOR
          ? {
              vendorName: 'Demo Precision Fabricators',
              vendorContactInfo: 'Rajesh Kumar · vendor@example.com · +91 90000 00000',
              vendorExpectedLeadTime: '4 weeks',
            }
          : {}),
      },
    });
    await prisma.plmTracker.upsert({
      where: { orderLineId: orderLine.id },
      update: { currentStage: sample.stage, ownerId: owner.id, productionBoardId: IDS.board },
      create: {
        id: `demo-plm-tracker-${sample.key}`,
        orderLineId: orderLine.id,
        orderId: order.id,
        kickoffId: kickoff.id,
        flowType: sample.deliveryType,
        currentStage: sample.stage,
        ownerId: owner.id,
        productionBoardId: IDS.board,
        events: {
          create: {
            type: PlmEventType.CREATED,
            toStage: sample.stage,
            actorId: owner.id,
            comment: 'Persistent local PLM demonstration tracker',
          },
        },
      },
    });
  }

  // Quality checkpoint for the in-house line. It is deliberately pending
  // QMS Head review so the local UI has a meaningful QC action to exercise.
  const inHouseProduct = products[1];
  const inHouseLine = await prisma.orderLineItem.findUniqueOrThrow({
    where: { id: 'demo-plm-order-line-inhouse' },
  });
  const template = await prisma.qmsQuestionTemplate.upsert({
    where: {
      templateCode_version: {
        templateCode: 'PLM-DEMO-FINAL-QC',
        version: 1,
      },
    },
    update: {
      status: QmsTemplateStatus.APPROVED,
      approvedById: owner.id,
      approvedAt: new Date(),
      effectiveFrom: new Date(),
    },
    create: {
      id: 'demo-plm-qc-template',
      templateCode: 'PLM-DEMO-FINAL-QC',
      name: 'PLM Demo Final Quality Inspection',
      description: 'Customer-facing final QC checks for the seeded automation line.',
      templateType: QmsTemplateType.FINAL,
      status: QmsTemplateStatus.APPROVED,
      effectiveFrom: dateFromToday(-7),
      createdById: owner.id,
      approvedById: owner.id,
      approvedAt: dateFromToday(-7),
    },
  });
  const questions = [
    {
      id: 'demo-plm-qc-question-1',
      sequence: 1,
      prompt: 'Dimensions and assembly match the approved drawing',
      responseType: QmsResponseType.PASS_FAIL_NA,
      acceptanceCriteria: 'All critical dimensions within approved tolerance',
    },
    {
      id: 'demo-plm-qc-question-2',
      sequence: 2,
      prompt: 'Functional run test completed without abnormal noise or stoppage',
      responseType: QmsResponseType.PASS_FAIL_NA,
      acceptanceCriteria: 'Continuous test run completed successfully',
    },
    {
      id: 'demo-plm-qc-question-3',
      sequence: 3,
      prompt: 'Finish, labels and safety guards are complete',
      responseType: QmsResponseType.PASS_FAIL_NA,
      acceptanceCriteria: 'Visual inspection acceptable with all safety items fitted',
    },
  ];
  for (const question of questions) {
    await prisma.qmsTemplateQuestion.upsert({
      where: {
        templateId_sequence: {
          templateId: template.id,
          sequence: question.sequence,
        },
      },
      update: {
        prompt: question.prompt,
        responseType: question.responseType,
        acceptanceCriteria: question.acceptanceCriteria,
      },
      create: {
        id: question.id,
        templateId: template.id,
        section: 'Final inspection',
        sequence: question.sequence,
        prompt: question.prompt,
        responseType: question.responseType,
        required: true,
        acceptanceCriteria: question.acceptanceCriteria,
      },
    });
  }

  const plan = await prisma.qmsInspectionPlan.upsert({
    where: { planNumber: 'PLM-DEMO-QP-001' },
    update: {
      status: QmsPlanStatus.APPROVED,
      productId: inHouseProduct.id,
      orderId: order.id,
      projectKickoffId: kickoff.id,
    },
    create: {
      id: 'demo-plm-qc-plan',
      planNumber: 'PLM-DEMO-QP-001',
      name: 'Apex Automation Line Quality Plan',
      description: 'Persistent quality plan linked to the PLM demonstration order.',
      status: QmsPlanStatus.APPROVED,
      productId: inHouseProduct.id,
      orderId: order.id,
      projectKickoffId: kickoff.id,
      createdById: owner.id,
      approvedById: owner.id,
      approvedAt: dateFromToday(-5),
    },
  });
  const planStage = await prisma.qmsPlanStage.upsert({
    where: { id: 'demo-plm-qc-plan-stage' },
    update: { templateId: template.id, blocksNextStage: true },
    create: {
      id: 'demo-plm-qc-plan-stage',
      planId: plan.id,
      name: 'Final QC before dispatch',
      stageCode: 'FINAL-QC',
      sequence: 1,
      controlPoint: 'HOLD',
      templateId: template.id,
      customerWitnessRequired: false,
      blocksNextStage: true,
      instructions: 'Complete and obtain QMS Head review before dispatch clearance.',
    },
  });
  const templateSnapshot = {
    templateId: template.id,
    templateCode: template.templateCode,
    version: template.version,
    name: template.name,
    questions,
  };
  const inspection = await prisma.qmsInspection.upsert({
    where: { inspectionNumber: 'PLM-DEMO-QI-001' },
    update: {
      status: QmsInspectionStatus.PENDING_REVIEW,
      planId: plan.id,
      planStageId: planStage.id,
      productId: inHouseProduct.id,
      orderId: order.id,
      orderLineId: inHouseLine.id,
      projectKickoffId: kickoff.id,
      assignedToId: owner.id,
      inspectedById: owner.id,
      inspectedAt: dateFromToday(-1),
      quantityOffered: inHouseLine.quantity,
      quantityInspected: inHouseLine.quantity,
      quantityAccepted: inHouseLine.quantity,
      quantityRejected: 0,
      remarks: 'All checks passed; awaiting QMS Head review.',
      templateSnapshot,
    },
    create: {
      id: 'demo-plm-qc-inspection',
      inspectionNumber: 'PLM-DEMO-QI-001',
      inspectionType: QmsTemplateType.FINAL,
      status: QmsInspectionStatus.PENDING_REVIEW,
      planId: plan.id,
      planStageId: planStage.id,
      templateSnapshot,
      productId: inHouseProduct.id,
      orderId: order.id,
      orderLineId: inHouseLine.id,
      projectKickoffId: kickoff.id,
      batchOrSerial: 'PLM-DEMO-BATCH-001',
      quantityOffered: inHouseLine.quantity,
      quantityInspected: inHouseLine.quantity,
      quantityAccepted: inHouseLine.quantity,
      quantityRejected: 0,
      assignedToId: owner.id,
      inspectedById: owner.id,
      inspectedAt: dateFromToday(-1),
      remarks: 'All checks passed; awaiting QMS Head review.',
      createdById: owner.id,
    },
  });
  for (const question of questions) {
    await prisma.qmsInspectionResponse.upsert({
      where: {
        inspectionId_questionKey: {
          inspectionId: inspection.id,
          questionKey: question.id,
        },
      },
      update: {
        answer: { value: 'PASS' },
        result: QmsInspectionResult.PASS,
        comments: 'Verified during seeded final inspection.',
      },
      create: {
        inspectionId: inspection.id,
        questionKey: question.id,
        section: 'Final inspection',
        sequence: question.sequence,
        promptSnapshot: question.prompt,
        responseType: question.responseType,
        required: true,
        answer: { value: 'PASS' },
        result: QmsInspectionResult.PASS,
        comments: 'Verified during seeded final inspection.',
      },
    });
  }
  await prisma.plmTracker.update({
    where: { orderLineId: inHouseLine.id },
    data: { currentStage: PlmStage.QC },
  });

  console.log(
    `PLM + QC demo seeded for ${owner.email}. Open /plm, /qms/inspections, or order PLM-DEMO-ORD-001.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
