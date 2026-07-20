import {
  AccessStatus,
  DesignProjectStatus,
  KickoffRiskLevel,
  KickoffRiskStatus,
  KickoffStatus,
  OrderFinalQcStatus,
  OrderFulfilmentStatus,
  OrderStatus,
  PrismaClient,
  Role,
} from '@prisma/client';

const prisma = new PrismaClient();

const SAMPLE_CUSTOMER_ID = 'demo-progress-customer';

const projects = [
  {
    key: 'atlas',
    orderNumber: 'DEMO-ORD-ATLAS-001',
    projectName: 'Atlas Press Line Upgrade',
    orderStatus: OrderStatus.IN_PRODUCTION,
    finalQcStatus: OrderFinalQcStatus.PENDING,
    fulfilmentStatus: OrderFulfilmentStatus.NOT_DISPATCHED,
    designStatus: DesignProjectStatus.RELEASED_FOR_PRODUCTION,
    milestone: {
      name: 'Production completion',
      targetOffsetDays: 18,
      status: 'IN_PROGRESS' as const,
    },
    risk: null,
  },
  {
    key: 'zenith',
    orderNumber: 'DEMO-ORD-ZENITH-002',
    projectName: 'Zenith Packaging Cell',
    orderStatus: OrderStatus.CONFIRMED,
    finalQcStatus: OrderFinalQcStatus.PENDING,
    fulfilmentStatus: OrderFulfilmentStatus.NOT_DISPATCHED,
    designStatus: DesignProjectStatus.ON_HOLD,
    milestone: {
      name: 'Customer drawing approval',
      targetOffsetDays: -5,
      status: 'DELAYED' as const,
    },
    risk: {
      description: 'Customer drawing approval is delaying engineering release',
      likelihood: KickoffRiskLevel.HIGH,
      impact: KickoffRiskLevel.HIGH,
      status: KickoffRiskStatus.OPEN,
    },
  },
  {
    key: 'nova',
    orderNumber: 'DEMO-ORD-NOVA-003',
    projectName: 'Nova Conveyor Retrofit',
    orderStatus: OrderStatus.DELIVERED,
    finalQcStatus: OrderFinalQcStatus.CLEARED,
    fulfilmentStatus: OrderFulfilmentStatus.FULLY_DISPATCHED,
    designStatus: DesignProjectStatus.CLOSED,
    milestone: {
      name: 'Customer delivery',
      targetOffsetDays: -2,
      status: 'COMPLETED' as const,
    },
    risk: null,
  },
];

function dateFromToday(offsetDays: number): Date {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date;
}

async function main() {
  const adminEmail =
    process.env.SEED_ADMIN_EMAIL ?? 'nithin.gangadhar@phaze-dynamics.com';
  const admin = await prisma.employee.findFirst({
    where: {
      OR: [{ email: adminEmail }, { role: Role.SUPER_ADMIN }],
      accessStatus: AccessStatus.ACTIVE,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) {
    throw new Error(
      'Run the baseline seed first: no active SUPER_ADMIN exists.',
    );
  }

  const customer = await prisma.customer.upsert({
    where: { id: SAMPLE_CUSTOMER_ID },
    update: { name: 'Demo Industrial Systems Ltd', ownerId: admin.id },
    create: {
      id: SAMPLE_CUSTOMER_ID,
      name: 'Demo Industrial Systems Ltd',
      industry: 'Industrial Automation',
      billingAddress: {
        line1: '100 Demonstration Industrial Estate',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
        country: 'India',
      },
      ownerId: admin.id,
    },
  });

  for (const sample of projects) {
    const orderId = `demo-progress-order-${sample.key}`;
    const boardId = `demo-progress-board-${sample.key}`;
    const kickoffId = `demo-progress-kickoff-${sample.key}`;

    const order = await prisma.order.upsert({
      where: { orderNumber: sample.orderNumber },
      update: {
        customerId: customer.id,
        ownerId: admin.id,
        status: sample.orderStatus,
        finalQcStatus: sample.finalQcStatus,
        fulfilmentStatus: sample.fulfilmentStatus,
      },
      create: {
        id: orderId,
        orderNumber: sample.orderNumber,
        customerId: customer.id,
        ownerId: admin.id,
        status: sample.orderStatus,
        finalQcStatus: sample.finalQcStatus,
        fulfilmentStatus: sample.fulfilmentStatus,
        totalAmount: 1250000,
      },
    });

    await prisma.kanbanBoard.upsert({
      where: { id: boardId },
      update: { name: sample.projectName },
      create: { id: boardId, name: sample.projectName, createdById: admin.id },
    });
    await prisma.kanbanBoardMember.upsert({
      where: { boardId_employeeId: { boardId, employeeId: admin.id } },
      update: {},
      create: { boardId, employeeId: admin.id, addedById: admin.id },
    });
    for (const list of [
      { suffix: 'todo', name: 'To Do', position: 1024, isDoneList: false },
      {
        suffix: 'progress',
        name: 'In progress',
        position: 2048,
        isDoneList: false,
      },
      {
        suffix: 'completed',
        name: 'Completed',
        position: 3072,
        isDoneList: true,
      },
    ]) {
      await prisma.kanbanList.upsert({
        where: { id: `${boardId}-${list.suffix}` },
        update: {
          name: list.name,
          position: list.position,
          isDoneList: list.isDoneList,
        },
        create: {
          id: `${boardId}-${list.suffix}`,
          boardId,
          name: list.name,
          position: list.position,
          isDoneList: list.isDoneList,
          createdById: admin.id,
        },
      });
    }

    await prisma.projectKickoff.upsert({
      where: { id: kickoffId },
      update: {
        projectName: sample.projectName,
        status: KickoffStatus.COMPLETED,
        kanbanBoardId: boardId,
      },
      create: {
        id: kickoffId,
        orderId: order.id,
        projectName: sample.projectName,
        meetingDate: dateFromToday(-30),
        overviewAndScope:
          'Persistent sample project for dashboard progress tracking.',
        status: KickoffStatus.COMPLETED,
        kanbanBoardId: boardId,
        createdById: admin.id,
      },
    });

    await prisma.designProject.upsert({
      where: { id: `demo-progress-design-${sample.key}` },
      update: {
        status: sample.designStatus,
        projectKickoffId: kickoffId,
        orderId: order.id,
      },
      create: {
        id: `demo-progress-design-${sample.key}`,
        projectNumber: `DEMO-DES-${sample.key.toUpperCase()}`,
        name: `${sample.projectName} Engineering`,
        status: sample.designStatus,
        orderId: order.id,
        projectKickoffId: kickoffId,
        leadDesignerId: admin.id,
        targetDate: dateFromToday(14),
        createdById: admin.id,
      },
    });

    await prisma.kickoffMilestone.upsert({
      where: { id: `demo-progress-milestone-${sample.key}` },
      update: {
        name: sample.milestone.name,
        targetDate: dateFromToday(sample.milestone.targetOffsetDays),
        status: sample.milestone.status,
      },
      create: {
        id: `demo-progress-milestone-${sample.key}`,
        kickoffId,
        name: sample.milestone.name,
        targetDate: dateFromToday(sample.milestone.targetOffsetDays),
        ownerId: admin.id,
        status: sample.milestone.status,
      },
    });

    if (sample.risk) {
      await prisma.kickoffRisk.upsert({
        where: { id: `demo-progress-risk-${sample.key}` },
        update: sample.risk,
        create: {
          id: `demo-progress-risk-${sample.key}`,
          kickoffId,
          ownerId: admin.id,
          ...sample.risk,
        },
      });
    }
  }

  console.log(
    `Project progress samples seeded for ${admin.email}: ${projects
      .map((project) => project.projectName)
      .join(', ')}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
