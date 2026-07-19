import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountingPeriodStatus,
  GstDocumentType,
  GstSubmissionStatus,
  JournalStatus,
  Prisma,
  ReceiptStatus,
  SalesInvoiceStatus,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { FinanceAccessService } from '../finance/finance-access.service';
import {
  CompanySettingsDto,
  CreateCustomerReceiptDto,
  CreateMilestoneDto,
  CreateSalesInvoiceDto,
  GenerateEwayBillDto,
} from './dto/ar.dto';
import { GstGatewayService } from './gst-gateway.service';

const INVOICE_INCLUDE = {
  customer: true,
  order: true,
  milestone: true,
  lines: { include: { product: true }, orderBy: { sequence: 'asc' as const } },
  gstSubmissions: { orderBy: { createdAt: 'desc' as const } },
};

@Injectable()
export class ArService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FinanceAccessService,
    private readonly gst: GstGatewayService,
  ) {}

  async settings(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.financeCompanySettings.findUnique({
      where: { id: 'INDIA' },
    });
  }
  async gstReadiness(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.gst.readiness();
  }
  async customers(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.customer.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
  }
  async orders(customerId: string | undefined, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.order.findMany({
      where: customerId ? { customerId } : {},
      include: { customer: true, lineItems: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
  async saveSettings(dto: CompanySettingsDto, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    return this.prisma.financeCompanySettings.upsert({
      where: { id: 'INDIA' },
      update: dto,
      create: { id: 'INDIA', ...dto },
    });
  }

  async createMilestone(
    orderId: string,
    dto: CreateMilestoneDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertCanUseFinance(user);
    if ((dto.percentage == null) === (dto.fixedAmount == null))
      throw new BadRequestException(
        'Provide exactly one of percentage or fixedAmount',
      );
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { billingMilestones: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const newAmount =
      dto.fixedAmount ??
      (Number(order.totalAmount) * Number(dto.percentage)) / 100;
    const existing = order.billingMilestones
      .filter((m) => m.status !== 'CANCELLED')
      .reduce(
        (sum, m) =>
          sum +
          Number(
            m.fixedAmount ??
              (Number(order.totalAmount) * Number(m.percentage)) / 100,
          ),
        0,
      );
    if (existing + newAmount > Number(order.totalAmount) + 0.01)
      throw new BadRequestException(
        'Billing milestones cannot exceed the order value',
      );
    return this.prisma.billingMilestone.create({
      data: {
        orderId,
        ...dto,
        plannedDate: dto.plannedDate ? this.day(dto.plannedDate) : undefined,
        createdById: user.id,
      },
    });
  }
  async milestones(orderId: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.prisma.billingMilestone.findMany({
      where: { orderId },
      orderBy: { sequence: 'asc' },
    });
  }

  async createInvoice(dto: CreateSalesInvoiceDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (dto.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: dto.orderId },
      });
      if (!order || order.customerId !== customer.id)
        throw new BadRequestException(
          'Order does not belong to the selected customer',
        );
    }
    if (dto.milestoneId) {
      const milestone = await this.prisma.billingMilestone.findUnique({
        where: { id: dto.milestoneId },
      });
      if (
        !milestone ||
        milestone.orderId !== dto.orderId ||
        milestone.status === 'INVOICED'
      )
        throw new BadRequestException(
          'Milestone is unavailable for this order',
        );
    }
    const currency = dto.currencyCode.toUpperCase();
    if (!['INR', 'USD', 'CAD', 'EUR'].includes(currency))
      throw new BadRequestException('Unsupported currency');
    if (
      currency !== 'INR' &&
      (!dto.exchangeRateToInr || dto.exchangeRateToInr <= 0)
    )
      throw new BadRequestException(
        'A positive INR exchange rate is required for foreign-currency invoices',
      );
    const lines = dto.lines.map((line, index) =>
      this.calculateLine(line, index),
    );
    const subtotal = lines
      .reduce(
        (s, l) => s.plus(l.quantity.times(l.unitPrice)),
        new Prisma.Decimal(0),
      )
      .toDecimalPlaces(2);
    const taxable = lines.reduce(
      (s, l) => s.plus(l.taxableAmount),
      new Prisma.Decimal(0),
    );
    const cgst = lines.reduce(
      (s, l) => s.plus(l.cgstAmount),
      new Prisma.Decimal(0),
    );
    const sgst = lines.reduce(
      (s, l) => s.plus(l.sgstAmount),
      new Prisma.Decimal(0),
    );
    const igst = lines.reduce(
      (s, l) => s.plus(l.igstAmount),
      new Prisma.Decimal(0),
    );
    const discount = subtotal.minus(taxable);
    const other = new Prisma.Decimal(dto.otherCharges ?? 0);
    const roundOff = new Prisma.Decimal(dto.roundOff ?? 0);
    const total = taxable
      .plus(cgst)
      .plus(sgst)
      .plus(igst)
      .plus(other)
      .plus(roundOff)
      .toDecimalPlaces(2);
    const invoiceDate = this.day(dto.invoiceDate);
    const dueDate = this.day(dto.dueDate);
    if (dueDate < invoiceDate)
      throw new BadRequestException('Due date cannot precede invoice date');
    return this.prisma.$transaction(async (tx) => {
      const number = await this.number(
        tx,
        'SALES_INVOICE',
        'INV',
        invoiceDate.getUTCFullYear(),
      );
      return tx.salesInvoice.create({
        data: {
          invoiceNumber: number,
          invoiceDate,
          dueDate,
          customerId: customer.id,
          orderId: dto.orderId,
          milestoneId: dto.milestoneId,
          customerPoReference: dto.customerPoReference,
          currencyCode: currency,
          exchangeRateToInr: dto.exchangeRateToInr ?? 1,
          billingAddressSnapshot:
            customer.billingAddress as Prisma.InputJsonValue,
          shippingAddressSnapshot: (customer.shippingAddress ??
            customer.billingAddress) as Prisma.InputJsonValue,
          customerGstinSnapshot: customer.gstin,
          placeOfSupplyState: dto.placeOfSupplyState,
          placeOfSupplyStateCode: dto.placeOfSupplyStateCode,
          subtotal,
          discountAmount: discount,
          taxableAmount: taxable,
          cgstAmount: cgst,
          sgstAmount: sgst,
          igstAmount: igst,
          otherCharges: other,
          roundOff,
          totalAmount: total,
          outstandingAmount: total,
          paymentTerms: dto.paymentTerms,
          createdById: user.id,
          lines: { create: lines },
        },
        include: INVOICE_INCLUDE,
      });
    });
  }

  async invoices(query: PaginationQueryDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.salesInvoice.findMany({
        include: INVOICE_INCLUDE,
        orderBy: { invoiceDate: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.salesInvoice.count(),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }
  async invoice(id: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    return this.findInvoice(id);
  }
  async submitInvoice(id: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const inv = await this.findInvoice(id);
    if (
      ![SalesInvoiceStatus.DRAFT, SalesInvoiceStatus.REJECTED].includes(
        inv.status as any,
      )
    )
      throw new BadRequestException(
        'Only draft or rejected invoices can be submitted',
      );
    await this.assertCreditControl(inv);
    return this.prisma.salesInvoice.update({
      where: { id },
      data: {
        status: SalesInvoiceStatus.PENDING_APPROVAL,
        submittedById: user.id,
        submittedAt: new Date(),
        rejectionComment: null,
      },
      include: INVOICE_INCLUDE,
    });
  }

  private async assertCreditControl(inv: any) {
    if (inv.creditOverrideApprovedById) return;
    const control = await this.prisma.customerCreditControl.findUnique({ where: { customerId: inv.customerId } });
    if (!control) return;
    const open = await this.prisma.salesInvoice.findMany({ where: { customerId: inv.customerId, id: { not: inv.id }, status: { in: [SalesInvoiceStatus.ISSUED, SalesInvoiceStatus.PARTIALLY_PAID, SalesInvoiceStatus.OVERDUE] } } });
    const exposure = open.reduce((s, x) => s.plus(x.outstandingAmount.times(x.exchangeRateToInr)), new Prisma.Decimal(0));
    const proposed = exposure.plus(inv.totalAmount.times(inv.exchangeRateToInr));
    if (control.blockOnLimit && proposed.gt(control.creditLimitInr)) throw new BadRequestException(`Customer credit limit exceeded: proposed exposure INR ${proposed.toFixed(2)} exceeds INR ${control.creditLimitInr.toFixed(2)}. Finance Head override is required.`);
    const cutoff = new Date(Date.now() - control.overdueGraceDays * 86400000);
    const overdue = open.some((x) => x.dueDate < cutoff && x.outstandingAmount.gt(0));
    if (control.blockOnOverdue && overdue) throw new BadRequestException('Customer has invoices beyond the permitted overdue grace period. Finance Head override is required.');
  }
  async rejectInvoice(id: string, comment: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const inv = await this.findInvoice(id);
    if (inv.status !== SalesInvoiceStatus.PENDING_APPROVAL)
      throw new BadRequestException('Only pending invoices can be rejected');
    return this.prisma.salesInvoice.update({
      where: { id },
      data: { status: SalesInvoiceStatus.REJECTED, rejectionComment: comment },
      include: INVOICE_INCLUDE,
    });
  }

  async approveInvoice(id: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const inv = await this.findInvoice(id);
    if (inv.status !== SalesInvoiceStatus.PENDING_APPROVAL)
      throw new BadRequestException('Only pending invoices can be approved');
    if (inv.createdById === user.id)
      throw new BadRequestException(
        'The Finance Head cannot approve an invoice they created',
      );
    const settings = await this.prisma.financeCompanySettings.findUnique({
      where: { id: 'INDIA' },
    });
    const requiresGst =
      !!settings?.eInvoiceEnabled && !!inv.customerGstinSnapshot;
    if (requiresGst) {
      const payload = this.gstPayload(inv, settings!);
      return this.prisma.$transaction(async (tx) => {
        await tx.gstSubmission.create({
          data: {
            documentType: GstDocumentType.TAX_INVOICE,
            invoiceId: id,
            idempotencyKey: `EINV:${inv.invoiceNumber}`,
            requestPayload: payload,
          },
        });
        return tx.salesInvoice.update({
          where: { id },
          data: {
            status: SalesInvoiceStatus.GST_PENDING,
            approvedById: user.id,
            approvedAt: new Date(),
          },
          include: INVOICE_INCLUDE,
        });
      });
    }
    return this.issueAndPost(id, user.id);
  }

  async queueEwayBill(
    id: string,
    dto: GenerateEwayBillDto,
    user: AuthenticatedUser,
  ) {
    await this.access.assertCanUseFinance(user);
    const inv = await this.findInvoice(id);
    if (
      ![
        SalesInvoiceStatus.ISSUED,
        SalesInvoiceStatus.PARTIALLY_PAID,
        SalesInvoiceStatus.PAID,
        SalesInvoiceStatus.OVERDUE,
      ].includes(inv.status as any)
    )
      throw new BadRequestException('An e-way bill requires an issued invoice');
    if (inv.eWayBillNumber)
      throw new BadRequestException('This invoice already has an e-way bill');
    const payload = {
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
      fromGstin: (
        await this.prisma.financeCompanySettings.findUnique({
          where: { id: 'INDIA' },
        })
      )?.gstin,
      toGstin: inv.customerGstinSnapshot,
      placeOfSupply: inv.placeOfSupplyStateCode,
      totalValue: inv.totalAmount.toString(),
      items: inv.lines.map((l) => ({
        hsn: l.hsnSacCode,
        description: l.description,
        quantity: l.quantity.toString(),
        unit: l.unitOfMeasure,
        taxableValue: l.taxableAmount.toString(),
      })),
      transport: { ...dto },
    };
    return this.prisma.gstSubmission.create({
      data: {
        documentType: GstDocumentType.EWAY_BILL,
        invoiceId: id,
        idempotencyKey: `EWB:${inv.invoiceNumber}`,
        requestPayload: payload,
      },
    });
  }

  async processGst(submissionId: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const submission = await this.prisma.gstSubmission.findUnique({
      where: { id: submissionId },
    });
    if (!submission) throw new NotFoundException('GST submission not found');
    if (
      ![GstSubmissionStatus.PENDING, GstSubmissionStatus.FAILED].includes(
        submission.status as any,
      )
    )
      throw new BadRequestException('GST submission is not retryable');
    const controls = await this.prisma.financeProductionSettings.findUnique({
      where: { id: 'INDIA' },
    });
    const maxAttempts = controls?.gstMaxAttempts ?? 5;
    const retryDelay = controls?.gstRetryDelayMinutes ?? 15;
    if (submission.attemptCount >= maxAttempts)
      throw new BadRequestException(
        `GST submission reached the configured limit of ${maxAttempts} attempts`,
      );
    if (
      submission.status === GstSubmissionStatus.FAILED &&
      submission.lastAttemptAt &&
      Date.now() - submission.lastAttemptAt.getTime() < retryDelay * 60000
    )
      throw new BadRequestException(
        `Wait ${retryDelay} minutes before retrying this GST submission`,
      );
    await this.prisma.gstSubmission.update({
      where: { id: submissionId },
      data: {
        status: GstSubmissionStatus.PROCESSING,
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
    try {
      const result = await this.gst.submit(
        submission.documentType,
        submission.requestPayload,
        submission.idempotencyKey,
      );
      if (
        submission.documentType === GstDocumentType.TAX_INVOICE &&
        (!result.irn ||
          !result.acknowledgementNumber ||
          !result.acknowledgementDate ||
          !result.signedQrCode)
      ) {
        throw new BadRequestException(
          'GST gateway response is missing mandatory e-invoice fields',
        );
      }
      if (
        submission.documentType === GstDocumentType.EWAY_BILL &&
        !result.eWayBillNumber
      ) {
        throw new BadRequestException(
          'GST gateway response is missing the e-way bill number',
        );
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.gstSubmission.update({
          where: { id: submissionId },
          data: {
            status: GstSubmissionStatus.SUCCEEDED,
            responsePayload: result.raw,
            errorCode: null,
            errorMessage: null,
          },
        });
        await tx.salesInvoice.update({
          where: { id: submission.invoiceId },
          data: {
            irn: result.irn,
            irnAcknowledgementNumber: result.acknowledgementNumber,
            irnAcknowledgementDate: result.acknowledgementDate
              ? new Date(result.acknowledgementDate)
              : undefined,
            signedQrCode: result.signedQrCode,
            eWayBillNumber: result.eWayBillNumber,
            eWayBillGeneratedAt: result.eWayBillGeneratedAt
              ? new Date(result.eWayBillGeneratedAt)
              : undefined,
            eWayBillValidUntil: result.eWayBillValidUntil
              ? new Date(result.eWayBillValidUntil)
              : undefined,
          },
        });
      });
      return submission.documentType === GstDocumentType.TAX_INVOICE
        ? this.issueAndPost(submission.invoiceId, user.id)
        : this.findInvoice(submission.invoiceId);
    } catch (error) {
      await this.prisma.gstSubmission.update({
        where: { id: submissionId },
        data: {
          status: GstSubmissionStatus.FAILED,
          errorMessage:
            error instanceof Error ? error.message : 'GST gateway failure',
        },
      });
      throw error;
    }
  }

  async cancelGst(submissionId: string, reason: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    if (!reason?.trim()) throw new BadRequestException('A GST cancellation reason is required');
    const submission = await this.prisma.gstSubmission.findUnique({ where: { id: submissionId }, include: { invoice: true } });
    if (!submission) throw new NotFoundException('GST submission not found');
    if (submission.status !== GstSubmissionStatus.SUCCEEDED) throw new BadRequestException('Only a successful GST submission can be cancelled');
    if (submission.documentType === GstDocumentType.TAX_INVOICE && submission.invoice.eWayBillNumber) throw new BadRequestException('Cancel the linked e-way bill before cancelling the e-invoice');
    const generatedAt = submission.documentType === GstDocumentType.TAX_INVOICE ? submission.invoice.irnAcknowledgementDate : submission.invoice.eWayBillGeneratedAt;
    if (!generatedAt || Date.now() - generatedAt.getTime() > 24 * 60 * 60 * 1000) throw new BadRequestException('The 24-hour GST portal cancellation window has elapsed');
    const reference = submission.documentType === GstDocumentType.TAX_INVOICE ? submission.invoice.irn : submission.invoice.eWayBillNumber;
    if (!reference) throw new BadRequestException('The provider reference required for cancellation is missing');
    const result = await this.gst.cancel(submission.documentType, reference, reason.trim(), `CANCEL:${submission.id}`);
    await this.prisma.$transaction([
      this.prisma.gstSubmission.update({ where: { id: submission.id }, data: { status: GstSubmissionStatus.CANCELLED, responsePayload: result.raw, errorMessage: null } }),
      this.prisma.salesInvoice.update({ where: { id: submission.invoiceId }, data: submission.documentType === GstDocumentType.TAX_INVOICE ? { irn: null, irnAcknowledgementNumber: null, irnAcknowledgementDate: null, signedQrCode: null } : { eWayBillNumber: null, eWayBillGeneratedAt: null, eWayBillValidUntil: null } }),
    ]);
    return this.findInvoice(submission.invoiceId);
  }

  async createReceipt(dto: CreateCustomerReceiptDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const allocations = dto.allocations ?? [];
    const invoiceIds = allocations.map((a) => a.invoiceId);
    const invoices = await this.prisma.salesInvoice.findMany({
      where: { id: { in: invoiceIds } },
    });
    const openStatuses = new Set<SalesInvoiceStatus>([
      SalesInvoiceStatus.ISSUED,
      SalesInvoiceStatus.PARTIALLY_PAID,
      SalesInvoiceStatus.OVERDUE,
    ]);
    if (
      invoices.some(
        (i) => i.customerId !== dto.customerId || !openStatuses.has(i.status),
      )
    )
      throw new BadRequestException(
        'Allocations must reference open invoices for the same customer',
      );
    for (const allocation of allocations) {
      const invoice = invoices.find((i) => i.id === allocation.invoiceId)!;
      if (new Prisma.Decimal(allocation.amount).gt(invoice.outstandingAmount))
        throw new BadRequestException(
          `Allocation exceeds ${invoice.invoiceNumber} outstanding amount`,
        );
    }
    const settled = new Prisma.Decimal(dto.amount).plus(dto.tdsDeducted ?? 0);
    const allocated = allocations.reduce(
      (s, a) => s.plus(a.amount),
      new Prisma.Decimal(0),
    );
    if (allocated.gt(settled))
      throw new BadRequestException(
        'Allocations exceed receipt plus TDS amount',
      );
    const receiptDate = this.day(dto.receiptDate);
    return this.prisma.$transaction(async (tx) => {
      const number = await this.number(
        tx,
        'CUSTOMER_RECEIPT',
        'RCT',
        receiptDate.getUTCFullYear(),
      );
      return tx.customerReceipt.create({
        data: {
          receiptNumber: number,
          receiptDate,
          customerId: dto.customerId,
          currencyCode: dto.currencyCode.toUpperCase(),
          exchangeRateToInr: dto.exchangeRateToInr ?? 1,
          amount: dto.amount,
          tdsDeducted: dto.tdsDeducted ?? 0,
          bankCharges: dto.bankCharges ?? 0,
          unappliedAmount: settled.minus(allocated),
          paymentMethod: dto.paymentMethod,
          bankReference: dto.bankReference,
          notes: dto.notes,
          createdById: user.id,
          allocations: { create: allocations },
        },
        include: {
          customer: true,
          allocations: { include: { invoice: true } },
        },
      });
    });
  }
  async receipts(query: PaginationQueryDto, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customerReceipt.findMany({
        include: {
          customer: true,
          allocations: { include: { invoice: true } },
        },
        orderBy: { receiptDate: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.customerReceipt.count(),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }
  async submitReceipt(id: string, user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const r = await this.prisma.customerReceipt.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Receipt not found');
    if (
      ![ReceiptStatus.DRAFT, ReceiptStatus.REJECTED].includes(r.status as any)
    )
      throw new BadRequestException(
        'Only draft or rejected receipts can be submitted',
      );
    return this.prisma.customerReceipt.update({
      where: { id },
      data: {
        status: ReceiptStatus.PENDING_APPROVAL,
        submittedById: user.id,
        submittedAt: new Date(),
        rejectionComment: null,
      },
    });
  }
  async approveReceipt(id: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const receipt = await this.prisma.customerReceipt.findUnique({
      where: { id },
      include: { allocations: { include: { invoice: true } } },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    if (receipt.status !== ReceiptStatus.PENDING_APPROVAL)
      throw new BadRequestException('Only pending receipts can be approved');
    if (receipt.createdById === user.id)
      throw new BadRequestException(
        'The Finance Head cannot approve a receipt they created',
      );
    return this.postReceipt(receipt, user.id);
  }
  async rejectReceipt(id: string, comment: string, user: AuthenticatedUser) {
    await this.access.assertAccountsHead(user);
    const r = await this.prisma.customerReceipt.findUnique({ where: { id } });
    if (!r || r.status !== ReceiptStatus.PENDING_APPROVAL)
      throw new BadRequestException('Only pending receipts can be rejected');
    return this.prisma.customerReceipt.update({
      where: { id },
      data: { status: ReceiptStatus.REJECTED, rejectionComment: comment },
    });
  }

  async arSummary(user: AuthenticatedUser) {
    await this.access.assertCanUseFinance(user);
    const customers = await this.prisma.customer.findMany({
      where: {
        salesInvoices: {
          some: {
            status: {
              in: [
                SalesInvoiceStatus.ISSUED,
                SalesInvoiceStatus.PARTIALLY_PAID,
                SalesInvoiceStatus.PAID,
                SalesInvoiceStatus.OVERDUE,
              ],
            },
          },
        },
      },
      include: {
        salesInvoices: {
          where: {
            status: {
              in: [
                SalesInvoiceStatus.ISSUED,
                SalesInvoiceStatus.PARTIALLY_PAID,
                SalesInvoiceStatus.PAID,
                SalesInvoiceStatus.OVERDUE,
              ],
            },
          },
        },
        customerReceipts: { where: { status: ReceiptStatus.POSTED } },
      },
    });
    const now = new Date();
    return customers.map((c) => {
      let outstanding = new Prisma.Decimal(0),
        overdue = new Prisma.Decimal(0);
      const buckets = {
        current: new Prisma.Decimal(0),
        days1To30: new Prisma.Decimal(0),
        days31To60: new Prisma.Decimal(0),
        days61To90: new Prisma.Decimal(0),
        days91To180: new Prisma.Decimal(0),
        over180: new Prisma.Decimal(0),
      };
      for (const i of c.salesInvoices) {
        outstanding = outstanding.plus(i.outstandingAmount);
        if (i.outstandingAmount.lte(0)) continue;
        const days = Math.floor(
          (now.getTime() - i.dueDate.getTime()) / 86400000,
        );
        if (days <= 0)
          buckets.current = buckets.current.plus(i.outstandingAmount);
        else {
          overdue = overdue.plus(i.outstandingAmount);
          if (days <= 30)
            buckets.days1To30 = buckets.days1To30.plus(i.outstandingAmount);
          else if (days <= 60)
            buckets.days31To60 = buckets.days31To60.plus(i.outstandingAmount);
          else if (days <= 90)
            buckets.days61To90 = buckets.days61To90.plus(i.outstandingAmount);
          else if (days <= 180)
            buckets.days91To180 = buckets.days91To180.plus(i.outstandingAmount);
          else buckets.over180 = buckets.over180.plus(i.outstandingAmount);
        }
      }
      const advances = c.customerReceipts.reduce(
        (s, r) => s.plus(r.unappliedAmount),
        new Prisma.Decimal(0),
      );
      return {
        customerId: c.id,
        customerName: c.name,
        outstanding: outstanding.toString(),
        overdue: overdue.toString(),
        advances: advances.toString(),
        aging: Object.fromEntries(
          Object.entries(buckets).map(([k, v]) => [k, v.toString()]),
        ),
      };
    });
  }

  private calculateLine(line: any, index: number) {
    const quantity = new Prisma.Decimal(line.quantity),
      unitPrice = new Prisma.Decimal(line.unitPrice),
      discount = new Prisma.Decimal(line.discountPercent ?? 0);
    const taxable = quantity
      .times(unitPrice)
      .times(new Prisma.Decimal(1).minus(discount.div(100)))
      .toDecimalPlaces(2);
    const cgstRate = new Prisma.Decimal(line.cgstRate ?? 0),
      sgstRate = new Prisma.Decimal(line.sgstRate ?? 0),
      igstRate = new Prisma.Decimal(line.igstRate ?? 0);
    if (igstRate.gt(0) && (cgstRate.gt(0) || sgstRate.gt(0)))
      throw new BadRequestException(
        'A line cannot contain both IGST and CGST/SGST',
      );
    if (!cgstRate.equals(sgstRate))
      throw new BadRequestException('CGST and SGST rates must be equal');
    const cgst = taxable.times(cgstRate).div(100).toDecimalPlaces(2),
      sgst = taxable.times(sgstRate).div(100).toDecimalPlaces(2),
      igst = taxable.times(igstRate).div(100).toDecimalPlaces(2);
    return {
      sequence: index + 1,
      productId: line.productId,
      description: line.description,
      hsnSacCode: line.hsnSacCode,
      quantity,
      unitOfMeasure: line.unitOfMeasure,
      unitPrice,
      discountPercent: discount,
      taxableAmount: taxable,
      cgstRate,
      cgstAmount: cgst,
      sgstRate,
      sgstAmount: sgst,
      igstRate,
      igstAmount: igst,
      lineTotal: taxable.plus(cgst).plus(sgst).plus(igst),
    };
  }
  private async issueAndPost(id: string, approverId: string) {
    const inv = await this.findInvoice(id);
    const rate = inv.exchangeRateToInr;
    return this.prisma.$transaction(async (tx) => {
      const period = await this.period(tx, inv.invoiceDate);
      const jn = await this.number(
        tx,
        'JOURNAL',
        'JV',
        inv.invoiceDate.getUTCFullYear(),
      );
      const ar = await this.account(tx, '1100'),
        revenue = await this.account(tx, '4000'),
        gst = await this.account(tx, '2100');
      const total = inv.totalAmount.times(rate).toDecimalPlaces(2),
        tax = inv.cgstAmount
          .plus(inv.sgstAmount)
          .plus(inv.igstAmount)
          .times(rate)
          .toDecimalPlaces(2);
      const journal = await tx.journalEntry.create({
        data: {
          journalNumber: jn,
          entryDate: inv.invoiceDate,
          periodId: period.id,
          description: `Sales invoice ${inv.invoiceNumber}`,
          reference: inv.invoiceNumber,
          status: JournalStatus.POSTED,
          createdById: inv.createdById,
          submittedById: inv.submittedById,
          submittedAt: inv.submittedAt,
          approvedById: approverId,
          approvedAt: new Date(),
          lines: {
            create: [
              { sequence: 1, accountId: ar.id, debit: total, credit: 0 },
              {
                sequence: 2,
                accountId: revenue.id,
                debit: 0,
                credit: total.minus(tax),
              },
              { sequence: 3, accountId: gst.id, debit: 0, credit: tax },
            ].filter(
              (l) =>
                new Prisma.Decimal(l.debit).gt(0) ||
                new Prisma.Decimal(l.credit).gt(0),
            ),
          },
        },
      });
      if (inv.milestoneId)
        await tx.billingMilestone.update({
          where: { id: inv.milestoneId },
          data: { status: 'INVOICED' },
        });
      return tx.salesInvoice.update({
        where: { id },
        data: {
          status: SalesInvoiceStatus.ISSUED,
          approvedById: approverId,
          approvedAt: inv.approvedAt ?? new Date(),
          issuedAt: new Date(),
          journalEntryId: journal.id,
        },
        include: INVOICE_INCLUDE,
      });
    });
  }
  private async postReceipt(receipt: any, approverId: string) {
    const rate = receipt.exchangeRateToInr;
    return this.prisma.$transaction(async (tx) => {
      const period = await this.period(tx, receipt.receiptDate);
      const jn = await this.number(
        tx,
        'JOURNAL',
        'JV',
        receipt.receiptDate.getUTCFullYear(),
      );
      const bank = await this.account(tx, '1000'),
        ar = await this.account(tx, '1100'),
        adv = await this.account(tx, '2300'),
        tds = receipt.tdsDeducted.gt(0) ? await this.account(tx, '1400') : null,
        expense = receipt.bankCharges.gt(0)
          ? await this.account(tx, '6100')
          : null;
      const lines: any[] = [];
      const bankNet = receipt.amount
        .minus(receipt.bankCharges)
        .times(rate)
        .toDecimalPlaces(2);
      if (bankNet.gt(0))
        lines.push({
          sequence: lines.length + 1,
          accountId: bank.id,
          debit: bankNet,
          credit: 0,
        });
      if (receipt.bankCharges.gt(0))
        lines.push({
          sequence: lines.length + 1,
          accountId: expense!.id,
          debit: receipt.bankCharges.times(rate),
          credit: 0,
        });
      if (receipt.tdsDeducted.gt(0))
        lines.push({
          sequence: lines.length + 1,
          accountId: tds!.id,
          debit: receipt.tdsDeducted.times(rate),
          credit: 0,
        });
      const allocated = receipt.allocations.reduce(
        (s: any, a: any) => s.plus(a.amount),
        new Prisma.Decimal(0),
      );
      const arCarrying = receipt.allocations.reduce(
        (s: any, a: any) =>
          s.plus(a.amount.times(a.invoice.exchangeRateToInr)),
        new Prisma.Decimal(0),
      );
      if (allocated.gt(0))
        lines.push({
          sequence: lines.length + 1,
          accountId: ar.id,
          debit: 0,
          credit: arCarrying,
        });
      if (receipt.unappliedAmount.gt(0))
        lines.push({
          sequence: lines.length + 1,
          accountId: adv.id,
          debit: 0,
          credit: receipt.unappliedAmount.times(rate),
        });
      const realizedFx = allocated.times(rate).minus(arCarrying).toDecimalPlaces(2);
      if (!realizedFx.isZero()) {
        const settings = await tx.financeFxSettings.findUnique({ where: { id: 'INDIA' } });
        if (!settings) throw new BadRequestException('Configure realized FX gain/loss accounts before posting this foreign-currency receipt');
        lines.push(realizedFx.gt(0)
          ? { sequence: lines.length + 1, accountId: settings.gainAccountId, debit: 0, credit: realizedFx }
          : { sequence: lines.length + 1, accountId: settings.lossAccountId, debit: realizedFx.abs(), credit: 0 });
      }
      const journal = await tx.journalEntry.create({
        data: {
          journalNumber: jn,
          entryDate: receipt.receiptDate,
          periodId: period.id,
          description: `Customer receipt ${receipt.receiptNumber}`,
          reference: receipt.bankReference,
          status: JournalStatus.POSTED,
          createdById: receipt.createdById,
          submittedById: receipt.submittedById,
          submittedAt: receipt.submittedAt,
          approvedById: approverId,
          approvedAt: new Date(),
          lines: { create: lines },
        },
      });
      for (const a of receipt.allocations) {
        const outstanding = a.invoice.outstandingAmount.minus(a.amount);
        await tx.salesInvoice.update({
          where: { id: a.invoiceId },
          data: {
            paidAmount: { increment: a.amount },
            outstandingAmount: outstanding,
            status: outstanding.lte(0)
              ? SalesInvoiceStatus.PAID
              : SalesInvoiceStatus.PARTIALLY_PAID,
          },
        });
      }
      return tx.customerReceipt.update({
        where: { id: receipt.id },
        data: {
          status: ReceiptStatus.POSTED,
          approvedById: approverId,
          approvedAt: new Date(),
          journalEntryId: journal.id,
        },
        include: { customer: true, allocations: true },
      });
    });
  }
  private gstPayload(inv: any, settings: any) {
    return {
      version: '1.1',
      supplier: {
        gstin: settings.gstin,
        legalName: settings.legalName,
        address1: settings.addressLine1,
        location: settings.city,
        pincode: settings.postalCode,
        stateCode: settings.stateCode,
      },
      recipient: {
        gstin: inv.customerGstinSnapshot,
        name: inv.customer.name,
        address: inv.billingAddressSnapshot,
        placeOfSupply: inv.placeOfSupplyStateCode,
      },
      document: {
        type: 'INV',
        number: inv.invoiceNumber,
        date: inv.invoiceDate.toISOString().slice(0, 10),
      },
      items: inv.lines.map((l: any) => ({
        serial: l.sequence,
        description: l.description,
        hsn: l.hsnSacCode,
        quantity: l.quantity.toString(),
        unit: l.unitOfMeasure,
        unitPrice: l.unitPrice.toString(),
        taxableValue: l.taxableAmount.toString(),
        cgstRate: l.cgstRate.toString(),
        sgstRate: l.sgstRate.toString(),
        igstRate: l.igstRate.toString(),
      })),
      values: {
        taxable: inv.taxableAmount.toString(),
        cgst: inv.cgstAmount.toString(),
        sgst: inv.sgstAmount.toString(),
        igst: inv.igstAmount.toString(),
        total: inv.totalAmount.toString(),
      },
    };
  }
  private async findInvoice(id: string) {
    const inv = await this.prisma.salesInvoice.findUnique({
      where: { id },
      include: INVOICE_INCLUDE,
    });
    if (!inv) throw new NotFoundException('Sales invoice not found');
    return inv;
  }
  private async number(
    tx: Prisma.TransactionClient,
    entity: string,
    prefix: string,
    year: number,
  ) {
    const seq = await tx.financeSequence.upsert({
      where: { entity_year: { entity, year } },
      create: { entity, year, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `${prefix}-${year}-${String(seq.lastValue).padStart(5, '0')}`;
  }
  private async period(tx: Prisma.TransactionClient, date: Date) {
    const p = await tx.accountingPeriod.findFirst({
      where: {
        startsOn: { lte: date },
        endsOn: { gte: date },
        status: AccountingPeriodStatus.OPEN,
      },
    });
    if (!p)
      throw new BadRequestException(
        'No open accounting period covers the transaction date',
      );
    return p;
  }
  private async account(tx: Prisma.TransactionClient, code: string) {
    const settings = await tx.financeProductionSettings.findUnique({ where: { id: 'INDIA' } });
    const mapped = (settings?.controlAccountMap as Record<string, string> | null)?.[code] || code;
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
