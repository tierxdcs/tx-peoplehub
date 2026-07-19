import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RfqQuoteStatus, RfqStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SalesNumberingService } from '../sales/common/sales-numbering.service';
import { PurchaseOrderService } from '../scm-purchasing/purchase-order.service';
import { StockReportService } from '../bom/stock-report.service';
import {
  generateInviteToken,
  hashInvitePassword,
} from '../../common/utils/token-invite';
import { RfqAccessService } from './rfq-access.service';
import {
  AddInviteeDto,
  AwardRfqDto,
  ComparisonWeightsDto,
  CreateRfqDto,
  RfqLineInputDto,
  UpdateRfqDto,
} from './dto/rfq.dto';
import { RfqEntity, RfqInviteeEntity, RfqLineEntity } from './entities/rfq.entity';
import {
  ComparisonColumnEntity,
  ComparisonQuoteLineEntity,
  RfqComparisonEntity,
} from './entities/rfq-comparison.entity';

const MIN_INVITEES = 3;

/** Supplier/Vendor statuses that count as qualified (no inline warning). */
const QUALIFIED = new Set(['APPROVED', 'APPROVED_PREFERRED']);
/** Qualification tier score (0-1) for the weighted comparison. */
const QUAL_TIER: Record<string, number> = {
  APPROVED_PREFERRED: 1,
  APPROVED: 0.85,
  CONDITIONALLY_APPROVED: 0.5,
  UNDER_AUDIT: 0.3,
  QUESTIONNAIRE_SUBMITTED: 0.2,
  PENDING_QUESTIONNAIRE: 0.1,
  NOT_APPROVED: 0,
};

const RFQ_INCLUDE = {
  projectKickoff: { select: { projectName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  awardDecisionBy: { select: { firstName: true, lastName: true } },
  lines: {
    orderBy: { sequence: 'asc' as const },
    include: { item: { select: { itemCode: true, name: true } } },
  },
  invitees: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      supplier: { select: { companyName: true } },
      vendor: { select: { companyName: true } },
    },
  },
} satisfies Prisma.RfqInclude;

type RfqWithRelations = Prisma.RfqGetPayload<{ include: typeof RFQ_INCLUDE }>;

/**
 * RFQ Builder. Sealed-bid: quote values are only ever returned once the RFQ is
 * past the sealed phase (CLOSED / AWARDED, or deadline passed). The list/detail
 * endpoints deliberately carry NO quote figures; those live in the comparison
 * endpoint which hard-guards visibility.
 */
@Injectable()
export class RfqService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: RfqAccessService,
    private readonly numbering: SalesNumberingService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly stockReport: StockReportService,
  ) {}

  // ── Shortfall-to-RFQ (from the Kickoff stock report) ─────────────────
  /**
   * Generate a DRAFT RFQ pre-filled with the SHORTAGE rows from a kickoff's
   * stock-availability report (item + shortfall quantity), linked to the
   * kickoff. SCM then adds invitees and issues it.
   */
  async createFromKickoffShortfall(
    kickoffId: string,
    user: AuthenticatedUser,
  ): Promise<RfqEntity> {
    await this.access.assertCanManageRfqs(user);
    // Ungated compute: the RFQ manage-access check above already authorised this.
    const report = await this.stockReport.computeReport(kickoffId);
    if (!report) {
      throw new BadRequestException(
        'No stock-availability report exists for this kickoff — generate it first',
      );
    }
    const shortfalls = report.rows.filter(
      (r) => r.availabilityStatus === 'SHORTAGE' && r.itemId,
    );
    if (shortfalls.length === 0) {
      throw new BadRequestException('This kickoff has no material shortfalls to source');
    }
    const kickoff = await this.prisma.projectKickoff.findUnique({
      where: { id: kickoffId },
      select: { projectName: true },
    });
    const created = await this.prisma.$transaction(async (tx) => {
      const rfqNumber = await this.numbering.nextNumber(
        'RFQ',
        'rfq',
        new Date().getUTCFullYear(),
        tx,
      );
      return tx.rfq.create({
        data: {
          rfqNumber,
          title: `Shortfall procurement — ${kickoff?.projectName ?? 'kickoff'}`,
          description: `Auto-generated from the stock-availability shortfalls of kickoff ${kickoff?.projectName ?? kickoffId}.`,
          status: RfqStatus.DRAFT,
          projectKickoffId: kickoffId,
          // Default: 14-day quote window; SCM adjusts before issuing.
          submissionDeadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          createdById: user.id,
          lines: {
            create: shortfalls.map((r, i) => ({
              itemId: r.itemId!,
              quantity: new Prisma.Decimal(r.shortageQuantity),
              unitOfMeasure: r.unitOfMeasure,
              specificationNotes: `Shortfall for ${r.itemCode} — ${r.itemName}`,
              sequence: i,
            })),
          },
        },
      });
    });
    return this.get(created.id, user);
  }

  // ── Reads ────────────────────────────────────────────────────────────
  async list(
    user: AuthenticatedUser,
    opts: { status?: RfqStatus } = {},
  ): Promise<RfqEntity[]> {
    await this.access.assertCanReadRfqs(user);
    const where: Prisma.RfqWhereInput = {};
    if (opts.status) where.status = opts.status;
    const rows = await this.prisma.rfq.findMany({
      where,
      include: RFQ_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toEntity(r, user));
  }

  async get(id: string, user: AuthenticatedUser): Promise<RfqEntity> {
    await this.access.assertCanReadRfqs(user);
    return this.toEntity(await this.findOrThrow(id), user);
  }

  // ── Create / edit ────────────────────────────────────────────────────
  async create(dto: CreateRfqDto, user: AuthenticatedUser): Promise<RfqEntity> {
    await this.access.assertCanManageRfqs(user);
    const lines = await this.buildLineData(dto.lines);
    if (dto.projectKickoffId) {
      const k = await this.prisma.projectKickoff.findUnique({
        where: { id: dto.projectKickoffId },
        select: { id: true },
      });
      if (!k) throw new NotFoundException('Project kickoff not found');
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const rfqNumber = await this.numbering.nextNumber(
        'RFQ',
        'rfq',
        new Date().getUTCFullYear(),
        tx,
      );
      return tx.rfq.create({
        data: {
          rfqNumber,
          title: dto.title,
          description: dto.description ?? null,
          status: RfqStatus.DRAFT,
          projectKickoffId: dto.projectKickoffId ?? null,
          submissionDeadline: new Date(dto.submissionDeadline),
          requiredByDate: dto.requiredByDate ? new Date(dto.requiredByDate) : null,
          deliveryLocation: dto.deliveryLocation ?? null,
          paymentTermsRequested: dto.paymentTermsRequested ?? null,
          createdById: user.id,
          lines: { create: lines },
        },
      });
    });
    return this.get(created.id, user);
  }

  async update(
    id: string,
    dto: UpdateRfqDto,
    user: AuthenticatedUser,
  ): Promise<RfqEntity> {
    await this.access.assertCanManageRfqs(user);
    const rfq = await this.prisma.rfq.findUnique({ where: { id } });
    if (!rfq) throw new NotFoundException('RFQ not found');
    if (rfq.status !== RfqStatus.DRAFT) {
      throw new BadRequestException('Only a DRAFT RFQ can be edited');
    }
    const lineData = dto.lines ? await this.buildLineData(dto.lines) : undefined;
    await this.prisma.rfq.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.submissionDeadline !== undefined
          ? { submissionDeadline: new Date(dto.submissionDeadline) }
          : {}),
        ...(dto.requiredByDate !== undefined
          ? { requiredByDate: dto.requiredByDate ? new Date(dto.requiredByDate) : null }
          : {}),
        ...(dto.deliveryLocation !== undefined
          ? { deliveryLocation: dto.deliveryLocation }
          : {}),
        ...(dto.paymentTermsRequested !== undefined
          ? { paymentTermsRequested: dto.paymentTermsRequested }
          : {}),
        ...(lineData ? { lines: { deleteMany: {}, create: lineData } } : {}),
      },
    });
    return this.get(id, user);
  }

  async cancel(id: string, user: AuthenticatedUser): Promise<RfqEntity> {
    await this.access.assertCanManageRfqs(user);
    const rfq = await this.prisma.rfq.findUnique({ where: { id } });
    if (!rfq) throw new NotFoundException('RFQ not found');
    if (rfq.status === RfqStatus.AWARDED) {
      throw new BadRequestException('An awarded RFQ cannot be cancelled');
    }
    await this.prisma.rfq.update({
      where: { id },
      data: { status: RfqStatus.CANCELLED },
    });
    return this.get(id, user);
  }

  // ── Invitees ─────────────────────────────────────────────────────────
  async addInvitee(
    id: string,
    dto: AddInviteeDto,
    user: AuthenticatedUser,
  ): Promise<{ rfq: RfqEntity; qualificationWarning: string | null }> {
    await this.access.assertCanManageRfqs(user);
    const rfq = await this.prisma.rfq.findUnique({ where: { id } });
    if (!rfq) throw new NotFoundException('RFQ not found');
    if (rfq.status !== RfqStatus.DRAFT) {
      throw new BadRequestException('Invitees can only be added to a DRAFT RFQ');
    }
    const hasSupplier = !!dto.supplierId;
    const hasVendor = !!dto.vendorId;
    if (hasSupplier === hasVendor) {
      throw new BadRequestException(
        'An invitee must reference exactly one of a supplier or a vendor',
      );
    }

    // Snapshot the qualification status AT INVITE TIME.
    let status: string;
    let warning: string | null = null;
    if (dto.supplierId) {
      const s = await this.prisma.supplier.findUnique({
        where: { id: dto.supplierId },
        select: { companyName: true, status: true },
      });
      if (!s) throw new NotFoundException('Supplier not found');
      status = s.status;
      if (!QUALIFIED.has(s.status)) {
        warning = `Supplier "${s.companyName}" is not qualified (status ${s.status}). Inviting is allowed, but review before award.`;
      }
      // Guard against duplicate invite of the same partner on this RFQ.
      const dup = await this.prisma.rfqInvitee.findFirst({
        where: { rfqId: id, supplierId: dto.supplierId },
      });
      if (dup) throw new BadRequestException('That supplier is already invited');
    } else {
      const v = await this.prisma.vendor.findUnique({
        where: { id: dto.vendorId },
        select: { companyName: true, status: true },
      });
      if (!v) throw new NotFoundException('Vendor not found');
      status = v.status;
      if (!QUALIFIED.has(v.status)) {
        warning = `Vendor "${v.companyName}" is not qualified (status ${v.status}). Inviting is allowed, but review before award.`;
      }
      const dup = await this.prisma.rfqInvitee.findFirst({
        where: { rfqId: id, vendorId: dto.vendorId },
      });
      if (dup) throw new BadRequestException('That vendor is already invited');
    }

    // Token + expiry are finalised at ISSUE time (aligned to the deadline); until
    // then we store a placeholder token/expiry. Store the optional password now.
    await this.prisma.rfqInvitee.create({
      data: {
        rfqId: id,
        supplierId: dto.supplierId ?? null,
        vendorId: dto.vendorId ?? null,
        inviteToken: `pending:${generateInviteToken()}`,
        tokenExpiresAt: rfq.submissionDeadline,
        passwordHash: await hashInvitePassword(dto.password),
        qualificationStatusSnapshot: status,
        quoteStatus: RfqQuoteStatus.INVITED,
      },
    });
    return { rfq: await this.get(id, user), qualificationWarning: warning };
  }

  async removeInvitee(
    id: string,
    inviteeId: string,
    user: AuthenticatedUser,
  ): Promise<RfqEntity> {
    await this.access.assertCanManageRfqs(user);
    const rfq = await this.prisma.rfq.findUnique({ where: { id } });
    if (!rfq) throw new NotFoundException('RFQ not found');
    if (rfq.status !== RfqStatus.DRAFT) {
      throw new BadRequestException('Invitees can only be removed from a DRAFT RFQ');
    }
    const inv = await this.prisma.rfqInvitee.findFirst({
      where: { id: inviteeId, rfqId: id },
    });
    if (!inv) throw new NotFoundException('Invitee not found on this RFQ');
    await this.prisma.rfqInvitee.delete({ where: { id: inviteeId } });
    return this.get(id, user);
  }

  // ── Issue (≥3 invitees, generate tokens) ─────────────────────────────
  async issue(id: string, user: AuthenticatedUser): Promise<RfqEntity> {
    await this.access.assertCanManageRfqs(user);
    const rfq = await this.prisma.rfq.findUnique({
      where: { id },
      include: { invitees: true, lines: true },
    });
    if (!rfq) throw new NotFoundException('RFQ not found');
    if (rfq.status !== RfqStatus.DRAFT) {
      throw new BadRequestException('Only a DRAFT RFQ can be issued');
    }
    if (rfq.lines.length === 0) {
      throw new BadRequestException('An RFQ must have at least one line to issue');
    }
    if (rfq.invitees.length < MIN_INVITEES) {
      throw new BadRequestException(
        `An RFQ requires at least ${MIN_INVITEES} invitees before it can be issued (currently ${rfq.invitees.length})`,
      );
    }
    if (new Date(rfq.submissionDeadline) <= new Date()) {
      throw new BadRequestException('The submission deadline must be in the future');
    }

    await this.prisma.$transaction(async (tx) => {
      // Generate the real tokens now; expiry aligns with the deadline.
      for (const inv of rfq.invitees) {
        await tx.rfqInvitee.update({
          where: { id: inv.id },
          data: {
            inviteToken: generateInviteToken(),
            tokenExpiresAt: rfq.submissionDeadline,
          },
        });
      }
      await tx.rfq.update({ where: { id }, data: { status: RfqStatus.ISSUED } });
    });
    return this.get(id, user);
  }

  // ── Close ────────────────────────────────────────────────────────────
  /** Manual early close by SCM. Quotes become visible after this. */
  async close(id: string, user: AuthenticatedUser): Promise<RfqEntity> {
    await this.access.assertCanManageRfqs(user);
    const rfq = await this.prisma.rfq.findUnique({ where: { id } });
    if (!rfq) throw new NotFoundException('RFQ not found');
    if (rfq.status !== RfqStatus.ISSUED) {
      throw new BadRequestException('Only an ISSUED RFQ can be closed');
    }
    await this.prisma.rfq.update({
      where: { id },
      data: { status: RfqStatus.CLOSED },
    });
    return this.get(id, user);
  }

  // ── Comparison (sealed-bid guarded) ──────────────────────────────────
  async comparison(
    id: string,
    weightsDto: ComparisonWeightsDto,
    user: AuthenticatedUser,
  ): Promise<RfqComparisonEntity> {
    await this.access.assertCanReadRfqs(user);
    const rfq = await this.findOrThrow(id);
    // SEALED-BID: hard server-side guard. Quotes are only readable once the RFQ
    // is no longer sealed (closed/awarded, or the deadline has passed).
    if (!this.quotesVisible(rfq)) {
      throw new BadRequestException(
        'Quotes are sealed until the RFQ closes (submission deadline not yet passed)',
      );
    }

    // Load quotes for all invitees.
    const invitees = await this.prisma.rfqInvitee.findMany({
      where: { rfqId: id },
      include: {
        supplier: { select: { companyName: true } },
        vendor: { select: { companyName: true } },
        quote: { include: { lines: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const weights = this.normaliseWeights(weightsDto);

    // Lowest unit price per line + lowest total among SUBMITTED responders.
    const submitted = invitees.filter(
      (i) => i.quoteStatus === RfqQuoteStatus.SUBMITTED && i.quote,
    );
    const lowestByLine = new Map<string, Prisma.Decimal>();
    for (const inv of submitted) {
      for (const ql of inv.quote!.lines) {
        const cur = lowestByLine.get(ql.rfqLineId);
        if (!cur || ql.unitPrice.lessThan(cur)) {
          lowestByLine.set(ql.rfqLineId, ql.unitPrice);
        }
      }
    }
    const totals = submitted.map((i) => i.quote!.totalQuotedValue);
    const lowestTotal = totals.length
      ? totals.reduce((m, t) => (t.lessThan(m) ? t : m))
      : null;
    // For lead-time scoring, the best (lowest) lead time among responders.
    const leadTimes = submitted
      .map((i) => i.quote!.quotedLeadTimeDays)
      .filter((d): d is number => typeof d === 'number');
    const bestLead = leadTimes.length ? Math.min(...leadTimes) : null;
    const worstLead = leadTimes.length ? Math.max(...leadTimes) : null;

    const columns: ComparisonColumnEntity[] = invitees.map((inv) => {
      const q = inv.quote;
      const isResponder = inv.quoteStatus === RfqQuoteStatus.SUBMITTED && !!q;
      const total = isResponder ? q!.totalQuotedValue : null;
      const variance =
        total && lowestTotal ? total.minus(lowestTotal) : null;
      const variancePct =
        variance && lowestTotal && lowestTotal.greaterThan(0)
          ? variance.dividedBy(lowestTotal).times(100)
          : null;

      const lineMap = new Map(
        (q?.lines ?? []).map((l) => [l.rfqLineId, l]),
      );
      const lines: ComparisonQuoteLineEntity[] = rfq.lines.map((rl) => {
        const ql = lineMap.get(rl.id);
        const lowest = lowestByLine.get(rl.id);
        return new ComparisonQuoteLineEntity({
          rfqLineId: rl.id,
          unitPrice: ql ? ql.unitPrice.toString() : null,
          lineTotal: ql ? ql.lineTotal.toString() : null,
          isLowestUnitPrice:
            !!ql && !!lowest && ql.unitPrice.equals(lowest),
        });
      });

      // Advisory weighted score (0-100), only for responders.
      let score: string | null = null;
      if (isResponder && lowestTotal && total) {
        // Price score: lowest total = 1, scaled down as total rises.
        const priceScore = total.greaterThan(0)
          ? Number(lowestTotal.dividedBy(total))
          : 1;
        // Lead-time score: best lead = 1, worst = 0 (1 if no spread/data).
        let leadScore = 1;
        const lead = q!.quotedLeadTimeDays;
        if (typeof lead === 'number' && bestLead !== null && worstLead !== null) {
          leadScore =
            worstLead === bestLead
              ? 1
              : 1 - (lead - bestLead) / (worstLead - bestLead);
        }
        const qualScore = QUAL_TIER[inv.qualificationStatusSnapshot] ?? 0;
        const raw =
          weights.price * priceScore +
          weights.leadTime * leadScore +
          weights.qualification * qualScore;
        score = (raw * 100).toFixed(1);
      }

      return new ComparisonColumnEntity({
        inviteeId: inv.id,
        partnerType: inv.supplierId ? 'SUPPLIER' : 'VENDOR',
        partnerName: inv.supplier?.companyName ?? inv.vendor?.companyName ?? null,
        qualificationStatusSnapshot: inv.qualificationStatusSnapshot,
        quoteStatus: inv.quoteStatus,
        nonResponder: !isResponder,
        declineReason: inv.declineReason,
        totalQuotedValue: total ? total.toString() : null,
        varianceVsLowest: variance ? variance.toString() : null,
        variancePctVsLowest: variancePct ? variancePct.toFixed(2) : null,
        isLowestTotal: !!total && !!lowestTotal && total.equals(lowestTotal),
        quotedLeadTimeDays: q?.quotedLeadTimeDays ?? null,
        paymentTermsOffered: q?.paymentTermsOffered ?? null,
        validityDays: q?.validityDays ?? null,
        attachmentFileKeys: (q?.attachmentFileKeys as string[] | null) ?? [],
        weightedScore: score,
        lines,
      });
    });

    return new RfqComparisonEntity({
      rfqId: rfq.id,
      rfqNumber: rfq.rfqNumber,
      status: rfq.status,
      weights,
      lines: rfq.lines.map((l) => ({
        rfqLineId: l.id,
        itemCode: l.item?.itemCode ?? null,
        itemName: l.item?.name ?? null,
        quantity: l.quantity.toString(),
        unitOfMeasure: l.unitOfMeasure,
      })),
      columns,
    });
  }

  // ── Award (+ DRAFT PO prefill) ───────────────────────────────────────
  async award(
    id: string,
    dto: AwardRfqDto,
    user: AuthenticatedUser,
  ): Promise<{ rfq: RfqEntity; purchaseOrderId: string }> {
    await this.access.assertCanAward(user);
    const rfq = await this.findOrThrow(id);
    if (rfq.status !== RfqStatus.CLOSED) {
      throw new BadRequestException(
        'Only a CLOSED RFQ can be awarded (close it first so quotes are final)',
      );
    }
    const invitee = await this.prisma.rfqInvitee.findFirst({
      where: { id: dto.inviteeId, rfqId: id },
      include: {
        supplier: { select: { id: true } },
        vendor: { select: { id: true } },
        quote: { include: { lines: true } },
      },
    });
    if (!invitee) throw new NotFoundException('Invitee not found on this RFQ');
    if (invitee.quoteStatus !== RfqQuoteStatus.SUBMITTED || !invitee.quote) {
      throw new BadRequestException(
        'Can only award an invitee who submitted a quote',
      );
    }

    // Lowest-total check: justification is mandatory for a non-lowest award.
    const submitted = await this.prisma.rfqInvitee.findMany({
      where: { rfqId: id, quoteStatus: RfqQuoteStatus.SUBMITTED },
      include: { quote: { select: { totalQuotedValue: true } } },
    });
    const totals = submitted
      .map((i) => i.quote?.totalQuotedValue)
      .filter((t): t is Prisma.Decimal => !!t);
    const lowestTotal = totals.reduce((m, t) => (t.lessThan(m) ? t : m));
    const isLowest = invitee.quote.totalQuotedValue.equals(lowestTotal);
    if (!isLowest && !dto.justification?.trim()) {
      throw new BadRequestException(
        'A justification is required when awarding a quote that is not the lowest total',
      );
    }

    // Pre-fill a DRAFT PurchaseOrder from the awarded quote (reuses PO create).
    const rfqLineById = new Map(rfq.lines.map((l) => [l.id, l]));
    const po = await this.purchaseOrders.create(
      {
        ...(invitee.supplierId
          ? { supplierId: invitee.supplierId }
          : { vendorId: invitee.vendorId! }),
        notes: `Auto-drafted from awarded RFQ ${rfq.rfqNumber}`,
        lines: invitee.quote.lines.map((ql) => {
          const rl = rfqLineById.get(ql.rfqLineId);
          return {
            itemId: rl!.itemId,
            orderedQuantity: Number(rl!.quantity),
            unitPrice: Number(ql.unitPrice),
            unitOfMeasure: rl!.unitOfMeasure,
          };
        }),
      },
      user,
    );

    await this.prisma.rfq.update({
      where: { id },
      data: {
        status: RfqStatus.AWARDED,
        awardedInviteeId: invitee.id,
        awardDecisionById: user.id,
        awardDecisionAt: new Date(),
        awardJustification: dto.justification?.trim() || null,
      },
    });
    return { rfq: await this.get(id, user), purchaseOrderId: po.id };
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  private async findOrThrow(id: string): Promise<RfqWithRelations> {
    const row = await this.prisma.rfq.findUnique({
      where: { id },
      include: RFQ_INCLUDE,
    });
    if (!row) throw new NotFoundException('RFQ not found');
    return row;
  }

  /** Quotes may be revealed once the RFQ is closed/awarded, or the deadline passed. */
  private quotesVisible(rfq: { status: RfqStatus; submissionDeadline: Date }): boolean {
    if (rfq.status === RfqStatus.CLOSED || rfq.status === RfqStatus.AWARDED) {
      return true;
    }
    if (rfq.status === RfqStatus.ISSUED) {
      return new Date(rfq.submissionDeadline) <= new Date();
    }
    return false;
  }

  private normaliseWeights(dto: ComparisonWeightsDto): {
    price: number;
    leadTime: number;
    qualification: number;
  } {
    const price = dto.price ?? 60;
    const leadTime = dto.leadTime ?? 20;
    const qualification = dto.qualification ?? 20;
    const sum = price + leadTime + qualification;
    if (sum <= 0) return { price: 0.6, leadTime: 0.2, qualification: 0.2 };
    return { price: price / sum, leadTime: leadTime / sum, qualification: qualification / sum };
  }

  private async buildLineData(
    lines: RfqLineInputDto[],
  ): Promise<Prisma.RfqLineCreateWithoutRfqInput[]> {
    const itemIds = [...new Set(lines.map((l) => l.itemId))];
    const items = await this.prisma.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, isActive: true, baseUnitOfMeasure: true },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    if (items.length !== itemIds.length) {
      throw new BadRequestException('One or more lines reference an unknown item');
    }
    return lines.map((l, i) => ({
      item: { connect: { id: l.itemId } },
      quantity: new Prisma.Decimal(l.quantity),
      unitOfMeasure: l.unitOfMeasure ?? byId.get(l.itemId)!.baseUnitOfMeasure,
      specificationNotes: l.specificationNotes ?? null,
      sequence: l.sequence ?? i,
    }));
  }

  private toEntity(rfq: RfqWithRelations, user: AuthenticatedUser): RfqEntity {
    void user;
    const canSeeToken =
      rfq.status === RfqStatus.ISSUED || rfq.status === RfqStatus.CLOSED;
    return new RfqEntity({
      id: rfq.id,
      rfqNumber: rfq.rfqNumber,
      title: rfq.title,
      description: rfq.description,
      status: rfq.status,
      projectKickoffId: rfq.projectKickoffId,
      projectName: rfq.projectKickoff?.projectName ?? null,
      submissionDeadline: rfq.submissionDeadline.toISOString(),
      requiredByDate: rfq.requiredByDate ? rfq.requiredByDate.toISOString() : null,
      deliveryLocation: rfq.deliveryLocation,
      paymentTermsRequested: rfq.paymentTermsRequested,
      awardedInviteeId: rfq.awardedInviteeId,
      awardDecisionByName: rfq.awardDecisionBy
        ? `${rfq.awardDecisionBy.firstName} ${rfq.awardDecisionBy.lastName}`.trim()
        : null,
      awardDecisionAt: rfq.awardDecisionAt ? rfq.awardDecisionAt.toISOString() : null,
      awardJustification: rfq.awardJustification,
      createdById: rfq.createdById,
      createdByName: rfq.createdBy
        ? `${rfq.createdBy.firstName} ${rfq.createdBy.lastName}`.trim()
        : null,
      lines: rfq.lines.map(
        (l) =>
          new RfqLineEntity({
            id: l.id,
            itemId: l.itemId,
            itemCode: l.item?.itemCode ?? null,
            itemName: l.item?.name ?? null,
            quantity: l.quantity.toString(),
            unitOfMeasure: l.unitOfMeasure,
            specificationNotes: l.specificationNotes,
            sequence: l.sequence,
          }),
      ),
      invitees: rfq.invitees.map(
        (inv) =>
          new RfqInviteeEntity({
            id: inv.id,
            supplierId: inv.supplierId,
            vendorId: inv.vendorId,
            partnerType: inv.supplierId ? 'SUPPLIER' : 'VENDOR',
            partnerName:
              inv.supplier?.companyName ?? inv.vendor?.companyName ?? null,
            qualificationStatusSnapshot: inv.qualificationStatusSnapshot,
            quoteStatus: inv.quoteStatus,
            submittedAt: inv.submittedAt ? inv.submittedAt.toISOString() : null,
            declineReason: inv.declineReason,
            revokedAt: inv.revokedAt ? inv.revokedAt.toISOString() : null,
            // Token only surfaced once issued (so SCM can hand out the link).
            inviteToken:
              canSeeToken && !inv.inviteToken.startsWith('pending:')
                ? inv.inviteToken
                : null,
          }),
      ),
      quotesVisible: this.quotesVisible(rfq),
      createdAt: rfq.createdAt.toISOString(),
      updatedAt: rfq.updatedAt.toISOString(),
    });
  }
}
