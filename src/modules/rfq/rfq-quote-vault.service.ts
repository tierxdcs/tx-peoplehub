import { randomUUID } from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  PreviewStatus,
  VaultFileStatus,
  VaultFolderType,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { VaultStorageService } from '../vault/vault-storage.service';
import {
  RfqQuotePdfData,
  renderRfqQuotePdf,
  rfqQuoteFileName,
} from './rfq-quote-pdf';

/**
 * The code-managed Vault folder every submitted quote is filed into. Created by
 * the seed (DEFAULT_FOLDERS in prisma/seed.ts) as an SCM-scoped folder with an
 * ACCOUNTS read grant and versioning on, so it exists identically on every
 * environment and cannot be renamed out from under this lookup.
 */
export const RFQ_QUOTES_FOLDER_NAME = 'RFQ Quotes';

/**
 * Files a submitted RFQ quote into Vault as a rendered PDF.
 *
 * One Vault file per (RFQ, partner, revision): re-filing the same revision adds
 * a *version* rather than a second file, so the earlier bytes stay retrievable.
 * A negotiated revision is a different offer, so it lands as its own clearly
 * named file (`…_Quote_Rev2.pdf`) in the same "RFQ Quotes" folder — the
 * negotiation reads as a sequence of documents, not a silent overwrite.
 *
 * The uploader recorded on the file is the RFQ's creator — a vendor quoting
 * through the public portal has no Employee row, and VaultFile.uploadedById is
 * required, so the internal sponsor of the RFQ owns the artefact.
 */
@Injectable()
export class RfqQuoteVaultService {
  private readonly logger = new Logger(RfqQuoteVaultService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: VaultStorageService,
  ) {}

  /**
   * Render + file the invitee's latest SUBMITTED quote revision. Throws on a
   * missing folder, missing quote, or a storage failure — callers on the
   * vendor's submit path must catch, because a Vault problem is ours, not the
   * vendor's.
   */
  async fileSubmittedQuote(
    inviteeId: string,
  ): Promise<{ fileId: string; versionNumber: number; name: string }> {
    const invitee = await this.prisma.rfqInvitee.findUniqueOrThrow({
      where: { id: inviteeId },
      include: {
        supplier: { select: { companyName: true } },
        vendor: { select: { companyName: true } },
        rfq: {
          select: {
            rfqNumber: true,
            submissionDeadline: true,
            requiredByDate: true,
            deliveryLocation: true,
            paymentTermsRequested: true,
            createdById: true,
          },
        },
        // The newest submitted revision — a draft revision in progress has
        // nothing final to file.
        quotes: {
          where: { submittedAt: { not: null } },
          orderBy: { revisionNumber: 'desc' },
          take: 1,
          include: {
            lines: {
              include: {
                rfqLine: {
                  select: {
                    sequence: true,
                    quantity: true,
                    unitOfMeasure: true,
                    specificationNotes: true,
                    targetPrice: true,
                    item: { select: { itemCode: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const quote = invitee.quotes[0];
    if (!quote) {
      throw new NotFoundException('This invitee has no quote to file');
    }

    const folder = await this.prisma.vaultFolder.findFirst({
      where: { name: RFQ_QUOTES_FOLDER_NAME, type: VaultFolderType.DEFAULT },
      select: { id: true, maxVersionsRetained: true },
    });
    if (!folder) {
      throw new NotFoundException(
        `The "${RFQ_QUOTES_FOLDER_NAME}" folder is not provisioned — run the seed.`,
      );
    }

    const partnerName =
      invitee.supplier?.companyName ?? invitee.vendor?.companyName ?? 'Unknown';
    const data: RfqQuotePdfData = {
      rfqNumber: invitee.rfq.rfqNumber,
      submissionDeadline: invitee.rfq.submissionDeadline,
      requiredByDate: invitee.rfq.requiredByDate,
      deliveryLocation: invitee.rfq.deliveryLocation,
      paymentTermsRequested: invitee.rfq.paymentTermsRequested,
      partnerKind: invitee.supplierId ? 'Supplier' : 'Vendor',
      partnerName,
      // This revision's own submission time, not the invitee's latest.
      submittedAt: quote.submittedAt ?? invitee.submittedAt ?? new Date(),
      revisionNumber: quote.revisionNumber,
      revisionNote: quote.revisionNumber > 1 ? invitee.revisionNote : null,
      quotedLeadTimeDays: quote.quotedLeadTimeDays,
      paymentTermsOffered: quote.paymentTermsOffered,
      validityDays: quote.validityDays,
      notes: quote.notes,
      totalQuotedValue: quote.totalQuotedValue.toString(),
      attachmentCount: ((quote.attachmentFileKeys as string[] | null) ?? [])
        .length,
      // Quote lines carry no order of their own; print them in RFQ line order
      // so the PDF reads the same way the vendor's form did.
      lines: [...quote.lines]
        .sort((a, b) => a.rfqLine.sequence - b.rfqLine.sequence)
        .map((l) => ({
          itemCode: l.rfqLine.item?.itemCode ?? null,
          itemName: l.rfqLine.item?.name ?? 'Item',
          quantity: l.rfqLine.quantity.toString(),
          unitOfMeasure: l.rfqLine.unitOfMeasure,
          specificationNotes: l.rfqLine.specificationNotes,
          targetPrice: l.rfqLine.targetPrice,
          unitPrice: l.unitPrice.toString(),
          lineTotal: l.lineTotal.toString(),
          deliveryLeadTimeDays: l.deliveryLeadTimeDays,
          remarks: l.remarks,
        })),
    };

    const name = rfqQuoteFileName(
      invitee.rfq.rfqNumber,
      partnerName,
      quote.revisionNumber,
    );
    const bytes = await renderRfqQuotePdf(data);
    const changeNote =
      quote.revisionNumber > 1
        ? `Revision ${quote.revisionNumber} submitted ${data.submittedAt.toISOString()}`
        : `Quote submitted ${data.submittedAt.toISOString()}`;

    const existing = await this.prisma.vaultFile.findFirst({
      where: {
        folderId: folder.id,
        name,
        status: { not: VaultFileStatus.DELETED },
      },
      select: { id: true },
    });

    const result = existing
      ? await this.addVersion(
          existing.id,
          bytes,
          invitee.rfq.createdById,
          changeNote,
        )
      : await this.createFile(
          folder.id,
          name,
          bytes,
          invitee.rfq.createdById,
          changeNote,
        );

    await this.pruneOldVersions(result.fileId, folder.maxVersionsRetained);
    this.logger.log(
      `Filed ${name} v${result.versionNumber} to Vault for invitee ${inviteeId}`,
    );
    return { ...result, name };
  }

  /**
   * Same as fileSubmittedQuote, but swallows every failure. For the public
   * submit path: the vendor's quote is already committed, and a Vault or R2
   * outage must never surface to them as a failed submission.
   */
  async tryFileSubmittedQuote(inviteeId: string): Promise<void> {
    try {
      await this.fileSubmittedQuote(inviteeId);
    } catch (e) {
      this.logger.error(
        `Failed to file the Vault PDF for RFQ invitee ${inviteeId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /** First filing of this (RFQ, partner) pair: bytes, then file + version 1. */
  private async createFile(
    folderId: string,
    name: string,
    bytes: Buffer,
    uploadedById: string,
    changeNote: string,
  ): Promise<{ fileId: string; versionNumber: number }> {
    const fileId = randomUUID();
    const storageKey = this.storage.buildStorageKey(fileId, 1);
    // Bytes first: a row whose object is missing looks like a real document in
    // the folder list. A leaked object with no row is invisible and harmless.
    await this.storage.putObjectBytes(storageKey, bytes, 'application/pdf');
    await this.prisma.$transaction(async (tx) => {
      await tx.vaultFile.create({
        data: {
          id: fileId,
          folderId,
          name,
          uploadedById,
          // ACTIVE immediately: unlike a browser upload there is no pending
          // presigned PUT to confirm — the bytes are already in storage.
          status: VaultFileStatus.ACTIVE,
        },
      });
      const version = await tx.vaultFileVersion.create({
        data: {
          fileId,
          versionNumber: 1,
          mimeType: 'application/pdf',
          sizeBytes: BigInt(bytes.byteLength),
          storageKey,
          previewStatus: PreviewStatus.NOT_APPLICABLE,
          changeNote,
          uploadedById,
        },
      });
      await tx.vaultFile.update({
        where: { id: fileId },
        data: { currentVersionId: version.id },
      });
    });
    return { fileId, versionNumber: 1 };
  }

  /** Resubmission: append a version to the existing file and make it current. */
  private async addVersion(
    fileId: string,
    bytes: Buffer,
    uploadedById: string,
    changeNote: string,
  ): Promise<{ fileId: string; versionNumber: number }> {
    const latest = await this.prisma.vaultFileVersion.findFirst({
      where: { fileId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const storageKey = this.storage.buildStorageKey(fileId, versionNumber);
    await this.storage.putObjectBytes(storageKey, bytes, 'application/pdf');
    await this.prisma.$transaction(async (tx) => {
      const version = await tx.vaultFileVersion.create({
        data: {
          fileId,
          versionNumber,
          mimeType: 'application/pdf',
          sizeBytes: BigInt(bytes.byteLength),
          storageKey,
          previewStatus: PreviewStatus.NOT_APPLICABLE,
          changeNote,
          uploadedById,
        },
      });
      await tx.vaultFile.update({
        where: { id: fileId },
        data: {
          currentVersionId: version.id,
          status: VaultFileStatus.ACTIVE,
        },
      });
    });
    return { fileId, versionNumber };
  }

  /**
   * Retention, mirroring VaultFilesService: drop the oldest versions past the
   * folder's cap, deleting the R2 object too so pruning realizes the saving.
   */
  private async pruneOldVersions(
    fileId: string,
    cap: number | null,
  ): Promise<void> {
    if (cap === null || cap === undefined) return;
    const versions = await this.prisma.vaultFileVersion.findMany({
      where: { fileId },
      orderBy: { versionNumber: 'asc' },
      select: { id: true, storageKey: true },
    });
    if (versions.length <= cap) return;
    for (const v of versions.slice(0, versions.length - cap)) {
      await this.storage.deleteObject(v.storageKey);
      await this.prisma.vaultFileVersion.delete({ where: { id: v.id } });
    }
  }
}
