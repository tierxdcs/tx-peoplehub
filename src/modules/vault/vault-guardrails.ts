import { BadRequestException } from '@nestjs/common';

/**
 * Upload security guardrails (spec §5). Pure functions so both upload paths
 * (new file + new version) enforce them identically, and they're trivially
 * unit-testable. All checks run BEFORE any presigned URL is issued.
 */

/** Executable / script extensions rejected at upload (blocklist, not allowlist). */
export const BLOCKED_EXTENSIONS = new Set<string>([
  'exe',
  'bat',
  'cmd',
  'sh',
  'ps1',
  'psm1',
  'msi',
  'dll',
  'scr',
  'vbs',
  'vbe',
  'js', // standalone script files; documents are fine
  'jse',
  'wsf',
  'wsh',
  'com',
  'pif',
  'reg',
  'jar',
  'app',
  'apk',
]);

/** 500 MB per upload. */
export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

/** 5 GB cumulative per employee across their PERSONAL folder. */
export const PERSONAL_FOLDER_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

/** Lowercased final extension of a filename, or '' if none. */
export function fileExtension(name: string): string {
  const base = name.split('/').pop() ?? name;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Throw if the filename's extension is on the executable/script blocklist. */
export function assertExtensionAllowed(name: string): void {
  const ext = fileExtension(name);
  if (ext && BLOCKED_EXTENSIONS.has(ext)) {
    throw new BadRequestException(
      `Files with a .${ext} extension are not allowed for security reasons`,
    );
  }
}

/** Throw if the declared upload size exceeds the 500 MB per-file cap. */
export function assertSizeWithinCap(sizeBytes: number): void {
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new BadRequestException(
      `File exceeds the ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB per-upload limit`,
    );
  }
}

/**
 * Throw if adding `incomingBytes` would push the employee's PERSONAL-folder
 * usage over the 5 GB quota. `currentUsageBytes` is the summed size of their
 * existing personal-folder file versions.
 */
export function assertWithinPersonalQuota(
  currentUsageBytes: bigint,
  incomingBytes: number,
): void {
  const projected = currentUsageBytes + BigInt(incomingBytes);
  if (projected > BigInt(PERSONAL_FOLDER_QUOTA_BYTES)) {
    const gb = PERSONAL_FOLDER_QUOTA_BYTES / (1024 * 1024 * 1024);
    throw new BadRequestException(
      `This upload would exceed your ${gb}GB personal folder quota`,
    );
  }
}
