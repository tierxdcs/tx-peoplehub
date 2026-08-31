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
  PublicTechnicalDownloadDto,
} from './dto/rfq-public.dto';
import { PushEventsService } from '../notifications/push-events.service';
import { RfqTechnicalService } from './rfq-technical.service';
import { RfqQuoteVaultService } from './rfq-quote-vault.service';

/**
 * What the open/closed decision needs: the invitee's revision window plus the
 * newest revision's submission state.
 */
type RevisionWindowState = {
  quoteStatus: RfqQuoteStatus;
  revisionRequestedAt: Date | null;
  revisionDeadline: Date | null;
  quotes: { submittedAt: Date | null }[];
  rfq: { status: RfqStatus; submissionDeadline: Date };
};

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
    private readonly technical: RfqTechnicalService,
    private readonly quoteVault: RfqQuoteVaultService,
    // PushEventsModule is @Global, so this needs no import edge here.
    private readonly pushEvents: PushEventsService,
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
    // Read before anything is written: once the revision's `submittedAt` is
    // stamped the window reads as closed, so this is the only point at which a
    // negotiated revision is still distinguishable from a first submission. Every
    // other path through assertOpen is a first submission by definition.
    const isRevision = this.revisionWindowOpen(invitee);
    const submittedAt = new Date();

    // Every RFQ line must be priced on submit.
    const rfqLines = await this.prisma.rfqLine.findMany({
      where: { rfqId: invitee.rfqId },
      select: { id: true },
    });
    const priced = new Set(dto.lines.map((l) => l.rfqLineId));
    for (const rl of rfqLines) {
      if (!priced.has(rl.id)) {
        throw new BadRequestException(
          'Every RFQ line must be priced before submitting',
        );
      }
    }
    for (const l of dto.lines) {
      if (!rfqLines.some((rl) => rl.id === l.rfqLineId)) {
        throw new BadRequestException(
          'A quote line references an unknown RFQ line',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const { total, quoteId } = await this.writeQuote(
        tx,
        invitee.id,
        invitee.rfqId,
        dto,
        true,
      );
      await tx.rfqInvitee.update({
        where: { id: invitee.id },
        data: {
          quoteStatus: RfqQuoteStatus.SUBMITTED,
          submittedAt,
        },
      });
      // Stamping submittedAt on the revision closes it: it becomes the offer
      // comparison/award reads, and a further negotiation opens the next one.
      await tx.rfqQuote.update({
        where: { id: quoteId },
        data: { totalQuotedValue: total, submittedAt },
      });
    });
    // File the PDF copy after the quote is committed, and never let it fail the
    // submission — the vendor's part is done, Vault filing is our bookkeeping.
    await this.quoteVault.tryFileSubmittedQuote(invitee.id);
    // Tell the RFQ's owner a number has landed. Same reasoning as the Vault
    // filing above: the vendor's part is done, and nothing we do afterwards may
    // put their submission at risk.
    void this.pushEvents.rfqQuoteSubmitted({
      inviteeId: invitee.id,
      isRevision,
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
  async attachmentUploadUrl(
    token: string,
    dto: PublicQuoteAttachmentUploadUrlDto,
  ) {
    const invitee = await this.validate(token, dto.password);
    this.assertOpen(invitee);
    assertExtensionAllowed(dto.name);
    assertSizeWithinCap(dto.sizeBytes);
    const storageKey = `rfq-quotes/${invitee.id}/attachments/${randomBytes(8).toString('hex')}`;
    const signed = await this.storage.createUploadUrl(storageKey, dto.mimeType);
    return {
      storageKey,
      uploadUrl: signed.url,
      expiresInSeconds: signed.expiresInSeconds,
    };
  }

  async attachmentConfirm(token: string, dto: PublicQuoteAttachmentConfirmDto) {
    const invitee = await this.validate(token, dto.password);
    this.assertOpen(invitee);
    // Confine the key to this invitee's namespace, then verify it really landed.
    if (!dto.storageKey.startsWith(`rfq-quotes/${invitee.id}/attachments/`)) {
      throw new BadRequestException('Invalid storage key');
    }
    const head = await this.storage.headObject(dto.storageKey);
    if (!head)
      throw new BadRequestException(
        'Attachment upload was not found in storage',
      );
    assertSizeWithinCap(head.sizeBytes);
    await this.prisma.$transaction(async (tx) => {
      const quote = await this.workingQuote(tx, invitee.id);
      const keys = (
        (quote.attachmentFileKeys as string[] | null) ?? []
      ).slice();
      if (!keys.includes(dto.storageKey)) keys.push(dto.storageKey);
      await tx.rfqQuote.update({
        where: { id: quote.id },
        data: { attachmentFileKeys: keys as Prisma.InputJsonValue },
      });
    });
    return this.publicView(invitee.id);
  }

  async technicalDownload(token: string, dto: PublicTechnicalDownloadDto) {
    const invitee = await this.validate(token, dto.password);
    return this.technical.download(invitee.rfqId, dto.attachmentId);
  }

  // ── Internals ────────────────────────────────────────────────────────
  private async validate(token: string, password: string | undefined) {
    const invitee = await this.prisma.rfqInvitee.findUnique({
      where: { inviteToken: token },
      include: {
        rfq: {
          select: {
            status: true,
            submissionDeadline: true,
            awardedInviteeId: true,
          },
        },
        // The newest revision decides whether anything is still editable, so
        // every caller of validate() has it to hand.
        quotes: {
          orderBy: { revisionNumber: 'desc' },
          take: 1,
          select: { revisionNumber: true, submittedAt: true },
        },
      },
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
    if (
      invitee.rfq.status === RfqStatus.AWARDED &&
      invitee.rfq.awardedInviteeId !== invitee.id
    ) {
      throw new ForbiddenException(
        'Technical access ended when this RFQ was awarded to another partner',
      );
    }
    return invitee;
  }

  /**
   * True while SCM has this ONE invitee's link reopened for a negotiated
   * revision. Open from the moment of the request until either the revision
   * deadline passes or the invitee submits again — "submits again" being a
   * submission newer than the request, so re-requesting reopens cleanly for the
   * next revision without any extra state to reset.
   */
  private revisionWindowOpen(
    invitee: RevisionWindowState,
    now: Date = new Date(),
  ): boolean {
    if (!invitee.revisionRequestedAt || !invitee.revisionDeadline) return false;
    if (invitee.revisionDeadline <= now) return false;
    const submittedAt = invitee.quotes[0]?.submittedAt;
    if (!submittedAt) return true;
    return submittedAt < invitee.revisionRequestedAt;
  }

  /** The invitee may act while the RFQ is ISSUED, deadline not passed, and they
   *  haven't already submitted/declined — or while a negotiated revision window
   *  is open on their own link after closure. */
  private assertOpen(invitee: RevisionWindowState) {
    // A reopened link is the one path that deliberately outlives the RFQ's own
    // deadline and the invitee's SUBMITTED lock.
    if (this.revisionWindowOpen(invitee)) return;
    if (invitee.revisionRequestedAt) {
      const submittedAt = invitee.quotes[0]?.submittedAt;
      if (submittedAt && submittedAt >= invitee.revisionRequestedAt) {
        throw new ForbiddenException(
          'Your revised quote has already been submitted and is locked',
        );
      }
      throw new ForbiddenException(
        'The window for submitting a revised quote has closed',
      );
    }
    if (invitee.rfq.status !== RfqStatus.ISSUED) {
      throw new ForbiddenException('This RFQ is not accepting quotes');
    }
    if (new Date(invitee.rfq.submissionDeadline) <= new Date()) {
      throw new ForbiddenException('The submission deadline has passed');
    }
    if (invitee.quoteStatus === RfqQuoteStatus.SUBMITTED) {
      throw new ForbiddenException(
        'Your quote has already been submitted and is locked',
      );
    }
    if (invitee.quoteStatus === RfqQuoteStatus.DECLINED) {
      throw new ForbiddenException('You have declined this RFQ');
    }
  }

  /**
   * The revision the invitee is working on right now, created on demand.
   *
   * Callers must have passed assertOpen first: reaching a *submitted* latest
   * revision here means a revision window is open, so the next revision starts —
   * seeded from the previous offer, since a negotiation adjusts numbers rather
   * than re-entering the whole quote. The earlier revision is left untouched.
   */
  private async workingQuote(tx: Prisma.TransactionClient, inviteeId: string) {
    const latest = await tx.rfqQuote.findFirst({
      where: { inviteeId },
      orderBy: { revisionNumber: 'desc' },
      include: { lines: true },
    });
    if (!latest) {
      return tx.rfqQuote.create({ data: { inviteeId, revisionNumber: 1 } });
    }
    if (!latest.submittedAt) return latest;
    return tx.rfqQuote.create({
      data: {
        inviteeId,
        revisionNumber: latest.revisionNumber + 1,
        quotedLeadTimeDays: latest.quotedLeadTimeDays,
        paymentTermsOffered: latest.paymentTermsOffered,
        validityDays: latest.validityDays,
        notes: latest.notes,
        // The same R2 objects: the vendor's supporting files carry over unless
        // they upload new ones. Nothing here ever deletes them.
        attachmentFileKeys:
          (latest.attachmentFileKeys as Prisma.InputJsonValue) ?? undefined,
        totalQuotedValue: latest.totalQuotedValue,
        lines: {
          create: latest.lines.map((line) => ({
            rfqLineId: line.rfqLineId,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
            deliveryLeadTimeDays: line.deliveryLeadTimeDays,
            remarks: line.remarks,
          })),
        },
      },
    });
  }

  private async upsertQuote(inviteeId: string, dto: PublicSaveQuoteDto) {
    const invitee = await this.prisma.rfqInvitee.findUniqueOrThrow({
      where: { id: inviteeId },
      select: { rfqId: true },
    });
    await this.prisma.$transaction((tx) =>
      this.writeQuote(tx, inviteeId, invitee.rfqId, dto, false).then(
        () => undefined,
      ),
    );
  }

  /** Write header + line prices onto the invitee's working revision. Validates
   *  each line belongs to the RFQ; computes lineTotal = unitPrice × RFQ line
   *  quantity, and the header total. */
  private async writeQuote(
    tx: Prisma.TransactionClient,
    inviteeId: string,
    rfqId: string,
    dto: PublicSaveQuoteDto | PublicSubmitQuoteDto,
    submitting: boolean,
  ): Promise<{ total: Prisma.Decimal; quoteId: string }> {
    const working = await this.workingQuote(tx, inviteeId);
    const quote = await tx.rfqQuote.update({
      where: { id: working.id },
      data: {
        ...(dto.quotedLeadTimeDays !== undefined
          ? { quotedLeadTimeDays: dto.quotedLeadTimeDays }
          : {}),
        ...(dto.paymentTermsOffered !== undefined
          ? { paymentTermsOffered: dto.paymentTermsOffered }
          : {}),
        ...(dto.validityDays !== undefined
          ? { validityDays: dto.validityDays }
          : {}),
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
        if (!qty)
          throw new BadRequestException(
            'A quote line references an unknown RFQ line',
          );
        const unit = new Prisma.Decimal(l.unitPrice);
        const lineTotal = unit.times(qty).toDecimalPlaces(2);
        total = total.plus(lineTotal);
        await tx.rfqQuoteLine.upsert({
          where: {
            quoteId_rfqLineId: { quoteId: quote.id, rfqLineId: l.rfqLineId },
          },
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
        total = all.reduce(
          (s, l) => s.plus(l.lineTotal),
          new Prisma.Decimal(0),
        );
        await tx.rfqQuote.update({
          where: { id: quote.id },
          data: { totalQuotedValue: total },
        });
      }
    }
    return { total, quoteId: quote.id };
  }

  /** The vendor-facing view: RFQ header + lines + the invitee's own draft quote.
   *  Never exposes other invitees' data. */
  private async publicView(inviteeId: string) {
    const invitee = await this.prisma.rfqInvitee.findUniqueOrThrow({
      where: { id: inviteeId },
      include: {
        supplier: { select: { companyName: true } },
        vendor: { select: { companyName: true } },
        // Newest revision only: that is what the vendor is editing, or — when a
        // revision was just requested — the offer their revision starts from.
        quotes: {
          orderBy: { revisionNumber: 'desc' },
          take: 1,
          include: { lines: true },
        },
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
    const latest = invitee.quotes[0] ?? null;
    const revisionOpen = this.revisionWindowOpen(invitee);
    return {
      inviteeId: invitee.id,
      partnerName:
        invitee.supplier?.companyName ?? invitee.vendor?.companyName ?? null,
      quoteStatus: invitee.quoteStatus,
      declineReason: invitee.declineReason,
      /**
       * The negotiated-revision state of THIS invitee's link. `open` is what the
       * portal keys the form off — with it true the vendor may edit and submit
       * again even though the RFQ has closed and their previous offer is locked.
       * `revisionNumber` is the revision they are about to submit.
       */
      revision: {
        open: revisionOpen,
        revisionNumber: revisionOpen
          ? ((latest?.submittedAt
              ? latest.revisionNumber + 1
              : latest?.revisionNumber) ?? 1)
          : (latest?.revisionNumber ?? 1),
        requestedAt: invitee.revisionRequestedAt?.toISOString() ?? null,
        deadline: invitee.revisionDeadline?.toISOString() ?? null,
        note: invitee.revisionNote,
      },
      rfq: {
        rfqNumber: invitee.rfq.rfqNumber,
        // Internal RFQ titles/descriptions may contain linked project, order or
        // customer context. The external quote template must never disclose it.
        title: 'Request for Quotation',
        description: null,
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
          targetPrice: l.targetPrice?.toString() ?? null,
        })),
      },
      quote: latest
        ? {
            quotedLeadTimeDays: latest.quotedLeadTimeDays,
            paymentTermsOffered: latest.paymentTermsOffered,
            validityDays: latest.validityDays,
            notes: latest.notes,
            attachmentFileKeys:
              (latest.attachmentFileKeys as string[] | null) ?? [],
            totalQuotedValue: latest.totalQuotedValue.toString(),
            lines: latest.lines.map((l) => ({
              rfqLineId: l.rfqLineId,
              unitPrice: l.unitPrice.toString(),
              lineTotal: l.lineTotal.toString(),
              deliveryLeadTimeDays: l.deliveryLeadTimeDays,
              remarks: l.remarks,
            })),
          }
        : null,
      technical: await this.technical.view(invitee.rfqId),
    };
  }
}
