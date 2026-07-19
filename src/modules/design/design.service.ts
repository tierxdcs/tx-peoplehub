import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DesignChangeImpactArea,
  DesignProjectStatus,
  Prisma,
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../core/database/prisma.service';
import { VaultAccessService } from '../vault/vault-access.service';
import { DesignAccessService } from './design-access.service';
import {
  AcknowledgeDesignChangeDto,
  AcknowledgeDesignTransmittalDto,
  AddDesignReviewActionDto,
  AddDesignReviewAttendeeDto,
  AddDesignChangeAcknowledgementDto,
  AddDesignChangeAffectedItemDto,
  AssignDesignChangeImpactDto,
  CheckDesignRevisionDto,
  CloseDesignChangeDto,
  CompleteDesignReviewActionDto,
  CompleteDesignChangeImpactDto,
  CreateDesignChangeDto,
  CreateDesignDocumentDto,
  CreateDesignMilestoneDto,
  CreateDesignProjectDto,
  CreateDesignRequestDto,
  CreateDesignReviewDto,
  CreateDesignRevisionDto,
  CreateDesignRequirementDto,
  CreateDesignProjectTemplateDto,
  CreateDesignTransmittalDto,
  ApplyDesignProjectTemplateDto,
  GenerateDesignChangeReportDto,
  RecordCustomerApprovalDto,
  RecordDesignReviewDto,
  RejectDesignRevisionDto,
  UpdateDesignChangeDispositionDto,
  UpdateDesignMilestoneDto,
  ReviseDesignChangeReportDto,
  SignDesignChangeReportCustomerDto,
  VerifyDesignRequirementDto,
} from './dto/design.dto';

const CHANGE_IMPACT_AREAS: DesignChangeImpactArea[] = [
  'DESIGN',
  'BOM',
  'INVENTORY',
  'WORK_IN_PROGRESS',
  'PROCUREMENT',
  'PRODUCTION',
  'QUALITY',
  'COST',
  'SCHEDULE',
  'CUSTOMER',
];
@Injectable()
export class DesignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: DesignAccessService,
    private readonly vaultAccess: VaultAccessService,
  ) {}
  async accessInfo(u: AuthenticatedUser) {
    return this.access.accessFor(u);
  }
  async dashboard(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const now = new Date();
    const [
      openRequests,
      activeProjects,
      overdueProjects,
      pendingRevisions,
      releasedDocuments,
      openChanges,
    ] = await Promise.all([
      this.prisma.designRequest.count({
        where: { status: { in: ['OPEN', 'ACCEPTED'] } },
      }),
      this.prisma.designProject.count({
        where: { status: { notIn: ['CLOSED', 'RELEASED_FOR_PRODUCTION'] } },
      }),
      this.prisma.designProject.count({
        where: {
          status: { notIn: ['CLOSED', 'RELEASED_FOR_PRODUCTION'] },
          targetDate: { lt: now },
        },
      }),
      this.prisma.designDocumentRevision.count({
        where: { status: { in: ['PENDING_CHECK', 'PENDING_APPROVAL'] } },
      }),
      this.prisma.designDocumentRevision.count({
        where: { status: 'RELEASED' },
      }),
      this.prisma.designChange.count({
        where: { status: { notIn: ['CLOSED', 'REJECTED'] } },
      }),
    ]);
    return {
      openRequests,
      activeProjects,
      overdueProjects,
      pendingRevisions,
      releasedDocuments,
      openChanges,
    };
  }
  async employees(u: AuthenticatedUser) {
    void u;
    return this.prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }
  async vaultFiles(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const files = await this.prisma.vaultFile.findMany({
      where: { status: 'ACTIVE', currentVersionId: { not: null } },
      include: {
        folder: { include: { permissions: true } },
        versions: { orderBy: { versionNumber: 'desc' } },
      },
      orderBy: { name: 'asc' },
    });
    const out = [];
    for (const f of files) {
      const a = await this.vaultAccess.computeFileAccess(u, f.id, f.folder);
      if (a.canRead && a.canWrite)
        out.push({
          id: f.id,
          name: f.name,
          folderId: f.folderId,
          currentVersionId: f.currentVersionId,
          versions: f.versions.map((v) => ({
            id: v.id,
            versionNumber: v.versionNumber,
            changeNote: v.changeNote,
            createdAt: v.createdAt,
          })),
        });
    }
    return out;
  }
  async requests(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.designRequest.findMany({
      include: { project: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  async createRequest(d: CreateDesignRequestDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.$transaction(async (tx) =>
      tx.designRequest.create({
        data: {
          ...d,
          requestNumber: await this.number(tx, 'DESIGN_REQUEST', 'DR'),
          requestedById: u.id,
          targetDate: new Date(d.targetDate),
        },
      }),
    );
  }
  async projects(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.designProject.findMany({
      include: {
        request: true,
        requirements: true,
        milestones: true,
        changes: true,
        documents: {
          include: { revisions: { orderBy: { revisionNumber: 'desc' } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
  async project(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const x = await this.prisma.designProject.findUnique({
      where: { id },
      include: {
        request: true,
        requirements: { orderBy: { requirementNumber: 'asc' } },
        milestones: { orderBy: { dueDate: 'asc' } },
        changes: {
          include: {
            impacts: true,
            affectedItems: true,
            acknowledgements: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        documents: {
          include: {
            vaultFile: true,
            revisions: {
              include: { vaultFileVersion: true, customerApproval: true },
              orderBy: { revisionNumber: 'desc' },
            },
          },
        },
      },
    });
    if (!x) throw new NotFoundException('Design project not found');
    return x;
  }
  async documents(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.designDocument.findMany({
      include: {
        project: true,
        vaultFile: true,
        revisions: {
          include: { vaultFileVersion: true, customerApproval: true },
          orderBy: { revisionNumber: 'desc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
  async createProject(d: CreateDesignProjectDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    if (
      d.requestId &&
      !(await this.prisma.designRequest.findUnique({
        where: { id: d.requestId },
      }))
    )
      throw new BadRequestException('Design request not found');
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.designProject.create({
        data: {
          ...d,
          projectNumber: await this.number(tx, 'DESIGN_PROJECT', 'DP'),
          targetDate: new Date(d.targetDate),
          createdById: u.id,
        },
      });
      if (d.requestId)
        await tx.designRequest.update({
          where: { id: d.requestId },
          data: { status: 'CONVERTED' },
        });
      return p;
    });
  }
  async updateProjectStatus(
    id: string,
    status: DesignProjectStatus,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const p = await this.prisma.designProject.findUnique({
      where: { id },
      include: {
        requirements: true,
        milestones: true,
        changes: true,
        documents: { include: { revisions: true } },
      },
    });
    if (!p) throw new NotFoundException('Design project not found');
    if (status === 'RELEASED_FOR_PRODUCTION') {
      await this.access.assertHead(u);
      if (
        !p.documents.length ||
        p.documents.some(
          (d) => !d.revisions.some((r) => r.status === 'RELEASED'),
        )
      )
        throw new BadRequestException(
          'Every design document requires a released revision before production release',
        );
      if (
        p.requirements.some(
          (r) =>
            r.required && !['VERIFIED', 'NOT_APPLICABLE'].includes(r.status),
        )
      )
        throw new BadRequestException(
          'Every required design input must be verified',
        );
      if (
        p.milestones.some((m) => !['COMPLETED', 'CANCELLED'].includes(m.status))
      )
        throw new BadRequestException(
          'Every design milestone must be completed',
        );
      if (p.changes.some((c) => !['CLOSED', 'REJECTED'].includes(c.status)))
        throw new BadRequestException(
          'All engineering changes must be closed or rejected before production release',
        );
    }
    return this.prisma.designProject.update({
      where: { id },
      data: { status },
    });
  }
  async createDocument(d: CreateDesignDocumentDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    await this.assertVaultVersion(d.vaultFileId, d.vaultFileVersionId, u);
    if (
      await this.prisma.designDocument.findFirst({
        where: { vaultFileId: d.vaultFileId },
      })
    )
      throw new BadRequestException(
        'This Vault file is already registered as a design document',
      );
    const file = await this.prisma.vaultFile.findUnique({
      where: { id: d.vaultFileId },
      include: { folder: true },
    });
    await this.prisma.vaultFolder.update({
      where: { id: file!.folderId },
      data: { versioningEnabled: true, maxVersionsRetained: null },
    });
    return this.prisma.$transaction(async (tx) =>
      tx.designDocument.create({
        data: {
          documentNumber: await this.number(tx, 'DESIGN_DOCUMENT', 'DWG'),
          projectId: d.projectId,
          title: d.title,
          documentType: d.documentType,
          vaultFileId: d.vaultFileId,
          createdById: u.id,
          revisions: {
            create: {
              revisionNumber: 1,
              revisionCode: d.revisionCode || 'A',
              changeSummary: d.changeSummary,
              vaultFileVersionId: d.vaultFileVersionId,
              preparedById: u.id,
              customerApprovalRequired: d.customerApprovalRequired ?? false,
            },
          },
        },
        include: { revisions: true },
      }),
    );
  }
  async createRevision(
    documentId: string,
    d: CreateDesignRevisionDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const doc = await this.prisma.designDocument.findUnique({
      where: { id: documentId },
      include: { revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 } },
    });
    if (!doc) throw new NotFoundException('Design document not found');
    if (
      doc.revisions[0] &&
      !['RELEASED', 'REJECTED', 'OBSOLETE'].includes(doc.revisions[0].status)
    )
      throw new BadRequestException(
        'Complete the current revision workflow before creating another revision',
      );
    await this.assertVaultVersion(doc.vaultFileId, d.vaultFileVersionId, u);
    return this.prisma.designDocumentRevision.create({
      data: {
        documentId,
        revisionNumber: (doc.revisions[0]?.revisionNumber || 0) + 1,
        revisionCode: d.revisionCode.toUpperCase(),
        changeSummary: d.changeSummary,
        vaultFileVersionId: d.vaultFileVersionId,
        preparedById: u.id,
        customerApprovalRequired: d.customerApprovalRequired ?? false,
      },
    });
  }
  async submitRevision(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const r = await this.requireRevision(id);
    if (!['DRAFT', 'REJECTED'].includes(r.status))
      throw new BadRequestException(
        'Only draft or rejected revisions can be submitted',
      );
    return this.prisma.designDocumentRevision.update({
      where: { id },
      data: {
        status: 'PENDING_CHECK',
        submittedById: u.id,
        submittedAt: new Date(),
        rejectionReason: null,
        checkedById: null,
        checkedAt: null,
        checkNote: null,
      },
    });
  }
  async checkRevision(
    id: string,
    d: CheckDesignRevisionDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const r = await this.requireRevision(id);
    if (r.status !== 'PENDING_CHECK')
      throw new BadRequestException(
        'Revision is not pending independent check',
      );
    if (r.preparedById === u.id)
      throw new BadRequestException(
        'The preparer cannot check their own revision',
      );
    const e = await this.prisma.employee.findUnique({
      where: { id: u.id },
      select: { firstName: true, lastName: true },
    });
    return this.prisma.designDocumentRevision.update({
      where: { id },
      data: {
        status: 'PENDING_APPROVAL',
        checkedById: u.id,
        checkedAt: new Date(),
        checkerNameSnapshot:
          `${e?.firstName || ''} ${e?.lastName || ''}`.trim(),
        checkNote: d.checkNote,
      },
    });
  }
  async releaseRevision(id: string, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const r = await this.prisma.designDocumentRevision.findUnique({
      where: { id },
      include: { customerApproval: true },
    });
    if (!r || r.status !== 'PENDING_APPROVAL')
      throw new BadRequestException('Revision is not pending approval');
    if (r.preparedById === u.id || r.checkedById === u.id)
      throw new BadRequestException(
        'Design Head cannot release a revision they prepared or checked',
      );
    if (r.customerApprovalRequired && r.customerApproval?.status !== 'APPROVED')
      throw new BadRequestException(
        'Customer approval evidence is required before release',
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
    return this.prisma.$transaction(async (tx) => {
      await tx.designDocumentRevision.updateMany({
        where: { documentId: r.documentId, status: 'RELEASED' },
        data: { status: 'OBSOLETE' },
      });
      return tx.designDocumentRevision.update({
        where: { id },
        data: {
          status: 'RELEASED',
          approvedById: u.id,
          approvedAt: new Date(),
          approverNameSnapshot:
            `${e?.firstName || ''} ${e?.lastName || ''}`.trim(),
          signatureTextSnapshot: e?.signatureText,
          signatureFontSnapshot: e?.signatureFont,
        },
      });
    });
  }
  async rejectRevision(
    id: string,
    d: RejectDesignRevisionDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertHead(u);
    const r = await this.requireRevision(id);
    if (r.status !== 'PENDING_APPROVAL')
      throw new BadRequestException('Revision is not pending approval');
    return this.prisma.designDocumentRevision.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approvedById: u.id,
        approvedAt: new Date(),
        rejectionReason: d.reason,
      },
    });
  }
  async createRequirement(d: CreateDesignRequirementDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const count = await this.prisma.designRequirement.count({
      where: { projectId: d.projectId },
    });
    return this.prisma.designRequirement.create({
      data: {
        ...d,
        requirementNumber: `REQ-${String(count + 1).padStart(3, '0')}`,
        createdById: u.id,
      },
    });
  }
  async verifyRequirement(
    id: string,
    d: VerifyDesignRequirementDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    if (!(await this.prisma.designRequirement.findUnique({ where: { id } })))
      throw new NotFoundException('Design requirement not found');
    return this.prisma.designRequirement.update({
      where: { id },
      data: {
        status: d.status,
        verificationResult: d.result,
        evidence: d.evidence as Prisma.InputJsonValue,
        verifiedById: u.id,
        verifiedAt: new Date(),
      },
    });
  }
  async createMilestone(d: CreateDesignMilestoneDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.designMilestone.create({
      data: { ...d, dueDate: new Date(d.dueDate), createdById: u.id },
    });
  }
  async updateMilestone(
    id: string,
    d: UpdateDesignMilestoneDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    if (!(await this.prisma.designMilestone.findUnique({ where: { id } })))
      throw new NotFoundException('Design milestone not found');
    return this.prisma.designMilestone.update({
      where: { id },
      data: {
        status: d.status,
        evidence: d.evidence as Prisma.InputJsonValue,
        completedById: d.status === 'COMPLETED' ? u.id : null,
        completedAt: d.status === 'COMPLETED' ? new Date() : null,
      },
    });
  }
  async recordCustomerApproval(
    revisionId: string,
    d: RecordCustomerApprovalDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const r = await this.requireRevision(revisionId);
    if (!r.customerApprovalRequired)
      throw new BadRequestException(
        'This revision does not require customer approval',
      );
    return this.prisma.designCustomerApproval.upsert({
      where: { revisionId },
      create: {
        revisionId,
        ...d,
        evidence: d.evidence as Prisma.InputJsonValue,
        recordedById: u.id,
        approvedAt: d.status === 'APPROVED' ? new Date() : undefined,
      },
      update: {
        ...d,
        evidence: d.evidence as Prisma.InputJsonValue,
        recordedById: u.id,
        approvedAt: d.status === 'APPROVED' ? new Date() : null,
      },
    });
  }
  async changes(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.designChange.findMany({
      include: {
        project: true,
        impacts: { orderBy: { area: 'asc' } },
        affectedItems: true,
        acknowledgements: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
  async change(id: string, u: AuthenticatedUser) {
    const x = await this.requireChange(id);
    const access = await this.access.accessFor(u);
    const assigned =
      x.coordinatorId === u.id ||
      x.impacts.some((i) => i.ownerId === u.id) ||
      x.acknowledgements.some((a) => a.ownerId === u.id);
    if (!access.isDesignUser && !assigned)
      throw new ForbiddenException(
        'You are not assigned to this engineering change',
      );
    return x;
  }
  async createChange(d: CreateDesignChangeDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    if (
      !(await this.prisma.designProject.findUnique({
        where: { id: d.projectId },
      }))
    )
      throw new NotFoundException('Design project not found');
    return this.prisma.$transaction(async (tx) =>
      tx.designChange.create({
        data: {
          ...d,
          changeNumber: await this.number(tx, 'DESIGN_CHANGE', 'ECR'),
          requestedById: u.id,
          targetDate: new Date(d.targetDate),
          impacts: {
            create: CHANGE_IMPACT_AREAS.map((area) => ({
              area,
              ownerId: d.coordinatorId,
            })),
          },
        },
        include: { impacts: true },
      }),
    );
  }
  async addAffectedItem(
    changeId: string,
    d: AddDesignChangeAffectedItemDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const change = await this.requireChange(changeId);
    if (!['DRAFT', 'IMPACT_ASSESSMENT'].includes(change.status))
      throw new BadRequestException(
        'Affected records are locked after approval submission',
      );
    if (
      ['DATE', 'SERIAL_NUMBER', 'LOT_NUMBER'].includes(d.effectivityType) &&
      !d.effectivityValue?.trim()
    )
      throw new BadRequestException(
        'An effectivity value is required for the selected type',
      );
    return this.prisma.designChangeAffectedItem.create({
      data: { changeId, ...d, createdById: u.id },
    });
  }
  async updateDisposition(
    id: string,
    d: UpdateDesignChangeDispositionDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const item = await this.prisma.designChangeAffectedItem.findUnique({
      where: { id },
      include: { change: true },
    });
    if (!item) throw new NotFoundException('Affected record not found');
    if (!['DRAFT', 'IMPACT_ASSESSMENT'].includes(item.change.status))
      throw new BadRequestException(
        'Disposition is locked after approval submission',
      );
    return this.prisma.designChangeAffectedItem.update({
      where: { id },
      data: d,
    });
  }
  async assignImpact(
    id: string,
    d: AssignDesignChangeImpactDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const impact = await this.prisma.designChangeImpact.findUnique({
      where: { id },
      include: { change: true },
    });
    if (!impact) throw new NotFoundException('Impact assessment not found');
    if (!['DRAFT', 'IMPACT_ASSESSMENT'].includes(impact.change.status))
      throw new BadRequestException(
        'Impact owners are locked after approval submission',
      );
    return this.prisma.designChangeImpact.update({
      where: { id },
      data: {
        ownerId: d.ownerId,
        status: 'PENDING',
        hasImpact: null,
        assessment: null,
        requiredAction: null,
        assessedById: null,
        assessedAt: null,
      },
    });
  }
  async submitChange(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const x = await this.requireChange(id);
    if (x.status !== 'DRAFT')
      throw new BadRequestException('Only a draft ECR can be submitted');
    if (!x.affectedItems.length)
      throw new BadRequestException(
        'Add at least one affected record before submission',
      );
    return this.prisma.designChange.update({
      where: { id },
      data: { status: 'IMPACT_ASSESSMENT', submittedAt: new Date() },
    });
  }
  async completeImpact(
    id: string,
    d: CompleteDesignChangeImpactDto,
    u: AuthenticatedUser,
  ) {
    const impact = await this.prisma.designChangeImpact.findUnique({
      where: { id },
      include: { change: true },
    });
    if (!impact) throw new NotFoundException('Impact assessment not found');
    const access = await this.access.accessFor(u);
    if (impact.ownerId !== u.id && !access.isDesignHead)
      throw new ForbiddenException(
        'Only the assigned owner may complete this impact assessment',
      );
    if (impact.change.status !== 'IMPACT_ASSESSMENT')
      throw new BadRequestException('The ECR is not in impact assessment');
    if (d.hasImpact && !d.requiredAction?.trim())
      throw new BadRequestException(
        'Required action is mandatory when an impact exists',
      );
    return this.prisma.designChangeImpact.update({
      where: { id },
      data: {
        ...d,
        status: 'COMPLETED',
        assessedById: u.id,
        assessedAt: new Date(),
      },
    });
  }
  async addAcknowledgement(
    changeId: string,
    d: AddDesignChangeAcknowledgementDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const x = await this.requireChange(changeId);
    if (!['DRAFT', 'IMPACT_ASSESSMENT'].includes(x.status))
      throw new BadRequestException(
        'Acknowledgement routing is locked after approval submission',
      );
    return this.prisma.designChangeAcknowledgement.create({
      data: {
        changeId,
        functionName: d.functionName.trim().toUpperCase(),
        ownerId: d.ownerId,
      },
    });
  }
  async submitChangeApproval(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const x = await this.requireChange(id);
    if (x.status !== 'IMPACT_ASSESSMENT')
      throw new BadRequestException('The ECR is not in impact assessment');
    if (x.impacts.some((i) => i.status !== 'COMPLETED'))
      throw new BadRequestException(
        'Every impact area must be assessed before approval',
      );
    if (x.affectedItems.some((i) => i.disposition === 'PENDING'))
      throw new BadRequestException(
        'Every affected record requires a disposition',
      );
    if (!x.acknowledgements.length)
      throw new BadRequestException(
        'Add at least one downstream acknowledgement owner',
      );
    return this.prisma.designChange.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
    });
  }
  async approveChange(id: string, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const x = await this.requireChange(id);
    if (x.status !== 'PENDING_APPROVAL')
      throw new BadRequestException('The ECR is not pending approval');
    if (x.requestedById === u.id)
      throw new BadRequestException('Design Head cannot approve their own ECR');
    const e = await this.prisma.employee.findUnique({
      where: { id: u.id },
      select: {
        firstName: true,
        lastName: true,
        signatureText: true,
        signatureFont: true,
      },
    });
    return this.prisma.designChange.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: u.id,
        approvedAt: new Date(),
        approverNameSnapshot:
          `${e?.firstName || ''} ${e?.lastName || ''}`.trim(),
        signatureTextSnapshot: e?.signatureText,
        signatureFontSnapshot: e?.signatureFont,
        rejectionReason: null,
      },
    });
  }
  async rejectChange(
    id: string,
    reason: string | undefined,
    u: AuthenticatedUser,
  ) {
    await this.access.assertHead(u);
    const x = await this.requireChange(id);
    if (x.status !== 'PENDING_APPROVAL')
      throw new BadRequestException('The ECR is not pending approval');
    if (!reason?.trim())
      throw new BadRequestException('Rejection reason is required');
    return this.prisma.designChange.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason.trim(),
        approvedById: u.id,
        approvedAt: new Date(),
      },
    });
  }
  async startChangeImplementation(id: string, u: AuthenticatedUser) {
    const x = await this.requireChange(id);
    const access = await this.access.accessFor(u);
    if (x.coordinatorId !== u.id && !access.isDesignHead)
      throw new ForbiddenException(
        'Only the coordinator or Design Head may start implementation',
      );
    if (x.status !== 'APPROVED')
      throw new BadRequestException('Only an approved ECR can be implemented');
    return this.prisma.designChange.update({
      where: { id },
      data: { status: 'IMPLEMENTING' },
    });
  }
  async acknowledgeChange(
    id: string,
    d: AcknowledgeDesignChangeDto,
    u: AuthenticatedUser,
  ) {
    const a = await this.prisma.designChangeAcknowledgement.findUnique({
      where: { id },
      include: { change: true },
    });
    if (!a) throw new NotFoundException('Acknowledgement not found');
    if (a.ownerId !== u.id)
      throw new ForbiddenException(
        'Only the assigned owner may acknowledge this change',
      );
    if (a.change.status !== 'IMPLEMENTING')
      throw new BadRequestException('The ECR is not being implemented');
    return this.prisma.designChangeAcknowledgement.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        comments: d.comments,
        acknowledgedById: u.id,
        acknowledgedAt: new Date(),
      },
    });
  }
  async closeChange(id: string, d: CloseDesignChangeDto, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const x = await this.requireChange(id);
    if (x.status !== 'IMPLEMENTING')
      throw new BadRequestException('The ECR is not being implemented');
    if (x.acknowledgements.some((a) => a.status !== 'ACKNOWLEDGED'))
      throw new BadRequestException(
        'Every downstream function must acknowledge implementation',
      );
    return this.prisma.designChange.update({
      where: { id },
      data: {
        status: 'CLOSED',
        implementationNote: d.implementationNote,
        closedById: u.id,
        closedAt: new Date(),
      },
    });
  }
  async reviews(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.designReview.findMany({
      include: { project: true, attendees: true, actions: true },
      orderBy: { scheduledAt: 'desc' },
    });
  }
  async review(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const x = await this.prisma.designReview.findUnique({
      where: { id },
      include: {
        project: true,
        attendees: true,
        actions: { orderBy: { actionNumber: 'asc' } },
      },
    });
    if (!x) throw new NotFoundException('Design review not found');
    return x;
  }
  async createReview(d: CreateDesignReviewDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    if (
      !(await this.prisma.designProject.findUnique({
        where: { id: d.projectId },
      }))
    )
      throw new NotFoundException('Design project not found');
    if (
      d.changeId &&
      !(await this.prisma.designChange.findUnique({
        where: { id: d.changeId },
      }))
    )
      throw new NotFoundException('Engineering change not found');
    return this.prisma.$transaction(async (tx) =>
      tx.designReview.create({
        data: {
          ...d,
          reviewNumber: await this.number(tx, 'DESIGN_REVIEW', 'DRR'),
          scheduledAt: new Date(d.scheduledAt),
          createdById: u.id,
        },
      }),
    );
  }
  async addReviewAttendee(
    id: string,
    d: AddDesignReviewAttendeeDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const review = await this.requireReview(id);
    if (!['SCHEDULED', 'IN_PROGRESS'].includes(review.status))
      throw new BadRequestException('Review attendance is locked');
    return this.prisma.designReviewAttendee.create({
      data: { reviewId: id, ...d, external: d.external ?? false },
    });
  }
  async startReview(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const review = await this.requireReview(id);
    if (review.status !== 'SCHEDULED')
      throw new BadRequestException('Only a scheduled review can be started');
    return this.prisma.designReview.update({
      where: { id },
      data: { status: 'IN_PROGRESS' },
    });
  }
  async recordReview(
    id: string,
    d: RecordDesignReviewDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const review = await this.requireReview(id);
    if (review.status !== 'IN_PROGRESS')
      throw new BadRequestException('The review is not in progress');
    return this.prisma.$transaction(async (tx) => {
      if (d.attendedIds)
        await tx.designReviewAttendee.updateMany({
          where: { reviewId: id },
          data: { attended: false },
        });
      if (d.attendedIds?.length)
        await tx.designReviewAttendee.updateMany({
          where: { reviewId: id, id: { in: d.attendedIds } },
          data: { attended: true },
        });
      return tx.designReview.update({
        where: { id },
        data: {
          minutes: d.minutes,
          decision: d.decision,
          status: 'PENDING_CLOSURE',
        },
      });
    });
  }
  async addReviewAction(
    id: string,
    d: AddDesignReviewActionDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const review = await this.requireReview(id);
    if (
      !['SCHEDULED', 'IN_PROGRESS', 'PENDING_CLOSURE'].includes(review.status)
    )
      throw new BadRequestException('Closed review cannot receive actions');
    return this.prisma.designReviewAction.create({
      data: {
        reviewId: id,
        actionNumber: review.actions.length + 1,
        description: d.description,
        ownerId: d.ownerId,
        dueDate: new Date(d.dueDate),
      },
    });
  }
  async completeReviewAction(
    id: string,
    d: CompleteDesignReviewActionDto,
    u: AuthenticatedUser,
  ) {
    const action = await this.prisma.designReviewAction.findUnique({
      where: { id },
    });
    if (!action) throw new NotFoundException('Design review action not found');
    const access = await this.access.accessFor(u);
    if (action.ownerId !== u.id && !access.isDesignUser)
      throw new ForbiddenException(
        'Only the action owner or Design team may complete this action',
      );
    if (!['OPEN', 'IN_PROGRESS'].includes(action.status))
      throw new BadRequestException('Action is not open');
    return this.prisma.designReviewAction.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completionNote: d.completionNote,
        completedById: u.id,
        completedAt: new Date(),
      },
    });
  }
  async verifyReviewAction(id: string, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const action = await this.prisma.designReviewAction.findUnique({
      where: { id },
    });
    if (!action || action.status !== 'COMPLETED')
      throw new BadRequestException('Only a completed action can be verified');
    return this.prisma.designReviewAction.update({
      where: { id },
      data: { status: 'VERIFIED', verifiedById: u.id, verifiedAt: new Date() },
    });
  }
  async closeReview(id: string, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const review = await this.requireReview(id);
    if (
      review.status !== 'PENDING_CLOSURE' ||
      !review.minutes ||
      !review.decision
    )
      throw new BadRequestException(
        'Review minutes and decision must be submitted first',
      );
    if (
      review.actions.some((a) => !['VERIFIED', 'CANCELLED'].includes(a.status))
    )
      throw new BadRequestException(
        'Every review action must be verified or cancelled',
      );
    return this.prisma.designReview.update({
      where: { id },
      data: { status: 'CLOSED', closedById: u.id, closedAt: new Date() },
    });
  }
  async templates(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.designProjectTemplate.findMany({
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
  }
  async createTemplate(
    d: CreateDesignProjectTemplateDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    this.validateTemplate(d.requirements, d.milestones);
    return this.prisma.$transaction(async (tx) =>
      tx.designProjectTemplate.create({
        data: {
          templateCode: await this.number(tx, 'DESIGN_TEMPLATE', 'DPT'),
          name: d.name,
          description: d.description,
          requirements: d.requirements as Prisma.InputJsonValue,
          milestones: d.milestones as Prisma.InputJsonValue,
          createdById: u.id,
        },
      }),
    );
  }
  async approveTemplate(id: string, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const t = await this.prisma.designProjectTemplate.findUnique({
      where: { id },
    });
    if (!t || t.status !== 'DRAFT')
      throw new BadRequestException('Template is not a draft');
    if (t.createdById === u.id)
      throw new BadRequestException(
        'Design Head cannot approve a template they created',
      );
    return this.prisma.designProjectTemplate.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: u.id, approvedAt: new Date() },
    });
  }
  async applyTemplate(
    id: string,
    d: ApplyDesignProjectTemplateDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const t = await this.prisma.designProjectTemplate.findUnique({
      where: { id },
    });
    if (!t || t.status !== 'APPROVED')
      throw new BadRequestException('Select an approved template');
    const project = await this.prisma.designProject.findUnique({
      where: { id: d.projectId },
    });
    if (!project) throw new NotFoundException('Design project not found');
    const requirements = t.requirements as unknown as Array<
      Record<string, unknown>
    >;
    const milestones = t.milestones as unknown as Array<
      Record<string, unknown>
    >;
    const existing = await this.prisma.designRequirement.count({
      where: { projectId: d.projectId },
    });
    const start = new Date(d.startDate);
    return this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < requirements.length; i++) {
        const r = requirements[i];
        await tx.designRequirement.create({
          data: {
            projectId: d.projectId,
            requirementNumber: `REQ-${String(existing + i + 1).padStart(3, '0')}`,
            category: r.category as any,
            description: String(r.description),
            source: r.source ? String(r.source) : `Template ${t.templateCode}`,
            acceptanceCriteria: String(r.acceptanceCriteria),
            verificationMethod: r.verificationMethod as any,
            required: r.required !== false,
            createdById: u.id,
          },
        });
      }
      for (const m of milestones) {
        const due = new Date(start);
        due.setUTCDate(due.getUTCDate() + Number(m.dueOffsetDays || 0));
        await tx.designMilestone.create({
          data: {
            projectId: d.projectId,
            title: String(m.title),
            description: m.description ? String(m.description) : undefined,
            ownerId: d.defaultOwnerId,
            dueDate: due,
            createdById: u.id,
          },
        });
      }
      return {
        requirementsCreated: requirements.length,
        milestonesCreated: milestones.length,
      };
    });
  }
  async transmittals(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.designTransmittal.findMany({
      include: { project: true, items: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  async createTransmittal(d: CreateDesignTransmittalDto, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    if (!d.revisionIds.length)
      throw new BadRequestException('Select at least one released revision');
    const revisions = await this.prisma.designDocumentRevision.findMany({
      where: {
        id: { in: d.revisionIds },
        status: 'RELEASED',
        document: { projectId: d.projectId },
      },
      include: { document: true },
    });
    if (revisions.length !== new Set(d.revisionIds).size)
      throw new BadRequestException(
        'Every transmittal item must be a released revision from the selected project',
      );
    return this.prisma.$transaction(async (tx) =>
      tx.designTransmittal.create({
        data: {
          projectId: d.projectId,
          purpose: d.purpose,
          recipientOrganisation: d.recipientOrganisation,
          recipientName: d.recipientName,
          recipientEmail: d.recipientEmail,
          message: d.message,
          transmittalNumber: await this.number(tx, 'DESIGN_TRANSMITTAL', 'DT'),
          createdById: u.id,
          items: {
            create: revisions.map((r) => ({
              revisionId: r.id,
              documentNumberSnapshot: r.document.documentNumber,
              titleSnapshot: r.document.title,
              revisionCodeSnapshot: r.revisionCode,
            })),
          },
        },
        include: { items: true },
      }),
    );
  }
  async issueTransmittal(id: string, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const x = await this.prisma.designTransmittal.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!x || x.status !== 'DRAFT' || !x.items.length)
      throw new BadRequestException(
        'Only a complete draft transmittal can be issued',
      );
    const e = await this.signer(u.id);
    return this.prisma.designTransmittal.update({
      where: { id },
      data: {
        status: 'ISSUED',
        issuedById: u.id,
        issuedAt: new Date(),
        issuerNameSnapshot: e.name,
        signatureTextSnapshot: e.signatureText,
        signatureFontSnapshot: e.signatureFont,
      },
    });
  }
  async acknowledgeTransmittal(
    id: string,
    d: AcknowledgeDesignTransmittalDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const x = await this.prisma.designTransmittal.findUnique({ where: { id } });
    if (!x || x.status !== 'ISSUED')
      throw new BadRequestException(
        'Transmittal is not awaiting acknowledgement',
      );
    return this.prisma.designTransmittal.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedByName: d.acknowledgedByName,
        acknowledgementNote: d.acknowledgementNote,
        acknowledgedAt: new Date(),
      },
    });
  }
  async changeReports(u: AuthenticatedUser) {
    await this.access.assertUser(u);
    return this.prisma.designChangeReport.findMany({
      include: { change: true },
      orderBy: { generatedAt: 'desc' },
    });
  }
  async changeReport(id: string, u: AuthenticatedUser) {
    await this.access.assertUser(u);
    const x = await this.prisma.designChangeReport.findUnique({
      where: { id },
      include: { change: true },
    });
    if (!x) throw new NotFoundException('Engineering change report not found');
    return x;
  }
  async generateChangeReport(
    d: GenerateDesignChangeReportDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    if (
      await this.prisma.designChangeReport.findFirst({
        where: { changeId: d.changeId, status: { not: 'SUPERSEDED' } },
      })
    )
      throw new BadRequestException(
        'An active report already exists; create a revision instead',
      );
    const change = await this.requireChange(d.changeId);
    if (!['APPROVED', 'IMPLEMENTING', 'CLOSED'].includes(change.status))
      throw new BadRequestException(
        'Only an approved engineering change can be reported',
      );
    return this.prisma.$transaction(async (tx) =>
      tx.designChangeReport.create({
        data: {
          reportNumber: await this.number(tx, 'DESIGN_CHANGE_REPORT', 'ECO'),
          changeId: d.changeId,
          title: d.title || `${change.changeNumber} · ${change.title}`,
          customerSignatureRequired: d.customerSignatureRequired ?? false,
          frozenPayload: this.changeReportPayload(
            change,
          ) as Prisma.InputJsonValue,
          generatedById: u.id,
        },
      }),
    );
  }
  async signChangeReportInternal(id: string, u: AuthenticatedUser) {
    await this.access.assertHead(u);
    const r = await this.requireChangeReport(id);
    if (r.status !== 'AWAITING_INTERNAL_SIGNATURE')
      throw new BadRequestException(
        'Report is not awaiting internal signature',
      );
    const e = await this.signer(u.id);
    if (!e.signatureText || !e.signatureFont)
      throw new BadRequestException(
        'Configure your internal signature in My Profile before signing',
      );
    return this.prisma.designChangeReport.update({
      where: { id },
      data: {
        status: r.customerSignatureRequired
          ? 'AWAITING_CUSTOMER_SIGNATURE'
          : 'EXECUTED',
        internalSignerId: u.id,
        internalSignerNameSnapshot: e.name,
        internalSignatureTextSnapshot: e.signatureText,
        internalSignatureFontSnapshot: e.signatureFont,
        internalSignedAt: new Date(),
      },
    });
  }
  async signChangeReportCustomer(
    id: string,
    d: SignDesignChangeReportCustomerDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const r = await this.requireChangeReport(id);
    if (r.status !== 'AWAITING_CUSTOMER_SIGNATURE')
      throw new BadRequestException(
        'Report is not awaiting customer signature',
      );
    return this.prisma.designChangeReport.update({
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
  async reviseChangeReport(
    id: string,
    d: ReviseDesignChangeReportDto,
    u: AuthenticatedUser,
  ) {
    await this.access.assertUser(u);
    const old = await this.requireChangeReport(id);
    if (old.status === 'SUPERSEDED')
      throw new BadRequestException('Report is already superseded');
    const change = await this.requireChange(old.changeId);
    return this.prisma.$transaction(async (tx) => {
      await tx.designChangeReport.update({
        where: { id },
        data: {
          status: 'SUPERSEDED',
          supersededAt: new Date(),
          supersededById: u.id,
        },
      });
      return tx.designChangeReport.create({
        data: {
          reportNumber: old.reportNumber,
          revision: old.revision + 1,
          changeId: old.changeId,
          title: old.title,
          customerSignatureRequired:
            d.customerSignatureRequired ?? old.customerSignatureRequired,
          frozenPayload: {
            ...(this.changeReportPayload(change) as object),
            revisionReason: d.reason,
            previousRevisionId: old.id,
          } as Prisma.InputJsonValue,
          generatedById: u.id,
        },
      });
    });
  }
  private async requireReview(id: string) {
    const x = await this.prisma.designReview.findUnique({
      where: { id },
      include: { attendees: true, actions: true },
    });
    if (!x) throw new NotFoundException('Design review not found');
    return x;
  }
  private async requireChangeReport(id: string) {
    const x = await this.prisma.designChangeReport.findUnique({
      where: { id },
    });
    if (!x) throw new NotFoundException('Engineering change report not found');
    return x;
  }
  private async signer(id: string) {
    const e = await this.prisma.employee.findUnique({
      where: { id },
      select: {
        firstName: true,
        lastName: true,
        signatureText: true,
        signatureFont: true,
      },
    });
    return {
      name: `${e?.firstName || ''} ${e?.lastName || ''}`.trim(),
      signatureText: e?.signatureText,
      signatureFont: e?.signatureFont,
    };
  }
  private validateTemplate(requirements: object[], milestones: object[]) {
    if (!requirements.length || !milestones.length)
      throw new BadRequestException(
        'A template requires at least one requirement and milestone',
      );
    for (const r of requirements as Array<Record<string, unknown>>)
      if (
        !r.category ||
        !r.description ||
        !r.acceptanceCriteria ||
        !r.verificationMethod
      )
        throw new BadRequestException(
          'Every template requirement needs category, description, acceptance criteria and verification method',
        );
    for (const m of milestones as Array<Record<string, unknown>>)
      if (
        !m.title ||
        !Number.isFinite(Number(m.dueOffsetDays)) ||
        Number(m.dueOffsetDays) < 0
      )
        throw new BadRequestException(
          'Every template milestone needs a title and non-negative due offset',
        );
  }
  private changeReportPayload(
    change: Awaited<ReturnType<DesignService['requireChange']>>,
  ) {
    return { snapshotAt: new Date().toISOString(), change };
  }
  private async requireChange(id: string) {
    const x = await this.prisma.designChange.findUnique({
      where: { id },
      include: {
        impacts: true,
        affectedItems: true,
        acknowledgements: true,
        project: true,
      },
    });
    if (!x) throw new NotFoundException('Engineering change not found');
    return x;
  }
  private async requireRevision(id: string) {
    const x = await this.prisma.designDocumentRevision.findUnique({
      where: { id },
    });
    if (!x) throw new NotFoundException('Design revision not found');
    return x;
  }
  private async assertVaultVersion(
    fileId: string,
    versionId: string,
    u: AuthenticatedUser,
  ) {
    const v = await this.prisma.vaultFileVersion.findUnique({
      where: { id: versionId },
      include: {
        file: { include: { folder: { include: { permissions: true } } } },
      },
    });
    if (!v || v.fileId !== fileId || v.file.status !== 'ACTIVE')
      throw new BadRequestException(
        'Select a valid confirmed Vault file version',
      );
    const a = await this.vaultAccess.computeFileAccess(
      u,
      fileId,
      v.file.folder,
    );
    if (!a.canWrite)
      throw new BadRequestException(
        'Write access to the Vault file is required',
      );
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
