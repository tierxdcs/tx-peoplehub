import { randomBytes } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BomStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { explodeBom, type ExplodableBom } from '../bom/bom-explosion';
import { VaultStorageService } from '../vault/vault-storage.service';
import {
  assertExtensionAllowed,
  assertSizeWithinCap,
  MAX_FILE_SIZE_BYTES,
} from '../vault/vault-guardrails';
import { RfqAccessService } from './rfq-access.service';
import {
  RfqAttachmentConfirmDto,
  RfqAttachmentUploadUrlDto,
} from './dto/rfq.dto';

@Injectable()
export class RfqTechnicalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: VaultStorageService,
    private readonly access: RfqAccessService,
  ) {}

  async internalView(rfqId: string, user: AuthenticatedUser) {
    await this.access.assertCanReadRfqs(user);
    return this.view(rfqId);
  }

  /** Live view: no BOM snapshot is stored on the RFQ. */
  async view(rfqId: string) {
    const rfq = await this.prisma.rfq.findUnique({
      where: { id: rfqId },
      select: {
        id: true,
        lines: {
          orderBy: { sequence: 'asc' },
          select: {
            id: true,
            itemId: true,
            quantity: true,
            item: { select: { itemCode: true, name: true } },
          },
        },
        attachments: {
          orderBy: { uploadedAt: 'asc' },
          include: {
            uploadedBy: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!rfq) throw new NotFoundException('RFQ not found');

    const released = await this.prisma.bom.findMany({
      where: { status: BomStatus.RELEASED },
      orderBy: { revisionNumber: 'desc' },
      select: {
        itemId: true,
        revisionNumber: true,
        lines: {
          select: {
            itemId: true,
            quantityPerUnit: true,
            wastagePercent: true,
            unitOfMeasure: true,
          },
        },
      },
    });
    const byItem = new Map<string, ExplodableBom>();
    for (const bom of released) if (!byItem.has(bom.itemId)) byItem.set(bom.itemId, bom);
    const componentIds = new Set<string>();
    for (const line of rfq.lines) {
      if (!byItem.has(line.itemId)) continue;
      for (const leaf of explodeBom(line.itemId, (id) => byItem.get(id) ?? null)) {
        componentIds.add(leaf.itemId);
      }
    }
    const componentMeta = await this.prisma.item.findMany({
      where: { id: { in: [...componentIds] } },
      select: { id: true, itemCode: true, name: true, drawingSpecReference: true },
    });
    const meta = new Map(componentMeta.map((item) => [item.id, item]));

    return {
      maxDrawingFileSizeBytes: MAX_FILE_SIZE_BYTES,
      attachments: rfq.attachments.map((file) => ({
        id: file.id,
        rfqLineId: file.rfqLineId,
        fileName: file.fileName,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        uploadedByName: `${file.uploadedBy.firstName} ${file.uploadedBy.lastName}`.trim(),
        uploadedAt: file.uploadedAt.toISOString(),
      })),
      lineBoms: rfq.lines.map((line) => {
        const bom = byItem.get(line.itemId);
        if (!bom) return { rfqLineId: line.id, revisionNumber: null, components: [] };
        const aggregated = new Map<string, { itemId: string; unitOfMeasure: string; quantity: Prisma.Decimal; sourceTrail: string[] }>();
        for (const leaf of explodeBom(line.itemId, (id) => byItem.get(id) ?? null)) {
          const quantity = leaf.quantityPerTopUnit.times(line.quantity);
          const current = aggregated.get(leaf.itemId);
          if (current) current.quantity = current.quantity.plus(quantity);
          else aggregated.set(leaf.itemId, { itemId: leaf.itemId, unitOfMeasure: leaf.unitOfMeasure, quantity, sourceTrail: leaf.sourceTrail });
        }
        return {
          rfqLineId: line.id,
          revisionNumber: bom.revisionNumber,
          components: [...aggregated.values()].map((component) => ({
            itemId: component.itemId,
            itemCode: meta.get(component.itemId)?.itemCode ?? null,
            itemName: meta.get(component.itemId)?.name ?? null,
            quantity: component.quantity.toDecimalPlaces(4).toString(),
            unitOfMeasure: component.unitOfMeasure,
            specification: meta.get(component.itemId)?.drawingSpecReference ?? null,
            sourceTrail: component.sourceTrail,
          })),
        };
      }),
    };
  }

  async uploadUrl(rfqId: string, dto: RfqAttachmentUploadUrlDto, user: AuthenticatedUser) {
    await this.access.assertCanManageRfqs(user);
    await this.assertLine(rfqId, dto.rfqLineId);
    assertExtensionAllowed(dto.fileName);
    assertSizeWithinCap(dto.fileSize);
    const fileKey = `rfqs/${rfqId}/technical/${randomBytes(12).toString('hex')}`;
    const signed = await this.storage.createUploadUrl(fileKey, dto.mimeType);
    return { fileKey, uploadUrl: signed.url, expiresInSeconds: signed.expiresInSeconds };
  }

  async confirm(rfqId: string, dto: RfqAttachmentConfirmDto, user: AuthenticatedUser) {
    await this.access.assertCanManageRfqs(user);
    await this.assertLine(rfqId, dto.rfqLineId);
    if (!dto.fileKey.startsWith(`rfqs/${rfqId}/technical/`)) throw new BadRequestException('Invalid file key');
    assertExtensionAllowed(dto.fileName);
    const head = await this.storage.headObject(dto.fileKey);
    if (!head) throw new BadRequestException('Drawing upload was not found in storage');
    assertSizeWithinCap(head.sizeBytes);
    return this.prisma.rfqAttachment.create({
      data: {
        rfqId,
        rfqLineId: dto.rfqLineId ?? null,
        fileKey: dto.fileKey,
        fileName: dto.fileName,
        fileSize: head.sizeBytes,
        mimeType: head.contentType ?? 'application/octet-stream',
        uploadedById: user.id,
      },
    });
  }

  async internalDownload(rfqId: string, attachmentId: string, user: AuthenticatedUser) {
    await this.access.assertCanReadRfqs(user);
    return this.download(rfqId, attachmentId);
  }

  async download(rfqId: string, attachmentId: string) {
    const file = await this.prisma.rfqAttachment.findFirst({ where: { id: attachmentId, rfqId } });
    if (!file) throw new NotFoundException('RFQ attachment not found');
    const signed = await this.storage.createDownloadUrl(file.fileKey);
    return { url: signed.url, expiresInSeconds: signed.expiresInSeconds, fileName: file.fileName };
  }

  private async assertLine(rfqId: string, rfqLineId?: string) {
    const rfq = await this.prisma.rfq.findUnique({ where: { id: rfqId }, select: { id: true } });
    if (!rfq) throw new NotFoundException('RFQ not found');
    if (rfqLineId) {
      const line = await this.prisma.rfqLine.findFirst({ where: { id: rfqLineId, rfqId }, select: { id: true } });
      if (!line) throw new BadRequestException('RFQ line does not belong to this RFQ');
    }
  }
}
