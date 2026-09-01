import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QmsInspectionResult } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { QmsAccessService } from './qms-access.service';
import {
  CompleteQmsInspectionDto,
  CreateQmsInspectionDto,
  CreateQmsPlanDto,
  CreateQmsTemplateDto,
  LinkQmsInspectionDto,
} from './dto/qms.dto';
import {
  AddQmsCapaActionDto,
  CompleteQmsCapaActionDto,
  ContainQmsNcrDto,
  CreateQmsCapaDto,
  CreateQmsNcrDto,
  DispositionQmsNcrDto,
  QmsAnalyticsQueryDto,
  UpdateQmsCopqDto,
} from './dto/qms-phase2.dto';
import {
  CompleteQmsAuditDto,
  CreateQmsAuditDto,
  CreateQmsAuditProgramDto,
} from './dto/qms-phase3.dto';
import {
  GenerateQmsReportDto,
  ReviseQmsReportDto,
  SignQmsReportCustomerDto,
} from './dto/qms-phase4.dto';
import {
  CloseQmsComplaintDto,
  CreateQmsCalibrationDto,
  CreateQmsComplaintDto,
  CreateQmsEquipmentDto,
  InvestigateQmsComplaintDto,
} from './dto/qms-phase5.dto';
import { KanbanNotificationsService } from '../notifications/kanban-notifications.service';
import { ItemCostService } from '../bom/item-cost.service';
@Injectable()
export class QmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: QmsAccessService,
    private readonly notifications: KanbanNotificationsService,
    private readonly itemCosts: ItemCostService,
  ) {}
  async accessInfo(u: AuthenticatedUser) {
    return this.access.accessFor(u);
  }
  async employees(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        employeeId: true,
        firstName: true,
        lastName: true,
        email: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }
  async customers(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.customer.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
  async dashboard(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const now = new Date();
    const [
      open,
      pending,
      failed,
      passed,
      total,
      openNcrs,
      openCapas,
      overdueActions,
      scheduledAudits,
      pendingAuditReview,
      overdueAudits,
      pendingReportSignatures,
      executedReports,
    ] = await Promise.all([
      this.prisma.qmsInspection.count({
        where: { status: { in: ['DRAFT', 'IN_PROGRESS', 'PENDING_REVIEW'] } },
      }),
      this.prisma.qmsInspection.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.qmsInspection.count({ where: { status: 'FAILED' } }),
      this.prisma.qmsInspection.count({ where: { status: 'PASSED' } }),
      this.prisma.qmsInspection.count({
        where: { status: { in: ['PASSED', 'CONDITIONAL_PASS', 'FAILED'] } },
      }),
      this.prisma.qmsNonConformance.count({
        where: { status: { notIn: ['CLOSED', 'CANCELLED'] } },
      }),
      this.prisma.qmsCapa.count({
        where: { status: { notIn: ['CLOSED', 'EFFECTIVE'] } },
      }),
      this.prisma.qmsCapaAction.count({
        where: {
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          dueDate: { lt: now },
        },
      }),
      this.prisma.qmsAudit.count({
        where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
      }),
      this.prisma.qmsAudit.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.qmsAudit.count({
        where: {
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          scheduledTo: { lt: now },
        },
      }),
      this.prisma.qmsQualityReport.count({
        where: {
          status: {
            in: ['AWAITING_INTERNAL_SIGNATURE', 'AWAITING_CUSTOMER_SIGNATURE'],
          },
        },
      }),
      this.prisma.qmsQualityReport.count({ where: { status: 'EXECUTED' } }),
    ]);
    return {
      openInspections: open,
      pendingReview: pending,
      failedInspections: failed,
      firstPassYield: total ? Number(((passed / total) * 100).toFixed(1)) : 0,
      openNcrs,
      openCapas,
      overdueActions,
      scheduledAudits,
      pendingAuditReview,
      overdueAudits,
      pendingReportSignatures,
      executedReports,
      byType: await this.prisma.qmsInspection.groupBy({
        by: ['inspectionType', 'status'],
        _count: true,
      }),
    };
  }
  async templates(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.qmsQuestionTemplate.findMany({
      include: { questions: { orderBy: { sequence: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    });
  }
  async createTemplate(d: CreateQmsTemplateDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    if (!d.questions.length)
      throw new BadRequestException('Template requires at least one question');
    return this.prisma.qmsQuestionTemplate.create({
      data: {
        templateCode: d.templateCode.toUpperCase(),
        name: d.name,
        description: d.description,
        templateType: d.templateType,
        createdById: u.id,
        questions: {
          create: d.questions.map((q) => ({
            ...q,
            options: q.options ?? undefined,
          })),
        },
      },
      include: { questions: true },
    });
  }
  async submitTemplate(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.moveTemplate(id, 'DRAFT', 'PENDING_APPROVAL', {
      submittedById: u.id,
      submittedAt: new Date(),
    });
  }
  async approveTemplate(id: string, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const x = await this.requireTemplate(id);
    if (x.status !== 'PENDING_APPROVAL')
      throw new BadRequestException('Template is not pending approval');
    if (x.createdById === u.id)
      throw new BadRequestException(
        'QMS Head cannot approve a template they created',
      );
    return this.prisma.qmsQuestionTemplate.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: u.id,
        approvedAt: new Date(),
        effectiveFrom: new Date(),
      },
    });
  }
  async reviseTemplate(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const x = await this.prisma.qmsQuestionTemplate.findUnique({
      where: { id },
      include: { questions: { orderBy: { sequence: 'asc' } } },
    });
    if (!x) throw new NotFoundException('Template not found');
    if (!['APPROVED', 'RETIRED'].includes(x.status))
      throw new BadRequestException(
        'Only an approved or retired template can be revised',
      );
    const latest = await this.prisma.qmsQuestionTemplate.aggregate({
      where: { templateCode: x.templateCode },
      _max: { version: true },
    });
    return this.prisma.qmsQuestionTemplate.create({
      data: {
        templateCode: x.templateCode,
        name: x.name,
        description: x.description,
        templateType: x.templateType,
        version: (latest._max.version ?? x.version) + 1,
        createdById: u.id,
        questions: {
          create: x.questions.map((q) => ({
            section: q.section,
            sequence: q.sequence,
            prompt: q.prompt,
            responseType: q.responseType,
            required: q.required,
            weight: q.weight,
            unit: q.unit,
            lowerLimit: q.lowerLimit,
            upperLimit: q.upperLimit,
            options: q.options ?? undefined,
            acceptanceCriteria: q.acceptanceCriteria,
            evidenceOnFailure: q.evidenceOnFailure,
          })),
        },
      },
      include: { questions: true },
    });
  }
  async plans(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.qmsInspectionPlan.findMany({
      include: {
        stages: { include: { template: true }, orderBy: { sequence: 'asc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
  async createPlan(d: CreateQmsPlanDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    if (!d.stages.length)
      throw new BadRequestException('Quality plan requires at least one stage');
    const templates = await this.prisma.qmsQuestionTemplate.count({
      where: {
        id: { in: d.stages.map((x) => x.templateId) },
        status: 'APPROVED',
      },
    });
    if (templates !== new Set(d.stages.map((x) => x.templateId)).size)
      throw new BadRequestException(
        'Every stage must use an approved template',
      );
    return this.prisma.$transaction(async (tx) =>
      tx.qmsInspectionPlan.create({
        data: {
          planNumber: await this.number(tx, 'QMS_PLAN', 'QP'),
          name: d.name,
          description: d.description,
          productId: d.productId,
          orderId: d.orderId,
          projectKickoffId: d.projectKickoffId,
          createdById: u.id,
          stages: { create: d.stages },
        },
        include: { stages: true },
      }),
    );
  }
  async submitPlan(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const x = await this.requirePlan(id);
    if (x.status !== 'DRAFT')
      throw new BadRequestException('Only draft plan can be submitted');
    return this.prisma.qmsInspectionPlan.update({
      where: { id },
      data: {
        status: 'PENDING_APPROVAL',
        submittedById: u.id,
        submittedAt: new Date(),
      },
    });
  }
  async approvePlan(id: string, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const x = await this.requirePlan(id);
    if (x.status !== 'PENDING_APPROVAL')
      throw new BadRequestException('Plan is not pending approval');
    if (x.createdById === u.id)
      throw new BadRequestException(
        'QMS Head cannot approve a plan they created',
      );
    return this.prisma.qmsInspectionPlan.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: u.id, approvedAt: new Date() },
    });
  }
  // Linked order line surfaced for display so an inspector can confirm which
  // PLM line an inspection satisfies (the QC gate keys off this link).
  private orderLineDisplayInclude() {
    return {
      select: {
        id: true,
        quantity: true,
        product: { select: { name: true, sku: true } },
        order: { select: { id: true, orderNumber: true } },
      },
    } as const;
  }
  async inspections(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.qmsInspection.findMany({
      include: {
        responses: true,
        planStage: true,
        orderLine: this.orderLineDisplayInclude(),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async inspection(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const x = await this.prisma.qmsInspection.findUnique({
      where: { id },
      include: {
        responses: { orderBy: { sequence: 'asc' } },
        planStage: true,
        plan: true,
        orderLine: this.orderLineDisplayInclude(),
      },
    });
    if (!x) throw new NotFoundException('Inspection not found');
    return x;
  }
  // Pick list for the Start/Link inspection selectors. QMS-guarded (not the
  // ownership-scoped Sales /orders route) so any quality user can pick a line.
  async orderLinesForSelection(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const orders = await this.prisma.order.findMany({
      where: { status: { notIn: ['CANCELLED'] } },
      select: {
        id: true,
        orderNumber: true,
        customer: { select: { name: true } },
        lineItems: {
          select: {
            id: true,
            quantity: true,
            product: { select: { name: true, sku: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return orders.filter((o) => o.lineItems.length > 0);
  }
  async linkInspection(
    id: string,
    d: LinkQmsInspectionDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const x = await this.prisma.qmsInspection.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!x) throw new NotFoundException('Inspection not found');
    if (['FAILED', 'CANCELLED'].includes(x.status))
      throw new BadRequestException(
        'A failed or cancelled inspection cannot be linked to an order line',
      );
    const line = await this.prisma.orderLineItem.findUnique({
      where: { id: d.orderLineId },
      select: { id: true, orderId: true, productId: true },
    });
    if (!line) throw new NotFoundException('Order line not found');
    return this.prisma.qmsInspection.update({
      where: { id },
      data: {
        orderLineId: line.id,
        orderId: line.orderId,
        productId: line.productId,
      },
      include: {
        responses: { orderBy: { sequence: 'asc' } },
        planStage: true,
        plan: true,
        orderLine: this.orderLineDisplayInclude(),
      },
    });
  }
  async createInspection(d: CreateQmsInspectionDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const t = await this.prisma.qmsQuestionTemplate.findUnique({
      where: { id: d.templateId },
      include: { questions: { orderBy: { sequence: 'asc' } } },
    });
    if (!t || t.status !== 'APPROVED')
      throw new BadRequestException('Select an approved inspection template');
    const snapshot = {
      templateId: t.id,
      templateCode: t.templateCode,
      version: t.version,
      name: t.name,
      questions: t.questions,
    };
    return this.prisma.$transaction(async (tx) =>
      tx.qmsInspection.create({
        data: {
          inspectionNumber: await this.number(tx, 'QMS_INSPECTION', 'QI'),
          inspectionType: t.templateType,
          templateSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          planId: d.planId,
          planStageId: d.planStageId,
          productId: d.productId,
          orderId: d.orderId,
          orderLineId: d.orderLineId,
          projectKickoffId: d.projectKickoffId,
          grnId: d.grnId,
          batchOrSerial: d.batchOrSerial,
          assignedToId: d.assignedToId,
          quantityOffered: d.quantityOffered,
          createdById: u.id,
          responses: {
            create: t.questions.map((q) => ({
              questionKey: q.id,
              section: q.section,
              sequence: q.sequence,
              promptSnapshot: q.prompt,
              responseType: q.responseType,
              required: q.required,
            })),
          },
        },
        include: { responses: true },
      }),
    );
  }
  async completeInspection(
    id: string,
    d: CompleteQmsInspectionDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const x = await this.inspection(id, u);
    if (!['DRAFT', 'IN_PROGRESS'].includes(x.status))
      throw new BadRequestException(
        'Inspection cannot be edited in its current status',
      );
    const map = new Map(d.responses.map((r) => [r.questionKey, r]));
    for (const q of x.responses)
      if (q.required && !map.has(q.questionKey))
        throw new BadRequestException(
          `Required question is unanswered: ${q.promptSnapshot}`,
        );
    return this.prisma.$transaction(async (tx) => {
      for (const r of d.responses)
        await tx.qmsInspectionResponse.update({
          where: {
            inspectionId_questionKey: {
              inspectionId: id,
              questionKey: r.questionKey,
            },
          },
          data: {
            answer: r.answer as Prisma.InputJsonValue,
            result: r.result,
            comments: r.comments,
            evidence: r.evidence as Prisma.InputJsonValue,
          },
        });
      return tx.qmsInspection.update({
        where: { id },
        data: {
          status: 'PENDING_REVIEW',
          overallResult: d.overallResult,
          quantityInspected: d.quantityInspected,
          quantityAccepted: d.quantityAccepted,
          quantityRejected: d.quantityRejected,
          remarks: d.remarks,
          inspectedById: u.id,
          inspectedAt: new Date(),
        },
      });
    });
  }
  async reviewInspection(
    id: string,
    result: QmsInspectionResult,
    u: AuthenticatedUser,
  ) {
    await this.access.assertHead(u);
    const x = await this.prisma.qmsInspection.findUnique({ where: { id } });
    if (!x || x.status !== 'PENDING_REVIEW')
      throw new BadRequestException('Inspection is not pending review');
    const status =
      result === 'PASS'
        ? 'PASSED'
        : result === 'CONDITIONAL_PASS'
          ? 'CONDITIONAL_PASS'
          : 'FAILED';
    return this.prisma.$transaction(async (tx) => {
      const inspection = await tx.qmsInspection.update({
        where: { id },
        data: {
          status,
          overallResult: result,
          reviewedById: u.id,
          reviewedAt: new Date(),
        },
      });
      if (
        result === 'FAIL' &&
        !(await tx.qmsNonConformance.findFirst({ where: { inspectionId: id } }))
      )
        await tx.qmsNonConformance.create({
          data: {
            ncrNumber: await this.number(tx, 'QMS_NCR', 'QNCR'),
            source: 'INSPECTION',
            sourceId: id,
            inspectionId: id,
            severity: 'MAJOR',
            title: `Failed inspection ${x.inspectionNumber}`,
            description:
              x.remarks ||
              `Inspection ${x.inspectionNumber} failed QMS Head review`,
            productId: x.productId,
            orderId: x.orderId,
            projectKickoffId: x.projectKickoffId,
            grnId: x.grnId,
            batchOrSerial: x.batchOrSerial,
            affectedQuantity: x.quantityRejected,
            ownerId: x.inspectedById || x.createdById,
            targetDate: new Date(Date.now() + 7 * 86400000),
            raisedById: u.id,
          },
        });
      return inspection;
    });
  }
  async ncrs(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    await this.syncStoreNcrs();
    return this.prisma.qmsNonConformance.findMany({
      include: { capa: { include: { actions: true } }, inspection: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  async ncr(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const x = await this.prisma.qmsNonConformance.findUnique({
      where: { id },
      include: {
        capa: { include: { actions: { orderBy: { dueDate: 'asc' } } } },
        inspection: true,
      },
    });
    if (!x) throw new NotFoundException('QMS NCR not found');
    let suggestedScrapCost: Prisma.Decimal | null = null;
    if (x.itemId && x.affectedQuantity != null) {
      const suggested = await this.copqForDisposition(
        'SCRAP',
        x.itemId,
        x.affectedQuantity,
        undefined,
      );
      suggestedScrapCost = suggested.costOfPoorQuality ?? null;
    }
    return { ...x, suggestedScrapCost };
  }
  async createNcr(d: CreateQmsNcrDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    if (
      d.inspectionId &&
      !(await this.prisma.qmsInspection.findUnique({
        where: { id: d.inspectionId },
      }))
    )
      throw new BadRequestException('Inspection not found');
    return this.prisma.$transaction(async (tx) =>
      tx.qmsNonConformance.create({
        data: {
          ...d,
          costOfPoorQualitySource:
            d.costOfPoorQuality === undefined ? undefined : 'MANUAL',
          ncrNumber: await this.number(tx, 'QMS_NCR', 'QNCR'),
          targetDate: new Date(d.targetDate),
          raisedById: u.id,
        },
      }),
    );
  }
  async containNcr(id: string, d: ContainQmsNcrDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const x = await this.requireNcr(id);
    if (!['OPEN', 'INVESTIGATION'].includes(x.status))
      throw new BadRequestException(
        'NCR cannot be contained in its current state',
      );
    return this.prisma.qmsNonConformance.update({
      where: { id },
      data: {
        status: 'CONTAINED',
        containmentAction: d.containmentAction,
        containedAt: new Date(),
      },
    });
  }
  async dispositionNcr(
    id: string,
    d: DispositionQmsNcrDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertHead(u);
    const x = await this.requireNcr(id);
    if (['CLOSED', 'CANCELLED'].includes(x.status))
      throw new BadRequestException('Closed NCR cannot be dispositioned');
    if (
      ['USE_AS_IS', 'CONCESSION'].includes(d.disposition) &&
      !d.dispositionNotes?.trim()
    )
      throw new BadRequestException(
        'Use-as-is and concession require approval notes',
      );
    const copq = await this.copqForDisposition(
      d.disposition,
      x.itemId,
      x.affectedQuantity,
      d.costOfPoorQuality,
    );
    return this.prisma.qmsNonConformance.update({
      where: { id },
      data: {
        status: x.capa ? 'CAPA_IN_PROGRESS' : 'PENDING_DISPOSITION',
        disposition: d.disposition,
        dispositionNotes: d.dispositionNotes,
        concessionRequired:
          d.concessionRequired ?? d.disposition === 'CONCESSION',
        dispositionedById: u.id,
        dispositionedAt: new Date(),
        ...copq,
      },
    });
  }
  async updateCopq(id: string, d: UpdateQmsCopqDto, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    await this.requireNcr(id);
    return this.prisma.qmsNonConformance.update({
      where: { id },
      data: {
        costOfPoorQuality: d.costOfPoorQuality,
        costOfPoorQualitySource: 'MANUAL',
      },
    });
  }
  async createCapa(ncrId: string, d: CreateQmsCapaDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const n = await this.requireNcr(ncrId);
    if (n.capa) throw new BadRequestException('NCR already has a CAPA');
    const capa = await this.prisma.$transaction(async (tx) => {
      const c = await tx.qmsCapa.create({
        data: {
          capaNumber: await this.number(tx, 'QMS_CAPA', 'CAPA'),
          ncrId,
          problemStatement: d.problemStatement,
          ownerId: d.ownerId,
          rootCauseMethod: d.rootCauseMethod,
          rootCauseAnalysis: d.rootCauseAnalysis as Prisma.InputJsonValue,
          rootCauseConclusion: d.rootCauseConclusion,
          correction: d.correction,
          effectivenessCriteria: d.effectivenessCriteria,
          effectivenessDueDate: d.effectivenessDueDate
            ? new Date(d.effectivenessDueDate)
            : undefined,
          createdById: u.id,
          status: 'IN_PROGRESS',
        },
      });
      await tx.qmsNonConformance.update({
        where: { id: ncrId },
        data: { status: 'CAPA_IN_PROGRESS' },
      });
      return c;
    });
    return capa;
  }
  async capas(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.qmsCapa.findMany({
      include: { ncr: true, actions: { orderBy: { dueDate: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }
  async addCapaAction(
    capaId: string,
    d: AddQmsCapaActionDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const c = await this.requireCapa(capaId);
    if (['CLOSED', 'EFFECTIVE'].includes(c.status))
      throw new BadRequestException('Closed CAPA cannot receive actions');
    const action = await this.prisma.qmsCapaAction.create({
      data: {
        capaId,
        actionType: d.actionType,
        description: d.description,
        ownerId: d.ownerId,
        dueDate: new Date(d.dueDate),
      },
    });
    await this.notifications.notifyQmsAction({
      recipientId: d.ownerId,
      actorId: u.id,
      message: `QMS action assigned for ${c.capaNumber}: ${d.description}`,
    });
    return action;
  }
  async completeCapaAction(
    id: string,
    d: CompleteQmsCapaActionDto,
    u: AuthenticatedUser,
  ) {
    const a = await this.access.accessFor(u);
    const x = await this.prisma.qmsCapaAction.findUnique({ where: { id } });
    if (!x) throw new NotFoundException('CAPA action not found');
    if (x.ownerId !== u.id && !a.isQualityUser)
      throw new BadRequestException(
        'Only the action owner or Quality user may complete it',
      );
    if (!['OPEN', 'IN_PROGRESS'].includes(x.status))
      throw new BadRequestException('Action is not open');
    return this.prisma.qmsCapaAction.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completionNote: d.completionNote,
        evidence: d.evidence as Prisma.InputJsonValue,
        completedById: u.id,
        completedAt: new Date(),
      },
    });
  }
  async verifyCapaAction(id: string, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const x = await this.prisma.qmsCapaAction.findUnique({ where: { id } });
    if (!x || x.status !== 'COMPLETED')
      throw new BadRequestException('Only completed actions can be verified');
    return this.prisma.qmsCapaAction.update({
      where: { id },
      data: { status: 'VERIFIED', verifiedById: u.id, verifiedAt: new Date() },
    });
  }
  async submitEffectiveness(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const c = await this.prisma.qmsCapa.findUnique({
      where: { id },
      include: { actions: true },
    });
    if (!c) throw new NotFoundException('CAPA not found');
    if (!c.actions.length || c.actions.some((a) => a.status !== 'VERIFIED'))
      throw new BadRequestException('Every CAPA action must be verified first');
    if (!c.rootCauseConclusion || !c.effectivenessCriteria)
      throw new BadRequestException(
        'Root-cause conclusion and effectiveness criteria are required',
      );
    return this.prisma.$transaction([
      this.prisma.qmsCapa.update({
        where: { id },
        data: { status: 'PENDING_EFFECTIVENESS' },
      }),
      this.prisma.qmsNonConformance.update({
        where: { id: c.ncrId },
        data: { status: 'VERIFICATION' },
      }),
    ]);
  }
  async reviewEffectiveness(
    id: string,
    effective: boolean,
    result: string,
    u: AuthenticatedUser,
  ) {
    await this.access.assertHead(u);
    const c = await this.requireCapa(id);
    if (c.status !== 'PENDING_EFFECTIVENESS')
      throw new BadRequestException('CAPA is not pending effectiveness review');
    if (!effective)
      return this.prisma.qmsCapa.update({
        where: { id },
        data: {
          status: 'INEFFECTIVE',
          effectivenessResult: result,
          effectivenessReviewedById: u.id,
          effectivenessReviewedAt: new Date(),
        },
      });
    return this.prisma.$transaction(async (tx) => {
      const capa = await tx.qmsCapa.update({
        where: { id },
        data: {
          status: 'CLOSED',
          effectivenessResult: result,
          effectivenessReviewedById: u.id,
          effectivenessReviewedAt: new Date(),
          closedById: u.id,
          closedAt: new Date(),
        },
      });
      await tx.qmsNonConformance.update({
        where: { id: c.ncrId },
        data: {
          status: 'CLOSED',
          closedById: u.id,
          closedAt: new Date(),
          closureNote: `CAPA ${c.capaNumber} verified effective: ${result}`,
        },
      });
      return capa;
    });
  }
  async auditPrograms(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.qmsAuditProgram.findMany({
      include: {
        items: { include: { template: true }, orderBy: { plannedFrom: 'asc' } },
        audits: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async createAuditProgram(d: CreateQmsAuditProgramDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    if (!d.items.length)
      throw new BadRequestException(
        'Audit programme requires at least one planned audit',
      );
    await this.validateAuditItems(d.items);
    return this.prisma.$transaction(async (tx) =>
      tx.qmsAuditProgram.create({
        data: {
          programNumber: await this.number(tx, 'QMS_AUDIT_PROGRAM', 'QAP'),
          name: d.name,
          description: d.description,
          financialYear: d.financialYear,
          createdById: u.id,
          items: {
            create: d.items.map((x) => ({
              ...x,
              plannedFrom: new Date(x.plannedFrom),
              plannedTo: new Date(x.plannedTo),
            })),
          },
        },
        include: { items: true },
      }),
    );
  }
  async submitAuditProgram(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const x = await this.requireAuditProgram(id);
    if (x.status !== 'DRAFT')
      throw new BadRequestException('Only draft programmes can be submitted');
    return this.prisma.qmsAuditProgram.update({
      where: { id },
      data: {
        status: 'PENDING_APPROVAL',
        submittedById: u.id,
        submittedAt: new Date(),
      },
    });
  }
  async approveAuditProgram(id: string, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const x = await this.requireAuditProgram(id);
    if (x.status !== 'PENDING_APPROVAL')
      throw new BadRequestException('Programme is not pending approval');
    if (x.createdById === u.id)
      throw new BadRequestException(
        'QMS Head cannot approve a programme they created',
      );
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.qmsAuditProgram.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedById: u.id,
          approvedAt: new Date(),
        },
      });
      for (const item of x.items)
        await this.createAuditFromItem(tx, item, u.id, id);
      return p;
    });
  }
  async audits(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.qmsAudit.findMany({
      include: { findings: true, program: true },
      orderBy: { scheduledFrom: 'desc' },
    });
  }
  async audit(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const x = await this.prisma.qmsAudit.findUnique({
      where: { id },
      include: {
        responses: { orderBy: { sequence: 'asc' } },
        findings: true,
        program: true,
      },
    });
    if (!x) throw new NotFoundException('Audit not found');
    return x;
  }
  async createAudit(d: CreateQmsAuditDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    await this.validateAuditItems([d]);
    return this.prisma.$transaction((tx) =>
      this.createAuditFromItem(
        tx,
        {
          ...d,
          plannedFrom: new Date(d.plannedFrom),
          plannedTo: new Date(d.plannedTo),
        },
        u.id,
        d.programId,
      ),
    );
  }
  async startAudit(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const x = await this.requireAudit(id);
    if (x.status !== 'SCHEDULED')
      throw new BadRequestException('Only scheduled audits can be started');
    if (x.leadAuditorId !== u.id)
      throw new BadRequestException(
        'Only the assigned lead auditor can start this audit',
      );
    return this.prisma.qmsAudit.update({
      where: { id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
  }
  async completeAudit(
    id: string,
    d: CompleteQmsAuditDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const x = await this.prisma.qmsAudit.findUnique({
      where: { id },
      include: { responses: true },
    });
    if (!x) throw new NotFoundException('Audit not found');
    if (x.status !== 'IN_PROGRESS' || x.leadAuditorId !== u.id)
      throw new BadRequestException(
        'Only the lead auditor can complete an in-progress audit',
      );
    const answers = new Map(d.responses.map((r) => [r.questionKey, r]));
    for (const q of x.responses)
      if (q.required && !answers.has(q.questionKey))
        throw new BadRequestException(
          `Required question is unanswered: ${q.promptSnapshot}`,
        );
    for (const f of d.findings)
      if (
        f.findingType.includes('NONCONFORMITY') &&
        (!f.ownerId || !f.targetDate)
      )
        throw new BadRequestException(
          'Nonconformities require an owner and target date',
        );
    return this.prisma.$transaction(async (tx) => {
      for (const r of d.responses)
        await tx.qmsAuditResponse.update({
          where: {
            auditId_questionKey: { auditId: id, questionKey: r.questionKey },
          },
          data: {
            answer: r.answer as Prisma.InputJsonValue,
            result: r.result,
            comments: r.comments,
            evidence: r.evidence as Prisma.InputJsonValue,
          },
        });
      for (const f of d.findings) {
        let ncrId: string | undefined;
        if (f.findingType.includes('NONCONFORMITY')) {
          const n = await tx.qmsNonConformance.create({
            data: {
              ncrNumber: await this.number(tx, 'QMS_NCR', 'QNCR'),
              source: 'AUDIT',
              sourceId: id,
              severity:
                f.findingType === 'MAJOR_NONCONFORMITY' ? 'MAJOR' : 'MINOR',
              title: `Audit finding: ${x.auditNumber}`,
              description: f.description,
              requirement: f.clause,
              actualResult: f.evidence,
              ownerId: f.ownerId!,
              targetDate: new Date(f.targetDate!),
              raisedById: u.id,
            },
          });
          ncrId = n.id;
        }
        await tx.qmsAuditFinding.create({
          data: {
            ...f,
            auditId: id,
            targetDate: f.targetDate ? new Date(f.targetDate) : undefined,
            ncrId,
            createdById: u.id,
          },
        });
      }
      return tx.qmsAudit.update({
        where: { id },
        data: {
          status: 'PENDING_REVIEW',
          conclusion: d.conclusion,
          completedAt: new Date(),
        },
      });
    });
  }
  async reviewAudit(id: string, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const x = await this.requireAudit(id);
    if (x.status !== 'PENDING_REVIEW')
      throw new BadRequestException('Audit is not pending review');
    return this.prisma.qmsAudit.update({
      where: { id },
      data: { status: 'CLOSED', reviewedById: u.id, reviewedAt: new Date() },
    });
  }
  async reports(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.qmsQualityReport.findMany({
      orderBy: [{ generatedAt: 'desc' }, { revision: 'desc' }],
    });
  }
  async report(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const x = await this.prisma.qmsQualityReport.findUnique({ where: { id } });
    if (!x) throw new NotFoundException('Quality report not found');
    return x;
  }
  async generateReport(d: GenerateQmsReportDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    if (
      await this.prisma.qmsQualityReport.findFirst({
        where: {
          reportType: d.reportType,
          ...(d.reportType === 'INSPECTION'
            ? { inspectionId: d.sourceId }
            : { auditId: d.sourceId }),
          status: { not: 'SUPERSEDED' },
        },
      })
    )
      throw new BadRequestException(
        'An active report already exists for this source; create a revision instead',
      );
    const source = await this.reportSource(d.reportType, d.sourceId);
    return this.prisma.$transaction(async (tx) =>
      tx.qmsQualityReport.create({
        data: {
          reportNumber: await this.number(tx, 'QMS_REPORT', 'QR'),
          reportType: d.reportType,
          inspectionId: d.reportType === 'INSPECTION' ? d.sourceId : undefined,
          auditId: d.reportType === 'AUDIT' ? d.sourceId : undefined,
          title: d.title || source.title,
          customerSignatureRequired: d.customerSignatureRequired ?? false,
          frozenPayload: source.payload as Prisma.InputJsonValue,
          generatedById: u.id,
        },
      }),
    );
  }
  async signReportInternal(id: string, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const r = await this.requireReport(id);
    if (r.status !== 'AWAITING_INTERNAL_SIGNATURE')
      throw new BadRequestException(
        'Report is not awaiting internal signature',
      );
    const e = await this.prisma.employee.findUnique({
      where: { id: u.id },
      select: {
        firstName: true,
        lastName: true,
        signatureText: true,
        signatureFont: true,
      },
    });
    if (!e?.signatureText || !e.signatureFont)
      throw new BadRequestException(
        'Configure your internal signature in My Profile before signing',
      );
    return this.prisma.qmsQualityReport.update({
      where: { id },
      data: {
        status: r.customerSignatureRequired
          ? 'AWAITING_CUSTOMER_SIGNATURE'
          : 'EXECUTED',
        internalSignerId: u.id,
        internalSignerNameSnapshot: `${e.firstName} ${e.lastName}`.trim(),
        internalSignatureTextSnapshot: e.signatureText,
        internalSignatureFontSnapshot: e.signatureFont,
        internalSignedAt: new Date(),
      },
    });
  }
  async signReportCustomer(
    id: string,
    d: SignQmsReportCustomerDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const r = await this.requireReport(id);
    if (r.status !== 'AWAITING_CUSTOMER_SIGNATURE')
      throw new BadRequestException(
        'Report is not awaiting customer signature',
      );
    return this.prisma.qmsQualityReport.update({
      where: { id },
      data: {
        status: 'EXECUTED',
        customerSignerName: d.signerName,
        customerSignerDesignation: d.designation,
        customerOrganisation: d.organisation,
        customerSignatureText: d.signatureText,
        customerSignatureEvidence: d.evidence as Prisma.InputJsonValue,
        customerSignedAt: new Date(),
      },
    });
  }
  async reviseReport(id: string, d: ReviseQmsReportDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const old = await this.requireReport(id);
    if (old.status === 'SUPERSEDED')
      throw new BadRequestException('A superseded report cannot be revised');
    const sourceId =
      old.reportType === 'INSPECTION' ? old.inspectionId : old.auditId;
    if (!sourceId) throw new BadRequestException('Report source is missing');
    const source = await this.reportSource(old.reportType, sourceId);
    return this.prisma.$transaction(async (tx) => {
      await tx.qmsQualityReport.update({
        where: { id },
        data: {
          status: 'SUPERSEDED',
          supersededAt: new Date(),
          supersededById: u.id,
        },
      });
      return tx.qmsQualityReport.create({
        data: {
          reportNumber: old.reportNumber,
          revision: old.revision + 1,
          reportType: old.reportType,
          inspectionId: old.inspectionId,
          auditId: old.auditId,
          title: old.title,
          customerSignatureRequired:
            d.customerSignatureRequired ?? old.customerSignatureRequired,
          frozenPayload: {
            ...(source.payload as object),
            revisionReason: d.reason,
            previousRevisionId: old.id,
          } as Prisma.InputJsonValue,
          generatedById: u.id,
        },
      });
    });
  }
  async equipment(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    await this.refreshEquipmentStatus();
    return this.prisma.qmsMeasuringEquipment.findMany({
      include: { records: { orderBy: { calibrationDate: 'desc' }, take: 5 } },
      orderBy: { nextCalibrationDate: 'asc' },
    });
  }
  async createEquipment(d: CreateQmsEquipmentDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    if (
      !(await this.prisma.employee.findFirst({
        where: { id: d.custodianId, status: 'ACTIVE' },
      }))
    )
      throw new BadRequestException('Custodian must be an active employee');
    return this.prisma.qmsMeasuringEquipment.create({
      data: {
        ...d,
        equipmentCode: d.equipmentCode.toUpperCase(),
        nextCalibrationDate: new Date(d.nextCalibrationDate),
        createdById: u.id,
      },
    });
  }
  async addCalibration(
    equipmentId: string,
    d: CreateQmsCalibrationDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const e = await this.prisma.qmsMeasuringEquipment.findUnique({
      where: { id: equipmentId },
    });
    if (!e || e.status === 'RETIRED')
      throw new BadRequestException('Active measuring equipment not found');
    if (new Date(d.nextDueDate) <= new Date(d.calibrationDate))
      throw new BadRequestException(
        'Next due date must be after calibration date',
      );
    return this.prisma.$transaction(async (tx) =>
      tx.qmsCalibrationRecord.create({
        data: {
          calibrationNumber: await this.number(tx, 'QMS_CALIBRATION', 'CAL'),
          equipmentId,
          calibrationDate: new Date(d.calibrationDate),
          nextDueDate: new Date(d.nextDueDate),
          result: d.result,
          agency: d.agency,
          certificateNumber: d.certificateNumber,
          certificateEvidence: d.certificateEvidence as Prisma.InputJsonValue,
          observedResults: d.observedResults as Prisma.InputJsonValue,
          remarks: d.remarks,
          performedById: u.id,
        },
      }),
    );
  }
  async reviewCalibration(id: string, accept: boolean, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const r = await this.prisma.qmsCalibrationRecord.findUnique({
      where: { id },
      include: { equipment: true },
    });
    if (!r || r.reviewStatus !== 'PENDING_REVIEW')
      throw new BadRequestException('Calibration is not pending review');
    if (!accept)
      return this.prisma.qmsCalibrationRecord.update({
        where: { id },
        data: {
          reviewStatus: 'REJECTED',
          reviewedById: u.id,
          reviewedAt: new Date(),
        },
      });
    return this.prisma.$transaction(async (tx) => {
      let ncrId: string | undefined;
      if (r.result === 'FAIL') {
        const n = await tx.qmsNonConformance.create({
          data: {
            ncrNumber: await this.number(tx, 'QMS_NCR', 'QNCR'),
            source: 'CALIBRATION',
            sourceId: id,
            severity: 'MAJOR',
            title: `Calibration failure: ${r.equipment.equipmentCode}`,
            description: r.remarks || `${r.equipment.name} failed calibration`,
            ownerId: r.equipment.custodianId,
            targetDate: new Date(Date.now() + 7 * 86400000),
            raisedById: u.id,
          },
        });
        ncrId = n.id;
      }
      await tx.qmsMeasuringEquipment.update({
        where: { id: r.equipmentId },
        data: {
          lastCalibrationDate: r.calibrationDate,
          nextCalibrationDate: r.nextDueDate,
          status:
            r.result === 'FAIL'
              ? 'OUT_OF_SERVICE'
              : r.result === 'LIMITED_USE'
                ? 'DUE'
                : 'ACTIVE',
        },
      });
      return tx.qmsCalibrationRecord.update({
        where: { id },
        data: {
          reviewStatus: 'ACCEPTED',
          reviewedById: u.id,
          reviewedAt: new Date(),
          ncrId,
        },
      });
    });
  }
  async complaints(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.qmsCustomerComplaint.findMany({
      orderBy: { reportedAt: 'desc' },
    });
  }
  async createComplaint(d: CreateQmsComplaintDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    if (
      !(await this.prisma.customer.findUnique({ where: { id: d.customerId } }))
    )
      throw new BadRequestException('Customer not found');
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.qmsCustomerComplaint.create({
        data: {
          ...d,
          reportedAt: new Date(d.reportedAt),
          targetDate: new Date(d.targetDate),
          createdById: u.id,
          status: 'INVESTIGATION',
          complaintNumber: await this.number(tx, 'QMS_COMPLAINT', 'CC'),
        },
      });
      const n = await tx.qmsNonConformance.create({
        data: {
          ncrNumber: await this.number(tx, 'QMS_NCR', 'QNCR'),
          source: 'CUSTOMER_COMPLAINT',
          sourceId: c.id,
          severity: d.severity,
          title: `Customer complaint: ${c.complaintNumber}`,
          description: d.description,
          orderId: d.orderId,
          productId: d.productId,
          containmentAction: d.immediateAction,
          containedAt: d.immediateAction ? new Date() : undefined,
          ownerId: d.ownerId,
          targetDate: new Date(d.targetDate),
          raisedById: u.id,
          status: d.immediateAction ? 'CONTAINED' : 'OPEN',
        },
      });
      return tx.qmsCustomerComplaint.update({
        where: { id: c.id },
        data: { ncrId: n.id },
      });
    });
  }
  async investigateComplaint(
    id: string,
    d: InvestigateQmsComplaintDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const c = await this.requireComplaint(id);
    if (!['OPEN', 'INVESTIGATION'].includes(c.status))
      throw new BadRequestException('Complaint is not under investigation');
    return this.prisma.qmsCustomerComplaint.update({
      where: { id },
      data: {
        status: 'PENDING_CLOSURE',
        investigation: d.investigation,
        responseToCustomer: d.responseToCustomer,
      },
    });
  }
  async closeComplaint(
    id: string,
    d: CloseQmsComplaintDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertHead(u);
    const c = await this.requireComplaint(id);
    if (c.status !== 'PENDING_CLOSURE')
      throw new BadRequestException('Complaint is not pending closure');
    return this.prisma.qmsCustomerComplaint.update({
      where: { id },
      data: {
        status: 'CLOSED',
        closedById: u.id,
        closedAt: new Date(),
        closureNote: d.closureNote,
      },
    });
  }
  async supplierScorecards(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const suppliers = await this.prisma.supplier.findMany({
      select: {
        id: true,
        companyName: true,
        status: true,
        purchaseOrders: {
          select: {
            goodsReceiptNotes: {
              select: {
                receivedDate: true,
                lines: {
                  select: {
                    receivedQuantity: true,
                    acceptedQuantity: true,
                    rejectedQuantity: true,
                  },
                },
              },
            },
          },
        },
        audits: { select: { id: true } },
      },
    });
    const qAudits = await this.prisma.qmsAudit.findMany({
      where: { supplierId: { not: null }, status: 'CLOSED' },
      select: { supplierId: true, findings: { select: { findingType: true } } },
    });
    return suppliers.map((s) => {
      const lines = s.purchaseOrders.flatMap((p) =>
        p.goodsReceiptNotes.flatMap((g) => g.lines),
      );
      const received = lines.reduce(
          (a, x) => a + Number(x.receivedQuantity),
          0,
        ),
        accepted = lines.reduce(
          (a, x) => a + Number(x.acceptedQuantity || 0),
          0,
        ),
        rejected = lines.reduce(
          (a, x) => a + Number(x.rejectedQuantity || 0),
          0,
        );
      const audits = qAudits.filter((a) => a.supplierId === s.id),
        major = audits
          .flatMap((a) => a.findings)
          .filter((f) => f.findingType === 'MAJOR_NONCONFORMITY').length,
        minor = audits
          .flatMap((a) => a.findings)
          .filter((f) => f.findingType === 'MINOR_NONCONFORMITY').length;
      const acceptanceRate = received ? (accepted / received) * 100 : 100,
        rejectionPpm = received ? (rejected / received) * 1_000_000 : 0,
        score = Math.max(
          0,
          Math.min(100, acceptanceRate - major * 15 - minor * 5),
        );
      return {
        supplierId: s.id,
        supplierName: s.companyName,
        qualificationStatus: s.status,
        receivedQuantity: received,
        acceptedQuantity: accepted,
        rejectedQuantity: rejected,
        acceptanceRate: Number(acceptanceRate.toFixed(2)),
        rejectionPpm: Math.round(rejectionPpm),
        closedQmsAudits: audits.length,
        legacyQualificationAudits: s.audits.length,
        majorFindings: major,
        minorFindings: minor,
        qualityScore: Number(score.toFixed(1)),
        rating:
          score >= 90
            ? 'PREFERRED'
            : score >= 80
              ? 'APPROVED'
              : score >= 70
                ? 'CONDITIONAL'
                : 'IMPROVEMENT_REQUIRED',
      };
    });
  }
  async analytics(u: AuthenticatedUser, q: QmsAnalyticsQueryDto = {}) {
    await this.access.assertUser(u);
    const since = q.from ? new Date(q.from) : new Date();
    if (!q.from) {
      since.setMonth(since.getMonth() - 11);
      since.setDate(1);
    }
    since.setHours(0, 0, 0, 0);
    const until = q.to ? new Date(q.to) : new Date();
    until.setHours(23, 59, 59, 999);
    if (since > until)
      throw new BadRequestException('From date must be on or before To date');
    const range = { gte: since, lte: until };
    const [inspections, ncrs, complaints, capas, calibrations] =
      await Promise.all([
        this.prisma.qmsInspection.findMany({
          where: { createdAt: range },
          select: { createdAt: true, status: true },
        }),
        this.prisma.qmsNonConformance.findMany({
          where: { createdAt: range },
          select: {
            createdAt: true,
            severity: true,
            status: true,
            disposition: true,
            costOfPoorQuality: true,
            costOfPoorQualitySource: true,
            productId: true,
            orderId: true,
            grnId: true,
            itemId: true,
          },
        }),
        this.prisma.qmsCustomerComplaint.findMany({
          where: { reportedAt: range },
          select: { reportedAt: true, severity: true, status: true },
        }),
        this.prisma.qmsCapa.findMany({
          where: { createdAt: range },
          select: { createdAt: true, status: true },
        }),
        this.prisma.qmsCalibrationRecord.findMany({
          where: { calibrationDate: range },
          select: { calibrationDate: true, result: true },
        }),
      ]);
    const buckets = new Map<string, any>();
    const cursor = new Date(since.getFullYear(), since.getMonth(), 1);
    while (cursor <= until) {
      const key = cursor.toISOString().slice(0, 7);
      buckets.set(key, {
        month: key,
        inspections: 0,
        failures: 0,
        ncrs: 0,
        complaints: 0,
        closedCapas: 0,
        calibrations: 0,
        calibrationFailures: 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    for (const x of inspections) {
      const b = buckets.get(x.createdAt.toISOString().slice(0, 7));
      if (b) {
        b.inspections++;
        if (x.status === 'FAILED') b.failures++;
      }
    }
    for (const x of ncrs) {
      const b = buckets.get(x.createdAt.toISOString().slice(0, 7));
      if (b) b.ncrs++;
    }
    for (const x of complaints) {
      const b = buckets.get(x.reportedAt.toISOString().slice(0, 7));
      if (b) b.complaints++;
    }
    for (const x of capas) {
      const b = buckets.get(x.createdAt.toISOString().slice(0, 7));
      if (b && x.status === 'CLOSED') b.closedCapas++;
    }
    for (const x of calibrations) {
      const b = buckets.get(x.calibrationDate.toISOString().slice(0, 7));
      if (b) {
        b.calibrations++;
        if (x.result === 'FAIL') b.calibrationFailures++;
      }
    }
    return {
      range: { from: since, to: until },
      monthly: [...buckets.values()],
      totals: {
        inspections: inspections.length,
        ncrs: ncrs.length,
        openNcrs: ncrs.filter(
          (x) => !['CLOSED', 'CANCELLED'].includes(x.status),
        ).length,
        complaints: complaints.length,
        openComplaints: complaints.filter(
          (x) => !['CLOSED', 'CANCELLED'].includes(x.status),
        ).length,
        closedCapas: capas.filter((x) => x.status === 'CLOSED').length,
        calibrationFailures: calibrations.filter((x) => x.result === 'FAIL')
          .length,
      },
      copq: await this.copqSummary(ncrs),
    };
  }
  @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })
  async notifyOverdueActions() {
    const rows = await this.prisma.qmsCapaAction.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        dueDate: { lt: new Date() },
      },
      include: { capa: true },
    });
    for (const x of rows) {
      const since = new Date(Date.now() - 20 * 60 * 60 * 1000);
      const exists = await this.prisma.notification.findFirst({
        where: {
          employeeId: x.ownerId,
          type: 'QMS_ACTION_OVERDUE',
          message: { contains: x.id },
          createdAt: { gte: since },
        },
      });
      if (!exists)
        await this.notifications.notifyQmsAction({
          recipientId: x.ownerId,
          actorId: 'SYSTEM',
          overdue: true,
          message: `QMS action overdue [${x.id}] for ${x.capa.capaNumber}: ${x.description}`,
        });
    }
  }
  private async syncStoreNcrs() {
    const rows = await this.prisma.nonConformanceReport.findMany({
      include: { item: true },
    });
    for (const x of rows) {
      const existing = await this.prisma.qmsNonConformance.findUnique({
        where: { legacyStoreNcrId: x.id },
        select: { costOfPoorQualitySource: true },
      });
      const copq =
        existing?.costOfPoorQualitySource === 'MANUAL'
          ? {}
          : await this.copqForDisposition(
              x.disposition as any,
              x.itemId,
              x.rejectedQuantity,
              undefined,
            );
      // The GRN gate records an inspection per received line, so a store
      // rejection can be traced back to the checklist that caused it.
      const inspection = await this.prisma.qmsInspection.findFirst({
        where: { grnId: x.grnId, grnLineId: x.grnLineId },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      await this.prisma.qmsNonConformance.upsert({
        where: { legacyStoreNcrId: x.id },
        create: {
          ncrNumber: x.ncrNumber,
          source: 'GRN',
          sourceId: x.id,
          legacyStoreNcrId: x.id,
          inspectionId: inspection?.id,
          severity: 'MAJOR',
          status: x.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
          title: `Incoming rejection: ${x.item?.name ?? x.itemId}`,
          description:
            x.rejectionReason ||
            'Incoming material rejected during GRN inspection',
          grnId: x.grnId,
          itemId: x.itemId,
          affectedQuantity: x.rejectedQuantity,
          ownerId: x.raisedById,
          targetDate: new Date(x.createdAt.getTime() + 7 * 86400000),
          raisedById: x.raisedById,
          disposition: x.disposition as any,
          dispositionNotes: x.dispositionNotes,
          closedAt: x.status === 'CLOSED' ? x.updatedAt : undefined,
          ...copq,
        },
        update: {
          status:
            x.status === 'CLOSED'
              ? 'CLOSED'
              : x.status === 'DISPOSITIONED'
                ? 'PENDING_DISPOSITION'
                : 'OPEN',
          disposition: x.disposition as any,
          dispositionNotes: x.dispositionNotes,
          closedAt: x.status === 'CLOSED' ? x.updatedAt : null,
          ...copq,
        },
      });
    }
  }

  private async copqForDisposition(
    disposition: string | null | undefined,
    itemId: string | null | undefined,
    quantity: Prisma.Decimal | number | null | undefined,
    manual: number | undefined,
  ) {
    if (manual !== undefined)
      return {
        costOfPoorQuality: new Prisma.Decimal(manual),
        costOfPoorQualitySource: 'MANUAL' as const,
      };
    if (disposition !== 'SCRAP')
      return { costOfPoorQuality: null, costOfPoorQualitySource: null };
    if (!itemId || quantity == null)
      return { costOfPoorQuality: null, costOfPoorQualitySource: null };
    const unit = await this.itemCosts.currentFailureCost(itemId);
    if (!unit.amount)
      return { costOfPoorQuality: null, costOfPoorQualitySource: null };
    return {
      costOfPoorQuality: unit.amount.mul(new Prisma.Decimal(quantity)),
      costOfPoorQualitySource: 'SYSTEM_CALCULATED' as const,
    };
  }

  private async copqSummary(rows: Array<any>) {
    const productIds = [
        ...new Set(rows.map((x) => x.productId).filter(Boolean)),
      ] as string[],
      orderIds = [
        ...new Set(rows.map((x) => x.orderId).filter(Boolean)),
      ] as string[],
      grnIds = [
        ...new Set(rows.map((x) => x.grnId).filter(Boolean)),
      ] as string[],
      itemIds = [
        ...new Set(rows.map((x) => x.itemId).filter(Boolean)),
      ] as string[];
    const [products, orders, grns, items] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, sku: true },
      }),
      this.prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, orderNumber: true },
      }),
      this.prisma.goodsReceiptNote.findMany({
        where: { id: { in: grnIds } },
        select: {
          id: true,
          purchaseOrder: {
            select: {
              supplier: { select: { id: true, companyName: true } },
              vendor: { select: { id: true, companyName: true } },
            },
          },
        },
      }),
      this.prisma.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, itemCode: true, name: true },
      }),
    ]);
    const productMap = new Map(
        products.map((x) => [x.id, `${x.sku} · ${x.name}`]),
      ),
      orderMap = new Map(orders.map((x) => [x.id, x.orderNumber])),
      itemMap = new Map(items.map((x) => [x.id, `${x.itemCode} · ${x.name}`])),
      partyMap = new Map(
        grns.map((x) => [
          x.id,
          x.purchaseOrder.vendor
            ? {
                id: `V:${x.purchaseOrder.vendor.id}`,
                label: x.purchaseOrder.vendor.companyName,
              }
            : x.purchaseOrder.supplier
              ? {
                  id: `S:${x.purchaseOrder.supplier.id}`,
                  label: x.purchaseOrder.supplier.companyName,
                }
              : null,
        ]),
      );
    const aggregate = (
      key: (x: any) => { id: string; label: string } | null,
    ) => {
      const map = new Map<string, any>();
      for (const x of rows) {
        if (x.costOfPoorQuality == null) continue;
        const k = key(x);
        if (!k) continue;
        const v = map.get(k.id) ?? {
          key: k.id,
          label: k.label,
          systemCalculated: 0,
          manual: 0,
          total: 0,
        };
        const amount = Number(x.costOfPoorQuality);
        x.costOfPoorQualitySource === 'SYSTEM_CALCULATED'
          ? (v.systemCalculated += amount)
          : (v.manual += amount);
        v.total += amount;
        map.set(k.id, v);
      }
      return [...map.values()].sort((a, b) => b.total - a.total);
    };
    const valued = rows.filter((x) => x.costOfPoorQuality != null);
    const systemCalculated = valued
        .filter((x) => x.costOfPoorQualitySource === 'SYSTEM_CALCULATED')
        .reduce((a, x) => a + Number(x.costOfPoorQuality), 0),
      manual = valued
        .filter((x) => x.costOfPoorQualitySource !== 'SYSTEM_CALCULATED')
        .reduce((a, x) => a + Number(x.costOfPoorQuality), 0);
    return {
      total: systemCalculated + manual,
      systemCalculated,
      manual,
      unvaluedCount: rows.length - valued.length,
      byDisposition: aggregate((x) =>
        x.disposition
          ? { id: x.disposition, label: x.disposition.replaceAll('_', ' ') }
          : null,
      ),
      byProduct: aggregate((x) =>
        x.productId
          ? {
              id: x.productId,
              label: productMap.get(x.productId) ?? 'Unknown product',
            }
          : x.itemId
            ? {
                id: `ITEM:${x.itemId}`,
                label: itemMap.get(x.itemId) ?? 'Unknown item',
              }
            : null,
      ),
      byOrder: aggregate((x) =>
        x.orderId
          ? { id: x.orderId, label: orderMap.get(x.orderId) ?? 'Unknown order' }
          : null,
      ),
      byParty: aggregate((x) =>
        x.grnId ? (partyMap.get(x.grnId) ?? null) : null,
      ),
    };
  }
  private async requireNcr(id: string) {
    const x = await this.prisma.qmsNonConformance.findUnique({
      where: { id },
      include: { capa: true },
    });
    if (!x) throw new NotFoundException('QMS NCR not found');
    return x;
  }
  private async requireCapa(id: string) {
    const x = await this.prisma.qmsCapa.findUnique({ where: { id } });
    if (!x) throw new NotFoundException('CAPA not found');
    return x;
  }
  private async requireAuditProgram(id: string) {
    const x = await this.prisma.qmsAuditProgram.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!x) throw new NotFoundException('Audit programme not found');
    return x;
  }
  private async requireAudit(id: string) {
    const x = await this.prisma.qmsAudit.findUnique({ where: { id } });
    if (!x) throw new NotFoundException('Audit not found');
    return x;
  }
  private async requireReport(id: string) {
    const x = await this.prisma.qmsQualityReport.findUnique({ where: { id } });
    if (!x) throw new NotFoundException('Quality report not found');
    return x;
  }
  private async requireComplaint(id: string) {
    const x = await this.prisma.qmsCustomerComplaint.findUnique({
      where: { id },
    });
    if (!x) throw new NotFoundException('Customer complaint not found');
    return x;
  }
  private async refreshEquipmentStatus() {
    const now = new Date(),
      due = new Date(Date.now() + 30 * 86400000);
    await this.prisma.qmsMeasuringEquipment.updateMany({
      where: {
        status: { in: ['ACTIVE', 'DUE', 'OVERDUE'] },
        nextCalibrationDate: { lt: now },
      },
      data: { status: 'OVERDUE' },
    });
    await this.prisma.qmsMeasuringEquipment.updateMany({
      where: { status: 'ACTIVE', nextCalibrationDate: { gte: now, lte: due } },
      data: { status: 'DUE' },
    });
  }
  private async reportSource(type: 'INSPECTION' | 'AUDIT', id: string) {
    if (type === 'INSPECTION') {
      const x = await this.prisma.qmsInspection.findUnique({
        where: { id },
        include: {
          responses: { orderBy: { sequence: 'asc' } },
          nonConformances: true,
          plan: true,
          planStage: true,
        },
      });
      if (!x || !['PASSED', 'CONDITIONAL_PASS', 'FAILED'].includes(x.status))
        throw new BadRequestException(
          'Only reviewed inspections can generate reports',
        );
      return {
        title: `Quality Inspection Report · ${x.inspectionNumber}`,
        payload: {
          sourceType: type,
          sourceNumber: x.inspectionNumber,
          snapshotAt: new Date().toISOString(),
          inspection: x,
        },
      };
    }
    const x = await this.prisma.qmsAudit.findUnique({
      where: { id },
      include: {
        responses: { orderBy: { sequence: 'asc' } },
        findings: true,
        program: true,
      },
    });
    if (!x || x.status !== 'CLOSED')
      throw new BadRequestException('Only closed audits can generate reports');
    return {
      title: `Quality Audit Report · ${x.auditNumber}`,
      payload: {
        sourceType: type,
        sourceNumber: x.auditNumber,
        snapshotAt: new Date().toISOString(),
        audit: x,
      },
    };
  }
  private async validateAuditItems(
    items: Array<{
      templateId: string;
      auditType: any;
      plannedFrom: string;
      plannedTo: string;
      leadAuditorId: string;
    }>,
  ) {
    const auditTypes = [
      'INTERNAL_AUDIT',
      'PROCESS_AUDIT',
      'SUPPLIER_AUDIT',
      'PRODUCT_AUDIT',
      'FIVE_S',
      'CUSTOM',
    ];
    for (const x of items) {
      if (!auditTypes.includes(x.auditType))
        throw new BadRequestException('Select an audit template type');
      if (new Date(x.plannedFrom) >= new Date(x.plannedTo))
        throw new BadRequestException('Audit end must be after its start');
      const t = await this.prisma.qmsQuestionTemplate.findUnique({
        where: { id: x.templateId },
      });
      if (!t || t.status !== 'APPROVED' || t.templateType !== x.auditType)
        throw new BadRequestException(
          'Each audit requires an approved matching template',
        );
      if (
        !(await this.prisma.employee.findFirst({
          where: { id: x.leadAuditorId, status: 'ACTIVE' },
        }))
      )
        throw new BadRequestException(
          'Lead auditor must be an active employee',
        );
    }
  }
  private async createAuditFromItem(
    tx: Prisma.TransactionClient,
    item: any,
    createdById: string,
    programId?: string,
  ) {
    const t = await tx.qmsQuestionTemplate.findUnique({
      where: { id: item.templateId },
      include: { questions: { orderBy: { sequence: 'asc' } } },
    });
    if (!t) throw new BadRequestException('Audit template not found');
    const snapshot = {
      templateId: t.id,
      templateCode: t.templateCode,
      version: t.version,
      name: t.name,
      questions: t.questions,
    };
    return tx.qmsAudit.create({
      data: {
        auditNumber: await this.number(tx, 'QMS_AUDIT', 'QA'),
        programId,
        programItemId: item.id,
        title: item.title,
        auditType: item.auditType,
        scope: item.scope,
        criteria: item.criteria,
        scheduledFrom: item.plannedFrom,
        scheduledTo: item.plannedTo,
        department: item.department,
        supplierId: item.supplierId,
        leadAuditorId: item.leadAuditorId,
        auditeeId: item.auditeeId,
        openingNotes: item.openingNotes,
        templateSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        createdById,
        responses: {
          create: t.questions.map((q) => ({
            questionKey: q.id,
            section: q.section,
            sequence: q.sequence,
            promptSnapshot: q.prompt,
            responseType: q.responseType,
            required: q.required,
          })),
        },
      },
    });
  }
  private async moveTemplate(
    id: string,
    from: string,
    to: string,
    data: object,
  ) {
    const x = await this.requireTemplate(id);
    if (x.status !== from)
      throw new BadRequestException(`Template must be ${from}`);
    return this.prisma.qmsQuestionTemplate.update({
      where: { id },
      data: { ...data, status: to as any },
    });
  }
  private async requireTemplate(id: string) {
    const x = await this.prisma.qmsQuestionTemplate.findUnique({
      where: { id },
    });
    if (!x) throw new NotFoundException('Template not found');
    return x;
  }
  private async requirePlan(id: string) {
    const x = await this.prisma.qmsInspectionPlan.findUnique({ where: { id } });
    if (!x) throw new NotFoundException('Quality plan not found');
    return x;
  }
  async syncStoreNcrsForAnalytics(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    await this.syncStoreNcrs();
  }
  private async number(
    tx: Prisma.TransactionClient,
    entity: string,
    prefix: string,
  ) {
    const y = new Date().getUTCFullYear(),
      s = await tx.financeSequence.upsert({
        where: { entity_year: { entity, year: y } },
        create: { entity, year: y, lastValue: 1 },
        update: { lastValue: { increment: 1 } },
      });
    return `${prefix}-${y}-${String(s.lastValue).padStart(5, '0')}`;
  }
}
