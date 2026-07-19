import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountingPeriodStatus,
  ApInvoiceStatus,
  ApPaymentStatus,
  JournalStatus,
  PayablePartyType,
  Prisma,
  SalesInvoiceStatus,
  ThreeWayMatchStatus,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { FinanceAccessService } from '../finance/finance-access.service';
import {
  ApApprovalDto,
  CreateApInvoiceDto,
  CreateApPaymentDto,
  ExecutePaymentDto,
} from './dto/ap.dto';

const AP_INCLUDE = {
  supplier: true,
  vendor: true,
  purchaseOrder: true,
  lines: {
    include: {
      purchaseOrderLine: { include: { item: true } },
      grnLine: { include: { grn: true } },
    },
    orderBy: { sequence: 'asc' as const },
  },
  paymentAllocations: true,
};
@Injectable()
export class ApService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FinanceAccessService,
  ) {}
  async partners(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const [suppliers, vendors] = await Promise.all([
      this.prisma.supplier.findMany({ orderBy: { companyName: 'asc' } }),
      this.prisma.vendor.findMany({ orderBy: { companyName: 'asc' } }),
    ]);
    return { suppliers, vendors };
  }
  async purchaseOrders(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.purchaseOrder.findMany({
      where: {
        status: { in: ['ISSUED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED'] },
      },
      include: {
        supplier: true,
        vendor: true,
        lines: {
          include: {
            item: true,
            grnLines: {
              where: { acceptedQuantity: { gt: 0 } },
              include: { grn: true },
            },
          },
        },
      },
      orderBy: { orderDate: 'desc' },
    });
  }
  async createInvoice(dto: CreateApInvoiceDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const currency = this.currency(dto.currencyCode, dto.exchangeRateToInr);
    const party = this.party(dto.supplierId, dto.vendorId);
    await this.assertParty(party);
    const duplicate = await this.prisma.accountsPayableInvoice.findFirst({
      where: {
        partyType: party.type,
        partyId: party.id,
        externalInvoiceNumber: {
          equals: dto.externalInvoiceNumber,
          mode: 'insensitive',
        },
      },
    });
    if (duplicate)
      throw new ConflictException(
        'This invoice number already exists for the selected supplier/vendor',
      );
    if (dto.purchaseOrderId) {
      const po = await this.prisma.purchaseOrder.findUnique({
        where: { id: dto.purchaseOrderId },
      });
      if (
        !po ||
        po.supplierId !== dto.supplierId ||
        po.vendorId !== dto.vendorId
      )
        throw new BadRequestException(
          'Purchase order does not belong to the selected party',
        );
    }
    const calculated = [] as any[];
    let qtyMismatch = false,
      priceMismatch = false;
    for (let index = 0; index < dto.lines.length; index++) {
      const l = dto.lines[index];
      const taxable = new Prisma.Decimal(l.quantity)
          .times(l.unitPrice)
          .toDecimalPlaces(2),
        tax = new Prisma.Decimal(l.taxAmount ?? 0);
      if (dto.purchaseOrderId && (!l.purchaseOrderLineId || !l.grnLineId))
        throw new BadRequestException(
          'PO-linked invoice lines require both PO line and accepted GRN line',
        );
      if (l.purchaseOrderLineId && l.grnLineId) {
        const grn = await this.prisma.goodsReceiptNoteLine.findUnique({
          where: { id: l.grnLineId },
          include: { purchaseOrderLine: true, grn: true },
        });
        if (
          !grn ||
          grn.purchaseOrderLineId !== l.purchaseOrderLineId ||
          grn.grn.purchaseOrderId !== dto.purchaseOrderId ||
          grn.acceptedQuantity == null
        )
          throw new BadRequestException(
            'GRN line is not an accepted receipt for this PO line',
          );
        const prior = await this.prisma.accountsPayableInvoiceLine.aggregate({
          _sum: { quantity: true },
          where: {
            grnLineId: l.grnLineId,
            invoice: {
              status: {
                notIn: [ApInvoiceStatus.CANCELLED, ApInvoiceStatus.REJECTED],
              },
            },
          },
        });
        const remaining = grn.acceptedQuantity.minus(prior._sum.quantity ?? 0);
        if (new Prisma.Decimal(l.quantity).gt(remaining)) qtyMismatch = true;
        if (
          !new Prisma.Decimal(l.unitPrice).equals(
            grn.purchaseOrderLine.unitPrice,
          )
        )
          priceMismatch = true;
      }
      calculated.push({
        sequence: index + 1,
        description: l.description,
        hsnSacCode: l.hsnSacCode,
        purchaseOrderLineId: l.purchaseOrderLineId,
        grnLineId: l.grnLineId,
        quantity: l.quantity,
        unitOfMeasure: l.unitOfMeasure,
        unitPrice: l.unitPrice,
        taxableAmount: taxable,
        taxAmount: tax,
        lineTotal: taxable.plus(tax),
      });
    }
    const taxable = calculated.reduce(
        (s, l) => s.plus(l.taxableAmount),
        new Prisma.Decimal(0),
      ),
      lineTax = calculated.reduce(
        (s, l) => s.plus(l.taxAmount),
        new Prisma.Decimal(0),
      ),
      cgst = new Prisma.Decimal(dto.inputCgstAmount ?? 0),
      sgst = new Prisma.Decimal(dto.inputSgstAmount ?? 0),
      igst = new Prisma.Decimal(dto.inputIgstAmount ?? 0),
      tax = cgst.plus(sgst).plus(igst),
      other = new Prisma.Decimal(dto.otherCharges ?? 0),
      tds = new Prisma.Decimal(dto.tdsAmount ?? 0),
      total = taxable.plus(tax).plus(other),
      outstanding = total.minus(tds);
    if (!tax.equals(lineTax))
      throw new BadRequestException(
        'Invoice CGST + SGST + IGST must equal the total tax on its lines',
      );
    if (outstanding.lt(0))
      throw new BadRequestException('TDS cannot exceed invoice total');
    const matchStatus = !dto.purchaseOrderId
      ? ThreeWayMatchStatus.NOT_APPLICABLE
      : qtyMismatch && priceMismatch
        ? ThreeWayMatchStatus.QUANTITY_AND_PRICE_MISMATCH
        : qtyMismatch
          ? ThreeWayMatchStatus.QUANTITY_MISMATCH
          : priceMismatch
            ? ThreeWayMatchStatus.PRICE_MISMATCH
            : ThreeWayMatchStatus.MATCHED;
    const invoiceDate = this.day(dto.invoiceDate),
      receivedDate = this.day(dto.receivedDate),
      dueDate = this.day(dto.dueDate);
    if (dueDate < invoiceDate)
      throw new BadRequestException('Due date cannot precede invoice date');
    return this.prisma.$transaction(async (tx) => {
      const n = await this.number(
        tx,
        'AP_INVOICE',
        'BILL',
        invoiceDate.getUTCFullYear(),
      );
      return tx.accountsPayableInvoice.create({
        data: {
          internalBillNumber: n,
          partyType: party.type,
          supplierId: dto.supplierId,
          vendorId: dto.vendorId,
          partyId: party.id,
          externalInvoiceNumber: dto.externalInvoiceNumber.trim(),
          invoiceDate,
          receivedDate,
          dueDate,
          purchaseOrderId: dto.purchaseOrderId,
          currencyCode: currency,
          exchangeRateToInr: dto.exchangeRateToInr ?? 1,
          supplierGstinSnapshot: dto.supplierGstin,
          taxableAmount: taxable,
          inputCgstAmount: cgst,
          inputSgstAmount: sgst,
          inputIgstAmount: igst,
          otherCharges: other,
          tdsAmount: tds,
          totalAmount: total,
          outstandingAmount: outstanding,
          status: dto.purchaseOrderId
            ? ApInvoiceStatus.PENDING_MATCH
            : ApInvoiceStatus.DRAFT,
          matchStatus,
          matchDetails: { quantityMismatch: qtyMismatch, priceMismatch },
          notes: dto.notes,
          createdById: user.id,
          lines: { create: calculated },
        },
        include: AP_INCLUDE,
      });
    });
  }
  async invoices(q: PaginationQueryDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.accountsPayableInvoice.findMany({
        include: AP_INCLUDE,
        orderBy: { invoiceDate: 'desc' },
        skip: q.skip,
        take: q.limit,
      }),
      this.prisma.accountsPayableInvoice.count(),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
  async getInvoice(id: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.invoice(id);
  }
  async submitInvoice(id: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const i = await this.invoice(id);
    if (
      ![
        ApInvoiceStatus.DRAFT,
        ApInvoiceStatus.PENDING_MATCH,
        ApInvoiceStatus.REJECTED,
        ApInvoiceStatus.MATCH_EXCEPTION,
      ].includes(i.status as any)
    )
      throw new BadRequestException(
        'Invoice cannot be submitted from its current status',
      );
    const exception =
      i.matchStatus !== ThreeWayMatchStatus.MATCHED &&
      i.matchStatus !== ThreeWayMatchStatus.NOT_APPLICABLE;
    return this.prisma.accountsPayableInvoice.update({
      where: { id },
      data: {
        status: exception
          ? ApInvoiceStatus.MATCH_EXCEPTION
          : ApInvoiceStatus.PENDING_APPROVAL,
        submittedById: user.id,
        submittedAt: new Date(),
        rejectionComment: null,
      },
      include: AP_INCLUDE,
    });
  }
  async approveInvoice(
    id: string,
    dto: ApApprovalDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertAccountsHead(user);
    const i = await this.invoice(id);
    if (
      ![
        ApInvoiceStatus.PENDING_APPROVAL,
        ApInvoiceStatus.MATCH_EXCEPTION,
      ].includes(i.status as any)
    )
      throw new BadRequestException(
        'Only pending or match-exception invoices can be approved',
      );
    if (i.createdById === user.id)
      throw new BadRequestException(
        'Finance Head cannot approve an invoice they created',
      );
    if (
      i.status === ApInvoiceStatus.MATCH_EXCEPTION &&
      !dto.overrideReason?.trim()
    )
      throw new BadRequestException('A match override reason is required');
    return this.postInvoice(i, dto.overrideReason, user.id);
  }
  async rejectInvoice(id: string, comment: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const i = await this.invoice(id);
    if (
      ![
        ApInvoiceStatus.PENDING_APPROVAL,
        ApInvoiceStatus.MATCH_EXCEPTION,
      ].includes(i.status as any)
    )
      throw new BadRequestException('Invoice is not awaiting approval');
    return this.prisma.accountsPayableInvoice.update({
      where: { id },
      data: { status: ApInvoiceStatus.REJECTED, rejectionComment: comment },
      include: AP_INCLUDE,
    });
  }
  async createPayment(dto: CreateApPaymentDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const currency = this.currency(dto.currencyCode, dto.exchangeRateToInr);
    const party = this.party(dto.supplierId, dto.vendorId);
    await this.assertParty(party);
    const allocations = dto.allocations ?? [],
      invoices = await this.prisma.accountsPayableInvoice.findMany({
        where: { id: { in: allocations.map((a) => a.invoiceId) } },
      });
    if (
      new Set(allocations.map((a) => a.invoiceId)).size !== allocations.length
    )
      throw new BadRequestException('Each invoice can be allocated only once');
    if (invoices.length !== allocations.length)
      throw new BadRequestException(
        'One or more allocated invoices do not exist',
      );
    if (
      invoices.some(
        (i) =>
          i.partyType !== party.type ||
          i.partyId !== party.id ||
          (i.status !== ApInvoiceStatus.APPROVED &&
            i.status !== ApInvoiceStatus.PARTIALLY_PAID),
      )
    )
      throw new BadRequestException(
        'Allocations must be open invoices for the selected party',
      );
    for (const a of allocations) {
      const i = invoices.find((x) => x.id === a.invoiceId)!;
      if (new Prisma.Decimal(a.amount).gt(i.outstandingAmount))
        throw new BadRequestException(
          `Allocation exceeds ${i.internalBillNumber} outstanding balance`,
        );
    }
    const allocated = allocations.reduce(
      (s, a) => s.plus(a.amount),
      new Prisma.Decimal(0),
    );
    if (allocated.gt(dto.amount))
      throw new BadRequestException('Allocations exceed payment amount');
    const date = this.day(dto.plannedDate);
    return this.prisma.$transaction(async (tx) => {
      const n = await this.number(
        tx,
        'AP_PAYMENT',
        'PAY',
        date.getUTCFullYear(),
      );
      return tx.accountsPayablePayment.create({
        data: {
          paymentNumber: n,
          partyType: party.type,
          supplierId: dto.supplierId,
          vendorId: dto.vendorId,
          partyId: party.id,
          plannedDate: date,
          currencyCode: currency,
          exchangeRateToInr: dto.exchangeRateToInr ?? 1,
          amount: dto.amount,
          paymentMethod: dto.paymentMethod,
          notes: dto.notes,
          createdById: user.id,
          allocations: { create: allocations },
        },
        include: {
          supplier: true,
          vendor: true,
          allocations: { include: { invoice: true } },
        },
      });
    });
  }
  async payments(q: PaginationQueryDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.accountsPayablePayment.findMany({
        include: {
          supplier: true,
          vendor: true,
          allocations: { include: { invoice: true } },
        },
        orderBy: { plannedDate: 'desc' },
        skip: q.skip,
        take: q.limit,
      }),
      this.prisma.accountsPayablePayment.count(),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }
  async submitPayment(id: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const p = await this.payment(id);
    if (
      ![ApPaymentStatus.DRAFT, ApPaymentStatus.REJECTED].includes(
        p.status as any,
      )
    )
      throw new BadRequestException(
        'Only draft or rejected payments can be submitted',
      );
    return this.prisma.accountsPayablePayment.update({
      where: { id },
      data: {
        status: ApPaymentStatus.PENDING_APPROVAL,
        submittedById: user.id,
        submittedAt: new Date(),
        rejectionComment: null,
      },
    });
  }
  async approvePayment(id: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const p = await this.payment(id);
    if (p.status !== ApPaymentStatus.PENDING_APPROVAL)
      throw new BadRequestException('Payment is not pending approval');
    if (p.createdById === user.id)
      throw new BadRequestException(
        'Finance Head cannot approve a payment they created',
      );
    return this.prisma.accountsPayablePayment.update({
      where: { id },
      data: {
        status: ApPaymentStatus.APPROVED,
        approvedById: user.id,
        approvedAt: new Date(),
      },
    });
  }
  async rejectPayment(id: string, comment: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const p = await this.payment(id);
    if (p.status !== ApPaymentStatus.PENDING_APPROVAL)
      throw new BadRequestException('Payment is not pending approval');
    return this.prisma.accountsPayablePayment.update({
      where: { id },
      data: { status: ApPaymentStatus.REJECTED, rejectionComment: comment },
    });
  }
  async executePayment(
    id: string,
    dto: ExecutePaymentDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertCanUseFinance(user);
    const p = await this.prisma.accountsPayablePayment.findUnique({
      where: { id },
      include: { allocations: { include: { invoice: true } } },
    });
    if (!p) throw new NotFoundException('Payment not found');
    if (p.status !== ApPaymentStatus.APPROVED)
      throw new BadRequestException('Only an approved payment can be executed');
    return this.postPayment(p, dto, user.id);
  }
  async summary(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const invoices = await this.prisma.accountsPayableInvoice.findMany({
      where: {
        status: {
          in: [
            ApInvoiceStatus.APPROVED,
            ApInvoiceStatus.PARTIALLY_PAID,
            ApInvoiceStatus.PAID,
            ApInvoiceStatus.DISPUTED,
          ],
        },
      },
      include: { supplier: true, vendor: true },
    });
    const map = new Map<string, any>(),
      now = new Date();
    for (const i of invoices) {
      const key = `${i.partyType}:${i.partyId}`,
        row = map.get(key) ?? {
          partyType: i.partyType,
          partyId: i.partyId,
          partyName: i.supplier?.companyName ?? i.vendor?.companyName,
          outstanding: new Prisma.Decimal(0),
          overdue: new Prisma.Decimal(0),
          invoiceCount: 0,
        };
      row.outstanding = row.outstanding.plus(i.outstandingAmount);
      if (i.dueDate < now && i.outstandingAmount.gt(0))
        row.overdue = row.overdue.plus(i.outstandingAmount);
      row.invoiceCount++;
      map.set(key, row);
    }
    return [...map.values()].map((r) => ({
      ...r,
      outstanding: r.outstanding.toString(),
      overdue: r.overdue.toString(),
    }));
  }
  async poCommitments(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const orders = await this.prisma.purchaseOrder.findMany({
      where: {
        status: {
          in: ['ISSUED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED'],
        },
      },
      include: {
        supplier: true,
        vendor: true,
        lines: { include: { grnLines: true } },
        apInvoices: {
          where: {
            status: {
              notIn: [ApInvoiceStatus.CANCELLED, ApInvoiceStatus.REJECTED],
            },
          },
        },
      },
      orderBy: { issuedAt: 'desc' },
    });
    return orders.map((po) => {
      const ordered = po.lines.reduce(
        (sum, line) => sum.plus(line.lineTotal),
        new Prisma.Decimal(0),
      );
      const received = po.lines.reduce(
        (sum, line) =>
          sum.plus(
            line.grnLines.reduce(
              (lineSum, grn) =>
                lineSum.plus(
                  (grn.acceptedQuantity ?? new Prisma.Decimal(0)).times(
                    line.unitPrice,
                  ),
                ),
              new Prisma.Decimal(0),
            ),
          ),
        new Prisma.Decimal(0),
      );
      const billed = po.apInvoices.reduce(
        (sum, invoice) =>
          sum.plus(
            invoice.taxableAmount
              .plus(invoice.otherCharges)
              .times(invoice.exchangeRateToInr),
          ),
        new Prisma.Decimal(0),
      );
      return {
        id: po.id,
        poNumber: po.poNumber,
        partyName: po.supplier?.companyName ?? po.vendor?.companyName,
        status: po.status,
        issuedAt: po.issuedAt,
        expectedDeliveryDate: po.expectedDeliveryDate,
        orderedValue: ordered.toString(),
        acceptedValue: received.toString(),
        billedValue: billed.toString(),
        unreceivedCommitment: Prisma.Decimal.max(
          ordered.minus(received),
          0,
        ).toString(),
        unbilledCommitment: Prisma.Decimal.max(
          ordered.minus(billed),
          0,
        ).toString(),
      };
    });
  }
  async calendar(from: string, to: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const gte = this.day(from),
      lte = new Date(`${to.slice(0, 10)}T23:59:59.999Z`);
    const [receivables, payables, payments] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where: {
          dueDate: { gte, lte },
          status: {
            in: [
              SalesInvoiceStatus.ISSUED,
              SalesInvoiceStatus.PARTIALLY_PAID,
              SalesInvoiceStatus.OVERDUE,
            ],
          },
        },
        include: { customer: true },
      }),
      this.prisma.accountsPayableInvoice.findMany({
        where: {
          dueDate: { gte, lte },
          status: {
            in: [
              ApInvoiceStatus.APPROVED,
              ApInvoiceStatus.PARTIALLY_PAID,
              ApInvoiceStatus.DISPUTED,
            ],
          },
        },
        include: { supplier: true, vendor: true },
      }),
      this.prisma.accountsPayablePayment.findMany({
        where: {
          plannedDate: { gte, lte },
          status: {
            in: [ApPaymentStatus.PENDING_APPROVAL, ApPaymentStatus.APPROVED],
          },
        },
        include: { supplier: true, vendor: true },
      }),
    ]);
    return {
      receivables: receivables.map((i) => ({
        date: i.dueDate,
        type: 'AR_DUE',
        party: i.customer.name,
        amount: i.outstandingAmount.toString(),
        reference: i.invoiceNumber,
      })),
      payables: payables.map((i) => ({
        date: i.dueDate,
        type: 'AP_DUE',
        party: i.supplier?.companyName ?? i.vendor?.companyName,
        amount: i.outstandingAmount.toString(),
        reference: i.internalBillNumber,
      })),
      plannedPayments: payments.map((p) => ({
        date: p.plannedDate,
        type: 'PAYMENT',
        party: p.supplier?.companyName ?? p.vendor?.companyName,
        amount: p.amount.toString(),
        reference: p.paymentNumber,
        status: p.status,
      })),
    };
  }
  private async postInvoice(
    i: any,
    override: string | undefined,
    approverId: string,
  ) {
    const rate = i.exchangeRateToInr;
    return this.prisma.$transaction(async (tx) => {
      const period = await this.period(tx, i.invoiceDate),
        jn = await this.number(
          tx,
          'JOURNAL',
          'JV',
          i.invoiceDate.getUTCFullYear(),
        ),
        debit = await this.account(tx, i.purchaseOrderId ? '1200' : '6100'),
        gst = await this.account(tx, '1300'),
        ap = await this.account(tx, '2000'),
        tds = await this.account(tx, '2200');
      const taxable = i.taxableAmount
          .plus(i.otherCharges)
          .times(rate)
          .toDecimalPlaces(2),
        tax = i.inputCgstAmount
          .plus(i.inputSgstAmount)
          .plus(i.inputIgstAmount)
          .times(rate)
          .toDecimalPlaces(2),
        payable = i.outstandingAmount.times(rate).toDecimalPlaces(2),
        tdsValue = i.tdsAmount.times(rate).toDecimalPlaces(2);
      const lines: any[] = [
        { sequence: 1, accountId: debit.id, debit: taxable, credit: 0 },
      ];
      if (tax.gt(0))
        lines.push({
          sequence: lines.length + 1,
          accountId: gst.id,
          debit: tax,
          credit: 0,
        });
      lines.push({
        sequence: lines.length + 1,
        accountId: ap.id,
        debit: 0,
        credit: payable,
      });
      if (tdsValue.gt(0))
        lines.push({
          sequence: lines.length + 1,
          accountId: tds.id,
          debit: 0,
          credit: tdsValue,
        });
      const j = await tx.journalEntry.create({
        data: {
          journalNumber: jn,
          entryDate: i.invoiceDate,
          periodId: period.id,
          description: `AP invoice ${i.internalBillNumber}`,
          reference: i.externalInvoiceNumber,
          status: JournalStatus.POSTED,
          createdById: i.createdById,
          submittedById: i.submittedById,
          submittedAt: i.submittedAt,
          approvedById: approverId,
          approvedAt: new Date(),
          lines: { create: lines },
        },
      });
      return tx.accountsPayableInvoice.update({
        where: { id: i.id },
        data: {
          status: ApInvoiceStatus.APPROVED,
          approvedById: approverId,
          approvedAt: new Date(),
          matchOverrideReason: override,
          journalEntryId: j.id,
        },
        include: AP_INCLUDE,
      });
    });
  }
  private async postPayment(p: any, dto: ExecutePaymentDto, actorId: string) {
    const rate = p.exchangeRateToInr;
    return this.prisma.$transaction(async (tx) => {
      const date = this.day(dto.executedDate),
        period = await this.period(tx, date),
        jn = await this.number(tx, 'JOURNAL', 'JV', date.getUTCFullYear()),
        ap = await this.account(tx, '2000'),
        bank = await this.account(tx, '1000'),
        advance = await this.account(tx, '1500');
      const allocated = p.allocations.reduce(
          (s: any, a: any) => s.plus(a.amount),
          new Prisma.Decimal(0),
        ),
        apCarrying = p.allocations.reduce(
          (s: any, a: any) => s.plus(a.amount.times(a.invoice.exchangeRateToInr)),
          new Prisma.Decimal(0),
        ),
        unapplied = p.amount.minus(allocated),
        lines: any[] = [];
      if (allocated.gt(0))
        lines.push({
          sequence: lines.length + 1,
          accountId: ap.id,
          debit: apCarrying,
          credit: 0,
        });
      if (unapplied.gt(0))
        lines.push({
          sequence: lines.length + 1,
          accountId: advance.id,
          debit: unapplied.times(rate),
          credit: 0,
        });
      lines.push({
        sequence: lines.length + 1,
        accountId: bank.id,
        debit: 0,
        credit: p.amount.times(rate),
      });
      const realizedFx = apCarrying.minus(allocated.times(rate)).toDecimalPlaces(2);
      if (!realizedFx.isZero()) {
        const settings = await tx.financeFxSettings.findUnique({ where: { id: 'INDIA' } });
        if (!settings) throw new BadRequestException('Configure realized FX gain/loss accounts before posting this foreign-currency payment');
        lines.push(realizedFx.gt(0)
          ? { sequence: lines.length + 1, accountId: settings.gainAccountId, debit: 0, credit: realizedFx }
          : { sequence: lines.length + 1, accountId: settings.lossAccountId, debit: realizedFx.abs(), credit: 0 });
      }
      const j = await tx.journalEntry.create({
        data: {
          journalNumber: jn,
          entryDate: date,
          periodId: period.id,
          description: `AP payment ${p.paymentNumber}`,
          reference: dto.bankReference,
          status: JournalStatus.POSTED,
          createdById: p.createdById,
          submittedById: p.submittedById,
          submittedAt: p.submittedAt,
          approvedById: p.approvedById,
          approvedAt: p.approvedAt,
          lines: { create: lines },
        },
      });
      for (const a of p.allocations) {
        const out = a.invoice.outstandingAmount.minus(a.amount);
        await tx.accountsPayableInvoice.update({
          where: { id: a.invoiceId },
          data: {
            paidAmount: { increment: a.amount },
            outstandingAmount: out,
            status: out.lte(0)
              ? ApInvoiceStatus.PAID
              : ApInvoiceStatus.PARTIALLY_PAID,
          },
        });
      }
      return tx.accountsPayablePayment.update({
        where: { id: p.id },
        data: {
          status: ApPaymentStatus.EXECUTED,
          executedDate: date,
          bankReference: dto.bankReference,
          journalEntryId: j.id,
        },
      });
    });
  }
  private party(s?: string, v?: string) {
    if (!!s === !!v)
      throw new BadRequestException('Select exactly one Supplier or Vendor');
    return s
      ? { type: PayablePartyType.SUPPLIER, id: s }
      : { type: PayablePartyType.VENDOR, id: v! };
  }
  private currency(code: string, rate?: number) {
    const currency = code.toUpperCase();
    if (!['INR', 'USD', 'CAD', 'EUR'].includes(currency))
      throw new BadRequestException('Unsupported currency');
    if (currency !== 'INR' && (!rate || rate <= 0))
      throw new BadRequestException(
        'A positive INR exchange rate is required for foreign currency',
      );
    return currency;
  }
  private async assertParty(p: { type: PayablePartyType; id: string }) {
    const found =
      p.type === PayablePartyType.SUPPLIER
        ? await this.prisma.supplier.findUnique({ where: { id: p.id } })
        : await this.prisma.vendor.findUnique({ where: { id: p.id } });
    if (!found) throw new NotFoundException('Supplier/Vendor not found');
  }
  private async invoice(id: string) {
    const i = await this.prisma.accountsPayableInvoice.findUnique({
      where: { id },
      include: AP_INCLUDE,
    });
    if (!i) throw new NotFoundException('AP invoice not found');
    return i;
  }
  private async payment(id: string) {
    const p = await this.prisma.accountsPayablePayment.findUnique({
      where: { id },
    });
    if (!p) throw new NotFoundException('Payment not found');
    return p;
  }
  private async number(
    tx: Prisma.TransactionClient,
    e: string,
    p: string,
    y: number,
  ) {
    const s = await tx.financeSequence.upsert({
      where: { entity_year: { entity: e, year: y } },
      create: { entity: e, year: y, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `${p}-${y}-${String(s.lastValue).padStart(5, '0')}`;
  }
  private async period(tx: Prisma.TransactionClient, d: Date) {
    const p = await tx.accountingPeriod.findFirst({
      where: {
        startsOn: { lte: d },
        endsOn: { gte: d },
        status: AccountingPeriodStatus.OPEN,
      },
    });
    if (!p)
      throw new BadRequestException(
        'No open accounting period covers the transaction date',
      );
    return p;
  }
  private async account(tx: Prisma.TransactionClient, c: string) {
    const settings = await tx.financeProductionSettings.findUnique({ where: { id: 'INDIA' } });
    const mapped = (settings?.controlAccountMap as Record<string, string> | null)?.[c] || c;
    const a = await tx.ledgerAccount.findUnique({ where: { code: mapped } });
    if (!a?.isActive)
      throw new BadRequestException(
        `Required ledger account ${mapped} is missing or inactive`,
      );
    return a;
  }
  private day(v: string) {
    return new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
  }
}
