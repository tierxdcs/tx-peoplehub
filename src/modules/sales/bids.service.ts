import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Bid,
  BidAmcCharge,
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
import { ResolveBidLineItemDto } from './dto/resolve-bid-line-item.dto';
import {
  BidAmcChargeEntity,
  BidEntity,
  BidLineItemEntity,
} from './entities/bid.entity';
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
  // Null for an unresolved ad-hoc line (productId is null); populated otherwise.
  product: {
    name: string;
    sku: string;
    description: string | null;
    unitOfMeasure: string;
  } | null;
};
type BidWithLines = Bid & {
  lineItems: BidLineItemWithProduct[];
  amcCharges?: BidAmcCharge[];
  orders?: { id: string }[];
  customer?: { name: string } | null;
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

    // Each line is either a real Product or an ad-hoc placeholder — exactly one.
    // Validate up front so a malformed line can't slip through the price lookup.
    for (const li of dto.lineItems) {
      const hasProduct = !!li.productId;
      const hasAdHoc = !!li.adHocProductName;
      if (hasProduct === hasAdHoc) {
        throw new BadRequestException(
          'Each line item must set exactly one of productId or adHocProductName',
        );
      }
      if (hasAdHoc && li.unitPrice === undefined) {
        throw new BadRequestException(
          `Ad-hoc line "${li.adHocProductName}" requires a unitPrice`,
        );
      }
    }

    // Snapshot each real product's current unitPrice — never a live reference.
    // Ad-hoc lines carry the rep-typed unitPrice instead.
    const productIds = dto.lineItems
      .map((li) => li.productId)
      .filter((id): id is string => !!id);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
    });
    const priceById = new Map(products.map((p) => [p.id, p.unitPrice]));

    const discountPercent = new Prisma.Decimal(dto.discountPercent ?? 0);
    const marginPercent = new Prisma.Decimal(dto.marginPercent ?? 0);
    const asOf = new Date();
    const { taxType, taxRate } = await this.resolveTax(customer, asOf);

    const HUNDRED = new Prisma.Decimal(100);
    const lineData = dto.lineItems.map((li) => {
      let baseUnitPrice: Prisma.Decimal;
      if (li.productId) {
        const snapshot = priceById.get(li.productId);
        if (!snapshot) {
          throw new BadRequestException(
            `productId ${li.productId} does not reference a product`,
          );
        }
        baseUnitPrice = snapshot;
      } else {
        baseUnitPrice = new Prisma.Decimal(li.unitPrice as number);
      }
      const quantity = new Prisma.Decimal(li.quantity);
      const lineDiscountPercent =
        li.lineDiscountPercent !== undefined
          ? new Prisma.Decimal(li.lineDiscountPercent)
          : null;
      const lineMarginPercent =
        li.marginPercent !== undefined
          ? new Prisma.Decimal(li.marginPercent)
          : null;
      // Sales margin is a markup on the base price: apply the per-line margin
      // first, then the bid-level margin on top, before quantity and any
      // discount. The result is the quoted unit price — the margin itself is
      // internal and is never surfaced to the customer, only its effect on the
      // price. Round the marked-up unit price to money precision so the printed
      // proposal reconciles (unit × qty), exactly as a customer would verify.
      const marginFactor = HUNDRED.plus(lineMarginPercent ?? 0)
        .dividedBy(HUNDRED)
        .times(HUNDRED.plus(marginPercent).dividedBy(HUNDRED));
      const unitPrice = this.money(baseUnitPrice.times(marginFactor));
      const gross = unitPrice.times(quantity);
      const lineTotal = lineDiscountPercent
        ? gross.times(HUNDRED.minus(lineDiscountPercent)).dividedBy(HUNDRED)
        : gross;
      return {
        productId: li.productId ?? null,
        adHocProductName: li.productId ? null : (li.adHocProductName ?? null),
        adHocDescription: li.productId ? null : (li.adHocDescription ?? null),
        quantity,
        unitPrice,
        lineDiscountPercent,
        marginPercent: lineMarginPercent,
        lineTotal: this.money(lineTotal),
      };
    });

    const totals = this.computeTotals(
      lineData.map((l) => l.lineTotal),
      discountPercent,
      taxRate,
    );
    const amcData = (dto.amcCharges ?? [])
      .filter((charge) => charge.amount > 0)
      .map((charge) => ({
        yearNumber: charge.yearNumber,
        amount: this.money(new Prisma.Decimal(charge.amount)),
      }));

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
          marginPercent,
          discountAmount: totals.discountAmount,
          taxType,
          taxRate,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          createdById: user.id,
          enquiryCreatorId: opportunity.enquiryCreatorId,
          businessUnitId: opportunity.businessUnitId,
          lineItems: { create: lineData },
          amcCharges: { create: amcData },
        },
        include: {
          lineItems: { include: { product: true } },
          amcCharges: { orderBy: { yearNumber: 'asc' } },
          customer: { select: { name: true } },
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
          amcCharges: { orderBy: { yearNumber: 'asc' } },
          customer: { select: { name: true } },
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
          amcCharges: { orderBy: { yearNumber: 'asc' } },
          customer: { select: { name: true } },
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
        include: {
          lineItems: { include: { product: true } },
          amcCharges: { orderBy: { yearNumber: 'asc' } },
        },
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
      include: {
        lineItems: { include: { product: true } },
        amcCharges: { orderBy: { yearNumber: 'asc' } },
      },
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
      include: {
        lineItems: { include: { product: true } },
        amcCharges: { orderBy: { yearNumber: 'asc' } },
      },
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
      include: {
        lineItems: { include: { product: true } },
        amcCharges: { orderBy: { yearNumber: 'asc' } },
      },
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
      include: {
        lineItems: { include: { product: true } },
        amcCharges: { orderBy: { yearNumber: 'asc' } },
      },
    });
    return this.toEntity(updated);
  }

  /**
   * Resolve an ad-hoc placeholder line to a real Product ("commit formally").
   * One-way: sets productId and clears the ad-hoc fields, but preserves the
   * snapshotted unitPrice/lineTotal (the customer was quoted that figure).
   * Blocked once the bid has been converted (an order already references these
   * lines). The chosen Product must exist and be active. Requires ownership —
   * the same guard as any other write to the bid.
   */
  async resolveLineItem(
    bidId: string,
    lineItemId: string,
    dto: ResolveBidLineItemDto,
    user: AuthenticatedUser,
  ): Promise<BidEntity> {
    await this.access.assertSalesAccess(user);
    const bid = await this.findRawOrThrow(bidId);
    await this.access.assertCanAccessOwned(user, bid.createdById);

    if (bid.orders && bid.orders.length > 0) {
      throw new BadRequestException(
        'This bid has already been converted to an order and can no longer be edited',
      );
    }

    const line = bid.lineItems.find((li) => li.id === lineItemId);
    if (!line) {
      throw new NotFoundException('Line item not found on this bid');
    }
    if (line.productId !== null) {
      throw new BadRequestException(
        'This line item is already linked to a product',
      );
    }

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, isActive: true },
    });
    if (!product) {
      throw new NotFoundException('productId does not reference a product');
    }
    if (!product.isActive) {
      throw new BadRequestException(
        'That product is inactive and cannot be used',
      );
    }

    await this.prisma.bidLineItem.update({
      where: { id: lineItemId },
      data: {
        productId: dto.productId,
        adHocProductName: null,
        adHocDescription: null,
      },
    });
    // Re-read the whole bid so the returned entity reflects the resolved line.
    return this.toEntity(await this.findRawOrThrow(bidId));
  }

  /**
   * Cross-bid visibility: how many ad-hoc line items are still awaiting product
   * setup, and across how many bids. Scoped to bids that could still convert
   * (EXPIRED/REJECTED bids are dead ends and never become orders). Non-Sales
   * callers get zeros rather than an error so the list header can call it for
   * any role.
   */
  async countAdHocLineItems(
    user: AuthenticatedUser,
  ): Promise<{ lineItemCount: number; bidCount: number }> {
    if (!isSuperAdmin(user) && !(await this.access.isSalesStaff(user))) {
      return { lineItemCount: 0, bidCount: 0 };
    }
    const openStatuses: BidStatus[] = [
      BidStatus.DRAFT,
      BidStatus.PENDING_APPROVAL,
      BidStatus.APPROVED,
      BidStatus.SENT,
      BidStatus.ACCEPTED,
    ];
    const unresolved = await this.prisma.bidLineItem.findMany({
      where: {
        productId: null,
        bid: { status: { in: openStatuses } },
      },
      select: { bidId: true },
    });
    const bidIds = new Set(unresolved.map((li) => li.bidId));
    return { lineItemCount: unresolved.length, bidCount: bidIds.size };
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
        amcCharges: { orderBy: { yearNumber: 'asc' } },
        customer: { select: { name: true } },
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
    const amcCharges = bid.amcCharges ?? [];
    const amcTotal = this.money(
      amcCharges.reduce(
        (sum, charge) => sum.plus(charge.amount),
        new Prisma.Decimal(0),
      ),
    );
    const grandTotal = this.money(bid.totalAmount.plus(amcTotal));

    return new BidEntity({
      id: bid.id,
      bidNumber: bid.bidNumber,
      opportunityId: bid.opportunityId,
      customerId: bid.customerId,
      customerName: bid.customer?.name ?? null,
      status: bid.status,
      validUntil: bid.validUntil,
      tenderReferenceNumber: bid.tenderReferenceNumber,
      quotationSubject: bid.quotationSubject,
      technicalSpecification: bid.technicalSpecification,
      attachments: bid.attachments,
      subtotal: bid.subtotal.toString(),
      discountPercent: bid.discountPercent.toString(),
      // marginPercent is a NOT-NULL/default-0 column; the `?? '0'` only guards
      // partial test fixtures, and 0 is exactly the DB default (no margin).
      marginPercent: bid.marginPercent?.toString() ?? '0',
      discountAmount: bid.discountAmount.toString(),
      taxType: bid.taxType,
      taxRate: bid.taxRate?.toString() ?? null,
      taxAmount: bid.taxAmount.toString(),
      totalAmount: bid.totalAmount.toString(),
      amcTotal: amcTotal.toString(),
      grandTotal: grandTotal.toString(),
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
            isAdHoc: li.productId === null,
            adHocProductName: li.adHocProductName ?? null,
            adHocDescription: li.adHocDescription ?? null,
            // Display fields fall back to the ad-hoc placeholder when the line
            // has no real Product yet, so the detail page and the Techno-
            // Commercial Proposal render identically either way.
            productName: li.product?.name ?? li.adHocProductName ?? '',
            productSku: li.product?.sku ?? null,
            productDescription:
              li.product?.description ?? li.adHocDescription ?? null,
            productUnitOfMeasure: li.product?.unitOfMeasure ?? 'each',
            quantity: li.quantity.toString(),
            unitPrice: li.unitPrice.toString(),
            lineDiscountPercent: li.lineDiscountPercent?.toString() ?? null,
            marginPercent: li.marginPercent?.toString() ?? null,
            lineTotal: li.lineTotal.toString(),
          }),
      ),
      amcCharges: amcCharges.map(
        (charge) =>
          new BidAmcChargeEntity({
            id: charge.id,
            bidId: charge.bidId,
            yearNumber: charge.yearNumber,
            amount: charge.amount.toString(),
          }),
      ),
      createdAt: bid.createdAt,
      updatedAt: bid.updatedAt,
    });
  }
}
