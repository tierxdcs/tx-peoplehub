import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(async () => {
    const config = {
      // 32 zero bytes, base64-encoded — a valid-length test key.
      get: jest.fn().mockReturnValue(Buffer.alloc(32).toString('base64')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(EncryptionService);
  });

  it('round-trips plaintext through encrypt/decrypt', () => {
    const plaintext = 'ABCDE1234F';
    const ciphertext = service.encrypt(plaintext);

    expect(ciphertext).not.toBe(plaintext);
    expect(service.decrypt(ciphertext)).toBe(plaintext);
  });

  it('does not store the plaintext trivially encoded in the ciphertext', () => {
    const plaintext = 'my-secret-account-number';
    const ciphertext = service.encrypt(plaintext);

    expect(ciphertext).not.toContain(plaintext);
    expect(ciphertext).not.toBe(Buffer.from(plaintext).toString('base64'));
  });

  it('produces different ciphertext for the same plaintext on each call (random IV)', () => {
    const plaintext = 'PF1234567890';
    const first = service.encrypt(plaintext);
    const second = service.encrypt(plaintext);

    expect(first).not.toBe(second);
    expect(service.decrypt(first)).toBe(plaintext);
    expect(service.decrypt(second)).toBe(plaintext);
  });
});
