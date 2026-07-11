import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PreviewStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { VaultStorageService } from './vault-storage.service';
import {
  VaultPreviewService,
  initialPreviewStatus,
} from './vault-preview.service';

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('VaultPreviewService', () => {
  let service: VaultPreviewService;
  let prisma: {
    vaultFileVersion: { update: jest.Mock; findUnique: jest.Mock };
  };
  let storage: {
    getObjectBytes: jest.Mock;
    putObjectBytes: jest.Mock;
    buildPreviewStorageKey: jest.Mock;
  };

  function version(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ver-1',
      fileId: 'file-1',
      versionNumber: 1,
      mimeType: DOCX,
      sizeBytes: BigInt(10),
      storageKey: 'vault/files/file-1/v1',
      previewStorageKey: null,
      previewStatus: PreviewStatus.NOT_APPLICABLE,
      changeNote: null,
      uploadedById: 'u1',
      createdAt: new Date(),
      ...overrides,
    } as any;
  }

  async function build(gotenbergUrl?: string) {
    prisma = {
      vaultFileVersion: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
      },
    };
    storage = {
      getObjectBytes: jest.fn().mockResolvedValue(Buffer.from('doc')),
      putObjectBytes: jest.fn().mockResolvedValue(undefined),
      buildPreviewStorageKey: jest
        .fn()
        .mockReturnValue('vault/files/file-1/v1-preview.pdf'),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VaultPreviewService,
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              k === 'gotenberg'
                ? { url: gotenbergUrl, timeoutMs: 60000 }
                : undefined,
          },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: VaultStorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(VaultPreviewService);
  }

  describe('mime classification', () => {
    it('native types (PDF/image) → READY', () => {
      expect(initialPreviewStatus('application/pdf')).toBe(PreviewStatus.READY);
      expect(initialPreviewStatus('image/png')).toBe(PreviewStatus.READY);
      expect(initialPreviewStatus('image/jpeg')).toBe(PreviewStatus.READY);
      // Tolerates a charset suffix.
      expect(initialPreviewStatus('application/pdf; charset=binary')).toBe(
        PreviewStatus.READY,
      );
    });
    it('office docs → PENDING', () => {
      expect(initialPreviewStatus(DOCX)).toBe(PreviewStatus.PENDING);
      expect(
        initialPreviewStatus(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      ).toBe(PreviewStatus.PENDING);
    });
    it('everything else → NOT_APPLICABLE', () => {
      expect(initialPreviewStatus('application/zip')).toBe(
        PreviewStatus.NOT_APPLICABLE,
      );
      expect(initialPreviewStatus('application/octet-stream')).toBe(
        PreviewStatus.NOT_APPLICABLE,
      );
    });
  });

  describe('initializePreview', () => {
    it('native → READY with preview = the original object, no conversion', async () => {
      await build('https://gotenberg');
      const v = version({ mimeType: 'application/pdf' });
      const status = await service.initializePreview(v);
      expect(status).toBe(PreviewStatus.READY);
      expect(prisma.vaultFileVersion.update).toHaveBeenCalledWith({
        where: { id: 'ver-1' },
        data: {
          previewStatus: PreviewStatus.READY,
          previewStorageKey: v.storageKey,
        },
      });
      expect(storage.getObjectBytes).not.toHaveBeenCalled();
    });

    it('unsupported → NOT_APPLICABLE, no DB write, no conversion', async () => {
      await build('https://gotenberg');
      const status = await service.initializePreview(
        version({ mimeType: 'application/zip' }),
      );
      expect(status).toBe(PreviewStatus.NOT_APPLICABLE);
      expect(prisma.vaultFileVersion.update).not.toHaveBeenCalled();
      expect(storage.getObjectBytes).not.toHaveBeenCalled();
    });

    it('office → PENDING immediately (conversion runs async)', async () => {
      await build('https://gotenberg');
      const status = await service.initializePreview(version());
      expect(status).toBe(PreviewStatus.PENDING);
      // First update sets PENDING.
      expect(prisma.vaultFileVersion.update).toHaveBeenCalledWith({
        where: { id: 'ver-1' },
        data: { previewStatus: PreviewStatus.PENDING, previewStorageKey: null },
      });
    });
  });

  describe('runConversion', () => {
    it('office doc → fetch, POST to Gotenberg, upload PDF, mark READY', async () => {
      await build('https://gotenberg.example');
      prisma.vaultFileVersion.findUnique.mockResolvedValue(version());
      const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => Buffer.from('%PDF-1.7 fake').buffer,
      } as any);

      await service.runConversion('ver-1');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://gotenberg.example/forms/libreoffice/convert',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(storage.putObjectBytes).toHaveBeenCalledWith(
        'vault/files/file-1/v1-preview.pdf',
        expect.any(Buffer),
        'application/pdf',
      );
      // Terminal state READY with the preview key.
      expect(prisma.vaultFileVersion.update).toHaveBeenCalledWith({
        where: { id: 'ver-1' },
        data: {
          previewStorageKey: 'vault/files/file-1/v1-preview.pdf',
          previewStatus: PreviewStatus.READY,
        },
      });
      fetchMock.mockRestore();
    });

    it('Gotenberg error → FAILED, never stuck at PENDING', async () => {
      await build('https://gotenberg.example');
      prisma.vaultFileVersion.findUnique.mockResolvedValue(version());
      const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'boom',
      } as any);

      await service.runConversion('ver-1');

      expect(prisma.vaultFileVersion.update).toHaveBeenCalledWith({
        where: { id: 'ver-1' },
        data: { previewStatus: PreviewStatus.FAILED },
      });
      expect(storage.putObjectBytes).not.toHaveBeenCalled();
      fetchMock.mockRestore();
    });

    it('no GOTENBERG_URL configured → FAILED (not stuck)', async () => {
      await build(undefined);
      prisma.vaultFileVersion.findUnique.mockResolvedValue(version());
      await service.runConversion('ver-1');
      expect(prisma.vaultFileVersion.update).toHaveBeenCalledWith({
        where: { id: 'ver-1' },
        data: { previewStatus: PreviewStatus.FAILED },
      });
    });
  });
});
