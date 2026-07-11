import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { VaultStorageService } from './vault-storage.service';

describe('VaultStorageService', () => {
  async function build(r2: Record<string, unknown>) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VaultStorageService,
        {
          provide: ConfigService,
          useValue: { get: (k: string) => (k === 'r2' ? r2 : undefined) },
        },
      ],
    }).compile();
    return module.get(VaultStorageService);
  }

  const fullCfg = {
    endpoint: 'https://acct.r2.cloudflarestorage.com',
    region: 'auto',
    accessKeyId: 'ak',
    secretAccessKey: 'sk',
    bucket: 'vault',
    presignTtlSeconds: 300,
  };

  it('builds stable, file-namespaced storage keys per version', async () => {
    const svc = await build(fullCfg);
    expect(svc.buildStorageKey('file-1', 1)).toBe('vault/files/file-1/v1');
    expect(svc.buildStorageKey('file-1', 7)).toBe('vault/files/file-1/v7');
  });

  it('isConfigured reflects whether all R2 credentials are present', async () => {
    expect((await build(fullCfg)).isConfigured()).toBe(true);
    expect(
      (await build({ ...fullCfg, bucket: undefined })).isConfigured(),
    ).toBe(false);
    expect(
      (await build({ ...fullCfg, endpoint: undefined })).isConfigured(),
    ).toBe(false);
  });

  it('throws a clear error when an operation is attempted unconfigured', async () => {
    const svc = await build({ region: 'auto', presignTtlSeconds: 300 });
    await expect(svc.createUploadUrl('k', 'text/plain')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('mints a presigned PUT URL when configured (no bytes through the backend)', async () => {
    const svc = await build(fullCfg);
    const res = await svc.createUploadUrl(
      'vault/files/f/v1',
      'application/pdf',
    );
    expect(res.expiresInSeconds).toBe(300);
    expect(res.url).toContain('https://acct.r2.cloudflarestorage.com');
    // Presigned query params present → it's a genuine signed URL.
    expect(res.url).toContain('X-Amz-Signature');
  });
});
