import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PreviewStatus, VaultFileVersion } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { VaultStorageService } from './vault-storage.service';

interface GotenbergConfig {
  url?: string;
  timeoutMs: number;
}

/** MIME types the browser previews natively — no conversion, preview = original. */
const NATIVE_PREVIEW_MIME = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
]);

/** Office formats Gotenberg (LibreOffice) converts to PDF. */
const OFFICE_CONVERT_MIME = new Set<string>([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/msword', // .doc
  'application/vnd.ms-excel', // .xls
  'application/vnd.ms-powerpoint', // .ppt
]);

/** The initial previewStatus for a freshly-uploaded version, by mime type. */
export function initialPreviewStatus(mimeType: string): PreviewStatus {
  const mt = mimeType.toLowerCase().split(';')[0].trim();
  if (NATIVE_PREVIEW_MIME.has(mt)) return PreviewStatus.READY;
  if (OFFICE_CONVERT_MIME.has(mt)) return PreviewStatus.PENDING;
  return PreviewStatus.NOT_APPLICABLE;
}

/** A sensible download filename/extension for Gotenberg per office mime. */
function gotenbergUploadName(mimeType: string): string {
  const mt = mimeType.toLowerCase().split(';')[0].trim();
  switch (mt) {
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'input.docx';
    case 'application/msword':
      return 'input.doc';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'input.xlsx';
    case 'application/vnd.ms-excel':
      return 'input.xls';
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return 'input.pptx';
    case 'application/vnd.ms-powerpoint':
      return 'input.ppt';
    default:
      return 'input';
  }
}

/**
 * Per-version preview pipeline (spec §1.3). Decides a version's initial
 * previewStatus from its mime type (native → READY with the original as its
 * own preview; office → PENDING + a queued conversion; else NOT_APPLICABLE),
 * and runs the conversion: fetch original from R2 → POST to Gotenberg's
 * LibreOffice route → upload the PDF back under a preview key → flip the
 * version to READY. Any failure lands the version at FAILED, never stuck at
 * PENDING. Conversion is per-version (content differs between versions), and
 * kicked off fire-and-forget so confirm-upload returns promptly.
 */
@Injectable()
export class VaultPreviewService {
  private readonly logger = new Logger(VaultPreviewService.name);
  private readonly cfg: GotenbergConfig;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storage: VaultStorageService,
  ) {
    this.cfg = config.get<GotenbergConfig>('gotenberg') as GotenbergConfig;
  }

  /**
   * Set a version's initial preview state at confirm time. For native types
   * previewStorageKey = the original object (no conversion). For office types
   * it stays PENDING and a conversion job is launched (not awaited). Returns
   * the resolved initial status.
   */
  async initializePreview(version: VaultFileVersion): Promise<PreviewStatus> {
    const status = initialPreviewStatus(version.mimeType);

    if (status === PreviewStatus.READY) {
      // Natively previewable — the original IS the preview.
      await this.prisma.vaultFileVersion.update({
        where: { id: version.id },
        data: {
          previewStatus: PreviewStatus.READY,
          previewStorageKey: version.storageKey,
        },
      });
      return status;
    }

    if (status === PreviewStatus.PENDING) {
      await this.prisma.vaultFileVersion.update({
        where: { id: version.id },
        data: {
          previewStatus: PreviewStatus.PENDING,
          previewStorageKey: null,
        },
      });
      // Fire-and-forget: don't block confirm-upload on the conversion. The
      // job flips the row to READY or FAILED on its own.
      void this.runConversion(version.id).catch((err) => {
        this.logger.warn(
          `Preview conversion crashed for version ${version.id}: ${(err as Error).message}`,
        );
      });
      return status;
    }

    // NOT_APPLICABLE — download-only; nothing to do (row already defaulted).
    return status;
  }

  /**
   * Convert one version's original document to a preview PDF via Gotenberg.
   * Idempotent-ish: safe to re-run; it re-fetches and re-uploads. Public so a
   * retry endpoint/job could call it later. Terminal states only: READY or
   * FAILED.
   */
  async runConversion(versionId: string): Promise<void> {
    const version = await this.prisma.vaultFileVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) return;

    try {
      if (!this.cfg?.url) {
        throw new Error('GOTENBERG_URL is not configured');
      }
      const original = await this.storage.getObjectBytes(version.storageKey);
      const pdf = await this.convertToPdf(original, version.mimeType);

      const previewKey = this.storage.buildPreviewStorageKey(
        version.fileId,
        version.versionNumber,
      );
      await this.storage.putObjectBytes(previewKey, pdf, 'application/pdf');

      await this.prisma.vaultFileVersion.update({
        where: { id: version.id },
        data: {
          previewStorageKey: previewKey,
          previewStatus: PreviewStatus.READY,
        },
      });
      this.logger.log(
        `Preview ready for version ${version.id} (${version.mimeType})`,
      );
    } catch (err) {
      // Never leave it stuck at PENDING.
      await this.prisma.vaultFileVersion
        .update({
          where: { id: version.id },
          data: { previewStatus: PreviewStatus.FAILED },
        })
        .catch(() => undefined);
      this.logger.warn(
        `Preview conversion FAILED for version ${versionId}: ${(err as Error).message}`,
      );
    }
  }

  /** POST the document to Gotenberg's LibreOffice route; return the PDF bytes. */
  private async convertToPdf(input: Buffer, mimeType: string): Promise<Buffer> {
    const endpoint = `${this.cfg.url!.replace(/\/$/, '')}/forms/libreoffice/convert`;
    const form = new FormData();
    const filename = gotenbergUploadName(mimeType);
    form.append(
      'files',
      new Blob([new Uint8Array(input)], { type: mimeType }),
      filename,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `Gotenberg returned ${res.status}: ${text.slice(0, 200)}`,
        );
      }
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }
}
