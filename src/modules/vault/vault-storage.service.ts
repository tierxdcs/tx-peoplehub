import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface R2Config {
  endpoint?: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  presignTtlSeconds: number;
}

/**
 * Thin wrapper over the Cloudflare R2 (S3-compatible) object store. Its ONLY
 * jobs are: mint short-lived presigned PUT/GET URLs so the browser transfers
 * bytes directly to/from R2 (the backend never streams file content itself),
 * and delete objects (for retention pruning + whole-file deletion). Lazily
 * builds the S3 client so the app boots without R2 configured — any operation
 * then fails with a clear "not configured" error rather than at startup.
 */
@Injectable()
export class VaultStorageService {
  private readonly logger = new Logger(VaultStorageService.name);
  private client: S3Client | null = null;
  private readonly cfg: R2Config;

  constructor(config: ConfigService) {
    this.cfg = config.get<R2Config>('r2') as R2Config;
  }

  /** True only when every credential needed to talk to R2 is present. */
  isConfigured(): boolean {
    return !!(
      this.cfg?.endpoint &&
      this.cfg?.accessKeyId &&
      this.cfg?.secretAccessKey &&
      this.cfg?.bucket
    );
  }

  private getClient(): S3Client {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException(
        'Vault file storage is not configured (set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)',
      );
    }
    if (!this.client) {
      this.client = new S3Client({
        region: this.cfg.region,
        endpoint: this.cfg.endpoint,
        // R2 uses path-style; virtual-hosted-style is not supported.
        forcePathStyle: true,
        credentials: {
          accessKeyId: this.cfg.accessKeyId as string,
          secretAccessKey: this.cfg.secretAccessKey as string,
        },
      });
    }
    return this.client;
  }

  /** Object key for a file version. Namespaced by file id so keys are stable + traceable. */
  buildStorageKey(fileId: string, versionNumber: number): string {
    return `vault/files/${fileId}/v${versionNumber}`;
  }

  /** Short-lived PUT URL the browser uploads directly to. */
  async createUploadUrl(
    storageKey: string,
    contentType: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const command = new PutObjectCommand({
      Bucket: this.cfg.bucket,
      Key: storageKey,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.getClient(), command, {
      expiresIn: this.cfg.presignTtlSeconds,
    });
    return { url, expiresInSeconds: this.cfg.presignTtlSeconds };
  }

  /** Short-lived GET URL for download/preview. */
  async createDownloadUrl(
    storageKey: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const command = new GetObjectCommand({
      Bucket: this.cfg.bucket,
      Key: storageKey,
    });
    const url = await getSignedUrl(this.getClient(), command, {
      expiresIn: this.cfg.presignTtlSeconds,
    });
    return { url, expiresInSeconds: this.cfg.presignTtlSeconds };
  }

  /**
   * Object metadata after a direct upload — used by confirm-upload to verify
   * the browser actually uploaded and that size/type match what was expected.
   * Returns null if the object isn't there yet.
   */
  async headObject(
    storageKey: string,
  ): Promise<{ sizeBytes: number; contentType: string | null } | null> {
    try {
      const res = await this.getClient().send(
        new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: storageKey }),
      );
      return {
        sizeBytes: res.ContentLength ?? 0,
        contentType: res.ContentType ?? null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Download an object's bytes into the backend. Unlike upload/download
   * (presigned, browser↔R2), the preview pipeline genuinely needs the bytes
   * server-side to POST them to Gotenberg — this is the one place the backend
   * handles file content directly.
   */
  async getObjectBytes(storageKey: string): Promise<Buffer> {
    const res = await this.getClient().send(
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: storageKey }),
    );
    const body = res.Body as unknown as {
      transformToByteArray?: () => Promise<Uint8Array>;
    };
    if (!body?.transformToByteArray) {
      throw new InternalServerErrorException(
        'Unexpected R2 response body (no byte stream)',
      );
    }
    return Buffer.from(await body.transformToByteArray());
  }

  /** Upload bytes the backend holds (e.g. a converted preview PDF) to a key. */
  async putObjectBytes(
    storageKey: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: storageKey,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  /** Object key for a version's converted preview PDF (distinct from the original). */
  buildPreviewStorageKey(fileId: string, versionNumber: number): string {
    return `vault/files/${fileId}/v${versionNumber}-preview.pdf`;
  }

  /**
   * Copy an existing object to a new key (server-side, no bytes through the
   * backend) — used by version restore, which duplicates an older version's
   * content into a new version.
   */
  async copyObject(fromKey: string, toKey: string): Promise<void> {
    const { CopyObjectCommand } = await import('@aws-sdk/client-s3');
    await this.getClient().send(
      new CopyObjectCommand({
        Bucket: this.cfg.bucket,
        CopySource: `${this.cfg.bucket}/${fromKey}`,
        Key: toKey,
      }),
    );
  }

  /**
   * Delete the actual R2 object — used by retention pruning and whole-file
   * deletion. Best-effort: a storage delete failure is logged, never thrown,
   * so it can't leave the DB and storage inconsistent from the caller's view
   * (an orphaned object is recoverable; a half-failed prune is worse).
   */
  async deleteObject(storageKey: string): Promise<void> {
    try {
      await this.getClient().send(
        new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: storageKey }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to delete R2 object ${storageKey}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Delete an object and surface storage failures to the caller. Used when an
   * API promises that a successful delete removed the underlying bytes (card
   * attachments), rather than retention cleanup where best-effort is safer.
   */
  async deleteObjectStrict(storageKey: string): Promise<void> {
    await this.getClient().send(
      new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: storageKey }),
    );
  }
}
