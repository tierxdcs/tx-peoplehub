import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../core/database/prisma.service';
import { VaultAccessService } from './vault-access.service';
import { VaultStorageService } from './vault-storage.service';
import { VaultExternalShareService } from './vault-external-share.service';

/**
 * Focus: the public token-resolution rules (log-always, expiry, revoke,
 * password) and file version-pinning resolution — all with mocked prisma so
 * the logic is exercised deterministically. Creation/read-access is covered
 * end-to-end in the e2e spec.
 */
describe('VaultExternalShareService.resolveByToken', () => {
  let service: VaultExternalShareService;
  let prisma: any;
  let storage: { createDownloadUrl: jest.Mock };

  const NOW = new Date('2026-07-11T12:00:00Z');
  const future = new Date('2026-07-12T12:00:00Z');
  const past = new Date('2026-07-10T12:00:00Z');

  beforeEach(async () => {
    prisma = {
      vaultExternalShareLink: { findUnique: jest.fn() },
      vaultExternalAccessLog: { create: jest.fn().mockResolvedValue({}) },
      vaultFileVersion: { findUnique: jest.fn() },
      vaultFolder: { findUnique: jest.fn() },
    };
    storage = {
      createDownloadUrl: jest.fn().mockResolvedValue({
        url: 'https://r2/preview',
        expiresInSeconds: 300,
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VaultExternalShareService,
        { provide: PrismaService, useValue: prisma },
        { provide: VaultAccessService, useValue: {} },
        { provide: VaultStorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(VaultExternalShareService);
  });

  function link(overrides: Record<string, unknown> = {}) {
    return {
      id: 'link-1',
      resourceType: 'FILE',
      resourceId: 'file-1',
      token: 'tok',
      permission: 'VIEW',
      pinnedVersionId: 'ver-1',
      passwordHash: null,
      expiresAt: future,
      revokedAt: null,
      createdById: 'u1',
      createdAt: past,
      ...overrides,
    } as any;
  }

  function pinnedVersion(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ver-1',
      fileId: 'file-1',
      versionNumber: 1,
      mimeType: 'application/pdf',
      storageKey: 'vault/files/file-1/v1',
      previewStorageKey: 'vault/files/file-1/v1',
      previewStatus: 'READY',
      file: { name: 'doc.pdf', status: 'ACTIVE' },
      ...overrides,
    } as any;
  }

  it('logs the attempt then 404s an unknown token (no link to attach a log to)', async () => {
    prisma.vaultExternalShareLink.findUnique.mockResolvedValue(null);
    await expect(
      service.resolveByToken('nope', undefined, { ip: '1.1.1.1' }, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Unknown token → no log row (nothing to reference).
    expect(prisma.vaultExternalAccessLog.create).not.toHaveBeenCalled();
  });

  it('logs EVERY attempt against a known link — including a failed one', async () => {
    prisma.vaultExternalShareLink.findUnique.mockResolvedValue(
      link({ revokedAt: past }),
    );
    await expect(
      service.resolveByToken(
        'tok',
        undefined,
        { ip: '2.2.2.2', userAgent: 'UA' },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.vaultExternalAccessLog.create).toHaveBeenCalledWith({
      data: { shareLinkId: 'link-1', ipAddress: '2.2.2.2', userAgent: 'UA' },
    });
  });

  it('rejects an expired link', async () => {
    prisma.vaultExternalShareLink.findUnique.mockResolvedValue(
      link({ expiresAt: past }),
    );
    await expect(
      service.resolveByToken('tok', undefined, {}, NOW),
    ).rejects.toThrow(/expired/);
  });

  it('rejects a revoked link even before expiry', async () => {
    prisma.vaultExternalShareLink.findUnique.mockResolvedValue(
      link({ revokedAt: past, expiresAt: future }),
    );
    await expect(
      service.resolveByToken('tok', undefined, {}, NOW),
    ).rejects.toThrow(/revoked/);
  });

  it('rejects a wrong/missing password when one is set', async () => {
    const hash = await bcrypt.hash('correct', 10);
    prisma.vaultExternalShareLink.findUnique.mockResolvedValue(
      link({ passwordHash: hash }),
    );
    await expect(
      service.resolveByToken('tok', 'wrong', {}, NOW),
    ).rejects.toThrow(/password/);
    await expect(
      service.resolveByToken('tok', undefined, {}, NOW),
    ).rejects.toThrow(/password/);
  });

  it('resolves a valid link to the pinned version’s preview URL', async () => {
    prisma.vaultExternalShareLink.findUnique.mockResolvedValue(link());
    prisma.vaultFileVersion.findUnique.mockResolvedValue(pinnedVersion());

    const res = await service.resolveByToken('tok', undefined, {}, NOW);

    expect(prisma.vaultFileVersion.findUnique).toHaveBeenCalledWith({
      where: { id: 'ver-1' }, // the PINNED version, not "current"
      include: { file: true },
    });
    expect(res.resourceType).toBe('FILE');
    expect(res.name).toBe('doc.pdf');
    expect(res.url).toBe('https://r2/preview');
  });

  it('accepts a correct password', async () => {
    const hash = await bcrypt.hash('s3cret', 10);
    prisma.vaultExternalShareLink.findUnique.mockResolvedValue(
      link({ passwordHash: hash }),
    );
    prisma.vaultFileVersion.findUnique.mockResolvedValue(pinnedVersion());
    const res = await service.resolveByToken('tok', 's3cret', {}, NOW);
    expect(res.url).toBe('https://r2/preview');
  });

  it('serves the original when the pinned version has no ready preview', async () => {
    prisma.vaultExternalShareLink.findUnique.mockResolvedValue(link());
    prisma.vaultFileVersion.findUnique.mockResolvedValue(
      pinnedVersion({
        previewStatus: 'NOT_APPLICABLE',
        previewStorageKey: null,
      }),
    );
    await service.resolveByToken('tok', undefined, {}, NOW);
    // Falls back to the original storage key.
    expect(storage.createDownloadUrl).toHaveBeenCalledWith(
      'vault/files/file-1/v1',
    );
  });

  it('404s if the pinned version was pruned away', async () => {
    prisma.vaultExternalShareLink.findUnique.mockResolvedValue(
      link({ pinnedVersionId: null }),
    );
    await expect(
      service.resolveByToken('tok', undefined, {}, NOW),
    ).rejects.toThrow(/no longer available/);
  });
});
