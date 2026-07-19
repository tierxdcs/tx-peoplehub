import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RfqQuoteStatus, RfqStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { assertInviteUsable } from '../../common/utils/token-invite';
import { VaultStorageService } from '../vault/vault-storage.service';
import {
  assertExtensionAllowed,
  assertSizeWithinCap,
} from '../vault/vault-guardrails';
import {
  PublicQuoteAttachmentConfirmDto,
  PublicQuoteAttachmentUploadUrlDto,
  PublicDeclineDto,
  PublicResolveRfqDto,
  PublicSaveQuoteDto,
  PublicSubmitQuoteDto,
} from './dto/rfq-public.dto';

/**
 * Public (unauthenticated, token-authed) RFQ quote submission — mirrors the
 * Supplier/Vendor questionnaire public flow. Reuses assertInviteUsable
 * (revoke/expiry/password) from the shared token-invite util. Save-and-resume
 * is supported; the quote locks only on submit. All routes are POST so the
 * optional password rides in the body, never the URL.
 */
@Injectable()
export class RfqPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: VaultStorageService,
  ) {}

  /** Resolve + validate a token; marks the invitee VIEWED. Returns the public RFQ shape. */
  async resolve(token: string, dto: PublicResolveRfqDto) {
    const invitee = await this.validate(token, dto.password);
    if (invitee.quoteStatus === RfqQuoteStatus.INVITED) {
      await this.prisma.rfqInvitee.update({
        where: { id: invitee.id },
        data: { quoteStatus: RfqQuoteStatus.VIEWED },
      });
    }
    return this.publicView(invitee.id);
  }

  async save(token: string, dto: PublicSaveQuoteDto) {
    const invitee = await this.validate(token, dto.password);
    this.assertOpen(invitee);
    await this.upsertQuote(invitee.id, dto);
    return this.publicView(invitee.id);
  }

  async submit(token: string, dto: PublicSubmitQuoteDto) {
    const invitee = await this.validate(token, dto.password);
    this.assertOpen(invitee);

    // Every RFQ line must be priced on submit.
    const rfqLines = await this.prisma.rfqLine.findMany({
      where: { rfqId: invitee.rfqId },
      select: { id: true },
    });
    const priced = new Set(dto.lines.map((l) => l.rfqLineId));
    for (const rl of rfqLines) {
      if (!priced.has(rl.id)) {
        throw new BadRequestException('Every RFQ line must be priced before submitting');
      }
    }
    for (const l of dto.lines) {
      if (!rfqLines.some((rl) => rl.id === l.rfqLineId)) {
        throw new BadRequestException('A quote line references an unknown RFQ line');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const { total } = await this.writeQuote(tx, invitee.id, invitee.rfqId, dto, true);
      await tx.rfqInvitee.update({
        where: { id: invitee.id },
        data: { quoteStatus: RfqQuoteStatus.SUBMITTED, submittedAt: new Date() },
      });
      await tx.rfqQuote.update({
        where: { inviteeId: invitee.id },
        data: { totalQuotedValue: total },
      });
    });
    return this.publicView(invitee.id);
  }

  async decline(token: string, dto: PublicDeclineDto) {
    const invitee = await this.validate(token, dto.password);
    this.assertOpen(invitee);
    await this.prisma.rfqInvitee.update({
      where: { id: invitee.id },
      data: {
        quoteStatus: RfqQuoteStatus.DECLINED,
        declineReason: dto.declineReason ?? null,
      },
    });
    return this.publicView(invitee.id);
  }

  // ── Attachments (mirrors the public cert upload/confirm) ─────────────
  async attachmentUploadUrl(token: string, dto: PublicQuoteAttachmentUploadUrlDto) {
    const invitee = await this.validate(token, dto.password);
    this.assertOpen(invitee);
    assertExtensionAllowed(dto.name);
    assertSizeWithinCap(dto.sizeBytes);
    const storageKey = `rfq-quotes/${invitee.id}/attachments/${randomBytes(8).toString('hex')}`;
    const signed = await this.storage.createUploadUrl(storageKey, dto.mimeType);
    return { storageKey, uploadUrl: signed.url, expiresInSeconds: signed.expiresInSeconds };
  }

  async attachmentConfirm(token: string, dto: PublicQuoteAttachmentConfirmDto) {
    const invitee = await this.validate(token, dto.password);
    this.assertOpen(invitee);
    // Confine the key to this invitee's namespace, then verify it really landed.
    if (!dto.storageKey.startsWith(`rfq-quotes/${invitee.id}/attachments/`)) {
      throw new BadRequestException('Invalid storage key');
    }
    const head = await this.storage.headObject(dto.storageKey);
    if (!head) throw new BadRequestException('Attachment upload was not found in storage');
    assertSizeWithinCap(head.sizeBytes);
    const quote = await this.ensureQuote(invitee.id);
    const keys = ((quote.attachmentFileKeys as string[] | null) ?? []).slice();
    if (!keys.includes(dto.storageKey)) keys.push(dto.storageKey);
    await this.prisma.rfqQuote.update({
      where: { id: quote.id },
      data: { attachmentFileKeys: keys as Prisma.InputJsonValue },
    });
    return this.publicView(invitee.id);
  }

  // ── Internals ────────────────────────────────────────────────────────
  private async validate(token: string, password: string | undefined) {
    const invitee = await this.prisma.rfqInvitee.findUnique({
      where: { inviteToken: token },
      include: { rfq: { select: { status: true, submissionDeadline: true } } },
    });
    if (!invitee || invitee.inviteToken.startsWith('pending:')) {
      throw new NotFoundException('Invalid link');
    }
    await assertInviteUsable(
      {
        revokedAt: invitee.revokedAt,
        expiresAt: invitee.tokenExpiresAt,
        passwordHash: invitee.passwordHash,
      },
      password,
    );
    return invitee;
  }

  /** The invitee may still act only while the RFQ is ISSUED, deadline not passed,
   *  and they haven't already submitted/declined. */
  private assertOpen(invitee: {
    quoteStatus: RfqQuoteStatus;
    rfq: { status: RfqStatus; submissionDeadline: Date };
  }) {
    if (invitee.rfq.status !== RfqStatus.ISSUED) {
      throw new ForbiddenException('This RFQ is not accepting quotes');
    }
    if (new Date(invitee.rfq.submissionDeadline) <= new Date()) {
      throw new ForbiddenException('The submission deadline has passed');
    }
    if (invitee.quoteStatus === RfqQuoteStatus.SUBMITTED) {
      throw new ForbiddenException('Your quote has already been submitted and is locked');
    }
    if (invitee.quoteStatus === RfqQuoteStatus.DECLINED) {
      throw new ForbiddenException('You have declined this RFQ');
    }
  }

  private async ensureQuote(inviteeId: string) {
    const existing = await this.prisma.rfqQuote.findUnique({ where: { inviteeId } });
    if (existing) return existing;
    return this.prisma.rfqQuote.create({ data: { inviteeId } });
  }

  private async upsertQuote(inviteeId: string, dto: PublicSaveQuoteDto) {
    const invitee = await this.prisma.rfqInvitee.findUniqueOrThrow({
      where: { id: inviteeId },
      select: { rfqId: true },
    });
    await this.prisma.$transaction((tx) =>
      this.writeQuote(tx, inviteeId, invitee.rfqId, dto, false).then(() => undefined),
    );
  }

  /** Write header + line prices. Validates each line belongs to the RFQ; computes
   *  lineTotal = unitPrice × RFQ line quantity, and the header total. */
  private async writeQuote(
    tx: Prisma.TransactionClient,
    inviteeId: string,
    rfqId: string,
    dto: PublicSaveQuoteDto | PublicSubmitQuoteDto,
    submitting: boolean,
  ): Promise<{ total: Prisma.Decimal }> {
    const quote = await tx.rfqQuote.upsert({
      where: { inviteeId },
      create: {
        inviteeId,
        quotedLeadTimeDays: dto.quotedLeadTimeDays ?? null,
        paymentTermsOffered: dto.paymentTermsOffered ?? null,
        validityDays: dto.validityDays ?? null,
        notes: dto.notes ?? null,
      },
      update: {
        ...(dto.quotedLeadTimeDays !== undefined ? { quotedLeadTimeDays: dto.quotedLeadTimeDays } : {}),
        ...(dto.paymentTermsOffered !== undefined ? { paymentTermsOffered: dto.paymentTermsOffered } : {}),
        ...(dto.validityDays !== undefined ? { validityDays: dto.validityDays } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });

    let total = new Prisma.Decimal(0);
    if (dto.lines && dto.lines.length) {
      const rfqLines = await tx.rfqLine.findMany({
        where: { rfqId },
        select: { id: true, quantity: true },
      });
      const qtyById = new Map(rfqLines.map((l) => [l.id, l.quantity]));
      for (const l of dto.lines) {
        const qty = qtyById.get(l.rfqLineId);
        if (!qty) throw new BadRequestException('A quote line references an unknown RFQ line');
        const unit = new Prisma.Decimal(l.unitPrice);
        const lineTotal = unit.times(qty).toDecimalPlaces(2);
        total = total.plus(lineTotal);
        await tx.rfqQuoteLine.upsert({
          where: { quoteId_rfqLineId: { quoteId: quote.id, rfqLineId: l.rfqLineId } },
          create: {
            quoteId: quote.id,
            rfqLineId: l.rfqLineId,
            unitPrice: unit,
            lineTotal,
            deliveryLeadTimeDays: l.deliveryLeadTimeDays ?? null,
            remarks: l.remarks ?? null,
          },
          update: {
            unitPrice: unit,
            lineTotal,
            deliveryLeadTimeDays: l.deliveryLeadTimeDays ?? null,
            remarks: l.remarks ?? null,
          },
        });
      }
      // On save (not submit) recompute total from ALL stored lines so a partial
      // save doesn't understate it.
      if (!submitting) {
        const all = await tx.rfqQuoteLine.findMany({
          where: { quoteId: quote.id },
          select: { lineTotal: true },
        });
        total = all.reduce((s, l) => s.plus(l.lineTotal), new Prisma.Decimal(0));
        await tx.rfqQuote.update({
          where: { id: quote.id },
          data: { totalQuotedValue: total },
        });
      }
    }
    return { total };
  }

  /** The vendor-facing view: RFQ header + lines + the invitee's own draft quote.
   *  Never exposes other invitees' data. */
  private async publicView(inviteeId: string) {
    const invitee = await this.prisma.rfqInvitee.findUniqueOrThrow({
      where: { id: inviteeId },
      include: {
        supplier: { select: { companyName: true } },
        vendor: { select: { companyName: true } },
        quote: { include: { lines: true } },
        rfq: {
          include: {
            lines: {
              orderBy: { sequence: 'asc' },
              include: { item: { select: { itemCode: true, name: true } } },
            },
          },
        },
      },
    });
    return {
      inviteeId: invitee.id,
      partnerName: invitee.supplier?.companyName ?? invitee.vendor?.companyName ?? null,
      quoteStatus: invitee.quoteStatus,
      declineReason: invitee.declineReason,
      rfq: {
        rfqNumber: invitee.rfq.rfqNumber,
        title: invitee.rfq.title,
        description: invitee.rfq.description,
        submissionDeadline: invitee.rfq.submissionDeadline.toISOString(),
        requiredByDate: invitee.rfq.requiredByDate?.toISOString() ?? null,
        deliveryLocation: invitee.rfq.deliveryLocation,
        paymentTermsRequested: invitee.rfq.paymentTermsRequested,
        status: invitee.rfq.status,
        lines: invitee.rfq.lines.map((l) => ({
          id: l.id,
          itemCode: l.item?.itemCode ?? null,
          itemName: l.item?.name ?? null,
          quantity: l.quantity.toString(),
          unitOfMeasure: l.unitOfMeasure,
          specificationNotes: l.specificationNotes,
        })),
      },
      quote: invitee.quote
        ? {
            quotedLeadTimeDays: invitee.quote.quotedLeadTimeDays,
            paymentTermsOffered: invitee.quote.paymentTermsOffered,
            validityDays: invitee.quote.validityDays,
            notes: invitee.quote.notes,
            attachmentFileKeys: (invitee.quote.attachmentFileKeys as string[] | null) ?? [],
            totalQuotedValue: invitee.quote.totalQuotedValue.toString(),
            lines: invitee.quote.lines.map((l) => ({
              rfqLineId: l.rfqLineId,
              unitPrice: l.unitPrice.toString(),
              lineTotal: l.lineTotal.toString(),
              deliveryLeadTimeDays: l.deliveryLeadTimeDays,
              remarks: l.remarks,
            })),
          }
        : null,
    };
  }
}
