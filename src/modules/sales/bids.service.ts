import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Bid,
  BidLineItem,
  BidStatus,
  Customer,
  Prisma,
  SalesTaxType,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { CreateBidDto } from './dto/create-bid.dto';
import { BidActionDto } from './dto/bid-action.dto';
import { BidEntity, BidLineItemEntity } from './entities/bid.entity';
import {
  SalesAccessService,
  isAdmin,
  isSuperAdmin,
} from './common/sales-access.service';
import { SalesNumberingService } from './common/sales-numbering.service';
import { ApprovalRoutingService } from './common/approval-routing.service';
import { TaxConfigService } from './tax-config.service';
import { BidAssessmentsService } from './bid-assessments.service';

/** Discount above this % requires manager approval before the bid can be SENT. */
const DISCOUNT_APPROVAL_THRESHOLD = new Prisma.Decimal(10);

/** The company's home state — intra-state (CGST+SGST) when the customer matches. */
const COMPANY_STATE = 'Karnataka';

type BidLineItemWithProduct = BidLineItem & {
  product: {
    name: string;
    sku: string;
    description: string | null;
    unitOfMeasure: string;
  };
};
type BidWithLines = Bid & {
  lineItems: BidLineItemWithProduct[];
  orders?: { id: string }[];
  enquiryCreator?: { firstName: string; lastName: string };
  opportunity?: { owner: { firstName: string; lastName: string } };
  businessUnit?: { name: string; colorHex: string };
};

@Injectable()
export class BidsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SalesAccessService,
    private readonly numbering: SalesNumberingService,
    private readonly approvalRouting: ApprovalRoutingService,
    private readonly taxConfig: TaxConfigService,
    private readonly bidAssessments: BidAssessmentsService,
  ) {}

  async create(dto: CreateBidDto, user: AuthenticatedUser): Promise<BidEntity> {
    await this.access.assertSalesAccess(user);

    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id: dto.opportunityId },
      select: { id: true, enquiryCreatorId: true, businessUnitId: true },
    });
    if (!opportunity) {
      throw new NotFoundException(
        'opportunityId does not reference an opportunity',
      );
    }

    // Bid/No-Bid decision gate: the opportunity's most-recent assessment must
    // be APPROVED before any bid can be drafted against it.
    const gated = await this.bidAssessments.latestApprovedFor(
      dto.opportunityId,
    );
    if (!gated) {
      throw new BadRequestException(
        'This opportunity requires an approved Bid/No-Bid assessment before a bid can be created',
      );
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) {
      throw new NotFoundException('customerId does not reference a customer');
    }
    if (!dto.lineItems.length) {
      throw new BadRequestException('A bid must have at least one line item');
    }

    // Snapshot each product's current unitPrice — never a live reference.
    const products = await this.prisma.product.findMany({
      where: { id: { in: dto.lineItems.map((li) => li.productId) } },
    });
    const priceById = new Map(products.map((p) => [p.id, p.unitPrice]));

    const discountPercent = new Prisma.Decimal(dto.discountPercent ?? 0);
    const asOf = new Date();
    const { taxType, taxRate } = await this.resolveTax(customer, asOf);

    const lineData = dto.lineItems.map((li) => {
      const unitPrice = priceById.get(li.productId);
      if (!unitPrice) {
        throw new BadRequestException(
          `productId ${li.productId} does not reference a product`,
        );
      }
      const quantity = new Prisma.Decimal(li.quantity);
      const lineDiscountPercent =
        li.lineDiscountPercent !== undefined
          ? new Prisma.Decimal(li.lineDiscountPercent)
          : null;
      const gross = unitPrice.times(quantity);
      const lineTotal = lineDiscountPercent
        ? gross
            .times(new Prisma.Decimal(100).minus(lineDiscountPercent))
            .dividedBy(100)
        : gross;
      return {
        productId: li.productId,
        quantity,
        unitPrice,
        lineDiscountPercent,
        lineTotal: this.money(lineTotal),
      };
    });

    const totals = this.computeTotals(
      lineData.map((l) => l.lineTotal),
      discountPercent,
      taxRate,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const bidNumber = await this.numbering.nextNumber(
        'BID',
        'bid',
        asOf.getUTCFullYear(),
        tx,
      );
      return tx.bid.create({
        data: {
          bidNumber,
          opportunityId: dto.opportunityId,
          customerId: dto.customerId,
          validUntil: new Date(dto.validUntil),
          tenderReferenceNumber: dto.tenderReferenceNumber ?? null,
          quotationSubject: dto.quotationSubject ?? null,
          technicalSpecification: dto.technicalSpecification ?? null,
          attachments: (dto.attachments ?? undefined) as
            Prisma.InputJsonValue | undefined,
          subtotal: totals.subtotal,
          discountPercent,
          discountAmount: totals.discountAmount,
          taxType,
          taxRate,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          createdById: user.id,
          enquiryCreatorId: opportunity.enquiryCreatorId,
          businessUnitId: opportunity.businessUnitId,
          lineItems: { create: lineData },
        },
        include: {
          lineItems: { include: { product: true } },
          enquiryCreator: { select: { firstName: true, lastName: true } },
          opportunity: {
            select: { owner: { select: { firstName: true, lastName: true } } },
          },
          businessUnit: { select: { name: true, colorHex: true } },
        },
      });
    });
    return this.toEntity(created);
  }

  async findAll(
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<BidEntity>> {
    await this.access.assertSalesAccess(user);
    // Vertical-wide read: any Sales-vertical staff may view all Bids. (The
    // approval queue below stays owner/approver-scoped — viewing all bids is
    // not the same as being able to act on them.)
    const where: Prisma.BidWhereInput = {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.bid.findMany({
        where,
        include: {
          lineItems: { include: { product: true } },
          enquiryCreator: { select: { firstName: true, lastName: true } },
          opportunity: {
            select: { owner: { select: { firstName: true, lastName: true } } },
          },
          businessUnit: { select: { name: true, colorHex: true } },
        },
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.bid.count({ where }),
    ]);
    return {
      items: items.map((b) => this.toEntity(b)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Bids awaiting the caller's approval decision. A MANAGER sees bids
   * assigned to them (approverId = self); Admin/SuperAdmin see all
   * PENDING_APPROVAL bids (override capability). By construction a bid's
   * approverId is the creator's manager, so a manager's own submitted bid
   * never lands in their own queue — same self-exclusion as leave approvals.
   */
  /**
   * Scoped where-clause for the caller's bid-approval queue: Admin/SuperAdmin
   * see all PENDING_APPROVAL; everyone else sees only bids routed to them
   * (approverId === caller). Shared by list + count so they can't drift.
   */
  private pendingApprovalWhere(user: AuthenticatedUser): Prisma.BidWhereInput {
    return isAdmin(user)
      ? { status: BidStatus.PENDING_APPROVAL }
      : { status: BidStatus.PENDING_APPROVAL, approverId: user.id };
  }

  /**
   * Count of bids awaiting the caller's approval. Reuses the list scope. Non-
   * Sales callers get 0 (not a thrown error) so the unified notifications
   * endpoint can call this for any role.
   */
  async countPendingApproval(user: AuthenticatedUser): Promise<number> {
    if (!isSuperAdmin(user) && !(await this.access.isSalesStaff(user))) {
      return 0;
    }
    return this.prisma.bid.count({ where: this.pendingApprovalWhere(user) });
  }

  async findPendingApproval(
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<BidEntity>> {
    await this.access.assertSalesAccess(user);
    const where = this.pendingApprovalWhere(user);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.bid.findMany({
        where,
        include: {
          lineItems: { include: { product: true } },
          enquiryCreator: { select: { firstName: true, lastName: true } },
          opportunity: {
            select: { owner: { select: { firstName: true, lastName: true } } },
          },
          businessUnit: { select: { name: true, colorHex: true } },
        },
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.bid.count({ where }),
    ]);
    return {
      items: items.map((b) => this.toEntity(b)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<BidEntity> {
    await this.access.assertSalesAccess(user);
    // Vertical-wide read — any Sales-vertical staff may view any Bid.
    const bid = await this.findRawOrThrow(id);
    return this.toEntity(bid);
  }

  /**
   * DRAFT -> submit. If discountPercent > 10 the bid needs manager approval:
   * status becomes PENDING_APPROVAL and its approver is resolved via the
   * same escalation guard as leave (a manager's own bid escalates to their
   * manager). Otherwise it goes straight to SENT.
   */
  async submit(id: string, user: AuthenticatedUser): Promise<BidEntity> {
    await this.access.assertSalesAccess(user);
    const bid = await this.findRawOrThrow(id);
    await this.access.assertCanAccessOwned(user, bid.createdById);

    if (bid.status !== BidStatus.DRAFT && bid.status !== BidStatus.REJECTED) {
      throw new BadRequestException(
        `Only a DRAFT or REJECTED bid can be submitted (current status: ${bid.status})`,
      );
    }

    const needsApproval = bid.discountPercent.gt(DISCOUNT_APPROVAL_THRESHOLD);
    if (!needsApproval) {
      const updated = await this.prisma.bid.update({
        where: { id },
        data: { status: BidStatus.SENT, approverId: null, approvedAt: null },
        include: { lineItems: { include: { product: true } } },
      });
      return this.toEntity(updated);
    }

    const approverId = await this.approvalRouting.resolveApprover(
      bid.createdById,
    );
    if (!approverId) {
      throw new BadRequestException(
        'Bid requires discount approval but the creator has no reporting manager to route to',
      );
    }
    const updated = await this.prisma.bid.update({
      where: { id },
      data: { status: BidStatus.PENDING_APPROVAL, approverId },
      include: { lineItems: { include: { product: true } } },
    });
    return this.toEntity(updated);
  }

  async approve(
    id: string,
    dto: BidActionDto,
    user: AuthenticatedUser,
  ): Promise<BidEntity> {
    await this.access.assertSalesAccess(user);
    const bid = await this.findRawOrThrow(id);
    await this.approvalRouting.assertCanActOnBid(bid.createdById, user);

    if (bid.status !== BidStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only a PENDING_APPROVAL bid can be approved',
      );
    }
    // Snapshot the approving manager's e-signature at approval time. Null-safe.
    const emp = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: { signatureText: true, signatureFont: true },
    });
    const updated = await this.prisma.bid.update({
      where: { id },
      data: {
        status: BidStatus.APPROVED,
        approverId: user.id,
        approvedAt: new Date(),
        approverComments: dto.approverComments ?? null,
        approverSignatureTextSnapshot: emp?.signatureText ?? null,
        approverSignatureFontSnapshot: emp?.signatureFont ?? null,
      },
      include: { lineItems: { include: { product: true } } },
    });
    return this.toEntity(updated);
  }

  async reject(
    id: string,
    dto: BidActionDto,
    user: AuthenticatedUser,
  ): Promise<BidEntity> {
    await this.access.assertSalesAccess(user);
    const bid = await this.findRawOrThrow(id);
    await this.approvalRouting.assertCanActOnBid(bid.createdById, user);

    if (bid.status !== BidStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only a PENDING_APPROVAL bid can be rejected',
      );
    }
    const updated = await this.prisma.bid.update({
      where: { id },
      data: {
        status: BidStatus.REJECTED,
        approverId: user.id,
        approvedAt: new Date(),
        approverComments: dto.approverComments ?? null,
      },
      include: { lineItems: { include: { product: true } } },
    });
    return this.toEntity(updated);
  }

  /**
   * Rep marks an APPROVED bid as SENT to the customer, then (customer having
   * accepted out-of-band) as ACCEPTED. Kept as an explicit transition method
   * so the DRAFT/approval invariants above stay in one place.
   */
  async markStatus(
    id: string,
    target: BidStatus,
    user: AuthenticatedUser,
  ): Promise<BidEntity> {
    await this.access.assertSalesAccess(user);
    const bid = await this.findRawOrThrow(id);
    await this.access.assertCanAccessOwned(user, bid.createdById);

    const allowed: Record<string, BidStatus[]> = {
      [BidStatus.APPROVED]: [BidStatus.SENT],
      [BidStatus.SENT]: [BidStatus.ACCEPTED, BidStatus.EXPIRED],
    };
    if (!allowed[bid.status]?.includes(target)) {
      throw new BadRequestException(
        `Cannot move a bid from ${bid.status} to ${target}`,
      );
    }
    const updated = await this.prisma.bid.update({
      where: { id },
      data: { status: target },
      include: { lineItems: { include: { product: true } } },
    });
    return this.toEntity(updated);
  }

  // ---- internal helpers ----

  /**
   * One rate per bid based on intra- vs inter-state: if the customer's
   * billing state matches the company's home state it's CGST_SGST, else
   * IGST. Returns nulls (no tax) when no matching TaxConfig is effective —
   * a bid can still be drafted; tax is simply 0 until a rate is configured.
   */
  private async resolveTax(
    customer: Customer,
    asOf: Date,
  ): Promise<{ taxType: SalesTaxType | null; taxRate: Prisma.Decimal | null }> {
    const billing = customer.billingAddress as { state?: string } | null;
    const customerState =
      billing && typeof billing === 'object' ? billing.state : undefined;
    const taxType =
      customerState && customerState === COMPANY_STATE
        ? SalesTaxType.CGST_SGST
        : SalesTaxType.IGST;
    const config = await this.taxConfig.findEffective(taxType, asOf);
    if (!config) {
      return { taxType: null, taxRate: null };
    }
    return { taxType, taxRate: config.rate };
  }

  private computeTotals(
    lineTotals: Prisma.Decimal[],
    discountPercent: Prisma.Decimal,
    taxRate: Prisma.Decimal | null,
  ): {
    subtotal: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
  } {
    const subtotal = lineTotals.reduce(
      (sum, lt) => sum.plus(lt),
      new Prisma.Decimal(0),
    );
    const discountAmount = this.money(
      subtotal.times(discountPercent).dividedBy(100),
    );
    const taxable = subtotal.minus(discountAmount);
    const taxAmount = taxRate
      ? this.money(taxable.times(taxRate).dividedBy(100))
      : new Prisma.Decimal(0);
    const totalAmount = this.money(taxable.plus(taxAmount));
    return {
      subtotal: this.money(subtotal),
      discountAmount,
      taxAmount,
      totalAmount,
    };
  }

  /** Round a Decimal to 2 places (money precision), matching @db.Decimal(14,2). */
  private money(value: Prisma.Decimal): Prisma.Decimal {
    return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  private async findRawOrThrow(id: string): Promise<BidWithLines> {
    const bid = await this.prisma.bid.findUnique({
      where: { id },
      include: {
        lineItems: { include: { product: true } },
        enquiryCreator: { select: { firstName: true, lastName: true } },
        opportunity: {
          select: { owner: { select: { firstName: true, lastName: true } } },
        },
        businessUnit: { select: { name: true, colorHex: true } },
        // The converted order (if any) — a bid converts to at most one.
        orders: { select: { id: true }, take: 1 },
      },
    });
    if (!bid) {
      throw new NotFoundException('Bid not found');
    }
    return bid;
  }

  private toEntity(bid: BidWithLines): BidEntity {
    return new BidEntity({
      id: bid.id,
      bidNumber: bid.bidNumber,
      opportunityId: bid.opportunityId,
      customerId: bid.customerId,
      status: bid.status,
      validUntil: bid.validUntil,
      tenderReferenceNumber: bid.tenderReferenceNumber,
      quotationSubject: bid.quotationSubject,
      technicalSpecification: bid.technicalSpecification,
      attachments: bid.attachments,
      subtotal: bid.subtotal.toString(),
      discountPercent: bid.discountPercent.toString(),
      discountAmount: bid.discountAmount.toString(),
      taxType: bid.taxType,
      taxRate: bid.taxRate?.toString() ?? null,
      taxAmount: bid.taxAmount.toString(),
      totalAmount: bid.totalAmount.toString(),
      createdById: bid.createdById,
      enquiryCreatorId: bid.enquiryCreatorId,
      enquiryCreatorName: bid.enquiryCreator
        ? `${bid.enquiryCreator.firstName} ${bid.enquiryCreator.lastName}`.trim()
        : '',
      ownerName: bid.opportunity?.owner
        ? `${bid.opportunity.owner.firstName} ${bid.opportunity.owner.lastName}`.trim()
        : '',
      businessUnitId: bid.businessUnitId,
      businessUnitName: bid.businessUnit?.name ?? '',
      businessUnitColorHex: bid.businessUnit?.colorHex ?? '#64748B',
      approverId: bid.approverId,
      approvedAt: bid.approvedAt,
      approverComments: bid.approverComments,
      approverSignatureTextSnapshot: bid.approverSignatureTextSnapshot,
      approverSignatureFontSnapshot: bid.approverSignatureFontSnapshot,
      convertedOrderId: bid.orders?.[0]?.id ?? null,
      lineItems: bid.lineItems.map(
        (li) =>
          new BidLineItemEntity({
            id: li.id,
            bidId: li.bidId,
            productId: li.productId,
            productName: li.product.name,
            productSku: li.product.sku,
            productDescription: li.product.description ?? null,
            productUnitOfMeasure: li.product.unitOfMeasure,
            quantity: li.quantity.toString(),
            unitPrice: li.unitPrice.toString(),
            lineDiscountPercent: li.lineDiscountPercent?.toString() ?? null,
            lineTotal: li.lineTotal.toString(),
          }),
      ),
      createdAt: bid.createdAt,
      updatedAt: bid.updatedAt,
    });
  }
}
