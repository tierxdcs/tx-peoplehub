import { BadRequestException } from '@nestjs/common';
import {
  MAX_FILE_SIZE_BYTES,
  PERSONAL_FOLDER_QUOTA_BYTES,
  assertExtensionAllowed,
  assertSizeWithinCap,
  assertWithinPersonalQuota,
  fileExtension,
} from './vault-guardrails';

describe('vault guardrails', () => {
  describe('fileExtension', () => {
    it('extracts the lowercased final extension', () => {
      expect(fileExtension('report.PDF')).toBe('pdf');
      expect(fileExtension('archive.tar.gz')).toBe('gz');
      expect(fileExtension('malware.EXE')).toBe('exe');
    });
    it('returns empty for no/edge extensions', () => {
      expect(fileExtension('noext')).toBe('');
      expect(fileExtension('.gitignore')).toBe(''); // leading dot only
      expect(fileExtension('trailingdot.')).toBe('');
    });
  });

  describe('assertExtensionAllowed', () => {
    it.each(['exe', 'bat', 'cmd', 'sh', 'ps1', 'msi', 'dll', 'scr', 'vbs'])(
      'rejects .%s',
      (ext) => {
        expect(() => assertExtensionAllowed(`x.${ext}`)).toThrow(
          BadRequestException,
        );
      },
    );
    it.each(['pdf', 'docx', 'xlsx', 'png', 'jpg', 'txt', 'csv'])(
      'allows .%s',
      (ext) => {
        expect(() => assertExtensionAllowed(`x.${ext}`)).not.toThrow();
      },
    );
    it('is case-insensitive', () => {
      expect(() => assertExtensionAllowed('X.ExE')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('assertSizeWithinCap', () => {
    it('allows up to exactly 500MB', () => {
      expect(() => assertSizeWithinCap(MAX_FILE_SIZE_BYTES)).not.toThrow();
    });
    it('rejects over 500MB', () => {
      expect(() => assertSizeWithinCap(MAX_FILE_SIZE_BYTES + 1)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('assertWithinPersonalQuota', () => {
    it('allows an upload that lands exactly on the 5GB quota', () => {
      expect(() =>
        assertWithinPersonalQuota(
          BigInt(PERSONAL_FOLDER_QUOTA_BYTES - 100),
          100,
        ),
      ).not.toThrow();
    });
    it('rejects an upload that would exceed the quota', () => {
      expect(() =>
        assertWithinPersonalQuota(
          BigInt(PERSONAL_FOLDER_QUOTA_BYTES - 100),
          101,
        ),
      ).toThrow(BadRequestException);
    });
    it('rejects when already at quota', () => {
      expect(() =>
        assertWithinPersonalQuota(BigInt(PERSONAL_FOLDER_QUOTA_BYTES), 1),
      ).toThrow(BadRequestException);
    });
  });
});
