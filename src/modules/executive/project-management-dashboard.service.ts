import { Injectable } from '@nestjs/common';
import { KickoffMilestoneStatus, KickoffRiskStatus, OrderStatus, OrderType, PingRecipientStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { ProjectKickoffService } from '../project-kickoff/project-kickoff.service';

/** PM-attributed delivery view. Project health is intentionally delegated to the shared progress builder. */
@Injectable()
export class ProjectManagementDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kickoffs: ProjectKickoffService,
  ) {}

  async build(now = new Date()) {
    const progress = (await this.kickoffs.progressCompanyWide()).filter(
      (project) =>
        project.stages.find((stage) => stage.key === 'dispatch')?.state !==
          'COMPLETE' &&
        project.stages.find((stage) => stage.key === 'order')?.state !==
          'ATTENTION',
    );
    const kickoffIds = progress.map((project) => project.kickoffId);
    const [rows, awaitingKickoff, pings] = await Promise.all([
      this.prisma.projectKickoff.findMany({
        where: { id: { in: kickoffIds } },
        select: {
          id: true,
          projectName: true,
          createdById: true,
          createdBy: { select: { firstName: true, lastName: true } },
          order: {
            select: {
              id: true,
              orderNumber: true,
              fulfilmentStatus: true,
              confirmationSheets: {
                where: { status: 'EXECUTED' },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { deliveryDate: true },
              },
            },
          },
          milestones: { select: { id: true, name: true, targetDate: true, status: true, ownerId: true, owner: { select: { firstName: true, lastName: true } } } },
          actionItems: { select: { id: true, description: true, dueDate: true, ownerId: true, owner: { select: { firstName: true, lastName: true } }, kanbanCard: { select: { status: true, list: { select: { name: true, isDoneList: true } } } } } },
          risks: { where: { status: KickoffRiskStatus.OPEN, impact: 'HIGH' }, select: { id: true, description: true, impact: true, ownerId: true, owner: { select: { firstName: true, lastName: true } } } },
          kanbanBoard: { select: { lists: { select: { isDoneList: true, cards: { where: { status: 'ACTIVE' }, select: { listId: true } } } } } },
        },
      }),
      this.prisma.order.findMany({
        where: {
          projectKickoffs: { none: {} },
          OR: [
            { orderType: OrderType.INTERNAL, status: OrderStatus.CONFIRMED },
            { confirmationSheets: { some: { status: 'EXECUTED' } } },
          ],
        },
        select: { id: true, orderNumber: true, orderType: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.ping.findMany({
        where: { linkedRecordType: 'PROJECT_KICKOFF', linkedRecordId: { in: kickoffIds }, recipients: { some: { status: { not: PingRecipientStatus.RESOLVED } } } },
        select: { id: true, message: true, linkedRecordId: true, createdAt: true, fromEmployee: { select: { firstName: true, lastName: true } }, recipients: { where: { status: { not: PingRecipientStatus.RESOLVED } }, select: { employee: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const progressById = new Map(progress.map((project) => [project.kickoffId, project]));
    const pm = (row: (typeof rows)[number]) => `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim();
    const owner = (employee: { firstName: string; lastName: string } | null) => employee ? `${employee.firstName} ${employee.lastName}`.trim() : 'Unassigned';
    const project = (id: string) => rows.find((row) => row.id === id);
    const projects = rows.map((row) => {
      const health = progressById.get(row.id);
      const deliveryDate = row.order.confirmationSheets[0]?.deliveryDate ?? null;
      return { kickoffId: row.id, projectName: row.projectName, orderId: row.order.id, orderNumber: row.order.orderNumber, pm: pm(row), health: health?.health ?? 'ON_TRACK', healthReason: health?.healthReason ?? '', currentStage: health?.currentStage ?? '—', deliveryDate, fulfilmentStatus: row.order.fulfilmentStatus };
    });
    const blockers = rows.flatMap((row) => {
      const items = [
        ...row.milestones.filter((item) => item.status !== KickoffMilestoneStatus.COMPLETED && item.targetDate < now).map((item) => ({ project: row.projectName, pm: pm(row), blocker: `Overdue milestone: ${item.name}`, owner: owner(item.owner) })),
        ...row.actionItems.filter((item) => !item.kanbanCard || item.kanbanCard.status !== 'ACTIVE' || !item.kanbanCard.list?.isDoneList).filter((item) => item.dueDate && item.dueDate < now).map((item) => ({ project: row.projectName, pm: pm(row), blocker: `Overdue action: ${item.description}`, owner: owner(item.owner) })),
        ...row.risks.map((item) => ({ project: row.projectName, pm: pm(row), blocker: `High-impact risk: ${item.description}`, owner: owner(item.owner) })),
      ];
      return items;
    });
    const workload = new Map<string, { pm: string; openTasks: number; activeProjects: number }>();
    for (const row of rows) {
      const name = pm(row);
      const current = workload.get(row.createdById) ?? { pm: name, openTasks: 0, activeProjects: 0 };
      current.activeProjects += 1;
      current.openTasks += row.kanbanBoard.lists.filter((list) => !list.isDoneList).reduce((sum, list) => sum + list.cards.length, 0);
      workload.set(row.createdById, current);
    }
    return {
      asOf: now,
      basis: ['Project health and blocker inputs reuse ProjectKickoffService.progressCompanyWide().', 'PM attribution is the existing ProjectKickoff.createdBy assignment.', 'Awaiting Kickoff includes executed OCS orders and confirmed Internal orders without a kickoff.'],
      projects,
      blockers,
      delivery: projects.map(({ kickoffId, projectName, orderNumber, pm, deliveryDate, fulfilmentStatus }) => ({ kickoffId, projectName, orderNumber, pm, deliveryDate, fulfilmentStatus, overdue: Boolean(deliveryDate && deliveryDate < now && fulfilmentStatus !== 'FULLY_DISPATCHED') })),
      workload: Array.from(workload.values()).sort((a, b) => b.openTasks - a.openTasks),
      awaitingKickoff,
      ordersAwaitingDelivery: projects.filter((project) => project.fulfilmentStatus !== 'FULLY_DISPATCHED').map((project) => ({ orderId: project.orderId, orderNumber: project.orderNumber, projectName: project.projectName, pm: project.pm })),
      milestoneHealth: rows.flatMap((row) => row.milestones.filter((item) => item.status !== KickoffMilestoneStatus.COMPLETED && item.targetDate < now).map((item) => ({ project: row.projectName, pm: pm(row), name: item.name, targetDate: item.targetDate, owner: owner(item.owner) }))),
      actionItemHealth: rows.flatMap((row) => row.actionItems.filter((item) => !item.kanbanCard || item.kanbanCard.status !== 'ACTIVE' || !item.kanbanCard.list?.isDoneList).map((item) => ({ project: row.projectName, pm: pm(row), description: item.description, dueDate: item.dueDate, owner: owner(item.owner) }))),
      risks: rows.flatMap((row) => row.risks.map((item) => ({ project: row.projectName, pm: pm(row), description: item.description, owner: owner(item.owner) }))),
      pings: pings.map((ping) => ({ id: ping.id, project: project(ping.linkedRecordId!)?.projectName ?? 'Unknown project', message: ping.message, from: owner(ping.fromEmployee), owners: ping.recipients.map((recipient) => owner(recipient.employee)), createdAt: ping.createdAt })),
    };
  }
}