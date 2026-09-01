import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { EmailService } from '../../core/email/email.service';
import { EmailSendResultEntity } from '../../core/email/email-send.entity';
import { isValidEmailAddress } from '../../core/email/email-content';
import { resolveOrganisationName } from '../../core/email/organisation';
import { purchaseOrderIssuedEmail } from '../../core/email/templates/purchase-order-issued';
import { PdfService } from '../../core/pdf/pdf.service';
import { letterheadLogo } from '../../core/documents/letterhead';
import { formatIndianAmount } from '../../common/utils/indian-money.util';
import { PurchasingAccessService } from './purchasing-access.service';
import { EmailPurchaseOrderDto } from './dto/purchase-order.dto';
import {
  purchaseOrderFooterHtml,
  purchaseOrderPdfFileName,
  renderPurchaseOrderDocumentHtml,
  type PurchaseOrderDocumentData,
} from './purchase-order-document';

/**
 * Statuses a PO may be emailed in. A DRAFT is not yet an order and a
 * PENDING_CEO_APPROVAL one is an unapproved exception — mailing either would put
 * a commitment in front of a supplier that the business has not made. REJECTED
 * and CANCELLED are equally off-limits: there is nothing to supply.
 */
const SENDABLE: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.ISSUED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
  PurchaseOrderStatus.FULLY_RECEIVED,
];

const PO_INCLUDE = {
  supplier: { select: { companyName: true, contactEmail: true } },
  vendor: { select: { companyName: true, contactEmail: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  lines: {
    orderBy: { sequence: 'asc' as const },
    include: { item: { select: { itemCode: true, name: true } } },
  },
} satisfies Prisma.PurchaseOrderInclude;

type PoWithRelations = Prisma.PurchaseOrderGetPayload<{
  include: typeof PO_INCLUDE;
}>;

/**
 * Emailing an issued Purchase Order to the supplier, with the order itself as a
 * rendered PDF attachment.
 *
 * Its own service rather than more methods on PurchaseOrderService: this is the
 * only part of purchasing that reaches outside the company, and it owns three
 * collaborators (PDF renderer, mailer, letterhead) that the CRUD/transition
 * service has no business knowing about.
 */
@Injectable()
export class PurchaseOrderEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PurchasingAccessService,
    private readonly email: EmailService,
    private readonly pdf: PdfService,
  ) {}

  /**
   * Renders the PO and mails it. Uses EmailService.send() — the strict variant —
   * because here the send IS the operation the user pressed a button for: a
   * silent failure would leave them believing the supplier has the order.
   *
   * Returns the send result (including the two ways a send can succeed without
   * delivering: dry-run and the staging recipient allowlist) so the UI can say
   * what actually happened rather than always "sent".
   */
  async emailToParty(
    id: string,
    dto: EmailPurchaseOrderDto,
    user: AuthenticatedUser,
  ): Promise<EmailSendResultEntity> {
    await this.access.assertCanManagePurchaseOrders(user);
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: PO_INCLUDE,
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (!SENDABLE.includes(po.status)) {
      throw new BadRequestException(
        `Only an issued purchase order can be emailed to the supplier (current: ${po.status})`,
      );
    }

    const to = this.resolveRecipient(po, dto.to);
    const organisationName = await resolveOrganisationName(this.prisma);
    const settings = await this.prisma.financeCompanySettings.findFirst({
      select: { gstin: true },
    });

    const data = this.toDocumentData(po, organisationName, settings?.gstin);
    const fileName = purchaseOrderPdfFileName(po.poNumber, data.partyName);
    const pdf = await this.pdf.htmlToPdf(
      renderPurchaseOrderDocumentHtml(data),
      {
        title: `${po.poNumber} — Purchase Order`,
        footerHtml: purchaseOrderFooterHtml(),
        assets: data.hasLogo
          ? [
              {
                filename: 'letterhead-logo.png',
                content: letterheadLogo() as Buffer,
                contentType: 'image/png',
              },
            ]
          : [],
      },
    );

    const rendered = purchaseOrderIssuedEmail({
      poNumber: po.poNumber,
      partyName: data.partyName,
      orderDate: po.orderDate,
      expectedDeliveryDate: po.expectedDeliveryDate,
      lineCount: po.lines.length,
      totalAmountFormatted: formatIndianAmount(data.totalAmount),
      attachmentFileName: fileName,
      organisationName,
      note: dto.note,
      resend: !!po.lastEmailedAt,
    });

    // No idempotency key on purpose: a second press IS a deliberate re-send
    // (a lost email, a corrected recipient), and Resend would suppress it as a
    // duplicate for 24h. Same reasoning as the RFQ invite.
    const sent = await this.email.send({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: [{ name: 'kind', value: 'purchase-order' }],
      attachments: [
        { filename: fileName, content: pdf, contentType: 'application/pdf' },
      ],
    });

    // Stamp only a send the provider actually accepted. A dry-run or an
    // allowlist-suppressed send must not leave the detail page claiming the
    // supplier has the order.
    if (!sent.skipped) {
      await this.prisma.purchaseOrder.update({
        where: { id },
        data: { lastEmailedAt: new Date(), lastEmailedTo: to },
      });
    }
    return EmailSendResultEntity.from(sent);
  }

  /**
   * The default recipient is the registered partner's contactEmail (required on
   * every Supplier/Vendor). An ad-hoc party has only a free-text contact block,
   * which may or may not hold an address — so it must be supplied explicitly
   * rather than guessed at out of prose.
   */
  private resolveRecipient(po: PoWithRelations, override?: string): string {
    const explicit = override?.trim();
    if (explicit) {
      if (!isValidEmailAddress(explicit)) {
        throw new BadRequestException(`"${explicit}" is not a valid email address`);
      }
      return explicit;
    }
    const registered = (
      po.supplier?.contactEmail ??
      po.vendor?.contactEmail ??
      ''
    ).trim();
    if (!registered) {
      throw new BadRequestException(
        po.adHocPartyName
          ? 'An ad-hoc party has no registered email address — supply one to send this purchase order'
          : 'The supplier/vendor on this purchase order has no contact email on record',
      );
    }
    if (!isValidEmailAddress(registered)) {
      throw new BadRequestException(
        `The partner's contact email on record ("${registered}") is not a valid address`,
      );
    }
    return registered;
  }

  /** Flattens the Prisma row into the pure document renderer's snapshot. */
  private toDocumentData(
    po: PoWithRelations,
    legalName: string,
    gstin: string | null | undefined,
  ): PurchaseOrderDocumentData {
    const total = po.lines.reduce(
      (sum, l) => sum.plus(l.lineTotal),
      new Prisma.Decimal(0),
    );
    return {
      poNumber: po.poNumber,
      orderDate: po.orderDate,
      expectedDeliveryDate: po.expectedDeliveryDate,
      partyKind: po.supplierId
        ? 'Supplier'
        : po.vendorId
          ? 'Vendor'
          : 'Ad-hoc Party',
      partyName:
        po.supplier?.companyName ??
        po.vendor?.companyName ??
        po.adHocPartyName ??
        '—',
      partyContactInfo: po.adHocContactInfo,
      partyAddress: po.adHocPartyAddress,
      notes: po.notes,
      raisedByName: po.createdBy
        ? `${po.createdBy.firstName} ${po.createdBy.lastName}`.trim()
        : null,
      totalAmount: total.toFixed(2),
      lines: po.lines.map((l) => ({
        itemCode: l.item?.itemCode ?? null,
        itemName: l.item?.name ?? l.adHocItemName ?? 'Ad-hoc item',
        adHocDescription: l.adHocDescription,
        notes: l.notes,
        orderedQuantity: l.orderedQuantity.toString(),
        unitOfMeasure: l.unitOfMeasure,
        unitPrice: l.unitPrice.toString(),
        lineTotal: l.lineTotal.toString(),
      })),
      buyer: { legalName, gstin: gstin ?? null },
      generatedOn: new Date(),
      hasLogo: letterheadLogo() !== null,
    };
  }
}
